// Gateway uLink session engine against the project-owned mock server over loopback UDP. Mocks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {UlinkClient,LidgrenConnection} from '../bridge/ulink/session.mjs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';
import {encodeSystem,encodeMessage,connectBody,responseBody,decodeDatagram,parseSystem,SYSTEM,KIND} from '../bridge/ulink/lidgren.mjs';
import {encodeInternal,INTERNAL} from '../bridge/ulink/ulink.mjs';

const world={level:'rust_island_2013',sendRate:5,hostname:'Mock Legacy',modded:true,official:false,steamId:90071992547409920n,ip:0x7f000001,port:28015};
const login={userId:90000000000000123n,name:'Browser Player',ticket:Uint8Array.from(Buffer.from('RLBA'))};
const now=()=>performance.now()/1000;

async function client(port,{config,dropOutgoing=()=>false}={}){
 const socket=createSocket('udp4');await new Promise(r=>socket.bind(0,'127.0.0.1',r));
 const c=new UlinkClient({login,now,config,send:b=>{if(!dropOutgoing(b))socket.send(b,port,'127.0.0.1');}});
 socket.on('message',m=>c.receive(new Uint8Array(m)));
 const timer=setInterval(()=>c.tick(),10);
 c.dispose=()=>{clearInterval(timer);socket.close();};
 c.start();return c;
}
const within=(p,ms=5000)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(Error('timed out')),ms))]);

test('client completes the handshake, sends the Rust login and receives the approval world info', async()=>{
 let seen;
 const server=await startMockUlinkServer({world,approve:l=>{seen=l;return {approve:true};}});
 const c=await client(server.port);
 try{
  const [approved]=await within(once(c,'approved'));
  assert.deepEqual(approved.worldInfo,world);
  assert.equal(approved.playerId,1);
  assert.deepEqual([seen.protocol,seen.mode,seen.userId,seen.name,[...seen.ticket]],[1069,2,login.userId,login.name,[...login.ticket]]);
 }finally{c.dispose();await server.close();}
});

test('denied logins surface the uLink error and close', async()=>{
 const server=await startMockUlinkServer({world,approve:()=>({deny:156})});
 const c=await client(server.port);
 try{
  const [error]=await within(once(c,'denied'));assert.equal(error,156);
  const [reason]=await within(once(c,'closed'));assert.match(reason,/Normal disconnect/);
 }finally{c.dispose();await server.close();}
});

test('lost handshake and reliable messages are retried and resent', async()=>{
 let dropServer=2,dropClient=1;
 const isUser=b=>decodeDatagram(b).some(m=>m.kind===KIND.User);
 // Server loses its first ConnectResponse and its first approval message; client loses its first ClientConnectRequest.
 const server=await startMockUlinkServer({world,approve:()=>({approve:true}),config:{handshakeRetryDelay:0.1},
  dropOutgoing:b=>{const sys=decodeDatagram(b)[0];const drop=dropServer>0&&(sys.kind===KIND.System&&parseSystem(sys.payload).type===SYSTEM.ConnectResponse||isUser(b));if(drop)dropServer--;return drop;}});
 const c=await client(server.port,{config:{handshakeRetryDelay:0.1},dropOutgoing:b=>{const drop=dropClient>0&&isUser(b);if(drop)dropClient--;return drop;}});
 try{
  const [approved]=await within(once(c,'approved'));
  assert.deepEqual(approved.worldInfo,world);
  assert.equal(dropServer,0);assert.equal(dropClient,0);
 }finally{c.dispose();await server.close();}
});

test('a wrong application identifier is rejected', async()=>{
 const server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const s=createSocket('udp4');await new Promise(r=>s.bind(0,'127.0.0.1',r));
 try{
  s.send(encodeSystem(SYSTEM.Connect,connectBody({appId:'uLink 1.5.5',signature:new Uint8Array(16),nonce:1})),server.port,'127.0.0.1');
  const [msg]=await within(once(s,'message'));
  const {type,body}=parseSystem(decodeDatagram(new Uint8Array(msg))[0].payload);
  assert.deepEqual([type,body.string()],[SYSTEM.ConnectionRejected,'Bad app id']);
 }finally{s.close();await server.close();}
});

test('large server messages are fragmented and reassembled in order', async()=>{
 const server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const c=await client(server.port);
 try{
  await within(once(c,'approved'));
  const big=Uint8Array.from({length:5000},(_,i)=>(i*7)&255);
  const [peer]=server.peers.values();
  peer.connection.send(encodeInternal(INTERNAL.HandoverRequest,{target:'unassigned'},w=>w.blob(big))); // any pass-through type; BufferedRPCs is unpacked
  const [header,body]=await within(once(c,'ulink'));
  assert.equal(header.internal,INTERNAL.HandoverRequest);
  assert.deepEqual(body.blob(),big);
 }finally{c.dispose();await server.close();}
});

test('an unreachable server fails after the configured handshake retries', async()=>{
 const s=createSocket('udp4');await new Promise(r=>s.bind(0,'127.0.0.1',r));const port=s.address().port;s.close();
 const c=await client(port,{config:{handshakeRetries:3,handshakeRetryDelay:0.05}});
 try{const [reason]=await within(once(c,'closed'));assert.equal(reason,'No answer from remote host');}finally{c.dispose();}
});

// Original uLink (O104): nonces come from Random(0, 65534); send sequences start at the local nonce and expected receive
// sequences at the remote nonce. The original server acked and dropped a login sent with sequence 0 (Azure VM, 2026-10-21).
test('sequence numbers start at the handshake nonces, as the original uLink does', ()=>{
 const sent=[],c=new LidgrenConnection({role:'client',now,send:b=>sent.push(b)});
 assert.ok(c.nonce>=0&&c.nonce<65534);
 c.connect();
 const sig=new Uint8Array(16).fill(7),serverNonce=4480;
 c.receive(encodeSystem(SYSTEM.ConnectResponse,responseBody({signature:sig,nonce:serverNonce,peerSignature:c.signature,peerNonce:c.nonce})));
 assert.equal(c.state,'connected');
 sent.length=0;c.send(Uint8Array.of(1,2,3));
 const [m]=decodeDatagram(sent[0]);
 assert.equal(m.channel,17);assert.equal(m.seq,c.nonce,'first reliable message carries the client nonce');
 const got=[];c.on('message',p=>got.push([...p]));
 c.receive(encodeMessage({kind:KIND.User,channel:17,seq:0,payload:Uint8Array.of(9)}).toBytes());
 assert.deepEqual(got,[],'sequence 0 is not the expected first message');
 c.receive(encodeMessage({kind:KIND.User,channel:17,seq:serverNonce,payload:Uint8Array.of(8)}).toBytes());
 assert.deepEqual(got,[[8]],'the server nonce is');
});

// The original server sends a newly connected player its buffered Instantiates (ServerManagement included) inside one
// BufferedRPCs message (O1629.O3123); the client unpacks and handles each as a normal message (O2898.O598).
test('buffered Instantiates arrive unpacked from BufferedRPCs', async()=>{
 const server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const c=await client(server.port);
 try{
  await within(once(c,'approved'));
  const creates=[];c.on('ulink',h=>{if(h.internal===INTERNAL.Create)creates.push(h.viewId);});
  const peer=[...server.peers.values()].at(-1);
  peer.buffered([peer.create({viewId:3,prefab:'ServerManagement'},{buffered:true}),peer.create({viewId:7,prefab:'SupplyCrate'},{buffered:true})]);
  await within((async()=>{while(creates.length<2)await new Promise(r=>setTimeout(r,10));})());
  assert.deepEqual(creates,[3,7]);
 }finally{c.dispose();await server.close();}
});
// The character and its first inventory (Inventory.GNUP) can reach a joining player inside BufferedRPCs too: the RPC
// comes out unpacked, after its Create and on the character's view, like one sent on its own.
test('a buffered RPC after its Create arrives unpacked, in order, on that view', async()=>{
 const server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const c=await client(server.port);
 try{
  await within(once(c,'approved'));
  const seen=[];c.on('ulink',(h,body)=>{if(h.internal===INTERNAL.Create)seen.push(['create',h.viewId]);else if(h.rpc)seen.push([h.rpc,h.viewId,body.raw(body.varuint()).length]);});
  const peer=[...server.peers.values()].at(-1);
  peer.buffered([peer.create({viewId:1000,owner:peer.playerId,prefab:':player_soldier'},{buffered:true}),peer.rpc(1000,'GNUP',['byte[]'],[new Uint8Array(12)],{buffered:true})]);
  await within((async()=>{while(seen.length<2)await new Promise(r=>setTimeout(r,10));})());
  assert.deepEqual(seen,[['create',1000],['GNUP',1000,12]]);
 }finally{c.dispose();await server.close();}
});
// Load test on the original server (2026-10-22): one buffered message that a handler could not decode threw out of the
// unpacking loop and lost every buffered message after it. Each inner message is length-prefixed and stands alone.
test('a buffered message that fails to decode does not drop the ones after it', async()=>{
 const server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const c=await client(server.port);
 try{
  await within(once(c,'approved'));
  const creates=[],errors=[];c.connection.on('protocol-error',e=>errors.push(e.message));
  c.on('ulink',h=>{if(h.internal===INTERNAL.Create){if(h.viewId===5)throw new RangeError('Byte array longer than buffer');creates.push(h.viewId);}});
  const peer=[...server.peers.values()].at(-1);
  peer.buffered([peer.create({viewId:3,prefab:'ServerManagement'},{buffered:true}),peer.create({viewId:5,prefab:'Bad'},{buffered:true}),peer.create({viewId:7,prefab:'SupplyCrate'},{buffered:true})]);
  await within((async()=>{while(creates.length<2)await new Promise(r=>setTimeout(r,10));})());
  assert.deepEqual(creates,[3,7]);assert.deepEqual(errors,['Byte array longer than buffer']);
 }finally{c.dispose();await server.close();}
});
