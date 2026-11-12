import * as THREE from '/vendor/three.module.js';
import {moveAnimation,deathAnimation,attackAnimation,soundSettings} from './animals.mjs';
import {lookRotationForcedUp} from './resources.mjs';
import {PosRotInterpolator,interpolationDelay,SEND_RATE} from './airdrops.mjs';
// Client-side wildlife presentation: original skinned meshes and legacy clips, network-style interpolation.
// Skeletons stay in Unity space under a root carrying H * TRS (H = Z reflection), so bindposes/curves are unchanged.
const H=new THREE.Matrix4().makeScale(1,1,-1);
const nodeName=(i,bone)=>THREE.PropertyBinding.sanitizeNodeName(`${i}_${bone.name}`);

// Queues every download and texture createAnimalRenderer awaits (createAssetLoader prefetch), creating no three object.
// main.mjs calls it early in the join with the same loader; createAnimalRenderer's own call then finds the pending loads.
export function prefetchAnimalAssets(manifest,assets){if(!assets.prefetchMaterial)return;
 for(const def of Object.values(manifest.animals)){for(const s of def.skins){for(const [d,T] of [[s.position,Float32Array],[s.normal,Float32Array],[s.uv,Float32Array],[s.skinIndex,Uint16Array],[s.skinWeight,Float32Array],...s.parts.map(p=>[p,Uint32Array])])assets.prefetchBinary(d,T);s.materials.forEach(assets.prefetchMaterial);}
  for(const v of Object.values(def.materialVariants??{}))[v].flat().forEach(assets.prefetchMaterial);}}
export async function createAnimalRenderer(scene,manifest,clipData,assets,{rng=Math.random,viewDistance=250,sendRate=SEND_RATE,playSound}={}){
 const species=new Map();
 // Interpolation.BindTiming(20 ms, 1.5, NetCull.sendRate): TransformInterpolator samples at server time - delay.
 const timing={};const setSendRate=rate=>Object.assign(timing,{sendRate:rate,delay:interpolationDelay(rate),sendInterval:rate>0?1/rate:0});setSendRate(sendRate);
 // Downloads and textures are queued ahead (prefetchAnimalAssets); geometries and materials are still made in order below.
 prefetchAnimalAssets(manifest,assets);
 for(const [key,def] of Object.entries(manifest.animals)){
  const skins=[];
  for(const s of def.skins){
   const g=new THREE.BufferGeometry();
   g.setAttribute('position',new THREE.BufferAttribute(await assets.binary(s.position,Float32Array),3));
   g.setAttribute('normal',new THREE.BufferAttribute(await assets.binary(s.normal,Float32Array),3));
   g.setAttribute('uv',new THREE.BufferAttribute(await assets.binary(s.uv,Float32Array),2));
   g.setAttribute('skinIndex',new THREE.BufferAttribute(await assets.binary(s.skinIndex,Uint16Array),4));
   g.setAttribute('skinWeight',new THREE.BufferAttribute(await assets.binary(s.skinWeight,Float32Array),4));
   const indices=[];for(const [i,part] of s.parts.entries()){const ids=await assets.binary(part,Uint32Array);g.addGroup(indices.length,ids.length,i);indices.push(...ids);}
   g.setIndex(indices);g.computeBoundingSphere();
   skins.push({def:s,geometry:g,materials:await Promise.all(s.materials.map(k=>assets.material(k))),inverses:s.bindposes.map(m=>new THREE.Matrix4().fromArray(m))});
  }
  const variants={};for(const [k,v] of Object.entries(def.materialVariants??{}))if(typeof v==='string')variants[k]=await assets.material(v);else for(const m of v)variants[m]=await assets.material(m);
  // Legacy clips: 30 Hz keys sampled linearly; tracks bind to bones by index-qualified name.
  const clips=new Map();
  for(const name of def.clips){const data=clipData[`${key}:${name}`];if(!data)continue;const tracks=[];
   for(const t of data.tracks){const bone=def.skeleton[t.bone];if(t.bone===0)continue;const n=nodeName(t.bone,bone);
    if(t.rotation)tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`,t.rotation.times,t.rotation.values));
    if(t.position)tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`,t.position.times,t.position.values));
    if(t.scale)tracks.push(new THREE.VectorKeyframeTrack(`${n}.scale`,t.scale.times,t.scale.values));}
   clips.set(name,new THREE.AnimationClip(name,data.length,tracks));}
  species.set(key,{def,skins,variants,clips});
 }
 const views=new Map(),toUnity=v=>new THREE.Vector3(v.x,v.y,-v.z);

 function build(animal){
  const sp=species.get(animal.key),def=sp.def,root=new THREE.Group();root.matrixAutoUpdate=false;root.name=def.name;
  const bones=def.skeleton.map((b,i)=>{const bone=new THREE.Bone();bone.name=nodeName(i,b);if(i>0){bone.position.fromArray(b.position);bone.quaternion.fromArray(b.rotation);}bone.scale.fromArray(b.scale);return bone;});
  def.skeleton.forEach((b,i)=>{if(b.parent>=0)bones[b.parent].add(bones[i]);});root.add(bones[0]);scene.add(root);
  const meshes=sp.skins.map(s=>{
   let materials=s.materials;if(animal.material){const v=sp.variants[animal.material];if(v)materials=materials.map(()=>v);}
   const mesh=new THREE.SkinnedMesh(s.geometry,materials.length===1?materials[0]:materials);mesh.bindMode='detached';mesh.frustumCulled=false;mesh.name=def.name;
   mesh.bind(new THREE.Skeleton(s.def.bones.map(i=>bones[i]),s.inverses.map(m=>m.clone())),new THREE.Matrix4());scene.add(mesh);return mesh;});
  const mixer=new THREE.AnimationMixer(root),actions=new Map();for(const [name,clip] of sp.clips)actions.set(name,mixer.clipAction(clip));
  const view={animal,root,meshes,mixer,actions,current:null,lastMoveAnim:null,snapshots:[],dead:false};views.set(animal,view);return view;
 }
 function dispose(view){scene.remove(view.root);for(const m of view.meshes){scene.remove(m);m.skeleton.dispose();}view.mixer.stopAllAction();views.delete(view.animal);}
 function play(view,name,{fade=0.25,speed=1,once=false,clamp=false}={}){
  const action=view.actions.get(name);if(!action)return;action.timeScale=speed;
  // Unity CrossFade leaves a clip that is still playing alone; a Once clip that has ended (stopped) starts again.
  if(view.current===name){if((once||clamp)&&!action.isRunning()){action.reset();action.play();}return;}const prev=view.current&&view.actions.get(view.current);
  action.reset();action.setLoop(once||clamp?THREE.LoopOnce:THREE.LoopRepeat,Infinity);action.clampWhenFinished=clamp;action.play();
  if(prev)prev.crossFadeTo(action,fade,false);view.current=name;
 }
 return {
  timing,setSendRate,
  views,
  // One skinned mesh per species skin and material variant, for compiling shaders and uploading textures during
  // loading; otherwise the first animal to come into view stalls a frame for over a second. Never added to the scene.
  templates(){const out=[];for(const sp of species.values()){const variants=[null,...new Set(Object.values(sp.variants))];
   for(const s of sp.skins)for(const v of variants){const bone=new THREE.Bone(),mesh=new THREE.SkinnedMesh(s.geometry,v?s.materials.map(()=>v):s.materials.length===1?s.materials[0]:s.materials);mesh.add(bone);mesh.bind(new THREE.Skeleton([bone],[new THREE.Matrix4()]));mesh.frustumCulled=false;out.push(mesh);}}
   return out;},
  // WildlifeWorld emit hook: network snapshots, sounds, attack and death presentation.
  event(animal,type,data,time){
   let view=views.get(animal);
   // `data.rotation`: the rotation as the wire carries it (Angle2, no roll) when the caller has it apart from the animal's.
   if(type==='network'){const p=animal.position.clone();let q=(data?.rotation??animal.rotation).clone();
    // NavMeshMovement.ProcessNetworkUpdate tilts nav agents to the ground normal by at most 20 degrees.
    if(animal.def.movement.type==='NavMeshMovement'){const g=animal.world.physics.groundInfo(p.clone().add(new THREE.Vector3(0,0.25,0)),10),up=new THREE.Vector3(0,1,0).applyQuaternion(q);let n=g.normal.clone();const angle=up.angleTo(n)*180/Math.PI;if(angle>20)n=up.clone().lerp(n,20/angle).normalize();p.copy(g.pos);q=lookRotationForcedUp(new THREE.Vector3(0,0,1).applyQuaternion(q),n);}
    // BasicWildLifeAI.GetNetworkUpdate -> TransformInterpolator.SetGoals(pos, rot, info.timestamp) (capacity 32,
    // allowDifference 0.1, exterpolate 0 on every shipped animal).
    (animal.interp??=new PosRotInterpolator({sendInterval:timing.sendInterval})).setGoals(p,q,time);return;}
   // BasicWildLifeAI.OnClientDeath: _interp.SetGoals(grounded position, LookRotationForcedUp on the full ground normal,
   // info.timestamp) straight, without the NavMeshMovement 20 degree limit (data = {position, rotation}, Unity space).
   if(type==='goal'){(animal.interp??=new PosRotInterpolator({sendInterval:timing.sendInterval})).setGoals(data.position,data.rotation,time);return;}
   if(!view)return;
   // HostileWildlifeAI.DoClientAttack: CrossFade(attack, 0.1, StopSameLayer), played out (wolf bite 0.8 s, bear attacks
   // 1 s; Default wrap = Once). The move clip comes back only when Update's choice changes (lastMoveAnim), as in WolfAI/BearAI.
   if(type==='attack')play(view,attackAnimation(animal.def,rng),{fade:0.1,clamp:true});
   if(type==='death'){view.dead=true;play(view,deathAnimation(animal.def),{fade:0.2,clamp:true});}
   if(type==='sound'){const s=soundSettings[data];if(!s)return;const list=animal.def.sounds?.[s[0]];if(list?.length)playSound?.(list[randomIndex(list.length)],view.root,s[1],s[2],s[3]);}
  },
  update(animals,camera,time,dt){
   const cam=toUnity(camera.position);
   for(const a of animals){const near=a.position.distanceTo(cam)<viewDistance;let view=views.get(a);
    if(!near){if(view)dispose(view);continue;}if(!view)view=build(a);
    if(a.dead&&!view.dead){view.dead=true;play(view,deathAnimation(a.def),{fade:0.2,clamp:true});}
    // TransformInterpolator.Syncronize at Interpolation.time; GetMoveSpeedForAnim = SampleWorldVelocity(...).magnitude.
    const t=time-timing.delay;let p=a.position,q=a.rotation,speed=0;
    if(a.interp?.length){a.interp.sendInterval=timing.sendInterval;const r=a.interp.sample(t);p=r.position;q=r.rotation;speed=a.interp.sampleWorldVelocity(t)?.length()??0;}
    view.root.matrix.copy(H).multiply(new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1)));view.root.matrixWorldNeedsUpdate=true;view.rotation=q.clone();
    // <Species>AI.Update: CrossFade(move, 0.25, StopSameLayer) only when the clip name changes; the speed is set every frame.
    if(!view.dead){const m=moveAnimation(a.def,speed);if(m.clip!==view.lastMoveAnim)play(view,m.clip,{speed:m.speed});else if(view.actions.get(m.clip))view.actions.get(m.clip).timeScale=m.speed;view.lastMoveAnim=m.clip;}
    view.mixer.update(dt);view.speed=speed;}
   for(const [a,view] of views)if(!animals.has(a))dispose(view);
  },
 };
 function randomIndex(n){return Math.min(n-1,Math.floor(rng()*n));}
}
