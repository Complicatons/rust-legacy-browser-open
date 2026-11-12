// Central admin tooling (central/admin.mjs): per-server roles, account bans, gateway reports, evidence, player
// reports and the audit log. In-process HTTP with a controllable clock; dev login verifier only.
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
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false,rateLimit:1000});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 async function call(method,path,{data,as,csrf=true,auth}={}){
  const headers={origin:ORIGIN};if(data!==undefined)headers['content-type']='application/json';
  if(as){headers.cookie=as.cookie;if(csrf)headers['x-csrf-token']=as.csrf;}if(auth)headers.authorization='Bearer '+auth;
  const res=await fetch(base+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});
  return {status:res.status,data:await res.json()};
 }
 async function login(subject){const res=await fetch(base+'/auth/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({subject,name:subject})});const d=await res.json();return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:d.csrf,player:d.player,name:subject};}
 async function server(owner,name){
  const created=(await call('POST','/owner/servers',{as:owner,data:{name,region:'eu',endpoint:`wss://${name.toLowerCase()}.example/play`}})).data;
  const {credential}=await enrolGateway({baseUrl:base,code:created.enrolmentCode});
  const remote=createRemoteAccount({baseUrl:base,credential});await remote.heartbeat({players:0,capacity:50});
  await call('POST',`/owner/servers/${created.id}/publish`,{as:owner,data:{listed:true}});
  return {id:created.id,credential,remote};
 }
 return {db,clock,base,call,login,server,close:()=>new Promise(r=>http.close(r))};
}
const roster=(...players)=>players.map(p=>({subject:p.player,name:p.name,playerId:1,score:p.score??0,flags:p.flags??{},connectedAt:1}));

test('roles: owner, admin and moderator abilities follow the permission matrix and every change is audited', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),mod=await c.login('mod'),adm=await c.login('adm'),cheater=await c.login('cheater'),stranger=await c.login('stranger');
  const s=await c.server(owner,'Pilot'),p=`/admin/servers/${s.id}`;
  assert.deepEqual((await c.call('GET','/admin/servers',{as:owner})).data.servers.map(x=>[x.id,x.role]),[[s.id,'owner']]);
  assert.equal((await c.call('GET',`${p}/players`,{as:stranger})).status,404); // no role: indistinguishable from unknown
  assert.deepEqual((await c.call('GET','/admin/servers',{as:stranger})).data.servers,[]);
  assert.equal((await c.call('POST',`${p}/roles`,{as:owner,csrf:false,data:{player:mod.player,role:'moderator'}})).status,403); // CSRF
  assert.equal((await c.call('POST',`${p}/roles`,{as:owner,data:{player:mod.player,role:'moderator'}})).status,200);
  assert.equal((await c.call('POST',`${p}/roles`,{as:owner,data:{player:adm.player,role:'admin'}})).status,200);
  assert.equal((await c.call('GET','/admin/servers',{as:mod})).data.servers[0].role,'moderator');
  // Moderator: kick and short bans only; no roles, audit or permanent bans; never on higher ranks or self.
  assert.equal((await c.call('POST',`${p}/roles`,{as:mod,data:{player:stranger.player,role:'moderator'}})).data.error,'insufficient-role');
  assert.equal((await c.call('GET',`${p}/audit`,{as:mod})).status,403);
  assert.equal((await c.call('POST',`${p}/bans`,{as:mod,data:{player:cheater.player,reason:'aimbot'}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`${p}/bans`,{as:mod,data:{player:cheater.player,reason:'aimbot',minutes:10080}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`${p}/bans`,{as:mod,data:{player:owner.player,reason:'x',minutes:60}})).data.error,'target-outranks-you');
  assert.equal((await c.call('POST',`${p}/kick`,{as:mod,data:{player:mod.player,reason:'x'}})).data.error,'cannot-target-self');
  assert.equal((await c.call('POST',`${p}/kick`,{as:mod,data:{player:cheater.player}})).data.error,'reason-required');
  assert.equal((await c.call('POST',`${p}/bans`,{as:mod,data:{player:cheater.player,reason:'speedhack',minutes:60}})).status,201);
  // Admin: manages moderators but not admins; global bans are platform staff only.
  assert.equal((await c.call('POST',`${p}/roles`,{as:adm,data:{player:stranger.player,role:'moderator'}})).status,200);
  assert.equal((await c.call('POST',`${p}/roles`,{as:adm,data:{player:stranger.player,role:'admin'}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`${p}/roles`,{as:adm,data:{player:adm.player,role:null}})).data.error,'cannot-target-self');
  assert.equal((await c.call('POST',`${p}/bans`,{as:adm,data:{player:cheater.player,reason:'x',scope:'global'}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`${p}/bans`,{as:adm,data:{player:mod.player,reason:'abuse of powers',minutes:30}})).status,201);
  const roles=(await c.call('GET',`${p}/roles`,{as:adm})).data;
  assert.equal(roles.owner.player,owner.player);
  assert.deepEqual(roles.roles.map(r=>[r.name,r.role]).sort(),[['adm','admin'],['mod','moderator'],['stranger','moderator']]);
  const audit=(await c.call('GET',`${p}/audit`,{as:owner})).data.events;
  const actions=audit.map(e=>[e.actorName,e.action,e.playerName]);
  for(const a of [['owner','admin.role','mod'],['owner','admin.role','adm'],['mod','admin.ban','cheater'],['adm','admin.role','stranger'],['adm','admin.ban','mod']])assert.ok(actions.some(x=>x.join()===a.join()),a.join());
  assert.equal(audit.find(e=>e.action==='admin.ban'&&e.playerName==='cheater').detail.reason,'speedhack');
 }finally{await c.close();}
});

test('account bans: per server or network-wide, temporary or permanent, enforced on tickets and redemption', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),other=await c.login('other-owner'),cheater=await c.login('cheater'),staff=await c.login('staff');
  const a=await c.server(owner,'Alpha'),b=await c.server(other,'Beta');
  const ticket=(srv,who=cheater)=>c.call('POST',`/servers/${srv.id}/join-ticket`,{as:who});
  const early=(await ticket(a)).data.ticket; // issued before the ban
  const ban=(await c.call('POST',`/admin/servers/${a.id}/bans`,{as:owner,data:{player:cheater.player,reason:'fly hack',minutes:60}})).data.ban;
  assert.equal(ban.scope,'server');assert.equal(ban.expiresAt,c.clock.t+3600e3);
  assert.equal((await ticket(a)).data.error,'banned');
  assert.equal((await ticket(b)).status,200); // server bans stay on that server
  await assert.rejects(a.remote.redeemAdmission(early,{serverId:a.id}),e=>e.code==='banned');
  c.clock.t+=3601e3;await a.remote.heartbeat({players:0,capacity:50});await b.remote.heartbeat({players:0,capacity:50});
  assert.equal((await ticket(a)).status,200); // expired
  // Permanent ban and unban by the owner; both audited.
  const perm=(await c.call('POST',`/admin/servers/${a.id}/bans`,{as:owner,data:{player:cheater.player,reason:'aimbot evidence'}})).data.ban;
  assert.equal(perm.expiresAt,null);assert.equal((await ticket(a)).data.error,'banned');
  const listed=(await c.call('GET',`/admin/servers/${a.id}/bans`,{as:owner})).data.bans;
  assert.deepEqual(listed.map(x=>[x.name,x.active]),[['cheater',true],['cheater',false]]);
  assert.equal((await c.call('POST',`/admin/servers/${b.id}/unban`,{as:other,data:{ban:perm.id}})).data.error,'unknown-ban'); // another server's ban
  assert.equal((await c.call('POST',`/admin/servers/${a.id}/unban`,{as:owner,data:{ban:perm.id}})).status,200);
  assert.equal((await c.call('POST',`/admin/servers/${a.id}/unban`,{as:owner,data:{ban:perm.id}})).data.error,'already-revoked');
  assert.equal((await ticket(a)).status,200);
  // Network ban: platform staff only (granted out of band), blocks every server; owners cannot lift it.
  c.db.addStaff(staff.player,c.clock.t);
  assert.equal((await c.call('GET','/admin/servers',{as:staff})).data.servers.length,2);
  const global=(await c.call('POST',`/admin/servers/${b.id}/bans`,{as:staff,data:{player:cheater.player,reason:'cheat seller',scope:'global'}})).data.ban;
  assert.equal(global.scope,'global');
  assert.equal((await ticket(a)).data.error,'banned');assert.equal((await ticket(b)).data.error,'banned');
  assert.equal((await c.call('POST',`/admin/servers/${a.id}/unban`,{as:owner,data:{ban:global.id}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`/admin/servers/${b.id}/bans`,{as:other,data:{player:staff.player,reason:'x',minutes:60}})).data.error,'target-outranks-you');
  assert.ok(c.db.auditFor(a.id).some(e=>e.action==='admin.unban'));
 }finally{await c.close();}
});

test('gateway reports feed the live roster and evidence; kicks and bans come back in the reply', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),cheater=await c.login('cheater'),honest=await c.login('honest');
  const s=await c.server(owner,'Pilot'),p=`/admin/servers/${s.id}`;
  assert.equal((await c.call('POST','/bridge/report',{auth:'A'.repeat(43),data:{players:[],flags:[]}})).status,401);
  assert.equal((await c.call('GET',`${p}/players`,{as:owner})).data.online,false);
  const flag={subject:cheater.player,kind:'teleport',severity:40,score:40,at:c.clock.t-500,detail:{distance:300},replay:[{t:0,kind:'move',pos:[0,0,0]},{t:0.1,kind:'move',pos:[300,0,0]}]};
  const huge={subject:cheater.player,kind:'speed',severity:10,score:50,at:c.clock.t,detail:{metresOver:3},replay:Array.from({length:3000},(_,i)=>({t:i,kind:'move',pos:[i,0,0]}))};
  const junk=[{subject:'not-a-uuid',kind:'x'},{subject:cheater.player,kind:'BAD KIND'}];
  let r=await s.remote.report({players:roster({...cheater,score:62,flags:{teleport:1,speed:1}},honest),flags:[flag,huge,...junk]});
  assert.deepEqual(r.kicks,[]);
  const live=(await c.call('GET',`${p}/players`,{as:owner})).data;
  assert.equal(live.online,true);
  assert.deepEqual(live.players.map(x=>[x.name,x.score,x.review,x.banned]),[['cheater',62,true,false],['honest',0,false,false]]);
  assert.deepEqual(live.players[0].flags,{teleport:1,speed:1});
  const evidence=(await c.call('GET',`${p}/flags?player=${cheater.player}`,{as:owner})).data.flags;
  assert.deepEqual(evidence.map(f=>f.kind),['speed','teleport']);
  assert.equal(evidence[1].detail.detail.distance,300);assert.equal(evidence[1].detail.replay.length,2);assert.equal(evidence[1].at,c.clock.t-500);
  assert.equal(evidence[0].detail.replayTruncated,true); // oversized replay dropped, detail kept
  // Kick: queued by the admin, delivered once in the next report reply.
  assert.equal((await c.call('POST',`${p}/kick`,{as:owner,data:{player:cheater.player,reason:'teleport evidence'}})).data.online,true);
  r=await s.remote.report({players:roster(cheater,honest),flags:[]});
  assert.deepEqual(r.kicks,[{subject:cheater.player,reason:'kicked'}]);
  assert.deepEqual((await s.remote.report({players:roster(cheater,honest),flags:[]})).kicks,[]);
  // A ban kicks the account on every report while it is rostered (here: it is still connected).
  await c.call('POST',`${p}/bans`,{as:owner,data:{player:cheater.player,reason:'teleport',minutes:1440}});
  r=await s.remote.report({players:roster(cheater,honest),flags:[]});
  assert.deepEqual(r.kicks,[{subject:cheater.player,reason:'banned'}]);
  assert.equal((await c.call('GET',`${p}/players`,{as:owner})).data.players.find(x=>x.name==='cheater').banned,true);
  // Stale roster (gateway silent > 30 s) reads as offline.
  c.clock.t+=31e3;assert.equal((await c.call('GET',`${p}/players`,{as:owner})).data.online,false);
 }finally{await c.close();}
});

test('players report others by in-game name; moderators resolve reports with an audit trail', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),mod=await c.login('mod'),reporter=await c.login('reporter'),suspect=await c.login('suspect');
  const s=await c.server(owner,'Pilot'),p=`/admin/servers/${s.id}`;
  await c.call('POST',`${p}/roles`,{as:owner,data:{player:mod.player,role:'moderator'}});
  await s.remote.report({players:roster(reporter,suspect),flags:[]});
  assert.equal((await c.call('POST',`/servers/${s.id}/reports`,{as:reporter,data:{name:'Suspect',reason:'nonsense'}})).data.error,'invalid-report');
  assert.equal((await c.call('POST',`/servers/${s.id}/reports`,{as:reporter,data:{name:'reporter',reason:'cheating'}})).data.error,'cannot-target-self');
  const filed=(await c.call('POST',`/servers/${s.id}/reports`,{as:reporter,data:{name:'Suspect',reason:'cheating',detail:'shot me through a wall'}})).data;
  assert.equal(filed.matched,true);
  const open=(await c.call('GET',`${p}/reports`,{as:mod})).data.reports;
  assert.deepEqual(open.map(r=>[r.name,r.player,r.reporterName,r.reason,r.detail]),[['Suspect',suspect.player,'reporter','cheating','shot me through a wall']]);
  assert.equal((await c.call('GET',`${p}/reports`,{as:reporter})).status,404);
  assert.equal((await c.call('POST',`${p}/resolve-report`,{as:mod,data:{report:filed.report,status:'resolved',note:'banned 24 h'}})).status,200);
  assert.equal((await c.call('POST',`${p}/resolve-report`,{as:mod,data:{report:filed.report,status:'dismissed'}})).data.error,'already-resolved');
  assert.deepEqual((await c.call('GET',`${p}/reports`,{as:mod})).data.reports,[]);
  assert.equal((await c.call('GET',`${p}/reports?status=resolved`,{as:mod})).data.reports[0].resolution,'banned 24 h');
  assert.ok((await c.call('GET',`${p}/audit`,{as:owner})).data.events.some(e=>e.action==='admin.report-resolved'&&e.actorName==='mod'&&e.playerName==='suspect'));
  for(let i=0;i<9;i++)await c.call('POST',`/servers/${s.id}/reports`,{as:reporter,data:{name:'someone',reason:'other'}});
  assert.equal((await c.call('POST',`/servers/${s.id}/reports`,{as:reporter,data:{name:'someone',reason:'other'}})).data.error,'rate-limited');
 }finally{await c.close();}
});
