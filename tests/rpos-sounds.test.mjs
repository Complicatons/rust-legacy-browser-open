import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRposSounds,craftStartEdge} from '../browser/rpos-sounds.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const near=(a,b,e=1e-6)=>Math.abs(a-b)<e;
const layout=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/rpos/layout.json',import.meta.url)))):null;
// Minimal stand-in for a clicked DOM element: id, classes and data attributes, with closest/matches for simple selectors.
function element({id=null,cls=[],data={}}={}){const el={id,classList:{contains:c=>cls.includes(c)},dataset:data,
 matches(sel){return sel.split(',').some(s=>s.endsWith('[data-blueprint]')?'blueprint' in data:s.startsWith('#')?s.slice(1)===id:s.startsWith('.')&&cls.includes(s.slice(1)));},
 closest(sel){return el.matches(sel)?el:null;}};return el;}

test('RPOS UIButtonSound export: Tap on the cells, craft buttons, repair and close; craft_start for crafting',needsAssets,()=>{
 const s=layout.sounds;assert.ok(s,'rpos/layout.json has sounds (tools/export_rpos.py)');
 const names=new Set(Object.values(s.clips).map(c=>c.name));assert.deepEqual([...names].sort(),['Tap','craft_start']);
 const tap=Object.values(s.clips).find(c=>c.name==='Tap').file;
 const on=s.buttons.filter(b=>b.active&&b.enabled).map(b=>b.path.split('/').slice(-2).join('/'));
 for(const p of ['ArmorPanel/Cell1','RPOSCraftWindow/CraftButton','RPOSCraftWindow/MinusButton','RPOSCraftWindow/PlusButton','RPOSRepairBenchWindow/RepairButton','CloseButtonPanel/CloseButton','RPOSFireContentsWindow/FuelCell'])assert.ok(on.includes(p),p);
 // Inactive in the original: Take All buttons, the crafting/armor window close buttons, the bumper template.
 for(const p of ['RPOSLootWindow/TakeAllButton','RPOSCraftWindow/CloseButton','RPOSBumper/RPOSBumperButtonPrefab'])assert.ok(!on.includes(p),p);
 assert.ok(s.buttons.every(b=>b.trigger==='OnClick'&&b.volume===1&&b.pitch===1));
 for(const [k,c] of Object.entries(s.cellPrefabs))assert.deepEqual(c.buttonSounds.map(b=>[b.trigger,b.clip]),k.endsWith('#CategoryHeaderPrefab')?[]:[['OnClick',tap]],k);
 assert.equal(s.clips[Object.keys(s.clips).find(k=>s.clips[k].file===s.craft.clip)].name,'craft_start');
});

test('port elements map to the original sounds',needsAssets,()=>{
 const sounds=createRposSounds(layout.sounds),tap=Object.values(layout.sounds.clips).find(c=>c.name==='Tap').file;
 for(const el of [element({cls:['item-slot'],data:{slot:'3'}}),element({cls:['item-slot'],data:{slot:'31'}}),element({cls:['item-slot'],data:{slot:'37'}}),element({cls:['item-slot'],data:{loot:'2'}}),
  element({id:'craft'}),element({id:'cancel-craft'}),element({id:'craft-minus'}),element({id:'craft-plus'}),element({id:'inventory-close'}),element({id:'loot-action'})])
  assert.deepEqual(sounds.click(el,null),{file:tap,volume:1,pitch:1},JSON.stringify(el.dataset)+el.id);
 assert.deepEqual(sounds.click(element({cls:['item-slot'],data:{loot:'0'}}),'fire'),{file:tap,volume:1,pitch:1});
 assert.deepEqual(sounds.click(element({data:{blueprint:'k'}}),null),{file:tap,volume:1,pitch:1},'blueprint list row (ItemPlaque)');
 assert.equal(sounds.click(element({id:'recipe-details'}),null),null,'no sound on elements without a UIButtonSound');
 assert.equal(sounds.craft.file,layout.sounds.craft.clip);
 // NGUITools.PlaySound skips volume * soundVolume <= 0.01.
 assert.equal(createRposSounds(layout.sounds,{soundVolume:0.005}).click(element({id:'craft'})),null);
});

test('craftSound plays once on the not-crafting to crafting edge',()=>{
 const edge=craftStartEdge();assert.deepEqual([null,{job:1},{job:1},null,{job:2}].map(w=>edge(w)),[false,true,false,false,true]);
});

test('UIButtonScale/UIButtonOffset: armor, fire and repair cells tween; bag, belt and loot cells do not',needsAssets,async()=>{
 const {createRposTweens,NGUI_EASE_IN_OUT}=await import('../browser/rpos-sounds.mjs');const tw=createRposTweens(layout.sounds);
 const armor=tw.of(element({cls:['item-slot'],data:{slot:'37'}}));assert.ok(armor?.scale&&armor.offset);
 assert.deepEqual(tw.style(armor,'hover'),{scale:String(armor.scale.hover[0]),translate:`${armor.offset.hover[0]}px ${-armor.offset.hover[1]}px`,transition:`scale ${armor.scale.duration}s ${NGUI_EASE_IN_OUT},translate ${armor.offset.duration}s ${NGUI_EASE_IN_OUT}`});
 assert.ok(Math.abs(armor.scale.hover[0]-0.975)<1e-6&&Math.abs(armor.scale.pressed[0]-0.95)<1e-6&&Math.abs(armor.scale.duration-0.025)<1e-6);
 assert.equal(tw.style(armor,'normal').scale,'1');
 assert.ok(tw.of(element({cls:['item-slot'],data:{loot:'1'}}),'fire'));assert.ok(tw.of(element({cls:['item-slot'],data:{loot:'0'}}),'repair'));
 for(const el of [element({cls:['item-slot'],data:{slot:'3'}}),element({cls:['item-slot'],data:{slot:'31'}})])assert.equal(tw.of(el),null);
 assert.equal(tw.of(element({cls:['item-slot'],data:{loot:'0'}}),null),null,'crate loot cells: prefab tweens disabled');
 const prefab=Object.values(layout.sounds.cellPrefabs).flatMap(c=>c.buttonTweens??[]);assert.ok(prefab.length>=6&&prefab.every(t=>!t.enabled));
});

test('M3b: the bumper bar clones the active prefab asset, not the inactive scene template',needsAssets,()=>{
 const b=layout.bumper;assert.ok(b.active,'RPOSBumper active');assert.equal(b.prefab.source.split(':')[0],'cab-gameobject.000','buttonPrefab is a project asset');assert.equal(b.prefab.active,true);
 const template=layout.sounds.buttons.find(x=>x.path.endsWith('RPOSBumper/RPOSBumperButtonPrefab'));assert.equal(template.active,false,'the scene copy is inactive (never cloned)');
 assert.deepEqual(b.windows.map(w=>w.title),['Inventory','Armor','Crafting']);assert.deepEqual([b.buttonWidth,b.spacing],[75,5]);
 const tap=Object.values(layout.sounds.clips).find(c=>c.name==='Tap').file;
 assert.deepEqual(createRposSounds(layout.sounds,{bumper:b}).click(element({cls:['rpos-bumper-button']})),{file:tap,volume:1,pitch:1});
});

test('window close buttons: only fire, loot and repair are active; they tap and scale ×1.1 / ×1.05',needsAssets,async()=>{
 const {createRposTweens}=await import('../browser/rpos-sounds.mjs');const tw=createRposTweens(layout.sounds),sounds=createRposSounds(layout.sounds),tap=Object.values(layout.sounds.clips).find(c=>c.name==='Tap').file;
 for(const key of ['RPOSFireContentsWindow','RPOSLootWindow','RPOSRepairBenchWindow']){assert.equal(layout.windows[key].nodes.find(n=>n.name==='CloseButton').active,true,key);
  const el=element({cls:['rpos-window-close'],data:{window:key}}),t=tw.of(el);assert.ok(near(t.scale.hover[0],1.1)&&near(t.scale.pressed[0],1.05)&&near(t.scale.duration,0.05),key);assert.equal(t.offset,null);
  assert.deepEqual(sounds.click(el),{file:tap,volume:1,pitch:1},key);}
 for(const key of ['RPOSCraftWindow','ArmorPanel'])assert.equal(layout.windows[key].nodes.find(n=>n.name==='CloseButton').active,false,key);
 const bump=createRposTweens(layout.sounds,{bumper:layout.bumper}).of(element({cls:['rpos-bumper-button']}));assert.ok(near(bump.scale.hover[0],1.05)&&near(bump.scale.pressed[0],1.05)&&near(bump.scale.duration,0.025));
});

test('NGUI UIButton colours: exported per button and turned into hover/pressed CSS',needsAssets,async()=>{
 const {rposButtonColors,rposButtonCss,createRposTweens,BUTTON_COLORS}=await import('../browser/rpos-sounds.mjs');
 const colors=rposButtonColors(layout.sounds,{bumper:layout.bumper}),by=s=>colors.find(c=>c.selector===s);assert.equal(colors.length,BUTTON_COLORS.length,'every port button found its original');
 // RPOS_Craft_BlueprintList.ItemPlaquePrefab: Background ("white") 0.114 grey, hover 0.493, pressed 0.5, 10 ms.
 const row=by('#inventory #blueprint-list button[data-blueprint]');assert.deepEqual([row.normal,row.hover,row.pressed,row.sprite],['rgb(29 29 29)','rgb(126 126 126)','rgb(128 128 128)','white']);assert.ok(near(row.duration,0.01));
 // Craft/−/+/Repair and the bumper keep NGUI's default hover (0.6, 1, 0.2) and pressed grey over 0.2 s.
 for(const s of ['#inventory #craft,#inventory #cancel-craft','#inventory #craft-minus','#inventory #loot-action','#inventory .rpos-bumper-button']){const c=by(s);assert.equal(c.hover,'rgb(153 255 51)',s);assert.equal(c.pressed,'rgb(128 128 128)',s);assert.ok(near(c.duration,0.2),s);assert.equal(c.sprite,'stretchcell',s);}
 assert.deepEqual([by('#inventory #craft,#inventory #cancel-craft').normal,by('#inventory-close').hover,by('#inventory-close').pressed],['rgb(55 55 55)','rgb(255 0 0)','rgb(150 0 0)']);
 assert.deepEqual([by('#inventory .rpos-window-close[data-window="RPOSLootWindow"]').normal,by('#inventory .rpos-window-close[data-window="RPOSLootWindow"]').hover],['rgb(93 93 93)','rgb(113 0 0)']);
 // Cells: "cell" sprite × 0.114 grey (the port's existing #1d1d1d), hover 0.366, pressed 0.530, 50 ms.
 for(const s of ['#pack .item-slot','#belt .item-slot','#equipment .item-slot']){const c=by(s);assert.deepEqual([c.normal,c.hover,c.pressed,c.sprite],['rgb(29 29 29)','rgb(93 93 93)','rgb(135 135 135)','cell'],s);}
 const css=rposButtonCss(colors);assert.match(css,/#inventory #craft:hover,#inventory #cancel-craft:hover\{background-color:rgb\(153 255 51\)\}/);assert.match(css,/#inventory #craft-minus\{[^}]*border:1px solid #000/);assert.doesNotMatch(css.split('\n')[0],/border/,'"white" rows have no border');
 // Tweened buttons keep the colour fade in their inline transition list.
 const t=createRposTweens(layout.sounds,{colors:[{selector:'.x',duration:0.05}]}).of({...element({cls:['item-slot'],data:{slot:'37'}}),matches:s=>s==='.x'});assert.match(createRposTweens(layout.sounds).style(t,'hover').transition,/background-color 0.05s linear$/);
});
