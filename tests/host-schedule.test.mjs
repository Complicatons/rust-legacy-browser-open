// Scheduled restarts and wipes (HOST-AND-LOADER-BUILD.md H2): the rule format, wall-clock times in the owner's time
// zone across daylight saving, the countdown warnings (skipped with nobody online), cancel, a manual "restart in N
// minutes", wipes archived (never deleted), persistence, and the website learning the last wipe. Injected clock and a
// fake game server; nothing is ever run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateSchedule,nextRestart,nextWipe,nextEvent,describeRule,zonedInstant,formatZoned,createScheduler,archiveWipe,DEFAULT_SCHEDULE} from '../host/schedule.mjs';
import {central} from './helpers/central-fixture.mjs';

const UTC=(y,m,d,h=0,min=0,s=0)=>Date.UTC(y,m-1,d,h,min,s);
const base=over=>validateSchedule({...DEFAULT_SCHEDULE,timeZone:'Europe/London',...over});

test('schedule rules: validation, wall-clock restarts across daylight saving, monthly and every-N wipes',()=>{
 // Validation: every field is checked; nothing free-form gets through.
 const bad=validateSchedule({timeZone:'Mars/Olympus',restarts:{enabled:'yes',times:['25:00','06:00','06:00']},wipe:{enabled:true,type:'nuke',rule:{every:'month',nth:5,weekday:'thursday',time:'18:00'}},warnings:[0,99999],skipWarningsWhenEmpty:1});
 assert.ok(bad.errors.length>=7,bad.errors.join('\n'));
 assert.match(bad.errors.join('\n'),/timeZone/);assert.match(bad.errors.join('\n'),/25:00/);assert.match(bad.errors.join('\n'),/nth/);
 assert.match(validateSchedule({...DEFAULT_SCHEDULE,wipe:{enabled:true,type:'world',rule:{every:'days',n:0,from:'2026-02-30',time:'18:00'}}}).errors.join('\n'),/n must|from/);
 const ok=base({restarts:{enabled:true,times:['18:00','06:00']},warnings:[60,1800,10,300]});
 assert.deepEqual(ok.errors,[]);
 assert.deepEqual(ok.schedule.restarts.times,['06:00','18:00']);assert.deepEqual(ok.schedule.warnings,[1800,300,60,10]);

 // 06:00 in London: 05:00 UTC in summer time, 06:00 UTC in winter, and the morning the clocks go forward (29 March 2026).
 const s=ok.schedule;
 assert.equal(nextRestart(s,UTC(2026,10,24,4,0)).at,UTC(2026,10,24,5,0));
 assert.equal(nextRestart(s,UTC(2026,10,24,5,0)).at,UTC(2026,10,24,17,0)); // strictly after now
 assert.equal(nextRestart(s,UTC(2026,11,2,7,0)).at,UTC(2026,11,2,18,0));
 assert.equal(nextRestart(s,UTC(2026,3,28,19,0)).at,UTC(2026,3,29,5,0));
 assert.equal(zonedInstant(2026,3,28,6,0,'Europe/London'),UTC(2026,3,28,6,0));
 assert.equal(formatZoned(UTC(2026,11,5,18,0),'Europe/London'),'Thu 5 Nov, 18:00');
 assert.equal(nextRestart({...s,restarts:{enabled:false,times:['06:00']}},UTC(2026,10,24)),null);

 // First Thursday of the month 18:00: 5 November 2026 (London, winter time = UTC; New York, EST = UTC-5).
 const first={enabled:true,type:'world',rule:{every:'month',nth:1,weekday:'thu',time:'18:00'}};
 assert.equal(nextWipe({...s,wipe:first},UTC(2026,10,24)).at,UTC(2026,11,5,18,0));
 assert.equal(nextWipe({...s,timeZone:'America/New_York',wipe:first},UTC(2026,10,24)).at,UTC(2026,11,5,23,0));
 assert.equal(nextWipe({...s,wipe:first},UTC(2026,11,5,18,0)).at,UTC(2026,12,3,18,0));
 // Last Thursday of October 2026 is the 29th (after the clocks went back on the 25th).
 assert.equal(nextWipe({...s,wipe:{...first,rule:{...first.rule,nth:-1}}},UTC(2026,10,24)).at,UTC(2026,10,29,18,0));
 // Every 14 days from 1 October at 20:00 (UTC zone): 1, 15, 29 October.
 const every={enabled:true,type:'full',rule:{every:'days',n:14,from:'2026-10-01',time:'20:00'}};
 assert.equal(nextWipe({...s,timeZone:'UTC',wipe:every},UTC(2026,10,24)).at,UTC(2026,10,29,20,0));
 assert.equal(nextWipe({...s,timeZone:'UTC',wipe:{...every,rule:{every:'weeks',n:2,from:'2026-12-01',time:'20:00'}}},UTC(2026,10,24)).at,UTC(2026,12,1,20,0)); // not started yet
 assert.equal(describeRule(first.rule),'First Thursday of each month at 18:00');
 assert.equal(describeRule({...first.rule,nth:-1,weekday:'fri'}),'Last Friday of each month at 18:00');
 assert.equal(describeRule(every.rule),'Every 14 days from 1 Oct 2026 at 20:00');
 assert.equal(describeRule({every:'weeks',n:1,from:'2026-11-05',time:'18:00'}),'Every week from 5 Nov 2026 at 18:00');

 // A wipe covers a restart that would fall inside its countdown; otherwise the earliest wins.
 const both={...s,restarts:{enabled:true,times:['17:50']},wipe:first};
 assert.deepEqual(nextEvent(both,UTC(2026,11,5,12,0)),{kind:'wipe',wipe:'world',at:UTC(2026,11,5,18,0)});
 assert.deepEqual(nextEvent(both,UTC(2026,11,4,12,0)),{kind:'restart',wipe:null,at:UTC(2026,11,4,17,50)});
 assert.deepEqual(nextEvent(both,UTC(2026,11,5,12,0),new Set([UTC(2026,11,5,18,0)])),{kind:'restart',wipe:null,at:UTC(2026,11,5,17,50)}); // wipe called off: that day's restart stands
});

// A fake game server: the scheduler's whole view of the host.
function fakeServer(){
 const s={state:'running',said:[],calls:[],players:3,
  api:{state:()=>s.state,stop:async()=>{s.calls.push('stop');s.state='stopped';},start:async()=>{s.calls.push('start');s.state='running';},
   broadcast:async m=>{s.said.push(m);},players:()=>s.players}};
 return s;
}
function world(root){
 const server=join(root,'Rust Server','rust_server_Data'),save=join(server,'rust_island_2013.sav'),backups=join(root,'data','backups');
 mkdirSync(join(server,'userdata','76561198000000001'),{recursive:true});mkdirSync(join(backups,'last-good'),{recursive:true});mkdirSync(join(backups,'owner'),{recursive:true});
 for(const f of ['','.old.0','.old.1','.new'])writeFileSync(save+f,'world'+f);
 writeFileSync(join(server,'userdata','76561198000000001','avatar.bin'),'avatar');writeFileSync(join(server,'bans.cfg'),'keep me');
 writeFileSync(join(backups,'last-good','rust_island_2013.20261024-050000-000.sav'),'old world');writeFileSync(join(backups,'owner','mine.sav'),'mine');
 return {savePath:save,userdataDir:join(server,'userdata'),backupDir:backups,server};
}

test('scheduler: countdown warnings, then save-and-quit and start; quiet with nobody online; cancel; manual restart; history kept',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-schedule-')),dataDir=join(root,'data');
 try{
  const clock={t:UTC(2026,10,24,4,0)},srv=fakeServer(),notes=[];
  const make=()=>createScheduler({dataDir,now:()=>clock.t,server:srv.api,files:world(root),log:(t,l='info')=>notes.push([l,t])});
  const sch=make();
  assert.equal(sch.status().next.restart,null); // nothing scheduled by default: no surprise restarts
  await sch.save(base({restarts:{enabled:true,times:['06:00']}}).schedule);
  assert.equal(sch.status().next.restart.at,UTC(2026,10,24,5,0));
  assert.equal(sch.status().next.restart.local,'Sat 24 Oct, 06:00');
  const at=UTC(2026,10,24,5,0),step=async t=>{clock.t=t;await sch.tick();};
  await step(at-31*60e3);assert.equal(sch.status().pending,null);
  await step(at-30*60e3);assert.deepEqual(srv.said,['Server restart in 30 minutes.']);
  assert.equal(sch.status().pending.kind,'restart');
  await step(at-20*60e3);assert.equal(srv.said.length,1);
  // A tick that comes late sends only the nearest warning, with the real time left.
  await step(at-4*60e3);assert.deepEqual(srv.said.slice(1),['Server restart in 4 minutes.']);
  await step(at-60e3);await step(at-10e3);
  assert.deepEqual(srv.said.slice(2),['Server restart in 1 minute.','Server restart in 10 seconds.']);
  await step(at);
  assert.deepEqual(srv.calls,['stop','start']);
  const h=sch.status().history[0];
  assert.equal(h.kind,'restart');assert.equal(h.outcome,'done');assert.equal(h.by,'schedule');assert.equal(h.scheduledFor,at);
  assert.equal(sch.status().pending,null);assert.equal(sch.status().next.restart.at,UTC(2026,10,25,6,0)); // 06:00 GMT after the clocks go back

  // Nobody online: no warnings at all, the restart still happens.
  srv.players=0;srv.said.length=0;srv.calls.length=0;
  const at2=UTC(2026,10,25,6,0);
  for(const m of [30,15,10,5,1])await step(at2-m*60e3);
  await step(at2);
  assert.deepEqual(srv.said,[]);assert.deepEqual(srv.calls,['stop','start']);
  assert.ok(notes.some(([,t])=>/nobody is online/.test(t)));

  // Cancel a scheduled restart: players are told, and that one is skipped (the next day's still counts).
  srv.players=2;srv.said.length=0;srv.calls.length=0;
  const at3=UTC(2026,10,26,6,0);
  await step(at3-15*60e3);assert.deepEqual(srv.said,['Server restart in 15 minutes.']);
  await sch.cancel({by:'owner'});
  assert.deepEqual(srv.said,['Server restart in 15 minutes.','The server restart is cancelled.']);
  await step(at3+1000);assert.deepEqual(srv.calls,[]);
  assert.equal(sch.status().history[0].outcome,'cancelled');
  assert.equal(sch.status().next.restart.at,UTC(2026,10,27,6,0));
  await assert.rejects(sch.cancel({by:'owner'}),/Nothing to cancel/);

  // Manual: restart in 7 minutes announces at once, then the remaining warnings; a restart while stopped is skipped.
  srv.said.length=0;
  await sch.restartIn(7,{by:'owner'});
  assert.deepEqual(srv.said,['Server restart in 7 minutes.']);
  const m=clock.t+7*60e3;
  await step(m-5*60e3);await step(m-60e3);await step(m-10e3);
  assert.deepEqual(srv.said.slice(1),['Server restart in 5 minutes.','Server restart in 1 minute.','Server restart in 10 seconds.']);
  srv.state='stopped';await step(m);
  assert.equal(sch.status().history[0].outcome,'skipped');assert.deepEqual(srv.calls,[]);
  srv.state='running';
  await assert.rejects(sch.restartIn(500),/0 to 180/);
  await assert.rejects(sch.restartIn(5,{wipe:'world'}),/confirm/i);
  await assert.rejects(sch.save({...sch.status().schedule,wipe:{enabled:true,type:'world',rule:{every:'month',nth:1,weekday:'thu',time:'18:00'}}}),/confirm/i);

  // Restart now (0 minutes) runs at once.
  srv.calls.length=0;await sch.restartIn(0,{by:'website'});await sch.idle();
  assert.deepEqual(srv.calls,['stop','start']);assert.equal(sch.status().history[0].by,'website');

  // Persisted: a new scheduler (host restart) has the same schedule and history.
  const again=make();
  assert.deepEqual(again.status().schedule.restarts.times,['06:00']);
  assert.equal(again.status().history.length,sch.status().history.length);
  assert.ok(existsSync(join(dataDir,'schedule.json')));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('wipes: world and full wipes are archived into backups/wipe-<time>, never deleted; the save guard copies go with them',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-wipe-'));
 try{
  const files=world(root);
  const a=archiveWipe({...files,type:'world',now:UTC(2026,11,5,18,0)});
  assert.match(a.name,/^wipe-20261105-180000/);
  const dir=join(files.backupDir,a.name);
  assert.deepEqual(readdirSync(dir).sort(),['last-good','rust_island_2013.sav','rust_island_2013.sav.new','rust_island_2013.sav.old.0','rust_island_2013.sav.old.1','wipe.json']);
  assert.equal(readFileSync(join(dir,'rust_island_2013.sav.old.1'),'utf8'),'world.old.1');
  assert.ok(!existsSync(files.savePath));assert.ok(existsSync(join(files.userdataDir,'76561198000000001','avatar.bin'))); // characters stay
  assert.ok(existsSync(join(files.server,'bans.cfg')));assert.ok(existsSync(join(files.backupDir,'owner','mine.sav'))); // other files and the owner's copies stay
  assert.ok(!existsSync(join(files.backupDir,'last-good'))); // the old world's copies cannot be "restored" into the new world
  assert.equal(JSON.parse(readFileSync(join(dir,'wipe.json'),'utf8')).type,'world');

  // Full wipe through the scheduler: confirmation, countdown naming the wipe, userdata archived, last wipe recorded.
  const files2=world(join(root,'b')),clock={t:UTC(2026,11,5,17,0)},srv=fakeServer(),dataDir=join(root,'b','data');
  const finished=[];
  const sch=createScheduler({dataDir,now:()=>clock.t,server:srv.api,files:files2,log:()=>{},onDone:e=>finished.push(e)});
  await sch.restartIn(10,{wipe:'full',confirm:true,by:'owner'});
  assert.deepEqual(srv.said,['Server restart and full wipe (map and characters) in 10 minutes.']);
  assert.equal(sch.status().pending.wipe,'full');
  clock.t+=10*60e3;await sch.tick();
  assert.deepEqual(srv.calls,['stop','start']);
  const h=sch.status().history[0];assert.equal(h.outcome,'done');assert.equal(h.wipe,'full');
  assert.equal(finished.length,1);assert.equal(finished[0],h); // reported once it is over (Discord alerts: host/alerts.mjs 'schedule')
  const wdir=join(files2.backupDir,h.archive);
  assert.ok(existsSync(join(wdir,'userdata','76561198000000001','avatar.bin')));assert.ok(!existsSync(files2.userdataDir));
  assert.deepEqual(sch.status().lastWipe,{at:clock.t,type:'full',archive:h.archive});
  assert.deepEqual(sch.summary().lastWipe,{at:clock.t,type:'full'});

  // A wipe with the server stopped still archives, and does not start the server.
  writeFileSync(files2.savePath,'new world');srv.state='stopped';srv.calls.length=0;
  await sch.restartIn(0,{wipe:'world',confirm:true});await sch.idle();
  assert.deepEqual(srv.calls,[]);assert.equal(sch.status().history[0].outcome,'done');assert.match(sch.status().history[0].note,/not started/);
  assert.ok(!existsSync(files2.savePath));

  // A server that will not stop is never wiped under.
  writeFileSync(files2.savePath,'live world');srv.state='running';srv.api.stop=async()=>{throw Error('started outside the host and could not be verified');};
  await sch.restartIn(0,{wipe:'world',confirm:true});await sch.idle();
  assert.equal(sch.status().history[0].outcome,'failed');assert.ok(existsSync(files2.savePath));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the website learns the last wipe from the relay report, and accepts restart-in from the console',async()=>{
 const c=await central();
 try{
  const login=await c.call('POST','/auth/login',{data:{subject:'owner-1',name:'Owner'}});
  const owner={cookie:login.cookie,csrf:login.data.csrf};
  const id=(await c.call('POST','/owner/servers',{data:{name:'Wipe test',region:'eu',endpoint:'wss://play.example.test/play'},...owner})).data.id;
  const key=(await c.call('POST',`/owner/servers/${id}/host-key`,{data:{},...owner})).data.hostKey;
  c.db.setListed(id,true);
  const report=data=>fetch(c.base+'/host-relay/report',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(data)}).then(r=>r.json());
  const status={components:[{name:'server',state:'running'}],schedule:{lastWipe:{at:UTC(2026,11,5,18,0),type:'full'},next:null,pending:null}};
  await report({status,control:true,logs:[]});
  assert.equal((await c.call('GET',`/servers/${id}`)).data.lastWipeAt,UTC(2026,11,5,18,0));
  await report({status:{...status,schedule:{lastWipe:{at:'yesterday'}}},logs:[]}); // junk is ignored, the date stays
  assert.equal((await c.call('GET',`/servers/${id}`)).data.lastWipeAt,UTC(2026,11,5,18,0));
  // The gateway heartbeat (its own wipe label) does not touch it.
  assert.equal((await c.call('GET','/servers')).data.servers.find(s=>s.id===id).lastWipeAt,UTC(2026,11,5,18,0));

  assert.equal((await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'restart-in',minutes:999},...owner})).status,400);
  const q=await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'restart-in',minutes:15},...owner});
  assert.equal(q.status,202);
  assert.equal((await c.call('POST',`/owner/servers/${id}/console-command`,{data:{op:'restart-cancel'},...owner})).status,202);
  const got=await report({status,logs:[]});
  assert.deepEqual(got.commands.map(x=>[x.op,x.minutes??null]),[['restart-in',15],['restart-cancel',null]]);
 }finally{await c.close();}
});

test('the host app runs the website console\'s restart-in and restart-cancel on its schedule (never a wipe)',async()=>{
 const {createRemote}=await import('../host/remote.mjs'),{createLogHub}=await import('../host/log-hub.mjs');
 const calls=[],results=[];let queue=[{id:'c1',op:'restart-in',minutes:15,by:'Owner'},{id:'c2',op:'restart-cancel'},{id:'c3',op:'restart-in',minutes:-1}];
 const host={hub:createLogHub({perSource:50}),components:()=>['server'],status:()=>({components:[]}),
  schedule:{restartIn:async(m,o)=>{if(!Number.isInteger(m)||m<0)throw Error('minutes must be a whole number from 0 to 180');calls.push(['in',m,o]);},cancel:async o=>{calls.push(['cancel',o]);}}};
 const fetchImpl=async(u,o)=>{const b=JSON.parse(o.body);results.push(...b.results);const commands=queue;queue=[];return {ok:true,status:200,json:async()=>({commands})};};
 const r=createRemote({host,key:()=>'rlbh_k',centralUrl:'https://rustlegacy.example/',fetchImpl});
 await r.tick();await new Promise(res=>setTimeout(res,10));await r.tick();
 assert.deepEqual(calls,[['in',15,{by:'website'}],['cancel',{by:'website'}]]);
 assert.deepEqual(results.map(x=>[x.id,x.ok]),[['c1',true],['c2',true],['c3',false]]);
});
