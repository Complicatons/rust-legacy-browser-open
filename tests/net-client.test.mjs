// Browser GatewayClient end to end: account ticket → gateway WebSocket → uLink UDP → mock server, and back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import WebSocket from 'ws';
import {createAccountService,createSigningKey} from '../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../bridge/adapter.mjs';
import {createGatewayAdmission} from '../bridge/gateway.mjs';
import {createGatewayService} from '../bridge/gateway-service.mjs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';
import {readArgs,decodeAngles} from '../bridge/ulink/rust.mjs';
import {GatewayClient,toUnityAngles,toBrowserAngles,toBrowserQuaternion,STATE} from '../browser/net-client.mjs';
import {listenServer} from '../bridge/listen.mjs';

const SERVER='3f6c1b1e-0000-4000-8000-000000000001',ORIGIN='https://play.example.test';
const world={level:'rust_island_2013',sendRate:20,hostname:'Mock',modded:false,official:false,steamId:1n,ip:1,port:28015};
const schema=JSON.parse(await readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
const registry={prefabs:[{handle:';deploy_wood_box',index:-42,messages:[]}]};
const poll=async(f,ms=3000)=>{const t=Date.now();while(Date.now()-t<ms){const v=f();if(v)return v;await new Promise(r=>setTimeout(r,5));}throw Error('timed out');};
const nextEvent=(target,type)=>new Promise(r=>target.addEventListener(type,e=>r(e.detail),{once:true}));

test('Angle2 pitch uses the native positive-up convention independently of Unity euler X',()=>{
 const a=toUnityAngles({yaw:Math.PI/2,pitch:Math.PI/6});assert.equal(a.yaw,-90);assert.ok(Math.abs(a.pitch-30)<1e-10);
 assert.ok(toBrowserAngles({yaw:0,pitch:30}).pitch>0);assert.ok(toBrowserAngles({yaw:0,pitch:-30}).pitch<0);
});

test('browser client joins through the gateway, sends moves in Unity space and applies server state', async()=>{
 const controlKey=randomBytes(32),account=createAccountService({issuer:'https://accounts.example.test',keys:[createSigningKey('k1')]});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities:createIdentityMap({namespace:{base:'90000000000000000',size:'1000000'}})});
 const sender=createControlSender(controlKey);
 const admission=createGatewayAdmission({serverId:SERVER,account,sendControl:b=>adapter.handleControl(sender(b))});
 const native=await startMockUlinkServer({world,approve:(login,peer)=>{const r=adapter.onNativeApproval({authBytes:Buffer.from(login.ticket),claimedUserId:login.userId.toString(),connection:peer.key});return r.approved?{approve:true}:{deny:154};}});
 const gateway=createGatewayService({admission,native:{host:'127.0.0.1',port:native.port},allowedOrigins:[ORIGIN],schema,ngcRegistry:registry});
 const http=createServer();gateway.attach(http);await listenServer(http);
 class OriginWebSocket extends WebSocket{constructor(url,protocols){super(url,protocols,{origin:ORIGIN});}}
 const client=new GatewayClient({url:`ws://127.0.0.1:${http.address().port}/play`,WebSocketImpl:OriginWebSocket});
 try{
  const approved=await client.connect({ticket:account.issueAdmission({subject:'acct-1',serverId:SERVER}),name:'Bob'});
  assert.equal(approved.world.sendRate,20);
  const [peer]=native.peers.values();
  const moves=[];peer.onUlink=(h,b)=>{if(h.rpc==='GetClientMove')moves.push(readArgs(['Vector3','int','ushort'],b));};

  peer.create({viewId:10,prefab:'ServerManagement'});
  const created=nextEvent(client,'create');
  peer.create({viewId:20,owner:approved.playerId,prefab:':player_soldier',position:[1,2,3],rotation:[0,0.7071068,0,0.7071068]});
  await poll(()=>client.characterView===20);
  await created;
  assert.deepEqual(client.views.get(20).position,[1,2,-3]);
  assert.deepEqual(client.views.get(20).rotation,toBrowserQuaternion([0,0.7071068,0,0.7071068].map(Math.fround)));

  client.ready();
  await poll(()=>peer.received.some(h=>h.rpc==='ClientFirstReady'));
  // Browser yaw +90° faces −X in Three (forward = (−sin, 0, −cos)); Unity faces −X at yaw −90°.
  assert.equal(client.sendMove({feet:[5,6,-7],yaw:Math.PI/2,pitch:0.1,flags:STATE.crouch|STATE.movement}),true);
  assert.equal(client.sendMove({feet:[5,6,-7],yaw:0,pitch:0}),false); // throttled to the send rate
  await poll(()=>moves.length===1);
  const [origin,encoded,flags]=moves[0];
  assert.deepEqual(origin,[5,6,7]);
  const a=decodeAngles(encoded);assert.ok(Math.abs(a.yaw+90)<0.01&&Math.abs(a.pitch-toUnityAngles({yaw:0,pitch:0.1}).pitch)<0.01);
  assert.equal(flags&0x1fff,STATE.crouch|STATE.movement);

  const correction=nextEvent(client,'correction');
  peer.rpc(20,'ReadClientMove',['Vector3','int','ushort','float'],[[9,9,9],encoded,0,0.05]);
  const c=await correction;
  assert.deepEqual(c.position,[9,9,-9]);
  assert.ok(Math.abs(c.angles.yaw-toBrowserAngles({yaw:-90,pitch:0}).yaw)<1e-3);

  peer.create({viewId:40,prefab:'!Ng'});
  const entity=nextEvent(client,'entity');
  await poll(()=>client.views.has(40));
  peer.ngcCreate(40,{prefabIndex:-42,innerID:1,position:[3,0,4],euler:[0,0,0]});
  const n=await entity;assert.deepEqual([n.prefab,n.position],[';deploy_wood_box',[3,0,-4]]);
 }finally{client.close();gateway.close();await native.close();await new Promise(r=>http.close(r));}
});
