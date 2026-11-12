import test from 'node:test';
import assert from 'node:assert/strict';
import {fadeIn,fadeOut,fadeDim,stepFade,spriteInRange,spriteFog,spriteCoverage,doorStatus,sleepingBagStatus,SPRITE,SPRITE_FLAG0,SPRITE_FLAG1,OBJECT_BUSY} from '../browser/context-sprites.mjs';

const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('CalculateFadeIn/Out: elapsed/0.15 per second, clamped to 0..1.2', ()=>{
 near(fadeIn(0,0.015)[0],0.1);assert.deepEqual(fadeIn(1.2,0.1),[1.2,false]);assert.deepEqual(fadeIn(1.15,0.1),[1.2,true]);assert.deepEqual(fadeIn(1.5,0.1),[1.2,true]);assert.deepEqual(fadeIn(0.5,0),[0.5,false]);
 near(fadeOut(1,0.015)[0],0.9);assert.deepEqual(fadeOut(0,0.1),[0,false]);assert.deepEqual(fadeOut(0.05,0.1),[0,true]);assert.deepEqual(fadeOut(-1,0.1),[0,true]);
 // Full fade-in from 0 takes 0.18 s (1.2 x 0.15).
 let f=0;for(let i=0;i<18;i++)f=fadeIn(f,0.01)[0];near(f,1.2,1e-9);
});

test('CalculateFadeDim settles on the 0.15 ghost level from either side', ()=>{
 assert.deepEqual(fadeDim(0,1),[0.15,true]);assert.deepEqual(fadeDim(1.2,1),[0.15,true]);assert.deepEqual(fadeDim(0.15,1),[0.15,false]);near(fadeDim(0.1,0.0015)[0],0.11);near(fadeDim(0.5,0.015)[0],0.4);
});

test('g.Step decisions: status flags, occlusion, behind, RPOS hide', ()=>{
 const dt=0.05;
 near(stepFade(0,dt),dt/0.15);
 assert.equal(stepFade(0.5,dt,{blocked:true}),0.5-dt/0.15);assert.equal(stepFade(0.5,dt,{behind:true}),0.5-dt/0.15);
 // SpriteFlag0|1: always in, even when blocked; SpriteFlag1: always out; SpriteFlag0: dim.
 near(stepFade(0,dt,{status:SPRITE_FLAG0|SPRITE_FLAG1,blocked:true}),dt/0.15);
 assert.equal(stepFade(1,dt,{status:SPRITE_FLAG1}),1-dt/0.15);
 assert.equal(stepFade(1.2,1,{status:SPRITE_FLAG0}),0.15);assert.equal(stepFade(1.2,1,{status:SPRITE_FLAG0,blocked:true}),0);
 assert.equal(stepFade(1,1,{status:SPRITE_FLAG0|SPRITE_FLAG1,hidden:true}),0);
 near(stepFade(0,dt,{status:0}),dt/0.15);assert.equal(stepFade(0.3,0),0.3);
});

test('visibility range, fog and coverage', ()=>{
 assert.equal(SPRITE.cullDistance,5);assert.equal(spriteInRange(4.99),true);assert.equal(spriteInRange(5),false);
 assert.equal(spriteFog(0.5),1);assert.equal(spriteFog(1),1);assert.equal(spriteFog(3),0.5);assert.equal(spriteFog(5),0);assert.equal(spriteFog(9),0);
 assert.equal(spriteCoverage(1,1.2,1),1);assert.equal(spriteCoverage(0.4,1.2,1),0.4);assert.equal(spriteCoverage(1,0.3,3),0.15);
 assert.deepEqual(SPRITE.rayLayers,[0,10,19]); // mask 525313
 assert.equal((1<<0)|(1<<10)|(1<<19),525313);
});

test('requestable status: BasicDoor busy dims, SleepingBag only for its creator', ()=>{
 assert.equal(doorStatus(true),OBJECT_BUSY|SPRITE_FLAG0);assert.equal(doorStatus(false),0);
 assert.equal(sleepingBagStatus('76561198000000001','76561198000000001'),0);assert.equal(sleepingBagStatus('1','2'),SPRITE_FLAG1);
 assert.equal(sleepingBagStatus(null,0),SPRITE_FLAG1);assert.equal(sleepingBagStatus('5',5n),0);
});
