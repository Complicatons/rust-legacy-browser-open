// UI edge cases, 2026-10-23 (GAP-AUDIT.md) on the real ?dev page: a held W keeps moving after RPOS / the F1 console / chat
// close and the cursor relocks itself (GameButton.IsDown = Input.GetKey; RPOS.SetRPOSModeNoChecks, ConsoleWindow.Update
// TryLock); chat ignores IME Enter/Escape; a pointer lock lost without focus is not Escape (LockCursorManager KeyDown);
// the death reason renders its markup; respawning relocks (DeathScreen.OutroAnimations). Screenshots in
// analysis/browser-qa/ui-edge-cases/.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const out='analysis/browser-qa/ui-edge-cases/';await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);let browser;const report={};
try{browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:120000});
 const locked=()=>page.waitForFunction(()=>Boolean(document.pointerLockElement),{},{timeout:10000}),unlocked=()=>page.waitForFunction(()=>!document.pointerLockElement,{},{timeout:10000});
 const pos=()=>page.evaluate(()=>window.explorerState.position),dist=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
 const drift=async(ms=400)=>{const a=await pos();await page.waitForTimeout(ms);return dist(a,await pos());};
 const escapes=()=>page.evaluate(()=>window.explorerDev.controls().escapeKeys);
 await page.locator('#world').click({position:{x:850,y:350}});await locked();
 // ---- 1 + 2: W held through RPOS and the F1 console (one keydown, no auto-repeat from automation) -------------------
 await page.keyboard.down('KeyW');report.moving=await drift();assert.ok(report.moving>1,'W moves: '+report.moving);
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await unlocked();report.rposOpen=await drift();assert.ok(report.rposOpen<0.01,'no movement with RPOS up: '+report.rposOpen);
 await page.keyboard.press('Tab');await page.waitForFunction(()=>!document.querySelector('#inventory').open);await locked();report.afterRpos=await drift();assert.ok(report.afterRpos>1,'held W moves again after RPOS: '+report.afterRpos);
 await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');await unlocked();report.consoleOpen=await drift();assert.ok(report.consoleOpen<0.01,'no movement with the console up: '+report.consoleOpen);
 await page.keyboard.press('F1');await page.waitForSelector('#game-console',{state:'hidden'});await locked();report.afterConsole=await drift();assert.ok(report.afterConsole>1,'held W moves again after the console: '+report.afterConsole);
 // ---- 9: chat ignores IME composition Enter/Escape ------------------------------------------------------------------
 await page.keyboard.press('Enter');await page.waitForFunction(()=>window.explorerDev.chat().open&&!document.pointerLockElement);await page.waitForTimeout(100);
 const e0=await escapes();
 report.ime=await page.evaluate(()=>{const input=document.querySelector('#chat-input');input.value='ni';for(const [code,key] of [['Enter','Process'],['Escape','Process'],['Enter','Enter']])input.dispatchEvent(new KeyboardEvent('keydown',{code,key,isComposing:true,bubbles:true,cancelable:true}));
  return {open:window.explorerDev.chat().open,text:window.explorerDev.chat().text,rpos:document.querySelector('#inventory').open};});
 assert.deepEqual(report.ime,{open:true,text:'ni',rpos:false},'composition keys neither send nor cancel');assert.equal(await escapes(),e0);
 await page.screenshot({path:out+'chat-ime.png'});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.explorerDev.chat().open);await page.locator('#world').click({position:{x:850,y:350}});await locked();
 report.afterChat=await drift();assert.ok(report.afterChat>1,'held W moves again after chat: '+report.afterChat);
 await page.keyboard.up('KeyW');
 // ---- 4: a lock lost without focus is not Escape --------------------------------------------------------------------
 const before=await escapes();await page.evaluate(()=>{document.hasFocus=()=>false;document.exitPointerLock();});await unlocked();await page.waitForTimeout(100);
 report.focusLossEscapes=await escapes()-before;assert.equal(report.focusLossEscapes,0,'focus loss is not onEscapeKey');
 await page.evaluate(()=>{delete document.hasFocus;});await page.locator('#world').click({position:{x:850,y:350}});await locked();await page.keyboard.press('Escape');await unlocked();await page.waitForTimeout(100);
 report.escapeEscapes=await escapes()-before;assert.equal(report.escapeEscapes,1,'a real Escape still is');
 // ---- 5 + 2: death reason markup, respawn relocks ---------------------------------------------------------------------
 await page.locator('#mode').click();await page.waitForFunction(()=>window.explorerState.walk);
 await page.keyboard.press('F1');await page.waitForSelector('#game-console:not([hidden])');await page.locator('#console-input').fill('suicide');await page.locator('#console-input').press('Enter');await page.keyboard.press('F1');
 await page.waitForSelector('#death:not([hidden])');assert.equal(await page.evaluate(()=>Boolean(document.pointerLockElement)),false,'dead: no relock');
 report.reason=await page.evaluate(()=>window.explorerDev.showDeathReason('[color #ff4040]Bob[/color] killed you with a hit to your [color yellow]head[/color]'));
 assert.equal(report.reason,'Bob killed you with a hit to your head','markup tags are not shown');
 await page.waitForTimeout(2500);
 report.runs=await page.evaluate(()=>[...document.querySelectorAll('#death .death-run')].filter(s=>s.textContent.trim()).map(s=>({text:s.textContent,image:s.style.backgroundImage,color:s.style.color})));
 const bob=report.runs.find(r=>r.text==='Bob'),head=report.runs.find(r=>r.text==='head'),plain=report.runs.find(r=>r.text==='killed');
 assert.match(bob.image||bob.color,/rgba?\(\d+, ?[0-9]?[0-9], ?[0-9]?[0-9]/,'Bob in red: '+JSON.stringify(bob));assert.ok(head.image||head.color,'head coloured');assert.equal(plain.image+plain.color,'','plain text keeps the label gradient');
 const devPanel=v=>page.evaluate(v=>{for(const e of document.querySelectorAll('aside,header'))e.style.visibility=v;},v);await devPanel('hidden');await page.screenshot({path:out+'death-reason-markup.png'});await devPanel(''); // roadmap picture (build-roadmap-media.mjs)
 await page.locator('#respawn').click();await page.waitForFunction(()=>window.explorerState.walk&&!document.body.classList.contains('player-dead'));await locked();report.respawnRelocked=true;
 assert.deepEqual(errors,[]);report.graphics=await readGraphics(page);report.errors=errors;
 await writeFile(out+'report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
