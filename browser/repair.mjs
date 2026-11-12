// RepairBench (slot 0 holds the item) and SpikeWall rules from the server assembly. Pure logic, no rendering.
// Item condition is 0..1 per instance; maxCondition starts at 1 and drops on every repair.
import {Damage} from './combat.mjs';

const roundToInt=v=>{const f=Math.floor(v),d=v-f;return d>0.5?f+1:d<0.5?f:(f%2===0?f:f+1);}; // Mathf.RoundToInt (banker's)
const conditionOf=slot=>Math.min(slot.condition??1,maxConditionOf(slot)); // loadouts store the datablock's 100 → full
export const maxConditionOf=slot=>slot.maxCondition??1;
export const isDamaged=slot=>maxConditionOf(slot)-conditionOf(slot)>0.001;
// BlueprintDataBlock.FindBlueprintForItem: the first blueprint whose result is this item.
export const blueprintFor=(catalogue,item)=>Object.values(catalogue.blueprints).find(b=>b.result===item)??null;
export const resourceScalar=slot=>slot?(maxConditionOf(slot)-conditionOf(slot))*0.5:0;

export function canRepair(slot,catalogue,inventory){
 if(!slot||!catalogue.items[slot.item]?.data?.isRepairable||!isDamaged(slot))return false;
 const bp=blueprintFor(catalogue,slot.item);if(!bp)return false;
 const k=resourceScalar(slot);
 return bp.ingredients.every(e=>{const n=Math.ceil(e.amount*k);return n<=0||inventory.count(e.item)>=n;});
}
// RPOSRepairBenchWindow.UpdateGUIAmounts, run every frame (Update → SetRepairItem) for the bench's slot 0 against the local
// player's inventory. Up to 4 ingredient labels "N Name" (N = CeilToInt(amount × GetResourceScalar()), only N > 0), green
// when CanConsume, else red; "Condition : c/m" (×100, ToString("0")): green, yellow below 0.6, red when broken
// (condition ≤ 0). An undamaged item shows "Does not need repairs" in green and no Repair button. The NeedLabel text is
// only ever set to that string, so the prefab's "Needs:" does not come back until the window is made again: pass the
// label's current text in `needsText`. The button is hidden, never disabled: a click always sends RepairBench.DoRepair.
export const REPAIR_LABEL_COUNT=4;
const format0=v=>String(Math.round(v)); // .NET ToString("0") on a non-negative value: half away from zero
export function repairWindowState(slot,catalogue,inventory,needsText='Needs:'){
 if(!slot||!catalogue.items[slot.item]?.data?.isRepairable)return {amounts:[],needs:{enabled:false,text:needsText,color:'white'},condition:{enabled:false,text:'',color:'white'},button:false};
 const condition=conditionOf(slot),text=`Condition : ${format0(condition*100)}/${format0(maxConditionOf(slot)*100)}`;
 if(!isDamaged(slot))return {amounts:[],needs:{enabled:true,text:'Does not need repairs',color:'green'},condition:{enabled:true,text,color:'green'},button:false};
 const amounts=[],bp=blueprintFor(catalogue,slot.item),k=resourceScalar(slot);
 for(const e of bp?.ingredients??[]){if(amounts.length>=REPAIR_LABEL_COUNT)break;const n=Math.ceil(e.amount*k);
  if(n>0)amounts.push({text:`${n} ${catalogue.items[e.item]?.data?.m_Name??e.item}`,color:inventory.count(e.item)>=n?'green':'red'});}
 return {amounts,needs:{enabled:true,text:needsText,color:'white'},condition:{enabled:true,text,color:condition<=0?'red':condition<0.6?'yellow':'green'},button:true};
}
// Returns the original popup text. Ingredients cost (missing condition × 0.5) of the recipe, rounded; the item loses
// 20 % of the missing condition + 0.05 off its maximum, then is filled to the new maximum.
export function completeRepair(slot,catalogue,inventory){
 if(!canRepair(slot,catalogue,inventory))return {ok:false,message:'could not repair item'};
 const bp=blueprintFor(catalogue,slot.item),k=resourceScalar(slot);
 // RepairBench.CompleteRepair: per ingredient, FindItem (most uses first) + Consume until the rounded count is taken.
 for(const e of bp.ingredients){const n=roundToInt(e.amount*k);if(n>0&&!(inventory.consumeLargestFirst?inventory.consumeLargestFirst(e.item,n)===n:inventory.consume(e.item,n)))return {ok:false,message:'could not repair item'};}
 const max=Math.min(Math.max(maxConditionOf(slot)-((maxConditionOf(slot)-conditionOf(slot))*0.2+0.05),0.01),1);
 slot.maxCondition=max;slot.condition=max;
 return {ok:true,message:'Repaired Item!'};
}

// SpikeWall: characters inside the trigger take dmgPerTick melee damage once a second (first tick on entry);
// melee hits on the wall from within 8 m reflect damage×returnFraction + baseReturnDmg to the attacker.
export class SpikeWall {
 constructor({returnFraction=0.2,dmgPerTick=20,baseReturnDmg=5}={}){Object.assign(this,{returnFraction,dmgPerTick,baseReturnDmg});this.touching=new Set();this.next=null;}
 static fromPrefab(prefab){return new SpikeWall(prefab?.components?.SpikeWall?.[0]?.data??{});}
 enter(target,now){this.touching.add(target);if(this.next===null)this.next=now;}
 exit(target){this.touching.delete(target);if(!this.touching.size)this.next=null;}
 // Returns [{target, damage}] for every 1 s tick due by `now`; dead/removed targets are dropped via `alive`.
 update(now,alive=()=>true){const hits=[];
  while(this.next!==null&&now>=this.next){
   for(const t of [...this.touching])if(!alive(t))this.touching.delete(t);
   if(!this.touching.size){this.next=null;break;}
   for(const t of this.touching)hits.push({target:t,damage:this.dmgPerTick,type:Damage.Melee});
   this.next+=1;
  }
  return hits;
 }
 reflect({amount,melee,distance}){return melee&&!(distance>8)?amount*this.returnFraction+this.baseReturnDmg:0;}
}
