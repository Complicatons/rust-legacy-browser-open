// RPOS right-click item menu actions (RPOSItemRightClickMenu → InventoryItem.OnMenuOption → ItemDataBlock.ExecuteMenuOption).
// Offline the browser plays both sides: the client's DoneOnServer/Unhandled options run the server's datablock code here.
// Online every option except Split (predicted ITSP) is IACT(slot, option) and only the server's GNUP changes slots.
import {useItem} from './survival.mjs';
import {drawBlood} from './item-ops.mjs';

// `ctx`: {inventory(), online(), metabolism(), body(), now(), notice(text), onDamage(result, kind), refresh(), states:Map,
// onItemEvent(event, itemKey)}: offline the server's FireClientSideItemEvent(Used) after a successful UseItem (item-events.mjs).
// body/metabolism may be getters: main.mjs replaces both objects on respawn.
export function createItemMenu(ctx){const get=v=>typeof v==='function'?v():v;const states=ctx.states??new Map(),stateOf=slot=>states.get(slot)??states.set(slot,{}).get(slot);
 // RPOSItemRightClickMenu keeps the item it was opened for (_observedItem) and EntryClicked runs that item's OnMenuOption,
 // which acts on the item's slot at that moment (InventoryItem.OnMenuOption -> NetworkItemAction(slot, option)). So run()
 // finds the same slot object in the current inventory (it may have moved; the inventory may be a new one after a respawn)
 // and does nothing when the item is gone (eaten from the belt, dropped on death, replaced by a server update).
 return index=>{const opened=ctx.inventory(),slot=opened.slots[index];if(!slot)return [];const entry=opened.catalogue.items[slot.item];
  return opened.menuOptions(index).map(label=>({label,slot,belt:label==='Use'&&entry.class==='BasicHealthKitDataBlock',run:()=>{
   const inv=ctx.inventory(),at=inv.slots.indexOf(slot);if(at<0)return false;
   if(ctx.online())return inv.menu(at,label);
   const done=runOffline(inv,at,label,entry,slot);if(done)ctx.refresh?.();return done;}}));};
 function runOffline(inv,index,label,entry,slot){
  if(label==='Split')return inv.split(index);
  if(label==='Study')return inv.study(index,ctx.notice);
  if(label==='Unload')return inv.unload(index);
  if(entry.class==='BloodDrawDatablock'){const drawn=drawBlood(inv.catalogue,inv.box(),index,stateOf(slot),{body:get(ctx.body),now:ctx.now(),notice:ctx.notice,onDamage:ctx.onDamage});if(drawn)ctx.onItemEvent?.('Used',slot.item);return drawn;}
  // BandageDataBlock lists Use but has no ExecuteMenuOption override: Unhandled on both builds (none shipped).
  if(entry.class!=='ConsumableDataBlock'&&entry.class!=='BasicHealthKitDataBlock')return false;
  // ConsumableDataBlock.UseItem / BasicHealthKitDataBlock.UseItem, then one use is consumed.
  const used=useItem(entry.data,stateOf(slot),{metabolism:get(ctx.metabolism),body:get(ctx.body),now:ctx.now(),events:{damage:ctx.onDamage}});if(!used)return false;
  ctx.onItemEvent?.('Used',slot.item);slot.uses-=1;if(slot.uses<=0)inv.slots[index]=null;return true;}
}
