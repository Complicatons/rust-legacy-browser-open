// The host: supervises central, sidecar, game server and gateway, tails the server's log, runs the hang watchdog and the
// save guard, and reports everything as status + events for the dashboard (HOST-APP-PLAN.md).
import {EventEmitter} from 'node:events';
import {join,dirname,resolve} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,unlinkSync,readdirSync,statSync} from 'node:fs';
import {request as httpGet} from 'node:http';
import {request as httpsGet} from 'node:https';
import {networkInterfaces} from 'node:os';
import {createLogHub,tailFile} from './log-hub.mjs';
import {createProcess} from './supervisor.mjs';
import {createHangWatchdog} from './watchdog.mjs';
import {createSaveGuard} from './save-guard.mjs';
import {probeUlink} from './udp-probe.mjs';
import {createCpuSampler,pidAlive,processInfo} from './proc-stats.mjs';
import {componentSpecs,ORDER,REPO} from './config.mjs';
import {createUpdates} from './updates.mjs';
import {createAccounts} from './accounts.mjs';
import {createRemote} from './remote.mjs';
import {createServerSettings} from './server-settings.mjs';
import {createPlugins} from './plugins.mjs';
import {createHealthCheck} from './health-check.mjs';
import {createHostMetrics} from './metrics.mjs';
import {createAlerts} from './alerts.mjs';
import {createServerControl,GRACEFUL_DEFAULTS} from './server-control.mjs';
import {createScheduler} from './schedule.mjs';
import {createOffsite} from './offsite.mjs';
import {createReleaseFeed} from './release-feed.mjs';
import {createWizard} from './wizard.mjs';

export const ACTIONS=['start','stop','restart','freeze'];

// Loopback health JSON (the gateway's /healthz). Its TLS certificate is the owner's self-signed test certificate.
// The gateway's certificate is self-signed for the public address while it listens on this machine's own (the Azure VM:
// 10.0.0.4), so its health is read without checking the certificate on any address of this machine.
export const ownAddress=h=>h==='127.0.0.1'||h==='localhost'||Object.values(networkInterfaces()).flat().some(i=>i?.address===h);
function getJson(url,timeoutMs=2000){
 return new Promise(res=>{
  const u=new URL(url),get=u.protocol==='https:'?httpsGet:httpGet;
  const req=get(u,{method:'GET',timeout:timeoutMs,...(u.protocol==='https:'&&ownAddress(u.hostname)?{rejectUnauthorized:false}:{})},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b));}catch{res(null);}});});
  req.on('timeout',()=>req.destroy());req.on('error',()=>res(null));req.end();
 });
}

// adapterControl: the sidecar control channel for the server's save-and-quit (tests inject the adapter in-process).
// hub: an existing log hub to keep (the service reloads the host after Setup changes; the log stream carries on).
export async function startHost(config,{probe=probeUlink,cpu=createCpuSampler(),specs,hubOptions={},now=()=>Date.now(),noRemote=false,adapterControl,setup={},hub:keepHub=null}={}){
 const dataDir=config.dataDir;
 // Scripts mode and app mode share one run directory, the deploy/host-test scripts' <root>\run (HOST-APP-PLAN.md
 // "Two ways to run it"): <name>.pid names the running process whoever started it, and a script that stops a part on
 // purpose first writes <name>.stop with its PID, so the host does not take the exit for a crash.
 const runDir=config.scripts?.root?join(config.scripts.root,'run'):join(dataDir,'run');mkdirSync(runDir,{recursive:true});
 const scriptLogs=config.scripts?.root?join(config.scripts.root,'logs'):null;
 const pidFile=n=>join(runDir,n+'.pid'),stopFile=n=>join(runDir,n+'.stop');
 const readPid=f=>{try{const v=Number(readFileSync(f,'utf8').trim());return Number.isInteger(v)&&v>0?v:null;}catch{return null;}};
 const hub=keepHub??createLogHub({dir:join(dataDir,'logs'),now,...hubOptions});hub.prune();
 const ev=new EventEmitter(),note=(text,level='info')=>hub.push('host','host',text,level),startedAt=now();
 const wcfg=config.watchdog;
 specs??=componentSpecs(config);
 const procs=new Map(),hangs=[],lineWaiters=new Set();
 let wd=null,guard=null,tail=null,lastVerdict={state:'idle'},lastProbe=null,udpIdle=false,players=null,gatewayHealth=null,handlingHang=false;
 const sv=specs.find(s=>s.name==='server');

 if(sv){
  wd=createHangWatchdog({hangSeconds:wcfg.hangSeconds,graceSeconds:wcfg.graceSeconds,now});
  guard=createSaveGuard({savePath:sv.savePath,backupDir:join(dataDir,'backups'),now,log:note});
  tail=tailFile(sv.logFile,line=>{hub.push('server','file',line);wd.log();if(guard.onLogLine(line))ev.emit('saves',saveStatus());for(const f of [...lineWaiters])f(line);},{fromStart:false});
  const own=sv.preStart;
  sv.preStart=async()=>{
   // Never a second server on the same save: a recorded server that is still alive, or anything answering the port.
   const old=readPid(pidFile('server'));
   if(old&&pidAlive(old))throw Error(`A server is already running (PID ${old}), started outside this host; stop it first, here or with 06-Stop-Server.ps1`);
   const busy=await probe({port:sv.udpPort,timeoutMs:500});
   if(busy.ok)throw Error(`Something already answers on UDP ${sv.udpPort}; another server is running`);
   // The server is stopped here, so the save is repaired even when the gates below refuse this host a start.
   const fix=guard.restoreIfBad();if(fix.problem)ev.emit('saves',saveStatus());
   await own?.();
   // Unity rewrites output_log.txt at start; keep the previous run's log beside it and read the new one from the top.
   if(existsSync(sv.logFile)){try{renameSync(sv.logFile,sv.logFile.replace(/\.txt$/,'.prev.txt'));}catch{}}
   tail.reset();
  };
  sv.onSpawn=()=>wd.reset();
  sv.onAdopt=()=>wd.reset();
  sv.onExit=()=>{wd.stop();lastVerdict=wd.verdict();ev.emit('watchdog',watchdogStatus());};
 }
 const tails=new Map();
 for(const spec of specs){
  // Shared run state for every part: the pid file (whoever started it), the stop marker, and the script's log file
  // for a part that 14-Start-Bridge.ps1 started (its stdout goes to <root>\logs\<name>-<time>.log).
  const n=spec.name,own={onSpawn:spec.onSpawn,onExit:spec.onExit,onAdopt:spec.onAdopt};let current=null;
  spec.onSpawn=c=>{current=c.pid;try{writeFileSync(pidFile(n),String(c.pid));}catch{}own.onSpawn?.(c);};
  spec.onAdopt=pid=>{current=pid;own.onAdopt?.(pid);if(n!=='server'&&scriptLogs)followScriptLog(n);};
  spec.onExit=x=>{if(current&&readPid(pidFile(n))===current){try{unlinkSync(pidFile(n));}catch{}}current=null;tails.get(n)?.stop();tails.delete(n);own.onExit?.(x);};
  spec.stoppedOutside=pid=>{if(readPid(stopFile(n))!==pid)return false;try{unlinkSync(stopFile(n));}catch{}return true;};
 }
 function followScriptLog(n){
  let newest=null;
  try{for(const f of readdirSync(scriptLogs))if(f.startsWith(n+'-')&&f.endsWith('.log')&&!f.endsWith('.err.log')){const t=statSync(join(scriptLogs,f)).mtimeMs;if(!newest||t>newest.t)newest={f,t};}}catch{}
  if(!newest)return;
  const files=[newest.f,newest.f.replace(/\.log$/,'.err.log')];
  const followers=files.map((f,i)=>tailFile(join(scriptLogs,f),line=>hub.push(n,i?'err':'out',line),{fromStart:false}));
  tails.set(n,{stop:()=>followers.forEach(t=>t.stop())});
  note(`${n}: following ${newest.f} (new lines only)`);
 }
 for(const spec of specs){
  const p=createProcess(spec,{hub});
  p.on('state',i=>ev.emit('state',{...i,label:spec.label,endpoint:spec.endpoint??null}));
  procs.set(spec.name,p);
 }
 const server=procs.get('server');
 // Save-and-quit (host/server-control.mjs): Stop, Restart, scheduled restarts and wipes save first when the server can.
 const accounts=createAccounts({config});
 let control=null;
 if(sv){
  const x=config.components?.server??{},g={...GRACEFUL_DEFAULTS,...x.gracefulStop};
  control=createServerControl({via:x.control??(sv.kind==='mock'?'console':'adapter'),proc:server,control:adapterControl??accounts.control,
   onLine:fn=>{lineWaiters.add(fn);return()=>lineWaiters.delete(fn);},log:note,saveSeconds:g.saveSeconds,quitSeconds:g.quitSeconds}).start();
  sv.gracefulStop={...sv.gracefulStop,run:(c,o)=>control.stop(o)};
 }

 const saveStatus=()=>guard?{saving:guard.saving,lastGood:guard.lastGood(),count:guard.backups().length}:null;
 const watchdogStatus=()=>({enabled:wcfg.enabled,...lastVerdict,probe:lastProbe,udpIdle,hangs:hangs.slice(-10)});

 async function handleHang(v){
  handlingHang=true;
  const a=v.ages;
  hangs.push({at:now(),ages:a});
  note(`Server hang detected: no log line for ${a.log.toFixed(0)} s, no UDP reply for ${a.udp.toFixed(0)} s, ${v.cpuKnown?`no CPU use for ${a.cpu.toFixed(0)} s`:'CPU not readable'}. Restarting it.`,'error');
  try{
   try{await server.stop({reason:'hang'});}
   catch(e){
    // A server another account started (05-Start-Server.ps1 as rlbserver) that this host may not stop.
    note(`Cannot stop the hung server from here: ${e.message}. Stop it with 06-Stop-Server.ps1 -Apply; the save is repaired at the next start.`,'error');
    wd.reset();return; // report again after another full quiet period, not every probe
   }
   if(await server.restartAfterFailure('hung'))note('Server restarted after the hang');
  }finally{handlingHang=false;}
 }
 // Parts started outside the host (the scripts) are adopted: shown, watched and, when verified, stoppable here.
 const matches=(id,info)=>{
  if(!id||!info)return false;
  if(id.exe)return String(info.path??'').toLowerCase()===id.exe.toLowerCase();
  return String(info.commandLine??'').replace(/\\/g,'/').toLowerCase().includes(id.script.toLowerCase());
 };
 async function scan(){
  for(const [n,p] of procs){
   if(p.state!=='stopped'&&p.state!=='failed')continue;
   const pid=readPid(pidFile(n));if(!pid||!pidAlive(pid))continue;
   const info=await processInfo(pid);
   if(info&&!matches(p.spec.identity,info))continue; // the PID now belongs to some other program
   // A host set up to start the server through the boot task owns its lifetime, also after the host itself restarted
   // or the task ran at boot: a crash is restarted through the task (a stop by 06-Stop-Server.ps1 is not a crash).
   const own=Boolean(p.spec.startExternal);
   p.adopt(pid,{verified:Boolean(info),by:own?p.spec.startedBy??'its start task':'outside the host',own});
  }
 }
 const tick=async()=>{
  if(!server||!wcfg.enabled||handlingHang)return;
  const st=server.state;
  if(st!=='running'&&st!=='starting'){return;}
  const pidNow=()=>server.child?.pid??server.external?.pid,pid=pidNow();
  const ms=await cpu.cpuMs(pid);
  if(pidNow()!==pid)return; // restarted meanwhile
  wd.cpu(ms);
  // Each probe makes the real server log "Incoming connection from 127.0.0.1:… was rejected due to incompatible uLink
  // version" (Azure VM, 2026-10-24), so it runs only once the log and CPU have both gone quiet for a while.
  const pre=wd.verdict(),others=Math.min(pre.ages.log,pre.cpuKnown?pre.ages.cpu:Infinity);
  udpIdle=others<Math.min(10,wcfg.hangSeconds/3);
  if(!udpIdle){
   // A quiet server is, by definition, a server a fresh join lands on: uLink has one pending-connection slot, so a
   // probe mid-handshake starves the real client for many seconds (H12, 2026-10-29, rlb-test-vm: "No answer from
   // remote host" ~60 ms after the probe's own "incompatible uLink version" line). A fresh gateway health check
   // right before probing (not the cached one from healthTimer, which can be up to 5 s stale) catches that window.
   const busy=gw?.health&&(await getJson(gw.health))?.connecting>0;
   if(pidNow()!==pid)return;
   if(!busy){
    const r=await probe({port:sv.udpPort,timeoutMs:Math.min(2000,wcfg.probeEveryMs-100)});
    if(pidNow()!==pid)return;
    lastProbe={ok:r.ok,ms:r.ms,reason:r.reason,at:now()};
    wd.udp(r.ok);
   }
  }
  lastVerdict=wd.verdict();ev.emit('watchdog',watchdogStatus());
  if(lastVerdict.state==='hung')await handleHang(lastVerdict);
 };
 let ticking=false;
 // A quiet server logs nothing after its save: the guard also checks the save files every 2 s.
 const saveTimer=guard?setInterval(()=>{if(guard.check())ev.emit('saves',saveStatus());},2000):null;saveTimer?.unref?.();
 const wdTimer=setInterval(async()=>{if(ticking)return;ticking=true;try{await tick();}catch(e){note('watchdog error: '+e.message,'error');}finally{ticking=false;}},wcfg.probeEveryMs);
 const gw=specs.find(s=>s.name==='gateway');
 const healthTimer=setInterval(async()=>{
  if(!gw?.health||procs.get('gateway').state!=='running'){if(players!==null){players=null;ev.emit('players',players);}return;}
  const t0=performance.now(),h=await getJson(gw.health),ms=Math.round((performance.now()-t0)*10)/10; // response time: the Health page's gateway graph
  const next=h?{inGame:h.inGame??0,sessions:h.sessions??0}:null;gatewayHealth=h?{at:now(),heartbeat:h.heartbeat??null,ms}:null;
  if(JSON.stringify(next)!==JSON.stringify(players)){players=next;ev.emit('players',players);}
 },5000);
 await scan();
 let scanning=false;
 const scanTimer=setInterval(async()=>{if(scanning)return;scanning=true;try{await scan();}finally{scanning=false;}},3000);
 note(`Host started: ${specs.map(s=>s.name).join(', ')||'no components'}${config.scripts?.root?`; sharing run state with the scripts in ${runDir}`:''}${server?`; watchdog ${wcfg.enabled?`on (hang after ${wcfg.hangSeconds} s quiet, ${wcfg.graceSeconds} s start-up grace)`:'off'}`:''}`);

 const waitSettled=async(p,ms=60000)=>{const t=now();while(now()-t<ms&&(p.state==='starting'||p.state==='stopping'))await new Promise(r=>setTimeout(r,200));};
 const host={
  hub,on:ev.on.bind(ev),off:ev.off.bind(ev),
  components:()=>[...procs.keys()],
  status(){
   // launcherOnly: read from the adapter's own config (OFFSHOOT-COMPATIBILITY-PLAN.md work item 7, "server profiles"),
   // so central can show it on the public server list instead of a player finding out only after a failed join.
   const adapter=host.serverSettings?.readAdapter();
   return {startedAt,now:now(),components:specs.map(s=>({...procs.get(s.name).info(),label:s.label,kind:s.kind??null,endpoint:s.endpoint??null})),
    watchdog:server?watchdogStatus():null,saves:saveStatus(),players,gatewayHealth,seq:hub.seq,remote:host.remote?.state()??null,
    graceful:control?.state()??null,schedule:host.schedule?.summary()??null,
    launcherOnly:adapter?.exists?adapter.values.LauncherOnly==='true':null};
  },
  // Fixed actions on known components ('all' follows ORDER, stops in reverse). Resolves when the action settles.
  async act(action,target){
   if(!ACTIONS.includes(action))throw Error('unknown action');
   if(target!=='all'&&!procs.has(target))throw Error('unknown component');
   // Demo only: the mock game server reproduces the 2026-10-22 autosave freeze so owners can watch the watchdog work.
   if(action==='freeze'){
    const sv=specs.find(s=>s.name==='server'),p=procs.get('server');
    if(target!=='server'||sv?.kind!=='mock')throw Error('only the mock game server can be frozen');
    if(p.state!=='running'||!p.child)throw Error('the mock game server is not running');
    note('Owner: freeze the mock game server (watchdog test)','warn');p.child.stdin.write('freeze\n');return p.info();
   }
   note(`Owner: ${action} ${target}`);
   if(target!=='all'){const p=procs.get(target);await p[action]();await waitSettled(p);return p.info();}
   const names=ORDER.filter(n=>procs.has(n));
   if(action==='stop'||action==='restart')for(const n of [...names].reverse()){try{await procs.get(n).stop({reason:action});}catch(e){note(e.message,'error');}}
   if(action==='start'||action==='restart')for(const n of names){const p=procs.get(n);await p.start();await waitSettled(p);}
   return host.status();
  },
  async close({stopChildren=true}={}){
   clearInterval(wdTimer);clearInterval(saveTimer);clearInterval(healthTimer);clearInterval(scanTimer);host.remote?.stop();host.metrics.stop();host.alerts.stop();host.schedule?.stop();control?.close();host.offsite?.stop();host.feed.stop();host.setup.close();
   // Parts the scripts started keep running: the host only stops what it started itself.
   if(stopChildren)for(const n of [...ORDER].reverse())if(procs.has(n)&&!procs.get(n).external)await procs.get(n).stop({reason:'host shutting down'});
   for(const t of tails.values())t.stop();tail?.stop();cpu.close();
  },
  procs,accounts,serverControl:control,
  // Setup page (host/wizard.mjs): the setup scripts step by step. setup: {launch, command, practice} swaps in stand-ins.
  setup:createWizard({dataDir,emit:d=>ev.emit('setup',d),log:note,scriptsRoot:config.scripts?.root??null,...setup}),
  // Updates: kit update tars installed into the app folder (config.updates.appDir, default this checkout). Only the
  // affected parts this host started and that are running restart; parts the scripts started are left to the owner.
  updates:createUpdates({dataDir,app:config.updates?.appDir??REPO,log:note,restartParts:async parts=>{
   const done=[];
   for(const n of ['central','sidecar','gateway']){const p=procs.get(n);if(!parts.includes(n)||!p||p.state!=='running'||p.external)continue;await p.restart();done.push(n);}
   return done;
  }}),
  // Backups page (HOST-APP-PLAN.md): the save guard's copies, the owner's own copies, the server's rotation, and what
  // was set aside. A restore needs the server stopped (whoever started it) so it cannot overwrite the copy put back.
  backups:{
   status(){
    if(!guard)return {configured:false};
    return {configured:true,current:guard.current(),saving:guard.saving,kept:guard.backups(),owner:guard.ownerCopies(),rotation:guard.rotation(),setAside:guard.setAside(),
     serverState:server.state,external:Boolean(server.external),keep:6};
   },
   keepNow(label){if(!guard)throw Object.assign(Error('no game server in host.json'),{status:404});const k=guard.keepNow(label);ev.emit('saves',saveStatus());return k;},
   deleteCopy(name){if(!guard)throw Object.assign(Error('no game server in host.json'),{status:404});guard.deleteOwnerCopy(name);},
   restore(name){
    if(!guard)throw Object.assign(Error('no game server in host.json'),{status:404});
    if(server.state!=='stopped'&&server.state!=='failed')throw Object.assign(Error('Stop the game server first: a running server would overwrite the restored save at its next autosave'),{status:409});
    const r=guard.restore(name);ev.emit('saves',saveStatus());return r;
   },
  },
 };
 // Settings (server cfg, adapter settings), Plugins and the health check: host/tools-api.mjs serves them.
 host.serverSettings=createServerSettings({config,serverState:()=>server?.state??'stopped',log:note});
 const ownPlugin=(()=>{try{return readFileSync(join(REPO,'adapter','RustLegacyBrowser.cs'),'utf8');}catch{return null;}})();
 host.plugins=createPlugins({dir:host.serverSettings.paths()?.pluginsDir??null,log:note,ownSource:ownPlugin});
 host.healthCheck=createHealthCheck({config,host,specs,serverSettings:host.serverSettings,plugins:host.plugins});
 // Health graphs (host/metrics.mjs) and Discord alerts (host/alerts.mjs; flags and reports through the host app key).
 host.metrics=createHostMetrics({host,cpu,dir:join(dataDir,'metrics'),now,log:note});
 host.alerts=createAlerts({dataDir,log:note,central:route=>{const [name,q]=route.split('?');return host.accounts.admin('GET',name,Object.fromEntries(new URLSearchParams(q??'')));}});
 host.alerts.attach(host);
 // Scheduled restarts and wipes (host/schedule.mjs, <dataDir>/schedule.json). Players online: the gateway's browser
 // players plus the plugin's desktop players; null (unknown) when neither answers, so warnings are still sent.
 const scheduleTitle=e=>`${e.wipe?(e.wipe==='full'?'Full wipe':'Map wipe'):'Restart'} ${e.by==='schedule'?'(scheduled) ':''}${e.outcome}`;
 host.schedule=createScheduler({dataDir,now,log:note,onDone:e=>host.alerts?.notify('schedule',{title:scheduleTitle(e),text:e.note??(e.archive?`The old world is kept in backups (${e.archive}).`:''),colour:e.outcome==='failed'?'red':undefined}),files:sv?{savePath:sv.savePath,userdataDir:sv.userdataDir,backupDir:join(dataDir,'backups')}:null,
  server:server?{state:()=>server.state,
   stop:async()=>{await server.stop({reason:'scheduled restart'});await waitSettled(server);},
   start:async()=>{await server.start();await waitSettled(server);},
   broadcast:text=>control.send('broadcast',{message:text}),
   players:()=>{const a=players?.inGame,b=control.state().players;return a==null&&b==null?null:(a??0)+(b??0);}}:null}).start();
 // Off-site backups (host/offsite.mjs): the guard's newest good save, the player folder beside the save and the
 // sidecar's identity map (its dataFile, relative to the sidecar's working folder, this checkout), as one set.
 const readCfg=f=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return {};}};
 const identityFile=config.components?.sidecar?.config&&readCfg(config.components.sidecar.config).dataFile;
 const stoppedOrNone=p=>!p||p.state==='stopped'||p.state==='failed';
 host.offsite=guard?createOffsite({dataDir,backupDir:join(dataDir,'backups'),savePath:sv.savePath,userdataDir:join(dirname(sv.savePath),'userdata'),identityFile:identityFile?resolve(REPO,identityFile):null,
  config:config.offsite,lastGood:()=>guard.lastGood(),log:note,
  canRestore:()=>!stoppedOrNone(server)?'Stop the game server first: a running server would overwrite the restored world at its next autosave'
   :!stoppedOrNone(procs.get('sidecar'))?'Stop the sidecar first: it keeps the identity map in memory and would write over the restored one':null}):null;
 host.offsite?.start();
 // The signed release feed (host/release-feed.mjs): off until host.json names a feed URL and its public key.
 host.feed=createReleaseFeed({dataDir,config:config.releaseFeed,updates:host.updates,players:()=>players,appVersion:readCfg(join(config.updates?.appDir??REPO,'package.json')).version??'0.0.0',log:note});
 host.feed.start();
 // Remote control through the website (host/remote.mjs): reports with the host app key once the owner has saved it.
 const remoteCfg=config.remote??{};
 host.remote=createRemote({host,key:()=>host.accounts.hostKey(),centralUrl:host.accounts.centralUrl,control:remoteCfg.control!==false});
 if(remoteCfg.enabled!==false&&!noRemote)host.remote.start();
 return host;
}
