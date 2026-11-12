import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Box3,Triangle,Ray} from 'three';
import {CollisionOctree,boxIntersectsTriangle,buildOriginalCollision} from '../browser/collision.mjs';
import {loadRockColliders} from '../browser/rock-colliders.mjs';
import {needsAssets} from './helpers/assets.mjs';

// The octree build's fast triangle/box test and child pre-filter must give the same trees as three's Box3.intersectsTriangle
// did, so every collision query is unchanged.
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const base=new URL('../browser/assets/recovered/',import.meta.url);
const reader=dir=>async(d,T)=>{const b=await readFile(new URL(d.file,dir));return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};

test('boxIntersectsTriangle answers exactly as Box3.intersectsTriangle',()=>{
 const rng=seeded(7),v=()=>new Vector3();let hits=0;
 // Coordinates on a coarse grid make touching faces, shared edges, coplanar and degenerate triangles common.
 for(let i=0;i<300000;i++){const grid=i%3===0,p=()=>grid?Math.round((rng()-0.5)*8)/2:(rng()-0.5)*20+(i%5===0?5000:0);
  const a=v().set(p(),p(),p()),box=new Box3(a.clone(),a.clone().add(v().set(grid?Math.round(rng()*4)/2:rng()*6,grid?Math.round(rng()*4)/2:rng()*6,grid?Math.round(rng()*4)/2:rng()*6)));
  const t=new Triangle(v().set(p(),p(),p()),v().set(p(),p(),p()),v().set(p(),p(),p()));if(i%7===0)t.c.copy(t.a).lerp(t.b,rng());
  const want=box.intersectsTriangle(t);assert.equal(boxIntersectsTriangle(box,t),want,`case ${i}`);if(want)hits++;}
 assert.ok(hits>20000,`${hits} intersecting cases`);
 const empty=new Box3(),t=new Triangle(v(),v().set(1,0,0),v().set(0,1,0));assert.equal(boxIntersectsTriangle(empty,t),false);
 t.a.x=Infinity;const box=new Box3(v().set(-1,-1,-1),v().set(1,1,1));assert.equal(boxIntersectsTriangle(box,t),box.intersectsTriangle(t));
});

// CollisionOctree.split before the fast build: three's test on every child.
function referenceSplit(level){if(!this.box)return this;const C=this.constructor,half=new Vector3().subVectors(this.box.max,this.box.min).multiplyScalar(0.5),subTrees=[];
 for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){const box=new Box3();box.min.set(this.box.min.x+x*half.x,this.box.min.y+y*half.y,this.box.min.z+z*half.z);box.max.copy(box.min).add(half);subTrees.push(new C(box));}
 let triangle;while((triangle=this.triangles.pop()))for(const t of subTrees)if(t.box.intersectsTriangle(triangle))t.triangles.push(triangle);
 const small=Math.max(half.x,half.y,half.z)<C.MIN_CELL*2;
 for(const t of subTrees){const n=t.triangles.length;if(n>C.TRIANGLES_PER_LEAF&&level<C.MAX_LEVEL&&!small)t.split(level+1);if(n)this.subTrees.push(t);}
 return this;}
async function withReferenceBuild(build){const split=CollisionOctree.prototype.split;CollisionOctree.prototype.split=referenceSplit;try{return await build();}finally{CollisionOctree.prototype.split=split;}}
// Every node's box, then its triangles' vertices in order, then its children, depth first.
function flatten(tree){const out=[];const walk=n=>{out.push(...n.box.min.toArray(),...n.box.max.toArray(),n.triangles.length,n.subTrees.length);
 for(const t of n.triangles)out.push(t.a.x,t.a.y,t.a.z,t.b.x,t.b.y,t.b.z,t.c.x,t.c.y,t.c.z);for(const s of n.subTrees)walk(s);};walk(tree);return out;}
function assertSameTree(a,b,name){const x=flatten(a),y=flatten(b);assert.equal(x.length,y.length,`${name}: tree size`);for(let i=0;i<x.length;i++)if(!Object.is(x[i],y[i]))assert.fail(`${name}: trees differ at value ${i}`);return x.length;}

test('the island collision builds the same octrees as three\'s triangle test, with the same query results',needsAssets,async()=>{
 const scene=new URL('scene/',base),manifest=JSON.parse(await readFile(new URL('manifest.json',scene))),original={manifest,binary:reader(scene)};
 const rocksDir=new URL('rockspawn/',base),rocksManifest=JSON.parse(await readFile(new URL('manifest.json',rocksDir)));
 const build=async()=>{const world=await buildOriginalCollision(original,()=>-1000);for(const b of await loadRockColliders(rocksManifest,reader(rocksDir)))world.addBody(b);return world;};
 const want=await withReferenceBuild(build),got=await build();
 assert.ok(assertSameTree(got.tree,want.tree,'static scene')>8e6);
 const rocks=got.bodies.find(b=>b.slowSpawn),rocksWant=want.bodies.find(b=>b.slowSpawn);
 rocks.meshes.forEach((m,i)=>assertSameTree(m.tree,rocksWant.meshes[i].tree,`rock mesh ${i}`));
 for(const [door,body] of got.doorBodies)assertSameTree(body.ensure(),want.doorBodies.get(door).ensure(),`door ${door}`);
 // Capsules and rays around the static scene and the rocks.
 const rng=seeded(3),c=got.tree.box.getCenter(new Vector3()),size=got.tree.box.getSize(new Vector3()),plain=h=>h&&{distance:h.distance,position:h.position?.toArray(),normal:h.normal?.toArray(),depth:h.depth,triangle:h.triangle&&[h.triangle.a,h.triangle.b,h.triangle.c].map(p=>p.toArray())};
 let hits=0;for(let i=0;i<3000;i++){const p=new Vector3(c.x+(rng()-0.5)*size.x,c.y+(rng()-0.5)*size.y,c.z+(rng()-0.5)*size.z);if(i%2)p.copy(rocks.instanceBounds(i%rocks.count).getCenter(new Vector3()));
  const capsule=got.capsule(p,1.8,0.4+rng());const a=plain(got.capsuleHit(capsule)),b=plain(want.capsuleHit(capsule));assert.deepEqual(a,b,`capsule ${i}`);
  const ray=new Ray(p,new Vector3(rng()-0.5,rng()-0.7,rng()-0.5).normalize()),ra=plain(got.rayHit(ray,300)),rb=plain(want.rayHit(ray,300));assert.deepEqual(ra,rb,`ray ${i}`);if(a||ra)hits++;}
 assert.ok(hits>500,`${hits} queries hit something`);
});
