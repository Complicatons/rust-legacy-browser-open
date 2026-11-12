import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Quaternion,Vector3} from 'three';
import {LegacyAnimation,quaternionAverage,weightedDelta} from '../browser/legacy-animation.mjs';
import {PlayerSampler,groupEventClip,moveTowardsAngle} from '../browser/player-sampler.mjs';
import {STATE} from '../browser/net-client.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const bone=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}),rig=[bone(),bone(),bone()];
const clip=(bone,from,to,property='position')=>({length:1,tracks:[{bone,[property]:{times:[0,1],values:[...from,...to]}}]});
const axis=(x,y,z,deg)=>new Quaternion().setFromAxisAngle(new Vector3(x,y,z).normalize(),deg*Math.PI/180).toArray();
const manifest=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url)))):null,config=hasRecovered?(manifest.movement):null;
const clips=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/clips.json',import.meta.url)))):null;

test('weighted rotations are a normalised quaternion sum, independent of sample order and quaternion sign',()=>{
 const a=axis(1,0,0,80),b=axis(0,1,0,-60),c=axis(1,1,0,30),entries=[[{value:a},0.5],[{value:b},0.3],[{value:c},0.2]];
 const expected=new Quaternion(...a.map((x,i)=>x*0.5+b[i]*0.3+c[i]*0.2)).normalize();
 for(const order of [[0,1,2],[2,1,0],[1,2,0]]){const q=new Quaternion(...quaternionAverage(order.map(i=>entries[i])));near(Math.abs(q.dot(expected)),1);}
 // -q is the same rotation: the hemisphere of the first sample decides the sum.
 const flipped=quaternionAverage([[{value:a},0.5],[{value:b.map(x=>-x)},0.5]]),plain=quaternionAverage([[{value:a},0.5],[{value:b},0.5]]);
 near(Math.abs(new Quaternion(...flipped).dot(new Quaternion(...plain))),1);
 // It differs from chained slerp at unequal weights (the earlier approximation).
 const slerp=new Quaternion(...a).slerp(new Quaternion(...b),0.3/0.8).slerp(new Quaternion(...c),0.2);assert.ok(Math.abs(slerp.dot(expected))<1-1e-6);
 const pose=new LegacyAnimation(rig,{a:clip(1,[0,0,0,1],a,'rotation'),b:clip(1,[0,0,0,1],b,'rotation')}).sample([{name:'a',time:1,layer:3,weight:0.7},{name:'b',time:1,layer:3,weight:0.3}],0);
 near(Math.abs(new Quaternion(...pose[1].rotation).dot(new Quaternion(...a.map((x,i)=>x*0.7+b[i]*0.3)).normalize())),1);
});

test('blend layers claim weight from the highest layer down; additive states claim none',()=>{
 const a=new LegacyAnimation(rig,{low:clip(1,[0,0,0],[10,0,0]),mid:clip(1,[0,0,0],[20,0,0]),high:clip(1,[0,0,0],[40,0,0]),add:clip(1,[0,0,0],[0,3,0])});
 // Over-full top layer (1.5) is scaled to the whole budget; nothing reaches the lower layer.
 near(a.sample([{name:'high',time:1,layer:5,weight:1.5},{name:'low',time:1,layer:3,weight:1}],0)[1].position[0],40);
 // 0.25 + 0.5 claimed above, 0.25 left for layer 3.
 near(a.sample([{name:'high',time:1,layer:5,weight:0.25},{name:'mid',time:1,layer:4,weight:0.5},{name:'low',time:1,layer:3,weight:1}],0)[1].position[0],0.25*40+0.5*20+0.25*10);
 // Additive on layer 1 under full-weight locomotion still adds its whole delta.
 const p=a.sample([{name:'low',time:1,layer:5,weight:1},{name:'add',time:1,layer:1,weight:1,additive:true}],0);near(p[1].position[0],10);near(p[1].position[1],3);
});

test('additive rotation deltas blend from identity by weight and compose after the blended pose',()=>{
 const reference=axis(0,0,1,10),value=axis(0,0,1,50),d=new Quaternion(...weightedDelta(reference,value,0.5));
 near(2*Math.acos(Math.min(1,Math.abs(d.w)))*180/Math.PI,20,1e-4);
 const a=new LegacyAnimation(rig,{base:clip(1,[0,0,0,1],axis(1,0,0,90),'rotation'),swing:clip(1,reference,value,'rotation')});
 const pose=a.sample([{name:'base',time:1,layer:4,weight:1},{name:'swing',time:1,layer:1,weight:1,additive:true}],0);
 const expected=new Quaternion(...axis(1,0,0,90)).multiply(new Quaternion(...axis(0,0,1,40)));near(Math.abs(new Quaternion(...pose[1].rotation).dot(expected)),1);
});

test('original attack clips on native layer 1 survive full-weight locomotion on layers 3..5',needsAssets,()=>{
 const animation=new LegacyAnimation(manifest.player.skeleton,clips),hand=manifest.player.skeleton.findIndex(b=>b.name==='RustPlayer_R_Hand');
 const base=[{name:'idle_stand',layer:5,weight:1}],plain=animation.sample(base,0);
 for(const name of ['attack_hatchet','attack_rock','attack_pickaxe']){const swing=animation.sample([...base,{name,layer:1,weight:1,additive:true,time:0.4}],0);
  assert.notDeepEqual(swing[hand].rotation,plain[hand].rotation,name);assert.ok(swing.flatMap(b=>Object.values(b).flat()).every(Number.isFinite));}
});

test('shipped group events: melee groups attack, no group reloads or readies, fall resolves but is unused',needsAssets,()=>{
 const table=Object.fromEntries(config.groupMatrices.map(g=>[g.name,['attack','reload','readyAttack'].map(e=>groupEventClip(config,g.name,e))]));
 assert.deepEqual(table,{noitem:[null,null,null],hatchet:['attack_hatchet',null,null],pistol:[null,null,null],rifle:[null,null,null],rock:['attack_rock',null,null],pickaxe:['attack_pickaxe',null,null],deploy:['attack_hatchet',null,null]});
 assert.throws(()=>groupEventClip(config,'hatchet','fall'));
 const s=new PlayerSampler(config);s.update({group:'rifle'},0.1,0);assert.equal(s.debug().fall,'idle_rifle_lowered');
 s.update({group:'deploy'},0.1,0.1);assert.equal(s.debug().fall,'idle_pistol');
 const c=structuredClone(config);for(const g of c.groupMatrices)g.fall=-2;const fallback=new PlayerSampler(c);fallback.update({},0.1,0);assert.equal(fallback.debug().fall,'idle_stand');
});

test('GetGroupEvent reads the group of the last non-slipping update, not a newly requested override',needsAssets,()=>{
 const s=new PlayerSampler(config);s.update({group:'pistol'},0.1,0);assert.equal(s.groupEvent('attack'),null);
 s.update({group:'hatchet'},0.1,0.1);assert.equal(s.groupEvent('attack'),'attack_hatchet');
 s.update({group:'rock',flags:STATE.slipping},0.1,0.2);assert.equal(s.groupEvent('attack'),'attack_hatchet');
 s.update({group:'rock'},0.1,0.3);assert.equal(s.groupEvent('attack'),'attack_rock');
});

test('Precise.MoveTowardsAngle reports clamping, unwrapped results and the exact half-turn branch',()=>{
 assert.deepEqual(moveTowardsAngle(0,90,27),[27,true]);assert.deepEqual(moveTowardsAngle(0,20,27),[20,false]);
 assert.deepEqual(moveTowardsAngle(170,-170,5),[175,true]);assert.deepEqual(moveTowardsAngle(-170,170,5),[-175,true]);
 assert.deepEqual(moveTowardsAngle(0,180,5),[5,true]);assert.deepEqual(moveTowardsAngle(0,-180,5),[5,true]);assert.deepEqual(moveTowardsAngle(179,-179,5),[-179,false]);
});
