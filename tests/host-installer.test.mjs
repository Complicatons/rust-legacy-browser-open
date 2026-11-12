// Host app installer kit (tools/build-host-installer.mjs): built from this checkout without the private assets, it runs
// on its own (its node.exe and app folder) under the compiled service wrapper in --console mode. "stop" shuts the host
// down gracefully, and killing the wrapper alone ends the host and every part it started (Job Object). No Windows
// service is registered and nothing is installed: the install script itself is only parsed and dry-run, and the setup
// program is built without its administrator manifest and run in /snapshot mode, which installs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {createSocket} from 'node:dgram';
import {buildHostInstaller,hostAppFiles,compileSetup} from '../tools/build-host-installer.mjs';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pidAlive} from '../host/proc-stats.mjs';
import {freeTcpPorts} from './helpers/ports.mjs';

const windows=process.platform==='win32';
const until=async(pred,ms=30000,what='condition')=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,200));}throw Error(what+' not met');};
const freeUdp=()=>new Promise(r=>{const s=createSocket('udp4');s.bind(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const ps=args=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',...args],{encoding:'utf8',windowsHide:true});

test('installer kit: app files leave out the private assets unless asked',()=>{
 const files=hostAppFiles();
 assert.ok(files.includes('host/service.mjs')&&files.includes('host/dashboard/index.html')&&files.includes('tools/gateway.mjs')&&files.includes('deploy/host-test/scripts/05-Start-Server.ps1')&&files.includes('adapter/RustLegacyBrowser.cs'));
 assert.ok(files.some(f=>f.startsWith('node_modules/@fontsource-variable/archivo/')));
 assert.ok(!files.some(f=>f.startsWith('browser/assets/recovered/')));
 assert.ok(!files.some(f=>f.startsWith('site/generated/')),'the website\'s built output stays out');
 // What Setup needs on an owner's machine: the setup steps, the Oxide plugin, the release keys.
 for(const f of ['host/setup.mjs','host/release-feed.pub.pem','adapter/RustLegacyBrowser.cs','host/dashboard/attach.mjs'])assert.ok(files.includes(f),f);
});

test('installer: the service account can read the website signing keys (protected ACL, the folder grant misses them) and the server copy; uninstall takes it back',()=>{
 const install=readFileSync(new URL('../deploy/host-app/Install-RustLegacyHost.ps1',import.meta.url),'utf8'),uninstall=readFileSync(new URL('../deploy/host-app/Uninstall-RustLegacyHost.ps1',import.meta.url),'utf8');
 assert.match(install,/Get-ChildItem -LiteralPath \$keys -Filter 'signing-\*\.pem'\) \{ & icacls\.exe \$k\.FullName \/grant "\$\{account\}:R"/);
 assert.match(uninstall,/Get-ChildItem -LiteralPath \$keys -Filter 'signing-\*\.pem'\) \{ & icacls\.exe \$k\.FullName \/remove:g \$account/);
 // The locked-down server copy: read for the host's checks, modify on cfg, saves, userdata and Oxide; the rest of the
 // program files (rust_server.exe itself) stay read-only for it. Managed got its own modify grant 29 Oct 2026 (owner
 // decision, HOST-AND-LOADER-BUILD.md question 3) so step 10 (Patch-TestCopy) can run from the dashboard.
 assert.match(install,/icacls\.exe \$test \/grant "\$\{account\}:\(OI\)\(CI\)RX"/);assert.match(install,/icacls\.exe \$data \/grant "\$\{account\}:\(OI\)M"/);
 assert.match(install,/'rust_server_Data\\Managed'[^\n]*\/grant "\$\{account\}:\(OI\)\(CI\)M"/,'Managed is modify now, question 3');
 assert.match(uninstall,/'server\\test\\rust_server_Data\\userdata'/);
 // Firewall: the scripts' allow rules name the system node.exe; the kit's node.exe gets the same rules, removed on uninstall.
 assert.match(install,/New-NetFirewallRule -DisplayName "Rust Legacy Host: [^"]*" -Group 'Rust Legacy Host' -Direction Inbound -Action Allow -Program \$hostNode/);
 assert.match(uninstall,/Get-NetFirewallRule -Group 'Rust Legacy Host' -ErrorAction SilentlyContinue \| Remove-NetFirewallRule/);
 // The boot task: the service account may read and run it (FRFX), never change it; uninstall removes that entry.
 assert.match(install,/GetTask\('RLB-OriginalServer-AtBoot'\)/);assert.match(install,/SetSecurityDescriptor\(\$sd \+ "\(A;;FRFX;;;\$sid\)", 0\)/);
 assert.match(uninstall,/-replace \[regex\]::Escape\("\(A;;FRFX;;;\$sid\)"\), ''/);
});

test('installer scripts parse and their dry run changes nothing',{skip:!windows},()=>{
 for(const f of ['Install-RustLegacyHost.ps1','Uninstall-RustLegacyHost.ps1']){
  const path=join('deploy','host-app',f).replace(/'/g,"''");
  const parse=ps(['-Command',`$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path '${path}'),[ref]$null,[ref]$e);$e.Count`]);
  assert.equal(parse.stdout.trim(),'0',f+' parse errors');
 }
 const dry=ps(['-File',join('deploy','host-app','Install-RustLegacyHost.ps1'),'-InstallDir',join(tmpdir(),'rlb-never-installed'),'-DataDir',join(tmpdir(),'rlb-never-data'),'-ServerDir','C:\\RustServer','-OpenGateway','-BlockServerOutbound']);
 assert.equal(dry.status,0,dry.stderr);assert.match(dry.stdout,/Dry run only\. Nothing was changed/);
 assert.match(dry.stdout,/your server in C:\\RustServer/);assert.match(dry.stdout,/allow incoming TCP .*block outgoing traffic from C:\\RustServer\\rust_server\.exe/);assert.match(dry.stdout,/installed apps list/);
 const un=ps(['-File',join('deploy','host-app','Uninstall-RustLegacyHost.ps1'),'-InstallDir',join(tmpdir(),'rlb-never-installed'),'-DataDir',join(tmpdir(),'rlb-never-data'),'-RestoreServer']);
 assert.equal(un.status,0,un.stderr);assert.match(un.stdout,/Dry run only/);
 assert.ok(!existsSync(join(tmpdir(),'rlb-never-installed'))&&!existsSync(join(tmpdir(),'rlb-never-data')));
});

test('installer kit runs on its own under the service wrapper: graceful stop, and nothing outlives a killed wrapper',{skip:!windows,timeout:240000},async()=>{
 const out=mkdtempSync(join(tmpdir(),'rlb-kit-build-')),data=mkdtempSync(join(tmpdir(),'rlb-kit-data-'));
 const wrappers=[]; // killed in finally: a wrapper left running keeps this test file (and npm test) alive
 try{
  const {kit}=buildHostInstaller({out,zip:false,desktop:false,log:()=>{}}); // the desktop app has its own checks (tests/host-desktop.test.mjs)
  const [port]=await freeTcpPorts(1),udp=await freeUdp();
  writeFileSync(join(data,'host.json'),JSON.stringify({listen:{host:'127.0.0.1',port},dataDir:join(data,'host'),components:{server:{kind:'mock',dir:join(data,'server'),port:udp,autosaveSeconds:3600}},watchdog:{enabled:false,hangSeconds:90,graceSeconds:300,probeEveryMs:5000}}));
  writeFileSync(join(kit,'service','RustLegacyHostService.json'),JSON.stringify({node:join(kit,'node','node.exe'),app:join(kit,'app'),config:join(data,'host.json'),dataDir:join(data,'host')}));
  const tokenFile=join(data,'host','owner.token');
  const run=async()=>{
   const w=spawn(join(kit,'service','RustLegacyHostService.exe'),['--console'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
   wrappers.push(w);
   let text='';w.stdout.on('data',d=>text+=d);
   await until(()=>existsSync(tokenFile)&&/Rust Legacy host is running/.test(text),60000,'host up under the wrapper');
   const base=`http://127.0.0.1:${port}`,h={origin:base,'x-rlb-host':'1','content-type':'application/json'};
   const login=await fetch(base+'/api/login',{method:'POST',headers:h,body:JSON.stringify({token:readFileSync(tokenFile,'utf8').trim()})});
   const cookie=login.headers.get('set-cookie').split(';')[0];
   await fetch(base+'/api/action',{method:'POST',headers:{...h,cookie},body:JSON.stringify({action:'start',target:'server'})});
   let server=null;
   await until(async()=>{const s=await (await fetch(base+'/api/status',{headers:{cookie}})).json();server=s.components.find(c=>c.name==='server');return server.state==='running';},30000,'server running');
   const node=Number(/started the host \(node PID (\d+)\)/.exec(text)[1]);
   return {w,node,server:server.pid,text:()=>text};
  };
  // 1. "stop" on the wrapper: the host stops its parts and exits; the wrapper ends.
  let r=await run();
  r.w.stdin.write('stop\n');
  await until(()=>r.w.exitCode!==null,40000,'wrapper exited');
  assert.equal(r.w.exitCode,0);
  await until(()=>!pidAlive(r.node)&&!pidAlive(r.server),10000,'host and server gone after stop');
  assert.match(readFileSync(join(data,'host','logs',`service-${new Date().toISOString().slice(0,10)}.log`),'utf8'),/stopped/);
  // 2. The wrapper killed outright (not its tree): the Job Object takes node and the server with it.
  r=await run();
  execFileSync('taskkill',['/PID',String(r.w.pid),'/F'],{windowsHide:true});
  await until(()=>!pidAlive(r.node)&&!pidAlive(r.server),15000,'host and server gone with the wrapper');
 }finally{
  for(const w of wrappers)if(w.exitCode===null){try{execFileSync('taskkill',['/PID',String(w.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
  rmSync(out,{recursive:true,force:true,maxRetries:20,retryDelay:250});rmSync(data,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
});

test('setup program: the wizard unpacks its kit, checks a server folder with the app\'s own setup.mjs, and installs nothing',{skip:!windows,timeout:280000},async()=>{
 const out=mkdtempSync(join(tmpdir(),'rlb-setup-build-')),root=mkdtempSync(join(tmpdir(),'rlb-setup-run-'));
 try{
  const {zip}=buildHostInstaller({out,setup:false,desktop:false,log:()=>{}});
  const manifest=join(out,'asinvoker.manifest');
  writeFileSync(manifest,readFileSync(fileURLToPath(new URL('../host/setup-exe/RustLegacyHostSetup.manifest',import.meta.url)),'utf8').replace('requireAdministrator','asInvoker'));
  const exe=compileSetup({zip,out:join(out,'SetupTest.exe'),work:join(out,'work'),manifest});
  const server=join(root,'Rust Server');mkdirSync(join(server,'rust_server_Data','Managed'),{recursive:true});
  writeFileSync(join(server,'rust_server.exe'),'not the real one');writeFileSync(join(server,'rust_server_Data','Managed','Assembly-CSharp.dll'),'unknown');
  const snap=join(root,'snap'),r=spawnSync(exe,[`/snapshot=${snap}`,`/server=${server}`],{timeout:180000,windowsHide:true});
  assert.equal(r.status,0);
  for(const p of ['page-0.png','page-1.png','page-2.png'])assert.equal(readFileSync(join(snap,p)).subarray(1,4).toString(),'PNG',p);
  const check=readFileSync(join(snap,'check.txt'),'utf8');
  assert.match(check,/not the verified build\.\s+SHA-256 [0-9A-F]{64}/);assert.match(check,/a modified build we do not know/);
 }finally{rmSync(out,{recursive:true,force:true,maxRetries:20,retryDelay:250});rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
});

test('install and uninstall delete folders without following junctions inside them (Windows PowerShell 5.1)',{skip:!windows},()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-tree-'));
 try{
  for(const f of ['Install-RustLegacyHost.ps1','Uninstall-RustLegacyHost.ps1']){
   const src=readFileSync(join('deploy','host-app',f),'utf8').replace(/\r\n/g,'\n');
   const fn=/\nfunction Remove-TreeSafely[\s\S]*?\n}\n/.exec(src)?.[0];assert.ok(fn,f+' has Remove-TreeSafely');
   const target=join(root,f+'-target'),tree=join(root,f+'-tree');
   mkdirSync(target);writeFileSync(join(target,'keep.txt'),'recovered asset');
   mkdirSync(join(tree,'app','browser','assets'),{recursive:true});writeFileSync(join(tree,'app','main.mjs'),'x');
   execFileSync('cmd.exe',['/c','mklink','/J',join(tree,'app','browser','assets','recovered'),target],{windowsHide:true});
   const r=ps(['-Command',fn+`\nRemove-TreeSafely '${tree.replace(/'/g,"''")}'`]);
   assert.equal(r.status,0,r.stderr);
   assert.ok(!existsSync(tree),f+': the folder is gone');
   assert.equal(readFileSync(join(target,'keep.txt'),'utf8'),'recovered asset',f+': the junction\'s target is untouched');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
