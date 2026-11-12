// Admin tooling routes for the central service (ANTICHEAT-ADMIN-PLAN.md): per-server roles, live roster with
// anti-cheat scores and evidence, kicks, account bans, player reports and the audit log. Mounted by service.mjs.
//
// Website (session cookie + CSRF): GET /admin/servers, GET /admin/servers/{id}/players, GET .../flags?player=,
//   POST .../kick, GET|POST .../bans, POST .../unban, GET|POST .../roles, GET .../audit, GET .../reports?status=,
//   POST .../resolve-report, POST .../command, GET .../commands, GET|POST .../policy, GET .../alts?player=, GET .../holds,
//   POST .../clear-hold; screenshots (central/screenshots.mjs); GET .../player-history (central/player-history.mjs);
//   IP history and IP bans (central/ip-bans.mjs); staff: GET|POST /staff/email-domains;
//   players: POST /servers/{id}/reports
// Bridge (per-server bearer credential): POST /bridge/report {players, flags, events, stats?} → {kicks, commands, screenshots}
// In-game actions are a fixed list run by the server plugin with the original APIs (bridge/adapter.mjs ADMIN_ACTIONS).
import {randomUUID} from 'node:crypto';
import {DEFAULT_POLICY} from './db.mjs';
import {createScreenshotRoutes} from './screenshots.mjs';
import {ingestStats} from './stats.mjs';
import {createPlayerHistoryRoutes,createNameRecorder} from './player-history.mjs';
import {createIpRoutes} from './ip-bans.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const RANK={moderator:1,admin:2,owner:3,staff:4};
const MODERATOR_MAX_BAN_MINUTES=24*60,MAX_BAN_MINUTES=10*365*24*60,ROSTER_STALE_MS=30e3,REVIEW_SCORE=50;
const REPORT_REASONS=new Set(['cheating','abuse','griefing','other']),REPORTS_PER_HOUR=10;
const MAX_REPORT_BODY=512*1024,MAX_FLAG_DETAIL=64*1024,COMMAND_EXPIRY_MS=2*60e3;
// Minimum role per in-game action. teleport-to moves the admin's own character; bring moves the player.
// Server-list bans by command (desktop players; account bans use POST .../bans) need an admin: a desktop player's
// rank is unknown here when the character is not linked to an account.
const COMMAND_ROLE={'teleport-to':'moderator',message:'moderator','kick-native':'moderator',bring:'admin','ban-native':'admin','unban-native':'admin'};
const HANDLE=/^[A-Za-z0-9_-]{16}$/;
const NEEDS_REASON=new Set(['kick-native','ban-native','unban-native']);
const MAX_POLICY_AGE_MINUTES=30*24*60,ROSTER_GAP_MS=60e3,DOMAIN=/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// Join policy fields (API name → column, bounds). steam*Bans: -1 = any number.
const POLICY_FIELDS={minAccountAgeMinutes:['min_account_age_minutes',0,MAX_POLICY_AGE_MINUTES],steamMinAgeDays:['steam_min_age_days',0,3650],steamMinLevel:['steam_min_level',0,500],
 steamMaxVacBans:['steam_max_vac_bans',-1,100],steamMaxGameBans:['steam_max_game_bans',-1,100],steamMinDaysSinceBan:['steam_min_days_since_ban',0,3650],screenshotAutoSeverity:['screenshot_auto_severity',0,100]};
const POLICY_FLAGS={requireSteam:'require_steam',requirePhone:'require_phone'};
export function policyView(p){const v={};for(const [k,[col]] of Object.entries(POLICY_FIELDS))v[k]=p[col];for(const [k,col] of Object.entries(POLICY_FLAGS))v[k]=Boolean(p[col]);return v;}
const parse=s=>{try{return s?JSON.parse(s):null;}catch{return null;}};
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim():null;

export function createAdminRoutes({db,now,website,body,bridge,limited,HttpError,identity=null,screenshotRetentionMs,hashKey=s=>s,ips=null}){
 const rosters=new Map();      // server → {at, players:[{subject,name,playerId,score,flags,connectedAt}]}
 const pendingKicks=new Map(); // server → Map(subject → reason)
 const recordNames=createNameRecorder(db); // in-game names for the player history (central/player-history.mjs)

 const roleOn=(server,uuid)=>db.isStaff(uuid)?'staff':server.owner_uuid===uuid?'owner':db.serverRole(server.uuid,uuid);
 // Unknown servers and servers where the caller has no role look the same (no enumeration).
 // The host app's key (Authorization: Bearer rlbh_…) acts as the server's owner, on that one server only. A bearer
 // header is not sent by browsers on their own, so it needs no CSRF token.
 function hostKey(req,id){
  const m=/^Bearer (rlbh_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');if(!m)return null;
  const server=db.hostTokenServer(hashKey(m[1]),now());
  if(!server||server!==id)throw new HttpError(404,'unknown-server');
  return {player:db.player(db.server(id).owner_uuid),via:'host'};
 }
 function staffOn(req,id,{mutation=false,min='moderator'}={}){
  const ctx=hostKey(req,id)??website(req,{mutation}),server=db.server(id),role=server&&roleOn(server,ctx.player.uuid);
  if(!role)throw new HttpError(404,'unknown-server');
  if(RANK[role]<RANK[min])throw new HttpError(403,'insufficient-role');
  return {...ctx,server,role};
 }
 // Staff act only on accounts that rank below them on this server, never on themselves.
 function target(ctx,uuid){
  if(typeof uuid!=='string'||!UUID.test(uuid)||!db.player(uuid))throw new HttpError(404,'unknown-player');
  if(uuid===ctx.player.uuid)throw new HttpError(400,'cannot-target-self');
  const rank=RANK[roleOn(ctx.server,uuid)]??0;
  if(rank>=RANK[ctx.role])throw new HttpError(403,'target-outranks-you');
  return uuid;
 }
 const fresh=server=>{const r=rosters.get(server);return r&&now()-r.at<=ROSTER_STALE_MS?r:null;};
 const queueKick=(server,subject,reason)=>{if(!pendingKicks.has(server))pendingKicks.set(server,new Map());pendingKicks.get(server).set(subject,reason);};
 const audit=(ctx,action,detail)=>db.audit(now(),ctx.player.uuid,action,ctx.server.uuid,ctx.via?{...detail,via:ctx.via}:detail);
 const query=req=>new URL(req.url,'http://central').searchParams;
 const ipRoutes=ips?createIpRoutes({db,ips,now,body,HttpError,staffOn,target,audit,query,rosters,queueKick}):null;
 const banView=b=>({id:b.id,player:b.player_uuid,name:b.display_name,scope:b.server_uuid?'server':'global',reason:b.reason,createdBy:b.created_by,createdAt:b.created_at,expiresAt:b.expires_at,revokedAt:b.revoked_at,active:!b.revoked_at&&(b.expires_at==null||b.expires_at>now())});

 const routes={
  'GET /admin/servers':async req=>{
   const {player}=website(req,{mutation:false}),staff=db.isStaff(player.uuid);
   const list=staff?db.allServers():[...db.ownedServers(player.uuid).map(s=>db.server(s.uuid)),...db.rolesFor(player.uuid).map(r=>db.server(r.server_uuid))];
   return [200,{player:player.uuid,staff,servers:list.filter(Boolean).map(s=>({id:s.uuid,name:s.name,role:roleOn(s,player.uuid),online:Boolean(fresh(s.uuid))}))}];
  },
  // Accounts known to this server (host app Accounts page): desktop links and accounts that played, with ban state.
  'GET /admin/servers/:id/accounts':async(req,id)=>{
   const ctx=staffOn(req,id),t=now(),out=new Map(),r=fresh(id),online=new Set((r?.players??[]).map(p=>p.subject));
   for(const p of db.serverPlayers(id))out.set(p.player_uuid,{player:p.player_uuid,name:p.display_name,firstSeen:p.first_seen,lastSeen:p.last_seen,link:null});
   for(const l of db.linksFor(id)){const a=out.get(l.player_uuid)??{player:l.player_uuid,name:l.display_name,firstSeen:null,lastSeen:null};a.link={backendRef:l.backend_ref,linkedAt:l.created_at};out.set(l.player_uuid,a);}
   const accounts=[...out.values()].map(a=>({...a,online:online.has(a.player),banned:Boolean(db.activeBan(a.player,id,t))}));
   return [200,{accounts,hostKey:db.hostTokenInfo(id),role:ctx.role}];
  },
  // Desktop link requests (/browserlink codes redeemed on the website) and how far each got.
  'GET /admin/servers/:id/link-requests':async(req,id)=>{
   staffOn(req,id);
   return [200,{requests:db.linkRequestsFor(id,100).map(r=>({id:r.id,player:r.player_uuid,name:r.display_name,status:r.status,reason:r.reason,createdAt:r.created_at,updatedAt:r.updated_at}))}];
  },
  'GET /admin/servers/:id/players':async(req,id)=>{
   const ctx=staffOn(req,id),r=fresh(id),t=now();
   const players=(r?.players??[]).map(p=>({player:p.subject,name:p.name,score:p.score,flags:p.flags,connectedAt:p.connectedAt,review:p.score>=REVIEW_SCORE,banned:Boolean(db.activeBan(p.subject,id,t))})).sort((a,b)=>b.score-a.score);
   // Desktop players come from the server plugin (no anti-cheat scores: they do not pass through the gateway).
   // Their movement is scored by the adapter from server-side positions (speed, teleport, fly), not by the gateway.
   const desktop=(r?.desktop??[]).map(p=>({handle:p.handle,name:p.name,player:p.subject??null,account:p.subject?db.player(p.subject)?.display_name??null:null,banned:p.subject?Boolean(db.activeBan(p.subject,id,t)):false,score:p.score??0,flags:p.flags??{},review:(p.score??0)>=REVIEW_SCORE})).sort((a,b)=>b.score-a.score);
   return [200,{role:ctx.role,online:Boolean(r),reportedAt:r?.at??null,players,desktop}];
  },
  'GET /admin/servers/:id/flags':async(req,id)=>{
   staffOn(req,id);const player=query(req).get('player');
   if(!player||!UUID.test(player))throw new HttpError(400,'invalid-player');
   return [200,{flags:db.flagsFor(id,player,100).map(f=>({...f,detail:parse(f.detail)}))}];
  },
  // Recent flags across players, newest first (no evidence detail; open a player's flags for that).
  'GET /admin/servers/:id/recent-flags':async(req,id)=>{staffOn(req,id);return [200,{flags:db.recentFlags(id,200)}];},
  'GET /admin/servers/:id/desktop-flags':async(req,id)=>{
   staffOn(req,id);const handle=query(req).get('handle');
   if(!handle||!HANDLE.test(handle))throw new HttpError(400,'invalid-handle');
   return [200,{flags:db.desktopFlagsFor(id,handle,100).map(f=>({...f,detail:parse(f.detail)}))}];
  },
  // Item transfers the server adapter saw on this server (newest first), optionally for one account or desktop handle.
  'GET /admin/servers/:id/transfers':async(req,id)=>{
   staffOn(req,id);const q=query(req),player=q.get('player'),handle=q.get('handle');
   if(player&&!UUID.test(player))throw new HttpError(400,'invalid-player');
   if(handle&&!HANDLE.test(handle))throw new HttpError(400,'invalid-handle');
   const names=new Map();const nameOf=u=>{if(!u)return null;if(!names.has(u))names.set(u,db.player(u)?.display_name??null);return names.get(u);};
   return [200,{transfers:db.transferLog(id,{player,handle,limit:200}).map(r=>({id:r.id,at:r.at,item:r.item,amount:r.amount,via:r.via,
    from:{player:r.from_uuid,handle:r.from_handle,name:r.from_name??nameOf(r.from_uuid)},to:{player:r.to_uuid,handle:r.to_handle,name:r.to_name??nameOf(r.to_uuid)}}))}];
  },
  'POST /admin/servers/:id/kick':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true}),b=await body(req),player=target(ctx,b.player),reason=text(b.reason,200);
   if(!reason)throw new HttpError(400,'reason-required');
   queueKick(id,player,'kicked');audit(ctx,'admin.kick',{player,reason});
   return [202,{queued:true,online:Boolean(fresh(id)?.players.some(p=>p.subject===player))}];
  },
  'GET /admin/servers/:id/bans':async(req,id)=>{staffOn(req,id);return [200,{bans:db.bansFor(id,200).map(banView)}];},
  'POST /admin/servers/:id/bans':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true}),b=await body(req),player=target(ctx,b.player),reason=text(b.reason,200);
   if(!reason)throw new HttpError(400,'reason-required');
   const scope=b.scope??'server';if(scope!=='server'&&scope!=='global')throw new HttpError(400,'invalid-scope');
   if(scope==='global'&&ctx.role!=='staff')throw new HttpError(403,'insufficient-role');
   const minutes=b.minutes??null;
   if(minutes!==null&&!(Number.isInteger(minutes)&&minutes>=1&&minutes<=MAX_BAN_MINUTES))throw new HttpError(400,'invalid-duration');
   if((minutes===null||minutes>MODERATOR_MAX_BAN_MINUTES)&&RANK[ctx.role]<RANK.admin)throw new HttpError(403,'insufficient-role');
   const ban={id:randomUUID(),player,server:scope==='server'?id:null,reason,by:ctx.player.uuid,at:now(),expires:minutes===null?null:now()+minutes*60e3};
   // native: also put the server identity on the game server's own ban list (blocks a linked desktop character too).
   const native=b.native===true;if(native&&scope!=='server')throw new HttpError(400,'native-needs-server-scope');
   // banIps: also ban the addresses the account played from on this server (admins and above, as IP bans).
   if(b.banIps===true&&(!ipRoutes||RANK[ctx.role]<RANK.admin))throw new HttpError(403,'insufficient-role');
   db.tx(()=>{
    // The ban also covers every identifier the account has used (central/identity.mjs); the count goes in the log.
    db.addBan(ban);audit(ctx,'admin.ban',{player,ban:ban.id,scope,minutes,reason,native:native||undefined,linkedIdentifiers:db.identifiersFor(player).length});
    if(native)db.addCommand({id:randomUUID(),server:id,actor:ctx.player.uuid,player,action:'ban-native',args:{ban:ban.id,reason},at:now()});
   });
   // Kick now wherever the account is playing; later reports keep enforcing the ban as well.
   for(const [server,r] of rosters)if((scope==='global'||server===id)&&r.players.some(p=>p.subject===player))queueKick(server,player,'banned');
   const ipBans=b.banIps===true?ipRoutes.banAccountIps(ctx,player,{scope,expires:ban.expires,reason}):undefined;
   return [201,{ban:{id:ban.id,scope,expiresAt:ban.expires},...(ipBans?{ipBans}:{})}];
  },
  'POST /admin/servers/:id/unban':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true,min:'admin'}),b=await body(req),ban=typeof b.ban==='string'&&db.ban(b.ban);
   if(!ban||(ban.server_uuid&&ban.server_uuid!==id))throw new HttpError(404,'unknown-ban');
   if(!ban.server_uuid&&ctx.role!=='staff')throw new HttpError(403,'insufficient-role');
   if(!db.revokeBan(ban.id,ctx.player.uuid,now()))throw new HttpError(409,'already-revoked');
   audit(ctx,'admin.unban',{player:ban.player_uuid,ban:ban.id,reason:text(b.reason,200)});
   if(ban.server_uuid&&db.nativeBanCommand(id,ban.id))db.addCommand({id:randomUUID(),server:id,actor:ctx.player.uuid,player:ban.player_uuid,action:'unban-native',args:{ban:ban.id},at:now()});
   return [200,{revoked:true}];
  },
  'GET /admin/servers/:id/roles':async(req,id)=>{
   const ctx=staffOn(req,id,{min:'admin'}),owner=db.player(ctx.server.owner_uuid);
   return [200,{owner:{player:owner.uuid,name:owner.display_name},roles:db.serverRoles(id).map(r=>({player:r.player_uuid,name:r.display_name,role:r.role,grantedAt:r.granted_at}))}];
  },
  // Admins manage moderators; only the owner (or platform staff) grants, changes or removes admins.
  'POST /admin/servers/:id/roles':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true,min:'admin'}),b=await body(req),player=target(ctx,b.player);
   const role=b.role??null;if(role!==null&&role!=='admin'&&role!=='moderator')throw new HttpError(400,'invalid-role');
   const current=db.serverRole(id,player);
   if((role==='admin'||current==='admin')&&RANK[ctx.role]<RANK.owner)throw new HttpError(403,'insufficient-role');
   db.tx(()=>{db.setServerRole(id,player,role,ctx.player.uuid,now());audit(ctx,'admin.role',{player,from:current,to:role});});
   return [200,{player,role}];
  },
  'GET /admin/servers/:id/audit':async(req,id)=>{
   staffOn(req,id,{min:'admin'});
   const names=new Map();const name=uuid=>{if(!UUID.test(uuid??''))return uuid;if(!names.has(uuid))names.set(uuid,db.player(uuid)?.display_name??null);return names.get(uuid);};
   return [200,{events:db.recentAudit(id,200).map(e=>{const detail=parse(e.detail);return {id:e.id,at:e.at,actor:e.actor,actorName:name(e.actor),action:e.action,detail,playerName:detail?.player?name(detail.player):undefined};})}];
  },
  'GET /admin/servers/:id/reports':async(req,id)=>{
   staffOn(req,id);const status=query(req).get('status')??'open';
   if(!['open','resolved','dismissed'].includes(status))throw new HttpError(400,'invalid-status');
   return [200,{reports:db.reportsFor(id,status,200).map(r=>({id:r.id,player:r.player_uuid,name:r.reported_name,reporter:r.reporter_uuid,reporterName:r.reporter_name,reason:r.reason,detail:r.detail,createdAt:r.created_at,status:r.status,resolution:r.resolution}))}];
  },
  'POST /admin/servers/:id/resolve-report':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true}),b=await body(req),r=typeof b.report==='string'&&db.report(b.report);
   if(!r||r.server_uuid!==id)throw new HttpError(404,'unknown-report');
   if(b.status!=='resolved'&&b.status!=='dismissed')throw new HttpError(400,'invalid-status');
   const note=typeof b.note==='string'?b.note.trim().slice(0,500):null;
   if(!db.resolveReport(r.id,b.status,ctx.player.uuid,note,now()))throw new HttpError(409,'already-resolved');
   audit(ctx,'admin.report-'+b.status,{report:r.id,player:r.player_uuid??undefined,note});
   return [200,{status:b.status}];
  },
  // In-game actions through the server plugin. The server must be reporting (live gateway) to deliver them.
  'POST /admin/servers/:id/command':async(req,id)=>{
   const b=await body(req),ctx=staffOn(req,id,{mutation:true});
   // A desktop player with a linked account is handled like any account (rank checks apply).
   // Lifting a server-list ban targets a player who is offline: accept handles this server banned before.
   const banned=b.action==='unban-native'&&typeof b.handle==='string'?db.nativeBanFor(id,b.handle):null;
   const desktop=typeof b.handle==='string'&&b.player===undefined?fresh(id)?.desktop?.find(p=>p.handle===b.handle)??(banned&&fresh(id)?{handle:banned.handle,name:banned.name}:null):null;
   if(typeof b.handle==='string'&&b.player===undefined&&!desktop)throw new HttpError(fresh(id)?404:409,fresh(id)?'unknown-player':'server-offline');
   if(desktop?.subject)b.player=desktop.subject;
   const min=Object.hasOwn(COMMAND_ROLE,b.action)?COMMAND_ROLE[b.action]:null;
   if(!min)throw new HttpError(400,'invalid-action');
   if(RANK[ctx.role]<RANK[min])throw new HttpError(403,'insufficient-role');
   const message=b.action==='message'?text(b.message,200):undefined,reason=text(b.reason,200);
   if(b.action==='message'&&!message)throw new HttpError(400,'message-required');
   if(NEEDS_REASON.has(b.action)&&!reason)throw new HttpError(400,'reason-required');
   if(b.player===undefined){
    const command={id:randomUUID(),server:id,actor:ctx.player.uuid,handle:desktop.handle,name:desktop.name,action:b.action,args:{...(message?{message}:{}),...(reason?{reason}:{})},at:now()};
    db.tx(()=>{db.addNativeCommand(command);audit(ctx,'admin.command',{handle:desktop.handle,name:desktop.name,action:b.action,command:command.id,message,reason});});
    return [202,{command:command.id}];
   }
   const player=target(ctx,b.player);
   if(!fresh(id))throw new HttpError(409,'server-offline');
   const command={id:randomUUID(),server:id,actor:ctx.player.uuid,player,action:b.action,args:{...(message?{message}:{}),...(reason?{reason}:{})},at:now()};
   db.tx(()=>{db.addCommand(command);audit(ctx,'admin.command',{player,action:b.action,command:command.id,message,reason});});
   return [202,{command:command.id}];
  },
  'GET /admin/servers/:id/commands':async(req,id)=>{
   staffOn(req,id);const t=now();
   const status=c=>c.status==='sent'&&t-c.updated_at>COMMAND_EXPIRY_MS?'no-result':c.status;
   const commands=[...db.recentCommands(id,50).map(c=>({id:c.id,action:c.action,player:c.player_uuid,name:c.player_name,actorName:c.actor_name,createdAt:c.created_at,status:status(c),reason:c.reason})),
    ...db.recentNativeCommands(id,50).map(c=>({id:c.id,action:c.action,handle:c.handle,name:c.name,desktop:true,actorName:c.actor_name,createdAt:c.created_at,status:status(c),reason:c.reason}))];
   return [200,{commands:commands.sort((a,b)=>b.createdAt-a.createdAt).slice(0,50)}];
  },
  'GET /admin/servers/:id/policy':async(req,id)=>{staffOn(req,id);return [200,policyView(db.policy(id))];},
  // Every field is optional (unchanged when absent). Steam is never required unless the server turns it on; the Steam
  // quality thresholds apply only together with requireSteam.
  'POST /admin/servers/:id/policy':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true,min:'admin'}),b=await body(req),p={...DEFAULT_POLICY,...db.policy(id)};
   for(const [k,[col,min,max]] of Object.entries(POLICY_FIELDS))if(b[k]!==undefined){if(!Number.isInteger(b[k])||b[k]<min||b[k]>max)throw new HttpError(400,'invalid-policy');p[col]=b[k];}
   for(const [k,col] of Object.entries(POLICY_FLAGS))if(b[k]!==undefined){if(typeof b[k]!=='boolean')throw new HttpError(400,'invalid-policy');p[col]=b[k]?1:0;}
   const view=policyView(p);
   db.tx(()=>{db.savePolicy(id,p,ctx.player.uuid,now());audit(ctx,'admin.policy',view);});
   return [200,view];
  },
  // Accounts that may be the same person: shared device, signals + IP, hard identifiers, item transfers between new
  // accounts. Hashes only; the reasons are shown, never the values. Looking is audited.
  'GET /admin/servers/:id/alts':async(req,id)=>{
   const ctx=staffOn(req,id),player=query(req).get('player');
   if(!player||!UUID.test(player)||!db.player(player))throw new HttpError(400,'invalid-player');
   if(!identity)return [200,{networks:[],devices:0,alts:[]}];
   audit(ctx,'admin.alts-view',{player});
   return [200,identity.alts(player,{server:id})];
  },
  // Accounts held or refused because they share an identifier with an account banned here (or network-wide, for staff).
  'GET /admin/servers/:id/holds':async(req,id)=>{
   const ctx=staffOn(req,id);
   return [200,{holds:db.holdsFor(id,ctx.role==='staff',now()).map(h=>({id:h.id,player:h.player_uuid,name:h.display_name,kind:h.kind,hard:Boolean(h.hard),scope:h.server_uuid?'server':'global',bannedName:h.banned_name,banReason:h.ban_reason,ban:h.ban_id,createdAt:h.created_at}))}];
  },
  'POST /admin/servers/:id/clear-hold':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true,min:'admin'}),b=await body(req),h=typeof b.hold==='string'&&db.holdById(b.hold);
   if(!h||(h.server_uuid&&h.server_uuid!==id))throw new HttpError(404,'unknown-hold');
   if(!h.server_uuid&&ctx.role!=='staff')throw new HttpError(403,'insufficient-role');
   if(!db.resolveHold(h.id,'cleared',ctx.player.uuid,now()))throw new HttpError(409,'already-resolved');
   audit(ctx,'admin.hold-cleared',{player:h.player_uuid,ban:h.ban_id,kind:h.kind,reason:text(b.reason,200)});
   return [200,{cleared:true}];
  },
  // Platform staff: throwaway email domains added on top of central/data/disposable-domains.txt (no deploy needed).
  'GET /staff/email-domains':async req=>{const {player}=website(req,{mutation:false});if(!db.isStaff(player.uuid))throw new HttpError(403,'staff-only');return [200,{domains:db.blockedDomains().map(d=>({domain:d.domain,addedAt:d.added_at}))}];},
  'POST /staff/email-domains':async req=>{
   const {player}=website(req,{mutation:true});if(!db.isStaff(player.uuid))throw new HttpError(403,'staff-only');
   const b=await body(req),domain=String(b.domain??'').trim().toLowerCase();
   if(!DOMAIN.test(domain)||typeof b.blocked!=='boolean')throw new HttpError(400,'invalid-domain');
   if(db.setBlockedDomain(domain,b.blocked,player.uuid,now()))db.audit(now(),player.uuid,b.blocked?'staff.email-domain-blocked':'staff.email-domain-unblocked','network',{domain});
   return [200,{domain,blocked:b.blocked}];
  },
  // Any signed-in player may report someone on a server by in-game name; it resolves against the live roster.
  'POST /servers/:id/reports':async(req,id)=>{
   if(limited(req,'report'))throw new HttpError(429,'rate-limited');
   const {player}=website(req,{mutation:true}),b=await body(req),s=db.server(id);
   if(!s||s.status!=='active')throw new HttpError(404,'unknown-server');
   const name=text(b.name,32),reason=REPORT_REASONS.has(b.reason)?b.reason:null;
   if(!name||!reason)throw new HttpError(400,'invalid-report');
   if(db.openReportsBy(player.uuid,now()-3600e3)>=REPORTS_PER_HOUR)throw new HttpError(429,'rate-limited');
   const match=fresh(id)?.players.find(p=>p.name.toLowerCase()===name.toLowerCase());
   if(match?.subject===player.uuid)throw new HttpError(400,'cannot-target-self');
   const report={id:randomUUID(),server:id,reporter:player.uuid,player:match?.subject,name,reason,detail:typeof b.detail==='string'?b.detail.trim().slice(0,500):null,at:now()};
   db.addReport(report);
   return [201,{report:report.id,matched:Boolean(match)}];
  },
  // Gateway report: live roster + new anti-cheat evidence. Reply: kicks queued by admins plus every rostered
  // account with an active ban (so a ban applies within one report interval, wherever the account plays).
  'POST /bridge/report':async req=>{
   const server=bridge(req),b=await body(req,MAX_REPORT_BODY),t=now();
   const events=b.events??[];
   if(!Array.isArray(b.players)||b.players.length>1000||!Array.isArray(b.flags)||b.flags.length>500||!Array.isArray(events)||events.length>500)throw new HttpError(400,'invalid-report');
   const int=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max?v:0;
   const players=b.players.filter(p=>typeof p?.subject==='string'&&UUID.test(p.subject)).map(p=>({subject:p.subject,name:String(p.name??'').slice(0,32),playerId:int(p.playerId,65535),score:int(p.score,1e6),connectedAt:Number.isFinite(p.connectedAt)?p.connectedAt:null,
    flags:Object.fromEntries(Object.entries(p.flags&&typeof p.flags==='object'?p.flags:{}).filter(([k,v])=>/^[a-z][a-z-]{0,31}$/.test(k)&&Number.isInteger(v)).slice(0,32).map(([k,v])=>[k,int(v,1e6)]))}));
   // Desktop roster from the adapter (opaque handles); kept from the last report that carried one.
   const kinds=f=>Object.fromEntries(Object.entries(f&&typeof f==='object'?f:{}).filter(([k,v])=>/^[a-z][a-z-]{0,31}$/.test(k)&&Number.isInteger(v)).slice(0,32).map(([k,v])=>[k,int(v,1e6)]));
   const reported=Array.isArray(b.desktop)?b.desktop.slice(0,500).filter(p=>typeof p?.handle==='string'&&HANDLE.test(p.handle)):null;
   const desktop=reported?reported.map(p=>({handle:p.handle,name:String(p.name??'').slice(0,32),...(typeof p.subject==='string'&&UUID.test(p.subject)?{subject:p.subject}:{}),score:int(p.score,1e6),flags:kinds(p.flags)})):rosters.get(server)?.desktop??[];
   // Desktop addresses (central/ip-bans.mjs) are logged, never kept in the in-memory roster the moderators' page reads.
   const desktopIps=(reported??[]).filter(p=>typeof p.ip==='string'&&p.ip.length<=45).map(p=>({handle:p.handle,name:String(p.name??'').slice(0,32),ip:p.ip}));
   // Leaderboard counts and playtime (central/stats.mjs), against the previous report's roster and time.
   if(b.stats===undefined||Array.isArray(b.stats))ingestStats(db,{server,players,previous:rosters.get(server),stats:b.stats??[],t});
   rosters.set(server,{at:t,players,desktop});
   recordNames(server,{players,desktop:Array.isArray(b.desktop)?desktop:null},t);
   db.tx(()=>{for(const p of players)if(db.player(p.subject))db.touchPlaySession(server,p.subject,p.connectedAt,t,ROSTER_GAP_MS);});
   const online=new Set(players.map(p=>p.subject));
   db.tx(()=>{for(const f of b.flags){
    if(typeof f?.subject!=='string'||!UUID.test(f.subject)||!/^[a-z][a-z-]{0,31}$/.test(f.kind??'')||!db.player(f.subject))continue;
    let detail=JSON.stringify({detail:f.detail??null,replay:f.replay??undefined});
    if(detail.length>MAX_FLAG_DETAIL)detail=JSON.stringify({detail:f.detail??null,replayTruncated:true}).slice(0,MAX_FLAG_DETAIL);
    const at=Number.isFinite(f.at)&&Math.abs(f.at-t)<86400e3?f.at:t;
    const severity=int(f.severity,100),flag=Number(db.addFlag({server,player:f.subject,at,received:t,kind:f.kind,severity,score:int(f.score,1e6),detail}).lastInsertRowid);
    if(online.has(f.subject))screenshots.auto(server,f.subject,{id:flag,kind:f.kind,severity});
   }});
   // Adapter events: results of in-game admin commands, and /report from linked characters.
   db.tx(()=>{for(const e of events){
    if(e?.type==='command-result'&&typeof e.id==='string'){
     const status=e.ok===true?'done':'failed',why=e.ok===true?null:String(e.reason??'failed').slice(0,40);
     if((db.setCommandStatus(e.id,server,status,why,t)||db.setNativeCommandStatus(e.id,server,status,why,t))&&e.ok!==true)db.audit(t,'bridge','admin.command-failed',server,{command:e.id,reason:why});
    }else if(e?.type==='desktop-flag'&&typeof e.handle==='string'&&HANDLE.test(e.handle)&&/^[a-z][a-z-]{0,31}$/.test(e.kind??'')){
     let detail=JSON.stringify({detail:e.detail??null,replay:e.replay??undefined});
     if(detail.length>MAX_FLAG_DETAIL)detail=JSON.stringify({detail:e.detail??null,replayTruncated:true}).slice(0,MAX_FLAG_DETAIL);
     const player=typeof e.subject==='string'&&UUID.test(e.subject)&&db.player(e.subject)?e.subject:null;
     db.addDesktopFlag({server,handle:e.handle,name:String(e.name??'').slice(0,32),player,at:Number.isFinite(e.at)&&Math.abs(e.at-t)<86400e3?e.at:t,received:t,kind:e.kind,severity:int(e.severity,100),score:int(e.score,1e6),detail});
    }else if(e?.type==='report'&&typeof e.reporter==='string'&&UUID.test(e.reporter)&&db.player(e.reporter)){
     const name=text(e.targetName,32);if(!name||db.openReportsBy(e.reporter,t-3600e3)>=REPORTS_PER_HOUR)continue;
     const target=typeof e.target==='string'&&UUID.test(e.target)&&db.player(e.target)?e.target:players.find(p=>p.name.toLowerCase()===name.toLowerCase())?.subject;
     if(target===e.reporter)continue;
     db.addReport({id:randomUUID(),server,reporter:e.reporter,player:target,name,reason:'in-game',detail:typeof e.text==='string'?e.text.trim().slice(0,500):null,at:t});
    }else if(e?.type==='link-removed'&&typeof e.subject==='string'&&UUID.test(e.subject)){
     // The owner unlinked an account in the host app; the adapter (authoritative) already removed it.
     if(db.removeLink(server,e.subject))db.audit(t,'adapter','link-removed',server,{player:e.subject,backendId:String(e.backendId??'').slice(0,24),reason:String(e.reason??'').slice(0,200)});
     else db.audit(t,'adapter','link-removed',server,{player:e.subject,reason:String(e.reason??'').slice(0,200),browserCharacter:true});
    }else if(e?.type==='item-transfer'){
     // The server adapter saw items from one player reach another's inventory (bridge/item-transfers.mjs). Logged by
     // account and/or handle as evidence; between two accounts it also feeds the alt links between new accounts.
     const account=u=>typeof u==='string'&&UUID.test(u)&&db.player(u)?u:null,handle=h=>typeof h==='string'&&HANDLE.test(h)?h:null;
     const from=account(e.from),to=account(e.to),fromHandle=handle(e.fromHandle),toHandle=handle(e.toHandle);
     if(!(from||fromHandle)||!(to||toHandle)||(from&&from===to)||(!from&&!to&&fromHandle===toHandle))continue;
     const item=typeof e.item==='string'?e.item.slice(0,64):null,amount=Number.isInteger(e.amount)?Math.min(Math.max(e.amount,0),1e6):null;
     db.logTransfer({server,at:Number.isFinite(e.at)&&Math.abs(e.at-t)<86400e3?e.at:t,from,to,fromHandle,toHandle,fromName:typeof e.fromName==='string'?e.fromName.slice(0,32):null,toName:typeof e.toName==='string'?e.toName.slice(0,32):null,item,amount,via:typeof e.via==='string'&&/^[a-z-]{1,16}$/.test(e.via)?e.via:null});
     if(from&&to)db.addTransfer({server,from,to,item,amount,at:t});
    }
   }});
   db.expireCommands(server,t-COMMAND_EXPIRY_MS,t);db.expireNativeCommands(server,t-COMMAND_EXPIRY_MS,t);
   // IP bans (central/ip-bans.mjs): browser players on a banned game address, kick-native for desktop ones (sent below).
   const ipKicks=ipRoutes?db.tx(()=>ipRoutes.report(server,players,desktopIps,t)):[];
   const commands=[
    ...db.queuedCommands(server).map(c=>{db.setCommandStatus(c.id,server,'sent',null,t);const args=parse(c.args)??{};return {id:c.id,action:c.action,subject:c.player_uuid,actorSubject:c.actor_uuid,reason:args.reason,message:args.message};}),
    ...db.queuedNativeCommands(server).map(c=>{db.setNativeCommandStatus(c.id,server,'sent',null,t);const args=parse(c.args)??{};return {id:c.id,action:c.action,handle:c.handle,actorSubject:c.actor_uuid,reason:args.reason,message:args.message};})];
   const kicks=new Map(pendingKicks.get(server));pendingKicks.delete(server);
   for(const p of players)if(db.activeBan(p.subject,server,t))kicks.set(p.subject,'banned');
   for(const subject of ipKicks)if(!kicks.has(subject))kicks.set(subject,'ip-banned');
   screenshots.maintain(t);
   return [200,{kicks:[...kicks].map(([subject,reason])=>({subject,reason})),commands,screenshots:screenshots.dispatch(server,players)}];
  },
 };
 const screenshots=createScreenshotRoutes({db,now,body,bridge,HttpError,staffOn,target,fresh,...(screenshotRetentionMs?{retentionMs:screenshotRetentionMs}:{})});
 Object.assign(routes,screenshots.routes);
 Object.assign(routes,createPlayerHistoryRoutes({db,now,staffOn,fresh,HttpError,RANK}));
 if(ipRoutes)Object.assign(routes,ipRoutes.routes);
 return {routes,rosters,screenshots};
}
