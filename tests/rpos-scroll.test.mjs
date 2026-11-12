import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDraggablePanel,constrainOffset,scrollBarState,thumbRect,barValueAt,dragAmountOffset,springDampen,springLerp,wheelDelta} from '../browser/rpos-scroll.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const layout=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/rpos/layout.json',import.meta.url)))):null;
const panel=key=>Object.entries(layout.scrolling).find(([p])=>p.endsWith('/'+key+'/ScrolledPanel'))[1];
const near=(a,b,e=1e-6)=>Math.abs(a-b)<e;
// Runs LateUpdate at 60 fps for `seconds` (720 px screen: 360 px per world unit).
const run=(p,bounds,seconds=3,fps=60,unit=360)=>{for(let t=0;t<seconds;t+=1/fps)p.frame(1/fps,bounds,unit);};

test('UIDraggablePanel export: craft and loot lists scroll by wheel and bar only; the bag panel has it disabled',needsAssets,()=>{
 for(const key of ['RPOSCraftWindow','RPOSLootWindow']){const c=panel(key);
  assert.ok(c.enabled&&c.active,key);assert.ok(near(c.scrollWheelFactor,-0.08),key);assert.equal(c.momentumAmount,35);assert.equal(c.dragEffect,'None');
  assert.deepEqual([c.restrictWithinPanel,c.restrictWithinPanelWithScroll,c.disableDragIfFits,c.respondHoverScroll],[false,true,false,true]);
  assert.deepEqual(c.scale,{x:0,y:1,z:0});assert.equal(c.panel.clipping,'HardClip');assert.equal(c.showScrollBars,'OnlyIfNeeded');
  const sb=c.verticalScrollBar;assert.equal(sb.direction,'Vertical');assert.ok(sb.background.hotSpot&&sb.foreground.hotSpot,'bar background and foreground take presses');
  assert.equal(sb.background.scale.y,c.panel.clipRange.w,'bar as long as the clip');assert.deepEqual([sb.background.sprite,sb.foreground.sprite],['black','white']);}
 assert.deepEqual([panel('RPOSCraftWindow').panel.clipRange.w,panel('RPOSLootWindow').panel.clipRange.w],[250,286]);
 assert.equal(panel('InventoryPanel').enabled,false,'bag grid: UIDraggablePanel disabled');
 assert.deepEqual(layout.ui,{root:{automatic:true,manualHeight:720},camera:{mouseMode:'UseEvents',scrollWheelMode:'UseEvents',scrollAxisName:'Mouse ScrollWheel',mouseClickThreshold:10}});
});

test('NGUIMath springs step per millisecond',()=>{
 assert.ok(near(springLerp(1,0,20,0.001),0.98));assert.ok(near(springLerp(1,0,20,0.002),0.98*0.98));assert.equal(springLerp(1,0,20,0.0004),1,'rounds to whole ms');
 const d=springDampen(1,9,0.002);assert.ok(near(d.offset,0.06+0.06*0.991));assert.ok(near(d.velocity,0.991*0.991));assert.deepEqual(springDampen(0,9,1),{offset:0,velocity:0});
});

test('wheel down moves the contents up, eases out, and stops at the end of the list',needsAssets,()=>{
 const p=createDraggablePanel(panel('RPOSCraftWindow')),tall={top:0,bottom:800};p.frame(0,tall,360);
 p.wheel(wheelDelta({deltaMode:0,deltaY:100}));let prev=0,steps=[];for(let i=0;i<30;i++){p.frame(1/60,tall,360);steps.push(p.offset-prev);prev=p.offset;}
 assert.ok(p.offset>50&&p.offset<150,'one notch at 720p/60 fps: '+p.offset);assert.ok(steps[0]>0&&steps.at(-1)<steps[3],'momentum decays');
 run(p,tall);const one=p.offset;assert.ok(near(one,98.85,0.05),'settles at '+one);
 // Wheel up at the top: restrictWithinPanelWithScroll pushes tall content straight back (dragEffect None: no spring).
 const top=createDraggablePanel(panel('RPOSCraftWindow'));top.frame(0,tall,360);top.wheel(-3);run(top,tall);assert.ok(near(top.offset,0,1e-9),String(top.offset));
 // Many notches: clamped where the content bottom meets the clip bottom.
 for(let i=0;i<40;i++){p.wheel(3);run(p,tall,0.1);}run(p,tall);assert.equal(p.offset,800-250);
});

test('UIDraggablePanel.Scroll resets its accumulator when its sign differs from the delta (Mathf.Sign(0) = 1)',needsAssets,()=>{
 const tall={top:0,bottom:4000},once=createDraggablePanel(panel('RPOSLootWindow')),twice=createDraggablePanel(panel('RPOSLootWindow'));
 once.wheel(3);twice.wheel(3);twice.wheel(3);run(once,tall);run(twice,tall);assert.equal(twice.offset,once.offset,'factor < 0: a second notch down replaces the first');
 const up=createDraggablePanel(panel('RPOSLootWindow'));up.frame(0,tall,360);up.wheel(-3);up.wheel(-3);run(up,tall);assert.ok(near(up.offset,0,1e-9));
});

test('NGUI ConstrainRect: short contents may move down inside the clip until they touch its bottom',needsAssets,()=>{
 assert.equal(constrainOffset({top:0,bottom:500},300,250),-50);assert.equal(constrainOffset({top:0,bottom:500},-20,250),20);assert.equal(constrainOffset({top:0,bottom:500},100,250),0);
 assert.equal(constrainOffset({top:0,bottom:138},10,286),-10,'short: no moving up past the clip top');assert.equal(constrainOffset({top:0,bottom:138},-100,286),0);assert.equal(constrainOffset({top:0,bottom:138},-200,286),52);
 const p=createDraggablePanel(panel('RPOSLootWindow')),short={top:0,bottom:136};p.frame(0,short,360);for(let i=0;i<20;i++){p.wheel(-3);run(p,short,0.1);}run(p,short);
 assert.equal(p.offset,136-286,'wheel up slides a two-row crate to the clip bottom');
});

test('UIScrollBar: size and value from UpdateScrollbars, foreground from ForceUpdate, presses from CenterOnPos',needsAssets,()=>{
 const b={top:0,bottom:500};assert.deepEqual(scrollBarState(b,0,250),{barSize:0.5,scrollValue:0});assert.deepEqual(scrollBarState(b,250,250),{barSize:0.5,scrollValue:1});
 const mid=scrollBarState(b,125,250);assert.ok(near(mid.barSize,0.5)&&near(mid.scrollValue,0.5));assert.deepEqual(scrollBarState({top:0,bottom:100},0,250),{barSize:1,scrollValue:0});
 assert.equal(scrollBarState({top:0,bottom:0},0,250),null);
 assert.deepEqual(thumbRect({barSize:0.5,scrollValue:0},250),{top:0,height:125});assert.deepEqual(thumbRect({barSize:0.333,scrollValue:0.5},250),{top:Math.round(250*0.667/2),height:Math.round(250*0.333)});
 assert.equal(barValueAt(62.5,{barSize:0.5},250),0);assert.equal(barValueAt(187.5,{barSize:0.5},250),1);assert.equal(barValueAt(125,{barSize:0.5},250),0.5);assert.equal(barValueAt(10,{barSize:1},250),0);
 assert.equal(dragAmountOffset(b,0,250),0);assert.equal(dragAmountOffset(b,1,250),250);assert.equal(dragAmountOffset(b,2,250),250,'Mathf.Lerp clamps');
 const p=createDraggablePanel(panel('RPOSCraftWindow'));p.setValue(0.5,b);assert.equal(p.offset,125);assert.ok(near(p.bar(b).scrollValue,0.5));
});

test('OnlyIfNeeded: the bar starts shown when the list overflows, fades out at 3/s and in at 6/s',needsAssets,()=>{
 const p=createDraggablePanel(panel('RPOSCraftWindow'));p.frame(0,{top:0,bottom:500},360);assert.equal(p.alpha,1);
 p.frame(0.1,{top:0,bottom:100},360);assert.ok(near(p.alpha,0.7));p.frame(0.5,{top:0,bottom:100},360);assert.equal(p.alpha,0);
 p.frame(0.1,{top:0,bottom:500},360);assert.ok(near(p.alpha,0.6));const fresh=createDraggablePanel(panel('RPOSLootWindow'));fresh.frame(0,{top:0,bottom:136},360);assert.equal(fresh.alpha,0);
});

test('browser wheel deltas become Unity scroll events (3 per notch, positive down)',()=>{
 assert.equal(wheelDelta({deltaMode:0,deltaY:100}),3);assert.equal(wheelDelta({deltaMode:1,deltaY:-3}),-3);assert.equal(wheelDelta({deltaMode:2,deltaY:1}),3);
});
