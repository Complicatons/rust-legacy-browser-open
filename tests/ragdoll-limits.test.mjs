import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import {Matrix4,Quaternion,Vector3,Ray} from 'three';
import {RagdollPhysics,RagdollWorld,restMatrices,swingTwist,swingConeViolation,collidesWithRagdoll,clampJointRotation,CORPSE_SUBSTEPS} from '../browser/ragdoll-physics.mjs';
import {RagdollCorpseBody} from '../browser/ragdoll-corpse.mjs';
import {LegacyAnimation} from '../browser/legacy-animation.mjs';
const tessellated=[];for(let x=-20;x<20;x+=2)for(let z=-20;z<20;z+=2){const a=[x,0,-z],b=[x+2,0,-z],c=[x,0,-z-2],d=[x+2,0,-z-2];tessellated.push([...a,...b,...c],[...b,...d,...c]);}
import {CollisionWorld} from '../browser/collision.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const def=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/ragdoll.json',import.meta.url)))):null;
await R.init();
const r=Math.PI/180,near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const floor=[[-20,0,-20,20,0,20,20,0,-20],[-20,0,-20,-20,0,20,20,0,20]];

test('exported PhysicsManager/TimeManager, IgnoreColliders pairs and layer 27 bodies',needsAssets,()=>{
 const p=def.physics;near(p.fixedTimestep,0.02);near(p.maximumAllowedTimestep,1/3);near(p.gravity.y,-9.81,1e-5);assert.equal(p.solverIterationCount,7);near(p.maxAngularVelocity,7);
 near(p.sleepVelocity,0.15);near(p.sleepAngularVelocity,0.14);assert.equal(p.layerCollisionMatrix.length,32);
 assert.equal(def.ignore.length,70);assert.ok(def.ignore.every(([a,b])=>a<b&&b<def.bodies.length));assert.ok(def.bodies.every(b=>b.layer===27));
 // Layer 27 "Ragdoll" collides with Default, Static, CULL500, Terrain, Vehicle and other ragdolls,
 // never with Character Collision, Debris, Mechanical, RayOnly or Zone.
 for(const layer of [0,10,12,19,27,28])assert.ok(collidesWithRagdoll(p,layer),String(layer));
 for(const layer of [16,18,20,21,26])assert.ok(!collidesWithRagdoll(p,layer),String(layer));
});

test('swing/twist decomposition and the elliptical PhysX swing cone',()=>{
 const q=(axis,deg)=>new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(),deg*r);
 let s=swingTwist(q([1,0,0],30));near(s.twist,30*r);near(s.swing1,0);near(s.swing2,0);
 s=swingTwist(q([0,1,0],20).multiply(q([1,0,0],-40)));near(s.twist,-40*r);near(s.swing1,20*r);near(s.swing2,0,1e-9);
 // The quaternion sign never pushes the twist past 180 degrees.
 const flipped=q([1,0,0],170);flipped.set(-flipped.x,-flipped.y,-flipped.z,-flipped.w);near(swingTwist(flipped).twist,170*r);
 assert.equal(swingConeViolation(19*r,0,20*r,10*r),null);assert.equal(swingConeViolation(0,9*r,20*r,10*r),null);
 // 15/20 and 8/10: inside each per-axis limit but outside the ellipse (0.5625 + 0.64 > 1).
 const v=swingConeViolation(15*r,8*r,20*r,10*r);assert.ok(v&&v.error>0);near(Math.hypot(...v.normal),1);
});

test('the original sleep pose fits the knee and elbow hinge ranges only in the child-relative angle sense',needsAssets,()=>{
 const pose=def.poses.sleep,values=new LegacyAnimation(def.nodes,def.animations).sample([{name:pose.clip,time:pose.time,weight:1}],0);
 const posed=restMatrices(def.nodes.map((n,i)=>({...n,...values[i]}))),rest=restMatrices(def.nodes),rot=m=>new Quaternion().setFromRotationMatrix(m);
 const hinges=def.joints.filter(j=>j.type==='HingeJoint'&&/Knee|Forearm/.test(def.bodies.find(b=>b.bone===j.bone).name));assert.equal(hinges.length,4);
 for(const j of hinges){
  const a=new Vector3(j.data.m_Axis.x,j.data.m_Axis.y,j.data.m_Axis.z).normalize(),f1=new Quaternion().setFromUnitVectors(new Vector3(1,0,0),a),pb=def.bodies[j.connectedBody].bone;
  const f2=rot(rest[pb]).invert().multiply(rot(rest[j.bone])).multiply(f1),fa=rot(posed[j.bone]).multiply(f1),fb=rot(posed[pb]).multiply(f2);
  const child=swingTwist(fb.clone().invert().multiply(fa)).twist/r,parent=swingTwist(fa.clone().invert().multiply(fb)).twist/r,{min,max}=j.data.m_Limits;
  assert.ok(child>=min-1&&child<=max+1,`child ${child}`);assert.ok(!(parent>=min-1&&parent<=max+1),`parent ${parent}`);
 }
});

test('dropped from 1 m and 2 m onto a tessellated floor, a ragdoll stays above it and falls asleep',needsAssets,()=>{
 const tri=tessellated;
 for(const height of [1,2]){const p=new RagdollPhysics(R,def,restMatrices(def.nodes).map(m=>new Matrix4().makeTranslation(0,height,0).multiply(m)));
  try{p.setEnvironment(tri);p.shot(def.bodies[0].name,[0,0,0],[0,0,1]);for(let i=0;i<500;i++)p.update(0.02);
   for(const b of p.bodies){const t=b.translation();assert.ok([t.x,t.y,t.z].every(Number.isFinite)&&t.y>-0.15&&t.y<1,`${height} m: ${t.y}`);}
   assert.ok(p.bodies.every(b=>b.isSleeping()),'corpse sleeps');
  }finally{p.dispose();}}
});

test('the joint-space projection puts a joint back on its cone without separating anchors or adding energy',needsAssets,()=>{
 const p=new RagdollPhysics(R,def,restMatrices(def.nodes),{gravity:{x:0,y:0,z:0}});
 try{const l=p.limits.find(l=>def.bodies[l.child].name==='RustPlayer_L_UpperArm');
  // Turn the upper arm (with forearm and hand) about the anchor to swing 2x its cone along a diagonal, then spin it outward.
  const {fb}=p.jointFrames(l),dirLocal=new Vector3(0,l.swing1,l.swing2).normalize(),axis=dirLocal.clone().applyQuaternion(fb),angle=2/Math.hypot(dirLocal.y/l.swing1,dirLocal.z/l.swing2);
  const t=l.a.translation(),q=l.a.rotation(),pivot=l.anchor.clone().applyQuaternion(new Quaternion(q.x,q.y,q.z,q.w)).add(new Vector3(t.x,t.y,t.z)),turn=new Quaternion().setFromAxisAngle(axis,angle);
  for(const b of l.subtree){const bp=b.translation(),bq=b.rotation(),moved=new Vector3(bp.x,bp.y,bp.z).sub(pivot).applyQuaternion(turn).add(pivot),rot=turn.clone().multiply(new Quaternion(bq.x,bq.y,bq.z,bq.w));b.setTranslation(moved,true);b.setRotation(rot,true);b.setAngvel({x:axis.x*3,y:axis.y*3,z:axis.z*3},true);}
  assert.ok(p.swing(p.limits.indexOf(l)).cone>3.5);
  const energy=()=>p.bodies.reduce((e,b)=>{const v=b.linvel(),w=b.angvel(),I=b.effectiveAngularInertia();return e+0.5*b.mass()*(v.x*v.x+v.y*v.y+v.z*v.z)+0.5*(w.x*(I.m11*w.x+I.m12*w.y+I.m13*w.z)+w.y*(I.m12*w.x+I.m22*w.y+I.m23*w.z)+w.z*(I.m13*w.x+I.m23*w.y+I.m33*w.z));},0);
  const anchors=()=>Math.max(...p.joints.map(j=>{const a=j.anchor1(),b=j.anchor2();return new Vector3(a.x,a.y,a.z).applyQuaternion(j.body1().rotation()).add(j.body1().translation()).distanceTo(new Vector3(b.x,b.y,b.z).applyQuaternion(j.body2().rotation()).add(j.body2().translation()));}));
  const before=energy(),violation=()=>p.violations()[p.constraints.indexOf(l)].angle;assert.ok(violation()>10*r);
  assert.ok(p.solveJoints()>0);
  // Back to within the 1 degree margin left to Rapier's in-solver limit, every other joint angle unchanged.
  assert.ok(violation()<1.01*r,'violation '+violation()/r);assert.ok(p.violations().every(v=>v.angle<1.01*r));assert.ok(anchors()<1e-4,'anchor '+anchors());
  // The relative angular velocity leaving the range is gone, and the impulse took energy out.
  const wa=l.a.angvel(),wb=l.b.angvel();assert.ok((wa.x-wb.x)*l.axis.x+(wa.y-wb.y)*l.axis.y+(wa.z-wb.z)*l.axis.z>-1e-4);assert.ok(energy()<before);
  // Rapier's box for this joint now passes through the PhysX cone at the current state.
  p.updateLimits();const raw=p.world.impulseJoints.raw;assert.ok(raw.jointLimitsMax(l.joint.handle,4)<=l.swing1+1e-6&&raw.jointLimitsMax(l.joint.handle,5)<=l.swing2+1e-6);
 }finally{p.dispose();}
});

test('clamping onto the PhysX range: twist range, elliptical cone, hinge axis',()=>{
 const q=(axis,deg)=>new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(),deg*r),l={low:-20*r,high:30*r,swing1:20*r,swing2:10*r};
 const inside=q([0,1,0],10).multiply(q([1,0,0],5));assert.ok(clampJointRotation(inside,l).angleTo(inside)<1e-6);
 let s=swingTwist(clampJointRotation(q([1,0,0],50),l));near(s.twist,30*r);
 s=swingTwist(clampJointRotation(q([0,0,1],25),l));near(s.swing2,10*r,1e-6);near(s.swing1,0,1e-6);
 s=swingTwist(clampJointRotation(q([0,1,1],30).multiply(q([1,0,0],-40)),l));near((s.swing1/l.swing1)**2+(s.swing2/l.swing2)**2,1,1e-6);near(s.twist,-20*r);
 s=swingTwist(clampJointRotation(q([0,1,0],15).multiply(q([1,0,0],20)),{...l,hinge:true,swing1:0,swing2:0}));near(s.swing1,0);near(s.twist,20*r);
});

test('settled and dropped corpses keep every joint within a few degrees of its range, then sleep',needsAssets,()=>{
 const pose=def.poses.sleep,values=new LegacyAnimation(def.nodes,def.animations).sample([{name:pose.clip,time:pose.time,weight:1}],0),sleep=restMatrices(def.nodes.map((n,i)=>({...n,...values[i]})));
 const at=(m,x)=>m.map(y=>x.clone().multiply(y)),cases=[['collapse',at(restMatrices(def.nodes),new Matrix4().makeTranslation(0,0.02,0)),null],['drop 2 m, shot',at(restMatrices(def.nodes),new Matrix4().makeTranslation(0,2,0)),def.bodies[0].name],
  ['face down 2 m',at(restMatrices(def.nodes),new Matrix4().makeTranslation(0,2.3,0).multiply(new Matrix4().makeRotationX(Math.PI/2))),null],['sleep pose',at(sleep,new Matrix4().makeTranslation(0,0.3,0)),null]];
 for(const [name,matrices,shot]of cases){const p=new RagdollPhysics(R,def,matrices);
  try{p.setEnvironment(tessellated);if(shot)p.shot(shot,[0,0,0],[0,0,1]);let during=0,toes=0,drawnToes=0,settled=0;
   for(let i=1;i<=400;i++){p.update(0.02);const v=p.violations();if(i>10){for(const j of v)if(/Toe0/.test(j.name))toes=Math.max(toes,j.angle);else during=Math.max(during,j.angle);
     for(const j of p.drawnViolations())if(/Toe0/.test(j.name))drawnToes=Math.max(drawnToes,j.angle);}if(i>300)settled=Math.max(settled,...v.map(j=>j.angle));
    for(const b of p.bodies)assert.ok(b.worldCom().y>-0.05,`${name}: body below the floor`);}
   // Measured worst cases (tools/_rag-measure.mjs): about 3 degrees during impacts, toes (0.1 kg hinge pressed into
   // the ground) up to ~25 degrees for a frame or two, 0.0-0.2 degrees once settled.
   assert.ok(during<8*r,`${name}: ${during/r} degrees during the fall`);assert.ok(toes<35*r,`${name}: toes ${toes/r}`);assert.ok(drawnToes<1.01*r,`${name}: drawn toes ${drawnToes/r}`);assert.ok(settled<1.5*r,`${name}: ${settled/r} degrees settled`);
   assert.ok(p.bodies.every(b=>b.isSleeping()),`${name}: corpse sleeps`);
  }finally{p.dispose();}}
});

test('corpse worlds substep, apply the IgnoreColliders pairs, and item worlds stay at the plain fixed step',needsAssets,()=>{
 const p=new RagdollPhysics(R,def,restMatrices(def.nodes));
 try{assert.equal(p.shared.substeps,CORPSE_SUBSTEPS);near(p.world.timestep,def.physics.fixedTimestep/CORPSE_SUBSTEPS);assert.equal(p.world.numSolverIterations,7);assert.ok(p.shared.applyIgnore);
  const pairs=def.ignore.reduce((n,[a,b])=>n+p.bodies[a].colliders.length*p.bodies[b].colliders.length,0);assert.equal(p.shared.ignore.size,pairs);
 }finally{p.dispose();}
 const item=new RagdollPhysics(R,{nodes:[{name:'item',parent:-1,position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],bodies:[{bone:0,name:'item',data:def.bodies[0].data,colliders:def.bodies[0].colliders}],joints:[],physics:def.physics},[new Matrix4()]);
 try{assert.equal(item.shared.substeps,1);near(item.world.timestep,def.physics.fixedTimestep);assert.equal(item.world.numInternalPgsIterations,1);}finally{item.dispose();}
});

test('Rapier holds the hinge range in the child-relative sense',needsAssets,()=>{
 const p=new RagdollPhysics(R,def,restMatrices(def.nodes),{gravity:{x:0,y:0,z:0}});
 try{const index=def.joints.findIndex(j=>j.type==='HingeJoint'&&def.bodies.find(b=>b.bone===j.bone).name==='RustPlayer_L_Forearm'),j=p.joints[index],{min,max}=def.joints[index].data.m_Limits;
  const frames=()=>{const a=j.body1().rotation(),b=j.body2().rotation();return [new Quaternion(a.x,a.y,a.z,a.w).multiply(new Quaternion(...Object.values(j.frameX1()))),new Quaternion(b.x,b.y,b.z,b.w).multiply(new Quaternion(...Object.values(j.frameX2())))];};
  const angle=()=>{const [fa,fb]=frames();return swingTwist(fb.clone().invert().multiply(fa)).twist/r;};
  for(const sign of [1,-1]){const axis=new Vector3(1,0,0).applyQuaternion(frames()[0]);j.body1().setAngvel({x:axis.x*sign*4,y:axis.y*sign*4,z:axis.z*sign*4},true);
   for(let i=0;i<80;i++)p.update(0.02);const value=angle();assert.ok(value>=min-3&&value<=max+3,`${value} outside ${min}..${max}`);}
 }finally{p.dispose();}
});

test('corpses share one world, max angular velocity is clamped, and disposal removes only that corpse',needsAssets,()=>{
 const world=new RagdollWorld(R,def.physics),make=y=>new RagdollPhysics(R,def,restMatrices(def.nodes).map(m=>new Matrix4().makeTranslation(0,y,0).multiply(m)),{world});
 const a=make(1),b=make(2.5);a.setEnvironment(floor);
 for(const body of b.bodies)body.setAngvel({x:30,y:0,z:0},true);world.update(0.02);assert.ok(b.bodies.every(x=>{const w=x.angvel();return Math.hypot(w.x,w.y,w.z)<=7+1e-4;}));
 for(let i=0;i<300;i++)world.update(0.02);
 // The upper corpse lands on the lower one or its ground patch and never falls through.
 assert.ok(b.bodies.every(x=>x.translation().y>-0.2));const count=world.world.bodies.len();b.dispose();assert.equal(world.world.bodies.len(),count-23);assert.equal(world.ragdolls.size,1);
 a.dispose();world.dispose();
});

test('corpse bodies stop rays as flesh layer 27, let characters through and take tracer pushes',needsAssets,()=>{
 const p=new RagdollPhysics(R,def,restMatrices(def.nodes).map(m=>new Matrix4().makeTranslation(0,1,0).multiply(m)),{gravity:{x:0,y:0,z:0}});
 try{const w=new CollisionWorld(()=>-100),bodies=def.bodies.map((b,i)=>w.addBody(new RagdollCorpseBody(b,i,p).follow(p.matrices()[i])));w.build();
  const pelvis=p.bodies[0].translation(),target=new Vector3(pelvis.x,pelvis.y,-pelvis.z),hit=w.raycast(new Ray(target.clone().add(new Vector3(0,0,3)),new Vector3(0,0,-1)),10);
  assert.ok(hit?.body?.ragdollCorpse);assert.equal(hit.body.layer,27);assert.equal(hit.body.surfaceName,'MaleRagdoll');assert.ok(bodies.every(b=>b.noCollide));
  const before=p.bodies[hit.body.index].linvel();assert.ok(hit.body.rigidImpact(hit.position,new Vector3(0,0,-1)));const after=p.bodies[hit.body.index].linvel();
  // (up * 200 + ray * 1000) for one 0.02 s step: +z in Unity space for a browser -z ray, and upwards.
  assert.ok(after.z-before.z>0&&after.y-before.y>0);
 }finally{p.dispose();}
});
