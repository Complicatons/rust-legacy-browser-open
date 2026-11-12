import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {readFile} from 'node:fs/promises';
// RPOS UIButtonSound "Tap" on cell/button clicks and RPOSCraftWindow.craftSound on craft start (tools/export_rpos.py).
const rposClips=JSON.parse(await readFile('browser/assets/recovered/rpos/layout.json','utf8')).sounds.clips,clipFile=name=>Object.values(rposClips).find(c=>c.name===name).file;
const server=createServer();await listenServer(server);let browser;
try{browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{let state=0x517cc1b7;Math.random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:60000});await page.locator('#respawn').evaluate(b=>b.click());
 const given=await page.evaluate(()=>({wood:window.explorerDev.giveItem('Wood',12),helmet:window.explorerDev.giveItem('Kevlar Helmet',1),gun:window.explorerDev.giveItem('M4',1)}));
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');assert.equal(await page.locator('#pack .item-slot').count(),30);assert.equal(await page.locator('#equipment .item-slot').count(),4);
 assert.equal(await page.locator(`#inventory [data-slot="${given.wood.slot}"] .rpos-count`).textContent(),'x12');
 // Items move only by dragging (RPOSInventoryCell.OnClick is empty).
 {const a=await page.locator(`#inventory [data-slot="${given.helmet.slot}"]`).boundingBox(),b=await page.locator('#equipment [data-slot="36"]').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();}
 assert.equal(await page.locator('#equipment [data-slot="36"] > img').getAttribute('alt'),'Kevlar Helmet');assert.ok(await page.locator('#armor-totals dt').count()>0);assert.ok((await page.locator('#armor-totals dd').allTextContents()).every(v=>/^\+\d+$/.test(v)));
 await mkdir('analysis/browser-qa',{recursive:true});await page.screenshot({path:'analysis/browser-qa/rpos-inventory.png'});const desktop=await page.evaluate(()=>({pack:getComputedStyle(document.querySelector('#pack')).gridTemplateColumns,armor:document.querySelector('#armor-totals').textContent,bitmap:document.querySelectorAll('#inventory canvas').length,mods:document.querySelectorAll('#inventory .rpos-mods img').length}));
 assert.ok(desktop.bitmap>5);assert.equal(desktop.pack.split(' ').length,6);
 const glyphInk=await page.locator('#inventory .rpos-count[data-color="yellow"] canvas').first().evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<d.length;i+=4)if(d[i]>100&&d[i+1]>100&&d[i+2]<10&&d[i+3]>0)ink++;return ink/(d.length/4);});assert.ok(glyphInk>0&&glyphInk<0.75,'tint preserves glyph shapes, including the atlas black background');
 const windows=await page.locator('#inventory .rpos-window').evaluateAll(nodes=>nodes.map(n=>({key:n.dataset.nativeWindow,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,left:n.getBoundingClientRect().left,top:n.getBoundingClientRect().top})));assert.equal(windows.find(w=>w.key==='InventoryPanel').width,480);assert.equal(windows.find(w=>w.key==='ArmorPanel').width,230);assert.ok(windows.every(w=>w.top>100&&w.top+w.height<720));
 // Item right-click menu in the real game (offline): Split, Study (learns + consumes, list updates), Blood Draw Kit Use, Unload.
 const items=await page.evaluate(()=>({bp:window.explorerDev.giveItem('M4 Blueprint',1),kit:window.explorerDev.giveItem('Blood Draw Kit',1),research:window.explorerDev.giveItem('Research Kit 1',1)}));
 const cell=i=>page.locator(`#inventory [data-slot="${i}"]`),menuFor=async i=>{await cell(i).click({button:'right'});await page.waitForSelector('#item-menu:not([hidden])');return page.locator('#item-menu button').allTextContents();};
 assert.deepEqual(await menuFor(given.wood.slot),['Split']);await page.locator('#item-menu [data-menu-option="Split"]').click();assert.equal(await page.locator(`#inventory [data-slot="${given.wood.slot}"] .rpos-count`).textContent(),'x6');assert.equal(await page.locator('#pack .item-slot:has(img[alt="Wood"])').count(),2);
 const bpKey=await page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].length);
 assert.deepEqual(await menuFor(items.bp.slot),['Study']);await page.locator('#item-menu [data-menu-option="Study"]').click();assert.equal(await cell(items.bp.slot).locator('img').count(),0,'blueprint consumed');
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].length),bpKey+1,'learned recipe listed');assert.ok((await page.locator('#blueprint-list').textContent()).includes('M4'));
 await page.waitForFunction(()=>window.explorerState.resources.notices.includes('You can now craft: M4'));
 assert.deepEqual(await menuFor(given.gun.slot),['Unload']);await page.locator('.rpos-bag h3').first().click();assert.equal(await page.locator('#item-menu').isHidden(),true);
 // Research Kit dropped on a researchable item away from a workbench: the original client popup, nothing consumed or learned.
 const drag=async(a,b)=>{const x=await cell(a).boundingBox(),y=await cell(b).boundingBox();await page.mouse.move(x.x+x.width/2,x.y+x.height/2);await page.mouse.down();await page.mouse.move(y.x+y.width/2,y.y+y.height/2,{steps:10});await page.mouse.up();};
 await drag(items.research.slot,given.gun.slot);await page.waitForFunction(()=>window.explorerState.resources.notices.includes('You must be at a workbench to do this.'));assert.equal(await cell(items.research.slot).locator('img').getAttribute('alt'),'Research Kit 1');
 const before=await page.evaluate(()=>window.explorerState.vitals.health);assert.deepEqual(await menuFor(items.kit.slot),['Use']);await page.locator('#item-menu [data-menu-option="Use"]').click();
 assert.equal(await page.evaluate(()=>window.explorerState.vitals.health),before-25,'Blood Draw Kit takes 25 health');assert.equal(await page.locator('#pack .item-slot:has(img[alt="Blood"])').count(),1);
 await mkdir('analysis/browser-qa/items',{recursive:true});await page.screenshot({path:'analysis/browser-qa/items/rpos-item-menu-game.png'});
 // UIButtonScale on the armor cells: hover ×0.975 in 25 ms; bag cells carry the tween disabled.
 await page.locator('#equipment [data-slot="37"]').hover();await page.waitForTimeout(150);
 const hoverScale=await page.locator('#equipment [data-slot="37"]').evaluate(e=>getComputedStyle(e).scale);assert.ok(Math.abs(Number(hoverScale)-0.975)<1e-3,'armor cell hover scale '+hoverScale);
 await page.locator('#pack [data-slot="5"]').hover();await page.waitForTimeout(150);assert.equal(await page.locator('#pack [data-slot="5"]').evaluate(e=>getComputedStyle(e).scale),'none','bag cells do not tween');
 assert.equal(await page.locator('#equipment [data-slot="37"]').evaluate(e=>getComputedStyle(e).scale),'1','armor cell back to normal after leaving');
 // Original sounds: a cell click plays Tap (UIButtonSound OnClick; RPOSInventoryCell.OnClick itself does nothing, so the
 // item stays); starting a craft plays craft_start once; the RPOS close button taps.
 {const before=await page.locator(`#inventory [data-slot="${given.wood.slot}"] > img`).getAttribute('alt');await page.locator(`#inventory [data-slot="${given.wood.slot}"]`).click();await page.locator('#pack [data-slot="29"]').click();
  assert.equal(await page.locator(`#inventory [data-slot="${given.wood.slot}"] > img`).getAttribute('alt'),before,'a click moves nothing');}
 const sounds0=await page.evaluate(()=>window.explorerDev.rposSounds());assert.ok(sounds0.includes(clipFile('Tap')),'cell clicks tap: '+sounds0);
 await page.evaluate(()=>window.explorerDev.giveItem('Wood',60));await page.locator('#blueprint-list [data-blueprint]').filter({hasText:'Wood Planks'}).first().click();
 const n0=await page.evaluate(()=>window.explorerDev.rposSounds().length);await page.locator('#craft').click();
 await page.waitForFunction(f=>window.explorerDev.rposSounds().includes(f),clipFile('craft_start'),{timeout:5000});
 const craftSounds=(await page.evaluate(()=>window.explorerDev.rposSounds())).slice(n0);assert.deepEqual(craftSounds.filter(f=>f===clipFile('craft_start')).length,1,'craft_start once: '+craftSounds);assert.ok(craftSounds.includes(clipFile('Tap')),'the Craft button taps');
 const n1=await page.evaluate(()=>window.explorerDev.rposSounds().length);
 await page.locator('#inventory-close').click();await page.waitForSelector('#inventory',{state:'hidden'});assert.deepEqual((await page.evaluate(()=>window.explorerDev.rposSounds())).slice(n1),[clipFile('Tap')],'close taps');assert.deepEqual(errors,[]);const result={graphics:await readGraphics(page),given,desktop,errors};console.log(JSON.stringify(result,null,1));await writeFile('analysis/browser-qa/rpos.json',JSON.stringify(result,null,1));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
