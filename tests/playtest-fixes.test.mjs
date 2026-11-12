// Fixes from the full-loop playtest of 2026-10-23 (GAP-AUDIT "Full-loop playtest 2026-10-23").
import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3} from 'three';
import {CollisionWorld,MovingBody} from '../browser/collision.mjs';
import {wildlifePhysics,WILDLIFE_GROUND_MASK} from '../browser/animals.mjs';
import {readFile} from 'node:fs/promises';
import {LegacyInventory} from '../browser/inventory.mjs';
import {HumanBody,Metabolism} from '../browser/survival.mjs';
import {saveWorld,loadWorld} from '../browser/persistence.mjs';
import {StructureSystem} from '../browser/structures.mjs';
import {DeployableSystem} from '../browser/deployables.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const worlds=()=>({structures:new StructureSystem(manifest,catalogue.items,{zones:[],raycast:()=>null,groundTerrainOnly:()=>true}),deployables:new DeployableSystem(manifest,catalogue.items,{rng:()=>0.5})});
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const player=()=>({inventory:new LegacyInventory(catalogue,undefined,{rng:()=>0.5}),body:new HumanBody({rng:()=>0.5}),metabolism:new Metabolism({rng:()=>0.5})});
const extraBlueprint=()=>Object.keys(catalogue.blueprints).find(k=>!new LegacyInventory(catalogue).known.has(k));

test('dead offline player: saved as AvatarSaveRestore.ClearAvatar (inventory only), loaded as a fresh spawn',needsAssets,()=>{
 const a=player();a.body.health=0;a.body.setBleedingLevel(6,10);const respawned=new LegacyInventory(catalogue,undefined,{rng:()=>0.5});respawned.known.add(extraBlueprint());
 const save=JSON.parse(JSON.stringify(saveWorld({now:10,player:{dead:true,inventory:respawned,body:a.body,metabolism:a.metabolism,position:new Vector3(1,2,3)}})));
 assert.equal(save.player.position,null);assert.equal(save.player.body,null);assert.equal(save.player.metabolism,null);
 const b=player(),r=loadWorld(save,{now:5,...worlds(),player:b});
 assert.equal(r.position,null);assert.equal(r.wasDead,false);assert.equal(b.body.health,b.body.maxHealth);assert.equal(b.body.bleedingLevel,0);
 assert.ok(b.inventory.known.has(extraBlueprint()));assert.ok(b.inventory.slots.some(Boolean),'default loadout items');
});

test('an older save written while dead (health 0) loads alive at a fresh spawn and keeps the learned blueprints',needsAssets,()=>{
 const a=player();a.body.health=0;a.inventory.slots.fill(null);a.inventory.known.add(extraBlueprint());
 const save=JSON.parse(JSON.stringify(saveWorld({now:10,player:{...a,position:new Vector3(1,2,3),yaw:30}})));assert.equal(save.player.body.health,0);
 const b=player(),r=loadWorld(save,{now:5,...worlds(),player:b});
 assert.equal(r.wasDead,true);assert.equal(r.position,null);assert.ok(b.body.alive);assert.ok(b.inventory.slots.some(Boolean),'default loadout kept');assert.ok(b.inventory.known.has(extraBlueprint()));
});

// A box body on `layer` whose top is at y = 2 over (0, 0) (browser space), on flat terrain at y = 0.
function worldWith(layer,extra={}){const w=new CollisionWorld(()=>0);w.addBox([20,1,20],[0,-0.5,0],new Matrix4());w.build();
 const b=new MovingBody('box layer '+layer);b.addBox([1,0.4,1],[0,1.8,0],new Matrix4());b.setMotion(new Matrix4());Object.assign(b,{layer,...extra});w.addBody(b);return w;}

test('TransformHelpers.GetGroundInfo mask -472317957: animals ignore layers 2, 16-18, 21, 26-28 (hit boxes, ragdolls)',()=>{
 const ex=[];for(let i=0;i<32;i++)if(!((WILDLIFE_GROUND_MASK>>>i)&1))ex.push(i);assert.deepEqual(ex,[2,16,17,18,21,26,27,28]);
 // A player's hit regions and death ragdolls (layer 27) are not ground: the ray goes through to the terrain.
 for(const layer of [27,17,18,2]){const g=wildlifePhysics(worldWith(layer)).groundInfo(new Vector3(0,3,0),10);assert.ok(Math.abs(g.pos.y)<1e-6,`layer ${layer}: ${g.pos.y}`);}
 // Solid layers (default 0, deployables 10, structures …) still are.
 for(const layer of [0,10,undefined]){const g=wildlifePhysics(worldWith(layer)).groundInfo(new Vector3(0,3,0),10);assert.ok(Math.abs(g.pos.y-2)<1e-6,`layer ${layer}: ${g.pos.y}`);}
 // Other animals (layer 21 boxes) are skipped as before, also when their layer is not set.
 assert.ok(Math.abs(wildlifePhysics(worldWith(undefined,{animal:{}})).groundInfo(new Vector3(0,3,0),10).pos.y)<1e-6);
 // The same mask blocks (Physics.Raycast(origin, dir, distance, -472317957)) sideways.
 assert.equal(wildlifePhysics(worldWith(27)).blocked(new Vector3(-3,1.8,0),new Vector3(1,0,0),6),false);
 assert.equal(wildlifePhysics(worldWith(10)).blocked(new Vector3(-3,1.8,0),new Vector3(1,0,0),6),true);
});
