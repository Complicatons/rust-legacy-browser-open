import * as THREE from 'three';
import {SUN_SHADOW_GLSL,SUN_SHADOW_UNIFORMS,EYE_SHADOW_GLSL,EYE_SHADOW_UNIFORMS} from './sun-shadows.mjs';

// Original Rust Legacy (Unity 4, gamma colour space) surface shading for the exported world, prop, character and
// view-model materials. Programs were read from the compiled ShaderLab text in the client bundles (shader.000,
// material.000, terraindata.000, unity_builtin_extra; dumped by tools/_shaders-list.py to analysis/shader-source/).
//
// The in-game Scene Camera renders with Unity 4 Deferred Lighting (renderingPath 2, HDR on). Opaque surface shaders
// therefore run PrePassBase -> Internal-PrePassLighting -> PrePassFinal:
//   light buffer   rgb = sum(_LightColor * max(0, N.L) * atten)                (HDR: stored linearly, no log encoding)
//                  a   = sum(pow(max(0, N.H), shininess*128) * saturate(atten) * Luminance(_LightColor))
//   final (Lambert)     c = albedo * (light.rgb + SH)
//   final (BlinnPhong)  c = albedo * L + L * _SpecColor * (light.a * gloss),  L = light.rgb + SH
// with Luminance weights (0.2199707, 0.70703125, 0.070983887) taken from the compiled program. Normals come from
// UnpackNormalDXT5nm (xy = packed.wy * 2 - 1, z = sqrt(1 - saturate(x^2 + y^2))). Everything runs in gamma space;
// the result is decoded so three.js's sRGB output encoding writes the original gamma value, and three's fog (applied
// after the output encoding with an sRGB fog colour) blends in gamma space as Unity's fixed-function fog did.
//
// Engine-side values (not in any shader): _LightColor = colour * intensity * 2 (Unity 4 doubled light colour so
// deferred matches forward's "atten * 2"), ambient = RenderSettings.ambientLight (TOD_Sky AmbientColor) as the only
// SH term, point-light attenuation texture 1/(1 + 25 t) faded to zero over the last part of the range (t = d^2/r^2).
//
// Lights arrive through three.js light uniforms so world and view-model passes (which mirror lights into camera
// space) both work: DirectionalLight colour * intensity = Unity colour * intensity; Hemisphere/Ambient lights = the
// flat ambient colour; PointLight/SpotLight intensity follows this port's convention of m_Intensity * 6.
//
// Render Quality (browser/quality.mjs) reaches these programs through shared uniforms, so a level change never relinks
// them: legacyTextureLimit = QualitySettings.masterTextureLimit (the top mip levels a texture loses: every fetch uses at
// least that mip, as a texture uploaded without them would), legacyBlendWeights = QualitySettings.blendWeights (bones
// per skinned vertex: the strongest 1, 2 or all 4, renormalised). The sun shadow (browser/sun-shadows.mjs) multiplies
// only the sun/moon light term, as the deferred light pass did.
export const LEGACY_GLOBAL_UNIFORMS={legacyTextureLimit:{value:0},legacyBlendWeights:{value:4}};
export const LEGACY_POINT_LIGHT_SCALE=1/6;
export const LUMINANCE=Object.freeze([0.2199707,0.70703125,0.070983887]);

// ShaderLab name -> shading family. lighting: lambert | blinnphong | unlit | leaf. Flags mirror the shader's passes.
const BASE={
 'Diffuse':{lighting:'lambert'},
 'Bumped Diffuse':{lighting:'lambert',bump:true},
 'Specular':{lighting:'blinnphong'},
 'Bumped Specular':{lighting:'blinnphong',bump:true},
 'Transparent/Cutout/Diffuse':{lighting:'lambert',cutout:true},
 'Transparent/Cutout/Bumped Diffuse':{lighting:'lambert',bump:true,cutout:true},
 'Transparent/Cutout/Specular':{lighting:'blinnphong',cutout:true},
 'Transparent/Cutout/Bumped Specular':{lighting:'blinnphong',bump:true,cutout:true},
 // Forward-only alpha-blended shaders (Queue Transparent, ZWrite Off, Blend SrcAlpha OneMinusSrcAlpha).
 'Transparent/Diffuse':{lighting:'lambert',blend:true},
 'Transparent/Bumped Diffuse':{lighting:'lambert',bump:true,blend:true},
 'Transparent/Lit Colored':{lighting:'lambert',blend:true,approximate:'vertex colour term not applied'},
 // Custom/Road: Lambert cutout (alpha = tex.a * _Color.a), Offset -2,-2, ColorMask RGB.
 'Custom/Road':{lighting:'lambert',cutout:true,offset:[-2,-2]},
 // Enviro/BumpedDiffuseOverlaySM3: Lambert; colour and packed normal overlay-blended (PrePassBase writes spec power 0,
 // PrePassFinal ignores light.a, so _Shininess/_SpecColor/_SpecAmount are unused).
 'Enviro/BumpedDiffuseOverlaySM3':{lighting:'lambert',bump:true,overlay:true},
 // View Model shaders: same surface functions, drawn with V_MUNITY_MATRIX_P in the world's deferred pass.
 'View Model/Diffuse':{lighting:'lambert'},
 'View Model/Bumped Diffuse':{lighting:'lambert',bump:true},
 'View Model/Specular':{lighting:'blinnphong'},
 'View Model/Bumped Specular':{lighting:'blinnphong',bump:true},
 // View Model/Unlit: colour = _MainTex.rgb, Fog Off, Offset -1,-1, ColorMask RGB.
 'View Model/Unlit':{lighting:'unlit',offset:[-1,-1],fog:false},
 // Terrain tree prototypes (TreeCreator optimized materials).
 'Hidden/Nature/Tree Creator Bark Optimized':{lighting:'blinnphong',bump:true,tree:'bark'},
 'Hidden/Nature/Tree Creator Leaves Fast Optimized':{lighting:'leaf',cutout:true,tree:'leaf'},
};
export const LEGACY_SHADERS=Object.freeze(Object.keys(BASE));

// Shading family for an exported material description ({shader, textures, ...}). Unknown/missing shader names fall
// back to plain Lambert (marked approximate) so nothing renders unlit.
export function legacyShaderModel(shader){
 const base=BASE[shader];
 if(base)return {shader,lighting:base.lighting,bump:!!base.bump,cutout:!!base.cutout,blend:!!base.blend,overlay:!!base.overlay,tree:base.tree??null,offset:base.offset??null,fog:base.fog??true,exact:!base.approximate,note:base.approximate??null};
 return {shader:shader??null,lighting:'lambert',bump:false,cutout:false,blend:false,overlay:false,tree:null,offset:null,fog:true,exact:false,note:'unported shader, Lambert fallback'};
}

// Defines that select the program variant (part of three's program cache key; uniforms carry per-material values).
export function legacyDefines(model){
 const d={};
 if(model.lighting==='blinnphong')d.LEGACY_SPEC='';
 if(model.lighting==='unlit')d.LEGACY_UNLIT='';
 if(model.lighting==='leaf')d.LEGACY_LEAF='';
 if(model.bump)d.LEGACY_BUMP='';
 if(model.cutout)d.LEGACY_CUTOUT='';
 if(model.blend)d.LEGACY_BLEND='';
 if(model.overlay)d.LEGACY_OVERLAY='';
 if(model.tree)d.LEGACY_TREE='';
 if(model.tree==='bark')d.LEGACY_TREE_BARK='';
 return d;
}

// --- Pure reference maths (mirrors the GLSL below; used by tests) ---------------------------------------------------
const sat=x=>Math.min(1,Math.max(0,x));
// UnityCG UnpackNormalDXT5nm for packed 0..1 RGBA.
export function unpackNormalDXT5nm([,g,,a]){const x=a*2-1,y=g*2-1;return [x,y,Math.sqrt(1-sat(x*x+y*y))];}
export function luminance([r,g,b]){return r*LUMINANCE[0]+g*LUMINANCE[1]+b*LUMINANCE[2];}
// Unity's light attenuation texture lookup (normalised squared distance t = d^2 / range^2).
export const ATTEN_FADE_START=0.64;
export function lightAttenuation(t){if(!(t<1))return 0;const a=1/(1+25*t);return t>ATTEN_FADE_START?a*(1-(t-ATTEN_FADE_START)/(1-ATTEN_FADE_START)):a;}
// Enviro overlay blend (per channel): screen above 0.5 of the under value, multiply at or below.
export function overlayBlend(o,u){return u>0.5?1-2*(1-o)*(1-u):2*o*u;}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
// One deferred light into the light buffer: returns {rgb, a}. lightColor already includes Unity's x2.
export function deferredLight({normal,toLight,toView,lightColor,atten=1,shininess=0}){
 const nl=Math.max(0,dot(normal,toLight)),h=norm(toLight.map((v,i)=>v+toView[i])),nh=Math.max(0,dot(normal,h));
 return {rgb:lightColor.map(c=>c*nl*atten),a:Math.pow(Math.max(nh,1e-6),shininess*128)*sat(atten)*luminance(lightColor)};}
// PrePassFinal: Lambert (spec=false) or BlinnPhong. light = {rgb, a} accumulated, ambient = SH term.
export function deferredFinal({albedo,light,ambient,specColor=[0,0,0],gloss=0,spec=false}){
 const L=light.rgb.map((v,i)=>v+ambient[i]);return albedo.map((a,i)=>a*L[i]+(spec?L[i]*specColor[i]*light.a*gloss:0));}
// Tree Creator Leaves Fast Optimized vertex lighting (DIRECTIONAL, SHADOWS_OFF): the per-vertex colour, before the
// fragment's tex.rgb * colour * 2. ambientFront/Back are ShadeSH9(N) / ShadeSH9(-N).
export function leafVertexLight({normal,toLight,toView,lightColor,ambientFront,ambientBack,color,ao,translucencyColor,viewDependency}){
 const nl=dot(normal,toLight),viewBack=sat(-dot(toView,toLight)),back=sat(-nl)+(viewBack-sat(-nl))*viewDependency,wrap=Math.max(0,nl*0.6+0.4);
 const aoE=sat(Math.pow(ao+0.0999756,3)),col=color.map(c=>c*aoE),backW=1+(viewBack-1)*viewDependency;
 return col.map((c,i)=>{const main=lightColor[i]*(wrap+back*translucencyColor[i]),amb=ambientFront[i]+ambientBack[i]*backW*translucencyColor[i];return 0.25*amb*c+main*c;});}

// QualitySettings.blendWeights (1, 2 or 4 bones): keep the strongest weights and renormalise (mirrors legacyWeights).
export function limitBlendWeights(w,bones){if(bones>=4)return w.slice();const s=[...w].sort((a,b)=>b-a),min=s[Math.max(0,bones-1)];
 const o=w.map(v=>v>=min?v:0),sum=o.reduce((a,b)=>a+b,0);return sum>0?o.map(v=>v/sum):w.slice();}
// QualitySettings.masterTextureLimit: the mip level actually sampled (mirrors legacySample).
export function limitedLod(lod,limit){return limit>0?Math.max(lod,limit):lod;}
// Tree Creator Leaves Fast Optimized, SHADOWS_SCREEN: tex * (ambient + main * 2 * (1 + (shadow - 1) * _ShadowStrength)).
export function leafShadowTerm(shadow,strength){return 1+(shadow-1)*strength;}
// TerrainEngine.cginc AnimateVertex (Tree Creator TreeVertBark/TreeVertLeaf), as compiled into both Optimized programs:
// animParams = (color.x branch phase, color.y edge flutter, texcoord1.x primary, texcoord1.y secondary), pos/normal in
// object space after _Scale, wind = _Wind. fObjPhase = dot(_Object2World[3].xyz, 1) reads the matrix's bottom row
// (0, 0, 0) in the compiled program (DP3 with c[12]), so every tree shares the object phase 0.
const fract=x=>x-Math.floor(x),smoothTriangle=x=>{const t=Math.abs(fract(x+0.5)*2-1);return t*t*(3-2*t);};
export function treeAnimateVertex(pos,normal,[branchPhase,edgeFlutter,primary,secondary],wind,time){
 const vtxPhase=(pos[0]+pos[1]+pos[2])*(edgeFlutter+branchPhase),freq=[1.975,0.793,0.375,0.193],input=[time+vtxPhase,time+vtxPhase,time+branchPhase,time+branchPhase];
 const w=input.map((v,i)=>smoothTriangle(fract(v*freq[i])*2-1)),sum=[w[0]+w[1],w[2]+w[3]];
 const bend=[edgeFlutter*0.1*normal[0],secondary*0.3,edgeFlutter*0.1*normal[2]],sx=[sum[0],sum[1],sum[0]];
 return [0,1,2].map(i=>pos[i]+(sx[i]*bend[i]+wind[i]*sum[1]*secondary)*wind[3]+primary*wind[i]);
}
// WindZone force for the terrain's trees (the engine's WindZone::ComputeWindForce is native, not in the managed sources;
// reconstructed: pulse = 1 + magnitude * (cos p + cos 0.375p + cos 0.05p) * 0.333, p = time * PI * frequency; directional
// zones give forward * windMain * pulse and windTurbulence * pulse in w). Unity space.
export function windZoneForce(zone,time){
 const p=time*Math.PI*zone.windPulseFrequency,pulse=1+(Math.cos(p)+Math.cos(p*0.375)+Math.cos(p*0.05))*0.333*zone.windPulseMagnitude;
 const f=zone.forward??[0,0,1],main=zone.windMain*pulse;return [f[0]*main,f[1]*main,f[2]*main,zone.windTurbulence*pulse];
}
// GLSL twin of treeAnimateVertex. Positions/normals arrive in the browser's mirrored object space (Unity z = -z).
const TREE_WIND_GLSL=`
vec4 legacySmoothTriangle(vec4 x){vec4 t=abs(fract(x+0.5)*2.0-1.0);return t*t*(3.0-2.0*t);}
vec3 legacyTreeAnimate(vec3 p,vec3 n,vec4 a){
 vec3 pu=vec3(p.xy,-p.z),nu=vec3(n.xy,-n.z);
 float vtxPhase=dot(pu,vec3(a.y+a.x));vec2 wavesIn=treeTime+vec2(vtxPhase,a.x);
 vec4 waves=legacySmoothTriangle(fract(wavesIn.xxyy*vec4(1.975,0.793,0.375,0.193))*2.0-1.0);vec2 sum=waves.xz+waves.yw;
 vec3 bend=a.y*0.1*nu;bend.y=a.w*0.3;
 pu+=((sum.xyx*bend)+(treeWindForce.xyz*sum.y*a.w))*treeWindForce.w;pu+=a.z*treeWindForce.xyz;
 return vec3(pu.xy,-pu.z);}
`;

// --- GLSL -----------------------------------------------------------------------------------------------------------
const qualityPars=`
uniform float legacyTextureLimit;
vec4 legacySample(sampler2D t,vec2 uv){vec4 c;
 if(legacyTextureLimit>0.0){vec2 g=uv*vec2(textureSize(t,0));vec2 dx=dFdx(g),dy=dFdy(g); // uniform branch: derivatives stay defined
  c=textureLod(t,uv,max(0.5*log2(max(max(dot(dx,dx),dot(dy,dy)),1e-12)),legacyTextureLimit));}
 else c=texture(t,uv);
 return c;}
`;
const commonPars=`
uniform vec4 legacyColor;uniform vec4 legacySpecColor;uniform float legacyShininess;uniform float legacyCutoff;
uniform vec3 legacyTranslucencyColor;uniform float legacyViewDependency;
varying vec2 vLegacyUv;
#ifdef LEGACY_TREE
varying float vTreeAo;
#endif
#ifdef LEGACY_LEAF
varying vec3 vLeafLight;varying vec3 vLeafMain;uniform float legacyLeafShadowStrength;
#endif
`;
const legacyFragment=`#define LAMBERT
varying vec3 vViewPosition;
${commonPars}${qualityPars}
uniform sampler2D legacyMainTex;uniform vec4 legacyMainST;
#ifdef LEGACY_BUMP
uniform sampler2D legacyBumpMap;uniform vec4 legacyBumpST;
#endif
#ifdef LEGACY_OVERLAY
uniform sampler2D legacyMainTex2;uniform vec4 legacyMain2ST;uniform sampler2D legacyBumpMap2;uniform vec4 legacyBump2ST;uniform float legacyOpacity;
#endif
#ifdef LEGACY_TREE_BARK
uniform sampler2D legacyGlossMap;uniform vec4 legacyGlossST;
#endif
#ifdef LEGACY_TREE_IMPOSTER
uniform float treeLodBias;
#endif
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <packing>
#include <shadowmap_pars_fragment>
#include <normal_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
${SUN_SHADOW_GLSL}${EYE_SHADOW_GLSL}
vec4 legacyTex(sampler2D t,vec4 st){return legacySample(t,vLegacyUv*st.xy+st.zw);}
vec3 legacyUnpackNormal(vec4 p){vec3 n;n.xy=p.wy*2.0-1.0;n.z=sqrt(saturate(1.0-dot(n.xy,n.xy)));return n;}
float legacyLuminance(vec3 c){return dot(c,vec3(0.2199707,0.70703125,0.070983887));}
float legacyAttenuation(float t){if(t>=1.0)return 0.0;float a=1.0/(1.0+25.0*t);return t>${ATTEN_FADE_START.toFixed(2)}?a*(1.0-(t-${ATTEN_FADE_START.toFixed(2)})/${(1-ATTEN_FADE_START).toFixed(2)}):a;}
vec3 legacyOverlay(vec3 o,vec3 u){return mix(2.0*o*u,1.0-2.0*(1.0-o)*(1.0-u),vec3(greaterThan(u,vec3(0.5))));}
vec2 legacyOverlay2(vec2 o,vec2 u){return mix(2.0*o*u,1.0-2.0*(1.0-o)*(1.0-u),vec2(greaterThan(u,vec2(0.5))));}
// Tangent frame from screen-space derivatives (the exported meshes carry no tangents; Unity used imported ones).
mat3 legacyTangentFrame(vec3 eye,vec3 n,vec2 uv){vec3 q0=dFdx(eye),q1=dFdy(eye);vec2 st0=dFdx(uv),st1=dFdy(uv);
 vec3 q1p=cross(q1,n),q0p=cross(n,q0);vec3 T=q1p*st0.x+q0p*st1.x,B=q1p*st0.y+q0p*st1.y;float det=max(dot(T,T),dot(B,B));float s=det==0.0?0.0:inversesqrt(det);return mat3(T*s,B*s,n);}
void legacyAccumulate(vec3 N,vec3 V,vec3 L,vec3 C,float atten,float shininess,inout vec3 light,inout float spec){
 light+=C*(max(0.0,dot(N,L))*atten);
 #ifdef LEGACY_SPEC
 spec+=pow(max(dot(N,normalize(L+V)),1e-6),shininess*128.0)*saturate(atten)*legacyLuminance(C);
 #endif
}
vec3 legacyAmbient(vec3 n){vec3 a=ambientLightColor;
 #if NUM_HEMI_LIGHTS > 0
 for(int i=0;i<NUM_HEMI_LIGHTS;i++)a+=getHemisphereLightIrradiance(hemisphereLights[i],n);
 #endif
 return a;}
void main(){
 #include <clipping_planes_fragment>
 #include <logdepthbuf_fragment>
 vec4 mainC=
 #ifdef LEGACY_TREE_IMPOSTER
  texture(legacyMainTex,vLegacyUv*legacyMainST.xy+legacyMainST.zw,treeLodBias);
 #else
  legacyTex(legacyMainTex,legacyMainST);
 #endif
 vec3 albedo;float alpha;float gloss=mainC.a;float shininess=legacyShininess;
#ifdef LEGACY_OVERLAY
 vec4 under=legacyTex(legacyMainTex2,legacyMain2ST);float k=mainC.a*legacyOpacity;
 albedo=mix(under.rgb,legacyOverlay(mainC.rgb,under.rgb),k)*legacyColor.rgb;alpha=1.0;
#elif defined(LEGACY_LEAF)
 albedo=mainC.rgb;alpha=mainC.a;
#else
 albedo=mainC.rgb*legacyColor.rgb;alpha=mainC.a*legacyColor.a;
#endif
#ifdef LEGACY_CUTOUT
 if(alpha<legacyCutoff)discard;
#endif
#ifdef LEGACY_UNLIT
 vec3 outColor=mainC.rgb;alpha=1.0;
#elif defined(LEGACY_LEAF)
 // FORWARDBASE SHADOWS_SCREEN: tex * (ambient + main * 2 * (1 + (shadow - 1) * _ShadowStrength)).
 float leafShadow=1.0+(legacySunShadow(-vViewPosition,normalize(vNormal))-1.0)*legacyLeafShadowStrength;
 vec3 outColor=mainC.rgb*(vLeafLight+vLeafMain*leafShadow)*2.0;alpha=1.0;
#else
 vec3 tint=legacyColor.rgb;
 #ifdef USE_COLOR
 albedo*=vColor.rgb;tint*=vColor.rgb; // terrain trees: TreeInstance colour is the material _Color
 #endif
 #ifdef LEGACY_TREE_BARK
 albedo*=vTreeAo;gloss=legacySample(legacyGlossMap,vLegacyUv*legacyGlossST.xy+legacyGlossST.zw).a*tint.r;
 #endif
 float faceDirection=gl_FrontFacing?1.0:-1.0;
 vec3 geoN=normalize(vNormal);
 #ifdef DOUBLE_SIDED
 geoN*=faceDirection;
 #endif
 vec3 N=geoN;
 #ifdef LEGACY_BUMP
 vec4 packedN=legacyTex(legacyBumpMap,legacyBumpST);
  #ifdef LEGACY_OVERLAY
 vec4 packedU=legacyTex(legacyBumpMap2,legacyBump2ST);packedN.wy=mix(packedU.wy,legacyOverlay2(packedN.wy,packedU.wy),k);
  #endif
  #ifdef LEGACY_TREE_BARK
 shininess=packedN.r; // _BumpSpecMap: normal (GA), spec power (R)
  #endif
 N=normalize(legacyTangentFrame(-vViewPosition,geoN,vLegacyUv*legacyBumpST.xy)*legacyUnpackNormal(packedN));
 #endif
 vec3 V=normalize(vViewPosition),P=-vViewPosition;
 vec3 light=vec3(0.0);float spec=0.0;
 #if NUM_DIR_LIGHTS > LEGACY_FIRST_SUN
 float sunAtten=legacySunShadow(P,geoN)*legacyEyeShadow();
 for(int i=LEGACY_FIRST_SUN;i<NUM_DIR_LIGHTS;i++)legacyAccumulate(N,V,directionalLights[i].direction,directionalLights[i].color*2.0,sunAtten,shininess,light,spec);
 #endif
 #if NUM_POINT_LIGHTS > 0
 for(int i=0;i<NUM_POINT_LIGHTS;i++){vec3 lv=pointLights[i].position-P;float r=pointLights[i].distance;float t=r>0.0?dot(lv,lv)/(r*r):0.0;
  legacyAccumulate(N,V,normalize(lv),pointLights[i].color*(2.0*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)}),legacyAttenuation(t),shininess,light,spec);}
 #endif
 #if NUM_SPOT_LIGHTS > 0
 for(int i=0;i<NUM_SPOT_LIGHTS;i++){vec3 lv=spotLights[i].position-P;vec3 L=normalize(lv);float r=spotLights[i].distance;float t=r>0.0?dot(lv,lv)/(r*r):0.0;
  float cone=getSpotAttenuation(spotLights[i].coneCos,spotLights[i].penumbraCos,dot(L,spotLights[i].direction));
  legacyAccumulate(N,V,L,spotLights[i].color*(2.0*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)}),legacyAttenuation(t)*cone,shininess,light,spec);}
 #endif
 light+=legacyAmbient(geoN); // SH from the vertex normal, as the compiled programs do
 vec3 outColor=albedo*light;
 #ifdef LEGACY_SPEC
 outColor+=light*legacySpecColor.rgb*(spec*gloss);
 #endif
#endif
#ifndef LEGACY_BLEND
 alpha=1.0;
#endif
 gl_FragColor=vec4(sRGBTransferEOTF(vec4(max(outColor,vec3(0.0)),1.0)).rgb,alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 #ifdef USE_FOG
  #ifdef FOG_EXP2
 float fogFactor=1.0-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
  #else
 float fogFactor=saturate((vFogDepth-fogNear)/(fogFar-fogNear)); // Unity linear fog (three's chunk uses smoothstep)
  #endif
 gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,fogFactor);
 #endif
 #include <premultiplied_alpha_fragment>
 #include <dithering_fragment>
}`;

const leafVertexLighting=`
#ifdef LEGACY_LEAF
 {vec3 nV=normalize(transformedNormal),vV=normalize(-mvPosition.xyz);
  float aoE=saturate(pow(ao+0.0999756,3.0));vec3 col=legacyColor.rgb*aoE;
  #ifdef USE_COLOR
  col*=vColor.rgb;
  #endif
  vec3 mainLight=vec3(0.0);float viewBack=0.0;
  #if NUM_DIR_LIGHTS > LEGACY_FIRST_SUN
  for(int i=LEGACY_FIRST_SUN;i<NUM_DIR_LIGHTS;i++){vec3 L=directionalLights[i].direction;float nl=dot(nV,L);float vb=saturate(dot(vV,-L));if(i==LEGACY_FIRST_SUN)viewBack=vb;
   float back=mix(saturate(-nl),vb,legacyViewDependency);mainLight+=directionalLights[i].color*(max(0.0,nl*0.6+0.4)+back*legacyTranslucencyColor);}
  #endif
  vec3 front=ambientLightColor,backA=ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
  for(int i=0;i<NUM_HEMI_LIGHTS;i++){front+=getHemisphereLightIrradiance(hemisphereLights[i],nV);backA+=getHemisphereLightIrradiance(hemisphereLights[i],-nV);}
  #endif
  vec3 amb=front+backA*mix(1.0,viewBack,legacyViewDependency)*legacyTranslucencyColor;
  vLeafLight=0.25*amb*col;vLeafMain=mainLight*col;}
#endif`;
// Vertex-stage twin of SUN_SHADOW_GLSL's LEGACY_FIRST_SUN (the shadow-caster lights come first).
const firstSunVertex=`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
#define LEGACY_FIRST_SUN NUM_DIR_LIGHT_SHADOWS
#else
#define LEGACY_FIRST_SUN 0
#endif
`;
// QualitySettings.blendWeights: the strongest 1/2/4 bone weights, renormalised (see limitBlendWeights).
const blendWeightsVertex=`
#ifdef USE_SKINNING
uniform float legacyBlendWeights;
vec4 legacyWeights(vec4 w){if(legacyBlendWeights>=4.0)return w;
 float a=max(w.x,w.y),b=min(w.x,w.y),c=max(w.z,w.w),d=min(w.z,w.w);
 float m=legacyBlendWeights<1.5?max(a,c):max(min(a,c),max(b,d));
 vec4 o=w*vec4(greaterThanEqual(w,vec4(m)));float s=dot(o,vec4(1.0));return s>0.0?o/s:w;}
#endif
`;

function patchVertex(src){
 let s=`${commonPars}
#ifdef LEGACY_TREE
attribute float ao;
#endif
#ifdef LEGACY_TREE_SQUASH
attribute float treeSquash;uniform vec3 treeSquashCenter;uniform vec3 treeSquashNormal;
#endif
#ifdef LEGACY_TREE_WIND
attribute vec4 treeWind;uniform vec4 treeWindForce;uniform float treeTime;
${TREE_WIND_GLSL}
#endif
${firstSunVertex}${blendWeightsVertex}`+src.replace('#include <common>','#include <common>\n#ifdef LEGACY_LEAF\n#include <lights_pars_begin>\n#endif');
 s=s.replace('#include <uv_vertex>','#include <uv_vertex>\nvLegacyUv=uv;\n#ifdef LEGACY_TREE\nvTreeAo=ao;\n#endif');
 s=s.replace('#include <skinbase_vertex>','#include <skinbase_vertex>\n#ifdef USE_SKINNING\nvec4 legacySkinW=legacyWeights(skinWeight);\n#endif')
  .replace('#include <skinnormal_vertex>',THREE.ShaderChunk.skinnormal_vertex.replaceAll('skinWeight','legacySkinW'))
  .replace('#include <skinning_vertex>',THREE.ShaderChunk.skinning_vertex.replaceAll('skinWeight','legacySkinW'));
 // Tree Creator TreeVertBark/TreeVertLeaf: v.vertex.xyz *= _Scale (the terrain's TreeInstance width/height scale; the
 // object matrix only translates), AnimateVertex (wind), then squash towards the billboard plane through the bounds centre.
 // The normal is not scaled (_Scale touches positions only), so the instance scale is kept out of it.
 s=s.replace('#include <defaultnormal_vertex>',`#include <defaultnormal_vertex>
#if defined(LEGACY_TREE_SQUASH) && defined(USE_INSTANCING)
 transformedNormal=normalMatrix*objectNormal;
 #ifdef FLIP_SIDED
 transformedNormal=-transformedNormal;
 #endif
#endif`);
 s=s.replace('#include <project_vertex>',`#if defined(LEGACY_TREE_SQUASH) && defined(USE_INSTANCING)
 vec3 treeLocal=transformed*vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
 #ifdef LEGACY_TREE_WIND
 treeLocal=legacyTreeAnimate(treeLocal,objectNormal,treeWind);
 #endif
 vec4 treeWorld=modelMatrix*vec4(instanceMatrix[3].xyz+treeLocal,1.0),treeCenter=modelMatrix*instanceMatrix*vec4(treeSquashCenter,1.0);
 treeWorld.xyz-=dot(treeWorld.xyz-treeCenter.xyz,treeSquashNormal)*treeSquashNormal*(1.0-treeSquash);
 vec4 mvPosition=viewMatrix*treeWorld;gl_Position=projectionMatrix*mvPosition;
#else
 #include <project_vertex>
#endif`);
 s=s.replace('#include <fog_vertex>','#include <fog_vertex>'+leafVertexLighting);
 return s;
}

const st=slot=>new THREE.Vector4(slot?.scale?.x??1,slot?.scale?.y??1,slot?.offset?.x??0,slot?.offset?.y??0);
const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
const flatNormal=new THREE.DataTexture(new Uint8Array([128,128,128,128]),1,1);flatNormal.needsUpdate=true; // DXT5nm (0,0,1)

// MeshLambertMaterial keeps three's vertex path (instancing, skinning, fog, clipping) and light uniforms; the fragment
// stage is replaced by the original lighting. Program identity = 'legacy' + defines, so equal variants share programs.
export class LegacyMaterial extends THREE.MeshLambertMaterial{
 constructor(parameters){super();this.isLegacyMaterial=true;this.legacyModel=null;this.defines={};
  this.legacyUniforms={legacyColor:{value:new THREE.Vector4(1,1,1,1)},legacySpecColor:{value:new THREE.Vector4(0.5,0.5,0.5,1)},legacyShininess:{value:0.078125},legacyCutoff:{value:0.5},
   legacyMainTex:{value:white},legacyMainST:{value:new THREE.Vector4(1,1,0,0)},legacyBumpMap:{value:flatNormal},legacyBumpST:{value:new THREE.Vector4(1,1,0,0)},
   legacyMainTex2:{value:white},legacyMain2ST:{value:new THREE.Vector4(1,1,0,0)},legacyBumpMap2:{value:flatNormal},legacyBump2ST:{value:new THREE.Vector4(1,1,0,0)},legacyOpacity:{value:1},
   legacyGlossMap:{value:white},legacyGlossST:{value:new THREE.Vector4(1,1,0,0)},legacyTranslucencyColor:{value:new THREE.Color(0.73,0.85,0.41)},legacyViewDependency:{value:0.7},
   treeSquashCenter:{value:new THREE.Vector3()},treeSquashNormal:{value:new THREE.Vector3(0,0,-1)},treeLodBias:{value:0},legacyLeafShadowStrength:{value:1}};
  if(parameters)this.setValues(parameters);}
 onBeforeCompile(shader){Object.assign(shader.uniforms,this.legacyUniforms,LEGACY_GLOBAL_UNIFORMS,SUN_SHADOW_UNIFORMS,EYE_SHADOW_UNIFORMS);shader.vertexShader=patchVertex(shader.vertexShader);shader.fragmentShader=legacyFragment;}
 customProgramCacheKey(){return 'legacy-v2';}
 copy(source){super.copy(source);if(source.isLegacyMaterial){this.legacyModel=source.legacyModel;this.defines={...source.defines};
   for(const [k,u] of Object.entries(source.legacyUniforms)){const v=u.value;this.legacyUniforms[k]={value:v?.isTexture?v:(v?.clone?v.clone():v)};}
   for(const k of ['legacyMainMap','legacyBumpMapTexture','legacyMainMap2','legacyBumpMapTexture2','legacyGlossTexture'])this[k]=source[k];}
  return this;}
}

// Builds the material for an exported description m ({shader,name,color,texture,scale,offset,cutoff,textures,floats,
// colors}). texture(slot) -> Promise<THREE.Texture> must return textures with NoColorSpace (raw gamma values).
// The texture slots createLegacyMaterial(m) loads, in its order: asset loaders start them early (scene.mjs prefetch).
export function legacyTextureSlots(m){const model=legacyShaderModel(m.shader),slots=m.textures??{},out=[];
 const main=slots._MainTex??(m.texture?{file:m.texture,scale:m.scale,offset:m.offset}:null);if(main)out.push(main);
 const bump=model.tree==='bark'?slots._BumpSpecMap:slots._BumpMap;if(model.bump&&bump)out.push(bump);
 if(model.overlay){if(slots._MainTex2)out.push(slots._MainTex2);if(slots._BumpMap2)out.push(slots._BumpMap2);}
 if(model.tree==='bark'&&slots._TranslucencyMap)out.push(slots._TranslucencyMap);
 return out;}
export async function createLegacyMaterial(m,texture){
 const model=legacyShaderModel(m.shader),mat=new LegacyMaterial({name:m.name});mat.legacyModel=model;mat.defines=legacyDefines(model);
 const u=mat.legacyUniforms,slots=m.textures??{},c=m.colors?._Color??m.color??{r:1,g:1,b:1,a:1};
 u.legacyColor.value.set(c.r,c.g,c.b,c.a??1);
 const spec=m.colors?._SpecColor;if(spec)u.legacySpecColor.value.set(spec.r,spec.g,spec.b,spec.a??1);
 if(m.floats?._Shininess!==undefined)u.legacyShininess.value=m.floats._Shininess;
 u.legacyCutoff.value=m.floats?._Cutoff??m.cutoff??0.5;
 const main=slots._MainTex??(m.texture?{file:m.texture,scale:m.scale,offset:m.offset}:null);
 // Own enumerable texture properties so loaders that pre-upload a material's textures (renderer.initTexture) find them.
 if(main){mat.legacyMainMap=u.legacyMainTex.value=await texture(main);u.legacyMainST.value.copy(st(main));}
 const bump=model.tree==='bark'?slots._BumpSpecMap:slots._BumpMap;
 if(model.bump&&bump){mat.legacyBumpMapTexture=u.legacyBumpMap.value=await texture(bump);u.legacyBumpST.value.copy(st(bump));}
 if(model.overlay){const under=slots._MainTex2,underBump=slots._BumpMap2;
  if(under){mat.legacyMainMap2=u.legacyMainTex2.value=await texture(under);u.legacyMain2ST.value.copy(st(under));}
  if(underBump){mat.legacyBumpMapTexture2=u.legacyBumpMap2.value=await texture(underBump);u.legacyBump2ST.value.copy(st(underBump));}
  u.legacyOpacity.value=m.floats?._Opacity??1;}
 if(model.tree==='bark'&&slots._TranslucencyMap){mat.legacyGlossTexture=u.legacyGlossMap.value=await texture(slots._TranslucencyMap);u.legacyGlossST.value.copy(st(slots._TranslucencyMap));}
 if(model.tree==='leaf'){const t=m.colors?._TranslucencyColor;if(t)u.legacyTranslucencyColor.value.setRGB(t.r,t.g,t.b);if(m.floats?._TranslucencyViewDependency!==undefined)u.legacyViewDependency.value=m.floats._TranslucencyViewDependency;
  if(m.floats?._ShadowStrength!==undefined)u.legacyLeafShadowStrength.value=m.floats._ShadowStrength;}
 // Unity's surface shaders cull back faces (Cull Back is the default in every pass used here).
 mat.side=THREE.FrontSide;
 if(model.blend){mat.transparent=true;mat.depthWrite=false;}
 if(model.offset){mat.polygonOffset=true;mat.polygonOffsetFactor=model.offset[0];mat.polygonOffsetUnits=model.offset[1];}
 if(!model.fog)mat.fog=false;
 return mat;
}

// View-model materials take the sun shadow at the eye (sun-shadows.mjs EYE_SHADOW_*). Set before the first compile.
export function enableEyeShadow(mat){if(mat?.isLegacyMaterial&&mat.defines&&!('LEGACY_EYE_SHADOW' in mat.defines)){mat.defines={...mat.defines,LEGACY_EYE_SHADOW:''};mat.needsUpdate=true;}return mat;}

// Turns a tree material into its squashing / imposter-capture variant (Tree Creator vertex functions). wind: shared
// {force:{value:Vector4}, time:{value}} uniforms (the terrain's _Wind and _Time.y); the geometry then needs the treeWind
// attribute. Billboard captures (Tree Creator *Rendertex shaders) have no wind.
export function legacyTreeVariant(mat,{squashCenter,squashNormal,lodBias,imposter=false,wind=null}){
 mat.defines={...mat.defines,LEGACY_TREE_SQUASH:''};if(imposter)mat.defines.LEGACY_TREE_IMPOSTER='';
 if(wind&&!imposter){mat.defines.LEGACY_TREE_WIND='';mat.legacyUniforms.treeWindForce=wind.force;mat.legacyUniforms.treeTime=wind.time;}
 mat.legacyUniforms.treeSquashCenter={value:squashCenter};mat.legacyUniforms.treeSquashNormal=squashNormal;if(lodBias)mat.legacyUniforms.treeLodBias=lodBias;
 mat.needsUpdate=true;return mat;
}

// --- Nature/Terrain/Facepunch Terrain (the terrain material template from TerrainControl) ---------------------------
// PrePassBase normal and PrePassFinal colour, decompiled from shader.000 (37636092). Within 300 m (smoothstep to 500 m)
// albedo = (0.65 * Splat0(uv0) + 0.35 * Splat0(-0.5 uv0)) * c.r + Splat1 * c.g + Splat2 * c.b + Splat3 * c.a, times
// _ControlColor / (sum c_i * _ColTex_i); far away _ControlColor * (1.25 - c.r) + 0.75 * c.r * Splat0(0.1 uv0). The
// normal blends layer 0's normal map (two scales) on the terrain tangent frame (tangent = cross(N, Z), binormal =
// -cross(N, T)) into the world normal map _ControlNormal (x, z, y) between 30 and 500 m. Lambert light pre-pass.
const terrainFragment=`#define LAMBERT
varying vec3 vViewPosition;varying vec2 terrainUv;varying vec3 vTerrainWorld;varying vec3 vTerrainNormal;
uniform sampler2D tControl;uniform sampler2D tSplat0;uniform sampler2D tSplat1;uniform sampler2D tSplat2;uniform sampler2D tSplat3;
uniform sampler2D tNormal0;uniform sampler2D tControlColor;uniform sampler2D tControlNormal;
uniform vec4 tSplatScale;uniform vec3 tColTex0;uniform vec3 tColTex1;uniform vec3 tColTex2;uniform vec3 tColTex3;
#include <common>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <packing>
#include <shadowmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
${qualityPars}${SUN_SHADOW_GLSL}
vec2 tUnpack(vec4 p){return p.wy*2.0-1.0;}
vec3 tNormal(vec2 xy){return vec3(xy,sqrt(1.0-saturate(dot(xy,xy))));}
float legacyAttenuation(float t){if(t>=1.0)return 0.0;float a=1.0/(1.0+25.0*t);return t>${ATTEN_FADE_START.toFixed(2)}?a*(1.0-(t-${ATTEN_FADE_START.toFixed(2)})/${(1-ATTEN_FADE_START).toFixed(2)}):a;}
void main(){
 #include <clipping_planes_fragment>
 #include <logdepthbuf_fragment>
 vec4 ctrl=texture2D(tControl,terrainUv);
 vec2 uv0=terrainUv*tSplatScale.x;
 vec2 dxz=vTerrainWorld.xz-cameraPosition.xz;float dist=length(dxz);
 // Normal (PrePassBase), in Unity world space (browser z negated).
 vec3 gB=normalize(vTerrainNormal);vec3 gN=vec3(gB.x,gB.y,-gB.z); // the LOD grid has no normal attribute (three would flat-shade)
 vec3 T=cross(gN,vec3(0.0,0.0,1.0)),B=-cross(gN,T);
 vec3 nearT=ctrl.x*tNormal(tUnpack(legacySample(tNormal0,uv0)))+vec3(0.0,0.0,ctrl.y+ctrl.z+ctrl.w);
 vec3 nearN=normalize(mat3(T,B,gN)*normalize(nearT));
 vec3 farLayer=mat3(T,B,gN)*tNormal(tUnpack(legacySample(tNormal0,uv0*0.1)));
 vec2 cn=tUnpack(texture2D(tControlNormal,terrainUv));vec3 cw=vec3(cn.x,sqrt(1.0-saturate(dot(cn,cn))),cn.y);
 vec3 farN=normalize(cw*1.3300781+farLayer*(ctrl.x*0.66699219))/(ctrl.x*0.66699219+1.3300781);
 float nf=saturate((dist-30.0)*0.0021276595);nf=nf*nf*(3.0-2.0*nf);
 vec3 nU=normalize(mix(nearN,farN,nf));
 vec3 N=normalize((viewMatrix*vec4(nU.x,nU.y,-nU.z,0.0)).xyz);
 // Albedo (PrePassFinal).
 vec3 colCorr=ctrl.x*tColTex0+ctrl.y*tColTex1+ctrl.z*tColTex2+ctrl.w*tColTex3;
 vec3 ratio=texture2D(tControlColor,terrainUv).rgb/colCorr;
 vec3 detail=(legacySample(tSplat0,uv0).rgb*0.64999998+legacySample(tSplat0,uv0*-0.5).rgb*0.34999999)*ctrl.x
  +legacySample(tSplat1,terrainUv*tSplatScale.y).rgb*ctrl.y+legacySample(tSplat2,terrainUv*tSplatScale.z).rgb*ctrl.z+legacySample(tSplat3,terrainUv*tSplatScale.w).rgb*ctrl.w;
 vec3 nearC=detail*ratio,farC=texture2D(tControlColor,terrainUv).rgb*(1.25-ctrl.x)+legacySample(tSplat0,uv0*0.1).rgb*(ctrl.x*0.75);
 float cf=saturate((dist-300.0)*0.0049999999);cf=cf*cf*(3.0-2.0*cf);
 vec3 albedo=mix(nearC,farC,cf);
 vec3 P=-vViewPosition,light=vec3(0.0);
 #if NUM_DIR_LIGHTS > LEGACY_FIRST_SUN
 float sunAtten=legacySunShadow(P,normalize((viewMatrix*vec4(gB,0.0)).xyz));
 for(int i=LEGACY_FIRST_SUN;i<NUM_DIR_LIGHTS;i++)light+=directionalLights[i].color*2.0*max(0.0,dot(N,directionalLights[i].direction))*sunAtten;
 #endif
 #if NUM_POINT_LIGHTS > 0
 for(int i=0;i<NUM_POINT_LIGHTS;i++){vec3 lv=pointLights[i].position-P;float r=pointLights[i].distance;float t=r>0.0?dot(lv,lv)/(r*r):0.0;
  light+=pointLights[i].color*(2.0*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)})*max(0.0,dot(N,normalize(lv)))*legacyAttenuation(t);}
 #endif
 #if NUM_SPOT_LIGHTS > 0
 for(int i=0;i<NUM_SPOT_LIGHTS;i++){vec3 lv=spotLights[i].position-P;vec3 L=normalize(lv);float r=spotLights[i].distance;float t=r>0.0?dot(lv,lv)/(r*r):0.0;
  light+=spotLights[i].color*(2.0*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)})*max(0.0,dot(N,L))*legacyAttenuation(t)*getSpotAttenuation(spotLights[i].coneCos,spotLights[i].penumbraCos,dot(L,spotLights[i].direction));}
 #endif
 vec3 amb=ambientLightColor;
 #if NUM_HEMI_LIGHTS > 0
 for(int i=0;i<NUM_HEMI_LIGHTS;i++)amb+=getHemisphereLightIrradiance(hemisphereLights[i],normalize((viewMatrix*vec4(gB,0.0)).xyz));
 #endif
 gl_FragColor=vec4(sRGBTransferEOTF(vec4(max(albedo*(light+amb),vec3(0.0)),1.0)).rgb,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 #ifdef USE_FOG
 gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,saturate((vFogDepth-fogNear)/(fogFar-fogNear)));
 #endif
}`;

export class LegacyTerrainMaterial extends THREE.MeshLambertMaterial{
 constructor(){super();this.isLegacyMaterial=true;this.terrainUniforms={};}
 onBeforeCompile(shader){Object.assign(shader.uniforms,this.terrainUniforms,LEGACY_GLOBAL_UNIFORMS,SUN_SHADOW_UNIFORMS);
  shader.vertexShader='varying vec3 vTerrainWorld;varying vec3 vTerrainNormal;\n'+shader.vertexShader.replace('#include <fog_vertex>','#include <fog_vertex>\nvTerrainWorld=(modelMatrix*vec4(transformed,1.0)).xyz;vTerrainNormal=mat3(modelMatrix)*objectNormal;');
  shader.fragmentShader=terrainFragment;}
 customProgramCacheKey(){return 'legacy-terrain-v2';}
}

// data: world-materials.json terrain block; texture(file, {color}) -> Promise<THREE.Texture> (NoColorSpace, flipY,
// repeat). layers: the four splat textures in prototype order (manifest.layers files), control: the splat alpha map.
// legacyTerrainMaterial returns the material at once and `loaded`, which resolves once every texture is in its uniforms:
// the material must not be compiled before then (main.mjs builds the terrain and imports the scene while the 4096²
// control normal map decodes, and awaits `loaded` before the shader warm-up).
export function legacyTerrainMaterial(data,{texture,layers,control}){
 const mat=new LegacyTerrainMaterial(),[c0,c1,c2,c3]=data.colTex,size=data.size?.x??16000,scale=data.splats.map(s=>size/s.tileSize.x);
 const loaded=Promise.all([...layers.map(f=>texture(f)),texture(data.normal0.file),texture(data.controlColor.file),texture(data.controlNormal.file),texture(control,{clamp:true})]).then(([splat0,splat1,splat2,splat3,normal0,controlColor,controlNormal,tex])=>{
  Object.assign(mat.terrainUniforms,{tControl:{value:tex},tSplat0:{value:splat0},tSplat1:{value:splat1},tSplat2:{value:splat2},tSplat3:{value:splat3},tNormal0:{value:normal0},tControlColor:{value:controlColor},tControlNormal:{value:controlNormal},
   tSplatScale:{value:new THREE.Vector4(...scale)},tColTex0:{value:new THREE.Vector3(c0.r,c0.g,c0.b)},tColTex1:{value:new THREE.Vector3(c1.r,c1.g,c1.b)},tColTex2:{value:new THREE.Vector3(c2.r,c2.g,c2.b)},tColTex3:{value:new THREE.Vector3(c3.r,c3.g,c3.b)}});
  Object.assign(mat,{legacyControl:tex,legacySplats:[splat0,splat1,splat2,splat3],legacyNormal0:normal0,legacyControlColor:controlColor,legacyControlNormal:controlNormal});
  return mat;});
 return {material:mat,loaded};
}
export async function createLegacyTerrainMaterial(data,options){return legacyTerrainMaterial(data,options).loaded;}

// Reference maths for the terrain albedo (tests): inputs are gamma colours.
export function terrainAlbedo({ctrl,splat0Near,splat0Half,splat0Far,splat1,splat2,splat3,controlColor,colTex,distance}){
 const cc=[0,1,2].map(i=>ctrl[0]*colTex[0][i]+ctrl[1]*colTex[1][i]+ctrl[2]*colTex[2][i]+ctrl[3]*colTex[3][i]);
 const near=[0,1,2].map(i=>((splat0Near[i]*0.64999998+splat0Half[i]*0.34999999)*ctrl[0]+splat1[i]*ctrl[1]+splat2[i]*ctrl[2]+splat3[i]*ctrl[3])*controlColor[i]/cc[i]);
 const far=[0,1,2].map(i=>controlColor[i]*(1.25-ctrl[0])+splat0Far[i]*ctrl[0]*0.75);
 let f=sat((distance-300)*0.0049999999);f=f*f*(3-2*f);return near.map((v,i)=>v+(far[i]-v)*f);
}

// For materials outside this module (e.g. a MeshStandardMaterial/MeshLambertMaterial with an sRGB map): replaces
// three.js's lighting result with the original Lambert light pre-pass term, albedo * (2 * sum(C * N.L * atten) + ambient),
// computed in gamma space from the decoded albedo. Keeps the material's other features (alpha test, maps, fog).
const legacyLambertGLSL=`
float legacyAttenuationL(float t){if(t>=1.0)return 0.0;float a=1.0/(1.0+25.0*t);return t>${ATTEN_FADE_START.toFixed(2)}?a*(1.0-(t-${ATTEN_FADE_START.toFixed(2)})/${(1-ATTEN_FADE_START).toFixed(2)}):a;}
vec3 legacyLambertLight(vec3 N,vec3 geoN,vec3 P){vec3 light=ambientLightColor;
 #if NUM_HEMI_LIGHTS > 0
 for(int i=0;i<NUM_HEMI_LIGHTS;i++)light+=getHemisphereLightIrradiance(hemisphereLights[i],geoN);
 #endif
 #if NUM_DIR_LIGHTS > 0
 for(int i=0;i<NUM_DIR_LIGHTS;i++)light+=directionalLights[i].color*2.0*max(0.0,dot(N,directionalLights[i].direction));
 #endif
 #if NUM_POINT_LIGHTS > 0
 for(int i=0;i<NUM_POINT_LIGHTS;i++){vec3 lv=pointLights[i].position-P;float r=pointLights[i].distance;float t=r>0.0?dot(lv,lv)/(r*r):0.0;light+=pointLights[i].color*(2.0*${LEGACY_POINT_LIGHT_SCALE.toFixed(8)})*max(0.0,dot(N,normalize(lv)))*legacyAttenuationL(t);}
 #endif
 return light;}
`;
export function legacyLambertPatch(material){
 const previous=material.onBeforeCompile;
 material.onBeforeCompile=(shader,renderer)=>{previous?.call(material,shader,renderer);
  const target=/vec3 outgoingLight = [^;]*;/;if(!target.test(shader.fragmentShader))throw Error('legacyLambertPatch: unsupported material');
  shader.fragmentShader=shader.fragmentShader.replace('void main() {',legacyLambertGLSL+'void main() {')
   .replace(target,'vec3 outgoingLight=sRGBTransferEOTF(vec4(sRGBTransferOETF(vec4(max(diffuseColor.rgb,vec3(0.0)),1.0)).rgb*legacyLambertLight(normal,nonPerturbedNormal,-vViewPosition),1.0)).rgb;');};
 const key=material.customProgramCacheKey?.bind(material);material.customProgramCacheKey=()=>'legacy-lambert:'+(key?.()??'');
 return material;
}
