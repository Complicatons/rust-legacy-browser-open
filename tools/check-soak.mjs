// Long single-player session soak: joins the offline island through the real MainMenu/ServerBrowser, then repeats a play
// cycle (walk, look, swing at trees, shoot a wolf with an M4, throw a grenade, open the inventory, travel to another
// area) for SOAK_MINUTES (default 20). Actions use real keyboard/mouse input; dev hooks only position the player and
// hand out items. Every cycle samples explorerDev.diagnostics() (GPU geometries/textures, shader programs, draw calls,
// scene nodes, physics bodies) plus CDP Performance metrics (DOM nodes, event listeners, JS heap after a forced GC) and
// the frame rate. Fails on page errors, unbounded growth after warm-up, or a large FPS drop.
// Results: analysis/browser-qa/soak/{samples.json,cycle-*.png}.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const minutes=Number(process.env.SOAK_MINUTES??20),out='analysis/browser-qa/soak/';await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...launchOptions(),args:[...launchOptions().args,'--enable-precise-memory-info']});
const errors=[],samples=[];let page;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dev=(fn,arg)=>page.evaluate(fn,arg);
try {
 page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',e=>errors.push('page: '+e.message));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push('console: '+m.text());});
 page.on('dialog',d=>{errors.push('dialog '+d.type());d.dismiss();});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('HeapProfiler.enable');
 await page.goto(origin+'/',{waitUntil:'load'});
 // Real entry: MainMenu -> Play -> Community -> the offline island.
 const fe=()=>page.evaluate(()=>window.rlbFrontEnd?.state()??null);
 const waitFe=async(ok,timeout=180000)=>{const t=Date.now();while(Date.now()-t<timeout){const s=await fe().catch(()=>null);if(s&&ok(s))return s;await wait(200);}throw Error('front end did not reach the expected state');};
 await waitFe(s=>s.menu);await page.locator('#front-end [data-df-name="btnPlay"]').click();
 await page.locator('#front-end [data-df-name="Community"]').click();await waitFe(s=>s.rows?.some(r=>r.address==='offline'));
 await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
 await page.waitForFunction(()=>window.explorerState?.walk&&!window.rlbFrontEnd?.state()?.loading,{},{timeout:240000});
 const graphics=await readGraphics(page);
 // Deaths are part of play (wolves bite back); record why, then use the original death screen's RESPAWN.
 // A death can land at any moment, including while a canvas click is waiting to be delivered (the death screen then
 // intercepts it), so every canvas click goes through lock(), which respawns first and retries when a death interrupts.
 const deaths=[],dead=()=>page.locator('#death').isVisible().catch(()=>false);
 const respawn=async()=>{if(!await dead())return false;deaths.push({at:Date.now(),reason:await page.locator('#death-reason').textContent().catch(()=>null),vitals:await dev(()=>window.explorerState.vitals)});
  await page.locator('#respawn').click({timeout:15000});await page.waitForFunction(()=>document.querySelector('#death')?.hidden!==false,{},{timeout:15000});await wait(1500);return true;};
 const lock=async()=>{for(let attempt=1;;attempt++){await respawn();
   try{await page.locator('#world').click({position:{x:640,y:360},timeout:5000});break;}
   catch(e){if(attempt>=6||!await dead())throw e;}}
  await page.waitForFunction(()=>Boolean(document.pointerLockElement),{},{timeout:5000}).catch(()=>{});};
 const alive=async()=>{if(await respawn())await lock();};
 const look=async(dx,dy)=>{await page.mouse.move(640,360);for(let i=0;i<10;i++)await page.mouse.move(640+dx*(i+1)/10,360+dy*(i+1)/10);};
 const metric=(list,name)=>list.find(m=>m.name===name)?.value??null;
 const sample=async(cycle,phase)=>{await cdp.send('HeapProfiler.collectGarbage');const d=await dev(()=>window.explorerDev.diagnostics()),{metrics}=await cdp.send('Performance.getMetrics');
  const s={cycle,phase,t:Date.now(),...d,heapAfterGc:metric(metrics,'JSHeapUsedSize'),domNodes:metric(metrics,'Nodes'),listeners:metric(metrics,'JSEventListeners'),documents:metric(metrics,'Documents'),layoutObjects:metric(metrics,'LayoutObjects'),deaths:deaths.length};
  samples.push(s);return s;};
 await lock();let cycle=0;const started=Date.now();await sample(0,'start');
 while(Date.now()-started<minutes*60000){cycle++;
  await alive();
  // Walk and look around (real keys and mouse).
  await page.keyboard.down('KeyW');await look(200,0);await wait(1500);await page.keyboard.down('ShiftLeft');await wait(1000);await page.keyboard.up('ShiftLeft');await page.keyboard.up('KeyW');await look(-150,40);
  await page.keyboard.press('Space');await wait(600);
  // Gather: stand at the nearest tree, swing the Rock with real clicks.
  await page.keyboard.press('Digit1');await dev(()=>window.explorerDev.approachTree());await wait(400);
  for(let i=0;i<4;i++){await page.mouse.down();await wait(120);await page.mouse.up();await wait(900);}
  // Combat: a wolf, an M4 and real mouse fire; corpse, ragdoll, tracers, sounds. The M4 and its ammo are replaced
  // rather than stacked so a long run does not fill the inventory.
  await alive();if(cycle%2===1){await dev(()=>{const d=window.explorerDev;d.takeItem('M4');d.takeItem('556 Ammo');d.giveItem('M4',1);d.giveItem('556 Ammo',48);d.hold('M4');});await wait(1600);
   const wolf=await dev(()=>window.explorerDev.spawnAnimal('wolf_prefab',7));
   const wolfAlive=()=>dev(w=>{const a=window.explorerDev.animalAt(w);return Boolean(a&&!a.dead&&a.distance<40);},wolf);
   // Twelve bursts, then up to eight more while it still stands, so harness wolves do not pile up as live animals.
   for(let i=0;i<20&&(i<12||await wolfAlive());i++){await dev(w=>window.explorerDev.aimAtAnimal(w),wolf);await page.mouse.down();await wait(250);await page.mouse.up();await wait(150);}
   await page.keyboard.press('KeyR');await wait(3200);}
  // Explosion: an F1 grenade, held then thrown with a real mouse press.
  await alive();if(cycle%3===0){await dev(()=>{const d=window.explorerDev;d.giveItem('F1 Grenade',1);d.hold('F1 Grenade');});await wait(1200);await page.mouse.down();await wait(1600);await page.mouse.up();await wait(4500);}
  // Inventory open/close (real Tab).
  await alive();await page.keyboard.press('Tab');await wait(700);await page.keyboard.press('Tab');await wait(300);await lock();
  // Travel: another spawn point, which streams other trees, nodes, crates and wildlife.
  if(cycle%4===0){await dev(()=>window.explorerDev.walkAway(220+Math.random()*200));await wait(2500);}
  await alive();
  const d=await sample(cycle,'cycle');
  if(cycle%5===1)await page.screenshot({path:`${out}cycle-${String(cycle).padStart(3,'0')}.png`});
  console.log(`cycle ${cycle} ${((Date.now()-started)/60000).toFixed(1)} min geo ${d.geometries} tex ${d.textures} prog ${d.programs} calls ${d.drawCalls} nodes ${d.sceneNodes} bodies ${d.bodies} animals ${d.animalsAlive}+${d.animals-d.animalsAlive} dead (dev ${d.devAnimalsAlive}) nodes ${d.resourceNodes} corpses ${d.corpses} bags ${d.deathDrops} heap ${(d.heapAfterGc/1048576).toFixed(0)} MB dom ${d.domNodes} listeners ${d.listeners} deaths ${deaths.length} errors ${errors.length}`);}
 // FPS over the first and the last stretches of the run (frames per wall second between samples; every window includes
 // the same forced GC per sample, so early and late compare like with like).
 const fps=(a,b)=>(b.frames-a.frames)/((b.t-a.t)/1000);const s=samples.filter(x=>x.phase==='cycle');
 assert.ok(s.length>=5,'too few cycles to judge: '+s.length);
 const early=fps(s[1],s[3]),late=fps(s.at(-3),s.at(-1));
 const perCycleFps=s.slice(1).map((x,i)=>+fps(s[i],x).toFixed(1));
 // Physics bodies not explained by the spawner-driven populations or by expiring corpses, bags and dropped items.
 for(const x of samples)x.otherBodies=x.bodies-x.animals-x.resourceNodes-x.corpses-x.deathDrops-x.droppedItems-x.deployables;
 const warm=s[3],last=s.at(-1),keys=['geometries','textures','programs','sceneNodes','bodies','otherBodies','animals','animalsAlive','devAnimalsAlive','resourceNodes','corpses','deathDrops','droppedItems','deployables','heapAfterGc','domNodes','listeners','documents'];
 const growth=Object.fromEntries(keys.map(k=>[k,last[k]-warm[k]]));
 const peak=Object.fromEntries(keys.map(k=>[k,Math.max(...s.map(x=>x[k]))]));
 const summary={minutes,cycles:cycle,deaths,graphics,errors,early:+early.toFixed(1),late:+late.toFixed(1),perCycleFps,warm,last,growth,peak};
 await writeFile(out+'samples.json',JSON.stringify({summary,samples},null,1));console.log(JSON.stringify({...summary,warm:undefined,last:undefined},null,1));
 assert.deepEqual(errors,[],'no page errors');
 // Resources can grow while new areas stream in, but not without bound: allow generous headroom over the warm-up sample.
 assert.ok(growth.programs<=Math.max(8,warm.programs*0.25),'shader programs keep compiling: '+growth.programs);
 assert.ok(growth.geometries<=Math.max(400,warm.geometries*0.5),'geometries keep growing: '+growth.geometries);
 assert.ok(growth.textures<=Math.max(60,warm.textures*0.3),'textures keep growing: '+growth.textures);
 assert.ok(growth.sceneNodes<=Math.max(3000,warm.sceneNodes*0.3),'scene nodes keep growing: '+growth.sceneNodes);
 // Wildlife and resource nodes fill towards the GenericSpawner targetPopulation sums over 60-900 s thinkDelays (as on the
 // original server), so their bodies may grow for the whole run but never past the targets; every other body must stay flat.
 assert.ok(s.every(x=>x.animalsAlive-x.devAnimalsAlive<=x.spawnTargets.animals),'wildlife above the spawner targets: '+peak.animalsAlive+' > '+last.spawnTargets.animals);
 assert.ok(s.every(x=>x.resourceNodes<=x.spawnTargets.nodes),'resource nodes above the spawner targets: '+peak.resourceNodes+' > '+last.spawnTargets.nodes);
 assert.ok(growth.otherBodies<=Math.max(60,warm.otherBodies*0.2),'physics bodies keep growing: '+growth.otherBodies);
 assert.ok(growth.heapAfterGc<=Math.max(64*1048576,warm.heapAfterGc*0.3),'JS heap keeps growing after GC: '+(growth.heapAfterGc/1048576).toFixed(1)+' MB');
 assert.ok(growth.domNodes<=Math.max(1500,warm.domNodes*0.3),'DOM nodes keep growing: '+growth.domNodes);
 assert.ok(growth.listeners<=Math.max(300,warm.listeners*0.3),'event listeners keep growing: '+growth.listeners);
 assert.ok(late>=early*0.7,`frame rate fell from ${early} to ${late}`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
