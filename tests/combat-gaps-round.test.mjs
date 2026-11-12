import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import {Matrix4,Vector3,Ray,Box3} from 'three';
import {CollisionWorld,MovingBody,solidLayerGroups} from '../browser/collision.mjs';
import {ragdollEnvironment} from '../browser/ragdoll-environment.mjs';
import {RagdollPhysics,restMatrices,collidesWithRagdoll} from '../browser/ragdoll-physics.mjs';
import {debrisCollides} from '../browser/thrown-physics.mjs';
import {MeleeGather} from '../browser/resources.mjs';
import {MeleeState} from '../browser/server-combat.mjs';
import {ServerHeldItems} from '../browser/server-held.mjs';
import {ServerVitals} from '../browser/server-vitals.mjs';
import {deathShot} from '../browser/ragdoll-death.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const deploy=hasRecovered?(json('../browser/assets/recovered/deployables/manifest.json')):null,items=hasRecovered?(json('../browser/assets/recovered/items/manifest.json').items):null;
const physics=hasRecovered?(json('../browser/assets/recovered/physics.json')):null,ragdoll=hasRecovered?(json('../browser/assets/recovered/players/ragdoll.json')):null;
const item=name=>Object.values(items).find(i=>i.data.m_Name===name).data;
const emit=(t,type,detail)=>t.dispatchEvent(Object.assign(new Event(type),{detail}));
await R.init();

// main.mjs prefabBody with box stand-ins: one MovingBody per solid layer, the others companions of the main one.
function prefabBodies(p,boxFor){const {main,groups}=solidLayerGroups(p.colliders,p.nodes[0].layer),bodies=new Map();
 for(const [layer,colliders]of groups){const b=new MovingBody(p.name);b.layer=layer;b.solidLayers=[layer];for(const c of colliders){const {size,center}=boxFor(c);b.addBox(size,center,new Matrix4().fromArray(c.matrix));}bodies.set(layer,b);}
 const body=bodies.get(main);body.companions=[...bodies.values()].filter(b=>b!==body);return body;}
const HIT_MASK=406721553,shotSkip=b=>Boolean(b&&!((HIT_MASK>>>(b.layer??0))&1)),motorSkip=b=>Boolean(b&&!(b.solidLayers??[b.layer??0]).some(l=>(physics.player.collisionMask>>>l)&1));

test('MetalBarsWindow: its layer-29 playercol box blocks the player motor only, not bullets, melee, grenades or ragdolls',needsAssets,()=>{
 const p=deploy.prefabs[';deploy_metalwindowbars'],g=solidLayerGroups(p.colliders,p.nodes[0].layer);
 assert.equal(g.main,20);assert.deepEqual([...g.groups.keys()].sort((a,b)=>a-b),[20,29]);assert.equal(g.groups.get(29)[0].name,'playercol');
 // Original layer data: 29 is outside the bullet/arrow/melee mask and rows 18 (Debris) and 27 (Ragdoll); row 16 (players) has it.
 assert.equal((HIT_MASK>>>29)&1,0);assert.equal((physics.player.collisionMask>>>29)&1,1);assert.equal(debrisCollides(ragdoll.physics,29),false);assert.equal(collidesWithRagdoll(ragdoll.physics,29),false);
 // The bars mesh stands in as a thin box at the bars' plane; the clip box is the exported 2 x 2.5 x 0.3 one.
 const body=prefabBodies(p,c=>c.type==='BoxCollider'?{size:c.size,center:c.center}:{size:[1.28,2.6,0.06],center:[0,1.31,0]}),world=new CollisionWorld(null);
 world.addBody(body.setMotion(new Matrix4()));assert.equal(world.bodies.length,2,'companion added with its body');const clip=body.companions[0];assert.equal(clip.layer,29);
 const ray=new Ray(new Vector3(0,1.3,2),new Vector3(0,0,-1)),side=new Ray(new Vector3(0.97,1.3,2),new Vector3(0,0,-1)); // inside the 2 m clip box, 0.33 m beside the bars
 assert.equal(world.raycast(ray,5,motorSkip).body,clip,'the player motor meets the clip box first');assert.ok(Math.abs(world.raycast(ray,5,motorSkip).distance-1.85)<1e-4);
 assert.equal(world.raycast(ray,5,shotSkip).body,body,'a bullet passes the clip box and meets the bars');assert.ok(Math.abs(world.raycast(ray,5,shotSkip).distance-1.97)<1e-4);
 assert.equal(world.raycast(side,5,shotSkip),null,'beside the bars a bullet passes through');assert.equal(world.raycast(side,5,motorSkip).body,clip);
 assert.equal(world.physics2SphereCast(side,0.3,5),null,'melee (mask 406721553) ignores the clip box');assert.equal(world.physics2SphereCast(ray,0.3,5)?.body,body);
 const area=new Vector3(0,1.3,0),tris=layerFn=>ragdollEnvironment(world,area,5,layerFn).length;
 assert.equal(tris(l=>debrisCollides(ragdoll.physics,l)),12,'grenades meet the bars box only');assert.equal(tris(l=>collidesWithRagdoll(ragdoll.physics,l)),0,'ragdolls (row 27) meet neither (Mechanical 20 included)');
 // Companions move and leave with their body.
 body.setMotion(new Matrix4().makeTranslation(10,0,0));assert.ok(clip.box.containsPoint(new Vector3(10,1.3,0)));world.removeBody(body);assert.equal(world.bodies.length,0);
 // A prefab with one solid layer keeps one body (spike walls: layer-26 trigger root, layer-10 box).
 const spike=Object.values(deploy.prefabs).find(x=>x.components.SpikeWall);assert.equal(solidLayerGroups(spike.colliders,spike.nodes[0].layer).main,10);assert.equal(solidLayerGroups(spike.colliders,spike.nodes[0].layer).groups.size,1);
});

test('offline melee mirrors MeleeState: deployLength after equipping and AltFire holds both attacks for fireRate',needsAssets,()=>{
 for(const name of ['Rock','Hatchet']){const d=item(name),melee=new MeleeGather(),state=new MeleeState(d);assert.equal(d.deployLength,0.75);
  melee.activate(10,d);state.activate(10);const idle={sprinting:false};
  const both=(t,input)=>{const a=melee.frame(t,{...idle,...input},d),b=state.frame(t,{...idle,...input}).some(e=>e.type==='swing');assert.equal(a,b,`${name} ${t}`);return a;};
  assert.equal(both(10.5,{attack:true}),false,'no swing before deployFinishedTime');assert.equal(both(10.75,{attack:true}),true);
  assert.equal(both(10.75+d.fireRate-0.01,{attack:true}),false);
  const t=10.75+d.fireRate;assert.equal(both(t,{attack2:true}),false,'AltFire never swings');assert.equal(both(t+d.fireRate-0.01,{attack:true}),false,'AltFire moved the primary time on');
  assert.equal(both(t+d.fireRate,{attack:true}),true);
  // Re-equipping during a pending swing clears it; an earlier deploy cannot shorten a later attack time.
  melee.activate(t+d.fireRate+0.1,d);assert.equal(melee.dueSwing(100),null);assert.equal(melee.next,t+d.fireRate+d.fireRate);}
});

test('AddExplosionForce on a corpse: away from the lowered centre, linear falloff, nothing beyond the radius',needsAssets,()=>{
 const matrices=restMatrices(ragdoll.nodes).map(m=>new Matrix4().makeTranslation(0,0.1,0).multiply(m)),p=new RagdollPhysics(R,ragdoll,matrices);
 try{const center={x:0,y:0.5,z:2},root=p.bodies[0],com=root.worldCom(),before=p.bodies.map(b=>b.linvel());
  assert.equal(p.explosionForce(500,{x:0,y:0.5,z:30},6,2),0,'beyond the radius');
  const n=p.explosionForce(500,center,6,2);assert.equal(n,p.bodies.reduce((s,b)=>s+b.colliders.length,0),'every collider within 6 m');
  const v=root.linvel(),dv=new Vector3(v.x-before[0].x,v.y-before[0].y,v.z-before[0].z),d=Math.hypot(com.x-center.x,com.y-center.y,com.z-center.z);
  const expected=500*(1-d/6)*p.step/root.mass(),dir=new Vector3(com.x-center.x,com.y-center.y+2,com.z-center.z).normalize();
  assert.ok(Math.abs(dv.length()-expected)<1e-4,`${dv.length()} vs ${expected}`);assert.ok(dv.clone().normalize().dot(dir)>0.9999);assert.ok(dv.y>0&&dv.z<0);
 }finally{p.dispose();}
});

function heldFixture(kind){const s=new EventTarget();s.client=new EventTarget();s.client.views=new Map();s.remote=new Map([[30,{}]]);s.client.views.set(30,{});
 const manifest={held:{m4:{uid:-123,item:'M4',netName:'m4.irp',prefab:'m4'}},weapons:{m4:{class:kind}}},events=[],actions=[];let clock=10;
 const b=new Uint8Array(6),dv=new DataView(b.buffer);dv.setUint16(0,30,true);dv.setInt32(2,-123,true);s.client.views.set(60,{viewId:60,prefab:'m4.irp',initialData:b});
 const h=new ServerHeldItems(s,manifest,{attach:(parent,x)=>{events.push([parent,x.rep]);return true;},detach:parent=>events.push([parent,null]),action:(_,type)=>actions.push([type,clock]),now:()=>clock,delay:()=>0.3});h.frame(clock);
 return {s,h,events,actions,tick:t=>{clock=t;h.frame(t);}};}

test('remote item actions and InterpDestroy run on the interpolation clock (timestamp + delay)',()=>{
 const {s,h,events,actions,tick}=heldFixture('MeleeWeaponDataBlock');assert.deepEqual(events,[[30,60]]);
 // Stamped 100 ms before the bridge's server clock: due at 10 - 0.1 + 0.3.
 emit(s.client,'rpc',{viewId:60,name:'Action3',args:{values:[]},timestampMs:900,serverMs:1000});assert.equal(actions.length,0,'queued, not run on arrival');
 tick(10.19);assert.equal(actions.length,0);tick(10.21);assert.deepEqual(actions,[['swing',10.21]]);
 // Unstamped calls fall back to their arrival time.
 tick(11);emit(s.client,'rpc',{viewId:60,name:'InterpDestroy',args:{values:[]}});s.client.views.delete(60);emit(s.client,'destroy',{});
 assert.ok(h.items.has(60),'DontDestroyWithNetwork: kept until InterpDestroy runs');assert.deepEqual(events.at(-1),[30,60]);
 tick(11.29);assert.ok(h.items.has(60));tick(11.31);assert.equal(h.items.has(60),false);assert.deepEqual(events.at(-1),[30,null]);
});

test('a native Destroy without InterpDestroy still removes the representation at once; plain OnStatus is not delayed',()=>{
 const {s,h,events}=heldFixture('TorchItemDataBlock');const statuses=[];h.status=(_,lit)=>statuses.push(lit);
 emit(s.client,'rpc',{viewId:60,name:'OnStatus',args:{values:[true]},timestampMs:0,serverMs:1000});assert.deepEqual(statuses,[true]);
 s.client.views.delete(60);emit(s.client,'destroy',{});assert.equal(h.items.has(60),false);assert.deepEqual(events.at(-1),[30,null]);
});

test('ClientVitalsSync DMG: health changes wait for the interpolation clock and death runs the pending ones first',()=>{
 const s=new EventTarget();s.state='in-game';s.vitalsCalls=new Map();let clock=10;const seen=[],deaths=[];
 const v=new ServerVitals(s,{now:()=>clock,delay:()=>0.3,onHealth:(health,attacker)=>seen.push([health,attacker]),onDeath:()=>deaths.push(seen.length)});
 emit(s,'vitals-call',{name:'Local_HealthChange',args:[80,7],receivedAt:10,timestampMs:5000,serverMs:5000});assert.equal(v.health,100);
 clock=10.29;v.frame();assert.equal(v.health,100);clock=10.3;v.frame();assert.equal(v.health,80);assert.deepEqual(seen,[[80,7]]);
 emit(s,'vitals-call',{name:'Local_HealthChange',args:[30,7],receivedAt:11,timestampMs:6000,serverMs:6000});emit(s,'vitals-call',{name:'Client_OnKilledBy',args:[7],receivedAt:11.01});
 assert.deepEqual(seen,[[80,7],[30,7]],'InterpTimedEvent.Clear(invokePending) on the local death');assert.deepEqual(deaths,[2]);assert.equal(v.health,0);
});

test('deathShot keeps the killer of the By variants (a local kill ragdolls at once)',()=>{
 const call=(name,values)=>({name,args:{class:'DeathTransfer',values}});
 assert.deepEqual(deathShot(call('Client_OnKilled',[])),{shot:null});assert.deepEqual(deathShot(call('Client_OnKilledBy',[30])),{shot:null,attacker:30});
 assert.equal(deathShot(call('Client_OnKilledShotBy',[31,[1,2,3],{pitch:0,yaw:0},5])).attacker,31);assert.equal(deathShot(call('Client_OnKilledShot',[[1,2,3],{pitch:0,yaw:0},5])).attacker,undefined);
});
