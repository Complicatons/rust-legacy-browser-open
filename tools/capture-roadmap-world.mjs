// Roadmap pictures for the 2026-10-21 world/menu round, captured from our port (GPU, ?dev with the dev header and panel
// hidden; the game HUD stays). Writes analysis/browser-qa/roadmap-world/*.png. Usage: node tools/capture-roadmap-world.mjs [shot…]
//   rock-top    standing on top of a RockSpawn rock (solid since this round), looking down its side
//   rock-face   walked up against a rock face, stopped by its collider
//   rock-buried walked into rock 7385, whose buried base the motor used to drop through (stops at the face)
//   rock-formation walked up onto rock 422's overlapping formation (standing on a rock used to stop the frame loop)
//   rock-slide  walked diagonally into rock 2954 and slid along its face (the swept side pass)
//   rpos-craft  the inventory open while crafting Wood Planks (the Craft click taps, crafting starts with craft_start)
//   animals     a stag and a boar walking near the player (clips loaded from the float32 clip pack)
//   island-view high view over the island (terrain normal map and rock colour/normal maps from the lossless WebP copies)
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,readFile} from 'node:fs/promises';
import {Vector3,Ray} from 'three';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {CollisionWorld} from '../browser/collision.mjs';
import {loadRockColliders} from '../browser/rock-colliders.mjs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';
const out='analysis/browser-qa/roadmap-world/';await mkdir(out,{recursive:true});
const only=process.argv.slice(2);
const rec='browser/assets/recovered/',rm=JSON.parse(await readFile(rec+'rockspawn/manifest.json','utf8')),tm=JSON.parse(await readFile(rec+'manifest.json','utf8')),hb=await readFile(rec+tm.heightFile);
const heights=new Float32Array(hb.buffer,hb.byteOffset,hb.byteLength/4),ground=(x,z)=>sampleTriangle(heights,tm.size,...worldToGrid(x,z,tm.extent,tm.size-1));
const [rocks]=await loadRockColliders(rm,async(d,T)=>{const b=await readFile(rec+'rockspawn/'+d.file);return new T(b.buffer,b.byteOffset,b.byteLength/T.BYTES_PER_ELEMENT);});
const world=new CollisionWorld(ground);world.addBody(rocks);world.build();
// A big rock above sea level with a flat-ish top at least 4 m above the ground beside it.
function rockTop(){for(let i=0;i<rocks.count;i+=13){const b=rocks.instanceBounds(i),c=b.getCenter(new Vector3()),g=ground(c.x,c.z);if(g<262||b.max.y-g<6||b.max.x-b.min.x<12)continue;
  const s=world.support(c.x,c.z,b.max.y+2,g);if(!s||s.height<g+4||s.normal.y<0.85)continue;return {feet:[c.x,s.height+0.2,c.z],ground:g,top:s.height,i};}return null;}
function rockFace(){for(let i=0;i<rocks.count;i+=37){const b=rocks.instanceBounds(i),c=b.getCenter(new Vector3());if(b.max.y<ground(c.x,c.z)+5||ground(c.x,c.z)<262)continue;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const sx=c.x+dx*((b.max.x-b.min.x)/2+8),sz=c.z+dz*((b.max.z-b.min.z)/2+8),g=ground(sx,sz);
   if(Math.abs(ground(sx+2,sz)-g)>0.6||Math.abs(ground(sx,sz+2)-g)>0.6||world.overlaps(new Vector3(sx,g+0.05,sz),2.08,0.45))continue;
   const hit=world.rayHit(new Ray(new Vector3(sx,g+1.5,sz),new Vector3(-dx,0,-dz)),12);if(hit&&hit.distance>4&&hit.distance<10)return {start:[sx,g+0.3,sz],yaw:Math.atan2(dx,dz)};}}return null;}
const server=createServer();await listenServer(server);
const browser=await chromium.launch(launchOptions());
try{
 const page=await browser.newPage({viewport:{width:1600,height:900}});
 await page.goto(`http://127.0.0.1:${server.address().port}/?dev`,{waitUntil:'load'});
 await page.waitForFunction(()=>window.explorerState?.ready&&window.explorerState.frames>5,{},{timeout:300000});
 console.log((await readGraphics(page)).renderer);
 // The page CSP blocks style tags; CSSOM changes are allowed.
 await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none';});
 await page.evaluate(()=>document.querySelector('#mode').click());await page.waitForFunction(()=>window.explorerState.walk);
 await page.evaluate(()=>{const d=window.explorerDev;d.setTime?.(13);d.clearHostiles?.();});
 const settle=()=>page.waitForTimeout(2500);
 const shots={
  async 'rock-top'(){const t=rockTop();if(!t)throw Error('no rock top');console.log('rock-top',JSON.stringify(t));
   await page.evaluate(([p])=>{const d=window.explorerDev;d.teleport(p);d.face(0.9,-0.55);},[t.feet]);await settle();
   const s=await page.evaluate(()=>({feet:window.explorerState.player.feet,grounded:window.explorerState.player.grounded}));console.log(' stands at',JSON.stringify(s),'ground below',t.ground.toFixed(1));
   if(!(s.feet[1]>t.ground+3))throw Error('fell through the rock');await page.screenshot({path:out+'rock-top.png'});},
  async 'rock-face'(){const t=rockFace();if(!t)throw Error('no rock face');await page.evaluate(([p,y])=>{const d=window.explorerDev;d.teleport(p);d.face(y,0.12);},[t.start,t.yaw]);await page.waitForTimeout(600);
   const f0=await page.evaluate(()=>[window.explorerState.player.feet,window.explorerState.frames]);
   await page.keyboard.down('KeyW');await page.waitForTimeout(3500);await page.keyboard.up('KeyW');await page.evaluate(y=>window.explorerDev.face(y,0.25),t.yaw);await settle();
   console.log(' walked',JSON.stringify(f0),JSON.stringify(await page.evaluate(()=>[window.explorerState.player.feet,window.explorerState.frames])));await page.screenshot({path:out+'rock-face.png'});},
 async 'island-view'(){await page.evaluate(()=>window.explorerDev.flyTo([5600,620,5400],[4600,350,4200]));await page.waitForTimeout(5000);
   const t=await page.evaluate(()=>window.explorerDev.textures?.());console.log(' textures',JSON.stringify(t));await page.screenshot({path:out+'island-view.png'});},
 async 'rpos-craft'(){await page.evaluate(()=>{const d=window.explorerDev;d.teleport([5688,317,5148]);d.face(-1.2,0.05);d.giveItem('Wood',60);});await settle();
   await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await page.locator('#blueprint-list [data-blueprint]').filter({hasText:'Wood Planks'}).first().click();
   await page.locator('#craft').click();await page.waitForTimeout(1500);console.log(' sounds',JSON.stringify(await page.evaluate(()=>window.explorerDev.rposSounds())));await page.screenshot({path:out+'rpos-craft.png'});await page.keyboard.press('Tab');},
 async animals(){await page.evaluate(()=>{const d=window.explorerDev;d.clearHostiles?.(500);d.teleport([5688,317,5148]);d.face(-1.2,-0.08);});await settle();
   await page.evaluate(()=>{const d=window.explorerDev,f=window.explorerState.player.feet,yaw=-1.2,dx=-Math.sin(yaw),dz=-Math.cos(yaw);
    d.spawnAnimalAt('stag_prefab',[f[0]+dx*9-dz*2,f[1],f[2]+dz*9+dx*2]);d.spawnAnimalAt('boar_prefab',[f[0]+dx*7+dz*2.5,f[1],f[2]+dz*7-dx*2.5]);});
   await page.waitForTimeout(2500);await page.screenshot({path:out+'animals.png'});},
  // RockSpawn instances whose walk-ins went wrong before the motor fixes (tests/rock-colliders.test.mjs).
  async 'rock-buried'(){await page.evaluate(()=>{const d=window.explorerDev;d.teleport([5286.76,374.2,4651.99]);d.face(Math.PI,0.05);});await page.waitForTimeout(600);
   await page.keyboard.down('KeyW');await page.waitForTimeout(5000);await page.keyboard.up('KeyW');await page.evaluate(()=>window.explorerDev.face(Math.PI-0.5,0.1));await settle();
   const f=await page.evaluate(()=>window.explorerState.player.feet);console.log(' stopped at',JSON.stringify(f));const c=rocks.instanceBounds(7385).getCenter(new Vector3()),face=world.rayHit(new Ray(new Vector3(f[0],f[1]+1,f[2]),new Vector3(c.x-f[0],0,c.z-f[2]).normalize()),60);
   console.log(' rock face ahead at',face?.distance.toFixed(2));if(!(face&&face.distance<1.2))throw Error('not stopped outside rock 7385');await page.screenshot({path:out+'rock-buried.png'});},
  async 'rock-formation'(){await page.evaluate(()=>{const d=window.explorerDev;d.teleport([5225.58,477.9,1772.26]);d.face(0,0.05);});await page.waitForTimeout(600);
   await page.keyboard.down('KeyW');await page.waitForTimeout(6000);await page.keyboard.up('KeyW');await page.evaluate(()=>window.explorerDev.face(Math.PI-0.3,-0.3));await settle();
   const s=await page.evaluate(()=>({feet:window.explorerState.player.feet,frames:window.explorerState.frames}));await page.waitForTimeout(500);
   const later=await page.evaluate(()=>window.explorerState.frames);console.log(' on the rock',JSON.stringify(s),'frames still running',later>s.frames);if(!(later>s.frames))throw Error('frame loop stopped');
   await page.screenshot({path:out+'rock-formation.png'});},
  // The swept side pass: walking diagonally into rock 2954's face, the player stops at it and slides along it.
  async 'rock-slide'(){const start=[6016.404,395.12,2434.162];await page.evaluate(([p])=>{const d=window.explorerDev;d.teleport(p);d.face(Math.PI/4,0.05);},[start]);await page.waitForTimeout(600);
   await page.keyboard.down('KeyW');await page.waitForTimeout(7000);await page.keyboard.up('KeyW');await page.evaluate(()=>window.explorerDev.face(Math.PI/4+0.9,0.05));await settle();
   const f=await page.evaluate(()=>window.explorerState.player.feet),walked=Math.hypot(f[0]-start[0],f[2]-start[2]);console.log(' slid to',JSON.stringify(f),'walked',walked.toFixed(1));
   if(!(walked>14))throw Error('stuck at rock 2954');await page.screenshot({path:out+'rock-slide.png'});},
 };
 for(const [name,fn] of Object.entries(shots))if(!only.length||only.includes(name)){await fn();console.log('captured',name);}
}finally{await browser.close();server.close();}
