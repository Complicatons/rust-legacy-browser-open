// Item edge cases, 2026-10-23 (GAP-AUDIT.md): offline reload minimum loadout, what the avatar saves, re-drawing the held
// gun after a mod, melee wear on crates/sacks/pickups, online cancel crafting, transientMode items.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Matrix4,Vector3} from 'three';
import {LegacyInventory} from '../browser/inventory.mjs';
import {HumanBody,Metabolism} from '../browser/survival.mjs';
import {saveWorld,loadWorld} from '../browser/persistence.mjs';
import {RESULT,transferable,savesItem} from '../browser/item-ops.mjs';
import {MeleeGather,meleeWears} from '../browser/resources.mjs';
import {ServerInventory} from '../browser/server-inventory.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const cat=hasRecovered?JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))):null;
const key=n=>Object.keys(cat.items).find(k=>cat.items[k].data.m_Name===n);
const empty={structures:{masters:[]},deployables:{objects:[],grabCarrier:undefined,entryFor:()=>null}};
const player=()=>({inventory:new LegacyInventory(cat,undefined,{rng:()=>0.99}),body:new HumanBody({rng:()=>0.5}),metabolism:new Metabolism({rng:()=>0.5})});
const roundTrip=(a,now=100)=>{const save=JSON.parse(JSON.stringify(saveWorld({now,...empty,player:a})));const b=player();const r=loadWorld(save,{now:5,...empty,player:b});return {save,b,r};};

// 1. AvatarSaveRestore.LoadAvatar → TryGiveDefaultItems → Loadout.ApplyTo / ApplyInventorySettings.
test('a reload gives the loadout minimum back: a Rock in belt slot 0, else the first free belt slot, else the bag',needsAssets,()=>{
 const rock=key('Rock');
 let a=player();a.inventory.slots[30]=null;let {b,r}=roundTrip(a);
 assert.equal(b.inventory.slots[30]?.item,rock);assert.deepEqual(r.given,[30]);assert.deepEqual([b.inventory.slots[30].uses,b.inventory.slots[30].condition],[1,1]);
 a=player();a.inventory.slots[30]={item:key('Wood'),uses:5,condition:1,maxCondition:1};({b}=roundTrip(a));
 assert.equal(b.inventory.slots[33]?.item,rock,'own slot taken: first vacant belt slot');assert.equal(b.inventory.slots[30].item,key('Wood'));
 a=player();for(let i=30;i<36;i++)a.inventory.slots[i]={item:key('Wood'),uses:1,condition:1,maxCondition:1};({b}=roundTrip(a));
 assert.equal(b.inventory.slots[0]?.item,rock,'belt full: the other kinds (bag first)');
 a=player();a.inventory.slots.fill(null);for(let i=0;i<36;i++)a.inventory.slots[i]={item:key('Wood'),uses:1,condition:1,maxCondition:1};({b,r}=roundTrip(a));
 assert.equal(b.inventory.findItem(rock),-1,'armour slots are vacant but refuse a Rock');assert.deepEqual(r.given,[]);
 a=player();a.inventory.slots[30]=null;a.inventory.slots[5]={item:rock,uses:1,condition:0.4,maxCondition:1};({b,r}=roundTrip(a));
 assert.equal(b.inventory.slots[30],null,'FindItem finds the Rock elsewhere: nothing added');assert.equal(b.inventory.slots[5].condition,0.4);
});
test('a reload of an empty living character gives the whole loadout and binds the default blueprints',needsAssets,()=>{
 const a=player();a.inventory.slots.fill(null);a.inventory.known=new Set();const {b,r}=roundTrip(a),fresh=new LegacyInventory(cat,undefined,{rng:()=>0.99});
 assert.deepEqual(r.given,[30,31,32]);assert.deepEqual(b.inventory.slots.map(s=>s&&[s.item,s.uses]),fresh.slots.map(s=>s&&[s.item,s.uses]));
 assert.deepEqual([...b.inventory.known].sort(),[...fresh.known].sort());
});

// 2. Metabolism.SaveVitals/LoadVitals, HumanBodyTakeDamage.SaveVitals/LoadVitals, PlayerInventory.SaveToAvatar.
test('the save keeps only the avatar vitals; bleeding comes back without a scheduled bleed',needsAssets,()=>{
 const a=player();Object.assign(a.metabolism,{caloricLevel:900,waterLevelLitre:20,radiationLevel:100,antiRads:10,coreTemperature:-5,poisonLevel:50,nextVomitTime:200,lastConsumeTime:98,lastWarmTime:99});
 a.body.health=40;a.body.setBleedingLevel(5,100);a.body.healOverTime=7;
 const {save,b}=roundTrip(a);
 assert.deepEqual(Object.keys(save.player.metabolism).sort(),['antiRads','caloricLevel','coreTemperature','radiationLevel','waterLevelLitre']);
 assert.deepEqual(Object.keys(save.player.body).sort(),['bleedingLevel','healOverTime','health']);
 const fresh=new Metabolism();
 assert.deepEqual([b.metabolism.caloricLevel,b.metabolism.waterLevelLitre,b.metabolism.radiationLevel,b.metabolism.antiRads,b.metabolism.coreTemperature],[900,20,100,10,-5]);
 assert.deepEqual([b.metabolism.poisonLevel,b.metabolism.nextVomitTime,b.metabolism.lastConsumeTime,b.metabolism.lastWarmTime],[fresh.poisonLevel,fresh.nextVomitTime,fresh.lastConsumeTime,fresh.lastWarmTime]);
 assert.deepEqual([b.body.health,b.body.bleedingLevel,b.body.healOverTime,b.body.nextBleed],[40,5,7,null]);
 b.body.update(1000);b.body.update(1010);assert.equal(b.body.health,47,'heal over time still runs; no bleed tick without a hit or bandage');assert.equal(b.body.bleedingLevel,5);
 b.body.setBleedingLevel(b.body.bleedingLevel,1000);assert.equal(b.body.nextBleed,1008,'the next SetBleedingLevel restarts DoBleed');
});
test('older saves (every vital, selected item, crafting job) still load, reading only what the avatar keeps',needsAssets,()=>{
 const a=player(),save=JSON.parse(JSON.stringify(saveWorld({now:100,...empty,player:a})));
 Object.assign(save.player.inventory,{selected:30,benchUntil:5,work:{blueprint:Object.keys(cat.blueprints)[0],finish:30,atWorkbench:false}});
 Object.assign(save.player.body,{nextBleed:8,bleedInterval:8});Object.assign(save.player.metabolism,{poisonLevel:40,nextVomitTime:'inf',lastConsumeTime:-2,activityLevel:0.4});
 const b=player();b.inventory.selected=31;loadWorld(save,{now:5,...empty,player:b});
 assert.deepEqual([b.inventory.selected,b.inventory.work,b.inventory.craftWorkbenchUntil],[-1,null,-Infinity]);
 assert.deepEqual([b.metabolism.poisonLevel,b.metabolism.nextVomitTime,b.metabolism.lastConsumeTime,b.metabolism.activityLevel],[0,0,-Infinity,0]);assert.equal(b.body.nextBleed,null);
});

// 3. ItemModItem.TryCombine on the active gun: DeactivateItem, Invalidate, OnBeltUse.
test('a mod attached to the held gun re-activates it; a gun that is not held is left alone',needsAssets,()=>{
 const inv=new LegacyInventory(cat,undefined,{rng:()=>0.99});inv.add(key('M4'),1);inv.add(key('Silencer'),1);inv.add(key('Holo sight'),1);
 const gun=inv.slots.findIndex(s=>s?.item===key('M4'));assert.equal(inv.move(gun,33),true);inv.selected=33;const held=inv.activeItem;
 assert.equal(inv.move(inv.slots.findIndex(s=>s?.item===key('Silencer')),33),true);
 assert.deepEqual([inv.selected,inv.activeItem===held,inv.activations,inv.slots[33].mods.length],[33,true,1,1]);
 inv.selected=31;assert.equal(inv.move(inv.slots.findIndex(s=>s?.item===key('Holo sight')),33),true);
 assert.deepEqual([inv.selected,inv.activations,inv.slots[33].mods.length],[31,1,2]);
 assert.equal(inv.reactivate(31),true);assert.equal(inv.reactivate(30),false,'only the active slot');
});

// 4. MeleeWeaponDataBlock.Local_MidSwing / DoAction1: any NetEntityID within 6 m wears the tool.
test('melee swings on crates, sacks, supply crates and pickups wear the tool within 6 m only',()=>{
 const melee=new MeleeGather({rng:()=>0.5}),feet=new Vector3(0,0,0),swing=body=>melee.resolve(0,{},null,{body,point:new Vector3()},null,null,feet);
 const crate={matrix:new Matrix4().makeTranslation(2,0,0)},far={matrix:new Matrix4().makeTranslation(0,0,6)};
 assert.deepEqual(swing({crate}),{kind:'entity',entity:crate});assert.equal(meleeWears(swing({crate})),true);
 assert.equal(meleeWears(swing({crate:far})),false,'6 m or more: DoAction1 returns before the wear');
 // An airdrop SupplyCrate carries its live Unity-space position (z flipped into browser space).
 const supply={airdrop:{},position:new Vector3(0,0,-5.9),matrix:new Matrix4().makeTranslation(100,0,0)};assert.equal(meleeWears(swing({crate:supply})),true);
 assert.equal(meleeWears(swing({crate:{...supply,position:new Vector3(0,0,6.5)}})),false);
 const pickup={object:{matrix:new Matrix4().makeTranslation(0,1,1)},target:{}};assert.equal(meleeWears(swing({pickup})),true);
 assert.deepEqual(swing({crate:{destroyed:true}}),{kind:'other'});assert.equal(meleeWears(swing({})),false);
 for(const kind of ['animal','deployable','resource'])assert.equal(meleeWears({kind}),true);
 assert.equal(meleeWears({kind:'tree'}),false);assert.equal(meleeWears({kind:'miss'}),false);
});

// 5. Client CraftingInventory.CancelCrafting: CRFX and inProgress = false at once.
test('online cancel crafting sends once and clears the job locally at once',needsAssets,()=>{
 const sent=[],session=new EventTarget();session.inventoryCalls=new Map();session.client=new EventTarget();
 Object.assign(session.client,{characterView:20,playerId:1,views:new Map([[20,{prefab:':player_soldier'}]]),entities:new Map(),inventory:(action,source,data)=>sent.push({action,...data})});
 const inv=new ServerInventory(session,cat,{now:()=>10}),uid=cat.items[Object.keys(cat.blueprints)[0]].data._uniqueID;
 inv.apply({source:{viewId:20},name:'CRFU',args:[0,20,2,4,uid,3]});assert.ok(inv.work);
 assert.equal(inv.cancelCraft(),true);assert.equal(inv.work,null);assert.deepEqual(sent.map(s=>s.action),['cancel-craft']);
 assert.equal(inv.cancelCraft(),false,'not in progress: nothing sent');assert.equal(sent.length,1);
});

// 6. transientMode 3 (DoesNotSave | Untransferable).
test('transientMode items: never saved, never moved into another inventory, deleted instead of dropped',needsAssets,async()=>{
 const uber=['Uber Hatchet','Uber Hunting Bow','Invisible Helmet','Invisible Vest','Invisible Pants','Invisible Boots'];
 for(const n of uber){const d=cat.items[key(n)].data;assert.equal(d.transientMode,3,n);assert.equal(transferable(d),false);assert.equal(savesItem(d),false);}
 assert.equal(transferable(cat.items[key('Hatchet')].data),true);
 const a=player(),inv=a.inventory;inv.slots[0]={item:key('Uber Hatchet'),uses:1,condition:1,maxCondition:1};inv.slots[1]={item:key('Wood'),uses:3,condition:1,maxCondition:1};
 const loot={slots:Array(12).fill(null)};
 assert.equal(inv.transfer({box:inv.box(),index:0},{box:loot,index:0}),RESULT.Failed);assert.equal(loot.slots[0],null);assert.equal(inv.slots[0].item,key('Uber Hatchet'));
 assert.equal(inv.transfer({box:inv.box(),index:1},{box:loot,index:1}),RESULT.Moved,'ordinary items still move');
 assert.equal(inv.move(0,4),true,'within the same inventory it moves');
 const {save,b}=roundTrip(a);assert.equal(save.player.inventory.slots[4],null);assert.equal(b.inventory.slots[4],null);
 // Older saves that still hold one: LoadItem refuses it.
 save.player.inventory.slots[4]={item:key('Uber Hatchet'),uses:1,condition:1,maxCondition:1};const c=player();loadWorld(save,{now:0,...empty,player:c});assert.equal(c.inventory.slots[4],null);
 // DropHelper.DropItem removes it (no pickup is made).
 const {DroppedItems}=await import('../browser/dropped-items.mjs'),drops=Object.create(DroppedItems.prototype);Object.assign(drops,{items:cat.items,objects:new Set()});
 const d=player().inventory;d.slots[2]={item:key('Uber Hunting Bow'),uses:1,condition:1,maxCondition:1};
 assert.equal(drops.toss(d,2,new Vector3(0,2,0),new Vector3(0,0,1)),false);assert.equal(d.slots[2],null);assert.equal(drops.objects.size,0);
});
