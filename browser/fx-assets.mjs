import * as THREE from 'three';
import {createAssetLoader} from './scene.mjs';
import {particleLightingFrom,particleShading,particleMaterial} from './particles.mjs';
// Loads fx/manifest.json (tools/export_fx.py) for the particle/light port: Mesh render-mode geometry (death-effect debris,
// drawn with the renderer's own exported material), Mesh emission shapes, the scene WindZone for External Forces, the
// LightStyle clock and the shared per-frame particle lighting. Everything is loaded up front so effects stay synchronous.
export async function createFxAssets(base,manifest,{deployManifest=null,deployBase=null}={}){
 const loader=manifest?createAssetLoader(base+'fx/',manifest):null,deployAssets=deployManifest?createAssetLoader(deployBase??base+'deployables/',deployManifest):null;
 const geometries=new Map(),shapes=new Map(),materials=new Map();
 async function geometry(key){if(geometries.has(key))return geometries.get(key);const m=manifest.meshes[key],g=new THREE.BufferGeometry();
  const [p,n,u]=await Promise.all([loader.binary(m.position,Float32Array),loader.binary(m.normal,Float32Array),loader.binary(m.uv,Float32Array)]);
  g.setAttribute('position',new THREE.BufferAttribute(p,3));if(n)g.setAttribute('normal',new THREE.BufferAttribute(n,3));if(u)g.setAttribute('uv',new THREE.BufferAttribute(u,2));
  const idx=[];for(const part of m.parts)idx.push(...await loader.binary(part,Uint32Array));g.setIndex(idx);g.computeBoundingSphere();geometries.set(key,g);return g;}
 if(manifest)for(const [key,p] of Object.entries(manifest.prefabs??{})){
  for(const s of p.shapeMeshes??[]){const m=manifest.meshes[s.mesh];if(!m)continue;const [positions,normals]=await Promise.all([loader.binary(m.position,Float32Array),loader.binary(m.normal,Float32Array)]);
   const indices=new Uint32Array(m.parts.reduce((n,x)=>n+x.count,0));let o=0;for(const part of m.parts){const a=await loader.binary(part,Uint32Array);indices.set(a,o);o+=a.length;}shapes.set(`${key}:${s.node}`,{positions,normals,indices});}
  for(const r of p.renderMeshes??[]){const k=r.meshes[0];if(k)await geometry(k);const matKey=deployManifest?.prefabs?.[key]?.components?.ParticleSystemRenderer?.find(x=>x.node===r.node)?.materials?.[0];
   if(matKey&&deployAssets&&!materials.has(matKey))materials.set(matKey,await deployAssets.material(matKey).catch(()=>null));}}
 const lighting={ambient:[0,0,0],directional:[],points:[]};let time=0;
 const w=manifest?.wind;
 return {manifest,lighting,
  // WindZone forward (Unity +Z for an identity rotation) in browser space.
  wind:w?{direction:new THREE.Vector3(...w.forward).multiply(new THREE.Vector3(1,1,-1)).normalize(),main:w.windMain,pulseMagnitude:w.windPulseMagnitude,pulseFrequency:w.windPulseFrequency}:null,
  get time(){return time;},
  tick(dt){time+=dt;},
  // Programs compile with the world (renderer.compileAsync): one hidden object per particle shading variant and debris mesh.
  warm(scene){const group=new THREE.Group();group.name='fx-warm';const seen=new Set();
   for(const m of Object.values(deployManifest?.materials??{})){const sh=particleShading(m.shader,m);if(!/Particles|Lit Colored/.test(m.shader??''))continue;const k=JSON.stringify([sh.blend,sh.fog,sh.alphaTest,sh.depthTest,sh.soft]);if(seen.has(k))continue;seen.add(k);
    const t=new THREE.Texture();t.colorSpace=THREE.SRGBColorSpace;const mat=particleMaterial(sh,t),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(9),3));g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(6),2));g.setAttribute('pcolor',new THREE.BufferAttribute(new Float32Array(12),4));
    const mesh=new THREE.Mesh(g,mat);mesh.frustumCulled=false;g.setDrawRange(0,0);group.add(mesh);}
   for(const [k,mat] of materials){const r=Object.values(manifest?.prefabs??{}).flatMap(p=>p.renderMeshes??[])[0];const g=r&&geometries.get(r.meshes[0]);if(!g||!mat)continue;const m=new THREE.InstancedMesh(g,mat,1);m.count=0;m.frustumCulled=false;group.add(m);}
   scene.add(group);return group;},
  // Shared lighting for VertexLit / Lit Colored particles: ambient (RenderSettings), the sun/moon light and nearby point lights.
  updateLighting(sources){Object.assign(lighting,particleLightingFrom(sources));},
  // ParticleEffect options for one prefab node: debris meshes (Mesh render mode) and Mesh shapes.
  effectOptions(prefab,node,renderer){const key=prefab?.ngcName,entry=manifest?.prefabs?.[key],out={};
   const shape=shapes.get(`${key}:${node}`);if(shape)out.shapeMesh=shape;
   const rm=entry?.renderMeshes?.find(r=>r.node===node);const g=rm&&geometries.get(rm.meshes[0]);
   const mat=materials.get(renderer?.materials?.[0]);if(g&&mat)out.meshRender={geometry:g,material:mat};
   return out;}};
}
