import * as THREE from '/vendor/three.module.js';
import {createLegacyMaterial,legacyTextureSlots} from './legacy-materials.mjs';
import {registerTexture} from './quality.mjs';
import {loadRecovered,setFlipY} from './texture-source.mjs';
import {applyShadowFlags,defaultShadowFlags} from './sun-shadows.mjs';

// These are engine effects/context markers, not world surfaces. The sky (Cloud Layers, Atmosphere, Sun) and the sea
// (Water4Example, matWriteZ) are rendered by browser/sky.mjs and browser/water4.mjs from tools/export_sky.py data.
// userData.layer keeps the original Unity layer (PlanarReflection masks use it); userData.worldBounds / instanceBounds keep each
// original renderer's world AABB for the main camera's per-layer cull distances (browser/layer-culling.mjs).
export const engineMaterials=new Set(['Cloud Layers (Bumped)','Atmosphere','Sun','Water4Example','ContextSpriteTest','matWriteZ']);

// Loads exported mesh buffers, materials and textures from one recovered manifest directory.
// Prefetches (createAssetLoader prefetch) run six at a time, in the order they were asked for (the order the loops
// build in). A burst of hundreds would queue the join's other requests behind it, and would wait on the low-priority
// world prefetch's downloads of the same files (world-prefetch.mjs), which nothing raises. A file a loop needs now
// starts at once anyway: its own binary()/material() call makes the shared promise the queue later finds.
const PREFETCH_CONCURRENCY=6,prefetchQueue=[];let prefetchActive=0;
function queuePrefetch(start){prefetchQueue.push(start);pumpPrefetch();}
function pumpPrefetch(){while(prefetchActive<PREFETCH_CONCURRENCY&&prefetchQueue.length){const start=prefetchQueue.shift();prefetchActive++;
 Promise.resolve().then(start).catch(()=>{}).finally(()=>{prefetchActive--;pumpPrefetch();});}}
export function createAssetLoader(base,manifest){
 const arrays=new Map(),attrs=new Map(),materialCache=new Map(),textureCache=new Map(),loader=new THREE.TextureLoader();
 // Pending loads are shared, so callers that start several meshes at once fetch each file once.
 async function binary(desc,Type){if(!desc)return null;if(!arrays.has(desc.file))arrays.set(desc.file,(async()=>{const r=await fetch(base+desc.file);if(!r.ok)throw Error(`Missing geometry: ${desc.file}`);const a=new Type(await r.arrayBuffer());if(a.length!==desc.count)throw Error('Invalid geometry length');return a;})());return arrays.get(desc.file);}
 async function attributes(key){if(!attrs.has(key))attrs.set(key,(async()=>{const m=manifest.meshes[key];const [p,n,u]=await Promise.all([binary(m.position,Float32Array),binary(m.normal,Float32Array),binary(m.uv,Float32Array)]);return {position:new THREE.BufferAttribute(p,3),normal:n?new THREE.BufferAttribute(n,3):null,uv:u?new THREE.BufferAttribute(u,2):null};})());return attrs.get(key);}
 // Textures load as raw gamma values (NoColorSpace): the original shaders do all maths in gamma space, and per-slot
 // tiling lives in the material's _ST uniforms, so one texture object serves every slot that uses the file.
 function slotTexture(slot){const key=slot.file;if(!textureCache.has(key))textureCache.set(key,loadRecovered(base+slot.file).then(t=>{t.colorSpace=THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;setFlipY(t,true);return registerTexture(t,slot.file);}));return textureCache.get(key);}
 // Original Unity 4 surface shaders (browser/legacy-materials.mjs): Diffuse/Bumped/Specular/Cutout/Transparent,
 // Enviro/BumpedDiffuseOverlaySM3, Custom/Road, View Model/* and Tree Creator, lit as the deferred light pre-pass did.
 // Custom/OutlineHover on a world mesh (the Uber Hunting Bow's UberWorldArrow, w_arrow_uber) is the same shader the placement
 // preview draws (placement-preview.mjs), with the material's own _PushOut/_PushIn/_MinAlpha/_EmissionColor.
 async function outlineHover(m){const {createOutlineHoverMaterial}=await import('./placement-preview.mjs'),slot=m.textures?._MainTex;return createOutlineHoverMaterial(m,slot?await slotTexture(slot):null);}
 function material(key){if(!materialCache.has(key)){const m=manifest.materials[key];materialCache.set(key,m.shader==='Custom/OutlineHover'?outlineHover(m):createLegacyMaterial(m,slotTexture));}return materialCache.get(key);}
 // One mesh per drawn submesh; engine-material parts are skipped and reported.
 async function parts(meshKey,materialKeys,subsets,omitted,label){const a=await attributes(meshKey),md=manifest.meshes[meshKey],out=[];
  for(let i=0;i<subsets.length;i++){
   const m=manifest.materials[materialKeys[i]];if(engineMaterials.has(m.name)){omitted?.push({name:label,material:m.name});continue;}
   const g=new THREE.BufferGeometry();for(const [key,attr] of Object.entries(a))if(attr)g.setAttribute(key,attr);
   g.setIndex(new THREE.BufferAttribute(await binary(md.parts[subsets[i]],Uint32Array),1));
   if(!a.normal)g.computeVertexNormals();
   // Bounds use the drawn subset, not every vertex in a combined/static-batch mesh.
   const bound=new THREE.Box3(),point=new THREE.Vector3();for(const id of g.index.array){point.fromBufferAttribute(a.position,id);bound.expandByPoint(point);}g.boundingBox=bound;g.boundingSphere=bound.getBoundingSphere(new THREE.Sphere());
   const mesh=new THREE.Mesh(g,await material(materialKeys[i]));mesh.name=label;out.push(mesh);
  }
  return out;}
 // Queues the downloads and texture loads that parts()/material() will await, creating no three object (materials,
 // meshes and geometries keep their creation order, which three's draw sort uses), so a loop that builds meshes one
 // after another no longer waits for each file in turn. A failure is left for the later await to report.
 const prefetchBinary=(desc,Type)=>queuePrefetch(()=>binary(desc,Type));
 function prefetchMaterial(key){const m=manifest.materials[key];if(m)for(const slot of legacyTextureSlots(m))queuePrefetch(()=>slotTexture(slot));}
 function prefetch(meshKey,materialKeys,subsets){const md=manifest.meshes[meshKey];for(const d of [md.position,md.normal,md.uv])prefetchBinary(d,Float32Array);
  for(let i=0;i<subsets.length;i++){const m=manifest.materials[materialKeys[i]];if(engineMaterials.has(m.name))continue;prefetchBinary(md.parts[subsets[i]],Uint32Array);prefetchMaterial(materialKeys[i]);}}
 return {binary,attributes,material,parts,prefetch,prefetchBinary,prefetchMaterial};
}

const SCENE_BASE='/assets/recovered/scene/';
export async function loadSceneManifest(){const response=await fetch(SCENE_BASE+'manifest.json');if(!response.ok)throw Error('Scene export missing; run tools/export_scene.py');return response.json();}
// Queues every mesh buffer and texture the import will await, in the order it builds them (createAssetLoader prefetch:
// no three object is created, so loadOriginalScene keeps its object/material id order). Textures load through the
// current texture source, so main.mjs calls this once the renderer's (KTX2) source is in use; the manifest
// (loadSceneManifest) is requested when the join starts.
export async function prepareOriginalScene(manifestLoad=loadSceneManifest()){
 const manifest=await manifestLoad,assets=createAssetLoader(SCENE_BASE,manifest),later=[],queued=new Set();
 const prefetch=i=>{const key=[i.mesh,i.materials.join(','),i.subsets.join(',')].join('|');if(queued.has(key))return;queued.add(key);assets.prefetch(i.mesh,i.materials,i.subsets);};
 // Placed one by one first (static batches and doors), then one placement per instanced group.
 for(const instance of manifest.instances)if(!instance.staticBatch&&instance.door===undefined)later.push(instance);else prefetch(instance);
 for(const instance of later)prefetch(instance);
 return {manifest,assets};
}

// shadowFlags: quality/manifest.json shadowFlags.scene (renderer m_CastShadows/m_ReceiveShadows that differ from 1/1, by
// GameObject path ID); every other renderer casts and receives unless its shader is alpha blended (sun-shadows.mjs).
// prepared: a prepareOriginalScene() promise already started (one is started here otherwise).
export async function loadOriginalScene(scene,onProgress,{shadowFlags=null,prepared=null}={}) {
 const {manifest,assets}=await (prepared??prepareOriginalScene()),group=new THREE.Group();group.name='Recovered original scene';
 let objectCount=0,partCount=0,instancedDraws=0;const omitted=[],locations=[],groups=new Map();
 const flagsFor=(instance,mesh)=>{const f=shadowFlags?.[String(instance.gameObjectPathID)],d=defaultShadowFlags(mesh.material);return f&&d?{cast:f.cast&&d.cast,receive:f.receive&&d.receive}:(f??d);};
 for(const instance of manifest.instances){
  if(/warehouse|hangar|apartment|bunker/i.test(instance.name))locations.push({name:instance.name,pathID:instance.gameObjectPathID,bounds:instance.worldBounds});
  // Repeated placements of one mesh/material set (e.g. the 7,500 overlay rocks) are drawn instanced.
  if(!instance.staticBatch&&instance.door===undefined){const f=shadowFlags?.[String(instance.gameObjectPathID)],key=[instance.mesh,instance.materials.join(','),instance.subsets.join(','),f?`${f.cast}${f.receive}`:''].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(instance);continue;}
  const container=new THREE.Group();container.name=instance.name;container.matrixAutoUpdate=false;container.matrix.fromArray(instance.matrix);container.userData.sourcePathID=instance.gameObjectPathID;container.userData.layer=instance.layer;container.userData.worldBounds=instance.worldBounds;if(instance.door!==undefined){container.userData.door=instance.door;container.userData.sourceMatrix=container.matrix.clone();}
  for(const mesh of await assets.parts(instance.mesh,instance.materials,instance.subsets,omitted,instance.name)){applyShadowFlags(mesh,flagsFor(instance,mesh));container.add(mesh);partCount++;}
  if(container.children.length){group.add(container);objectCount++;}
  if(objectCount%40===0)onProgress?.(objectCount,manifest.instances.length);
 }
 const matrix=new THREE.Matrix4();
 for(const list of groups.values()){
  const first=list[0],parts=await assets.parts(first.mesh,first.materials,first.subsets,omitted,first.name);
  if(list.length===1){const container=new THREE.Group();container.name=first.name;container.matrixAutoUpdate=false;container.matrix.fromArray(first.matrix);container.userData.sourcePathID=first.gameObjectPathID;container.userData.layer=first.layer;container.userData.worldBounds=first.worldBounds;for(const mesh of parts){applyShadowFlags(mesh,flagsFor(first,mesh));container.add(mesh);}if(parts.length){group.add(container);objectCount++;partCount+=parts.length;}continue;}
  // One batch per 500 m cell: a batch's bounding sphere covers all its instances, so a single island-wide batch
  // could never be frustum culled (Unity culls each original renderer individually).
  const cells=new Map();for(const instance of list){const [lo,hi]=instance.worldBounds,key=Math.floor((lo[0]+hi[0])/1000)+","+Math.floor((lo[2]+hi[2])/1000);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(instance);}
  for(const part of parts)for(const cell of cells.values()){const mesh=new THREE.InstancedMesh(part.geometry,part.material,cell.length);mesh.name=first.name;mesh.userData.layer=first.layer;mesh.userData.instanceBounds=cell.map(i=>i.worldBounds);applyShadowFlags(mesh,flagsFor(first,mesh));cell.forEach((instance,i)=>mesh.setMatrixAt(i,matrix.fromArray(instance.matrix)));mesh.computeBoundingSphere();group.add(mesh);instancedDraws++;partCount+=cell.length;}
  if(parts.length)objectCount+=list.length;
  onProgress?.(objectCount,manifest.instances.length);
 }
 scene.add(group);return {group,objectCount,partCount,instancedDraws,locations,omitted,manifest,binary:assets.binary,sourceInstances:manifest.instances.length,inactive:manifest.inactive.length};
}
