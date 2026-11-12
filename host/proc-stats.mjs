// Total CPU time of a process, for the hang watchdog. Windows: one long-lived PowerShell answers PIDs written to its
// stdin (spawning one per sample would cost ~300 ms of CPU every few seconds). Elsewhere: /proc/<pid>/stat.
// A process of another account (the original server under the SYSTEM boot task) gives the service account its memory
// but no CPU time through a handle (always 0 on the Azure VM, 2026-10-29), so the CPU then comes from WMI's snapshot.
// cpuMs(pid) resolves to milliseconds, or null when the process is gone or not readable. sample(pid) also gives the
// memory in use (Windows: the working set, as Task Manager shows it; Linux: VmRSS) for the Health page.
import {spawn,execFile} from 'node:child_process';
import {readFileSync,readlinkSync} from 'node:fs';

const PS_LOOP=`$ErrorActionPreference='SilentlyContinue'
while(($l=[Console]::In.ReadLine()) -ne $null){
 $v=-1;$m=-1
 try{$p=[Diagnostics.Process]::GetProcessById([int]$l);$m=[int64]$p.WorkingSet64;$v=[int64]$p.TotalProcessorTime.TotalMilliseconds}catch{}
 if($v -le 0){try{$c=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$l)";if($c){$v=[int64](([uint64]$c.KernelModeTime+[uint64]$c.UserModeTime)/10000);if($m -lt 0){$m=[int64]$c.WorkingSetSize}}}catch{}}
 [Console]::Out.WriteLine("$l $v $m");[Console]::Out.Flush()
}`;

export function createCpuSampler({platform=process.platform,timeoutMs=5000}={}){
 if(platform!=='win32'){
  const hz=100; // USER_HZ on every Linux build the server could run beside
  const cpuMs=async pid=>{try{const f=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ');return (Number(f[11])+Number(f[12]))*1000/hz;}catch{return null;}};
  const memBytes=pid=>{try{const m=/^VmRSS:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/status`,'utf8'));return m?Number(m[1])*1024:null;}catch{return null;}};
  return {cpuMs,async sample(pid){const c=await cpuMs(pid);return c==null?null:{cpuMs:c,memBytes:memBytes(pid)};},close(){}};
 }
 let ps=null,buf='';const waiting=[];
 const start=()=>{
  ps=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',PS_LOOP],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);const [pid,v,m]=line.split(' ');const w=waiting.findIndex(x=>String(x.pid)===pid);if(w>=0){const [x]=waiting.splice(w,1);clearTimeout(x.timer);x.resolve(Number(v)>=0?{cpuMs:Number(v),memBytes:Number(m)>=0?Number(m):null}:null);}}});
  ps.on('exit',()=>{ps=null;for(const x of waiting.splice(0)){clearTimeout(x.timer);x.resolve(null);}});
  ps.on('error',()=>{});
 };
 const sampler={
  cpuMs:pid=>sampler.sample(pid).then(s=>s?.cpuMs??null),
  sample(pid){
   if(!Number.isInteger(pid))return Promise.resolve(null);
   if(!ps)start();
   return new Promise(resolve=>{const x={pid,resolve,timer:setTimeout(()=>{const i=waiting.indexOf(x);if(i>=0)waiting.splice(i,1);resolve(null);},timeoutMs)};waiting.push(x);ps.stdin.write(pid+'\n');});
  },
  close(){if(ps){ps.stdin.end();ps.kill();ps=null;}},
 };
 return sampler;
}

// Kills a process and everything it started (Unity can spawn crash handlers; Node tools are single processes).
export function killTree(pid,{platform=process.platform}={}){
 return new Promise(resolve=>{
  if(platform==='win32')execFile('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true},()=>resolve());
  else{try{process.kill(pid,'SIGKILL');}catch{}resolve();}
 });
}

// Program path and command line of a PID: {path, commandLine}, or null when the process is gone or belongs to an
// account this one may not inspect (then it cannot be verified, and the host does not stop it).
export function processInfo(pid,{platform=process.platform}={}){
 if(!Number.isInteger(pid)||pid<=0)return Promise.resolve(null);
 if(platform!=='win32'){
  try{return Promise.resolve({path:readlinkSync(`/proc/${pid}/exe`),commandLine:readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').join(' ').trim()});}catch{return Promise.resolve(null);}
 }
 const ps=`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";if($p){[pscustomobject]@{path=$p.ExecutablePath;commandLine=$p.CommandLine}|ConvertTo-Json -Compress}`;
 return new Promise(res=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,timeout:15000},(err,out)=>{
  if(err||!out.trim())return res(null);
  try{const j=JSON.parse(out);res(j.path||j.commandLine?{path:j.path??null,commandLine:j.commandLine??null}:null);}catch{res(null);}
 }));
}

export function pidAlive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
