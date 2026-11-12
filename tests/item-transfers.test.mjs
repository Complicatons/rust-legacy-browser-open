// Item transfers from the vanilla adapter's evidence facts (ANTICHEAT-ADMIN-PLAN.md slice 8): the sidecar's provenance
// tracker, the adapter's item-transfer events by account or handle, the sidecar poll, and central's log, alt links and
// admin route. The server plugin is played by the tests (it has never run on a server).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createTransferTracker} from '../bridge/item-transfers.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../bridge/adapter.mjs';
import {createAdapterSidecar,signPluginBody} from '../bridge/sidecar.mjs';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {listenServer} from '../bridge/listen.mjs';

const A='76561198000000001',B='76561198000000002',C='76561198000000003';
const own=id=>({inv:'inv-'+id,kind:'player',owner:id});
const box=n=>({inv:'box-'+n,kind:'container'});
const move=(looter,src,srcSlot,dst,dstSlot,item,amount,via='loot')=>({looter,src,srcSlot,dst,dstSlot,item,amount,via});

test('tracker: a box, a dropped item, a death sack and a sleeper carry items from one player to another', ()=>{
 const clock={t:1000},tr=createTransferTracker({now:()=>clock.t,ttlMs:60000});
 // A puts 250 wood into a box; their own moves in and out of it never count.
 assert.deepEqual(tr.apply(move(A,own(A),3,box(1),0,'Wood',250)),[]);
 assert.deepEqual(tr.apply(move(A,box(1),0,own(A),5,'Wood',50)),[]);
 // B takes 100, then the remaining 100: two transfers, then the slot is empty of A's wood.
 assert.deepEqual(tr.apply(move(B,box(1),0,own(B),2,'Wood',100)),[{from:A,to:B,item:'Wood',amount:100,via:'container',looter:B}]);
 assert.equal(tr.apply(move(B,box(1),0,own(B),2,'Wood',100)).length,1);
 assert.deepEqual(tr.apply(move(B,box(1),0,own(B),2,'Wood',100)),[]);
 // A different item in a stamped slot is not A's (the slot was emptied and refilled by the world or a shuffle).
 tr.apply(move(A,own(A),1,box(1),4,'M4',1));
 assert.deepEqual(tr.apply(move(B,box(1),4,own(B),1,'Stones',30)),[]);
 // Moved on to a second box by B and taken by C: still A's items.
 tr.apply(move(A,own(A),2,box(2),0,'Metal Fragments',80));
 assert.deepEqual(tr.apply(move(B,box(2),0,box(3),7,'Metal Fragments',80)),[]);
 assert.deepEqual(tr.apply(move(C,box(3),7,own(C),0,'Metal Fragments',80)).map(t=>[t.from,t.to,t.via]),[[A,C,'container']]);
 // Dropped item (ItemPickup) picked up by B.
 tr.apply({drop:'drop',owner:A,kind:'player',inv:'pick-1',items:[{slot:0,item:'Bolt Action Rifle',amount:1}]});
 assert.deepEqual(tr.apply(move(B,{inv:'pick-1',kind:'container'},0,own(B),-1,'Bolt Action Rifle',1,'pickup')).map(t=>[t.from,t.to,t.via]),[[A,B,'drop']]);
 // Death sack: B loots A's corpse.
 tr.apply({drop:'corpse',owner:A,kind:'player',inv:'sack-1',items:[{slot:0,item:'Kevlar Vest',amount:1},{slot:1,item:'556 Ammo',amount:120}]});
 assert.deepEqual(tr.apply(move(B,{inv:'sack-1',kind:'container'},1,own(B),9,'556 Ammo',120)).map(t=>[t.from,t.to,t.item,t.amount,t.via]),[[A,B,'556 Ammo',120,'corpse']]);
 // A sleeper's own inventory: the owner is the sleeper's creator.
 assert.deepEqual(tr.apply(move(C,{inv:'sl-1',kind:'sleeper',owner:A},0,own(C),3,'Cloth',10)).map(t=>[t.from,t.to,t.via]),[[A,C,'sleeper']]);
 // Stamps expire; malformed facts are ignored.
 tr.apply(move(A,own(A),0,box(9),0,'Wood',10));clock.t+=61000;
 assert.deepEqual(tr.apply(move(B,box(9),0,own(B),0,'Wood',10)),[]);
 for(const bad of [null,{},move('x',own(A),0,box(1),0,'Wood',1),move(A,own(A),0,{inv:5},0,'Wood',1),move(A,own(A),0,box(1),0,'Wood',0),{drop:'corpse',owner:'nope',inv:'s',items:[]}])assert.deepEqual(tr.apply(bad),[]);
 // Bounded memory.
 const small=createTransferTracker({maxStamps:3});for(let i=0;i<10;i++)small.apply(move(A,own(A),i,box(1),i,'Wood',1));assert.equal(small.size(),3);
});

test('adapter + sidecar: plugin poll facts become item-transfer events by account or by opaque handle', async()=>{
 const clock={t:1_800_000_000_000},controlKey=randomBytes(32),pluginKey=randomBytes(32),send=createControlSender(controlKey),acct=randomUUID();
 const adapter=createIdentityAdapter({serverId:'srv',controlKey,now:()=>clock.t,identities:createIdentityMap({entries:[[acct,A]]})});
 const sidecar=createAdapterSidecar({adapter,pluginKey,now:()=>clock.t});
 const http=createServer((q,r)=>sidecar.handle(q,r));await listenServer(http);
 try{
  const boot=randomBytes(16).toString('hex');let seq=0;
  const post=async body=>{const raw=JSON.stringify({...body,boot,seq:++seq,ts:clock.t});const res=await fetch(`http://127.0.0.1:${http.address().port}/plugin`,{method:'POST',headers:{'content-type':'application/json','x-rlb-mac':signPluginBody(pluginKey,raw)},body:raw});return res.json();};
  const reply=await post({type:'poll',players:[{id:A,name:'Alice'},{id:B,name:'Bob'}],moves:[move(A,own(A),3,box(1),0,'Wood',250),move(B,box(1),0,own(B),2,'Wood',250)]});
  assert.equal(reply.ok,true);
  const {events}=adapter.handleControl(send({serverId:'srv',type:'drain-events'}));
  const [t]=events.filter(e=>e.type==='item-transfer');
  assert.deepEqual([t.from,t.to,t.fromName,t.toName,t.item,t.amount,t.via],[acct,undefined,'Alice','Bob','Wood',250,'container']);
  assert.match(t.fromHandle,/^[A-Za-z0-9_-]{16}$/);assert.match(t.toHandle,/^[A-Za-z0-9_-]{16}$/);assert.notEqual(t.fromHandle,t.toHandle);
  assert.ok(!JSON.stringify(t).includes('76561198'),'native IDs never leave the adapter');
  assert.deepEqual(adapter.stats().evidence,{moves:2,transfers:1,shots:0,hits:0,lost:0});
  // itemTransfers:false turns the tracker off.
  const off=createIdentityAdapter({serverId:'srv',controlKey,itemTransfers:false});
  off.evidence({moves:[move(A,own(A),3,box(1),0,'Wood',1),move(B,box(1),0,own(B),2,'Wood',1)]});assert.equal(off.stats().outbox,0);
 }finally{await new Promise(r=>http.close(r));}
});

async function central(){
 const ORIGIN='https://play.example.test',clock={t:1_800_000_000_000},db=openCentralDb();
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false,rateLimit:1000});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 const call=async(method,path,{data,as}={})=>{const headers={origin:ORIGIN};if(data!==undefined)headers['content-type']='application/json';if(as){headers.cookie=as.cookie;headers['x-csrf-token']=as.csrf;}const res=await fetch(base+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined});return {status:res.status,data:await res.json()};};
 const login=async subject=>{const res=await fetch(base+'/auth/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({subject,name:subject})});const d=await res.json();return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:d.csrf,player:d.player,name:subject};};
 return {db,clock,base,call,login,close:()=>new Promise(r=>http.close(r))};
}

test('central: item transfers are logged by account and handle, shown to staff, and link new accounts as possible alts', async()=>{
 const c=await central();
 try{
  const owner=await c.login('owner'),alice=await c.login('alice'),bob=await c.login('bob');
  const created=(await c.call('POST','/owner/servers',{as:owner,data:{name:'Pilot',region:'eu',endpoint:'wss://p.example/play'}})).data;
  const remote=createRemoteAccount({baseUrl:c.base,credential:(await enrolGateway({baseUrl:c.base,code:created.enrolmentCode})).credential});
  const p=`/admin/servers/${created.id}`,desk='DeskHandle000007',other='DeskHandle000008';
  await remote.report({players:[],flags:[],events:[
   {type:'item-transfer',from:alice.player,to:bob.player,fromHandle:'AliceHandle00001',toHandle:'BobHandle0000001',fromName:'Alice',toName:'Bob',item:'M4',amount:1,via:'container',at:c.clock.t},
   {type:'item-transfer',fromHandle:desk,toHandle:other,fromName:'Desk',toName:'Other',item:'Wood',amount:500,via:'corpse',at:c.clock.t},
   {type:'item-transfer',from:alice.player,toHandle:desk,toName:'Desk',item:'Cloth',amount:20,via:'drop',at:c.clock.t},
   {type:'item-transfer',fromHandle:desk,toHandle:desk,item:'x'},{type:'item-transfer',from:alice.player,to:alice.player,item:'x'},{type:'item-transfer',fromHandle:'../x',toHandle:other}]});
  assert.equal((await c.call('GET',`${p}/transfers`,{as:alice})).status,404); // staff only (others do not see the server)
  const all=(await c.call('GET',`${p}/transfers`,{as:owner})).data.transfers;
  assert.deepEqual(all.map(r=>[r.item,r.amount,r.via,r.from.name,r.to.name]),[['Cloth',20,'drop','alice','Desk'],['Wood',500,'corpse','Desk','Other'],['M4',1,'container','Alice','Bob']]);
  const mine=(await c.call('GET',`${p}/transfers?player=${alice.player}`,{as:owner})).data.transfers;assert.deepEqual(mine.map(r=>r.item),['Cloth','M4']);
  const byHandle=(await c.call('GET',`${p}/transfers?handle=${desk}`,{as:owner})).data.transfers;assert.deepEqual(byHandle.map(r=>r.item),['Cloth','Wood']);
  assert.equal((await c.call('GET',`${p}/transfers?handle=bad`,{as:owner})).data.error,'invalid-handle');
  // Account to account also feeds the "possible alt" links (both accounts are new).
  const {alts}=(await c.call('GET',`${p}/alts?player=${bob.player}`,{as:owner})).data;
  assert.deepEqual(alts.map(a=>[a.player,a.reasons]),[[alice.player,['item-transfer']]]);
 }finally{await c.close();}
});
