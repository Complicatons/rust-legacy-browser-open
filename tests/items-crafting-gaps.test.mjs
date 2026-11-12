// Items, crafting and inventory fidelity gaps (2026-10-23): learned blueprints across death, the active item leaving its
// slot or breaking, FindItem's largest-stack-first consumption, the research kit's workbench grace and the online loot
// window choice (furnace layout, no Take all).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {ServerInventory} from '../browser/server-inventory.mjs';
import {saveWorld} from '../browser/persistence.mjs';
import {setCondition,BROKEN_NOTICE} from '../browser/item-condition.mjs';
import {GunState,BowState} from '../browser/combat.mjs';
import {completeRepair,blueprintFor} from '../browser/repair.mjs';
import {findBlueprintFor} from '../browser/item-ops.mjs';
import {inventoryFixture as fixture} from './helpers/inventory-fixture.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const cat=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const key=n=>{const k=Object.keys(cat.items).find(k=>cat.items[k].data.m_Name===n);assert.ok(k,n);return k;};
const data=n=>cat.items[key(n)].data;
const slot=(n,uses,extra={})=>({item:key(n),uses,condition:1,maxCondition:1,...extra});
function fresh(slots={}){const inv=new LegacyInventory(cat,undefined,{rng:()=>0.5});inv.slots.fill(null);for(const [i,s] of Object.entries(slots))inv.slots[i]=s;return inv;}

test('learned blueprints survive death: respawn keeps them and adds the loadout ones (SaveToAvatar keeps _boundBPs)',needsAssets,()=>{
 const inv=new LegacyInventory(cat),loadoutBPs=new Set(inv.known),bp=findBlueprintFor(cat,key('M4'));assert.ok(!inv.known.has(bp));
 inv.slots[0]={item:bp,uses:1,condition:1,maxCondition:1};assert.equal(inv.study(0),true);assert.ok(inv.known.has(bp));
 inv.slots.fill(null);inv.selected=-1; // DropInventoryContents emptied the slots
 inv.respawn();assert.ok(inv.known.has(bp),'a learned blueprint is still known');for(const k of loadoutBPs)assert.ok(inv.known.has(k),'default blueprints rebound');
 assert.equal(inv.known.size,loadoutBPs.size+1);assert.deepEqual(inv.slots.slice(30,33).map(s=>inv.item(s.item).m_Name),['Rock','Bandage','Torch'],'default items given again');
 assert.equal(inv.selected,-1);assert.equal(inv.work,null);
 // the offline save carries them
 const saved=JSON.parse(JSON.stringify(saveWorld({now:0,player:{inventory:inv}})));assert.ok(saved.player.inventory.known.includes(bp));
});

test('the active item is put away when it leaves its slot (moved, tossed, used up) but not when its uses change',needsAssets,()=>{
 const inv=fresh({30:slot('Hatchet',1),31:slot('Wood',10),2:slot('Wood',5)});inv.selected=30;
 assert.equal(inv.syncActive(),null);inv.slots[30].condition=0.5;assert.equal(inv.syncActive(),null,'same instance stays held');
 assert.equal(inv.move(30,5),true);assert.equal(inv.selected,30,'only the per-frame check deactivates');assert.equal(inv.syncActive(),'removed');assert.equal(inv.selected,-1);
 assert.equal(inv.syncActive(),null,'nothing held');
 // the active slot's stack used up (Inventory.RemoveItem on a consumed item) and an item tossed (DropHelper → RemoveItem)
 inv.selected=31;inv.slots[31].uses+=0;assert.equal(inv.syncActive(),null);assert.equal(inv.move(2,31),true,'stacking into the held slot keeps it');assert.equal(inv.syncActive(),null);assert.equal(inv.slots[31].uses,15);
 inv.slots[31]=null;assert.equal(inv.syncActive(),'removed');assert.equal(inv.selected,-1);
 inv.slots[32]=slot('Hatchet',1);inv.selected=32;inv.slots[32]=slot('Hatchet',1);assert.equal(inv.syncActive(),'removed','another instance in the slot is not the active item');
});

test('the active item breaking is deactivated with the original popup (HeldItem.ConditionChanged)',needsAssets,()=>{
 const inv=fresh({30:slot('Hatchet',1)}),notices=[];inv.selected=30;
 const ctx=()=>({active:inv.selected===30,deactivate:()=>inv.deactivate(),notice:(icon,text)=>notices.push([icon,text])});
 setCondition(inv,30,0.2,ctx());assert.equal(inv.selected,30);assert.deepEqual(notices,[]);
 const r=setCondition(inv,30,0,ctx());assert.equal(r.deactivated,true);assert.equal(inv.selected,-1);assert.deepEqual(notices,[[BROKEN_NOTICE.icon,'Active item has broken! - Repair it']]);
 assert.ok(inv.slots[30],'the broken item stays in its slot');
});

test('online: ITDE clears the active slot and the highlight; the local frame check never deactivates',needsAssets,()=>{
 const session=new EventTarget();session.inventoryCalls=new Map();session.client=new EventTarget();Object.assign(session.client,{characterView:20,playerId:1,views:new Map(),entities:new Map(),inventory:()=>{}});
 const inv=new ServerInventory(session,cat,{now:()=>0});inv.apply({source:{viewId:20},name:'GNUP',args:[fixture(cat,{slots:Object.assign([],{31:{name:'Hatchet',uses:1}})})]});
 inv.apply({source:{viewId:20},name:'IAST',args:[31,60]});assert.equal(inv.selected,31);inv.slots[31]=null;assert.equal(inv.syncActive(),null);assert.equal(inv.selected,31);
 inv.apply({source:{viewId:20},name:'ITDE',args:[]});assert.equal(inv.selected,-1);assert.equal(inv.activeSlot,null);
 assert.equal(inv.consumeLargestFirst(key('Wood'),5),0,'server-owned amounts');
});

test('Inventory.FindItem: reload, arrows and repair take from the stack with the most uses first (first on a tie)',needsAssets,()=>{
 const ammo=key('556 Ammo'),inv=fresh({0:slot('556 Ammo',10),1:slot('556 Ammo',200),2:slot('556 Ammo',200)});
 assert.equal(inv.findItem(ammo),1);assert.equal(inv.consumeLargestFirst(ammo,50),50);assert.deepEqual(inv.slots.slice(0,3).map(s=>s.uses),[10,150,200]);
 assert.equal(inv.consumeLargestFirst(ammo,355),355);assert.deepEqual(inv.slots.slice(0,3).map(s=>s?.uses??null),[5,null,null],'loops across stacks, removing emptied ones');
 assert.equal(inv.consumeLargestFirst(ammo,9),5,'stops when none is left');assert.equal(inv.slots[0],null);
 // BulletWeaponItem.ActualReload_COD
 const m4=new GunState(data('M4'),ammo),gun={item:key('M4'),uses:0,condition:1},guns=fresh({0:slot('556 Ammo',20),1:slot('556 Ammo',30),5:gun});
 const ev=m4.frame(10,{reload:true},gun,guns);assert.equal(ev.find(e=>e.type==='reload')?.loaded,24);assert.equal(gun.uses,24);assert.deepEqual([guns.slots[0].uses,guns.slots[1].uses],[20,6]);
 // BowWeaponDataBlock: one arrow from the largest stack
 const arrow=key('Arrow'),bow=new BowState(data('Hunting Bow'),arrow),quiver=fresh({0:slot('Arrow',3),1:slot('Arrow',8)});
 bow.activate(0);bow.frame(2,{attack:true},quiver);bow.frame(4.1,{attack:true},quiver);const shot=bow.frame(4.2,{attack:false},quiver);
 assert.deepEqual(shot.events.map(e=>e.type),['fire']);assert.deepEqual([quiver.slots[0].uses,quiver.slots[1].uses],[3,7]);
 // RepairBench.CompleteRepair
 const item=Object.keys(cat.items).find(k=>cat.items[k].data.isRepairable&&blueprintFor(cat,k)?.ingredients.length===1&&cat.items[blueprintFor(cat,k).ingredients[0].item].data._splittable),ing=blueprintFor(cat,item).ingredients[0];
 const tool={item,uses:1,condition:0,maxCondition:1},bench=fresh({0:{item:ing.item,uses:ing.amount,condition:1,maxCondition:1},1:{item:ing.item,uses:ing.amount*2,condition:1,maxCondition:1}});
 assert.equal(completeRepair(tool,cat,bench).ok,true);const need=Math.round(ing.amount*0.5);assert.deepEqual([bench.slots[0]?.uses,bench.slots[1]?.uses],[ing.amount,ing.amount*2-need],'the bigger stack pays');
});

test('Research Kit: a second of workbench grace (CraftingInventory.AtWorkBench) as crafting has',needsAssets,()=>{
 const inv=fresh({0:slot('Research Kit 1',3),1:slot('M4',24,{totalModSlots:0,mods:[]})});inv.known=new Set();
 inv.update(100,true);assert.equal(inv.nearWorkbench(true,100),true);assert.equal(inv.nearWorkbench(false,100.9),true,'just left the bench zone');assert.equal(inv.nearWorkbench(false,101.01),false);
 assert.equal(inv.move(0,1,{atWorkbench:inv.nearWorkbench(false,100.5),notice:()=>{}}),true);assert.ok(inv.known.has(findBlueprintFor(cat,key('M4'))));
 const late=fresh({0:slot('Research Kit 1',3),1:slot('Revolver',8,{totalModSlots:0,mods:[]})});late.update(100,true);const notices=[];
 assert.equal(late.move(0,1,{atWorkbench:late.nearWorkbench(false,101.5),notice:m=>notices.push(m)}),false);assert.deepEqual(notices,['You must be at a workbench to do this.']);
});

test('online loot window: the furnace gets the standard window, only the camp bonfire the fire window; no Take all',needsAssets,()=>{
 for(const [prefab,layout,action] of [[';deploy_furnace',null,null],[';deploy_camp_bonfire','fire',null],[';deploy_repairbench','repair','Repair'],[';deploy_wood_box',null,null],[';drop_lootsack',null,null]]){
  const session=new EventTarget(),sent=[];session.inventoryCalls=new Map();session.client=new EventTarget();Object.assign(session.client,{characterView:20,playerId:1,views:new Map(),entities:new Map([['40:5',{prefab}]]),inventory:(a,s,d)=>sent.push({a,...d})});
  const inv=new ServerInventory(session,cat,{now:()=>0}),src={carrier:40,innerID:5};let opened=null;inv.bindUI({refresh(){},setWorkbench(){},lootOpen:()=>Boolean(opened),openLoot(c){opened=c;},closeLoot(){opened=null;}});
  inv.apply({source:src,name:'SetLooter',args:[1]});inv.apply({source:src,name:'GNUP',args:[fixture(cat,{capacity:9,slots:[{name:'Wood',uses:7}]})]});
  assert.ok(opened,prefab);assert.equal(opened.layout,layout,prefab);assert.equal(opened.action?.label??null,action,prefab);assert.ok(!sent.some(r=>r.a==='take-all'));
 }
});
