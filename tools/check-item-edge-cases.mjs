// Item edge case E3, 2026-10-23 (GAP-AUDIT.md) on the real ?dev page, offline: a Holo sight Shift-dragged onto the held
// M4 in the belt re-activates it as the server's ItemModItem.TryCombine does (DeactivateItem, Invalidate,
// heldItem.OnBeltUse): a new view model playing its deploy animation with the sight on it, the M4's deploySound again,
// and WeaponItem.OnSetActive's deployLength lockout (1.4 s for the M4) before it can fire. Screenshots (dev header and
// panel hidden) in analysis/browser-qa/item-edge-cases/. Also: opening and closing RPOS with the gun out neither redraws
// it nor restarts the lockout (the held item stays active behind a window).
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';
const out='analysis/browser-qa/item-edge-cases/';await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);let browser;const report={};
try{browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 // The inventory keeps the Math.random it was built with; a wrapper lets the check roll the M4's mod slots (withModSlots:
 // floor(rng * (maxEligableSlots + 1))) to all five, without touching any other random choice.
 await page.addInitScript(()=>{const random=Math.random;Math.random=()=>window.__rlbForceRandom??random();});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev&fresh`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:120000});
 await page.locator('#respawn').evaluate(b=>b.click());await page.waitForFunction(()=>window.explorerState.walk);
 await page.keyboard.press('ShiftLeft');await page.waitForFunction(()=>window.explorerDev.audio().state==='running',{},{timeout:10000}).catch(()=>{});
 await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none';const d=window.explorerDev;d.setTime(11);d.teleport([5688,317,5148]);d.face(-1.2,0.02);});await page.waitForTimeout(1500);
 const given=await page.evaluate(()=>{const d=window.explorerDev;window.__rlbForceRandom=0.999;const gun=d.giveItem('M4',1);window.__rlbForceRandom=undefined;const sight=d.giveItem('Holo sight',1);const belt=d.hold('M4');return {gun,sight,belt};});
 report.given=given;assert.ok(given.belt>=30&&given.belt<=35,'M4 in the belt: '+JSON.stringify(given));assert.ok(given.sight.slot>=0&&given.sight.slot<30,'sight in the pack');
 const vm=()=>page.evaluate(()=>window.explorerDev.viewModel()),pres=()=>page.evaluate(()=>window.explorerDev.presentation()),weapon=()=>page.evaluate(()=>window.explorerDev.weapon());
 await page.waitForFunction(()=>window.explorerDev.viewModel()?.name==='VM-M4'&&window.explorerDev.presentation().lastDeploySound,{},{timeout:30000});
 report.firstDraw={vm:await vm(),sound:(await pres()).lastDeploySound};
 // Let the first draw finish and the deploy lockout run out.
 await page.waitForFunction(()=>window.explorerDev.weapon()?.next<=0,{},{timeout:15000});await page.waitForTimeout(1500);
 // Where the view model's bones rest once drawn (viewModel scene space); the deploy animation starts them well away from it.
 const pose=()=>page.evaluate(()=>{const m=window.explorerDev.viewModelDebug();return m?.[0]?[...m[0].bonesMin,...m[0].bonesMax]:null;}),off=(a,b)=>a&&b&&a.length===b.length?Math.max(...a.map((v,i)=>Math.abs(v-b[i]))):Infinity;
 report.settled={vm:await vm(),weapon:await weapon(),pose:await pose()};assert.deepEqual(report.settled.vm.mods,[]);
 {const again=await pose();report.restJitter=off(again,report.settled.pose);}
 await page.locator('#world').click({position:{x:640,y:360}});await page.waitForFunction(()=>Boolean(document.pointerLockElement),{},{timeout:10000}).catch(()=>{});
 // RPOS up and down again does not put the gun away (HumanController keeps calling ItemPreFrame with an empty sample):
 // no new deploySound, no new lockout, the view model stays at rest.
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await page.waitForTimeout(400);report.rposOpen={weapon:await weapon()};
 assert.ok(report.rposOpen.weapon&&report.rposOpen.weapon.next<=0,'the gun stays active with RPOS up: '+JSON.stringify(report.rposOpen));
 await page.keyboard.press('Tab');await page.waitForFunction(()=>!document.querySelector('#inventory').open);await page.waitForTimeout(400);
 report.rposClosed={weapon:await weapon(),sound:(await pres()).lastDeploySound,pose:off(await pose(),report.settled.pose)};
 assert.ok(report.rposClosed.weapon.next<=0,'closing RPOS restarts no deploy lockout: '+report.rposClosed.weapon.next);assert.equal(report.rposClosed.sound.time,report.firstDraw.sound.time,'no deploySound on closing RPOS');
 assert.ok(report.rposClosed.pose<0.05,'no draw on closing RPOS: '+report.rposClosed.pose);
 // RPOS up, Shift-drag the sight onto the belt M4 (RPOSInventoryCell: Shift = combine).
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');
 const from=await page.locator(`#pack [data-slot="${given.sight.slot}"]`).boundingBox(),to=await page.locator(`#belt [data-slot="${given.belt}"]`).boundingBox();assert.ok(from&&to);
 const soundBefore=report.firstDraw.sound.time;
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+from.width/2+8,from.y+from.height/2,{steps:2});
 await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:10});await page.keyboard.down('Shift');await page.mouse.up();await page.keyboard.up('Shift');
 // The same frame: a fresh deploy (new view model with the sight), the deploySound again, the lockout restarted.
 const redraw=await page.waitForFunction(t=>{const d=window.explorerDev,v=d.viewModel(),p=d.presentation(),w=d.weapon();return v&&v.mods.includes('VM-MOD-Holosight')&&p.lastDeploySound&&p.lastDeploySound.time>t&&w&&w.next>0&&{vm:v,sound:p.lastDeploySound,weapon:w};},soundBefore,{timeout:5000}).then(h=>h.jsonValue(),async e=>{await page.screenshot({path:out+'redraw-failed.png'});
  console.error(JSON.stringify({vm:await vm(),sound:(await pres()).lastDeploySound,weapon:await weapon(),before:soundBefore,given,errors}));throw e;});
 const drawPose=[await pose()];
 report.redraw=redraw;assert.equal(redraw.vm.name,'VM-M4');assert.equal(redraw.sound.item,report.firstDraw.sound.item);assert.equal(redraw.sound.file,report.firstDraw.sound.file,'the M4 deploySound again');
 assert.ok(redraw.weapon.next>1&&redraw.weapon.next<=1.4+0.05,'deployLength lockout restarted: '+redraw.weapon.next);
 assert.equal(await page.locator(`#pack [data-slot="${given.sight.slot}"] > img`).count(),0,'the sight is used up');
 // RPOS down at once; the trigger does nothing while the lockout runs.
 await page.keyboard.press('Tab');await page.waitForFunction(()=>!document.querySelector('#inventory').open);drawPose.push(await pose());
 const clip0=(await weapon()).clip;await page.evaluate(()=>window.explorerDev.trigger(10));await page.waitForTimeout(120);const locked=await weapon();report.locked=locked;
 assert.equal(locked.clip,clip0,'no shot during the deploy lockout');assert.ok(locked.next>0,'still in the lockout: '+locked.next);
 await page.screenshot({path:out+'m4-holo-drawing.png'});
 // The new view model played its draw: the bones were away from the rest pose, and they come back to it.
 report.drawOffset=Math.max(...drawPose.map(p=>off(p,report.settled.pose)));
 assert.ok(report.drawOffset>0.05&&report.drawOffset>report.restJitter*5,'the draw animation plays again: '+JSON.stringify({draw:report.drawOffset,rest:report.restJitter}));
 await page.waitForFunction(()=>window.explorerDev.weapon()?.next<=0,{},{timeout:5000});
 await page.waitForTimeout(800);report.backAtRest=off(await pose(),report.settled.pose);assert.ok(report.backAtRest<0.05,'drawn again: '+report.backAtRest);await page.screenshot({path:out+'m4-holo-redrawn.png'});
 await page.evaluate(()=>window.explorerDev.trigger(60));await page.waitForFunction(c=>window.explorerDev.weapon()?.clip<c,clip0,{timeout:3000});report.firedClip=(await weapon()).clip;
 report.errors=errors;assert.deepEqual(errors,[]);
 await writeFile(out+'results.json',JSON.stringify(report,null,1));console.log(JSON.stringify(report,null,1));
}finally{await browser?.close();server.close();}
