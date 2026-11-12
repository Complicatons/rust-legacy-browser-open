// GPU check of the adaptive near plane (browser/adaptive-near-plane.mjs, CameraFX.PostPreCull): in the open the
// player camera's near plane is maxNear 0.65 m; walking up to a warehouse wall pulls it in (0.22..0.65 m); dev
// free-fly keeps 0.05 m. Screenshots: analysis/browser-qa/near-plane/.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const out='analysis/browser-qa/near-plane';await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);
let browser;
try {
 const options=launchOptions();options.args.push('--mute-audio');browser=await chromium.launch(options);
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.explorerState?.frames>5,{},{timeout:90000});
 const results={graphics:await readGraphics(page)},near=()=>page.evaluate(()=>window.explorerDev.nearPlane()),frames=n=>page.evaluate(n=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);}),n);
 results.fly=await near();assert.equal(results.fly.cameraNear,0.05,'dev free-fly keeps 0.05 m');
 await page.locator('#respawn').evaluate(b=>b.click());await page.waitForFunction(()=>window.explorerState.walk);
 await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none';const d=window.explorerDev;d.teleport([5688,317,5148]);d.face(-1.2,0.02);});await frames(30);
 results.open=await near();assert.equal(results.open.cameraNear,Math.fround(0.65),'open ground: maxNear');assert.equal(results.open.hits,0);
 // Warehouse yard (check-motor's spot): turn on the spot and keep the heading with the nearest hit.
 await page.evaluate(()=>window.explorerDev.teleport([6076,374.6,3556]));await frames(30);
 const scan=[];for(let i=0;i<24;i++){const yaw=i*Math.PI/12;await page.evaluate(yaw=>window.explorerDev.face(yaw,0),yaw);await frames(3);scan.push({yaw,...await near()});}
 results.scan=scan.map(s=>({yaw:+s.yaw.toFixed(3),near:+s.cameraNear.toFixed(4),hits:s.hits}));
 // Walk (real W key) from the warehouse stair top along a few headings until one ends pressed against a wall.
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2,Math.PI/4,3*Math.PI/4,-Math.PI/4,-3*Math.PI/4]){
  await page.evaluate(()=>window.explorerDev.teleport([6065.1,379.0,3568.8]));await frames(20);await page.evaluate(yaw=>window.explorerDev.face(yaw,0),yaw);
  await page.keyboard.down('KeyW');await page.waitForTimeout(2500);await page.keyboard.up('KeyW');await frames(10);results.wall=await near();results.wallYaw=yaw;if(results.wall.hits>0)break;}
 results.position=await page.evaluate(()=>window.explorerState.position);
 await page.screenshot({path:`${out}/wall.png`});
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,1));assert.ok(results.wall.hits>0,'grid rays hit the wall');assert.ok(results.wall.cameraNear<Math.fround(0.65)&&results.wall.cameraNear>=Math.fround(0.22),`near ${results.wall.cameraNear}`);
 // Cost per frame (64 short rays).
 const costs=[];for(let i=0;i<30;i++){await frames(1);costs.push((await near()).ms);}results.msMedian=costs.sort((a,b)=>a-b)[15];
 results.errors=errors;assert.deepEqual(errors,[]);
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,1));console.log(JSON.stringify({open:results.open,wall:results.wall,msMedian:results.msMedian,position:results.position},null,1));
} finally {await browser?.close();server.close();}
