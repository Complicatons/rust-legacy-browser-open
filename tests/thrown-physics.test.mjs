import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import R from '@dimforge/rapier3d-compat';
import {ThrownBody,thrownDefinition,debrisCollides,BOUNCE,LOOK_UP} from '../browser/thrown-physics.mjs';
import {CollisionWorld} from '../browser/collision.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const manifest=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const physics=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/ragdoll.json',import.meta.url))).physics):null;
await R.init();
const prefab=name=>Object.values(manifest.prefabs).find(p=>p?.name===name);
const grenade=hasRecovered?(prefab('F1GrenadeWorld')):null,signal=hasRecovered?(prefab('SupplySignalGrenade')):null,flare=hasRecovered?(prefab('WorldFlare_New')):null;
const close=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;
function run(p,{ground=()=>0,position,velocity,seconds}){const body=new ThrownBody(R,p,{position,velocity,world:new CollisionWorld(ground),physics});const bounces=[];let maxSpin=0;
 try{for(let t=0;t<seconds;t+=1/60){bounces.push(...body.update(1/60));const w=body.rb.angvel();maxSpin=Math.max(maxSpin,Math.hypot(w.x,w.y,w.z));}
  return {position:body.position,velocity:body.velocity,bounces,maxSpin,contacts:body.contacts};}finally{body.dispose();}}

test('thrown prefabs keep their own Rigidbody, collider, root scale and PhysicMaterial',needsAssets,()=>{
 const g=thrownDefinition(grenade,physics).bodies[0],c=g.colliders[0];
 assert.equal(c.type,'SphereCollider');assert.ok(close(c.data.m_Radius,0.125));assert.ok(close(c.data.m_Center.z,0.05)); // browser -0.05 -> Unity +0.05
 assert.equal(c.material.frictionCombine,3);assert.ok(close(c.material.bounciness,0.25));assert.ok(close(g.data.m_Drag,0.05));assert.ok(close(g.data.m_AngularDrag,0.5));
 assert.equal(thrownDefinition(signal).bodies[0].colliders[0].type,'SphereCollider');
 const f=thrownDefinition(flare).bodies[0].colliders[0];assert.equal(f.type,'CapsuleCollider');assert.equal(f.data.m_Direction,2);
 assert.ok(close(f.data.m_Radius,0.04*2.54,1e-6)&&close(f.data.m_Height,0.2*2.54,1e-6));assert.ok(close(thrownDefinition(flare).bodies[0].data.m_AngularDrag,1));
 // Debris (18) meets Default, Static, CULL500, Terrain and mechanical doors, not characters, hitboxes, sprites or other debris.
 for(const l of [0,10,12,19,20])assert.ok(debrisCollides(physics,l),String(l));for(const l of [11,16,17,18,21,27])assert.ok(!debrisCollides(physics,l),String(l));
});

test('the Rapier body: mass 1, the prefab drag/angular drag, Max friction against the default world material',needsAssets,()=>{
 const b=new ThrownBody(R,grenade,{position:new Vector3(0,1,0),velocity:new Vector3(0,0,20),world:new CollisionWorld(()=>0),physics});
 try{const c=b.rb.collider(0);assert.ok(close(b.rb.mass(),1,1e-5));assert.ok(close(b.rb.linearDamping(),0.05));assert.ok(close(b.rb.angularDamping(),0.5));
  assert.equal(c.frictionCombineRule(),R.CoefficientCombineRule.Max);assert.equal(c.restitutionCombineRule(),R.CoefficientCombineRule.Average);assert.equal(b.rb.linvel().z,20);
  assert.ok(close(b.rotation.x,LOOK_UP.x)&&close(b.rotation.w,LOOK_UP.w));}finally{b.dispose();}
});

test('a grenade lands, bounces at most every 0.25 s, then rolls along the ground instead of sliding to a stop',needsAssets,()=>{
 const r=run(grenade,{position:new Vector3(0,1.5,0),velocity:new Vector3(0,2,8),seconds:3});
 assert.ok(r.bounces.length>=1,JSON.stringify(r.bounces));
 for(let i=1;i<r.bounces.length;i++)assert.ok(r.bounces[i].time-r.bounces[i-1].time>=BOUNCE.interval-1e-9);
 assert.ok(r.bounces.every(b=>b.speed*b.speed>BOUNCE.minSqrSpeed));
 assert.ok(r.position.y>0.05&&r.position.y<0.3,JSON.stringify(r.position));assert.ok(r.maxSpin>1,String(r.maxSpin));
 assert.ok(r.position.z>4,JSON.stringify(r.position)); // carried on by rolling
});

test('a grenade left on a slope rolls downhill',needsAssets,()=>{
 const r=run(grenade,{ground:x=>-0.3*x,position:new Vector3(0,0.2,0),velocity:new Vector3(),seconds:2});
 assert.ok(r.position.x>1,JSON.stringify(r.position));assert.ok(r.maxSpin>1);
});

test('a thrown flare (capsule) comes to rest lying on the ground',needsAssets,()=>{
 const r=run(flare,{position:new Vector3(0,1.6,0),velocity:new Vector3(0,0,20),seconds:6});
 assert.ok(r.contacts>=1);assert.ok(r.position.y>0.05&&r.position.y<0.3,JSON.stringify(r.position));assert.ok(r.velocity.length()<0.5,JSON.stringify(r.velocity));
});

test('the offline flare and grenade wrappers run on the rigid body',needsAssets,async()=>{
 const {ThrownFlare}=await import('../browser/offline-flare.mjs'),{ThrownGrenade}=await import('../browser/thrown-physics.mjs'),world=new CollisionWorld(()=>0);
 const f=new ThrownFlare(flare,new Vector3(0,1.6,1),new Vector3(0,0,20),LOOK_UP,{engine:R,world,physics});
 try{for(let i=0;i<240;i++)assert.equal(f.step(1/60,()=>null),false);assert.ok(f.rigid&&f.landed);assert.ok(f.position.y<0.4);}finally{f.dispose();}
 const g=new ThrownGrenade(R,grenade,{position:new Vector3(0,1,0),velocity:new Vector3(0,0,5),world,physics});
 try{let boom=false;for(let i=0;i<200&&!boom;i++)boom=g.step(1/60).boom;assert.ok(boom);assert.ok(Math.abs(g.age-3)<0.02);assert.equal(g.explosionRadius,6);assert.equal(g.damage,120);
  assert.ok(Math.abs(g.explosionPoint.y-g.position.y-0.3)<1e-9);assert.equal(g.signal,false);}finally{g.dispose();}
});
