import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Vector3,Ray,Matrix4} from 'three';
import {ResourceSystem,ResourceNode,MeleeGather,WoodBlockers,ResourceTargetType,lookRotationForcedUp} from '../browser/resources.mjs';
import {CollisionWorld,MovingBody,GridBody} from '../browser/collision.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const base=new URL('../browser/assets/recovered/resources/',import.meta.url);
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('manifest.json',base)))):null;
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null,byName=hasRecovered?(Object.fromEntries(Object.entries(items).map(([k,i])=>[i.data.m_Name,k]))):null;
const rock=hasRecovered?(items[byName.Rock].data):null,pickaxe=hasRecovered?(items[byName['Pick Axe']].data):null;
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const flat=height=>ray=>({position:new Vector3(ray.origin.x,height,ray.origin.z),normal:new Vector3(0,1,0),terrain:true});
async function f32(desc){const b=await readFile(new URL(desc.file,base));return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);}
async function u32(desc){const b=await readFile(new URL(desc.file,base));return new Uint32Array(b.buffer,b.byteOffset,b.byteLength/4);}
function node(prefabName,rng=seeded(3)){const system={rng,nodes:new Set()},entry={spawned:[]};const n=new ResourceNode(system,null,entry,manifest.prefabs[prefabName],new Matrix4(),new Vector3());entry.spawned.push(n);system.nodes.add(n);return {n,entry,system};}

test('original GenericSpawners, resource prefabs and client tree colliders export with resolved items',needsAssets,async()=>{
 for(const [file,hash] of Object.entries(manifest.outputSHA256))assert.equal(createHash('sha256').update(await readFile(new URL(file,base))).digest('hex'),hash,file);
 assert.equal(manifest.spawners.length+manifest.spawnerOmissions.length,46);
 assert.deepEqual(Object.keys(manifest.prefabs).sort(),['res_ore_1','res_ore_2','res_ore_3','res_woodpile']);
 for(const p of Object.values(manifest.prefabs)){assert.equal(p.visualMeshes.length,4);assert.equal(p.collisionMeshes.length,4);for(const r of p.resourceTarget.resourcesAvailable)assert.ok(items[r.item],r.name);}
 assert.equal(manifest.prefabs.res_woodpile.resourceTarget.type,ResourceTargetType.WoodPile);assert.equal(manifest.prefabs.res_woodpile.resourceTarget.gatherEfficiencyMultiplier,10);
 for(const p of ['res_ore_1','res_ore_2','res_ore_3'])assert.equal(manifest.prefabs[p].resourceTarget.type,ResourceTargetType.Rock1);
 // Override lists are copied with GenericSpawnInstance.Clone, which leaves useNavmeshSample at its default (true).
 for(const s of manifest.spawners.filter(s=>s.override))assert.ok(s.spawnList.every(e=>e.useNavmeshSample));
 assert.equal(manifest.treeColliders.meshes,244);assert.equal(manifest.treeColliders.capsules.length,5);assert.equal(manifest.treeColliders.unpackGroups[0].tag,'Tree Collider');
 // Original tool data: Rock swings every 1.95 s and has five efficiencies (Animal..Rock2).
 assert.ok(Math.abs(rock.fireRate-1.95)<1e-6);assert.equal(rock.range,1.5);assert.deepEqual(rock.efficiencies,[1,0.75,0.75,0.75,0.75]);
});

test('ResourceTarget.DoGather: floored progress, per-hit yields, inventory-full and depletion',needsAssets,()=>{
 const inventory=new LegacyInventory(catalogue),notices=[];
 const wood=node('res_woodpile');assert.equal(wood.n.modelIndex,0);
 // Rock on a woodpile: 0.75 * 10 = 7.5 -> 7 wood; the 0.5 remainder is discarded by the original clamp.
 wood.n.doGather(inventory,rock.efficiencies[1],m=>notices.push(m));assert.equal(notices.at(-1),'7 x Wood');assert.equal(wood.n.gatherProgress,0);
 wood.n.doGather(inventory,rock.efficiencies[1],m=>notices.push(m));assert.equal(notices.at(-1),'7 x Wood');assert.equal(inventory.count(byName.Wood),14);
 // Rock on ore: 0.75 * 3 = 2.25 -> 2 per hit; a Pick Axe (2 * 3) gives 6.
 const ore=node('res_ore_1');ore.n.doGather(inventory,rock.efficiencies[3],m=>notices.push(m));assert.match(notices.at(-1),/^2 x (Sulfur Ore|Metal Ore|Stones)$/);
 // Yield is capped by the randomly chosen resource pair, not the node total.
 const ore2=node('res_ore_3');const before=Object.fromEntries(ore2.n.resources.map(r=>[r.name,r.left]));ore2.n.doGather(inventory,pickaxe.efficiencies[3],()=>{});
 const after=Object.fromEntries(ore2.n.resources.map(r=>[r.name,r.left])),changed=Object.keys(before).filter(k=>(after[k]??0)!==before[k]);
 assert.equal(changed.length,1);assert.equal(before[changed[0]]-(after[changed[0]]??0),Math.min(6,before[changed[0]]));
 // A full inventory gathers nothing and keeps the node's resources.
 const full=new LegacyInventory(catalogue);full.slots=full.slots.map((s,i)=>i<36?{item:byName.Rock,uses:1,condition:1}:s);
 const pile=node('res_woodpile'),left=pile.n.totalLeft;pile.n.doGather(full,rock.efficiencies[1],m=>notices.push(m));assert.equal(notices.at(-1),"Inventory full, can't gather.");assert.equal(pile.n.totalLeft,left);
 // Depletion walks the four original meshes and then removes the node from its spawner.
 const indices=new Set();let guard=0;while(!pile.n.destroyed&&guard++<500){pile.n.doGather(new LegacyInventory(catalogue),pickaxe.efficiencies[1],()=>{});indices.add(pile.n.modelIndex);}
 assert.ok(pile.n.destroyed);assert.equal(pile.entry.spawned.length,0);assert.deepEqual([...indices].sort(),[1,2,3].filter(i=>indices.has(i)));assert.ok(indices.has(3));
});

test('GenericSpawner timing, populations and terrain placement follow the original',needsAssets,()=>{
 const spawned=[],system=new ResourceSystem(manifest,flat(10),{rng:seeded(9),onSpawn:n=>spawned.push(n)});
 system.start(0);const first=system.timers.filter(t=>t.repeat===0).map(t=>t.at);
 assert.equal(first[0],5);for(let i=1;i<first.length;i++){const d=first[i]-first[i-1];assert.ok(d>=1&&d<=2);}
 system.update(4.99);assert.equal(spawned.length,0);
 for(let t=5;t<4000;t+=30)system.update(t);
 for(const s of system.spawners)for(const e of s.spawnList){assert.ok(e.spawned.length<=e.targetPopulation);if(!e.ported)assert.equal(e.spawned.length,0);}
 assert.ok(spawned.length>150);
 for(const n of spawned.slice(0,50)){assert.ok(Math.abs(n.position.y-10.05)<1e-9);const s=n.spawner;assert.ok(Math.hypot(n.position.x-s.position[0],n.position.z-s.position[2])<=s.radius+1e-6);}
 // Flat ground: LookRotationForcedUp keeps the node upright.
 const q=lookRotationForcedUp(new Vector3(1,0,0),new Vector3(0,1,0));assert.ok(new Vector3(0,1,0).applyQuaternion(q).distanceTo(new Vector3(0,1,0))<1e-6);
 // Terrain-only ground info: a spawn attempt whose ray hits something else first is retried, then abandoned after 15 tries.
 let tries=0;const blocked=new ResourceSystem(manifest,()=>{tries++;return null;},{rng:seeded(1)});blocked.start(0);blocked.update(5);assert.equal(blocked.nodes.size,0);assert.equal(tries%15,0);
});

test('Rock swing timing and terrain-tree wood: pooled datablock level and WoodBlockerTemp budget',needsAssets,()=>{
 const melee=new MeleeGather({rng:seeded(5)}),inventory=new LegacyInventory(catalogue),tree={body:{isTree:true},point:new Vector3(0,1,0)};
 assert.equal(melee.frame(0,{attack:true},rock),true);assert.equal(melee.frame(1,{attack:true},rock),false);assert.equal(melee.dueSwing(1.2),null);
 assert.ok(melee.dueSwing(1.25));assert.equal(melee.frame(1.95,{attack:true},rock),false);assert.equal(melee.frame(1.951,{attack:true},rock),true);
 melee.frame(3,{attack:false,sprinting:true},rock);melee.frame(3.5,{attack:false},rock);assert.ok(Math.abs(melee.next-3.901)<1e-6);
 const results=[];for(let i=0;i<4;i++)results.push(melee.resolve(10+i,rock,byName.Rock,tree,inventory,byName.Wood,new Vector3()).gathered);
 // 0.75 per hit, floored when it reaches 1: 0, 1, 1, 1 (level .75, 1.5->.5, 1.25->.25, 1.0->0).
 assert.deepEqual(results,[0,1,1,1]);
 const blocker=melee.blockers.forPoint(tree.point,10);assert.ok(blocker.numWood>=10-3&&blocker.numWood<14);
 blocker.numWood=0.5;const notices=[];assert.equal(melee.resolve(20,rock,byName.Rock,tree,inventory,byName.Wood,new Vector3(),m=>notices.push(m)).gathered,0);assert.equal(notices[0],"There's no wood left here");
 // Blockers expire after 300 s and are shared within 4 m.
 const wb=new WoodBlockers(seeded(2)),a=wb.forPoint(new Vector3(0,0,0),0);assert.equal(wb.forPoint(new Vector3(3,0,0),1),a);assert.notEqual(wb.forPoint(new Vector3(0,0,0),301),a);
});

test('client tree collision meshes line up with the recovered terrain tree placements',needsAssets,async()=>{
 const world=new CollisionWorld(null),body=world.addBody(new GridBody('trees',await f32(manifest.treeColliders.position),await u32(manifest.treeColliders.indices)));body.isTree=true;world.build();
 const placements=JSON.parse(await readFile(new URL('../browser/assets/recovered/trees.json',import.meta.url)));
 let tested=0,hits=0;
 for(let i=0;i<placements.length&&tested<60;i+=487){const [x,y,z,kind]=placements[i];if(kind===3)continue;tested++;
  const hit=world.sphereCast(new Ray(new Vector3(x-1.4,y+1.5,z),new Vector3(1,0,0)),0.3,1.5);if(hit?.body?.isTree)hits++;}
 assert.ok(tested>=40);assert.ok(hits/tested>0.8,`${hits}/${tested} trunks hit`);
});
