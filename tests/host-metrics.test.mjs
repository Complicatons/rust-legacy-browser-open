// Host app health metrics (host/metrics.mjs): one row a minute from the host's own status and events, day files that
// survive a restart, the 24 h view at 1-minute resolution and the 7-day view downsampled, freeze and restart markers,
// and the summary numbers. Injected clock and a fake host; no processes except this one for the memory reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHostMetrics,createMetricsStore,seedDemoMetrics,METRIC_FIELDS} from '../host/metrics.mjs';
import {createLogHub} from '../host/log-hub.mjs';
import {createCpuSampler} from '../host/proc-stats.mjs';

const MIN=60e3,DAY=86400e3;
function fakeHost(clock){
 const ev=new EventEmitter(),hub=createLogHub({now:()=>clock.t});
 const st={server:{name:'server',state:'running',pid:4242,restarts:0},players:{inGame:3,sessions:4},gatewayHealth:{at:0,ms:7}};
 return {hub,st,on:ev.on.bind(ev),off:ev.off.bind(ev),emit:ev.emit.bind(ev),
  status:()=>({components:[{...st.server},{name:'gateway',state:'running'}],players:st.players,gatewayHealth:st.gatewayHealth,watchdog:{enabled:true}})};
}
function fakeCpu(){let cpu=0;return {add:ms=>{cpu+=ms;},sample:async pid=>pid===4242?{cpuMs:cpu,memBytes:512*1048576}:null,cpuMs:async()=>cpu,close(){}};}

test('metrics: a row a minute from status and events, kept across a restart, 24 h and 7-day views, markers and stats',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-metrics-')),clock={t:Date.parse('2026-10-24T10:00:30Z')};
 try{
  const host=fakeHost(clock),cpu=fakeCpu();
  let m=createHostMetrics({host,cpu,dir,now:()=>clock.t,autoStart:false});
  await m.tick(); // first reading: CPU needs a previous sample, so it is empty this minute
  for(let i=0;i<10;i++){
   clock.t+=MIN;cpu.add(30e3); // half of one core
   if(i===3){host.hub.push('server','file','NullReferenceException: boom');host.hub.push('server','file','fine');}
   if(i===4){host.emit('players',{inGame:9,sessions:10});host.emit('players',{inGame:5,sessions:5});}
   if(i===5){host.emit('watchdog',{state:'ok',probe:{ok:true,ms:4,at:clock.t-2000}});host.emit('watchdog',{state:'hung',probe:null});host.emit('watchdog',{state:'hung',probe:null});host.st.server.restarts=1;}
   if(i===6){host.st.server.state='backoff';}
   await m.tick();
  }
  m.stop();
  const file=readdirSync(dir).find(f=>f.endsWith('.csv'));assert.match(file,/^v1-2026-10-24\.csv$/);
  assert.equal(readFileSync(join(dir,file),'utf8').trim().split('\n').length,11);
  // A new instance (the host restarted) reads what is on disk and appends to the same day.
  m=createHostMetrics({host,cpu,dir,now:()=>clock.t,autoStart:false});
  clock.t+=MIN;await m.tick();
  const d=m.query('24h');
  assert.equal(d.step,MIN);assert.equal(d.series.players.length,1440);
  const at=t=>Math.floor((t-d.from)/d.step),last=at(clock.t);
  const minute=k=>d.series[k].slice(last-11,last+1);
  assert.equal(minute('players').filter(v=>v!=null).length,12);
  assert.equal(minute('players')[5],9,'the busiest moment of the minute counts');
  assert.equal(minute('sessions')[5],10);
  assert.equal(minute('cpu')[0],null);assert.equal(minute('cpu')[3],50);
  assert.equal(minute('memMb')[3],512);
  assert.equal(minute('errors')[4],1);assert.equal(minute('errors').reduce((a,b)=>a+(b??0),0),1);
  assert.equal(minute('udpMs')[6],4);assert.equal(minute('gwMs')[2],7);
  assert.equal(minute('freezes')[6],1,'one freeze, however many hung verdicts');
  assert.equal(minute('restarts')[6],1);
  assert.equal(minute('up')[7],0);
  assert.deepEqual(d.events.map(e=>e.kind),['freeze'],'the restart after a freeze is the freeze marker');
  assert.equal(d.stats.peakPlayers,9);assert.equal(d.stats.freezes,1);assert.equal(d.stats.restarts,1);
  assert.equal(d.stats.minutes,12);assert.equal(d.stats.uptimePct,Math.round(1000*(12-5)/12)/10); // down from i=6 on (the fake stays in backoff)
  assert.equal(d.series.players[0],null,'minutes before the first row are gaps, not zeros');
  // 7 days: ten-minute buckets, the peak kept for players, counts summed.
  const w=m.query('7d');
  assert.equal(w.step,10*MIN);assert.equal(w.series.players.length,7*144);
  assert.equal(Math.max(...w.series.players.filter(v=>v!=null)),9);
  assert.equal(w.series.freezes.reduce((a,b)=>a+(b??0),0),1);
  assert.equal(w.events[0].t,d.events[0].t,'markers keep their minute in the 7-day view');
  assert.throws(()=>m.query('1y'),/range/);
  m.stop();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('metrics store: day files, old days pruned, a torn last line ignored; demo history is labelled',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-metrics-')),now=Date.parse('2026-10-24T12:00:00Z');
 try{
  const s=createMetricsStore({dir,now:()=>now});
  s.append({t:now-9*DAY,players:1});s.append({t:now-MIN,players:2,up:1});
  writeFileSync(join(dir,'v1-2026-10-24.csv'),readFileSync(join(dir,'v1-2026-10-24.csv'),'utf8')+String(now)+',3,'); // the host died mid-write
  assert.deepEqual(s.read(now-DAY,now).map(r=>r.players),[2]);
  assert.equal(s.prune(),1);assert.equal(readdirSync(dir).length,1);
  assert.equal(METRIC_FIELDS[0],'players');
  seedDemoMetrics(dir,{now,days:7});
  const m=createHostMetrics({host:fakeHost({t:now}),cpu:fakeCpu(),dir,now:()=>now,autoStart:false});
  const w=m.query('7d');
  assert.ok(w.demoUntil>=now-2*MIN,'the page can say which part is demo data');
  assert.ok(w.stats.peakPlayers>0&&w.stats.freezes>=1&&w.events.length>=2);
  m.stop();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CPU sampler also reads memory (Linux /proc here; Windows reads the working set through the same PowerShell)',async()=>{
 const c=createCpuSampler(),s=await c.sample(process.pid);
 assert.ok(s.cpuMs>=0&&s.memBytes>10*1048576);assert.equal(await c.sample(2**30),null);
 assert.equal(typeof await c.cpuMs(process.pid),'number');c.close();
});
