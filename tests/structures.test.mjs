import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion,Ray,Box3} from 'three';
import {StructureSystem,StructureType as T,keyOf,roundToInt} from '../browser/structures.mjs';
import {DeployableSystem,checkPlacement} from '../browser/deployables.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null,key=name=>Object.keys(manifest.structures).find(k=>manifest.structures[k].item===name),dkey=name=>Object.keys(manifest.deployables).find(k=>manifest.deployables[k].item===name);
// Flat terrain at y=0; rays also hit placed pieces' collider bounds (enough for these grid tests).
function makeWorld(zones=[]){const world={zones,system:null,
 raycast(ray,range){let best=null;const t=ray.direction.y<0?-ray.origin.y/ray.direction.y:Infinity;if(t>=0&&t<=range)best={point:ray.origin.clone().addScaledVector(ray.direction,t),normal:new Vector3(0,1,0),terrain:true,distance:t};
  for(const c of world.system?.components??[]){const p=ray.intersectBox(c.bounds,new Vector3());if(p){const d=p.distanceTo(ray.origin);if(d<=range&&(!best||d<best.distance))best={point:p,normal:new Vector3(0,1,0),terrain:false,structure:c,distance:d};}}return best;},
 groundTerrainOnly(p,range){const start=p.y+0.25;return start>=0&&start<=range+0.25;}};return world;}
function setup(zones){const world=makeWorld(zones),s=new StructureSystem(manifest,items,world);world.system=s;return s;}
const q=new Quaternion(),eyesAt=(x,z)=>new Ray(new Vector3(x,10,z),new Vector3(0,-1,0));
const at=(m,x,y,z)=>m.world(new Vector3(x,y,z));

test('structure keys use the original 2.5 x 4 x 2.5 cells with round-half-to-even',needsAssets,()=>{
 assert.equal(roundToInt(0.5),0);assert.equal(roundToInt(1.5),2);assert.equal(roundToInt(-0.5),0);
 assert.equal(keyOf(new Vector3(1.25,2,3.75)),'0,0,2');assert.equal(keyOf(new Vector3(-2.5,4,2.5)),'-1,1,1');
 assert.equal(Object.keys(manifest.structures).length,16);
});

test('foundations: first on terrain 3.5 m below the aim point, then only beside an existing foundation at the same height',needsAssets,()=>{
 const s=setup(),eyes=new Ray(new Vector3(0,1.6,0),new Vector3(0,-1,1).normalize());
 const pre=s.placement(key('Wood Foundation'),eyes,q);assert.ok(pre.valid);assert.ok(Math.abs(pre.position.y+3.5)<1e-6);assert.ok(Math.abs(pre.position.z-1.6)<1e-6);
 const f=s.place(key('Wood Foundation'),eyes,pre.placePosition,pre.placeRotation,pre.master);assert.ok(f);assert.equal(s.masters.size,1);const m=f.master;assert.equal(m.materialType,1);
 assert.ok(s.place(key('Wood Foundation'),eyesAt(50,50),at(m,5,0,0),m.rotation,m));
 assert.equal(s.place(key('Wood Foundation'),eyesAt(50,50),at(m,7.5,0,0),m.rotation,m),null);
 assert.equal(s.place(key('Wood Foundation'),eyesAt(50,50),at(m,5,0,0),m.rotation,m),null,'occupied');
 // Material must match the master (set by its first foundation).
 assert.equal(s.place(key('Metal Foundation'),eyesAt(50,50),at(m,0,0,5),m.rotation,m),null);
 // A new master cannot be started while the aim ray passes through an existing structure's bounds.
 assert.equal(s.place(key('Wood Foundation'),new Ray(new Vector3(-10,2,1.6),new Vector3(1,0,0)),new Vector3(30,-3.5,30),q,null),null);
});

test('pillars stand on a foundation top or another pillar; walls need pillars at both ends; ceilings and stairs need four corner pillars',needsAssets,()=>{
 const s=setup(),f=s.place(key('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),m=f.master,P=key('Wood Pillar');
 assert.equal(s.place(P,eyesAt(50,50),at(m,2.5,8,2.5),q,m),null,'floating pillar');
 for(const [x,z] of [[2.5,2.5],[-2.5,2.5],[2.5,-2.5],[-2.5,-2.5]])assert.ok(s.place(P,eyesAt(50,50),at(m,x,4,z),q,m),`pillar ${x},${z}`);
 assert.ok(s.place(P,eyesAt(50,50),at(m,2.5,8,2.5),q,m),'pillar on pillar');
 const turned=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);
 assert.equal(s.place(key('Wood Wall'),eyesAt(50,50),at(m,0,4,2.5),turned,m),null,'wall across the gap');
 const wall=s.place(key('Wood Wall'),eyesAt(50,50),at(m,0,4,2.5),q,m);assert.ok(wall);assert.equal(wall.type,T.Wall);
 const door=s.place(key('Wood Doorway'),eyesAt(50,50),at(m,0,4,-2.5),q,m);assert.ok(door);assert.equal(door.hardpoints.length,1);assert.equal(door.hardpoints[0].type,2);
 assert.equal(s.place(key('Wood Ceiling'),eyesAt(50,50),at(m,0,8,0),q,m),null,'only one corner pillar at that height');
 assert.ok(s.place(key('Wood Ceiling'),eyesAt(50,50),at(m,0,4,0),q,m));
 assert.equal(s.place(key('Wood Stairs'),eyesAt(50,50),at(m,0,4,0),q,m),null,'cell already holds the ceiling');
});

test('no-placement zones block structures; destroying a piece frees its cell and destroys what it carries',needsAssets,()=>{
 const blocked=setup([{position:new Vector3(0,-3.5,0),radius:10}]);assert.equal(blocked.place(key('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),null);
 const s=setup(),f=s.place(key('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),m=f.master;
 const deploy=new DeployableSystem(manifest,items),box=deploy.place(dkey('Wood Storage Box'),new Vector3(0,0.5,0),q,0,f);assert.ok(f.carried.has(box));
 const p=s.place(key('Wood Pillar'),eyesAt(50,50),at(m,2.5,4,2.5),q,m);assert.equal(p.hurt(500,2),0,"pillars ignore melee (armour 200)");p.hurt(p.maxHealth+1,0);assert.ok(p.destroyed);assert.equal(m.componentAt(at(m,2.5,4,2.5)),null);
 assert.ok(s.place(key('Wood Pillar'),eyesAt(50,50),at(m,2.5,4,2.5),q,m),'cell reusable');
 f.destroy();assert.ok(box.destroyed);assert.equal(deploy.objects.size,0);
 // The master survives while other pieces remain; it goes when the last piece does.
 assert.equal(s.masters.size,1);for(const c of [...s.components])c.destroy();assert.equal(s.masters.size,0);
});

test('doors attach to a doorway hardpoint (HardpointPosRot) and need one (requireHardpoint)',needsAssets,()=>{
 const s=setup(),f=s.place(key('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),m=f.master;
 for(const [x,z] of [[2.5,-2.5],[-2.5,-2.5]])s.place(key('Wood Pillar'),eyesAt(50,50),at(m,x,4,z),q,m);
 const doorway=s.place(key('Wood Doorway'),eyesAt(50,50),at(m,0,4,-2.5),q,m),hp=doorway.hardpoints[0];
 const e=manifest.deployables[dkey('Wooden Door')],prefab=manifest.prefabs[e.prefab];assert.equal(e.placement.requireHardpoint,1);assert.equal(e.placement.hardpointType,2);
 const world={zones:[],deployedNear:()=>null,fit:()=>true,cast:(ray,range)=>s.world.raycast(ray,range),hardpoint:(ray,type)=>s.hardpointFromRay(ray,type)};
 const look=new Ray(new Vector3(0,1.6,-6),new Vector3(0,0,1));const r=checkPlacement(e,prefab,look,world);
 assert.ok(r.valid,JSON.stringify(r.results));assert.ok(r.position.distanceTo(hp.position)<1e-6);assert.equal(r.carrier,doorway);
 const away=checkPlacement(e,prefab,new Ray(new Vector3(30,1.6,30),new Vector3(0,0,1)),world);assert.ok(away.results.falseFromHardpoint);
});
