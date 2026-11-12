import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {itemEventSound,equipmentEvents,equipmentSnapshot,ITEM_EVENT} from '../browser/item-events.mjs';
import {createItemMenu} from '../browser/item-menu.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const deploy=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const keyOf=name=>Object.keys(items.items).find(k=>items.items[k].data.m_Name===name);

test('ItemDataBlock.OnItemEvent clip per event (names, CLEV bytes, null clips)',needsAssets,()=>{
 const helmet=keyOf('Cloth Helmet'),bandage=keyOf('Bandage'),holo=keyOf('Holo sight'),kit=keyOf('Blood Draw Kit');
 assert.equal(itemEventSound(deploy.itemSounds,helmet,'Equipped'),deploy.itemSounds[helmet].equippedSound);
 assert.equal(itemEventSound(deploy.itemSounds,helmet,ITEM_EVENT.UnEquipped),deploy.itemSounds[helmet].unEquippedSound);
 assert.equal(itemEventSound(deploy.itemSounds,holo,'combined'),deploy.itemSounds[holo].combinedSound,'item-ops server events are lower case');
 assert.ok(itemEventSound(deploy.itemSounds,bandage,'Used'));assert.ok(itemEventSound(deploy.itemSounds,kit,'Used'));
 assert.equal(itemEventSound(deploy.itemSounds,helmet,'Used'),null);assert.equal(itemEventSound(deploy.itemSounds,keyOf('Wood'),'Used'),null);
});

test('PlayerInventory.ItemAdded/ItemRemoved on equipment slots 36-39',()=>{
 const helmet={item:'h'},vest={item:'v'},slots=[];slots[36]=helmet;const before=equipmentSnapshot(slots);
 slots[36]=null;slots[37]=vest;assert.deepEqual(equipmentEvents(before,equipmentSnapshot(slots)),[{event:'UnEquipped',key:'h',slot:36},{event:'Equipped',key:'v',slot:37}]);
 assert.deepEqual(equipmentEvents(equipmentSnapshot(slots),equipmentSnapshot(slots)),[]);
 const copy=[];copy[37]={...vest};assert.deepEqual(equipmentEvents(equipmentSnapshot(slots),equipmentSnapshot(copy)),[],'a copied slot (crafting rollback) is not an equip change');
});

test('offline item menu fires Used after a successful use only (Bandage, food, Blood Draw)',needsAssets,()=>{
 const inv=new LegacyInventory(items),events=[];const now=()=>100;
 const body={health:80,healthLoss:20,bleedingLevel:1,maxHealth:100,healOverTime:0,bandage(){this.bleedingLevel=0;},hurt(t){this.health-=t[0];return {status:'IsAlive',amount:t[0]};}};
 const metabolism={canConsumeYet:()=>true,markConsumptionTime(){},remainingCaloricSpace:()=>1000,addCalories(){},addWater(){},addAntiRad(){},addPoison(){}};
 const menu=createItemMenu({inventory:()=>inv,online:()=>false,metabolism,body,now,notice:()=>{},onDamage:()=>{},onItemEvent:(e,k)=>events.push([e,items.items[k].data.m_Name])});
 inv.slots[0]=inv.newSlot(keyOf('Bandage'),2);inv.slots[1]=inv.newSlot(keyOf('Blood Draw Kit'),1);inv.slots[2]=inv.newSlot(keyOf('Granola Bar'),1);
 assert.equal(menu(0).find(o=>o.label==='Use').run(),true);assert.equal(menu(0).find(o=>o.label==='Use').run(),false,'5 s medical reuse delay: no event');
 assert.equal(menu(1).find(o=>o.label==='Use').run(),true);assert.equal(menu(2)[0].run(),true);
 assert.deepEqual(events,[['Used','Bandage'],['Used','Blood Draw Kit'],['Used','Granola Bar']]);
});

test('ItemModItem.TryCombine onto a weapon fires Combined with the mod (server side only)',needsAssets,()=>{
 const inv=new LegacyInventory(items,undefined,{rng:()=>0.999}),events=[];inv.onItemEvent=(e,k)=>events.push([e,items.items[k].data.m_Name]);
 inv.slots.fill(null);inv.add(keyOf('M4'),1);inv.add(keyOf('Silencer'),1);const gun=inv.slots.findIndex(s=>s?.item===keyOf('M4')),mod=inv.slots.findIndex(s=>s?.item===keyOf('Silencer'));
 assert.equal(inv.move(mod,gun),true);assert.deepEqual(events,[['combined','Silencer']]);
 assert.equal(itemEventSound(deploy.itemSounds,keyOf('Silencer'),events[0][0]),deploy.itemSounds[keyOf('Silencer')].combinedSound);
});
