// Config health check (HOST-AND-LOADER-BUILD.md H9): one row per check, PASS / WARN / FAIL (or SKIP where the check
// does not apply here), each with a plain-English fix. Every check is a small function of an injected environment, so
// tests cover them without a server; createHealthCheck builds the real environment from the running host.
import {readFileSync,existsSync,statSync,statfsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {X509Certificate} from 'node:crypto';
import {tcpOpen,sha256File,runLockdownCheck,hostTestSettings,REPO} from './config.mjs';
import {probeUlink} from './udp-probe.mjs';
import {compareVersions} from './plugins.mjs';

export const MIN_NODE='22.5.0'; // node:sqlite (the website's database)
const row=(id,label,status,detail,fix=null)=>({id,label,status,detail,fix});
const GB=1024**3,DAY=86400e3;
const ago=ms=>ms<120e3?Math.round(ms/1000)+' s':ms<7200e3?Math.round(ms/60e3)+' min':ms<2*DAY?Math.round(ms/3600e3)+' h':Math.round(ms/DAY)+' days';

export const CHECKS={
 async gamePort(env){
  const L='Game port answers';const s=env.server;
  if(!s)return row('game-port',L,'SKIP','No game server in host.json.');
  if(s.state!=='running')return row('game-port',L,'WARN',`The game server is ${s.state}, so UDP ${s.udpPort} cannot answer.`,'Start the game server on the Overview.');
  const r=await env.probeUdp(s.udpPort);
  return r.ok?row('game-port',L,'PASS',`UDP ${s.udpPort} answers (${r.ms} ms).`)
   :row('game-port',L,'FAIL',`No answer on UDP ${s.udpPort}${r.reason?` (${r.reason})`:''}.`,'If the server has just started, wait for the world to load. Otherwise look for errors on the Logs page.');
 },
 async gatewayPort(env){
  const L='Gateway listening';const g=env.gateway;
  if(!g)return row('gateway-port',L,'SKIP','No gateway in host.json.');
  return await env.tcpOpen(g.host,g.port)?row('gateway-port',L,'PASS',`Listening on ${g.host}:${g.port}. Whether players reach it from the internet also depends on your router and firewall.`)
   :row('gateway-port',L,'FAIL',`Nothing listens on ${g.host}:${g.port}.`,'Start the gateway on the Overview. If it stops again, its log on the Logs page says why.');
 },
 async firewall(env){
  const L='Firewall lock-down';
  if(env.platform!=='win32')return [row('firewall',L,'SKIP','Not available here: the lock-down check (Test-RlbLockdown) needs Windows.')];
  if(env.server?.kind!=='original')return [row('firewall',L,'SKIP','Only the original server is locked down; this host runs the mock.')];
  let rows;try{rows=await env.lockdown();}catch(e){return [row('firewall',L,'WARN',e.message,'Run 04-Test-Isolation.ps1 in deploy/host-test/scripts to see the same rows.')];}
  return rows.map((r,i)=>row(`firewall-${i}`,r.Check,['PASS','WARN','FAIL'].includes(r.Status)?r.Status:'WARN',r.Detail??'',r.Status==='PASS'?null:'Run the setup step named here (deploy/host-test/scripts), then check again.'));
 },
 async serverExe(env){
  const L='Server program is the verified build';const s=env.server;
  if(!s)return row('server-exe',L,'SKIP','No game server in host.json.');
  if(s.kind!=='original')return row('server-exe',L,'SKIP','This host runs the mock game server.');
  if(!env.exists(s.exe))return row('server-exe',L,'FAIL',`${s.exe} is missing.`,'Point components.server.dir in host.json at your server copy (02-Prepare-Server.ps1 makes one).');
  const h=await env.sha256File(s.exe);
  return h===env.settings.server.exeSha256?row('server-exe',L,'PASS',`SHA-256 ${h.slice(0,16)}… matches.`)
   :row('server-exe',L,'FAIL',`SHA-256 ${h.slice(0,16)}… is not the verified Unity player; the host will not start it.`,'Use the server copy from the verified RustLegacyServer.zip (02-Prepare-Server.ps1).');
 },
 async adapter(env){
  const L='Our adapter on the server';
  if(!env.server)return row('adapter',L,'SKIP','No game server in host.json.');
  const own=env.ownInstalled(),want=env.ownExpected();
  if(own){
   const c=compareVersions(own.version,want?.version);
   if(c===0)return row('adapter',L,'PASS',`Oxide plugin ${own.title} ${own.version}, the same as this host.`);
   if(c===null)return row('adapter',L,'WARN','The Oxide plugin is there, but its version cannot be read.','Copy adapter/RustLegacyBrowser.cs from this host\'s app folder into the plugins folder.');
   return c<0?row('adapter',L,'WARN',`Oxide plugin ${own.version} is older than this host's ${want.version}.`,'Copy adapter/RustLegacyBrowser.cs from this host\'s app folder into the plugins folder, or install the update that carries it.')
    :row('adapter',L,'WARN',`Oxide plugin ${own.version} is newer than this host's ${want.version}.`,'Update the host app on the Updates page.');
  }
  const dll=env.vanillaDll();
  if(dll){
   // The vanilla DLL carries no readable version; 10-Patch-TestCopy uses the same rule (DLL older than its source).
   const src=env.vanillaSourceTime();
   return src&&dll.mtime<src?row('adapter',L,'WARN','The patched adapter DLL is older than this host\'s adapter source.','Rebuild it (deploy/vm-test/host/Build-AdapterOutputs.ps1), then run 10-Patch-TestCopy.ps1 -Apply with the server stopped.')
    :row('adapter',L,'PASS','Vanilla patch adapter (RustLegacyBrowser.Vanilla.dll) is installed.');
  }
  return row('adapter',L,'FAIL','Our adapter is not on this server, so browser and loader players cannot join.',`With Oxide: copy adapter/RustLegacyBrowser.cs into ${env.pluginsDir}. Without Oxide: run 10-Patch-TestCopy.ps1 -Apply.`);
 },
 async launcherOnly(env){
  const L='Website players only (LauncherOnly)';const a=env.adapterConfig();
  if(!a?.kind)return row('launcher-only',L,'SKIP','The adapter is not installed (see above).');
  if(!a.exists)return row('launcher-only',L,'WARN','The adapter has not written its config yet, so it is off.','Start the server once with the adapter, then turn it on in Settings.');
  if(!a.pluginKey?.set)return row('launcher-only',L,'FAIL','The adapter config has no plugin key, so every website player is refused.','Run 10-Patch-TestCopy.ps1 -Apply (vanilla), or set PluginKeyHex in the Oxide config from secrets/plugin.key.');
  return a.values.LauncherOnly==='true'?row('launcher-only',L,'PASS','On: only players signed in on your website can join.')
   :row('launcher-only',L,'WARN','Off: anyone with the desktop game can join without a website account.','For a public server that runs only our software, turn on "Website players only" in Settings. Leave it off only to keep desktop players on purpose.');
 },
 async website(env){
  const L='Website reachable with the host app key';
  if(!env.centralUrl)return row('website',L,'SKIP','No gateway in host.json, so no website to check.');
  if(!env.hostKey())return row('website',L,'WARN','No host app key saved: Accounts, Players and Anti-cheat cannot read the website.','On the Accounts page, paste a key made with "New host app key" on your website\'s Owner page.');
  const r=await env.website();
  if(r.error)return row('website',L,'FAIL',`Cannot reach ${env.centralUrl}: ${r.error}.`,'Check that the website is running and that this machine can reach it.');
  if(r.status===200)return row('website',L,'PASS',`${env.centralUrl} answers and accepts the key.`);
  return row('website',L,'FAIL',`The website refused the host app key (HTTP ${r.status}).`,'Make a new host app key on the website\'s Owner page and save it on the Accounts page.');
 },
 async clock(env){
  const L='Clock matches the website';
  if(!env.centralUrl)return row('clock',L,'SKIP','No website configured.');
  const r=await env.website();
  if(r.date==null)return row('clock',L,'SKIP','The website gave no time to compare with.');
  const skew=Math.round((r.date-r.at)/1000),abs=Math.abs(skew),txt=`${abs} s ${skew>0?'behind':'ahead of'} the website`;
  // Join passes live 30 s (OFFSHOOT-COMPATIBILITY-PLAN.md), and the Date header only has whole seconds.
  if(abs<10)return row('clock',L,'PASS',abs<2?'Within a second of the website.':`This machine is ${txt}.`);
  return row('clock',L,abs<30?'WARN':'FAIL',`This machine is ${txt}. Join passes last 30 s, so a large gap refuses players.`,'Turn on automatic time sync (Windows: Settings, Time and language, Sync now).');
 },
 async tls(env){
  const L='Gateway certificate';const g=env.gateway;
  if(!g)return row('tls',L,'SKIP','No gateway in host.json.');
  if(!g.tls)return g.host==='127.0.0.1'?row('tls',L,'SKIP','The gateway listens on 127.0.0.1 without TLS; the certificate lives on your HTTPS proxy.')
   :row('tls',L,'WARN','The gateway has no certificate, so browsers on an https page cannot reach it.','Add tls.cert and tls.key to the gateway config (09-New-GatewayCert.ps1 makes a test certificate).');
  if(g.tls.pfx)return row('tls',L,'SKIP','The certificate is a .pfx file; its expiry is not read here.');
  let cert;try{cert=new X509Certificate(env.readFile(g.tls.cert));}catch(e){return row('tls',L,'FAIL',`Cannot read ${g.tls.cert}: ${e.message}.`,'Check tls.cert in the gateway config.');}
  const until=Date.parse(cert.validTo),left=until-env.now(),date=new Date(until).toISOString().slice(0,10);
  if(left<0)return row('tls',L,'FAIL',`Expired on ${date}. Browsers refuse the gateway.`,'Renew the certificate and restart the gateway.');
  return left<14*DAY?row('tls',L,'WARN',`Expires on ${date}, in ${ago(left)}.`,'Renew the certificate before then and restart the gateway.')
   :row('tls',L,'PASS',`Valid until ${date} (${Math.floor(left/DAY)} days).`);
 },
 async disk(env){
  const L='Disk space on the data drive';
  let free;try{free=env.freeBytes(env.dataDir);}catch(e){return row('disk',L,'WARN',`Cannot read free space: ${e.message}.`);}
  const gb=(free/GB).toFixed(1);
  if(free<1*GB)return row('disk',L,'FAIL',`Only ${gb} GB free. Saves and logs can fail.`,'Free some space: old logs, backups you no longer need, or move the data folder to a bigger drive.');
  return free<5*GB?row('disk',L,'WARN',`${gb} GB free.`,'Free some space before it runs out.'):row('disk',L,'PASS',`${gb} GB free.`);
 },
 async backups(env){
  const L='Recent backup of the world';const s=env.server;
  if(!s)return row('backups',L,'SKIP','No game server in host.json.');
  const g=env.lastGood(),every=env.autosaveSeconds()*1000;
  if(!g)return row('backups',L,'WARN','No completed save has been kept yet.',s.state==='running'?`One is kept after the server's first completed autosave (every ${ago(every)}).`:'Start the server; a copy is kept after each completed autosave.');
  const age=env.now()-g.at;
  if(s.state==='running'&&age>3*every)return row('backups',L,'WARN',`The newest copy is ${ago(age)} old, but the server should save every ${ago(every)}.`,'Look for save errors on the Logs page, and keep a copy now on the Backups page.');
  return row('backups',L,'PASS',`Newest copy ${ago(age)} old${s.state==='running'?'':' (the server is stopped)'}.`);
 },
 async node(env){
  const L='Node.js version';
  return compareVersions(env.nodeVersion,MIN_NODE)>=0?row('node',L,'PASS',`Node ${env.nodeVersion}.`)
   :row('node',L,'FAIL',`Node ${env.nodeVersion} is too old; the website needs ${MIN_NODE} or newer.`,'Install the current Node.js 22 LTS, or reinstall the host app (it brings its own Node).');
 },
};

export async function runHealthChecks(env,checks=CHECKS){
 const rows=(await Promise.all(Object.entries(checks).map(async([id,f])=>{
  try{return await f(env);}catch(e){return row(id,id,'WARN',`The check itself failed: ${e.message}`);}
 }))).flat();
 const count=s=>rows.filter(r=>r.status===s).length;
 return {at:env.now(),rows,summary:{pass:count('PASS'),warn:count('WARN'),fail:count('FAIL'),skip:count('SKIP')}};
}

// The real environment. memo(): the website is asked once per run (the key row and the clock row share the answer).
export function healthEnv({config,host,specs,serverSettings,plugins,settings=hostTestSettings(),fetchImpl=fetch,now=Date.now,lockdown=runLockdownCheck,platform=process.platform}){
 const sv=specs.find(s=>s.name==='server'),gwCfgFile=config.components?.gateway?.config;
 let gw=null;
 if(gwCfgFile){try{const c=JSON.parse(readFileSync(gwCfgFile,'utf8'));gw={host:c.listen?.host??'127.0.0.1',port:c.listen?.port,tls:c.tls??null};}catch{}}
 const paths=serverSettings?.paths?.();
 let site=null;
 return {
  platform,nodeVersion:process.versions.node,now,settings,dataDir:config.dataDir,
  server:sv?{kind:sv.kind,udpPort:sv.udpPort,exe:sv.identity?.exe??null,get state(){return host.procs.get('server')?.state??'stopped';}}:null,
  gateway:gw,probeUdp:port=>probeUlink({port,timeoutMs:1500}),tcpOpen,lockdown,sha256File,
  exists:existsSync,readFile:f=>readFileSync(f),
  freeBytes:d=>{const s=statfsSync(d);return s.bavail*s.bsize;},
  ownInstalled:()=>plugins?.ownInstalled()??null,ownExpected:()=>plugins?.ownExpected()??null,pluginsDir:paths?.pluginsDir??'oxide/plugins',
  vanillaDll:()=>{const f=paths&&join(paths.managed,'RustLegacyBrowser.Vanilla.dll');return f&&existsSync(f)?{mtime:statSync(f).mtimeMs}:null;},
  vanillaSourceTime:()=>{try{const d=join(REPO,'adapter','vanilla');return Math.max(...readdirSync(d).filter(f=>f.endsWith('.cs')).map(f=>statSync(join(d,f)).mtimeMs));}catch{return null;}},
  adapterConfig:()=>serverSettings?.readAdapter()??null,
  centralUrl:host.accounts?.centralUrl??null,hostKey:()=>host.accounts?.hostKey()??null,
  website:()=>site??=(async()=>{
   const at=now();
   try{
    const res=await fetchImpl(new URL(`/admin/servers/${host.accounts.serverId}/roles`,host.accounts.centralUrl),{headers:{authorization:'Bearer '+host.accounts.hostKey()},signal:AbortSignal.timeout(5000)});
    const d=Date.parse(res.headers.get('date')??'');await res.arrayBuffer().catch(()=>{});
    return {status:res.status,date:Number.isFinite(d)?d:null,at:(at+now())/2};
   }catch(e){return {error:e.cause?.code??e.message,date:null,at};}
  })(),
  lastGood:()=>host.status().saves?.lastGood??null,
  autosaveSeconds:()=>{const v=serverSettings?.read?.().values?.find(x=>x.key==='save.autosavetime')?.value;const n=Number(v);return Number.isFinite(n)&&n>0?n:600;},
 };
}

export function createHealthCheck(opts){
 let last=null,running=null;
 return {
  last:()=>last,
  // One run at a time; a second click joins the run in progress.
  run(){return running??=runHealthChecks(healthEnv(opts)).then(r=>{last=r;return r;}).finally(()=>{running=null;});},
 };
}
