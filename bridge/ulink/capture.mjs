// Packet captures of Rust Legacy (uLink 1.5.6) traffic: a dependency-free pcap/pcapng reader and writer, a UDP
// recording proxy, and a session decoder that runs every datagram through our own bridge/ulink codecs
// (SERVER-TESTING-PLAN.md section 7 item 2). Used by tools/compare-captures.mjs to check the gateway against the real
// server (P3+) and to diff it against the original desktop client's traffic (P2 reference captures).
import {createSocket} from 'node:dgram';
import {BitWriter,BitReader} from './bits.mjs';
import {KIND,SYSTEM,encodeMessage,encodeSystem,connectBody,responseBody,readConnect,readResponse,reasonBody,relativeSeq,nextSeq} from './lidgren.mjs';
import {INTERNAL,decodeHeader,readClientConnectRequest,readClientConnectResponse,readWorldInfo,writeRustLogin} from './ulink.mjs';
import {readCreate,readArgs,writeArgs,readNgcInstantiate,writeNgcInstantiate,readNgcCall,writeNgcCall,ngcAction,decodeAngles,write as writeValue} from './rust.mjs';

export const DEFAULT_SERVER_PORT=29015;
export const LINKTYPE={NULL:0,ETHERNET:1,RAW:101,LOOP:108,LINUX_SLL:113,LINUX_SLL2:276,IPV4:228,IPV6:229};
const RAW_LINKS=new Set([12,14,101,228,229]);
const KIND_NAME=Object.fromEntries(Object.entries(KIND).map(([k,v])=>[v,k]));
const SYSTEM_NAME=Object.fromEntries(Object.entries(SYSTEM).map(([k,v])=>[v,k]));
const INTERNAL_NAME=Object.fromEntries(Object.entries(INTERNAL).map(([k,v])=>[v,k]));
// Scene views with manual IDs (bridge/game-bridge.mjs SCENE_VIEWS).
const SCENE_VIEWS={996:{prefab:'ECC',class:'EnvironmentControlCenter'},997:{prefab:'CONSOLE',class:'ConsoleNetworker'},998:{prefab:'CONTEXT',class:'Context'}};
const NGC_CARRIER='!Ng';

export const hex=(bytes,max=Infinity)=>{const n=Math.min(bytes.length,max);let s='';for(let i=0;i<n;i++)s+=bytes[i].toString(16).padStart(2,'0');return n<bytes.length?s+'…':s;};
const sameBytes=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const concat=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;};

// ---------------------------------------------------------------- capture files

// Reads classic pcap (µs/ns, either byte order) and pcapng (any number of sections and interfaces).
// Returns {format, packets: [{time (s since epoch), linkType, data, origLen}], notes}.
export function readCapture(input){
 const b=input instanceof Uint8Array?input:new Uint8Array(input.buffer?input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength):input);
 if(b.length<24)throw new Error('File too short to be a capture');
 const dv=new DataView(b.buffer,b.byteOffset,b.byteLength),magic=dv.getUint32(0,false);
 if(magic===0x0a0d0d0a)return readPcapng(b,dv);
 const kind={0xa1b2c3d4:[false,1e6],0xd4c3b2a1:[true,1e6],0xa1b23c4d:[false,1e9],0x4d3cb2a1:[true,1e9]}[magic];
 if(!kind)throw new Error('Not a pcap or pcapng file');
 const [le,res]=kind,linkType=dv.getUint32(20,le)&0xffff,packets=[],notes={truncated:0};
 let off=24;
 while(off+16<=b.length){
  const sec=dv.getUint32(off,le),frac=dv.getUint32(off+4,le),cap=dv.getUint32(off+8,le),orig=dv.getUint32(off+12,le);
  if(off+16+cap>b.length){notes.truncated++;break;}
  packets.push({time:sec+frac/res,linkType,data:b.subarray(off+16,off+16+cap),origLen:orig});off+=16+cap;
 }
 return {format:res===1e9?'pcap-ns':'pcap',packets,notes};
}
function readPcapng(b,dv){
 const packets=[],notes={truncated:0,simplePackets:0,skippedBlocks:0};let off=0,le=true,ifaces=[];
 while(off+12<=b.length){
  const type=dv.getUint32(off,le);
  if(type===0x0a0d0d0a){
   if(dv.getUint32(off+8,true)===0x1a2b3c4d)le=true;else if(dv.getUint32(off+8,false)===0x1a2b3c4d)le=false;else throw new Error('Bad pcapng byte-order magic');
   ifaces=[];
  }
  const len=dv.getUint32(off+4,le);
  if(len<12||len%4||off+len>b.length){notes.truncated++;break;}
  const body=off+8,end=off+len-4;
  if(type===1){
   const iface={linkType:dv.getUint16(body,le),snaplen:dv.getUint32(body+4,le),resol:1e6,offset:0};
   for(let o=body+8;o+4<=end;){
    const code=dv.getUint16(o,le),olen=dv.getUint16(o+2,le);if(code===0)break;
    if(code===9&&olen>=1){const v=b[o+4];iface.resol=v&0x80?2**(v&0x7f):10**v;}
    if(code===14&&olen>=8)iface.offset=Number(dv.getBigInt64(o+4,le));
    o+=4+((olen+3)&~3);
   }
   ifaces.push(iface);
  }else if(type===6||type===2){
   const enhanced=type===6,id=enhanced?dv.getUint32(body,le):dv.getUint16(body,le),iface=ifaces[id];
   const ts=(BigInt(dv.getUint32(body+4,le))<<32n)|BigInt(dv.getUint32(body+8,le)),cap=dv.getUint32(body+12,le),orig=dv.getUint32(body+16,le);
   if(!iface||body+20+cap>end){notes.truncated++;off+=len;continue;}
   const r=BigInt(Math.round(iface.resol));
   packets.push({time:Number(ts/r)+Number(ts%r)/iface.resol+iface.offset,linkType:iface.linkType,data:b.subarray(body+20,body+20+cap),origLen:orig,iface:id});
  }else if(type===3){
   const iface=ifaces[0],orig=dv.getUint32(body,le),cap=Math.min(orig,end-body-4,iface?.snaplen||Infinity);
   notes.simplePackets++;
   if(iface)packets.push({time:null,linkType:iface.linkType,data:b.subarray(body+4,body+4+cap),origLen:orig,iface:0});
  }else if(type!==0x0a0d0d0a)notes.skippedBlocks++;
  off+=len;
 }
 // Simple packet blocks have no timestamp: give them the previous packet's time so ordering survives.
 let last=0;for(const p of packets){if(p.time===null)p.time=last;last=p.time;}
 return {format:'pcapng',packets,notes};
}

const pad4=n=>(n+3)&~3;
// pcapng with one interface and microsecond timestamps (the Wireshark default), built incrementally.
export class PcapngWriter{
 constructor({linkType=LINKTYPE.NULL,snaplen=262144}={}){
  this.linkType=linkType;this.chunks=[];
  const shb=new DataView(new ArrayBuffer(28));
  shb.setUint32(0,0x0a0d0d0a,true);shb.setUint32(4,28,true);shb.setUint32(8,0x1a2b3c4d,true);shb.setUint16(12,1,true);shb.setUint16(14,0,true);shb.setBigInt64(16,-1n,true);shb.setUint32(24,28,true);
  const idb=new DataView(new ArrayBuffer(20));
  idb.setUint32(0,1,true);idb.setUint32(4,20,true);idb.setUint16(8,linkType,true);idb.setUint32(12,snaplen,true);idb.setUint32(16,20,true);
  this.chunks.push(new Uint8Array(shb.buffer),new Uint8Array(idb.buffer));this.count=0;
 }
 add(timeSeconds,frame){
  const len=32+pad4(frame.length),blk=new Uint8Array(len),v=new DataView(blk.buffer),ts=BigInt(Math.round(timeSeconds*1e6));
  v.setUint32(0,6,true);v.setUint32(4,len,true);v.setUint32(8,0,true);v.setUint32(12,Number(ts>>32n),true);v.setUint32(16,Number(ts&0xffffffffn),true);
  v.setUint32(20,frame.length,true);v.setUint32(24,frame.length,true);blk.set(frame,28);v.setUint32(len-4,len,true);
  this.chunks.push(blk);this.count++;return this;
 }
 addUdp(timeSeconds,udp){return this.add(timeSeconds,buildUdpFrame({linkType:this.linkType,...udp}));}
 toBytes(){return concat(this.chunks);}
}
// Classic pcap: packets [{time, data}] for one link type.
export function writePcap(packets,{linkType=LINKTYPE.ETHERNET,nanos=false,bigEndian=false,snaplen=262144}={}){
 const le=!bigEndian,res=nanos?1e9:1e6,parts=[],h=new DataView(new ArrayBuffer(24));
 h.setUint32(0,nanos?0xa1b23c4d:0xa1b2c3d4,le);h.setUint16(4,2,le);h.setUint16(6,4,le);h.setUint32(16,snaplen,le);h.setUint32(20,linkType,le);parts.push(new Uint8Array(h.buffer));
 for(const p of packets){
  const r=new DataView(new ArrayBuffer(16)),sec=Math.floor(p.time);
  r.setUint32(0,sec,le);r.setUint32(4,Math.min(res-1,Math.round((p.time-sec)*res)),le);r.setUint32(8,p.data.length,le);r.setUint32(12,p.data.length,le);
  parts.push(new Uint8Array(r.buffer),p.data);
 }
 return concat(parts);
}

// ---------------------------------------------------------------- link, IP and UDP layers

function parseIpv6(s){
 const [head,tail]=s.includes('::')?s.split('::'):[s,null],words=x=>x?x.split(':').map(w=>parseInt(w,16)):[];
 const a=words(head),c=tail===null?[]:words(tail),all=[...a,...new Array(8-a.length-c.length).fill(0),...c];
 if(all.length!==8||all.some(w=>!(w>=0&&w<=0xffff)))throw new Error('Bad IPv6 address '+s);
 return Uint8Array.from(all.flatMap(w=>[w>>8,w&255]));
}
function formatIpv6(b){
 const w=[];for(let i=0;i<16;i+=2)w.push((b[i]<<8)|b[i+1]);
 let best=[-1,0];for(let i=0;i<8;){if(w[i]){i++;continue;}let j=i;while(j<8&&!w[j])j++;if(j-i>best[1]&&j-i>1)best=[i,j-i];i=j;}
 const h=x=>x.map(v=>v.toString(16)).join(':');
 return best[0]<0?h(w):h(w.slice(0,best[0]))+'::'+h(w.slice(best[0]+best[1]));
}
const parseAddress=s=>s.includes(':')?parseIpv6(s):Uint8Array.from(s.split('.').map(Number));
const formatAddress=b=>b.length===4?[...b].join('.'):formatIpv6(b);
export const endpoint=(address,port)=>(address.includes(':')?`[${address}]`:address)+':'+port;
function checksum(...parts){let s=0;for(const p of parts)for(let i=0;i<p.length;i+=2)s+=(p[i]<<8)|(p[i+1]??0);while(s>0xffff)s=(s&0xffff)+(s>>>16);return (~s)&0xffff;}

// One UDP datagram as a frame of the given link type (IPv4 or IPv6 from the address format).
export function buildUdpFrame({linkType=LINKTYPE.NULL,src,dst,srcPort,dstPort,payload,ipId=0}){
 const s=parseAddress(src),d=parseAddress(dst),v6=s.length===16;
 const udp=new Uint8Array(8+payload.length),u=new DataView(udp.buffer);
 u.setUint16(0,srcPort);u.setUint16(2,dstPort);u.setUint16(4,udp.length);udp.set(payload,8);
 let ip;
 if(v6){
  const pseudo=new Uint8Array(40);pseudo.set(s,0);pseudo.set(d,16);new DataView(pseudo.buffer).setUint32(32,udp.length);pseudo[39]=17;
  u.setUint16(6,checksum(pseudo,udp)||0xffff);
  ip=new Uint8Array(40+udp.length);const v=new DataView(ip.buffer);v.setUint32(0,0x60000000);v.setUint16(4,udp.length);ip[6]=17;ip[7]=64;ip.set(s,8);ip.set(d,24);ip.set(udp,40);
 }else{
  ip=new Uint8Array(20+udp.length);const v=new DataView(ip.buffer);
  ip[0]=0x45;v.setUint16(2,ip.length);v.setUint16(4,ipId&0xffff);ip[8]=128;ip[9]=17;ip.set(s,12);ip.set(d,16);v.setUint16(10,checksum(ip.subarray(0,20)));ip.set(udp,20);
 }
 const etherType=v6?0x86dd:0x0800;let head;
 switch(linkType){
  case LINKTYPE.NULL:head=new Uint8Array(4);new DataView(head.buffer).setUint32(0,v6?24:2,true);break;
  case LINKTYPE.LOOP:head=new Uint8Array(4);new DataView(head.buffer).setUint32(0,v6?24:2,false);break;
  case LINKTYPE.ETHERNET:head=Uint8Array.of(0,0x0c,0x29,0,0,2,0,0x50,0x56,0xc0,0,1,etherType>>8,etherType&255);break;
  case LINKTYPE.LINUX_SLL:head=Uint8Array.of(0,0,0x03,0x04,0,6,0,0,0,0,0,0,0,0,etherType>>8,etherType&255);break;
  case LINKTYPE.LINUX_SLL2:head=Uint8Array.of(etherType>>8,etherType&255,0,0,0,0,0,1,0x03,0x04,0,6,0,0,0,0,0,0,0,0);break;
  case LINKTYPE.RAW:case LINKTYPE.IPV4:case LINKTYPE.IPV6:head=new Uint8Array(0);break;
  default:throw new Error('Unsupported link type '+linkType);
 }
 return concat([head,ip]);
}

// Offset of the IP header inside a frame, or -1 for non-IP frames.
function ipOffset(linkType,f){
 const be16=o=>o+2<=f.length?(f[o]<<8)|f[o+1]:-1,ipType=t=>t===0x0800||t===0x86dd;
 switch(linkType){
  case LINKTYPE.NULL:case LINKTYPE.LOOP:return f.length>4?4:-1; // family value differs per OS; the IP version nibble decides
  case LINKTYPE.ETHERNET:{let o=12,t=be16(o);while(t===0x8100||t===0x88a8||t===0x9100){o+=4;t=be16(o);}return ipType(t)?o+2:-1;}
  case LINKTYPE.LINUX_SLL:return ipType(be16(14))?16:-1;
  case LINKTYPE.LINUX_SLL2:return ipType(be16(0))?20:-1;
  default:if(RAW_LINKS.has(linkType))return 0;throw new Error('Unsupported link type '+linkType);
 }
}

// Pulls UDP datagrams out of capture packets, reassembling IPv4 fragments. Returns {datagrams, notes}.
export function extractUdp(capture){
 const datagrams=[],notes={nonIp:0,nonUdp:0,ipFragmentsReassembled:0,ipFragmentsIncomplete:0,ipv6Fragments:0,unsupportedLinks:[]},frags=new Map();
 const udp=(time,src,dst,seg)=>{
  if(seg.length<8)return;const v=new DataView(seg.buffer,seg.byteOffset,seg.byteLength),len=v.getUint16(4);
  datagrams.push({time,src:formatAddress(src),dst:formatAddress(dst),srcPort:v.getUint16(0),dstPort:v.getUint16(2),payload:seg.subarray(8,len>=8&&len<=seg.length?len:seg.length)});
 };
 for(const p of capture.packets){
  let off;try{off=ipOffset(p.linkType,p.data);}catch{if(!notes.unsupportedLinks.includes(p.linkType))notes.unsupportedLinks.push(p.linkType);continue;}
  if(off<0||off>=p.data.length){notes.nonIp++;continue;}
  const f=p.data.subarray(off),version=f[0]>>4;
  if(version===4&&f.length>=20){
   const v=new DataView(f.buffer,f.byteOffset,f.byteLength),ihl=(f[0]&15)*4,total=v.getUint16(2)||f.length,fl=v.getUint16(6);
   const body=f.subarray(ihl,Math.min(total,f.length));
   if(f[9]!==17){notes.nonUdp++;continue;}
   const src=f.subarray(12,16),dst=f.subarray(16,20),more=(fl&0x2000)!==0,offset=(fl&0x1fff)*8;
   if(!more&&offset===0){udp(p.time,src,dst,body);continue;}
   const key=hex(src)+hex(dst)+v.getUint16(4);let g=frags.get(key);
   if(!g)frags.set(key,g={parts:[],size:-1,time:p.time});
   g.parts.push({offset,data:body});if(!more)g.size=offset+body.length;
   if(g.size>=0&&g.parts.reduce((n,x)=>n+x.data.length,0)>=g.size){
    const whole=new Uint8Array(g.size);for(const x of g.parts)whole.set(x.data.subarray(0,Math.max(0,g.size-x.offset)),x.offset);
    frags.delete(key);notes.ipFragmentsReassembled++;udp(p.time,src,dst,whole);
   }
  }else if(version===6&&f.length>=40){
   let nh=f[6],o=40;
   while(nh===0||nh===43||nh===60){if(o+2>f.length)break;nh=f[o];o+=(f[o+1]+1)*8;}
   if(nh===44){notes.ipv6Fragments++;continue;}
   if(nh!==17){notes.nonUdp++;continue;}
   udp(p.time,f.subarray(8,24),f.subarray(24,40),f.subarray(o,Math.min(f.length,40+((f[4]<<8)|f[5]))));
  }else notes.nonIp++;
 }
 notes.ipFragmentsIncomplete=frags.size;
 return {datagrams,notes};
}

// A UDP payload that starts with a Lidgren Connect for "uLink …" (how --port auto finds the server).
function connectAppId(payload){
 try{const {messages}=splitDatagram(payload),m=messages[0];if(m?.kind!==KIND.System||m.payload[0]!==SYSTEM.Connect)return null;const a=readConnect(new BitReader(m.payload,m.payload.length*8,8)).appId;return a.startsWith('uLink')?a:null;}catch{return null;}
}

// ---------------------------------------------------------------- Lidgren framing

// lidgren.mjs decodeDatagram, but reporting zero padding and undecodable trailing bytes instead of dropping them.
export function splitDatagram(bytes){
 const r=new BitReader(bytes),messages=[];let padding=0,trailing=null;
 while(r.remainingBytes>0){
  const start=r.pos>>3;let b;do{b=r.u8();if(b===0)padding++;}while(b===0&&r.remainingBytes>0);
  if(b===0)break;
  const at=(r.pos>>3)-1;
  if(r.remainingBytes<3){trailing=bytes.subarray(at);break;}
  const seq=r.u16();let len;try{len=r.varuint();}catch{trailing=bytes.subarray(at);break;}
  if(len>r.remainingBytes){trailing=bytes.subarray(at);break;}
  messages.push({kind:b&7,channel:b>>3,seq,payload:r.raw(len),offset:start});
 }
 return {messages,padding,trailing};
}

// ---------------------------------------------------------------- uLink header and bodies

// Inverse of ulink.mjs decodeHeader, for round-trip checks of decoded messages.
export function encodeHeader(h,w=new BitWriter()){
 const f=h.flags;w.u8(f);if(f&1)w.u16(h.sender);
 if((f&6)===2)w.u16(h.target);else if((f&6)===6)w.u16(h.other);
 if((f&24)===0)w.u8(h.internal);else if((f&24)===16)w.u16(h.viewId).u8(h.internal);else w.u16(h.viewId).string(h.rpc);
 if(f&96)w.writeBits(h.timestampLow,h.timestampBits);
 return w;
}
// Internal message bodies we know (ULINK-PROTOCOL.md, GAMEPLAY-PROTOCOL.md); anything else is reported undecoded.
const INTERNAL_BODIES={
 [INTERNAL.ClientConnectRequest]:{read:b=>{const r=readClientConnectRequest(b);return {requestedPlayerId:r.requestedPlayerId,...r.login};},write:(w,f)=>writeRustLogin(w.u16(f.requestedPlayerId),f)},
 [INTERNAL.ClientConnectResponse]:{
  read:b=>{const r=readClientConnectResponse(b);let worldInfo;try{worldInfo=readWorldInfo(r.approvalData);}catch{}return {...r,worldInfo};},
  write:(w,f)=>{w.u16(f.playerId).varuint(f.viewRanges.length);for(const [a,c] of f.viewRanges)w.u16(a).u16(c);w.u64(f.requestReceivedMs).u64(f.serverNowMs).blob(f.approvalData);},
 },
 [INTERNAL.ConnectDenied]:{read:b=>({error:b.i32()}),write:(w,f)=>w.i32(f.error)},
 [INTERNAL.Create]:{read:readCreate,write:(w,f)=>{w.u16(f.owner).u16(f.group);writeValue.vector3(w,f.position);writeValue.quaternion(w,f.rotation);w.string(f.proxyPrefab).string(f.ownerPrefab).string(f.serverPrefab).raw(f.initialData);}},
 [INTERNAL.DestroyByViewID]:{read:()=>({}),write:()=>{}},
 [INTERNAL.DestroyAll]:{read:()=>({}),write:()=>{}},
 [INTERNAL.DestroyByPlayerID]:{read:b=>({player:b.u16()}),write:(w,f)=>w.u16(f.player)},
 [INTERNAL.DestroyInGroup]:{read:b=>({group:b.u16()}),write:(w,f)=>w.u16(f.group)},
 [INTERNAL.DestroyInGroupByPlayerID]:{read:b=>({player:b.u16(),group:b.u16()}),write:(w,f)=>w.u16(f.player).u16(f.group)},
 [INTERNAL.ChangeGroup]:{read:b=>({viewId:b.u16(),group:b.u16()}),write:(w,f)=>w.u16(f.viewId).u16(f.group)},
 [INTERNAL.ResyncClockRequest]:{read:b=>({t0:b.u64()}),write:(w,f)=>w.u64(f.t0)},
 [INTERNAL.ResyncClockResponse]:{read:b=>({t0:b.u64(),t1:b.u64(),t2:b.u64()}),write:(w,f)=>w.u64(f.t0).u64(f.t1).u64(f.t2)},
};

// ---------------------------------------------------------------- classification

const CATEGORY_BY_CLASS={
 HumanController:'movement',uLinkStrictCharacter:'movement',uLinkStrictPlatformer:'movement',uLinkSmoothCharacter:'movement',FallDamage:'movement',
 Inventory:'inventory',PlayerInventory:'inventory',CraftingInventory:'inventory',InventoryHolder:'inventory',EquipmentWearer:'inventory',LootableObject:'inventory',WorkBench:'inventory',RepairBench:'inventory',ItemPickup:'inventory',
 ItemRepresentation:'combat',DeathTransfer:'combat',TimedExplosive:'combat',TimedGrenade:'combat',SignalGrenade:'combat',BasicTorchItemRep:'combat',TorchItemRep:'combat',
 ClientVitalsSync:'vitals',Metabolism:'vitals',Context:'context',
 BasicDoor:'world',StructureComponent:'world',StructureMaster:'world',DeployableObject:'world',LightSwitch:'world',FireBarrel:'world',ResourceObject:'world',RigidObj:'world',uLinkSmoothRigidbody:'world',SupplyCrate:'world',SupplyDropPlane:'world',EnvironmentControlCenter:'world',NGC:'world',
 BasicWildLifeAI:'wildlife',HostileWildlifeAI:'wildlife',ConsoleNetworker:'console',uLinkChatGUI:'console',VoiceCom:'voice',ServerManagement:'join',Controllable:'join',
};
const INTERNAL_CATEGORY={ClientConnectRequest:'login',ClientConnectResponse:'login',ConnectDenied:'login',ResyncClockRequest:'clock',ResyncClockResponse:'clock'};
export const PHASES=['handshake','login','join','play'];
export const DIR_LABEL={c2s:'C>S',s2c:'S>C'};

// ---------------------------------------------------------------- session decoding

function dirState(){return {datagrams:0,bytes:0,maxDatagram:0,multiMessage:0,messages:0,sent:new Map(),lastSeq:new Map(),seqGaps:0,outOfOrder:0,resends:0,resendDelays:[],duplicatesUnreliable:0,ackMessages:0,ackEntries:0,ackOnlyDatagrams:0,ackDelays:[],unseenAcks:0,frag:new Map(),fragmentGroups:0,maxFragmentChunk:0,maxUserPayload:0,framingMismatch:0,padding:0,pings:[],connects:[]};}

class SessionDecoder{
 constructor({id,client,server,start,ctx}){
  Object.assign(this,{id,client,server,start,ctx});this.end=start;
  this.events=[];this.dir={c2s:dirState(),s2c:dirState()};this.phase='handshake';this.state='connecting';
  this.views=new Map(Object.entries(SCENE_VIEWS).map(([k,v])=>[Number(k),{...v,scene:true}]));this.ngc=new Map();this.pingSent=new Map();this.rtts=[];
 }
 push(ev){ev.phase=this.phase;this.events.push(ev);return ev;}
 base(time,dir,dg,m){const e={t:Math.round((time-this.start)*1e6)/1e6,dir,dg};if(m){e.ch=m.channel;e.seq=m.seq;}return e;}
 datagram(time,dir,bytes){
  const d=this.dir[dir],dg=d.datagrams++;this.end=time;d.bytes+=bytes.length;d.maxDatagram=Math.max(d.maxDatagram,bytes.length);
  const {messages,padding,trailing}=splitDatagram(bytes);
  d.padding+=padding;d.messages+=messages.length;if(messages.length>1)d.multiMessage++;
  if(messages.length&&messages.every(m=>m.kind===KIND.Acknowledge))d.ackOnlyDatagrams++;
  if(trailing)this.push({...this.base(time,dir,dg),kind:'garbage',size:trailing.length,hex:hex(trailing,256),flag:'undecodable bytes at the end of the datagram'});
  if(!padding&&!trailing&&!sameBytes(concat(messages.map(m=>encodeMessage(m).toBytes())),bytes))d.framingMismatch++;
  for(const m of messages)this.message(time,dir,dg,m);
 }
 message(time,dir,dg,m){
  const d=this.dir[dir];
  if(m.kind===KIND.System)return this.system(time,dir,dg,m);
  if(m.kind===KIND.Acknowledge)return this.acks(time,dir,dg,m);
  if(m.kind!==KIND.User&&m.kind!==KIND.UserFragmented)return this.push({...this.base(time,dir,dg,m),kind:'unknown',lidgrenKind:KIND_NAME[m.kind]??m.kind,size:m.payload.length,hex:hex(m.payload,256),flag:'unhandled Lidgren message kind'});
  if(this.phase==='handshake'){this.phase='login';this.state='connected';}
  if(m.channel>0){
   const key=m.channel+':'+m.seq,prev=d.sent.get(key);
   if(prev&&sameBytes(prev.payload,m.payload)&&time-prev.first<60){
    if(m.channel<16){d.duplicatesUnreliable++;return;}
    prev.resends++;d.resends++;d.resendDelays.push(time-prev.last);
    this.push({...this.base(time,dir,dg,m),kind:'resend',n:prev.resends,since:Math.round((time-prev.last)*1e6)/1e6,acked:prev.acked});
    prev.last=time;return;
   }
   d.sent.set(key,{first:time,last:time,payload:m.payload,resends:0,acked:false,channel:m.channel});
   const last=d.lastSeq.get(m.channel);
   if(last!==undefined){const rel=relativeSeq(m.seq,nextSeq(last));if(rel>0)d.seqGaps++;else if(rel<0)d.outOfOrder++;}
   if(last===undefined||relativeSeq(m.seq,last)>0)d.lastSeq.set(m.channel,m.seq);
  }
  if(m.kind===KIND.UserFragmented)return this.fragment(time,dir,dg,m);
  d.maxUserPayload=Math.max(d.maxUserPayload,m.payload.length);
  this.ulink(time,dir,dg,m,m.payload);
 }
 fragment(time,dir,dg,m){
  const d=this.dir[dir],r=new BitReader(m.payload);let group,index,count,data;
  try{group=r.u16();index=r.varuint();count=r.varuint();data=r.raw(r.remainingBytes);}
  catch{return this.push({...this.base(time,dir,dg,m),kind:'unknown',lidgrenKind:'UserFragmented',hex:hex(m.payload,256),flag:'bad fragment header'});}
  const ev=this.push({...this.base(time,dir,dg,m),kind:'fragment',group,index,count,size:data.length});
  const key=m.channel+':'+group;let g=d.frag.get(key);
  if(!g){g={count,parts:new Map(),first:index};d.frag.set(key,g);d.fragmentGroups++;if(index===count-1&&count>1)ev.flag='first fragment seen is the last one: the native receiver drops this group (O1094 quirk)';}
  if(index<count-1)d.maxFragmentChunk=Math.max(d.maxFragmentChunk,data.length);
  g.parts.set(index,data);
  if(g.parts.size<g.count)return;
  d.frag.delete(key);
  const payload=concat([...Array(g.count).keys()].map(i=>g.parts.get(i)??new Uint8Array(0)));
  this.ulink(time,dir,dg,m,payload,{group,count:g.count});
 }
 system(time,dir,dg,m){
  const type=m.payload[0],name=SYSTEM_NAME[type]??'System'+type,body=new BitReader(m.payload,m.payload.length*8,8),ev={...this.base(time,dir,dg,m),kind:'system',type:name,size:m.payload.length},d=this.dir[dir];
  let fields={},encode=null;
  try{
   switch(type){
    case SYSTEM.Connect:{const c=readConnect(body);fields={appId:c.appId,signature:hex(c.signature),nonce:c.nonce,hailLength:c.hail.length};encode=()=>encodeSystem(type,connectBody(c));d.connects.push(time);if(this.state==='closed'){this.state='connecting';}break;}
    case SYSTEM.ConnectResponse:case SYSTEM.ConnectionEstablished:{const r=readResponse(body);fields={signature:hex(r.signature),nonce:r.nonce,peerSignature:hex(r.peerSignature),peerNonce:r.peerNonce,hailLength:r.hail.length};encode=()=>encodeSystem(type,responseBody(r));if(type===SYSTEM.ConnectionEstablished&&this.phase==='handshake'){this.phase='login';this.state='connected';}break;}
    case SYSTEM.ConnectionRejected:case SYSTEM.Disconnect:{const reason=body.remainingBytes?body.string():undefined;fields={reason};encode=()=>encodeSystem(type,reason===undefined?new Uint8Array(0):reasonBody(reason));this.state='closed';break;}
    case SYSTEM.Ping:{const ms=body.u64(),date=body.remainingBytes>=8?body.i64():undefined;fields={ms,date};encode=()=>{const w=new BitWriter().u64(ms);if(date!==undefined)w.i64(date);return encodeSystem(type,w.toBytes());};this.pingSent.set(dir+ms,time);d.pings.push(time);break;}
    case SYSTEM.Pong:{const echo=body.u64(),ms=body.remainingBytes>=8?body.u64():undefined,date=body.remainingBytes>=8?body.i64():undefined;fields={echo,ms,date};encode=()=>{const w=new BitWriter().u64(echo);if(ms!==undefined)w.u64(ms);if(date!==undefined)w.i64(date);return encodeSystem(type,w.toBytes());};const other=dir==='c2s'?'s2c':'c2s',sent=this.pingSent.get(other+echo);if(sent!==undefined){this.pingSent.delete(other+echo);fields.rtt=Math.round((time-sent)*1e6)/1e6;this.rtts.push(time-sent);}break;}
    default:ev.flag='system message type not decoded';ev.hex=hex(m.payload,256);
   }
   if(encode&&body.remainingBits>0&&type!==SYSTEM.Connect)ev.trailing=hex(body.raw(body.remainingBytes),64);
  }catch(e){ev.flag='system message failed to decode: '+e.message;ev.hex=hex(m.payload,256);encode=null;}
  if(encode&&this.ctx.verify){const again=encode(),orig=encodeMessage(m).toBytes();ev.roundTrip=sameBytes(again,orig)?'ok':'mismatch';if(ev.roundTrip==='mismatch')ev.reencoded=hex(again,256);}
  Object.assign(ev,{fields});ev.key=`${DIR_LABEL[dir]} sys ${name}`;ev.category='transport';
  this.push(ev);
 }
 acks(time,dir,dg,m){
  const d=this.dir[dir],other=this.dir[dir==='c2s'?'s2c':'c2s'],ev={...this.base(time,dir,dg,m),kind:'ack',acks:[]};d.ackMessages++;
  if(m.payload.length%3){ev.flag='ack payload length is not a multiple of 3 (receiver rejects it)';ev.hex=hex(m.payload,256);}
  for(let i=0;i+3<=m.payload.length;i+=3){
   const channel=m.payload[i],seq=m.payload[i+1]|(m.payload[i+2]<<8);ev.acks.push(channel+'#'+seq);d.ackEntries++;
   if(channel<16){ev.flag='ack for an unreliable channel (ignored by the receiver)';continue;}
   const s=other.sent.get(channel+':'+seq);
   if(!s){d.unseenAcks++;continue;}
   if(!s.acked){s.acked=true;d.ackDelays.push(time-s.last);}
  }
  this.push(ev);
 }
 ulink(time,dir,dg,m,payload,fragmented){
  const ev={...this.base(time,dir,dg,m),kind:'ulink',size:payload.length};
  if(fragmented)ev.fragmented=fragmented;
  let header,body;
  try{({header,body}=decodeHeader(payload));}
  catch(e){Object.assign(ev,{decoded:false,flag:'bad uLink header: '+e.message,hex:hex(payload,256),key:`${DIR_LABEL[dir]} ulink ?`,category:'unknown'});return this.push(ev);}
  ev.flags='0x'+header.flags.toString(16).padStart(2,'0');ev.target=header.target;
  if(header.sender!==undefined)ev.sender=header.sender;if(header.other!==undefined)ev.other=header.other;
  if(header.viewId!==undefined)ev.viewId=header.viewId;
  if(header.timestampBits){ev.tsBits=header.timestampBits;ev.tsLow=header.timestampLow;}
  ev.typeSafe=header.typeSafe;
  let writeBody=null;
  if(header.rpc!==undefined)writeBody=this.rpc(ev,header,body,dir);else writeBody=this.internal(ev,header,body,dir);
  if(writeBody&&this.ctx.verify){
   const w=encodeHeader(header);let again;
   try{writeBody(w);again=w.toBytes();}catch(e){again=null;ev.reencodeError=e.message;}
   ev.roundTrip=again&&sameBytes(again,payload)?'ok':'mismatch';
   if(ev.roundTrip==='mismatch'){ev.hex=hex(payload,512);if(again)ev.reencoded=hex(again,512);}
  }
  ev.category??='other';
  if(dir==='c2s'&&this.phase==='join'&&ev.name==='GetClientMove')this.phase='play'; // the first move opens the play phase
  this.push(ev);
  if(dir==='s2c'&&this.phase==='login'&&(ev.internal==='ClientConnectResponse'||ev.internal==='ConnectDenied'))this.phase='join';
 }
 internal(ev,header,body,dir){
  const type=header.internal,name=INTERNAL_NAME[type]??'Internal'+type,codec=INTERNAL_BODIES[type];
  ev.internal=name;ev.category=INTERNAL_CATEGORY[name]??(name.startsWith('Destroy')||name==='Create'||name==='ChangeGroup'?'world':'ulink');
  ev.key=`${DIR_LABEL[dir]} ${name}`;
  if(!codec){Object.assign(ev,{decoded:false,flag:'internal message body not decoded',hex:hex(body.raw(body.remainingBytes),256)});return null;}
  let fields;
  try{fields=codec.read(body);}catch(e){Object.assign(ev,{decoded:false,flag:`${name} failed to decode: ${e.message}`,hex:hex(body.bytes,256)});return null;}
  ev.fields=fields;ev.decoded=true;
  let rest=null;if(body.remainingBits>0){ev.flag=`${body.remainingBits} bits left after the ${name} body`;rest=body.raw(body.remainingBytes);ev.trailing=hex(rest,128);}
  if(type===INTERNAL.Create&&header.viewId!==undefined){
   const v={prefab:fields.proxyPrefab,owner:fields.owner,group:fields.group};this.views.set(header.viewId,v);
   const mine=this.playerId!==undefined&&fields.owner===this.playerId;ev.prefab=mine?fields.ownerPrefab:fields.proxyPrefab;ev.key+=' '+fields.proxyPrefab;
   if(fields.proxyPrefab===':player_soldier'||fields.proxyPrefab===':client'||/ServerManagement$/.test(fields.proxyPrefab))ev.category='join';
  }
  if(type===INTERNAL.ClientConnectResponse)this.playerId=fields.playerId;
  if(type===INTERNAL.DestroyByViewID){this.views.delete(header.viewId);for(const k of [...this.ngc.keys()])if(k.startsWith(header.viewId+':'))this.ngc.delete(k);}
  return w=>{codec.write(w,fields);if(rest)w.raw(rest);};
 }
 rpc(ev,header,body,dir){
  // Carrier RPCs go by their first character ("A1f" is NGC.A), as NGCInternalView.OnRPC does.
  const view=this.views.get(header.viewId),name=header.rpc,action=view?.prefab===NGC_CARRIER?ngcAction(name):null,[cls,method]=action?['NGC',action]:name.includes(':')?name.split(':',2):[null,name];
  ev.name=name;if(view)ev.prefab=view.prefab;
  const ok=dir==='c2s'?x=>x!=='to-client':x=>x!=='to-server';
  let handlers=(this.ctx.schema[method]??[]).filter(h=>ok(h.direction)&&(!cls||h.class===cls));
  if(!action&&view?.class)handlers=[...handlers.filter(h=>h.class===view.class),...handlers.filter(h=>h.class!==view.class)];
  const matches=[];
  for(const h of handlers){
   const r=new BitReader(body.bytes,body.end,body.pos);
   try{const values=readArgs(h.params,r,header.typeSafe);if(r.remainingBits===0)matches.push({h,values});}catch{}
  }
  if(!matches.length){
   const rest=body.raw(body.remainingBytes);
   Object.assign(ev,{decoded:false,hex:hex(rest,512),flag:handlers.length?'arguments do not match any schema handler':'RPC name not in rpc-schema.json',key:`${DIR_LABEL[dir]} rpc ${name}`,category:CATEGORY_BY_CLASS[cls]??'other'});
   return null;
  }
  const {h,values}=matches[0];
  Object.assign(ev,{decoded:true,class:h.class,params:h.params,args:values,key:`${DIR_LABEL[dir]} rpc ${name}`,category:CATEGORY_BY_CLASS[h.class]??'other'});
  if(matches.length>1)ev.ambiguous=matches.map(x=>x.h.class);
  if(h.class==='ServerManagement'&&method==='RS')ev.category='clock';
  if(name==='GetClientMove'||name==='ReadClientMove'){ev.angles=decodeAngles(values[1]);ev.parity=values[2]&0x6000;}
  let ngcCheck=null;
  if(h.class==='NGC')ngcCheck=this.ngcRpc(ev,method,values,header.viewId,dir);
  return w=>{writeArgs(h.params,values,w,header.typeSafe);if(ngcCheck&&!ngcCheck())ev.ngc.roundTrip='mismatch';else if(ngcCheck)ev.ngc.roundTrip='ok';};
 }
 // NGC A/C/D on a carrier view (GAMEPLAY-PROTOCOL.md "NGC in detail"); names come from the NGC registry.
 ngcRpc(ev,name,values,carrier,dir){
  const registry=this.ctx.prefabByIndex;
  if(name==='A'){
   let n;try{n=readNgcInstantiate(values[0]);}catch(e){ev.ngc={op:'create',decoded:false,flag:e.message};return null;}
   const prefab=registry.get(n.prefabIndex);this.ngc.set(carrier+':'+n.innerID,{prefab,prefabIndex:n.prefabIndex});
   ev.ngc={op:'create',innerID:n.innerID,prefabIndex:n.prefabIndex,handle:prefab?.handle??null,position:n.position,euler:n.euler,initialData:n.initialData};
   ev.key=`${DIR_LABEL[dir]} ngc-create ${prefab?.handle??'#'+n.prefabIndex}`;
   if(!prefab)ev.flag='NGC prefab index not in the registry';
   return ()=>sameBytes(writeNgcInstantiate(n),values[0]);
  }
  if(name==='D'){const e=this.ngc.get(carrier+':'+values[0]);this.ngc.delete(carrier+':'+values[0]);ev.ngc={op:'destroy',innerID:values[0],handle:e?.prefab?.handle??null};ev.key=`${DIR_LABEL[dir]} ngc-destroy`;return null;}
  let c;try{c=readNgcCall(values[0]);}catch(e){ev.ngc={op:'call',decoded:false,flag:e.message};return null;}
  const entity=this.ngc.get(carrier+':'+c.innerID),message=entity?.prefab?.messages?.[c.messageID];
  ev.ngc={op:'call',innerID:c.innerID,messageID:c.messageID,handle:entity?.prefab?.handle??null,class:message?.class??null,method:message?.name??null};
  if(message)ev.category=CATEGORY_BY_CLASS[message.class]??'world';
  ev.key=message?`${DIR_LABEL[dir]} ngc ${message.class}.${message.name}`:`${DIR_LABEL[dir]} ngc ${entity?.prefab?.handle??(entity?'#'+entity.prefabIndex:'?')}#${c.messageID}`;
  if(!message){ev.ngc.decoded=false;ev.ngc.hex=hex(c.args,256);ev.flag=entity?'NGC message id not in the registry for this prefab':'NGC call for an entity this capture never created';return null;}
  const r=new BitReader(c.args);let args;
  try{args=readArgs(message.params,r);if(r.remainingBits)throw new Error(r.remainingBits+' bits left');}
  catch(e){ev.ngc.decoded=false;ev.ngc.hex=hex(c.args,256);ev.flag='NGC arguments do not match '+message.name+'('+message.params.join(', ')+'): '+e.message;return null;}
  Object.assign(ev.ngc,{decoded:true,params:message.params,args});
  return ()=>sameBytes(writeNgcCall({innerID:c.innerID,messageID:c.messageID,args:writeArgs(message.params,args).toBytes()}),values[0]);
 }
 finish(){
  for(const dir of ['c2s','s2c']){const d=this.dir[dir];d.unacked=[...d.sent.values()].filter(s=>s.channel>=16&&!s.acked).length;d.incompleteFragmentGroups=d.frag.size;}
 }
}

// Decode a capture (bytes) into sessions. options: port (number | 'auto'), peer ('ip' or 'ip:port' of either side),
// schema (rpc-schema.json object), registry (NGC registry object), verify (re-encode every decoded message).
export function decodeCapture(bytes,{port=DEFAULT_SERVER_PORT,peer,schema={},registry,verify=true}={}){
 const capture=readCapture(bytes),{datagrams,notes}=extractUdp(capture);
 let ports=port==='auto'?null:new Set([Number(port)]);
 if(ports&&!datagrams.some(d=>ports.has(d.srcPort)||ports.has(d.dstPort))&&port===DEFAULT_SERVER_PORT)ports=null; // fall back to detection
 if(!ports){ports=new Set();for(const d of datagrams)if(connectAppId(d.payload))ports.add(d.dstPort);}
 const peerMatch=peer?((p=>d=>[endpoint(d.src,d.srcPort),endpoint(d.dst,d.dstPort),d.src,d.dst].includes(p))(peer)):()=>true;
 const ctx={schema,verify,prefabByIndex:new Map((registry?.prefabs??[]).map(p=>[p.index,p]))};
 const sessions=[],open=new Map();let other=0;
 for(const d of datagrams){
  const c2s=ports.has(d.dstPort)&&!ports.has(d.srcPort)?true:ports.has(d.srcPort)?false:null;
  if(c2s===null||!peerMatch(d)){other++;continue;}
  const client=c2s?endpoint(d.src,d.srcPort):endpoint(d.dst,d.dstPort),server=c2s?endpoint(d.dst,d.dstPort):endpoint(d.src,d.srcPort),key=client+'>'+server;
  let s=open.get(key);
  if(c2s&&s&&s.state!=='connecting'&&connectAppId(d.payload)){s.finish();s=null;}
  if(!s){s=new SessionDecoder({id:sessions.length+1,client,server,start:d.time,ctx});sessions.push(s);open.set(key,s);}
  s.datagram(d.time,c2s?'c2s':'s2c',d.payload);
 }
 for(const s of open.values())s.finish();
 return {format:capture.format,packets:capture.packets.length,linkTypes:[...new Set(capture.packets.map(p=>p.linkType))],serverPorts:[...ports],otherDatagrams:other,notes:{...capture.notes,...notes},sessions:sessions.map(sessionResult)};
}
function sessionResult(s){
 const stat=d=>({datagrams:d.datagrams,bytes:d.bytes,maxDatagram:d.maxDatagram,messages:d.messages,multiMessageDatagrams:d.multiMessage,padding:d.padding,framingMismatches:d.framingMismatch,
  maxUserPayload:d.maxUserPayload,fragmentGroups:d.fragmentGroups,maxFragmentChunk:d.maxFragmentChunk,inferredMtu:d.maxFragmentChunk?d.maxFragmentChunk+10:null,incompleteFragmentGroups:d.incompleteFragmentGroups,
  resends:d.resends,resendDelay:dist(d.resendDelays),duplicatesUnreliable:d.duplicatesUnreliable,seqGaps:d.seqGaps,outOfOrder:d.outOfOrder,
  ackMessages:d.ackMessages,ackEntries:d.ackEntries,ackOnlyDatagrams:d.ackOnlyDatagrams,ackDelay:dist(d.ackDelays),unseenAcks:d.unseenAcks,unackedAtEnd:d.unacked,
  pingInterval:dist(diffs(d.pings)),connectAttempts:d.connects.length,connectRetryInterval:dist(diffs(d.connects))});
 const issues={unknown:0,undecoded:0,roundTripMismatch:0,garbage:0,flagged:0};
 for(const e of s.events){if(e.kind==='unknown')issues.unknown++;if(e.kind==='garbage')issues.garbage++;if(e.decoded===false||e.ngc?.decoded===false)issues.undecoded++;if(e.roundTrip==='mismatch'||e.ngc?.roundTrip==='mismatch')issues.roundTripMismatch++;if(e.flag)issues.flagged++;}
 return {id:s.id,client:s.client,server:s.server,start:s.start,duration:Math.round((s.end-s.start)*1e6)/1e6,playerId:s.playerId,finalPhase:s.phase,state:s.state,
  stats:{c2s:stat(s.dir.c2s),s2c:stat(s.dir.s2c),rtt:dist(s.rtts)},issues,events:s.events};
}
const diffs=a=>a.slice(1).map((x,i)=>x-a[i]);
function dist(values){
 if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),q=p=>v[Math.min(v.length-1,Math.floor(p*(v.length-1)+0.5))],r=x=>Math.round(x*1e6)/1e6;
 return {n:v.length,min:r(v[0]),p10:r(q(0.1)),median:r(q(0.5)),p90:r(q(0.9)),max:r(v.at(-1))};
}

// ---------------------------------------------------------------- output

// JSON-safe copy: bigint → string, bytes → hex (bounded).
export const toJsonValue=v=>JSON.parse(JSON.stringify(v,(k,x)=>typeof x==='bigint'?x.toString():x instanceof Uint8Array?{bytes:x.length,hex:hex(x,512)}:x));

const num=x=>typeof x==='number'?(Number.isInteger(x)?String(x):String(Math.round(x*1e4)/1e4)):String(x);
function value(v){
 if(v===undefined)return '-';if(v===null)return 'null';
 if(typeof v==='bigint'||typeof v==='number')return num(v);
 if(typeof v==='string')return JSON.stringify(v);
 if(typeof v==='boolean')return String(v);
 if(v instanceof Uint8Array)return `<${v.length}B ${hex(v,24)}>`;
 if(Array.isArray(v))return '['+v.map(value).join(',')+']';
 return '{'+Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>k+':'+value(x)).join(' ')+'}';
}
export function formatEvent(e){
 const head=`${e.t.toFixed(6).padStart(11)} ${DIR_LABEL[e.dir]} ${e.ch===undefined?'      ':('ch'+e.ch).padEnd(5)+' '}${e.seq===undefined||e.kind==='system'?'      ':('#'+e.seq).padEnd(6)} `;
 let body;
 switch(e.kind){
  case 'system':body=`sys ${e.type} ${Object.entries(e.fields??{}).filter(([,x])=>x!==undefined).map(([k,x])=>k+'='+value(x)).join(' ')}`;break;
  case 'ack':body=`ack ${e.acks.join(' ')}`;break;
  case 'resend':body=`resend #${e.n} after ${num(e.since)}s${e.acked?' (already acked)':''}`;break;
  case 'fragment':body=`fragment group ${e.group} part ${e.index+1}/${e.count} ${e.size}B`;break;
  case 'garbage':body=`?? ${e.size} undecodable bytes ${e.hex}`;break;
  case 'unknown':body=`?? ${e.lidgrenKind} ${e.size}B ${e.hex}`;break;
  case 'ulink':{
   const ts=e.tsBits?` ts${e.tsBits}`:'',frag=e.fragmented?` [${e.fragmented.count} fragments]`:'',tgt=typeof e.target==='number'?` ->p${e.target}`:'';
   if(e.internal){body=`${e.internal}${e.viewId!==undefined?' view '+e.viewId:''}${e.prefab?' '+JSON.stringify(e.prefab):''} ${e.flags}${tgt}${ts}${frag} ${e.decoded===false?'?? '+e.hex:value(e.fields)}`;break;}
   const args=e.decoded===false?'?? '+e.hex:e.ngc?ngcText(e.ngc):'('+(e.args??[]).map(value).join(', ')+')';
   const extra=e.angles?` angles=${value(e.angles)} parity=0x${e.parity.toString(16)}`:'';
   body=`rpc ${e.name}@${e.viewId}${e.prefab?' '+JSON.stringify(e.prefab):''}${e.class?' '+e.class:''} ${e.flags}${tgt}${ts}${frag} ${args}${extra}`;
   break;
  }
  default:body=e.kind;
 }
 const marks=[e.roundTrip==='mismatch'||e.ngc?.roundTrip==='mismatch'?'ROUND-TRIP MISMATCH'+(e.reencoded?' re-encoded '+e.reencoded:''):null,e.flag,e.ambiguous?'ambiguous: '+e.ambiguous.join('/'):null].filter(Boolean);
 return head+body+(marks.length?'   !! '+marks.join('; '):'');
}
function ngcText(n){
 if(n.op==='create')return `NGC create ${n.handle??'#'+n.prefabIndex} inner ${n.innerID} pos ${value(n.position)} euler ${value(n.euler)}${n.initialData?.length?' data '+value(n.initialData):''}`;
 if(n.op==='destroy')return `NGC destroy inner ${n.innerID}${n.handle?' '+n.handle:''}`;
 return `NGC call ${n.handle??'?'} inner ${n.innerID} msg ${n.messageID}${n.method?' '+n.class+'.'+n.method:''} ${n.decoded===false?'?? '+(n.hex??''):'('+(n.args??[]).map(value).join(', ')+')'}`;
}
export function formatSession(s,{all=false}={}){
 const lines=[`Session ${s.id}: client ${s.client} -> server ${s.server}, start ${new Date(s.start*1000).toISOString()}, ${s.duration}s, player ${s.playerId??'-'}, ended in ${s.finalPhase}/${s.state}`];
 lines.push(`  issues: ${Object.entries(s.issues).map(([k,v])=>k+'='+v).join(' ')}`);
 for(const dir of ['c2s','s2c']){const st=s.stats[dir];lines.push(`  ${DIR_LABEL[dir]}: ${st.datagrams} datagrams (max ${st.maxDatagram}B), ${st.messages} messages, resends ${st.resends}, acks ${st.ackEntries} in ${st.ackMessages} messages (delay median ${st.ackDelay?.median??'-'}s), fragment groups ${st.fragmentGroups}${st.inferredMtu?' (MTU '+st.inferredMtu+')':''}, ping every ${st.pingInterval?.median??'-'}s`);}
 lines.push('','       t(s) dir ch    seq    message');
 let phase=null;
 for(const e of s.events){
  if(!all&&(e.kind==='ack'||e.kind==='fragment')&&!e.flag)continue;
  if(e.phase!==phase){phase=e.phase;lines.push(`  --- ${phase} ---`);}
  lines.push(formatEvent(e));
 }
 return lines.join('\n');
}
export function formatDecode(result,{all=false,sessions}={}){
 const head=[`${result.format}, ${result.packets} packets, link types ${result.linkTypes.join(',')}, server ports ${result.serverPorts.join(',')||'none found'}, ${result.sessions.length} session(s), ${result.otherDatagrams} other datagrams`];
 const n=Object.entries(result.notes).filter(([,v])=>Array.isArray(v)?v.length:v);if(n.length)head.push('notes: '+n.map(([k,v])=>k+'='+v).join(' '));
 return [...head,'',...(sessions??result.sessions).map(s=>formatSession(s,{all}))].join('\n')+'\n';
}

// ---------------------------------------------------------------- profiles and comparison

function flatten(v,path,out){
 if(v===undefined||v===null)return;
 if(typeof v==='number'||typeof v==='boolean')out.push([path,typeof v==='boolean'?Number(v):v]);
 else if(typeof v==='bigint')out.push([path,v]);
 else if(typeof v==='string'||v instanceof Uint8Array)out.push([path+'.len',v.length]);
 else if(Array.isArray(v)){if(v.length<=4&&v.every(x=>typeof x==='number'))v.forEach((x,i)=>out.push([`${path}[${i}]`,x]));else{out.push([path+'.count',v.length]);for(const x of v.slice(0,16))flatten(x,path+'[]',out);}}
 else if(typeof v==='object')for(const [k,x] of Object.entries(v))flatten(x,path?path+'.'+k:k,out);
}
const SKIP_FIELDS=new Set(['signature','peerSignature','nonce','peerNonce','ms','echo','date','rtt','t0','t1','t2','requestReceivedMs','serverNowMs']);
function eventFields(e){
 const out=[];
 if(e.kind==='system')for(const [k,x] of Object.entries(e.fields??{}))if(!SKIP_FIELDS.has(k))flatten(x,k,out);
 if(e.fields&&e.kind==='ulink')for(const [k,x] of Object.entries(e.fields))if(!SKIP_FIELDS.has(k))flatten(x,k,out);
 if(e.args&&!e.ngc)e.args.forEach((x,i)=>{flatten(x,`${i}:${e.params[i]}`,out);if(e.params[i]==='ushort')out.push([`${i}:ushort.bits`,{or:x}]);});
 if(e.angles){out.push(['angles.pitch',e.angles.pitch],['angles.yaw',e.angles.yaw]);}
 if(e.ngc?.args)e.ngc.args.forEach((x,i)=>flatten(x,`${i}:${e.ngc.params[i]}`,out));
 if(e.ngc?.op==='create')flatten({position:e.ngc.position,initialData:e.ngc.initialData},'',out);
 return out;
}
// Summary of one decoded session used for comparison.
export function profileSession(s){
 const keys={},sequences={};
 for(const e of s.events){
  if(!e.key)continue;
  const k=keys[e.key]??={dir:e.dir,category:e.category,count:0,firstAt:e.t,firstPhase:e.phase,phases:{},channels:new Set(),flags:new Set(),tsBits:new Set(),classes:new Set(),params:new Set(),size:[Infinity,-Infinity],undecoded:0,roundTripMismatch:0,fragmented:0,times:[],fields:{}};
  k.count++;k.phases[e.phase]=(k.phases[e.phase]??0)+1;if(e.ch!==undefined)k.channels.add(e.ch);if(e.flags)k.flags.add(e.flags);k.tsBits.add(e.tsBits??0);
  if(e.class)k.classes.add(e.class);if(e.params)k.params.add(e.params.join(','));if(e.ngc?.params)k.params.add('ngc:'+e.ngc.params.join(','));
  if(e.size!==undefined){k.size[0]=Math.min(k.size[0],e.size);k.size[1]=Math.max(k.size[1],e.size);}
  if(e.decoded===false||e.ngc?.decoded===false)k.undecoded++;if(e.roundTrip==='mismatch'||e.ngc?.roundTrip==='mismatch')k.roundTripMismatch++;if(e.fragmented)k.fragmented++;
  k.times.push(e.t);
  for(const [path,v] of eventFields(e)){
   const f=k.fields[path];
   if(v&&typeof v==='object'&&'or' in v){k.fields[path]={or:(f?.or??0)|v.or,and:(f?f.and:0xffff)&v.or};continue;}
   if(!f)k.fields[path]={min:v,max:v};else{if(v<f.min)f.min=v;if(v>f.max)f.max=v;}
  }
  if(e.kind==='system'&&(e.type==='Ping'||e.type==='Pong'))continue; // periodic: compared by interval, not order
  const seq=e.phase==='play'?e.category:e.phase;
  const list=sequences[seq]??=[];const last=list.at(-1);
  if(last?.key===e.key)last.n++;else if(list.length<400)list.push({key:e.key,n:1});
 }
 for(const k of Object.values(keys)){
  for(const f of ['channels','flags','tsBits','classes','params'])k[f]=[...k[f]].sort();
  if(k.size[0]===Infinity)k.size=null;k.interval=dist(diffs(k.times));delete k.times;
 }
 return {session:{id:s.id,client:s.client,server:s.server,duration:s.duration,playerId:s.playerId},stats:s.stats,issues:s.issues,keys,sequences};
}

// LCS alignment of two collapsed key sequences: [{op:'=', a, b} | {op:'-', a} | {op:'+', b}].
function align(a,b){
 const n=a.length,m=b.length,L=Array.from({length:n+1},()=>new Uint16Array(m+1));
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=a[i].key===b[j].key?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
 const out=[];let i=0,j=0;
 while(i<n&&j<m){if(a[i].key===b[j].key){out.push({op:'=',a:a[i++],b:b[j++]});}else if(L[i+1][j]>=L[i][j+1])out.push({op:'-',a:a[i++]});else out.push({op:'+',b:b[j++]});}
 while(i<n)out.push({op:'-',a:a[i++]});while(j<m)out.push({op:'+',b:b[j++]});
 return out;
}
const PROTOCOL_FIELDS=[
 ['maxDatagram',s=>s.maxDatagram],['inferredMtu',s=>s.inferredMtu],['maxUserPayload',s=>s.maxUserPayload],['fragmentGroups',s=>s.fragmentGroups],['messagesPerDatagram',s=>s.datagrams?Math.round(s.messages/s.datagrams*100)/100:null],
 ['multiMessageDatagrams',s=>s.multiMessageDatagrams],['ackOnlyDatagrams',s=>s.ackOnlyDatagrams],['ackEntriesPerAckMessage',s=>s.ackMessages?Math.round(s.ackEntries/s.ackMessages*100)/100:null],['ackDelayMedian',s=>s.ackDelay?.median??null],
 ['resends',s=>s.resends],['resendDelayMedian',s=>s.resendDelay?.median??null],['unseenAcks',s=>s.unseenAcks],['unackedAtEnd',s=>s.unackedAtEnd],['seqGaps',s=>s.seqGaps],['outOfOrder',s=>s.outOfOrder],
 ['padding',s=>s.padding],['framingMismatches',s=>s.framingMismatches],['pingIntervalMedian',s=>s.pingInterval?.median??null],['connectAttempts',s=>s.connectAttempts],['connectRetryIntervalMedian',s=>s.connectRetryInterval?.median??null],
];
// Timing medians differ only beyond the tolerance (and never when both are under 5 ms); counts and sizes differ exactly.
function protocolDiffers(name,a,b,tol){if(a===b)return false;if(!name.endsWith('Median')||a===null||b===null)return true;if(a<0.005&&b<0.005)return false;return Math.abs(Math.log(a/b))>Math.log(1+tol);}
const show=v=>v===undefined||v===null?'-':typeof v==='bigint'?v.toString():v;
const rangeText=f=>'or' in f?`bits or=0x${f.or.toString(16)} and=0x${f.and.toString(16)}`:f.min===f.max?String(show(f.min)):`${show(f.min)}..${show(f.max)}`;

// Compare two profiles (a = ours/gateway, b = native client). Returns a structured report.
export function compareProfiles(a,b,{labels=['ours','native'],timingTolerance=0.25}={}){
 const keys=[...new Set([...Object.keys(a.keys),...Object.keys(b.keys)])].sort();
 const only=(x,y)=>keys.filter(k=>x.keys[k]&&!y.keys[k]).map(k=>({key:k,dir:x.keys[k].dir,category:x.keys[k].category,count:x.keys[k].count,firstPhase:x.keys[k].firstPhase}));
 const report={labels,sessions:[a.session,b.session],onlyA:only(a,b),onlyB:only(b,a),encoding:[],ranges:[],timing:[],counts:[],sequences:{},protocol:[],issues:[a.issues,b.issues]};
 for(const k of keys){
  const x=a.keys[k],y=b.keys[k];if(!x||!y)continue;
  const diffs=[];
  for(const f of ['channels','flags','tsBits','classes','params'])if(x[f].join('|')!==y[f].join('|'))diffs.push({what:f,a:x[f],b:y[f]});
  if(x.size&&y.size&&(x.size[0]!==y.size[0]||x.size[1]!==y.size[1]))diffs.push({what:'size',a:x.size,b:y.size});
  if(x.undecoded!==y.undecoded&&(x.undecoded||y.undecoded))diffs.push({what:'undecoded',a:x.undecoded,b:y.undecoded});
  if((x.fragmented>0)!==(y.fragmented>0))diffs.push({what:'fragmented',a:x.fragmented,b:y.fragmented});
  if(diffs.length)report.encoding.push({key:k,dir:x.dir,diffs});
  for(const path of new Set([...Object.keys(x.fields),...Object.keys(y.fields)])){
   const fx=x.fields[path],fy=y.fields[path];
   if(!fx||!fy){report.ranges.push({key:k,path,a:fx?rangeText(fx):'absent',b:fy?rangeText(fy):'absent',disjoint:true});continue;}
   if('or' in fx||'or' in fy){if(fx.or!==fy.or||fx.and!==fy.and)report.ranges.push({key:k,path,a:rangeText(fx),b:rangeText(fy),disjoint:false});continue;}
   if(fx.min!==fy.min||fx.max!==fy.max)report.ranges.push({key:k,path,a:rangeText(fx),b:rangeText(fy),disjoint:fx.max<fy.min||fy.max<fx.min});
  }
  if(x.interval&&y.interval&&x.interval.n>=2&&y.interval.n>=2){
   const ratio=x.interval.median&&y.interval.median?Math.round(x.interval.median/y.interval.median*1000)/1000:null;
   report.timing.push({key:k,dir:x.dir,a:x.interval,b:y.interval,ratio,differs:ratio===null||Math.abs(Math.log(ratio))>Math.log(1+timingTolerance)});
  }
  report.counts.push({key:k,a:x.count,b:y.count});
 }
 for(const phase of new Set([...Object.keys(a.sequences),...Object.keys(b.sequences)])){
  const steps=align(a.sequences[phase]??[],b.sequences[phase]??[]);
  report.sequences[phase]={steps,differs:steps.some(s=>s.op!=='=')};
 }
 for(const dir of ['c2s','s2c'])for(const [name,get] of PROTOCOL_FIELDS){const va=get(a.stats[dir]),vb=get(b.stats[dir]);report.protocol.push({dir,field:name,a:va,b:vb,differs:protocolDiffers(name,va,vb,timingTolerance)});}
 report.protocol.push({dir:'both',field:'rttMedian',a:a.stats.rtt?.median??null,b:b.stats.rtt?.median??null,differs:false});
 return report;
}
export function formatComparison(r,{maxRanges=60}={}){
 const [A,B]=r.labels,L=[];
 L.push(`Capture comparison: ${A} = session ${r.sessions[0].id} (${r.sessions[0].client} -> ${r.sessions[0].server}, ${r.sessions[0].duration}s)`);
 L.push(`                    ${B} = session ${r.sessions[1].id} (${r.sessions[1].client} -> ${r.sessions[1].server}, ${r.sessions[1].duration}s)`);
 L.push(`Decoder issues: ${A} ${JSON.stringify(r.issues[0])}  ${B} ${JSON.stringify(r.issues[1])}`,'');
 const list=(title,items)=>{L.push(title);if(!items.length)L.push('  (none)');for(const i of items)L.push(`  ${i.key}  x${i.count}  [${i.category}, first in ${i.firstPhase}]`);L.push('');};
 list(`!!! Client->server messages ${A} sends that ${B} never sends:`,r.onlyA.filter(i=>i.dir==='c2s'));
 list(`!!! Client->server messages ${B} sends that ${A} never sends:`,r.onlyB.filter(i=>i.dir==='c2s'));
 list(`Server->client messages seen only with ${A}:`,r.onlyA.filter(i=>i.dir==='s2c'));
 list(`Server->client messages seen only with ${B}:`,r.onlyB.filter(i=>i.dir==='s2c'));
 L.push('Encoding differences (same message, different header/channel/types/sizes):');
 if(!r.encoding.length)L.push('  (none)');
 for(const e of [...r.encoding].sort((x,y)=>(x.dir==='c2s'?0:1)-(y.dir==='c2s'?0:1)))L.push(`  ${e.dir==='c2s'?'!! ':'   '}${e.key}: `+e.diffs.map(d=>`${d.what} ${A}=${JSON.stringify(d.a)} ${B}=${JSON.stringify(d.b)}`).join('; '));
 L.push('','Argument/field ranges that differ (disjoint ranges first):');
 const ranges=[...r.ranges].sort((x,y)=>(y.disjoint-x.disjoint)||(x.key<y.key?-1:1));
 if(!ranges.length)L.push('  (none)');
 for(const g of ranges.slice(0,maxRanges))L.push(`  ${g.disjoint?'!! ':'   '}${g.key} ${g.path}: ${A} ${g.a} | ${B} ${g.b}`);
 if(ranges.length>maxRanges)L.push(`  … ${ranges.length-maxRanges} more in the JSON report`);
 L.push('','Send intervals (median seconds; !! = differs by more than the tolerance):');
 if(!r.timing.length)L.push('  (no message repeated in both captures)');
 for(const t of r.timing)L.push(`  ${t.differs?'!! ':'   '}${t.key}: ${A} ${t.a.median} (n=${t.a.n}, p10 ${t.a.p10}, p90 ${t.a.p90}) | ${B} ${t.b.median} (n=${t.b.n}, p10 ${t.b.p10}, p90 ${t.b.p90})${t.ratio?' ratio '+t.ratio:''}`);
 L.push('','Protocol-level (Lidgren) behaviour:');
 for(const p of r.protocol)L.push(`  ${p.differs?'!! ':'   '}${p.dir==='both'?'   ':DIR_LABEL[p.dir]} ${p.field.padEnd(28)} ${A} ${show(p.a)} | ${B} ${show(p.b)}`);
 L.push('','Message order per phase (handshake/login/join by time; play split by category). "-" only in '+A+', "+" only in '+B+':');
 for(const [phase,{steps,differs}] of Object.entries(r.sequences)){
  L.push(`  [${phase}]${differs?'':' identical'}`);
  if(!differs)continue;
  for(const s of steps.slice(0,120)){const item=s.a??s.b,n=s.op==='='?(s.a.n===s.b.n?` x${s.a.n}`:` x${s.a.n}/${s.b.n}`):` x${item.n}`;L.push(`    ${s.op} ${item.key}${n}`);}
  if(steps.length>120)L.push(`    … ${steps.length-120} more steps`);
 }
 return L.join('\n')+'\n';
}

// Pick a session: the given id, else the first that got approved, else the one with most uLink messages.
export function pickSession(result,id){
 if(id!==undefined){const s=result.sessions.find(x=>x.id===Number(id));if(!s)throw new Error(`No session ${id} (have ${result.sessions.map(x=>x.id).join(', ')||'none'})`);return s;}
 return result.sessions.find(s=>s.playerId!==undefined)??[...result.sessions].sort((x,y)=>y.events.length-x.events.length)[0]??null;
}

// ---------------------------------------------------------------- recording proxy

// UDP proxy that records both directions into a PcapngWriter: clients send to listen, the proxy forwards to target.
// The pcap shows client endpoints as seen by the proxy and the server as serverLabel (default: target).
// drop(dir, bytes, index) → true drops a datagram after it was recorded (loss after the capture point).
export async function startRecordingProxy({target,listen={host:'127.0.0.1',port:0},writer=new PcapngWriter(),serverLabel,drop=()=>false,now=()=>(performance.timeOrigin+performance.now())/1000}){
 const host=h=>h==='localhost'?'127.0.0.1':h,front=createSocket('udp4'),clients=new Map(),counts={c2s:0,s2c:0,dropped:0};
 const server={address:host(serverLabel?.host??target.host),port:serverLabel?.port??target.port};
 const record=(dir,c,bytes)=>{
  const p=new Uint8Array(bytes),cl={address:c.rinfo.address,port:c.rinfo.port};
  writer.addUdp(now(),dir==='c2s'?{src:cl.address,dst:server.address,srcPort:cl.port,dstPort:server.port,payload:p}:{src:server.address,dst:cl.address,srcPort:server.port,dstPort:cl.port,payload:p});
  const i=counts[dir]++;if(drop(dir,p,i)){counts.dropped++;return false;}return true;
 };
 front.on('message',(msg,rinfo)=>{
  const key=rinfo.address+':'+rinfo.port;let c=clients.get(key);
  if(!c){
   // Bind the upstream socket explicitly (an implicit 0.0.0.0 bind can fail with EADDRNOTAVAIL on Windows loopback).
   const up=createSocket('udp4'),to=host(target.host);c={up,rinfo,queue:[]};clients.set(key,c);
   up.on('message',m=>{if(record('s2c',c,m))front.send(m,rinfo.port,rinfo.address);});
   up.on('error',()=>{});
   up.bind(0,to.startsWith('127.')?'127.0.0.1':undefined,()=>{const q=c.queue;c.queue=null;for(const m of q)up.send(m,target.port,to);});
  }
  if(!record('c2s',c,msg))return;
  if(c.queue)c.queue.push(msg);else c.up.send(msg,target.port,host(target.host));
 });
 await new Promise((res,rej)=>{front.once('error',rej);front.bind(listen.port,host(listen.host),res);});
 return {port:front.address().port,writer,counts,
  close:async()=>{for(const c of clients.values())await new Promise(r=>c.up.close(r));await new Promise(r=>front.close(r));}};
}
