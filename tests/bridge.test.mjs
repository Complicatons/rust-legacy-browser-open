// Admission slice tests. Mocks only: no native server, hook or uLink transport is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createAccountService,createSigningKey,AdmissionError} from '../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender,parseEnvelope,encodeEnvelope} from '../bridge/adapter.mjs';
import {createGatewayAdmission} from '../bridge/gateway.mjs';

const SERVER='3f6c1b1e-0000-4000-8000-000000000001',OTHER='3f6c1b1e-0000-4000-8000-000000000002';
const NS={base:'90000000000000000',size:'1000000000'};

function setup({namespace=NS,known=new Set(),banned=new Set(),group={on:false},clock={t:1_800_000_000_000}}={}){
 const now=()=>clock.t,key=createSigningKey('k1'),controlKey=randomBytes(32);
 const account=createAccountService({issuer:'https://accounts.example.test',keys:[key],now});
 const identities=createIdentityMap({namespace,isKnownNativeId:id=>known.has(id)});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities,isBanned:id=>banned.has(id),steamGroupWhitelisted:()=>group.on,now});
 const sender=createControlSender(controlKey);
 const gateway=createGatewayAdmission({serverId:SERVER,account,sendControl:body=>adapter.handleControl(sender(body))});
 return {clock,key,account,adapter,gateway,identities,sender};
}
const rejects=(p,code)=>assert.rejects(p,e=>e instanceof AdmissionError&&e.code===code);

test('browser admission approves exactly one native connection with an allocated identity', async()=>{
 const {account,gateway,adapter}=setup();
 const join=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.ok(BigInt(join.backendId)>=BigInt(NS.base)&&BigInt(join.backendId)<BigInt(NS.base)+BigInt(NS.size));
 assert.equal(join.authBytes.length,53);
 const conn={};
 const r=adapter.onNativeApproval({authBytes:join.authBytes,claimedUserId:join.backendId,connection:conn});
 assert.deepEqual([r.path,r.approved,r.backendId,r.subject],['browser',true,join.backendId,'acct-1']);
 // The same envelope cannot be presented again (pending session is consumed).
 assert.equal(adapter.onNativeApproval({authBytes:join.authBytes,claimedUserId:join.backendId,connection:{}}).reason,'unknown-session');
});

test('native login bytes bypass the adapter unchanged', ()=>{
 const {adapter}=setup();
 assert.deepEqual(adapter.onNativeApproval({authBytes:randomBytes(240),claimedUserId:'76561198000000000',connection:{}}),{path:'native'});
 assert.equal(parseEnvelope(Buffer.alloc(0)),null);
 assert.deepEqual(parseEnvelope(Buffer.from('RLBA\x02')),{invalid:true,kind:'browser'});
});

test('tickets: replay, wrong server, expiry, forgery and tampering are rejected', async()=>{
 const {account,gateway,clock}=setup();
 const ticket=account.issueAdmission({subject:'acct-1',serverId:SERVER});
 await gateway.admit(ticket);
 await rejects(gateway.admit(ticket),'replayed');
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:OTHER})),'wrong-server');
 const late=account.issueAdmission({subject:'acct-2',serverId:SERVER});clock.t+=120000;
 await rejects(gateway.admit(late),'expired');
 const forger=createAccountService({issuer:'https://accounts.example.test',keys:[createSigningKey('k1')],now:()=>clock.t});
 await rejects(gateway.admit(forger.issueAdmission({subject:'acct-3',serverId:SERVER})),'bad-signature');
 const [h,p,s]=account.issueAdmission({subject:'acct-4',serverId:SERVER}).split('.');
 const payload=JSON.parse(Buffer.from(p,'base64url'));payload.sub='acct-admin';
 await rejects(gateway.admit([h,Buffer.from(JSON.stringify(payload)).toString('base64url'),s].join('.')),'bad-signature');
 await rejects(gateway.admit('x'.repeat(5000)),'malformed');
 await rejects(gateway.admit('a.b'),'malformed');
});

test('concurrent redemption of one ticket admits once', async()=>{
 const {account,gateway}=setup();
 const ticket=account.issueAdmission({subject:'acct-1',serverId:SERVER});
 const results=await Promise.allSettled([gateway.admit(ticket),gateway.admit(ticket),gateway.admit(ticket)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('wrong binding proof or a claimed foreign identity is denied and burns the pending session', async()=>{
 const {account,gateway,adapter}=setup();
 const a=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 const forged=Buffer.from(a.authBytes);forged[30]^=1;
 assert.equal(adapter.onNativeApproval({authBytes:forged,claimedUserId:a.backendId,connection:{}}).reason,'bad-proof');
 assert.equal(adapter.onNativeApproval({authBytes:a.authBytes,claimedUserId:a.backendId,connection:{}}).reason,'unknown-session');
 const b=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.equal(adapter.onNativeApproval({authBytes:b.authBytes,claimedUserId:'76561198000000001',connection:{}}).reason,'identity-mismatch');
 const guessed=encodeEnvelope({sessionId:randomBytes(16),secret:randomBytes(32)});
 assert.equal(adapter.onNativeApproval({authBytes:guessed,claimedUserId:a.backendId,connection:{}}).reason,'unknown-session');
});

test('pending sessions expire', async()=>{
 const {account,gateway,adapter,clock}=setup();
 const a=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 clock.t+=31000;
 assert.equal(adapter.onNativeApproval({authBytes:a.authBytes,claimedUserId:a.backendId,connection:{}}).reason,'unknown-session');
 assert.equal(adapter.stats().pending,0);
});

test('a second live session is refused without displacing the first; returning player keeps the identity', async()=>{
 const {account,gateway,adapter}=setup();
 const first=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),conn={};
 assert.ok(adapter.onNativeApproval({authBytes:first.authBytes,claimedUserId:first.backendId,connection:conn}).approved);
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),'already-connected');
 assert.equal(adapter.stats().leases,1);
 adapter.onDisconnect(conn);
 const again=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.equal(again.backendId,first.backendId);
});

// Restart test on the Azure VM (2026-10-22): the server was stopped with a browser player on it; no disconnect report
// ever came, so the account was refused "already-connected" after the restart. The plugin's poll is the truth.
test('a lease the server no longer lists is released after the grace period (server restart)', async()=>{
 const {account,gateway,adapter,clock}=setup();
 const first=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.ok(adapter.onNativeApproval({authBytes:first.authBytes,claimedUserId:first.backendId,connection:{}}).approved);
 clock.t+=5000;adapter.setRoster([]); // just approved, not listed yet: kept
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),'already-connected');
 clock.t+=30000;adapter.setRoster([{id:first.backendId,name:'acct-1'}]); // listed: kept however old
 clock.t+=60000;adapter.setRoster([{id:first.backendId,name:'acct-1'}]);
 assert.equal(adapter.stats().leases,1);
 clock.t+=2000;adapter.setRoster([]); // the restarted server lists nobody
 assert.equal(adapter.stats().leases,0);
 const again=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.equal(again.backendId,first.backendId);
});

// Restart test on the Azure VM (2026-10-29): after the real server restarted, a hold bot's rejoin was refused
// already-connected for at least 3 min 40 s with no roster update in sight — the plugin that would normally report
// the disconnect died with the old server process, so the only release path left was the grace sweep waiting on a
// roster poll that hadn't happened yet. The gateway already knows at once (its own uLink client sees the native
// connection fail): it should say so instead of waiting on the plugin.
test('the gateway releases a lease as soon as its own session ends, without waiting for the plugin (server restart)', async()=>{
 const {account,gateway,adapter,clock}=setup();
 const first=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),conn={};
 assert.ok(adapter.onNativeApproval({authBytes:first.authBytes,claimedUserId:first.backendId,connection:conn}).approved);
 clock.t+=3_600_000; // long-lived; well past LEASE_GRACE_MS on its own, same as a real player hours into a session
 // The real server is killed and restarted: no disconnect report ever comes, but the gateway's own session for
 // this player ends right away (gateway-service.mjs end(), on its uLink client seeing the connection fail).
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),'already-connected');
 gateway.release(first.backendId,first.sessionId);
 const again=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.equal(again.backendId,first.backendId);
});

test('a late release for an already-superseded session never touches the newer lease it was replaced by', async()=>{
 const {account,gateway,adapter}=setup();
 const first=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),conn={};
 assert.ok(adapter.onNativeApproval({authBytes:first.authBytes,claimedUserId:first.backendId,connection:conn}).approved);
 adapter.onDisconnect(conn); // this session ends normally and releases its lease
 const second=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),conn2={};
 assert.ok(adapter.onNativeApproval({authBytes:second.authBytes,claimedUserId:second.backendId,connection:conn2}).approved);
 // A release message for the FIRST session, delayed in flight until after the reconnect, must not evict the second.
 gateway.release(first.backendId,first.sessionId);
 assert.equal(adapter.stats().leases,1);
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),'already-connected');
});

// Azure VM, 2026-10-24: both adapters left browser players out of the poll, so the host counted an empty server (no
// restart warnings for browser players) and their leases were dropped 60 s after joining.
test('both adapters list browser players in the poll; a listed browser player keeps the lease and counts as online', async()=>{
 for(const f of ['../adapter/vanilla/RustLegacyBrowserVanilla.cs','../adapter/RustLegacyBrowser.cs']){
  const src=readFileSync(new URL(f,import.meta.url),'utf8').replace(/\r\n/g,'\n'),list=src.slice(src.indexOf('ListPlayers()\n'),src.indexOf('ListPlayers()\n')+900);
  assert.ok(list.includes('PlayerClient.All')&&!/browserConnections\.Contains/.test(list),f+': ListPlayers skips nobody');
 }
 const {account,gateway,adapter,clock}=setup();
 const first=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.ok(adapter.onNativeApproval({authBytes:first.authBytes,claimedUserId:first.backendId,connection:{}}).approved);
 for(let i=0;i<40;i++){clock.t+=2000;adapter.setRoster([{id:first.backendId,name:'acct-1',pos:[0,0,0],life:'1'}]);}
 assert.equal(adapter.stats().leases,1,'kept past the grace period');
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),'already-connected');
 assert.equal(adapter.serverCommandStatus().plugin.players,1);
 assert.equal(adapter.stats().watches,0,'browser players are not scored by the desktop checks');
});

test('control channel rejects forged and replayed messages; bans and missing namespace fail closed', async()=>{
 const {adapter,sender}=setup();
 const body={type:'register-pending',serverId:SERVER,subject:'acct-1',joinId:'j',sessionId:'0'.repeat(32),secretDigest:'0'.repeat(64)};
 const m=sender(body);
 assert.equal(adapter.handleControl({...m,body:{...body,subject:'acct-2'}}).reason,'unauthenticated');
 assert.equal(adapter.handleControl(m).ok,true);
 assert.equal(adapter.handleControl(m).reason,'unauthenticated');
 assert.equal(adapter.handleControl(createControlSender(randomBytes(32))({...body,sessionId:'1'.repeat(32)})).reason,'unauthenticated');
 assert.equal(adapter.handleControl(sender({...body,serverId:OTHER,sessionId:'2'.repeat(32)})).reason,'wrong-server');

 const closed=setup({namespace:null});
 await rejects(closed.gateway.admit(closed.account.issueAdmission({subject:'acct-1',serverId:SERVER})),'no-identity');
 const banned=new Set(),b=setup({banned});
 const a=await b.gateway.admit(b.account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 banned.add(a.backendId);
 assert.equal(b.adapter.onNativeApproval({authBytes:a.authBytes,claimedUserId:a.backendId,connection:{}}).reason,'banned');
});

test('identity namespace never allocates a known native or already mapped ID', ()=>{
 const known=new Set(['5','6','7']);
 const map=createIdentityMap({namespace:{base:'5',size:'4'},isKnownNativeId:id=>known.has(id)});
 assert.equal(map.allocate('a'),'8');
 assert.equal(map.allocate('a'),'8');
 assert.throws(()=>map.allocate('b'),/exhausted/);
 assert.throws(()=>createIdentityMap({namespace:{base:'18446744073709551615',size:'2'}}),/Bad namespace/);
});

test('desktop character link: challenge, two-step reservation, idempotent confirm, then browser join as that character', async()=>{
 const {account,gateway,adapter}=setup();
 const desktop={},desktopId='76561198012345678';
 assert.equal(adapter.issueLinkChallenge({}),null);
 assert.equal(adapter.onNativeAuthenticated({backendId:desktopId,connection:desktop}),true);
 const code=adapter.issueLinkChallenge(desktop);
 assert.match(code,/^[A-HJ-NP-Z2-9]{10}$/);
 const r=adapter.reserveLink({code,subject:'acct-1'});
 assert.deepEqual([r.ok,r.backendId],[true,desktopId]);
 assert.equal(adapter.reserveLink({code,subject:'acct-2'}).reason,'unknown-code');
 assert.deepEqual(adapter.confirmLink(r.reservationId),{ok:true,backendId:desktopId});
 assert.deepEqual(adapter.confirmLink(r.reservationId),{ok:true,backendId:desktopId});
 assert.equal(adapter.issueLinkChallenge(desktop),null); // already linked

 // While the desktop session is live the browser cannot take it over.
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),'already-connected');
 adapter.onDisconnect(desktop);
 const join=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 assert.equal(join.backendId,desktopId);
 assert.ok(adapter.onNativeApproval({authBytes:join.authBytes,claimedUserId:desktopId,connection:{}}).approved);
});

test('link redemption conflicts and guessing are refused', ()=>{
 const {adapter,identities}=setup();
 const c1={},c2={};
 adapter.onNativeAuthenticated({backendId:'100',connection:c1});
 adapter.onNativeAuthenticated({backendId:'200',connection:c2});
 identities.link('acct-9','200');
 const code=adapter.issueLinkChallenge(c1);
 assert.equal(adapter.reserveLink({code,subject:'acct-9'}).reason,'subject-already-linked');
 const code2=adapter.issueLinkChallenge(c1),first=adapter.reserveLink({code:code2,subject:'acct-1'});
 assert.equal(first.ok,true);
 const code3=adapter.issueLinkChallenge(c1);
 assert.equal(adapter.reserveLink({code:code3,subject:'acct-2'}).reason,'conflict');
 for(let i=0;i<10;i++)adapter.reserveLink({code:'AAAAAAAAAA',subject:'acct-x'});
 assert.equal(adapter.reserveLink({code:adapter.issueLinkChallenge(c1),subject:'acct-x'}).reason,'rate-limited');
});

test('servers with a Steam group whitelist refuse browser joins', async()=>{
 const group={on:false},{account,gateway,adapter}=setup({group});
 const a=await gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER}));
 group.on=true;
 assert.equal(adapter.onNativeApproval({authBytes:a.authBytes,claimedUserId:a.backendId,connection:{}}).reason,'group-whitelist');
 await rejects(gateway.admit(account.issueAdmission({subject:'acct-1',serverId:SERVER})),'group-whitelist');
 assert.deepEqual(adapter.onNativeApproval({authBytes:randomBytes(200),claimedUserId:'1',connection:{}}),{path:'native'});
});

test('verified Steam sign-ins map to the SteamID only when the operator trusts them', async()=>{
 const controlKey=randomBytes(32),sender=createControlSender(controlKey);
 const body=(subject,steamId,i)=>({type:'register-pending',serverId:SERVER,subject,joinId:'j'+i,sessionId:String(i).padStart(32,'0'),secretDigest:'0'.repeat(64),steamId});
 const trusting=createIdentityAdapter({serverId:SERVER,controlKey,identities:createIdentityMap({namespace:NS}),trustSteamIds:true});
 assert.deepEqual(trusting.handleControl(sender(body('acct-1','76561198000000001',1))),{ok:true,backendId:'76561198000000001'});
 assert.equal(trusting.handleControl(sender(body('acct-2','76561198000000001',2))).reason,'conflict');
 assert.notEqual(trusting.handleControl(sender(body('acct-3','1234',3))).backendId,'1234'); // not a SteamID: namespace allocation
 const k2=randomBytes(32),s2=createControlSender(k2);
 const cautious=createIdentityAdapter({serverId:SERVER,controlKey:k2,identities:createIdentityMap({namespace:NS})});
 assert.notEqual(cautious.handleControl(s2(body('acct-1','76561198000000001',1))).backendId,'76561198000000001');
});
