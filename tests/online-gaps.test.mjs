// Online gap fixes (GAP-AUDIT P1-1, P1-6, P1-7, P1-9): fall impact report, sky sync, HandCannon strikes, kick text,
// armour data and the DoRepair / fIm wire forms. Pure rules plus the bridge against the mock uLink server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {FallTracker,fallImpactMessage,legInjured,injuredInput} from '../browser/fall-damage.mjs';
import {TimeOfDay,readSkyState,applySkyState} from '../browser/tod.mjs';
import {disconnectMessage,niceString,NET_ERROR} from '../browser/net-error.mjs';
import {StrikeGunState,GunState} from '../browser/combat.mjs';
import {remoteWeaponAction} from '../browser/remote-weapon.mjs';
import {readArmorData,OnlineSession} from '../browser/online.mjs';
import {armorRows} from '../browser/rpos.mjs';
import {UlinkClient} from '../bridge/ulink/session.mjs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';
import {GameBridge} from '../bridge/game-bridge.mjs';
import {readArgs,readNgcCall} from '../bridge/ulink/rust.mjs';
import {BitWriter} from '../bridge/ulink/bits.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const scene=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/scene/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))).items):null;
const handCannon=hasRecovered?(Object.values(items).find(i=>i.data.m_Name==='HandCannon')):null;

test('fIm: HumanController landing more than 2 m down reports the whole last airborne velocity when y <= -18',()=>{
 const t=new FallTracker();
 t.update(false,100,-5,[1,-5,2]);t.update(false,80,-19.5,[1.5,-19.5,-2]);
 assert.equal(t.update(true,79,0,[0,0,0]),-19.5);assert.deepEqual(t.landingVelocity,[1.5,-19.5,-2]);
 assert.deepEqual(fallImpactMessage(t.landingVelocity),[1.5,-19.5,-2]);
 // SendFallImpact: !(velocity.y > -18): -18 itself is sent, -17.9 is not, NaN is sent; no landing → nothing.
 assert.deepEqual(fallImpactMessage([0,-18,0]),[0,-18,0]);assert.equal(fallImpactMessage([0,-17.9,0]),null);assert.ok(fallImpactMessage([0,NaN,0]));
 assert.equal(fallImpactMessage(null),null);
 // A drop of 2 m or less (or landing higher) never reports, whatever the speed.
 t.update(false,10,-30,[0,-30,0]);assert.equal(t.update(true,8.5,0),null);assert.equal(t.landingVelocity,null);
 // Without the full vector (offline callers), velocity.y is still tracked.
 t.update(false,10,-25);assert.equal(t.update(true,5,0),-25);assert.deepEqual(t.landingVelocity,[0,-25,0]);
});

test('fIo: the server injury level alone drives the injured input (forced crouch, no sprint/jump, x0.5)',()=>{
 assert.equal(legInjured(0),false);assert.equal(legInjured(1),true);assert.equal(legInjured(-1),false);
 assert.deepEqual(injuredInput({forward:1,sprint:true,jump:true,crouch:false},legInjured(2)),{forward:1,sprint:false,jump:false,crouch:true,scale:0.5});
});

test('OnlineSession retains KP, fIo, ArmorData, UnstickMove and CL_UpdateSkyState for the page',()=>{
 class FakeClient extends EventTarget{constructor(){super();this.views=new Map();this.entities=new Map();this.characterView=20;}connect(){return new Promise(()=>{});}}
 const teleports=[],s=new OnlineSession({join:{endpoint:'ws://x',ticket:'t'},ClientImpl:FakeClient,motor:{teleport:p=>teleports.push(p)}});
 const rpc=(viewId,cls,name,values)=>s.client.dispatchEvent(Object.assign(new Event('rpc'),{detail:{viewId,name,args:{class:cls,values}}}));
 assert.equal(s.disconnectText(),'Disconnected from server.');
 rpc(1,'ServerManagement','KP',[NET_ERROR.Facepunch_Kick_RCON]);assert.equal(s.disconnectText(),'Disconnected (Kicked by admin)');
 rpc(20,'FallDamage','fIo',[1]);assert.equal(s.legInjury,1);rpc(30,'FallDamage','fIo',[5]);assert.equal(s.legInjury,1,'another character');
 const w=new BitWriter();[0,10,20,30,40,-5].forEach(v=>w.f32(v));rpc(20,'EquipmentWearer','ArmorData',[w.toBytes()]);assert.deepEqual(s.armorValues,[0,10,20,30,40,-5]);
 rpc(1,'ServerManagement','UnstickMove',[[1,2,3]]);assert.deepEqual(teleports.at(-1),[1,2,-3]);
 const sky=new BitWriter().f32(30).f32(10).f32(0.5);[1,2,3,4].forEach(v=>sky.f32(v));sky.i32(2014).u8(3).u8(9).f32(21.5);
 rpc(996,'EnvironmentControlCenter','CL_UpdateSkyState',[sky.toBytes()]);assert.equal(s.skyState.hour,21.5);assert.equal(s.skyState.year,2014);
 // A new character (respawn) starts uninjured with no server armour values yet.
 s.dispatchEvent(Object.assign(new Event('character'),{detail:{viewId:21}}));assert.equal(s.legInjury,0);assert.equal(s.armorValues,null);
});

test('CL_UpdateSkyState: decodes the BitStream and snaps the hour only beyond one game minute (and after 0.05 h)',needsAssets,()=>{
 const w=new BitWriter().f32(30).f32(10).f32(-0.25);[0.5,1.5,2.5,3.5].forEach(v=>w.f32(v));w.i32(2015).u8(7).u8(4).f32(22.25);
 const s=readSkyState(w.toBytes());
 assert.deepEqual(s,{daylength:30,nightlength:10,moonPhase:-0.25,cloudUV:[0.5,1.5,2.5,3.5],year:2015,month:7,day:4,hour:22.25});
 assert.throws(()=>readSkyState(new Uint8Array(37)));
 const tod=new TimeOfDay(scene.world.tod);assert.equal(tod.hour,12);
 let r=applySkyState(tod,s);assert.equal(r.snapped,true);assert.equal(tod.hour,22.25);assert.deepEqual([tod.cycle.Year,tod.cycle.Month,tod.cycle.Day,tod.cycle.MoonPhase,tod.daylength,tod.nightlength],[2015,7,4,-0.25,30,10]);
 assert.ok(tod.isNight);
 // Within 1/60 h the local (free-running) hour is kept; the date/lengths still apply.
 r=applySkyState(tod,{...s,hour:22.25+0.01,daylength:45});assert.equal(r.snapped,false);assert.equal(tod.hour,22.25);assert.equal(tod.daylength,45);
 // As written, a local hour at or below 0.05 never snaps.
 tod.hour=0.04;r=applySkyState(tod,{...s,hour:6});assert.equal(r.snapped,false);assert.ok(Math.abs(tod.hour-0.04)<1e-9);
 // Afterwards the clock advances with the server's lengths: night hours at nightlength 10 min per 24 h.
 tod.hour=23;applySkyState(tod,{...s,hour:23});assert.ok(tod.isNight);const before=tod.hour;tod.update(5);assert.ok(Math.abs(tod.hour-before-5/(10*60/24))<1e-9);
});

test('kick reasons use NetErrorHelper nice strings, with the hex fallback for unknown values',()=>{
 assert.equal(disconnectMessage(null),'Disconnected from server.');assert.equal(disconnectMessage(0),'Disconnected from server.');
 assert.equal(disconnectMessage(NET_ERROR.Facepunch_Kick_Violation),'Disconnected (Kicked because of violation)');
 assert.equal(disconnectMessage(NET_ERROR.Facepunch_Kick_Ban),'Disconnected (Kicked and Banned by admin)');
 assert.equal(niceString(NET_ERROR.TooManyConnectedPlayers),'Full');assert.equal(niceString(200),'200(C8)');
});

test('HandCannon (StrikeGunItem): random strike delay, release cancels with a 1 s lockout, then 12 pellets fire',needsAssets,()=>{
 const d=handCannon.data;assert.deepEqual([d.numPellets,d.maxClipAmmo,d.strikeDurations.length,d.fireRate],[12,1,3,1]);
 const inv={n:5,count(){return this.n;},consume(k,n){this.n-=n;}},slot={uses:1};
 const g=new StrikeGunState(d,'shell');g.activate(0);
 let rolls=[0.5,0.2];const rng=()=>rolls.length?rolls.shift():0.5;
 // Deploying (0.75 s) blocks the attack; then Fire begins strike 2 of 3 (Random.Range(1, 4) with 0.5).
 assert.deepEqual(g.frame(0.5,{attack:true},slot,inv,rng),[]);
 const begin=g.frame(1,{attack:true},slot,inv,rng);assert.equal(begin[0].type,'strike');assert.equal(begin[0].strikes,2);assert.ok(begin[0].pitch>=0.96&&begin[0].pitch<=1.03);
 assert.deepEqual(g.frame(1+d.strikeDurations[1]-0.01,{attack:true},slot,inv,rng),[],'still striking');
 // Releasing early cancels; nothing fires and attacks wait 1 s.
 assert.deepEqual(g.frame(2,{attack:false},slot,inv,rng).map(e=>e.type),['cancel']);assert.equal(g.nextPrimaryAttackTime,3);assert.equal(slot.uses,1);
 assert.deepEqual(g.frame(2.5,{attack:true},slot,inv,rng),[]);
 rolls=[0];const again=g.frame(3,{attack:true},slot,inv,rng);assert.equal(again[0].strikes,1);
 const fired=g.frame(3+d.strikeDurations[0]+0.01,{attack:true},slot,inv,rng);assert.equal(fired[0].type,'fire');assert.equal(fired[0].spread.length,12);assert.equal(slot.uses,0);
 assert.ok(fired[0].spread.every(([x,y])=>Math.abs(x)<=6&&Math.abs(y)<=6));assert.deepEqual(fired[0].conditionLoss,[0.5,0.02]);
 // Empty clip: dry fire (no sound on the HandCannon) blocks the auto-reload branch in the same frame, R reloads.
 const empty=g.frame(5,{attack:true},slot,inv,rng);assert.deepEqual(empty.map(e=>e.type),['dryfire']);assert.equal(slot.uses,0);
 const reload=g.frame(6,{reload:true},slot,inv,rng);assert.deepEqual(reload.map(e=>e.type),['reload']);assert.equal(slot.uses,1);assert.equal(inv.n,4);
 assert.deepEqual(g.frame(7,{attack:true},slot,inv,rng),[],'reloadDuration 2 s');
 // Deactivate/activate (holster) resets an unfinished strike.
 g.frame(8.1,{attack:true},slot,inv,()=>0.9);g.activate(8.2);assert.equal(g.beganFiring,false);
 // The plain GunState is unchanged by the shared fire() refactor.
 const m4=Object.values(items).find(i=>i.data.m_Name==='M4').data,gs=new GunState(m4,'a'),s2={uses:2};gs.activate(0);
 const ev=gs.frame(5,{attack:true},s2,{count:()=>0,consume(){}},()=>0.5);assert.equal(ev[0].type,'fire');assert.equal(ev[0].spread.length,1);assert.equal(s2.uses,1);
});

test('remote HandCannon shots decode as ShotgunDataBlock pellet streams',needsAssets,()=>{
 const w=new BitWriter();for(let i=0;i<12;i++){w.u8(255);w.f32(i).f32(2).f32(3);}
 const r=remoteWeaponAction('StrikeGunDataBlock',w.toBytes(),handCannon.data);assert.equal(r.type,'gun');assert.equal(r.hits.length,12);assert.deepEqual(r.hits[11].point,[11,2,3]);
 assert.equal(remoteWeaponAction('StrikeGunDataBlock',w.toBytes().subarray(0,13),handCannon.data),null);
});

test('ArmorData: six untyped floats replace the local armour sum in the RPOS totals',()=>{
 const w=new BitWriter();[0,12.5,3,0,7,1].forEach(v=>w.f32(v));const values=readArmorData(w.toBytes());
 assert.deepEqual(values,[0,12.5,3,0,7,1]);assert.equal(readArmorData(new Uint8Array(20)),null);assert.equal(readArmorData('x'),null);
 assert.deepEqual(armorRows([],items,values),[{name:'Bullet',value:12},{name:'Melee',value:3},{name:'Radiation',value:7},{name:'Cold',value:1}]);
 assert.deepEqual(armorRows([],items),[]);
});

// ---- wire forms through the bridge (mock uLink server) ----
const schema=JSON.parse(await readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
const world={level:'rust_island_2013',sendRate:20,hostname:'Mock',modded:false,official:false,steamId:1n,ip:1,port:28015};
const registry={prefabs:[{handle:';deploy_repairbench',index:-44,messages:[{id:13,name:'TakeAll',class:'LootableObject',params:[]},{id:14,name:'DoRepair',class:'RepairBench',params:[]}]},
 {handle:';deploy_camp_bonfire',index:-45,messages:[{id:5,class:'CampfireInventory',name:'ITMV',params:['NetEntityID','byte','byte'],declaredIn:'Inventory'},{id:13,class:'FireBarrel',name:'StopLooting',params:[],declaredIn:'LootableObject'},{id:14,class:'FireBarrel',name:'TakeAll',params:[],declaredIn:'LootableObject'}]}]};
const within=(p,ms=4000)=>Promise.race([p,new Promise((_,j)=>setTimeout(()=>j(Error('timed out')),ms))]);
async function setup(){
 const now=()=>performance.now()/1000,server=await startMockUlinkServer({world,approve:()=>({approve:true})});
 const socket=createSocket('udp4');await new Promise(r=>socket.bind(0,'127.0.0.1',r));
 const client=new UlinkClient({now,login:{userId:5n,name:'b',ticket:new Uint8Array(4)},send:b=>socket.send(b,server.port,'127.0.0.1')});
 socket.on('message',m=>client.receive(new Uint8Array(m)));
 const bridge=new GameBridge({client,schema,ngcRegistry:registry,playerName:'b',sendRate:world.sendRate,now}),events=[];bridge.on('event',e=>events.push(e));
 const timer=setInterval(()=>{client.tick();bridge.tick();},5);client.start();await within(once(client,'approved'));
 const [peer]=server.peers.values(),bodies=[];peer.onUlink=(h,b)=>bodies.push({h,b});
 const until=async pred=>{const t=Date.now();while(Date.now()-t<3000){const e=pred();if(e)return e;await new Promise(r=>setTimeout(r,5));}throw Error('not seen');};
 return {peer,client,bridge,events,bodies,until,close:async()=>{clearInterval(timer);client.close();socket.close();await server.close();}};
}

test('wire: fIm(Vector3) on the own character, DoRepair as an NGC call, and the server-only RPCs decode', async()=>{
 const s=await setup();
 try{
  s.peer.create({viewId:20,owner:s.client.playerId,prefab:':player_soldier'});s.peer.create({viewId:10,prefab:'ServerManagement'});s.peer.create({viewId:40,prefab:'!Ng',group:7});
  await s.until(()=>s.events.some(e=>e.type==='create'&&e.viewId===40));
  assert.equal(s.bridge.command({type:'rpc',viewId:20,name:'fIm',args:[[0.5,-21,2]]}),true);
  const fim=await s.until(()=>s.bodies.find(x=>x.h.rpc==='fIm'));assert.equal(fim.h.viewId,20);assert.deepEqual(readArgs(['Vector3'],fim.b),[[0.5,-21,2]]);
  assert.equal(s.bridge.command({type:'rpc',viewId:20,name:'fIc',args:[30]}),false,'fIc is server to client');
  s.peer.ngcCreate(40,{prefabIndex:-44,innerID:9,position:[0,0,0],euler:[0,0,0]});await s.until(()=>s.events.some(e=>e.type==='ngc-create'));
  assert.equal(s.bridge.command({type:'inventory',action:'repair',source:{carrier:40,innerID:9}}),true);
  const c=await s.until(()=>s.bodies.find(x=>x.h.rpc==='C'));assert.equal(c.h.viewId,40);const call=readNgcCall(readArgs(['byte[]'],c.b)[0]);
  assert.deepEqual([call.innerID,call.messageID,call.args.length],[9,14,0]);
  assert.equal(s.bridge.command({type:'inventory',action:'repair',source:{viewId:20}}),false,'only bench entities repair');
  // A camp fire's RPCs are declared on LootableObject/Inventory but registered under FireBarrel/CampfireInventory.
  s.peer.ngcCreate(40,{prefabIndex:-45,innerID:11,position:[0,0,0],euler:[0,0,0]});await s.until(()=>s.events.some(e=>e.type==='ngc-create'&&e.innerID===11));
  const fire={carrier:40,innerID:11},sent=[],from=s.bodies.length;for(const [action,extra] of [['stop-looting',{}],['take-all',{}],['move',{target:{viewId:20},fromSlot:6,toSlot:0,op:'move'}]])sent.push(s.bridge.command({type:'inventory',action,source:fire,...extra}));
  assert.deepEqual(sent,[true,true,true]);const calls=await s.until(()=>{const c=s.bodies.slice(from).filter(x=>x.h.rpc==='C').map(x=>readNgcCall(readArgs(['byte[]'],x.b)[0])).filter(x=>x.innerID===11);return c.length>=3?c:null;});
  assert.deepEqual(calls.map(c=>c.messageID),[13,14,5]);
  // Server → client: KP, UnstickMove, fIo, ArmorData, CLEV and the ECC sky stream all decode by class.
  s.peer.rpc(10,'KP',['int'],[143]);s.peer.rpc(10,'UnstickMove',['Vector3'],[[1,2,3]]);s.peer.rpc(20,'fIo',['float'],[1]);
  s.peer.rpc(20,'CLEV',['byte','int'],[1,1234]);s.peer.rpc(20,'ArmorData',['byte[]'],[new Uint8Array(24)]);
  s.peer.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[new Uint8Array(38)]);
  const got=await s.until(()=>{const r=s.events.filter(e=>e.type==='rpc');return r.length>=6?r:null;});
  assert.deepEqual(got.map(e=>[e.name,e.args.class]),[['KP','ServerManagement'],['UnstickMove','ServerManagement'],['fIo','FallDamage'],['CLEV','Inventory'],['ArmorData','EquipmentWearer'],['CL_UpdateSkyState','EnvironmentControlCenter']]);
  assert.equal(got[5].args.values[0].length,38);
 }finally{await s.close();}
});
