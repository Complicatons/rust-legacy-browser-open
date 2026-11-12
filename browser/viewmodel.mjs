import * as THREE from 'three';
import {LegacyAnimation,Mixer,idleSolo} from './animation-blender.mjs';
import {evalCurve} from './particles.mjs';
import {withSocketSway} from './camera-sway.mjs';
import {installMeshMods,modSocket} from './item-mods.mjs';
import {enableEyeShadow} from './legacy-materials.mjs';
// Port of decompiled ViewModel (LateUpdate root pose: hip offset, aim-down-sights via the sight socket, sprint lowering
// via the bowPivot socket, zoom punch, zoomCurve/bowCurve timing), CurveUtility.EvaluateClampedTime and the legacy
// Animation calls items make (Play / CrossFade / PlayQueued). Viewmodels render in their own camera-space pass with the
// prefab's perspective overrides, as CameraFX's "__View Model Root" did. Unity space inside a Z-reflected parent.
const H=new THREE.Matrix4().makeScale(1,1,-1),D=Math.PI/180;
const nodeName=(i,bone)=>THREE.PropertyBinding.sanitizeNodeName(`${i}_${bone.name}`);
// Mathf.DeltaAngle
export const deltaAngle=(a,b)=>{let d=((b-a)%360+360)%360;if(d>180)d-=360;return d;};
// CurveUtility.EvaluateClampedTime: advance the time cursor within the curve's key range, then evaluate.
export function evaluateClampedTime(curve,state,key,advance){const k=curve?.m_Curve??[];if(!k.length)return 1;if(k.length===1)return k[0].value;
 const start=k[0].time,end=k[k.length-1].time;let t=state[key]??0;
 if(advance>0){if(t<end)t=Math.min(end,t+advance);}else if(advance<0){if(t>start)t=Math.max(start,t+advance);}
 state[key]=t;return evalCurve(curve,t);}
// Unity Quaternion.Euler / eulerAngles (ZXY extrinsic == three.js 'YXZ' intrinsic), degrees.
export const unityEuler=(x,y,z)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(x*D,y*D,z*D,'YXZ'));
export const eulerOf=q=>{const e=new THREE.Euler().setFromQuaternion(q,'YXZ');return [e.x/D,e.y/D,e.z/D];};
const v3=o=>Array.isArray(o)?o:[o?.x??0,o?.y??0,o?.z??0];

// A socket's pose in root space ({position, rotation}) from the relative parent-bone matrix (Socket.CameraSpace.preEye*).
export function socketInRoot(relParent,socket){const p=new THREE.Vector3(...socket.offset).applyMatrix4(relParent),q=new THREE.Quaternion(),s=new THREE.Vector3(),t=new THREE.Vector3();relParent.decompose(t,q,s);
 return {position:p,rotation:q.multiply(unityEuler(...socket.eulerRotate))};}

// Mathf.SmoothDamp / SmoothDampAngle / MoveTowardsAngle (Unity 4 UnityEngine.Mathf).
export function smoothDamp(current,target,state,smoothTime,maxSpeed,dt){smoothTime=Math.max(0.0001,smoothTime);const omega=2/smoothTime,x=omega*dt,exp=1/(1+x+0.48*x*x+0.235*x*x*x);
 let change=current-target;const originalTo=target,maxChange=maxSpeed*smoothTime;change=Math.min(maxChange,Math.max(-maxChange,change));target=current-change;
 const temp=(state.velocity+omega*change)*dt;state.velocity=(state.velocity-omega*temp)*exp;let out=target+(change+temp)*exp;
 if(originalTo-current>0===out>originalTo){out=originalTo;state.velocity=dt>0?(out-originalTo)/dt:0;}return out;}
export const smoothDampAngle=(current,target,state,smoothTime,maxSpeed,dt)=>smoothDamp(current,current+deltaAngle(current,target),state,smoothTime,maxSpeed,dt);
export function moveTowardsAngle(current,target,maxDelta){const d=deltaAngle(current,target);if(-maxDelta<d&&d<maxDelta)return target;target=current+d;return current+Math.sign(target-current)*maxDelta;}
const speedOf=v=>v==='Infinity'||v==null?Infinity:Number(v);
// ViewModel.BarrelAim (with SolveTriangleSSA): bends the pose so the barrel, pivoting at barrelPivot (barrelRotation), points at
// the eye-ray hit (Physics2.Raycast2 over aimMask within noHitPlane, else the noHitPlane point). Eye space is Unity space
// (z forward), so the hit is (0, 0, distance). offset: [x,y,z] the pose being bent; barrel: per-pose {once, angle, velocity}.
// extras: barrelAngleSmoothDamp, barrelAngleMaxSpeed, barrelLimitOffsetFactor, barrelLimitPivotFactor, localScale (fx export).
export function barrelAim(settings,extras,offset,barrel,distance,dt){const s=settings,x=extras??{},ls=x.localScale??[1,1,1],pivot=new THREE.Vector3(...v3(s.barrelPivot));
 const point=new THREE.Vector3(0,0,distance),vector=new THREE.Vector3(...offset).add(pivot).multiply(new THREE.Vector3(...ls));
 // Plane through the pivot facing the ray; Ray(point, -point) meets it on the eye axis.
 const toEye=point.clone().negate();let point2=point.clone();if(toEye.lengthSq()>0){toEye.normalize();const denom=toEye.z;if(Math.abs(denom)>1e-12)point2=point.clone().addScaledVector(toEye,(vector.z-point.z)/denom);}
 const ca=point2.distanceTo(vector),bc=point.distanceTo(vector);
 // SolveTriangleSSA(90, bc, ca): angleC = asin(ca / bc); target angle = -(90 - (180 - angleC - 90)).
 const angleC=Math.asin(Math.sin(Math.PI/2)*ca/bc)*180/Math.PI,c=180-angleC-90,target=-(90-c);
 if(Number.isFinite(target)){const sd=x.barrelAngleSmoothDamp??0.01,ms=speedOf(x.barrelAngleMaxSpeed);barrel.velocity??=0;
  if(!barrel.once){barrel.once=true;barrel.angle=target;}
  else if(sd<=0)barrel.angle=ms<=0||ms===Infinity?target:moveTowardsAngle(barrel.angle,target,ms*dt);
  else barrel.angle=smoothDampAngle(barrel.angle,target,barrel,sd,ms<=0?Infinity:ms,dt);}
 const br=v3(s.barrelRotation),q=unityEuler(-br[0],br[1],0);
 // Plane(point, vector, zero).normal; a zero axis gives the identity rotation.
 const axis=new THREE.Vector3().crossVectors(vector.clone().sub(point),point.clone().negate());const q2=q.clone().invert().multiply(axis.lengthSq()>1e-20?new THREE.Quaternion().setFromAxisAngle(axis.normalize(),(barrel.angle??0)*D):new THREE.Quaternion());
 let v2=new THREE.Vector3(...offset),v3p=pivot.clone();const limit=s.barrelLimit??0;
 if(bc<limit){const lof=x.barrelLimitOffsetFactor??1,lpf=x.barrelLimitPivotFactor??0;
  if(lof!==0)v2.sub(new THREE.Vector3(0,0,(limit-bc)*lof).applyQuaternion(q2));if(lpf!==0)v3p.add(new THREE.Vector3(0,0,-(limit-bc)*lpf).applyQuaternion(q));}
 const origin=v3p.clone().negate().applyQuaternion(q2).add(v3p).add(v2);
 return {origin:origin.toArray(),angles:eulerOf(q2).map(a=>deltaAngle(0,a))};}

// ViewModel.LateUpdate offsets. flags: {aim, bow, aimDistance} (bow = bowAllowed && sprinting && moving; aimDistance = eye-ray hit
// distance over aimMask within noHitPlane, else noHitPlane); sockets: root-space poses of sight and bowPivot. extras: fx barrel
// fields. Returns the root's local position/euler (added to its original pose) and the zoom fraction.
export function viewModelPose(def,state,flags,dt,now,sockets,extras=null){const s=def.settings,aim=Boolean(flags.aim),bow=Boolean(s.bowAllowed&&flags.bow);
 const zoomAdvance=dt/(aim?s.zoomInDuration:-s.zoomOutDuration),zoom=evaluateClampedTime(s.zoomCurve,state,'zoomTime',zoomAdvance);
 let bowAdvance=dt/(bow?s.bowEnterDuration:-s.bowExitDuration),bowFrac;
 if(!Number.isFinite(bowAdvance))bowFrac=bow?1:0;
 else {const bc=s.bowCurve?.m_Curve??[];if(s.bowCurveIs01Fraction&&bc.length)bowAdvance*=bc[0].time-bc[bc.length-1].time;bowFrac=evaluateClampedTime(s.bowCurve,state,'bowTime',bowAdvance);}
 // Sight: put the sight on the eye axis looking forward. Root-space inverse of the socket rotation.
 const align=pose=>{if(!pose)return {vector:[0,0,0],angles:[0,0,0]};const inv=pose.rotation.clone().invert(),v=pose.position.clone().negate().applyQuaternion(inv);return {vector:v.toArray(),angles:eulerOf(inv)};};
 let zs=align(sockets.sight),bs=align(sockets.bowPivot),origin=v3(s.offset),angles3=v3(s.rotate);const zo=v3(s.zoomOffset),zr=v3(s.zoomRotate),bo=v3(s.bowOffsetPoint),ba=v3(s.bowOffsetAngles);
 // barrelAiming bends the hip pose (offset/rotate replaced); barrelWhileZoom / barrelWhileBowing bend the sight / bow poses.
 const dist=flags.aimDistance??s.noHitPlane??20,bp=state.barrel??={hip:{},zoom:{},bow:{}};
 if(s.barrelAiming){const r=barrelAim(s,extras,origin,bp.hip,dist,dt);origin=r.origin;angles3=r.angles;}
 if(s.barrelWhileZoom){const r=barrelAim(s,extras,zs.vector,bp.zoom,dist,dt);zs={vector:r.origin,angles:r.angles};}
 if(s.barrelWhileBowing){const r=barrelAim(s,extras,bs.vector,bp.bow,dist,dt);bs={vector:r.origin,angles:r.angles};}
 const n7=1-zoom,punch=evalCurve(s.zoomPunch,now-(state.punchTime??-2000))*(s.punchScalar??1),n9=1-bowFrac;
 const position=[(bs.vector[0]+bo[0])*bowFrac+((zs.vector[0]+zo[0])*zoom+origin[0]*n7)*n9,
  // The original's y term multiplies only the hip part by (1 - bow); kept as decompiled.
  (bs.vector[1]+bo[1])*bowFrac+((zs.vector[1]+zo[1])*zoom+origin[1]*n7*n9),
  (bs.vector[2]+bo[2])*bowFrac+((zs.vector[2]+(zo[2]-punch))*zoom+origin[2]*n7)*n9];
 const euler=[0,1,2].map(i=>deltaAngle(0,((deltaAngle(zr[i],zs.angles[i])+zr[i])*zoom+angles3[i]*n7)*n9+(deltaAngle(ba[i],bs.angles[i])+ba[i])*bowFrac));
 return {position,euler,zoom,bow:bowFrac};}

// The held item is lit by the same scene lights as the world (lights' culling masks include every layer). The view-model pass has
// its own camera-space scene, so nearby world point lights (fires, held torches, muzzle flashes) are mirrored into a fixed pool there
// (fixed light count: no shader recompiles). Picks the lit sources whose range reaches the eye, nearest first; returns view-space data.
export function mirrorPointLights(sources,eyePosition,eyeQuaternion,count){
 const inv=new THREE.Matrix4().compose(eyePosition,eyeQuaternion,new THREE.Vector3(1,1,1)).invert();
 return sources.filter(l=>l&&l.intensity>0&&(!l.distance||l.position.distanceTo(eyePosition)<l.distance))
  .map(l=>({light:l,d:l.position.distanceToSquared(eyePosition)})).sort((a,b)=>a.d-b.d).slice(0,count)
  .map(({light})=>({light,color:light.color,intensity:light.intensity,distance:light.distance,decay:light.decay,position:light.position.clone().applyMatrix4(inv)}));}

export async function createViewModelRenderer(manifest,clipData,assets,{aspect=1,modAssets=null,barrelExtras=null}={}){
 const defs=new Map();
 async function load(key){if(defs.has(key))return defs.get(key);const def=manifest.viewmodels[key];
  const skins=[];for(const s of def.skins){const g=new THREE.BufferGeometry();
   g.setAttribute('position',new THREE.BufferAttribute(await assets.binary(s.position,Float32Array),3));g.setAttribute('normal',new THREE.BufferAttribute(await assets.binary(s.normal,Float32Array),3));
   g.setAttribute('uv',new THREE.BufferAttribute(await assets.binary(s.uv,Float32Array),2));g.setAttribute('skinIndex',new THREE.BufferAttribute(await assets.binary(s.skinIndex,Uint16Array),4));
   g.setAttribute('skinWeight',new THREE.BufferAttribute(await assets.binary(s.skinWeight,Float32Array),4));
   const indices=[];for(const [i,part] of s.parts.entries()){const ids=await assets.binary(part,Uint32Array);g.addGroup(indices.length,ids.length,i);indices.push(...ids);}g.setIndex(indices);g.computeBoundingSphere();
   skins.push({def:s,geometry:g,materials:(await Promise.all(s.materials.map(k=>assets.material(k)))).map(enableEyeShadow),inverses:s.bindposes.map(m=>new THREE.Matrix4().fromArray(m))});}
  const clips=new Map();for(const name of def.clips){const data=clipData[`${key}:${name}`];if(!data)continue;const tracks=[];
   for(const t of data.tracks){if(t.bone===def.root)continue;const n=nodeName(t.bone,def.skeleton[t.bone]);
    if(t.rotation)tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`,t.rotation.times,t.rotation.values));
    if(t.position)tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`,t.position.times,t.position.values));
    if(t.scale)tracks.push(new THREE.VectorKeyframeTrack(`${n}.scale`,t.scale.times,t.scale.values));}
   const c=new THREE.AnimationClip(name,data.length,tracks);c.wrapMode=data.wrapMode;clips.set(name,c);}
  const entry={key,def,skins,clips};defs.set(key,entry);return entry;}
 // CameraFX "__View Model Root": its own scene and camera; the main pass leaves depth cleared for it.
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,aspect,0.1,25),space=new THREE.Group();space.matrixAutoUpdate=false;space.matrix.copy(H);scene.add(space);
 const hemi=new THREE.HemisphereLight(0xffffff,0x444444,1),sun=new THREE.DirectionalLight(0xffffff,1);scene.add(hemi,sun);
 const mirrored=Array.from({length:4},()=>{const l=new THREE.PointLight(0xffffff,0,20,1);scene.add(l);return l;});
 // One spot for lamps whose culling mask includes the View Model layer (a remote player's Flashlight15 spot); always present
 // so the view-model programs keep their light count.
 const mirroredSpot=new THREE.SpotLight(0xffffff,0);mirroredSpot.decay=0;scene.add(mirroredSpot,mirroredSpot.target);
 // CameraFX's V_MUNITY_MATRIX_P: the main camera's perspective after ViewModel.ModifyPerspective (no 25 m far default).
 const laserEye=new THREE.PerspectiveCamera();
 let view=null,wanted=null;
 function build(entry){const def=entry.def;
  // The prefab root keeps its authoring position; CameraFX binds it at the view-model camera origin instead.
  const bones=def.skeleton.map((b,i)=>{const bone=new THREE.Bone();bone.name=nodeName(i,b);if(i>0){bone.position.fromArray(b.position);bone.quaternion.fromArray(b.rotation);}bone.scale.fromArray(b.scale);return bone;});
  def.skeleton.forEach((b,i)=>{if(b.parent>=0)bones[b.parent].add(bones[i]);});space.add(bones[0]);
  const meshes=entry.skins.map(s=>{const mesh=new THREE.SkinnedMesh(s.geometry,s.materials.length===1?s.materials[0]:s.materials);mesh.bindMode='detached';mesh.frustumCulled=false;
   mesh.bind(new THREE.Skeleton(s.def.bones.map(i=>bones[i]),s.inverses.map(m=>m.clone())),new THREE.Matrix4());scene.add(mesh);return mesh;});
  const mixer=new THREE.AnimationMixer(bones[0]),actions=new Map();for(const [name,clip] of entry.clips){const a=mixer.clipAction(clip);
   // Legacy WrapMode: Loop 2, PingPong 4 repeat; Default/Once/ClampForever hold the final pose.
   if(clip.wrapMode===2)a.setLoop(THREE.LoopRepeat,Infinity);else if(clip.wrapMode===4)a.setLoop(THREE.LoopPingPong,Infinity);else {a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;}actions.set(name,a);}
  const root=bones[def.root],origin={position:root.position.clone(),quaternion:root.quaternion.clone()};
  const v={entry,def,bones,meshes,mixer,actions,root,origin,settings:structuredClone(def.settings),sockets:Object.fromEntries(Object.entries(def.sockets).map(([n,s])=>[n,modSocket(s,bones)])),mods:[],state:{zoomTime:0,bowTime:0,punchTime:-2000},current:null,queue:[]};
  // ViewModel.idleMixer: with an idle mixer defined (VM-Revolver) the legacy Animation emulation drives the actions'
  // time and weight; without one the mixer only replays one-shots, which the three.js actions do directly.
  if(def.idleMixer){v.legacy=new LegacyAnimation([...entry.clips.values()].map(c=>({name:c.name,length:c.duration,wrapMode:c.wrapMode})));
   v.blender=new Mixer(v.legacy,def.idleMixer.residual,def.idleMixer.channels.map(field=>({name:field.name,field})));v.lastLook=[0,0];
   for(const a of actions.values()){a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.timeScale=0;}}
  mixer.addEventListener('finished',e=>{if(!v.blender&&v.queue.length&&e.action===v.actions.get(v.current))play(v,v.queue.shift());});
  return v;}
 function dispose(v){for(const rig of v.mods)rig.dispose();for(const m of v.meshes){scene.remove(m);m.skeleton.dispose();}space.remove(v.bones[0]);v.mixer.stopAllAction();}
 // Animation.Play: restart the clip, stopping the others on its layer.
 function play(v,name,{speed=1,fade=0}={}){if(v.blender){const ok=fade>0?v.blender.crossFade(name,{fadeLength:fade,speed}):v.blender.play(name,{speed});if(ok)v.current=name;return ok;}
  const a=v.actions.get(name);if(!a)return false;const prev=v.current&&v.actions.get(v.current);
  a.reset();a.timeScale=speed;a.play();if(prev&&prev!==a){if(fade>0)prev.crossFadeTo(a,fade,false);else prev.stop();}v.current=name;return true;}
 // ViewModel.Update (idleMixer.Update(1, dt)), the legacy Animation sample, then ViewModel.LateUpdate's channel solo.
 function sampleLegacy(v,dt,flags,s){v.blender.update(1,dt);const samples=v.legacy.advance(dt),live=new Set();
  for(const x of samples){if(!(x.weight>0))continue;const a=v.actions.get(x.state.name);if(!a)continue;live.add(a);if(!a.isRunning()){a.play();a.timeScale=0;}a.time=x.time;a.setEffectiveWeight(x.weight);}
  for(const a of v.actions.values())if(!live.has(a)&&a.isRunning())a.stop();
  v.mixer.update(0);v.idleWeights=Object.fromEntries(samples.filter(x=>x.weight>0).map(x=>[x.state.name,+x.weight.toFixed(4)]));
  v.lastLook=idleSolo(v.blender,{grounded:flags.grounded??true,slipping:Boolean(flags.slipping),aim:Boolean(flags.aim),bow:Boolean(s.bowAllowed&&flags.bow),crouch:Boolean(flags.crouch),movement:Boolean(flags.movement)},flags.look??v.lastLook,v.lastLook,dt);}
 function relative(v,boneIndex){if(boneIndex==null)return null;v.bones[0].updateMatrixWorld(true);return v.root.matrixWorld.clone().invert().multiply(v.bones[boneIndex].matrixWorld);}
 return {scene,camera,
  get active(){return view?.entry.key??null;},
  // HeldItem.CreateViewModel: instantiate, PlayDeployAnimation.
  async show(key,{force=false}={}){if(!force&&(view?.entry.key===key||wanted===key))return;wanted=key;if(view){dispose(view);view=null;}if(!key)return;const entry=await load(key);if(wanted!==key)return;if(view)dispose(view);view=build(entry);
   if(view.def.defaultClip&&view.def.playAutomatically)play(view,view.def.defaultClip);play(view,view.def.settings.deployAnimName??'deploy');},
  hide(){wanted=null;if(view){dispose(view);view=null;}},
  play(name,opts){return view?play(view,name,opts):false;},
  crossFade(name,fade=0.3,speed=1){return view?play(view,name,{fade,speed}):false;},
  playQueued(name){if(view?.blender)view.blender.playQueued(name);else if(view)view.queue.push(name);},
  setMods(uids=[]){if(view&&modAssets)installMeshMods(view,uids,modAssets,scene);},
  // ViewModel.PlayFireAnimation: fire clip at fireAnimScaleSpeed and start the zoom punch.
  fire(now){if(!view)return;play(view,view.def.settings.fireAnimName??'fire_1',{speed:view.def.settings.fireAnimScaleSpeed??1});view.state.punchTime=now;},
  reload(){if(view)play(view,view.def.settings.reloadAnimName??'reload');},
  // Per frame: animation, then the LateUpdate root pose; returns the zoom fraction for the main camera FOV.
  update(dt,now,flags,mainCamera,lights){if(!view)return 0;const s=view.settings;
   view.lazyAllowed=!flags.aim&&!(s.bowAllowed&&flags.bow);if(view.blender)sampleLegacy(view,dt,flags,s);else view.mixer.update(dt);view.root.position.copy(view.origin.position);view.root.quaternion.copy(view.origin.quaternion);
   const sock=n=>{const d=view.sockets[n];if(!d?.parent)return null;view.bones[0].updateMatrixWorld(true);return socketInRoot(view.root.matrixWorld.clone().invert().multiply(d.parent.matrixWorld),d);};
   const pose=viewModelPose({settings:s},view.state,flags,dt,now,{sight:sock('sight'),bowPivot:sock('bowPivot')},barrelExtras?.[view.entry.key]??null);view.lastPose=pose;
   const bobAdvance=dt/(flags.aim?s.zoomInDuration:-s.zoomOutDuration);
   view.bobScalars={positionScale:evaluateClampedTime(s.headBobOffsetScale,view.state,'headBobLinearTime',bobAdvance),rotationScale:evaluateClampedTime(s.headBobRotationScale,view.state,'headBobAngularTime',bobAdvance)};
   view.root.position.add(new THREE.Vector3(...pose.position));view.root.quaternion.copy(view.origin.quaternion).multiply(unityEuler(...pose.euler));
   // Perspective overrides (caps: 1 near, 2 far, 4 FOV, 8 aspect).
   camera.near=(s.caps&1)?s.perspectiveNearOverride:mainCamera.near;camera.far=(s.caps&2)?s.perspectiveFarOverride:25;camera.fov=(s.caps&4)?s.perspectiveFOVOverride:mainCamera.fov;camera.aspect=(s.caps&8)?s.perspectiveAspectOverride:mainCamera.aspect;camera.updateProjectionMatrix();
   // Lights follow the world: express the main lights in camera space.
   if(lights){const inv=mainCamera.quaternion.clone().invert();hemi.color.copy(lights.hemi.color);hemi.groundColor.copy(lights.hemi.groundColor);hemi.intensity=lights.hemi.intensity;hemi.position.set(0,1,0).applyQuaternion(inv);
    sun.color.copy(lights.sun.color);sun.intensity=lights.sun.intensity;sun.position.copy(lights.sun.position).normalize().applyQuaternion(inv);}
   return pose.zoom;},
  // Socket.CameraSpace proxies: a socket's world pose for the main camera (eye) from its viewmodel camera-space pose.
  socketCameraMatrix(name){const d=view?.sockets[name];if(!d?.parent)return null;view.bones[0].updateMatrixWorld(true);
   const m=new THREE.Matrix4().copy(d.parent.matrixWorld).multiply(new THREE.Matrix4().compose(new THREE.Vector3(...d.offset),unityEuler(...d.eulerRotate),new THREE.Vector3(1,1,1))).multiply(H);
   // Socket.Instantiate creates a world-space instance: the socket supplies position/rotation, not bone scale.
   const scale=new THREE.Vector3().setFromMatrixScale(m);return m.scale(new THREE.Vector3(1/scale.x,1/scale.y,1/scale.z));},
  // Socket.CameraSpace.rotation, which InstantiateAsChild uses for proxy sockets: rotate * parent.rotation (the socket rotation is
  // applied in the view-model root frame, unlike LocalSpace's parent.rotation * rotate); position = parent.TransformPoint(offset).
  socketInstanceMatrix(name){const d=view?.sockets[name];if(!d?.parent)return null;view.bones[0].updateMatrixWorld(true);
   const parent=new THREE.Matrix4().multiplyMatrices(H,d.parent.matrixWorld),position=new THREE.Vector3(...d.offset).applyMatrix4(parent),q=new THREE.Quaternion();parent.decompose(new THREE.Vector3(),q,new THREE.Vector3());
   return new THREE.Matrix4().multiplyMatrices(H,new THREE.Matrix4().compose(position,unityEuler(...d.eulerRotate).multiply(q),new THREE.Vector3(1,1,1))).multiply(H);},
  socketWorld(name,mainCamera){const m=this.socketCameraMatrix(name);return m?new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(mainCamera.matrixWorld):null;},
  // World point lights (main-camera eye pose) into the view-model pass; returns how many are lit.
  mirrorLights(sources,mainCamera,spots=[]){const live=mirrorPointLights(sources,mainCamera.position,mainCamera.quaternion,mirrored.length);
   mirrored.forEach((l,i)=>{const s=live[i];if(!s){l.intensity=0;return;}l.color.copy(s.color);l.intensity=s.intensity;l.distance=s.distance;l.decay=s.decay;l.position.copy(s.position);});
   const [spot]=mirrorPointLights(spots,mainCamera.position,mainCamera.quaternion,1);mirroredSpot.intensity=0;
   if(spot){const inv=new THREE.Matrix4().compose(mainCamera.position,mainCamera.quaternion,new THREE.Vector3(1,1,1)).invert();mirroredSpot.color.copy(spot.color);mirroredSpot.intensity=spot.intensity;mirroredSpot.distance=spot.distance;mirroredSpot.decay=spot.decay;
    mirroredSpot.angle=spot.light.angle;mirroredSpot.penumbra=spot.light.penumbra;mirroredSpot.position.copy(spot.position);mirroredSpot.target.position.copy(spot.light.target.position).applyMatrix4(inv);mirroredSpot.target.updateMatrixWorld();}
   return live.length+(spot?1:0);},
  // The projection first-person laser shaders draw with (Effects/LaserBeam|LaserDot/First Person), from the current main camera.
  laserProjection(mainCamera){if(!view)return null;const s=view.settings;laserEye.near=(s.caps&1)?s.perspectiveNearOverride:mainCamera.near;laserEye.far=(s.caps&2)?s.perspectiveFarOverride:mainCamera.far;
   laserEye.fov=(s.caps&4)?s.perspectiveFOVOverride:mainCamera.fov;laserEye.aspect=(s.caps&8)?s.perspectiveAspectOverride:mainCamera.aspect;laserEye.updateProjectionMatrix();return laserEye.projectionMatrix;},
  mirroredLights:()=>[...mirrored,mirroredSpot].filter(l=>l.intensity>0).map(l=>({type:l.isSpotLight?'spot':'point',position:l.position.toArray(),intensity:l.intensity,distance:l.distance})),
  lazyState:()=>({angle:view?.def.settings.lazyAngle??0,allow:Boolean(view?.lazyAllowed)}),
  bobState:()=>view?.bobScalars??{positionScale:1,rotationScale:1},
  render(renderer,counter,beforeDraw,bobMatrix){if(!view)return;const auto=renderer.autoClear;try{space.matrix.copy(H);if(bobMatrix)space.matrix.premultiply(bobMatrix);space.updateMatrixWorld(true);renderer.autoClear=false;renderer.clearDepth();withSocketSway(view.bones,view.def.sockets,counter,()=>{beforeDraw?.(camera);renderer.render(scene,camera);});}finally{space.matrix.copy(H);space.updateMatrixWorld(true);renderer.autoClear=auto;}},
  debug(){if(!view)return null;view.bones[0].updateMatrixWorld(true);return view.meshes.map(m=>{const ps=m.skeleton.bones.map(b=>new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));const lo=ps.reduce((a,p)=>a.min(p),new THREE.Vector3(1e9,1e9,1e9)),hi=ps.reduce((a,p)=>a.max(p),new THREE.Vector3(-1e9,-1e9,-1e9));
   const mats=Array.isArray(m.material)?m.material:[m.material];return {name:m.geometry.attributes.position.count+' verts',bonesMin:lo.toArray().map(v=>+v.toFixed(3)),bonesMax:hi.toArray().map(v=>+v.toFixed(3)),materials:mats.map(x=>x&&{type:x.type,visible:x.visible,opacity:x.opacity,transparent:x.transparent,map:Boolean(x.map),side:x.side,name:x.name})};});},
  state:()=>view&&{barrel:view.state.barrel?.hip?.angle??null,barrelPose:view.lastPose?{position:view.lastPose.position,euler:view.lastPose.euler}:null,key:view.entry.key,name:view.def.name,clip:view.current,idleWeights:view.idleWeights??null,zoomTime:view.state.zoomTime,bowTime:view.state.bowTime,punchTime:view.state.punchTime,rootPosition:view.root.position.toArray(),mods:view.mods.map(m=>m.def.name),punchScalar:view.settings.punchScalar,zoomOffsetZ:view.settings.zoomOffset.z},
 };
}
