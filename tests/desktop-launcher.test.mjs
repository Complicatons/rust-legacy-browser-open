// Desktop launcher (DESKTOP-LAUNCHER-PLAN.md) against the mock stack: central + sidecar + mock uLink server + gateway.
// The "game" is a UlinkClient logging in natively with the ID and envelope the launcher core hands the steam_api proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {randomBytes,createHash} from 'node:crypto';
import {startStack,poll,ORIGIN} from './helpers/stack.mjs';
import {central} from './helpers/central-fixture.mjs';
import {UlinkClient} from '../bridge/ulink/session.mjs';
import {createLauncher,reasonText,REASONS} from '../launcher/core.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender,encodeEnvelope,parseEnvelope} from '../bridge/adapter.mjs';
import {admitUrlFor} from '../central/desktop.mjs';
import {validateConfig} from '../bridge/gateway-launcher.mjs';
import {pageFor} from '../central/site.mjs';
import {enrolGateway} from '../bridge/remote-account.mjs';

const within=(p,ms=5000)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(Error('timed out')),ms))]);
const PASSWORD='a long passphrase';

// The player's game: one native login with whatever the proxy got from the launcher.
async function game(port,{userId,ticket,name='Desktop'}){
 const socket=createSocket('udp4');await new Promise(r=>socket.bind(0,'127.0.0.1',r));
 const client=new UlinkClient({now:()=>performance.now()/1000,login:{userId:BigInt(userId),name,ticket:new Uint8Array(ticket)},send:b=>socket.send(b,port,'127.0.0.1')});
 socket.on('message',m=>client.receive(new Uint8Array(m)));
 const timer=setInterval(()=>client.tick(),5);
 const result=new Promise(r=>{client.on('approved',()=>r('approved'));client.on('denied',e=>r('denied:'+e));});
 client.start();
 const outcome=await within(result);
 return {outcome,close(){clearInterval(timer);client.close();socket.close();}};
}

function fakeHost(){
 const host={token:null,launches:[],loadToken:async()=>host.token,saveToken:async t=>{host.token=t;},launchGame:async a=>{host.launches.push(a);},openUrl:()=>{}};
 return host;
}

async function desktopStack(){
 const s=await startStack({gateway:{desktop:{publicHost:'game.pilot.example',publicPort:28015}}});
 const gatewayAdmit=`http://127.0.0.1:${s.gateway.port}/desktop/admit`;
 const launcher=(host=fakeHost())=>({host,core:createLauncher({centralUrl:s.centralUrl,host,resolveAdmitUrl:()=>gatewayAdmit,setTimer:()=>0,clearTimer:()=>{}})});
 const account=async name=>{const r=await s.call('POST','/auth/register',{data:{username:name,email:name.toLowerCase()+'@example.com',password:PASSWORD}});assert.equal(r.status,200);return {cookie:r.cookie,csrf:r.data.csrf,player:r.data.player};};
 return {...s,gatewayAdmit,launcher,account};
}

test('launcher: sign in, connect, launch, the game joins with the proxy envelope, sign-out ends the session in game', async()=>{
 const s=await desktopStack();
 try{
  await s.account('Rook');
  const {host,core}=s.launcher();
  const phases=[];core.on(st=>{if(phases.at(-1)!==st.phase)phases.push(st.phase);});
  assert.equal(await core.restore(),false,'nothing remembered yet');
  assert.equal(await core.signIn({login:'rook',password:'wrong password'}),false);
  assert.equal(core.state.error,'invalid-credentials');assert.match(reasonText(core.state.error),/not right/);
  assert.equal(await core.signIn({login:'rook@example.com',password:PASSWORD,remember:true}),true);
  assert.equal(core.state.account.name,'Rook');assert.ok(host.token,'remembered (DPAPI on Windows)');
  assert.deepEqual(core.state.servers.map(x=>x.id),[s.serverId]);

  assert.equal(await core.connect(s.serverId),true,core.state.error);
  const {backendId,native}=core.state.connection;
  assert.match(backendId,/^9\d{16}$/,'allocated in the operator namespace by the server, not by central');
  assert.deepEqual(native,{host:'game.pilot.example',port:28015},'the public game address from the gateway config');
  assert.equal(await core.launch(),true);
  assert.equal(core.state.phase,'in-game');assert.equal(host.launches[0].backendId,backendId);

  const games=[];
  try{
   // A fresh envelope with someone else's ID is refused (the proxy reports the server's ID; a tampered one fails).
   const other=await core.requestTicket();
   games.push(await game(s.native.port,{userId:'76561198000000001',ticket:Buffer.from(other.envelope,'base64')}));
   assert.equal(s.approvals.at(-1).result.reason,'identity-mismatch');
   // Inside DoConnect: the proxy asks for a ticket; the game sends UserID=backendId, ticket=RLBD envelope.
   const ticket=await core.requestTicket();
   assert.equal(ticket.backendId,backendId,'the same character every join');
   const envelope=Buffer.from(ticket.envelope,'base64');
   assert.equal(parseEnvelope(envelope).kind,'desktop');assert.equal(envelope.length,53);
   const g=await game(s.native.port,{userId:backendId,ticket:envelope,name:'Rook'});games.push(g);
   assert.equal(g.outcome,'approved');
   assert.equal(s.approvals.at(-1).result.kind,'desktop');
   assert.equal(s.adapter.stats().leases,1);
   // Replaying that envelope is refused, and no new admission is handed out while the character is in game.
   const replay=await game(s.native.port,{userId:backendId,ticket:envelope});games.push(replay);
   assert.equal(replay.outcome,'denied:154');assert.equal(s.approvals.at(-1).result.reason,'unknown-session');
   assert.equal(await core.requestTicket(),null);assert.equal(core.state.error,'already-connected');

   // A second launcher on the same account cannot join the same server.
   const second=s.launcher();await second.core.signIn({login:'Rook',password:PASSWORD});
   assert.equal(await second.core.connect(s.serverId),false);assert.equal(second.core.state.error,'in-use-elsewhere');

   // Heartbeat keeps the in-game lease.
   await core.beat();assert.ok(core.state.lastBeat);assert.equal(core.state.phase,'in-game');

   // Sign-out while the game is still on the server: central → /bridge/tasks → gateway → adapter → plugin kick.
   await core.signOut();
   assert.equal(core.state.phase,'signed-out');assert.equal(host.token,null);
   const kick=await poll(async()=>{const r=await s.plugin({type:'poll'});return r.commands?.find(c=>c.action==='kick-native');});
   assert.equal(kick.targetId,backendId);assert.equal(kick.reason,'signed-out');
   assert.deepEqual(phases,['signed-out','signing-in','signed-out','signing-in','signed-in','connecting','connected','launching','in-game','signing-out','signed-out']);
  }finally{for(const x of games)x.close();}
 }finally{await s.close();}
});

test('launcher: passes and tickets only work on their own path', async()=>{
 const s=await desktopStack();
 try{
  const a=await s.account('Ash');
  const tokenOf=async()=>(await fetch(s.centralUrl+'/desktop/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'Ash',password:PASSWORD})}).then(r=>r.json())).token;
  const token=await tokenOf(),auth={authorization:'Bearer '+token,'content-type':'application/json'};
  // A website (browser) join ticket at /desktop/admit is refused before it is consumed; so is a desktop pass on the WebSocket.
  const browserTicket=(await s.call('POST',`/servers/${s.serverId}/join-ticket`,{cookie:a.cookie,csrf:a.csrf,data:{}})).data.ticket;
  let r=await fetch(s.gatewayAdmit,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pass:browserTicket})});
  assert.equal(r.status,403);assert.equal((await r.json()).error,'unsupported-profile');
  const pass=(await fetch(`${s.centralUrl}/desktop/servers/${s.serverId}/pass`,{method:'POST',headers:auth,body:'{}'}).then(x=>x.json())).pass;
  const denied=await s.browser().connect({ticket:pass}).then(()=>null,e=>e.reason);
  assert.equal(denied,'unsupported-profile','desktop pass refused on the browser path');
  // Both were refused before being used up: each still works once on its own path.
  r=await fetch(s.gatewayAdmit,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pass})});
  assert.equal(r.status,200);
  assert.equal((await s.browser().connect({ticket:browserTicket})).world.hostname,'Pilot');
  // Garbage and missing bodies.
  assert.equal((await fetch(s.gatewayAdmit,{method:'POST',headers:{'content-type':'text/plain'},body:'x'})).status,415);
  assert.equal((await fetch(s.gatewayAdmit,{method:'POST',headers:{'content-type':'application/json'},body:'{"pass":1}'})).status,400);
  assert.equal((await fetch(`${s.centralUrl}/desktop/me`,{headers:{authorization:'Bearer '+'x'.repeat(43)}})).status,401);
 }finally{await s.close();}
});

test('central: device codes, heartbeat loss, revoke-all and bans end desktop leases', async()=>{
 const c=await central();
 try{
  const owner=await c.register('Owner'),player=await c.register('Wren');
  const srv=(await c.call('POST','/owner/servers',{cookie:owner.cookie,csrf:owner.data.csrf,data:{name:'Pilot',region:'eu',endpoint:'wss://pilot.example:8443/play'}})).data;
  const {credential}=await enrolGateway({baseUrl:c.base,code:srv.enrolmentCode});
  const bridge=(path,data={})=>fetch(c.base+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credential},body:JSON.stringify(data)}).then(async r=>({status:r.status,data:await r.json()}));
  await bridge('/bridge/heartbeat',{players:0,capacity:50});
  await c.call('POST',`/owner/servers/${srv.id}/publish`,{cookie:owner.cookie,csrf:owner.data.csrf,data:{listed:true}});
  const api=(method,path,token,data)=>fetch(c.base+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(data!==undefined?{'content-type':'application/json'}:{})},body:data!==undefined?JSON.stringify(data):undefined}).then(async r=>({status:r.status,data:await r.json()}));

  // Device code: a Steam/Discord account (no password) approves the launcher from a signed-in website session.
  const d=(await api('POST','/desktop/device',null,{device:'Gaming PC'})).data;
  assert.match(d.userCode,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await api('POST','/desktop/device/token',null,{deviceCode:d.deviceCode})).data.status,'pending');
  assert.equal((await c.call('POST','/desktop/device/approve',{cookie:player.cookie,data:{userCode:d.userCode}})).status,403,'CSRF required');
  const ok=await c.call('POST','/desktop/device/approve',{cookie:player.cookie,csrf:player.data.csrf,data:{userCode:d.userCode.replace('-','').toLowerCase()}});
  assert.equal(ok.status,200);assert.equal(ok.data.device,'Gaming PC');
  const t=(await api('POST','/desktop/device/token',null,{deviceCode:d.deviceCode})).data;
  assert.equal(t.status,'approved');assert.equal(t.name,'Wren');
  assert.equal((await api('POST','/desktop/device/token',null,{deviceCode:d.deviceCode})).status,400,'one use');

  // Pass → lease. admitUrl is the gateway's HTTPS twin of its registered endpoint.
  const p=await api('POST',`/desktop/servers/${srv.id}/pass`,t.token,{});
  assert.equal(p.status,200);assert.equal(p.data.admitUrl,'https://pilot.example:8443/desktop/admit');
  assert.equal(admitUrlFor('ws://127.0.0.1:9/play'),'http://127.0.0.1:9/desktop/admit');
  assert.equal((await bridge('/bridge/redeem',{ticket:p.data.pass})).data.error,'unsupported-profile','the browser route refuses desktop passes');
  const redeemed=await bridge('/bridge/redeem',{ticket:p.data.pass,kind:'desktop'});
  assert.equal(redeemed.data.profile,'legacy-1069-desktop-v1');
  assert.equal((await bridge('/bridge/redeem',{ticket:p.data.pass,kind:'desktop'})).data.error,'replayed');

  // Connected but not in game: losing the lease ends nothing on the server. In game: it does.
  await api('POST','/desktop/heartbeat',t.token,{serverId:srv.id,state:'connected'});
  c.clock.t+=61e3;
  assert.deepEqual((await bridge('/bridge/tasks')).data.tasks,[]);
  assert.equal((await api('POST','/desktop/heartbeat',t.token,{serverId:srv.id,state:'in-game'})).status,200,'a later beat takes the lease again');
  c.clock.t+=61e3;
  assert.deepEqual((await bridge('/bridge/tasks')).data.tasks,[{type:'desktop-ended',subject:player.data.player,reason:'heartbeat-lost'}]);
  assert.deepEqual((await bridge('/bridge/tasks')).data.tasks,[],'drained once');

  // "Sign out everywhere" on the website also signs the launcher out (and ends its in-game lease).
  await api('POST','/desktop/heartbeat',t.token,{serverId:srv.id,state:'in-game'});
  const sessions=(await c.call('GET','/account/desktop-sessions',{cookie:player.cookie})).data.sessions;
  assert.equal(sessions.length,1);assert.equal(sessions[0].device,'Gaming PC');assert.equal(sessions[0].state,'in-game');
  await c.call('POST','/account/sessions/revoke',{cookie:player.cookie,csrf:player.data.csrf,data:{}});
  assert.equal((await api('GET','/desktop/me',t.token)).status,401);
  assert.deepEqual((await bridge('/bridge/tasks')).data.tasks.map(x=>x.reason),['signed-out']);

  // A ban refuses passes and ends a live lease at the next heartbeat.
  await bridge('/bridge/heartbeat',{players:0,capacity:50});
  const login=(await api('POST','/desktop/login',null,{login:'wren',password:PASSWORD,device:'Laptop'})).data;
  await api('POST',`/desktop/servers/${srv.id}/pass`,login.token,{});
  await api('POST','/desktop/heartbeat',login.token,{serverId:srv.id,state:'in-game'});
  c.db.addBan({id:'b1',player:player.data.player,server:srv.id,reason:'test',by:owner.data.player,at:c.clock.t});
  const beat=await api('POST','/desktop/heartbeat',login.token,{serverId:srv.id,state:'in-game'});
  assert.equal(beat.status,409);assert.equal(beat.data.reason,'banned');
  assert.deepEqual((await bridge('/bridge/tasks')).data.tasks.map(x=>x.reason),['banned']);
  await bridge('/bridge/heartbeat',{players:0,capacity:50}); // the clock moved past the directory's staleness window
  assert.equal((await api('POST',`/desktop/servers/${srv.id}/pass`,login.token,{})).data.error,'banned');
  assert.equal((await api('POST','/desktop/heartbeat',login.token,{state:'nap'})).status,400);
  // The account page lists launchers and signs one out; another account cannot touch it.
  const listed=(await c.call('GET','/account/desktop-sessions',{cookie:player.cookie})).data.sessions;
  assert.deepEqual(listed.map(x=>x.device),['Laptop']);
  assert.equal((await c.call('POST','/account/desktop-sessions/revoke',{cookie:owner.cookie,csrf:owner.data.csrf,data:{id:listed[0].id}})).status,404);
  assert.equal((await c.call('POST','/account/desktop-sessions/revoke',{cookie:player.cookie,csrf:player.data.csrf,data:{id:listed[0].id}})).status,200);
  assert.equal((await api('GET','/desktop/me',login.token)).status,401);
 }finally{await c.close();}
});

test('adapter: desktop and browser envelopes never complete each other; end-desktop kicks only launcher logins', ()=>{
 const controlKey=randomBytes(32),send=createControlSender(controlKey);
 const adapter=createIdentityAdapter({serverId:'s1',controlKey,identities:createIdentityMap({namespace:{base:'900000',size:'1000'}})});
 const pending=(kind,subject='alice')=>{const sessionId=randomBytes(16),secret=randomBytes(32);
  const r=adapter.handleControl(send({type:'register-pending',kind,serverId:'s1',subject,joinId:'j-'+kind,sessionId:sessionId.toString('hex'),secretDigest:createHash('sha256').update(secret).digest('hex')}));
  return {...r,sessionId,secret};};
 const d=pending('desktop');assert.ok(d.ok);
 // Same session and secret, browser magic: refused.
 assert.equal(adapter.onNativeApproval({authBytes:encodeEnvelope({sessionId:d.sessionId,secret:d.secret,kind:'browser'}),claimedUserId:d.backendId,connection:'c1'}).reason,'wrong-kind');
 const d2=pending('desktop');
 const ok=adapter.onNativeApproval({authBytes:encodeEnvelope({sessionId:d2.sessionId,secret:d2.secret,kind:'desktop'}),claimedUserId:d2.backendId,connection:'c2'});
 assert.equal(ok.approved,true);assert.equal(ok.kind,'desktop');
 assert.equal(adapter.handleControl(send({type:'register-pending',kind:'tablet',serverId:'s1',subject:'bob',joinId:'x',sessionId:'0'.repeat(32),secretDigest:'0'.repeat(64)})).reason,'malformed');
 // end-desktop: kicks the launcher login; a browser or native holder of an ID is left alone.
 assert.deepEqual(adapter.handleControl(send({type:'end-desktop',serverId:'s1',subject:'alice',reason:'signed-out'})),{ok:true,kicked:true});
 const [kick]=adapter.takeCommands();assert.equal(kick.action,'kick-native');assert.equal(kick.targetId,d2.backendId);
 const b=pending('browser','bob');adapter.onNativeApproval({authBytes:encodeEnvelope({sessionId:b.sessionId,secret:b.secret}),claimedUserId:b.backendId,connection:'c3'});
 assert.deepEqual(adapter.handleControl(send({type:'end-desktop',serverId:'s1',subject:'bob'})),{ok:true,kicked:false});
 assert.deepEqual(adapter.handleControl(send({type:'end-desktop',serverId:'s1',subject:'nobody'})),{ok:true,kicked:false});
 // Read-only status for the host app.
 const st=adapter.handleControl(send({type:'status',serverId:'s1'}));
 assert.deepEqual(st.leases.map(l=>[l.kind,l.subject,l.backendId]),[['desktop','alice',d2.backendId],['browser','bob',b.backendId]]);
 assert.ok(st.leases.every(l=>Number.isFinite(l.since)));assert.deepEqual(st.reservations,[]);
 assert.deepEqual(st.desktopEnds.map(e=>[e.subject,e.kicked]),[['alice',true],['bob',false],['nobody',false]]);
 assert.equal(parseEnvelope(Buffer.from('RLBX')),null,'other magics stay on the native path');
 assert.equal(parseEnvelope(Buffer.concat([Buffer.from('RLBD'),Buffer.from([2])])).invalid,true);
});

test('website: the launcher code page is a page route, not the approve API', ()=>{
 assert.equal(pageFor('/desktop/approve'),'desktop-approve');
 assert.equal(pageFor('/desktop/device/approve'),null);
});

test('gateway config: desktop needs the public game address', ()=>{
 const base={serverId:'00000000-0000-4000-8000-000000000000',centralUrl:'https://c.example',credential:'x'.repeat(43),native:{host:'127.0.0.1',port:28015},allowedOrigins:[ORIGIN],sidecarUrl:'http://127.0.0.1:1',controlKeyHex:'ab'.repeat(32),listen:{host:'127.0.0.1'}};
 assert.deepEqual(validateConfig(base),[]);
 assert.deepEqual(validateConfig({...base,desktop:{publicHost:'game.example',publicPort:28015}}),[]);
 assert.ok(validateConfig({...base,desktop:{publicHost:'game.example'}}).some(e=>/publicPort/.test(e)));
 assert.ok(validateConfig({...base,desktop:{publicHost:'game.example',publicPort:1,leaseKick:'yes'}}).some(e=>/leaseKick/.test(e)));
});

test('central: /desktop/register makes a website account under the website\'s rules and signs the launcher in', async()=>{
 const c=await central();
 try{
  const staff=(await c.call('POST','/auth/login',{data:{subject:'staff',name:'staff'}}));c.db.addStaff(staff.data.player,c.clock.t);
  const owner=await c.register('Owner'),cheat=await c.register('Cheater','cheater@example.com');
  const srv=(await c.call('POST','/owner/servers',{cookie:owner.cookie,csrf:owner.data.csrf,data:{name:'Pilot',region:'eu',endpoint:'wss://pilot.example:8443/play'}})).data;
  // No Origin header: the launcher is a native app; the bearer token it gets back is the credential.
  const reg=data=>fetch(c.base+'/desktop/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:PASSWORD,device:'Gaming PC',...data})}).then(async r=>({status:r.status,data:await r.json()}));
  const accounts=()=>c.db.raw.prepare('select count(*) n from players').get().n,before=accounts();
  // The website's checks, in the website's order and with its codes.
  for(const [data,code,status] of [
   [{username:'Fern',email:'not-an-email'},'invalid-email',400],
   [{username:'x',email:'fern@example.com'},'invalid-username',400],
   [{username:'admin',email:'fern@example.com'},'reserved-username',400],
   [{username:'Fern',email:'fern@example.com',password:'short'},'password-too-short',400],
   [{username:'Fern',email:'fern@example.com',password:'fern@example.com'},'password-matches-name',400],
   [{username:'owner',email:'fern@example.com'},'username-taken',409],
   [{username:'Fern',email:'fern@mailinator.com'},'disposable-email',400],
   [{username:'Fern',email:'Owner+alt@Example.com'},'email-taken',409],
   [{username:'Fern',email:'fern@example.com',hwid:'v1:short'},'invalid-hwid',400],
  ]){const r=await reg(data);assert.equal(r.status,status,code);assert.equal(r.data.error,code);}
  assert.equal(accounts(),before,'nothing created by a refused sign-up');

  const hwid='v1:'+'H'.repeat(43);
  const ok=await reg({username:'Fern',email:'fern@example.com',hwid});
  assert.equal(ok.status,200);assert.equal(ok.data.name,'Fern');assert.match(ok.data.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(ok.data.heartbeatSeconds,15);
  assert.ok(!('cookie' in ok.data)&&!('csrf' in ok.data),'a bearer token, no website cookie');
  const me=await fetch(c.base+'/desktop/me',{headers:{authorization:'Bearer '+ok.data.token}}).then(r=>r.json());
  assert.equal(me.username,'Fern');assert.equal(me.player,ok.data.player);
  // A full website account: the same password signs in on the website, and the launcher shows in its list.
  const web=await c.call('POST','/auth/password',{data:{login:'fern@example.com',password:PASSWORD}});
  assert.equal(web.status,200);assert.equal(web.data.player,ok.data.player);
  assert.deepEqual((await c.call('GET','/account/desktop-sessions',{cookie:web.cookie})).data.sessions.map(s=>s.device),['Gaming PC']);
  const audit=c.db.recentAudit(ok.data.player,10).map(e=>e.action);
  assert.ok(audit.includes('player-created')&&audit.includes('desktop-signed-in'),audit.join());
  assert.deepEqual(c.db.raw.prepare('select kind from identifiers where player_uuid=? order by kind').all(ok.data.player).map(r=>r.kind),['email','hwid']);

  // A network ban reaches the next sign-up from the same PC, as it does for the same mailbox.
  const desk=await fetch(c.base+'/desktop/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'Cheater',password:PASSWORD,hwid:'v1:'+'B'.repeat(43)})}).then(r=>r.json());
  assert.ok(desk.token);
  await c.call('POST',`/admin/servers/${srv.id}/bans`,{cookie:staff.cookie,csrf:staff.data.csrf,data:{player:cheat.data.player,reason:'cheating',scope:'global'}});
  const again=await reg({username:'Fresh',email:'fresh@example.com',hwid:'v1:'+'B'.repeat(43)});
  assert.equal(again.status,403);assert.equal(again.data.error,'identity-banned');
  assert.ok(c.db.recentAudit('network',10).some(e=>e.action==='signup-refused'));
  assert.equal((await reg({username:'Fresh',email:'fresh@example.com'})).status,200,'the same sign-up from another PC');
 }finally{await c.close();}
});

test('central: /desktop/register shares the website sign-up rate limit', async()=>{
 const c=await central({rateLimit:2});
 try{
  const reg=n=>fetch(c.base+'/desktop/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'User'+n,email:`user${n}@example.com`,password:PASSWORD})}).then(r=>r.status);
  assert.equal(await reg(1),200);
  assert.equal((await c.register('Web2')).status,200,'the website form counts in the same bucket');
  assert.equal(await reg(3),429);
 }finally{await c.close();}
});

test('launcher: sign up in the launcher, remember the login name (never the password), hardware ID on every request', async()=>{
 const s=await desktopStack();
 try{
  const HW='v1:'+'Q'.repeat(43),sent=[];
  const host=Object.assign(fakeHost(),{login:'old name',hardwareId:async()=>HW,saveLogin:async l=>{host.login=l;}});
  const fetchImpl=(url,o)=>{sent.push({path:new URL(url).pathname,body:o.body?JSON.parse(o.body):null});return fetch(url,o);};
  const core=createLauncher({centralUrl:s.centralUrl,host,fetchImpl,resolveAdmitUrl:()=>s.gatewayAdmit,setTimer:()=>0,clearTimer:()=>{}});
  // Obvious gaps are caught before a request.
  assert.equal(await core.register({email:' ',username:'Moss',password:PASSWORD}),false);assert.equal(core.state.error,'invalid-email');
  assert.equal(await core.register({email:'moss@example.com',username:'',password:PASSWORD}),false);assert.equal(core.state.error,'invalid-username');
  assert.equal(await core.register({email:'moss@example.com',username:'Moss',password:'short'}),false);assert.equal(core.state.error,'password-too-short');
  assert.equal(sent.length,0);
  await s.account('Taken');
  assert.equal(await core.register({email:'moss@example.com',username:'taken',password:PASSWORD}),false);
  assert.equal(core.state.error,'username-taken');assert.equal(core.state.phase,'signed-out');assert.equal(host.login,'old name','nothing saved on a refusal');
  const phases=[];core.on(st=>{if(phases.at(-1)!==st.phase)phases.push(st.phase);});
  assert.equal(await core.register({email:'moss@example.com',username:'Moss',password:PASSWORD,remember:true,rememberLogin:true}),true,core.state.error);
  assert.deepEqual(phases,['signing-up','signed-in']);
  assert.equal(core.state.account.name,'Moss');assert.ok(host.token,'"Keep me signed in": the token (DPAPI on Windows)');
  assert.equal(host.login,'Moss','"Remember my email or username": the name chosen at sign-up');
  assert.ok(!JSON.stringify(host).includes(PASSWORD),'the password is never handed to the host to keep');
  const r=sent.findLast(x=>x.path==='/desktop/register');
  assert.deepEqual({...r.body,device:undefined},{email:'moss@example.com',username:'Moss',password:PASSWORD,hwid:HW,device:undefined});
  // The website account works on the website too.
  assert.equal((await s.call('POST','/auth/password',{data:{login:'Moss',password:PASSWORD}})).status,200);

  await core.signOut();assert.equal(host.login,'Moss','signing out keeps the remembered name');
  assert.equal(await core.signIn({login:'moss@example.com',password:PASSWORD,remember:false,rememberLogin:false}),true);
  assert.equal(host.login,null,'unticked: forgotten');assert.equal(host.token,null);
  assert.equal(await core.signIn({login:'moss@example.com',password:PASSWORD,rememberLogin:true}),true);
  assert.equal(host.login,'moss@example.com','the email or username as typed');
  assert.equal(await core.connect(s.serverId),true,core.state.error);
  for(const p of ['/desktop/login',`/desktop/servers/${s.serverId}/pass`])assert.equal(sent.findLast(x=>x.path===p).body.hwid,HW,p);
  // A host without a hardware ID (the browser demo, an older host) still works; the field is left out.
  const bare=createLauncher({centralUrl:s.centralUrl,host:fakeHost(),fetchImpl,setTimer:()=>0,clearTimer:()=>{}});
  assert.equal(await bare.signIn({login:'Moss',password:PASSWORD}),true);assert.equal('hwid' in sent.at(-2).body,false);
 }finally{await s.close();}
});

test('launcher: every sign-up and sign-in refusal has a sentence', ()=>{
 for(const code of ['invalid-email','invalid-username','reserved-username','username-taken','email-taken','disposable-email','password-too-short',
  'password-too-long','password-matches-name','identity-banned','held-for-review','invalid-hwid','rate-limited','account-suspended'])
  assert.ok(REASONS[code],code);
 assert.match(reasonText('disposable-email'),/email/);assert.doesNotMatch(reasonText('disposable-email'),/Discord/,'the launcher has no Discord sign-up');
});
