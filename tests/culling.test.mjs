import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {GameBridge} from '../bridge/game-bridge.mjs';import {GatewayClient} from '../browser/net-client.mjs';import {INTERNAL} from '../bridge/ulink/ulink.mjs';import {BitWriter,BitReader} from '../bridge/ulink/bits.mjs';
function fixture(){const native=new EventEmitter();native.playerId=1;const bridge=new GameBridge({client:native,schema:{},playerName:'Test'}),c=new GatewayClient({url:'ws://localhost'});bridge.on('event',e=>c.apply(e));
 for(const [viewId,owner,group]of [[20,1,1],[30,2,7],[40,3,7],[50,3,8]]){const v={viewId,prefab:'!Ng',owner,group,position:[0,0,0],rotation:[0,0,0,1]};bridge.views.set(viewId,v);c.apply({type:'create',...v,mine:false});const key=viewId+':1';bridge.ngc.set(key,{carrier:viewId,innerID:1});c.apply({type:'ngc-create',carrier:viewId,innerID:1,prefab:';test',position:[0,0,0],euler:[0,0,0]});}
 const send=(internal,write=()=>{},viewId)=>{const w=new BitWriter();write(w);bridge.onUlink({internal,viewId},new BitReader(w.toBytes()));};return {bridge,c,send};}
test('native group destruction removes only matching owners/groups and clears carrier entities in both caches',()=>{
 const {bridge,c,send}=fixture(),removed=[];c.addEventListener('entity-destroy',e=>removed.push(e.detail.carrier));
 send(INTERNAL.DestroyInGroupByPlayerID,w=>w.u16(3).u16(7));assert.deepEqual([...c.views.keys()],[20,30,50]);assert.deepEqual(removed,[40]);assert.equal(bridge.ngc.has('40:1'),false);
 send(INTERNAL.DestroyInGroup,w=>w.u16(7));assert.deepEqual([...c.views.keys()],[20,50]);assert.deepEqual([...c.entities.keys()],['20:1','50:1']);assert.equal(bridge.views.has(30),false);
 send(INTERNAL.DestroyByViewID,()=>{},50);assert.equal(c.entities.has('50:1'),false);assert.equal(bridge.ngc.has('50:1'),false);
 send(INTERNAL.DestroyAll);assert.equal(c.views.size,0);assert.equal(c.entities.size,0);assert.equal(bridge.ngc.size,0);assert.equal(bridge.views.get(998).scene,true,'manual scene views survive DestroyAll');
});
test('ChangeGroup changes future culling and NGC routing; recreated carriers never replay old state',()=>{
 const {bridge,c,send}=fixture();send(INTERNAL.ChangeGroup,w=>w.u16(30).u16(8));assert.equal(c.views.get(30).group,8);assert.equal(bridge.views.get(30).group,8);
 send(INTERNAL.DestroyInGroup,w=>w.u16(7));assert.equal(c.views.has(30),true);send(INTERNAL.DestroyInGroup,w=>w.u16(8));assert.equal(c.views.has(30),false);assert.equal(c.entities.has('30:1'),false);
 c.apply({type:'create',viewId:30,prefab:'!Ng',group:9,position:[0,0,0],rotation:[0,0,0,1]});assert.equal(c.entities.has('30:1'),false);
});
