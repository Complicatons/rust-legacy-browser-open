// Website accounts (website spec §6.1): email + username + password, alongside Steam sign-in in service.mjs.
// Mounted by createCentralService like the admin routes. Unknown users and wrong passwords get the same answer and
// cost the same scrypt time; ten failures for one login lock it for 15 minutes. One account per person
// (central/identity.mjs): throwaway email domains are refused, one mailbox (dots, +tags, googlemail folded) is one
// account, and an email or Steam login a network-banned account used cannot start or join another account.
import {randomUUID,randomBytes} from 'node:crypto';
import {hashSecret} from './db.mjs';
import {createNullMailer} from './mailer.mjs';
import {verificationEmail,passwordResetEmail} from './mail-templates.mjs';
import {hashPassword,verifyPassword,DUMMY_HASH,checkUsername,checkEmail,checkPassword,usernameKey,emailKey} from './passwords.mjs';

const LOCK_FAILURES=10,LOCK_MS=15*60e3,RESET_MS=30*60e3,VERIFY_MS=24*3600e3,RECENT_AUTH_MS=15*60e3;

// Provider name → a username suggestion that passes the rules ("Rook!! the Great" → "RooktheGreat").
export function suggestUsername(name){
 let s=String(name??'').replace(/[^A-Za-z0-9_-]/g,'').replace(/^[_-]+/,'').slice(0,20);
 if(!s)s='Player';while(s.length<3)s+='0';
 return s;
}

export function createAccountRoutes({db,now,body,website,limited,startSession,HttpError,allowedOrigins,signups=new Map(),cookieFlags,mailer=createNullMailer(),publicUrl='https://play.example.test/',identity}){
 const failures=new Map(); // login key → {count, since, lockedUntil}
 function guard(req){
  if(limited(req,'login'))throw new HttpError(429,'rate-limited');
  if(!allowedOrigins.includes(req.headers.origin))throw new HttpError(403,'origin');
 }
 const signedIn=(player,clearSignup=false)=>{const s=startSession(player),cookies=clearSignup?[s.cookie,`rlb_signup=; ${cookieFlags('/',0)}`]:s.cookie;return [200,{player:player.uuid,name:player.display_name,csrf:s.csrf},{'Set-Cookie':cookies}];};
 function pendingSignup(req){
  const token=Object.fromEntries((req.headers.cookie??'').split(';').map(c=>c.trim().split('=')).filter(p=>p.length===2)).rlb_signup;
  const entry=token&&signups.get(token);
  if(!entry||entry.expires<=now()){if(token)signups.delete(token);throw new HttpError(404,'no-pending-signup');}
  return {token,entry};
 }
 const link=(path,token)=>new URL(`${path}?token=${token}`,publicUrl).href;
 async function sendVerification(player,email){
  if(!mailer.enabled||!email)return false;
  const token=randomBytes(32).toString('base64url');db.addEmailVerification(hashSecret(token),player.uuid,email,now()+VERIFY_MS);
  await mailer.send({to:email,...verificationEmail({name:player.username??player.display_name,url:link('auth/verify-email',token)})});
  return true;
 }
 // An email typed as it was registered, else the one account with the same mailbox (j.o.e@gmail.com for joe@gmail.com).
 const byEmail=email=>db.playerByEmailKey(emailKey(email))??identity.emailOwner(email);
 // Sign-up / email-change rules: format and throwaway domains, one account per mailbox, no network-banned address.
 function emailRefusal(email,except=null){
  const bad=identity.emailProblem(email);if(bad)return [400,bad];
  const exact=db.playerByEmailKey(emailKey(email));
  if((exact&&exact.uuid!==except)||identity.emailOwner(email,except))return [409,'email-taken'];
  const ban=identity.signupBan('email',email);if(ban){db.audit(now(),except,'signup-refused','network',{kind:'email',reason:'identity-banned',ban:ban.id});return [403,'identity-banned'];}
  return null;
 }
 // Username or email + password, with the lockout above. Shared by the website and the desktop launcher (central/desktop.mjs).
 async function passwordLogin(rawLogin,password){
  const login=String(rawLogin??'').trim(),t=now();
  const player=login.includes('@')?byEmail(login):db.playerByUsernameKey(usernameKey(login));
  // One counter per account, whether it is named by username or email; unknown logins count by their text.
  const key=player?'player:'+player.uuid:'login:'+usernameKey(login),f=failures.get(key);
  if(f?.lockedUntil>t)throw new HttpError(429,'account-locked');
  const ok=await verifyPassword(String(password??''),player?.password_hash??DUMMY_HASH)&&Boolean(player?.password_hash);
  if(!ok){
   const entry=f&&t-f.since<LOCK_MS?f:{count:0,since:t,lockedUntil:0};entry.count++;
   if(entry.count>=LOCK_FAILURES)entry.lockedUntil=t+LOCK_MS;
   failures.set(key,entry);
   if(failures.size>5000)for(const [k,v] of failures)if(t-v.since>=LOCK_MS&&v.lockedUntil<=t)failures.delete(k); // forget stale counters
   throw new HttpError(401,'invalid-credentials');
  }
  failures.delete(key);
  if(player.status!=='active')throw new HttpError(403,'account-suspended');
  return player;
 }
 // Email + username + password sign-up, shared by the website (POST /auth/register) and the desktop launcher
 // (POST /desktop/register), so both refuse the same things with the same codes. extra: more [kind, value] identifiers
 // (the launcher's hardware ID), already validated by the caller: a network ban on one refuses the sign-up, and they
 // are recorded with the account. The verification email is sent as on the website; playing does not wait for it.
 async function register(b,extra=[]){
  const username=String(b.username??'').trim(),email=String(b.email??'').trim();
  const bad=checkEmail(email)??checkUsername(username)??checkPassword(b.password,{username,email});
  if(bad)throw new HttpError(400,bad);
  if(db.playerByUsernameKey(usernameKey(username)))throw new HttpError(409,'username-taken');
  const refused=emailRefusal(email);if(refused)throw new HttpError(...refused);
  for(const [kind,value] of extra){const ban=identity.signupBan(kind,value);if(ban){db.audit(now(),null,'signup-refused','network',{kind,reason:'identity-banned',ban:ban.id});throw new HttpError(403,'identity-banned');}}
  const uuid=randomUUID(),passwordHash=await hashPassword(b.password);
  try{db.tx(()=>{db.createAccount({uuid,username,email,passwordHash,at:now()});identity.record(uuid,'email',email);for(const [kind,value] of extra)identity.record(uuid,kind,value);db.audit(now(),uuid,'player-created',uuid,{issuer:'password'});});}
  catch(e){if(String(e.message).includes('UNIQUE'))throw new HttpError(409,'username-taken');throw e;}
  const player=db.player(uuid);await sendVerification(player,email);
  return player;
 }
 function usernameProblem(name){return checkUsername(name)??(db.playerByUsernameKey(usernameKey(name))?'username-taken':null);}

 const routes={
  'POST /auth/register':async req=>{
   guard(req);
   return signedIn(await register(await body(req)));
  },
  'POST /auth/password':async req=>{
   guard(req);
   const b=await body(req);
   return signedIn(await passwordLogin(b.login,b.password));
  },
  // Steam sign-ups waiting for a username (created by the provider callback in service.mjs).
  'GET /auth/pending':async req=>{
   const {entry}=pendingSignup(req);
   return [200,{provider:entry.issuer,suggestedName:suggestUsername(entry.name)}];
  },
  'POST /auth/complete-signup':async req=>{
   guard(req);
   const {token,entry}=pendingSignup(req),b=await body(req),username=String(b.username??'').trim(),email=b.email==null||b.email===''?null:String(b.email).trim();
   const bad=checkUsername(username)??(email!==null?checkEmail(email):null);
   if(bad)throw new HttpError(400,bad);
   if(db.playerByUsernameKey(usernameKey(username)))throw new HttpError(409,'username-taken');
   const refused=email?emailRefusal(email):null;if(refused)throw new HttpError(...refused);
   if(identity.signupBan(entry.issuer,entry.subject)){signups.delete(token);db.audit(now(),null,'signup-refused','network',{kind:entry.issuer,reason:'identity-banned'});throw new HttpError(403,'identity-banned');}
   const uuid=randomUUID();
   try{db.tx(()=>{db.createAccount({uuid,username,email,passwordHash:null,at:now()});db.addIdentity(entry.issuer,entry.subject,uuid,now());identity.record(uuid,entry.issuer,entry.subject);if(email)identity.record(uuid,'email',email);db.audit(now(),uuid,'player-created',uuid,{issuer:entry.issuer});});}
   catch(e){if(!String(e.message).includes('UNIQUE'))throw e;const owner=db.identity(entry.issuer,entry.subject);if(!owner)throw new HttpError(409,'username-taken');signups.delete(token);return signedIn(owner,true);}
   signups.delete(token);
   return signedIn(db.player(uuid),true);
  },
  // Accounts from before website usernames choose one, once.
  'POST /account/username':async req=>{
   const {player}=website(req,{mutation:true});
   if(player.username)throw new HttpError(409,'username-set');
   const username=String((await body(req)).username??'').trim(),bad=usernameProblem(username);
   if(bad)throw new HttpError(bad==='username-taken'?409:400,bad);
   db.setUsername(player.uuid,username);db.audit(now(),player.uuid,'username-set',player.uuid);
   return [200,{username}];
  },
  'POST /account/password':async req=>{
   const {player,session,token}=website(req,{mutation:true}),b=await body(req);
   if(player.password_hash){if(!await verifyPassword(String(b.current??''),player.password_hash))throw new HttpError(401,'invalid-credentials');}
   else if(now()-session.created_at>RECENT_AUTH_MS)throw new HttpError(403,'reauthenticate');
   const bad=checkPassword(b.next,{username:player.username,email:player.email});if(bad)throw new HttpError(400,bad);
   db.setPassword(player.uuid,await hashPassword(b.next),now());db.deleteSessionsFor(player.uuid,hashSecret(token),now());db.audit(now(),player.uuid,'password-changed',player.uuid);
   return [200,{changed:true}];
  },
  // The email is where password resets go, so changing it needs the current password (or a fresh sign-in without one).
  'POST /account/email':async req=>{
   const {player,session}=website(req,{mutation:true}),b=await body(req),email=String(b.email??'').trim();
   if(player.password_hash){if(!await verifyPassword(String(b.current??''),player.password_hash))throw new HttpError(401,'invalid-credentials');}
   else if(now()-session.created_at>RECENT_AUTH_MS)throw new HttpError(403,'reauthenticate');
   const refused=emailRefusal(email,player.uuid);if(refused)throw new HttpError(...refused);
   db.tx(()=>{db.setEmail(player.uuid,email);identity.record(player.uuid,'email',email);db.audit(now(),player.uuid,'email-changed',player.uuid);});
   return [200,{email,verificationSent:await sendVerification(db.player(player.uuid),email)}];
  },
  'POST /account/sessions/revoke':async req=>{
   const {player,token}=website(req,{mutation:true});db.deleteSessionsFor(player.uuid,hashSecret(token),now());db.audit(now(),player.uuid,'sessions-revoked',player.uuid);
   return [200,{revoked:true}];
  },
  // Same answer whether or not the address has an account, so the form cannot be used to find accounts.
  'POST /auth/forgot':async req=>{
   guard(req);if(!mailer.enabled)throw new HttpError(404,'mail-disabled');
   const email=String((await body(req)).email??'').trim(),player=checkEmail(email)?null:byEmail(email);
   if(player&&player.status==='active'){
    const token=randomBytes(32).toString('base64url');db.addPasswordReset(hashSecret(token),player.uuid,now()+RESET_MS);
    await mailer.send({to:player.email,...passwordResetEmail({name:player.username??player.display_name,url:link('reset',token)})});
    db.audit(now(),player.uuid,'password-reset-requested',player.uuid);
   }
   return [202,{sent:true}];
  },
  'POST /auth/reset':async req=>{
   guard(req);
   const b=await body(req),hash=hashSecret(String(b.token??'')),t=now();
   const row=db.raw.prepare('select player_uuid from password_resets where token_hash=? and used_at is null and expires_at>?').get(hash,t),player=row&&db.player(row.player_uuid);
   if(!player)throw new HttpError(400,'invalid-token');
   const bad=checkPassword(b.password,{username:player.username,email:player.email});if(bad)throw new HttpError(400,bad);
   if(db.usePasswordReset(hash,t)!==player.uuid)throw new HttpError(400,'invalid-token');
   db.setPassword(player.uuid,await hashPassword(b.password),t);db.deleteSessionsFor(player.uuid,null,t);db.audit(t,player.uuid,'password-reset',player.uuid);
   return [200,{reset:true}];
  },
  'GET /auth/verify-email':async req=>{
   const token=new URL(req.url,'http://central').searchParams.get('token')??'',v=db.useEmailVerification(hashSecret(token),now()),player=v&&db.player(v.uuid);
   const ok=Boolean(player&&player.email&&emailKey(player.email)===emailKey(v.email));
   if(ok){db.markEmailVerified(player.uuid,now());db.audit(now(),player.uuid,'email-verified',player.uuid);}
   return [302,{},{Location:new URL(ok?'account?verified=1':'account?verify_error=1',publicUrl).href}];
  },
  'GET /auth/username-available':async req=>{
   if(limited(req,'username'))throw new HttpError(429,'rate-limited');
   const reason=usernameProblem(new URL(req.url,'http://central').searchParams.get('name'));
   return [200,reason?{available:false,reason}:{available:true}];
  },
 };
 return {passwordLogin,register,routes,usernameProblem};
}

// Fields the website needs about the signed-in player (GET /me).
export function accountView(db,player){
 const identities=db.identitiesFor(player.uuid).map(i=>i.issuer);
 if(player.password_hash)identities.unshift('password');
 return {username:player.username??null,email:player.email??null,emailVerified:Boolean(player.email_verified_at),hasPassword:Boolean(player.password_hash),
  needsUsername:!player.username,identities,staff:db.isStaff(player.uuid),leaderboardHidden:Boolean(player.leaderboard_hidden),phoneVerified:Boolean(player.phone_verified_at)};
}
