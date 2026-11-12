// Player history for one server (central/player-history.mjs): play time and sessions, in-game names as the gateway
// and the server adapter report them, flags by kind, bans, kicks and in-game actions from the audit log, reports, and
// the kinds of character (browser, desktop). Role rules: moderators see bans but not the audit log; the host app key
// acts as the owner. In-process HTTP with a controllable clock; dev login verifier only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {listenServer} from '../bridge/listen.mjs';

const ORIGIN='https://play.example.test';
async function central(db=openCentralDb()){
 const clock={t:1_800_000_000_000};
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false,rateLimit:1000});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 async function call(method,path,{data,as,auth}={}){
  const headers={origin:ORIGIN};if(data!==undefined)headers['content-type']='application/json';
  if(as){headers.cookie=as.cookie;headers['x-csrf-token']=as.csrf;}if(auth)headers.authorization='Bearer '+auth;
  const res=await fetch(base+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});
  return {status:res.status,data:await res.json()};
 }
 async function login(subject){const res=await fetch(base+'/auth/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({subject,name:subject})});const d=await res.json();return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:d.csrf,player:d.player,name:subject};}
 async function server(owner,name){
  const created=(await call('POST','/owner/servers',{as:owner,data:{name,region:'eu',endpoint:`wss://${name.toLowerCase()}.example/play`}})).data;
  const {credential}=await enrolGateway({baseUrl:base,code:created.enrolmentCode});
  const remote=createRemoteAccount({baseUrl:base,credential});await remote.heartbeat({players:0,capacity:50});
  return {id:created.id,credential,remote};
 }
 return {db,clock,call,login,server,close:()=>new Promise(r=>http.close(r))};
}
const entry=(p,name)=>({subject:p.player,name,playerId:1,score:0,flags:{},connectedAt:null});

test('player history: sessions, names, flags, bans, audit (admins only), reports and kinds; host key; role rules',async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),mod=await c.login('mod'),adm=await c.login('adm'),cheater=await c.login('cheater'),reporter=await c.login('reporter'),stranger=await c.login('stranger');
  const s=await c.server(owner,'Pilot'),p=`/admin/servers/${s.id}`;
  await c.call('POST',`${p}/roles`,{as:owner,data:{player:mod.player,role:'moderator'}});
  await c.call('POST',`${p}/roles`,{as:owner,data:{player:adm.player,role:'admin'}});
  const t0=c.clock.t;
  // Session 1: two reports 20 s apart as "Cheater", a desktop player on the server too (handle only, then linked).
  await s.remote.report({players:[entry(cheater,'Cheater'),entry(reporter,'Reporter')],flags:[],desktop:[{handle:'DeskHandle000001',name:'Desk Guy',score:0,flags:{}}]});
  c.clock.t+=20e3;
  await s.remote.report({players:[entry(cheater,'Cheater'),entry(reporter,'Reporter')],flags:[{subject:cheater.player,kind:'speed',severity:10,score:10,detail:{x:1}},{subject:cheater.player,kind:'teleport',severity:40,score:50,detail:{}}],
   events:[{type:'desktop-flag',handle:'DeskHandle000001',name:'Desk Guy',kind:'fly',severity:20,score:20,detail:{}}]});
  assert.equal((await c.call('POST',`/servers/${s.id}/reports`,{as:reporter,data:{name:'Cheater',reason:'cheating',detail:'flew over my base'}})).status,201);
  // Session 2 after a long gap, under a new in-game name, also on the desktop with a linked character.
  c.clock.t+=3600e3;
  await s.remote.report({players:[entry(cheater,'Ch3ater')],flags:[{subject:cheater.player,kind:'speed',severity:15,score:25,detail:{}}],desktop:[{handle:'DeskHandle000002',name:'Ch3ater (pc)',subject:cheater.player,score:0,flags:{}}]});
  c.clock.t+=50e3;
  await s.remote.report({players:[entry(cheater,'Ch3ater')],flags:[]});
  assert.equal((await c.call('POST',`${p}/kick`,{as:owner,data:{player:cheater.player,reason:'speeding'}})).status,202);
  assert.equal((await c.call('POST',`${p}/bans`,{as:owner,data:{player:cheater.player,reason:'teleporting',minutes:60}})).status,201);

  const h=(await c.call('GET',`${p}/player-history?player=${cheater.player}`,{as:adm})).data;
  assert.equal(h.player.name,'cheater');
  assert.equal(h.sessions,2);assert.equal(h.firstSeen,t0);assert.equal(h.lastSeen,c.clock.t);
  assert.equal(h.playTimeMs,20e3+50e3);
  assert.deepEqual(h.names.map(n=>[n.name,n.kind]).sort(),[['Ch3ater (pc)','desktop'],['Ch3ater','browser'],['Cheater','browser']]);
  assert.equal(h.names.find(n=>n.name==='Cheater').lastSeen,t0); // names are written at most once a minute per character
  assert.deepEqual(h.kinds.sort(),['browser','desktop']);
  assert.deepEqual(h.flags.kinds.map(k=>[k.kind,k.count,k.maxSeverity]),[['speed',2,15],['teleport',1,40]]);
  assert.equal(h.flags.total,3);
  assert.equal(h.bans.length,1);assert.equal(h.bans[0].active,true);assert.equal(h.bans[0].reason,'teleporting');
  assert.deepEqual(h.moderation.map(m=>m.action).sort(),['admin.ban','admin.kick','anticheat.screenshot-request']); // the teleport flag asked for a screenshot
  assert.equal(h.moderation.find(m=>m.action==='admin.kick').reason,'speeding');assert.equal(h.moderation[0].actorName,'owner');
  assert.equal(h.reports.length,1);assert.equal(h.reports[0].reporterName,'reporter');assert.equal(h.reports[0].detail,'flew over my base');
  assert.equal(h.online,true);

  // Moderators see bans and reports but not the audit log; strangers see nothing; the host app key acts as the owner.
  const m=(await c.call('GET',`${p}/player-history?player=${cheater.player}`,{as:mod})).data;
  assert.equal(m.moderation,null);assert.equal(m.bans.length,1);
  assert.equal((await c.call('GET',`${p}/player-history?player=${cheater.player}`,{as:stranger})).status,404);
  const key=(await c.call('POST',`/owner/servers/${s.id}/host-key`,{as:owner})).data.hostKey;
  assert.equal((await c.call('GET',`${p}/player-history?player=${cheater.player}`,{auth:key})).data.moderation.length,3);
  assert.equal((await c.call('GET',`${p}/player-history?player=nope`,{as:adm})).status,400);
  assert.equal((await c.call('GET',`${p}/player-history?handle=../x`,{as:adm})).status,400);

  // A desktop player known only by handle: names, first/last seen and flags.
  const d=(await c.call('GET',`${p}/player-history?handle=DeskHandle000001`,{as:adm})).data;
  assert.equal(d.player.handle,'DeskHandle000001');assert.deepEqual(d.names.map(n=>n.name),['Desk Guy']);
  assert.equal(d.firstSeen,t0);assert.equal(d.lastSeen,t0);assert.equal(d.sessions,null);
  assert.deepEqual(d.flags.kinds.map(k=>k.kind),['fly']);assert.deepEqual(d.kinds,['desktop']);

  // Without a player: the server's recent players, accounts and desktop handles, newest first.
  const list=(await c.call('GET',`${p}/player-history`,{as:mod})).data.players;
  assert.equal(list[0].name,'cheater');assert.ok(list.some(x=>x.name==='reporter'&&x.sessions===1));
  assert.ok(list.some(x=>x.handle==='DeskHandle000001'&&x.name==='Desk Guy'));
  assert.equal(list.find(x=>x.player===cheater.player).flags,3);
  assert.equal(list.find(x=>x.player===cheater.player).playTimeMs,70e3);
 }finally{await c.close();}
});

test('player history: the name table is added to an existing database and survives reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-hist-')),file=join(dir,'central.db');
 try{
  let db=openCentralDb(file);db.raw.exec('drop table player_names');db.raw.close();
  db=openCentralDb(file);
  db.touchName('s1','u1','browser','A',1);db.touchName('s1','u1','browser','A',5);db.touchName('s1','u1','browser','B',9);
  db.raw.close();db=openCentralDb(file);
  assert.deepEqual(db.namesFor('s1','u1').map(r=>[r.name,r.first_seen,r.last_seen]),[['B',9,9],['A',1,5]]);
  assert.equal(db.pruneNames(6),1);
  db.raw.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
