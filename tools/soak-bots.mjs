// Soak and load test (SERVER-TESTING-PLAN.md P8, section 12): headless browser bots, each its own account and website
// join ticket, play against a real endpoint (or the mock stack with --mock) for a set duration.
//  - Full bots (--bots) load the real game page: walk loops, Rock swings, low-rate chat, reconnect cycles.
//  - Lite bots (--lite, load tests) are players without the game page (tools/native/driver.mjs liteLib): website
//    sign-in and join ticket, the gateway protocol from a small page, standing at the spawn, probes and chat.
//  - --stages 10,20,35,50 --stage-seconds 300: ramp the total (full + lite) bot count stage by stage; per-stage stats.
//  - --net latency=250,jitter=50,loss=2: every bot's WebSocket goes through the bad-network shim (driver.mjs netShim).
//  - --inventory-check: at the end every full bot reads its inventory, rejoins and compares (server state wins).
// Every sample period it records per bot: console-probe and chat round trips (server latency), frame rates,
// corrections (with how far the server moved us), errors, unexpected disconnects and the page's JS heap; this PC's CPU
// and memory (is the test PC the limit?); the gateway's /metrics when configured and, in mock mode, this process's
// memory (the gateway runs in-process). BROWSER_CDP may list several Edge instances. Ctrl+C stops gracefully.
// Output: analysis/native-runs/<timestamp>-soak[-label][-mock]/soak.json + soak.md.
//
//   node tools/soak-bots.mjs --mock --bots 3 --duration 60
//   node tools/soak-bots.mjs --config cfg.json --bots 6 --lite 44 --stages 10,20,35,50 --stage-seconds 300 --behaviours walk,gather,chat
//   node tools/soak-bots.mjs --config cfg.json --bots 4 --duration 900 --net latency=250,jitter=50,loss=2 --inventory-check
import path from 'node:path';
import os from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {parseArgs,loadConfig,validateConfig,redactConfig,withDefaults,readSecret,runStamp,describe,slopePerSecond,parsePrometheus,consoleCommand as isConsoleCommand,BEHAVIOURS} from './native/lib.mjs';
import {launchBrowsers,openPlayer,openLitePage,signIn,joinViaWebsite,lockPointer,hold,say,consoleCommand,pageMemory,settle,inventoryCells,distXZ} from './native/driver.mjs';

const HELP=`usage: node tools/soak-bots.mjs [--config file] [--mock] [--bots n] [--lite n] [--stages a,b,c --stage-seconds s] [--duration s] [--behaviours ${BEHAVIOURS.join(',')}] [--net latency=ms,jitter=ms,loss=%] [--inventory-check] [--shots] [--label x] [--out dir] [--dry]`;
const LITE_PER_PAGE=10,SIGN_IN_GAP_MS=2200; // central allows 30 sign-ins a minute per client address
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let opts;try{opts=parseArgs(process.argv.slice(2));}catch(e){console.error(e.message+'\n'+HELP);process.exit(2);}
if(opts.help){console.log(HELP);process.exit(0);}
let cfg;try{cfg=opts.mock?withDefaults({bots:{accounts:{auth:'dev',subjectPattern:'soak-bot-{n}'}}}):loadConfig({file:opts.config});}catch(e){console.error('config: '+e.message);process.exit(2);}
const soak={...cfg.soak,...(opts.bots!=null?{bots:opts.bots}:{}),...(opts.duration?{durationSeconds:opts.duration}:{}),...(opts.behaviours?{behaviours:opts.behaviours}:{})};
const stages=opts.stages??null,stageSeconds=opts.stageSeconds??300;
const liteCount=stages?Math.max(0,Math.max(...stages)-soak.bots):(opts.lite??0);
if(stages){soak.durationSeconds=stages.length*stageSeconds;if(stages.some((s,i)=>s<soak.bots||(i&&s<stages[i-1]))){console.error('--stages must rise and start at or above --bots');process.exit(2);}}
cfg.soak=soak;
const problems=validateConfig(cfg,{mock:opts.mock,soak:true});
if(liteCount&&cfg.bots?.accounts?.auth!=='dev'&&!opts.mock)problems.push('lite bots use dev sign-in (bots.accounts.auth "dev")');
if(opts.dry||problems.length){console.log(JSON.stringify({mode:opts.mock?'mock':'real',config:redactConfig(cfg),lite:liteCount,stages,stageSeconds,net:opts.net,problems},null,1));process.exit(problems.length?1:0);}

const outDir=opts.out??path.join('analysis','native-runs',runStamp()+'-soak'+(opts.label?'-'+opts.label:'')+(opts.mock?'-mock':''));
let stopping=false,mockEnv=null,browsers=[];const t0=Date.now();
const stop=sig=>{if(stopping){console.log('second',sig,'- exiting');process.exit(130);}stopping=true;console.log(sig,'received: stopping bots gracefully (again to force)');};
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));

const accountFor=n=>{const a=cfg.bots.accounts;return a.auth==='dev'?{auth:'dev',subject:a.subjectPattern.replace('{n}',n),name:a.subjectPattern.replace('{n}',n)}:{auth:'password',login:a.loginPattern.replace('{n}',n),passwordEnv:a.passwordEnv,passwordFile:a.passwordFile};};
const samples=[],events=[];const event=(bot,kind,detail={})=>{events.push({t:Date.now()-t0,at:new Date().toISOString(),bot,kind,...detail});};
// Per-stage numbers (one stage when not ramping).
let stage=0;const stageLog=[];const st=()=>stageLog[stage];
const newStage=(i,target)=>({stage:i,target,startedAt:new Date().toISOString(),endedAt:null,joins:{full:[],lite:[]},joinFailures:0,probe:{full:[],lite:[]},chat:{full:[],lite:[]},lost:{probe:0,chat:0},corrections:0,correctionDistances:[],drops:0,deaths:0,pc:[]});
// Sign-ins go one at a time with a gap (central's per-address login limit).
let signInChain=Promise.resolve();const signInSlot=()=>{const p=signInChain.then(()=>sleep(SIGN_IN_GAP_MS));signInChain=p;return p;};
let metrics=null;
// This PC: CPU busy % since the last sample (all cores) and memory in use.
let cpuPrev=os.cpus();
function pcSample(){const now=os.cpus();let idle=0,total=0;now.forEach((c,i)=>{const p=cpuPrev[i]?.times??c.times;for(const k of Object.keys(c.times)){const d=c.times[k]-p[k];total+=d;if(k==='idle')idle+=d;}});cpuPrev=now;
 return {cpuPct:total?+(100*(1-idle/total)).toFixed(1):null,memUsedGB:+((os.totalmem()-os.freemem())/2**30).toFixed(1),memTotalGB:+(os.totalmem()/2**30).toFixed(1)};}

try{
 if(opts.mock){const {startMockEnvironment}=await import('./native/mock.mjs');mockEnv=await startMockEnvironment();cfg.centralUrl=mockEnv.origin;cfg.serverId=mockEnv.serverId;metrics={url:mockEnv.metrics.url,token:mockEnv.metrics.token};}
 else if(cfg.metrics)metrics={url:cfg.metrics.url,token:readSecret(cfg.metrics,'token'),insecure:Boolean(cfg.metrics.insecure)};
 const origin=new URL(cfg.centralUrl).origin,secrets=cfg.bots.accounts.auth==='password'?[readSecret(cfg.bots.accounts,'password')]:[];
 await mkdir(outDir,{recursive:true});
 browsers=await launchBrowsers();
 const bots=Array.from({length:soak.bots},(_,i)=>({n:i+1,kind:'full',account:accountFor(i+1),joins:[],reconnects:0,reconnectFailures:0,unexpectedDisconnects:0,chatRtt:[],probeRtt:[],chatLost:0,probeLost:0,actions:{walk:0,gather:0,chat:0,reconnect:0},prev:null,error:null,drops:[]}));
 const lites=Array.from({length:liteCount},(_,i)=>({n:soak.bots+i+1,kind:'lite',account:accountFor(soak.bots+i+1),joins:[],joinParts:[],reconnects:0,reconnectFailures:0,unexpectedDisconnects:0,chatRtt:[],probeRtt:[],chatLost:0,probeLost:0,actions:{chat:0,reconnect:0},error:null,drops:[],stats:null,page:null}));
 stageLog.push(newStage(0,stages?stages[0]:soak.bots+liteCount));

 async function join(bot){
  for(let i=0;i<4;i++){
   try{const j=await joinViaWebsite(bot.session,{origin,serverId:cfg.serverId,gameUrl:cfg.gameUrl,loadMs:cfg.loadMs});
    if(mockEnv)mockEnv.referee.nameFor(j.approved.playerId,bot.me.name);bot.joins.push(j.inGameMs);bot.connected=true;st().joins.full.push(j.inGameMs);await lockPointer(bot.session.page);return j;}
   catch(e){if(!/already-connected/.test(e.message)||i===3)throw e;event(bot.n,'join-retry',{reason:e.message});await bot.session.page.goto(origin+'/',{waitUntil:'load'}).catch(()=>{});await sleep(5000);}
  }
 }
 async function start(bot,i){
  // --shots: bot 1 plays in a 1280x720 view and is photographed every 5 minutes (roadmap media).
  bot.session=await openPlayer(browsers[i%browsers.length],{viewport:opts.shots&&bot.n===1?{width:1280,height:720}:{width:480,height:300},ignoreHttpsErrors:cfg.ignoreHttpsErrors,redact:secrets,keep:3000,net:opts.net});
  await signInSlot();bot.me=await signIn(bot.session.page,origin,bot.account);await join(bot);event(bot.n,'joined',{ms:bot.joins.at(-1)});
  bot.prev=null;
 }
 // ---- lite bots: pages of LITE_PER_PAGE, spread over the browsers ----
 const litePages=[];
 async function litePage(i){const k=Math.floor(i/LITE_PER_PAGE);
  litePages[k]??=openLitePage(browsers[(k+soak.bots)%browsers.length],{origin,ignoreHttpsErrors:cfg.ignoreHttpsErrors,net:opts.net});return litePages[k];}
 async function liteJoin(bot){
  await signInSlot();const p=bot.page;
  const r=await p.page.evaluate(a=>window.__lite.join(a.n,a).then(x=>({ok:true,...x}),e=>({ok:false,error:e.message})),{n:bot.n,subject:bot.account.subject,name:bot.account.name,serverId:cfg.serverId,timeoutMs:Math.min(cfg.loadMs,180000)});
  if(!r.ok)throw Error(r.error);
  if(mockEnv)mockEnv.referee.nameFor(r.playerId,bot.account.name);
  bot.joins.push(r.spawnMs);bot.joinParts.push(r);bot.connected=true;st().joins.lite.push(r.spawnMs);return r;
 }
 async function liteStart(bot,i){bot.page=await litePage(i);for(let a=0;;a++){try{await liteJoin(bot);break;}catch(e){if(a>=2||stopping)throw e;event(bot.n,'join-retry',{reason:e.message});await sleep(5000);}}event(bot.n,'joined',{ms:bot.joins.at(-1)});}

 // ---- full joins (staggered so N islands do not load at once) ----
 const tj=Date.now();
 await Promise.all(bots.map((bot,i)=>sleep(i*1500).then(()=>start(bot,i)).catch(e=>{bot.error='join: '+e.message;st().joinFailures++;event(bot.n,'join-failed',{reason:e.message});})));
 const live=bots.filter(b=>!b.error);console.log(`${live.length}/${bots.length} full bots in game after ${((Date.now()-tj)/1000).toFixed(1)} s`);
 const liveLite=[];
 async function addLite(upto){
  const add=lites.filter(b=>!b.page&&!b.error&&b.n<=upto);
  await Promise.all(add.map(bot=>liteStart(bot,bot.n-soak.bots-1).then(()=>{liveLite.push(bot);loops.push(liteLoop(bot).catch(e=>{bot.error='loop: '+e.message;}));}).catch(e=>{bot.error='join: '+e.message;st().joinFailures++;event(bot.n,'join-failed',{reason:e.message});})));
  console.log(`stage ${stage}: ${live.length} full + ${liveLite.length} lite bots in game`);
 }
 let finished=false;const soakStart=Date.now(),soakEnd=soakStart+soak.durationSeconds*1000,done=()=>stopping||finished||(!stages&&Date.now()>=soakEnd);
 const has=b=>soak.behaviours.includes(b);

 // ---- behaviour loops ----
 async function botLoop(bot){
  const page=bot.session.page,jitter=()=>Math.random()*5000;
  let nextChat=Date.now()+5000+jitter(),nextReconnect=Date.now()+soak.reconnectEverySeconds*1000+jitter(),nextProbe=Date.now()+2000+jitter();
  if(has('gather'))await page.keyboard.press('Digit1').catch(()=>{}); // hold the starting Rock
  while(!done()){
   try{
    // A dropped session (or a rejoin that failed last time round) joins again; a failure lands in the catch and retries.
    if(!bot.session.socketOpen()){if(bot.connected){bot.connected=false;bot.unexpectedDisconnects++;st().drops++;const why=bot.session.frames.rx(0,f=>f.type==='kicked'||f.type==='disconnected').at(-1);const d={at:new Date().toISOString(),reason:why?.reason??null,origin:bot.session.frames.correctionLog.at(-1)?.origin??null};bot.drops.push(d);event(bot.n,'disconnected',d);}
     else await sleep(5000);
     await page.goto(origin+'/',{waitUntil:'load'});await join(bot);event(bot.n,'rejoined-after-drop');continue;}
    const now=Date.now();
    if(has('reconnect')&&now>=nextReconnect){bot.actions.reconnect++;bot.connected=false;const t=Date.now();await page.goto(origin+'/',{waitUntil:'load'});await sleep(2000);
     try{await join(bot);bot.reconnects++;event(bot.n,'reconnected',{ms:Date.now()-t});}catch(e){bot.reconnectFailures++;event(bot.n,'reconnect-failed',{reason:e.message});await sleep(5000);}
     nextReconnect=Date.now()+soak.reconnectEverySeconds*1000+jitter();continue;}
    if(now>=nextProbe){const c=await consoleCommand(bot.session,'findsv chat',{match:/^Finding/,ms:cfg.replyMs});if(c.reply){bot.probeRtt.push(c.rttMs);st().probe.full.push(c.rttMs);}else{bot.probeLost++;st().lost.probe++;}nextProbe=Date.now()+soak.sampleSeconds*1000;continue;}
    if(has('chat')&&now>=nextChat){bot.actions.chat++;const token=`soak${bot.n}-${Math.random().toString(36).slice(2,7)}`,t=Date.now()-1;await say(page,token);
     const echo=await bot.session.frames.waitFor(t,f=>isConsoleCommand(f)&&f.values[0].includes(token),cfg.replyMs);if(echo){bot.chatRtt.push(echo.t-t);st().chat.full.push(echo.t-t);}else{bot.chatLost++;st().lost.chat++;}
     nextChat=Date.now()+soak.chatEverySeconds*1000+jitter();continue;}
    const moves=[has('walk')&&'walk',has('gather')&&'gather'].filter(Boolean);
    if(!moves.length){await sleep(1000);continue;}
    const what=moves[Math.floor(Math.random()*moves.length)];bot.actions[what]++;
    if(what==='walk'){const key=['KeyW','KeyA','KeyS','KeyD'][Math.floor(Math.random()*4)];await hold(page,Math.random()<0.3?['ShiftLeft',key]:[key],soak.walkSeconds*1000*(0.5+Math.random()*0.5));}
    else{for(let i=0;i<3&&!done();i++){await page.mouse.down();await sleep(80);await page.mouse.up();await sleep(1100);}}
   }catch(e){event(bot.n,'error',{reason:e.message.split('\n')[0].slice(0,200)});await settle(page).catch(()=>{});await sleep(1000);}
  }
  await settle(page).catch(()=>{});
 }
 async function liteLoop(bot){
  const page=bot.page.page,jitter=()=>Math.random()*5000;
  let nextChat=Date.now()+5000+jitter(),nextReconnect=Date.now()+soak.reconnectEverySeconds*1000+jitter(),nextProbe=Date.now()+2000+jitter();
  const cmd=(text,reply,kind)=>page.evaluate(a=>window.__lite.command(a.n,a.text,a),{n:bot.n,text,reply,kind,ms:cfg.replyMs});
  while(!done()){
   try{
    const s=(await page.evaluate(()=>window.__lite.stats())).find(x=>x.n===bot.n);
    if(!s?.open){ // joins are awaited here, so a closed or missing socket is never one still joining
     if(bot.connected){bot.connected=false;bot.unexpectedDisconnects++;st().drops++;const d={at:new Date().toISOString(),reason:s?.ended?.reason??s?.ended?.code??null,kp:s?.kp??null};bot.drops.push(d);event(bot.n,'disconnected',d);bot.statsBefore=accumulate(bot.statsBefore,s);}
     await sleep(3000);try{await liteJoin(bot);event(bot.n,'rejoined-after-drop');}catch(e){event(bot.n,'rejoin-failed',{reason:e.message});await sleep(10000);}continue;}
    const now=Date.now();
    if(has('reconnect')&&now>=nextReconnect){bot.actions.reconnect++;bot.connected=false;bot.statsBefore=accumulate(bot.statsBefore,s);await page.evaluate(n=>window.__lite.leave(n),bot.n);await sleep(2000);
     try{await liteJoin(bot);bot.reconnects++;event(bot.n,'reconnected',{ms:bot.joins.at(-1)});}catch(e){bot.reconnectFailures++;event(bot.n,'reconnect-failed',{reason:e.message});await sleep(5000);}
     nextReconnect=Date.now()+soak.reconnectEverySeconds*1000+jitter();continue;}
    if(now>=nextProbe){const ms=await cmd('findsv chat','^Finding','CL_ConsoleMessage');if(ms!=null){bot.probeRtt.push(ms);st().probe.lite.push(ms);}else{bot.probeLost++;st().lost.probe++;}nextProbe=Date.now()+soak.sampleSeconds*1000;continue;}
    if(has('chat')&&now>=nextChat){bot.actions.chat++;const token=`soak${bot.n}-${Math.random().toString(36).slice(2,7)}`;
     const ms=await cmd('chat.say "'+token+'"',token,'CL_ConsoleCommand');if(ms!=null){bot.chatRtt.push(ms);st().chat.lite.push(ms);}else{bot.chatLost++;st().lost.chat++;}
     nextChat=Date.now()+soak.chatEverySeconds*1000+jitter();continue;}
    await sleep(500);
   }catch(e){event(bot.n,'error',{reason:e.message.split('\n')[0].slice(0,200)});await sleep(2000);}
  }
 }
 // Totals of a lite bot's earlier sockets (the page counters restart on every join).
 function accumulate(acc,s){acc??={rx:0,rxBytes:0,corrections:0,correctionDistances:[],deaths:0};if(!s)return acc;
  return {rx:acc.rx+s.rx,rxBytes:acc.rxBytes+s.rxBytes,corrections:acc.corrections+s.corrections,correctionDistances:acc.correctionDistances.concat(s.correctionDistances),deaths:acc.deaths+s.deaths};}

 // ---- sampler ----
 async function sample(){
  const s={t:Date.now()-t0,at:new Date().toISOString(),stage,bots:[],lite:null,node:process.memoryUsage().rss/1048576,pc:pcSample()};st().pc.push(s.pc);
  for(const bot of live){const f=bot.session.frames,c=f.counts,prev=bot.prev??{rx:c.rx,tx:c.tx,rxBytes:c.rxBytes,txBytes:c.txBytes,corr:f.correctionLog.length,errors:bot.session.errors.length,t:Date.now()-1};
   const dt=Math.max(0.001,(Date.now()-prev.t)/1000),corr=f.correctionLog.length,mem=await pageMemory(bot.session);
   // Each server correction with where the server put us and how far that is from our last move (rubber-banding).
   const r2=p=>p?.map?.(v=>+v.toFixed(2))??null;
   for(const c of f.correctionLog.slice(prev.corr)){const last=c.sent.at(-1),d=last&&c.origin?+distXZ(c.origin,last).toFixed(2):null;st().corrections++;if(d!=null)st().correctionDistances.push(d);event(bot.n,'correction',{name:c.name,arrived:new Date(c.t).toISOString(),lateS:c.lateS??null,origin:r2(c.origin),sent:c.sent.map(r2),d});}
   s.bots.push({bot:bot.n,connected:bot.session.socketOpen(),rxPerS:+((c.rx-prev.rx)/dt).toFixed(1),txPerS:+((c.tx-prev.tx)/dt).toFixed(1),rxKBps:+((c.rxBytes-prev.rxBytes)/1024/dt).toFixed(1),
    corrections:corr-prev.corr,errors:bot.session.errors.length-prev.errors,heapMB:mem?.jsHeapUsedMB??null,nodes:mem?.nodes??null,probeMs:bot.probeRtt.at(-1)??null});
   bot.prev={rx:c.rx,tx:c.tx,rxBytes:c.rxBytes,txBytes:c.txBytes,corr,errors:bot.session.errors.length,t:Date.now()};}
  if(liveLite.length){const all=(await Promise.all(litePages.map(p=>p.then(x=>x.page.evaluate(()=>window.__lite.stats())).catch(()=>[])))).flat(),byN=new Map(all.map(x=>[x.n,x]));
   let up=0,rx=0,rxBytes=0,corr=0,deaths=0;
   for(const bot of liveLite){const x=byN.get(bot.n);if(!x)continue;if(x.open)up++;
    const prevC=bot.lastStats?.corrections??0;if(x.corrections>prevC){st().corrections+=x.corrections-prevC;st().correctionDistances.push(...x.correctionDistances.slice(prevC));event(bot.n,'correction',{n:x.corrections-prevC,d:x.correctionDistances.slice(prevC),arrived:(x.correctionTimes??[]).slice(prevC).map(c=>new Date(c.at).toISOString()),lateS:(x.correctionTimes??[]).slice(prevC).map(c=>c.lateS)});}
    if(x.deaths>(bot.lastStats?.deaths??0)){st().deaths+=x.deaths-(bot.lastStats?.deaths??0);event(bot.n,'died',{deaths:x.deaths});}
    if(bot.lastStats&&x.rx<bot.lastStats.rx)bot.lastStats=null; // new socket since the last sample
    rx+=x.rx-(bot.lastStats?.rx??x.rx);rxBytes+=x.rxBytes-(bot.lastStats?.rxBytes??x.rxBytes);corr+=x.corrections;deaths+=x.deaths;bot.stats=x;bot.lastStats=x;}
   const dt=samples.length?(s.t-samples.at(-1).t)/1000:soak.sampleSeconds;
   s.lite={up,of:liveLite.length,rxPerSPerBot:+(rx/dt/Math.max(1,up)).toFixed(1),rxKBpsTotal:+(rxBytes/1024/dt).toFixed(1),corrections:corr,deaths,probeP50:describe(liveLite.map(b=>b.probeRtt.at(-1))).p50??null};}
  if(metrics)try{const r=await scrape(metrics);s.gateway=r.status===200?parsePrometheus(r.text):{error:r.status};}catch(e){s.gateway={error:e.message};}
  samples.push(s);
  console.log(`[${(s.t/1000).toFixed(0)}s st${stage}] pc cpu ${s.pc.cpuPct}% mem ${s.pc.memUsedGB}/${s.pc.memTotalGB} GB | `+s.bots.map(b=>`#${b.bot} ${b.connected?'up':'DOWN'} rx ${b.rxPerS}/s heap ${b.heapMB}MB probe ${b.probeMs??'-'}ms`).join(' | ')+(s.lite?` | lite ${s.lite.up}/${s.lite.of} up rx ${s.lite.rxPerSPerBot}/s/bot probe p50 ${s.lite.probeP50??'-'}ms corr ${s.lite.corrections}`:''));
 }
 const loops=live.map(b=>botLoop(b).catch(e=>{b.error='loop: '+e.message;}));
 await sample();
 const sampler=setInterval(()=>{if(!done())sample().catch(e=>console.error('sample:',e.message));},soak.sampleSeconds*1000);
 const shooter=opts.shots?setInterval(()=>{const b=live.find(x=>x.n===1);if(b&&!done())b.session.page.screenshot({path:path.join(outDir,`bot1-${new Date().toISOString().slice(11,19).replace(/:/g,'')}.png`)}).catch(()=>{});},300000):null;
 // The report so far, every 5 minutes: a long run that is killed or loses its browsers still leaves its numbers.
 const checkpoint=setInterval(()=>{const r=buildReport({bots,lites,live,liveLite,soakStart,inventory:[]});r.run.partial=true;
  writeFile(path.join(outDir,'soak.json'),JSON.stringify(r,null,1)).then(()=>writeFile(path.join(outDir,'soak.md'),soakMarkdown(r))).catch(e=>console.error('checkpoint:',e.message));},300000);
 // ---- stages (or one stage with every lite bot) ----
 const plan=stages??[soak.bots+liteCount];
 for(let i=0;i<plan.length&&!stopping;i++){
  if(i){st().endedAt=new Date().toISOString();stage=i;stageLog.push(newStage(i,plan[i]));}
  const tStage=Date.now();await addLite(plan[i]);
  const holdUntil=stages?Math.max(tStage+stageSeconds*1000,Date.now()+60000):soakEnd;
  while(!stopping&&Date.now()<holdUntil)await sleep(1000);
 }
 finished=true;
 await Promise.all(loops);
 clearInterval(sampler);clearInterval(checkpoint);clearInterval(shooter);await sample();st().endedAt=new Date().toISOString();
 // ---- inventory consistency: what the page shows now vs. after a fresh join (the server's full snapshot) ----
 // Runs before the "every bot leaves" cleanup below: it reconnects each bot's own session/page one more time,
 // which would otherwise be left pointing at an already-closed context.
 const inventory=[];
 if(opts.inventoryCheck)for(const bot of live){
  try{const before=await inventoryCells(bot.session.page);await bot.session.page.goto(origin+'/',{waitUntil:'load'});await sleep(2000);await join(bot);await sleep(3000);
   const after=await inventoryCells(bot.session.page),key=c=>c.map(x=>`${x.slot}:${x.name}x${x.count}`).join(','),same=key(before)===key(after);
   inventory.push({bot:bot.n,same,before,after});event(bot.n,'inventory-check',{same});}
  catch(e){inventory.push({bot:bot.n,same:null,error:e.message});}
 }
 // Every bot leaves on its own WebSocket close before the process exits, so the gateway sees each one end and
 // notifies the real server at once (session.end -> client.close, gateway-service.mjs). Connected via CDP to an
 // already-running browser, `browser.close()` below only drops Playwright's own contexts/pages; it does not
 // guarantee each page's close reaches the gateway before this process exits (e.g. on a kill signal, not at all).
 for(const bot of live)if(bot.session?.socketOpen?.())await bot.session.close().catch(()=>{});
 for(const bot of liveLite){const s=bot.page?.page;if(!s||s.isClosed())continue;await s.evaluate(n=>window.__lite?.leave?.(n),bot.n).catch(()=>{});}
 // ---- report ----
 const report=buildReport({bots,lites,live,liveLite,soakStart,inventory});
 await writeFile(path.join(outDir,'soak.json'),JSON.stringify(report,null,1));await writeFile(path.join(outDir,'soak.md'),soakMarkdown(report));
 console.log(JSON.stringify(report.verdict),'->',path.join(outDir,'soak.md'));
 if(!report.verdict.ok)process.exitCode=1;
}catch(e){console.error('soak error:',e.stack);process.exitCode=1;}
finally{for(const b of browsers)await b?.close().catch(()=>{});await mockEnv?.close().catch(()=>{});}

function buildReport({bots,lites,live,liveLite,soakStart,inventory}){
 const perBot=bots.map(b=>{const heap=samples.map(s=>[s.t,s.bots.find(x=>x.bot===b.n)?.heapMB]).filter(([,v])=>Number.isFinite(v));
  const dist=b.session?b.session.frames.correctionLog.map(c=>c.sent.at(-1)&&c.origin?+distXZ(c.origin,c.sent.at(-1)).toFixed(2):null).filter(Number.isFinite):[];
  return {bot:b.n,kind:'full',account:b.account.login??b.account.subject,error:b.error,joinMs:describe(b.joins),reconnects:b.reconnects,reconnectFailures:b.reconnectFailures,unexpectedDisconnects:b.unexpectedDisconnects,drops:b.drops,
   actions:b.actions,chatRttMs:describe(b.chatRtt),chatLost:b.chatLost,probeRttMs:describe(b.probeRtt),probeLost:b.probeLost,corrections:b.session?b.session.frames.correctionLog.length:null,correctionDistanceM:describe(dist),
   pageErrors:b.session?.errors.slice(0,20)??[],heapStartMB:heap[0]?.[1]??null,heapEndMB:heap.at(-1)?.[1]??null,heapSlopeMBperMin:heap.length>2?+(slopePerSecond(heap)*60).toFixed(2):null,frames:b.session?.frames.counts??null};});
 const perLite=lites.map(b=>{const tot=accumulate(b.statsBefore,b.stats);
  return {bot:b.n,kind:'lite',account:b.account.subject,error:b.error,joinMs:describe(b.joins),joinParts:b.joinParts.slice(0,3),reconnects:b.reconnects,reconnectFailures:b.reconnectFailures,unexpectedDisconnects:b.unexpectedDisconnects,drops:b.drops,
   actions:b.actions,chatRttMs:describe(b.chatRtt),chatLost:b.chatLost,probeRttMs:describe(b.probeRtt),probeLost:b.probeLost,corrections:tot.corrections,correctionDistanceM:describe(tot.correctionDistances),deaths:tot.deaths,rx:tot.rx,rxMB:+(tot.rxBytes/1048576).toFixed(1)};});
 function accumulate(acc,s){acc??={rx:0,rxBytes:0,corrections:0,correctionDistances:[],deaths:0};if(!s)return acc;
  return {rx:acc.rx+s.rx,rxBytes:acc.rxBytes+s.rxBytes,corrections:acc.corrections+s.corrections,correctionDistances:acc.correctionDistances.concat(s.correctionDistances),deaths:acc.deaths+s.deaths};}
 const g=samples.filter(s=>s.gateway&&!s.gateway.error),gw=g.length?{first:g[0].gateway,last:g.at(-1).gateway}:null;
 const nodeSlope=samples.length>2?+(slopePerSecond(samples.map(s=>[s.t,s.node]))*60).toFixed(2):null;
 const stagesOut=stageLog.map(x=>({stage:x.stage,target:x.target,startedAt:x.startedAt,endedAt:x.endedAt,joinMs:{full:describe(x.joins.full),lite:describe(x.joins.lite)},joinFailures:x.joinFailures,
  probeMs:{full:describe(x.probe.full),lite:describe(x.probe.lite),all:describe(x.probe.full.concat(x.probe.lite))},chatMs:{full:describe(x.chat.full),lite:describe(x.chat.lite),all:describe(x.chat.full.concat(x.chat.lite))},
  lost:x.lost,corrections:x.corrections,correctionDistanceM:describe(x.correctionDistances),drops:x.drops,deaths:x.deaths,pcCpuPct:describe(x.pc.map(p=>p.cpuPct)),pcMemUsedGB:describe(x.pc.map(p=>p.memUsedGB))}));
 const failures=[],all=[...perBot,...perLite];
 if(live.length<bots.length)failures.push(`${bots.length-live.length} full bot(s) never joined`);
 const liteMissing=lites.filter(b=>b.error&&/^join/.test(b.error)).length;if(liteMissing)failures.push(`${liteMissing} lite bot(s) never joined`);
 for(const b of all){if(b.error&&!/^join/.test(b.error))failures.push(`bot ${b.bot}: ${b.error}`);if(b.unexpectedDisconnects)failures.push(`bot ${b.bot}: ${b.unexpectedDisconnects} unexpected disconnect(s)`);if(b.reconnectFailures)failures.push(`bot ${b.bot}: ${b.reconnectFailures} failed reconnect(s)`);
  if(b.corrections)failures.push(`bot ${b.bot}: ${b.corrections} server correction(s)`);if(b.pageErrors?.length)failures.push(`bot ${b.bot}: ${b.pageErrors.length} page error(s)`);if(b.probeLost+b.chatLost)failures.push(`bot ${b.bot}: ${b.probeLost} probe / ${b.chatLost} chat replies lost`);}
 for(const x of inventory)if(x.same===false)failures.push(`bot ${x.bot}: inventory differed after rejoin`);
 return {run:{mode:opts.mock?'mock':'real',label:opts.label,centralUrl:cfg.centralUrl,serverId:cfg.serverId,soak,lite:lites.length,stages,stageSeconds,net:opts.net,browsers:browsers.length,startedAt:new Date(t0).toISOString(),soakSeconds:+((Date.now()-soakStart)/1000).toFixed(1),stoppedEarly:stopping&&Date.now()<soakStart+soak.durationSeconds*1000-5000,config:redactConfig({...cfg,centralUrl:undefined})},
  verdict:{ok:failures.length===0,failures},stages:stagesOut,bots:perBot,lite:perLite,inventory,
  latency:{probeRttMs:describe([...bots,...lites].flatMap(b=>b.probeRtt)),chatRttMs:describe([...bots,...lites].flatMap(b=>b.chatRtt))},
  pc:{cpuPct:describe(samples.map(s=>s.pc.cpuPct)),memUsedGB:describe(samples.map(s=>s.pc.memUsedGB))},
  processMemory:opts.mock?{note:'gateway, sidecar, central and mock server run in this process',rssSlopeMBperMin:nodeSlope,firstMB:samples[0]?.node,lastMB:samples.at(-1)?.node}:null,
  gateway:gw,events,samples};
}
function soakMarkdown(r){
 const L=[`# Soak — ${r.run.mode} run${r.run.label?' ('+r.run.label+')':''}${r.run.partial?' — PARTIAL (checkpoint while running)':''}`,'',`- ${r.bots.length} full + ${r.lite.length} lite bots, ${r.run.soakSeconds} s${r.run.stoppedEarly?' (stopped early)':''}, behaviours: ${r.run.soak.behaviours.join(', ')}${r.run.net?`, network +${r.run.net.latency} ms ±${r.run.net.jitter} ms, ${r.run.net.loss}% loss`:''}, ${r.run.browsers} browser(s)`,
  `- Verdict: **${r.verdict.ok?'OK':'PROBLEMS'}**${r.verdict.failures.length?'':' (no disconnects, corrections, page errors or lost replies)'}`,...r.verdict.failures.slice(0,60).map(f=>'  - '+f),
  `- Console probe RTT: ${fmt(r.latency.probeRttMs)}; chat echo RTT: ${fmt(r.latency.chatRttMs)}`,`- This PC: CPU ${fmt(r.pc.cpuPct,'%')}, memory in use ${fmt(r.pc.memUsedGB,' GB')}`];
 if(r.processMemory)L.push(`- This process (in-process gateway stack) RSS: ${r.processMemory.firstMB?.toFixed(0)} -> ${r.processMemory.lastMB?.toFixed(0)} MB, slope ${r.processMemory.rssSlopeMBperMin} MB/min`);
 if(r.stages.length>1||r.lite.length){L.push('','## Stages','','| Stage | Bots | Start (UTC) | Join p50/p95 full | Join p50/p95 lite | Probe p50/p95 | Chat p50/p95 | Lost probe/chat | Corrections (max m) | Drops | PC CPU p50/max | PC mem max |','|---|---|---|---|---|---|---|---|---|---|---|---|');
  for(const s of r.stages)L.push(`| ${s.stage} | ${s.target} | ${s.startedAt.slice(11,19)} | ${pp(s.joinMs.full)} | ${pp(s.joinMs.lite)} | ${pp(s.probeMs.all)} | ${pp(s.chatMs.all)} | ${s.lost.probe}/${s.lost.chat} | ${s.corrections} (${s.correctionDistanceM.n?s.correctionDistanceM.max:'-'}) | ${s.drops} | ${s.pcCpuPct.n?s.pcCpuPct.p50+'/'+s.pcCpuPct.max:'-'} | ${s.pcMemUsedGB.n?s.pcMemUsedGB.max+' GB':'-'} |`);}
 L.push('','| Bot | Join | Reconnects (failed) | Drops | Actions | Probe RTT | Chat RTT | Corrections (max m) | Heap MB (slope/min) | Errors |','|---|---|---|---|---|---|---|---|---|---|');
 for(const b of r.bots)L.push(`| ${b.bot} | ${b.joinMs.n?Math.round(b.joinMs.p50)+' ms':'-'} | ${b.reconnects} (${b.reconnectFailures}) | ${b.unexpectedDisconnects} | ${Object.entries(b.actions).map(([k,v])=>`${k} ${v}`).join(', ')} | ${fmt(b.probeRttMs)} | ${fmt(b.chatRttMs)} | ${b.corrections} (${b.correctionDistanceM.n?b.correctionDistanceM.max:'-'}) | ${b.heapStartMB}→${b.heapEndMB} (${b.heapSlopeMBperMin}) | ${b.error??b.pageErrors.length} |`);
 if(r.lite.length){L.push('','| Lite bots | n | value |','|---|---|---|');const all=k=>r.lite.flatMap(b=>b[k]);
  L.push(`| joined | ${r.lite.filter(b=>b.joinMs.n).length}/${r.lite.length} | join p50/p95 ${pp(describe(r.lite.flatMap(b=>b.joinParts.map(j=>j.spawnMs))))} ms |`,`| drops / reconnects | ${r.lite.reduce((a,b)=>a+b.unexpectedDisconnects,0)} / ${r.lite.reduce((a,b)=>a+b.reconnects,0)} | |`,
   `| corrections / deaths | ${r.lite.reduce((a,b)=>a+b.corrections,0)} / ${r.lite.reduce((a,b)=>a+b.deaths,0)} | |`,`| errors | ${r.lite.filter(b=>b.error).length} | ${[...new Set(r.lite.map(b=>b.error).filter(Boolean))].slice(0,3).join('; ')} |`);}
 if(r.inventory.length)L.push('','## Inventory after rejoin','',...r.inventory.map(x=>`- bot ${x.bot}: ${x.same==null?'error '+x.error:x.same?'same':'DIFFERENT'} (${(x.before??[]).map(c=>c.name+' x'+c.count).join(', ')})`));
 if(r.gateway){const keys=Object.keys(r.gateway.last).filter(k=>!/_bucket|_sum|_count/.test(k)).slice(0,30);L.push('','## Gateway /metrics (first -> last)','',...keys.map(k=>`- ${k}: ${r.gateway.first[k]??'-'} -> ${r.gateway.last[k]}`));}
 L.push('','## Timeline','','| t (s) | stage | PC CPU % | '+r.bots.map(b=>`bot ${b.bot} rx/s · heap · probe`).join(' | ')+(r.lite.length?' | lite up · rx/s/bot · probe p50':'')+' |','|---|---|---|'+r.bots.map(()=>'---|').join('')+(r.lite.length?'---|':''));
 for(const s of r.samples)L.push(`| ${(s.t/1000).toFixed(0)} | ${s.stage} | ${s.pc.cpuPct} | `+r.bots.map(b=>{const x=s.bots.find(y=>y.bot===b.bot);return x?`${x.connected?'':'DOWN '}${x.rxPerS} · ${x.heapMB} · ${x.probeMs??'-'}`:'-';}).join(' | ')+(r.lite.length?` | ${s.lite?`${s.lite.up}/${s.lite.of} · ${s.lite.rxPerSPerBot} · ${s.lite.probeP50??'-'}`:'-'}`:'')+' |');
 if(r.events.length)L.push('','## Events','',...r.events.filter(e=>e.kind!=='joined').slice(0,300).map(e=>`- ${(e.t/1000).toFixed(1)} s bot ${e.bot}: ${e.kind}${e.ms!=null?` (${e.ms} ms)`:''}${e.d!=null?` d=${JSON.stringify(e.d)}`:''}${e.reason?' — '+e.reason:''}`));
 return L.join('\n')+'\n';
}
// GET /metrics with the bearer token. insecure: accept the VM gateway's self-signed test certificate (this request only).
async function scrape({url,token,insecure}){
 if(!(insecure&&url.startsWith('https:'))){const r=await fetch(url,{headers:{authorization:'Bearer '+token}});return {status:r.status,text:await r.text()};}
 const {request}=await import('node:https');
 return new Promise((resolve,reject)=>{const q=request(url,{headers:{authorization:'Bearer '+token},rejectUnauthorized:false,timeout:5000},res=>{let text='';res.setEncoding('utf8');res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,text}));});q.on('error',reject);q.on('timeout',()=>q.destroy(Error('timeout')));q.end();});
}
function fmt(d,unit=' ms'){return d?.n?`p50 ${Math.round(d.p50)} / p95 ${Math.round(d.p95)} / max ${Math.round(d.max)}${unit} (n=${d.n})`:'-';}
function pp(d){return d?.n?`${Math.round(d.p50)}/${Math.round(d.p95)}`:'-';}
