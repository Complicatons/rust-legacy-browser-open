import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {DeployableDecay,StructureDecay,envDecayOf,DECAY_DELAY} from '../browser/decay.mjs';
import {present} from './helpers/assets.mjs';

test('deployables lose maxHealth×multiplier per 12 h of exposed time, in 5-minute ticks', ()=>{
 const d=new DeployableDecay({maxHealth:1000,decayMultiplier:0.5,now:0,random:()=>0}); // first tick window starts at 60 s
 assert.equal(d.lastDecayThink,60);
 assert.equal(d.think(300),0); // too early
 assert.equal(d.think(360),300/43200*1000*0.5);
 assert.equal(d.think(1000),300/43200*1000*0.5); // long gaps are capped at one tick
 assert.equal(d.think(1300,{sheltered:()=>true}),0); // a roof within 10 m stops it
 assert.equal(d.think(1600,{carried:true}),0);
 d.touch(1700);assert.equal(d.think(1900),0);
 d.setEnabled(false,2000);assert.equal(d.think(9000),0);
 assert.deepEqual(new DeployableDecay({maxHealth:1,random:()=>0}).load(d.save()).save(),d.save());
});

test('structures wait out the material delay, pool decay and spare load-bearing parts', ()=>{
 const s=new StructureDecay({materialType:1});s.touched(); // wood: 48 h
 const parts=[{type:5,maxHealth:1000},{type:0,maxHealth:500},{type:1,maxHealth:800},{type:2,maxHealth:800},{type:3,maxHealth:600}];
 const opts={random:()=>0.5,carryingWeight:c=>c.type===5,sheltered:c=>c.type===2};
 assert.equal(s.step(100,parts,opts).status,'delaying');
 assert.equal(s.step(DECAY_DELAY[1]+100,parts,opts).status,'delaying'); // exactly used up
 assert.equal(s.step(DECAY_DELAY[1]+1000,parts,opts).status,'pent-up'); // 900 s < 10% of 21600 s
 const r=s.step(DECAY_DELAY[1]+100+2160,parts,opts);
 assert.equal(r.status,'decaying');
 const dmg=Object.fromEntries(r.hits.map(h=>[h.component.type,h.damage]));
 assert.equal(dmg[5],undefined); // foundation carrying weight
 assert.ok(Math.abs(dmg[0]-50)<1e-9&&Math.abs(dmg[1]-80)<1e-9&&Math.abs(dmg[2]-16)<1e-9&&Math.abs(dmg[3]-60)<1e-9);
 s.touched();assert.equal(s.step(DECAY_DELAY[1]+5000,parts,opts).status,'delaying');
});

test('recovered deployables carry their EnvDecay multipliers', {skip:!present('browser/assets/recovered/deployables/manifest.json')}, ()=>{
 const m=JSON.parse(readFileSync('browser/assets/recovered/deployables/manifest.json','utf8'));
 const mults=Object.values(m.prefabs??{}).map(envDecayOf).filter(Boolean).map(e=>Math.fround(e.decayMultiplier));
 assert.ok(mults.length>0);
 assert.equal(mults.length,15);
 assert.equal(envDecayOf(m.prefabs[';deploy_workbench']).decayMultiplier,2);
 assert.equal(Math.fround(envDecayOf(m.prefabs[';deploy_metal_door']).decayMultiplier),Math.fround(0.33));
});
