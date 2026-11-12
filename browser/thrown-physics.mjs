import {Matrix4,Quaternion,Vector3} from 'three';
import {RagdollPhysics} from './ragdoll-physics.mjs';
import {ragdollEnvironment} from './ragdoll-environment.mjs';
// Offline thrown objects as rigid bodies (the page is the server): F1 Grenade (TimedGrenade), Supply Signal (SignalGrenade)
// and the thrown flare (FlareObj) are RigidObj prefabs that PhysX simulates on the server. Each one is a single Rapier body
// built from the prefab's own Rigidbody (mass, drag, angular drag, gravity, continuous detection) and collider (sphere or
// capsule, centre and size times the root scale) with its PhysicMaterial and combine rules, against the static world
// around it (ragdoll-environment.mjs, the Unity 4 default material: friction 0.6, bounce 0), in the recovered
// PhysicsManager settings (gravity, 0.02 s step, solver iterations, max angular velocity). Unity space throughout.
// Rapier is not PhysX: contact and friction details (and PhysX's 2 m/s bounceThreshold, which Rapier lacks) differ.
// TimedGrenade / SignalGrenade.OnCollisionEnter: a ClientBounce (bounce sound) when relativeVelocity.sqrMagnitude > 0.0225,
// at most once per 0.25 s (lastBounceTime is set even when the hit is too soft).
export const BOUNCE={minSqrSpeed:0.0225,interval:0.25};
const DEBRIS=18,TOUCH=0.005;

// Quaternion.LookRotation(Vector3.up): Euler(-90, 0, 0) (HandGrenadeDataBlock.ThrowItem, TorchItemDataBlock.ThrowFlare).
export const LOOK_UP=Object.freeze(new Quaternion(-Math.SQRT1_2,0,0,Math.SQRT1_2));

// Does the Debris layer (18, every thrown prefab) collide with `layer`? Layer collision matrix row 18.
export function debrisCollides(physics,layer=0){const m=physics?.layerCollisionMatrix;if(!m)return ![11,16,17,18,21,26,27].includes(layer);return Boolean((m[DEBRIS]>>>layer)&1);}

// The RagdollPhysics definition of a thrown prefab (deployables manifest): one body at the root.
export function thrownDefinition(prefab,physics=null){const rb=prefab.components?.Rigidbody?.[0]?.data,s=prefab.rootScale??{x:1,y:1,z:1};
 if(!rb)throw Error('Thrown prefab without a Rigidbody: '+prefab.name);
 const k=Math.max(s.x,s.y,s.z);if(Math.abs(s.x-s.y)>1e-6||Math.abs(s.x-s.z)>1e-6)throw Error('Nonuniform thrown prefab scale');
 // The export stores centres in browser space (z negated); RagdollPhysics wants Unity collider fields.
 const colliders=(prefab.colliders??[]).filter(c=>c.node===0&&!c.trigger&&(c.type==='SphereCollider'||c.type==='CapsuleCollider')).map(c=>({type:c.type,material:c.physicMaterial??null,
  data:{m_IsTrigger:false,m_Enabled:true,m_Center:{x:c.center[0]*k,y:c.center[1]*k,z:-c.center[2]*k},m_Radius:c.radius*k,...(c.type==='CapsuleCollider'?{m_Height:c.height*k,m_Direction:c.direction}:{})}}));
 if(!colliders.length)throw Error('Thrown prefab without a collider: '+prefab.name);
 const n={name:prefab.name,parent:-1,position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
 return {physics:physics??undefined,nodes:[n],bodies:[{bone:0,name:n.name,data:rb,colliders}],joints:[],scale:new Vector3(s.x,s.y,s.z)};}

export class ThrownBody{
 // R: Rapier; world: the port's collision world (static triangles + terrain) in browser space; physics: PhysicsManager data.
 constructor(R,prefab,{position,rotation=LOOK_UP,velocity,world=null,physics=null,environment=null}){
  this.def=thrownDefinition(prefab,physics);this.prefab=prefab;this.world=world;this.physics=physics;
  this.environmentFn=environment??(p=>ragdollEnvironment(world,new Vector3(p.x,p.y,-p.z),20,layer=>debrisCollides(physics,layer)));
  this.body=new RagdollPhysics(R,this.def,[new Matrix4().compose(position,rotation,new Vector3(1,1,1))]);
  this.rb=this.body.bodies[0];this.rb.setLinvel({x:velocity.x,y:velocity.y,z:velocity.z},true);
  this.step=this.body.step;this.accumulator=0;this.age=0;this.time=0;this.touching=false;this.lastBounceTime=-Infinity;this.bounces=0;this.contacts=0;
  this.environmentAt=null;this.refresh(true);}
 // Rebuilds the static triangles once the body is 5 m from where they were gathered (20 m around it).
 refresh(force=false){const p=this.rb.translation();if(!force&&this.environmentAt&&Math.hypot(p.x-this.environmentAt.x,p.y-this.environmentAt.y,p.z-this.environmentAt.z)<5)return;
  this.body.setEnvironment(this.environmentFn(p));this.environmentAt={x:p.x,y:p.y,z:p.z};}
 get position(){const p=this.rb.translation();return new Vector3(p.x,p.y,p.z);}
 get rotation(){const r=this.rb.rotation();return new Quaternion(r.x,r.y,r.z,r.w);}
 get velocity(){const v=this.rb.linvel();return new Vector3(v.x,v.y,v.z);}
 // Unity-space root matrix with the prefab's root scale.
 matrix(){return new Matrix4().compose(this.position,this.rotation,this.def.scale);}
 touchingWorld(){let touch=false;const s=this.body.staticCollider;if(!s)return false;
  for(const c of this.rb.colliders)this.body.world.contactPair(s,c,m=>{for(let i=0;i<m.numContacts();i++)if(m.contactDist(i)<=TOUCH)touch=true;});
  return touch;}
 // Advances whole fixed steps. Returns the bounces (OnCollisionEnter that passed the cooldown and speed test) this call.
 update(dt){const out=[];this.accumulator+=Math.min(Math.max(dt,0),this.physics?.maximumAllowedTimestep??1/3);this.age+=Math.max(dt,0);
  while(this.accumulator+1e-9>=this.step){this.accumulator-=this.step;this.refresh();const before=this.rb.linvel();this.body.update(this.step);this.time+=this.step;
   const touch=this.touchingWorld();
   if(touch&&!this.touching){this.contacts++;
    if(!(this.time-this.lastBounceTime<BOUNCE.interval)){this.lastBounceTime=this.time;const sq=before.x*before.x+before.y*before.y+before.z*before.z;if(sq>BOUNCE.minSqrSpeed){this.bounces++;out.push({time:this.time,speed:Math.sqrt(sq)});}}}
   this.touching=touch;}
  return out;}
 dispose(){this.body.dispose();}
}

// TimedGrenade / SignalGrenade on a ThrownBody: the fuse (3 s, TimedGrenade.fuseLength as the port's Grenade used) runs
// from the spawn; OnDone explodes 0.3 m above the body (explosionRadius / damage from the prefab; the signal deals none).
export class ThrownGrenade{
 constructor(R,prefab,{position,rotation=LOOK_UP,velocity,world,physics,fuse=3}){const c=prefab.components??{},tg=c.TimedGrenade?.[0]??c.SignalGrenade?.[0];
  this.rigid=new ThrownBody(R,prefab,{position,rotation,velocity,world,physics});this.signal=!c.TimedGrenade&&Boolean(c.SignalGrenade);this.fuse=fuse;this.age=0;this.exploded=false;
  this.explosionRadius=tg?.data?.explosionRadius??0;this.damage=tg?.data?.damage??0;}
 get position(){return this.rigid.position;}
 get bounces(){return this.rigid.bounces;}
 get explosionPoint(){return this.position.add(new Vector3(0,0.3,0));}
 matrix(){return this.rigid.matrix();}
 // Returns {boom, bounces}.
 step(dt){if(this.exploded)return {boom:false,bounces:[]};this.age+=dt;const bounces=this.rigid.update(dt);if(this.age>=this.fuse){this.exploded=true;return {boom:true,bounces};}return {boom:false,bounces};}
 dispose(){this.rigid.dispose();}
}
