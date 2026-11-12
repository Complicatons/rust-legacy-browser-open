// Setup wizard (HOST-APP-PLAN.md slice 3, dashboard Setup page): the deploy/host-test and deploy/game-vps scripts run one
// step at a time, each with its plan (the script's own dry run), live output, and PASS/WARN/FAIL from the '##rlb {...}'
// lines the scripts print with -Json (deploy/host-test/scripts/_Common.ps1). The scripts stay the source of truth for
// every Windows change; nothing here changes the PC itself.
// Steps are fixed script paths with fixed argument lists. The owner picks where the server runs and fills a few
// validated options (a zip or certificate file that exists, IP addresses, a host name, the enrolment pair).
// Who runs a step: the host, when it may (no password prompt, not the original server, and administrator rights only
// when the host has them). Otherwise the owner pastes one line into PowerShell as administrator; that line tees the
// script's output into <dataDir>/setup/results/<step>.txt, and the wizard follows it like one of its own runs.
import {spawn as nodeSpawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,statSync,rmSync} from 'node:fs';
import {join,isAbsolute,extname} from 'node:path';
import {lineSplitter} from './log-hub.mjs';
import {killTree as nodeKillTree} from './proc-stats.mjs';
import {REPO} from './config.mjs';
import {editHostJson} from './setup.mjs';

// attach: an existing server as it is (OFFSHOOT-COMPATIBILITY-PLAN.md work item 5): no scripts, the app's own steps instead
// (host/setup.mjs, /api/attach, the Setup page's attach.mjs).
export const MODES={'own-pc':'This PC, for testing','vps':'A VPS, as a public server','attach':'An existing server, as it is'};
const HT='deploy/host-test/scripts/',GV='deploy/game-vps/scripts/';
const val=x=>({value:x}); // an option value: quoted for PowerShell, never read as a switch
// admin: the script calls Assert-Admin. prompts: it asks for a password (Read-Host or Get-Credential). original: it runs
// the original server, which only the owner starts. needs: option names, '?' for optional ones.
export const STEPS=[
 {id:'account',title:'Server account',script:HT+'01-New-ServerAccount.ps1',admin:true,prompts:true,
  why:'A standard Windows account for the game server. It cannot open your files or change settings.'},
 {id:'folders',title:'Server folders',script:HT+'02-Prepare-Server.ps1',admin:true,needs:['zipPath'],args:o=>['-ZipPath',val(o.zipPath)],
  why:'Checks your server zip, keeps the original untouched and makes the locked-down copy that runs.'},
 {id:'public',title:'Public address',script:GV+'01-Set-GameVpsConfig.ps1',admin:true,modes:['vps'],needs:['ownerIp','publicIp?'],
  args:o=>['-OwnerIp',val(o.ownerIp),...(o.publicIp?['-PublicIp',val(o.publicIp)]:[])],
  why:'The gateway listens on port 443 for Cloudflare only; Remote Desktop and SSH answer your address only.'},
 {id:'firewall',title:'Firewall',script:HT+'03-Set-Firewall.ps1',admin:true,
  why:'Blocks the game server from the network, in and out. The gateway still reaches it on this machine.'},
 {id:'isolation',title:'Isolation check',script:HT+'04-Test-Isolation.ps1',admin:true,prompts:true,
  why:'Proves the lock-down before any original code runs: every check, then a live probe as the server account.'},
 {id:'secrets',title:'Secrets',script:HT+'08-New-Secrets.ps1',
  why:'Random keys shared by the gateway, the sidecar and the patched server. Never shown.'},
 {id:'certificate',title:'Gateway certificate',script:HT+'09-New-GatewayCert.ps1',modes:['own-pc'],
  why:'A test certificate for the gateway on 127.0.0.1. Only the test browser profile trusts it.'},
 {id:'csr',title:'Certificate request',script:GV+'02-New-OriginCsr.ps1',admin:true,modes:['vps'],needs:['hostname'],args:o=>['-Hostname',val(o.hostname)],
  why:'Makes the gateway key on this VPS and a request to paste into Cloudflare. The key never leaves the VPS.'},
 {id:'origin-cert',title:'Cloudflare certificate',script:GV+'03-Install-OriginCert.ps1',admin:true,modes:['vps'],needs:['certFile','hostname'],
  args:o=>['-CertFile',val(o.certFile),'-Hostname',val(o.hostname)],
  why:'Pairs the certificate Cloudflare issued with the key from the request, for the gateway only.'},
 {id:'patch',title:'Patch the server copy',script:HT+'10-Patch-TestCopy.ps1',
  why:'Adds our adapter to the test copy so website players are admitted. The original stays as it was.'},
 {id:'website',title:'Website',script:HT+'11-Initialize-Central.ps1',modes:['own-pc'],
  why:'Website and accounts on 127.0.0.1:8080, with their own signing key.'},
 {id:'enrol',title:'Enrol with the website',script:HT+'13-Enrol-Gateway.ps1',needs:['serverId','code'],args:o=>['-ServerId',val(o.serverId),'-Code',val(o.code)],
  why:'Connects this gateway to the server you added on the website\'s Owner page. The code lasts 15 minutes.'},
 {id:'task',title:'Password-free start',script:HT+'17-Register-ServerTask.ps1',admin:true,prompts:true,args:(o,mode)=>mode==='vps'?['-AtBoot']:[],
  why:'Lets the server start without typing its account password. On a VPS it also starts again after a reboot.'},
 {id:'start',title:'Start the server',script:HT+'05-Start-Server.ps1',admin:true,original:true,args:()=>['-ViaTask'],
  why:'Runs every lock-down check, then starts the original server. Only you start it.'},
];

// Option checks: a bad value is refused with the reason, never passed on.
const fail=msg=>{throw Object.assign(Error(msg),{status:400});};
const PRIVATE=/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|169\.254\.|0\.)/;
const IPV4=/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const text=v=>{if(typeof v!=='string')fail('expected text');const s=v.trim();if(!s||s.length>400||/[\u0000-\u001f\u007f]/.test(s))fail('expected one line of text');return s;};
const publicIp=what=>v=>{const s=text(v);if(!IPV4.test(s)||PRIVATE.test(s))fail(`${what} must be a public IPv4 address`);return s;};
const existingFile=(exts,what,test)=>v=>{
 const p=text(v);if(!isAbsolute(p))fail(`${what}: give the full path`);
 if(!exts.includes(extname(p).toLowerCase()))fail(`${what} must be a ${exts.join(' or ')} file`);
 let st;try{st=statSync(p);}catch{fail(`${what} not found: ${p}`);}
 if(!st.isFile())fail(`${what} is not a file: ${p}`);test?.(p,st);return p;
};
export const OPTIONS={
 zipPath:{label:'Server zip',hint:'Full path to RustLegacyServer.zip',check:existingFile(['.zip'],'The server zip')},
 ownerIp:{label:'Your home IP address',hint:'Remote Desktop and SSH will answer this address only',check:publicIp('Your home address')},
 publicIp:{label:'This VPS\'s public IP',hint:'Leave empty to find it',check:publicIp('The VPS address')},
 hostname:{label:'Game address',hint:'eu1.your-domain.example',default:'eu1.your-domain.example',check:v=>{const s=text(v).toLowerCase();if(s.length>253||!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s))fail('The game address must be a host name like eu1.your-domain.example');return s;}},
 certFile:{label:'Cloudflare certificate file',hint:'Full path to the .pem you saved',check:existingFile(['.pem','.crt','.cer'],'The certificate file',(p,st)=>{if(st.size>65536||!readFileSync(p,'latin1').includes('-----BEGIN CERTIFICATE-----'))fail('The certificate file must hold a PEM certificate (-----BEGIN CERTIFICATE-----)');})},
 serverId:{label:'Server id',hint:'From the website\'s Owner page',check:v=>{const s=text(v).toLowerCase();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s))fail('The server id is the long id on the Owner page');return s;}},
 code:{label:'Enrolment code',hint:'From the Owner page; valid 15 minutes',secret:true,check:v=>{const s=text(v);if(!/^[A-Za-z0-9_-]{20,64}$/.test(s))fail('The enrolment code is 20 to 64 letters, digits, - or _');return s;}},
};

export const MARK='##rlb ';
const NOISE=/^(At (line:|[A-Za-z]:\\|\S+\.ps1:)|\s*\+ |\s*~+\s*$|\s*CategoryInfo|\s*FullyQualifiedErrorId)/;
const DENIED=/Access to the path .* is denied|Access is denied|UnauthorizedAccess|PermissionDenied/i;
// PowerShell's report of a terminating error: the message, then "At <file>:<line> char:<n>", "+ <code>", "+ CategoryInfo".
export function errorDetail(lines){
 const t=lines.map(l=>typeof l==='string'?l:l.text).filter(l=>l.trim()&&!l.startsWith(MARK));
 const at=t.findLastIndex(l=>/^At .*char:\d+/.test(l));
 const pick=at>0?t[at-1]:t.filter(l=>!NOISE.test(l)).at(-1);
 return pick?pick.replace(/^\S.*?\.ps1 : /,'').trim():'';
}
// Folds the '##rlb' lines of one run into its outcome. code: the exit code (null for a run the owner did).
export function outcome(m,code,lines){
 if(m.needsAdmin)return {status:'needs-admin',detail:'Needs administrator rights',rows:[]};
 const rows=Array.isArray(m.result?.rows)?m.result.rows.map(r=>({check:String(r.check??''),status:['PASS','WARN','FAIL'].includes(r.status)?r.status:'WARN',detail:String(r.detail??'')})):[];
 let status=['PASS','WARN','FAIL'].includes(m.result?.status)?m.result.status:null,detail=String(m.result?.detail??'');
 if((m.failed||(code!=null&&code!==0))&&status!=='FAIL'){status='FAIL';detail=errorDetail(lines)||detail||`stopped with exit code ${code}`;}
 if(status==='FAIL'&&!detail)detail=rows.some(r=>r.status==='FAIL')?`${rows.filter(r=>r.status==='FAIL').length} of ${rows.length} checks failed`:errorDetail(lines);
 if(status==='WARN'&&!detail)detail=`${rows.filter(r=>r.status==='WARN').length} warning(s)`;
 if(!status){status='PASS';detail||=[...lines].reverse().map(l=>typeof l==='string'?l:l.text).find(l=>l.trim()&&!l.startsWith(MARK))?.trim()??'';}
 return {status,detail,rows};
}
export function readMarks(lines,m={}){
 for(const l of lines){
  const s=typeof l==='string'?l:l.text;if(!s.startsWith(MARK))continue;
  let j;try{j=JSON.parse(s.slice(MARK.length));}catch{continue;}
  if(j.type==='plan')m.plan={title:String(j.title??''),steps:(Array.isArray(j.steps)?j.steps:[j.steps]).filter(x=>x!=null).map(String),changesSecurity:j.changesSecurity===true,runsOriginalBinaries:j.runsOriginalBinaries===true,elevated:j.elevated===true};
  else if(j.type==='needs-admin')m.needsAdmin=true;
  else if(j.type==='result')m.result=j;
  else if(j.type==='done')m.done=true;
  else if(j.type==='failed')m.failed=true;
 }
 return m;
}
// Tee-Object writes UTF-16 with a byte order mark in Windows PowerShell 5.1, UTF-8 in PowerShell 7.
const decode=b=>b[0]===0xff&&b[1]===0xfe?b.subarray(2).toString('utf16le'):b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf?b.subarray(3).toString('utf8'):b.toString('utf8');
const psQuote=s=>`'${String(s).replace(/'/g,"''")}'`;
const POWERSHELL=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
// A value starting with '-' would be read as a parameter name on the command line: bind it with -Name:value instead.
const flatArgs=args=>{const out=[];for(let i=0;i<args.length;i++){const a=args[i],next=args[i+1];if(typeof a==='string'&&next?.value?.startsWith('-')){out.push(`${a}:${next.value}`);i++;}else out.push(typeof a==='string'?a:a.value);}return out;};
export const powershellLaunch=(file,args)=>({command:POWERSHELL,args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...flatArgs(args)]});
// The line the owner pastes into PowerShell as administrator: the same script and arguments, its output teed to a file
// the wizard follows. "done" or "failed" at the end tells the wizard the script finished, and how.
export const powershellCommand=(file,args,resultFile)=>`Set-ExecutionPolicy -Scope Process Bypass -Force; & { try { & ${psQuote(file)} ${args.map(a=>typeof a==='string'?a:psQuote(a.value)).join(' ')}; '##rlb {"type":"done"}' } catch { $_; '##rlb {"type":"failed"}' } } *>&1 | Tee-Object -FilePath ${psQuote(resultFile)}`;

const LOG_KEEP=400;
export function createWizard({dataDir,app=REPO,emit=()=>{},log=()=>{},launch,command=powershellCommand,practice=false,platform=process.platform,
 spawn=nodeSpawn,killTree=nodeKillTree,timeoutMs=20*60e3,planTimeoutMs=120e3,pollMs=1500,now=()=>Date.now(),hostJsonFile=null,scriptsRoot=null}={}){
 const dir=join(dataDir,'setup'),file=join(dir,'wizard.json'),results=join(dir,'results');
 mkdirSync(results,{recursive:true});
 const available=Boolean(launch)||platform==='win32';
 launch??=powershellLaunch;
 let saved={};try{saved=JSON.parse(readFileSync(file,'utf8'));}catch{}
 const st={mode:MODES[saved.mode]?saved.mode:null,elevated:saved.elevated===true,options:{...saved.options},steps:saved.steps??{}};
 delete st.options.code; // the enrolment code lives in memory only
 for(const [id,s] of Object.entries(st.steps)){
  if(!STEPS.some(x=>x.id===id)){delete st.steps[id];continue;}
  if(s.last?.status==='running')s.last={status:'FAIL',detail:'The host stopped while this step ran. Run it again.',rows:[],at:s.last.at,by:s.last.by};
 }
 let running=null,closed=false;const planning=new Set();
 const keep=()=>Object.fromEntries(Object.entries(st.options).filter(([k])=>!OPTIONS[k]?.secret));
 // Handed-off steps keep their place in the owner's transcript too, so a restarted host does not repeat lines.
 // The enrolment code stays in memory, including inside an owner's line that carries it.
 const secretIn=id=>STEPS.find(x=>x.id===id)?.needs?.some(n=>OPTIONS[n]?.secret);
 const steps=()=>Object.fromEntries(Object.entries(st.steps).map(([id,r])=>[id,r.handoff&&secretIn(id)?{...r,handoff:{...r.handoff,command:null}}:r]));
 const persist=()=>{const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify({mode:st.mode,elevated:st.elevated,options:keep(),steps:steps()},null,1));renameSync(tmp,file);};
 const rec=id=>st.steps[id]??={};
 const stepOf=id=>{const s=STEPS.find(x=>x.id===id);if(!s)throw Object.assign(Error('unknown-step'),{status:400});return s;};
 const applies=s=>st.mode!=='attach'&&(!s.modes||s.modes.includes(st.mode));
 const opts=()=>({hostname:OPTIONS.hostname.default,...st.options});
 const missing=s=>(s.needs??[]).filter(n=>!n.endsWith('?')&&!opts()[n]);
 const scriptPath=s=>join(app,...s.script.split('/'));
 const argsFor=(s,apply)=>[...(apply?[s.original?'-ConfirmRunOriginalBinaries':'-Apply']:[]),...(s.args?.(opts(),st.mode)??[]),'-Json'];
 const resultFile=s=>join(results,s.id+'.txt');
 function who(s){
  if(s.original)return {by:'owner',byWhy:'Only you start the original server.'};
  if(s.prompts)return {by:'owner',byWhy:'It asks for a password, so it runs in your own PowerShell window.'};
  if(!available)return {by:'owner',byWhy:'The host cannot run PowerShell on this system.'};
  if(s.admin&&!st.elevated)return {by:'owner',byWhy:'It needs administrator rights, and the host is not an administrator (the installed service runs as NT SERVICE\\RustLegacyHost).'};
  return {by:'host',byWhy:null};
 }
 function view(s){
  const r=st.steps[s.id]??{};
  return {id:s.id,title:s.title,why:s.why,script:s.script,admin:Boolean(s.admin),prompts:Boolean(s.prompts),original:Boolean(s.original),
   needs:(s.needs??[]).map(n=>n.replace('?','')),missing:missing(s),...who(s),plan:r.plan??null,last:r.last??null,
   handoff:r.handoff?{at:r.handoff.at,command:r.handoff.command}:null,log:r.log??[]};
 }
 // "Add the parts to host.json" (owner decision, HOST-AND-LOADER-BUILD.md question 3, 29 Oct 2026): the scripts above
 // write central/central.json, config/sidecar.json, config/gateway.json and server/test under the scripts root
 // (_Common.ps1's Get-RlbPaths) but never touch host.json's own components — until now the owner had to add those
 // lines themselves. scriptsRoot comes from host.json's own scripts.root (set by the installer); finish() only adds a
 // part host.json does not already have, so components set some other way (attach, for instance) are left alone.
 function partsReady(){
  if(!scriptsRoot)return {};
  const has=p=>{try{return existsSync(join(scriptsRoot,...p.split('/')));}catch{return false;}};
  const found={};
  if(has('central/central.json'))found.central={config:join(scriptsRoot,'central','central.json')};
  if(has('config/sidecar.json'))found.sidecar={config:join(scriptsRoot,'config','sidecar.json')};
  if(has('config/gateway.json'))found.gateway={config:join(scriptsRoot,'config','gateway.json')};
  if(has('server/test/rust_server.exe'))found.server={kind:'original',dir:join(scriptsRoot,'server','test')};
  return found;
 }
 function finish(){
  if(!hostJsonFile)fail('host.json location unknown; this host was not installed with a scripts root');
  const found=partsReady(),added=[];
  editHostJson(hostJsonFile,c=>{c.components??={};for(const [k,v] of Object.entries(found)){if(c.components[k])continue;c.components[k]=v;added.push(k);}});
  log(added.length?`Setup: added to host.json: ${added.join(', ')} (restart the host app to pick them up)`:'Setup: host.json already has every part the scripts finished');
  return {added,ready:Object.keys(found)};
 }
 const state=()=>({mode:st.mode,modes:MODES,practice,available,elevated:st.elevated,running:running&&{step:running.id,by:running.by,startedAt:running.at},
  options:Object.fromEntries(Object.entries(opts()).filter(([k])=>!OPTIONS[k]?.secret)),hasCode:Boolean(st.options.code),
  fields:Object.fromEntries(Object.entries(OPTIONS).map(([k,o])=>[k,{label:o.label,hint:o.hint,secret:Boolean(o.secret)}])),
  steps:st.mode?STEPS.filter(applies).map(view):[],finish:{can:Boolean(hostJsonFile),ready:Object.keys(partsReady())}});
 const pushState=s=>emit({step:s.id,state:view(s)});

 // Live lines go out in batches (one SSE event per 100 ms per step), and the newest LOG_KEEP stay with the step.
 const pending=new Map();let flushTimer=null;
 function addLine(s,line){
  const r=rec(s.id);(r.log??=[]).push(line);if(r.log.length>LOG_KEEP)r.log.splice(0,r.log.length-LOG_KEEP);
  if(!pending.has(s.id))pending.set(s.id,[]);pending.get(s.id).push(line);
  flushTimer??=setTimeout(()=>{flushTimer=null;for(const [id,lines] of pending)emit({step:id,lines});pending.clear();},100);
 }
 function setOptions(s,given){
  if(given==null)return;
  if(typeof given!=='object'||Array.isArray(given))fail('options must be an object');
  // All or nothing: one bad value keeps every saved option as it was.
  const allowed=(s.needs??[]).map(n=>n.replace('?','')),next={...st.options};
  for(const [k,v] of Object.entries(given)){
   if(!allowed.includes(k))fail(`${s.title} takes no option "${k}"`);
   if(v===''||v==null){if(!(s.needs??[]).includes(k+'?'))fail(`${OPTIONS[k].label} is required`);delete next[k];continue;}
   next[k]=OPTIONS[k].check(v);
  }
  st.options=next;
 }
 // A run is exclusive (the scripts share one root folder); a plan is a dry run that changes nothing, so it may run beside one.
 function ready(id,options,{exclusive=true}={}){
  if(!st.mode)fail('Choose where this server runs first');
  const s=stepOf(id);if(!applies(s))fail(`${s.title} is not a step for ${MODES[st.mode].toLowerCase()}`);
  if(exclusive&&running)throw Object.assign(Error(`${STEPS.find(x=>x.id===running.id).title} is running; wait for it to finish`),{status:409});
  if(planning.has(s.id))throw Object.assign(Error(`The plan of ${s.title} is being read`),{status:409});
  setOptions(s,options);
  const m=missing(s);if(m.length)fail('Fill in: '+m.map(n=>OPTIONS[n].label).join(', '));
  return s;
 }
 // One script run as a child of the host: argument array, no shell, stdin closed so a prompt fails instead of waiting.
 function exec(s,apply,onLine){
  return new Promise(res=>{
   const lines=[],{command:cmd,args,env}=launch(scriptPath(s),argsFor(s,apply));
   let child,timer,timedOut=false;
   const take=stream=>text=>{const l={stream,text,at:now()};lines.push(l);onLine?.(l);};
   try{child=spawn(cmd,args,{cwd:app,env:env?{...process.env,...env}:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});}
   catch(e){return res({lines,code:null,error:e.message});}
   const out=lineSplitter(take('out')),err=lineSplitter(take('err'));
   child.stdout.on('data',out);child.stderr.on('data',err);
   const limit=apply?timeoutMs:planTimeoutMs;
   timer=setTimeout(()=>{timedOut=true;try{killTree(child.pid);}catch{}},limit);
   let error=null;child.on('error',e=>{error=e.message;});
   child.on('close',code=>{clearTimeout(timer);out.flush();err.flush();
    res({lines,code:timedOut?null:code,error:timedOut?`stopped: timed out after ${limit>=60000?Math.round(limit/60000)+' min':Math.round(limit/1000)+' s'}`:error&&code==null?`could not start: ${error}`:null});});
  });
 }

 async function plan(id,options){
  const s=ready(id,options,{exclusive:false});
  planning.add(s.id);
  try{
   const r=await exec(s,false),m=readMarks(r.lines);
   const p=m.plan?{...m.plan,at:now()}:{error:r.error??(errorDetail(r.lines)||'The script printed no plan'),at:now()};
   if(m.plan)st.elevated=m.plan.elevated;
   rec(s.id).plan=p;persist();
  }finally{planning.delete(s.id);}
  for(const x of STEPS.filter(applies))pushState(x); // the elevation may have changed who runs each step
  return view(s);
 }
 function run(id,options,{by}={}){
  const s=ready(id,options),route=by==='owner'?'owner':who(s).by,r=rec(s.id);
  if(route==='owner'){
   // A fresh result file per hand-off, so an old transcript is never read as this run's.
   const f=resultFile(s);rmSync(f,{force:true});
   r.handoff={at:now(),file:f,seen:0,command:command(scriptPath(s),argsFor(s,true),f)};
   r.log=[];persist();pushState(s);log(`Setup: ${s.title} handed to the owner (PowerShell as administrator)`);
   return {by:'owner',command:r.handoff.command};
  }
  delete r.handoff;r.log=[];r.last={status:'running',at:now(),by:'host'};
  running={id:s.id,by:'host',at:now()};persist();pushState(s);log(`Setup: ${s.title} started (${s.script.split('/').pop()})`);
  running.done=exec(s,true,l=>addLine(s,l)).then(x=>{
   const m=readMarks(x.lines),o=x.error&&!x.lines.length?{status:'FAIL',detail:x.error,rows:[]}:outcome(m,x.code,x.lines);
   if(x.error&&o.status!=='FAIL'){o.status='FAIL';o.detail=x.error;}
   if(m.needsAdmin)st.elevated=false;
   const denied=o.status==='FAIL'&&x.lines.some(l=>DENIED.test(l.text));
   r.last={...o,at:r.last.at,endedAt:now(),by:'host',exitCode:x.code,...(denied?{hint:'owner'}:{})};
   running=null;persist();clearTimeout(flushTimer);flushTimer=null;for(const [sid,lines] of pending)emit({step:sid,lines});pending.clear();
   for(const y of STEPS.filter(applies))pushState(y);
   log(`Setup: ${s.title} ${o.status}${o.detail?': '+o.detail:''}`,o.status==='FAIL'?'error':o.status==='PASS'?'info':'warn');
  });
  return {by:'host',started:true};
 }
 // Follows the owner's runs: new lines of each hand-off's transcript, until its "done" or "failed" line.
 function poll(){
  for(const s of STEPS){
   const r=st.steps[s.id],h=r?.handoff;if(!h||!existsSync(h.file))continue;
   let all;try{all=decode(readFileSync(h.file)).split(/\r?\n/);}catch{continue;}
   all.pop(); // the last piece may be a line still being written
   for(const text of all.slice(h.seen))addLine(s,{stream:'out',text,at:now()});
   h.seen=all.length;
   const m=readMarks(all);
   if(!m.done&&!m.failed)continue;
   const o=outcome(m,null,all.filter(l=>!/^##rlb \{"type":"(done|failed)"\}$/.test(l)));
   r.last={...o,at:h.at,endedAt:now(),by:'owner'};delete r.handoff;persist();pushState(s);
   log(`Setup: ${s.title} ${o.status} (run by the owner)${o.detail?': '+o.detail:''}`,o.status==='FAIL'?'error':o.status==='PASS'?'info':'warn');
  }
 }
 const pollTimer=setInterval(()=>{if(!closed)poll();},pollMs);pollTimer.unref?.();

 const wizard={
  state,plan,run,poll,
  setMode(mode){if(!MODES[mode])fail('unknown mode');st.mode=mode;persist();emit({mode,state:state()});return state();},
  cancel(id){const s=stepOf(id),r=st.steps[s.id];if(r?.handoff){delete r.handoff;persist();pushState(s);}return view(s);},
  // POST /api/setup/<action> from the dashboard (host/service.mjs).
  async handle(action,body={}){
   if(action==='mode')return wizard.setMode(body.mode);
   if(action==='plan')return await plan(body.step,body.options);
   if(action==='run')return run(body.step,body.options,{by:body.by});
   if(action==='cancel')return wizard.cancel(body.step);
   if(action==='finish')return finish();
   throw Object.assign(Error('not-found'),{status:404});
  },
  idle:()=>running?.done??Promise.resolve(),
  close(){closed=true;clearInterval(pollTimer);clearTimeout(flushTimer);},
 };
 return wizard;
}
