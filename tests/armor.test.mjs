import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {armorKeys,decodeArmor} from '../browser/armor.mjs';
import {GatewayClient} from '../browser/net-client.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const players=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/players/manifest.json',import.meta.url)))):null,armor=hasRecovered?(players.armor):null;
test('original default player armour uses censored legs and server UIDs resolve only to the correct body slot',needsAssets,()=>{
 const defaults=armorKeys(armor);assert.equal(defaults.length,4);assert.ok(armor.models[defaults[1]].name.includes('censored'));
 const entries=Object.entries(armor.items),uid=slot=>Number(entries.find(([,a])=>a.slot===slot&&a.name.includes('Kevlar'))[0]);
 const keys=armorKeys(armor,armor.slots.map(uid));assert.ok(keys.every(k=>armor.models[k].name.startsWith('kevlar')));
 assert.deepEqual(armorKeys(armor,[-1,-1,-1,-1]),defaults);assert.deepEqual(armorKeys(armor,[uid('head'),0,0,0]),defaults);
 for(const m of Object.values(armor.models)){assert.equal(m.skin.bones.length,m.skin.bindposes.length);assert.ok(m.skin.bones.every(i=>i>=0&&i<players.player.skeleton.length));assert.ok(m.skin.bindposes.flat().every(Number.isFinite));}
});
test('CFAR decodes exactly four signed little-endian item IDs, including nested gateway base64',async()=>{
 const values=[-123,0,2147483647,-2147483648],bytes=Buffer.alloc(16);values.forEach((n,i)=>bytes.writeInt32LE(n,i*4));
 assert.deepEqual(decodeArmor(bytes),values);assert.deepEqual(decodeArmor({base64:bytes.toString('base64')}),values);assert.throws(()=>decodeArmor(bytes.subarray(0,15)));
 class Socket extends EventTarget{constructor(){super();this.readyState=1;Socket.last=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(){}close(){}push(e){this.dispatchEvent(Object.assign(new Event('message'),{data:JSON.stringify(e)}));}}
 const c=new GatewayClient({url:'ws://127.0.0.1/play',WebSocketImpl:Socket}),p=c.connect({ticket:'test'});await new Promise(r=>setTimeout(r));const ws=Socket.last;
 ws.push({type:'approved',playerId:1,world:{sendRate:5}});await p;
 ws.push({type:'create',viewId:30,prefab:':player_soldier',position:[1,2,3],rotation:[0,0,0,1]});
 let received=null;c.addEventListener('equipment',e=>received=e.detail);
 ws.push({type:'rpc',viewId:30,name:'CFAR',args:{class:'Inventory',values:[{base64:bytes.toString('base64')}]}});
 assert.deepEqual(received,{viewId:30,armor:values});assert.deepEqual(c.views.get(30).armor,values);
});
test('original loot sacks and sleeper sleeping meshes export with collision and all clothing variants',needsAssets,()=>{
 const d=JSON.parse(readFileSync(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)));
 for(const k of [';drop_lootsack',';drop_lootsack_zombie',';sleeper_male']){const p=d.prefabs[k];assert.ok(p.renderers.length>0,k);assert.ok(p.colliders.some(c=>!c.trigger),k);}
 const sleeper=d.prefabs[';sleeper_male'];assert.deepEqual(sleeper.renderers.filter(r=>r.armorSlot).map(r=>r.armorSlot).sort(),[...armor.slots].sort());
 for(const m of Object.values(d.armor.models))assert.ok(d.meshes[m.sleepMesh]?.position.count>0,m.name);
});
