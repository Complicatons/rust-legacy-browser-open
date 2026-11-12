// Item tooltip content from the client's ItemToolTip + ItemDataBlock.PopulateInfoWindow/GetItemDescription overrides
// (Armor, BasicHealthKit, Bandage, Blueprint, Bow, BulletWeapon, Consumable) and InventoryItem.toolTip. Returns the
// rows the original window shows, in order; rendering (NGUI layout, icon, colours) is left to the UI.

// Datablock class → parent, for virtual method resolution (from the decompiled client assembly).
const PARENT={AmmoItemDataBlock:'ItemDataBlock',ArmorDataBlock:'EquipmentDataBlock',BandageDataBlock:'HeldItemDataBlock',BaseWeaponModDataBlock:'ItemModDataBlock',
 BasicHealthKitDataBlock:'ItemDataBlock',BasicTorchItemDataBlock:'HeldItemDataBlock',BloodDrawDatablock:'ItemDataBlock',BlueprintDataBlock:'ToolDataBlock',
 BowWeaponDataBlock:'WeaponDataBlock',BulletWeaponDataBlock:'WeaponDataBlock',ConsumableDataBlock:'ItemDataBlock',DeployableInventoryDataBlock:'DeployableItemDataBlock',
 DeployableItemDataBlock:'HeldItemDataBlock',EquipmentDataBlock:'ItemDataBlock',GunpowderDataBlock:'ItemDataBlock',HandGrenadeDataBlock:'ThrowableItemDataBlock',
 HeldItemDataBlock:'ItemDataBlock',ItemModDataBlock:'ItemDataBlock',LockpickItemDataBlock:'ItemDataBlock',MagazineDataBlock:'ItemDataBlock',MeleeWeaponDataBlock:'WeaponDataBlock',
 RecycleToolDataBlock:'ToolDataBlock',ResearchToolDataBlock:'ToolDataBlock',ResourceTypeItemDataBlock:'ItemDataBlock',ShotgunDataBlock:'BulletWeaponDataBlock',
 StrikeGunDataBlock:'ShotgunDataBlock',StructureComponentDataBlock:'HeldItemDataBlock',ThrowableItemDataBlock:'WeaponDataBlock',ToolDataBlock:'ItemDataBlock',
 TorchItemDataBlock:'ThrowableItemDataBlock',WeaponDataBlock:'HeldItemDataBlock'};
export const lineage=cls=>{const out=[];for(let c=cls;c;c=PARENT[c])out.push(c);if(out[out.length-1]!=='ItemDataBlock')out.push('ItemDataBlock');return out;};
const resolve=(table,cls)=>{for(const c of lineage(cls))if(table[c])return table[c];return null;};

// .NET formatting: float.ToString() (7 significant digits), "N0"/"N2" (grouped), "0" (rounded half away from zero).
export const fmtFloat=v=>String(parseFloat(Math.fround(v).toPrecision(7)));
export const fmtN=(v,d)=>v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmt0=v=>String(Math.sign(v)*Math.round(Math.abs(v)));
const DAMAGE=['Generic','Bullet','Melee','Explosion','Radiation','Cold'];
const SLOT_HEAD=8,SLOT_CHEST=0x10;

const WEAPON='This is a weapon. Drag it to your belt (right side of screen) and press the corresponding number key to use it.';
const DESCRIPTIONS={
 ItemDataBlock:d=>d.itemDescriptionOverride?.length>0?d.itemDescriptionOverride:'No item description available',
 ArmorDataBlock:()=>"This is an piece of armor. Drag it to it's corresponding slot in the armor window and it will provide additional protection",
 BulletWeaponDataBlock:()=>WEAPON,BowWeaponDataBlock:()=>WEAPON,
 BloodDrawDatablock:()=>'Used to extract your own blood, perhaps to make a medkit',
 ResourceTypeItemDataBlock:()=>'A type of resource',
 ResearchToolDataBlock:()=>'Drag this onto another item to learn how to craft it. Requires 1 Paper.',
 RecycleToolDataBlock:()=>"This doesn't do anything.. yet",
 BlueprintDataBlock:()=>'This is an item Blueprint. Study it to learn how to craft the item it represents!',
 BasicHealthKitDataBlock:()=>'This is a Medical item. Right click, or put in your belt and press the corresponding number key to use it.',
 StrikeGunDataBlock:()=>'Unreliable shotgun type weapon, uses homemade shells',
 GunpowderDataBlock:()=>'Explosive used in ammunition, Combine this with empty casings to prime them.',
 AmmoItemDataBlock:()=>'Ammunition for a weapon',
 ConsumableDataBlock:d=>{let t='';
  if(d.calories>0&&d.litresOfWater>0)t+='This is a food item, consuming it (via right click) will replenish your food and water. ';
  else if(d.calories>0)t+='This is a food item, eating it will satisfy some of your hunger. ';
  else if(d.litresOfWater>0)t+='This is a beverage, drinking it will quench some of your thirst. ';
  if(d.antiRads>0)t+='This item has some anti-radioactive properties, consuming it will lower your radiation level. ';
  if(d.healthToHeal>0)t+='It will also provide minor healing';
  return t;},
};
export const itemDescription=(cls,d)=>resolve(DESCRIPTIONS,cls)(d);

// InventoryItem.GetConditionString / toolTip. Condition is 0..1 (loadout entries may carry the datablock's 100).
export function conditionString(d,condition){if(!d.doesLoseCondition)return '';
 if(condition>1)return 'Artifact';if(condition>=0.8)return 'Perfect';if(condition>=0.6)return 'Quality';if(condition>=0.5)return '';
 if(condition>=0.4)return 'Shoddy';if(condition>0)return 'Bad';return 'Broken';}
export function itemTitle(d,instance){if(!instance)return d.m_Name;const c=conditionString(d,Math.min(instance.condition??1,instance.maxCondition??1));return c?c+' '+d.m_Name:d.m_Name;}

function header(rows,d,instance){rows.push({kind:'title',text:itemTitle(d,instance),icon:d.icon});}
function condition(rows,d,instance){if(!instance||!d.doesLoseCondition)return;const c=Math.min(instance.condition??1,instance.maxCondition??1),max=instance.maxCondition??1;
 rows.push({kind:'label',text:`Condition : ${fmt0(100*c)}/${fmt0(100*max)}`,color:c<=0.6?'yellow':c<=0?'red':'green'});} // the yellow test runs first, so broken items show yellow too
const section=(rows,text)=>rows.push({kind:'section',text});
const label=(rows,text,extra)=>rows.push({kind:'label',text,...extra});
const progress=(rows,text,amount,max)=>rows.push({kind:'progress',text,amount:amount<1?fmtN(amount,2):fmtN(amount,0),fraction:amount/max});
const description=(rows,cls,d)=>rows.push({kind:'description',text:itemDescription(cls,d)});
const heals=(min,max)=>min!==max?`Heals ${fmtFloat(min)} to ${fmtFloat(max)} health.`:`Heals ${fmtFloat(min)} health.`;

const POPULATE={
 ItemDataBlock(rows,cls,d,i){header(rows,d,i);condition(rows,d,i);description(rows,cls,d);},
 ArmorDataBlock(rows,cls,d,i){header(rows,d,i);condition(rows,d,i);section(rows,'Protection');
  (d.armorValues?.damageArray??[]).forEach((v,k)=>{if(v!==0)rows.push({kind:'stat',text:DAMAGE[k],value:'+'+fmtN(Math.trunc(v),0),color:'green'});});
  section(rows,'Equipment Slot');const f=d._itemFlags;label(rows,(f&SLOT_HEAD)===SLOT_HEAD?'Head':(f&SLOT_CHEST)===SLOT_CHEST?'Chest':'Head, Chest, Legs, Feet');description(rows,cls,d);},
 BandageDataBlock(rows,cls,d,i){header(rows,d,i);section(rows,'Medical');label(rows,heals(d.bloodAddMin,d.bloodAddMax));},
 BasicHealthKitDataBlock(rows,cls,d,i){header(rows,d,i);section(rows,'Medical');label(rows,heals(d.healthAddMin,d.healthAddMax));},
 BlueprintDataBlock(rows,cls,d,i,ctx){header(rows,d,i);section(rows,'Ingredients');const bp=ctx.blueprint;
  for(const e of bp?.ingredients??[])label(rows,e.amount>1?`${e.name} x${e.amount}`:e.name);section(rows,'Result Item');if(bp)label(rows,bp.result);description(rows,cls,d);},
 BowWeaponDataBlock(){},
 BulletWeaponDataBlock(rows,cls,d,i){header(rows,d,i);condition(rows,d,i);section(rows,'Weapon Stats');
  if(d.isSemiAuto)label(rows,'Semi Automatic Weapon');else progress(rows,'Fire Rate',1/Math.fround(d.fireRate),12);
  progress(rows,'Damage',d.damageMin+(d.damageMax-d.damageMin)*0.5,100);progress(rows,'Recoil',d.recoilPitchMax+d.recoilYawMax,60);progress(rows,'Range',d.bulletRange,200);description(rows,cls,d);},
 ConsumableDataBlock(rows,cls,d,i){header(rows,d,i);section(rows,'Consumable');
  if(d.calories>0)label(rows,fmtFloat(d.calories)+' Calories');if(d.litresOfWater>0)label(rows,fmtFloat(d.litresOfWater)+'L Water');
  if(d.antiRads>0)label(rows,'-'+fmtFloat(d.antiRads)+' Rads');if(d.healthToHeal!==0)label(rows,(d.healthToHeal>0?'+':'')+fmtFloat(d.healthToHeal)+' Health');description(rows,cls,d);},
};

// entry: a catalogue item ({class, data}); instance: an inventory slot ({condition, maxCondition}) or null;
// catalogue: used to name a blueprint's ingredients and result. An empty list means no tooltip (bows).
export function itemTooltip(entry,instance=null,catalogue=null){
 const rows=[],cls=entry.class,d=entry.data,ctx={};
 if(lineage(cls).includes('BlueprintDataBlock')&&catalogue){const bp=catalogue.blueprints[entry.source]??Object.values(catalogue.blueprints).find(b=>b.name===d.m_Name);
  if(bp)ctx.blueprint={result:catalogue.items[bp.result]?.data.m_Name??'',ingredients:bp.ingredients.map(e=>({name:catalogue.items[e.item]?.data.m_Name??'',amount:e.amount}))};}
 resolve(POPULATE,cls)(rows,cls,d,instance,ctx);
 if(instance?.totalModSlots!=null){label(rows,`Mod slots: ${instance.mods?.length??0} / ${instance.totalModSlots}`);if(catalogue)for(const uid of instance.mods??[]){const mod=Object.values(catalogue.items).find(i=>i.data._uniqueID===uid);if(mod)label(rows,mod.data.m_Name);}}
 return rows;
}
// Accessible plain-text fallback for closed-belt hovers and slot descriptions.
export const tooltipText=rows=>rows.map(r=>r.kind==='progress'?`${r.text}: ${r.amount}`:r.kind==='stat'?`${r.text} ${r.value}`:r.kind==='section'?`— ${r.text} —`:r.text).join('\n');
