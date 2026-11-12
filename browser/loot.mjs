import {Vector3,Quaternion,Matrix4,Ray} from 'three';
import {withModSlots,newCondition} from './inventory.mjs';
// Ports of decompiled LootableObjectSpawner, LootableObject, LootSpawnList, WeightSelection and the
// Inventory.Uses.Quantity.Manual rule. Times are seconds; `rng` returns [0,1) like Math.random.
const H=new Matrix4().makeScale(1,1,-1);

// UnityEngine.Random.Range: floats are inclusive, ints exclude max (and return min when max <= min).
export const randomFloat=(rng,min,max)=>min+(max-min)*rng();
export const randomInt=(rng,min,max)=>max<=min?min:min+Math.floor(rng()*(max-min));

// WeightSelection.RandomPickEntry / LootableObjectSpawner.RandomPick
export function weightedPick(rng,entries){
 let total=0;for(const e of entries)total+=e.weight;if(total===0)return null;
 let n=randomFloat(rng,0,total);for(const e of entries)if((n-=e.weight)<=0)return e;
 return entries.at(-1);
}

// Uses.Quantity.Manual(int) stores the amount as a byte, then CalculateCount clamps to [1, _maxUses].
export function manualUses(amount,item){const q=amount&255;return q===0?1:Math.min(q,item._maxUses);}

// LootSpawnList.PopulateInventory into a container of `slotCount` slots.
export function populateLoot(lists,listName,slotCount,items,rng=Math.random){
 const slots=Array(slotCount).fill(null),args={spawnCount:0,exhausted:slotCount===0};
 const vacant=()=>slots.indexOf(null);
 function add(key,amount){
  const item=items[key]?.data;if(!item)throw Error(`Unknown loot item ${key}`);
  // Slot.Preference.Define(spawnCount, stack:false, Default|Belt): the explicit slot first, then any vacancy.
  const slot=slots[args.spawnCount]===null&&args.spawnCount<slotCount?args.spawnCount:vacant();if(slot<0)return false;
  slots[slot]=withModSlots({item:key,uses:manualUses(amount,item),...newCondition()},item,rng);return true;
 }
 function recurse(list){
  const packages=list.packages,max=Math.min(list.maxPackagesToSpawn,packages.length);
  const count=list.spawnOneOfEach?packages.length:randomInt(rng,list.minPackagesToSpawn,max);
  for(let i=0;!args.exhausted&&i<count;i++){
   const entry=list.spawnOneOfEach?packages[i]:weightedPick(rng,packages);if(!entry)break;
   if(entry.item){if(add(entry.item,randomInt(rng,entry.amountMin,entry.amountMax+1))){args.spawnCount++;if(vacant()<0)args.exhausted=true;}}
   else if(entry.list)recurse(lists[entry.list]);
   // nullReference entries are picks of a null original object: nothing spawns.
  }
 }
 const list=lists[listName];if(list&&!args.exhausted)recurse(list);return slots;
}

// UnityEngine.Quaternion.LookRotation(forward, up): falls back to FromToRotation(z, forward) when degenerate.
export function lookRotation(forward,up=new Vector3(0,1,0)){
 const z=forward.clone();if(z.length()<1e-5)return new Quaternion();z.normalize();
 const x=new Vector3().crossVectors(up,z);
 if(x.length()<1e-5)return new Quaternion().setFromUnitVectors(new Vector3(0,0,1),z);
 x.normalize();const y=new Vector3().crossVectors(z,x);
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z));
}
// SpawnLootable placement: ground hit point, rotation LookRotation(normal) * Inverse(child(0).localRotation).
// Hit position/normal are browser space; the Unity-space transform is converted with H * M * H.
export function crateMatrix(prefab,hitPosition,hitNormal){
 const pos=new Vector3(hitPosition.x,hitPosition.y,-hitPosition.z),normal=new Vector3(hitNormal.x,hitNormal.y,-hitNormal.z);
 const c=prefab.child0LocalRotation,rotation=lookRotation(normal).multiply(new Quaternion(c.x,c.y,c.z,c.w).invert());
 const s=prefab.rootScale,unity=new Matrix4().compose(pos,rotation,new Vector3(s.x,s.y,s.z));
 return H.clone().multiply(unity).multiply(H);
}

// LootableObject.OnUseEnter: InvokeRepeating("RadialCheck", 0, 10) — every 10 s from the use, the user is ejected once their
// character is more than 5 m from the lootable (boxes, stashes, fires, furnaces, repair benches). due() is true on the eject.
export class RadialCheck {
 constructor(now){this.next=now;}
 due(now,userPosition,position){if(this.next===null||now<this.next)return false;this.next+=10;
  if(userPosition&&userPosition.distanceTo(position)>5){this.next=null;return true;}return false;}
}

export class LootCrate {
 constructor(system,spawner,prefabKey,matrix,now){
  this.system=system;this.spawner=spawner;this.prefabKey=prefabKey;this.prefab=system.manifest.prefabs[prefabKey];this.matrix=matrix;
  this.settings=this.prefab.lootable;this.slots=Array(this.settings.NumberOfSlots).fill(null);this.looter=null;this.destroyed=false;this.timers=new Map();
  this.position=new Vector3().setFromMatrixPosition(matrix);
  // InitializeServerState: TryAddLoot(); ResetInvokes()
  this.tryAddLoot();this.resetInvokes(now);
 }
 get anyOccupied(){return this.slots.some(Boolean);}
 tryAddLoot(){if(this.looter||this.anyOccupied)return;this.slots=populateLoot(this.system.manifest.lists,this.settings.spawnList,this.settings.NumberOfSlots,this.system.items,this.system.rng);}
 resetInvokes(now){if(this.settings.LootCycle>0)this.timers.set('loot',now);if(this.settings.lifeTime>0)this.timers.set('destroy',now+this.settings.lifeTime);}
 cancelInvokes(){this.timers.delete('loot');this.timers.delete('destroy');}
 // Client LootableObject.ContextText
 contextText(){return this.looter===null?'Search':'Occupied';}
 // OnUseEnter: occupy, cancel timers, RadialCheck every 10 s from now.
 useEnter(user,now){if(this.destroyed||this.looter)return false;this.looter=user;this.cancelInvokes();this.timers.set('radial',now);return true;}
 // OnUseExit: release, restart timers, destroy when empty and destroyOnEmpty (or lifeTime > 0).
 useExit(now){if(!this.looter)return;this.looter=null;this.resetInvokes(now);this.timers.delete('radial');if((this.settings.lifeTime>0||this.settings.destroyOnEmpty)&&!this.anyOccupied)this.destroy();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.looter=null;this.timers.clear();this.system.onDestroy?.(this);if(this.spawner.crate===this)this.spawner.crate=null;}
 update(now,userPosition){
  const loot=this.timers.get('loot');if(loot!==undefined&&now>=loot){this.tryAddLoot();this.timers.set('loot',loot+this.settings.LootCycle);}
  const destroy=this.timers.get('destroy');if(destroy!==undefined&&now>=destroy){this.destroy();return;}
  const radial=this.timers.get('radial');
  // RadialCheck: eject the looter once they are more than 5 m away.
  if(radial!==undefined&&now>=radial){if(this.looter&&userPosition&&userPosition.distanceTo(this.position)>5){const looter=this.looter;this.useExit(now);this.system.onEject?.(this,looter);return;}this.timers.set('radial',radial+10);}
 }
}

export class LootSystem {
 constructor(manifest,items,ground,{rng=Math.random,onSpawn,onDestroy,onEject}={}){
  this.manifest=manifest;this.items=items;this.ground=ground;this.rng=rng;this.onSpawn=onSpawn;this.onDestroy=onDestroy;this.onEject=onEject;
  this.spawners=manifest.spawners.map(s=>({...s,crate:null,next:null}));this.crates=new Set();
 }
 // OnServerLoad
 start(now){for(const s of this.spawners){if(s.spawnOnStart)this.spawn(s,now);else s.next=now+s.spawnTimeMax*60;}}
 // SpawnLootable: always reschedules in [min,max] minutes; only spawns if the previous crate is gone.
 spawn(spawner,now){
  spawner.next=now+randomFloat(this.rng,spawner.spawnTimeMin,spawner.spawnTimeMax)*60;
  if(spawner.crate)return null;
  const pick=weightedPick(this.rng,spawner.chances);if(!pick)return null;
  const p=spawner.position,hit=this.ground(new Ray(new Vector3(p[0],p[1]+0.25,p[2]),new Vector3(0,-1,0)),1000);
  const position=hit?hit.position:new Vector3(...p),normal=hit?hit.normal:new Vector3(0,1,0);
  const crate=new LootCrate(this,spawner,pick.prefab,crateMatrix(this.manifest.prefabs[pick.prefab],position,normal),now);
  spawner.crate=crate;this.crates.add(crate);this.onSpawn?.(crate);return crate;
 }
 update(now,userPosition){
  for(const s of this.spawners)if(s.next!==null&&now>=s.next)this.spawn(s,now);
  for(const c of [...this.crates]){c.update(now,userPosition);if(c.destroyed)this.crates.delete(c);}
 }
}
