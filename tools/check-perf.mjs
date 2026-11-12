// Performance measurement: load time, transfer, memory and per-viewpoint frame cost of the offline island.
// Frame rate is uncapped (no vsync), and every animation-frame callback is timed in the page: CPU ms is the main-thread
// time spent inside requestAnimationFrame callbacks (simulation + WebGL command submission), GPU ms comes from
// EXT_disjoint_timer_query_webgl2 around the same callbacks when the browser exposes it. Viewpoints are fixed spots
// (town, forest, meadow, coast, high view) at Fastest (the default) and Good render quality.
//   REQUIRE_GPU=1 node tools/check-perf.mjs             real GPU (fails on software rendering)
//   BROWSER_SOFTWARE=1 node tools/check-perf.mjs        SwiftShader: a CPU-only proxy for weak integrated graphics
//   PERF_OUT=analysis/perf/<name>.json                  where to write the result (default analysis/perf/latest.json)
//   PERF_QUALITY=0,2  PERF_FRAMES=240  PERF_VIEWS=town,forest
// Prints one table; nothing is asserted except a working load and no page errors, so it can compare before/after.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {readFile} from 'node:fs/promises';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';

const OUT=process.env.PERF_OUT??'analysis/perf/latest.json';
const QUALITIES=(process.env.PERF_QUALITY??'0,2').split(',').map(Number);
const FRAMES=Number(process.env.PERF_FRAMES??(process.env.BROWSER_SOFTWARE==='1'?40:240));
// Browser coordinates (x, z; Unity z negated). yaw/pitch in radians as explorerDev.face takes them.
const VIEWS=[
 {name:'town',at:[5211,4808],yaw:0.6,pitch:-0.05},       // warehouse compound (check-browser start area)
 {name:'forest',at:[6950,3850],yaw:2.2,pitch:0},         // densest 100 m tree cell on the island
 {name:'meadow',at:[5688,5148],yaw:-1.2,pitch:0.02},     // open ground used by the build tests
 {name:'coast',at:[4366,6062],yaw:3.1,pitch:-0.02},      // rock-lined shore looking out to sea
 {name:'high',fly:[[5600,620,5400],[4600,350,4200]]},     // high view across the island (most trees/impostors)
].filter(v=>!process.env.PERF_VIEWS||process.env.PERF_VIEWS.split(',').includes(v.name));

// Page-side frame timer, installed before any page script runs.
function frameTimer(){
 const raf=window.requestAnimationFrame.bind(window),state=window.__perf={frames:[],recording:false,gl:null,ext:null,pending:[],gpu:[]};
 const glOf=()=>{if(state.gl!==null)return state.gl;const c=document.querySelector('#world');if(!c)return null;const gl=c.getContext('webgl2');state.gl=gl||false;state.ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2')??null;return state.gl;};
 let open=null,frameCpu=0,lastStamp=null;
 window.requestAnimationFrame=cb=>raf(stamp=>{
  if(state.recording&&stamp!==lastStamp){if(lastStamp!==null)state.frames.push({dt:stamp-lastStamp,cpu:frameCpu});frameCpu=0;lastStamp=stamp;
   const gl=glOf(),ext=state.ext;
   // One GPU query per frame: closed at the start of the next frame (all of the previous frame's callbacks inside it).
   if(gl&&ext){if(open){gl.endQuery(ext.TIME_ELAPSED_EXT);state.pending.push(open);open=null;}
    for(let i=state.pending.length-1;i>=0;i--){const q=state.pending[i];if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT))state.gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);state.pending.splice(i,1);}}
    open=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,open);}}
  if(!state.recording&&open&&state.gl){state.gl.endQuery(state.ext.TIME_ELAPSED_EXT);state.gl.deleteQuery(open);open=null;lastStamp=null;}
  const t0=performance.now();try{cb(stamp);}finally{frameCpu+=performance.now()-t0;}
 });
}

// Terrain height under a viewpoint, from the recovered heightmap (the same sampling the game's ground uses).
const terrain=JSON.parse(await readFile('browser/assets/recovered/manifest.json','utf8')),heightBytes=await readFile('browser/assets/recovered/'+terrain.heightFile);
const heights=new Float32Array(heightBytes.buffer,heightBytes.byteOffset,heightBytes.byteLength/4);
const groundAt=(x,z)=>sampleTriangle(heights,terrain.size,...worldToGrid(x,z,terrain.extent,terrain.size-1));
const stats=values=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];
 return {mean:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2),p50:+q(0.5).toFixed(2),p95:+q(0.95).toFixed(2),max:+s[s.length-1].toFixed(2)};};

const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
const base=launchOptions();
const browser=await chromium.launch({...base,args:[...base.args,'--disable-gpu-vsync','--disable-frame-rate-limit','--enable-precise-memory-info']});
const errors=[],result={date:new Date().toISOString(),software:process.env.BROWSER_SOFTWARE==='1',frames:FRAMES,load:{},views:[]};
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});await page.context().addInitScript(frameTimer);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text());});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Network.enable');
 let bytes=0,requests=0;const urls=new Map(),byKind={},files=[];cdp.on('Network.responseReceived',e=>urls.set(e.requestId,e.response.url));
 cdp.on('Network.loadingFinished',e=>{bytes+=e.encodedDataLength;requests++;const u=new URL(urls.get(e.requestId)??'http://x/?'),ext=(u.pathname.match(/\.[a-z0-9]+$/i)?.[0]??'(none)').toLowerCase(),dir=u.pathname.split('/').slice(0,4).join('/'),k=dir.includes('/recovered/')&&dir.split('/').length>3&&!/\./.test(dir.split('/')[3])?dir:u.pathname.split('/').slice(0,3).join('/');
  files.push([u.pathname,e.encodedDataLength]);for(const key of ['ext '+ext,'dir '+k]){const v=byKind[key]??={mb:0,n:0};v.mb+=e.encodedDataLength/1048576;v.n++;}});
 const t0=Date.now();
 await page.goto(origin+'/?dev',{waitUntil:'load',timeout:600000});
 await page.waitForFunction(()=>window.explorerState?.ready||/Could not/.test(document.querySelector('#status')?.textContent??''),{},{timeout:900000,polling:250});
 assert.ok(await page.evaluate(()=>window.explorerState.ready),await page.evaluate(()=>document.querySelector('#status')?.textContent));
 result.load.readyMs=Date.now()-t0;
 await page.evaluate(()=>document.querySelector('#mode').click());await page.waitForFunction(()=>window.explorerState.walk,{},{timeout:120000});
 result.load.walkMs=Date.now()-t0;result.load.transferMB=+(bytes/1048576).toFixed(1);result.load.requests=requests;
 result.load.largest=files.sort((a,b)=>b[1]-a[1]).slice(0,40).map(([f,b])=>[f,+(b/1048576).toFixed(2)]);
 result.load.breakdown=Object.fromEntries(Object.entries(byKind).sort((a,b)=>b[1].mb-a[1].mb).map(([k,v])=>[k,{mb:+v.mb.toFixed(2),n:v.n}]));
 result.graphics=await readGraphics(page);
 await page.waitForTimeout(3000);
 await cdp.send('HeapProfiler.collectGarbage').catch(()=>{});
 const metric=async name=>(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name===name)?.value??null;
 result.load.heapMB=+((await metric('JSHeapUsedSize'))/1048576).toFixed(1);result.load.domNodes=await metric('Nodes');
 result.gpuTimer=await page.evaluate(()=>Boolean(document.querySelector('#world').getContext('webgl2').getExtension('EXT_disjoint_timer_query_webgl2')));
 for(const quality of QUALITIES){
  await page.evaluate(q=>window.explorerDev.setQuality(q),quality);
  for(const view of VIEWS){
   const spot=view.at?[view.at[0],groundAt(view.at[0],view.at[1])+1.5,view.at[1]]:null;
   await page.evaluate(([v,spot])=>{const d=window.explorerDev;d.clearHostiles?.();d.restoreVitals?.();d.setHealth?.(100);
    if(v.fly)d.flyTo(...v.fly);else{d.teleport(spot);d.face(v.yaw,v.pitch);}},[view,spot]);
   // Warm-up: streaming, impostor renders and shader compiles settle before recording.
   await page.waitForTimeout(view.fly?4000:3000);
   await page.evaluate(()=>{const p=window.__perf;p.frames.length=0;p.gpu.length=0;p.recording=true;});
   await page.waitForFunction(n=>window.__perf.frames.length>=n,FRAMES,{timeout:600000,polling:100});
   const r=await page.evaluate(()=>{const p=window.__perf;p.recording=false;const d=window.explorerDev.diagnostics();return {frames:p.frames.slice(),gpu:p.gpu.slice(),drawCalls:d.drawCalls,triangles:d.triangles,programs:d.programs,textures:d.textures,geometries:d.geometries};});
   const dt=stats(r.frames.map(f=>f.dt)),cpu=stats(r.frames.map(f=>f.cpu)),gpu=stats(r.gpu);
   const row={view:view.name,quality,fps:dt?+(1000/dt.mean).toFixed(1):null,frameMs:dt,cpuMs:cpu,gpuMs:gpu,drawCalls:r.drawCalls,triangles:r.triangles,programs:r.programs,textures:r.textures,geometries:r.geometries,hitches:r.frames.filter(f=>f.dt>50).length};
   result.views.push(row);
   console.log(`${view.name.padEnd(7)} q${quality}  ${String(row.fps).padStart(6)} fps  frame ${dt.mean}/${dt.p95} ms  cpu ${cpu.mean}/${cpu.p95} ms  gpu ${gpu?`${gpu.mean}/${gpu.p95}`:'n/a'} ms  ${row.drawCalls} draws  ${(row.triangles/1e6).toFixed(2)} M tris  hitches ${row.hitches}`);
  }
 }
 await cdp.send('HeapProfiler.collectGarbage').catch(()=>{});
 result.end={heapMB:+((await metric('JSHeapUsedSize'))/1048576).toFixed(1)};
 result.errors=errors;
 console.log(`load: ready ${result.load.readyMs} ms, in game ${result.load.walkMs} ms, ${result.load.transferMB} MB in ${result.load.requests} requests, heap ${result.load.heapMB} MB (end ${result.end.heapMB} MB); renderer ${result.graphics.renderer}; GPU timer ${result.gpuTimer}`);
 await mkdir(dirname(OUT),{recursive:true});await writeFile(OUT,JSON.stringify(result,null,1));
 assert.deepEqual(errors,[],'page errors');
}finally{await browser.close();server.close();}
