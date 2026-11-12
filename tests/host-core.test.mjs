// Host app core units (HOST-APP-PLAN.md): log hub, file tail, watchdog verdicts, save guard, UDP probe, CPU sampler,
// supervisor. Mock server and small Node children only; no original binaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,appendFileSync,readFileSync,existsSync,readdirSync,rmSync,mkdirSync,renameSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSocket} from 'node:dgram';
import {createLogHub,lineSplitter,tailFile,levelOf} from '../host/log-hub.mjs';
import {createHangWatchdog} from '../host/watchdog.mjs';
import {createSaveGuard} from '../host/save-guard.mjs';
import {SAVED} from '../host/server-control.mjs';
import {probeUlink} from '../host/udp-probe.mjs';
import {createCpuSampler,pidAlive} from '../host/proc-stats.mjs';
import {createProcess} from '../host/supervisor.mjs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';

const world={level:'rust_island_2013',sendRate:20,hostname:'Mock',modded:false,official:false,steamId:1n,ip:1,port:28015};
const temp=()=>mkdtempSync(join(tmpdir(),'rlb-host-'));
const until=async(pred,ms=8000)=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,20));}throw Error('condition not met');};

test('log hub: one sequence across sources, since() merges in order, rings trim, subscribers see every line',()=>{
 const hub=createLogHub({perSource:10}),seen=[];hub.subscribe(l=>seen.push(l.seq));
 for(let i=0;i<30;i++)hub.push(i%2?'gateway':'server','out',`line ${i}`);
 assert.equal(hub.seq,30);assert.equal(seen.length,30);
 const all=hub.since(0);
 assert.equal(all.length,20); // 10 per source survive
 assert.deepEqual(all.map(l=>l.seq),[...all.map(l=>l.seq)].sort((a,b)=>a-b));
 assert.deepEqual(hub.since(28).map(l=>l.text),['line 28','line 29']);
 assert.deepEqual(hub.since(0,3).map(l=>l.seq),[28,29,30]);
 assert.equal(levelOf('NullReferenceException: Object reference'),'error');
 assert.equal(levelOf('WARNING: testDevSignIn is on'),'warn');
 assert.equal(levelOf(' Saved 4123 Object(s). Took 1.2 seconds.'),'info');
});

test('log hub: daily files per source and pruning old days',()=>{
 const dir=temp();let t=Date.parse('2026-10-01T12:00:00Z');
 const hub=createLogHub({dir,keepDays:14,now:()=>t});
 hub.push('server','file','old');t=Date.parse('2026-10-22T12:00:00Z');hub.push('server','file','new');
 assert.deepEqual(readdirSync(dir).sort(),['server-2026-10-01.log','server-2026-10-22.log']);
 assert.equal(hub.prune(),1);
 assert.match(readFileSync(join(dir,'server-2026-10-22.log'),'utf8'),/\[file\] new\n$/);
 rmSync(dir,{recursive:true,force:true});
});

test('line splitter keeps CRLF lines and multi-byte characters split across chunks',()=>{
 const lines=[],feed=lineSplitter(l=>lines.push(l)),zoe=Buffer.from('Zoë joined\r\nsecond');
 feed(zoe.subarray(0,3));feed(zoe.subarray(3));feed.flush();
 assert.deepEqual(lines,['Zoë joined','second']);
});

test('file tail: waits for the file, follows appends and partial lines, restarts when Unity rewrites the log',()=>{
 const dir=temp(),file=join(dir,'output_log.txt'),lines=[];let resets=0;
 const tail=tailFile(file,l=>lines.push(l),{intervalMs:1e6,onReset:()=>resets++});
 tail.poll();assert.deepEqual(lines,[]);
 writeFileSync(file,'Mono path[0] = x\nLoading ');tail.poll();
 assert.deepEqual(lines,['Mono path[0] = x']);
 appendFileSync(file,'level\n');tail.poll();
 assert.deepEqual(lines,['Mono path[0] = x','Loading level']);
 writeFileSync(file,'new run\n');tail.poll(); // shorter: rewritten from the start
 assert.equal(resets,1);assert.equal(lines.at(-1),'new run');
 tail.stop();rmSync(dir,{recursive:true,force:true});
});

test('watchdog: hung only when log, UDP and CPU are all silent past hangSeconds, after the grace',()=>{
 let t=0;const w=createHangWatchdog({hangSeconds:90,graceSeconds:300,now:()=>t});
 assert.equal(w.verdict().state,'idle');
 w.reset();w.cpu(1000);
 t=200e3;assert.equal(w.verdict().state,'grace');
 t=400e3;w.log();w.udp(true);w.cpu(2000);assert.equal(w.verdict().state,'ok');
 // The freeze: no log, no UDP reply, CPU flat. Suspect at half the limit, hung at the limit.
 t=460e3;w.cpu(2000);w.udp(false);assert.equal(w.verdict().state,'suspect');
 t=489e3;assert.equal(w.verdict().state,'suspect');
 t=490e3;let v=w.verdict();assert.equal(v.state,'hung');assert.deepEqual(v.used,['log','udp','cpu']);assert.equal(v.quiet,90);
 // Any one signal alive is enough: a log line, a UDP reply, or CPU moving.
 w.log();assert.equal(w.verdict().state,'ok');
 t=600e3;w.udp(true);v=w.verdict();assert.equal(v.state,'ok');assert.ok(v.ages.log>=110&&v.ages.cpu>=200);
 t=700e3;w.cpu(2500);v=w.verdict();assert.equal(v.state,'ok');assert.ok(v.ages.log>=210&&v.ages.udp>=100);
 t=790e3;assert.equal(w.verdict().state,'hung');
 // CPU unreadable (server under another account): log + UDP decide.
 w.reset(1000e3);w.cpu(null);t=1391e3;
 v=w.verdict();assert.equal(v.cpuKnown,false);assert.deepEqual(v.used,['log','udp']);assert.equal(v.state,'hung');
 w.udp(true);assert.equal(w.verdict().state,'ok');
 w.stop();assert.equal(w.verdict().state,'idle');
});

test('save guard: keeps completed saves, restores the last good one after an unfinished save',()=>{
 const dir=temp(),data=join(dir,'rust_server_Data'),save=join(data,'rust_island_2013.sav'),backups=join(dir,'backups');
 mkdirSync(data);let t=Date.parse('2026-10-22T10:00:00Z');const notes=[];
 const g=createSaveGuard({savePath:save,backupDir:backups,keep:2,now:()=>t,log:n=>notes.push(n)});
 assert.equal(g.problem(),null); // first run: no save yet is normal
 for(const n of [1,2,3]){
  assert.equal(g.onLogLine("Saving to 'rust_server_Data/rust_island_2013.sav'"),null);assert.ok(g.saving);
  writeFileSync(save,'world-'+n);t+=600e3;
  const kept=g.onLogLine(` Saved ${4000+n} Object(s). Took 1.5 seconds.`);
  assert.equal(kept.objects,4000+n);assert.equal(g.saving,null);
 }
 assert.equal(g.backups().length,2); // keep:2
 assert.equal(readFileSync(g.lastGood().file,'utf8'),'world-3');
 assert.deepEqual(g.restoreIfBad(),{restored:false,problem:null});
 // The 2026-10-22 freeze: "Saving to" logged, .new and .sav left at 0 bytes.
 g.onLogLine("Saving to 'rust_server_Data/rust_island_2013.sav'");writeFileSync(save+'.new','');writeFileSync(save,'');
 const r=g.restoreIfBad();
 assert.equal(r.restored,true);assert.equal(r.problem,'unfinished save (.new left behind)');
 assert.deepEqual(r.moved.sort(),['rust_island_2013.sav','rust_island_2013.sav.new']);
 assert.equal(readFileSync(save,'utf8'),'world-3');assert.ok(!existsSync(save+'.new'));
 assert.ok(existsSync(join(r.failedDir,'rust_island_2013.sav.new')));
 // An empty save after a completed save is not kept.
 writeFileSync(save,'');assert.equal(g.onLogLine(' Saved 0 Object(s). Took 0 seconds.'),null);
 assert.equal(readFileSync(g.lastGood().file,'utf8'),'world-3');
 rmSync(dir,{recursive:true,force:true});
});

test('save guard: a fresh world the server saves as 0 bytes is left alone; an empty save after good ones is still repaired',()=>{
 const dir=temp(),data=join(dir,'rust_server_Data'),save=join(data,'rust_island_2013.sav'),backups=join(dir,'backups');
 mkdirSync(data);const g=createSaveGuard({savePath:save,backupDir:backups});
 // Azure VM 2026-10-24: nothing built yet, every autosave and its rotation 0 bytes; nothing was ever kept.
 writeFileSync(save,'');writeFileSync(save+'.old.0','');
 assert.equal(g.problem(),null);assert.deepEqual(g.restoreIfBad(),{restored:false,problem:null});
 assert.ok(!existsSync(backups)||!readdirSync(backups).some(d=>d.startsWith('damaged-')),'no damaged-* folder');
 // A world with things in it, then a 0-byte save while .old.0 still holds the last real save: damage.
 g.onLogLine("Saving to 'rust_server_Data/rust_island_2013.sav'");writeFileSync(save,'world-1');utimesSync(save,new Date(),new Date(Date.now()+5000));
 assert.ok(g.check());writeFileSync(save+'.old.0','world-1');writeFileSync(save,'');
 assert.equal(g.problem(),'save file is empty');assert.equal(g.restoreIfBad().restored,true);assert.equal(readFileSync(save,'utf8'),'world-1');
 // The world emptied out and the server saved it empty twice (.old.0 empty too): left alone.
 writeFileSync(save,'');writeFileSync(save+'.old.0','');assert.equal(g.problem(),null);
 rmSync(dir,{recursive:true,force:true});
});

test('save guard, the real server (Azure VM 2026-10-24): "Saving to" and no "Saved N Object(s)" line; complete once .new is gone and .sav is rewritten',()=>{
 const dir=temp(),data=join(dir,'rust_server_Data'),save=join(data,'rust_island_2013.sav'),backups=join(dir,'backups');
 mkdirSync(data);writeFileSync(save,'world-0');utimesSync(save,new Date('2026-10-24T10:00:00Z'),new Date('2026-10-24T10:00:00Z'));
 const g=createSaveGuard({savePath:save,backupDir:backups});
 assert.equal(g.onLogLine("Saving to 'rust_server_Data/rust_island_2013.sav'"),null);assert.ok(g.saving);
 writeFileSync(save+'.new','world-1'); // still writing
 assert.equal(g.onLogLine('Incoming connection from 127.0.0.1:53492 was rejected due to incompatible uLink version'),null);assert.ok(g.saving);assert.equal(g.check(),null);
 renameSync(save,save+'.old.0');renameSync(save+'.new',save); // ServerSaveManager rotates, then renames .new
 const kept=g.check();assert.ok(kept,'counted from the files');assert.equal(g.saving,null);assert.equal(readFileSync(kept.file,'utf8'),'world-1');
 assert.equal(g.onLogLine(' Saved 1 Object(s). Took 0.1 seconds.'),null,'a late Saved line does not keep it twice');assert.equal(g.backups().length,1);
 // save.all from the adapter: the console command answers "saved all." once the save is done.
 g.onLogLine("Saving to 'rust_server_Data/rust_island_2013.sav'");writeFileSync(save,'world-2');utimesSync(save,new Date(),new Date(Date.now()+5000));
 assert.equal(readFileSync(g.onLogLine('saved all.').file,'utf8'),'world-2');
 assert.ok(SAVED.test('saved all.')&&SAVED.test(' Saved 12 Object(s). Took 1 seconds.'),'save-and-quit accepts either line');assert.ok(!SAVED.test('Saving to x'));
 rmSync(dir,{recursive:true,force:true});
});

test('UDP probe: the mock uLink server answers "Bad app id"; a silent socket and a closed port do not',async()=>{
 const server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const r=await probeUlink({port:server.port,timeoutMs:1500});
 assert.equal(r.ok,true);assert.equal(r.reason,'Bad app id');assert.equal(server.peers.size,0); // no connection made
 await server.close();
 const silent=createSocket('udp4');await new Promise(res=>silent.bind(0,'127.0.0.1',res));
 const q=await probeUlink({port:silent.address().port,timeoutMs:300});
 assert.equal(q.ok,false);silent.close();
 const closed=await probeUlink({port:server.port,timeoutMs:300});
 assert.equal(closed.ok,false);
});

test('CPU sampler reads this process and returns null for a dead PID',async()=>{
 const s=createCpuSampler();
 try{
  const a=await s.cpuMs(process.pid);assert.ok(a>0,`cpu ${a}`);
  const end=Date.now()+200;while(Date.now()<end);
  const b=await s.cpuMs(process.pid);assert.ok(b>a,`${b} > ${a}`);
  assert.equal(await s.cpuMs(2**30),null);
 }finally{s.close();}
 assert.equal(pidAlive(process.pid),true);assert.equal(pidAlive(2**30),false);
});

const nodeChild=(name,code,extra={})=>({name,command:process.execPath,args:['-e',code],...extra});

test('supervisor: start, logs, graceful stop, restart',async()=>{
 const hub=createLogHub(),p=createProcess(nodeChild('gw',"console.log('up');process.stdin.on('data',d=>{if(String(d).includes('quit')){console.log('bye');process.exit(0);}});setInterval(()=>{},1000)",{gracefulStop:{stdin:'quit\n'}}),{hub});
 const states=[];p.on('state',i=>states.push(i.state));
 await p.start();assert.equal(p.state,'running');
 await until(()=>hub.since(0).some(l=>l.text==='up'));
 await p.stop();assert.equal(p.state,'stopped');
 assert.ok(hub.since(0).some(l=>l.text==='bye'));assert.equal(p.info().lastExit.wanted,true);
 await p.start();
 const during=[];p.on('state',i=>during.push(i));
 await p.restart();assert.equal(p.state,'running');assert.equal(p.info().restarts,1);
 // The boot screen follows a restart through its 'stopped' moment: that state carries restarting, the end state does not.
 const between=during.find(i=>i.state==='stopped');assert.equal(between?.restarting,true);
 assert.equal(during.at(-1).state,'running');assert.equal(during.at(-1).restarting,undefined);
 await p.stop();assert.equal(p.info().restarting,undefined);
 assert.deepEqual(states.slice(0,4),['starting','running','stopping','stopped']);
});

test('supervisor: a child that ignores the stop request is killed',async()=>{
 const p=createProcess(nodeChild('stubborn',"process.stdin.on('data',()=>{});setInterval(()=>{},1000)",{gracefulStop:{stdin:'quit\n'}}),{stopTimeoutMs:500});
 await p.start();const t=Date.now();await p.stop();
 assert.equal(p.state,'stopped');assert.ok(Date.now()-t<5000);
});

test('supervisor: crashes back off and end in failed; start() from failed tries again',async()=>{
 const hub=createLogHub(),p=createProcess(nodeChild('crashy',"console.error('boom');process.exit(3)"),{hub,backoff:{baseMs:30,maxMs:100,maxCrashes:3,windowMs:60000,resetAfterMs:60000}});
 await p.start();
 await until(()=>p.state==='failed');
 assert.equal(p.info().crashes,3);assert.match(p.info().message,/3 failures/);
 assert.ok(hub.since(0).filter(l=>l.text==='boom').length>=3);
 assert.ok(hub.since(0).some(l=>/exited unexpectedly \(code 3\)/.test(l.text)));
 await p.start();assert.notEqual(p.state,'failed');await p.stop();
});

test('supervisor: preStart can refuse; a missing program is a crash, not an exception',async()=>{
 const refused=createProcess({name:'server',command:process.execPath,args:['-e',''],preStart:async()=>{throw Error('confirmation missing');}});
 assert.equal(await refused.start(),false);assert.equal(refused.state,'failed');assert.equal(refused.info().message,'confirmation missing');
 const missing=createProcess({name:'ghost',command:join(tmpdir(),'no such program.exe')},{backoff:{baseMs:10,maxMs:10,maxCrashes:2,windowMs:60000,resetAfterMs:60000}});
 await missing.start();await until(()=>missing.state==='failed');
});

test('supervisor: readiness check holds "starting" until the child answers',async()=>{
 let ready=false;const p=createProcess({...nodeChild('central','setInterval(()=>{},1000)'),ready:async()=>ready},{readyPollMs:20});
 await p.start();assert.equal(p.state,'starting');
 ready=true;await until(()=>p.state==='running');
 await p.stop();
});

test('save guard, Backups page: owner copies survive the rotation, restore sets the current save aside, delete',()=>{
 const dir=temp(),data=join(dir,'rust_server_Data'),save=join(data,'rust_island_2013.sav'),backups=join(dir,'backups');
 mkdirSync(data);let t=Date.parse('2026-10-23T10:00:00Z');
 const g=createSaveGuard({savePath:save,backupDir:backups,keep:2,now:()=>t});
 assert.throws(()=>g.keepNow('x'),/no save to copy yet/);
 writeFileSync(save,'world-A');t+=1000;
 const mine=g.keepNow('Before the wipe vote');assert.equal(mine.label,'Before the wipe vote');
 g.onLogLine("Saving to 'x'");assert.throws(()=>g.keepNow(),/saving right now/);
 for(const n of ['B','C','D']){writeFileSync(save,'world-'+n);t+=600e3;g.onLogLine(' Saved 10 Object(s). Took 1 seconds.');}
 assert.equal(g.backups().length,2);assert.equal(g.ownerCopies().length,1); // the owner's copy is not pruned
 writeFileSync(save+'.old.0','world-C');
 assert.deepEqual(g.rotation().map(r=>r.name),['rust_island_2013.sav.old.0']);
 assert.equal(g.current().bytes,7);
 t+=1000;const r=g.restore(mine.name);
 assert.equal(readFileSync(save,'utf8'),'world-A');assert.ok(r.setAside);
 assert.equal(readFileSync(join(r.setAside,'rust_island_2013.sav'),'utf8'),'world-D');
 assert.deepEqual(g.setAside().map(a=>a.kind),['replaced']);
 assert.throws(()=>g.restore('nope.sav'),/unknown backup/);
 g.deleteOwnerCopy(mine.name);assert.equal(g.ownerCopies().length,0);
 assert.throws(()=>g.deleteOwnerCopy(g.backups()[0].name),/unknown copy/); // the watchdog's copies are not deletable here
 rmSync(dir,{recursive:true,force:true});
});

test('gateway health over its self-signed TLS: trusted without a check only on this machine\'s own addresses',async()=>{
 const {ownAddress}=await import('../host/host.mjs');const {networkInterfaces}=await import('node:os');
 const mine=Object.values(networkInterfaces()).flat().find(i=>i&&i.family==='IPv4')?.address;
 assert.equal(ownAddress('127.0.0.1'),true);if(mine)assert.equal(ownAddress(mine),true);
 assert.equal(ownAddress('203.0.113.9'),false);assert.equal(ownAddress('example.com'),false);
});
