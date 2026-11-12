// BlueprintDataBlock.MaxAmount ignores absent ingredients; CanWork still rejects missing materials.
export function maxCraftAmount(recipe,count){let max=2147483647;for(const entry of recipe?.ingredients??[]){const total=count(entry.item);if(total>0&&entry.amount>0)max=Math.min(max,Math.floor(total/entry.amount));}return max===2147483647?0:max;}
export const validCraftAmount=n=>Number.isInteger(n)&&n>=1&&n<=2147483647;
export const craftModifier=event=>event.ctrlKey?32767:event.shiftKey?10:1;
export function requestedCraftAmount(value,max){return Math.max(1,Math.min(Math.max(1,max),Math.trunc(Number(value))||1));}
const categoryNames=['Survival','Weapons','Ammo','Misc','Medical','Armor','Blueprint','Food','Tools','Mods','Parts','Resource'];
const order=[0,11,4,2,1,5,8,9,10,7,6,3];
export function blueprintGroups(catalogue,known){return order.flatMap(category=>{const keys=[...known].filter(k=>{const r=catalogue.blueprints[k];return r&&catalogue.items[r.result]?.data.category===category;});return keys.length?[{name:categoryNames[category],keys}]:[];});}
export function craftProgress(work,now){if(!work)return {fraction:0,seconds:0,rate:1};const rate=work.rate??1,duration=work.duration??0;
 if(!duration)return {fraction:0,seconds:Math.max(0,work.finish-now),rate};
 const progress=Math.max(0,Math.min(duration,(work.progress??0)+Math.max(0,now-(work.updatedAt??now))*rate));
 return {fraction:progress/duration,seconds:rate>0?(duration-progress)/rate:Infinity,rate};}

// ---- Server craft completion (BlueprintDataBlock.CanWork / CompleteWork, Inventory.CanConsume, InventoryItem.Consume) ----
// Inventory.CanConsume(db, useCount, list): the occupied slots in collection order (every slot, worn ones included) holding
// the item, summing their `uses` (also for non-splittable items) until useCount is covered. Returns the slot list, or null
// when the uses fall short (or useCount <= 0, which CanWork also rejects).
export function canConsume(slots,key,useCount){if(!(useCount>0))return null;let need=useCount;const list=[];
 for(let i=0;i<slots.length;i++){const s=slots[i];if(s?.item!==key)continue;need-=s.uses;list.push(i);if(need<=0)return list;}return null;}
// BlueprintDataBlock.CanWork(amount, inventory): workbench rule, then every non-zero ingredient (amount x batch) must be
// consumable. Returns the per-ingredient slot lists (lastCanWorkResult) or null.
export function canWork(recipe,amount,slots,{atWorkbench=false}={}){if(!recipe)return null;if(recipe.workbench&&!atWorkbench)return null;const plan=[];
 for(const entry of recipe.ingredients){if(entry.amount===0){plan.push(null);continue;}const list=canConsume(slots,entry.item,entry.amount*amount);if(!list)return null;plan.push(list);}return plan;}
// InventoryItem.Consume(ref numWant): an item at 0 uses is used up; otherwise it gives up to numWant uses and is used up
// (removed) when that empties it. Returns [usedUp, numWantLeft].
export function consumeUses(slot,numWant){const num=slot.uses;if(num===0)return [true,numWant];if(numWant===0)return [false,0];
 if(num<=numWant){slot.uses=0;return [true,numWant-num];}slot.uses=num-numWant;return [false,0];}
// Uses.Quantity.Random.CalculateCount: Random.Range(_spawnUsesMin, _spawnUsesMax + 1) (int, max exclusive). AddItemAmount
// gives every new non-splittable item this many uses unless told otherwise (crafted guns start with their spawn ammo).
export function randomSpawnUses(data,rng=Math.random){const min=data._spawnUsesMin??1,max=(data._spawnUsesMax??min)+1;return Math.min(max-1,min+Math.floor(rng()*(max-min)));}
