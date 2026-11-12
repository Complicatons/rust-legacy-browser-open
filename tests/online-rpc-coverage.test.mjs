// Audit round 5, online message coverage (GAP-AUDIT.md "Audit round 5: online message coverage, 2026-10-29";
// ONLINE-RPC-COVERAGE.md): the original server lights remote torches with relayed Action2/Action3 (never OnStatus),
// RigidObj snapshots and events sit on the server clock, ClientFirstReady waits for the loaded world, our character's
// Create asks for a full inventory (SVUF) and a ReadClientMove correction also sets the look. Mock stack and unit only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerHeldItems} from '../browser/server-held.mjs';
import {ServerRigid} from '../browser/server-rigid.mjs';
import {OnlineSession} from '../browser/online.mjs';
import {gatewayStack as stack,until} from './helpers/gateway-stack.mjs';

const emit=(t,type,detail)=>t.dispatchEvent(Object.assign(new Event(type),{detail}));
const repView=(id=60,parent=30)=>{const b=new Uint8Array(6),d=new DataView(b.buffer);d.setUint16(0,parent,true);d.setInt32(2,-77,true);return {viewId:id,prefab:'torch.irp',initialData:b};};
function heldFixture(kind){
 const s=new EventTarget();s.client=new EventTarget();s.client.views=new Map();s.remote=new Map();s.actorCalls=new Map();
 const manifest={held:{torch:{uid:-77,item:'Torch',netName:'torch.irp',prefab:'torch'}},weapons:{torch:{class:kind}}},statuses=[],attached=[];
 const options={attach:(parent,h)=>{attached.push({parent,lit:h.lit});return true;},status:(h,lit)=>statuses.push(lit),action:()=>{}};
 return {s,manifest,options,statuses,attached};
}

test('A5-1 torch: relayed Action2 lights and Action3 puts out a remote torch; no OnStatus needed', ()=>{
 const {s,manifest,options,statuses,attached}=heldFixture('BasicTorchItemDataBlock'),h=new ServerHeldItems(s,manifest,options);
 s.client.views.set(60,repView());emit(s.client,'create',repView());
 // Action2 before the parent is drawn: kept on the representation and carried by attach.
 emit(s.client,'rpc',{viewId:60,name:'Action2',args:{class:'ItemRepresentation',values:[new Uint8Array()]}});
 assert.equal(h.items.get(60).lit,true);assert.deepEqual(statuses,[],'not bound yet');
 s.remote.set(30,{});h.frame();assert.deepEqual(attached,[{parent:30,lit:true}]);
 emit(s.client,'rpc',{viewId:60,name:'Action3',args:{class:'ItemRepresentation',values:[new Uint8Array()]}});
 assert.equal(h.items.get(60).lit,false);assert.deepEqual(statuses,[false]);
 // A plain OnStatus (mock servers) still works.
 emit(s.client,'rpc',{viewId:60,name:'OnStatus',args:{class:'BasicTorchItemRep',values:[true]}});assert.deepEqual(statuses,[false,true]);
});

test('A5-1 flare: Action2 ignites, the throw (Action1) puts it out, Action3 does nothing', ()=>{
 const {s,manifest,options,statuses}=heldFixture('TorchItemDataBlock'),h=new ServerHeldItems(s,manifest,options);
 s.remote.set(30,{});s.client.views.set(60,repView());emit(s.client,'create',repView());h.frame();
 emit(s.client,'rpc',{viewId:60,name:'Action2',args:{class:'ItemRepresentation',values:[new Uint8Array()]}});
 emit(s.client,'rpc',{viewId:60,name:'Action3',args:{class:'ItemRepresentation',values:[new Uint8Array()]}});
 assert.deepEqual(statuses,[true]);
 emit(s.client,'rpc',{viewId:60,name:'Action1B',args:{class:'ItemRepresentation',values:[new Uint8Array(24)]}});
 assert.deepEqual(statuses,[true,false]);
});

test('A5-1 buffered torch light survives loading; a weapon\'s old swing is not replayed', ()=>{
 class Client extends EventTarget{constructor(){super();this.views=new Map();this.entities=new Map();}connect(){}}
 const session=new OnlineSession({join:{ticket:'t',endpoint:'ws://127.0.0.1:1/play'},ClientImpl:Client});
 const rpc=name=>emit(session.client,'rpc',{viewId:60,name,args:{class:'ItemRepresentation',values:[new Uint8Array()]}});
 rpc('Action2');rpc('Action3');rpc('Action2');
 assert.deepEqual([...session.actorCalls.get(60).keys()],['Action2'],'the newer of Action2/Action3 is kept, last');
 const {manifest,options,statuses,attached}=heldFixture('BasicTorchItemDataBlock');session.remote.set(30,{});session.client.views.set(60,repView());
 const h=new ServerHeldItems(session,manifest,options);h.frame();assert.deepEqual(attached,[{parent:30,lit:true}]);assert.deepEqual(statuses,[]);
 // The same retained Action3 on a melee weapon (a swing) is not run again when the page draws the representation.
 const melee=heldFixture('MeleeWeaponDataBlock'),actions=[];session.remote.set(31,{});session.actorCalls.set(61,new Map([['Action3',{viewId:61,name:'Action3',args:{class:'ItemRepresentation',values:[new Uint8Array()]}}]]));
 const m=new ServerHeldItems(session,melee.manifest,{...melee.options,action:(h,type)=>actions.push(type)});m.create(repView(61,31));m.frame();m.flush(1e9);assert.deepEqual(actions,[]);
});

test('A5-2 RigidObj: snapshots and RODone on the server stamp and the characters\' interpolation delay', ()=>{
 const session=new EventTarget();session.client=new EventTarget();session.client.views=new Map();session.actorCalls=new Map();
 // A ready ServerClock with a 9 s offset: server ms 1000 is page time 10.
 session.clock={ready:true,time:ms=>ms/1000+9};let now=10.5,lag=0.3;const done=[];
 const manifest={weapons:{g:{prefabs:{throwObjectPrefab:'g'}}},prefabs:{g:{name:'F1GrenadeWorld',components:{TimedGrenade:[{}]}}}};
 const s=new ServerRigid(session,manifest,{now:()=>now,delay:()=>lag,create:()=>({}),pose:()=>{},remove:()=>{},done:a=>done.push(a.id),bounce:()=>{}});
 const v={viewId:70,prefab:'F1GrenadeWorld',position:[0,0,0],rotation:[0,0,0,1]};session.client.views.set(70,v);emit(session.client,'create',v);
 // Two snapshots stamped 0.2 s apart that reach the page together keep their server spacing.
 emit(session.client,'rpc',{viewId:70,name:'RecieveNetwork',timestampMs:1000,serverMs:1450,args:{values:[[0,0,0],[0,0,0,1]]}});
 emit(session.client,'rpc',{viewId:70,name:'RecieveNetwork',timestampMs:1200,serverMs:1450,args:{values:[[2,0,0],[0,0,0,1]]}});
 const a=s.actors.get(70);assert.deepEqual(a.frames.map(f=>f.t),[10,10.2],'the Create frame (arrival time 10.5) gave way to the stamped snapshots');
 s.frame(10.4,0.01);assert.ok(Math.abs(a.position.x-1)<1e-9,'sampled at page time - delay (10.1)');
 emit(session.client,'rpc',{viewId:70,name:'RODone',timestampMs:1300,serverMs:1450,args:{values:[]}});
 s.frame(10.55,0.01);assert.deepEqual(done,[],'"_done" waits for Interpolation.time');s.frame(10.61,0.01);assert.deepEqual(done,[70]);
});

test('A5-18 RigidObj: a Create stamped ahead of Interpolation.time hides until it arrives, as RigidObj.__hiding does',()=>{
 const session=new EventTarget();session.client=new EventTarget();session.client.views=new Map();session.actorCalls=new Map();
 session.clock={ready:true,time:ms=>ms/1000+9};let now=10.5,lag=0.3;const poses=[];
 const manifest={weapons:{g:{prefabs:{throwObjectPrefab:'g'}}},prefabs:{g:{name:'F1GrenadeWorld',components:{TimedGrenade:[{}]}}}};
 const s=new ServerRigid(session,manifest,{now:()=>now,delay:()=>lag,create:()=>({visible:true}),pose:a=>poses.push(a.id),remove:()=>{},done:()=>{},bounce:()=>{}});
 // The Instantiate's own stamp (1300 ms server time -> page time 10.3) arrives while Interpolation.time (now-lag=10.2) is still behind it.
 const v={viewId:70,prefab:'F1GrenadeWorld',position:[0,0,0],rotation:[0,0,0,1],timestampMs:1300,serverMs:1450};
 session.client.views.set(70,v);emit(session.client,'create',v);
 const a=s.actors.get(70);assert.equal(a.hidden,true,'spawnTime (10.3) is still ahead of Interpolation.time (10.2)');assert.equal(a.view.visible,false);
 s.frame(10.4,0.01);assert.equal(a.hidden,true,'10.1 < 10.3');assert.deepEqual(poses,[],'OnHide: no pose while hidden');
 s.frame(10.7,0.01);assert.equal(a.hidden,false,'10.4 >= 10.3: "_init" fires OnShow');assert.equal(a.view.visible,true);assert.deepEqual(poses,[70]);
});

test('A5-3/A5-4/A5-5 OnlineSession: ready after attach, SVUF on our Create, a correction sets the look', ()=>{
 const sent=[];
 class Client extends EventTarget{constructor(){super();this.views=new Map();this.entities=new Map();this.characterView=null;}connect(){}ready(){sent.push('ready');}inventory(action,source){sent.push(action+':'+source.viewId);}}
 const s=new OnlineSession({join:{ticket:'t',endpoint:'ws://127.0.0.1:1/play'},ClientImpl:Client}),c=s.client;
 emit(c,'create',{viewId:5,prefab:'ServerManagement'});assert.deepEqual(sent,[],'no ClientFirstReady while the world loads');
 const looks=[],teleports=[];s.attach({teleport:p=>teleports.push(p),look:a=>looks.push(a)});assert.deepEqual(sent,['ready']);
 s.attach({teleport:()=>{}});assert.deepEqual(sent,['ready'],'once per session');
 s.attach({teleport:p=>teleports.push(p),look:a=>looks.push(a)});
 c.characterView=20;emit(c,'create',{viewId:20,prefab:':player_soldier',owner:1,position:[1,2,3]});assert.deepEqual(sent,['ready','refresh:20']);
 emit(c,'correction',{viewId:20,position:[4,5,6],angles:{yaw:0.5,pitch:-0.25}});
 assert.deepEqual(teleports.at(-1),[4,5,6]);assert.deepEqual(looks,[{yaw:0.5,pitch:-0.25}]);
 // Before attach a correction's look waits like its teleport.
 const t=new OnlineSession({join:{ticket:'t',endpoint:'ws://127.0.0.1:1/play'},ClientImpl:Client});emit(t.client,'correction',{position:[0,0,0],angles:{yaw:1,pitch:0}});
 const later=[];t.attach({teleport:()=>{},look:a=>later.push(a)});assert.deepEqual(later,[{yaw:1,pitch:0}]);
});

test('mock stack: an empty relayed Action2/Action3 reaches the page as ItemRepresentation calls; refresh is SVUF', async()=>{
 const s=await stack();
 try{
  const a=await s.join('acct-torch');
  a.peer.create({viewId:10,prefab:'ServerManagement'});a.peer.create({viewId:20,owner:a.peer.playerId,prefab:':player_soldier'});a.peer.create({viewId:21,owner:99,prefab:'torch.irp'});
  await until(()=>a.inbox.filter(e=>e.type==='create').length===3);
  a.peer.rpc(21,'Action2',[],[]);a.peer.rpc(21,'Action3',[],[]);
  await until(()=>a.inbox.filter(e=>e.type==='rpc'&&/^Action[23]$/.test(e.name)).length===2);
  const calls=a.inbox.filter(e=>e.type==='rpc'&&/^Action[23]$/.test(e.name));
  assert.deepEqual(calls.map(e=>[e.name,e.args.class]),[['Action2','ItemRepresentation'],['Action3','ItemRepresentation']]);
  assert.ok(calls.every(e=>Number.isFinite(e.timestampMs)),'stamped for the InterpTimedEvent queue');
  a.ws.send(JSON.stringify({type:'inventory',action:'refresh',source:{viewId:20}}));
  await until(()=>a.peer.received.some(h=>h.rpc==='SVUF'&&h.viewId===20));
 }finally{await s.close();}
});
