import {Bone,Euler,Group,Matrix4,PropertyBinding,Quaternion,Vector3} from 'three';
import {LegacyAnimation} from './legacy-animation.mjs';
import {PlayerSampler} from './player-sampler.mjs';
// Held representations on the MalePlayer skeleton (players manifest `player`, deployables manifest `held`/`prefabs`).
const H=new Matrix4().makeScale(1,1,-1);
export const skeletonNodeName=(i,b)=>PropertyBinding.sanitizeNodeName(`${i}_${b.name}`);

export function skeletonBones(def){const bones=def.skeleton.map((b,i)=>{const n=new Bone();n.name=skeletonNodeName(i,b);if(i){n.position.fromArray(b.position);n.quaternion.fromArray(b.rotation);}n.scale.fromArray(b.scale);return n;});
 for(const [i,b]of def.skeleton.entries())if(b.parent>=0)bones[b.parent].add(bones[i]);return bones;}

// The representation root relative to the itemAttachment bone (Socket.LocalSpace.AddChildWithCoords): socket offset and
// rotation, the rep's hand inverse (handMatrix), its root scale, Unity space.
export function heldLocalMatrix(def,prefab,h){const s=def.itemAttachment;if(!s||!prefab||!h?.handMatrix)return null;
 const r=Math.PI/180,q=new Quaternion().setFromEuler(new Euler(s.eulerRotate.x*r,s.eulerRotate.y*r,s.eulerRotate.z*r,'YXZ'));
 return new Matrix4().compose(new Vector3(s.offset.x,s.offset.y,s.offset.z),q,new Vector3(1,1,1)).multiply(new Matrix4().fromArray(h.handMatrix)).multiply(new Matrix4().makeScale(prefab.rootScale.x,prefab.rootScale.y,prefab.rootScale.z)).multiply(H);}

// The holder's own representation (unity-audio.mjs heldRepSource): ItemRepresentation on the owner is hidden
// (worldModels = forceThirdPerson) but stays attached to the local character's animated itemAttachment, where its
// AudioSource plays. A rig outside the scene, posed like a remote view (player-view.mjs update) from the local feet,
// yaw, pitch (browser space, radians), state flags and velocity, without interpolation (the owner's own character is not
// interpolated). update returns the rep root's world matrix (browser space).
export function createHeldRig(def,movement,clipData,prefab,h){const local=heldLocalMatrix(def,prefab,h),bone=def.itemAttachment?.bone;if(!local||!def.skeleton[bone])return null;
 const root=new Group(),bones=skeletonBones(def),sampler=new PlayerSampler(movement),animation=new LegacyAnimation(def.skeleton,clipData),out=new Matrix4(),up=new Vector3(0,1,0);
 root.matrixAutoUpdate=false;root.add(bones[0]);
 return {prefab:h.prefab,update({feet,yaw=0,pitch=0,flags=0,velocity=[0,0,0]},dt=0,time=0){const q=new Quaternion().setFromAxisAngle(up,-yaw);
  root.matrix.copy(H).multiply(new Matrix4().compose(new Vector3(feet[0],feet[1],-feet[2]),q,new Vector3(1,1,1)));
  const v=new Vector3(velocity[0],0,-velocity[2]).applyQuaternion(q.clone().invert());
  animation.apply(bones,sampler.update({x:v.x,z:v.z,flags,group:h.animationGroup??'noitem',pitch},dt,time),dt);root.updateMatrixWorld(true);
  return out.copy(bones[bone].matrixWorld).multiply(local);}};
}
