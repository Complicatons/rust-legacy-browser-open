import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Scene,PerspectiveCamera,Matrix4,Mesh} from 'three';import {MuzzleFlashes} from '../browser/muzzle-flash.mjs';import {ParticleEffect} from '../browser/particles.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const manifest=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const weapon=hasRecovered?(Object.values(manifest.weapons).find(w=>w.item==='M4')):null,prefab=hasRecovered?(manifest.prefabs[weapon.prefabs.muzzleflashVM]):null;
test('static weapon flashes retain both original particle systems and native .1 second light',needsAssets,()=>{
 for(const w of Object.values(manifest.weapons).filter(w=>['BulletWeaponDataBlock','ShotgunDataBlock'].includes(w.class))){for(const field of ['muzzleflashVM','muzzleFlashWorld']){
  const p=manifest.prefabs[w.prefabs[field]];assert.ok(p,w.item+field);assert.ok(p.components.MuzzleFlash.length);assert.equal(p.components.Light[0].data.m_Intensity,3);assert.ok(p.components.ParticleSystem.length>=2);
 }}
 assert.equal(prefab.components.ParticleSystem.find(p=>prefab.nodes[p.node].name==='BarrelSmoke').data.moveWithTransform,false);
});
test('flash lifetime and light fading follow source timing; holster/remove disposes resources',needsAssets,()=>{
 const scene=new Scene(),view=new Scene(),camera=new PerspectiveCamera();camera.updateMatrixWorld();let disposed=0,alive=true;
 const system=new MuzzleFlashes(manifest,scene,()=>[{mesh:new Mesh(),particles:[],update(){},dispose(){disposed++;}}]);
 const matrix=()=>alive?new Matrix4():null;system.start(weapon.prefabs.muzzleFlashWorld,matrix);system.start(weapon.prefabs.muzzleflashVM,matrix,{viewScene:view});
 system.frame(0.025,camera);system.frame(0.025,camera,true);assert.equal(system.worldLight.intensity,13.5);assert.equal(system.viewLight.intensity,13.5);
 system.frame(0.075,camera);system.frame(0.075,camera,true);assert.equal(system.worldLight.intensity,0);assert.equal(system.viewLight.intensity,0);assert.equal(system.entries.length,2);
 system.frame(0.9,camera);assert.equal(system.entries.length,1);assert.equal(disposed,1);alive=false;system.frame(0.01,camera);assert.equal(system.entries.length,0);assert.equal(disposed,2);
});
test('world-space barrel smoke stays at its emission transform when the muzzle moves',needsAssets,()=>{
 const ps=prefab.components.ParticleSystem.find(p=>prefab.nodes[p.node].name==='BarrelSmoke'),renderer=prefab.components.ParticleSystemRenderer.find(p=>p.node===ps.node),material=manifest.materials[renderer.materials[0]],camera=new PerspectiveCamera();camera.updateMatrixWorld();
 const make=local=>new ParticleEffect({...ps.data,moveWithTransform:local},renderer,material,null,new Matrix4().fromArray(prefab.nodes[ps.node].matrix),()=>0.5);
 for(const local of [false,true]){const moving=make(local),fixed=make(local);for(const e of [moving,fixed])e.update(0.01,true,new Matrix4(),camera);
  assert.ok(moving.particles.length>0);moving.update(0.01,false,new Matrix4().makeTranslation(20,0,0),camera);fixed.update(0.01,false,new Matrix4(),camera);
  assert.ok(Math.abs(moving.positions[0]-fixed.positions[0]-(local?20:0))<0.001);moving.dispose();fixed.dispose();}
});
