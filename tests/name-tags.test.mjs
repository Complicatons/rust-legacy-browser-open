import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_TIP,TOOLTIP,readPlayerClientData,writePlayerClientData,tipAlpha,tipScale,lineOfSightBlocked,tipVisible,tipRect,TooltipPool} from '../browser/name-tags.mjs';
import {OnlineSession} from '../browser/online.mjs';

test('GameTip prefab values (player prefab, statically read)', ()=>{
 assert.equal(GAME_TIP.maxDistance,20);assert.equal(GAME_TIP.text,'Unnammed');assert.equal(GAME_TIP.lineOfSight,true);
 assert.deepEqual(GAME_TIP.positionOffset,[0,1.85,0]);assert.deepEqual(GAME_TIP.testOffset,[0,0.8,0]);assert.deepEqual(GAME_TIP.textColor,[1,1,1,1]);
 assert.equal(GAME_TIP.node.parent,'RustPlayer_Pelvis');assert.equal(TOOLTIP.pool,16);assert.equal(TOOLTIP.fontSize,48);assert.equal(TOOLTIP.font,'RobotoCondensed-Bold');
});

test(':client initial data: ulong userID then string userName', ()=>{
 const bytes=writePlayerClientData(76561198000000001n,'Zoë the Builder');
 assert.deepEqual(readPlayerClientData(bytes),{userId:'76561198000000001',name:'Zoë the Builder'});
 const long='x'.repeat(200),b2=writePlayerClientData(5,long);assert.equal(b2[8],0xc8);assert.equal(b2[9],0x01);assert.equal(readPlayerClientData(b2).name,long);
 assert.equal(readPlayerClientData(new Uint8Array(4)),null);assert.equal(readPlayerClientData(bytes.subarray(0,bytes.length-1)),null);assert.equal(readPlayerClientData(null),null);
 assert.deepEqual(readPlayerClientData(writePlayerClientData(1,'')),{userId:'1',name:''});
});

test('OnWillRenderObject: alpha 1-d/20, scale 2/(d 2 tan(fov/2)), hidden past 20 m', ()=>{
 assert.equal(tipAlpha(0),1);assert.equal(tipAlpha(10),0.5);assert.equal(tipAlpha(20),0);
 assert.ok(Math.abs(tipScale(2,60)-1/(2*Math.tan(Math.PI/6)))<1e-12);assert.ok(tipScale(10,60)<tipScale(5,60));assert.ok(tipScale(5,30)>tipScale(5,60));
 assert.equal(tipVisible({distance:19.99}),true);assert.equal(tipVisible({distance:20}),true);assert.equal(tipVisible({distance:20.01}),false);
 assert.equal(tipVisible({distance:3,rendered:false}),false);assert.equal(tipVisible({distance:3,blocked:true}),false);
 // Bottom centre of the scaled 48 px label at the projected point.
 assert.deepEqual(tipRect(500,300,100,0.5),{x:475,y:276,scale:0.5});
});

test('TestLineOfSight: nothing hit, hits within the last .5 m and the target itself never hide the tip', ()=>{
 assert.equal(lineOfSightBlocked(null,10),false);
 assert.equal(lineOfSightBlocked({distance:9.6},10),false);assert.equal(lineOfSightBlocked({distance:9.5},10),true);
 assert.equal(lineOfSightBlocked({distance:4,body:{id:7}},10,h=>h.body.id===7),false);assert.equal(lineOfSightBlocked({distance:4,body:{id:8}},10,h=>h.body.id===7),true);
});

test('GameTooltipManager pool: 16 tooltips, reuse by target, hidden after 3 unseen frames', ()=>{
 const pool=new TooltipPool();const a={},b={};
 pool.beginFrame(10);const ta=pool.update(a,{text:'A',alpha:1,x:0,y:0,scale:1});assert.ok(ta.visible);
 pool.beginFrame(11);assert.equal(pool.update(a,{text:'A',alpha:1,x:1,y:0,scale:1}),ta,'same target keeps its tooltip');
 pool.beginFrame(13);assert.equal(ta.visible,true,'lastSeen 11 > 13-3');pool.beginFrame(14);assert.equal(ta.visible,false,'unseen for 3 frames');
 // All 16 in use this frame: the 17th target gets nothing.
 const p2=new TooltipPool();p2.beginFrame(5);for(let i=0;i<16;i++)assert.ok(p2.update({i},{text:String(i),alpha:1,x:0,y:0,scale:1}));assert.equal(p2.update(b,{text:'B',alpha:1,x:0,y:0,scale:1}),null);
});

test('OnlineSession maps :client names to the owner\'s :player_soldier (once, at instantiation)', ()=>{
 class FakeClient extends EventTarget{constructor(){super();this.views=new Map();this.playerId=1;this.characterView=null;}emit(t,d){this.dispatchEvent(Object.assign(new Event(t),{detail:d}));}}
 const s=new OnlineSession({join:{endpoint:'ws://127.0.0.1/'},ClientImpl:FakeClient}),c=s.client;
 const create=v=>{c.views.set(v.viewId,v);c.emit('create',v);};
 create({viewId:5,prefab:':client',owner:1,initialData:writePlayerClientData(111n,'Me')});
 create({viewId:6,prefab:':client',owner:2,initialData:writePlayerClientData(222n,'Alice')});
 create({viewId:20,prefab:':player_soldier',owner:2,position:[0,0,0],rotation:[0,0,0,1]});
 assert.equal(s.localUserId,'111');assert.equal(s.remote.get(20).userName,'Alice');
 // A character created before its PlayerClient keeps the prefab text.
 create({viewId:21,prefab:':player_soldier',owner:3,position:[0,0,0],rotation:[0,0,0,1]});create({viewId:7,prefab:':client',owner:3,initialData:writePlayerClientData(333n,'Late')});
 assert.equal(s.remote.get(21).userName,'Unnammed');
 c.views.delete(6);c.emit('destroy',{kind:'view',viewId:6});assert.equal(s.playerClients.has(2),false);assert.equal(s.playerClients.has(3),true);
});
