// Third-person and online timing edge cases (GAP-AUDIT "Third-person and online timing, 2026-10-23"):
//  1 one stable server clock for snapshots and timed events (server-clock.mjs, airdrops.mjs callTime);
//  2 a dying remote player's hit boxes go at the death RPC's arrival (player-view.mjs disableHit);
//  3 an old held representation stays and runs its own events until its InterpDestroy (server-held.mjs);
//  4 a dying remote player keeps its representations and their events until "RAG" (server-held.mjs hold/release);
//  5 the local death ragdoll starts from the animated pose (player-view.mjs localDeath);
//  6 censor.nudity rebinds corpses (player-view.mjs);
//  7 the first ReadClientMove after a Create is not a goal (player-motion.mjs placeRemote).
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {ServerClock} from '../browser/server-clock.mjs';
import {callTime,interpolationDelay} from '../browser/airdrops.mjs';
import {placeRemote,sampleRemote} from '../browser/player-motion.mjs';
import {ServerHeldItems} from '../browser/server-held.mjs';
import {needsAssets} from './helpers/assets.mjs';
// player-view.mjs imports three by its served URL; in Node it is the package.
registerHooks({resolve(specifier,context,next){return next(specifier==='/vendor/three.module.js'?'three':specifier,context);}});
const emit=(t,type,detail)=>t.dispatchEvent(Object.assign(new Event(type),{detail}));
// Deterministic jitter.
const rng=(seed=7)=>()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};

// A remote player walking +x at 5 m/s, ReadClientMove every 0.2 s (sendRate 5). Server send time ts; it reaches the
// gateway 20 ms later (serverMs, the bridge clock); the page processes it after a further 10-70 ms of jitter, and at
// every sixth message the main thread hitches 250 ms (no frames), so everything waiting is processed in one batch at the
// same page time when it ends.
function stream(n=80){const r=rng(),out=[],hitches=[];let hitchUntil=-1;
 for(let i=0;i<n;i++){const ts=100000+i*200,serverMs=ts+20;let page=500+(serverMs/1000-100)+0.01+r()*0.06;
  if(page<hitchUntil)page=hitchUntil;else if(i%6===3){hitchUntil=page+0.25;hitches.push([page,hitchUntil]);page=hitchUntil;}
  out.push({i,timestampMs:ts,serverMs,receivedAt:page,position:[i*1,0,0]});}
 out.sort((a,b)=>a.receivedAt-b.receivedAt||a.i-b.i);out.hitches=hitches;return out;}
const spread=xs=>Math.max(...xs)-Math.min(...xs);

test('ServerClock: jittered and batched arrivals keep the server spacing of snapshot times',()=>{
 const clock=new ServerClock(),msgs=stream(),stable=[],perMessage=[];
 for(const m of msgs){clock.observe(m.serverMs,m.receivedAt);stable.push([m.i,callTime(m,m.receivedAt,clock)]);perMessage.push([m.i,callTime(m,m.receivedAt)]);}
 const gaps=list=>{const t=new Map(list);return list.map(([i])=>i).filter(i=>i>=10&&t.has(i-1)).map(i=>t.get(i)-t.get(i-1));};
 const g=gaps(stable),old=gaps(perMessage);
 assert.ok(g.every(d=>Math.abs(d-0.2)<0.01),`every gap 0.2 s +- 10 ms (spread ${spread(g).toFixed(4)} s)`);
 assert.ok(spread(old)>0.2,`the per-message reference collapses batches (spread ${spread(old).toFixed(3)} s)`);
 // The clock sits on the latency floor: no snapshot lands after the page received it.
 for(const m of msgs.slice(10))assert.ok(callTime(m,m.receivedAt,clock)<=m.receivedAt+1e-9);
});

test('ServerClock: interpolated positions and speeds stay smooth through the hitches (no snapping or speed pulsing)',()=>{
 const delay=interpolationDelay(5),sampleSpeeds=withClock=>{const clock=new ServerClock(),v={snapshots:[]};placeRemote(v,{position:[-1,0,0]},0,{goal:false});
  const msgs=stream(),speeds=[];let k=0,last=null;
  for(let t=500.5;t<516;t+=1/60){const h=msgs.hitches.find(([a,b])=>t>=a&&t<b);if(h)t=h[1]; // no frame while the main thread hitches
   while(k<msgs.length&&msgs[k].receivedAt<=t+1e-9){const m=msgs[k++];clock.observe(m.serverMs,t);placeRemote(v,{position:m.position},callTime(m,t,withClock?clock:null));}
   const s=sampleRemote(v,t-delay,{sendInterval:0.2});if(last&&t>503)speeds.push((s.position[0]-last.x)/(t-last.t));last={x:s.position[0],t};}
  return speeds;};
 const smooth=sampleSpeeds(true),old=sampleSpeeds(false);
 assert.ok(smooth.every(s=>Math.abs(s-5)<0.3),`5 m/s throughout (min ${Math.min(...smooth).toFixed(2)}, max ${Math.max(...smooth).toFixed(2)})`);
 assert.ok(spread(old)>3,`(the per-message times pulse: ${Math.min(...old).toFixed(1)}..${Math.max(...old).toFixed(1)} m/s)`);
});

test('ServerClock: a lasting latency rise is followed after the window; a large clock step snaps; reset forgets',()=>{
 const c=new ServerClock({window:5,slew:0.05,snap:0.5});
 for(let i=0;i<20;i++)c.observe(1000+i*200,10+i*0.2+0.03);close(c.offset,10-1+0.03);
 // +100 ms latency from now on: inside the window the old floor holds, afterwards the offset slews up (<= 50 ms/s).
 for(let i=20;i<40;i++)c.observe(1000+i*200,10+i*0.2+0.13);close(c.offset,9.03,1e-9);
 for(let i=40;i<80;i++)c.observe(1000+i*200,10+i*0.2+0.13);close(c.offset,9.13,1e-9);
 // The gateway's server clock resyncs by 2 s: snapped at once.
 c.observe(1000+80*200+2000,10+80*0.2+0.13);close(c.offset,7.13,1e-9);
 c.reset();assert.equal(c.ready,false);assert.equal(callTime({timestampMs:5,serverMs:5},3,c),3,'unready clock: per-message fallback');
});
function close(a,b,eps=1e-6){assert.ok(Math.abs(a-b)<=eps,`${a} vs ${b}`);}

test('OnlineSession feeds its ServerClock from every stamped message',async()=>{
 const {OnlineSession}=await import('../browser/online.mjs');let now=50;
 class Client extends EventTarget{constructor(){super();this.views=new Map();this.entities=new Map();}connect(){}}
 const s=new OnlineSession({join:{ticket:'t',endpoint:'ws://127.0.0.1:1/play'},ClientImpl:Client,now:()=>now});
 assert.equal(s.clock.ready,false);emit(s.client,'rpc',{viewId:5,name:'X',args:{values:[]},timestampMs:900,serverMs:1000});close(s.clock.offset,49);
 now=50.5;emit(s.client,'remote-move',{viewId:6,position:[0,0,0],timestampMs:1400,serverMs:1450});close(s.clock.offset,49,1e-9,'a later (slower) arrival leaves the floor');
 close(callTime({timestampMs:1400,serverMs:1450},now,s.clock),50.4,1e-9);
 emit(s.client,'closed',{});assert.equal(s.clock.ready,false);
});

test('placeRemote: the first ReadClientMove after the Create only moves the rest pose (HumanController firstState)',()=>{
 const v={snapshots:[]};assert.equal(placeRemote(v,{position:[0,0,0]},1,{goal:false}),false);
 assert.equal(placeRemote(v,{position:[100,0,0],yaw:1,flags:2},2),false,'firstState: origin/angles/flags set, no SetGoals');
 assert.equal(v.snapshots.length,0);assert.deepEqual(sampleRemote(v,0).position,[100,0,0]);assert.equal(sampleRemote(v,0).flags,2);
 assert.equal(placeRemote(v,{position:[101,0,0]},2.2),true,'the second is the first goal');assert.equal(v.snapshots.length,1);
 assert.deepEqual(sampleRemote(v,5).position,[101,0,0]);
});

// ServerHeldItems fixtures: parent 30 with representations of one item.
function held(kind='BulletWeaponDataBlock'){const s=new EventTarget();s.client=new EventTarget();s.client.views=new Map([[30,{}]]);s.remote=new Map([[30,{}]]);let clock=10;
 const manifest={held:{m4:{uid:-123,item:'M4',netName:'m4.irp',prefab:'m4'}},weapons:{m4:{class:kind}}},events=[],actions=[];
 const view=id=>{const b=new Uint8Array(6),d=new DataView(b.buffer);d.setUint16(0,30,true);d.setInt32(2,-123,true);return {viewId:id,prefab:'m4.irp',initialData:b};};
 const h=new ServerHeldItems(s,manifest,{attach:(p,x)=>{events.push(['attach',p,x.rep]);return true;},detach:(p,rep)=>events.push(['detach',p,rep]),action:(x,type)=>actions.push([x.rep,type,clock]),now:()=>clock,delay:()=>0.3});
 const add=id=>{const v=view(id);s.client.views.set(id,v);emit(s.client,'create',v);h.frame(clock);};
 return {s,h,events,actions,add,tick:t=>{clock=t;h.frame(t);}};}
const shot=()=>{const b=new Uint8Array(13);b[0]=255;return b;};

test('fast item switch: the old representation stays until its InterpDestroy and still runs its queued Action1',()=>{
 const {s,h,events,actions,add,tick}=held();add(60);
 // HeldItem.OnSetActive(false) of 60 right after a shot: Action1, InterpDestroy, NetCull.Destroy; the new item 61 at once.
 emit(s.client,'rpc',{viewId:60,name:'Action1B',args:{values:[shot()]},timestampMs:9950,serverMs:10000});
 emit(s.client,'rpc',{viewId:60,name:'InterpDestroy',args:{values:[]},timestampMs:9960,serverMs:10000});
 s.client.views.delete(60);emit(s.client,'destroy',{});add(61);
 assert.deepEqual(events,[['attach',30,60],['attach',30,61]],'61 attaches at once, 60 is not detached');assert.equal(h.active.get(30),61);
 // Due at 10 - 0.05 + 0.3 (Action1) and 10 - 0.04 + 0.3 (InterpDestroy).
 tick(10.255);assert.deepEqual(actions,[[60,'gun',10.255]],'the old representation fires with its own identity (its muzzle)');assert.ok(h.items.has(60));
 tick(10.27);assert.equal(h.items.has(60),false);assert.deepEqual(events.at(-1),['detach',30,60]);assert.equal(h.active.get(30),61,'the holder keeps the new one');
});

test('a dying remote player keeps its representations and their queued events until RAG, which runs them',()=>{
 const {s,h,events,actions,add,tick}=held();add(60);
 // DeathTransfer: the death RPC queues RAG (main.mjs death -> hold); the server's OnKilled sends, in the same tick, the
 // shot's Action1, DropInventoryContents -> InterpDestroy, then DestroyCharacter.
 h.hold(30);
 emit(s.client,'rpc',{viewId:60,name:'Action1B',args:{values:[shot()]},timestampMs:10000,serverMs:10000});
 emit(s.client,'rpc',{viewId:60,name:'InterpDestroy',args:{values:[]},timestampMs:10000,serverMs:10000});
 s.client.views.delete(60);s.client.views.delete(30);s.remote.delete(30);emit(s.client,'destroy',{});tick(10.1);
 assert.ok(h.items.has(60),'kept past the character\'s network Destroy');assert.equal(h.active.get(30),60,'item pose kept');assert.equal(events.filter(e=>e[0]==='detach').length,0);assert.equal(actions.length,0);
 // RAG (here earlier than the events' own time: a death the local player caused runs at once).
 h.release(30);assert.deepEqual(actions.map(a=>a.slice(0,2)),[[60,'gun']],'ItemRepresentation.OnDestroy: invokePending');
 assert.equal(h.items.size,0);assert.deepEqual(events.at(-1),['detach',30,60]);assert.equal(h.pending.length,0);
});

// ---------------------------------------------------------------- player-view (recovered player export + Rapier)
const players=new URL('../browser/assets/recovered/players/',import.meta.url),deployables=new URL('../browser/assets/recovered/deployables/',import.meta.url);
async function renderer(){
 const THREE=await import('three'),R=(await import('@dimforge/rapier3d-compat')).default;await R.init();
 const {createPlayerRenderer}=await import('../browser/player-view.mjs'),{CollisionWorld}=await import('../browser/collision.mjs');
 const pm=JSON.parse(readFileSync(new URL('manifest.json',players))),clips=JSON.parse(readFileSync(new URL(pm.clipsFile,players))),ragdollData=JSON.parse(readFileSync(new URL('ragdoll.json',players)));
 const dm=JSON.parse(readFileSync(new URL('manifest.json',deployables)));
 const assets={binary:async(desc,Type)=>{const b=await readFile(new URL(desc.file,players));return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));},material:async()=>new THREE.MeshBasicMaterial()};
 const scene=new THREE.Scene(),collisionWorld=new CollisionWorld(),heldTemplates=new Map(Object.values(dm.held).map(h=>[h.prefab,new THREE.Group()]));
 const r=await createPlayerRenderer(scene,pm,clips,assets,{collisionWorld,heldManifest:dm,heldTemplates,ragdollData,physicsEngine:R});
 return {THREE,r,pm,dm,collisionWorld};}
const walk=(r,id,n=10)=>{r.upsert({viewId:id,position:[0,0,0],rotation:[0,0,0,1]},0,{goal:false});for(let i=0;i<n;i++)r.upsert({viewId:id,position:[i*0.4,0,0],rotation:[0,0,0,1],angles:{yaw:0,pitch:0},stateFlags:0},i*0.2);r.update(n*0.2,1/60);};

test('player-view: death RPC arrival disables the hit boxes; several held representations, each with its own muzzle',needsAssets,async()=>{
 const {THREE,r,dm,collisionWorld}=await renderer();walk(r,30);const v=r.views.get(30),boxes=[...v.hitboxes];
 assert.ok(boxes.length>0&&boxes.every(b=>collisionWorld.bodies.includes(b)));
 const center=new THREE.Vector3().setFromMatrixPosition(v.bones[4].matrixWorld);assert.ok(r.hitBroadphase(center,0.1),'HB Hit on while alive');
 const [a,b]=Object.values(dm.held).filter(h=>h.muzzleMatrix).slice(0,2);
 assert.ok(r.attachHeld(30,{...a,rep:60,parent:30}));assert.ok(r.attachHeld(30,{...b,rep:61,parent:30}));
 assert.equal(v.held.rep,61,'the newest is the holder\'s');assert.deepEqual([...v.reps.keys()],[60,61]);
 r.update(2.1,1/60);assert.ok(r.heldMuzzle(30,60)&&r.heldMuzzle(30,61));
 assert.ok(r.detachHeld(30,61));assert.equal(v.held,null,'InventoryHolder.ClearItemRepresentation of the holder\'s own');assert.ok(r.heldMuzzle(30,60),'60 still drawn');
 r.disableHit(30);assert.equal(v.hitboxes.length,0);assert.ok(boxes.every(b=>!collisionWorld.bodies.includes(b)),'child colliders off');
 assert.equal(r.hitBroadphase(center,0.5),null,'HB Hit off');assert.ok(r.views.has(30),'the character stays until RAG');
 assert.ok(r.ragdoll(30,3));assert.equal(v.reps.size,0);r.clear();
});

test('player-view: censor.nudity rebinds corpses too; the local death ragdoll starts from the animated pose',needsAssets,async()=>{
 const {r}=await renderer(),{censorship}=await import('../browser/armor.mjs');walk(r,30);assert.ok(r.ragdoll(30,3));const corpse=[...r.ragdolls][0],before=[...corpse.armor];
 censorship.set(false);try{assert.notDeepEqual(corpse.armor,before,'the corpse binds the uncensored models');assert.equal(corpse.meshes.length,before.length);}finally{censorship.set(true);}
 assert.deepEqual(corpse.armor,before);
 // DeathTransfer.CreateRagdoll links the live pose: one settled sampler step, not the bind pose.
 assert.ok(r.localDeath({viewId:99,position:[5,0,5],rotation:[0,0,0,1],angles:{yaw:0.5,pitch:0.2},armor:[0,0,0,0]},4,null,null,{flags:0,group:'noitem',velocity:[0,0,0]}));
 const local=[...r.ragdolls].find(x=>x!==corpse),top=[...local.weights].filter(([,w])=>w>0.5);
 assert.ok(top.length>0,`an idle clip carries the pose (weights ${JSON.stringify([...local.weights])})`);
 assert.ok(local.meshes.every(m=>m.visible===false));censorship.set(false);try{assert.ok(local.meshes.every(m=>m.visible===false),'rebinding keeps the own corpse hidden');}finally{censorship.set(true);}
 r.clear();
});