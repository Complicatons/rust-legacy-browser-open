// Host app end to end on the mock game server (HOST-APP-PLAN.md "Testing"): service security, start/stop through the
// API, live logs over SSE, a crash, and the 2026-10-22 autosave freeze → hang verdict → last good save → restart.
// No original binaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {createServer,request} from 'node:http';
import {createSocket} from 'node:dgram';
import {startHost} from '../host/host.mjs';
import {createServiceHandler,startService} from '../host/service.mjs';
import {componentSpecs,validateHostConfig,loadHostConfig} from '../host/config.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {createProcess} from '../host/supervisor.mjs';
import {TAR} from '../tools/kit-install.mjs';
import {listenServer} from '../bridge/listen.mjs';
import {freeTcpPorts} from './helpers/ports.mjs';

const until=async(pred,ms=15000,what='condition')=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,50));}throw Error(what+' not met');};
const freeUdpPort=()=>new Promise(r=>{const s=createSocket('udp4');s.bind(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

function call(port,path,{method='GET',body,cookie,host=`127.0.0.1:${port}`,origin=`http://127.0.0.1:${port}`,csrf=true}={}){
 return new Promise((res,rej)=>{
  const headers={host,...(cookie?{cookie}:{}),...(method==='POST'?{origin,'content-type':'application/json',...(csrf?{'x-rlb-host':'1'}:{})}:{})};
  const req=request({host:'127.0.0.1',port,path,method,headers},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{let json=null;try{json=JSON.parse(b);}catch{}res({status:r.statusCode,headers:r.headers,json,text:b});});});
  req.on('error',rej);if(body)req.write(JSON.stringify(body));req.end();
 });
}
// Reads an SSE stream into an array of {event, id, data}.
function events(port,cookie,since=0){
 const got=[];let req;
 const p=new Promise(res=>{req=request({host:'127.0.0.1',port,path:`/api/events?since=${since}`,headers:{host:`127.0.0.1:${port}`,cookie}},r=>{let buf='';r.setEncoding('utf8');r.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n\n'))>=0){const block=buf.slice(0,i);buf=buf.slice(i+2);const e={};for(const line of block.split('\n')){const m=/^(event|id|data): (.*)$/.exec(line);if(m)e[m[1]]=m[1]==='data'?JSON.parse(m[2]):m[2];}if(e.event)got.push(e);}});res();});req.on('error',()=>{});req.end();});
 return {got,ready:p,close:()=>req.destroy()};
}

test('host config: validation, and the original server is refused without the owner confirmation or as the wrong account',async()=>{
 assert.deepEqual(validateHostConfig({listen:{host:'0.0.0.0',port:28100},dataDir:'x',components:{server:{kind:'mock',dir:'x'}}}).length,1);
 assert.deepEqual(validateHostConfig({listen:{host:'127.0.0.1',port:28100},dataDir:'x',components:{}}),[]); // a fresh install starts empty
 assert.match(validateHostConfig({listen:{host:'127.0.0.1',port:28100},dataDir:'x',components:{server:{kind:'exe',dir:'x'}},watchdog:{hangSeconds:5}}).join(),/kind.*hangSeconds/s);
 const dir=mkdtempSync(join(tmpdir(),'rlb-host-cfg-')),file=join(dir,'host.json');
 writeFileSync(file,JSON.stringify({dataDir:'data',components:{server:{kind:'original',dir:'Rust Server Zoë'}}}));
 const c=loadHostConfig(file);
 assert.equal(c.listen.port,28100);assert.equal(c.dataDir,join(dir,'data'));assert.equal(c.components.server.dir,join(dir,'Rust Server Zoë'));
 let lockdownRuns=0;const lockdown=async()=>{lockdownRuns++;return [];};
 const [spec]=componentSpecs(c,{lockdown});
 assert.equal(spec.command,join(dir,'Rust Server Zoë','rust_server.exe'));
 assert.deepEqual(spec.args.slice(0,2),['-batchmode','-cfg']);assert.equal(spec.udpPort,29015);
 assert.equal(spec.savePath,join(dir,'Rust Server Zoë','rust_server_Data','rust_island_2013.sav'));
 await assert.rejects(spec.preStart(),/needs your confirmation/);
 c.components.server.confirmRunOriginalBinaries=true;
 // Installed app (no scripts root): an attached server runs only under the host app's own virtual service account.
 const settings={account:'rlbserver-not-'+userInfo().username,server:{exe:'rust_server.exe',args:['-port','29015'],exeSha256:'X'}};
 const [mine]=componentSpecs(c,{lockdown,settings,serviceAccount:async()=>false});
 await assert.rejects(mine.preStart(),/may only run as the locked-down account .* or, for a server attached as it is in Setup, under the installed host app's own service account/);
 const [asService]=componentSpecs(c,{lockdown,settings,serviceAccount:async()=>true});
 await assert.rejects(asService.preStart(),/not found/); // no exe in the scratch folder: nothing is ever run
 // The owner's own command line from Setup replaces the shipped one.
 const [own]=componentSpecs({...c,components:{server:{...c.components.server,args:['-batchmode','-port','29115','-datadir','serverdata/']}}},{lockdown,settings,serviceAccount:async()=>true});
 assert.equal(own.udpPort,29115);assert.equal(own.savePath,join(dir,'Rust Server Zoë','serverdata','rust_island_2013.sav'));
 // Scripts layout: another account (the service) starts it through the boot task; the locked-down account itself
 // runs 05's checks here.
 c.scripts={root:dir};
 const [viaTask]=componentSpecs(c,{lockdown,settings,serviceAccount:async()=>true});
 assert.match(viaTask.startedBy,/boot task/);await viaTask.preStart();
 const [asAccount]=componentSpecs(c,{lockdown,settings:{...settings,account:userInfo().username}});
 await assert.rejects(asAccount.preStart(),/not found/);
 assert.equal(lockdownRuns,0);
 rmSync(dir,{recursive:true,force:true});
});

// Azure VM, 2026-10-24: the installed host runs as its own service account, so a scheduled restart stopped the original
// server and could not start it again. With the scripts' layout it now starts it through the SYSTEM boot task
// (17-Register-ServerTask.ps1 -AtBoot: 05-Start-Server.ps1 -ViaTask, every lock-down check) and adopts the PID 05 writes.
test('original server under a service account: started through the boot task, PID from run/server.pid, refused without confirmation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-host-task-')),runDir=join(dir,'run');mkdirSync(runDir);
 const c={components:{server:{kind:'original',dir:join(dir,'server')}},scripts:{root:dir}};
 const settings={account:'rlbserver-not-'+userInfo().username,server:{exe:'rust_server.exe',args:['-port','29015'],exeSha256:'X'}};
 const calls=[],child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 const runTask=async(cmd,args)=>{calls.push([cmd,...args]);setTimeout(()=>writeFileSync(join(runDir,'server.pid'),String(child.pid)),300);};
 try{
  const [spec]=componentSpecs(c,{settings,runTask,taskPollMs:50});
  assert.equal(typeof spec.startExternal,'function');assert.match(spec.startedBy,/boot task/);
  await assert.rejects(spec.preStart(),/needs your confirmation/);
  c.components.server.confirmRunOriginalBinaries=true;
  const [ok]=componentSpecs(c,{settings,runTask,taskPollMs:50});
  await ok.preStart();assert.equal(await ok.startExternal(),child.pid);
  assert.deepEqual(calls,[['schtasks.exe','/Run','/TN','RLB-OriginalServer-AtBoot']]);
  // The supervisor adopts what the task started: running, not verified (another account owns it), stop via the adapter.
  const p=createProcess({...ok,preStart:async()=>{},startExternal:async()=>child.pid});
  assert.equal(await p.start(),true);assert.equal(p.state,'running');assert.equal(p.info().external.by,ok.startedBy);
  // It exits by itself: the host's own start, so a crash is restarted through the task again (not "started outside").
  const second=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const pids=[child.pid,second.pid];let n=0;
  const own=createProcess({...ok,preStart:async()=>{},startExternal:async()=>pids[n++]},{externalPollMs:50,backoff:{baseMs:50,maxMs:100,maxCrashes:5,windowMs:600000,resetAfterMs:600000}});
  try{
   assert.equal(await own.start(),true);assert.equal(own.info().pid,child.pid);
   child.kill();
   const t0=Date.now();while(!(own.state==='running'&&own.info().pid===second.pid)&&Date.now()-t0<5000)await new Promise(r=>setTimeout(r,25));
   assert.equal(own.info().pid,second.pid,'restarted through the task');assert.equal(own.info().restarts,1);assert.equal(own.info().crashes,1);
  }finally{second.kill();}
  const failing=createProcess({...ok,preStart:async()=>{},startExternal:async()=>{throw Error('access denied')}});
  assert.equal(await failing.start(),false);assert.equal(failing.state,'failed');assert.match(failing.info().message,/access denied/);
  // No scripts layout: the old refusal stays.
  const [plain]=componentSpecs({components:c.components},{settings});assert.equal(plain.startExternal,undefined);
  await assert.rejects(plain.preStart(),/may only run as the locked-down account/);
 }finally{child.kill();rmSync(dir,{recursive:true,force:true});}
});

test('host stack on the mock game server: API security, start, live logs, crash, freeze → hang → last good save → restart',{timeout:90000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-host-stack-')),serverDir=join(root,'Rust Server'),udp=await freeUdpPort();
 const config={listen:{host:'127.0.0.1',port:0},dataDir:join(root,'data'),components:{server:{kind:'mock',dir:serverDir,port:udp,autosaveSeconds:3600}},
  watchdog:{enabled:true,hangSeconds:3,graceSeconds:1,probeEveryMs:500}};
 const host=await startHost(config);
 const http=createServer();await listenServer(http);const port=http.address().port;
 const handler=createServiceHandler({host,token:'t'.repeat(43),port});http.on('request',handler);
 try{
  // Security: wrong Host (DNS rebinding), no session, missing CSRF header, wrong token.
  assert.equal((await call(port,'/')).status,200);
  assert.equal((await call(port,'/',{host:'evil.example:'+port})).status,421);
  assert.equal((await call(port,'/api/status')).status,401);
  assert.equal((await call(port,'/api/login',{method:'POST',body:{token:'t'.repeat(43)},csrf:false})).status,403);
  assert.equal((await call(port,'/api/login',{method:'POST',body:{token:'t'.repeat(43)},origin:'http://evil.example'})).status,403);
  assert.equal((await call(port,'/api/login',{method:'POST',body:{token:'wrong'}})).status,401);
  const login=await call(port,'/api/login',{method:'POST',body:{token:'t'.repeat(43)}});
  assert.equal(login.status,200);assert.match(login.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);
  const cookie=login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await call(port,'/api/action',{method:'POST',cookie,body:{action:'format',target:'server'}})).status,400);
  assert.equal((await call(port,'/api/action',{method:'POST',cookie,body:{action:'start',target:'../server'}})).status,400);
  const status=()=>call(port,'/api/status',{cookie}).then(r=>r.json);
  const serverInfo=async()=>(await status()).components.find(c=>c.name==='server');

  // A server from an earlier run still alive: refused, never a second server on the same save.
  writeFileSync(join(config.dataDir,'run','server.pid'),String(process.pid));
  await host.act('start','server');
  assert.equal((await serverInfo()).state,'failed');assert.match((await serverInfo()).message,/already running \(PID \d+\), started outside this host/);
  rmSync(join(config.dataDir,'run','server.pid'));

  const sse=events(port,cookie);await sse.ready;
  assert.equal((await call(port,'/api/action',{method:'POST',cookie,body:{action:'start',target:'all'}})).status,202);
  await until(async()=>(await serverInfo()).state==='running',15000,'server running');
  const firstPid=(await serverInfo()).pid;
  await until(()=>sse.got.some(e=>e.event==='log'&&/Server listening on UDP/.test(e.data.text)),10000,'server log over SSE');
  assert.ok(sse.got.some(e=>e.event==='state'&&e.data.name==='server'&&e.data.state==='running'));
  // The UDP probe runs only while the log and CPU are quiet; a busy server reports it as not needed instead.
  await until(()=>sse.got.some(e=>e.event==='watchdog'&&(e.data.probe?.ok||e.data.udpIdle)),10000,'UDP probe answered or not needed');

  // A completed autosave is kept as the last good save.
  host.procs.get('server').child.stdin.write('save\n');
  await until(async()=>(await status()).saves?.lastGood,10000,'last good save');
  const good=(await status()).saves.lastGood;
  const savePath=join(serverDir,'rust_server_Data','rust_island_2013.sav');
  assert.equal(readFileSync(good.file,'utf8'),readFileSync(savePath,'utf8'));

  // Crash: restarted after the backoff with a new process.
  host.procs.get('server').child.stdin.write('crash\n');
  await until(async()=>(await serverInfo()).state==='backoff',10000,'backoff');
  await until(async()=>(await serverInfo()).state==='running'&&(await serverInfo()).pid!==firstPid,15000,'restart after crash');
  const secondPid=(await serverInfo()).pid;

  // The freeze: "Saving to", 0-byte .sav and .sav.new, process alive with no CPU, no log, no UDP answer.
  await until(async()=>(await status()).watchdog.state==='ok',10000,'grace over');
  await assert.rejects(host.act('freeze','all'),/only the mock/);
  assert.equal((await call(port,'/api/action',{method:'POST',cookie,body:{action:'freeze',target:'server'}})).status,202);
  await until(()=>host.hub.since(0).some(l=>/Server hang detected/.test(l.text)),20000,'hang detected');
  await until(()=>host.hub.since(0).some(l=>/Server restarted after the hang/.test(l.text)),20000,'restart after hang');
  await until(async()=>(await serverInfo()).state==='running'&&(await serverInfo()).pid!==secondPid,15000,'running again');
  assert.equal(readFileSync(savePath,'utf8'),readFileSync(good.file,'utf8')); // last good save back in place
  assert.ok(!existsSync(savePath+'.new'));
  const failed=readdirSync(join(config.dataDir,'backups')).find(f=>f.startsWith('damaged-'));
  assert.ok(failed);assert.deepEqual(readdirSync(join(config.dataDir,'backups',failed)).sort(),['rust_island_2013.sav','rust_island_2013.sav.new']);
  const s=await status();
  assert.equal(s.watchdog.hangs.length,1);assert.equal(s.components.find(c=>c.name==='server').crashes,2);
  assert.ok(sse.got.some(e=>e.event==='log'&&/Server hang detected/.test(e.data.text)));
  assert.ok(existsSync(join(serverDir,'rust_server_Data','output_log.prev.txt'))); // previous run's log kept

  // SSE resume: Last-Event-ID / since gives only newer lines.
  const lastSeq=sse.got.filter(e=>e.event==='log').at(-1).data.seq;sse.close();
  host.procs.get('server').child.stdin.write('say resumed-line\n');
  const again=events(port,cookie,lastSeq);await again.ready;
  await until(()=>again.got.some(e=>e.event==='log'&&e.data.text==='resumed-line'),10000,'resumed line');
  assert.ok(again.got.filter(e=>e.event==='log').every(e=>e.data.seq>lastSeq));
  again.close();

  // Updates: a tar is uploaded as the request body and inspected before anything changes (not installed here: the
  // stack's app folder is this checkout).
  const tarDir=join(root,'upd');mkdirSync(join(tarDir,'bridge'),{recursive:true});writeFileSync(join(tarDir,'bridge','x.mjs'),'x');
  spawnSync(TAR,['-cf',join(root,'u.tar'),'-C',tarDir,'bridge/x.mjs']);
  const up=await new Promise((res,rej)=>{const q=request({host:'127.0.0.1',port,path:'/api/updates/upload?name=u.tar',method:'POST',headers:{host:`127.0.0.1:${port}`,origin:`http://127.0.0.1:${port}`,'x-rlb-host':'1',cookie,'content-type':'application/x-tar'}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res({status:r.statusCode,json:JSON.parse(b)}));});q.on('error',rej);q.end(readFileSync(join(root,'u.tar')));});
  assert.equal(up.status,200);assert.equal(up.json.files,1);assert.deepEqual(up.json.parts,['gateway','sidecar']);
  assert.equal((await call(port,'/api/updates',{cookie})).json.staged[0].name,'u.tar');
  assert.equal((await call(port,'/api/updates/remove',{method:'POST',cookie,body:{name:'u.tar'}})).status,200);
  // Backups: a restore while the server runs is refused; once stopped it puts the copy back.
  const bk=(await call(port,'/api/backups',{cookie})).json;assert.equal(bk.configured,true);assert.ok(bk.kept.length>=1);
  assert.equal((await call(port,'/api/backups/restore',{method:'POST',cookie,body:{name:bk.kept[0].name}})).status,409);
  assert.equal((await call(port,'/api/backups/keep',{method:'POST',cookie,body:{label:'test'}})).status,200);
  await host.act('stop','all');
  assert.equal((await call(port,'/api/backups/restore',{method:'POST',cookie,body:{name:bk.kept[0].name}})).status,200);
  assert.equal((await serverInfo()).state,'stopped');
  assert.ok(existsSync(join(config.dataDir,'logs')));
 }finally{handler.close();await new Promise(r=>http.close(r));http.closeAllConnections?.();await host.close();rmSync(root,{recursive:true,force:true});}
});

// Parts auto-start when the service starts (owner decision, HOST-AND-LOADER-BUILD.md question 7, 29 Oct 2026): off by
// default (startService's own callers, like the demo, start parts on their own schedule); node host/service.mjs run
// (the real Windows service's own entry point) turns it on. A missing server confirmation refuses that one part but
// still logs to the hub instead of throwing out of the service's own start-up.
test('startService({autoStart:true}): the server starts on its own, no /api/action needed; a missing confirmation only logs',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-host-autostart-')),serverDir=join(root,'Rust Server'),[hostPort]=await freeTcpPorts(1),udp=await freeUdpPort();
 const config={listen:{host:'127.0.0.1',port:hostPort},dataDir:join(root,'data'),components:{server:{kind:'mock',dir:serverDir,port:udp,autosaveSeconds:3600}},
  watchdog:{enabled:false,hangSeconds:90,graceSeconds:300,probeEveryMs:5000}};
 const svc=await startService(config,{autoStart:true});
 try{
  await until(()=>svc.host.procs.get('server').state==='running',15000,'server running on its own');
 }finally{await svc.close();rmSync(root,{recursive:true,force:true});}

 // A fresh server confirmation is required (host/config.mjs): auto-start logs the refusal (the same way a manual
 // "Start all" that hits the same refusal would) instead of rejecting out of the service's own start-up.
 const root2=mkdtempSync(join(tmpdir(),'rlb-host-autostart-refused-')),serverDir2=join(root2,'Rust Server'),[hostPort2]=await freeTcpPorts(1);
 mkdirSync(serverDir2,{recursive:true});
 const config2={listen:{host:'127.0.0.1',port:hostPort2},dataDir:join(root2,'data'),components:{server:{kind:'original',dir:serverDir2,confirmRunOriginalBinaries:false}},
  watchdog:{enabled:false,hangSeconds:90,graceSeconds:300,probeEveryMs:5000}};
 const svc2=await startService(config2,{autoStart:true});
 try{
  await until(()=>svc2.host.hub.since(0).some(l=>/server not started: Running the original server needs your confirmation/.test(l.text)),10000,'auto-start logged the refusal');
  assert.equal(svc2.host.procs.get('server').state,'failed');
 }finally{await svc2.close();rmSync(root2,{recursive:true,force:true});}
});

// Each UDP probe shows in the real server's log ("rejected due to incompatible uLink version", Azure VM 2026-10-24):
// the watchdog probes only once the log and CPU have both gone quiet.
test('watchdog: no UDP probe while the server uses CPU; probes once CPU and log go quiet',{timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-host-probe-')),udp=await freeUdpPort();
 let cpuMs=0,busy=true,probes=0;
 const host=await startHost({listen:{host:'127.0.0.1',port:0},dataDir:join(root,'data'),components:{server:{kind:'mock',dir:join(root,'Rust Server'),port:udp,autosaveSeconds:3600}},
  watchdog:{enabled:true,hangSeconds:30,graceSeconds:1,probeEveryMs:200}},
  {noRemote:true,cpu:{cpuMs:async()=>busy?(cpuMs+=50):cpuMs,sample:async()=>null,close(){}},probe:async()=>{probes++;return {ok:false,reason:'no-reply',ms:1};}});
 try{
  await host.act('start','server');
  await until(()=>host.status().watchdog?.state==='ok',10000,'watchdog ok');
  const before=probes;await new Promise(r=>setTimeout(r,1500));
  assert.equal(probes,before,'no probe while CPU is moving');assert.equal(host.status().watchdog.udpIdle,true);
  busy=false; // CPU stops; the mock logs nothing (autosave an hour away): the probe takes over after hangSeconds/3 = 10 s
  await until(()=>probes>before,20000,'probe after the quiet period');assert.equal(host.status().watchdog.udpIdle,false);
 }finally{await host.close();rmSync(root,{recursive:true,force:true});}
});

// H12 (rlb-test-vm, 2026-10-29): a fresh join into an idle server is a join into a quiet server by definition, so the
// probe and the real uLink handshake raced for the same single pending-connection slot and the join got "No answer
// from remote host". The watchdog now asks the gateway's own health (fresh, not the cached copy) right before it
// probes and skips while a session is "connecting" there.
test('watchdog: no UDP probe while the gateway reports a session mid native handshake (H12)',{timeout:60000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-host-probe-gw-')),udp=await freeUdpPort();
 let connecting=1,probes=0;
 const gw=await listenServer(createServer((req,res)=>{res.end(JSON.stringify({ok:true,sessions:1,inGame:0,connecting}));}));
 const config={listen:{host:'127.0.0.1',port:0},dataDir:join(root,'data'),components:{server:{kind:'mock',dir:join(root,'Rust Server'),port:udp,autosaveSeconds:3600}},
  watchdog:{enabled:true,hangSeconds:30,graceSeconds:1,probeEveryMs:200}};
 const specs=[...componentSpecs(config),{name:'gateway',health:`http://127.0.0.1:${gw.address().port}/healthz`}];
 const host=await startHost(config,{noRemote:true,specs,cpu:{cpuMs:async()=>0,sample:async()=>null,close(){}},probe:async()=>{probes++;return {ok:false,reason:'no-reply',ms:1};}});
 try{
  await host.act('start','server'); // the preStart port check also calls probe() once, before any of this
  const before=probes;
  // The mock logs nothing from the start (no players, autosave an hour away): udpIdle genuinely goes false (quiet
  // enough to want a probe) after hangSeconds/3 = 10 s, same threshold as the CPU test above.
  await new Promise(r=>setTimeout(r,12000));
  assert.equal(host.status().watchdog.udpIdle,false,'quiet long enough to want a probe');
  assert.equal(probes,before,'a session mid handshake holds off the probe even though the server looks quiet');
  connecting=0;
  await until(()=>probes>before,10000,'probe once nobody is mid handshake');
 }finally{await host.close();await new Promise(r=>gw.close(r));rmSync(root,{recursive:true,force:true});}
});
