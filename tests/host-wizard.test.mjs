// Setup wizard (host/wizard.mjs, HOST-APP-PLAN.md slice 3): plan → run → PASS/WARN/FAIL from the scripts' -Json lines,
// live lines, resume from the data folder, the owner's elevated hand-off, and refusals. The scripts are stood in for by
// host/wizard-practice.mjs (same output format); no PowerShell here. The step list is pinned to the scripts themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createServer,request} from 'node:http';
import {createWizard,STEPS,MODES,outcome,readMarks,errorDetail,powershellLaunch,powershellCommand} from '../host/wizard.mjs';
import {practiceSetup} from '../host/wizard-practice.mjs';
import {createServiceHandler} from '../host/service.mjs';
import {createLogHub} from '../host/log-hub.mjs';
import {listenServer} from '../bridge/listen.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n'); // CRLF on a Windows checkout
const temp=(name='rlb-wizard-')=>mkdtempSync(join(tmpdir(),name));
const until=async(pred,ms=10000)=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,20));}throw Error('condition not met');};
// A practice launcher whose settings a test can change between calls (elevation, outcomes per script).
function practice(cfg={elevated:true,steps:{}}){
 const make=()=>practiceSetup(cfg);
 return {cfg,launch:(f,a)=>make().launch(f,a),command:(f,a,r)=>make().command(f,a,r),practice:true};
}
const status=e=>e.filter(x=>x.state).map(x=>[x.step,x.state.last?.status]);

test('wizard steps are the scripts: each exists, takes -Json, is a dry run without its switch, and its admin and password flags match the script',()=>{
 const common=read('deploy/host-test/scripts/_Common.ps1');
 assert.match(common,/\$script:RlbJson = \[bool\]\(Get-Variable -Name Json -Scope Local/);
 assert.match(common,/function Write-Plan[\s\S]*?Write-RlbJson @\{ type = 'plan'[^\n]*elevated = \(Test-IsAdmin\)/);
 assert.match(common,/function Assert-Admin \{\s*if \(-not \(Test-IsAdmin\)\) \{ Write-RlbJson @\{ type = 'needs-admin' \}; throw/);
 assert.match(common,/function Write-RlbResult/);
 assert.match(read('deploy/host-test/scripts/04-Test-Isolation.ps1'),/Write-RlbResult -Rows \$rows\n\$fails = /);
 for(const s of STEPS){
  const ps=read(s.script),param=/^param\((.*)\)$/m.exec(ps)?.[1]??'';
  assert.match(param,/\[switch\]\$Json/,s.script+' declares -Json');
  assert.match(ps,/_Common\.ps1'\)\)?$/m,s.script+' uses _Common.ps1');
  assert.match(ps,s.original?/Confirm-OrExit \$ConfirmRunOriginalBinaries\.IsPresent 'ConfirmRunOriginalBinaries'/:/Confirm-OrExit \$Apply\.IsPresent 'Apply'/,s.script+' is a dry run without its switch');
  assert.equal(/\nAssert-Admin\b/.test(ps),Boolean(s.admin),s.script+' admin flag');
  assert.equal(/Read-Host|Get-Credential/.test(ps),Boolean(s.prompts||s.original),s.script+' password prompt flag');
  for(const a of s.args?.({zipPath:'z',ownerIp:'1',publicIp:'2',hostname:'h',certFile:'c',serverId:'i',code:'k'},'vps')??[])
   if(typeof a==='string')assert.match(param,new RegExp('\\$'+a.slice(1)+'\\b'),`${s.script} takes ${a}`);
 }
 // Every mode has its steps in the README's order, and only the owner starts the original server.
 const ids=m=>STEPS.filter(s=>!s.modes||s.modes.includes(m)).map(s=>s.id);
 assert.deepEqual(ids('own-pc'),['account','folders','firewall','isolation','secrets','certificate','patch','website','enrol','task','start']);
 assert.deepEqual(ids('vps'),['account','folders','public','firewall','isolation','secrets','csr','origin-cert','patch','enrol','task','start']);
 assert.deepEqual(STEPS.filter(s=>s.original).map(s=>s.script),['deploy/host-test/scripts/05-Start-Server.ps1']);
 assert.deepEqual(Object.keys(MODES),['own-pc','vps','attach']);
});

test('parsing: plan, rows, needs-admin, PowerShell error reports, exit codes',()=>{
 const plan=readMarks(['== x ==','##rlb {"type":"plan","title":"Firewall","steps":"only one","changesSecurity":true,"runsOriginalBinaries":false,"elevated":false}','##rlb not json']).plan;
 assert.deepEqual(plan,{title:'Firewall',steps:['only one'],changesSecurity:true,runsOriginalBinaries:false,elevated:false}); // ConvertTo-Json may flatten a one-item array
 const ps=['Zip is 1 bytes, expected 543636040.','At C:\\RLB\\deploy\\host-test\\scripts\\02-Prepare-Server.ps1:38 char:29','+ if ($zip.Length -ne ...','    + CategoryInfo          : OperationStopped'];
 assert.equal(errorDetail(ps),'Zip is 1 bytes, expected 543636040.');
 assert.equal(errorDetail(['C:\\x\\13-Enrol-Gateway.ps1 : Give -ServerId <uuid from the owner page>.','At line:1 char:1','+ & x']),'Give -ServerId <uuid from the owner page>.');
 assert.deepEqual(outcome({},0,['Firewall rules in place.']),{status:'PASS',detail:'Firewall rules in place.',rows:[]});
 assert.equal(outcome({},1,ps).status,'FAIL');assert.equal(outcome({},1,ps).detail,'Zip is 1 bytes, expected 543636040.');
 const rows=[{check:'a',status:'PASS',detail:''},{check:'b',status:'WARN',detail:'online'}];
 assert.deepEqual(outcome({result:{status:'WARN',rows}},0,[]),{status:'WARN',detail:'1 warning(s)',rows});
 assert.equal(outcome({result:{status:'PASS',rows}},1,ps).status,'FAIL','a non-zero exit is never a pass');
 assert.equal(outcome({result:{status:'FAIL',rows:[{check:'x',status:'FAIL'}]}},1,[]).detail,'1 of 1 checks failed');
 assert.equal(outcome({needsAdmin:true},1,ps).status,'needs-admin');
 assert.equal(outcome({failed:true},null,ps).status,'FAIL');
});

test('PowerShell launch and the owner\'s line: argument arrays, quoting, a value starting with "-"',()=>{
 const l=powershellLaunch('C:\\Program Files\\Rust Legacy Host\\app\\deploy\\host-test\\scripts\\13-Enrol-Gateway.ps1',['-Apply','-ServerId',{value:'12345678-1234-4123-8123-123456789abc'},'-Code',{value:'-abcdefghijklmnopqrstu'},'-Json']);
 assert.match(l.command,/WindowsPowerShell\\v1\.0\\powershell\.exe$|WindowsPowerShell\/v1\.0\/powershell\.exe$/);
 assert.deepEqual(l.args.slice(0,5),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File']);
 assert.deepEqual(l.args.slice(6),['-Apply','-ServerId','12345678-1234-4123-8123-123456789abc','-Code:-abcdefghijklmnopqrstu','-Json']);
 const c=powershellCommand("C:\\O'Brien\\02-Prepare-Server.ps1",['-Apply','-ZipPath',{value:"D:\\Zoë's\\RustLegacyServer.zip"},'-Json'],'C:\\ProgramData\\Rust Legacy Host\\setup\\results\\folders.txt');
 assert.equal(c,"Set-ExecutionPolicy -Scope Process Bypass -Force; & { try { & 'C:\\O''Brien\\02-Prepare-Server.ps1' -Apply -ZipPath 'D:\\Zoë''s\\RustLegacyServer.zip' -Json; '##rlb {\"type\":\"done\"}' } catch { $_; '##rlb {\"type\":\"failed\"}' } } *>&1 | Tee-Object -FilePath 'C:\\ProgramData\\Rust Legacy Host\\setup\\results\\folders.txt'");
});

test('plan → run → PASS with live lines; WARN and FAIL; resume from the data folder',async()=>{
 const dataDir=temp(),events=[],notes=[],p=practice({elevated:true,steps:{'08-New-Secrets.ps1':'slow','10-Patch-TestCopy.ps1':'fail','11-Initialize-Central.ps1':'denied'}});
 let w=createWizard({dataDir,...p,emit:e=>events.push(e),log:t=>notes.push(t)});
 try{
  assert.deepEqual(w.state().steps,[]);
  await assert.rejects(w.plan('secrets'),/Choose where this server runs first/);
  // An existing server as it is runs no scripts: the app's own steps (host/setup.mjs) instead.
  w.setMode('attach');assert.deepEqual(w.state().steps,[]);await assert.rejects(w.plan('secrets'),/not a step for an existing server/);
  w.setMode('own-pc');
  const s0=w.state();assert.equal(s0.steps.length,11);assert.equal(s0.practice,true);assert.equal(s0.available,true);
  assert.equal(s0.steps.find(s=>s.id==='firewall').by,'owner','not known to be elevated before a plan has run');
  const v=await w.plan('firewall');
  assert.equal(v.plan.title,'Firewall lock-down for the test server');assert.equal(v.plan.changesSecurity,true);assert.equal(v.plan.steps.length,5);
  assert.equal(w.state().elevated,true);assert.equal(w.state().steps.find(s=>s.id==='firewall').by,'host');
  assert.equal(w.state().steps.find(s=>s.id==='account').by,'owner','a password prompt always goes to the owner');
  assert.equal(w.state().steps.find(s=>s.id==='start').by,'owner','only the owner starts the original server');
  assert.deepEqual(v.log,[],'a plan does not replace the last run\'s output');

  // Slow step: lines arrive while it runs, and a second run is refused meanwhile.
  assert.deepEqual(w.run('secrets'),{by:'host',started:true});
  assert.equal(w.state().running.step,'secrets');
  assert.throws(()=>w.run('firewall'),e=>e.status===409);
  const both=[w.plan('certificate'),w.plan('website')];await assert.rejects(w.plan('certificate'),e=>e.status===409&&/being read/.test(e.message));
  for(const v of await Promise.all(both))assert.ok(v.plan.title,'a plan (a dry run) may run beside a run');
  await until(()=>events.some(e=>e.step==='secrets'&&e.lines?.some(l=>/working… 3\/12/.test(l.text))));
  assert.ok(!w.state().steps.find(s=>s.id==='secrets').last.endedAt,'still running when the first lines arrive');
  await w.idle();
  const secrets=w.state().steps.find(s=>s.id==='secrets');
  assert.equal(secrets.last.status,'PASS');assert.equal(secrets.last.by,'host');assert.equal(secrets.last.exitCode,0);
  assert.match(secrets.last.detail,/Next: 09-New-GatewayCert/);assert.ok(secrets.log.some(l=>/Practice run/.test(l.text)));

  w.run('certificate');await w.idle();
  const cert=w.state().steps.find(s=>s.id==='certificate').last;assert.equal(cert.status,'PASS');assert.match(cert.detail,/SHA-256/);
  w.run('patch');await w.idle();
  const patch=w.state().steps.find(s=>s.id==='patch').last;
  assert.equal(patch.status,'FAIL');assert.match(patch.detail,/the server zip SHA-256 does not match/);assert.equal(patch.exitCode,1);assert.equal(patch.hint,undefined);
  w.run('website');await w.idle();
  const web=w.state().steps.find(s=>s.id==='website').last;
  assert.equal(web.status,'FAIL');assert.match(web.detail,/Access to the path .* is denied/);assert.equal(web.hint,'owner','an access error offers the owner\'s line');
  p.cfg.steps['08-New-Secrets.ps1']='warn';w.run('secrets');await w.idle();
  assert.equal(w.state().steps.find(s=>s.id==='secrets').last.status,'WARN','re-run any step');
  assert.ok(notes.some(n=>/Setup: Secrets started/.test(n))&&notes.some(n=>/Setup: Patch the server copy FAIL/.test(n)));
  assert.deepEqual(status(events).at(-1),['start',undefined]);
  w.close();

  // Resume: a new wizard on the same folder shows the same results and output; a run cut off by a host stop is a FAIL.
  const saved=JSON.parse(readFileSync(join(dataDir,'setup','wizard.json'),'utf8'));
  saved.steps.patch.last={status:'running',at:1,by:'host'};writeFileSync(join(dataDir,'setup','wizard.json'),JSON.stringify(saved));
  w=createWizard({dataDir,...p});
  const again=w.state();
  assert.equal(again.mode,'own-pc');assert.equal(again.elevated,true);
  assert.equal(again.steps.find(s=>s.id==='secrets').last.status,'WARN');
  assert.ok(again.steps.find(s=>s.id==='secrets').log.length>3);
  assert.equal(again.steps.find(s=>s.id==='firewall').plan.title,'Firewall lock-down for the test server');
  assert.match(again.steps.find(s=>s.id==='patch').last.detail,/host stopped while this step ran/);
 }finally{w.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('administrator steps: needs-admin when the host is not elevated, then the owner\'s line and its transcript',async()=>{
 const dataDir=temp("rlb-wizard-O'Brien-"),events=[],p=practice({elevated:true,steps:{}});
 const w=createWizard({dataDir,...p,emit:e=>events.push(e),pollMs:60000});
 try{
  w.setMode('own-pc');await w.plan('firewall');assert.equal(w.state().elevated,true);
  p.cfg.elevated=false; // the plan said elevated, but the run is refused by Assert-Admin
  w.run('firewall');await w.idle();
  const fw=w.state().steps.find(s=>s.id==='firewall');
  assert.equal(fw.last.status,'needs-admin');assert.equal(w.state().elevated,false);assert.equal(fw.by,'owner');
  assert.match(fw.byWhy,/needs administrator rights/);

  // The owner's line: fixed script path, -Apply -Json, output teed to the wizard's result file.
  const r=w.run('firewall');
  assert.equal(r.by,'owner');
  const file=join(dataDir,'setup','results','firewall.txt');
  assert.ok(r.command.includes(`Tee-Object -FilePath '${file.replace(/'/g,"''")}'`),r.command);
  assert.match(r.command,/03-Set-Firewall\.ps1' -Apply -Json;/);assert.match(r.command,/host[\\/]wizard-practice\.mjs/,'practice mode runs the practice script, not the real one');
  assert.equal(w.state().steps.find(s=>s.id==='firewall').handoff.command,r.command);
  // Windows PowerShell 5.1's Tee-Object writes UTF-16 with a byte order mark; follow it while it is written.
  const utf16=t=>Buffer.concat([Buffer.from(t,'utf16le')]);
  writeFileSync(file,Buffer.concat([Buffer.from([0xff,0xfe]),utf16('\r\n== Firewall lock-down for the test server ==\r\nThis script will:\r\n')]));
  w.poll();
  await until(()=>events.some(e=>e.step==='firewall'&&e.lines?.some(l=>/Firewall lock-down/.test(l.text))));
  assert.ok(w.state().steps.find(s=>s.id==='firewall').handoff,'still waiting for the owner');
  appendFileSync(file,utf16('Firewall rules in place. Next: 04-Test-Isolation.ps1 -Apply.\r\n##rlb {"type":"done"}\r\n'));
  w.poll();
  const done=w.state().steps.find(s=>s.id==='firewall');
  assert.equal(done.handoff,null);assert.equal(done.last.status,'PASS');assert.equal(done.last.by,'owner');assert.match(done.last.detail,/Firewall rules in place/);

  // Password steps: always the owner. 04's rows come back through the transcript (UTF-8 here, as PowerShell 7 writes).
  const iso=w.run('isolation');assert.equal(iso.by,'owner');assert.match(iso.command,/04-Test-Isolation\.ps1' -Apply -Json/);
  writeFileSync(join(dataDir,'setup','results','isolation.txt'),['##rlb {"type":"plan","title":"Isolation check","steps":["x"],"changesSecurity":false,"runsOriginalBinaries":false,"elevated":true}',
   '##rlb {"type":"result","status":"WARN","detail":"","rows":[{"check":"probe as rlbserver: outside blocked","status":"PASS","detail":"all failed"},{"check":"PC offline during runs","status":"WARN","detail":"default route"}]}',
   'Isolation check passed.','##rlb {"type":"done"}',''].join('\n'));
  w.poll();
  const isoDone=w.state().steps.find(s=>s.id==='isolation').last;
  assert.equal(isoDone.status,'WARN');assert.deepEqual(isoDone.rows.map(r=>r.status),['PASS','WARN']);
  // A throw in the owner's run: the error record, then "failed".
  w.run('account');
  writeFileSync(join(dataDir,'setup','results','account.txt'),['rlbserver exists and is in: Administrators. Remove it from every group except Users first.','At C:\\x\\01-New-ServerAccount.ps1:27 char:22','+ ...','##rlb {"type":"failed"}',''].join('\r\n'));
  w.poll();
  const acc=w.state().steps.find(s=>s.id==='account').last;
  assert.equal(acc.status,'FAIL');assert.match(acc.detail,/is in: Administrators/);
  // Cancel forgets a hand-off; a new hand-off ignores an old transcript.
  w.run('task');writeFileSync(join(dataDir,'setup','results','task.txt'),'##rlb {"type":"done"}\n');
  w.run('task');assert.ok(!existsSync(join(dataDir,'setup','results','task.txt')),'old transcript removed');
  w.cancel('task');assert.equal(w.state().steps.find(s=>s.id==='task').handoff,null);
  // The start step: the owner's line confirms the original server and uses the scheduled task.
  assert.match(w.run('start').command,/05-Start-Server\.ps1' -ConfirmRunOriginalBinaries -ViaTask -Json;/);
 }finally{w.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('refusals: unknown steps, steps of the other mode, bad and missing options, never a value as a switch',async()=>{
 const dataDir=temp(),p=practice({elevated:true,steps:{}}),w=createWizard({dataDir,...p});
 const zip=join(dataDir,'RustLegacyServer.zip');writeFileSync(zip,'zip');
 const pem=join(dataDir,'origin.pem');writeFileSync(pem,'-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
 try{
  assert.throws(()=>w.setMode('cloud'),/unknown mode/);
  w.setMode('own-pc');
  for(const id of ['nope','__proto__','constructor',undefined,{id:'firewall'}])assert.throws(()=>w.run(id),e=>e.status===400&&/unknown-step/.test(e.message),String(id));
  await assert.rejects(w.handle('run',{step:'../../evil'}),/unknown-step/);
  await assert.rejects(w.handle('exec',{}),e=>e.status===404);
  assert.throws(()=>w.run('csr'),/not a step for this pc/i);
  assert.throws(()=>w.run('folders'),/Fill in: Server zip/);
  assert.throws(()=>w.run('folders',{zipPath:'RustLegacyServer.zip'}),/full path/);
  assert.throws(()=>w.run('folders',{zipPath:join(dataDir,'missing.zip')}),/not found/);
  assert.throws(()=>w.run('folders',{zipPath:pem}),/must be a \.zip file/);
  assert.throws(()=>w.run('folders',{zipPath:zip+'\n-Apply'}),/one line/);
  assert.throws(()=>w.run('folders',{zipPath:zip,command:'calc'}),/takes no option "command"/);
  assert.throws(()=>w.run('folders',['x']),/options must be an object/);
  assert.throws(()=>w.run('enrol',{serverId:'not-a-uuid',code:'x'.repeat(30)}),/server id/);
  assert.throws(()=>w.run('enrol',{serverId:'12345678-1234-4123-8123-123456789ABC',code:'short'}),/enrolment code/);
  w.setMode('vps');
  assert.throws(()=>w.run('public',{ownerIp:'192.168.1.20'}),/public IPv4/);
  assert.throws(()=>w.run('public',{ownerIp:'1.2.3.999'}),/public IPv4/);
  assert.throws(()=>w.run('csr',{hostname:'eu1.your-domain.example; calc'}),/host name/);
  assert.throws(()=>w.run('origin-cert',{certFile:zip}),/\.pem or \.crt or \.cer/);
  const bad=join(dataDir,'bad.pem');writeFileSync(bad,'hello');assert.throws(()=>w.run('origin-cert',{certFile:bad}),/PEM certificate/);
  // Good options are kept (the code in memory only) and reach the script as separate arguments.
  const plan=await w.plan('origin-cert',{certFile:pem});assert.equal(plan.plan.title,'Install the Cloudflare Origin certificate for the gateway');
  await w.plan('enrol',{serverId:'12345678-1234-4123-8123-123456789ABC',code:'Abc_def-ghijklmnopqrstu'});
  const st=w.state();
  assert.equal(st.options.serverId,'12345678-1234-4123-8123-123456789abc');assert.equal(st.options.code,undefined);assert.equal(st.hasCode,true);
  assert.equal(st.options.hostname,'eu1.your-domain.example');
  assert.match(w.run('enrol',{},{by:'owner'}).command,/-ServerId '12345678-1234-4123-8123-123456789abc' -Code 'Abc_def-ghijklmnopqrstu' -Json;/,'the owner may run any step themselves');
  assert.ok(!readFileSync(join(dataDir,'setup','wizard.json'),'utf8').includes('Abc_def'),'the enrolment code is not written to disk');
  const seen=[];const w2=createWizard({dataDir:temp(),launch:(f,a)=>{seen.push(a);return p.launch(f,a);}});
  w2.setMode('vps');await w2.plan('public',{ownerIp:'203.0.113.7',publicIp:''});
  assert.deepEqual(seen[0].map(a=>a.value??a),['-OwnerIp','203.0.113.7','-Json']);w2.close();
  // No PowerShell on this system and no launcher: every step is the owner's, with the reason.
  const w3=createWizard({dataDir:temp(),platform:'linux'});w3.setMode('own-pc');
  assert.equal(w3.state().available,false);assert.match(w3.state().steps.find(s=>s.id==='secrets').byWhy,/cannot run PowerShell/);w3.close();
 }finally{w.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('a step that runs too long is stopped and fails',async()=>{
 const dataDir=temp(),w=createWizard({dataDir,...practice({elevated:true,steps:{'08-New-Secrets.ps1':'slow'}}),timeoutMs:400});
 try{w.setMode('own-pc');w.run('secrets');await w.idle();
  const last=w.state().steps.find(s=>s.id==='secrets').last;assert.equal(last.status,'FAIL');assert.match(last.detail,/timed out/);
 }finally{w.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('service: /api/setup needs the session, refuses unknown steps, and streams "setup" events',async()=>{
 const dataDir=temp(),ev=new EventEmitter(),hub=createLogHub();
 const host={hub,on:ev.on.bind(ev),off:ev.off.bind(ev),status:()=>({components:[]}),components:()=>[]};
 host.setup=createWizard({dataDir,...practice({elevated:true,steps:{}}),emit:d=>ev.emit('setup',d)});
 // The handler checks the Host header against its port, so it is made once the port is known.
 let h2;const server=createServer((q,s)=>h2(q,s));await listenServer(server,{port:0,host:'127.0.0.1'});
 const port=server.address().port;
 h2=createServiceHandler({host,token:'t'.repeat(43),port});
 const call=(path,{method='GET',body,cookie}={})=>new Promise((res,rej)=>{
  const r=request({host:'127.0.0.1',port,path,method,headers:{host:`127.0.0.1:${port}`,...(cookie?{cookie}:{}),...(method==='POST'?{origin:`http://127.0.0.1:${port}`,'content-type':'application/json','x-rlb-host':'1'}:{})}},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>res({status:x.statusCode,headers:x.headers,json:b?JSON.parse(b):null}));});
  r.on('error',rej);if(body)r.write(JSON.stringify(body));r.end();});
 try{
  assert.equal((await call('/api/setup')).status,401);
  assert.equal((await call('/api/setup/run',{method:'POST',body:{step:'secrets'}})).status,401);
  const login=await call('/api/login',{method:'POST',body:{token:'t'.repeat(43)}}),cookie=login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await call('/api/setup',{cookie})).json.mode,null);
  assert.equal((await call('/api/setup/mode',{method:'POST',body:{mode:'own-pc'},cookie})).json.steps.length,11);
  assert.equal((await call('/api/setup/run',{method:'POST',body:{step:'rm -rf'},cookie})).status,400);
  assert.equal((await call('/api/setup/shell',{method:'POST',body:{},cookie})).status,404);
  const got=[];let sse;
  await new Promise(res=>{sse=request({host:'127.0.0.1',port,path:'/api/events',headers:{host:`127.0.0.1:${port}`,cookie}},r=>{r.setEncoding('utf8');r.on('data',d=>got.push(d));res();});sse.end();});
  const plan=await call('/api/setup/plan',{method:'POST',body:{step:'secrets'},cookie});
  assert.equal(plan.status,200);assert.equal(plan.json.plan.title,'Generate the bridge secrets');
  const run=await call('/api/setup/run',{method:'POST',body:{step:'secrets'},cookie});
  assert.equal(run.status,200);assert.deepEqual(run.json,{by:'host',started:true});
  await host.setup.idle();
  await until(()=>/event: setup\ndata: \{"step":"secrets","lines"/.test(got.join(''))&&/"status":"PASS"/.test(got.join('')));
  assert.equal((await call('/api/setup',{cookie})).json.steps.find(s=>s.id==='secrets').last.status,'PASS');
  sse.destroy();
 }finally{h2.close();host.setup.close();await new Promise(r=>server.close(r));server.closeAllConnections?.();rmSync(dataDir,{recursive:true,force:true});}
});

// "Add the parts to host.json" (owner decision, HOST-AND-LOADER-BUILD.md question 3, 29 Oct 2026): the scripts write
// central/central.json, config/sidecar.json, config/gateway.json and server/test under the scripts root but never
// touch host.json's own components; finish() adds whichever of those the scripts have actually finished and host.json
// does not already have.
test('finish(): adds the parts the scripts finished to host.json, never a part already there, and needs hostJsonFile',async()=>{
 const dataDir=temp(),root=temp('rlb-wizard-root-'),hostJsonDir=temp('rlb-wizard-hostjson-'),hostJsonFile=join(hostJsonDir,'host.json');
 writeFileSync(hostJsonFile,JSON.stringify({listen:{host:'127.0.0.1',port:28100},dataDir,components:{gateway:{config:'already-there.json'}}}));
 try{
  // Nothing written by the scripts yet: finish() has nothing to offer, and without hostJsonFile it cannot run at all.
  const w0=createWizard({dataDir:temp(),scriptsRoot:root});
  assert.deepEqual(w0.state().finish,{can:false,ready:[]});
  await assert.rejects(()=>w0.handle('finish'),/host\.json location unknown/);
  w0.close();
  // central and server/test are ready; sidecar and gateway are not (gateway is already in host.json anyway).
  mkdirSync(join(root,'central'),{recursive:true});writeFileSync(join(root,'central','central.json'),'{}');
  mkdirSync(join(root,'server','test'),{recursive:true});writeFileSync(join(root,'server','test','rust_server.exe'),'x');
  const w=createWizard({dataDir,scriptsRoot:root,hostJsonFile});
  assert.deepEqual(w.state().finish,{can:true,ready:['central','server']});
  const r=await w.handle('finish');
  assert.deepEqual(r.ready.sort(),['central','server']);assert.deepEqual(r.added.sort(),['central','server']);
  const saved=JSON.parse(readFileSync(hostJsonFile,'utf8'));
  assert.deepEqual(saved.components.central,{config:join(root,'central','central.json')});
  assert.deepEqual(saved.components.server,{kind:'original',dir:join(root,'server','test')});
  assert.deepEqual(saved.components.gateway,{config:'already-there.json'},'a part already in host.json is left as it is');
  // A second run finds the same two parts ready (finish() does not remove anything), but adds nothing new.
  assert.deepEqual(await w.handle('finish'),{added:[],ready:['central','server']});
  w.close();
 }finally{rmSync(dataDir,{recursive:true,force:true});rmSync(root,{recursive:true,force:true});rmSync(hostJsonDir,{recursive:true,force:true});}
});
