// Records real UDP sessions of our own stack into pcapng (bridge/ulink/capture.mjs startRecordingProxy) for the
// capture decoder/compare tests and fixtures: (1) browser â†’ gateway â†’ mock uLink server, (2) a "native stand-in"
// that drives UlinkClient directly with deliberately different behaviour, so compare mode has differences to find.
// Everything is project-owned; no original binary is involved.
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import WebSocket from 'ws';
import {createAccountService,createSigningKey} from '../../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../../bridge/adapter.mjs';
import {createGatewayAdmission} from '../../bridge/gateway.mjs';
import {createGatewayService,BROWSER_PROTOCOL} from '../../bridge/gateway-service.mjs';
import {startMockUlinkServer} from '../../bridge/ulink/mock-server.mjs';
import {UlinkClient} from '../../bridge/ulink/session.mjs';
import {KIND} from '../../bridge/ulink/lidgren.mjs';
import {startRecordingProxy,PcapngWriter,LINKTYPE,splitDatagram} from '../../bridge/ulink/capture.mjs';
import {writeArgs,encodeAngles} from '../../bridge/ulink/rust.mjs';
import {listenServer} from '../../bridge/listen.mjs';

// A made-up NGC prefab (the real registry is an ignored asset); message ids index the array as in registry.json.
export const TEST_REGISTRY={prefabs:[{handle:';deploy_test_box',index:424242,messages:[{id:0,class:'DeployableObject',name:'ClientHealthUpdate',params:['float']},{id:1,class:'Inventory',name:'SVUF',params:[]}]}]};
export const CAPTURE_WORLD={level:'rust_island_2013',sendRate:10,hostname:'Capture Test',modded:true,official:false,steamId:1n,ip:0x7f000001,port:28015};
export const CAPTURE_SERVER_PORT=29015; // the pcap labels the mock server with the real server port
const FAST={timeBetweenPings:0.25};
const SERVER='3f6c1b1e-0000-4000-8000-0000000000c1',ORIGIN='https://play.example.test';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const poll=async(f,ms=6000)=>{const t=Date.now();while(Date.now()-t<ms){if(f())return;await sleep(10);}throw Error('timed out');};
export const loadSchema=async()=>JSON.parse(await readFile(new URL('../../bridge/ulink/rpc-schema.json',import.meta.url)));

// Drops the first serverâ†’client datagram carrying a fragment, after the proxy recorded it: the capture then shows
// the original transmission and the mock server's resend.
function dropFirstFragment(){
 let done=false;
 return (dir,bytes)=>{if(done||dir!=='s2c')return false;if(splitDatagram(bytes).messages.some(m=>m.kind===KIND.UserFragmented))return done=true;return false;};
}

// The server side of both scenarios: views, NGC entity, a fragmented inventory, a clock resync request, moves, a menu.
function serverScene(peer,playerId){
 peer.create({viewId:1,prefab:'Server/ServerManagement'});
 peer.create({viewId:1001,owner:playerId,prefab:':player_soldier',position:[10,20,30]});
 peer.create({viewId:1002,group:7,prefab:'!Ng'});
 peer.ngcCreate(1002,{prefabIndex:424242,innerID:3,position:[1,2,3],euler:[0,90,0]});
 peer.ngcCall(1002,{innerID:3,messageID:0,args:writeArgs(['float'],[55.5]).toBytes()});
 peer.rpc(1001,'GNUP',['byte[]'],[Uint8Array.from({length:1500},(_,i)=>i&0xff)]); // > MTU 1400 â†’ two fragments
 peer.rpc(1,'RS',['float'],[0.12]);
 peer.rpc(1001,'ReadClientMove',['Vector3','int','ushort','float'],[[1,2,3],encodeAngles({pitch:10,yaw:20}),0x2000,0.05]);
 peer.rpc(998,'E',['ContextMenuData'],[[{name:1,text:'Open'}]]);
}

// Browser â†’ gateway (real GameBridge/anti-cheat) â†’ recording proxy â†’ mock server. Returns {bytes, counts, received}.
export async function recordGatewaySession({linkType=LINKTYPE.NULL}={}){
 const controlKey=randomBytes(32),account=createAccountService({issuer:'https://accounts.example.test',keys:[createSigningKey('k1')]});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities:createIdentityMap({namespace:{base:'90000000000000000',size:'1000000'}})});
 const sender=createControlSender(controlKey);
 const admission=createGatewayAdmission({serverId:SERVER,account,sendControl:b=>adapter.handleControl(sender(b))});
 const native=await startMockUlinkServer({world:CAPTURE_WORLD,config:FAST,approve:(login,peer)=>{
  const r=adapter.onNativeApproval({authBytes:Buffer.from(login.ticket),claimedUserId:login.userId.toString(),connection:peer.key});
  return r.path==='browser'&&r.approved?{approve:true}:{deny:154};
 }});
 const writer=new PcapngWriter({linkType});
 const proxy=await startRecordingProxy({target:{host:'127.0.0.1',port:native.port},serverLabel:{port:CAPTURE_SERVER_PORT},writer,drop:dropFirstFragment()});
 const gateway=createGatewayService({admission,native:{host:'127.0.0.1',port:proxy.port},allowedOrigins:[ORIGIN],schema:await loadSchema(),ngcRegistry:TEST_REGISTRY,ulinkConfig:FAST});
 const http=createServer();gateway.attach(http);await listenServer(http);
 const ws=new WebSocket(`ws://127.0.0.1:${http.address().port}/play`,[BROWSER_PROTOCOL],{origin:ORIGIN}),events=[];
 ws.on('message',d=>events.push(JSON.parse(String(d))));
 const send=m=>ws.send(JSON.stringify(m));
 try{
  await once(ws,'open');
  send({type:'admit',ticket:account.issueAdmission({subject:'capture-1',serverId:SERVER}),name:'Capture'});
  await poll(()=>events.some(e=>e.type==='approved'));
  const playerId=events.find(e=>e.type==='approved').playerId,[peer]=native.peers.values();
  serverScene(peer,playerId);
  await poll(()=>events.some(e=>e.type==='ngc-call')&&events.some(e=>e.name==='GNUP')&&events.some(e=>e.name==='E'));
  send({type:'ready'});
  for(let i=0;i<3;i++){send({type:'move',origin:[10+i*0.2,20,30],angles:{pitch:0,yaw:i*10},stateFlags:1});await sleep(115);}
  send({type:'context',action:'query',target:{viewId:1001}});
  send({type:'inventory',source:{viewId:1001},action:'refresh'});
  send({type:'inventory',source:{carrier:1002,innerID:3},action:'refresh'});
  const got=n=>peer.received.filter(h=>h.rpc===n).length;
  await poll(()=>got('ClientFirstReady')&&got('GetClientMove')>=3&&got('Context:A')&&got('SVUF')&&got('C'));
  await sleep(400); // pings both ways and the resync window
  ws.close();await poll(()=>proxy.counts.c2s>0&&gateway.sessions.size===0);await sleep(60);
  return {bytes:writer.toBytes(),counts:{...proxy.counts},received:peer.received.map(h=>h.rpc??h.internal),rejected:events.filter(e=>e.type==='command-rejected')};
 }finally{ws.terminate();gateway.close();await new Promise(r=>http.close(r));await proxy.close();await native.close();}
}

// A stand-in for the desktop client, driving UlinkClient directly: no Context query, fIm instead, moves every 0.2 s
// without a timestamp, a different login. Only for exercising compare mode; it says nothing about the real client.
export async function recordNativeStandIn({linkType=LINKTYPE.NULL}={}){
 const native=await startMockUlinkServer({world:CAPTURE_WORLD,config:FAST,approve:()=>({approve:true})});
 const writer=new PcapngWriter({linkType});
 const proxy=await startRecordingProxy({target:{host:'127.0.0.1',port:native.port},serverLabel:{port:CAPTURE_SERVER_PORT},writer});
 const socket=createSocket('udp4');await new Promise(r=>socket.bind(0,'127.0.0.1',r));await new Promise(r=>socket.connect(proxy.port,'127.0.0.1',r));
 const now=()=>performance.now()/1000;
 const client=new UlinkClient({now,config:FAST,login:{userId:76561198000000001n,name:'NativePlayer',ticket:new Uint8Array(240).fill(7)},send:b=>socket.send(b)});
 socket.on('message',m=>client.receive(new Uint8Array(m)));
 const timer=setInterval(()=>client.tick(),10);let approved=null;client.on('approved',a=>approved=a);
 try{
  client.start();await poll(()=>approved);
  const [peer]=native.peers.values();serverScene(peer,approved.playerId);
  await sleep(150);
  client.sendRpc({viewId:1,name:'ClientFirstReady'});
  for(let i=0;i<4;i++){client.sendRpc({viewId:1001,name:'GetClientMove',types:['Vector3','int','ushort'],args:[[10,20,30+i*0.4],encodeAngles({pitch:5,yaw:i*15}),0x0101],timestamp:false});await sleep(200);}
  client.sendRpc({viewId:1001,name:'fIm',types:['Vector3'],args:[[0,-12,0]]});
  client.sendRpc({viewId:1001,name:'SVUF'});
  await poll(()=>peer.received.some(h=>h.rpc==='SVUF'));
  await sleep(300);
  client.close();await sleep(60);
  return {bytes:writer.toBytes(),counts:{...proxy.counts},received:peer.received.map(h=>h.rpc??h.internal)};
 }finally{clearInterval(timer);socket.close();await proxy.close();await native.close();}
}
