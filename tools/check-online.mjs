// Online join without a GPU: the real game page takes a website join ticket from sessionStorage, connects through
// the gateway (central + sidecar + gateway from tests/helpers/stack.mjs; only the Legacy server is mocked), sends
// ClientFirstReady, is placed at the server's spawn, streams GetClientMove and shows a remote player.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {startStack,poll} from '../tests/helpers/stack.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {STATE} from '../browser/net-client.mjs';
import {inventoryFixture} from '../tests/helpers/inventory-fixture.mjs';
import {readArgs,readNgcCall} from '../bridge/ulink/rust.mjs';
import {BitReader} from '../bridge/ulink/bits.mjs';
import {writePlayerClientData} from '../browser/name-tags.mjs';
import {PerspectiveCamera} from 'three';
import {directionalAngle} from '../browser/combat-feedback.mjs';
const web=createServer();await listenServer(web);
const origin=`http://127.0.0.1:${web.address().port}`;
const stack=await startStack({gatewayOrigins:[origin]});
const browser=await chromium.launch(launchOptions());
try{
 const player=await stack.login('browser-player');
 const {ticket}=(await stack.call('POST',`/servers/${stack.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;
 const join={ticket,endpoint:`ws://127.0.0.1:${stack.gateway.port}/play`,server:stack.serverId,name:'Pilot'};
 await mkdir('analysis/browser-qa/feedback',{recursive:true});
 const page=await (await browser.newContext()).newPage({viewport:{width:640,height:400}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));process.on('exit',()=>{if(errors.length)console.error('page errors:',errors);});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(j=>{if(!sessionStorage.getItem('rlb-join-used')){sessionStorage.setItem('rlb-join-used','1');sessionStorage.setItem('rlb-join',JSON.stringify({...j,at:Date.now()}));}},join);
 await page.goto(origin+'/?dev',{waitUntil:'load',timeout:300000});
 // The page connects at start, before the island finishes loading.
 const peer=await poll(()=>[...stack.native.peers.values()].find(p=>p.playerId),120000);
 const catalogue=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)));
 const moveFlags=[];const seen=[],inventoryRequests=[],shots=[],reloads=[],meleeHits=[],meleeSwings=[],bowFires=[],bowHits=[],bowMisses=[],throws=[],ignites=[],placements=[];peer.onUlink=(h,b)=>{seen.push(h.rpc);if(h.rpc==='GetClientMove'){moveFlags.push(readArgs(['Vector3','int','ushort'],b)[2]);if(moveFlags.length>64)moveFlags.shift();}
  if(h.rpc==='Action1'&&[67,68].includes(h.viewId))placements.push({viewId:h.viewId,args:readArgs(h.viewId===67?['Vector3','Vector3','Vector3','Quaternion','uLink.NetworkViewID']:['Vector3','Vector3'],b)});
  if(h.rpc==='Action2'&&[65,66].includes(h.viewId))ignites.push(h.viewId);
  if(h.rpc==='Action1B'){const r=new BitReader(readArgs(['byte[]'],b)[0]);if([63,64,65].includes(h.viewId)){const [origin,forward]=readArgs(['Vector3','Vector3'],r);throws.push({viewId:h.viewId,origin,forward});}else if(h.viewId===62){const [origin,rotation]=readArgs(['Vector3','Quaternion'],r);bowFires.push({viewId:h.viewId,origin,rotation});}else if(h.viewId===61){const target=r.u8()?readArgs(['NetEntityID'],r)[0]:null,point=readArgs(['Vector3'],r)[0],tree=Boolean(r.u8());assert.equal(r.remainingBits,0);meleeHits.push({viewId:h.viewId,target,point,tree,at:Date.now()});}else{const hits=[];while(r.remainingBytes>=13){const part=r.u8(),target=part===255?null:readArgs(['NetEntityID'],r)[0],point=readArgs(['Vector3'],r)[0];hits.push({part,target,point});}shots.push({viewId:h.viewId,hits});}}
  if(h.viewId===62&&h.rpc==='Action2B'){const [target,position]=readArgs(['NetEntityID','Vector3'],new BitReader(readArgs(['byte[]'],b)[0]));bowHits.push({target,position});}
  if(h.viewId===62&&h.rpc==='Action3B')bowMisses.push(readArgs(['Vector3'],new BitReader(readArgs(['byte[]'],b)[0]))[0]);
  if(h.rpc==='Action3'){if(h.viewId===61)meleeSwings.push({viewId:h.viewId,at:Date.now()});else reloads.push(h.viewId);}
  if(h.rpc==='SV_RunConsoleCommand')inventoryRequests.push({name:h.rpc,viewId:h.viewId,args:readArgs(['string'],b)});
  if(h.rpc==='ITSM')inventoryRequests.push({name:h.rpc,args:readArgs(['byte','byte','bool'],b)});
  if(h.rpc==='ISMV')inventoryRequests.push({name:h.rpc,args:readArgs(['byte','byte'],b)});
  if(h.rpc==='ITSP')inventoryRequests.push({name:h.rpc,args:readArgs(['byte'],b)});
  if(h.rpc==='IACT')inventoryRequests.push({name:h.rpc,args:readArgs(['byte','byte'],b)});
  if(h.rpc==='CRFS')inventoryRequests.push({name:h.rpc,args:readArgs(['int','int'],b)});
  if(h.rpc==='CRFX')inventoryRequests.push({name:h.rpc,args:[]});
  if(h.rpc==='DoBeltUse')inventoryRequests.push({name:h.rpc,args:readArgs(['int'],b)});
  if(h.rpc==='RequestRespawn')inventoryRequests.push({name:h.rpc,args:readArgs(['bool'],b)});
  if(h.rpc==='C'){const call=readNgcCall(readArgs(['byte[]'],b)[0]),p=registry.prefabs.find(p=>p.handle===(call.innerID===10?';deploy_repairbench':';drop_lootsack')),m=p.messages[call.messageID];inventoryRequests.push({name:m.name,innerID:call.innerID,args:readArgs(m.params,new BitReader(call.args))});}
 };
 peer.create({viewId:1,prefab:'ServerManagement'});
 await poll(()=>seen.includes('ClientFirstReady'),60000);
 // On the original ground: Unity's (x,z)-(x+1,z+1) cell split gives 368.43 m here (terrain.mjs sampleTriangle, 8569628).
 // The other diagonal gave 367.97 and the old 513-sample terrain 367.74. The NGC door 2 m ahead sits at this height; at
 // 368 it was 0.43 m under the ground and its centre past ContextProbe's 3 m _rayLength from the eye, so no "Close".
 const spawnU=[5244.1,368.43,-4839.6];
 peer.create({viewId:20,owner:peer.playerId,prefab:':player_soldier',position:spawnU});
 const initialSlots=[];initialSlots[0]={name:'Wood',uses:12};initialSlots[3]={name:'556 Ammo',uses:20};initialSlots[30]={name:'M4',uses:7,condition:0.5,maxCondition:0.8,totalModSlots:4,mods:[]};
 for(const [i,name]of ['Holo sight','Silencer','Flashlight Mod','Laser Sight'].entries())initialSlots[8+i]={name,uses:1};
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{slots:initialSlots})]);
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[0,{name:'Wood',uses:14}]]})]);
 peer.rpc(20,'Local_HealthChange',['float','uLink.NetworkViewID'],[72,0]);peer.rpc(20,'Local_BleedChange',['float'],[3]);
 peer.rpc(20,'RecieveNetwork',['float','float','float','float','float','float'],[987,12,75,20,-0.5,2]);
 // ServerManagement.CreatePlayerClientForUser: ":client" (userID, userName) owned by each player, before its character.
 peer.create({viewId:19,owner:peer.playerId,prefab:':client',initialData:writePlayerClientData(76561198000000001n,'browser-player')});
 peer.create({viewId:29,owner:peer.playerId+50,prefab:':client',initialData:writePlayerClientData(76561198000000777n,'Mock Player')});
 peer.create({viewId:30,owner:peer.playerId+50,prefab:':player_soldier',position:[spawnU[0]+3,spawnU[1],spawnU[2]]});
 // Animal state arrives while the island loads and must survive the delayed renderer attachment.
 peer.create({viewId:50,prefab:':wolf_prefab',position:[spawnU[0]+4,spawnU[1],spawnU[2]-2]});
 peer.rpc(50,'GetNetworkUpdate',['Vector3','Angle2'],[[spawnU[0]+4,spawnU[1],spawnU[2]-2],{pitch:0,yaw:90}]);
 await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&window.explorerState.walk,{},{timeout:600000,polling:1000});
 const st=await page.evaluate(()=>window.explorerState);
 assert.ok(Math.hypot(st.player.feet[0]-spawnU[0],st.player.feet[2]+spawnU[2])<0.5,'placed at the server spawn: '+st.player.feet);
 assert.equal(st.online.remote,1);
 assert.equal(st.vitals.health,72);assert.equal(st.vitals.calories,987);assert.equal(st.vitals.bleeding,3);
 await page.waitForSelector('#game-hud:not([hidden])');assert.equal(await page.locator('.hud-health output').textContent(),'72');assert.equal(await page.locator('.hud-food output').textContent(),'987');assert.equal(await page.locator('[data-plaque=Bleeding]').isVisible(),true);assert.equal(await page.locator('[data-plaque=Radiation]').isVisible(),false);assert.equal(await page.locator('.hud-health b').evaluate(e=>e.style.width),'72%');
 await page.keyboard.press('6'); // Empty belt slot keeps the original model visible in captures.
 await page.waitForFunction(()=>window.explorerDev.onlinePlayers()[0]?.pose.includes('idle_stand'),{},{timeout:15000});
 const playerModel=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0]);assert.equal(playerModel.skins,4);assert.equal(playerModel.bones,64);assert.ok(playerModel.armor.some(n=>/censored/.test(n)));
 assert.equal(playerModel.hitboxes.length,23);assert.equal(await page.evaluate(()=>window.explorerDev.onlineHitboxCount()),23);
 const headPart=9; // Original RustPlayer_Head1 HitBox.bodyPart.
 const standingHead=playerModel.hitboxes.find(b=>b.part===headPart).center;
 assert.equal((await page.evaluate(part=>window.explorerDev.onlinePlayerHit(30,part),headPart)).part,headPart,'standing animated head can be hit');
 await mkdir('analysis/browser-qa',{recursive:true});
 await page.evaluate(p=>window.explorerDev.aimPoint([p[0]+3,p[1]+1,p[2]]),st.player.feet);
 await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(400);await page.screenshot({path:'analysis/browser-qa/online-player.png'});
 // GameTip: the remote player's PlayerClient.userName over its head (own tip disabled), alpha 1 - d/20, gone past 20 m.
 const {encodeAngles}=await import('../bridge/ulink/rust.mjs');
 const tag=await page.waitForFunction(()=>window.explorerDev.nameTags().find(t=>t.text==='Mock Player'),{},{timeout:10000}).then(h=>h.jsonValue());
 assert.ok(tag.alpha>0.75&&tag.alpha<0.95&&tag.scale>0.15&&tag.scale<0.7,JSON.stringify(tag));assert.equal((await page.evaluate(()=>window.explorerDev.nameTags())).length,1,'no tip for the local player');
 assert.equal(await page.locator('#name-tags .name-tag:not([hidden])').textContent(),'Mock Player');await page.screenshot({path:'analysis/browser-qa/tags-binds/online-name-tag.png'});
 peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+24,spawnU[1],spawnU[2]],encodeAngles({yaw:0,pitch:0}),0,0.05]);
 await page.waitForFunction(()=>window.explorerDev.nameTags().length===0,{},{timeout:10000});
 peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],spawnU[2]],encodeAngles({yaw:0,pitch:0}),0,0.05]);await page.waitForFunction(()=>window.explorerDev.nameTags().length===1,{},{timeout:10000});
 // Server movement snapshots, then crouch and destruction. No client-side simulation of the remote character.
 let sawWalk=false;for(let i=0;i<36;i++){
  peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],spawnU[2]+i*0.12],encodeAngles({yaw:0,pitch:0}),STATE.movement,0.05]);
  await page.waitForTimeout(100);sawWalk||=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0]?.pose.includes('walk_n'));
 }assert.ok(sawWalk,'original walk clip driven by received movement');
 peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],spawnU[2]+1.32],encodeAngles({yaw:0,pitch:0}),STATE.crouch,0.05]);
 await page.waitForFunction(()=>window.explorerDev.onlinePlayers()[0]?.pose.includes('idle_crouch'),{},{timeout:5000});
 await page.evaluate(p=>window.explorerDev.aimPoint([p[0]+3,p[1]+0.6,p[2]-1.32]),st.player.feet);
 await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/online-player-crouch.png'});
 const crouching=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0]);assert.ok(crouching.hitboxes.find(b=>b.part===headPart).center[1]<standingHead[1]-0.2,'hit regions follow crouching bones');
 assert.equal((await page.evaluate(part=>window.explorerDev.onlinePlayerHit(30,part),headPart)).part,headPart,'crouching animated head can be hit');
 const pm=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url)));
 const equipment=pm.armor.slots.map(slot=>Number(Object.entries(pm.armor.items).find(([,a])=>a.slot===slot&&/Kevlar/.test(a.name))[0]));
 const {BitWriter}=await import('../bridge/ulink/bits.mjs');const armorBytes=uids=>{const w=new BitWriter();for(const uid of uids)w.i32(uid);return w.toBytes();};
 peer.rpc(30,'CFAR',['uLink.BitStream'],[armorBytes(equipment)]);
 await page.waitForFunction(()=>window.explorerDev.onlinePlayers()[0]?.armor.every(n=>n.includes('kevlar')),{},{timeout:10000});
 await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/online-player-armor.png'});
 peer.rpc(30,'CFAR',['uLink.BitStream'],[armorBytes([0,0,0,0])]);
 await page.waitForFunction(()=>window.explorerDev.onlinePlayers()[0]?.armor.some(n=>n.includes('censored')),{},{timeout:5000});
 // Remote item representations bind by native parent/UID without requiring another player's inventory.
 const heldManifest=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)));
 const remoteChecks={};const heldChecks=[];for(const name of ['M4','Rock','Hatchet','Hunting Bow','Torch','Flare','Explosive Charge','HandCannon','Pipe Shotgun','9mm Pistol','Wood Foundation','F1 Grenade']){
  const h=Object.values(heldManifest.held).find(h=>h.item===name),data=new Uint8Array(6),d=new DataView(data.buffer);d.setUint16(0,30,true);d.setInt32(2,h.uid,true);
  peer.create({viewId:95,owner:peer.playerId+50,prefab:h.netName,initialData:data});if(name==='Torch')peer.rpc(95,'Action2',[],[]); // the original server relays the owner's Action2 (never OnStatus, GAP-AUDIT A5-2)
  await page.waitForFunction(n=>window.explorerDev.onlinePlayers()[0]?.held?.item===n&&window.explorerDev.onlinePlayers()[0]?.held?.parts>0,name,{timeout:5000});
  const shown=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0].held);assert.ok(shown.position.every(Number.isFinite));heldChecks.push(shown.item);
  if(name==='M4'){await page.waitForFunction(()=>window.explorerDev.onlinePlayers()[0]?.pose.includes('aim_rifle_upper'),{},{timeout:5000});
   peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],spawnU[2]+1.32],encodeAngles({yaw:0,pitch:45}),STATE.crouch,0.05]);await page.waitForTimeout(400);const upHeld=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0].held.position);await page.screenshot({path:'analysis/browser-qa/online-remote-aim-up.png'});
   peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],spawnU[2]+1.32],encodeAngles({yaw:0,pitch:-45}),STATE.crouch,0.05]);await page.waitForTimeout(400);const downHeld=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0].held.position);assert.ok(upHeld[1]>downHeld[1]+0.1,JSON.stringify({upHeld,downHeld}));await page.screenshot({path:'analysis/browser-qa/online-remote-aim-down.png'});
   peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+4,spawnU[1],spawnU[2]+1.32],encodeAngles({yaw:0,pitch:0}),STATE.crouch,0.05]);await page.waitForTimeout(350);const movedHeld=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0].held.position);assert.ok(movedHeld[0]>shown.position[0]+0.5,'held mesh follows server movement');peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],spawnU[2]+1.32],encodeAngles({yaw:0,pitch:0}),STATE.crouch,0.05]);await page.waitForTimeout(350);await page.evaluate(p=>window.explorerDev.aimPoint([p[0]+3,p[1]+0.6,p[2]-1.32]),st.player.feet);await page.waitForTimeout(250);await page.screenshot({path:'analysis/browser-qa/online-remote-held.png'});}
  if(name==='M4'){
   const shot=new BitWriter().u8(255);[spawnU[0]+200,spawnU[1]+30,spawnU[2]+200].forEach(n=>shot.f32(n));/* +30 m clears the real slope beside the spawn */peer.rpc(95,'Action1B',['byte[]'],[shot.toBytes()]);
   await page.waitForFunction(()=>window.explorerDev.remoteCombat().count===1,{},{timeout:5000});remoteChecks.gun=await page.evaluate(()=>window.explorerDev.remoteCombat());assert.ok(remoteChecks.gun.tracers>0);assert.equal(remoteChecks.gun.last.silenced,false);assert.equal(remoteChecks.gun.last.ends[0][2],Math.fround(-(spawnU[2]+200)));
   await page.waitForFunction(()=>window.explorerDev.muzzleFlashes().particles>0);remoteChecks.flash=await page.evaluate(()=>window.explorerDev.muzzleFlashes());await page.screenshot({path:'analysis/browser-qa/online-remote-firearm.png'});
   const silencer=Object.values(catalogue.items).find(i=>i.data.m_Name==='Silencer');peer.rpc(95,'Mods',['byte[]'],[new BitWriter().u8(1).i32(silencer.data._uniqueID).toBytes()]);
   peer.rpc(95,'Action1',['uLink.BitStream'],[shot.toBytes()]);await page.waitForFunction(()=>window.explorerDev.remoteCombat().count===2,{},{timeout:5000});remoteChecks.silenced=await page.evaluate(()=>window.explorerDev.remoteCombat().last);assert.equal(remoteChecks.silenced.silenced,true);assert.notEqual(remoteChecks.silenced.sound,remoteChecks.gun.last.sound);assert.equal(await page.evaluate(()=>window.explorerDev.muzzleFlashes().count),remoteChecks.flash.count,'silencer adds no new muzzle flash');
   peer.rpc(95,'Action1B',['byte[]'],[new Uint8Array([255])]);await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>window.explorerDev.remoteCombat().count),2,'malformed shot produces no presentation');
   // BulletWeaponDataBlock.DoAction1: a remote head hit (body part 9 on our character view 20) plays headshotSound at the target.
   {const head=new BitWriter().u8(9).u16(0).u16(20);[0.02,0.08,0.05].forEach(n=>head.f32(n));peer.rpc(95,'Action1B',['byte[]'],[head.toBytes()]);
    await page.waitForFunction(()=>window.explorerDev.feedback().remoteHeadshots===1,{},{timeout:5000});remoteChecks.headshot=(await page.evaluate(()=>window.explorerDev.feedback())).lastHeadshot;
    assert.equal(remoteChecks.headshot.viewId,20);assert.equal(remoteChecks.headshot.file,Object.values(heldManifest.weapons).find(w=>w.item==='M4').sounds.headshotSound);
    await page.waitForFunction(f=>window.explorerDev.audio().loaded.some(u=>u.endsWith(f)),remoteChecks.headshot.file,{timeout:5000});}
   const effectMods=['Flashlight Mod','Laser Sight'].map(name=>Object.values(catalogue.items).find(i=>i.data.m_Name===name).data._uniqueID),mods=new BitWriter().u8(2);effectMods.forEach(uid=>mods.i32(uid));peer.rpc(95,'Mods',['byte[]'],[mods.toBytes()]);
   const move=flags=>peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],spawnU[2]+1.32],encodeAngles({yaw:0,pitch:0}),flags,0.05]);move(STATE.crouch|STATE.lamp|STATE.laser);
   await page.waitForFunction(()=>window.explorerDev.weaponMods()?.lights===1&&window.explorerDev.weaponMods()?.lasers===1,{},{timeout:5000});remoteChecks.modEffects=await page.evaluate(()=>window.explorerDev.weaponMods());await page.screenshot({path:'analysis/browser-qa/online-remote-mod-effects.png'});
   move(STATE.crouch);await page.waitForFunction(()=>window.explorerDev.weaponMods().lights===0&&window.explorerDev.weaponMods().lasers===0,{},{timeout:5000});peer.rpc(95,'Mods',['byte[]'],[new Uint8Array([0])]);await page.waitForFunction(()=>window.explorerDev.weaponMods().effects.length===0,{},{timeout:5000});
  }
  if(name==='Hunting Bow'){
   const arrow=new BitWriter();[spawnU[0]+3,spawnU[1]+1.2,spawnU[2]+1.32,0,0,0,1].forEach(n=>arrow.f32(n));peer.rpc(95,'Action1B',['byte[]'],[arrow.toBytes()]);
   await page.waitForFunction(()=>window.explorerDev.remoteCombat().last?.type==='bow'&&window.explorerDev.remoteCombat().arrows>0,{},{timeout:5000});remoteChecks.bow=await page.evaluate(()=>window.explorerDev.remoteCombat());
   // WorldArrow: TrailRenderer + looping flight AudioSource while the remote arrow flies.
   assert.ok(remoteChecks.bow.arrowFx.trails>=1&&remoteChecks.bow.arrowFx.flightSounds>=1,JSON.stringify(remoteChecks.bow.arrowFx));
   assert.deepEqual([bowFires.length,bowHits.length,bowMisses.length,shots.length],[0,0,0,0],'remote presentation sends no local attack/hit reports');await page.screenshot({path:'analysis/browser-qa/online-remote-bow.png'});
  }
  if(name==='Torch'){await page.waitForFunction(()=>window.explorerDev.onlineTorches()[0]?.particles>0&&window.explorerDev.onlineTorches()[0]?.light,{},{timeout:5000});await page.screenshot({path:'analysis/browser-qa/online-remote-torch.png'});
   // Roadmap picture (dev panel hidden): the remote torch at night, then back to midday for the later sky step.
   const torchSky=h=>{const w=new BitWriter().f32(30).f32(10).f32(0.4);[0.1,0.2,0.3,0.4].forEach(v=>w.f32(v));w.i32(2014).u8(6).u8(15).f32(h);return w.toBytes();};
   peer.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[torchSky(22.5)]);await page.waitForFunction(()=>window.explorerDev.tod().night,{},{timeout:5000});
   await page.evaluate(()=>{for(const e of document.querySelectorAll('body > header, body > aside'))e.style.visibility='hidden';});await page.waitForTimeout(500);
   await page.screenshot({path:'analysis/browser-qa/online-remote-torch-night.png'});
   await page.evaluate(()=>{for(const e of document.querySelectorAll('body > header, body > aside'))e.style.visibility='';});
   peer.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[torchSky(12)]);await page.waitForFunction(()=>!window.explorerDev.tod().night,{},{timeout:5000});
   // BasicTorchItemDataBlock relays: Action3 puts the light out, Action2 lights it again.
   peer.rpc(95,'Action3',[],[]);await page.waitForFunction(()=>window.explorerDev.onlineTorches().length===0,{},{timeout:5000});peer.rpc(95,'Action2',[],[]);await page.waitForFunction(()=>window.explorerDev.onlineTorches()[0]?.particles>0,{},{timeout:5000});}
  if(name==='Hatchet'){
   await page.waitForTimeout(400);const beforeSwing=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0].held.position);
   peer.rpc(95,'Action3',['uLink.BitStream'],[new Uint8Array()]);await page.waitForFunction(()=>window.explorerDev.onlinePlayers()[0]?.pose.includes('attack_hatchet'),{},{timeout:5000});await page.waitForTimeout(150);
   const duringSwing=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0].held.position);
   assert.ok(Math.hypot(...duringSwing.map((v,i)=>v-beforeSwing[i]))>0.03,'remote swing moves the animated hand and held mesh');
   await page.screenshot({path:'analysis/browser-qa/online-remote-melee.png'});
   // GroupEvent.Attack plays on native layer 1 from the sampler's current group (hatchet).
   remoteChecks.meleeEvent=(await page.evaluate(()=>window.explorerDev.onlinePlayers()[0])).event;assert.deepEqual(remoteChecks.meleeEvent,{event:'attack',name:'attack_hatchet'});
   // MeleeWeaponDataBlock.DoAction1 relayed hit on our own character (view 20): SurfaceInfo flesh melee effect + sound.
   const feet=st.player.feet,hitStream=new BitWriter().u8(1).u16(0).u16(20);[feet[0],feet[1]+1.2,-feet[2]].forEach(n=>hitStream.f32(n));hitStream.u8(0);peer.rpc(95,'Action1B',['byte[]'],[hitStream.toBytes()]);
   await page.waitForFunction(()=>window.explorerDev.remoteCombat().melee.effects===1,{},{timeout:5000});remoteChecks.meleeHit=(await page.evaluate(()=>window.explorerDev.remoteCombat())).melee;
   assert.equal(remoteChecks.meleeHit.last.surface,'flesh');assert.ok(remoteChecks.meleeHit.last.particles>0&&remoteChecks.meleeHit.last.sound,JSON.stringify(remoteChecks.meleeHit));
   await page.waitForFunction(f=>window.explorerDev.audio().loaded.some(u=>u.endsWith(f)),remoteChecks.meleeHit.last.sound,{timeout:5000});
   const miss=new BitWriter().u8(0);for(const n of [0,0,0])miss.f32(n);miss.u8(1);peer.rpc(95,'Action1B',['byte[]'],[miss.toBytes()]);
   await page.waitForFunction(()=>window.explorerDev.remoteCombat().melee.hits===2,{},{timeout:5000});assert.equal(await page.evaluate(()=>window.explorerDev.remoteCombat().melee.effects),1,'tree/miss hits carry no entity and play no remote effect');
  }
  peer.destroyView(95);await page.waitForFunction(()=>!window.explorerDev.onlinePlayers()[0]?.held&&window.explorerDev.onlineTorches().length===0,{},{timeout:5000});
 }
 await page.waitForFunction(()=>window.explorerDev.onlineAnimals()[0]?.rendered,{},{timeout:5000});
 let animalMoved=false;for(let i=0;i<8;i++){
  peer.rpc(50,'GetNetworkUpdate',['Vector3','Angle2'],[[spawnU[0]+4+i*0.15,spawnU[1],spawnU[2]-2],{pitch:0,yaw:90}]);
  await page.waitForTimeout(100);animalMoved||=await page.evaluate(()=>window.explorerDev.onlineAnimals()[0]?.clip==='walk');
 }assert.ok(animalMoved,'server movement drives wolf walk');
 peer.rpc(50,'CL_Attack',[],[]);await page.waitForFunction(()=>window.explorerDev.onlineAnimals()[0]?.clip==='bite',{},{timeout:5000});
 peer.rpc(50,'ClientHealthChange',['float'],[17]);await page.waitForFunction(()=>window.explorerDev.onlineAnimals()[0]?.health===17,{},{timeout:5000});
 peer.rpc(50,'ClientDeath',['Vector3','uLink.NetworkViewID'],[[spawnU[0]+5.05,spawnU[1],spawnU[2]-2],20]);
 await page.waitForFunction(()=>window.explorerDev.onlineAnimals()[0]?.dead&&window.explorerDev.onlineAnimals()[0]?.clip==='death',{},{timeout:5000});
 await page.evaluate(p=>window.explorerDev.aimPoint([p[0]+5.05,p[1]+0.3,p[2]+2]),st.player.feet);await page.waitForTimeout(1100);
 await page.screenshot({path:'analysis/browser-qa/online-wolf.png'});const animalModel=await page.evaluate(()=>window.explorerDev.onlineAnimals()[0]);
 await poll(()=>seen.includes('GetClientMove'),120000);
 // A server structure arrives as an NGC instantiation on a '!Ng' carrier and is drawn with collision.
 const registry=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../browser/assets/recovered/ngc/registry.json',import.meta.url)));
 const foundation=registry.prefabs.find(p=>p.handle===';struct_wood_foundation');
 peer.create({viewId:40,prefab:'!Ng',group:7,position:[0,0,0]}); // NGC carriers have a non-zero group (NetEntityID p1)
 // Origin 364.5 m: the top (about 4 m up) is level with the ground at its centre (368.54 m), below the shot line to the
 // dead wolf beside it. spawnU[1]-3.5 left it 0.43 m proud once spawnU followed the corrected ground.
 peer.ngcCreate(40,{prefabIndex:foundation.index,innerID:1,position:[spawnU[0]+6,364.5,spawnU[2]],euler:[0,45,0]});
 const ore=registry.prefabs.find(p=>p.handle===';res_ore_1');
 peer.ngcCreate(40,{prefabIndex:ore.index,innerID:2,position:[spawnU[0]-6,spawnU[1],spawnU[2]],euler:[0,0,0]});
 await page.waitForFunction(()=>window.explorerState?.online?.entities===2,{},{timeout:120000,polling:500});
 // Server state on entities: a deployable door opened at connect (DOc), then the ore node's depletion stage (modelindex).
 const {writeArgs,ngcWire}=await import('../bridge/ulink/rust.mjs');
 // NGC calls on the wire as the original server sends them (ngcWire): SetLooter, ClearLooter, ReceiveNetState type-safe
 // without a timestamp, the buffered ones under "C<innerID>_<message>" (P5 deploy.campfire, 2026-10-23).
 const call=(prefab,innerID,name,types,values)=>peer.ngcCall(40,{innerID,messageID:prefab.messages.findIndex(m=>m.name===name),args:writeArgs(types,values).toBytes()},{...ngcWire(name),live:true});
 const door=registry.prefabs.find(p=>p.handle===';deploy_wood_door');
 peer.ngcCreate(40,{prefabIndex:door.index,innerID:3,position:[spawnU[0],spawnU[1],spawnU[2]+2],euler:[0,0,0]});
 call(door,3,'DOc',['sbyte'],[1]);call(ore,2,'modelindex',['int'],[2]);
 await page.waitForFunction(()=>{const o=window.explorerState?.online;return o?.doors?.[0]?.state===1&&o.models?.[0]===2;},{},{timeout:120000,polling:500});
 // Use it like the original client: E down sends Context:A(door), a quick release sends Context:B.
 const ctxSeen=[];const prev=peer.onUlink;peer.onUlink=(h,b)=>{prev(h,b);if(String(h.rpc).startsWith('Context:'))ctxSeen.push(h.rpc);};
 // Re-aim on every poll: DOc snaps the door open as the message arrives, but its collision body takes the open pose in the
 // next frame. A stalled frame (e.g. compiling the new entities' programs) left the old single aim pointing at the closed
 // panel's box, i.e. into the empty doorway, so the ContextProbe never hit the door (reproduced with frames paused).
 // BasicDoor.ContextText on the opened server door: "Close" (only Contextual entities answer the probe).
 await page.waitForFunction(()=>window.explorerDev.aimAtOnline(2)&&document.querySelector('#use-hint')?.textContent==='Close',{},{timeout:120000,polling:500});
 await page.evaluate(()=>{const key=t=>document.body.dispatchEvent(new KeyboardEvent(t,{code:'KeyE',bubbles:true}));key('keydown');key('keyup');});
 await poll(()=>ctxSeen.includes('Context:B'),60000);assert.deepEqual(ctxSeen.slice(0,2),['Context:A','Context:B']);peer.rpc(998,'Context:K',[],[]);
 // Held: the server's menu (Context:E ContextMenuData) opens the original ContextUI while E is down; a click sends
 // Context:C(option name), the validating box stays until the server's reply, the release then sends nothing more.
 await page.waitForFunction(()=>window.explorerDev.contextUI().online?.state==='off',{},{timeout:10000});
 ctxSeen.length=0;const ctxArgs=[],prevCtx=peer.onUlink;peer.onUlink=(h,b)=>{prevCtx(h,b);if(h.rpc==='Context:C')ctxArgs.push(readArgs(['int'],b)[0]);};
 await page.evaluate(()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true})));await poll(()=>ctxSeen.includes('Context:A'),10000);await page.waitForTimeout(350);
 peer.rpc(998,'Context:E',['ContextMenuData'],[[{name:5,text:'Close'},{name:9,text:'Enter Code'}]]);
 await page.waitForSelector('#context-ui:not([hidden]) .ctx-button[data-option="Enter Code"]',{timeout:10000});const heldMenu=await page.evaluate(()=>window.explorerDev.contextUI());
 assert.deepEqual(heldMenu.ui.buttons.map(b=>b.text),['Close','Enter Code']);assert.equal(heldMenu.online.state,'options');await page.screenshot({path:'analysis/browser-qa/ui3/online-context-menu.png'});
 await page.locator('#context-ui .ctx-button[data-option="Enter Code"]').click();await poll(()=>ctxArgs.length===1,10000);assert.deepEqual(ctxArgs,[9]);
 assert.equal((await page.evaluate(()=>window.explorerDev.contextUI())).ui.string,'Enter Code','ContextUI.GUIString shows the shared GUIContent (last option text)');
 peer.rpc(998,'Context:K',[],[]);await page.waitForFunction(()=>window.explorerDev.contextUI().online?.state==='off'&&!window.explorerDev.contextUI().ui.visible,{},{timeout:10000});
 await page.evaluate(()=>document.body.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyE',bubbles:true})));await page.waitForTimeout(200);assert.deepEqual(ctxSeen,['Context:A','Context:C']);peer.onUlink=prevCtx;
 console.log('contextUI',JSON.stringify({menu:heldMenu.ui.buttons,choice:ctxArgs[0]}));
 // The server door (NGC ;deploy_wood_door) carries its ContextSprite use-icon: in range (5 m) next to it.
 await page.waitForFunction(()=>window.explorerDev.contextSprites().some(s=>s.id==='WoodenDoor'&&s.visible),{},{timeout:5000});
 // Native server UI prompts: validate locally, send the exact command, await server outcomes.
 peer.rpc(997,'CL_ConsoleCommand',['string'],['lockentry.show true']);const lockPanel='#lock-entry:not([hidden]) [data-df-name="LockEntry"]';await page.waitForSelector(lockPanel);assert.equal(await page.locator('#lock-label').textContent(),'New Password:');
 // Original LockEntry panel: a bad entry raises the client's own notice.popup 5 and sends nothing; DigitEntryRestrictions drops letters.
 await page.locator('#lock-code').fill('123');await page.locator('#lock-entry [data-df-name="OkayButton"]').click();await page.waitForFunction(()=>window.explorerDev.popupNotices().includes('Password must be 4 digits.'),{},{timeout:5000});assert.ok(await page.locator(lockPanel).isVisible());assert.equal(inventoryRequests.filter(r=>r.name==='SV_RunConsoleCommand').length,0);
 await page.locator('#lock-code').fill('');await page.locator('#lock-code').fill('12a3');assert.equal(await page.locator('#lock-code').inputValue(),'123');await page.locator('#lock-code').press('Enter');await page.waitForTimeout(100);assert.equal(inventoryRequests.filter(r=>r.name==='SV_RunConsoleCommand').length,0);
 await page.setViewportSize({width:1280,height:720});await page.screenshot({path:'analysis/browser-qa/online-lock-code.png'});assert.ok(await page.evaluate(()=>{const r=document.querySelector('#lock-entry [data-df-name="LockEntry"]').getBoundingClientRect();return r.width===400&&r.left>=0&&r.right<=innerWidth;}));
 await page.locator('#lock-code').fill('0456');await page.locator('#lock-code').press('Enter');await poll(()=>inventoryRequests.some(r=>r.name==='SV_RunConsoleCommand'),5000);assert.deepEqual(inventoryRequests.find(r=>r.name==='SV_RunConsoleCommand'),{name:'SV_RunConsoleCommand',viewId:997,args:['lockentry.passwordentry 0456 true']});assert.equal(await page.locator('#lock-code').inputValue(),'');
 // Rust.Notice.Popup -> notice.popup <seconds> <icon> <text> -> the original PopupNotice with the server's icon.
 peer.rpc(997,'CL_ConsoleCommand',['string'],['notice.popup 5 key "Incorrect password."']);await page.waitForFunction(()=>window.explorerDev.popupNotices().includes('Incorrect password.'),{},{timeout:5000});
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#popup-ui .popup-notice')].find(n=>n.dataset.text==='Incorrect password.')?.querySelector('[data-df-name="Icon"]')?.textContent),'key');
 // Rust.Notice.Inventory (ResourceTarget.DoGather) arrives as notice.inventory and shows the original PopupInventory, not the plain log.
 peer.rpc(997,'CL_ConsoleCommand',['string'],['notice.inventory "10 x Wood"']);await page.waitForFunction(()=>[...document.querySelectorAll('#popup-ui .popup-inventory')].some(e=>e.textContent.endsWith('10 x Wood')),{},{timeout:5000});assert.ok(!(await page.evaluate(()=>window.explorerDev.popupNotices())).includes('10 x Wood'));
 // dfTextbox Escape (OnCancel) only restores the text it had when focused; Cancel closes without sending anything.
 peer.rpc(997,'CL_ConsoleCommand',['string'],['lockentry.show false']);await page.waitForSelector(lockPanel);assert.equal(await page.locator('#lock-label').textContent(),'Password:');await page.locator('#lock-code').pressSequentially('7');await page.keyboard.press('Escape');assert.equal(await page.locator('#lock-code').inputValue(),'');assert.ok(await page.locator(lockPanel).isVisible());await page.locator('#lock-entry [data-df-name="CancelButton"]').click();await page.waitForFunction(()=>document.querySelector('#lock-entry').hidden,{},{timeout:5000});assert.equal(inventoryRequests.filter(r=>r.name==='SV_RunConsoleCommand').length,1);
 peer.rpc(997,'CL_ConsoleCommand',['string'],['lockentry.show false']);await page.waitForSelector(lockPanel);peer.rpc(997,'CL_ConsoleCommand',['string'],['lockentry.hide']);await page.waitForFunction(()=>document.querySelector('#lock-entry').hidden,{},{timeout:5000});await page.setViewportSize({width:1280,height:720});
 // Server-controlled fires use the recovered flame/smoke systems; send state immediately after the entity arrives.
 const fire=registry.prefabs.find(p=>p.handle===';deploy_camp_bonfire');
 peer.ngcCreate(40,{prefabIndex:fire.index,innerID:4,position:[spawnU[0]-2,spawnU[1],spawnU[2]-2],euler:[0,0,0]});
 call(fire,4,'ReceiveNetState',['bool'],[true]);
 await page.waitForFunction(()=>window.explorerDev.onlineFires()[0]?.particles>0,{},{timeout:15000});
 await page.evaluate(()=>{window.explorerDev.teleport([5244.1,369,4839.6]);window.explorerDev.aimAtOnline(3);});await page.waitForTimeout(600);
 await mkdir('analysis/browser-qa',{recursive:true});await page.screenshot({path:'analysis/browser-qa/online-fire.png'});
 const fireOn=await page.evaluate(()=>window.explorerDev.onlineFires()[0]);assert.equal(fireOn.lit,true);assert.ok(fireOn.effects>0);
 call(fire,4,'ReceiveNetState',['bool'],[false]);await page.waitForFunction(()=>window.explorerDev.onlineFires()[0]?.lit===false,{},{timeout:5000});
 const sack=registry.prefabs.find(p=>p.handle===';drop_lootsack'),aiSack=registry.prefabs.find(p=>p.handle===';drop_lootsack_zombie'),sleeper=registry.prefabs.find(p=>p.handle===';sleeper_male');
 for(const [prefab,innerID,dx,dz]of [[sack,5,-2,1],[aiSack,6,-2,2],[sleeper,7,-3,2]])peer.ngcCreate(40,{prefabIndex:prefab.index,innerID,position:[spawnU[0]+dx,spawnU[1],spawnU[2]+dz],euler:[0,0,0]});
 call(sleeper,7,'SAAM',['int','int','int','int'],equipment);
 await page.waitForFunction(()=>{const p=window.explorerDev.onlineProps();return p.some(p=>p.prefab===';drop_lootsack'&&p.body)&&p.some(p=>p.prefab===';drop_lootsack_zombie'&&p.body)&&p.some(p=>p.prefab===';sleeper_male'&&p.body&&p.armor?.every(n=>n.includes('kevlar')));},{},{timeout:15000});
 const props=await page.evaluate(()=>window.explorerDev.onlineProps().filter(p=>/loot|sleeper/.test(p.prefab)));assert.equal(props.length,3);
 await page.evaluate(p=>window.explorerDev.aimPoint([p[0]-3,p[1]+0.15,p[2]-2]),st.player.feet);await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/online-sleeper-loot.png'});
 // The early full+dirty player snapshot survives loading. UI moves request server approval and do not mutate slots.
 await page.setViewportSize({width:1280,height:900});
 const dragSlot=async(from,to,shift)=>{const a=await page.locator(from).boundingBox(),b=await page.locator(to).boundingBox();assert.ok(a&&b);await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});if(shift)await page.keyboard.down('Shift');await page.mouse.up();if(shift)await page.keyboard.up('Shift');};
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');
 assert.equal(await page.locator('#pack [data-slot="0"] span').textContent(),'x14');
 await dragSlot('#pack [data-slot="0"]','#pack [data-slot="1"]');
 await poll(()=>inventoryRequests.some(r=>r.name==='ISMV'&&r.args[0]===0&&r.args[1]===1),5000); // empty target: ItemMovePredicted → ISMV
 assert.equal(await page.locator('#pack [data-slot="0"] span').textContent(),'x14','no optimistic item mutation');
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[0,null],[1,{name:'Wood',uses:14}]]})]);
 await page.waitForFunction(()=>document.querySelector('#pack [data-slot="1"] span')?.textContent==='x14',{},{timeout:5000});
 // Item right-click menu and Shift-combine (browser/item-ops.mjs): exact requests, never a local slot change.
 {const extra=[[5,{name:'M4 Blueprint',uses:1}],[6,{name:'Armor Part 1',uses:2}],[7,{name:'Armor Part 1',uses:3}],[12,{name:'Research Kit 1',uses:3}],[13,{name:'Research Kit 1',uses:1}]];
  peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:extra})]);await page.waitForSelector('#pack [data-slot="13"] img');
  const reqs=name=>inventoryRequests.filter(r=>r.name===name),menuClick=async(cell,label)=>{await page.locator(cell).click({button:'right'});await page.waitForSelector('#item-menu:not([hidden])');const labels=await page.locator('#item-menu button').allTextContents();await page.locator(`#item-menu [data-menu-option="${label}"]`).click();return labels;};
  assert.deepEqual(await menuClick('#pack [data-slot="1"]','Split'),['Split']);await poll(()=>reqs('ITSP').some(r=>r.args[0]===1),5000);assert.equal(await page.locator('#pack [data-slot="1"] span').textContent(),'x14','split waits for the server');
  assert.deepEqual(await menuClick('#pack [data-slot="5"]','Study'),['Study']);await poll(()=>reqs('IACT').some(r=>r.args[0]===5&&r.args[1]===4),5000);assert.equal(await page.locator('#pack [data-slot="5"] img').getAttribute('alt'),'M4 Blueprint');
  assert.deepEqual(await menuClick('#belt [data-slot="30"]','Unload'),['Unload']);await poll(()=>reqs('IACT').some(r=>r.args[0]===30&&r.args[1]===9),5000);
  const itsm=()=>reqs('ITSM').length;let n=itsm();await dragSlot('#pack [data-slot="6"]','#pack [data-slot="7"]',true);await page.waitForTimeout(300);assert.equal(itsm(),n,'Shift recipe combine is predicted Failed: nothing sent');
  await dragSlot('#pack [data-slot="6"]','#pack [data-slot="7"]');await poll(()=>reqs('ITSM').some(r=>r.args[0]===6&&r.args[1]===7&&r.args[2]===false),5000);assert.equal(await page.locator('#pack [data-slot="6"] span').textContent(),'x2');
  n=itsm();await dragSlot('#pack [data-slot="12"]','#pack [data-slot="13"]',true);await page.waitForTimeout(300);assert.equal(itsm(),n,'research needs the server workbench flag (wbi)');
  peer.rpc(20,'wbi',['bool'],[true]);await page.waitForTimeout(200);await dragSlot('#pack [data-slot="12"]','#pack [data-slot="13"]',true);await poll(()=>reqs('ITSM').some(r=>r.args[0]===12&&r.args[1]===13&&r.args[2]===true),5000);
  await page.screenshot({path:'analysis/browser-qa/items/online-item-requests.png'});peer.rpc(20,'wbi',['bool'],[false]);
  peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:extra.map(([slot])=>[slot,null])})]);await page.waitForFunction(()=>!document.querySelector('#pack [data-slot="13"] img'));}
 await page.locator('#inventory-close').click();
 call(sack,5,'SetLooter',['uLink.NetworkPlayer'],[peer.playerId]);call(sack,5,'GNUP',['byte[]'],[inventoryFixture(catalogue,{capacity:3,slots:[{name:'Wood',uses:7}]})]);
 await page.waitForSelector('#inventory[open] #loot [data-loot="0"] img');
 await dragSlot('#loot [data-loot="0"]','#pack [data-slot="1"]');
 await poll(()=>inventoryRequests.some(r=>r.name==='ITMG'&&r.innerID===5&&r.args[0].viewId===20&&r.args[2]===1&&r.args[3]===false),5000);
 assert.equal(await page.locator('#loot [data-loot="0"] span').textContent(),'x7','loot waits for server confirmation');
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[1,{name:'Wood',uses:21}]]})]);call(sack,5,'GNUP',['byte[]'],[inventoryFixture(catalogue,{capacity:3,full:false,updates:[[0,null]]})]);
 await page.waitForFunction(()=>document.querySelector('#pack [data-slot="1"] span')?.textContent==='x21',{},{timeout:5000});
 await page.locator('#inventory-close').click();await poll(()=>inventoryRequests.some(r=>r.name==='StopLooting'),5000);
 call(sack,5,'SetLooter',['uLink.NetworkPlayer'],[peer.playerId]);call(sack,5,'GNUP',['byte[]'],[inventoryFixture(catalogue,{capacity:3,slots:[{name:'Wood',uses:3}]})]);
 await page.waitForSelector('#inventory[open] #loot [data-loot="0"] img');
 // No Take all (TakeAllButton inactive in RPOSLootWindow, LootableObject.TakeAll empty): drag the item to an empty bag cell → ITMV.
 assert.equal(await page.locator('#loot-action').isHidden(),true,'the loot window has no Take all button');
 await dragSlot('#loot [data-loot="0"]','#pack [data-slot="0"]');await poll(()=>inventoryRequests.some(r=>r.name==='ITMV'&&r.innerID===5&&r.args[0].viewId===20&&r.args[1]===0&&r.args[2]===0),5000);
 await page.screenshot({path:'analysis/browser-qa/online-inventory.png'});call(sack,5,'ClearLooter',[],[]);
 // LootableObject.ClearLooter → RPOS.CloseLootWindow → RPOSLootWindow.LootClosed: only the loot window goes, RPOS stays open.
 await page.waitForFunction(()=>!document.querySelector('#loot [data-loot]'),{},{timeout:5000});assert.equal(await page.locator('#inventory').evaluate(d=>d.open),true,'ClearLooter keeps RPOS open');
 await page.locator('#inventory-close').click();await page.waitForSelector('#inventory:not([open])',{state:'attached'});
 // Server blueprints and craft progress populate the existing crafting window; only GNUP grants output.
 const bpKey=Object.keys(catalogue.blueprints).find(k=>catalogue.items[catalogue.blueprints[k].result].data.m_Name==='Wood Planks'),bp=catalogue.blueprints[bpKey],bpUID=catalogue.items[bpKey].data._uniqueID;
 peer.rpc(20,'ReceiveBoundBPs',['byte[]'],[new BitWriter().i32(1).i32(bpUID).toBytes()]);peer.rpc(20,'wbi',['bool'],[false]);
 // After a loot the Crafting window stays hidden until its bumper (OpenLootWindow ExternalClosed it; hidesWithExternalClose 1).
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');
 if(!await page.locator(`[data-blueprint="${bpKey}"]`).isVisible())await page.locator('.rpos-bumper-button',{hasText:'Crafting'}).click();
 await page.locator(`[data-blueprint="${bpKey}"]`).click();await page.locator('#craft').click();
 await poll(()=>inventoryRequests.some(r=>r.name==='CRFS'&&r.args[0]===1&&r.args[1]===bpUID),5000);
 assert.equal(await page.locator('#pack [data-slot="1"] span').textContent(),'x21');
 peer.rpc(20,'CRFU',['float','float','float','float','int','int'],[0,2,1,0,bpUID,1]);
 await page.waitForFunction(()=>document.querySelector('#craft').textContent==='Cancel',{},{timeout:5000});
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[1,{name:'Wood',uses:11}],[2,{item:bp.result,uses:1}]]})]);peer.rpc(20,'CRFC',[],[]);
 await page.waitForFunction(()=>document.querySelector('#pack [data-slot="1"] span')?.textContent==='x11'&&document.querySelector('#pack [data-slot="2"] img')?.alt==='Wood Planks',{},{timeout:5000});
 await page.locator('#craft').click();await poll(()=>inventoryRequests.filter(r=>r.name==='CRFS').length===2,5000);peer.rpc(20,'CRFU',['float','float','float','float','int','int'],[2,2,1,0,bpUID,1]);
 await page.locator('#craft').click();await poll(()=>inventoryRequests.some(r=>r.name==='CRFX'),5000);peer.rpc(20,'CRFC',[],[]);
 await page.waitForFunction(()=>document.querySelector('#craft').textContent==='Craft');peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[1,{name:'Wood',uses:31}]]})]);await page.waitForFunction(()=>document.querySelector('#pack [data-slot="1"] span')?.textContent==='x31');
 await page.locator('#craft-plus').click({modifiers:['Control']});assert.equal(await page.locator('#craft-amount').inputValue(),'3');await page.locator('#craft').click();await poll(()=>inventoryRequests.some(r=>r.name==='CRFS'&&r.args[0]===3&&r.args[1]===bpUID),5000);assert.equal(await page.locator('#pack [data-slot="1"] span').textContent(),'x31','batch request consumes nothing locally');
 peer.rpc(20,'CRFU',['float','float','float','float','int','int'],[2,6,0,2,bpUID,3]);await page.waitForFunction(()=>document.querySelector('#craft-amount').disabled&&Math.abs(document.querySelector('#craft-progress').value-1/3)<0.001);await page.screenshot({path:'analysis/browser-qa/online-crafting-batch.png'});
 // CraftingInventory.CancelCrafting sends CRFX and clears crafting.inProgress at once; RPOSCraftWindow.Update labels the
 // button from isCrafting, so it reads Craft before the server's CRFC arrives (E5, 4783994).
 await page.locator('#craft').click();await poll(()=>inventoryRequests.filter(r=>r.name==='CRFX').length===2,5000);await page.waitForFunction(()=>document.querySelector('#craft').textContent==='Craft',{},{timeout:5000});peer.rpc(20,'CRFC',[],[]);peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[1,{name:'Wood',uses:11}]]})]);await page.waitForFunction(()=>document.querySelector('#craft').textContent==='Craft');
 await page.screenshot({path:'analysis/browser-qa/online-crafting.png'});await page.locator('#inventory-close').click();await page.keyboard.press('1');
 await poll(()=>inventoryRequests.some(r=>r.name==='DoBeltUse'&&r.args[0]===0),5000);
 peer.create({viewId:60,owner:peer.playerId,prefab:'MockHeldItem'});peer.rpc(20,'IAST',['byte','uLink.NetworkViewID'],[30,60]);
 await page.waitForFunction(()=>window.explorerDev.viewModel()?.name==='VM-M4',{},{timeout:15000});
 const beforeShot=await page.locator('#belt [data-slot="30"]').getAttribute('title');await page.waitForTimeout(1600);
 await page.evaluate(()=>{const head=window.explorerDev.onlinePlayers()[0].hitboxes.find(b=>b.part===9);window.explorerDev.aimPoint(head.center);window.explorerDev.trigger(50);});
 await poll(()=>shots.length,5000);
 // WeaponDataBlock.PlayHitNotification on the client's own ray hit (no server confirmation exists in the original) + headshotSound.
 await page.waitForFunction(()=>window.explorerDev.feedback().hitsCreated===1&&window.explorerDev.feedback().localHeadshots===1,{},{timeout:5000});
 const fbShot=await page.evaluate(()=>window.explorerDev.feedback());assert.equal(fbShot.hitSounds,1);assert.equal(fbShot.lastHit.follow,true,'not aiming: the marker follows the point');
 await page.waitForFunction(f=>window.explorerDev.audio().loaded.some(u=>u.endsWith(f)),fbShot.lastHeadshot.file,{timeout:5000});await page.waitForFunction(()=>window.explorerDev.audio().loaded.some(u=>/feedback\/sound-/.test(u)),{},{timeout:5000});
 assert.ok((await page.evaluate(()=>window.explorerDev.audioDecoded())).some(a=>/feedback\/sound-/.test(a.file)&&a.seconds>0)&&(await page.evaluate(f=>window.explorerDev.audioDecoded().then(d=>d.some(a=>a.file.endsWith(f)&&a.seconds>0)),fbShot.lastHeadshot.file)),'hit notification and headshot clips decode');
 assert.equal(shots[0].viewId,60);assert.equal(shots[0].hits[0].part,9);assert.deepEqual(shots[0].hits[0].target,{p1:0,viewId:30});assert.ok(shots[0].hits[0].point.every(v=>Math.abs(v)<1),'head impact is bone-local, not world coordinates');
 assert.equal(await page.locator('#belt [data-slot="30"]').getAttribute('title'),beforeShot,'shooting cannot mutate server-owned inventory');
 await page.waitForTimeout(200);await page.evaluate(()=>window.explorerDev.reload(100));await poll(()=>reloads.includes(60),5000);
 assert.equal(await page.locator('#belt [data-slot="30"]').getAttribute('title'),beforeShot,'reload request cannot grant local ammo');
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[30,{name:'M4',uses:24,condition:0.5,maxCondition:0.8,totalModSlots:4,mods:[]}],[3,{name:'556 Ammo',uses:2}]]})]);
 await page.waitForFunction(()=>window.explorerDev.weapon()?.clip===24,{},{timeout:5000});
 // Mod installation is the original item-combine request, with no optimistic consumption or attached meshes.
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');for(let slot=8;slot<12;slot++){const a=await page.locator(`#pack [data-slot="${slot}"]`).boundingBox(),b=await page.locator('#belt [data-slot="30"]').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();} // drag only (RPOSInventoryCell.OnClick is empty)
 await poll(()=>[8,9,10,11].every(slot=>inventoryRequests.some(r=>r.name==='ITSM'&&r.args[0]===slot&&r.args[1]===30&&r.args[2]===false)),5000); // different items: a plain merge already tries TryCombine
 assert.deepEqual(await page.evaluate(()=>window.explorerDev.viewModel().mods),[]);assert.equal(await page.locator('#pack [data-slot="8"] img').getAttribute('alt'),'Holo sight');
 const ownMods=['Holo sight','Silencer','Flashlight Mod','Laser Sight'].map(name=>Object.values(catalogue.items).find(i=>i.data.m_Name===name).data._uniqueID);
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[30,{name:'M4',uses:24,condition:0.5,maxCondition:0.8,totalModSlots:4,mods:ownMods}],...[8,9,10,11].map(slot=>[slot,null])]})]);
 await page.waitForFunction(()=>window.explorerDev.viewModel().mods.length===2,{},{timeout:5000});await page.locator('#inventory-close').click();
 await page.waitForFunction(()=>window.explorerDev.weaponMods()?.lights===1&&window.explorerDev.weaponMods()?.lasers===1,{},{timeout:5000});
 await page.keyboard.press('f');await page.keyboard.press('g');await page.waitForFunction(()=>window.explorerDev.weaponMods().lights===0&&window.explorerDev.weaponMods().lasers===0);await poll(()=>!(moveFlags.at(-1)&(STATE.lamp|STATE.laser)),5000);
 await page.keyboard.press('f');await page.keyboard.press('g');await page.waitForFunction(()=>window.explorerDev.weaponMods().lights===1&&window.explorerDev.weaponMods().lasers===1);await poll(()=>(moveFlags.at(-1)&(STATE.lamp|STATE.laser))===(STATE.lamp|STATE.laser),5000);
 // Native mod installation re-equips the held item; even an identical prefab must recreate/deploy for its new view.
 peer.create({viewId:69,owner:peer.playerId,prefab:'MockHeldItem'});peer.rpc(20,'IAST',['byte','uLink.NetworkViewID'],[30,69]);await page.waitForFunction(()=>window.explorerDev.viewModel()?.clip==='deploy'&&window.explorerDev.viewModel().mods.length===2,{},{timeout:5000});peer.destroyView(60);
 await page.mouse.move(1100,500);await page.mouse.down({button:'right'});await page.waitForTimeout(3300);assert.ok((await page.evaluate(()=>window.explorerDev.viewModel())).zoomTime>0,'online firearm aims');await page.screenshot({path:'analysis/browser-qa/online-gun-aim.png'});await page.mouse.up({button:'right'});
 await page.evaluate(()=>{window.explorerDev.aimAtOnline(1);window.explorerDev.trigger(50);});await poll(()=>shots.some(s=>s.hits.some(h=>h.target?.p1===7&&h.target?.p2===2)),5000);
 assert.equal((await page.evaluate(()=>window.explorerDev.feedback())).hitsCreated,1,'a resource node plays no hit notification');
 await page.waitForTimeout(200);await page.evaluate(()=>{window.explorerDev.aimPoint(window.explorerDev.onlineAnimals()[0].center);window.explorerDev.trigger(50);});await poll(()=>shots.some(s=>s.hits.some(h=>h.target?.viewId===50&&h.part===254)),5000);
 await page.waitForTimeout(300);assert.equal((await page.evaluate(()=>window.explorerDev.feedback())).hitsCreated,1,'the dead wolf (ClientDeath) is no longer alive: no hit notification');
 // A living wolf (ProtectionTakeDamage.playsHitNotification) does play it; animals have no head body parts.
 peer.create({viewId:52,prefab:':wolf_prefab',position:[spawnU[0]+5,spawnU[1],spawnU[2]+3]});peer.rpc(52,'GetNetworkUpdate',['Vector3','Angle2'],[[spawnU[0]+5,spawnU[1],spawnU[2]+3],{pitch:0,yaw:0}]);
 await page.waitForFunction(()=>window.explorerDev.onlineAnimals().some(a=>a.id===52&&a.center),{},{timeout:5000});await page.waitForTimeout(300);
 await page.evaluate(()=>{window.explorerDev.aimPoint(window.explorerDev.onlineAnimals().find(a=>a.id===52).center);window.explorerDev.trigger(50);});await poll(()=>shots.some(s=>s.hits.some(h=>h.target?.viewId===52)),5000);
 await page.waitForFunction(()=>window.explorerDev.feedback().hitsCreated===2,{},{timeout:5000});assert.equal((await page.evaluate(()=>window.explorerDev.feedback())).localHeadshots,1,'animals have no head body parts');
 await page.waitForTimeout(150);await page.screenshot({path:'analysis/browser-qa/feedback/online-hit-marker.png'});peer.destroyView(52);await page.waitForFunction(()=>!window.explorerDev.onlineAnimals().some(a=>a.id===52),{},{timeout:5000});
 // Native melee starts a swing, then reports a WORLD-space hit after midSwingDelay. No local resources/damage.
 peer.create({viewId:61,owner:peer.playerId,prefab:'MockHeldMelee'});peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[30,{name:'Hatchet',uses:1,condition:1}]]})]);peer.rpc(20,'IAST',['byte','uLink.NetworkViewID'],[30,61]);
 await page.waitForFunction(()=>window.explorerDev.viewModel()?.name==='VM-Hatchet',{},{timeout:15000});await page.waitForTimeout(900);
 assert.equal(await page.evaluate(()=>window.explorerDev.approachOnline(1)),true);await page.waitForTimeout(300);await page.evaluate(()=>window.explorerDev.trigger(50));
 await poll(()=>meleeHits.length,5000);assert.deepEqual(meleeHits[0].target,{p1:7,p2:2});assert.equal(meleeHits[0].tree,false);assert.ok(meleeHits[0].point[0]>5000,'melee point is world-space');assert.ok(meleeHits[0].at-meleeSwings[0].at>=150,'hit follows the delayed swing request');
 assert.equal(await page.locator('#pack [data-slot="4"] img').count(),0,'melee cannot grant local resources');assert.equal((await page.evaluate(()=>window.explorerDev.feedback())).hitsCreated,2,'melee on a resource: no hit notification');
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[4,{name:'Metal Ore',uses:3}]]})]);await page.waitForFunction(()=>document.querySelector('#pack [data-slot="4"] span')?.textContent==='x3',{},{timeout:5000});
 await page.waitForTimeout(900);await page.evaluate(()=>window.explorerDev.approachTree());await page.waitForTimeout(300);const treeBefore=meleeHits.length;await page.evaluate(()=>window.explorerDev.trigger(50));await poll(()=>meleeHits.length>treeBefore,5000);
 assert.equal(meleeHits.at(-1).target,null);assert.equal(meleeHits.at(-1).tree,true);assert.equal(await page.locator('#pack [data-slot="1"] span').textContent(),'x11','tree hit cannot grant local wood');await page.screenshot({path:'analysis/browser-qa/online-melee-tree.png'});
 // Bow: cancel a short draw, release a drawn arrow, report target ROOT position, then expire a sky shot.
 peer.create({viewId:62,owner:peer.playerId,prefab:'MockHeldBow'});peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[30,{name:'Hunting Bow',uses:1,condition:1}],[5,{name:'Arrow',uses:3}]]})]);peer.rpc(20,'IAST',['byte','uLink.NetworkViewID'],[30,62]);
 await page.waitForFunction(()=>window.explorerDev.viewModel()?.name==='VM-HuntingBow',{},{timeout:15000});await page.waitForTimeout(1400);await page.evaluate(()=>window.explorerDev.trigger(50));
 await page.waitForFunction(()=>window.explorerDev.viewModel()?.clip==='cancelarrow',{},{timeout:5000});assert.equal(bowFires.length,0,'partial draw sends no shot');await page.waitForTimeout(3100);
 await page.evaluate(p=>{window.explorerDev.teleport([p[0],p[1],-p[2]]);window.explorerDev.aimPoint(window.explorerDev.onlinePlayers()[0].hitboxes.find(b=>b.part===9).center);window.explorerDev.trigger(2600);},spawnU);
 await page.waitForTimeout(2150);await page.screenshot({path:'analysis/browser-qa/online-bow-draw.png'});await poll(()=>bowHits.length,5000);assert.equal(bowFires.length,1);assert.deepEqual(bowHits[0].target,{p1:0,viewId:30});await page.waitForFunction(()=>window.explorerDev.feedback().hitsCreated===3,{},{timeout:5000});assert.equal((await page.evaluate(()=>window.explorerDev.feedback())).lastHit.follow,true);assert.ok(Math.abs(bowHits[0].position[1]-spawnU[1])<0.01,'bow reports target root, not head impact point');
 await page.waitForFunction(()=>window.explorerDev.combat().arrowViews[0]?.attached,{},{timeout:5000});const arrowBefore=await page.evaluate(()=>window.explorerDev.combat().arrowViews[0].position);
 peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+4,spawnU[1],spawnU[2]+1.32],encodeAngles({yaw:0,pitch:0}),STATE.crouch,0.05]);
 await page.waitForFunction(x=>window.explorerDev.combat().arrowViews[0]?.position[0]>x+0.5,arrowBefore[0],{timeout:5000});
 assert.equal(await page.locator('#pack [data-slot="5"] span').textContent(),'x3','bow cannot consume authoritative arrows');peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[5,{name:'Arrow',uses:2}]]})]);await page.waitForFunction(()=>document.querySelector('#pack [data-slot="5"] span')?.textContent==='x2',{},{timeout:5000});
 await page.waitForTimeout(1100);await page.evaluate(()=>{const p=window.explorerState.position;window.explorerDev.aimPoint([p[0]+100,p[1]+200,p[2]+100]);window.explorerDev.trigger(2600);});await poll(()=>bowMisses.length,9000);assert.equal(bowFires.length,2);assert.equal(bowMisses.length,1);assert.equal(bowHits.length,1);assert.ok(bowMisses[0][1]>spawnU[1]+100);assert.equal(await page.locator('#pack [data-slot="5"] span').textContent(),'x2');
 // Throw requests never create a local damaging grenade or consume server inventory.
 const held=async(name,id,vm)=>{peer.create({viewId:id,owner:peer.playerId,prefab:'MockHeldThrowable'});peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[30,{name,uses:2,condition:1}]]})]);peer.rpc(20,'IAST',['byte','uLink.NetworkViewID'],[30,id]);await page.waitForFunction(n=>window.explorerDev.viewModel()?.name===n,vm,{timeout:15000});await page.waitForTimeout(1500);};
 await held('F1 Grenade',63,'VM-F1');const grenadeTitle=await page.locator('#belt [data-slot="30"]').getAttribute('title');await page.evaluate(()=>window.explorerDev.trigger(50));await page.waitForTimeout(500);assert.equal(throws.length,0);await poll(()=>throws.some(t=>t.viewId===63),5000);assert.ok(Math.abs(Math.hypot(...throws[0].forward)-5)<0.001);assert.equal(await page.locator('#belt [data-slot="30"]').getAttribute('title'),grenadeTitle);assert.equal(await page.evaluate(()=>window.explorerDev.combat().grenades),0);
 const grenadePos=[spawnU[0]+4,spawnU[1]+1,spawnU[2]+2];peer.create({viewId:70,prefab:'F1GrenadeWorld',position:grenadePos});peer.rpc(70,'RecieveNetwork',['Vector3','Quaternion'],[[grenadePos[0]+1,grenadePos[1],grenadePos[2]],[0,0,0,1]]);
 await page.waitForFunction(x=>window.explorerDev.onlineRigid().find(a=>a.id===70)?.position?.[0]===x,Math.fround(grenadePos[0]+1),{timeout:5000});await page.evaluate(p=>window.explorerDev.aimPoint([p[0]+1,p[1],-p[2]]),grenadePos);peer.rpc(70,'ClientBounce',[],[]);peer.rpc(70,'RODone',[],[]);peer.destroyView(70);
 await page.waitForFunction(()=>window.explorerDev.onlineEffects().lastServerExplosion?.name==='F1GrenadeWorld'&&window.explorerDev.onlineEffects().particles>0,{},{timeout:5000});assert.equal(await page.evaluate(()=>window.explorerState.vitals.health),72);await page.screenshot({path:'analysis/browser-qa/online-grenade-explosion.png'});
 await held('Supply Signal',64,'VM-F1');await page.evaluate(()=>window.explorerDev.trigger(50));await poll(()=>throws.some(t=>t.viewId===64),5000);peer.create({viewId:71,prefab:'SupplySignalGrenade',position:grenadePos});peer.rpc(71,'RODone',[],[]);peer.destroyView(71);await page.waitForFunction(()=>window.explorerDev.onlineEffects().lastServerExplosion?.name==='SupplySignalGrenade',{},{timeout:5000});
 await held('Flare',65,'VM-Flare');const flareTitle=await page.locator('#belt [data-slot="30"]').getAttribute('title');await page.mouse.move(1100,500);await page.mouse.down({button:'right'});await page.waitForTimeout(50);await page.mouse.up({button:'right'});await poll(()=>ignites.includes(65),5000);await page.waitForFunction(()=>window.explorerDev.torch().worldLight>0,{},{timeout:5000});await poll(()=>throws.some(t=>t.viewId===65),5000);assert.equal(await page.locator('#belt [data-slot="30"]').getAttribute('title'),flareTitle);
 peer.create({viewId:72,prefab:'WorldFlare_New',position:grenadePos});await page.waitForFunction(()=>window.explorerDev.onlineRigid().find(a=>a.id===72)?.particles>0&&window.explorerDev.onlineRigid().find(a=>a.id===72)?.light>0,{},{timeout:5000});await page.screenshot({path:'analysis/browser-qa/online-flare.png'});peer.rpc(72,'RODone',[],[]);peer.destroyView(72);await page.waitForFunction(()=>window.explorerDev.onlineRigid().length===0,{},{timeout:5000});
 await held('Torch',66,'VM-Torch');await poll(()=>ignites.includes(66),5000);await page.waitForTimeout(300);assert.equal(ignites.filter(id=>id===66).length,1);assert.equal(await page.evaluate(()=>window.explorerState.vitals.health),72);assert.equal(await page.evaluate(()=>window.explorerState.vitals.calories),987);
 // Placement previews use native masters, while requests leave world and inventory unchanged.
 peer.create({viewId:67,owner:peer.playerId,prefab:'MockStructureItem'});peer.create({viewId:68,owner:peer.playerId,prefab:'MockDeployableItem'});
 const equipPlace=async(name,id)=>{peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[30,{name,uses:2,condition:1}]]})]);peer.rpc(20,'IAST',['byte','uLink.NetworkViewID'],[30,id]);await page.waitForFunction(n=>document.querySelector('#belt [data-slot="30"]')?.title.includes(n),name,{timeout:5000});await page.waitForTimeout(100);};
 await equipPlace('Wood Foundation',67);const beforeBuild=await page.evaluate(()=>({entities:window.explorerState.online.entities,title:document.querySelector('#belt [data-slot="30"]').title}));
 // The spawn is inside an original no-placement zone (124.8 m radius); walk east until outside it.
 let buildPreview;for(let i=0;i<16;i++){buildPreview=await page.evaluate(async()=>{const d=window.explorerDev;d.walkAway(12);await new Promise(r=>setTimeout(r,300));const e=d.aim().eye;d.aimPoint([e[0],e[1]-2.2,e[2]-5]);d.placeAim('Wood Foundation');return d.placement();});if(buildPreview?.valid)break;}
 assert.ok(buildPreview?.valid,JSON.stringify(buildPreview));await poll(()=>placements.length,5000);const foundationRequest=placements.at(-1);assert.equal(foundationRequest.args[4],0,'new foundation has no native master yet');assert.equal(await page.evaluate(()=>window.explorerState.online.entities),beforeBuild.entities);assert.equal(await page.locator('#belt [data-slot="30"]').getAttribute('title'),beforeBuild.title);
 const buildPos=foundationRequest.args[2],buildRot=foundationRequest.args[3];peer.create({viewId:80,prefab:'StructureMasterPrefab',position:buildPos,rotation:buildRot});peer.ngcCreate(40,{prefabIndex:foundation.index,innerID:8,position:buildPos,euler:[0,0,0]});call(foundation,8,'SMSet',['uLink.NetworkViewID'],[80]);
 await page.waitForFunction(()=>window.explorerDev.onlineBuildings().parts.find(p=>p.key==='40:8')?.bound,{},{timeout:5000});
 await equipPlace('Wood Pillar',67);await page.evaluate(p=>{const d=window.explorerDev;d.teleport([p[0],p[1]+4.05,-p[2]]);},buildPos);await page.waitForTimeout(500);
 await page.evaluate(p=>window.explorerDev.aimPoint([p[0]+2.5,p[1]+4,-p[2]+2.5]),buildPos);await page.waitForTimeout(150);const pillarPreview=await page.evaluate(()=>window.explorerDev.placement());assert.ok(pillarPreview?.valid,JSON.stringify(pillarPreview));assert.equal(pillarPreview.master,80);await page.evaluate(()=>window.explorerDev.placeAim('Wood Pillar'));await poll(()=>placements.some(p=>p.args[4]===80),5000);assert.equal(await page.evaluate(()=>window.explorerDev.onlineBuildings().parts.length),2,'request did not construct a pillar locally');await page.screenshot({path:'analysis/browser-qa/online-building-preview.png'});
 await equipPlace('Wood Storage Box',68);let deployPreview;for(let i=0;i<8;i++){deployPreview=await page.evaluate(async()=>{const d=window.explorerDev;d.walkAway(6);await new Promise(r=>setTimeout(r,300));const e=d.aim().eye;d.aimPoint([e[0],e[1]-2.2,e[2]-2.5]);d.placeAim('Wood Storage Box');return d.placement();});if(deployPreview?.valid)break;}
 assert.ok(deployPreview?.valid,JSON.stringify(deployPreview));await poll(()=>placements.some(p=>p.viewId===68),5000);assert.equal(await page.evaluate(()=>window.explorerDev.onlineBuildings().parts.length),2);// StructureComponent.ClientHealthUpdate -> HealthDimmer (structure grey 0.35 + (avg - 0.35) * health/max).
 call(foundation,8,'ClientHealthUpdate',['float'],[1250]);await page.waitForFunction(()=>window.explorerDev.onlineProps().find(o=>o.key==='40:8')?.health===1250,{},{timeout:5000});
 {const f=(await page.evaluate(()=>window.explorerDev.onlineProps())).find(o=>o.key==='40:8');assert.ok(Math.abs(f.dimmer-(0.35+(f.dimmerAverage-0.35)*0.5))<1e-6,'structure HealthDimmer '+JSON.stringify(f));}
 // ClientKilled plays the piece's deathEffect (wood_wall_debris); only the NetCull destroy that follows removes it.
 call(foundation,8,'ClientKilled',[],[]);await page.waitForFunction(()=>window.explorerDev.onlineEffects().lastServerExplosion?.name==='WoodFoundation'&&window.explorerDev.onlineEffects().particles>0,{},{timeout:5000});
 assert.ok((await page.evaluate(()=>window.explorerDev.onlineProps())).some(o=>o.key==='40:8'&&o.killed),'ClientKilled alone does not remove the piece');
 await mkdir('analysis/browser-qa/raid',{recursive:true});await page.screenshot({path:'analysis/browser-qa/raid/online-structure-killed.png'});
 peer.rpc(40,'D',['ushort'],[8]);await page.waitForFunction(()=>!window.explorerDev.onlineProps().some(o=>o.key==='40:8')&&!window.explorerDev.onlineBuildings().parts.some(p=>p.key==='40:8'),{},{timeout:5000});peer.destroyView(80);
 await page.waitForFunction(()=>window.explorerDev.audio().state==='running',{},{timeout:5000});const decodedAudio=await page.evaluate(()=>window.explorerDev.audioDecoded());
 const deployManifest=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url))),hatchet=Object.values(deployManifest.weapons).find(w=>w.item==='Hatchet');for(const file of Object.values(hatchet.sounds))assert.ok(decodedAudio.some(a=>a.file.endsWith(file)&&a.seconds>0&&a.channels>0),'original melee sound decodes: '+file);
 await page.setViewportSize({width:1280,height:720});await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');
 await page.locator('#equipment [data-slot="39"]').scrollIntoViewIfNeeded();assert.equal(await page.locator('#equipment [data-slot="39"]').isVisible(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#inventory').scrollWidth<=document.querySelector('#inventory').clientWidth),'online inventory fits desktop screens');
 await page.screenshot({path:'analysis/browser-qa/online-inventory-desktop.png'});await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:720});
 const nativeVitals=await page.evaluate(()=>window.explorerDev.onlineVitals());assert.equal(nativeVitals.metabolism.waterLevelLitre,12);assert.equal(nativeVitals.metabolism.radiationLevel,75);
 await page.waitForTimeout(2200);assert.equal(await page.evaluate(()=>window.explorerState.vitals.health),72);assert.equal(await page.evaluate(()=>window.explorerState.vitals.calories),987,'local metabolism must not alter server snapshots');
 const bobBeforeImpact=await page.evaluate(()=>window.explorerDev.headBob().effectStarts);peer.rpc(30,'fIc',['float'],[-20]);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.explorerDev.headBob().effectStarts),bobBeforeImpact,'another character cannot punch our camera');
 peer.rpc(20,'fIc',['float'],[-20]);await page.waitForFunction(n=>window.explorerDev.headBob().effectStarts===n+1,bobBeforeImpact);assert.equal(await page.evaluate(()=>window.explorerState.vitals.health),72,'camera impact does not change health');
 // Original audio (world-audio.mjs): fIc plays FallDamage.legBreakSound for any character; remote footsteps follow the
 // interpolated position + state flags; the wolf's FootstepEmitter stepped while it walked; clips decode in Edge.
 {const before=await page.evaluate(()=>window.explorerDev.worldAudio());assert.ok(before.fallImpacts>=2,'fIc legBreakSound for remote and local: '+before.fallImpacts);assert.ok(before.animalFootsteps>0,'wolf footsteps');
  // Along +Z at x+3, off the foundation (x+6, 45°): its ground ray (feet + 0.25 m, 1 m down) finds the terrain there. The
  // old x+4..+7 line crossed the foundation's footprint and only reached the terrain while the remote stood inside it.
  for(let i=1;i<=30;i++){const z=spawnU[2]+1.32+(i<=15?i:30-i)*0.2;peer.rpc(30,'ReadClientMove',['Vector3','int','ushort','float'],[[spawnU[0]+3,spawnU[1],z],encodeAngles({yaw:0,pitch:0}),STATE.movement,0.05]);await page.waitForTimeout(50);}
  await page.waitForFunction(n=>window.explorerDev.worldAudio().remoteFootsteps>n,before.remoteFootsteps,{timeout:5000});
  const heard=await page.evaluate(()=>window.explorerDev.worldAudio());assert.ok(/^(gravel|grass)/.test(heard.last.remote.clip),JSON.stringify(heard.last.remote));
  await page.waitForTimeout(500);const decoded=await page.evaluate(()=>window.explorerDev.audioDecoded());assert.ok(decoded.filter(a=>a.file.includes('/audio/')&&a.seconds>0&&a.channels>0).length>=3,'original footstep/bone_break clips decode');}
 // ---- Online gap fixes (GAP-AUDIT P1-1/P1-6/P1-7/P1-9): exact requests and client reactions. ----
 const gaps={};const fims=[],prevGaps=peer.onUlink;peer.onUlink=(h,b)=>{prevGaps(h,b);if(h.rpc==='fIm')fims.push({viewId:h.viewId,velocity:readArgs(['Vector3'],b)[0]});};
 const gapState=()=>page.evaluate(()=>window.explorerDev.onlineState());
 // FallDamage: a 40 m drop sends only fIm(lastFrameVelocity) on our character; health stays the server's; fIo drives the injury.
 await page.evaluate(()=>{const f=window.explorerState.player.feet;window.explorerDev.teleport([f[0],f[1]+40,f[2]]);});
 await poll(()=>fims.length,20000);assert.equal(fims.length,1);assert.equal(fims[0].viewId,20);assert.ok(fims[0].velocity[1]<=-18,JSON.stringify(fims[0]));
 await page.waitForTimeout(400);assert.equal(fims.length,1,'one report per landing');assert.equal(await page.evaluate(()=>window.explorerState.vitals.health),72,'no local fall damage online');
 peer.rpc(20,'fIo',['float'],[1]);
 await page.waitForFunction(()=>{const s=window.explorerDev.onlineState();return s.legInjury===1&&s.injuredPlaque&&window.explorerState.player.crouched;},{},{timeout:5000});
 await poll(()=>moveFlags.at(-1)&STATE.crouch,5000);gaps.fall={report:fims[0],injury:await gapState()};
 peer.rpc(30,'fIo',['float'],[0]);await page.waitForTimeout(150);assert.equal((await gapState()).legInjury,1,'another character fIo does not heal us');
 peer.rpc(20,'fIo',['float'],[0]);await page.waitForFunction(()=>{const s=window.explorerDev.onlineState();return s.legInjury===0&&!s.injuredPlaque;},{},{timeout:5000});
 // EnvironmentControlCenter.CL_UpdateSkyState on view 996 drives the TOD clock; a sub-minute difference does not snap.
 const skyBytes=(hour,day=30,night=10)=>{const w=new BitWriter().f32(day).f32(night).f32(0.4);[0.1,0.2,0.3,0.4].forEach(v=>w.f32(v));w.i32(2014).u8(6).u8(15).f32(hour);return w.toBytes();};
 peer.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[skyBytes(21.5)]);
 await page.waitForFunction(()=>{const s=window.explorerDev.onlineSky();return s&&s.snapped&&Math.abs(s.hour-21.5)<0.05&&s.daylength===30&&s.nightlength===10&&s.date.join()==='2014,6,15'&&Math.abs(s.moonPhase-0.4)<0.01;},{},{timeout:5000});
 assert.equal(await page.evaluate(()=>window.explorerDev.tod().night),true);await page.screenshot({path:'analysis/browser-qa/online-sky-night.png'});
 const hourNow=(await page.evaluate(()=>window.explorerDev.onlineSky())).hour;peer.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[skyBytes(hourNow+0.005)]);
 await page.waitForFunction(h=>window.explorerDev.onlineSky().snapped===false&&Math.abs(window.explorerDev.onlineSky().hour-h)<0.01,hourNow,{timeout:5000});
 peer.rpc(996,'CL_UpdateSkyState',['uLink.BitStream'],[skyBytes(12,45,15)]);await page.waitForFunction(()=>Math.abs(window.explorerDev.onlineSky().hour-12)<0.05&&!window.explorerDev.tod().night,{},{timeout:5000});
 gaps.sky=await page.evaluate(()=>window.explorerDev.onlineSky());
 // ServerManagement.UnstickMove teleports our character.
 const unstickU=[spawnU[0]+2,spawnU[1]+0.5,spawnU[2]+2];peer.rpc(1,'UnstickMove',['Vector3'],[unstickU]);
 await page.waitForFunction(p=>{const f=window.explorerState.player.feet;return Math.hypot(f[0]-p[0],f[2]+p[2])<0.5;},unstickU,{timeout:5000});
 // HandCannon (StrikeGunDataBlock): a short press strikes then cancels without a shot; holding fires 12 pellets after the strikes.
 peer.create({viewId:73,owner:peer.playerId,prefab:'MockHeldItem'});peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[30,{name:'HandCannon',uses:1,condition:1}]]})]);peer.rpc(20,'IAST',['byte','uLink.NetworkViewID'],[30,73]);
 await page.waitForFunction(()=>window.explorerDev.viewModel()?.name==='VM-HandCannon',{},{timeout:15000});await page.waitForTimeout(1000);
 const hcTitle=await page.locator('#belt [data-slot="30"]').getAttribute('title'),shotsBeforeHC=shots.length;
 await page.evaluate(()=>window.explorerDev.trigger(60));await page.waitForFunction(()=>window.explorerDev.onlineState().lastStrike?.cancelled,{},{timeout:5000});
 await page.waitForTimeout(300);assert.equal(shots.length,shotsBeforeHC,'released strike sends no shot');
 await page.waitForTimeout(1100);await page.evaluate(()=>{const p=window.explorerState.position;window.explorerDev.aimPoint([p[0]+30,p[1]-2,p[2]+30]);window.explorerDev.trigger(2700);});
 await page.waitForFunction(()=>window.explorerDev.onlineState().lastStrike?.strikes>0,{},{timeout:5000});const strike=(await gapState()).lastStrike;
 await poll(()=>shots.length>shotsBeforeHC,6000);const hcShot=shots.at(-1);assert.equal(hcShot.viewId,73);assert.equal(hcShot.hits.length,12,'one hit record per pellet');
 assert.equal(await page.locator('#belt [data-slot="30"]').getAttribute('title'),hcTitle,'HandCannon cannot spend server ammo locally');
 const hcAssets=Object.values(deployManifest.weapons).find(w=>w.item==='HandCannon');await page.waitForFunction(f=>window.explorerDev.audio().loaded.some(u=>u.endsWith(f)),hcAssets.strikeSounds[strike.strikes-1],{timeout:5000});
 gaps.handCannon={strike,pellets:hcShot.hits.length};
 // Remote HandCannon shots draw 12 tracers like the original shotgun stream.
 {const h=Object.values(heldManifest.held).find(h=>h.item==='HandCannon'),data=new Uint8Array(6),d=new DataView(data.buffer);d.setUint16(0,30,true);d.setInt32(2,h.uid,true);peer.create({viewId:96,owner:peer.playerId+50,prefab:h.netName,initialData:data});
  await page.waitForFunction(()=>window.explorerDev.onlinePlayers()[0]?.held?.item==='HandCannon'&&window.explorerDev.onlinePlayers()[0]?.held?.parts>0,{},{timeout:5000});
  const before=(await page.evaluate(()=>window.explorerDev.remoteCombat())).count,pellets=new BitWriter();for(let i=0;i<12;i++){pellets.u8(255);[spawnU[0]+60+i,spawnU[1]+30,spawnU[2]+60].forEach(n=>pellets.f32(n));}
  peer.rpc(96,'Action1B',['byte[]'],[pellets.toBytes()]);await page.waitForFunction(n=>window.explorerDev.remoteCombat().count===n+1,before,{timeout:5000});
  const last=(await page.evaluate(()=>window.explorerDev.remoteCombat())).last;assert.equal(last.type,'gun');assert.equal(last.ends.length,12);gaps.remoteHandCannon={tracers:last.ends.length,sound:last.sound};peer.destroyView(96);}
 // Inventory.CLEV plays the item's event clip; SleepingAvatar.SACH plays the sleeper's AudioSource.
 const helmetUID=Object.values(catalogue.items).find(i=>i.data.m_Name==='Cloth Helmet').data._uniqueID;peer.rpc(20,'CLEV',['byte','int'],[1,helmetUID]);
 await page.waitForFunction(()=>window.explorerDev.onlineState().lastItemEvent?.file,{},{timeout:5000});gaps.itemEvent=(await gapState()).lastItemEvent;assert.equal(gaps.itemEvent.item,'Cloth Helmet');
 await page.waitForFunction(f=>window.explorerDev.audio().loaded.some(u=>u.endsWith(f)),gaps.itemEvent.file,{timeout:5000});
 // ClientVitalsSync.Local_HealthChange(amount, attacker): HUDDirectionalDamage towards the attacker's eyes, LocalDamageDisplay
 // bob/impact flash, and the GameFullscreen damage overlay below 40 % health. The indicator angle must match the attacker bearing.
 {const fb=()=>page.evaluate(()=>window.explorerDev.feedback()),before=await fb();
  peer.rpc(20,'Local_HealthChange',['float','uLink.NetworkViewID'],[55,30]);await page.waitForFunction(n=>window.explorerDev.feedback().arcsCreated===n+1&&window.explorerDev.feedback().arcs.at(-1)?.age>0,before.arcsCreated,{timeout:5000});/* a frame has set the arc's angle */
  const hit=await fb(),arc=hit.arcs.at(-1),remote=await page.evaluate(()=>window.explorerDev.onlinePlayers()[0]),me=await page.evaluate(()=>window.explorerState);
  const cam=new PerspectiveCamera();cam.quaternion.fromArray(hit.camera);cam.updateMatrixWorld(); // the camera of the frame that set the angle
 const expected=directionalAngle(arc.direction,cam.matrixWorldInverse);
  assert.ok(Math.abs(arc.angle-expected)<2,JSON.stringify({arc,expected}));assert.equal(hit.lastHealth.attacker,'other');assert.equal(hit.lastHealth.bob,'takeDamageBob');
  const toRemote=[remote.position[0]-me.position[0],remote.position[2]-me.position[2]],dir=[arc.direction[0],arc.direction[2]];
  assert.ok(Math.abs(Math.atan2(toRemote[1],toRemote[0])-Math.atan2(dir[1],dir[0]))<0.15,'indicator points at the attacker: '+JSON.stringify({toRemote,dir}));
  await page.waitForTimeout(150);await page.screenshot({path:'analysis/browser-qa/feedback/online-directional.png'});
  peer.rpc(20,'Local_HealthChange',['float','uLink.NetworkViewID'],[48,20]);await page.waitForFunction(n=>window.explorerDev.feedback().arcsCreated===n+2,before.arcsCreated,{timeout:5000});
  const self=await fb();assert.ok(Math.abs(self.arcs.at(-1).angle)<1e-6,'own view (HurtSelf): zero direction keeps the arc at the right');assert.equal(self.lastHealth.attacker,'self');
  peer.rpc(20,'Local_HealthChange',['float','uLink.NetworkViewID'],[25,0]);await page.waitForFunction(()=>window.explorerDev.feedback().clientHealth===25,{},{timeout:5000});
  await page.waitForFunction(()=>window.explorerDev.feedback().overlay.damage>0.2,{},{timeout:5000});const low=await fb();
  assert.equal(low.arcsCreated,before.arcsCreated+2,'an unassigned attacker draws no indicator');assert.ok(low.overlay.flags&1);assert.ok(Math.abs(low.overlay.damage-(0.75-0.6)*2.5*low.overlay.pulse)<1e-6,JSON.stringify(low.overlay));
  await page.screenshot({path:'analysis/browser-qa/feedback/online-overlay-low.png'});
  peer.rpc(20,'Local_HealthChange',['float','uLink.NetworkViewID'],[72,0]);await page.waitForFunction(()=>window.explorerDev.feedback().clientHealth===72&&window.explorerDev.feedback().overlay.flags===0,{},{timeout:5000});
  assert.ok((await fb()).overlayFrames>low.overlayFrames-1);gaps.feedback={indicator:{angle:arc.angle,expected},self:self.arcs.at(-1).angle,overlay:low.overlay};}
 call(sleeper,7,'SACH',['NetEntityID'],[{p1:0,viewId:20}]);await page.waitForFunction(()=>window.explorerDev.onlineState().sleeperSounds===1,{},{timeout:5000});
 // EquipmentWearer.ArmorData replaces the local armour totals until the equipment changes in a GNUP.
 const armorW=new BitWriter();[0,40,25,10,30,15].forEach(v=>armorW.f32(v));peer.rpc(20,'ArmorData',['byte[]'],[armorW.toBytes()]);
 await page.waitForFunction(()=>window.explorerDev.onlineState().armorOverride?.[1]===40&&window.explorerDev.onlineState().armor[4]===30,{},{timeout:5000});
 peer.rpc(20,'GNUP',['byte[]'],[inventoryFixture(catalogue,{full:false,updates:[[36,{name:'Cloth Helmet',uses:1,condition:1}]]})]);
 await page.waitForFunction(()=>window.explorerDev.onlineState().armorOverride===null&&window.explorerDev.onlineState().armor[1]!==40,{},{timeout:5000});gaps.armorData=true;
 // RepairBench: the Repair button (shown for a damaged repairable item) sends RepairBench.DoRepair as an NGC call; no local change.
 const bench=registry.prefabs.find(p=>p.handle===';deploy_repairbench');peer.ngcCreate(40,{prefabIndex:bench.index,innerID:10,position:[spawnU[0]+1,spawnU[1],spawnU[2]-3],euler:[0,0,0]});
 await page.waitForFunction(()=>window.explorerDev.onlineProps().some(o=>o.key==='40:10'),{},{timeout:10000});
 call(bench,10,'SetLooter',['uLink.NetworkPlayer'],[peer.playerId]);call(bench,10,'GNUP',['byte[]'],[inventoryFixture(catalogue,{capacity:1,slots:[{name:'Hatchet',uses:1,condition:0.4,maxCondition:1}]})]);
 await page.waitForSelector('#inventory[open] #loot [data-loot="0"] img');assert.equal((await page.locator('#loot-action').textContent()).trim(),'Repair');
 await page.locator('#loot-action').click();await poll(()=>inventoryRequests.some(r=>r.name==='DoRepair'&&r.innerID===10&&r.args.length===0),5000);
 await page.screenshot({path:'analysis/browser-qa/online-repair.png'});call(bench,10,'ClearLooter',[],[]);
 // ClearLooter → RPOS.CloseLootWindow → LootClosed: only the loot window goes; close RPOS for the next steps.
 await page.waitForFunction(()=>!document.querySelector('#loot [data-loot]'),{},{timeout:5000});await page.locator('#inventory-close').click();await page.waitForSelector('#inventory:not([open])',{state:'attached'});peer.rpc(40,'D',['ushort'],[10]);
 // TimedExplosive: online charges tick each second, ClientExplode shows the explosion at the charge and stops the ticks.
 const charge=registry.prefabs.find(p=>p.handle===';explosive_charge');peer.ngcCreate(40,{prefabIndex:charge.index,innerID:11,position:[spawnU[0]+3,spawnU[1]+0.5,spawnU[2]-1],euler:[0,0,0]});
 await page.waitForFunction(()=>window.explorerDev.onlineState().charges.find(c=>c.key==='40:11')?.ticks>=2,{},{timeout:10000});
 call(charge,11,'ClientExplode',[],[]);await page.waitForFunction(n=>window.explorerDev.onlineEffects().lastServerExplosion?.name===n&&window.explorerDev.onlineEffects().particles>0,deployManifest.prefabs[';explosive_charge'].name,{timeout:5000});
 const ticksAt=(await gapState()).charges.find(c=>c.key==='40:11').ticks;await page.waitForTimeout(1300);assert.equal((await gapState()).charges.find(c=>c.key==='40:11').ticks,ticksAt,'ClientExplode cancels the tick sound');
 await page.screenshot({path:'analysis/browser-qa/online-c4-explosion.png'});gaps.c4=(await page.evaluate(()=>window.explorerDev.onlineEffects())).lastServerExplosion;peer.rpc(40,'D',['ushort'],[11]);
 // DeployableObject.Client_OnKilled: the clientDeathEffect (wood door debris) plays at the entity.
 peer.ngcCreate(40,{prefabIndex:door.index,innerID:12,position:[spawnU[0]-1,spawnU[1],spawnU[2]+4],euler:[0,90,0]});await page.waitForFunction(()=>window.explorerDev.onlineProps().some(o=>o.key==='40:12'),{},{timeout:10000});
 call(door,12,'Client_OnKilled',[],[]);await page.waitForFunction(()=>window.explorerDev.onlineEffects().lastServerExplosion?.deathEffect&&window.explorerDev.onlineEffects().particles>0,{},{timeout:5000});
 gaps.deathEffect=(await page.evaluate(()=>window.explorerDev.onlineEffects())).lastServerExplosion;
 // DeployableObject.ClientHealthUpdate -> HealthDimmer (deployable grey avg*0.33 + (avg - avg*0.33) * health/max).
 call(door,12,'ClientHealthUpdate',['float'],[250]);await page.waitForFunction(()=>window.explorerDev.onlineProps().find(o=>o.key==='40:12')?.health===250,{},{timeout:5000});
 {const o=(await page.evaluate(()=>window.explorerDev.onlineProps())).find(o=>o.key==='40:12'),low=o.dimmerAverage*0.33;assert.ok(Math.abs(o.dimmer-(low+(o.dimmerAverage-low)*0.5))<1e-6,'deployable HealthDimmer '+JSON.stringify(o));gaps.doorDimmer=o.dimmer;}
 peer.rpc(40,'D',['ushort'],[12]);
 // DeployableObject.OnKilled's corpseObject: a uLink view named after the prefab (NetCull.InstantiateStatic(GameObject)),
 // drawn with its collider until the server's 300 s NetDestroy.
 {const at=[spawnU[0]-1,spawnU[1],spawnU[2]+4];peer.create({viewId:79,prefab:'WoodDoor_Corpse',position:at,rotation:[0,0.7071068,0,0.7071068]});
  await page.waitForFunction(()=>window.explorerDev.raid().corpses.some(c=>c.online===79&&c.body&&c.name==='WoodDoor_Corpse'),{},{timeout:5000});
  await page.evaluate(p=>window.explorerDev.aimPoint([p[0],p[1]+0.3,-p[2]]),at);await page.waitForTimeout(300);await page.screenshot({path:'analysis/browser-qa/raid/online-door-corpse.png'});
  gaps.corpse=(await page.evaluate(()=>window.explorerDev.raid().corpses)).find(c=>c.online===79);peer.destroyView(79);
  await page.waitForFunction(()=>!window.explorerDev.raid().corpses.some(c=>c.online===79),{},{timeout:5000});}
 // Airdrops: the server's classic C130/SupplyCrate views (NetCull.InstantiateClassic), GetNetworkUpdate(Vector3, Quaternion)
 // every send interval, SupplyCrate.Landed, looting through Context + LootableObject/Inventory on the crate view, destroy.
 {await mkdir('analysis/browser-qa/airdrop',{recursive:true});const air=(f,...a)=>page.evaluate(f,...a),state=()=>air(()=>window.explorerDev.airdrops()),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const airCtx=[],takes=[],prevAir=peer.onUlink;peer.onUlink=(h,b)=>{if(h.rpc==='Context:A')airCtx.push(readArgs(['NetEntityID'],b)[0]);else if(h.rpc==='ITMV'&&h.viewId===73)takes.push(readArgs(['NetEntityID','byte','byte'],b));else prevAir(h,b);};
  const shapesBefore=await air(()=>window.explorerState.collisionShapes),west=[0,-Math.SQRT1_2,0,Math.SQRT1_2]; // LookRotation(-X)
  const p0=[spawnU[0]+260,spawnU[1]+120,spawnU[2]-30];peer.create({viewId:72,prefab:'C130',position:p0,rotation:west});
  await page.waitForFunction(()=>window.explorerDev.airdrops().render?.views.some(v=>v.id===72),{},{timeout:10000});
  for(let i=1;i<=6;i++){peer.rpc(72,'GetNetworkUpdate',['Vector3','Quaternion'],[[p0[0]-50*i,p0[1],p0[2]],west]);await sleep(200);}
  const plane=(await state()).actors.find(a=>a.id===72);assert.ok(plane.position[0]<p0[0]-150&&plane.position[0]>=p0[0]-300-1e-3,'interpolated plane follows the snapshots: '+plane.position);assert.ok(plane.propAngle>0,'propellers turn'); // 12 rad/s of frame time (frame dt is clamped under load)
  await air(p=>window.explorerDev.aimPoint([p[0],p[1],-p[2]]),plane.position);await sleep(250);await page.screenshot({path:'analysis/browser-qa/airdrop/online-plane.png'});
  const c0=[spawnU[0]+5,spawnU[1]+40,spawnU[2]+5];peer.create({viewId:73,prefab:'SupplyCrate',position:c0,rotation:[0,0.3826834,0,0.9238795]});
  await page.waitForFunction(()=>window.explorerDev.airdrops().render?.views.some(v=>v.id===73&&v.body&&v.chuteVisible),{},{timeout:10000});
  for(let i=1;i<=10;i++){peer.rpc(73,'GetNetworkUpdate',['Vector3','Quaternion'],[[c0[0],c0[1]-i,c0[2]],[0,0.3826834,0,0.9238795]]);await sleep(200);}
  const falling=(await state()).actors.find(a=>a.id===73);assert.ok(falling.position[1]<c0[1]-5&&falling.position[1]>c0[1]-10.5,'interpolated descent '+falling.position[1]);assert.equal(falling.chuteScale,1,'parachute fully grown');assert.equal(falling.landed,false);
  await air(c=>window.explorerDev.flyTo([c[0]+9,c[1]-2,-c[2]+9],[c[0],c[1]+3,-c[2]]),falling.position);await sleep(250);await page.screenshot({path:'analysis/browser-qa/airdrop/online-descent.png'});
  const ground=[c0[0],await air(c=>window.explorerDev.airdropGround(c[0],-c[2]),c0),c0[2]];peer.rpc(73,'GetNetworkUpdate',['Vector3','Quaternion'],[ground,[0,0.3826834,0,0.9238795]]);peer.rpc(73,'Landed',[],[]);
  await page.waitForFunction(()=>{const s=window.explorerDev.airdrops(),a=s.actors.find(a=>a.id===73);return a?.landed&&s.render.particles>0&&s.render.views.find(v=>v.id===73)?.chuteVisible===false;},{},{timeout:5000});
  const landedAir=await state();assert.ok(Math.abs(landedAir.actors.find(a=>a.id===73).position[1]-ground[1])<0.01,'LAND fires at the interpolated landing pose');
  await air(c=>window.explorerDev.flyTo([c[0]+5,c[1]+2.5,-c[2]+6],[c[0],c[1]+1,-c[2]]),ground);await sleep(250);await page.screenshot({path:'analysis/browser-qa/airdrop/online-landed.png'});
  // Context:A(crate view) on E; the server's SetLooter + GNUP open the original loot window; items are dragged out (ITMV).
  const near=await air(()=>window.explorerDev.approachAirdrop(73));assert.ok(near?.aimed,JSON.stringify(near));await page.waitForFunction(()=>document.querySelector('#use-hint')?.textContent==='Search',{},{timeout:5000});
  await air(()=>{const key=t=>document.body.dispatchEvent(new KeyboardEvent(t,{code:'KeyE',bubbles:true}));key('keydown');key('keyup');});
  await poll(()=>airCtx.length>0,10000);assert.deepEqual(airCtx[0],{p1:0,viewId:73});
  peer.rpc(73,'SetLooter',['uLink.NetworkPlayer'],[peer.playerId]);peer.rpc(73,'GNUP',['byte[]'],[inventoryFixture(catalogue,{capacity:12,slots:[{name:'556 Ammo',uses:250},{name:'F1 Grenade',uses:5},{name:'Kevlar Helmet',uses:1,condition:1}]})]);
  await page.waitForSelector('#inventory[open] #loot [data-loot="2"] img');assert.equal(await page.locator('#loot .item-slot > img').count(),3);
  await page.screenshot({path:'analysis/browser-qa/airdrop/online-loot.png'});
  assert.equal(await page.locator('#loot-action').isHidden(),true,'no Take all on the supply crate');
  {const bag=await page.evaluate(()=>[...document.querySelectorAll('#pack [data-slot]')].find(b=>!b.querySelector(':scope > img'))?.dataset.slot);assert.ok(bag!=null,'a free bag cell');
   await dragSlot('#loot [data-loot="0"]',`#pack [data-slot="${bag}"]`);await poll(()=>takes.some(([target,from,to])=>target.viewId===20&&from===0&&to===Number(bag)),5000);}
  peer.rpc(73,'ClearLooter',[],[]);await page.waitForFunction(()=>!document.querySelector('#loot [data-loot]'),{},{timeout:5000});
  await page.locator('#inventory-close').click();await page.waitForSelector('#inventory:not([open])',{state:'attached'});
  peer.destroyView(73);peer.destroyView(72);await page.waitForFunction(()=>window.explorerDev.airdrops().actors.length===0&&window.explorerDev.airdrops().render.views.length===0,{},{timeout:5000});
  assert.equal(await air(()=>window.explorerState.collisionShapes),shapesBefore,'crate collision removed with its view');
  peer.onUlink=prevAir;gaps.airdrops={plane:{position:plane.position,propAngle:plane.propAngle},descent:falling.position[1],landed:true,context:airCtx[0],takeByDrag:true,render:landedAir.render.views.length};
  await air(p=>window.explorerDev.teleport([p[0],p[1],-p[2]]),spawnU);await sleep(300);}
 assert.deepEqual(errors,[]);
 peer.rpc(20,'Local_HealthChange',['float','uLink.NetworkViewID'],[0,30]);peer.rpc(20,'Client_OnKilledBy',['uLink.NetworkViewID'],[30]);
 await page.waitForSelector('#death:not([hidden])');assert.equal(await page.evaluate(()=>window.explorerState.vitals.deaths),1);
 await page.screenshot({path:'analysis/browser-qa/online-death.png'});await page.locator('#respawn').click();await poll(()=>inventoryRequests.some(r=>r.name==='RequestRespawn'&&r.args[0]===false),5000);
 assert.equal(await page.evaluate(()=>window.explorerState.vitals.health),0,'respawn click alone cannot resurrect the character');
 peer.destroyView(20);peer.destroyView(60);peer.destroyView(61);peer.destroyView(62);for(const id of [63,64,65,66,67,68])peer.destroyView(id);const respawnU=[spawnU[0]+20,spawnU[1],spawnU[2]-15];peer.create({viewId:21,owner:peer.playerId,prefab:':player_soldier',position:respawnU});
 peer.rpc(21,'Local_HealthChange',['float','uLink.NetworkViewID'],[64,0]);peer.rpc(21,'RecieveNetwork',['float','float','float','float','float','float'],[800,20,0,0,0,0]);
 peer.rpc(21,'GNUP',['byte[]'],[inventoryFixture(catalogue,{slots:Array.from({length:40},(_,i)=>i===30?{name:'Rock',uses:1}:null)})]);
 await page.waitForFunction(()=>window.explorerState.online.character===21&&window.explorerState.vitals.health===64&&document.querySelector('#death').hidden,{},{timeout:10000});
 const afterRespawn=await page.evaluate(()=>window.explorerState);assert.ok(Math.hypot(afterRespawn.player.feet[0]-respawnU[0],afterRespawn.player.feet[2]+respawnU[2])<0.5);assert.equal(afterRespawn.vitals.calories,800);assert.equal(afterRespawn.vitals.bleeding,0);
 assert.equal(await page.evaluate(()=>window.explorerDev.combat().arrows),0,'respawn removes arrows belonging to the old character');
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('rlb-join')),null,'ticket consumed');
 assert.equal(await page.evaluate(()=>localStorage.getItem('rlb-offline-save')),null,'online play does not write offline saves');
 assert.deepEqual(errors,[]);
 const ragdollsBeforeRemote=await page.evaluate(()=>window.explorerDev.onlineRagdolls().length);
 peer.rpc(30,'Client_OnKilledShot',['Vector3','Angle2','byte'],[[0,0,0],{pitch:10,yaw:0},9]);
 await page.waitForFunction(n=>window.explorerDev.onlineRagdolls().length===n+1&&window.explorerDev.onlinePlayers().length===0,ragdollsBeforeRemote,{timeout:5000});
 assert.equal(await page.evaluate(()=>window.explorerDev.onlineHitboxCount()),0,'server death removes live hit regions');
 peer.rpc(30,'Client_OnKilled',[],[]);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.explorerDev.onlineRagdolls().length),ragdollsBeforeRemote+1,'duplicate deaths do not duplicate the corpse');
 peer.destroyView(30);await page.waitForFunction(()=>window.explorerDev.onlinePlayers().length===0,{},{timeout:5000});assert.equal(await page.evaluate(()=>window.explorerDev.onlineRagdolls().length),ragdollsBeforeRemote+1,'corpse survives source view removal');
 call(sleeper,7,'SAKL',[],[]);await page.waitForFunction(n=>window.explorerDev.onlineRagdolls().length===n+2&&!window.explorerDev.onlineProps().find(o=>o.key==='40:7')?.body,ragdollsBeforeRemote,{timeout:5000});
 peer.destroyView(50);await page.waitForFunction(()=>window.explorerDev.onlineAnimals().length===0,{},{timeout:5000});
 // Native culling must remove meshes/collision and retained state, then permit a clean re-entry.
 const baselineShapes=await page.evaluate(()=>window.explorerState.collisionShapes);
 peer.create({viewId:90,owner:3,group:11,prefab:'!Ng'});peer.ngcCreate(90,{prefabIndex:foundation.index,innerID:1,position:[respawnU[0]+8,respawnU[1]-3.5,respawnU[2]],euler:[0,0,0]});
 peer.create({viewId:91,owner:4,group:12,prefab:':wolf_prefab',position:[respawnU[0]+10,respawnU[1],respawnU[2]]});
 await page.waitForFunction(()=>window.explorerDev.onlineProps().some(o=>o.key==='90:1'&&o.body)&&window.explorerDev.onlineAnimals().some(a=>a.id===91&&a.rendered),{},{timeout:10000});
 peer.changeGroup(91,11);peer.destroyGroup(11,3);await page.waitForFunction(()=>!window.explorerDev.onlineProps().some(o=>o.key==='90:1'),{},{timeout:5000});assert.equal(await page.evaluate(()=>window.explorerDev.onlineAnimals().length),1,'owner-filtered culling keeps the other owner');
 peer.destroyGroup(11);await page.waitForFunction(()=>window.explorerDev.onlineAnimals().length===0,{},{timeout:5000});
 assert.equal(await page.evaluate(()=>window.explorerState.collisionShapes),baselineShapes);
 peer.create({viewId:90,owner:3,group:11,prefab:'!Ng'});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.explorerDev.onlineProps().some(o=>o.key==='90:1')),false,'carrier re-entry never restores stale children');
 peer.ngcCreate(90,{prefabIndex:foundation.index,innerID:1,position:[respawnU[0]+8,respawnU[1]-3.5,respawnU[2]],euler:[0,0,0]});await page.waitForFunction(()=>window.explorerDev.onlineProps().some(o=>o.key==='90:1'&&o.body),{},{timeout:5000});peer.destroyView(90);await page.waitForFunction(()=>!window.explorerDev.onlineProps().some(o=>o.key==='90:1'),{},{timeout:5000});
 peer.destroyAll();await page.waitForFunction(()=>window.explorerState.online.entities===0&&window.explorerDev.onlineBuildings().parts.length===0,{},{timeout:5000});assert.deepEqual(errors,[]);
 // ServerManagement.KP then the connection drops: the original shows "Disconnected (<NetError nice string>)".
 peer.rpc(1,'KP',['int'],[142]);await page.waitForFunction(()=>window.explorerDev.onlineState().kick===142,{},{timeout:5000});
 for(const sess of [...stack.gateway.service.sessions])stack.gateway.service.kick(sess.join?.subject,'test');
 await page.waitForFunction(()=>window.explorerState.online.state==='closed'&&window.explorerDev.popupNotices().includes('Disconnected (Kicked by admin)'),{},{timeout:10000});await mkdir('analysis/browser-qa/gateway',{recursive:true});await page.evaluate(()=>{for(const e of document.querySelectorAll('body > header, body > aside'))e.style.visibility='hidden';});await page.screenshot({path:'analysis/browser-qa/gateway/online-kick.png'});gaps.kick='Disconnected (Kicked by admin)';
 const result={ok:true,onlineGaps:gaps,graphics:await readGraphics(page),combat:{remoteChecks,placements,serverOwnedPlacement:true,nativeGroupCleanup:true,throws,ignites,serverProjectilePresentation:true,noLocalGrenadeDamage:true,bowFires,bowHits,bowMisses,bowInventoryServerOwned:true,meleeHits,meleeSwings,decodedAudio,meleeServerRewards:true,shots,reloads,headAndNGCAndAnimalTargets:true,serverOwnedInventory:true,serverConfirmedReload:true,aim:true},serverVitals:{nativeVitals,deathOnce:true,respawnWaitsForServer:true,afterRespawn:afterRespawn.vitals,position:afterRespawn.player.feet},inventory:{earlyFullAndDirty:true,moveConfirmed:true,lootConfirmed:true,noTakeAll:true,stopLooting:true,noOptimisticMutations:true,crafting:true,cancelCraft:true,activeItem:true,desktopLayout:true},entities:7,props,playerModel,equipment:true,heldChecks,walkAnimation:sawWalk,crouchAnimation:true,playerRemoved:true,animalModel,animalWalk:animalMoved,animalAttack:true,animalRemoved:true,doorOpen:true,oreStage:2,doorUse:'Context:A+B',fireOn,fireOff:true,feet:st.player.feet,moves:seen.filter(r=>r==='GetClientMove').length};await writeFile('analysis/browser-qa/online.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){console.error('page state:',await browser.contexts()[0]?.pages()[0]?.evaluate(()=>({online:window.explorerState?.online,status:document.querySelector('#status')?.textContent,notices:[...document.querySelectorAll('p')].slice(-5).map(p=>p.textContent)})).catch(()=>null));throw e;
}finally{await browser.close();await stack.close();web.close();}
