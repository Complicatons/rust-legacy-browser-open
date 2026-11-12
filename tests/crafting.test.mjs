import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {maxCraftAmount,requestedCraftAmount,craftModifier,blueprintGroups,craftProgress} from '../browser/crafting.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const wood=hasRecovered?(Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name==='Wood')):null,recipe=hasRecovered?(Object.values(catalogue.blueprints).find(r=>r.name==='Wood Storage Box Blueprint')):null;
function model(){const i=new LegacyInventory(catalogue);i.add(wood,100);return i;}
test('batch duration and consumption cover the entire job, with no early output',needsAssets,()=>{
 const i=model();assert.equal(i.maxCraft(recipe.source),3);assert.equal(i.startCraft(recipe.source,10,false,2).ok,true);assert.equal(i.work.duration,40);
 i.update(49.99);assert.equal(i.count(wood),100);assert.equal(i.count(recipe.result),0);i.update(50);assert.equal(i.count(wood),40);assert.equal(i.count(recipe.result),2);assert.equal(i.work,null);
});
test('batch cancellation leaves materials untouched; changed materials are rechecked at completion',needsAssets,()=>{
 const i=model();i.startCraft(recipe.source,0,false,3);i.update(5);i.cancelCraft();assert.equal(i.count(wood),100);i.startCraft(recipe.source,6,false,3);i.consume(wood,20);i.update(66);assert.equal(i.count(recipe.result),0);assert.equal(i.count(wood),80);assert.ok(i.message.startsWith('Missing'));
});
test('workbench rate is three and required jobs cancel after the one-second grace',needsAssets,()=>{
 const i=model();i.startCraft(recipe.source,0,true,2);i.update(13,true);assert.equal(i.work.progress,39);i.update(40/3,true);assert.equal(i.count(recipe.result),2);
 const j=model();j.catalogue={...catalogue,blueprints:{...catalogue.blueprints,[recipe.source]:{...recipe,workbench:true}}};j.startCraft(recipe.source,0,true,1);j.update(0.5,false);assert.ok(j.work);j.update(1.01,false);assert.equal(j.work,null);assert.equal(j.count(wood),100);
 const k=model();k.catalogue=j.catalogue;k.update(10,true);assert.equal(k.startCraft(recipe.source,10.5,false).ok,true);k.cancelCraft();assert.equal(k.startCraft(recipe.source,11.01,false).ok,false);
});
test('invalid and unaffordable batches never start; a full inventory loses the results, as BlueprintDataBlock.CompleteWork',needsAssets,()=>{
 const i=model();for(const amount of [0,-1,1.5,NaN,Infinity,2147483648,4])assert.equal(i.startCraft(recipe.source,0,false,amount).ok,false);
 // CompleteWork consumes the ingredients, then ignores AddItemAmount's leftover: nothing is refunded or dropped.
 const rock=Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name==='Rock');i.add(rock,100);const r=i.completeRecipe(recipe.source,false,2);
 assert.deepEqual(r,{ok:true,added:0,lost:2});assert.equal(i.count(wood),40);assert.equal(i.count(recipe.result),0);
});
test('native amount controls clamp to materials and retain Ctrl/Shift increments',()=>{
 assert.equal(craftModifier({ctrlKey:true,shiftKey:true}),32767);assert.equal(craftModifier({shiftKey:true}),10);assert.equal(craftModifier({}),1);
 assert.equal(requestedCraftAmount(32768,13),13);assert.equal(requestedCraftAmount('',0),1);assert.equal(requestedCraftAmount(-4,10),1);
 assert.equal(maxCraftAmount({ingredients:[{item:'a',amount:2},{item:'missing',amount:1}]},k=>k==='a'?10:0),5);
});
test('blueprints use native category order and preserve learned order within each category',needsAssets,()=>{
 const groups=blueprintGroups(catalogue,new Set(Object.keys(catalogue.blueprints)));assert.equal(groups[0].name,'Survival');assert.ok(groups.findIndex(g=>g.name==='Resource')<groups.findIndex(g=>g.name==='Weapons'));
 const learned=[...groups.find(g=>g.keys.length>2).keys].reverse(),sub=blueprintGroups(catalogue,new Set(learned));assert.deepEqual(sub[0].keys,learned);
});
test('server progress supports paused/rate changes without granting completion',()=>{
 const work={duration:40,progress:10,rate:3,updatedAt:5};assert.deepEqual(craftProgress(work,10),{fraction:0.625,seconds:5,rate:3});
 assert.deepEqual(craftProgress({...work,rate:0},100),{fraction:0.25,seconds:Infinity,rate:0});assert.equal(craftProgress(work,100).fraction,1);
});
