import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
import {StructureSystem,StructureMaster,StructureComponent} from '../browser/structures.mjs';
import {DeployableSystem} from '../browser/deployables.mjs';
import {deployableDoor,DoorState} from '../browser/doors.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {HumanBody,Metabolism} from '../browser/survival.mjs';
import {CodeLock} from '../browser/locks.mjs';
import {saveWorld,loadWorld,saveSlot} from '../browser/persistence.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null,skey=n=>Object.keys(manifest.structures).find(k=>manifest.structures[k].item===n),dkey=n=>Object.keys(manifest.deployables).find(k=>manifest.deployables[k].item===n),ikey=n=>Object.keys(items).find(k=>items[k].data.m_Name===n);
const world={zones:[],raycast:()=>null,groundTerrainOnly:()=>true};
function systems(){const s=new StructureSystem(manifest,items,world),d=new DeployableSystem(manifest,items,{rng:()=>0.5});
 return {structures:s,deployables:d,player:{inventory:new LegacyInventory(catalogue,undefined,{rng:()=>0.5}),body:new HumanBody({rng:()=>0.5}),metabolism:new Metabolism({rng:()=>0.5})}};}
// PlayerInventory.SaveToAvatar keeps items and bound blueprints only: a crafting job (whose ingredients are only taken
// when it completes) and the active item are lost on reload.
test('a reload loses the crafting job and the held item, keeping the ingredients (SaveToAvatar: items + blueprints)',needsAssets,()=>{
 const a=systems(),inv=a.player.inventory,bp=Object.values(catalogue.blueprints).find(r=>r.name==='Wood Storage Box Blueprint');inv.add(ikey('Wood'),100);inv.startCraft(bp.source,100,false,2);inv.update(110);inv.selected=30;
 const saved=JSON.parse(JSON.stringify(saveWorld({now:110,...a})));assert.deepEqual(Object.keys(saved.player.inventory).sort(),['known','slots']);
 const b=systems();loadWorld(saved,{now:5,...b});const restored=b.player.inventory;
 assert.equal(restored.work,null);assert.equal(restored.selected,-1);assert.equal(restored.count(ikey('Wood')),100);
 restored.update(1000,false);assert.equal(restored.count(bp.result),0);assert.equal(restored.count(ikey('Wood')),100);
});

test('an offline world round-trips through JSON onto a new session clock',needsAssets, ()=>{
 const a=systems(),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),0.3);
 const m=new StructureMaster(a.structures,new Vector3(10,0,20),q);
 for(const [name,pos] of [['Wood Foundation',[10,0,20]],['Wood Pillar',[12.5,4,22.5]]]){const c=new StructureComponent(a.structures,skey(name),a.structures.prefabFor(skey(name)),new Vector3(...pos),q);m.add(c);a.structures.components.add(c);}
 a.structures.masters.add(m);const foundation=[...m.components][0];foundation.health=321;
 const box=a.deployables.place(dkey('Wood Storage Box'),new Vector3(11,4,21),q,100,foundation);box.slots[3]={item:ikey('Wood'),uses:77,condition:1};box.health=50;
 const fire=a.deployables.place(dkey('Camp Fire'),new Vector3(0,0,0),q,100);fire.slots[6]={item:ikey('Wood'),uses:5,condition:1};fire.fire.setOn(true,100);
 const door=a.deployables.place(dkey('Wooden Door'),new Vector3(5,0,5),q,100);door.lock=new CodeLock();door.lock.setPassword('1234');door.lock.users.add('76561198000000001');
 const inv=a.player.inventory;inv.add(ikey('Wood'),100);inv.work={blueprint:Object.keys(catalogue.blueprints)[0],finish:130,atWorkbench:false};
 inv.add(ikey('M4'),1);inv.add(ikey('Silencer'),1);const gunIndex=inv.slots.findIndex(s=>s?.item===ikey('M4'));assert.equal(inv.move(inv.slots.findIndex(s=>s?.item===ikey('Silencer')),gunIndex),true);
 a.player.body.health=40;a.player.body.setBleedingLevel(5,100);a.player.metabolism.caloricLevel=900;a.player.metabolism.markConsumptionTime(98);
 const json=JSON.stringify(saveWorld({now:100,...a,player:{...a.player,position:new Vector3(1,2,3),yaw:45}}));

 const b=systems(),r=loadWorld(JSON.parse(json),{now:5,...b});
 assert.deepEqual(r.skipped,[]);assert.deepEqual([r.position.toArray(),r.yaw],[[1,2,3],45]);
 const restoredGun=b.player.inventory.slots[gunIndex];assert.equal(restoredGun.totalModSlots,3);assert.deepEqual(restoredGun.mods,[items[ikey('Silencer')].data._uniqueID]);
 const [m2]=b.structures.masters;assert.equal(m2.components.size,2);assert.equal(m2.materialType,1);
 const f2=[...m2.components].find(c=>c.type===5);assert.equal(f2.health,321);assert.ok(m2.componentAt(new Vector3(12.5,4,22.5)));
 const [box2,fire2,door2]=b.deployables.objects;
 assert.equal(box2.carrier,f2);assert.ok(f2.carried.has(box2));assert.deepEqual([box2.health,box2.slots[3].uses],[50,77]);
 assert.equal(fire2.fire.isOn,true);assert.equal(fire2.fire.nextFuel,5+45); // ReadObjectSave -> SetOn: Random.Range(30, 60) from the load
 assert.ok(door2.lock.hasAccess('76561198000000001'));assert.equal(door2.lock.checkPassword('1234'),true);
 assert.deepEqual(b.player.inventory.slots,inv.slots);assert.equal(b.player.inventory.work,null);
 // HumanBodyTakeDamage.LoadVitals sets _bleedingLevel directly: bleeding is kept, DoBleed is not rescheduled.
 assert.equal(b.player.body.health,40);assert.equal(b.player.body.bleedingLevel,5);assert.equal(b.player.body.nextBleed,null);
 // Metabolism.LoadVitals: calories kept; the consume time is not part of the avatar.
 assert.equal(b.player.metabolism.caloricLevel,900);assert.equal(b.player.metabolism.lastConsumeTime,-Infinity);assert.equal(b.player.metabolism.lastDamageTime,-Infinity);
 assert.throws(()=>loadWorld({version:99},{now:0,...systems()}),/version/);
});

test('save slots tolerate missing or failing storage', ()=>{
 const mem=new Map(),ok=saveSlot({setItem:(k,v)=>mem.set(k,v),getItem:k=>mem.get(k)??null,removeItem:k=>mem.delete(k)});
 assert.equal(ok.write({version:1}),true);assert.deepEqual(ok.read(),{version:1});ok.clear();assert.equal(ok.read(),null);
 const bad=saveSlot({setItem(){throw Error('quota');},getItem(){throw Error('denied');},removeItem(){throw Error('x');}});
 assert.equal(bad.write({}),false);assert.equal(bad.read(),null);bad.clear();
});

test('doors keep their opening direction: BasicDoor.WriteObjectSave 0/1/2 and ReadObjectSave StartOpeningOrClosing',needsAssets, ()=>{
 const withDoors=()=>{const x=systems();x.deployables.onAdd=o=>{if(o.kind==='door')o.door=deployableDoor(o.prefab,o.position,o.rotation);};return x;};
 const a=withDoors(),q=new Quaternion(),place=(x)=>a.deployables.place(dkey('Wooden Door'),new Vector3(x,0,0),q,0);
 const closed=place(0),forward=place(5),reverse=place(10),closing=place(15);
 forward.door.startOpeningOrClosing(1,1000);reverse.door.startOpeningOrClosing(2,1000);for(const o of [forward,reverse])o.door.update(1e6);
 closing.door.startOpeningOrClosing(2,1000);closing.door.update(1e6);closing.door.startOpeningOrClosing(0,1e6);closing.door.update(1e6+10);
 assert.equal(reverse.door.openingInReverse,true);assert.ok(reverse.door.fraction<0);assert.equal(closing.door.state,DoorState.Closing);
 const save=JSON.parse(JSON.stringify(saveWorld({now:0,...a})));
 assert.deepEqual(save.deployables.map(d=>[d.doorState,d.open]),[[0,false],[1,true],[2,true],[0,false]]);
 const b=withDoors();loadWorld(save,{now:0,...b});const [c2,f2,r2,k2]=b.deployables.objects;
 assert.deepEqual([c2.door.state,f2.door.state,r2.door.state,k2.door.state],[DoorState.Closed,DoorState.Opened,DoorState.Opened,DoorState.Closed]);
 assert.deepEqual([f2.door.openingInReverse,r2.door.openingInReverse],[false,true]);assert.equal(r2.door.fraction,-1);assert.equal(f2.door.fraction,1);
 assert.equal(r2.door.enabled,false,'already fully open: no open animation or sounds');
 // Older saves only had `open`: forward.
 for(const d of save.deployables)delete d.doorState;const c=withDoors();loadWorld(save,{now:0,...c});const [,,old]=c.deployables.objects;
 assert.deepEqual([old.door.state,old.door.openingInReverse],[DoorState.Opened,false]);
});
