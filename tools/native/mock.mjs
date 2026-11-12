// Self-test environment for tools/check-native.mjs and tools/soak-bots.mjs: the shared mock stack
// (tests/helpers/stack.mjs: central + sidecar + gateway + mock uLink server) behind ONE website origin that serves the
// site pages, the game at /play and the central API (as tools/central.mjs with serveGame), plus a small "referee"
// that answers the way the original server does for the generic matrix rows (rules from analysis/decompiled/server:
// ConsoleNetworker, ConsoleSystem permissions, chat.say, global.findsv/status/suicide/kick, rcon.login, env.time,
// inv.give, airdrop.drop; sleepers on reconnect). It also plays the server plugin of the Admin tools rows the way
// adapter/vanilla/RustLegacyBrowserVanilla.cs does: a 2 s sidecar poll carrying the player list (with one fake desktop
// player), the fixed admin actions with their result, and the private /report chat command. It is NOT the original
// server and proves nothing about it.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createSiteHandler} from '../../central/site.mjs';
import {createGameHandler} from '../serve.mjs';
import {startStack,METRICS_TOKEN} from '../../tests/helpers/stack.mjs';
import {inventoryFixture} from '../../tests/helpers/inventory-fixture.mjs';
import {readArgs} from '../../bridge/ulink/rust.mjs';
import {BitWriter} from '../../bridge/ulink/bits.mjs';
import {listenServer} from '../../bridge/listen.mjs';
import {createMockWorld} from './mock-world.mjs';
import {limitsFromPlayerConfig,weaponsFromItems} from '../../bridge/anticheat.mjs';
import {loadLineOfSight} from '../../bridge/line-of-sight.mjs';
import {SCENE_DOOR_VIEWS} from '../../bridge/scene-door-views.mjs';

export const MOCK_RCON_PASSWORD='mock-rcon-password';
export const MOCK_SPAWN=[5244.1,368,-4839.6]; // Unity space; flat open ground (tools/check-online.mjs)
// The desktop client the mock plugin lists (tools/check-native.mjs --mock sets desktop.name to this name).
export const MOCK_DESKTOP={id:'76561198000000077',name:'DeskTester'};
const PLUGIN_POLL_MS=2000; // RustLegacyBrowserVanilla PollSeconds
const STARTER=[[30,{name:'Rock',uses:1}],[31,{name:'Torch',uses:1}],[32,{name:'Bandage',uses:3}]];
const KICK_RCON=142; // NetError.Facepunch_Kick_RCON
// player.backpackLockTime: the shipped server.cfg locks a death sack to its dead owner for 30 s; the mock keeps the rule
// with a shorter lock so combat.death still waits it out (tools/check-native.mjs sets cfg.backpackLockMs from it).
export const MOCK_BACKPACK_LOCK_MS=3000;

const quoteSafe=s=>'"'+String(s).replaceAll('"','\\"').replace(/\\+$/,'')+'"';
// Facepunch String.SplitQuotesStrings, enough for the commands the harness sends.
export function splitCommand(text){const t=[...String(text).replaceAll('\\"','\u0001').matchAll(/"([^"]*)"|'([^']*)'|\S+/g)].map(m=>(m[1]??m[2]??m[0]).replaceAll('\u0001','"'));return {name:(t[0]??'').toLowerCase().replace(/^global\./,''),args:t.slice(1)};}
const skyBytes=hour=>{const w=new BitWriter().f32(45).f32(15).f32(0.4);[0.1,0.2,0.3,0.4].forEach(v=>w.f32(v));w.i32(2014).u8(6).u8(15).f32(hour);return w.toBytes();};

// The gateway's anti-cheat as tools/gateway.mjs runs it with recoveredDir: limits from player.json (2 s reset grace
// included), weapons from items/manifest.json, the shared line-of-sight world (scene + tree + rock colliders, heightmap,
// NGC structures and deployables; ~0.5 GB) and the scene doors. NATIVE_MOCK_LOS=0 leaves the line of sight out.
// NATIVE_MOCK_EU1=1: the gateway as EU 1 runs it (ngcRegistry, no recoveredDir): built-in anti-cheat limits, no weapon
// data, no line of sight, the built-in scene door list (tools/gateway.mjs without recoveredDir).
export async function mockAnticheat({lineOfSight=process.env.NATIVE_MOCK_LOS!=='0',eu1=process.env.NATIVE_MOCK_EU1==='1'}={}){
 if(eu1)return {anticheat:{limits:{},weapons:new Map()},sceneDoors:SCENE_DOOR_VIEWS};
 const dir=new URL('../../browser/assets/recovered/',import.meta.url),json=async f=>JSON.parse(await readFile(new URL(f,dir)));
 const anticheat={limits:limitsFromPlayerConfig(await json('player.json')),weapons:weaponsFromItems(await json('items/manifest.json'))};
 if(lineOfSight)anticheat.lineOfSight=await loadLineOfSight(fileURLToPath(dir));
 const sceneDoors=((await json('scene/manifest.json')).doors??[]).map(d=>d.viewID).filter(Number.isInteger);
 return {anticheat,sceneDoors};
}

// apart (NATIVE_MOCK_APART=<metres>): every player but the first spawns and respawns at the original spawn point closest to
// that far from MOCK_SPAWN, so the two-player rows have to walk to meet (tools/native/walk-meet.mjs).
export async function startMockEnvironment({log=()=>{},apart=Number(process.env.NATIVE_MOCK_APART)||0}={}){
 const catalogue=JSON.parse(await readFile(new URL('../../browser/assets/recovered/items/manifest.json',import.meta.url)));
 const registry=JSON.parse(await readFile(new URL('../../browser/assets/recovered/ngc/registry.json',import.meta.url)));
 const game=createGameHandler(),site=createSiteHandler({providers:[],devLogin:true,playUrl:'/play'});
 let stack=null;
 const http=createServer(async(req,res)=>{
  try{
   if(site(req,res))return;
   const url=new URL(req.url,'http://local'),p=url.pathname;
   if((req.method==='GET'||req.method==='HEAD')&&p==='/play'){req.url='/';return game(req,res);}
   if((req.method==='GET'||req.method==='HEAD')&&/\.[a-z0-9]+$/i.test(p))return game(req,res);
   // Central API: forwarded to the stack's central service with its allowed origin; cookies pass through.
   const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('rlb_session='));
   let data;if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();data=raw?JSON.parse(raw):{};}
   const r=await stack.call(req.method,p+url.search,{data,cookie,csrf:req.headers['x-csrf-token']});let body=r.data;
   // Registered endpoints must be wss://; the local mock gateway is plain ws on loopback (allowed by browser/online.mjs).
   if(/\/join-ticket$/.test(p)&&r.status===200)body={...body,endpoint:`ws://127.0.0.1:${stack.gateway.port}/play`};
   const headers={'content-type':'application/json','cache-control':'no-store'};if(r.cookie)headers['set-cookie']=`${r.cookie}; Path=/; HttpOnly; SameSite=Lax`;
   res.writeHead(r.status,headers);res.end(JSON.stringify(body));
  }catch(e){log('mock http error',e.message);if(!res.headersSent)res.writeHead(500);res.end();}
 });
 await listenServer(http);
 const origin=`http://127.0.0.1:${http.address().port}`;
 const real=await mockAnticheat();
 stack=await startStack({gatewayOrigins:[origin],anticheat:real.anticheat,sceneDoors:real.sceneDoors});
 const held=JSON.parse(await readFile(new URL('../../browser/assets/recovered/deployables/manifest.json',import.meta.url))).held??{};
 let apartSpawn=null;
 if(apart>0){const scene=JSON.parse(await readFile(new URL('../../browser/assets/recovered/scene/manifest.json',import.meta.url))),d=p=>Math.abs(Math.hypot(p[0]-MOCK_SPAWN[0],p[2]+MOCK_SPAWN[2])-apart);
  const best=scene.world.spawnPoints.map(s=>s.position).sort((a,b)=>d(a)-d(b))[0];if(best)apartSpawn=[best[0],best[1],-best[2]];}
 const referee=createReferee({stack,catalogue,registry,held,log,apartSpawn,sceneDoors:real.sceneDoors});
 return {origin,serverId:stack.serverId,stack,referee,backpackLockMs:MOCK_BACKPACK_LOCK_MS,
  metrics:{url:`http://127.0.0.1:${stack.gateway.port}/metrics`,token:METRICS_TOKEN},
  // The site's server owner gives the harness account a role (the real run sets it up on the owner page).
  grantRole:(player,role)=>stack.call('POST',`/admin/servers/${stack.serverId}/roles`,{cookie:stack.owner.cookie,csrf:stack.owner.csrf,data:{player,role}}),
  rconPassword:MOCK_RCON_PASSWORD,apartSpawn,lineOfSight:Boolean(real.anticheat.lineOfSight),
  close:async()=>{referee.stop();http.closeAllConnections?.();await new Promise(r=>http.close(r));await stack.close();}};
}

// Plays the server side for every peer that connects to the mock uLink server.
function createReferee({stack,catalogue,registry,held,log,apartSpawn=null,sceneDoors=[]}){
 const attached=new WeakSet(),sleepers=new Map(),inventories=new Map(),peers=new Set();let nextView=100,firstUser=null; // above the scene doors' manual views (3-62) and the map crate (70)
 const apartFor=user=>apartSpawn&&firstUser!=null&&user!==firstUser?[...apartSpawn]:null;
 const all=()=>[...stack.native.peers.values()].filter(p=>attached.has(p));
 // Gameplay rows: held items, crafting, building, deployables, doors, loot, fires, damage, falls (tools/native/mock-world.mjs).
 const world=createMockWorld({catalogue,registry,held,peers:all,nextView:()=>nextView++,sceneDoors,backpackLockMs:MOCK_BACKPACK_LOCK_MS,log});
 world.setInventoryEncoder((slots,{capacity})=>inventoryFixture(catalogue,{capacity,slots}));
 const desktop=new Map([[MOCK_DESKTOP.id,MOCK_DESKTOP.name]]),banned=new Set();let polling=false;
 const chatAdd=(peer,from,text)=>peer.rpc(997,'CL_ConsoleCommand',['string'],[`chat.add ${quoteSafe(from)} ${quoteSafe(text)}`]);
 // RunCommand: same actions, failure reasons and server effects as the plugin (UnstickMove is RustServerManagement's
 // teleport RPC; the original moves to the other player's eye origin, the mock to their last reported position).
 function runCommand(c){
  const find=id=>all().find(p=>p.user===String(id)),target=find(c.targetId);
  switch(c.action){
   case 'teleport-to':case 'bring':{
    const actor=find(c.actorId);if(!actor)return 'admin-offline';if(!target)return 'player-offline';
    const [move,to]=c.action==='teleport-to'?[actor,target]:[target,actor];if(move.character==null||!to.last)return 'not-spawned';
    const at=[...to.last];move.rpc(1,'UnstickMove',['Vector3'],[at]);move.last=at;sleepers.set(move.user,at);return null;}
   case 'message':if(!target)return 'player-offline';chatAdd(target,'Admin',c.message??'');return null;
   case 'kick-native':if(desktop.delete(String(c.targetId)))return null;if(!target)return 'player-offline';target.kick(KICK_RCON);return null;
   case 'ban-native':banned.add(String(c.targetId));desktop.delete(String(c.targetId));target?.kick(KICK_RCON);return null;
   case 'unban-native':return banned.delete(String(c.targetId))?null:'not-banned';
   default:return 'unknown-action';
  }
 }
 const pluginPoll=setInterval(async()=>{
  if(polling)return;polling=true;
  try{
   const players=[...all().map(p=>({id:p.user,name:p.name})),...[...desktop].map(([id,name])=>({id,name}))];
   const r=await stack.plugin({type:'poll',players});
   for(const c of r.commands??[]){let reason;try{reason=runCommand(c);}catch(e){reason='error';log('referee command',c.action,e.message);}await stack.plugin({type:'command-result',id:c.id,ok:reason==null,...(reason?{reason}:{})});}
  }catch(e){log('referee poll',e.message);}finally{polling=false;}
 },PLUGIN_POLL_MS);
 const timer=setInterval(()=>{
  for(const peer of stack.native.peers.values())if(peer.playerId&&!attached.has(peer)){attached.add(peer);peers.add(peer);attach(peer);}
 },25);
 const sky=setInterval(()=>{for(const p of all())if(p.character)try{p.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[skyBytes(p.hour+=0.01)]);}catch{}},10000);
 function attach(peer){
  // The stack approves through the sidecar in order; the newest approval belongs to this peer (joins are sequential
  // per bot, and only the user id is needed: it keys sleepers and inventories like the server's character save).
  const approval=stack.approvals[stack.approvals.length-1];
  const user=peer.userId??String(approval?.userId??peer.playerId);firstUser??=user;
  Object.assign(peer,{user,character:null,admin:false,hour:9.5,last:null,name:'player'+peer.playerId});
  const slots=inventories.get(user)??(()=>{const s=Array(40).fill(null);for(const [i,v]of STARTER)s[i]={...v};inventories.set(user,s);return s;})();
  const gnup=()=>{if(peer.character!=null)peer.rpc(peer.character,'GNUP',['byte[]'],[inventoryFixture(catalogue,{slots})]);};
  Object.assign(peer,{slots,gnup});
  const reply=text=>peer.rpc(997,'CL_ConsoleMessage',['string'],[text]);
  const spawn=position=>{
   // A spawn point's rotation is a yaw (Euler(0, y, 0)); vary it per character so join.facing is not trivially level.
   const y=((nextView*47)%360)*Math.PI/360;peer.spawnRot=[0,Math.sin(y),0,Math.cos(y)];
   peer.character=nextView++;peer.last=position;peer.create({viewId:peer.character,owner:peer.playerId,group:world.cullGroup(position),prefab:':player_soldier',position,rotation:peer.spawnRot});
   gnup();peer.rpc(peer.character,'Local_HealthChange',['float','uLink.NetworkViewID'],[100,0]);
   peer.rpc(peer.character,'RecieveNetwork',['float','float','float','float','float','float'],[1000,0,0,0,0,0]);
   peer.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[skyBytes(peer.hour)]);
   world.spawned(peer,position);
  };
  function report(text){
   const m=/^\S+\s+(\S+)\s+([\s\S]+)$/.exec(text);if(!m)return chatAdd(peer,'Browser','Usage: /report <player name> <what happened>');
   const target=all().find(p=>p.name.toLowerCase()===m[1].toLowerCase());
   stack.plugin({type:'report',connectionId:peer.cid,targetName:m[1],targetId:target?.user??null,text:m[2]}).then(r=>chatAdd(peer,'Browser',
    r.ok?'Report sent to the server admins. Thank you.':r.reason==='not-linked'?'Link this character on the website (/browserlink) to send reports.':r.reason==='cooldown'?'Please wait a minute between reports.':'The report could not be sent right now.'),
    ()=>chatAdd(peer,'Browser','The report could not be sent right now.'));
  }
  const kick=peer.kick=reason=>{try{peer.rpc(1,'KP',['int'],[reason]);}catch{}setTimeout(()=>peer.connection.close('Kicked'),150);};
  peer.onUlink=(h,b)=>{
   try{
    if(h.rpc==='ClientFirstReady'&&!peer.character)return spawn(sleepers.get(user)??apartFor(user)??MOCK_SPAWN);
    if(h.rpc==='GetClientMove'&&h.viewId===peer.character){const m=readArgs(['Vector3','int','ushort'],b);peer.last=m[0];sleepers.set(user,peer.last);world.moved(peer,m);return;}
    // ServerManagement.RequestRespawn(campRequest): a fresh Default Loadout, at the newest own sleeping bag if asked.
    if(h.rpc==='RequestRespawn'&&peer.character==null){const [camp]=readArgs(['bool'],b);sleepers.delete(user);slots.fill(null);for(const [i,v]of STARTER)slots[i]={...v};return spawn((camp&&world.campSpawn(peer))||apartFor(user)||[MOCK_SPAWN[0]+8,MOCK_SPAWN[1],MOCK_SPAWN[2]+6]);}
    if(world.handle(peer,h,b))return;
    if(['ISMV','ITSM'].includes(h.rpc)){
     const [from,to]=readArgs(['byte','byte'],b);const a=slots[from],c=slots[to];
     if(a&&!c){slots[to]=a;slots[from]=null;}else if(a&&c&&a.name===c.name){c.uses+=a.uses;slots[from]=null;}
     world.checkHeld(peer);world.slotsChanged(peer,[from,to]);return gnup();
    }
    if(h.rpc==='ITSP')return gnup();
    if(h.rpc!=='SV_RunConsoleCommand')return;
    const [text]=readArgs(['string'],b),{name,args}=splitCommand(text);log('referee console',name);
    switch(name){
     case 'chat.say':{
      // /report <exact name> <what happened>: answered privately by the plugin, never broadcast.
      const said=String(args[0]??'').trim();if(/^\/report(\s|$)/i.test(said))return report(said);
      const line=`chat.add ${quoteSafe(peer.name)} ${quoteSafe(String(args[0]??'text').slice(0,128))}`;for(const p of all())p.rpc(997,'CL_ConsoleCommand',['string'],[line]);return;}
     case 'findsv':return reply(`Finding ${args[0]??''}:\nchat.say( ) : no help\nglobal.findsv( string Name ) : Search for a command (server-side)\n`);
     case 'rcon.login':
      if(!args.length)return reply('Specify a Password.');
      if(peer.admin)return reply('Already logged in.');
      if(args[0]===MOCK_RCON_PASSWORD){peer.admin=true;return reply('Logged in as admin.');}
      return kick(KICK_RCON);
     case 'suicide':
      if(peer.character==null)return reply('You dead!');
      peer.rpc(peer.character,'Local_HealthChange',['float','uLink.NetworkViewID'],[0,0]);reply('You suicided!');world.killed(peer,null);return;
     case 'lockentry.passwordentry':return world.passwordEntry(peer,String(args[0]??''),String(args[1]).toLowerCase()==='true');
    }
    // [Admin] commands: ConsoleSystem.RunCommand fails the permission check, so the server sends no reply at all.
    if(!peer.admin)return;
    switch(name){
     case 'status':return reply(`hostname: Mock Legacy\nversion : 1069 secure (secure mode enabled, connected to Steam3)\nmap     : rust_island_2013\nplayers : ${all().length} (50 max)\n\n`);
     case 'env.time':{const h=Number(args[0]);if(Number.isFinite(h)&&h>=0){peer.hour=h;for(const p of all()){p.hour=h;p.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[skyBytes(h)]);}return reply('Set Time To: '+h);}return reply('Current Time: '+peer.hour);}
     case 'inv.give':{const item=args[0],n=Math.max(1,Number(args[1]??1)|0);if(!Object.values(catalogue.items).some(i=>i.data.m_Name===item))return reply('No item with name: '+item);
      if(world.addItem(slots,item,n)===n)return reply('Inventory full');gnup();return reply(`Gave ${n} ${item}(s) between 1 inventories`);}
     // teleport.toplayer "from" "to" / teleport.topos "name" x y z (RustServerManagement teleports: UnstickMove).
     case 'teleport.toplayer':{const find=t=>all().filter(p=>p.character!=null&&p.name.toLowerCase().includes(String(t??'').toLowerCase()));const [from,to]=args.length>=2?[find(args[0]),find(args[1])]:[[peer],find(args[0])];let n=0;
      if(to[0]?.last)for(const p of from)if(p!==to[0]){world.teleport(p,to[0].last);n++;}return reply(`moved ${n} player(s) named "${args[0]}" to other players with name "${args[1]??args[0]}"`);}
     case 'teleport.topos':{const at=args.slice(1,4).map(Number);if(at.length<3||at.some(v=>!Number.isFinite(v)))return;for(const p of all().filter(p=>p.character!=null&&p.name.toLowerCase().includes(String(args[0]).toLowerCase())))world.teleport(p,at);return;}
     case 'airdrop.drop':{reply('Called airdrop...');const v=nextView++;const at=peer.last??MOCK_SPAWN;peer.create({viewId:v,prefab:'C130',position:[at[0]-1200,at[1]+400,at[2]]});return;}
     case 'kick':{const targets=all().filter(p=>p.name.toLowerCase().includes(String(args[0]??'').toLowerCase()));reply(targets.length?`Kicked ${targets.length} users!`:"Couldn't find anyone!");for(const p of targets)p.kick(KICK_RCON);return;}
    }
   }catch(e){log('referee error',h.rpc,e.message);}
  };
  // The Oxide plugin / vanilla adapter reports disconnects so the sidecar releases the identity lease.
  peer.connection.on('closed',()=>{stack.plugin({type:'disconnect',connectionId:peer.cid}).catch(()=>{});peer.dropHeld?.();for(const p of all())if(p!==peer&&peer.character!=null)try{p.destroyView(peer.character);}catch{}});
  peer.create({viewId:1,prefab:'ServerManagement'});
  world.attach(peer);
 }
 return {
  // The in-game name the referee uses for chat.add/kick: the harness tells it the website display name.
  nameFor(playerId,name){for(const p of stack.native.peers.values())if(p.playerId===playerId)p.name=name;},
  peers:()=>all(),
  stop(){clearInterval(timer);clearInterval(sky);clearInterval(pluginPoll);world.stop();},
 };
}
