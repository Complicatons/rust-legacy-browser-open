import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {ServerThrowables,FlareState} from '../browser/server-throwables.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const cat=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null,key=n=>Object.keys(cat.items).find(k=>cat.items[k].data.m_Name===n);
test('grenades wait for pin release, preserve native minimum strength and never decrement inventory',needsAssets,()=>{
 const s=new ServerThrowables(),slot={item:key('F1 Grenade'),uses:2,condition:1},inv={activeSlot:0,activeRep:63,slots:[slot],revision:1},w=s.held(inv,cat,{},0),t=w.d.deployLength+0.01;
 assert.equal(s.frame(w,t,{attack:true})[0].type,'pullpin');assert.deepEqual(s.frame(w,t+1.25,{attack:false}),[]);const e=s.frame(w,t+1.251,{attack:false})[0];assert.equal(e.type,'throw');assert.equal(e.strength,5);assert.equal(slot.uses,2);assert.equal(w.reserved,1);
 inv.slots[0]={...slot,uses:1};inv.revision++;assert.equal(s.held(inv,cat,{},t+1.3).state,w.state);assert.equal(w.reserved,0);inv.activeRep=null;assert.equal(s.held(inv,cat,{},t+2),null);
});
test('flare secondary first ignites, then throws on the native delayed schedule',needsAssets,()=>{
 const d=cat.items[key('Flare')].data,state=new FlareState(d);state.activate(0);const t=d.deployLength+0.01;
 assert.equal(state.frame(t,{attack2:true})[0].type,'ignite-animation');assert.deepEqual(state.frame(t+0.79,{}),[]);assert.equal(state.frame(t+0.81,{})[0].type,'ignite');assert.equal(state.lit,true);
 assert.equal(state.frame(t+1.52,{})[0].type,'throw-animation');assert.equal(state.frame(t+2.03,{})[0].type,'flare-throw');assert.equal(state.lit,false);
});
test('basic torch ignites once per native equip, not per GNUP snapshot',needsAssets,()=>{
 const s=new ServerThrowables(),inv={activeSlot:0,activeRep:65,slots:[{item:key('Torch'),uses:1}],revision:1};let w=s.held(inv,cat,{},0);assert.deepEqual(s.frame(w,0,{}),[{type:'ignite'}]);inv.revision++;w=s.held(inv,cat,{},1);assert.deepEqual(s.frame(w,1,{}),[]);inv.activeRep=66;w=s.held(inv,cat,{},2);assert.deepEqual(s.frame(w,2,{}),[{type:'ignite'}]);
});
