// Server identity adapter: project-owned admission branch for an operator-installed integration.
// The native hook that would call onNativeApproval() is NOT selected or proven yet (see HANDOFF.md:
// candidate is ConnectionAcceptor.uLink_OnPlayerApproval, as patched by archived Oxide IOnUserApprove).
// Everything here is tested against mocks only.
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {PlayerWatch,DEFAULT_LIMITS} from './anticheat.mjs';
import {createTransferTracker} from './item-transfers.mjs';
import {DesktopCombat} from './desktop-combat.mjs';

const sha256=b=>createHash('sha256').update(b).digest();
const same=(a,b)=>a.length===b.length&&timingSafeEqual(a,b);

// Admission envelope carried in the native login's authentication-bytes field. Distinct magic so it can never be
// mistaken for (or presented as) a Steam ticket. 'RLBA' = browser (the gateway's own native session), 'RLBD' = desktop
// (the player's game, given the envelope by the launcher's steam_api proxy: DESKTOP-LAUNCHER-PLAN.md). Layout:
// magic | version 1 | 16-byte gateway session id | 32-byte binding secret  = 53 bytes (the client allows 1024).
const MAGICS={browser:Buffer.from('RLBA'),desktop:Buffer.from('RLBD')},ENVELOPE_LENGTH=53;
export function encodeEnvelope({sessionId,secret,kind='browser'}){
 if(sessionId.length!==16||secret.length!==32||!MAGICS[kind])throw Error('Bad envelope fields');
 return Buffer.concat([MAGICS[kind],Buffer.from([1]),sessionId,secret]);
}
// Returns null for anything that is not our envelope, so normal native authentication proceeds untouched.
export function parseEnvelope(bytes){
 const kind=Buffer.isBuffer(bytes)&&bytes.length>=5?Object.keys(MAGICS).find(k=>bytes.subarray(0,4).equals(MAGICS[k])):null;
 if(!kind)return null;
 if(bytes[4]!==1||bytes.length!==ENVELOPE_LENGTH)return {invalid:true,kind};
 return {kind,sessionId:bytes.subarray(5,21),secret:bytes.subarray(21,53)};
}

// Authenticated local control channel between the gateway (and the host app) and the adapter: HMAC over
// {seq, boot, body}, with a strictly increasing sequence per sender run. Each sender process picks a random boot id, so a
// gateway restarted on its own (the host app's Restart, a crash restart) is not refused because the sidecar remembers
// the old run's higher sequence numbers; replaying any message of a remembered run still fails.
const MAX_CONTROL_BOOTS=64;
export function createControlSender(key){
 let seq=0;const boot=randomBytes(8).toString('hex');
 return body=>{const message={seq:++seq,boot,body};return {...message,mac:createHmac('sha256',key).update(JSON.stringify(message)).digest('base64url')};};
}
function createControlVerifier(key){
 const boots=new Map(); // boot → last sequence, most recently used last
 return m=>{
  if(!m||!Number.isSafeInteger(m.seq)||typeof m.mac!=='string'||typeof m.boot!=='string'||!/^[0-9a-f]{16}$/.test(m.boot))return null;
  const expected=createHmac('sha256',key).update(JSON.stringify({seq:m.seq,boot:m.boot,body:m.body})).digest();
  if(!same(Buffer.from(m.mac,'base64url'),expected)||m.seq<=(boots.get(m.boot)??0))return null;
  boots.delete(m.boot);boots.set(m.boot,m.seq);
  if(boots.size>MAX_CONTROL_BOOTS)boots.delete(boots.keys().next().value);
  return m.body;
 };
}

// Server-owned map from website account subject to native backend identity (UInt64 as decimal string).
// New browser identities are only allocated inside an operator-confirmed namespace; null disables them.
// entries/onChange let the sidecar persist the map (it must survive restarts with the world saves).
export function createIdentityMap({namespace=null,isKnownNativeId=()=>false,entries=[],onChange=()=>{}}={}){
 const bySubject=new Map(),bySubjectBackend=new Map();
 for(const [subject,backendId] of entries){if(bySubject.has(subject)||bySubjectBackend.has(backendId))throw Error('Duplicate identity entry');bySubject.set(subject,backendId);bySubjectBackend.set(backendId,subject);}
 const changed=()=>onChange([...bySubject]);
 const ns=namespace&&{base:BigInt(namespace.base),size:BigInt(namespace.size)};
 if(ns&&(ns.size<=0n||ns.base<0n||ns.base+ns.size>2n**64n))throw Error('Bad namespace');
 const taken=id=>bySubjectBackend.has(id)||isKnownNativeId(id);
 return {
  resolve:subject=>bySubject.get(subject)??null,
  subjectFor:backendId=>bySubjectBackend.get(backendId)??null,
  allocate(subject){
   const existing=bySubject.get(subject);if(existing)return existing;
   if(!ns)return null;
   for(let i=0;i<32;i++){
    const id=(ns.base+BigInt('0x'+randomBytes(8).toString('hex'))%ns.size).toString();
    if(!taken(id)){bySubject.set(subject,id);bySubjectBackend.set(id,subject);changed();return id;}
   }
   throw Error('Identity namespace exhausted');
  },
  link(subject,backendId){
   if(bySubject.has(subject)||bySubjectBackend.has(backendId))return false;
   bySubject.set(subject,backendId);bySubjectBackend.set(backendId,subject);changed();return true;
  },
  // Owner unlink (host app Accounts page). The backend identity, and so the character and its save, stays on the server.
  remove(subject){const id=bySubject.get(subject);if(!id)return null;bySubject.delete(subject);bySubjectBackend.delete(id);changed();return id;},
  get size(){return bySubject.size;},
  entries:()=>[...bySubject],
  namespace:ns?{base:ns.base.toString(),size:ns.size.toString()}:null,
 };
}

const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Admin actions the plugin executes with the original server APIs (ANTICHEAT-ADMIN-PLAN.md). A fixed list: the
// channel never carries console strings. actor = the acting admin's own character (teleport-to / bring).
export const ADMIN_ACTIONS=Object.freeze({'teleport-to':{actor:true},bring:{actor:true},message:{},'kick-native':{},'ban-native':{},'unban-native':{}});
// Server-wide actions for the host app's save-and-quit and restart warnings (HOST-AND-LOADER-BUILD.md H1), also a fixed
// list: save (the server's own save), broadcast {message} (chat to everyone as "Server"), quit. They carry no target, and
// their results stay here for the host (server-commands); they are not website admin commands, so nothing goes to central.
export const SERVER_ACTIONS=Object.freeze({save:{},broadcast:{message:true},quit:{}});
const MAX_SERVER_COMMANDS=50;
// Desktop players reach central only as opaque per-server handles (HMAC of the native ID under the control key), so
// the website can act on them without ever holding their SteamIDs. Roster entries older than this are not reported.
const ROSTER_STALE_MS=30000,MAX_ROSTER=500,MAX_HANDLES=5000;
// A lease the plugin's poll no longer lists is released after this long: the server restarted or crashed (no disconnect
// reports come for its old connections) or a report was lost. The grace covers a player approved but not yet listed.
const LEASE_GRACE_MS=60000;
// Desktop anti-cheat: the plugin samples each desktop player's server-side position every poll (about 2 s), so the
// movement budget must cover a whole sample interval; teleports then need more than 30 + 25 m in one sample.
export const DESKTOP_LIMITS=Object.freeze({...DEFAULT_LIMITS,burstSeconds:3,riseWindow:4});
const COMMAND_TTL_MS=60000,MAX_COMMANDS=100,MAX_OUTBOX=500,REPORT_COOLDOWN_MS=60000;
// desktopAnticheat: {limits, policy, combat} for the PlayerWatch run on desktop players' sampled positions and the
// server's combat facts (false disables); itemTransfers: {ttlMs, maxStamps} for the provenance tracker (false disables).
export function createIdentityAdapter({serverId,controlKey,identities=createIdentityMap(),isBanned=()=>false,steamGroupWhitelisted=()=>false,trustSteamIds=false,now=Date.now,pendingTtlMs=30000,linkTtlMs=300000,reservationTtlMs=60000,maxLinkAttempts=10,desktopAnticheat={},itemTransfers={}}){
 const verifyControl=createControlVerifier(controlKey);
 const pending=new Map(); // session id hex -> pending admission
 const leases=new Map();  // backend id -> {connection, kind}
 const byConnection=new Map(); // connection -> backend id
 const challenges=new Map(),reservations=new Map(),confirmed=new Map();
 const commands=[],outbox=[],lastReport=new Map(); // admin commands for the plugin; results and reports for the gateway
 const handles=new Map(); // handle → native id, for every player the plugin has listed (bounded, oldest dropped)
 let roster=null;         // {at, players:[{id, name}]} from the plugin's last poll
 const watches=new Map(); // native id → {watch, life} for desktop players with a sampled position
 const teleported=new Set(); // native ids an admin teleport was handed to the plugin for: their next sample is a new baseline
 let sampleClock=0;       // seconds; PlayerWatch reads it so its timing follows the samples, not wall-clock arrival
 const desktopEnds=[]; // last end-desktop requests, for the host app's Accounts page (status)
 const serverCommands=new Map(); // id → {id, action, at, state: queued|sent|done|failed|expired, reason}, newest last
 let lastPoll=null;    // when the plugin last polled: the host only relies on save-and-quit while it does
 const unlinks=[];     // last owner unlinks, likewise
 const transfers=itemTransfers===false?null:createTransferTracker({now,...itemTransfers});
 let evidenceStats={moves:0,transfers:0,shots:0,hits:0,lost:0};
 const handleFor=id=>createHmac('sha256',controlKey).update('handle:'+id).digest('base64url').slice(0,16);
 const toOutbox=e=>{outbox.push(e);if(outbox.length>MAX_OUTBOX)outbox.shift();};
 let linkFailures=0,linkWindow=now();
 const prune=t=>{for(const m of [pending,challenges,reservations])for(const [k,v] of m)if(v.expires<=t)m.delete(k);};
 function acquire(backendId,connection,kind,sessionId=null){
  if(leases.has(backendId))return false; // never displace a live session (Oxide's kick-existing behaviour is rejected)
  leases.set(backendId,{connection,kind,since:now(),sessionId});byConnection.set(connection,backendId);return true;
 }
 return {
  // Gateway -> adapter. Returns {ok, backendId} or {ok:false, reason}.
  handleControl(message){
   const body=verifyControl(message);if(!body)return {ok:false,reason:'unauthenticated'};
   prune(now());
   if(body.serverId!==serverId)return {ok:false,reason:'wrong-server'};
   // Link redemption arrives from the account service through the gateway's authenticated channel.
   if(body.type==='reserve-link')return typeof body.subject==='string'&&body.subject?this.reserveLink(body):{ok:false,reason:'malformed'};
   if(body.type==='confirm-link')return this.confirmLink(body.reservationId);
   if(body.type==='admin-command')return this.queueCommand(body);
   if(body.type==='server-command')return this.queueServerCommand(body);
   if(body.type==='server-commands')return {ok:true,...this.serverCommandStatus()};
   if(body.type==='drain-events')return {ok:true,events:outbox.splice(0),desktop:this.desktopRoster()};
   if(body.type==='status')return {ok:true,...this.status()};
   if(body.type==='end-desktop')return typeof body.subject==='string'&&body.subject?this.endDesktop(body):{ok:false,reason:'malformed'};
   if(body.type==='unlink')return typeof body.subject==='string'&&body.subject?this.unlink(body):{ok:false,reason:'malformed'};
   if(body.type==='gateway-started')return this.gatewayStarted();
   // The gateway's own session for this backendId ended (gateway-service.mjs end()): release its lease at once,
   // rather than wait for the plugin's next roster poll (which, after the real server restarts rather than just
   // that one player disconnecting, may be minutes away — the plugin that would otherwise report the disconnect
   // died with the old server process). Matched by session id so a lease a newer join already holds is never
   // touched: acquire() never overwrites a live lease, so if the current lease's session id differs, this request
   // is for one that has already been superseded or released some other way, and does nothing.
   if(body.type==='release-lease'){
    if(typeof body.backendId!=='string'||typeof body.sessionId!=='string')return {ok:false,reason:'malformed'};
    const l=leases.get(body.backendId);
    if(l&&l.sessionId===body.sessionId){leases.delete(body.backendId);if(byConnection.get(l.connection)===body.backendId)byConnection.delete(l.connection);}
    return {ok:true};
   }
   if(body.type!=='register-pending')return {ok:false,reason:'unknown-message'};
   const {subject,serverId:aud,joinId,sessionId,secretDigest}=body,kind=body.kind??'browser';
   if(kind!=='browser'&&kind!=='desktop')return {ok:false,reason:'malformed'};
   if(aud!==serverId)return {ok:false,reason:'wrong-server'};
   if(steamGroupWhitelisted())return {ok:false,reason:'group-whitelist'};
   if(typeof subject!=='string'||!/^[0-9a-f]{32}$/.test(sessionId??'')||!/^[0-9a-f]{64}$/.test(secretDigest??'')||typeof joinId!=='string')return {ok:false,reason:'malformed'};
   if(pending.has(sessionId))return {ok:false,reason:'duplicate-session'};
   // Servers that authenticate genuine Steam tickets may map a central-verified Steam sign-in to that SteamID,
   // only if the operator opted in here (trustSteamIds) and the owner marked the server Steam-verified centrally.
   let backendId=identities.resolve(subject);
   if(!backendId&&trustSteamIds&&/^7656119\d{10}$/.test(body.steamId??'')){
    if(identities.subjectFor(body.steamId))return {ok:false,reason:'conflict'};
    if(isBanned(body.steamId))return {ok:false,reason:'banned'};
    identities.link(subject,body.steamId);backendId=body.steamId;
   }
   backendId??=identities.allocate(subject);
   if(!backendId)return {ok:false,reason:'no-identity'};
   if(isBanned(backendId))return {ok:false,reason:'banned'};
   if(leases.has(backendId))return {ok:false,reason:'already-connected'};
   pending.set(sessionId,{subject,joinId,kind,backendId,digest:Buffer.from(secretDigest,'hex'),expires:now()+pendingTtlMs});
   return {ok:true,backendId};
  },
  // Replaces only ClientConnection.DoSteamAuthorisation for envelope logins; the native ban and
  // IsConnected checks have already run on claimedUserId (see EXISTING-SERVER-INTEGRATION-PLAN.md verdict).
  // path 'native' means: not ours, continue normal authentication unchanged.
  onNativeApproval({authBytes,claimedUserId,connection}){
   const env=parseEnvelope(authBytes);
   if(!env)return {path:'native'};
   const deny=reason=>({path:'browser',approved:false,reason});
   if(env.invalid)return deny('malformed');
   // Server.SteamGroup != 0: native DoSteamGroupTest needs Steam membership a browser identity cannot have.
   if(steamGroupWhitelisted())return deny('group-whitelist');
   prune(now());
   const key=env.sessionId.toString('hex'),p=pending.get(key);
   if(!p)return deny('unknown-session');
   pending.delete(key); // one attempt only, whether or not the proof matches
   if(!same(sha256(env.secret),p.digest))return deny('bad-proof');
   if(env.kind!==p.kind)return deny('wrong-kind'); // a desktop envelope never completes a gateway session, nor the reverse
   if(String(claimedUserId)!==p.backendId)return deny('identity-mismatch');
   if(isBanned(p.backendId))return deny('banned');
   if(!acquire(p.backendId,connection,p.kind,key))return deny('already-connected');
   return {path:'browser',approved:true,kind:p.kind,backendId:p.backendId,subject:p.subject,joinId:p.joinId};
  },
  // Central → gateway: this account's desktop launcher signed out, was revoked, lost its heartbeat lease or was kicked.
  // Kicks the character only while a desktop (launcher) login holds it; browser sessions and native players are left alone.
  endDesktop({subject,reason}){
   const backendId=identities.resolve(subject),kicked=Boolean(backendId&&leases.get(backendId)?.kind==='desktop');
   desktopEnds.push({at:now(),subject,reason:String(reason??'launcher-ended').slice(0,40),kicked});if(desktopEnds.length>100)desktopEnds.shift();
   if(!kicked)return {ok:true,kicked:false};
   if(commands.length>=MAX_COMMANDS)return {ok:false,reason:'queue-full'};
   commands.push({id:randomUUID(),action:'kick-native',targetId:backendId,reason:String(reason??'launcher-ended').slice(0,40),expires:now()+COMMAND_TTL_MS});
   return {ok:true,kicked:true};
  },
  // A (re)started gateway owns no browser session yet, so every browser lease is left over from its previous process (a
  // crash ends its native sessions without a Lidgren Disconnect). The original server would keep those players connected
  // until it times them out and refuse their rejoins meanwhile (ConnectionAcceptor IsConnected → AlreadyConnected), so
  // the plugin kicks each one still in its roster (the disconnect report then frees the lease); leases the roster no
  // longer lists are released now. Pending browser admissions of the old process can never complete and are dropped.
  gatewayStarted(){
   const fresh=roster&&now()-roster.at<ROSTER_STALE_MS,listed=new Set(fresh?roster.players.map(p=>p.id):[]);
   let kicked=0,released=0;
   for(const [id,l] of [...leases]){
    if(l.kind!=='browser')continue;
    if(fresh&&!listed.has(id)){leases.delete(id);if(byConnection.get(l.connection)===id)byConnection.delete(l.connection);released++;continue;}
    if(commands.length>=MAX_COMMANDS||commands.some(c=>c.action==='kick-native'&&c.targetId===id))continue;
    commands.push({id:randomUUID(),action:'kick-native',targetId:id,reason:'gateway-restarted',expires:now()+COMMAND_TTL_MS});kicked++;
   }
   for(const [k,p] of pending)if(p.kind==='browser')pending.delete(k);
   return {ok:true,kicked,released};
  },
  // Owner unlink from the host app (HOST-APP-PLAN.md "Accounts and links"). Refused while the character is in the game
  // or a link is half done; central learns of it through the outbox (link-removed) on the gateway's next report.
  unlink({subject,reason}){
   const backendId=identities.resolve(subject);
   if(!backendId)return {ok:false,reason:'not-linked'};
   if(leases.has(backendId))return {ok:false,reason:'online'};
   if([...reservations.values()].some(r=>r.subject===subject))return {ok:false,reason:'link-in-progress'};
   identities.remove(subject);
   const why=String(reason??'owner').slice(0,200);
   unlinks.push({at:now(),subject,backendId,reason:why});if(unlinks.length>100)unlinks.shift();
   toOutbox({type:'link-removed',subject,backendId,reason:why});
   return {ok:true,backendId};
  },
  // Native players that passed normal authentication; recorded so they hold the identity lease and can link.
  onNativeAuthenticated({backendId,connection}){return acquire(String(backendId),connection,'native');},
  onDisconnect(connection){const id=byConnection.get(connection);if(id===undefined)return;byConnection.delete(connection);if(leases.get(id)?.connection===connection)leases.delete(id);},
  // Proposed /browserlink: only for a connection holding a native lease. Delivered privately to that player.
  issueLinkChallenge(connection){
   const backendId=byConnection.get(connection);
   if(backendId===undefined||leases.get(backendId).kind!=='native')return null;
   if(identities.subjectFor(backendId))return null;
   const bytes=randomBytes(10);let code='';for(const b of bytes)code+=CODE_ALPHABET[b%32];
   challenges.set(code,{backendId,expires:now()+linkTtlMs});return code;
  },
  // Step 1 of the two-sided link (website/account service has authenticated `subject`).
  reserveLink({code,subject}){
   prune(now());
   if(now()-linkWindow>=60000){linkWindow=now();linkFailures=0;}
   if(linkFailures>=maxLinkAttempts)return {ok:false,reason:'rate-limited'};
   const c=challenges.get(String(code).toUpperCase());
   if(!c){linkFailures++;return {ok:false,reason:'unknown-code'};}
   challenges.delete(String(code).toUpperCase());
   if(identities.resolve(subject))return {ok:false,reason:'subject-already-linked'};
   if(identities.subjectFor(c.backendId)||[...reservations.values()].some(r=>r.backendId===c.backendId||r.subject===subject))return {ok:false,reason:'conflict'};
   const reservationId=randomUUID();reservations.set(reservationId,{subject,backendId:c.backendId,expires:now()+reservationTtlMs});
   return {ok:true,reservationId,backendId:c.backendId};
  },
  // Step 2, after the account service committed its side. Idempotent for the same reservation.
  confirmLink(reservationId){
   if(confirmed.has(reservationId))return {ok:true,backendId:confirmed.get(reservationId)};
   prune(now());
   const r=reservations.get(reservationId);
   if(!r)return {ok:false,reason:'unknown-reservation'};
   reservations.delete(reservationId);
   if(!identities.link(r.subject,r.backendId))return {ok:false,reason:'conflict'};
   confirmed.set(reservationId,r.backendId);
   return {ok:true,backendId:r.backendId};
  },
  // Central → gateway → here: resolve account subjects to this server's identities and queue for the plugin.
  // Target by website account (subject) or, for desktop players, by the handle from desktopRoster().
  queueCommand({id,action,subject,handle,actorSubject,reason,message}){
   const spec=Object.hasOwn(ADMIN_ACTIONS,action)?ADMIN_ACTIONS[action]:null;
   if(!spec||typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)||(typeof subject!=='string'&&typeof handle!=='string'))return {ok:false,reason:'malformed'};
   if(action==='message'&&(typeof message!=='string'||!message.trim()||message.length>200))return {ok:false,reason:'malformed'};
   const targetId=typeof subject==='string'?identities.resolve(subject):handles.get(handle);
   if(!targetId)return {ok:false,reason:typeof subject==='string'?'no-identity':'unknown-handle'};
   const actorId=spec.actor?identities.resolve(actorSubject):undefined;
   if(spec.actor&&!actorId)return {ok:false,reason:'admin-not-on-server'};
   if(commands.length>=MAX_COMMANDS)return {ok:false,reason:'queue-full'};
   commands.push({id,action,targetId,...(actorId?{actorId}:{}),reason:String(reason??'').slice(0,200),...(action==='message'?{message:message.trim()}:{}),expires:now()+COMMAND_TTL_MS});
   return {ok:true,queued:true};
  },
  // Host app (server-wide, no target). Queued like admin commands; the plugin tells them apart by action.
  queueServerCommand({action,message}){
   const spec=Object.hasOwn(SERVER_ACTIONS,action)?SERVER_ACTIONS[action]:null;
   if(!spec)return {ok:false,reason:'malformed'};
   if(spec.message&&(typeof message!=='string'||!message.trim()||message.length>200))return {ok:false,reason:'malformed'};
   if(commands.length>=MAX_COMMANDS)return {ok:false,reason:'queue-full'};
   const id=randomUUID();
   commands.push({id,action,...(spec.message?{message:message.trim()}:{}),server:true,expires:now()+COMMAND_TTL_MS});
   serverCommands.set(id,{id,action,at:now(),state:'queued'});
   while(serverCommands.size>MAX_SERVER_COMMANDS)serverCommands.delete(serverCommands.keys().next().value);
   return {ok:true,id};
  },
  serverCommandStatus(){
   const fresh=roster&&now()-roster.at<ROSTER_STALE_MS;
   return {plugin:{polledAgoMs:lastPoll==null?null:now()-lastPoll,players:fresh?roster.players.length:null},commands:[...serverCommands.values()].map(c=>({...c}))};
  },
  // Plugin poll: unexpired commands, each delivered once; expired ones are reported as failed.
  takeCommands(){
   const t=now(),out=[];lastPoll=t;
   for(const c of commands.splice(0)){
    const sc=c.server?serverCommands.get(c.id):null;
    if(c.expires<=t){if(c.server){if(sc)sc.state='expired';}else toOutbox({type:'command-result',id:c.id,ok:false,reason:'expired'});}
    else{const {expires,server,...rest}=c;if(sc)sc.state='sent';out.push(rest);}
   }
   // The plugin runs these before its next poll; the character it moves must not be scored for the jump.
   if(desktopAnticheat!==false)for(const c of out)if(c.action==='teleport-to'||c.action==='bring')teleported.add(c.action==='teleport-to'?c.actorId:c.targetId);
   return out;
  },
  commandResult({id,ok,reason}){if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))return false;
   const sc=serverCommands.get(id);if(sc){sc.state=ok===true?'done':'failed';if(ok!==true)sc.reason=String(reason??'failed').slice(0,40);return true;}
   toOutbox({type:'command-result',id,ok:ok===true,reason:ok===true?null:String(reason??'failed').slice(0,40)});return true;},
  // In-game /report: only players whose character maps to a website account can report (accountable, rate-limited).
  report({connection,targetName,targetId,text}){
   const backendId=byConnection.get(connection);if(backendId===undefined)return {ok:false,reason:'unknown-connection'};
   const reporter=identities.subjectFor(backendId);if(!reporter)return {ok:false,reason:'not-linked'};
   if(typeof targetName!=='string'||!targetName.trim()||targetName.length>32)return {ok:false,reason:'malformed'};
   const t=now();if(t-(lastReport.get(reporter)??-Infinity)<REPORT_COOLDOWN_MS)return {ok:false,reason:'cooldown'};
   lastReport.set(reporter,t);
   const target=/^\d{1,20}$/.test(String(targetId??''))?identities.subjectFor(String(targetId)):null;
   toOutbox({type:'report',reporter,...(target?{target}:{}),targetName:targetName.trim(),text:String(text??'').trim().slice(0,500)});
   return {ok:true};
  },
  // Plugin poll: every connected player (native ID and display name), browser players included.
  // pos (Unity metres, server-side character position), life (changes when a new character spawns) and ip (the native
  // connection's address, desktop players only) are optional.
  setRoster(players){
   if(!Array.isArray(players)||players.length>MAX_ROSTER)return false;
   const clean=players.filter(p=>/^\d{1,20}$/.test(String(p?.id??''))&&typeof p.name==='string').map(p=>({id:String(p.id),name:p.name.slice(0,32),
    ...(Array.isArray(p.pos)&&p.pos.length===3&&p.pos.every(Number.isFinite)?{pos:p.pos.map(Number)}:{}),...(typeof p.life==='string'&&p.life.length<=24?{life:p.life}:{}),
    ...(typeof p.ip==='string'&&p.ip.length<=45&&isIP(p.ip.replace(/^::ffff:(?=\d+\.)/i,''))?{ip:p.ip.replace(/^::ffff:(?=\d+\.)/i,'')}:{})}));
   for(const p of clean){const h=handleFor(p.id);handles.delete(h);handles.set(h,p.id);}
   while(handles.size>MAX_HANDLES)handles.delete(handles.keys().next().value);
   roster={at:now(),players:clean};
   // The original server checks IsConnected itself and has nobody connected after a restart: without this, everyone online
   // when it stopped was refused "already-connected" until the sidecar restarted (load test on the Azure VM, 2026-10-22).
   const listed=new Set(clean.map(p=>p.id)),t=now();
   for(const [id,l] of leases)if(!listed.has(id)&&t-l.since>LEASE_GRACE_MS){leases.delete(id);if(byConnection.get(l.connection)===id)byConnection.delete(l.connection);}
   if(desktopAnticheat!==false)this.watchDesktop(clean);
   return true;
  },
  // The gateway's PlayerWatch on server-sampled positions: speed, teleport, fly and (with a heightmap) under-terrain.
  // A new character (respawn, sleeping bag) resets the baseline; players who left are forgotten.
  watchDesktop(players){
   sampleClock=now()/1000;const seen=new Set();
   for(const p of players){
    if(!p.pos||leases.get(p.id)?.kind==='browser')continue;
    seen.add(p.id);let w=watches.get(p.id);
    if(!w){w={watch:new PlayerWatch({subject:handleFor(p.id),name:p.name,limits:{...DESKTOP_LIMITS,...desktopAnticheat.limits},policy:desktopAnticheat.policy,groundHeight:desktopAnticheat.groundHeight??null,now:()=>sampleClock,wallNow:now}),life:undefined};watches.set(p.id,w);}
    w.watch.name=p.name;
    if(p.life!==w.life){w.life=p.life;w.watch.observe({type:'create',mine:true,prefab:':player_soldier',viewId:1,position:p.pos});continue;}
    // Website Go to / Bring moved this character (TeleportPlayerToWorld): a server-originated position, not a move.
    if(teleported.has(p.id)){w.watch.resetMovement(p.pos);continue;}
    w.watch.check({type:'move',origin:p.pos});
    this.drainDesktop(p.id,w.watch);
   }
   for(const id of watches.keys())if(!seen.has(id))watches.delete(id);
   teleported.clear(); // marks are made after a poll's samples (takeCommands), so this pass was the one they were for
  },
  drainDesktop(id,watch){for(const f of watch.drain()){const subject=identities.subjectFor(id);toOutbox({type:'desktop-flag',handle:f.subject,name:watch.name,...(subject?{subject}:{}),kind:f.kind,severity:f.severity,score:f.score,at:f.at,detail:f.detail,...(f.replay?{replay:f.replay}:{})});}},
  // Plugin poll evidence (vanilla adapter, ANTICHEAT-ADMIN-PLAN slice 8): item moves/drops → item-transfer events for
  // central (by account where the character maps to one, else by handle); desktop combat facts and inventory op counts →
  // flags on that desktop player's watch. Browser sessions' combat is the gateway's; their item moves count here too.
  evidence({moves,shots,hits,ops,lost,window:seconds}={}){
   const names=new Map((roster?.players??[]).map(p=>[p.id,p.name])),stats={moves:0,transfers:0,shots:0,hits:0,lost:Number.isInteger(lost)?lost:0};
   if(transfers&&Array.isArray(moves))for(const fact of moves.slice(0,500)){
    stats.moves++;
    for(const t of transfers.apply(fact)){
     stats.transfers++;const fromSubject=identities.subjectFor(t.from),toSubject=identities.subjectFor(t.to);
     toOutbox({type:'item-transfer',...(fromSubject?{from:fromSubject}:{}),...(toSubject?{to:toSubject}:{}),fromHandle:handleFor(t.from),toHandle:handleFor(t.to),
      fromName:names.get(t.from)??null,toName:names.get(t.to)??null,item:t.item,amount:t.amount,via:t.via,at:now()});
    }
   }
   if(desktopAnticheat!==false){
    const desktop=id=>{if(leases.get(id)?.kind==='browser')return null;const w=watches.get(id);if(!w)return null;w.combat??=new DesktopCombat(desktopAnticheat.combat);return w;};
    const touched=new Set();
    if(Array.isArray(shots)){const byId=new Map();for(const s of shots.slice(0,200)){const id=String(s?.id??'');if(!/^\d{1,20}$/.test(id))continue;if(!byId.has(id))byId.set(id,[]);byId.get(id).push(s);stats.shots+=Array.isArray(s.t)?s.t.length:0;}
     for(const [id,list] of byId){const w=desktop(id);if(w){w.combat.shots(w.watch,list);touched.add(id);}}}
    if(Array.isArray(hits))for(const h of hits.slice(0,500)){const id=String(h?.id??'');if(!/^\d{1,20}$/.test(id))continue;stats.hits++;const w=desktop(id);if(!w)continue;
     const target=/^\d{1,20}$/.test(String(h.target??''))?String(h.target):null;w.combat.hit(w.watch,h,{targetName:target?(names.get(target)??handleFor(target)):null});touched.add(id);}
    if(ops&&typeof ops==='object'&&Number.isFinite(seconds))for(const [id,n] of Object.entries(ops).slice(0,500)){const w=/^\d{1,20}$/.test(id)&&desktop(id);if(w){w.combat.inventory(w.watch,n,seconds);touched.add(id);}}
    for(const id of touched)this.drainDesktop(id,watches.get(id).watch);
   }
   evidenceStats=stats;return stats;
  },
  // Desktop players for central: handle, name, address and the linked website account if any. Browser sessions are left
  // out (the gateway reports those with their anti-cheat scores and addresses; their native address is the gateway's own).
  // null when the plugin has not listed players recently.
  desktopRoster(){
   if(!roster||now()-roster.at>ROSTER_STALE_MS)return null;
   return roster.players.filter(p=>leases.get(p.id)?.kind!=='browser').map(p=>{
    const subject=identities.subjectFor(p.id),w=watches.get(p.id)?.watch;
    return {handle:handleFor(p.id),name:p.name,...(subject?{subject}:{}),...(p.ip?{ip:p.ip}:{}),...(w?{score:w.summary().score,flags:w.summary().flags}:{})};
   });
  },
  // Read-only view for the host app (HOST-APP-PLAN.md Accounts/Links page): live leases, link reservations, desktop ends.
  status(){
   prune(now());
   return {leases:[...leases].map(([backendId,l])=>({backendId,kind:l.kind,subject:identities.subjectFor(backendId),since:l.since})),
    reservations:[...reservations].map(([id,r])=>({id,subject:r.subject,backendId:r.backendId,expires:r.expires})),
    desktopEnds:desktopEnds.slice(),unlinks:unlinks.slice(),
    // Linked identities (subject → backend id), for the host app's Accounts page; the namespace is where new browser characters are allocated.
    identities:{count:identities.size??null,namespace:identities.namespace??null,entries:identities.entries?identities.entries().slice(0,5000).map(([subject,backendId])=>({subject,backendId})):[]}};
  },
  stats:()=>({pending:pending.size,leases:leases.size,commands:commands.length,outbox:outbox.length,handles:handles.size,watches:watches.size,stamps:transfers?.size()??0,evidence:{...evidenceStats}}),
 };
}
