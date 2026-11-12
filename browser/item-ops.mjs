// Item slot operations and right-click menu options, ported from the decompiled client/server Assembly-CSharp:
// Inventory.SlotOperation / ItemMergePredicted / ItemCombinePredicted / ItemMovePredicted (client Inventory.cs:4835-5135,
// server Inventory.cs:5235-5600), InventoryItem.TryStack/TryCombine, ItemModItem.TryCombine, ResearchToolItem.TryCombine,
// ItemDataBlock.RetreiveMenuOptions/ExecuteMenuOption and the per-class overrides (Blueprint, BulletWeapon, Consumable,
// BasicHealthKit, BloodDraw, Bandage), Inventory.SplitStack, BlueprintDataBlock.UseItem and BloodDrawDatablock.UseItem.
//
// The original always predicts on the client first and sends the RPC only when the prediction is > NoOp. The server then
// runs the same SlotOperation. Here `side:'client'` never mutates (online the GNUP snapshot is the only slot writer) and
// returns the predicted result plus the client's own popups; `side:'server'` applies the server rules (offline play).

export const MENU={Info:1,Status:2,Use:3,Study:4,Split:5,Eat:6,Drink:7,Consume:8,Unload:9};
export const OPS={Stack:1,Combine:2,Move:4};
export const RESULT={NoOp:0,Stacked:1,Combined:2,Moved:4,OccupiedDestination:-8,SameSlot:-7,MissingInventory:-6,EmptySourceSlot:-5,EmptyDestinationSlot:-4,NoOpArgs:-2,Failed:-1};
// Inventory.SlotOperationsMerge: tryCombine=false → Stack, true → Stack|Combine. Moves to an empty cell use Move only.
export const mergeOps=tryCombine=>tryCombine?OPS.Stack|OPS.Combine:OPS.Stack;

const BULLET=new Set(['BulletWeaponDataBlock','ShotgunDataBlock','StrikeGunDataBlock']);
const MOD=new Set(['ItemModDataBlock','BaseWeaponModDataBlock']);
const CONSUMABLE='ConsumableDataBlock';
export const isBulletWeapon=entry=>BULLET.has(entry?.class);
// ItemDataBlock.TransientMode (Full 0, DoesNotSave 1, Untransferable 2, None 3 = both; ItemDataBlock.cs ~120-181). The
// export carries transientMode only. Uber Hatchet, Uber Hunting Bow and the Invisible armour are 3.
export const transferable=d=>((d?.transientMode??0)&2)!==2; // !ItemDataBlock.untransferable
export const savesItem=d=>((d?.transientMode??0)&1)!==1; // ItemDataBlock.saves (!doesNotSave)

// A PPtr inside an exported datablock: m_FileID 0 points into the same serialized file as the owner.
export function resolveItemRef(catalogue,ownerKey,ref){if(!ref?.m_PathID)return null;
 if(!ref.m_FileID){const same=ownerKey.slice(0,ownerKey.lastIndexOf(':'))+':'+ref.m_PathID;if(catalogue.items[same])return same;}
 return Object.keys(catalogue.items).find(k=>k.endsWith(':'+ref.m_PathID))??null;}
// BlueprintDataBlock.FindBlueprintForItem: the first blueprint whose resultItem is the item.
export function findBlueprintFor(catalogue,itemKey){return Object.keys(catalogue.blueprints).find(k=>catalogue.blueprints[k].result===itemKey)??null;}
const nameOf=(catalogue,key)=>catalogue.items[key]?.data.m_Name??'';

// ConsumableDataBlock.GetConsumeMenuItem.
export function consumeOption(d){if(d.calories>0&&d.litresOfWater<=0)return 'Eat';if(d.litresOfWater>0&&d.calories<=0)return 'Drink';return 'Consume';}
// RPOSItemRightClickMenu.SetItem → datablock.RetreiveMenuOptions(item): base Split first, then the subclass entry. Every
// entry needs item.isInLocalInventory (the player's own inventory), so loot cells show no options. Info is never listed
// (no RetreiveMenuOptions adds it, and RPOS.OpenInfoWindow is an empty method in this build).
export function menuOptions(entry,slot,{local=true}={}){if(!entry||!slot||!local)return [];const d=entry.data,out=[];
 if(d._splittable&&slot.uses>1)out.push('Split');
 switch(entry.class){
  case 'BlueprintDataBlock':out.push('Study');break;
  case CONSUMABLE:out.push(consumeOption(d));break;
  case 'BasicHealthKitDataBlock':case 'BloodDrawDatablock':case 'BandageDataBlock':out.push('Use');break;
  default:if(BULLET.has(entry.class))out.push('Unload');
 }
 return out;}

const usedMods=s=>s.mods?.length??s.usedModSlots??0;
// A slot box: {slots, accepts(index,key), player} — `player` marks the local PlayerInventory (ResearchToolItem requires it).
const vacant=box=>box.slots.reduce((n,s)=>n+(s?0:1),0);

// InventoryItem<T>.TryStack (identical on both builds). Returns 'Merged' or 'Failed'.
function tryStack(catalogue,src,dst,mutate){const a=src.box.slots[src.index],b=dst.box.slots[dst.index],d=catalogue.items[a.item].data;
 if(!a.uses||b.item!==a.item||b.uses===d._maxUses||!d._splittable)return 'Failed';
 const added=Math.min(a.uses,Math.max(0,d._maxUses-b.uses));if(!added)return 'Failed';
 if(mutate){b.uses+=added;a.uses-=added;if(a.uses<=0)src.box.slots[src.index]=null;}
 return 'Merged';}

// Server InventoryItem<T>.TryCombine: Combinations recipe dropped onto `other`. Always returns Failed (also after
// combining), and the client build's prediction returns Failed too, so a native client never sends the RPC for a
// recipe combine; `combineRecipe` is the server effect for completeness.
export function combineRecipe(catalogue,src,dst,{mutate=true}={}){const a=src.box.slots[src.index],b=dst.box.slots[dst.index],srcKey=a.item;
 const recipe=(catalogue.items[srcKey].data.Combinations??[]).find(r=>resolveItemRef(catalogue,srcKey,r.droppedOnType)===b.item);if(!recipe)return {result:'Failed',combined:0};
 const resultKey=resolveItemRef(catalogue,srcKey,recipe.resultItem);if(!resultKey)return {result:'Failed',combined:0};
 if(b.uses<recipe.amountToLoseOther||a.uses<recipe.amountToLose)return {result:'Failed',combined:0};
 const n=Math.min(Math.trunc(a.uses/recipe.amountToLose),Math.trunc(b.uses/recipe.amountToLoseOther));
 // num3 = splittable ? Mathf.CeilToInt(num2 / 0f) : num2. Infinity → int.MinValue under Mono, so a splittable result
 // always passes the vacancy check; NaN (num2 = 0) does too.
 const needed=catalogue.items[resultKey].data._splittable?-2147483648:n;if(needed>vacant(dst.box))return {result:'Failed',combined:0};
 if(mutate){b.uses-=Math.min(b.uses,n*recipe.amountToLoseOther);if(b.uses<=0)dst.box.slots[dst.index]=null;
  addAmount(catalogue,dst.box,resultKey,n);a.uses-=Math.min(a.uses,n*recipe.amountToLose);if(a.uses<=0)src.box.slots[src.index]=null;}
 return {result:'Failed',combined:n,resultKey};}

// ItemModItem.TryCombine / ResearchToolItem.TryCombine / base recipe. ctx: {side, atWorkbench, known:Set, notice}.
function tryCombine(catalogue,src,dst,ctx){const a=src.box.slots[src.index],b=dst.box.slots[dst.index],entry=catalogue.items[a.item],target=catalogue.items[b.item],server=ctx.side==='server';
 if(MOD.has(entry.class)){
  if(b.totalModSlots==null||b.totalModSlots-usedMods(b)<=0)return 'Failed';
  if(BULLET.has(target.class)){const uid=entry.data._uniqueID;if((b.mods??[]).includes(uid))return 'Failed';
   // Server ItemModItem.TryCombine (~18-50): if the gun is the active item it is put away and taken out again
   // (DeactivateItem, Invalidate, heldItem.OnBeltUse); ctx.reactivate does that for the owning inventory.
   if(server){b.mods=[...(b.mods??[]),uid];if(b.usedModSlots!=null)b.usedModSlots=b.mods.length;a.uses-=1;if(a.uses<=0)src.box.slots[src.index]=null;ctx.events?.('combined',a.item);ctx.reactivate?.(dst);}
   return 'Combined';}
 }
 if(entry.class==='ResearchToolDataBlock'){
  if(!src.box.player||dst.box!==src.box)return 'Failed';
  if(!target.data.isResearchable){if(!server)ctx.notice?.('You can\'t research this');return 'Failed';}
  if(!ctx.atWorkbench){if(!server)ctx.notice?.('You must be at a workbench to do this.');return 'Failed';}
  const bp=findBlueprintFor(catalogue,b.item);if(!bp){if(!server)ctx.notice?.('You can\'t research this.. No Blueprint Available!...');return 'Failed';}
  if(ctx.known?.has(bp)){if(!server)ctx.notice?.('You already know how to make this!');return 'Failed';}
  if(server){ctx.known.add(bp);ctx.learned?.(bp);ctx.notice?.('You can now craft '+target.data.m_Name);a.uses-=1;if(a.uses<=0)src.box.slots[src.index]=null;}
  return 'Combined';
 }
 // Base recipe: the client prediction mutates only its local copy and returns Failed; the server is never asked.
 if(server)combineRecipe(catalogue,src,dst);
 return 'Failed';}

// Inventory.SlotOperation. `src`/`dst` are {box, index}.
export function slotOperation(catalogue,src,dst,ops,ctx={}){
 if(!(ops&7))return RESULT.NoOpArgs;if(!src?.box||!dst?.box)return RESULT.MissingInventory;
 if(src.box===dst.box&&src.index===dst.index)return RESULT.SameSlot;
 const a=src.box.slots[src.index];if(!a)return RESULT.EmptySourceSlot;const b=dst.box.slots[dst.index];
 if(b){const merge=ops&3,r=merge===OPS.Stack&&a.item===b.item?tryStack(catalogue,src,dst,ctx.side==='server'):merge?tryCombine(catalogue,src,dst,ctx):'Failed';
  if(r==='Combined')return RESULT.Combined;if(r==='Merged')return RESULT.Stacked;return ops&OPS.Move?RESULT.OccupiedDestination:RESULT.NoOp;}
 if(!(ops&OPS.Move))return RESULT.EmptyDestinationSlot;
 // MoveItemAtSlotToEmptySlot → AddItem(RestrictToOffset, DoNotStack): fails when the slot's flags reject the item or
 // the item refuses the slot (InventoryItem.CanMoveToSlot: a broken ArmorItem never goes into an equipment slot).
 if(dst.box.accepts&&!dst.box.accepts(dst.index,a.item,a))return RESULT.Failed;
 // Inventory.AssignItem with Opt.ReuseItem (client and server Inventory.cs ~2154-2156): an untransferable item
 // (transientMode & 2: Uber Hatchet, Uber Hunting Bow, the Invisible armour) never moves into another inventory.
 if(src.box.slots!==dst.box.slots&&!transferable(catalogue.items[a.item]?.data))return RESULT.Failed;
 if(ctx.side==='server'){dst.box.slots[dst.index]=a;src.box.slots[src.index]=null;}
 return RESULT.Moved;}

// RPOS.ItemCellClicked: an occupied target merges (ItemMergePredicted; with Event.current.shift ItemCombinePredicted),
// an empty target moves (ItemMovePredicted). The caller predicts with slotOperation and only sends (online) or applies
// (offline) a result > NoOp.
export function cellOperation(src,dst,{shift=false}={}){const occupied=Boolean(dst.box.slots[dst.index]);
 return {op:occupied?'merge':'move',ops:occupied?mergeOps(shift):OPS.Move,tryCombine:occupied?Boolean(shift):undefined};}

// Inventory.AddItemAmount (AmountMode.Default / OnlyCreateNew) into a box. Player boxes add to bag then belt (0-35).
export function addAmount(catalogue,box,key,amount,{onlyCreateNew=false,newSlot=(k,uses)=>({item:k,uses,condition:1,maxCondition:1})}={}){
 const d=catalogue.items[key].data,limit=box.addLimit??box.slots.length;let remaining=amount;
 if(d._splittable&&!onlyCreateNew)for(let i=0;i<limit&&remaining;i++){const s=box.slots[i];if(s?.item===key&&s.uses<d._maxUses){const n=Math.min(remaining,d._maxUses-s.uses);s.uses+=n;remaining-=n;}}
 for(let i=0;i<limit&&remaining>0;i++)if(!box.slots[i]&&(!box.accepts||box.accepts(i,key))){const n=d._splittable?Math.min(remaining,d._maxUses):1;box.slots[i]=newSlot(key,d._splittable?n:d._maxUses);remaining-=n;}
 return remaining;}

// Shift-click quick-move destination (owner playtest, 2026-10-29; not original RPOS behaviour — RPOSInventoryCell.OnClick
// is empty, drag-only; this is the same convention as most inventory UIs). Same scan order as addAmount above: a slot
// already holding the item with room first, else the first empty slot, both within addLimit and the box's own accepts —
// so a quick-moved item lands exactly where a manual drag to that slot would.
export function quickMoveSlot(catalogue,toBox,key){const d=catalogue.items[key].data,limit=toBox.addLimit??toBox.slots.length;
 if(d._splittable)for(let i=0;i<limit;i++){const s=toBox.slots[i];if(s?.item===key&&s.uses<d._maxUses&&(!toBox.accepts||toBox.accepts(i,key,s)))return i;}
 for(let i=0;i<limit;i++)if(!toBox.slots[i]&&(!toBox.accepts||toBox.accepts(i,key)))return i;
 return -1;}

// Inventory.SplitStack: half (rounded down) goes to a new stack in the first vacancy; condition is a fresh item's.
export function splitStack(catalogue,box,index,{mutate=true,newSlot}={}){const s=box.slots[index];if(!s)return false;const d=catalogue.items[s.item].data;
 if(!(s.uses>1&&vacant(box)>0&&d._splittable))return false;const half=Math.trunc(s.uses/2);
 if(!mutate){const limit=box.addLimit??box.slots.length;for(let i=0;i<limit;i++)if(!box.slots[i]&&(!box.accepts||box.accepts(i,s.item)))return true;return false;}
 const moved=half-addAmount(catalogue,box,s.item,half,{onlyCreateNew:true,newSlot});if(moved<=0)return false;s.uses-=moved;return true;}

// BulletWeaponDataBlock.ExecuteMenuOption(Unload): clip ammo goes back into the inventory; what does not fit stays loaded.
export function unloadWeapon(catalogue,box,index,{newSlot}={}){const s=box.slots[index],entry=s&&catalogue.items[s.item];if(!entry||!BULLET.has(entry.class))return false;
 const ammo=resolveItemRef(catalogue,s.item,entry.data.ammoType);if(!ammo||!(s.uses>0)||!vacant(box))return false;
 s.uses=addAmount(catalogue,box,ammo,s.uses,{newSlot});return true;}

// BlueprintDataBlock.UseItem (server): learn the blueprint, consume the blueprint item.
export function studyBlueprint(catalogue,box,index,known,{notice}={}){const s=box.slots[index],bp=s&&catalogue.blueprints[s.item];if(!bp)return false;
 if(known.has(s.item)){notice?.('You already have this blueprint');return false;}
 known.add(s.item);s.uses-=1;if(s.uses<=0)box.slots[index]=null;notice?.('You can now craft: '+nameOf(catalogue,bp.result));return true;}

// BloodDrawDatablock.UseItem (server): 2 s reuse delay, refuses at or below bloodToTake health, hurts the player and adds
// one Blood (Default slots, stacking, then belt). The kit itself is not consumed.
export function drawBlood(catalogue,box,index,state,{body,now,notice,onDamage}){const s=box.slots[index],d=s&&catalogue.items[s.item]?.data;if(!d)return false;
 if(now<(state.lastUseTime??-Infinity)+2)return false;const amount=d.bloodToTake??25;
 if(body.health<=amount){notice?.('You\'re too weak to use this');return false;}
 const r=body.hurt([amount,0,0,0,0,0]);onDamage?.(r,'blood');
 const blood=Object.keys(catalogue.items).find(k=>catalogue.items[k].data.m_Name==='Blood');if(blood)addAmount(catalogue,box,blood,1);
 state.lastUseTime=now;return true;}
