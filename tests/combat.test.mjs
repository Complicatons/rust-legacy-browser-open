import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion,Box3} from 'three';
import {Recoil,GunState,BowState,ThrowState,Arrow,Grenade,heldItemPreFrame,aimSway,perlinNoise,pelletDirection,lookRotation,explosionSurfaces,grenadeHits,timedExplosiveHits,bulletDamage,wornArmor,tryConditionLoss,isBroken} from '../browser/combat.mjs';
import {LegacyInventory} from '../browser/inventory.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url)))):null;
const items=hasRecovered?(catalogue.items):null,keyOf=name=>Object.keys(items).find(k=>items[k].data.m_Name===name),data=name=>items[keyOf(name)].data;
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
function inventoryWith(entries){const inv=new LegacyInventory(catalogue);inv.slots=Array(40).fill(null);for(const [n,c] of entries)inv.add(keyOf(n),c);return inv;}
const gunSlot=name=>({item:keyOf(name),uses:data(name).maxClipAmmo,condition:1});
const ammoKey=name=>Object.keys(items).find(k=>k.endsWith(':'+data(name).ammoType.m_PathID));

test('recovered firearm stats: M4 30-40 dmg, 0.125 s, 24 rounds of 5.56; Shotgun 12 pellets x 15; Bolt Action 60-65 at 250 m',needsAssets,()=>{
 const m4=data('M4'),sg=data('Shotgun'),bolt=data('Bolt Action Rifle');
 assert.deepEqual([m4.damageMin,m4.damageMax,m4.fireRate,m4.maxClipAmmo,m4.isSemiAuto],[30,40,0.125,24,0]);assert.equal(items[ammoKey('M4')].data.m_Name,'556 Ammo');
 assert.deepEqual([sg.numPellets,sg.damageMin,sg.xSpread,sg.bulletRange],[12,15,5,30]);assert.equal(items[ammoKey('Shotgun')].data.m_Name,'Shotgun Shells');
 assert.deepEqual([bolt.damageMin,bolt.damageMax,bolt.bulletRange,bolt.NoAimingAfterShot],[60,65,250,1]);
 assert.ok(manifest.weapons[keyOf('M4')].sounds.fireSound);
});

test('automatic fire follows fireRate; semi-auto needs a fresh press; deploy and sprint delay shots',needsAssets,()=>{
 const m4=new GunState(data('M4'),ammoKey('M4')),slot=gunSlot('M4'),inv=inventoryWith([]);m4.activate(0);
 assert.equal(m4.frame(1.0,{attack:true},slot,inv,seeded(1)).length,0,'still deploying (1.4 s)');
 let shots=0;for(let t=1.5;t<2.5;t+=1/60)shots+=m4.frame(t,{attack:true},slot,inv,seeded(1)).filter(e=>e.type==='fire').length;assert.equal(shots,8);assert.equal(slot.uses,16);
 const p=new GunState(data('P250'),ammoKey('P250')),ps=gunSlot('P250');let semi=0;for(let t=2;t<3;t+=1/60)semi+=p.frame(t,{attack:true},ps,inv).filter(e=>e.type==='fire').length;assert.equal(semi,1);
 const sprint=new GunState(data('M4'),ammoKey('M4')),ss=gunSlot('M4');assert.equal(sprint.frame(5,{attack:true,sprinting:true},ss,inv).length,0);
 assert.equal(sprint.frame(5.05,{attack:true},ss,inv).length,0,'0.3 s after sprinting');assert.equal(sprint.frame(5.3,{attack:true},ss,inv).length,0);assert.equal(sprint.frame(5.36,{attack:true},ss,inv)[0].type,'fire');
});

test('HeldItem.ItemPreFrame: AltFire aims guns at 0.4 look sensitivity only when CanAim; the HandCannon never aims',needsAssets,()=>{
 for(const name of ['M4','MP5A4','P250','9mm Pistol','Revolver','Bolt Action Rifle','Shotgun','Pipe Shotgun'])
  assert.deepEqual(heldItemPreFrame(data(name),true,true),{aim:true,attack2:false,sensitivity:data(name).aimSensitivtyPercent},name);
 assert.equal(Math.fround(data('M4').aimSensitivtyPercent),Math.fround(0.4));
 assert.deepEqual(heldItemPreFrame(data('M4'),false,true),{aim:false,attack2:false,sensitivity:1});
 assert.deepEqual(heldItemPreFrame(data('HandCannon'),true,true),{aim:false,attack2:true,sensitivity:1},'secondaryFireAims 0');
 // BulletWeaponItem.CanAim: not while reloading, not before nextAimTime (Bolt Action NoAimingAfterShot), only once deployed.
 const g=new GunState(data('M4'),ammoKey('M4')),slot={...gunSlot('M4'),uses:0},inv=inventoryWith([['556 Ammo',30]]);g.activate(0);
 assert.equal(heldItemPreFrame(data('M4'),true,g.canAim(1)).aim,false,'deploying');assert.equal(heldItemPreFrame(data('M4'),true,g.canAim(2)).aim,true);
 g.frame(2,{reload:true},slot,inv);assert.deepEqual(heldItemPreFrame(data('M4'),true,g.canAim(2.5)),{aim:false,attack2:true,sensitivity:1},'reloading');
 const bolt=new GunState(data('Bolt Action Rifle'),ammoKey('Bolt Action Rifle')),bs=gunSlot('Bolt Action Rifle');bolt.activate(0);bolt.frame(5,{attack:true},bs,inv);
 assert.equal(heldItemPreFrame(data('Bolt Action Rifle'),true,bolt.canAim(5.5)).aim,false);assert.equal(heldItemPreFrame(data('Bolt Action Rifle'),true,bolt.canAim(5+data('Bolt Action Rifle').fireRate+0.01)).aim,true);
});

test('empty clip dry-fires once a second; reload moves ammo at once but blocks firing for reloadDuration',needsAssets,()=>{
 const g=new GunState(data('M4'),ammoKey('M4')),slot={...gunSlot('M4'),uses:0},inv=inventoryWith([['556 Ammo',30]]);
 assert.equal(g.frame(10,{attack:true},slot,inv)[0].type,'dryfire');assert.equal(g.frame(10.5,{attack:true},slot,inv).length,0);
 const r=g.frame(11,{reload:true},slot,inv);assert.deepEqual(r.map(e=>e.type),['reload']);assert.equal(slot.uses,24);assert.equal(inv.count(ammoKey('M4')),6);
 assert.equal(g.frame(13.9,{attack:true},slot,inv).length,0);assert.equal(g.frame(14.01,{attack:true},slot,inv)[0].type,'fire');
});

test('recoil eases in over its duration and sums to the kick; shotgun pellets spread within ±xSpread degrees',needsAssets,()=>{
 const r=new Recoil();r.add(0.2,5,-2);let p=0,y=0;for(let i=0;i<30;i++){const s=r.extract(0.01);p+=s.pitch;y+=s.yaw;}assert.ok(Math.abs(p-5)<1e-9&&Math.abs(y+2)<1e-9);
 const fwd=new Vector3(0,0,1);for(const s of [[5,5],[-5,0],[0,-5]]){const d=pelletDirection(fwd,s);assert.ok(Math.acos(d.z)*180/Math.PI<=Math.hypot(...s)+1e-6);}
 const q=lookRotation(new Vector3(1,0,0));assert.ok(new Vector3(0,0,1).applyQuaternion(q).distanceTo(new Vector3(1,0,0))<1e-9);
 const ev=new GunState(data('Shotgun'),ammoKey('Shotgun')).frame(5,{attack:true},gunSlot('Shotgun'),inventoryWith([]),seeded(4)).find(e=>e.type==='fire');assert.equal(ev.spread.length,12);assert.ok(ev.spread.every(([x,y])=>Math.abs(x)<=5&&Math.abs(y)<=5));
 assert.deepEqual(bulletDamage(30,{headshot:true,ai:true}),[0,240,0,0,0,0]);assert.ok(Math.abs(bulletDamage(30,{silenced:true})[1]-18)<1e-9,'server: GetDamage x0.8 then x0.75');
});

test('weapons wear: 33% chance of -1% per shot; broken weapons cannot be used',needsAssets,()=>{
 const slot={condition:0.005},d=data('M4');assert.ok(tryConditionLoss(slot,d,0.33,0.01,()=>0.1));assert.equal(slot.condition,0);assert.ok(isBroken(slot));
 const s2={condition:100};assert.ok(!tryConditionLoss(s2,d,0.33,0.01,()=>0.9));assert.ok(!isBroken(s2));
});

test('bow: hold to draw (2 s), release fires an arrow at 80 m/s; releasing early cancels; no arrows',needsAssets, ()=>{
 const bow=new BowState(data('Hunting Bow'),keyOf('Arrow')),inv=inventoryWith([['Arrow',2]]);bow.activate(0);
 assert.deepEqual(bow.frame(2,{attack:true},inv).events.map(e=>e.type),['draw']);bow.frame(4.1,{attack:true},inv);
 const fired=bow.frame(4.2,{attack:false},inv);assert.deepEqual(fired.events.map(e=>e.type),['fire']);assert.equal(fired.events[0].speed,80);assert.equal(inv.count(keyOf('Arrow')),1);
 bow.frame(6,{attack:true},inv);assert.deepEqual(bow.frame(6.5,{attack:false},inv).events.map(e=>e.type),['cancel']);
 const empty=new BowState(data('Hunting Bow'),keyOf('Arrow'));assert.deepEqual(empty.frame(5,{attack:true},inventoryWith([])).events.map(e=>e.type),['noarrows']);
});

test('arrows drop 5 degrees per second and stop at what they hit',()=>{
 const a=new Arrow(new Vector3(0,10,0),new Quaternion(),80);for(let i=0;i<60;i++)a.step(1/60,()=>null);
 assert.ok(a.position.z>79&&a.position.z<80.1);assert.ok(a.position.y<10&&a.position.y>10-80*Math.sin(5*Math.PI/180));
 const b=new Arrow(new Vector3(0,1,0),new Quaternion(),80);let hit=null;for(let i=0;i<60&&!hit;i++)hit=b.step(1/60,(ray,len)=>ray.origin.z+len>=10?{point:new Vector3(0,ray.origin.y,10)}:null);assert.equal(b.position.z,10);assert.ok(b.done);
});

test('grenades: pin pulled on Fire, thrown at 20 m/s after 1.25 s held; 3 s fuse; F1 blast 120 within 6 m',needsAssets,()=>{
 const g=new ThrowState(data('F1 Grenade'));g.activate(0);assert.deepEqual(g.frame(1,{attack:true}).map(e=>e.type),['pullpin']);assert.equal(g.frame(1.5,{attack:false}).length,0);
 assert.deepEqual(g.frame(2.3,{attack:false}),[{type:'throw',speed:20}]);
 const tg=manifest.prefabs[manifest.weapons[keyOf('F1 Grenade')].prefabs.throwObjectPrefab].components.TimedGrenade[0].data;assert.equal(tg.explosionRadius,6);assert.equal(tg.damage,120);
 const n=new Grenade(new Vector3(0,1,0),new Vector3(0,0,20));let boom=false,t=0;for(;t<5&&!boom;t+=0.01)boom=n.step(0.01,(c,r)=>c.y-r<0?{normal:new Vector3(0,1,0),depth:r-c.y}:null);
 assert.ok(Math.abs(t-3)<0.02);assert.ok(n.position.y>=0.12&&n.position.z>10&&n.position.z<60);
});

test('explosions: damage falls off linearly from the blast to each collider centre; blocked surfaces take 10%',needsAssets,()=>{
 const box=(x,id)=>({id,bounds:new Box3(new Vector3(x-0.5,0,-0.5),new Vector3(x+0.5,2,0.5))});
 const hits=grenadeHits(new Vector3(0,1,0),6,120,[box(1,'a'),box(3,'b'),box(7,'c')],(p,d,dist,t)=>t.id==='b');
 assert.deepEqual(hits.map(h=>h.target.id),['a','b']);assert.ok(Math.abs(hits[0].damage-100)<1e-9);assert.ok(Math.abs(hits[1].damage-6)<1e-9);assert.equal(hits[0].types[3],hits[0].damage);
 // Explosive charge: 600 within 3 m; the carrier wall takes the full 600, two charges break a 1000 hp wood wall.
 const te=manifest.prefabs[';explosive_charge'].components.TimedExplosive[0].data;assert.deepEqual([te.fuseLength,te.explosionRadius,te.damage],[5,3,600]);
 const wall=box(0.3,'wall'),charge=timedExplosiveHits(new Vector3(0,1,0),3,600,[wall,box(2,'near')],null,'wall');
 assert.equal(charge.find(h=>h.target.id==='wall').damage,600);assert.equal(charge.filter(h=>h.target.id==='wall').length,1);assert.ok(charge.find(h=>h.target.id==='near').damage<600);
});

test('worn armour sums the four equipment slots; slots only take matching armour',needsAssets,()=>{
 const inv=inventoryWith([['Kevlar Vest',1],['Kevlar Helmet',1],['Cloth Boots',1]]);const at=n=>inv.slots.findIndex(s=>s?.item===keyOf(n));
 assert.equal(inv.move(at('Kevlar Vest'),36),false,'vest is not a helmet');inv.move(at('Kevlar Helmet'),36);inv.move(at('Kevlar Vest'),37);inv.move(at('Cloth Boots'),39);
 assert.deepEqual(wornArmor(inv.slots,items),[0,63,63,35,0,25]);
});

test('Mathf.PerlinNoise (read from rust.exe): improved noise at z = 0 on |x|, |y|, then (n + 0.69) / 1.483',()=>{
 // Unity's well-known PerlinNoise(0, 0) and every lattice point: noise 0, so 0.69 / 1.483 as a float.
 for(const [x,y] of [[0,0],[1,0],[3,7],[255,256],[-12,40]])assert.equal(perlinNoise(x,y),Math.fround(Math.fround(0.69)/Math.fround(1.483)));
 assert.equal(perlinNoise(0,0).toFixed(7),'0.4652731');
 for(const [x,y] of [[0.3,1.7],[12.25,3.5],[100.9,0.01]])assert.equal(perlinNoise(-x,-y),perlinNoise(x,y),'mirrored at 0 (fabs)');
 let lo=Infinity,hi=-Infinity;for(let i=0;i<4000;i++){const v=perlinNoise(i*0.137,i*0.311);lo=Math.min(lo,v);hi=Math.max(hi,v);}assert.ok(lo<0.05&&lo>-0.2&&hi>0.95&&hi<1.15,`${lo} ${hi}`);
 assert.equal(perlinNoise(256.5,1.25),perlinNoise(0.5,1.25),'the lattice wraps at 256');
});
test('BulletWeaponItem.ItemPreFrame aim sway: (PerlinNoise - 0.5) * aimSway * (crouch 0.6) * dt while aiming',needsAssets,()=>{
 assert.equal(aimSway(data('M4'),{aim:false,crouch:false},10,0.02),null);assert.equal(aimSway(data('HandCannon'),{aim:true,crouch:false},10,0.02),null,'aimSway 0');
 const d=data('Bolt Action Rifle'),t=Math.fround(10*d.aimSwaySpeed),s=aimSway(d,{aim:true,crouch:false},10,0.02);assert.equal(d.aimSway,1.5);
 assert.ok(Math.abs(s.yaw-(perlinNoise(t,t)-0.5)*1.5*0.02)<1e-7);assert.ok(Math.abs(s.pitch-(perlinNoise(t+0.1,t+0.2)-0.5)*1.5*0.02)<1e-7);
 const c=aimSway(d,{aim:true,crouch:true},10,0.02);assert.ok(Math.abs(c.yaw-s.yaw*0.6)<1e-7);
 assert.ok(Math.abs(aimSway(d,{aim:true,crouch:false},10,0.04).yaw-2*s.yaw)<1e-7);
});
