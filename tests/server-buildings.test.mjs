import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion,Ray} from 'three';import {ServerBuildings} from '../browser/server-buildings.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null,items=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))).items):null;
const emit=(t,type,detail)=>t.dispatchEvent(Object.assign(new Event(type),{detail}));
const foundation=hasRecovered?(Object.entries(manifest.structures).find(([,e])=>e.item==='Wood Foundation')):null,pillar=hasRecovered?(Object.entries(manifest.structures).find(([,e])=>e.item==='Wood Pillar')):null;
function fixture(){const s=new EventTarget();s.client=new EventTarget();s.client.views=new Map();s.client.entities=new Map();s.entityCalls=new Map();return s;}
const master=id=>({viewId:id,prefab:'StructureMasterPrefab',position:[0,-3.5,0],rotation:[0,0,0,1]});
const entity=hasRecovered?({key:'40:1',carrier:40,innerID:1,prefab:foundation[1].prefab,position:[0,-3.5,0],euler:[0,0,0]}):null;
const sm=id=>({carrier:40,innerID:1,name:'SMSet',args:[id]});
test('server building projection replays master bindings and snaps previews without constructing pieces',needsAssets,()=>{
 const s=fixture();s.client.views.set(80,master(80));s.client.entities.set(entity.key,entity);s.entityCalls.set(entity.key,new Map([['SMSet',sm(80)]]));
 const b=new ServerBuildings(s,manifest,items,{zones:[],groundTerrainOnly:()=>true,raycast:()=>({point:new Vector3(2.5,0,2.5),terrain:false})});
 const c=b.part('40:1');assert.equal(c.master.nativeViewId,80);assert.equal(c.master.materialType,1);
 const result=b.system.placement(pillar[0],new Ray(new Vector3(2.5,1.6,2.5),new Vector3(0,-1,0)),new Quaternion());assert.equal(result.valid,true);assert.equal(result.master.nativeViewId,80);assert.equal(b.system.components.size,1,'preview never creates a local piece');assert.equal(c.health,c.maxHealth);
 emit(s.client,'ngc-call',{carrier:40,innerID:1,name:'ClientHealthUpdate',args:[123]});assert.equal(c.health,123);
 // ClientKilled only plays the death effect (client StructureComponent); the destroy that follows culls the piece.
 emit(s.client,'ngc-call',{carrier:40,innerID:1,name:'ClientKilled',args:[]});assert.equal(b.parts.size,1);
 emit(s.client,'entity-destroy',{carrier:40,innerID:1});assert.equal(b.parts.size,0);assert.equal(b.system.components.size,0);
});
test('server building projection handles out-of-order SMSet, reparent, master culling and disconnect',needsAssets,()=>{
 const s=fixture(),b=new ServerBuildings(s,manifest,items,{zones:[]});emit(s.client,'entity',entity);emit(s.client,'ngc-call',sm(80));assert.equal(b.part('40:1').master,null);
 s.client.views.set(80,master(80));emit(s.client,'create',master(80));assert.equal(b.part('40:1').master.nativeViewId,80);
 emit(s.client,'ngc-call',sm(81));assert.equal(b.part('40:1').master,null,'missing replacement master immediately detaches the old grid');
 s.client.views.set(81,master(81));emit(s.client,'create',master(81));assert.equal(b.part('40:1').master.nativeViewId,81);
 s.client.views.delete(81);emit(s.client,'destroy',{});assert.equal(b.part('40:1').master,null);s.client.views.set(81,master(81));emit(s.client,'create',master(81));assert.equal(b.part('40:1').master.nativeViewId,81);
 emit(s,'closed',{});assert.equal(b.parts.size,0);assert.equal(b.masters.size,0);
});
