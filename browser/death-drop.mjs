import {Vector3,Matrix4} from 'three';
import {lookRotationForcedUp} from './resources.mjs';
import {lookRotation} from './loot.mjs';
// Offline port of server DropHelper.DropInventoryContents (CharacterDeathDropPrefabTrait ";drop_lootsack"),
// Inventory.GenerateOptimizedInventoryListing / Report / Shuffle / ResetToReport and the LootableObject timers.
// Online the server owns the drop. Positions/rotations are Unity space; the matrix is converted like other prefabs.
const H=new Matrix4().makeScale(1,1,-1);
export const DEATH_DROP_PREFAB=';drop_lootsack';
export const DEATH_DROP_LIFETIME=1800; // DropHelper: component.lifeTime = 1800f (set after instantiation)
// ItemDataBlock.untransferable: (transientMode & Untransferable(2)) == 2 (item-ops.mjs, shared with DropItem and saves).
import {transferable} from './item-ops.mjs';
export {transferable};

// Report.Take + Report.Build over Default|Belt|Armor (slots 0..39) in occupied-slot order. Splittable stacks of one
// datablock are summed into a chain; an overflow past maxUses starts a new report holding the item that overflowed.
// ResetToReport assigns with Opt.ReuseItem, which keeps each reported item's own uses, so stacks that were fully
// absorbed into an earlier report are not carried over (native behaviour). Untransferable items are never reported.
export function optimizedListing(slots,items){
 const dict=new Map();
 for(const item of slots.slice(0,40)){if(!item)continue;const d=items[item.item]?.data;if(!d)continue;let entry=dict.get(item.item);
  if(entry){const report=entry.first;
   if(entry.splittable){const total=report.amount+item.uses;if(total>d._maxUses){const next={amount:total-entry.maxUses,item,typeNext:report};report.amount=entry.maxUses;entry.first=next;entry.length++;}else report.amount=total;}
   else{entry.first={amount:item.uses,item,typeNext:report};entry.length++;}
   continue;}
  if(!transferable(d))continue;
  const report={amount:item.uses,item,typeNext:null,splittable:Boolean(d._splittable),maxUses:d._maxUses,length:1};report.first=report;dict.set(item.item,report);}
 const out=[];for(const entry of dict.values()){let r=entry.first;for(let i=0;i<entry.length;i++){out.push(r.item);r=r.typeNext;}}return out;
}
// Inventory.Shuffle.Array: System.Random.Next(n) is in [0, n).
export function shuffle(array,rng=Math.random){for(let n=array.length-1;n>0;n--){const j=Math.floor(rng()*n);if(j!==n)[array[n],array[j]]=[array[j],array[n]];}return array;}
// GenerateOptimizedInventoryListing(..., randomize:true) then ResetToReport: the sack is sized to the listing, item i in slot i.
export function deathDropSlots(slots,items,rng=Math.random){return shuffle(optimizedListing(slots,items),rng).map(item=>({...item,mods:item.mods?[...item.mods]:item.mods}));}
// TransformHelpers.GetGroundInfo(transform): ray from 0.25 m above the character straight down 1000 m;
// rotation TransformHelpers.LookRotationForcedUp(character.forward, normal).
export function dropTransform(feetU,forwardU,ground){const hit=ground(new Vector3(feetU.x,feetU.y+0.25,feetU.z),1000);
 const position=hit?hit.point.clone():feetU.clone(),normal=hit?hit.normal.clone():new Vector3(0,1,0);
 return {position,rotation:lookRotationForcedUp(forwardU.clone(),normal)};}

// LootableObject on the instantiated sack. InitializeServerState runs inside InstantiateStatic, before DropHelper raises
// lifeTime, so the first DelayedDestroy uses the prefab's 600 s; every OnUseExit re-arms it with 1800 s. A mutant's
// sack keeps its prefab lifetime (raisedLifetime null): HostileWildlifeAI never changes it.
export class DeathDrop {
 constructor(prefab,slots,position,rotation,now,{raisedLifetime=DEATH_DROP_LIFETIME}={}){
  const loot=prefab.components.LootableObject[0].data;this.prefab=prefab;this.slots=slots;this.position=position.clone();this.rotation=rotation.clone();
  const s=prefab.rootScale;this.matrix=H.clone().multiply(new Matrix4().compose(position,rotation,new Vector3(s.x,s.y,s.z))).multiply(H);
  this.settings={LootCycle:0,lifeTime:loot.lifeTime,destroyOnEmpty:Boolean(loot.destroyOnEmpty)};this.looter=null;this.destroyed=false;this.timers=new Map();
  this.resetInvokes(now);if(raisedLifetime!=null)this.settings.lifeTime=raisedLifetime;
 }
 get anyOccupied(){return this.slots.some(Boolean);}
 resetInvokes(now){if(this.settings.lifeTime>0)this.timers.set('destroy',now+this.settings.lifeTime);}
 cancelInvokes(){this.timers.delete('destroy');}
 contextText(){return this.looter===null?'Search':'Occupied';}
 useEnter(user,now){if(this.destroyed||this.looter)return false;this.looter=user;this.cancelInvokes();this.timers.set('radial',now);return true;}
 useExit(now){if(!this.looter)return;this.looter=null;this.resetInvokes(now);this.timers.delete('radial');if((this.settings.lifeTime>0||this.settings.destroyOnEmpty)&&!this.anyOccupied)this.destroy();}
 destroy(){if(this.destroyed)return;this.destroyed=true;this.looter=null;this.timers.clear();this.onDestroy?.(this);}
 // DelayedDestroy and RadialCheck (eject past 5 m, checked every 10 s).
 update(now,userPositionU){const destroy=this.timers.get('destroy');if(destroy!==undefined&&now>=destroy){this.destroy();return null;}
  const radial=this.timers.get('radial');if(radial!==undefined&&now>=radial){if(this.looter&&userPositionU&&userPositionU.distanceTo(this.position)>5){this.useExit(now);return 'eject';}this.timers.set('radial',radial+10);}return null;}
}
// DropHelper.DropInventoryContents: nothing is created for an empty inventory; the character inventory is always cleared.
export function dropInventoryContents(inventory,prefab,{feetU,forwardU,ground,now,rng=Math.random}){
 const any=inventory.slots.some(Boolean);let drop=null;
 if(any&&prefab){const slots=deathDropSlots(inventory.slots,inventory.catalogue.items,rng);if(slots.length){const t=dropTransform(feetU,forwardU,ground);drop=new DeathDrop(prefab,slots,t.position,t.rotation,now);}}
 if(any){inventory.slots=inventory.slots.map(()=>null);inventory.cancelCraft?.();}
 return drop;
}

// TransformHelpers.LookRotationForcedUp(Quaternion rotation, Vector3 up), with the rotation given as its forward and up
// axes (Unity's right = Cross(up, forward)): keep whichever of the rotation's forward or right axis lies flatter against
// `up` as the facing, then LookRotation(that, up). Falls back to the rotation itself when degenerate.
const EPS=1.401298e-45;
export function lookRotationForcedUpQ(forwardU,upU,up){
 const self=()=>lookRotation(forwardU,upU);
 if(up.lengthSq()<EPS)return self();
 const n=up.clone().normalize(),f=forwardU.clone(),r=new Vector3().crossVectors(upU,forwardU);
 const df=f.dot(n),dr=r.dot(n);
 const a=df*df>dr*dr?new Vector3().crossVectors(n,r).negate().normalize():f;
 const side=new Vector3().crossVectors(a,n).normalize(),facing=new Vector3().crossVectors(n,side);
 return facing.lengthSq()<EPS?self():lookRotation(facing,n);
}
// HostileWildlifeAI.OnKilled: a random direction on the ground plane, GetGroundInfo 1.5 m out (a ray from 0.25 m above,
// 100 m down), InstantiateStatic(dropOnDeathString) facing LookRotationForcedUp(rotation, normal). The sack's
// LootableObject fills itself from its spawn list as it is created (TryAddLoot); a sack that rolled nothing is destroyed
// at once. `populate(listName, slots)` is LootSpawnList.PopulateInventory (loot.mjs populateLoot).
export function hostileDeathDrop(prefab,{positionU,forwardU,upU,ground,now,rng=Math.random,populate}){
 const loot=prefab?.components?.LootableObject?.[0]?.data;if(!loot)return null;
 const f=rng()*Math.PI*2,start=positionU.clone().add(new Vector3(Math.cos(f),0,Math.sin(f)).multiplyScalar(1.5));
 const hit=ground(new Vector3(start.x,start.y+0.25,start.z),100);
 const position=hit?hit.point.clone():new Vector3(start.x,start.y+0.25,start.z),normal=hit?hit.normal.clone():new Vector3(0,1,0);
 const list=loot._lootSpawnListName?.name,slots=list?populate(list,loot.NumberOfSlots):Array(loot.NumberOfSlots).fill(null);
 if(!slots.some(Boolean))return null;
 return new DeathDrop(prefab,slots,position,lookRotationForcedUpQ(forwardU,upU,normal),now,{raisedLifetime:null});
}

