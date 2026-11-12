import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {Vector3} from 'three';
import {deathReason,anchorLayout,deathScreenLayout,tweenColor,textMetrics,roundToInt,DEFAULT_REASON} from '../browser/death-screen.mjs';
import {optimizedListing,shuffle,deathDropSlots,DeathDrop,dropInventoryContents,transferable,DEATH_DROP_PREFAB,DEATH_DROP_LIFETIME,hostileDeathDrop,lookRotationForcedUpQ} from '../browser/death-drop.mjs';
import {populateLoot} from '../browser/loot.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';import {clientUICommand} from '../browser/lock-entry.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const json=p=>JSON.parse(readFileSync(new URL('../browser/assets/recovered/'+p,import.meta.url)));
const cat=hasRecovered?(json('items/manifest.json')):null,deploy=hasRecovered?(json('deployables/manifest.json')):null,frontend=hasRecovered?(json('frontend/manifest.json')):null,key=name=>Object.keys(cat.items).find(k=>cat.items[k].data.m_Name===name);

test('death reasons follow DeathTransfer.SetDeathReason and the client convar default',()=>{
 assert.equal(DEFAULT_REASON,'...');assert.equal(deathReason(null),'You killed yourself. You silly sod.');
 assert.equal(deathReason({animal:{def:{name:'Wolf'}}}),'TODO: Handle this death condition Wolf(Clone) (Character)');
 assert.equal(deathReason({player:'Bob',weapon:'M4',bodyPart:'head'}),'Bob killed you using a M4 with a hit to your head');
 assert.deepEqual(clientUICommand('deathscreen.reason "Bob killed you with a hit to your \\"chest\\""'),{type:'death-reason',message:'Bob killed you with a hit to your "chest"'});
});
test('dfControl absolute anchor layout reproduces the exported DeathScreen at 1280x720',needsAssets,()=>{
 assert.equal(roundToInt(17.5),18);assert.equal(roundToInt(-132.5),-132);assert.equal(roundToInt(2.5),2);
 const nodes=frontend.screens.DeathScreen.nodes,rects=[...deathScreenLayout(nodes,{width:1280,height:720}).values()],by=n=>rects.find(r=>r.name===n);
 assert.deepEqual([by('DeathWindow').width,by('DeathWindow').height],[1280,720]);
 assert.deepEqual(['x','y','width','height'].map(k=>Math.round(by('Background')[k])),[-48,-48,1376,816]);
 // Buttons and lblInfo are children of the Background sprite, which overhangs the screen by 48 px.
 assert.deepEqual(['x','y','absX','absY','width','height'].map(k=>Math.round(by('Buttons')[k])),[936,576,888,528,288,160]);
 assert.deepEqual(['x','y','width','height'].map(k=>Math.round(by('btnRespawn')[k])+0),[18,0,253,64]);assert.deepEqual(['x','y','width','height'].map(k=>Math.round(by('btnAtCamp')[k])),[6,64,276,32]);
 assert.deepEqual(['x','y','width','height'].map(k=>Math.round(by('You Are Dead')[k])),[-132,56,1544,488]);assert.deepEqual(['x','y','height'].map(k=>Math.round(by('lblDead')[k])),[-38,72,414]);
 assert.equal(by('btnRespawn').data.text,'RESPAWN');assert.equal(by('btnAtCamp').data.text,'AT A CAMP ');assert.equal(by('lblDead').data.text,'DEAD');
 // dfEventBindings route btnRespawn -> RequestRespawn and btnAtCamp -> RequestRespawn_InCamp.
 const bindings=nodes[0].components.dfEventBinding.map(b=>b.DataTarget.MemberName).sort();assert.deepEqual(bindings,['RequestRespawn','RequestRespawn_InCamp']);
 assert.deepEqual(anchorLayout({anchorStyle:10,margins:{left:0,top:0,right:152,bottom:80}},{x:288,y:160},{x:1920,y:1080}),{x:1480,y:840,width:288,height:160});
});
test('death screen tweens and ScreenResolution text scale follow the source curves',needsAssets,()=>{
 const bg=frontend.screens.DeathScreen.nodes.find(n=>n.name==='Background').components.dfTweenColor32,fadeIn=bg.find(t=>t.tweenName==='FadeIn');
 assert.deepEqual(tweenColor(fadeIn,0),{r:0,g:0,b:0,a:0});assert.deepEqual(tweenColor(fadeIn,1.5),{r:13,g:13,b:13,a:0.5});assert.deepEqual(tweenColor(fadeIn,3),{r:26,g:26,b:26,a:1});
 const buttons=frontend.screens.DeathScreen.nodes.find(n=>n.name==='Buttons').components.dfTweenColor32.find(t=>t.tweenName==='FadeIn');assert.equal(tweenColor(buttons,3).a,0);assert.equal(tweenColor(buttons,5).a,1);
 const bold=Object.values(frontend.fonts).find(f=>f.name==='RobotoCondensed-Bold');assert.equal(textMetrics(bold,4).size,64);assert.equal(textMetrics(bold,16.09,{mode:2,screenHeight:1080}).size,258);assert.equal(textMetrics(bold,16.09,{mode:2,screenHeight:720}).size,172);
});
test('optimized death listing merges stacks like Inventory.Report with ReuseItem uses and skips untransferable items',needsAssets,()=>{
 const wood=key('Wood'),vest=Object.keys(cat.items).find(k=>!transferable(cat.items[k].data)),max=cat.items[wood].data._maxUses,slots=Array(40).fill(null);
 slots[0]={item:wood,uses:100};slots[3]={item:wood,uses:max-50};slots[5]={item:wood,uses:max};slots[30]={item:vest,uses:1};slots[36]={item:key('Cloth Helmet'),uses:1,condition:.3,maxCondition:.8};
 const list=optimizedListing(slots,cat.items);
 // 100 + (max-50) overflows: a second report holds slots[3]; slots[5] then overflows again into a third report.
 assert.deepEqual(list.map(i=>i.uses),[max,max-50,100,1]);assert.ok(!list.some(i=>i.item===vest));
 const absorbed=[{item:wood,uses:10},{item:wood,uses:20}];assert.deepEqual(optimizedListing(absorbed,cat.items).map(i=>i.uses),[10],'a fully absorbed stack is not carried (native ReuseItem keeps the first item\'s uses)');
 assert.deepEqual(shuffle([1,2,3,4],()=>0),[2,3,4,1]);const drop=deathDropSlots(slots,cat.items,()=>0.99);assert.equal(drop.length,4);assert.notEqual(drop[0],slots[36]);
});
test('death pack uses the original LootSack prefab, 600 s first expiry, 1800 s after looting and clears the character inventory',needsAssets,()=>{
 const prefab=deploy.prefabs[DEATH_DROP_PREFAB];assert.equal(prefab.name,'LootSack');assert.equal(prefab.components.LootableObject[0].data.lifeTime,600);
 const inv=new LegacyInventory(cat,undefined,{rng:()=>0});const before=inv.slots.filter(Boolean).length;inv.startCraft(Object.keys(cat.blueprints)[0],0);
 const ground=(o,r)=>{assert.equal(r,1000);return {point:new Vector3(o.x,2,o.z),normal:new Vector3(0,1,0)};};
 const d=dropInventoryContents(inv,prefab,{feetU:new Vector3(5,3,7),forwardU:new Vector3(0,0,1),ground,now:100,rng:()=>0});
 assert.ok(d instanceof DeathDrop);assert.equal(d.slots.length,before);assert.ok(inv.slots.every(s=>s===null));assert.equal(inv.work,null);assert.deepEqual(d.position.toArray(),[5,2,7]);
 assert.equal(d.timers.get('destroy'),700);assert.equal(d.settings.lifeTime,DEATH_DROP_LIFETIME);assert.equal(d.contextText(),'Search');
 assert.ok(d.useEnter('local',150));assert.equal(d.contextText(),'Occupied');d.slots[0]=null;d.useExit(200);assert.equal(d.timers.get('destroy'),2000);assert.equal(d.destroyed,false);
 assert.ok(d.useEnter('local',210));assert.equal(d.update(225,new Vector3(20,2,7)),'eject');assert.equal(d.looter,null);
 let gone=0;d.onDestroy=()=>gone++;d.useEnter('local',300);d.slots.fill(null);d.useExit(301);assert.equal(gone,1,'emptied sacks with a lifetime are destroyed on exit');
 const empty=new LegacyInventory(cat);empty.slots.fill(null);assert.equal(dropInventoryContents(empty,prefab,{feetU:new Vector3(),forwardU:new Vector3(0,0,1),ground,now:0}),null);
});
test('new item instances start at InstallData condition 1 / maxcondition 1',needsAssets,()=>{
 const inv=new LegacyInventory(cat);for(const s of inv.slots.filter(Boolean))assert.deepEqual([s.condition,s.maxCondition],[1,1]);inv.slots.fill(null);inv.add(key('Wood'),5);assert.deepEqual([inv.slots[0].condition,inv.slots[0].maxCondition],[1,1]);
});

test('a mutant leaves the original AILootSack 1.5 m away, filled once from AILootList, gone after 300 s or once emptied',needsAssets,()=>{
 const prefab=deploy.prefabs[';drop_lootsack_zombie'];assert.equal(prefab.name,'AILootSack');
 const loot=prefab.components.LootableObject[0].data;assert.equal(loot._lootSpawnListName.name,'AILootList');assert.equal(loot.lifeTime,300);
 const lists=json('loot/manifest.json').lists,picks=[];
 const populate=(list,n)=>{picks.push([list,n]);return populateLoot(lists,list,n,cat.items,()=>0.5);};
 // TransformHelpers.GetGroundInfo(start): a ray from 0.25 m above the start, 100 m down.
 const ground=(o,r)=>{assert.equal(r,100);return {point:new Vector3(o.x,2,o.z),normal:new Vector3(0,1,0)};};
 // rng 0 -> angle 0 -> the sack lands 1.5 m along +x.
 const d=hostileDeathDrop(prefab,{positionU:new Vector3(10,3,20),forwardU:new Vector3(0,0,1),upU:new Vector3(0,1,0),ground,now:50,rng:()=>0,populate});
 assert.ok(d instanceof DeathDrop);assert.deepEqual(picks,[['AILootList',12]]);
 assert.deepEqual(d.position.toArray(),[11.5,2,20]);assert.equal(d.slots.length,12);assert.ok(d.slots.some(Boolean));
 assert.equal(d.settings.lifeTime,300);assert.equal(d.timers.get('destroy'),350,'the prefab lifetime, never raised like a player sack');
 assert.ok(d.useEnter('local',60));d.slots.fill(null);let gone=0;d.onDestroy=()=>gone++;d.useExit(61);assert.equal(gone,1);
 // HostileWildlifeAI.OnKilled destroys a sack that rolled nothing.
 assert.equal(hostileDeathDrop(prefab,{positionU:new Vector3(),forwardU:new Vector3(0,0,1),upU:new Vector3(0,1,0),ground,now:0,rng:()=>0,populate:(l,n)=>Array(n).fill(null)}),null);
});

test('LookRotationForcedUp(rotation, up) keeps the facing on flat ground and tilts with a slope',()=>{
 const flatQ=lookRotationForcedUpQ(new Vector3(0,0,1),new Vector3(0,1,0),new Vector3(0,1,0));
 assert.ok(new Vector3(0,0,1).applyQuaternion(flatQ).distanceTo(new Vector3(0,0,1))<1e-6);
 const n=new Vector3(0.3,1,0).normalize(),q=lookRotationForcedUpQ(new Vector3(0,0,1),new Vector3(0,1,0),n);
 assert.ok(new Vector3(0,1,0).applyQuaternion(q).distanceTo(n)<1e-6,'up follows the ground normal');
 assert.ok(Math.abs(new Vector3(0,0,1).applyQuaternion(q).dot(n))<1e-6,'forward lies on the slope');
});
