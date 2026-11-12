// GPU check of the 2026-10-22 presentation fixes (browser/presentation-extras.mjs, combat.mjs heldItemPreFrame): drawing an
// item plays its datablock deploySound; AltFire aims a gun at aimSensitivtyPercent (0.4) but never the HandCannon;
// an F1 explosion's flash starts at initialLightIntensity and is out after 0.25 s. Screenshots: analysis/browser-qa/presentation/.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';
const out='analysis/browser-qa/presentation';await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);
let browser;
try {
 browser=await chromium.launch(launchOptions());
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:90000});
 await page.locator('#respawn').evaluate(b=>b.click());await page.waitForFunction(()=>window.explorerState.walk);
 await page.keyboard.press('ShiftLeft');await page.waitForFunction(()=>window.explorerDev.audio().state==='running',{},{timeout:10000}).catch(()=>{});
 // Roadmap pictures: dev header and panel hidden (CSSOM; the page CSP blocks style tags), the game HUD stays.
 await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none';const d=window.explorerDev;d.teleport([5688,317,5148]);d.face(-1.2,0.02);});await page.waitForTimeout(1500);
 const p=()=>page.evaluate(()=>window.explorerDev.presentation()),results={};
 results.loaded=(await p()).loaded;assert.ok(results.loaded,'presentation/manifest.json loaded');
 await page.evaluate(()=>{const d=window.explorerDev;d.giveItem('M4',1);d.giveItem('556 Ammo',60);d.giveItem('HandCannon',1);d.hold('M4');});
 await page.waitForFunction(()=>window.explorerDev.presentation().lastDeploySound,{},{timeout:20000});
 results.m4Draw=(await p()).lastDeploySound;
 await page.waitForTimeout(1500);results.loadedClips=(await page.evaluate(()=>window.explorerDev.audio().loaded)).filter(u=>u.includes('/presentation/'));
 assert.ok(results.loadedClips.some(u=>u.endsWith(results.m4Draw.file)),'draw clip fetched for playback');
 await page.screenshot({path:`${out}/m4-drawn.png`});
 await page.mouse.move(720,450);await page.mouse.down({button:'right'});await page.waitForTimeout(900);
 results.m4Aim=await p();assert.equal(results.m4Aim.aiming,true);assert.equal(Math.fround(results.m4Aim.aimSensitivity),Math.fround(0.4));
 // BulletWeaponItem aim sway (combat.mjs aimSway, Mathf.PerlinNoise from rust.exe): the M4 sways while aimed.
 assert.equal(results.m4Aim.aimSway?.item,'M4');assert.ok(results.m4Aim.aimSway.last&&(results.m4Aim.aimSway.last.yaw!==0||results.m4Aim.aimSway.last.pitch!==0));
 await page.screenshot({path:`${out}/m4-aim.png`});await page.mouse.up({button:'right'});await page.waitForTimeout(300);
 results.m4Released=await p();assert.equal(results.m4Released.aimSensitivity,1);assert.equal(results.m4Released.aimSway,null);
 await page.evaluate(()=>window.explorerDev.hold('HandCannon'));await page.waitForTimeout(1500);
 results.handCannonDraw=(await p()).lastDeploySound;assert.notEqual(results.handCannonDraw.item,results.m4Draw.item);
 await page.mouse.down({button:'right'});await page.waitForTimeout(600);results.handCannonAim=await p();await page.mouse.up({button:'right'});
 assert.equal(results.handCannonAim.aiming,false);assert.equal(results.handCannonAim.aimSensitivity,1);
 // F1 grenade 14 m ahead at night (outside its blast radius): the flash peaks at 5 * 6 (port light units) and is gone 0.25 s later.
 await page.evaluate(()=>{window.explorerDev.setTime(22.5);window.explorerDev.hold('M4');window.explorerDev.face(-1.2,-0.08);});await page.waitForTimeout(1500);
 await page.evaluate(()=>{const c=window.explorerState.position,yaw=-1.2,f=[-Math.sin(yaw),0,-Math.cos(yaw)];window.explorerDev.spawnGrenade([c[0]+f[0]*14,c[1]+0.5,c[2]+f[2]*14]);});
 // The flash lasts 0.25 s: poll and take the picture while the light is still on.
 for(const until=Date.now()+10000;Date.now()<until;){const v=await p();if(v.lastExplosionEffect){results.explosion=v;if(v.explosionLights[0]>0){await page.screenshot({path:`${out}/explosion-flash.png`});results.explosion.capturedAtLight=v.explosionLights[0];}break;}}
 assert.ok(results.explosion,'grenade exploded');
 assert.equal(results.explosion.lastExplosionEffect.effect,'Explosion1');assert.ok(results.explosion.lastExplosionEffect.pitch>=0.9&&results.explosion.lastExplosionEffect.pitch<=1);
 assert.equal(results.explosion.lastExplosionEffect.lightPeak,30);
 await page.waitForTimeout(400);results.afterFlash=await p();assert.deepEqual(results.afterFlash.explosionLights,[0,0]);
 // QuickLight (MetalImpact): an M4 shot into a Metal Foundation at night lights a 0.1 s spark (range 1 -> 0, intensity 5 * 6).
 results.metal=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),out={};
  // The browser check's flat build site (tools/find-build-site.mjs).
  d.setTime(23);d.teleport([5688,316.5,5148]);await wait(900);d.giveItem('Metal Foundation',1);
  for(let k=0;k<6&&!out.placed;k++){if(k)d.walkAway(12);await wait(300);const e=d.aim().eye;d.aimPoint([e[0],e[1]-2.2,e[2]-5]);out.placed=d.placeAim('Metal Foundation')?.placed;}
  const f=d.structures().find(c=>c.item==='MetalFoundation');out.foundation=f?.position??null;if(!f)return out;
  const top=[f.position[0],f.position[1]+0.1,-f.position[2]];d.teleport([top[0]+3.2,top[1]+0.2,top[2]+3.2]);await wait(600);d.hold('M4');await wait(1600);d.aimPoint(top);await wait(100);
  out.before=d.tracerEffects().quickLights.made;d.trigger(60);
  for(const until=performance.now()+3000;performance.now()<until;){await new Promise(r=>requestAnimationFrame(r));const q=d.tracerEffects().quickLights;if(q.made>out.before){out.lit=q.lit.find(l=>l.intensity>0)??null;out.surface=d.tracerEffects().lastImpact?.surface;break;}}
  return out;});
 if(results.metal.lit)await page.screenshot({path:`${out}/metal-spark.png`});
 assert.ok(results.metal.foundation,JSON.stringify(results.metal));assert.equal(results.metal.surface,'metal');assert.equal(results.metal.lit?.intensity,30);assert.ok(results.metal.lit.range>0&&results.metal.lit.range<=1);
 await page.waitForTimeout(300);assert.ok((await page.evaluate(()=>window.explorerDev.tracerEffects().quickLights.lit)).every(l=>l.intensity===0),'out after 0.1 s');
 results.errors=errors;assert.deepEqual(errors,[]);
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,1));console.log(JSON.stringify(results,null,1));
} finally {await browser?.close();server.close();}
