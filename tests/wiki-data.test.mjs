import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {slugify,itemsFromManifest,recipesFromManifest,usedIn,raidRules,raidTable,radiationPages,searchIndex,lootTables,cookingTable,EXTRA_CONTAINERS,blueprintSources,animalsFromManifest,defaultBlueprints} from '../tools/build-wiki-data.mjs';
import {needsAssets} from './helpers/assets.mjs';

const item=(cls,name,extra={},category=0)=>({class:cls,data:{m_Name:name,icon:'content/item/tex/'+slugify(name),_maxUses:1,_splittable:0,category,...extra}});
const fixture={
 items:{
  'cab-scriptableobject.000:1':item('MeleeWeaponDataBlock','Hatchet',{damageMin:25,damageMax:25,fireRate:0.8999999761581421,range:1.5},1),
  'cab-gameobject.000:2':item('ResourceTypeItemDataBlock','Wood',{_maxUses:250,_splittable:1},11),
  'cab-scriptableobject.000:3':item('ResourceTypeItemDataBlock','Metal Fragments',{_maxUses:250,_splittable:1},11),
  'cab-scriptableobject.000:4':item('BlueprintDataBlock','Hatchet Blueprint'),
  'cab-scriptableobject.000:5':item('DeployableItemDataBlock','Wood Storage Box',{DeployableObjectPrefabName:';deploy_wood_box'}),
  'cab-scriptableobject.000:6':item('DeployableItemDataBlock','Explosive Charge',{DeployableObjectPrefabName:';explosive_charge'},1),
  'cab-scriptableobject.000:7':item('HandGrenadeDataBlock','Supply Signal',{},8),
 },
 blueprints:{
  'cab-scriptableobject.000:4':{name:'Hatchet Blueprint',result:'cab-scriptableobject.000:1',amount:1,ingredients:[{item:'cab-gameobject.000:2',amount:1},{item:'cab-datablock.000:3',amount:10}],seconds:10,workbench:false},
  'cab-scriptableobject.000:8':{name:'Box Blueprint',result:'cab-scriptableobject.000:5',amount:1,ingredients:[{item:'cab-gameobject.000:2',amount:30},{item:'cab-gameobject.000:99',amount:2}],seconds:20,workbench:true},
 },
 icons:{},
};

test('slugify makes lowercase hyphenated slugs', () => {
 assert.equal(slugify('Wood Storage Box'),'wood-storage-box');
 assert.equal(slugify('  9mm Ammo '),'9mm-ammo');
 assert.equal(slugify('Anti-Radiation Pills'),'anti-radiation-pills');
 assert.equal(slugify('M4'),'m4');
 assert.equal(slugify('Hangar-6363-4632'),'hangar-6363-4632');
});

test('itemsFromManifest skips blueprints and types items from their class and original category', () => {
 const items=itemsFromManifest(fixture);
 assert.equal(items.length,6);
 assert.ok(!items.some(i=>/Blueprint/.test(i.name)));
 const by=Object.fromEntries(items.map(i=>[i.name,i]));
 assert.equal(by.Hatchet.type,'weapon');
 assert.equal(by.Hatchet.slug,'hatchet');
 assert.deepEqual(by.Hatchet.props.damage,[25,25]);assert.equal(by.Hatchet.props.fireRate,0.9);
 assert.equal(by.Wood.type,'resource');
 assert.equal(by.Wood.props.stack,250);
 assert.equal(by['Wood Storage Box'].type,'deployable');
 assert.equal(by['Explosive Charge'].type,'explosive');
 assert.equal(by['Supply Signal'].type,'tool');
});

test('recipes join ingredient ids to item slugs and report unknown ids', () => {
 const missing=[];const recipes=recipesFromManifest(fixture,{missing});
 const hatchet=recipes.find(r=>r.result.slug==='hatchet');
 assert.deepEqual(hatchet.ingredients,[{slug:'wood',amount:1},{slug:'metal-fragments',amount:10}]);
 assert.equal(hatchet.seconds,10);assert.equal(hatchet.workbench,false);
 const box=recipes.find(r=>r.result.slug==='wood-storage-box');
 assert.deepEqual(box.ingredients,[{slug:'wood',amount:30}]);
 assert.deepEqual(missing,[{recipe:'Box Blueprint',id:'cab-gameobject.000:99'}]);
 assert.deepEqual(usedIn(recipes).get('wood'),['hatchet','wood-storage-box']);
});

test('raid table counts explosive charges with the original TakeDamage armour rule',needsAssets, async () => {
 const read=f=>readFile(new URL('../browser/assets/recovered/'+f,import.meta.url),'utf8').then(JSON.parse);
 const rules=raidRules(await read('items/manifest.json'),await read('deployables/manifest.json'));
 assert.equal(rules.explosive.name,'Explosive Charge');
 const table=raidTable(rules);
 assert.deepEqual(table.find(r=>r.target==='Wooden Door'),{target:'Wooden Door',slug:'wooden-door',health:500,charges:1});
 assert.deepEqual(table.find(r=>r.target==='Wood Gateway'),{target:'Wood Gateway',slug:'wood-gateway',health:2000,charges:5});
 assert.ok(!table.some(r=>r.target==='Explosive Charge'));
});

test('radiation pages name zones after the nearest place', () => {
 const pages=radiationPages([{x:100,z:100,r:50,exposure:500},{x:900,z:900,r:40,exposure:250}],[{title:'Hangar',x:110,z:95}]);
 assert.equal(pages[0].title,'Hangar radiation');assert.equal(pages[0].place.title,'Hangar');assert.equal(pages[0].exposure,500);
 assert.equal(pages[1].title,'Radiation zone 2');assert.equal(pages[1].place,null);
 assert.notEqual(pages[0].slug,pages[1].slug);
});

test('loot tables flatten nested lists into item chances, with the crate roll count', () => {
 const items={'cab-gameobject.000:2':item('ResourceTypeItemDataBlock','Wood',{},11),'cab-scriptableobject.000:3':item('ResourceTypeItemDataBlock','Metal Fragments',{},11)};
 // LootSpawnList: Random.Range(min, min(max, packages)) rolls, max exclusive (and min when max <= min).
 const loot={prefabs:{a:{name:'BoxLoot',lootable:{NumberOfSlots:12,spawnList:'Junk'}},b:{name:'WeaponLootBox',lootable:{NumberOfSlots:12,spawnList:'Weapon'}}},lists:{
  Junk:{minPackagesToSpawn:1,maxPackagesToSpawn:3,packages:[{weight:30,amountMin:5,amountMax:20,item:'cab-gameobject.000:2'},{weight:10,amountMin:1,amountMax:1,list:'Inner'}]},
  Inner:{minPackagesToSpawn:1,maxPackagesToSpawn:1,packages:[{weight:1,amountMin:2,amountMax:4,item:'cab-datablock.000:3'}]},
  Weapon:{minPackagesToSpawn:1,maxPackagesToSpawn:1,packages:[{weight:1,amountMin:1,amountMax:1,list:'Bundle'}]},
  Bundle:{spawnOneOfEach:true,minPackagesToSpawn:1,maxPackagesToSpawn:1,packages:[{weight:0,amountMin:200,amountMax:200,item:'cab-gameobject.000:2'},{weight:0,amountMin:50,amountMax:50,item:'cab-datablock.000:3'}]}}};
 const [box,weapon]=lootTables(loot,{items});
 assert.equal(box.name,'Box Loot');assert.equal(box.slug,'box-loot');assert.equal(box.slots,12);
 assert.deepEqual(box.rolls,[1,1]); // max 3, but only 2 packages to pick from
 assert.deepEqual(box.contents,[{slug:'wood',name:'Wood',min:5,max:20,chance:0.75},{slug:'metal-fragments',name:'Metal Fragments',min:2,max:4,chance:0.25}]);
 // A spawnOneOfEach list gives every package: both items arrive together, each with the bundle's full chance.
 assert.deepEqual(weapon.rolls,[1,1]);
 assert.deepEqual(weapon.contents,[{slug:'wood',name:'Wood',min:200,max:200,chance:1},{slug:'metal-fragments',name:'Metal Fragments',min:50,max:50,chance:1}]);
});

test('the real crates roll 1–2 (box, medical) or once (ammo, weapon)',needsAssets, async () => {
 const read=f=>readFile(new URL('../browser/assets/recovered/'+f,import.meta.url),'utf8').then(JSON.parse);
 const crates=lootTables(await read('loot/manifest.json'),{items:(await read('items/manifest.json')).items});
 assert.deepEqual(Object.fromEntries(crates.map(c=>[c.name,c.rolls])),{'Box Loot':[1,2],'Ammo Loot Box':[1,1],'Medical Loot Box':[1,2],'Weapon Loot Box':[1,1]});
});

test('search index carries title, url, section and aliases as keywords', () => {
 const idx=searchIndex([{title:'Explosive Charge',url:'/wiki/items/explosive-charge',section:'Items',aliases:['Explosive Charge Blueprint'],keywords:['explosive']}]);
 assert.deepEqual(idx,[{t:'Explosive Charge',u:'/wiki/items/explosive-charge',s:'Items',k:'explosive charge blueprint explosive'}]);
});

test('cookingTable: food cooks one for one on a camp fire and burns in a furnace; ore and cloth need the furnace',()=>{
 const it=(id,name,data,cls='ResourceTypeItemDataBlock')=>[`cab-datablock.000:${id}`,{class:cls,data:{m_Name:name,_itemFlags:0,...data}}];
 const items=Object.fromEntries([
  it(1,'Raw Chicken Breast',{calories:80,cookable:1,cookedVersion:{m_PathID:2},cookHeatRequirement:1,burnTemp:2,_itemFlags:0x200},'ConsumableDataBlock'),
  it(2,'Cooked Chicken Breast',{calories:200},'ConsumableDataBlock'),
  it(3,'Sulfur Ore',{cookable:1,cookedVersion:{m_PathID:4},cookHeatRequirement:5,numToGiveCookedMin:3,numToGiveCookedMax:4}),it(4,'Sulfur',{}),
  it(5,'Cloth',{cookable:1,cookedVersion:{m_PathID:6},cookHeatRequirement:1,numToGiveCookedMin:1,numToGiveCookedMax:1}),it(6,'Leather',{}),
 ]);
 assert.deepEqual(cookingTable(items),[
  {from:'Raw Chicken Breast',into:'Cooked Chicken Breast',min:1,max:1,station:'campfire'},
  {from:'Raw Chicken Breast',into:'Charcoal',min:1,max:1,station:'furnace',burns:true},
  {from:'Sulfur Ore',into:'Sulfur',min:3,max:4,station:'furnace'},
  {from:'Cloth',into:'Leather',min:1,max:1,station:'furnace'}]);
});

test('loot: a blueprint links to its recipe, and the supply crate and mutant loot sack are containers too', () => {
 const items={'cab-gameobject.000:2':item('ResourceTypeItemDataBlock','Wood',{},11),'cab-scriptableobject.000:4':item('BlueprintDataBlock','Hatchet Blueprint'),'cab-scriptableobject.000:1':item('MeleeWeaponDataBlock','Hatchet')};
 const loot={prefabs:{a:{name:'WeaponLootBox',lootable:{NumberOfSlots:12,spawnList:'Weapon'}}},lists:{
  Weapon:{minPackagesToSpawn:1,maxPackagesToSpawn:1,packages:[{weight:1,amountMin:1,amountMax:1,item:'cab-scriptableobject.000:1'},{weight:1,amountMin:1,amountMax:1,item:'cab-scriptableobject.000:4'}]},
  AI:{minPackagesToSpawn:1,maxPackagesToSpawn:2,packages:[{weight:3,amountMin:5,amountMax:5,item:'cab-gameobject.000:2'},{weight:1,amountMin:1,amountMax:1,item:'cab-scriptableobject.000:4'}]}}};
 const extra=[{prefab:'AILootSack',name:'Mutant Loot Sack',list:'AI',slots:12,lifetime:300,how:'drop'}];
 const [box,sack]=lootTables(loot,{items,blueprintRecipe:id=>id.endsWith(':4')?'hatchet':null,extra});
 // The weapon and its blueprint share a slug but stay apart; the blueprint points at the recipe page.
 assert.deepEqual(box.contents,[{slug:'hatchet',name:'Hatchet',min:1,max:1,chance:0.5},{slug:'hatchet',name:'Hatchet Blueprint',min:1,max:1,chance:0.5,blueprint:true}]);
 assert.equal(box.kind,'crate');
 assert.deepEqual({slug:sack.slug,name:sack.name,kind:sack.kind,slots:sack.slots,lifetime:sack.lifetime,rolls:sack.rolls},{slug:'mutant-loot-sack',name:'Mutant Loot Sack',kind:'drop',slots:12,lifetime:300,rolls:[1,1]});
 assert.deepEqual(blueprintSources([box,sack]).get('hatchet'),[{slug:'weapon-loot-box',name:'Weapon Loot Box',chance:0.5},{slug:'mutant-loot-sack',name:'Mutant Loot Sack',chance:0.25}]);
});

test('the original data: mutants drop a loot sack with blueprints and research kits; airdrops hold no blueprints',needsAssets, async () => {
 const read=f=>readFile(new URL('../browser/assets/recovered/'+f,import.meta.url),'utf8').then(JSON.parse);
 const [lootM,itemsM,aniM]=await Promise.all(['loot','items','animals'].map(n=>read(n+'/manifest.json')));
 const recipes=recipesFromManifest(itemsM),byName=new Map(recipes.map(r=>[r.name,r.slug]));
 const blueprintRecipe=id=>{const b=Object.entries(itemsM.blueprints).find(([k])=>k.split(':').pop()===String(id).split(':').pop());return b?byName.get(b[1].name)??null:null;};
 const all=lootTables(lootM,{items:itemsM.items,blueprintRecipe,extra:EXTRA_CONTAINERS});
 const sack=all.find(c=>c.slug==='mutant-loot-sack'),supply=all.find(c=>c.slug==='supply-crate'),weapon=all.find(c=>c.slug==='weapon-loot-box');
 assert.deepEqual([sack.rolls,sack.slots,sack.lifetime,sack.kind],[[1,1],12,300,'drop']);
 assert.equal(Math.round(sack.contents.find(c=>c.name==='Research Kit 1').chance*1000),58); // its own list (5 of 106) plus kits in the junk list
 assert.ok(sack.contents.some(c=>c.blueprint&&c.name==='Kevlar Vest BP'));
 assert.ok(supply&&supply.kind==='airdrop'&&!supply.contents.some(c=>c.blueprint),'airdrops: no blueprints');
 assert.equal(weapon.contents.filter(c=>c.blueprint).length,10);
 assert.ok(all.flatMap(c=>c.contents).filter(c=>c.blueprint).every(c=>recipes.some(r=>r.slug===c.slug)),'every looted blueprint has its recipe page');
 const animals=animalsFromManifest(aniM,{items:itemsM.items}),a=n=>animals.find(x=>x.name===n);
 assert.equal(a('Mutant Wolf').drop,'mutant-loot-sack');assert.equal(a('Mutant Bear').drop,'mutant-loot-sack');
 assert.equal(a('Wolf').drop,undefined);assert.equal(a('Bear').drop,undefined);
 assert.deepEqual(a('Mutant Wolf').attack,{damage:[25,25],rate:1,range:2});
});

test('items carry their in-game description and the weapon numbers players compare',needsAssets, async () => {
 const read=f=>readFile(new URL('../browser/assets/recovered/'+f,import.meta.url),'utf8').then(JSON.parse);
 const items=itemsFromManifest(await read('items/manifest.json')),it=n=>items.find(x=>x.name===n);
 assert.match(it('Metal Doorway').props.description,/between two pillars/);
 const m4=it('M4').props;assert.equal(m4.effectiveRange>0,true);assert.equal(m4.heardFrom>0,true);assert.equal(m4.recoil.length,2);
 assert.equal(it('M4').props.modSlots,5);assert.equal(it('Bolt Action Rifle').props.modSlots,4);assert.equal(it('Pipe Shotgun').props.modSlots,0);
 assert.equal(it('Shotgun').props.pellets,12);assert.equal(it('Pipe Shotgun').props.pellets,8);
 const hatchet=it('Hatchet').props;assert.equal(hatchet.gatherPerHit,undefined,'unused by the original code');assert.equal(hatchet.caloriesPerSwing,5);
});

test('new players know the Default Loadout blueprints',needsAssets, async () => {
 const im=JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url),'utf8'));
 const known=defaultBlueprints(im);
 assert.equal(known.size,45);
 for(const n of ['Hatchet Blueprint','Furnace Blueprint','Revolver Blueprint','Wood Foundation BP'])assert.ok(known.has(n),n);
 for(const n of ['P250 Blueprint','M4 Blueprint','Kevlar Vest BP','Explosive Charge Blueprint'])assert.ok(!known.has(n),n);
});
