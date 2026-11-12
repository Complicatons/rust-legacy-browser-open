// IP logging and IP bans (ANTICHEAT-ADMIN-PLAN.md "Owner direction (2026-10-24): IP logging and IP bans").
// Raw addresses are kept per account and source (website pages and join tickets; the game connection a gateway
// redeemed a ticket or launcher pass for) and per desktop handle (the server adapter's roster), for ipRetentionDays.
// Bans are a single address or a range (IPv4 /16 or narrower, IPv6 /32 or narrower), per server or network-wide;
// private, loopback and CGNAT addresses are refused because the gateway's own address stands for every browser player.
//
// Website (session cookie + CSRF, server owner/admin or platform staff): GET /admin/servers/{id}/ips?player=|handle=,
//   GET .../ip-lookup?ip=, GET|POST .../ip-bans, POST .../ip-unban. Mounted by central/admin.mjs.
import {BlockList,isIP} from 'node:net';
import {randomUUID} from 'node:crypto';

const SCHEMA=`
-- source: website (signed-in pages, join tickets; server_uuid ''), game (browser ticket redeemed), launcher (desktop pass redeemed).
create table if not exists ip_log(player_uuid text not null references players(uuid), ip text not null, source text not null, server_uuid text not null default '', first_seen integer not null, last_seen integer not null, seen integer not null default 1, primary key(player_uuid, ip, source, server_uuid));
create index if not exists ip_log_ip on ip_log(ip);
create index if not exists ip_log_seen on ip_log(last_seen);
-- Desktop players known only by the adapter's per-server handle (server-side address of the native connection).
create table if not exists native_ip_log(server_uuid text not null, handle text not null, name text not null, ip text not null, first_seen integer not null, last_seen integer not null, seen integer not null default 1, primary key(server_uuid, handle, ip));
create index if not exists native_ip_log_ip on native_ip_log(ip);
create index if not exists native_ip_log_seen on native_ip_log(last_seen);
-- cidr: "a.b.c.d", "a.b.c.d/24" or an IPv6 address/prefix. server_uuid null = every server (network ban).
create table if not exists ip_bans(id text primary key, cidr text not null, server_uuid text references servers(uuid), reason text not null, created_by text not null, created_at integer not null, expires_at integer, revoked_at integer, revoked_by text);
create index if not exists ip_bans_server on ip_bans(server_uuid, created_at);
`;
export const IP_SOURCES=Object.freeze(['website','game','launcher']);
const MIN_PREFIX={4:16,6:32},PURGE_EVERY_MS=3600e3;
// Addresses no ban may cover: the gateway reaches the game server over these, so they stand for every browser player.
const UNBANNABLE=new BlockList();
for(const [net,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16]])UNBANNABLE.addSubnet(net,prefix,'ipv4');
for(const [net,prefix] of [['::',127],['fc00::',7],['fe80::',10]])UNBANNABLE.addSubnet(net,prefix,'ipv6');

// "::ffff:a.b.c.d" → "a.b.c.d"; IPv6 lowercased. null when it is not an address.
export function normaliseIp(value){
 const s=String(value??'').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i,''),v=isIP(s);
 return v?{ip:v===6?s.toLowerCase():s,version:v}:null;
}
const family=v=>v===4?'ipv4':'ipv6';
// Parses a ban target. Returns {cidr, ip, prefix, version} or {error}.
export function parseBanTarget(value){
 const parts=String(value??'').trim().split('/');if(parts.length>2)return {error:'invalid-ip'};
 const n=normaliseIp(parts[0]);if(!n)return {error:'invalid-ip'};
 const max=n.version===4?32:128,prefix=parts.length===1?max:(/^\d{1,3}$/.test(parts[1])?Number(parts[1]):NaN);
 if(!(prefix>=0&&prefix<=max))return {error:'invalid-ip'};
 if(prefix<MIN_PREFIX[n.version])return {error:'range-too-wide'};
 if(UNBANNABLE.check(n.ip,family(n.version)))return {error:'unbannable-ip'};
 return {cidr:prefix===max?n.ip:`${n.ip}/${prefix}`,ip:n.ip,prefix,version:n.version};
}
const blockOf=cidr=>{const [ip,p]=cidr.split('/'),v=isIP(ip);return {ip,prefix:p===undefined?(v===4?32:128):Number(p),type:family(v)};};

export function createIpRegistry({db,now=Date.now,retentionMs=90*86400e3}){
 db.raw.exec(SCHEMA);
 const q=sql=>db.raw.prepare(sql);
 let lastPurge=-Infinity;
 const reg={
  retentionMs,
  // Logs one sighting of an account's address. server: '' for website pages.
  record(player,ip,source,server=''){
   const n=normaliseIp(ip);if(!n||!IP_SOURCES.includes(source))return false;const t=now();
   q('insert into ip_log(player_uuid,ip,source,server_uuid,first_seen,last_seen) values(?,?,?,?,?,?) on conflict(player_uuid,ip,source,server_uuid) do update set last_seen=excluded.last_seen,seen=seen+1').run(player,n.ip,source,server??'',t,t);
   return true;
  },
  recordNative(server,handle,name,ip){
   const n=normaliseIp(ip);if(!n)return false;const t=now();
   q('insert into native_ip_log(server_uuid,handle,name,ip,first_seen,last_seen) values(?,?,?,?,?,?) on conflict(server_uuid,handle,ip) do update set last_seen=excluded.last_seen,name=excluded.name,seen=seen+1').run(server,handle,String(name??'').slice(0,32),n.ip,t,t);
   return true;
  },
  // Rows older than the retention are deleted, at most hourly (force: tests and tools).
  purge(force=false){
   const t=now();if(!force&&t-lastPurge<PURGE_EVERY_MS)return 0;lastPurge=t;const before=t-retentionMs;
   return Number(q('delete from ip_log where last_seen<?').run(before).changes)+Number(q('delete from native_ip_log where last_seen<?').run(before).changes);
  },
  // History: all=false keeps the server's own game/launcher rows (server staff); all=true adds website rows and other servers.
  forPlayer:(player,server,all)=>all?q('select ip,source,server_uuid as server,first_seen as firstSeen,last_seen as lastSeen,seen from ip_log where player_uuid=? order by last_seen desc limit 200').all(player)
   :q("select ip,source,server_uuid as server,first_seen as firstSeen,last_seen as lastSeen,seen from ip_log where player_uuid=? and server_uuid=? and source in ('game','launcher') order by last_seen desc limit 200").all(player,server),
  forHandle:(server,handle)=>q('select ip,name,first_seen as firstSeen,last_seen as lastSeen,seen from native_ip_log where server_uuid=? and handle=? order by last_seen desc limit 200').all(server,handle),
  lookup(ip,server,all){
   const n=normaliseIp(ip);if(!n)return null;
   const accounts=all?q('select l.player_uuid as player,p.display_name as name,l.source,l.server_uuid as server,l.first_seen as firstSeen,l.last_seen as lastSeen,l.seen from ip_log l join players p on p.uuid=l.player_uuid where l.ip=? order by l.last_seen desc limit 200').all(n.ip)
    :q("select l.player_uuid as player,p.display_name as name,l.source,l.server_uuid as server,l.first_seen as firstSeen,l.last_seen as lastSeen,l.seen from ip_log l join players p on p.uuid=l.player_uuid where l.ip=? and l.server_uuid=? and l.source in ('game','launcher') order by l.last_seen desc limit 200").all(n.ip,server);
   const desktop=all?q('select server_uuid as server,handle,name,first_seen as firstSeen,last_seen as lastSeen,seen from native_ip_log where ip=? order by last_seen desc limit 200').all(n.ip)
    :q('select server_uuid as server,handle,name,first_seen as firstSeen,last_seen as lastSeen,seen from native_ip_log where ip=? and server_uuid=? order by last_seen desc limit 200').all(n.ip,server);
   return {ip:n.ip,accounts,desktop};
  },
  // The address an account's current game connection on this server came from (latest redemption).
  latestGameIp:(player,server)=>q("select ip from ip_log where player_uuid=? and server_uuid=? and source in ('game','launcher') order by last_seen desc limit 1").get(player,server)?.ip??null,
  gameIpsSince:(player,server,since)=>q("select distinct ip from ip_log where player_uuid=? and server_uuid=? and source in ('game','launcher') and last_seen>=?").all(player,server,since).map(r=>r.ip),
  nativeIpsSince:(server,handle,since)=>q('select distinct ip from native_ip_log where server_uuid=? and handle=? and last_seen>=?').all(server,handle,since).map(r=>r.ip),
  addBan:b=>q('insert into ip_bans(id,cidr,server_uuid,reason,created_by,created_at,expires_at) values(?,?,?,?,?,?,?)').run(b.id,b.cidr,b.server??null,b.reason,b.by,b.at,b.expires??null),
  ban:id=>q('select * from ip_bans where id=?').get(id),
  bansFor:(server,limit=200)=>q('select * from ip_bans where server_uuid=? or server_uuid is null order by created_at desc limit ?').all(server,limit),
  revokeBan:(id,by,at)=>q('update ip_bans set revoked_at=?,revoked_by=? where id=? and revoked_at is null').run(at,by,id).changes===1,
  // ip → the active ban covering it on this server (a server ban first), or null. One matcher per report/request.
  matcher(server,at=now()){
   const bans=q('select * from ip_bans where (server_uuid is null or server_uuid=?) and revoked_at is null and (expires_at is null or expires_at>?) order by server_uuid is not null desc, created_at desc').all(server,at);
   if(!bans.length)return ()=>null;
   const lists=bans.map(b=>{const k=blockOf(b.cidr),l=new BlockList();l.addSubnet(k.ip,k.prefix,k.type);return [b,l];});
   return ip=>{const n=normaliseIp(ip);if(!n)return null;const type=family(n.version);for(const [b,l] of lists)if(l.check(n.ip,type))return b;return null;};
  },
  banned:(ip,server,at=now())=>reg.matcher(server,at)(ip),
  // A kick-native already waiting (or just sent) for this handle: the next reports do not queue another.
  recentNativeKick:(server,handle,since)=>Boolean(q("select 1 from native_commands where server_uuid=? and handle=? and action='kick-native' and status in ('queued','sent') and created_at>=? limit 1").get(server,handle,since)),
 };
 return reg;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HANDLE=/^[A-Za-z0-9_-]{16}$/,BAN_LOOKBACK_MS=30*86400e3,MAX_BAN_MINUTES=10*365*24*60,KICK_REQUEUE_MS=60e3;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max?v.trim():null;

// Admin routes and the report-time checks. Helpers come from central/admin.mjs (same roles, audit and roster).
export function createIpRoutes({db,ips,now,body,HttpError,staffOn,target,audit,query,rosters,queueKick}){
 const banView=b=>({id:b.id,cidr:b.cidr,scope:b.server_uuid?'server':'global',reason:b.reason,createdBy:b.created_by,createdAt:b.created_at,expiresAt:b.expires_at,revokedAt:b.revoked_at,active:!b.revoked_at&&(b.expires_at==null||b.expires_at>now())});
 // Adds one ban per address; returns the views. Kicks browser players on a matching game address right away
 // (desktop players are kicked by the next report, which carries their addresses).
 function addBans(ctx,cidrs,{scope,expires,reason}){
  const at=now(),made=cidrs.map(cidr=>({id:randomUUID(),cidr,server:scope==='server'?ctx.server.uuid:null,reason,by:ctx.player.uuid,at,expires}));
  db.tx(()=>{for(const b of made){ips.addBan(b);audit(ctx,'admin.ip-ban',{ban:b.id,cidr:b.cidr,scope,expiresAt:expires,reason});}});
  for(const [server,r] of rosters){
   if(scope==='server'&&server!==ctx.server.uuid)continue;
   const match=ips.matcher(server,at);
   for(const p of r.players)if(match(ips.latestGameIp(p.subject,server)))queueKick(server,p.subject,'ip-banned');
  }
  return made.map(b=>banView({id:b.id,cidr:b.cidr,server_uuid:b.server,reason:b.reason,created_by:b.by,created_at:b.at,expires_at:b.expires,revoked_at:null}));
 }
 function banOptions(ctx,b){
  const reason=text(b.reason,200);if(!reason)throw new HttpError(400,'reason-required');
  const scope=b.scope??'server';if(scope!=='server'&&scope!=='global')throw new HttpError(400,'invalid-scope');
  if(scope==='global'&&ctx.role!=='staff')throw new HttpError(403,'insufficient-role');
  const minutes=b.minutes??null;
  if(minutes!==null&&!(Number.isInteger(minutes)&&minutes>=1&&minutes<=MAX_BAN_MINUTES))throw new HttpError(400,'invalid-duration');
  return {scope,reason,expires:minutes===null?null:now()+minutes*60e3};
 }
 const routes={
  'GET /admin/servers/:id/ips':async(req,id)=>{
   const ctx=staffOn(req,id,{min:'admin'}),q=query(req),player=q.get('player'),handle=q.get('handle'),all=ctx.role==='staff';
   if(player){if(!UUID.test(player))throw new HttpError(400,'invalid-player');return [200,{player,ips:ips.forPlayer(player,id,all)}];}
   if(handle){if(!HANDLE.test(handle))throw new HttpError(400,'invalid-handle');return [200,{handle,ips:ips.forHandle(id,handle)}];}
   throw new HttpError(400,'player-or-handle-required');
  },
  'GET /admin/servers/:id/ip-lookup':async(req,id)=>{
   const ctx=staffOn(req,id,{min:'admin'}),found=ips.lookup(query(req).get('ip'),id,ctx.role==='staff');
   if(!found)throw new HttpError(400,'invalid-ip');
   return [200,found];
  },
  'GET /admin/servers/:id/ip-bans':async(req,id)=>{staffOn(req,id,{min:'admin'});return [200,{bans:ips.bansFor(id).map(banView)}];},
  // {ip} bans that address or range; {player} or {handle} bans the addresses that player used on this server in the
  // last 30 days. Private and loopback addresses are refused (the gateway's address is every browser player's).
  'POST /admin/servers/:id/ip-bans':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true,min:'admin'}),b=await body(req),opts=banOptions(ctx,b);
   let cidrs;
   if(typeof b.ip==='string'){const t=parseBanTarget(b.ip);if(t.error)throw new HttpError(400,t.error);cidrs=[t.cidr];}
   else if(typeof b.player==='string'){const player=target(ctx,b.player);cidrs=ips.gameIpsSince(player,id,now()-BAN_LOOKBACK_MS);}
   else if(typeof b.handle==='string'){if(!HANDLE.test(b.handle))throw new HttpError(400,'invalid-handle');cidrs=ips.nativeIpsSince(id,b.handle,now()-BAN_LOOKBACK_MS);}
   else throw new HttpError(400,'ip-player-or-handle-required');
   cidrs=cidrs.map(c=>parseBanTarget(c)).filter(t=>!t.error).map(t=>t.cidr);
   if(!cidrs.length)throw new HttpError(404,'no-ips');
   return [201,{bans:addBans(ctx,[...new Set(cidrs)],opts)}];
  },
  'POST /admin/servers/:id/ip-unban':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true,min:'admin'}),b=await body(req),ban=typeof b.ban==='string'&&ips.ban(b.ban);
   if(!ban||(ban.server_uuid&&ban.server_uuid!==id))throw new HttpError(404,'unknown-ban');
   if(!ban.server_uuid&&ctx.role!=='staff')throw new HttpError(403,'insufficient-role');
   if(!ips.revokeBan(ban.id,ctx.player.uuid,now()))throw new HttpError(409,'already-revoked');
   audit(ctx,'admin.ip-unban',{ban:ban.id,cidr:ban.cidr,reason:text(b.reason,200)});
   return [200,{revoked:true}];
  },
 };
 return {
  routes,
  // POST .../bans {banIps:true}: the account's game addresses on this server (last 30 days), same scope and expiry.
  banAccountIps(ctx,player,{scope,expires,reason}){
   const cidrs=[...new Set(ips.gameIpsSince(player,ctx.server.uuid,now()-BAN_LOOKBACK_MS).map(c=>parseBanTarget(c)).filter(t=>!t.error).map(t=>t.cidr))];
   return cidrs.length?addBans(ctx,cidrs,{scope,expires,reason}):[];
  },
  // POST /bridge/report: logs desktop players' addresses, returns browser subjects to kick and queues kick-native for
  // desktop handles on a banned address (once per minute per handle).
  report(server,players,desktop,t){
   ips.purge();
   const match=ips.matcher(server,t),kicks=[];
   for(const p of players)if(match(ips.latestGameIp(p.subject,server)))kicks.push(p.subject);
   for(const d of desktop){
    if(!d.ip)continue;ips.recordNative(server,d.handle,d.name,d.ip);
    const ban=match(d.ip);
    if(ban&&!ips.recentNativeKick(server,d.handle,t-KICK_REQUEUE_MS)&&db.player(ban.created_by))
     db.addNativeCommand({id:randomUUID(),server,actor:ban.created_by,handle:d.handle,name:d.name,action:'kick-native',args:{reason:'ip-banned'},at:t});
   }
   return kicks;
  },
 };
}
