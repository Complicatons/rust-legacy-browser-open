import * as THREE from 'three';
import {cellHeight} from './terrain.mjs';

// Full-resolution island terrain. The original heightmap is 2049 x 2049 samples over 16 km (7.8125 m per cell).
// Rendering every sample would be 8.4 M triangles, so the map is split into 64-cell chunks, each drawn at the level of
// detail Unity's terrain renderer would pick: TerrainSettingsHack.CopyTo (TerrainControl.cs) sets
// terrain.heightmapPixelError = 30 and heightmapMaximumLOD = 0, so a patch is drawn at the coarsest level whose
// precomputed maximum height error, projected at the patch's distance with the camera's field of view and the
// viewport's pixel height, stays within 30 pixels (full detail allowed). Heights live in one float texture and are
// fetched per vertex, so every level samples the exact original heights. Where a chunk meets a coarser neighbour,
// its edge vertices are placed on the neighbour's edge line, so the two meet without cracks at any level difference.
export const CHUNK_CELLS=64;
export const LOD_STEPS=[1,2,4,8,16];
// manifest.json treeRendering.effective.heightmapPixelError; heightmapMaximumLOD from TerrainSettingsHack.CopyTo.
export const PIXEL_ERROR=30,MAXIMUM_LOD=0;

// Height of the grid with vertices `step` cells apart at full-resolution sample (x, z) inside the coarse cell whose
// corner is (x0, z0). Same triangle split as chunkGeometry (a,b,d / a,d,c) and terrain.mjs sampleTriangle (Unity's).
function coarseHeight(heights,size,x0,z0,step,x,z){
 return cellHeight(heights[z0*size+x0],heights[z0*size+x0+step],heights[(z0+step)*size+x0],heights[(z0+step)*size+x0+step],(x-x0)/step,(z-z0)/step);
}

// Maximum vertical error of every chunk at every level against the full-resolution heightmap, in metres (Unity
// precomputes the same per patch and level). errors[chunkIndex*levels+level]; level 0 is exact (0). Kept
// non-decreasing with level, so a coarser level is never treated as more accurate than a finer one.
export function chunkErrors(heights,size,chunkCells=CHUNK_CELLS,steps=LOD_STEPS){
 const cells=size-1,count=cells/chunkCells,levels=steps.length,out=new Float32Array(count*count*levels);
 for(let cz=0;cz<count;cz++)for(let cx=0;cx<count;cx++){const o=(cz*count+cx)*levels;
  for(let l=0;l<levels;l++){const step=steps[l];let worst=0;
   if(step>1)for(let z0=cz*chunkCells;z0<(cz+1)*chunkCells;z0+=step)for(let x0=cx*chunkCells;x0<(cx+1)*chunkCells;x0+=step)
    for(let z=z0;z<=z0+step;z++)for(let x=x0;x<=x0+step;x++){const e=Math.abs(heights[z*size+x]-coarseHeight(heights,size,x0,z0,step,x,z));if(e>worst)worst=e;}
   out[o+l]=l?Math.max(worst,out[o+l-1]):worst;}}
 return {count,levels,errors:out};
}

// Pixels per metre of height error: perspective, at unit distance (viewportHeight / (2 tan(fov/2)), so the projected
// error is error * scale / distance); orthographic, at any distance (viewportHeight / view height).
export function errorScale(camera,viewportHeight){
 if(camera.isOrthographicCamera)return {scale:viewportHeight*(camera.zoom??1)/Math.max(1e-6,camera.top-camera.bottom),perspective:false};
 return {scale:viewportHeight*(camera.zoom??1)/(2*Math.tan(camera.fov*Math.PI/360)),perspective:true};
}

// Coarsest level (no finer than maximumLod) whose error projects to at most pixelError pixels at `distance` metres.
export function chooseLevel(errors,offset,levels,distance,{scale,perspective},pixelError=PIXEL_ERROR,maximumLod=MAXIMUM_LOD){
 const limit=pixelError*(perspective?distance:1);
 for(let l=levels-1;l>maximumLod;l--)if(errors[offset+l]*scale<=limit)return l;
 return maximumLod;
}

// Height of a vertex t cells along an edge shared with a neighbour whose vertices are `coarse` cells apart
// (the GLSL below does the same): exact samples at the neighbour's vertices, the straight line between them elsewhere.
export function edgeHeight(sample,t,coarse){const t0=Math.floor(t/coarse)*coarse;if(t0===t)return sample(t);const a=sample(t0),b=sample(t0+coarse);return a+(b-a)*(t-t0)/coarse;}

// Per-chunk height range, for frustum culling.
export function chunkBounds(heights,size,chunkCells=CHUNK_CELLS){
 const cells=size-1,count=cells/chunkCells,out=new Float32Array(count*count*2);
 for(let cz=0;cz<count;cz++)for(let cx=0;cx<count;cx++){let lo=Infinity,hi=-Infinity;
  for(let z=cz*chunkCells;z<=(cz+1)*chunkCells;z++)for(let x=cx*chunkCells;x<=(cx+1)*chunkCells;x++){const h=heights[z*size+x];if(h<lo)lo=h;if(h>hi)hi=h;}
  out[(cz*count+cx)*2]=lo;out[(cz*count+cx)*2+1]=hi;}
 return {count,ranges:out};
}

// Local grid for one chunk at one level, in heightmap cells. Per instance: `chunk` (origin cell) and `stitch`
// (vertex spacing to use on each edge: -x, +x, -row, +row; the coarser of this chunk's and the neighbour's).
function chunkGeometry(step,capacity){
 const n=CHUNK_CELLS/step,ring=n+1,positions=[],index=[];
 for(let z=0;z<=n;z++)for(let x=0;x<=n;x++)positions.push(x*step,z*step,0);
 const at=(x,z)=>z*ring+x;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=at(x,z),b=at(x+1,z),c=at(x,z+1),d=at(x+1,z+1);index.push(a,b,d,a,d,c);}
 const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(index);
 for(const [name,size] of [['chunk',2],['stitch',4]]){const a=new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute(name,a);}
 g.instanceCount=0;return g;
}

// heights: Float32Array of size*size, rows following Unity +Z (see terrain.mjs). material: a MeshStandardMaterial
// whose fragment shader reads `terrainUv`; it is patched here to displace the shared chunk grids.
// renderer: its drawing-buffer height is the viewport height of the pixel error (update(camera, height) overrides it).
export function createTerrainLOD(heights,size,material,{extent=16000,originX=-7999.99951171875,originZ=8000,renderer=null,pixelError=PIXEL_ERROR,maximumLod=MAXIMUM_LOD}={}){
 const cells=size-1;if(cells%CHUNK_CELLS)throw Error('Terrain size must be a multiple of the chunk size plus one');
 const texture=new THREE.DataTexture(heights,size,size,THREE.RedFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
 const cell=extent/cells,{count,ranges}=chunkBounds(heights,size),{errors,levels:levelCount}=chunkErrors(heights,size),group=new THREE.Group();group.name='Original terrain (LOD chunks)';
 const previous=material.onBeforeCompile;
 material.onBeforeCompile=(shader,renderer)=>{previous?.call(material,shader,renderer);
  Object.assign(shader.uniforms,{terrainHeights:{value:texture},terrainCell:{value:cell},terrainCells:{value:cells},terrainOrigin:{value:new THREE.Vector2(originX,originZ)}});
  // terrainUv (0..1 over the heightmap, rows along Unity +Z) feeds the splat-map fragment code.
  shader.vertexShader=`uniform highp sampler2D terrainHeights;uniform float terrainCell;uniform float terrainCells;uniform vec2 terrainOrigin;attribute vec2 chunk;attribute vec4 stitch;varying vec2 terrainUv;
float terrainHeight(ivec2 p){p=clamp(p,ivec2(0),ivec2(int(terrainCells)));return texelFetch(terrainHeights,p,0).r;}
float terrainEdge(ivec2 p,ivec2 along,int t,int coarse){int t0=t/coarse*coarse;float h=terrainHeight(p);
 if(t0!=t)h=mix(terrainHeight(p-along*(t-t0)),terrainHeight(p+along*(t0+coarse-t)),float(t-t0)/float(coarse));return h;}
`+shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
vec2 terrainGrid=chunk+position.xy;ivec2 terrainCellPos=ivec2(terrainGrid+0.5);terrainUv=terrainGrid/terrainCells;`)
   .replace('#include <beginnormal_vertex>',`float tl=terrainHeight(terrainCellPos-ivec2(1,0)),tr=terrainHeight(terrainCellPos+ivec2(1,0)),td=terrainHeight(terrainCellPos-ivec2(0,1)),tu=terrainHeight(terrainCellPos+ivec2(0,1));
// Grid rows run along Unity +Z, which is browser -Z.
vec3 objectNormal=normalize(vec3((tl-tr)/(2.0*terrainCell),1.0,(tu-td)/(2.0*terrainCell)));`)
   .replace('#include <begin_vertex>',`ivec2 local=ivec2(position.xy+0.5);float terrainY=terrainHeight(terrainCellPos);
if(local.x==0)terrainY=terrainEdge(terrainCellPos,ivec2(0,1),local.y,int(stitch.x));else if(local.x==${CHUNK_CELLS})terrainY=terrainEdge(terrainCellPos,ivec2(0,1),local.y,int(stitch.y));
if(local.y==0)terrainY=terrainEdge(terrainCellPos,ivec2(1,0),local.x,int(stitch.z));else if(local.y==${CHUNK_CELLS})terrainY=terrainEdge(terrainCellPos,ivec2(1,0),local.x,int(stitch.w));
vec3 transformed=vec3(terrainOrigin.x+terrainGrid.x*terrainCell,terrainY,terrainOrigin.y-terrainGrid.y*terrainCell);`);
 };
 const key=material.customProgramCacheKey?.bind(material);material.customProgramCacheKey=()=>'terrain-lod:'+(key?.()??'');
 const levels=LOD_STEPS.map(step=>{const mesh=new THREE.Mesh(chunkGeometry(step,count*count),material);mesh.frustumCulled=false;mesh.name=`Terrain LOD ${step}`;group.add(mesh);return mesh;});
 const box=new THREE.Box3(),frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),counts=new Array(levels.length).fill(0);let drawn=0;
 const lod=new Uint8Array(count*count),visible=new Uint8Array(count*count),stepAt=(x,z)=>x<0||z<0||x>=count||z>=count?1:LOD_STEPS[lod[z*count+x]];
 const buffer=new THREE.Vector2();
 // Called once per frame before rendering. Every chunk gets a level, culled or not, for its neighbours' stitching.
 function update(camera,viewportHeight=renderer?renderer.getDrawingBufferSize(buffer).y:1080){
  matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(matrix);counts.fill(0);drawn=0;
  const cx=camera.position.x,cy=camera.position.y,cz=camera.position.z,span=CHUNK_CELLS*cell,projection=errorScale(camera,viewportHeight);
  for(let z=0;z<count;z++)for(let x=0;x<count;x++){const i=z*count+x,x0=originX+x*span,z1=originZ-z*span,z0=z1-span,lo=ranges[i*2],hi=ranges[i*2+1];
   // Distance from the camera to the chunk's bounds (its whole height range).
   lod[i]=chooseLevel(errors,i*levelCount,levelCount,Math.hypot(Math.max(x0-cx,0,cx-x0-span),Math.max(lo-cy,0,cy-hi),Math.max(z0-cz,0,cz-z1)),projection,pixelError,maximumLod);
   box.min.set(x0,lo-span,z0);box.max.set(x0+span,hi,z1);visible[i]=frustum.intersectsBox(box)?1:0;}
  for(let z=0;z<count;z++)for(let x=0;x<count;x++){const i=z*count+x;if(!visible[i])continue;const level=lod[i],step=LOD_STEPS[level],n=counts[level]++,a=levels[level].geometry.attributes;
   a.chunk.array[n*2]=x*CHUNK_CELLS;a.chunk.array[n*2+1]=z*CHUNK_CELLS;
   a.stitch.array[n*4]=Math.max(step,stepAt(x-1,z));a.stitch.array[n*4+1]=Math.max(step,stepAt(x+1,z));a.stitch.array[n*4+2]=Math.max(step,stepAt(x,z-1));a.stitch.array[n*4+3]=Math.max(step,stepAt(x,z+1));drawn++;}
  levels.forEach((mesh,i)=>{const g=mesh.geometry;g.instanceCount=counts[i];if(!counts[i])return;for(const [name,size] of [['chunk',2],['stitch',4]]){const a=g.attributes[name];a.clearUpdateRanges();a.addUpdateRange(0,counts[i]*size);a.needsUpdate=true;}});
 }
 return {group,update,texture,size,extent,originX,originZ,errors,stats:()=>{const all=new Array(levels.length).fill(0);for(const l of lod)all[l]++;return {chunks:count*count,drawn,levels:[...counts],allLevels:all,pixelError};}};
}
