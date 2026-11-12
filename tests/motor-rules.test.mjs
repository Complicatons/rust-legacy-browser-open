// HumanController.UpdateInput/ProcessInput and CCMotor.StepPhysics movement rules (decompiled HumanController.cs,
// CCMotor.cs, WeaponItem.cs): slope speed, sprint cancels, jump buffer and cooldown, landing penalty, air movement,
// too-steep ground, the crouch/sprint timers and crafting/injury MovementScale.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Matrix4,Vector3} from 'three';
import {CollisionWorld} from '../browser/collision.mjs';
import {LegacyMotor,evaluateCurve,humanInputSample,isSprinting} from '../browser/motor.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const config=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/player.json',import.meta.url)))):null;
const s=hasRecovered?(config.motorSettings.data):null,controls=hasRecovered?(config.traits.HumanControlConfiguration.data):null,v0=hasRecovered?(Math.sqrt(2*s.gravity*s.jumpBaseHeight)):null,DT=1/120;
function motor(ground=()=>0,boxes=[]){const w=new CollisionWorld(ground);for(const b of boxes)w.addBox(b.size,b.center,new Matrix4());w.build();
 const m=new LegacyMotor(config,w);m.teleport(new Vector3(0,ground(0,0)+0.001,0),{settle:true});for(let i=0;i<30;i++)m.update(DT,{},0);
 // The spawn drop is a landing; its penalty only runs while moving, so steady-speed tests start with it spent.
 m.landingSpeedPenaltyTime=Infinity;return m;}
const run=(m,seconds,input={},yaw=0)=>{for(let i=0;i<Math.round(seconds*120);i++)m.update(DT,input,yaw);};
function speed(m,input,seconds=2){run(m,0.5,input);const a=m.feet.clone();run(m,seconds,input);const d=m.feet.clone().sub(a);return {horizontal:Math.hypot(d.x,d.z)/seconds,path:d.length()/seconds};}
const slope=deg=>{const t=Math.tan(deg*Math.PI/180);return (_x,z)=>-z*t;}; // rises towards browser -Z (forward at yaw 0)
const near=(a,b,eps,label)=>assert.ok(Math.abs(a-b)<=eps,`${label??''} ${a} vs ${b}`);

test('slopeSpeedMultiplier: uphill speed follows asin(velocity.normalized.y); downhill and flat stay 4 m/s along the ground',needsAssets, ()=>{
 const curve=s.slopeSpeedMultiplier;near(evaluateCurve(curve,30),20/27,1e-9,'curve 30');near(evaluateCurve(curve,45),0.5,1e-9,'curve 45');near(evaluateCurve(curve,-30),1,0,'curve -30');
 near(speed(motor(),{forward:1}).path,4,0.01,'flat');
 const up30=speed(motor(slope(30)),{forward:1}),up45=speed(motor(slope(45)),{forward:1});
 near(up30.path,4*20/27,0.02,'30 degrees up');near(up30.horizontal,4*20/27*Math.cos(Math.PI/6),0.02);
 near(up45.path,2,0.02,'45 degrees up');near(up45.horizontal,Math.SQRT2,0.02);
 // Downhill the velocity angle is negative (multiplier 1); the desired velocity is turned into the ground plane.
 const down30=speed(motor(slope(-30)),{forward:1});near(down30.path,4,0.02,'30 degrees down');near(down30.horizontal,4*Math.cos(Math.PI/6),0.02);
});

test('UpdateInput sprint cancels: walk <= 0, |strafe| >= 0.05, AltFire, crafting and leg injury; MovementScale halves',needsAssets, ()=>{
 const base={forward:1,sprint:true};
 assert.equal(humanInputSample(base).sprint,true);assert.equal(humanInputSample({...base,right:0.04}).sprint,true);
 for(const raw of [{...base,forward:0},{...base,forward:-1},{...base,right:1},{...base,right:-0.05},{...base,attack2:true}])assert.equal(humanInputSample(raw).sprint,false,JSON.stringify(raw));
 const craft=humanInputSample(base,{crafting:true}),hurt=humanInputSample({...base,jump:true},{injured:true}),both=humanInputSample(base,{crafting:true,injured:true});
 assert.equal(craft.sprint,false);assert.equal(craft.scale,0.5);assert.deepEqual([hurt.sprint,hurt.crouch,hurt.jump,hurt.scale],[false,true,false,0.5]);assert.equal(both.scale,0.25);
 // InputSample.is_sprinting (the held weapon's sprint fire lockout) = sprint && !aim && walk != 0.
 assert.equal(isSprinting(humanInputSample(base)),true);assert.equal(isSprinting({...humanInputSample(base),aim:true}),false);assert.equal(isSprinting(humanInputSample({forward:-1,sprint:true})),false);
 // Speeds: backwards sprint is 3 m/s (maxBackwardsSpeed), strafing sprint 4, diagonal sprint 4, crafting 2 (no sprint).
 near(speed(motor(),humanInputSample({forward:-1,sprint:true})).horizontal,3,0.01,'backwards sprint');
 near(speed(motor(),humanInputSample({right:1,sprint:true})).horizontal,4,0.01,'strafe sprint');
 near(speed(motor(),humanInputSample({forward:1,right:1,sprint:true})).horizontal,4,0.01,'diagonal sprint');
 near(speed(motor(),humanInputSample(base)).horizontal,8,0.01,'forward sprint');
 near(speed(motor(),humanInputSample(base,{crafting:true})).horizontal,2,0.01,'crafting');
});

test('ProcessInput: crouch or aim stop the sprint (and its flag); airborne clears sprint, crouch and aim and the pole regrows',needsAssets, ()=>{
 const crouching=motor();run(crouching,1,{forward:1,sprint:true,crouch:true});assert.equal(crouching.sample.sprint,false);near(speed(crouching,{forward:1,sprint:true,crouch:true}).horizontal,4*0.55,0.01,'crouch');
 const aiming=motor();run(aiming,0.5,{forward:1,sprint:true,aim:true});assert.equal(aiming.sample.sprint,false);assert.equal(aiming.sample.aim,true);
 const m=motor();run(m,1,{forward:1,sprint:true,crouch:true,aim:true});assert.ok(m.height<1.31&&m.sample.crouch&&m.sample.aim);
 run(m,0.05,{forward:1,sprint:true,crouch:true,aim:true,jump:true});assert.ok(!m.grounded);
 const h=m.height;run(m,0.1,{forward:1,sprint:true,crouch:true,aim:true});
 assert.ok(!m.grounded&&m.sample.cleared,'still airborne');assert.deepEqual([m.sample.sprint,m.sample.crouch,m.sample.aim,m.crouched],[false,false,false,false]);
 assert.ok(m.height>h+0.09,`crouchSpeed 1 in the air: ${h} -> ${m.height}`);
 run(m,1,{forward:1,crouch:true,aim:true});assert.ok(m.grounded&&m.sample.crouch&&m.sample.aim,'restored on the ground');
});

test('jump: 0.2 s press buffer while held, 1 s cooldown from the landing (not the jump), held key never re-jumps',needsAssets, ()=>{
 const m=motor();run(m,0.1);m.update(DT,{jump:true},0);assert.ok(!m.grounded&&m.jumps===1);
 let landed=null;for(let i=0;i<240&&landed===null;i++){m.update(DT,{},0);if(m.grounded)landed=m.time;}
 assert.ok(landed!==null);near(m.lastLandTime,landed,1e-9,'lastLandTime');
 // Held from 0.15 s before the cooldown ends: buffered, it jumps as the cooldown ends.
 const hold=(at)=>{const c=motor();run(c,0.1);c.update(DT,{jump:true},0);let land=null;for(let i=0;i<240&&land===null;i++){c.update(DT,{},0);if(c.grounded)land=c.time;}
  while(c.time<land+1-at-1e-9)c.update(DT,{},0);const press=c.time;let jumped=null;for(let i=0;i<120&&jumped===null;i++){c.update(DT,{jump:true},0);if(c.jumps===2)jumped=c.time;}return {land,press,jumped};};
 const early=hold(0.15);assert.ok(early.jumped!==null&&early.jumped>=early.land+1-1e-9&&early.jumped<early.land+1+DT+1e-9,JSON.stringify(early));
 // Held from 0.3 s before: the press is older than 0.2 s when the cooldown ends, so no jump until pressed again.
 const late=hold(0.3);assert.equal(late.jumped,null,JSON.stringify(late));
 // The cooldown counts from the landing: a jump of ~0.6 s air time cannot repeat 1 s after the take-off.
 const c=motor();run(c,0.1);c.update(DT,{jump:true},0);const start=c.time;let land=null;for(let i=0;i<240&&land===null;i++){c.update(DT,{},0);if(c.grounded)land=c.time;}
 assert.ok(land-start>0.4,`air time ${land-start}`);while(c.time<start+1.05)c.update(DT,{},0);c.update(DT,{jump:true},0);assert.equal(c.jumps,1,'still cooling down');
 while(c.time<land+1-1e-9)c.update(DT,{jump:true},0);c.update(DT,{},0);run(c,0.05,{jump:true});assert.equal(c.jumps,2,'re-pressed after the cooldown');
 // Holding the key through a landing never jumps again.
 const held=motor();run(held,4,{jump:true});assert.equal(held.jumps,1);
});

test('air: trapezoid step and held-jump extra height give the 1.5 m apex (plus the take-off step); a tap gives the base 1 m',needsAssets, ()=>{
 const apex=input=>{const m=motor(),y0=m.feet.y;let peak=y0;m.update(DT,{jump:true},0);for(let i=0;i<120;i++){m.update(DT,input,0);peak=Math.max(peak,m.feet.y);}return peak-y0;};
 const held=apex({jump:true}),tap=apex({});
 // Holding: extraHeight / v0 = 0.0598 s at v0 after the take-off step (7 more steps at 120 Hz), then v0^2/2g = 1 m.
 near(held,1+8*v0*DT,1e-3,'held apex');assert.ok(held>=1.5&&held<=1.5+v0*DT);
 near(tap,1+v0*DT,1e-3,'tapped apex');
 // Free fall from rest is exact: y = g t^2 / 2.
 const m=motor(()=>-1000);m.teleport(new Vector3(0,0,0));m.update(DT,{},0);const y0=m.feet.y;run(m,0.5);near(y0-m.feet.y,0.5*s.gravity*((0.5+DT)**2-DT**2),1e-9,'fall');
});

test('air: inputAirVelocityRatio blends 0.8 new / 0.2 old and the move magnitude stays the take-off one',needsAssets, ()=>{
 const m=motor();run(m,1,{forward:1,sprint:true});near(Math.hypot(...m.inputDirection),2,1e-6,'sprinting magnitude');
 m.update(DT,{forward:1,sprint:true,jump:true},0);run(m,0.05,{forward:1,sprint:true});
 assert.ok(!m.grounded&&!m.sample.sprint);near(Math.hypot(...m.inputDirection),2,1e-6,'magnitudeAir keeps the sprint magnitude');
 // Reversing in the air: each step changes the velocity by 0.8 of the (maxAirAcceleration-limited) change.
 const before=m.velocity.z;m.update(DT,{forward:-1,sprint:true},0);near(m.velocity.z-before,0.8*s.maxAirAcceleration*DT,1e-6,'air change');
 // Releasing the keys resets magnitudeAir to 1: pressing again gives the walking magnitude.
 m.update(DT,{},0);m.update(DT,{forward:1},0);near(Math.hypot(...m.inputDirection),1,1e-6,'re-pressed in the air');
});

test('landing speed penalty: curveLandingSpeedPenalty restarts on landing and only advances while moving',needsAssets, ()=>{
 const keys=controls.landingSpeedPenalty.m_Curve;assert.deepEqual(keys.map(k=>[k.time,+k.value.toFixed(3)]),[[0,1],[0.25,0.5],[0.75,1]]);
 const m=motor();run(m,0.1);m.update(DT,{jump:true},0);while(!m.grounded)m.update(DT,{},0);
 // The next ProcessInput sees the landing (wasInAir) and restarts the curve.
 m.update(DT,{},0);assert.equal(m.landingSpeedPenaltyTime,0);run(m,1);assert.equal(m.landingSpeedPenaltyTime,0,'standing still keeps it');
 const trace=[];for(let i=1;i<=100;i++){m.update(DT,{forward:1},0);trace.push(Math.hypot(...m.inputDirection));}
 near(trace[29],0.5,1e-6,'0.25 s');near(trace[89],1,1e-6,'0.75 s');near(trace[0],evaluateCurve(controls.landingSpeedPenalty,DT),1e-9);
 assert.ok(Math.min(...trace)<0.5,'outSlope -2 dips below 0.5 after 0.25 s');
});

test('ProcessInput with no move input: sprintTime 0, crouchTime snaps to the curve end when crouching, else 0',needsAssets, ()=>{
 const m=motor();run(m,1,{forward:1,sprint:true});assert.ok(m.sprintTime>0.39);m.update(DT,{sprint:true},0);assert.equal(m.sprintTime,0);
 m.update(DT,{crouch:true},0);near(m.crouchTime,0.4,1e-6,'crouching');m.update(DT,{},0);assert.equal(m.crouchTime,0);
 // Moving, the crouch curve eases in (0.4 s) instead.
 m.update(DT,{forward:1,crouch:true},0);near(m.crouchTime,DT,1e-9);assert.equal(m.sample.moving,true);run(m,0.1);assert.equal(m.sample.moving,false);
});

test('too-steep ground: grounded (normal.y > 0.01) and tooSteep, it slides down at slidingSpeed 10; a jump leans along the normal',needsAssets, ()=>{
 const m=motor(slope(70));m.teleport(new Vector3(0,0.5,0));run(m,0.3);
 assert.ok(m.grounded&&m.tooSteep,`grounded ${m.grounded} normal ${m.groundNormal.toArray()}`);
 const a=m.feet.clone();run(m,0.2);const d=m.feet.clone().sub(a);near(d.length()/0.2,s.slidingSpeed,0.3,'slide speed');assert.ok(d.z>0&&d.y<0,'down the slope');
 assert.equal(m.isSliding,false,'slidingEnable 0: never slipping');
 const n=m.groundNormal.clone();m.update(DT,{jump:true},0);
 const expected=new Vector3(0,1,0).lerp(n,0.5).normalize(); // Slerp(up, normal, steepPerpAmount 0.5) of unit vectors
 near(m.jumpDir.angleTo(expected),0,1e-3,'jumpDir');assert.ok(m.jumpDir.z>0.3);
});

test('a fall off a ledge is not a jump landing: no cooldown afterwards',needsAssets, ()=>{
 const m=motor(()=>-3,[{size:[4,3,4],center:[0,-1.5,0]}]);run(m,0.2);assert.ok(m.grounded);
 run(m,1.2,{forward:1});assert.ok(m.grounded&&m.feet.y<-2.9,`fell to ${m.feet.y}`);assert.equal(m.lastLandTime,-Infinity);
 m.update(DT,{jump:true},0);assert.equal(m.jumps,1);
});
