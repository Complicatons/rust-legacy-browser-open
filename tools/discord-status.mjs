// Keeps ONE message in the Discord #server-status channel showing the central service's server list (GET /servers):
// posted once, then edited in place, and only when the text changes. No dependencies; plain fetch to Discord REST v10.
//   env CENTRAL_URL=https://play.example/                  the central service (its GET /servers)
//   env DISCORD_STATUS_WEBHOOK_URL=…                       a webhook in #server-status (preferred: it can edit its own message)
//   or  DISCORD_BOT_TOKEN=… + DISCORD_STATUS_CHANNEL_ID=…  a bot that can post in #server-status (the Bots role can)
//   env DISCORD_STATUS_STATE=.discord-status.json          where the message id is kept (default shown; git-ignored)
//   node tools/discord-status.mjs [--once]
// Shows only what the service reports (name, region, online, players/capacity, wipe); house style: numbers + short labels.
// Webhook URLs and tokens are secrets: they are never logged and are scrubbed from every error this module throws.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const API='https://discord.com/api/v10';
const WEBHOOK=/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{15,25})\/([\w-]{20,})\/?$/;
const LIMIT=2000; // Discord message content limit
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// Removes every secret it knows about plus anything shaped like a webhook URL/path or a bot Authorization header.
export function redact(text,secrets=[]){
 let out=String(text??'');
 for(const s of secrets)if(s&&String(s).length>=8)out=out.split(String(s)).join('[redacted]');
 return out.replace(/https?:\/\/\S*\/webhooks\/\S+/gi,'[webhook]').replace(/\/webhooks\/\d+\/[\w-]+/gi,'/webhooks/[redacted]').replace(/Bot\s+[\w.-]{20,}/g,'Bot [redacted]');
}

// One Discord channel message target: a webhook ({webhookUrl}) or a bot ({token, channelId}).
// create(body) → message id, edit(id, body); a deleted message makes edit throw an error with status 404.
export function discordMessages({webhookUrl,token,channelId}={},{fetchImpl=fetch,wait=sleep}={}){
 let base,headers={'User-Agent':'DiscordBot (rust-legacy-browser-status, 1.0)','Content-Type':'application/json'},label;
 const secrets=[webhookUrl,token].filter(Boolean);
 if(webhookUrl){
  const m=WEBHOOK.exec(String(webhookUrl).split('?')[0]);
  if(!m)throw new Error('the webhook URL does not look like https://discord.com/api/webhooks/<id>/<token>');
  base=`${API}/webhooks/${m[1]}/${m[2]}`;secrets.push(m[2]);label='webhook';
 }else if(token&&channelId){
  if(!/^\d{15,25}$/.test(String(channelId)))throw new Error('the channel id must be a Discord snowflake');
  base=`${API}/channels/${channelId}`;headers.Authorization=`Bot ${token}`;label=`channel ${channelId}`;
 }else throw new Error('set a webhook URL, or a bot token and a channel id');
 async function call(method,path,body){
  for(let attempt=0;;attempt++){
   let res;
   try{res=await fetchImpl(base+path,{method,headers,body:JSON.stringify(body)});}
   catch(e){throw new Error(`Discord ${method} (${label}) failed: ${redact(e?.message,secrets)}`);} // no cause: it may carry the URL
   if(res.status===429&&attempt<3){const after=(await res.json().catch(()=>({}))).retry_after??1;await wait(Math.ceil(after*1000)+100);continue;}
   const text=res.status===204?'':await res.text().catch(()=>'');
   let data=null;try{data=text?JSON.parse(text):null;}catch{data={message:text.slice(0,200)};}
   if(!res.ok){const e=new Error(redact(`Discord ${method} (${label}) failed: ${res.status} ${data?.message??''}`.trim(),secrets));e.status=res.status;e.code=data?.code;throw e;}
   return data;
  }
 }
 const messages=webhookUrl?'':'/messages';
 return {
  label,secrets,
  async create(body){const msg=await call('POST',webhookUrl?'?wait=true':messages,body);if(!msg?.id)throw new Error(`Discord POST (${label}) returned no message id`);return msg.id;},
  async edit(id,body){await call('PATCH',`/messages/${id}`,body);},
 };
}

// Discord markdown would otherwise turn owner-chosen names into formatting, links or headings.
const plain=s=>String(s??'').replace(/[\r\n\t]+/g,' ').replace(/[\\*_~`|>#[\]()<@:-]/g,c=>'\\'+c).trim().slice(0,80);
const n=v=>Number.isFinite(v)?v:null;

// The status text for a /servers list, or for an unreachable directory (servers === null).
export function formatStatus(servers){
 if(servers===null)return '**DIRECTORY OFFLINE**';
 const list=[...servers].sort((a,b)=>(b.online-a.online)||((n(b.players)??-1)-(n(a.players)??-1))||String(a.name).localeCompare(String(b.name)));
 const online=list.filter(s=>s.online);
 const players=online.reduce((t,s)=>t+(n(s.players)??0),0);
 const head=`**${list.length} ${list.length===1?'SERVER':'SERVERS'} · ${online.length} ONLINE · ${players} ${players===1?'PLAYER':'PLAYERS'}**`;
 const lines=list.map(s=>{
  const count=!s.online?'OFFLINE':n(s.capacity)!=null?`${n(s.players)??0}/${s.capacity}`:`${n(s.players)??0}`;
  return [`${s.online?'🟢':'⚫'} ${plain(s.name)||'—'}`,s.region?plain(s.region).toUpperCase():null,count,s.wipe!=null&&s.wipe!==''?`WIPE ${plain(s.wipe)}`:null].filter(Boolean).join(' · ');
 });
 let text=[head,...lines].join('\n');
 for(let keep=lines.length-1;text.length>LIMIT&&keep>=0;keep--)text=[head,...lines.slice(0,keep),`+${lines.length-keep} MORE`].join('\n');
 return text;
}

export async function fetchServers(centralUrl,{fetchImpl=fetch,timeoutMs=10000}={}){
 const res=await fetchImpl(new URL('servers',String(centralUrl).replace(/\/?$/,'/')).href,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
 if(!res.ok)throw new Error(`GET /servers answered ${res.status}`);
 const data=await res.json();
 if(!Array.isArray(data?.servers))throw new Error('GET /servers returned no server list');
 return data.servers;
}

// tick() reads the list and posts/edits the message when its text changed. A directory that fails `offlineAfter`
// times in a row is shown as offline (one blip doesn't flap the message). Errors are logged (redacted), never thrown.
export function createStatusUpdater({target,loadServers,state={},saveState=()=>{},log=console.log,offlineAfter=3}){
 let failures=0;
 const say=m=>log(redact(m,target.secrets));
 async function tick(){
  let servers;
  try{servers=await loadServers();failures=0;}
  catch(e){failures++;say(`status: directory unreachable (${failures}): ${e?.message??e}`);if(failures<offlineAfter)return 'waiting';servers=null;}
  const content=formatStatus(servers);
  if(state.messageId&&state.content===content)return 'unchanged';
  const body={content,allowed_mentions:{parse:[]}};
  try{
   if(state.messageId){
    try{await target.edit(state.messageId,body);state.content=content;saveState(state);say('status: edited');return 'edited';}
    catch(e){if(e.status!==404)throw e;say('status: message was deleted; posting a new one');}
   }
   state.messageId=await target.create(body);state.content=content;saveState(state);say('status: posted');return 'posted';
  }catch(e){say(`status: ${e?.message??e}`);return 'error';}
 }
 return {tick,state};
}

export function readState(file){try{const s=JSON.parse(readFileSync(file,'utf8'));return {messageId:typeof s.messageId==='string'?s.messageId:undefined,content:typeof s.content==='string'?s.content:undefined};}catch{return {};}}
export function writeState(file,state){const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify({messageId:state.messageId,content:state.content},null,1));renameSync(tmp,file);}

export function targetFromEnv(env,{webhook,channel}){
 if(env[webhook])return discordMessages({webhookUrl:env[webhook]});
 if(env.DISCORD_BOT_TOKEN&&env[channel])return discordMessages({token:env.DISCORD_BOT_TOKEN,channelId:env[channel]});
 return null;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {values}=parseArgs({options:{once:{type:'boolean'},interval:{type:'string'}}});
 const env=process.env,central=env.CENTRAL_URL,file=env.DISCORD_STATUS_STATE??'.discord-status.json';
 let target=null;
 try{target=targetFromEnv(env,{webhook:'DISCORD_STATUS_WEBHOOK_URL',channel:'DISCORD_STATUS_CHANNEL_ID'});}catch(e){console.error(e.message);process.exit(2);}
 if(!central||!target){console.error('Set CENTRAL_URL and DISCORD_STATUS_WEBHOOK_URL (or DISCORD_BOT_TOKEN + DISCORD_STATUS_CHANNEL_ID), then run: node tools/discord-status.mjs [--once]');process.exit(2);}
 const updater=createStatusUpdater({target,loadServers:()=>fetchServers(central),state:readState(file),saveState:s=>writeState(file,s),log:m=>console.log(new Date().toISOString(),m)});
 const every=Math.max(15,Number(values.interval??60))*1000;
 if(values.once)process.exitCode=(await updater.tick())==='error'?1:0;
 else for(;;){await updater.tick();await sleep(every);}
}
