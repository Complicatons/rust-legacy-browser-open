// End-to-end mock of the planned architecture: account service → browser WebSocket → gateway admission →
// identity adapter → uLink session over UDP → mock server whose approval calls the adapter (the C# plugin's job).
// Everything here is project-owned; the original server is not involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createAccountService,createSigningKey} from '../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../bridge/adapter.mjs';
import {createGatewayAdmission} from '../bridge/gateway.mjs';
import {createGatewayService,BROWSER_PROTOCOL,sanitizeName} from '../bridge/gateway-service.mjs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';
import {listenServer} from '../bridge/listen.mjs';

const SERVER='3f6c1b1e-0000-4000-8000-000000000001',ORIGIN='https://play.example.test';
const world={level:'rust_island_2013',sendRate:5,hostname:'Mock Legacy',modded:true,official:false,steamId:1n,ip:0x7f000001,port:28015};

async function stack({banned=new Set(),nativeHost='127.0.0.1',log}={}){
 const controlKey=randomBytes(32),account=createAccountService({issuer:'https://accounts.example.test',keys:[createSigningKey('k1')]});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities:createIdentityMap({namespace:{base:'90000000000000000',size:'1000000'}}),isBanned:id=>banned.has(id)});
 const sender=createControlSender(controlKey);
 const admission=createGatewayAdmission({serverId:SERVER,account,sendControl:b=>adapter.handleControl(sender(b))});
 // Mock server approval mirrors adapter/RustLegacyBrowser.cs: envelope logins go to the adapter, others would go native.
 const native=await startMockUlinkServer({world,onDisconnect:peer=>adapter.onDisconnect(peer.key),approve:(login,peer)=>{
  const r=adapter.onNativeApproval({authBytes:Buffer.from(login.ticket),claimedUserId:login.userId.toString(),connection:peer.key});
  return r.path==='browser'&&r.approved?{approve:true}:{deny:154};
 }});
 const schema=JSON.parse(await readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
 const gateway=createGatewayService({admission,native:{host:nativeHost,port:native.port},allowedOrigins:[ORIGIN],schema,log});
 const http=createServer();gateway.attach(http);await listenServer(http);
 const url=`ws://127.0.0.1:${http.address().port}/play`;
 const open=(origin=ORIGIN)=>new WebSocket(url,[BROWSER_PROTOCOL],{origin});
 return {account,adapter,banned,open,native,gateway,close:async()=>{gateway.close();await native.close();await new Promise(r=>http.close(r));}};
}
const next=async ws=>JSON.parse(String((await Promise.race([once(ws,'message'),new Promise((_,j)=>setTimeout(()=>j(Error('timed out')),5000))]))[0]));

test('a browser with a valid admission is approved by the (mock) server through the adapter', async()=>{
 const s=await stack({nativeHost:'localhost'});
 try{
  const ticket=s.account.issueAdmission({subject:'acct-1',serverId:SERVER}),ws=s.open();
  await once(ws,'open');ws.send(JSON.stringify({type:'admit',ticket,name:'Bob<script>'}));
  const m=await next(ws);
  assert.deepEqual([m.type,m.playerId,m.world.hostname,m.world.level],['approved',1,'Mock Legacy','rust_island_2013']);
  assert.equal(s.adapter.stats().leases,1);
  // Gameplay over the bridge: the server's player view arrives as JSON; a ready command reaches the server.
  const [peer]=s.native.peers.values();
  peer.create({viewId:10,prefab:'ServerManagement'});
  const created=await next(ws);assert.deepEqual([created.type,created.viewId,created.prefab],['create',10,'ServerManagement']);
  ws.send(JSON.stringify({type:'ready'}));
  for(let i=0;i<300&&!peer.received.some(h=>h.rpc==='ClientFirstReady');i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(peer.received.some(h=>h.rpc==='ClientFirstReady'));
  // The same ticket cannot be used again.
  const again=s.open();await once(again,'open');again.send(JSON.stringify({type:'admit',ticket}));
  assert.deepEqual(await next(again),{type:'denied',reason:'replayed'});
  ws.close();await once(ws,'close');
  // Leaving tells the server (Lidgren Disconnect) so the account is not left "already connected" until it times out.
  for(let i=0;i<200&&s.native.peers.size;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(s.native.peers.size,0,'the native server saw the disconnect');
 }finally{await s.close();}
});

test('a newer join from the same account replaces its stale session instead of "already connected"', async()=>{
 const s=await stack();
 try{
  const join=async()=>{const ws=s.open();await once(ws,'open');ws.send(JSON.stringify({type:'admit',ticket:s.account.issueAdmission({subject:'acct-1',serverId:SERVER})}));return {ws,first:await next(ws)};};
  const old=await join();assert.equal(old.first.type,'approved');
  // The first tab never closes its socket; the same account joins again from a new tab.
  const told=[];old.ws.on('message',m=>told.push(JSON.parse(String(m))));
  const oldClosed=once(old.ws,'close'),fresh=await join();
  assert.equal(fresh.first.type,'approved');
  assert.deepEqual(told[0],{type:'kicked',reason:'replaced'}); // then the usual 'disconnected'
  assert.equal((await oldClosed)[0],4011);
  assert.equal(s.adapter.stats().leases,1);
  fresh.ws.close();await once(fresh.ws,'close');
 }finally{await s.close();}
});

test('server-side refusal, bad origins and missing admissions are refused', async()=>{
 const s=await stack();
 try{
  const bad=s.open('https://evil.example');const [err]=await once(bad,'error');assert.match(err.message,/403/);
  const noAdmit=s.open();await once(noAdmit,'open');noAdmit.send(JSON.stringify({type:'move'}));
  assert.deepEqual(await next(noAdmit),{type:'error',reason:'admission-required'});
  // Ban the identity the adapter will allocate after admission but before native approval.
  const ws=s.open();await once(ws,'open');
  const original=s.adapter.onNativeApproval;
  s.adapter.onNativeApproval=args=>({path:'browser',approved:false,reason:'banned'});
  ws.send(JSON.stringify({type:'admit',ticket:s.account.issueAdmission({subject:'acct-2',serverId:SERVER})}));
  const m=await next(ws);assert.deepEqual([m.type,m.reason,m.error],['denied','server-denied',154]);
  s.adapter.onNativeApproval=original;
 }finally{await s.close();}
});

test('display names are bounded and stripped of markup', ()=>{
 assert.equal(sanitizeName('Bob<script>'),'Bobscript');
 assert.equal(sanitizeName(''),'Browser Player');
 assert.equal(sanitizeName('x'.repeat(50)).length,32);
});

test('admin screenshot over the socket: one large capture answer only while it is pending', async()=>{
 const s=await stack();
 try{
  const ws=s.open();await once(ws,'open');ws.send(JSON.stringify({type:'admit',ticket:s.account.issueAdmission({subject:'acct-cap',serverId:SERVER})}));
  assert.equal((await next(ws)).type,'approved');
  // The roster needs the anti-cheat watch, created on approval.
  const pending=s.gateway.capture('acct-cap','shot-1');
  assert.deepEqual(await next(ws),{type:'capture',id:'shot-1'});
  const image='A'.repeat(200_000);ws.send(JSON.stringify({type:'capture',id:'shot-1',ok:true,image,meta:{quality:0.8}}));
  const r=await pending;assert.equal(r.ok,true);assert.equal(r.image.length,200_000);assert.equal(typeof r.gateway.latencyMs,'number');
  // A large message with no capture pending ends the session as malformed.
  ws.send(JSON.stringify({type:'chat',text:'B'.repeat(10_000)}));
  assert.deepEqual(await next(ws),{type:'error',reason:'malformed'});
 }finally{await s.close();}
});

test('a server-wide correction burst is logged once with the server lateness; RS is counted, not forwarded', async()=>{
 const lines=[],s=await stack({log:(...a)=>lines.push(a.join(' '))});
 try{
  const players=[];
  for(const subject of ['acct-a','acct-b','acct-c']){
   const ws=s.open();await once(ws,'open');ws.send(JSON.stringify({type:'admit',ticket:s.account.issueAdmission({subject,serverId:SERVER})}));
   const approved=await next(ws);assert.equal(approved.type,'approved');
   const peer=[...s.native.peers.values()].find(p=>p.playerId===approved.playerId);
   peer.create({viewId:10,prefab:'ServerManagement'});assert.equal((await next(ws)).prefab,'ServerManagement');
   const view=1000+players.length;peer.create({viewId:view,owner:peer.playerId,prefab:':player_soldier'});assert.equal((await next(ws)).mine,true);
   players.push({ws,peer,view});
  }
  // HumanController.GetClientMove's drop path: the server's own origin back to the sender, values[3] = the move's age.
  for(const [i,p] of players.entries())p.peer.rpc(p.view,'ReadClientMove',['Vector3','int','ushort','float'],[[1,2,3],0,0,1.2+i*0.1]);
  for(const p of players){const e=await next(p.ws);assert.deepEqual([e.type,e.name],['rpc','ReadClientMove']);}
  players[0].peer.rpc(10,'RS',['float'],[6]);
  for(let i=0;i<200&&!s.gateway.stalls.metrics.resyncs;i++)await new Promise(r=>setTimeout(r,10));
  const bursts=lines.filter(l=>l.startsWith('correction-burst'));
  assert.equal(bursts.length,1);
  assert.match(bursts[0],/sessions=3\/3 .*lateMs p50=1300 max=1400/);
  assert.deepEqual([s.gateway.stalls.metrics.corrections,s.gateway.stalls.metrics.bursts,s.gateway.stalls.metrics.resyncs],[3,1,1]);
  // RS stays in the gateway: the next thing the browser sees is the next RPC.
  players[0].peer.rpc(10,'RS',['float'],[6]);players[0].peer.rpc(players[0].view,'ReadClientMove',['Vector3','int','ushort','float'],[[1,2,3],0,0,0]);
  assert.equal((await next(players[0].ws)).name,'ReadClientMove');
  for(const p of players)p.ws.close();
 }finally{await s.close();}
});
