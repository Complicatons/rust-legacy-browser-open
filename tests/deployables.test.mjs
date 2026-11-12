import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion,Ray,Matrix4,PerspectiveCamera} from 'three';
import {DeployableSystem,checkPlacement,campfireSlotFlags,deployableKind,canPlace} from '../browser/deployables.mjs';
import {ParticleEffect,evalCurve,evalGradient,unpack} from '../browser/particles.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null,key=name=>Object.keys(manifest.deployables).find(k=>manifest.deployables[k].item===name),itemKey=name=>Object.keys(items).find(k=>items[k].data.m_Name===name);
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
const system=()=>new DeployableSystem(manifest,items,{rng:seeded(3)});
const entry=name=>manifest.deployables[key(name)],prefab=name=>manifest.prefabs[entry(name).prefab];
const slot=(name,uses)=>({item:itemKey(name),uses,condition:1});
// Flat ground at y=0 (or tilted by `slope` degrees); the ray looks down at 45 degrees from 1.6 m.
function flatWorld({slope=0,near=null,zones=[],deployed=null,fit=true}={}){const n=new Vector3(Math.sin(slope*Math.PI/180),Math.cos(slope*Math.PI/180),0);
 return {zones,deployedNear:()=>near,fit:()=>fit,cast(ray,range){const t=-ray.origin.y/ray.direction.y;if(!(t>0)||t>range)return null;return {point:ray.origin.clone().addScaledVector(ray.direction,t),normal:n,terrain:true,layer:0,deployed,structure:null};}};}
const look=new Ray(new Vector3(0,1.6,0),new Vector3(0,-1,1).normalize());

test('all 19 original deployable items and 16 structure pieces are exported with their prefabs',needsAssets,()=>{
 assert.equal(Object.keys(manifest.deployables).length,19);assert.equal(Object.keys(manifest.structures).length,16);
 for(const d of Object.values(manifest.deployables))assert.ok(manifest.prefabs[d.prefab],d.item);
 assert.equal(deployableKind(prefab('Camp Fire')),'campfire');assert.equal(deployableKind(prefab('Furnace')),'furnace');assert.equal(deployableKind(prefab('Wood Storage Box')),'storage');
 assert.equal(deployableKind(prefab('Sleeping Bag')),'respawn');assert.equal(deployableKind(prefab('Bed')),'respawn');assert.equal(deployableKind(prefab('Workbench')),'workbench');
 assert.equal(entry('Camp Fire').placement.placeRange,8);assert.equal(entry('Camp Fire').placement.spacingRadius,1);
});

test('placement: valid on flat ground, rejected on slopes past maxSlope, near same-tag deployables, in no-placement zones and on nothing',needsAssets,()=>{
 const e=entry('Camp Fire'),p=prefab('Camp Fire');
 const ok=checkPlacement(e,p,look,flatWorld());assert.ok(ok.valid,JSON.stringify(ok.results));assert.ok(Math.abs(ok.position.z-1.6)<1e-6);
 assert.ok(checkPlacement(e,p,look,flatWorld({slope:20})).valid);
 assert.ok(checkPlacement(e,p,look,flatWorld({slope:45})).results.falseFromAngle);
 assert.ok(checkPlacement(e,p,look,flatWorld({near:{}})).results.falseFromClose);
 const sky=new Ray(new Vector3(0,1.6,0),new Vector3(0,1,0));assert.ok(checkPlacement(e,p,sky,flatWorld()).results.falseFromHittingNothing);
 const zoned=entry('Wood Storage Box');if(zoned.placement.checkPlacementZones)assert.ok(checkPlacement(zoned,prefab('Wood Storage Box'),look,flatWorld({zones:[{position:new Vector3(0,0,1.6),radius:5}]})).results.falseFromPlacementZone);
 // Stacking: placing on another deployable needs CanStackOnDeployables and a target without cantPlaceOn.
 const onBox=checkPlacement(e,p,look,flatWorld({deployed:{cantPlaceOn:true}}));assert.ok(onBox.results.falseFromDeployable);
});

test('camp fire: one wood per 60 s cycle, +3 charcoal, cooks up to two raw items into the matching output slot, stops without fuel',needsAssets,()=>{
 const s=system(),o=s.place(key('Camp Fire'),new Vector3(),new Quaternion(),0);assert.equal(o.slots.length,8);assert.deepEqual(o.fire.menu(),['Open']);
 // CampfireInventory slot flags: raw meat only in 3-5, wood only in 6.
 assert.ok(o.fire.accepts(3,items[itemKey('Raw Chicken Breast')].data));assert.ok(!o.fire.accepts(6,items[itemKey('Raw Chicken Breast')].data));assert.ok(o.fire.accepts(6,items[itemKey('Wood')].data));
 assert.equal(campfireSlotFlags.length,8);
 o.slots[6]=slot('Wood',2);o.slots[3]=slot('Raw Chicken Breast',3);
 assert.equal(o.fire.quick(0),'ignited');const first=o.fire.nextFuel;assert.ok(first>=30&&first<=60,first);
 s.update(first);assert.equal(o.slots[6].uses,1);assert.equal(o.slots[7].uses,3);assert.equal(o.slots[0].uses,2);assert.equal(items[o.slots[0].item].data.m_Name,'Cooked Chicken Breast');assert.equal(o.slots[3].uses,1);
 // The last wood burns and cooks the remaining single breast (Mathf.Min(2, uses)); the fire goes out with no fuel.
 s.update(first+60);assert.equal(o.slots[6],null);assert.equal(o.slots[7].uses,6);assert.equal(o.slots[3],null);assert.equal(o.slots[0].uses,3);assert.equal(o.fire.isOn,false);
});

test('furnace: two wood per 30 s cycle, +5 charcoal, smelts each ore type at temperature 5',needsAssets,()=>{
 const s=system(),o=s.place(key('Furnace'),new Vector3(),new Quaternion(),0);assert.equal(o.fire.myTemp,5);assert.equal(o.slots.length,9);
 o.slots[0]=slot('Wood',10);o.slots[1]=slot('Metal Ore',10);o.slots[2]=slot('Sulfur Ore',10);o.fire.trySetOn(true,0);s.update(o.fire.nextFuel);
 const by=n=>o.slots.find(x=>x&&items[x.item].data.m_Name===n)?.uses??0;
 assert.equal(by('Wood'),8);assert.equal(by('Charcoal'),5);assert.equal(by('Metal Ore'),8);assert.equal(by('Sulfur Ore'),8);assert.ok(by('Metal Fragments')>0);assert.ok(by('Sulfur')>0);
});

test('heat and work zones: warm only near a lit fire; workbench zone enables bench recipes',needsAssets,()=>{
 const s=system(),fire=s.place(key('Camp Fire'),new Vector3(10,0,0),new Quaternion(),0),bench=s.place(key('Workbench'),new Vector3(-10,0,0),new Quaternion(),0);
 assert.ok(!s.warm(new Vector3(10.5,0.5,0)));fire.slots[6]=slot('Wood',5);fire.fire.trySetOn(true,0);assert.ok(s.warm(new Vector3(10.5,0.5,0)));assert.ok(!s.warm(new Vector3(40,0,0)));
 assert.ok(s.atWorkbench(new Vector3(-10.5,0.5,0)));assert.ok(!s.atWorkbench(new Vector3(30,0,0)));assert.equal(bench.kind,'workbench');
});

test('work and heat zones count the server player 0.5 m root sphere, not only the feet',needsAssets,()=>{
 const s=system(),bench=s.place(key('Workbench'),new Vector3(0,0,0),new Quaternion(),0),z=bench.zones.find(z=>z.kinds.includes('WorkZone'));
 assert.ok(Math.abs(z.radius-1.5)<1e-6);const reach=Math.sqrt((z.radius+0.5)**2-z.center.y**2);
 // 1.5 m out on the ground: outside the 1.5 m sphere for the feet alone, inside once the player's sphere is added.
 assert.ok(s.atWorkbench(new Vector3(1.5,0,0)));assert.ok(s.atWorkbench(new Vector3(reach-0.01,0,0)));assert.ok(!s.atWorkbench(new Vector3(reach+0.01,0,0)));
});

test('sleeping bags: 240 s cooldown after a camp spawn, applied to bags within 100 m; newest valid bag first',needsAssets,()=>{
 const s=system(),a=s.place(key('Sleeping Bag'),new Vector3(0,0,0),new Quaternion(),0),b=s.place(key('Sleeping Bag'),new Vector3(50,0,0),new Quaternion(),0),far=s.place(key('Sleeping Bag'),new Vector3(500,0,0),new Quaternion(),0);
 const first=s.campSpawn(10);assert.equal(first.object,far);assert.ok(Math.abs(first.position.y-0.25)<1e-6);
 const second=s.campSpawn(11);assert.equal(second.object,b);assert.ok(!a.canSpawn(11));assert.equal(Math.round(a.cooldown(11)),240);
 assert.equal(s.campSpawn(12),null);assert.ok(a.canSpawn(11+240.5));
 // Beds need a structure overhead (Bed.IsValidToSpawn) and use a 180 s delay.
 const bed=s.place(key('Bed'),new Vector3(900,0,0),new Quaternion(),0);assert.equal(bed.spawnDelay,180);assert.ok(!bed.canSpawn(1000));s.roofed=()=>true;assert.ok(bed.canSpawn(1000));
});

test('deployables take damage through their recovered TakeDamage health and are removed at zero',needsAssets,()=>{
 const s=system(),o=s.place(key('Wood Storage Box'),new Vector3(),new Quaternion(),0);assert.ok(o.maxHealth>0);
 o.hurt(o.maxHealth+1);assert.ok(o.destroyed);assert.equal(s.objects.size,0);
});

test('Shuriken subset: curves, packed colours and gradients evaluate like Unity; the camp fire emits while lit',needsAssets,()=>{
 assert.equal(evalCurve({m_Curve:[{time:0,value:1,inSlope:0,outSlope:0},{time:1,value:0,inSlope:0,outSlope:0}]},0.5),0.5);
 assert.deepEqual(unpack(0xff0000ff),[1,0,0,1]);
 const g={key0:{rgba:0xffffffff},key1:{rgba:0x00000000},ctime0:0,ctime1:65535,atime0:0,atime1:65535,m_NumColorKeys:2,m_NumAlphaKeys:2};assert.deepEqual(evalGradient(g,0.5).map(v=>+v.toFixed(2)),[0.5,0.5,0.5,0.5]);
 const p=prefab('Camp Fire'),ps=p.components.ParticleSystem.find(x=>p.nodes[x.node].name==='campfire'),r=p.components.ParticleSystemRenderer.find(x=>x.node===ps.node);
 const fx=new ParticleEffect(ps.data,r,manifest.materials[r.materials[0]],null,new Matrix4(),seeded(2));
 const camera=new PerspectiveCamera();camera.updateMatrixWorld();
 for(let i=0;i<30;i++)fx.update(1/30,true,new Matrix4(),camera);
 // Rate 50/s with a 0.5 s lifetime keeps about 25 flames alive; they all expire once emission stops.
 assert.ok(fx.particles.length>=20&&fx.particles.length<=30,fx.particles.length);
 for(let i=0;i<30;i++)fx.update(1/30,false,new Matrix4(),camera);assert.equal(fx.particles.length,0);
});

test('FireBarrel.InvItemRemoved: taking the last fuel out puts the fire out 0.25 s later (FuelRemoveCheck)',needsAssets,()=>{
 for(const name of ['Camp Fire','Furnace']){const s=system(),o=s.place(key(name),new Vector3(),new Quaternion(),0),fuel=name==='Camp Fire'?6:0;
  o.slots[fuel]=slot('Wood',10);o.fire.trySetOn(true,0);assert.equal(o.fire.isOn,true);s.update(1);
  // A non-fuel item leaving keeps it burning while fuel is left.
  o.slots[name==='Camp Fire'?3:1]=slot('Raw Chicken Breast',1);s.update(1.1);o.slots[name==='Camp Fire'?3:1]=null;s.update(1.2);s.update(1.5);assert.equal(o.fire.isOn,true,name);
  o.slots[fuel]=null;s.update(2);assert.equal(o.fire.isOn,true,'not before the 0.25 s invoke');s.update(2.24);assert.equal(o.fire.isOn,true);
  s.update(2.25);assert.equal(o.fire.isOn,false,name);assert.equal(o.fire.nextFuel,null);
  // Wood put back in time cancels nothing (CancelInvoke only restarts the check), but the check then finds fuel.
  o.slots[fuel]=slot('Wood',10);o.fire.trySetOn(true,3);o.slots[fuel]=null;s.update(3);o.slots[fuel]=slot('Wood',5);s.update(3.1);s.update(3.3);assert.equal(o.fire.isOn,true);}
});

test('DeployableItem.CanPlace: an invalid preview does nothing (no client notice, no place delay)',()=>{
 assert.equal(canPlace({attack:true,valid:false,now:10,nextPlaceTime:0,grounded:true}),false);
 assert.equal(canPlace({attack:true,valid:true,now:10,nextPlaceTime:0,grounded:true}),true);
 assert.equal(canPlace({attack:true,valid:true,now:10,nextPlaceTime:10.5,grounded:true}),false);
 assert.equal(canPlace({attack:true,valid:true,now:10,nextPlaceTime:0,grounded:false}),false);
 assert.equal(canPlace({attack:false,valid:true,now:10,nextPlaceTime:0,grounded:true}),false);
});
