// Central account/directory service over HTTP with a controllable clock. Dev login verifier only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {listenServer} from '../bridge/listen.mjs';

const ORIGIN='https://play.example.test';

async function central(){
 const clock={t:1_800_000_000_000},db=openCentralDb();
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 async function call(method,path,{data,cookie,csrf,origin=ORIGIN,auth}={}){
  const headers={origin};if(data!==undefined)headers['content-type']='application/json';if(cookie)headers.cookie=cookie;if(csrf)headers['x-csrf-token']=csrf;if(auth)headers.authorization='Bearer '+auth;
  const res=await fetch(base+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 async function login(subject,name=subject){const r=await call('POST','/auth/login',{data:{subject,name}});return {cookie:r.cookie,csrf:r.data.csrf,player:r.data.player};}
 return {db,clock,base,call,login,close:()=>new Promise(r=>http.close(r))};
}

test('sign-in creates one permanent player per identity; sessions need CSRF and origin for changes', async()=>{
 const c=await central();
 try{
  const a=await c.login('alice'),again=await c.login('alice');
  assert.equal(a.player,again.player);
  assert.match(a.cookie,/^rlb_session=/);
  assert.equal((await c.call('GET','/me',{cookie:a.cookie})).data.player,a.player);
  assert.equal((await c.call('GET','/me')).status,401);
  assert.equal((await c.call('POST','/owner/servers',{cookie:a.cookie,data:{name:'x',region:'eu',endpoint:'wss://g.example/play'}})).status,403); // no CSRF
  assert.equal((await c.call('POST','/owner/servers',{cookie:a.cookie,csrf:a.csrf,origin:'https://evil.example',data:{name:'x',region:'eu',endpoint:'wss://g.example/play'}})).status,403);
  assert.equal((await c.call('POST','/auth/login',{origin:'https://evil.example',data:{subject:'bob'}})).status,403);
  await c.call('POST','/auth/logout',{cookie:a.cookie,csrf:a.csrf});
  assert.equal((await c.call('GET','/me',{cookie:a.cookie})).status,401);
 }finally{await c.close();}
});

test('owner registration, gateway enrolment, heartbeat, listing, tickets and one-use redemption', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),player=await c.login('player','Player One');
  assert.equal((await c.call('POST','/owner/servers',{cookie:owner.cookie,csrf:owner.csrf,data:{name:'Pilot',region:'eu',endpoint:'http://insecure/play'}})).data.error,'invalid-endpoint');
  const created=await c.call('POST','/owner/servers',{cookie:owner.cookie,csrf:owner.csrf,data:{name:'Pilot',region:'eu',endpoint:'wss://pilot.example/play'}});
  assert.equal(created.status,201);
  const serverId=created.data.id;
  const {credential}=await enrolGateway({baseUrl:c.base,code:created.data.enrolmentCode});
  await assert.rejects(enrolGateway({baseUrl:c.base,code:created.data.enrolmentCode}),/invalid-code/); // one-time
  const remote=createRemoteAccount({baseUrl:c.base,credential});

  assert.equal((await c.call('POST',`/owner/servers/${serverId}/publish`,{cookie:owner.cookie,csrf:owner.csrf,data:{listed:true}})).data.error,'heartbeat-required');
  await remote.heartbeat({players:0,capacity:50,wipe:'2026-10'});
  assert.equal((await c.call('POST',`/owner/servers/${serverId}/publish`,{cookie:player.cookie,csrf:player.csrf,data:{listed:true}})).status,404); // not the owner
  await c.call('POST',`/owner/servers/${serverId}/publish`,{cookie:owner.cookie,csrf:owner.csrf,data:{listed:true}});
  const list=(await c.call('GET','/servers')).data.servers;
  assert.deepEqual([list.length,list[0].online,list[0].endpoint,list[0].capacity],[1,true,'wss://pilot.example/play',50]);

  // The owner can rename the server; nobody else can, and the name must be 1–64 characters.
  const rename=(who,name)=>c.call('POST',`/owner/servers/${serverId}/name`,{cookie:who.cookie,csrf:who.csrf,data:{name}});
  assert.equal((await rename(player,'Hijacked')).status,404);
  for(const bad of ['   ','x'.repeat(65),42])assert.equal((await rename(owner,bad)).data.error,'invalid-server-name');
  assert.deepEqual((await rename(owner,'  Pilot EU  ')).data,{name:'Pilot EU'});
  assert.equal((await c.call('GET','/servers')).data.servers[0].name,'Pilot EU');
  assert.equal((await c.call('GET','/owner/servers',{cookie:owner.cookie})).data.servers[0].name,'Pilot EU');

  const join=await c.call('POST',`/servers/${serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf});
  assert.equal(join.status,200);
  const claims=await remote.redeemAdmission(join.data.ticket,{serverId});
  assert.deepEqual([claims.subject,claims.name],[player.player,'Player One']);
  await assert.rejects(remote.redeemAdmission(join.data.ticket,{serverId}),{code:'replayed'});

  // Another server's credential cannot redeem this server's tickets.
  const other=await c.call('POST','/owner/servers',{cookie:owner.cookie,csrf:owner.csrf,data:{name:'Other',region:'us',endpoint:'wss://other.example/play'}});
  const otherRemote=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code:other.data.enrolmentCode})).credential});
  const t2=(await c.call('POST',`/servers/${serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data.ticket;
  await assert.rejects(otherRemote.redeemAdmission(t2,{serverId:other.data.id}),{code:'wrong-server'});

  // Credential rotation revokes the previous credential.
  const code=(await c.call('POST',`/owner/servers/${serverId}/enrolment-code`,{cookie:owner.cookie,csrf:owner.csrf})).data.enrolmentCode;
  const rotated=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code})).credential});
  await assert.rejects(remote.redeemAdmission(t2,{serverId}),{code:'gateway-unauthenticated'});
  assert.equal((await rotated.redeemAdmission(t2,{serverId})).subject,player.player);

  // Stale heartbeats take the server offline and stop new tickets; suspended players cannot join.
  c.clock.t+=61_000;
  assert.equal((await c.call('GET','/servers')).data.servers[0].online,false);
  assert.equal((await c.call('POST',`/servers/${serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data.error,'server-offline');
  await rotated.heartbeat({players:1,capacity:50});
  const t3=(await c.call('POST',`/servers/${serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data.ticket;
  c.db.setPlayerStatus(player.player,'suspended');
  await assert.rejects(rotated.redeemAdmission(t3,{serverId}),{code:'account-suspended'});
  assert.equal((await c.call('GET','/me',{cookie:player.cookie})).data.error,'account-suspended');

  const audit=c.db.auditFor(serverId).map(e=>e.action);
  assert.deepEqual(audit,['server-created','credential-issued','server-listed','server-renamed','enrolment-code-issued','credential-issued']);
  assert.ok(!JSON.stringify(c.db.auditFor(serverId)).includes(credential));
 }finally{await c.close();}
});

test('bridge endpoints reject missing or malformed credentials and the gateway fails closed', async()=>{
 const c=await central();
 try{
  assert.equal((await c.call('POST','/bridge/redeem',{data:{ticket:'x'}})).status,401);
  assert.equal((await c.call('POST','/bridge/heartbeat',{auth:'A'.repeat(43),data:{}})).status,401);
  assert.throws(()=>createRemoteAccount({baseUrl:c.base,credential:'short'}),/Invalid server credential/);
  const down=createRemoteAccount({baseUrl:'http://127.0.0.1:1',credential:'A'.repeat(43),timeoutMs:500});
  await assert.rejects(down.redeemAdmission('t',{serverId:'s'}),{code:'account-service-unavailable'});
 }finally{await c.close();}
});

test('a listed server has a public page entry; unlisted ones do not', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),id='4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',hidden='5f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  c.db.createServer({uuid:id,owner:owner.player,name:'Listed EU',region:'eu',endpoint:'wss://listed.example/play',at:1});
  c.db.createServer({uuid:hidden,owner:owner.player,name:'Hidden',region:'eu',endpoint:'wss://hidden.example/play',at:1});
  c.db.setListed(id,true);c.db.heartbeat(id,7,50,'2026-10',c.clock.t);
  const all=(await c.call('GET','/servers')).data.servers,one=await c.call('GET','/servers/'+id);
  assert.equal(one.status,200);assert.deepEqual(one.data,all.find(s=>s.id===id));
  assert.deepEqual((await c.call('GET','/servers/'+hidden)).data,{error:'unknown-server'});
  assert.equal((await c.call('GET','/servers/not-a-uuid')).status,404);
 }finally{await c.close();}
});
