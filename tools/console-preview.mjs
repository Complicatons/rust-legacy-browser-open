// Local preview of server management on the website (SERVER-MANAGEMENT-PLAN.md) with sample data; nothing leaves this
// machine and no game server runs:
//   node tools/console-preview.mjs [port]   → http://127.0.0.1:<port>/staff, /console, /owner, /servers, /docs
// An in-memory central (listing review on) with four servers, sample players, flags and reports, and a pretend host
// app for "Dusk Legacy" that reports through the real host/remote.mjs: its log fills every second, and the console's
// start/stop/restart and backup commands change its state.
// Sign-in (sample accounts made here, preview only): PreviewStaff (site staff) or PreviewOwner, password preview-pass-1234.
import {createServer} from 'node:http';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSiteHandler} from '../central/site.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {enrolGateway,createRemoteAccount} from '../bridge/remote-account.mjs';
import {createLogHub} from '../host/log-hub.mjs';
import {createRemote} from '../host/remote.mjs';

const port=Number(process.argv[2]??4198),origin=`http://127.0.0.1:${port}`,PASSWORD='preview-pass-1234';
const db=openCentralDb();
const svc=createCentralService({db,keys:[createSigningKey('preview')],issuer:origin,verifyLogin:createDevLoginVerifier(),allowedOrigins:[origin],publicUrl:origin+'/',secureCookies:false,rateLimit:100000,listingReview:true});
const site=createSiteHandler({providers:[],publicUrl:origin+'/'});
const http=createServer((req,res)=>{if(site(req,res))return;svc.handle(req,res);});
await new Promise(r=>http.listen(port,'127.0.0.1',r));

const call=async(method,path,{data,who}={})=>{const headers={origin};if(data!==undefined)headers['content-type']='application/json';if(who){headers.cookie=who.cookie;headers['x-csrf-token']=who.csrf;}
 const r=await fetch(origin+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});return {status:r.status,data:await r.json().catch(()=>null),cookies:r.headers.getSetCookie()};};
const session=r=>({cookie:r.cookies.find(c=>c.startsWith('rlb_session=')).split(';')[0],csrf:r.data.csrf,player:r.data.player});
const account=async name=>session(await call('POST','/auth/register',{data:{username:name,email:name.toLowerCase()+'@preview.test',password:PASSWORD}}));
const staff=await account('PreviewStaff'),owner=await account('PreviewOwner'),other=await account('IslandKeeper');
db.addStaff(staff.player,Date.now());
const players=[];for(const n of ['Rook','Wren','SpeedyPete','Birch','Hazel','Flint'])players.push(session(await call('POST','/auth/login',{data:{subject:n,name:n}})));

async function server(who,name,region,{online=true,listing=null,players:count=0}={}){
 const made=(await call('POST','/owner/servers',{who,data:{name,region,endpoint:`wss://${name.toLowerCase().replace(/\W+/g,'-')}.example/play`}})).data;
 const {credential}=await enrolGateway({baseUrl:origin,code:made.enrolmentCode});const gw=createRemoteAccount({baseUrl:origin,credential});
 if(online)await gw.heartbeat({players:count,capacity:100});
 if(listing)await call('POST',`/owner/servers/${made.id}/listing`,{who,data:{...listing,agree:true}});
 return {id:made.id,gw,count};
}
const dusk=await server(owner,'Dusk Legacy','eu',{players:6,listing:{description:'Vanilla 2013 Legacy with weekly wipes, active admins and no kits. Raids open after the first night.',tags:['vanilla','pvp','weekly wipe'],discord:'https://discord.gg/duskpreview',website:'https://dusk.example/',wipe:'Thursdays 18:00 UTC',language:'English'}});
await call('POST',`/staff/servers/${dusk.id}/listing-review`,{who:staff,data:{decision:'approve'}});
const quiet=await server(other,'Quiet Isle PvE','na',{players:2,listing:{description:'A calm PvE island: no raiding, build anywhere, trade at the lighthouse.',tags:['pve','building','no raid'],wipe:'Monthly',language:'English'}});
const old=await server(owner,'Old Timers 2013','eu',{online:false,listing:{description:'Back to 2013. Admin shop with kits for donators.',tags:['kits'],language:'English'}});
await call('POST',`/staff/servers/${old.id}/listing-review`,{who:staff,data:{decision:'reject',note:'Paid kits break listing rule 2. Remove the donator kits and send it again.'}});
const grief=await server(other,'Grief Town','us',{players:0});
await call('POST',`/staff/servers/${grief.id}/suspend`,{who:staff,data:{suspended:true,reason:'Admins teleporting into bases (three player reports).'}});

// Rosters, two flags and a report on Dusk Legacy, so the panels have something to show.
const roster=players.map((p,i)=>({subject:p.player,name:['Rook','Wren','SpeedyPete','Birch','Hazel','Flint'][i],playerId:i+1,score:i===2?64:i*3,flags:i===2?{speed:2,'fire-rate':1}:{},connectedAt:Date.now()-i*600e3}));
const flags=[{subject:players[2].player,kind:'speed',severity:30,score:40,at:Date.now()-300e3,detail:{metres:14.2,limit:10}},{subject:players[2].player,kind:'fire-rate',severity:45,score:24,at:Date.now()-120e3,detail:{shots:9,seconds:1}}];
await dusk.gw.report({players:roster,flags});await quiet.gw.report({players:roster.slice(0,2).map(p=>({...p,score:0,flags:{}})),flags:[]});
await call('POST',`/servers/${dusk.id}/reports`,{who:players[0],data:{name:'SpeedyPete',reason:'cheating',detail:'Ran across the whole valley in seconds, then shot me through a wall.'}});
setInterval(()=>{dusk.gw.heartbeat({players:dusk.count,capacity:100}).catch(()=>{});dusk.gw.report({players:roster,flags:[]}).catch(()=>{});
 quiet.gw.heartbeat({players:2,capacity:60}).catch(()=>{});},10e3).unref?.();

// The pretend host app for Dusk Legacy: real host/remote.mjs and log hub, invented parts and lines.
const hostKey=(await call('POST',`/owner/servers/${dusk.id}/host-key`,{who:owner})).data.hostKey;
const hub=createLogHub({perSource:3000}),start=Date.now();
const parts=[{name:'sidecar',label:'Adapter sidecar'},{name:'server',label:'Game server'},{name:'gateway',label:'Gateway'}].map(p=>({...p,state:'running',startedAt:start-3*3600e3,restarts:0}));
const copies=[{name:'rust_island_2013.sav.20261023-1810',source:'auto',at:Date.now()-600e3,bytes:4_812_000},{name:'pre-wipe.sav',source:'owner',label:'before the wipe',at:Date.now()-86400e3,bytes:4_700_000}];
const info=p=>({name:p.name,label:p.label,state:p.state,pid:p.state==='running'?4000+p.name.length:null,startedAt:p.startedAt,uptimeMs:p.state==='running'?Date.now()-p.startedAt:0,restarts:p.restarts});
const host={hub,components:()=>parts.map(p=>p.name),
 status:()=>({components:parts.map(info),players:{inGame:dusk.count,sessions:dusk.count},watchdog:{enabled:true,state:parts[1].state==='running'?'ok':'idle'},saves:{lastGood:copies[0]},seq:hub.seq}),
 async act(action,target){
  for(const p of parts.filter(x=>target==='all'||x.name===target)){
   if(action!=='start'){p.state='stopping';hub.push('host','host',`Stopping ${p.label}`);await new Promise(r=>setTimeout(r,800));p.state='stopped';hub.push('host','host',`${p.label} stopped`,'warn');if(p.name==='server')dusk.count=0;}
   if(action!=='stop'){p.state='starting';hub.push('host','host',`Starting ${p.label}`);await new Promise(r=>setTimeout(r,1500));p.state='running';p.startedAt=Date.now();if(action==='restart')p.restarts++;hub.push('host','host',`${p.label} is running`);}
  }
 },
 backups:{status:()=>({configured:true,serverState:parts[1].state,kept:copies.filter(c=>c.source==='auto'),owner:copies.filter(c=>c.source==='owner')}),
  keepNow:label=>{const c={name:`kept-${Date.now()}.sav`,source:'owner',label,at:Date.now(),bytes:4_820_000};copies.unshift(c);hub.push('host','host',`Kept a copy: ${label||c.name}`);return c;},
  restore:name=>{if(parts[1].state==='running')throw Error('Stop the game server first: a running server would overwrite the restored save at its next autosave');hub.push('host','host',`Restored ${name}; the old save is set aside`,'warn');return {};}}};
const SERVER_LINES=['Saving to \'rust_server_Data/rust_island_2013.sav\'',' Saved 18234 Object(s). Took 1.9 seconds.','Rook[76561190000000301] connected','Wren picked up 3 x Metal Ore','Airdrop inbound (51 players or a supply signal)','Wren has been killed by SpeedyPete','Birch disconnected: timed out','[RustLegacyBrowser] report from Rook about SpeedyPete'];
const GW_LINES=['session 7f3a: joined as Hazel (browser, 62 ms)','heartbeat ok: 6 in game','anticheat: SpeedyPete speed 14.2 m over 1 s (limit 10)','session 1c09: left (closed by player)','admission: ticket redeemed for Flint'];
let tick=0;
for(let i=0;i<60;i++)hub.push(i%3?'gateway':'server','stdout',(i%3?GW_LINES:SERVER_LINES)[i%5]);
setInterval(()=>{tick++;
 if(parts[1].state==='running'&&tick%2===0)hub.push('server','stdout',SERVER_LINES[tick%SERVER_LINES.length],/killed/.test(SERVER_LINES[tick%SERVER_LINES.length])?'warn':'info');
 if(parts[2].state==='running'&&tick%3===0)hub.push('gateway','stdout',GW_LINES[tick%GW_LINES.length]);
 if(tick%17===0)hub.push('sidecar','stdout','control: status ok, 4 linked characters');
},1000).unref?.();
createRemote({host,key:()=>hostKey,centralUrl:origin}).start();

console.log([`server management preview: ${origin}/staff (sign in as PreviewStaff) · ${origin}/owner and /console (PreviewOwner) · password ${PASSWORD}`,
 `  ${origin}/servers · ${origin}/list-your-server · ${origin}/docs`].join('\n'));
