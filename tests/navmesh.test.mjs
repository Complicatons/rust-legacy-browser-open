import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {Vector3} from 'three';
import {Quaternion} from 'three';
import {NavMesh,loadNavMesh} from '../browser/navmesh.mjs';
import {Wildlife,WildlifeWorld} from '../browser/animals.mjs';
import {present,hasRecovered,needsAssets} from './helpers/assets.mjs';
const animals=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/animals/manifest.json',import.meta.url)))):null;

// Squares A(0..10,0..10) B(10..20,0..10) C(10..20,10..20): an L-shaped corridor around the inner corner (10,10).
function lMesh(reverse){
 const v=[[0,0],[10,0],[10,10],[0,10],[20,0],[20,10],[20,20],[10,20]],polys=[[0,1,2,3],[1,4,5,2],[2,5,6,7]].map(p=>reverse?[...p].reverse():p);
 const polyVerts=[0],polyIndex=[];for(const p of polys){polyIndex.push(...p);polyVerts.push(polyIndex.length);}
 const edge=(p,a,b)=>{const q=polys[p];for(let e=0;e<q.length;e++){const x=q[e],y=q[(e+1)%q.length];if((x===a&&y===b)||(x===b&&y===a))return e;}throw Error('edge');};
 const adj=[[[1,1,2]],[[0,1,2],[2,2,5]],[[1,2,5]]],linkStart=[0],linkTo=[],linkEdge=[],linkRange=[];
 adj.forEach((list,p)=>{for(const [to,a,b] of list){linkTo.push(to);linkEdge.push(edge(p,a,b));linkRange.push(0,255);}linkStart.push(linkTo.length);});
 return new NavMesh({verts:new Float32Array(v.flatMap(([x,z])=>[x,0,z])),polyVerts:new Uint32Array(polyVerts),polyIndex:new Uint32Array(polyIndex),linkStart:new Uint32Array(linkStart),linkTo:new Uint32Array(linkTo),linkEdge:new Uint8Array(linkEdge),linkRange:new Uint8Array(linkRange)});
}

test('paths turn the inner corner whatever the polygon winding', ()=>{
 for(const reverse of [false,true]){const nav=lMesh(reverse);
  const plan=nav.plan(new Vector3(2,0,5),new Vector3(15,0,18));
  assert.deepEqual(plan.polys,[0,1,2]);assert.equal(plan.partial,false);
  assert.deepEqual(plan.corners.map(c=>[c.x,c.z]),[[10,10],[15,18]]);
  assert.deepEqual(nav.plan(new Vector3(2,0,5),new Vector3(8,0,2)).corners.map(c=>[c.x,c.z]),[[8,2]]);
  // Off-mesh target: snapped to the nearest polygon edge.
  const off=nav.plan(new Vector3(2,0,5),new Vector3(5,0,11),{ext:{x:2,y:4,z:2}});assert.deepEqual([off.end.x,off.end.z],[5,10]);
  assert.equal(nav.plan(new Vector3(2,0,5),new Vector3(5,0,40)),null);
  assert.deepEqual(nav.moveAlongSurface(0,new Vector3(2,0,5),new Vector3(5,0,15)).point.toArray(),[5,0,10]);
  const m=nav.moveAlongSurface(0,new Vector3(9,0,5),new Vector3(12,0,12));assert.equal(m.poly,2);
 }
});

test('wolves follow the navmesh corridor and are not placed off it',needsAssets, ()=>{
 const nav=lMesh(false),physics={navmesh:nav,groundInfo:p=>({hit:true,pos:new Vector3(p.x,0,p.z),normal:new Vector3(0,1,0)}),blocked:()=>false};
 const world=new WildlifeWorld({rng:()=>0.5,physics}),def=animals.animals.wolf_prefab;
 // RemoveIfNotOnNavmesh: an agent that cannot be placed is disabled and the animal kills itself (corpse for 90 s).
 const off=world.add(new Wildlife(world,'wolf_prefab',def,null,{spawned:[]},new Vector3(5,0,40),new Quaternion()));
 assert.ok(off&&off.move.offMesh&&off.vitals.dead&&off.state===7&&off.destroyAt===off.world.time+90);
 const wolf=world.add(new Wildlife(world,'wolf_prefab',def,null,{spawned:[]},new Vector3(2,0,5),new Quaternion()));
 wolf.move.setMovePosition(new Vector3(15,0,18),4);
 let cornerSeen=false;
 for(let i=0;i<400&&wolf.move.hasPath;i++){world.crowd.update(0.05);wolf.move.frame(wolf,0.05);const {x,z}=wolf.position;
  assert.ok(x>=-1e-6&&x<=20+1e-6&&z>=-1e-6&&z<=20+1e-6&&!(x<10-1e-6&&z>10+1e-6),`left the mesh at ${x},${z}`);
  if(Math.abs(x-10)<1&&Math.abs(z-10)<1)cornerSeen=true;}
 assert.ok(cornerSeen,'cut along the inner corner');
 assert.ok(wolf.position.distanceTo(new Vector3(15,0,18))<0.2,wolf.position.toArray().join());
});

const dir=new URL('../browser/assets/recovered/navmesh/',import.meta.url);
test('the original island navmesh routes between wolf spawners', {skip:!present(new URL('manifest.json',dir))}, async()=>{
 const nav=await loadNavMesh(dir,async url=>({ok:true,arrayBuffer:async()=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}}));
 const manifest=JSON.parse(await readFile(new URL('manifest.json',dir)));assert.equal(nav.polyCount,manifest.polys);
 const res=JSON.parse(await readFile(new URL('../browser/assets/recovered/resources/manifest.json',import.meta.url)));
 const wolves=res.spawners.filter(s=>s.spawnList.some(e=>/wolf|bear/.test(e.prefabName))).map(s=>new Vector3(s.position[0],s.position[1],-s.position[2]));
 const sampled=wolves.map(p=>nav.groundInfo(p));
 assert.ok(sampled.filter(Boolean).length>=wolves.length*0.8,`${sampled.filter(Boolean).length}/${wolves.length} spawners on the navmesh`);
 const [a,b]=sampled.filter(Boolean);
 const plan=nav.plan(a.point,b.point,{maxNodes:65536});
 assert.ok(plan&&plan.polys.length>1);
 for(const c of plan.corners)assert.ok(nav.findNearest(c,{x:0.5,y:3,z:0.5}),'corner on mesh');
 const len=plan.corners.reduce((s,c,i)=>s+c.distanceTo(i?plan.corners[i-1]:plan.start),0);
 assert.ok(len>=a.point.distanceTo(b.point)-1e-3);
});
