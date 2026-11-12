import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LegacyInventory} from '../browser/inventory.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const base=new URL('../browser/assets/recovered/items/',import.meta.url),catalogue=hasRecovered?(JSON.parse(await readFile(new URL('manifest.json',base)))):null;
const key=name=>Object.values(catalogue.items).find(i=>i.data.m_Name===name).source;
test('native weapon slot generation and mod combining consume only valid, nonduplicate mods',needsAssets,()=>{
 const inv=new LegacyInventory(catalogue,undefined,{rng:()=>0.999});inv.add(key('M4'),1);inv.add(key('Silencer'),1);inv.add(key('Holo sight'),1);const gun=inv.slots.find(s=>s?.item===key('M4')),gunIndex=inv.slots.indexOf(gun);assert.equal(gun.totalModSlots,5);
 const modIndex=name=>inv.slots.findIndex(s=>s?.item===key(name));assert.equal(inv.move(modIndex('Silencer'),gunIndex),true);assert.equal(modIndex('Silencer'),-1);assert.equal(gun.mods.length,1);
 inv.add(key('Silencer'),1);assert.equal(inv.move(modIndex('Silencer'),gunIndex),false);assert.notEqual(modIndex('Silencer'),-1);assert.equal(gun.mods.length,1);
 gun.totalModSlots=1;assert.equal(inv.move(modIndex('Holo sight'),gunIndex),false);gun.totalModSlots=2;assert.equal(inv.move(modIndex('Holo sight'),gunIndex),true);assert.equal(gun.mods.length,2);
 const zero=new LegacyInventory(catalogue,undefined,{rng:()=>0});zero.add(key('M4'),1);assert.equal(zero.slots.find(s=>s?.item===key('M4')).totalModSlots,0);
});
test('original items, recipes and icons resolve without placeholder assets',needsAssets,async()=>{
 assert.equal(Object.keys(catalogue.items).length,245);assert.equal(Object.keys(catalogue.blueprints).length,108);assert.equal(Object.keys(catalogue.icons).length,131);assert.deepEqual(catalogue.missingIcons,[]);
 for(const [file,hash] of Object.entries(catalogue.outputSHA256))assert.equal(createHash('sha256').update(await readFile(new URL(file,base))).digest('hex'),hash);
 for(const recipe of Object.values(catalogue.blueprints)){assert.ok(catalogue.items[recipe.result]);for(const i of recipe.ingredients)assert.ok(catalogue.items[i.item]&&i.amount>0);}
});
test('original 40-slot loadout grants rock, two bandages and a fuelled torch',needsAssets,()=>{
 const i=new LegacyInventory(catalogue);assert.equal(i.slots.length,40);assert.equal(i.slots.slice(0,30).filter(Boolean).length,0);
 assert.deepEqual(i.slots.slice(30,33).map(s=>[i.item(s.item).m_Name,s.uses]),[['Rock',1],['Bandage',2],['Torch',250]]);assert.equal(i.known.size,45);
 i.move(30,0);assert.equal(i.slots[30],null);assert.equal(i.slots[0].item,key('Rock'));assert.equal(i.move(0,36),false,'a rock is not headwear');assert.equal(i.slots[36],null);assert.throws(()=>i.move(0,40));
});
test('source stack limits survive split-stack consumption and slot merging',needsAssets,()=>{
 const i=new LegacyInventory(catalogue),wood=key('Wood');assert.equal(i.add(wood,490),0);assert.deepEqual(i.slots.slice(0,2).map(s=>s.uses),[250,240]);
 assert.ok(i.consume(wood,260));assert.equal(i.count(wood),230);i.move(1,0);assert.equal(i.slots[0].uses,230);assert.equal(i.slots[1],null);
});
test('known original blueprint consumes its actual ingredients only after its duration',needsAssets,()=>{
 const i=new LegacyInventory(catalogue),recipe=Object.values(catalogue.blueprints).find(r=>r.name==='Wood Storage Box Blueprint'),wood=key('Wood');assert.equal(recipe.ingredients[0].amount,30);assert.equal(recipe.seconds,20);
 assert.equal(i.canCraft(recipe.source).ok,false);i.add(wood,60);assert.equal(i.startCraft(recipe.source,0).ok,true);i.update(19.99);assert.equal(i.count(wood),60);i.update(20);assert.equal(i.count(wood),30);assert.equal(i.count(recipe.result),1);assert.equal(i.work,null);
});
test('workbench requirements gate crafting; a full inventory loses the crafted result (no rollback in the original)',needsAssets,()=>{
 const i=new LegacyInventory(catalogue),workbench=Object.values(catalogue.blueprints).find(r=>r.workbench&&i.known.has(r.source));assert.ok(workbench);assert.equal(i.canCraft(workbench.source).reason,'Requires a workbench');
 const recipe=Object.values(catalogue.blueprints).find(r=>r.name==='Wood Storage Box Blueprint'),wood=key('Wood');i.add(wood,60);i.add(key('Rock'),100);assert.deepEqual(i.completeRecipe(recipe.source),{ok:true,added:0,lost:1});assert.equal(i.count(wood),30);assert.equal(i.count(recipe.result),0);
});
