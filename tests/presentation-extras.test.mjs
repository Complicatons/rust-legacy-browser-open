import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {deploySoundFor,explosionEffectFor,explosionLightIntensity,explosionPitch,EXPLOSION_LIFETIME,EXPLOSION_LIGHT_FADE,quickLightFor,quickLightStep} from '../browser/presentation-extras.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const read=async p=>JSON.parse(await readFile(new URL('../browser/assets/recovered/'+p,import.meta.url)));
const extras=hasRecovered?(await read('presentation/manifest.json')):null,catalogue=hasRecovered?(await read('items/manifest.json')):null,deploy=hasRecovered?(await read('deployables/manifest.json')):null;
const items=hasRecovered?(catalogue.items):null,keyOf=name=>Object.keys(items).find(k=>items[k].data.m_Name===name);
const clipName=file=>Object.values(extras.sounds).find(s=>s.file===file)?.name;

test('HeldItemDataBlock.deploySound: 20 held items draw with a sound; guns use their own clip, tools the generic rustle',needsAssets,async()=>{
 assert.equal(Object.keys(extras.held).length,20);
 assert.equal(clipName(deploySoundFor(extras,keyOf('M4'))),'m4_deploy');
 assert.equal(clipName(deploySoundFor(extras,keyOf('Bolt Action Rifle'))),'boltrifle_draw');
 assert.equal(clipName(deploySoundFor(extras,keyOf('Hunting Bow'))),'bow_deploy');
 for(const n of ['Rock','Hatchet','Torch','Flare','F1 Grenade'])assert.equal(clipName(deploySoundFor(extras,keyOf(n))),'draw_generic_rustle',n);
 // The cab-datablock.000 Uber tools carry their own deploySound (the Uber Hatchet's is also its equippedSound).
 assert.equal(clipName(deploySoundFor(extras,keyOf('Uber Hunting Bow'))),'bow_deploy');
 assert.equal(clipName(deploySoundFor(extras,keyOf('Uber Hatchet'))),'Session 02 - Break 01');
 // Every held datablock with a deploySound pointer has an entry.
 for(const [k,v] of Object.entries(items))if(v.data.deploySound?.m_PathID)assert.ok(extras.held[k],v.data.m_Name);
 // Null in the data: deployables, structures, medkits.
 for(const n of ['Wood Wall','Camp Fire','Large Medkit'])assert.equal(deploySoundFor(extras,keyOf(n)),null,n);
 for(const h of Object.values(extras.held))await access(new URL('../browser/assets/recovered/presentation/'+h.deploySound,import.meta.url));
 assert.equal(deploySoundFor(null,keyOf('M4')),null,'no export');
});

test('ExplosionEffect: F1/C4 Explosion1 flash starts at initialLightIntensity 5 and is out after 0.25 s; pitch 0.9-1; 3 s life',needsAssets,()=>{
 const f1=Object.values(deploy.prefabs).find(p=>p.name==='F1GrenadeWorld').components.TimedGrenade[0].explosion;
 const c4=Object.values(deploy.prefabs).find(p=>p.name==='ExplosiveCharge').components.TimedExplosive[0].explosion;
 assert.equal(f1,c4);const e=explosionEffectFor(extras,f1);assert.equal(e.prefab,'Explosion1');
 assert.equal(e.initialLightIntensity,5);assert.equal(e.light.intensity,2,'the Light component itself says 2; Update overrides it');
 assert.equal(explosionLightIntensity(e,0),5);assert.equal(explosionLightIntensity(e,0.125),2.5);assert.equal(explosionLightIntensity(e,EXPLOSION_LIGHT_FADE),0);
 assert.equal(explosionLightIntensity(e,1),0);assert.equal(explosionLightIntensity(e,-1),5,'clamped to the initial value');
 assert.equal(explosionPitch(()=>0),0.9);assert.equal(explosionPitch(()=>1),1);assert.equal(EXPLOSION_LIFETIME,3);
 const signal=Object.values(deploy.prefabs).find(p=>p.name==='SupplySignalGrenade').components.SignalGrenade[0].explosion;
 assert.equal(explosionEffectFor(extras,signal),null,'the green smoke has no ExplosionEffect');
 // QuickLight (MetalImpact) is exported too, but is not an ExplosionEffect.
 const metal=Object.entries(extras.effects).find(([,v])=>v.prefab==='MetalImpact');assert.equal(explosionEffectFor(extras,metal[0]),null);assert.equal(metal[1].duration,Math.fround(0.1));
});

test('QuickLight: the MetalImpact spark light keeps intensity 5 while its range 1 shrinks by dt / 0.1, out after 0.1 s',needsAssets,()=>{
 const [key,q]=Object.entries(extras.effects).find(([,v])=>v.script==='QuickLight');assert.equal(q.prefab,'MetalImpact');assert.equal(quickLightFor(extras,key),q);
 const metal=Object.values(deploy.surfaces).find(s=>s.name==='metal');assert.deepEqual(metal.bulletEffects,[key],'the metal bullet impact is the QuickLight prefab');
 const L=deploy.prefabs[key].components.Light[0].data;assert.equal(L.m_Range,1);assert.equal(L.m_Intensity,5);
 const light={range:L.m_Range,intensity:L.m_Intensity,duration:q.duration};quickLightStep(light,0.05);assert.ok(Math.abs(light.range-0.5)<1e-6);assert.equal(light.intensity,5);
 quickLightStep(light,1/60);quickLightStep(light,1/60);assert.ok(light.range>0);for(let i=0;i<2;i++)quickLightStep(light,1/60);assert.deepEqual(light,{range:0,intensity:0,duration:q.duration});
 assert.equal(quickLightFor(extras,Object.keys(extras.effects).find(k=>extras.effects[k].prefab==='Explosion1')),null);assert.equal(quickLightFor(null,key),null);
});
