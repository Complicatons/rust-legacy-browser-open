// Steam OpenID 2.0 sign-in against a mock provider endpoint (fetchImpl stub).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService} from '../central/service.mjs';
import {steamProvider,STEAM_OPENID} from '../central/providers.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {listenServer} from '../bridge/listen.mjs';

const ORIGIN='https://play.example.test',PUBLIC='https://play.example.test/';
const STEAM_ID='76561198000000042',STEAM_ID2='76561198000000142',STEAM_ID3='76561198000000242';
const NS='http://specs.openid.net/auth/2.0';

function mockProviders(clock){
 const seen={steamChecks:0};
 const fetchImpl=async(url,init={})=>{
  const u=new URL(url);
  if(u.href===STEAM_OPENID&&init.method==='POST'){
   seen.steamChecks++;const p=new URLSearchParams(String(init.body));
   const ok=p.get('openid.mode')==='check_authentication'&&p.get('openid.sig')==='good-signature';
   return new Response(`ns:${NS}\nis_valid:${ok}\n`);
  }
  return new Response('not found',{status:404});
 };
 return {fetchImpl,seen};
}

async function start(){
 const clock={t:Date.now()},mocks=mockProviders(clock);
 const providers={
  steam:steamProvider({returnTo:'https://central.example.test/auth/steam/callback',realm:'https://central.example.test/',fetchImpl:mocks.fetchImpl,now:()=>clock.t}),
 };
 const db=openCentralDb();
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',providers,publicUrl:PUBLIC,allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 const req=async(method,path,{cookie,csrf,data}={})=>{
  const res=await fetch(base+path,{method,redirect:'manual',headers:{origin:ORIGIN,...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const cookies=res.headers.getSetCookie().map(c=>c.split(';')[0]);
  return {status:res.status,location:res.headers.get('location'),cookies,data:res.headers.get('content-type')?.includes('json')?await res.json():null};
 };
 const loginCookie=r=>r.cookies.find(c=>c.startsWith('rlb_login=')),sessionCookie=r=>r.cookies.find(c=>c.startsWith('rlb_session=')&&c!=='rlb_session=');
 // Steam: start (or, with linkFrom, POST link-start on a signed-in session), then build the assertion Steam would
 // redirect back with.
 async function steamCallback({sig='good-signature',claimed=`https://steamcommunity.com/openid/id/${STEAM_ID}`,nonce,tamperReturn=false,cookieOverride,startCookie,linkFrom}={}){
  const s=linkFrom?await req('POST','/auth/steam/link-start',linkFrom):await req('GET','/auth/steam/start',{cookie:startCookie});
  if(s.status!==302&&s.status!==200)return {start:s};
  const auth=new URL(s.location??s.data.url),returnTo=auth.searchParams.get('openid.return_to'),state=new URL(returnTo).searchParams.get('state');
  const p=new URLSearchParams({'openid.ns':NS,'openid.mode':'id_res','openid.op_endpoint':STEAM_OPENID,'openid.claimed_id':claimed,'openid.identity':claimed,'openid.return_to':tamperReturn?returnTo+'x':returnTo,'openid.response_nonce':nonce??new Date(clock.t).toISOString().replace(/\.\d+Z$/,'Z')+Math.random().toString(36).slice(2),'openid.assoc_handle':'1234567890','openid.signed':'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle','openid.sig':sig});
  const cookie=[cookieOverride??loginCookie(s),startCookie,linkFrom?.cookie].filter(Boolean).join('; ');
  const cb=await req('GET',`/auth/steam/callback?state=${state}&${p}`,{cookie});
  return {start:s,cb,nonce:p.get('openid.response_nonce')};
 }
 const signupCookie=r=>r.cookies.find(c=>c.startsWith('rlb_signup=')&&c!=='rlb_signup=');
 // First sign-in with a provider: choose a username on /welcome, which creates the account and signs in.
 async function completeSignup(cb,username,email){const r=await req('POST','/auth/complete-signup',{cookie:signupCookie(cb),data:{username,...(email?{email}:{})}});return {...r,cookie:sessionCookie(r)};}
 return {db,clock,mocks,req,base,steamCallback,sessionCookie,signupCookie,completeSignup,close:()=>new Promise(r=>http.close(r))};
}

test('Steam sign-in verifies the assertion with Steam and rejects replays and forgeries', async()=>{
 const c=await start();
 try{
  const ok=await c.steamCallback();
  assert.equal(ok.start.status,302);
  assert.ok(ok.start.location.startsWith(STEAM_OPENID+'?'));
  assert.equal(ok.cb.location,PUBLIC+'welcome','a new Steam account chooses a username first');
  assert.equal(c.sessionCookie(ok.cb),undefined);
  assert.deepEqual((await c.req('GET','/auth/pending',{cookie:c.signupCookie(ok.cb)})).data,{provider:'steam',suggestedName:'Steam0042'});
  const done=await c.completeSignup(ok.cb,'Steamer');
  assert.equal(done.status,200);
  const me=(await c.req('GET','/me',{cookie:done.cookie})).data;
  assert.deepEqual(me.identities,['steam']);assert.equal(me.username,'Steamer');assert.equal(me.hasPassword,false);
  assert.ok(me.csrf);
  const again=await c.steamCallback(); // new nonce, same Steam account → same player, straight to the servers
  assert.equal(again.cb.location,PUBLIC+'servers?signed_in=steam');
  assert.equal((await c.req('GET','/me',{cookie:c.sessionCookie(again.cb)})).data.player,me.player);
  const error=async opts=>new URL((await c.steamCallback(opts)).cb.location).searchParams.get('login_error');
  assert.equal(await error({nonce:ok.nonce}),'steam-replayed');
  assert.equal(await error({sig:'forged'}),'steam-not-verified');
  assert.equal(await error({claimed:'https://evil.example/openid/id/76561198000000042'}),'steam-bad-identity');
  assert.equal(await error({tamperReturn:true}),'steam-wrong-return-to');
  assert.equal(await error({cookieOverride:'rlb_login=someone-elses-state'}),'state');
  assert.equal(await error({nonce:new Date(c.clock.t-10*60e3).toISOString().replace(/\.\d+Z$/,'Z')+'old'}),'steam-stale');
 }finally{await c.close();}
});

test('a second Steam identity links only to a recent session and only if unused', async()=>{
 const c=await start();
 try{
  const cookie=(await c.completeSignup((await c.steamCallback()).cb,'Steamer')).cookie;
  const csrf=(await c.req('GET','/me',{cookie})).data.csrf;
  // STEAM_ID2 already owns a different account.
  await c.completeSignup((await c.steamCallback({claimed:`https://steamcommunity.com/openid/id/${STEAM_ID2}`})).cb,'Steamer2');
  // A fresh identity (STEAM_ID3) links onto the signed-in account.
  const linked=await c.steamCallback({claimed:`https://steamcommunity.com/openid/id/${STEAM_ID3}`,linkFrom:{cookie,csrf}});
  assert.equal(linked.cb.location,PUBLIC+'?linked=steam');
  assert.deepEqual((await c.req('GET','/me',{cookie})).data.identities,['steam','steam']);
  // STEAM_ID2 already owns another account: it cannot be attached to this one.
  const taken=await c.steamCallback({claimed:`https://steamcommunity.com/openid/id/${STEAM_ID2}`,linkFrom:{cookie,csrf}});
  assert.equal(new URL(taken.cb.location).searchParams.get('login_error'),'identity-in-use');
  // Linking needs a recent sign-in.
  c.clock.t+=16*60e3;
  const stale=await c.req('POST','/auth/steam/link-start',{cookie,csrf});
  assert.deepEqual([stale.status,stale.data.error],[403,'reauthenticate']);
  assert.equal((await c.req('POST','/auth/login',{data:{subject:'x'}})).status,404); // dev login absent in production config
 }finally{await c.close();}
});

test('the SteamID reaches the gateway only for owner-declared Steam-verified servers', async()=>{
 const c=await start();
 try{
  const cookie=(await c.completeSignup((await c.steamCallback()).cb,'Steamer')).cookie,csrf=(await c.req('GET','/me',{cookie})).data.csrf;
  const srv=(await c.req('POST','/owner/servers',{cookie,csrf,data:{name:'S',region:'eu',endpoint:'wss://s.example/play'}})).data;
  const remote=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code:srv.enrolmentCode})).credential});
  await remote.heartbeat({players:0,capacity:10});
  await c.req('POST',`/owner/servers/${srv.id}/publish`,{cookie,csrf,data:{listed:true}});
  const ticket=async()=>(await c.req('POST',`/servers/${srv.id}/join-ticket`,{cookie,csrf})).data.ticket;
  assert.equal((await remote.redeemAdmission(await ticket(),{serverId:srv.id})).steamId,undefined);
  await c.req('POST',`/owner/servers/${srv.id}/steam-verified`,{cookie,csrf,data:{verified:true}});
  assert.equal((await remote.redeemAdmission(await ticket(),{serverId:srv.id})).steamId,STEAM_ID);
 }finally{await c.close();}
});

test('a provider sign-up waits 15 minutes for a username, which must be free and valid', async()=>{
 const c=await start();
 try{
  const first=(await c.steamCallback()).cb;
  assert.equal((await c.completeSignup(first,'ad')).data.error,'invalid-username');
  c.db.createAccount({uuid:'00000000-0000-4000-8000-000000000001',username:'Taken',email:null,passwordHash:null,at:1});
  const taken=await c.completeSignup(first,'taken');assert.deepEqual([taken.status,taken.data.error],[409,'username-taken']);
  assert.equal((await c.completeSignup(first,'Fresh1','bad-email')).data.error,'invalid-email');
  c.clock.t+=15*60e3+1;
  const gone=await c.req('GET','/auth/pending',{cookie:c.signupCookie(first)});
  assert.deepEqual([gone.status,gone.data.error],[404,'no-pending-signup']);
  assert.equal((await c.completeSignup(first,'Fresh1')).status,404);
  assert.equal((await c.req('GET','/auth/pending')).status,404,'no cookie');
 }finally{await c.close();}
});

test('players from before website accounts choose a username once', async()=>{
 const c=await start();
 try{
  c.db.createPlayer('00000000-0000-4000-8000-000000000042','Old Name','steam',STEAM_ID,1);
  const cb=(await c.steamCallback()).cb,cookie=c.sessionCookie(cb);
  assert.equal(cb.location,PUBLIC+'servers?signed_in=steam');
  const me=(await c.req('GET','/me',{cookie})).data;assert.equal(me.needsUsername,true);assert.equal(me.name,'Old Name');
  const set=await c.req('POST','/account/username',{cookie,csrf:me.csrf,data:{username:'Veteran'}});assert.equal(set.status,200);
  assert.equal((await c.req('GET','/me',{cookie})).data.username,'Veteran');
  const again=await c.req('POST','/account/username',{cookie,csrf:me.csrf,data:{username:'Other'}});assert.deepEqual([again.status,again.data.error],[409,'username-set']);
 }finally{await c.close();}
});
