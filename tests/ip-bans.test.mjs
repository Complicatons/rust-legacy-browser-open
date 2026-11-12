// IP logging and IP bans (central/ip-bans.mjs, ANTICHEAT-ADMIN-PLAN.md "Owner direction (2026-10-24)"): addresses
// from website requests and gateway redemptions, bans on an address or range, enforcement at join and in the gateway
// report, desktop addresses from the server adapter, visibility and retention. In-process HTTP behind a "loopback"
// trusted proxy so each request can carry its own client address (X-Forwarded-For).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {parseBanTarget,normaliseIp} from '../central/ip-bans.mjs';
import {createSigningKey,createAccountService} from '../bridge/admission.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../bridge/adapter.mjs';
import {createGatewayAdmission} from '../bridge/gateway.mjs';
import {listenServer} from '../bridge/listen.mjs';

const ORIGIN='https://play.example.test',DAY=86400e3;

async function central({ipRetentionDays}={}){
 const clock={t:1_800_000_000_000},db=openCentralDb();
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false,rateLimit:1000,trustedProxies:['loopback'],...(ipRetentionDays?{ipRetentionDays}:{})});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 async function call(method,path,{data,as,ip='198.51.100.1'}={}){
  const headers={origin:ORIGIN,'x-forwarded-for':ip};if(data!==undefined)headers['content-type']='application/json';
  if(as){headers.cookie=as.cookie;headers['x-csrf-token']=as.csrf;}
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
 // A ticket from the website (at `web`), redeemed by the server's gateway for a game connection from `game`.
 async function join(srv,who,{web='198.51.100.1',game=web}={}){
  const t=await call('POST',`/servers/${srv.id}/join-ticket`,{as:who,ip:web});
  if(t.status!==200)return {refused:t.data.error};
  try{return {claims:await srv.remote.redeemAdmission(t.data.ticket,{serverId:srv.id,ip:game})};}catch(e){return {refused:e.code};}
 }
 return {db,clock,base,call,login,server,join,close:()=>new Promise(r=>http.close(r))};
}
const roster=(...players)=>players.map(p=>({subject:p.player,name:p.name,playerId:1,score:0,flags:{},connectedAt:1}));

test('ban targets: single addresses and ranges, ::ffff: mapping, too-wide ranges and private addresses refused', ()=>{
 assert.deepEqual(normaliseIp('::ffff:203.0.113.9'),{ip:'203.0.113.9',version:4});
 assert.equal(normaliseIp('not an ip'),null);
 assert.equal(parseBanTarget('203.0.113.9').cidr,'203.0.113.9');
 assert.equal(parseBanTarget('203.0.113.0/24').cidr,'203.0.113.0/24');
 assert.equal(parseBanTarget('2001:DB8:1::/48').cidr,'2001:db8:1::/48');
 assert.equal(parseBanTarget('203.0.0.0/15').error,'range-too-wide');
 assert.equal(parseBanTarget('2001:db8::/31').error,'range-too-wide');
 for(const ip of ['127.0.0.1','10.0.0.5','172.16.4.4','192.168.1.1','100.64.0.1','::1','fd00::1','169.254.1.1'])assert.equal(parseBanTarget(ip).error,'unbannable-ip',ip);
 assert.equal(parseBanTarget('1.2.3.4/33').error,'invalid-ip');
 assert.equal(parseBanTarget('1.2.3.4/x').error,'invalid-ip');
});

test('addresses are logged from website pages, join tickets and gateway redemptions; IP bans refuse both join steps', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),cheater=await c.login('cheater'),friend=await c.login('friend');
  const s=await c.server(owner,'Alpha'),p=`/admin/servers/${s.id}`;
  await c.call('POST','/account/device',{as:cheater,ip:'198.51.100.7',data:{signals:{}}});
  const ok=await c.join(s,cheater,{web:'198.51.100.7',game:'203.0.113.50'});
  assert.equal(ok.claims.subject,cheater.player);
  const rows=c.db.raw.prepare('select ip,source,server_uuid from ip_log where player_uuid=? order by source').all(cheater.player).map(r=>[r.ip,r.source,r.server_uuid]);
  assert.deepEqual(rows,[['203.0.113.50','game',s.id],['198.51.100.7','website','']]);
  // The owner sees the game address on their server (website rows are platform staff only).
  assert.deepEqual((await c.call('GET',`${p}/ips?player=${cheater.player}`,{as:owner})).data.ips.map(r=>[r.ip,r.source]),[['203.0.113.50','game']]);
  // Ban the range the game address is in: new tickets from it and redemptions from it are refused.
  const ban=await c.call('POST',`${p}/ip-bans`,{as:owner,data:{ip:'203.0.113.0/24',reason:'aimbot'}});
  assert.equal(ban.status,201);assert.equal(ban.data.bans[0].cidr,'203.0.113.0/24');
  assert.equal((await c.join(s,cheater,{web:'203.0.113.51'})).refused,'ip-banned');                   // ticket from a banned address
  assert.equal((await c.join(s,friend,{web:'198.51.100.9',game:'203.0.113.77'})).refused,'ip-banned'); // ticket fine, game address banned
  assert.ok((await c.join(s,friend,{web:'198.51.100.9',game:'198.51.100.9'})).claims);                 // elsewhere: fine
  // Another server is not affected by a server ban; lifting it lets the address back in.
  const other=await c.server(owner,'Beta');
  assert.ok((await c.join(other,cheater,{web:'203.0.113.51'})).claims);
  assert.equal((await c.call('POST',`${p}/ip-unban`,{as:owner,data:{ban:ban.data.bans[0].id}})).status,200);
  assert.ok((await c.join(s,cheater,{web:'203.0.113.51'})).claims);
  const audit=(await c.call('GET',`${p}/audit`,{as:owner})).data.events.map(e=>e.action);
  assert.ok(audit.includes('admin.ip-ban')&&audit.includes('admin.ip-unban'));
 }finally{await c.close();}
});

test('IP bans: roles, scope, unbannable addresses, banning a player\'s addresses and the account-ban option', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),mod=await c.login('mod'),adm=await c.login('adm'),staff=await c.login('staff'),cheater=await c.login('cheater');
  c.db.addStaff(staff.player,c.clock.t);
  const s=await c.server(owner,'Alpha'),p=`/admin/servers/${s.id}`,other=await c.server(owner,'Beta');
  await c.call('POST',`${p}/roles`,{as:owner,data:{player:mod.player,role:'moderator'}});
  await c.call('POST',`${p}/roles`,{as:owner,data:{player:adm.player,role:'admin'}});
  await c.join(s,cheater,{game:'203.0.113.10'});await c.join(other,cheater,{game:'192.0.2.200'});
  // Moderators never see raw addresses or ban them.
  assert.equal((await c.call('GET',`${p}/ips?player=${cheater.player}`,{as:mod})).status,403);
  assert.equal((await c.call('POST',`${p}/ip-bans`,{as:mod,data:{ip:'192.0.2.1',reason:'x'}})).status,403);
  assert.equal((await c.call('POST',`${p}/bans`,{as:mod,data:{player:cheater.player,reason:'x',minutes:60,banIps:true}})).data.error,'insufficient-role');
  // Server admins see their own server only; platform staff see every server and website rows.
  assert.deepEqual((await c.call('GET',`${p}/ips?player=${cheater.player}`,{as:adm})).data.ips.map(r=>r.ip),['203.0.113.10']);
  assert.deepEqual((await c.call('GET',`${p}/ips?player=${cheater.player}`,{as:staff})).data.ips.map(r=>r.ip).sort(),['192.0.2.200','198.51.100.1','203.0.113.10']);
  assert.deepEqual((await c.call('GET',`${p}/ip-lookup?ip=192.0.2.200`,{as:adm})).data.accounts,[]);
  assert.equal((await c.call('GET',`${p}/ip-lookup?ip=192.0.2.200`,{as:staff})).data.accounts[0].name,'cheater');
  // Refusals: private/loopback (the gateway's own address), too-wide ranges, no reason, global by a server admin.
  for(const [data,error] of [[{ip:'127.0.0.1',reason:'x'},'unbannable-ip'],[{ip:'10.1.2.3',reason:'x'},'unbannable-ip'],[{ip:'203.0.0.0/8',reason:'x'},'range-too-wide'],[{ip:'203.0.113.10'},'reason-required']])
   assert.equal((await c.call('POST',`${p}/ip-bans`,{as:adm,data})).data.error,error);
  assert.equal((await c.call('POST',`${p}/ip-bans`,{as:adm,data:{ip:'203.0.113.10',reason:'x',scope:'global'}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`${p}/ip-bans`,{as:adm,data:{player:mod.player,reason:'x'}})).data.error,'no-ips'); // never played here
  // A player's addresses on this server (last 30 days), temporary.
  const r=await c.call('POST',`${p}/ip-bans`,{as:adm,data:{player:cheater.player,reason:'wallhack',minutes:60}});
  assert.equal(r.status,201);assert.deepEqual(r.data.bans.map(b=>b.cidr),['203.0.113.10']);
  assert.equal((await c.join(s,cheater,{game:'203.0.113.10'})).refused,'ip-banned');
  c.clock.t+=61*60e3;await s.remote.heartbeat({players:0,capacity:50});await other.remote.heartbeat({players:0,capacity:50});
  assert.ok((await c.join(s,cheater,{game:'203.0.113.10'})).claims); // expired
  // Account ban with banIps; platform staff may ban network-wide.
  const ab=await c.call('POST',`${p}/bans`,{as:owner,data:{player:cheater.player,reason:'aimbot',banIps:true}});
  assert.equal(ab.status,201);assert.deepEqual(ab.data.ipBans.map(b=>[b.cidr,b.scope]),[['203.0.113.10','server']]);
  const g=await c.call('POST',`${p}/ip-bans`,{as:staff,data:{ip:'192.0.2.0/24',reason:'ban evasion',scope:'global'}});
  assert.equal(g.status,201);
  const friend=await c.login('friend');
  assert.equal((await c.join(other,friend,{game:'192.0.2.9'})).refused,'ip-banned');
  assert.equal((await c.call('POST',`${p}/ip-unban`,{as:adm,data:{ban:g.data.bans[0].id}})).data.error,'insufficient-role');
  const listed=(await c.call('GET',`${p}/ip-bans`,{as:adm})).data.bans.map(b=>[b.cidr,b.scope,b.active]);
  assert.deepEqual(listed.sort(),[['192.0.2.0/24','global',true],['203.0.113.10','server',false],['203.0.113.10','server',true]]);
 }finally{await c.close();}
});

test('gateway report: browser players on a banned address are kicked; desktop addresses are logged and kicked by handle', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),cheater=await c.login('cheater'),honest=await c.login('honest');
  const s=await c.server(owner,'Alpha'),p=`/admin/servers/${s.id}`;
  await c.join(s,cheater,{game:'203.0.113.20'});await c.join(s,honest,{game:'198.51.100.30'});
  const desk={handle:'AAAAAAAAAAAAAAAA',name:'Desk',ip:'::ffff:192.0.2.44'},desk2={handle:'BBBBBBBBBBBBBBBB',name:'Other',ip:'198.51.100.31'};
  let r=await s.remote.report({players:roster(cheater,honest),flags:[],desktop:[desk,desk2]});
  assert.deepEqual(r.kicks,[]);assert.deepEqual(r.commands,[]);
  assert.deepEqual((await c.call('GET',`${p}/ips?handle=${desk.handle}`,{as:owner})).data.ips.map(x=>[x.ip,x.name]),[['192.0.2.44','Desk']]);
  assert.equal((await c.call('GET',`${p}/ip-lookup?ip=192.0.2.44`,{as:owner})).data.desktop[0].handle,desk.handle);
  // The roster the moderators' page reads never carries addresses.
  assert.equal(JSON.stringify((await c.call('GET',`${p}/players`,{as:owner})).data).includes('192.0.2.44'),false);
  // Banning the browser player's address kicks at once (queued) and on every report; the desktop handle gets one kick-native.
  await c.call('POST',`${p}/ip-bans`,{as:owner,data:{ip:'203.0.113.20',reason:'aimbot'}});
  await c.call('POST',`${p}/ip-bans`,{as:owner,data:{handle:desk.handle,reason:'aimbot'}});
  r=await s.remote.report({players:roster(cheater,honest),flags:[],desktop:[desk,desk2]});
  assert.deepEqual(r.kicks,[{subject:cheater.player,reason:'ip-banned'}]);
  assert.deepEqual(r.commands.map(x=>[x.action,x.handle,x.reason]),[['kick-native',desk.handle,'ip-banned']]);
  r=await s.remote.report({players:roster(cheater,honest),flags:[],desktop:[desk,desk2]});
  assert.deepEqual(r.commands,[]); // already sent within the minute
  c.clock.t+=61e3;r=await s.remote.report({players:roster(honest),flags:[],desktop:[desk]});
  assert.deepEqual(r.commands.map(x=>x.handle),[desk.handle]); // still there a minute later: kicked again
 }finally{await c.close();}
});

test('logged addresses are deleted after the retention period', async()=>{
 const c=await central({ipRetentionDays:30});
 try{
  const owner=await c.login('owner'),player=await c.login('player');
  const s=await c.server(owner,'Alpha');
  await c.join(s,player,{game:'203.0.113.60'});
  await s.remote.report({players:[],flags:[],desktop:[{handle:'CCCCCCCCCCCCCCCC',name:'Desk',ip:'192.0.2.60'}]});
  const count=()=>c.db.raw.prepare('select (select count(*) from ip_log)+(select count(*) from native_ip_log) as n').get().n;
  assert.equal(count(),3); // the join ticket (website), the redemption (game) and the desktop handle
  c.clock.t+=31*DAY;
  await s.remote.report({players:[],flags:[]});
  assert.equal(count(),0);
 }finally{await c.close();}
});

test('server adapter: desktop players keep their address; browser sessions never report the gateway\'s', async()=>{
 const clock={t:1_800_000_000_000},now=()=>clock.t,controlKey=randomBytes(32),SERVER='3f6c1b1e-0000-4000-8000-000000000001';
 const account=createAccountService({issuer:'https://accounts.example.test',keys:[createSigningKey('k1')],now});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities:createIdentityMap({namespace:{base:'90000000000000000',size:'1000000000'},isKnownNativeId:()=>false}),now});
 const sender=createControlSender(controlKey);
 const gateway=createGatewayAdmission({serverId:SERVER,account,sendControl:body=>adapter.handleControl(sender(body))});
 const join=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}),{ip:'203.0.113.5'});
 assert.ok(adapter.onNativeApproval({authBytes:join.authBytes,claimedUserId:join.backendId,connection:{}}).approved);
 adapter.setRoster([{id:join.backendId,name:'acct-1',ip:'127.0.0.1'},{id:'76561198000000002',name:'Desk',ip:'::ffff:192.0.2.8'},{id:'76561198000000003',name:'Bad',ip:'not-an-ip'}]);
 assert.deepEqual(adapter.desktopRoster().map(p=>[p.name,p.ip]),[['Desk','192.0.2.8'],['Bad',undefined]]);
});
