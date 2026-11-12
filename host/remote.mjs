// Remote control through the website (SERVER-MANAGEMENT-PLAN.md section 1). The dashboard listens on loopback only,
// so the host app reports out instead: every couple of seconds it sends its status, backups and new log lines to the
// website the gateway uses (POST /host-relay/report with the host app key) and runs the commands the owner queued
// there, with the same host.act / host.backups calls as the local dashboard. host.json `remote.control: false`
// keeps the reports but refuses every command; `remote.enabled: false` (host.mjs) sends nothing.
const POWER=new Set(['start','stop','restart']);
export const REMOTE={everyMs:2000,linesPerReport:1000,timeoutMs:10000};

export function createRemote({host,key,centralUrl,fetchImpl=(...a)=>fetch(...a),control=true,log=(text,level)=>host.hub.push('host','host',text,level)}){
 // The first report carries the recent backlog (the newest lines), so the website's log view starts with history.
 let sentSeq=0,results=[],state={state:'starting',at:null,error:null},timer=null,busy=false;
 const finish=(id,ok,error)=>results.push(ok?{id,ok:true}:{id,ok:false,error:String(error).slice(0,300)});

 async function run(c){
  const who=`Website (${String(c.by??'owner').slice(0,40)})`;
  try{
   if(!control)throw Error('website control is switched off in host.json');
   if(POWER.has(c.op)){
    if(!(c.target==='all'||host.components().includes(c.target)))throw Error('unknown component');
    log(`${who}: ${c.op} ${c.target}`);await host.act(c.op,c.target);
   }else if(c.op==='backup-keep'){log(`${who}: keep a backup${c.label?' ('+c.label+')':''}`);host.backups.keepNow(c.label??undefined);}
   else if(c.op==='backup-restore'){log(`${who}: restore ${c.name}`,'warn');host.backups.restore(c.name);}
   // A game server restart with in-game warnings (host/schedule.mjs); a wipe is never started from the website.
   else if(c.op==='restart-in'){await host.schedule.restartIn(c.minutes,{by:'website'});}
   else if(c.op==='restart-cancel'){await host.schedule.cancel({by:'website'});}
   else throw Error('unknown command');
   finish(c.id,true);
  }catch(e){log(`${who}: ${c.op} refused: ${e.message}`,'warn');finish(c.id,false,e.message);}
 }

 async function tick(){
  const k=key();
  if(!k){state={state:'no-key',at:Date.now(),error:null};return state;}
  if(!centralUrl){state={state:'no-website',at:Date.now(),error:null};return state;}
  const logs=host.hub.since(sentSeq,REMOTE.linesPerReport),sending=results;results=[];
  // Backups without the files' local paths: the website needs names, sizes and times only.
  let backups=null;try{const b=host.backups?.status();if(b)backups={configured:b.configured,saving:b.saving??false,serverState:b.serverState??null,
   copies:[...(b.kept??[]),...(b.owner??[])].map(({file,...c})=>c).sort((x,y)=>(y.at??0)-(x.at??0)).slice(0,40)};}catch{}
  try{
   const res=await fetchImpl(new URL('/host-relay/report',centralUrl),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+k},
    body:JSON.stringify({status:host.status(),backups,control,logs,results:sending}),signal:AbortSignal.timeout(REMOTE.timeoutMs)});
   if(!res.ok)throw Object.assign(Error(res.status===401?'the website does not accept the host app key':`HTTP ${res.status}`),{status:res.status});
   const data=await res.json();
   if(logs.length)sentSeq=logs.at(-1).seq;
   state={state:'connected',at:Date.now(),error:null};
   for(const c of Array.isArray(data.commands)?data.commands:[])run(c);
  }catch(e){results=[...sending,...results];state={state:e.status===401?'key-refused':'unreachable',at:Date.now(),error:e.message};}
  return state;
 }
 return {
  tick,
  state:()=>({...state,control}),
  start(){const loop=async()=>{if(busy)return;busy=true;try{await tick();}finally{busy=false;}};loop();timer=setInterval(loop,REMOTE.everyMs);timer.unref?.();},
  stop(){clearInterval(timer);timer=null;},
 };
}
