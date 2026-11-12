import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion,Ray} from 'three';
import {StructureSystem} from '../browser/structures.mjs';
import {DeployableSystem} from '../browser/deployables.mjs';
import {WorldRules,spikeTriggerContains,DOOR_TAG} from '../browser/world-rules.mjs';
import {enterCode,canToggleDoor} from '../browser/locks.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null,skey=n=>Object.keys(manifest.structures).find(k=>manifest.structures[k].item===n),dkey=n=>Object.keys(manifest.deployables).find(k=>manifest.deployables[k].item===n);
const q=new Quaternion(),eyesAt=(x,z)=>new Ray(new Vector3(x,10,z),new Vector3(0,-1,0));
function setup(){const world={zones:[],system:null,raycast:()=>null,groundTerrainOnly:()=>true},s=new StructureSystem(manifest,items,world);world.system=s;
 const d=new DeployableSystem(manifest,items,{rng:()=>0.5});return {s,d,rules:new WorldRules({structures:s,deployables:d,random:()=>0})};}

test('deployables decay in the open, not under a roof, not on a carrier and not beside a lit fire',needsAssets, ()=>{
 const {s,d,rules}=setup();
 const open=d.place(dkey('Wood Storage Box'),new Vector3(50,0,50),q,0);rules.onPlaced(open,'me',0);
 const near=d.place(dkey('Wood Storage Box'),new Vector3(-50,0,-50),q,0);rules.onPlaced(near,'me',0);
 const fire=d.place(dkey('Camp Fire'),new Vector3(-48,0,-50),q,0);rules.onPlaced(fire,'me',0);
 fire.slots[6]={item:Object.keys(items).find(k=>items[k].data.m_Name==='Wood'),uses:250,condition:1};fire.fire.setOn(true,0);
 // A roof: foundation + four pillars + ceiling 4 m over a box.
 const f=s.place(skey('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),m=f.master,at=(x,y,z)=>m.world(new Vector3(x,y,z));
 for(const [x,z] of [[2.5,2.5],[-2.5,2.5],[2.5,-2.5],[-2.5,-2.5]])s.place(skey('Wood Pillar'),eyesAt(50,50),at(x,4,z),q,m);
 assert.ok(s.place(skey('Wood Ceiling'),eyesAt(50,50),at(0,4,0),q,m));
 const roofed=d.place(dkey('Wood Storage Box'),new Vector3(10,0,10),q,0);roofed.position.copy(at(0,0.5,0));rules.onPlaced(roofed,'me',0);
 const carried=d.place(dkey('Wood Storage Box'),new Vector3(20,0,20),q,0,f);rules.onPlaced(carried,'me',0);
 assert.ok(rules.sheltered(roofed));assert.ok(!rules.sheltered(open));
 rules.tick(30);const healthy=open.maxHealth;
 rules.tick(400);
 assert.ok(Math.abs(open.health-(healthy-300/43200*healthy*0.25))<1e-9,String(open.health));
 assert.equal(roofed.health,roofed.maxHealth);assert.equal(carried.health,carried.maxHealth);
 assert.equal(near.health,near.maxHealth,'kept fresh by the fire');assert.equal(fire.health,fire.maxHealth,'a lit fire does not decay');
});

test('structures wait out the wood delay, then decay with load-bearing pieces spared',needsAssets, ()=>{
 const {s,d,rules}=setup();
 const f=s.place(skey('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),m=f.master,at=(x,y,z)=>m.world(new Vector3(x,y,z));
 const p=s.place(skey('Wood Pillar'),eyesAt(50,50),at(2.5,4,2.5),q,m),top=s.place(skey('Wood Pillar'),eyesAt(50,50),at(2.5,8,2.5),q,m);
 for(const c of [f,p,top])rules.onPlaced(c,undefined,0);
 assert.ok(rules.carryingWeight(f)&&rules.carryingWeight(p)&&!rules.carryingWeight(top));
 rules.tick(1);rules.tick(172800);assert.equal(top.health,top.maxHealth,'still within the 48 h delay');
 rules.tick(172800+2200);
 assert.equal(f.health,f.maxHealth);assert.equal(p.health,p.maxHealth);assert.ok(top.health<top.maxHealth);
 // Using a door on the structure resets the delay.
 const door=d.place(dkey('Wooden Door'),new Vector3(0,0,0),q,0,f);rules.onPlaced(door,'me',0);rules.touched(door,172800+2300);
 const before=top.health;rules.tick(172800+9000);assert.equal(top.health,before);
});

test('doors get code locks owned by the placer; spike walls hurt characters inside their trigger',needsAssets, ()=>{
 const {d,rules}=setup();
 const door=d.place(dkey('Wooden Door'),new Vector3(0,0,0),q,0);rules.onPlaced(door,'owner',0);
 assert.ok(door.lock);assert.equal(door.ownerId,'owner');
 assert.equal(canToggleDoor({lock:door.lock,isOwner:false,userId:'guest'}),false);
 enterCode({lock:door.lock,code:'4321',changing:true,isOwner:true,userId:'owner',time:0});
 assert.equal(enterCode({lock:door.lock,code:'4321',changing:false,isOwner:false,userId:'guest',time:10}).ok,true);
 assert.equal(canToggleDoor({lock:door.lock,isOwner:false,userId:'guest'}),true);
 const wall=d.place(dkey('Spike Wall'),new Vector3(10,0,0),q,0);rules.onPlaced(wall,'owner',0);
 assert.ok(spikeTriggerContains(wall.prefab,new Vector3(0,0.8,0)));assert.ok(!spikeTriggerContains(wall.prefab,new Vector3(0,0.8,3)));
 const player={position:new Vector3(10,0.8,0.5)},far={position:new Vector3(30,0,0)};
 const hits=rules.spikeContacts(5,[player,far]);assert.deepEqual(hits.map(h=>[h.target,h.damage]),[[player,wall.spike.dmgPerTick]]);
 assert.equal(rules.spikeContacts(5.5,[player,far]).length,0);assert.equal(rules.spikeContacts(6,[player,far]).length,1);
 player.position.set(10,0.8,5);assert.equal(rules.spikeContacts(7,[player]).length,0);
});

test('spike wall triggers: the small wall is its 5.5 m capsule along X, the large wall its box',needsAssets, ()=>{
 const {d}=setup(),small=d.place(dkey('Spike Wall'),new Vector3(),q,0).prefab,large=d.place(dkey('Large Spike Wall'),new Vector3(20,0,0),q,0).prefab;
 const at=(p,x,y,z)=>spikeTriggerContains(p,new Vector3(x,y,z));
 // WoodSpikeWall CapsuleCollider r 1.25, height 5.5, direction 0, centre (0,0.8,0): end caps at x = ±1.5; +0.4 player radius.
 assert.ok(at(small,2.5,0.8,0),'past the old 1.65 m sphere, inside the capsule');assert.ok(at(small,3.1,0.8,0));assert.ok(!at(small,3.2,0.8,0));
 assert.ok(at(small,-1.5,0.8,1.6));assert.ok(!at(small,-1.5,0.8,1.7));assert.ok(at(small,0,2.4,0));assert.ok(!at(small,0,2.5,0));
 assert.ok(at(small,2.5,1.2,0.9));assert.ok(!at(small,2.9,0.8,1.2),'the rounded end');
 // LargeWoodSpikeWall BoxCollider 6.8 × 4.5 × 1.72 at (0.014, 2.25, 0).
 assert.ok(at(large,3.8,2.25,0));assert.ok(!at(large,3.85,2.25,0));assert.ok(at(large,0,2.25,1.2));assert.ok(!at(large,0,2.25,1.3));
});

test('placing a deployable does not touch its carrier; only a door use does',needsAssets, ()=>{
 const {s,d,rules}=setup();
 const f=s.place(skey('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),m=f.master;rules.onPlaced(f,undefined,0);
 const decay=rules.masterDecay(m),full=decay.delayRemaining;assert.ok(full>0);decay.delayRemaining=5;
 const box=d.place(dkey('Wood Storage Box'),new Vector3(0,0,0),q,100,f);rules.onPlaced(box,'me',100);
 assert.equal(box.carrier,f);assert.equal(decay.delayRemaining,5,'DeployableItemDataBlock.DoAction1 never calls Touched');
 const door=d.place(dkey('Wooden Door'),new Vector3(0,0,0),q,100,f);rules.onPlaced(door,'me',100);assert.equal(decay.delayRemaining,5);
 rules.touched(door,200);assert.equal(decay.delayRemaining,full,'BasicDoor.ToggleStateServer → DeployableObject.Touched');
});

test('decay rays use the first collision-world hit: decayProtector deployables shelter, doors (by tag id) close a wall',needsAssets, ()=>{
 const {s,d}=setup(),hits=[];const rules=new WorldRules({structures:s,deployables:d,random:()=>0,raycast:(o,dir,range)=>{hits.push({o:o.clone(),dir:dir.clone(),range});return next.shift()??null;}});let next=[];
 const box=d.place(dkey('Wood Storage Box'),new Vector3(3,1,4),q,0),shelter=d.place(dkey('Wood Shelter'),new Vector3(3,1,4),q,0),other=d.place(dkey('Wood Storage Box'),new Vector3(3,3,4),q,0);
 // EnvDecay.CanApplyDecayDamage: a 10 m ray up from 0.25 m above the object.
 next=[{deployed:shelter}];assert.equal(rules.sheltered(box),true);assert.deepEqual([hits[0].o.toArray(),hits[0].dir.toArray(),hits[0].range],[[3,1.25,4],[0,1,0],10]);
 next=[{deployed:other}];assert.equal(rules.sheltered(box),false,'a plain deployable overhead does not protect');
 next=[{terrain:true,structure:null,deployed:null}];assert.equal(rules.sheltered(box),false,'rock/terrain overhead: decays');
 next=[{structure:{}}];assert.equal(rules.sheltered(box),true);
 // StructureMaster.DoDecay: rays forward and back 25 m from 2.5 m up; each must hit a structure piece or a "Door"-tagged object.
 const wall={position:new Vector3(0,0,0),rotation:new Quaternion()},door=d.place(dkey('Wooden Door'),new Vector3(0,0,5),q,0);
 assert.equal(door.tag,DOOR_TAG);
 next=[{deployed:door},{structure:{}}];assert.equal(rules.wallSheltered(wall),true);
 next=[{deployed:other},{structure:{}}];assert.equal(rules.wallSheltered(wall),false,'a box tag 20007 is not a door');
 next=[{structure:{}},{deployed:null,terrain:true}];assert.equal(rules.wallSheltered(wall),false);
 next=[{deployed:{tag:'Door'}},{structure:{}}];assert.equal(rules.wallSheltered(wall),false,'tags are numeric ids');
});
