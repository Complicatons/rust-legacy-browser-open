import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Vector3} from 'three';
import {heldRepSource,heldRepSounds} from '../browser/unity-audio.mjs';
import {createHeldRig,heldLocalMatrix} from '../browser/held-rig.mjs';
import {present,hasRecovered,needsAssets} from './helpers/assets.mjs';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const manifest=hasRecovered?(read('../browser/assets/recovered/deployables/manifest.json')):null,items=hasRecovered?(read('../browser/assets/recovered/items/manifest.json').items):null;
const players=hasRecovered?(read('../browser/assets/recovered/players/manifest.json')):null,clips=hasRecovered?(read('../browser/assets/recovered/players/clips.json')):null,playerConfig=hasRecovered?(read('../browser/assets/recovered/player.json')):null;
const vm=hasRecovered?(read('../browser/assets/recovered/viewmodels/manifest.json')):null;
const itemKey=name=>Object.keys(items).find(k=>items[k].data.m_Name===name);
const uber=hasRecovered?(manifest.held[itemKey('Uber Hatchet')]):null;

test('uhatchet.irp: its AudioSource plays on awake, loops, Logarithmic 1..100 m at 0.577 (statically read)',needsAssets,()=>{
 assert.equal(uber.netName,'uhatchet.irp');
 const p=manifest.prefabs[uber.prefab],s=heldRepSource(p);
 assert.deepEqual({...s,volume:Math.round(s.volume*1000)/1000},{clip:p.components.AudioSource[0].clip,node:0,loop:true,volume:0.577,pitch:1,model:'inverse',min:1,max:100});
 assert.ok(present(new URL('../browser/assets/recovered/deployables/'+s.clip,import.meta.url)));
 // Every other shipped held representation is silent (none has an AudioSource).
 const others=new Set(Object.values(manifest.held).map(h=>h.prefab).filter(k=>k!==uber.prefab));assert.ok(others.size>=12);
 for(const k of others)assert.equal(heldRepSource(manifest.prefabs[k]),null,manifest.prefabs[k].name);
 // The Uber Hatchet's view model is the shared VM-Hatchet (_viewModelPrefab path id), which has no AudioSource: the hum in
 // first person comes from the holder's own hidden representation, not from the view model.
 const vmKey=Object.keys(vm.viewmodels).find(k=>vm.viewmodels[k].name==='VM-Hatchet');
 assert.equal(vmKey.split(':')[1],String(items[itemKey('Uber Hatchet')].data._viewModelPrefab.m_PathID));
});

test('held rep sources: a disabled, clipless or non-PlayOnAwake source never plays; one-shots keep loop false',()=>{
 const src=(enabled,clip,data)=>({components:{AudioSource:[{node:0,enabled,clip,data}]}});
 assert.equal(heldRepSource(src(false,'a.wav',{Loop:true})),null);assert.equal(heldRepSource(src(true,null,{Loop:true})),null);
 assert.equal(heldRepSource(src(true,'a.wav',{m_PlayOnAwake:false,Loop:true})),null);assert.equal(heldRepSource(null),null);
 assert.deepEqual(heldRepSource(src(true,'a.wav',{m_PlayOnAwake:true,rolloffMode:1,MinDistance:2,MaxDistance:9})),{clip:'a.wav',node:0,loop:false,volume:1,pitch:1,model:'linear',min:2,max:9});
});

test('which reps sound: attached remote reps and the holder own rep, once per rep, only with a playing source',needsAssets,()=>{
 const hatchet=manifest.held[itemKey('Hatchet')];
 const out=heldRepSounds(manifest.prefabs,{remote:[{rep:11,prefab:uber.prefab},{rep:12,prefab:hatchet.prefab},{rep:13,prefab:'missing'},{rep:11,prefab:uber.prefab}],own:{rep:20,prefab:uber.prefab}});
 assert.deepEqual([...out.keys()],[11,20]);assert.equal(out.get(11).local,false);assert.equal(out.get(20).local,true);assert.equal(out.get(20).source.loop,true);
 assert.equal(heldRepSounds(manifest.prefabs,{own:{rep:21,prefab:hatchet.prefab}}).size,0);assert.equal(heldRepSounds(manifest.prefabs).size,0);
 assert.equal(heldRepSounds(manifest.prefabs,{own:{rep:null,prefab:uber.prefab}}).size,0);
});

test('the holder hears the hum at full volume: the hidden hand socket stays within MinDistance (1 m) of the eyes',needsAssets,()=>{
 const p=manifest.prefabs[uber.prefab],eye=playerConfig.eyes.m_LocalPosition.y;
 assert.ok(heldLocalMatrix(players.player,p,uber));assert.equal(heldLocalMatrix(players.player,null,uber),null);
 const rig=createHeldRig(players.player,players.movement,clips,p,uber);assert.equal(rig.prefab,uber.prefab);
 for(const [pitch,yaw,feet] of [[0,0,[0,0,0]],[1.2,0.7,[10,5,-3]],[-1.2,-2,[-4,1,8]]]){let m;for(let i=0;i<8;i++)m=rig.update({feet,yaw,pitch},0.25,i*0.25);
  const at=new Vector3().setFromMatrixPosition(m),eyes=new Vector3(feet[0],feet[1]+eye,feet[2]);
  assert.ok(at.distanceTo(eyes)<1,`pitch ${pitch}: ${at.distanceTo(eyes)}`);
  // Right hand: on the player's right of the look direction (browser forward = (-sin yaw, 0, -cos yaw)).
  const right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw));assert.ok(at.clone().sub(eyes).dot(right)>0,`pitch ${pitch}`);}
});

test('main.mjs plays held rep sources from the rep root (remote) or the own-rep node and stops them with the rep',()=>{
 const src=readFileSync(new URL('../browser/main.mjs',import.meta.url),'utf8');
 assert.match(src,/heldRepSounds\(deployManifest\.prefabs,\{remote,own\}\)/);
 assert.match(src,/playLoop\(c\.clip,parent,c\.min,c\.max,c\.pitch,c\.volume,c\.model,c\.loop\)/);
 assert.match(src,/updateFireEffects\(dt\);updateHeldRepAudio\(dt\);/);
 assert.match(src,/h\.parent===online\.client\.characterView&&online\.client\.views\.has\(h\.rep\)/);
});
