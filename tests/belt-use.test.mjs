// Offline belt keys (browser/belt-use.mjs) against the decompiled InventoryHolder.BeltUse / HeldItem.OnBeltUse /
// ResourceTypeItem.OnBeltUse / LockpickItem.OnBeltUse, and the empty hands of a fresh character.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {TakeDamage} from '../browser/take-damage.mjs';
import {beltUse,resourceRepair,lockpickNotice,isHeldItem} from '../browser/belt-use.mjs';
import {noticeStyle} from '../browser/notices.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const catalogue=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const keyOf=name=>Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name===name);
const put=(inv,index,name,extra={})=>{inv.slots[index]={item:keyOf(name),uses:1,condition:1,maxCondition:1,...extra};return index;};
const calls=()=>{const log=[];return {log,ctx:(over={})=>({canDeactivate:()=>true,useItem:i=>{log.push(['use',i]);return true;},study:i=>{log.push(['study',i]);return true;},repair:i=>{log.push(['repair',i]);return true;},lockpick:i=>log.push(['lockpick',i]),...over})};};

test('a fresh character holds nothing until a belt key takes the rock out',needsAssets,()=>{
 const inv=new LegacyInventory(catalogue);assert.equal(inv.selected,-1);
 const rock=inv.slots.findIndex(s=>s&&catalogue.items[s.item].data.m_Name==='Rock');assert.ok(rock>=30&&rock<36);
 const {ctx}=calls();assert.equal(beltUse(inv,rock,ctx()),'activated');assert.equal(inv.selected,rock);
 // HeldItem.OnBeltUse on the active item: DeactivateItem.
 assert.equal(beltUse(inv,rock,ctx()),'deactivated');assert.equal(inv.selected,-1);
});

test('held items: no switch while the active one cannot be put away; a broken one is not taken out',needsAssets,()=>{
 const inv=new LegacyInventory(catalogue);inv.slots.fill(null);const {ctx}=calls();
 const pistol=put(inv,30,'9mm Pistol'),hatchet=put(inv,31,'Hatchet'),broken=put(inv,32,'Hunting Bow',{condition:0});
 assert.ok(isHeldItem(catalogue.items[inv.slots[pistol].item].class));
 assert.equal(beltUse(inv,pistol,ctx()),'activated');
 assert.equal(beltUse(inv,hatchet,ctx({canDeactivate:()=>false})),'blocked');assert.equal(inv.selected,pistol);
 assert.equal(beltUse(inv,pistol,ctx({canDeactivate:()=>false})),'blocked');assert.equal(inv.selected,pistol);
 assert.equal(beltUse(inv,broken,ctx()),'blocked');assert.equal(inv.selected,pistol,'BeltUse sends nothing for a broken item');
 assert.equal(beltUse(inv,hatchet,ctx()),'activated');assert.equal(inv.selected,hatchet);
});

test('non-held belt items run their OnBeltUse and leave the held item out',needsAssets,()=>{
 const inv=new LegacyInventory(catalogue);inv.slots.fill(null);const {log,ctx}=calls();const rock=put(inv,30,'Rock');beltUse(inv,rock,ctx());
 const wood=put(inv,31,'Wood',{uses:20}),food=put(inv,32,'Cooked Chicken Breast',{uses:3}),bp=put(inv,33,'P250 Blueprint'),pick=put(inv,34,'Handmade Lockpick'),kit=put(inv,35,'Research Kit 1');
 assert.equal(beltUse(inv,wood,ctx()),'used');assert.equal(beltUse(inv,food,ctx()),'used');assert.equal(beltUse(inv,bp,ctx()),'used');assert.equal(beltUse(inv,pick,ctx()),'used');
 assert.equal(beltUse(inv,kit,ctx()),'none','InventoryItem.OnBeltUse does nothing');
 assert.deepEqual(log,[['repair',wood],['use',food],['study',bp],['lockpick',pick]]);assert.equal(inv.selected,rock);
});

test('resource repair: ResourceTypeItemDataBlock.UseItem rules and texts',needsAssets,()=>{
 const wood=keyOf('Wood'),td=new TakeDamage({maxHealth:1000}),target={repairAmmo:wood,resForMaxHealth:10,takeDamage:td},notices=[],note=t=>notices.push(t),state={};
 assert.equal(resourceRepair(state,wood,target,100,note),null,'full health: nothing');
 td.hurt(450,100);assert.equal(resourceRepair(state,wood,target,103,note),null);assert.deepEqual(notices,["Can't repair - Being damaged"]);
 assert.equal(resourceRepair(state,keyOf('Metal Fragments'),target,106,note),null,'wrong repair item');
 assert.equal(resourceRepair(state,wood,target,106,note),100);assert.equal(td.health,650);assert.equal(notices.at(-1),'Healed 100 (650/1000)');
 assert.equal(resourceRepair(state,wood,target,107.9,note),null,'2 s after the last repair');
 td.health=960;assert.equal(resourceRepair(state,wood,target,108.5,note),40,'only what is missing');assert.equal(td.health,1000);assert.equal(notices.at(-1),'Healed 40 (1000/1000)');
 assert.equal(resourceRepair({},wood,null,200,note),null,'nothing in reach');
 // Notice.Popup icons of the two server texts (FontAwesome: times, wrench).
 assert.equal(noticeStyle("Can't repair - Being damaged").icon,'');assert.equal(noticeStyle('Healed 100 (650/1000)').icon,'');
});

test('lockpick: no shipped lock is pickable',()=>{
 assert.equal(lockpickNotice(null),'Aim at a locked object.');assert.equal(lockpickNotice({idBase:true}),"You can't lockpick this.");assert.equal(lockpickNotice({idBase:false}),null);
});
