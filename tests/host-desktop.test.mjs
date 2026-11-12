// The host desktop app (HOST-AND-LOADER-BUILD.md A1) across its languages, without building it: the WebView2 bridge
// (host/dashboard/desktop-bridge.mjs) against the C# window (host/desktop/MainForm.cs), the security rules (no shell or
// command route in the service, the bridge only for the dashboard's origin, the owner token and shells only for the
// real service), the terminal's Host commands against the service's routes and with a fake API, the page CSP (styles
// only, never scripts), the installer's desktop steps and the kit build. The dashboard check
// (tools/check-host-dashboard.mjs) drives the boot screen and the terminal panel in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {listenServer} from '../bridge/listen.mjs';
import {BRIDGE,desktopBridge,demoBridge,pickBridge} from '../host/dashboard/desktop-bridge.mjs';
import {createHostShell,complete,tokenize,ROUTES,COMMANDS} from '../host/dashboard/host-commands.mjs';
import {createServiceHandler,pageCsp,VENDOR} from '../host/service.mjs';
import {hostAppFiles,iconIco,ICON_RECTS} from '../tools/build-host-installer.mjs';
import {psBalance,body,gate,CHANGES} from './helpers/powershell.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const bridgeSrc=read('host/dashboard/desktop-bridge.mjs'),form=read('host/desktop/MainForm.cs'),settings=read('host/desktop/HostSettings.cs'),shell=read('host/desktop/ShellSession.cs');
const terminal=read('host/dashboard/terminal.mjs'),hostPage=read('host/dashboard/host.mjs'),commands=read('host/dashboard/host-commands.mjs');
const service=read('host/service.mjs'),toolsApi=read('host/tools-api.mjs');
const strip=s=>s.replace(/^\s*\/\/.*$/gm,''); // code, not comments

test('bridge: every call and notice the page sends is handled by the app, and nothing else is', ()=>{
 const desk=bridgeSrc.slice(bridgeSrc.indexOf('export function desktopBridge'),bridgeSrc.indexOf('export function demoBridge'));
 assert.deepEqual(new Set([...desk.matchAll(/call\('([\w.]+)'/g)].map(m=>m[1])),new Set(BRIDGE.calls));
 assert.deepEqual(new Set([...desk.matchAll(/notice\('([\w.]+)'/g)].map(m=>m[1])),new Set(BRIDGE.notices));
 const methods=[...BRIDGE.calls,...BRIDGE.notices];
 for(const m of methods)assert.ok(form.includes(`case "${m}":`),`MainForm handles ${m}`);
 // The app's allow-list is exactly the contract, and every case in Run is in it.
 const allow=/HashSet<string> Methods = new HashSet<string> \{([^}]*)\}/.exec(form)[1];
 assert.deepEqual(new Set([...allow.matchAll(/"([\w.]+)"/g)].map(m=>m[1])),new Set(methods));
 const run=form.slice(form.indexOf('JsonNode Run(string method'),form.indexOf('static int Clamp'));
 assert.deepEqual(new Set([...run.matchAll(/case "([\w.]+)":/g)].map(m=>m[1])),new Set(methods));
 // Calls are answered with {id, result} or {id, error, message}; the page reads exactly those.
 assert.match(form,/\["id"\] = id, \["result"\] = result/);assert.match(form,/\["error"\] = e is HostError he \? he\.Code : "failed", \["message"\] = e\.Message/);
 assert.match(desk,/if\(m\.error\)w\.reject\(Object\.assign\(Error\(m\.message\|\|m\.error\),\{code:m\.error\}\)\)/);
});

test('bridge: every event the app posts is one the page listens for', ()=>{
 const posted=new Set([...form.matchAll(/\["event"\] = "([\w.]+)"/g)].map(m=>m[1]));
 assert.deepEqual(posted,new Set(BRIDGE.events));
 for(const e of BRIDGE.events)assert.ok(terminal.includes(`bridge.on('${e}'`)||hostPage.includes(`bridge?.on('${e}'`),`page listens for ${e}`);
 // Field names on both sides.
 assert.match(form,/\["event"\] = "terminal\.data", \["tid"\] = tid, \["data"\] = data/);
 assert.match(form,/\["event"\] = "terminal\.exit", \["tid"\] = tid, \["code"\] = code/);
 assert.match(form,/\["event"\] = "tray\.action", \["action"\] = action/);
 assert.match(terminal,/byTid\.get\(m\.tid\);t\?\.term\?\.write\(m\.data\)/);
});

test('bridge: shells, sizes and tray states agree; the browser demo offers what the app does', async()=>{
 assert.deepEqual(BRIDGE.shells,['powershell','cmd']);
 assert.match(form,/if \(shell != "powershell" && shell != "cmd"\) throw new HostError\("bad-request"/);
 assert.match(shell,/if \(shell == "powershell"\) return "\\"" \+ Path\.Combine\(sys, @"WindowsPowerShell\\v1\.0\\powershell\.exe"\)/,'full path, not PATH');
 assert.match(shell,/if \(shell == "cmd"\) return "\\"" \+ Path\.Combine\(sys, "cmd\.exe"\)/);
 const trayStates=/Array\.IndexOf\(new\[\] \{([^}]*)\}, state\)/.exec(form)[1];
 assert.deepEqual([...trayStates.matchAll(/"(\w+)"/g)].map(m=>m[1]),BRIDGE.trayStates);
 // The page sends only those states (host.mjs renderBar).
 for(const s of ['frozen','crashed','starting'])assert.match(hostPage,new RegExp(`'${s}'`));
 const keys=o=>Object.keys(o).sort();
 const fakeView={addEventListener(){},postMessage(){}};
 assert.deepEqual(keys(demoBridge()),keys(desktopBridge(fakeView)));
 assert.equal(pickBridge({}),null,'a plain browser has no bridge (no shell tabs)');
 assert.equal(pickBridge({RLB_DEMO_BRIDGE:true}).kind,'demo');
 assert.equal(pickBridge({chrome:{webview:fakeView}}).kind,'desktop');
 // The demo shell answers and exits like a real one, through the same events.
 const d=demoBridge(),got=[];d.on('terminal.data',m=>got.push(m.data));const exited=new Promise(r=>d.on('terminal.exit',r));
 const {tid}=await d.open({shell:'powershell',cols:80,rows:24});
 d.input(tid,'whoami\r');d.input(tid,'exit\r');
 assert.equal((await exited).code,0);
 assert.match(got.join(''),/Demo shell \(browser preview\)/);assert.match(got.join(''),/demo-pc\\owner/);
 await assert.rejects(d.open({shell:'bash'}));
});

test('security: the bridge answers only the dashboard origin, and the token and shells only the real service', ()=>{
 const code=strip(form);
 assert.match(code,/if \(!IsDashboard\(e\.Source\)\) return;\s+string json;/,'Source checked before anything is parsed');
 assert.match(code,/bool IsDashboard\(string uri\) => uri != null && uri\.StartsWith\(host\.Origin \+ "\/", StringComparison\.Ordinal\);/);
 assert.match(settings,/public string Origin => "http:\/\/127\.0\.0\.1:" \+ Port;/);
 assert.match(code,/case "app\.token":\s+RequireHost\(\);/);
 assert.match(code,/case "terminal\.open":\s+\{\s+RequireHost\(\);/);
 assert.match(code,/if \(!host\.ListenerIsHost\(out string why\)\) throw new HostError\("listener-unverified"/);
 // The listener must be the service's process or its child; only --dev skips it.
 assert.match(settings,/if \(listener == service \|\| ParentPid\(listener\) == service\) \{ why = null; return true; \}/);
 assert.match(settings,/Dev = Array\.IndexOf\(args, "--dev"\) >= 0/);
 // Navigation stays on the dashboard; links leave for the browser, https only.
 assert.match(code,/if \(IsDashboard\(e\.Uri\)\) return;/);
 assert.match(code,/e\.Cancel = true; OpenExternal\(e\.Uri\);/);
 assert.match(code,/u\.Scheme == Uri\.UriSchemeHttps/);
 // Shells: suspended until inside a kill-on-close Job Object; the app's own token (no other account).
 assert.match(shell,/CREATE_SUSPENDED/);assert.match(shell,/LimitFlags = 0x2000; \/\/ JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
 assert.ok(shell.indexOf('AssignProcessToJobObject(job, process)')<shell.indexOf('ResumeThread(pi.hThread)'));
 assert.doesNotMatch(shell,/CreateProcessWithLogon|CreateProcessAsUser|LogonUser/);
 assert.match(shell,/PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016/);
 assert.match(code,/foreach \(var s in shells\.Values\) s\.Dispose\(\);/,'quitting ends every shell');
});

test('security: the service has no shell or command route; the website console gets nothing new', async()=>{
 for(const [name,src] of [['service.mjs',service],['tools-api.mjs',toolsApi]]){
  assert.doesNotMatch(strip(src),/child_process|(?<![.\w])(spawn|exec|execFile|fork)\(|powershell|cmd\.exe|conpty|\/api\/(terminal|shell|exec|command)\b/i,name);
 }
 // A signed-in owner asking for one anyway gets 404.
 const fakeHost={hub:{subscribe:()=>()=>{},since:()=>[],push(){}},on(){},off(){},status:()=>({components:[]}),components:()=>[]};
 const server=await listenServer(createServer());
 const port=server.address().port,handler=createServiceHandler({host:fakeHost,token:'t'.repeat(40),port});server.on('request',handler);
 try{
  const base=`http://127.0.0.1:${port}`,h={origin:base,'x-rlb-host':'1','content-type':'application/json'};
  const login=await fetch(base+'/api/login',{method:'POST',headers:h,body:JSON.stringify({token:'t'.repeat(40)})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  for(const p of ['/api/terminal','/api/shell','/api/exec','/api/command','/api/terminal/open','/api/powershell'])
   assert.equal((await fetch(base+p,{method:'POST',headers:{...h,cookie},body:'{"shell":"powershell"}'})).status,404,p);
  // The page: script-src stays 'self'; styles carry a fresh nonce that is on xterm's stylesheet link.
  const pages=await Promise.all([1,2].map(()=>fetch(base+'/')));
  const csp=pages.map(r=>r.headers.get('content-security-policy')),html=await pages[0].text();
  const nonce=/'nonce-([^']+)'/.exec(csp[0])[1];
  assert.notEqual(nonce,/'nonce-([^']+)'/.exec(csp[1])[1],'a new nonce per response');
  assert.ok(html.includes(`<link rel="stylesheet" href="/vendor/xterm.css" nonce="${nonce}">`));
  assert.ok(!html.includes('__STYLE_NONCE__'));
  assert.match(csp[0],/(^|; )script-src 'self';/);
  for(const v of ['xterm.mjs','addon-fit.mjs','xterm.css']){const r=await fetch(base+'/vendor/'+v);assert.equal(r.status,200,v);await r.arrayBuffer();}
  assert.equal((await fetch(base+'/vendor/../package.json')).status,404);
  assert.equal((await fetch(base+'/vendor/other.mjs')).status,404);
  // Everything else keeps the strict policy.
  assert.match((await fetch(base+'/host.css')).headers.get('content-security-policy'),/style-src 'self'; script-src 'self'/);
 }finally{handler.close();server.close();}
 // The website's console and the remote relay: no shells, and the relay still runs only its fixed operations.
 const console_=read('site/pages/console.html');
 assert.doesNotMatch(console_,/powershell|cmd\.exe|conpty|terminal\.(open|input)|webview/i);
 const remote=read('host/remote.mjs');
 assert.match(remote,/const POWER=new Set\(\['start','stop','restart'\]\);/);
 assert.deepEqual([...remote.matchAll(/c\.op==='([\w-]+)'/g)].map(m=>m[1]),['backup-keep','backup-restore','restart-in','restart-cancel']);
});

test('CSP: the page relaxes styles only as far as xterm needs, never scripts', ()=>{
 const csp=pageCsp('abc');
 const dir=Object.fromEntries(csp.split('; ').map(d=>{const [k,...v]=d.split(' ');return [k,v.join(' ')];}));
 assert.equal(dir['script-src'],"'self'");
 assert.equal(dir['style-src'],"'self' 'nonce-abc'");
 assert.equal(dir['style-src-attr'],"'unsafe-inline'");
 assert.equal(dir['style-src-elem'],undefined);
 assert.equal(dir['default-src'],"'self'");assert.equal(dir['connect-src'],"'self'");assert.equal(dir['frame-ancestors'],"'none'");
 assert.doesNotMatch(csp,/unsafe-eval|wasm-unsafe|\*/);
 // terminal.mjs gives the nonce to <style> elements only.
 assert.match(terminal,/if\(String\(tag\)\.toLowerCase\(\)==='style'\)e\.nonce=nonce;/);
 // Pinned renderer versions, served from node_modules.
 const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
 for(const n of ['@xterm/xterm','@xterm/addon-fit']){assert.match(pkg.dependencies[n],/^\d+\.\d+\.\d+$/,n+' exact');assert.equal(lock.packages['node_modules/'+n].version,pkg.dependencies[n]);}
 assert.match(VENDOR['xterm.mjs'],/@xterm[\\/]xterm[\\/]lib[\\/]xterm\.mjs$/);
});

test('Host tab: commands use only existing routes, through the dashboard api()', ()=>{
 const code=strip(commands);
 assert.doesNotMatch(code+strip(terminal),/\bfetch\(|XMLHttpRequest|EventSource|WebSocket/,'no network of its own');
 const used=[...code.matchAll(/api\('([^']+)'(?:,\{method:'(\w+)')?/g)].map(m=>[m[2]??'GET',m[1]]);
 assert.equal(used.length,5);
 for(const u of used)assert.ok(ROUTES.some(r=>r[0]===u[0]&&r[1]===u[1]),'listed route '+u.join(' '));
 for(const [method,path] of ROUTES){
  const known=service.includes(`'${path}'`)||(path.startsWith('/api/central/')&&service.includes("path.startsWith('/api/central/')"))||(path==='/api/health-check'&&/health-check\)\$/.test(toolsApi));
  assert.ok(known,`the service has ${method} ${path}`);
 }
 // Power actions go through the dashboard's act() (its confirmation for a running original server), not straight to the API.
 assert.doesNotMatch(code,/api\('\/api\/action'/);assert.match(hostPage,/act:\(a,t\)=>act\(a,t\)/);
});

test('Host tab: parsing and completion', ()=>{
 assert.deepEqual(tokenize(`backup now "before the wipe"`),['backup','now','before the wipe']);
 assert.deepEqual(complete('rest'),{line:'restart',options:['restart','restart-in']});
 assert.equal(complete('restart g').line,'restart gateway ');
 assert.equal(complete('st').options.join(),'status,start,stop');
 assert.equal(complete('logs ').options.includes('--follow'),true);
 assert.equal(complete('logs a').options.length,0,'"all" is not a log source');
 assert.equal(complete('backup ').line,'backup now ');
 assert.equal(complete('health ').options.length,0);
 assert.ok(Object.keys(COMMANDS).every(c=>/^[a-z-]+$/.test(c)));
});

// A fake dashboard for the Host shell: status, logs and the SSE events it would see.
function fakeDashboard(){
 const listeners={state:new Set(),log:new Set()},calls=[];let out='';
 const status={now:Date.now(),components:[{name:'central',label:'Website',state:'running',pid:11,startedAt:Date.now()-60e3},{name:'gateway',label:'Gateway',state:'running',pid:22,startedAt:Date.now()-90e3,endpoint:'ws://127.0.0.1:28143/play'}],
  watchdog:null,players:{inGame:2},remote:{state:'connected'}};
 const logs=[{seq:1,at:Date.now(),source:'gateway',level:'info',text:'listening on 28143'},{seq:2,at:Date.now(),source:'central',level:'warn',text:'slow query'},{seq:3,at:Date.now(),source:'gateway',level:'error',text:'join refused'}];
 const emit=(kind,x)=>{for(const f of [...listeners[kind]])f(x);};
 const api=async(path,{method='GET',body}={})=>{calls.push([method,path,body]);
  if(path==='/api/health-check')return {at:Date.now(),summary:{pass:1,warn:1,fail:0},rows:[{label:'Gateway listening',status:'PASS',detail:'ok'},{label:'Website players only',status:'WARN',detail:'Off',fix:'Turn it on in Settings.'}]};
  if(path==='/api/backups/keep')return {name:'owner-1.sav'};
  if(path==='/api/central/players')return {players:[{name:'Rook',connectedAt:Date.now()-60e3}],desktop:[]};
  return {ok:true};};
 const acts=[];
 const act=async(action,target)=>{acts.push([action,target]);
  // The supervisor's real sequence for a restart, as SSE 'state' events.
  setTimeout(()=>{const c=status.components.find(x=>x.name===target);for(const [state,pid] of [['stopping',22],['stopped',null],['starting',33],['running',33]]){Object.assign(c,{state,pid});emit('state',{...c});}},10);
  return true;};
 const sh=createHostShell({api,act,status:()=>status,logs:()=>logs,subscribe:(k,f)=>{listeners[k].add(f);return ()=>listeners[k].delete(f);},write:s=>{out+=s;},timeouts:{settle:2000}});
 return {sh,calls,acts,out:()=>out.replace(/\x1b\[[\d;]*m/g,''),emit,listeners};
}

test('Host tab: status, restart with live states, logs, health, backup, restart-in, players', async()=>{
 const d=fakeDashboard();
 await d.sh.run('status');
 assert.match(d.out(),/Website\s+running\s+PID 11 · up 1m/);assert.match(d.out(),/Gateway\s+running\s+PID 22/);assert.match(d.out(),/Players\s+2/);assert.match(d.out(),/Website link connected/);
 await d.sh.run('restart gateway');
 assert.deepEqual(d.acts,[['restart','gateway']]);
 assert.match(d.out(),/Gateway\s+stopping[\s\S]*Gateway\s+starting[\s\S]*\[ OK \] Gateway running \(PID 33\)/);
 assert.equal(d.listeners.state.size,0,'stops listening when done');
 await d.sh.run('restart nothing');assert.match(d.out(),/Say which part/);
 await d.sh.run('logs gateway -n 1');assert.match(d.out(),/GATEWAY\s+join refused/);assert.doesNotMatch(d.out(),/listening on 28143/);
 const follow=d.sh.run('logs --follow');await new Promise(r=>setTimeout(r,20));
 assert.ok(d.sh.busy);
 for(const f of d.listeners.log)f({seq:9,at:Date.now(),source:'host',level:'info',text:'a new line'});
 d.sh.cancel();await follow;assert.match(d.out(),/a new line/);assert.equal(d.listeners.log.size,0);
 await d.sh.run('health');assert.match(d.out(),/\[WARN\] Website players only Off\s+fix: Turn it on in Settings\./);
 await d.sh.run('backup now "before the wipe"');
 await d.sh.run('restart-in 5');await d.sh.run('cancel-restart');await d.sh.run('players');
 assert.deepEqual(d.calls.map(c=>c.slice(0,2).join(' ')),['POST /api/health-check','POST /api/backups/keep','POST /api/schedule/restart-in','POST /api/schedule/cancel','GET /api/central/players']);
 assert.deepEqual(d.calls[1][2],{label:'before the wipe'});assert.deepEqual(d.calls[2][2],{minutes:5});
 assert.match(d.out(),/Rook/);
 await d.sh.run('rm -rf /');assert.match(d.out(),/Unknown command "rm"/);
 assert.equal(d.calls.length,5,'an unknown command calls nothing');
});

test('Host tab: a cancelled confirmation or a refused action says so and stops listening', async()=>{
 const d=fakeDashboard(),sh=createHostShell({api:async()=>({}),act:async()=>false,status:()=>({components:[{name:'server',state:'running',pid:1}]}),logs:()=>[],subscribe:(k,f)=>{d.listeners[k].add(f);return ()=>d.listeners[k].delete(f);},write:()=>{}});
 await sh.run('stop server');assert.equal(d.listeners.state.size,0);assert.equal(sh.busy,false);
});

const install=read('deploy/host-app/Install-RustLegacyHost.ps1'),uninstall=read('deploy/host-app/Uninstall-RustLegacyHost.ps1');
const HOST_CHANGES=new RegExp(CHANGES.source+'|\\b(New-Service|Start-Service|Stop-Service|Stop-Process)\\b');
test('installer: balanced, nothing changes before the -Apply gate, the desktop steps come after the service', ()=>{
 for(const [name,src] of [['install',install],['uninstall',uninstall]]){
  assert.ok(psBalance(src),name);
  const run=body(src),at=run.search(gate);
  assert.ok(at>0,name+': dry-run gate');
  const first=run.search(HOST_CHANGES);
  assert.ok(first>at,`${name}: first change (${run.slice(first,first+40)}) comes after the gate`);
 }
 const run=body(install);
 assert.match(install,/\[switch\]\$DesktopShortcut, \[switch\]\$StartAtSignIn, \[switch\]\$Apply\)/);
 assert.match(install,/\[string\]\$AppUser = \[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.Name/);
 // Read on owner.token only: the one icacls line for the app's account, after the service wrote the token.
 const grants=[...run.matchAll(/& icacls\.exe ([^\n]*)\$\{AppUser\}[^\n]*/g)];
 assert.equal(grants.length,1);assert.match(grants[0][0],/^& icacls\.exe \$token \/grant "\$\{AppUser\}:R"/);
 assert.ok(run.indexOf(grants[0][0])>run.indexOf('Start-Service -Name $service'),'after the token exists');
 assert.doesNotMatch(run,/icacls\.exe \$DataDir[^\n]*AppUser/);
 // The app's settings carry the port (the data folder stays closed to it), and its shortcuts and sign-in entry.
 assert.match(run,/\$appSettings = \[ordered\]@\{ dataDir = \$DataDir; port = \$Port;/);
 assert.match(run,/'desktop\\RustLegacyHost\.json'/);
 assert.match(install,/GetFolderPath\('CommonPrograms'\)\) 'Rust Legacy Host\.lnk'/);
 assert.match(run,/if \(\$DesktopShortcut\) \{ \$links \+= \$desktopLink \}/);
 assert.match(run,/if \(\$StartAtSignIn\) \{ New-ItemProperty -Force -Path \$runKey -Name 'RustLegacyHost' -Value "`"\$appExe`" --tray"/);
 assert.match(install,/\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5\}/,'WebView2 check');assert.match(install,/Microsoft\.WindowsDesktop\.App/);
 assert.match(read('host/desktop/Program.cs'),/Array\.IndexOf\(args, "--tray"\) >= 0/,'the flag the app understands');
 assert.match(settings,/Path\.Combine\(AppContext\.BaseDirectory, "RustLegacyHost\.json"\)/);
 assert.match(settings,/"owner\.token"/);
 // Uninstall: app closed, shortcuts and the sign-in entry gone, the token back to administrators when data is kept.
 const un=body(uninstall);
 assert.match(un,/Get-Process -Name 'RustLegacyHost'[^\n]*\| Stop-Process -Force/);
 assert.match(un,/foreach \(\$l in \$links\) \{ if \(Test-Path -LiteralPath \$l\) \{ Remove-Item/);
 assert.match(un,/Remove-ItemProperty -LiteralPath \$runKey -Name 'RustLegacyHost'/);
 assert.match(un,/elseif \(Test-Path -LiteralPath \$token\) \{ & icacls\.exe \$token \/reset/);
});

test('kit: the terminal renderer ships, the desktop app is built into desktop\\ with its icon', ()=>{
 const files=hostAppFiles();
 for(const f of ['node_modules/@xterm/xterm/lib/xterm.mjs','node_modules/@xterm/xterm/css/xterm.css','node_modules/@xterm/addon-fit/lib/addon-fit.mjs','host/dashboard/terminal.mjs','host/dashboard/boot.mjs','host/dashboard/frame.css'])
  assert.ok(files.includes(f),f);
 const build=read('tools/build-host-installer.mjs');
 assert.match(build,/if\(desktop\)buildDesktop\(join\(kit,'desktop'\)\);/);
 assert.match(build,/'publish',join\(repo,'host','desktop','RustLegacyHost\.csproj'\),'-c','Release','-r','win-x64','--self-contained','false'/);
 const proj=read('host/desktop/RustLegacyHost.csproj');
 assert.match(proj,/<AssemblyName>RustLegacyHost<\/AssemblyName>/);assert.match(proj,/<ApplicationIcon Condition="'\$\(AppIcon\)' != ''">\$\(AppIcon\)<\/ApplicationIcon>/);
 assert.match(proj,/<TargetFramework>net8\.0-windows<\/TargetFramework>/);
 assert.equal(/Microsoft\.Web\.WebView2" Version="([^"]+)"/.exec(proj)[1],/Microsoft\.Web\.WebView2" Version="([^"]+)"/.exec(read('launcher/host/RustLegacyLauncher.csproj'))[1],'same WebView2 SDK as the loader');
 // The icon: a valid .ico whose 32 px image is icon.svg's three rectangles.
 const ico=iconIco([32]);
 assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),1);
 const off=ico.readUInt32LE(18),px=(x,y)=>{const o=off+40+((31-y)*32+x)*4;return [ico[o+2],ico[o+1],ico[o]];};
 assert.deepEqual(px(1,1),[10,10,10]);assert.deepEqual(px(15,12),[205,90,40]);assert.deepEqual(px(15,23),[95,169,160]);
 const svg=read('host/dashboard/icon.svg');
 for(const [x0,y0,x1,y1] of ICON_RECTS.slice(1))assert.ok(svg.includes(`x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}"`),'icon.svg has '+[x0,y0,x1,y1]);
});
