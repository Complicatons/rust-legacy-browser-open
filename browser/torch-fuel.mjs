// Offline port of the server's BasicTorchItem fuel (decompiled server BasicTorchItem.cs ~29-57; the client class has no
// tick). The held Torch burns one use per second of game time while active: OnSetActive(true) sets lastTickTime = now and
// adds 1 to consumeAmount; every ServerFrame (InventoryHolder.ServerFrame -> the held item, run from each client move)
// adds the time since the last frame and consumes FloorToInt(consumeAmount) uses (InventoryItem.Consume); an emptied
// torch is removed from its slot (Inventory.RemoveItem, which also puts it away). consumeAmount and lastTickTime are
// fields of the item instance, never saved; a WeakMap keeps them off the saved slot object.
export const TORCH_CLASS='BasicTorchItemDataBlock';
const state=new WeakMap();
const of=item=>{let s=state.get(item);if(!s){s={lastTickTime:-1,consumeAmount:0};state.set(item,s);}return s;};
export const isTorch=entry=>entry?.class===TORCH_CLASS;
// OnSetActive(isActive: true).
export function torchActivated(item,now){const s=of(item);s.lastTickTime=now;s.consumeAmount++;}
// InventoryItem.Consume(ref numWant): true when the item is used up (uses already 0, or numWant >= uses).
export function consumeUses(item,numWant){const n=item.uses;if(n===0)return true;if(numWant===0)return false;if(n<=numWant){item.uses=0;return true;}item.uses=n-numWant;return false;}
// BasicTorchItem.ServerFrame. Returns true when the torch is used up and must leave its slot.
export function torchServerFrame(item,now){const s=of(item),dt=now-s.lastTickTime;s.lastTickTime=now;s.consumeAmount+=dt;
 if(s.consumeAmount<1)return false;const n=Math.floor(s.consumeAmount);s.consumeAmount-=n;return consumeUses(item,n);}
export const torchState=item=>({...of(item)});
