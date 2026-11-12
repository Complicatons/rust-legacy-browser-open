// P2-10: Detour-crowd NavMeshAgent simulation (browser/nav-crowd.mjs) for offline wolves/bears/boars/stags.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
import {NavMesh} from '../browser/navmesh.mjs';
import {NavCrowd,sampleVelocityAdaptive,mergeCorridorStartMoved,AVOIDANCE} from '../browser/nav-crowd.mjs';
import {Wildlife,WildlifeWorld} from '../browser/animals.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const animals=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/animals/manifest.json',import.meta.url))).animals):null;

// n x n grid of `size` m squares (Unity space, y = 0) with the cells in `holes` left out, links between neighbours.
function gridMesh(n,size,holes=[]){const id=(i,j)=>j*(n+1)+i,verts=[];for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)verts.push(i*size,0,j*size);
 const cells=[],index=new Map();for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(!holes.some(([a,b])=>a===i&&b===j)){index.set(i+','+j,cells.length);cells.push([i,j]);}
 const polyVerts=[0],polyIndex=[],linkStart=[0],linkTo=[],linkEdge=[],linkRange=[];
 for(const [i,j] of cells){polyIndex.push(id(i,j),id(i+1,j),id(i+1,j+1),id(i,j+1));polyVerts.push(polyIndex.length);
  // edges: 0 (i,j)-(i+1,j) south, 1 east, 2 north, 3 west
  for(const [e,di,dj] of [[0,0,-1],[1,1,0],[2,0,1],[3,-1,0]]){const nb=index.get((i+di)+','+(j+dj));if(nb!==undefined){linkTo.push(nb);linkEdge.push(e);linkRange.push(0,255);}}linkStart.push(linkTo.length);}
 return new NavMesh({verts:new Float32Array(verts),polyVerts:new Uint32Array(polyVerts),polyIndex:new Uint32Array(polyIndex),linkStart:new Uint32Array(linkStart),linkTo:new Uint32Array(linkTo),linkEdge:new Uint8Array(linkEdge),linkRange:new Uint8Array(linkRange)});}
const wolfParams=a=>({radius:a._radius,height:a._height,maxSpeed:a._speed,maxAcceleration:a._acceleration,stoppingDistance:a._stoppingDistance,autoBraking:a._autoBraking!==0,obstacleAvoidanceType:a._obstacleAvoidanceType,avoidancePriority:a._avoidancePriority});

test('obstacle avoidance sampling: free space keeps the desired velocity; a head-on agent makes it turn aside', ()=>{
 const base={pos:new Vector3(0,0,0),radius:1,vmax:6,vel:new Vector3(0,0,6),dvel:new Vector3(0,0,6)};
 const free=sampleVelocityAdaptive(base,AVOIDANCE[1]).velocity;assert.ok(free.distanceTo(base.dvel)<0.75,free.toArray().join());
 const head=sampleVelocityAdaptive({...base,circles:[{p:new Vector3(0,0,4),rad:1,vel:new Vector3(0,0,-6),dvel:new Vector3(0,0,-6)}]},AVOIDANCE[4]).velocity;
 assert.ok(Math.abs(head.x)>1,`sidestep ${head.toArray().join()}`);assert.ok(head.length()<=6.001);
 // A navmesh wall 1.2 m ahead: the time-of-impact penalty slows the approach (moveAlongSurface does the clamping).
 for(const q of [1,4]){const wall=sampleVelocityAdaptive({...base,segments:[{p:new Vector3(-5,0,1.2),q:new Vector3(5,0,1.2)}]},AVOIDANCE[q]).velocity;assert.ok(wall.z<2,wall.toArray().join());}
 assert.deepEqual(AVOIDANCE[1]&&[AVOIDANCE[1].adaptiveDivs,AVOIDANCE[1].adaptiveRings,AVOIDANCE[1].adaptiveDepth],[5,2,1]);assert.deepEqual([AVOIDANCE[4].adaptiveDivs,AVOIDANCE[4].adaptiveRings,AVOIDANCE[4].adaptiveDepth],[7,3,3]);
});

test('dtMergeCorridorStartMoved keeps the corridor from the furthest visited polygon on it', ()=>{
 assert.deepEqual(mergeCorridorStartMoved([1,2,3,4],[1,2]),[2,3,4]);assert.deepEqual(mergeCorridorStartMoved([1,2,3,4],[1,5,3]),[3,4]);
 assert.deepEqual(mergeCorridorStartMoved([1,2,3],[7,8]),[1,2,3]);assert.deepEqual(mergeCorridorStartMoved([1,2,3],[1]),[1,2,3]);
});

test('a wolf agent paths around a navmesh hole (a baked-out building) and reaches its destination on the mesh',needsAssets, ()=>{
 const nav=gridMesh(3,10,[[1,1]]),crowd=new NavCrowd(nav),wolf=crowd.addAgent(wolfParams(animals.wolf_prefab.navAgent),new Vector3(15,0,2));
 assert.ok(wolf);assert.ok(crowd.requestMoveTarget(wolf,new Vector3(15,0,28)));let minHole=Infinity,t=0,maxSpeed=0;
 for(;t<20&&wolf.hasPath;t+=1/60){crowd.update(1/60);const {x,z}=wolf.pos;assert.ok(!(x>10+1e-6&&x<20-1e-6&&z>10+1e-6&&z<20-1e-6),`inside the hole at ${x},${z}`);
  minHole=Math.min(minHole,Math.max(Math.abs(x-15)-5,Math.abs(z-15)-5));maxSpeed=Math.max(maxSpeed,Math.hypot(wolf.vel.x,wolf.vel.z));}
 assert.ok(!wolf.hasPath&&wolf.pos.distanceTo(new Vector3(15,0,28))<0.3,`arrived ${wolf.pos.toArray()} after ${t}`);
 assert.ok(maxSpeed<=6.001&&maxSpeed>5.5,`speed ${maxSpeed}`);assert.ok(t<10,`took ${t} s`);
 // Path corners went around the hole's corners; the agent did not cut through it.
 assert.ok(minHole>=-1e-6,String(minHole));
});

test('acceleration, auto braking and stopping distance follow the agent settings',needsAssets, ()=>{
 const nav=gridMesh(4,10),crowd=new NavCrowd(nav),boar=crowd.addAgent(wolfParams(animals.boar_prefab.navAgent),new Vector3(5,0,5));
 crowd.requestMoveTarget(boar,new Vector3(35,0,5));crowd.update(0.1);assert.ok(Math.abs(boar.vel.length()-0.8)<1e-6,'8 m/s² for 0.1 s');
 let slowed=false;for(let i=0;i<1200&&boar.hasPath;i++){crowd.update(1/60);if(boar.cornerEnd&&boar.remaining<1&&boar.vel.length()<2.5)slowed=true;}
 assert.ok(!boar.hasPath);const left=35-boar.pos.x;assert.ok(left<=2.1&&left>1.0,`stopped ${left} m short (stoppingDistance 2)`);
 for(let i=0;i<120;i++)crowd.update(1/60);assert.ok(boar.vel.length()<1e-3,'decelerates to rest');
 const wolf=crowd.addAgent(wolfParams(animals.wolf_prefab.navAgent),new Vector3(5,0,25));crowd.requestMoveTarget(wolf,new Vector3(35,0,25));
 let v=[];for(let i=0;i<600&&wolf.hasPath;i++){crowd.update(1/60);v.push([35-wolf.pos.x,wolf.vel.length()]);}
 // dtCrowd slowdown: desired speed scales with distance / (2 x radius) on the last 2 m; acceleration (12) limits braking.
 const top=Math.max(...v.map(([,s])=>s)),end=v.filter(([d])=>d<0.3);assert.ok(Math.abs(top-6)<0.01&&end.length&&end.every(([,s])=>s<3),JSON.stringify(end.slice(0,3)));
 assert.ok(Math.abs(35-wolf.pos.x)<0.1);
});

test('agents avoid each other head-on and respect avoidancePriority',needsAssets, ()=>{
 const nav=gridMesh(6,10),crowd=new NavCrowd(nav),A=crowd.addAgent(wolfParams(animals.wolf_prefab.navAgent),new Vector3(5,0,30)),B=crowd.addAgent(wolfParams(animals.wolf_prefab.navAgent),new Vector3(55,0,30.2));
 crowd.requestMoveTarget(A,new Vector3(55,0,30));crowd.requestMoveTarget(B,new Vector3(5,0,30));let minD=Infinity;
 for(let i=0;i<900&&(A.hasPath||B.hasPath);i++){crowd.update(1/60);minD=Math.min(minD,Math.hypot(A.pos.x-B.pos.x,A.pos.z-B.pos.z));}
 assert.ok(minD>1.4,`closest approach ${minD} (radii 1 + 1)`);assert.ok(A.pos.distanceTo(new Vector3(55,0,30))<0.5&&B.pos.distanceTo(new Vector3(5,0,30))<0.5);
 // A boar (priority 50) ignores a wolf (60) while avoiding; the wolf avoids the boar.
 const boar=crowd.addAgent(wolfParams(animals.boar_prefab.navAgent),new Vector3(5,0,10)),wolf=crowd.addAgent(wolfParams(animals.wolf_prefab.navAgent),new Vector3(30,0,10.1));
 boar.params.maxSpeed=3;crowd.requestMoveTarget(boar,new Vector3(55,0,10));crowd.requestMoveTarget(wolf,new Vector3(5,0,10));let boarDev=0,wolfDev=0;
 for(let i=0;i<300;i++){crowd.update(1/60);boarDev=Math.max(boarDev,Math.abs(boar.pos.z-10));wolfDev=Math.max(wolfDev,Math.abs(wolf.pos.z-10.1));}
 assert.ok(wolfDev>boarDev*2,`wolf ${wolfDev} vs boar ${boarDev}`);
});

test('NavMeshObstacle cylinders are steered around (avoidance only, as non-carving Unity 4 obstacles)',needsAssets, ()=>{
 const nav=gridMesh(4,10),obstacle={x:20,y:0,z:20,radius:2,height:3},crowd=new NavCrowd(nav,{obstacles:()=>[obstacle]});
 const bear=crowd.addAgent(wolfParams(animals.bear_prefab.navAgent),new Vector3(3,0,20));crowd.requestMoveTarget(bear,new Vector3(37,0,20));let min=Infinity;
 for(let i=0;i<1200&&bear.hasPath;i++){crowd.update(1/60);min=Math.min(min,Math.hypot(bear.pos.x-20,bear.pos.z-20));}
 assert.ok(min>2,`passed ${min} m from the obstacle centre (bear radius 1.5, obstacle 2)`);assert.ok(bear.pos.distanceTo(new Vector3(37,0,20))<0.5);
});

test('NavMeshMovement on the crowd: hostile chase target, stop/resume, death leaves the crowd',needsAssets, ()=>{
 const nav=gridMesh(3,10,[[1,1]]),physics={navmesh:nav,groundInfo:p=>({hit:true,pos:new Vector3(p.x,0,p.z),normal:new Vector3(0,1,0)}),blocked:()=>{throw Error('agents ignore colliders');}};
 const world=new WildlifeWorld({rng:()=>0.5,physics}),wolf=world.add(new Wildlife(world,'wolf_prefab',animals.wolf_prefab,null,{spawned:[]},new Vector3(15,0,2),new Quaternion()));
 assert.equal(world.crowd.agents.size,1);
 const target={position:new Vector3(15,0,28),alive:true,hurt(){}};world.update(0,0);world.audible(null,target.position,100,'scent',target);
 let t=0;for(;t<15&&wolf.state!==10;t+=1/60)world.update(t,1/60);assert.ok(wolf.position.distanceTo(target.position)<=wolf.ai.attackRange);
 assert.equal(wolf.state,10,'reached attack range around the hole');assert.ok(t<10,String(t));
 wolf.hurt([0,0,1e6,0,0,0],null);assert.ok(wolf.vitals.dead);assert.equal(world.crowd.agents.size,0);
});
