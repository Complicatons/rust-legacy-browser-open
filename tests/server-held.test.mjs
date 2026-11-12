import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {ServerHeldItems} from '../browser/server-held.mjs';
import {needsAssets} from './helpers/assets.mjs';
const emit=(t,type,detail)=>t.dispatchEvent(Object.assign(new Event(type),{detail}));
function fixture(){const s=new EventTarget();s.client=new EventTarget();s.client.views=new Map();s.remote=new Map();const events=[],manifest={held:{m4:{uid:-123,item:'M4',netName:'m4.irp',prefab:'m4'}}};const set={attach:(parent,h)=>{events.push([parent,h.rep]);return true;},detach:(parent,rep)=>{events.push([parent,null,rep]);}};return {s,manifest,set,events};}
const view=(id=60,parent=30)=>{const b=new Uint8Array(6),d=new DataView(b.buffer);d.setUint16(0,parent,true);d.setInt32(2,-123,true);return {viewId:id,prefab:'m4.irp',initialData:b};};
test('native held representations wait for their remote parent; a newer one becomes the holder\'s while the old one stays until destroyed',()=>{
 const {s,manifest,set,events}=fixture(),v=view();s.client.views.set(60,v);const h=new ServerHeldItems(s,manifest,{...set});h.frame();assert.equal(events.length,0);s.remote.set(30,{});s.client.views.set(30,{});h.frame();assert.deepEqual(events,[[30,60]]);
 const v2=view(61);s.client.views.set(61,v2);emit(s.client,'create',v2);h.frame();assert.deepEqual(events.slice(-1),[[30,61]],'the old representation is not detached by the new one');assert.equal(h.active.get(30),61);assert.deepEqual([...h.bound.get(30)],[60,61]);
 s.client.views.delete(60);emit(s.client,'destroy',{});assert.deepEqual(events.at(-1),[30,null,60],'destroying the old item detaches only it');assert.equal(h.active.get(30),61);
 s.remote.delete(30);s.client.views.delete(30);emit(s.client,'destroy',{});assert.equal(h.items.size,0,'parent removal also drops already attached orphan representations');assert.deepEqual(events.at(-1),[30,null,61]);
});
test('held representations reject malformed data and mismatched prefabs and omit the local first-person character',()=>{
 const {s,manifest,set,events}=fixture(),h=new ServerHeldItems(s,manifest,{...set});for(const v of [{...view(),initialData:[1,2]}, {...view(),prefab:'unknown'}])h.create(v);assert.equal(h.items.size,0);s.remote.set(30,{});s.client.characterView=30;h.create(view());h.frame();assert.equal(events.length,0);emit(s,'closed',{});assert.equal(h.items.size,0);
});
test('static held export maps the original shared representations and all socket matrices are finite',needsAssets,()=>{
 const m=JSON.parse(readFileSync(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url))),p=JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url)));
 assert.equal(Object.keys(m.held).length,55); // 53 + the cab-datablock.000 Uber Hatchet and Uber Hunting Bowfor(const h of Object.values(m.held)){for(const key of ['handMatrix','muzzleMatrix']){assert.equal(h[key].length,16);assert.ok(h[key].every(Number.isFinite));}assert.ok(m.prefabs[h.prefab].renderers.length>0);assert.equal(h.netName,m.prefabs[h.prefab].name);}
 assert.equal(p.player.itemAttachment.parent,33);assert.equal(p.player.itemAttachment.bone,43);
});
test('buffered torch status survives loading and remote melee actions require a bound representation',()=>{
 const {s,manifest,set}=fixture();manifest.weapons={m4:{class:'BasicTorchItemDataBlock'}};s.actorCalls=new Map([[60,new Map([['OnStatus',{viewId:60,name:'OnStatus',args:{values:[true]}}]])]]);s.client.views.set(60,view());const statuses=[],actions=[],h=new ServerHeldItems(s,manifest,{...set,status:(_,lit)=>statuses.push(lit),action:(_,action)=>actions.push(action)});assert.equal(h.items.get(60).lit,true);s.remote.set(30,{});h.frame();
 emit(s.client,'rpc',{viewId:60,name:'OnStatus',args:{values:[false]}});assert.deepEqual(statuses,[false]);manifest.weapons.m4.class='MeleeWeaponDataBlock';emit(s.client,'rpc',{viewId:60,name:'Action3',args:{values:[]}});emit(s.client,'rpc',{viewId:60,name:'Action1B',args:{values:[]}});assert.deepEqual(actions,['swing'],'malformed DoAction1 stream throws before EndSwing');
 const miss=new Uint8Array(14);emit(s.client,'rpc',{viewId:60,name:'Action1B',args:{values:[miss]}});assert.deepEqual(actions,['swing','hit']);
});
test('remote gun actions require the active remote representation and valid bytes; Mods survives loading',()=>{
 const {s,manifest,set}=fixture();manifest.weapons={m4:{class:'BulletWeaponDataBlock'}};s.actorCalls=new Map([[60,new Map([['Mods',{viewId:60,name:'Mods',args:{values:[new Uint8Array([1,123,0,0,0])]}}]])]]);
 const actions=[],h=new ServerHeldItems(s,manifest,{...set,items:{silencer:{data:{_uniqueID:123,modFlag:8}}},action:(h,t,e)=>actions.push({flags:h.modFlags,t,e})});h.create(view());assert.equal(h.items.get(60).modFlags,8);
 const data=new Uint8Array(13);data[0]=255;const rpc={viewId:60,name:'Action1B',args:{values:[data]}};emit(s.client,'rpc',rpc);assert.equal(actions.length,0);
 s.remote.set(30,{});h.frame();emit(s.client,'rpc',rpc);assert.equal(actions.length,1);assert.equal(actions[0].flags,8);assert.equal(actions[0].t,'gun');
 emit(s.client,'rpc',{...rpc,args:{values:[new Uint8Array()]}});assert.equal(actions.length,1);
 h.create(view(61));h.frame();emit(s.client,'rpc',rpc);assert.equal(actions.length,2,'ItemRepresentation.RunAction: a replaced representation still alive runs its own Action1');
});
