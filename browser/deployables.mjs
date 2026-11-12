import {Vector3,Quaternion,Matrix4,Ray} from 'three';
import {randomFloat,randomInt,lookRotation} from './loot.mjs';
import {newCondition} from './inventory.mjs';
import {lookRotationForcedUp} from './resources.mjs';
import {TakeDamage,takeDamageData,quantityOf,LifeStatus,FAILED_HURT} from './take-damage.mjs';
// Ports of decompiled DeployableItemDataBlock.CheckPlacementResults/DoAction1, DeployableObject, FireBarrel,
// Furnace, CampfireInventory, LootableObject storage, SleepingBag/DeployedRespawn, HeatZone and WorkZone.
// Placement maths runs in Unity space; collision queries convert to browser space (Z negated).
const toB=v=>new Vector3(v.x,v.y,-v.z),toU=toB,UP=new Vector3(0,1,0);
const H=new Matrix4().makeScale(1,1,-1);
export const SlotFlags={Belt:1,Storage:2,Equip:4,Head:8,Chest:0x10,Legs:0x20,Feet:0x40,FuelBasic:0x80,Debris:0x100,Raw:0x200,Cooked:0x400};
// CampfireInventory.ConfigureSlots: 0-2 cooked output, 3-5 raw input, 6 fuel, 7 charcoal (debris).
export const campfireSlotFlags=[SlotFlags.Cooked,SlotFlags.Cooked,SlotFlags.Cooked,SlotFlags.Raw,SlotFlags.Raw,SlotFlags.Raw,SlotFlags.FuelBasic,SlotFlags.Debris];

export const component=(prefab,kind)=>prefab.components?.[kind]?.[0]?.data??null;
const DAMAGE_MELEE_FLAG=1<<2; // DamageTypeFlags.damage_melee
// DeployableItem.ItemPreFrame → CanPlace: the attack places only with a valid preview, the 0.5 s _nextPlaceTime passed and
// the character grounded. An invalid preview does nothing on the client (CanPlace just returns false); "You can't place
// that here" is only the server's DoAction1 answer to a request it rejects.
export const canPlace=({attack,valid,now,nextPlaceTime,grounded=true})=>Boolean(attack&&valid&&nextPlaceTime<=now&&grounded);
// HumanController (server, not owner): gameObject.AddComponent<SphereCollider>() on the player root: Unity's default radius.
export const PLAYER_TRIGGER_RADIUS=0.5;
// The DeployableObject component (or its SleepingBag/Bed/DeployedRespawn subclass): data plus exported deathEffect/corpse.
export function deployableData(prefab){const c=prefab?.components??{};for(const k of ['DeployableObject','SleepingBag','Bed','DeployedRespawn']){const e=c[k]?.[0];if(e)return {...e.data,deathEffect:e.deathEffect??null,corpse:e.corpse??null};}return null;}
export function deployableKind(prefab){
 const c=prefab.components??{};
 if(c.Furnace)return 'furnace';if(c.FireBarrel)return 'campfire';if(c.SleepingBag||c.DeployedRespawn||c.Bed)return 'respawn';
 if(c.RepairBench)return 'repairbench';if(c.WorkZone&&!c.LootableObject)return 'workbench';if(c.MovingDoor)return 'door';if(c.LootableObject)return 'storage';return 'solid';
}
export function unityMatrix(position,rotation,scale){return H.clone().multiply(new Matrix4().compose(position,rotation,new Vector3(scale.x,scale.y,scale.z))).multiply(H);}
// Unity-space matrix of a prefab node relative to the prefab root (the root's own TRS is replaced by the placement).
export function nodeMatrix(prefab,index){let m=new Matrix4();for(let i=index;i>0;i=prefab.nodes[i].parent){const n=prefab.nodes[i];
 m=new Matrix4().compose(new Vector3(...n.position),new Quaternion(...n.rotation),new Vector3(...n.scale)).multiply(m);}return m;}
// Hardpoint children register with the root's HardpointMaster (Hardpoint.Awake); `world` is the placed root's Unity matrix.
export function hardpointsOf(prefab,world,owner){if(!prefab.components.HardpointMaster)return [];return (prefab.components.Hardpoint??[]).map(h=>{const p=new Vector3(),q=new Quaternion(),s=new Vector3();world.clone().multiply(nodeMatrix(prefab,h.node)).decompose(p,q,s);return {type:h.data.type,position:p,rotation:q,up:UP.clone().applyQuaternion(q),owner};});}
// DeployableItemDataBlock.NonVariantSphereCast: the hit point lies on the input ray (squared offset < 0.001).
export function nonVariantSphereCast(ray,p){const o=ray.origin,d=ray.direction,t=d.dot(p)-d.dot(o);const x=p.x-(d.x*t+o.x),y=p.y-(d.y*t+o.y),z=p.z-(d.z*t+o.z);return x*x+y*y+z*z<0.001;}
const angleDeg=(a,b)=>Math.acos(Math.min(1,Math.max(-1,a.clone().normalize().dot(b.clone().normalize()))))*180/Math.PI;

// DeployableItemDataBlock.CheckPlacementResults. `world` supplies: cast(rayU, range, radius) -> {pointU, normalU, terrain, layer, deployed, structure}|null,
// deployedNear(posU, radius, tag), zones (NoPlacementZone list), fit(conditions, matrixU) -> bool.
export function checkPlacement(entry,prefab,rayU,world){
 const p=entry.placement,range=p.placeRange??8,useSphere=(p.minCastRadius??0.25)>=1.401298e-45;
 let hit=world.cast(rayU,range,useSphere?p.minCastRadius:0),hitSomething=false,fromDown=false;
 const end=rayU.origin.clone().addScaledVector(rayU.direction,range);
 if(!hit){const o=end.clone();o.y+=0.5;hit=world.cast(new Ray(o,new Vector3(0,-1,0)),5,0);fromDown=Boolean(hit);}
 let pos,normal,onDeployable=null,onStructure=false,onTerrain=false;
 if(hit){pos=hit.point.clone();normal=hit.normal.clone();onStructure=Boolean(hit.structure);onDeployable=!onStructure&&hit.deployed?hit.deployed:null;onTerrain=Boolean(hit.terrain)||hit.layer===10;hitSomething=true;}
 else {pos=end;normal=UP.clone();}
 // Hardpoints (doors on doorways) come with the structure system.
 const hardpoint=entry.placement.hardpointType?world.hardpoint?.(rayU,entry.placement.hardpointType):null;
 if(hardpoint){pos=hardpoint.position.clone();normal=hardpoint.up.clone();hitSomething=true;}
 const deployable=component(prefab,'DeployableObject')??component(prefab,'SleepingBag')??component(prefab,'Bed')??component(prefab,'DeployedRespawn')??{maxSlope:30,cantPlaceOn:0};
 const close=(p.spacingRadius??0)>0&&world.deployedNear(pos,p.spacingRadius,prefab.nodes[0].tag);
 const cantPlaceOn=Boolean(onDeployable&&!p.forcePlaceable&&onDeployable.cantPlaceOn);
 let mode=p.orientationMode??0;if(mode===0)mode=p.uprightOnly?2:1;
 let q;
 // DeployableOrientationMode: 1 NormalUp, 2 Upright, 3 NormalForward, 4 HardpointPosRot.
 if(mode===1)q=lookRotationForcedUp(rayU.direction.clone(),normal);
 else if(mode===2)q=lookRotationForcedUp(rayU.direction.clone(),UP);
 else if(mode===3)q=lookRotationForcedUp(new Vector3().crossVectors(rayU.direction,UP),normal);
 else q=hardpoint?hardpoint.rotation.clone():lookRotationForcedUp(rayU.direction.clone(),UP);
 const r=prefab.rootLocalRotation,rot=q.clone().multiply(new Quaternion(r.x,r.y,r.z,r.w));
 const inZone=Boolean(p.checkPlacementZones)&&world.zones.some(z=>pos.distanceTo(z.position)<=z.radius);
 const slope=angleDeg(normal,UP);
 const results={
  falseFromDeployable:(!p.CanStackOnDeployables&&Boolean(onDeployable))||cantPlaceOn,
  falseFromTerrian:Boolean(p.TerrainOnly)&&!onTerrain,
  falseFromClose:Boolean(close),
  falseFromHardpoint:Boolean(p.requireHardpoint)&&!hardpoint,
  falseFromAngle:!p.requireHardpoint&&slope>=deployable.maxSlope,
  falseFromPlacementZone:inZone,
  falseFromHittingNothing:!hitSomething,
  falseFromStructure:Boolean(p.StructureOnly)&&!onStructure,
  falseFromFitRequirements:Boolean(entry.fitRequirements)&&!world.fit(entry.fitRequirements,pos,p.fitTestForcedUp?lookRotationForcedUp(new Vector3(0,0,1).applyQuaternion(rot),UP):rot,prefab.rootScale),
 };
 // The hit object's TransCarrier carries it. CarrierSphereCastMode AdjustedRay (Explosive Charge) / InputRay: when the
 // sphere cast's hit point is off the input ray, the carrier comes from a thin ray instead (then a 5 m ray down).
 const carrierOf=h=>h?(h.structure??(h.deployed?.prefab?.components?.TransCarrier?h.deployed:null)):null;
 let carrier=carrierOf(hit);
 if(hit&&!fromDown&&useSphere&&(p.carrierSphereCastMode??0)!==0&&!nonVariantSphereCast(rayU,hit.point)){
  let ray2,dist;if(p.carrierSphereCastMode===1){const d=hit.point.clone().sub(rayU.origin);dist=d.length()+p.minCastRadius*2;ray2=new Ray(rayU.origin.clone(),d.normalize());}else {dist=range+p.minCastRadius;ray2=rayU;}
  let h2=world.cast(ray2,dist,0);if(!h2){const o=hit.point.clone();o.y+=0.5;h2=world.cast(new Ray(o,new Vector3(0,-1,0)),5,0);}carrier=carrierOf(h2);}
 if(hardpoint)carrier=hardpoint.owner;
 return {valid:Object.values(results).every(v=>!v),results,position:pos,rotation:rot,fromDown,carrier};
}

// FireBarrel / Furnace: fuel burns every cook duration, adds charcoal, cooks raw items.
export class FireBarrel {
 constructor(obj,{items,rng=Math.random,furnace=false}){
  const d=component(obj.prefab,furnace?'Furnace':'FireBarrel');this.obj=obj;this.items=items;this.rng=rng;this.furnace=furnace;this.myTemp=d?.myTemp??1;
  this.charcoal=Object.keys(items).find(k=>items[k].data.m_Name==='Charcoal');this.isOn=false;this.nextFuel=null;this.fuelCheckAt=null;this.occupied=null;
  this.cookDuration=furnace?30:60;
 }
 get slots(){return this.obj.slots;}
 item(slot){return slot&&this.items[slot.item]?.data;}
 findFuel(){return this.slots.findIndex(s=>s&&this.item(s).flammable);}
 hasFuel(){return this.findFuel()>=0;}
 // SetOn: InvokeRepeating(ConsumeFuel, Random.Range(d*0.5, d), d)
 setOn(on,now){this.isOn=on;this.nextFuel=on?now+randomFloat(this.rng,this.cookDuration*0.5,this.cookDuration):null;}
 trySetOn(on,now){if(on&&!this.hasFuel())on=false;this.setOn(on,now);}
 update(now){this.watchSlots(now);while(this.isOn&&this.nextFuel!==null&&now>=this.nextFuel){const at=this.nextFuel;this.nextFuel+=this.cookDuration;this.consumeFuel(at);}this.watchSlots(now);
  // FuelRemoveCheck: SetOn(false) unless fuel is left.
  if(this.fuelCheckAt!==null&&now>=this.fuelCheckAt){this.fuelCheckAt=null;if(!this.hasFuel())this.setOn(false,now);}}
 // Inventory.ItemAdded/ItemRemoved (any slot gaining or losing its item: a player taking or storing, fuel used up) →
 // FireBarrel.InvItemAdded/InvItemRemoved: DecayTouch; a removal also CancelInvoke + Invoke("FuelRemoveCheck", 0.25).
 watchSlots(now){const slots=this.slots,was=this.occupied;this.occupied=slots.map(Boolean);if(!was)return;
  for(let i=0;i<slots.length;i++){if(was[i]===this.occupied[i])continue;this.obj.decay?.touch?.(now);if(was[i])this.fuelCheckAt=now+0.25;}}
 // Adds `amount` of an item, stacking first (preferring `slot`), like Inventory.AddItem/AddItemAmount.
 add(key,amount,slot=null){const d=this.items[key].data,slots=this.slots;let left=amount;
  const order=[...(slot!==null?[slot]:[]),...slots.keys()];
  for(const i of order){if(!left)break;const s=slots[i];if(s?.item===key&&d._splittable){const n=Math.min(left,d._maxUses-s.uses);s.uses+=n;left-=n;}}
  for(const i of order){if(!left)break;if(!slots[i]&&this.accepts(i,d)){const n=d._splittable?Math.min(left,d._maxUses):1;slots[i]={item:key,uses:n,...newCondition()};left-=n;}}
  return left;}
 accepts(index,d){if(this.furnace)return true;return (d._itemFlags&campfireSlotFlags[index])!==0;}
 consume(index,count){const s=this.slots[index];s.uses-=count;if(s.uses<=0){this.slots[index]=null;return true;}return false;}
 cookInfo(s){const d=this.item(s);if(!d?.cookable||!d.cookedVersion?.m_PathID)return null;const cooked=Object.keys(this.items).find(k=>k.endsWith(':'+d.cookedVersion.m_PathID));if(!cooked)return null;
  const consume=Math.min(2,s.uses);
  // ConsumableItem: cooked = consumed; ResourceTypeItem: consumed * Random.Range(numToGiveCookedMin, Max + 1); burnTemp 999999999 for resources.
  if('calories' in d)return {consume,cooked,count:consume,cookTempMin:d.cookHeatRequirement,burnTemp:d.burnTemp};
  const count=consume*randomInt(this.rng,d.numToGiveCookedMin??1,(d.numToGiveCookedMax??1)+1);return count===0?null:{consume,cooked,count,cookTempMin:d.cookHeatRequirement,burnTemp:999999999};}
 consumeFuel(now){
  const fuel=this.findFuel();if(fuel<0){this.setOn(false,now);return;}
  const usedUp=this.consume(fuel,this.furnace?2:1);
  if(this.furnace){
   this.add(this.charcoal,5);const seen=new Set();
   for(let i=0;i<this.slots.length;i++){const s=this.slots[i];if(!s)continue;const c=this.cookInfo(s);if(!c||s.uses<c.consume||this.myTemp<c.cookTempMin)continue;if(c.count>0){if(seen.has(c.cooked))continue;seen.add(c.cooked);}
    this.consume(i,c.consume);if(c.count>0){if(this.myTemp>=c.burnTemp)this.add(this.charcoal,c.count);else this.add(c.cooked,c.count);}}
   if(usedUp&&!this.hasFuel())this.setOn(false,now);return;
  }
  this.add(this.charcoal,3,7);
  for(let i=3;i<6;i++){const s=this.slots[i];if(!s)continue;const c=this.cookInfo(s);if(!c||s.uses<c.consume||this.myTemp<c.cookTempMin)continue;this.consume(i,c.consume);if(c.count>0)this.add(c.cooked,c.count,i-3);}
  // Stops when an output stack (slots 0-2) or the charcoal slot is full.
  let full=false;for(let j=0;j<3;j++){const s=this.slots[j];if(s&&s.uses===this.item(s)._maxUses){full=true;break;}}
  const ch=this.slots[7];if(!full&&ch&&ch.uses===this.item(ch)._maxUses)full=true;
  if((usedUp&&!this.hasFuel())||full)this.setOn(false,now);
 }
 // FireBarrel quick use: extinguish if lit, ignite if fuelled, otherwise open.
 quick(now){if(this.isOn){this.setOn(false,now);return 'extinguished';}if(this.hasFuel()){this.trySetOn(true,now);return 'ignited';}return 'open';}
 menu(){const out=[];if(this.isOn)out.push('Extinguish');else if(this.hasFuel())out.push('Ignite');out.push('Open');return out;}
}

// A placed deployable. Slots/behaviour depend on the prefab's original components.
export class DeployedObject {
 constructor(system,itemKey,entry,prefab,position,rotation,now){
  this.system=system;this.itemKey=itemKey;this.entry=entry;this.prefab=prefab;this.position=position.clone();this.rotation=rotation.clone();
  this.matrix=unityMatrix(position,rotation,prefab.rootScale);this.kind=deployableKind(prefab);this.destroyed=false;
  // No TakeDamage on the prefab (the Explosive Charge) = cannot be hurt; a plain TakeDamage has no armour.
  const td=takeDamageData(prefab);this.takeDamage=td?new TakeDamage(td):null;
  const dep=deployableData(prefab)??{};this.cantPlaceOn=Boolean(dep.cantPlaceOn);this.tag=prefab.nodes[0].tag;this.handleDeathHere=Boolean(dep.handleDeathHere);
  const loot=component(prefab,'LootableObject')??component(prefab,'FireBarrel')??component(prefab,'Furnace');
  this.slots=loot?Array(this.kind==='campfire'?8:loot.NumberOfSlots).fill(null):null;
  if(this.kind==='campfire'||this.kind==='furnace')this.fire=new FireBarrel(this,{items:system.items,rng:system.rng,furnace:this.kind==='furnace'});
  // Bed.Awake sets spawnDelay 180; beds spawn 0.4 m up and only under a structure (Bed.IsValidToSpawn).
  if(this.kind==='respawn'){const bed=component(prefab,'Bed'),s=bed??component(prefab,'SleepingBag')??component(prefab,'DeployedRespawn');this.bed=Boolean(bed);this.spawnDelay=bed?180:s?.spawnDelay??240;this.lastSpawnTime=-Infinity;this.giveItemName=s?.giveItemName;}
  this.hardpoints=hardpointsOf(prefab,new Matrix4().compose(position,rotation,new Vector3(prefab.rootScale.x,prefab.rootScale.y,prefab.rootScale.z)),this);this.carried=new Set();this.carrier=null;
  this.zones=(prefab.colliders??[]).filter(c=>c.trigger&&c.type==='SphereCollider').map(c=>{const kinds=Object.keys(prefab.components).filter(k=>prefab.components[k].some(x=>x.node===c.node));return {kinds,center:toU(new Vector3(...c.center).applyMatrix4(new Matrix4().fromArray(c.matrix)).applyMatrix4(this.matrix)),radius:c.radius*Math.max(...prefab.nodes[c.node].scale)*prefab.rootScale.x};});
 }
 // HeatZone / WorkZone: OnTriggerStay with the player's collider (heat only while the fire burns). The server player's
 // root carries the only collider with Metabolism/CraftingInventory on its GameObject: HumanController adds a default
 // SphereCollider (radius 0.5 at the origin, the feet) and a kinematic Rigidbody; the CCMotor's CCDesc controllers are
 // separate objects. So the zone is entered while the two spheres overlap.
 inZone(kind,pointU){if(kind==='HeatZone'&&!(this.fire?.isOn))return false;return this.zones.some(z=>z.kinds.includes(kind)&&z.center.distanceTo(pointU)<=z.radius+PLAYER_TRIGGER_RADIUS);}
 // DeployedRespawn.IsValidToSpawn / CooldownTimeLeft
 canSpawn(now){return now>this.lastSpawnTime+this.spawnDelay&&(!this.bed||Boolean(this.system.roofed?.(this)));}
 spawnPosition(){return this.position.clone().add(new Vector3(0,this.bed?0.4:0,0));}
 cooldown(now){return Math.min(Math.max(this.lastSpawnTime+this.spawnDelay-now,0),this.spawnDelay);}
 get health(){return this.takeDamage?.health??0;}
 set health(v){if(this.takeDamage)this.takeDamage.health=v;}
 get maxHealth(){return this.takeDamage?.maxHealth??0;}
 get armor(){return this.takeDamage?.armor??null;}
 get dead(){return Boolean(this.takeDamage?.dead);}
 // TakeDamage.Hurt: (amount, typeIndex) or a DamageTypeList, or plain health points (EnvDecay's HurtSelf). Returns the
 // damage applied. OnHurt -> UpdateClientHealth (dimmer); WasKilled -> DeployableObject.OnKilled.
 // `attacker` (a character target: Unity position, hurt(types, attacker)) is DamageEvent.attacker for SpikeWall.OnHurt.
 hurt(amount,typeIndex,attacker=null){if(this.destroyed||!this.takeDamage){this.lastHurt=FAILED_HURT;return 0;}
  const before=this.health,e=this.takeDamage.hurt(quantityOf(amount,typeIndex),this.system.now?.()??null);this.lastHurt=e;
  if(this.health!==before)this.system.onHurt?.(this,e);/* UpdateClientHealth sends only on a change */
  // TakeDamage.Hurt relays OnHurt (sendMessageWhenAlive/WhenKilled; not when already dead) before OnKilled. SpikeWall.OnHurt:
  // damage with the melee flag (melee swings, arrows) from a character within 8 m comes back to them as
  // amount × returnFraction + baseReturnDmg melee damage (TakeDamage.Hurt(this, attacker, DamageTypeList)).
  if(this.spike&&attacker?.position&&(e.status===LifeStatus.IsAlive||e.status===LifeStatus.WasKilled)){
   const back=this.spike.reflect({amount:e.amount,melee:(e.flags&DAMAGE_MELEE_FLAG)!==0,distance:attacker.position.distanceTo(this.position)});if(back>0)attacker.hurt?.([0,0,back,0,0,0],this);}
  if(e.status===LifeStatus.WasKilled)this.onKilled(e);return e.amount;}
 // DeployableObject.OnKilled: only with handleDeathHere — Client_OnKilled (clientDeathEffect, 5 s) when it has one,
 // NetCull.Destroy, then corpseObject (DeployableCorpse, 300 s) at the same position/rotation. Without handleDeathHere
 // (Metal Window Bars) nothing handles the death: the object stays in the world at 0 health. Its loot is not dropped.
 onKilled(e=null){if(!this.handleDeathHere||this.destroyed)return;const dep=deployableData(this.prefab)??{};
  this.system.onKilled?.(this,{event:e,deathEffect:dep.deathEffect??null,corpse:dep.corpse??null});this.destroy();
  if(dep.corpse)this.system.spawnCorpse?.(dep.corpse,this.position,this.rotation);}
 // DeployableObject.OnDestroy leaves its carrier; TransCarrier.DropObjects NetCull.Destroys everything it carries.
 destroy(){if(this.destroyed)return;this.destroyed=true;this.carrier?.carried.delete(this);this.system.remove(this);for(const o of [...this.carried])o.destroy();this.carried.clear();}
}

export class DeployableSystem {
 constructor(manifest,items,{rng=Math.random,onAdd,onRemove,onHurt,onKilled,spawnCorpse,now}={}){this.now=now;this.manifest=manifest;this.items=items;this.rng=rng;this.onAdd=onAdd;this.onRemove=onRemove;this.onHurt=onHurt;this.onKilled=onKilled;this.spawnCorpse=spawnCorpse;this.objects=new Set();}
 entryFor(itemKey){return this.manifest.deployables[itemKey]??null;}
 place(itemKey,position,rotation,now,carrier=null){const entry=this.entryFor(itemKey),prefab=this.manifest.prefabs[entry.prefab];const o=new DeployedObject(this,itemKey,entry,prefab,position,rotation,now);this.objects.add(o);
  // SetupDeployableObject: the placement carrier always takes it; otherwise GrabCarrier (5 m down) unless neverGrabCarrier.
  if(!carrier?.carried&&!entry.placement.neverGrabCarrier)carrier=this.grabCarrier?.(o)??null;
  if(carrier?.carried){o.carrier=carrier;carrier.carried.add(o);}this.onAdd?.(o);
  // DeployedRespawn.CreatorSet + SleepingBag.MarkSpawnedOn are not involved on placement; fires start unlit (startOn false).
  if(o.fire&&component(prefab,o.kind==='furnace'?'Furnace':'FireBarrel')?.startOn)o.fire.trySetOn(true,now);return o;}
 remove(o){this.objects.delete(o);this.onRemove?.(o);}
 update(now){for(const o of this.objects)o.fire?.update(now);}
 near(posU,radius,tag){for(const o of this.objects)if(o.tag===tag&&o.position.distanceTo(posU)<radius)return o;return null;}
 warm(pointU){for(const o of this.objects)if(o.inZone('HeatZone',pointU))return true;return false;}
 atWorkbench(pointU){for(const o of this.objects)if(o.inZone('WorkZone',pointU))return true;return false;}
 respawns(){return [...this.objects].filter(o=>o.kind==='respawn');}
 // RustServerManagement.GetCampSpawnForPlayer: newest valid spawn first; position + 0.25 m. Null falls back to a random spawn.
 campSpawn(now){const list=this.respawns();for(let i=list.length-1;i>=0;i--){const o=list[i];if(!o.canSpawn(now))continue;
  o.lastSpawnTime=now;if(!o.bed)for(const other of list)if(!other.bed&&other.position.distanceTo(o.position)<100)other.lastSpawnTime=now;
  return {position:o.spawnPosition().add(new Vector3(0,0.25,0)),rotation:o.rotation.clone(),object:o};}
  return null;}
}
