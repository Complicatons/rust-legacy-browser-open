// Scripts mode and app mode as equals (HOST-APP-PLAN.md "Two ways to run it"): the host shares the scripts' run\*.pid
// files, adopts a part the scripts started (shown, watched, stoppable when verified), takes a scripted stop (a .stop
// marker, as 06/15 write) for a stop rather than a crash, and leaves script-started parts running when it shuts down.
// Mock game server only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createSocket} from 'node:dgram';
import {createServer} from 'node:net';
import {startHost} from '../host/host.mjs';
import {componentSpecs,REPO} from '../host/config.mjs';
import {processInfo,pidAlive} from '../host/proc-stats.mjs';
import {listenServer} from '../bridge/listen.mjs';

const until=async(pred,ms=15000,what='condition')=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,100));}throw Error(what+' not met');};
const freeUdpPort=()=>new Promise(r=>{const s=createSocket('udp4');s.bind(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
const MOCK=join(REPO,'host','mock-game-server.mjs');
// What 05-Start-Server.ps1 does, for the mock: start the server outside the host and record its PID in run\server.pid.
function scriptStart(root,dir,port){
 mkdirSync(dir,{recursive:true});
 const c=spawn(process.execPath,[MOCK,'--port',String(port),'--datadir','rust_server_Data/','--autosave','3600'],{cwd:dir,stdio:['pipe','ignore','ignore'],windowsHide:true});
 writeFileSync(join(root,'run','server.pid'),String(c.pid));
 return c;
}
// What 06-Stop-Server.ps1 does: the .stop marker with the PID, then the stop.
function scriptStop(root,name,pid){writeFileSync(join(root,'run',name+'.stop'),String(pid));process.kill(pid);}

test('processInfo names a process by its command line',async()=>{
 const c=spawn(process.execPath,[MOCK,'--port','0'],{stdio:['pipe','ignore','ignore'],cwd:mkdtempSync(join(tmpdir(),'rlb-pi-'))});
 try{const info=await processInfo(c.pid);assert.ok(info,'readable');assert.match(info.commandLine.replace(/\\/g,'/'),/host\/mock-game-server\.mjs/);}
 finally{c.kill();}
 assert.equal(await processInfo(2**30),null);
});

test('a server started by the scripts shows in the app and stops from it; an app-started one stops from the scripts',{timeout:90000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-shared-')),dir=join(root,'server','test'),port=await freeUdpPort();
 mkdirSync(join(root,'run'),{recursive:true});
 const config={listen:{host:'127.0.0.1',port:0},dataDir:join(root,'host'),scripts:{root},components:{server:{kind:'mock',dir,port}},
  watchdog:{enabled:true,hangSeconds:3,graceSeconds:1,probeEveryMs:500}};
 const outside=scriptStart(root,dir,port);
 let host=await startHost(config);const server=()=>host.status().components.find(c=>c.name==='server');
 const extra=[];
 try{
  // 1. Started by the scripts: adopted, verified, watched.
  await until(()=>server().state==='running'&&server().external?.verified,10000,'adopted');
  assert.equal(server().pid,outside.pid);assert.match(server().message,/started outside the host/);
  // Watched: the UDP probe answers, or is not needed while the log and CPU are live (it runs only when they go quiet).
  await until(()=>host.status().watchdog.probe?.ok||host.status().watchdog.udpIdle,10000,'probe answered or not needed');
  // 2. Stopped from the app.
  await host.act('stop','server');
  assert.equal(server().state,'stopped');assert.equal(pidAlive(outside.pid),false);
  assert.ok(!existsSync(join(root,'run','server.pid')));
  // 3. Started from the app: the shared pid file names it (06 and 05 see it).
  await host.act('start','server');
  await until(()=>server().state==='running',10000,'app start');
  const pid=server().pid;assert.equal(Number(readFileSync(join(root,'run','server.pid'),'utf8')),pid);
  assert.equal(server().external,null);
  // 4. Stopped by the scripts (06 writes server.stop first): a stop, not a crash, so no restart.
  scriptStop(root,'server',pid);
  await until(()=>server().state==='stopped',10000,'stopped by script');
  assert.equal(server().message,'stopped outside the host');
  await new Promise(r=>setTimeout(r,3000));
  assert.equal(server().state,'stopped');assert.equal(server().crashes,0);
  assert.ok(!existsSync(join(root,'run','server.stop')));
  // 5. A script-started server that dies by itself is reported, not restarted (the host did not start it).
  const again=scriptStart(root,dir,port);extra.push(again);
  await until(()=>server().state==='running'&&server().pid===again.pid,10000,'adopted again');
  again.kill();
  await until(()=>server().state==='stopped',10000,'exit seen');
  assert.match(server().message,/exited unexpectedly; it was started outside the host/);
  await new Promise(r=>setTimeout(r,1500));assert.equal(server().state,'stopped');
  // 6. The host shutting down leaves script-started parts running.
  const third=scriptStart(root,dir,port);extra.push(third);
  await until(()=>server().pid===third.pid,10000,'adopted third');
  await host.close();host=null;
  assert.equal(pidAlive(third.pid),true);
 }finally{await host?.close();outside.kill();for(const c of extra)c.kill();try{rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:250});}catch{}}
});

test('a part whose port is taken (the website started by 12 in its own console) is refused with the reason',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-port-')),cfg=join(root,'sidecar.json');
 const busy=createServer();await listenServer(busy);
 writeFileSync(cfg,JSON.stringify({port:busy.address().port}));
 try{
  const [spec]=componentSpecs({components:{sidecar:{config:cfg}}});
  await assert.rejects(spec.preStart(),/already in use; it may be running outside the host \(14-Start-Bridge\.ps1\)/);
 }finally{busy.close();rmSync(root,{recursive:true,force:true});}
});
