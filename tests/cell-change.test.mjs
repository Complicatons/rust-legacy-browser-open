// Network culling cell changes, end to end at the message level: the mock referee's world (tools/native/mock-world.mjs
// with tools/native/mock-cull.mjs) does what the original server does when a character crosses a CullGrid cell
// (uLink O1629.O3135: ChangeGroup / BufferedRPCs+Create / DestroyByViewID; CullGrid.SetPlayerCenterFromGroupID:
// BufferedRPCs for new groups, DestroyInGroup for dropped ones). Its bytes go through the gateway's uLink client and
// GameBridge into the page's GatewayClient/OnlineSession, and the copy is placed the way player-view.mjs does it.
// Geometry: the 2026-10-23-gameplay-real-two-e mixed.move run (observer at Unity 5671.8, -3496.0 = group 1927; the
// target's last spawn 6569.8, -3884.7, ~978 m away; the target's walk crossed z = -3500 into group 1847).
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createMockWorld} from '../tools/native/mock-world.mjs';
import {cullGroup,nearbyGroups,CULL_GRID} from '../tools/native/mock-cull.mjs';
import {serverHelpers} from '../bridge/ulink/mock-server.mjs';
import {UlinkClient} from '../bridge/ulink/session.mjs';
import {GameBridge} from '../bridge/game-bridge.mjs';
import {GatewayClient} from '../browser/net-client.mjs';
import {OnlineSession} from '../browser/online.mjs';
import {placeRemote,sampleRemote,pushSnapshot} from '../browser/player-motion.mjs';
import {callTime,interpolationDelay} from '../browser/airdrops.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const catalogue=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const registry=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/ngc/registry.json',import.meta.url)))):null;
const schema=JSON.parse(readFileSync(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
const OBSERVER=[5671.8,400.3,-3496.0],FAR=[6569.8,355.5,-3884.7],DELAY=interpolationDelay(5);
const flat=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]),unity=([x,y,z])=>[x,y,-z];

test('CullGrid cells and groups follow the island grid (200 m cells, 80 x 80, offset 7900 m, groups from 100, 3 x 3)',()=>{
 assert.equal(cullGroup(OBSERVER),1927,'the observer\'s Create carried group 1927 on the original (run two-d)');
 assert.equal(cullGroup([5683.7,399.4,-3501.9]),1847,'the target\'s 3 s walk ended across z = -3500');
 assert.equal(cullGroup([-9000,0,-9000]),CULL_GRID.groupBegin,'clamped at the grid edge');
 assert.deepEqual([...nearbyGroups(1927)].sort(),[1846,1847,1848,1926,1927,1928,2006,2007,2008]);
 assert.equal(nearbyGroups(100).size,4,'clipped at the corner');
});

function setup(){
 let t=1000,view=20;const now=()=>t,peers=[];
 const world=createMockWorld({catalogue,registry,peers:()=>peers,nextView:()=>view++});
 // The observer's page: gateway uLink client -> GameBridge -> GatewayClient (OnlineSession) as the gateway relays it.
 const ulink=new UlinkClient({send:()=>{},now,login:{}});ulink.playerId=1;
 const bridge=new GameBridge({client:ulink,schema,playerName:'Observer',now});
 class Client extends GatewayClient{connect(){}}
 const session=new OnlineSession({join:{endpoint:'ws://127.0.0.1:1/play',ticket:'t'},ClientImpl:Client,now}),page=session.client;page.playerId=1;
 const events=[];bridge.on('event',e=>{events.push({t,...e});page.apply(e);});
 // The server stamps its messages 50 ms before the page gets them (one-way latency; ~20 ms gateway-side on the VM).
 const peer=(playerId,send)=>Object.assign({playerId,user:String(playerId),slots:Array(40).fill(null),connection:{send},gnup(){}},serverHelpers(()=>t-0.05));
 const observer=peer(1,bytes=>ulink.onMessage(bytes)),target=peer(2,()=>{});peers.push(observer,target);
 world.attach(observer);world.attach(target);
 const spawn=(p,position)=>{p.character=view++;p.last=position;p.create({viewId:p.character,owner:p.playerId,group:world.cullGroup(position),prefab:':player_soldier',position});world.spawned(p,position);};
 // How the page draws the other player (main.mjs place -> player-view.mjs upsert): the Create places it, the moves are goals.
 // `legacy` keeps what the page did before: the Create's position pushed as a goal at its arrival time.
 let copy=null,legacy=null;
 session.addEventListener('remote-create',e=>{const r=e.detail,s={position:r.position,yaw:0};copy={snapshots:[]};placeRemote(copy,s,callTime(r,t),{goal:false});
  legacy={snapshots:[]};pushSnapshot(legacy.snapshots,{time:callTime(r,t),position:[...r.position],yaw:0,pitch:0,flags:0});});
 session.addEventListener('remote-move',e=>{const r=e.detail,s={position:r.position,yaw:r.angles.yaw,pitch:r.angles.pitch,flags:r.stateFlags};placeRemote(copy,s,callTime(r,t));pushSnapshot(legacy.snapshots,{time:callTime(r,t),...s,position:[...r.position]});});
 session.addEventListener('remote-destroy',()=>{copy=null;legacy=null;});
 // One move: the referee relays it (world.moved), then the page draws a frame.
 const step=(p,position)=>{t+=0.2;p.last=position;world.moved(p,[position,0,64]);};
 const drawn=()=>copy&&unity(sampleRemote(copy,t-DELAY,{sendInterval:0.2}).position);
 const drawnLegacy=()=>legacy&&unity(sampleRemote(legacy,t-DELAY,{sendInterval:0.2}).position);
 return {world,session,page,events,observer,target,spawn,step,drawn,drawnLegacy,remote:()=>copy,now,stop:()=>world.stop()};
}
// Walk in 1 m steps (5 m/s at the 5 Hz send rate) from a to b; returns the positions.
const path=(a,b)=>{const n=Math.ceil(flat(a,b));return Array.from({length:n},(_,i)=>{const k=(i+1)/n;return [a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];});};

test('cell changes on the original server keep the other player drawn and smooth; leaving its cells removes it',needsAssets,t=>{
 const s=setup(),{events}=s;
 s.spawn(s.observer,OBSERVER);s.spawn(s.target,FAR);
 assert.equal(s.session.remote.size,0,'978 m away: the target is outside the observer\'s 3 x 3 cells, so no Create');
 const id=s.target.character,near=[OBSERVER[0]+2.2,OBSERVER[1],OBSERVER[2]-2.2];
 let created=null,worst=0,worstLegacy=0;
 for(const p of path(FAR,near)){s.step(s.target,p);
  if(!created&&s.remote()){created=events.find(e=>e.type==='create'&&e.viewId===id);}
  const d=s.drawn();if(d){worst=Math.max(worst,flat(d,p));worstLegacy=Math.max(worstLegacy,flat(s.drawnLegacy(),p));}}
 // Entering the observer's cells: one BufferedRPCs with uLink's stored Instantiate, i.e. the SPAWN position, with the
 // group bytes rewritten to the cell the target is in now.
 assert.ok(created,'the target appears when it walks into the observer\'s cells');
 assert.deepEqual(created.position.map(v=>Math.round(v*10)/10),FAR,'the buffered Create still carries where the target spawned');
 assert.equal(created.group,1848,'... and the group of the cell it entered (68, 21)');
 // Within the cells: ChangeGroup only (68,21 -> 67,21 -> 67,22 at z = -3500), the copy stays.
 const changes=events.filter(e=>e.type==='group-change'&&e.viewId===id).map(e=>e.group);
 assert.deepEqual(changes,[1847,1927]);
 assert.equal(events.filter(e=>e.type==='destroy').length,0,'no Destroy while the target walks inside the observer\'s cells');
 assert.equal(s.page.views.get(id).group,1927,'the page tracks the new group (DestroyInGroup of the old one keeps it)');
 assert.ok(s.session.remote.has(id),'still drawn');
 // The drawn copy follows the target (behind by the interpolation delay) and never heads for the spawn point.
 assert.ok(worst<DELAY*5+1.5,`the copy stays on the target's path (worst ${worst.toFixed(1)} m)`);
 t.diagnostic(`drawn copy off the target's path: ${worst.toFixed(2)} m (Create as a goal, before: ${worstLegacy.toFixed(0)} m)`);
 assert.ok(worstLegacy>100,`(before the fix the Create was a goal: the copy was pulled ${worstLegacy.toFixed(0)} m toward the spawn)`);
 // The real run's last 3 s: 12 m on across z = -3500 into group 1847 (the original sent ChangeGroup; the copy stays).
 for(const p of path(near,[5683.7,399.4,-3501.9]))s.step(s.target,p);
 assert.deepEqual(events.filter(e=>e.type==='group-change'&&e.viewId===id).map(e=>e.group).slice(2),[1847]);
 assert.ok(s.session.remote.has(id)&&s.remote(),'the copy survives the cell change');
 assert.ok(flat(s.drawn(),[5683.7,399.4,-3501.9])<DELAY*5+0.5);
 // Walking out of the observer's 3 x 3 cells: DestroyByViewID (old group only) removes the copy, as on the original.
 for(const p of path([5683.7,399.4,-3501.9],FAR))s.step(s.target,p);
 assert.ok(events.some(e=>e.type==='destroy'&&e.kind==='view'&&e.viewId===id));
 assert.equal(s.session.remote.has(id),false);assert.equal(s.remote(),null);
 // And back: created again from the stored Instantiate (spawn position again), drawn on its path from the first move.
 worst=0;let seen=false;
 for(const p of path(FAR,near)){s.step(s.target,p);const d=s.drawn();if(d){seen=true;worst=Math.max(worst,flat(d,p));}}
 assert.ok(seen&&s.session.remote.has(id));assert.ok(worst<DELAY*5+1.5,`re-entry is smooth too (worst ${worst.toFixed(1)} m)`);
 s.stop();
});

test('the observer moving away drops the target\'s cell (DestroyInGroup) and coming back brings it again (BufferedRPCs)',needsAssets,()=>{
 const s=setup(),{events}=s;
 s.spawn(s.observer,OBSERVER);s.spawn(s.target,[OBSERVER[0]+3,OBSERVER[1],OBSERVER[2]]);
 const id=s.target.character;assert.ok(s.session.remote.has(id),'spawned next to us: a live Create');
 // The observer goes 500 m north: row 22 -> 24/25, so row 21-23 (the target's 1927) is dropped.
 const away=[OBSERVER[0],OBSERVER[1],OBSERVER[2]+500];
 for(const p of path(OBSERVER,away)){s.step(s.observer,p);s.step(s.target,[OBSERVER[0]+3,OBSERVER[1],OBSERVER[2]]);}
 const dropped=events.find(e=>e.type==='destroy'&&e.kind==='group'&&e.group===1927);
 assert.ok(dropped,'RemovePlayerFromGroup -> DestroyInGroup(1927)');
 assert.equal(s.session.remote.has(id),false,'the target in that group goes with it');
 for(const p of path(away,OBSERVER)){s.step(s.observer,p);s.step(s.target,[OBSERVER[0]+3,OBSERVER[1],OBSERVER[2]]);}
 assert.ok(s.session.remote.has(id),'AddPlayerToGroup(1927) -> the stored Create again');
 assert.ok(flat(s.drawn(),[OBSERVER[0]+3,0,OBSERVER[2]])<0.5,'drawn where it stands, not where it spawned');
 s.stop();
});
