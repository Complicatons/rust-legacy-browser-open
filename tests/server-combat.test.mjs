import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Matrix4,Vector3,PerspectiveCamera} from 'three';
import {ServerFirearm,serverBulletRecord,serverGunRays} from '../browser/server-combat.mjs';
import {GatewayClient} from '../browser/net-client.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const cat=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null,key=hasRecovered?(Object.keys(cat.items).find(k=>cat.items[k].data.m_Name==='M4')):null;
test('online gun prediction never changes inventory and reconciliation preserves cooldowns',needsAssets,()=>{
 const gun=new ServerFirearm(),slot={item:key,uses:7,condition:1},inv={slots:Array(40).fill(null),activeSlot:30,activeRep:60,revision:1,count:()=>20};inv.slots[30]=slot;
 const held=t=>gun.held(inv,cat,()=> 'ammo',{},t);let w=held(0);assert.equal(w.state.frame(0,{attack:true},w.slot,w.inventory).length,0);
 const t=cat.items[key].data.deployLength+0.01;assert.equal(w.state.frame(t,{attack:true},w.slot,w.inventory)[0].type,'fire');assert.equal(w.slot.uses,6);assert.equal(slot.uses,7);
 inv.revision++;inv.slots[30]={...slot,uses:6};const state=w.state;w=held(t+0.001);assert.equal(w.state,state);assert.equal(w.state.frame(t+0.001,{attack:true},w.slot,w.inventory).length,0,'snapshot cannot reset fire cooldown');
 const at=t+cat.items[key].data.fireRate+0.01;assert.equal(w.state.frame(at,{reload:true},w.slot,w.inventory)[0].type,'reload');assert.equal(inv.slots[30].uses,6);assert.equal(inv.count('ammo'),20);assert.equal(w.slot.uses,24);assert.equal(w.inventory.count('ammo'),2);
 assert.equal(w.state.frame(at+1,{attack:true},w.slot,w.inventory).length,0,'reload blocks shooting');
 inv.activeRep=null;assert.equal(held(at+2),null);inv.activeRep=61;assert.notEqual(held(at+3).state,state);
});
test('bullet records use native body-part local points and NGC group, with one gateway reflection',()=>{
 const actor={onlineActor:{viewId:30},bodyPart:9,motion:new Matrix4().makeTranslation(10,20,30).scale(new Vector3(1,1,-1))},position=new Vector3(11,22,27),client={views:new Map([[40,{group:777}]])};
 const record=serverBulletRecord({body:actor,position},null,client);assert.deepEqual(record.target,{p1:0,viewId:30});assert.equal(record.bodyPart,9);assert.deepEqual(record.point,[1,2,-3]);
 let sent;const gateway=Object.create(GatewayClient.prototype);gateway.send=m=>sent=m;gateway.item(60,'bullet-fire',{hits:[record]});assert.deepEqual(sent.data.hits[0].point,[1,2,3]);
 const prop={online:{carrier:40,innerID:5},motion:new Matrix4().makeTranslation(10,20,30)};
 const ngc=serverBulletRecord({body:prop,position},null,client);assert.deepEqual(ngc,{target:{p1:777,p2:5},bodyPart:254,point:[1,2,-3]});
 assert.deepEqual(serverBulletRecord({body:{},position},null,client),{point:position.toArray()});
 const camera=new PerspectiveCamera();camera.updateMatrixWorld();const rays=serverGunRays({spread:[[0,0]],range:100},camera,()=>null,client);assert.equal(rays[0].end.length(),100);assert.deepEqual(rays[0].record.point,[0,0,-1000]);
});
