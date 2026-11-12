import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3} from 'three';
import {CollisionWorld} from '../browser/collision.mjs';
import {LegacyMotor} from '../browser/motor.mjs';
import {HumanBody} from '../browser/survival.mjs';
import {FALL_DAMAGE,FallTracker,fallSpeed,fallImpact,injuryDuration,injuredInput,hurtSelf} from '../browser/fall-damage.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const config=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/player.json',import.meta.url)))):null;
const close=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('falldamage console defaults match the decompiled ConsoleSystem',()=>{
 assert.deepEqual(FALL_DAMAGE,{min_vel:24,max_vel:38,enabled:true,injury_length:40});
});
test('client SendFallImpact (-18) and server ValidateFallVelocity (min_vel 24) gate the impact speed',()=>{
 assert.equal(fallSpeed(-17.9),0);assert.equal(fallSpeed(-18),0);assert.equal(fallSpeed(-23.99),0);
 assert.equal(fallSpeed(-24),24);assert.equal(fallSpeed(-40),40);assert.equal(fallSpeed(5),0);
 assert.equal(fallSpeed(-40,{...FALL_DAMAGE,enabled:false}),0);
});
test('FallImpact: bleeding above 0.25, leg injury above 0.35 / 1-in-3 / under half health, HurtSelf 10 + fraction*maxHealth',()=>{
 const never=()=>0.99,always=()=>0;
 // 15 m drop at gravity 35: sqrt(2*35*15) = 32.4 m/s -> fraction 0.6.
 let r=fallImpact(Math.sqrt(2*35*15),{maxHealth:100,healthFraction:1,rng:never});
 close(r.fraction,(Math.sqrt(1050)-24)/14);assert.ok(r.legInjury);close(r.bleeding,3+(r.fraction-0.25)*10);close(r.damage,10+r.fraction*100);
 r=fallImpact(24,{maxHealth:100,healthFraction:1,rng:never});assert.deepEqual(r,{fraction:0,bleeding:0,legInjury:false,damage:10});
 assert.ok(fallImpact(24,{maxHealth:100,healthFraction:1,rng:always}).legInjury,'Random.Range(0,3)==0');
 assert.ok(fallImpact(24,{maxHealth:100,healthFraction:0.49,rng:never}).legInjury,'healthFraction < 0.5');
 r=fallImpact(24+0.3*14,{maxHealth:100,healthFraction:1,rng:never});close(r.bleeding,3+0.05*10,1e-6);assert.equal(r.legInjury,false);
 // Random.Range is not consumed once fraction > 0.35 (C# short-circuit).
 let calls=0;fallImpact(38,{maxHealth:100,healthFraction:1,rng:()=>{calls++;return 0;}});assert.equal(calls,0);
});
test('injury lasts injury_length * Random.Range(0.9,1.1) and forces crouch at half speed without jump or sprint',()=>{
 close(injuryDuration(()=>0),36);close(injuryDuration(()=>0.5),40);assert.ok(injuryDuration(()=>0.999999)<44);
 assert.deepEqual(injuredInput({forward:1,sprint:true,jump:true},true),{forward:1,sprint:false,jump:false,crouch:true,scale:0.5});
 const plain={forward:1};assert.equal(injuredInput(plain,false),plain);
});
test('HurtSelf bypasses armour and typed bleeding; lethal amounts kill and stop bleeding',()=>{
 const body=new HumanBody({maxHealth:100});body.armor=[100,100,100,100,100,100];let r=hurtSelf(body,30);
 assert.deepEqual(r,{status:'IsAlive',amount:30});assert.equal(body.health,70);assert.equal(body.bleedingLevel,0);
 body.setBleedingLevel(5,0);r=hurtSelf(body,500);assert.equal(r.status,'WasKilled');assert.equal(body.health,0);assert.equal(body.nextBleed,null);
 assert.equal(hurtSelf(body,1).status,'IsDead');
});
test('HumanController landing rule: only landings more than 2 m below the take-off point report the last airborne velocity',()=>{
 const t=new FallTracker();assert.equal(t.update(true,10,0),null);
 t.update(false,10,0);t.update(false,9,-10);assert.equal(t.update(true,8.5,0),null,'1.5 m drop');
 t.update(false,10,4);t.update(false,12,-1);t.update(false,9,-25);assert.equal(t.update(true,7.9,0),-25);
 t.update(false,5,3);t.update(false,9,-5);assert.equal(t.update(true,6,0),null,'landed higher than take-off');
});

function dropTest(height){const world=new CollisionWorld(()=>0);world.build();const m=new LegacyMotor(config,world),tracker=new FallTracker();
 m.teleport(new Vector3(0,height,0));let impact=null;for(let i=0;i<60*6&&impact===null;i++){m.update(1/60,{},0);impact=tracker.update(m.grounded,m.feet.y,m.velocity.y);}
 return {impact,speed:fallSpeed(impact??0)};}
test('motor drops: 6 m is harmless, 15 m injures, 40 m is lethal for the recovered 100 HP body',needsAssets,()=>{
 const body=()=>new HumanBody({maxHealth:config.takeDamage.data._maxHealth});
 const six=dropTest(6);assert.ok(six.impact<-18&&six.impact>-21);assert.equal(six.speed,0);
 const fifteen=dropTest(15);assert.ok(fifteen.speed>30&&fifteen.speed<33);const b=body(),r=fallImpact(fifteen.speed,{maxHealth:b.maxHealth,healthFraction:1});
 assert.equal(hurtSelf(b,r.damage).status,'IsAlive');assert.ok(b.health>25&&b.health<40);assert.ok(r.legInjury&&r.bleeding>5);
 const forty=dropTest(40);assert.ok(forty.speed>51&&forty.speed<53.5);const c=body();assert.equal(hurtSelf(c,fallImpact(forty.speed,{maxHealth:c.maxHealth,healthFraction:1}).damage).status,'WasKilled');
});
