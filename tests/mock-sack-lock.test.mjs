// tools/native/mock-world.mjs death sack lock, as the original server does it (analysis/decompiled/server):
// HumanController.OnKilled adds a TimedLockable (owner = the dead player, LockFor(player.backpackLockTime)) to the sack;
// LootableObject.ContextRespond_OpenLoot then refuses anyone else with Notice.Popup "Locked for a while..." and
// FailBreak, which Context.ExecuteClientResponse_Quick turns into ImmediateFail = Context:H. Seen on the original
// 2026-10-23 (analysis/native-runs/2026-10-23-gameplay-real-two-b: popup, then H, 3.4 s after the kill).
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createMockWorld} from '../tools/native/mock-world.mjs';
import {writeArgs} from '../bridge/ulink/rust.mjs';
import {BitReader} from '../bridge/ulink/bits.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const catalogue=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const registry=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/ngc/registry.json',import.meta.url)))):null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function fakePeer(playerId,user,character){
 const rx=[];
 return {playerId,user,character,last:[0,0,0],slots:Array(40).fill(null),rx,
  rpc(viewId,name,types,values){rx.push({viewId,name,values});},
  create(){},destroyView(){},ngcCreate(carrier,o){rx.push({ngcCreate:o});},ngcCall(){},ngcDestroy(){}};
}
const contextA=(world,peer,innerID)=>{
 const bytes=writeArgs(['NetEntityID'],[{p1:7,p2:innerID}]).toBytes();
 world.handle(peer,{rpc:'Context:A',viewId:998},new BitReader(bytes));
};
const replies=peer=>peer.rx.filter(x=>x.viewId===998).map(x=>x.name.replace(/^Context:/,''));
const popups=peer=>peer.rx.filter(x=>x.name==='CL_ConsoleCommand'&&/^notice\.popup/.test(x.values[0])).map(x=>x.values[0]);

function setup(backpackLockMs){
 let view=100;const peers=[];
 const world=createMockWorld({catalogue,registry,peers:()=>peers,nextView:()=>view++,backpackLockMs});
 const killer=fakePeer(1,'111',60027),victim=fakePeer(2,'222',59995);peers.push(killer,victim);
 world.attach(killer);world.attach(victim);
 victim.slots[30]={name:'Rock',uses:1};
 world.killed(victim,killer);
 const sack=killer.rx.find(x=>x.ngcCreate)?.ngcCreate;assert.ok(sack,'the kill drops a loot sack');
 return {world,killer,victim,sack};
}

test('death sack: locked to its dead owner for player.backpackLockTime, others get the popup and Context:H',needsAssets,async()=>{
 const {world,killer,sack}=setup(150);
 contextA(world,killer,sack.innerID);
 assert.deepEqual(replies(killer),['H'],'FailBreak -> ImmediateFail -> Context:H');
 assert.equal(popups(killer).length,1);assert.match(popups(killer)[0],/^notice\.popup 5 ".*" "Locked for a while\.\.\."$/);
 await sleep(200); // TimedLockable.Unlock after the lock time
 killer.rx.length=0;contextA(world,killer,sack.innerID);
 assert.deepEqual(replies(killer),['I'],'unlocked: the use goes through (ImmediateSuccess)');
 assert.equal(popups(killer).length,0);
 world.stop();
});

test('death sack: the dead owner may open it while locked; no lock when backpackLockTime is 0 (the default)',needsAssets,()=>{
 const a=setup(60000);
 a.victim.rx.length=0;contextA(a.world,a.victim,a.sack.innerID);
 assert.deepEqual(replies(a.victim),['I'],'TimedLockable.HasAccess: userid == ownerID');
 a.world.stop();
 const b=setup(0);
 contextA(b.world,b.killer,b.sack.innerID);
 assert.deepEqual(replies(b.killer),['I']);assert.equal(popups(b.killer).length,0);
 b.world.stop();
});
