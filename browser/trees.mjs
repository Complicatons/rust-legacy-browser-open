import * as THREE from 'three';
import {createLegacyMaterial,legacyTreeVariant,windZoneForce} from './legacy-materials.mjs';
import {TerrainIdleRefresh} from './render-convars.mjs';
import {FORWARD_OPAQUE_ORDER} from './soft-particles.mjs';

// Original terrain trees drawn the way Unity 4's terrain TreeRenderer drew them, with the values the Rust Legacy client
// actually ran with. The scene's Terrain component (5405) serialises billboard 171 m / cross-fade 13.1 m / 25 mesh trees,
// but TerrainControl (5393) re-assigns the bundle TerrainData 2 s after start and RestoreTerrainSettings() copies its
// own settings onto the terrain: tree distance 2000 m, billboards from 214 m, 5 m cross-fade, at most 60 mesh trees.
// (TerrainQualitySettings' per-quality table is not attached in the shipped scene.) tools/export_world.py records both.
//
// Unity 4 semantics reproduced here (the native TreeRenderer is not in the managed code we have; its shader interface is:
// Tree Creator materials carry _SquashAmount, billboards use camera right/up and imposter textures):
//  - nothing beyond treeDistance (3-D distance from the camera to the tree position);
//  - beyond treeBillboardDistance every tree is a camera-facing billboard;
//  - nearer trees are full meshes, but only the treeMaximumFullLODCount nearest visible ones; the rest are billboards;
//  - over the last treeCrossFadeLength metres before the billboard distance a mesh tree is squashed flat onto the
//    billboard plane (_SquashAmount 1 -> 0), where the billboard of the same view takes over;
//  - billboard images are rendered at runtime from the real prototype meshes with the current camera rotation and
//    lighting, re-rendered when the camera turns, and also when the client's TerrainControl forces it
//    (TerrainHack.RefreshTreeTextures): after the camera has stood still for terrain.idleinterval (3.2 s) seconds, and
//    every interval while it stays still (render-convars.mjs TerrainIdleRefresh; 0 or less never forces);
//  - mesh trees sway in the scene's WindZone (Tree Creator AnimateVertex with the per-vertex wind channels from
//    render-extras.json); billboards do not (the *Rendertex capture shaders have no wind).

// Fallback when an older export manifest has no treeRendering block: TerrainControl 5393 settings.
export const ORIGINAL_TREE_SETTINGS=Object.freeze({treeDistance:2000,treeBillboardDistance:214,treeCrossFadeLength:5,treeMaximumFullLODCount:60});
// terrain.idleinterval default (Assembly-CSharp terrain.cs) and TerrainControl's "camera turned" threshold.
export const IMPOSTER_IDLE_SECONDS=3.2,IMPOSTER_TURN_DEGREES=0.5;

// manual: terrain.manual at level load. TerrainControl.ReassignTerrainData (2 s after OnEnable) then skips its
// RestoreTerrainSettings, so the scene Terrain's own serialized values stay in use.
export function treeSettings(manifest,{manual=false}={}){
 const e=manual?(manifest?.treeRendering?.serializedTerrain??manifest?.treeRendering?.effective):manifest?.treeRendering?.effective;if(!e)return {...ORIGINAL_TREE_SETTINGS};
 return {treeDistance:e.treeDistance,treeBillboardDistance:e.treeBillboardDistance,treeCrossFadeLength:e.treeCrossFadeLength,treeMaximumFullLODCount:e.treeMaximumFullLODCount};
}

// 'none' beyond treeDistance, 'billboard' from the billboard distance on, otherwise a full-mesh candidate.
export function classifyTreeDistance(distance,s){
 if(distance>s.treeDistance)return 'none';
 return distance>=s.treeBillboardDistance?'billboard':'mesh';
}

// _SquashAmount for a mesh tree: 1 (full shape) until crossFade metres before the billboard distance, 0 (flat) at it.
export function squashAmount(distance,s){
 const end=s.treeBillboardDistance,len=s.treeCrossFadeLength;
 if(!(len>0))return distance<end?1:0;
 return Math.min(1,Math.max(0,(end-distance)/len));
}

// Mesh-tree selection among the visible trees nearer than the billboard distance: the nearest
// treeMaximumFullLODCount become meshes, the rest are drawn as billboards. candidates: [{index,distance}].
export function selectFullTrees(candidates,s){
 const near=candidates.filter(c=>c.distance<s.treeBillboardDistance).sort((a,b)=>a.distance-b.distance||a.index-b.index);
 const cap=Math.max(0,s.treeMaximumFullLODCount|0);
 return {full:near.slice(0,cap).map(c=>({index:c.index,distance:c.distance,squash:squashAmount(c.distance,s)})),overflow:near.slice(cap).map(c=>c.index)};
}

// Unity ColorRGBA32 (r | g<<8 | b<<16 | a<<24) -> [r,g,b,a] in 0..1.
export function unpackColor(rgba){
 const v=rgba>>>0;return [(v&255)/255,(v>>>8&255)/255,(v>>>16&255)/255,(v>>>24&255)/255];
}

// Billboard half extents for a prototype seen with a camera pitched so that forward.y = sinPitch: the image frame
// spans the horizontal radius and the vertical extent tilts towards the radius when looking down (Unity's
// billboard angle factor lerps billboard height towards width the same way).
export function billboardHalfSize(radius,halfHeight,sinPitch){
 const s=Math.min(1,Math.abs(sinPitch)),c=Math.sqrt(1-s*s);
 return [radius,halfHeight*c+radius*s];
}

const PAD=1.08; // imposter tiles keep a transparent margin so mipmaps do not bleed between prototypes

const billboardVertex=`
attribute vec3 iPos;attribute vec2 iScale;attribute vec3 iColor;attribute float iProto;
uniform vec3 protoCenter[4];uniform vec2 protoSize[4];uniform vec2 protoTile[4];
uniform vec3 camRight,camUp,camFwd,viewPos;uniform vec2 pitchCS;uniform vec2 range;uniform float tileScale;
varying vec2 vUv;varying vec3 vColor;
#include <fog_pars_vertex>
void main(){
 int p=int(iProto+0.5);
 float d=distance(iPos,viewPos);
 if(d<range.x||d>range.y){gl_Position=vec4(2.0,2.0,2.0,1.0);return;}
 vec3 c=iPos+protoCenter[p]*vec3(iScale.x,iScale.y,iScale.x);
 float hw=protoSize[p].x*iScale.x*${PAD.toFixed(2)},hh=(protoSize[p].y*iScale.y*pitchCS.x+protoSize[p].x*iScale.x*pitchCS.y)*${PAD.toFixed(2)};
 vec3 w=c+camRight*position.x*hw+camUp*position.y*hh;
 vUv=(protoTile[p]+position.xy*0.5+0.5)*tileScale;vColor=iColor;
 vec4 mvPosition=viewMatrix*vec4(w,1.0);gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
const billboardFragment=`
uniform sampler2D atlas;uniform float atlasSize;varying vec2 vUv;varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
 vec4 t=texture2D(atlas,vUv);
 // Alpha-to-coverage: minified texels keep their averaged leaf coverage (so density matches the mesh trees);
 // magnified ones are sharpened back to the imposter's alpha-tested edge.
 vec2 dx=dFdx(vUv*atlasSize),dy=dFdy(vUv*atlasSize);float mip=0.5*log2(max(max(dot(dx,dx),dot(dy,dy)),1e-8));
 float a=mix(clamp((t.a-0.5)/max(fwidth(t.a),0.0001)+0.5,0.0,1.0),t.a,clamp(mip+1.0,0.0,1.0));
 if(a<0.01)discard;
 // The atlas holds the mesh shaders' linear-decoded output; the TreeInstance tint multiplies in gamma space.
 vec3 g=sRGBTransferOETF(vec4(t.rgb/max(t.a,0.001),1.0)).rgb*vColor;
 gl_FragColor=vec4(sRGBTransferEOTF(vec4(g,1.0)).rgb,a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 #ifdef USE_FOG
 gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,clamp((vFogDepth-fogNear)/(fogFar-fogNear),0.0,1.0)); // Unity linear fog
 #endif
}`;

// Tree Creator materials (browser/legacy-materials.mjs): Bark Optimized (light pre-pass BlinnPhong, _BumpSpecMap normal
// and spec power, gloss = _TranslucencyMap.a * _Color.r, albedo * baked AO) and Leaves Fast Optimized (per-vertex
// wrap-around diffuse + translucency, AO emphasised as (ao + 0.1)^3, alpha test). The TreeInstance colour is _Color.
// Both squash towards the billboard plane through the bounds centre (_SquashPlaneNormal / _SquashAmount).
const FALLBACK_SHADERS={'Optimized Bark Material':'Hidden/Nature/Tree Creator Bark Optimized','Optimized Leaf Material':'Hidden/Nature/Tree Creator Leaves Fast Optimized'};
async function treeMaterial(part,description,texture,center,shared,wind){
 const d=description??{name:part.name,shader:FALLBACK_SHADERS[part.name],textures:{_MainTex:{file:part.texture}},floats:{_Cutoff:part.cutoff},colors:{}};
 const mat=await createLegacyMaterial(d,slot=>texture(slot.file));mat.userData.forwardOnly=/Leaves/.test(d.shader??'');return legacyTreeVariant(mat,{squashCenter:center,squashNormal:shared.squashNormal,wind});
}

// placements: [[x,y,z,prototype,widthScale,heightScale,colorRGBA32?],...] (three.js coordinates).
// models: exported tree-N.json objects; texture(name) -> Promise<THREE.Texture>.
// materials: world-materials.json trees (per prototype {parts:[{name,shader,textures,floats,colors}]}), optional.
// wind: render-extras.json {windZone, treeWind:[{vertices, branchPhase, edgeFlutter, primary, secondary}]}, optional.
export async function createTreeRenderer({renderer,scene,placements,models,texture,materials=null,settings=ORIGINAL_TREE_SETTINGS,tile=512,cellSize=1000,wind=null,idleInterval=IMPOSTER_IDLE_SECONDS}){
 const s={...settings},count=placements.length,protoCount=models.length;
 if(protoCount>4)throw Error('Tree billboard shader supports four prototypes');
 const shared={squashNormal:{value:new THREE.Vector3(0,0,-1)},lodBias:{value:0}};
 // _Wind (Unity space) and _Time.y for the mesh trees; every prototype needs its per-vertex channels to sway.
 const windZone=wind?.windZone??null,windUniforms={force:{value:new THREE.Vector4()},time:{value:0}};
 const windData=windZone&&wind.treeWind?.length===protoCount&&wind.treeWind.every((t,i)=>t.vertices===models[i].positions.length/3)?wind.treeWind:null;
 // Prototype geometry/materials and bounds.
 const protos=[];
 for(const [protoIndex,model] of models.entries()){
  const pos=new THREE.Float32BufferAttribute(model.positions,3),nrm=new THREE.Float32BufferAttribute(model.normals,3),uv=new THREE.Float32BufferAttribute(model.uv,2);
  const ao=new THREE.Float32BufferAttribute(model.ao??new Array(model.positions.length/3).fill(1),1);
  let windAttr=null;if(windData){const w=windData[protoIndex],n=w.vertices,a=new Float32Array(n*4);for(let i=0;i<n;i++){a[i*4]=w.branchPhase[i]/255;a[i*4+1]=w.edgeFlutter[i]/255;a[i*4+2]=w.primary[i];a[i*4+3]=w.secondary[i];}windAttr=new THREE.Float32BufferAttribute(a,4);}
  const box=new THREE.Box3().setFromBufferAttribute(pos),center=model.bounds?new THREE.Vector3(...model.bounds.center):box.getCenter(new THREE.Vector3());
  const halfHeight=model.bounds?model.bounds.extent[1]:(box.max.y-box.min.y)/2;
  let radius=0;for(let i=0;i<pos.count;i++)radius=Math.max(radius,Math.hypot(pos.getX(i)-center.x,pos.getZ(i)-center.z));
  const parts=[];
  for(const part of model.parts){
   const g=new THREE.BufferGeometry();g.setAttribute('position',pos);g.setAttribute('normal',nrm);g.setAttribute('uv',uv);g.setAttribute('ao',ao);if(windAttr)g.setAttribute('treeWind',windAttr);g.setIndex(part.indices);g.computeBoundingSphere();
   const material=await treeMaterial(part,materials?.[protoIndex]?.parts.find(p=>p.name===part.name),texture,center,shared,windAttr?windUniforms:null);
   parts.push({geometry:g,material});
  }
  protos.push({parts,center,radius,halfHeight,boundRadius:Math.hypot(radius,halfHeight)});
 }
 const vegetation=protos.map(p=>p.parts);

 // Per-tree data.
 const px=new Float32Array(count),py=new Float32Array(count),pz=new Float32Array(count),proto=new Uint8Array(count),ws=new Float32Array(count),hs=new Float32Array(count),colors=new Float32Array(count*3);
 const tint=new THREE.Color();
 placements.forEach((p,i)=>{px[i]=p[0];py[i]=p[1];pz[i]=p[2];proto[i]=p[3];ws[i]=p[4];hs[i]=p[5];const [r,g,b]=p.length>6?unpackColor(p[6]):[1,1,1];tint.setRGB(r,g,b);colors[i*3]=tint.r;colors[i*3+1]=tint.g;colors[i*3+2]=tint.b;});
 // 2-D grid (CSR) for gathering trees near the camera.
 const G=32,minX=-8000,minZ=-8000,gw=Math.ceil(16000/G),cellOf=(x,z)=>Math.min(gw-1,Math.max(0,Math.floor((x-minX)/G)))+Math.min(gw-1,Math.max(0,Math.floor((z-minZ)/G)))*gw;
 const gridStart=new Int32Array(gw*gw+1),gridItems=new Int32Array(count);
 for(let i=0;i<count;i++)gridStart[cellOf(px[i],pz[i])+1]++;
 for(let c=0;c<gw*gw;c++)gridStart[c+1]+=gridStart[c];
 {const fill=gridStart.slice(0,-1);for(let i=0;i<count;i++)gridItems[fill[cellOf(px[i],pz[i])]++]=i;}

 // Imposter atlas: one tile per prototype, rendered from the real meshes with the camera's rotation.
 const across=protoCount>1?2:1,atlasSize=tile*across;
 // Half-float keeps dark foliage free of banding; fall back to 8-bit where float colour buffers are unavailable.
 const floatTarget=renderer.extensions.has('EXT_color_buffer_float')||renderer.extensions.has('EXT_color_buffer_half_float');
 const atlas=new THREE.WebGLRenderTarget(atlasSize,atlasSize,{type:floatTarget?THREE.HalfFloatType:THREE.UnsignedByteType,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
 atlas.texture.colorSpace=THREE.NoColorSpace;atlas.texture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
 const imposterScene=new THREE.Scene(),imposterCamera=new THREE.OrthographicCamera(-1,1,1,-1,0.1,200);
 const iHemi=new THREE.HemisphereLight(0xffffff,0xffffff,0),iSun=new THREE.DirectionalLight(0xffffff,0),iAmb=new THREE.AmbientLight(0xffffff,0);imposterScene.add(iHemi,iSun,iSun.target,iAmb);
 // Own material instances (clone() does not copy the shader hook, so it is re-applied) with the TREE_IMPOSTER mip bias.
 const imposterGroups=protos.map(p=>{const g=new THREE.Group();for(const part of p.parts)g.add(new THREE.Mesh(part.geometry,legacyTreeVariant(part.material.clone(),{squashCenter:p.center,squashNormal:shared.squashNormal,lodBias:shared.lodBias,imposter:true})));g.visible=false;imposterScene.add(g);return g;});
 const lastFwd=new THREE.Vector3(),clear=new THREE.Color();let lastImposter=-Infinity,imposterRenders=0,windStart=null;
 const idle=new TerrainIdleRefresh(idleInterval),idlePos=[0,0,0],idleFwd=[0,0,0];
 function syncLights(){let dir=null,hemi=null,amb=null;
  for(const o of scene.children){if(!o.visible)continue;if(o.isDirectionalLight&&!dir)dir=o;else if(o.isHemisphereLight&&!hemi)hemi=o;else if(o.isAmbientLight&&!amb)amb=o;}
  iSun.intensity=dir?dir.intensity:0;if(dir){iSun.color.copy(dir.color);iSun.position.copy(dir.position).sub(dir.target.position).normalize().multiplyScalar(100);}
  iHemi.intensity=hemi?hemi.intensity:0;if(hemi){iHemi.color.copy(hemi.color);iHemi.groundColor.copy(hemi.groundColor);iHemi.position.copy(hemi.position);}
  iAmb.intensity=amb?amb.intensity:0;if(amb)iAmb.color.copy(amb.color);}
 const camQuat=new THREE.Quaternion(),fwd=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3(),camPos=new THREE.Vector3();
 const bufferSize=new THREE.Vector2();
 function renderImposters(camera){
  syncLights();
  // On-screen pixels per metre at the billboard distance, for the imposter mip bias.
  const screenPerMetre=renderer.getDrawingBufferSize(bufferSize).y/(2*Math.tan(THREE.MathUtils.degToRad((camera?.fov??60)/2))*s.treeBillboardDistance);
  const prevTarget=renderer.getRenderTarget(),prevAuto=renderer.autoClear,prevAlpha=renderer.getClearAlpha();renderer.getClearColor(clear);
  renderer.autoClear=false;renderer.setRenderTarget(atlas);renderer.setClearColor(0x000000,0);renderer.clear(true,true,false);
  const sinP=fwd.y;
  for(let p=0;p<protoCount;p++){
   const pr=protos[p],[hw,hh]=billboardHalfSize(pr.radius,pr.halfHeight,sinP),reach=pr.boundRadius+5;
   imposterCamera.left=-hw*PAD;imposterCamera.right=hw*PAD;imposterCamera.top=hh*PAD;imposterCamera.bottom=-hh*PAD;imposterCamera.near=0.1;imposterCamera.far=reach*2;imposterCamera.updateProjectionMatrix();
   imposterCamera.quaternion.copy(camQuat);imposterCamera.position.copy(pr.center).addScaledVector(fwd,-reach);imposterCamera.updateMatrixWorld(true);
   const tx=(p%across)*tile,ty=Math.floor(p/across)*tile;atlas.viewport.set(tx,ty,tile,tile);atlas.scissor.set(tx,ty,tile,tile);atlas.scissorTest=true;
   imposterGroups.forEach((g,i)=>g.visible=i===p);
   shared.lodBias.value=Math.max(0,Math.log2(tile/(2*hh*PAD)/screenPerMetre));
   atlas.texture.generateMipmaps=p===protoCount-1; // build the mip chain once, after the last tile
   renderer.setRenderTarget(atlas);renderer.render(imposterScene,imposterCamera);
  }
  atlas.texture.generateMipmaps=true;atlas.scissorTest=false;atlas.viewport.set(0,0,atlasSize,atlasSize);atlas.scissor.set(0,0,atlasSize,atlasSize);
  renderer.setRenderTarget(prevTarget);renderer.autoClear=prevAuto;renderer.setClearColor(clear,prevAlpha);
  lastFwd.copy(fwd);imposterRenders++;
 }

 // Billboard materials: static per-cell batches draw [billboardDistance, treeDistance]; the overflow batch draws the
 // near trees beyond the mesh-tree cap.
 const bbUniforms={atlas:{value:atlas.texture},atlasSize:{value:atlasSize},tileScale:{value:1/across},
  protoCenter:{value:Array.from({length:4},(_,i)=>protos[i]?.center.clone()??new THREE.Vector3())},
  protoSize:{value:Array.from({length:4},(_,i)=>new THREE.Vector2(protos[i]?.radius??0,protos[i]?.halfHeight??0))},
  protoTile:{value:Array.from({length:4},(_,i)=>new THREE.Vector2(i%across,Math.floor(i/across)))},
  camRight:{value:new THREE.Vector3(1,0,0)},camUp:{value:new THREE.Vector3(0,1,0)},camFwd:{value:new THREE.Vector3(0,0,-1)},viewPos:{value:new THREE.Vector3()},pitchCS:{value:new THREE.Vector2(1,0)}};
 function billboardMaterial(near,far){const m=new THREE.ShaderMaterial({uniforms:{...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),...bbUniforms,range:{value:new THREE.Vector2(near,far)}},vertexShader:billboardVertex,fragmentShader:billboardFragment,fog:true,side:THREE.DoubleSide,alphaToCoverage:true});m.name='Terrain tree billboard';return m;}
 const farMaterial=billboardMaterial(s.treeBillboardDistance,s.treeDistance),nearMaterial=billboardMaterial(0,s.treeDistance);
 // Each batch owns its quad buffers so disposing one (the near batch grows) never frees another's.
 function billboardGeometry(capacity){const g=new THREE.InstancedBufferGeometry();g.setIndex([0,1,2,0,2,3]);g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
  for(const [name,size] of [['iPos',3],['iScale',2],['iColor',3],['iProto',1]])g.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size));g.instanceCount=0;return g;}
 function writeBillboard(g,slot,i){g.attributes.iPos.setXYZ(slot,px[i],py[i],pz[i]);g.attributes.iScale.setXY(slot,ws[i],hs[i]);g.attributes.iColor.setXYZ(slot,colors[i*3],colors[i*3+1],colors[i*3+2]);g.attributes.iProto.setX(slot,proto[i]);}
 const group=new THREE.Group();group.name='Terrain trees';scene.add(group);
 const cells=new Map();
 for(let i=0;i<count;i++){const key=Math.floor((px[i]-minX)/cellSize)+','+Math.floor((pz[i]-minZ)/cellSize);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);}
 const billboardCells=[];
 for(const items of cells.values()){const g=billboardGeometry(items.length);const box=new THREE.Box3();let maxSize=0;
  items.forEach((i,slot)=>{writeBillboard(g,slot,i);box.expandByPoint(new THREE.Vector3(px[i],py[i],pz[i]));maxSize=Math.max(maxSize,protos[proto[i]].boundRadius*Math.max(ws[i],hs[i])*2*PAD);});
  g.instanceCount=items.length;g.boundingSphere=box.getBoundingSphere(new THREE.Sphere());g.boundingSphere.radius+=maxSize;
  const mesh=new THREE.Mesh(g,farMaterial);mesh.name='Tree billboards';mesh.renderOrder=FORWARD_OPAQUE_ORDER;mesh.matrixAutoUpdate=false;group.add(mesh);billboardCells.push({mesh,box:box.expandByScalar(0),items});}
 let nearCapacity=256,nearGeometry=billboardGeometry(nearCapacity);const nearMesh=new THREE.Mesh(nearGeometry,nearMaterial);nearMesh.name='Tree billboards (near)';nearMesh.renderOrder=FORWARD_OPAQUE_ORDER;nearMesh.frustumCulled=false;nearMesh.matrixAutoUpdate=false;group.add(nearMesh);

 // Full mesh trees: per prototype part an instanced batch sized to the cap.
 const cap=Math.max(0,s.treeMaximumFullLODCount|0),meshBatches=protos.map(p=>{
  const matrices=new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1,cap)*16),16),tints=new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1,cap)*3),3),squash=new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1,cap)),1);
  matrices.setUsage(THREE.DynamicDrawUsage);tints.setUsage(THREE.DynamicDrawUsage);squash.setUsage(THREE.DynamicDrawUsage);
  const meshes=p.parts.map(part=>{const g=part.geometry;g.setAttribute('treeSquash',squash);const m=new THREE.InstancedMesh(g,part.material,Math.max(1,cap));m.instanceMatrix=matrices;m.instanceColor=tints;m.count=0;m.frustumCulled=false;m.name='Tree meshes';if(part.material.userData.forwardOnly)m.renderOrder=FORWARD_OPAQUE_ORDER;m.matrixAutoUpdate=false;group.add(m);return m;});
  return {meshes,matrices,tints,squash,used:0};});

 const frustum=new THREE.Frustum(),projView=new THREE.Matrix4(),sphere=new THREE.Sphere(),matrix=new THREE.Matrix4(),scale=new THREE.Vector3(),identity=new THREE.Quaternion(),position=new THREE.Vector3();
 const candidates=[];let stats={full:0,overflow:0,billboards:0,visible:0,imposterRenders:0},lastCount=new THREE.Vector3(Infinity,0,0),visibleCount=0;
 function countVisible(){ // trees drawn as mesh or billboard (within treeDistance), frustum not considered
  const r=s.treeDistance,c0x=Math.max(0,Math.floor((camPos.x-r-minX)/G)),c1x=Math.min(gw-1,Math.floor((camPos.x+r-minX)/G)),c0z=Math.max(0,Math.floor((camPos.z-r-minZ)/G)),c1z=Math.min(gw-1,Math.floor((camPos.z+r-minZ)/G));
  let n=0;const r2=r*r;for(let cz=c0z;cz<=c1z;cz++)for(let cx=c0x;cx<=c1x;cx++){const c=cx+cz*gw;for(let k=gridStart[c];k<gridStart[c+1];k++){const i=gridItems[k],dx=px[i]-camPos.x,dy=py[i]-camPos.y,dz=pz[i]-camPos.z;if(dx*dx+dy*dy+dz*dz<=r2)n++;}}
  visibleCount=n;lastCount.copy(camPos);}
 let updateMs=0;
 function update(camera,now=performance.now()/1000){
  const t0=performance.now();camera.updateMatrixWorld();camera.getWorldPosition(camPos);camera.getWorldQuaternion(camQuat);
  const e=camera.matrixWorld.elements;right.set(e[0],e[1],e[2]).normalize();up.set(e[4],e[5],e[6]).normalize();fwd.set(-e[8],-e[9],-e[10]).normalize();
  // Billboard images follow the camera's rotation; TerrainControl forces a refresh when the camera has been idle.
  idlePos[0]=camPos.x;idlePos[1]=camPos.y;idlePos[2]=-camPos.z;idleFwd[0]=fwd.x;idleFwd[1]=fwd.y;idleFwd[2]=-fwd.z;
  const forced=idle.update(now,idlePos,idleFwd);
  if(fwd.dot(lastFwd)<Math.cos(IMPOSTER_TURN_DEGREES*Math.PI/180)||forced||lastImposter===-Infinity){renderImposters(camera);lastImposter=now;}
  if(windZone){if(windStart===null)windStart=now;const t=now-windStart;windUniforms.time.value=t;windUniforms.force.value.fromArray(windZoneForce(windZone,t));}
  bbUniforms.camRight.value.copy(right);bbUniforms.camUp.value.copy(up);bbUniforms.camFwd.value.copy(fwd);bbUniforms.viewPos.value.copy(camPos);
  {const sp=Math.min(1,Math.abs(fwd.y));bbUniforms.pitchCS.value.set(Math.sqrt(1-sp*sp),sp);}
  shared.squashNormal.value.copy(fwd);
  // Static billboard cells: only those overlapping the [billboardDistance, treeDistance] shell.
  for(const cell of billboardCells){const near=cell.box.distanceToPoint(camPos);let far=0;for(const x of [cell.box.min.x,cell.box.max.x])for(const y of [cell.box.min.y,cell.box.max.y])for(const z of [cell.box.min.z,cell.box.max.z])far=Math.max(far,Math.hypot(x-camPos.x,y-camPos.y,z-camPos.z));
   cell.mesh.visible=near<=s.treeDistance&&far>=s.treeBillboardDistance;}
  // Visible trees nearer than the billboard distance compete for the mesh-tree cap.
  projView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projView);
  candidates.length=0;const r=s.treeBillboardDistance,r2=r*r,c0x=Math.max(0,Math.floor((camPos.x-r-minX)/G)),c1x=Math.min(gw-1,Math.floor((camPos.x+r-minX)/G)),c0z=Math.max(0,Math.floor((camPos.z-r-minZ)/G)),c1z=Math.min(gw-1,Math.floor((camPos.z+r-minZ)/G));
  for(let cz=c0z;cz<=c1z;cz++)for(let cx=c0x;cx<=c1x;cx++){const c=cx+cz*gw;for(let k=gridStart[c];k<gridStart[c+1];k++){const i=gridItems[k],dx=px[i]-camPos.x,dy=py[i]-camPos.y,dz=pz[i]-camPos.z,d2=dx*dx+dy*dy+dz*dz;if(d2>=r2)continue;
   const pr=protos[proto[i]];sphere.center.set(px[i]+pr.center.x*ws[i],py[i]+pr.center.y*hs[i],pz[i]+pr.center.z*ws[i]);sphere.radius=pr.boundRadius*Math.max(ws[i],hs[i]);if(!frustum.intersectsSphere(sphere))continue;
   candidates.push({index:i,distance:Math.sqrt(d2)});}}
  const {full,overflow}=selectFullTrees(candidates,s);
  for(const b of meshBatches)b.used=0;
  for(const t of full){const i=t.index,b=meshBatches[proto[i]],slot=b.used++;matrix.compose(position.set(px[i],py[i],pz[i]),identity,scale.set(ws[i],hs[i],ws[i]));matrix.toArray(b.matrices.array,slot*16);
   b.tints.array.set(colors.subarray(i*3,i*3+3),slot*3);b.squash.array[slot]=t.squash;}
  for(const b of meshBatches){for(const m of b.meshes)m.count=b.used;if(b.used){b.matrices.needsUpdate=b.tints.needsUpdate=b.squash.needsUpdate=true;b.matrices.addUpdateRange(0,b.used*16);b.tints.addUpdateRange(0,b.used*3);b.squash.addUpdateRange(0,b.used);}}
  if(overflow.length>nearCapacity){while(nearCapacity<overflow.length)nearCapacity*=2;nearGeometry.dispose();nearGeometry=billboardGeometry(nearCapacity);nearMesh.geometry=nearGeometry;}
  overflow.forEach((i,slot)=>writeBillboard(nearGeometry,slot,i));nearGeometry.instanceCount=overflow.length;
  if(overflow.length)for(const a of ['iPos','iScale','iColor','iProto']){const attr=nearGeometry.attributes[a];attr.needsUpdate=true;attr.clearUpdateRanges();attr.addUpdateRange(0,overflow.length*attr.itemSize);}
  nearMesh.visible=overflow.length>0;
  if(lastCount.distanceToSquared(camPos)>100)countVisible();
  updateMs=updateMs*0.9+(performance.now()-t0)*0.1;
  stats={full:full.length,overflow:overflow.length,candidates:candidates.length,billboardCells:billboardCells.filter(c=>c.mesh.visible).length,visible:visibleCount,imposterRenders,idleRefreshes:idle.refreshes,wind:Boolean(windData),updateMs:Math.round(updateMs*1000)/1000};
  return stats;
 }
 function dispose(){scene.remove(group);atlas.dispose();farMaterial.dispose();nearMaterial.dispose();nearGeometry.dispose();for(const c of billboardCells)c.mesh.geometry.dispose();
  for(const b of meshBatches)for(const m of b.meshes)m.dispose();for(const g of imposterGroups)for(const m of g.children)m.material.dispose();for(const p of protos)for(const part of p.parts){part.geometry.dispose();part.material.dispose();}}
 return {group,vegetation,settings:s,update,dispose,atlas,get stats(){return stats;},get visibleCount(){return visibleCount;},
  // terrain.idleinterval (seconds; 0 or less: never forced).
  setIdleInterval(v){idle.interval=Number(v);},
  // terrain.flushtrees: TerrainHack.RefreshTreeTextures (re-render the billboard images on the next update).
  refreshImposters(){lastImposter=-Infinity;},
  wind:()=>({active:Boolean(windData),force:windUniforms.force.value.toArray(),time:windUniforms.time.value,zone:windZone&&{main:windZone.windMain,turbulence:windZone.windTurbulence}}),
  idle:()=>({interval:idle.interval,refreshes:idle.refreshes,imposterRenders})};
}
