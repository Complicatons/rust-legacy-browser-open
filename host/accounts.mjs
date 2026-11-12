// Accounts and links for the host app (HOST-APP-PLAN.md "Accounts and links"). Two sources, both existing:
//  - the adapter sidecar (authoritative for which website account owns which character): its read-only `status` and the
//    owner's `unlink`, over the same HMAC control channel the gateway uses (control key file from sidecar.json);
//  - central's admin API for this one server, with the host app key the owner made on the website's owner page
//    (Bearer rlbh_…, stored in <dataDir>/central-host.key): account names, desktop link requests, audit.
// Nothing here links accounts by itself; links are only ever made by the in-game code redeemed on the website.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createControlSender} from '../bridge/adapter.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// central/admin.mjs routes the dashboard's Players and Anti-cheat pages call (all take this server's id).
export const ADMIN_ROUTES={
 GET:new Set(['players','flags','desktop-flags','recent-flags','bans','reports','commands','audit','alts','screenshots','roles','player-history']),
 // roles: two-way (owner decision, HOST-AND-LOADER-BUILD.md question 1, 29 Oct 2026) — the host app's key already
 // acts as the server's owner on central (hostKey() in central/admin.mjs), so POST .../roles just needed adding here.
 POST:new Set(['kick','bans','unban','command','resolve-report','screenshot','roles']),
};
const readJson=f=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return null;}};
async function fetchJson(url,{method='GET',headers={},body,timeoutMs=5000}={}){
 const res=await fetch(url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Object.assign(Error(data.error??`HTTP ${res.status}`),{status:res.status});
 return data;
}

export function createAccounts({config,fetchImpl}={}){
 const comps=config.components??{};
 const sidecar=comps.sidecar?.config?readJson(comps.sidecar.config):null;
 const gateway=comps.gateway?.config?readJson(comps.gateway.config):null;
 const serverId=sidecar?.serverId??gateway?.serverId??null;
 const centralUrl=gateway?.centralUrl??null;
 const keyFile=join(config.dataDir,'central-host.key');
 let send=null;
 const control=async body=>{
  if(!sidecar)throw Error('no sidecar in host.json');
  send??=createControlSender(Buffer.from(readFileSync(sidecar.controlKeyFile,'utf8').trim(),'hex'));
  return fetchJson(`http://127.0.0.1:${sidecar.port??28090}/control`,{method:'POST',body:send({...body,serverId})});
 };
 const key=()=>existsSync(keyFile)?readFileSync(keyFile,'utf8').trim():null;
 const central=(path,opts={})=>{
  const k=key();if(!k)throw Object.assign(Error('no host app key yet'),{status:428});
  if(!centralUrl||!serverId)throw Error('no gateway config with centralUrl and serverId in host.json');
  return fetchJson(new URL(path.replace(':id',serverId),centralUrl),{...opts,headers:{authorization:'Bearer '+k}});
 };
 const settle=p=>p.then(v=>({ok:true,...v}),e=>({ok:false,error:e.message,status:e.status??null}));

 return {
  serverId,centralUrl,hasKey:()=>Boolean(key()),hostKey:()=>key(),
  // The sidecar's control channel itself, for the game server's save-and-quit (host/server-control.mjs).
  control,hasSidecar:()=>Boolean(sidecar),
  // Validates the key against central before keeping it (owner.token-like file, owner and administrators only).
  async setKey(value){
   if(typeof value!=='string'||!/^rlbh_[A-Za-z0-9_-]{43}$/.test(value.trim()))throw Object.assign(Error('That is not a host app key (it starts with rlbh_)'),{status:400});
   if(!centralUrl||!serverId)throw Object.assign(Error('Add the gateway to host.json first: the key belongs to its server'),{status:409});
   await fetchJson(new URL(`/admin/servers/${serverId}/accounts`,centralUrl),{headers:{authorization:'Bearer '+value.trim()}}).catch(e=>{throw Object.assign(Error(e.status===404?'The website does not accept this key for this server':'Could not reach the website: '+e.message),{status:e.status===404?403:502});});
   mkdirSync(dirname(keyFile),{recursive:true});writeFileSync(keyFile,value.trim()+'\n',{mode:0o600});
   return {ok:true};
  },
  // The Accounts page: adapter view (links, online leases, reservations, unlinks, desktop ends) merged with central's
  // view (names, last played, desktop link requests). Either side may be unavailable; the page says which.
  async overview(){
   const [adapter,accounts,requests,audit]=await Promise.all([settle(control({type:'status'})),
    settle(central('/admin/servers/:id/accounts')),settle(central('/admin/servers/:id/link-requests')),settle(central('/admin/servers/:id/audit'))]);
   const online=new Map((adapter.leases??[]).filter(l=>l.subject).map(l=>[l.subject,l]));
   const linked=new Map((adapter.identities?.entries??[]).map(e=>[e.subject,e.backendId]));
   const rows=new Map();
   for(const a of accounts.accounts??[])rows.set(a.player,{subject:a.player,name:a.name,lastSeen:a.lastSeen,firstSeen:a.firstSeen,banned:a.banned,desktopLink:a.link});
   for(const [subject,backendId] of linked){const r=rows.get(subject)??{subject,name:null};r.backendId=backendId;rows.set(subject,r);}
   for(const r of rows.values()){const l=online.get(r.subject);r.online=Boolean(l);r.kind=l?.kind??(r.desktopLink?'desktop':r.backendId?'browser':null);r.linked=linked.has(r.subject);}
   const linkAudit=(audit.events??audit.audit??[]).filter(e=>/link|host-key/.test(e.action??''));
   return {serverId,centralUrl,hasKey:Boolean(key()),
    adapter:adapter.ok?{ok:true,leases:adapter.leases,reservations:adapter.reservations,unlinks:adapter.unlinks??[],desktopEnds:adapter.desktopEnds??[],identities:{count:adapter.identities?.count??linked.size,namespace:adapter.identities?.namespace??null}}:{ok:false,error:adapter.error},
    central:accounts.ok?{ok:true,hostKey:accounts.hostKey}:{ok:false,error:accounts.error,status:accounts.status},
    accounts:[...rows.values()].sort((a,b)=>(b.online-a.online)||((b.lastSeen??0)-(a.lastSeen??0))),
    linkRequests:requests.requests??[],audit:linkAudit};
  },
  // Players and Anti-cheat pages: central's admin routes for this server, a fixed list (the server id is always this
  // host's own; the dashboard cannot name another server or another route).
  async admin(method,name,query,body){
   const allowed=ADMIN_ROUTES[method];
   if(!allowed?.has(name))throw Object.assign(Error('not an admin route the host app uses'),{status:404});
   const q=new URLSearchParams();for(const [k,v] of Object.entries(query??{}))if(['player','handle','status'].includes(k)&&typeof v==='string')q.set(k,v);
   return central(`/admin/servers/:id/${name}${q.size?'?'+q:''}`,method==='POST'?{method,body:body??{}}:{});
  },
  // Screenshot image bytes (JPEG) through the same key.
  async screenshotImage(sid){
   if(!UUID.test(sid??''))throw Object.assign(Error('unknown screenshot'),{status:404});
   const k=key();if(!k)throw Object.assign(Error('no host app key yet'),{status:428});
   const res=await fetch(new URL(`/admin/screenshots/${sid}/image`,centralUrl),{headers:{authorization:'Bearer '+k},signal:AbortSignal.timeout(10000)});
   if(!res.ok)throw Object.assign(Error('image unavailable'),{status:res.status});
   return {type:res.headers.get('content-type')??'image/jpeg',bytes:Buffer.from(await res.arrayBuffer())};
  },
  // Owner unlink: the adapter decides (refused while the character is in the game); central hears it on the next report.
  async unlink(subject,reason){
   if(typeof subject!=='string'||!UUID.test(subject))throw Object.assign(Error('unknown account'),{status:400});
   if(typeof reason!=='string'||reason.trim().length<3||reason.length>200)throw Object.assign(Error('Give a reason (3 to 200 characters); it goes in the audit log'),{status:400});
   const r=await control({type:'unlink',subject,reason:reason.trim()});
   if(!r.ok)throw Object.assign(Error({online:'The player is in the game; unlink after they leave','not-linked':'That account is not linked on this server','link-in-progress':'A link for this account is being made right now; try again in a minute'}[r.reason]??r.reason??'refused'),{status:409});
   return r;
  },
 };
}
