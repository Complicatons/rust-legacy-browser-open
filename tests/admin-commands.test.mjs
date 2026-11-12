// In-game admin actions and reports through the server adapter (ANTICHEAT-ADMIN-PLAN.md slice 3): adapter queue and
// outbox, central command/policy routes, and the full mock stack (the server plugin is played by the test).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createIdentityAdapter,createIdentityMap,createControlSender,ADMIN_ACTIONS} from '../bridge/adapter.mjs';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {startStack,poll} from './helpers/stack.mjs';
import {listenServer} from '../bridge/listen.mjs';

const ORIGIN='https://play.example.test';

test('adapter: commands resolve to server identities, are delivered once, results and reports go to the outbox', ()=>{
 const clock={t:1000},key=randomBytes(32),send=createControlSender(key);
 const [admin,player,unlinked]=[randomUUID(),randomUUID(),randomUUID()];
 const adapter=createIdentityAdapter({serverId:'srv',controlKey:key,now:()=>clock.t,identities:createIdentityMap({entries:[[admin,'900001'],[player,'900002']]})});
 const control=body=>adapter.handleControl(send({serverId:'srv',...body}));
 const id=()=>randomUUID();
 assert.equal(control({type:'admin-command',id:id(),action:'say',subject:player}).reason,'malformed'); // fixed action list only
 assert.equal(control({type:'admin-command',id:id(),action:'message',subject:player}).reason,'malformed');
 assert.equal(control({type:'admin-command',id:id(),action:'teleport-to',subject:unlinked,actorSubject:admin}).reason,'no-identity');
 assert.equal(control({type:'admin-command',id:id(),action:'teleport-to',subject:player,actorSubject:unlinked}).reason,'admin-not-on-server');
 const tp=id(),msg=id(),old=id();
 assert.equal(control({type:'admin-command',id:old,action:'ban-native',subject:player,reason:'aimbot'}).ok,true);
 clock.t+=61000; // the first command expires unseen
 assert.equal(control({type:'admin-command',id:tp,action:'teleport-to',subject:player,actorSubject:admin}).ok,true);
 assert.equal(control({type:'admin-command',id:msg,action:'message',subject:player,message:' stop '}).ok,true);
 assert.deepEqual(adapter.takeCommands(),[{id:tp,action:'teleport-to',targetId:'900002',actorId:'900001',reason:''},{id:msg,action:'message',targetId:'900002',reason:'',message:'stop'}]);
 assert.deepEqual(adapter.takeCommands(),[]);
 assert.equal(adapter.commandResult({id:tp,ok:true}),true);
 assert.equal(adapter.commandResult({id:msg,ok:false,reason:'player-offline'}),true);
 assert.equal(adapter.commandResult({id:'not-an-id',ok:true}),false);
 // /report: only characters mapped to a website account, once a minute.
 adapter.onNativeAuthenticated({backendId:'900001',connection:'conn:a'});adapter.onNativeAuthenticated({backendId:'555',connection:'conn:b'});
 assert.equal(adapter.report({connection:'conn:b',targetName:'x',text:'y'}).reason,'not-linked');
 assert.equal(adapter.report({connection:'conn:a',targetName:'Bob',targetId:'900002',text:'aimbot near the dome'}).ok,true);
 assert.equal(adapter.report({connection:'conn:a',targetName:'Bob',text:'again'}).reason,'cooldown');
 const {events}=control({type:'drain-events'});
 assert.deepEqual(events,[
  {type:'command-result',id:old,ok:false,reason:'expired'},
  {type:'command-result',id:tp,ok:true,reason:null},
  {type:'command-result',id:msg,ok:false,reason:'player-offline'},
  {type:'report',reporter:admin,target:player,targetName:'Bob',text:'aimbot near the dome'}]);
 assert.deepEqual(control({type:'drain-events'}).events,[]);
 assert.equal(adapter.handleControl({seq:999,body:{type:'drain-events',serverId:'srv'},mac:'forged'}).reason,'unauthenticated');
});

async function central(){
 const clock={t:1_800_000_000_000},db=openCentralDb();
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false,rateLimit:1000});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 const call=async(method,path,{data,as}={})=>{const headers={origin:ORIGIN};if(data!==undefined)headers['content-type']='application/json';if(as){headers.cookie=as.cookie;headers['x-csrf-token']=as.csrf;}const res=await fetch(base+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});return {status:res.status,data:await res.json()};};
 const login=async subject=>{const res=await fetch(base+'/auth/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({subject,name:subject})});const d=await res.json();return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:d.csrf,player:d.player,name:subject};};
 return {db,clock,base,call,login,close:()=>new Promise(r=>http.close(r))};
}
const row=p=>({subject:p.player,name:p.name,playerId:1,score:0,flags:{},connectedAt:1});

test('central: in-game commands follow roles, travel in report replies and record results; native bans mirror', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),mod=await c.login('mod'),cheater=await c.login('cheater');
  const created=(await c.call('POST','/owner/servers',{as:owner,data:{name:'Pilot',region:'eu',endpoint:'wss://p.example/play'}})).data;
  const remote=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code:created.enrolmentCode})).credential});
  const p=`/admin/servers/${created.id}`;
  await c.call('POST',`${p}/roles`,{as:owner,data:{player:mod.player,role:'moderator'}});
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{player:cheater.player,action:'teleport-to'}})).data.error,'server-offline');
  await remote.report({players:[row(cheater),row(mod)],flags:[]});
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{player:cheater.player,action:'bring'}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{player:cheater.player,action:'exec'}})).data.error,'invalid-action');
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{player:cheater.player,action:'message'}})).data.error,'message-required');
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{player:owner.player,action:'teleport-to'}})).data.error,'target-outranks-you');
  const tp=(await c.call('POST',`${p}/command`,{as:mod,data:{player:cheater.player,action:'teleport-to'}})).data.command;
  const msg=(await c.call('POST',`${p}/command`,{as:mod,data:{player:cheater.player,action:'message',message:'Stop flying.'}})).data.command;
  const ban=(await c.call('POST',`${p}/bans`,{as:owner,data:{player:cheater.player,reason:'fly hack',native:true}})).data.ban;
  assert.equal((await c.call('POST',`${p}/bans`,{as:owner,data:{player:mod.player,reason:'x',scope:'global',native:true}})).status,403);
  let r=await remote.report({players:[row(mod)],flags:[]});
  assert.deepEqual(r.commands.map(x=>[x.action,x.subject,x.actorSubject,x.message,x.reason]),[
   ['teleport-to',cheater.player,mod.player,undefined,undefined],['message',cheater.player,mod.player,'Stop flying.',undefined],['ban-native',cheater.player,owner.player,undefined,'fly hack']]);
  assert.deepEqual((await remote.report({players:[row(mod)],flags:[]})).commands,[]); // delivered once
  const native=r.commands[2].id;
  await remote.report({players:[row(mod)],flags:[],events:[{type:'command-result',id:tp,ok:true,reason:null},{type:'command-result',id:msg,ok:false,reason:'player-offline'},{type:'command-result',id:native,ok:true}]});
  const list=(await c.call('GET',`${p}/commands`,{as:mod})).data.commands;
  assert.deepEqual(list.map(x=>[x.action,x.status,x.reason]).sort(),[['ban-native','done',null],['message','failed','player-offline'],['teleport-to','done',null]]);
  // Unbanning a mirrored ban also removes it from the game server's list.
  await c.call('POST',`${p}/unban`,{as:owner,data:{ban:ban.id}});
  r=await remote.report({players:[row(mod)],flags:[]});
  assert.deepEqual(r.commands.map(x=>[x.action,x.subject]),[['unban-native',cheater.player]]);
  // Commands nobody delivered expire; a result for another server's command is ignored.
  const late=(await c.call('POST',`${p}/command`,{as:mod,data:{player:cheater.player,action:'teleport-to'}})).data.command;
  c.clock.t+=121e3;assert.deepEqual((await remote.report({players:[row(mod)],flags:[]})).commands,[]);
  assert.equal((await c.call('GET',`${p}/commands`,{as:mod})).data.commands.find(x=>x.id===late).reason,'expired');
  const audit=(await c.call('GET',`${p}/audit`,{as:owner})).data.events.map(e=>e.action);
  assert.ok(audit.includes('admin.command')&&audit.includes('admin.command-failed'));
 }finally{await c.close();}
});

test('central: in-game reports arrive through the gateway; join policy refuses new or Steam-less accounts', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),reporter=await c.login('reporter'),suspect=await c.login('suspect'),stranger=await c.login('stranger');
  const created=(await c.call('POST','/owner/servers',{as:owner,data:{name:'Pilot',region:'eu',endpoint:'wss://p.example/play'}})).data;
  const remote=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code:created.enrolmentCode})).credential});
  const p=`/admin/servers/${created.id}`;
  await remote.heartbeat({players:0,capacity:50});await c.call('POST',`/owner/servers/${created.id}/publish`,{as:owner,data:{listed:true}});
  await remote.report({players:[row(reporter),row(suspect)],flags:[],events:[
   {type:'report',reporter:reporter.player,targetName:'Suspect',text:'speed hacking at the dome'},
   {type:'report',reporter:reporter.player,target:reporter.player,targetName:'reporter',text:'self'},
   {type:'report',reporter:'not-a-uuid',targetName:'x'}]});
  const reports=(await c.call('GET',`${p}/reports`,{as:owner})).data.reports;
  assert.deepEqual(reports.map(r=>[r.name,r.player,r.reporterName,r.reason,r.detail]),[['Suspect',suspect.player,'reporter','in-game','speed hacking at the dome']]);
  // Policy: admins only; enforced on tickets and on redemption of a ticket issued before the change.
  const ticket=who=>c.call('POST',`/servers/${created.id}/join-ticket`,{as:who});
  const early=(await ticket(stranger)).data.ticket;
  assert.equal((await c.call('POST',`${p}/policy`,{as:owner,data:{minAccountAgeMinutes:-1,requireSteam:false}})).data.error,'invalid-policy');
  assert.equal((await c.call('POST',`${p}/policy`,{as:owner,data:{minAccountAgeMinutes:60,requireSteam:false}})).status,200);
  assert.equal((await ticket(stranger)).data.error,'account-too-new');
  await assert.rejects(remote.redeemAdmission(early,{serverId:created.id}),e=>e.code==='account-too-new');
  assert.deepEqual((await c.call('GET','/servers')).data.servers[0].requirements,{minAccountAgeMinutes:60,steam:false,phone:false}); // players see it before joining
  assert.deepEqual((await c.call('GET',`${p}/policy`,{as:owner})).data,{minAccountAgeMinutes:60,requireSteam:false,requirePhone:false,steamMinAgeDays:0,steamMinLevel:0,steamMaxVacBans:-1,steamMaxGameBans:-1,steamMinDaysSinceBan:0,screenshotAutoSeverity:40});
  c.clock.t+=61*60e3;await remote.heartbeat({players:0,capacity:50});
  assert.equal((await ticket(stranger)).status,200);
  await c.call('POST',`${p}/policy`,{as:owner,data:{minAccountAgeMinutes:0,requireSteam:true}});
  assert.equal((await ticket(stranger)).data.error,'steam-required');
  c.db.addIdentity('steam','76561198000000001',stranger.player,c.clock.t);
  assert.equal((await ticket(stranger)).status,200);
  assert.ok((await c.call('GET',`${p}/audit`,{as:owner})).data.events.some(e=>e.action==='admin.policy'&&e.detail.requireSteam===true));
 }finally{await c.close();}
});

test('full stack: website teleport and native ban reach the server plugin; /report reaches the admin page', async()=>{
 const s=await startStack();
 try{
  const owner=s.owner,cheater=await s.login('cheater'),admin=`/admin/servers/${s.serverId}`;
  const join=async who=>{const {ticket}=(await s.call('POST',`/servers/${s.serverId}/join-ticket`,{cookie:who.cookie,csrf:who.csrf})).data;await s.browser().connect({ticket});return {peer:[...s.native.peers.values()].at(-1),backendId:s.approvals.at(-1).userId.toString()};};
  const ownerGame=await join(owner),cheaterGame=await join(cheater);
  await poll(async()=>(await s.call('GET',`${admin}/players`,{cookie:owner.cookie})).data.players.length===2);
  const {command}=(await s.call('POST',`${admin}/command`,{cookie:owner.cookie,csrf:owner.csrf,data:{player:cheater.player,action:'teleport-to'}})).data;
  // The plugin polls the sidecar: the command arrives with this server's identities, never account ids.
  const [delivered]=await poll(async()=>{const r=await s.plugin({type:'poll'});return r.commands?.length?r.commands:null;});
  assert.deepEqual(delivered,{id:command,action:'teleport-to',targetId:cheaterGame.backendId,actorId:ownerGame.backendId,reason:''});
  assert.equal((await s.plugin({type:'command-result',id:command,ok:true})).ok,true);
  await poll(async()=>(await s.call('GET',`${admin}/commands`,{cookie:owner.cookie})).data.commands.find(c=>c.id===command)?.status==='done');
  // Native ban mirror for a server ban.
  await s.call('POST',`${admin}/bans`,{cookie:owner.cookie,csrf:owner.csrf,data:{player:cheater.player,reason:'fly hack',minutes:60,native:true}});
  const [nativeBan]=await poll(async()=>{const r=await s.plugin({type:'poll'});return r.commands?.length?r.commands:null;});
  assert.deepEqual([nativeBan.action,nativeBan.targetId,nativeBan.reason],['ban-native',cheaterGame.backendId,'fly hack']);
  // /report from the owner's (browser, hence linked) character about the other player.
  assert.equal((await s.plugin({type:'report',connectionId:ownerGame.peer.cid,targetName:'Cheater',targetId:cheaterGame.backendId,text:'flying over my base'})).ok,true);
  const report=await poll(async()=>(await s.call('GET',`${admin}/reports`,{cookie:owner.cookie})).data.reports[0]);
  assert.deepEqual([report.player,report.reporterName,report.reason,report.detail],[cheater.player,'owner','in-game','flying over my base']);
 }finally{await s.close();}
});

test('adapter: desktop players reach central as opaque handles and can be targeted by handle', ()=>{
 const clock={t:1000},key=randomBytes(32),send=createControlSender(key),linked=randomUUID(),browserSubject=randomUUID();
 const adapter=createIdentityAdapter({serverId:'srv',controlKey:key,now:()=>clock.t,identities:createIdentityMap({entries:[[linked,'76561198000000001'],[browserSubject,'900009']]})});
 const control=body=>adapter.handleControl(send({serverId:'srv',...body}));
 assert.equal(control({type:'drain-events'}).desktop,null); // the plugin has not listed anyone yet
 assert.equal(adapter.setRoster([{id:'76561198000000001',name:'Linked'},{id:'76561198000000002',name:'Desk'},{id:'bad',name:'x'}]),true);
 assert.equal(adapter.setRoster(Array(501).fill({id:'1',name:'x'})),false);
 const desktop=control({type:'drain-events'}).desktop;
 assert.deepEqual(desktop.map(p=>[p.name,p.subject]),[['Linked',linked],['Desk',undefined]]);
 for(const p of desktop)assert.match(p.handle,/^[A-Za-z0-9_-]{16}$/);
 assert.ok(!JSON.stringify(desktop).includes('76561198'),'native IDs never leave the adapter');
 // Handles are stable for a server key and differ between servers.
 adapter.setRoster([{id:'76561198000000002',name:'Desk'}]);
 assert.equal(control({type:'drain-events'}).desktop[0].handle,desktop[1].handle);
 const other=createIdentityAdapter({serverId:'srv',controlKey:randomBytes(32)});other.setRoster([{id:'76561198000000002',name:'Desk'}]);
 assert.notEqual(other.desktopRoster()[0].handle,desktop[1].handle);
 const kick=randomUUID();
 assert.equal(control({type:'admin-command',id:kick,action:'kick-native',handle:desktop[1].handle,reason:'wallhack'}).ok,true);
 assert.equal(control({type:'admin-command',id:randomUUID(),action:'kick-native',handle:'AAAAAAAAAAAAAAAA'}).reason,'unknown-handle');
 assert.deepEqual(adapter.takeCommands(),[{id:kick,action:'kick-native',targetId:'76561198000000002',reason:'wallhack'}]);
 clock.t+=31000;assert.equal(control({type:'drain-events'}).desktop,null); // a stale roster is not reported
});

test('central: desktop roster, handle commands with role limits, and lifting a server-list ban later', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),mod=await c.login('mod'),adm=await c.login('adm');
  const created=(await c.call('POST','/owner/servers',{as:owner,data:{name:'Pilot',region:'eu',endpoint:'wss://p.example/play'}})).data;
  const remote=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code:created.enrolmentCode})).credential});
  const p=`/admin/servers/${created.id}`;
  await c.call('POST',`${p}/roles`,{as:owner,data:{player:mod.player,role:'moderator'}});await c.call('POST',`${p}/roles`,{as:owner,data:{player:adm.player,role:'admin'}});
  const desk={handle:'DeskHandle000001',name:'Desk'},ownerDesk={handle:'OwnerHandle00001',name:'OwnerDesk',subject:owner.player};
  await remote.report({players:[],flags:[],desktop:[desk,ownerDesk,{handle:'bad',name:'x'}]});
  const live=(await c.call('GET',`${p}/players`,{as:mod})).data;
  assert.deepEqual(live.desktop.map(d=>[d.name,d.account,d.player]),[['Desk',null,null],['OwnerDesk','owner',owner.player]]);
  // Reports without a desktop list keep the last one.
  await remote.report({players:[],flags:[]});assert.equal((await c.call('GET',`${p}/players`,{as:mod})).data.desktop.length,2);
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{handle:desk.handle,action:'kick-native'}})).data.error,'reason-required');
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{handle:desk.handle,action:'ban-native',reason:'esp'}})).data.error,'insufficient-role');
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{handle:ownerDesk.handle,action:'kick-native',reason:'x'}})).data.error,'target-outranks-you'); // linked: rank applies
  assert.equal((await c.call('POST',`${p}/command`,{as:mod,data:{handle:'NotListed0000001',action:'kick-native',reason:'x'}})).data.error,'unknown-player');
  const kick=(await c.call('POST',`${p}/command`,{as:mod,data:{handle:desk.handle,action:'kick-native',reason:'speed hack'}})).data.command;
  const ban=(await c.call('POST',`${p}/command`,{as:adm,data:{handle:desk.handle,action:'ban-native',reason:'esp'}})).data.command;
  let r=await remote.report({players:[],flags:[],desktop:[desk]});
  assert.deepEqual(r.commands.map(x=>[x.action,x.handle,x.subject,x.reason]),[['kick-native',desk.handle,undefined,'speed hack'],['ban-native',desk.handle,undefined,'esp']]);
  await remote.report({players:[],flags:[],desktop:[],events:[{type:'command-result',id:kick,ok:true},{type:'command-result',id:ban,ok:true}]});
  const list=(await c.call('GET',`${p}/commands`,{as:mod})).data.commands;
  assert.deepEqual(list.map(x=>[x.action,x.name,x.desktop,x.status]).sort(),[['ban-native','Desk',true,'done'],['kick-native','Desk',true,'done']]);
  // The banned player is gone from the roster; the ban can still be lifted by its handle.
  assert.equal((await c.call('POST',`${p}/command`,{as:adm,data:{handle:desk.handle,action:'kick-native',reason:'x'}})).data.error,'unknown-player');
  assert.equal((await c.call('POST',`${p}/command`,{as:adm,data:{handle:desk.handle,action:'unban-native',reason:'appeal accepted'}})).status,202);
  r=await remote.report({players:[],flags:[],desktop:[]});
  assert.deepEqual(r.commands.map(x=>[x.action,x.handle]),[['unban-native',desk.handle]]);
  assert.ok((await c.call('GET',`${p}/audit`,{as:owner})).data.events.some(e=>e.action==='admin.command'&&e.detail.name==='Desk'&&e.detail.reason==='esp'));
 }finally{await c.close();}
});

test('full stack: the plugin lists a desktop player, the admin kicks it from the website', async()=>{
 const s=await startStack();
 try{
  const owner=s.owner,admin=`/admin/servers/${s.serverId}`;
  // The plugin's poll carries the player list; the gateway's next report forwards the handle roster.
  await s.plugin({type:'poll',players:[{id:'76561198000000042',name:'Desk Player'}]});
  const row=await poll(async()=>(await s.call('GET',`${admin}/players`,{cookie:owner.cookie})).data.desktop?.[0]);
  assert.deepEqual([row.name,row.account],['Desk Player',null]);
  const {command}=(await s.call('POST',`${admin}/command`,{cookie:owner.cookie,csrf:owner.csrf,data:{handle:row.handle,action:'kick-native',reason:'wallhack report'}})).data;
  const [delivered]=await poll(async()=>{const r=await s.plugin({type:'poll'});return r.commands?.length?r.commands:null;});
  assert.deepEqual(delivered,{id:command,action:'kick-native',targetId:'76561198000000042',reason:'wallhack report'});
  await s.plugin({type:'command-result',id:command,ok:true});
  await poll(async()=>(await s.call('GET',`${admin}/commands`,{cookie:owner.cookie})).data.commands.find(c=>c.id===command)?.status==='done');
 }finally{await s.close();}
});

// Neither server adapter can run here (no game DLLs on the host), so this pins them to each other and to the bridge's
// fixed list: same actions, same original server calls per action, same failure reasons.
test('server adapters: the Oxide plugin and the vanilla patch adapter run the same admin actions the same way', ()=>{
 const runCommand=file=>{
  const src=readFileSync(new URL(`../adapter/${file}`,import.meta.url),'utf8'),start=src.indexOf('RunCommand(');
  const body=src.slice(start,src.indexOf('default:',start)),actions={};
  let pending=[];
  for(const part of body.split(/(?=case ")/).slice(1)){
   const name=part.match(/^case "([a-z-]+)":/)[1],code=part.slice(part.indexOf(':')+1).trim();
   pending.push(name);
   if(!code)continue; // falls through to the next label
   for(const n of pending)actions[n]=code;
   pending=[];
  }
  const returned=(body.match(/return [^;]*;/g)||[]).flatMap(r=>r.match(/"[a-z-]+"/g)||[]);
  return {actions,reasons:[...new Set(returned)].sort()};
 };
 const oxide=runCommand('RustLegacyBrowser.cs'),vanilla=runCommand('vanilla/RustLegacyBrowserVanilla.cs');
 const calls={
  'teleport-to':['RustServerManagement.Get()','TeleportPlayerToPlayer(actor.networkPlayer, target.networkPlayer)'],
  bring:['RustServerManagement.Get()','TeleportPlayerToPlayer(target.networkPlayer, actor.networkPlayer)'],
  message:['"Admin"'],
  'kick-native':['Kick(NetError.Facepunch_Kick_RCON, true)'],
  'ban-native':['BanList.Add(targetId,','BanList.Save()','Kick(NetError.Facepunch_Kick_RCON, true)'],
  'unban-native':['BanList.Remove(targetId)','BanList.Save()'],
 };
 assert.deepEqual(Object.keys(calls).sort(),Object.keys(ADMIN_ACTIONS).sort());
 for(const [name,adapter] of [['oxide',oxide],['vanilla',vanilla]]){
  assert.deepEqual(Object.keys(adapter.actions).sort(),Object.keys(ADMIN_ACTIONS).sort(),name);
  for(const [action,expected] of Object.entries(calls))
   for(const call of expected)assert.ok(adapter.actions[action].includes(call),`${name} ${action}: ${call}`);
 }
 assert.deepEqual(vanilla.reasons,oxide.reasons);
});

// The sidecar refuses a seq at or below the last one (tests/sidecar.test.mjs), so a request that overtakes an earlier
// one makes the earlier one fail. Both adapters therefore queue posts and keep one request in flight, numbering each as
// it goes out. Pinned from the sources for the same reason as above.
test('server adapters: plugin posts go to the sidecar one at a time, numbered as they are sent', ()=>{
 // Method body by brace matching, with string and char literals blanked so "}" inside them does not count.
 const method=(src,signature)=>{
  const at=src.indexOf(signature);assert.ok(at>=0,'missing '+signature);
  const code=src.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)'/g,m=>m[0]+' '.repeat(m.length-2)+m[0]);
  let i=code.indexOf('{',at),depth=0;const start=i;
  for(;i<code.length;i++){if(code[i]==='{')depth++;else if(code[i]==='}'&&--depth===0)break;}
  return src.slice(start,i+1);
 };
 const read=file=>readFileSync(new URL(`../adapter/${file}`,import.meta.url),'utf8');
 const count=(s,x)=>s.split(x).length-1;
 // Vanilla: Post only queues; one ThreadPool sender drains the queue, sending synchronously.
 const v=read('vanilla/RustLegacyBrowserVanilla.cs');
 const vPost=method(v,'static void Post(string body'),vDrain=method(v,'static void SendQueued()'),vSend=method(v,'static JsonData Send(string body)');
 assert.equal(count(v,'++seq'),1);assert.ok(vSend.includes('++seq'),'seq is stamped when the request goes out');
 assert.ok(vPost.includes('outgoing.Enqueue')&&vPost.includes('if (sending) return;')&&vPost.includes('QueueUserWorkItem(_ => SendQueued())'));
 assert.ok(!/\+\+seq|WebRequest\.Create|GetResponse/.test(vPost),'Post itself sends nothing');
 assert.equal(count(v,'QueueUserWorkItem'),1,'only Post starts the sender');
 assert.ok(vDrain.includes('while (true)')&&vDrain.includes('Send(next.Key)')&&vDrain.includes('sending = false'));
 assert.equal(count(v,'Send(next.Key)'),1);
 assert.ok(vSend.includes('request.GetResponse()')&&!/Begin(GetResponse|GetRequestStream)/.test(v),'each send blocks until its reply');
 // Oxide: Post only queues; SendNext sends one and starts the next from the reply callback (or a failed enqueue).
 const o=read('RustLegacyBrowser.cs');
 const oPost=method(o,'void Post(Dictionary<string, object> body'),oNext=method(o,'void SendNext()');
 assert.equal(count(o,'++seq'),1);assert.ok(oNext.includes('++seq'));
 assert.ok(oPost.includes('outgoing.Enqueue')&&oPost.includes('if (!sending) SendNext();'));
 assert.ok(!/\+\+seq|EnqueuePost/.test(oPost),'Post itself sends nothing');
 assert.equal(count(o,'EnqueuePost('),1);assert.equal(count(oNext,'EnqueuePost('),1);
 assert.equal(count(oNext,'finally { SendNext(); }'),2,'the next request starts after the reply, also when the callback or the enqueue throws');
 assert.ok(oNext.includes('sending = false'));
});

test('adapter: desktop players are scored from server-side positions; respawns and admin teleports reset, jumps are flagged', ()=>{
 const clock={t:1_800_000_000_000},key=randomBytes(32),send=createControlSender(key),admin=randomUUID();
 const adapter=createIdentityAdapter({serverId:'srv',controlKey:key,now:()=>clock.t,identities:createIdentityMap({entries:[[admin,'900001']]})});
 const control=body=>adapter.handleControl(send({serverId:'srv',...body}));
 // Desktop players as the plugin lists them (browser players are listed too, but their leases keep them out of scoring); 'Idle' has no character yet.
 const sample=(pos,life='1')=>{clock.t+=2000;adapter.setRoster([{id:'76561198000000007',name:'Desk',pos,life},{id:'76561198000000008',name:'Idle'}]);};
 const flags=()=>control({type:'drain-events'}).events.filter(e=>e.type==='desktop-flag');
 sample([0,10,0]);for(let i=1;i<=20;i++)sample([i*14,10,0]); // 7 m/s for 40 s: within the sprint budget
 assert.deepEqual(flags(),[]);
 assert.equal(adapter.stats().watches,1);
 // Respawn at a sleeping bag 2 km away: a new character object, so no teleport.
 sample([2000,30,2000],'2');sample([2010,30,2000],'2');
 assert.deepEqual(flags(),[]);
 sample([2400,30,2000],'2'); // 390 m in one 2 s sample
 const [tp]=flags();
 assert.equal(tp.kind,'teleport');assert.equal(tp.name,'Desk');assert.match(tp.handle,/^[A-Za-z0-9_-]{16}$/);assert.ok(tp.replay.length>3);
 assert.ok(!JSON.stringify(tp).includes('76561198'),'native IDs never leave the adapter');
 // Flying straight up over several samples.
 for(let i=1;i<=3;i++)sample([2010,30+i*6,2000],'2');
 assert.ok(flags().some(f=>f.kind==='fly'));
 const row=control({type:'drain-events'}).desktop.find(p=>p.name==='Desk');
 assert.ok(row.score>=60&&row.flags.teleport===1&&row.flags.fly>=1,JSON.stringify(row));
 // A website Bring moves the character server-side before the next poll: that jump is a new baseline, not a teleport.
 assert.equal(control({type:'admin-command',id:randomUUID(),action:'bring',handle:row.handle,actorSubject:admin}).ok,true);
 assert.deepEqual(adapter.takeCommands().map(c=>c.action),['bring']);
 sample([5000,30,5000],'2');sample([5010,30,5000],'2');sample([5020,30,5000],'2');
 assert.deepEqual(flags(),[],'the brought player is not flagged, and later moves are scored from the new place');
 sample([5900,30,5000],'2');assert.deepEqual(flags().map(f=>f.kind),['teleport'],'only the next sample is excused');
 clock.t+=2000;adapter.setRoster([]);assert.equal(adapter.stats().watches,0); // left: forgotten
});

test('central: desktop flags become evidence and scores on the admin page', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner');
  const created=(await c.call('POST','/owner/servers',{as:owner,data:{name:'Pilot',region:'eu',endpoint:'wss://p.example/play'}})).data;
  const remote=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code:created.enrolmentCode})).credential});
  const p=`/admin/servers/${created.id}`,handle='DeskHandle000007';
  await remote.report({players:[],flags:[],desktop:[{handle,name:'Desk',score:65,flags:{teleport:1,fly:1}}],events:[
   {type:'desktop-flag',handle,name:'Desk',kind:'teleport',severity:40,score:40,at:c.clock.t,detail:{distance:390},replay:[{t:0,kind:'move',pos:[2010,30,2000]},{t:2,kind:'move',pos:[2400,30,2000]}]},
   {type:'desktop-flag',handle:'bad',name:'x',kind:'teleport'},{type:'desktop-flag',handle,name:'Desk',kind:'NOT OK'}]});
  const [row]=(await c.call('GET',`${p}/players`,{as:owner})).data.desktop;
  assert.deepEqual([row.name,row.score,row.review,row.flags],['Desk',65,true,{teleport:1,fly:1}]);
  const {flags}=(await c.call('GET',`${p}/desktop-flags?handle=${handle}`,{as:owner})).data;
  assert.deepEqual(flags.map(f=>[f.kind,f.detail.detail.distance,f.detail.replay.length]),[['teleport',390,2]]);
  assert.equal((await c.call('GET',`${p}/desktop-flags?handle=../../x`,{as:owner})).data.error,'invalid-handle');
 }finally{await c.close();}
});
