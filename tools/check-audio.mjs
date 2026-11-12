// GPU check of the original player/world audio offline (world-audio.mjs): footsteps per surface while walking and
// crouching, the landing step, FallDamage legBreakSound, wildlife footsteps, the ForestAmbient day/night loops, the
// island MusicPlayer and the sound.volume / sound.music plumbing. Run with REQUIRE_GPU=1 on Windows.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const out='analysis/browser-qa/audio';await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);
let browser;const report={};
try {
 browser=await chromium.launch({...launchOptions(),args:[...launchOptions().args,'--autoplay-policy=user-gesture-required']});
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 await page.addInitScript(()=>{let state=0x517cc1b7;Math.random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev&fresh`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:90000});
 report.graphics=await readGraphics(page);
 const audio=()=>page.evaluate(()=>window.explorerDev.worldAudio());
 assert.ok(await audio(),'world audio loaded (audio/manifest.json present)');
 // A trusted key press unlocks the AudioContext (unchanged unlock rule).
 await page.keyboard.press('ShiftLeft');await page.waitForFunction(()=>window.explorerDev.audio().state==='running',{},{timeout:10000});
 const unlockedAt=Date.now();
 const grounded=()=>page.waitForFunction(()=>window.explorerState.player.grounded,{},{timeout:5000});
 async function walkFor(start,yaw,ms,{crouch=false}={}){await page.evaluate(p=>window.explorerDev.teleport(p),start);await page.evaluate(y=>window.explorerDev.face(y,-0.2),yaw);await page.waitForTimeout(400);await grounded();
  const before=await audio();if(crouch)await page.keyboard.down('ControlLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(ms);await page.keyboard.up('KeyW');if(crouch)await page.keyboard.up('ControlLeft');
  const after=await audio();return {steps:after.localFootsteps-before.localFootsteps,last:after.last.local};}
 // 1. Open ground east of the hangar compound (terrain): walking 4 s at ~4 m/s steps every 3.24 m.
 report.walk=await walkFor([6076,374.6,3556],Math.PI/2,4000);console.log('walk',JSON.stringify(report.walk));
 assert.ok(report.walk.steps>=3&&report.walk.steps<=7,'walk steps '+report.walk.steps);assert.equal(report.walk.last.kind,'local');assert.equal(report.walk.last.volume,0.65);
 assert.ok(/^(gravel|grass)/.test(report.walk.last.clip)&&['default','grass'].includes(report.walk.last.surface),JSON.stringify(report.walk.last));assert.deepEqual([report.walk.last.min,report.walk.last.max],[3,30]);assert.ok(report.walk.last.played);
 // 2. Crouched: same stride, volume 0.2 at a third of the distances.
 report.crouch=await walkFor([6076,374.6,3556],Math.PI/2,6000,{crouch:true});console.log('crouch',JSON.stringify(report.crouch));
 assert.ok(report.crouch.steps>=1,'crouch steps');assert.equal(report.crouch.last.volume,0.2);assert.ok(Math.abs(report.crouch.last.max-9.99)<1e-6);
 // 3. Static island geometry (the hangar's steel stairs) has no SurfaceInfo: native default (gravel clips).
 report.stairs=await walkFor([6069.6,374.5,3564.4],Math.PI/2,2500);console.log('stairs',JSON.stringify(report.stairs));
 assert.ok(report.stairs.steps>=1);assert.match(report.stairs.last.clip,/^gravel/);
 // 4. Fall 15 m: FallDamage.FallImpact plays legBreakSound; the landing frame also steps.
 await page.evaluate(()=>window.explorerDev.teleport([6076,374.6,3556]));await page.waitForTimeout(400);await grounded();
 const beforeFall=await audio(),y=await page.evaluate(()=>window.explorerState.player.feet[1]);
 await page.evaluate(y=>window.explorerDev.teleport([6076,y+15,3556]),y);await page.waitForFunction(()=>window.explorerState.player.grounded,{},{timeout:8000});await page.waitForTimeout(300);
 const afterFall=await audio();report.fall={impacts:afterFall.fallImpacts-beforeFall.fallImpacts,landingStep:afterFall.localFootsteps-beforeFall.localFootsteps};console.log('fall',JSON.stringify(report.fall));
 assert.equal(report.fall.impacts,1);assert.ok(report.fall.landingStep>=1,'landing step');
 await page.evaluate(()=>window.explorerDev.respawn?.());await page.waitForTimeout(500);
 // 5. Wildlife: a boar near the player walks; its BoarFootstepTrait steps (hoofsteps) up to 6 per second.
 await page.evaluate(()=>window.explorerDev.teleport([6076,374.6,3556]));await page.waitForTimeout(400);
 const before5=await audio();await page.evaluate(()=>window.explorerDev.spawnAnimal('boar_prefab',6));
 await page.keyboard.down('KeyW');await page.waitForTimeout(1500);await page.keyboard.up('KeyW'); // footsteps scare it into running
 await page.waitForFunction(n=>window.explorerDev.worldAudio().animalFootsteps>n,before5.animalFootsteps,{timeout:20000});
 const after5=await audio();report.animal={steps:after5.animalFootsteps-before5.animalFootsteps};console.log('animal',JSON.stringify(report.animal));
 // 6. Ambience near a ForestAmbient emitter: day loop fades in; night crickets after the next 5 s check.
 await page.evaluate(()=>window.explorerDev.setTime(12));await page.evaluate(()=>window.explorerDev.teleport([5939.8,398.1,3348.8]));
 await page.waitForFunction(()=>{const a=window.explorerDev.worldAudio().ambient;return a.day===1&&a.playing.day===17;},{},{timeout:20000});
 report.day=(await audio()).ambient;
 await page.evaluate(()=>window.explorerDev.setTime(0));
 await page.waitForFunction(()=>{const a=window.explorerDev.worldAudio().ambient;return a.night===1&&a.playing.night===17&&a.playing.day===0;},{},{timeout:20000});
 report.night=(await audio()).ambient;console.log('ambient',JSON.stringify({day:report.day,night:report.night}));
 await page.evaluate(()=>window.explorerDev.setTime(12));
 // 7. MusicPlayer: the island track starts 3 + 20 s after audio starts and ramps to 0.4 * sound.music.
 await page.waitForFunction(()=>window.explorerDev.worldAudio().music.playing,{},{timeout:Math.max(5000,40000-(Date.now()-unlockedAt))});
 await page.waitForTimeout(3500);report.music=(await audio()).music;console.log('music',JSON.stringify(report.music));
 assert.equal(report.music.track,'Rust9-3_Drums3');assert.ok(Math.abs(report.music.volume-0.16)<1e-3);
 // 8. Volume plumbing: sound.volume drives the listener master gain, sound.music the music gain.
 await page.evaluate(()=>window.explorerDev.setVolume({master:0.5,music:0.2}));await page.waitForTimeout(300);
 report.volume=await page.evaluate(()=>window.explorerDev.volume());report.musicLowered=(await audio()).music.volume;
 await page.evaluate(()=>window.explorerDev.setVolume({master:1,music:0.4}));
 assert.ok(Math.abs(report.musicLowered-0.08)<1e-3,'music = targetVolume * sound.music: '+report.musicLowered);
 assert.ok(Math.abs(report.volume.listenerGain-0.5)<1e-3,'listener master gain '+report.volume.listenerGain);assert.equal(report.volume.music,0.2);
 const decoded=await page.evaluate(()=>window.explorerDev.audioDecoded());report.decoded=decoded.filter(a=>a.file.includes('/audio/'));
 assert.ok(report.decoded.length>=8&&report.decoded.every(a=>a.seconds>0&&a.channels>0),'original clips decode in Edge');
 await page.screenshot({path:`${out}/audio-final.png`});
 report.errors=errors;assert.deepEqual(errors,[]);
 await writeFile(`${out}/audio.json`,JSON.stringify(report,null,1));console.log('PASS check-audio',report.graphics.renderer);
} finally {await browser?.close();server.close();}
