import {Vector3,Quaternion,Matrix4,Ray} from 'three';
import {randomFloat,randomInt,lookRotation} from './loot.mjs';
// Ports of decompiled GenericSpawner, ResourceTarget/ResourceGivePair, ResourceObject, client WoodBlockerTemp
// and the MeleeWeaponDataBlock/MeleeWeaponItem gather path. Times are seconds; rng returns [0,1).
const H=new Matrix4().makeScale(1,1,-1);
export const ResourceTargetType={Animal:0,WoodPile:1,StaticTree:2,Rock1:3,Rock2:4,Rock3:5};

// UnityEngine.Random.insideUnitSphere (uniform in the unit ball).
export function insideUnitSphere(rng){for(;;){const v=new Vector3(rng()*2-1,rng()*2-1,rng()*2-1);if(v.lengthSq()<=1)return v;}}
// TransformHelpers.LookRotationForcedUp
export function lookRotationForcedUp(forward,up){
 if(forward.equals(up))return lookRotation(up);
 const rhs=new Vector3().crossVectors(forward,up);let f=new Vector3().crossVectors(up,rhs);if(f.lengthSq()===0)f=new Vector3(0,0,1);
 return lookRotation(f,up);
}
// Unity-space position/rotation/scale -> browser-space matrix (H * TRS * H).
export function unityMatrix(position,rotation,scale){return H.clone().multiply(new Matrix4().compose(position,rotation,new Vector3(scale.x,scale.y,scale.z))).multiply(H);}
const toUnity=v=>new Vector3(v.x,v.y,-v.z);

// ResourceTarget + ResourceGivePair: shared by resource nodes and animal corpses.
export class ResourceTarget {
 constructor(rt,rng){
  this.rng=rng;this.type=rt.type;this.multiplier=rt.gatherEfficiencyMultiplier;this.gatherProgress=0;
  // Awake -> TryInitialize: ResourceGivePair.CalcAmount = Random.Range(min, max + 1)
  this.resources=rt.resourcesAvailable.map(r=>({...r,left:randomInt(rng,r.amountMin,r.amountMax+1)}));this.startingTotal=this.totalLeft;
 }
 get totalLeft(){return this.resources.reduce((sum,r)=>sum+r.left,0);}
 percentFull(){return this.totalLeft/this.startingTotal;}
 resourcesGathered(){}
 resourcesDepleted(){}
 // ResourceTarget.DoGather(Inventory reciever, float efficiency)
 doGather(inventory,efficiency,notice=()=>{}){
  if(!this.resources.length)return false;
  const pair=this.resources[randomInt(this.rng,0,this.resources.length)];
  this.gatherProgress+=efficiency*this.multiplier;
  let amount=Math.trunc(Math.abs(this.gatherProgress));
  // Original clamps progress to the floored total, so fractional progress does not carry over.
  this.gatherProgress=Math.min(Math.max(this.gatherProgress,0),amount);
  amount=Math.min(amount,pair.left);
  if(amount>0){
   const remaining=inventory.add(pair.item,amount);
   if(remaining<amount){const added=amount-remaining;pair.left-=added;this.gatherProgress-=added;notice(`${added} x ${pair.name}`,'inventory');this.resourcesGathered();}// Notice.Inventory; the full-inventory case is Notice.Popup.
   else notice("Inventory full, can't gather.");
  }
  if(pair.left<=0)this.resources.splice(this.resources.indexOf(pair),1);
  if(!this.resources.length)this.resourcesDepleted();
  return true;
 }
}

// ResourceObject (+ its ResourceTarget): a GenericSpawner resource node.
export class ResourceNode extends ResourceTarget {
 constructor(system,spawner,entry,prefab,matrix,position){
  super(prefab.resourceTarget,system.rng);
  this.system=system;this.spawner=spawner;this.entry=entry;this.prefab=prefab;this.matrix=matrix;this.position=position;this.destroyed=false;
  this.modelIndex=-1;this.tryUpdateMesh();
 }
 // ResourceObject.TryUpdateMesh
 tryUpdateMesh(){const n=this.prefab.visualMeshes.length;if(!n)return;let p=this.percentFull();if(p<=0)p=0.01;const index=n-Math.ceil(p*n);if(index!==this.modelIndex){this.modelIndex=index;this.system.onModel?.(this,index);}}
 resourcesGathered(){this.tryUpdateMesh();}
 resourcesDepleted(){this.destroy();}
 // ResourcesDepletedMsg -> NetCull.Destroy -> OnDestroy -> GenericSpawner.WasKilled
 destroy(){if(this.destroyed)return;this.destroyed=true;const list=this.entry.spawned,i=list.indexOf(this);if(i>=0)list.splice(i,1);this.system.nodes.delete(this);this.system.onDestroy?.(this);}
}

export class ResourceSystem {
 // raycastTerrainOnly(ray, range) -> {position, normal} only when the first hit is the terrain collider.
 // spawnDynamic(spawner, entry, unityPosition, unityRotation) creates ":" (NetMainPrefab) entries such as animals.
 constructor(manifest,raycastTerrainOnly,{rng=Math.random,onSpawn,onDestroy,onModel,spawnDynamic=null}={}){
  this.manifest=manifest;this.raycast=raycastTerrainOnly;this.rng=rng;this.onSpawn=onSpawn;this.onDestroy=onDestroy;this.onModel=onModel;this.spawnDynamic=spawnDynamic;this.nodes=new Set();this.spawnStagger=0;this.timers=[];
  this.spawners=manifest.spawners.map(s=>({...s,spawnList:s.spawnList.map(e=>({...e,spawned:[]}))}));
 }
 // GenericSpawner.OnServerLoad: InvokeRepeating(think, thinkDelay+stagger, thinkDelay); Invoke(think, 5+stagger).
 start(now){for(const s of this.spawners){this.timers.push({spawner:s,at:now+s.thinkDelay+this.spawnStagger,repeat:s.thinkDelay},{spawner:s,at:now+5+this.spawnStagger,repeat:0});this.spawnStagger+=randomFloat(this.rng,1,2);}}
 update(now){for(const t of this.timers){if(t.at===null||now<t.at)continue;this.spawnThink(t.spawner);t.at=t.repeat?t.at+t.repeat:null;}this.timers=this.timers.filter(t=>t.at!==null);}
 // GenericSpawner.SpawnThink (initialSpawn is always false by the time it runs).
 spawnThink(spawner){
  for(const entry of spawner.spawnList){
   // ":" entries are dynamic NetMainPrefabs (animals); they spawn only when a creator is supplied.
   if(!entry.ported&&!(this.spawnDynamic&&entry.prefabName.startsWith(':')))continue;
   let n=entry.targetPopulation-entry.spawned.length;if(n<=0)continue;
   n=randomInt(this.rng,1,Math.min(n,entry.numToSpawnPerTick)+1);
   for(let i=0;i<n;i++)this.spawnGeneric(spawner,entry);
  }
 }
 // GenericSpawner.SpawnGeneric: up to 15 attempts, terrain-only ground ray from 0.25 m above the spawner height.
 spawnGeneric(spawner,entry){
  const origin=new Vector3(...spawner.position);
  for(let attempt=0;attempt<15;attempt++){
   const start=origin.clone().add(insideUnitSphere(this.rng).multiplyScalar(spawner.radius));start.y=origin.y;
   const yaw=randomFloat(this.rng,0,360)*Math.PI/180;
   // useNavmeshSample: TransformHelpers.GetGroundInfoNavMesh(start, 15) moves the start onto the navmesh when one is loaded.
   if(entry.useNavmeshSample&&this.navmesh){const g=this.navmesh.groundInfo(new Vector3(start.x,start.y,-start.z),15);if(g)start.set(g.point.x,g.point.y,-g.point.z);}
   const hit=this.raycast(new Ray(new Vector3(start.x,start.y+0.25,start.z),new Vector3(0,-1,0)),300.25);
   if(!hit)continue;
   const pos=toUnity(hit.position);pos.y+=0.05;
   const forward=new Vector3(0,0,1).applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw));
   const rotation=lookRotationForcedUp(forward,toUnity(hit.normal).normalize());
   if(!entry.prefab){const created=this.spawnDynamic(spawner,entry,pos,rotation);if(created)entry.spawned.push(created);return created;}
   const prefab=this.manifest.prefabs[entry.prefab],matrix=unityMatrix(pos,rotation,prefab.rootScale);
   const node=new ResourceNode(this,spawner,entry,prefab,matrix,new Vector3(pos.x,pos.y,-pos.z));
   entry.spawned.push(node);this.nodes.add(node);this.onSpawn?.(node);return node;
  }
  return null;
 }
}

// Client WoodBlockerTemp: per-point wood budget for terrain trees (10..14 wood, 4 m radius, 300 s lifetime).
export class WoodBlockers {
 constructor(rng=Math.random){this.rng=rng;this.blockers=[];}
 forPoint(point,now){this.blockers=this.blockers.filter(b=>now<b.expires);let b=this.blockers.find(b=>b.position.distanceTo(point)<4);
  if(!b){b={position:point.clone(),numWood:randomInt(this.rng,10,15),expires:now+300};this.blockers.push(b);}return b;}
}

// The entity root (transform.position) in browser space, as DoAction1's 6 m check measures it: a ground LootCrate and a
// DeathDrop keep a browser-space matrix, an airdrop's SupplyCrate its live Unity-space position, an ItemPickup body
// carries its DroppedItems object (browser-space matrix).
export function entityRootB(entity){if(entity.airdrop&&entity.position)return new Vector3(entity.position.x,entity.position.y,-entity.position.z);
 const m=entity.matrix??entity.object?.matrix;return m?new Vector3().setFromMatrixPosition(m):null;}
// MeleeWeaponDataBlock.DoAction1 ends with found.TryConditionLoss(0.25, 0.025) whenever the swing named a live network
// entity within 6 m (deployable, structure, animal, resource node, crate, sack, supply crate, pickup), hurt or not.
export const meleeWears=result=>['animal','deployable','resource','entity'].includes(result?.kind)&&!result.rejected;
// MeleeWeaponItem / MeleeWeaponDataBlock swing timing and the gather branch of the server hit handler.
export class MeleeGather {
 constructor({rng=Math.random}={}){this.rng=rng;this.next=0;this.nextSecondary=0;this.wasSprinting=false;this.queued=null;this.treeGatherLevel=new Map();this.blockers=new WoodBlockers(rng);}
 // MeleeWeaponItem.OnSetActive (the held melee item changed): clears both queued swing actions, then WeaponItem.OnSetActive
 // holds both attacks until deployFinishedTime = now + deployLength (0.75 s for the shipped melee tools) unless they are
 // already later. As MeleeState (server-combat.mjs) online.
 activate(now,tool){this.cancelQueued();const deployed=now+(tool?.deployLength??0);if(deployed>this.next)this.next=this.nextSecondary=deployed;}
 // WeaponItem.ItemPreFrame + MeleeWeaponItem.PrimaryAttack / SecondaryAttack: returns true when a swing starts.
 frame(now,{attack,attack2=false,sprinting,starving=false},tool,toolKey=null){
  if(sprinting){this.next=Math.max(this.next,now+0.1);this.wasSprinting=true;}
  else if(this.wasSprinting){this.next=Math.max(this.next,now+0.3);this.wasSprinting=false;}
  if(tool.isSemiAuto){if(attack&&this.lastAttack)attack=false;else this.lastAttack=Boolean(attack);}
  let swung=false;
  if(attack&&now>=this.next){
   // MeleeWeaponItem.PrimaryAttack: both attack times move on by fireRate, doubled when the caloric level is zero.
   this.next=this.nextSecondary=now+tool.fireRate*(starving?2:1);this.queued={at:now+tool.midSwingDelay,tool,toolKey};
   // MeleeWeaponDataBlock.Local_FireWeapon: QueueSwingSound(Time.time + swingSoundDelay), played from ItemPreFrame.
   this.queuedSound={at:now+(tool.swingSoundDelay??0.2),tool,toolKey};swung=true;}
  // MeleeWeaponItem.SecondaryAttack (AltFire): no swing, but both attacks wait fireRate (Local_SecondaryFire is not called).
  if(attack2&&now>=this.nextSecondary)this.next=this.nextSecondary=now+tool.fireRate;
  return swung;
 }
 // MeleeWeaponItem.ItemPreFrame: the queued SwingSound once due (one per swing).
 dueSwingSound(now){if(!this.queuedSound||now<=this.queuedSound.at)return null;const sound=this.queuedSound;this.queuedSound=null;return sound;}
 // MeleeWeaponItem.OnSetActive: holstering clears both queued swing actions.
 cancelQueued(){this.queued=null;this.queuedSound=null;}
 // Returns the queued mid-swing (Local_MidSwing) once it is due.
 dueSwing(now){if(!this.queued||now<this.queued.at)return null;const swing=this.queued;this.queued=null;return swing;}
 // Local_MidSwing + server ProcessHit gather branch. `hit` is the sphere-cast result {point, body, distance}.
 // `far`: DoAction1 returned at its 6 m check, before the swing's caloriesPerSwing (callers charge only when !far).
 resolve(now,tool,toolKey,hit,inventory,woodKey,playerPosition,notice=()=>{},attacker=null){
  if(!hit)return {kind:'miss'};
  // Deployables (TakeDamage/ProtectionTakeDamage): melee damage scaled by their melee armour.
  const deployed=hit.body?.deployed??hit.body?.structure;
  if(deployed){if(deployed.destroyed)return {kind:'other'};const at=new Vector3(deployed.position.x,deployed.position.y,-deployed.position.z);if(playerPosition.distanceTo(at)>=6)return {kind:'deployable',rejected:true,far:true};
   const damage=deployed.hurt(randomFloat(this.rng,tool.damageMin,tool.damageMax),2,attacker);return {kind:'deployable',deployed,damage,destroyed:deployed.destroyed};} // attacker: SpikeWall.OnHurt
  const animal=hit.body?.animal;
  if(animal){
   if(animal.destroyed)return {kind:'other'};
   const at=new Vector3(animal.position.x,animal.position.y,-animal.position.z);if(playerPosition.distanceTo(at)>=6)return {kind:'animal',rejected:true,far:true};
   // Server order: harvest a dead animal's ResourceTarget first, then apply the swing's melee damage.
   let gathered=false;if(animal.vitals.dead){animal.harvest.doGather(inventory,tool.efficiencies[ResourceTargetType.Animal],notice);gathered=true;}
   const damage=randomFloat(this.rng,tool.damageMin,tool.damageMax),result=animal.hurt([0,0,damage,0,0,0],attacker);
   return {kind:'animal',animal,gathered,killed:result.status==='WasKilled',damage};
  }
  if(hit.body?.isTree){
   // Client side: a WoodBlockerTemp decides whether the tree still gives wood here.
   const blocker=this.blockers.forPoint(hit.point,now);
   if(blocker.numWood<1){notice("There's no wood left here");return {kind:'tree',gathered:0};}
   blocker.numWood=Math.max(0,blocker.numWood-tool.efficiencies[ResourceTargetType.StaticTree]);
   // Server side: resourceGatherLevel is a field of the shared datablock, so it is pooled per tool type.
   let level=(this.treeGatherLevel.get(toolKey)??0)+tool.efficiencies[ResourceTargetType.StaticTree],gathered=0;
   if(level>=1){const n=Math.floor(level),added=n-inventory.add(woodKey,n);if(added>0){level-=added;gathered=added;notice(`${added} x Wood`,'inventory');}}// MeleeWeaponDataBlock: Notice.Inventory
   this.treeGatherLevel.set(toolKey,level);return {kind:'tree',gathered,hadWood:true};
  }
  // Every other IDMain with a NetEntityID: LootableObject crates and sacks (GenericProp), the SupplyCrate, ItemPickup.
  // Client MeleeWeaponDataBlock.Local_MidSwing (~284-348) sends its NetEntityID; server DoAction1 (~363-466) has no
  // TakeDamage or ResourceTarget to use on it, but rejects it at 6 m and otherwise still wears the tool (meleeWears).
  const entity=hit.body?.crate??hit.body?.pickup;
  if(entity){if(entity.destroyed)return {kind:'other'};const at=entityRootB(entity);if(at&&playerPosition.distanceTo(at)>=6)return {kind:'entity',rejected:true,far:true};return {kind:'entity',entity};}
  const node=hit.body?.resourceNode;if(!node||node.destroyed)return {kind:'other'};
  // Server rejects hits on entities 6 m or more from the attacker.
  if(playerPosition.distanceTo(node.position)>=6)return {kind:'resource',rejected:true,far:true};
  const efficiency=tool.efficiencies[node.type];if(efficiency===undefined)return {kind:'resource',rejected:true};
  node.doGather(inventory,efficiency,notice);return {kind:'resource',node};
 }
}
