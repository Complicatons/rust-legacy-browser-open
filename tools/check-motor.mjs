// GPU check of the offline player motor: hangar_E2_01 exterior steel staircase up/down, wildlife is never ground, walking into a
// RockSpawn rock side stops the player,
// a closing door's CCPusher pushes the player clear, offline FallDamage from 6/15/40 m, and the respawned totem height. Run with REQUIRE_GPU=1 on Windows.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {readFile} from 'node:fs/promises';
import {Vector3,Ray} from 'three';
import {CollisionWorld} from '../browser/collision.mjs';
import {loadRockColliders} from '../browser/rock-colliders.mjs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';
const out='analysis/browser-qa/motor',out2='analysis/browser-qa/motor2';await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);
let browser;const report={};
try {
 browser=await chromium.launch(launchOptions());
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 await page.addInitScript(()=>{let state=0x517cc1b7;Math.random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev&fresh`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:90000});
 report.graphics=await readGraphics(page);
 const grounded=()=>page.waitForFunction(()=>window.explorerState.player.grounded,{},{timeout:5000});
 // Walk with W along legs [[yaw, axis, sign, limit]]; the page samples the motor every rendered frame.
 async function walk(start,legs){
  await page.evaluate(p=>window.explorerDev.teleport(p),start);await page.evaluate(y=>window.explorerDev.face(y,-0.3),legs[0][0]);await page.waitForTimeout(400);await grounded();
  await page.evaluate(legs=>{const run=window.__motorRun={samples:[],leg:0,done:false};const t0=performance.now();
   const tick=()=>{const s=window.explorerState.player,[,axis,sign,limit,steerX]=legs[run.leg];run.samples.push({t:(performance.now()-t0)/1000,feet:s.feet,grounded:s.grounded});
    if(sign*(s.feet[axis]-limit)>0){run.leg++;if(run.leg>=legs.length){run.done=true;return;}window.explorerDev.face(legs[run.leg][0],-0.3);}
    // Optional steering like a player keeping to a flight's centre line (low frame rates overshoot the turn point).
    else if(steerX!==undefined){const dx=steerX-s.feet[0],dz=2*sign;window.explorerDev.face(Math.atan2(-dx,-dz),-0.3);}
    if(performance.now()-t0<15000)requestAnimationFrame(tick);else run.done=true;};requestAnimationFrame(tick);},legs);
  await page.keyboard.down('KeyW');await page.waitForFunction(()=>window.__motorRun.done,{},{timeout:20000});await page.keyboard.up('KeyW');
  const samples=await page.evaluate(()=>window.__motorRun.samples),leg=await page.evaluate(()=>window.__motorRun.leg);
  // Measure from the first frame the character actually moves.
  const first=samples.findIndex(s=>Math.hypot(s.feet[0]-samples[0].feet[0],s.feet[2]-samples[0].feet[2])>0.05),use=samples.slice(Math.max(0,first-1)),a=use[0],b=use.at(-1),seconds=b.t-a.t;
  let path=0,maxDrop=0;for(let i=1;i<use.length;i++){path+=Math.hypot(use[i].feet[0]-use[i-1].feet[0],use[i].feet[2]-use[i-1].feet[2]);
   for(let j=i;j<use.length&&use[j].t-use[i].t<=0.4;j++)maxDrop=Math.max(maxDrop,use[i].feet[1]-use[j].feet[1]);}
  return {completed:leg>=legs.length,seconds:+seconds.toFixed(2),horizontalSpeed:+(path/seconds).toFixed(2),rise:+(b.feet[1]-a.feet[1]).toFixed(2),groundedRatio:+(use.filter(s=>s.grounded).length/use.length).toFixed(3),maxDropIn0_4s:+maxDrop.toFixed(2),frames:use.length,end:b.feet.map(v=>+v.toFixed(2))};}
 // 1. Stairs (browser coordinates; first flight runs -x at z 3564.4, second +z along its centre line x 6065.1:
 // the original skinned capsule, radius .405 + skin .045, catches the handrail's inward turn when hugging the rail).
 report.stairsUp=await walk([6069.6,374.5,3564.4],[[Math.PI/2,0,-1,6065.1],[Math.PI,2,1,3568.8,6065.1]]);
 await page.screenshot({path:`${out}/stairs-top.png`});
 report.stairsDown=await walk([6065.1,379.0,3568.8],[[0,2,-1,3564.4,6065.1],[-Math.PI/2,0,1,6069.4]]);
 console.log('stairs',JSON.stringify({up:report.stairsUp,down:report.stairsDown}));
 // CCMotor slopeSpeedMultiplier and the nosing contact planes slow the climb (~2.4-2.6 m/s, node motor test) and the
 // descent a little (~3.3 m/s); the spawn landing penalty also covers the first 0.75 s of the climb.
 for(const [name,r,min] of [['up',report.stairsUp,2.0],['down',report.stairsDown,2.9]]){assert.ok(r.completed,name);assert.ok(r.horizontalSpeed>min,`${name} speed ${r.horizontalSpeed}`);assert.ok(r.groundedRatio>0.95,`${name} grounded ${r.groundedRatio}`);assert.ok(Math.abs(r.rise)>4.4,`${name} rise ${r.rise}`);}
 assert.ok(report.stairsDown.maxDropIn0_4s<1.8,'no free fall through the open risers');
 // 2. Wildlife (layer 21, noCollide) is never ground: teleport onto a spawned boar's back.
 await page.evaluate(()=>window.explorerDev.teleport([6076,374.6,3560]));await page.waitForTimeout(300);await grounded();
 const boar=await page.evaluate(()=>window.explorerDev.spawnAnimal('boar_prefab',3));assert.ok(boar>=0);await page.waitForTimeout(300);
 const boarAt=await page.evaluate(i=>window.explorerDev.animals()[i].position,boar);
 await page.evaluate(p=>window.explorerDev.teleport([p[0],p[1]+1.3,p[2]]),boarAt);
 const onBoar=[];for(let i=0;i<10;i++){await page.waitForTimeout(150);onBoar.push(await page.evaluate(i=>{const s=window.explorerState.player,a=window.explorerDev.animals()[i];return {feetY:s.feet[1],grounded:s.grounded,animalY:a.position[1],dx:Math.hypot(s.feet[0]-a.position[0],s.feet[2]-a.position[2])};},boar));}
 await page.screenshot({path:`${out}/boar.png`});
 report.boar={samples:onBoar.length,maxHeightAboveAnimalFeet:+Math.max(...onBoar.slice(3).map(s=>s.feetY-s.animalY)).toFixed(3),endGrounded:onBoar.at(-1).grounded};
 console.log('boar',JSON.stringify(report.boar));assert.ok(report.boar.maxHeightAboveAnimalFeet<0.35,'player stands on the ground, not on the boar');assert.ok(report.boar.endGrounded);
 // 3. CCPusher (P3-14): stand where a hinged BlueDoor_94's closed panel will be, then close the door on the player.
 // CCMotor.ApplyHorizontalPushVelocity adds 40 m/s x dt along the nearer push plane while grounded inside the box.
 await mkdir(out2,{recursive:true});
 report.doorPush=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms));
  const i=window.explorerState.doors.findIndex(x=>x.name.startsWith('BlueDoor')&&x.state===3),p=d.pushers().find(x=>x.door===i);if(!p)return {door:i,pusher:false};
  d.useSceneDoor(i);for(let k=0;k<100&&window.explorerState.doors[i].state!==1;k++)await wait(100);
  // Stand 0.12 m off the panel's mid-plane (feet at the threshold: the box centre is the panel's mid-height) on a side the
  // open panel leaves free.
  const n=p.closedNormal,c=p.closedCenter,signed=f=>(f[0]-c[0])*n[0]+(f[2]-c[2])*n[2];let side=0,start=0;
  for(const s of [0.12,-0.12]){d.teleport([c[0]+n[0]*s,c[1]-1.1,c[2]+n[2]*s]);await wait(700);start=signed(window.explorerState.player.feet);side=s;if(Math.abs(start-s)<0.08)break;}
  const steps0=d.motorState().pushSteps;d.useSceneDoor(i);let pushing=0,frames=0,closed=false;const t0=performance.now();
  // CCPusher moves at 40 x dt of desired velocity (~0.7 m/s at 60 fps): after the door has closed, wait until it stops pushing.
  let idle=0;while(performance.now()-t0<9000){await new Promise(r=>requestAnimationFrame(r));frames++;const m=d.motorState();if(m.pushing)pushing++;if(window.explorerState.doors[i].state===3)closed=true;idle=closed&&!m.pushing?idle+1:0;if(idle>20)break;}
  const m=d.motorState(),f=window.explorerState.player.feet;d.aimPoint(c);await wait(200);return {door:i,name:window.explorerState.doors[i].name,side,start:+start.toFixed(3),end:+signed(f).toFixed(3),pushingFrames:pushing,pushSteps:m.pushSteps-steps0,frames,doorState:window.explorerState.doors[i].state,overlapping:m.overlapping,grounded:window.explorerState.player.grounded,radius:m.radius};});
 console.log('doorPush',JSON.stringify(report.doorPush));
 await page.screenshot({path:`${out2}/door-push.png`});
 {const r=report.doorPush;assert.ok(r.door>=0&&r.doorState===3,'door closed');assert.ok(r.pushSteps>0,'CCPusher pushed while the door closed');
  assert.ok(Math.abs(r.start-r.side)<0.08,`started inside the closing panel's box: ${r.start}`);
  // Which side the swinging panel leaves the player on depends on how far it turns per frame; it must not stay inside.
  // CCPusher pushes until the unskinned capsule (radius .405) is clear; PhysX never depenetrates the controller, so it
  // may stay within its skin (contact offset .045) of the panel.
  assert.ok(Math.abs(r.end)>0.047+0.405-2e-3,`pushed clear of the closed door box: ${r.end}`);assert.ok(Math.abs(r.radius-0.45)<1e-6,'skinned radius');}
 // 3b. RockSpawn colliders (SlowSpawn MeshColliders, layer 10): walking with W into a rock side stops at the rock.
 // The target is picked from the export: a rock face met by a level ray 1.5 m above gentle ground, 6 m from the start.
 {const rec='browser/assets/recovered/',rm=JSON.parse(await readFile(rec+'rockspawn/manifest.json','utf8')),tm=JSON.parse(await readFile(rec+'manifest.json','utf8')),hb=await readFile(rec+tm.heightFile);
  const heights=new Float32Array(hb.buffer,hb.byteOffset,hb.byteLength/4),ground=(x,z)=>sampleTriangle(heights,tm.size,...worldToGrid(x,z,tm.extent,tm.size-1));
  const [rocks]=await loadRockColliders(rm,async(d,T)=>{const b=await readFile(rec+'rockspawn/'+d.file);return new T(b.buffer,b.byteOffset,b.byteLength/T.BYTES_PER_ELEMENT);});
  const world=new CollisionWorld(ground);world.addBody(rocks);world.build();let target=null;
  for(let i=0;i<rocks.count&&!target;i+=37){const b=rocks.instanceBounds(i),c=b.getCenter(new Vector3());if(b.max.y<ground(c.x,c.z)+5||ground(c.x,c.z)<262)continue;
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const sx=c.x+dx*((b.max.x-b.min.x)/2+8),sz=c.z+dz*((b.max.z-b.min.z)/2+8),g=ground(sx,sz);
    if(Math.abs(ground(sx+2,sz)-g)>0.6||Math.abs(ground(sx,sz+2)-g)>0.6||world.overlaps(new Vector3(sx,g+0.05,sz),2.08,0.45))continue;
    const hit=world.rayHit(new Ray(new Vector3(sx,g+1.5,sz),new Vector3(-dx,0,-dz)),12);
    if(hit&&hit.distance>4&&hit.distance<10&&Math.abs(ground(hit.position.x,hit.position.z)-g)<2){target={start:[sx,g+0.3,sz],yaw:Math.atan2(dx,dz),wall:hit.distance};break;}}}
  assert.ok(target,'found a rock side on gentle ground');
  await page.evaluate(([p,y])=>{window.explorerDev.teleport(p);window.explorerDev.face(y,0);},[target.start,target.yaw]);await page.waitForTimeout(500);await grounded();
  const f0=await page.evaluate(()=>window.explorerState.player.feet);await page.keyboard.down('KeyW');await page.waitForTimeout(4000);await page.keyboard.up('KeyW');
  const f1=await page.evaluate(()=>window.explorerState.player.feet);report.rock={target,moved:+Math.hypot(f1[0]-f0[0],f1[2]-f0[2]).toFixed(2)};
  await page.screenshot({path:`${out2}/rock-blocked.png`});console.log('rock',JSON.stringify(report.rock));
  // 4 s of walking is ~16 m; the player stops at the rock face (capsule radius 0.45 short of the 1.5 m ray hit, give or take the slope).
  assert.ok(report.rock.moved>target.wall-2.5&&report.rock.moved<target.wall+1.5,`stopped at the rock: moved ${report.rock.moved} m, face at ${target.wall.toFixed(2)} m`);}
 // 4. Fall damage on open ground east of the compound.
 async function drop(height){const base=await page.evaluate(()=>{window.explorerDev.teleport([6076,374.6,3556]);return null;});void base;await page.waitForTimeout(400);await grounded();
  const before=await page.evaluate(()=>({health:window.explorerState.vitals.health,y:window.explorerState.player.feet[1],fall:window.explorerState.player.lastFall}));
  await page.evaluate(([y])=>window.explorerDev.teleport([6076,y,3556]),[before.y+height]);
  await page.waitForFunction(()=>window.explorerState.player.grounded||window.explorerState.vitals.dead,{},{timeout:8000});await page.waitForTimeout(300);
  const s=await page.evaluate(()=>({health:window.explorerState.vitals.health,dead:window.explorerState.vitals.dead,bleeding:window.explorerState.vitals.bleeding,legInjury:window.explorerState.player.legInjury,crouched:window.explorerState.player.crouched,fall:window.explorerState.player.lastFall}));
  const fresh=s.fall&&s.fall!==before.fall&&(!before.fall||s.fall.time!==before.fall.time);
  return {height,healthBefore:+before.health.toFixed(1),healthAfter:+s.health.toFixed(1),dead:s.dead,bleeding:+s.bleeding.toFixed(2),legInjury:s.legInjury,crouched:s.crouched,impactSpeed:fresh?+s.fall.speed.toFixed(2):0,damage:fresh?+s.fall.damage.toFixed(1):0};}
 report.fall6=await drop(6);console.log('fall6',JSON.stringify(report.fall6));
 assert.equal(report.fall6.healthAfter,report.fall6.healthBefore);assert.equal(report.fall6.impactSpeed,0);assert.equal(report.fall6.legInjury,0);
 report.fall15=await drop(15);console.log('fall15',JSON.stringify(report.fall15));
 assert.ok(report.fall15.impactSpeed>30&&report.fall15.impactSpeed<33.5);assert.ok(!report.fall15.dead&&report.fall15.healthAfter<report.fall15.healthBefore-60);
 assert.equal(report.fall15.legInjury,1);assert.ok(report.fall15.bleeding>5);assert.ok(report.fall15.crouched,'leg injury forces crouch');
 // Injured: forced crouch at half movement scale.
 const p0=await page.evaluate(()=>window.explorerState.player.feet);await page.keyboard.down('KeyW');await page.waitForTimeout(1500);await page.keyboard.up('KeyW');
 const p1=await page.evaluate(()=>window.explorerState.player.feet);report.injuredSpeed=+(Math.hypot(p1[0]-p0[0],p1[2]-p0[2])/1.5).toFixed(2);console.log('injuredSpeed',report.injuredSpeed);assert.ok(report.injuredSpeed>0.5&&report.injuredSpeed<1.8);
 await page.screenshot({path:`${out}/fall-injured.png`});
 report.fall40=await drop(40);console.log('fall40',JSON.stringify(report.fall40));
 assert.ok(report.fall40.impactSpeed>50&&report.fall40.impactSpeed<54);assert.ok(report.fall40.damage>100,'lethal from full health');assert.ok(report.fall40.dead);
 await page.screenshot({path:`${out}/fall-dead.png`});
 // 5. CCTotemPole.Teleport on respawn recreates the pole at its initial height (fraction 0 = 1.3 m); it grows at 1 m/s and
 // the eye follows through Crouchable.Smoothing.
 await page.evaluate(()=>document.querySelector('#respawn').click());
 report.respawn=await page.evaluate(async()=>{const d=window.explorerDev,samples=[];const t0=performance.now();
  for(;;){await new Promise(r=>requestAnimationFrame(r));const m=d.motorState();if(window.explorerState.vitals.dead)continue;samples.push({t:(performance.now()-t0)/1000,height:m.height,eye:m.eye});if(performance.now()-t0>1500)break;}
  return {first:samples[0],last:samples.at(-1),eyeMonotonic:samples.every((s,i)=>!i||s.eye>=samples[i-1].eye-1e-6),frames:samples.length};});
 console.log('respawn',JSON.stringify(report.respawn));
 {const r=report.respawn;assert.ok(r.first.height<1.45,`starts contracted: ${r.first.height}`);assert.ok(Math.abs(r.last.height-2.08)<1e-4);assert.ok(Math.abs(r.last.eye-1.647596)<0.01);assert.ok(r.eyeMonotonic);}
 await page.screenshot({path:`${out2}/respawn-standing.png`});
 report.errors=errors;assert.deepEqual(errors,[]);
 await writeFile(`${out}/motor.json`,JSON.stringify(report,null,1));console.log('PASS check-motor',report.graphics.renderer);
} finally {await browser?.close();server.close();}
