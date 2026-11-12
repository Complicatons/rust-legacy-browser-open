import test from 'node:test';import assert from 'node:assert/strict';
import {Matrix4} from 'three';import {BitWriter} from '../bridge/ulink/bits.mjs';
import {remoteWeaponAction,remoteBulletEnd,remoteMods} from '../browser/remote-weapon.mjs';
const record=(part,point,target)=>{const w=new BitWriter().u8(part);if(part<255)w.u16(target.p1).u16(target.p1?target.p2:target.viewId);point.forEach(v=>w.f32(v));return w.toBytes();};
test('remote firearm stream reads one bullet or exactly numPellets records and rejects malformed payloads',()=>{
 const b=record(9,[0.1,0.2,0.3],{p1:0,viewId:30}),miss=record(255,[10,20,-30]);
 const e=remoteWeaponAction('BulletWeaponDataBlock',b);assert.equal(e.type,'gun');assert.deepEqual(e.hits[0].target,{p1:0,viewId:30});assert.equal(e.hits[0].part,9);
 const shotgun=new Uint8Array([...b,...miss]);assert.equal(remoteWeaponAction('ShotgunDataBlock',shotgun,{numPellets:2}).hits.length,2);
 for(const bytes of [b.subarray(1),shotgun,record(255,[Infinity,0,0]),new Uint8Array()])assert.equal(remoteWeaponAction('BulletWeaponDataBlock',bytes),null);
 assert.equal(remoteWeaponAction('ShotgunDataBlock',b,{numPellets:65}),null);
});
test('bow stream has origin plus quaternion and cannot accept a zero or invalid orientation',()=>{
 const stream=q=>{const w=new BitWriter();[1,2,3,...q].forEach(x=>w.f32(x));return w.toBytes();};
 assert.deepEqual(remoteWeaponAction('BowWeaponDataBlock',stream([0,0,0,1])),{type:'bow',origin:[1,2,3],rotation:[0,0,0,1]});
 assert.equal(remoteWeaponAction('BowWeaponDataBlock',stream([0,0,0,0])),null);
 assert.equal(remoteWeaponAction('BowWeaponDataBlock',stream([NaN,0,0,1])),null);
});
test('remote endpoints use animated player bones, original roots, and reflected prop/wildlife coordinates',()=>{
 const root=new Matrix4().makeTranslation(10,20,30).multiply(new Matrix4().makeScale(1,1,-1)),bone=new Matrix4().makeTranslation(10,22,30).multiply(new Matrix4().makeScale(1,1,-1));
 const bodies=[{onlineActor:{viewId:30,root},bodyPart:9,motion:bone},{onlineActor:{viewId:50},motion:new Matrix4().makeTranslation(40,0,40)},{online:{carrier:80,innerID:2},onlineRoot:new Matrix4().makeTranslation(50,0,50)}],client={views:new Map([[80,{group:7}]])};
 const end=(part,target)=>remoteBulletEnd({part,target,point:[1,2,3]},bodies,client).toArray();
 assert.deepEqual(end(9,{p1:0,viewId:30}),[11,24,27]);assert.deepEqual(end(254,{p1:0,viewId:30}),[11,22,27]);
 assert.deepEqual(end(254,{p1:0,viewId:50}),[41,2,37]);assert.deepEqual(end(254,{p1:7,p2:2}),[51,2,47]);
 assert.deepEqual(end(255,null),[1,2,-3]);assert.deepEqual(end(254,{p1:0,viewId:999}),[1,2,-3]);
});
test('native Mods stream maps datablock UID flags and clears with an empty list',()=>{
 const items={silencer:{data:{_uniqueID:-123,modFlag:8}},light:{data:{_uniqueID:45,modFlag:1}}};
 assert.deepEqual(remoteMods(new BitWriter().u8(2).i32(-123).i32(45).toBytes(),items),{mods:[-123,45],flags:9});
 assert.deepEqual(remoteMods(new Uint8Array([0]),items),{mods:[],flags:0});
 for(const b of [[6],[],[1,0,0,0,0],[0,1]])assert.equal(remoteMods(Uint8Array.from(b),items),null);
});
