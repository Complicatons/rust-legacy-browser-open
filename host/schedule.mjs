// Scheduled restarts and wipes (HOST-AND-LOADER-BUILD.md H2). The owner's schedule lives in <dataDir>/schedule.json and
// is edited on the dashboard's Schedule page. Times are wall-clock times in the owner's time zone (an IANA name), so a
// 06:00 restart stays at 06:00 across daylight saving. Before each restart or wipe, players are warned in chat (the
// server plugin's broadcast) at 30, 15, 10, 5 and 1 minutes and 10 s by default, unless nobody is online. Then the
// server saves and quits (host/server-control.mjs); a wipe moves the world save, its .old.N rotation and the save
// guard's copies of the old world into backups/wipe-<time>/ (a full wipe also the characters in userdata/), archived and
// never deleted; and the server starts again. A restart is skipped when the server is not running (the owner stopped
// it). History and the last wipe are kept in <dataDir>/schedule-state.json.
//
// Wipe rules, deliberately few: {every: 'month', nth: 1..4 | -1 (last), weekday: 'thu', time: '18:00'}, or
// {every: 'days' | 'weeks', n, from: 'YYYY-MM-DD', time} (every n days or weeks counted from that date).
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync,readdirSync,cpSync,rmSync} from 'node:fs';
import {join,basename,dirname} from 'node:path';
import {stamp} from './save-guard.mjs';

const WEEKDAYS=['sun','mon','tue','wed','thu','fri','sat'];
const DAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],NTH={1:'First',2:'Second',3:'Third',4:'Fourth',[-1]:'Last'};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const localZone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}};
export const DEFAULT_SCHEDULE=Object.freeze({timeZone:localZone(),restarts:{enabled:false,times:['06:00']},
 wipe:{enabled:false,type:'world',rule:{every:'month',nth:1,weekday:'thu',time:'18:00'}},warnings:[1800,900,600,300,60,10],skipWarningsWhenEmpty:true});
const KEEP_HISTORY=50,MAX_MINUTES=180;
const HHMM=/^([01]\d|2[0-3]):([0-5]\d)$/,DATE=/^(\d{4})-(\d{2})-(\d{2})$/;
const err=(status,message)=>Object.assign(Error(message),{status});

// ---------- Rules ----------
const validZone=tz=>{if(typeof tz!=='string'||!tz||tz.length>64)return false;try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true;}catch{return false;}};
const validDate=v=>{const m=DATE.exec(v??'');if(!m)return false;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3];};
const bool=v=>typeof v==='boolean';
// {errors, schedule}: schedule is the cleaned copy (sorted times and warnings), only meaningful without errors.
export function validateSchedule(input){
 const e=[],s=input&&typeof input==='object'?input:{};
 if(!validZone(s.timeZone))e.push(`timeZone must be a time zone name like Europe/London (got ${JSON.stringify(s.timeZone)})`);
 const r=s.restarts??{},times=Array.isArray(r.times)?r.times:null;
 if(!bool(r.enabled))e.push('restarts.enabled must be true or false');
 if(!times||times.length>6)e.push('restarts.times must be a list of up to 6 times');
 else{for(const t of times)if(!HHMM.test(t))e.push(`restart time ${JSON.stringify(t)} must be HH:MM (00:00 to 23:59)`);if(new Set(times).size!==times.length)e.push('restart times must not repeat');}
 if(r.enabled&&times&&!times.length)e.push('turn restarts off, or add a time');
 const w=s.wipe??{},rule=w.rule??{};
 if(!bool(w.enabled))e.push('wipe.enabled must be true or false');
 if(!['world','full'].includes(w.type))e.push('wipe.type must be "world" (map) or "full" (map and characters)');
 if(!HHMM.test(rule.time??''))e.push('wipe time must be HH:MM');
 if(rule.every==='month'){
  if(![1,2,3,4,-1].includes(rule.nth))e.push('wipe nth must be 1, 2, 3, 4 or -1 (last)');
  if(!WEEKDAYS.includes(rule.weekday))e.push(`wipe weekday must be one of ${WEEKDAYS.join(', ')}`);
 }else if(rule.every==='days'||rule.every==='weeks'){
  const max=rule.every==='days'?90:12;
  if(!Number.isInteger(rule.n)||rule.n<1||rule.n>max)e.push(`wipe n must be 1..${max} ${rule.every}`);
  if(!validDate(rule.from))e.push('wipe from must be a date YYYY-MM-DD');
 }else e.push('wipe.rule.every must be "month", "weeks" or "days"');
 const warn=Array.isArray(s.warnings)?s.warnings:null;
 if(!warn||warn.length>10||warn.some(x=>!Number.isInteger(x)||x<1||x>3600))e.push('warnings must be up to 10 times in seconds, 1..3600');
 if(!bool(s.skipWarningsWhenEmpty))e.push('skipWarningsWhenEmpty must be true or false');
 const clean=e.length?null:{timeZone:s.timeZone,restarts:{enabled:r.enabled,times:[...times].sort()},
  wipe:{enabled:w.enabled,type:w.type,rule:rule.every==='month'?{every:'month',nth:rule.nth,weekday:rule.weekday,time:rule.time}:{every:rule.every,n:rule.n,from:rule.from,time:rule.time}},
  warnings:[...new Set(warn)].sort((a,b)=>b-a),skipWarningsWhenEmpty:s.skipWarningsWhenEmpty};
 return {errors:e,schedule:clean};
}

// ---------- Time zones (Intl only, no dependency) ----------
const fmts=new Map();
function parts(t,tz){
 let f=fmts.get(tz);
 if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',weekday:'short'});fmts.set(tz,f);}
 const o={};for(const p of f.formatToParts(t))o[p.type]=p.value;
 return {y:+o.year,m:+o.month,d:+o.day,h:+o.hour%24,min:+o.minute,s:+o.second,wd:WEEKDAYS.indexOf(o.weekday.slice(0,3).toLowerCase())};
}
const offsetAt=(t,tz)=>{const p=parts(t,tz);return Date.UTC(p.y,p.m-1,p.d,p.h,p.min,p.s)-Math.floor(t/1000)*1000;};
// The instant of a wall-clock time in tz. A time the clocks skip (spring forward) lands just after the gap; a time they
// repeat (fall back) happens once, at one of the two.
export function zonedInstant(y,m,d,h,min,tz){
 const guess=Date.UTC(y,m-1,d,h,min),o1=offsetAt(guess,tz),t=guess-o1,o2=offsetAt(t,tz);
 if(o1===o2)return t;
 const t2=guess-o2;return offsetAt(t2,tz)===o2?t2:guess-Math.min(o1,o2);
}
export function formatZoned(t,tz){const p=parts(t,tz),pad=n=>String(n).padStart(2,'0');return `${DAY_NAMES[p.wd].slice(0,3)} ${p.d} ${MONTHS[p.m-1]}, ${pad(p.h)}:${pad(p.min)}`;}
const calendar=(y,m,d)=>{const x=new Date(Date.UTC(y,m-1,d));return {y:x.getUTCFullYear(),m:x.getUTCMonth()+1,d:x.getUTCDate()};};
const at=(c,time,tz)=>{const [h,min]=time.split(':').map(Number);return zonedInstant(c.y,c.m,c.d,h,min,tz);};

export function nextRestart(s,now){
 if(!s.restarts.enabled||!s.restarts.times.length)return null;
 const p=parts(now,s.timeZone);let best=null;
 for(let k=0;k<=2;k++){const c=calendar(p.y,p.m,p.d+k);for(const time of s.restarts.times){const t=at(c,time,s.timeZone);if(t>now&&(best===null||t<best))best=t;}}
 return best===null?null:{at:best};
}
export function nextWipe(s,now){
 if(!s.wipe.enabled)return null;
 const r=s.wipe.rule,tz=s.timeZone,p=parts(now,tz);
 if(r.every==='month'){
  const wd=WEEKDAYS.indexOf(r.weekday);
  for(let k=0;k<=13;k++){
   const first=calendar(p.y,p.m+k,1);let day;
   if(r.nth>0)day=1+((wd-new Date(Date.UTC(first.y,first.m-1,1)).getUTCDay()+7)%7)+(r.nth-1)*7;
   else{const last=new Date(Date.UTC(first.y,first.m,0)).getUTCDate();day=last-((new Date(Date.UTC(first.y,first.m-1,last)).getUTCDay()-wd+7)%7);}
   const t=at({...first,d:day},r.time,tz);if(t>now)return {at:t};
  }
  return null;
 }
 const [fy,fm,fd]=r.from.split('-').map(Number),period=r.n*(r.every==='weeks'?7:1);
 const diff=Math.round((Date.UTC(p.y,p.m-1,p.d)-Date.UTC(fy,fm-1,fd))/864e5),k0=Math.max(0,Math.floor(diff/period));
 for(let k=k0;k<=k0+2;k++){const t=at(calendar(fy,fm,fd+k*period),r.time,tz);if(t>now)return {at:t};}
 return null;
}
const lead=s=>(s.warnings[0]??0)*1000;
// The next restart or wipe after now, skipping instants in skip (cancelled ones). A restart that would fall inside a
// wipe's countdown (or a minute after it) is left out: the wipe restarts the server anyway.
export function nextEvent(s,now,skip=new Set()){
 let r=nextRestart(s,now);while(r&&skip.has(r.at))r=nextRestart(s,r.at);
 let w=nextWipe(s,now);while(w&&skip.has(w.at))w=nextWipe(s,w.at);
 while(r&&w&&r.at>=w.at-lead(s)&&r.at<=w.at+60e3){r=nextRestart(s,r.at);while(r&&skip.has(r.at))r=nextRestart(s,r.at);}
 const pick=w&&(!r||w.at<=r.at)?{kind:'wipe',wipe:s.wipe.type,at:w.at}:r?{kind:'restart',wipe:null,at:r.at}:null;
 return pick;
}
export function describeRule(r){
 if(r.every==='month')return `${NTH[r.nth]} ${DAY_NAMES[WEEKDAYS.indexOf(r.weekday)]} of each month at ${r.time}`;
 const [y,m,d]=r.from.split('-').map(Number),unit=r.every==='weeks'?'week':'day';
 return `Every ${r.n===1?unit:`${r.n} ${unit}s`} from ${d} ${MONTHS[m-1]} ${y} at ${r.time}`;
}

// ---------- Wipe archive ----------
// Rename, or copy then remove across drives (the data folder and the server folder may be on different disks).
function move(src,dst){try{renameSync(src,dst);}catch(e){if(e.code!=='EXDEV')throw e;cpSync(src,dst,{recursive:true});rmSync(src,{recursive:true,force:true});}}
// The server must be stopped (the scheduler checks). World: <map>.sav and every <map>.sav.* (rotation, leftovers) plus
// the save guard's last-good copies of that world; full: also userdata/ (characters). Returns {name, dir, moved}.
export function archiveWipe({savePath,userdataDir,backupDir,type,now=Date.now()}){
 let name='wipe-'+stamp(now),n=1;while(existsSync(join(backupDir,name)))name=`wipe-${stamp(now)}-${++n}`;
 const dir=join(backupDir,name),base=basename(savePath),src=dirname(savePath),moved=[];
 mkdirSync(dir,{recursive:true});
 for(const f of existsSync(src)?readdirSync(src):[])if(f===base||f.startsWith(base+'.')){move(join(src,f),join(dir,f));moved.push(f);}
 if(existsSync(join(backupDir,'last-good'))){move(join(backupDir,'last-good'),join(dir,'last-good'));moved.push('last-good/');}
 if(type==='full'&&userdataDir&&existsSync(userdataDir)){move(userdataDir,join(dir,'userdata'));moved.push('userdata/');}
 writeFileSync(join(dir,'wipe.json'),JSON.stringify({at:now,type,moved},null,1));
 return {name,dir,moved};
}

// ---------- Scheduler ----------
const what=p=>p.wipe==='full'?'Server restart and full wipe (map and characters)':p.wipe?'Server restart and map wipe':'Server restart';
const inText=ms=>{if(ms>=55e3){const m=Math.max(1,Math.round(ms/60e3));return `${m} minute${m===1?'':'s'}`;}const s=Math.max(1,Math.round(ms/1e3));return `${s} second${s===1?'':'s'}`;};
const readJson=f=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return null;}};
const writeJson=(f,v)=>{mkdirSync(dirname(f),{recursive:true});writeFileSync(f+'.tmp',JSON.stringify(v,null,1));renameSync(f+'.tmp',f);};

// server: {state(), stop(), start(), broadcast(text), players() → number | null (unknown)}, or null without a game server.
// files: {savePath, userdataDir, backupDir}.
// onDone(entry): each restart or wipe that ran (done, skipped or failed), once it is over; the host sends it as an alert.
export function createScheduler({dataDir,server,files,now=()=>Date.now(),log=()=>{},everyMs=1000,onDone=()=>{}}){
 const file=join(dataDir,'schedule.json'),stateFile=join(dataDir,'schedule-state.json');
 let schedule={...DEFAULT_SCHEDULE};
 const stored=readJson(file);
 if(stored){const v=validateSchedule(stored);if(v.errors.length)log(`schedule.json is not valid, so nothing is scheduled: ${v.errors.join('; ')}`,'warn');else schedule=v.schedule;}
 const saved=readJson(stateFile)??{};
 const st={history:Array.isArray(saved.history)?saved.history.slice(-KEEP_HISTORY):[],lastWipe:saved.lastWipe??null,cancelled:Array.isArray(saved.cancelled)?saved.cancelled:[]};
 let pending=null,running=null,runPromise=null,timer=null,ticking=false;
 const persist=()=>{st.cancelled=st.cancelled.filter(t=>t>now()-86400e3);writeJson(stateFile,st);};
 const record=e=>{st.history.push(e);if(st.history.length>KEEP_HISTORY)st.history.splice(0,st.history.length-KEEP_HISTORY);persist();};
 const label=p=>p.wipe?`${p.wipe==='full'?'Full':'Map'} wipe`:'Restart';

 // Chat to everyone, unless nobody is online (unknown counts as someone). False when nothing was sent.
 async function say(p,text){
  if(schedule.skipWarningsWhenEmpty&&server.players()===0){if(!p.quietNoted){p.quietNoted=true;log(`${label(p)} at ${formatZoned(p.at,schedule.timeZone)}: nobody is online, so no warnings`);}return false;}
  try{await server.broadcast(text);return true;}catch(e){log(`Could not warn players (${e.message})`,'warn');return false;}
 }
 // Warnings already past when a countdown starts are not sent; the smallest due one is, with the real time left.
 async function warn(p){
  const t=now(),due=schedule.warnings.filter(w=>!p.sent.includes(w)&&t>=p.at-w*1000);
  if(!due.length||p.at<=t)return;
  p.sent.push(...due);
  if(await say(p,`${what(p)} in ${inText(p.at-t)}.`))p.warned=true;
 }
 async function execute(p){
  running={...p,startedAt:now()};pending=null;
  const entry={at:now(),scheduledFor:p.at,kind:p.wipe?'wipe':'restart',wipe:p.wipe??null,by:p.by,outcome:'done',note:null};
  try{
   const s0=server.state(),up=s0==='running'||s0==='starting';
   if(!up&&!p.wipe){entry.outcome='skipped';entry.note='the game server was not running';log(`${label(p)} skipped: the game server was not running`);return;}
   if(up){
    log(`${label(p)} (${p.by==='schedule'?'scheduled':`by the ${p.by}`}): saving and stopping the game server`,p.wipe?'warn':'info');
    await server.stop();
    const s1=server.state();if(s1!=='stopped'&&s1!=='failed')throw Error(`the game server did not stop (${s1})`);
   }
   if(p.wipe){
    const a=archiveWipe({...files,type:p.wipe,now:now()});
    entry.archive=a.name;entry.moved=a.moved;st.lastWipe={at:now(),type:p.wipe,archive:a.name};
    log(`${label(p)}: moved ${a.moved.join(', ')||'nothing (no save yet)'} to ${a.dir}`,'warn');
   }
   if(up){
    await server.start();
    const s2=server.state();if(s2!=='running'&&s2!=='starting')throw Error(`the game server did not start again (${s2})`);
    log(`${label(p)} done: the game server is starting`);
   }else entry.note='the game server was stopped, so it was not started';
  }catch(e){entry.outcome='failed';entry.note=e.message;log(`${label(p)} failed: ${e.message}`,'error');}
  finally{entry.durationMs=now()-entry.at;running=null;record(entry);try{onDone(entry);}catch{}}
 }
 async function tick(){
  if(!server||running||ticking)return;
  ticking=true;
  try{
   if(!pending){
    const next=nextEvent(schedule,now(),new Set(st.cancelled));
    if(next&&now()>=next.at-lead(schedule))pending={...next,by:'schedule',sent:[]};
   }
   if(!pending)return;
   await warn(pending);
   if(now()>=pending.at){const p=pending;runPromise=execute(p);await runPromise;}
  }finally{ticking=false;}
 }
 const view=p=>p&&{kind:p.wipe?'wipe':'restart',wipe:p.wipe??null,at:p.at,local:formatZoned(p.at,schedule.timeZone),by:p.by,warned:Boolean(p.warned),remainingMs:Math.max(0,p.at-now())};
 const sched={
  tick,
  idle:async()=>{while(ticking||running)await (running?runPromise:new Promise(r=>setTimeout(r,20)));},
  status(){
   const n=now(),r=server?nextRestart(schedule,n):null,w=server?nextWipe(schedule,n):null;
   return {configured:Boolean(server),schedule,timeZone:schedule.timeZone,nowLocal:formatZoned(n,schedule.timeZone),
    next:{restart:r&&{at:r.at,local:formatZoned(r.at,schedule.timeZone)},wipe:w&&{at:w.at,local:formatZoned(w.at,schedule.timeZone),type:schedule.wipe.type,rule:describeRule(schedule.wipe.rule)}},
    rule:describeRule(schedule.wipe.rule),pending:view(pending),running:view(running),lastWipe:st.lastWipe,history:st.history.slice().reverse()};
  },
  // For host.status() (and so the website's relay report): what is next, what is counting down, the last wipe.
  summary(){
   if(!server)return null;
   const next=nextEvent(schedule,now(),new Set(st.cancelled));
   return {next:next&&{kind:next.kind,wipe:next.wipe,at:next.at},pending:pending&&{kind:pending.wipe?'wipe':'restart',wipe:pending.wipe??null,at:pending.at},
    lastWipe:st.lastWipe&&{at:st.lastWipe.at,type:st.lastWipe.type}};
  },
  // A wipe schedule needs confirmWipe whenever it is turned on or its type or rule changes.
  async save(input,{confirmWipe=false,by='owner'}={}){
   const v=validateSchedule(input);if(v.errors.length)throw Object.assign(err(400,v.errors.join('; ')),{errors:v.errors});
   const s=v.schedule,o=schedule;
   if(s.wipe.enabled&&(!o.wipe.enabled||o.wipe.type!==s.wipe.type||JSON.stringify(o.wipe.rule)!==JSON.stringify(s.wipe.rule))&&confirmWipe!==true)
    throw err(428,`Confirm the wipe schedule: ${describeRule(s.wipe.rule).toLowerCase()} the ${s.wipe.type==='full'?'map and every character':'map'} is wiped`);
   writeJson(file,s);schedule=s;
   log(`Schedule saved by the ${by}: restarts ${s.restarts.enabled?s.restarts.times.join(', '):'off'}; wipes ${s.wipe.enabled?`${describeRule(s.wipe.rule).toLowerCase()} (${s.wipe.type})`:'off'}; ${s.timeZone}`);
   // A countdown from the old schedule that the new one no longer has is called off.
   if(pending?.by==='schedule'){const n=nextEvent(s,now(),new Set(st.cancelled));if(!n||n.at!==pending.at||n.wipe!==pending.wipe){const p=pending;pending=null;if(p.warned)await say(p,'The server restart is cancelled.');}}
   return sched.status();
  },
  // Restart (and optionally wipe) in minutes, with the warnings that still fit; 0 runs it now.
  async restartIn(minutes,{wipe=null,confirm=false,by='owner'}={}){
   if(!server)throw err(404,'no game server in host.json');
   if(!Number.isInteger(minutes)||minutes<0||minutes>MAX_MINUTES)throw err(400,`minutes must be a whole number from 0 to ${MAX_MINUTES}`);
   if(wipe!==null&&!['world','full'].includes(wipe))throw err(400,'wipe must be "world" or "full"');
   if(wipe&&confirm!==true)throw err(428,`Confirm the ${wipe==='full'?'full wipe (map and characters)':'map wipe'}`);
   if(running)throw err(409,'A restart is running right now');
   const t=now(),p={kind:wipe?'wipe':'restart',wipe,at:t+minutes*60e3,by,sent:schedule.warnings.filter(w=>w*1000>=minutes*60e3),manual:true};
   if(pending?.by==='schedule')st.cancelled.push(pending.at);
   pending=p;
   log(`${label(p)} in ${minutes} min, by the ${by}`,wipe?'warn':'info');
   if(minutes>0&&await say(p,`${what(p)} in ${inText(p.at-t)}.`))p.warned=true;
   if(minutes===0)tick();
   return sched.status();
  },
  async cancel({by='owner'}={}){
   if(!pending)throw err(409,'Nothing to cancel: no restart is counting down');
   const p=pending;pending=null;
   if(!p.manual)st.cancelled.push(p.at);
   if(p.warned)await say(p,'The server restart is cancelled.');
   log(`${label(p)} at ${formatZoned(p.at,schedule.timeZone)} cancelled by the ${by}`);
   record({at:now(),scheduledFor:p.at,kind:p.wipe?'wipe':'restart',wipe:p.wipe??null,by,outcome:'cancelled',note:null});
   return sched.status();
  },
  start(){if(!timer&&server){timer=setInterval(()=>tick().catch(e=>log('schedule error: '+e.message,'error')),everyMs);timer.unref?.();}return sched;},
  stop(){clearInterval(timer);timer=null;},
 };
 return sched;
}
