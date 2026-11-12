// The host app's own server setup (HOST-APP-PLAN.md "Owner setup"): everything an owner needs after the installer,
// done by the app itself rather than the deploy/host-test scripts. Used by the dashboard's Setup page (host/service.mjs
// /api/setup/*), by the installer (RustLegacyHostSetup.exe → `node host/setup.mjs inspect|init|undo`) and by tests.
//
//  1. Server:        point at the owner's own copy, check rust_server.exe's SHA-256 against the verified build, detect
//                    the framework (stock, our patch already on, Oxide, Fougerite, an unknown modded build). A build we
//                    do not know is only run once the owner accepts it; its hash is recorded in host.json.
//  2. Browser ready: OFFSHOOT-COMPATIBILITY-PLAN.md "attach an existing server". Stock → our vanilla patcher on the
//                    owner's own Assembly-CSharp.dll plus cfg/rustlegacybrowser.cfg; Oxide → our one plugin file and its
//                    config. Their other plugins are never touched. Every file we change is recorded (attach.json) with a
//                    copy, so Undo puts the server back exactly.
//  3. Website:       one enrolment code from the website's owner page gives the gateway credential and the host app key.
//  4. Address:       where browsers reach the gateway (certificate, behind a proxy, or not yet).
//  5. Run:           the owner's confirmation that the host may start the original server.
// Secrets live in <dataDir>/secrets (the installer closes <dataDir> to administrators, SYSTEM and the service account).
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,copyFileSync,unlinkSync,renameSync,rmSync} from 'node:fs';
import {join,dirname,resolve,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {REPO,hostTestSettings,sha256File,loadHostConfig} from './config.mjs';
import {enrolGateway} from '../bridge/remote-account.mjs';
import {TAR} from '../tools/kit-install.mjs';

export const WEBSITE='https://your-domain.example/';
// The vanilla adapter and patcher: built by deploy/vm-test/host/Build-AdapterOutputs.ps1, carried at the same path inside
// the installed app folder by tools/build-host-installer.mjs.
export const ADAPTER_BIN=join(REPO,'build','vm-test','adapter');
const OXIDE_PLUGIN=join(REPO,'adapter','RustLegacyBrowser.cs');
const ADAPTER_DLL='RustLegacyBrowser.Vanilla.dll',PATCH_BACKUP='Assembly-CSharp.dll.rlb-original';
const PORTS={sidecar:28090,gateway:28443};
const err=(message,status=400)=>Object.assign(Error(message),{status});
const readJson=f=>JSON.parse(readFileSync(f,'utf8'));
const writeJson=(f,v)=>{mkdirSync(dirname(f),{recursive:true});const t=f+'.tmp';writeFileSync(t,JSON.stringify(v,null,1)+'\n');renameSync(t,f);};
const hex=n=>randomBytes(n).toString('hex');
const exists=p=>{try{return existsSync(p);}catch{return false;}};

// ---------- 1. The server ----------

// The command line the owner already uses: rust_server.exe's arguments in a .bat beside it (the zip ships
// "Run Server.bat"), else the shipped defaults. Arguments only; nothing here ever runs the .bat.
export function readLaunchArgs(dir,{settings=hostTestSettings()}={}){
 let bats=[];try{bats=readdirSync(dir).filter(f=>/\.(bat|cmd)$/i.test(f)).sort((a,b)=>(/^run server/i.test(b)?1:0)-(/^run server/i.test(a)?1:0));}catch{}
 for(const f of bats){
  let text;try{text=readFileSync(join(dir,f),'latin1');}catch{continue;}
  const line=text.split(/\r?\n/).find(l=>/rust_server(\.exe)?\b/i.test(l)&&!/^\s*(rem|::)/i.test(l));if(!line)continue;
  const after=line.slice(line.search(/rust_server(\.exe)?/i)).replace(/^rust_server(\.exe)?"?/i,'');
  const args=[...after.matchAll(/"([^"]*)"|(\S+)/g)].map(m=>m[1]??m[2]).filter(a=>a&&a!=='%*');
  if(args.length&&args.length<=40&&args.every(a=>a.length<=260&&!/[&|<>^%]/.test(a)))return {args,source:f};
 }
 return {args:[...settings.server.args],source:'default'};
}
const argAfter=(args,flag)=>{const i=args.findIndex(a=>a.toLowerCase()===flag);return i<0?undefined:args[i+1];};

// Folders named oxide that hold plugins (Oxide 2 for Legacy keeps them under the server's data folder; the exact
// place varies, so look a few levels down rather than guess).
function findOxideDir(dir,depth=4){
 const out=[],walk=(d,n)=>{
  if(n<0)return;let entries=[];try{entries=readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const e of entries)if(e.isDirectory()&&!/^(Managed|Mono|Plugins|Resources|backups)$/i.test(e.name)){
   const p=join(d,e.name);if(e.name.toLowerCase()==='oxide'&&exists(join(p,'plugins')))out.push(p);else walk(p,n-1);
  }
 };
 walk(dir,depth);return out[0]??null;
}

export async function inspectServer(dir,{settings=hostTestSettings()}={}){
 if(typeof dir!=='string'||!dir.trim())throw err('Choose the folder that holds rust_server.exe');
 dir=resolve(dir.trim());
 const exePath=join(dir,settings.server.exe),managed=join(dir,'rust_server_Data','Managed'),asm=join(managed,'Assembly-CSharp.dll');
 const r={dir,found:false,exe:{path:exePath,sha256:null,verified:false},assembly:{sha256:null,stock:false},framework:null,launch:null,
  oxide:null,fougerite:false,patched:false,browserReady:{possible:false,how:null,reason:null},notes:[]};
 if(!exists(dir))throw err(`${dir} does not exist`,404);
 try{readdirSync(dir);}catch(e){throw err(`The host app cannot open ${dir} (${e.code}). Run Rust Legacy Host Setup from the Start menu to choose it: it gives the app access`,403);}
 if(!exists(exePath)){r.notes.push(`No ${settings.server.exe} in this folder. Choose the folder of your Legacy server (the one with rust_server.exe and rust_server_Data).`);return r;}
 r.found=true;
 r.exe.sha256=await sha256File(exePath);r.exe.verified=r.exe.sha256===settings.server.exeSha256;
 if(!r.exe.verified)r.notes.push(`rust_server.exe is not the verified build. The host app runs it only after you accept it as yours, and records its SHA-256.`);
 r.launch=readLaunchArgs(dir,{settings});
 const datadir=argAfter(r.launch.args,'-datadir')??'serverdata/';
 r.cfgFile=join(dir,datadir,'cfg','rustlegacybrowser.cfg');
 r.port=Number(argAfter(r.launch.args,'-port')??29015);
 if(exists(asm)){
  r.assembly.sha256=await sha256File(asm);r.assembly.stock=r.assembly.sha256===settings.server.assemblyCSharpSha256;
  const backup=join(managed,PATCH_BACKUP);
  r.patched=!r.assembly.stock&&exists(backup)&&exists(join(managed,ADAPTER_DLL))&&await sha256File(backup)===settings.server.assemblyCSharpSha256;
 }else r.notes.push('rust_server_Data\\Managed\\Assembly-CSharp.dll is missing: this is not a complete Legacy server.');
 r.fougerite=exists(join(managed,'Fougerite.dll'));
 const oxideCore=exists(join(managed,'Oxide.Core.dll'));
 if(oxideCore){const d=findOxideDir(dir);r.oxide={dir:d,plugin:d?join(d,'plugins','RustLegacyBrowser.cs'):null,installed:Boolean(d&&exists(join(d,'plugins','RustLegacyBrowser.cs')))};}
 r.framework=r.patched?'stock-patched':r.assembly.stock?'stock':oxideCore?'oxide':r.fougerite?'fougerite':r.assembly.sha256?'modded':null;
 const b=r.browserReady;
 if(r.framework==='stock'){b.possible=true;b.how='vanilla';}
 else if(r.framework==='stock-patched'){b.possible=true;b.how='vanilla';b.done=true;}
 else if(r.framework==='oxide'){b.possible=Boolean(r.oxide.dir);b.how='oxide';b.done=r.oxide.installed;if(!r.oxide.dir)b.reason='Oxide is installed but has no plugins folder yet. Start the server once so Oxide creates its folders, then check again.';}
 else if(r.framework==='fougerite')b.reason='This server runs Fougerite. Our Fougerite adapter is not available yet, so it cannot be made browser ready. The host app can still run and watch it.';
 else if(r.framework==='modded')b.reason=`This build's Assembly-CSharp.dll (SHA-256 ${r.assembly.sha256}) is not one we know, and it has no Oxide. The host app can run and watch it, but cannot make it browser ready.`;
 return r;
}

// RustLegacyServer.zip as shipped: checked against the verified SHA-256 first, then unpacked with Windows' tar.exe.
export async function checkServerZip(zip,{settings=hostTestSettings()}={}){
 if(!exists(zip))throw err(`${zip} does not exist`,404);
 const sha256=await sha256File(zip);return {sha256,verified:sha256===settings.server.zipSha256};
}
export async function unpackServerZip(zip,dest,{settings=hostTestSettings()}={}){
 const h=await sha256File(zip);
 if(h!==settings.server.zipSha256)throw err(`${basename(zip)} is not the verified server package (SHA-256 ${h}). Unpack it yourself and choose the folder instead.`);
 mkdirSync(dest,{recursive:true});
 await new Promise((res,rej)=>execFile(TAR,['-xf',zip,'-C',dest],{windowsHide:true,maxBuffer:1<<24},e=>e?rej(err('Unpacking failed: '+e.message.split('\n')[0],500)):res()));
 // The zip holds one top folder; the server is wherever rust_server.exe ended up.
 const hit=[dest,...readdirSync(dest).map(n=>join(dest,n))].find(d=>exists(join(d,settings.server.exe)));
 if(!hit)throw err('The package has no rust_server.exe',500);
 return hit;
}

// ---------- host.json and the parts' configs ----------

export function paths(dataDir){
 return {secrets:join(dataDir,'secrets'),config:join(dataDir,'config'),data:join(dataDir,'data'),attach:join(dataDir,'attach'),
  credential:join(dataDir,'secrets','gateway.credential'),controlKey:join(dataDir,'secrets','control.key'),pluginKey:join(dataDir,'secrets','plugin.key'),
  metricsToken:join(dataDir,'secrets','metrics.token'),hostKey:join(dataDir,'central-host.key'),
  sidecar:join(dataDir,'config','sidecar.json'),gateway:join(dataDir,'config','gateway.json'),site:join(dataDir,'config','setup.json'),attachRecord:join(dataDir,'attach','attach.json')};
}
export function ensureSecrets(dataDir){
 const p=paths(dataDir);mkdirSync(p.secrets,{recursive:true});
 for(const [f,n] of [[p.controlKey,32],[p.pluginKey,32],[p.metricsToken,24]])if(!exists(f))writeFileSync(f,hex(n)+'\n',{mode:0o600});
 return p;
}
// The raw host.json on disk (relative paths kept as written), changed with one function and written atomically.
export function editHostJson(file,change){const c=readJson(file);change(c);writeJson(file,c);return c;}

// Setup state that is not a part's config: the website and the public address the owner chose.
const siteState=dataDir=>{try{return readJson(paths(dataDir).site);}catch{return {};}};
const saveSiteState=(dataDir,patch)=>{const s={...siteState(dataDir),...patch};writeJson(paths(dataDir).site,s);return s;};

export function partConfigs(dataDir,{serverId,website=WEBSITE,address={mode:'none'},nativePort=29015}){
 const p=paths(dataDir),fwd=s=>s.replace(/\\/g,'/'),origin=new URL(website).origin;
 const sidecar={serverId,port:PORTS.sidecar,dataFile:fwd(join(p.data,'identities.json')),pluginKeyFile:fwd(p.pluginKey),controlKeyFile:fwd(p.controlKey),
  namespace:{base:'90000000000000000',size:'1000000'},steamGroupWhitelisted:false};
 const gateway={serverId,centralUrl:website,credentialFile:fwd(p.credential),controlKeyFile:fwd(p.controlKey),metricsTokenFile:fwd(p.metricsToken),
  sidecarUrl:`http://127.0.0.1:${PORTS.sidecar}`,native:{host:'127.0.0.1',port:nativePort},allowedOrigins:[origin],path:'/play',capacity:100,
  anticheat:{policy:{autoKick:false}},...gatewayListen(address,p)};
 return {sidecar,gateway};
}
// none: loopback only (the gateway reports in, nobody can join yet); proxy: plain on loopback behind the owner's HTTPS
// proxy (Caddy, IIS, a Cloudflare Tunnel); certificate: TLS on a public port with the owner's certificate.
function gatewayListen(a,p){
 const fwd=s=>s.replace(/\\/g,'/');
 if(a.mode==='certificate')return {listen:{host:'0.0.0.0',port:a.port??443},tls:a.pfx?{pfx:fwd(join(p.secrets,'gateway-tls.pfx')),passphraseFile:fwd(join(p.secrets,'gateway-tls.pass'))}:{cert:fwd(join(p.secrets,'gateway-tls.crt')),key:fwd(join(p.secrets,'gateway-tls.key'))},...(a.cloudflare?{trustedProxies:['cloudflare']}:{})};
 if(a.mode==='proxy')return {listen:{host:'127.0.0.1',port:a.port??PORTS.gateway},trustedProxies:[a.cloudflare?'cloudflare':'loopback']};
 return {listen:{host:'127.0.0.1',port:PORTS.gateway}};
}

// First write of host.json for an installed app (the installer calls `node host/setup.mjs init`). An existing file is
// kept; with --server the server part is (re)pointed.
export async function initHostJson(file,{dataDir,port=28100,server,accept=false,website=WEBSITE,settings=hostTestSettings()}={}){
 dataDir=resolve(dataDir??dirname(file));
 // H11, owner decision 2 (29 Oct 2026): the kit-update release feed is hosted on the same website this host enrols
 // with. The public key ships in the kit (host/release-feed.pub.pem, release-feed.mjs's KIT_KEY default), so a fresh
 // install only needs the URL to start polling once the project actually publishes a signed feed there.
 if(!exists(file))writeJson(file,{listen:{host:'127.0.0.1',port},dataDir,components:{},watchdog:{enabled:true,hangSeconds:90,graceSeconds:300,probeEveryMs:5000},releaseFeed:{url:new URL('/downloads/updates/release-feed.json',website).href}});
 ensureSecrets(dataDir);
 if(!siteState(dataDir).website)saveSiteState(dataDir,{website});
 if(server)await setServer(file,server,{settings,accept});
 return readJson(file);
}

// ---------- The steps ----------

// Points the host at a server folder. A build that is not the verified one needs accept: true; its hash is recorded so a
// later swap of rust_server.exe is refused until the owner accepts again.
export async function setServer(file,dir,{accept=false,settings=hostTestSettings()}={}){
 const info=await inspectServer(dir,{settings});
 if(!info.found)throw err(info.notes[0]??'No server in that folder');
 if(!info.exe.verified&&!accept)throw Object.assign(err('rust_server.exe is not the verified build. Accept it as your own build to continue.',409),{inspect:info});
 editHostJson(file,c=>{
  const old=c.components?.server;
  c.components??={};
  c.components.server={kind:'original',dir:info.dir,args:info.launch.args,
   ...(info.exe.verified?{}:{exeSha256:info.exe.sha256}),
   // Moving to another folder or build asks for the confirmation again.
   confirmRunOriginalBinaries:Boolean(old?.confirmRunOriginalBinaries&&old.dir===info.dir&&(old.exeSha256??null)===(info.exe.verified?null:info.exe.sha256))};
 });
 return info;
}

export function confirmRun(file,on){
 editHostJson(file,c=>{if(!c.components?.server)throw err('Choose your server first',409);c.components.server.confirmRunOriginalBinaries=on===true;});
}

// Browser ready: the attach record keeps every file we wrote, with a copy of what was there before.
const record=dataDir=>{try{return readJson(paths(dataDir).attachRecord);}catch{return null;}};
function backupFile(dataDir,f,files){
 const had=exists(f),copy=had?join(paths(dataDir).attach,'files',String(files.length)+'-'+basename(f)):null;
 if(had){mkdirSync(dirname(copy),{recursive:true});copyFileSync(f,copy);}
 files.push({path:f,copy});
}
const cfgText=({pluginKey,launcherOnly})=>['# Rust Legacy browser adapter. Written by the Rust Legacy Host app (Setup → Browser ready); Undo there removes it.',
 `SidecarUrl=http://127.0.0.1:${PORTS.sidecar}/plugin`,`PluginKeyHex=${pluginKey}`,`LauncherOnly=${launcherOnly?'true':'false'}`,''].join('\r\n');

// patcher: the exe, or a command list (tests use a small stand-in script).
export function runPatcher(verb,managed,{patcher=join(ADAPTER_BIN,'patcher','VanillaPatcher.exe')}={}){
 const [cmd,...pre]=Array.isArray(patcher)?patcher:[patcher];
 return new Promise(res=>execFile(cmd,[...pre,verb,managed],{windowsHide:true,timeout:180000},(e,stdout,stderr)=>res({code:e?(typeof e.code==='number'?e.code:1):0,out:(stdout+stderr).trim()})));
}

export async function makeBrowserReady(file,{launcherOnly=false,serverRunning=()=>false,patcher,adapterDir=ADAPTER_BIN,log=()=>{},settings=hostTestSettings()}={}){
 const c=loadHostConfig(file),s=c.components?.server;
 if(!s||s.kind!=='original')throw err('Choose your server first',409);
 if(serverRunning())throw err('Stop the game server first: its files are in use while it runs',409);
 const info=await inspectServer(s.dir,{settings}),b=info.browserReady;
 if(!b.possible)throw err(b.reason??'This server cannot be made browser ready',409);
 const p=ensureSecrets(c.dataDir),pluginKey=readFileSync(p.pluginKey,'utf8').trim();
 const prev=record(c.dataDir);
 if(prev&&prev.dir!==info.dir)throw err(`Undo browser ready on ${prev.dir} first`,409);
 const files=prev?.files??[],rec={at:Date.now(),dir:info.dir,how:b.how,launcherOnly,files,patched:prev?.patched??false};
 if(b.how==='vanilla'){
  const managed=join(info.dir,'rust_server_Data','Managed');
  if(!info.patched){
   const dll=join(adapterDir,ADAPTER_DLL);patcher??=join(adapterDir,'patcher','VanillaPatcher.exe');
   for(const f of [dll,Array.isArray(patcher)?patcher.at(-1):patcher])if(!exists(f))throw err(`${f} is missing from this install; reinstall the host app`,500);
   const target=join(managed,ADAPTER_DLL);if(!files.some(x=>x.path===target))backupFile(c.dataDir,target,files);
   copyFileSync(dll,target);
   for(const verb of ['check','patch','verify']){
    const r=await runPatcher(verb,managed,{patcher});log(`patcher ${verb}: ${r.out.split(/\r?\n/).slice(-2).join(' / ')}`);
    if(r.code!==0){writeJson(paths(c.dataDir).attachRecord,rec);throw Object.assign(err(`The patcher's ${verb} step failed: ${r.out.split(/\r?\n/).at(-1)}`,500),{output:r.out});}
    if(verb==='patch')rec.patched=true;
   }
   if(await sha256File(join(managed,PATCH_BACKUP))!==settings.server.assemblyCSharpSha256)throw err('The patcher\'s copy of the original Assembly-CSharp.dll does not have the verified hash; stop and check the server folder',500);
  }
  if(!files.some(x=>x.path===info.cfgFile))backupFile(c.dataDir,info.cfgFile,files);
  mkdirSync(dirname(info.cfgFile),{recursive:true});writeFileSync(info.cfgFile,cfgText({pluginKey,launcherOnly}),'ascii');
 }else{
  // Oxide: our one plugin file and its config; Oxide loads it by itself. Their other plugins stay as they are.
  const plugin=info.oxide.plugin,config=join(info.oxide.dir,'config','RustLegacyBrowser.json');
  for(const f of [plugin,config])if(!files.some(x=>x.path===f))backupFile(c.dataDir,f,files);
  copyFileSync(OXIDE_PLUGIN,plugin);
  mkdirSync(dirname(config),{recursive:true});writeFileSync(config,JSON.stringify({SidecarUrl:`http://127.0.0.1:${PORTS.sidecar}/plugin`,PluginKeyHex:pluginKey,LauncherOnly:launcherOnly},null,2));
 }
 writeJson(paths(c.dataDir).attachRecord,rec);
 saveSiteState(c.dataDir,{launcherOnly});
 return {how:b.how,files:files.map(f=>f.path),launcherOnly};
}

export async function undoBrowserReady(file,{serverRunning=()=>false,patcher=join(ADAPTER_BIN,'patcher','VanillaPatcher.exe'),log=()=>{}}={}){
 const c=loadHostConfig(file),rec=record(c.dataDir);
 if(!rec)throw err('Nothing to undo: this server was not made browser ready by the host app',404);
 if(serverRunning())throw err('Stop the game server first',409);
 if(rec.patched){
  const r=await runPatcher('restore',join(rec.dir,'rust_server_Data','Managed'),{patcher});log('patcher restore: '+r.out.split(/\r?\n/).at(-1));
  if(r.code!==0)throw Object.assign(err('The patcher could not restore the original Assembly-CSharp.dll: '+r.out.split(/\r?\n/).at(-1),500),{output:r.out});
 }
 for(const f of [...rec.files].reverse()){
  if(f.copy&&exists(f.copy))copyFileSync(f.copy,f.path);else if(!f.copy&&exists(f.path))unlinkSync(f.path);
 }
 rmSync(paths(c.dataDir).attach,{recursive:true,force:true});
 return {restored:rec.files.length+(rec.patched?1:0)};
}

// One enrolment code: the gateway's credential and (new websites) the host app key. Then the sidecar and gateway parts.
export async function connectWebsite(file,{code,website,fetchImpl=fetch}={}){
 if(typeof code!=='string'||!/^[A-Za-z0-9_-]{20,64}$/.test(code.trim()))throw err('Paste the enrolment code from Your servers on the website');
 const c=loadHostConfig(file),p=ensureSecrets(c.dataDir),st=siteState(c.dataDir);
 website=website?new URL(website).href:st.website??WEBSITE;
 let r;try{r=await enrolGateway({baseUrl:website,code:code.trim(),hostKey:true,fetchImpl});}
 catch(e){throw err(/invalid-code/.test(e.message)?'The website did not accept that code. Codes last 15 minutes and work once: make a new one on Your servers.':'Could not reach the website: '+e.message,/invalid-code/.test(e.message)?401:502);}
 writeFileSync(p.credential,r.credential+'\n',{mode:0o600});
 if(r.hostKey)writeFileSync(p.hostKey,r.hostKey+'\n',{mode:0o600});
 saveSiteState(c.dataDir,{website,serverId:r.serverId,connectedAt:Date.now()});
 writeParts(file);
 return {serverId:r.serverId,hostKey:Boolean(r.hostKey)};
}

// Public address. Certificate files arrive as base64 from the Setup page and go straight into the secrets folder.
export function setAddress(file,{mode,port,cloudflare=false,pfx,passphrase,cert,key}={}){
 const c=loadHostConfig(file),p=ensureSecrets(c.dataDir);
 if(!['none','proxy','certificate'].includes(mode))throw err('Choose how browsers reach the gateway');
 if(port!==undefined&&!(Number.isInteger(port)&&port>=1&&port<=65535))throw err('The port must be 1..65535');
 const address={mode,...(port?{port}:{}),cloudflare:Boolean(cloudflare)};
 if(mode==='certificate'){
  const b64=v=>Buffer.from(String(v),'base64');
  if(pfx){writeFileSync(join(p.secrets,'gateway-tls.pfx'),b64(pfx),{mode:0o600});writeFileSync(join(p.secrets,'gateway-tls.pass'),String(passphrase??'')+'\n',{mode:0o600});address.pfx=true;}
  else if(cert&&key){writeFileSync(join(p.secrets,'gateway-tls.crt'),b64(cert),{mode:0o600});writeFileSync(join(p.secrets,'gateway-tls.key'),b64(key),{mode:0o600});}
  else if(!siteState(c.dataDir).address||siteState(c.dataDir).address.mode!=='certificate')throw err('Add the certificate: a .pfx file with its password, or a certificate and key in PEM');
  else address.pfx=siteState(c.dataDir).address.pfx;
 }
 saveSiteState(c.dataDir,{address});
 if(siteState(c.dataDir).serverId)writeParts(file);
 return address;
}

// (Re)writes sidecar.json and gateway.json from the setup state and adds both parts to host.json.
export function writeParts(file){
 const c=loadHostConfig(file),p=paths(c.dataDir),st=siteState(c.dataDir);
 if(!st.serverId)return false;
 const port=Number(argAfter(c.components?.server?.args??[],'-port')??29015);
 const {sidecar,gateway}=partConfigs(c.dataDir,{serverId:st.serverId,website:st.website??WEBSITE,address:st.address??{mode:'none'},nativePort:port});
 writeJson(p.sidecar,sidecar);writeJson(p.gateway,gateway);
 editHostJson(file,h=>{h.components??={};h.components.sidecar={config:p.sidecar};h.components.gateway={config:p.gateway};});
 return true;
}

// What the Setup page shows: each step done or not, and what is left.
export async function setupStatus(file,{settings=hostTestSettings(),inspect=true}={}){
 const c=loadHostConfig(file),p=paths(c.dataDir),st=siteState(c.dataDir),s=c.components?.server,rec=record(c.dataDir);
 let server=null;
 if(s?.kind==='original'&&inspect){try{server=await inspectServer(s.dir,{settings});}catch(e){server={dir:s.dir,error:e.message};}}
 const scripts=Boolean(c.scripts?.root);
 const steps={
  server:{done:Boolean(s?.kind==='original'&&server?.found),dir:s?.dir??null,accepted:Boolean(s?.exeSha256),info:server},
  browserReady:{done:Boolean(server?.browserReady?.done||rec),how:rec?.how??server?.browserReady?.how??null,byHost:Boolean(rec),files:rec?.files.map(f=>f.path)??[],launcherOnly:rec?.launcherOnly??st.launcherOnly??false,
   possible:Boolean(server?.browserReady?.possible),reason:server?.browserReady?.reason??null},
  website:{done:Boolean(st.serverId&&exists(p.credential)),website:st.website??WEBSITE,serverId:st.serverId??null,hostKey:exists(p.hostKey),connectedAt:st.connectedAt??null},
  address:{done:Boolean(st.address&&st.address.mode!=='none'),...(st.address??{mode:'none'})},
  run:{done:Boolean(s?.confirmRunOriginalBinaries)},
 };
 return {scripts,steps,complete:Object.values(steps).every(x=>x.done)};
}

// ---------- Command line (the installer and uninstaller) ----------
//   node host/setup.mjs inspect <server folder>                 → JSON (the installer's server page)
//   node host/setup.mjs checkzip <RustLegacyServer.zip>         → JSON {sha256, verified}
//   node host/setup.mjs unpack <RustLegacyServer.zip> <dest>    → JSON {dir}
//   node host/setup.mjs init <host.json> --data <dir> [--server <dir> [--accept]] [--port n] [--website url]
//   node host/setup.mjs undo <host.json>                        → puts the server's files back (uninstall)
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [cmd,a,b,...rest]=process.argv.slice(2),all=[b,...rest].filter(x=>x!==undefined);
 const opt=n=>{const i=all.indexOf('--'+n);return i<0?undefined:all[i+1];};
 const out=v=>process.stdout.write(JSON.stringify(v)+'\n');
 try{
  if(cmd==='inspect'&&a)out(await inspectServer(a));
  else if(cmd==='checkzip'&&a)out(await checkServerZip(a));
  else if(cmd==='unpack'&&a&&b)out({dir:await unpackServerZip(a,b)});
  else if(cmd==='init'&&a){await initHostJson(resolve(a),{dataDir:opt('data'),server:opt('server'),accept:all.includes('--accept'),port:opt('port')?Number(opt('port')):undefined,website:opt('website')});out({ok:true});}
  else if(cmd==='undo'&&a)out(await undoBrowserReady(resolve(a)));
  else{console.error('usage: node host/setup.mjs inspect <dir> | checkzip <zip> | unpack <zip> <dest> | init <host.json> --data <dir> [--server <dir>] | undo <host.json>');process.exit(2);}
 }catch(e){out({error:e.message,status:e.status??500,...(e.inspect?{inspect:e.inspect}:{})});process.exit(1);}
}
