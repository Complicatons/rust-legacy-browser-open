// P3-14 motor parity: CCTotem shape/skin/height rules, Crouchable eye smoothing, layer-filtered collision, CCPusher
// door pushes and CCMotor moving platforms (decompiled CCTotem/CCDesc/CCMotor/CCPusher/Crouchable, physics.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {Matrix4,Vector3} from 'three';
import {CollisionWorld,MovingBody} from '../browser/collision.mjs';
import {LegacyMotor,totemConfiguration,CrouchSmoothing,ccPusherPush,boxIntersectsSphere} from '../browser/motor.mjs';
import {present,hasRecovered,needsAssets} from './helpers/assets.mjs';
const config=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/player.json',import.meta.url)))):null;
const physicsUrl=new URL('../browser/assets/recovered/physics.json',import.meta.url);
const physics=hasRecovered?(present(physicsUrl)?JSON.parse(await readFile(physicsUrl)):null):null;
const advance=(m,seconds,input={},yaw=0)=>{for(let i=0;i<Math.round(seconds*120);i++)m.update(1/120,input,yaw);};
function world(boxes=[],bodies=[]){const w=new CollisionWorld(()=>0);for(const b of boxes)w.addBox(b.size,b.center,new Matrix4());for(const b of bodies)w.addBody(b);return w.build();}

test('CCTotem configuration: five skinned figures, pole 1.3..2.08 m, created contracted',needsAssets, ()=>{
 const t=totemConfiguration(config.totem.data,config.controller.data);
 assert.ok(Math.abs(t.skinnedRadius-0.45)<1e-6&&Math.abs(t.skinnedHeight-1.25)<1e-6&&Math.abs(t.slide-0.35)<1e-6);
 assert.ok(Math.abs(t.bottomBuffer-0.035)<1e-6);assert.equal(t.figures,5);
 assert.ok(Math.abs(t.contracted-1.3)<1e-6&&Math.abs(t.expanded-2.08)<1e-6&&Math.abs(t.initial-1.3)<1e-6);
});

test('teleport recreates the pole at its initial (contracted) height; it grows at crouchSpeed 1 m/s',needsAssets, ()=>{
 const m=new LegacyMotor(config,world());m.teleport(new Vector3(0,0.001,0));assert.ok(Math.abs(m.height-1.3)<1e-6);
 advance(m,0.39);assert.ok(Math.abs(m.height-1.69)<0.02,String(m.height));advance(m,0.5);assert.ok(Math.abs(m.height-2.08)<1e-6);
 // Crouching shrinks at the same 1 m/s (HumanController crouchSpeed = -1), not the crouch trait's curve speed.
 advance(m,0.39,{crouch:true});assert.ok(Math.abs(m.height-1.69)<0.02,String(m.height));
});

test('standing up under a low ceiling raises the pole to the ceiling and reports crouchBlocked',needsAssets, ()=>{
 const m=new LegacyMotor(config,world([{size:[6,0.4,6],center:[0,2.0,0]}]));m.teleport(new Vector3(0,0.001,0));advance(m,1.5);
 assert.ok(m.height>1.75&&m.height<1.81,String(m.height));assert.ok(m.crouchBlocked&&m.crouched);
 // HumanController flag3: the speed curve treats the blocked player as crouching once it moves; standing still
 // ProcessInput resets crouchTime from the crouch key alone (lines 561-566), so it is 0 until then.
 assert.equal(m.crouchTime,0);advance(m,0.1,{forward:1});assert.ok(m.crouchTime>0.09,String(m.crouchTime));
});

test('Crouchable.Smoothing: the eye offset follows the height change with a ~0.1 s lag',needsAssets, ()=>{
 const s=new CrouchSmoothing();assert.equal(s.catchUp(0),0);
 const trace=[];for(let i=0;i<60;i++){s.addSeconds(1/60);trace.push(s.catchUp(-0.78));}
 assert.ok(trace[0]>-0.2&&trace[0]<0,String(trace[0]));assert.ok(trace[5]<-0.4&&trace[5]>-0.75,String(trace[5]));assert.ok(Math.abs(trace.at(-1)+0.78)<1e-3);
 for(let i=1;i<trace.length;i++)assert.ok(trace[i]<=trace[i-1]+1e-7,'monotonic, no overshoot');
 const m=new LegacyMotor(config,world());m.teleport(new Vector3(0,0.001,0),{settle:true});advance(m,0.1);advance(m,0.05,{crouch:true});
 assert.ok(m.eye>m.eyeHeight-(m.standing-m.height),'eye lags the crouching pole');advance(m,1.5,{crouch:true});assert.ok(Math.abs(m.eye-(m.eyeHeight-0.78))<2e-3,String(m.eye));
});

test('skin width: the solid hull is radius + skin (0.45 m), so a 0.85 m gap blocks and 0.95 m passes',needsAssets, ()=>{
 for(const [gap,passes] of [[0.85,false],[0.95,true]]){const half=gap/2+0.5;
  const m=new LegacyMotor(config,world([{size:[1,3,4],center:[-half,1.5,-4]},{size:[1,3,4],center:[half,1.5,-4]}]));m.teleport(new Vector3(0,0.001,0),{settle:true});advance(m,3,{forward:1});
  assert.equal(m.feet.z<-6.5,passes,`gap ${gap}: z ${m.feet.z}`);}
});

test('player layer mask: debris/ragdoll/hitbox bodies do not block, static/mechanical ones do', {skip:!physics}, ()=>{
 const mask=physics.player.collisionMask;assert.equal(physics.player.figureLayer,16);assert.equal(physics.layers['16'],'Character Collision');
 for(const l of [16,17,18,21,22,27])assert.equal((mask>>>l)&1,0,`layer ${l} ignored`);for(const l of [0,10,19,20,29])assert.equal((mask>>>l)&1,1,`layer ${l} blocks`);
 for(const [layer,blocks] of [[18,false],[10,true],[20,true],[27,false]]){const b=new MovingBody('wall');b.addBox([6,3,1],[0,1.5,-3],new Matrix4());b.layer=layer;
  const m=new LegacyMotor(config,world([],[b]),{collisionMask:mask});m.teleport(new Vector3(0,0.001,0),{settle:true});advance(m,2,{forward:1});
  assert.equal(m.feet.z>-2.1,blocks,`layer ${layer} z ${m.feet.z}`);}
 // A prefab's solid colliders decide, not its root node layer (WoodSpikeWall root 26 trigger, solid "col" layer 10).
 const spike=new MovingBody('spike');spike.addBox([6,3,1],[0,1.5,-3],new Matrix4());spike.layer=18;spike.solidLayers=[10];
 const m=new LegacyMotor(config,world([],[spike]),{collisionMask:mask});m.teleport(new Vector3(0,0.001,0),{settle:true});advance(m,2,{forward:1});assert.ok(m.feet.z>-2.1);
});

test('CCPusher.Push: box overlap, quirky plane distances and the push along the chosen plane', {skip:!physics}, ()=>{
 assert.equal(physics.ccPushers.length,28);assert.equal(physics.playerPushers.length,10);
 const blue=physics.ccPushers.find(p=>p.name==='BlueDoor_94'),garage=physics.ccPushers.find(p=>p.name==='GarageDoor_AngleOpen107');
 assert.equal(blue.pushSpeed,40);assert.equal(blue.layer,20);
 // BlueDoor: planes along local ±Y through y = ∓0.047. DistanceTo(x) = dir·(x + point) (sic) gives y + 0.358 vs
 // -y + 0.358 for these mirrored planes, so the side switch stays at the door's mid-plane; push = 40 * dt.
 const at=y=>ccPusherPush(blue,new Vector3(0,y,-1.17),0.405,0.02);
 assert.deepEqual(at(0.3).toArray().map(v=>+v.toFixed(6)),[0,0.8,0]);assert.deepEqual(at(0.01).toArray().map(v=>+v.toFixed(6)),[0,0.8,0]);
 assert.deepEqual(at(-0.01).toArray().map(v=>+v.toFixed(6)),[0,-0.8,0]);assert.equal(at(0.6),null,'outside the box');
 assert.ok(boxIntersectsSphere(garage.shape,new Vector3(1.9,0.2,0.5),0.405));assert.ok(!boxIntersectsSphere(garage.shape,new Vector3(1.9,0.2,0.6),0.405));
});

test('a grounded player inside a closing door box is pushed out sideways by CCMotor.ApplyHorizontalPushVelocity', {skip:!physics}, ()=>{
 const blue=physics.ccPushers.find(p=>p.name==='BlueDoor_94');
 // The door stands upright: local -Z (browser) up, thin local Y along world Z. No solid collider, only the pusher.
 const doorMatrix=new Matrix4().makeRotationX(Math.PI/2);
 const w=world();w.pushers=[{...blue,matrix:()=>doorMatrix}];
 for(const z of [0.2,-0.2]){const m=new LegacyMotor(config,w);m.teleport(new Vector3(0,0.001,z),{settle:true});advance(m,1);
  assert.ok(Math.sign(m.feet.z)===Math.sign(z)&&Math.abs(m.feet.z)>Math.abs(z)+0.15,`pushed from ${z} to ${m.feet.z}`);}
 const m=new LegacyMotor(config,w);m.teleport(new Vector3(0,0.001,2),{settle:true});advance(m,1);assert.ok(Math.abs(m.feet.z-2)<1e-6,'out of reach: no push');
});

test('moving platforms: a body under the player carries it (and its yaw); jumping off keeps its velocity',needsAssets, ()=>{
 const deck=new MovingBody('platform');deck.addBox([6,0.5,6],[0,-0.25,0],new Matrix4());const w=world([],[deck]);w.ground=null;
 const m=new LegacyMotor(config,w);m.teleport(new Vector3(0,0.001,0),{settle:true});advance(m,0.5);assert.ok(m.grounded);
 let x=0;for(let i=0;i<120;i++){x+=1/120;deck.setMotion(new Matrix4().makeTranslation(x,0,0));m.update(1/120,{},0);}
 assert.ok(Math.abs(m.feet.x-x)<0.03&&m.grounded,`carried to ${m.feet.x} (platform ${x})`);assert.ok(Math.abs(m.platformVelocity.x-1)<0.05);
 let turned=0;for(let i=1;i<=60;i++){deck.setMotion(new Matrix4().makeTranslation(x,0,0).multiply(new Matrix4().makeRotationY(i*0.01)));m.update(1/120,{},0);turned+=m.takeYawDelta();}
 assert.ok(Math.abs(turned-0.6)<0.02,`yaw carried ${turned}`);
 // Jump: velocity += platformVelocity, then frameVelocity keeps feeding the desired velocity in the air.
 deck.setMotion(new Matrix4().makeTranslation(x,0,0));for(let i=0;i<30;i++){x+=1/120;deck.setMotion(new Matrix4().makeTranslation(x,0,0));m.update(1/120,{},0);}
 x+=1/120;deck.setMotion(new Matrix4().makeTranslation(x,0,0));m.update(1/120,{jump:true},0);assert.ok(!m.grounded&&m.velocity.x>0.9,`air velocity ${m.velocity.x}`);
 for(let i=0;i<30;i++)m.update(1/120,{},0);assert.ok(m.velocity.x>0.9&&Math.abs(m.frameVelocity.x-1)<0.05,'PermaTransfer keeps the platform velocity in the air');
});

test('a pusher door moving into the player passes into it (no PhysX depenetration) and CCPusher pushes it out',needsAssets, ()=>{
 const panel=new MovingBody('door');panel.addBox([1.41,2.35,0.094],[0,1.175,0],new Matrix4());panel.layer=20;panel.setMotion(new Matrix4().makeTranslation(0,0,-1));
 const pusher={layer:20,shape:{center:[0,1.175,0],size:[1.41,2.35,0.094],x:[1,0,0],y:[0,1,0],z:[0,0,1]},collider:{center:[0,1.175,0],size:[1.41,2.35,0.094]},
  pushPoint0:[0,1,-0.047],pushDir0:[0,0,1],pushPoint1:[0,1,0.047],pushDir1:[0,0,-1],pushSpeed:40,matrix:()=>panel.motion,body:panel};
 const w=world([],[panel]);w.pushers=[pusher];const m=new LegacyMotor(config,w);m.teleport(new Vector3(0,0.001,0.12),{settle:true});advance(m,0.2);
 let maxJump=0;for(let i=1;i<=30;i++){const z=-1+i/30;panel.setMotion(new Matrix4().makeTranslation(0,0,z));const before=m.feet.z;m.update(1/60,{},0);maxJump=Math.max(maxJump,m.feet.z-before);}
 assert.ok(m.pushSteps>0&&m.ghosts.has(panel),'the moving door is a ghost while CCPusher pushes');assert.ok(maxJump<0.05,`pushed gradually, not snapped (${maxJump})`);
 advance(m,1.5);assert.ok(m.feet.z>0.45&&!m.ghosts.has(panel),`clear of the door at ${m.feet.z}`);
 // Once released the closed door is solid again.
 advance(m,1,{forward:-1},Math.PI);assert.ok(m.feet.z>0.44,`walking into the door is blocked: ${m.feet.z}`);
});
