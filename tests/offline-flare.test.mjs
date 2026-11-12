import test from 'node:test';import assert from 'node:assert/strict';import {Vector3,Quaternion} from 'three';
import {flareThrow,consumeOne,holsterFlare,ThrownFlare,LOOK_UP,FLARE_LIFETIME,browserQuaternion} from '../browser/offline-flare.mjs';
import {FlareState} from '../browser/server-throwables.mjs';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
// WorldFlare_New as exported (CapsuleCollider radius 0.04, root scale 2.54, Rigidbody drag 0.05, PhysicMaterial bounciness 0.65).
const prefab={rootScale:{x:2.54,y:2.54,z:2.54},colliders:[{type:'CapsuleCollider',radius:0.04,height:0.2,direction:2,physicMaterial:{bounciness:0.65,dynamicFriction:1}}],components:{Rigidbody:[{data:{m_Drag:0.05}}]}};
const flareData={fireRate:0.3,fireRateSecondary:0.3,deployLength:0.5};
test('TorchItemDataBlock.ThrowFlare: 1 m ahead of the eyes, forward x 20, LookRotation(up)',()=>{
 const t=flareThrow(new Vector3(10,5,3),new Vector3(0,0,2));assert.deepEqual(t.position.toArray(),[10,5,4]);assert.deepEqual(t.velocity.toArray(),[0,0,20]);
 // LookRotation(up) turns the capsule's forward axis (Unity +z) to world up.
 const z=new Vector3(0,0,1).applyQuaternion(t.rotation);near(z.x,0);near(z.y,1);near(z.z,0);
 // In browser space (z mirrored) the mirrored mesh axis (-z) also ends up pointing up.
 const zb=new Vector3(0,0,-1).applyQuaternion(browserQuaternion(LOOK_UP));near(zb.y,1);});
test('flare stacks are consumed one at a time and the slot is removed when used up',()=>{
 const a={item:'flare',uses:2},inv={slots:[null,a]};assert.ok(consumeOne(inv,a));assert.equal(a.uses,1);assert.equal(inv.slots[1],a);
 assert.ok(consumeOne(inv,a));assert.equal(inv.slots[1],null);assert.equal(consumeOne(inv,a),false,'a slot no longer in the inventory is not consumed again');});
test('FlareState follows TorchItem timing: strike 0.8 s, throw 0.5 s after a lit right click, strike-then-throw at 1.51 s',()=>{
 const s=new FlareState(flareData);s.activate(0);let ev=s.frame(0.4,{attack:true});assert.deepEqual(ev,[]);
 ev=s.frame(0.5,{attack:true});assert.deepEqual(ev.map(e=>e.type),['ignite-animation']);assert.equal(s.lit,false);
 assert.deepEqual(s.frame(1.29,{}).map(e=>e.type),[]);assert.deepEqual(s.frame(1.3,{}).map(e=>e.type),['ignite']);assert.equal(s.lit,true);
 // Primary attack on a lit flare does nothing.
 assert.deepEqual(s.frame(2.1,{attack:true}).map(e=>e.type),[]);
 ev=s.frame(2.5,{attack2:true});assert.deepEqual(ev.map(e=>e.type),['throw-animation']);assert.deepEqual(s.frame(3.0,{}).map(e=>e.type),['flare-throw']);assert.equal(s.lit,false);
 // Unlit right click: PrimaryAttack + forceSecondaryTime 1.51 s -> ignite at 0.8 s, then SecondaryAttack throws 0.5 s later.
 const u=new FlareState(flareData);u.activate(0);assert.deepEqual(u.frame(1,{attack2:true}).map(e=>e.type),['ignite-animation']);
 assert.deepEqual(u.frame(1.8,{}).map(e=>e.type),['ignite']);assert.deepEqual(u.frame(2.51,{}).map(e=>e.type),['throw-animation']);assert.deepEqual(u.frame(3.01,{}).map(e=>e.type),['flare-throw']);});
test('TorchItem.OnHolstered burns out only a lit flare',()=>{const s=new FlareState(flareData);s.activate(0);assert.equal(holsterFlare(s),false);s.lit=true;s.igniteAt=5;assert.equal(holsterFlare(s),true);assert.equal(s.lit,false);assert.equal(s.igniteAt,null);});
test('thrown flare falls, settles on the ground, lies down and is destroyed after 90 s with its light 0.1 m above the spawn',()=>{
 const t=flareThrow(new Vector3(0,2,0),new Vector3(0,0,1)),f=new ThrownFlare(prefab,t.position,t.velocity,t.rotation);near(f.body.radius,0.1016,1e-6);
 const light=f.lightMatrix(),p=new Vector3().setFromMatrixPosition(light);near(p.x,0);near(p.y,2.1,1e-9);near(p.z,1,1e-9);
 const ground=(c,r)=>c.y-r<0?{normal:new Vector3(0,1,0),depth:r-c.y}:null;let gone=false,steps=0;
 while(!gone&&steps<10000){gone=f.step(1/60,ground);steps++;if(f.age>20)break;}
 assert.equal(gone,false);assert.ok(f.landed);near(f.position.y,f.body.radius,0.02);assert.ok(f.position.z>3,'travelled forward');
 const axis=new Vector3(0,0,1).applyQuaternion(f.rotation);near(axis.y,0,1e-6);assert.ok(axis.z>0.99,'lies along its heading');
 // The light stays parented: it follows the flare.
 const lp=new Vector3().setFromMatrixPosition(f.lightMatrix());assert.ok(lp.distanceTo(f.position)<0.11);
 for(let i=0;i<FLARE_LIFETIME*60&&!gone;i++)gone=f.step(1/60,ground);assert.ok(gone);assert.ok(f.age>=FLARE_LIFETIME);});
