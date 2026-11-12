import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {Vector3,Matrix4,Quaternion} from 'three';
import {GameBridge} from '../bridge/game-bridge.mjs';
import {ServerCrates} from '../browser/server-crates.mjs';
import {GatewayClient} from '../browser/net-client.mjs';
import {ServerInventory} from '../browser/server-inventory.mjs';
import {inventoryFixture as fixture} from './helpers/inventory-fixture.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const lootManifest=hasRecovered?json('../browser/assets/recovered/loot/manifest.json'):null,cat=hasRecovered?json('../browser/assets/recovered/items/manifest.json'):null;
// An AmmoLootBox Create from the original server (analysis/native-runs/2026-10-29-gameplay-real-single-f): Unity space,
// as the gateway sends it. The page's client converts it into the view it keeps (GatewayClient.apply), as here.
const CREATE={type:'create',viewId:61163,prefab:'AmmoLootBox',owner:65535,group:1608,position:[5753.61474609375,408.12255859375,-4294.9150390625],rotation:[-6.553351283855591e-8,0.70710688829422,-1.728850662630066e-7,0.7071067690849304]};
const AMMO=(()=>{const c=new GatewayClient({url:'wss://example.invalid'});c.apply(structuredClone(CREATE));return c.views.get(CREATE.viewId);})();
function session(views=[]){const s=new EventTarget(),client=new EventTarget();s.client=client;s.inventoryCalls=new Map();
 Object.assign(client,{characterView:20,playerId:7,views:new Map([[20,{viewId:20,prefab:':player_soldier'}],...views.map(v=>[v.viewId,v])]),entities:new Map(),sent:[],inventory:(action,source,data)=>client.sent.push({action,source,...data})});
 const fire=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));return {s,client,fire};}

test('online map crates are the server\'s classic views at their Create transform, with Context use and looter',needsAssets,()=>{
 const {s,client,fire}=session([AMMO]),spawned=[],removed=[];
 s.inventoryCalls.set('v:'+AMMO.viewId,[{source:{viewId:AMMO.viewId},name:'SetLooter',args:[9]}]);
 const crates=new ServerCrates(s,lootManifest.prefabs,{spawn:c=>spawned.push(c),remove:c=>removed.push(c)});
 assert.equal(spawned.length,1,'a Create that arrived before the world was ready is drawn too');
 const c=spawned[0];assert.equal(c.prefab.name,'AmmoLootBox');assert.deepEqual(c.online,{viewId:AMMO.viewId});assert.equal(c.looter,9,'retained SetLooter');
 // The page's z is Unity's flipped: the box sits on its LootableObjectSpawner (spawner positions are page space).
 const at=new Vector3().setFromMatrixPosition(c.matrix),spawner=lootManifest.spawners.map(x=>new Vector3(...x.position)).sort((a,b)=>a.distanceTo(at)-b.distanceTo(at))[0];
 assert.ok(at.distanceTo(new Vector3(5753.61474609375,408.12255859375,4294.9150390625))<1e-3);assert.ok(at.distanceTo(spawner)<1,`${at.toArray()} vs spawner ${spawner.toArray()}`);
 // Its orientation is the Unity rotation mirrored like loot.mjs crateMatrix (H·M·H), not mirrored twice.
 const H=new Matrix4().makeScale(1,1,-1),k=c.prefab.rootScale,unity=new Matrix4().compose(new Vector3(...CREATE.position),new Quaternion(...CREATE.rotation).normalize(),new Vector3(k.x,k.y,k.z));
 const want=H.clone().multiply(unity).multiply(H).elements;assert.ok(c.matrix.elements.every((v,i)=>Math.abs(v-want[i])<1e-3),`${c.matrix.elements} vs ${want}`);
 fire(client,'create',{viewId:55,prefab:':wolf_prefab',position:[0,0,0],rotation:[0,0,0,1]});
 const box={...AMMO,viewId:61131,prefab:'BoxLoot'};client.views.set(box.viewId,box);fire(client,'create',box);assert.deepEqual(spawned.map(x=>x.prefab.name),['AmmoLootBox','BoxLoot'],'only the four loot prefabs');
 fire(client,'rpc',{viewId:AMMO.viewId,name:'ClearLooter',args:{class:'LootableObject',values:[]}});assert.equal(c.looter,0);
 fire(client,'rpc',{viewId:AMMO.viewId,name:'SetLooter',args:{class:'LootableObject',values:[7]}});assert.equal(c.looter,7);
 client.views.delete(AMMO.viewId);fire(client,'destroy',{});assert.deepEqual(removed.map(x=>x.viewId),[AMMO.viewId]);assert.equal(crates.crates.size,1);
 fire(s,'closed',{});assert.equal(crates.crates.size,0);
});

test('looting a server map crate: drag and quick-move into the inventory send ITMV/ITMG on the crate view',needsAssets,()=>{
 const {s,client}=session([AMMO]),inv=new ServerInventory(s,cat,{now:()=>1}),crate={viewId:AMMO.viewId};let opened=null;
 inv.bindUI({refresh(){},setWorkbench(){},lootOpen:()=>Boolean(opened),openLoot(c){opened=c;},closeLoot(){opened=null;}});
 inv.apply({source:{viewId:20},name:'GNUP',args:[fixture(cat,{slots:[{name:'9mm Ammo',uses:10}]})]});
 inv.apply({source:crate,name:'SetLooter',args:[7]});inv.apply({source:crate,name:'GNUP',args:[fixture(cat,{capacity:12,slots:[{name:'9mm Ammo',uses:20},{name:'Bandage',uses:2}]})]});
 assert.equal(typeof opened?.takeTo,'function','the server crate opens with request-backed moves');
 assert.equal(opened.takeTo(1,5),true);assert.deepEqual(client.sent.at(-1),{action:'move',source:crate,target:{viewId:20},fromSlot:1,toSlot:5,op:'move'});
 assert.equal(opened.takeTo(0,0),true);assert.deepEqual(client.sent.at(-1),{action:'move',source:crate,target:{viewId:20},fromSlot:0,toSlot:0,op:'merge',tryCombine:false});
 // GameBridge: the same commands become uLink RPCs on the crate's own view, the target as a classic NetEntityID.
 const bc=new EventEmitter(),rpcs=[];bc.playerId=7;bc.sendRpc=r=>rpcs.push(r);
 const bridge=new GameBridge({client:bc,schema:json('../bridge/ulink/rpc-schema.json'),now:()=>0});bridge.views.set(20,{prefab:':player_soldier',owner:7,group:0});bridge.views.set(AMMO.viewId,{prefab:'AmmoLootBox',owner:65535,group:1608});
 for(const cmd of client.sent.slice(-2))assert.equal(bridge.command({type:'inventory',...cmd}),true);
 assert.deepEqual(rpcs.map(r=>[r.viewId,r.name,r.args]),[[AMMO.viewId,'ITMV',[{p1:0,viewId:20},1,5]],[AMMO.viewId,'ITMG',[{p1:0,viewId:20},0,0,false]]]);
});

test('main.mjs: no page-side crates online, the server\'s are drawn instead, Ctrl-click quick-moves like Shift',()=>{
 const main=readFileSync(new URL('../browser/main.mjs',import.meta.url),'utf8'),ui=readFileSync(new URL('../browser/inventory-interactions.mjs',import.meta.url),'utf8');
 assert.match(main,/if\(!online\)loot\.start\(lootTime\(\)\)/);assert.match(main,/online\.crates=new ServerCrates\(online,lootManifest\.prefabs/);
 assert.match(ui,/if\(e\.shiftKey\|\|e\.ctrlKey\)quickMove\(d\.source\)/);
});
