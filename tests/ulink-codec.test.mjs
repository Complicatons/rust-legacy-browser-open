// Fixture tests for the uLink/Lidgren codec. Expected bytes are worked out by hand from the decompiled rules in
// ULINK-PROTOCOL.md; they still need confirming against an authorised capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BitWriter,BitReader} from '../bridge/ulink/bits.mjs';
import {KIND,SYSTEM,encodeMessage,decodeDatagram,encodeSystem,parseSystem,connectBody,readConnect,responseBody,readResponse,encodeAcks,parseAcks,splitPayload,Reassembler,ChannelReceiver,relativeSeq,nextSeq,resendDelay,pingBody} from '../bridge/ulink/lidgren.mjs';
import {INTERNAL,decodeHeader,clientConnectRequest,readClientConnectRequest,clientConnectResponse,readClientConnectResponse,connectDenied,readConnectDenied,writeWorldInfo,readWorldInfo,widenTimestamp,encodeInternal} from '../bridge/ulink/ulink.mjs';

const bytes=(...a)=>Uint8Array.from(a.flatMap(x=>ArrayBuffer.isView(x)||Array.isArray(x)?[...x]:[x]));
const ascii=s=>[...Buffer.from(s)];

test('bit packing is LSB first and varuints are 7-bit groups', ()=>{
 assert.deepEqual(new BitWriter().bool(true).u8(0xff).toBytes(),bytes(0xff,0x01));
 assert.deepEqual(new BitWriter().varuint(300).toBytes(),bytes(0xac,0x02));
 assert.deepEqual(new BitWriter().u16(0x1234).i32(1069).toBytes(),bytes(0x34,0x12,0x2d,0x04,0,0));
 const r=new BitReader(bytes(0xff,0x01));assert.equal(r.bool(),true);assert.equal(r.u8(),0xff);
 assert.equal(new BitReader(new BitWriter().f32(5).toBytes()).f32(),5);
 assert.throws(()=>new BitReader(bytes(0xff,0xff,0xff,0xff,0xff,0x01)).varuint(),/Bad 7-bit/);
});

test('system messages and the Connect handshake payloads', ()=>{
 const sig=new Uint8Array(16).fill(0xab),nonce=0x01020304;
 const connect=encodeSystem(SYSTEM.Connect,connectBody({signature:sig,nonce}));
 // [kind 7 | channel 0][seq 0][len = 1 + 1 + 11 + 16 + 4 = 33][type 1][appId][sig][nonce LE]
 assert.deepEqual(connect,bytes(0x07,0,0,33,1,11,ascii('uLink 1.5.6'),Array(16).fill(0xab),4,3,2,1));
 const [m]=decodeDatagram(connect);
 assert.equal(m.kind,KIND.System);
 const {type,body}=parseSystem(m.payload);assert.equal(type,SYSTEM.Connect);
 const c=readConnect(body);assert.equal(c.appId,'uLink 1.5.6');assert.equal(c.nonce,nonce);assert.equal(c.hail.length,0);
 const peer=new Uint8Array(16).fill(7);
 const resp=readResponse(new BitReader(responseBody({signature:peer,nonce:5,peerSignature:sig,peerNonce:nonce})));
 assert.deepEqual([resp.nonce,resp.peerNonce,resp.peerSignature[0]],[5,nonce,0xab]);
 assert.equal(pingBody(1000n).length,16);
});

test('datagrams skip zero padding and drop truncated messages', ()=>{
 const a=encodeMessage({kind:KIND.User,channel:17,seq:3,payload:bytes(9,9)}).toBytes();
 const truncated=bytes(0x09,0,0,10,1,2);
 const out=decodeDatagram(bytes(0,0,a,a,truncated));
 assert.equal(out.length,2);
 assert.deepEqual([out[0].kind,out[0].channel,out[0].seq,[...out[0].payload]],[KIND.User,17,3,[9,9]]);
 assert.equal(a[0],1|(17<<3));
});

test('acks are [channel][seq LE] triples on the unreliable channel', ()=>{
 const [msg]=encodeAcks([{channel:17,seq:0x1234},{channel:16,seq:1}]);
 assert.deepEqual(msg,bytes(0x03,0,0,6,17,0x34,0x12,16,1,0));
 assert.deepEqual(parseAcks(decodeDatagram(msg)[0].payload),[{channel:17,seq:0x1234},{channel:16,seq:1}]);
 assert.deepEqual(parseAcks(bytes(17,1)),[]);
 assert.deepEqual(parseAcks(bytes(3,1,0)),[]); // channel < 16 ignored
 assert.equal(encodeAcks(Array.from({length:500},(_,i)=>({channel:17,seq:i}))).length,2); // 463 per message at MTU 1400
});

test('sequence numbers wrap at 65535 and resend delay follows the uLink formula', ()=>{
 assert.equal(nextSeq(65534),0);
 assert.ok(relativeSeq(0,65534)>0);
 assert.ok(relativeSeq(65533,65534)<0);
 assert.equal(relativeSeq(10,10),0);
 assert.equal(resendDelay(0,0.1),0.025+0.1*1.1);
 assert.equal(resendDelay(2,0.1),0.025+0.1*1.1*5);
});

test('channel receiver: ordering, duplicates, unordered and unreliable-in-order rules', ()=>{
 const rx=new ChannelReceiver(),m=(channel,seq)=>({channel,seq,payload:bytes(seq)});
 let r=rx.push(m(17,1));assert.deepEqual([r.deliver.length,r.ack.seq],[0,1]);
 r=rx.push(m(17,0));assert.deepEqual(r.deliver.map(x=>x.seq),[0,1]);
 r=rx.push(m(17,1));assert.deepEqual([r.deliver.length,r.ack.seq],[0,1]); // duplicate is still acked
 r=rx.push(m(16,2));assert.deepEqual(r.deliver.map(x=>x.seq),[2]); // unordered delivers immediately
 r=rx.push(m(16,0));assert.deepEqual(r.deliver.map(x=>x.seq),[0]);
 r=rx.push(m(16,2));assert.deepEqual(r.deliver,[]);
 r=rx.push(m(1,5));assert.deepEqual(r.deliver.map(x=>x.seq),[5]);
 r=rx.push(m(1,4));assert.deepEqual(r.deliver,[]); assert.equal(r.ack,undefined);
});

test('fragmentation splits at MTU-10 and reproduces the last-fragment-first drop', ()=>{
 const payload=Uint8Array.from({length:3000},(_,i)=>i&255);
 const parts=splitPayload(payload,{mtu:1400,groupId:1});
 assert.equal(parts.length,3);assert.ok(parts.every(p=>p.kind===KIND.UserFragmented));
 const ra=new Reassembler();assert.equal(ra.add(parts[0].payload),null);assert.equal(ra.add(parts[1].payload),null);
 assert.deepEqual(ra.add(parts[2].payload),payload);
 const quirk=new Reassembler();assert.equal(quirk.add(parts[2].payload),null);assert.equal(quirk.add(parts[0].payload),null);assert.equal(quirk.add(parts[1].payload),null);
 assert.equal(splitPayload(bytes(1,2),{groupId:1})[0].kind,KIND.User);
});

test('Rust ClientConnectRequest body and the connect response/deny round trips', ()=>{
 const req=clientConnectRequest({userId:76561198000000001n,name:'Bob',ticket:bytes(1,2,3)});
 assert.deepEqual(req,bytes(0x00,6,0,0,0x2d,0x04,0,0,2,0x01,0x4c,0x5e,0x02,0x01,0x00,0x10,0x01,3,ascii('Bob'),3,1,2,3));
 const {header,body}=decodeHeader(req);assert.deepEqual([header.target,header.internal,header.typeSafe],['server',INTERNAL.ClientConnectRequest,false]);
 const parsed=readClientConnectRequest(body);assert.deepEqual([parsed.requestedPlayerId,parsed.login.protocol,parsed.login.mode,parsed.login.userId,parsed.login.name],[0,1069,2,76561198000000001n,'Bob']);
 const world={level:'rust_island_2013',sendRate:5,hostname:'Test',modded:true,official:false,steamId:90071992547409920n,ip:0x7f000001,port:28015};
 const resp=clientConnectResponse({playerId:3,viewRanges:[[100,199]],requestReceivedMs:1000n,serverNowMs:1005n,approvalData:writeWorldInfo(world)});
 const d=decodeHeader(resp);assert.deepEqual([d.header.target,d.header.internal],['unassigned',INTERNAL.ClientConnectResponse]);
 const r=readClientConnectResponse(d.body);assert.deepEqual([r.playerId,r.viewRanges,r.serverNowMs],[3,[[100,199]],1005n]);
 assert.deepEqual(readWorldInfo(r.approvalData),world);
 const denied=decodeHeader(connectDenied(156));assert.equal(denied.header.flags,4);assert.equal(readConnectDenied(denied.body).error,156);
 assert.deepEqual(encodeInternal(INTERNAL.Create,{target:7}).slice(0,3),bytes(2,7,0));
});

test('RPC header decoding and timestamp widening', ()=>{
 const w=new BitWriter().u8(8|32|128).u16(42).string('Fire').writeBits(0x1234,16);
 const {header}=decodeHeader(w.toBytes());
 assert.deepEqual([header.viewId,header.rpc,header.timestampBits,header.timestampLow,header.typeSafe],[42,'Fire',16,0x1234n,true]);
 const now=1_000_000n;
 assert.equal(widenTimestamp(now,now&0xffffn,16),now);
 assert.equal(widenTimestamp(now,(now-250n)&0xffffn,16),now-250n);
 assert.equal(widenTimestamp(now,(now+500n)&0xffffn,16),now); // up to 1 s ahead clamps to now
});

// A buffered NGC call for a handler without NetworkMessageInfo (BasicDoor.DOo on an NGC door), as the O575 encoder writes
// it from NetworkFlags.NoTimestamp: 0x80 type-safe (no TypeUnsafe), 0x18 buffered RPC, 0x02 target, no timestamp bits;
// the byte[] argument carries BitStreamTypeCode 135 (BitStream.WriteBytes) before its varuint length.
test('type-safe buffered NGC call: code 135 before the byte[] length', async()=>{
 const {readArgs,readNgcCall,encodeRpc,writeArgs,writeNgcCall}=await import('../bridge/ulink/rust.mjs');
 const call=bytes(0x01,0x00,0x2a,0x00, 0x01, 0x15,0xcd,0x5b,0x07,0,0,0,0); // (0x2a << 16 | 1) LE, sbyte 1, ulong 123456789 LE
 const wire=bytes(0x9a, 0x01,0x00, 0x28,0x00, 0x05,ascii('C2a_1'), 0x87,0x0d, call);
 const {header,body}=decodeHeader(wire);
 assert.deepEqual([header.target,header.viewId,header.rpc,header.buffered,header.timestampBits,header.typeSafe],[1,40,'C2a_1',true,undefined,true]);
 // The pre-fix gateway read it untyped: varuint 0x87 0x0d = 1671 bytes (the VM's "Byte array longer than buffer").
 assert.throws(()=>readArgs(['byte[]'],new BitReader(body.bytes,body.end,body.pos)),/Byte array longer than buffer/);
 const [data]=readArgs(['byte[]'],body,header.typeSafe);assert.equal(body.remainingBits,0);
 const c=readNgcCall(data);assert.deepEqual([c.innerID,c.messageID],[0x2a,1]);
 assert.deepEqual(readArgs(['sbyte','ulong'],new BitReader(c.args)),[1,123456789n]);
 assert.deepEqual(encodeRpc({viewId:40,name:'C2a_1',target:1,buffered:true,typeSafe:true},w=>writeArgs(['byte[]'],[writeNgcCall({innerID:0x2a,messageID:1,args:c.args})],w,true)),wire);
 // A wrong code is refused as uLink's ReadBytes does; a raw BitStream tail has no code.
 assert.throws(()=>readArgs(['byte[]'],new BitReader(bytes(0x07,0x00)),true),/Type-safe code 7 should have been 135/);
 assert.deepEqual(readArgs(['int','uLink.BitStream'],new BitReader(bytes(0x0d,1,0,0,0,9)),true),[1,bytes(9)]);
});

test('clock offset follows uLink connect/resync arithmetic', async()=>{
 const {clockOffset,serverTimeMs}=await import('../bridge/ulink/ulink.mjs');
 // Client clock 1000 behind the server, 40 ms each way, 2 ms server processing.
 const {transit,offset}=clockOffset(5000n,6040n,6042n,5082n);
 assert.equal(transit,40n);
 assert.equal(serverTimeMs(5082n,offset),6082n);
});
