// A stopped original server: a join that never reaches it and a session whose server dies must end in the original
// client's messages (MainMenu.uLink_OnFailedToConnect / uLink_OnDisconnectedFromServer) within the original client's
// timings (5 × 2.5 s handshake, 60 s without a pong). Mock uLink server and a hand-driven clock only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createSocket} from 'node:dgram';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createAccountService,createSigningKey} from '../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../bridge/adapter.mjs';
import {createGatewayAdmission} from '../bridge/gateway.mjs';
import {createGatewayService} from '../bridge/gateway-service.mjs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';
import {UlinkClient,failedToConnectError} from '../bridge/ulink/session.mjs';
import {CLIENT_DEFAULTS,DEFAULTS,decodeDatagram,parseSystem,KIND,SYSTEM} from '../bridge/ulink/lidgren.mjs';
import {OnlineSession} from '../browser/online.mjs';
import {failedToConnectMessage,netErrorName} from '../browser/net-error.mjs';
import {listenServer} from '../bridge/listen.mjs';

const SERVER='3f6c1b1e-0000-4000-8000-000000000001',ORIGIN='https://play.example.test';
const world={level:'rust_island_2013',sendRate:5,hostname:'Mock Legacy',modded:true,official:false,steamId:1n,ip:0x7f000001,port:28015};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// clock.t drives the gateway and the mock server; both tick every 10 ms of real time.
async function stack({nativePort,clock}){
 const controlKey=randomBytes(32),account=createAccountService({issuer:'https://accounts.example.test',keys:[createSigningKey('k1')]});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities:createIdentityMap({namespace:{base:'90000000000000000',size:'1000000'}}),isBanned:()=>false});
 const sender=createControlSender(controlKey);
 const admission=createGatewayAdmission({serverId:SERVER,account,sendControl:b=>adapter.handleControl(sender(b))});
 const native=nativePort?null:await startMockUlinkServer({world,now:()=>clock.t,onDisconnect:peer=>adapter.onDisconnect(peer.key),approve:(login,peer)=>{
  const r=adapter.onNativeApproval({authBytes:Buffer.from(login.ticket),claimedUserId:login.userId.toString(),connection:peer.key});
  return r.path==='browser'&&r.approved?{approve:true}:{deny:154};
 }});
 const schema=JSON.parse(await readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
 const lines=[],gateway=createGatewayService({admission,native:{host:'127.0.0.1',port:nativePort??native.port},allowedOrigins:[ORIGIN],schema,now:()=>clock.t,log:(...a)=>lines.push(a.join(' '))});
 const http=createServer();gateway.attach(http);await listenServer(http);
 const endpoint=`ws://127.0.0.1:${http.address().port}/play`;
 // The page's own client stack (OnlineSession → GatewayClient) over a real WebSocket with the page's origin.
 class PageSocket extends WebSocket{constructor(url,protocols){super(url,protocols,{origin:ORIGIN});}}
 const join=()=>{
  const s=new OnlineSession({join:{endpoint,ticket:account.issueAdmission({subject:'acct-1',serverId:SERVER})},WebSocketImpl:PageSocket,now:()=>clock.t});
  const rx=[];s.client.addEventListener('disconnected',e=>rx.push(e.detail));
  return {s,rx,connecting:s.connect().then(r=>({approved:r}),e=>({denied:e}))};
 };
 return {native,gateway,lines,join,close:async()=>{gateway.close();await native?.close().catch(()=>{});await new Promise(r=>http.close(r));}};
}
// Moves the clock in steps, each with real time for the 10 ms tickers and the sockets.
async function advance(clock,to,step=0.5){while(clock.t<to){clock.t=Math.min(to,clock.t+step);await sleep(20);}}
const settle=(p,ms=60)=>Promise.race([p,sleep(ms).then(()=>'pending')]);

test("the gateway's client session uses the original client's timings and failure texts", ()=>{
 // Client uLinkPrefs = server uLinkPrefs (5 × 2.5 s handshake, 3 s pings); ClientConnect.DoConnect sets timeoutDelay 60.
 assert.deepEqual(CLIENT_DEFAULTS,{...DEFAULTS,timeoutDelay:60});
 const {config}=new UlinkClient({send:()=>{},now:()=>0,login:{}}).connection;
 assert.deepEqual([config.timeoutDelay,config.timeBetweenPings,config.handshakeRetries,config.handshakeRetryDelay],[60,3,5,2.5]);
 assert.equal(new UlinkClient({send:()=>{},now:()=>0,login:{},config:{timeoutDelay:9}}).connection.config.timeoutDelay,9);
 // uLink's rejection reasons; everything else that ends a connect attempt is ConnectionFailed.
 assert.deepEqual(['No answer from remote host','Rejected: Server full','Rejected: Connection banned','Connection timed out; no pong for 61 seconds','Rejected: ???'].map(failedToConnectError),[14,17,21,14,14]);
 assert.deepEqual([failedToConnectMessage({reason:'connection-failed',error:14}),failedToConnectMessage({reason:'server-denied',error:158}),failedToConnectMessage({reason:'replayed'}),failedToConnectMessage({error:0}),netErrorName(999)],
  ['Failed to connect (ConnectionFailed)','Failed to connect (Facepunch_Connector_Invalid)','Failed to connect (replayed)','Failed to connect.','999']);
});

test('a join to a server that never started is refused with "Failed to connect (ConnectionFailed)" after 5 handshakes', async()=>{
 // A silent UDP port (a host that drops the packets) counts the handshake attempts.
 const silent=createSocket('udp4'),connects=[],clock={t:0};await new Promise(r=>silent.bind(0,'127.0.0.1',r));
 silent.on('message',m=>{for(const d of decodeDatagram(new Uint8Array(m)))if(d.kind===KIND.System&&parseSystem(d.payload).type===SYSTEM.Connect)connects.push(clock.t);});
 const s=await stack({nativePort:silent.address().port,clock});
 try{
  const {s:page,connecting}=s.join();let deniedAt=null;connecting.then(()=>{deniedAt=clock.t;});
  for(let i=0;i<300&&!connects.length;i++)await sleep(10);
  await advance(clock,12.4,0.1);
  assert.equal(deniedAt,null,'still connecting before the 5th attempt runs out');
  await advance(clock,20,0.1);
  const {denied}=await connecting;
  assert.deepEqual([denied.reason,denied.error],['connection-failed',14]);
  // Connects at 0, 2.5, 5, 7.5, 10 s, then the refusal at 12.5 s. Times are taken when the datagram or message arrives,
  // and a loaded test machine may run a tick late, hence the slack.
  assert.equal(connects.length,5,String(connects));
  for(const [i,t] of connects.entries())if(i)assert.ok(t-connects[i-1]>=2.4&&t-connects[i-1]<=3,String(connects));
  assert.ok(deniedAt>=12.5-1e-9&&deniedAt<=14,`${deniedAt} after ${connects}`);
  assert.equal(failedToConnectMessage(denied),'Failed to connect (ConnectionFailed)');
  assert.equal(page.state,'closed');
  assert.equal(s.gateway.metrics.nativeFailed,1);assert.equal(s.gateway.sessions.size,0);
  assert.ok(s.lines.some(l=>/native connect failed No answer from remote host/.test(l)),s.lines.join('\n'));
 }finally{await s.close();silent.close();}
});

test("a join to a stopped server's closed port ends the same way (ICMP is ignored, as Lidgren does)", async()=>{
 const probe=createSocket('udp4');await new Promise(r=>probe.bind(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const clock={t:0},s=await stack({nativePort:port,clock});
 try{
  const {connecting}=s.join();
  await sleep(300);await advance(clock,10);
  assert.equal(await settle(connecting),'pending');
  await advance(clock,20);
  const {denied}=await connecting;
  assert.deepEqual([denied.reason,denied.error],['connection-failed',14]);
 }finally{await s.close();}
});

test('a server stopped mid-session is noticed after 60 s without a pong and shows "Disconnected from server."', async()=>{
 const clock={t:0},s=await stack({clock});
 try{
  const {s:page,rx,connecting}=s.join();
  const {approved}=await connecting;assert.equal(approved?.type,'approved');
  // Pongs keep a quiet session alive well past 60 s.
  await advance(clock,75);assert.equal(page.state,'approved');assert.equal(rx.length,0);
  // Killed server: its socket is gone and nothing says goodbye.
  await s.native.close();const killedAt=clock.t;
  await advance(clock,killedAt+56);
  assert.equal(page.state,'approved','not before 60 s without a pong');assert.equal(rx.length,0);
  const closed=once(page,'closed');
  let closedAt=null;closed.then(()=>{closedAt=clock.t;});
  await advance(clock,killedAt+75);
  await Promise.race([closed,sleep(2000).then(()=>{throw Error('no close');})]);
  const quiet=Number(/^Connection timed out; no pong for ([\d.]+) seconds$/.exec(rx[0]?.reason??'')?.[1]);
  assert.ok(quiet>60&&quiet<=66,rx[0]?.reason);assert.ok(closedAt-killedAt<=66,`closed ${closedAt-killedAt} s after the kill`);
  assert.equal(page.disconnectText(),'Disconnected from server.');
  assert.deepEqual([s.gateway.metrics.nativeClosed,s.gateway.metrics.nativeFailed],[1,0]);
 }finally{await s.close();}
});
