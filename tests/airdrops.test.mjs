import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
import {Vector3,Quaternion,Matrix4} from 'three';import R from '@dimforge/rapier3d-compat';
import {interpolationDelay,PosRotInterpolator,quatLerp,moveTowards,netDopplerPitch,customRolloff,supplyTargetPosition,randomTargetPos,airDropFlight,signalTarget,SupplyDropTimer,SupplyDropPlaneServer,
 AirdropActors,decodeAirdropCall,callTime,ServerAirdrops,OfflineAirdrops,boxTouchesCapsule} from '../browser/airdrops.mjs';
import {lookRotation} from '../browser/loot.mjs';
import {present,hasRecovered} from './helpers/assets.mjs';

const AIRDROP=new URL('../browser/assets/recovered/airdrop/manifest.json',import.meta.url);
const manifest=hasRecovered?(present(AIRDROP)?JSON.parse(readFileSync(AIRDROP)):null):null;
const loot=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/loot/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))).items):null;
const seeded=(s=0x2545f491)=>()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
const close=(a,b,e=1e-6,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} != ${b}`);

test('Interpolation.BindTiming delay and StateInterpolator buffer order',()=>{
 assert.equal(interpolationDelay(5),0.32);assert.equal(interpolationDelay(10),0.17);
 const q=new Quaternion(),i=new PosRotInterpolator({capacity:3,sendInterval:0.2});
 i.setGoals(new Vector3(0,0,0),q,1);i.setGoals(new Vector3(2,0,0),q,2);i.setGoals(new Vector3(1,0,0),q,1.5);
 assert.deepEqual(i.buffer.map(b=>b.timeStamp),[2,1.5,1],'newest first');
 i.setGoals(new Vector3(9,0,0),q,1.5);assert.equal(i.buffer[1].position.x,9,'equal timestamp replaces');
 i.setGoals(new Vector3(5,0,0),q,0.5);assert.deepEqual(i.buffer.map(b=>b.timeStamp),[2,1.5,1],'full buffer drops a sample older than all');
 i.setGoals(new Vector3(3,0,0),q,3);assert.deepEqual(i.buffer.map(b=>b.timeStamp),[3,2,1.5],'full buffer drops the oldest for a newer sample');
});

test('TransformInterpolator.Sample lerp, gap clamp and ends',()=>{
 const i=new PosRotInterpolator({sendInterval:0.2,allowDifference:0.1}),q=new Quaternion();
 assert.equal(i.sample(1),null);
 i.setGoals(new Vector3(0,0,0),q,1);assert.equal(i.sample(0).position.x,0,'one sample');
 i.setGoals(new Vector3(10,0,0),q,1.2);close(i.sample(1.1).position.x,5,1e-9);
 assert.equal(i.sample(5).position.x,10,'past the newest holds it (no exterpolate)');
 assert.equal(i.sample(0.5).position.x,0,'before the oldest returns the oldest');
 // A 2 s gap is clamped to allowDifference + sendInterval (0.3 s) before the newer sample.
 i.setGoals(new Vector3(30,0,0),q,3.2);assert.equal(i.sample(2.5).position.x,10,'holds before the clamped start');close(i.sample(3.05).position.x,20,1e-9);
 const r=new PosRotInterpolator(),a=new Quaternion(),b=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);r.setGoals(new Vector3(),a,0);r.setGoals(new Vector3(),b,0.2);
 close(r.sample(0.1).rotation.angleTo(a),Math.PI/4,1e-6,'slerp');
});

test('Quaternion.Lerp shortest path and Vector3.MoveTowards',()=>{
 const a=new Quaternion(),b=new Quaternion(0,0,0,-1);assert.ok(quatLerp(a,b,0.5).angleTo(a)<1e-9);
 const m=moveTowards(new Vector3(0.01,0.01,0.01),new Vector3(1,1,1),0.5);close(m.length()-new Vector3(0.01,0.01,0.01).length(),0.5,1e-9);
 assert.deepEqual(moveTowards(new Vector3(0.9,0.9,0.9),new Vector3(1,1,1),1).toArray(),[1,1,1]);
});

test('NetDoppler pitch and custom rolloff curve',()=>{
 assert.equal(netDopplerPitch(0,4000,0.75),1.75);assert.equal(netDopplerPitch(4000,4000,0.75),1);assert.equal(netDopplerPitch(9000,4000,0.75),1);close(netDopplerPitch(2000,4000,0.75),1.375);
 const curve={m_Curve:[{time:0,value:1,inSlope:0,outSlope:0},{time:1,value:0,inSlope:0,outSlope:0}]};close(customRolloff(curve,4000,4000),0);close(customRolloff(curve,0,4000),1);close(customRolloff(curve,2000,4000),0.5);
 if(manifest){const src=manifest.prefabs[manifest.plane].components.AudioSource[0];assert.equal(src.data.rolloffMode,2);assert.equal(src.data.MaxDistance,4000);
  close(customRolloff(src.rolloffCustomCurve,4000/30,4000),1,1e-6,'first key');close(customRolloff(src.rolloffCustomCurve,4000*0.0666666701436,4000),0.5,1e-4);close(customRolloff(src.rolloffCustomCurve,4000,4000),0,1e-6);}
});

test('SupplyDropZone target, CallAirDropAt flight and SignalGrenade target',()=>{
 const rng=seeded(),zone={position:[100,450,-50],radius:1000};
 for(let i=0;i<200;i++){const p=supplyTargetPosition(zone,rng);assert.ok(Math.hypot(p.x-100,p.z+50)<=1000);assert.equal(p.y,450);}
 assert.deepEqual(randomTargetPos([],rng).toArray(),[0,0,0],'no zones: Vector3.zero');
 const target=new Vector3(10,20,30),f=airDropFlight(target,rng,250);
 close(Math.hypot(f.position.x-10,f.position.z-30),5000,1e-6,'20 * maxSpeed away');assert.equal(f.position.y,420);assert.deepEqual(f.dropTarget.toArray(),[10,320,30]);
 const fwd=new Vector3(0,0,1).applyQuaternion(f.rotation),want=f.dropTarget.clone().sub(f.position).normalize();assert.ok(fwd.distanceTo(want)<1e-6,'faces the drop point');
 for(let i=0;i<50;i++){const s=signalTarget(new Vector3(1,2,3),rng);assert.equal(s.y,77);assert.ok(Math.abs(s.x-1)<=20&&Math.abs(s.z-3)<=20);}
});

test('SupplyDropTimer: daily window and airdrop.min_players',()=>{
 const t=new SupplyDropTimer(seeded());assert.equal(t.update(null,100,50),false,'no EnvironmentControlCenter: nothing');assert.ok(t.nextDropTime>=10&&t.nextDropTime<=14);
 const next=t.nextDropTime;assert.equal(t.update(next-0.01,100,50),false);
 assert.equal(t.update(next+0.01,1,50),false,'one connection is not more than 50');assert.equal(t.pending,false,'the pending drop is consumed anyway');
 assert.equal(t.update(23,100,50),false);assert.equal(t.pending,false);
 assert.equal(t.update(3,100,50),false);assert.equal(t.pending,true,'re-armed before 10:00');
 assert.equal(t.update(14.5,51,50),true,'51 > 50 calls the airdrop');assert.equal(t.update(14.6,51,50),false,'once per day');
 const zero=new SupplyDropTimer(seeded(7));zero.update(0,1,0);assert.equal(zero.update(14.01,1,0),true,'min_players 0 lets a single player get drops');
});

test('SupplyDropPlane server flight: target reached, crates, climb and NetDestroy',()=>{
 const rng=seeded(99),target=new Vector3(500,100,500),f=airDropFlight(target,rng,250);
 const p=new SupplyDropPlaneServer({...f,time:0,rng,sendInterval:0.2,maxSpeed:250,numCrates:3});
 const ev=p.update(60),updates=ev.filter(e=>e.type==='update'),drops=ev.filter(e=>e.type==='drop'),destroy=ev.filter(e=>e.type==='destroy');
 assert.deepEqual(updates[0].position.toArray(),f.position.toArray(),'first DoNetwork has no elapsed time');
 close(updates[1].position.distanceTo(updates[0].position),50,1e-6,'250 m/s over one 0.2 s send interval');
 assert.ok(drops.length>=1&&drops.length<=3);const first=drops[0].time;
 // Reaching the target takes ~20 s (5000 m at 250 m/s); the plane passes it one tick before noticing the distance growing.
 assert.ok(first>19.5&&first<21,String(first));
 for(let i=1;i<drops.length;i++){const d=drops[i].time-drops[i-1].time;assert.ok(d>=0.3-1e-9&&d<=0.6+1e-9,String(d));}
 assert.equal(destroy.length,1);close(destroy[0].time-first,20,1e-9,'NetDestroy 20 s after TargetReached');
 assert.ok(updates.every(u=>u.time<=destroy[0].time));assert.deepEqual(p.update(80),[],'nothing after NetDestroy');
 const drop=drops[0],at=updates.filter(u=>u.time<=drop.time).at(-1),fwd=new Vector3(0,0,1).applyQuaternion(at.rotation);
 assert.ok(drop.position.distanceTo(at.position.clone().addScaledVector(fwd,-50))<1e-6,'crate 50 m behind the plane');
 assert.ok(drop.force.distanceTo(fwd.clone().multiplyScalar(-50))<1e-6);close(new Vector3(0,1,0).applyQuaternion(drop.rotation).y,1,1e-9,'upright, random yaw');
 assert.ok(Math.hypot(drop.position.x-500,drop.position.z-500)<120&&Math.abs(drop.position.y-400)<5,'dropped over the target at +300 m');
 assert.ok(updates.at(-1).position.y>drop.position.y+100,'climbs away towards the +800 m target');
});

test('Airdrop RPC decoding is exact',()=>{
 const up={name:'GetNetworkUpdate',args:{class:'SupplyCrate',values:[[1,2,3],[0,0,0,2]]}};
 const d=decodeAirdropCall('plane',up);assert.deepEqual(d.position.toArray(),[1,2,3]);assert.deepEqual(d.rotation.toArray(),[0,0,0,1]);
 assert.equal(decodeAirdropCall('crate',{...up,args:{class:'SupplyDropPlane',values:up.args.values}}).name,'update');
 for(const values of [[[1,2],[0,0,0,1]],[[1,2,NaN],[0,0,0,1]],[[1,2,3],[0,0,0,0]],[[1,2,3],[0,0,0,1],5]])assert.equal(decodeAirdropCall('crate',{name:'GetNetworkUpdate',args:{class:'SupplyCrate',values}}),null);
 assert.equal(decodeAirdropCall('crate',{name:'GetNetworkUpdate',args:{class:'BasicWildLifeAI',values:[[1,2,3],{pitch:0,yaw:0}]}}),null);
 assert.equal(decodeAirdropCall('crate',{name:'Landed',args:{class:'SupplyCrate',values:[]}}).name,'landed');
 assert.equal(decodeAirdropCall('plane',{name:'Landed',args:{class:'SupplyCrate',values:[]}}),null,'planes do not land');
 assert.equal(decodeAirdropCall('crate',{name:'Landed',args:{class:'SupplyCrate',values:[1]}}),null);
 assert.equal(decodeAirdropCall('crate',{name:'SetLooter',args:{class:'LootableObject',values:[7]}}).player,7);
 assert.equal(decodeAirdropCall('crate',{name:'ClearLooter',args:{class:'LootableObject',values:[]}}).player,0);
 assert.equal(callTime({timestampMs:9800,serverMs:10000},50),49.8);assert.equal(callTime({},50),50);assert.equal(callTime({timestampMs:10100,serverMs:10000},50),50,'never in the future');
});

function session(){const client=Object.assign(new EventTarget(),{views:new Map(),world:{sendRate:5}}),s=Object.assign(new EventTarget(),{client,actorCalls:new Map(),inventoryCalls:new Map()});return s;}
const emit=(t,type,detail)=>t.dispatchEvent(Object.assign(new Event(type),{detail}));
test('ServerAirdrops: interpolated plane and crate, retained calls, LAND timing, looter and cleanup',()=>{
 const s=session();let now=10;const actors=new AirdropActors();
 const plane={viewId:70,prefab:'C130',position:[0,800,-0],rotation:[0,0,0,1]},crate={viewId:71,prefab:'SupplyCrate',position:[5,700,-5],rotation:[0,0,0,1]};
 s.client.views.set(70,plane);s.actorCalls.set(70,new Map([['GetNetworkUpdate',{viewId:70,name:'GetNetworkUpdate',args:{class:'SupplyCrate',values:[[50,800,0],[0,0,0,1]]},receivedAt:9.9}]]));
 s.inventoryCalls.set('v:71',[{name:'SetLooter',args:[3]}]);
 const sa=new ServerAirdrops(s,actors,{now:()=>now});assert.equal(actors.actors.get(70).interp.length,1,'retained update replayed');
 s.client.views.set(71,crate);emit(s.client,'create',crate);const c=actors.actors.get(71);assert.deepEqual(c.position.toArray(),[5,700,5],'create pose in Unity space');assert.equal(c.looter,3);assert.equal(actors.contextText(c),'Occupied');
 emit(s.client,'rpc',{viewId:70,name:'GetNetworkUpdate',args:{class:'SupplyDropPlane',values:[[100,800,0],[0,0,0,1]]},timestampMs:100200,serverMs:100200});
 now=10.27;actors.frame(now,0.016);close(actors.actors.get(70).position.x,75,1e-6,'interpolated between 9.9 and 10.0 at playhead 9.95');
 emit(s.client,'rpc',{viewId:71,name:'GetNetworkUpdate',args:{class:'SupplyCrate',values:[[5,690,5],[0,0,0,1]]}});
 emit(s.client,'rpc',{viewId:71,name:'Landed',args:{class:'SupplyCrate',values:[]}});
 let landed=actors.frame(now+0.1,0.1);assert.equal(landed.length,0,'LAND waits for the interpolation playhead');assert.equal(c.chute,true);
 landed=actors.frame(now+0.33,0.23);assert.deepEqual(landed.map(a=>a.id),[71]);assert.equal(c.chute,false);assert.deepEqual(c.landing.position.toArray(),[5,690,5]);
 emit(s.client,'rpc',{viewId:71,name:'ClearLooter',args:{class:'LootableObject',values:[]}});assert.equal(actors.contextText(c),'Search');
 emit(s.client,'rpc',{viewId:71,name:'Landed',args:{class:'SupplyCrate',values:[]}});assert.equal(actors.frame(now+1,0.1).length,0,'one LAND only');
 s.client.views.delete(70);emit(s.client,'destroy',{kind:'view',viewId:70});assert.equal(actors.actors.has(70),false);assert.equal(actors.actors.has(71),true);
 emit(s,'closed',{});assert.equal(actors.actors.size,0);
});

test('Client crate: parachute grows from 0.01 at 2/s, propellers turn 12 rad/s',()=>{
 const a=new AirdropActors();a.create(1,'crate',new Vector3(),new Quaternion(),0);a.create(2,'plane',new Vector3(),new Quaternion(),0);
 let t=0;for(let i=0;i<40;i++){t+=0.0125;a.frame(t,0.0125);}const crate=a.actors.get(1);
 close(crate.chuteScale.x,0.01+0.5*2/Math.sqrt(3),1e-6,'MoveTowards on the scale vector');for(let i=0;i<60;i++){t+=0.0125;a.frame(t,0.0125);}assert.equal(crate.chuteScale.x,1);
 close(a.actors.get(2).propAngle,12*1.25,1e-9);
});

test('KillZone box vs capsule',()=>{
 const m=new Matrix4().compose(new Vector3(0,10,0),new Quaternion(),new Vector3(1,1,1));
 assert.equal(boxTouchesCapsule([0,1.69,0],[2.43,3.69,2.49],m,new Vector3(0,10.3,0),new Vector3(0,11.5,0),0.3),true);
 assert.equal(boxTouchesCapsule([0,1.69,0],[2.43,3.69,2.49],m,new Vector3(3,10.3,0),new Vector3(3,11.5,0),0.3),false);
 assert.equal(boxTouchesCapsule([0,1.69,0],[2.43,3.69,2.49],m,new Vector3(1.4,10.3,0),new Vector3(1.4,11.5,0),0.3),true,'radius reaches the side');
});

const flat=size=>c=>[[c.x-size,0,c.z-size,c.x-size,0,c.z+size,c.x+size,0,c.z-size],[c.x+size,0,c.z-size,c.x-size,0,c.z+size,c.x+size,0,c.z+size]];
test('Offline airdrop: signal -> C130 -> crates fall, land, loot, empty destroy and lifetime',{skip:!manifest&&'airdrop manifest not exported'},async()=>{
 await R.init();let now=0;const rng=seeded(1234),actors=new AirdropActors({manifest}),opened=[],closed=[],crushed=[];
 const player={feet:new Vector3(1e6,0,0),height:1.85,radius:0.4,alive:true};
 const off=new OfflineAirdrops({manifest,lootManifest:loot,items,engine:R,actors,environment:flat(60),now:()=>now,rng,player:()=>player,onCrush:c=>crushed.push(c.id),
  ui:{open:(c,onClose)=>opened.push({c,onClose}),close:c=>closed.push(c)}});
 assert.equal(off.zones.length,2);assert.equal(off.minPlayers,50);
 const call=off.signal(new Vector3(0,0,0));assert.equal(call.target[1],75);assert.equal(actors.actors.get(call.id).kind,'plane');
 off.advance(19);assert.equal(off.crates.size,0,'no crate before the plane reaches the target');
 off.advance(3);const crates=[...off.crates.values()];assert.ok(crates.length>=1&&crates.length<=3,String(crates.length));
 const c=crates[0];assert.ok(c.position.y>300,'dropped 375 m up');assert.equal(off.use(c),false,'accessLocked while falling');assert.equal(actors.actors.get(c.id).chute,true);
 assert.ok(c.loot.slots.some(Boolean),'SupplyDropSpawnListMaster loot is in the crate from instantiation');assert.equal(c.loot.slots.length,12);
 const y0=c.position.y;off.advance(10);const v=(y0-c.position.y)/10;assert.ok(v>4&&v<5.5,'drag 2 terminal speed ~4.7-4.9 m/s: '+v);
 // Stand where the first crate will land: KillZone squishes the player once.
 player.feet=new Vector3(c.position.x,0,c.position.z);
 for(let i=0;i<40&&[...off.crates.values()].some(x=>!x.landed);i++)off.advance(5);
 assert.ok([...off.crates.values()].every(x=>x.landed),'all crates land');assert.deepEqual(crushed,[c.id]);
 for(const x of off.crates.values()){assert.ok(Math.abs(x.position.y)<0.2,'rests on the ground '+x.position.y);assert.ok(new Vector3(0,1,0).applyQuaternion(x.rotation).y>0.95,'upright (centre of mass -1.5)');}
 now+=1;const landed=actors.frame(off.time(),0.016);assert.ok(landed.length>=1&&landed.every(a=>a.chute===false));
 assert.equal(off.planes.size,0,'C130 destroyed 20 s after the drop');assert.equal(actors.actors.has(call.id),false);
 // Loot it: open, take everything, close -> destroyOnEmpty removes the crate (and its presentation).
 assert.equal(off.use(c),true);assert.equal(opened.length,1);assert.equal(c.loot.contextText(),'Occupied');assert.equal(off.use(c),false,'one looter');
 c.loot.slots.fill(null);opened[0].onClose();assert.equal(off.crates.has(c.id),false);assert.equal(actors.actors.has(c.id),false);assert.ok(closed.includes(c.loot));
 // Others expire 600 s after instantiation (LootableObject.lifeTime).
 const rest=[...off.crates.values()];off.advance(600);assert.equal(off.crates.size,0,'lifeTime destroys unlooted crates');assert.equal(rest.every(x=>x.loot.destroyed),true);
});

test('Offline console: airdrop.drop and airdrop.min_players; timer drop needs more players',{skip:!manifest&&'airdrop manifest not exported'},async()=>{
 await R.init();let now=0,hour=9;const actors=new AirdropActors({manifest});
 const off=new OfflineAirdrops({manifest,lootManifest:loot,items,engine:R,actors,now:()=>now,rng:seeded(5),hour:()=>hour});
 off.update();hour=15;off.update();assert.equal(off.planes.size,0,'1 connection is not > 50');
 assert.deepEqual(off.command('airdrop.min_players'),{ok:true,text:'airdrop.min_players: 50'});assert.deepEqual(off.command('airdrop.min_players 0'),{ok:true,text:'airdrop.min_players: 0'});
 hour=3;off.update();hour=14.5;off.update();assert.equal(off.planes.size,1,'timer drop at a random drop zone');
 const p=[...off.planes.values()][0],z=manifest.server.dropZones.map(z=>Math.hypot(p.dropTargetPos.x-z.position[0],p.dropTargetPos.z-z.position[2]));assert.ok(Math.min(...z)<=1000);close(p.dropTargetPos.y,manifest.server.dropZones[0].position[1]+300,1e-3);
 assert.deepEqual(off.command('airdrop.drop'),{ok:true,text:'Called airdrop...'});assert.equal(off.planes.size,2);assert.equal(off.command('env.time'),null);
 off.clear();assert.equal(actors.actors.size,0);
});

test('Exported airdrop prefabs match the decompiled field values',{skip:!manifest&&'airdrop manifest not exported'},()=>{
 const plane=manifest.prefabs[manifest.plane],crate=manifest.prefabs[manifest.crate];
 assert.equal(plane.name,'C130');assert.equal(crate.name,'SupplyCrate');const sp=plane.components.SupplyDropPlane[0];assert.equal(sp.data.maxSpeed,250);assert.equal(sp.data.TEMP_numCratesToDrop,3);assert.equal(sp.propellerNodes.length,4);
 assert.equal(plane.components.NetDoppler[0].data.minPitch,0.75);assert.ok(plane.components.AudioSource[0].clip);
 const lo=crate.components.LootableObject[0].data;assert.equal(lo._lootSpawnListName.name,'SupplyDropSpawnListMaster');assert.equal(lo.lifeTime,600);assert.equal(lo.NumberOfSlots,12);assert.ok(loot.lists[lo._lootSpawnListName.name]);
 const rb=crate.components.Rigidbody[0].data;assert.equal(rb.m_Mass,1);assert.equal(rb.m_Drag,2);const sc=crate.components.SupplyCrate[0];assert.equal(crate.nodes[sc.chuteNode].name,'supplyparachute');assert.equal(crate.nodes[sc.bubbleWrapNode].name,'BubbleWrap');
 assert.equal(manifest.prefabs[sc.landedEffect].name,'SupplyImpactSmoke');assert.equal(manifest.server.dropZones.length,2);assert.ok(manifest.server.dropZones.every(z=>z.radius===1000));assert.equal(manifest.server.dropTimers,1);
});

test('Bridge forwards the RPC timestamp (widened) and server clock for timed airdrop events',async()=>{
 const {GameBridge}=await import('../bridge/game-bridge.mjs'),{BitReader,BitWriter}=await import('../bridge/ulink/bits.mjs'),{EventEmitter}=await import('node:events');
 const schema=JSON.parse(readFileSync(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
 const client=Object.assign(new EventEmitter(),{serverMs:()=>70000n+1234n}),bridge=new GameBridge({client,schema,playerName:'p'}),events=[];bridge.on('event',e=>events.push(e));
 bridge.views.set(71,{prefab:'SupplyCrate',owner:0,group:0});
 bridge.onRpc({viewId:71,rpc:'Landed',timestampLow:Number((70000n+1000n)&0xffffn),timestampBits:16},new BitReader(new Uint8Array(0)));
 assert.equal(events[0].type,'rpc');assert.equal(events[0].args.class,'SupplyCrate');assert.equal(events[0].timestampMs,71000);assert.equal(events[0].serverMs,71234);
 const w=new BitWriter();(await import('../bridge/ulink/rust.mjs')).writeArgs(['Vector3','Quaternion'],[[1,2,3],[0,0,0,1]],w);
 bridge.views.set(70,{prefab:'C130',owner:0,group:0});bridge.onRpc({viewId:70,rpc:'GetNetworkUpdate'},new BitReader(w.toBytes()));
 const up=events[1];assert.equal(up.timestampMs,undefined,'no header timestamp: none forwarded');assert.ok(decodeAirdropCall('plane',up));
});

class FakeSocket extends EventTarget{static last;constructor(){super();this.sent=[];this.readyState=1;FakeSocket.last=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
 send(d){this.sent.push(JSON.parse(d));}close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 push(o){this.dispatchEvent(Object.assign(new Event('message'),{data:JSON.stringify(o)}));}}
test('OnlineSession retains airdrop calls that arrive while the island loads',async()=>{
 const {OnlineSession}=await import('../browser/online.mjs');let now=5;const s=new OnlineSession({join:{ticket:'tk',endpoint:'ws://127.0.0.1:1/play'},WebSocketImpl:FakeSocket,now:()=>now});
 const p=s.connect();await new Promise(r=>setTimeout(r));const ws=FakeSocket.last;ws.push({type:'approved',playerId:1,world:{sendRate:5}});await p;
 ws.push({type:'create',viewId:73,prefab:'SupplyCrate',owner:0,mine:false,position:[1,600,-2],rotation:[0,0,0,1]});
 ws.push({type:'rpc',viewId:73,name:'GetNetworkUpdate',args:{class:'SupplyCrate',values:[[1,300,2],[0,0,0,1]]},timestampMs:10000,serverMs:10050});
 now=6;ws.push({type:'rpc',viewId:73,name:'Landed',args:{class:'SupplyCrate',values:[]},timestampMs:11000,serverMs:11000});
 ws.push({type:'rpc',viewId:73,name:'SetLooter',args:{class:'LootableObject',values:[4]}});
 const actors=new AirdropActors();new ServerAirdrops(s,actors,{now:()=>now});const a=actors.actors.get(73);
 assert.equal(a.interp.length,1);close(a.interp.buffer[0].timeStamp,4.95,1e-9,'snapshot placed 50 ms before receipt');
 // One server clock for every message (server-clock.mjs): the floor offset of the first call (receipt - 50 ms) also
 // places Landed, which itself reached the page with no lead.
 close(a.landAt,5.95,1e-9);assert.equal(a.looter,4);assert.equal(actors.delay,0.32);
 ws.push({type:'destroy',kind:'view',viewId:73});assert.equal(actors.actors.size,0);assert.equal(s.actorCalls.has(73),false);
});
