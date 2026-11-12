import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PerspectiveCamera,Vector3} from 'three';
import {evaluateCurve,hitIndicatorAlpha,hitIndicatorFragmentAlpha,spline,DirectionalDamage,directionalAngle,damageIndicatorAlpha,ClientVitals,VitalsSender,roundToInt,
 LocalDamageDisplay,damageDirection,widgetQuads,shouldPlayHitNotification,isHeadshotPart,DIRECTIONAL_DURATION} from '../browser/combat-feedback.mjs';
import {ServerVitals} from '../browser/server-vitals.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const manifest=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/feedback/manifest.json',import.meta.url)))):null;
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

test('exported prefabs: HUDHitIndicator 32 px centred, DirectionalDamage arc right of centre, overlay pass 3',needsAssets,()=>{
 const h=manifest.hitIndicator.widget,d=manifest.directionalDamage.widget;
 assert.deepEqual([h.scale.x,h.scale.y,h.pivot,h.material.shader,h.material.textureName],[32,32,4,'Custom/HitIndicator','HitNotification']);
 assert.deepEqual([d.position.x,d.scale.x,d.scale.y,d.pivot,d.mirrorY,d.material.shader,d.material.textureName],[333,333,1332,3,true,'Custom/DamageIndicatorFaded','DamageHalve']);
 assert.deepEqual(d.color,{r:1,g:0,b:0,a:1});assert.equal(manifest.directionalDamage.manualHeight,3000);
 assert.deepEqual(manifest.overlay.gameFullscreen.luminance,[0.2199707,0.70703125,0.070983887]);assert.equal(manifest.overlay.gameFullscreen.pass,3);
 assert.deepEqual([manifest.overlay.damageOverlay.name,manifest.overlay.damageOverlay2.name],['damage_overlay_large','damage_overlay_2']);
 assert.match(manifest.sounds.hitnotification,/^sound-[0-9a-f]{20}\.ogg$/);
});

test('TakeDamage.playsHitNotification: players, sleepers and wildlife only; alive required',needsAssets,()=>{
 const f=manifest.playsHitNotification;
 for(const n of ['MalePlayer','MaleSleeper','Wolf','Bear','Chicken_A','Boar_A','Stag_A','Rabbit_A','MutantWolf','MutantBear'])assert.equal(shouldPlayHitNotification(f,n,true),true,n);
 for(const n of ['WoodWall','Campfire','WoodBox','MetalDoor'])assert.equal(shouldPlayHitNotification(f,n,true),false,n);
 assert.equal(shouldPlayHitNotification(f,'Wolf',false),false);
 assert.deepEqual([9,12,16,20,21].map(isHeadshotPart),[true,true,true,true,true]);assert.equal(isHeadshotPart(1),false);assert.equal(isHeadshotPart(254),false);
});

test('HUDHitIndicator alpha follows the original curve, clamped, and ends after its last key',needsAssets,()=>{
 const c=manifest.hitIndicator.curve;
 assert.equal(hitIndicatorAlpha(c,0),0.5);assert.ok(near(hitIndicatorAlpha(c,0.1),254/255));
 for(const k of c.keys)assert.ok(near(evaluateCurve(c.keys,k.time),k.value),'curve passes its keys');
 const mid=hitIndicatorAlpha(c,0.2);assert.ok(mid>0&&mid<1);assert.ok(hitIndicatorAlpha(c,0.25)<mid,'fades out');
 const last=c.keys.at(-1).time;assert.ok(near(hitIndicatorAlpha(c,last),1/255),'clamped to 1/255 at the end');assert.equal(hitIndicatorAlpha(c,last+1e-4),null);
 // Custom/HitIndicator: full texture alpha shows _AlphaValue; low texture alpha scales down.
 assert.ok(near(hitIndicatorFragmentAlpha(1,1,0.5),0.5));assert.ok(near(hitIndicatorFragmentAlpha(0.25,1,0.5),0.25));assert.equal(hitIndicatorFragmentAlpha(0,1,0.5),0);
});

test('TransitionFunctions.Spline and HUDDirectionalDamage channel animation',()=>{
 assert.equal(spline(-1,1,0),1);assert.equal(spline(2,1,0),0);assert.ok(near(spline(0.5,0,1),0.5));assert.ok(near(spline(0.25,0,1),0.15625));
 const values=[0.03,0.01,0.05,0.02,0.97,0.95,0.99,0.96,0];let i=0;const rng=()=>values[i++];
 const d=new DirectionalDamage(rng,{damageTime:10,worldDirection:[1,0,0]});
 assert.deepEqual(d.swap,[false,false,false]);assert.deepEqual(d.inverse,[false,false,false]);
 const w=1.12-(1-(Math.fround(0.96)-Math.fround(0.02)));assert.ok(near(d.speed[0],(1.12-(1-(Math.fround(0.97)-Math.fround(0.03))))/w));
 const start=d.channels(10);assert.deepEqual(start.min.map(v=>+v.toFixed(5)),[1,1,0,0]);assert.ok(near(start.max[3],1));
 const end=d.channels(10+DIRECTIONAL_DURATION);assert.ok(near(end.min[3],1,1e-6));assert.ok(near(end.max[3],0,1e-6));
 assert.equal(d.channels(10+DIRECTIONAL_DURATION+0.01),null);
 // Swap/inverse bits: n = 63 swaps and inverts every channel.
 let j=0;const all=[0,0,0,0,1,1,1,1,0.999];const e=new DirectionalDamage(()=>all[j++]);assert.deepEqual(e.swap,[true,true,true]);assert.deepEqual(e.inverse,[true,true,true]);
 const a=new DirectionalDamage(()=>0.5,{damageTime:0}),b=a.channels(0.4),plain=Object.assign(Object.create(DirectionalDamage.prototype),a,{swap:[false,false,false],inverse:[false,false,false]}).channels(0.4);
 plain.max[2]=Math.fround(1-plain.max[2]);assert.deepEqual(b,plain,'n = 32 only inverts z');
});

test('DamageIndicatorFaded fragment: channel inside its window shows the arc at max.w',()=>{
 // x inside: saturate(max(0, out-of-window channels) - min.w + 1) * tex.a * max.w = (1 - 0.5) * 0.8.
 assert.ok(near(damageIndicatorAlpha([0.5,0,0,1],[0.4,2,2,0.5],[0.6,3,3,0.8]),0.4));assert.ok(near(damageIndicatorAlpha([0.5,0,0,1],[0.4,2,2,0],[0.6,3,3,0.8]),0.8));
 assert.equal(damageIndicatorAlpha([0.5,0,0,0],[0.4,2,2,0.5],[0.6,3,3,0.8]),0,'transparent texels stay hidden');
 // Outside every window: the largest normalised channel minus min.w.
 const v=damageIndicatorAlpha([0.9,0,0,1],[0,2,2,0.2],[0.5,3,3,1]);assert.ok(near(v,1),'above the window saturates');
 assert.ok(near(damageIndicatorAlpha([0.1,0,0,1],[0.2,2,2,0],[0.6,3,3,1]),0),'below the window is clamped away');
});

test('indicator rotation: attacker bearing relative to the view (0 right, 90 above centre, -90 below, 180 left)',()=>{
 for(const yaw of [0,1.1,-2.5]){const cam=new PerspectiveCamera();cam.position.set(10,2,-4);cam.rotation.set(0.3,yaw,0,'YXZ');cam.updateMatrixWorld();
  const f=new Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),r=new Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const angle=bearing=>{const toAttacker=f.clone().multiplyScalar(Math.cos(bearing)).addScaledVector(r,Math.sin(bearing));return directionalAngle(toAttacker.toArray(),cam.matrixWorldInverse);};
  assert.ok(near(angle(0),90,1e-3),'front -> top');assert.ok(near(angle(Math.PI/2),0,1e-3),'right -> right');assert.ok(near(Math.abs(angle(Math.PI)),90,1e-3)&&angle(Math.PI)<0,'behind -> bottom');assert.ok(near(Math.abs(angle(-Math.PI/2)),180,1e-3),'left -> left');}
 const cam=new PerspectiveCamera();cam.updateMatrixWorld();assert.equal(directionalAngle([0,1,0],cam.matrixWorldInverse),null,'straight above keeps the last angle');
 assert.ok(near(directionalAngle([0,0,0],cam.matrixWorldInverse),0),'self damage (zero direction) points right');
 assert.deepEqual(damageDirection({eyes:[0,1.6,0],origin:[0,0,0]},{eyes:[3,1,4]}),[-3,0.6000000000000001,-4]);
 assert.deepEqual(damageDirection({eyes:[0,1.6,0],origin:[0,0,0]},{position:[1,2,3]}),[-1,-2,-3],'non-characters use the victim origin');
});

test('ClientHealthChange: 1 HP threshold, decrease-only indicator; server sends on a rounded change',()=>{
 const v=new ClientVitals(100);assert.deepEqual(v.change(99.5),{before:100,health:99.5,delta:0.5,decreased:true,fraction:0.995,display:false,indicator:false});
 const r=v.change(80);assert.equal(r.display,true);assert.equal(r.indicator,true);assert.equal(v.change(90).indicator,false);
 assert.equal(roundToInt(72.5),72);assert.equal(roundToInt(73.5),74);assert.equal(roundToInt(-0.5),0);
 const s=new VitalsSender();assert.equal(s.hurt(100),true);assert.equal(s.hurt(99.7),false,'100 -> 100 rounded');assert.equal(s.hurt(99.4),true);
 assert.equal(s.hurt(99.1),false);assert.equal(s.hurt(0.4),true);assert.equal(s.hurt(0),true,'death is always sent');assert.equal(s.hurt(0),false);assert.equal(s.repair(5),true);
});

test('LocalDamageDisplay: bob choice, <5% skip, pulse below 40% and 0.5 s impact flash',()=>{
 const d=new LocalDamageDisplay();assert.equal(d.setNewHealthPercent(0.9,null,1),'takeDamageBob');assert.equal(d.lastTakeDamageTime,1);
 assert.equal(d.setNewHealthPercent(0.8,{wildlife:true},2),'meleeBob');assert.equal(d.setNewHealthPercent(0.95,null,3),null,'healing is no hurt');
 assert.equal(d.setNewHealthPercent(0.04,{self:true},4),null);assert.equal(d.lastTakeDamageTime,2,'below 5% no hurt time');
 const e=new LocalDamageDisplay();e.setNewHealthPercent(0.5,null,10);let o=e.overlays(10.25);
 assert.equal(o.flags,3);assert.equal(o.damage,0,'40-60% health sets the texture but the alpha is negative');assert.ok(near(o.impact,0.5));
 assert.equal(e.overlays(10.6).impact,0);
 e.setNewHealthPercent(0.2,null,20);o=e.overlays(20.1);assert.ok(near(o.damage,(0.8-0.6)*2.5*Math.abs(Math.sin(20.1*6))),JSON.stringify(o));
 e.setNewHealthPercent(1,null,21);assert.equal(e.overlays(30).flags,0);
});

test('NGUI widget quads: centred hit marker, mirrored arc (texture bottom row at the centre line)',needsAssets,()=>{
 const [hit]=widgetQuads(manifest.hitIndicator.widget);assert.deepEqual(hit.map(v=>v.p),[[16,16],[16,-16],[-16,-16],[-16,16]]);
 const arc=widgetQuads(manifest.directionalDamage.widget),all=arc.flat();
 assert.deepEqual([Math.min(...all.map(v=>v.p[0])),Math.max(...all.map(v=>v.p[0])),Math.min(...all.map(v=>v.p[1])),Math.max(...all.map(v=>v.p[1]))],[333,666,-666,666]);
 for(const v of all)assert.ok(near(v.uv[1],Math.abs(v.p[1])/666),'v = |y| / half height');
});

test('ServerVitals passes Local_HealthChange attacker views to onHealth',()=>{
 const t=new EventTarget();t.vitalsCalls=new Map([['Local_HealthChange',{name:'Local_HealthChange',args:[72,0]}]]);t.state='in-game';const seen=[];
 const v=new ServerVitals(t,{onHealth:(h,a)=>seen.push([h,a])});t.dispatchEvent(Object.assign(new Event('vitals-call'),{detail:{name:'Local_HealthChange',args:[40,30]}}));
 assert.deepEqual(seen,[[72,0],[40,30]]);assert.equal(v.health,40);
});
