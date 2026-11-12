// Accounts and links for the host app (HOST-APP-PLAN.md "Accounts and links"): the control channel survives a gateway
// restart, the adapter's owner unlink (refused while online or mid-link; reported to central as link-removed), and
// central's host app key (owner powers on one server's admin routes only, revocable, audited as via host).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../bridge/adapter.mjs';
import {central} from './helpers/central-fixture.mjs';

const serverId='11111111-1111-4111-8111-111111111111';

test('control channel: a restarted gateway is accepted, a replayed message is not',()=>{
 const key=randomBytes(32),a=createIdentityAdapter({serverId,controlKey:key});
 const first=createControlSender(key),status={type:'status',serverId};
 for(let i=0;i<3;i++)assert.equal(a.handleControl(first(status)).ok,true);
 const restarted=createControlSender(key),m=restarted(status);
 assert.equal(a.handleControl(m).ok,true); // the old run's sequence numbers no longer block it
 assert.equal(a.handleControl(m).reason,'unauthenticated'); // replay
 const forged={...restarted(status),boot:'0'.repeat(16)};
 assert.equal(a.handleControl(forged).reason,'unauthenticated'); // the boot id is covered by the MAC
 assert.equal(a.handleControl(first(status)).ok,true); // the first run still goes on from its own sequence
});

test('adapter unlink: refused while in game or mid-link, then removed and reported as link-removed',()=>{
 const key=randomBytes(32),send=createControlSender(key),subject=randomUUID(),other=randomUUID();
 const identities=createIdentityMap({namespace:{base:'90000000000000000',size:'1000000'},entries:[[subject,'76561190000000301']]});
 const a=createIdentityAdapter({serverId,controlKey:key,identities});
 const ctl=body=>a.handleControl(send({...body,serverId}));
 let s=ctl({type:'status'});
 assert.equal(s.identities.count,1);assert.deepEqual(s.identities.entries,[{subject,backendId:'76561190000000301'}]);assert.ok(s.identities.namespace);
 a.onNativeAuthenticated({backendId:'76561190000000301',connection:'c1'});
 assert.equal(ctl({type:'unlink',subject,reason:'owner request'}).reason,'online');
 a.onDisconnect('c1');
 assert.equal(ctl({type:'unlink',subject:other,reason:'x'}).reason,'not-linked');
 assert.equal(ctl({type:'unlink',subject:'',reason:'x'}).reason,'malformed');
 const r=ctl({type:'unlink',subject,reason:'owner request'});
 assert.deepEqual(r,{ok:true,backendId:'76561190000000301'});
 s=ctl({type:'status'});assert.equal(s.identities.count,0);assert.equal(s.unlinks[0].reason,'owner request');
 const {events}=ctl({type:'drain-events'});
 assert.deepEqual(events.map(e=>[e.type,e.subject,e.backendId,e.reason]),[['link-removed',subject,'76561190000000301','owner request']]);
 // The character is free again: a new in-game code can link it to the same or another account.
 a.onNativeAuthenticated({backendId:'76561190000000301',connection:'c2'});
 const code=a.issueLinkChallenge('c2');assert.ok(code);
 const res=ctl({type:'reserve-link',code,subject:other});assert.equal(res.ok,true);
 identities.link(subject,'90000000000000005');
 assert.equal(ctl({type:'unlink',subject:other,reason:'x'}).reason,'not-linked');
});

test('central host app key: owner powers on one server only, revocable, audited as via host; link-removed clears the link',async()=>{
 const c=await central();
 try{
  const login=await c.call('POST','/auth/login',{data:{subject:'owner-1',name:'Owner'}});
  const owner={cookie:login.cookie,csrf:login.data.csrf};
  const made=await c.call('POST','/owner/servers',{data:{name:'Host app test',region:'eu',endpoint:'wss://play.example.test/play'},...owner});
  const other=await c.call('POST','/owner/servers',{data:{name:'Other',region:'eu',endpoint:'wss://other.example.test/play'},...owner});
  const id=made.data.id;
  // Only the owner can make one; it is shown once.
  const stranger=await c.call('POST','/auth/login',{data:{subject:'someone',name:'Someone'}});
  assert.equal((await c.call('POST',`/owner/servers/${id}/host-key`,{data:{},cookie:stranger.cookie,csrf:stranger.data.csrf})).status,404);
  const hk=await c.call('POST',`/owner/servers/${id}/host-key`,{data:{},...owner});
  assert.equal(hk.status,201);assert.match(hk.data.hostKey,/^rlbh_[A-Za-z0-9_-]{43}$/);
  const bearer=(path,{method='GET',data}={})=>fetch(c.base+path,{method,headers:{authorization:'Bearer '+hk.data.hostKey,...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}).then(async r=>({status:r.status,data:await r.json().catch(()=>null)}));
  // Accounts: a player who played there, and a desktop link.
  const p1=(await c.call('POST','/auth/login',{data:{subject:'player-1',name:'Player one'}})).data.player;
  const p2=(await c.call('POST','/auth/login',{data:{subject:'player-2',name:'Desktop two'}})).data.player;
  c.db.touchPlaySession(id,p1,c.clock.t-60e3,c.clock.t,60e3);c.db.link(id,p2,'76561190000000301',c.clock.t);
  const acc=await bearer(`/admin/servers/${id}/accounts`);
  assert.equal(acc.status,200);assert.equal(acc.data.role,'owner');
  assert.deepEqual(acc.data.accounts.map(a=>[a.name,Boolean(a.link)]).sort(),[['Desktop two',true],['Player one',false]]);
  assert.ok(acc.data.hostKey.created_at);
  assert.equal((await bearer(`/admin/servers/${id}/link-requests`)).status,200);
  // Owner actions through the key are audited with via: host.
  assert.equal((await bearer(`/admin/servers/${id}/policy`,{method:'POST',data:{minAccountAgeMinutes:5}})).status,200);
  const audit=(await bearer(`/admin/servers/${id}/audit`)).data.events;
  assert.ok(audit.some(e=>e.detail?.via==='host'),'policy change audited as via host');
  // One server only, and no website routes.
  assert.equal((await bearer(`/admin/servers/${other.data.id}/accounts`)).status,404);
  assert.equal((await bearer('/me')).status,401);
  assert.equal((await bearer('/owner/servers')).status,401);
  // The adapter's link-removed event (through the gateway's report) clears central's link reference.
  const credential=(await (await fetch(c.base+'/bridge/enrol',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:made.data.enrolmentCode})})).json()).credential;
  const rep=await fetch(c.base+'/bridge/report',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credential},body:JSON.stringify({players:[],flags:[],events:[{type:'link-removed',subject:p2,backendId:'76561190000000301',reason:'owner request'}]})});
  assert.equal(rep.status,200);
  assert.equal(c.db.linkFor(id,p2),undefined);
  assert.ok((await bearer(`/admin/servers/${id}/audit`)).data.events.some(e=>e.action==='link-removed'&&e.detail?.reason==='owner request'));
  // A new key replaces the old one; revoking ends it.
  const hk2=await c.call('POST',`/owner/servers/${id}/host-key`,{data:{},...owner});
  assert.equal((await bearer(`/admin/servers/${id}/accounts`)).status,404);
  assert.equal((await fetch(c.base+`/admin/servers/${id}/accounts`,{headers:{authorization:'Bearer '+hk2.data.hostKey}})).status,200);
  assert.equal((await c.call('POST',`/owner/servers/${id}/host-key-revoke`,{data:{},...owner})).data.revoked,1);
  assert.equal((await fetch(c.base+`/admin/servers/${id}/accounts`,{headers:{authorization:'Bearer '+hk2.data.hostKey}})).status,404);
  // The host app's Setup page: one enrolment code gives the gateway credential and the host app key together.
  const code=(await c.call('POST',`/owner/servers/${id}/enrolment-code`,{data:{},...owner})).data.enrolmentCode;
  const both=await (await fetch(c.base+'/bridge/enrol',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,hostKey:true})})).json();
  assert.equal(both.serverId,id);assert.match(both.hostKey,/^rlbh_[A-Za-z0-9_-]{43}$/);
  assert.equal((await fetch(c.base+`/admin/servers/${id}/accounts`,{headers:{authorization:'Bearer '+both.hostKey}})).status,200);
  // Without hostKey nothing else is issued, and a used code gives nothing.
  assert.equal((await fetch(c.base+'/bridge/enrol',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,hostKey:true})})).status,401);
  const plain=await (await fetch(c.base+'/bridge/enrol',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:(await c.call('POST',`/owner/servers/${id}/enrolment-code`,{data:{},...owner})).data.enrolmentCode})})).json();
  assert.ok(plain.credential&&!('hostKey' in plain));
  assert.equal((await fetch(c.base+`/admin/servers/${id}/accounts`,{headers:{authorization:'Bearer '+both.hostKey}})).status,200,'a plain enrolment keeps the host key');
 }finally{await c.close();}
});
