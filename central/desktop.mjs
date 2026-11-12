// Desktop launcher API (DESKTOP-LAUNCHER-PLAN.md). The launcher signs in with the website account, asks for a one-use
// desktop pass per join and keeps a heartbeat lease while the game runs. Mounted by createCentralService.
//
// Launcher (Authorization: Bearer <desktop token>; no cookies, so no CSRF): POST /desktop/login, POST /desktop/register,
//   POST /desktop/device,
//   POST /desktop/device/token, GET /desktop/me, GET /desktop/servers, POST /desktop/servers/{id}/pass,
//   POST /desktop/heartbeat, POST /desktop/signout
// Website (session cookie + CSRF): POST /desktop/device/approve (Steam accounts sign a launcher in with a code),
//   GET /account/desktop-sessions, POST /account/desktop-sessions/revoke
// Lease ends reach the server's gateway through /bridge/tasks (service.mjs) as {type:'desktop-ended', subject}.
// Hardware ID (DESKTOP-LAUNCHER-PLAN.md "Hardware ID"): login, register, device/token and pass bodies may carry hwid "v1:<43>";
// central keeps only its HMAC as an identifier (central/identity.mjs), so a ban reaches the machine's next account.
import {randomBytes,randomUUID} from 'node:crypto';
import {hashSecret} from './db.mjs';
import {DESKTOP_PROFILE} from '../bridge/admission.mjs';
import {HWID} from './identity.mjs';

const SESSION_MS=30*24*3600e3,LEASE_MS=60e3,HEARTBEAT_S=15,DEVICE_MS=10*60e3,DEVICE_POLL_S=3;
const STATES=['connected','in-game','idle'];
// Device codes: unambiguous letters and digits, shown as XXXX-XXXX.
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',USER_CODE=/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const deviceName=v=>String(v??'').replace(/[^\p{L}\p{N} ._()-]/gu,'').trim().slice(0,48)||'Desktop launcher';

// The gateway's HTTPS twin of its registered WebSocket endpoint: wss://host[:port]/play → https://host[:port]/desktop/admit.
export function admitUrlFor(endpoint){const u=new URL(endpoint);u.protocol=u.protocol==='ws:'?'http:':'https:';u.pathname='/desktop/admit';u.search='';u.hash='';return u.href;}

export function createDesktopRoutes({db,now,body,website,limited,HttpError,passwordLogin,register,tickets,publicServer,online,policyRefusal,identity=null}){
 const devices=new Map(); // device code hash → {userCode, device, expires, player}
 const userCodes=new Map(); // user code → device code hash
 function launcher(req){
  const m=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
  const hash=m&&hashSecret(m[1]),s=hash&&db.desktopSession(hash,now());
  if(!s)throw new HttpError(401,'sign-in-required');
  const player=db.player(s.player_uuid);if(player.status!=='active')throw new HttpError(403,'account-suspended');
  return {player,session:s,hash};
 }
 function start(player,device){
  const token=randomBytes(32).toString('base64url'),id=randomUUID(),t=now();
  db.tx(()=>{db.createDesktopSession(hashSecret(token),id,player.uuid,deviceName(device),t+SESSION_MS,t);db.audit(t,player.uuid,'desktop-signed-in',player.uuid,{session:id});});
  return [200,{token,session:id,player:player.uuid,name:player.display_name,expiresAt:t+SESSION_MS,heartbeatSeconds:HEARTBEAT_S}];
 }
 function hardware(player,v){
  if(v===undefined||v===null)return;
  if(typeof v!=='string'||!HWID.test(v))throw new HttpError(400,'invalid-hwid');
  identity?.record(player.uuid,'hwid',v);
 }
 const prune=t=>{for(const [k,v] of devices)if(v.expires<=t){devices.delete(k);userCodes.delete(v.userCode);}};
 // Same checks as the website's join ticket (service.mjs), plus one launcher per account per server.
 async function joinable(player,id,hash){
  const s=db.server(id);
  if(!s||!s.listed||s.status!=='active')throw new HttpError(404,'unknown-server');
  if(!online(s))throw new HttpError(409,'server-offline');
  if(db.activeBan(player.uuid,s.uuid,now()))throw new HttpError(403,'banned');
  const refused=await policyRefusal(player,s.uuid);if(refused)throw new HttpError(403,refused);
  if(db.otherDesktopLease(player.uuid,s.uuid,hash,now()))throw new HttpError(409,'in-use-elsewhere');
  return s;
 }
 const routes={
  'POST /desktop/login':async req=>{
   if(limited(req,'login'))throw new HttpError(429,'rate-limited');
   const b=await body(req);
   const player=await passwordLogin(b.login,b.password);hardware(player,b.hwid);
   return start(player,b.device);
  },
  // A new player signs up from the launcher: the website's sign-up (accounts.mjs register: same rules, codes, rate
  // limit bucket, throwaway-domain list and one-account-per-person checks), then a launcher session as for login.
  // The website form's Origin check does not apply: a native app has no Origin and gets a bearer token, not a cookie.
  'POST /desktop/register':async req=>{
   if(limited(req,'login'))throw new HttpError(429,'rate-limited');
   const b=await body(req);
   if(b.hwid!==undefined&&b.hwid!==null&&(typeof b.hwid!=='string'||!HWID.test(b.hwid)))throw new HttpError(400,'invalid-hwid');
   return start(await register(b,b.hwid?[['hwid',b.hwid]]:[]),b.device);
  },
  // Steam accounts have no password: the launcher shows a code that a signed-in website session approves.
  'POST /desktop/device':async req=>{
   if(limited(req,'login'))throw new HttpError(429,'rate-limited');
   const b=await body(req),t=now();prune(t);
   const deviceCode=randomBytes(32).toString('base64url');let userCode;
   do{userCode='';for(const x of randomBytes(8))userCode+=CODE_ALPHABET[x%32];userCode=userCode.slice(0,4)+'-'+userCode.slice(4);}while(userCodes.has(userCode));
   devices.set(hashSecret(deviceCode),{userCode,device:deviceName(b.device),expires:t+DEVICE_MS,player:null});userCodes.set(userCode,hashSecret(deviceCode));
   return [200,{deviceCode,userCode,verificationPath:'/desktop/approve',intervalSeconds:DEVICE_POLL_S,expiresInSeconds:DEVICE_MS/1000}];
  },
  'POST /desktop/device/approve':async req=>{
   if(limited(req,'device-approve'))throw new HttpError(429,'rate-limited');
   const {player}=website(req,{mutation:true}),b=await body(req);prune(now());
   const code=String(b.userCode??'').toUpperCase().trim();
   if(!USER_CODE.test(code))throw new HttpError(400,'invalid-code');
   const key=userCodes.get(code.includes('-')?code:code.slice(0,4)+'-'+code.slice(4)),d=key&&devices.get(key);
   if(!d||d.player)throw new HttpError(404,'unknown-code');
   d.player=player.uuid;db.audit(now(),player.uuid,'desktop-device-approved',player.uuid);
   return [200,{approved:true,device:d.device}];
  },
  'POST /desktop/device/token':async req=>{
   const b=await body(req),t=now();prune(t);
   const key=typeof b.deviceCode==='string'&&hashSecret(b.deviceCode),d=key&&devices.get(key);
   if(!d)throw new HttpError(400,'expired-code');
   if(!d.player)return [200,{status:'pending',intervalSeconds:DEVICE_POLL_S}];
   devices.delete(key);userCodes.delete(d.userCode);
   const player=db.player(d.player);if(!player||player.status!=='active')throw new HttpError(403,'account-suspended');
   hardware(player,b.hwid);
   const [status,data]=start(player,d.device);return [status,{status:'approved',...data}];
  },
  'GET /desktop/me':async req=>{const {player,session}=launcher(req);return [200,{player:player.uuid,name:player.display_name,username:player.username??null,session:session.id,lease:session.lease_server?{server:session.lease_server,state:session.lease_state}:null}];},
  'GET /desktop/servers':async req=>{launcher(req);return [200,{servers:db.listedServers().map(publicServer)}];},
  // One-use pass for this server (60 s). The launcher hands it to the server's gateway, which redeems it once.
  'POST /desktop/servers/:id/pass':async(req,id)=>{
   if(limited(req,'desktop-pass'))throw new HttpError(429,'rate-limited');
   const {player,session,hash}=launcher(req);
   if(req.headers['content-type']==='application/json')hardware(player,(await body(req)).hwid);
   const s=await joinable(player,id,hash),t=now();
   // The lease is taken here; heartbeats keep it. A game already running on this server keeps its in-game state.
   db.setDesktopLease(hash,s.uuid,session.lease_server===s.uuid&&session.lease_state==='in-game'?'in-game':'connected',t+LEASE_MS,t);
   return [200,{pass:tickets.issueAdmission({subject:player.uuid,serverId:s.uuid,profile:DESKTOP_PROFILE}),admitUrl:admitUrlFor(s.endpoint),server:{id:s.uuid,name:s.name},expiresInSeconds:60,heartbeatSeconds:HEARTBEAT_S}];
  },
  // Every HEARTBEAT_S while connected or in game. 'idle' (game closed, no server) releases the lease.
  'POST /desktop/heartbeat':async req=>{
   const {player,session,hash}=launcher(req),b=await body(req),t=now();
   if(!STATES.includes(b.state))throw new HttpError(400,'invalid-state');
   if(b.state==='idle'||!b.serverId){db.endDesktopLease(hash,'game-exited',t);db.setDesktopLease(hash,null,null,null,t);return [200,{ok:true,lease:null,nextInSeconds:HEARTBEAT_S}];}
   if(typeof b.serverId!=='string'||!UUID.test(b.serverId))throw new HttpError(400,'invalid-server');
   // A ban or suspension since the last beat ends the lease (and the game session, through the gateway).
   const s=db.server(b.serverId),refusal=!s||s.status!=='active'?'unknown-server':db.activeBan(player.uuid,b.serverId,t)?'banned':db.otherDesktopLease(player.uuid,b.serverId,hash,t)?'in-use-elsewhere':session.lease_server&&session.lease_server!==b.serverId?'no-lease':null;
   if(refusal){if(session.lease_server===b.serverId)db.endDesktopLease(hash,refusal,t);return [409,{ok:false,reason:refusal}];}
   db.setDesktopLease(hash,b.serverId,b.state,t+LEASE_MS,t);
   return [200,{ok:true,lease:{server:b.serverId,state:b.state,expiresInSeconds:LEASE_MS/1000},nextInSeconds:HEARTBEAT_S}];
  },
  'POST /desktop/signout':async req=>{
   const {player,session,hash}=launcher(req),t=now();
   db.tx(()=>{db.deleteDesktopSession(hash,'signed-out',t);db.audit(t,player.uuid,'desktop-signed-out',player.uuid,{session:session.id});});
   return [200,{signedOut:true}];
  },
  'GET /account/desktop-sessions':async req=>{const {player}=website(req,{mutation:false});return [200,{sessions:db.desktopSessionsFor(player.uuid).map(s=>({id:s.id,device:s.device,createdAt:s.created_at,lastSeen:s.last_seen,server:s.lease_server,state:s.lease_state}))}];},
  'POST /account/desktop-sessions/revoke':async req=>{
   const {player}=website(req,{mutation:true}),b=await body(req),t=now();
   const s=typeof b.id==='string'&&db.raw.prepare('select token_hash from desktop_sessions where id=? and player_uuid=?').get(b.id,player.uuid);
   if(!s)throw new HttpError(404,'unknown-session');
   db.tx(()=>{db.deleteDesktopSession(s.token_hash,'revoked',t);db.audit(t,player.uuid,'desktop-session-revoked',player.uuid,{session:b.id});});
   return [200,{revoked:true}];
  },
 };
 return {routes};
}
