// Admin screenshots (central/screenshots.mjs, bridge/gateway-service.mjs capture, browser/admin-capture.mjs): who may
// ask, delivery through the gateway report, upload checks, automatic requests from flags, audit and retention.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';
import {enrolGateway,createRemoteAccount} from '../bridge/remote-account.mjs';
import {jpegInfo,cleanMeta,screenshotChecks,LIMITS} from '../central/screenshots.mjs';
import {createGatewayService} from '../bridge/gateway-service.mjs';
import {createAdminCapture,captureSize,lumaStats,backgroundUrl,backgroundBox,CAPTURE} from '../browser/admin-capture.mjs';

// A minimal baseline JPEG header (APP0, SOF0 with one component) and end marker; pad varies the bytes.
const jpeg=(w,h,pad=0)=>Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,0xc0,0,11,8,h>>8,h&255,w>>8,w&255,1,1,0x11,0]),Buffer.alloc(pad,7),Buffer.from([0xff,0xd9])]);
const login=async(c,subject)=>{const r=await c.call('POST','/auth/login',{data:{subject,name:subject}});return {cookie:r.cookie,csrf:r.data.csrf,player:r.data.player,name:subject};};
const act=(c,who)=>(method,p,data)=>c.call(method,p,{data,cookie:who.cookie,csrf:who.csrf});
async function server(c,owner,name){
 const created=(await act(c,owner)('POST','/owner/servers',{name,region:'eu',endpoint:`wss://${name.toLowerCase()}.example/play`})).data;
 const {credential}=await enrolGateway({baseUrl:c.base,code:created.enrolmentCode});
 const remote=createRemoteAccount({baseUrl:c.base,credential});await remote.heartbeat({players:0,capacity:50});
 await act(c,owner)('POST',`/owner/servers/${created.id}/publish`,{listed:true});
 return {id:created.id,remote};
}
const roster=(...ps)=>ps.map(p=>({subject:p.player,name:p.name,playerId:1,score:0,flags:{},connectedAt:1}));
const page={camera:{feet:[10,5,10],yaw:90},luma:{mean:80,sd:30},hidden:false,quality:0.82,extra:'dropped'};
const gw={latencyMs:900,request:{pos:[10.5,5,10],yaw:92},reply:{pos:[30,5,10],yaw:150}};

test('jpegInfo reads frame sizes and refuses truncated data; page and gateway meta keep known fields only', ()=>{
 assert.deepEqual(jpegInfo(jpeg(1280,720)),{width:1280,height:720});
 assert.equal(jpegInfo(jpeg(1280,720).subarray(0,20)),null);
 assert.equal(jpegInfo(Buffer.from('not a jpeg')),null);
 const meta=cleanMeta({...page,camera:{feet:[1,2,'x']}},{latencyMs:-5,request:{pos:[0,0,0],yaw:9999}});
 assert.equal(meta.page.extra,undefined);assert.equal(meta.page.camera.pos,null);assert.equal(meta.gateway.latencyMs,null);assert.equal(meta.gateway.request.yaw,null);
 const checks=screenshotChecks(cleanMeta(page,gw));
 assert.deepEqual(checks,{positionDelta:0.5,yawDelta:2,latencyMs:900,blank:false,hidden:false,duplicateOf:null});
 assert.equal(screenshotChecks(cleanMeta({luma:{mean:0,sd:0.5}},{})).blank,true);
});

test('manual screenshots: staff of that server only, rank rules, one pending, delivered in the report, stored, viewed and deleted with audit', async()=>{
 const c=await central();
 try{
  const owner=await login(c,'owner'),mod=await login(c,'mod'),p=await login(c,'player'),stranger=await login(c,'stranger');
  const s=await server(c,owner,'Pilot'),base=`/admin/servers/${s.id}`;
  await act(c,owner)('POST',`${base}/roles`,{player:mod.player,role:'moderator'});
  assert.equal((await act(c,mod)('POST',`${base}/screenshot`,{player:p.player})).data.error,'player-offline');
  await s.remote.report({players:roster(p,owner),flags:[]});
  assert.equal((await act(c,stranger)('POST',`${base}/screenshot`,{player:p.player})).status,404);
  assert.equal((await act(c,mod)('POST',`${base}/screenshot`,{player:owner.player})).data.error,'target-outranks-you');
  const req=await act(c,mod)('POST',`${base}/screenshot`,{player:p.player});assert.equal(req.status,202);
  assert.equal((await act(c,mod)('POST',`${base}/screenshot`,{player:p.player})).data.error,'screenshot-pending');
  const sent=(await s.remote.report({players:roster(p,owner),flags:[]})).screenshots;
  assert.deepEqual(sent,[{id:req.data.screenshot,subject:p.player}]);
  assert.deepEqual((await s.remote.report({players:roster(p,owner),flags:[]})).screenshots,[]); // sent once
  // Another server's gateway cannot answer it.
  const other=await server(c,owner,'Other');
  assert.equal((await other.remote.screenshot({id:req.data.screenshot,ok:true,image:jpeg(640,360).toString('base64')})).status,404);
  assert.equal((await s.remote.screenshot({id:req.data.screenshot,ok:true,image:jpeg(1280,720).toString('base64'),meta:page,gateway:gw})).data.stored,true);
  assert.equal((await s.remote.screenshot({id:req.data.screenshot,ok:true,image:jpeg(1280,720).toString('base64')})).data.error,'not-pending');
  const list=(await act(c,mod)('GET',`${base}/screenshots?player=${p.player}`)).data;
  assert.equal(list.retentionDays,30);
  const shot=list.screenshots[0];assert.equal(shot.status,'done');assert.equal(shot.trigger,'manual');assert.equal(shot.requestedBy,'mod');
  assert.deepEqual([shot.width,shot.height],[1280,720]);assert.equal(shot.checks.positionDelta,0.5);
  // The image: staff of that server only; each viewer audited once per 10 minutes.
  const img=await fetch(c.base+shot.image,{headers:{cookie:mod.cookie}});
  assert.equal(img.headers.get('content-type'),'image/jpeg');assert.match(img.headers.get('content-security-policy'),/default-src 'none'/);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()),jpeg(1280,720));
  await fetch(c.base+shot.image,{headers:{cookie:mod.cookie}});
  assert.equal((await fetch(c.base+shot.image,{headers:{cookie:stranger.cookie}})).status,404);
  assert.equal(c.db.recentAudit(s.id,50).filter(e=>e.action==='admin.screenshot-view').length,1);
  // 30 s between manual requests for one player.
  assert.equal((await act(c,mod)('POST',`${base}/screenshot`,{player:p.player})).data.error,'screenshot-too-soon');
  // Moderators cannot delete evidence; admins and the owner can.
  assert.equal((await act(c,mod)('POST',`/admin/screenshots/${shot.id}/delete`)).data.error,'insufficient-role');
  assert.equal((await act(c,owner)('POST',`/admin/screenshots/${shot.id}/delete`)).status,200);
  assert.equal((await fetch(c.base+shot.image,{headers:{cookie:owner.cookie}})).status,404);
  const actions=c.db.recentAudit(s.id,50).map(e=>e.action);
  for(const a of ['admin.screenshot-request','admin.screenshot-view','admin.screenshot-delete'])assert.ok(actions.includes(a),a);
 }finally{await c.close();}
});

test('uploads: failures keep their reason, bad images and late answers are refused, repeats are marked duplicate', async()=>{
 const c=await central();
 try{
  const owner=await login(c,'owner'),p=await login(c,'player'),s=await server(c,owner,'Pilot'),base=`/admin/servers/${s.id}`;
  const ask=async()=>{c.clock.t+=LIMITS.manualGapMs;await s.remote.report({players:roster(p),flags:[]});const id=(await act(c,owner)('POST',`${base}/screenshot`,{player:p.player})).data.screenshot;await s.remote.report({players:roster(p),flags:[]});return id;};
  let id=await ask();
  assert.equal((await s.remote.screenshot({id,ok:false,reason:'tab-hidden'})).data.stored,false);
  id=await ask();assert.equal((await s.remote.screenshot({id,ok:true,image:Buffer.from('nope').toString('base64')})).data.error,'invalid-image');
  id=await ask();assert.equal((await s.remote.screenshot({id,ok:true,image:jpeg(32,32).toString('base64')})).data.error,'invalid-image');
  id=await ask();assert.equal((await s.remote.screenshot({id,ok:true,image:jpeg(640,360,LIMITS.maxBytes).toString('base64')})).data.error,'invalid-image');
  id=await ask();c.clock.t+=LIMITS.resultMs+1;assert.equal((await s.remote.screenshot({id,ok:true,image:jpeg(640,360).toString('base64')})).data.error,'late');
  const first=await ask();await s.remote.screenshot({id:first,ok:true,image:jpeg(640,360,5).toString('base64')});
  const second=await ask();await s.remote.screenshot({id:second,ok:true,image:jpeg(640,360,5).toString('base64')});
  const shots=(await act(c,owner)('GET',`${base}/screenshots`)).data.screenshots;
  assert.equal(shots.find(x=>x.id===second).checks.duplicateOf,first);
  assert.deepEqual(shots.filter(x=>x.status==='failed').map(x=>x.reason).sort(),['invalid-image','invalid-image','invalid-image','late','tab-hidden']);
  // A request never delivered (player left) fails as expired.
  c.clock.t+=LIMITS.manualGapMs;await s.remote.report({players:roster(p),flags:[]});
  await act(c,owner)('POST',`${base}/screenshot`,{player:p.player});c.clock.t+=LIMITS.queuedMs+1;await s.remote.report({players:[],flags:[]});
  assert.equal((await act(c,owner)('GET',`${base}/screenshots`)).data.screenshots[0].reason,'expired');
 }finally{await c.close();}
});

test('automatic screenshots: flags at or above the server severity, one per player per 10 minutes, off at 0', async()=>{
 const c=await central();
 try{
  const owner=await login(c,'owner'),p=await login(c,'player'),q=await login(c,'other'),s=await server(c,owner,'Pilot'),base=`/admin/servers/${s.id}`;
  const flag=(who,kind,severity)=>({subject:who.player,kind,severity,score:severity,at:c.clock.t,detail:{}});
  assert.deepEqual((await s.remote.report({players:roster(p,q),flags:[flag(p,'speed',10)]})).screenshots,[]);
  const r=await s.remote.report({players:roster(p,q),flags:[flag(p,'teleport',40)]});
  assert.equal(r.screenshots.length,1);assert.equal(r.screenshots[0].subject,p.player);
  const auto=(await act(c,owner)('GET',`${base}/screenshots`)).data.screenshots[0];
  assert.equal(auto.trigger,'auto');assert.equal(auto.flagKind,'teleport');assert.equal(auto.requestedBy,'anti-cheat');
  await s.remote.screenshot({id:auto.id,ok:true,image:jpeg(640,360).toString('base64')});
  c.clock.t+=5*60e3;assert.deepEqual((await s.remote.report({players:roster(p,q),flags:[flag(p,'teleport',40)]})).screenshots,[]);
  c.clock.t+=6*60e3;assert.equal((await s.remote.report({players:roster(p,q),flags:[flag(p,'teleport',40)]})).screenshots.length,1);
  // A flag for someone not in the roster asks nothing; severity 0 turns it off.
  assert.deepEqual((await s.remote.report({players:roster(p),flags:[flag(q,'teleport',40)]})).screenshots,[]);
  await act(c,owner)('POST',`${base}/policy`,{screenshotAutoSeverity:0});
  assert.deepEqual((await s.remote.report({players:roster(p,q),flags:[flag(q,'pellet-count',50)]})).screenshots,[]);
  assert.ok(c.db.recentAudit(s.id,50).some(e=>e.action==='anticheat.screenshot-request'&&e.actor==='anticheat'));
 }finally{await c.close();}
});

test('retention: images are deleted after the configured days, with an audit entry', async()=>{
 const c=await central({screenshotRetentionDays:7});
 try{
  const owner=await login(c,'owner'),p=await login(c,'player'),s=await server(c,owner,'Pilot'),base=`/admin/servers/${s.id}`;
  await s.remote.report({players:roster(p),flags:[]});
  const id=(await act(c,owner)('POST',`${base}/screenshot`,{player:p.player})).data.screenshot;
  await s.remote.report({players:roster(p),flags:[]});await s.remote.screenshot({id,ok:true,image:jpeg(640,360).toString('base64')});
  assert.equal((await act(c,owner)('GET',`${base}/screenshots`)).data.retentionDays,7);
  c.clock.t+=6*86400e3;await s.remote.report({players:[],flags:[]});
  assert.equal((await act(c,owner)('GET',`${base}/screenshots`)).data.screenshots.length,1);
  c.clock.t+=2*86400e3;await s.remote.report({players:[],flags:[]});
  const again=await login(c,'owner'); // the first session has expired (7 days)
  assert.equal((await act(c,again)('GET',`${base}/screenshots`)).data.screenshots.length,0);
  assert.equal(c.db.raw.prepare('select count(*) n from screenshot_images').get().n,0);
  assert.ok(c.db.recentAudit(s.id,20).some(e=>e.action==='screenshots-expired'&&JSON.parse(e.detail).count===1));
 }finally{await c.close();}
});

test('gateway capture: asks the right session, adds its own pose, times out, refuses when not connected', async()=>{
 const t={now:1000},svc=createGatewayService({admission:{},native:{host:'127.0.0.1',port:1},allowedOrigins:[],wallNow:()=>t.now});
 try{
  const sent=[],session={state:'in-game',join:{subject:'s1'},watch:{prev:{pos:[1,2,3]},lastAim:{yaw:45}},reply:m=>sent.push(m)};svc.sessions.add(session);
  assert.deepEqual(await svc.capture('nobody','x'),{ok:false,reason:'not-connected'});
  const pending=svc.capture('s1','req-1');
  assert.deepEqual(sent,[{type:'capture',id:'req-1'}]);
  assert.deepEqual(await svc.capture('s1','req-2'),{ok:false,reason:'busy'});
  t.now=1800;session.watch.prev.pos=[2,2,3];session.capture.finish({ok:true,image:'AAAA',meta:{a:1}});
  assert.deepEqual(await pending,{ok:true,image:'AAAA',meta:{a:1},gateway:{latencyMs:800,request:{pos:[1,2,3],yaw:45},reply:{pos:[2,2,3],yaw:45}}});
  assert.deepEqual((await svc.capture('s1','req-3',10)).reason,'no-response');
 }finally{svc.sessions.clear();svc.close();}
});

test('page capture: sizes, blank detection, background maths, and one frame copy per waiting request', async()=>{
 assert.deepEqual(captureSize(2560,1440),{width:1280,height:720,scale:0.5});
 assert.deepEqual(captureSize(800,600),{width:800,height:600,scale:1});
 assert.deepEqual(lumaStats(new Uint8ClampedArray(64*4).fill(0),1),{mean:0,sd:0});
 assert.ok(lumaStats(Uint8ClampedArray.from({length:64*4},(_,i)=>i%8<4?255:0),1).sd>100);
 assert.equal(backgroundUrl('url("/hud/a.png"), linear-gradient(red, blue)'),'/hud/a.png');
 assert.deepEqual(backgroundBox(['200px','auto'],{width:50,height:50},{naturalWidth:400,naturalHeight:100}),[200,50]);
 assert.deepEqual(backgroundBox(['100%','100%'],{width:50,height:20},{naturalWidth:400,naturalHeight:100}),[50,20]);
 assert.deepEqual(backgroundBox(['auto'],{width:50,height:20},{naturalWidth:40,naturalHeight:10}),[40,10]);
 // A fake document: canvases record draws; toBlob returns a small "JPEG".
 const draws=[],ctx={drawImage:(...a)=>draws.push(a[0]),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(90)}),fillRect(){},fillText(){},measureText:()=>({width:100}),set font(v){},set fillStyle(v){},set globalAlpha(v){},set textBaseline(v){}};
 const doc={hidden:false,hasFocus:()=>true,defaultView:{innerWidth:1600,innerHeight:900,devicePixelRatio:2},
  createElement:()=>({getContext:()=>ctx,toBlob:(cb)=>cb(new Blob([new Uint8Array([0xff,0xd8,1,2,0xff,0xd9])]))})};
 const game={clientWidth:1600,clientHeight:900};
 const cap=createAdminCapture({canvas:game,document:doc,pose:()=>({feet:[1,2,3],yaw:Math.PI/2,pitch:0}),paint:async()=>7});
 const a=cap.request('11111111-aaaa'),b=cap.request('22222222-bbbb');
 cap.frame();cap.frame();
 const [ra,rb]=await Promise.all([a,b]);
 assert.equal(draws.filter(d=>d===game).length,2); // one copy per request, both from the same frame
 assert.equal(ra.ok,true);assert.equal(ra.image,Buffer.from([0xff,0xd8,1,2,0xff,0xd9]).toString('base64'));
 assert.deepEqual(ra.meta.camera,{feet:[1,2,-3],yaw:-90});assert.equal(ra.meta.overlays,7);assert.deepEqual(ra.meta.luma,{mean:90,sd:0});
 assert.equal(ra.meta.quality,CAPTURE.qualities[0]);assert.equal(rb.ok,true);
 // No frame within the wait (a hidden tab renders none).
 const hidden=createAdminCapture({canvas:game,document:{...doc,hidden:true},paint:async()=>0});
 const orig=CAPTURE.frameWaitMs;assert.equal(orig,3000);
 const r=await Promise.race([hidden.request('x'),new Promise(res=>setTimeout(()=>res('pending'),3200))]);
 assert.deepEqual(r,{ok:false,reason:'tab-hidden'});
});
