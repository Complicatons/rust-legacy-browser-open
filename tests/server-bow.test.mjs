import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Matrix4} from 'three';
import {ServerBow,serverBowImpact} from '../browser/server-combat.mjs';
import {GatewayClient} from '../browser/net-client.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const cat=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null,key=hasRecovered?(Object.keys(cat.items).find(k=>cat.items[k].data.m_Name==='Hunting Bow')):null,d=hasRecovered?(cat.items[key].data):null;
test('online bow draws/releases with predicted arrow reservations and server-only inventory writes',needsAssets,()=>{
 const bow=new ServerBow(),slot={item:key,uses:1,condition:1},inv={slots:[slot],activeSlot:0,activeRep:62,revision:1,count:()=>3};let w=bow.held(inv,cat,()=> 'arrow',{},0),state=w.state,t=d.deployLength+0.01;
 assert.equal(state.frame(0,{attack:true},w.inventory).events.length,0);assert.equal(state.frame(t,{attack:true},w.inventory).events[0].type,'draw');
 inv.revision++;inv.slots[0]={...slot};w=bow.held(inv,cat,()=> 'arrow',{},t+1);assert.equal(w.state,state,'GNUP cannot restart the draw');
 state.frame(t+d.drawLength+0.01,{attack:true},w.inventory);assert.equal(state.frame(t+d.drawLength+0.02,{attack:false},w.inventory).events[0].type,'fire');assert.equal(inv.count('arrow'),3);assert.equal(w.inventory.count('arrow'),2);assert.equal(slot.condition,1);
 inv.revision++;bow.held(inv,cat,()=> 'arrow',{},t+3);assert.equal(w.inventory.count('arrow'),3,'a new server snapshot reconciles reservations');
});
test('partial draw cancellation and holster do not spend authoritative arrows or retain drawn state',needsAssets,()=>{
 const bow=new ServerBow(),inv={slots:[{item:key,uses:1,condition:1}],activeSlot:0,activeRep:62,revision:1,count:()=>2};const w=bow.held(inv,cat,()=> 'arrow',{},0),t=d.deployLength+0.01;w.state.frame(t,{attack:true},w.inventory);
 assert.equal(w.state.frame(t+0.05,{attack:false},w.inventory).events[0].type,'cancel');assert.equal(w.reserved,0);inv.activeRep=null;assert.equal(bow.held(inv,cat,()=> 'arrow',{},t+1),null);assert.equal(w.state.drawing,false);
 inv.activeRep=63;assert.notEqual(bow.held(inv,cat,()=> 'arrow',{},t+2).state,w.state);
});
test('bow impacts report native damage targets at root positions; static impacts have no fallback miss',()=>{
 const client={views:new Map([[40,{group:7}]])},root=new Matrix4().makeTranslation(10,20,30),bone=new Matrix4().makeTranslation(10,21.5,30),player={onlineActor:{viewId:30,root},motion:bone};
 assert.deepEqual(serverBowImpact(player,client),{target:{p1:0,viewId:30},position:[10,20,30]});
 assert.deepEqual(serverBowImpact({online:{carrier:40,innerID:1},onlineDamage:true,onlineRoot:root,motion:bone},client),{target:{p1:7,p2:1},position:[10,20,30]});
 assert.equal(serverBowImpact({online:{carrier:40,innerID:2},motion:root},client),null);assert.equal(serverBowImpact(null,client),null);
 let sent;const gateway=Object.create(GatewayClient.prototype);gateway.send=m=>sent=m;gateway.item(62,'bow-hit',serverBowImpact(player,client));assert.deepEqual(sent.data.position,[10,20,-30]);
});
