// Server directory helpers shared by the homepage quick join and the server browser (DOM-free).
// Only fields the central service provides are used: name, region, online, players, capacity, wipe, and the approved
// list entry's tags and description.
const num=v=>Number.isFinite(v)?v:null;

// SERVERS online and PLAYERS across them; players is null when no online server reports a count.
export function summarizeServers(list){
 const online=list.filter(s=>s.online),counts=online.map(s=>num(s.players)).filter(n=>n!==null);
 return {servers:online.length,players:counts.length?counts.reduce((a,b)=>a+b,0):null};
}
export function formatPlayers(s){
 const p=num(s.players),c=num(s.capacity);
 if(!s.online||p===null)return '—';
 return c===null?String(p):`${p}/${c}`;
}
const byPlayersThenName=(a,b)=>(num(b.players)??-1)-(num(a.players)??-1)||a.name.localeCompare(b.name);
export function quickJoin(list,n=3){return list.filter(s=>s.online).sort(byPlayersThenName).slice(0,n);}

// ---- Server browser -----------------------------------------------------------------------------------------------
const SORTS=['players','name','region'];
export function filterServers(list,{q='',region=null,hideFull=false,hideOffline=false}={}){
 const needle=q.trim().toLowerCase(),reg=region?.toUpperCase();
 // The search also reads the list entry's tags and description (a search for "vanilla" finds servers tagged so).
 return list.filter(s=>(!needle||[s.name,...(s.tags??[]),s.description??''].some(t=>t.toLowerCase().includes(needle)))&&(!reg||String(s.region).toUpperCase()===reg)
  &&!(hideOffline&&!s.online)&&!(hideFull&&num(s.capacity)!==null&&num(s.players)!==null&&s.players>=s.capacity));
}
export function sortServers(list,key='players'){
 const by={players:byPlayersThenName,name:(a,b)=>a.name.localeCompare(b.name),region:(a,b)=>String(a.region).toUpperCase().localeCompare(String(b.region).toUpperCase())||a.name.localeCompare(b.name)}[key]??byPlayersThenName;
 return [...list].sort((a,b)=>(a.online===b.online?0:a.online?-1:1)||by(a,b));
}
export function regionsOf(list){return [...new Set(list.map(s=>String(s.region??'').toUpperCase()).filter(Boolean))].sort();}
// Filters live in the address bar so a filtered list can be shared or reloaded.
export function queryFromState({q='',region=null,hideFull=false,hideOffline=false,sort='players'}){
 const p=new URLSearchParams();if(q)p.set('q',q);if(region)p.set('region',region);if(hideFull)p.set('full','0');if(hideOffline)p.set('offline','0');if(sort!=='players')p.set('sort',sort);
 return p;
}
export function stateFromQuery(p){
 return {q:p.get('q')??'',region:p.get('region')||null,hideFull:p.get('full')==='0',hideOffline:p.get('offline')==='0',sort:SORTS.includes(p.get('sort'))?p.get('sort'):'players'};
}
// A server's join requirements (central join policy) as short labels; empty = anyone with an account may join.
export function requirementLabels(r={}){
 const out=[],h=r.minAccountAgeMinutes??0,q=r.steamQuality;
 if(h>0)out.push(h%1440===0?`Account ${h/1440} day${h===1440?'':'s'}+`:h%60===0?`Account ${h/60} h+`:`Account ${h} min+`);
 if(r.phone)out.push('Verified phone');
 if(r.steam)out.push('Steam linked');
 if(q?.minAccountAgeDays>0)out.push(`Steam ${q.minAccountAgeDays} days+`);
 if(q?.minLevel>0)out.push(`Steam level ${q.minLevel}+`);
 if(q?.maxVacBans===0)out.push('No VAC bans');else if(q?.maxVacBans>0)out.push(`≤ ${q.maxVacBans} VAC bans`);
 if(q?.maxGameBans===0)out.push('No game bans');else if(q?.maxGameBans>0)out.push(`≤ ${q.maxGameBans} game bans`);
 if(q?.minDaysSinceBan>0)out.push(`No ban in ${q.minDaysSinceBan} days`);
 return out;
}
// "Login type" (OFFSHOOT-COMPATIBILITY-PLAN.md work item 7, "server profiles"): null while the owner's host app has
// never reported it (unknown, not "open"); true is the only case worth a badge (false/null show nothing, same as
// requirementLabels leaving the list empty for "anyone with an account may join").
export function launcherOnlyLabel(s){return s.launcherOnly===true?'Website or launcher account':null;}
// Listing tags shown as badges on the website. "official" only files a server under the in-game browser's Official tab
// (browser/server-list.mjs categoryFor); every server here is community-run, so the website never shows it as a claim.
export function shownTags(tags=[]){return tags.filter(t=>t.trim().toLowerCase()!=='official');}
export const isDesktop=({finePointer,webgl2})=>Boolean(finePointer&&webgl2);

// Join: signed-out players sign in first and come back; gameplay needs a desktop. The one-use ticket (~60 s) is handed
// to the game page through this tab's sessionStorage only (browser/online.mjs reads 'rlb-join').
export async function joinServer(server,{me,desktop=true,api,storage=globalThis.sessionStorage,config={},now=Date.now}={}){
 if(!me)return {redirect:'/signin?next='+encodeURIComponent(`/servers/${server.id}?join=1`)};
 // The in-game name is the website username: an account without one sets it first and comes back to this join.
 if(me.needsUsername)return {redirect:'/welcome?mode=username&next='+encodeURIComponent(`/servers/${server.id}?join=1`)};
 if(!desktop)throw Object.assign(new Error('desktop-required'),{code:'desktop-required'});
 const {ticket,endpoint}=await api('POST',`/servers/${server.id}/join-ticket`);
 storage.setItem('rlb-join',JSON.stringify({ticket,endpoint,server:server.id,name:server.name,at:now()}));
 return {redirect:config.playUrl??null};
}
