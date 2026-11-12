// Lidgren gen2 transport as modified for uLink 1.5.6. Every rule cites ULINK-PROTOCOL.md; derived from static
// reading of the server's uLink.dll (short names O109/O11/O0/O20), not yet checked against a captured trace.
import {BitWriter,BitReader} from './bits.mjs';

export const KIND={None:0,User:1,UserFragmented:2,Acknowledge:3,AckBitVector:4,OutOfBand:5,Unused:6,System:7};
export const CHANNEL={Unreliable:0,UnreliableInOrder1:1,ReliableUnordered:16,ReliableInOrder1:17};
export const SYSTEM={Error:0,Connect:1,ConnectResponse:2,ConnectionEstablished:3,ConnectionRejected:4,Disconnect:5,Discovery:50,DiscoveryResponse:51,NatIntroduction:75,Ping:100,Pong:101,StringTableAck:200};
export const APP_IDENTIFIER='uLink 1.5.6';
export const SEQ_MOD=65535; // O1133/O1154: sequence numbers are 0..65534
export const DEFAULTS={mtu:1400,timeBetweenPings:3,timeoutDelay:300,handshakeRetries:5,handshakeRetryDelay:2.5}; // server uLinkPrefs
// The client's uLinkPrefs (client resources.assets) hold the same values, but ClientConnect.DoConnect sets
// NetCull.config.timeoutDelay = 60 before every connect: the original client gives up on a silent server after 60 s.
export const CLIENT_DEFAULTS={...DEFAULTS,timeoutDelay:60};

export const isReliable=ch=>ch>=16;
export const isOrderedUnreliable=ch=>ch>=1&&ch<=15;
export const nextSeq=s=>(s+1)%SEQ_MOD;
// O1154(received, expected): >0 newer, 0 equal, <0 older (duplicate/late).
export function relativeSeq(received,expected){let n=expected-received;if(n<-32767)n+=65535;else if(n>32767)n-=65535;return n===0?0:-n;}
// O20 default resend delegate, seconds.
export const resendDelay=(resends,avgRtt)=>0.025+avgRtt*1.1*(1+resends*resends);

export function encodeMessage({kind,channel=0,seq=0,payload=new Uint8Array(0)},w=new BitWriter()){
 return w.u8((kind&7)|((channel&31)<<3)).u16(seq).varuint(payload.length).raw(payload);
}
// O11.O118 loop: skips zero padding, stops on truncation. Returns [{kind, channel, seq, payload}].
export function decodeDatagram(bytes){
 const r=new BitReader(bytes),out=[];
 while(r.remainingBytes>0){
  let b;do{b=r.u8();}while(b===0&&r.remainingBytes>0);
  if(b===0||r.remainingBytes<3)break;
  const seq=r.u16();let len;try{len=r.varuint();}catch{break;}
  if(len>r.remainingBytes)break;
  out.push({kind:b&7,channel:b>>3,seq,payload:r.raw(len)});
 }
 return out;
}

// System messages go out alone with seq 0 (O0.O94); payload starts with the system type byte.
export function encodeSystem(type,body=new Uint8Array(0)){return encodeMessage({kind:KIND.System,payload:Uint8Array.of(type,...body)}).toBytes();}
export function parseSystem(payload){if(payload.length<1)throw new RangeError('Empty system message');return {type:payload[0],body:new BitReader(payload,payload.length*8,8)};}

// Handshake payloads (O109.O415/O1119, O391 Connect handler).
export function connectBody({appId=APP_IDENTIFIER,signature,nonce,hail}){const w=new BitWriter().string(appId).raw(signature).i32(nonce);if(hail?.length)w.raw(hail);return w.toBytes();}
export function readConnect(r){const appId=r.string(),signature=r.raw(16),nonce=r.i32();return {appId,signature,nonce,hail:r.raw(r.remainingBytes)};}
export function responseBody({signature,nonce,peerSignature,peerNonce,hail}){const w=new BitWriter().raw(signature).i32(nonce).raw(peerSignature).i32(peerNonce);if(hail?.length)w.raw(hail);return w.toBytes();}
export function readResponse(r){const signature=r.raw(16),nonce=r.i32(),peerSignature=r.raw(16),peerNonce=r.i32();return {signature,nonce,peerSignature,peerNonce,hail:r.raw(r.remainingBytes)};}
export const reasonBody=reason=>new BitWriter().string(reason).toBytes();
export const pingBody=(nowMs,dateBinary=0n)=>new BitWriter().u64(nowMs).i64(dateBinary).toBytes();
export const pongBody=(echoMs,nowMs,dateBinary=0n)=>new BitWriter().u64(echoMs).u64(nowMs).i64(dateBinary).toBytes();

// Acks (O1127 / O986): 3-byte entries [channel][seq uint16 LE], unreliable channel.
export function encodeAcks(entries,mtu=DEFAULTS.mtu){
 const per=Math.floor((mtu-10)/3),out=[];
 for(let i=0;i<entries.length;i+=per){const w=new BitWriter();for(const {channel,seq} of entries.slice(i,i+per))w.u8(channel).u16(seq);out.push(encodeMessage({kind:KIND.Acknowledge,payload:w.toBytes()}).toBytes());}
 return out;
}
export function parseAcks(payload){
 if(payload.length%3)return [];
 const r=new BitReader(payload),out=[];
 while(r.remainingBytes>=3){const channel=r.u8(),seq=r.u16();if(channel>=16)out.push({channel,seq});}
 return out;
}

// Fragmentation (O1110): payloads over the MTU on non-Unreliable channels.
export function splitPayload(payload,{mtu=DEFAULTS.mtu,groupId}){
 if(payload.length<=mtu)return [{kind:KIND.User,payload}];
 const chunk=mtu-10,count=Math.ceil(payload.length/chunk),parts=[];
 for(let i=0;i<count;i++){const w=new BitWriter().u16(groupId).varuint(i).varuint(count).raw(payload.subarray(i*chunk,Math.min(payload.length,(i+1)*chunk)));parts.push({kind:KIND.UserFragmented,payload:w.toBytes()});}
 return parts;
}
// O1094 reassembly, including the quirk that a group whose first-seen part is its last part is dropped.
export class Reassembler{
 constructor(){this.groups=new Map();}
 add(payload){
  const r=new BitReader(payload),id=r.u16(),index=r.varuint(),count=r.varuint(),data=r.raw(r.remainingBytes);
  let g=this.groups.get(id);
  if(!g){if(index===count-1)return null;g={count,chunk:data.length,received:0,size:0,buf:new Uint8Array(data.length*count)};this.groups.set(id,g);}
  if(index>=g.count||index*g.chunk+data.length>g.buf.length)return null;
  g.buf.set(data,index*g.chunk);g.size+=data.length;g.received++;
  if(g.received<g.count)return null;
  this.groups.delete(id);return g.buf.subarray(0,g.size);
 }
}

// Receive-side sequencing (O989/O1160). push() returns {deliver: payload messages in delivery order, ack?}.
// Expected sequences start at the remote peer's handshake nonce (O104.O2110), not 0.
export class ChannelReceiver{
 constructor(start=0){this.expectedUnordered=new Array(15).fill(start);this.expected=new Array(16).fill(start);this.seen=Array.from({length:16},()=>new Set());this.withheld=Array.from({length:16},()=>new Map());}
 push(m){
  const ch=m.channel;
  if(ch===0)return {deliver:[m]};
  if(ch<16){const i=ch-1;if(relativeSeq(m.seq,this.expectedUnordered[i])<0)return {deliver:[]};this.expectedUnordered[i]=nextSeq(m.seq);return {deliver:[m]};}
  const i=ch-16,ack={channel:ch,seq:m.seq},exp=this.expected[i];
  if(relativeSeq(m.seq,exp)<0)return {deliver:[],ack};
  if(m.seq===exp){
   const deliver=[m];let s=exp;
   for(;;){this.seen[i].delete(s);s=nextSeq(s);if(!this.seen[i].has(s))break;if(ch>=17){const w=this.withheld[i].get(s);this.withheld[i].delete(s);deliver.push(w);}}
   this.expected[i]=s;return {deliver,ack};
  }
  if(this.seen[i].has(m.seq))return {deliver:[],ack};
  this.seen[i].add(m.seq);
  if(ch===16)return {deliver:[m],ack};
  this.withheld[i].set(m.seq,m);return {deliver:[],ack};
 }
}
