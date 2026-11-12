import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion,Euler} from 'three';
import {ServerWildlife} from '../browser/server-wildlife.mjs';
import {animalMaterial,angle2Quaternion,quaternionAngle2,angle2Rotation} from '../browser/animals.mjs';
import {PosRotInterpolator} from '../browser/airdrops.mjs';
import {meleePullOut,onlinePullOut,offlinePullOut} from '../browser/server-combat.mjs';
import {Metabolism} from '../browser/survival.mjs';
// Wildlife and survival gaps of 2026-10-23 (GAP-AUDIT "Wildlife and survival pass").
const emit=(target,type,detail)=>target.dispatchEvent(Object.assign(new Event(type),{detail}));
const close=(a,b,eps=1e-6)=>assert.ok(a.distanceTo(b)<eps,`${a.toArray()} vs ${b.toArray()}`);
const deg=Math.PI/180,forward=q=>new Vector3(0,0,1).applyQuaternion(q),up=q=>new Vector3(0,1,0).applyQuaternion(q);
function fixture({normal=new Vector3(0,1,0)}={}){
 const session=new EventTarget();session.client=new EventTarget();session.client.views=new Map();session.actorCalls=new Map();
 const manifest={animals:{wolf_prefab:{aiClass:'WolfAI',movement:{type:'NavMeshMovement'},takeDamage:{maxHealth:100},materialVariants:{mats:['coatA','coatB']}},
  chicken_prefab:{aiClass:'ChickenAI',movement:{type:'BasicWildLifeMovement'},takeDamage:{maxHealth:10},materialVariants:{roosterMat:'r',ChickenMatA:'a',ChickenMatB:'b'}}}};
 const calls=[],renderer={views:new Map(),event:(a,type,data,time)=>calls.push({a,type,data,time}),update(){}};
 const physics={groundInfo:p=>({pos:new Vector3(p.x,0,p.z),normal:normal.clone().normalize()})};
 return {session,manifest,renderer,physics,calls,now:()=>10,rng:()=>0.75};
}

test('Angle2: the client rebuilds Quaternion.Euler(-pitch, yaw, 0); positive pitch looks up; roll never reaches the wire',()=>{
 close(forward(angle2Quaternion({pitch:30,yaw:0})),new Vector3(0,Math.sin(30*deg),Math.cos(30*deg)));
 close(forward(angle2Quaternion({pitch:-20,yaw:90})),new Vector3(Math.cos(20*deg),-Math.sin(20*deg),0));
 const a=quaternionAngle2(angle2Quaternion({pitch:12,yaw:-160}));assert.ok(Math.abs(a.pitch-12)<1e-9&&Math.abs(a.yaw+160)<1e-9);
 // A slope-aligned server rotation (pitch 10, yaw 40, roll 25) keeps pitch and yaw and loses the roll.
 const q=new Quaternion().setFromEuler(new Euler(-10*deg,40*deg,25*deg,'YXZ')),wire=angle2Rotation(q),e=new Euler().setFromQuaternion(wire,'YXZ');
 assert.ok(Math.abs(e.x+10*deg)<1e-9&&Math.abs(e.y-40*deg)<1e-9&&Math.abs(e.z)<1e-9);close(forward(wire),forward(q));
});

test('online GetNetworkUpdate tilts the animal the way the client does (nose up for positive Angle2 pitch)',()=>{
 const f=fixture();f.session.client.views.set(50,{viewId:50,prefab:':wolf_prefab',position:[0,0,0],rotation:[0,0,0,1]});
 const w=new ServerWildlife(f.session,f.manifest,f),a=w.actors.get(50);
 emit(f.session.client,'rpc',{viewId:50,name:'GetNetworkUpdate',args:{values:[[1,2,3],{pitch:15,yaw:180}]}});
 close(forward(a.rotation),new Vector3(0,Math.sin(15*deg),-Math.cos(15*deg)));
 const last=f.calls.at(-1);assert.equal(last.type,'network');assert.equal(last.a,a);
});

test('online chickens take their material from the view ID and wolves a random coat, as the offline wildlife does',()=>{
 assert.equal(animalMaterial({aiClass:'ChickenAI'},2),'roosterMat');assert.equal(animalMaterial({aiClass:'ChickenAI'},5),'roosterMat');
 assert.equal(animalMaterial({aiClass:'ChickenAI'},6),'ChickenMatA');assert.equal(animalMaterial({aiClass:'ChickenAI'},7),'ChickenMatB');
 assert.equal(animalMaterial({aiClass:'WolfAI',materialVariants:{mats:['x','y','z']}},1,()=>0.5),'y');assert.equal(animalMaterial({aiClass:'BoarAI'},1),undefined);
 const f=fixture();for(const [id,prefab] of [[7,':chicken_prefab'],[3,':chicken_prefab'],[40,':wolf_prefab']])f.session.client.views.set(id,{viewId:id,prefab,position:[0,0,0],rotation:[0,0,0,1]});
 const w=new ServerWildlife(f.session,f.manifest,f);
 assert.equal(w.actors.get(7).material,'ChickenMatB');assert.equal(w.actors.get(3).material,'roosterMat');assert.equal(w.actors.get(40).material,'coatB');
});

test('online ClientDeath: own kill dies at once, others after the interpolation delay; the goal keeps the full ground normal',()=>{
 const normal=new Vector3(1,1,0).normalize(),f=fixture({normal});
 for(const id of [50,51])f.session.client.views.set(id,{viewId:id,prefab:':wolf_prefab',position:[0,0,0],rotation:[0,0,0,1]});
 f.session.client.views.set(9,{viewId:9,prefab:':player_soldier',mine:true});f.session.client.views.set(8,{viewId:8,prefab:':player_soldier',mine:false});
 const w=new ServerWildlife(f.session,f.manifest,f),mine=w.actors.get(50),other=w.actors.get(51),before=f.calls.length;
 emit(f.session.client,'rpc',{viewId:50,name:'ClientDeath',args:{values:[[5,1,6],9]}});
 assert.equal(mine.dead,true);assert.equal(mine.health,0);
 const goal=f.calls.find(c=>c.a===mine&&c.type==='goal');assert.ok(goal,'the death goal is set straight');
 close(up(goal.data.rotation),normal);close(goal.data.position,new Vector3(5,0,6));assert.deepEqual(f.calls.slice(before).map(c=>c.type),['goal'],'no NavMeshMovement-clamped network goal');
 emit(f.session.client,'rpc',{viewId:51,name:'ClientDeath',args:{values:[[2,1,2],8]}});assert.equal(other.dead,false);assert.equal(other.health,100);
 w.frame({},10.1,0.1);assert.equal(other.dead,false);w.frame({},10.5,0.1);assert.equal(other.dead,true);assert.equal(other.health,0);
});

test('move-clip speed: SampleWorldVelocity limits the gap to allowDifference + sendInterval and ignores long idle gaps',()=>{
 const i=new PosRotInterpolator({sendInterval:0.2}),q=new Quaternion();assert.equal(i.gapLimit,0.30000000000000004);
 i.setGoals(new Vector3(0,0,0),q,0);assert.equal(i.sampleWorldVelocity(-1),null);i.setGoals(new Vector3(0,0,1),q,10);
 // 10 s idle gap then a 1 m step: zero until newer - limit, then 1 m over 0.3 s.
 assert.equal(i.sampleWorldVelocity(5),null);assert.equal(i.sampleWorldVelocity(9.7),null);assert.ok(Math.abs(i.sampleWorldVelocity(9.8).length()-1/0.3)<1e-9);
 i.setGoals(new Vector3(0,0,1.6),q,10.2);assert.ok(Math.abs(i.sampleWorldVelocity(10.1).length()-3)<1e-9);
 // Past the newest sample (no newer one): Vector3.zero.
 assert.equal(i.sampleWorldVelocity(10.2),null);assert.equal(i.sampleWorldVelocity(11),null);
});

test('view-model pull_out only after hitting a TakeDamage IDMain or a tree that still had wood',()=>{
 assert.equal(meleePullOut(),false);assert.equal(meleePullOut({takeDamage:true}),true);assert.equal(meleePullOut({treeWood:true}),true);
 assert.equal(onlinePullOut({onlineActor:{viewId:5}},{flag:false}),true,'animal or player');
 assert.equal(onlinePullOut({online:{carrier:1,innerID:2},onlineDamage:true},{flag:false}),true,'structure or deployable');
 assert.equal(onlinePullOut({online:{carrier:1,innerID:3}},{target:{p1:4,p2:3},flag:false}),false,'ore or wood-pile node (no TakeDamage)');
 assert.equal(onlinePullOut({isTree:true},{flag:true}),true);assert.equal(onlinePullOut({isTree:true},{flag:false}),false,"tree with no wood left");
 assert.equal(onlinePullOut(undefined,{flag:false}),false);
 assert.equal(offlinePullOut({kind:'tree',gathered:0,hadWood:true}),true,'wood left but none added (Rock 1 in 4, full inventory)');
 assert.equal(offlinePullOut({kind:'tree',gathered:0}),false);assert.equal(offlinePullOut({kind:'resource'}),false);
 assert.equal(offlinePullOut({kind:'animal',rejected:true}),true,'the 6 m check is the server\'s');assert.equal(offlinePullOut({kind:'deployable'}),true);
 assert.equal(offlinePullOut({kind:'miss'}),false);assert.equal(offlinePullOut({kind:'other'}),false);
});

test('online Warm plaque is latched at each RecieveNetwork, not re-read per frame',()=>{
 const m=new Metabolism();m.receiveNetwork({coreTemperature:1,caloricLevel:900},0);assert.equal(m.plaqueWarm,true);assert.equal(m.caloricLevel,900);
 assert.equal(m.isWarm(1.5),false);assert.equal(m.plaqueWarm,true,'stays on between the 2 s ticks');
 m.receiveNetwork({coreTemperature:0.5},2);assert.equal(m.plaqueWarm,false);
 m.receiveNetwork({coreTemperature:1},4);m.receiveNetwork({coreTemperature:0.5},4.5);assert.equal(m.plaqueWarm,true,'within 1 s of the last warm update');
 m.receiveNetwork({coreTemperature:-1},5);assert.equal(m.plaqueWarm,false);assert.equal(m.lastWarmTime,-1000);
});
