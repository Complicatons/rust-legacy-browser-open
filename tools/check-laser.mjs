// Focused Edge check for the laser sight (LaserGraphics port, browser/weapon-mod-effects.mjs): first-person beam and two-quad
// dot on a near surface at night and day, no dot when aiming at the sky, flashlight radial light in the view-model pass, the
// soft-particle depth copy from the opaque queue at Fantastic, and no GL errors. Screenshots: analysis/browser-qa/fx/laser-*.png.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const server=createServer();await listenServer(server);
let browser;
try {
 {const options=launchOptions();options.args.push('--mute-audio');browser=await chromium.launch(options);}
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],glErrors=[],warnings=[];
 const GL_ERROR=/GL_INVALID|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE|INVALID_FRAMEBUFFER|Mismatch between texture format|too many errors/i;
 await page.addInitScript(()=>{let state=0x517cc1b7;Math.random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text());if(m.type()==='error')errors.push(m.text());if(GL_ERROR.test(m.text()))glErrors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:60000});
 await page.locator('#respawn').evaluate(b=>b.click());await page.waitForFunction(()=>window.explorerState.walk);await mkdir('analysis/browser-qa/fx',{recursive:true});
 const results={graphics:await readGraphics(page)};
 await page.evaluate(()=>{const d=window.explorerDev;d.giveItem('M4',1);d.giveItem('556 Ammo',60);d.hold('M4');});await page.waitForFunction(()=>window.explorerDev.viewModel()?.name,{},{timeout:20000}).catch(e=>{console.log('NO VIEWMODEL',errors,warnings.slice(-10));throw e;});await page.waitForTimeout(500);
 const aim=(dy,dz)=>page.evaluate(([dy,dz])=>{const p=window.explorerState.position;window.explorerDev.aimPoint([p[0],p[1]+dy,p[2]+dz]);},[dy,dz]);
 await page.evaluate(()=>{window.explorerDev.setItemMods(['Laser Sight']);window.explorerDev.setTime(22);});await aim(-3,-8);
 await page.waitForFunction(()=>window.explorerDev.weaponMods()?.lasers===1);await page.waitForTimeout(2500);
 results.night=await page.evaluate(()=>window.explorerDev.weaponMods());await page.screenshot({path:'analysis/browser-qa/fx/laser-night.png'});
 // Roadmap picture: the same frame with the dev header and panel hidden (as tools/capture-roadmap-world.mjs).
 await mkdir('analysis/browser-qa/roadmap-world',{recursive:true});await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none';});
 await page.waitForTimeout(200);await page.screenshot({path:'analysis/browser-qa/roadmap-world/laser-night.png'});await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='';});
 const e=results.night.effects.find(x=>x.name==='Laser Sight');assert.ok(e?.hit,'laser hits the ground ahead');assert.ok(e.dot,'two-quad dot drawn on a surface facing the camera');assert.equal(e.beamColor[0],1,'RangeBeamColor normalises red');
 await page.evaluate(()=>window.explorerDev.setTime(12));await page.waitForTimeout(400);await page.screenshot({path:'analysis/browser-qa/fx/laser-day.png'});
 await aim(30,-8);await page.waitForTimeout(400);results.sky=await page.evaluate(()=>window.explorerDev.weaponMods());const s=results.sky.effects.find(x=>x.name==='Laser Sight');
 assert.equal(s.dot,false,'no dot without a hit');
 await page.evaluate(()=>{window.explorerDev.setItemMods(['Flashlight Mod','Laser Sight']);window.explorerDev.setTime(22);});await aim(-3,-8);
 await page.waitForFunction(()=>window.explorerDev.weaponMods()?.lights===1);await page.waitForTimeout(400);results.lamp=await page.evaluate(()=>window.explorerDev.viewModelLights?.()??null);
 await page.screenshot({path:'analysis/browser-qa/fx/laser-lamp-night.png'});
 // Soft particles (Fantastic): the depth copy now runs from the opaque queue (renderOrder 0.5) before the forward-only tree
 // leaves/billboards; the held torch's soft view-model flame requests it.
 await page.evaluate(()=>{const d=window.explorerDev;d.setQuality(5);d.giveItem('Torch',1);d.hold('Torch');});await page.waitForTimeout(3000);
 results.soft=await page.evaluate(()=>window.explorerDev.quality().softParticles);await page.screenshot({path:'analysis/browser-qa/fx/laser-soft-torch.png'});
 assert.equal(results.soft.enabled,true);assert.equal(results.soft.lastCopy,'copied',JSON.stringify(results.soft));assert.ok(results.soft.copies>10&&results.soft.failed===0,JSON.stringify(results.soft));
 assert.deepEqual(glErrors,[],'no GL errors');assert.deepEqual(errors.filter(x=>!/favicon|404/.test(x)),[],'no page errors');
 await writeFile('analysis/browser-qa/fx/laser.json',JSON.stringify(results,null,1));console.log(JSON.stringify({night:e,sky:s,lamp:results.lamp,soft:results.soft,renderer:results.graphics?.renderer},null,1));console.log('PASS laser');
} finally {await browser?.close();server.close();}
