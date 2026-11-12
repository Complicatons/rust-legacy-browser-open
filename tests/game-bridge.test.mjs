// GameBridge against the mock uLink server over loopback UDP: views, RPC decoding, NGC, commands. Mocks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {UlinkClient} from '../bridge/ulink/session.mjs';
import {widenTimestamp,decodeHeader} from '../bridge/ulink/ulink.mjs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';
import {GameBridge} from '../bridge/game-bridge.mjs';
import {BitReader} from '../bridge/ulink/bits.mjs';
import {readArgs,writeArgs,decodeAngles,monoStringHash,ngcAction,ngcAddName,ngcBufferedCallName,ngcWire} from '../bridge/ulink/rust.mjs';

const schema=JSON.parse(await readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
const world={level:'rust_island_2013',sendRate:20,hostname:'Mock',modded:false,official:false,steamId:1n,ip:1,port:28015};
// ;deploy_camp_bonfire's message table (CampfireInventory, FireBarrel, DeployableObject; tools/export_ngc_registry.py).
const bonfire=[['CFAR',['uLink.BitStream']],['CLEV',['byte','int']],['GNUP',['byte[]']],['ISMV',['byte','byte']],['ITMG',['NetEntityID','byte','byte','bool']],
 ['ITMV',['NetEntityID','byte','byte']],['ITSM',['byte','byte','bool']],['ITSP',['byte']],['SVUC',['byte']],['SVUF',[]],['ClearLooter',[]],['ReceiveNetState',['bool']],
 ['SetLooter',['uLink.NetworkPlayer']],['StopLooting',[]],['TakeAll',[]],['Client_OnKilled',[]],['ClientHealthUpdate',['float']],['GetOwnerInfo',['ulong','ulong']]].map(([name,params])=>({name,params}));
const registry={prefabs:[{handle:';deploy_wood_box',index:-42,messages:[{name:'ClientHealthUpdate',params:['float']}]},
 {handle:';deploy_metal_door',index:-43,messages:[{name:'DOc',params:['sbyte']},{name:'DOo',params:['sbyte','ulong']}]},
 {handle:';deploy_camp_bonfire',index:-44,messages:bonfire}]};
const now=()=>performance.now()/1000;
const name='b'; // Mono hash even → parity starts false
const within=(p,ms=4000)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(Error('timed out')),ms))]);

async function setup(){
 const server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const socket=createSocket('udp4');await new Promise(r=>socket.bind(0,'127.0.0.1',r));
 const client=new UlinkClient({now,login:{userId:5n,name,ticket:new Uint8Array(4)},send:b=>socket.send(b,server.port,'127.0.0.1')});
 socket.on('message',m=>client.receive(new Uint8Array(m)));
 const bridge=new GameBridge({client,schema,ngcRegistry:registry,playerName:name,sendRate:world.sendRate,now});
 const events=[];bridge.on('event',e=>events.push(e));
 const timer=setInterval(()=>{client.tick();bridge.tick();},5);
 client.start();
 await within(once(client,'approved'));
 const [peer]=server.peers.values();
 const wait=async pred=>{const t=Date.now();while(Date.now()-t<3000){const e=events.find(pred);if(e)return e;await new Promise(r=>setTimeout(r,5));}throw Error('event not seen');};
 const received=async pred=>{const t=Date.now();while(Date.now()-t<3000){const e=peer.received.find(pred);if(e)return e;await new Promise(r=>setTimeout(r,5));}throw Error('server did not receive');};
 return {server,peer,client,bridge,events,wait,received,close:async()=>{clearInterval(timer);client.close();socket.close();await server.close();}};
}

test('creates, ready, timestamped moves with parity, and decoded server RPCs', async()=>{
 const s=await setup();
 try{
  assert.ok(s.client.offset!==undefined);
  s.peer.create({viewId:10,prefab:'ServerManagement'});
  s.peer.create({viewId:20,owner:s.client.playerId,prefab:':player_soldier',position:[1,2,3]});
  s.peer.create({viewId:30,owner:99,prefab:':player_soldier'});
  const mine=await s.wait(e=>e.type==='create'&&e.viewId===20);
  assert.deepEqual([mine.mine,mine.prefab,mine.position],[true,':player_soldier',[1,2,3]]);
  await s.wait(e=>e.type==='create'&&e.viewId===30);

  const args=[];s.peer.onUlink=(h,b)=>{if(h.rpc==='GetClientMove')args.push(readArgs(['Vector3','int','ushort'],b));};
  assert.equal(s.bridge.command({type:'ready'}),true);
  const ready=await s.received(h=>h.rpc==='ClientFirstReady');assert.equal(ready.viewId,10);
  assert.equal(s.bridge.command({type:'move',origin:[4,5,6],angles:{pitch:10,yaw:90},stateFlags:1}),true);
  assert.equal(s.bridge.command({type:'move',origin:[4,5,6],angles:{pitch:10,yaw:90}}),false); // spacing < 0.9/sendRate
  await new Promise(r=>setTimeout(r,60));
  assert.equal(s.bridge.command({type:'move',origin:[4,5,7],angles:{pitch:10,yaw:90},stateFlags:1}),true);
  const move=await s.received(h=>h.rpc==='GetClientMove');
  assert.deepEqual([move.viewId,move.timestampBits],[20,16]);
  await s.received(h=>h.rpc==='GetClientMove'&&args.length===2);
  assert.equal(monoStringHash(name)&1,0);
  assert.deepEqual(args.map(a=>a[2]),[1,0x4001]); // first move seeds parity, second carries 0x4000
  assert.ok(Math.abs(decodeAngles(args[0][1]).yaw-90)<0.01);

  s.peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[7,8,9],0,0,0.5]);
  const rpc=await s.wait(e=>e.type==='rpc'&&e.name==='ReadClientMove');
  assert.deepEqual([rpc.viewId,rpc.args.class,rpc.args.values[0],rpc.args.values[3]],[30,'HumanController',[7,8,9],0.5]);

  s.peer.destroyView(30);
  await s.wait(e=>e.type==='destroy'&&e.viewId===30);
  assert.equal(s.bridge.views.has(30),false);
 }finally{await s.close();}
});

test('NGC carrier traffic is decoded with the registry', async()=>{
 const s=await setup();
 try{
  s.peer.create({viewId:40,prefab:'!Ng',group:7});
  await s.wait(e=>e.type==='create'&&e.viewId===40);
  s.peer.ngcCreate(40,{prefabIndex:-42,innerID:3,position:[1,1,1],euler:[0,45,0]});
  const created=await s.wait(e=>e.type==='ngc-create');
  assert.deepEqual([created.prefab,created.innerID,created.euler],[';deploy_wood_box',3,[0,45,0]]);
  const f=new Float32Array([0.75]);s.peer.ngcCall(40,{innerID:3,messageID:0,args:new Uint8Array(f.buffer)});
  const call=await s.wait(e=>e.type==='ngc-call');
  assert.deepEqual([call.name,call.args],['ClientHealthUpdate',[0.75]]);
 }finally{await s.close();}
});

// The original server names every buffered carrier RPC per entity (NGC.GenerateRPCName: "A" + innerID hex;
// NGCView.GetBufferedCallRPCName: "C" + innerID hex + "_" + message hex) and a joining player gets them inside one
// BufferedRPCs. Exact "A"/"C" matching dropped every resource node on the real server (P5 gather.node: known 0).
test('NGC entities with the original per-entity RPC names, buffered on join, are decoded', async()=>{
 const s=await setup();
 try{
  const health=new Float32Array([0.5]);
  s.peer.buffered([
   s.peer.create({viewId:40,prefab:'!Ng',group:7},{buffered:true}),
   s.peer.ngcCreate(40,{prefabIndex:-42,innerID:0x1f,position:[6000,380,-4300],euler:[0,90,0]},{buffered:true}),
   s.peer.ngcCall(40,{innerID:0x1f,messageID:0,args:new Uint8Array(health.buffer)},{buffered:true}),
  ]);
  const created=await s.wait(e=>e.type==='ngc-create');
  assert.deepEqual([created.carrier,created.innerID,created.prefab,created.position],[40,0x1f,';deploy_wood_box',[6000,380,-4300]]);
  const call=await s.wait(e=>e.type==='ngc-call');
  assert.deepEqual([call.innerID,call.name,call.args],[0x1f,'ClientHealthUpdate',[0.5]]);
  assert.equal(s.events.some(e=>e.type==='rpc-undecoded'),false);
  s.peer.ngcDestroy(40,0x1f);
  await s.wait(e=>e.type==='ngc-destroy'&&e.innerID===0x1f);
  assert.equal(s.bridge.ngc.has('40:31'),false);
 }finally{await s.close();}
});

// NGC messages whose handler has no NetworkMessageInfo (BasicDoor.DOo(sbyte, ulong), sent OthersBuffered for every
// non-static door) get NetworkFlags.NoTimestamp, so NGC.ShootRPC uses the explicit-flags RPC overload and uLink never adds
// TypeUnsafe: header 0x80, no timestamp, type code 135 before the byte[] length. The VM gateway logged these as
// "Byte array longer than buffer" (8–14 per join, SERVER-TESTING-PLAN.md section 12).
test('type-safe buffered NGC calls in the join batch are decoded, not dropped', async()=>{
 const s=await setup();
 const errors=[];s.client.connection.on('protocol-error',e=>errors.push(e));
 try{
  const door=new Uint8Array(9);door[0]=1;new DataView(door.buffer).setBigUint64(1,123456789n,true);
  s.peer.buffered([
   s.peer.create({viewId:40,prefab:'!Ng',group:7},{buffered:true}),
   s.peer.ngcCreate(40,{prefabIndex:-43,innerID:0x2a,position:[1,2,3],euler:[0,0,0]},{buffered:true}),
   s.peer.ngcCall(40,{innerID:0x2a,messageID:1,args:door},{buffered:true,info:false}),
   s.peer.ngcCreate(40,{prefabIndex:-42,innerID:0x2b,position:[1,2,3],euler:[0,0,0]},{buffered:true}),
  ]);
  const call=await s.wait(e=>e.type==='ngc-call');
  assert.deepEqual([call.innerID,call.name,call.args],[0x2a,'DOo',[1,123456789n]]);
  await s.wait(e=>e.type==='ngc-create'&&e.innerID===0x2b); // the rest of the batch still arrives
  s.peer.ngcCall(40,{innerID:0x2a,messageID:0,args:new Uint8Array([0xff])},{info:false}); // unbuffered "C" too
  const closed=await s.wait(e=>e.type==='ngc-call'&&e.name==='DOc');
  assert.deepEqual(closed.args,[-1]);
  assert.deepEqual(errors,[]);
 }finally{await s.close();}
});

// P5 deploy.campfire (original server, 2026-10-23): using a placed camp fire got the server's Context I and the fire's
// GNUP but no SetLooter, so the loot window stayed shut. LootableObject.OnUseEnter sends GNUP first (Inventory.GNUP has
// a NetworkMessageInfo: timestamped, untyped body), then SendCurrentLooter's SetLooter(NetworkPlayer): no
// NetworkMessageInfo, so NoTimestamp and a type-safe body, OthersBuffered, so the per-entity name "C<innerID>_<msg>".
// The VM's gateway predated 51d24a2 and read that body untyped ("Byte array longer than buffer"), dropping the call.
test('a camp fire\'s live buffered SetLooter (type-safe, no timestamp) follows its GNUP to the page', async()=>{
 const s=await setup();
 const errors=[];s.client.connection.on('protocol-error',e=>errors.push(e));
 try{
  // SetLooter on the wire as the original sends it: header 0x80 | buffered RPC, no timestamp, "Ca_c" (inner 10, msg 12).
  const looterArgs=writeArgs(['uLink.NetworkPlayer'],[s.peer.playerId]).toBytes();
  const {header,body}=decodeHeader(s.peer.ngcCall(40,{innerID:10,messageID:12,args:looterArgs},ngcWire('SetLooter')));
  assert.deepEqual([header.rpc,header.buffered,header.typeSafe,header.timestampBits],['Ca_c',true,true,undefined]);
  assert.throws(()=>readArgs(['byte[]'],new BitReader(body.bytes,body.end,body.pos)),/longer than buffer/,'read untyped, as before 51d24a2');
  s.peer.create({viewId:40,prefab:'!Ng',group:7});
  await s.wait(e=>e.type==='create'&&e.viewId===40);
  s.peer.ngcCreate(40,{prefabIndex:-44,innerID:10,position:[1,2,3],euler:[0,0,0]});
  await s.wait(e=>e.type==='ngc-create'&&e.innerID===10);
  const send=(messageID,name,types,values)=>s.peer.ngcCall(40,{innerID:10,messageID,args:writeArgs(types,values).toBytes()},{...ngcWire(name),live:true});
  send(2,'GNUP',['byte[]'],[new Uint8Array([8,1,0,0,0,0,0,0,0,0])]);
  send(12,'SetLooter',['uLink.NetworkPlayer'],[s.peer.playerId]);
  await s.wait(e=>e.type==='ngc-call'&&e.name==='GNUP'&&e.innerID===10);
  const looter=await s.wait(e=>e.type==='ngc-call'&&e.name==='SetLooter');
  assert.deepEqual([looter.carrier,looter.innerID,looter.args],[40,10,[s.peer.playerId]]);
  send(11,'ReceiveNetState',['bool'],[true]);send(10,'ClearLooter',[],[]);
  assert.deepEqual((await s.wait(e=>e.type==='ngc-call'&&e.name==='ReceiveNetState')).args,[true]);
  assert.deepEqual((await s.wait(e=>e.type==='ngc-call'&&e.name==='ClearLooter')).args,[]);
  assert.deepEqual(errors,[]);
 }finally{await s.close();}
});

test('NGC wire names map by their first character, as NGCInternalView.OnRPC does', ()=>{
 assert.deepEqual(['A','A1f','C','C1f_3','D','B','x1','',undefined].map(ngcAction),['A','A','C','C','D',null,null,null,null]);
 assert.deepEqual([ngcAddName(0x1f),ngcBufferedCallName(0x1f,0x1a)],['A1f','C1f_1a']);
});

test('commands outside the whitelist or without a target are refused; RS triggers a clock resync', async()=>{
 const s=await setup();
 try{
  assert.equal(s.bridge.command({type:'move',origin:[0,0,0],angles:{pitch:0,yaw:0}}),false);
  assert.equal(s.events.at(-1).reason,'no-character');
  s.peer.create({viewId:10,prefab:'ServerManagement'});await s.wait(e=>e.type==='create');
  assert.equal(s.bridge.command({type:'rpc',viewId:10,name:'KP',args:[1]}),false); // server→client only
  assert.equal(s.bridge.command({type:'rpc',viewId:10,name:'RequestRespawn',args:[true]}),true);
  await s.received(h=>h.rpc==='RequestRespawn');
  assert.equal(s.bridge.command({type:'rpc',viewId:10,name:'RequestRespawn',args:['x','y']}),false);
  assert.equal(s.bridge.command({type:'rpc',viewId:999,name:'RequestRespawn',args:[true]}),false);
  assert.equal(s.bridge.command({type:'shell'}),false);
  s.peer.rpc(10,'RS',['float'],[0.2]);
  await within(once(s.client,'clock'));
 }finally{await s.close();}
});

test('context interaction uses Class:Method names, NetEntityIDs and decodes the prefixed replies', async()=>{
 const s=await setup();
 try{
  const sent=[];s.peer.onUlink=(h,b)=>{if(h.rpc?.startsWith('Context:'))sent.push({h,args:h.rpc==='Context:A'?readArgs(['NetEntityID'],b):h.rpc==='Context:C'?readArgs(['int'],b):[]});};
  s.peer.create({viewId:40,prefab:'!Ng',group:777});await s.wait(e=>e.type==='create'&&e.viewId===40);
  s.peer.ngcCreate(40,{prefabIndex:-42,innerID:3,position:[0,0,0],euler:[0,0,0]});await s.wait(e=>e.type==='ngc-create');
  s.peer.create({viewId:20,owner:99,prefab:'GarageDoor_AngleOpen107'});await s.wait(e=>e.type==='create'&&e.viewId===20);
  assert.equal(s.bridge.command({type:'context',action:'query',target:{carrier:40,innerID:3}}),true);
  assert.equal(s.bridge.command({type:'context',action:'query',target:{viewId:20}}),true);
  assert.equal(s.bridge.command({type:'context',action:'menu',option:2}),true);
  assert.equal(s.bridge.command({type:'context',action:'query',target:{carrier:40,innerID:9}}),false);
  for(let i=0;i<300&&sent.length<3;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(sent.map(x=>[x.h.viewId,x.h.rpc,x.args[0]]),[[998,'Context:A',{p1:777,p2:3}],[998,'Context:A',{p1:0,viewId:20}],[998,'Context:C',2]]);
  s.peer.rpc(998,'Context:E',['ContextMenuData'],[[{name:1,text:'Open'},{name:2,text:'Search'}]]);
  const menu=await s.wait(e=>e.type==='rpc'&&e.name==='E');
  assert.deepEqual([menu.args.class,menu.args.values[0].map(o=>o.text)],['Context',['Open','Search']]);
  s.peer.rpc(998,'Context:I',[],[]);
  assert.equal((await s.wait(e=>e.type==='rpc'&&e.name==='I')).args.class,'Context');
  assert.equal(s.bridge.command({type:'rpc',viewId:998,name:'A',args:[{p1:0,viewId:20}]}),true); // also sent prefixed
 }finally{await s.close();}
});

test('item actions are only sent for the player\'s own item views', async()=>{
 const s=await setup();
 try{
  const got=[];s.peer.onUlink=(h,b)=>{if(h.rpc?.startsWith('Action'))got.push({h,bytes:b.raw(b.remainingBytes)});};
  s.peer.create({viewId:50,owner:s.client.playerId,prefab:'M4'});s.peer.create({viewId:51,owner:99,prefab:'M4'});
  await s.wait(e=>e.type==='create'&&e.viewId===51);
  assert.equal(s.bridge.command({type:'item',viewId:51,action:'bullet-reload'}),false);
  assert.equal(s.bridge.command({type:'item',viewId:50,action:'rm -rf'}),false);
  assert.equal(s.bridge.command({type:'item',viewId:50,action:'bullet-fire',data:{hits:[{point:[1,2,3]}]}}),true);
  assert.equal(s.bridge.command({type:'item',viewId:50,action:'deployable-place',data:{origin:[0,1,0],direction:[0,0,1]}}),true);
  for(let i=0;i<300&&got.length<2;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(got.map(g=>[g.h.viewId,g.h.rpc]),[[50,'Action1B'],[50,'Action1']]);
  assert.equal(got[1].bytes.length,24); // two Vector3 appended raw
 }finally{await s.close();}
});

// TruthDetector (HumanController.GetClientMove → NoteMoved) divides distance by the gap between move timestamps; moves a
// hitching tab delivers together must keep the spacing they were made with, not their arrival spacing.
test('moves carrying the browser clock are spaced and stamped by when they were made', async()=>{
 const s=await setup();
 try{
  s.peer.create({viewId:20,owner:s.client.playerId,prefab:':player_soldier',position:[1,2,3]});
  await s.wait(e=>e.type==='create'&&e.viewId===20);
  const stamps=[];s.peer.onUlink=h=>{if(h.rpc==='GetClientMove')stamps.push(Number(h.timestampLow));};
  const move=at=>s.bridge.command({type:'move',origin:[4,5,6+at/1000],angles:{pitch:0,yaw:0},at});
  // The first move anchors the clocks; three made 100 ms apart during the next 450 ms arrive in the same instant
  // (delayed, as from a stalled socket); one made 10 ms after the last is too frequent.
  assert.equal(move(5000),true);
  await new Promise(r=>setTimeout(r,450));
  assert.deepEqual([move(5100),move(5200),move(5300),move(5310)],[true,true,true,false]);
  for(let i=0;i<300&&stamps.length<4;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(stamps.length,4);
  assert.deepEqual(stamps.slice(1).map((v,i)=>(v-stamps[i]+65536)%65536),[100,100,100]);
  // Delayed moves keep stamps in the past, as the original client's do.
  assert.ok(s.bridge.lastStamp<=s.client.serverMs());
 }finally{await s.close();}
});

// Soaks 2026-10-22 against the original server: kicks of 406–479 = one move each over a ~1 ms gap (0.45 m / 1 ms).
// 5d04ad4 re-anchored to "now" when a stamp ran ahead of the server clock and then forced +1 ms per move; letting stamps
// run ahead instead fails too, because uLink turns a stamp up to 1 s ahead into the arrival time (widenTimestamp).
const stamper=clock=>{const b={client:{serverMs:()=>BigInt(clock.now)}};return (at,x=0)=>GameBridge.prototype.moveStamp.call(b,at,[x,0,0]);};
const gaps=s=>s.slice(1).map((v,i)=>Number(v-s[i]));
test('move stamps keep the browser spacing when moves arrive bunched after a stall', ()=>{
 const clock={now:100000},stamp=stamper(clock),out=[stamp(5000)];
 clock.now+=1600; // a 1.5 s network stall; moves made 100 ms apart arrive in the same instant
 for(let at=5100;at<=5500;at+=100)out.push(stamp(at,(at-5000)/200)); // walking 5 m/s
 assert.deepEqual(gaps(out),[100,100,100,100,100]);
 assert.ok(out.at(-1)<=BigInt(clock.now),'never ahead of the server clock');
});
test('after a late first move, stamps catch up only as far as the step allows (under 10 m/s, at least half the gap)', ()=>{
 // Move made at 5000 arrives 2 s late (server time 102000); later ones arrive on time (100000 + 100 per move), walking
 // 0.5 m per move. Stamps ahead of the server clock are held back by move() until it reaches them.
 const clock={now:102000},stamp=stamper(clock),out=[stamp(5000)];
 for(let i=1;i<=60;i++){clock.now=100000+i*100;out.push(stamp(5000+i*100,i*0.5));}
 assert.equal(Math.min(...gaps(out)),50); // 0.5 m at 10 m/s
 assert.ok(out.at(-1)<=BigInt(clock.now),'caught up with the server clock');
 const still=stamper({now:102000}),s=[still(5000)];for(let i=1;i<=3;i++)s.push(still(5000+i*100));
 assert.deepEqual(gaps(s),[50,50,50]); // standing still: half the gap
});
test('what the server sees: no TruthDetector speed violation through jitter, stalls and a late first move', ()=>{
 // A player sprints 7 m/s making a move every 100 ms; arrivals at the gateway jitter 20–120 ms, the first one comes 2 s
 // late, and two 1.5 s stalls deliver moves in bunches. Each move leaves when the server clock reaches its stamp (move()'s
 // queue); the server widens the 16-bit stamp at arrival (same machine) and runs TruthDetector's speed rule on it.
 let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const clock={now:0},b={client:{serverMs:()=>BigInt(clock.now)}},T0=500000;
 const made=Array.from({length:600},(_,i)=>({at:1000+i*100,x:i*0.7}));
 const arrive=made.map(({at},i)=>T0+at+(i===0?2000:20+Math.round(rnd()*100))+(i>=150&&i<165?1500-(i-150)*100:0)+(i>=400&&i<415?1500-(i-400)*100:0));
 const order=made.map((m,i)=>({...m,arr:Math.max(...arrive.slice(0,i+1))})); // the socket keeps order
 let release=0,prev=null,violation=0,worst=0;
 for(const m of order){
  clock.now=m.arr;const stamp=GameBridge.prototype.moveStamp.call(b,m.at,[m.x,0,0]);
  release=Math.max(release,m.arr,Number(stamp)+15);
  const ts=widenTimestamp(BigInt(release),stamp&0xffffn,16);
  if(prev&&ts>prev.ts){const v=Math.abs(m.x-prev.x)/(Number(ts-prev.ts)/1000);if(v>20)violation+=Math.floor(v);}
  if(!prev||ts>prev.ts)prev={ts,x:m.x};if(violation>0)violation--;worst=Math.max(worst,violation);
 }
 assert.equal(worst,0);
});
test('a move stamped ahead of the server clock is held until the clock reaches it', async()=>{
 const sent=[],clock={now:0n},b=Object.assign(Object.create(GameBridge.prototype),{client:{serverMs:()=>clock.now,sendRpc:r=>sent.push(r.timestamp)},moveQueue:[],moveTimer:null});
 b.moveQueue.push({timestamp:10n},{timestamp:60n});clock.now=40n;b.sendMoves(); // margin 15 ms: 10 ≤ 25 goes, 60 waits
 assert.deepEqual(sent,[10n]);
 clock.now=80n;await new Promise(r=>setTimeout(r,60));
 assert.deepEqual(sent,[10n,60n]);
 b.moveQueue.push({timestamp:500n});b.sendMoves();b.dispose();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(sent,[10n,60n]);
});

// EU 1 (30 Oct): a gateway run without recoveredDir passed no scene doors, so E on every town door was rejected as
// unknown-target. tools/gateway.mjs now falls back to the built-in list, which must match the recovered scene.
test('scene doors: the built-in view list matches the recovered scene and lets Context:A through without recoveredDir', async()=>{
 const {SCENE_DOOR_VIEWS}=await import('../bridge/scene-door-views.mjs');
 const manifest=new URL('../browser/assets/recovered/scene/manifest.json',import.meta.url);
 const doors=await readFile(manifest,'utf8').then(t=>JSON.parse(t).doors,()=>null);
 if(doors)assert.deepEqual([...SCENE_DOOR_VIEWS].sort((a,b)=>a-b),doors.map(d=>d.viewID).filter(Number.isInteger).sort((a,b)=>a-b));
 const query=sceneDoors=>{const sent=[],client={playerId:1,sendRpc:r=>sent.push(r),on(){},off(){},addEventListener(){}};
  const bridge=new GameBridge({client,schema,ngcRegistry:registry,sceneDoors,playerName:name,now});bridge.on('event',()=>{});
  return [bridge.command({type:'context',action:'query',target:{viewId:38}}),sent];};
 assert.equal(query([])[0],false);
 const [ok,sent]=query(SCENE_DOOR_VIEWS);
 assert.equal(ok,true);assert.deepEqual(sent.map(r=>[r.viewId,r.name,r.args[0]]),[[998,'Context:A',{p1:0,viewId:38}]]);
});
