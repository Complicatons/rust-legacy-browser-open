// The wiki's generated sections, built from the recovered original game data (static data only; nothing is run).
// Output: site/generated/wiki/{items,recipes,building,raiding,animals,resources,places,radiation}.json, search.json,
// report.json and item icons in site/generated/wiki/icons/<slug>.png. Values that were not exported are left out.
//   node tools/build-wiki-data.mjs
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {TakeDamage,takeDamageData,damageList,LifeStatus} from '../browser/take-damage.mjs';
import {Damage} from '../browser/combat.mjs';

export const slugify=s=>String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

// Item ids appear as cab-scriptableobject/cab-gameobject/cab-datablock with the same path id; resolve by path id.
const pathId=id=>String(id).slice(String(id).lastIndexOf(':')+1);
function itemIndex(items){const byPath=new Map();for(const [id,v] of Object.entries(items))byPath.set(pathId(id),{id,...v});return id=>byPath.get(pathId(id));}

const CLASS_TYPE={MeleeWeaponDataBlock:'weapon',BowWeaponDataBlock:'weapon',ShotgunDataBlock:'weapon',StrikeGunDataBlock:'weapon',BulletWeaponDataBlock:'weapon',
 AmmoItemDataBlock:'ammo',ArmorDataBlock:'armour',ConsumableDataBlock:'consumable',BasicHealthKitDataBlock:'medical',BloodDrawDatablock:'medical',
 ResourceTypeItemDataBlock:'resource',GunpowderDataBlock:'resource',TorchItemDataBlock:'tool',BasicTorchItemDataBlock:'tool',LockpickItemDataBlock:'tool',
 ResearchToolDataBlock:'tool',RecycleToolDataBlock:'tool',DeployableItemDataBlock:'deployable',DeployableInventoryDataBlock:'deployable',
 StructureComponentDataBlock:'structure',BaseWeaponModDataBlock:'mod',HandGrenadeDataBlock:'explosive',ItemDataBlock:'misc'};
const TOOLS_CATEGORY=8; // ItemDataBlock.category: the in-game Tools tab (Supply Signal is a hand grenade class in Tools)
function typeOf(v){const d=v.data;let t=CLASS_TYPE[v.class]??'misc';
 if(t==='deployable'&&/explosive/i.test(d.DeployableObjectPrefabName??''))t='explosive';
 if(t==='explosive'&&v.class==='HandGrenadeDataBlock'&&d.category===TOOLS_CATEGORY)t='tool';
 return t;}
const ARMOUR=['generic','bullet','melee','explosion','radiation','cold'];
// Exported floats are float32 (0.8999999761581421): keep three decimals.
const r3=v=>typeof v==='number'?Math.round(v*1000)/1000:v;
const nz=v=>v?v:undefined,clean=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==undefined&&v!==null));
function propsOf(v,ref){const d=v.data,t=typeOf(v);
 const p={stack:d._splittable?d._maxUses:undefined,uses:!d._splittable&&d._maxUses>1?d._maxUses:undefined,
  researchable:d.isResearchable?true:undefined,repairable:d.isRepairable?true:undefined,recyclable:d.isRecycleable?true:undefined};
 if(d.damageMin!==undefined&&(t==='weapon'||t==='explosive'))p.damage=[d.damageMin,d.damageMax];
 if(t==='weapon'){p.fireRate=r3(d.fireRate);p.clip=d.maxClipAmmo;p.range=r3(d.range);p.semiAuto=d.isSemiAuto?true:undefined;
  const ammo=d.ammoType?.m_PathID?ref(String(d.ammoType.m_PathID)):null;if(ammo)p.ammo=slugify(ammo.data.m_Name);
  if(v.class==='BowWeaponDataBlock'){p.arrowSpeed=r3(d.arrowSpeed);p.drawSeconds=r3(d.drawLength);}
  // Guns: bulletRange (how far a shot travels), fireSoundRange (how far it is heard), recoil pitch in degrees, pellets.
  if(d.bulletRange){p.effectiveRange=r3(d.bulletRange);p.heardFrom=nz(r3(d.fireSoundRange));p.recoil=d.recoilPitchMax?[r3(d.recoilPitchMin),r3(d.recoilPitchMax)]:undefined;}
  if(d.numPellets>1)p.pellets=d.numPellets;
  // Mod slots: each gun rolls Random.Range(0, maxEligableSlots + 1) when it is made (HeldItemDataBlock.InstallData).
  if(d.maxEligableSlots!=null)p.modSlots=d.maxEligableSlots;
  if(d.deployLength)p.readySeconds=r3(d.deployLength);
  // Melee tools: the calories a swing costs. (gatherPerHitAmount is never read by the original code: gathering uses each
  // tool's efficiencies, see the Gathering guide.)
  if(d.caloriesPerSwing)p.caloriesPerSwing=r3(d.caloriesPerSwing);}
 // The item's own in-game description, when the original has one.
 if(d.itemDescriptionOverride?.trim())p.description=d.itemDescriptionOverride.trim();
 if(t==='armour'&&d.armorValues?.damageArray)p.protection=clean(Object.fromEntries(ARMOUR.map((k,i)=>[k,nz(d.armorValues.damageArray[i])])));
 if(t==='consumable')Object.assign(p,{calories:nz(d.calories),water:nz(r3(d.litresOfWater)),heal:nz(d.healthToHeal),antiRads:nz(d.antiRads),poison:nz(d.poisonAmount)});
 if(v.class==='BasicHealthKitDataBlock'){p.heal=[d.healthAddMin,d.healthAddMax];p.stopsBleeding=d.stopsBleeding?true:undefined;}
 if(v.class==='BloodDrawDatablock')p.bloodTaken=d.bloodToTake;
 if(t==='resource')Object.assign(p,{flammable:d.flammable?true:undefined,cookable:d.cookable?true:undefined});
 const prefab=d.DeployableObjectPrefabName??d.structureToPlaceName;if(prefab)p.prefab=prefab;
 return clean(p);}

// Unique slugs: a later item with the same name gets its path id appended.
function uniqueSlugs(list,name){const seen=new Set();return list.map(x=>{let s=slugify(name(x));if(seen.has(s))s+='-'+pathId(x.id);seen.add(s);return s;});}

export function itemsFromManifest(m){
 const ref=itemIndex(m.items),list=Object.entries(m.items).filter(([,v])=>v.class!=='BlueprintDataBlock').map(([id,v])=>({id,...v}));
 const slugs=uniqueSlugs(list,x=>x.data.m_Name);
 return list.map((v,i)=>({slug:slugs[i],name:v.data.m_Name,type:typeOf(v),class:v.class,icon:m.icons?.[v.data.icon]?.file??null,props:propsOf(v,ref)}));
}

export function recipesFromManifest(m,{missing=[]}={}){
 const ref=itemIndex(m.items),slugOf=new Map(itemsFromManifest(m).map((it,i)=>[it.name,it.slug]));
 const out=[],seen=new Set();
 for(const b of Object.values(m.blueprints)){const r=ref(b.result);if(!r){missing.push({recipe:b.name,id:b.result});continue;}
  let slug=slugOf.get(r.data.m_Name);if(seen.has(slug))slug+='-'+pathId(b.source??b.name);seen.add(slug);
  const ingredients=[];for(const g of b.ingredients){const it=ref(g.item);if(!it){missing.push({recipe:b.name,id:g.item});continue;}ingredients.push({slug:slugOf.get(it.data.m_Name),amount:g.amount});}
  out.push({slug,name:b.name,result:{slug:slugOf.get(r.data.m_Name),amount:b.amount},ingredients,seconds:b.seconds,workbench:Boolean(b.workbench)});}
 return out;
}
// Cooking and smelting (FireBarrel/Furnace.ConsumeFuel and CookInfo, browser/deployables.mjs): each cookable item turns
// into its cookedVersion. A campfire (FireBarrel, myTemp 1) only takes Raw-flagged items; a furnace (myTemp 5) takes
// anything. The heat must reach cookHeatRequirement; food at or above its burnTemp turns to charcoal instead. Food cooks
// one for one, resources give numToGiveCookedMin..Max each. Fuel: a campfire burns 1 wood a minute for 3 charcoal,
// a furnace 2 wood every 30 s for 5 charcoal, smelting up to 2 of each slot's stack per burn.
const RAW_FLAG=0x200;
export const FIRES={campfire:{name:'Camp Fire',minutes:1,wood:1,charcoal:3,perSlot:2,slots:3},furnace:{name:'Furnace',minutes:.5,wood:2,charcoal:5,perSlot:2,slots:3}};
export function cookingTable(items,{campfireTemp=1,furnaceTemp=5}={}){
 const ref=itemIndex(items),out=[];
 for(const v of Object.values(items)){const d=v.data;if(v.class==='BlueprintDataBlock'||!d.cookable||!d.cookedVersion?.m_PathID)continue;
  const into=ref(String(d.cookedVersion.m_PathID));if(!into)continue;const food='calories' in d;
  const [min,max]=food?[1,1]:[d.numToGiveCookedMin??1,d.numToGiveCookedMax??1];
  for(const [station,temp] of [['campfire',campfireTemp],['furnace',furnaceTemp]]){
   if(station==='campfire'&&!((d._itemFlags??0)&RAW_FLAG))continue;if(temp<(d.cookHeatRequirement??1))continue;
   const burns=food&&d.burnTemp!=null&&temp>=d.burnTemp;
   out.push({from:d.m_Name,into:burns?'Charcoal':into.data.m_Name,min,max,station,...(burns?{burns:true}:{})});}}
 return out;
}
export function usedIn(recipes){const m=new Map();for(const r of recipes)for(const g of r.ingredients){if(!m.has(g.slug))m.set(g.slug,[]);m.get(g.slug).push(r.slug);}return m;}

// Building pieces and their raid targets from the prefabs' TakeDamage components (health, armour per damage type).
export function raidRules(itemsManifest,deployables){
 const items=itemsFromManifest(itemsManifest),targets=[];let explosive=null;
 for(const it of items){const prefab=it.props.prefab&&deployables.prefabs[it.props.prefab];if(!prefab)continue;
  const te=prefab.components?.TimedExplosive?.[0]?.data;
  if(te){explosive={name:it.name,slug:it.slug,damage:te.damage,radius:te.explosionRadius,fuse:te.fuseLength};continue;}
  const td=takeDamageData(prefab);if(td)targets.push({target:it.name,slug:it.slug,kind:it.type,...td});}
 return {explosive,targets};
}
// Charges to destroy each target when the charge is stuck to it (its carrier takes the full damage), replaying
// TakeDamage.hurt with the explosion damage list so the target's armour applies exactly as in the game.
export function raidTable({explosive,targets}){
 return targets.filter(t=>t.armor).map(t=>{const td=new TakeDamage(t);let charges=0;
  while(charges<1000){charges++;if(td.hurt(damageList(explosive.damage,Damage.Explosion)).status===LifeStatus.WasKilled)break;}
  return {target:t.target,slug:t.slug,health:t.maxHealth,charges:charges<1000?charges:null};});
}
export function buildingPieces(rules){
 const charges=new Map(raidTable(rules).map(r=>[r.slug,r.charges]));
 return rules.targets.map(t=>clean({slug:t.slug,name:t.target,kind:t.kind,health:t.maxHealth,protection:t.armor?Object.fromEntries(ARMOUR.map((k,i)=>[k,t.armor[i]])):undefined,charges:charges.get(t.slug)}));
}

export function radiationPages(zones,places){
 return zones.map((z,i)=>{const near=places.map(p=>({p,d:Math.hypot(p.x-z.x,p.z-z.z)})).filter(n=>n.d<=z.r+100).sort((a,b)=>a.d-b.d)[0]?.p??null;
  const title=near?`${near.title} radiation`:`Radiation zone ${i+1}`;
  return {slug:slugify(`${title}-${z.x}-${z.z}`),title,x:z.x,z:z.z,r:z.r,exposure:z.exposure,place:near?{title:near.title,slug:slugify(`${near.title}-${near.x}-${near.z}`)}:null};});
}

// Loot crates: each package's chance per roll is its weight share; nested lists multiply through, and a spawnOneOfEach
// list gives every package. `rolls` is LootSpawnList's Random.Range(min, min(max, packages)) range (max exclusive).
const rollRange=L=>{if(L.spawnOneOfEach)return [L.packages.length,L.packages.length];const lo=L.minPackagesToSpawn??1,hi=Math.min(L.maxPackagesToSpawn??lo,L.packages.length);return [lo,hi>lo?hi-1:lo];};
// Loot containers the crate export leaves out, read from their original prefabs (LootableObject): the airdrop's supply
// crate (SupplyCrate) and the sack a mutant leaves (AILootSack, HostileWildlifeAI.dropOnDeathString
// ";drop_lootsack_zombie" on MutantWolf/MutantBear). lifetime: LootableObject.lifeTime, seconds before it disappears
// (it also goes once emptied).
export const EXTRA_CONTAINERS=[
 {prefab:'SupplyCrate',name:'Supply Crate',list:'SupplyDropSpawnListMaster',slots:12,lifetime:600,how:'airdrop'},
 {prefab:'AILootSack',name:'Mutant Loot Sack',list:'AILootList',slots:12,lifetime:300,how:'drop',ngc:';drop_lootsack_zombie'},
];
// blueprintRecipe(blueprint item id) → the recipe slug its Study teaches; looted blueprints link there.
export function lootTables(loot,{items,blueprintRecipe=()=>null,extra=[]}){
 const ref=itemIndex(items);
 function expand(name,share,out,depth=0){const L=loot.lists[name];if(!L||depth>8)return;const total=L.packages.reduce((s,p)=>s+(p.weight??0),0);
  for(const p of L.packages){const c=L.spawnOneOfEach?share:total>0?share*(p.weight??0)/total:null;
   if(p.list)expand(p.list,c??share,out,depth+1);
   else if(p.item){const it=ref(p.item);if(!it)continue;const bp=it.class==='BlueprintDataBlock',slug=bp?blueprintRecipe(it.id)??slugify(it.data.m_Name):slugify(it.data.m_Name);
    const key=(bp?'bp:':'')+slug,prev=out.get(key);
    if(prev){prev.min=Math.min(prev.min,p.amountMin);prev.max=Math.max(prev.max,p.amountMax);prev.chance=prev.chance==null||c==null?null:prev.chance+c;}
    else out.set(key,{slug,name:it.data.m_Name,min:p.amountMin,max:p.amountMax,chance:c,...(bp?{blueprint:true}:{})});}}}
 const table=(name,list,more)=>{const out=new Map();expand(list,1,out);const L=loot.lists[list];
  return {slug:slugify(name),name,...more,list,rolls:L?rollRange(L):null,contents:[...out.values()].map(c=>({...c,chance:c.chance==null?null:Math.round(c.chance*10000)/10000}))};};
 return [...Object.values(loot.prefabs).map(p=>table(spaced(p.name),p.lootable.spawnList,{slots:p.lootable.NumberOfSlots,kind:'crate'})),
  ...extra.filter(x=>loot.lists[x.list]).map(x=>table(x.name,x.list,{slots:x.slots,kind:x.how,lifetime:x.lifetime}))];
}
// Blueprint names every new player already knows: the Default Loadout's _defaultBlueprints (Loadout.defaultBlueprints).
export function defaultBlueprints(m){
 const lo=Object.values(m.loadouts??{}).find(l=>l.data?.m_Name==='Default Loadout'),name=new Map(Object.entries(m.blueprints).map(([id,b])=>[pathId(id),b.name]));
 return new Set((lo?.data._defaultBlueprints??[]).map(p=>name.get(String(p.m_PathID))).filter(Boolean));
}
// recipe slug → the containers its blueprint can come out of, with the chance per roll.
export function blueprintSources(containers){
 const m=new Map();for(const c of containers)for(const x of c.contents)if(x.blueprint){if(!m.has(x.slug))m.set(x.slug,[]);m.get(x.slug).push({slug:c.slug,name:c.name,chance:x.chance});}
 return m;
}

// Prefab names as words: Chicken_A → Chicken, MutantWolf → Mutant Wolf, BoxLoot → Box Loot, Ore1 → Ore 1.
const spaced=n=>n.replace(/_[A-Z]$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/(\D)(\d)$/,'$1 $2');
// Hostile animals' bite (HostileWildlifeAI attackDamageMin/Max every attackRate s within attackRange m) and what they
// leave on death (dropOnDeathString → one of EXTRA_CONTAINERS).
const dropSlug=ngc=>{const c=EXTRA_CONTAINERS.find(x=>x.ngc&&x.ngc===ngc);return c?slugify(c.name):undefined;};
export function animalsFromManifest(a,{items}){const ref=itemIndex(items);
 return Object.values(a.animals).map(x=>clean({slug:slugify(spaced(x.name)),name:spaced(x.name),health:x.takeDamage?.maxHealth,hostile:Boolean(x.hostile),
  walkSpeed:x.ai?.walkSpeed,runSpeed:x.ai?.runSpeed,
  attack:x.ai?.attackDamageMax?{damage:[x.ai.attackDamageMin,x.ai.attackDamageMax],rate:r3(x.ai.attackRate),range:r3(x.ai.attackRange)}:undefined,
  drop:x.ai?.dropOnDeathString?dropSlug(x.ai.dropOnDeathString):undefined,yields:(x.resourceTarget?.resourcesAvailable??[]).map(r=>{const it=ref(r.item);return {slug:slugify(it?.data.m_Name??r.name),name:it?.data.m_Name??r.name,min:r.amountMin,max:r.amountMax};})}));
}
export function resourceNodes(r,{items}){const ref=itemIndex(items);
 return Object.values(r.prefabs).map(p=>({slug:slugify(spaced(p.name)),name:spaced(p.name),gatherEfficiency:p.resourceTarget?.gatherEfficiencyMultiplier,
  yields:(p.resourceTarget?.resourcesAvailable??[]).map(y=>{const it=ref(y.item);return {slug:slugify(it?.data.m_Name??y.name),name:it?.data.m_Name??y.name,min:y.amountMin,max:y.amountMax};})}));
}

export function searchIndex(pages){
 return pages.map(p=>({t:p.title,u:p.url,s:p.section,k:[...(p.aliases??[]),...(p.keywords??[])].join(' ').toLowerCase()}));
}

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),R=path.join(root,'browser/assets/recovered'),OUT=path.join(root,'site/generated/wiki');
const read=async f=>JSON.parse(await readFile(f,'utf8'));
// The export's identity shown on wiki pages: SHA-256 of its manifest file.
const fileHash=async f=>createHash('sha256').update(await readFile(f)).digest('hex');
export async function buildWikiData(){
 const [im,dep,ani,res,loot,scene]=await Promise.all(['items','deployables','animals','resources','loot','scene'].map(n=>read(path.join(R,n,'manifest.json'))));
 const H=Object.fromEntries(await Promise.all(['items','deployables','animals','resources','scene'].map(async n=>[n,await fileHash(path.join(R,n,'manifest.json'))])));
 const mapFile=path.join(root,'site/generated/map/modern.json'),places=existsSync(mapFile)?(await read(mapFile)).places:[];
 const missing=[],items=itemsFromManifest(im),recipes=recipesFromManifest(im,{missing}),used=usedIn(recipes),rules=raidRules(im,dep);
 const madeBy=new Map(recipes.map(r=>[r.result.slug,r.slug]));
 for(const it of items){it.recipe=madeBy.get(it.slug)??null;it.usedIn=used.get(it.slug)??[];}
 // Cooking: what each item turns into on a camp fire or in a furnace, and what each cooked item is made from.
 const prefabTemp=(prefab,comp)=>dep.prefabs?.[Object.keys(dep.prefabs).find(k=>dep.prefabs[k].name===prefab)]?.components?.[comp]?.[0]?.data?.myTemp;
 const slugByName=new Map(items.map(i=>[i.name,i.slug])),cook=cookingTable(im.items,{campfireTemp:prefabTemp('Campfire','FireBarrel')??1,furnaceTemp:prefabTemp('Furnace','Furnace')??5});
 for(const c of cook){const a=items.find(i=>i.name===c.from),b=items.find(i=>i.name===c.into);if(!a||!b)continue;const e={station:c.station,min:c.min,max:c.max,...(c.burns?{burns:true}:{})};
  (a.cooks??=[]).push({slug:b.slug,...e});if(!c.burns)(b.cookedFrom??=[]).push({slug:a.slug,...e});}
 const wood=items.find(i=>i.name==='Wood'),charcoal=items.find(i=>i.name==='Charcoal');
 if(wood&&charcoal)for(const [station,f] of Object.entries(FIRES)){(wood.burns??=[]).push({slug:charcoal.slug,station,perWood:f.charcoal/f.wood});(charcoal.cookedFrom??=[]).push({slug:wood.slug,station,min:f.charcoal/f.wood,max:f.charcoal/f.wood,fuel:true});}
 // Loot containers, with looted blueprints pointing at their recipes; each recipe lists where its blueprint drops.
 const recipeByName=new Map(recipes.map(r=>[r.name,r.slug])),bpRecipe=new Map(Object.entries(im.blueprints).map(([id,b])=>[pathId(id),recipeByName.get(b.name)]));
 const containers=lootTables(loot,{items:im.items,blueprintRecipe:id=>bpRecipe.get(pathId(id))??null,extra:EXTRA_CONTAINERS});
 const animals=animalsFromManifest(ani,{items:im.items});
 for(const c of containers){const by=animals.filter(a=>a.drop===c.slug).map(a=>a.slug);if(by.length)c.droppedBy=by;}
 const sources=blueprintSources(containers),known=defaultBlueprints(im);
 for(const r of recipes){const s=sources.get(r.slug);if(s)r.foundIn=s;if(known.has(r.name))r.known=true;}
 const placePages=places.map(p=>({slug:slugify(`${p.title}-${p.x}-${p.z}`),...p}));
 const rad=radiationPages(scene.world?.radiationZones?.map(z=>({x:Math.round(z.position[0]),z:Math.round(z.position[2]),r:z.radius,exposure:z.exposurePerMin}))??[],places);
 const sections={
  items:{source:H.items,entries:items},
  recipes:{source:H.items,entries:recipes},
  building:{source:H.deployables,entries:buildingPieces(rules)},
  raiding:{source:H.deployables,explosive:rules.explosive,entries:raidTable(rules)},
  animals:{source:H.animals,entries:animals},
  resources:{source:H.resources,entries:resourceNodes(res,{items:im.items}),loot:containers},
  places:{source:H.scene,entries:placePages},
  radiation:{source:H.scene,entries:rad},
 };
 await mkdir(path.join(OUT,'icons'),{recursive:true});
 let icons=0;const noIcon=[];
 for(const it of items){const src=it.icon&&path.join(R,'items',it.icon);if(src&&existsSync(src)){await copyFile(src,path.join(OUT,'icons',it.slug+'.png'));it.icon=`/site/generated/wiki/icons/${it.slug}.png`;icons++;}else{it.icon=null;noIcon.push(it.name);}}
 for(const [name,data] of Object.entries(sections))await writeFile(path.join(OUT,name+'.json'),JSON.stringify(data));
 const S={items:'Items',recipes:'Crafting',building:'Building',animals:'Animals',resources:'Resources',places:'Places',radiation:'Radiation'};
 const pages=[...items.map(i=>({title:i.name,url:`/wiki/items/${i.slug}`,section:S.items,aliases:i.recipe?[recipes.find(r=>r.slug===i.recipe).name]:[],keywords:[i.type]})),
  ...recipes.map(r=>({title:r.name,url:`/wiki/recipes/${r.slug}`,section:S.recipes,keywords:['craft','blueprint']})),
  ...sections.animals.entries.map(a=>({title:a.name,url:`/wiki/animals/${a.slug}`,section:S.animals,keywords:[a.hostile?'hostile':'passive']})),
  ...sections.resources.entries.map(n=>({title:n.name,url:`/wiki/resources/${n.slug}`,section:S.resources,keywords:n.yields.map(y=>y.name)})),
  ...sections.resources.loot.map(n=>({title:n.name,url:`/wiki/resources/${n.slug}`,section:S.resources,keywords:['loot','crate',...({drop:['mutant','sack','drop','blueprint','research kit'],airdrop:['airdrop','supply','drop','plane']}[n.kind]??[])]})),
  ...placePages.map(p=>({title:p.title,url:`/wiki/places/${p.slug}`,section:S.places,keywords:p.features??[]})),
  ...rad.map(z=>({title:z.title,url:`/wiki/radiation/${z.slug}`,section:S.radiation,keywords:['radiation','rad']})),
  {title:'Building',url:'/wiki/building',section:S.building,keywords:['structure','foundation','wall','health']},
  {title:'Raiding',url:'/wiki/raiding',section:S.building,keywords:['explosive','charge','raid','door']}];
 await writeFile(path.join(OUT,'search.json'),JSON.stringify(searchIndex(pages)));
 const report={counts:Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,v.entries.length])),loot:sections.resources.loot.length,icons,noIcon,missing,search:pages.length};
 await writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,1));
 return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=await buildWikiData();console.log(JSON.stringify({...r,noIcon:r.noIcon.length,missing:r.missing.length}));
}
