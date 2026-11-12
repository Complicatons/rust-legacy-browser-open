import * as THREE from 'three';
import {unityMatrix} from './deployables.mjs';
import {ATTEN_FADE_START,LEGACY_POINT_LIGHT_SCALE} from './legacy-materials.mjs';
// The original building/deploying preview (tools/export_placement.py -> assets/recovered/placement/):
// client StructureComponentItem.RenderPlacementHelpers and DeployableItem.PreCameraRender / RenderDeployPreview draw the
// held item's prefab with PrefabRenderer.RenderOneMaterial(camera, TRS(point, rot, scale), propertyBlock, overrideMat),
// and deployables also draw their aimGizmo (GameGizmoWaveAnimation: the bouncing BounceArrow mesh).
//  - RenderOneMaterial draws every listed part at the root matrix: the renderers' own transforms are not applied.
//  - Structures: scale one; _EmissionColor = green when valid, red otherwise, alpha 0.5 + |sin(8t)| * 0.25.
//  - Deployables: ObjectToPlace.transform.localScale; _EmissionColor = the gizmo's good/bad colour; the wave's value
//    (from the previous render) goes to _PushOut when valid, else _PushIn = value and _PushOut = -value.
//  - Both: _MainTex_ST = (1, 1, 0, Mathf.Repeat(t, 30)), replacing the material's own tiling.
// Custom/OutlineHover (compiled ARB programs, ForwardBase + ForwardAdd): the shell is drawn pushed out along the
// object-space normal by _PushOut; with V the view direction from the pushed-in (_PushIn) point,
// q = |V . (pOut - pIn)| / (_PushOut - _PushIn) and alpha = (1 - saturate(sqrt(2) |q| - (_PushOut - _PushIn)))
// * (1 - _MinAlpha) * _AlphaScale + _MinAlpha (AlphaTest Greater 0); colour = tex * light * 2 + tex * SH +
// tex.a * _EmissionColor.rgb * _EmissionColor.a. ZWrite Off, Blend SrcAlpha OneMinusSrcAlpha, Cull Back. The ForwardAdd
// pass (Blend SrcAlpha One, same alpha) is folded in as the point/spot light sum.

const H=new THREE.Matrix4().makeScale(1,1,-1);
// Color.green / Color.red.
export const GREEN=Object.freeze({r:0,g:1,b:0,a:1}),RED=Object.freeze({r:1,g:0,b:0,a:1});
// Mathf.Repeat(t, length).
export const repeat=(t,length)=>t-Math.floor(t/length)*length;
// StructureComponentItem.RenderPlacementHelpers' _EmissionColor.
export function structureEmission(valid,t){const c=valid?GREEN:RED;return {r:c.r,g:c.g,b:c.b,a:0.5+Math.abs(Math.sin(t*8))*0.25};}
export const scrollST=t=>[1,1,0,repeat(t,30)];

// GameGizmoWaveAnimation.Instance.Render: phase advances by frequency * elapsed seconds of NetCull.localTimeInMillis
// (whole milliseconds), wraps to [0, 1); the first half of a cycle uses amplitudePositive, the second amplitudeNegative.
export class GizmoWave {
 constructor(g){this.frequency=g.frequency;this.phase=g.phase??0;this.amplitudePositive=g.amplitudePositive;this.amplitudeNegative=g.amplitudeNegative;
  this.axis=g.axis;this.value=0;this.sine=0;this.started=false;this.lastRenderTime=0;}
 render(nowMs){const now=Math.floor(nowMs);
  if(!this.started||this.lastRenderTime>=now)this.started=true;else this.phase+=this.frequency*((now-this.lastRenderTime)*0.001);
  this.lastRenderTime=now;let p=this.phase;
  if(p>1)p=p===Infinity?0:p%1;else if(p===1)p=0;else if(p<0){if(p===-Infinity)p=0;else{p=(-p)%1;if(p>0)p=1-p;}}
  this.phase=p;let arc,amplitude;
  if(p<0.5){arc=p*(Math.PI*2);amplitude=this.amplitudePositive;}else{arc=(p*2-2)*Math.PI;amplitude=this.amplitudeNegative;}
  this.sine=Math.sin(arc);this.value=this.sine*amplitude;
  return this.value;}
 // The arrow's offset from the gizmo position: Axis * value (gizmo local space).
 offset(){return {x:Math.fround(this.axis.x*this.value),y:Math.fround(this.axis.y*this.value),z:Math.fround(this.axis.z*this.value)};}
}

// DeployableItem.PreCameraRender's property block (wave.value as left by the previous render).
export function deployableBlock(gizmo,wave,valid,t){const c=valid?gizmo.good:gizmo.bad,block={emission:{...c},st:scrollST(t)};
 if(wave){if(valid)block.pushOut=wave.value;else{block.pushIn=wave.value;block.pushOut=-wave.value;}}
 return block;}

// The OutlineHover alpha (JS twin of the fragment program) for a view direction V and the pushed points.
export function outlineAlpha(viewDotDelta,{pushOut,pushIn,minAlpha,alphaScale}){
 const d=pushOut-pushIn,q=Math.abs(viewDotDelta)/d,len=Math.sqrt(q*q+q*q);
 return (1-Math.min(1,Math.max(0,len-d)))*((1-minAlpha)*alphaScale)+minAlpha;}

// GameGizmo matrix (Unity space): TRS(position, rotation, 1) * T(axis * value) * R(Euler(alternateArrowDirection)).
export function gizmoMatrixU(position,rotation,gizmo,wave){const m=new THREE.Matrix4().compose(position,rotation,new THREE.Vector3(1,1,1));
 if(wave){const o=wave.offset();m.multiply(new THREE.Matrix4().makeTranslation(o.x,o.y,o.z));}
 const a=gizmo.alternateArrowDirection;if(a&&(a.x||a.y||a.z)){const r=Math.PI/180;m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(a.x*r,a.y*r,a.z*r,'YXZ')));}
 return m;}
export const browserMatrix=unity=>H.clone().multiply(unity).multiply(H);

// Parts drawn for a prefab: those on layers the main camera renders (QualitySettings camera cullingMask).
export const visibleParts=(parts,cullingMask)=>parts.filter(p=>cullingMask==null||((cullingMask>>>(p.layer??0))&1)===1);

const vertex=`
uniform float pushOut;uniform float pushIn;uniform vec4 mainST;
varying vec2 vUv;varying vec3 vOut;varying vec3 vIn;varying vec3 vN;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main(){
 vec3 n=normalize(normal);
 vec4 mvPosition=modelViewMatrix*vec4(position+n*pushOut,1.0);
 vec4 inner=modelViewMatrix*vec4(position+n*pushIn,1.0);
 vOut=mvPosition.xyz;vIn=inner.xyz;vN=normalize(normalMatrix*normal); // unity_Scale.w * normal: unit length
 vUv=uv*mainST.xy+mainST.zw;
 gl_Position=projectionMatrix*mvPosition;
 #include <logdepthbuf_vertex>
 #include <fog_vertex>
}`;
const fragment=`
uniform sampler2D map;uniform vec4 emission;uniform float pushOut;uniform float pushIn;uniform float minAlpha;uniform float alphaScale;
varying vec2 vUv;varying vec3 vOut;varying vec3 vIn;varying vec3 vN;
#include <common>
#include <lights_pars_begin>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
#define LEGACY_FIRST_SUN NUM_DIR_LIGHT_SHADOWS
#else
#define LEGACY_FIRST_SUN 0
#endif
float legacyAttenuation(float t){if(t>=1.0)return 0.0;float a=1.0/(1.0+25.0*t);return t>${ATTEN_FADE_START.toFixed(2)}?a*(1.0-(t-${ATTEN_FADE_START.toFixed(2)})/${(1-ATTEN_FADE_START).toFixed(2)}):a;}
void main(){
 #include <logdepthbuf_fragment>
 vec4 t=texture2D(map,vUv);
 vec3 N=vN,light=vec3(0.0);
 #if NUM_DIR_LIGHTS > LEGACY_FIRST_SUN
 for(int i=LEGACY_FIRST_SUN;i<NUM_DIR_LIGHTS;i++)light+=directionalLights[i].color*max(0.0,dot(N,directionalLights[i].direction));
 #endif
 #if NUM_POINT_LIGHTS > 0
 for(int i=0;i<NUM_POINT_LIGHTS;i++){vec3 lv=pointLights[i].position-vOut;float r=pointLights[i].distance;float a=legacyAttenuation(r>0.0?dot(lv,lv)/(r*r):0.0);
  light+=pointLights[i].color*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)}*a*max(0.0,dot(N,normalize(lv)));}
 #endif
 #if NUM_SPOT_LIGHTS > 0
 for(int i=0;i<NUM_SPOT_LIGHTS;i++){vec3 lv=spotLights[i].position-vOut;vec3 L=normalize(lv);float r=spotLights[i].distance;
  float a=legacyAttenuation(r>0.0?dot(lv,lv)/(r*r):0.0)*getSpotAttenuation(spotLights[i].coneCos,spotLights[i].penumbraCos,dot(L,spotLights[i].direction));
  light+=spotLights[i].color*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)}*a*max(0.0,dot(N,L));}
 #endif
 vec3 amb=ambientLightColor;
 #if NUM_HEMI_LIGHTS > 0
 for(int i=0;i<NUM_HEMI_LIGHTS;i++)amb+=getHemisphereLightIrradiance(hemisphereLights[i],normalize(N));
 #endif
 vec3 c=t.rgb*light*2.0+t.rgb*amb+t.a*emission.rgb*emission.a;
 vec3 V=normalize(-vIn);
 float d=pushOut-pushIn,q=abs(dot(V,vOut)-dot(V,vIn))/d,len=sqrt(q*q+q*q);
 float alpha=(1.0-clamp(len-d,0.0,1.0))*((1.0-minAlpha)*alphaScale)+minAlpha;
 if(!(alpha>0.0))discard; // AlphaTest Greater 0
 gl_FragColor=vec4(sRGBTransferEOTF(vec4(max(c,vec3(0.0)),1.0)).rgb,alpha);
 #include <colorspace_fragment>
 #ifdef USE_FOG
 float fogFactor=saturate((vFogDepth-fogNear)/(fogFar-fogNear));
 gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,fogFactor);
 #endif
}`;

const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
// One Custom/OutlineHover draw. m: exported material {floats, colors, textures}; map: THREE.Texture (raw gamma) or null.
export function createOutlineHoverMaterial(m,map){
 const f=m.floats??{},e=m.colors?._EmissionColor??{r:1,g:1,b:1,a:1};
 const mat=new THREE.ShaderMaterial({name:m.name,vertexShader:vertex,fragmentShader:fragment,lights:true,fog:true,transparent:true,depthWrite:false,side:THREE.FrontSide,
  uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.lights,THREE.UniformsLib.fog,{map:{value:null},mainST:{value:new THREE.Vector4(1,1,0,0)},emission:{value:new THREE.Vector4(e.r,e.g,e.b,e.a)},
   pushOut:{value:f._PushOut??0.05},pushIn:{value:f._PushIn??-0.05},minAlpha:{value:f._MinAlpha??0.02},alphaScale:{value:f._AlphaScale??1}}])});
 mat.uniforms.map.value=map??white;mat.userData.defaults={pushOut:mat.uniforms.pushOut.value,pushIn:mat.uniforms.pushIn.value,emission:mat.uniforms.emission.value.clone()};
 return mat;}
// MaterialPropertyBlock.Clear() + Add*: unset values fall back to the material's own.
export function applyBlock(mat,block){const u=mat.uniforms,d=mat.userData.defaults;
 u.emission.value.copy(block.emission?new THREE.Vector4(block.emission.r,block.emission.g,block.emission.b,block.emission.a):d.emission);
 u.mainST.value.fromArray(block.st);u.pushOut.value=block.pushOut??d.pushOut;u.pushIn.value=block.pushIn??d.pushIn;}

// GameGizmoWaveAnimationCarrier (the Explosive Charge's BounceArrowCarrierPreview): while gizmos.carrier is on and the
// placement has a TransCarrier whose own MeshRenderer is enabled, the arrow mesh is hidden (hideArrowWhenCarrierExists)
// and the carrier's mesh (every submesh, carrierRenderer.localToWorldMatrix) is drawn with each carrierMaterial and the
// same property block: Custom/OutlineHoverCarrier (compiled ARB, Cull Front, its own *Carrier values; only _MainTex_ST and
// _GizmoWorldPos come from the block) then Custom/Tint Carrier (GLSL source, Offset -1,-1; _EmissionColor/_PushOut/_PushIn
// from the block). Both sample their textures in screen space (ComputeScreenPos / w, x by the aspect ratio) stepped by _Time,
// and ring outwards from _GizmoWorldPos. Lighting as above (main light * 2 + SH, point lights folded in).
export const gizmos={carrier:true}; // gizmos.carrier [Client] convar
const carrierLight=`
vec3 carrierLight(vec3 N){vec3 light=vec3(0.0);
 #if NUM_DIR_LIGHTS > LEGACY_FIRST_SUN
 for(int i=LEGACY_FIRST_SUN;i<NUM_DIR_LIGHTS;i++)light+=directionalLights[i].color*max(0.0,dot(N,directionalLights[i].direction));
 #endif
 #if NUM_POINT_LIGHTS > 0
 for(int i=0;i<NUM_POINT_LIGHTS;i++){vec3 lv=pointLights[i].position-vPos;float r=pointLights[i].distance;float a=legacyAttenuation(r>0.0?dot(lv,lv)/(r*r):0.0);
  light+=pointLights[i].color*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)}*a*max(0.0,dot(N,normalize(lv)));}
 #endif
 vec3 amb=ambientLightColor;
 #if NUM_HEMI_LIGHTS > 0
 for(int i=0;i<NUM_HEMI_LIGHTS;i++)amb+=getHemisphereLightIrradiance(hemisphereLights[i],normalize(N));
 #endif
 return light*2.0+amb;}
float signedFract(float x){float f=fract(abs(x));return x>=0.0?f:-f;}`;
const carrierPars=`
#include <common>
#include <lights_pars_begin>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
#define LEGACY_FIRST_SUN NUM_DIR_LIGHT_SHADOWS
#else
#define LEGACY_FIRST_SUN 0
#endif
float legacyAttenuation(float t){if(t>=1.0)return 0.0;float a=1.0/(1.0+25.0*t);return t>${ATTEN_FADE_START.toFixed(2)}?a*(1.0-(t-${ATTEN_FADE_START.toFixed(2)})/${(1-ATTEN_FADE_START).toFixed(2)}):a;}
uniform vec2 resolution;uniform vec4 unityTime;uniform vec3 gizmoPos;
varying vec2 vUv;varying vec3 vPos;varying vec3 vOut;varying vec3 vIn;varying vec3 vN;`;
const carrierEnd=`
 gl_FragColor=vec4(sRGBTransferEOTF(vec4(max(c,vec3(0.0)),1.0)).rgb,alpha);
 #include <colorspace_fragment>
 #ifdef USE_FOG
 gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,saturate((vFogDepth-fogNear)/(fogFar-fogNear)));
 #endif
}`;
// vPos: the drawn position (pushed out for the outline, the plain vertex for the tint).
const carrierVertex=drawOut=>`
uniform float pushOut;uniform float pushIn;uniform vec4 mainST;
varying vec2 vUv;varying vec3 vPos;varying vec3 vOut;varying vec3 vIn;varying vec3 vN;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main(){
 vec3 n=normalize(normal);
 vec4 outer=modelViewMatrix*vec4(position+n*pushOut,1.0),inner=modelViewMatrix*vec4(position+n*pushIn,1.0);
 vec4 mvPosition=${drawOut?'outer':'modelViewMatrix*vec4(position,1.0)'};
 vPos=mvPosition.xyz;vOut=outer.xyz;vIn=inner.xyz;vN=normalize(normalMatrix*normal);vUv=uv*mainST.xy+mainST.zw;
 gl_Position=projectionMatrix*mvPosition;
 #include <logdepthbuf_vertex>
 #include <fog_vertex>
}`;
const outlineCarrierFragment=`
uniform sampler2D map;uniform vec4 texel;uniform vec4 emission;uniform float pushOut;uniform float pushIn;uniform float minAlpha;uniform float alphaScale;
${carrierPars}
${carrierLight}
void main(){
 #include <logdepthbuf_fragment>
 vec2 s=gl_FragCoord.xy/resolution-0.5;s.x*=resolution.x/resolution.y;vec2 s2=s*2.0+0.5;s+=0.5;
 s2.y-=floor(unityTime.w*texel.w*2.0)/(2.0*texel.w);s.y+=floor(texel.w*unityTime.y)/texel.w;
 vec3 noise=(texture2D(map,s).rgb+texture2D(map,s2).rgb)*0.5;
 vec3 c=noise*carrierLight(vN)+texture2D(map,vUv).a*emission.rgb*emission.a;
 vec3 V=normalize(-vIn);float d=pushOut-pushIn,q=abs(dot(V,vOut)-dot(V,vIn))/d,len=sqrt(q*q+q*q);
 float outline=(1.0-clamp(len-d,0.0,1.0))*((1.0-minAlpha)*alphaScale)+minAlpha;
 float dist=length(vOut-gizmoPos),near=clamp(2.0-dist,0.0,1.0),f=signedFract(max(near,0.0)+unityTime.y);
 float ring=clamp(max(16.0-dist*50.0,1.0-abs(0.1-2.0*f)*10.0),0.0,1.0);
 float alpha=clamp(max(ring*emission.w*near,min(dot(noise,emission.rgb)*outline,0.2)),0.0,1.0);
 if(!(alpha>0.0))discard;
${carrierEnd}`;
const tintCarrierFragment=`
uniform sampler2D map;uniform sampler2D noiseMap;uniform vec4 noiseTexel;uniform vec4 emission;uniform float pushOut;uniform float pushIn;uniform float minAlpha;uniform float alphaScale;
${carrierPars}
${carrierLight}
void main(){
 #include <logdepthbuf_fragment>
 vec2 s=gl_FragCoord.xy/resolution-0.5;s.x*=resolution.x/resolution.y;vec2 s2=s*2.0+0.5;s+=0.5;
 s.y+=floor(unityTime.z*noiseTexel.w*2.0)/(noiseTexel.w*2.0);s2.y-=floor(unityTime.w*(noiseTexel.w*4.0))/(noiseTexel.w*4.0);
 vec3 noise=(texture2D(noiseMap,s).rgb+texture2D(noiseMap,s2).rgb)*0.5;
 float dist=length(vPos-gizmoPos),t8=max(0.0,2.0-dist),f=signedFract(t8+unityTime.y);
 vec3 nrm;nrm.xy=texture2D(map,vUv).wy*2.0-1.0;nrm.z=sqrt(1.0-clamp(dot(nrm.xy,nrm.xy),0.0,1.0));
 vec3 t13=abs(nrm)*(1.0-dist*0.5);
 vec3 V=normalize(-vIn);float d=pushOut-pushIn;vec2 q=vec2(abs(dot(V,vOut)-dot(V,vIn)))/d;
 float t20=dot(noise,emission.rgb)*(minAlpha+(1.0-clamp(length(q)-d,0.0,1.0))*((1.0-minAlpha)*alphaScale))*1.2*t13.x
  +max(0.0,sin(f*3.14159)*t13.x)+clamp(max(16.0-dist*50.0,1.0-abs(f*2.0-0.1)*10.0),0.0,1.0)*t13.z*emission.w;
 vec3 t21=vec3(clamp(1.0-t20,0.0,1.0)*0.1);
 vec3 c=t21*carrierLight(vN)+clamp(dot(normalize(noise*2.0-1.0),normalize(vIn-vOut))*emission,0.0,1.0).xyz;
 float alpha=t20*0.5;
 if(!(alpha>0.0))discard;
${carrierEnd}`;
const texelOf=t=>{const i=t?.image;return i?new THREE.Vector4(1/i.width,1/i.height,i.width,i.height):new THREE.Vector4(1,1,1,1);};
// Custom/OutlineHoverCarrier or Custom/Tint Carrier for an exported material. textures: {main, noise}.
export function createCarrierMaterial(m,textures){const f=m.floats??{},tint=m.shader==='Custom/Tint Carrier',e=(tint?m.colors?._EmissionColor:m.colors?._EmissionColorCarrier)??{r:1,g:1,b:1,a:1};
 const own={map:{value:null},texel:{value:texelOf(textures.main)},noiseMap:{value:null},noiseTexel:{value:texelOf(textures.noise)},
  mainST:{value:new THREE.Vector4(1,1,0,0)},emission:{value:new THREE.Vector4(e.r,e.g,e.b,e.a)},resolution:{value:new THREE.Vector2(1,1)},unityTime:{value:new THREE.Vector4()},gizmoPos:{value:new THREE.Vector3()},
  pushOut:{value:(tint?f._PushOut:f._PushOutCarrier)??0.05},pushIn:{value:(tint?f._PushIn:f._PushInCarrier)??-0.05},minAlpha:{value:(tint?f._MinAlpha:f._MinAlphaCarrier)??0.02},alphaScale:{value:(tint?f._AlphaScale:f._AlphaScaleCarrier)??1}};
 const mat=new THREE.ShaderMaterial({name:m.name,vertexShader:carrierVertex(!tint),fragmentShader:tint?tintCarrierFragment:outlineCarrierFragment,lights:true,fog:true,transparent:true,depthWrite:false,
  side:tint?THREE.FrontSide:THREE.BackSide,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.lights,THREE.UniformsLib.fog,own])});
 mat.uniforms.map.value=textures.main??white;mat.uniforms.noiseMap.value=textures.noise??white;
 if(tint){mat.polygonOffset=true;mat.polygonOffsetFactor=-1;mat.polygonOffsetUnits=-1;}
 mat.userData.defaults={pushOut:mat.uniforms.pushOut.value,pushIn:mat.uniforms.pushIn.value,emission:mat.uniforms.emission.value.clone()};mat.userData.tint=tint;
 return mat;}
// The block on a carrier material: the tint takes _EmissionColor/_PushOut/_PushIn; the outline only _MainTex_ST. Both _GizmoWorldPos.
export function applyCarrierBlock(mat,block,{gizmoView,resolution,t}){const u=mat.uniforms;u.gizmoPos.value.copy(gizmoView);u.resolution.value.copy(resolution);u.unityTime.value.set(t/20,t,t*2,t*3);
 if(mat.userData.tint)applyBlock(mat,block);else u.mainST.value.fromArray(block.st);}

// Runtime: one preview group per item, built on first use. loader = scene.mjs createAssetLoader(base, manifest);
// texture(slot) -> Promise<THREE.Texture> with NoColorSpace and the exported UV flip.
export function createPlacementPreview(manifest,{loader,texture,scene,cullingMask=null,now=()=>performance.now()}){
 const built=new Map(),log={shown:null,valid:null,parts:0,arrow:false,emission:null,pushOut:null};let current=null;
 async function material(key){const m=manifest.materials[key];const slot=m.textures?._MainTex;return createOutlineHoverMaterial(m,slot?await texture(slot):null);}
 async function geometry(meshKey,submesh){const a=await loader.attributes(meshKey),md=manifest.meshes[meshKey],g=new THREE.BufferGeometry();
  for(const [k,attr] of Object.entries(a))if(attr)g.setAttribute(k,attr);g.setIndex(new THREE.BufferAttribute(await loader.binary(md.parts[submesh],Uint32Array),1));if(!a.normal)g.computeVertexNormals();g.computeBoundingSphere();return g;}
 async function build(itemKey){const item=manifest.items[itemKey];if(!item?.overrideMat)return null;
  const prefab=manifest.prefabs[item.prefab],override=await material(item.overrideMat),root=new THREE.Group();root.matrixAutoUpdate=false;root.name='placement:'+item.item;
  const parts=visibleParts(prefab.parts,cullingMask);
  for(const p of parts){const mesh=new THREE.Mesh(await geometry(p.mesh,p.submesh),override);mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;root.add(mesh);}
  const g=item.aimGizmo&&manifest.gizmos[item.aimGizmo];let arrow=null,arrowMats=[];
  if(g?.mesh){arrow=new THREE.Group();arrow.matrixAutoUpdate=false;const md=manifest.meshes[g.mesh];arrowMats=await Promise.all(g.materials.map(material));
   // GameGizmo.Render: every submesh with materials[i % count].
   for(let i=0;i<md.parts.length;i++){const mesh=new THREE.Mesh(await geometry(g.mesh,i),arrowMats[i%arrowMats.length]);mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;arrow.add(mesh);}}
  let carrierMats=null;
  if(g?.carrierMaterials?.length){carrierMats=await Promise.all(g.carrierMaterials.map(async k=>{const m=manifest.materials[k],t=m.textures??{};return createCarrierMaterial(m,{main:t._MainTex?await texture(t._MainTex):null,noise:t._NoiseTex?await texture(t._NoiseTex):null});}));
   carrierMats.forEach((m,i)=>m.userData.order=i);}
  const entry={item,root,override,arrow,arrowMats,carrierMats,carrierView:null,gizmo:g??null,wave:g&&/WaveAnimation/.test(g.class)?new GizmoWave(g):null,partCount:parts.length};
  root.visible=false;scene.add(root);if(arrow){arrow.visible=false;scene.add(arrow);}
  return entry;}
 function ensure(itemKey){if(!built.has(itemKey))built.set(itemKey,build(itemKey).then(e=>{built.set(itemKey,e);return e;},err=>{console.warn('Placement preview unavailable:',err.message);built.set(itemKey,null);return null;}));const v=built.get(itemKey);return v instanceof Promise?null:v;}
 function hideEntry(e){e.root.visible=false;if(e.arrow)e.arrow.visible=false;for(const v of e.carrierViews?.values()??[])if(v&&!(v instanceof Promise))v.visible=false;}
 function hideAll(){for(const e of built.values())if(e&&!(e instanceof Promise))hideEntry(e);current=null;log.shown=null;}
 // The carrier's root renderer mesh drawn once per carrier material (Graphics.DrawMesh per submesh, outline before tint).
 function carrierView(e,carrier){e.carrierViews??=new Map();if(!e.carrierViews.has(carrier.key))e.carrierViews.set(carrier.key,carrier.geometries().then(list=>{const g=new THREE.Group();g.matrixAutoUpdate=false;
   for(const geometry of list)for(const m of e.carrierMats){const mesh=new THREE.Mesh(geometry,m);mesh.matrixAutoUpdate=false;mesh.frustumCulled=false;mesh.renderOrder=1+m.userData.order;g.add(mesh);}
   g.visible=false;scene.add(g);e.carrierViews.set(carrier.key,g);return g;},err=>{console.warn('Carrier highlight unavailable:',err.message);e.carrierViews.set(carrier.key,null);return null;}));
  const v=e.carrierViews.get(carrier.key);return v instanceof Promise?null:v;}
 return {log,
  has:itemKey=>Boolean(manifest.items[itemKey]?.overrideMat),
  // One frame for the held item. position/rotation: Unity space; scale: Unity localScale (structures use one).
  // Returns false while the item's preview is still loading (callers may keep their old ghost meanwhile).
  // carrier: {key, geometries() -> Promise<[BufferGeometry]>, matrix (browser)} for a TransCarrier with an enabled root
  // MeshRenderer; camera/resolution: the main camera and drawing-buffer size (carrier shaders work in screen space).
  update(itemKey,{valid,position,rotation,scale,t,carrier=null,camera=null,resolution=null}){const e=ensure(itemKey);if(e===null&&built.get(itemKey)===null)return false;if(!e){return false;}
   if(current&&current!==e)hideEntry(current);current=e;
   const structure=e.item.kind==='structure',s=structure?{x:1,y:1,z:1}:scale;
   const block=structure?{emission:structureEmission(valid,t),st:scrollST(t)}:deployableBlock(e.gizmo,e.wave,valid,t);
   applyBlock(e.override,block);
   e.root.matrix.copy(unityMatrix(position,rotation,s));e.root.matrixWorldNeedsUpdate=true;e.root.visible=true;
   const highlight=Boolean(e.carrierMats&&gizmos.carrier&&carrier&&camera&&resolution),view=highlight?carrierView(e,carrier):null;
   for(const v of e.carrierViews?.values()??[])if(v&&!(v instanceof Promise)&&v!==view)v.visible=false;
   if(e.arrow){for(const m of e.arrowMats)applyBlock(m,block);e.wave?.render(now());e.arrow.matrix.copy(browserMatrix(gizmoMatrixU(position,rotation,e.gizmo,e.wave)));e.arrow.matrixWorldNeedsUpdate=true;
    e.arrow.visible=!(highlight&&e.gizmo.hideArrowWhenCarrierExists);}
   if(view){const gizmoView=new THREE.Vector3(position.x,position.y,-position.z).applyMatrix4(camera.matrixWorldInverse);for(const m of e.carrierMats)applyCarrierBlock(m,block,{gizmoView,resolution,t});
    view.matrix.copy(carrier.matrix);view.matrixWorldNeedsUpdate=true;view.visible=true;}
   Object.assign(log,{shown:e.item.item,valid,parts:e.partCount,arrow:Boolean(e.arrow?.visible),carrier:Boolean(view),emission:block.emission,pushOut:e.override.uniforms.pushOut.value});
   return true;},
  hide:hideAll,
  dispose(){for(const e of built.values())if(e&&!(e instanceof Promise)){scene.remove(e.root);if(e.arrow)scene.remove(e.arrow);e.root.traverse(o=>o.geometry?.dispose());e.arrow?.traverse(o=>o.geometry?.dispose());for(const v of e.carrierViews?.values()??[])if(v&&!(v instanceof Promise))scene.remove(v);}built.clear();}};
}
