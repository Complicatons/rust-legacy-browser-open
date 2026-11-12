// Offline-mode coordinator for the server-side rules ported in decay.mjs, locks.mjs and repair.mjs: attaches state to
// placed deployables and structure masters and runs it from the game loop. main.mjs only needs to call onPlaced(),
// touched(), tick() and spikeContacts(); everything here runs in Node tests. Unity space throughout.
// World queries default to structure collider bounds (tests); main.mjs passes `raycast(originU, dirU, range)` over the
// collision world (MeshBatchPhysics.Raycast: terrain, structures, deployables) returning the first hit as
// {structure?, deployed?}, so a door or a decayProtector deployable (Wood_Shelter) counts and anything else blocks.
import {Vector3,Quaternion,Ray} from 'three';
import {DeployableDecay,StructureDecay,envDecayOf,FIRE_DECAY_RESET_RANGE} from './decay.mjs';
import {CodeLock,hasCodeLock} from './locks.mjs';
import {SpikeWall} from './repair.mjs';
import {component} from './deployables.mjs';

const UP=new Vector3(0,1,0),FORWARD=new Vector3(0,0,1);
const T={Pillar:0,Wall:1,Doorway:2,Ceiling:3,Stairs:4,Foundation:5,WindowWall:6,Ramp:7};
const PLAYER_RADIUS=0.4; // a point test widened by the player's capsule radius
// GameObject.CompareTag("Door"): exported prefab tags are Unity tag ids; 20005 is the tag of exactly the door prefabs
// (WoodenDoor, MetalDoor, WoodGate and their corpses).
export const DOOR_TAG=20005;

export class WorldRules {
 constructor({structures,deployables,raycast=null,random=Math.random,structureInterval=1}){
  Object.assign(this,{structures,deployables,random,structureInterval});this.raycast=raycast??((o,d,r)=>this.boundsRaycast(o,d,r));this.lastStructureStep=-Infinity;this.loading=false;}
 // ServerSaveManager.IsLoading: run `fn` (the offline save load) with placement touches off.
 load(fn){const was=this.loading;this.loading=true;try{return fn();}finally{this.loading=was;}}
 // Fallback ray test against structure piece bounds: nearest hit within range.
 boundsRaycast(origin,dir,range){const ray=new Ray(origin,dir.clone().normalize()),p=new Vector3();let best=null,bestD=Infinity;
  for(const c of this.structures.components){if(c.destroyed||c.bounds.containsPoint(origin)||!ray.intersectBox(c.bounds,p))continue; // rays ignore colliders they start inside
  const d=p.distanceTo(origin);if(d<=range&&d<bestD){bestD=d;best={structure:c,distance:d};}}
  return best;}

 // A deployable or structure piece was just placed (or loaded): ownership, code lock, spike wall, decay touch.
 onPlaced(obj,ownerId,now){
  // StructureComponent.OnOwnedByMasterStructure: Touched() unless ServerSaveManager.IsLoading, so a load keeps the saved
  // decay delay (touching here reset every base to its full 48 h+ delay on each page load).
  if(obj.type!==undefined&&obj.master){const d=this.masterDecay(obj.master);if(!this.loading)d.touched();return;}
  if(ownerId!==undefined&&obj.ownerId===undefined)obj.ownerId=String(ownerId);
  if(hasCodeLock(obj.prefab)&&!obj.lock)obj.lock=new CodeLock();
  if(component(obj.prefab,'SpikeWall')&&!obj.spike)obj.spike=SpikeWall.fromPrefab(obj.prefab);
  this.deployableDecay(obj,now);} // placing does not touch the carrier: only BasicDoor.ToggleStateServer calls DeployableObject.Touched
 // DeployableObject.Touched (BasicDoor.ToggleStateServer, after the lock check): refreshes the decay of what carries it.
 touched(obj,now){const carrier=obj.carrier;if(!carrier)return;
  if(carrier.master)this.masterDecay(carrier.master).touched();else this.deployableDecay(carrier,now)?.touch(now);}
 // Building on, repairing or hitting a piece: StructureComponent.Touched → master.
 touchedStructure(c){if(c.master)this.masterDecay(c.master).touched();}

 deployableDecay(o,now){if(o.decay)return o.decay;const e=envDecayOf(o.prefab);if(!e)return null;
  o.decay=new DeployableDecay({maxHealth:o.maxHealth,decayMultiplier:e.decayMultiplier,now,random:this.random});if(o.decayState)o.decay.load(o.decayState);return o.decay;}
 masterDecay(m){if(!m.decay){m.decay=new StructureDecay({materialType:m.materialType});if(m.decayState)m.decay.load(m.decayState);else m.decay.touched();}return m.decay;}

 // EnvDecay.CanApplyDecayDamage: something structural (or a decayProtector deployable) within 10 m straight up.
 sheltered(o){const hit=this.raycast(o.position.clone().add(new Vector3(0,0.25,0)),UP,10);
  if(!hit)return false;if(hit.deployed===o)return false;return Boolean(hit.structure)||Boolean(hit.deployed&&component(hit.deployed.prefab,'DeployableObject')?.decayProtector);}
 // DoDecay wall test: rays forward and back from +2.5 m both hit a structure or a door within 25 m.
 wallSheltered(c){const origin=c.position.clone().add(new Vector3(0,2.5,0)),fwd=FORWARD.clone().applyQuaternion(c.rotation);
  const ok=h=>Boolean(h&&h.structure!==c&&(h.structure||h.deployed?.tag===DOOR_TAG));
  return ok(this.raycast(origin,fwd,25))&&ok(this.raycast(origin,fwd.clone().negate(),25));}
 // StructureMaster.ComponentCarryingWeight: the master's weight links (generated as pieces are appended).
 carryingWeight(c){return Boolean(c.master?.carryingWeight(c));}

 // Game-loop step. Returns {deployableDamage, structureDamage} for logging/tests.
 tick(now){let deployableDamage=0,structureDamage=0;
  const objects=[...this.deployables.objects];
  // FireBarrel/Furnace: a lit fire stops its own decay and keeps everything within 5 m from decaying.
  for(const f of objects){if(!f.fire)continue;const d=this.deployableDecay(f,now);
   if(f.fire.isOn){if(d?.enabled)d.setEnabled(false,now);for(const o of objects)if(o!==f&&o.position.distanceTo(f.position)<=FIRE_DECAY_RESET_RANGE)this.deployableDecay(o,now)?.touch(now);}
   else if(d&&!d.enabled)d.setEnabled(true,now);}
  for(const o of objects){if(o.destroyed)continue;const d=this.deployableDecay(o,now);if(!d)continue;
   const dmg=d.think(now,{carried:Boolean(o.carrier),sheltered:()=>this.sheltered(o)});if(dmg>0){deployableDamage+=dmg;o.hurt(dmg);}} // EnvDecay: TakeDamage.HurtSelf(this, float) = health points, no armour
  if(now-this.lastStructureStep>=this.structureInterval){this.lastStructureStep=now;
   for(const m of [...this.structures.masters]){const parts=[...m.components];if(!parts.length)continue;
    const r=this.masterDecay(m).step(now,parts,{random:this.random,sheltered:c=>this.wallSheltered(c),carryingWeight:c=>this.carryingWeight(c)});
    for(const h of r.hits){if(h.component.destroyed)continue;structureDamage+=h.damage;h.component.hurt(h.damage);}}}
  return {deployableDamage,structureDamage};}

 // SpikeWall triggers: returns [{target, damage}] for characters (Unity-space positions) inside spike triggers.
 spikeContacts(now,characters){const hits=[];
  for(const o of this.deployables.objects){if(!o.spike||o.destroyed)continue;const inv=o.rotation.clone().invert();
   for(const ch of characters){const local=ch.position.clone().sub(o.position).applyQuaternion(inv);const inside=spikeTriggerContains(o.prefab,local);
    if(inside&&!o.spike.touching.has(ch))o.spike.enter(ch,now);else if(!inside&&o.spike.touching.has(ch))o.spike.exit(ch);}
   for(const h of o.spike.update(now,t=>t.alive!==false))hits.push({...h,wall:o});}
  return hits;}
}

// The prefab's trigger collider on the root node: a box, a sphere or a capsule. CapsuleCollider: `direction` 0/1/2 is the
// X/Y/Z axis, the segment between the end-cap centres is height − 2r long (none when height ≤ 2r). WoodSpikeWall's is
// r 1.25, height 5.5 along X: a 3 m segment, so the trigger reaches 2.75 m to each side.
export function spikeTriggerContains(prefab,local){const s=prefab.rootScale??{x:1,y:1,z:1};
 for(const c of prefab.colliders??[]){if(!c.trigger||c.node!==0)continue;const p=new Vector3(local.x/s.x,local.y/s.y,local.z/s.z);
  if(c.type==='BoxCollider'){const [cx,cy,cz]=c.center,[sx,sy,sz]=c.size;if(Math.abs(p.x-cx)<=sx/2+PLAYER_RADIUS&&Math.abs(p.y-cy)<=sy/2+PLAYER_RADIUS&&Math.abs(p.z-cz)<=sz/2+PLAYER_RADIUS)return true;}
  else if(c.type==='CapsuleCollider'||c.type==='SphereCollider'){const [cx,cy,cz]=c.center,d=[p.x-cx,p.y-cy,p.z-cz];
   if(c.type==='CapsuleCollider'){const axis=c.direction??1,half=Math.max(0,(c.height??0)/2-c.radius);d[axis]=Math.max(0,Math.abs(d[axis])-half);} // point-to-segment
   if(Math.hypot(...d)<=c.radius+PLAYER_RADIUS)return true;}}
 return false;}
