// Anti-cheat and admin tooling through the whole mock stack (tests/helpers/stack.mjs): browser → gateway checks →
// report to central → admin list/evidence → kick and ban back to the gateway. Only the native server is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4} from 'three';
import {startStack,poll} from './helpers/stack.mjs';
import {LineOfSight} from '../bridge/line-of-sight.mjs';
import {CollisionWorld} from '../browser/collision.mjs';

const M4=-1852181914;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const events=(client,type)=>{const out=[];client.addEventListener(type,e=>out.push(e.detail));return out;};

test('teleport and fire-rate cheats are dropped, flagged, shown to the admin, kicked and banned', async()=>{
 const s=await startStack();
 try{
  const player=await s.login('cheater'),as=s.owner,admin=`/admin/servers/${s.serverId}`;
  const join=async()=>{const {ticket}=(await s.call('POST',`/servers/${s.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;const client=s.browser();const approved=await client.connect({ticket});return {client,approved};};
  const {client,approved}=await join();
  const rejected=events(client,'command-rejected'),kicked=events(client,'kicked'),closed=events(client,'closed');
  const peer=[...s.native.peers.values()].at(-1),seen=[];peer.onUlink=h=>seen.push(h.rpc);
  peer.create({viewId:20,owner:approved.playerId,prefab:':player_soldier',position:[0,10,0]});
  // Held M4 representation: initialData = parent view (ushort) + datablock uniqueID (int32).
  const data=new Uint8Array(6),v=new DataView(data.buffer);v.setUint16(0,20,true);v.setInt32(2,M4,true);
  peer.create({viewId:40,owner:approved.playerId,prefab:'m4.irp',initialData:data});
  await poll(()=>client.characterView===20&&client.views.has(40));
  await wait(150); // spawn grace

  client.send({type:'move',origin:[1,10,0],angles:{yaw:0,pitch:0},stateFlags:0});
  await wait(120);
  client.send({type:'move',origin:[400,10,0],angles:{yaw:0,pitch:0},stateFlags:0});
  await poll(()=>rejected.some(r=>r.reason==='impossible-move'));
  for(let i=0;i<10;i++)client.item(40,'bullet-fire',{hits:[{point:[0,0,-10]}]});
  await poll(()=>rejected.filter(r=>r.reason==='fire-rate').length>=6);
  await wait(100);
  assert.equal(seen.filter(n=>n==='GetClientMove').length,1); // the teleport never reached the native server
  assert.ok(seen.filter(n=>n==='Action1B').length<=3,'over-rate shots were forwarded');

  // Central received the roster and evidence; the admin sees the flagged player.
  const row=await poll(async()=>{const r=(await s.call('GET',`${admin}/players`,{cookie:as.cookie})).data;const p=r.players?.find(x=>x.player===player.player);return p?.flags?.teleport&&p.flags['fire-rate']?p:null;});
  assert.ok(row.score>=55&&row.review,JSON.stringify(row));
  const evidence=(await s.call('GET',`${admin}/flags?player=${player.player}`,{cookie:as.cookie})).data.flags;
  const tp=evidence.find(f=>f.kind==='teleport');
  assert.equal(tp.detail.detail.distance,399);assert.ok(tp.detail.replay.some(x=>x.kind==='move'));
  assert.ok(evidence.some(f=>f.kind==='fire-rate'&&f.detail.detail.weapon==='M4'));
  assert.equal((await s.call('GET',`${admin}/players`,{cookie:player.cookie})).status,404); // players cannot see the admin view

  // Kick: admin → central → gateway report reply → browser closed with the reason.
  assert.equal((await s.call('POST',`${admin}/kick`,{cookie:as.cookie,csrf:as.csrf,data:{player:player.player,reason:'teleport evidence'}})).status,202);
  await poll(()=>kicked.length===1&&closed.length===1);
  assert.equal(kicked[0].reason,'kicked');
  await poll(async()=>!(await s.call('GET',`${admin}/players`,{cookie:as.cookie})).data.players.some(x=>x.player===player.player));
  // The server-side plugin reports the native disconnect, releasing the identity lease (the mock server does not).
  await s.plugin({type:'disconnect',connectionId:peer.cid});

  // Ban while playing: the live session is kicked and no new ticket is issued for this server.
  const second=await join(),kicked2=events(second.client,'kicked');
  await poll(async()=>(await s.call('GET',`${admin}/players`,{cookie:as.cookie})).data.players.some(x=>x.player===player.player));
  assert.equal((await s.call('POST',`${admin}/bans`,{cookie:as.cookie,csrf:as.csrf,data:{player:player.player,reason:'teleport + fire rate',minutes:1440}})).status,201);
  await poll(()=>kicked2.length===1);
  assert.equal(kicked2[0].reason,'banned');
  assert.equal((await s.call('POST',`/servers/${s.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data.error,'banned');
  const audit=(await s.call('GET',`${admin}/audit`,{cookie:as.cookie})).data.events.map(e=>e.action);
  assert.ok(audit.includes('admin.kick')&&audit.includes('admin.ban'));
  // Operator metrics count drops, flags and kicks (aggregate only).
  const text=await (await fetch(`http://127.0.0.1:${s.gateway.port}/metrics`,{headers:{authorization:'Bearer test-metrics-token-0123456789'}})).text();
  assert.match(text,/rlb_gateway_anticheat_dropped_total ([7-9]|\d\d)/);assert.match(text,/rlb_gateway_kicked_total 2/);
  assert.ok(!text.includes(player.player));
 }finally{await s.close();}
});

test('a shot through a wall and inventory spam are flagged for the admin; the spam never reaches the server', async()=>{
 // Gateway line of sight over a small world: a wall across Unity z = 10 (browser z = −10), 10 m wide, 4 m tall.
 const world=new CollisionWorld(null);world.addBox([10,4,0.4],[0,12,-10],new Matrix4());world.build();
 const s=await startStack({anticheat:{lineOfSight:new LineOfSight({world,ground:()=>10})}});
 try{
  const player=await s.login('wallhack'),as=s.owner,admin=`/admin/servers/${s.serverId}`;
  const {ticket}=(await s.call('POST',`/servers/${s.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;
  const client=s.browser(),approved=await client.connect({ticket}),rejected=events(client,'command-rejected');
  const peer=[...s.native.peers.values()].at(-1),seen=[];peer.onUlink=h=>seen.push(String(h.rpc));
  peer.create({viewId:20,owner:approved.playerId,prefab:':player_soldier',position:[0,10,0]});
  const data=new Uint8Array(6),v=new DataView(data.buffer);v.setUint16(0,20,true);v.setInt32(2,M4,true);
  peer.create({viewId:40,owner:approved.playerId,prefab:'m4.irp',initialData:data});
  peer.create({viewId:60,owner:approved.playerId+1,prefab:':player_soldier',position:[0,10,20]}); // behind the wall
  await poll(()=>client.characterView===20&&client.views.has(40)&&client.views.has(60));
  await wait(150); // spawn grace

  client.item(40,'bullet-fire',{hits:[{target:{p1:0,viewId:60},bodyPart:9,point:[0,0,0]}]});
  await poll(()=>seen.includes('Action1B')); // flagged, not dropped: the server still decides the damage
  for(let i=0;i<40;i++)client.inventory('split',{viewId:20},{fromSlot:1});
  await poll(()=>rejected.filter(r=>r.reason==='command-rate').length>=15);
  await wait(100);
  const splits=seen.filter(n=>/ITSP/.test(n)).length;
  assert.ok(splits>=15&&splits<=21,`${splits} inventory requests forwarded`); // burst 20

  const row=await poll(async()=>{const r=(await s.call('GET',`${admin}/players`,{cookie:as.cookie})).data;const p=r.players?.find(x=>x.player===player.player);return p?.flags?.['wall-shot']&&p.flags['command-rate']?p:null;});
  assert.ok(row.score>=35,JSON.stringify(row));
  const evidence=(await s.call('GET',`${admin}/flags?player=${player.player}`,{cookie:as.cookie})).data.flags;
  const shot=evidence.find(f=>f.kind==='wall-shot');
  assert.deepEqual([shot.detail.detail.weapon,shot.detail.detail.target,shot.detail.detail.blockedBy],['M4',60,'world']);
  assert.ok(evidence.some(f=>f.kind==='command-rate'&&f.detail.detail.command==='inventory'));
 }finally{await s.close();}
});
