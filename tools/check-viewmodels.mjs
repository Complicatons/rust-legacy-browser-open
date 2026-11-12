// Focused Edge check for the original first-person viewmodels: each held item shows its viewmodel, plays deploy,
// and fire/reload/aim drive the original clips and pose. Screenshots go to analysis/browser-qa/viewmodel-*.png.
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
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],glErrors=[];
 // WebGL rejects draws with console warnings, not errors (5aaafc7: "Mismatch between texture format and sampler type").
 const GL_ERROR=/GL_INVALID|INVALID_OPERATION|INVALID_ENUM|INVALID_VALUE|INVALID_FRAMEBUFFER|Mismatch between texture format|too many errors/i;
 await page.addInitScript(()=>{let state=0x517cc1b7;Math.random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(GL_ERROR.test(m.text()))glErrors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:60000}).catch(async e=>{console.log('LOAD FAIL',errors,await page.locator('#status').textContent());throw e;});
 await page.locator('#respawn').evaluate(b=>b.click());await page.waitForFunction(()=>window.explorerState.walk);await mkdir('analysis/browser-qa',{recursive:true});
 const results={},graphics=await readGraphics(page);
 // The default render quality (Fastest: no sun shadow map) must draw the view model. 5aaafc7: the view-model eye-shadow
 // sampler had no depth texture there, WebGL rejected every view-model draw and no held item showed; GPU checks ran at Good.
 const vmPixels=async(bytes)=>page.evaluate(async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);
  return [...g.getImageData(760,440,620,360).data];},bytes.toString('base64'));
 results.fastest={quality:await page.evaluate(()=>{const q=window.explorerDev.quality();return {index:q.index,name:q.name,shadows:q.shadows.type};})};
 assert.equal(results.fastest.quality.name,'Fastest','harness runs at the default render quality');
 await page.keyboard.press('Digit6');await page.waitForFunction(()=>!window.explorerDev.viewModel()?.name,{},{timeout:10000});await page.waitForTimeout(500);
 const emptyHands=await vmPixels(await page.screenshot());const glBefore=glErrors.length;
 for(const name of ['Rock','Hatchet','M4','Hunting Bow','Torch','Revolver']){
  await page.evaluate(n=>{const d=window.explorerDev;d.giveItem(n,1);if(n==='M4')d.giveItem('556 Ammo',60);if(n==='Hunting Bow')d.giveItem('Arrow',5);d.hold(n);},name);
  await page.waitForFunction(n=>window.explorerDev.viewModel()?.name&&window.explorerDev.weapon?.()!==undefined,name,{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(1800);const deployed=await page.evaluate(()=>window.explorerDev.viewModel());
  await page.screenshot({path:`analysis/browser-qa/viewmodel-${name.replace(/\s+/g,'-').toLowerCase()}.png`});
  results[name]={deployed};
  if(name==='Rock'){const held=await vmPixels(await page.screenshot());let diff=0;for(let i=0;i<held.length;i+=4)diff+=(Math.abs(held[i]-emptyHands[i])+Math.abs(held[i+1]-emptyHands[i+1])+Math.abs(held[i+2]-emptyHands[i+2]))/3;
   results.fastest.rockPixelDiff=+(diff/(held.length/4)).toFixed(2);results.fastest.glErrors=glErrors.slice(glBefore);
   assert.deepEqual(results.fastest.glErrors,[],'no rejected draws at Fastest');assert.ok(results.fastest.rockPixelDiff>25,'held Rock drawn at Fastest: '+results.fastest.rockPixelDiff);}
  if(name==='Torch'){
   await page.waitForFunction(()=>window.explorerDev.torch().particles>0,{},{timeout:10000});
   await page.evaluate(()=>window.explorerDev.setTime(22.5));await page.waitForTimeout(700);
   results.torch=await page.evaluate(()=>window.explorerDev.torch());assert.equal(results.torch.lit,true);assert.ok(results.torch.worldLight>0);
   await page.screenshot({path:'analysis/browser-qa/viewmodel-torch-night.png'});await page.evaluate(()=>window.explorerDev.setTime(12));
  }
  if(name==='Revolver'){const off=await page.evaluate(()=>window.explorerDev.torch());assert.equal(off.lit,false);assert.equal(off.particles,0);assert.equal(off.worldLight,0);results.torchHolstered=true;}
 }
 // P3-17: the held torch light follows the LightStylist "fire" LightStyleCurve (intensity only, ping-pong); its TorchFire AudioSource
 // crackles; "View Model/Particles/*" programs are ZTest Always. P3-18: the first-person flare's legacy particles; barrel aiming.
 await mkdir('analysis/browser-qa/fx',{recursive:true});
 await page.evaluate(()=>window.explorerDev.hold('Torch'));await page.waitForFunction(()=>window.explorerDev.fxState().held?.kind==='stylist',{},{timeout:15000});
 {const samples=[];for(let i=0;i<10;i++){samples.push((await page.evaluate(()=>window.explorerDev.fxState())).held.intensity);await page.waitForTimeout(70);}
  const st=await page.evaluate(()=>window.explorerDev.fxState());results.torchStyle={samples,held:st.held};
  // The curve's Hermite tangents overshoot its keys: it spans .749 .. 1.123 (tests/fx-port.test.mjs).
  assert.ok(samples.every(v=>v>=0.749&&v<=1.1227),samples.join());assert.ok(new Set(samples.map(v=>v.toFixed(4))).size>3,'fire curve animates');
  assert.ok(st.held.audioSource,'torch crackle AudioSource');assert.ok(st.held.effects.length===8&&st.held.effects.every(e=>e.depthTest===false));
  await page.evaluate(()=>window.explorerDev.setTime(22.5));await page.waitForTimeout(700);await page.screenshot({path:'analysis/browser-qa/fx/torch-night.png'});}
 await page.evaluate(()=>{const d=window.explorerDev;d.giveItem('Flare',1);d.hold('Flare');d.lightHeldFlare(true);});
 await page.waitForFunction(()=>{const h=window.explorerDev.fxState().held;return h?.name==='FlareLightLegacy1P'&&h.legacy.length===3&&h.legacy.every(e=>e.particles>0);},{},{timeout:15000});
 await page.waitForTimeout(900);results.flare=(await page.evaluate(()=>window.explorerDev.fxState())).held;assert.equal(results.flare.kind,'constant');assert.ok(results.flare.audioSource,'flare burn AudioSource');
 assert.ok(results.flare.legacy.find(e=>e.name==='Flare_smoke').world&&!results.flare.legacy.find(e=>e.name==='Flare_flash').world);
 await page.screenshot({path:'analysis/browser-qa/fx/flare-night.png'});await page.evaluate(()=>{window.explorerDev.lightHeldFlare(false);window.explorerDev.setTime(12);});
 await page.waitForFunction(()=>!window.explorerDev.fxState().held,{},{timeout:5000});
 // ViewModel.BarrelAim: looking at near ground bends the M4 hip pose more than looking at the sky (noHitPlane point).
 await page.evaluate(()=>window.explorerDev.hold('M4'));await page.waitForTimeout(1500);
 await page.evaluate(()=>window.explorerDev.face(0,0.6));await page.waitForTimeout(700);const sky=await page.evaluate(()=>window.explorerDev.viewModel());
 await page.evaluate(()=>window.explorerDev.face(0,-1.45));await page.waitForTimeout(700);const ground=await page.evaluate(()=>window.explorerDev.viewModel());
 results.barrel={sky:sky.barrel,ground:ground.barrel,skyPose:sky.barrelPose,groundPose:ground.barrelPose};await page.screenshot({path:'analysis/browser-qa/fx/m4-barrel-ground.png'});
 assert.ok(Number.isFinite(sky.barrel)&&Number.isFinite(ground.barrel)&&Math.abs(ground.barrel)>Math.abs(sky.barrel)*2,JSON.stringify(results.barrel));
 await page.evaluate(()=>window.explorerDev.face(0,-0.3));
 // Shared arrow presentation still applies damage in offline mode; online arrows never call local damage.
 await page.evaluate(()=>window.explorerDev.hold('Hunting Bow'));await page.waitForTimeout(1400);
 results.offlineBow=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),index=d.spawnAnimal('stag_prefab',3),before=d.animalAt(index);d.approachAnimal(index);await wait(700);d.trigger(2800);
  for(let i=0;i<128;i++){d.aimAtAnimal(index,true);await wait(25);}return {before,after:d.animalAt(index),shot:d.combat().lastShot};});
 assert.ok(results.offlineBow.after.dead||results.offlineBow.after.health<results.offlineBow.before.health,JSON.stringify(results.offlineBow));assert.equal(results.offlineBow.shot.arrow,true);
 // VM-Revolver's idle mixer (browser/animation-blender.mjs): after deploy the static idle_frame (layer 1) holds;
 // walking brings in the idle clip at full weight (move channel, 2.5x).
 await page.evaluate(()=>{const d=window.explorerDev;d.giveItem('Revolver',1);d.hold('Revolver');});await page.waitForFunction(()=>window.explorerDev.viewModel()?.name==='VM-Revolver',{},{timeout:10000});
 await page.waitForTimeout(3200);results.revolverIdle=await page.evaluate(()=>window.explorerDev.viewModel());
 assert.deepEqual(results.revolverIdle.idleWeights,{idle_frame:1},JSON.stringify(results.revolverIdle));await page.screenshot({path:'analysis/browser-qa/viewmodel-revolver-idle-frame.png'});
 await page.keyboard.down('KeyW');await page.waitForTimeout(1800);results.revolverWalk=await page.evaluate(()=>window.explorerDev.viewModel());await page.screenshot({path:'analysis/browser-qa/viewmodel-revolver-walk.png'});await page.keyboard.up('KeyW');
 assert.ok(results.revolverWalk.idleWeights.idle>0.99,JSON.stringify(results.revolverWalk.idleWeights));
 // M4: fire, aim-down-sights and reload drive the original clips and zoom.
 await page.evaluate(()=>window.explorerDev.hold('M4'));await page.waitForTimeout(1800);
 results.sway=await page.evaluate(async()=>{const d=window.explorerDev,wait=ms=>new Promise(r=>setTimeout(r,ms)),p=window.explorerState.position;
  d.aimPoint([p[0],p[1],p[2]-100]);await wait(150);d.aimPoint([p[0]+50,p[1]+10,p[2]-100]);const eye=d.cameraSway().eye;await wait(150);
  return {eye,after:d.cameraSway()};});
 assert.ok(results.sway.after.allowed);assert.ok(results.sway.after.angle>0.9&&results.sway.after.angle<1.01,JSON.stringify(results.sway));
 assert.ok(results.sway.eye.every((v,i)=>Math.abs(v-results.sway.after.eye[i])<1e-6),'render restores true aim');
 await page.screenshot({path:'analysis/browser-qa/viewmodel-m4-sway.png'});
 await page.evaluate(()=>window.explorerDev.trigger(60));await page.waitForFunction(()=>window.explorerDev.muzzleFlashes().particles>0);results.muzzle=await page.evaluate(()=>window.explorerDev.muzzleFlashes());await page.screenshot({path:'analysis/browser-qa/viewmodel-m4-flash.png'});await page.waitForTimeout(120);results.m4Fire=await page.evaluate(()=>window.explorerDev.viewModel());
 await page.waitForFunction(()=>window.explorerDev.muzzleFlashes().active===0,{},{timeout:5000});assert.equal(await page.evaluate(()=>window.explorerDev.muzzleFlashes().viewLight),0);
 await page.mouse.move(720,450);await page.mouse.down({button:'right'});await page.waitForTimeout(900);results.m4Aim={vm:await page.evaluate(()=>window.explorerDev.viewModel()),fov:await page.evaluate(()=>window.explorerState.fov??null)};
 results.aimSway=await page.evaluate(()=>window.explorerDev.cameraSway());assert.equal(results.aimSway.allowed,false);assert.ok(results.aimSway.angle<0.001);
 await page.screenshot({path:'analysis/browser-qa/viewmodel-m4-aim.png'});await page.mouse.up({button:'right'});
 await page.evaluate(()=>window.explorerDev.reload(200));await page.waitForTimeout(300);results.m4Reload=await page.evaluate(()=>window.explorerDev.viewModel());
 await page.waitForFunction(()=>window.explorerDev.weapon().next<0,{},{timeout:10000});
 assert.equal(await page.evaluate(()=>window.explorerDev.setItemMods(['Holo sight','Silencer'])),true);await page.waitForTimeout(300);
 await page.mouse.down({button:'right'});await page.waitForTimeout(900);results.attachments=await page.evaluate(()=>({vm:window.explorerDev.viewModel(),flash:window.explorerDev.muzzleFlashes().count}));
 assert.deepEqual(results.attachments.vm.mods,['VM-MOD-Holosight','VM-MOD-Silencer']);assert.ok(Math.abs(results.attachments.vm.zoomOffsetZ-0.2)<1e-6);assert.ok(Math.abs(results.attachments.vm.punchScalar-0.6)<1e-6);
 await page.screenshot({path:'analysis/browser-qa/viewmodel-m4-holo-silencer.png'});await page.evaluate(()=>window.explorerDev.trigger(60));await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.explorerDev.muzzleFlashes().count),results.attachments.flash,'silenced bullet gun creates no flash');await page.mouse.up({button:'right'});
 await page.evaluate(()=>window.explorerDev.setItemMods([]));await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>window.explorerDev.viewModel().mods),[]);
 await page.evaluate(()=>{window.explorerDev.setItemMods(['Holo sight','Silencer','Flashlight Mod','Laser Sight']);window.explorerDev.setTime(22);const p=window.explorerState.position;window.explorerDev.aimPoint([p[0],p[1]-3,p[2]-12]);});
 await page.waitForFunction(()=>window.explorerDev.weaponMods()?.lights===1&&window.explorerDev.weaponMods()?.lasers===1);await page.waitForTimeout(250);results.modEffects=await page.evaluate(()=>window.explorerDev.weaponMods());const lit=await page.screenshot({path:'analysis/browser-qa/viewmodel-mod-lights-night.png'});
 await page.keyboard.press('f');await page.keyboard.press('g');await page.waitForFunction(()=>window.explorerDev.weaponMods().lights===0&&window.explorerDev.weaponMods().lasers===0);
 await page.waitForTimeout(250);const unlit=await page.screenshot({path:'analysis/browser-qa/viewmodel-mod-lights-off.png'});
 const brightness=async bytes=>page.evaluate(async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const c=canvas.getContext('2d');c.drawImage(img,0,0);const d=c.getImageData(550,250,550,350).data;let sum=0;for(let i=0;i<d.length;i+=4)sum+=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];return sum/(d.length/4);},bytes.toString('base64'));
 results.modBrightness={on:await brightness(lit),off:await brightness(unlit)};assert.ok(results.modBrightness.on>results.modBrightness.off*1.3,JSON.stringify(results.modBrightness));
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await page.keyboard.press('f');await page.keyboard.press('g');assert.equal(await page.evaluate(()=>window.explorerDev.weaponMods().lights),0,'inventory blocks attachment toggles');await page.locator('#inventory-close').click();
 await page.keyboard.press('f');await page.keyboard.press('g');await page.waitForFunction(()=>window.explorerDev.weaponMods().lights===1&&window.explorerDev.weaponMods().lasers===1);
 await page.evaluate(()=>window.explorerDev.hold('Rock'));await page.waitForFunction(()=>window.explorerDev.weaponMods().effects.length===0);await page.evaluate(()=>window.explorerDev.setTime(12));
 console.log(JSON.stringify({graphics,results,errors,glErrors},null,1));await writeFile('analysis/browser-qa/viewmodels.json',JSON.stringify({graphics,results,errors,glErrors},null,1));
 assert.deepEqual(errors,[]);assert.deepEqual(glErrors,[]);
 for(const n of ['Rock','Hatchet','M4','Hunting Bow','Torch','Revolver'])assert.ok(results[n].deployed?.name,n);
 assert.equal(results.m4Fire.clip,'fire_1');assert.ok(results.m4Aim.vm.zoomTime>0);assert.equal(results.m4Reload.clip,'reload');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
