// Sidecar over loopback HTTP, driven the way the C# plugin and the gateway would call it. Mocks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAccountService,createSigningKey} from '../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../bridge/adapter.mjs';
import {createGatewayAdmission} from '../bridge/gateway.mjs';
import {createAdapterSidecar,signPluginBody,loadIdentityEntries,saveIdentityEntries} from '../bridge/sidecar.mjs';
import {listenServer} from '../bridge/listen.mjs';

const SERVER='3f6c1b1e-0000-4000-8000-000000000001',NS={base:'90000000000000000',size:'1000000000'};

async function start({file}){
 const controlKey=randomBytes(32),pluginKey=randomBytes(32),key=createSigningKey('k1');
 const identities=createIdentityMap({namespace:NS,entries:loadIdentityEntries(file),onChange:e=>saveIdentityEntries(file,e)});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities});
 const sidecar=createAdapterSidecar({adapter,pluginKey});
 const server=createServer((req,res)=>sidecar.handle(req,res));
 await listenServer(server);
 const base=`http://127.0.0.1:${server.address().port}`,sender=createControlSender(controlKey);
 const control=async body=>(await fetch(base+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sender(body))})).json();
 const account=createAccountService({issuer:'https://accounts.example.test',keys:[key]});
 const gateway=createGatewayAdmission({serverId:SERVER,account,sendControl:control});
 const boot=randomBytes(16).toString('hex');let seq=0;
 // Mirrors RustLegacyBrowser.Post: raw JSON body, HMAC-SHA256 base64url in x-rlb-mac.
 async function plugin(body,{mac,raw}={}){
  raw??=JSON.stringify({...body,boot,seq:++seq,ts:Date.now()});
  const r=await fetch(base+'/plugin',{method:'POST',headers:{'content-type':'application/json','x-rlb-mac':mac??signPluginBody(pluginKey,raw)},body:raw});
  return {status:r.status,...await r.json(),raw};
 }
 return {account,gateway,plugin,control,close:()=>new Promise(r=>server.close(r))};
}
const conn=()=>randomBytes(16).toString('hex');

test('plugin approval through the sidecar admits a gateway-prepared browser join once', async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'rlb-')),'identities.json'),s=await start({file});
 try{
  const join=await s.gateway.admit(s.account.issueAdmission({subject:'acct-1',serverId:SERVER}));
  const c=conn(),req={type:'approval',connectionId:c,claimedUserId:join.backendId,authBytes:join.authBytes.toString('base64')};
  const ok=await s.plugin(req);
  assert.deepEqual([ok.status,ok.approved,ok.backendId],[200,true,join.backendId]);
  // Replaying the exact signed request is refused by the sequence check.
  assert.equal((await s.plugin(null,{raw:ok.raw})).status,401);
  assert.equal((await s.plugin(req,{mac:'AAAA'})).status,401);
  // Native ticket bytes go back to native authentication.
  assert.equal((await s.plugin({...req,connectionId:conn(),authBytes:randomBytes(240).toString('base64')})).path,'native');
  // A second browser join for the same subject is refused while the first holds the lease, then allowed after disconnect.
  await assert.rejects(s.gateway.admit(s.account.issueAdmission({subject:'acct-1',serverId:SERVER})),{code:'already-connected'});
  assert.equal((await s.plugin({type:'disconnect',connectionId:c})).ok,true);
  const again=await s.gateway.admit(s.account.issueAdmission({subject:'acct-1',serverId:SERVER}));
  assert.equal(again.backendId,join.backendId);
 }finally{await s.close();}
});

test('stale plugin boots and malformed requests are refused', async()=>{
 const s=await start({file:join(mkdtempSync(join(tmpdir(),'rlb-')),'i.json')});
 try{
  const raw=JSON.stringify({type:'disconnect',connectionId:conn(),boot:randomBytes(16).toString('hex'),seq:1,ts:Date.now()-60000});
  assert.equal((await s.plugin(null,{raw})).status,401);
  assert.equal((await s.plugin({type:'approval',connectionId:'x',claimedUserId:'1',authBytes:''})).reason,'malformed');
  assert.equal((await s.plugin({type:'approval',connectionId:conn(),claimedUserId:'1; drop',authBytes:''})).reason,'malformed');
  assert.equal((await s.plugin({type:'shell',connectionId:conn()})).reason,'unknown-message');
  // Requests that overtake each other: the later-numbered one wins and the earlier one is refused, which is why both
  // server adapters keep a single request in flight (tests/admin-commands.test.mjs pins that).
  const {boot,seq}=JSON.parse((await s.plugin({type:'poll'})).raw),signed=n=>JSON.stringify({type:'poll',boot,seq:n,ts:Date.now()});
  assert.equal((await s.plugin(null,{raw:signed(seq+2)})).status,200);
  assert.equal((await s.plugin(null,{raw:signed(seq+1)})).status,401);
 }finally{await s.close();}
});

test('desktop link via /browserlink and the control channel persists across a sidecar restart', async()=>{
 const file=join(mkdtempSync(join(tmpdir(),'rlb-')),'identities.json');
 let s=await start({file});
 const desktop=conn(),desktopId='76561198012345678';
 try{
  assert.equal((await s.plugin({type:'link-challenge',connectionId:desktop})).reason,'not-eligible');
  assert.equal((await s.plugin({type:'native-authenticated',connectionId:desktop,userId:desktopId})).ok,true);
  const {code}=await s.plugin({type:'link-challenge',connectionId:desktop});
  const r=await s.control({type:'reserve-link',serverId:SERVER,code,subject:'acct-7'});
  assert.equal(r.ok,true);
  assert.deepEqual(await s.control({type:'confirm-link',serverId:SERVER,reservationId:r.reservationId}),{ok:true,backendId:desktopId});
 }finally{await s.close();}
 assert.deepEqual(loadIdentityEntries(file),[['acct-7',desktopId]]);
 s=await start({file});
 try{
  const join=await s.gateway.admit(s.account.issueAdmission({subject:'acct-7',serverId:SERVER}));
  assert.equal(join.backendId,desktopId);
 }finally{await s.close();}
});
