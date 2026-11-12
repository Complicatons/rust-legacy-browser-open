// Raiding rules (server TakeDamage/ProtectionTakeDamage, TimedExplosive, TimedGrenade, ExplosionHelper, StructureMaster,
// DeployableObject, TransCarrier, EnvDecay/DoDecay) and the client HealthDimmer, checked against the decompiled source
// and the recovered prefab data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion,Ray,Box3} from 'three';
import {TakeDamage,takeDamageData,LifeStatus,healthDimmerGrey,damageList} from '../browser/take-damage.mjs';
import {StructureSystem,StructureType as T} from '../browser/structures.mjs';
import {DeployableSystem,checkPlacement,nonVariantSphereCast} from '../browser/deployables.mjs';
import {WorldRules} from '../browser/world-rules.mjs';
import {explosionSurfaces,explosionDamage,grenadeHits,timedExplosiveHits,timedExplosivePoint,Damage} from '../browser/combat.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null;
const skey=n=>Object.keys(manifest.structures).find(k=>manifest.structures[k].item===n),dkey=n=>Object.keys(manifest.deployables).find(k=>manifest.deployables[k].item===n);
const prefabOf=n=>manifest.prefabs[(manifest.structures[skey(n)]??manifest.deployables[dkey(n)]).prefab];
const q=new Quaternion(),eyesAt=(x,z)=>new Ray(new Vector3(x,10,z),new Vector3(0,-1,0));
const close=(a,b,eps=1e-9)=>Math.abs(a-b)<=eps;
function setup(){const world={zones:[],system:null,raycast:()=>null,groundTerrainOnly:()=>true},log={hurt:[],killed:[],corpses:[]};
 const s=new StructureSystem(manifest,items,world,{onHurt:(c,e)=>log.hurt.push([c,e]),onKilled:c=>log.killed.push(c)});world.system=s;
 const d=new DeployableSystem(manifest,items,{rng:()=>0.5,onHurt:(o,e)=>log.hurt.push([o,e]),onKilled:(o,k)=>log.killed.push({o,...k}),spawnCorpse:(key,p,r)=>log.corpses.push({key,p,r})});
 return {s,d,log};}
// Foundation, four corner pillars, wall (-z), doorway (+z) with a door on its hardpoint and a ceiling: the check-browser hut.
function hut(){const {s,d,log}=setup(),f=s.place(skey('Wood Foundation'),eyesAt(0,0),new Vector3(0,-3.5,0),q,null),m=f.master,at=(x,y,z)=>m.world(new Vector3(x,y,z));
 const pillars=[[2.5,2.5],[-2.5,2.5],[2.5,-2.5],[-2.5,-2.5]].map(([x,z])=>s.place(skey('Wood Pillar'),eyesAt(50,50),at(x,4,z),q,m));
 const wall=s.place(skey('Wood Wall'),eyesAt(50,50),at(0,4,-2.5),q,m),doorway=s.place(skey('Wood Doorway'),eyesAt(50,50),at(0,4,2.5),q,m);
 const ceiling=s.place(skey('Wood Ceiling'),eyesAt(50,50),at(0,4,0),q,m);
 const door=d.place(dkey('Wooden Door'),doorway.hardpoints[0].position,doorway.hardpoints[0].rotation,0,doorway);
 return {s,d,log,m,f,pillars,wall,doorway,ceiling,door,at};}

test('TakeDamage: armour scales each type by Clamp01(1 - armor/200); the list is summed into one event; health points skip armour',()=>{
 const td=new TakeDamage({maxHealth:1000,armor:[0,200,150,50,0,0]});
 let e=td.hurt([10,100,100,100,0,0]);assert.equal(e.status,LifeStatus.IsAlive);assert.ok(close(e.amount,10+0+25+75));assert.equal(e.flags,1|4|8,'bullet scaled to 0 sets no flag');assert.ok(close(td.health,890));
 e=td.hurt(500);assert.ok(close(e.amount,500));assert.ok(close(td.health,390),'HurtSelf(float) = health points, armour ignored');
 // health > amount stays alive; otherwise WasKilled with health 0, then IsDead without change.
 e=td.hurt(damageList(390,0));assert.equal(e.status,LifeStatus.WasKilled);assert.equal(td.health,0);
 e=td.hurt(damageList(5,0));assert.equal(e.status,LifeStatus.IsDead);assert.equal(td.health,0);
 const exact=new TakeDamage({maxHealth:100});assert.equal(exact.hurt(100).status,LifeStatus.WasKilled,'health == amount kills');
 // A plain TakeDamage has no armour: every type lands in full.
 const plain=new TakeDamage({maxHealth:500,armor:null});assert.equal(plain.hurt([0,40,40,40,0,0]).amount,120);
 // Awake clamps the max health to >= 0.001; HealthDimmer greys.
 assert.equal(new TakeDamage({maxHealth:0}).maxHealth,0.001);
 assert.ok(close(healthDimmerGrey(0.5,1,true),0.675));assert.ok(close(healthDimmerGrey(0,1,true),0.35));assert.ok(close(healthDimmerGrey(0,1,false),0.33));assert.ok(close(healthDimmerGrey(1,0.9,false),0.9));
});

// Recovered TakeDamage per prefab: [component, maxHealth, armour generic/bullet/melee/explosion/radiation/cold].
const PROFILE={
 'Wood Foundation':['P',2500,[0,200,200,200,200,200]],'Metal Foundation':['P',5000,[0,200,200,200,200,200]],
 'Wood Pillar':['P',5000,[0,200,200,200,200,200]],'Metal Pillar':['P',5000,[0,200,200,200,200,200]],
 'Wood Ceiling':['P',1000,[0,200,200,200,200,200]],'Metal Ceiling':['P',1000,[0,200,200,200,200,200]],
 'Wood Wall':['P',1000,[0,200,200,0,200,200]],'Metal Wall':['P',2000,[0,200,200,0,200,200]],
 'Wood Doorway':['P',1000,[0,200,200,0,200,200]],'Metal Doorway':['P',2000,[0,200,200,0,200,200]],
 'Wood Window':['P',1000,[0,200,200,0,200,200]],'Metal Window':['P',2000,[0,200,200,0,200,200]],
 'Wood Stairs':['P',1000,[0,200,50,0,200,200]],'Metal Stairs':['P',1000,[0,200,50,0,200,200]],
 'Wood Ramp':['P',1000,[0,200,160,0,200,200]],'Metal Ramp':['P',1000,[0,200,160,0,200,200]],
 'Wooden Door':['P',500,[200,200,180,0,200,200]],'Metal Door':['P',1000,[200,200,200,0,200,200]],
 'Wood Gate':['P',1800,[200,200,150,0,200,200]],'Wood Gateway':['P',2000,[200,200,200,50,200,200]],
 'Metal Window Bars':['P',2000,[200,200,200,0,200,200]],'Wood Shelter':['P',1000,[200,200,180,0,200,200]],
 'Spike Wall':['P',750,[200,200,100,0,0,0]],'Large Spike Wall':['P',1500,[200,200,150,0,0,0]],
 'Workbench':['P',1000,[50,50,0,0,200,200]],'Wood Barricade':['P',1000,[50,50,0,0,200,200]],
 'Wood Storage Box':['T',500],'Large Wood Storage':['T',1000],'Small Stash':['T',100],'Furnace':['T',500],'Camp Fire':['T',500],
 'Repair Bench':['T',1000],'Sleeping Bag':['T',500],'Bed':['T',500],
};
test('every structure piece and deployable keeps its recovered health and armour; who can hurt what',needsAssets,()=>{
 for(const [name,[kind,max,armor]] of Object.entries(PROFILE)){const td=takeDamageData(prefabOf(name));
  assert.equal(td.kind,kind==='P'?'ProtectionTakeDamage':'TakeDamage',name);assert.equal(td.maxHealth,max,name);assert.deepEqual(td.armor,armor??null,name);}
 assert.equal(takeDamageData(prefabOf('Explosive Charge')),null,'the charge has no TakeDamage: explosions cannot set it off or destroy it');
 const hit=(name,type,amount=100)=>new TakeDamage(takeDamageData(prefabOf(name))).hurt(damageList(amount,type)).amount;
 // Pillars, foundations and ceilings take nothing but generic damage (decay); walls/doorways/windows only explosions.
 for(const n of ['Wood Pillar','Metal Foundation','Wood Ceiling'])for(const t of [Damage.Bullet,Damage.Melee,Damage.Explosion])assert.equal(hit(n,t),0,n+' '+t);
 for(const n of ['Wood Wall','Metal Doorway','Wood Window']){assert.equal(hit(n,Damage.Bullet),0);assert.equal(hit(n,Damage.Melee),0);assert.equal(hit(n,Damage.Explosion),100);}
 assert.equal(hit('Wood Stairs',Damage.Melee),75);assert.ok(close(hit('Wood Ramp',Damage.Melee),20));assert.ok(close(hit('Wooden Door',Damage.Melee),10));assert.equal(hit('Metal Door',Damage.Melee),0);
 assert.equal(hit('Wood Gateway',Damage.Explosion),75);assert.equal(hit('Wood Gate',Damage.Melee),25);assert.equal(hit('Workbench',Damage.Bullet),75);assert.equal(hit('Spike Wall',Damage.Melee),50);
 assert.equal(hit('Wood Storage Box',Damage.Bullet),100,'plain TakeDamage: bullets and melee land in full');
 // Explosive charges (600, the carrier takes it all) needed per piece as the carrier.
 const charges=n=>{const td=new TakeDamage(takeDamageData(prefabOf(n)));for(let i=1;i<=20;i++)if(td.hurt(damageList(600,Damage.Explosion)).status===LifeStatus.WasKilled)return i;return Infinity;};
 assert.deepEqual(Object.fromEntries(['Wood Wall','Metal Wall','Wood Doorway','Metal Doorway','Wood Window','Metal Window','Wooden Door','Metal Door','Wood Gate','Wood Gateway','Wood Stairs','Wood Ramp','Wood Pillar','Wood Foundation','Wood Ceiling','Large Spike Wall','Wood Storage Box','Large Wood Storage'].map(n=>[n,charges(n)])),
  {'Wood Wall':2,'Metal Wall':4,'Wood Doorway':2,'Metal Doorway':4,'Wood Window':2,'Metal Window':4,'Wooden Door':1,'Metal Door':2,'Wood Gate':3,'Wood Gateway':5,'Wood Stairs':2,'Wood Ramp':2,
   'Wood Pillar':Infinity,'Wood Foundation':Infinity,'Wood Ceiling':Infinity,'Large Spike Wall':3,'Wood Storage Box':1,'Large Wood Storage':2});
});

test('explosions: falloff to each collider bounds centre, 10% when occluded, one surface per object (unblocked, nearest)',needsAssets,()=>{
 const box=(x,id,h=2)=>({id,bounds:new Box3(new Vector3(x-0.5,0,-0.5),new Vector3(x+0.5,h,0.5))});
 // Two colliders of one object: the unblocked one wins even when farther.
 const a1=box(1,'a'),a2={...box(2,'a'),bounds:new Box3(new Vector3(1.5,0,-0.5),new Vector3(2.5,2,0.5))};
 const s=explosionSurfaces(new Vector3(0,1,0),6,[a1,a2],(p,d,dist,t)=>t===a1);assert.equal(s.length,1);assert.equal(s[0].target,a2);assert.equal(s[0].blocked,false);
 // Linear falloff from the blast point to the bounds centre, x0.1 when blocked; nothing past the radius.
 assert.ok(close(explosionDamage({distance:1.5,blocked:false},6,120),90));assert.ok(close(explosionDamage({distance:1.5,blocked:true},6,120),9));
 assert.deepEqual(grenadeHits(new Vector3(0,1,0),6,120,[box(7,'far')],null),[]);
 // A blast inside the bounds: distance 0 => full damage, never occluded.
 const inside=grenadeHits(new Vector3(0,1,0),6,120,[box(0,'in')],()=>true);assert.ok(close(inside[0].damage,120));assert.equal(inside[0].blocked,false);
 // TimedGrenade skips <= 0.0001; TimedExplosive hurts every surface (zero included) and adds the carrier at full damage.
 const edge={id:'edge',bounds:new Box3(new Vector3(5.9999995,0.5,-0.0000001),new Vector3(6.0000005,1.5,0.0000001))};
 assert.equal(grenadeHits(new Vector3(0,1,0),6,120,[edge],null).length,0);assert.equal(timedExplosiveHits(new Vector3(0,1,0),6,120,[edge],null,null).length,1);
 const wall=box(0.6,'wall'),near=box(-1.6,'near'),hits=timedExplosiveHits(new Vector3(0,1,0),3,600,[wall,near],()=>true,'wall');
 assert.deepEqual(hits.map(h=>[h.target.id,Boolean(h.carrier)]),[['near',false],['wall',true]]);assert.equal(hits[1].damage,600,'carrier: full damage, never occluded');
 assert.ok(close(hits[0].damage,(1-1.6/3)*600*0.1));assert.equal(hits[1].types[Damage.Explosion],600);
 // Explode()'s point: the disabled collider has empty bounds, so TransformPoint(0, 0, 0.1).
 const r=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);assert.ok(timedExplosivePoint(new Vector3(1,2,3),r).distanceTo(new Vector3(1.1,2,3))<1e-9);
 const te=manifest.prefabs[';explosive_charge'].components.TimedExplosive[0].data;assert.deepEqual([te.fuseLength,te.explosionRadius,te.damage],[5,3,600]);
});

test('weight links: generated when a piece is appended (pillar->foundation/ceiling/pillar below, wall/ceiling/stairs->pillars, ramp->below)',needsAssets,()=>{
 const {s,m,f,pillars,wall,doorway,ceiling,at}=hut();
 for(const p of pillars){assert.ok(m.weightOnMe.get(f).has(p),'foundation carries its corner pillars');assert.ok(m.hasWeightOn.get(p).has(f));}
 assert.deepEqual([...m.hasWeightOn.get(wall)].sort((a,b)=>a.position.x-b.position.x),[pillars[3],pillars[2]],'a wall rests on the pillars at both ends (not the foundation)');
 assert.equal(m.hasWeightOn.get(doorway).size,2);assert.equal(m.hasWeightOn.get(ceiling).size,4);
 assert.ok(m.carryingWeight(f)&&pillars.every(p=>m.carryingWeight(p))&&!m.carryingWeight(wall)&&!m.carryingWeight(ceiling));
 // A pillar on the ceiling's corner links to the pillar below and to the ceiling (9 cells at y-4); the ceiling now carries weight.
 const upper=s.place(skey('Wood Pillar'),eyesAt(50,50),at(2.5,8,2.5),q,m);assert.ok(m.weightOnMe.get(pillars[0]).has(upper));assert.ok(m.weightOnMe.get(ceiling).has(upper));assert.ok(m.carryingWeight(ceiling));
 // Links are never regenerated: a pillar added after the ceiling does not carry it.
 upper.kill();assert.equal(m.carryingWeight(ceiling),false);
});

test('destroying a load-bearing piece collapses nothing: the server only removes that piece, its links and what it carries',needsAssets,()=>{
 const {s,d,log,m,f,pillars,wall,doorway,ceiling,door}=hut();const before=s.components.size;
 // A pillar under the ceiling and a wall (only an admin/Kill can do this: armour 200 against bullets, melee and explosions).
 const p=pillars[0];assert.equal(p.hurt(1e6,Damage.Explosion),0);assert.ok(!p.destroyed);
 p.hurt(Infinity);assert.ok(p.destroyed);assert.deepEqual(log.killed,[p],'StructureComponent.OnKilled once');assert.equal(s.components.size,before-1);
 assert.ok(!ceiling.destroyed&&!doorway.destroyed&&!wall.destroyed&&!door.destroyed,'nothing falls');assert.equal(ceiling.health,ceiling.maxHealth);
 assert.equal(m.hasWeightOn.get(ceiling).size,3,'RemoveLinkForComp drops the dead pillar from the ceiling');assert.equal(m.hasWeightOn.get(doorway).size,1);assert.ok(!m.weightOnMe.has(p)&&!m.hasWeightOn.has(p));
 assert.ok(m.weightOnMe.get(f).size===3);
 // The foundation itself: the pillars stay where they are (floating), the master survives while any piece remains.
 f.hurt(Infinity);assert.ok(f.destroyed);assert.ok(pillars.slice(1).every(x=>!x.destroyed));assert.equal(s.masters.size,1);assert.ok(!m.weightOnMe.has(f));
 for(const c of [...s.components])c.hurt(Infinity);assert.equal(s.masters.size,0,'master goes with its last piece');
 assert.ok(door.destroyed,'the door went with its doorway (carrier)');
});

test('doors, doorways and charges: carrier full damage, door corpse and death effect, carried objects destroyed silently, no loot spill',needsAssets,()=>{
 const {s,d,log,doorway,door}=hut();
 // A charge stuck on the door: the door is its TransCarrier.
 const charge=d.place(dkey('Explosive Charge'),door.position.clone().add(new Vector3(0,1,0.2)),q,0,door);assert.ok(door.carried.has(charge));
 assert.equal(charge.hurt(1000,Damage.Explosion),0,'no TakeDamage: charges are immune');assert.ok(!charge.destroyed);
 // 600 to the carrier: the 500 hp wooden door dies -> Client_OnKilled effect, WoodDoor_Corpse, and the charge it carried is destroyed.
 const other=d.place(dkey('Explosive Charge'),door.position.clone(),q,0,door);door.hurt([0,0,0,600,0,0]);
 assert.ok(door.destroyed&&other.destroyed&&charge.destroyed);const k=log.killed.find(x=>x.o===door);
 assert.equal(k.deathEffect,manifest.prefabs[';deploy_wood_door'].components.DeployableObject[0].deathEffect);assert.equal(manifest.prefabs[k.corpse].name,'WoodDoor_Corpse');
 assert.equal(log.corpses.length,1);assert.equal(log.corpses[0].key,k.corpse);assert.ok(log.corpses[0].p.equals(door.position));assert.ok(!doorway.carried.has(door));
 // A metal door: two charges (1000 hp, explosion armour 0), MetalDoor_Corpse, no clientDeathEffect.
 const metal=d.place(dkey('Metal Door'),doorway.hardpoints[0].position,doorway.hardpoints[0].rotation,0,doorway);
 metal.hurt(600,Damage.Explosion);assert.equal(metal.health,400);metal.hurt(600,Damage.Explosion);assert.ok(metal.destroyed);
 const mk=log.killed.find(x=>x.o===metal);assert.equal(mk.deathEffect,null);assert.equal(manifest.prefabs[mk.corpse].name,'MetalDoor_Corpse');
 // The doorway carrying a door: the door is NetCull.Destroyed with it (OnDroppedFromCarrier) - no corpse, no effect.
 const door2=d.place(dkey('Wooden Door'),doorway.hardpoints[0].position,doorway.hardpoint?.rotation??q,0,doorway),killedBefore=log.killed.length,corpsesBefore=log.corpses.length;
 doorway.hurt(600,Damage.Explosion);doorway.hurt(600,Damage.Explosion);assert.ok(doorway.destroyed&&door2.destroyed);assert.equal(log.killed.length,killedBefore+1,'only the doorway reports OnKilled');assert.equal(log.corpses.length,corpsesBefore);
 // Containers lose their contents with them: nothing is dropped (no DropHelper call outside a player's death).
 const box=d.place(dkey('Wood Storage Box'),new Vector3(10,0,0),q,0);box.slots[0]={item:Object.keys(items)[0],uses:1};box.hurt(600,Damage.Explosion);assert.ok(box.destroyed);assert.equal(d.objects.has(box),false);
 assert.equal(log.killed.find(x=>x.o===box).corpse,null);
 // Metal Window Bars have handleDeathHere off: at 0 health they stay (no other OnKilled receiver on the prefab).
 const bars=d.place(dkey('Metal Window Bars'),new Vector3(20,0,0),q,0);for(let i=0;i<4;i++)bars.hurt(600,Damage.Explosion);
 assert.equal(bars.health,0);assert.equal(bars.dead,true);assert.equal(bars.destroyed,false);assert.ok(d.objects.has(bars));assert.equal(bars.hurt(600,Damage.Explosion),600);assert.equal(bars.lastHurt.status,LifeStatus.IsDead);
});

test('one blast killing a doorway and the door it carries: DelayedKill keeps the doorway until the door has died (corpse kept)',needsAssets,()=>{
 const {s,d,log,doorway}=hut(),metal=d.place(dkey('Metal Door'),doorway.hardpoints[0].position,doorway.hardpoints[0].rotation,0,doorway);
 metal.hurt(600,Damage.Explosion);doorway.hurt(500,Damage.Explosion);
 // TimedExplosive order: falloff surfaces first (the doorway), the carrier (the door) last.
 s.deferring(()=>{doorway.hurt(540,Damage.Explosion);assert.ok(doorway.dying&&!doorway.destroyed,'dead, still standing this frame');metal.hurt(600,Damage.Explosion);});
 assert.ok(doorway.destroyed&&metal.destroyed);assert.equal(log.corpses.length,1,'the door died from the blast, so its corpse spawns');
 assert.deepEqual(log.killed.map(k=>k.o?.prefab.name??k.prefab.name),['MetalDoor','WoodDoorFrame']);
 // Without the blast ordering (doorway gone first) the door would only have been dropped: no corpse.
 const h=hut(),m2=h.d.place(dkey('Metal Door'),h.doorway.hardpoints[0].position,h.doorway.hardpoints[0].rotation,0,h.doorway);h.doorway.hurt(Infinity);assert.ok(m2.destroyed);assert.equal(h.log.corpses.length,0);
});

test('Explosive Charge carrier: AdjustedRay when the sphere-cast point is off the aim ray',needsAssets,()=>{
 const e=manifest.deployables[dkey('Explosive Charge')];assert.equal(e.placement.carrierSphereCastMode,1);assert.equal(e.placement.neverGrabCarrier,1);
 const prefab=manifest.prefabs[e.prefab],wall={prefab:{components:{TransCarrier:[{}]}},carried:new Set(),name:'wall'},grazed={prefab:{components:{TransCarrier:[{}]}},carried:new Set(),name:'grazed'};
 const ray=new Ray(new Vector3(0,1.5,0),new Vector3(0,0,1));
 // The 0.15 m sphere grazes a door edge 0.1 m beside the ray; the thin ray along origin->hit point reaches the wall behind it.
 const world={zones:[],deployedNear:()=>null,fit:()=>true,cast(r,range,radius){if(radius>0)return {point:new Vector3(0.1,1.5,1.2),normal:new Vector3(0,0,-1),deployed:grazed,structure:null};
  return {point:new Vector3(0.12,1.5,1.5),normal:new Vector3(0,0,-1),deployed:wall,structure:null};}};
 assert.equal(nonVariantSphereCast(ray,new Vector3(0.1,1.5,1.2)),false);assert.equal(nonVariantSphereCast(ray,new Vector3(0,1.5,1.2)),true);
 assert.equal(checkPlacement(e,prefab,ray,world).carrier,wall);
 const onRay={...world,cast:(r,range,radius)=>({point:new Vector3(0,1.5,1.2),normal:new Vector3(0,0,-1),deployed:grazed,structure:null})};assert.equal(checkPlacement(e,prefab,ray,onRay).carrier,grazed);
});

test('decay after a raid: health points ignore armour (doors decay), load-bearing pieces spared by the exact weight links',needsAssets,()=>{
 const {s,d,m,f,pillars,wall,ceiling,door}=hut(),rules=new WorldRules({structures:s,deployables:d,random:()=>0.5});
 // A free-standing door (no carrier): EnvDecay's HurtSelf(float) gets through its generic armour 200.
 const own=setup(),freeRules=new WorldRules({structures:own.s,deployables:own.d,random:()=>0.5});
 const free=own.d.place(dkey('Metal Door'),new Vector3(30,0,0),q,0);freeRules.onPlaced(free,'me',0);free.hurt(600,Damage.Explosion);assert.equal(free.health,400);
 free.decay.lastDecayThink=0;freeRules.tick(300);assert.ok(close(free.health,400-300/43200*1000*(manifest.prefabs[';deploy_metal_door'].components.EnvDecay[0].data.decayMultiplier)),String(free.health));
 // Structures: the hut is past its 48 h wood delay; the damaged wall keeps decaying from its reduced health, pillars carrying weight do not.
 for(const c of s.components)rules.onPlaced(c,undefined,0);wall.hurt(600,Damage.Explosion);
 rules.tick(1);rules.tick(172800+2200);
 assert.ok(wall.health<400,'wall decays on top of the raid damage');assert.ok(pillars.every(p=>p.health===p.maxHealth));assert.equal(f.health,f.maxHealth);
 assert.ok(ceiling.health<ceiling.maxHealth,'a ceiling with nothing on it decays');
 // Kill a pillar: the ceiling keeps decaying, the remaining pillars still carry it.
 pillars[0].hurt(Infinity);assert.ok(rules.carryingWeight(pillars[1])&&!rules.carryingWeight(ceiling));
});
