import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Matrix4,Vector3} from 'three';
import {CollisionWorld,buildOriginalCollision} from '../browser/collision.mjs';
import {LegacyMotor,evaluateCurve,directionalSpeed} from '../browser/motor.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const config=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/player.json',import.meta.url)))):null;
function fixture(boxes=[],ground=()=>0){const world=new CollisionWorld(ground);for(const b of boxes)world.addBox(b.size,b.center,new Matrix4());world.build();const motor=new LegacyMotor(config,world);motor.teleport(new Vector3(0,0.001,0),{settle:true});for(let i=0;i<10;i++)motor.update(1/120,{},0);spendLanding(motor);return {motor,world};}
// The spawn drop is a landing (HumanController.ProcessInput restarts curveLandingSpeedPenalty); its 0.75 s only runs
// while moving, so tests of steady movement start with it spent, as after any earlier walk.
function spendLanding(m){m.landingSpeedPenaltyTime=Infinity;}
function advance(m,seconds,input={},yaw=0){for(let i=0;i<Math.round(seconds*120);i++)m.update(1/120,input,yaw);}
test('resolved human inheritance overrides code defaults and preserves eye/controller source values',needsAssets,()=>{
 assert.deepEqual(config.traitChain.map(t=>t.name),['Default','Human','Male']);
 assert.equal(config.motorSettings.data.gravity,35);assert.equal(config.motorSettings.data.maxForwardSpeed,4);
 assert.ok(Math.abs(config.controller.data.m_Radius-0.405)<1e-6);assert.ok(Math.abs(config.eyes.m_LocalPosition.y-1.647596)<1e-6);
 const s=config.motorSettings.data;assert.equal(directionalSpeed(0,1,s),4);assert.equal(directionalSpeed(0,-1,s),3);
 const curve=config.traits.HumanControlConfiguration.data.crouchMulSpeedByTime;
 assert.ok(Math.abs(evaluateCurve(curve,0.2)-0.775)<1e-6);
});
test('forward/backward/sprint follow recovered speed limits without diagonal gain',needsAssets,()=>{
 const {motor:a}=fixture();advance(a,2,{forward:1});assert.ok(a.feet.z<-7.7&&a.feet.z>-8.1);
 const {motor:b}=fixture();advance(b,2,{forward:-1});assert.ok(b.feet.z>5.7&&b.feet.z<6.1);
 const {motor:c}=fixture();advance(c,2,{forward:1,sprint:true});assert.ok(c.feet.z<-14&&c.feet.z>-16.1);
 const {motor:d}=fixture();advance(d,2,{forward:1,right:1});assert.ok(Math.abs(d.feet.length()-Math.abs(a.feet.z))<0.05);
});
// CCMotor.StepPhysics: after a collision the velocity is the wanted one scaled by the 0..1 fraction of it the move
// achieved (num5), so a 45-degree slide keeps only half of it each step (about 1.18 m/s along the wall at 120 Hz).
test('solid wall stops continuous movement and allows sliding along its face',needsAssets,()=>{
 const {motor}=fixture([{size:[20,5,1],center:[0,2.5,-3]}]);advance(motor,3,{forward:1,right:1});
 assert.ok(motor.feet.z>=-2.1);assert.ok(motor.feet.x>3.5&&motor.feet.x<5.5,String(motor.feet.x));assert.ok(motor.collisions>0);
});
// CharacterController.Move sweeps (PhysX SweepTest): the capsule stops at the first contact and the rest of the motion
// slides along it, so a long move never tunnels through a thin wall and never travels further than asked.
test('side pass sweeps: a long move stops at a thin wall and slides the rest along it',needsAssets,()=>{
 const {motor}=fixture([{size:[20,5,0.02],center:[0,2.5,-3]}]);const feet=new Vector3(0,0.001,0),normals=motor.sweep(feet,new Vector3(0,0,-10),true);
 assert.ok(Math.abs(feet.z-(-3+0.01+0.45))<2e-3,String(feet.z));assert.equal(normals.length,1);assert.ok(normals[0].z>0.999);
 const slid=new Vector3(0,0.001,0);motor.sweep(slid,new Vector3(3,0,-4),true);assert.ok(Math.abs(slid.z-feet.z)<2e-3&&Math.abs(slid.x-3)<2e-3,slid.toArray().join());
});
// Mesh sweeps are single-sided: a capsule behind a face (inside a solid) moves out through it, never back in.
test('a single-sided face stops a capsule in front of it and lets one behind it out',needsAssets,()=>{
 const world=new CollisionWorld(()=>0);world.addGeometry(new Float32Array([-5,0,-1,5,0,-1,5,3,-1,-5,3,-1]),new Uint32Array([0,1,2,0,2,3]));world.build();
 const motor=new LegacyMotor(config,world);motor.height=motor.standing;
 const front=new Vector3(0,0.001,0);motor.sweep(front,new Vector3(0,0,-2));assert.ok(Math.abs(front.z-(-1+0.45))<2e-3,String(front.z));
 const behind=new Vector3(0,0.001,-1.2);motor.sweep(behind,new Vector3(0,0,2));assert.ok(Math.abs(behind.z-0.8)<1e-9,String(behind.z));
});
test('jump and ceiling collision return to the floor without repeated held-key jumps',needsAssets,()=>{
 const {motor}=fixture([{size:[10,0.3,10],center:[0,2.55,0]}]);const initial=motor.feet.y;let peak=initial;
 for(let i=0;i<240;i++){motor.update(1/120,{jump:true},0);peak=Math.max(peak,motor.feet.y);}
 assert.ok(peak>initial+0.1&&peak<0.36);assert.ok(motor.grounded);assert.ok(Math.abs(motor.feet.y-initial)<0.01);
});
test('crouch fits under low ceiling and blocks standing until clear',needsAssets,()=>{
 const {motor}=fixture([{size:[8,1,5],center:[0,2.1,-4]}]);advance(motor,1,{crouch:true});
 assert.ok(Math.abs(motor.height-config.totem.data.minimumHeight)<0.01);
 advance(motor,1.5,{forward:1,crouch:true});advance(motor,0.4,{});
 assert.ok(motor.feet.z<-2);assert.ok(motor.crouchBlocked);assert.ok(motor.height<1.61);
 advance(motor,3,{forward:-1,crouch:true});advance(motor,1,{});assert.ok(!motor.crouchBlocked&&Math.abs(motor.height-motor.standing)<0.01);
});
test('step solver climbs a low stair and falling reaches the recovered gravity limit',needsAssets,()=>{
 const {motor}=fixture([{size:[6,0.3,2],center:[0,0.15,-3]}]);advance(motor,0.7,{forward:1});assert.ok(motor.feet.z<-2.1&&motor.feet.y>0.29);
 const {motor:falling}=fixture([],()=>-10000);falling.teleport(new Vector3(0,100,0));advance(falling,3);assert.equal(falling.velocity.y,-80);
});
test('terrain steeper than the original 65-degree slope limit cannot be climbed',needsAssets,()=>{
 const {motor}=fixture([],(_x,z)=>Math.max(0,-z*10));advance(motor,2,{forward:1});assert.ok(motor.feet.z>-0.1&&motor.feet.y<1);
});
test('original collision buffers build a usable spatial index; imported warehouse roof is solid',needsAssets,async()=>{
 const base=new URL('../browser/assets/recovered/scene/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
 async function binary(d,T){const b=await readFile(new URL(d.file,base));return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
 const world=await buildOriginalCollision({manifest,binary},()=>-1000);assert.equal(world.colliderCount,421-63);assert.ok(world.triangleCount>120000); // the 63 spawn-point marker cubes are left out (SpawnManager.InstallSpawns)
 const support=world.support(5211.6,4788.9,390,365);assert.ok(support&&support.height>370&&support.height<380);
 const m=new LegacyMotor(config,world);m.teleport(new Vector3(5211.6,390,4788.9),{settle:true});advance(m,3);assert.ok(m.grounded&&m.feet.y>370&&m.feet.y<380);
});
test('wildlife and other noCollide bodies are never ground for the player motor',needsAssets,async()=>{
 const {MovingBody}=await import('../browser/collision.mjs');
 for(const noCollide of [true,false]){const world=new CollisionWorld(()=>0),body=new MovingBody('boar');body.addBox([1.2,1.1,1.6],[0,0.55,0],new Matrix4());body.noCollide=noCollide;world.addBody(body);world.build();
  const support=world.support(0,0,3,-1);assert.ok(noCollide?support.height<0.01:Math.abs(support.height-1.1)<0.01);
  const m=new LegacyMotor(config,world);m.teleport(new Vector3(0,1.15,0));advance(m,1);
  assert.ok(m.grounded);if(noCollide)assert.ok(m.feet.y<0.01,`stood at ${m.feet.y}`);else assert.ok(Math.abs(m.feet.y-1.1)<0.01);
  // A moving animal must not carry the player either.
  body.setMotion(new Matrix4().makeTranslation(0.5,0.2,0));advance(m,0.5);if(noCollide)assert.ok(m.feet.y<0.01&&Math.abs(m.feet.x)<0.01);}
});
// Open-riser steel stair like the hangar_E2_01 exterior flight: 0.22 m treads, 0.045 m gaps, 0.236 m rise (~42 degrees).
function stairs(){const boxes=[];for(let i=1;i<=14;i++)boxes.push({size:[1.4,0.04,0.22],center:[0,i*0.236-0.02,-(1+i*0.265)]});boxes.push({size:[1.4,0.04,4],center:[0,15*0.236-0.02,-(1+15*0.265+1.9)]});return fixture(boxes);}
function walkStats(m,seconds,input,yaw=0){let grounded=0,n=0,maxStepDrop=0,last=m.feet.y;const start=m.feet.clone();
 for(let i=0;i<Math.round(seconds*60);i++){m.update(1/60,input,yaw);n++;if(m.grounded)grounded++;maxStepDrop=Math.max(maxStepDrop,last-m.feet.y);last=m.feet.y;}
 return {grounded:grounded/n,horizontal:Math.hypot(m.feet.x-start.x,m.feet.z-start.z)/seconds,rise:m.feet.y-start.y,maxStepDrop};}
// Climbing, the capsule rides the nosings: CCMotor turns the wanted velocity into the (edge) contact plane and
// slopeSpeedMultiplier slows it by the climb angle of the velocity, so the flight is climbed at ~2.3 m/s horizontally.
test('open-riser stairs are climbed (slope-slowed) and descended while staying grounded (CharacterController stepOffset + CCMotor ground push)',needsAssets,()=>{
 const {motor}=stairs();const up=walkStats(motor,1.6,{forward:1});
 assert.ok(up.horizontal>2.1&&up.horizontal<3,`up ${up.horizontal} m/s`);assert.ok(up.grounded>0.95,`up grounded ${up.grounded}`);assert.ok(up.rise>2.5);
 advance(motor,1,{forward:1});assert.ok(motor.grounded&&Math.abs(motor.feet.y-15*0.236)<0.01);
 const down=walkStats(motor,2.4,{forward:-1});assert.ok(down.grounded>0.95,`down grounded ${down.grounded}`);
 assert.ok(down.horizontal>2.0,`down ${down.horizontal} m/s`);assert.ok(down.maxStepDrop<0.3,`dropped ${down.maxStepDrop} m in one frame`);assert.ok(down.rise<-2.5);
});
test('autostep stops at stepOffset: a 0.7 m ledge blocks, ceilings limit the lift, and walking off a ledge drops the ground push once',needsAssets,()=>{
 const {motor}=fixture([{size:[6,0.7,2],center:[0,0.35,-3]}]);advance(motor,1.5,{forward:1});assert.ok(motor.feet.z>-2.0&&motor.feet.y<0.01);
 const {motor:low}=fixture([{size:[6,0.3,4],center:[0,0.15,-4]},{size:[6,0.4,8],center:[0,0.3+2.08+0.25+0.2,-4]}]);advance(low,1.5,{forward:1});
 assert.ok(low.feet.z<-2.5&&low.feet.y>0.29,'climbs a 0.3 m step with 0.25 m of headroom');
 const {motor:edge}=fixture([{size:[6,3,6],center:[0,1.5,0]}],()=>-10);edge.teleport(new Vector3(0,3.001,0),{settle:true});advance(edge,0.2);assert.ok(edge.grounded);
 let firstDrop=null;for(let i=0;i<120&&firstDrop===null;i++){const y=edge.feet.y;edge.update(1/60,{forward:1},0);if(!edge.grounded)firstDrop=y-edge.feet.y;}
 // CCMotor.StepPhysics pushes a grounded controller down by num3 = max(stepOffset, step); with nothing below PhysX
 // moves the whole distance (the original's `vector6.y += num3` only fixes the platform bookkeeping point).
 assert.ok(firstDrop!==null&&firstDrop>0.45&&firstDrop<0.7,`first airborne frame dropped ${firstDrop}`);
});
test('MovementScale (leg injury) halves walking speed',needsAssets,()=>{
 const {motor:a}=fixture();advance(a,2,{forward:1,scale:0.5});assert.ok(a.feet.z<-3.8&&a.feet.z>-4.1,String(a.feet.z));
});
test('hangar_E2_01 exterior staircase: up (slope-slowed) and down at walking speed, grounded throughout',needsAssets,async()=>{
 const {sampleTriangle,worldToGrid}=await import('../browser/terrain.mjs');const root=new URL('../browser/assets/recovered/',import.meta.url);
 const tm=JSON.parse(await readFile(new URL('manifest.json',root))),hb=await readFile(new URL(tm.heightFile,root)),full=new Float32Array(hb.buffer.slice(hb.byteOffset,hb.byteOffset+hb.byteLength));
 const base=new URL('scene/',root),manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
 async function binary(d,T){const b=await readFile(new URL(d.file,base));return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
 const world=await buildOriginalCollision({manifest,binary},(x,z)=>sampleTriangle(full,tm.size,...worldToGrid(x,z,16000,tm.size-1)));
 const m=new LegacyMotor(config,world);m.teleport(new Vector3(6069.6,374.46,3564.4),{settle:true});advance(m,0.5);spendLanding(m);
 function legs(list){let t=0,g=0;const y0=m.feet.y;for(const [yaw,done] of list){let n=0;while(!done(m.feet)&&n++<600){m.update(1/60,{forward:1},yaw);t+=1/60;if(m.grounded)g++;}assert.ok(n<600,'stuck at '+m.feet.toArray());}return {t,grounded:g/(t*60),rise:m.feet.y-y0};}
 // The second flight is ~1.5 m between handrails; the skinned capsule (radius .405 + skin .045) takes its centre line
 // (x 6065.1). Hugging the rail at x 6065.4 catches the handrail's inward turn at the top, as it would in the original.
 const up=legs([[Math.PI/2,p=>p.x<6065.1],[Math.PI,p=>p.z>3568.8]]);assert.ok(up.rise>4.4&&up.t<4.3,JSON.stringify(up));assert.ok(up.grounded>0.95,JSON.stringify(up));
 advance(m,0.5);const down=legs([[0,p=>p.z<3564.4],[-Math.PI/2,p=>p.x>6069.4]]);assert.ok(down.rise<-4.4&&down.t<3,JSON.stringify(down));assert.ok(down.grounded>0.95,JSON.stringify(down));
});
