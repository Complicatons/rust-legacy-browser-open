import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSurfaceResolver,terrainSurfaceIndex} from '../browser/surface-routing.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const root=new URL('../browser/assets/recovered/deployables/',import.meta.url),m=hasRecovered?(JSON.parse(readFileSync(new URL('manifest.json',root)))):null,t=hasRecovered?(m.surfaceRoutes.terrain):null,indices=hasRecovered?(new Uint8Array(readFileSync(new URL(t.file,root)))):null,resolve=hasRecovered?(createSurfaceResolver(m,indices)):null;
test('native actor routes identify player and wildlife flesh without name heuristics',needsAssets,()=>{
 for(const name of ['MalePlayer','Wolf','Bear','Chicken_A','Boar_A','Stag_A','Rabbit_A','MutantWolf','MaleRagdoll'])assert.equal(resolve({body:{surfaceName:name}}).name,'flesh',name);
 assert.equal(resolve({body:{animal:{def:{name:'Wolf'}}}}).name,'flesh');
 assert.equal(resolve({body:{surfaceName:'invented_flesh_wood'}}).name,'default');
});
test('explicit prefab surface wins, with original object-name routes for resources and loot',needsAssets,()=>{
 const wood=m.surfaceRoutes.actors.WoodFoundation,metal=m.surfaceRoutes.actors.MetalFoundation;
 assert.equal(resolve({body:{surfaceName:'MalePlayer',deployed:{prefab:{components:{SurfaceInfo:[{surface:metal}]}}}}}).name,'metal');
 assert.equal(resolve({body:{resourceNode:{prefab:{name:'WoodPile'}}}}).name,'wood');
 assert.equal(resolve({body:{crate:{prefab:{name:'WoodBox'}}}}).name,'wood');
 assert.equal(resolve({body:{structure:{prefab:{components:{SurfaceInfo:[{surface:wood}]}}}}}).name,'wood');
});
test('original island static scene has no custom surfaces; unassigned geometry uses native default',needsAssets,()=>{
 assert.deepEqual(m.surfaceRoutes.scene,{});assert.equal(resolve({body:null}).name,'default');
 assert.equal(resolve({body:{name:'MetalWall'}}).name,'default','a diagnostic body name is not source evidence');
});
test('terrain surface lookup converts reflected browser Z and uses row-major Unity indices',()=>{
 const terrain={origin:[-10,0,-20],extent:[20,40],width:2,height:2},data=new Uint8Array([0,1,2,3]);
 assert.equal(terrainSurfaceIndex(terrain,data,[-9,0,19]),0);assert.equal(terrainSurfaceIndex(terrain,data,[1,0,19]),1);
 assert.equal(terrainSurfaceIndex(terrain,data,[-9,0,-1]),2);assert.equal(terrainSurfaceIndex(terrain,data,[1,0,-1]),3);
 assert.equal(terrainSurfaceIndex(terrain,data,[10,0,19]),0);assert.equal(terrainSurfaceIndex(terrain,data,[-30,0,19]),0);
});
test('terrain map and source surface assignments are complete, with native first-surface fallback',needsAssets,()=>{
 assert.equal(indices.length,2048*2048);assert.equal(t.surfaces.length,4);assert.ok(indices.every(i=>i<4));
 for(const key of t.surfaces)assert.ok(m.surfaces[key]?.bulletEffects.length);
 const c=structuredClone(m);c.surfaceRoutes.terrain={origin:[0,0,0],extent:[1,1],width:1,height:1,surfaces:[m.defaultSurface]};
 assert.equal(createSurfaceResolver(c,new Uint8Array([3]))({terrain:true,point:[0,0,0]}).name,'default');
 for(const p of [[0,0,0],[4000,0,-4000],[-4000,0,4000]])assert.equal(resolve({terrain:true,point:p}).name,m.surfaces[t.surfaces[terrainSurfaceIndex(t,indices,p)]].name);
});
test('all exported native surface effects resolve to original particle prefabs',needsAssets,()=>{
 for(const s of Object.values(m.surfaces))for(const key of [...s.bulletEffects,...s.meleeEffects])assert.ok(m.prefabs[key],s.name);
 assert.ok(m.surfaces[m.surfaceRoutes.actors.MalePlayer].bulletEffects.length);
});
