import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CHUNK_CELLS,LOD_STEPS,PIXEL_ERROR,MAXIMUM_LOD,edgeHeight,chunkBounds,chunkErrors,errorScale,chooseLevel,createTerrainLOD} from '../browser/terrain-lod.mjs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';

// Deterministic pseudo-random heights.
const noise=(n,seed=1)=>{let s=seed;return new Float32Array(n).map(()=>{s=(Math.imul(s,1103515245)+12345)>>>0;return (s>>>8)/65536/256;});};
const perspective=(fov=60)=>new THREE.PerspectiveCamera(fov,16/9,0.1,1e5);

test('terrain levels: full original resolution allowed, every level tiles a chunk, original pixel error 30',()=>{
 assert.equal(LOD_STEPS[0],1,'finest level draws every original height sample');
 for(const step of LOD_STEPS)assert.equal(CHUNK_CELLS%step,0,'every level tiles a chunk exactly');
 assert.equal(PIXEL_ERROR,30,'TerrainSettingsHack.CopyTo: heightmapPixelError = 30');assert.equal(MAXIMUM_LOD,0,'heightmapMaximumLOD = 0');
});

test('per-chunk level error is the largest height difference from the full-resolution grid',()=>{
 const cells=16,size=2*cells+1,heights=noise(size*size).map(v=>v*20);
 const {count,levels,errors}=chunkErrors(heights,size,cells);assert.equal(count,2);assert.equal(levels,LOD_STEPS.length);
 for(let cz=0;cz<2;cz++)for(let cx=0;cx<2;cx++){let prev=0;
  for(let l=0;l<levels;l++){const s=LOD_STEPS[l],n=(size-1)/s+1,coarse=new Float32Array(n*n);
   for(let z=0;z<n;z++)for(let x=0;x<n;x++)coarse[z*n+x]=heights[z*s*size+x*s];
   let worst=0;for(let z=cz*cells;z<=(cz+1)*cells;z++)for(let x=cx*cells;x<=(cx+1)*cells;x++)worst=Math.max(worst,Math.abs(heights[z*size+x]-sampleTriangle(coarse,n,x/s,z/s)));
   prev=Math.max(prev,worst);assert.ok(Math.abs(errors[(cz*2+cx)*levels+l]-prev)<1e-4,`chunk ${cx},${cz} level ${l}`);}
  assert.equal(errors[(cz*2+cx)*levels],0,'full resolution is exact');}
 // A plane (any slope) is reproduced exactly by every level.
 const plane=new Float32Array(size*size).map((_,i)=>3+0.7*(i%size)-1.3*Math.floor(i/size));
 assert.ok(chunkErrors(plane,size,cells).errors.every(e=>e<1e-4));
});

test('level choice: flat chunk is coarsest, rough nearby chunk is finest, far rough chunk coarsens',()=>{
 const cells=64,size=cells+1,flat=new Float32Array(size*size).fill(12),rough=noise(size*size,7).map(v=>v*8);
 const view=errorScale(perspective(60),720),last=LOD_STEPS.length-1;
 const f=chunkErrors(flat,size),r=chunkErrors(rough,size);
 assert.equal(chooseLevel(f.errors,0,f.levels,0,view),last,'flat ground: coarsest even under the camera');
 assert.equal(chooseLevel(r.errors,0,r.levels,2,view),0,'rough ground 2 m away: full resolution');
 assert.equal(chooseLevel(r.errors,0,r.levels,1e6,view),last,'rough ground far away: coarsest');
 // Exactly the projected-error rule: error * viewportHeight / (2 distance tan(fov/2)) <= 30 px.
 const errors=new Float32Array([0,0.5,2,8,20]),px=(e,d)=>e*720/(2*d*Math.tan(Math.PI/6));
 for(const d of [1,10,30,60,100,250,600,2000]){const l=chooseLevel(errors,0,5,d,view);
  assert.ok(px(errors[l],d)<=PIXEL_ERROR+1e-9,`level ${l} at ${d} m within 30 px`);if(l<4)assert.ok(px(errors[l+1],d)>PIXEL_ERROR,`level ${l+1} at ${d} m would exceed 30 px`);}
 assert.equal(chooseLevel(errors,0,5,1e6,view,PIXEL_ERROR,2),4);assert.equal(chooseLevel(errors,0,5,0.01,view,PIXEL_ERROR,2),2,'heightmapMaximumLOD caps the finest level');
});

test('field of view and viewport height change the level, as in Unity',()=>{
 const errors=new Float32Array([0,0.5,2,8,20]),d=120,at=(fov,h)=>chooseLevel(errors,0,5,d,errorScale(perspective(fov),h));
 const base=at(60,720);
 assert.ok(at(60,2160)<base,'taller viewport (more pixels per metre): finer');
 assert.ok(at(60,240)>base,'shorter viewport: coarser');
 assert.ok(at(15,720)<base,'zoomed field of view: finer');
 assert.ok(at(110,720)>=base,'wider field of view: same or coarser');
 const ortho=new THREE.OrthographicCamera(-500,500,500,-500,1,2000);
 assert.equal(chooseLevel(errors,0,5,1,errorScale(ortho,1000)),chooseLevel(errors,0,5,1e4,errorScale(ortho,1000)),'orthographic: distance does not matter');
 assert.equal(chooseLevel(errors,0,5,1,errorScale(ortho,1000)),4,'1 px per metre: 20 m error is within 30 px');
});

test('per-frame update: levels follow the pixel error and every edge is stitched to the coarser neighbour',()=>{
 // 4 x 4 chunks of rough ground; the camera stands low over one corner.
 const size=4*CHUNK_CELLS+1,extent=(size-1)*10,heights=noise(size*size,3).map(v=>v*60);
 const lod=createTerrainLOD(heights,size,new THREE.MeshBasicMaterial(),{extent,originX:0,originZ:extent});
 const camera=perspective(60);camera.aspect=1;camera.position.set(5,8,extent-5);camera.lookAt(extent,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
 lod.update(camera,720);const near=lod.stats();
 assert.equal(near.chunks,16);assert.ok(near.allLevels[0]>=1,'the chunk under the camera is full resolution');assert.ok(near.allLevels.slice(1).some(Boolean),'farther chunks coarsen');
 lod.update(camera,72);const small=lod.stats();
 const mean=s=>s.allLevels.reduce((a,n,l)=>a+n*l,0)/s.chunks;assert.ok(mean(small)>mean(near),'fewer pixels: coarser on average');
 lod.update(camera,720);
 const levelOf=new Map();lod.group.children.forEach((mesh,l)=>{const g=mesh.geometry;for(let n=0;n<g.instanceCount;n++)levelOf.set(g.attributes.chunk.array[n*2]+','+g.attributes.chunk.array[n*2+1],{l,n,g});});
 const stepAt=(x,z)=>{const e=levelOf.get(x*CHUNK_CELLS+','+z*CHUNK_CELLS);return e?LOD_STEPS[e.l]:null;};
 for(const [key,{l,n,g}] of levelOf){const [x,z]=key.split(',').map(v=>v/CHUNK_CELLS),st=g.attributes.stitch.array.slice(n*4,n*4+4);
  [[x-1,z],[x+1,z],[x,z-1],[x,z+1]].forEach(([nx,nz],k)=>{const other=stepAt(nx,nz);if(other!==null)assert.equal(st[k],Math.max(LOD_STEPS[l],other),`chunk ${key} edge ${k}`);});}
});

test('an edge stitched to a coarser neighbour lies on that neighbour\'s edge line',()=>{
 const h=[3,9,1,4,7,2,8,5,6],sample=t=>h[t];
 for(let t=0;t<=8;t++){const fine=edgeHeight(sample,t,4),t0=Math.floor(t/4)*4;
  if(t%4===0)assert.equal(fine,h[t],'shared vertices keep the exact sample');
  else assert.ok(Math.abs(fine-(h[t0]+(h[t0+4]-h[t0])*(t-t0)/4))<1e-12);}
 assert.equal(edgeHeight(sample,5,1),h[5],'same-level edges are untouched');
});

test('chunk height bounds cover every sample including shared borders',()=>{
 const size=2*4+1,heights=new Float32Array(size*size).map((_,i)=>i%7-(i%5)*2);const {count,ranges}=chunkBounds(heights,size,4);assert.equal(count,2);
 for(let cz=0;cz<2;cz++)for(let cx=0;cx<2;cx++)for(let z=cz*4;z<=cz*4+4;z++)for(let x=cx*4;x<=cx*4+4;x++){const v=heights[z*size+x],i=cz*2+cx;assert.ok(v>=ranges[i*2]&&v<=ranges[i*2+1]);}
});

test('ground under buildings uses the full 2049-sample heightmap, not a decimated grid',()=>{
 // A narrow 1-cell bump: the full grid sees it, a 4x decimated grid (the old renderer/collision) would not.
 const size=9,full=new Float32Array(size*size);full[4*size+5]=10;
 const ground=(gx,gz)=>sampleTriangle(full,size,gx,gz);
 assert.equal(ground(5,4),10);
 const decimated=new Float32Array(9);for(let z=0;z<3;z++)for(let x=0;x<3;x++)decimated[z*3+x]=full[z*4*size+x*4];
 assert.equal(sampleTriangle(decimated,3,5/4,4/4),0);
 assert.deepEqual(worldToGrid(-7999.99951171875,8000,16000,2048),[0,0]);
});
