// Modern island map geometry (tools/site-map.mjs): matrices, hulls, building footprints, place clustering, spawns, contours.
import test from 'node:test';
import assert from 'node:assert/strict';
import {transformPoint,convexHull,footprint,classifyBuilding,clusterPlaces,lootSpawns,spawnZones,noBuildZones,heightAt,contourSegments} from '../tools/site-map.mjs';

const near=(a,b,e=1e-6)=>Math.abs(a-b)<e;

test('transformPoint applies a column-major Unity matrix',()=>{
 // 90° about Y, then translate (10, 0, 20): (1,0,0) → (0,0,-1) → (10,0,19)
 const m=[0,0,-1,0, 0,1,0,0, 1,0,0,0, 10,0,20,1];
 const p=transformPoint(m,[1,0,0]);assert.ok(near(p[0],10)&&near(p[1],0)&&near(p[2],19),p.join());
 const q=transformPoint(m,[0,5,0]);assert.ok(near(q[1],5));
});

test('convexHull keeps the corners counter-clockwise',()=>{
 const hull=convexHull([[0,0],[10,0],[10,10],[0,10],[5,5],[2,8],[10,5]]);
 assert.equal(hull.length,4);
 let area=0;for(let i=0;i<hull.length;i++){const [x1,y1]=hull[i],[x2,y2]=hull[(i+1)%hull.length];area+=x1*y2-x2*y1;}
 assert.ok(area>0,'counter-clockwise');assert.ok(near(area/2,100));
});

test('footprint of a scaled cube is its rotated outline and height',()=>{
 const cube=[];for(const x of [-.5,.5])for(const y of [0,1])for(const z of [-.5,.5])cube.push(x,y,z);
 const f=footprint(new Float32Array(cube),[10,0,0,0, 0,10,0,0, 0,0,10,0, 100,50,200,1]);
 assert.equal(f.polygon.length,4);assert.ok(near(f.height,10));
 const xs=f.polygon.map(p=>p[0]),zs=f.polygon.map(p=>p[1]);
 assert.deepEqual([Math.min(...xs),Math.max(...xs),Math.min(...zs),Math.max(...zs)],[95,105,195,205]);
 const rotated=footprint(new Float32Array(cube),[Math.SQRT1_2*10,0,-Math.SQRT1_2*10,0, 0,10,0,0, Math.SQRT1_2*10,0,Math.SQRT1_2*10,0, 0,0,0,1]);
 assert.ok(near(Math.max(...rotated.polygon.map(p=>p[0])),Math.SQRT2*5,0.01),'a rotated building keeps its diamond outline, not a box');
});

test('classifyBuilding strips numbering and maps names to kinds',()=>{
 assert.equal(classifyBuilding('Warehouse1'),'warehouse');
 assert.equal(classifyBuilding('warehouse_b'),'warehouse');
 assert.equal(classifyBuilding('WaterTank (2)'),'tank');
 assert.equal(classifyBuilding('SmokestackBase'),'smokestack');
 assert.equal(classifyBuilding('Building_GuardTower'),'tower');
 assert.equal(classifyBuilding('OilTankRusty'),'oiltank');
 assert.equal(classifyBuilding('BarrelGreen'),'misc');
});

test('clusterPlaces merges buildings within 150 m and reports radiation',()=>{
 const b=(name,x,z)=>({name,kind:classifyBuilding(name),x,z});
 const places=clusterPlaces([b('Hangar',0,0),b('WaterTank',100,0),b('Barn',400,0)],{zones:[{x:10,z:0,r:100,exposure:500}]});
 assert.equal(places.length,2);
 const hangar=places.find(p=>p.kind==='hangar');assert.equal(hangar.title,'Hangar');assert.equal(hangar.structures,2);assert.equal(hangar.rad,500);
 assert.deepEqual(hangar.features,['Hangar','Water Tank']);
 assert.equal(places.find(p=>p.kind==='barn').rad,0);
 const split=clusterPlaces([b('Barn',0,0),b('Barn',200,0)]);assert.equal(split.length,2);
});

test('loot spawns: fixed points with crate odds and respawn minutes',()=>{
 const loot={prefabs:{a:{name:'BoxLoot'},b:{name:'WeaponLootBox'}},spawners:[
  {position:[5000.4,300,4000.6],chances:[{prefab:'a',weight:30},{prefab:'b',weight:10}],spawnTimeMin:10,spawnTimeMax:20},
  {position:[100,0,100],chances:[{prefab:'a',weight:1}],spawnTimeMin:5,spawnTimeMax:10}]};
 assert.deepEqual(lootSpawns(loot),[{x:5000,z:4001,crates:[{name:'Box Loot',chance:0.75},{name:'Weapon Loot Box',chance:0.25}],respawn:[10,20]}]);
});

test('spawn zones: animals, mutants and resource nodes with their target populations',()=>{
 const r={spawners:[
  {name:'WildlifeSpawner',position:[5000,0,4000],radius:250,spawnList:[{prefabName:':wolf_prefab',targetPopulation:2},{prefabName:';res_ore_1',targetPopulation:3}]},
  {name:'MutantAnimalSpawner',position:[6000,0,3000],radius:100,spawnList:[{prefabName:':mutant_bear',targetPopulation:3}]},
  {name:'resource_spawner',position:[5500,0,4500],radius:100,spawnList:[{prefabName:';res_woodpile',targetPopulation:3}]},
  {name:'WildlifeSpawner',position:[0,0,0],radius:50,spawnList:[{prefabName:':bear_prefab',targetPopulation:1}]}]};
 assert.deepEqual(spawnZones(r),[
  {x:5000,z:4000,r:250,kind:'wildlife',animals:[{name:'Wolf',count:2}],resources:[{name:'Ore 1',count:3}]},
  {x:6000,z:3000,r:100,kind:'mutant',animals:[{name:'Mutant Bear',count:3}],resources:[]},
  {x:5500,z:4500,r:100,kind:'resources',animals:[],resources:[{name:'Wood Pile',count:3}]}]);
});

test('no-build zones keep their radius',()=>{
 assert.deepEqual(noBuildZones({noPlacementZones:[{position:[6759.27,330,4381.86],radius:24.32},{position:[10,0,10],radius:5}]}),[{x:6759,z:4382,r:24.3}]);
});

test('heightAt samples the 2049² heightmap bilinearly (row = (8000 − z) / 7.8125, col = (x + 8000) / 7.8125)',()=>{
 const n=2049,H=new Float32Array(n*n);
 const r=(8000-4000)/7.8125,c=(5000+8000)/7.8125; // 512, 1664
 H[r*n+c]=300;H[r*n+c+1]=310;H[(r+1)*n+c]=320;H[(r+1)*n+c+1]=330;
 assert.equal(heightAt(H,5000,4000),300);
 assert.equal(heightAt(H,5000+7.8125/2,4000),305);
 assert.equal(heightAt(H,5000+7.8125/2,4000-7.8125/2),315);
});

test('contourSegments: marching squares crossing points in world coordinates',()=>{
 // 2×2 grid, step 10 from (0,0): left column 0, right column 20 → the 10 m line runs down the middle (x = 5).
 const segs=contourSegments({nx:2,nz:2,step:10,x0:0,z0:0,h:[0,20,0,20]},10);
 assert.deepEqual(segs,[[[5,0],[5,10]]]);
 assert.deepEqual(contourSegments({nx:2,nz:2,step:10,x0:0,z0:0,h:[0,0,0,0]},10),[]);
});
