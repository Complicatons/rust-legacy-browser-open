// Restart persistence check (SERVER-TESTING-PLAN.md section 12, test 3) against the original server.
//
//  --phase before: N "persist" bots join through the website, gather at the nearest resource node, walk a little and
//    record what the server last told them (position, inventory from GNUP, vitals), then leave (they become sleepers).
//    H "hold" bots do the same but stay connected through the server stop: the tool waits for their sessions to end,
//    records how the gateway ended them, then retries the join every 30 s until the server is back (or --wait-minutes),
//    and compares their state after the restart. Sleepers (;sleeper_male) the hold bots can see are counted before
//    the stop and after the restart. Everything goes to --state (JSON), rewritten as it changes.
//  --phase after: the N persist bots rejoin and compare position (< 1 m), inventory (same cells) and vitals.
//
// The stop itself is done separately (06-Stop-Server.ps1 on the server machine), the start by the owner (05).
//   node tools/restart-check.mjs --config cfg.json --phase before --bots 4 --hold 2 --state analysis/native-runs/restart.json
//   node tools/restart-check.mjs --config cfg.json --phase after --state analysis/native-runs/restart.json
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {loadConfig,redactConfig,withDefaults} from './native/lib.mjs';
import {launchBrowsers,openPlayer,signIn,joinViaWebsite,lockPointer,hold,inventoryCells,countOf,feet,toUnity,distXZ} from './native/driver.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arg=(name,d=null)=>{const i=process.argv.indexOf('--'+name);return i>0?process.argv[i+1]:d;};
const phase=arg('phase'),statePath=arg('state'),nBots=Number(arg('bots',4)),nHold=Number(arg('hold',2)),waitMinutes=Number(arg('wait-minutes',60)),prefix=arg('prefix','persist-bot');
if(!['before','after'].includes(phase)||!statePath){console.error('usage: node tools/restart-check.mjs --config cfg.json --phase before|after --state file [--bots 4] [--hold 2] [--wait-minutes 60] [--prefix persist-bot]');process.exit(2);}
const mock=process.argv.includes('--mock'),mockEnv=mock?await (await import('./native/mock.mjs')).startMockEnvironment():null; // --mock: tool self-test only
const cfg=mock?{...withDefaults({}),centralUrl:mockEnv.origin,serverId:mockEnv.serverId}:loadConfig({file:arg('config')}),origin=new URL(cfg.centralUrl).origin;
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
let state=phase==='after'?JSON.parse(await readFile(statePath,'utf8')):{config:redactConfig({...cfg,centralUrl:undefined}),bots:[],hold:[]};
const save=()=>mkdir(path.dirname(statePath),{recursive:true}).then(()=>writeFile(statePath,JSON.stringify(state,null,1)));
const account=n=>({auth:'dev',subject:`${prefix}-${n}`,name:`${prefix}-${n}`.slice(0,32)});
const browsers=await launchBrowsers();
let bi=0;const browser=()=>browsers[bi++%browsers.length];

// What the server last said about us: the position of our last accepted move (or the spawn), the inventory cells
// built from its GNUP calls, and the vitals from its health/metabolism calls.
async function snapshot(s){
 const {page,frames}=s,lastMove=frames.lastMoves.at(-1)??frames.characters.at(-1)?.position??null;
 const vitals=await page.evaluate(()=>{const v=window.explorerState?.vitals;return v&&{health:+v.health.toFixed(1),calories:+(v.calories??0).toFixed(0),bleeding:v.bleeding,poison:v.poison,dead:v.dead};}).catch(()=>null);
 return {at:new Date().toISOString(),position:lastMove,feet:toUnity(await feet(page)),inventory:await inventoryCells(page),vitals,sleepers:sleepers(frames)};
}
const sleepers=frames=>{const gone=new Set(frames.rx(0,f=>f.type==='ngc-destroy').map(f=>f.carrier+':'+f.innerID));return frames.rx(0,f=>f.type==='ngc-create'&&f.prefab===';sleeper_male'&&!gone.has(f.carrier+':'+f.innerID)).map(f=>f.position);};

async function joinBot(n){
 const s=await openPlayer(browser(),{viewport:{width:480,height:300},ignoreHttpsErrors:cfg.ignoreHttpsErrors,keep:5000});
 const me=await signIn(s.page,origin,account(n));
 const j=await joinViaWebsite(s,{origin,serverId:cfg.serverId,gameUrl:cfg.gameUrl,loadMs:cfg.loadMs});await lockPointer(s.page);
 return {s,me,j};
}
// As check-native gather.node: walk to the nearest server resource node and swing the starting Rock six times.
async function gather(s){
 const {frames,page}=s,gone=new Set(frames.rx(0,f=>f.type==='ngc-destroy').map(f=>f.carrier+':'+f.innerID)),here=toUnity(await feet(page));
 const node=frames.rx(0,f=>f.type==='ngc-create'&&/^;res_/.test(f.prefab??'')&&!gone.has(f.carrier+':'+f.innerID)).map(f=>({prefab:f.prefab,position:f.position,d:distXZ(f.position,here)})).sort((a,b)=>a.d-b.d)[0];
 if(!node||node.d>(cfg.gatherRadius??60))return {gathered:0,reason:'no node in range'};
 const rock=(await inventoryCells(page)).find(c=>c.name==='Rock'&&c.slot>=30);if(!rock)return {gathered:0,reason:'no Rock'};
 await page.keyboard.press('Digit'+(rock.slot-29));await sleep(800);
 const target=[node.position[0],node.position[1]+0.6,-node.position[2]],end=Date.now()+45000;let d=Infinity,stalled=0;
 while(Date.now()<end){const prev=d;d=distXZ(await feet(page),[target[0],0,target[2]]);if(d<1.6)break;stalled=prev-d<0.05?stalled+1:0;if(d<3&&stalled>=3)break;await page.evaluate(p=>window.explorerDev.aimPoint(p),target);await hold(page,['KeyW'],Math.min(400,d*250));}
 const re=/^(Wood|Stones|Metal Ore|Sulfur Ore|Animal Fat|Leather|Cloth)$/,before=countOf(await inventoryCells(page),re);
 for(let i=0;i<8;i++){await page.evaluate(p=>window.explorerDev.aimPoint(p),[target[0],target[1]-0.3,target[2]]);await page.mouse.down();await sleep(80);await page.mouse.up();await sleep(1200);}
 await sleep(1500);return {node:node.prefab,gathered:countOf(await inventoryCells(page),re)-before};
}
function compare(a,b){
 const key=c=>c.map(x=>`${x.slot}:${x.name}x${x.count}`).join(',');
 const d=a.position&&b.position?+distXZ(a.position,b.position).toFixed(2):null,dy=a.position&&b.position?+Math.abs(a.position[1]-b.position[1]).toFixed(2):null;
 const inv=key(a.inventory)===key(b.inventory),hp=a.vitals&&b.vitals?+(b.vitals.health-a.vitals.health).toFixed(1):null,cal=a.vitals&&b.vitals?b.vitals.calories-a.vitals.calories:null;
 return {positionDeltaM:d,heightDeltaM:dy,samePosition:d!=null&&d<1&&dy<1,sameInventory:inv,healthDelta:hp,caloriesDelta:cal,before:{position:a.position,inventory:key(a.inventory),vitals:a.vitals},after:{position:b.position,inventory:key(b.inventory),vitals:b.vitals}};
}

if(phase==='before'){
 const all=[...Array(nBots+nHold)].map((_,i)=>i+1),sessions=new Map();
 // Joins overlap (a headless island load takes minutes); staggered so the loads do not all start at once.
 await Promise.all(all.map(async(n,i)=>{await sleep(i*20000);
  try{log('bot',n,'joining');const {s,me,j}=await joinBot(n);sessions.set(n,s);
   const g=await gather(s);await hold(s.page,['KeyD'],1500);await sleep(3000);
   const snap={...await snapshot(s),gather:g,joinMs:j.inGameMs,spawn:j.spawned.position,player:me.player};
   (n<=nBots?state.bots:state.hold).push({n,...snap});log('bot',n,'recorded',JSON.stringify({pos:snap.position,inv:snap.inventory.map(c=>c.name+'x'+c.count).join(','),hp:snap.vitals?.health,g}));await save();
  }catch(e){log('bot',n,'failed:',e.message);(n<=nBots?state.bots:state.hold).push({n,error:e.message});await save();}
 }));
 // Persist bots leave (sleepers); hold bots look for sleepers, then stay on through the stop.
 for(const b of state.bots){const s=sessions.get(b.n);if(!s)continue;b.leftAt=new Date().toISOString();await s.close();}
 await sleep(8000);for(const h of state.hold){const s=sessions.get(h.n);if(s)h.sleepersBeforeStop=sleepers(s.frames);}
 state.leftAt=new Date().toISOString();await save();
 log(`persist bots left at ${state.leftAt}; ${state.hold.filter(h=>sessions.has(h.n)).length} hold bot(s) stay connected. Stop the server now (06-Stop-Server.ps1), then start it (05).`);
 const deadline=Date.now()+waitMinutes*60000;
 await Promise.all(state.hold.filter(h=>sessions.has(h.n)).map(async h=>{
  const s=sessions.get(h.n);
  while(s.socketOpen()&&Date.now()<deadline)await sleep(1000);
  const end=s.frames.rx(0,f=>f.type==='kicked'||f.type==='disconnected'||f.type==='error').at(-1);
  h.sessionEnded={at:new Date().toISOString(),reason:end?.reason??null,type:end?.type??null,lastRxAgoMs:s.frames.frames.length?Date.now()-s.frames.frames.at(-1).t:null,pageState:await s.page.evaluate(()=>window.explorerState?.online?.state??null).catch(()=>null),
   shown:await s.page.evaluate(()=>document.querySelector('#disconnect, .disconnect, [data-disconnect], #menu-error, .error-dialog')?.textContent?.trim().slice(0,200)??null).catch(()=>null)};
  log('hold bot',h.n,'session ended',JSON.stringify(h.sessionEnded));await save();
  h.attempts=[];
  while(Date.now()<deadline){
   await sleep(30000);const t=Date.now();
   try{await s.page.goto(origin+'/',{waitUntil:'load'});const j=await joinViaWebsite(s,{origin,serverId:cfg.serverId,gameUrl:cfg.gameUrl,loadMs:Math.min(cfg.loadMs,300000)});await lockPointer(s.page);await sleep(5000);
    h.attempts.push({at:new Date(t).toISOString(),ok:true,ms:Date.now()-t});h.afterRestart={...await snapshot(s),spawn:j.spawned.position,joinMs:j.inGameMs};h.result=compare(h,{...h.afterRestart,position:j.spawned.position});
    log('hold bot',h.n,'back in',JSON.stringify(h.result));await save();break;}
   catch(e){h.attempts.push({at:new Date(t).toISOString(),ok:false,error:e.message.slice(0,200)});log('hold bot',h.n,'join attempt failed:',e.message.slice(0,120));await save();}
  }
 }));
 state.beforeDoneAt=new Date().toISOString();await save();
}else{
 state.after=[];
 for(const b of state.bots.filter(b=>!b.error)){
  try{const {s,j}=await joinBot(b.n);await sleep(5000);const snap={...await snapshot(s),spawn:j.spawned.position,joinMs:j.inGameMs};
   const result=compare(b,{...snap,position:j.spawned.position});state.after.push({n:b.n,...snap,result});log('bot',b.n,JSON.stringify(result));await save();await s.close();}
  catch(e){state.after.push({n:b.n,error:e.message});log('bot',b.n,'failed',e.message);await save();}
 }
 const r=[...state.after.map(a=>a.result),...state.hold.map(h=>h.result)].filter(Boolean);
 state.summary={bots:r.length,samePosition:r.filter(x=>x.samePosition).length,sameInventory:r.filter(x=>x.sameInventory).length,maxPositionDeltaM:Math.max(0,...r.map(x=>x.positionDeltaM??0)),healthDeltas:r.map(x=>x.healthDelta)};
 log('summary',JSON.stringify(state.summary));await save();
}
for(const b of browsers)await b.close().catch(()=>{});
await mockEnv?.close().catch(()=>{});
