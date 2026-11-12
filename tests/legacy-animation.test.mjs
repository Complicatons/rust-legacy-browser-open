import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {LegacyAnimation} from '../browser/legacy-animation.mjs';
import {playerLayers} from '../browser/player-layers.mjs';
import {PlayerSampler} from '../browser/player-sampler.mjs';
import {readFileSync} from 'node:fs';
import {STATE} from '../browser/net-client.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const bone=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}),rig=[bone(),bone(),bone()];
const clip=(bone,from,to,property='position')=>({length:1,tracks:[{bone,[property]:{times:[0,1],values:[...from,...to]}}]});

test('a higher layer affects only keyed bone properties and leaves the lower-body pose intact',()=>{
 const a=new LegacyAnimation(rig,{legs:clip(1,[0,0,0],[10,0,0]),upper:clip(2,[0,0,0],[0,8,0])});
 const pose=a.sample([{name:'legs',time:1,layer:3,weight:1},{name:'upper',time:1,layer:10,weight:1}],0);
 near(pose[1].position[0],10);near(pose[2].position[1],8);
 const faded=a.sample([{name:'legs',time:1,layer:3,weight:1},{name:'legs',time:0,layer:5,weight:0.25}],0);
 near(faded[1].position[0],7.5);
});

test('same-layer clips normalise together and a lone partial weight is normalised to full strength',()=>{
 const a=new LegacyAnimation(rig,{a:clip(1,[0,0,0],[10,0,0]),b:clip(1,[0,0,0],[20,0,0])});
 // Unity legacy: total claimed weight below one is normalised over the states that animate the property.
 let pose=a.sample([{name:'a',time:1,layer:3,weight:0.25}],0);near(pose[1].position[0],10);
 pose=a.sample([{name:'a',time:1,layer:3,weight:1},{name:'b',time:1,layer:3,weight:3}],0);near(pose[1].position[0],17.5);
});

test('additive position and scale use their first frame and never accumulate across frames',()=>{
 const a=new LegacyAnimation(rig,{move:clip(1,[2,0,0],[6,0,0]),scale:clip(1,[2,2,2],[4,2,2],'scale')});
 const plans=[{name:'move',time:1,layer:6,weight:0.5,additive:true},{name:'scale',time:1,layer:10,weight:0.5,additive:true}];
 const first=a.sample(plans,0.1);near(first[1].position[0],2);near(first[1].scale[0],1.5);
 for(let i=0;i<100;i++)assert.deepEqual(a.sample(plans,0.1),first);
});

test('additive quaternion layers compose in numeric order with finite normalised output',()=>{
 const qx=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2),qy=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);
 const a=new LegacyAnimation(rig,{x:clip(1,[0,0,0,1],qx.toArray(),'rotation'),y:clip(1,[0,0,0,1],qy.toArray(),'rotation')});
 const p=a.sample([{name:'y',time:1,layer:10,weight:1,additive:true},{name:'x',time:1,layer:6,weight:1,additive:true}],0);
 const expected=qx.clone().multiply(qy);near(new Quaternion().fromArray(p[1].rotation).angleTo(expected),0);
});

test('elapsed jump clips clamp, idle clocks loop independently and root tracks cannot move the server root',()=>{
 const a=new LegacyAnimation(rig,{jump:clip(1,[0,0,0],[10,0,0]),idle:clip(2,[0,0,0],[0,8,0]),root:clip(0,[0,0,0],[999,0,0])});
 const p=a.sample([{name:'jump',time:3,weight:1},{name:'idle',weight:1},{name:'root',time:1,weight:1}],1.25);
 near(p[1].position[0],10);near(p[2].position[1],2);assert.deepEqual(p[0],rig[0]);
 assert.deepEqual(a.sample([],0),rig);
});

test('native idle/movement conditional layers reproduce the intended half blend without global normalisation',()=>{
 const plans=playerLayers([{name:'idle',role:'idle',weight:0.5},{name:'walk',role:'north',weight:0.5}]);
 const idle=plans.find(p=>p.name==='idle'),walk=plans.find(p=>p.name==='walk');near(idle.weight,0.5);near(walk.weight,1);assert.ok(idle.layer>walk.layer);
 const a=new LegacyAnimation(rig,{idle:clip(1,[0,0,0],[0,0,0]),walk:clip(1,[0,0,0],[10,0,0])});
 near(a.sample(plans.map(p=>({...p,time:1})),0)[1].position[0],5);
});

test('native directional and jump role weights remain separate from additive role totals',()=>{
 const p=playerLayers([{name:'n',role:'north',weight:0.6},{name:'e',role:'east',weight:0.8},{name:'up',role:'up',weight:0.3,additive:true},{name:'hold',role:'upper',weight:0.0001,additive:true}],0.4);
 near(p.find(p=>p.name==='n').weight,1);near(p.find(p=>p.name==='e').weight,0.8/1.4);
 near(p.find(p=>p.name==='up').weight,0.4);near(p.find(p=>p.name==='hold').weight,1);
 // CreationContext.Solidify: aim 6/7 -> 1, upper body 10 -> 2 (below the 3..5 locomotion layers).
 assert.equal(p.find(p=>p.name==='up').layer,1);assert.equal(p.find(p=>p.name==='hold').layer,2);
 for(const roles of [['north'],['east'],['idle'],['north','east','idle','movingJump','idleJump']])assert.ok(playerLayers(roles.map(role=>({name:role,role,weight:0.2}))).every(p=>Number.isFinite(p.weight)));
});

const config=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url))).movement):null;
test('turning respects the original angular speed, one frame late, and standing still releases the cap',needsAssets,()=>{
 const s=new PlayerSampler(config);s.update({z:2,flags:STATE.movement},1,1);
 s.update({x:2,flags:STATE.movement},0.05,1.05);near(s.angle,0);
 s.update({x:2,flags:STATE.movement},0.05,1.1);near(s.angle,27);
 s.update({x:2,flags:STATE.movement},0.05,1.15);near(s.angle,54);
 // After standing still the first moving frame divides a zero previous velocity: atan2(0,0) = 0 without
 // smoothing (released cap), and the heading weights are reused; the next frame turns at the cap again.
 s.update({},1,2.15);s.update({x:-2,flags:STATE.movement},0.01,2.16);near(s.angle,0);near(s.heading.east,Math.sin(54*Math.PI/180));
 s.update({x:-2,flags:STATE.movement},0.01,2.17);near(s.angle,-5.4);
});

test('turn smoothing crosses the angle wrap by the short arc and a disabled cap snaps immediately',needsAssets,()=>{
 const s=new PlayerSampler(config);const at=angle=>({x:2*Math.sin(angle*Math.PI/180),z:2*Math.cos(angle*Math.PI/180),flags:STATE.movement});
 s.update(at(179),1,1);s.update(at(179),1,2);near(s.angle,179);s.update(at(-179),0.01,2.01);near(s.angle,179);s.update(at(-179),0.01,2.02);near(s.angle,-179);
 const c=structuredClone(config);c.maxTurnSpeed=0;const free=new PlayerSampler(c);free.update(at(0),1,1);free.update(at(90),0.01,1.01);free.update(at(90),0.01,1.02);near(free.angle,90);
});

test('an exact half-turn takes the native positive branch and repeated turns retain the cap',needsAssets,()=>{
 const s=new PlayerSampler(config);s.update({z:2,flags:STATE.movement},1,1);s.update({z:-2,flags:STATE.movement},0.01,1.01);s.update({z:-2,flags:STATE.movement},0.01,1.015);near(s.angle,5.4);
 for(let i=0;i<1000;i++){
  const previous=s.angle,target=i*7*Math.PI/180;s.update({x:2*Math.sin(target),z:2*Math.cos(target),flags:STATE.movement},0.01,1.02+i*0.01);
  const turn=(s.angle-previous)*Math.PI/180,change=Math.atan2(Math.sin(turn),Math.cos(turn))*180/Math.PI;assert.ok(Math.abs(change)<=5.400001);
 }
});

test('original rifle hold and pitch clips preserve all unkeyed lower-body transforms',needsAssets,()=>{
 const m=JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url))),clips=JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/clips.json',import.meta.url)));
 const animation=new LegacyAnimation(m.player.skeleton,clips),base=[{name:'walk_n_aim',layer:3,normalizedTime:0.3,weight:1}];
 const plain=animation.sample(base,0),armed=animation.sample([...base,{name:'aim_rifle_upper_up',layer:6,normalizedTime:0.7,weight:1,additive:true},{name:'aim_rifle_upper',layer:10,normalizedTime:1,weight:1,additive:true}],0);
 for(let i=0;i<m.player.skeleton.length;i++)if(/_(Pelvis|[LR]_(Hip|Knee|Foot|Toe))/.test(m.player.skeleton[i].name))assert.deepEqual(armed[i],plain[i],m.player.skeleton[i].name);
 const hand=m.player.skeleton.findIndex(b=>b.name==='RustPlayer_R_Hand');assert.notDeepEqual(armed[hand].rotation,plain[hand].rotation);
 const swing=animation.sample([...base,{name:'attack_hatchet',layer:11,normalizedTime:0.4,weight:1,additive:true}],0);assert.notDeepEqual(swing[hand].rotation,plain[hand].rotation);
 assert.ok(swing.flatMap(b=>Object.values(b).flat()).every(Number.isFinite));
});

test('negative float settings remain values rather than reference-inheritance sentinels',needsAssets,()=>{
 const c=structuredClone(config);c.groupMatrices[3].upperApplyDuration=-1;c.stateMatrices[9].applyDuration=-1;c.aimMatrices[2].offsetDegrees=-1;
 const s=new PlayerSampler(c),p=s.update({group:'rifle'},0.2,1),g=s.debug().groups.find(g=>g.name==='rifle');
 near(g.weight,0.2);near(g.states.find(s=>s.state==='stand').weight,0.2);
 near(p.find(p=>p.name==='aim_rifle_upper_up').normalizedTime,1/90);
});
