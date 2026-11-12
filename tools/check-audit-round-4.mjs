// Audit round 4, 2026-10-23 (GAP-AUDIT.md) on the real ?dev page, offline: a fresh character looks level along its
// spawn point's rotation (A4-5), a held Torch burns a use per second plus one on the draw (A4-4, server
// BasicTorchItem.ServerFrame) and the HUD's food value changes only on the metabolism tick (A4-7). Screenshot (dev header
// and panel hidden) in analysis/browser-qa/audit-round-4/.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {Matrix4,Quaternion,Vector3} from 'three';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';
import {spawnLook} from '../browser/net-client.mjs';
const out='analysis/browser-qa/audit-round-4/';await mkdir(out,{recursive:true});
const scene=JSON.parse(await readFile('browser/assets/recovered/scene/manifest.json','utf8'));
const spawnYaws=scene.world.spawnPoints.map(p=>{const q=new Quaternion();if(p.matrix)new Matrix4().fromArray(p.matrix).decompose(new Vector3(),q,new Vector3());return spawnLook([q.x,q.y,q.z,q.w]).yaw;});
const server=createServer();await listenServer(server);let browser;const report={};
try{browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev&fresh`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:120000});
 await page.evaluate(()=>window.explorerDev.face(2.5,-0.7));
 await page.locator('#respawn').evaluate(b=>b.click());await page.waitForFunction(()=>window.explorerState.walk);
 // A4-5: level, along one of the spawn points (the motor may already have turned nothing: no mouse input here).
 report.look=await page.evaluate(()=>window.explorerDev.look());report.lookOff=Math.min(...spawnYaws.map(y=>Math.abs(Math.atan2(Math.sin(y-report.look.yaw),Math.cos(y-report.look.yaw)))));
 assert.equal(report.look.pitch,0,'level after the spawn');assert.ok(report.lookOff<1e-6,'facing a spawn point rotation: '+report.lookOff);
 // A4-7: the HUD's food value follows the 2 s metabolism tick, not the live value.
 await page.waitForFunction(()=>window.explorerDev.hudMetabolism().caloricLevel!==1250,{},{timeout:10000});
 const t0=await page.evaluate(()=>{window.explorerDev.setCalories(2400);return performance.now();});
 const immediate=await page.evaluate(()=>window.explorerDev.hudMetabolism().caloricLevel);
 await page.waitForFunction(()=>window.explorerDev.hudMetabolism().caloricLevel>2300,{},{timeout:5000});
 const shownAfter=await page.evaluate(t=>performance.now()-t,t0);await page.waitForTimeout(100);
 report.hud={immediate,shownAfterMs:shownAfter,text:await page.locator('.hud-food output').textContent()};
 assert.ok(immediate<2300,'not shown at once: '+immediate);assert.ok(shownAfter<=2300,'shown on the next tick: '+shownAfter);assert.match(report.hud.text,/^2,(3\d\d|400)$/);
 // A4-4: Torch at night.
 await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none';const d=window.explorerDev;d.setTime(22.5);d.teleport([5688,317,5148]);d.face(-1.2,-0.1);d.giveItem('Torch',1);window.__torchSlot=d.hold('Torch');});
 await page.waitForFunction(()=>window.explorerDev.torch().lit&&window.explorerDev.heldUses()?.name==='Torch',{},{timeout:30000});
 const start=await page.evaluate(()=>({uses:window.explorerDev.heldUses().uses,at:performance.now()}));
 await page.waitForTimeout(5000);
 const later=await page.evaluate(()=>({uses:window.explorerDev.heldUses().uses,at:performance.now()}));
 report.torch={start,later,burned:250-later.uses,seconds:(later.at-start.at)/1000};
 // The held torch's belt cell counts down with it (RPOSInventoryCell: a non-splittable item's uses in yellow).
 report.torch.cells=await page.evaluate(()=>({uses:window.explorerDev.heldUses().uses,texts:[...document.querySelectorAll(`[data-slot="${window.__torchSlot}"]`)].map(e=>e.textContent.trim())}));
 assert.ok(report.torch.cells.texts.some(t=>t.includes(String(report.torch.cells.uses))),'cell label: '+JSON.stringify(report.torch.cells));
 assert.ok(start.uses>=248&&start.uses<=250,'the draw: '+start.uses);
 assert.ok(report.torch.burned>=5&&report.torch.burned<=8,'about one use a second plus the draw: '+JSON.stringify(report.torch));
 await page.waitForTimeout(500);await page.screenshot({path:out+'torch-night.png'});
 report.errors=errors;assert.deepEqual(errors.filter(e=>!/favicon|404/.test(e)),[]);
 console.log(JSON.stringify(report,null,1));
}finally{await writeFile(out+'report.json',JSON.stringify(report,null,1));await browser?.close();server.close();}
