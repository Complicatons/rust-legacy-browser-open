import {Vector3,Quaternion,Matrix4,Ray,Box3} from 'three';
import {lookRotationForcedUp} from './resources.mjs';
import {component,unityMatrix,nodeMatrix,hardpointsOf} from './deployables.mjs';
import {TakeDamage,takeDamageData,quantityOf,LifeStatus,FAILED_HURT} from './take-damage.mjs';
// Ports of decompiled StructureMaster, StructureComponent(.CheckLocation), StructureComponentKey,
// StructureComponentDataBlock (CheckBlockers, DoAction1), StructureComponentItem.RenderPlacementHelpers,
// Hardpoint/HardpointMaster and TransCarrier. All maths in Unity space; collision queries go through `world`.
export const StructureType={Pillar:0,Wall:1,Doorway:2,Ceiling:3,Stairs:4,Foundation:5,WindowWall:6,Ramp:7};
export const MaterialType={UNSET:0,Wood:1,Metal:2,Brick:3,Concrete:4};
export const gridSpacingXZ=2.5,gridSpacingY=4;
const T=StructureType,UP=new Vector3(0,1,0),RIGHT=new Vector3(1,0,0);
const isWallType=t=>t===T.Wall||t===T.Doorway||t===T.WindowWall;
// Mathf.RoundToInt rounds halves to even.
export function roundToInt(v){const f=Math.floor(v),d=v-f;if(d>0.5)return f+1;if(d<0.5)return f;return f%2===0?f:f+1;}
const ROUND=(v,inv)=>v<0?-roundToInt(v*-inv):v>0?roundToInt(v*inv):0;
// StructureComponentKey: 2.5 x 4 x 2.5 m cells.
export const keyOf=l=>`${ROUND(l.x,0.4)},${ROUND(l.y,0.25)},${ROUND(l.z,0.4)}`;
const approx=(a,b)=>Math.abs(a-b)<0.001;

// Prefab-local Unity AABB of its solid colliders (Box or Mesh bounds); browser-space data is reflected back.
export function localColliderBounds(prefab,meshes){const box=new Box3(),flip=v=>new Vector3(v.x,v.y,-v.z);
 for(const c of prefab.colliders){if(c.trigger)continue;const m=new Matrix4().fromArray(c.matrix);let lo,hi;
  if(c.type==='BoxCollider'){const s=new Vector3(...c.size).multiplyScalar(0.5),ce=new Vector3(...c.center);lo=ce.clone().sub(s);hi=ce.clone().add(s);}
  else if(c.type==='MeshCollider'&&meshes?.[c.mesh]?.bounds){[lo,hi]=meshes[c.mesh].bounds.map(a=>new Vector3(...a));}else continue;
  for(let i=0;i<8;i++)box.expandByPoint(flip(new Vector3(i&1?hi.x:lo.x,i&2?hi.y:lo.y,i&4?hi.z:lo.z).applyMatrix4(m)));}
 return box;}

export class StructureComponent {
 constructor(system,itemKey,prefab,position,rotation){
  const d=component(prefab,'StructureComponent');this.system=system;this.itemKey=itemKey;this.prefab=prefab;this.type=d.type;this.materialType=d._materialType;
  this.position=position.clone();this.rotation=rotation.clone();this.matrix=unityMatrix(position,rotation,prefab.rootScale);this.master=null;this.destroyed=false;this.carried=new Set();
  // [RequireComponent(typeof(TakeDamage))]: every piece is a ProtectionTakeDamage in the recovered prefabs.
  const td=takeDamageData(prefab);this.takeDamage=new TakeDamage(td??{maxHealth:1000,armor:[0,0,0,0,0,0]});
  const world=new Matrix4().compose(position,rotation,new Vector3(1,1,1));this.bounds=system.localBounds(prefab).clone().applyMatrix4(world);
  this.hardpoints=hardpointsOf(prefab,world,this);
 }
 // StructureComponent.CheckLocation
 checkLocation(master,placePos,placeRot){
  const local=master.local(placePos);
  if(master.materialType!==MaterialType.UNSET&&master.materialType!==this.materialType)return false;
  const occupied=Boolean(master.componentAt(placePos)),below=master.compByLocal(local.clone().sub(new Vector3(0,gridSpacingY,0)));
  const onFoundation=this.type!==T.Foundation&&master.foundationForPoint(placePos);
  if(isWallType(this.type)){if(occupied)return false;
   const left=master.componentAt(placePos.clone().add(RIGHT.clone().negate().applyQuaternion(placeRot).multiplyScalar(2.5))),right=master.componentAt(placePos.clone().add(RIGHT.clone().applyQuaternion(placeRot).multiplyScalar(2.5)));
   return Boolean(left&&right&&left.type===T.Pillar&&right.type===T.Pillar);}
  if(this.type===T.Foundation){
   for(const other of this.system.masters)if(other!==master&&other.intersects(placePos))return false;
   return master.isValidFoundationSpot(placePos)&&!occupied;}
  if(this.type===T.Ramp)return !occupied&&(master.isValidFoundationSpot(placePos)||Boolean(below&&(below.type===T.Ceiling||below.type===T.Foundation)));
  if(this.type===T.Pillar)return ((Boolean(below)&&below.type===T.Pillar)||onFoundation)&&!occupied;
  if(this.type===T.Stairs||this.type===T.Ceiling){if(occupied)return false;
   for(const o of [[-2.5,-2.5],[2.5,2.5],[-2.5,2.5],[2.5,-2.5]]){const c=master.compByLocal(local.clone().add(new Vector3(o[0],0,o[1])));if(!c||c.type!==T.Pillar)return false;}return true;}
  return false;}
 get health(){return this.takeDamage.health;}
 set health(v){this.takeDamage.health=v;}
 get maxHealth(){return this.takeDamage.maxHealth;}
 get armor(){return this.takeDamage.armor;}
 // TakeDamage.Hurt with a DamageTypeList (amount + type index, or the list) or plain health points (amount alone,
 // e.g. StructureMaster.DoDecay's HurtSelf). Returns the damage applied. OnHurt -> UpdateClientHealth (dimmer);
 // WasKilled -> StructureComponent.OnKilled.
 hurt(amount,typeIndex){if(this.destroyed)return 0;const before=this.health,e=this.takeDamage.hurt(quantityOf(amount,typeIndex),this.system.now?.()??null);this.lastHurt=e;
  // OnHurt -> UpdateClientHealth: BufferHealthRPC only sends ClientHealthUpdate when the health actually changed.
  if(this.health!==before)this.system.onHurt?.(this,e);if(e.status===LifeStatus.WasKilled)this.kill(e);return e.amount;}
 // StructureComponent.OnKilled -> DelayedKill (one frame later): ClientKilled (deathEffect, 5 s) then NetCull.Destroy.
 // Inside StructureSystem.deferring() (one explosion's hits) the dead piece stays until every hit has landed, so a
 // door on a doorway killed by the same blast still dies (and leaves its corpse) before the doorway drops it.
 // The server never touches the other pieces: no support/collapse check exists (weight links only gate decay).
 kill(e=null){if(this.destroyed||this.dying)return;this.dying=true;if(this.system.deferKills){this.system.pendingKills.push([this,e]);return;}this.finishKill(e);}
 finishKill(e){if(this.destroyed)return;this.system.onKilled?.(this,e);this.destroy();}
 // RustServerManagement.OnServerWillDestroy: StructureMaster.RemoveComponent, then TransCarrier.DropObjects
 // (every carried deployable is NetCull.Destroyed without its death effect).
 destroy(){if(this.destroyed)return;this.destroyed=true;this.system.remove(this);for(const o of [...this.carried])o.destroy();this.carried.clear();}
}

export class StructureMaster {
 constructor(system,position,rotation){this.system=system;this.position=position.clone();this.rotation=rotation.clone();this.inverse=rotation.clone().invert();this.components=new Set();this.byKey=new Map();this.materialType=MaterialType.UNSET;
  this.weightOnMe=new Map();this.hasWeightOn=new Map();}
 local(p){return p.clone().sub(this.position).applyQuaternion(this.inverse);}
 world(l){return l.clone().applyQuaternion(this.rotation).add(this.position);}
 compByLocal(l,type=null){const node=this.byKey.get(keyOf(l));if(!node)return null;
  if(type===null){for(const t of ['ceiling','stairs','pillar','foundation','wall'])if(node[t])return node[t];return null;}
  return node[type===T.Ceiling?'ceiling':type===T.Stairs?'stairs':type===T.Pillar?'pillar':type===T.Foundation?'foundation':isWallType(type)?'wall':'none']??null;}
 componentAt(worldPos){return this.compByLocal(this.local(worldPos));}
 slot(c){return c.type===T.Ceiling?'ceiling':c.type===T.Stairs?'stairs':c.type===T.Pillar?'pillar':c.type===T.Foundation?'foundation':isWallType(c.type)?'wall':null;}
 // AppendStructureComponent: material, position entry, then GenerateLinkForComp for the new piece only.
 add(c){if(c.type===T.Foundation&&this.materialType===MaterialType.UNSET)this.materialType=c.materialType;this.components.add(c);c.master=this;
  const k=keyOf(this.local(c.position));const node=this.byKey.get(k)??{};const s=this.slot(c);if(s)node[s]=c;this.byKey.set(k,node);this.generateLinkForComp(c);}
 // RemoveComponent: RemoveCompPositionEntry, RemoveLinkForComp, ClearMaster.
 remove(c){const k=keyOf(this.local(c.position)),node=this.byKey.get(k);
  if(node){const s=this.slot(c);if(node[s]===c)node[s]=null;
   // RemoveCompPositionEntry drops the cell when something is still left in it (inverted test in the original), keeping it when it emptied.
   if(['ceiling','stairs','pillar','foundation','wall'].some(t=>node[t]))this.byKey.delete(k);}
  this.removeLinkForComp(c);this.components.delete(c);c.master=null;}
 // StructureMaster weight links (_weightOnMe[support] = pieces resting on it, _hasWeightOn the reverse). They are
 // generated once, when a piece is appended, from what is already below/beside it; nothing re-links later pieces.
 addWeightLink(me,weight){if(!this.weightOnMe.has(me))this.weightOnMe.set(me,new Set());this.weightOnMe.get(me).add(weight);
  if(!this.hasWeightOn.has(weight))this.hasWeightOn.set(weight,new Set());this.hasWeightOn.get(weight).add(me);}
 removeLinkForComp(c){
  for(const item of this.weightOnMe.get(c)??[]){const s=this.hasWeightOn.get(item);if(s?.delete(c)&&!s.size)this.hasWeightOn.delete(item);}this.weightOnMe.delete(c);
  for(const item of this.hasWeightOn.get(c)??[]){const s=this.weightOnMe.get(item);if(s?.delete(c)&&!s.size)this.weightOnMe.delete(item);}this.hasWeightOn.delete(c);}
 generateLinkForComp(c){const v=this.local(c.position),below=new Vector3(0,gridSpacingY,0);
  if(isWallType(c.type)){
   for(const side of [-1,1]){const o=this.componentAt(c.position.clone().add(RIGHT.clone().applyQuaternion(c.rotation).multiplyScalar(2.5*side)));if(o&&o.type===T.Pillar)this.addWeightLink(o,c);}}
  else if(c.type===T.Pillar){const p=this.compByLocal(v.clone().sub(below),T.Pillar);if(p)this.addWeightLink(p,c);
   for(const [x,z] of [[-2.5,-2.5],[2.5,2.5],[-2.5,2.5],[2.5,-2.5],[2.5,0],[-2.5,0],[0,2.5],[0,-2.5],[0,0]]){const at=v.clone().add(new Vector3(x,-gridSpacingY,z));
    const f=this.compByLocal(at,T.Foundation),ce=this.compByLocal(at,T.Ceiling);if(f)this.addWeightLink(f,c);if(ce)this.addWeightLink(ce,c);}}
  else if(c.type===T.Ceiling||c.type===T.Stairs){for(const [x,z] of [[-2.5,-2.5],[2.5,2.5],[-2.5,2.5],[2.5,-2.5]]){const p=this.compByLocal(v.clone().add(new Vector3(x,0,z)),T.Pillar);if(p)this.addWeightLink(p,c);}}
  else if(c.type===T.Ramp){const o=this.compByLocal(v.clone().sub(below));if(o)this.addWeightLink(o,c);}
  else if(c.type===T.Foundation){const f=this.compByLocal(v.clone().sub(below),T.Foundation);if(f&&f!==c)this.addWeightLink(f,c);}}
 // ComponentCarryingWeight: something rests on it (decay spares load-bearing pillars, ceilings and foundations).
 carryingWeight(c){return (this.weightOnMe.get(c)?.size??0)>0;}
 // containedBounds: the master position encapsulating every piece's collider bounds, expanded by 5 m.
 get bounds(){const b=new Box3(this.position.clone(),this.position.clone());for(const c of this.components)b.union(c.bounds);return b.expandByScalar(2.5);}
 intersects(p){return this.bounds.intersectsBox(new Box3().setFromCenterAndSize(p,new Vector3(5,5,4)));}
 // IsValidFoundationSpot: next to an existing foundation (5 m along a local axis, same height) with terrain within 3.5 m above its base.
 isValidFoundationSpot(p){if(!this.components.size)return true;
  for(const c of this.components){if(c.type!==T.Foundation)continue;const v=p.clone().sub(c.position).applyQuaternion(c.rotation.clone().invert());
   const beside=((approx(Math.abs(v.x),5)&&approx(v.z,0))||(approx(Math.abs(v.z),5)&&approx(v.x,0)))&&approx(v.y,0);
   if(beside&&this.system.world.groundTerrainOnly(p.clone().add(new Vector3(0,3.5,0)),3.5))return true;}
  return false;}
 foundationForPoint(p){for(const c of this.components){if(c.type!==T.Foundation)continue;const v=p.clone().sub(c.position).applyQuaternion(c.rotation.clone().invert());if(Math.abs(v.x)<=2.51&&Math.abs(v.z)<=2.51&&approx(v.y,4))return true;}return false;}
 rayDistance(ray){const b=this.components.size?this.bounds:null;if(!b)return null;if(b.containsPoint(ray.origin))return 0;const hit=ray.intersectBox(b,new Vector3());return hit?hit.distanceTo(ray.origin):null;}
}

export class StructureSystem {
 // world: {raycast(rayU, range) -> {point, normal, terrain, structure}|null, groundTerrainOnly(posU, range) -> bool, zones, spikeWallNear(posU, r2d) -> bool}
 constructor(manifest,items,world,{onAdd,onRemove,onHurt,onKilled,now}={}){this.now=now;this.manifest=manifest;this.items=items;this.world=world;this.onAdd=onAdd;this.onRemove=onRemove;this.onHurt=onHurt;this.onKilled=onKilled;this.masters=new Set();this.components=new Set();this.boundsCache=new Map();}
 localBounds(prefab){if(!this.boundsCache.has(prefab))this.boundsCache.set(prefab,localColliderBounds(prefab,this.manifest.meshes));return this.boundsCache.get(prefab);}
 entryFor(itemKey){return this.manifest.structures[itemKey]??null;}
 prefabFor(itemKey){const e=this.entryFor(itemKey);return e&&this.manifest.prefabs[e.prefab];}
 // StructureMaster.RayTestStructures: masters whose bounds the ray meets within 10 m, nearest first.
 rayTest(ray,max=10){return [...this.masters].map(m=>[m,m.rayDistance(ray)]).filter(([,d])=>d!==null&&d<=max).sort((a,b)=>a[1]-b[1]).map(([m])=>m);}
 // StructureComponentDataBlock.CheckBlockers: no foundation within 5 m (2D) of a spike wall; NoPlacementZone.ValidPos.
 checkBlockers(type,pos){if(type===T.Foundation&&this.world.spikeWallNear?.(pos,5))return false;return !this.world.zones.some(z=>pos.distanceTo(z.position)<=z.radius);}
 // StructureComponentItem.RenderPlacementHelpers (client preview/validity) for a held structure item.
 placement(itemKey,eyes,desiredRotation){const prefab=this.prefabFor(itemKey),type=component(prefab,'StructureComponent').type,probe=new StructureComponent(this,itemKey,prefab,new Vector3(),new Quaternion());
  const range=type===T.Ceiling?4:8,hit=this.world.raycast(eyes,range);let zero=hit?hit.point.clone():eyes.origin.clone().addScaledVector(eyes.direction,range);
  if(type===T.Ceiling||type===T.Foundation||type===T.Ramp)zero.y-=3.5;
  const eyeRot=lookRotationForcedUp(eyes.direction.clone(),UP).multiply(desiredRotation);
  let fallback=null,master=null,pos=null,rot=null;
  for(const m of this.rayTest(eyes)){
   // SnapToGrid in the master's space; Mathf.Round rounds halves to even.
   const l=m.local(zero);l.set(roundToInt(l.x/gridSpacingXZ)*gridSpacingXZ,roundToInt(l.y/gridSpacingY)*gridSpacingY,roundToInt(l.z/gridSpacingXZ)*gridSpacingXZ);const p=m.world(l);
   const r=lookRotationForcedUp(new Vector3(0,0,1).applyQuaternion(m.rotation),UP.clone().applyQuaternion(m.rotation)).multiply(desiredRotation);
   fallback??={position:p,rotation:r};if(probe.checkLocation(m,p,r)){master=m;pos=p;rot=r;break;}}
  let valid=Boolean(master);
  if(!valid){if(type===T.Foundation&&hit?.terrain&&![...this.masters].some(m=>m.intersects(zero))){pos=zero;rot=eyeRot;valid=true;}
   else {pos=fallback?.position??zero;rot=fallback?.rotation??eyeRot;}}
  if(!this.checkBlockers(type,pos))valid=false;
  // The preview is drawn at the raw hit point when invalid.
  return {valid,master,type,position:valid?pos:zero,rotation:rot,placeRotation:rot,placePosition:pos};}
 // StructureComponentDataBlock.DoAction1 (server): re-validates and adds the piece to its master.
 place(itemKey,eyes,position,rotation,master){const prefab=this.prefabFor(itemKey),probe=new StructureComponent(this,itemKey,prefab,position,rotation);let created=false;
  if(!master){if(this.rayTest(eyes).length)return null;if(probe.type!==T.Foundation)return null;master=new StructureMaster(this,position,rotation);created=true;}
  if(!probe.checkLocation(master,position,rotation)||!this.checkBlockers(probe.type,position))return null;
  if(created)this.masters.add(master);master.add(probe);this.components.add(probe);this.onAdd?.(probe);return probe;}
 remove(c){const m=c.master;if(m){m.remove(c);if(!m.components.size)this.masters.delete(m);}this.components.delete(c);this.onRemove?.(c);}
 // Runs fn with StructureComponent.DelayedKill semantics: kills land after fn (the next frame in the original).
 deferring(fn){if(this.deferKills)return fn();this.deferKills=true;this.pendingKills=[];try{return fn();}finally{this.deferKills=false;for(const [c,e] of this.pendingKills.splice(0))c.finishKill(e);}}
 // Hardpoint.GetHardpointFromRay: 10 m ray; the hit piece's first free hardpoint of that type within 3 m of the hit point.
 hardpointFromRay(ray,type){const hit=this.world.raycast(ray,10);const owner=hit?.structure??hit?.deployed;if(!owner?.hardpoints)return null;
  return owner.hardpoints.find(h=>h.type===type&&h.position.distanceTo(hit.point)<=3)??null;}
}
