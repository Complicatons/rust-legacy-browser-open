import {LegacyInventory} from './inventory.mjs';
import {RESULT,MENU,cellOperation,slotOperation,splitStack} from './item-ops.mjs';
import {beltUseAllowed} from './belt-use.mjs';
export const inventoryKey=s=>s.viewId!=null?'v:'+s.viewId:'n:'+s.carrier+':'+s.innerID;
const bytesOf=b=>b instanceof Uint8Array?b:b?.base64?Uint8Array.from(atob(b.base64),c=>c.charCodeAt(0)):null;
class Reader{
 constructor(data){const b=bytesOf(data);if(!b)throw Error('Missing inventory bytes');this.view=new DataView(b.buffer,b.byteOffset,b.byteLength);this.pos=0;}
 u8(){return this.view.getUint8(this.pos++);}
 i32(){const n=this.view.getInt32(this.pos,true);this.pos+=4;return n;}
 f32(){const n=this.view.getFloat32(this.pos,true);this.pos+=4;if(!Number.isFinite(n))throw Error('Non-finite item condition');return n;}
 end(){if(this.pos!==this.view.byteLength)throw Error('Unexpected inventory payload length');}
}
// Inventory.OnNetUpdate/InventoryItem.Deserialize/HeldItem.Deserialize. Decode fully before changing any slots.
export function readInventory(data,catalogue,previous=[]){
 const r=new Reader(data),capacity=r.u8(),full=Boolean(r.u8()),slots=full||previous.length!==capacity?Array(capacity).fill(null):previous.slice();
 const byUID=new Map(Object.entries(catalogue.items).map(([k,v])=>[v.data._uniqueID,[k,v]]));
 const count=full?capacity:r.u8();
 for(let i=0;i<count;i++){
  const present=Boolean(r.u8()),index=full?i:r.u8();if(index>=capacity)throw Error('Inventory slot out of range');
  if(!present){slots[index]=null;continue;}
  const uid=r.i32(),entry=byUID.get(uid);if(!entry)throw Error('Unknown item '+uid);const [key,item]=entry,d=item.data;
  const slot={item:key,uses:r.u8(),condition:d._maxCondition,maxCondition:d._maxCondition};
  if(d.doesLoseCondition){slot.condition=r.f32();slot.maxCondition=r.f32();}
  if('_viewModelPrefab' in d){slot.totalModSlots=r.u8();slot.usedModSlots=r.u8();if(slot.usedModSlots>5)throw Error('Too many item mods');slot.mods=Array.from({length:slot.usedModSlots},()=>r.i32());}
  slots[index]=slot;
 }r.end();return {capacity,full,slots};
}

// A server-owned inventory: requests never mutate local item amounts. GNUP is the only slot writer.
export class ServerInventory extends LegacyInventory{
 reset(){this.revision=(this.revision??0)+1;this.slots=Array(40).fill(null);this.known=new Set();this.selected=-1;this.activeSlot=null;this.activeRep=null;this.work=null;this.message='Waiting for server inventory…';}
 constructor(session,catalogue,{now=()=>performance.now()/1000}={}){
  super(catalogue);Object.assign(this,{session,now,network:true,onChange:()=>{},containers:new Map(),atWorkbench:false});this.ownView=session.client.characterView;
  for(const list of session.inventoryCalls.values())for(const call of list)this.apply(call);
  session.addEventListener('inventory-call',e=>this.apply(e.detail));
  session.addEventListener('character',e=>{if(this.ownView!==e.detail.viewId){this.ownView=e.detail.viewId;this.reset();this.changed();}});
  session.addEventListener('character-lost',()=>{this.closeLoot(false);this.reset();this.message='Waiting to respawn…';this.changed();});
  session.client.addEventListener('entity-destroy',e=>this.remove({carrier:e.detail.carrier,innerID:e.detail.innerID}));
  session.client.addEventListener('destroy',()=>{for(const [k,c]of this.containers)if(c.target.viewId!=null&&!session.client.views.has(c.target.viewId))this.remove(c.target);});
  session.addEventListener('closed',()=>{this.closeLoot(false);this.containers.clear();this.reset();this.message='Disconnected';this.changed();});
 }
 get target(){return {viewId:this.session.client.characterView};}
 request(action,source=this.target,data={}){if(source.viewId==null&&source.carrier==null)return false;this.session.client.inventory(action,source,data);return true;}
 changed(){this.onChange();this.tryOpenLoot();}
 bindUI(ui){this.ui=ui;this.onChange=()=>ui.refresh();ui.setWorkbench(()=>this.atWorkbench);this.changed();}
 container(source){const key=inventoryKey(source);if(!this.containers.has(key))this.containers.set(key,{target:source,slots:[],ready:false});return this.containers.get(key);}
 apply({source,name,args=[]}){
  const own=source.viewId===this.session.client.characterView&&source.viewId!=null,c=this.container(source),key=inventoryKey(source);
  try{
   if(name==='GNUP'){const parsed=readInventory(args[0],this.catalogue,c.slots);if(own&&parsed.capacity!==40)throw Error('Unexpected player inventory size');c.slots=parsed.slots;c.ready=true;this.lastError=null;
    if(own){this.slots=c.slots;this.revision++;this.message='';}c.refreshPending=false;
   }else if(name==='SetLooter'){if(args[0]===this.session.client.playerId)this.looting=key;else if(this.looting===key)this.closeLoot(false);}
   else if(name==='ClearLooter'){if(this.looting===key)this.closeLoot(false);}
   else if(own&&name==='ReceiveBoundBPs'){const r=new Reader(args[0]),n=r.i32();if(n<0||n>10000)throw Error('Invalid blueprint count');const uids=Array.from({length:n},()=>r.i32());r.end();const keys=new Map(Object.keys(this.catalogue.blueprints).map(k=>[this.catalogue.items[k].data._uniqueID,k]));this.known=new Set(uids.map(uid=>keys.get(uid)).filter(Boolean));}
   else if(own&&name==='IAST'){this.activeSlot=this.selected=args[0];this.activeRep=args[1];}
   // Inventory.ITDE → DeactivateItem (_activeItem = null): the RPOS cell highlight goes with it.
   else if(own&&name==='ITDE'){this.activeSlot=null;this.activeRep=null;this.selected=-1;}
   else if(own&&name==='wbi')this.atWorkbench=Boolean(args[0]);
   else if(own&&name==='CRFU'){const [,duration,rate,progress,uid,amount]=args,key=Object.keys(this.catalogue.blueprints).find(k=>this.catalogue.items[k].data._uniqueID===uid);
    this.work=key?{blueprint:key,amount,duration,rate,progress,updatedAt:this.now(),paused:rate<=0,finish:rate>0?this.now()+Math.max(0,duration-progress)/rate:Infinity}:null;
   }else if(own&&name==='CRFC'){this.work=null;this.message='';}
  }catch(error){this.message='Inventory update could not be read';this.lastError=error.message;if(!c.refreshPending){c.refreshPending=true;this.request('refresh',source);}}
  this.changed();
 }
 tryOpenLoot(){const c=this.containers.get(this.looting);if(!this.ui||!c?.ready||this.opened===this.looting)return;
  this.opened=this.looting;const key=this.looting,target=c.target;
  // RPOS.OpenLootWindow: the lootable's lootWindowOverride when set, else the standard LootPanelPrefab. Only
  // ;deploy_camp_bonfire (FireBarrel, RPOSFireContentsWindow) and ;deploy_repairbench set one; ;deploy_furnace has none.
  const prefab=this.session.client.entities?.get(target.carrier+':'+target.innerID)?.prefab,layout=prefab===';deploy_camp_bonfire'?'fire':prefab===';deploy_repairbench'?'repair':null;
  const box=()=>({slots:c.slots,player:false});
  this.ui.openLoot({title:'Loot',layout,get slots(){return c.slots;},take:i=>this.take(c,i),
   takeTo:(fromSlot,toSlot,o)=>this.cell(target,box(),fromSlot,this.target,this.box(),toSlot,o),
   move:(fromSlot,toSlot,o)=>this.cell(target,box(),fromSlot,target,box(),toSlot,o),
   // No Take all: the loot and fire windows' TakeAllButton is inactive in the prefabs (its click only closes RPOS) and
   // the server's LootableObject.TakeAll() does nothing.
   store:(from,to,o)=>this.moveTo(c,from,to,o),action:layout==='repair'?this.repairAction(c,target):null},()=>{if(this.looting===key)this.closeLoot(true);});
 }
 // RPOSRepairBenchWindow: the Repair button shows (inventory-ui, repairWindowState) while slot 0 holds a repairable, damaged
 // item and is never disabled: a click sends RepairBench.DoRepair; the server consumes the ingredients, changes the item
 // (GNUP) and answers with a notice popup ("Repaired Item!" / "could not repair item").
 repairAction(c,target){return {label:'Repair',run:()=>this.request('repair',target)};}
 closeLoot(send=true){const c=this.containers.get(this.looting);this.looting=null;this.opened=null;if(send&&c)this.request('stop-looting',c.target);if(this.ui?.lootOpen())this.ui.closeLoot();}
 remove(source){const key=inventoryKey(source);if(this.looting===key)this.closeLoot(false);this.containers.delete(key);this.changed();}
 // RPOS cell operation: predict exactly like the native client (Inventory.SlotOperation on the client build, which for
 // this port never changes slots) and send ITSM/ITMG/ISMV/ITMV only when the prediction is > NoOp. GNUP applies the result.
 cell(source,sourceBox,fromSlot,target,targetBox,toSlot,{combine=false,notice=m=>{this.message=m;}}={}){
  const src={box:sourceBox,index:fromSlot},dst={box:targetBox,index:toSlot},{op,ops,tryCombine}=cellOperation(src,dst,{shift:combine});
  const predicted=slotOperation(this.catalogue,src,dst,ops,{side:'client',atWorkbench:this.atWorkbench,known:this.known,notice});
  if(predicted<=RESULT.NoOp)return false;return this.request('move',source,op==='merge'?{target,fromSlot,toSlot,op,tryCombine}:{target,fromSlot,toSlot,op});}
 take(c,fromSlot){const entry=c.slots[fromSlot];if(!entry)return false;const d=this.item(entry.item);let toSlot=d._splittable?this.slots.slice(0,36).findIndex(s=>s?.item===entry.item&&s.uses<d._maxUses):-1;
  if(toSlot<0)toSlot=this.slots.slice(0,36).indexOf(null);if(toSlot<0){this.message='Inventory is full';this.changed();return false;}
  return this.cell(c.target,{slots:c.slots,player:false},fromSlot,this.target,this.box(),toSlot);
 }
 moveTo(c,fromSlot,toSlot,o){return this.cell(this.target,this.box(),fromSlot,c.target,{slots:c.slots,player:false},toSlot,o);}
 move(fromSlot,toSlot,o){if(fromSlot===toSlot)return false;const box=this.box();return this.cell(this.target,box,fromSlot,this.target,box,toSlot,o);}
 transfer(){return RESULT.NoOp;} // server-owned: only cell() requests, never local SlotOperation
 toss(fromSlot){if(!this.slots[fromSlot])return false;return this.request('toss',this.target,{fromSlot});}
 // InventoryHolder.BeltUse: DoBeltUse only for an occupied belt slot whose held item can change state (belt-use.mjs);
 // canDeactivate: the active held item's CanSetActivate(false) (main.mjs sets it; nothing blocks without one).
 selectBelt(index){if(!beltUseAllowed(this,index,{canDeactivate:()=>this.canDeactivate?.()??true}))return false;return this.request('belt',this.target,{fromSlot:index});}
 // RPOSItemRightClickMenu → InventoryItem.OnMenuOption on the client build: Split predicts Inventory.SplitStack and sends
 // ITSP; Info would stay on the client (never listed); every other option is Unhandled/DoneOnServer → IACT(slot, option).
 menu(index,label){const option=MENU[label];if(!option||option===MENU.Info||!this.slots[index])return false;
  if(option===MENU.Split)return splitStack(this.catalogue,this.box(),index,{mutate:false})&&this.request('split',this.target,{fromSlot:index});
  return this.request('menu',this.target,{fromSlot:index,option});}
 split(index){return this.menu(index,'Split');}
 study(index){return this.menu(index,'Study');}
 unload(index){return this.menu(index,'Unload');}
 startCraft(key,now,atWorkbench,amount=1){const check=this.canCraft(key,this.atWorkbench,amount);if(!check.ok)return check;this.request('craft',this.target,{blueprint:this.item(key)._uniqueID,amount});return {ok:true};}
 // Client CraftingInventory.CancelCrafting (~103-112): only while crafting.inProgress; sends CRFX and clears inProgress
 // at once (the server's CRFC later confirms). Returns whether a cancel was sent.
 cancelCraft(){if(!this.work)return false;this.request('cancel-craft');this.work=null;return true;}
 update(){} // The server completes crafting and sends slot changes.
 syncActive(){return null;} // the server deactivates (ITDE)
 nearWorkbench(live){return Boolean(live);} // the server's wbi flag
 add(key,amount){return amount;}
 consume(){return false;}
 consumeLargestFirst(){return 0;} // server-owned: only GNUP changes amounts
 insert(entry){return entry.uses;}
}
