// One supervised child process (HOST-APP-PLAN.md "Crash handling"). States: stopped → starting → running → stopping →
// stopped; an exit nobody asked for is a crash: backoff (2 s, 4 s, … 60 s) and start again, or failed after
// maxCrashes within windowMs. Processes are spawned without a shell, with argument arrays.
// spec: {name, command, args, cwd, env?, ready?: async () => bool, readyTimeoutMs?,
//        gracefulStop?: {stdin: 'quit\n'} | {run: async (child|null, {reason, pid}) → ms to wait for the exit, or 0/false to
//        kill now} (the game server's save-and-quit, host/server-control.mjs; child is null for an adopted process),
//        preStart?: async () => void (throw to refuse), onSpawn?(child), onExit?(info), onAdopt?(pid),
//        stoppedOutside?(pid) → true when a script (06/15) stopped this PID on purpose: not a crash}
// A process started outside the host (by the deploy/host-test scripts) can be adopted: watched, shown, and stopped
// when its identity was verified. The host never restarts an adopted process that exits by itself, except one its own
// start made (startExternal: the boot task started it for the host), which crashes and restarts like a child.
import {spawn as nodeSpawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
import {lineSplitter} from './log-hub.mjs';
import {killTree as nodeKillTree,pidAlive as nodePidAlive} from './proc-stats.mjs';

export const STATES=['stopped','starting','running','stopping','backoff','failed'];

export function createProcess(spec,{hub,spawn=nodeSpawn,killTree=nodeKillTree,now=()=>Date.now(),stopTimeoutMs=10000,
 backoff={baseMs:2000,maxMs:60000,maxCrashes:5,windowMs:600000,resetAfterMs:600000},readyPollMs=1000,pidAlive=nodePidAlive,externalPollMs=1000}={}){
 const ev=new EventEmitter(),name=spec.name;
 let restarting=false,child=null,state='stopped',startedAt=null,crashes=[],restarts=0,lastExit=null,message='',timer=null,readyTimer=null,stopping=null,exitWaiters=[],external=null,externalTimer=null;
 const note=(text,level='info')=>hub?.push(name,'host',text,level);
 const set=(s,msg)=>{state=s;if(msg!==undefined)message=msg;ev.emit('state',info());};
 const info=()=>({name,state,pid:child?.pid??external?.pid??null,external:external?{verified:external.verified,by:external.by}:null,startedAt,uptimeMs:startedAt&&(state==='running'||state==='starting')?now()-startedAt:0,restarts,crashes:crashes.length,lastExit,message,...(restarting?{restarting:true}:{})});
 const clearTimers=()=>{clearTimeout(timer);timer=null;clearInterval(readyTimer);readyTimer=null;};

 // false when the crash budget is used up (state failed).
 function recordCrash(reason){
  const t=now();crashes=crashes.filter(c=>t-c<backoff.windowMs);crashes.push(t);
  if(crashes.length>=backoff.maxCrashes){set('failed',`${crashes.length} failures in ${Math.round(backoff.windowMs/60000)} min (${reason}); waiting for the owner`);note(`${name} failed: ${message}`,'error');return false;}
  return true;
 }
 function scheduleRestart(reason){
  if(!recordCrash(reason))return;
  const delay=Math.min(backoff.maxMs,backoff.baseMs*2**(crashes.length-1));
  set('backoff',`${reason}; restarting in ${Math.round(delay/1000)} s`);note(`${name} ${reason}; restarting in ${Math.round(delay/1000)} s`,'error');
  timer=setTimeout(()=>{timer=null;restarts++;launch().catch(()=>{});},delay);
 }

 async function launch(){
  clearTimers();
  try{
   await spec.preStart?.();
   // Windows reports a missing working folder as ENOENT for the program itself; say what is really missing.
   if(spec.cwd&&!spec.startExternal&&!existsSync(spec.cwd))throw Error(`folder not found: ${spec.cwd}`);
  }catch(e){set('failed',e.message);note(`${name} not started: ${e.message}`,'error');return false;}
  set('starting','');startedAt=now();
  // Started by something with the rights the host lacks (the original server's boot task): watch the process it made.
  if(spec.startExternal){
   let pid;try{pid=await spec.startExternal();}catch(e){startedAt=null;set('failed',e.message);note(`${name} not started: ${e.message}`,'error');return false;}
   state='stopped';if(p.adopt(pid,{verified:false,by:spec.startedBy??'its start task',own:true}))return true;
   set('failed','the process it started is gone');note(`${name} not started: the process it started is gone`,'error');return false;
  }
  let c;
  try{c=spawn(spec.command,spec.args??[],{cwd:spec.cwd,env:spec.env?{...process.env,...spec.env}:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});}
  catch(e){child=null;note(`${name} could not start: ${e.message}`,'error');scheduleRestart('could not start');return false;}
  child=c;
  const out=lineSplitter(l=>hub?.push(name,'out',l)),err=lineSplitter(l=>hub?.push(name,'err',l));
  c.stdout?.on('data',out);c.stderr?.on('data',err);
  c.stdin?.on('error',()=>{});
  let spawnError=null,exited=false;
  // A program that cannot be started (ENOENT, EACCES) emits 'error' and never 'exit'.
  c.on('error',e=>{spawnError=e;if(!c.pid)onExit(null,null);});
  c.on('exit',(code,signal)=>onExit(code,signal));
  function onExit(code,signal){
   if(exited)return;exited=true;
   out.flush();err.flush();clearTimers();
   const outside=!stopping&&c.pid&&spec.stoppedOutside?.(c.pid);
   const wanted=Boolean(stopping)||Boolean(outside),uptime=now()-startedAt;
   lastExit={code,signal,at:now(),wanted,reason:stopping?.reason??(outside?'stopped outside the host':spawnError?spawnError.message:null)};
   child=null;startedAt=null;
   spec.onExit?.(lastExit);
   for(const w of exitWaiters.splice(0))w();
   if(wanted){stopping=null;set('stopped',outside?'stopped outside the host':'');note(`${name} stopped${lastExit.reason&&lastExit.reason!=='stop'?` (${lastExit.reason})`:''}`);return;}
   if(uptime>=backoff.resetAfterMs)crashes=[];
   scheduleRestart(spawnError?`could not start (${spawnError.code??spawnError.message})`:`exited unexpectedly (code ${code??signal})`);
  }
  note(`${name} started${c.pid?` (PID ${c.pid})`:''}`);
  spec.onSpawn?.(c);
  if(!spec.ready){if(child===c)set('running');return true;}
  const deadline=now()+(spec.readyTimeoutMs??120000);
  readyTimer=setInterval(async()=>{
   if(child!==c||state!=='starting')return;
   let ok=false;try{ok=await spec.ready();}catch{}
   if(child!==c||state!=='starting')return;
   if(ok){clearInterval(readyTimer);readyTimer=null;set('running');note(`${name} ready after ${((now()-startedAt)/1000).toFixed(1)} s`);}
   else if(now()>deadline){clearInterval(readyTimer);readyTimer=null;set('running','not answering yet');note(`${name} is running but did not answer its readiness check within ${Math.round((spec.readyTimeoutMs??120000)/1000)} s`,'warn');}
  },readyPollMs);
  return true;
 }

 function externalExit(){
  clearInterval(externalTimer);externalTimer=null;
  const e=external,outside=!stopping&&spec.stoppedOutside?.(e.pid),wanted=Boolean(stopping)||Boolean(outside),uptime=now()-startedAt;
  external=null;startedAt=null;
  lastExit={code:null,signal:null,at:now(),wanted,reason:stopping?.reason??(outside?'stopped outside the host':'exited')};
  spec.onExit?.(lastExit);
  for(const w of exitWaiters.splice(0))w();
  if(stopping){stopping=null;set('stopped','');note(`${name} stopped`);return;}
  if(outside){set('stopped','stopped outside the host');note(`${name} stopped outside the host (PID ${e.pid})`);return;}
  // The host's own start (the boot task): a crash, restarted with backoff as for a child (found on the Azure VM,
  // 2026-10-26: the server exited and stayed down for three days).
  if(e.own){if(uptime>=backoff.resetAfterMs)crashes=[];scheduleRestart('exited unexpectedly');return;}
  set('stopped',`exited unexpectedly; it was started ${e.by}, so the host does not restart it`);
  note(`${name} (PID ${e.pid}, started ${e.by}) exited unexpectedly`,'error');
 }

 const p={
  name,spec,on:ev.on.bind(ev),off:ev.off.bind(ev),info,
  get state(){return state;},get child(){return child;},get external(){return external;},
  // Watch a process the host did not start. verified: its program/command line matched this part.
  adopt(pid,{verified=false,by='outside the host',own=false}={}){
   if(child||external||state==='starting'||state==='running'||state==='stopping'||!pidAlive(pid))return false;
   clearTimers();external={pid,verified,by,own};startedAt=now();
   set('running',verified?`started ${by}`:`started ${by}; not verified, so stop it the way it was started`);
   note(`${name} found running, started ${by} (PID ${pid}${verified?'':', not verified'})`);
   spec.onAdopt?.(pid);
   externalTimer=setInterval(()=>{if(!pidAlive(pid))externalExit();},externalPollMs);externalTimer.unref?.();
   return true;
  },
  async start(){
   if(state==='starting'||state==='running'||state==='stopping')return false;
   if(state==='failed'||state==='stopped')crashes=[];
   return launch();
  },
  // reason is recorded in lastExit ('stop', 'restart', 'hang', ...).
  async stop({reason='stop'}={}){
   clearTimers();
   if(external){
    // An unverified process is never killed from here, but it may still be asked to save and quit through its plugin.
    const run=reason!=='hang'?spec.gracefulStop?.run:null,e=external;
    if(!e.verified&&!run)throw Error(`${name} was started ${e.by} and could not be verified; stop it the way it was started`);
    if(stopping)return new Promise(r=>exitWaiters.push(r));
    const pid=e.pid,exited=new Promise(r=>exitWaiters.push(r)),within=ms=>Promise.race([exited.then(()=>true),new Promise(r=>setTimeout(()=>r(false),ms))]);
    stopping={reason};set('stopping','');note(`${name} stopping (${reason}; PID ${pid}, started ${e.by})`);
    let gone=false;
    if(run){let wait=0;try{wait=await Promise.race([run(null,{reason,pid}),exited.then(()=>-1)]);}catch(x){note(`${name}: save-and-quit failed: ${x.message}`,'warn');}gone=wait===-1||(wait>0&&await within(wait));}
    if(!gone&&!e.verified){stopping=null;set('running',`started ${e.by}; not verified, so stop it the way it was started`);throw Error(`${name} was started ${e.by} and could not be verified; stop it the way it was started`);}
    if(!gone){try{await killTree(pid);}catch{}gone=await within(stopTimeoutMs);}
    if(!gone){stopping=null;set('running','could not stop it (another account owns it?); stop it the way it was started');throw Error(`${name} did not stop`);}
    return;
   }
   if(!child){if(state!=='stopped')set('stopped','');return;}
   if(stopping)return new Promise(r=>exitWaiters.push(r));
   stopping={reason};set('stopping','');note(`${name} stopping (${reason})`);
   const c=child,exited=new Promise(r=>exitWaiters.push(r));
   // Save-and-quit first when the part has one (never after a hang: a frozen server cannot save); it says how long to
   // wait for the exit, or 0 when it could not ask, and then the process is killed as before.
   const run=reason!=='hang'?spec.gracefulStop?.run:null;
   let wait=0;
   if(run){try{wait=await Promise.race([run(c,{reason,pid:c.pid}),exited.then(()=>-1)]);}catch(e){note(`${name}: save-and-quit failed: ${e.message}`,'warn');}}
   const graceful=!run&&spec.gracefulStop?.stdin&&reason!=='hang';
   if(graceful){try{c.stdin.write(spec.gracefulStop.stdin);}catch{}}
   else if(!(wait>0)&&wait!==-1&&child===c){try{await killTree(c.pid);}catch{}}
   const waitMs=wait>0?wait:graceful?stopTimeoutMs:Math.min(stopTimeoutMs,3000);
   const t=setTimeout(async()=>{if(child===c){note(`${name} did not stop within ${Math.round(waitMs/1000)} s; killing it`,'warn');await killTree(c.pid);}},waitMs);
   await exited;clearTimeout(t);
  },
  // restarting: true while a restart runs, so the 'stopped' between its stop and start is not read as the end state.
  async restart(){restarts++;restarting=true;try{await p.stop({reason:'restart'});}finally{restarting=false;}return p.start();},
  recordCrash,
  // After a hang: the caller stopped the process and repaired the save; start again unless the budget is used up.
  async restartAfterFailure(reason){if(!recordCrash(reason))return false;restarts++;return launch();},
 };
 return p;
}
