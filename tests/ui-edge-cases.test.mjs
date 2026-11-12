// UI edge cases, 2026-10-23 (GAP-AUDIT.md): held keys through UI, item menu identity, online belt gate, HUD belt clicks,
// drag vs inventory updates, stale context selections, popup caps.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GameInput} from '../browser/key-bindings.mjs';
import {createItemMenu} from '../browser/item-menu.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {ServerInventory} from '../browser/server-inventory.mjs';
import {beltUseAllowed} from '../browser/belt-use.mjs';
import {beltCellClickAllowed,itemMenuStale} from '../browser/inventory-ui.mjs';
import {dropSourceValid} from '../browser/inventory-interactions.mjs';
import {ContextClient,offlineContextServer,contextualExists} from '../browser/context-ui.mjs';
import {capLive,noticeSeconds,MAX_LIVE_POPUPS,MAX_NOTICE_SECONDS} from '../browser/popup-ui.mjs';
import {reasonRuns,multiplyColor} from '../browser/death-screen.mjs';
import {ifAssets,needsAssets} from './helpers/assets.mjs';

const items=ifAssets(()=>JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))));
const keyOf=name=>Object.keys(items.items).find(k=>items.items[k].data.m_Name===name);
const key=(code,extra={})=>Object.assign(new Event('keydown'),{code,repeat:false,...extra});
const up=code=>Object.assign(new Event('keyup'),{code});

test('held keys stay held through a UI and a cursor relock; only blur clears them (GameButton.IsDown = Input.GetKey)',()=>{
 const target=new EventTarget(),input=new GameInput().attach(target),presses=[];input.addEventListener('press',e=>presses.push(e.detail.button));
 target.dispatchEvent(key('KeyW'));target.dispatchEvent(key('ShiftLeft'));assert.equal(input.isDown('Up'),true);assert.equal(input.isDown('Sprint'),true);
 // RPOS/chat/console open and close, the cursor relocks: nothing in the input layer releases the keys.
 target.dispatchEvent(key('KeyW',{repeat:true}));assert.equal(input.isDown('Up'),true);assert.deepEqual(presses,['Up','Sprint'],'auto-repeat is not a new press');
 // A key that went down while typing (not tracked) is held again by its auto-repeat, without a GetKeyDown press.
 target.dispatchEvent(key('KeyD',{repeat:true}));assert.equal(input.isDown('Right'),true);assert.equal(input.isPressed('Right'),false);assert.deepEqual(presses,['Up','Sprint']);
 target.dispatchEvent(up('KeyW'));assert.equal(input.isDown('Up'),false);
 target.dispatchEvent(new Event('blur'));assert.equal(input.isDown('Sprint'),false);assert.equal(input.isDown('Right'),false);
});

test('right-click menu acts on its own item: no duplicate eat after a belt use, nothing for a new loadout, follows a move',needsAssets,()=>{
 const inv=new LegacyInventory(items);inv.slots.fill(null);let calories=0,body={health:100,maxHealth:100};
 const metabolism={canConsumeYet:()=>true,markConsumptionTime(){},remainingCaloricSpace:()=>1000,addCalories(n){calories+=n;},addWater(){},addAntiRad(){},addPoison(){}};
 const menu=createItemMenu({inventory:()=>inv,online:()=>false,metabolism:()=>metabolism,body:()=>body,now:()=>100,notice:()=>{},onDamage:()=>{}});
 inv.slots[30]=inv.newSlot(keyOf('Granola Bar'),1);
 const open=menu(30).find(a=>a.label==='Eat');assert.ok(open,'Eat listed');
 // The belt key eats the bar while the menu is still open.
 assert.equal(menu(30).find(a=>a.label==='Eat').run(),true);const once=calories;assert.ok(once>0);assert.equal(inv.slots[30],null);
 assert.equal(open.run(),false,'the stale Eat entry finds no item');assert.equal(calories,once,'no second meal');
 // Death and respawn: a new bar in the same slot is not the observed item.
 inv.slots[30]=inv.newSlot(keyOf('Granola Bar'),1);body={health:100,maxHealth:100};const before=calories;
 assert.equal(open.run(),false);assert.equal(calories,before);assert.ok(inv.slots[30],'the new loadout item is untouched');
 // The observed item moved: the option runs on its current slot.
 const fresh=menu(30).find(a=>a.label==='Eat');inv.slots[5]=inv.slots[30];inv.slots[30]=null;
 assert.equal(fresh.run(),true);assert.equal(inv.slots[5],null);assert.ok(calories>before);
});

test('online right-click option sends IACT for the item\'s current slot, nothing when it is gone',needsAssets,()=>{
 const sent=[];const inv={catalogue:items,slots:Array(40).fill(null),menuOptions:()=>['Eat'],menu:(i,l)=>{sent.push([i,l]);return true;}};
 inv.slots[30]={item:keyOf('Granola Bar'),uses:1};const menu=createItemMenu({inventory:()=>inv,online:()=>true});const eat=menu(30)[0];
 inv.slots[31]=inv.slots[30];inv.slots[30]={item:keyOf('Granola Bar'),uses:1};assert.equal(eat.run(),true);assert.deepEqual(sent,[[31,'Eat']]);
 inv.slots[31]=null;assert.equal(eat.run(),false);assert.equal(sent.length,1);
});

function fakeSession(){const session=new EventTarget(),client=new EventTarget(),requests=[];Object.assign(client,{characterView:7,views:new Map(),inventory:(action,source,data)=>requests.push({action,data})});
 Object.assign(session,{client,inventoryCalls:new Map()});return {session,requests};}

test('online belt keys use the client BeltUse gate before DoBeltUse',needsAssets,()=>{
 const {session,requests}=fakeSession(),inv=new ServerInventory(session,items);const hatchet=keyOf('Stone Hatchet'),bar=keyOf('Granola Bar');
 assert.equal(inv.selectBelt(30),false,'empty slot: nothing sent');
 inv.slots[31]={item:bar,uses:2,condition:1,maxCondition:1};assert.ok(inv.selectBelt(31));
 inv.slots[32]={item:hatchet,uses:1,condition:0,maxCondition:1};assert.equal(inv.selectBelt(32),false,'a broken held item cannot be activated');
 inv.slots[33]={item:hatchet,uses:1,condition:1,maxCondition:1};assert.ok(inv.selectBelt(33));
 inv.selected=33;inv.canDeactivate=()=>false;assert.equal(inv.selectBelt(33),false,'the active item cannot be put away yet');
 inv.canDeactivate=()=>true;assert.ok(inv.selectBelt(33));
 assert.deepEqual(requests.map(r=>[r.action,r.data.fromSlot]),[['belt',31],['belt',33],['belt',33]]);
 assert.equal(beltUseAllowed(inv,31),true);
});

test('HUD belt cell clicks obey the belt key gate and RPOS',()=>{
 assert.equal(beltCellClickAllowed(false,{belt:()=>true}),true);
 assert.equal(beltCellClickAllowed(false,{belt:()=>false}),false,'dead / chat / console / context popup');
 assert.equal(beltCellClickAllowed(true,{belt:()=>true}),false,'RPOS open: cells only drag');
});

test('item menu goes stale when RPOS closes or its cell holds another object',()=>{
 const slot={item:'a'},slots=[slot];
 assert.equal(itemMenuStale({shown:true,dialogOpen:true,slots,index:0,slot}),false);
 assert.equal(itemMenuStale({shown:true,dialogOpen:false,slots,index:0,slot}),true);
 assert.equal(itemMenuStale({shown:true,dialogOpen:true,slots:[{...slot}],index:0,slot}),true);
 assert.equal(itemMenuStale({shown:false,dialogOpen:false,slots,index:0,slot}),false);
});

test('a drop reads the source slot at drop time: a server update with new objects keeps the drag, an emptied slot drops nothing',()=>{
 const carried={item:'wood',uses:5};
 assert.equal(dropSourceValid({item:'wood',uses:4},carried),true,'GNUP rebuilt the slot object');
 assert.equal(dropSourceValid(null,carried),false);assert.equal(dropSourceValid({item:'stone',uses:5},carried),false);
});

test('offline context selection on a destroyed contextual answers stale (L) and runs nothing',async()=>{
 const tick=()=>new Promise(r=>setTimeout(r,0));
 for(const kind of ['menu','quick','cancel']){const replies=[],ran=[];let client;
  const door={kind:'deployable',deployed:{destroyed:false},menu:()=>['Enter Code'],menuAction:a=>{ran.push(a);return true;},use:()=>{ran.push('use');return true;}};
  const send=offlineContextServer({reply:(n,v)=>{replies.push(n);client.reply(n,v,0);}});client=new ContextClient({send});
  client.press(door,0);await tick();assert.deepEqual(replies,['E']);door.deployed.destroyed=true;
  if(kind==='menu'){client.showMenu();assert.equal(client.select(0),true);}else client.release(kind==='quick'?100:1000);
  await tick();assert.deepEqual(replies,['E','L'],kind);assert.deepEqual(ran,[],kind+': nothing runs on a destroyed target');assert.equal(client.state,'off');}
 assert.equal(contextualExists({crate:{destroyed:true}}),false);assert.equal(contextualExists({exists:()=>false}),false);assert.equal(contextualExists({kind:'door'}),true);
});

test('popup notices: live popups capped (oldest first), server seconds clamped',()=>{
 const live=new Set(),gone=[];for(let i=0;i<MAX_LIVE_POPUPS+5;i++){capLive(live,MAX_LIVE_POPUPS,o=>gone.push(o));live.add(i);}
 assert.equal(live.size,MAX_LIVE_POPUPS);assert.deepEqual(gone,[0,1,2,3,4]);assert.equal([...live][0],5);
 assert.equal(noticeSeconds(1e9),MAX_NOTICE_SECONDS);assert.equal(noticeSeconds(-3),0);assert.equal(noticeSeconds('x'),0);assert.equal(noticeSeconds('2.5'),2.5);
});

test('death reason markup: [color] runs, the label colour multiplies them',()=>{
 const runs=reasonRuns('[color red]Bob[/color] killed you');assert.equal(runs.map(r=>r.text).join(''),'Bob killed you');
 assert.deepEqual(runs[0].color,{r:255,g:0,b:0,a:1});assert.deepEqual(runs.at(-1).color,{r:255,g:255,b:255,a:1});
 assert.deepEqual(multiplyColor(runs[0].color,{r:185,g:185,b:185,a:0.5}),{r:185,g:0,b:0,a:0.5});
 assert.equal(reasonRuns('You killed yourself. You silly sod.').map(r=>r.text).join(''),'You killed yourself. You silly sod.');
});
