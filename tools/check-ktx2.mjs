// Focused Edge check for KTX2/Basis textures (browser/texture-source.mjs): the same views load with KTX2 and with
// ?ktx2=0 (PNG), without GL errors; screenshots analysis/browser-qa/ktx2-{on,off}-*.png for side-by-side review, plus the
// texture bytes each mode transferred.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const server=createServer();await listenServer(server);
const GL_ERROR=/GL_INVALID|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE|INVALID_FRAMEBUFFER|Mismatch between texture format|too many errors/i;
let browser;const results={};
try {
 browser=await chromium.launch(launchOptions());await mkdir('analysis/browser-qa',{recursive:true});
 for(const mode of ['on','off']){
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],glErrors=[],bytes={png:0,ktx2:0,count:{png:0,ktx2:0}};
  await page.addInitScript(()=>{let state=0x517cc1b7;Math.random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(GL_ERROR.test(m.text()))glErrors.push(m.text());});
  page.on('response',async r=>{const u=r.url(),ext=u.endsWith('.ktx2')?'ktx2':u.endsWith('.png')?'png':null;if(!ext||!u.includes('/assets/recovered/'))return;const b=await r.body().catch(()=>null);if(b){bytes[ext]+=b.length;bytes.count[ext]++;}});
  await page.goto(`http://127.0.0.1:${server.address().port}/?dev${mode==='off'?'&ktx2=0':''}`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:120000}).catch(async e=>{console.log('LOAD FAIL',mode,errors.slice(0,5),await page.locator('#status').textContent().catch(()=>''));throw e;});
  // A loot crate (loot textures) and the world from the default camera.
  await page.waitForTimeout(1500);await page.screenshot({path:`analysis/browser-qa/ktx2-${mode}-world.png`});
  await page.evaluate(()=>window.explorerDev.approachCrate(0,1.6));await page.waitForTimeout(1500);await page.screenshot({path:`analysis/browser-qa/ktx2-${mode}-crate.png`});
  results[mode]={graphics:await readGraphics(page),stats:await page.evaluate(()=>window.explorerDev.textures()),bytes,errors,glErrors};
  await page.close();
 }
 console.log(JSON.stringify(results,null,1));await writeFile('analysis/browser-qa/ktx2.json',JSON.stringify(results,null,1));
 for(const m of ['on','off']){assert.deepEqual(results[m].errors.filter(e=>!/KTX2 unavailable/.test(e)),[],m);assert.deepEqual(results[m].glErrors,[],m);}
 assert.ok(results.on.stats.active&&results.on.stats.ktx2>0,'KTX2 textures loaded');assert.equal(results.off.stats.ktx2,0);
}finally{await browser?.close();await new Promise(r=>server.close(r));}
