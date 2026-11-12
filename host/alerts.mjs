// Discord alerts (HOST-AND-LOADER-BUILD.md H3). The owner pastes a Discord webhook URL on the Settings page; it is the
// only outbound address an owner sets in the host, so only https://discord.com and https://discordapp.com webhook paths
// are accepted, redirects are refused, and the URL is kept in <dataDir>/alerts.json (owner only) and never shown or
// logged in full. Alerts come from the host's own events (crash, failed, a part stopping, the freeze and its recovery,
// back online), from the website through the host app key (anti-cheat flags at or above a chosen severity, new player
// reports), from other modules through notify(kind, {title, text}) (scheduled restarts and wipes), and from a disk check.
// Discord allows about 30 messages a minute per webhook: alerts that arrive together are batched (up to 10 embeds a
// message), sends are capped per minute, 429 waits for retry_after and 5xx/network errors back off and retry.
import {readFileSync,writeFileSync,mkdirSync,statfsSync} from 'node:fs';
import {join} from 'node:path';

export const ALERT_KINDS={crash:'The game server crashed or failed',freeze:'A freeze was caught, and the server recovered',part:'Another part (website, sidecar, gateway) stopped unexpectedly',
 online:'The game server is back online',flags:'Anti-cheat flags',reports:'New player reports',schedule:'Scheduled restarts and wipes',disk:'Low disk space on the data drive'};
export const SEVERITIES=[10,20,40,60];
const DEFAULTS={url:null,events:Object.fromEntries(Object.keys(ALERT_KINDS).map(k=>[k,true])),flagSeverity:40};
// Embed colours from the dashboard tokens: red for trouble, amber for warnings, teal for good news, orange otherwise.
export const COLOURS={red:0xc62f24,amber:0xe8a93a,teal:0x5fa9a0,orange:0xcd5a28};
const KIND_COLOUR={crash:'red',freeze:'red',part:'amber',online:'teal',flags:'orange',reports:'amber',schedule:'teal',disk:'amber',test:'orange'};
const KIND_WORDS={speed:'Too fast',teleport:'Teleport',fly:'Flying','under-terrain':'Under the ground','fire-rate':'Firing too fast','pellet-count':'Too many pellets','no-reload':'No reload',
 'hit-range':'Hit out of range','headshot-ratio':'Head-shot ratio','command-flood':'Command flood','wall-shot':'Shot through a wall','wall-use':'Used through a wall',noclip:'Through a wall','yaw-snap':'Aim snap','command-rate':'Actions too fast',hover:'Hovering'};
const WEBHOOK_PATH=/^\/api\/webhooks\/(\d{17,20})\/([A-Za-z0-9_-]{40,120})$/;
const MAX_EMBEDS=10,QUEUE_MAX=100,DISK_EVERY_MS=10*60e3,DISK_REPEAT_MS=6*3600e3,DISK_MIN_BYTES=2*1024**3,DISK_MIN_SHARE=0.05;

export function checkWebhookUrl(value){
 const bad=()=>Object.assign(Error('That is not a Discord webhook URL. In Discord: Server Settings → Integrations → Webhooks → Copy Webhook URL.'),{status:400});
 if(typeof value!=='string')throw bad();
 let u;try{u=new URL(value.trim());}catch{throw bad();}
 if(u.protocol!=='https:'||!['discord.com','discordapp.com'].includes(u.hostname)||u.port||u.username||u.password||u.search||u.hash||!WEBHOOK_PATH.test(u.pathname))throw bad();
 return `https://${u.hostname}${u.pathname}`;
}
export const maskWebhook=url=>{const u=new URL(url),m=WEBHOOK_PATH.exec(u.pathname);return `${u.hostname}/api/webhooks/${m[1]}/••••••`;};
// Player names and reasons are typed by players: escape Discord markdown so a name cannot become a link or a heading.
const md=s=>String(s??'').replace(/([\\*_`~|>[\]()])/g,'\\$1');
const clip=(s,n)=>s.length>n?s.slice(0,n-1)+'…':s;
const ago=ms=>{const s=Math.round(ms/1000);return s<90?`${s} s`:s<5400?`${Math.round(s/60)} min`:`${(s/3600).toFixed(1)} h`;};

export function createAlerts({dataDir,fetchImpl=(...a)=>fetch(...a),now=()=>Date.now(),log=()=>{},central=null,coalesceMs=3000,perMinute=25,windowMs=60e3,retryBaseMs=2000,maxTries=5,pollMs=60e3,statfs=statfsSync}){
 const file=join(dataDir,'alerts.json');
 let cfg;try{const f=JSON.parse(readFileSync(file,'utf8'));cfg={...DEFAULTS,...f,events:{...DEFAULTS.events,...f.events}};if(cfg.url)checkWebhookUrl(cfg.url);}catch{cfg={...DEFAULTS,events:{...DEFAULTS.events}};}
 let queue=[],dropped=0,flushTimer=null,sending=false,lastError=null,stopped=false;const sent=[],recent=[];const timers=new Set();
 const later=(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);fn();},ms);t.unref?.();timers.add(t);return t;};
 const wait=ms=>new Promise(r=>later(r,ms));
 const remember=(item,ok,error)=>{recent.unshift({at:now(),kind:item.kind,title:item.title,ok,error:error??null});recent.length=Math.min(recent.length,20);};

 const embed=i=>({title:clip(md(i.title),250),description:clip(md(i.text??''),1500)||undefined,color:COLOURS[i.colour??KIND_COLOUR[i.kind]??'orange'],timestamp:new Date(i.at).toISOString(),footer:{text:'Rust Legacy Host'}});
 // One POST with retries. Resolves {ok} or {ok:false,error}; never throws, never logs the URL.
 async function post(items){
  if(!cfg.url)return {ok:false,error:'No webhook URL saved'};
  const body=JSON.stringify({username:'Rust Legacy Host',allowed_mentions:{parse:[]},embeds:items.map(embed)});
  for(let tries=1;;tries++){
   let res,error;
   try{res=await fetchImpl(cfg.url,{method:'POST',headers:{'content-type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(10000)});}catch(e){error=e.name==='TimeoutError'?'Discord did not answer in 10 s':'Could not reach Discord ('+(e.cause?.code??e.message)+')';}
   if(res){
    sent.push(now());
    if(res.ok)return {ok:true};
    const data=await res.json().catch(()=>({}));
    if(res.status===429){const s=Number(data.retry_after??res.headers.get('retry-after'));if(tries<maxTries+3){await wait(Math.min(60e3,Number.isFinite(s)?s*1000:5000)+50);continue;}error='Discord kept asking us to slow down (HTTP 429)';}
    else if(res.status<500)return {ok:false,error:`Discord refused the webhook (HTTP ${res.status}${data.message?': '+String(data.message).slice(0,80):''}). Check the URL, or make a new webhook.`};
    else error=`Discord had an error (HTTP ${res.status})`;
   }
   if(tries>=maxTries)return {ok:false,error};
   await wait(retryBaseMs*2**(tries-1));
  }
 }
 const roomAt=()=>{const t=now();while(sent.length&&sent[0]<=t-windowMs)sent.shift();return sent.length<perMinute?0:sent[0]+windowMs-t;};
 async function flush(){
  flushTimer=null;
  if(sending||stopped||!queue.length)return;
  const room=roomAt();if(room>0){flushTimer=later(flush,room+10);return;}
  sending=true;
  const items=queue.splice(0,dropped?MAX_EMBEDS-1:MAX_EMBEDS);
  if(dropped){items.push({kind:'part',title:`${dropped} more alerts were not sent`,text:'Too many at once for Discord. The dashboard has them all under Logs.',at:now(),colour:'amber'});dropped=0;}
  const r=await post(items);sending=false;
  for(const i of items)remember(i,r.ok,r.error);
  if(r.ok)lastError=null;else{lastError=r.error;log(`Discord alert not sent: ${r.error}`,'warn');}
  if(queue.length&&!stopped)flushTimer??=later(flush,50);
 }
 function notify(kind,{title,text='',colour}={}){
  if(!cfg.url||!(kind in ALERT_KINDS)||!cfg.events[kind]||stopped)return false;
  queue.push({kind,title:String(title),text:String(text),colour,at:now()});
  if(queue.length>QUEUE_MAX){queue.shift();dropped++;}
  flushTimer??=later(flush,coalesceMs); // a burst (a crash loop, a raid of flags) goes out as one message
  return true;
 }

 // ---------- The host's own events ----------
 let detach=null;
 function attach(host){
  const down=new Map(); // component → {since, why} after an exit nobody asked for
  let prevVerdict=null;
  const onState=i=>{
   const label=i.label??i.name,server=i.name==='server',bad=i.state==='backoff'||i.state==='failed'||(i.state==='stopped'&&/unexpectedly/.test(i.message??'')&&i.lastExit?.wanted!==true);
   if(bad){
    const kind=server?'crash':'part',was=down.get(i.name);
    if(!was||was.state!==i.state){notify(kind,{title:`${label} ${i.state==='failed'?'failed':server?'crashed':'stopped unexpectedly'}`,text:i.state==='failed'?`${i.message??''}. It waits for you: start it from the dashboard.`:i.message??''});}
    down.set(i.name,{since:was?.since??now(),why:was?.why??'crash',state:i.state});
   }else if(i.state==='running'&&down.has(i.name)){
    const was=down.get(i.name);down.delete(i.name);
    if(was.why==='freeze'&&cfg.events.freeze)notify('freeze',{title:`${label} recovered from the freeze`,text:`Back up ${ago(now()-was.since)} after the freeze, with the last good save.`});
    else if(server)notify('online',{title:`${label} back online`,text:`It was down for ${ago(now()-was.since)}.`});
    else notify('part',{title:`${label} running again`,text:`It was down for ${ago(now()-was.since)}.`,colour:'teal'});
   }else if(i.state==='stopped'&&i.lastExit?.wanted&&i.lastExit.reason!=='hang')down.delete(i.name); // the watchdog's own stop of a hung server is not the owner's
  };
  const onWatchdog=w=>{
   if(w?.state==='hung'&&prevVerdict!=='hung'){
    const a=w.ages??{};
    notify('freeze',{title:'Game server froze',text:`No log lines, UDP replies or CPU use for ${Math.round(a.log??w.hangSeconds??0)} s. The host is restarting it with the last good save.`});
    down.set('server',{since:now(),why:'freeze',state:'hung'});
   }
   prevVerdict=w?.state??null;
  };
  host.on('state',onState);host.on('watchdog',onWatchdog);
  detach=()=>{host.off?.('state',onState);host.off?.('watchdog',onWatchdog);};
 }

 // ---------- The website: flags and reports through the host app key ----------
 let seenFlags=null,seenReports=null,polling=false;
 async function poll(){
  if(!central||polling||!cfg.url||(!cfg.events.flags&&!cfg.events.reports))return;
  polling=true;
  try{
   const [f,r]=await Promise.all([central('recent-flags').catch(()=>null),central('reports?status=open').catch(()=>null)]);
   if(f?.flags){
    const key=x=>`${x.source}:${x.id}`;
    if(seenFlags){
     const fresh=f.flags.filter(x=>!seenFlags.has(key(x))&&x.severity>=cfg.flagSeverity);
     if(fresh.length)notify('flags',{title:fresh.length===1?'Anti-cheat flag':`${fresh.length} anti-cheat flags`,
      text:fresh.slice(0,8).map(x=>`${x.name??'?'}${x.source==='desktop'?' (desktop)':''}: ${KIND_WORDS[x.kind]??x.kind}, severity ${x.severity}`).join('\n')+(fresh.length>8?`\n…and ${fresh.length-8} more`:'')+'\nEvidence: Anti-cheat page in the dashboard.'});
    }
    seenFlags=new Set(f.flags.map(key));
   }
   if(r?.reports){
    if(seenReports){
     const fresh=r.reports.filter(x=>!seenReports.has(x.id));
     if(fresh.length)notify('reports',{title:fresh.length===1?'New player report':`${fresh.length} new player reports`,
      text:fresh.slice(0,8).map(x=>`${x.reporterName??'Someone'} reported ${x.name}: ${x.reason==='in-game'?'in game':x.reason}${x.detail?` ("${clip(x.detail,140)}")`:''}`).join('\n')});
    }
    seenReports=new Set(r.reports.map(x=>x.id));
   }
  }finally{polling=false;}
 }
 // ---------- Disk space on the data drive ----------
 let diskWarnedAt=-Infinity;
 function checkDisk(){
  if(!cfg.url||!cfg.events.disk)return;
  try{
   const s=statfs(dataDir),free=s.bavail*s.bsize,total=s.blocks*s.bsize;
   if((free<DISK_MIN_BYTES||free<total*DISK_MIN_SHARE)&&now()-diskWarnedAt>DISK_REPEAT_MS){
    diskWarnedAt=now();notify('disk',{title:'Low disk space',text:`${(free/1024**3).toFixed(1)} GB free on the drive with the host's data (${dataDir}). Logs, backups and saves need room.`});
   }
  }catch{}
 }
 const pollTimer=setInterval(()=>{poll().catch(()=>{});},pollMs);pollTimer.unref?.();
 const diskTimer=setInterval(checkDisk,DISK_EVERY_MS);diskTimer.unref?.();
 if(central)later(()=>poll().catch(()=>{}),Math.min(pollMs,5000));

 const view=()=>({configured:Boolean(cfg.url),url:cfg.url?maskWebhook(cfg.url):null,events:{...cfg.events},flagSeverity:cfg.flagSeverity,kinds:ALERT_KINDS,severities:SEVERITIES,recent:[...recent],lastError,waiting:queue.length});
 return {
  notify,attach,poll,checkDisk,view,
  // url: a webhook URL, '' to remove it, undefined to keep it. events: {kind: boolean}. flagSeverity: one of SEVERITIES.
  save({url,events,flagSeverity}={}){
   const next={...cfg,events:{...cfg.events}};
   if(url===''||url===null)next.url=null;else if(url!==undefined)next.url=checkWebhookUrl(url);
   if(events!==undefined){if(!events||typeof events!=='object')throw Object.assign(Error('events must be an object'),{status:400});for(const [k,v] of Object.entries(events)){if(!(k in ALERT_KINDS)||typeof v!=='boolean')throw Object.assign(Error('unknown alert '+k),{status:400});next.events[k]=v;}}
   if(flagSeverity!==undefined){if(!SEVERITIES.includes(flagSeverity))throw Object.assign(Error('flagSeverity must be one of '+SEVERITIES.join(', ')),{status:400});next.flagSeverity=flagSeverity;}
   mkdirSync(dataDir,{recursive:true});writeFileSync(file,JSON.stringify(next,null,1)+'\n',{mode:0o600});
   if(next.url!==cfg.url){lastError=null;seenFlags=null;seenReports=null;}
   cfg=next;return view();
  },
  // Sends at once, whatever the switches, and says whether Discord took it.
  async test(){
   const item={kind:'test',title:'Test alert from Rust Legacy Host',text:'Alerts reach this channel. Choose which ones on the Settings page.',at:now()};
   const r=await post([item]);remember(item,r.ok,r.error);lastError=r.ok?null:r.error;return r;
  },
  stop(){stopped=true;detach?.();clearInterval(pollTimer);clearInterval(diskTimer);for(const t of timers)clearTimeout(t);timers.clear();},
 };
}
