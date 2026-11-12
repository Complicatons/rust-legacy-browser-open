import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {canConsume,canWork,consumeUses,randomSpawnUses} from '../browser/crafting.mjs';
import {CONDITION_LOSS,BROKEN_NOTICE,setCondition,tryConditionLoss,armorConditionLoss,isBroken,canActivate,armorSlotAllowed} from '../browser/item-condition.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const key=name=>Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name===name);
const bp=name=>Object.values(catalogue.blueprints).find(r=>catalogue.items[r.result].data.m_Name===name);
const seq=(...v)=>{let i=0;return ()=>v[Math.min(i++,v.length-1)];};
const empty=()=>{const i=new LegacyInventory(catalogue);i.slots.fill(null);return i;};

test('craft completion: Uses.Quantity.Random uses for new non-splittable results (crafted guns carry their spawn ammo)',needsAssets,()=>{
 const pistol=catalogue.items[key('9mm Pistol')].data,kit=catalogue.items[key('Research Kit 1')].data;
 assert.equal(randomSpawnUses(pistol,()=>0.99),1,'_spawnUsesMin 1 .. _spawnUsesMax 1');assert.equal(randomSpawnUses(kit,()=>0),1);assert.equal(randomSpawnUses(kit,()=>0.999),3,'Random.Range(1, 3 + 1)');
 const i=empty(),recipe=bp('9mm Pistol');i.known.add(recipe.source);i.rng=()=>0.5;for(const e of recipe.ingredients)i.add(e.item,e.amount);
 const r=i.completeRecipe(recipe.source,recipe.workbench);assert.deepEqual(r,{ok:true,added:1,lost:0});const made=i.slots.find(s=>s?.item===recipe.result);assert.equal(made.uses,1,'not the 12-round magazine');assert.equal(made.condition,1);
});

test('craft completion consumes like CanConsume/Consume: collection order, every slot, uses of non-splittables; separate entries',needsAssets,()=>{
 const wood=key('Wood'),slots=Array(40).fill(null);slots[3]={item:wood,uses:5};slots[31]={item:wood,uses:10};slots[1]={item:wood,uses:0};
 assert.deepEqual(canConsume(slots,wood,12),[1,3,31]);assert.equal(canConsume(slots,wood,16),null);assert.equal(canConsume(slots,wood,0),null);
 const s={uses:5};assert.deepEqual(consumeUses(s,3),[false,0]);assert.equal(s.uses,2);assert.deepEqual(consumeUses(s,7),[true,5]);assert.deepEqual(consumeUses({uses:0},4),[true,4]);assert.deepEqual(consumeUses({uses:3},0),[false,0]);
 // Each ingredient entry is checked on its own (BlueprintDataBlock.CanWork does not sum repeated entries).
 const doubled={workbench:false,ingredients:[{item:wood,amount:10},{item:wood,amount:10}]};assert.ok(canWork(doubled,1,slots));assert.equal(canWork({...doubled,workbench:true},1,slots),null);
 const i=empty(),recipe=bp('Wood Storage Box');i.known.add(recipe.source);i.slots[0]={item:wood,uses:20,condition:1,maxCondition:1};i.slots[33]={item:wood,uses:20,condition:1,maxCondition:1};
 assert.equal(i.completeRecipe(recipe.source).ok,true);assert.equal(i.slots[33].uses,10);assert.equal(i.slots[0]?.item,recipe.result,'first stack used up; the result takes its slot (first vacancy)');assert.equal(i.slots[0].uses,1);
});

test('a full inventory loses craft results; the stacks that fit still stack',needsAssets,()=>{
 const i=empty(),planks=bp('Wood Planks'),wood=key('Wood'),rock=key('Rock');i.known.add(planks.source);
 i.slots[0]={item:wood,uses:200,condition:1,maxCondition:1};for(let n=1;n<36;n++)i.slots[n]={item:rock,uses:1,condition:1,maxCondition:1};
 const per=planks.amount,r=i.completeRecipe(planks.source,false,1);assert.equal(r.ok,true);assert.equal(r.added+r.lost,per);
 assert.equal(i.slots[0]?.item===wood?i.slots[0].uses:0,200-planks.ingredients[0].amount);
});

test('TryConditionLoss: doesLoseCondition, probability, damagemultiplier, clamp to maxCondition',needsAssets,()=>{
 const i=empty(),hatchet=key('Hatchet');i.slots[30]={item:hatchet,uses:1,condition:0.5,maxCondition:0.6};
 assert.equal(tryConditionLoss(i,30,0.25,0.025,{rng:()=>0.26}),null,'Random.Range(0,1) above the probability');
 const r=tryConditionLoss(i,30,...CONDITION_LOSS.melee,{rng:()=>0.25});assert.ok(r);assert.ok(Math.abs(i.slots[30].condition-0.475)<1e-9);
 tryConditionLoss(i,30,1,0.1,{rng:()=>0,multiplier:2});assert.ok(Math.abs(i.slots[30].condition-0.275)<1e-9);
 setCondition(i,30,5);assert.equal(i.slots[30].condition,0.6,'SetCondition clamps to maxcondition');
 const wood=key('Wood');i.slots[0]={item:wood,uses:5,condition:1,maxCondition:1};assert.equal(tryConditionLoss(i,0,1,0.5,{rng:()=>0}),catalogue.items[wood].data.doesLoseCondition?tryConditionLoss(i,0,1,0,{rng:()=>0}):null);
});

test('HeldItem: the active item breaking is put away with the original popup; broken items cannot be held',needsAssets,()=>{
 const i=empty(),hatchet=key('Hatchet'),notices=[];let put=0;i.slots[30]={item:hatchet,uses:1,condition:0.01,maxCondition:1};
 const r=tryConditionLoss(i,30,1,0.025,{rng:()=>0,active:true,notice:(icon,text)=>notices.push([icon,text]),deactivate:()=>put++});
 assert.equal(r.deactivated,true);assert.equal(put,1);assert.deepEqual(notices,[[BROKEN_NOTICE.icon,'Active item has broken! - Repair it']]);assert.ok(isBroken(i.slots[30]));assert.equal(canActivate(i.slots[30]),false);
 assert.equal(canActivate({condition:100}),true,'loadout 100 reads as full');
});

test('InventoryItem.ConditionChanged: below 0.15 maxCondition a loss may destroy the item (always at 0.05 or less)',needsAssets,()=>{
 const run=(max,roll)=>{const i=empty(),notices=[];i.slots[5]={item:key('Hatchet'),uses:1,condition:max,maxCondition:max};const r=tryConditionLoss(i,5,1,0.001,{rng:seq(0,roll),notice:(icon,t)=>notices.push(t)});return {r,slot:i.slots[5],notices};};
 assert.equal(run(0.2,0.99).slot?.item!=null,true,'0.15 or more: never destroyed');
 const half=run(0.1,0.5);assert.equal(half.r.destroyed,false,'Random.Range > 0.5 needed');const gone=run(0.1,0.51);assert.equal(gone.r.destroyed,true);assert.equal(gone.slot,null);assert.deepEqual(gone.notices,['Item completely destroyed.']);
 const worn=run(0.05,0.0001);assert.equal(worn.r.destroyed,true,'at 0.05 any roll above 0 destroys');
 const i=empty();i.slots[5]={item:key('Hatchet'),uses:1,condition:0.05,maxCondition:0.1};setCondition(i,5,0.08,{rng:()=>0.99});assert.ok(i.slots[5],'no loss (condition rose): never destroyed');
});

test('ArmorItem: broken armour moves to the first free bag slot or is dropped, and may not be worn again',needsAssets,()=>{
 const i=empty(),vest=key('Kevlar Vest'),dropped=[];i.slots[37]={item:vest,uses:1,condition:0.005,maxCondition:1};i.slots[0]={item:key('Wood'),uses:1,condition:1,maxCondition:1};
 const r=tryConditionLoss(i,37,1,0.01,{rng:()=>0});assert.equal(r.moved,1);assert.equal(i.slots[37],null);assert.equal(i.slots[1].item,vest);
 assert.equal(i.move(1,37),false,'CanMoveToSlot keeps a broken armour piece out of the equipment slot');assert.equal(armorSlotAllowed(catalogue.items[vest],i.slots[1],37),false);assert.equal(i.move(1,2),true,'bag moves still work');
 const full=empty();for(let n=0;n<30;n++)full.slots[n]={item:key('Rock'),uses:1,condition:1,maxCondition:1};full.slots[37]={item:vest,uses:1,condition:0.005,maxCondition:1};
 const d=tryConditionLoss(full,37,1,0.01,{rng:()=>0,drop:(slot,index)=>{dropped.push([slot.item,index,full.slots[index]===slot]);full.slots[index]=null;}});assert.equal(d.dropped,true);assert.deepEqual(dropped,[[vest,37,true]],'DropHelper.DropItem while still in its slot');
});

test('HumanBodyTakeDamage.Hurt: bullet/melee/explosion damage wears each worn armour piece (0.75, amount/100*0.25*[0.8,1.2])',needsAssets,()=>{
 const i=empty(),helmet=key('Kevlar Helmet'),boots=key('Kevlar Boots');i.slots[36]={item:helmet,uses:1,condition:1,maxCondition:1};i.slots[39]={item:boots,uses:1,condition:1,maxCondition:1};
 assert.deepEqual(armorConditionLoss(i,[0,0,0,0,10,0],40,{rng:()=>0}),[],'radiation does not wear armour');
 // Draw order per piece (Feet first): Range(0.8, 1.2) for the amount, then TryConditionLoss's roll.
 const out=armorConditionLoss(i,[0,40,0,0,0,0],40,{rng:seq(0.5,0.75,0,0.9)});assert.deepEqual(out.map(o=>o.index),[39]);
 assert.ok(Math.abs(i.slots[39].condition-(1-0.4*0.25*1.0))<1e-9);assert.equal(i.slots[36].condition,1,'0.9 > 0.75: no loss');
});
