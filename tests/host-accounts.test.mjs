// Host app Accounts page end to end on the demo stack (our website, sidecar and gateway + the mock game server):
// the overview merges the adapter's links with the website's names, an unlink goes to the adapter and reaches the
// website through the gateway's normal report, a bad key is refused. No original binaries, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {prepareDemo} from '../host/demo.mjs';
import {startService} from '../host/service.mjs';
import {loadHostConfig} from '../host/config.mjs';
import {freeTcpPorts,freeUdpPort} from './helpers/ports.mjs';

// Picked per run (helpers/ports.mjs): fixed numbers collide with other test files' ephemeral sockets.
let ports;
const until=async(pred,ms=30000,what='condition')=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,250));}throw Error(what+' not met');};
function call(path,{method='GET',body,cookie}={}){
 return new Promise((res,rej)=>{
  const headers={host:`127.0.0.1:${ports.host}`,...(cookie?{cookie}:{}),...(method==='POST'?{origin:`http://127.0.0.1:${ports.host}`,'x-rlb-host':'1','content-type':'application/json'}:{})};
  const req=request({host:'127.0.0.1',port:ports.host,path,method,headers},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res({status:r.statusCode,headers:r.headers,json:JSON.parse(b||'null')}));});
  req.on('error',rej);if(body)req.write(JSON.stringify(body));req.end();
 });
}

test('Accounts, Players and Anti-cheat on the demo stack: links with names, unlink reaches the website, evidence, kick/ban/unban, route list, bad keys',{timeout:120000},async()=>{
 const [host,central,sidecar,gateway]=await freeTcpPorts(4);ports={host,central,sidecar,gateway,server:await freeUdpPort()};
 const dir=mkdtempSync(join(tmpdir(),'rlb-host-acc-'));
 let svc;
 try{
  const file=await prepareDemo(dir,{ports,watchdog:{enabled:false,hangSeconds:90,graceSeconds:300,probeEveryMs:5000}});
  const printed=[];svc=await startService(loadHostConfig(file),{log:l=>printed.push(l),console:false});
  // Under the service wrapper (no console) the log never gets the sign-in link with the token.
  assert.ok(printed.length&&!printed.join('\n').includes(svc.token),'no token in the service log');
  const login=await call('/api/login',{method:'POST',body:{token:svc.token}}),cookie=login.headers['set-cookie'][0].split(';')[0];
  await svc.host.act('start','all');
  await until(()=>svc.host.status().components.every(c=>c.state==='running'),60000,'stack running').catch(e=>{throw Error(e.message+': '+svc.host.status().components.map(c=>c.name+'='+c.state+' '+c.message).join('; '));});
  let o=(await call('/api/accounts',{cookie})).json;
  assert.equal(o.adapter.ok,true);assert.equal(o.central.ok,true);assert.equal(o.hasKey,true);
  assert.equal(o.adapter.identities.count,3);
  const byName=Object.fromEntries(o.accounts.map(a=>[a.name,a]));
  assert.deepEqual(Object.keys(byName).sort(),['Demo desktop player','Demo player 1','Demo player 2']);
  assert.equal(byName['Demo desktop player'].kind,'desktop');assert.equal(byName['Demo desktop player'].backendId,'76561190000000301');
  assert.equal(byName['Demo player 1'].kind,'browser');assert.ok(byName['Demo player 1'].lastSeen);
  assert.equal(o.linkRequests[0].status,'linked');
  // Unlink needs a reason; then the adapter drops it, and the gateway's next report tells the website.
  const desk=byName['Demo desktop player'];
  assert.equal((await call('/api/accounts/unlink',{method:'POST',cookie,body:{subject:desk.subject,reason:''}})).status,400);
  const un=await call('/api/accounts/unlink',{method:'POST',cookie,body:{subject:desk.subject,reason:'Player asked to move to a new account'}});
  assert.equal(un.status,200);assert.equal(un.json.backendId,'76561190000000301');
  assert.equal((await call('/api/accounts/unlink',{method:'POST',cookie,body:{subject:desk.subject,reason:'again'}})).status,409);
  await until(async()=>{o=(await call('/api/accounts',{cookie})).json;return o.audit.some(e=>e.action==='link-removed');},30000,'website heard link-removed');
  // The overview reads accounts and audit in parallel, so the poll that first sees the audit entry may hold an accounts
  // list read just before the report landed. The entry and the link removal commit together: read the overview again.
  o=(await call('/api/accounts',{cookie})).json;
  assert.equal(o.adapter.identities.count,2);
  // It never played in the browser, so once unlinked this server no longer knows the account; the audit keeps the unlink.
  assert.equal(o.accounts.find(a=>a.subject===desk.subject),undefined);
  assert.ok(svc.host.hub.since(0).some(l=>/Owner: unlinked account/.test(l.text)));
  // Players and Anti-cheat through the host key: a fixed list of this server's admin routes.
  const g=p=>call('/api/central/'+p,{cookie}),post=(p,body)=>call('/api/central/'+p,{method:'POST',cookie,body});
  const flags=(await g('recent-flags')).json.flags;
  assert.deepEqual(flags.map(f=>f.kind).sort(),['fire-rate','speed','speed','teleport']);
  const p1=byName['Demo player 1'].subject;
  const ev=(await g('flags?player='+p1)).json.flags;
  assert.equal(ev.find(f=>f.kind==='teleport').detail.replay.length,26);
  const reports=(await g('reports?status=open')).json.reports;assert.equal(reports.length,1);
  // Player history (H5): the recent list and one player's history, through the same key.
  const recent=(await g('player-history')).json.players;
  assert.ok(recent.some(x=>x.handle==='DemoHandle000002'&&x.name==='Demo stranger (pc)'));
  const hist=(await g('player-history?player='+p1)).json;
  assert.equal(hist.sessions,5);assert.deepEqual(hist.names.map(n=>n.name),['Demo player 1','DemoOne']);
  assert.equal(hist.flags.total,3);assert.equal(hist.reports.length,1);assert.equal(hist.moderation[0].action,'admin.kick');
  assert.equal((await post('resolve-report',{report:reports[0].id,status:'resolved'})).status,200);
  assert.equal((await g('reports?status=open')).json.reports.length,0);
  assert.equal((await post('kick',{player:p1,reason:''})).status,400);
  assert.equal((await post('kick',{player:p1,reason:'Teleporting (demo)'})).status,200);
  const ban=await post('bans',{player:p1,reason:'Teleporting (demo)',minutes:60});assert.equal(ban.status,200);
  const bans=(await g('bans')).json.bans;assert.equal(bans.filter(b=>b.active).length,1);
  assert.equal((await post('unban',{ban:bans[0].id})).status,200);
  assert.equal((await g('players')).json.players.length,0); // nobody is in the game on the demo
  assert.equal((await g('holds')).status,404);assert.equal((await post('policy',{})).status,404); // not on the host's list
  assert.equal((await g('roles')).json.owner.name,'Demo owner');
  // Roles are two-way through the host key (owner decision, 29 Oct 2026): it acts as the server's owner on central,
  // so it can grant admin (not just moderator, which a lower rank could already do) and revoke it again.
  const grant=await post('roles',{player:p1,role:'admin'});assert.equal(grant.status,200);assert.deepEqual(grant.json,{player:p1,role:'admin'});
  assert.deepEqual((await g('roles')).json.roles.map(r=>({player:r.player,role:r.role})),[{player:p1,role:'admin'}]);
  const revoke=await post('roles',{player:p1,role:null});assert.equal(revoke.status,200);assert.equal(revoke.json.role,null);
  assert.deepEqual((await g('roles')).json.roles,[]);
  assert.equal((await g('..%2F..%2Fme')).status,404);
  const audit=(await g('audit')).json.events;
  assert.ok(audit.some(e=>e.action==='admin.ban'&&e.detail?.via==='host'),'ban audited as via host');
  assert.ok(audit.some(e=>e.action==='admin.role'&&e.detail?.via==='host'&&e.detail?.to==='admin'),'role grant audited as via host');
  // Keys: wrong shape, and a well-formed key the website does not know.
  assert.equal((await call('/api/accounts/key',{method:'POST',cookie,body:{key:'hello'}})).status,400);
  assert.equal((await call('/api/accounts/key',{method:'POST',cookie,body:{key:'rlbh_'+'A'.repeat(43)}})).status,403);
  assert.equal((await call('/api/accounts',{cookie})).json.central.ok,true); // the saved key is untouched
 }finally{await svc?.close();try{rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});}catch{}}
});
