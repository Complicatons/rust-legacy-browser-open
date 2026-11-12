import * as THREE from '/vendor/three.module.js';
import {placeRemote,sampleRemote} from './player-motion.mjs';
import {interpolationDelay,SEND_RATE} from './airdrops.mjs';
import {PlayerSampler} from './player-sampler.mjs';
import {LegacyAnimation} from './legacy-animation.mjs';
import {armorKeys,censorship} from './armor.mjs';
import {PlayerHitBox} from './player-hitboxes.mjs';
import {RagdollPhysics,RagdollWorld,collidesWithRagdoll} from './ragdoll-physics.mjs';
import {RagdollCorpseBody} from './ragdoll-corpse.mjs';
import {ragdollEnvironment} from './ragdoll-environment.mjs';
import {createHeldRig,heldLocalMatrix,skeletonBones} from './held-rig.mjs';
const H=new THREE.Matrix4().makeScale(1,1,-1);
// localDeath's one sampler step (s): longer than every shipped fade (moveFade*, group/state apply durations ~0.2 s).
export const DEATH_POSE_SETTLE=1;

// Original remote MalePlayer skin and legacy clips. Positions/angles arrive in browser space; bones stay Unity.
export async function createPlayerRenderer(scene,manifest,clipData,assets,{sendRate=SEND_RATE,collisionWorld=null,heldManifest=null,heldTemplates=null,ragdollData=null,physicsEngine=null}={}){
 const def=manifest.player,skins=new Map();
 for(const [key,model] of Object.entries(manifest.armor.models)){const s=model.skin;
  const g=new THREE.BufferGeometry();
  for(const [name,Type,size] of [['position',Float32Array,3],['normal',Float32Array,3],['uv',Float32Array,2],['skinIndex',Uint16Array,4],['skinWeight',Float32Array,4]])g.setAttribute(name,new THREE.BufferAttribute(await assets.binary(s[name],Type),size));
  const indices=[];for(const [i,p]of s.parts.entries()){const a=await assets.binary(p,Uint32Array);g.addGroup(indices.length,a.length,i);for(const n of a)indices.push(n);}g.setIndex(indices);g.computeBoundingSphere();
  skins.set(key,{def:s,geometry:g,materials:await Promise.all(s.materials.map(k=>assets.material(k))),inverses:s.bindposes.map(m=>new THREE.Matrix4().fromArray(m))});
 }
 const clips=new Map();
 for(const [name,c]of Object.entries(clipData)){
  clips.set(name,{duration:c.length,wrapMode:c.wrapMode});
 }
 const views=new Map(),ragdolls=new Set();let deathCamera=null,ragdollWorld=null;
 // Interpolation.BindTiming(20 ms, 1.5, NetCull.sendRate): the delay and NetCull.sendInterval used by the samplers.
 const timing={};const setSendRate=rate=>Object.assign(timing,{sendRate:rate,delay:interpolationDelay(rate),sendInterval:rate>0?1/rate:0});setSendRate(sendRate);
 // Every corpse shares one world (corpses collide with each other: layer 27 vs 27); static surroundings use the
 // layer collision matrix row of layer 27.
 const corpseEnvironment=center=>ragdollEnvironment(collisionWorld,center,20,layer=>collidesWithRagdoll(ragdollData?.physics,layer));
 // censor.nudity: ArmorModelRenderer.Censored rebinds every ArmorModelRenderer (FindObjectsOfType), the corpses' too
 // (DeathTransfer.CreateRagdoll gives the ragdoll its own renderer bound to the dead character's models), and
 // SleepingAvatar.RebindAllRenderers the sleepers'.
 censorship.onChange(()=>{for(const v of views.values())equip(v);for(const v of ragdolls)equip(v);});
 function equip(v,uids=v.uids??[]){v.uids=uids;const keys=armorKeys(manifest.armor,uids);if(v.armor?.every((k,i)=>k===keys[i]))return;
  for(const m of v.meshes){scene.remove(m);m.skeleton.dispose();}
  v.armor=keys;v.meshes=keys.map(key=>{const s=skins.get(key),mesh=new THREE.SkinnedMesh(s.geometry,s.materials);mesh.bindMode='detached';mesh.frustumCulled=false;mesh.visible=!v.meshesHidden;
   mesh.bind(new THREE.Skeleton(s.def.bones.map(i=>v.bones[i]),s.inverses.map(m=>m.clone())),new THREE.Matrix4());scene.add(mesh);return mesh;});
 }
 function build(id){
  const root=new THREE.Group();root.name=def.name;root.matrixAutoUpdate=false;
  const bones=skeletonBones(def);root.add(bones[0]);scene.add(root);
  const hitboxes=collisionWorld?(def.hitboxes??[]).map(s=>{const body=new PlayerHitBox(s,id,root.matrix);body.surfaceName=def.name;return collisionWorld.addBody(body);}):[];
  const v={root,bones,meshes:[],animation:new LegacyAnimation(def.skeleton,clipData),hitboxes,snapshots:[],reps:new Map(),held:null,weights:new Map(),pose:[],sampler:new PlayerSampler(manifest.movement),event:null,groupOverride:null,lastOrigin:null,lastTime:0,worldVelocity:[0,0,0]};equip(v);views.set(id,v);return v;
 }
 // goal: a ReadClientMove (an interpolator goal); false for the Create, which only places the character while no goal
 // has arrived (player-motion.mjs placeRemote).
 function upsert(r,time,{goal=true}={}){const v=views.get(r.viewId)??build(r.viewId);const q=new THREE.Quaternion(-r.rotation[0],-r.rotation[1],r.rotation[2],r.rotation[3]),yaw=r.angles?.yaw??-new THREE.Euler().setFromQuaternion(q,'YXZ').y;
  if(r.armor)equip(v,r.armor);
  const s={position:r.position,yaw,pitch:r.angles?.pitch??0,flags:r.stateFlags??0};
  if(!v.snapshots.length){v.root.matrix.copy(H).multiply(new THREE.Matrix4().compose(new THREE.Vector3(s.position[0],s.position[1],-s.position[2]),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-s.yaw),new THREE.Vector3(1,1,1)));v.root.matrixWorldNeedsUpdate=true;}
  placeRemote(v,s,time,{goal});}
 function remove(id){const v=views.get(id);if(!v)return;scene.remove(v.root);for(const m of v.meshes){scene.remove(m);m.skeleton.dispose();}for(const b of v.hitboxes)collisionWorld.removeBody(b);views.delete(id);}
 // DeathTransfer.Client_OnKilledShared at the death RPC's ARRIVAL (before "RAG" is queued): BaseHitBox.collider (the
 // "HB Hit" broadphase capsule) and every child collider (the per-bone hit boxes) are disabled.
 function disableHit(id){const v=views.get(id);if(!v)return false;for(const b of v.hitboxes)collisionWorld?.removeBody(b);v.hitboxes=[];v.hitDisabled=true;return true;}
 function disposeRagdoll(v){scene.remove(v.root);for(const m of v.meshes){scene.remove(m);m.skeleton.dispose();}v.physics.dispose();for(const b of v.corpseBodies??[])collisionWorld?.removeBody(b);v.corpseBodies=[];ragdolls.delete(v);if(deathCamera?.view===v){deathCamera.camera.near=deathCamera.near;deathCamera.camera.updateProjectionMatrix();deathCamera=null;}}
 function ragdoll(id,time,shot=null){const v=views.get(id);if(!v||!ragdollData||!physicsEngine)return false;
  v.root.updateMatrixWorld(true);const names=new Map(def.skeleton.map((b,i)=>[b.name,i])),matrices=ragdollData.nodes.map(n=>{const index=names.get(n.name);return index==null?H.clone().multiply(v.root.matrixWorld):H.clone().multiply(v.bones[index].matrixWorld);});
  ragdollWorld??=new RagdollWorld(physicsEngine,ragdollData.physics);
  const physics=new RagdollPhysics(physicsEngine,ragdollData,matrices,{world:ragdollWorld});
  physics.setEnvironment(corpseEnvironment(new THREE.Vector3().setFromMatrixPosition(v.root.matrixWorld)));
  const corpseBodies=collisionWorld?ragdollData.bodies.map((b,i)=>collisionWorld.addBody(new RagdollCorpseBody(b,i,physics).follow(physics.matrices()[i]))):[];
  if(shot){const hit=def.hitboxes.find(h=>h.bodyPart===shot.bodyPart);if(hit)physics.shot(def.skeleton[hit.bone].name,shot.point,shot.direction);}
  disableHit(id);for(const h of v.reps.values())h.root.removeFromParent();v.reps.clear();v.held=null;views.delete(id);
  Object.assign(v,{physics,corpseBodies,expires:time+80,environmentAt:time,bodyBones:ragdollData.bodies.map(b=>names.get(b.name))});ragdolls.add(v);return true;
 }
 // Several representations can hang on one character (server-held.mjs: an old one stays until its InterpDestroy); the
 // newest attached is the holder's (v.held: InventoryHolder.SetItemRepresentation), whose group the character poses with.
 function attachHeld(id,h){const v=views.get(id);if(!v||!h)return false;const had=v.reps.get(h.rep);if(had){if(v.held!==had){v.held=had;v.groupOverride=null;}return true;}
  const s=def.itemAttachment,t=heldTemplates?.get(h.prefab),local=heldLocalMatrix(def,heldManifest?.prefabs[h.prefab],h);if(!local||!t||!v.bones[s.bone])return false;
  const root=new THREE.Group();root.matrixAutoUpdate=false;root.matrix.copy(local);
  root.add(t.clone());v.bones[s.bone].add(root);const entry={...h,root};v.reps.set(h.rep,entry);v.held=entry;v.groupOverride=null;return true;
 }
 // Object.Destroy of one representation; InventoryHolder.ClearItemRepresentation only clears the holder's own.
 function detachHeld(id,rep){const v=views.get(id),h=v?.reps.get(rep);if(!h)return false;h.root.removeFromParent();v.reps.delete(rep);if(v.held===h){v.held=null;v.groupOverride=null;}return true;}
 // One representation per character (offline/tools): null removes them all.
 function setHeld(id,h){const v=views.get(id);if(!v)return false;if(v.held&&v.held.rep===h?.rep)return true;for(const rep of [...v.reps.keys()])if(rep!==h?.rep)detachHeld(id,rep);v.groupOverride=null;return h?attachHeld(id,h):true;}
 // The holder's own (hidden) representation on a rig outside the scene (held-rig.mjs): its AudioSource's position.
 const heldRig=h=>createHeldRig(def,manifest.movement,clipData,heldManifest?.prefabs[h?.prefab],h);
 // MalePlayer "HB Hit" (skeleton node 4, layer 17): HitBoxSystem's CapsuleCollider, radius 1, height 2.5, Y axis, centre
 // (0, 1, 0). Physics.OverlapSphere(center, radius, layer 17) against the remote players' capsules: the first view hit
 // returns one of its hit-box bodies (they carry the view's NetEntityID and surface).
 const hbA=new THREE.Vector3(),hbB=new THREE.Vector3(),hbP=new THREE.Vector3(),hbSeg=new THREE.Line3();
 function hitBroadphase(center,radius){for(const [id,v] of views){if(String(id).startsWith('local:')||!v.hitboxes?.length)continue;const m=v.bones[4]?.matrixWorld;if(!m)continue;
   hbSeg.set(hbA.set(0,0.75,0).applyMatrix4(m),hbB.set(0,1.25,0).applyMatrix4(m));const r=1*m.getMaxScaleOnAxis();if(hbSeg.closestPointToPoint(center,true,hbP).distanceTo(center)<=r+radius)return v.hitboxes[0];}
  return null;}
 // CharacterStateInterpolator.Syncronize at Interpolation.time (server time - totalDelay); snapshot times are the
 // ReadClientMove timestamps on the page clock.
 function poseView(v,time,dt){
   const s=sampleRemote(v,time-timing.delay,{sendInterval:timing.sendInterval});if(!s)return;const p=new THREE.Vector3(s.position[0],s.position[1],-s.position[2]);v.flags=s.flags;
   const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-s.yaw);
   v.root.matrix.copy(H).multiply(new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1)));v.root.matrixWorldNeedsUpdate=true;
   // Default/Once event clips stop (and disable) when their time reaches the clip length.
   const eventTime=v.event&&v.event.offset+(time-v.event.start)*v.event.speed;if(v.event&&!(eventTime<clips.get(v.event.name).duration))v.event=null;
   // CalculateVelocity: origin difference since the previous update, in the current root's local space.
   const world=v.lastOrigin&&time>v.lastTime?s.position.map((x,i)=>(x-v.lastOrigin[i])/(time-v.lastTime)):v.lastOrigin?v.worldVelocity:[0,0,0];v.lastOrigin=[...s.position];v.lastTime=time;v.worldVelocity=world;
   const velocity=new THREE.Vector3(world[0],0,-world[2]).applyQuaternion(q.clone().invert()),input={x:velocity.x,z:velocity.z,flags:s.flags,group:v.groupOverride??v.held?.animationGroup??'noitem',pitch:s.pitch??0};v.pose=v.sampler.update(input,dt,time);
   if(v.event)v.pose.push({name:v.event.name,role:'event',weight:1,additive:true,layer:1,time:eventTime});
   v.weights=new Map(v.pose.map(a=>[(a.additive?'+':'')+a.name,a.weight]));
   v.animation.apply(v.bones,v.pose,dt);v.root.updateMatrixWorld(true);
   for(const b of v.hitboxes)b.setMotion(v.bones[b.shape.bone].matrixWorld);
 }
 return {views,ragdolls,upsert,remove,setHeld,attachHeld,detachHeld,disableHit,heldRig,ragdoll,hitBroadphase,timing,setSendRate,
  // DeathTransfer.CreateRagdoll links the LIVE animated pose (RagdollHelper.RecursiveLinkTransformsByName). The local
  // character's own PlayerAnimation pose is rebuilt here from its state flags, held group, pitch and velocity
  // (`pose`), sampled once with a settling step so the fade weights stand where a running character's would.
  localDeath(snapshot,time,shot,camera,pose={}){if(deathCamera)return false;const id='local:'+snapshot.viewId;
   upsert({...snapshot,viewId:id,stateFlags:pose.flags??snapshot.stateFlags},time);const v=views.get(id);v.groupOverride=pose.group??null;
   if(pose.velocity){v.lastOrigin=[...snapshot.position];v.lastTime=time;v.worldVelocity=[...pose.velocity];}
   poseView(v,time,DEATH_POSE_SETTLE);if(!ragdoll(id,time,shot)){remove(id);return false;}
   const head=def.hitboxes.find(h=>h.bodyPart===9)?.bone??def.skeleton.findIndex(b=>b.name==='RustPlayer_Head1');
   v.meshesHidden=true;for(const mesh of v.meshes)mesh.visible=false;
   if(camera&&head>=0){camera.updateMatrixWorld();deathCamera={view:v,head,camera,local:v.bones[head].matrixWorld.clone().invert().multiply(camera.matrixWorld),near:camera.near};}
   return true;
  },
  resetDeathCamera(camera){if(deathCamera&&camera){camera.near=deathCamera.near;camera.updateProjectionMatrix();}deathCamera=null;},
  applyDeathCamera(camera){if(!deathCamera)return false;const matrix=deathCamera.view.bones[deathCamera.head].matrixWorld.clone().multiply(deathCamera.local);matrix.decompose(camera.position,camera.quaternion,new THREE.Vector3());camera.near=.02;camera.updateProjectionMatrix();camera.updateMatrixWorld();return true;},
  sleepRagdoll(id,matrix,uids,time){if(!ragdollData?.poses.sleep||!physicsEngine)return false;const key='sleep:'+id,v=build(key);equip(v,uids);v.root.matrix.copy(matrix).multiply(H);v.root.matrixWorldNeedsUpdate=true;
   const pose=ragdollData.poses.sleep,animation=new LegacyAnimation(ragdollData.nodes,ragdollData.animations),values=animation.sample([{name:pose.clip,time:pose.time,weight:1}],0),byName=new Map(ragdollData.nodes.map((n,i)=>[n.name,values[i]]));
   for(let i=1;i<v.bones.length;i++){const p=byName.get(def.skeleton[i].name);if(p){v.bones[i].position.fromArray(p.position);v.bones[i].quaternion.fromArray(p.rotation);v.bones[i].scale.fromArray(p.scale);}}
   return ragdoll(key,time);
  },
  // TimedGrenade.OnDone on the corpses (layer 27): AddExplosionForce(500, rigidbody.position, explosionRadius, 2) (Unity space).
  explosionForce(positionU,radius,force=500,upwardsModifier=2){let n=0;for(const v of ragdolls)n+=v.physics.explosionForce(force,positionU,radius,upwardsModifier);return n;},
  setHeldStatus(id,lit,rep){const v=views.get(id),h=rep!=null?v?.reps.get(rep):v?.held;if(h)h.lit=lit;},
  // The muzzle of representation `rep` (default: the holder's).
  heldMuzzle(id,rep){const v=views.get(id),h=rep!=null?v?.reps.get(rep):v?.held;if(!h?.muzzleMatrix)return null;return h.root.matrixWorld.clone().multiply(H).multiply(new THREE.Matrix4().fromArray(h.muzzleMatrix)).multiply(H);},
  // MeleeWeaponDataBlock.StartSwingWorldAnimations (remote DoAction3): override the world group when the swinging
  // group differs, then PlayWorldAnimation(Attack, worldSwingAnimationSpeed). EndSwingWorldAnimations (remote
  // DoAction1) only removes the override; the attack state itself plays to its end.
  // `rep`: the swinging representation (default the holder's). Its OverrideAnimationGroupName re-sets it as the holder's
  // (InventoryHolder.ClearItemRepresentation + SetItemRepresentation), so an old representation's queued swing takes over.
  melee(id,data,type,time,rep){const v=views.get(id),h=rep!=null?v?.reps.get(rep):v?.held;if(!h)return false;const swinging=data._swingingMovementAnimationGroupName,overrides=Boolean(swinging)&&swinging!==h.animationGroup;
   if(type==='hit'){if(overrides){v.held=h;v.groupOverride=null;}return true;}
   if(overrides){v.held=h;v.groupOverride=swinging;}return this.playEvent(id,'attack',data.worldSwingAnimationSpeed??1,0,time);},
  // PlayerAnimation.PlayAnimation(GroupEvent, speed, animationTime): the event state of the sampler's CURRENT group
  // (chosen at its last update, before any override just applied), additive on layer 1 at weight 1. A negative
  // animationTime is seconds, otherwise normalised time; PlayMode.StopSameLayer replaces the previous event state.
  // Only MeleeWeaponDataBlock calls it (Attack); no shipped group defines a Reload or ReadyAttack clip.
  playEvent(id,event,speed=1,animationTime=0,time=0){const v=views.get(id);if(!v)return false;const name=v.sampler.groupEvent(event),c=name&&clips.get(name);if(!c)return false;
   const offset=animationTime<0?-animationTime:animationTime*c.duration;v.event={event,name,start:time,speed,offset};return true;},
  setEquipment(id,uids){const v=views.get(id);if(v)equip(v,uids);},clear(){for(const id of [...views.keys()])remove(id);for(const v of [...ragdolls])disposeRagdoll(v);},
  update(time,dt){for(const v of views.values())poseView(v,time,dt);
   for(const v of [...ragdolls])if(time>=v.expires)disposeRagdoll(v);
   if(ragdolls.size)ragdollWorld?.update(dt);
   for(const v of ragdolls){
    // A sleeping corpse keeps its static patch: replacing it would wake the island every second.
    if(time-v.environmentAt>=1&&!v.physics.bodies.every(b=>b.isSleeping())){const p=v.physics.bodies[0].translation();v.physics.setEnvironment(corpseEnvironment(new THREE.Vector3(p.x,p.y,-p.z)));v.environmentAt=time;}
    const matrices=v.physics.matrices();v.corpseBodies.forEach((b,i)=>b.follow(matrices[i]));const byBone=new Map(v.bodyBones.map((b,i)=>[b,matrices[i]]));
    for(let i=1;i<v.bones.length;i++){const bone=v.bones[i],m=byBone.get(i);if(m){const local=bone.parent.matrixWorld.clone().invert().multiply(H).multiply(m);local.decompose(bone.position,bone.quaternion,bone.scale);}bone.updateMatrixWorld(true);}
   }
  },
  ragdollDebug(){return [...ragdolls].map(v=>({bodies:v.physics.bodies.length,joints:v.physics.joints.length,corpseBodies:v.corpseBodies.length,sleeping:v.physics.bodies.every(b=>b.isSleeping()),limits:v.physics.limits.map((l,i)=>{const s=v.physics.swing(i);return {name:s.name,twist:s.twist,low:s.low,high:s.high,cone:s.cone};}),skins:v.meshes.length,expires:v.expires,positions:v.physics.bodies.map(b=>{const p=b.translation();return [p.x,p.y,-p.z];})}));},
  debug(){return [...views].map(([id,v])=>({id,name:def.name,skins:v.meshes.length,bones:v.bones.length,reps:[...v.reps.keys()],hitDisabled:Boolean(v.hitDisabled),held:v.held&&{rep:v.held.rep,item:v.held.item,parts:v.held.root.children[0].children.length,position:new THREE.Vector3().setFromMatrixPosition(v.held.root.matrixWorld).toArray()},hitboxes:v.hitboxes.map(b=>({part:b.bodyPart,center:b.box.getCenter(new THREE.Vector3()).toArray()})),armor:v.armor.map(k=>manifest.armor.models[k].name),pose:v.pose.map(a=>a.name),event:v.event&&{event:v.event.event,name:v.event.name},groupOverride:v.groupOverride,weights:[...v.weights].filter(([,w])=>w>0.01),sampler:v.sampler.debug(),position:new THREE.Vector3().setFromMatrixPosition(v.root.matrix).toArray()}));}
 };
}
