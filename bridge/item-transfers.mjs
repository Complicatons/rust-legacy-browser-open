// Item provenance on the sidecar (ANTICHEAT-ADMIN-PLAN.md slice 8). The vanilla adapter reports facts only
// (adapter/vanilla/RustLegacyBrowserVanilla.Evidence.cs): every cross-inventory slot move a looter made (ITMV/ITMG, and an
// ItemPickup picked up), with each side's owner when it is a player's own inventory or a sleeper, plus the items a player
// dropped (ItemPickup) or left in a death sack. This tracker stamps container slots with the player the items came from
// and turns "items from player A reached player B's own inventory" into a transfer. Location-based: an item shuffled
// inside a container (ISMV) loses its stamp, and stamps expire. Never a ban signal: evidence for a human and the
// "possible alt" notes (central/identity.mjs). Tested against unit tests only.

const ID=/^\d{1,20}$/;
const isSide=s=>s&&typeof s==='object'&&typeof s.inv==='string'&&s.inv.length<=24;
const clean=(v,max=64)=>typeof v==='string'?v.slice(0,max):null;
const count=v=>Number.isInteger(v)&&v>0?Math.min(v,1e6):null;

// ttlMs: how long a container slot remembers who filled it; maxStamps: bound on remembered slots (oldest dropped).
export function createTransferTracker({now=Date.now,ttlMs=6*3600e3,maxStamps=50000}={}){
 const stamps=new Map(); // `${inv}:${slot}` → {holder, item, amount, via, at}
 const fresh=s=>s&&now()-s.at<=ttlMs;
 function stamp(key,value){stamps.delete(key);stamps.set(key,value);while(stamps.size>maxStamps)stamps.delete(stamps.keys().next().value);}
 const owner=side=>ID.test(String(side?.owner??''))&&(side.kind==='player'||side.kind==='sleeper')?String(side.owner):null;
 return {
  // One fact from the plugin poll; returns the transfers it completes: [{from, to, item, amount, via, looter}].
  apply(fact){
   if(!fact||typeof fact!=='object')return [];
   if(typeof fact.drop==='string'){
    // A dropped item or a death sack: its slots hold what this player had.
    const holder=ID.test(String(fact.owner??''))?String(fact.owner):null;if(!holder||typeof fact.inv!=='string'||!Array.isArray(fact.items))return [];
    const via=fact.drop==='corpse'?'corpse':fact.kind==='sleeper'?'sleeper':'drop';
    for(const it of fact.items.slice(0,64)){const item=clean(it?.item),amount=count(it?.amount);if(item&&amount&&Number.isInteger(it.slot))stamp(fact.inv+':'+it.slot,{holder,item,amount,via,at:now()});}
    return [];
   }
   const item=clean(fact.item),amount=count(fact.amount),looter=ID.test(String(fact.looter??''))?String(fact.looter):null;
   if(!item||!amount||!looter||!isSide(fact.src)||!isSide(fact.dst)||!Number.isInteger(fact.srcSlot)||!Number.isInteger(fact.dstSlot))return [];
   const from=owner(fact.src),to=owner(fact.dst),srcKey=fact.src.inv+':'+fact.srcSlot;
   // Where the items came from: the source inventory's own player, else the stamp on the source container slot.
   let origin=null;
   if(from)origin={holder:from,via:fact.src.kind==='sleeper'?'sleeper':'direct'};
   else{
    const s=stamps.get(srcKey);
    if(fresh(s)&&s.item===item){origin={holder:s.holder,via:s.via};s.amount-=amount;if(s.amount<=0)stamps.delete(srcKey);}
    else if(s)stamps.delete(srcKey);
   }
   if(!origin)return [];
   if(to){
    if(origin.holder===to)return [];
    return [{from:origin.holder,to,item,amount,via:fact.via==='pickup'&&origin.via==='drop'?'drop':origin.via==='direct'?'direct':origin.via,looter}];
   }
   // Into a container (or another sack): the slot now holds the origin player's items. A player's own deposit is a
   // container stamp; items that came from a corpse, sleeper or drop keep that origin.
   const dstKey=fact.dst.inv+':'+fact.dstSlot,prev=stamps.get(dstKey),via=origin.via==='direct'?'container':origin.via;
   stamp(dstKey,fresh(prev)&&prev.holder===origin.holder&&prev.item===item?{...prev,amount:prev.amount+amount,at:now()}:{holder:origin.holder,item,amount,via,at:now()});
   return [];
  },
  size:()=>stamps.size,
 };
}
