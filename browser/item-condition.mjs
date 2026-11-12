// Item condition rules of the original server (decompiled server InventoryItem.SetCondition / ConditionChanged /
// TryConditionLoss, HeldItem.ConditionChanged / CanSetActivate, ArmorItem.ConditionChanged / CanMoveToSlot, the
// conditionloss convars and the callers' loss values). Offline the page is the server. Condition is 0..maxCondition
// per instance (loadouts may carry the datablock's 100, read as full).

// conditionloss.cs [Admin] defaults; caller constants: BulletWeaponDataBlock (0.33, 0.01), ShotgunDataBlock (0.5, 0.02),
// MeleeWeaponDataBlock.DoAction1 on a hit network entity (0.25, 0.025), HumanBodyTakeDamage.Hurt on bullet/melee/
// explosion damage to each worn armour piece (0.75, amount / 100 * armorhealthmult * Random.Range(0.8, 1.2)).
export const CONDITION_LOSS=Object.freeze({damagemultiplier:1,armorhealthmult:0.25,bullet:[0.33,0.01],shotgun:[0.5,0.02],melee:[0.25,0.025],armorProbability:0.75});
export const BROKEN_NOTICE=Object.freeze({icon:'',active:'Active item has broken! - Repair it',destroyed:'Item completely destroyed.'});
export const conditionOf=slot=>slot.condition>1?1:slot.condition??1;
export const maxConditionOf=slot=>slot.maxCondition>1?1:slot.maxCondition??1;
// InventoryItem.IsBroken: condition <= GetConditionForBreak() (0).
export const isBroken=slot=>conditionOf(slot)<=0;
// HeldItem.CanSetActivate: a broken item is never activated (held).
export const canActivate=slot=>Boolean(slot)&&!isBroken(slot);
// ArmorItem.CanMoveToSlot: a broken armour item may not move into an equipment slot (36-39) of a player inventory.
export const armorSlotAllowed=(catalogueItem,slot,index)=>!(catalogueItem?.class==='ArmorDataBlock'&&index>=36&&index<40&&slot&&isBroken(slot));
// Unity Random.Range(0f, 1f) is inclusive at both ends.
const range01=rng=>rng();

// InventoryItem.SetCondition(newcondition): Mathf.Clamp(newcondition, 0, maxcondition), then ConditionChanged(old) of the
// item's class. inv: {slots, catalogue}. ctx: {rng, active (this slot is the held item), notice(icon, text),
// deactivate(), drop(slot, index) (DropHelper.DropItem, called while the item is still in its slot)}. Returns what happened: {moved, dropped, deactivated, destroyed}.
export function setCondition(inv,index,value,ctx={}){const slot=inv.slots[index];if(!slot)return null;const rng=ctx.rng??Math.random,item=inv.catalogue.items[slot.item],out={moved:null,dropped:false,deactivated:false,destroyed:false};
 const old=conditionOf(slot),max=maxConditionOf(slot);slot.condition=Math.min(max,Math.max(0,value));let at=index;
 // ArmorItem.ConditionChanged: at zero the piece moves to the first free slot 0-29, or is dropped (DropHelper.DropItem).
 if(item?.class==='ArmorDataBlock'&&slot.condition<=0){const free=inv.slots.findIndex((s,i)=>i<30&&!s);
  if(free>=0){if(free!==index){inv.slots[free]=slot;inv.slots[index]=null;at=free;}out.moved=free;}else{ctx.drop?.(slot,index);if(inv.slots[index]===slot)inv.slots[index]=null;out.dropped=true;return out;}}
 // HeldItem.ConditionChanged: the active item breaking is put away with a popup.
 if(ctx.active&&isBroken(slot)){ctx.deactivate?.();ctx.notice?.(BROKEN_NOTICE.icon,BROKEN_NOTICE.active);out.deactivated=true;}
 // InventoryItem.ConditionChanged: once maxcondition is below 0.15 a loss may destroy the item (always at <= 0.05).
 if(maxConditionOf(slot)<0.15&&slot.condition<old){const r=range01(rng),threshold=maxConditionOf(slot)<=0.05?0:0.5;
  if(r>threshold){ctx.notice?.(BROKEN_NOTICE.icon,BROKEN_NOTICE.destroyed);if(inv.slots[at]===slot)inv.slots[at]=null;out.destroyed=true;}}
 return out;}

// InventoryItem.TryConditionLoss(probability, percentLoss): only datablocks with doesLoseCondition; Random.Range(0, 1) <=
// probability loses percentLoss * conditionloss.damagemultiplier. Returns the setCondition result, or null when nothing
// was lost.
export function tryConditionLoss(inv,index,probability,percentLoss,ctx={}){const slot=inv.slots[index];if(!slot)return null;const d=inv.catalogue.items[slot.item]?.data;
 if(!d?.doesLoseCondition)return null;const rng=ctx.rng??Math.random;if(!(probability>=range01(rng)))return null;
 return setCondition(inv,index,conditionOf(slot)-percentLoss*(ctx.multiplier??CONDITION_LOSS.damagemultiplier),ctx);}

// HumanBodyTakeDamage.Hurt: bullet, melee or explosion damage wears every worn armour slot (Feet, Legs, Torso, Head).
// types: DamageTypeList values [generic, bullet, melee, explosion, radiation, cold]; amount: the damage dealt.
export function armorConditionLoss(inv,types,amount,ctx={}){if(![1,2,3].some(i=>Math.abs(types?.[i]??0)>1e-6))return [];const rng=ctx.rng??Math.random,num=amount/100*(ctx.armorhealthmult??CONDITION_LOSS.armorhealthmult),out=[];
 for(const index of [39,38,37,36]){const slot=inv.slots[index];if(!slot||inv.catalogue.items[slot.item]?.class!=='ArmorDataBlock')continue;
  const loss=num*(0.8+0.4*rng()),r=tryConditionLoss(inv,index,CONDITION_LOSS.armorProbability,loss,ctx);if(r)out.push({index,...r});}
 return out;}
