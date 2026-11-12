import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Vector3,Matrix4,Quaternion,Box3} from 'three';
import {populateLoot,manualUses,weightedPick,randomInt,lookRotation,crateMatrix,LootSystem,RadialCheck} from '../browser/loot.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const base=new URL('../browser/assets/recovered/loot/',import.meta.url);
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('manifest.json',base)))):null;
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null;
// Deterministic stand-in for UnityEngine.Random (mulberry32).
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const flatGround=height=>ray=>({position:new Vector3(ray.origin.x,height,ray.origin.z),normal:new Vector3(0,1,0),distance:ray.origin.y-height});

test('80 original spawners, four crate prefabs and 31 loot lists export with resolved references',needsAssets,async()=>{
 for(const [file,hash] of Object.entries(manifest.outputSHA256))assert.equal(createHash('sha256').update(await readFile(new URL(file,base))).digest('hex'),hash,file);
 assert.equal(manifest.spawners.length,80);assert.deepEqual(manifest.spawnerOmissions,[]);assert.deepEqual(manifest.unresolvedLootEntries,[]);
 assert.deepEqual(Object.values(manifest.prefabs).map(p=>p.name).sort(),['AmmoLootBox','BoxLoot','MedicalLootBox','WeaponLootBox']);
 assert.equal(Object.keys(manifest.lists).length,31);
 for(const p of Object.values(manifest.prefabs)){assert.ok(p.renderers.length&&p.colliders.length,p.name);assert.ok(manifest.lists[p.lootable.spawnList],p.lootable.spawnList);assert.equal(p.lootable.NumberOfSlots,12);}
 for(const [name,list] of Object.entries(manifest.lists))for(const e of list.packages)assert.ok(e.nullReference||(e.item&&items[e.item])||(e.list&&manifest.lists[e.list]),name);
 // Spawner timing variants recovered from the scene.
 assert.deepEqual([...new Set(manifest.spawners.map(s=>`${s.spawnTimeMin}-${s.spawnTimeMax}`))].sort(),['10-20','5-10']);
});

test('Unity Random ranges, weighted picks and the byte-cast Manual uses quantity',()=>{
 assert.equal(randomInt(()=>0.999999,1,1),1);assert.equal(randomInt(()=>0.999999,1,3),2);assert.equal(randomInt(()=>0,4,9),4);
 const entries=[{weight:0,id:'a'},{weight:3,id:'b'},{weight:1,id:'c'}];
 assert.equal(weightedPick(()=>0,entries).id,'a');assert.equal(weightedPick(()=>0.5,entries).id,'b');assert.equal(weightedPick(()=>0.9,entries).id,'c');
 assert.equal(weightedPick(()=>0.5,[{weight:0}]),null);
 const stack={_maxUses:250},single={_maxUses:1};
 assert.equal(manualUses(0,stack),1);assert.equal(manualUses(200,stack),200);assert.equal(manualUses(300,stack),44);assert.equal(manualUses(20,single),1);
});

test('LootSpawnList population stays inside each list closure, slot count and recovered amounts',needsAssets,()=>{
 const closure=name=>{const out=new Set(),visit=n=>{for(const e of manifest.lists[n].packages){if(e.item)out.add(e.item);if(e.list)visit(e.list);}};visit(name);return out;};
 for(const prefab of Object.values(manifest.prefabs)){
  const rng=seeded(7),allowed=closure(prefab.lootable.spawnList);let filled=0;
  for(let i=0;i<300;i++){const slots=populateLoot(manifest.lists,prefab.lootable.spawnList,12,items,rng);assert.equal(slots.length,12);
   for(const s of slots.filter(Boolean)){filled++;assert.ok(allowed.has(s.item),prefab.name);const d=items[s.item].data;assert.ok(s.uses>=1&&s.uses<=d._maxUses);if(d.maxEligableSlots!=null){assert.ok(s.totalModSlots>=0&&s.totalModSlots<=d.maxEligableSlots);assert.deepEqual(s.mods,[]);}}}
  assert.ok(filled>0,prefab.name);
 }
 // spawnOneOfEach lists place every package in order from slot 0.
 const supply=populateLoot(manifest.lists,'SupplyDropA',12,items,seeded(1)),entries=manifest.lists.SupplyDropA.packages;
 assert.deepEqual(supply.slice(0,entries.length).map(s=>s.item),entries.map(e=>e.item));
 // The WeaponSpawnList null-reference pick (weight 20) yields an empty crate.
 const weapon=manifest.lists.WeaponSpawnList,before=weapon.packages.slice(0,-1).reduce((a,e)=>a+e.weight,0),total=before+weapon.packages.at(-1).weight;
 assert.ok(weapon.packages.at(-1).nullReference);let r=[(before+10)/total];assert.deepEqual(populateLoot(manifest.lists,'WeaponSpawnList',12,items,()=>r.shift()??0).filter(Boolean),[]);
});

test('crate placement uses LookRotation(normal) * Inverse(child0): crates stand upright on flat ground',needsAssets,()=>{
 // Degenerate LookRotation(up) falls back to FromToRotation(z, up): -90 degrees about X.
 const q=lookRotation(new Vector3(0,1,0));assert.ok(Math.abs(Math.abs(q.x)-Math.SQRT1_2)<1e-6&&Math.abs(q.w)>0.7);
 assert.ok(new Vector3(0,0,1).applyQuaternion(q).distanceTo(new Vector3(0,1,0))<1e-6);
 for(const prefab of Object.values(manifest.prefabs)){
  const matrix=crateMatrix(prefab,new Vector3(10,5,-3),new Vector3(0,1,0)),box=new Box3();
  for(const r of prefab.renderers){const m=manifest.meshes[r.mesh];if(r.name==='ContextHint')continue;const world=matrix.clone().multiply(new Matrix4().fromArray(r.matrix));
   for(const x of [0,1])for(const y of [0,1])for(const z of [0,1])box.expandByPoint(new Vector3(m.bounds[x][0],m.bounds[y][1],m.bounds[z][2]).applyMatrix4(world));}
  const size=box.getSize(new Vector3());
  // SpawnLootable discards the prefab root rotation; BoxLoot's authored root rotation differs from the other
  // prefabs, so the original formula leaves it centred on the ground (its collider matches the same pose).
  if(prefab.name==='BoxLoot')assert.ok(Math.abs(box.min.y+box.max.y-10)<0.02,'BoxLoot centred on ground');
  else assert.ok(Math.abs(box.min.y-5)<0.02,`${prefab.name} base ${box.min.y}`);assert.ok(size.y<size.x||size.y<size.z,`${prefab.name} upright and wider than tall`);assert.ok(size.y>0.2&&size.y<1.5,prefab.name);
 }
});

test('spawner lifecycle: spawn on start, destroy when emptied, respawn on the original schedule, 5 m eject',needsAssets,()=>{
 const rng=seeded(42),events={spawn:0,destroy:0,eject:0},system=new LootSystem(manifest,items,flatGround(0),{rng,onSpawn:()=>events.spawn++,onDestroy:()=>events.destroy++,onEject:()=>events.eject++});
 system.start(0);assert.equal(system.crates.size,80);assert.equal(events.spawn,80);
 const crate=[...system.crates].find(c=>c.slots.some(Boolean)),spawner=crate.spawner;
 for(const s of system.spawners)assert.ok(s.next>=s.spawnTimeMin*60&&s.next<=s.spawnTimeMax*60);
 assert.equal(crate.contextText(),'Search');assert.equal(crate.useEnter('local',1),true);assert.equal(crate.contextText(),'Occupied');assert.equal(crate.useEnter('other',1),false);
 const inventory=new LegacyInventory(catalogue);for(let i=0;i<crate.slots.length;i++)if(crate.slots[i]&&!inventory.insert(crate.slots[i]))crate.slots[i]=null;
 assert.ok(crate.slots.every(s=>s===null));crate.useExit(2);assert.ok(crate.destroyed);assert.equal(spawner.crate,null);
 system.update(spawner.next-1,null);assert.equal(spawner.crate,null);system.update(spawner.next,null);assert.ok(spawner.crate&&spawner.crate!==crate);
 const other=[...system.crates].find(c=>c!==spawner.crate&&!c.destroyed);other.useEnter('local',100);system.update(100,other.position);
 system.update(105,other.position.clone().add(new Vector3(6,0,0)));assert.equal(events.eject,0);
 system.update(110,other.position.clone().add(new Vector3(6,0,0)));assert.equal(events.eject,1);assert.equal(other.looter,null);
});

test('LootableObject RadialCheck for placed containers: at use, then every 10 s, ejects past 5 m', ()=>{
 const box=new Vector3(10,0,10),r=new RadialCheck(100);
 assert.equal(r.due(100,new Vector3(12,0,10),box),false);assert.equal(r.next,110);
 assert.equal(r.due(109.9,new Vector3(30,0,10),box),false,'between checks the distance is not looked at');
 assert.equal(r.due(110,new Vector3(14.9,0,10),box),false);assert.equal(r.due(120,new Vector3(15.1,0,10),box),true);
 assert.equal(r.next,null);assert.equal(r.due(200,new Vector3(99,0,0),box),false,'CancelInvoke after the eject');
 assert.equal(new RadialCheck(0).due(0,new Vector3(6,0,0),new Vector3()),true,'the first check runs at once');
});
