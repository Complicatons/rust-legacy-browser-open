import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';
// GAP-AUDIT M3/M3b/M4 in the real inventory UI (the inventory-qa harness, ticked every animation frame like main.mjs):
// UIDraggablePanel wheel scrolling + UIScrollBar on the blueprint list and a crate, window close buttons, UIButton
// colours and the bumper bar.
const server=createServer();await listenServer(server);let browser;
try{
 browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const html=(await readFile('browser/index.html','utf8')).replace('<script type="module" src="/main.mjs"></script>','');// The game page's CSP (style-src 'self'), so a <style> element would fail here as it does in game.
 const csp=(await page.request.get(`http://127.0.0.1:${server.address().port}/`)).headers()['content-security-policy'];assert.match(csp,/style-src 'self'/);
 await page.route('**/inventory-qa',route=>route.fulfill({contentType:'text/html',body:html,headers:{'content-security-policy':csp.replace(/script-src [^;]*/,"script-src 'self' 'unsafe-inline'")}}));await page.goto(`http://127.0.0.1:${server.address().port}/inventory-qa`);
 await page.evaluate(async()=>{const {createInventoryUI}=await import('/inventory-ui.mjs'),ui=await createInventoryUI(),inv=ui.inventory,key=name=>Object.keys(inv.catalogue.items).find(k=>inv.item(k).m_Name===name);
  inv.slots.fill(null);inv.slots[0]={item:key('Wood'),uses:12,condition:1,maxCondition:1};for(const k of Object.keys(inv.catalogue.blueprints))inv.known.add(k);ui.refresh();for(const b of document.querySelectorAll('button'))b.disabled=false;
  const tick=t=>{ui.update(t);requestAnimationFrame(tick);};requestAnimationFrame(tick);window.inventoryQA={ui,inv,key};});
 await page.locator('#inventory-toggle').click();await page.waitForSelector('#inventory[open]');await page.waitForTimeout(300);
 const state=sel=>page.evaluate(s=>{const l=document.querySelector(s),bar=l.nextElementSibling,thumb=bar.firstElementChild;return {scroll:parseFloat(l.style.getPropertyValue('--rpos-scroll')),opacity:Number(bar.style.opacity),visibility:bar.style.visibility,thumbTop:parseFloat(thumb.style.top),thumbHeight:parseFloat(thumb.style.height),
  barHeight:bar.getBoundingClientRect().height,barLeft:bar.getBoundingClientRect().left-l.closest('.rpos-window').getBoundingClientRect().left,barTop:bar.getBoundingClientRect().top-l.closest('.rpos-window').getBoundingClientRect().top,overflow:getComputedStyle(l).overflowY};},sel);
 // Blueprint list: every recipe known, so it overflows its 250 px clip; the bar shows (OnlyIfNeeded) with a partial thumb.
 const list0=await state('#blueprint-list');assert.equal(list0.overflow,'hidden');assert.equal(list0.scroll,0);assert.equal(list0.opacity,1);assert.equal(list0.barHeight,250);assert.ok(list0.thumbHeight>0&&list0.thumbHeight<250,'thumb '+list0.thumbHeight);
 assert.deepEqual([list0.barLeft,list0.barTop],[238,48],'Scroll Bar node: x 132.57 − (−108) − 3, y 18 − (−30.42)');
 const row=page.locator('#blueprint-list [data-blueprint]').nth(2),box=await row.boundingBox();await page.mouse.move(box.x+40,box.y+7);
 // Hover colour (ItemPlaque UIButton: 0.493 grey in 10 ms) before scrolling.
 await page.waitForTimeout(100);assert.equal(await row.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(126, 126, 126)');
 await page.screenshot({path:'analysis/browser-qa/rpos-craft-list-top.png'});
 await page.mouse.wheel(0,100);await page.waitForTimeout(1500);const one=await state('#blueprint-list');const fps=await page.evaluate(()=>new Promise(r=>{let n=0;const t0=performance.now(),f=()=>{if(++n===60)r(60000/(performance.now()-t0));else requestAnimationFrame(f);};requestAnimationFrame(f);}));
 // NGUI adds momentum per frame, so a notch goes further at higher frame rates (99 px at 60 fps, 218 px at 144 fps on 720 px).
 assert.ok(one.scroll>40&&one.scroll<400,`one notch scrolled ${one.scroll} at ${fps.toFixed(0)} fps`);one.fps=fps;assert.ok(one.thumbTop>0,'thumb moved');
 for(let i=0;i<60;i++){await page.mouse.wheel(0,100);await page.waitForTimeout(30);}await page.waitForTimeout(1500);
 const end=await state('#blueprint-list'),content=await page.evaluate(()=>{const k=[...document.querySelector('#blueprint-list').children];return Math.max(...k.map(e=>e.offsetTop+e.offsetHeight))-Math.min(...k.map(e=>e.offsetTop));});
 assert.ok(Math.abs(end.scroll-(content-250))<0.01,`stops at the end: ${end.scroll} vs ${content-250}`);assert.ok(Math.abs(end.thumbTop+end.thumbHeight-250)<1.01,'thumb at the bottom');
 await page.screenshot({path:'analysis/browser-qa/rpos-craft-list-scrolled.png'});
 // Wheel over the bar itself (no ScrolledPanel above it) does nothing; dragging the thumb to the top scrolls back.
 const bar=await page.locator('#blueprint-list + .rpos-scroll-bar').boundingBox(),thumb=await page.locator('#blueprint-list + .rpos-scroll-bar .rpos-scroll-thumb').boundingBox();
 await page.mouse.move(bar.x+3,bar.y+20);await page.mouse.wheel(0,-100);await page.waitForTimeout(400);assert.equal((await state('#blueprint-list')).scroll,end.scroll,'wheel over the bar is not forwarded');
 await page.mouse.move(thumb.x+3,thumb.y+thumb.height/2);await page.mouse.down();await page.mouse.move(thumb.x+3,thumb.y+thumb.height/2-400,{steps:8});await page.mouse.up();assert.equal((await state('#blueprint-list')).scroll,0,'thumb dragged to the top');
 // UIButton colours: Craft keeps NGUI's default lime hover (Wood Planks selected, so the port's Craft button is enabled).
 await page.evaluate(()=>{const q=window.inventoryQA;q.inv.slots[0]={item:q.key('Wood'),uses:100,condition:1,maxCondition:1};q.ui.refresh();});
 await page.locator('#blueprint-list [data-blueprint]').filter({hasText:'Wood Planks'}).first().click();await page.locator('#craft').hover();await page.waitForTimeout(400);
 assert.equal(await page.locator('#craft').isDisabled(),false);assert.equal(await page.locator('#craft').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(153, 255, 51)');
 await page.screenshot({path:'analysis/browser-qa/rpos-craft-hover.png'});
 // Pressing the background centres the thumb on the pointer.
 await page.mouse.click(bar.x+3,bar.y+bar.height-2);const pressed=await state('#blueprint-list');assert.ok(Math.abs(pressed.scroll-(content-250))<0.01,'background press at the bottom');
 // The RPOS close button turns red.
 await page.locator('#inventory-close').hover();await page.waitForTimeout(200);assert.equal(await page.locator('#inventory-close').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 0, 0)');
 // Close buttons: the crafting and armor windows have none; the bag never had one.
 assert.equal(await page.locator('#inventory .rpos-window-close:visible').count(),0,'no close button on bag/armor/crafting');
 // Bumper bar: the three prefab clones, 75 px wide, 5 px apart, hanging 3.70 px above the screen top.
 const bump=await page.locator('.rpos-bumper-button').evaluateAll(b=>b.map(x=>{const r=x.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}));
 assert.equal(bump.length,3);assert.ok(bump.every(b=>b.width===75&&b.height===20&&Math.abs(b.top+3.70)<0.01));assert.deepEqual([bump[1].left-bump[0].left,bump[2].left-bump[1].left],[80,80]);assert.equal(bump[0].left,640-112.5);
 await page.locator('.rpos-bumper-button').nth(1).hover();await page.waitForTimeout(400);assert.equal(await page.locator('.rpos-bumper-button').nth(1).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(153, 255, 51)');
 // A crate with 30 slots (10 rows of 64 + 8 px) overflows the loot window's 286 px clip.
 await page.evaluate(()=>{const q=window.inventoryQA;q.ui.openLoot({title:'Wooden Box',slots:Array.from({length:30},(_,i)=>i%4?null:{item:q.key('Wood'),uses:i+1,condition:1,maxCondition:1})});});await page.waitForTimeout(300);
 const crate0=await state('#loot');assert.equal(crate0.opacity,1);assert.equal(crate0.barHeight,286);assert.deepEqual([crate0.barLeft,crate0.barTop],[227,48]);
 assert.equal(await page.locator('#inventory .rpos-window-close:visible').count(),1,'loot window close button');assert.equal(await page.locator('#inventory .rpos-window-close:visible').getAttribute('data-window'),'RPOSLootWindow');
 const gap=await page.evaluate(()=>{const c=document.querySelectorAll('#loot .item-slot');return c[1].getBoundingClientRect().left-c[0].getBoundingClientRect().right;});assert.equal(gap,8,'RPOSInvCellManager CellSpacing 8');
 const cell=await page.locator('#loot [data-loot="4"]').boundingBox();await page.mouse.move(cell.x+30,cell.y+30);for(let i=0;i<3;i++){await page.mouse.wheel(0,100);await page.waitForTimeout(40);}await page.waitForTimeout(1500);
 const crate1=await state('#loot');assert.ok(crate1.scroll>100,'crate scrolled '+crate1.scroll);
 const close=page.locator('#inventory .rpos-window-close:visible');await close.hover();await page.waitForTimeout(200);assert.ok(Math.abs(Number(await close.evaluate(e=>getComputedStyle(e).scale))-1.1)<1e-3,'close button hover ×1.1');
 assert.equal(await close.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(113, 0, 0)');
 await page.screenshot({path:'analysis/browser-qa/rpos-crate-scrolled.png'});
 // Fire layout: no UIDraggablePanel there, so no bar and no offset on the shaped cells.
 await page.evaluate(()=>{const q=window.inventoryQA;q.ui.closeLoot();q.ui.openLoot({title:'Camp Fire',layout:'fire',slots:Array(8).fill(null),labels:[]});});await page.waitForTimeout(200);
 assert.equal(await page.locator('#loot + .rpos-scroll-bar').isVisible(),false);assert.equal(await page.locator('#loot [data-loot="0"]').evaluate(e=>getComputedStyle(e).translate),'none');
 // Loot close button (RPOSLootWindow hidesWithCloseButton 0 → WindowClose → OnWindowHide → LootClosed): the exit callback
 // (StopLooting) runs once and the window goes, RPOS stays open, and crafting stays hidden (OpenLootWindow ExternalClosed it)
 // until its bumper. Closing RPOS runs LootClosed too, and crafting is still hidden on the next open.
 const lootState=()=>page.evaluate(()=>{const q=window.inventoryQA;return {closed:q.closed,open:document.querySelector('#inventory').open,loot:q.ui.lootOpen(),crafting:!document.querySelector('.inventory-columns').lastElementChild.hidden&&!document.querySelector('#craft-panel').hidden};});
 await page.evaluate(()=>{const q=window.inventoryQA;q.ui.closeLoot();q.closed=0;q.ui.openLoot({title:'Wooden Box',slots:Array(12).fill(null)},()=>q.closed++);});await page.waitForTimeout(200);
 await page.locator('#inventory .rpos-window-close:visible').click();await page.waitForTimeout(100);const closedByButton=await lootState();
 assert.deepEqual(closedByButton,{closed:1,open:true,loot:false,crafting:false},'close button: loot closed, RPOS open, crafting hidden');
 await page.screenshot({path:'analysis/browser-qa/rpos-loot-closed.png'});
 await page.locator('.rpos-bumper-button').nth(2).click();assert.equal((await lootState()).crafting,true,'Crafting bumper shows it again');
 await page.evaluate(()=>{const q=window.inventoryQA;q.ui.openLoot({title:'Wooden Box',slots:Array(12).fill(null)},()=>q.closed++);});await page.waitForTimeout(200);
 await page.locator('#inventory-close').click();await page.waitForTimeout(100);assert.deepEqual(await lootState(),{closed:2,open:false,loot:false,crafting:false},'RPOS closed: LootClosed ran');
 await page.evaluate(()=>{document.querySelector('#inventory').showModal();window.inventoryQA.ui.refresh();});await page.waitForTimeout(100);assert.equal((await lootState()).crafting,false,'crafting still hidden on reopen');
 assert.deepEqual(errors,[]);const result={list:{top:list0,one,end},crate:{start:crate0,scrolled:crate1},bumper:bump};console.log(JSON.stringify(result,null,1));await mkdir('analysis/browser-qa',{recursive:true});await writeFile('analysis/browser-qa/rpos-scroll.json',JSON.stringify(result,null,1));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
