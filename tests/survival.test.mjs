import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HumanBody,Metabolism,menuOption,useItem} from '../browser/survival.mjs';
import {MeleeGather} from '../browser/resources.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const player=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/player.json',import.meta.url)))):null;
const item=name=>Object.values(catalogue.items).find(i=>i.data.m_Name===name).data;
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
function setup(rng=seeded(1)){const d=player.takeDamage.data;return {body:new HumanBody({maxHealth:d._maxHealth,bleedInterval:d._bleedInterval,rng}),meta:new Metabolism({tickRate:player.traits.CharacterMetabolismTrait.data._tickRate,rng})};}
const run=(meta,body,from,to,events)=>{for(let t=from;t<=to+1e-9;t+=0.5){meta.update(t,body,events);body.update(t,meta.isWarm(t),events?.damage);}};

test('recovered player vitals: 100 health, 8 s bleed interval, metabolism ticks every 2 s',needsAssets,()=>{
 assert.equal(player.takeDamage.data._maxHealth,100);assert.equal(player.takeDamage.data._bleedInterval,8);assert.equal(player.traits.CharacterMetabolismTrait.data._tickRate,2);
 assert.equal(menuOption(item('Raw Chicken Breast')),'Eat');assert.equal(menuOption(item('Small Water Bottle')),'Drink');assert.equal(menuOption(item('Small Rations')),'Consume');assert.equal(menuOption(item('Bandage')),'Use');
});

test('calories burn at 300/h resting and 300 + activity x 2,700/h; starving hurts 10 hp per minute',needsAssets,()=>{
 const {body,meta}=setup();run(meta,body,0,3600);assert.ok(Math.abs(meta.caloricLevel-950)<1,meta.caloricLevel);
 // Walking for 30 minutes (activity eases toward 0.4 over the first minute).
 const walk=setup();walk.meta.setTargetActivityLevel(0.4);run(walk.meta,walk.body,0,1800);const expected=1250-(300+0.4*2700)*(1800-60)/3600;
 assert.ok(Math.abs(walk.meta.caloricLevel-expected)<40,`${walk.meta.caloricLevel} vs ${expected}`);
 const starving=setup();starving.meta.caloricLevel=0;run(starving.meta,starving.body,0,60);assert.ok(Math.abs(starving.body.health-90)<0.01,starving.body.health);
});

test('natural healing: 10 hp per minute at 5 calories each, only 10 s after the last damage and when not bleeding',needsAssets,()=>{
 const {body,meta}=setup();body.health=50;meta.markDamageTime(0);run(meta,body,0,9.5);assert.equal(body.health,50);
 run(meta,body,10,70);assert.ok(Math.abs(body.health-60)<0.6,body.health);
 body.setBleedingLevel(1,70);const before=body.health;run(meta,body,70.5,75);assert.ok(body.health<=before);
});

test('eating: raw chicken poisons and makes you vomit; cooked chicken feeds and heals over time; 3 s cooldown',needsAssets,()=>{
 const {body,meta}=setup(seeded(3)),events={vomits:0,vomit(){this.vomits++;}};
 assert.equal(useItem(item('Raw Chicken Breast'),{},{metabolism:meta,body,now:1}),true);
 assert.equal(body.health,90);assert.equal(meta.poisonLevel,3);assert.ok(Math.abs(meta.caloricLevel-1330)<1e-9);
 assert.equal(useItem(item('Raw Chicken Breast'),{},{metabolism:meta,body,now:3}),false,'consume cooldown');
 meta.update(0,body);run(meta,body,0.5,8,events);assert.equal(events.vomits,1);assert.equal(meta.poisonLevel,2);assert.ok(body.health<88);
 const fed=setup();fed.body.health=90;useItem(item('Cooked Chicken Breast'),{},{metabolism:fed.meta,body:fed.body,now:1});
 assert.equal(fed.meta.caloricLevel,1750);assert.equal(fed.body.healOverTime,2);run(fed.meta,fed.body,1,4);
 // +2 from the food's heal-over-time, plus natural regeneration (10 hp/min) running alongside it.
 assert.equal(fed.body.healOverTime,0);assert.ok(fed.body.health>=92&&fed.body.health<92.6,fed.body.health);
 const full=setup();full.meta.caloricLevel=2900;useItem(item('Cooked Chicken Breast'),{},{metabolism:full.meta,body:full.body,now:1});assert.equal(full.meta.caloricLevel,3000);
});

test('bleeding from heavy melee hits, bled every 8 s; bandage and medkits only work when hurt',needsAssets,()=>{
 // A 30-damage hit is >= 25% of max health: always bleeds once health loss exceeds 20%.
 const {body}=setup();body.hurtTyped([0,0,30,0,0,0],0);assert.equal(body.bleedingLevel,4.5);
 body.update(0);body.update(7.9);assert.equal(body.health,70);body.update(8);assert.equal(body.health,65.5);assert.ok(Math.abs(body.bleedingLevel-4.3)<1e-9);
 // Light hits (under 5% of max health) never bleed.
 const light=setup();light.body.health=50;light.body.hurtTyped([0,0,4,0,0,0],0);assert.equal(light.body.bleedingLevel,0);
 const bandage=item('Bandage'),state={};assert.equal(useItem(bandage,state,{body,now:9}),true);assert.equal(body.bleedingLevel,0);
 assert.equal(useItem(bandage,state,{body,now:12}),false,'5 s cooldown');
 const medkit=item('Small Medkit');assert.equal(useItem(medkit,{},{body,now:20}),true);assert.equal(body.healOverTime,40);
 const healthy=setup();healthy.body.setBleedingLevel(3,0);assert.equal(useItem(bandage,{},{body:healthy.body,now:1}),false,'original: no use at full health');
});

test('starving doubles the melee swing interval',needsAssets,()=>{
 const rock=item('Rock'),melee=new MeleeGather();melee.frame(0,{attack:true,starving:true},rock);assert.ok(Math.abs(melee.next-rock.fireRate*2)<1e-9);
});
