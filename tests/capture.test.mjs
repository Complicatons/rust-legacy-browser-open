// Capture reader/decoder/compare (bridge/ulink/capture.mjs, tools/compare-captures.mjs). Fixtures in
// tests/fixtures/captures were recorded from our own stack by `node tools/compare-captures.mjs selftest --out …`;
// they prove decoder round-trips on our traffic only, nothing about the original server or client.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {readCapture,writePcap,PcapngWriter,buildUdpFrame,extractUdp,LINKTYPE,decodeCapture,profileSession,compareProfiles,formatComparison,formatDecode,pickSession,toJsonValue,splitDatagram} from '../bridge/ulink/capture.mjs';
import {encodeSystem,encodeMessage,connectBody,SYSTEM,KIND} from '../bridge/ulink/lidgren.mjs';
import {encodeRpc,writeArgs} from '../bridge/ulink/rust.mjs';
import {recordGatewaySession,TEST_REGISTRY,loadSchema} from './helpers/capture-session.mjs';

const fixture=name=>readFile(new URL('./fixtures/captures/'+name,import.meta.url));
const schema=await loadSchema();
const ctx={schema,registry:TEST_REGISTRY};
const keysOf=(s,dir)=>new Set(s.events.filter(e=>e.key&&(!dir||e.dir===dir)).map(e=>e.key));
const noIssues=s=>assert.deepEqual({...s.issues,flagged:0},{unknown:0,undecoded:0,roundTripMismatch:0,garbage:0,flagged:0},JSON.stringify(s.events.filter(e=>e.flag||e.decoded===false).slice(0,3)));

test('pcap and pcapng readers handle every supported link layer, IPv4/IPv6, byte orders and ns timestamps', ()=>{
 const payload=Uint8Array.from({length:37},(_,i)=>i*7&255);
 for(const linkType of [LINKTYPE.NULL,LINKTYPE.LOOP,LINKTYPE.ETHERNET,LINKTYPE.LINUX_SLL,LINKTYPE.LINUX_SLL2,LINKTYPE.RAW])
  for(const [src,dst] of [['127.0.0.1','127.0.0.1'],['::1','fe80::20c:29ff:fe00:2']]){
   const udp={src,dst,srcPort:50000,dstPort:29015,payload};
   const ng=new PcapngWriter({linkType});ng.addUdp(1760000000.123456,udp);
   const frame=buildUdpFrame({linkType,...udp});
   for(const bytes of [ng.toBytes(),writePcap([{time:1760000000.5,data:frame}],{linkType}),writePcap([{time:1760000000.5,data:frame}],{linkType,nanos:true,bigEndian:true})]){
    const cap=readCapture(bytes),{datagrams}=extractUdp(cap);
    assert.equal(datagrams.length,1,`link ${linkType} ${src}`);
    assert.deepEqual([datagrams[0].src,datagrams[0].dst,datagrams[0].srcPort,datagrams[0].dstPort],[src,dst,50000,29015]);
    assert.deepEqual(datagrams[0].payload,payload);
   }
   assert.ok(Math.abs(readCapture(ng.toBytes()).packets[0].time-1760000000.123456)<1e-5);
  }
 assert.throws(()=>readCapture(new Uint8Array(40)),/Not a pcap/);
});

test('IPv4 fragments are reassembled and VLAN-tagged Ethernet is unwrapped', ()=>{
 const payload=Uint8Array.from({length:3000},(_,i)=>i&255);
 const ip=buildUdpFrame({linkType:LINKTYPE.RAW,src:'10.0.0.2',dst:'10.0.0.1',srcPort:5000,dstPort:29015,payload,ipId:77}),body=ip.subarray(20);
 const frag=(off,end,more)=>{const f=new Uint8Array(20+end-off);f.set(ip.subarray(0,20));const v=new DataView(f.buffer);v.setUint16(2,f.length);v.setUint16(6,(more?0x2000:0)|off/8);f.set(body.subarray(off,end),20);return f;};
 const vlan=f=>Uint8Array.from([0,1,2,3,4,5,6,7,8,9,10,11,0x81,0,0,5,0x08,0,...f]);
 const {datagrams,notes}=extractUdp(readCapture(writePcap([{time:1,data:vlan(frag(1480,body.length,false))},{time:1,data:vlan(frag(0,1480,true))}],{linkType:LINKTYPE.ETHERNET})));
 assert.equal(notes.ipFragmentsReassembled,1);assert.deepEqual(datagrams[0].payload,payload);
});

test('committed gateway capture: every message decodes and re-encodes to the same bytes', async()=>{
 const r=decodeCapture(await fixture('gateway-session.pcapng'),ctx);
 assert.deepEqual([r.format,r.serverPorts,r.sessions.length],['pcapng',[29015],1]);
 const [s]=r.sessions;noIssues(s);
 assert.equal(s.playerId,1);assert.equal(s.state,'closed');
 const ulink=s.events.filter(e=>e.kind==='ulink'),system=s.events.filter(e=>e.kind==='system');
 assert.ok(ulink.length>=20&&ulink.every(e=>e.roundTrip==='ok'),'uLink round trips');
 assert.ok(system.every(e=>e.roundTrip==='ok'),'system round trips');
 for(const k of ['C>S sys Connect','C>S sys ConnectionEstablished','C>S ClientConnectRequest','C>S rpc ClientFirstReady','C>S rpc GetClientMove','C>S rpc Context:A','C>S rpc SVUF','C>S ngc Inventory.SVUF','C>S ResyncClockRequest','C>S sys Ping','C>S sys Pong','C>S sys Disconnect',
  'S>C sys ConnectResponse','S>C ClientConnectResponse','S>C Create :player_soldier','S>C ngc-create ;deploy_test_box','S>C ngc DeployableObject.ClientHealthUpdate','S>C rpc GNUP','S>C rpc RS','S>C rpc ReadClientMove','S>C rpc E','S>C ResyncClockResponse'])
  assert.ok(keysOf(s).has(k),k);
 const login=s.events.find(e=>e.internal==='ClientConnectRequest').fields;
 assert.deepEqual([login.protocol,login.mode,login.name],[1069,2,'Capture']);
 const gnup=s.events.find(e=>e.name==='GNUP');assert.deepEqual([gnup.fragmented.count,gnup.args[0].length],[2,1500]);
 assert.equal(s.stats.s2c.inferredMtu,1400);assert.ok(s.stats.s2c.resends>=1,'the dropped fragment was resent');
 const moves=s.events.filter(e=>e.name==='GetClientMove');
 assert.deepEqual(moves.map(e=>e.flags),['0x28','0x28','0x28']);
 assert.equal(moves[0].parity,0,'first move has no parity bits');assert.deepEqual(new Set(moves.slice(1).map(e=>e.parity)),new Set([0x2000,0x4000]),'then alternating');
 assert.deepEqual(PHASESeen(s),['handshake','login','join','play']);
 assert.match(formatDecode(r),/rpc GetClientMove@1001 ":player_soldier" HumanController 0x28 ts16/);
 assert.doesNotThrow(()=>JSON.stringify(toJsonValue(r)));
});
const PHASESeen=s=>[...new Set(s.events.map(e=>e.phase))];

test('compare mode finds what one client sends and the other never does, encoding and timing differences', async()=>{
 const a=pickSession(decodeCapture(await fixture('gateway-session.pcapng'),ctx)),b=pickSession(decodeCapture(await fixture('native-standin.pcap'),ctx));
 noIssues(b);
 const r=compareProfiles(profileSession(a),profileSession(b));
 const onlyA=r.onlyA.filter(i=>i.dir==='c2s').map(i=>i.key),onlyB=r.onlyB.filter(i=>i.dir==='c2s').map(i=>i.key);
 for(const k of ['C>S rpc Context:A','C>S ngc Inventory.SVUF','C>S ResyncClockRequest'])assert.ok(onlyA.includes(k),k);
 assert.deepEqual(onlyB,['C>S rpc fIm']);
 const move=r.encoding.find(e=>e.key==='C>S rpc GetClientMove');
 assert.deepEqual(move.diffs.find(d=>d.what==='flags'),{what:'flags',a:['0x28'],b:['0x08']});
 assert.deepEqual(move.diffs.find(d=>d.what==='tsBits'),{what:'tsBits',a:[16],b:[0]});
 assert.ok(r.timing.find(t=>t.key==='C>S rpc GetClientMove').differs,'0.1 s vs 0.2 s send interval');
 assert.ok(r.ranges.some(g=>g.key==='C>S ClientConnectRequest'&&g.path==='ticket.len'));
 assert.equal(r.sequences.handshake.differs,false);
 assert.equal(r.protocol.find(p=>p.dir==='s2c'&&p.field==='inferredMtu').differs,false);
 const text=formatComparison(r);
 assert.match(text,/!!! Client->server messages ours sends that native never sends:\n(  .*\n)*  C>S rpc Context:A/);
 assert.match(text,/!!! Client->server messages native sends that ours never sends:\n  C>S rpc fIm/);
});

test('live: the gateway session recorded through the UDP proxy decodes completely and matches what the mock received', async()=>{
 const rec=await recordGatewaySession();
 const r=decodeCapture(rec.bytes,ctx),[s]=r.sessions;
 noIssues(s);
 assert.equal(s.stats.c2s.datagrams,rec.counts.c2s);assert.equal(s.stats.s2c.datagrams,rec.counts.s2c);
 // Every uLink message the mock server handled (after its internal connect/clock handling) is in the capture, in order.
 const sent=s.events.filter(e=>e.dir==='c2s'&&e.kind==='ulink'&&e.ch===17&&e.internal!=='ClientConnectRequest').map(e=>e.name??e.internal);
 assert.deepEqual(sent,rec.received);
 assert.deepEqual(rec.rejected,[]);
});

// Hand-built traffic exercising the decoder's error paths, port detection, peer filter and session splitting.
function synthetic(){
 const w=new PcapngWriter({linkType:LINKTYPE.ETHERNET});let t=1000;
 const c2s=(port,payload)=>w.addUdp(t+=0.01,{src:'192.168.56.1',dst:'192.168.56.10',srcPort:port,dstPort:40000,payload});
 const s2c=(port,payload)=>w.addUdp(t+=0.01,{src:'192.168.56.10',dst:'192.168.56.1',srcPort:40000,dstPort:port,payload});
 const user=(seq,payload)=>encodeMessage({kind:KIND.User,channel:17,seq,payload}).toBytes();
 const connect=encodeSystem(SYSTEM.Connect,connectBody({signature:randomBytes(16),nonce:5}));
 c2s(6000,connect);
 c2s(6000,user(0,encodeRpc({viewId:1001,name:'NotARealRpc'},w=>w.u8(1))));                                           // not in the schema
 c2s(6000,user(1,encodeRpc({viewId:1,name:'RequestRespawn'},w=>w.u8(2))));                                         // bool 2 → re-encodes as 1
 c2s(6000,Uint8Array.of(...user(2,encodeRpc({viewId:1,name:'ClientFirstReady'})),0x0f,0x01));                      // trailing junk
 c2s(6000,encodeSystem(SYSTEM.Disconnect,new Uint8Array(0)));
 c2s(6000,connect);                                                                                                // reconnect: new session
 c2s(6001,connect);                                                                                                // another client
 s2c(6001,encodeMessage({kind:KIND.AckBitVector,payload:Uint8Array.of(1,2)}).toBytes());
 return w.toBytes();
}

test('decoder flags unknown, undecodable and non-round-tripping traffic; finds the port, filters peers, splits sessions', ()=>{
 const bytes=synthetic(),r=decodeCapture(bytes,ctx);
 assert.deepEqual(r.serverPorts,[40000],'found from the uLink Connect');
 assert.deepEqual(r.sessions.map(s=>s.client),['192.168.56.1:6000','192.168.56.1:6000','192.168.56.1:6001']);
 const [s]=r.sessions,byName=n=>s.events.find(e=>e.name===n);
 assert.equal(byName('NotARealRpc').decoded,false);assert.match(byName('NotARealRpc').flag,/not in rpc-schema/);
 assert.equal(byName('RequestRespawn').roundTrip,'mismatch');
 assert.equal(s.events.find(e=>e.kind==='garbage').size,2);
 assert.deepEqual(s.issues,{unknown:0,undecoded:1,roundTripMismatch:1,garbage:1,flagged:2});
 assert.equal(r.sessions[2].events.find(e=>e.kind==='unknown').lidgrenKind,'AckBitVector');
 assert.equal(decodeCapture(bytes,{...ctx,peer:'192.168.56.1:6001'}).sessions.length,1);
 assert.equal(decodeCapture(bytes,{...ctx,port:1234}).sessions.length,0);
 assert.deepEqual(splitDatagram(Uint8Array.of(0,0,...user17())).padding,2);
});
const user17=()=>encodeMessage({kind:KIND.User,channel:17,seq:3,payload:Uint8Array.of(0,6)}).toBytes();
