// Hang verdict for the original server (HOST-APP-PLAN.md "Watchdog"). The 2026-10-22 freeze at the first autosave left
// the process alive with 0 CPU, no log output and no network answers. The server is hung only when every available
// signal (log lines, UDP replies, CPU time) has been silent for hangSeconds at once, after the start-up grace.
export const SIGNALS=['log','udp','cpu'];

export function createHangWatchdog({hangSeconds=90,graceSeconds=300,now=()=>Date.now()}={}){
 let startedAt=null,last={},cpuMs=null,cpuKnown=true,running=false;
 const w={
  // A new server process: everything counts as fresh.
  reset(at=now()){startedAt=at;last={log:at,udp:at,cpu:at};cpuMs=null;cpuKnown=true;running=true;},
  stop(){running=false;},
  log(at=now()){if(running)last.log=at;},
  udp(ok,at=now()){if(running&&ok)last.udp=at;},
  // ms: total CPU time of the process, or null when it cannot be read (then the other two signals decide).
  cpu(ms,at=now()){
   if(!running)return;
   if(ms==null){cpuKnown=false;return;}
   cpuKnown=true;if(cpuMs!==null&&ms>cpuMs)last.cpu=at;cpuMs=ms;
  },
  verdict(at=now()){
   if(!running)return {state:'idle',hangSeconds,graceSeconds};
   const ages={};for(const s of SIGNALS)ages[s]=Math.max(0,(at-last[s])/1000);
   const used=SIGNALS.filter(s=>s!=='cpu'||cpuKnown);
   const quiet=Math.min(...used.map(s=>ages[s])),graceLeft=Math.max(0,graceSeconds-(at-startedAt)/1000);
   const state=graceLeft>0?'grace':quiet>=hangSeconds?'hung':quiet>=hangSeconds/2?'suspect':'ok';
   return {state,ages,quiet,used,cpuKnown,graceLeft,hangSeconds,graceSeconds};
  },
 };
 return w;
}
