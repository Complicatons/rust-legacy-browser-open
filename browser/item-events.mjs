// InventoryItem.ItemEvent sounds (ItemDataBlock.OnItemEvent: equippedSound / unEquippedSound / combinedSound / UsedSound,
// each clip.Play(1f) on the client). Online the server sends Inventory.CLEV(byte event, int uniqueID); offline the browser
// is the server and fires the same events where the server code does (FireClientSideItemEvent):
// - ArmorDataBlock.OnEquipped/OnUnEquipped via PlayerInventory.ItemAdded/ItemRemoved on equipment slots 36-39 (any
//   add/remove, including the death drop's Inventory.Clear);
// - ItemModItem.TryCombine onto a bullet weapon (Combined, the mod's clip); a plain recipe combine never reaches the
//   server because the client prediction returns Failed;
// - ConsumableDataBlock.UseItem, BasicHealthKitDataBlock.UseItem and BloodDrawDatablock.UseItem on success (Used).
export const ITEM_EVENT={Equipped:1,UnEquipped:2,Combined:3,Used:4};
export const ITEM_EVENT_FIELD={1:'equippedSound',2:'unEquippedSound',3:'combinedSound',4:'UsedSound'};
// The clip file for an item key and event (name or number), or null (null clips play nothing, as `(bool)clip`).
export function itemEventSound(itemSounds,key,event){const n=typeof event==='string'?ITEM_EVENT[event[0].toUpperCase()+event.slice(1)]:event,field=ITEM_EVENT_FIELD[n];return (field&&itemSounds?.[key]?.[field])||null;}
export const EQUIPMENT_SLOTS=[36,37,38,39];
// PlayerInventory.ItemRemoved/ItemAdded on equipment slots between two snapshots of slot objects (identity = the item).
export function equipmentEvents(before,after){const out=[];
 for(let i=0;i<EQUIPMENT_SLOTS.length;i++){const a=before[i]??null,b=after[i]??null;if(a===b||(a&&b&&a.item===b.item))continue; // copies of the same item (e.g. a crafting rollback) are not a change
  if(a)out.push({event:'UnEquipped',key:a.item,slot:EQUIPMENT_SLOTS[i]});if(b)out.push({event:'Equipped',key:b.item,slot:EQUIPMENT_SLOTS[i]});}
 return out;}
export const equipmentSnapshot=slots=>EQUIPMENT_SLOTS.map(i=>slots[i]??null);
