import test from 'node:test';
import assert from 'node:assert/strict';
import {takeJoin,OnlineSession,JOIN_KEY,entityTransform} from '../browser/online.mjs';
import {Vector3} from 'three';
import {GatewayClient} from '../browser/net-client.mjs';
import {needsAssets} from './helpers/assets.mjs';

const store=v=>{const m=new Map(v===undefined?[]:[[JOIN_KEY,typeof v==='string'?v:JSON.stringify(v)]]);return {m,getItem:k=>m.get(k)??null,removeItem:k=>m.delete(k)};};

test('the join hand-off is one-use, fresh and only for wss (or a loopback ws) gateways', ()=>{
 const now=1_000_000,ok={ticket:'t',endpoint:'wss://play.example.com/play',server:'s',name:'S',at:now-1000};
 const s=store(ok);assert.equal(takeJoin(s,now).ticket,'t');assert.equal(s.m.size,0,'removed after reading');assert.equal(takeJoin(s,now),null);
 assert.equal(takeJoin(store({...ok,at:now-61e3}),now),null,'stale');
 assert.equal(takeJoin(store({...ok,endpoint:'ws://play.example.com/play'}),now),null,'plain ws to a remote host');
 assert.equal(takeJoin(store({...ok,endpoint:'ws://127.0.0.1:9000/play'}),now).endpoint,'ws://127.0.0.1:9000/play');
 assert.equal(takeJoin(store('{not json'),now),null);assert.equal(takeJoin(store(),now),null);
 assert.equal(takeJoin({getItem(){throw Error('denied');},removeItem(){}},now),null);
});

// A WebSocket stand-in that lets the test play the gateway.
class FakeSocket extends EventTarget{static last;constructor(url,protocols){super();this.url=url;this.protocols=protocols;this.sent=[];this.readyState=1;FakeSocket.last=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
 send(d){this.sent.push(JSON.parse(d));}close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 push(o){this.dispatchEvent(Object.assign(new Event('message'),{data:JSON.stringify(o)}));}}

test('remote native deaths retain once during loading, never alter own vitals, and clear on new view generation',async()=>{
 const s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},WebSocketImpl:FakeSocket,now:()=>7});const p=s.connect();await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;ws.push({type:'approved',playerId:1,world:{sendRate:10}});await p;
 const create=()=>ws.push({type:'create',viewId:30,prefab:':player_soldier',owner:8,mine:false,position:[1,2,3],rotation:[0,0,0,1]});create();let deaths=0;s.addEventListener('remote-death',()=>deaths++);
 const death={type:'rpc',viewId:30,name:'Client_OnKilled',args:{class:'DeathTransfer',values:[]}};ws.push({...death,args:{class:'Context',values:[]}});assert.equal(deaths,0);ws.push(death);ws.push(death);assert.equal(deaths,1);assert.equal(s.deathCalls.get(30).receivedAt,7);assert.equal(s.vitalsCalls.size,0);
 ws.push({type:'destroy',kind:'view',viewId:30});assert.equal(s.deathCalls.size,0);create();ws.push(death);assert.equal(deaths,2);ws.close();assert.equal(s.deathCalls.size,0);
});

test('online session: admit, ClientFirstReady on ServerManagement, spawn teleport, moves at the send rate, remote players', async()=>{
 let t=0,feet=[1,2,3];const teleports=[];
 const motor={feet:()=>feet,yaw:()=>0,pitch:()=>0,flags:()=>0,teleport:p=>teleports.push(p)};
 const s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},motor,WebSocketImpl:FakeSocket,now:()=>t});
 const connecting=s.connect();await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;
 assert.deepEqual(ws.sent[0],{type:'admit',ticket:'tk'});
 ws.push({type:'approved',playerId:7,world:{level:'rust_island_2013',sendRate:10}});await connecting;
 ws.push({type:'create',viewId:1,prefab:'Server/ServerManagement',owner:0,mine:false,position:[0,0,0],rotation:[0,0,0,1]});
 assert.deepEqual(ws.sent.at(-1),{type:'ready'});
 assert.equal(s.frame(),false,'no character yet');
 ws.push({type:'create',viewId:20,prefab:':player_soldier',owner:7,mine:true,position:[5,6,7],rotation:[0,0,0,1]});
 assert.equal(s.state,'in-game');assert.deepEqual(teleports.at(-1),[5,6,-7]);
 assert.equal(s.frame(),true);assert.equal(s.frame(),false,'rate limited to the send rate');t+=0.11;assert.equal(s.frame(),true);
 assert.deepEqual(ws.sent.at(-1).origin,[1,2,-3]);
 ws.push({type:'create',viewId:30,prefab:':player_soldier',owner:8,mine:false,position:[1,1,1],rotation:[0,0,0,1]});
 assert.ok(s.remote.has(30));
 ws.push({type:'destroy',kind:'view',viewId:30});assert.ok(!s.remote.has(30));
 ws.push({type:'destroy',kind:'view',viewId:20});assert.equal(s.state,'dead');
 ws.close();assert.equal(s.state,'closed');
});

test('spawn arriving before the world loads is applied when the motor attaches', async()=>{
 const s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},WebSocketImpl:FakeSocket});
 const p=s.connect();await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;ws.push({type:'approved',playerId:1,world:{sendRate:10}});await p;
 ws.push({type:'create',viewId:20,prefab:':player_soldier',owner:1,mine:true,position:[5,6,7],rotation:[0,0,0,1]});
 assert.equal(s.frame(),false);const tp=[];s.attach({feet:()=>[0,0,0],yaw:()=>0,pitch:()=>0,flags:()=>0,teleport:q=>tp.push(q)});
 assert.deepEqual(tp,[[5,6,-7]]);assert.equal(s.frame(),true);
});

test('a denied join reports the reason', async()=>{
 const s=new OnlineSession({join:{ticket:'x',endpoint:'ws://127.0.0.1:1/play'},motor:{},WebSocketImpl:FakeSocket});
 const p=s.connect();await new Promise(r=>setTimeout(r));let reason=null;s.addEventListener('denied',e=>reason=e.detail.reason);
 FakeSocket.last.push({type:'denied',reason:'expired'});await assert.rejects(p);assert.equal(reason,'expired');assert.equal(s.state,'closed');
});

test('native death/respawn calls stay with the owned character and respawn waits for the server',async()=>{
 const {ServerVitals}=await import('../browser/server-vitals.mjs');const s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},WebSocketImpl:FakeSocket});
 const p=s.connect();await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;ws.push({type:'approved',playerId:1,world:{sendRate:10}});await p;
 ws.push({type:'create',viewId:1,prefab:'ServerManagement',position:[0,0,0],rotation:[0,0,0,1]});
 ws.push({type:'create',viewId:20,prefab:':player_soldier',mine:true,position:[1,2,3],rotation:[0,0,0,1]});
 ws.push({type:'rpc',viewId:20,name:'Local_HealthChange',args:{class:'ClientVitalsSync',values:[72,0]}});
 const v=new ServerVitals(s);assert.equal(v.health,72);assert.equal(s.respawn(),false);
 ws.push({type:'rpc',viewId:30,name:'Client_OnKilled',args:{class:'DeathTransfer',values:[]}});assert.equal(s.state,'in-game');
 ws.push({type:'rpc',viewId:20,name:'Client_OnKilled',args:{class:'DeathTransfer',values:[]}});assert.equal(v.health,0);assert.equal(s.state,'dead');assert.equal(s.respawn(true),true);
 assert.deepEqual(ws.sent.at(-1),{type:'rpc',viewId:1,name:'RequestRespawn',args:[true]});assert.equal(s.state,'dead');
 ws.push({type:'destroy',kind:'view',viewId:20});ws.push({type:'create',viewId:21,prefab:':player_soldier',mine:true,position:[5,6,7],rotation:[0,0,0,1]});assert.equal(s.state,'in-game');assert.equal(s.vitalsCalls.size,0);assert.equal(v.health,100);s.close();
});

test('early wildlife state is retained for delayed rendering and close releases the loaded world', async()=>{
 let t=3;const s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},WebSocketImpl:FakeSocket,now:()=>t});
 const p=s.connect();await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;ws.push({type:'approved',playerId:1,world:{sendRate:10}});await p;
 ws.push({type:'create',viewId:50,prefab:':wolf_prefab',position:[1,2,3],rotation:[0,0,0,1]});
 ws.push({type:'rpc',viewId:50,name:'GetNetworkUpdate',args:{class:'BasicWildLifeAI',values:[[4,5,6],{pitch:0,yaw:90}]}});
 t=4;ws.push({type:'rpc',viewId:50,name:'ClientDeath',args:{class:'BasicWildLifeAI',values:[[4,5,6],20]}});
 assert.equal(s.actorCalls.get(50).get('ClientDeath').receivedAt,4);assert.equal(s.actorCalls.get(50).size,2);
 let closed=0;s.addEventListener('closed',()=>closed++);s.close();assert.equal(closed,1);assert.equal(s.actorCalls.size,0);assert.equal(s.client.views.size,0);assert.equal(s.remote.size,0);
});

test('full plus dirty inventory updates and NGC argument arrays replay correctly after the island loads',needsAssets, async()=>{
 const {readFileSync}=await import('node:fs'),{ServerInventory}=await import('../browser/server-inventory.mjs'),{inventoryFixture}=await import('./helpers/inventory-fixture.mjs');
 const cat=JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))),s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},WebSocketImpl:FakeSocket});
 const p=s.connect();await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;ws.push({type:'approved',playerId:1,world:{sendRate:10}});await p;
 ws.push({type:'create',viewId:20,prefab:':player_soldier',mine:true,position:[0,0,0],rotation:[0,0,0,1]});
 const wire=bytes=>({base64:Buffer.from(bytes).toString('base64')});
 ws.push({type:'rpc',viewId:20,name:'GNUP',args:{class:'Inventory',values:[wire(inventoryFixture(cat,{slots:[{name:'Wood',uses:12}]}))]}});
 ws.push({type:'rpc',viewId:20,name:'GNUP',args:{class:'Inventory',values:[wire(inventoryFixture(cat,{full:false,updates:[[0,{name:'Wood',uses:14}]]}))]}});
 ws.push({type:'ngc-create',carrier:40,innerID:5,prefab:';drop_lootsack',position:[0,0,0],euler:[0,0,0]});
 ws.push({type:'ngc-call',carrier:40,innerID:5,name:'SetLooter',args:[1]});
 ws.push({type:'ngc-call',carrier:40,innerID:5,name:'GNUP',args:[wire(inventoryFixture(cat,{capacity:3,slots:[{name:'Wood',uses:7}]}))]});
 assert.deepEqual(s.inventoryCalls.get('n:40:5')[0].args,[1],'Array.values is an iterator method, not the RPC argument list');
 const inv=new ServerInventory(s,cat);assert.equal(inv.slots[0].uses,14);assert.equal(inv.containers.get('n:40:5').slots[0].uses,7);assert.equal(inv.looting,'n:40:5');assert.equal(inv.lastError,null);s.close();
});

test('NGC entity transforms: browser position back to Unity, Unity euler degrees to a Unity quaternion', ()=>{
 const t=entityTransform({position:[10,2,-30],euler:[0,90,0]});
 assert.deepEqual(t.position.toArray(),[10,2,30]);
 const f=new Vector3(0,0,1).applyQuaternion(t.rotation);assert.ok(f.distanceTo(new Vector3(1,0,0))<1e-6,'yaw 90° turns Unity forward (+Z) to +X');
 const p=new Vector3(0,0,1).applyQuaternion(entityTransform({position:[0,0,0],euler:[90,0,0]}).rotation);assert.ok(p.distanceTo(new Vector3(0,-1,0))<1e-6,'pitch 90° looks down');
});

test('server door, depletion and fire calls drive the browser state',needsAssets, async()=>{
 const {readFile}=await import('node:fs/promises');const {Quaternion}=await import('three');
 const {applyEntityCall}=await import('../browser/online.mjs');const {deployableDoor,DoorState}=await import('../browser/doors.mjs');
 const manifest=JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)));
 const o={door:deployableDoor(manifest.prefabs[';deploy_wood_door'],new Vector3(0,0,0),new Quaternion())};
 assert.equal(o.door.state,DoorState.Closed);
 assert.equal(applyEntityCall(o,{name:'DOc',args:[1]},{localNowMs:1000}),'door');
 assert.equal(o.door.state,DoorState.Opened);assert.equal(o.door.fraction,1);
 // Close: the server stamped it 200 ms ago, so the animation is already 200 ms in.
 applyEntityCall(o,{name:'DOo',args:{values:[0,'9800']},serverMs:'10000'},{localNowMs:5000});
 o.door.update(5000);assert.equal(o.door.state,DoorState.Closing);
 o.door.update(5000+o.door.durationClose*1000);assert.equal(o.door.state,DoorState.Closed);
 // Reverse opening (state 2) mirrors the swing.
 applyEntityCall(o,{name:'DOo',args:{values:[2,'20000']},serverMs:'20000'},{localNowMs:9000});o.door.update(9000+o.door.durationOpen*1000+1);
 assert.equal(o.door.state,DoorState.Opened);assert.equal(o.door.fraction,-1);
 const ore={};assert.equal(applyEntityCall(ore,{name:'modelindex',args:[2]},{localNowMs:0}),'model');assert.equal(ore.modelIndex,2);
 const fire={};applyEntityCall(fire,{name:'ReceiveNetState',args:{values:[true]}},{localNowMs:0});assert.equal(fire.lit,true);
 assert.equal(applyEntityCall({},{name:'ClientHealthUpdate',args:{values:[10]}},{localNowMs:0}),null);
});

test('online context: quick tap, held menu and choice follow the original ContextUI flow', async()=>{
 const {OnlineContext}=await import('../browser/online.mjs');
 const sent=[],client=new EventTarget();client.context=(action,target,option)=>sent.push([action,target,option]);
 let t=0;const rpc=(name,values=[])=>client.dispatchEvent(Object.assign(new Event('rpc'),{detail:{name,args:{class:'Context',values}}}));
 const hooks={unlocks:0,locks:0};const ctx=new OnlineContext(client,{now:()=>t,unlock:()=>hooks.unlocks++,tryLock:()=>{hooks.locks++;return true;}});
 const door={carrier:40,innerID:3};
 // Quick-only target: Context:A, the server answers I at once; the late release sends nothing.
 t=1000;ctx.press(door,t);rpc('I');assert.equal(ctx.state,'off');t=1100;ctx.release(t);
 assert.deepEqual(sent,[['query',door,undefined]]);
 // Quick tap on a Quick|Menu door: the menu arrives (shown 50 ms + elapsed later), the release within 300 ms sends B.
 sent.length=0;t=2000;ctx.press(door,t);t=2040;rpc('E',[[{name:5,text:'Open'},{name:9,text:'Enter Code'}]]);assert.equal(ctx.state,'options');assert.equal(ctx.enabled,false);
 t=2100;ctx.frame(t,true);assert.equal(ctx.enabled,false,'Invoke(OnClientShowMenu) at elapsed + 50 ms');t=2130;ctx.frame(t,true);assert.equal(ctx.enabled,true);assert.equal(hooks.unlocks,1);
 t=2200;ctx.release(t);assert.deepEqual(sent.map(x=>x[0]),['query','quick']);assert.equal(ctx.state,'validating');assert.equal(ctx.enabled,false);assert.equal(hooks.locks,1);rpc('K');assert.equal(ctx.state,'off');
 // Held: the menu stays while the key is down; a click sends C(option name) and shows the validating box.
 sent.length=0;t=3000;ctx.press(door,t);t=3400;rpc('E',[[{name:5,text:'Open'},{name:9,text:'Enter Code'}]]);assert.equal(ctx.enabled,true,'shown at once after 300 ms');
 t=3500;ctx.frame(t,true);assert.equal(ctx.state,'options');assert.equal(ctx.select(1),true);assert.deepEqual(sent.at(-1),['menu',undefined,9]);assert.equal(ctx.state,'validating');assert.equal(ctx.lastText,'Enter Code');
 rpc('K');assert.equal(ctx.state,'off');assert.equal(ctx.enabled,false);
 // Releasing the key (or OnGUI seeing it up) after 300 ms cancels: Context:D, the server's NoOp ends it.
 sent.length=0;t=5000;ctx.press(door,t);t=5100;rpc('E',[[{name:1,text:'Open'}]]);t=5200;ctx.frame(t,true);t=5450;ctx.frame(t,false);
 assert.deepEqual(sent.map(x=>x[0]),['query','cancel']);assert.equal(ctx.state,'validating');rpc('F');assert.equal(ctx.state,'off');
 // A release before any menu after 300 ms cancels too; a stray reply class is ignored; a press while working is refused.
 sent.length=0;t=6000;ctx.press(door,t);assert.equal(ctx.press(door,t+1),false);rpc('x');t=6400;ctx.release(t);assert.deepEqual(sent.map(x=>x[0]),['query','cancel']);rpc('G');assert.equal(ctx.state,'off');
});
