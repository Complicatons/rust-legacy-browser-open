// Startup + offline save check that runs without a GPU (software WebGL; ~1 min per page load).
// Loads the island, places a storage box with contents, saves on pagehide, reloads, checks the world and player
// position came back, then checks ?fresh starts an empty world and the repair bench repairs. Zero page errors required.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const server=createServer();await listenServer(server);
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(launchOptions());
const ready=p=>p.waitForFunction(()=>window.explorerState?.frames>=1||/Could not/.test(document.querySelector('#status')?.textContent??''),{},{timeout:600000,polling:1000});
try{
 const page=await browser.newPage({viewport:{width:640,height:400}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||(m.type()==='warning'&&/Save|Navmesh/.test(m.text())))errors.push(m.text());});
 await page.goto(url+'/?dev',{waitUntil:'load',timeout:300000});await ready(page);
 assert.ok(await page.evaluate(()=>window.explorerState?.ready),await page.evaluate(()=>document.querySelector('#status')?.textContent));
 await page.evaluate(()=>document.querySelector('#mode').click()); // DOM click: software WebGL frames make Playwright's stability wait flaky
 await page.waitForFunction(()=>window.explorerState.walk,{},{timeout:120000});
 await page.waitForTimeout(700); // Let the motor settle before taking a placement ray.
 const before=await page.evaluate(()=>{const d=window.explorerDev;let r=null;for(let i=0;i<6&&!r?.placed;i++){d.giveItem('Wood Storage Box',1);r=d.placeHeld('Wood Storage Box',2.5);if(!r.placed)d.walkAway(5);}
  const box=d.deployables().findIndex(o=>o.kind==='storage');if(box>=0)d.fillDeployed(box,2,'Wood',77);
  dispatchEvent(new Event('pagehide'));return {placed:Boolean(r?.placed),feet:window.explorerState.player.feet};});
 assert.ok(before.placed,JSON.stringify(before));
 await page.reload({waitUntil:'load',timeout:300000});await ready(page);
 assert.ok(await page.evaluate(()=>window.explorerState?.ready),'reload: '+await page.evaluate(()=>document.querySelector('#status')?.textContent));
 const after=await page.evaluate(()=>({walk:window.explorerState.walk,feet:window.explorerState.player.feet,box:window.explorerDev.deployables().find(o=>o.kind==='storage')}));
 assert.equal(after.walk,true);assert.ok(Math.hypot(after.feet[0]-before.feet[0],after.feet[2]-before.feet[2])<1,'player restored');
 assert.equal(after.box?.slots?.[2]?.uses,77,'box contents restored');
 await page.goto(url+'/?dev&fresh',{waitUntil:'load',timeout:300000});await ready(page);
 assert.ok(await page.evaluate(()=>window.explorerState?.ready),'fresh: '+await page.evaluate(()=>document.querySelector('#status')?.textContent));
 assert.equal(await page.evaluate(()=>window.explorerDev.deployables().length),0,'?fresh starts empty');
 // Repair bench: Search opens it; Repair (RepairBench.DoRepair) fixes the item in slot 0 using inventory materials.
 await page.evaluate(()=>document.querySelector('#mode').click()); // DOM click: software WebGL frames make Playwright's stability wait flaky
 await page.waitForFunction(()=>window.explorerState.walk,{},{timeout:120000});
 await page.waitForTimeout(700);
 const bench=await page.evaluate(()=>{const d=window.explorerDev;let p=null;for(let i=0;i<6&&!p?.placed;i++){d.giveItem('Repair Bench',1);p=d.placeHeld('Repair Bench',2.5);if(!p.placed)d.walkAway(5);}
  const i=d.deployables().findIndex(o=>o.kind==='repairbench');d.fillDeployed(i,0,'Hatchet',1);d.setDeployedCondition(i,0,0.5);d.giveItem('Wood',200);d.giveItem('Metal Fragments',200);d.deployedAction(i,'use');return {placed:Boolean(p?.placed)};});
 assert.ok(bench.placed,'repair bench placed');
 const repair=page.locator('#loot-action');assert.equal(await repair.textContent(),'Repair');assert.equal(await repair.isDisabled(),false);
 await repair.evaluate(b=>b.click());await page.waitForFunction(()=>document.querySelector('#loot-action').hidden,{},{timeout:5000}); // RPOSRepairBenchWindow hides the button once repaired
 assert.equal(await page.evaluate(()=>document.querySelector('#repair-info [data-node="NeedLabel"]').textContent),'Does not need repairs');
 // RepairBench.DoRepair: Notice.Popup(wrench icon, "Repaired Item!") -> the original PopupNotice (popup-ui.mjs).
 await page.waitForFunction(()=>window.explorerDev.popupNotices().includes('Repaired Item!'),{},{timeout:5000});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,graphics:await readGraphics(page),restored:after.box.slots[2],repaired:true}));
}finally{await browser.close();server.close();}
