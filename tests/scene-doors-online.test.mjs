// Static scene doors online: BasicDoor.DOc/DOo on the scene MovingDoors' manual views (3–62) move the island's
// LegacyDoors, and the use key reaches the server as Context:A on that view (decompiled Context.BeginQuery ->
// NetEntityID.Of finds the door's uLink.NetworkView: {p1: 0, viewID}).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {GameBridge,SCENE_DOOR} from '../bridge/game-bridge.mjs';
import {INTERNAL} from '../bridge/ulink/ulink.mjs';
import {BitReader} from '../bridge/ulink/bits.mjs';
import {writeArgs} from '../bridge/ulink/rust.mjs';
import {OnlineSession,sceneDoorViews,applySceneDoorCall} from '../browser/online.mjs';
import {createDoors,DoorState} from '../browser/doors.mjs';

const schema=JSON.parse(await readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
const scene=await readFile(new URL('../browser/assets/recovered/scene/manifest.json',import.meta.url)).then(b=>JSON.parse(b),()=>null);

function bridgeFor(sceneDoors){
 let serverMs=90000n;const sent=[],client=Object.assign(new EventEmitter(),{playerId:1,serverMs:()=>serverMs,sendRpc:r=>sent.push(r)});
 const bridge=new GameBridge({client,schema,sceneDoors,playerName:'p'}),events=[];bridge.on('event',e=>events.push(e));
 const rpc=(viewId,name,types,values)=>bridge.onRpc({viewId,rpc:name,timestampLow:Number(serverMs&0xffffn),timestampBits:16},new BitReader(writeArgs(types,values).toBytes()));
 return {bridge,sent,events,rpc,advance:ms=>{serverMs+=BigInt(ms);return serverMs;}};
}

test('the bridge sends Context:A on a scene door manual view and keeps those views through DestroyAll', ()=>{
 const {bridge,sent,events}=bridgeFor([38,3,62]);
 assert.equal(bridge.views.get(38).prefab,SCENE_DOOR);assert.equal(bridge.views.get(38).class,'BasicDoor');
 assert.equal(bridge.command({type:'context',action:'query',target:{viewId:38}}),true);
 assert.deepEqual(sent.at(-1),{viewId:998,name:'Context:A',types:['NetEntityID'],args:[{p1:0,viewId:38}]});
 // A view that is neither Created nor a recovered scene door is still refused.
 assert.equal(bridge.command({type:'context',action:'query',target:{viewId:39}}),false);assert.equal(events.at(-1).reason,'unknown-target');
 // Scene views survive a DestroyAll (as 996–998 do).
 bridge.views.set(70,{prefab:':player_soldier',owner:2,group:0});bridge.onUlink({internal:INTERNAL.DestroyAll},null);
 assert.ok(!bridge.views.has(70)&&bridge.views.has(3)&&bridge.views.has(62)&&bridge.views.has(998));
 // Without the option the doors are unknown targets, as before.
 const plain=bridgeFor([]);assert.equal(plain.bridge.command({type:'context',action:'query',target:{viewId:38}}),false);
});

test('scene door DOc/DOo decode on their manual view with the server clock', ()=>{
 const {events,rpc,advance}=bridgeFor([38]);
 rpc(38,'DOc',['sbyte'],[1]);
 assert.deepEqual([events.at(-1).type,events.at(-1).viewId,events.at(-1).prefab,events.at(-1).name,events.at(-1).args],['rpc',38,SCENE_DOOR,'DOc',{class:'BasicDoor',values:[1]}]);
 const stamp=advance(1000);rpc(38,'DOo',['sbyte','ulong'],[0,stamp]);
 const e=events.at(-1);assert.equal(e.args.class,'BasicDoor');assert.equal(BigInt(e.args.values[1]),stamp);assert.equal(BigInt(e.serverMs),stamp);
});

test('sceneDoorViews maps manual view IDs to doors; applySceneDoorCall uses the NGC door maths', {skip:!scene&&'recovered assets not present'}, ()=>{
 const doors=createDoors(scene),views=sceneDoorViews(doors);
 assert.equal(views.size,32);
 const door=views.get(38);assert.equal(door.name,'BlueDoor_94');assert.equal(door.index,5);assert.equal(door.state,DoorState.Closed);
 // DOc(1): settled open at once.
 assert.equal(applySceneDoorCall(views,{viewId:38,name:'DOc',args:{class:'BasicDoor',values:[1]}},{localNowMs:1000}),door);
 assert.equal(door.state,DoorState.Opened);assert.equal(door.fraction,1);assert.equal(door.changed,true);
 // DOo(0) stamped 200 ms before the server's now: the closing animation is already 200 ms in.
 applySceneDoorCall(views,{viewId:38,name:'DOo',args:{class:'BasicDoor',values:[0,'9800']},serverMs:'10000'},{localNowMs:5000});
 door.update(5000);assert.equal(door.state,DoorState.Closing);
 door.update(5000+door.durationClose*1000-200);assert.equal(door.state,DoorState.Closed);
 // DOo(2): opens reversed.
 applySceneDoorCall(views,{viewId:38,name:'DOo',args:{class:'BasicDoor',values:[2,'20000']},serverMs:'20000'},{localNowMs:9000});
 door.update(9000+door.durationOpen*1000+1);assert.equal(door.state,DoorState.Opened);assert.equal(door.fraction,-1);
 // Other classes, unknown views and other RPCs leave the doors alone.
 assert.equal(applySceneDoorCall(views,{viewId:38,name:'DOc',args:{class:'Context',values:[0]}},{localNowMs:0}),null);
 assert.equal(applySceneDoorCall(views,{viewId:999,name:'DOc',args:{class:'BasicDoor',values:[0]}},{localNowMs:0}),null);
 assert.equal(door.state,DoorState.Opened);
});

test('the online session keeps the latest scene door call per view until the island attaches', ()=>{
 class Client extends EventTarget{constructor(){super();this.views=new Map();this.entities=new Map();}}
 const s=new OnlineSession({join:{endpoint:'ws://127.0.0.1:1/play',ticket:'t'},ClientImpl:Client});
 const rpc=detail=>s.client.dispatchEvent(Object.assign(new Event('rpc'),{detail}));
 rpc({viewId:38,name:'DOc',args:{class:'BasicDoor',values:[0]}});
 rpc({viewId:38,name:'DOo',args:{class:'BasicDoor',values:[1,'5']},serverMs:'5'});
 rpc({viewId:16,name:'DOc',args:{class:'BasicDoor',values:[2]}});
 rpc({viewId:997,name:'CL_ConsoleMessage',args:{class:'ConsoleNetworker',values:['x']}});
 assert.deepEqual([...s.sceneDoorCalls].map(([id,c])=>[id,c.name]),[[38,'DOo'],[16,'DOc']]);
 s.client.dispatchEvent(Object.assign(new Event('closed'),{detail:{}}));assert.equal(s.sceneDoorCalls.size,0);
});
