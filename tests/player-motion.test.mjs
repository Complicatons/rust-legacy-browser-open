import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {playerMotion,playerAim,samplePlayer,pushSnapshot} from '../browser/player-motion.mjs';
import {STATE} from '../browser/net-client.mjs';
import {createHash} from 'node:crypto';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const m=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url)))):null,config=hasRecovered?(m.movement):null;
test('original player export resolves every weighted bone and clip track with matching output hashes',needsAssets,()=>{
 const root=new URL('../browser/assets/recovered/players/',import.meta.url),p=m.player,c=JSON.parse(readFileSync(new URL(m.clipsFile,root)));
 assert.equal(p.skins.length,4);assert.equal(p.skeleton.length,64);assert.equal(p.clips.length,52);assert.equal(m.armor.censored,true);
 for(const [file,hash]of Object.entries(m.outputSHA256))assert.equal(createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex'),hash,file);
 for(const s of p.skins){assert.equal(s.bones.length,s.bindposes.length);assert.ok(s.bones.every(i=>i>=0&&i<p.skeleton.length));assert.ok(s.bindposes.flat().every(Number.isFinite));}
 for(const name of p.clips)for(const t of c[name].tracks){assert.ok(t.bone<p.skeleton.length);for(const k of ['rotation','position','scale'])if(t[k])assert.ok(t[k].times.concat(t[k].values).every(Number.isFinite));}
 for(const name of ['idle_stand','idle_crouch','walk_n','walk_e','walk_s','walk_w','sprint','jump_forward'])assert.ok(c[name]?.tracks.length,name);
});
test('original player locomotion blends directional clips with inherited crouch/run settings',needsAssets,()=>{
 assert.equal(playerMotion(config)[0].name,'idle_stand');assert.equal(playerMotion(config,{flags:STATE.crouch})[0].name,'idle_crouch');
 const p=playerMotion(config,{x:2,z:2,flags:STATE.movement});assert.deepEqual(p.map(a=>[a.name,a.weight]),[['walk_n',0.5],['walk_e',0.5]]);
 assert.equal(playerMotion(config,{z:1,flags:STATE.movement|STATE.crouch})[0].name,'crouchwalk_n');
 assert.equal(playerMotion(config,{z:5,flags:STATE.movement|STATE.sprint})[0].name,'sprint');
 assert.equal(playerMotion(config,{x:1,flags:STATE.movement|STATE.airborne})[0].name,'jump_forward');
 for(const a of playerMotion(config,{x:-1,flags:STATE.movement|STATE.crouch}))assert.ok(Number.isFinite(a.rate));
});
test('CharacterStateInterpolator.Sample: yaw wrap, holds outside the buffer, no extrapolation',()=>{
 const s=[{time:0,position:[0,0,0],yaw:Math.PI-0.1,flags:64},{time:0.2,position:[2,0,0],yaw:-Math.PI+0.1,flags:64}];
 const a=samplePlayer(s,0.1,{sendInterval:0.2});assert.deepEqual(a.position.map(v=>Math.round(v*1e9)/1e9),[1,0,0]);assert.deepEqual(a.velocity.map(v=>Math.round(v*1e6)/1e6),[10,0,0]);assert.ok(Math.abs(Math.abs(a.yaw)-Math.PI)<1e-8);
 assert.deepEqual(samplePlayer(s,2).velocity,[0,0,0]);assert.deepEqual(samplePlayer(s,2).position,[2,0,0]);assert.deepEqual(samplePlayer(s,-1).position,[0,0,0]);
});
test('CharacterStateInterpolator.Sample caps a long gap at allowableTimeSpan + sendInterval and merges state flags',()=>{
 const s=[{time:0,position:[0,0,0],yaw:0,flags:0},{time:2,position:[3,0,0],yaw:0,flags:0x41|0x10}];
 // cap 0.1 + 0.2: the older sample holds until 1.7, then the move takes 0.3 s.
 assert.deepEqual(samplePlayer(s,1.5,{sendInterval:0.2}).position,[0,0,0]);
 const m=samplePlayer(s,1.85,{sendInterval:0.2});assert.ok(Math.abs(m.position[0]-1.5)<1e-9);assert.deepEqual(m.velocity.map(v=>Math.round(v*1e6)/1e6),[10,0,0]);
 assert.equal(m.flags,0x41|0x10); // crouch + movement from the newer sample; airborne when grounded differs
});
test('CharacterInterpolatorBase.Push keeps samples sorted, replaces equal stamps and keeps the newest 32',()=>{
 const b=[];for(const t of [1,3,2,3])pushSnapshot(b,{time:t,id:t});assert.deepEqual(b.map(x=>x.time),[1,2,3]);
 for(let t=4;t<40;t++)pushSnapshot(b,{time:t});assert.equal(b.length,32);assert.equal(b[0].time,8);
 pushSnapshot(b,{time:0});assert.equal(b[0].time,8); // older than everything in a full buffer: dropped
});

test('armed movement resolves original state/group inheritance while additive aim samples pitch with native offsets',needsAssets,()=>{
 assert.equal(playerMotion(config,{group:'rifle'})[0].name,'idle_stand_compositing');
 assert.equal(playerMotion(config,{group:'rifle',flags:STATE.crouch})[0].name,'idle_crouch_compositing');
 assert.equal(playerMotion(config,{group:'rifle',z:2,flags:STATE.movement})[0].name,'walk_n_aim');
 assert.equal(playerMotion(config,{group:'rifle',z:5,flags:STATE.movement|STATE.sprint})[0].name,'sprint');
 const up=playerAim(config,{group:'rifle',pitch:Math.PI/3});assert.deepEqual(up.map(a=>a.name),['aim_rifle_upper','aim_rifle_upper_up']);assert.ok(Math.abs(up[1].normalizedTime-50/90)<1e-7);assert.ok(up.every(a=>a.additive));
 const down=playerAim(config,{group:'rifle',pitch:-Math.PI/6});assert.equal(down[1].name,'aim_rifle_upper_down');assert.ok(Math.abs(down[1].normalizedTime-40/70)<1e-7);
 assert.equal(playerAim(config,{group:'rock'})[0].name,'aim_rock_upper');assert.equal(playerAim(config,{group:'pickaxe'})[0].name,'aim_pickaxe_upper');
 assert.ok(playerAim(config,{group:'rifle',pitch:10})[1].normalizedTime<=1);
});
