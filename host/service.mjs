// Rust Legacy host service: serves the owner dashboard and its API on 127.0.0.1 (HOST-APP-PLAN.md "Security").
//   node host/service.mjs run <host.json>     → in a console, prints a one-time sign-in link with the owner token
//   node host/service.mjs check <host.json>
// API (session cookie): GET /api/status, POST /api/action {action, target}, GET /api/events (Server-Sent Events:
// backlog after Last-Event-ID / ?since=, then log, state, watchdog, saves, players), POST /api/login {token}, POST /api/logout.
// Accounts (HOST-APP-PLAN.md "Accounts and links"): GET /api/accounts, POST /api/accounts/unlink {subject, reason},
// POST /api/accounts/key {key} (the host app key from the website's owner page).
// Off-site backups: GET /api/offsite, POST /api/offsite/settings|run|restore. Release feed: GET /api/feed,
// POST /api/feed/check|settings|download.
// Players and Anti-cheat: GET|POST /api/central/<route> (a fixed list of central admin routes for this server, through
// the host app key; host/accounts.mjs ADMIN_ROUTES), GET /api/screenshot/<id> (image).
// Health: GET /api/metrics?range=24h|7d (host/metrics.mjs). Alerts: GET /api/alerts, POST /api/alerts/settings {url?, events?,
// flagSeverity?}, POST /api/alerts/test (host/alerts.mjs; the Discord webhook URL is the only outbound URL an owner sets).
// Schedule (host/schedule.mjs): GET /api/schedule, POST /api/schedule/save {schedule, confirmWipe},
// POST /api/schedule/restart-in {minutes, wipe?: 'world'|'full', confirm}, POST /api/schedule/cancel.
// Setup (host/wizard.mjs): GET /api/setup, POST /api/setup/mode {mode}, /plan {step, options}, /run {step, options, by?},
// /cancel {step}; live output as 'setup' events.
// An existing server as it is (host/setup.mjs, Setup's third choice): GET /api/attach, POST /api/attach/inspect|server|
// browser-ready|browser-ready/undo|connect|address|run. Changes that alter the parts reload the host in place (same log
// stream, same sign-in), with the game server stopped.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,extname} from 'node:path';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {startHost,ACTIONS} from './host.mjs';
import {loadHostConfig,validateHostConfig,REPO} from './config.mjs';
import * as attachSteps from './setup.mjs';
import {listenServer} from '../bridge/listen.mjs';
import {TOOL_PATHS,handleToolsApi} from './tools-api.mjs';

const DASH=fileURLToPath(new URL('./dashboard/',import.meta.url));
const FONTS={
 'archivo.woff2':join(REPO,'node_modules','@fontsource-variable','archivo','files','archivo-latin-wdth-normal.woff2'),
 'mono-500.woff2':join(REPO,'node_modules','@fontsource','jetbrains-mono','files','jetbrains-mono-latin-500-normal.woff2'),
 'mono-700.woff2':join(REPO,'node_modules','@fontsource','jetbrains-mono','files','jetbrains-mono-latin-700-normal.woff2'),
};
// The terminal panel's renderer (host/dashboard/terminal.mjs), from node_modules like the fonts; versions pinned in
// package.json. Static files: the service has no shell or command route, and these add none.
export const VENDOR={
 'xterm.mjs':join(REPO,'node_modules','@xterm','xterm','lib','xterm.mjs'),
 'xterm.css':join(REPO,'node_modules','@xterm','xterm','css','xterm.css'),
 'addon-fit.mjs':join(REPO,'node_modules','@xterm','addon-fit','lib','addon-fit.mjs'),
};
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2'};
const SECURITY={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
// The dashboard page itself relaxes styles only, and only as far as xterm.js needs (script-src stays 'self'):
//  - xterm adds <style> elements for its cell sizes and theme. They carry this response's nonce: terminal.mjs gives
//    every <style> the page creates the nonce of the <link> it is served on, so no other inline sheet applies.
//  - xterm's DOM renderer colours true-colour cells with style attributes (style-src-attr 'unsafe-inline'). A style
//    attribute cannot run script or load anything ('self' still bounds every fetch).
export const pageCsp=nonce=>`default-src 'self'; img-src 'self' data:; style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
export const SESSION_MS=12*3600e3,BACKLOG=2000,STALL_MS=30000;
const digest=s=>createHash('sha256').update(String(s)).digest();
const same=(a,b)=>timingSafeEqual(digest(a),digest(b));

export function ownerToken(dataDir){
 const f=join(dataDir,'owner.token');
 if(!existsSync(f)){mkdirSync(dataDir,{recursive:true});writeFileSync(f,randomBytes(32).toString('base64url')+'\n',{mode:0o600});}
 return readFileSync(f,'utf8').trim();
}

export function createServiceHandler({host,token,port,now=()=>Date.now(),staticDir=DASH,sessions=new Map(),attach=null}){
 const clients=new Set();
 const allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
 const send=(res,status,body,headers={})=>{res.writeHead(status,{...SECURITY,'Cache-Control':'no-store','Content-Type':'application/json',...headers});res.end(body===undefined?'':JSON.stringify(body));};
 const cookie=req=>/(?:^|;\s*)rlbhost=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie??'')?.[1];
 const signedIn=req=>{const c=cookie(req);if(!c)return false;const s=sessions.get(c);if(!s||s<now()){sessions.delete(c);return false;}return true;};
 const readBody=(req,limit=4096)=>new Promise((res,rej)=>{let b='';req.setEncoding('utf8');req.on('data',d=>{b+=d;if(b.length>limit){rej(Error('too large'));req.destroy();}});req.on('end',()=>{try{res(b?JSON.parse(b):{});}catch{rej(Error('bad json'));}});});

 // Live events: every client gets log lines in 50 ms batches and the state/watchdog/saves/players events as they happen.
 let batch=[],flushTimer=null;
 const writeTo=(c,text)=>{
  if(c.res.writableEnded)return;
  if(!c.res.write(text)){c.stalledSince??=now();if(now()-c.stalledSince>STALL_MS){c.res.destroy();clients.delete(c);}}
  else c.stalledSince=null;
 };
 const broadcast=text=>{for(const c of clients)writeTo(c,text);};
 const unsub=host.hub.subscribe(line=>{batch.push(line);flushTimer??=setTimeout(()=>{flushTimer=null;const b=batch;batch=[];broadcast(b.map(l=>`id: ${l.seq}\nevent: log\ndata: ${JSON.stringify(l)}\n\n`).join(''));},50);});
 const relay=name=>data=>broadcast(`event: ${name}\ndata: ${JSON.stringify(data??null)}\n\n`);
 const relays=Object.fromEntries(['state','watchdog','saves','players',...(host.setup?['setup']:[])].map(n=>[n,relay(n)]));
 for(const [n,f] of Object.entries(relays))host.on(n,f);
 const keepAlive=setInterval(()=>broadcast(': keep-alive\n\n'),15000);keepAlive.unref?.();

 const handler=async(req,res)=>{
  // DNS rebinding: only our own loopback names.
  if(!allowedHosts.includes(String(req.headers.host??'').toLowerCase()))return send(res,421,{error:'wrong-host'});
  const url=new URL(req.url,`http://${req.headers.host}`),path=url.pathname;
  if(req.method==='POST'){
   if(req.headers.origin!==`http://${req.headers.host}`||req.headers['x-rlb-host']!=='1')return send(res,403,{error:'csrf'});
   if(path==='/api/login'){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    if(typeof b.token!=='string'||!same(b.token,token))return send(res,401,{error:'wrong-token'});
    const id=randomBytes(24).toString('base64url');sessions.set(id,now()+SESSION_MS);
    return send(res,200,{ok:true},{'Set-Cookie':`rlbhost=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS/1000}`});
   }
   if(!signedIn(req))return send(res,401,{error:'sign-in'});
   if(TOOL_PATHS.test(path))return handleToolsApi(req,url,host,(st,b)=>send(res,st,b)); // Settings, Plugins, health check
   if(path==='/api/logout'){sessions.delete(cookie(req));return send(res,200,{ok:true},{'Set-Cookie':'rlbhost=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
   if(path==='/api/accounts/unlink'||path==='/api/accounts/key'){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{
     if(path==='/api/accounts/key'){await host.accounts.setKey(b.key);host.hub.push('host','host','Owner: host app key saved; Accounts, Players and Anti-cheat now read the website');return send(res,200,{ok:true});}
     const r=await host.accounts.unlink(b.subject,b.reason);
     host.hub.push('host','host',`Owner: unlinked account ${b.subject} (character ${r.backendId} stays on the server): ${String(b.reason).trim()}`,'warn');
     return send(res,200,r);
    }catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path.startsWith('/api/attach/')){
    // Certificates arrive as base64 in the address step, so that one body may be larger.
    let b;try{b=await readBody(req,path==='/api/attach/address'?262144:4096);}catch{return send(res,400,{error:'bad-request'});}
    if(!attach)return send(res,409,{error:'Setup needs the host started from its host.json (node host/service.mjs run <host.json>)'});
    try{return send(res,200,await attach.act(path.slice(12),b));}catch(e){return send(res,e.status??500,{error:e.message,...(e.inspect?{inspect:e.inspect}:{})});}
   }
   if(path==='/api/updates/upload'){
    // The update tar itself is the request body (streamed to disk); the name comes in the query.
    try{return send(res,200,await host.updates.add(url.searchParams.get('name'),req));}catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path==='/api/updates/install'||path==='/api/updates/rollback'||path==='/api/updates/remove'){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{
     if(path==='/api/updates/install'){host.hub.push('host','host',`Owner: install update ${b.name}${b.withCentral?' (with the website files)':''}`,'warn');return send(res,200,await host.updates.install(b.name,{withCentral:b.withCentral===true}));}
     if(path==='/api/updates/rollback'){host.hub.push('host','host',`Owner: roll back ${b.backup}`,'warn');return send(res,200,await host.updates.rollback(b.backup));}
     host.updates.remove(b.name);return send(res,200,{ok:true});
    }catch(e){return send(res,e.status??500,{error:e.message,...(e.refused?{refused:e.refused.slice(0,20)}:{})});}
   }
   if(path==='/api/backups/keep'||path==='/api/backups/restore'||path==='/api/backups/delete'){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{
     if(path==='/api/backups/keep')return send(res,200,host.backups.keepNow(b.label));
     if(typeof b.name!=='string')return send(res,400,{error:'name required'});
     if(path==='/api/backups/delete'){host.backups.deleteCopy(b.name);return send(res,200,{ok:true});}
     host.hub.push('host','host',`Owner: restore ${b.name}`,'warn');return send(res,200,host.backups.restore(b.name));
    }catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path==='/api/schedule/save'||path==='/api/schedule/restart-in'||path==='/api/schedule/cancel'){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{
     if(path==='/api/schedule/save')return send(res,200,await host.schedule.save(b.schedule,{confirmWipe:b.confirmWipe===true}));
     if(path==='/api/schedule/cancel')return send(res,200,await host.schedule.cancel({by:'owner'}));
     return send(res,200,await host.schedule.restartIn(b.minutes,{wipe:b.wipe??null,confirm:b.confirm===true,by:'owner'}));
    }catch(e){return send(res,e.status??500,{error:e.message});}
   }
   // Off-site backups and the release feed: fixed fields only (host/offsite.mjs, host/release-feed.mjs).
   if(path.startsWith('/api/offsite/')||path.startsWith('/api/feed/')){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{
     const o=host.offsite,f=host.feed;
     if(path.startsWith('/api/offsite/')&&!o)return send(res,404,{error:'no game server in host.json'});
     if(path==='/api/offsite/settings')return send(res,200,o.saveSettings(b));
     if(path==='/api/offsite/run'){host.hub.push('host','host','Owner: off-site backup now');o.backupNow().catch(()=>{});return send(res,202,{accepted:true});} // the page follows it in /api/offsite
     if(path==='/api/offsite/restore'){host.hub.push('host','host',`Owner: restore off-site set ${String(b.set).slice(0,40)}`,'warn');return send(res,200,await o.restore(b.set,{passphrase:typeof b.passphrase==='string'?b.passphrase:undefined}));}
     if(path==='/api/feed/check')return send(res,200,await f.check());
     if(path==='/api/feed/settings')return send(res,200,f.saveSettings(b));
     if(path==='/api/feed/download')return send(res,200,await f.download(b.version));
     return send(res,404,{error:'not-found'});
    }catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path.startsWith('/api/setup/')&&host.setup){
    // Setup wizard (host/wizard.mjs): fixed steps and validated options only; a run answers at once and streams 'setup' events.
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{return send(res,200,await host.setup.handle(path.slice(11),b));}catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path.startsWith('/api/central/')){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{const r=await host.accounts.admin('POST',path.slice(13),{},b);host.hub.push('host','host',`Owner: ${path.slice(13)}${b.action?' '+b.action:''}${b.reason?' ('+String(b.reason).slice(0,80)+')':''}`);return send(res,200,r);}
    catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path==='/api/alerts/settings'||path==='/api/alerts/test'){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    try{
     if(path==='/api/alerts/test'){const r=await host.alerts.test();return send(res,r.ok?200:502,r.ok?{ok:true}:{error:r.error});}
     const v=host.alerts.save(b);if(b.url!==undefined)host.hub.push('host','host',v.configured?`Owner: Discord alerts set up (${v.url})`:'Owner: Discord alerts removed');return send(res,200,v);
    }catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path==='/api/action'){
    let b;try{b=await readBody(req);}catch{return send(res,400,{error:'bad-request'});}
    const {action,target}=b;
    if(!ACTIONS.includes(action)||!(target==='all'||host.components().includes(target)))return send(res,400,{error:'unknown-action'});
    host.act(action,target).catch(e=>host.hub.push('host','host',`${action} ${target} failed: ${e.message}`));
    return send(res,202,{accepted:true});
   }
   return send(res,404,{error:'not-found'});
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'method'});
  if(path==='/api/session')return send(res,200,{signedIn:signedIn(req)});
  if(path.startsWith('/api/')){
   if(!signedIn(req))return send(res,401,{error:'sign-in'});
   if(path==='/api/status')return send(res,200,host.status());
   if(TOOL_PATHS.test(path))return handleToolsApi(req,url,host,(st,b)=>send(res,st,b));
   if(path.startsWith('/api/central/')){try{return send(res,200,await host.accounts.admin('GET',path.slice(13),Object.fromEntries(url.searchParams)));}catch(e){return send(res,e.status??500,{error:e.message});}}
   if(path.startsWith('/api/screenshot/')){
    try{const img=await host.accounts.screenshotImage(path.slice(16));res.writeHead(200,{...SECURITY,'Content-Type':img.type,'Cache-Control':'private, max-age=3600'});return res.end(img.bytes);}
    catch(e){return send(res,e.status??500,{error:e.message});}
   }
   if(path==='/api/attach'){if(!attach)return send(res,200,{available:false});try{return send(res,200,{available:true,...await attach.status()});}catch(e){return send(res,500,{error:e.message});}}
   if(path==='/api/backups')return send(res,200,host.backups.status());
   if(path==='/api/metrics'){try{return send(res,200,host.metrics.query(url.searchParams.get('range')??'24h'));}catch(e){return send(res,e.status??500,{error:e.message});}}
   if(path==='/api/alerts')return send(res,200,host.alerts.view());
   if(path==='/api/schedule')return send(res,200,{...host.schedule.status(),graceful:host.serverControl?.state()??null});
   if(path==='/api/setup'&&host.setup)return send(res,200,host.setup.state());
   if(path==='/api/updates')return send(res,200,host.updates.list());
   if(path==='/api/offsite')return send(res,200,host.offsite?await host.offsite.status({refresh:url.searchParams.has('refresh')}):{available:false});
   if(path==='/api/feed')return send(res,200,host.feed.status());
   if(path==='/api/accounts'){try{return send(res,200,await host.accounts.overview());}catch(e){return send(res,500,{error:e.message});}}
   if(path==='/api/events'){
    const after=Number(req.headers['last-event-id']??url.searchParams.get('since')??0)||0;
    res.writeHead(200,{...SECURITY,'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const c={res,stalledSince:null};
    writeTo(c,`retry: 2000\nevent: status\ndata: ${JSON.stringify(host.status())}\n\n`);
    const backlog=host.hub.since(after,BACKLOG);
    if(backlog.length)writeTo(c,backlog.map(l=>`id: ${l.seq}\nevent: log\ndata: ${JSON.stringify(l)}\n\n`).join(''));
    clients.add(c);req.on('close',()=>clients.delete(c));
    return;
   }
   return send(res,404,{error:'not-found'});
  }
  // Static dashboard (readable without signing in: it shows the sign-in form).
  let file;
  if(path==='/'||path==='/index.html'){
   const nonce=randomBytes(18).toString('base64');
   const page=readFileSync(join(staticDir,'index.html'),'utf8').replaceAll('__STYLE_NONCE__',nonce);
   res.writeHead(200,{...SECURITY,'Content-Security-Policy':pageCsp(nonce),'Content-Type':TYPES['.html'],'Cache-Control':'no-store'});
   return res.end(req.method==='HEAD'?undefined:page);
  }
  else if(/^\/fonts\/[a-z0-9.-]+$/.test(path))file=FONTS[path.slice(7)];
  else if(/^\/vendor\/[a-z0-9.-]+$/.test(path))file=VENDOR[path.slice(8)];
  else if(/^\/[a-z0-9-]+\.(css|mjs|svg)$/.test(path))file=join(staticDir,path.slice(1));
  if(!file||!existsSync(file))return send(res,404,{error:'not-found'});
  res.writeHead(200,{...SECURITY,'Content-Type':TYPES[extname(file)]??'application/octet-stream','Cache-Control':extname(file)==='.woff2'?'max-age=86400':'no-cache'});
  res.end(req.method==='HEAD'?undefined:readFileSync(file));
 };
 handler.close=()=>{unsub();for(const [n,f] of Object.entries(relays))host.off(n,f);clearInterval(keepAlive);clearTimeout(flushTimer);for(const c of clients)c.res.end();clients.clear();};
 handler.clients=clients;
 return handler;
}

// The link carries the token, so it is printed only to a person at a console: under the Windows service wrapper stdout
// is a pipe into the service log, which must never hold the token (found on the Azure VM, 2026-10-24).
// configFile: the host.json the config came from. With it the Setup page can change the setup: those changes are
// written to the file, then the host is reloaded in place (the log hub, the sign-in sessions and the listener stay).
export async function startService(config,{hostOptions={},log=console.log,console:atConsole=Boolean(process.stdout.isTTY),configFile=null,autoStart=false}={}){
 const errors=validateHostConfig(config);if(errors.length)throw Error('Invalid host config:\n - '+errors.join('\n - '));
 const token=ownerToken(config.dataDir),sessions=new Map();
 // The Setup page's "add the parts to host.json" (host/wizard.mjs finish()) needs the file it changes; configFile is
 // only known here, where host.json was read.
 const withSetupFile=opts=>({...opts,setup:{...opts.setup,hostJsonFile:configFile}});
 let host=await startHost(config,withSetupFile(hostOptions)),handler=null,port=config.listen.port;
 // Parts auto-start when the service starts (owner decision, HOST-AND-LOADER-BUILD.md question 7, 29 Oct 2026) — a
 // Windows service restart (boot, or the failure policy's automatic restart) used to leave every part stopped until
 // the owner asked the dashboard to start them (H15). Off by default (the demo and tests start parts themselves, on
 // their own schedule); the real service (node host/service.mjs run) turns it on. A missing server confirmation, or no
 // components configured yet (fresh install, before Setup), refuses some or all parts; act() already logs that to the
 // hub, same as a manual "Start all" that hits the same refusal.
 if(autoStart)host.act('start','all').catch(e=>host.hub.push('host','host',`Auto-start failed: ${e.message}`,'error'));
 const serverRunning=()=>{const p=host.procs.get('server');return Boolean(p&&p.state!=='stopped'&&p.state!=='failed');};
 let reloading=null;
 async function reload(){
  const next=loadHostConfig(configFile),problems=validateHostConfig(next);
  if(problems.length)throw Object.assign(Error('host.json is not valid after that change: '+problems.join('; ')),{status:500});
  const hub=host.hub;handler.close();await host.close({stopChildren:true});
  host=await startHost(next,{...withSetupFile(hostOptions),hub});config=next;
  handler=createServiceHandler({host,token,port,sessions,attach});
  hub.push('host','host','Setup changed: the host reloaded its parts');
 }
 const steps={
  inspect:b=>attachSteps.inspectServer(b.dir),
  server:async b=>{const r=await attachSteps.setServer(configFile,b.dir,{accept:b.accept===true});return {reload:true,result:r};},
  'browser-ready':async b=>({reload:false,result:await attachSteps.makeBrowserReady(configFile,{launcherOnly:b.launcherOnly===true,serverRunning,log:t=>host.hub.push('host','host','Setup: '+t)})}),
  'browser-ready/undo':async()=>({reload:false,result:await attachSteps.undoBrowserReady(configFile,{serverRunning,log:t=>host.hub.push('host','host','Setup: '+t)})}),
  connect:async b=>({reload:true,result:await attachSteps.connectWebsite(configFile,{code:b.code,website:b.website})}),
  address:async b=>({reload:true,result:attachSteps.setAddress(configFile,b)}),
  run:async b=>{attachSteps.confirmRun(configFile,b.confirm===true);return {reload:true,result:{confirm:b.confirm===true}};},
 };
 const attach=configFile?{
  status:()=>attachSteps.setupStatus(configFile),
  async act(step,body){
   const fn=steps[step];if(!fn)throw Object.assign(Error('unknown setup step'),{status:404});
   if(step==='inspect')return fn(body);
   if(reloading)throw Object.assign(Error('The host is still applying the last change'),{status:409});
   // Setup changes the server's files or the parts around it: never while the game server runs.
   if(serverRunning())throw Object.assign(Error('Stop the game server first: setup changes happen while it is stopped'),{status:409});
   const {reload:need,result}=await fn(body);
   host.hub.push('host','host',`Owner: setup (existing server) ${step}`);
   if(need){reloading=reload().finally(()=>{reloading=null;});await reloading;}
   return {ok:true,...(result&&typeof result==='object'?result:{})};
  },
 }:null;
 handler=createServiceHandler({host,token,port,sessions,attach});
 const server=createServer((req,res)=>handler(req,res));
 await listenServer(server,{port:config.listen.port,host:'127.0.0.1'});
 port=server.address().port;
 if(port!==config.listen.port){handler.close();handler=createServiceHandler({host,token,port,sessions,attach});}
 log(atConsole?['Rust Legacy host is running.',`  Open this link in your browser to sign in: http://127.0.0.1:${port}/#token=${token}`,
  `  (The owner token is also in ${join(config.dataDir,'owner.token')}. Press Ctrl+C here to stop everything.)`].join('\n')
  :`Rust Legacy host is running on http://127.0.0.1:${port}/ (sign in with the owner token in ${join(config.dataDir,'owner.token')}).`);
 return {get host(){return host;},server,port,token,reload,close:async({stopChildren=true}={})=>{await reloading?.catch(()=>{});handler.close();await new Promise(r=>server.close(r));server.closeAllConnections?.();await host.close({stopChildren});}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [cmd,file]=process.argv.slice(2);
 if(!['run','check'].includes(cmd)||!file){console.error('usage: node host/service.mjs run|check <host.json>');process.exit(2);}
 const config=loadHostConfig(file),errors=validateHostConfig(config);
 if(errors.length){console.error('Problems:\n - '+errors.join('\n - '));process.exit(1);}
 if(cmd==='check'){console.log('Configuration OK');process.exit(0);}
 const svc=await startService(config,{configFile:file,autoStart:true});
 let closing=false;
 const shutdown=async()=>{if(closing)return;closing=true;console.log('Stopping every component…');await svc.close();process.exit(0);};
 for(const s of ['SIGINT','SIGTERM','SIGBREAK'])process.on(s,shutdown);
 // The Windows service wrapper (host/service-wrapper) cannot send Ctrl+C to a process without a console: it writes
 // "stop" on stdin instead, and the host stops every part it started before exiting.
 if(!process.stdin.isTTY){let line='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{line+=d;if(/(^|\n)stop\r?\n/.test(line))shutdown();if(line.length>1000)line=line.slice(-100);});}
}
