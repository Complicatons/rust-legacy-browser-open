import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Ray,Matrix4,Quaternion,BoxGeometry,SphereGeometry} from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';
import {CollisionWorld,MovingBody,InstancedMeshBody} from '../browser/collision.mjs';
import {loadRockColliders} from '../browser/rock-colliders.mjs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';
import {LegacyMotor} from '../browser/motor.mjs';
import {needsAssets} from './helpers/assets.mjs';

const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const shape=g=>{const s={positions:g.attributes.position.array,indices:new Uint32Array(g.index.array)};g.dispose();return s;};

test('instanced mesh collider gives the same hits as the same placements in world space',()=>{
 const rng=seeded(11),meshes=[shape(new BoxGeometry(4,2,6)),shape(new SphereGeometry(3,8,6))],count=40;
 const matrices=new Float32Array(count*16),index=new Uint8Array(count),reference=new MovingBody('reference');
 for(let i=0;i<count;i++){const q=new Quaternion().setFromAxisAngle(new Vector3(rng()-0.5,1,rng()-0.5).normalize(),rng()*6.28);
  const m=new Matrix4().compose(new Vector3((rng()-0.5)*400,rng()*20,(rng()-0.5)*400),q,new Vector3(1,1,1));m.toArray(matrices,i*16);index[i]=i%2;
  reference.addGeometry(meshes[i%2].positions,meshes[i%2].indices,m);}
 reference.setMotion(new Matrix4());
 const body=new InstancedMeshBody('rocks',meshes,matrices,index,32);
 assert.equal(body.count,count);assert.equal(body.triangleCount,count/2*(body.meshes[0].count+body.meshes[1].count));
 let rays=0,capsules=0;
 for(let k=0;k<400;k++){const aim=body.instanceBounds((k*7)%count).getCenter(new Vector3()),o=aim.clone().add(new Vector3((rng()-0.5)*60,(rng()-0.5)*20,(rng()-0.5)*60)),
   d=aim.clone().add(new Vector3((rng()-0.5)*6,(rng()-0.5)*3,(rng()-0.5)*6)).sub(o).normalize(),ray=new Ray(o,d);
  const a=body.rayIntersect(ray,300),b=reference.ensure().rayIntersect(ray,300);assert.equal(Boolean(a),Boolean(b),'ray '+k);
  if(a){rays++;assert.ok(Math.abs(a.distance-b.distance)<1e-4);assert.ok(a.position.distanceTo(b.position)<1e-3);assert.ok(a.triangle.getNormal(new Vector3()).distanceTo(b.triangle.getNormal(new Vector3()))<1e-4);}
  const t=body.meshes[index[k%count]].bounds.clone().applyMatrix4(new Matrix4().fromArray(matrices,(k%count)*16)).getCenter(new Vector3()).add(new Vector3((rng()-0.5)*8,(rng()-0.5)*4,(rng()-0.5)*8));
  const cap=new Capsule(t.clone(),t.clone().add(new Vector3(0,1.3,0)),0.45),ca=body.capsuleIntersect(cap),cb=reference.ensure().capsuleIntersect(cap);
  assert.equal(Boolean(ca),Boolean(cb),'capsule '+k);
  // Overlaps are accumulated in triangle order (as Octree.capsuleIntersect does), so single pushes can differ; resolving
  // as CollisionWorld.resolve does (repeated pushes) must leave the capsule clear of the reference geometry.
  if(ca){capsules++;const settled=cap.clone();for(let n=0;n<8;n++){const h=body.capsuleIntersect(settled);if(!h)break;settled.translate(h.normal.multiplyScalar(h.depth+1e-5));}
   assert.ok(!(reference.ensure().capsuleIntersect(settled)?.depth>0.01),'resolves clear '+k);}}
 assert.ok(rays>40&&capsules>40,JSON.stringify({rays,capsules}));
 // Vertical rays (CollisionWorld.support) and the world's body queries.
 const world=new CollisionWorld((x,z)=>-100);world.addBody(body);body.layer=10;world.build();
 const top=body.instanceBounds(0).max.y,c=body.instanceBounds(0).getCenter(new Vector3());
 const s=world.support(c.x,c.z,top+5,-50);assert.ok(s&&s.height<=top+1e-6&&s.height>-100,'stands on the instance');
 assert.equal(world.support(c.x,c.z,top+5,-50,)?.height,s.height);
 assert.ok(world.nearbyTriangles(body.instanceBounds(0)).length>0,'cosmetic physics sees the triangles');
});

const base=new URL('../browser/assets/recovered/',import.meta.url);
const binary=async(desc,T)=>{const b=await readFile(new URL('rockspawn/'+desc.file,base));return new T(b.buffer,b.byteOffset,b.byteLength/T.BYTES_PER_ELEMENT);};

test('the original RockSpawn SlowSpawn exports 8,344 solid rock colliders on layer 10 at the visible rocks',needsAssets,async()=>{
 const manifest=JSON.parse(await readFile(new URL('rockspawn/manifest.json',base)));
 assert.equal(manifest.spawns.length,1);const spawn=manifest.spawns[0];
 assert.deepEqual([spawn.name,spawn.layer,spawn.count,spawn.runtimeLoad,spawn.findSequence],['RockSpawn',10,8344,1,'_decor_']);
 assert.deepEqual(spawn.meshes.map(k=>manifest.meshes[k].name),['2','4A','6','5B','3','1A','5A']);
 const [rocks]=await loadRockColliders(manifest,binary);assert.equal(rocks.count,8344);assert.equal(rocks.layer,10);
 // Each collider is its rock: the same mesh at the same pose as the scene's overlay-rock renderer.
 const scene=JSON.parse(await readFile(new URL('scene/manifest.json',base))),byPos=new Map();
 const keys=spawn.meshes.map(k=>k.replace(/^server:/,''));// same mesh, keyed by build
 for(const i of scene.instances)if(keys.includes(i.mesh))byPos.set(Math.round(i.matrix[12])+','+Math.round(i.matrix[14])+','+i.mesh,i);
 const m=new Float32Array(16);let matched=0;
 for(let i=0;i<rocks.count;i++){rocks.matrix(i).toArray(m);const v=byPos.get(Math.round(m[12])+','+Math.round(m[14])+','+keys[rocks.mesh[i]]);if(v&&v.matrix.every((x,k)=>Math.abs(x-m[k])<1e-3))matched++;}
 assert.equal(matched,8344);
 // Rocks stand out of the terrain: standing on most rock tops is above the ground there.
 const terrain=JSON.parse(await readFile(new URL('manifest.json',base))),hb=await readFile(new URL(terrain.heightFile,base));
 const heights=new Float32Array(hb.buffer,hb.byteOffset,hb.byteLength/4),ground=(x,z)=>sampleTriangle(heights,terrain.size,...worldToGrid(x,z,terrain.extent,terrain.size-1));
 const world=new CollisionWorld(ground);world.addBody(rocks);world.build();
 let above=0,sampled=0;for(let i=0;i<rocks.count;i+=97){const b=rocks.instanceBounds(i),c=b.getCenter(new Vector3()),s=world.support(c.x,c.z,b.max.y+2,ground(c.x,c.z)-50);sampled++;if(s&&s.height>ground(c.x,c.z)+0.5)above++;}
 assert.ok(above>sampled*0.8,`${above}/${sampled} rock tops above the terrain`);
 // Mesh colliders are surfaces: walking into a rock side is blocked where a ray from outside meets it.
 let blocked=0,tried=0;for(let i=0;i<rocks.count&&tried<40;i+=211){const b=rocks.instanceBounds(i),c=b.getCenter(new Vector3()),g=ground(c.x,c.z);if(b.max.y<g+4)continue;
  const from=new Vector3(b.max.x+5,g+1.5,c.z),hit=world.rayHit(new Ray(from,new Vector3(c.x-from.x,0,0).normalize()),b.max.x-b.min.x+10);if(!hit)continue;tried++;
  if(world.overlaps(new Vector3(hit.position.x,hit.position.y-0.9,hit.position.z),1.8,0.45))blocked++;}
 // (A capsule straddling a thin fin is pushed both ways by Octree's accumulation and can end up level.)
 assert.ok(tried>=20&&blocked>=tried*0.9,`${blocked}/${tried} rock sides block a standing capsule`);
});

// The player motor against the real rocks. Each listed rock threw or let the player through before the fixes: the
// motor read `.motion` of the rock body it stood on (TypeError every frame), its down pass dropped the capsule below
// the terrain into a rock's buried base, and depenetration from a face touched from behind pushed it out the far side.
test('walking into rocks with the original motor never passes through one and never throws',needsAssets,async()=>{
 const manifest=JSON.parse(await readFile(new URL('rockspawn/manifest.json',base))),[rocks]=await loadRockColliders(manifest,binary);
 const terrain=JSON.parse(await readFile(new URL('manifest.json',base))),hb=await readFile(new URL(terrain.heightFile,base));
 const heights=new Float32Array(hb.buffer,hb.byteOffset,hb.byteLength/4),ground=(x,z)=>sampleTriangle(heights,terrain.size,...worldToGrid(x,z,terrain.extent,terrain.size-1));
 const config=JSON.parse(await readFile(new URL('player.json',base))),physics=JSON.parse(await readFile(new URL('physics.json',base)));
 const world=new CollisionWorld(ground);world.addBody(rocks);world.build();const motor=new LegacyMotor(config,world,{collisionMask:physics.player.collisionMask});
 let walks=0,stoodOn=0;
 for(const i of [422,633,844,1266,2110,6541,7385,8018])for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[0.7,0.7],[-0.7,0.7]]){
  const b=rocks.instanceBounds(i),c=b.getCenter(new Vector3()),r=Math.max(b.max.x-b.min.x,b.max.z-b.min.z)/2+6,start=new Vector3(c.x+dx*r,0,c.z+dz*r);start.y=ground(start.x,start.z)+0.05;
  const dir=new Vector3(-dx,0,-dz).normalize();if(world.overlaps(start,2.08,0.45)||!world.rayHit(new Ray(start.clone().setY(start.y+1.2),dir),2*r))continue;
  motor.teleport(start,{settle:true});let prev=motor.feet.clone();walks++;
  for(let k=0;k<480;k++){motor.update(1/60,{forward:1},Math.atan2(-dir.x,-dir.z));const at=motor.feet.clone(),step=at.clone().sub(prev),length=step.length();
   if(length>1e-6){const hit=world.rayHit(new Ray(prev.clone().setY(prev.y+1),step.normalize()),length);assert.ok(!(hit&&hit.distance<=length),`rock ${i} from ${[dx,dz]}: through a rock face at frame ${k}`);}prev=at;}
  if(motor.platform===rocks)stoodOn++;}
 assert.ok(walks>=30,`${walks} walks`);
 // three's capsule-triangle test missed this standing capsule's axis passing through a 1.9 m² slope of rock 422, so a
 // falling capsule dropped into the rock there.
 assert.ok(world.capsuleHit(world.capsule(new Vector3(5225.595,480.582,1757.426),2.08,0.45)),'capsule through the rock 422 slope overlaps it');
 // Rocks are static colliders to stand on (CCMotor's platform does not move).
 assert.ok(stoodOn>0&&rocks.static&&rocks.motion.equals(new Matrix4()),`${stoodOn} walks ended on a rock`);
});
