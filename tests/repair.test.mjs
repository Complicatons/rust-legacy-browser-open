import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
import {canRepair,completeRepair,SpikeWall,isDamaged,repairWindowState} from '../browser/repair.mjs';
import {DeployableSystem} from '../browser/deployables.mjs';
import {WorldRules} from '../browser/world-rules.mjs';
import {StructureSystem} from '../browser/structures.mjs';
import {needsAssets} from './helpers/assets.mjs';

const catalogue={items:{hatchet:{data:{isRepairable:1}},stone:{data:{isRepairable:0}},wood:{data:{}},metal:{data:{}}},
 blueprints:{bp:{result:'hatchet',amount:1,ingredients:[{item:'wood',amount:10},{item:'metal',amount:3}]}}};
const inv=counts=>({c:{...counts},count(k){return this.c[k]??0;},consume(k,n){if(this.count(k)<n)return false;this.c[k]-=n;return true;}});

test('repair bench charges a share of the recipe and lowers the maximum condition', ()=>{
 const slot={item:'hatchet',condition:0.5};
 assert.equal(canRepair(slot,catalogue,inv({wood:2,metal:1})),false); // needs ceil(10×0.25)=3 wood
 const bag=inv({wood:3,metal:1});
 assert.deepEqual(completeRepair(slot,catalogue,bag),{ok:true,message:'Repaired Item!'});
 assert.deepEqual(bag.c,{wood:1,metal:0}); // round(2.5)=2 (banker's), round(0.75)=1
 assert.ok(Math.abs(slot.maxCondition-0.85)<1e-12&&slot.condition===slot.maxCondition);
 assert.equal(isDamaged(slot),false);
 assert.equal(completeRepair(slot,catalogue,bag).message,'could not repair item');
 assert.equal(canRepair({item:'stone',condition:0.1},catalogue,inv({wood:99,metal:99})),false);
 assert.equal(canRepair({item:'hatchet',condition:100},catalogue,inv({})),false); // loadout items start full
});

test('spike walls tick once a second and reflect melee hits', ()=>{
 const s=new SpikeWall({dmgPerTick:15,returnFraction:0.1,baseReturnDmg:5});
 s.enter('a',10);
 assert.deepEqual(s.update(10).map(h=>[h.target,h.damage]),[['a',15]]);
 assert.equal(s.update(10.5).length,0);
 s.enter('b',10.7);
 assert.deepEqual(s.update(11).map(h=>h.target),['a','b']);
 s.exit('a');s.exit('b');assert.equal(s.update(20).length,0);
 assert.equal(s.reflect({amount:50,melee:true,distance:2}),10);
 assert.equal(s.reflect({amount:50,melee:true,distance:9}),0);
 assert.equal(s.reflect({amount:50,melee:false,distance:1}),0);
});

test('SpikeWall.OnHurt: melee-type hits (swings, arrows) from within 8 m come back to the attacker as melee damage',needsAssets, async ()=>{
 const items=JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))).items;
 const manifest=JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)));
 const dkey=n=>Object.keys(manifest.deployables).find(k=>manifest.deployables[k].item===n);
 const d=new DeployableSystem(manifest,items,{rng:()=>0.5}),rules=new WorldRules({structures:new StructureSystem(manifest,items,{zones:[]}),deployables:d});
 const place=(n,x)=>{const o=d.place(dkey(n),new Vector3(x,0,0),new Quaternion(),0);rules.onPlaced(o,'me',0);return o;};
 const small=place('Spike Wall',0),large=place('Large Spike Wall',20),box=place('Wood Storage Box',40);
 const attacker=(x)=>({character:true,position:new Vector3(x,0,0),taken:[],hurt(types,from){this.taken.push({types,from});}});
 // The small wall's ProtectionTakeDamage melee armour lowers the hit; the amount actually applied is what reflects (×0.1 + 5).
 const a=attacker(3),applied=small.hurt(75,2,a);assert.ok(applied>0&&applied<75,String(applied));
 assert.equal(a.taken.length,1);assert.deepEqual(a.taken[0].types.map((v,i)=>i===2?Math.round(v*1e6)/1e6:v),[0,0,Math.round((applied*0.1+5)*1e6)/1e6,0,0,0]);assert.equal(a.taken[0].from,small);
 // Arrows deal melee-type damage (combat.mjs arrowDamage) as a DamageTypeList.
 const b=attacker(12.1),arrow=large.hurt([0,0,75,0,0,0],undefined,b);assert.ok(Math.abs(b.taken[0].types[2]-(arrow*0.2+5))<1e-6);
 const far=attacker(28.1);large.hurt(50,2,far);assert.equal(far.taken.length,0,'more than 8 m away');
 const shot=attacker(1);small.hurt([0,40,0,0,0,0],undefined,shot);small.hurt(100,3,shot);assert.equal(shot.taken.length,0,'bullets and explosions are not reflected');
 const decay=attacker(0);small.hurt(5);assert.equal(decay.taken.length,0);
 const plain=attacker(40);box.hurt(50,2,plain);assert.equal(plain.taken.length,0,'only spike walls reflect');
});

test('RPOSRepairBenchWindow.UpdateGUIAmounts: labels, colours and when the Repair button shows', ()=>{
 const cat={...catalogue,items:{...catalogue.items,wood:{data:{m_Name:'Wood'}},metal:{data:{m_Name:'Metal Fragments'}}}};
 const empty=repairWindowState(null,cat,inv({}));assert.deepEqual([empty.button,empty.needs.enabled,empty.condition.enabled,empty.amounts.length],[false,false,false,0]);
 assert.equal(repairWindowState({item:'stone',condition:0.1},cat,inv({})).button,false,'not repairable: cleared');
 // condition 0.5 of 1: scalar 0.25 → ceil(2.5)=3 Wood, ceil(0.75)=1 Metal Fragments.
 const st=repairWindowState({item:'hatchet',condition:0.5},cat,inv({wood:3}));
 assert.deepEqual(st.amounts,[{text:'3 Wood',color:'green'},{text:'1 Metal Fragments',color:'red'}]);
 assert.deepEqual(st.condition,{enabled:true,text:'Condition : 50/100',color:'yellow'});assert.deepEqual(st.needs,{enabled:true,text:'Needs:',color:'white'});
 assert.equal(st.button,true,'shown (and clickable) even when the ingredients are missing');
 assert.deepEqual(repairWindowState({item:'hatchet',condition:0.555,maxCondition:0.8},cat,inv({})).condition,{enabled:true,text:'Condition : 56/80',color:'yellow'});
 assert.equal(repairWindowState({item:'hatchet',condition:0.7},cat,inv({})).condition.color,'green');
 assert.equal(repairWindowState({item:'hatchet',condition:0},cat,inv({})).condition.color,'red');
 const done=repairWindowState({item:'hatchet',condition:0.85,maxCondition:0.85},cat,inv({}));
 assert.deepEqual([done.button,done.amounts,done.needs,done.condition],[false,[],{enabled:true,text:'Does not need repairs',color:'green'},{enabled:true,text:'Condition : 85/85',color:'green'}]);
 // The NeedLabel text is never set back: a damaged item after an undamaged one keeps "Does not need repairs" (in white).
 assert.deepEqual(repairWindowState({item:'hatchet',condition:0.2},cat,inv({}),done.needs.text).needs,{enabled:true,text:'Does not need repairs',color:'white'});
});
