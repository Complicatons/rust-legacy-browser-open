// Pure server-list rules from the original ServerBrowser / ServerCategory / Pagination / ServerItem (Assembly-CSharp).
// The Steam master list is replaced by the project's central directory (GET /servers) plus the port's own offline island.
export const SERVERTYPE={OFFICIAL:0,COMMUNITY:1,MODDED:2,WHITELIST:3,HISTORY:4,FRIENDS:5};
export const SERVER_ITEM_HEIGHT=34; // ServerBrowser.ServerItemHeight
export const OFFLINE_ADDRESS='offline';
const ALLOWED="'[]| -(%)_@+&:/.?#!,";
const letterOrDigit=c=>/[\p{L}\p{Nd}]/u.test(c);
// ServerBrowser.ShouldIgnoreServer (minus ServerListConfig.IsBadServer, which needs the Steam address blacklist).
export function shouldIgnoreServer(s){const t=s.name.toLowerCase();if(!t||t.includes('[color')||t.includes('[sprite')||t.includes('--')||t.includes('%%'))return true;
 if(!letterOrDigit(t[0])||!letterOrDigit(t[t.length-1]))return true;for(const c of t)if(!letterOrDigit(c)&&!ALLOWED.includes(c))return true;
 if(s.currentplayers>s.maxplayers||s.currentplayers>500)return true;return false;}
// ServerBrowser.Add_Server category routing for an ordinary (iType 0) entry: tags "official" -> Official; "sg:<hex>" groups ->
// Whitelist only for member groups (Steam, so never here); "modded" -> Modded; otherwise Community unless the hostname names
// Oxide or Rust++ (those are dropped). Returns null when the server is not listed.
export function categoryFor(s,tags=''){if(tags.includes('official'))return SERVERTYPE.OFFICIAL;
 for(const tag of tags.split(','))if(!tag.startsWith('mp')&&!tag.startsWith('cp')&&tag.startsWith('sg:'))return null;
 if(tags.includes('modded'))return SERVERTYPE.MODDED;const host=s.name.toLowerCase();if(host.includes('oxide')||host.includes('rust++'))return null;return SERVERTYPE.COMMUNITY;}
// Add_Server history label: "<name> (N seconds/minutes/hours/days ago)" from the last-played Unix time.
export function historyLabel(name,lastplayed,nowSeconds){const n=Math.max(0,Math.floor(nowSeconds-lastplayed));
 const ago=n<60?`${n} seconds ago`:n<3600?`${Math.floor(n/60)} minutes ago`:n>=172800?`${Math.floor(n/60/60/24)} days ago`:`${Math.floor(n/60/60)} hours ago`;return `${name} (${ago})`;}
// ServerBrowser detailsLabel after each Add_Server: (int)(players / slots * 100).
export function detailsText(playerCount,serverCount,slotCount){const pct=slotCount>0?Math.trunc(playerCount/slotCount*100):0;return `Found ${playerCount} players on ${serverCount} servers. We are at ${pct}% capacity.`;}
const cmp=(a,b)=>a<b?-1:a>b?1:0,name=(x,y)=>x.name.localeCompare(y.name,'en',{sensitivity:'variant'}),fave=(x,y)=>cmp(Number(y.fave),Number(x.fave));
// UpdateServerList sorting: History by last played (newest first), else favourites first then name (0) / players desc (1) /
// ping asc (2). A ping the port cannot measure (null) sorts after every measured ping.
export function sortServers(list,serverType,orderType){const ping=s=>s.ping??Infinity;
 if(serverType===SERVERTYPE.HISTORY)return list.sort((x,y)=>x.lastplayed===y.lastplayed?name(x,y):cmp(y.lastplayed,x.lastplayed));
 if(orderType===0)return list.sort((x,y)=>fave(x,y)||name(x,y));
 if(orderType===1)return list.sort((x,y)=>fave(x,y)||(x.currentplayers===y.currentplayers?name(x,y):cmp(y.currentplayers,x.currentplayers)));
 return list.sort((x,y)=>fave(x,y)||(ping(x)===ping(y)?name(x,y):cmp(ping(x),ping(y))));}
// The page slice UpdateServerList shows: rows that fit the container (height / 34), page count, row y offsets (a 2 px gap
// after the favourites block). Returns null when nothing is shown (empty category or page out of range).
export function pageOf(list,pageNumber,containerHeight){let max=Math.floor(containerHeight/SERVER_ITEM_HEIGHT);max=Math.min(list.length,max);const start=pageNumber*max;
 if(list.length===0||max<=0||start<0||start>list.length)return null;const pages=Math.ceil(list.length/max);const rows=list.slice(start,start+max);let y=0,prevFave=false;
 return {pages,rows:rows.map(s=>{if(prevFave&&!s.fave)y+=2;prevFave=s.fave;const row={server:s,y};y+=SERVER_ITEM_HEIGHT;return row;}),checksum:rows.map(s=>s.address).join('')};}
// Pagination.Setup: which page buttons and "..." spacers appear (buttonGroups 2).
export function paginationItems(pageCount,current,buttonGroups=2){if(pageCount<=1)return [];const out=[];let spacer=true;
 for(let j=0;j<pageCount;j++){if(buttonGroups-j<=0&&j<pageCount-buttonGroups&&Math.abs(j-current)>buttonGroups/2){if(spacer)out.push({spacer:true});spacer=false;continue;}out.push({page:j,label:String(j+1),current:j===current});spacer=true;}return out;}
// ServerItem.Init text.
export const playersText=s=>`${s.currentplayers} / ${s.maxplayers??'?'}`;
export const pingText=s=>s.ping==null?'-':String(s.ping);
// Central directory entry (central/service.mjs GET /servers) -> ServerBrowser.Server. Only online servers can be joined;
// player counts are the gateway heartbeat's, never invented; ping is not measurable before joining.
// A directory entry's listing tags as the comma list categoryFor reads ("official" puts it under Official).
export const centralTags=s=>Array.isArray(s?.tags)?s.tags.filter(t=>typeof t==='string').map(t=>t.toLowerCase()).join(','):'';
export function fromCentral(s,favourites=new Set()){const name=String(s.name??'').slice(0,64);return {name,address:String(s.id),central:s,maxplayers:Number.isFinite(s.capacity)?s.capacity:null,currentplayers:Number.isFinite(s.players)?s.players:0,ping:null,lastplayed:0,fave:favourites.has(String(s.id))};}
export const offlineServer=(favourites=new Set())=>({name:'Rust Island (offline, this browser only)',address:OFFLINE_ADDRESS,offline:true,maxplayers:1,currentplayers:0,ping:0,lastplayed:0,fave:favourites.has(OFFLINE_ADDRESS)});
// FavouriteList (serverfavourite.add/remove/save/load, ServerItem.OnClickFave): an in-memory list of "ip:port" names; Save
// writes cfg/favourites.cfg, Load clears the list and runs that file. Add ignores duplicates and names shorter than 8
// characters (shorter than any "a.b.c.d:p"). The port's names are central server ids (UUIDs) plus its own offline island,
// whose port-only address ('offline', 7 characters) is exempt from the length rule. Saved here as a JSON array in this
// browser's storage (the key the server browser has always used, so earlier favourites load).
export const FAVOURITES_KEY='rlb-server-favourites';
export class FavouriteList{
 constructor(storage=null,key=FAVOURITES_KEY){this.storage=storage;this.key=key;this.list=[];}
 add(name){name=String(name??'');if(!this.contains(name)&&(name.length>=8||name===OFFLINE_ADDRESS))this.list.push(name);}
 remove(name){const i=this.list.indexOf(String(name??''));if(i<0)return false;this.list.splice(i,1);return true;}
 contains(name){return this.list.includes(name);}
 clear(){this.list.length=0;}
 save(){try{this.storage?.setItem(this.key,JSON.stringify(this.list));return true;}catch{return false;}}
 load(){this.clear();for(const name of readList(this.storage,this.key))if(typeof name==='string')this.add(name);return this.list.length;}
 set(){return new Set(this.list);}
}
// History entries persisted per browser (the original read Steam's favourite/history lists).
export function readList(storage,key){try{const v=JSON.parse(storage?.getItem(key)??'[]');return Array.isArray(v)?v:[];}catch{return [];}}
export function rememberJoin(storage,server,nowSeconds,key='rlb-server-history',max=50){const list=readList(storage,key).filter(e=>e&&e.address!==server.address);
 list.unshift({address:server.address,name:server.offline?server.name:server.name,lastplayed:Math.floor(nowSeconds)});try{storage?.setItem(key,JSON.stringify(list.slice(0,max)));}catch{}return list.slice(0,max);}
