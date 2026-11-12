// Source-backed local inventory rules. Online inventory is projected separately.
import {maxCraftAmount,validCraftAmount,canConsume,canWork,consumeUses,randomSpawnUses} from './crafting.mjs';
import {armorSlotAllowed} from './item-condition.mjs';
import {RESULT,cellOperation,slotOperation,menuOptions,splitStack,unloadWeapon,studyBlueprint} from './item-ops.mjs';
// ItemDataBlock.InstallData: every new item instance starts at SetMaxCondition(1f) / SetCondition(1f); the datablock's
// serialized _maxCondition (100) is never applied to instances.
export const newCondition=()=>({condition:1,maxCondition:1});
export function withModSlots(slot,data,rng=Math.random){if(data.maxEligableSlots!=null){slot.totalModSlots=Math.min(data.maxEligableSlots,Math.floor(rng()*(data.maxEligableSlots+1)));slot.mods=[];}return slot;}
// Inventory.Slot.Kind ranges of a PlayerInventory: Default 0-29, Belt 30-35, Armor 36-39.
const LOADOUT_KINDS=[['_inventory',0,30],['_belt',30,36],['_wearable',36,40]];
export class LegacyInventory {
 constructor(catalogue,loadoutKey,{rng=Math.random}={}){this.catalogue=catalogue;this.loadoutKey=loadoutKey;this.rng=rng;this.reset();}
 // A fresh character: empty slots plus the original default loadout (respawn() keeps the learned blueprints).
 // selected: the active (held) belt slot; -1 = empty hands. The server activates an item only through a belt key
 // (HeldItem.OnBeltUse), so a fresh character holds nothing.
 reset(){const catalogue=this.catalogue,loadoutKey=this.loadoutKey;this.slots=Array(40).fill(null);this.selected=-1;this.known=new Set();this.work=null;this.craftWorkbenchUntil=-Infinity;this.message='';
  for(const {entry,d,slot} of this.loadoutEntries())this.slots[slot]=withModSlots({item:entry.item,uses:entry.uses||d._maxUses,...newCondition()},d,this.rng);
  this.known=new Set(this.loadout().resolved.blueprints);
 }
 loadout(){const loadout=this.catalogue.loadouts[this.loadoutKey]||Object.values(this.catalogue.loadouts)[0];if(!loadout)throw Error('Original loadout missing');return loadout;}
 // Loadout.LoadEntryArray: _inventory/_belt/_wearable entries take Default/Belt/Armor slot i of their kind.
 loadoutEntries(){const out=[],loadout=this.loadout();for(const [kind,start,end] of LOADOUT_KINDS)loadout.resolved[kind].forEach((entry,i)=>{const d=this.catalogue.items[entry.item]?.data;if(!d)throw Error('Unresolved original loadout item');out.push({entry,d,slot:start+i,start,end});});return out;}
 // AvatarSaveRestore.LoadAvatar (server ~121-148) ends every load with InventoryHolder.TryGiveDefaultItems →
 // Loadout.ApplyTo(PlayerInventory) (Loadout.cs ~170-238): the default blueprints are bound (BindBlueprint skips known
 // ones), then ApplyInventorySettings. An inventory with no occupied slot gets the whole loadout (emptyInventoryAdditions);
 // otherwise each _minimumRequirement entry (the Default Loadout's Rock, belt slot 0) is given when FindItem finds none
 // and the inventory has a vacancy (AddItemSomehow: its own slot, then any slot of its kind, then the other kinds), and a
 // splittable one short of its useCount is topped up (AddItemAmount of the difference). Returns the slots filled.
 giveDefaultItems(){const loadout=this.loadout(),given=[];this.known=new Set([...(this.known??[]),...loadout.resolved.blueprints]);
  if(!this.slots.some(Boolean)){for(const {entry,d,slot} of this.loadoutEntries()){this.slots[slot]=withModSlots({item:entry.item,uses:entry.uses||d._maxUses,...newCondition()},d,this.rng);given.push(slot);}return given;}
  const range=(a,b)=>Array.from({length:b-a},(_,i)=>a+i);
  for(const {entry,d,slot,start,end} of this.loadoutEntries()){if(!entry.minimumRequirement)continue;
   const useCount=Math.min(entry.uses||d._maxUses,d._maxUses);
   if(this.findItem(entry.item)>=0){if(d._splittable){const total=this.slots.reduce((n,s)=>n+(s?.item===entry.item?s.uses:0),0);if(total<useCount&&this.add(entry.item,useCount-total)<useCount-total)given.push(this.findItem(entry.item));}continue;}
   if(!this.slots.includes(null))continue; // noVacantSlots
   const others=LOADOUT_KINDS.filter(k=>k[1]!==start).flatMap(([,a,b])=>range(a,b));
   const target=[slot,...range(start,end),...others].find(i=>!this.slots[i]&&this.accepts(i,entry.item));if(target===undefined)continue;
   this.slots[target]=withModSlots({item:entry.item,uses:useCount,...newCondition()},d,this.rng);given.push(target);}
  return given;}
 // Respawning after a death (HumanController.OnKilled: DropInventoryContents, then AvatarSaveRestore.ClearAvatar →
 // PlayerInventory.SaveToAvatar, which still holds _boundBPs: Inventory.Clear never touches them). LoadAvatar →
 // LoadToAvatar binds the saved blueprints again, then TryGiveDefaultItems → Loadout.ApplyTo binds the default ones
 // (BindBlueprint skips known ones) and adds the default items. Learned blueprints survive death.
 respawn(){const known=this.known;this.reset();this.known=new Set([...known,...this.known]);}
 // selected: Inventory._activeItem as a slot. Setting it activates the item instance in that slot now.
 get selected(){return this._selected??-1;}
 set selected(index){this._selected=index;this.activeItem=index>=0?this.slots?.[index]??null:null;}
 // ItemModItem.TryCombine (server ItemModItem.cs ~18-50) on the active gun: DeactivateItem, Invalidate, then
 // heldItem.OnBeltUse takes it out again: a new view model with its draw animation and deploySound, and
 // WeaponItem.OnSetActive's deployLength lockout (WeaponItem.cs ~68-78). The slot object stays the same, so
 // `activations` counts these re-activations for the presentation (main.mjs viewModelFrame / weaponFrame).
 reactivate(index){if(index<0||index!==this.selected||!this.activeItem)return false;this.deactivate();this.selected=index;this.activations=(this.activations??0)+1;return true;}
 // Inventory.RemoveItem: evicting the active item from its slot (moved or stacked away via AssignItem, tossed, used up,
 // dropped) runs DeactivateItem. Run every frame; returns 'removed' when the held item was put away, else null.
 // (HeldItem.ConditionChanged deactivates a breaking active item through setCondition's ctx.deactivate.)
 syncActive(){if(this.selected<0||!this.activeItem||this.slots[this.selected]===this.activeItem)return null;this.deactivate();return 'removed';}
 deactivate(){this.selected=-1;}
 // Inventory.FindItem(datablock): the occupied slot holding that item with the most uses (the first one on a tie).
 findItem(key){let best=-1;this.slots.forEach((s,i)=>{if(s?.item===key&&(best<0||s.uses>this.slots[best].uses))best=i;});return best;}
 // The callers' loop (BulletWeaponItem.ActualReload_COD, BowWeaponDataBlock's arrow, RepairBench.CompleteRepair):
 // FindItem, then InventoryItem.Consume(ref count) (uses down by what is still wanted; an emptied item is removed),
 // until nothing is wanted or none is left. Returns the amount consumed.
 consumeLargestFirst(key,amount){if(!Number.isSafeInteger(amount)||amount<1)return 0;let count=amount;
  while(count>0){const i=this.findItem(key);if(i<0)break;const s=this.slots[i],n=Math.min(Math.max(0,s.uses),count);s.uses-=n;count-=n;if(s.uses<=0)this.slots[i]=null;}
  return amount-count;}
 // CraftingInventory.AtWorkBench: Time.time - _lastWorkBenchTime <= 1 (a second's grace after leaving the bench's zone).
 nearWorkbench(live,now){return Boolean(live)||now<=(this.craftWorkbenchUntil??-Infinity);}
 item(key){const i=this.catalogue.items[key];if(!i)throw Error('Unknown item');return i.data;}
 count(key){const d=this.item(key);return this.slots.slice(0,36).reduce((sum,slot)=>sum+(slot?.item===key?(d._splittable?slot.uses:1):0),0);}
 add(key,amount){const d=this.item(key);if(!Number.isSafeInteger(amount)||amount<1)throw Error('Invalid amount');let remaining=amount;
  if(d._splittable)for(let i=0;i<36&&remaining;i++){const slot=this.slots[i];if(slot?.item===key){const n=Math.min(remaining,d._maxUses-slot.uses);slot.uses+=n;remaining-=n;}}
  for(let i=0;i<36&&remaining;i++)if(!this.slots[i]){const n=d._splittable?Math.min(remaining,d._maxUses):1;this.slots[i]=withModSlots({item:key,uses:d._splittable?n:d._maxUses,...newCondition()},d,this.rng);remaining-=n;}
  return remaining;
 }
 // Moves an existing item instance in (uses/condition kept), like Inventory.AddExistingItem: splittables stack
 // first, then the first vacancy in bag (Default) before belt slots. Returns the uses that did not fit.
 insert(entry){const d=this.item(entry.item),vacant=()=>this.slots.slice(0,36).indexOf(null);let remaining=entry.uses;
  if(!d._splittable){const index=vacant();if(index<0)return Math.max(1,entry.uses);this.slots[index]={...entry};return 0;}
  if(d._splittable)for(let i=0;i<36&&remaining;i++){const slot=this.slots[i];if(slot?.item===entry.item){const n=Math.min(remaining,d._maxUses-slot.uses);slot.uses+=n;remaining-=n;}}
  if(remaining){const i=vacant();if(i>=0){this.slots[i]={...entry,uses:remaining};remaining=0;}}
  return remaining;
 }
 consume(key,amount){if(!Number.isSafeInteger(amount)||amount<1||this.count(key)<amount)return false;const d=this.item(key);let remaining=amount;
  for(let i=0;i<36&&remaining;i++){const slot=this.slots[i];if(slot?.item!==key)continue;const n=d._splittable?Math.min(remaining,slot.uses):1;remaining-=n;if(d._splittable&&slot.uses>n)slot.uses-=n;else this.slots[i]=null;}return true;
 }
 // PlayerInventory.CheckSlotFlags: equipment slots 36-39 (head, chest, legs, feet) take only items flagged Equip | that slot.
 // slot (when moving an existing item): ArmorItem.CanMoveToSlot keeps a broken armour piece out of the equipment slots.
 accepts(index,key,slot=null){if(index<36)return true;const need={36:4|8,37:4|0x10,38:4|0x20,39:4|0x40}[index];return Boolean(need)&&(this.item(key)._itemFlags&need)===need&&armorSlotAllowed(this.catalogue.items[key],slot,index);}
 // RPOS drag/click between two cells of this inventory (Inventory.SlotOperation, server rules after the client
 // prediction succeeds): occupied target → stack (Shift: combine; a different item always tries to combine), empty
 // target → move. No swapping. Returns true when something happened.
 move(from,to,{combine=false,atWorkbench=false,notice}={}){if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=40||to>=40)throw Error('Slot unavailable');if(from===to)return;
  const box=this.box();return this.transfer({box,index:from},{box,index:to},{combine,atWorkbench,notice})>RESULT.NoOp;}
 box(){return {slots:this.slots,player:true,addLimit:36,accepts:(i,k,slot)=>this.accepts(i,k,slot)};}
 // Predict as the native client (no mutation, client popups), then apply the server's SlotOperation when > NoOp.
 transfer(src,dst,{combine=false,atWorkbench=false,notice=m=>{this.message=m;}}={}){const {ops}=cellOperation(src,dst,{shift:combine}),ctx={atWorkbench,known:this.known,notice,events:(event,key)=>this.onItemEvent?.(event,key),reactivate:cell=>{if(cell.box.slots===this.slots)this.reactivate(cell.index);}};
  const predicted=slotOperation(this.catalogue,src,dst,ops,{...ctx,side:'client'});if(predicted<=RESULT.NoOp)return predicted;
  return slotOperation(this.catalogue,src,dst,ops,{...ctx,side:'server'});}
 newSlot(key,uses){return withModSlots({item:key,uses,...newCondition()},this.item(key),this.rng);}
 menuOptions(index){const s=this.slots[index];return index<36&&s?menuOptions(this.catalogue.items[s.item],s):[];}
 split(index){return splitStack(this.catalogue,this.box(),index,{newSlot:(k,u)=>this.newSlot(k,u)});}
 unload(index){return unloadWeapon(this.catalogue,this.box(),index,{newSlot:(k,u)=>this.newSlot(k,u)});}
 study(index,notice=m=>{this.message=m;}){return studyBlueprint(this.catalogue,this.box(),index,this.known,{notice});}
 maxCraft(key){return maxCraftAmount(this.catalogue.blueprints[key],k=>this.count(k));}
 canCraft(key,atWorkbench=false,amount=1){if(!validCraftAmount(amount))return {ok:false,reason:'Invalid craft amount'};const recipe=this.catalogue.blueprints[key];if(!recipe)return {ok:false,reason:'Unknown blueprint'};if(!this.known.has(key))return {ok:false,reason:'Blueprint not known'};if(recipe.workbench&&!atWorkbench)return {ok:false,reason:'Requires a workbench'};
  // BlueprintDataBlock.CanWork: each ingredient entry on its own (Inventory.CanConsume over every occupied slot, by uses).
  for(const entry of recipe.ingredients)if(entry.amount!==0&&!canConsume(this.slots,entry.item,entry.amount*amount))return {ok:false,reason:'Missing '+this.item(entry.item).m_Name};return {ok:true};
 }
 // CraftingInventory.CompleteCrafting -> BlueprintDataBlock.CompleteWork: CanWork again, consume each ingredient from the
 // slots CanWork listed, then AddItemAmount(result, amount x numResultItem) into bag then belt. AddItemAmount's leftover is
 // ignored: results that do not fit are lost (the original neither drops nor refunds them). New non-splittable results get
 // Uses.Quantity.Random uses. Returns {ok, added, lost}.
 completeRecipe(key,atWorkbench=false,amount=1){const check=this.canCraft(key,atWorkbench,amount);if(!check.ok)return check;
  const recipe=this.catalogue.blueprints[key],plan=canWork(recipe,amount,this.slots,{atWorkbench:true});if(!plan)return {ok:false,reason:'Missing ingredients'};
  recipe.ingredients.forEach((entry,i)=>{let count=entry.amount*amount;if(count===0)return;for(const index of plan[i]){const slot=this.slots[index];if(!slot)continue;const [usedUp,left]=consumeUses(slot,count);count=left;if(usedUp)this.slots[index]=null;}});
  const total=recipe.amount*amount,lost=this.addAmount(recipe.result,total);this.onCraftLoss?.(recipe.result,lost);
  return {ok:true,added:total-lost,lost};
 }
 // Inventory.AddItemAmount (AmountMode.Default, no use quantity): splittables stack then fill new stacks of _maxUses;
 // non-splittables are one item per count with Random spawn uses. Bag (0-29) then belt (30-35). Returns what did not fit.
 addAmount(key,amount){const d=this.item(key);if(d._splittable)return this.add(key,amount);let remaining=amount;
  for(let i=0;i<36&&remaining>0;i++)if(!this.slots[i]){this.slots[i]=withModSlots({item:key,uses:randomSpawnUses(d,this.rng),...newCondition()},d,this.rng);remaining--;}
  return remaining;}
 startCraft(key,now,atWorkbench=false,amount=1){if(!Number.isFinite(now))throw Error('Invalid craft time');if(this.work)return {ok:false,reason:'Already crafting'};if(atWorkbench)this.craftWorkbenchUntil=now+1;const near=atWorkbench||now<=(this.craftWorkbenchUntil??-Infinity),check=this.canCraft(key,near,amount);if(!check.ok)return check;const duration=this.catalogue.blueprints[key].seconds*amount;this.work={blueprint:key,amount,duration,progress:0,rate:1,updatedAt:now,finish:now+duration,atWorkbench:near};return {ok:true};}
 update(now,atWorkbench=this.work?.atWorkbench??false){if(!Number.isFinite(now))return;if(atWorkbench)this.craftWorkbenchUntil=now+1;const w=this.work;if(!w)return;
  const near=atWorkbench||now<=(this.craftWorkbenchUntil??-Infinity),recipe=this.catalogue.blueprints[w.blueprint];
  if(recipe.workbench&&!near){this.cancelCraft();this.message='Craft cancelled: requires a workbench';return;}
  if(w.duration==null){w.amount??=1;w.duration=recipe.seconds*w.amount;w.progress=Math.max(0,w.duration-(w.finish-now));w.updatedAt=now;}
  w.rate=near?3:1;w.progress=Math.min(w.duration,w.progress+Math.max(0,now-w.updatedAt)*w.rate);w.updatedAt=now;w.finish=now+(w.duration-w.progress)/w.rate;w.atWorkbench=near;
  if(w.progress<w.duration)return;const result=this.completeRecipe(w.blueprint,near,w.amount??1);this.work=null;this.message=result.ok?'Crafting complete':result.reason;}
 cancelCraft(){this.work=null;}
}
