// Whole planned architecture on loopback with only the native Legacy server mocked (tests/helpers/stack.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {startStack,poll,METRICS_TOKEN} from './helpers/stack.mjs';
import {validateConfig} from '../bridge/gateway-launcher.mjs';

test('sign in, list, take a ticket, join through the gateway and move', async()=>{
 const s=await startStack();
 try{
  assert.ok(validateConfig({serverId:s.serverId,centralUrl:'http://x',credential:'A'.repeat(43),sidecarUrl:'http://127.0.0.1:1',controlKeyHex:'ab'.repeat(32),native:{host:'h',port:1},allowedOrigins:['https://a'],listen:{host:'0.0.0.0'}}).some(e=>/TLS/.test(e)));
  const player=await s.login('player-1');
  const [listing]=(await s.call('GET','/servers')).data.servers;assert.equal(listing.online,true);
  const {ticket}=(await s.call('POST',`/servers/${listing.id}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;
  const client=s.browser();
  const approved=await client.connect({ticket,name:'ignored-by-gateway'});
  assert.equal(approved.world.hostname,'Pilot');
  const [peer]=s.native.peers.values();
  const moves=[];peer.onUlink=h=>{if(h.rpc==='GetClientMove')moves.push(h);};
  peer.create({viewId:20,owner:approved.playerId,prefab:':player_soldier'});
  await poll(()=>client.characterView===20);
  assert.equal(client.sendMove({feet:[1,2,3],yaw:0,pitch:0}),true);
  await poll(()=>moves.length===1);
  assert.equal(s.adapter.stats().leases,1);
  // Operator metrics: bearer token required; aggregate counts only.
  const metrics=token=>fetch(`http://127.0.0.1:${s.gateway.port}/metrics`,{headers:token?{authorization:'Bearer '+token}:{}});
  assert.equal((await metrics()).status,401);assert.equal((await metrics('wrong-token-wrong-token-xx')).status,401);
  const text=await (await metrics(METRICS_TOKEN)).text();
  for(const line of ['rlb_gateway_in_game 1','rlb_gateway_admitted_total 1','rlb_gateway_approved_total 1','rlb_gateway_heartbeats_total{result="ok"}'])assert.ok(text.includes(line),line);
  assert.ok(!text.includes('player-1'));
  assert.ok(validateConfig({serverId:s.serverId,centralUrl:'http://x',credential:'A'.repeat(43),sidecarUrl:'http://127.0.0.1:1',controlKeyHex:'ab'.repeat(32),native:{host:'h',port:1},allowedOrigins:['https://a'],listen:{host:'127.0.0.1'},metricsToken:'short'}).some(e=>/metricsToken/.test(e)));
 }finally{await s.close();}
});

test('desktop character link: /browserlink code → website → gateway poll → adapter → browser joins as that character', async()=>{
 const s=await startStack();
 try{
  const desktopId='76561198012345678',desktop='d'.repeat(32);
  assert.equal((await s.plugin({type:'native-authenticated',connectionId:desktop,userId:desktopId})).ok,true);
  const {code}=await s.plugin({type:'link-challenge',connectionId:desktop});
  const player=await s.login('linker');
  assert.equal((await s.call('POST',`/servers/${s.serverId}/link`,{cookie:player.cookie,csrf:player.csrf,data:{code:'BAD'}})).data.error,'invalid-code');
  const {request}=(await s.call('POST',`/servers/${s.serverId}/link`,{cookie:player.cookie,csrf:player.csrf,data:{code}})).data;
  const status=await poll(async()=>{const r=(await s.call('GET',`/links/${request}/status`,{cookie:player.cookie})).data;return r.status==='linked'||r.status==='failed'?r:null;});
  assert.equal(status.status,'linked');
  assert.equal((await s.call('POST',`/servers/${s.serverId}/link`,{cookie:player.cookie,csrf:player.csrf,data:{code}})).data.error,'already-linked');
  // A second account cannot claim the same code.
  const other=await s.login('other');
  const r2=(await s.call('POST',`/servers/${s.serverId}/link`,{cookie:other.cookie,csrf:other.csrf,data:{code}})).data.request;
  assert.equal((await poll(async()=>{const r=(await s.call('GET',`/links/${r2}/status`,{cookie:other.cookie})).data;return r.status==='failed'?r:null;})).reason,'unknown-code');

  // Desktop session ends; the browser join now arrives as the desktop character's backend ID.
  await s.plugin({type:'disconnect',connectionId:desktop});
  const {ticket}=(await s.call('POST',`/servers/${s.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;
  await s.browser().connect({ticket});
  assert.equal(s.approvals.at(-1).userId.toString(),desktopId);
  assert.equal(s.approvals.at(-1).result.approved,true);
 }finally{await s.close();}
});
