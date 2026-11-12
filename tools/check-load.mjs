// Load-time measurement through the normal player entry (no ?dev): time to the original menu background, then time from
// choosing Rust Island (offline) in the ServerBrowser to being in the world, on a cold cache and again on a warm cache
// (same on-disk browser profile, page reloaded). The game is served by tools/serve.mjs's handler over plain HTTP/1.1, as
// central serves it on the Azure test VM, and CDP throttles the link to a remote server.
//   LOAD_RTT_MS=30 LOAD_MBPS=100 node tools/check-load.mjs      link to emulate (defaults; LOAD_MBPS=0 = unthrottled)
//   LOAD_RUNS=cold,warm  LOAD_OUT=analysis/perf/load.json
//   LOAD_MENU_MS=0       time spent in the menu before choosing the island (the world prefetch runs meanwhile)
//   LOAD_CPU=1           CPU profile of the join: top self time by script:function
//   LOAD_PROFILE=dir     with LOAD_CPU=1: also write each run's raw profile to <dir>/<run>.cpuprofile (DevTools can open it)
//   LOAD_TIMELINE=1      print when each loading message (#status / LoadingScreen text) first appears during the join
//   LOAD_SHOTS=dir       screenshots of the first run: <dir>/menu.png (background up) and <dir>/in-world.png
//   LOAD_WRITE_ORDER=1   write browser/load-order.json: the files the first run's join requests, in order (prefetch off)
// Prints one line per run; nothing is asserted except a working load with no page errors.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from './serve.mjs';
import {launchOptions,pointerLockStandIn} from './qa-browser.mjs';

const RTT=Number(process.env.LOAD_RTT_MS??30),MBPS=Number(process.env.LOAD_MBPS??100),RUNS=(process.env.LOAD_RUNS??'cold,warm').split(',');
const SHOTS=process.env.LOAD_SHOTS??null,OUT=process.env.LOAD_OUT??'analysis/perf/load.json',CPU=process.env.LOAD_CPU==='1',MENU_MS=Number(process.env.LOAD_MENU_MS??0),WRITE_ORDER=process.env.LOAD_WRITE_ORDER==='1';
const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
// A real on-disk profile: an incognito context's small memory cache keeps almost nothing of a ~200 MB load.
const profileDir=await mkdtemp(join(tmpdir(),'rlb-load-'));
const context=await chromium.launchPersistentContext(profileDir,{...launchOptions(),viewport:{width:1280,height:720}});await context.addInitScript(pointerLockStandIn);
const result={date:new Date().toISOString(),link:{rttMs:RTT,mbps:MBPS},menuWaitMs:MENU_MS,runs:[]};
const errors=[];
const fe=page=>page.evaluate(()=>window.rlbFrontEnd?.state()??null).catch(()=>null);
async function until(fn,timeout=900000){const t=Date.now();while(Date.now()-t<timeout){const v=await fn().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,25));}throw Error('timed out: '+fn);}
const mb=b=>+(b/1048576).toFixed(1);
try{
 for(const run of RUNS){
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/^Failed to load resource/.test(m.text()))errors.push(m.text());});
  if(WRITE_ORDER)await page.route('**/load-order.json*',route=>route.fulfill({status:404,body:''}));
  const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Performance.enable');
  if(MBPS>0)await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:RTT,downloadThroughput:MBPS*1e6/8,uploadThroughput:Math.max(1,MBPS/5)*1e6/8});
  // Per phase: bytes on the wire, full answers, 304 revalidations, and requests answered by the HTTP cache with no request.
  let phase='menu';const phases={menu:{bytes:0,full:0,revalidated:0,cached:0,files:[],revalidatedFiles:[]},join:{bytes:0,full:0,revalidated:0,cached:0,files:[],revalidatedFiles:[]}};const info=new Map(),wire=new Map(),order=[];
  cdp.on('Network.requestWillBeSent',e=>{const u=new URL(e.request.url);if(WRITE_ORDER&&phase==='join'&&e.request.method==='GET'&&u.origin===origin&&/^\/(assets|vendor)\//.test(u.pathname)&&!order.includes(u.pathname))order.push(u.pathname);});
  cdp.on('Network.responseReceived',e=>info.set(e.requestId,{url:e.response.url,status:e.response.status,cached:e.response.fromDiskCache||e.response.fromPrefetchCache}));
  cdp.on('Network.responseReceivedExtraInfo',e=>wire.set(e.requestId,e.statusCode));
  cdp.on('Network.requestServedFromCache',e=>{const i=info.get(e.requestId)??{};i.cached=true;info.set(e.requestId,i);});
  cdp.on('Network.loadingFinished',e=>{const i=info.get(e.requestId);if(!i?.url?.startsWith(origin))return;const p=phases[phase];p.bytes+=e.encodedDataLength;
   if(wire.get(e.requestId)===304){p.revalidated++;p.revalidatedFiles.push(new URL(i.url).pathname);}else if(i.cached&&!wire.has(e.requestId))p.cached++;else{p.full++;p.files.push([new URL(i.url).pathname,e.encodedDataLength]);}});
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(m=>/^(TaskDuration|ScriptDuration|JSHeapUsedSize)$/.test(m.name)).map(m=>[m.name,m.value]));
  const t0=Date.now();await page.goto(origin+'/',{waitUntil:'commit'});
  let menuUiMs=null;await until(async()=>{const s=await fe(page);if(s?.menu&&menuUiMs===null)menuUiMs=Date.now()-t0;return s?.menu&&s.background?s:null;});const menuMs=Date.now()-t0,menuMetrics=await metrics();
  if(SHOTS&&run===RUNS[0]){await mkdir(SHOTS,{recursive:true});await page.screenshot({path:join(SHOTS,'menu.png')});}
  if(MENU_MS)await page.waitForTimeout(MENU_MS);
  const prefetchAtJoin=await page.evaluate(()=>window.rlbPrefetch??null).catch(()=>null);
  phase='join';
  await page.locator('#front-end [data-df-name="btnPlay"]').click();await page.locator('#front-end [data-df-name="Community"]').click();
  await until(async()=>(await fe(page))?.rows?.some(r=>r.address==='offline'));
  if(CPU){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');}
  const t1=Date.now();await page.locator('#front-end [data-address="offline"] [data-df-name="btnHostname"]').dblclick();
  // In the world: the loading screen gone, the character spawned and frames drawn. The timeline keeps each new loading message.
  const timeline=[];
  await until(async()=>{const s=await fe(page),text=await page.evaluate(()=>document.querySelector('#status')?.textContent.replace(/\d+/g,'#')).catch(()=>null);
   for(const t of [s?.info,text])if(t&&!timeline.some(e=>e[1]===t))timeline.push([Date.now()-t1,t]);
   if(!s?.inGame)return null;return page.evaluate(()=>window.explorerState?.walk&&window.explorerState.frames>5);});
  const joinMs=Date.now()-t1,joinMetrics=await metrics();
  if(SHOTS&&run===RUNS[0])await page.waitForTimeout(1500).then(()=>page.screenshot({path:join(SHOTS,'in-world.png')}));
  let cpu=null;if(CPU){const {profile}=await cdp.send('Profiler.stop');cpu=profileSummary(profile);
   if(process.env.LOAD_PROFILE){await mkdir(process.env.LOAD_PROFILE,{recursive:true});await writeFile(join(process.env.LOAD_PROFILE,run+'.cpuprofile'),JSON.stringify(profile));}}
  const row={run,menuUiMs,menuMs,joinMs,prefetchAtJoin,timeline,
   menu:{mb:mb(phases.menu.bytes),full:phases.menu.full,revalidated:phases.menu.revalidated,cached:phases.menu.cached,mainThreadMs:Math.round(menuMetrics.TaskDuration*1000),scriptMs:Math.round(menuMetrics.ScriptDuration*1000)},
   join:{mb:mb(phases.join.bytes),full:phases.join.full,revalidated:phases.join.revalidated,cached:phases.join.cached,mainThreadMs:Math.round((joinMetrics.TaskDuration-menuMetrics.TaskDuration)*1000),scriptMs:Math.round((joinMetrics.ScriptDuration-menuMetrics.ScriptDuration)*1000),heapMB:mb(joinMetrics.JSHeapUsedSize)},
   revalidatedFiles:[...phases.menu.revalidatedFiles,...phases.join.revalidatedFiles],
   largest:[...phases.menu.files,...phases.join.files].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([f,b])=>[f,mb(b)]),cpu};
  result.runs.push(row);
  console.log(`${run.padEnd(5)} menu ${(menuUiMs/1000).toFixed(1)}/${(menuMs/1000).toFixed(1)} s (UI/background; ${row.menu.mb} MB, ${row.menu.full} full / ${row.menu.revalidated} 304 / ${row.menu.cached} cache, main thread ${row.menu.mainThreadMs} ms)  `+
   `join ${(joinMs/1000).toFixed(1)} s (${row.join.mb} MB, ${row.join.full} full / ${row.join.revalidated} 304 / ${row.join.cached} cache, main thread ${row.join.mainThreadMs} ms, script ${row.join.scriptMs} ms)`+
   (prefetchAtJoin?`  prefetched before join ${prefetchAtJoin.done}/${prefetchAtJoin.total}`:''));
  if(process.env.LOAD_TIMELINE==='1'){for(const [t,text] of timeline)console.log('   ',String(t).padStart(6),'ms',text);
   // performance.mark()s the page set during the join (none in the shipped code; add some while measuring a stage).
   const marks=await page.evaluate(t=>performance.getEntriesByType('mark').map(m=>[Math.round(performance.timeOrigin+m.startTime-t),m.name]),t1).catch(()=>[]);
   for(const [t,name] of marks)if(t>=0)console.log('   ',String(t).padStart(6),'ms mark',name);}
  if(cpu)for(const [k,v] of cpu.slice(0,25))console.log('   ',String(v).padStart(6),'ms',k);
  if(WRITE_ORDER&&run===RUNS[0]){await writeFile('browser/load-order.json',JSON.stringify({note:'Files an offline join requests, in order (tools/check-load.mjs LOAD_WRITE_ORDER=1); browser/world-prefetch.mjs downloads them while the menu is shown.',files:order}).replace(/","/g,'",\n"')+'\n');console.log('wrote browser/load-order.json:',order.length,'files');}
  await page.close();
 }
 result.errors=errors;await mkdir(dirname(OUT),{recursive:true});await writeFile(OUT,JSON.stringify(result,null,1));
 console.log('largest (first run):');for(const [f,m] of result.runs[0].largest)console.log('   ',String(m).padStart(6),'MB',f);
 assert.deepEqual(errors,[],'page errors');
}finally{await context.close();server.close();await rm(profileDir,{recursive:true,force:true}).catch(()=>{});}

// Self time per function (script:function), from a CDP sampling profile.
function profileSummary(profile){const byId=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map();
 const dt=profile.timeDeltas;for(let i=0;i<profile.samples.length;i++){const f=byId.get(profile.samples[i]).callFrame;const key=`${f.url.split('/').pop().split('?')[0]||'(native)'}:${f.functionName||'(anon)'}`;self.set(key,(self.get(key)??0)+(dt[i]??0)/1000);}
 return [...self].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([k,v])=>[k,Math.round(v)]);}
