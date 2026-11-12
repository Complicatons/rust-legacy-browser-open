// One account per person (central/identity.mjs, phone.mjs, steam-quality.mjs): sign-up email rules, device signals and
// alt links, linked-identity bans and holds, per-server opt-in strictness, the desktop hardware ID contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {central} from './helpers/central-fixture.mjs';
import {enrolGateway,createRemoteAccount} from '../bridge/remote-account.mjs';
import {canonicalEmail} from '../central/passwords.mjs';
import {watchedList,domainBlocked,networkLabeller,ipKey,signalString,createIdentity} from '../central/identity.mjs';
import {openCentralDb} from '../central/db.mjs';
import {normalisePhone,createConsolePhoneProvider} from '../central/phone.mjs';
import {createSteamQuality,steamQualityRefusal,wantsSteamQuality} from '../central/steam-quality.mjs';
import {DEFAULT_POLICY} from '../central/db.mjs';
import {requirementLabels} from '../site/js/server-data.mjs';

const HWID_A='v1:'+'A'.repeat(43),DAY=86400e3;
const login=async(c,subject)=>{const r=await c.call('POST','/auth/login',{data:{subject,name:subject}});return {cookie:r.cookie,csrf:r.data.csrf,player:r.data.player,name:subject};};
const user=r=>({cookie:r.cookie,csrf:r.data.csrf,player:r.data.player});
const act=(c,who,extraCookie)=>(method,p,data)=>c.call(method,p,{data,cookie:who.cookie+(extraCookie?'; '+extraCookie:''),csrf:who.csrf});
async function server(c,owner,name){
 const created=(await act(c,owner)('POST','/owner/servers',{name,region:'eu',endpoint:`wss://${name.toLowerCase()}.example/play`})).data;
 const {credential}=await enrolGateway({baseUrl:c.base,code:created.enrolmentCode});
 const remote=createRemoteAccount({baseUrl:c.base,credential});await remote.heartbeat({players:0,capacity:50});
 await act(c,owner)('POST',`/owner/servers/${created.id}/publish`,{listed:true});
 return {id:created.id,remote};
}
const ticket=(c,who,id)=>act(c,who)('POST',`/servers/${id}/join-ticket`,{});
const device=(c,who,{cookie,token,signals={ua:'Firefox 140',screen:{w:1920,h:1080,dpr:1},tz:'Europe/London',webgl:'GeForce'}}={})=>act(c,who,cookie?`rlb_device=${cookie}`:'')('POST','/account/device',{token,signals});

test('canonical emails fold Gmail dots, googlemail and +tags; other domains keep dots', ()=>{
 assert.equal(canonicalEmail(' J.O.E+rust@GoogleMail.com '),'joe@gmail.com');
 assert.equal(canonicalEmail('joe@gmail.com'),'joe@gmail.com');
 assert.equal(canonicalEmail('first.last+x@example.org'),'first.last@example.org');
 assert.equal(canonicalEmail('+only@example.org'),'+only@example.org'); // nothing before the tag: left alone
});

test('throwaway list: subdomains are covered, the file is re-read when it changes, a missing file is empty', ()=>{
 assert.equal(domainBlocked('x.mailinator.com',new Set(['mailinator.com'])),true);
 assert.equal(domainBlocked('notmailinator.com',new Set(['mailinator.com'])),false);
 const dir=mkdtempSync(path.join(tmpdir(),'rlb-list-')),file=path.join(dir,'d.txt'),clock={t:0};
 writeFileSync(file,'# comment\nfirst.test\n');
 const list=watchedList(file,{now:()=>clock.t,everyMs:1000});
 assert.deepEqual(list(),['first.test']);
 writeFileSync(file,'first.test\nsecond.test # note\n');utimesSync(file,new Date(),new Date(Date.now()+5000));
 assert.deepEqual(list(),['first.test']); // inside the check interval
 clock.t=2000;assert.deepEqual(list(),['first.test','second.test']);
 assert.deepEqual(watchedList(path.join(dir,'missing.txt'))(),[]);
});

test('hosting ranges, IP keys and signal strings', ()=>{
 const label=networkLabeller(['5.9.0.0/16 AS24940 Hetzner','2a01:4f8::/32 AS24940 Hetzner','bad line','10.0.0.0/99 nope']);
 assert.equal(label('5.9.1.2'),'AS24940 Hetzner');assert.equal(label('2a01:4f8:1::5'),'AS24940 Hetzner');assert.equal(label('8.8.8.8'),null);
 assert.equal(ipKey('::ffff:203.0.113.9'),'203.0.113.9');
 assert.equal(ipKey('2001:db8:0:1:aaaa::1'),'2001:db8:0:1::/64');assert.equal(ipKey('2001:db8:0:1:bbbb::2'),'2001:db8:0:1::/64');
 assert.equal(signalString({ua:'x'.repeat(500),screen:{w:1920,h:1080,dpr:1.25}}),JSON.stringify(['x'.repeat(300),'1920x1080x1.25','','','']));
});

test('sign-up: throwaway domains refused (file and staff list), one mailbox per account, sign-in by any spelling', async()=>{
 const c=await central();
 try{
  assert.equal((await c.register('Throw','me@mailinator.com')).data.error,'disposable-email');
  assert.equal((await c.register('Throw2','me@eu.mailinator.com')).data.error,'disposable-email');
  const joeR=await c.register('Joe','joe@gmail.com');assert.equal(joeR.status,200);const joe=user(joeR);
  assert.equal((await c.register('Joe2','j.o.e+alt@googlemail.com')).data.error,'email-taken');
  const signin=await c.call('POST','/auth/password',{data:{login:'J.O.E@gmail.com',password:'a long passphrase'}});
  assert.equal(signin.status,200);
  // Staff block a new domain; it applies at once, and only staff may do it.
  const staff=await login(c,'staffer');c.db.addStaff(staff.player,c.clock.t);
  assert.equal((await act(c,joe)('POST','/staff/email-domains',{domain:'newburner.test',blocked:true})).data.error,'staff-only');
  assert.equal((await act(c,staff)('POST','/staff/email-domains',{domain:'not a domain',blocked:true})).data.error,'invalid-domain');
  assert.equal((await act(c,staff)('POST','/staff/email-domains',{domain:'NewBurner.test',blocked:true})).status,200);
  assert.equal((await c.register('Burn','x@newburner.test')).data.error,'disposable-email');
  assert.deepEqual((await act(c,staff)('GET','/staff/email-domains')).data.domains.map(d=>d.domain),['newburner.test']);
  // Changing email follows the same rules.
  assert.equal((await act(c,joe)('POST','/account/email',{email:'joe@yopmail.com',current:'a long passphrase'})).data.error,'disposable-email');
  assert.ok(c.db.recentAudit('network',10).some(e=>e.action==='staff.email-domain-blocked'));
 }finally{await c.close();}
});

test('device signals: cookie and localStorage copy restore each other; only hashes are stored', async()=>{
 const c=await central();
 try{
  const a=await login(c,'alice');
  const first=await device(c,a);assert.equal(first.status,200);
  const token=first.data.token;assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.ok(first.cookies.some(x=>x.startsWith(`rlb_device=${token};`)&&/HttpOnly/.test(x)));
  // Cookie cleared, localStorage kept: same token, cookie set again.
  const again=await device(c,a,{token});assert.equal(again.data.token,token);assert.ok(again.cookies.some(x=>x.startsWith('rlb_device=')));
  // Cookie present: no new cookie.
  assert.equal((await device(c,a,{cookie:token,token})).cookies.length,0);
  const dump=JSON.stringify([c.db.raw.prepare('select * from identifiers').all(),c.db.raw.prepare('select * from device_sightings').all()]);
  for(const raw of [token,'127.0.0.1','Firefox 140','GeForce','Europe/London'])assert.ok(!dump.includes(raw),raw);
 }finally{await c.close();}
});

test('possible alts: shared device, signals + IP, never online together, item transfers between new accounts; viewing is audited', async()=>{
 const c=await central();
 try{
  const owner=await login(c,'owner'),a=await login(c,'alice'),b=await login(c,'bob'),d=await login(c,'dana'),e=await login(c,'eve');
  const s=await server(c,owner,'Pilot');
  const token=(await device(c,a)).data.token;
  await device(c,b,{cookie:token}); // same browser
  await device(c,d); // same signals and IP (same machine, cookies cleared): new token, matching signals hash
  // Alice and Bob each play, never at the same time; Eve trades items with Alice while both are new.
  await s.remote.report({players:[{subject:a.player,name:'alice',connectedAt:c.clock.t}],flags:[]});
  c.clock.t+=5*60e3;await s.remote.report({players:[{subject:b.player,name:'bob',connectedAt:c.clock.t},{subject:e.player,name:'eve',connectedAt:c.clock.t}],flags:[],events:[{type:'item-transfer',from:e.player,to:a.player,item:'M4',amount:1}]});
  const r=(await act(c,owner)('GET',`/admin/servers/${s.id}/alts?player=${a.player}`)).data;
  const by=Object.fromEntries(r.alts.map(x=>[x.name,x]));
  assert.deepEqual(by.bob.reasons,['shared-device','shared-signals-ip']);assert.equal(by.bob.neverOnlineTogether,true);
  assert.deepEqual(by.dana.reasons,['shared-signals-ip']);
  assert.deepEqual(by.eve.reasons,['item-transfer']);
  assert.ok(!JSON.stringify(r).includes(token));
  assert.ok(c.db.recentAudit(s.id,20).some(x=>x.action==='admin.alts-view'));
  assert.equal((await act(c,a)('GET',`/admin/servers/${s.id}/alts?player=${b.player}`)).status,404); // players without a role
 }finally{await c.close();}
});

test('linked-identity bans: a shared device holds for review, an admin clears it; unban lifts holds; all audited', async()=>{
 const c=await central();
 try{
  const owner=await login(c,'owner'),cheat=await login(c,'cheat'),sib=await login(c,'sibling');
  const s=await server(c,owner,'Pilot'),other=await server(c,owner,'Other');
  const token=(await device(c,cheat)).data.token;await device(c,sib,{cookie:token});
  const ban=(await act(c,owner)('POST',`/admin/servers/${s.id}/bans`,{player:cheat.player,reason:'aimbot'})).data.ban;
  assert.equal((await ticket(c,sib,s.id)).data.error,'held-for-review');
  assert.equal((await ticket(c,sib,other.id)).status,200); // a server ban holds only on that server
  const holds=(await act(c,owner)('GET',`/admin/servers/${s.id}/holds`)).data.holds;
  assert.equal(holds.length,1);assert.equal(holds[0].name,'sibling');assert.equal(holds[0].kind,'device');assert.equal(holds[0].hard,false);
  assert.ok(c.db.recentAudit(s.id,20).some(e=>e.action==='identity-hold'));
  assert.equal((await act(c,owner)('POST',`/admin/servers/${s.id}/clear-hold`,{hold:holds[0].id,reason:'brother, checked'})).status,200);
  assert.equal((await ticket(c,sib,s.id)).status,200);
  assert.equal((await act(c,owner)('POST',`/admin/servers/${s.id}/clear-hold`,{hold:holds[0].id})).data.error,'already-resolved');
  // A third account on the same device is held again; lifting the ban lets it in.
  const third=await login(c,'third');await device(c,third,{cookie:token});
  assert.equal((await ticket(c,third,s.id)).data.error,'held-for-review');
  assert.equal((await act(c,owner)('POST',`/admin/servers/${s.id}/unban`,{ban:ban.id})).status,200);
  assert.equal((await ticket(c,third,s.id)).status,200);
  assert.deepEqual((await act(c,owner)('GET',`/admin/servers/${s.id}/holds`)).data.holds,[]);
  assert.ok(c.db.recentAudit(s.id,30).some(e=>e.action==='admin.hold-cleared'));
 }finally{await c.close();}
});

test('network bans refuse sign-ups and links with a hard identifier the banned account used', async()=>{
 const c=await central();
 try{
  const staff=await login(c,'staff');c.db.addStaff(staff.player,c.clock.t);
  const owner=await login(c,'owner'),s=await server(c,owner,'Pilot');
  const cheat=user(await c.register('Cheater','cheater@example.com'));
  // The cheater moves to a new address; the old one stays linked to the account.
  assert.equal((await act(c,cheat)('POST','/account/email',{email:'cheater2@example.com',current:'a long passphrase'})).status,200);
  await act(c,staff)('POST',`/admin/servers/${s.id}/bans`,{player:cheat.player,reason:'cheating',scope:'global'});
  assert.equal((await c.register('Fresh','c.heater+new@example.com')).status,200); // a different mailbox (dots matter outside Gmail)
  assert.equal((await c.register('Again','cheater+again@example.com')).data.error,'identity-banned');
  assert.ok(c.db.recentAudit('network',10).some(e=>e.action==='signup-refused'));
 }finally{await c.close();}
});

test('desktop hardware ID: validated, stored as a hash, a server ban reaches other accounts on that PC', async()=>{
 const c=await central();
 try{
  const owner=await login(c,'owner'),s=await server(c,owner,'Pilot');
  await c.register('Ash','ash@example.com');await c.register('Birch','birch@example.com');
  const desk=async(user,hwid)=>c.call('POST','/desktop/login',{data:{login:user,password:'a long passphrase',device:'PC',...(hwid!==undefined?{hwid}:{})}});
  assert.equal((await desk('Ash','not-a-hwid')).data.error,'invalid-hwid');
  const ash=(await desk('Ash',HWID_A)).data,birch=(await desk('Birch',HWID_A)).data;
  assert.ok(!JSON.stringify(c.db.raw.prepare('select * from identifiers').all()).includes('AAAA'));
  await act(c,owner)('POST',`/admin/servers/${s.id}/bans`,{player:ash.player,reason:'speedhack'});
  const pass=t=>fetch(`${c.base}/desktop/servers/${s.id}/pass`,{method:'POST',headers:{authorization:'Bearer '+t}}).then(async r=>({status:r.status,data:await r.json()}));
  assert.equal((await pass(birch.token)).data.error,'identity-banned');
  assert.equal((await act(c,owner)('GET',`/admin/servers/${s.id}/holds`)).data.holds[0].kind,'hwid');
 }finally{await c.close();}
});

test('phone verification: E.164 only, wrong and expired codes, one number per account, required by policy', async()=>{
 const phone=createConsolePhoneProvider({log:()=>{}});
 const c=await central({phone});
 try{
  assert.equal(normalisePhone('0044 7700-900 123'),'+447700900123');assert.equal(normalisePhone('07700 900123'),null);
  const owner=await login(c,'owner'),a=await login(c,'alice'),b=await login(c,'bob'),s=await server(c,owner,'Pilot');
  assert.equal((await act(c,owner)('POST',`/admin/servers/${s.id}/policy`,{requirePhone:true})).data.requirePhone,true);
  assert.equal((await ticket(c,a,s.id)).data.error,'phone-required');
  assert.equal((await act(c,a)('POST','/account/phone/start',{phone:'12345'})).data.error,'invalid-phone');
  assert.equal((await act(c,a)('POST','/account/phone/start',{phone:'+44 7700 900123'})).status,202);
  assert.equal((await act(c,a)('POST','/account/phone/verify',{code:'000000'===phone.peek('+447700900123')?'111111':'000000'})).data.error,'phone-code-wrong');
  assert.equal((await act(c,a)('POST','/account/phone/verify',{code:phone.peek('+447700900123')})).data.verified,true);
  assert.equal((await act(c,a)('GET','/me')).data.phoneVerified,true);
  assert.equal((await ticket(c,a,s.id)).status,200);
  assert.equal((await act(c,b)('POST','/account/phone/start',{phone:'+447700900123'})).data.error,'phone-taken');
  assert.ok(!JSON.stringify(c.db.raw.prepare('select * from identifiers').all()).includes('7700900123'));
  // Codes expire with their 10 minutes.
  await act(c,b)('POST','/account/phone/start',{phone:'+447700900124'});c.clock.t+=11*60e3;
  assert.equal((await act(c,b)('POST','/account/phone/verify',{code:'123456'})).data.error,'phone-code-expired');
  assert.equal((await act(c,b)('GET','/servers')).data.servers[0].requirements.phone,true);
 }finally{await c.close();}
});

test('Steam quality: thresholds, private profiles, fail closed, cache, and the server list labels', async()=>{
 const p={...DEFAULT_POLICY,require_steam:1};
 assert.equal(wantsSteamQuality(p),false);
 const t=Date.UTC(2026,9,22),old={visible:true,createdAt:t-400*DAY,level:12,vacBans:0,gameBans:0,daysSinceLastBan:null};
 assert.equal(steamQualityRefusal({...p,steam_min_age_days:365,steam_min_level:10,steam_max_vac_bans:0},old,t),null);
 assert.equal(steamQualityRefusal({...p,steam_min_age_days:500},old,t),'steam-account-too-new');
 assert.equal(steamQualityRefusal({...p,steam_min_age_days:1},{...old,createdAt:null},t),'steam-profile-private');
 assert.equal(steamQualityRefusal({...p,steam_min_level:20},old,t),'steam-level-too-low');
 assert.equal(steamQualityRefusal({...p,steam_max_vac_bans:0},{...old,vacBans:1},t),'steam-vac-banned');
 assert.equal(steamQualityRefusal({...p,steam_max_game_bans:1},{...old,gameBans:2},t),'steam-game-banned');
 assert.equal(steamQualityRefusal({...p,steam_min_days_since_ban:90},{...old,gameBans:1,daysSinceLastBan:30},t),'steam-recent-ban');
 // The Web API client: three calls, parsed, cached.
 let calls=0;const fetchImpl=async u=>{calls++;const path=new URL(u).pathname;
  return {ok:true,json:async()=>path.includes('Summaries')?{response:{players:[{communityvisibilitystate:3,timecreated:1_500_000_000}]}}:path.includes('Level')?{response:{player_level:7}}:{players:[{NumberOfVACBans:1,NumberOfGameBans:0,DaysSinceLastBan:100}]}};};
 const q=createSteamQuality({apiKey:'k',fetchImpl});
 assert.deepEqual(await q.profile('76561197960287930'),{visible:true,createdAt:1_500_000_000_000,level:7,vacBans:1,gameBans:0,daysSinceLastBan:100});
 await q.profile('76561197960287930');assert.equal(calls,3);
 // Through central: Steam unreachable refuses only the server that set thresholds.
 const c=await central({providers:{},steamQuality:{enabled:true,profile:async()=>{throw Error('down');}}});
 try{
  const owner=await login(c,'owner'),a=await login(c,'alice'),s=await server(c,owner,'Pilot');
  c.db.addIdentity('steam','76561197960287930',a.player,c.clock.t);
  await act(c,owner)('POST',`/admin/servers/${s.id}/policy`,{requireSteam:true,steamMinLevel:5,steamMaxVacBans:0});
  assert.equal((await ticket(c,a,s.id)).data.error,'steam-check-unavailable');
  assert.equal((await act(c,owner)('POST',`/admin/servers/${s.id}/policy`,{steamMinLevel:-1})).data.error,'invalid-policy');
  const listed=(await c.call('GET','/servers')).data.servers[0];
  assert.deepEqual(listed.requirements,{minAccountAgeMinutes:0,steam:true,phone:false,steamQuality:{minAccountAgeDays:0,minLevel:5,maxVacBans:0,maxGameBans:-1,minDaysSinceBan:0}});
  assert.deepEqual(requirementLabels({...listed.requirements,minAccountAgeMinutes:2880}),['Account 2 days+','Steam linked','Steam level 5+','No VAC bans']);
  assert.deepEqual(requirementLabels({minAccountAgeMinutes:0,steam:false,phone:false}),[]);
 }finally{await c.close();}
});

test('identifiers of accounts from before this change are backfilled once', ()=>{
 const db=openCentralDb();
 db.createAccount({uuid:'00000000-0000-4000-8000-000000000001',username:'Old',email:'Old.Timer@gmail.com',at:1});
 db.addIdentity('discord','12345',  '00000000-0000-4000-8000-000000000001',1);
 const id=createIdentity({db,pepper:'p'});
 assert.deepEqual(db.identifiersFor('00000000-0000-4000-8000-000000000001').map(i=>i.kind).sort(),['discord','email']);
 assert.equal(db.identifiersFor('00000000-0000-4000-8000-000000000001').find(i=>i.kind==='email').value_hash,id.hash('email','oldtimer@gmail.com'));
 createIdentity({db,pepper:'p'});assert.equal(db.identifiersFor('00000000-0000-4000-8000-000000000001').length,2);
});
