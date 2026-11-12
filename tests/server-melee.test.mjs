import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,Matrix4,Ray} from 'three';
import {ServerMelee,MeleeState,serverMeleeCast} from '../browser/server-combat.mjs';
import {CollisionWorld,MovingBody} from '../browser/collision.mjs';
import {PlayerHitBox} from '../browser/player-hitboxes.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const cat=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null,key=hasRecovered?(Object.keys(cat.items).find(k=>cat.items[k].data.m_Name==='Hatchet')):null,tool=hasRecovered?(cat.items[key].data):null;
test('melee queues separate swing, sound and mid-swing events and preserves cooldown across inventory updates',needsAssets,()=>{
 const melee=new ServerMelee(),slot={item:key,uses:1,condition:1},inv={slots:Array(40).fill(null),activeSlot:30,activeRep:61};inv.slots[30]=slot;
 let w=melee.held(inv,cat,{},0);assert.deepEqual(w.state.frame(0,{attack:true}),[]);const t=tool.deployLength+0.01;
 assert.deepEqual(w.state.frame(t,{attack:true}),[{type:'swing'}]);assert.deepEqual(w.state.frame(t+tool.swingSoundDelay+0.001,{}),[{type:'sound'}]);
 const state=w.state;inv.slots[30]={...slot};w=melee.held(inv,cat,{},t+0.2);assert.equal(w.state,state);assert.deepEqual(w.state.frame(t+tool.midSwingDelay+0.001,{}),[{type:'hit'}]);assert.deepEqual(w.state.frame(t+tool.midSwingDelay+0.01,{}),[]);
 assert.equal(slot.uses,1);assert.equal(slot.condition,1);assert.deepEqual(w.state.frame(t+tool.fireRate-0.001,{attack:true}),[]);
 assert.deepEqual(w.state.frame(t+tool.fireRate+0.001,{attack:true}),[{type:'swing'}]);inv.activeRep=null;assert.equal(melee.held(inv,cat,{},t+1),null);inv.activeRep=62;assert.equal(melee.held(inv,cat,{},t+2).state.hitAt,null,'holster discards pending hit');
});
test('native sprint lockout, starvation, secondary cooldown and broken tools do not invent repair requests',needsAssets,()=>{
 const state=new MeleeState(tool);state.activate(0);state.frame(1,{sprinting:true,attack:true});assert.deepEqual(state.frame(1.01,{attack:true}),[]);assert.deepEqual(state.frame(1.32,{attack:true,starving:true}),[{type:'swing'}]);assert.equal(state.nextPrimaryAttackTime,1.32+tool.fireRate*2);
 const secondary=new MeleeState(tool);secondary.activate(0);assert.deepEqual(secondary.frame(1,{attack2:true}),[]);assert.equal(secondary.hitAt,null);assert.equal(secondary.nextPrimaryAttackTime,1+tool.fireRate);
 const melee=new ServerMelee(),inv={slots:[{item:key,uses:1,condition:0}],activeSlot:0,activeRep:1};assert.equal(melee.held(inv,cat,{},1),null);
});
test('melee reports world impact points, native targets, misses and client tree budgets without local rewards',()=>{
 const melee=new ServerMelee({rng:()=>0}),client={views:new Map([[40,{group:7}]])},ray=new Ray(new Vector3(10,20,30),new Vector3(0,0,-1)),point=new Vector3(10,20,29);
 const prop=melee.record({body:{online:{carrier:40,innerID:2}},point},ray,1.5,client,1,tool);assert.deepEqual(prop,{target:{p1:7,p2:2},point:[10,20,29],flag:false});
 const actor=melee.record({body:{onlineActor:{viewId:30},bodyPart:9},point},ray,1.5,client,1,tool);assert.deepEqual(actor.target,{p1:0,viewId:30});assert.deepEqual(actor.point,[10,20,29]);assert.equal('bodyPart' in actor,false);
 assert.deepEqual(melee.record(null,ray,1.5,client,1,tool),{point:[10,20,28.5],flag:false});
 const tree={body:{isTree:true},point},notices=[],highEfficiency={efficiencies:[0,0,10]};assert.equal(melee.record(tree,ray,1.5,client,1,highEfficiency).flag,true);assert.equal(melee.record(tree,ray,1.5,client,2,highEfficiency,m=>notices.push(m)).flag,false);assert.deepEqual(notices,["There's no wood left here"]);assert.equal(melee.record(tree,ray,1.5,client,302,highEfficiency).flag,true);
});
test('analytic player ray hits work without a solid sweep and closer solids block them',()=>{
 const world=new CollisionWorld(),shape={kind:1,bodyPart:9,bone:0,inversion:0,origin:{x:0,y:0,z:0},directionOrSize:{x:0,y:1,z:0},length:0,radius:0.2},body=world.addBody(new PlayerHitBox(shape,30));body.setMotion(new Matrix4().makeTranslation(0,1,-1.2));const ray=new Ray(new Vector3(0,1,0),new Vector3(0,0,-1));
 assert.equal(serverMeleeCast(world,ray,1.5).body,body);assert.equal(serverMeleeCast(world,ray,0.8),null);
 const wall=world.addBody(new MovingBody('wall'));wall.addBox([1,2,0.1],[0,0,0]);wall.setMotion(new Matrix4().makeTranslation(0,1,-0.7));assert.equal(serverMeleeCast(world,ray,1.5).body,wall);
 wall.layer=26;assert.equal(serverMeleeCast(world,ray,1.5).body,body);
});
