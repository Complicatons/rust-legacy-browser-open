import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import {Matrix4,Vector3,Box3} from 'three';
import {RagdollPhysics,restMatrices} from '../browser/ragdoll-physics.mjs';
import {deathShot} from '../browser/ragdoll-death.mjs';
import {ragdollEnvironment} from '../browser/ragdoll-environment.mjs';
import {CollisionWorld,MovingBody,GridBody} from '../browser/collision.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const def=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/ragdoll.json',import.meta.url)))):null;
await R.init();
test('recovered native ragdoll has 23 bodies, 16 character and six hinge joints, and sleep pose',needsAssets,()=>{
 assert.equal(def.bodies.length,23);assert.equal(def.joints.filter(j=>j.type==='CharacterJoint').length,16);assert.equal(def.joints.filter(j=>j.type==='HingeJoint').length,6);assert.ok(def.animations[def.poses.sleep.clip].tracks.length>20);
});
test('native body masses, joint anchors and every angular limit survive physics creation',needsAssets,()=>{
 const p=new RagdollPhysics(R,def,restMatrices(def.nodes));try{
  p.bodies.forEach((b,i)=>assert.ok(Math.abs(b.mass()-def.bodies[i].data.m_Mass)<1e-5));
  p.joints.forEach((j,i)=>{const s=def.joints[i],a=j.anchor1(),b=j.anchor2(),ba=j.body1(),bb=j.body2(),world=(body,v)=>new Vector3(v.x,v.y,v.z).applyQuaternion(body.rotation()).add(body.translation());assert.ok(world(ba,a).distanceTo(world(bb,b))<1e-5);
   const r=Math.PI/180;
   // Rapier's hinge angle is the connected body relative to the jointed one: the source range is negated.
   if(s.type==='HingeJoint'){assert.ok(Math.abs(p.world.impulseJoints.raw.jointLimitsMin(j.handle,3)+s.data.m_Limits.max*r)<1e-6);assert.ok(Math.abs(p.world.impulseJoints.raw.jointLimitsMax(j.handle,3)+s.data.m_Limits.min*r)<1e-6);}
   else{const l=p.limits.find(l=>l.joint===j);assert.ok(Math.abs(l.low-s.data.m_LowTwistLimit.limit*r)<1e-6&&Math.abs(l.high-s.data.m_HighTwistLimit.limit*r)<1e-6);assert.ok(Math.abs(l.swing1-s.data.m_Swing1Limit.limit*r)<1e-6&&Math.abs(l.swing2-s.data.m_Swing2Limit.limit*r)<1e-6);}
   assert.equal(j.contactsEnabled(),false);
  });
 }finally{p.dispose();}
});
test('ragdoll falls, remains connected and settles on cosmetic ground without nonfinite poses',needsAssets,()=>{
 const matrices=restMatrices(def.nodes).map(m=>new Matrix4().makeTranslation(0,2,0).multiply(m)),p=new RagdollPhysics(R,def,matrices);
 try{p.setEnvironment([[-20,0,-20,20,0,20,20,0,-20],[-20,0,-20,-20,0,20,20,0,20]]);const initial=p.bodies[0].translation().y;
  for(let i=0;i<400;i++)p.update(.02);
  const positions=p.bodies.map(b=>b.translation());assert.ok(positions.every(v=>[v.x,v.y,v.z].every(Number.isFinite)&&v.y>-.15&&v.y<1.5));assert.ok(positions[0].y<initial-1);
  for(const j of p.joints){const a=j.anchor1(),b=j.anchor2(),wa=new Vector3(a.x,a.y,a.z).applyQuaternion(j.body1().rotation()).add(j.body1().translation()),wb=new Vector3(b.x,b.y,b.z).applyQuaternion(j.body2().rotation()).add(j.body2().translation());assert.ok(wa.distanceTo(wb)<.1);}
 }finally{p.dispose();}
});
test('queued shot uses one fixed-step force equivalent at the named body, including torque',needsAssets,()=>{
 const p=new RagdollPhysics(R,def,restMatrices(def.nodes));try{assert.equal(p.shot('unknown',[0,0,0],[0,0,1]),false);assert.equal(p.shot(def.bodies[0].name,[.1,0,0],[0,0,1]),true);assert.ok(p.bodies[0].linvel().z>9);assert.ok(Math.abs(p.bodies[0].angvel().y)>1);}finally{p.dispose();}
});
test('only complete native DeathTransfer messages select ragdolls and positive-up shot directions',()=>{
 const call=(name,values)=>({name,args:{class:'DeathTransfer',values}});
 assert.deepEqual(deathShot(call('Client_OnKilled',[])),{shot:null});assert.ok(deathShot(call('Client_OnKilledBy',[30])));
 const shot=deathShot(call('Client_OnKilledShotBy',[30,[1,2,3],{pitch:90,yaw:0},5])).shot;assert.deepEqual(shot.point,[1,2,3]);assert.ok(shot.direction[1]>.999);
 assert.equal(deathShot(call('Client_OnKilledShot',[[0,0,0],{pitch:NaN,yaw:0},5])),null);assert.equal(deathShot(call('Client_OnKilled',[1])),null);assert.equal(deathShot({name:'Client_OnKilled',args:{class:'Context',values:[]}}),null);
});
test('cosmetic environment reads static, grid and moved triangle collision with layer exclusions',()=>{
 const w=new CollisionWorld(()=>0),points=Float32Array.of(0,1,0,1,1,0,0,1,1),indices=Uint32Array.of(0,1,2);w.addGeometry(points,indices);w.addBody(new GridBody('tree',points,indices));const b=new MovingBody('door');b.addGeometry(points,indices);b.setMotion(new Matrix4().makeTranslation(3,0,0));w.addBody(b);w.build();
 const area=new Box3(new Vector3(-2,-2,-2),new Vector3(5,3,3));assert.equal(w.nearbyTriangles(area).length,3);b.layer=27;const triangles=ragdollEnvironment(w,new Vector3(),4);assert.ok(triangles.length>2);assert.equal(triangles.filter(t=>t.every((v,i)=>i%3!==1||v===1)).length,2);
});
