// host.json for the Rust Legacy host app (HOST-APP-PLAN.md "Components"). Relative paths resolve against the file.
// {
//   listen: {host: '127.0.0.1', port: 28100},          // loopback only: remote access goes through the website (remote)
//   dataDir: 'C:/RLB-host/host',                        // logs, backups, owner token, pid files
//   components: {                                       // any subset; started in the order central, sidecar, server, gateway
//     central: {config: 'C:/RLB-host/central/central.json'},
//     sidecar: {config: 'C:/RLB-host/config/sidecar.json'},
//     server:  {kind: 'original', dir: 'C:/RLB-host/server/test', confirmRunOriginalBinaries: false, map?: 'rust_island_2013',
//               args?: [...] (the owner's own command line, from their .bat; default settings.json's),
//               exeSha256?: '…' (a build the owner accepted in Setup; without it only the verified build runs)}
//           |  {kind: 'mock', dir: '<scratch folder>', port: 29015, autosaveSeconds: 600, chatter: false},
//              both: control?: 'adapter' | 'console' (how Stop saves first; default adapter for the original, console for
//              the mock), gracefulStop?: {saveSeconds: 60, quitSeconds: 30} (host/server-control.mjs)
//     gateway: {config: 'C:/RLB-host/config/gateway.json'}
//   },
//   watchdog: {enabled: true, hangSeconds: 90, graceSeconds: 300, probeEveryMs: 5000},
//   remote?: {enabled: true, control: true},  // report status and logs to the website with the host app key (host/remote.mjs);
//                                            // control: false keeps the reports but refuses the website's commands
//   offsite?: {folder: '//nas/backups/rlb', …}  // off-site backup sets (host/offsite.mjs); the rest is set on the Backups page
//   releaseFeed?: {url: 'https://…/release-feed.json', publicKeyFile: 'release.pub.pem', channel: 'stable'}  // host/release-feed.mjs
//   scripts?: {root: 'C:/RLB-host'}  // share run state with deploy/host-test/scripts (settings.json "root"): the same
//                                    // run*.pid files, so a part started either way shows here and stops either way
// }
import {readFileSync,existsSync,createReadStream,mkdirSync,statSync} from 'node:fs';
import {pidAlive} from './proc-stats.mjs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConnection} from 'node:net';
import {userInfo} from 'node:os';
import {execFile} from 'node:child_process';
import {offsiteConfigErrors} from './offsite.mjs';
import {feedConfigErrors} from './release-feed.mjs';

export const REPO=fileURLToPath(new URL('..',import.meta.url));
export const ORDER=['central','sidecar','server','gateway'];
export const DEFAULT_PORT=28100;
export const WATCHDOG_DEFAULTS={enabled:true,hangSeconds:90,graceSeconds:300,probeEveryMs:5000};
const SETTINGS_FILE=join(REPO,'deploy','host-test','settings.json');
export const hostTestSettings=()=>JSON.parse(readFileSync(SETTINGS_FILE,'utf8'));

const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
export function validateHostConfig(c){
 const e=[];
 if(c.listen?.host!=='127.0.0.1')e.push('listen.host must be 127.0.0.1 (remote access goes through your website, not an open port)');
 if(!int(c.listen?.port,1,65535))e.push('listen.port must be a port number');
 if(typeof c.dataDir!=='string'||!c.dataDir)e.push('dataDir is required');
 const comps=c.components??{};
 for(const k of Object.keys(comps))if(!ORDER.includes(k))e.push(`unknown component "${k}" (known: ${ORDER.join(', ')})`);
 // No parts yet is allowed: a fresh install starts empty and the owner adds parts to host.json.
 for(const k of ['central','sidecar','gateway'])if(comps[k]){
  if(typeof comps[k].config!=='string')e.push(`components.${k}.config is required`);
  else if(!existsSync(comps[k].config))e.push(`components.${k}.config not found: ${comps[k].config}`);
 }
 const s=comps.server;
 if(s){
  if(s.kind!=='original'&&s.kind!=='mock')e.push('components.server.kind must be "original" or "mock"');
  if(typeof s.dir!=='string'||!s.dir)e.push('components.server.dir is required (the folder holding rust_server.exe)');
  if(s.kind==='original'&&s.confirmRunOriginalBinaries!==undefined&&typeof s.confirmRunOriginalBinaries!=='boolean')e.push('components.server.confirmRunOriginalBinaries must be true or false');
  if(s.kind==='mock'&&s.port!==undefined&&!int(s.port,1,65535))e.push('components.server.port must be a port number');
  if(s.control!==undefined&&!['adapter','console'].includes(s.control))e.push('components.server.control must be "adapter" or "console"');
  if(s.control==='console'&&s.kind==='original')e.push('components.server.control "console" is for the mock server only');
  if(s.gracefulStop!==undefined){const g=s.gracefulStop;
   if(typeof g!=='object'||g===null||Object.keys(g).some(k=>!['saveSeconds','quitSeconds'].includes(k)))e.push('components.server.gracefulStop takes saveSeconds and quitSeconds');
   else for(const k of ['saveSeconds','quitSeconds'])if(g[k]!==undefined&&!int(g[k],1,600))e.push(`components.server.gracefulStop.${k} must be 1..600`);}
  if(s.args!==undefined&&!(Array.isArray(s.args)&&s.args.length<=40&&s.args.every(a=>typeof a==='string'&&a.length<=260)))e.push('components.server.args must be a list of up to 40 arguments');
  if(s.exeSha256!==undefined&&!/^[0-9A-F]{64}$/.test(s.exeSha256))e.push('components.server.exeSha256 must be a SHA-256 in upper-case hex');
 }
 if(c.scripts!==undefined&&(typeof c.scripts?.root!=='string'||!c.scripts.root))e.push('scripts.root must be the root folder of the host-test scripts (settings.json "root", e.g. C:/RLB-host)');
 const w={...WATCHDOG_DEFAULTS,...c.watchdog};
 if(typeof w.enabled!=='boolean')e.push('watchdog.enabled must be true or false');
 if(!int(w.hangSeconds,10,3600))e.push('watchdog.hangSeconds must be 10..3600');
 if(!int(w.graceSeconds,0,3600))e.push('watchdog.graceSeconds must be 0..3600');
 if(!int(w.probeEveryMs,500,60000))e.push('watchdog.probeEveryMs must be 500..60000');
 e.push(...offsiteConfigErrors(c.offsite),...feedConfigErrors(c.releaseFeed));
 return e;
}

export function loadHostConfig(file){
 const base=dirname(resolve(file)),c=JSON.parse(readFileSync(file,'utf8')),abs=p=>typeof p==='string'?resolve(base,p):p;
 c.listen={host:'127.0.0.1',port:DEFAULT_PORT,...c.listen};
 c.dataDir=abs(c.dataDir);
 if(c.scripts?.root)c.scripts.root=abs(c.scripts.root);
 if(c.offsite?.folder)c.offsite.folder=abs(c.offsite.folder);
 if(c.releaseFeed?.publicKeyFile)c.releaseFeed.publicKeyFile=abs(c.releaseFeed.publicKeyFile);
 for(const k of ORDER){const x=c.components?.[k];if(!x)continue;if(x.config)x.config=abs(x.config);if(x.dir)x.dir=abs(x.dir);}
 c.watchdog={...WATCHDOG_DEFAULTS,...c.watchdog};
 return c;
}

export function tcpOpen(host,port,timeoutMs=800){
 return new Promise(r=>{const s=createConnection({host,port});const done=v=>{s.destroy();r(v);};s.setTimeout(timeoutMs,()=>done(false));s.once('connect',()=>done(true));s.once('error',()=>done(false));});
}
export function sha256File(path){
 return new Promise((res,rej)=>{const h=createHash('sha256');createReadStream(path).on('data',d=>h.update(d)).on('end',()=>res(h.digest('hex').toUpperCase())).on('error',rej);});
}
// The rows 05-Start-Server.ps1 refuses on (Test-RlbLockdown in deploy/host-test/scripts/_Common.ps1): Check/Status/Detail.
export function runLockdownCheck(){
 const common=join(REPO,'deploy','host-test','scripts','_Common.ps1').replace(/'/g,"''");
 return new Promise((res,rej)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`. '${common}'; @(Test-RlbLockdown) | ConvertTo-Json -Compress`],{windowsHide:true,timeout:120000},(err,stdout)=>{
  if(err)return rej(Error('lock-down check could not run: '+err.message.split('\n')[0]));
  try{const rows=JSON.parse(stdout);res(Array.isArray(rows)?rows:[rows]);}catch{rej(Error('lock-down check gave no result'));}
 }));
}
// Windows virtual service accounts (NT SERVICE\<name>) have SIDs under S-1-5-80. The installed host app runs as
// NT SERVICE\RustLegacyHost: no password, not an administrator, cannot sign in.
export function runsAsServiceAccount(){
 if(process.platform!=='win32')return Promise.resolve(false);
 return new Promise(r=>execFile(join(process.env.SystemRoot??'C:\\Windows','System32','whoami.exe'),['/user','/fo','csv','/nh'],{windowsHide:true},(e,out)=>r(!e&&/"S-1-5-80-[\d-]+"/.test(out))));
}
const readJson=f=>JSON.parse(readFileSync(f,'utf8'));
// A part whose port is already taken is running outside the host (12 runs the website in its own console).
const portFree=(host,port,script)=>async()=>{if(await tcpOpen(host,port))throw Error(`${host}:${port} is already in use; it may be running outside the host (${script}). Stop that first`);};
const argAfter=(args,flag)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};

// Process specs for the supervisor, plus what the host needs per component (ports, log file, save file).
// The SYSTEM task 17-Register-ServerTask.ps1 -AtBoot registers: it runs 05-Start-Server.ps1 -ConfirmRunOriginalBinaries
// -ViaTask -NoProcmon (every lock-down check, the server task's definition, the PID into run/server.pid). A host under its
// own service account starts the original server through it (the installer lets that account run this one task).
export const BOOT_TASK='RLB-OriginalServer-AtBoot';
const execFileP=(cmd,args)=>new Promise((res,rej)=>execFile(cmd,args,{windowsHide:true,timeout:30000},(err,stdout,stderr)=>err?rej(Error(`${cmd} ${args.join(' ')}: ${(stderr||stdout||err.message).toString().trim().split(/\r?\n/)[0]}`)):res(stdout)));
const mtimeOf=f=>{try{return statSync(f).mtimeMs;}catch{return 0;}};
export async function startViaBootTask({runDir,task=BOOT_TASK,runTask=execFileP,timeoutMs=240000,pollMs=1000}){
 const pidFile=join(runDir,'server.pid'),before=mtimeOf(pidFile),t0=Date.now();
 await runTask('schtasks.exe',['/Run','/TN',task]);
 while(Date.now()-t0<timeoutMs){
  await new Promise(r=>setTimeout(r,pollMs));
  if(mtimeOf(pidFile)<=before)continue;
  const pid=Number(readFileSync(pidFile,'utf8').trim());
  if(Number.isInteger(pid)&&pid>0&&pidAlive(pid))return pid;
 }
 throw Error(`the start task ${task} did not start the server within ${Math.round(timeoutMs/1000)} s; its log is in ${join(dirname(runDir),'logs')}\\boot-start-*.log`);
}

export function componentSpecs(c,{node=process.execPath,settings=hostTestSettings(),lockdown=runLockdownCheck,runTask,taskPollMs,serviceAccount=runsAsServiceAccount}={}){
 const comps=c.components??{},out=[];
 for(const name of ORDER){
  const x=comps[name];if(!x)continue;
  if(name==='central'){const cfg=readJson(x.config),host=cfg.listen?.host??'127.0.0.1',port=cfg.listen?.port??8443;
   out.push({name,label:'Website',command:node,args:['tools/central.mjs','run',x.config],cwd:REPO,identity:{script:'tools/central.mjs'},preStart:portFree(host,port,'12-Start-Central.ps1'),endpoint:`${cfg.tls?'https':'http'}://${host}:${port}/`,ready:()=>tcpOpen(host,port)});}
  else if(name==='sidecar'){const cfg=readJson(x.config),port=cfg.port??28090;
   out.push({name,label:'Sidecar',command:node,args:['tools/adapter-sidecar.mjs',x.config],cwd:REPO,identity:{script:'tools/adapter-sidecar.mjs'},preStart:portFree('127.0.0.1',port,'14-Start-Bridge.ps1'),endpoint:`http://127.0.0.1:${port}`,ready:()=>tcpOpen('127.0.0.1',port)});}
  else if(name==='gateway'){const cfg=readJson(x.config),host=cfg.listen?.host??'127.0.0.1',port=cfg.listen?.port,scheme=cfg.tls?'https':'http';
   out.push({name,label:'Gateway',command:node,args:['tools/gateway.mjs','run',x.config],cwd:REPO,identity:{script:'tools/gateway.mjs'},preStart:portFree(host,port,'14-Start-Bridge.ps1'),endpoint:`${scheme==='https'?'wss':'ws'}://${host}:${port}${cfg.path??'/play'}`,health:`${scheme}://${host}:${port}/healthz`,ready:()=>tcpOpen(host,port),readyTimeoutMs:300000});}
  else if(name==='server'){
   if(x.kind==='mock'){
    const port=x.port??29015,datadir='rust_server_Data/',map=x.map??'rust_island_2013';
    out.push({name,label:'Game server',kind:'mock',command:node,args:[join(REPO,'host','mock-game-server.mjs'),'--port',String(port),'--datadir',datadir,'--map',map,'--autosave',String(x.autosaveSeconds??600),...(x.chatter?['--chatter']:[])],
     cwd:x.dir,udpPort:port,logFile:join(x.dir,'rust_server_Data','output_log.txt'),savePath:join(x.dir,datadir,map+'.sav'),userdataDir:join(x.dir,datadir,'userdata'),identity:{script:'host/mock-game-server.mjs'},gracefulStop:{stdin:'quit\n'},
     preStart:async()=>{mkdirSync(x.dir,{recursive:true});}});
   }else{
    const args=[...(x.args??settings.server.args)],port=Number(argAfter(args,'-port')??29015),datadir=argAfter(args,'-datadir')??'serverdata/',map=x.map??'rust_island_2013';
    const exe=join(x.dir,settings.server.exe);
    const viaTask=Boolean(c.scripts?.root)&&userInfo().username.toLowerCase()!==String(settings.account).toLowerCase();
    // Characters live in <datadir>userdata/<id>/avatar.bin (deploy/azure-test/scripts/20-Watch-Load.ps1): a full wipe moves them.
    out.push({name,label:'Game server',kind:'original',command:exe,args,cwd:x.dir,identity:{exe},udpPort:port,logFile:join(x.dir,'rust_server_Data','output_log.txt'),savePath:join(x.dir,datadir,map+'.sav'),userdataDir:join(x.dir,datadir,'userdata'),
     // The dashboard's form of 05-Start-Server.ps1 -ConfirmRunOriginalBinaries: only the owner turns this on.
     // The server inherits the host's account, so it must be a restricted one: the scripts' locked-down account (through
     // the boot task when the host is the service, with every 05 lock-down check), or, for a server attached as it is in
     // Setup ("An existing server", host/setup.mjs), the installed app's own virtual service account. The exe must be the
     // verified build or the one the owner accepted there (exeSha256).
     ...(viaTask?{startedBy:'the boot task (05-Start-Server.ps1 checks)',startExternal:()=>startViaBootTask({runDir:join(c.scripts.root,'run'),runTask,...(taskPollMs?{pollMs:taskPollMs}:{})})}:{}),
     preStart:async()=>{
      if(x.confirmRunOriginalBinaries!==true)throw Error('Running the original server needs your confirmation (Setup, or components.server.confirmRunOriginalBinaries in host.json)');
      if(viaTask)return; // the task runs 05-Start-Server.ps1: lock-down rows, the verified build and the server task's definition
      const user=userInfo().username,lockedDown=user.toLowerCase()===String(settings.account).toLowerCase();
      if(!lockedDown&&c.scripts?.root)throw Error(`The host runs as ${user}; the original server may only run as the locked-down account ${settings.account}. Start the host as ${settings.account}, or start the server with 05-Start-Server.ps1`);
      if(!lockedDown&&!await serviceAccount())throw Error(`The host runs as ${user}; the original server may only run as the locked-down account ${settings.account} or, for a server attached as it is in Setup, under the installed host app's own service account (NT SERVICE\\RustLegacyHost); never your own account`);
      if(!existsSync(exe))throw Error(`${exe} not found`);
      const h=await sha256File(exe);
      if(h!==settings.server.exeSha256&&h!==x.exeSha256)throw Error(`${settings.server.exe} is not the verified build or the one you accepted in Setup (SHA-256 ${h}). Check it again in Setup`);
      if(lockedDown){
       const fails=(await lockdown()).filter(r=>r.Status==='FAIL');
       if(fails.length)throw Error('Lock-down check failed: '+fails.map(r=>`${r.Check} (${r.Detail})`).join('; '));
      }
     }});
   }
  }
 }
 return out;
}
