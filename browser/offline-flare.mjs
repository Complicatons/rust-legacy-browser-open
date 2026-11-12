import {Matrix4,Quaternion,Vector3} from 'three';
import {Grenade} from './combat.mjs';
import {ThrownBody} from './thrown-physics.mjs';
// Offline (single player) Flare: the client and server halves of TorchItemDataBlock / TorchItem<T> / FlareObj in one place.
// Holding: FlareState (server-throwables.mjs) is TorchItemDataBlock.PrimaryAttack/SecondaryAttack + TorchItem.ItemPreFrame:
// left click strikes ("ignite" animation, lit 0.8 s later with StrikeSound and the FirstPersonLightPrefab on the muzzle socket),
// right click strikes first and throws 1.51 s later, or throws a lit flare after 0.5 s ("throw", then "deploy" queued).
// DoActualThrow extinguishes and consumes one; the server's ThrowFlare spawns WorldFlare_New (FlareObj, a RigidObj with
// StreamInitialVelocity) at eyes + forward * 1 m, LookRotation(Vector3.up), velocity forward * 20; FlareObj instantiates its
// lightPrefab (FlareLight3p) 0.1 m above itself, parented, and the server destroys it after 90 s (Invoke "DestroyTime").
// The held flare has no burn timer (TorchItem has no fuel tick); holstering a lit flare burns it out (OnHolstered consumes one).
export const FLARE_LIFETIME=90,FLARE_THROW_SPEED=20,FLARE_THROW_OFFSET=1,FLARE_LIGHT_OFFSET=0.1;
// Quaternion.LookRotation(Vector3.up) (forward parallel to the default up): Unity falls back to FromToRotation(forward axis, up),
// i.e. Euler(-90, 0, 0). Unity space.
export const LOOK_UP=Object.freeze(new Quaternion(-Math.SQRT1_2,0,0,Math.SQRT1_2));
// TorchItemDataBlock.ThrowFlare(rep, eyesOrigin, eyesForward), Unity space.
export function flareThrow(originU,forwardU){const f=forwardU.clone().normalize();return {position:originU.clone().addScaledVector(f,FLARE_THROW_OFFSET),velocity:f.clone().multiplyScalar(FLARE_THROW_SPEED),rotation:LOOK_UP.clone()};}
// IInventoryItem.Consume(1) + Inventory.RemoveItem(slot) when the stack is used up. Only the slot still in the inventory counts.
export function consumeOne(inv,slot){const i=inv.slots.indexOf(slot);if(i<0||!slot)return false;slot.uses-=1;if(slot.uses<=0)inv.slots[i]=null;return true;}
// TorchItem.OnHolstered (OnSetActive(false)): a lit flare is extinguished, its timers cleared and one consumed.
export function holsterFlare(state){if(!state?.lit)return false;state.lit=false;state.igniteAt=state.throwAt=state.secondaryAt=null;return true;}
// Unity (x, y, z) -> browser (x, y, -z) for a rotation: q -> (-x, -y, z, w).
export const browserQuaternion=q=>new Quaternion(-q.x,-q.y,q.z,q.w);

// The thrown WorldFlare_New. PhysX rigid body: gravity, Rigidbody drag 0.05, angular drag 1, capsule radius 0.04 x root
// scale 2.54 with the prefab's PhysicMaterial (bounciness 0.65, friction 1, both average-combined against the world).
// With a Rapier engine (physics: {engine, world, physics}) it is that rigid body (thrown-physics.mjs). Without one, a
// fallback simulates a sphere of the capsule radius that keeps LookRotation(up) until it first touches something, then
// lies along its horizontal heading.
export class ThrownFlare{
 constructor(prefab,positionU,velocityU,rotationU=LOOK_UP,physics=null){const col=prefab.colliders?.find(c=>c.type==='CapsuleCollider'||c.type==='SphereCollider'),rb=prefab.components?.Rigidbody?.[0]?.data,s=prefab.rootScale??{x:1,y:1,z:1};
  this.prefab=prefab;this.age=0;this.landed=false;this.scale=new Vector3(s.x,s.y,s.z);
  this.rigid=physics?.engine?new ThrownBody(physics.engine,prefab,{position:positionU,rotation:rotationU,velocity:velocityU,world:physics.world,physics:physics.physics}):null;
  this.body=this.rigid??new Grenade(positionU,velocityU,{radius:(col?.radius??0.04)*Math.max(s.x,s.y,s.z),drag:rb?.m_Drag??0.05,bounciness:col?.physicMaterial?.bounciness??0.65,friction:col?.physicMaterial?.dynamicFriction??1,fuse:Infinity,explosionRadius:0,damage:0});
  this.rotation=rotationU.clone();
  // FlareObj: Instantiate(lightPrefab, position + (0, 0.1, 0), identity), then parented: the light keeps that pose relative to the flare.
  this.lightLocal=this.matrix().invert().multiply(new Matrix4().makeTranslation(positionU.x,positionU.y+FLARE_LIGHT_OFFSET,positionU.z));}
 get position(){return this.body.position;}
 get bounces(){return this.body.bounces;}
 dispose(){this.rigid?.dispose();this.rigid=null;}
 // Unity-space world matrix of the flare root.
 matrix(){return new Matrix4().compose(this.body.position,this.rigid?this.rigid.rotation:this.rotation,this.scale);}
 // Unity-space world matrix of the parented light prefab root (its own root scale applied).
 lightMatrix(lightScale={x:1,y:1,z:1}){return this.matrix().multiply(this.lightLocal).multiply(new Matrix4().makeScale(lightScale.x,lightScale.y,lightScale.z));}
 // Returns true once FlareObj.DestroyTime has run (90 s after the spawn).
 step(dt,contact){this.age+=dt;if(this.age>=FLARE_LIFETIME)return true;
  if(this.rigid){this.rigid.update(dt);this.landed||=this.rigid.contacts>0;return false;}
  let touched=false;
  this.body.step(dt,(c,r)=>{const hit=contact(c,r);if(hit)touched=true;return hit;});
  if(touched&&!this.landed){this.landed=true;const v=this.body.velocity,h=Math.hypot(v.x,v.z);const heading=h>1e-4?new Vector3(v.x/h,0,v.z/h):new Vector3(0,0,1);
   this.rotation.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(),heading.clone().negate(),new Vector3(0,1,0)));}
  return false;}
}
