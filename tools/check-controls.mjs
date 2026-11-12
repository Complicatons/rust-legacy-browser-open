import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const server=createServer();await listenServer(server);let browser;
try{browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:90000});
 assert.equal(await page.evaluate(()=>window.explorerState.walk),false);await page.locator('#world').click({position:{x:850,y:350}});await page.waitForFunction(()=>Boolean(document.pointerLockElement));assert.equal(await page.locator('#world').evaluate(c=>getComputedStyle(c).cursor),'none');
 // While captured, cancellable browser shortcuts (bookmark, save, find, reload) do nothing; plain game keys keep their defaults.
 await page.evaluate(()=>{window.__shortcuts=[];addEventListener('keydown',e=>window.__shortcuts.push([e.code,e.ctrlKey,e.defaultPrevented]));});
 for(const k of ['Control+KeyD','Control+KeyS','Control+KeyF','F5'])await page.keyboard.press(k);
 for(const [code,ctrl,prevented] of await page.evaluate(()=>window.__shortcuts))if(ctrl&&code!=='ControlLeft'||code==='F5')assert.ok(prevented,`${code} was not cancelled`);
 await page.keyboard.press('F2');await page.waitForFunction(()=>!document.pointerLockElement);assert.notEqual(await page.locator('#world').evaluate(c=>getComputedStyle(c).cursor),'none');
 await page.locator('#respawn').evaluate(b=>b.click());await page.locator('#options-toggle').click();await page.waitForSelector('#game-settings[open]');
 await page.locator('#render-fov').fill('100');await page.waitForFunction(()=>window.explorerDev.controls().cameraFov===100);assert.equal(await page.locator('output[for=render-fov]').textContent(),'100');
 await mkdir('analysis/browser-qa',{recursive:true});await page.screenshot({path:'analysis/browser-qa/desktop-options.png'});
 await page.locator('#settings-apply').click();await page.keyboard.press('F1');await page.locator('#console-input').fill('render.fov 85');await page.locator('#console-input').press('Enter');await page.waitForFunction(()=>window.explorerDev.controls().cameraFov===85);
 await page.screenshot({path:'analysis/browser-qa/desktop-console.png'});await page.keyboard.press('F1');await page.locator('#options-toggle').click();assert.equal(await page.locator('#render-fov').inputValue(),'85');await page.locator('#settings-apply').click();
 await page.locator('#world').click({position:{x:850,y:350}});await page.waitForFunction(()=>Boolean(document.pointerLockElement));
 await page.evaluate(()=>{window.explorerDev.giveItem('M4',1);window.explorerDev.hold('M4');});await page.mouse.down({button:'right'});await page.waitForFunction(()=>window.explorerDev.controls().zoom>.9&&window.explorerDev.controls().cameraFov<85);await page.mouse.up({button:'right'});await page.waitForFunction(()=>Math.abs(window.explorerDev.controls().cameraFov-85)<.01);
 await page.keyboard.press('F2');await page.waitForFunction(()=>!document.pointerLockElement);await page.locator('#world').click({position:{x:850,y:350}});await page.waitForFunction(()=>Boolean(document.pointerLockElement));await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);
 await page.keyboard.press('Alt+Enter');await page.waitForFunction(()=>Boolean(document.fullscreenElement));await page.keyboard.press('Alt+Enter');await page.waitForFunction(()=>!document.fullscreenElement);
 // Having played, leaving asks for confirmation (Ctrl+W while crouch-walking must not silently close the game).
 const leave=[];page.on('dialog',d=>{leave.push(d.type());d.accept();});
 await page.reload({waitUntil:'networkidle'});assert.deepEqual(leave,['beforeunload'],'leaving after playing asks first');await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:90000});assert.equal(await page.evaluate(()=>window.explorerDev.controls().fov),85);
 // Play in fullscreen (the players' default; automation opts in): one click captures the mouse, enters fullscreen and takes
 // Keyboard Lock, so Ctrl+W/T/N reach the game instead of the browser; a short Escape releases the mouse but keeps fullscreen.
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('rlb-render-settings'));localStorage.setItem('rlb-render-settings',JSON.stringify({...s,fullscreen:true}));});
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:90000});
 await page.locator('#world').click({position:{x:850,y:350}});await page.waitForFunction(()=>{const c=window.explorerDev.controls();return c.locked&&c.fullscreen&&c.keyboardLocked&&c.leaveGuard;});
 await page.evaluate(()=>{window.__shortcuts=[];addEventListener('keydown',e=>window.__shortcuts.push([e.code,e.defaultPrevented]));});
 for(const k of ['Control+KeyW','Control+KeyT','Control+KeyN','Control+KeyR','F5','Alt+ArrowLeft'])await page.keyboard.press(k);
 for(const [code,prevented] of await page.evaluate(()=>window.__shortcuts))if(!/^(Control|Alt)/.test(code))assert.ok(prevented,`${code} was not cancelled in fullscreen`);
 // Crouch-walking (Ctrl held, W) keeps the game: the roadmap picture (tools/build-roadmap-media.mjs fullscreen-play.jpg).
 await page.keyboard.down('Control');await page.keyboard.down('KeyW');await page.waitForTimeout(900);const devPanel=v=>page.evaluate(v=>{for(const e of document.querySelectorAll('aside,header'))e.style.visibility=v;},v);await devPanel('hidden');await page.screenshot({path:'analysis/browser-qa/fullscreen-play.png'});await devPanel('');await page.keyboard.up('KeyW');await page.keyboard.up('Control');assert.equal(await page.evaluate(()=>window.explorerDev.controls().locked),true,'still playing after Ctrl+W');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);assert.equal(await page.evaluate(()=>Boolean(document.fullscreenElement)),true,'short Escape keeps fullscreen');
 assert.deepEqual(errors,[]);const result={graphics:await readGraphics(page),controls:await page.evaluate(()=>window.explorerDev.controls()),weaponZoomPreserved:true,sliderConsoleSync:true,persistence:true,captureReleaseRecapture:true,fullscreen:true,fullscreenKeyboardLock:true,errors};await writeFile('analysis/browser-qa/controls.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
