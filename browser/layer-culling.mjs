// The main camera's per-layer cull distances (Unity Camera.layerCullDistances / layerCullSpherical), as the Scene Camera's
// CameraLayerDepths component sets them: layer 11 (Sprite) 5 m, layer 12 (CULL500) 600 m raised by CameraSettings to
// 600 + render.distance * 1000 m, every other layer 0 = the camera's far clip plane (6000 m); spherical = 1.
// Unity tests each renderer: with spherical culling a renderer is dropped when the distance from the camera to its world
// bounds centre exceeds its layer's distance; a 0 distance leaves only the far plane (planar). The engine's test is native
// code (not in the managed sources): the centre-distance rule is Unity's documented spherical behaviour.
//
// Port: scene containers (browser/scene.mjs userData.layer / worldBounds) are culled by switching three.js layer 0 off on
// their meshes, so other cameras that test other layers (the water's PlanarReflection camera, whose helper camera has no
// layer distances) still see them. Instanced batches keep the visible instances first in their matrix buffer and draw
// `count` of them; suspend()/resume() bracket a pass that must see every instance (the planar reflection).

export const SPRITE_LAYER=11,CULL500_LAYER=12;

// One renderer's test. centre: world AABB centre, radius: its half diagonal; distance: the layer's cull distance (0 = far
// plane); far: camera far clip; forward: unit camera forward (planar far test).
export function rendererCulled(center,radius,camera,forward,distance,far,spherical=true){
 return culledAt(center[0]-camera[0],center[1]-camera[1],center[2]-camera[2],radius,forward,distance,far,spherical);
}
function culledAt(dx,dy,dz,radius,forward,distance,far,spherical){
 if(distance>0){
  if(spherical)return dx*dx+dy*dy+dz*dz>distance*distance;
  return dx*forward[0]+dy*forward[1]+dz*forward[2]-radius>distance;
 }
 return far>0&&dx*forward[0]+dy*forward[1]+dz*forward[2]-radius>far;
}

const boundsCenter=b=>[(b[0][0]+b[1][0])/2,(b[0][1]+b[1][1])/2,(b[0][2]+b[1][2])/2];
const boundsRadius=b=>Math.hypot(b[1][0]-b[0][0],b[1][1]-b[0][1],b[1][2]-b[0][2])/2;

export function createLayerCuller({far=6000,spherical=true,distances=new Array(32).fill(0)}={}){
 const far0=far;
 const objects=[],batches=[];let dist=[...distances],suspended=false,enabled=true;
 const stats={objects:0,instances:0,visible:0,culled:0,uploads:0,ms:0};
 const setLayer0=(o,on)=>{for(const m of o.meshes){if(on)m.layers.enable(0);else m.layers.disable(0);}};
 // root: a group whose descendants carry userData.layer with worldBounds (containers) or instanceBounds (instanced meshes).
 function addScene(root){
  root.traverse(o=>{const layer=o.userData?.layer;if(layer===undefined)return;
   if(o.isInstancedMesh&&o.userData.instanceBounds){const b=o.userData.instanceBounds,n=b.length;
    const centers=new Float32Array(n*3),radii=new Float32Array(n);b.forEach((w,i)=>{centers.set(boundsCenter(w),i*3);radii[i]=boundsRadius(w);});
    batches.push({mesh:o,layer,n,centers,radii,source:o.instanceMatrix.array.slice(),visible:new Uint8Array(n).fill(1),shown:n,order:new Int32Array(n)});}
   else if(o.userData.worldBounds&&!o.isInstancedMesh){const meshes=[];o.traverse(m=>{if(m.isMesh)meshes.push(m);});
    if(meshes.length)objects.push({object:o,layer,meshes,center:boundsCenter(o.userData.worldBounds),radius:boundsRadius(o.userData.worldBounds),visible:true});}});
  stats.objects=objects.length;stats.instances=batches.reduce((s,b)=>s+b.n,0);
 }
 const cam=[0,0,0],fwd=[0,0,-1];
 // Per frame before the main camera renders. camera: THREE camera (world position / direction).
 function apply(camera){const t0=performance.now();if(!enabled){dist=dist.map(()=>0);far=Infinity;}
  const e=camera.matrixWorld.elements;cam[0]=e[12];cam[1]=e[13];cam[2]=e[14];const l=Math.hypot(e[8],e[9],e[10])||1;fwd[0]=-e[8]/l;fwd[1]=-e[9]/l;fwd[2]=-e[10]/l;
  let visible=0,culled=0;
  for(const o of objects){const v=!rendererCulled(o.center,o.radius,cam,fwd,dist[o.layer]??0,far,spherical);if(v!==o.visible){o.visible=v;setLayer0(o,v);}if(v)visible++;else culled++;}
  for(const b of batches){const d=dist[b.layer]??0;let k=0,changed=false;
   const c=b.centers;for(let i=0;i<b.n;i++){const v=culledAt(c[i*3]-cam[0],c[i*3+1]-cam[1],c[i*3+2]-cam[2],b.radii[i],fwd,d,far,spherical)?0:1;if(v!==b.visible[i]){b.visible[i]=v;changed=true;}k+=v;}
   if(changed){let w=0;const arr=b.mesh.instanceMatrix.array;
    for(let i=0;i<b.n;i++)if(b.visible[i])b.order[w++]=i;for(let i=0;i<b.n;i++)if(!b.visible[i])b.order[w++]=i;
    for(let j=0;j<b.n;j++)arr.set(b.source.subarray(b.order[j]*16,b.order[j]*16+16),j*16);
    b.mesh.instanceMatrix.clearUpdateRanges();b.mesh.instanceMatrix.needsUpdate=true;stats.uploads++;}
   b.shown=k;if(!suspended){b.mesh.count=k;if(k>0)b.mesh.layers.enable(0);else b.mesh.layers.disable(0);}
   visible+=k;culled+=b.n-k;}
  stats.visible=visible;stats.culled=culled;stats.ms=stats.ms*0.9+(performance.now()-t0)*0.1;}
 return {addScene,apply,
  // Camera.layerCullDistances (32 values) as CameraLayerDepths/CameraSettings set them.
  setDistances(d){if(enabled)dist=[...d];},get distances(){return [...dist];},
  // Measurement switch (dev): off draws every renderer (no layer distances, no far plane); on restores distances/far.
  setEnabled(on,{distances:d=dist,far:f=far0}={}){enabled=Boolean(on);if(enabled){dist=[...d];far=f;}},
  // Every instance drawn (a pass with its own camera, e.g. the planar reflection); objects need nothing (layer 30 tests).
  suspend(){suspended=true;for(const b of batches){b.mesh.count=b.n;}},
  resume(){suspended=false;for(const b of batches)b.mesh.count=b.shown;},
  stats:()=>({...stats,ms:Math.round(stats.ms*1000)/1000,distances:[...dist],far,spherical,batches:batches.length})};
}
