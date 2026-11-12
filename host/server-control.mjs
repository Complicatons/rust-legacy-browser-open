// Save-and-quit for the game server (HOST-AND-LOADER-BUILD.md H1). Stop, Restart, scheduled restarts and wipes first
// ask the server to save, wait for its own " Saved N Object(s)" line (ServerSaveManager.Save, the line the save guard
// already reads), then ask it to quit; only when it does not answer is the process ended as before. Two ways in:
//  - adapter: the server plugin (adapter/RustLegacyBrowser.cs, or the vanilla patch) polls the sidecar every 2 s and runs
//    the fixed server actions save, broadcast and quit (bridge/adapter.mjs SERVER_ACTIONS); the host queues them over the
//    sidecar's control channel, as host/accounts.mjs does. Relied on only while the plugin has polled recently.
//  - console: the mock game server's stdin (save, quit, broadcast <text>), for tests and the demo.
// A hang never comes here (supervisor): a frozen server cannot save.
// " Saved N Object(s)" per the decompiled ServerSaveManager; the real server logs "saved all." for the save.all command
// the adapters run (Azure VM 2026-10-24: no "Saved N Object(s)" line at all), printed once the save is written.
export const SAVED=/^\s*Saved \d+ Object\(s\)|^saved all\.\s*$/;
export const GRACEFUL_DEFAULTS={saveSeconds:60,quitSeconds:30};
// The plugin polls every 2 s; three missed polls and the host stops counting on it.
const POLL_FRESH_MS=8000;
// The Windows service wrapper gives the whole host 25 s to stop: a shutdown waits less for the save.
const SHUTDOWN={saveSeconds:12,quitSeconds:8};

// via: 'adapter' | 'console'. proc: the supervised server. control: async body → reply (the sidecar's control channel).
// onLine(fn) → unsubscribe: the server log's lines.
export function createServerControl({via,proc,control,onLine,log=()=>{},saveSeconds=GRACEFUL_DEFAULTS.saveSeconds,quitSeconds=GRACEFUL_DEFAULTS.quitSeconds,refreshEveryMs=5000}){
 let plugin={available:false,reason:'not checked yet',players:null},timer=null;
 const state=()=>via==='console'
  ?{available:Boolean(proc.child),via,reason:proc.child?null:'the server is not running from this host',players:null,saveSeconds}
  :{available:plugin.available,via,reason:plugin.available?null:plugin.reason,players:plugin.players,saveSeconds};
 async function refresh(){
  if(via!=='adapter')return state();
  try{
   const r=await control({type:'server-commands'});
   const age=r?.plugin?.polledAgoMs;
   plugin=!r?.ok?{available:false,reason:`the sidecar refused: ${r?.reason??'no answer'}`,players:null}
    :age==null?{available:false,reason:'the server plugin has not polled the sidecar yet',players:null}
    :age>POLL_FRESH_MS?{available:false,reason:`the server plugin last polled ${Math.round(age/1000)} s ago`,players:null}
    :{available:true,reason:null,players:r.plugin.players??null};
  }catch(e){plugin={available:false,reason:`the sidecar is not answering (${e.message})`,players:null};}
  return state();
 }
 async function send(action,{message}={}){
  if(via==='console'){
   if(!proc.child)throw Error('the server is not running from this host');
   proc.child.stdin.write(action==='broadcast'?`broadcast ${String(message).replace(/[\r\n]+/g,' ')}\n`:action+'\n');
   return {ok:true};
  }
  const r=await control({type:'server-command',action,...(message!=null?{message}:{})});
  if(!r?.ok)throw Error(r?.reason??'refused');
  return r;
 }
 // Resolves with {saved} once the next " Saved N Object(s)" line arrives, or {saved:false} after ms.
 function nextSave(ms){
  let off,t;
  const p=new Promise(res=>{off=onLine(line=>{if(SAVED.test(line)){clearTimeout(t);off();res(true);}});t=setTimeout(()=>{off();res(false);},ms);});
  return {promise:p,cancel:()=>{clearTimeout(t);off();}};
 }
 // The supervisor's gracefulStop.run: ms to wait for the exit after asking it to quit, or 0 to kill now.
 async function stop({reason}={}){
  const limits=reason==='host shutting down'?{saveSeconds:Math.min(saveSeconds,SHUTDOWN.saveSeconds),quitSeconds:Math.min(quitSeconds,SHUTDOWN.quitSeconds)}:{saveSeconds,quitSeconds};
  const st=via==='adapter'?await refresh():state();
  if(!st.available){log(`Game server: cannot save first (${st.reason}); ending the process. Play since the last completed save is lost.`,'warn');return 0;}
  log(`Game server: saving the world before it stops (waiting up to ${limits.saveSeconds} s)`);
  const saved=nextSave(limits.saveSeconds*1000);
  try{await send('save');}catch(e){saved.cancel();log(`Game server: the save request failed (${e.message}); ending the process`,'warn');return 0;}
  if(!await saved.promise){log(`Game server: no save confirmation within ${limits.saveSeconds} s; ending the process. Play since the last completed save is lost.`,'warn');return 0;}
  try{await send('quit');}catch(e){log(`Game server: the quit request failed (${e.message}); ending the process (the world is saved)`,'warn');return 0;}
  log(`Game server: saved; asked it to quit (waiting up to ${limits.quitSeconds} s)`);
  return limits.quitSeconds*1000;
 }
 return {
  via,state,refresh,send,stop,
  start(){if(via==='adapter'&&!timer){refresh();timer=setInterval(refresh,refreshEveryMs);timer.unref?.();}return this;},
  close(){clearInterval(timer);timer=null;},
 };
}
