// Central account + directory API (HOSTING-ACCOUNTS-BRIDGE-PLAN §3–§9; BROWSER-SERVER-DECISION "Establishing
// identity on every join"). Project-owned; tested in-process only, not deployed.
//
// Website (session cookie + CSRF): POST /auth/login, POST /auth/logout, GET /me, GET /servers,
//   POST /servers/{id}/join-ticket, POST /servers/{id}/link, GET /links/{id}/status, POST /owner/servers, POST /owner/servers/{id}/name, POST /owner/servers/{id}/enrolment-code, POST /owner/servers/{id}/publish
// Bridge (per-server bearer credential): POST /bridge/enrol {code}, POST /bridge/redeem {ticket, kind?, ip?}, POST /bridge/heartbeat,
//   POST /bridge/tasks, POST /bridge/link-reserved, POST /bridge/link-confirmed (desktop character linking)
// Desktop launcher sign-in, passes and leases: central/desktop.mjs (DESKTOP-LAUNCHER-PLAN.md). Forum: central/forum.mjs. Leaderboards: central/stats.mjs.
// Admin tooling, player reports and POST /bridge/report: central/admin.mjs (ANTICHEAT-ADMIN-PLAN.md). Account bans are
// checked on join tickets, redemption and every gateway report. Admin screenshots: central/screenshots.mjs.
// One account per person (central/identity.mjs): POST /account/device (device token + soft signals, admin alt links
// only), POST /account/phone/start|verify (central/phone.mjs); bans reach every linked identifier at join time.
// IP logging and IP bans (central/ip-bans.mjs): addresses from signed-in pages, join tickets and the gateway's
// redemptions; an IP ban refuses join tickets and redemptions and kicks through the gateway report.
//
// Sign-in: GET /auth/steam/start → provider → GET /auth/steam/callback (central/providers.mjs), with a
// one-use state bound to an HttpOnly cookie. POST /auth/{provider}/link-start adds a second provider to a recently
// signed-in account. `verifyLogin` (POST /auth/login) is the development verifier for tests only; omit it in production.
import {randomBytes,randomUUID} from 'node:crypto';
import {createAccountService,AdmissionError,BROWSER_PROFILE,DESKTOP_PROFILE} from '../bridge/admission.mjs';
import {createHash} from 'node:crypto';
import {hashSecret} from './db.mjs';
import {LoginError,newLoginState} from './providers.mjs';
import {createAdminRoutes} from './admin.mjs';
import {createAccountRoutes,accountView} from './accounts.mjs';
import {createWikiRoutes} from './wiki.mjs';
import {createForumRoutes} from './forum.mjs';
import {createStatsRoutes} from './stats.mjs';
import {createHostRelayRoutes} from './host-relay.mjs';
import {createListingRoutes,publicListing} from './listings.mjs';
import {createWaitlistRoutes} from './waitlist.mjs';
import {createDesktopRoutes} from './desktop.mjs';
import {createClientIp} from '../bridge/client-ip.mjs';
import {createIdentity} from './identity.mjs';
import {createIpRegistry,normaliseIp} from './ip-bans.mjs';
import {normalisePhone} from './phone.mjs';
import {wantsSteamQuality,steamQualityRefusal} from './steam-quality.mjs';
import {createExternalServers} from './external-servers.mjs';

const LOGIN_STATE_MS=10*60e3,RECENT_AUTH_MS=15*60e3,SIGNUP_MS=15*60e3;
const MAX_BODY=8192,SESSION_MS=7*24*3600e3,ENROL_MS=15*60e3,HEARTBEAT_STALE_MS=60e3,LINK_MS=5*60e3,LINK_CODE=/^[A-HJ-NP-Z2-9]{10}$/;
// Central keeps only a salted hash of the native identity it was linked to (for UI/recovery), never the raw ID.
const backendRef=(server,id)=>createHash('sha256').update(server+':'+id).digest('hex');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEVICE_MS=2*365*86400e3,PHONE_MS=10*60e3,PHONE_TRIES=5,PHONE_STARTS_PER_HOUR=3;

export function createDevLoginVerifier(){
 return body=>{if(typeof body?.subject!=='string'||!/^[\w.-]{1,64}$/.test(body.subject))throw new HttpError(400,'invalid-login');return {issuer:'dev',subject:body.subject,name:String(body.name??'Player').slice(0,32)};};
}
class HttpError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}

// identity: {pepper?, disposableFile?, hostingFile?} for central/identity.mjs; phone: a central/phone.mjs provider (omit to
// hide phone verification); steamQuality: central/steam-quality.mjs (needed by servers that set Steam thresholds);
// screenshotRetentionDays: how long admin screenshots are kept (default 30); ipRetentionDays: how long logged IP
// addresses are kept (default 90).
export function createCentralService({db,keys,issuer,verifyLogin,providers={},publicUrl='https://play.example.test/',allowedOrigins,now=Date.now,secureCookies=true,rateLimit=30,onNotFound=null,onError=null,mailer,mailPauseMs=250,wikiResolvers=null,trustedProxies=[],identity:identityOptions={},phone=null,steamQuality=null,screenshotRetentionDays=30,ipRetentionDays=90,listingReview=false,externalServers:externalServersOptions={}}){
 const externalServers=createExternalServers({now,...externalServersOptions});
 // Rate limits key on the real client behind trusted proxies (Caddy, Cloudflare): bridge/client-ip.mjs.
 const clientIp=createClientIp(trustedProxies);
 const identity=createIdentity({db,now,...identityOptions});
 const ips=createIpRegistry({db,now,retentionMs:ipRetentionDays*86400e3});
 const replay={claim:()=>{throw Error('replay is server-scoped; use redeem')}}; // the account service below only issues
 const tickets=createAccountService({issuer,keys,now,replay,profiles:[BROWSER_PROFILE,DESKTOP_PROFILE]});
 const hits=new Map(),loginStates=new Map(); // state → {provider, verifier, expires, linkTo}
 const signups=new Map(); // rlb_signup token → {issuer, subject, name, expires}: provider sign-ups waiting for a username
 // Raw link codes live only in memory for their 5-minute window; the database holds request status.
 const linkTasks=new Map(); // request id → {server, subject, code, expires, dispatched}
 function limited(req,bucket){
  const key=bucket+':'+clientIp(req),t=now(),w=hits.get(key);
  if(!w||t-w.start>60e3){hits.set(key,{start:t,n:1});return false;}
  return ++w.n>rateLimit;
 }
 // A Buffer is sent as it is (admin screenshot images); the route sets its Content-Type.
 function send(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(Buffer.isBuffer(data)?data:JSON.stringify(data));}
 async function body(req,max=MAX_BODY){
  if(req.headers['content-type']!=='application/json')throw new HttpError(415,'json-required');
  let raw='';for await(const c of req){raw+=c;if(raw.length>max)throw new HttpError(413,'too-large');}
  try{return JSON.parse(raw||'{}');}catch{throw new HttpError(400,'malformed');}
 }
 const cookies=req=>Object.fromEntries((req.headers.cookie??'').split(';').map(c=>c.trim().split('=')).filter(p=>p.length===2));
 const cookie=req=>cookies(req)['rlb_session'];
 // Website calls: a valid session; mutations also need an allowed Origin and the session's CSRF token.
 function website(req,{mutation}){
  const token=cookie(req);const s=token&&db.session(hashSecret(token),now());
  if(!s)throw new HttpError(401,'sign-in-required');
  if(mutation&&(!allowedOrigins.includes(req.headers.origin)||req.headers['x-csrf-token']!==s.csrf))throw new HttpError(403,'csrf');
  const player=db.player(s.player_uuid);if(player.status!=='active')throw new HttpError(403,'account-suspended');
  return {player,token,session:s};
 }
 function bridge(req){
  const m=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
  const server=m&&db.credentialServer(hashSecret(m[1]));
  if(!server)throw new HttpError(401,'bridge-unauthenticated');
  return server;
 }
 const cookieFlags=(path,maxAge)=>`HttpOnly; Path=${path}; SameSite=Lax; Max-Age=${maxAge}${secureCookies?'; Secure':''}`;
 function startSession(player){
  const token=randomBytes(32).toString('base64url'),csrf=randomBytes(18).toString('base64url');
  db.createSession(hashSecret(token),player.uuid,csrf,now()+SESSION_MS,now());
  return {csrf,cookie:`rlb_session=${token}; ${cookieFlags('/',SESSION_MS/1000)}`};
 }
 const accounts=createAccountRoutes({db,now,body:(...a)=>body(...a),website:(...a)=>website(...a),limited:(...a)=>limited(...a),startSession:(...a)=>startSession(...a),HttpError,allowedOrigins,signups,cookieFlags:(...a)=>cookieFlags(...a),mailer,publicUrl,identity});
 // One permanent player per (issuer, subject); created on first verified sign-in.
 function playerFor(id){
  let player=db.identity(id.issuer,id.subject);
  if(!player){const uuid=randomUUID();db.tx(()=>{db.createPlayer(uuid,id.name,id.issuer,id.subject,now());db.audit(now(),uuid,'player-created',uuid,{issuer:id.issuer});
   // Development sign-in only: the subject doubles as the website username so test flows look like real accounts.
   if(id.issuer==='dev'&&!accounts.usernameProblem(id.subject))db.setUsername(uuid,id.subject,id.name);});player=db.player(uuid);}
  if(player.status!=='active')throw new HttpError(403,'account-suspended');
  return player;
 }
 function beginLogin(name,linkTo){
  const provider=providers[name];if(!provider)throw new HttpError(404,'unknown-provider');
  const t=now();for(const [k,v] of loginStates)if(v.expires<=t)loginStates.delete(k);
  const {state,verifier}=newLoginState();loginStates.set(state,{provider:name,verifier,expires:t+LOGIN_STATE_MS,linkTo});
  return {url:provider.authorizeUrl({state,verifier}),cookie:`rlb_login=${state}; ${cookieFlags('/auth',LOGIN_STATE_MS/1000)}`};
 }
 async function finishLogin(name,req){
  const url=new URL(req.url,'http://central'),state=url.searchParams.get('state'),cookieState=Object.fromEntries((req.headers.cookie??'').split(';').map(c=>c.trim().split('=')).filter(p=>p.length===2)).rlb_login;
  const pending=state&&loginStates.get(state);
  const clear=`rlb_login=; ${cookieFlags('/auth',0)}`,back=(params,extra=[])=>[302,{},{Location:new URL('/?'+new URLSearchParams(params),publicUrl).href,'Set-Cookie':[clear,...extra]}];
  if(!pending||pending.provider!==name||pending.expires<=now()||cookieState!==state)return back({login_error:'state'});
  loginStates.delete(state);
  let id;try{id=await providers[name].complete(url.searchParams,{state,verifier:pending.verifier});}
  catch(e){return back({login_error:e instanceof LoginError?e.code:'provider-failed'});}
  if(pending.linkTo){
   const owner=db.identity(id.issuer,id.subject),target=db.player(pending.linkTo);
   if(!target||target.status!=='active')return back({login_error:'account-suspended'});
   if(owner&&owner.uuid!==target.uuid){db.audit(now(),target.uuid,'identity-link-refused',target.uuid,{issuer:id.issuer});return back({login_error:'identity-in-use'});}
   // A Steam login a network-banned account used cannot be added to another account.
   const banned=!owner&&identity.signupBan(id.issuer,id.subject);
   if(banned){db.audit(now(),target.uuid,'identity-link-refused',target.uuid,{issuer:id.issuer,reason:'identity-banned',ban:banned.id});return back({login_error:'identity-banned'});}
   if(!owner){db.tx(()=>{db.addIdentity(id.issuer,id.subject,target.uuid,now());identity.record(target.uuid,id.issuer,id.subject);db.audit(now(),target.uuid,'identity-linked',target.uuid,{issuer:id.issuer});});}
   return back({linked:id.issuer});
  }
  // A new provider identity becomes an account only after the player picks a username on /welcome.
  const known=db.identity(id.issuer,id.subject);
  if(!known&&identity.signupBan(id.issuer,id.subject)){db.audit(now(),null,'signup-refused','network',{issuer:id.issuer,reason:'identity-banned'});return back({login_error:'identity-banned'});}
  if(!known){
   const token=randomBytes(24).toString('base64url'),t=now();for(const [k,v] of signups)if(v.expires<=t)signups.delete(k);
   signups.set(token,{issuer:id.issuer,subject:id.subject,name:id.name,expires:t+SIGNUP_MS});
   return [302,{},{Location:new URL('welcome',publicUrl).href,'Set-Cookie':[clear,`rlb_signup=${token}; ${cookieFlags('/',SIGNUP_MS/1000)}`]}];
  }
  if(known.status!=='active')return back({login_error:'account-suspended'});
  return [302,{},{Location:new URL('servers?'+new URLSearchParams({signed_in:id.issuer}),publicUrl).href,'Set-Cookie':[clear,startSession(known).cookie]}];
 }
 const online=s=>s.last_heartbeat!=null&&now()-s.last_heartbeat<=HEARTBEAT_STALE_MS;
 // Every join (website ticket, gateway redemption, desktop pass): linked-identity bans (central/identity.mjs), then the
 // server's opt-in policy (central/admin.mjs): minimum account age, phone, Steam, Steam account quality.
 async function policyRefusal(player,server){
  const linked=identity.joinRefusal(player,server);if(linked)return linked;
  const p=db.policy(server);
  if(p.min_account_age_minutes&&now()-player.created_at<p.min_account_age_minutes*60e3)return 'account-too-new';
  if(p.require_phone&&!db.player(player.uuid)?.phone_verified_at)return 'phone-required';
  if(!p.require_steam)return null;
  const steamId=db.identitiesFor(player.uuid).find(i=>i.issuer==='steam')?.subject;
  if(!steamId)return 'steam-required';
  if(!wantsSteamQuality(p))return null;
  let profile;try{if(!steamQuality?.enabled)throw Error('steam quality disabled');profile=await steamQuality.profile(steamId);}catch{return 'steam-check-unavailable';}
  return steamQualityRefusal(p,profile,now());
 }
 // The public directory entry: only fields the website may show (no latency is measured), plus the join policy.
 const requirements=p=>({minAccountAgeMinutes:p.min_account_age_minutes,steam:Boolean(p.require_steam),phone:Boolean(p.require_phone),
  ...(p.require_steam&&wantsSteamQuality(p)?{steamQuality:{minAccountAgeDays:p.steam_min_age_days,minLevel:p.steam_min_level,maxVacBans:p.steam_max_vac_bans,maxGameBans:p.steam_max_game_bans,minDaysSinceBan:p.steam_min_days_since_ban}}:{})});
 // browserReady: every server here went through our own enrolment, so it is always true today; kept as a field (not
 // inlined) so a future, non-enrolled entry (OFFSHOOT-COMPATIBILITY-PLAN.md work item 9, importing a public server
 // list) has somewhere to say false instead of needing a client-side change. launcherOnly is null until the owner's
 // host app has reported once (work item 7, "server profiles"): unknown, not "open".
 const publicServer=s=>({id:s.uuid,name:s.name,region:s.region,endpoint:s.endpoint,protocol:s.protocol,online:online(s),players:online(s)?s.players:null,capacity:s.capacity,wipe:s.wipe_generation,lastWipeAt:s.last_wipe_at??null,browserReady:true,launcherOnly:s.launcher_only==null?null:Boolean(s.launcher_only),requirements:requirements(db.policy(s.uuid)),...publicListing(db.listing(s.uuid))});
 const phones=new Map(); // player → {phone, expires, tries, starts:[times]}: a number waiting for its code (memory only)

 async function linkStart(req,name){
  const {player,session}=website(req,{mutation:true});
  if(now()-session.created_at>RECENT_AUTH_MS)throw new HttpError(403,'reauthenticate');
  const b=beginLogin(name,player.uuid);
  return [200,{url:b.url},{'Set-Cookie':b.cookie}];
 }
 const routes={
  'POST /auth/login':async req=>{
   if(!verifyLogin)throw new HttpError(404,'not-found');
   if(limited(req,'login'))throw new HttpError(429,'rate-limited');
   if(!allowedOrigins.includes(req.headers.origin))throw new HttpError(403,'origin');
   const player=playerFor(await verifyLogin(await body(req))),session=startSession(player);
   return [200,{player:player.uuid,name:player.display_name,csrf:session.csrf},{'Set-Cookie':session.cookie}];
  },
  'GET /auth/steam/start':async req=>{if(limited(req,'login'))throw new HttpError(429,'rate-limited');const b=beginLogin('steam');return [302,{},{Location:b.url,'Set-Cookie':b.cookie}];},
  'GET /auth/steam/callback':async req=>finishLogin('steam',req),
  // Adding a second sign-in method proves control of both: a recent session here, and the provider round trip.
  'POST /auth/steam/link-start':async req=>linkStart(req,'steam'),
  'POST /auth/logout':async req=>{const {token}=website(req,{mutation:true});db.deleteSession(hashSecret(token));return [200,{signedOut:true},{'Set-Cookie':'rlb_session=; HttpOnly; Path=/; Max-Age=0'}];},
  'GET /me':async req=>{const {player,session}=website(req,{mutation:false});return [200,{player:player.uuid,name:player.display_name,csrf:session.csrf,...accountView(db,player),phoneVerification:Boolean(phone)}];},
  'GET /servers':async()=>[200,{servers:[...db.listedServers().map(publicServer),...await externalServers.list()]}],
  // Device token + soft signals from the signed-in page (site/js/device.mjs), for admin alt links only. The token is
  // kept in an HttpOnly cookie and a localStorage copy; whichever survives restores the other.
  'POST /account/device':async req=>{
   if(limited(req,'device'))throw new HttpError(429,'rate-limited');
   const {player}=website(req,{mutation:true}),b=await body(req),c=cookies(req).rlb_device;
   const token=identity.sighting({player:player.uuid,cookieToken:c,storedToken:typeof b.token==='string'?b.token:null,signals:b.signals&&typeof b.signals==='object'?b.signals:{},ip:clientIp(req)});
   ips.record(player.uuid,clientIp(req),'website');
   identity.joinRefusal(player,null); // a device a network-banned account used: held for staff review (audited)
   return [200,{token},c===token?{}:{'Set-Cookie':`rlb_device=${token}; ${cookieFlags('/',DEVICE_MS/1000)}`}];
  },
  // Phone verification (servers may require it). The number lives in memory for the code's 10 minutes only; central
  // keeps an HMAC of it, one number per account.
  'POST /account/phone/start':async req=>{
   if(!phone)throw new HttpError(404,'phone-disabled');
   if(limited(req,'phone'))throw new HttpError(429,'rate-limited');
   const {player}=website(req,{mutation:true}),number=normalisePhone((await body(req)).phone),t=now();
   if(!number)throw new HttpError(400,'invalid-phone');
   const owners=db.identifierOwners('phone',identity.hash('phone',number)).filter(u=>u!==player.uuid);
   if(owners.length)throw new HttpError(409,'phone-taken');
   const banned=identity.signupBan('phone',number);if(banned){db.audit(t,player.uuid,'phone-refused',player.uuid,{reason:'identity-banned',ban:banned.id});throw new HttpError(403,'identity-banned');}
   const prev=phones.get(player.uuid),starts=(prev?.starts??[]).filter(x=>t-x<3600e3);
   if(starts.length>=PHONE_STARTS_PER_HOUR)throw new HttpError(429,'rate-limited');
   await phone.start(number);
   phones.set(player.uuid,{phone:number,expires:t+PHONE_MS,tries:0,starts:[...starts,t]});
   return [202,{sent:true}];
  },
  'POST /account/phone/verify':async req=>{
   if(!phone)throw new HttpError(404,'phone-disabled');
   const {player}=website(req,{mutation:true}),code=String((await body(req)).code??'').trim(),t=now(),pending=phones.get(player.uuid);
   if(!pending||pending.expires<=t||pending.tries>=PHONE_TRIES)throw new HttpError(400,'phone-code-expired');
   pending.tries++;
   if(!/^\d{4,8}$/.test(code)||!await phone.check(pending.phone,code))throw new HttpError(400,'phone-code-wrong');
   phones.delete(player.uuid);
   db.tx(()=>{identity.record(player.uuid,'phone',pending.phone);db.setPhoneVerified(player.uuid,t);db.audit(t,player.uuid,'phone-verified',player.uuid);});
   return [200,{verified:true}];
  },
  'GET /servers/:id':async(req,id)=>{const s=db.listedServers().find(x=>x.uuid===id);if(!s)throw new HttpError(404,'unknown-server');return [200,publicServer(s)];},
  'POST /servers/:id/join-ticket':async(req,id)=>{
   const {player}=website(req,{mutation:true});
   const s=db.server(id);
   if(!s||!s.listed||s.status!=='active')throw new HttpError(404,'unknown-server');
   if(!online(s))throw new HttpError(409,'server-offline');
   if(db.activeBan(player.uuid,s.uuid,now()))throw new HttpError(403,'banned');
   const ip=clientIp(req);ips.record(player.uuid,ip,'website');
   if(ips.banned(ip,s.uuid))throw new HttpError(403,'ip-banned');
   const refused=await policyRefusal(player,s.uuid);if(refused)throw new HttpError(403,refused);
   return [200,{ticket:tickets.issueAdmission({subject:player.uuid,serverId:s.uuid}),endpoint:s.endpoint}];
  },
  // Desktop character linking (BROWSER-SERVER-DECISION "Linking a desktop character"). The code comes from /browserlink.
  'POST /servers/:id/link':async(req,id)=>{
   if(limited(req,'link'))throw new HttpError(429,'rate-limited');
   const {player}=website(req,{mutation:true}),b=await body(req),s=db.server(id);
   if(!s||s.status!=='active')throw new HttpError(404,'unknown-server');
   if(typeof b.code!=='string'||!LINK_CODE.test(b.code.toUpperCase()))throw new HttpError(400,'invalid-code');
   if(db.linkFor(id,player.uuid))throw new HttpError(409,'already-linked');
   const request=randomUUID();
   db.createLinkRequest(request,id,player.uuid,now());db.audit(now(),player.uuid,'link-requested',id);
   linkTasks.set(request,{server:id,subject:player.uuid,code:b.code.toUpperCase(),expires:now()+LINK_MS,dispatched:0});
   return [202,{request}];
  },
  'GET /links/:id/status':async(req,id)=>{
   const {player}=website(req,{mutation:false}),r=db.linkRequest(id);
   if(!r||r.player_uuid!==player.uuid)throw new HttpError(404,'unknown-request');
   return [200,{status:r.status,reason:r.reason}];
  },
  'GET /owner/servers':async req=>{
   const {player}=website(req,{mutation:false});
   return [200,{servers:db.ownedServers(player.uuid).map(s=>({id:s.uuid,name:s.name,region:s.region,endpoint:s.endpoint,listed:Boolean(s.listed),steamVerified:Boolean(s.steam_verified),online:online(s),players:s.players,capacity:s.capacity,status:s.status}))}];
  },
  'POST /owner/servers':async req=>{
   const {player}=website(req,{mutation:true}),b=await body(req);
   if(typeof b.name!=='string'||!b.name.trim()||b.name.length>64||typeof b.region!=='string'||b.region.length>32)throw new HttpError(400,'invalid-server');
   let endpoint;try{endpoint=new URL(b.endpoint);}catch{throw new HttpError(400,'invalid-endpoint');}
   if(endpoint.protocol!=='wss:'||endpoint.username||endpoint.password)throw new HttpError(400,'invalid-endpoint');
   const uuid=randomUUID(),code=randomBytes(24).toString('base64url');
   db.tx(()=>{db.createServer({uuid,owner:player.uuid,name:b.name.trim(),region:b.region,endpoint:endpoint.href,at:now()});db.addEnrolmentCode(hashSecret(code),uuid,now()+ENROL_MS);db.audit(now(),player.uuid,'server-created',uuid);});
   return [201,{id:uuid,enrolmentCode:code,expiresInSeconds:ENROL_MS/1000}];
  },
  'POST /owner/servers/:id/enrolment-code':async(req,id)=>{
   const {player}=website(req,{mutation:true}),s=db.server(id);
   if(!s||s.owner_uuid!==player.uuid)throw new HttpError(404,'unknown-server');
   const code=randomBytes(24).toString('base64url');db.addEnrolmentCode(hashSecret(code),id,now()+ENROL_MS);db.audit(now(),player.uuid,'enrolment-code-issued',id);
   return [201,{enrolmentCode:code,expiresInSeconds:ENROL_MS/1000}];
  },
  // The host app's key (HOST-APP-PLAN.md "Accounts and links"): shown once; a new one replaces the old.
  'POST /owner/servers/:id/host-key':async(req,id)=>{
   const {player}=website(req,{mutation:true}),s=db.server(id);
   if(!s||s.owner_uuid!==player.uuid)throw new HttpError(404,'unknown-server');
   const key='rlbh_'+randomBytes(32).toString('base64url');db.addHostToken(randomUUID(),id,hashSecret(key),now());db.audit(now(),player.uuid,'host-key-issued',id);
   return [201,{hostKey:key}];
  },
  'POST /owner/servers/:id/host-key-revoke':async(req,id)=>{
   const {player}=website(req,{mutation:true}),s=db.server(id);
   if(!s||s.owner_uuid!==player.uuid)throw new HttpError(404,'unknown-server');
   const n=db.revokeHostTokens(id,now());if(n)db.audit(now(),player.uuid,'host-key-revoked',id);
   return [200,{revoked:n}];
  },
  'POST /owner/servers/:id/publish':async(req,id)=>{
   const {player}=website(req,{mutation:true}),s=db.server(id),b=await body(req);
   if(!s||s.owner_uuid!==player.uuid)throw new HttpError(404,'unknown-server');
   const refused=listings.publishRefusal(s,Boolean(b.listed));if(refused)throw new HttpError(409,refused);
   if(b.listed&&!online(s))throw new HttpError(409,'heartbeat-required');
   db.setListed(id,Boolean(b.listed));db.audit(now(),player.uuid,b.listed?'server-listed':'server-unlisted',id);
   return [200,{listed:Boolean(b.listed)}];
  },
  'POST /owner/servers/:id/name':async(req,id)=>{
   const {player}=website(req,{mutation:true}),s=db.server(id),b=await body(req);
   if(!s||s.owner_uuid!==player.uuid)throw new HttpError(404,'unknown-server');
   const name=typeof b.name==='string'?b.name.trim():'';
   if(!name||name.length>64)throw new HttpError(400,'invalid-server-name');
   if(name!==s.name){db.renameServer(id,name);db.audit(now(),player.uuid,'server-renamed',id,{from:s.name,to:name});}
   return [200,{name}];
  },
  // The owner states the server authenticates real Steam tickets (not an emulator); only then may Steam sign-ins
  // map straight to the player's SteamID there. The gateway's adapter must also opt in locally (trustSteamIds).
  'POST /owner/servers/:id/steam-verified':async(req,id)=>{
   const {player}=website(req,{mutation:true}),s=db.server(id),b=await body(req);
   if(!s||s.owner_uuid!==player.uuid)throw new HttpError(404,'unknown-server');
   db.setSteamVerified(id,Boolean(b.verified));db.audit(now(),player.uuid,b.verified?'steam-verified-on':'steam-verified-off',id);
   return [200,{steamVerified:Boolean(b.verified)}];
  },
  // Enrolment exchanges a one-time owner code for this instance's credential; earlier credentials are revoked.
  // hostKey: true (the host app's Setup page) also issues the host app key, replacing any older one, so the owner
  // pastes one code instead of two. The code was made by the owner's own session, so it carries that authority.
  'POST /bridge/enrol':async req=>{
   if(limited(req,'enrol'))throw new HttpError(429,'rate-limited');
   const b=await body(req);if(typeof b.code!=='string'||b.code.length>64)throw new HttpError(400,'invalid-code');
   const credential=randomBytes(32).toString('base64url'),hostKey=b.hostKey===true?'rlbh_'+randomBytes(32).toString('base64url'):null;
   const server=db.tx(()=>{
    const id=db.useEnrolmentCode(hashSecret(b.code),now());if(!id)return null;
    db.revokeCredentials(id,now());db.addCredential(randomUUID(),id,hashSecret(credential),now());db.audit(now(),'bridge','credential-issued',id);
    if(hostKey){db.addHostToken(randomUUID(),id,hashSecret(hostKey),now());db.audit(now(),'bridge','host-key-issued',id,{via:'enrolment-code'});}
    return id;
   });
   if(!server)throw new HttpError(401,'invalid-code');
   return [201,{serverId:server,credential,...(hostKey?{hostKey}:{})}];
  },
  // Verifies the admission for the authenticated server only and consumes it atomically.
  // kind 'desktop' (POST /desktop/admit) accepts only desktop passes, the WebSocket only browser tickets; a ticket of the
  // other kind is refused before it is consumed.
  'POST /bridge/redeem':async req=>{
   const server=bridge(req),b=await body(req),profile=b.kind==='desktop'?DESKTOP_PROFILE:BROWSER_PROFILE;
   try{
    const claims=createAccountService({issuer,keys,now,profiles:[profile],replay:{claim:(jti,exp,at)=>db.claimTicket(jti,server,exp,at)}}).redeemAdmission(b.ticket,{serverId:server});
    if(!UUID.test(claims.subject))throw new AdmissionError('malformed');
    const p=db.player(claims.subject);if(!p||p.status!=='active')throw new AdmissionError('account-suspended');
    if(db.activeBan(p.uuid,server,now()))throw new AdmissionError('banned'); // a ticket issued just before a ban
    // ip: the address of the player's game connection as the gateway saw it (WebSocket or launcher /desktop/admit).
    const ip=normaliseIp(b.ip)?.ip;
    if(ip){ips.record(p.uuid,ip,b.kind==='desktop'?'launcher':'game',server);if(ips.banned(ip,server))throw new AdmissionError('ip-banned');}
    const refused=await policyRefusal(p,server);if(refused)throw new AdmissionError(refused);
    const steam=db.server(server).steam_verified?db.identitiesFor(p.uuid).find(i=>i.issuer==='steam')?.subject:undefined;
    return [200,{subject:claims.subject,jti:claims.jti,exp:claims.exp,profile:claims.profile,name:p.display_name,...(steam?{steamId:steam}:{})}];
   }catch(e){if(e instanceof AdmissionError)return [403,{error:e.code}];throw e;}
  },
  'POST /bridge/tasks':async req=>{
   const server=bridge(req),t=now(),tasks=[];
   for(const [request,task] of linkTasks){
    if(task.expires<=t){linkTasks.delete(request);db.setLinkStatus(request,'failed','expired',t);continue;}
    if(task.server===server&&t-task.dispatched>10e3){task.dispatched=t;tasks.push({type:'link',request,code:task.code,subject:task.subject});}
   }
   // Desktop launchers that signed out, were revoked or stopped heartbeating while their game was on this server.
   for(const e of db.takeDesktopLeaseEnds(server,t))tasks.push({type:'desktop-ended',subject:e.subject,reason:e.reason});
   return [200,{tasks}];
  },
  // Step 1 of the two-sided link: the adapter reserved the character; commit our side only if both stay unique.
  'POST /bridge/link-reserved':async req=>{
   const server=bridge(req),b=await body(req),task=linkTasks.get(b.request);
   if(!task||task.server!==server)throw new HttpError(404,'unknown-request');
   if(!b.ok){linkTasks.delete(b.request);db.setLinkStatus(b.request,'failed',String(b.reason??'refused').slice(0,40),now());return [200,{commit:false}];}
   if(typeof b.backendId!=='string'||!/^\d{1,20}$/.test(b.backendId))throw new HttpError(400,'invalid-backend');
   try{db.tx(()=>{db.link(server,task.subject,backendRef(server,b.backendId),now());db.setLinkStatus(b.request,'reserved',null,now());db.audit(now(),'bridge','link-reserved',server);});}
   catch(e){if(!String(e.message).includes('UNIQUE'))throw e;linkTasks.delete(b.request);db.setLinkStatus(b.request,'failed','conflict',now());return [200,{commit:false}];}
   return [200,{commit:true}];
  },
  'POST /bridge/link-confirmed':async req=>{
   const server=bridge(req),b=await body(req),task=linkTasks.get(b.request);
   if(!task||task.server!==server)throw new HttpError(404,'unknown-request');
   linkTasks.delete(b.request);
   if(b.ok){db.setLinkStatus(b.request,'linked',null,now());db.audit(now(),'bridge','link-confirmed',server);}
   else{db.raw.prepare('delete from legacy_identity_links where server_uuid=? and player_uuid=?').run(server,task.subject);db.setLinkStatus(b.request,'failed','adapter-confirm-failed',now());}
   return [200,{ok:true}];
  },
  'POST /bridge/heartbeat':async req=>{
   const server=bridge(req),b=await body(req),int=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max?v:null;
   db.heartbeat(server,int(b.players,1000),int(b.capacity,1000),typeof b.wipe==='string'?b.wipe.slice(0,64):null,now());
   return [200,{ok:true,nextInSeconds:15}];
  },
 };
 const admin=createAdminRoutes({db,now,website,body,bridge,limited,HttpError,identity,screenshotRetentionMs:screenshotRetentionDays*86400e3,hashKey:hashSecret,ips});Object.assign(routes,admin.routes);
 Object.assign(routes,accounts.routes);
 Object.assign(routes,createWaitlistRoutes({db,now,body,website,limited,HttpError,allowedOrigins,mailer,publicUrl,pauseMs:mailPauseMs}));
 Object.assign(routes,createDesktopRoutes({db,now,body,website,limited,HttpError,passwordLogin:accounts.passwordLogin,register:accounts.register,tickets,publicServer,online,policyRefusal,identity}).routes);
 const wiki=createWikiRoutes({db,now,website,body,HttpError,...(wikiResolvers?{resolvers:wikiResolvers}:{})});Object.assign(routes,wiki.routes);
 const stats=createStatsRoutes({db,now,website,body,limited,HttpError});Object.assign(routes,stats.routes);
 const relay=createHostRelayRoutes({db,now,body,website,HttpError,hashKey:hashSecret});Object.assign(routes,relay.routes);
 const listings=createListingRoutes({db,now,body,website,HttpError,online,listingReview,relay});Object.assign(routes,listings.routes);
 const forum=createForumRoutes({db,now,website,body,limited,HttpError,...(wikiResolvers?{resolvers:wikiResolvers}:{})});Object.assign(routes,forum.routes);
 // Daily: sightings and play sessions past their retention (central/identity.mjs).
 let prunedAt=-Infinity;
 return {
  admin,identity,relay,
  async handle(req,res){
   if(now()-prunedAt>86400e3){prunedAt=now();try{identity.prune();}catch{}}
   try{
    const url=new URL(req.url,'http://central'),parts=url.pathname.split('/').filter(Boolean);
    let route=routes[req.method+' '+url.pathname],arg,args=null;
    if(!route){const w=wiki.resolve(req.method,url.pathname)??forum.resolve(req.method,url.pathname)??stats.resolve(req.method,url.pathname);if(w)[route,...args]=w;}
    if(!route&&parts.length>=3&&UUID.test(parts[parts.length-2])){arg=parts[parts.length-2];route=routes[req.method+' /'+[...parts.slice(0,-2),':id',parts.at(-1)].join('/')];}
    if(!route&&parts.length>=2&&UUID.test(parts.at(-1))){arg=parts.at(-1);route=routes[req.method+' /'+[...parts.slice(0,-1),':id'].join('/')];}
    if(!route){if(onNotFound?.(req,res))return;throw new HttpError(404,'not-found');}
    const [status,data,headers]=await route(req,...(args??[arg]));send(res,status,data,headers);
   }catch(e){
    if(e instanceof HttpError)return send(res,e.status,{error:e.code});
    if(e instanceof AdmissionError)return send(res,400,{error:e.code});
    // A browser navigation (OAuth callback, a page route) gets the website's 500 page instead of JSON (onError).
    if(!res.headersSent&&onError?.(req,res))return;
    send(res,500,{error:'internal'});
   }
  },
 };
}
