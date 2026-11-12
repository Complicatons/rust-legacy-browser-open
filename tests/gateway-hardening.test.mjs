// Gateway and server-message edge cases (GAP-AUDIT.md "Gateway and server-message edge cases, 2026-10-23"): one
// browser's malformed traffic ends only its own session; leftover browser leases are kicked when a gateway starts.
// Mock stack only (tests/helpers/gateway-stack.mjs); the original server is not involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import WebSocket from 'ws';
import {commandShape,guardProcess} from '../bridge/gateway-service.mjs';
import {gatewayStack as stack,SERVER,until} from './helpers/gateway-stack.mjs';

test('commandShape: defaults item data and rpc args, refuses shapes no page sends', ()=>{
 assert.deepEqual(commandShape({type:'item',viewId:5,action:'bullet-fire',data:null}).data,{});
 assert.deepEqual(commandShape({type:'rpc',viewId:5,name:'RequestRespawn'}).args,[]);
 assert.equal(commandShape({type:'rpc',viewId:5,name:'RequestRespawn',args:null}),null);
 assert.equal(commandShape({type:'rpc',viewId:5,name:'RequestRespawn',args:'x'}),null);
 assert.equal(commandShape({type:'item',viewId:'5',action:'bullet-fire'}),null);
 assert.equal(commandShape({type:'item',viewId:5,action:'bullet-fire',data:[1]}),null);
 assert.equal(commandShape({type:'inventory',action:'refresh',source:null}),null);
 assert.equal(commandShape({type:'context',action:'query',target:7}),null);
 const ok={type:'context',action:'quick'};assert.equal(commandShape(ok),ok);
});

test('malformed commands from one browser never end the gateway or another player\'s session', async()=>{
 const lines=[],s=await stack({log:(...a)=>lines.push(a.join(' '))});
 try{
  const a=await s.join('acct-a'),b=await s.join('acct-b');
  assert.equal(a.approved.type,'approved');assert.equal(b.approved.type,'approved');
  a.peer.create({viewId:10,prefab:'ServerManagement'});a.peer.create({viewId:20,owner:a.peer.playerId,prefab:'ItemRep'});
  await until(()=>a.inbox.filter(e=>e.type==='create').length===2);
  // The shapes that threw in anti-cheat (data.hits, data.origin) and the bridge (args.length, args.map).
  for(const cmd of [{type:'item',viewId:20,action:'bullet-fire',data:null},{type:'item',viewId:20,action:'bow-fire',data:null},{type:'item',viewId:20,action:'bow-hit',data:null},
   {type:'rpc',viewId:10,name:'RequestRespawn',args:null},{type:'rpc',viewId:10,name:'RequestRespawn',args:'x'},{type:'inventory',action:'refresh',source:null}])a.ws.send(JSON.stringify(cmd));
  await until(()=>a.inbox.filter(e=>e.type==='command-rejected').length>=4);
  assert.equal(a.ws.readyState,WebSocket.OPEN,'bad shapes are refused, not fatal');
  // Any other failure inside one session's handling ends that session alone: 'malformed', close 4002.
  const session=[...s.gateway.sessions].find(x=>x.join?.subject==='acct-a');
  session.bridge.command=()=>{throw new TypeError('boom');};
  const closed=once(a.ws,'close');a.ws.send(JSON.stringify({type:'ready'}));
  assert.equal((await closed)[0],4002);
  assert.ok(a.inbox.some(e=>e.type==='error'&&e.reason==='malformed'));
  assert.equal(s.gateway.metrics.sessionErrors,1);
  assert.ok(lines.some(l=>/error in browser message TypeError: boom/.test(l)));
  // The other player is still in the game and still gets server traffic.
  assert.equal(b.ws.readyState,WebSocket.OPEN);
  b.peer.create({viewId:30,prefab:'ServerManagement'});
  await until(()=>b.inbox.some(e=>e.type==='create'&&e.viewId===30));
  // The first account can come straight back (its native session ended with a Lidgren Disconnect).
  await until(()=>s.adapter.stats().leases===1);
  const again=await s.join('acct-a');assert.equal(again.approved.type,'approved');
  again.ws.close();b.ws.close();
 }finally{await s.close();}
});

test('non-object JSON and binary frames end only that session as malformed', async()=>{
 const s=await stack();
 try{
  for(const raw of ['null','42','[1,2]','{"no":"type"}']){
   const ws=s.open();await once(ws,'open');const reply=once(ws,'message'),closed=once(ws,'close');ws.send(raw);
   assert.deepEqual(JSON.parse(String((await reply)[0])),{type:'error',reason:'malformed'});assert.equal((await closed)[0],4002);
  }
 }finally{await s.close();}
});

test('guardProcess logs stray errors and rejections without exiting, once per process', ()=>{
 const proc=new EventEmitter(),lines=[];
 assert.equal(guardProcess({proc,log:(...a)=>lines.push(a.join(' '))}),true);
 assert.equal(guardProcess({proc,log:()=>{}}),false);
 proc.emit('uncaughtException',new Error('stray'));proc.emit('unhandledRejection',new Error('lost'));
 assert.equal(lines.length,2);assert.match(lines[0],/uncaught exception \(gateway kept running\).*stray/);assert.match(lines[1],/unhandled rejection.*lost/);
});

test('a restarted gateway has the plugin kick browser sessions its previous process left on the server', async()=>{
 const s=await stack();
 try{
  const a=await s.join('acct-a');assert.equal(a.approved.type,'approved');
  // The gateway process dies: its native session goes silent without a Lidgren Disconnect, the lease stays.
  const session=[...s.gateway.sessions].find(x=>x.join?.subject==='acct-a');
  session.client.connection.state='closed';session.socket.close();s.gateway.sessions.delete(session);
  assert.equal(s.adapter.stats().leases,1);
  // No plugin roster yet: every browser lease is kicked through the plugin (its disconnect report frees the lease).
  const r=s.control({type:'gateway-started',serverId:SERVER});
  assert.deepEqual(r,{ok:true,kicked:1,released:0});
  const commands=s.adapter.takeCommands();
  assert.equal(commands.length,1);assert.equal(commands[0].action,'kick-native');assert.equal(commands[0].reason,'gateway-restarted');
  assert.deepEqual(s.control({type:'gateway-started',serverId:SERVER}),{ok:true,kicked:1,released:0},'kicked again only once delivered');
  s.adapter.takeCommands();
  // With a fresh roster that no longer lists the player (the server already dropped it), the lease is released at once.
  s.adapter.setRoster([]);
  assert.deepEqual(s.control({type:'gateway-started',serverId:SERVER}),{ok:true,kicked:0,released:1});
  assert.equal(s.adapter.stats().leases,0);
  // Native and desktop leases are never touched.
  s.adapter.onNativeAuthenticated({backendId:'76561190000000001',connection:'native-1'});
  s.adapter.setRoster([{id:'76561190000000001',name:'Native'}]);
  assert.deepEqual(s.control({type:'gateway-started',serverId:SERVER}),{ok:true,kicked:0,released:0});
  a.ws.terminate();
 }finally{await s.close();}
});

// ---- 2: backpressure ----
test('a page that stops reading gets merged position updates, then is ended as a slow consumer at the cap', async()=>{
 const soft=64*1024,hard=1024*1024,s=await stack({gateway:{limits:{softBufferBytes:soft,hardBufferBytes:hard}}});
 try{
  const a=await s.join('acct-a'),b=await s.join('acct-b');
  a.peer.create({viewId:5000,owner:9,prefab:':player_soldier'});
  await until(()=>a.inbox.some(e=>e.type==='create'&&e.viewId===5000));
  const session=[...s.gateway.sessions].find(x=>x.join?.subject==='acct-a'),big='x'.repeat(50_000);
  const gnup=()=>session.bridge.emit('event',{type:'rpc',viewId:1,name:'GNUP',args:{class:'Inventory',values:[big]}});
  const move=i=>session.bridge.emit('event',{type:'rpc',viewId:5000,name:'ReadClientMove',args:{class:'HumanController',values:[[i,0,0],0,0,0]}});
  // The page stops reading: unsent bytes pile up past the soft threshold.
  a.ws._socket.pause();
  for(let i=0;i<400&&session.ws.bufferedAmount<=soft;i++){gnup();await new Promise(r=>setImmediate(r));}
  assert.ok(session.ws.bufferedAmount>soft&&session.ws.bufferedAmount<hard,`buffered ${session.ws.bufferedAmount}`);
  for(let i=1;i<=5;i++)move(i);
  assert.equal(s.gateway.metrics.coalesced,5);
  // Reading again: the backlog drains and only the newest of the merged moves follows.
  a.ws._socket.resume();
  await until(()=>a.inbox.some(e=>e.name==='ReadClientMove'));
  const moves=a.inbox.filter(e=>e.name==='ReadClientMove');
  assert.equal(moves.length,1);assert.deepEqual(moves[0].args.values[0],[5,0,0]);
  // Stopped again for good: the session ends at the hard cap; the gateway and the other player carry on.
  a.ws._socket.pause();
  for(let i=0;i<200&&s.gateway.sessions.has(session);i++){gnup();await new Promise(r=>setImmediate(r));}
  assert.equal(s.gateway.sessions.has(session),false,'slow consumer ended');
  assert.equal(s.gateway.metrics.slowConsumers,1);
  await until(()=>s.native.peers.size===1); // its native session said goodbye
  b.peer.create({viewId:30,prefab:'ServerManagement'});
  await until(()=>b.inbox.some(e=>e.type==='create'&&e.viewId===30));
  a.ws.terminate();b.ws.close();
 }finally{await s.close();}
});

// ---- 3: liveness ----
test('a socket that stops answering pings is ended with a Lidgren Disconnect; a quiet live page gets keepalives', async()=>{
 const s=await stack({gateway:{limits:{pingIntervalMs:60,missedPongs:2}}});
 try{
  const live=await s.join('acct-live'),dead=await s.join('acct-dead',{wsOptions:{autoPong:false}});
  assert.equal(dead.approved.type,'approved');assert.equal(s.native.peers.size,2);
  const closed=once(dead.ws,'close');
  await closed;
  assert.equal(s.gateway.metrics.pingTimeouts,1);
  await until(()=>s.native.peers.size===1); // the server saw the disconnect at once (no 60 s timeout)
  await until(()=>s.adapter.stats().leases===1);
  // The answering page stays, and hears a keepalive while nothing else is sent.
  await until(()=>live.inbox.some(e=>e.type==='keepalive'));
  assert.equal(live.ws.readyState,WebSocket.OPEN);
  live.ws.close();
 }finally{await s.close();}
});

// A WebSocket stand-in for the page side (as tests/online.test.mjs).
class FakeSocket extends EventTarget{static last;constructor(url){super();this.url=url;this.sent=[];this.readyState=1;this.closes=[];FakeSocket.last=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
 send(d){this.sent.push(JSON.parse(d));}close(code,reason){this.closes.push([code,reason]);this.readyState=3;}
 closeNow(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 push(o){this.dispatchEvent(Object.assign(new Event('message'),{data:JSON.stringify(o)}));}}
const page=async(now)=>{
 const {OnlineSession}=await import('../browser/online.mjs');
 const s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},WebSocketImpl:FakeSocket,now});const p=s.connect();
 await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;ws.push({type:'approved',playerId:1,world:{sendRate:10}});await p;return {s,ws};
};

test('the page ends the session after 60 s without any gateway message and shows "Disconnected from server."', async()=>{
 let t=0;const {s,ws}=await page(()=>t);let closed=0;s.addEventListener('closed',()=>closed++);
 t=59;assert.equal(s.client.checkAlive(),false);
 ws.push({type:'keepalive'}); // any message counts
 t=118;assert.equal(s.client.checkAlive(),false);
 t=119.5;assert.equal(s.client.checkAlive(),true);
 assert.equal(s.state,'closed');assert.equal(closed,1);assert.deepEqual(ws.closes,[[4000,'gateway silent']]);
 assert.equal(s.disconnectText(),'Disconnected from server.');
 // The browser's own close event, whenever it comes, does not end the session twice.
 ws.closeNow();assert.equal(closed,1);assert.equal(s.client.checkAlive(),false);
});

// ---- 7: gateway kick reasons ----
test('gateway kicks show the original kick texts (KP NetError NiceStrings); a server KP wins', async()=>{
 const want={anticheat:'Disconnected (Kicked because of violation)',kicked:'Disconnected (Kicked by admin)',banned:'Disconnected (Kicked and Banned by admin)',replaced:'Disconnected (Changed connection): this account joined the server again from another tab, window or device',whatever:'Disconnected (Kicked by admin)'};
 for(const [reason,text] of Object.entries(want)){const {s,ws}=await page(()=>0);ws.push({type:'kicked',reason});ws.closeNow();assert.equal(s.disconnectText(),text,reason);}
 const {s,ws}=await page(()=>0);
 ws.push({type:'rpc',viewId:1,name:'KP',args:{class:'ServerManagement',values:[128]}});ws.push({type:'kicked',reason:'anticheat'});ws.closeNow();
 assert.equal(s.disconnectText(),'Disconnected (Server restarting)');
});

test('an admin ban kick reaches the page as {type:kicked, reason:banned} before the close', async()=>{
 const s=await stack();
 try{
  const a=await s.join('acct-a');const closed=once(a.ws,'close');
  assert.equal(s.gateway.kick('acct-a','banned'),true);
  assert.equal((await closed)[0],4010);
  assert.deepEqual(a.inbox[0],{type:'kicked',reason:'banned'});
 }finally{await s.close();}
});

test('a native KP kick (the original server\'s own reason, e.g. TruthDetector violation) is traced and counted by code', async()=>{
 const lines=[],s=await stack({log:(...a)=>lines.push(a.join(' '))});
 try{
  const a=await s.join('acct-a');
  a.peer.create({viewId:10,prefab:'ServerManagement'});
  await until(()=>a.inbox.some(e=>e.type==='create'&&e.viewId===10));
  a.peer.rpc(10,'KP',['int'],[141]);
  await until(()=>a.inbox.some(e=>e.type==='rpc'&&e.name==='KP'));
  const closed=once(a.ws,'close');a.peer.connection.close('violation');
  await closed;
  assert.equal(s.gateway.metrics.kickCodes[141],1);
  assert.ok(lines.some(l=>/native closed violation kickCode=141 \(Facepunch_Kick_Violation\)/.test(l)),lines.join('\n'));
 }finally{await s.close();}
});

// ---- 4: group and player destroys release line-of-sight walls ----
const fakeLos=()=>{const held=new Map();return {held,retain:(k)=>{held.set(k,(held.get(k)??0)+1);return true;},release:k=>{const n=held.get(k)-1;if(n>0)held.set(k,n);else held.delete(k);}};};

test('DestroyInGroup (cell exit) gives the session\'s walls back to the shared line-of-sight world', async()=>{
 const los=fakeLos(),s=await stack({gateway:{anticheat:{lineOfSight:los}}});
 try{
  const a=await s.join('acct-a');
  a.peer.create({viewId:5000,prefab:'!Ng',group:105});
  a.peer.ngcCreate(5000,{prefabIndex:1,innerID:7,position:[1,2,3],euler:[0,0,0]});
  await until(()=>a.inbox.some(e=>e.type==='ngc-create'));
  assert.deepEqual([...los.held.keys()],['5000:7']);
  a.peer.destroyGroup(105);
  await until(()=>a.inbox.some(e=>e.type==='destroy'));
  const destroy=a.inbox.find(e=>e.type==='destroy');
  assert.deepEqual(destroy,{type:'destroy',kind:'group',group:105},'the page protocol is unchanged (no view list)');
  assert.equal(los.held.size,0,'released');
  const watch=[...s.gateway.sessions].find(x=>x.join?.subject==='acct-a').watch;
  assert.equal(watch.entities.size,0);assert.equal(watch.groups.size,0);
  a.ws.close();
 }finally{await s.close();}
});

test('PlayerWatch releases walls for every view a player or group destroy lists', async()=>{
 const {PlayerWatch}=await import('../bridge/anticheat.mjs');
 const los=fakeLos(),w=new PlayerWatch({subject:'s',name:'n',playerId:1,lineOfSight:los});
 w.observe({type:'create',viewId:50,prefab:'!Ng',owner:4,group:105,mine:false,position:[0,0,0]});
 w.observe({type:'create',viewId:51,prefab:':player_soldier',owner:4,group:105,mine:false,position:[5,0,5]});
 w.observe({type:'ngc-create',carrier:50,innerID:7,prefab:';struct_wood_wall',position:[1,2,3],euler:[0,0,0]});
 assert.equal(los.held.size,1);
 w.observe({type:'destroy',kind:'player',player:4,views:[50,51]}); // DestroyByPlayerID on a disconnect
 assert.equal(los.held.size,0);assert.equal(w.entities.size,0);assert.equal(w.groups.size,0);assert.equal(w.positions.size,0);
});

// ---- 5: far-future move stamps ----
test('far-future move clocks cannot overflow the send timer or stall the move queue', async()=>{
 const {GameBridge}=await import('../bridge/game-bridge.mjs');
 let t=0,sent=0;const client=Object.assign(new EventEmitter(),{playerId:1,sendRpc:()=>sent++,serverMs:()=>BigInt(Math.round(t*1000))+100000n,resyncClock:()=>{}});
 const b=new GameBridge({client,schema:{},playerName:'n',now:()=>t});b.views.set(20,{prefab:':player_soldier',owner:1,group:0});
 const warnings=[];const onWarning=w=>warnings.push(w.name);process.on('warning',onWarning);
 try{
  for(let i=0;i<50;i++){t+=0.2;b.command({type:'move',origin:[i*0.5,0,0],angles:{pitch:0,yaw:0},stateFlags:0,at:i===0?0:1e10*i});}
  await new Promise(r=>setTimeout(r,50));
  assert.ok(b.clampedMoves>=48,`clamped ${b.clampedMoves}`);
  assert.ok(b.moveQueue.length<=32,`queued ${b.moveQueue.length}`);
  assert.ok(sent>0,'moves still reach the server');
  if(b.moveTimer)assert.ok(b.moveTimer._idleTimeout<=1000,`timer ${b.moveTimer._idleTimeout} ms`);
  assert.deepEqual(warnings.filter(n=>n==='TimeoutOverflowWarning'),[]);
  // The clock catching up drains the queue.
  t+=60;b.sendMoves();assert.equal(b.moveQueue.length,0);
 }finally{process.off('warning',onWarning);b.dispose();}
});

// ---- 6: pre-login limits ----
const refused=ws=>new Promise(r=>{ws.on('unexpected-response',(req,res)=>r(res.statusCode));ws.on('error',()=>{});});

test('open sockets are limited per client address (forwarding headers from trusted proxies only) and in total', async()=>{
 const {createClientIp}=await import('../bridge/client-ip.mjs');
 const s=await stack({gateway:{limits:{perIp:2,maxConnections:4},clientIp:createClientIp(['loopback'])}});
 try{
  const from=ip=>s.open({'x-forwarded-for':ip});
  const a1=from('203.0.113.1'),a2=from('203.0.113.1');await Promise.all([once(a1,'open'),once(a2,'open')]);
  assert.equal(await refused(from('203.0.113.1')),429);
  const b1=from('203.0.113.2'),b2=from('203.0.113.2');await Promise.all([once(b1,'open'),once(b2,'open')]);
  assert.equal(await refused(from('203.0.113.3')),429,'total cap');
  assert.equal(s.gateway.metrics.upgradeLimited,2);
  // A closed socket frees its place.
  a1.close();await once(a1,'close');
  let reopened=false;
  for(let i=0;i<100&&!reopened;i++){const c=from('203.0.113.1');reopened=await Promise.race([once(c,'open').then(()=>true),refused(c).then(()=>false)]);if(reopened)c.close();else await new Promise(r=>setTimeout(r,10));}
  assert.ok(reopened,'the address got its place back');
  for(const w of [a2,b1,b2])w.terminate();
 }finally{await s.close();}
});

test('join tickets are rate-limited per address and capacity is enforced, not only advertised', async()=>{
 const s=await stack({gateway:{limits:{admitsPerMinute:2,capacity:1}}});
 try{
  const a=await s.join('acct-a');assert.equal(a.approved.type,'approved');
  const b=await s.join('acct-b');assert.deepEqual(b.approved,{type:'denied',reason:'server-full',error:17});
  const c=await s.join('acct-c');assert.deepEqual(c.approved,{type:'denied',reason:'rate-limited'});
  assert.equal(s.gateway.metrics.denied['server-full'],1);assert.equal(s.gateway.metrics.denied['rate-limited'],1);
  a.ws.close();
 }finally{await s.close();}
});

test('before admission a socket may send only small messages; while joining only a few', async()=>{
 const s=await stack({gateway:{limits:{preApprovalMessages:3}},wrapAdmission:()=>({admit:()=>new Promise(()=>{})})});
 try{
  // Over the frame limit before any admission: ws refuses it (1009) without buffering 600 KB; the gateway carries on.
  const big=s.open();big.on('error',()=>{});await once(big,'open');const bigClosed=once(big,'close');big.send('x'.repeat(20_000));
  assert.equal((await bigClosed)[0],1009);
  // A join that is still being admitted: a few stray messages are answered, then the socket is ended.
  const ws=s.open();await once(ws,'open');const inbox=[];ws.on('message',m=>inbox.push(JSON.parse(String(m))));
  ws.send(JSON.stringify({type:'admit',ticket:'t'}));
  for(let i=0;i<4;i++)ws.send(JSON.stringify({type:'move'}));
  const [code]=await once(ws,'close');
  assert.equal(code,4002);assert.equal(inbox.filter(e=>e.reason==='unsupported').length,3);
 }finally{await s.close();}
});

test('the larger screenshot message is accepted only while that capture is pending', async()=>{
 const s=await stack();
 try{
  const a=await s.join('acct-cap');a.ws.on('error',()=>{});
  const pending=s.gateway.capture('acct-cap','shot-1');
  await until(()=>a.inbox.some(e=>e.type==='capture'));
  a.ws.send(JSON.stringify({type:'capture',id:'shot-1',ok:true,image:'A'.repeat(300_000)}));
  assert.equal((await pending).image.length,300_000);
  const closed=once(a.ws,'close');a.ws.send(JSON.stringify({type:'capture',id:'shot-2',ok:true,image:'A'.repeat(300_000)}));
  assert.equal((await closed)[0],1009);
 }finally{await s.close();}
});

// ---- 8: RPCs and NGC calls for views the session does not have ----
test('RPCs for missing views and NGC calls for missing entities are dropped and counted, scene views kept', async()=>{
 const s=await stack();
 try{
  const a=await s.join('acct-a');
  a.peer.rpc(5000,'GNUP',['byte[]'],[new Uint8Array(4)]); // never Created
  a.peer.create({viewId:5001,prefab:'!Ng',group:9});
  a.peer.ngcCall(5001,{innerID:3,messageID:0,args:new Uint8Array(4)}); // no such NGC entity
  a.peer.rpc(998,'Context:I',[],[]); // the scene's Context view is never Created and still works
  await until(()=>a.inbox.some(e=>e.viewId===998));
  const m=s.gateway.metrics.missingView;
  assert.deepEqual([m.rpc,m.ngc],[1,1]);
  assert.ok(!a.inbox.some(e=>e.viewId===5000||e.type==='ngc-call'),'nothing reached the page');
  a.ws.close();
 }finally{await s.close();}
});

test('gateway config: capacity and limits are validated; an isolated test VM is not held to per-address limits', async()=>{
 const {validateConfig,gatewayLimits}=await import('../bridge/gateway-launcher.mjs');
 const errs=c=>validateConfig({serverId:SERVER,centralUrl:'https://a.test',credential:'x'.repeat(43),native:{host:'127.0.0.1',port:1},allowedOrigins:['https://a.test'],sidecarUrl:'http://127.0.0.1:1',controlKeyHex:'ab'.repeat(32),listen:{host:'127.0.0.1'},...c});
 assert.deepEqual(errs({capacity:100,limits:{perIp:20}}),[]);
 assert.equal(errs({capacity:0}).length,1);assert.equal(errs({limits:{perIp:0}}).length,1);assert.equal(errs({limits:{nope:1}}).length,1);assert.equal(errs({limits:{capacity:5}}).length,1);
 assert.deepEqual(gatewayLimits({capacity:100}),{capacity:100});
 assert.equal(gatewayLimits({mode:'vm-test'}).perIp,256);assert.equal(gatewayLimits({mode:'vm-test',limits:{perIp:3}}).perIp,3);
});
