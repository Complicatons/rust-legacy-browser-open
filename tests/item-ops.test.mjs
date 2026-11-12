// Item menu, study/research, split, unload, blood draw and RPOS cell operations, against the decompiled rules
// (browser/item-ops.mjs header lists the source methods).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {LegacyInventory} from '../browser/inventory.mjs';
import {ServerInventory} from '../browser/server-inventory.mjs';
import {HumanBody} from '../browser/survival.mjs';
import {saveWorld,loadWorld} from '../browser/persistence.mjs';
import {createItemMenu} from '../browser/item-menu.mjs';
import {MENU,OPS,RESULT,menuOptions,slotOperation,combineRecipe,findBlueprintFor,drawBlood,quickMoveSlot} from '../browser/item-ops.mjs';
import {GameBridge} from '../bridge/game-bridge.mjs';
import {readArgs,readNgcCall} from '../bridge/ulink/rust.mjs';
import {BitReader} from '../bridge/ulink/bits.mjs';
import {inventoryFixture as fixture} from './helpers/inventory-fixture.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const cat=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const key=n=>{const k=Object.keys(cat.items).find(k=>cat.items[k].data.m_Name===n);assert.ok(k,n);return k;};
const bpOf=n=>findBlueprintFor(cat,key(n));
const slot=(n,uses,extra={})=>({item:key(n),uses,condition:1,maxCondition:1,...extra});
function fresh(slots={}){const inv=new LegacyInventory(cat,undefined,{rng:()=>0.999});inv.slots.fill(null);inv.known=new Set();for(const [i,s] of Object.entries(slots))inv.slots[i]=s;return inv;}

test('right-click menu lists exactly RetreiveMenuOptions: Split first, then the datablock option; never Info',needsAssets,()=>{
 const opts=(n,uses,local)=>menuOptions(cat.items[key(n)],{item:key(n),uses},{local});
 assert.deepEqual(opts('Wood',12),['Split']);assert.deepEqual(opts('Wood',1),[]);
 assert.deepEqual(opts('M4 Blueprint',1),['Study']);assert.deepEqual(opts('Wood Planks Blueprint',1),['Study']);
 assert.deepEqual(opts('M4',24),['Unload']);assert.deepEqual(opts('Pipe Shotgun',1),['Unload']);assert.deepEqual(opts('HandCannon',1),['Unload'],'StrikeGunDataBlock : ShotgunDataBlock : BulletWeaponDataBlock');
 assert.deepEqual(opts('Hunting Bow',1),[]);assert.deepEqual(opts('Research Kit 1',3),[]);
 assert.deepEqual(opts('Raw Chicken Breast',2),['Split','Eat']);assert.deepEqual(opts('Small Water Bottle',1),['Drink']);assert.deepEqual(opts('Small Rations',1),['Consume']);
 assert.deepEqual(opts('Small Medkit',1),['Use']);assert.deepEqual(opts('Bandage',3),['Split','Use']);assert.deepEqual(opts('Blood Draw Kit',1),['Use']);
 assert.deepEqual(opts('Wood',12,false),[],'isInLocalInventory: loot cells list nothing');
 for(const k of Object.keys(cat.items))assert.ok(!menuOptions(cat.items[k],{item:k,uses:250}).includes('Info'));
});

test('Study learns the blueprint and consumes it; a known blueprint stays with the original notice',needsAssets,()=>{
 const notices=[],bp=bpOf('Wood Planks'),inv=fresh({4:{item:bp,uses:1,condition:1,maxCondition:1},5:{item:bp,uses:1,condition:1,maxCondition:1}});
 assert.equal(inv.study(4,m=>notices.push(m)),true);assert.equal(inv.slots[4],null);assert.ok(inv.known.has(bp));assert.deepEqual(notices,['You can now craft: Wood Planks']);
 assert.equal(inv.study(5,m=>notices.push(m)),false);assert.ok(inv.slots[5],'already-known blueprint is not consumed');assert.equal(notices[1],'You already have this blueprint');
 assert.equal(inv.canCraft(bp).ok,false,'needs ingredients, but is now known');assert.notEqual(inv.canCraft(bp).reason,'Blueprint not known');
});

test('quickMoveSlot (shift-click quick-move, owner playtest 2026-10-29): a same-item slot with room first, else the first empty slot, never past addLimit',needsAssets,()=>{
 const wood=key('Wood'),maxUses=cat.items[wood].data._maxUses;
 assert.equal(quickMoveSlot(cat,fresh({0:slot('Wood',10)}).box(),wood),0,'stacks into the partial slot rather than opening a new one');
 assert.equal(quickMoveSlot(cat,fresh({0:slot('Wood',maxUses),1:slot('Wood',5)}).box(),wood),1,'a full matching slot is skipped for the next one with room');
 assert.equal(quickMoveSlot(cat,fresh({0:slot('Wood',5)}).box(),key('M4')),1,'a different item never stacks; it takes the first empty slot');
 const full={};for(let i=0;i<36;i++)full[i]=slot('Wood',maxUses);
 assert.equal(quickMoveSlot(cat,fresh(full).box(),wood),-1,'no destination once pack+belt (0-35) are full: slots 36-39 are empty but past addLimit (36), so equipment is never targeted by a quick-move');
});

test('learned blueprints persist in offline saves',needsAssets,()=>{
 const bp=bpOf('M4'),inv=fresh({0:{item:bp,uses:1,condition:1,maxCondition:1}});inv.study(0);
 const save=JSON.parse(JSON.stringify(saveWorld({now:10,structures:{masters:[]},deployables:{objects:[]},player:{inventory:inv}})));
 const other=fresh();loadWorld(save,{now:3,structures:{},deployables:{},player:{inventory:other}});assert.ok(other.known.has(bp));assert.equal(other.slots[0],null);
});

test('Research Kit: plain drag onto another item researches at a workbench, with the original client popups otherwise',needsAssets,()=>{
 const notices=[],o=extra=>({notice:m=>notices.push(m),...extra}),inv=fresh({0:slot('Research Kit 1',3),1:slot('M4',24,{totalModSlots:0,mods:[]}),2:slot('Blood',3),3:{item:bpOf('M4'),uses:1,condition:1,maxCondition:1}});
 assert.equal(inv.move(0,1,o()),false);assert.deepEqual(notices,['You must be at a workbench to do this.']);assert.equal(inv.slots[0].uses,3);
 assert.equal(inv.move(0,2,o({atWorkbench:true})),false);assert.equal(notices.at(-1),'You can\'t research this');
 assert.equal(inv.move(0,3,o({atWorkbench:true})),false);assert.equal(notices.at(-1),'You can\'t research this.. No Blueprint Available!...');
 assert.equal(inv.move(0,1,o({atWorkbench:true})),true);assert.ok(inv.known.has(bpOf('M4')));assert.equal(notices.at(-1),'You can now craft M4');assert.equal(inv.slots[0].uses,2,'one kit use consumed');assert.equal(inv.slots[1].uses,24,'researched item kept');
 assert.equal(inv.move(0,1,o({atWorkbench:true})),false);assert.equal(notices.at(-1),'You already know how to make this!');assert.equal(inv.slots[0].uses,2);
 inv.slots[0].uses=1;inv.slots[4]=slot('Revolver',8,{totalModSlots:0,mods:[]});assert.equal(inv.move(0,4,o({atWorkbench:true})),true);assert.equal(inv.slots[0],null,'last use removes the kit');
});

test('Shift changes only same-item merges: stack without, combine with (kit onto kit researches the kit)',needsAssets,()=>{
 const inv=fresh({0:slot('Research Kit 1',2),1:slot('Research Kit 1',3),5:slot('Wood',10),6:slot('Wood',20)});
 assert.equal(inv.move(0,1,{atWorkbench:true}),false,'plain: TryStack on a non-splittable kit fails');assert.equal(inv.known.size,0);
 assert.equal(inv.move(0,1,{atWorkbench:true,combine:true}),true,'shift: TryCombine → ResearchToolItem');assert.ok(inv.known.has(bpOf('Research Kit 1')));assert.equal(inv.slots[0].uses,1);
 assert.equal(inv.move(5,6,{combine:true}),false,'shift on wood: TryCombine has no recipe');assert.deepEqual([inv.slots[5].uses,inv.slots[6].uses],[10,20]);
 assert.equal(inv.move(5,6),true);assert.equal(inv.slots[5],null);assert.equal(inv.slots[6].uses,30);
});

test('cell operations never swap; empty targets move, slot flags apply, stacks overflow stays',needsAssets,()=>{
 const inv=fresh({0:slot('Wood',240),1:slot('M4',24,{totalModSlots:0,mods:[]}),2:slot('Wood',30),3:slot('Rock',1)});
 assert.equal(inv.move(0,1),false);assert.equal(inv.slots[0].item,key('Wood'));assert.equal(inv.slots[1].item,key('M4'),'no swap');
 assert.equal(inv.move(0,2),true);assert.deepEqual([inv.slots[0].uses,inv.slots[2].uses],[20,250]);
 assert.equal(inv.move(3,36),false,'a rock is not headwear');assert.equal(inv.move(3,9),true);assert.equal(inv.slots[9].item,key('Rock'));
 const box=inv.box();assert.equal(slotOperation(cat,{box,index:9},{box,index:10},OPS.Stack,{side:'server'}),RESULT.EmptyDestinationSlot);
 assert.equal(slotOperation(cat,{box,index:9},{box,index:1},OPS.Move,{side:'server'}),RESULT.OccupiedDestination);
});

test('mods combine with a plain drag (different items always try TryCombine), once per mod type',needsAssets,()=>{
 const inv=fresh({0:slot('Silencer',1),1:slot('M4',24,{totalModSlots:1,mods:[]}),2:slot('Holo sight',1)});
 assert.equal(inv.move(0,1),true);assert.equal(inv.slots[0],null);assert.equal(inv.slots[1].mods.length,1);
 assert.equal(inv.move(2,1),false,'no free mod slot');assert.ok(inv.slots[2]);
});

test('recipe combines (Armor/Weapon Parts, Metal Fragments) are predicted Failed by the client, so never sent or applied',needsAssets,()=>{
 const inv=fresh({0:slot('Armor Part 1',5),1:slot('Armor Part 1',3)});
 assert.equal(inv.move(0,1,{combine:true}),false);assert.deepEqual([inv.slots[0].uses,inv.slots[1].uses],[5,3]);
 // The server's InventoryItem.TryCombine effect itself (reachable only if a client sent it).
 const box=inv.box(),r=combineRecipe(cat,{box,index:0},{box,index:1});assert.equal(r.result,'Failed','returns Failed even after combining');assert.equal(r.combined,3);
 assert.equal(inv.slots[1]?.item,key('Armor Part 2'),'other consumed first, result added in its place');assert.equal(inv.slots[1].uses,3);assert.equal(inv.slots[0].uses,2);
 const f=fresh({0:slot('Metal Fragments',5),1:slot('Primed Shotgun Shell',4)}),fb=f.box();const rf=combineRecipe(cat,{box:fb,index:0},{box:fb,index:1});
 assert.equal(rf.combined,2,'amountToLose 2 fragments per shell');assert.equal(f.slots[0].uses,1);assert.equal(f.slots[1].uses,2);assert.equal(f.slots.find(s=>s?.item===key('Shotgun Shells')).uses,2);
});

test('Split moves half (rounded down) into a new stack only when a vacancy exists',needsAssets,()=>{
 const inv=fresh({0:slot('Wood',13,{condition:0.5})});assert.equal(inv.split(0),true);assert.equal(inv.slots[0].uses,7);assert.deepEqual([inv.slots[1].item,inv.slots[1].uses,inv.slots[1].condition],[key('Wood'),6,1]);
 inv.slots[0].uses=1;assert.equal(inv.split(0),false);
 const full=fresh();for(let i=0;i<36;i++)full.slots[i]=slot('Wood',3);assert.equal(full.split(0),false,'armour vacancies cannot take wood');assert.equal(full.slots[0].uses,3);
 inv.slots[2]=slot('M4',24,{totalModSlots:0,mods:[]});assert.equal(inv.split(2),false,'not splittable');
});

test('Unload returns clip ammo to the inventory; what does not fit stays in the gun',needsAssets,()=>{
 const inv=fresh({0:slot('M4',24,{totalModSlots:0,mods:[]}),1:slot('556 Ammo',240)});assert.equal(inv.unload(0),true);assert.equal(inv.slots[0].uses,0);assert.equal(inv.slots[1].uses,250);assert.equal(inv.slots[2].uses,14);
 assert.equal(inv.unload(0),false,'empty clip');
 const tight=fresh();for(let i=0;i<40;i++)tight.slots[i]=i<36?slot('Wood',1):null;tight.slots[0]=slot('P250',8,{totalModSlots:0,mods:[]});tight.slots[1]=slot('9mm Ammo',245);
 assert.equal(tight.unload(0),true,'armour vacancies count for anyVacantSlots');assert.equal(tight.slots[1].uses,250);assert.equal(tight.slots[0].uses,3);
 const none=fresh();for(let i=0;i<40;i++)none.slots[i]=slot('Wood',1);none.slots[0]=slot('P250',8,{totalModSlots:0,mods:[]});assert.equal(none.unload(0),false);assert.equal(none.slots[0].uses,8);
});

test('Blood Draw Kit: 25 health for one Blood, 2 s reuse delay, refused when too weak; kit kept',needsAssets,()=>{
 const inv=fresh({0:slot('Blood Draw Kit',1)}),body=new HumanBody(),state={},notices=[];
 assert.equal(drawBlood(cat,inv.box(),0,state,{body,now:10,notice:m=>notices.push(m)}),true);assert.equal(body.health,75);assert.equal(inv.slots.find(s=>s?.item===key('Blood')).uses,1);assert.ok(inv.slots[0]);
 assert.equal(drawBlood(cat,inv.box(),0,state,{body,now:11.9}),false);assert.equal(body.health,75);
 body.health=25;assert.equal(drawBlood(cat,inv.box(),0,state,{body,now:20,notice:m=>notices.push(m)}),false);assert.deepEqual(notices,['You\'re too weak to use this']);assert.equal(body.health,25);
});

test('offline menu actions run the datablock code; belt keys only trigger health kits',needsAssets,()=>{
 const inv=fresh({0:slot('Wood',12),1:{item:bpOf('Wood Planks'),uses:1,condition:1,maxCondition:1},2:slot('Blood Draw Kit',1),3:slot('Small Medkit',2)}),body=new HumanBody(),notices=[];body.health=50;
 const actions=createItemMenu({inventory:()=>inv,online:()=>false,body,metabolism:null,now:()=>100,notice:m=>notices.push(m),onDamage:()=>{}});
 assert.deepEqual(actions(0).map(a=>a.label),['Split']);actions(0)[0].run();assert.equal(inv.slots[0].uses,6);
 actions(1)[0].run();assert.ok(inv.known.has(bpOf('Wood Planks')));assert.equal(notices[0],'You can now craft: Wood Planks');
 assert.equal(actions(2)[0].belt,false);actions(2)[0].run();assert.equal(body.health,25);
 const use=actions(3).find(a=>a.label==='Use');assert.equal(use.belt,true);assert.equal(use.run(),true);assert.equal(inv.slots[3].uses,1);
});

function online(){const session=new EventTarget(),sent=[];session.inventoryCalls=new Map();session.client=new EventTarget();
 Object.assign(session.client,{characterView:20,playerId:1,views:new Map([[20,{prefab:':player_soldier'}]]),entities:new Map(),inventory:(action,source,data)=>sent.push({action,source,...data})});
 return {sent,inv:new ServerInventory(session,cat,{now:()=>10})};}
const own={viewId:20};
test('online: predicted cell operations become ITSM/ISMV requests with the Shift flag, and never touch slots',needsAssets,()=>{
 const {inv,sent}=online(),slots=[];slots[0]={name:'Wood',uses:10};slots[1]={name:'Wood',uses:20};slots[2]={name:'Research Kit 1',uses:3};slots[3]={name:'Research Kit 1',uses:1};slots[4]={name:'Silencer',uses:1};slots[5]={name:'Armor Part 1',uses:2};slots[6]={name:'Armor Part 1',uses:2};
 slots[30]={name:'M4',uses:24,condition:1,maxCondition:1,totalModSlots:2,mods:[]};
 inv.apply({source:own,name:'GNUP',args:[fixture(cat,{slots})]});const before=JSON.stringify(inv.slots),notices=[];
 inv.move(0,1);assert.deepEqual(sent.pop(),{action:'move',source:own,target:own,fromSlot:0,toSlot:1,op:'merge',tryCombine:false});
 inv.move(0,9);assert.deepEqual(sent.pop(),{action:'move',source:own,target:own,fromSlot:0,toSlot:9,op:'move'});
 assert.equal(inv.move(0,1,{combine:true}),false,'shift-merging wood predicts NoOp');assert.equal(inv.move(5,6,{combine:true}),false,'recipe combine is never sent');
 inv.move(4,30);assert.deepEqual(sent.pop(),{action:'move',source:own,target:own,fromSlot:4,toSlot:30,op:'merge',tryCombine:false});
 assert.equal(inv.move(2,3,{combine:true,notice:m=>notices.push(m)}),false);assert.deepEqual(notices,['You must be at a workbench to do this.']);
 inv.apply({source:own,name:'wbi',args:[true]});inv.move(2,3,{combine:true});assert.deepEqual(sent.pop(),{action:'move',source:own,target:own,fromSlot:2,toSlot:3,op:'merge',tryCombine:true});
 assert.equal(inv.move(2,3),false,'plain kit onto kit only stacks, which fails');inv.move(2,30);assert.deepEqual(sent.pop(),{action:'move',source:own,target:own,fromSlot:2,toSlot:30,op:'merge',tryCombine:false});
 assert.equal(inv.move(0,36),false,'helmet slot rejects wood: nothing sent');
 assert.equal(JSON.stringify(inv.slots),before,'GNUP stays the only slot writer');assert.equal(sent.length,0);
});

test('online menu: Split → ITSP after prediction, other options → IACT with the MenuItem byte; no local change',needsAssets,()=>{
 const {inv,sent}=online(),slots=[];slots[0]={name:'Wood',uses:12};slots[1]={name:'M4 Blueprint',uses:1};slots[2]={name:'Blood Draw Kit',uses:1};slots[30]={name:'M4',uses:24,condition:1,maxCondition:1,totalModSlots:0,mods:[]};
 inv.apply({source:own,name:'GNUP',args:[fixture(cat,{slots})]});const before=JSON.stringify(inv.slots);
 const actions=createItemMenu({inventory:()=>inv,online:()=>true});
 assert.deepEqual(actions(0).map(a=>a.label),['Split']);actions(0)[0].run();assert.deepEqual(sent.pop(),{action:'split',source:own,fromSlot:0});
 actions(1)[0].run();assert.deepEqual(sent.pop(),{action:'menu',source:own,fromSlot:1,option:MENU.Study});
 actions(2)[0].run();assert.deepEqual(sent.pop(),{action:'menu',source:own,fromSlot:2,option:MENU.Use});
 actions(30)[0].run();assert.deepEqual(sent.pop(),{action:'menu',source:own,fromSlot:30,option:MENU.Unload});
 assert.equal(inv.menu(0,'Info'),false);assert.equal(JSON.stringify(inv.slots),before);
 const full=[];for(let i=0;i<36;i++)full[i]={name:'Wood',uses:12};inv.apply({source:own,name:'GNUP',args:[fixture(cat,{slots:full})]});assert.equal(inv.menu(0,'Split'),false,'no vacancy: SplitStack predicts nothing to send');assert.equal(sent.length,0);
});

test('bridge sends the exact native cell RPCs: ITSM/ITMG with tryCombine, ISMV/ITMV for empty cells, ITSP, IACT',needsAssets,()=>{
 const schema=JSON.parse(readFileSync(new URL('../bridge/ulink/rpc-schema.json',import.meta.url))),registry=JSON.parse(readFileSync(new URL('../browser/assets/recovered/ngc/registry.json',import.meta.url)));
 const client=new EventEmitter(),sent=[];client.playerId=1;client.sendRpc=r=>sent.push(r);const bridge=new GameBridge({client,schema,ngcRegistry:registry,now:()=>0});
 bridge.views.set(20,{prefab:':player_soldier',owner:1});bridge.views.set(40,{prefab:'!Ng',group:7});const prefab=registry.prefabs.find(p=>p.handle===';drop_lootsack'),bag={carrier:40,innerID:5};bridge.ngc.set('40:5',{prefab,carrier:40,innerID:5});
 const cmd=c=>bridge.command({type:'inventory',source:own,...c}),last=()=>{const r=sent.pop();return {name:r.name,args:r.args};};
 assert.equal(cmd({action:'move',target:own,fromSlot:0,toSlot:1,op:'merge',tryCombine:false}),true);assert.deepEqual(last(),{name:'ITSM',args:[0,1,false]});
 assert.equal(cmd({action:'move',target:own,fromSlot:0,toSlot:1,op:'merge',tryCombine:true}),true);assert.deepEqual(last(),{name:'ITSM',args:[0,1,true]});
 assert.equal(cmd({action:'move',target:own,fromSlot:3,toSlot:9,op:'move'}),true);assert.deepEqual(last(),{name:'ISMV',args:[3,9]});
 assert.equal(cmd({action:'move',target:bag,fromSlot:3,toSlot:2,op:'move'}),true);assert.deepEqual(last(),{name:'ITMV',args:[{p1:7,p2:5},3,2]});
 assert.equal(cmd({action:'move',target:bag,fromSlot:3,toSlot:2,op:'merge',tryCombine:true}),true);assert.deepEqual(last(),{name:'ITMG',args:[{p1:7,p2:5},3,2,true]});
 assert.equal(bridge.command({type:'inventory',action:'move',source:bag,target:own,fromSlot:0,toSlot:4,op:'move'}),true);const c=sent.pop(),call=readNgcCall(c.args[0]),m=prefab.messages[call.messageID];
 assert.equal(m.name,'ITMV');assert.deepEqual(readArgs(m.params,new BitReader(call.args)),[{p1:0,viewId:20},0,4]);
 assert.equal(cmd({action:'move',target:own,fromSlot:0,toSlot:1}),false,'operation is required');assert.equal(cmd({action:'move',target:own,fromSlot:0,toSlot:1,op:'merge'}),false,'merge needs a boolean tryCombine');
 assert.equal(cmd({action:'split',fromSlot:7}),true);assert.deepEqual(last(),{name:'ITSP',args:[7]});
 assert.equal(cmd({action:'menu',fromSlot:30,option:MENU.Unload}),true);assert.deepEqual(last(),{name:'IACT',args:[30,9]});
 assert.equal(cmd({action:'menu',fromSlot:1,option:MENU.Study}),true);assert.deepEqual(last(),{name:'IACT',args:[1,4]});
 assert.equal(cmd({action:'menu',fromSlot:1,option:MENU.Info}),false,'Info is client-only');
});
