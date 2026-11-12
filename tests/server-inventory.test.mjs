import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {BitWriter,BitReader} from '../bridge/ulink/bits.mjs';
import {readArgs,readNgcCall} from '../bridge/ulink/rust.mjs';
import {GameBridge} from '../bridge/game-bridge.mjs';
import {readInventory,ServerInventory} from '../browser/server-inventory.mjs';
import {inventoryFixture as fixture} from './helpers/inventory-fixture.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const cat=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const key=n=>Object.keys(cat.items).find(k=>cat.items[k].data.m_Name===n),own={viewId:20},bag={carrier:40,innerID:5};
test('online batch craft sends the selected amount and waits for native job and slot snapshots',needsAssets,()=>{
 const {inv,sent}=model(),bp=Object.keys(cat.blueprints).find(k=>cat.items[cat.blueprints[k].result].data.m_Name==='Wood Planks');inv.known.add(bp);
 inv.apply({source:own,name:'GNUP',args:[fixture(cat,{slots:[{name:'Wood',uses:30}]})]});const before=JSON.stringify(inv.slots);
 assert.equal(inv.startCraft(bp,10,false,2).ok,true);assert.equal(sent.at(-1).amount,2);assert.equal(inv.work,null);assert.equal(JSON.stringify(inv.slots),before);
 assert.equal(inv.startCraft(bp,10,false,1000).ok,false);
});
test('server bound blueprint order survives decoding for the native grouped list',needsAssets,()=>{
 const {inv}=model(),keys=Object.keys(cat.blueprints).slice(0,3).reverse(),payload=new BitWriter().i32(keys.length);for(const k of keys)payload.i32(cat.items[k].data._uniqueID);
 inv.apply({source:own,name:'ReceiveBoundBPs',args:[payload.toBytes()]});assert.deepEqual([...inv.known],keys);
});
test('GNUP full and dirty snapshots preserve item condition/mods and reject malformed updates atomically',needsAssets,()=>{
 const slots=[];slots[0]={name:'Wood',uses:12};slots[30]={name:'M4',uses:7,condition:0.5,maxCondition:0.8,totalModSlots:4,mods:[-123]};
 const a=readInventory(fixture(cat,{slots}),cat);assert.equal(a.slots.length,40);assert.equal(a.slots[0].uses,12);assert.equal(a.slots[30].uses,7);assert.equal(a.slots[30].condition,0.5);assert.deepEqual(a.slots[30].mods,[-123]);assert.ok(Math.abs(a.slots[30].maxCondition-0.8)<1e-6);
 const b=readInventory(fixture(cat,{full:false,updates:[[0,null],[1,{name:'Wood',uses:12}]]}),cat,a.slots);assert.equal(b.slots[0],null);assert.equal(b.slots[1].uses,12);assert.equal(a.slots[0].uses,12);assert.equal(b.slots[30],a.slots[30]);
 assert.throws(()=>readInventory(fixture(cat,{slots}).subarray(0,12),cat,a.slots));
 assert.throws(()=>readInventory(new BitWriter().u8(40).u8(0).u8(1).u8(1).u8(0).i32(2147483647).toBytes(),cat,a.slots),/Unknown item/);
 assert.throws(()=>readInventory(new BitWriter().u8(40).u8(0).u8(1).u8(0).u8(255).toBytes(),cat,a.slots),/range/);
});
function model(){const session=new EventTarget(),sent=[];session.inventoryCalls=new Map();session.client=new EventTarget();Object.assign(session.client,{characterView:20,playerId:1,views:new Map([[20,{prefab:':player_soldier'}]]),entities:new Map([['40:5',{prefab:';drop_lootsack'}]]),inventory:(action,source,data)=>sent.push({action,source,...data})});return {session,sent,inv:new ServerInventory(session,cat,{now:()=>10})};}
test('online item requests wait for server snapshots; authorised loot opens, transfers and closes without local mutations',needsAssets,()=>{
 const {inv,sent}=model(),slots=[];slots[0]={name:'Wood',uses:12};inv.apply({source:own,name:'GNUP',args:[fixture(cat,{slots})]});
 inv.move(0,1);assert.equal(inv.slots[0].uses,12);assert.equal(inv.slots[1],null);assert.deepEqual(sent.pop(),{action:'move',source:own,target:own,fromSlot:0,toSlot:1,op:'move'});
 let opened=null;const ui={refresh(){},setWorkbench(){},lootOpen:()=>Boolean(opened),openLoot(c,done){opened={c,done};},closeLoot(){const old=opened;opened=null;old?.done();}};inv.bindUI(ui);
 inv.apply({source:bag,name:'SetLooter',args:[1]});assert.equal(opened,null,'wait for contents');
 inv.apply({source:bag,name:'GNUP',args:[fixture(cat,{capacity:3,slots:[{name:'Wood',uses:7}]})]});assert.ok(opened);opened.c.take(0);
 assert.equal(opened.c.slots[0].uses,7);assert.equal(inv.slots[0].uses,12);assert.deepEqual(sent.pop(),{action:'move',source:bag,target:own,fromSlot:0,toSlot:0,op:'merge',tryCombine:false});
 opened.c.takeTo(0,28);assert.deepEqual(sent.pop(),{action:'move',source:bag,target:own,fromSlot:0,toSlot:28,op:'move'});opened.c.store(0,2);assert.deepEqual(sent.pop(),{action:'move',source:own,target:bag,fromSlot:0,toSlot:2,op:'move'});opened.c.move(0,1);assert.deepEqual(sent.pop(),{action:'move',source:bag,target:bag,fromSlot:0,toSlot:1,op:'move'});assert.equal(opened.c.slots[0].uses,7);assert.equal(inv.slots[0].uses,12);
 inv.apply({source:own,name:'GNUP',args:[fixture(cat,{full:false,updates:[[0,{name:'Wood',uses:19}]]})]});assert.equal(inv.slots[0].uses,19);
 const before=sent.length;inv.apply({source:bag,name:'ClearLooter',args:[]});assert.equal(opened,null);assert.equal(sent.length,before,'server closes without echoing a stop request');
});
test('server blueprints, active item and crafting progress drive UI state; invalid data requests one refresh',needsAssets,()=>{
 const {inv,sent}=model(),bp=Object.keys(cat.blueprints)[0],uid=cat.items[bp].data._uniqueID;
 inv.apply({source:own,name:'ReceiveBoundBPs',args:[new BitWriter().i32(1).i32(uid).toBytes()]});assert.deepEqual([...inv.known],[bp]);
 inv.apply({source:own,name:'IAST',args:[31,60]});assert.equal(inv.activeSlot,31);assert.equal(inv.activeRep,60);
 inv.apply({source:own,name:'CRFU',args:[0,20,2,4,uid,3]});assert.equal(inv.work.finish,18);assert.equal(inv.work.amount,3);inv.update(100);assert.ok(inv.work,'time alone does not grant crafted items');
 inv.apply({source:own,name:'CRFC',args:[]});assert.equal(inv.work,null);
 inv.apply({source:own,name:'GNUP',args:[new Uint8Array([40])]});inv.apply({source:own,name:'GNUP',args:[new Uint8Array([40])]});assert.equal(sent.filter(r=>r.action==='refresh').length,1);assert.ok(inv.lastError);
});
test('gateway routes inventory transfers through the registered NGC message table and derives destination identities',needsAssets,()=>{
 const schema=JSON.parse(readFileSync(new URL('../bridge/ulink/rpc-schema.json',import.meta.url))),registry=JSON.parse(readFileSync(new URL('../browser/assets/recovered/ngc/registry.json',import.meta.url)));
 const client=new EventEmitter(),sent=[];client.playerId=1;client.sendRpc=r=>sent.push(r);
 const bridge=new GameBridge({client,schema,ngcRegistry:registry,now:()=>0});bridge.views.set(20,{prefab:':player_soldier',owner:1});bridge.views.set(30,{prefab:':player_soldier',owner:2});bridge.views.set(40,{prefab:'!Ng',group:7});
 const prefab=registry.prefabs.find(p=>p.handle===';drop_lootsack');bridge.ngc.set('40:5',{prefab,carrier:40,innerID:5});
 assert.equal(bridge.command({type:'inventory',action:'move',source:bag,target:own,fromSlot:2,toSlot:1,op:'merge',tryCombine:true}),true);
 const c=sent.pop();assert.equal(c.viewId,40);assert.equal(c.name,'C');const call=readNgcCall(c.args[0]),message=prefab.messages[call.messageID];assert.equal(message.name,'ITMG');assert.equal(call.innerID,5);assert.deepEqual(readArgs(message.params,new BitReader(call.args)),[{p1:0,viewId:20},2,1,true]);
 assert.equal(bridge.command({type:'inventory',action:'move',source:own,target:bag,fromSlot:1,toSlot:2,op:'merge',tryCombine:false}),true);assert.deepEqual(sent.pop().args,[{p1:7,p2:5},1,2,false]);
 assert.equal(bridge.command({type:'inventory',action:'belt',source:own,fromSlot:35}),true);assert.deepEqual(sent.pop().args,[5]);
 assert.equal(bridge.command({type:'inventory',action:'belt',source:{viewId:30},fromSlot:30}),false);
 assert.equal(bridge.command({type:'inventory',action:'toss',source:own,fromSlot:39}),true);const toss=sent.pop();assert.equal(toss.name,'TOSS');assert.deepEqual(toss.types,['uLink.BitStream']);assert.deepEqual([...toss.args[0]],[39]);
 for(const [source,fromSlot]of [[own,40],[own,-1],[own,1.5],[{viewId:30},0],[bag,0]])assert.equal(bridge.command({type:'inventory',action:'toss',source,fromSlot}),false);
 assert.equal(bridge.command({type:'inventory',action:'move',source:own,target:{carrier:40,innerID:999},fromSlot:0,toSlot:1,op:'move'}),false);
 assert.equal(bridge.command({type:'inventory',action:'move',source:own,target:bag,fromSlot:-1,toSlot:1,op:'move'}),false);
 // Native CRFS carries a signed int32; Ctrl/max quantities must not hit the former prototype-only 1000 cap.
 for(const amount of [1001,32767,2147483647]){assert.equal(bridge.command({type:'inventory',action:'craft',source:own,blueprint:123,amount}),true);assert.deepEqual(sent.pop().args,[amount,123]);}
 for(const amount of [0,-1,1.5,2147483648])assert.equal(bridge.command({type:'inventory',action:'craft',source:own,blueprint:123,amount}),false);
});
