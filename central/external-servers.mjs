// Optional import of a public Rust Legacy server list, so our own server browser shows a server a player heard
// about instead of leaving them to guess why it isn't listed (OFFSHOOT-COMPATIBILITY-PLAN.md work item 9).
// Off by default: the source's terms of use and rate limits are not stated anywhere on its site, so turning this
// on is the owner's call, not something the code should decide (central/service.mjs's externalServers option).
//
// Entries never claim to be joinable here: they have no RLB adapter, so a browser or launcher player genuinely
// cannot join them the way they join one of ours (browserReady:false, launcherOnly:null — unknown, not "open").
// Checked live against https://api.rustlegacy.eu/?getdata=serverlist (2026-10-29): a JSON array of
// {name,ip,port,players,maxplayers,online,serverlist,...}, all values as strings; "serverlist":"false" is the
// source's own flag for entries it hides from its own public list (test/soloworld servers), honoured here too.
const DEFAULT_URL='https://api.rustlegacy.eu/?getdata=serverlist';
const MAX_ENTRIES=200;

export function createExternalServers({enabled=false,url=DEFAULT_URL,ttlMs=5*60e3,fetchImpl=fetch,now=Date.now,source='rustlegacy.eu'}={}){
 let cache=[],fetchedAt=0,fetching=null;
 async function refresh(){
  try{
   const res=await fetchImpl(url,{signal:AbortSignal.timeout(10000)});
   if(!res.ok)return; // keep the last known-good cache
   const rows=await res.json();
   if(!Array.isArray(rows))return;
   cache=rows.filter(r=>r&&typeof r==='object'&&r.online==='1'&&r.serverlist!=='false'&&r.ip&&r.port).slice(0,MAX_ENTRIES).map(r=>({
    id:`${source}:${r.ip}:${r.port}`,name:String(r.name??'').slice(0,200)||'Server',region:null,online:true,
    players:Number.isFinite(Number(r.players))?Number(r.players):null,capacity:Number.isFinite(Number(r.maxplayers))?Number(r.maxplayers):null,
    wipe:null,lastWipeAt:null,browserReady:false,launcherOnly:null,requirements:{minAccountAgeMinutes:0,steam:false,phone:false},external:true,source}));
   fetchedAt=now();
  }catch{} // network error, bad JSON, timeout: fail soft, keep showing the last successful fetch
 }
 return {
  async list(){
   if(!enabled)return [];
   if(now()-fetchedAt>ttlMs){fetching??=refresh().finally(()=>{fetching=null;});await fetching;}
   return cache;
  },
 };
}
