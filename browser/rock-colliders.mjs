import {InstancedMeshBody} from './collision.mjs';

// The island's decor rocks and cliffs as solid colliders (tools/export_rocks.py). The scene's "RockSpawn" SlowSpawn
// creates one MeshCollider per serialized instance at run time (runtimeLoad = Collider), on its own layer (10, the
// same solid layer as the tree colliders), with no SurfaceInfo, so hits on it use the default surface.
// binary(descriptor, TypedArray) reads one exported file; returns one InstancedMeshBody per SlowSpawn.
export async function loadRockColliders(manifest,binary){
 const bodies=[];
 for(const spawn of manifest.spawns){
  const meshes=[];for(const key of spawn.meshes){const m=manifest.meshes[key],positions=await binary(m.position,Float32Array),parts=await Promise.all(m.parts.map(p=>binary(p,Uint32Array)));
   const indices=new Uint32Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){indices.set(p,o);o+=p.length;}meshes.push({positions,indices});}
  const body=new InstancedMeshBody(spawn.name,meshes,await binary(spawn.matrices,Float32Array),await binary(spawn.meshIndex,Uint8Array));
  body.layer=spawn.layer;body.slowSpawn=true;bodies.push(body);
 }
 return bodies;
}
