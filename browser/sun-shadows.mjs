import * as THREE from 'three';
import {cascadeRanges,frustumSliceSphere,shadowFade,softShadowRadius} from './quality.mjs';

// Original sun shadows (Unity 4 Deferred Lighting, directional light, Stable Fit cascades). In the original the sun's
// shadow is collected in screen space (Internal-PrePassCollectShadows: the first split sphere containing the pixel picks
// the cascade, shadow = depth test ? 1 : 1 - strength) and multiplies only the sun's light-buffer term
// (Internal-PrePassLighting: atten = saturate(shadow + saturate(d * _LightShadowData.z + _LightShadowData.w))), the
// specular term included. Ambient (RenderSettings.ambientLight) and point/spot lights are never shadowed by it.
//
// Port: one three.js DirectionalLight per cascade renders the depth map (three's WebGLShadowMap: per-object castShadow,
// frustum culling, skinned/instanced variants, customDepthMaterial for cutouts). Those lights are black (they add no
// light to any material); the legacy shaders (legacy-materials.mjs, grass.mjs) select the cascade by split sphere in the
// fragment and attenuate only the real sun/moon light (the directional lights after the shadow casters, which three sorts
// first). Cascade maps are fitted to the spheres with texel snapping (Stable Fit: no shimmering while turning).
// Approximations: Unity's soft shadows blur the screen-space shadow (Shadow-ScreenBlur); here soft = 5-tap PCF in the map.
// Bias is tuned in map texels (Unity 4's bias units are engine-internal). Fade centre = camera position.

export const MAX_CASCADES=4;
// Shared by every material that receives the sun shadow (same objects: one update per frame reaches all programs).
export const SUN_SHADOW_UNIFORMS={
 legacyShadowSpheres:{value:Array.from({length:MAX_CASCADES},()=>new THREE.Vector4(0,0,0,0))}, // xyz centre (world), w radius^2
 legacyShadowBias:{value:Array.from({length:MAX_CASCADES},()=>new THREE.Vector4(0,0,0,0))},     // x normal offset (m), y depth bias, z PCF radius (texels)
 legacyShadowFade:{value:new THREE.Vector4(0,0,1,0)},                                           // x fade scale, y fade bias, z strength, w enabled
};
// View-model pass (its own scene, no shadow casters): Unity reconstructed the held item's pixels just in front of the
// camera from the depth buffer, so the view model takes the sun shadow at the eye. Coordinate computed on the CPU.
// Without a shadow map (Fastest/Fast have no sun shadows) the sampler2DShadow still needs a depth texture bound: an empty
// RGBA fallback makes WebGL reject every view-model draw (format/sampler mismatch). A 1x1 compare-mode depth texture.
const NO_EYE_SHADOW=Object.assign(new THREE.DepthTexture(1,1,THREE.UnsignedIntType),{compareFunction:THREE.LessEqualCompare});NO_EYE_SHADOW.needsUpdate=true;
export const EYE_SHADOW_UNIFORMS={legacyEyeShadowMap:{value:NO_EYE_SHADOW},legacyEyeShadowCoord:{value:new THREE.Vector4(0,0,2,1)},legacyEyeShadowParams:{value:new THREE.Vector4(0,1,0,0)}};

// Fragment code: legacySunShadow(view-space position, view-space geometric normal) -> 0..1 for the sun term.
// Needs <lights_pars_begin> (receiveShadow) and <shadowmap_pars_fragment> (getShadow, directionalShadowMap...).
export const SUN_SHADOW_GLSL=`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
uniform vec4 legacyShadowSpheres[ ${MAX_CASCADES} ];uniform vec4 legacyShadowBias[ ${MAX_CASCADES} ];uniform vec4 legacyShadowFade;
#define LEGACY_CASCADE(c) { vec4 sc=directionalShadowMatrix[ c ]*vec4(wp+wn*legacyShadowBias[ c ].x,1.0); s=getShadow(directionalShadowMap[ c ],directionalLightShadows[ c ].shadowMapSize,legacyShadowFade.z,legacyShadowBias[ c ].y,legacyShadowBias[ c ].z,sc); }
#endif
float legacySunShadow(vec3 viewPos,vec3 viewNormal){
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
 if(!receiveShadow||legacyShadowFade.w<0.5)return 1.0;
 mat3 rT=transpose(mat3(viewMatrix));vec3 wp=rT*(viewPos-viewMatrix[3].xyz),wn=normalize(rT*viewNormal);
 int c=-1;
 for(int i=NUM_DIR_LIGHT_SHADOWS-1;i>=0;i--){vec3 d=wp-legacyShadowSpheres[i].xyz;if(dot(d,d)<legacyShadowSpheres[i].w)c=i;}
 if(c<0)return 1.0;
 float s=1.0;
 if(c==0)LEGACY_CASCADE(0)
 #if NUM_DIR_LIGHT_SHADOWS > 1
 else if(c==1)LEGACY_CASCADE(1)
 #endif
 #if NUM_DIR_LIGHT_SHADOWS > 2
 else if(c==2)LEGACY_CASCADE(2)
 #endif
 #if NUM_DIR_LIGHT_SHADOWS > 3
 else if(c==3)LEGACY_CASCADE(3)
 #endif
 return saturate(s+saturate(distance(wp,cameraPosition)*legacyShadowFade.x+legacyShadowFade.y));
#else
 return 1.0;
#endif
}
// Directional lights before this index are the black shadow casters.
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
#define LEGACY_FIRST_SUN NUM_DIR_LIGHT_SHADOWS
#else
#define LEGACY_FIRST_SUN 0
#endif
`;
// Only in passes without the cascade casters (the view-model scene): a material shared with the world keeps its own shadow there.
export const EYE_SHADOW_GLSL=`
#if defined( LEGACY_EYE_SHADOW ) && !( defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 )
uniform sampler2DShadow legacyEyeShadowMap;uniform vec4 legacyEyeShadowCoord;uniform vec4 legacyEyeShadowParams;
float legacyEyeShadow(){if(legacyEyeShadowParams.x<0.5)return 1.0;vec3 c=legacyEyeShadowCoord.xyz;
 if(c.x<0.0||c.x>1.0||c.y<0.0||c.y>1.0||c.z>1.0)return 1.0;
 return mix(1.0,texture(legacyEyeShadowMap,vec3(c.xy,c.z+legacyEyeShadowParams.z)),legacyEyeShadowParams.y);}
#else
float legacyEyeShadow(){return 1.0;}
#endif
`;

// Shadow-caster depth material for alpha-tested legacy materials (Transparent/Cutout ShadowCaster passes clip on
// _MainTex.a * _Color.a against _Cutoff with the material's own tiling).
const depthCache=new WeakMap();
export function legacyCutoutDepthMaterial(mat){
 if(depthCache.has(mat))return depthCache.get(mat);
 const u=mat.legacyUniforms,d=new THREE.MeshDepthMaterial({depthPacking:THREE.BasicDepthPacking});
 d.onBeforeCompile=shader=>{Object.assign(shader.uniforms,{legacyMainTex:u.legacyMainTex,legacyMainST:u.legacyMainST,legacyCutoff:u.legacyCutoff,legacyColor:u.legacyColor});
  shader.vertexShader='varying vec2 vLegacyUv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvLegacyUv=uv;');
  shader.fragmentShader='varying vec2 vLegacyUv;uniform sampler2D legacyMainTex;uniform vec4 legacyMainST;uniform float legacyCutoff;uniform vec4 legacyColor;\n'+
   shader.fragmentShader.replace('void main() {','void main() {\n if(texture2D(legacyMainTex,vLegacyUv*legacyMainST.xy+legacyMainST.zw).a*legacyColor.a<legacyCutoff)discard;');};
 d.customProgramCacheKey=()=>'legacy-cutout-depth';depthCache.set(mat,d);return d;
}

// Default receive/cast flags for one mesh from its material (most original renderers are cast 1 / receive 1; forward
// alpha-blended shaders neither cast nor receive in Unity 4).
export function defaultShadowFlags(material){
 const mats=Array.isArray(material)?material:[material];if(!mats.length||!mats.every(m=>m?.isLegacyMaterial))return null;
 // Terrain and its tree prototypes: TerrainControl castShadows 0 (the terrain and its trees cast none); they receive.
 if(mats.some(m=>m.terrainUniforms||m.legacyModel?.tree))return {cast:false,receive:true};
 if(!mats.every(m=>m.legacyModel))return null;
 const blend=mats.some(m=>m.legacyModel.blend),unlit=mats.some(m=>m.legacyModel.lighting==='unlit');
 return {cast:!blend&&!unlit,receive:!blend};
}
// userData.shadowFlags remembers the material the flags were derived from (source 'default'), so a mesh whose material is
// swapped later (e.g. a placement ghost) is re-evaluated; flags from the export or set by a module are kept.
export function applyShadowFlags(mesh,flags,source='set'){
 if(!flags)return;mesh.castShadow=Boolean(flags.cast);mesh.receiveShadow=Boolean(flags.receive);mesh.userData.shadowFlags={source,material:mesh.material};
 if(mesh.castShadow){const m=Array.isArray(mesh.material)?mesh.material.find(x=>x?.legacyModel?.cutout):mesh.material;if(m?.legacyModel?.cutout)mesh.customDepthMaterial=legacyCutoutDepthMaterial(m);}
}

// renderer: THREE.WebGLRenderer; scene: the world scene; sun: the TOD sun/moon DirectionalLight (lights the world).
export function createSunShadows({renderer,scene,sun}){
 renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.enabled=false;
 const lights=[],group=new THREE.Group();group.name='Sun shadow cascades';
 let settings={type:'none',cascades:0,distance:0,mapSize:0,strength:1,softness:0},stats={cascades:0,renders:0,lastUpdateMs:0,spheres:[]};
 const U=SUN_SHADOW_UNIFORMS,E=EYE_SHADOW_UNIFORMS,dir=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3(),fwd=new THREE.Vector3(),c=new THREE.Vector3(),tmp=new THREE.Vector3(),eyeMatrix=new THREE.Matrix4();
 function cascadeLight(i){if(!lights[i]){const l=new THREE.DirectionalLight(0x000000,0);l.name='Sun shadow cascade '+i;l.castShadow=true;l.shadow.autoUpdate=false;l.shadow.needsUpdate=false;
   l.shadow.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);group.add(l,l.target);lights[i]=l;}return lights[i];}
 // Quality change (effectiveQuality(...).shadows). Light count or map size changes recompile/reallocate once.
 function setQuality(s){
  const on=s.type!=='none',count=on?s.cascades:0;settings={...s};
  for(let i=0;i<lights.length;i++){const l=lights[i],use=i<count;
   if(!use){if(l.parent)group.remove(l,l.target);if(l.shadow.map){l.shadow.map.dispose();l.shadow.map=null;}continue;}}
  for(let i=0;i<count;i++){const l=cascadeLight(i);if(!l.parent)group.add(l,l.target);
   if(l.shadow.mapSize.x!==s.cascadeMapSize){l.shadow.mapSize.set(s.cascadeMapSize,s.cascadeMapSize);if(l.shadow.map){l.shadow.map.dispose();l.shadow.map=null;}}}
  if(on&&!group.parent)scene.add(group);else if(!on&&group.parent)scene.remove(group);
  renderer.shadowMap.enabled=on;U.legacyShadowFade.value.w=on?1:0;E.legacyEyeShadowParams.value.x=0;
  for(const v of U.legacyShadowSpheres.value)v.set(0,0,0,0);
  const fade=shadowFade(s.distance||1);U.legacyShadowFade.value.x=fade.scale;U.legacyShadowFade.value.y=fade.bias;U.legacyShadowFade.value.z=s.strength??1;
  stats.cascades=count;}
 // Per frame before the world render: fit the cascades to the camera, aim them along the sun and request a redraw.
 function update(camera){
  if(settings.type==='none'||!stats.cascades){E.legacyEyeShadowParams.value.x=0;return;}
  const t0=performance.now();sun.updateMatrixWorld();sun.target.updateMatrixWorld();
  dir.subVectors(sun.target.getWorldPosition(tmp),sun.getWorldPosition(c)).normalize();
  // Light-space basis for texel snapping.
  up.set(0,1,0);if(Math.abs(dir.y)>0.99)up.set(1,0,0);right.crossVectors(dir,up).normalize();up.crossVectors(right,dir).normalize();
  camera.getWorldDirection(fwd);
  const tanHalfY=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),ranges=cascadeRanges(stats.cascades,settings.distance,camera.near);
  const radius=settings.type==='soft'?softShadowRadius(settings.softness):0;stats.spheres=[];
  for(let i=0;i<stats.cascades;i++){const l=lights[i],[n,f]=ranges[i],sphere=frustumSliceSphere(n,f,tanHalfY,camera.aspect),r=sphere.radius;
   c.copy(camera.position).addScaledVector(fwd,sphere.center);
   // Snap the centre to the map's texel grid in light space.
   const size=l.shadow.mapSize.x,texel=2*r/size,x=c.dot(right),y=c.dot(up);
   c.addScaledVector(right,Math.round(x/texel)*texel-x).addScaledVector(up,Math.round(y/texel)*texel-y);
   const pull=Math.max(r,300); // casters up to 300 m towards the sun from the sphere still reach it
   l.position.copy(c).addScaledVector(dir,-(r+pull));l.target.position.copy(c);
   const cam=l.shadow.camera;cam.left=-r;cam.right=r;cam.top=r;cam.bottom=-r;cam.near=0;cam.far=2*r+pull;cam.updateProjectionMatrix();
   l.updateMatrixWorld();l.target.updateMatrixWorld();l.shadow.needsUpdate=true;
   U.legacyShadowSpheres.value[i].set(c.x,c.y,c.z,r*r);
   // Bias: normal offset ~1.5 texels, depth bias ~1 texel of the map's depth range.
   U.legacyShadowBias.value[i].set(texel*1.5,-texel/cam.far,radius,0);stats.spheres.push({near:n,far:f,radius:+r.toFixed(2),texel:+texel.toFixed(4)});}
  renderer.shadowMap.needsUpdate=true;stats.renders++;
  // Eye shadow for the view-model pass (cascade 0 holds the camera). three sets shadow.matrix during the shadow render;
  // the same pose (LightShadow.updateMatrices: camera at the light, lookAt the target) gives this frame's coordinate.
  const l0=lights[0],sc=l0.shadow.camera;sc.position.copy(l0.position);sc.lookAt(l0.target.position);sc.updateMatrixWorld();
  const m=eyeMatrix.set(0.5,0,0,0.5,0,0.5,0,0.5,0,0,0.5,0.5,0,0,0,1).multiply(sc.projectionMatrix).multiply(sc.matrixWorldInverse);
  const eye=tmp.copy(camera.position).applyMatrix4(m);E.legacyEyeShadowCoord.value.set(eye.x,eye.y,eye.z,1);
  const eyeMap=l0.shadow.map?.depthTexture??null;E.legacyEyeShadowMap.value=eyeMap??NO_EYE_SHADOW;E.legacyEyeShadowParams.value.set(eyeMap?1:0,settings.strength??1,U.legacyShadowBias.value[0].y,0);
  stats.lastUpdateMs=performance.now()-t0;}
 return {group,lights,setQuality,update,get enabled(){return settings.type!=='none';},
  state:()=>({type:settings.type,cascades:stats.cascades,distance:settings.distance,mapSize:settings.mapSize,cascadeMapSize:settings.cascadeMapSize,strength:settings.strength,
   allocated:lights.slice(0,stats.cascades).filter(l=>l.shadow.map).length,renders:stats.renders,spheres:stats.spheres,enabled:renderer.shadowMap.enabled})};
}
