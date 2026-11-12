import {Matrix4,Vector3} from 'three';
import {MovingBody} from './collision.mjs';
const H=new Matrix4().makeScale(1,1,-1);

// Gameplay collision of a corpse (MaleRagdoll, every rigidbody's collider on layer 27 "Ragdoll"):
// - Bullet, melee and arrow masks (406721553) include layer 27, so shots stop at a corpse; its SurfaceInfo is flesh
//   and layer 27 suppresses the generic decal (Tracer/ArrowMovement). Ragdoll carries no TakeDamage: hits do nothing
//   else, and the body has no NetEntityID, so online reports send a plain world point.
// - The layer matrix row 16 (Character Collision) has no bit for 27: players and animals walk through corpses.
// - Tracer/ArrowMovement push a non-kinematic rigidbody with AddForceAtPosition(up * 200) + (ray * 1000).
// One body per ragdoll rigidbody, its colliders in browser-local space (Unity Z mirrored) so triangle winding
// stays front-facing; motion is H * unityBodyMatrix * H.
export class RagdollCorpseBody extends MovingBody{
 constructor(def,index,physics){
  super('MaleRagdoll');this.surfaceName='MaleRagdoll';this.layer=def.layer??27;this.noCollide=true;this.ragdollCorpse=true;this.physics=physics;this.index=index;
  for(const c of def.colliders.filter(c=>c.data.m_Enabled&&!c.data.m_IsTrigger)){const a=c.data,center=[a.m_Center.x,a.m_Center.y,-a.m_Center.z];
   if(c.type==='BoxCollider')this.addBox([a.m_Size.x,a.m_Size.y,a.m_Size.z],center);
   else if(c.type==='CapsuleCollider')this.addCapsule(a.m_Radius,Math.max(a.m_Height,2*a.m_Radius),a.m_Direction,center);
   else if(c.type==='SphereCollider')this.addCapsule(a.m_Radius,2*a.m_Radius,1,center);
  }
 }
 follow(unityMatrix){return this.setMotion(H.clone().multiply(unityMatrix).multiply(H));}
 // Browser-space point and ray direction; forces are converted to Unity space for the physics body.
 rigidImpact(point,direction){const d=new Vector3().copy(direction).normalize();
  return this.physics.force(this.index,[point.x,point.y,-point.z],[d.x*1000,200+d.y*1000,-d.z*1000]);}
}
