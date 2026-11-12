// Belt keys offline, where the page plays the server: the client's InventoryHolder.BeltUse gate, then DoBeltUse ->
// IInventoryItem.OnBeltUse of the item's class (decompiled client and server). Online the same key sends DoBeltUse.
import {lineage} from './tooltip.mjs';
import {canActivate} from './item-condition.mjs';

const is=(cls,base)=>lineage(cls).includes(base);
export const isHeldItem=cls=>is(cls,'HeldItemDataBlock');
// Items whose OnBeltUse runs their datablock's UseItem (ConsumableItem, BasicHealthKit, BloodDrawItem, BlueprintItem).
const USE_ITEM=['ConsumableDataBlock','BasicHealthKitDataBlock','BloodDrawDatablock'];

// inventory: {slots, selected, catalogue}; selected -1 = no active item (empty hands).
// ctx: {canDeactivate() (the active held item's CanSetActivate(false)), useItem(index), study(index), repair(index),
// lockpick(index)}. Returns what happened.
// InventoryHolder.BeltUse (client) before it sends DoBeltUse: the belt slot holds an item and, for a held item, it can
// change state (active ? canDeactivate : canActivate; a broken one cannot be activated). ValidateAntiBeltSpam never fails
// (timeInMillis + 800 >= lastItemUseTime). Online this gate runs before the request (server-inventory.mjs selectBelt).
export function beltUseAllowed(inventory,index,{canDeactivate=()=>true}={}){const slot=inventory.slots[index];if(!slot)return false;
 if(!isHeldItem(inventory.catalogue.items[slot.item]?.class))return true;return inventory.selected===index?Boolean(canDeactivate()):canActivate(slot);}
export function beltUse(inventory,index,ctx){const slot=inventory.slots[index];if(!slot)return 'empty';const cls=inventory.catalogue.items[slot.item]?.class;
 if(isHeldItem(cls)){const active=inventory.selected===index,current=inventory.slots[inventory.selected];
  // BeltUse (client): a held item is sent only when it can change state (a broken one cannot be activated: no popup).
  if(!beltUseAllowed(inventory,index,ctx))return 'blocked';
  // HeldItem.OnBeltUse: the active item is put away; another one is taken out unless the active item can't be put away.
  if(active){inventory.selected=-1;return 'deactivated';}
  if(current&&isHeldItem(inventory.catalogue.items[current.item]?.class)&&!ctx.canDeactivate())return 'blocked';
  inventory.selected=index;return 'activated';}
 if(is(cls,'BlueprintDataBlock'))return ctx.study(index)?'used':'none';
 if(USE_ITEM.some(c=>is(cls,c)))return ctx.useItem(index)?'used':'none';
 if(is(cls,'ResourceTypeItemDataBlock'))return ctx.repair(index)?'used':'none';
 if(is(cls,'LockpickItemDataBlock')){ctx.lockpick(index);return 'used';}
 return 'none';} // InventoryItem.OnBeltUse: nothing

// ResourceTypeItem.OnBeltUse (2 s after its last repair) -> ResourceTypeItemDataBlock.UseItem. target: what the eyes'
// 0.5 m sphere cast (4 m) hit: {repairAmmo, resForMaxHealth, takeDamage} (RepairReceiver + TakeDamage) or null.
// state: per item instance ({lastUseTime}). Returns the healed amount (the caller consumes one) or null.
export function resourceRepair(state,itemKey,target,now,notice){
 if(now-(state.lastUseTime??-Infinity)<2)return null;
 const td=target?.takeDamage;if(!td||target.repairAmmo!==itemKey||td.health===td.maxHealth)return null;
 if(td.timeSinceHurt(now)<5){notice("Can't repair - Being damaged");return null;}
 let amount=td.maxHealth/target.resForMaxHealth;if(amount>td.maxHealth-td.health)amount=td.maxHealth-td.health;
 td.heal(amount);state.lastUseTime=now;
 notice(`Healed ${Math.trunc(amount)} (${Math.trunc(td.health)}/${Math.trunc(td.maxHealth)})`);return amount;}

// LockpickItem.OnBeltUse: a 5 m eyes ray. No shipped lock is pickable (only TimedLockable overrides IsPickable, and no
// prefab uses it), so a hit object says it can't be picked; a hit without an IDBase (world, terrain) says nothing.
export function lockpickNotice(hit){if(!hit)return 'Aim at a locked object.';return hit.idBase?"You can't lockpick this.":null;}
