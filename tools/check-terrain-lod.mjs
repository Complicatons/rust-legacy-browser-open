// Terrain level of detail, before and after: the island is loaded twice in one headless Edge (one page at a time), once
// with browser/terrain-lod.mjs as it was at BEFORE (fixed distance rings) and once with the current file (Unity's
// heightmapPixelError rule). At each viewpoint (the check-perf spots, at noon) it records frame time (CPU inside the
// animation-frame callbacks, GPU from EXT_disjoint_timer_query_webgl2), the renderer's triangle count, the terrain's
// level distribution and terrain triangles, and a screenshot with the dev header and panel hidden. main.mjs is served
// with one extra line before its first frame that exposes the terrain (as tools/check-world-texels.mjs does).
//   node tools/check-terrain-lod.mjs                       TERRAIN_LOD_BEFORE=<git rev>  TERRAIN_LOD_FRAMES=240
//   TERRAIN_LOD_OUT=<dir>                                  screenshots + result.json (default analysis/browser-qa/terrain-lod)
// Asserts a working load, no page errors, and that the frame time did not get noticeably slower (mean within
// 10% + 0.5 ms of before at every view).
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';
import {CHUNK_CELLS,LOD_STEPS} from '../browser/terrain-lod.mjs';

const BEFORE=process.env.TERRAIN_LOD_BEFORE??'85de64b',FRAMES=Number(process.env.TERRAIN_LOD_FRAMES??240),OUT=process.env.TERRAIN_LOD_OUT??'analysis/browser-qa/terrain-lod';
const VIEWS=[
 {name:'town',at:[5211,4808],yaw:0.6,pitch:-0.05},
 {name:'forest',at:[6950,3850],yaw:2.2,pitch:0},
 {name:'meadow',at:[5688,5148],yaw:-1.2,pitch:0.02},
 {name:'coast',at:[4366,6062],yaw:3.1,pitch:-0.02},
 {name:'high',fly:[[5600,620,5400],[4600,350,4200]]},
];
const oldSource=execFileSync('git',['show',`${BEFORE}:browser/terrain-lod.mjs`],{encoding:'utf8'});
assert.ok(/LOD_DISTANCES/.test(oldSource),`${BEFORE}:browser/terrain-lod.mjs is not the distance-ring version`);

function frameTimer(){
 const raf=window.requestAnimationFrame.bind(window),state=window.__perf={frames:[],recording:false,gl:null,ext:null,pending:[],gpu:[]};
 const glOf=()=>{if(state.gl!==null)return state.gl;const c=document.querySelector('#world');if(!c)return null;const gl=c.getContext('webgl2');state.gl=gl||false;state.ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2')??null;return state.gl;};
 let open=null,frameCpu=0,lastStamp=null;
 window.requestAnimationFrame=cb=>raf(stamp=>{
  if(state.recording&&stamp!==lastStamp){if(lastStamp!==null)state.frames.push({dt:stamp-lastStamp,cpu:frameCpu});frameCpu=0;lastStamp=stamp;
   const gl=glOf(),ext=state.ext;
   if(gl&&ext){if(open){gl.endQuery(ext.TIME_ELAPSED_EXT);state.pending.push(open);open=null;}
    for(let i=state.pending.length-1;i>=0;i--){const q=state.pending[i];if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT))state.gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);state.pending.splice(i,1);}}
    open=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,open);}}
  if(!state.recording&&open&&state.gl){state.gl.endQuery(state.ext.TIME_ELAPSED_EXT);state.gl.deleteQuery(open);open=null;lastStamp=null;}
  const t0=performance.now();try{cb(stamp);}finally{frameCpu+=performance.now()-t0;}
 });
}
const terrain=JSON.parse(await readFile('browser/assets/recovered/manifest.json','utf8')),heightBytes=await readFile('browser/assets/recovered/'+terrain.heightFile);
const heights=new Float32Array(heightBytes.buffer,heightBytes.byteOffset,heightBytes.byteLength/4);
const groundAt=(x,z)=>sampleTriangle(heights,terrain.size,...worldToGrid(x,z,terrain.extent,terrain.size-1));
const stats=values=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];
 return {mean:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2),p50:+q(0.5).toFixed(2),p95:+q(0.95).toFixed(2)};};
const terrainTriangles=levels=>levels.reduce((a,n,l)=>a+n*2*(CHUNK_CELLS/LOD_STEPS[l])**2,0);

const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir(OUT,{recursive:true});
const base=launchOptions();
const browser=await chromium.launch({...base,args:[...base.args,'--disable-gpu-vsync','--disable-frame-rate-limit']});
const result={date:new Date().toISOString(),before:BEFORE,frames:FRAMES,modes:{}},errors=[];
try{
 for(const mode of ['before','after']){
  const page=await browser.newPage({viewport:{width:1280,height:720}});await page.context().addInitScript(frameTimer);
  page.on('pageerror',e=>errors.push(`${mode}: ${e.message}`));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(`${mode}: ${m.text()}`);});
  await page.route(/\/main\.mjs(\?|$)/,async route=>{const r=await route.fetch();const b=(await r.text()).replace(/\r?\n requestAnimationFrame\(animate\);\r?\n/,m=>'\n window.__terrainLOD=terrainLOD;'+m);route.fulfill({response:r,body:b});});
  if(mode==='before')await page.route(/\/terrain-lod\.mjs(\?|$)/,route=>route.fulfill({status:200,contentType:'text/javascript',body:oldSource}));
  await page.goto(origin+'/?dev',{waitUntil:'load',timeout:600000});
  await page.waitForFunction(()=>window.explorerState?.ready||/Could not/.test(document.querySelector('#status')?.textContent??''),{},{timeout:900000,polling:250});
  assert.ok(await page.evaluate(()=>window.explorerState.ready),await page.evaluate(()=>document.querySelector('#status')?.textContent));
  await page.evaluate(()=>document.querySelector('#mode').click());await page.waitForFunction(()=>window.explorerState.walk,{},{timeout:120000});
  const rows=result.modes[mode]={graphics:await readGraphics(page),views:[]};
  await page.evaluate(()=>window.explorerDev.setTime?.(12));
  for(const view of VIEWS){
   const spot=view.at?[view.at[0],groundAt(view.at[0],view.at[1])+1.5,view.at[1]]:null;
   await page.evaluate(([v,spot])=>{const d=window.explorerDev;d.clearHostiles?.();d.restoreVitals?.();d.setHealth?.(100);if(v.fly)d.flyTo(...v.fly);else{d.teleport(spot);d.face(v.yaw,v.pitch);}},[view,spot]);
   await page.waitForTimeout(view.fly?4000:3000);
   await page.evaluate(()=>{const p=window.__perf;p.frames.length=0;p.gpu.length=0;p.recording=true;});
   await page.waitForFunction(n=>window.__perf.frames.length>=n,FRAMES,{timeout:600000,polling:100});
   const r=await page.evaluate(()=>{const p=window.__perf;p.recording=false;const d=window.explorerDev.diagnostics();return {frames:p.frames.slice(),gpu:p.gpu.slice(),triangles:d.triangles,drawCalls:d.drawCalls,terrain:window.__terrainLOD.stats()};});
   const row={view:view.name,frameMs:stats(r.frames.map(f=>f.dt)),cpuMs:stats(r.frames.map(f=>f.cpu)),gpuMs:stats(r.gpu),triangles:r.triangles,drawCalls:r.drawCalls,terrainDrawn:r.terrain.drawn,terrainLevels:r.terrain.levels,terrainTriangles:terrainTriangles(r.terrain.levels)};
   rows.views.push(row);
   await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none';});await page.waitForTimeout(300);
   await page.screenshot({path:join(OUT,`${mode}-${view.name}.png`)});
   await page.evaluate(()=>{for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='';});
   console.log(`${mode.padEnd(6)} ${view.name.padEnd(7)} frame ${row.frameMs.mean}/${row.frameMs.p95} ms  cpu ${row.cpuMs.mean} ms  gpu ${row.gpuMs?`${row.gpuMs.mean}/${row.gpuMs.p95}`:'n/a'} ms  ${(row.triangles/1e6).toFixed(2)} M tris (terrain ${(row.terrainTriangles/1e6).toFixed(2)} M, levels ${row.terrainLevels.join('/')})`);
  }
  await page.close();
 }
 await writeFile(join(OUT,'result.json'),JSON.stringify(result,null,1));
 assert.deepEqual(errors,[],'page errors');
 for(const [i,after] of result.modes.after.views.entries()){const before=result.modes.before.views[i];
  assert.ok(after.frameMs.mean<=before.frameMs.mean*1.1+0.5,`${after.view}: frame ${after.frameMs.mean} ms after vs ${before.frameMs.mean} ms before`);}
 console.log('PASS check-terrain-lod: results in',join(OUT,'result.json'));
}finally{await browser.close();server.close();}
