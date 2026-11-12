// Central account/directory database (HOSTING-ACCOUNTS-BRIDGE-PLAN §9). One SQLite file via node:sqlite.
// Secrets (sessions, enrolment codes, server credentials) are stored only as SHA-256 hashes; tickets are never stored.
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {canonicalEmail} from './passwords.mjs';

export const hashSecret=s=>createHash('sha256').update(String(s)).digest('hex');

const SCHEMA=`
create table if not exists players(uuid text primary key, display_name text not null, status text not null default 'active', created_at integer not null);
create table if not exists login_identities(issuer text not null, subject text not null, player_uuid text not null references players(uuid), created_at integer not null, primary key(issuer, subject));
create table if not exists sessions(token_hash text primary key, player_uuid text not null references players(uuid), csrf text not null, expires_at integer not null, created_at integer not null default 0);
create table if not exists servers(uuid text primary key, owner_uuid text not null references players(uuid), name text not null, region text not null, endpoint text not null, protocol text not null default 'legacy-1069-browser-v1', listed integer not null default 0, steam_verified integer not null default 0, status text not null default 'active', players integer, capacity integer, wipe_generation text, last_heartbeat integer, created_at integer not null);
create table if not exists server_credentials(id text primary key, server_uuid text not null references servers(uuid), secret_hash text not null unique, created_at integer not null, revoked_at integer);
create table if not exists enrolment_codes(code_hash text primary key, server_uuid text not null references servers(uuid), expires_at integer not null, used_at integer);
create table if not exists join_ticket_redemptions(jti text primary key, server_uuid text not null, expires_at integer not null, redeemed_at integer not null);
create table if not exists legacy_identity_links(server_uuid text not null references servers(uuid), player_uuid text not null references players(uuid), backend_ref text not null, created_at integer not null, primary key(server_uuid, player_uuid), unique(server_uuid, backend_ref));
create table if not exists link_requests(id text primary key, server_uuid text not null references servers(uuid), player_uuid text not null references players(uuid), status text not null, reason text, created_at integer not null, updated_at integer not null);
create table if not exists audit_events(id integer primary key autoincrement, at integer not null, actor text, action text not null, target text, detail text);
-- Anti-cheat and admin tooling (ANTICHEAT-ADMIN-PLAN.md). Server owners are implicit (servers.owner_uuid).
create table if not exists server_roles(server_uuid text not null references servers(uuid), player_uuid text not null references players(uuid), role text not null check(role in ('admin','moderator')), granted_by text not null, granted_at integer not null, primary key(server_uuid, player_uuid));
create table if not exists platform_staff(player_uuid text primary key references players(uuid), granted_at integer not null);
create table if not exists bans(id text primary key, player_uuid text not null references players(uuid), server_uuid text references servers(uuid), reason text not null, created_by text not null, created_at integer not null, expires_at integer, revoked_at integer, revoked_by text);
create index if not exists bans_player on bans(player_uuid);
create table if not exists anticheat_flags(id integer primary key autoincrement, server_uuid text not null references servers(uuid), player_uuid text not null references players(uuid), at integer not null, received_at integer not null, kind text not null, severity integer not null, score integer not null, detail text);
create index if not exists anticheat_flags_player on anticheat_flags(server_uuid, player_uuid, id);
-- Admin actions run in-game by the server plugin (teleport-to, bring, message, ban-native, unban-native).
create table if not exists admin_commands(id text primary key, server_uuid text not null references servers(uuid), actor_uuid text not null references players(uuid), player_uuid text not null references players(uuid), action text not null, args text, status text not null, reason text, created_at integer not null, updated_at integer not null);
create index if not exists admin_commands_server on admin_commands(server_uuid, status, created_at);
-- Same, for desktop players without a website account: targeted by the adapter's opaque per-server handle.
create table if not exists native_commands(id text primary key, server_uuid text not null references servers(uuid), actor_uuid text not null references players(uuid), handle text not null, name text not null, action text not null, args text, status text not null, reason text, created_at integer not null, updated_at integer not null);
create index if not exists native_commands_server on native_commands(server_uuid, status, created_at);
-- Anti-cheat evidence for desktop players (sampled server-side by the adapter), by handle; player_uuid when linked.
create table if not exists desktop_flags(id integer primary key autoincrement, server_uuid text not null references servers(uuid), handle text not null, name text not null, player_uuid text references players(uuid), at integer not null, received_at integer not null, kind text not null, severity integer not null, score integer not null, detail text);
create index if not exists desktop_flags_handle on desktop_flags(server_uuid, handle, id);
-- Ban-evasion policy per server: minimum account age and/or a linked Steam sign-in before joining.
create table if not exists server_policies(server_uuid text primary key references servers(uuid), min_account_age_minutes integer not null default 0, require_steam integer not null default 0, updated_by text, updated_at integer);
create table if not exists player_reports(id text primary key, server_uuid text not null references servers(uuid), reporter_uuid text not null references players(uuid), player_uuid text references players(uuid), reported_name text not null, reason text not null, detail text, created_at integer not null, status text not null default 'open', resolved_by text, resolved_at integer, resolution text);
`;

// Website accounts (website spec §6.1): columns added to existing databases on open, unique keys are lowercase.
const ACCOUNT_COLUMNS=['username text','username_key text','email text','email_key text','email_verified_at integer','password_hash text','password_changed_at integer'];
const ACCOUNT_SCHEMA=`
create unique index if not exists players_username_key on players(username_key) where username_key is not null;
create unique index if not exists players_email_key on players(email_key) where email_key is not null;
create table if not exists password_resets(token_hash text primary key, player_uuid text not null references players(uuid), expires_at integer not null, used_at integer);
-- Staff wiki articles (website spec §6.2): the article row is the current text, every save also adds a revision.
create table if not exists wiki_articles(slug text primary key, title text not null, section text not null, body text not null, updated_at integer not null, updated_by text not null references players(uuid));
create table if not exists wiki_revisions(id integer primary key autoincrement, slug text not null references wiki_articles(slug), title text not null, section text not null, body text not null, note text not null default '', created_at integer not null, created_by text not null references players(uuid));
create index if not exists wiki_revisions_slug on wiki_revisions(slug, id);
-- Launch sign-ups ("notify me" before the servers open): one row per lowercased email; token = its unsubscribe link.
create table if not exists waitlist(email_key text primary key, email text not null, created_at integer not null, token text);
-- The opening-day email (central/waitlist.mjs): one row per mailing, one delivery row per address it reached or tried.
create table if not exists waitlist_mailings(id integer primary key autoincrement, subject text not null, body text not null, created_at integer not null, created_by text not null, total integer not null, sent integer not null default 0, failed integer not null default 0, finished_at integer);
create table if not exists waitlist_deliveries(mailing_id integer not null references waitlist_mailings(id), email_key text not null, sent_at integer, error text, primary key(mailing_id, email_key));
create table if not exists email_verifications(token_hash text primary key, player_uuid text not null references players(uuid), email text not null, expires_at integer not null, used_at integer);
-- Desktop launcher sessions (DESKTOP-LAUNCHER-PLAN.md): bearer tokens kept apart from website cookies. lease_* = the
-- one server this launcher is joined to; lease_state 'in-game' means the game holds it and losing it ends the session there.
create table if not exists desktop_sessions(token_hash text primary key, id text not null unique, player_uuid text not null references players(uuid), device text not null, created_at integer not null, expires_at integer not null, last_seen integer not null, lease_server text, lease_state text, lease_expires integer);
create index if not exists desktop_sessions_player on desktop_sessions(player_uuid);
-- Forum (website phase 2, central/forum.mjs): a thread's first post is its text; deleted rows stay (soft delete).
-- last_post_at orders the category (a reply bumps it). forum_bans: no posting while a row is unexpired.
create table if not exists forum_threads(id integer primary key autoincrement, category text not null, title text not null, author_uuid text not null references players(uuid), created_at integer not null, last_post_at integer not null, last_post_by text not null references players(uuid), pinned integer not null default 0, locked integer not null default 0, deleted_at integer, deleted_by text);
create index if not exists forum_threads_category on forum_threads(category, deleted_at, pinned, last_post_at);
create table if not exists forum_posts(id integer primary key autoincrement, thread_id integer not null references forum_threads(id), author_uuid text not null references players(uuid), body text not null, created_at integer not null, edited_at integer, deleted_at integer, deleted_by text);
create index if not exists forum_posts_thread on forum_posts(thread_id, id);
create table if not exists forum_bans(player_uuid text primary key references players(uuid), reason text not null, created_by text not null, created_at integer not null, expires_at integer);
-- Leaderboards (central/stats.mjs): counts per account, server and UTC day, written only from gateway reports.
-- stat: playtime (s), animal (sub species), pvp, death, gather (sub item), craft, build (sub structure|deployable), distance (m).
create table if not exists player_stats(player_uuid text not null references players(uuid), server_uuid text not null references servers(uuid), day text not null, stat text not null, sub text not null default '', n real not null, primary key(player_uuid, server_uuid, day, stat, sub));
create index if not exists player_stats_board on player_stats(stat, day);
-- Desktop leases that ended while in game: the server's gateway collects them (/bridge/tasks) and ends that character's session.
create table if not exists desktop_lease_ends(id integer primary key autoincrement, server_uuid text not null, player_uuid text not null, reason text not null, created_at integer not null);
`;
// One account per person (central/identity.mjs) and admin screenshots (central/screenshots.mjs). Identifier values are
// stored only as keyed hashes (HMAC with the central pepper); the raw email stays on the player row as before.
const IDENTITY_COLUMNS=['email_canon text','phone_verified_at integer','leaderboard_hidden integer not null default 0'];
const POLICY_COLUMNS=['require_phone integer not null default 0','steam_min_age_days integer not null default 0','steam_min_level integer not null default 0',
 'steam_max_vac_bans integer not null default -1','steam_max_game_bans integer not null default -1','steam_min_days_since_ban integer not null default 0','screenshot_auto_severity integer not null default 40'];
const IDENTITY_SCHEMA=`
create index if not exists players_email_canon on players(email_canon) where email_canon is not null;
create table if not exists central_meta(key text primary key, value text not null);
-- kind: email (canonical address), steam, phone, device (browser token), hwid (desktop launcher hash).
create table if not exists identifiers(player_uuid text not null references players(uuid), kind text not null, value_hash text not null, first_seen integer not null, last_seen integer not null, seen integer not null default 1, primary key(player_uuid, kind, value_hash));
create index if not exists identifiers_value on identifiers(kind, value_hash);
-- Browser sightings for admin alt links only: device token + soft signals (UA, screen, timezone, WebGL) + IP, all hashed.
create table if not exists device_sightings(player_uuid text not null references players(uuid), device_hash text not null, signals_hash text not null, ip_hash text not null, network text, first_seen integer not null, last_seen integer not null, seen integer not null default 1, primary key(player_uuid, device_hash, signals_hash, ip_hash));
create index if not exists device_sightings_signals on device_sightings(signals_hash, ip_hash);
-- An account that shares an identifier with a banned account: refused (hard identifier) or held (device token) until cleared.
create table if not exists identity_holds(id text primary key, player_uuid text not null references players(uuid), ban_id text not null references bans(id), server_uuid text, kind text not null, hard integer not null, status text not null default 'held', created_at integer not null, resolved_by text, resolved_at integer, unique(player_uuid, ban_id));
create table if not exists blocked_email_domains(domain text primary key, added_by text not null, added_at integer not null);
-- Time on a server per account, from the gateway roster (alt links: "never online together").
create table if not exists play_sessions(id integer primary key autoincrement, server_uuid text not null, player_uuid text not null, started_at integer not null, last_seen integer not null);
create index if not exists play_sessions_player on play_sessions(player_uuid, last_seen);
-- In-game names per server as the gateway roster (kind browser) and the server adapter's desktop roster (kind desktop)
-- report them, for the host app's player history. who: the account UUID, or 'desktop:<handle>' for a desktop character
-- not linked to an account. Rows are kept as long as play sessions (central/identity.mjs prune).
create table if not exists player_names(server_uuid text not null, who text not null, kind text not null, name text not null, first_seen integer not null, last_seen integer not null, primary key(server_uuid, who, kind, name));
create index if not exists player_names_server on player_names(server_uuid, last_seen);
create table if not exists item_transfers(id integer primary key autoincrement, server_uuid text not null, from_uuid text not null, to_uuid text not null, item text, amount integer, at integer not null);
create index if not exists item_transfers_from on item_transfers(from_uuid);create index if not exists item_transfers_to on item_transfers(to_uuid);
-- Every item transfer the server adapter saw (slice 8): by account where the character maps to one, else by desktop handle.
create table if not exists item_transfer_log(id integer primary key autoincrement, server_uuid text not null, at integer not null, from_uuid text, to_uuid text, from_handle text, to_handle text, from_name text, to_name text, item text, amount integer, via text);
create index if not exists item_transfer_log_server on item_transfer_log(server_uuid, id);
create table if not exists screenshots(id text primary key, server_uuid text not null references servers(uuid), player_uuid text not null references players(uuid), trigger text not null, flag_id integer, flag_kind text, requested_by text not null, status text not null, reason text, created_at integer not null, sent_at integer, done_at integer, expires_at integer, bytes integer, width integer, height integer, sha256 text, meta text);
create index if not exists screenshots_player on screenshots(server_uuid, player_uuid, created_at);
create table if not exists screenshot_images(id text primary key references screenshots(id) on delete cascade, data blob not null);
create table if not exists host_tokens(id text primary key, server_uuid text not null references servers(uuid), secret_hash text not null unique, created_at integer not null, revoked_at integer, last_used_at integer);
-- Server list entries (SERVER-MANAGEMENT-PLAN.md section 2): what the owner submitted and site staff's review.
-- tags: JSON array. state: pending | approved | rejected.
create table if not exists server_listings(server_uuid text primary key references servers(uuid), description text not null, tags text not null, discord text, website text, wipe text, language text, state text not null, submitted_at integer not null, submitted_by text not null, reviewed_at integer, reviewed_by text, note text);
`;
// A server without a saved policy: anyone may join; auto screenshots from severity 40 (teleport, impossible shots).
// steam_max_*_bans -1 = any number.
export const DEFAULT_POLICY=Object.freeze({min_account_age_minutes:0,require_steam:0,require_phone:0,steam_min_age_days:0,steam_min_level:0,steam_max_vac_bans:-1,steam_max_game_bans:-1,steam_min_days_since_ban:0,screenshot_auto_severity:40});
function addColumns(db,table,cols){const have=new Set(db.prepare(`pragma table_info(${table})`).all().map(c=>c.name));for(const col of cols)if(!have.has(col.split(' ')[0]))db.exec(`alter table ${table} add column ${col}`);}
function migrateAccounts(db){
 addColumns(db,'players',[...ACCOUNT_COLUMNS,...IDENTITY_COLUMNS]);
 db.exec(ACCOUNT_SCHEMA);
 addColumns(db,'server_policies',POLICY_COLUMNS);db.exec(IDENTITY_SCHEMA);
 addColumns(db,'servers',['last_wipe_at integer']); // reported by the owner's host app (host/schedule.mjs), not the gateway
 // launcher_only: null until the host app's first report (OFFSHOOT-COMPATIBILITY-PLAN.md work item 7, "server profiles").
 addColumns(db,'servers',['launcher_only integer']);
 const canon=db.prepare('update players set email_canon=? where uuid=?');
 for(const r of db.prepare('select uuid,email from players where email is not null and email_canon is null').all())canon.run(canonicalEmail(r.email),r.uuid);
 // Sign-ups from before unsubscribe links get a token now.
 if(!db.prepare('pragma table_info(waitlist)').all().some(c=>c.name==='token'))db.exec('alter table waitlist add column token text');
 db.exec('create unique index if not exists waitlist_token on waitlist(token) where token is not null');
 const fill=db.prepare('update waitlist set token=? where email_key=?');
 for(const r of db.prepare('select email_key from waitlist where token is null').all())fill.run(randomBytes(16).toString('hex'),r.email_key);
}
const lower=v=>v==null?null:String(v).trim().toLowerCase();

export function openCentralDb(path=':memory:'){
 const db=new DatabaseSync(path);
 db.exec('pragma journal_mode=wal; pragma foreign_keys=on;');db.exec(SCHEMA);migrateAccounts(db);
 const q=sql=>db.prepare(sql);
 return {
  raw:db,
  tx(fn){db.exec('begin immediate');try{const r=fn();db.exec('commit');return r;}catch(e){db.exec('rollback');throw e;}},
  audit(at,actor,action,target,detail){q('insert into audit_events(at,actor,action,target,detail) values(?,?,?,?,?)').run(at,actor??null,action,target??null,detail?JSON.stringify(detail):null);},
  // players and identities
  identity:(issuer,subject)=>q('select p.* from login_identities i join players p on p.uuid=i.player_uuid where i.issuer=? and i.subject=?').get(issuer,subject),
  createPlayer(uuid,name,issuer,subject,at){q('insert into players(uuid,display_name,created_at) values(?,?,?)').run(uuid,name,at);q('insert into login_identities(issuer,subject,player_uuid,created_at) values(?,?,?,?)').run(issuer,subject,uuid,at);},
  player:uuid=>q('select * from players where uuid=?').get(uuid),
  identitiesFor:uuid=>q('select issuer,subject from login_identities where player_uuid=? order by created_at').all(uuid),
  addIdentity:(issuer,subject,uuid,at)=>q('insert into login_identities(issuer,subject,player_uuid,created_at) values(?,?,?,?)').run(issuer,subject,uuid,at),
  setSteamVerified:(uuid,v)=>q('update servers set steam_verified=? where uuid=?').run(v?1:0,uuid),
  renameServer:(uuid,name)=>q('update servers set name=? where uuid=?').run(name,uuid),
  setPlayerStatus:(uuid,status)=>q('update players set status=? where uuid=?').run(status,uuid),
  // website accounts
  playerByUsernameKey:key=>q('select * from players where username_key=?').get(key),
  playerByEmailKey:key=>q('select * from players where email_key=?').get(key),
  createAccount:({uuid,username,email=null,passwordHash=null,at})=>q('insert into players(uuid,display_name,created_at,username,username_key,email,email_key,email_canon,password_hash,password_changed_at) values(?,?,?,?,?,?,?,?,?,?)').run(uuid,username,at,username,lower(username),email??null,lower(email),email?canonicalEmail(email):null,passwordHash,passwordHash?at:null),
  setUsername:(uuid,username,displayName=username)=>q('update players set username=?,username_key=?,display_name=? where uuid=?').run(username,lower(username),displayName,uuid),
  setPassword:(uuid,hash,at)=>q('update players set password_hash=?,password_changed_at=? where uuid=?').run(hash,at,uuid),
  setEmail:(uuid,email)=>q('update players set email=?,email_key=?,email_canon=?,email_verified_at=null where uuid=?').run(email,lower(email),email?canonicalEmail(email):null,uuid),
  markEmailVerified:(uuid,at)=>q('update players set email_verified_at=? where uuid=?').run(at,uuid),
  // Also signs out every desktop launcher (a password change or "sign out everywhere" must reach them too).
  deleteSessionsFor(uuid,exceptTokenHash=null,at=Date.now()){q('delete from sessions where player_uuid=? and token_hash is not ?').run(uuid,exceptTokenHash);
   for(const s of q("select token_hash from desktop_sessions where player_uuid=?").all(uuid))this.deleteDesktopSession(s.token_hash,'signed-out',at);},
  addPasswordReset:(hash,uuid,expires)=>q('insert into password_resets(token_hash,player_uuid,expires_at) values(?,?,?)').run(hash,uuid,expires),
  usePasswordReset(hash,at){const r=q('update password_resets set used_at=? where token_hash=? and used_at is null and expires_at>?').run(at,hash,at);return r.changes===1?q('select player_uuid from password_resets where token_hash=?').get(hash).player_uuid:null;},
  addEmailVerification:(hash,uuid,email,expires)=>q('insert into email_verifications(token_hash,player_uuid,email,expires_at) values(?,?,?,?)').run(hash,uuid,email,expires),
  useEmailVerification(hash,at){const r=q('update email_verifications set used_at=? where token_hash=? and used_at is null and expires_at>?').run(at,hash,at);if(r.changes!==1)return null;const v=q('select player_uuid,email from email_verifications where token_hash=?').get(hash);return {uuid:v.player_uuid,email:v.email};},
  // sessions
  createSession:(tokenHash,uuid,csrf,expires,at)=>q('insert into sessions(token_hash,player_uuid,csrf,expires_at,created_at) values(?,?,?,?,?)').run(tokenHash,uuid,csrf,expires,at),
  session:(tokenHash,at)=>q('select * from sessions where token_hash=? and expires_at>?').get(tokenHash,at),
  deleteSession:tokenHash=>q('delete from sessions where token_hash=?').run(tokenHash),
  // desktop launcher sessions and leases
  createDesktopSession:(hash,id,uuid,device,expires,at)=>q('insert into desktop_sessions(token_hash,id,player_uuid,device,created_at,expires_at,last_seen) values(?,?,?,?,?,?,?)').run(hash,id,uuid,device,at,expires,at),
  desktopSession:(hash,at)=>q('select * from desktop_sessions where token_hash=? and expires_at>?').get(hash,at),
  desktopSessionsFor:uuid=>q('select id,device,created_at,last_seen,lease_server,lease_state from desktop_sessions where player_uuid=? order by created_at').all(uuid),
  setDesktopLease:(hash,server,state,expires,at)=>q('update desktop_sessions set lease_server=?,lease_state=?,lease_expires=?,last_seen=? where token_hash=?').run(server,state,expires,at,hash),
  // A live lease on this server held by another launcher of the same account.
  otherDesktopLease:(uuid,server,hash,at)=>q('select id,device from desktop_sessions where player_uuid=? and lease_server=? and lease_expires>? and token_hash<>?').get(uuid,server,at,hash),
  // Ends this launcher's lease; an in-game lease queues the end for that server's gateway.
  endDesktopLease(hash,reason,at){const s=q('select * from desktop_sessions where token_hash=?').get(hash);if(!s?.lease_server)return;
   if(s.lease_state==='in-game')q('insert into desktop_lease_ends(server_uuid,player_uuid,reason,created_at) values(?,?,?,?)').run(s.lease_server,s.player_uuid,reason,at);
   q('update desktop_sessions set lease_server=null,lease_state=null,lease_expires=null where token_hash=?').run(hash);},
  deleteDesktopSession(hash,reason,at){this.endDesktopLease(hash,reason,at);q('delete from desktop_sessions where token_hash=?').run(hash);},
  // Leases on this server whose heartbeats stopped, then every queued end: drained once by that server's gateway.
  takeDesktopLeaseEnds(server,at){
   for(const s of q('select token_hash from desktop_sessions where lease_server=? and lease_expires<=?').all(server,at))this.endDesktopLease(s.token_hash,'heartbeat-lost',at);
   const ends=q('select id,player_uuid,reason from desktop_lease_ends where server_uuid=? order by id').all(server);
   q('delete from desktop_lease_ends where server_uuid=?').run(server);
   return ends.map(e=>({subject:e.player_uuid,reason:e.reason}));},
  // servers
  createServer:s=>q('insert into servers(uuid,owner_uuid,name,region,endpoint,created_at) values(?,?,?,?,?,?)').run(s.uuid,s.owner,s.name,s.region,s.endpoint,s.at),
  server:uuid=>q('select * from servers where uuid=?').get(uuid),
  listedServers:()=>q("select uuid,name,region,endpoint,protocol,players,capacity,wipe_generation,last_wipe_at,last_heartbeat,launcher_only from servers where listed=1 and status='active' order by name").all(),
  ownedServers:owner=>q('select uuid,name,region,endpoint,listed,steam_verified,players,capacity,last_heartbeat,status from servers where owner_uuid=? order by created_at').all(owner),
  setListed:(uuid,listed)=>q('update servers set listed=? where uuid=?').run(listed?1:0,uuid),
  setLastWipe:(uuid,at)=>q('update servers set last_wipe_at=? where uuid=? and (last_wipe_at is null or last_wipe_at<>?)').run(at,uuid,at),
  setLauncherOnly:(uuid,v)=>q('update servers set launcher_only=? where uuid=? and (launcher_only is null or launcher_only<>?)').run(v?1:0,uuid,v?1:0),
  heartbeat:(uuid,players,capacity,wipe,at)=>q('update servers set players=?,capacity=?,wipe_generation=?,last_heartbeat=? where uuid=?').run(players,capacity,wipe,at,uuid),
  // enrolment and credentials
  addEnrolmentCode:(hash,uuid,expires)=>q('insert into enrolment_codes(code_hash,server_uuid,expires_at) values(?,?,?)').run(hash,uuid,expires),
  useEnrolmentCode(hash,at){const r=q('update enrolment_codes set used_at=? where code_hash=? and used_at is null and expires_at>?').run(at,hash,at);return r.changes===1?q('select server_uuid from enrolment_codes where code_hash=?').get(hash).server_uuid:null;},
  revokeCredentials:(uuid,at)=>q('update server_credentials set revoked_at=? where server_uuid=? and revoked_at is null').run(at,uuid),
  addCredential:(id,uuid,hash,at)=>q('insert into server_credentials(id,server_uuid,secret_hash,created_at) values(?,?,?,?)').run(id,uuid,hash,at),
  // host app keys (HOST-APP-PLAN.md "Accounts and links"): one active key per server; it acts as the owner on that server's admin routes
  addHostToken(id,uuid,hash,at){q('update host_tokens set revoked_at=? where server_uuid=? and revoked_at is null').run(at,uuid);q('insert into host_tokens(id,server_uuid,secret_hash,created_at) values(?,?,?,?)').run(id,uuid,hash,at);},
  revokeHostTokens:(uuid,at)=>q('update host_tokens set revoked_at=? where server_uuid=? and revoked_at is null').run(at,uuid).changes,
  hostTokenServer(hash,at){const r=q("select h.id,h.server_uuid from host_tokens h join servers s on s.uuid=h.server_uuid where h.secret_hash=? and h.revoked_at is null and s.status='active'").get(hash);if(r)q('update host_tokens set last_used_at=? where id=?').run(at,r.id);return r?.server_uuid??null;},
  hostTokenInfo:uuid=>q('select created_at,last_used_at from host_tokens where server_uuid=? and revoked_at is null').get(uuid)??null,
  // accounts known to one server: desktop links, and every account that has played there (browser characters)
  linksFor:server=>q('select l.player_uuid,l.backend_ref,l.created_at,p.display_name from legacy_identity_links l join players p on p.uuid=l.player_uuid where l.server_uuid=? order by l.created_at desc limit 5000').all(server),
  serverPlayers:server=>q('select s.player_uuid,p.display_name,min(s.started_at) first_seen,max(s.last_seen) last_seen from play_sessions s join players p on p.uuid=s.player_uuid where s.server_uuid=? group by s.player_uuid order by last_seen desc limit 5000').all(server),
  linkRequestsFor:(server,limit)=>q('select r.id,r.player_uuid,r.status,r.reason,r.created_at,r.updated_at,p.display_name from link_requests r join players p on p.uuid=r.player_uuid where r.server_uuid=? order by r.updated_at desc limit ?').all(server,limit),
  removeLink:(server,player)=>q('delete from legacy_identity_links where server_uuid=? and player_uuid=?').run(server,player).changes,
  credentialServer:hash=>q("select c.server_uuid from server_credentials c join servers s on s.uuid=c.server_uuid where c.secret_hash=? and c.revoked_at is null and s.status='active'").get(hash)?.server_uuid??null,
  // one-use join tickets: the primary key makes redemption atomic across bridge processes
  claimTicket(jti,server,expires,at){q('delete from join_ticket_redemptions where expires_at<?').run(at-3600000);try{q('insert into join_ticket_redemptions(jti,server_uuid,expires_at,redeemed_at) values(?,?,?,?)').run(jti,server,expires,at);return true;}catch(e){if(String(e.message).includes('UNIQUE'))return false;throw e;}},
  link:(server,player,ref,at)=>q('insert into legacy_identity_links(server_uuid,player_uuid,backend_ref,created_at) values(?,?,?,?)').run(server,player,ref,at),
  createLinkRequest:(id,server,player,at)=>q("insert into link_requests(id,server_uuid,player_uuid,status,created_at,updated_at) values(?,?,?,'pending',?,?)").run(id,server,player,at,at),
  linkRequest:id=>q('select * from link_requests where id=?').get(id),
  setLinkStatus:(id,status,reason,at)=>q('update link_requests set status=?,reason=?,updated_at=? where id=?').run(status,reason??null,at,id),
  linkFor:(server,player)=>q('select * from legacy_identity_links where server_uuid=? and player_uuid=?').get(server,player),
  auditFor:target=>q('select at,actor,action,target,detail from audit_events where target=? order by id').all(target),
  recentAudit:(target,limit)=>q('select id,at,actor,action,target,detail from audit_events where target=? order by id desc limit ?').all(target,limit),
  // admin roles
  isStaff:uuid=>Boolean(q('select 1 from platform_staff where player_uuid=?').get(uuid)),
  addStaff:(uuid,at)=>q('insert or ignore into platform_staff(player_uuid,granted_at) values(?,?)').run(uuid,at),
  removeStaff:uuid=>q('delete from platform_staff where player_uuid=?').run(uuid).changes,
  serverRole:(server,player)=>q('select role from server_roles where server_uuid=? and player_uuid=?').get(server,player)?.role??null,
  setServerRole:(server,player,role,by,at)=>role?q('insert into server_roles(server_uuid,player_uuid,role,granted_by,granted_at) values(?,?,?,?,?) on conflict(server_uuid,player_uuid) do update set role=excluded.role,granted_by=excluded.granted_by,granted_at=excluded.granted_at').run(server,player,role,by,at):q('delete from server_roles where server_uuid=? and player_uuid=?').run(server,player),
  serverRoles:server=>q('select r.player_uuid,p.display_name,r.role,r.granted_at from server_roles r join players p on p.uuid=r.player_uuid where r.server_uuid=? order by r.granted_at').all(server),
  rolesFor:player=>q('select server_uuid,role from server_roles where player_uuid=?').all(player),
  allServers:()=>q('select uuid,name,owner_uuid from servers order by created_at').all(),
  // server listings and the site staff panel
  listing:server=>q('select * from server_listings where server_uuid=?').get(server)??null,
  saveListing:(l,at)=>q(`insert into server_listings(server_uuid,description,tags,discord,website,wipe,language,state,submitted_at,submitted_by) values(?,?,?,?,?,?,?,?,?,?)
   on conflict(server_uuid) do update set description=excluded.description,tags=excluded.tags,discord=excluded.discord,website=excluded.website,wipe=excluded.wipe,language=excluded.language,
   state=excluded.state,submitted_at=excluded.submitted_at,submitted_by=excluded.submitted_by`).run(l.server,l.description,JSON.stringify(l.tags),l.discord,l.website,l.wipe,l.language,l.state,at,l.by),
  reviewListing:(server,state,by,note,at)=>q('update server_listings set state=?,reviewed_by=?,reviewed_at=?,note=? where server_uuid=?').run(state,by,at,note,server).changes,
  listingsByState:state=>q(`select l.*,s.name,s.region,s.endpoint,s.last_heartbeat,s.status server_status,p.display_name owner_name from server_listings l join servers s on s.uuid=l.server_uuid join players p on p.uuid=s.owner_uuid
   where (? is null or l.state=?) order by l.submitted_at`).all(state,state),
  setServerStatus:(server,status)=>q('update servers set status=? where uuid=?').run(status,server),
  staffServers:since=>q(`select s.uuid,s.name,s.region,s.endpoint,s.listed,s.status,s.players,s.capacity,s.last_heartbeat,s.created_at,s.steam_verified,p.display_name owner_name,p.uuid owner_uuid,l.state listing_state,
   (select count(*) from anticheat_flags f where f.server_uuid=s.uuid and f.at>=?)+(select count(*) from desktop_flags f where f.server_uuid=s.uuid and f.at>=?) flags,
   (select count(*) from player_reports r where r.server_uuid=s.uuid and r.status='open') reports,
   (select count(*) from identity_holds h where h.server_uuid=s.uuid and h.status='held') holds
   from servers s join players p on p.uuid=s.owner_uuid left join server_listings l on l.server_uuid=s.uuid order by s.created_at`).all(since,since),
  // bans: server_uuid null = every server (network ban)
  addBan:b=>q('insert into bans(id,player_uuid,server_uuid,reason,created_by,created_at,expires_at) values(?,?,?,?,?,?,?)').run(b.id,b.player,b.server??null,b.reason,b.by,b.at,b.expires??null),
  activeBan:(player,server,at)=>q('select * from bans where player_uuid=? and (server_uuid is null or server_uuid=?) and revoked_at is null and (expires_at is null or expires_at>?) order by server_uuid is not null, expires_at is not null, expires_at desc limit 1').get(player,server,at),
  ban:id=>q('select * from bans where id=?').get(id),
  bansFor:(server,limit)=>q('select b.*,p.display_name from bans b join players p on p.uuid=b.player_uuid where b.server_uuid=? or b.server_uuid is null order by b.created_at desc limit ?').all(server,limit),
  revokeBan:(id,by,at)=>q('update bans set revoked_at=?,revoked_by=? where id=? and revoked_at is null').run(at,by,id).changes===1,
  // anti-cheat evidence (written by the gateway report)
  addFlag:f=>q('insert into anticheat_flags(server_uuid,player_uuid,at,received_at,kind,severity,score,detail) values(?,?,?,?,?,?,?,?)').run(f.server,f.player,f.at,f.received,f.kind,f.severity,f.score,f.detail),
  // Recent flags on a server across players, browser and desktop, without evidence detail (host app Anti-cheat page).
  recentFlags:(server,limit)=>q(`select 'browser' source,f.id,f.at,f.kind,f.severity,f.score,f.player_uuid player,null handle,p.display_name name from anticheat_flags f join players p on p.uuid=f.player_uuid where f.server_uuid=?
   union all select 'desktop',d.id,d.at,d.kind,d.severity,d.score,d.player_uuid,d.handle,d.name from desktop_flags d where d.server_uuid=? order by at desc limit ?`).all(server,server,limit),
  flagsFor:(server,player,limit)=>q('select id,at,kind,severity,score,detail from anticheat_flags where server_uuid=? and player_uuid=? order by id desc limit ?').all(server,player,limit),
  flagCountsSince:(server,player,since)=>q('select kind,count(*) n from anticheat_flags where server_uuid=? and player_uuid=? and received_at>=? group by kind').all(server,player,since),
  // player reports
  addReport:r=>q('insert into player_reports(id,server_uuid,reporter_uuid,player_uuid,reported_name,reason,detail,created_at) values(?,?,?,?,?,?,?,?)').run(r.id,r.server,r.reporter,r.player??null,r.name,r.reason,r.detail??null,r.at),
  report:id=>q('select * from player_reports where id=?').get(id),
  reportsFor:(server,status,limit)=>q('select r.*,rp.display_name reporter_name from player_reports r join players rp on rp.uuid=r.reporter_uuid where r.server_uuid=? and r.status=? order by r.created_at desc limit ?').all(server,status,limit),
  openReportsBy:(reporter,since)=>q('select count(*) n from player_reports where reporter_uuid=? and created_at>=?').get(reporter,since).n,
  addCommand:c=>q("insert into admin_commands(id,server_uuid,actor_uuid,player_uuid,action,args,status,created_at,updated_at) values(?,?,?,?,?,?,'queued',?,?)").run(c.id,c.server,c.actor,c.player,c.action,JSON.stringify(c.args??{}),c.at,c.at),
  queuedCommands:server=>q("select * from admin_commands where server_uuid=? and status='queued' order by created_at limit 50").all(server),
  setCommandStatus:(id,server,status,reason,at)=>q("update admin_commands set status=?,reason=?,updated_at=? where id=? and server_uuid=? and status in ('queued','sent')").run(status,reason??null,at,id,server).changes===1,
  expireCommands:(server,before,at)=>q("update admin_commands set status='failed',reason='expired',updated_at=? where server_uuid=? and status='queued' and created_at<?").run(at,server,before),
  recentCommands:(server,limit)=>q('select c.*,p.display_name player_name,a.display_name actor_name from admin_commands c join players p on p.uuid=c.player_uuid join players a on a.uuid=c.actor_uuid where c.server_uuid=? order by c.created_at desc limit ?').all(server,limit),
  addNativeCommand:c=>q("insert into native_commands(id,server_uuid,actor_uuid,handle,name,action,args,status,created_at,updated_at) values(?,?,?,?,?,?,?,'queued',?,?)").run(c.id,c.server,c.actor,c.handle,c.name,c.action,JSON.stringify(c.args??{}),c.at,c.at),
  queuedNativeCommands:server=>q("select * from native_commands where server_uuid=? and status='queued' order by created_at limit 50").all(server),
  setNativeCommandStatus:(id,server,status,reason,at)=>q("update native_commands set status=?,reason=?,updated_at=? where id=? and server_uuid=? and status in ('queued','sent')").run(status,reason??null,at,id,server).changes===1,
  expireNativeCommands:(server,before,at)=>q("update native_commands set status='failed',reason='expired',updated_at=? where server_uuid=? and status='queued' and created_at<?").run(at,server,before),
  recentNativeCommands:(server,limit)=>q('select c.*,a.display_name actor_name from native_commands c join players a on a.uuid=c.actor_uuid where c.server_uuid=? order by c.created_at desc limit ?').all(server,limit),
  addDesktopFlag:f=>q('insert into desktop_flags(server_uuid,handle,name,player_uuid,at,received_at,kind,severity,score,detail) values(?,?,?,?,?,?,?,?,?,?)').run(f.server,f.handle,f.name,f.player??null,f.at,f.received,f.kind,f.severity,f.score,f.detail),
  desktopFlagsFor:(server,handle,limit)=>q('select id,at,kind,severity,score,detail from desktop_flags where server_uuid=? and handle=? order by id desc limit ?').all(server,handle,limit),
  nativeCommand:id=>q('select * from native_commands where id=?').get(id),
  nativeBanFor:(server,handle)=>q("select handle,name from native_commands where server_uuid=? and handle=? and action='ban-native' and status='done' order by created_at desc limit 1").get(server,handle),
  nativeBanCommand:(server,ban)=>q("select * from admin_commands where server_uuid=? and action='ban-native' and json_extract(args,'$.ban')=?").get(server,ban),
  policy:server=>q('select * from server_policies where server_uuid=?').get(server)??{...DEFAULT_POLICY},
  setPolicy:(server,minutes,steam,by,at)=>q('insert into server_policies(server_uuid,min_account_age_minutes,require_steam,updated_by,updated_at) values(?,?,?,?,?) on conflict(server_uuid) do update set min_account_age_minutes=excluded.min_account_age_minutes,require_steam=excluded.require_steam,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(server,minutes,steam?1:0,by,at),
  // The whole join policy (central/admin.mjs POST .../policy): p uses the column names.
  savePolicy(server,p,by,at){const cols=Object.keys(DEFAULT_POLICY);
   q(`insert into server_policies(server_uuid,${cols},updated_by,updated_at) values(?,${cols.map(()=>'?')},?,?) on conflict(server_uuid) do update set ${cols.map(c=>`${c}=excluded.${c}`)},updated_by=excluded.updated_by,updated_at=excluded.updated_at`).run(server,...cols.map(c=>p[c]??DEFAULT_POLICY[c]),by,at);},
  // identity (central/identity.mjs)
  meta:key=>q('select value from central_meta where key=?').get(key)?.value??null,
  setMeta:(key,value)=>q('insert or ignore into central_meta(key,value) values(?,?)').run(key,value),
  playersByEmailCanon:canon=>q('select * from players where email_canon=?').all(canon),
  setPhoneVerified:(uuid,at)=>q('update players set phone_verified_at=? where uuid=?').run(at,uuid),
  addIdentifier:(uuid,kind,hash,at)=>q('insert into identifiers(player_uuid,kind,value_hash,first_seen,last_seen) values(?,?,?,?,?) on conflict(player_uuid,kind,value_hash) do update set last_seen=excluded.last_seen,seen=seen+1').run(uuid,kind,hash,at,at),
  identifiersFor:uuid=>q('select kind,value_hash,first_seen,last_seen,seen from identifiers where player_uuid=? order by first_seen').all(uuid),
  identifierOwners:(kind,hash)=>q('select distinct player_uuid from identifiers where kind=? and value_hash=?').all(kind,hash).map(r=>r.player_uuid),
  addSighting:(s,at)=>q('insert into device_sightings(player_uuid,device_hash,signals_hash,ip_hash,network,first_seen,last_seen) values(?,?,?,?,?,?,?) on conflict(player_uuid,device_hash,signals_hash,ip_hash) do update set last_seen=excluded.last_seen,network=excluded.network,seen=seen+1').run(s.player,s.device,s.signals,s.ip,s.network??null,at,at),
  sightingsFor:uuid=>q('select device_hash,signals_hash,ip_hash,network,first_seen,last_seen,seen from device_sightings where player_uuid=?').all(uuid),
  pruneSightings:before=>q('delete from device_sightings where last_seen<?').run(before).changes,
  // Accounts sharing an identifier with uuid (kinds as given), or sharing signals and IP in one sighting.
  sharedIdentifiers:(uuid,kinds)=>q(`select o.player_uuid other,m.kind,count(*) n from identifiers m join identifiers o on o.kind=m.kind and o.value_hash=m.value_hash and o.player_uuid<>m.player_uuid where m.player_uuid=? and m.kind in (${kinds.map(()=>'?')}) group by o.player_uuid,m.kind`).all(uuid,...kinds),
  sharedSignals:uuid=>q('select o.player_uuid other,count(*) n from device_sightings m join device_sightings o on o.signals_hash=m.signals_hash and o.ip_hash=m.ip_hash and o.player_uuid<>m.player_uuid where m.player_uuid=? group by o.player_uuid').all(uuid),
  // Active bans (in scope: network bans, plus server bans on `server` when given) on other accounts that share one of
  // this account's identifiers of the given kinds.
  linkedBans:(uuid,kinds,server,at)=>q(`select distinct m.kind,b.* from identifiers m join identifiers o on o.kind=m.kind and o.value_hash=m.value_hash and o.player_uuid<>m.player_uuid join bans b on b.player_uuid=o.player_uuid where m.player_uuid=? and m.kind in (${kinds.map(()=>'?')}) and b.revoked_at is null and (b.expires_at is null or b.expires_at>?) and (b.server_uuid is null or b.server_uuid=?)`).all(uuid,...kinds,at,server??''),
  // The same for an identifier that has no account yet (a sign-up): network bans only.
  bannedIdentifier:(kind,hash,at)=>q('select b.* from identifiers i join bans b on b.player_uuid=i.player_uuid where i.kind=? and i.value_hash=? and b.server_uuid is null and b.revoked_at is null and (b.expires_at is null or b.expires_at>?) limit 1').get(kind,hash,at),
  hold:(player,ban)=>q('select * from identity_holds where player_uuid=? and ban_id=?').get(player,ban),
  holdById:id=>q('select * from identity_holds where id=?').get(id),
  addHold:h=>q('insert or ignore into identity_holds(id,player_uuid,ban_id,server_uuid,kind,hard,created_at) values(?,?,?,?,?,?,?)').run(h.id,h.player,h.ban,h.server??null,h.kind,h.hard?1:0,h.at).changes===1,
  resolveHold:(id,status,by,at)=>q("update identity_holds set status=?,resolved_by=?,resolved_at=? where id=? and status='held'").run(status,by,at,id).changes===1,
  // Open holds whose ban still applies: this server's, plus network ones when network=true.
  holdsFor:(server,network,at)=>q(`select h.*,p.display_name,bp.display_name banned_name,b.reason ban_reason from identity_holds h join players p on p.uuid=h.player_uuid join bans b on b.id=h.ban_id join players bp on bp.uuid=b.player_uuid where h.status='held' and b.revoked_at is null and (b.expires_at is null or b.expires_at>?) and (h.server_uuid=? or (?=1 and h.server_uuid is null)) order by h.created_at desc limit 200`).all(at,server,network?1:0),
  blockedDomains:()=>q('select domain,added_by,added_at from blocked_email_domains order by domain').all(),
  setBlockedDomain:(domain,blocked,by,at)=>blocked?q('insert or ignore into blocked_email_domains(domain,added_by,added_at) values(?,?,?)').run(domain,by,at).changes===1:q('delete from blocked_email_domains where domain=?').run(domain).changes===1,
  // play sessions from the gateway roster: a row stays open while reports keep naming the account.
  touchPlaySession(server,player,started,at,gapMs){const open=q('select id from play_sessions where server_uuid=? and player_uuid=? and last_seen>=? order by id desc limit 1').get(server,player,at-gapMs);
   if(open)q('update play_sessions set last_seen=? where id=?').run(at,open.id);else q('insert into play_sessions(server_uuid,player_uuid,started_at,last_seen) values(?,?,?,?)').run(server,player,Math.min(started??at,at),at);},
  playSessionsFor:uuid=>q('select server_uuid,started_at,last_seen from play_sessions where player_uuid=? order by started_at desc limit 500').all(uuid),
  prunePlaySessions:before=>q('delete from play_sessions where last_seen<?').run(before).changes,
  // Player history (central/player-history.mjs).
  touchName:(server,who,kind,name,at)=>q('insert into player_names(server_uuid,who,kind,name,first_seen,last_seen) values(?,?,?,?,?,?) on conflict(server_uuid,who,kind,name) do update set last_seen=max(last_seen,excluded.last_seen)').run(server,who,kind,name,at,at),
  namesFor:(server,who)=>q('select kind,name,first_seen,last_seen from player_names where server_uuid=? and who=? order by last_seen desc limit 50').all(server,who),
  pruneNames:before=>q('delete from player_names where last_seen<?').run(before).changes,
  serverSessionsFor:(server,player)=>q('select started_at,last_seen from play_sessions where server_uuid=? and player_uuid=? order by started_at desc').all(server,player),
  serverPlayerTotals:(server,limit)=>q('select s.player_uuid,p.display_name,min(s.started_at) first_seen,max(s.last_seen) last_seen,count(*) sessions,sum(s.last_seen-s.started_at) play_ms from play_sessions s join players p on p.uuid=s.player_uuid where s.server_uuid=? group by s.player_uuid order by last_seen desc limit ?').all(server,limit),
  desktopHandlesSeen:(server,limit)=>q("select substr(who,9) handle,min(first_seen) first_seen,max(last_seen) last_seen,(select name from player_names n2 where n2.server_uuid=n.server_uuid and n2.who=n.who order by last_seen desc limit 1) name from player_names n where server_uuid=? and who like 'desktop:%' group by who order by last_seen desc limit ?").all(server,limit),
  flagCountsByPlayer:server=>q('select player_uuid,count(*) n from (select player_uuid from anticheat_flags where server_uuid=? union all select player_uuid from desktop_flags where server_uuid=? and player_uuid is not null) group by player_uuid').all(server,server),
  flagKindsFor:(server,player,handle)=>q('select kind,count(*) count,max(severity) max_severity,max(at) last_at from (select kind,severity,at from anticheat_flags where server_uuid=?1 and player_uuid=?2 union all select kind,severity,at from desktop_flags where server_uuid=?1 and ((?2 is not null and player_uuid=?2) or (?3 is not null and handle=?3))) group by kind order by kind').all(server,player??null,handle??null),
  playerBans:(server,player)=>q('select b.*,p.display_name from bans b join players p on p.uuid=b.player_uuid where b.player_uuid=? and (b.server_uuid=? or b.server_uuid is null) order by b.created_at desc limit 100').all(player,server),
  playerAudit:(server,player,handle)=>q("select id,at,actor,action,detail from audit_events where target=?1 and action not in ('admin.alts-view','admin.role') and ((?2 is not null and json_extract(detail,'$.player')=?2) or (?3 is not null and json_extract(detail,'$.handle')=?3)) order by id desc limit 100").all(server,player??null,handle??null),
  reportsAgainst:(server,player,names)=>q("select r.*,rp.display_name reporter_name from player_reports r join players rp on rp.uuid=r.reporter_uuid where r.server_uuid=? and (r.player_uuid=? or (r.player_uuid is null and lower(r.reported_name) in (select value from json_each(?)))) order by r.created_at desc limit 100").all(server,player??null,JSON.stringify(names.map(n=>n.toLowerCase()))),
  addTransfer:t=>q('insert into item_transfers(server_uuid,from_uuid,to_uuid,item,amount,at) values(?,?,?,?,?,?)').run(t.server,t.from,t.to,t.item??null,t.amount??null,t.at),
  logTransfer:t=>q('insert into item_transfer_log(server_uuid,at,from_uuid,to_uuid,from_handle,to_handle,from_name,to_name,item,amount,via) values(?,?,?,?,?,?,?,?,?,?,?)').run(t.server,t.at,t.from??null,t.to??null,t.fromHandle??null,t.toHandle??null,t.fromName??null,t.toName??null,t.item??null,t.amount??null,t.via??null),
  transferLog:(server,{player=null,handle=null,limit=200})=>player?q('select * from item_transfer_log where server_uuid=?1 and (from_uuid=?2 or to_uuid=?2) order by id desc limit ?3').all(server,player,limit)
   :handle?q('select * from item_transfer_log where server_uuid=?1 and (from_handle=?2 or to_handle=?2) order by id desc limit ?3').all(server,handle,limit)
   :q('select * from item_transfer_log where server_uuid=? order by id desc limit ?').all(server,limit),
  transfersOf:uuid=>q('select * from item_transfers where from_uuid=?1 or to_uuid=?1 order by at desc limit 500').all(uuid),
  // admin screenshots (central/screenshots.mjs)
  addScreenshot:s=>q("insert into screenshots(id,server_uuid,player_uuid,trigger,flag_id,flag_kind,requested_by,status,created_at) values(?,?,?,?,?,?,?,'queued',?)").run(s.id,s.server,s.player,s.trigger,s.flag??null,s.flagKind??null,s.by,s.at),
  screenshot:id=>q('select * from screenshots where id=?').get(id),
  screenshotImage:id=>q('select data from screenshot_images where id=?').get(id)?.data??null,
  lastScreenshot:(server,player,trigger)=>q('select * from screenshots where server_uuid=? and player_uuid=? and (? is null or trigger=?) order by created_at desc limit 1').get(server,player,trigger??null,trigger??null),
  pendingScreenshot:(server,player)=>q("select id from screenshots where server_uuid=? and player_uuid=? and status in ('queued','sent') limit 1").get(server,player),
  countScreenshots:(server,trigger,since)=>q('select count(*) n from screenshots where server_uuid=? and trigger=? and created_at>=?').get(server,trigger,since).n,
  queuedScreenshots:server=>q("select id,player_uuid from screenshots where server_uuid=? and status='queued' order by created_at limit 20").all(server),
  setScreenshotSent:(id,at)=>q("update screenshots set status='sent',sent_at=? where id=? and status='queued'").run(at,id).changes===1,
  failScreenshot:(id,reason,at)=>q("update screenshots set status='failed',reason=?,done_at=? where id=? and status in ('queued','sent')").run(reason,at,id).changes===1,
  failStaleScreenshots:(server,queuedBefore,sentBefore,at)=>q("update screenshots set status='failed',reason=case status when 'queued' then 'expired' else 'no-result' end,done_at=? where server_uuid=? and ((status='queued' and created_at<?) or (status='sent' and sent_at<?))").run(at,server,queuedBefore,sentBefore).changes,
  storeScreenshot(id,{image,width,height,sha256,meta,expires},at){q("update screenshots set status='done',done_at=?,expires_at=?,bytes=?,width=?,height=?,sha256=?,meta=? where id=? and status='sent'").run(at,expires,image.length,width,height,sha256,JSON.stringify(meta),id);q('insert into screenshot_images(id,data) values(?,?)').run(id,image);},
  screenshotBySha:(player,sha,except)=>q("select id from screenshots where player_uuid=? and sha256=? and id<>? and status='done' limit 1").get(player,sha,except),
  screenshotsFor:(server,player,limit)=>q('select s.*,p.display_name player_name,r.display_name requester_name from screenshots s join players p on p.uuid=s.player_uuid left join players r on r.uuid=s.requested_by where s.server_uuid=? and (? is null or s.player_uuid=?) order by s.created_at desc limit ?').all(server,player??null,player??null,limit),
  deleteScreenshot:id=>q('delete from screenshots where id=?').run(id).changes===1,
  // Expired evidence: removed with its image; returns {server_uuid, n} per server for the audit log.
  expireScreenshots(at){const rows=q('select server_uuid,count(*) n from screenshots where expires_at is not null and expires_at<=? group by server_uuid').all(at);if(rows.length)q('delete from screenshots where expires_at is not null and expires_at<=?').run(at);return rows;},
  // Requests that never produced an image are kept as long as an image would have been.
  pruneFailedScreenshots:before=>q("delete from screenshots where status='failed' and created_at<?").run(before).changes,
  resolveReport:(id,status,by,resolution,at)=>q("update player_reports set status=?,resolved_by=?,resolution=?,resolved_at=? where id=? and status='open'").run(status,by,resolution,at,id).changes===1,
  wikiArticles:()=>q('select slug,title,section,updated_at from wiki_articles order by updated_at desc, slug').all(),
  wikiArticle:slug=>q('select a.*,coalesce(p.username,p.display_name) updated_by_name from wiki_articles a join players p on p.uuid=a.updated_by where slug=?').get(slug),
  // Upsert the article and add the revision in one transaction; returns the revision id.
  saveWikiArticle({slug,title,section,body,note='',by,at}){
   q('insert into wiki_articles(slug,title,section,body,updated_at,updated_by) values(?,?,?,?,?,?) on conflict(slug) do update set title=excluded.title,section=excluded.section,body=excluded.body,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(slug,title,section,body,at,by);
   return Number(q('insert into wiki_revisions(slug,title,section,body,note,created_at,created_by) values(?,?,?,?,?,?,?)').run(slug,title,section,body,note,at,by).lastInsertRowid);
  },
  wikiRevisions:slug=>q('select r.id,r.title,r.note,r.created_at,coalesce(p.username,p.display_name) created_by_name from wiki_revisions r join players p on p.uuid=r.created_by where slug=? order by r.id desc').all(slug),
  wikiRevision:(slug,id)=>q('select * from wiki_revisions where slug=? and id=?').get(slug,id),
  // forum (central/forum.mjs); names are the username, else the old display name
  forumCategoryStats:()=>q(`select t.category,count(*) threads,sum((select count(*) from forum_posts p where p.thread_id=t.id and p.deleted_at is null)) posts,max(t.last_post_at) last_at from forum_threads t where t.deleted_at is null group by t.category`).all(),
  forumLatest:()=>q(`select x.category,x.id,x.title,x.last_post_at,coalesce(p.username,p.display_name) last_by from (select t.*,row_number() over (partition by t.category order by t.last_post_at desc,t.id desc) rn from forum_threads t where t.deleted_at is null) x join players p on p.uuid=x.last_post_by where x.rn=1`).all(),
  forumThreads:(category,limit,offset)=>q(`select t.id,t.title,t.created_at,t.last_post_at,t.pinned,t.locked,coalesce(a.username,a.display_name) author,coalesce(l.username,l.display_name) last_by,(select count(*) from forum_posts p where p.thread_id=t.id and p.deleted_at is null) posts
   from forum_threads t join players a on a.uuid=t.author_uuid join players l on l.uuid=t.last_post_by where t.category=? and t.deleted_at is null order by t.pinned desc,t.last_post_at desc,t.id desc limit ? offset ?`).all(category,limit,offset),
  forumThreadCount:category=>q('select count(*) n from forum_threads where category=? and deleted_at is null').get(category).n,
  forumThread:id=>q('select t.*,coalesce(a.username,a.display_name) author from forum_threads t join players a on a.uuid=t.author_uuid where t.id=?').get(id),
  // Every post (deleted ones too, shown as removed) so post numbers and pages stay put.
  forumPosts:(thread,limit,offset)=>q('select p.*,coalesce(a.username,a.display_name) author from forum_posts p join players a on a.uuid=p.author_uuid where p.thread_id=? order by p.id limit ? offset ?').all(thread,limit,offset),
  forumPostCount:thread=>q('select count(*) n from forum_posts where thread_id=?').get(thread).n,
  forumPostPosition:(thread,id)=>q('select count(*) n from forum_posts where thread_id=? and id<=?').get(thread,id).n,
  forumFirstPost:thread=>q('select id from forum_posts where thread_id=? order by id limit 1').get(thread)?.id??null,
  forumPost:id=>q('select * from forum_posts where id=?').get(id),
  // Thread + first post; returns {thread, post}.
  createForumThread({category,title,body,by,at}){
   const thread=Number(q('insert into forum_threads(category,title,author_uuid,created_at,last_post_at,last_post_by) values(?,?,?,?,?,?)').run(category,title,by,at,at,by).lastInsertRowid);
   return {thread,post:this.addForumPost({thread,body,by,at})};
  },
  addForumPost({thread,body,by,at}){
   const id=Number(q('insert into forum_posts(thread_id,author_uuid,body,created_at) values(?,?,?,?)').run(thread,by,body,at).lastInsertRowid);
   q('update forum_threads set last_post_at=?,last_post_by=? where id=?').run(at,by,thread);return id;
  },
  editForumPost:(id,body,at)=>q('update forum_posts set body=?,edited_at=? where id=? and deleted_at is null').run(body,at,id).changes===1,
  deleteForumPost:(id,by,at)=>q('update forum_posts set deleted_at=?,deleted_by=? where id=? and deleted_at is null').run(at,by,id).changes===1,
  deleteForumThread:(id,by,at)=>q('update forum_threads set deleted_at=?,deleted_by=? where id=? and deleted_at is null').run(at,by,id).changes===1,
  setForumThreadFlag:(id,flag,on)=>q(`update forum_threads set ${flag==='locked'?'locked':'pinned'}=? where id=?`).run(on?1:0,id),
  // leaderboards (central/stats.mjs); `since` is a UTC day ('' = all time), server null = every server
  addStats(player,server,day,rows){const up=q('insert into player_stats(player_uuid,server_uuid,day,stat,sub,n) values(?,?,?,?,?,?) on conflict(player_uuid,server_uuid,day,stat,sub) do update set n=n+excluded.n');for(const [stat,sub,n] of rows)up.run(player,server,day,stat,sub,n);},
  statBoard:({stat,sub=null,server=null,since='',limit=50})=>q(`select coalesce(p.username,p.display_name) name,p.username,sum(s.n) value from player_stats s join players p on p.uuid=s.player_uuid
   where s.stat=? and (? is null or s.sub=?) and (? is null or s.server_uuid=?) and s.day>=? and p.leaderboard_hidden=0 and p.status='active' group by s.player_uuid having value>0 order by value desc,name limit ?`).all(stat,sub,sub,server,server,since,limit),
  statTotals:({stat,sub=null,server=null,since=''})=>q(`select count(distinct s.player_uuid) players,coalesce(sum(s.n),0) value from player_stats s join players p on p.uuid=s.player_uuid where s.stat=? and (? is null or s.sub=?) and (? is null or s.server_uuid=?) and s.day>=? and p.leaderboard_hidden=0 and p.status='active'`).get(stat,sub,sub,server,server,since),
  statSubs:(stat,server=null,since='')=>q(`select s.sub,sum(s.n) value from player_stats s join players p on p.uuid=s.player_uuid where s.stat=? and s.sub<>'' and (? is null or s.server_uuid=?) and s.day>=? and p.leaderboard_hidden=0 group by s.sub order by value desc`).all(stat,server,server,since),
  statsFor:(player,server=null,since='')=>q(`select stat,sub,sum(n) value from player_stats where player_uuid=? and (? is null or server_uuid=?) and day>=? group by stat,sub`).all(player,server,server,since),
  setLeaderboardHidden:(uuid,hidden)=>q('update players set leaderboard_hidden=? where uuid=?').run(hidden?1:0,uuid),
  forumBan:(uuid,at)=>q('select * from forum_bans where player_uuid=? and (expires_at is null or expires_at>?)').get(uuid,at),
  setForumBan:({player,reason,by,at,expires=null})=>q('insert into forum_bans(player_uuid,reason,created_by,created_at,expires_at) values(?,?,?,?,?) on conflict(player_uuid) do update set reason=excluded.reason,created_by=excluded.created_by,created_at=excluded.created_at,expires_at=excluded.expires_at').run(player,reason,by,at,expires),
  removeForumBan:uuid=>q('delete from forum_bans where player_uuid=?').run(uuid).changes===1,
  forumBans:at=>q('select coalesce(p.username,p.display_name) name,b.reason,coalesce(s.username,s.display_name) by_name,b.created_at,b.expires_at from forum_bans b join players p on p.uuid=b.player_uuid left join players s on s.uuid=b.created_by where b.expires_at is null or b.expires_at>? order by b.created_at desc').all(at),
  addWaitlist:(email,key,at)=>q('insert or ignore into waitlist(email_key,email,created_at,token) values(?,?,?,?)').run(key,email,at,randomBytes(16).toString('hex')).changes===1,
  waitlist:()=>q('select email,created_at from waitlist order by created_at desc, rowid desc').all(),
  removeWaitlist:key=>q('delete from waitlist where email_key=?').run(key).changes===1,
  unsubscribeWaitlist:token=>q('delete from waitlist where token=?').run(token).changes===1,
  // Mailings: the addresses still on the list that a mailing has not reached yet, oldest sign-up first.
  waitlistPending:id=>q('select w.email,w.email_key,w.token from waitlist w where not exists (select 1 from waitlist_deliveries d where d.mailing_id=? and d.email_key=w.email_key and d.sent_at is not null) order by w.created_at, w.rowid').all(id),
  createMailing:(subject,body,at,by,total)=>Number(q('insert into waitlist_mailings(subject,body,created_at,created_by,total) values(?,?,?,?,?)').run(subject,body,at,by,total).lastInsertRowid),
  mailing:id=>q('select * from waitlist_mailings where id=?').get(id),
  mailings:()=>q('select * from waitlist_mailings order by id desc').all(),
  recordDelivery:(id,key,sentAt,error)=>q('insert into waitlist_deliveries(mailing_id,email_key,sent_at,error) values(?,?,?,?) on conflict(mailing_id,email_key) do update set sent_at=excluded.sent_at,error=excluded.error').run(id,key,sentAt,error),
  startMailingRun:(id,pending)=>q('update waitlist_mailings set finished_at=null,total=(select count(*) from waitlist_deliveries where mailing_id=?1 and sent_at is not null)+?2 where id=?1').run(id,pending),
  countMailing:id=>q('update waitlist_mailings set sent=(select count(*) from waitlist_deliveries where mailing_id=?1 and sent_at is not null),failed=(select count(*) from waitlist_deliveries where mailing_id=?1 and sent_at is null) where id=?1').run(id),
  finishMailing:(id,at)=>q('update waitlist_mailings set finished_at=? where id=?').run(at,id),
  close:()=>db.close(),
 };
}
