// Gameplay test matrix (SERVER-TESTING-PLAN.md sections 5-7) against a REAL endpoint: the website (central) on the
// host, the gateway + original server inside the isolated VM. One headless browser player signs in, joins through the
// website like a player (one-use join ticket -> /play, the normal entry, no ?dev) and runs each row. Assertions read
// only what the server sends (the gateway WebSocket frames the page receives) and the page state built from it.
// Admin rows use F1 console forwarding (rcon.login when RLB_NATIVE_RCON_PASSWORD / rconPasswordEnv is set) and skip
// cleanly without admin rights. Admin tools rows (ANTICHEAT-ADMIN-PLAN.md slices 3-4) act from the website API as the
// player (who needs an admin role on the server there) on a second signed-in browser player ("target") and on a desktop
// client connected inside the VM ("desktop"); they wait for the server plugin's result through central.
// Results: analysis/native-runs/<timestamp>/results.json + results.md + screenshots.
//
//   npm run test:native -- --config deploy/native-test.example.json [--rows move.*,chat.say] [--dry] [--list]
//   npm run test:native -- --mock          self-test against the mock stack (only the Legacy server is mocked)
//
// Never executes original binaries; against the VM it only talks HTTP/WebSocket to the host central and VM gateway.
import path from 'node:path';
import {parseArgs,loadConfig,validateConfig,redactConfig,ROWS,selectRows,plannedSkip,createRecorder,writeResults,toMarkdown,runStamp,ok,
 consoleMessage,consoleCommand as isConsoleCommand,decodeSkyState,clockDrift,readSecret,withDefaults} from './native/lib.mjs';
import {launchBrowser,openPlayer,signIn,joinViaWebsite,lockPointer,hold,f1,consoleCommand,say,feet,toUnity,distXZ,inventoryCells,countOf,
 openInventory,closeInventory,dragCell,cellSelector,settle,siteApi} from './native/driver.mjs';
import {readGraphics} from './qa-browser.mjs';
import {spawnLook} from '../browser/net-client.mjs';
import {createGameplayRows} from './native/gameplay.mjs';
import {createAntiCheatRows} from './native/anticheat-rows.mjs';

const HELP=`usage: node tools/check-native.mjs [--config file] [--mock] [--dry] [--list] [--rows filter] [--out dir]
 --rows   comma list of row ids, globs (move.*), systems (Movement) or all; "-id" excludes
 --dry    validate the config and print the planned rows; no browser, no network
 --mock   self-test against the in-process mock stack (central + sidecar + gateway, mock uLink server)
 env      RLB_NATIVE_CENTRAL, RLB_NATIVE_SERVER, RLB_NATIVE_LOGIN + RLB_NATIVE_PASSWORD, RLB_NATIVE_RCON_PASSWORD,
          RLB_NATIVE_IGNORE_HTTPS_ERRORS=1 (self-signed VM test certificate),
          RLB_NATIVE_TARGET_LOGIN + RLB_NATIVE_TARGET_PASSWORD, RLB_NATIVE_DESKTOP_NAME (Admin tools rows)`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const circ=(a,b)=>{const d=Math.abs(a-b)%24;return Math.min(d,24-d);};

let opts;try{opts=parseArgs(process.argv.slice(2));}catch(e){console.error(e.message+'\n'+HELP);process.exit(2);}
if(opts.help){console.log(HELP);process.exit(0);}
if(opts.list){for(const r of ROWS)console.log(`${r.id.padEnd(18)} ${r.system.padEnd(20)} ${r.manual?'manual':r.mock===false?'real-only':r.mock==='partial'?'mock-partial':'mock+real'}${r.admin?' admin':''}${r.site?' site-admin':''}${r.needs?' needs '+r.needs.join('+'):''}  ${r.title}`);process.exit(0);}
// Mock: the target is a second dev account; the desktop name is the fake desktop player tools/native/mock.mjs lists.
const MOCK_CONFIG={player:{auth:'dev',subject:'native-tester',name:'NativeTester'},target:{auth:'dev',subject:'native-target',name:'NativeTarget'},desktop:{name:'DeskTester'}};
let cfg;try{cfg=opts.mock?withDefaults(MOCK_CONFIG):loadConfig({file:opts.config});}catch(e){console.error('config: '+e.message);process.exit(2);}
const problems=validateConfig(cfg,{mock:opts.mock});
let selected;try{selected=selectRows(ROWS,opts.rows);}catch(e){console.error(e.message);process.exit(2);}
if(opts.dry||problems.length){
 console.log(JSON.stringify({mode:opts.mock?'mock':'real',config:redactConfig(cfg),problems},null,1));
 for(const r of selected)console.log(`${r.id.padEnd(18)} ${plannedSkip(r,{mock:opts.mock,config:cfg})??(r.admin?'run if admin':r.site?'run if website admin':'run')}`);
 process.exit(problems.length?1:0);
}

// ---- admin --------------------------------------------------------------------------------------------------------
// rcon.login <password> (the original's only in-game admin path; a WRONG password kicks, NetError Facepunch_Kick_RCON),
// then the [Admin] global.status as probe: non-admins get no reply at all (ConsoleSystem permission check).
// Per session (the player and the target each log in); the state belongs to the NetUser, so a rejoin clears it.
async function ensureAdmin(s=ctx.session){
 const a=s.adminState??={ok:null};
 if(a.ok===null){
  a.evidence={};
  if(ctx.rcon){const l=await consoleCommand(s,'rcon.login '+ctx.rcon,{ms:cfg.replyMs});a.evidence.login=l.text;
   if(!s.socketOpen()){a.ok=false;a.why='rcon.login closed the session (wrong password kicks)';}}
  if(a.ok===null){
   const st=await consoleCommand(s,'status',{match:/hostname:/,ms:cfg.replyMs});a.evidence.status=st.text?.split('\n').slice(0,4).join(' | ')??null;a.evidence.statusRttMs=st.rttMs;
   a.ok=Boolean(st.reply);a.why=a.ok?null:ctx.rcon?`status gave no reply after rcon.login (${a.evidence.login??'no reply'})`:'no rcon password configured and status gave no reply';
  }
 }
 if(s===ctx.session){ctx.admin=a.ok;ctx.adminWhy=a.why;ctx.adminEvidence=a.evidence;}
 return a.ok;
}

// ---- website admin (Admin tools rows) -------------------------------------------------------------------------------
// The player's own website session (the game page shares the website origin). Bring, bans and the policy need admin.
const api=(method,p,data,s=ctx.session)=>siteApi(s.page,method,p,data);
const adminPath=()=>`/admin/servers/${encodeURIComponent(cfg.serverId)}`;
async function ensureSiteAdmin(){
 if(ctx.siteRole!==undefined)return ctx.siteOk;
 const r=await api('GET','/admin/servers'),s=r.body?.servers?.find(x=>x.id===cfg.serverId);
 ctx.siteRole=s?.role??null;ctx.siteOk=['admin','owner','staff'].includes(ctx.siteRole);
 ctx.siteWhy=ctx.siteOk?null:s?`website role "${s.role}" on this server is below admin`:`the player has no role on this server on the website (GET /admin/servers: ${r.status})`;
 return ctx.siteOk;
}
// Second browser player (cfg.target): signed in once, joined (again) whenever a row needs it in game.
async function targetPlayer({inGame=true}={}){
 if(!ctx.target){
  if(ctx.targetError)return null;
  try{const s=await openPlayer(browser,{viewport:cfg.viewport,ignoreHttpsErrors:cfg.ignoreHttpsErrors,redact:secrets});ctx.target={session:s,me:null};ctx.target.me=await signIn(s.page,ctx.origin,cfg.target);}
  catch(e){ctx.targetError='target sign-in failed: '+e.message.split('\n')[0];return null;}
 }
 if(inGame&&!ctx.target.session.socketOpen()){
  try{const j=await joinRetrying(ctx.target.session);ctx.target.session.adminState=null;if(mockEnv)mockEnv.referee.nameFor(j.approved.playerId,ctx.target.me.name);}
  catch(e){ctx.targetWhy='target could not join: '+e.message.split('\n')[0];return null;}
 }
 return ctx.target;
}
const noTarget=()=>skip(ctx.targetError??ctx.targetWhy);
// The website join with retries: the identity lease is released when the server reports the disconnect, so a quick
// rejoin may be told already-connected. connection-failed is retried too: the VM host app's watchdog UDP probe
// (host/host.mjs, H12) can land within the same handshake window as a real join and win the native server's
// handshake slot, so the gateway's 5 retries run out on a server that is actually up (2026-10-29, coordinator-
// confirmed from the gateway/server log timestamps). Retry with a fresh ticket like a player pressing Join again.
async function joinRetrying(s){
 const attempts=[];
 for(let i=0;;i++){
  try{return {...await joinViaWebsite(s,{origin:ctx.origin,serverId:cfg.serverId,gameUrl:cfg.gameUrl,loadMs:cfg.loadMs}),attempts};}
  catch(e){attempts.push(e.message);if(!/already-connected|connection-failed/.test(e.message)||i===3)throw Object.assign(e,{message:e.message+` (attempts: ${attempts.length})`});await s.page.goto(ctx.origin+'/',{waitUntil:'load'});await sleep(5000);}
 }
}
// POST .../command -> {id} or {error}.
async function issue(data){const r=await api('POST',`${adminPath()}/command`,data);return r.status===202?{id:r.body.command}:{error:r.body?.error??'HTTP '+r.status};}
// The newest command of this action on this account since t (bans and unbans queue their native command themselves).
async function findCommand(action,player,t){
 const end=Date.now()+cfg.replyMs;
 while(Date.now()<end){const c=(await api('GET',`${adminPath()}/commands`)).body?.commands?.find(x=>x.action===action&&x.player===player&&x.createdAt>=t-60000);if(c)return c.id;await sleep(500);}
 return null;
}
// Waits for the plugin's result as central records it: done, failed (reason), no-result.
async function commandResult(id){
 const t=Date.now(),end=t+cfg.adminWaitMs;let c=null;
 while(Date.now()<end){c=(await api('GET',`${adminPath()}/commands`)).body?.commands?.find(x=>x.id===id)??null;if(c&&c.status!=='queued'&&c.status!=='sent')break;await sleep(1000);}
 return {status:c?.status??'missing',reason:c?.reason??null,ms:Date.now()-t};
}
const commandFailed=(res,ev={})=>res.status!=='done'&&fail(`command ${res.status}${res.reason?` (${res.reason})`:''}`,{...ev,command:res});
// The admin console (/admin?server=<id>) in a second tab of the player's context, at a desktop size; check(page) ->
// boolean. The screenshot shows `panel`, scrolled to just below the sticky site header.
async function onAdminPage(r,name,panel,check){
 const p=await ctx.session.context.newPage();
 try{
  await p.setViewportSize({width:1440,height:900});
  await p.goto(`${ctx.origin}/admin?server=${encodeURIComponent(cfg.serverId)}`,{waitUntil:'load'});await p.waitForSelector('body[data-ready="1"]',{timeout:30000});
  const shown=await check(p);await p.evaluate(s=>{const el=document.querySelector(s);if(el)window.scrollTo(0,el.getBoundingClientRect().top+scrollY-80);},panel).catch(()=>{});await ctx.shot(r,name,p);return shown;
 }finally{await p.close().catch(()=>{});await ctx.session.page.bringToFront().catch(()=>{});}
}
async function desktopEntry(name,ms){
 const end=Date.now()+ms;
 for(;;){const r=(await api('GET',`${adminPath()}/players`)).body,d=r?.desktop?.find(x=>x.name===name);if(d||Date.now()>=end)return {entry:d??null,players:r};await sleep(2000);}
}
// Movement flags the gateway's anti-cheat has on an account (admin roster), once a report newer than `after` is in.
const MOVE_FLAGS=['teleport','speed','fly','noclip','under-terrain'];
async function movementFlags(subject,after){
 const end=Date.now()+cfg.adminWaitMs;let r;
 do{r=(await api('GET',`${adminPath()}/players`)).body;if(r?.reportedAt>after)break;await sleep(500);}while(Date.now()<end);
 const f=r?.players?.find(p=>p.player===subject)?.flags??{};return Object.fromEntries(MOVE_FLAGS.filter(k=>f[k]).map(k=>[k,f[k]]));
}
// teleport-to / bring: the moved character receives UnstickMove, ends up next to the other one, and can then walk on
// without the gateway dropping or flagging its moves (the server moved it, so the old position is no baseline).
async function teleportRow(r,action){
 const tg=await targetPlayer();if(!tg)return noTarget();
 const [moved,other]=action==='teleport-to'?[ctx.session,tg.session]:[tg.session,ctx.session];
 const movedSubject=action==='teleport-to'?ctx.me.player:tg.me.player;
 // Characters can start close together (a shared spawn point): walk apart past the gateway's 25 m teleport limit,
 // so a gateway that ignored the teleport would drop the moved player's next moves rather than just flag them.
 // Each try faces away from the other player (turned 90° more per try, in case something blocks the way) and sprints.
 let from=toUnity(await feet(moved.page)),to=toUnity(await feet(other.page));
 await lockPointer(moved.page);
 for(let i=0;i<5&&distXZ(from,to)<30;i++){
  const a=await feet(moved.page),b=await feet(other.page),away=(Math.hypot(a[0]-b[0],a[2]-b[2])>1?Math.atan2(a[2]-b[2],a[0]-b[0]):0)+i*Math.PI/2;
  await moved.page.evaluate(p=>window.explorerDev.aimPoint(p),[a[0]+50*Math.cos(away),a[1]+1.5,a[2]+50*Math.sin(away)]);
  await hold(moved.page,['ShiftLeft','KeyW'],2500);await sleep(500);from=toUnity(await feet(moved.page));to=toUnity(await feet(other.page));
 }
 if(distXZ(from,to)<30)return skip('could not walk the characters 30 m apart, so a teleport would not test the gateway',{distance:+distXZ(from,to).toFixed(2)});
 const before=await movementFlags(movedSubject,Date.now()),t=Date.now()-1;
 const c=await issue({player:tg.me.player,action});if(c.error)return fail('the website refused the command: '+c.error);
 const res=await commandResult(c.id),u=await moved.frames.waitFor(t,f=>f.dir==='rx'&&f.type==='rpc'&&f.name==='UnstickMove',3000);
 await sleep(1000);const end=toUnity(await feet(moved.page));await ctx.shot(r,'moved',moved.page);
 const ev={command:res,unstick:u?.values?.[0]??null,otherUnity:to,startDistance:+distXZ(from,to).toFixed(2),endDistance:+distXZ(end,to).toFixed(2)};
 if(res.status!=='done')return commandFailed(res,ev);
 if(!u)return fail('command done but no UnstickMove reached the moved character',ev);
 if(ev.endDistance>=3)return fail('UnstickMove received but the character is not next to the other player',ev);
 // Walk on past the gateway's 2 s grace after a server move, then compare the account's movement flags.
 await lockPointer(moved.page);await hold(moved.page,['KeyW'],3000);
 const after=await movementFlags(movedSubject,Date.now());ev.walkedAfter=+distXZ(toUnity(await feet(moved.page)),end).toFixed(2);
 ev.newFlags=Object.fromEntries(Object.entries(after).filter(([k,n])=>n>(before[k]??0)).map(([k,n])=>[k,n-(before[k]??0)]));
 return Object.keys(ev.newFlags).length?fail('the gateway flagged the teleported player\'s moves (it kept the old position as the baseline)',ev):pass(ev);
}
const token=()=>'native-'+Math.random().toString(36).slice(2,8);

// ---- rows ---------------------------------------------------------------------------------------------------------
const pass=(evidence,reason=null)=>({status:'pass',evidence,reason});
const fail=(reason,evidence={})=>({status:'fail',reason,evidence});
const skip=(reason,evidence={})=>({status:'skip',reason,evidence});
const gnupAfter=t=>ctx.session.frames.waitFor(t,f=>f.dir==='rx'&&f.type==='rpc'&&f.name==='GNUP'&&f.viewId===ctx.session.frames.characterView,cfg.replyMs);
const RUN={
 async 'join.inventory'(){
  const {frames,page}=ctx.session,g=await frames.waitFor(ctx.joinedAt-60000,f=>f.dir==='rx'&&f.type==='rpc'&&f.name==='GNUP'&&f.viewId===frames.characterView,cfg.replyMs);
  if(!g)return fail('no GNUP for our character');
  await sleep(500);const cells=await inventoryCells(page),names=cells.map(c=>`${c.name} x${c.count} @${c.slot}`);
  const missing=['Rock','Torch','Bandage'].filter(n=>!cells.some(c=>c.name===n));
  return missing.length?fail('missing from the initial inventory: '+missing.join(', '),{items:names}):pass({gnupBytes:g.values?.[0]?.bytes,items:names});
 },
 async 'time.sky'(r){
  const {frames,page}=ctx.session,f=await frames.waitFor(ctx.joinedAt-60000,x=>x.dir==='rx'&&x.type==='rpc'&&x.name==='CL_UpdateSkyState',cfg.skyWaitMs);
  if(!f)return fail(`no CL_UpdateSkyState within ${cfg.skyWaitMs/1000} s`);
  const sky=decodeSkyState(f.values?.[0]);if(!sky)return fail('CL_UpdateSkyState payload not 38 bytes');
  const latest=frames.rx(0,x=>x.type==='rpc'&&x.name==='CL_UpdateSkyState').at(-1),server=decodeSkyState(latest.values[0]);
  const pageSky=await page.evaluate(()=>window.explorerDev?.onlineSky?.()??null);ctx.serverHour=server.hour;
  const d=pageSky?circ(pageSky.hour,server.hour):null;
  await ctx.shot(r,'sky');
  return pageSky&&d<0.5?pass({server,pageHour:pageSky.hour,received:frames.rx(0,x=>x.name==='CL_UpdateSkyState').length}):fail('page sky does not follow the server hour',{server,pageSky});
 },
 async 'time.clock'(){
  // Two forwarded findsv probes ~10 s apart (User-level, so any account gets replies) plus every timestamped RPC
  // between them: server time elapsed (gateway serverMs, from uLink clock sync) against local receive time.
  const {frames}=ctx.session,t=Date.now()-1,carry=f=>f.dir==='rx'&&f.type==='rpc'&&Number.isFinite(f.serverMs);
  const a=await consoleCommand(ctx.session,'findsv clock',{ms:cfg.replyMs});await sleep(10000);const b=await consoleCommand(ctx.session,'findsv clock',{ms:cfg.replyMs});
  const d=clockDrift(frames.since(t,carry));
  if(!d)return fail('no RPCs with a server timestamp (gateway clock sync missing?)',{probeReplies:[Boolean(a.reply),Boolean(b.reply)]});
  const ev={...d,ratio:+d.ratio.toFixed(4),errorMs:Math.round(d.serverMs-d.localMs),probeRttMs:[a.rttMs,b.rttMs]};
  if(d.localMs<5000)return skip('not enough time between timestamped RPCs',ev);
  return Math.abs(d.serverMs-d.localMs)<=Math.max(500,0.05*d.localMs)?pass(ev):fail('server clock drifts against local time',ev);
 },
 async 'move.walk'(r){
  const {frames,page}=ctx.session;await lockPointer(page);const start=await feet(page),t=Date.now();let max=0;
  const half=cfg.walkSeconds*500,track=setInterval(async()=>{const p=await feet(page).catch(()=>null);if(p)max=Math.max(max,distXZ(p,start));},250);
  try{await hold(page,['KeyW'],half);await hold(page,['KeyS'],half);}finally{clearInterval(track);}
  await sleep(1500);const end=await feet(page),moves=frames.tx(t,f=>f.type==='move'),corr=frames.corrections(t);
  await ctx.shot(r,'after');
  const ev={seconds:cfg.walkSeconds,maxDistance:+max.toFixed(2),endDistance:+distXZ(end,start).toFixed(2),movesSent:moves.length,moveRate:+(moves.length/cfg.walkSeconds).toFixed(1),corrections:corr.length,correctionSamples:corr.slice(0,3).map(c=>({name:c.name,values:c.values}))};
  if(corr.length)return fail(`${corr.length} server corrections while walking`,ev);
  if(!moves.length)return fail('no moves sent',ev);
  return max>1?pass(ev):fail('character did not move (blocked at spawn?)',ev);
 },
 async 'move.modes'(){
  const {frames,page}=ctx.session;await lockPointer(page);const t=Date.now(),phases={},ms=cfg.modeSeconds*1000;
  const run=async(name,keys,extra)=>{const s=Date.now();if(extra)await Promise.all([hold(page,keys,ms),extra()]);else await hold(page,keys,ms);await sleep(300);phases[name]=frames.tx(s,f=>f.type==='move').reduce((a,f)=>a|(f.stateFlags??0),0);};
  await run('sprint',['ShiftLeft','KeyW']);await run('crouch',['ControlLeft','KeyS']);
  await run('jump',['KeyW'],async()=>{for(let i=0;i<2;i++){await sleep(300);await page.keyboard.down('Space');await sleep(150);await page.keyboard.up('Space');await sleep(600);}});
  await sleep(1000);const corr=frames.corrections(t),ev={flags:phases,corrections:corr.length};
  const missing=[['sprint',2],['crouch',1],['jump',16]].filter(([p,bit])=>!(phases[p]&bit)).map(([p])=>p);
  if(corr.length)return fail(`${corr.length} server corrections`,ev);
  return missing.length?fail('state flag never sent for: '+missing.join(', '),ev):pass(ev);
 },
 async 'chat.say'(r){
  const {frames,page}=ctx.session,token='native-'+Math.random().toString(36).slice(2,8),t=Date.now()-1;await say(page,'hello '+token);
  const echo=await frames.waitFor(t,f=>isConsoleCommand(f)&&f.values[0].startsWith('chat.add')&&f.values[0].includes(token),cfg.replyMs);
  const sent=frames.tx(t,f=>f.type==='rpc'&&f.name==='SV_RunConsoleCommand').map(f=>f.values?.[0]);
  await ctx.shot(r,'chat');
  return echo?pass({sent,line:echo.values[0],rttMs:echo.t-t}):fail('no chat.add echo from the server',{sent});
 },
 async 'console.forward'(){
  const c=await consoleCommand(ctx.session,'findsv chat',{match:/^Finding chat/,ms:cfg.replyMs});
  return c.reply?pass({rttMs:c.rttMs,reply:c.text.split('\n').slice(0,3).join(' | ')}):fail('no CL_ConsoleMessage reply to findsv');
 },
 async 'inventory.move'(r){
  const {frames,page}=ctx.session,before=await inventoryCells(page);
  const src=[...before].reverse().find(c=>c.slot>=30&&c.name!=='Rock')??before.find(c=>c.name!=='Rock');if(!src)return skip('no movable item',{before});
  const used=new Set(before.map(c=>c.slot)),dst=[...Array(30).keys()].find(i=>!used.has(i));if(dst==null)return skip('no free bag cell');
  if(!await openInventory(page))return fail('inventory did not open (Tab)');
  const t=Date.now();await dragCell(page,cellSelector(src.slot),cellSelector(dst));
  const sent=await frames.waitFor(t,f=>f.dir==='tx'&&f.type==='inventory',3000),g=sent&&await gnupAfter(sent.t);
  await sleep(400);await ctx.shot(r,'moved');const after=await inventoryCells(page);await closeInventory(page);await lockPointer(page);
  const ev={item:src.name,from:src.slot,to:dst,sent:sent&&{action:sent.action},gnupRttMs:g?g.t-sent.t:null,landed:after.find(c=>c.slot===dst)?.name??null};
  if(!sent)return fail('the UI sent no inventory request',ev);
  return g?pass(ev):fail('no GNUP after the move request',ev);
 },
 async 'console.admin'(){return ctx.admin?pass({...ctx.adminEvidence,login:ctx.adminEvidence.login??'(no rcon.login: already admin)'}):skip(ctx.adminWhy);},
 async 'inventory.give'(){
  const {page}=ctx.session,before=countOf(await inventoryCells(page),/^Wood$/),t=Date.now()-1;
  const c=await consoleCommand(ctx.session,'inv.give "Wood" 10',{ms:cfg.replyMs}),g=await gnupAfter(t);await sleep(500);
  const after=countOf(await inventoryCells(page),/^Wood$/),ev={reply:c.text,woodBefore:before,woodAfter:after,gnupMs:g?g.t-t:null};
  return g&&after>before?pass(ev):fail(g?'GNUP arrived but Wood did not increase':'no GNUP after inv.give',ev);
 },
 async 'time.env'(r){
  const {frames,page}=ctx.session,from=ctx.serverHour??(await page.evaluate(()=>window.explorerDev?.onlineSky?.()?.hour??null)),target=from!=null&&circ(from,12)<2?18:12,t=Date.now()-1;
  const c=await consoleCommand(ctx.session,'env.time '+target,{match:/Time/,ms:cfg.replyMs});
  const f=await frames.waitFor(t,x=>x.dir==='rx'&&x.name==='CL_UpdateSkyState'&&circ(decodeSkyState(x.values?.[0])?.hour??-99,target)<0.1,cfg.skyWaitMs);
  await sleep(500);const pageHour=await page.evaluate(()=>window.explorerDev?.onlineSky?.()?.hour??null);await ctx.shot(r,'sky');
  if(from!=null)await consoleCommand(ctx.session,'env.time '+from.toFixed(2),{ms:cfg.replyMs}); // put the server back
  const ev={target,reply:c.text,skyMs:f?f.t-t:null,pageHour,restoredTo:from};
  if(!c.reply)return fail('no reply to env.time',ev);
  if(!f)return fail('reply but no CL_UpdateSkyState with the new hour',ev);
  return circ(pageHour??-99,target)<0.25?pass(ev):fail('page sky did not follow env.time',ev);
 },
 async 'gather.node'(r){
  const {frames,page}=ctx.session,gone=new Set(frames.rx(0,f=>f.type==='ngc-destroy').map(f=>f.carrier+':'+f.innerID));
  const here=toUnity(await feet(page));
  const nodes=frames.rx(0,f=>f.type==='ngc-create'&&/^;res_/.test(f.prefab??'')&&!gone.has(f.carrier+':'+f.innerID)).map(f=>({prefab:f.prefab,position:f.position,d:distXZ(f.position,here)})).sort((a,b)=>a.d-b.d);
  const node=nodes[0];if(!node||node.d>cfg.gatherRadius)return skip(`no server resource node within ${cfg.gatherRadius} m`,{nearest:node??null,known:nodes.length});
  const cells=await inventoryCells(page),rock=cells.find(c=>c.name==='Rock'&&c.slot>=30);if(!rock)return skip('no Rock on the belt');
  await lockPointer(page);await page.keyboard.press('Digit'+(rock.slot-29));await sleep(800);
  // Walk at the node's centre. Its own collider stops us short of it (1.83 m from a ;res_ore_3 on the VM), which is
  // still in reach: the Rock swings a 0.3 m sphere 2 m from the eyes (MeleeWeaponDataBlock.range). So "arrived" is
  // within 1.6 m, or within 3 m once three steps in a row gain less than 5 cm.
  const target=[node.position[0],node.position[1]+0.6,-node.position[2]],end=Date.now()+45000;let d=Infinity,stalled=0,blocked=false;
  while(Date.now()<end){const prev=d;d=distXZ(await feet(page),[target[0],0,target[2]]);if(d<1.6)break;stalled=prev-d<0.05?stalled+1:0;if(d<3&&stalled>=3){blocked=true;break;}await page.evaluate(p=>window.explorerDev.aimPoint(p),target);await hold(page,['KeyW'],Math.min(400,d*250));}
  if(d>=1.6&&!blocked)return fail('could not walk to the node',{node,distance:+d.toFixed(2)});
  const gatherable=/^(Wood|Stones|Metal Ore|Sulfur Ore|Animal Fat|Leather|Cloth)$/,before=countOf(await inventoryCells(page),gatherable),t=Date.now();
  for(let i=0;i<6;i++){await page.evaluate(p=>window.explorerDev.aimPoint(p),[target[0],target[1]-0.3,target[2]]);await page.mouse.down();await sleep(80);await page.mouse.up();await sleep(1200);}
  await sleep(1000);const after=countOf(await inventoryCells(page),gatherable);await ctx.shot(r,'gathered');
  const ev={node,distance:+d.toFixed(2),blocked,swingsSent:frames.tx(t,f=>f.type==='item').length,gnups:frames.rx(t,f=>f.name==='GNUP').length,notices:frames.rx(t,f=>isConsoleCommand(f)&&/^notice/.test(f.values[0])).map(f=>f.values[0]).slice(0,3),before,after,nodeCalls:frames.rx(t,f=>f.type==='ngc-call').map(f=>f.name).slice(0,5)};
  return after>before?pass(ev):fail('no resources added after six swings',ev);
 },
 async 'airdrop.drop'(r){
  const {frames}=ctx.session,t=Date.now()-1,c=await consoleCommand(ctx.session,'airdrop.drop',{match:/airdrop/i,ms:cfg.replyMs});
  const plane=await frames.waitFor(t,f=>f.dir==='rx'&&f.type==='create'&&/C130/.test(f.prefab??''),cfg.airdropWaitMs);
  if(plane)await ctx.shot(r,'plane');
  const ev={reply:c.text,planeMs:plane?plane.t-t:null,planeAt:plane?.position??null,crate:Boolean(frames.rx(t,f=>f.type==='create'&&/SupplyCrate/.test(f.prefab??'')).length)};
  return !c.reply?fail('no reply to airdrop.drop',ev):plane?pass(ev):fail(`no C130 within ${cfg.airdropWaitMs/1000} s`,ev);
 },
 async 'wildlife.seen'(){
  const {frames}=ctx.session,re=/wolf|bear|boar|chicken|rabbit|stag|deer|mutant/i;
  let animals=frames.rx(0,f=>f.type==='create'&&re.test(f.prefab??''));if(!animals.length){await sleep(20000);animals=frames.rx(0,f=>f.type==='create'&&re.test(f.prefab??''));}
  const ids=new Set(animals.map(a=>a.viewId)),updates=frames.rx(0,f=>f.type==='rpc'&&ids.has(f.viewId)&&/NetworkUpdate|Move/.test(f.name));
  const ev={animals:animals.length,prefabs:[...new Set(animals.map(a=>a.prefab))],movementUpdates:updates.length};
  if(!animals.length)return skip('no animals within network range of the spawn',ev);
  return updates.length?pass(ev):fail('animals created but never updated',ev);
 },
 async 'death.suicide'(r){
  const {frames,page}=ctx.session,t=Date.now()-1,oldView=frames.characterView;
  const c=await consoleCommand(ctx.session,'suicide',{ms:cfg.replyMs});
  const shown=await page.waitForSelector('#death:not([hidden])',{timeout:cfg.replyMs}).then(()=>true,()=>false);
  const deathRpcs=frames.rx(t,f=>f.type==='rpc'&&f.viewId===oldView).map(f=>f.name);
  if(!shown)return fail('no death screen',{reply:c.text,deathRpcs});
  await sleep(1500);await ctx.shot(r,'death');const reason=await page.evaluate(()=>document.querySelector('#death-reason, #death .death-info')?.textContent?.trim()??null);
  await page.waitForFunction(()=>{const b=document.querySelector('#respawn');return b&&!b.disabled&&b.offsetParent!==null;},{},{timeout:15000}).catch(()=>{});
  const tr=Date.now();await page.locator('#respawn').click();
  const req=await frames.waitFor(tr,f=>f.dir==='tx'&&f.type==='rpc'&&f.name==='RequestRespawn',5000);
  const spawned=await frames.waitFor(tr,f=>f.dir==='rx'&&f.type==='create'&&f.mine&&f.prefab===':player_soldier',cfg.replyMs*2);
  const back=spawned&&await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&document.querySelector('#death')?.hidden,{},{timeout:cfg.replyMs*2}).then(()=>true,()=>false);
  if(back){await lockPointer(page);await sleep(500);await ctx.shot(r,'respawned');}
  const ev={reply:c.text,deathRpcs:[...new Set(deathRpcs)],reason,respawnRequest:Boolean(req),newView:spawned?.viewId??null,respawnMs:spawned?spawned.t-tr:null,position:spawned?.position??null};
  return back?pass(ev):fail(req?'respawn requested but no new character':'the respawn button sent nothing',ev);
 },
  // GAP-AUDIT A4-5: SpawnPlayer -> Character.SummonCharacter(pos, rot) with the spawn point's (or bag/bed's) rotation;
 // Character.EyesSetup then looks level along it. Look up and away first, so keeping the dead character's look fails.
 async 'join.facing'(r){
  const {frames,page}=ctx.session,f=await feet(page),deg=a=>+(a*180/Math.PI).toFixed(1),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
  await page.evaluate(p=>window.explorerDev.aimPoint(p),[f[0]+6,f[1]+7,f[2]+4]);await sleep(300);
  const before=await page.evaluate(()=>window.explorerDev.look());
  const died=await RUN['death.suicide'](r);if(died.status!=='pass')return fail('no respawn: '+(died.reason??'death.suicide failed'),died.evidence);
  const look=await page.evaluate(()=>window.explorerDev.look()),view=died.evidence.newView;
  const create=frames.rx(0,x=>x.type==='create'&&x.mine&&x.prefab===':player_soldier'&&x.viewId===view).at(-1);
  if(!create?.rotation)return fail("the new character's Create carried no rotation",{view});
  const expected=spawnLook(create.rotation),dy=wrap(look.yaw-expected.yaw);
  const ev={rotation:create.rotation.map(v=>+v.toFixed(4)),expectedYaw:deg(expected.yaw),look:{yaw:deg(look.yaw),pitch:deg(look.pitch)},
   before:{yaw:deg(before.yaw),pitch:deg(before.pitch)},yawOff:deg(dy),turnedBy:deg(Math.abs(wrap(before.yaw-expected.yaw))),position:create.position};
  if(Math.abs(look.pitch)>0.01)return fail('respawned looking up or down, not level',ev);
  return Math.abs(dy)<0.02?pass(ev):fail('respawned facing away from the spawn rotation',ev);
 },
 async 'join.sleeper'(r){
  const {page,frames}=ctx.session,last=toUnity(await feet(page));
  await page.goto(ctx.origin+'/',{waitUntil:'load'});await sleep(3000);
  const j=await joinRetrying(ctx.session),attempts=j.attempts;
  afterRejoin(j);
  await lockPointer(page);await ctx.shot(r,'rejoined');
  const d=distXZ(j.spawned.position,last),ev={lastUnity:last,spawnUnity:j.spawned.position,distance:+d.toFixed(2),rejoinMs:j.inGameMs,sockets:ctx.session.sockets.length,deniedAttempts:attempts};
  return d<3?pass(ev):fail('rejoined away from the sleeper position',ev);
 },
 'admin.teleport-to':r=>teleportRow(r,'teleport-to'),
 'admin.bring':r=>teleportRow(r,'bring'),
 async 'admin.message'(r){
  const tg=await targetPlayer();if(!tg)return noTarget();
  const tok=token(),t=Date.now()-1,c=await issue({player:tg.me.player,action:'message',message:'Native matrix check '+tok});
  if(c.error)return fail('the website refused the command: '+c.error);
  const res=await commandResult(c.id),line=await tg.session.frames.waitFor(t,f=>isConsoleCommand(f)&&f.values[0].startsWith('chat.add')&&f.values[0].includes(tok),cfg.replyMs);
  await ctx.shot(r,'target-chat',tg.session.page);
  const ev={command:res,line:line?.values[0]??null};
  if(res.status!=='done')return commandFailed(res,ev);
  if(!line)return fail('command done but the target got no chat line',ev);
  return /^chat\.add "?Admin"? /.test(line.values[0])?pass(ev):fail('the chat line is not from "Admin"',ev);
 },
 async 'admin.report'(r){
  // /report <exact name> <text>: the plugin answers privately ("Browser") and posts it to central for the admin page.
  const tg=await targetPlayer();if(!tg)return noTarget();
  const name=tg.me.name;if(/\s/.test(name))return skip('the target display name has a space; /report takes a one-word name',{name});
  const {frames,page}=ctx.session,tok=token(),t=Date.now()-1;await say(page,`/report ${name} ${tok} native matrix check`);
  const reply=await frames.waitFor(t,f=>isConsoleCommand(f)&&/^chat\.add "?Browser"? /.test(f.values[0]),cfg.replyMs);
  let report=null;const end=Date.now()+cfg.adminWaitMs;
  while(!report&&Date.now()<end){report=(await api('GET',`${adminPath()}/reports?status=open`)).body?.reports?.find(x=>x.detail?.includes(tok))??null;if(!report)await sleep(1000);}
  const shown=report?await onAdminPage(r,'reports','section[aria-labelledby="reports-title"]',p=>p.waitForFunction(x=>document.querySelector('#reports')?.textContent.includes(x),tok,{timeout:15000}).then(()=>true,()=>false)):false;
  const broadcast=[...frames.rx(t,f=>isConsoleCommand(f)&&f.values[0].includes(tok)),...tg.session.frames.rx(t,f=>isConsoleCommand(f)&&f.values[0].includes(tok))].length;
  const ev={reply:reply?.values[0]??null,report:report&&{player:report.player,name:report.name,reporterName:report.reporterName,reason:report.reason,detail:report.detail},onAdminPage:shown,broadcast};
  if(!reply)return fail('no reply from the server plugin to /report',ev);
  if(!/Report sent/.test(reply.values[0]))return fail('the plugin did not send the report',ev);
  if(broadcast)return fail('the /report line was broadcast as chat',ev);
  if(!report)return fail('report not listed by the admin API',ev);
  if(report.player!==tg.me.player||report.reason!=='in-game')return fail('report not resolved to the target account as an in-game report',ev);
  return shown?pass(ev):fail('report not shown on the admin page',ev);
 },
 async 'admin.desktop-list'(r){
  const name=cfg.desktop.name,{entry,players}=await desktopEntry(name,cfg.adminWaitMs);
  const ev={online:players?.online??null,desktop:(players?.desktop??[]).map(d=>d.name)};
  if(!entry)return fail(`"${name}" is not in the desktop roster`,ev);
  ctx.desktop=entry;Object.assign(ev,{handle:entry.handle,account:entry.account,linked:Boolean(entry.player)});
  // Central and the page see only handles: no 17-digit SteamIDs, and browser players stay in the browser roster.
  const nativeIds=JSON.stringify(players).match(/\b\d{17}\b/g),browsers=[ctx.me.name,ctx.target?.me?.name].filter(n=>n&&ev.desktop.includes(n));
  if(!/^[A-Za-z0-9_-]{16}$/.test(entry.handle))return fail('the handle is not 16 base64url characters',ev);
  if(nativeIds)return fail('the admin API exposes 17-digit native IDs',{...ev,nativeIds:nativeIds.length});
  if(browsers.length)return fail('browser players are listed as desktop players',{...ev,browsers});
  ev.onAdminPage=await onAdminPage(r,'desktop','section[aria-labelledby="desktop-title"]',p=>p.waitForFunction(([h,n])=>document.querySelector(`#desktop tbody tr[data-handle="${CSS.escape(h)}"]`)?.textContent.includes(n),[entry.handle,name],{timeout:15000}).then(()=>true,()=>false));
  return ev.onAdminPage?pass(ev):fail('not shown in the Desktop players panel',ev);
 },
 async 'admin.kick-native'(){
  const d=ctx.desktop??(await desktopEntry(cfg.desktop.name,cfg.adminWaitMs)).entry;if(!d)return fail(`"${cfg.desktop.name}" is not in the desktop roster`);
  const c=await issue({handle:d.handle,action:'kick-native',reason:'native matrix kick-native check'});if(c.error)return fail('the website refused the command: '+c.error);
  const res=await commandResult(c.id);if(res.status!=='done')return commandFailed(res,{handle:d.handle});
  // The plugin lists players every 10 s; the kicked client drops out of the next list.
  const end=Date.now()+cfg.adminWaitMs+15000;let left=false;
  while(!left&&Date.now()<end){left=!(await api('GET',`${adminPath()}/players`)).body?.desktop?.some(x=>x.handle===d.handle);if(!left)await sleep(2000);}
  ctx.desktop=null;const ev={command:res,handle:d.handle,leftRoster:left};
  return left?pass(ev):fail('kick-native done but the desktop player is still listed',ev);
 },
 async 'admin.ban-native'(r){
  const tg=await targetPlayer();if(!tg)return noTarget();
  const t=Date.now(),b=await api('POST',`${adminPath()}/bans`,{player:tg.me.player,reason:'native matrix ban-native check',minutes:10,native:true});
  if(b.status!==201)return fail('the website refused the ban: '+(b.body?.error??b.status));
  ctx.ban=b.body.ban.id;const id=await findCommand('ban-native',tg.me.player,t);if(!id)return fail('no ban-native command recorded for the ban',{ban:ctx.ban});
  const res=await commandResult(id),s=tg.session,end=Date.now()+cfg.replyMs;
  while(s.socketOpen()&&Date.now()<end)await sleep(250);
  await ctx.shot(r,'target',s.page);
  // Central also kicks a banned account through the gateway ("kicked"); KP is the server's own kick.
  const ev={ban:ctx.ban,command:res,targetSessionClosed:!s.socketOpen(),kp:s.frames.rx(t,f=>f.type==='rpc'&&f.name==='KP').map(f=>f.values),gatewayKick:s.frames.rx(t,f=>f.type==='kicked').map(f=>f.reason)};
  if(res.status!=='done')return commandFailed(res,ev);
  return ev.targetSessionClosed?pass(ev):fail('ban-native done but the target is still connected',ev);
 },
 async 'admin.unban-native'(){
  if(!ctx.ban)return skip('needs admin.ban-native earlier in the same run (it creates the ban this row lifts)');
  const tg=await targetPlayer({inGame:false}),ban=ctx.ban,t=Date.now(),u=await api('POST',`${adminPath()}/unban`,{ban,reason:'native matrix unban-native check'});
  if(u.status!==200)return fail('the website refused the unban: '+(u.body?.error??u.status));
  ctx.ban=null;const id=await findCommand('unban-native',tg.me.player,t);if(!id)return fail('no unban-native command recorded for the unban',{ban});
  const res=await commandResult(id);if(res.status!=='done')return commandFailed(res,{ban});
  let j=null,error=null;try{j=await joinRetrying(tg.session);if(mockEnv)mockEnv.referee.nameFor(j.approved.playerId,tg.me.name);}catch(e){error=e.message.split('\n')[0];}
  const ev={ban,command:res,rejoinMs:j?.inGameMs??null,rejoinError:error,attempts:j?.attempts.length??null};
  return j?pass(ev):fail('unban-native done but the target could not join again',ev);
 },
 async 'admin.join-policy'(){
  // The 720 h maximum minimum age refuses any account made for the test run; the saved policy is always restored.
  const tg=await targetPlayer({inGame:false});if(!tg)return noTarget();
  const saved=(await api('GET',`${adminPath()}/policy`)).body;if(!saved)return fail('could not read the join policy');
  const ticket=async()=>{const x=await api('POST',`/servers/${encodeURIComponent(cfg.serverId)}/join-ticket`,undefined,tg.session);return {status:x.status,error:x.body?.error??null};};
  const ev={saved};
  try{
   const set=await api('POST',`${adminPath()}/policy`,{minAccountAgeMinutes:720*60,requireSteam:Boolean(saved.requireSteam)});
   if(set.status!==200)return fail('could not set the join policy: '+(set.body?.error??set.status),ev);
   ev.listed=(await api('GET','/servers',undefined,tg.session)).body?.servers?.find(s=>s.id===cfg.serverId)?.requirements??null;
   ev.refused=await ticket();
  }finally{ev.restored=(await api('POST',`${adminPath()}/policy`,{minAccountAgeMinutes:saved.minAccountAgeMinutes,requireSteam:Boolean(saved.requireSteam)})).status===200;}
  ev.afterRestore=await ticket();
  if(!ev.restored)return fail('could not restore the join policy',ev);
  if(ev.refused.status===200)return fail('a join ticket was issued under a 720 h minimum account age (target account older than 30 days?)',ev);
  if(ev.refused.error!=='account-too-new')return fail('refused for another reason: '+ev.refused.error,ev);
  return ev.afterRestore.error==='account-too-new'?fail('still refused after restoring the policy',ev):pass(ev);
 },
 async 'net.kick'(r){
  const {frames,page}=ctx.session,t=Date.now()-1;await f1(page,`kick "${ctx.me.name}"`);
  const kp=await frames.waitFor(t,f=>f.dir==='rx'&&f.type==='rpc'&&f.name==='KP',cfg.replyMs);
  await page.waitForFunction(()=>!window.rlbFrontEnd||window.rlbFrontEnd.state().menu,{},{timeout:cfg.replyMs}).catch(()=>{});await sleep(800);await ctx.shot(r,'kicked');
  const s=ctx.session.sockets.at(-1),fe=await page.evaluate(()=>window.rlbFrontEnd?.state()??null).catch(()=>null);
  const ev={kp:kp?.values??null,socketClosed:s.closedAt!=null,notices:fe?.notices??null,info:fe?.info??null};
  if(!kp)return fail('no KP kick reason from the server',ev);
  return s.closedAt!=null?pass(ev):fail('KP received but the session stayed open',ev);
 },
};

// After the player's own website rejoin: admin rights belong to the old NetUser; the mock referee learns the name.
function afterRejoin(j){ctx.session.adminState=null;ctx.admin=null;if(mockEnv)mockEnv.referee.nameFor(j.approved.playerId,ctx.me.name);}

const outDir=opts.out??path.join('analysis','native-runs',runStamp()+(opts.mock?'-mock':''));
let mockEnv=null,browser=null,session=null;
const secrets=[];
const rec=createRecorder({run:{mode:opts.mock?'mock':'real',rowsFilter:opts.rows??'all'}});
const ctx={admin:null,me:null,outDir,cfg};
const gameplay=createGameplayRows({ctx,cfg,pass,fail,skip,ensureAdmin,adminWhy:s=>s.adminState?.why??'not checked',targetPlayer,targetWhy:()=>ctx.targetError??ctx.targetWhy??'no target player',
 consoleCommand,joinRetrying,afterRejoin});
Object.assign(RUN,gameplay);
// P7 anti-cheat rows: the gameplay helpers, and the website admin API for the gateway's flags on our account.
Object.assign(RUN,createAntiCheatRows({ctx,cfg,pass,fail,skip,g:gameplay.helpers,api,adminPath,ensureAdmin,adminWhy:s=>s.adminState?.why??'not checked',mock:opts.mock}));
try{
 if(opts.mock){
  const {startMockEnvironment}=await import('./native/mock.mjs');
  mockEnv=await startMockEnvironment({log:(...a)=>process.env.NATIVE_DEBUG&&console.log(...a)});
  cfg.centralUrl=mockEnv.origin;cfg.serverId=mockEnv.serverId;ctx.rcon=mockEnv.rconPassword;
  cfg.backpackLockMs??=mockEnv.backpackLockMs+1000; // combat.death waits out the mock's shorter sack lock
  // NATIVE_MOCK_APART: the target spawns far away; meet() must walk (no admin teleport), as on a server without rcon.
  if(mockEnv.apartSpawn){cfg.meetTeleport??=false;console.log('mock: the target spawns at',mockEnv.apartSpawn.map(Math.round).join(', '),'(Unity)');}
 }else ctx.rcon=readSecret(cfg,'rconPassword');
 if(ctx.rcon)secrets.push(ctx.rcon);
 for(const a of [cfg.player,cfg.target])if(a?.auth==='password')secrets.push(readSecret(a,'password'));
 const origin=new URL(cfg.centralUrl).origin;ctx.origin=origin;
 browser=await launchBrowser();
 session=await openPlayer(browser,{viewport:cfg.viewport,ignoreHttpsErrors:cfg.ignoreHttpsErrors,redact:secrets});
 ctx.session=session;const {page,frames}=session;
 ctx.shot=async(r,name,p=page)=>{const file=`${r.id}-${name}.png`;try{await p.screenshot({path:path.join(outDir,file)});(r.evidence.screenshots??=[]).push(file);}catch{}};
 await (await import('node:fs/promises')).mkdir(outDir,{recursive:true});

 // ---- setup = join.website ----
 const joinRow=ROWS.find(r=>r.id==='join.website'),jr=rec.begin(joinRow);
 try{
  ctx.me=await signIn(page,origin,cfg.player);
  ctx.join=await joinRetrying(session);
  ctx.joinedAt=ctx.join.approved.t;if(mockEnv){mockEnv.referee.nameFor(ctx.join.approved.playerId,ctx.me.name);await mockEnv.grantRole(ctx.me.player,'admin');}
  const graphics=await readGraphics(page).catch(e=>({renderer:'error: '+e.message}));ctx.graphics=graphics.renderer;
  await lockPointer(page);await ctx.shot(jr,'in-game');
  rec.finish(jr,'pass',{evidence:{account:ctx.me.name,ticketMs:ctx.join.ticketMs,approvedMs:ctx.join.approvedMs,spawnMs:ctx.join.spawnMs,inGameMs:ctx.join.inGameMs,
   world:ctx.join.approved.world,playerId:ctx.join.approved.playerId,characterView:ctx.join.spawned.viewId,spawnUnity:ctx.join.spawned.position,graphics:ctx.graphics}});
 }catch(e){rec.finish(jr,'fail',{reason:e.message,evidence:{frames:frames.counts,pageErrors:session.errors.slice(0,5)}});await ctx.shot(jr,'failed');}
 if(!selected.some(r=>r.id==='join.website'))rec.rows.splice(rec.rows.indexOf(jr),1);
 const joined=jr.status==='pass';

 for(const row of selected){
  if(row.id==='join.website')continue;
  // NATIVE_MOCK_ALL=1: also drive the real-only rows against the mock (code-path check; they fail or skip there).
  const why=plannedSkip(row,{mock:opts.mock&&process.env.NATIVE_MOCK_ALL!=='1',config:cfg});if(why){rec.skip(row,why);continue;}
  if(!joined){rec.skip(row,'no session: join.website failed');continue;}
  if(!session.socketOpen()&&row.id!=='join.sleeper'){rec.skip(row,'session closed by an earlier row');continue;}
  if(row.admin&&!(await ensureAdmin())){rec.skip(row,'needs admin rights: '+ctx.adminWhy);continue;}
  if(row.site&&!(await ensureSiteAdmin())){rec.skip(row,'needs an admin role on the website: '+ctx.siteWhy);continue;}
  const r=rec.begin(row);
  try{const out=await RUN[row.id](r);rec.finish(r,out.status,out);}
  catch(e){rec.finish(r,'error',{reason:e.message.split('\n')[0].slice(0,300)});await ctx.shot(r,'error');}
  await settle(page);
  console.log(`${r.status.padEnd(5)} ${row.id}${r.reason?'  '+r.reason:''}`);
 }
}catch(e){console.error('harness error:',e.stack);process.exitCode=1;}
finally{
 const result=rec.result({rpcCounts:session?.frames.rpcCounts,frameCounts:session?.frames.counts,pageErrors:session?.errors});
 Object.assign(result.run,{centralUrl:cfg.centralUrl,serverId:cfg.serverId,admin:ctx.admin,graphics:ctx.graphics,config:redactConfig({...cfg,centralUrl:undefined})});
 if(session){const keep=session.frames.frames.slice(-4000).map(f=>({...f,values:f.values?.map(v=>typeof v==='string'&&v.length>300?v.slice(0,300)+'â€¦':v)}));
  await (await import('node:fs/promises')).writeFile(path.join(outDir,'frames.json'),JSON.stringify(keep)).catch(()=>{});}
 // Both players' move streams (sent moves, spawns, corrections, disconnects) for an offline TruthDetector replay:
 // node tools/replay-truth-trace.mjs <outDir>/moves.json. The 2026-10-23 run-two kick could not be replayed without it.
 {const traces={};for(const [who,s] of [['player',session],['target',ctx.target?.session]])if(s?.frames.moveLog?.length)traces[who]={name:who==='player'?ctx.me?.name??null:ctx.target?.me?.name??null,moves:s.frames.moveLog};
  if(Object.keys(traces).length)await (await import('node:fs/promises')).writeFile(path.join(outDir,'moves.json'),JSON.stringify(traces)).catch(()=>{});}
 const files=await writeResults(outDir,result,toMarkdown(result));
 console.log(JSON.stringify(result.summary),'->',files.md);
 if(!ok(result.summary))process.exitCode=1;
 await ctx.target?.session.close();await browser?.close().catch(()=>{});await mockEnv?.close().catch(()=>{});
}

