import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TracerFlight} from '../browser/tracer-flight.mjs';
import {needsAssets} from './helpers/assets.mjs';
const data={speedPerSec:300,fadeDistStart:0.15,fadeDistLength:0.25},miss=()=>null;
test('tracer randomises width/length from root scale and starts with invisible width',()=>{
 const t=new TracerFlight([0,0,0],[0,0,1],data,{rootScale:[2,3,4],random:()=>0.5});
 assert.deepEqual(t.targetScale,[1.75,2.625,3]);assert.deepEqual(t.scale,[0,0,3]);
 t.update(0.01,miss,[0,0,0]);assert.deepEqual(t.position,[0,0,3]);assert.deepEqual(t.scale,[0,0,3]);
 t.update(0.01,miss,[0,0,0]);assert.deepEqual(t.scale,t.targetScale);
});
test('tracer fade uses the previous travelled distance and recursive Lerp rather than elapsed time',()=>{
 const t=new TracerFlight([0,0,0],[1,0,0],{...data,speedPerSec:1},{random:()=>1});
 t.update(0.2,miss,[0,0,0]);assert.equal(t.scale[0],0);
 t.update(0.1,miss,[0,0,0]);assert.ok(Math.abs(t.scale[0]-0.2)<1e-8);
 t.update(0.1,miss,[0,0,0]);assert.ok(Math.abs(t.scale[0]-0.68)<1e-8);
});
test('tracer raycasts each travelled segment and expires strictly beyond the configured range',()=>{
 const t=new TracerFlight([0,0,0],[0,0,1],data,{range:6}),segments=[];
 const raycast=(p,d,n)=>{segments.push([p.slice(),d.slice(),n]);return null;};
 t.update(0.01,raycast,[0,0,0]);t.update(0.01,raycast,[0,0,0]);assert.equal(t.dead,false);
 t.update(0.01,raycast,[0,0,0]);assert.equal(t.dead,true);assert.equal(t.distance,9);
 assert.deepEqual(segments.map(s=>[s[0][2],s[2]]),[[0,3],[3,3],[6,3]]);
});
test('silencers hide the mesh without disabling cosmetic collisions',()=>{
 const t=new TracerFlight([0,0,0],[0,0,1],data,{silenced:true});let calls=0;
 t.update(0.01,()=>{calls++;return null;},[0,0,0]);const event=t.update(0.01,()=>{calls++;return {layer:0};},[0,0,0]);
 assert.equal(calls,2);assert.equal(t.scale[0],0);assert.equal(t.dead,true);assert.equal(event.genericDecal,true);
});
test('near impact cut-off uses pre-collision tracer position, and character layers suppress generic decals',()=>{
 for(const layer of [0,17,18,27,21]){
  const t=new TracerFlight([75,0,0],[1,0,0],data),event=t.update(0.01,()=>({layer}),[0,0,0]);
  assert.equal(event.near,true);assert.equal(event.genericDecal,layer===0);assert.equal(t.distance,0);
 }
 const far=new TracerFlight([75.01,0,0],[1,0,0],data).update(0.01,()=>({layer:0}),[0,0,0]);assert.equal(far.near,false);assert.equal(far.genericDecal,false);
});
test('destroyed tracers cannot produce repeated impacts',()=>{
 const t=new TracerFlight([0,0,0],[1,0,0],data);let calls=0;
 t.update(0.01,()=>{calls++;return {layer:0};},[0,0,0]);assert.equal(t.update(1,()=>{calls++;return {};},[0,0,0]),null);assert.equal(calls,1);
});
test('original weapon tracer, default surface, decal and impact sounds resolve in the static export',needsAssets,()=>{
 const m=JSON.parse(readFileSync(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url))),surface=m.surfaces[m.defaultSurface];assert.equal(surface.name,'default');
 for(const w of Object.values(m.weapons))if(w.prefabs.tracerPrefab){const p=m.prefabs[w.prefabs.tracerPrefab],t=p.components.Tracer[0];
  assert.equal(t.data.speedPerSec,300);assert.ok(p.renderers.length);assert.ok(m.prefabs[t.effects.decalPrefab].renderers.length);assert.equal(t.sounds.impactSounds.length,5);
  for(const file of t.sounds.impactSounds)assert.ok(Object.values(m.sounds).some(s=>s.file===file));
 }
 for(const s of Object.values(m.surfaces))for(const key of s.bulletEffects)assert.ok(m.prefabs[key]?.components.ParticleSystem?.length);
});
