import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PANNING_MODEL,applyPanning,soundPoolAudible,sourceDistanceModel,sourcePlaysOnInstantiate} from '../browser/unity-audio.mjs';
import {meleeImpact,MELEE_TREE_EFFECT_LIFE,MELEE_SURFACE_EFFECT_LIFE} from '../browser/melee-effects.mjs';
import {modSoundNode} from '../browser/weapon-mod-effects.mjs';
import {createSurfaceResolver} from '../browser/surface-routing.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const root=new URL('../browser/assets/recovered/deployables/',import.meta.url),manifest=hasRecovered?(JSON.parse(readFileSync(new URL('manifest.json',root)))):null;
const items=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))).items):null;
const mods=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/item-mods/manifest.json',import.meta.url)))):null;
const itemKey=name=>Object.keys(items).find(k=>items[k].data.m_Name===name);
const prefabNamed=name=>Object.values(manifest.prefabs).find(p=>p.name===name);
const source=name=>prefabNamed(name).components.AudioSource[0];

test('Unity 4 rolloff and SoundPool cull: Logarithmic is inverse and culled only beyond 2 x max; Linear beyond max',()=>{
 assert.equal(sourceDistanceModel(0),'inverse');assert.equal(sourceDistanceModel(1),'linear');
 // LampModRep/LaserModRep.PlaySound: Logarithmic 1..4 m is still audible (at 0.25) from 4 to 8 m.
 assert.equal(soundPoolAudible('inverse',7.9,4),true);assert.equal(soundPoolAudible('inverse',8.1,4),false);
 assert.equal(soundPoolAudible('linear',20,20),true);assert.equal(soundPoolAudible('linear',20.1,20),false);
 // Unity 4 pans in stereo (SoundPool panLevel 1, spread 0): no HRTF.
 assert.equal(PANNING_MODEL,'equalpower');const audio={panner:{panningModel:'HRTF'}};assert.equal(applyPanning(audio).panner.panningModel,'equalpower');
});

test('effect prefab AudioSources: Explosion1 scripted logarithmic 20..200, signal smoke loops, WoodPile_Death silent, FlareLight3p linear',needsAssets,()=>{
 const boom=source('Explosion1');assert.deepEqual([boom.data.rolloffMode,boom.data.MinDistance,boom.data.MaxDistance,boom.data.m_PlayOnAwake],[0,20,200,false]);
 // ExplosionEffect.Start calls audio.Play() itself.
 assert.equal(sourcePlaysOnInstantiate(boom),false);assert.equal(sourcePlaysOnInstantiate(boom,{scripted:true}),true);
 const smoke=source('SignalSmokeGreen');assert.deepEqual([smoke.data.rolloffMode,smoke.data.MinDistance,smoke.data.MaxDistance,smoke.data.Loop,smoke.data.m_PlayOnAwake],[0,1,30,true,true]);
 assert.equal(sourcePlaysOnInstantiate(smoke),true);
 const woodPile=source('WoodPile_Death');assert.equal(woodPile.enabled,false);assert.equal(sourcePlaysOnInstantiate(woodPile),false);assert.equal(sourcePlaysOnInstantiate(woodPile,{scripted:true}),false);
 assert.equal(sourcePlaysOnInstantiate(source('Ore_Death')),true);
 assert.equal(manifest.prefabs[manifest.resourceEffects[';res_woodpile']].name,'WoodPile_Death');
 const flare=source('FlareLight3p');assert.deepEqual([sourceDistanceModel(flare.data.rolloffMode),flare.data.MinDistance,flare.data.MaxDistance,flare.data.m_Volume],['linear',3,20,0.5]);
 // Older exports without m_PlayOnAwake keep playing; a missing clip never does.
 assert.equal(sourcePlaysOnInstantiate({clip:'x.ogg',enabled:true,data:{}}),true);assert.equal(sourcePlaysOnInstantiate({clip:null,enabled:true,data:{m_PlayOnAwake:true}}),false);
});

test('melee impact effects: trees spawn impactEffectWood (WoodImpact) for 1.5 s, other surfaces their melee effect for 1 s',needsAssets,()=>{
 const t=manifest.surfaceRoutes.terrain,surfaceFor=createSurfaceResolver(manifest,new Uint8Array(readFileSync(new URL(t.file,root))));
 for(const name of ['Rock','Hatchet','Stone Hatchet','Pick Axe','Uber Hatchet']){const w=manifest.weapons[itemKey(name)];assert.ok(w,name);
  const wood=manifest.prefabs[w.prefabs.impactEffectWood];assert.equal(wood?.name,'WoodImpact',name);assert.ok(wood.components.ParticleSystem.length,name);
  assert.ok(wood.components.EffectSoundPlayer[0].sounds.length,name);}
 const w=manifest.weapons[itemKey('Hatchet')];
 const tree=meleeImpact({tree:true,point:[0,0,0]},{sounds:w.sounds,prefabs:w.prefabs,surfaceFor,manifest});
 assert.equal(tree.effect,w.prefabs.impactEffectWood);assert.equal(tree.life,MELEE_TREE_EFFECT_LIFE);assert.equal(MELEE_TREE_EFFECT_LIFE,1.5);assert.equal(tree.sound.file,w.sounds.impactSoundWood);
 assert.equal(meleeImpact({tree:true,point:[0,0,0]},{sounds:w.sounds,surfaceFor,manifest}).effect,null);
 const wall=meleeImpact({point:[0,0,0],body:{surfaceName:'WoodWall'}},{sounds:w.sounds,prefabs:w.prefabs,surfaceFor,manifest});
 assert.equal(manifest.prefabs[wall.effect].name,'WoodImpactMelee');assert.equal(wall.life,MELEE_SURFACE_EFFECT_LIFE);assert.equal(MELEE_SURFACE_EFFECT_LIFE,1);
});

test('held representations include the cab-datablock.000 Uber Hatchet and Uber Hunting Bow',needsAssets,()=>{
 const held=Object.values(manifest.held);assert.equal(held.length,55);
 const hatchet=manifest.held[itemKey('Uber Hatchet')],bow=manifest.held[itemKey('Uber Hunting Bow')];
 assert.deepEqual([hatchet.netName,hatchet.animationGroup,hatchet.uid],['uhatchet.irp','hatchet',items[itemKey('Uber Hatchet')].data._uniqueID]);
 assert.deepEqual([bow.netName,bow.animationGroup,bow.uid],['huntingbow.irp','rifle',items[itemKey('Uber Hunting Bow')].data._uniqueID]);
 for(const h of [hatchet,bow])assert.ok(manifest.prefabs[h.prefab]?.renderers?.length,h.item);
 // ServerHeldItems resolves representations by datablock uniqueID, so the shared huntingbow.irp keeps both groups apart.
 assert.notEqual(manifest.held[itemKey('Hunting Bow')].uid,bow.uid);assert.equal(manifest.held[itemKey('Hunting Bow')].animationGroup,'pistol');
 assert.equal(manifest.prefabs[manifest.weapons[itemKey('Uber Hunting Bow')].prefabs.arrowPrefab].name,'UberWorldArrow');
});

test('mod on/off clicks attach to the lamp light or the laser beam node',needsAssets,()=>{
 const byName=name=>Object.values(mods.prefabs).find(p=>p.name===name);
 assert.equal(modSoundNode(byName('VM-MOD-Flashlight15')),byName('VM-MOD-Flashlight15').lights[0].node);
 assert.equal(modSoundNode(byName('VM-MOD-LasersightR_3rd')),byName('VM-MOD-LasersightR_3rd').lasers[0].node);
 assert.equal(modSoundNode(byName('VM-MOD-Silencer')),null);assert.equal(modSoundNode(null),null);
});

test('main.mjs world sounds: every PositionalAudio is equal-power panned; prefab sources are never SoundPool-culled',()=>{
 const src=readFileSync(new URL('../browser/main.mjs',import.meta.url),'utf8');
 const made=src.match(/new THREE\.PositionalAudio\(/g).length,panned=src.match(/applyPanning\(new THREE\.PositionalAudio\(/g).length;assert.equal(panned,made);
 assert.match(src,/sourcePlaysOnInstantiate\(src,\{scripted:Boolean\(ee\)\}\)/);assert.match(src,/\{pool:false,loop,life\}/);
 assert.match(src,/fireSound_Far;playFile\([^;]*\{parent:root\}\)/);
});
