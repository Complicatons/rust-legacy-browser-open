// Health metrics for the Health page (HOST-AND-LOADER-BUILD.md H6). Once a minute the host records players in game and
// browser sessions (the gateway's /healthz), the gateway's /healthz response time and the game server's UDP reply time,
// the server's CPU (% of one core) and memory, restarts, freezes and error lines in the log. Rows go to one append-only
// CSV per UTC day in <dataDir>/metrics (v1-<yyyy-mm-dd>.csv, about 60 KB a day), kept 8 days, so the 7-day view
// survives restarts. The 24 h view is the minutes themselves; the 7-day view is downsampled on read into 10-minute
// buckets (peak players, mean CPU/memory/response times, summed counts). GET /api/metrics?range=24h|7d.
import {appendFileSync,readFileSync,readdirSync,unlinkSync,mkdirSync,writeFileSync,openSync,readSync,closeSync,statSync} from 'node:fs';
import {join} from 'node:path';

export const METRIC_FIELDS=['players','sessions','cpu','memMb','gwMs','udpMs','restarts','freezes','errors','up'];
const MIN=60e3,DAY=86400e3,KEEP_DAYS=8;
export const RANGES={'24h':{step:MIN,n:1440},'7d':{step:10*MIN,n:7*144}};
// How each field folds into a 7-day bucket: the peak for players (a 10-minute average hides the evening rush), the mean
// for readings, the sum for counts.
const FOLD={players:'max',sessions:'max',cpu:'mean',memMb:'mean',gwMs:'mean',udpMs:'mean',restarts:'sum',freezes:'sum',errors:'sum',up:'mean'};
const dayOf=t=>new Date(t).toISOString().slice(0,10);
const fileOf=day=>`v1-${day}.csv`;
const num=v=>v===''||v==null?null:Number(v);

export function createMetricsStore({dir,now=()=>Date.now(),keepDays=KEEP_DAYS}){
 mkdirSync(dir,{recursive:true});
 const checked=new Set();
 return {
  dir,
  append(row){
   const f=join(dir,fileOf(dayOf(row.t)));
   // A host killed mid-write leaves a torn last line: start the next row on a line of its own (the torn one is ignored).
   let lead='';
   if(!checked.has(f)){checked.add(f);try{const size=statSync(f).size;if(size){const fd=openSync(f,'r'),b=Buffer.alloc(1);readSync(fd,b,0,1,size-1);closeSync(fd);if(b[0]!==10)lead='\n';}}catch{}}
   appendFileSync(f,lead+[row.t,...METRIC_FIELDS.map(k=>row[k]??'')].join(',')+'\n');
  },
  read(from,to){
   const out=[];
   for(let d=Date.parse(dayOf(from));d<to;d+=DAY){
    let text;try{text=readFileSync(join(dir,fileOf(dayOf(d))),'utf8');}catch{continue;}
    for(const line of text.split('\n')){
     const c=line.split(',');if(c.length!==METRIC_FIELDS.length+1)continue;
     const t=Number(c[0]);if(!Number.isFinite(t)||t<from||t>=to)continue;
     const r={t};METRIC_FIELDS.forEach((k,i)=>{r[k]=num(c[i+1]);});out.push(r);
    }
   }
   return out.sort((a,b)=>a.t-b.t);
  },
  prune(){let n=0;const cut=dayOf(now()-keepDays*DAY);for(const f of readdirSync(dir)){const m=/^v1-(\d{4}-\d{2}-\d{2})\.csv$/.exec(f);if(m&&m[1]<cut){try{unlinkSync(join(dir,f));n++;}catch{}}}return n;},
 };
}

// One series per field on a fixed grid ending at the current bucket; null where nothing was recorded (the host was off).
export function summarise(rows,{range,now,demoUntil=null}){
 const r=RANGES[range];if(!r)throw Error('range must be 24h or 7d');
 const end=Math.floor(now/r.step)*r.step+r.step,from=end-r.n*r.step;
 const series=Object.fromEntries(METRIC_FIELDS.map(k=>[k,new Array(r.n).fill(null)])),counts=Object.fromEntries(METRIC_FIELDS.map(k=>[k,new Array(r.n).fill(0)]));
 const events=[];let peak=null,peakAt=null,upN=0,upSum=0,cpuN=0,cpuSum=0;const totals={freezes:0,restarts:0,errors:0};
 for(const row of rows){
  if(row.t<from||row.t>=end)continue;
  const i=Math.floor((row.t-from)/r.step);
  for(const k of METRIC_FIELDS){
   const v=row[k];if(v==null)continue;
   const s=series[k],f=FOLD[k];
   if(f==='max')s[i]=s[i]==null?v:Math.max(s[i],v);
   else if(f==='sum')s[i]=(s[i]??0)+v;
   else{s[i]=(s[i]??0)+v;counts[k][i]++;}
  }
  if(row.freezes>0)events.push({t:row.t,kind:'freeze',n:row.freezes});
  // A caught freeze restarts the server too; only restarts beyond the freezes get their own marker.
  if(row.restarts>(row.freezes??0))events.push({t:row.t,kind:'restart',n:row.restarts-(row.freezes??0)});
  if(row.players!=null&&(peak==null||row.players>peak)){peak=row.players;peakAt=row.t;}
  if(row.up!=null){upN++;upSum+=row.up;}
  if(row.cpu!=null){cpuN++;cpuSum+=row.cpu;}
  for(const k of Object.keys(totals))totals[k]+=row[k]??0;
 }
 for(const k of METRIC_FIELDS)if(FOLD[k]==='mean')series[k]=series[k].map((v,i)=>v==null?null:Math.round(v/counts[k][i]*10)/10);
 return {range,from,to:end,step:r.step,now,series,events,demoUntil,
  stats:{peakPlayers:peak,peakAt,uptimePct:upN?Math.round(1000*upSum/upN)/10:null,minutes:rows.filter(x=>x.t>=from&&x.t<end).length,avgCpu:cpuN?Math.round(cpuSum/cpuN*10)/10:null,...totals}};
}

// host: {hub, on, status()}; cpu: the host's sampler (sample(pid) → {cpuMs, memBytes}, or cpuMs(pid) only).
export function createHostMetrics({host,cpu,dir,now=()=>Date.now(),everyMs=MIN,autoStart=true,log=()=>{}}){
 const store=createMetricsStore({dir,now});store.prune();
 const serverOf=st=>st.components?.find(c=>c.name==='server')??null;
 let errors=0,freezes=0,probes=[],playersMax=null,sessionsMax=null,prevState=null,prevCpu=null,timer=null,lastPrune=now();
 let restartsSeen=serverOf(host.status())?.restarts??0;
 const unsub=host.hub.subscribe(l=>{if(l.level==='error')errors++;});
 const onWatchdog=w=>{
  if(w?.probe?.ok&&w.probe.at!==probes.lastAt){probes.lastAt=w.probe.at;probes.push(w.probe.ms);}
  if(w?.state==='hung'&&prevState!=='hung')freezes++; // one freeze per hang, however many verdicts say so
  prevState=w?.state??null;
 };
 const onPlayers=p=>{if(!p)return;playersMax=Math.max(playersMax??0,p.inGame??0);sessionsMax=Math.max(sessionsMax??0,p.sessions??0);};
 host.on('watchdog',onWatchdog);host.on('players',onPlayers);
 const sample=async pid=>{try{if(cpu?.sample)return await cpu.sample(pid);const ms=await cpu?.cpuMs(pid);return ms==null?null:{cpuMs:ms,memBytes:null};}catch{return null;}};

 async function tick(){
  const t=now(),st=host.status(),sv=serverOf(st),row={t:Math.floor(t/MIN)*MIN};
  const pl=st.players;
  if(pl||playersMax!=null){row.players=Math.max(playersMax??0,pl?.inGame??0);row.sessions=Math.max(sessionsMax??0,pl?.sessions??0);}
  row.gwMs=st.gatewayHealth?.ms??null;
  row.udpMs=probes.length?Math.round(probes.reduce((a,b)=>a+b,0)/probes.length*10)/10:null;
  if(sv){
   const pid=sv.pid,s=pid?await sample(pid):null;
   if(s&&prevCpu&&prevCpu.pid===pid&&t>prevCpu.at)row.cpu=Math.max(0,Math.round((s.cpuMs-prevCpu.cpuMs)/(t-prevCpu.at)*1000)/10);
   if(s?.memBytes!=null)row.memMb=Math.round(s.memBytes/1048576);
   prevCpu=s?{pid,cpuMs:s.cpuMs,at:t}:null;
   row.restarts=Math.max(0,(sv.restarts??0)-restartsSeen);restartsSeen=sv.restarts??0;
   row.up=sv.state==='running'?1:0;
  }
  row.freezes=freezes;row.errors=errors;
  errors=0;freezes=0;probes=[];playersMax=null;sessionsMax=null;
  try{store.append(row);}catch(e){log('metrics: could not write '+e.message,'warn');}
  if(t-lastPrune>DAY){lastPrune=t;store.prune();}
  return row;
 }
 let demoUntil=null;try{demoUntil=Number(readFileSync(join(dir,'demo-until'),'utf8'))||null;}catch{}
 const m={
  tick,store,
  query(range){const r=RANGES[range];if(!r)throw Object.assign(Error('range must be 24h or 7d'),{status:400});const t=now();return summarise(store.read(t-r.n*r.step-r.step,t+MIN),{range,now:t,demoUntil});},
  start(){
   if(timer)return;
   // On the minute (plus a second, so the gateway health poll and the probe of that minute are in).
   const wait=MIN-now()%MIN+1000;
   timer=setTimeout(function next(){timer=setTimeout(next,everyMs);timer.unref?.();tick().catch(e=>log('metrics: '+e.message,'warn'));},wait);timer.unref?.();
  },
  stop(){clearTimeout(timer);timer=null;unsub();host.off?.('watchdog',onWatchdog);host.off?.('players',onPlayers);},
 };
 if(autoStart)m.start();
 return m;
}

// Demo history for `npm run host:demo` (host/demo.mjs): 7 days of plausible minutes ending now, an evening rush, two
// freezes and a crash, marked with <dir>/demo-until so the Health page labels it. Never written outside the demo.
export function seedDemoMetrics(dir,{now=Date.now(),days=7}={}){
 const s=createMetricsStore({dir,now:()=>now}),end=Math.floor(now/MIN)*MIN-MIN;
 let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 const freezesAt=new Set([end-5*DAY+3*3600e3,end-2*DAY+11*3600e3].map(t=>Math.floor(t/MIN)*MIN)),crashAt=Math.floor((end-9*3600e3)/MIN)*MIN;
 let down=0,lines=[];
 for(let t=end-days*DAY;t<=end;t+=MIN){
  const h=new Date(t).getUTCHours()+new Date(t).getUTCMinutes()/60,evening=Math.exp(-((h-20)**2)/8)+0.35*Math.exp(-((h-13)**2)/6);
  const freeze=freezesAt.has(t),crash=t===crashAt;
  if(freeze)down=2;if(crash)down=1;
  const up=down>0?0:1;if(down>0)down--;
  const players=up?Math.max(0,Math.round(2+22*evening+rnd()*3-1.5)):0;
  const row={t,players,sessions:Math.round(players*0.6+rnd()),cpu:up?Math.round((18+players*1.6+rnd()*3)*10)/10:null,memMb:up?Math.round(1450+players*9+rnd()*20):null,
   gwMs:Math.round((2.5+rnd()*0.6+players*0.08)*10)/10,udpMs:up?Math.round((1.2+rnd()*0.4+players*0.04)*10)/10:null,restarts:freeze||crash?1:0,freezes:freeze?1:0,errors:rnd()<0.02?1+Math.floor(rnd()*3):freeze?4:0,up};
  lines.push(row);
 }
 const byDay=new Map();for(const r of lines){const d=dayOf(r.t);byDay.set(d,(byDay.get(d)??'')+[r.t,...METRIC_FIELDS.map(k=>r[k]??'')].join(',')+'\n');}
 for(const [d,text] of byDay)appendFileSync(join(s.dir,fileOf(d)),text);
 writeFileSync(join(dir,'demo-until'),String(end));
 return lines.length;
}
