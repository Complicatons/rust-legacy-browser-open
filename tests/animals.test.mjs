import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
import {MillisClock,Direction,Wildlife,WildlifeWorld,Vitals,State,moveAnimation,deathAnimation,yawDirection} from '../browser/animals.mjs';
import {MeleeGather} from '../browser/resources.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const base=new URL('../browser/assets/recovered/animals/',import.meta.url);
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('manifest.json',base)))):null;
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const byName=hasRecovered?(Object.fromEntries(Object.entries(catalogue.items).map(([k,i])=>[i.data.m_Name,k]))):null;
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
// Flat ground at y=300 with no obstacles.
const flat={groundInfo:p=>({hit:true,pos:new Vector3(p.x,300,p.z),normal:new Vector3(0,1,0)}),blocked:()=>false};
function setup(key,{rng=seeded(4),waterLine=0}={}){const world=new WildlifeWorld({rng,physics:flat,waterLine});const entry={spawned:[]};const a=world.add(new Wildlife(world,key,manifest.animals[key],null,entry,new Vector3(0,300,0),new Quaternion()));entry.spawned.push(a);return {world,a,entry};}
function run(world,from,to,step=0.05,each){for(let t=from;t<=to+1e-9;t+=step){world.update(t,step);each?.(t);}}
function player(position){const v=new Vitals(100);return {character:true,position,vitals:v,get alive(){return v.alive;},hurts:[],hurt(types,attacker){const r=v.hurt(types);this.hurts.push({t:attacker?.character?.world.time,amount:r.amount});return r;}};}

test('eight original wildlife prefabs export with skeletons, skins, clips and resolved harvest items',needsAssets,async()=>{
 const clips=JSON.parse(await readFile(new URL(manifest.clipsFile,base)));
 assert.deepEqual(Object.keys(manifest.animals).sort(),['bear_prefab','boar_prefab','chicken_prefab','mutant_bear','mutant_wolf','rabbit_prefab_a','stag_prefab','wolf_prefab']);
 for(const [key,a] of Object.entries(manifest.animals)){
  assert.equal(a.skins.length,1,key);const s=a.skins[0];assert.ok(s.bones.every(i=>i>=0&&i<a.skeleton.length));assert.equal(s.bindposes.length,s.bones.length);
  for(const r of a.resourceTarget.resourcesAvailable)assert.ok(catalogue.items[r.item],r.name);
  // Every clip the client Update/death code asks for exists in the original Animation component.
  for(const speed of [0,1,3]){const m=moveAnimation(a,speed);assert.ok(a.clips.includes(m.clip),`${key} ${m.clip}`);}
  assert.ok(a.clips.includes(deathAnimation(a)),key);
  for(const name of a.clips){const c=clips[`${key}:${name}`];assert.ok(c.tracks.length>0);for(const t of c.tracks)if(t.rotation)assert.equal(t.rotation.values.length,t.rotation.times.length*4);}
 }
 const wolf=manifest.animals.wolf_prefab;assert.equal(wolf.takeDamage.maxHealth,125);assert.deepEqual([wolf.ai.attackDamageMin,wolf.ai.attackRate,wolf.ai.attackRange,wolf.ai.attackRangeMax],[15,1.5,2,5]);
 assert.equal(manifest.animals.chicken_prefab.takeDamage.maxHealth,25);assert.equal(manifest.animals.bear_prefab.movement.type,'NavMeshMovement');
});

test('MillisClock and Direction keep the original quirks',()=>{
 const c=new MillisClock();assert.equal(c.reached(200),true);c.resetDurationMillis(500);assert.equal(c.reached(200),false);assert.equal(c.reached(200),false);assert.equal(c.reached(200),true);assert.equal(c.reached(200),true);
 const d=new Direction();d.target(new Vector3(1,0,0),90);assert.ok(d.current.distanceTo(new Vector3(1,0,0))<1e-9);
 d.target(new Vector3(0,0,1),90);assert.equal(d.clock.remain,1000);d.advance(500);assert.ok(Math.abs(d.current.angleTo(new Vector3(1,0,0))-Math.PI/4)<1e-6);
 // The last step reports stationary and does not snap to the target.
 d.advance(600);assert.ok(Math.abs(d.current.angleTo(new Vector3(1,0,0))-Math.PI/4)<1e-6);
 assert.ok(yawDirection(90).distanceTo(new Vector3(1,0,0))<1e-12);
});

test('passive wildlife: unset idle clock roams at once, footsteps cause a run-speed flee, then idle',needsAssets,()=>{
 const {world,a}=setup('chicken_prefab');
 world.update(0,0.05);assert.equal(a.state,State.Roam);assert.equal(a.move.desiredSpeed,a.ai.walkSpeed);
 run(world,0.05,2);const p0=a.position.clone();run(world,2.05,3);assert.ok(Math.abs(p0.distanceTo(a.position)-a.ai.walkSpeed)<0.25,`walked ${p0.distanceTo(a.position)}`);
 // Footstep heard from 3 m away (inside the 5 m walking radius).
 const from=a.position.clone().add(new Vector3(3,0,0));world.audible(null,from,5,'hearFootstep',from);assert.equal(a.state,State.Flee);
 assert.ok(a.move.desiredSpeed>=a.ai.runSpeed*0.9&&a.move.desiredSpeed<=a.ai.runSpeed*1.1);
 run(world,3.05,8.4);assert.ok(a.position.x<from.x-5,'fled away');assert.equal(a.state,State.Idle);
});

test('hostile wildlife: scent starts a chase, bites land 0.25 s after each attack and repeat every attackRate',needsAssets,()=>{
 const {world,a}=setup('wolf_prefab',{rng:seeded(11)});
 const target=player(new Vector3(15,300,0));world.update(0,0.05);
 world.audible(null,target.position,20,'scent',target);assert.equal(a.state,State.Chase);
 // Agent moves toward the player each frame at the original run speed (8 m/s, agent acceleration 12).
 run(world,0.05,8,0.05);assert.equal(a.state,State.Attack);
 const bites=target.hurts.map(h=>h.amount);assert.ok(bites.length>=2,JSON.stringify(target.hurts));assert.ok(bites.every(b=>b===15));
 const times=target.hurts.map(h=>h.t);for(let i=1;i<times.length;i++)assert.ok(Math.abs(times[i]-times[i-1]-1.5)<0.25,JSON.stringify(times));
 // After the player dies the wolf loses its target and goes scent-blind for 10 s.
 let died=null;run(world,8.05,40,0.05,tt=>{if(died===null&&!target.alive)died=tt;});assert.ok(died!==null);
 // Re-run up to just after death: the wolf lost its target and is scent-blind for 10 s.
 const w2=setup('wolf_prefab',{rng:seeded(11)}),t2=player(new Vector3(15,300,0));w2.world.update(0,0.05);w2.world.audible(null,t2.position,20,'scent',t2);run(w2.world,0.05,died+0.3,0.05);
 assert.notEqual(w2.a.state,State.Attack);assert.notEqual(w2.a.state,State.Chase);
 const again=player(new Vector3(w2.a.position.x+3,300,w2.a.position.z));w2.world.audible(null,again.position,20,'scent',again);assert.equal(w2.a.target,null);
 run(w2.world,died+0.35,died+10.5,0.05);w2.world.audible(null,again.position,20,'scent',again);assert.equal(w2.a.target,again);
});

test('Rock kills a chicken in two hits, the corpse is harvested with Animal efficiency, then removed',needsAssets,()=>{
 const {world,a,entry}=setup('chicken_prefab');world.update(0,0.05);
 const rock=catalogue.items[byName.Rock].data,melee=new MeleeGather({rng:seeded(2)}),inventory=new LegacyInventory(catalogue),notices=[],me={character:true};
 const hit={body:{animal:a},point:a.position.clone()},feet=new Vector3(a.position.x+1,a.position.y,-a.position.z);
 let r=melee.resolve(1,rock,byName.Rock,hit,inventory,byName.Wood,feet,m=>notices.push(m),me);assert.equal(r.kind,'animal');assert.equal(a.vitals.health,5);assert.equal(a.state,State.Flee);
 r=melee.resolve(3,rock,byName.Rock,hit,inventory,byName.Wood,feet,m=>notices.push(m),me);assert.equal(r.killed,true);assert.equal(r.gathered,false);assert.equal(a.state,State.Dead);
 // Chicken: Raw Chicken Breast x2 + Cloth x1, multiplier 1, Rock Animal efficiency 1 -> one item per hit.
 for(let i=0;i<3&&!a.destroyed;i++)melee.resolve(5+i*2,rock,byName.Rock,hit,inventory,byName.Wood,feet,m=>notices.push(m),me);
 assert.ok(a.destroyed);assert.equal(entry.spawned.length,0);assert.equal(inventory.count(byName['Raw Chicken Breast']),2);assert.equal(inventory.count(byName.Cloth),1);
 assert.deepEqual(notices.filter(n=>/x/.test(n)).length,3);
});

test('unharvested corpses are removed after 90 s, and wildlife below the water line dies',needsAssets,()=>{
 const {world,a,entry}=setup('rabbit_prefab_a');world.update(0,0.05);a.hurt([0,0,100,0,0,0],{character:true});assert.equal(a.state,State.Dead);
 run(world,0.05,89.9,0.5);assert.equal(a.destroyed,false);world.update(90.1,0.05);assert.equal(a.destroyed,true);assert.equal(entry.spawned.length,0);
 const sea=setup('boar_prefab',{waterLine:350});sea.world.update(0,0.05);assert.equal(sea.a.vitals.dead,true);
});

test('mutants ask for their dropOnDeathString sack when they die; normal wolves and bears drop nothing',needsAssets,()=>{
 for(const [key,want] of [['mutant_wolf',';drop_lootsack_zombie'],['mutant_bear',';drop_lootsack_zombie'],['wolf_prefab',null],['bear_prefab',null]]){
  const drops=[],world=new WildlifeWorld({rng:seeded(2),physics:flat,dropOnDeath:(a,prefab)=>drops.push([a.key,prefab,a.alive])});
  const a=world.add(new Wildlife(world,key,manifest.animals[key],null,{spawned:[]},new Vector3(0,300,0),new Quaternion()));
  a.hurt([0,0,1000,0,0,0],{character:true});
  // HostileWildlifeAI.OnKilled drops first, then the base handler runs (the animal is already dead by health).
  assert.deepEqual(drops,want?[[key,want,false]]:[],key);
  a.hurt([0,0,10,0,0,0],{character:true});assert.equal(drops.length,want?1:0,'only once');
 }
});
