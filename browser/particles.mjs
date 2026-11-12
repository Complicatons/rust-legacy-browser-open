import * as THREE from 'three';
import {lightAttenuation,LEGACY_POINT_LIGHT_SCALE} from './legacy-materials.mjs';
// Unity 4 Shuriken (ParticleSystem + ParticleSystemRenderer) driven by the recovered serialized modules. Every module and
// field the shipped prefabs enable is handled (enumerated by tools/_fx-enum.mjs over the deployables/airdrop/menu exports):
// Initial (lifetime/speed/size/rotation/colour, start curves sampled at the system's normalised time, gravity,
// inheritVelocity for world-space systems), Shape (sphere/hemisphere volume+shell, cone base/shell/volume, box, mesh
// vertex/edge/triangle, randomDirection), Emission (time and distance rate, bursts, one-shot systems), Size/Colour/Rotation
// over lifetime (colour gradient or random between two gradients), texture sheet (whole sheet / single row, rowIndex,
// randomRow, cycles), Velocity over lifetime, Force (local/world, randomizePerFrame), External Forces (the scene WindZone),
// Limit Velocity (magnitude or separate axes, dampen), Size/Colour/Rotation by speed, SubModule birth/death emitters.
// Renderer: billboard, stretched, horizontal/vertical billboard, mesh (instanced, with the original lit material),
// sort modes (none/distance/oldest/youngest in front), m_MaxParticleSize, m_NormalDirection.
// Shading follows the shipped particle shader programs (analysis/shader-source): blend factors, x2 _TintColor, alpha
// tests, per-shader fog colours (black for additive, white for multiply, scene colour, or off), "View Model/Particles/*"
// ZTest Always, and vertex lighting for Particles/VertexLit Blended (fixed-function), VertexLit Blended Billboard
// (its vertex program) and Transparent/Lit Colored (forward Lambert). Everything is computed in gamma space like Unity 4.
// Collision, prewarm and start delay are unused by the shipped systems. Particles simulate in the emitter's local Unity
// space (moveWithTransform) and are drawn in browser space.

// AnimationCurve: Hermite segments between keys; clamps outside the key range.
export function evalCurve(curve,t){const k=curve?.m_Curve??[];if(!k.length)return 0;if(t<=k[0].time)return k[0].value;const last=k[k.length-1];if(t>=last.time)return last.value;
 for(let i=0;i<k.length-1;i++){const a=k[i],b=k[i+1];if(t>b.time)continue;const dt=b.time-a.time;if(dt<=0)return b.value;const s=(t-a.time)/dt,s2=s*s,s3=s2*s;
  return (2*s3-3*s2+1)*a.value+(s3-2*s2+s)*dt*a.outSlope+(-2*s3+3*s2)*b.value+(s3-s2)*dt*b.inSlope;}
 return last.value;}
// MinMaxCurve: 0 scalar, 1 curve, 2 random between curves, 3 random between constants (first key values).
export function evalMinMax(mc,t,rand){if(!mc)return 0;const s=mc.scalar;switch(mc.minMaxState){case 1:return s*evalCurve(mc.maxCurve,t);
 case 2:return s*THREE.MathUtils.lerp(evalCurve(mc.minCurve,t),evalCurve(mc.maxCurve,t),rand);
 case 3:return s*THREE.MathUtils.lerp(mc.minCurve.m_Curve[0]?.value??0,mc.maxCurve.m_Curve[0]?.value??0,rand);default:return s;}}
// ColorRGBA32 is packed r | g<<8 | b<<16 | a<<24.
export const unpack=v=>[(v&255)/255,((v>>>8)&255)/255,((v>>>16)&255)/255,((v>>>24)&255)/255];
// Gradient: colour keys use keyN.rgb at ctimeN, alpha keys keyN.a at atimeN (times scaled by 65535).
export function evalGradient(g,t){const color=[1,1,1],nc=g.m_NumColorKeys,na=g.m_NumAlphaKeys;
 const pick=(n,time,channel)=>{let prev=0;for(let i=0;i<n;i++){const ti=g[time+i]/65535;if(t<=ti){if(i===0)return channel(0);const tp=g[time+prev]/65535,f=ti>tp?(t-tp)/(ti-tp):1;return THREE.MathUtils.lerp(channel(prev),channel(i),f);}prev=i;}return channel(n-1);};
 for(let c=0;c<3;c++)color[c]=pick(nc,'ctime',i=>unpack(g['key'+i].rgba)[c]);return [...color,pick(na,'atime',i=>unpack(g['key'+i].rgba)[3])];}
// MinMaxGradient: 0 colour, 1 gradient (at t), 2 random between two colours, 3 random between two gradients (at t).
export function evalMinMaxGradient(mmg,t,rand){const mix=(a,b)=>a.map((v,i)=>THREE.MathUtils.lerp(v,b[i],rand));switch(mmg.minMaxState){case 0:return unpack(mmg.maxColor.rgba);case 1:return evalGradient(mmg.maxGradient,t);
 case 2:return mix(unpack(mmg.minColor.rgba),unpack(mmg.maxColor.rgba));default:return mix(evalGradient(mmg.minGradient,t),evalGradient(mmg.maxGradient,t));}}

const H=new THREE.Matrix4().makeScale(1,1,-1);
export const speedFraction=(speed,range)=>{const lo=range?.x??0,span=(range?.y??1)-lo;return THREE.MathUtils.clamp(span>0?(speed-lo)/span:0,0,1);};
// Shuriken SubModule: a system named as a sub-emitter does not emit on its own; its parent emits it. Birth sub-emitters emit with their
// own rate/bursts over each parent particle's life, death sub-emitters emit their burst counts where a parent particle dies (Unity 4).
// Effects carry the serialized ParticleSystem path id (`id`); pointers with m_FileID 0 are in the same prefab file.
export function linkSubEmitters(effects){const byId=new Map(effects.filter(e=>e.id!=null).map(e=>[e.id,e]));
 for(const e of effects){const s=e.def.SubModule;if(!s?.enabled)continue;
  const link=fields=>fields.map(f=>s[f]).filter(ptr=>ptr?.m_PathID&&!ptr.m_FileID).map(ptr=>byId.get(ptr.m_PathID)).filter(c=>c&&c!==e)
   .map(c=>({effect:c,toChild:new THREE.Matrix4().copy(H).multiply(c.nodeMatrix.clone().invert()).multiply(e.nodeMatrix).multiply(H)}));
  const birth=link(['subEmitterBirth','subEmitterBirth1']),death=link(['subEmitterDeath','subEmitterDeath1']);if(!birth.length&&!death.length)continue;
  e.subEmitters={birth,death};for(const l of [...birth,...death])l.effect.isSubEmitter=true;}
 return effects;}

// --- Shading programs (analysis/shader-source particle shaders, OpenGL subprograms) -----------------------------------
// blend: add (SrcAlpha One), alpha (SrcAlpha OneMinusSrcAlpha), soft (One OneMinusSrcColor, rgb *= a), premultiply
// (One OneMinusSrcAlpha, colour * vertex alpha), multiply (Zero SrcColor, lerp(1, c, c.a)). tint multiplies the vertex
// colour (Particles/Additive and Alpha Blended and the View Model variants: 2 * _TintColor). fog: the Fog block colour
// (scene, black, white) or off. lit: ffp / billboard / forward lighting computed per vertex on the CPU.
const rgbaOf=(c,d)=>c?[c.r,c.g,c.b,c.a??1]:d;
// Soft particles (QualitySettings.softParticles -> SOFTPARTICLES_ON, Beautiful and Fantastic): the shipped programs with a
// SOFTPARTICLES_ON fragment variant read _CameraDepthTexture at the fragment (TXP of the screen position), take
// LinearEyeDepth = 1 / (_ZBufferParams.z * d + _ZBufferParams.w) and fade = saturate(_InvFade * (scene - fragment eye depth)).
// The fade scales the vertex alpha (Additive, Alpha Blended, Additive (Soft), Multiply); Alpha Blended Premultiply uses
// a = vertex alpha * fade for both the colour alpha and the final multiply (rgb x fade, alpha x fade^2 relative to the
// hard variant). View Model/Particles/Additive (Front) and Alpha Blend fade the same way (their eye depth comes from the
// modelview matrix, the world depth from the main camera's texture); View Model/Particles/Additive's SOFTPARTICLES_ON
// program is identical to its OFF one, and the VertexLit/Lit shaders have no variant. _InvFade: the material's float
// (shader default 1).
export const SOFT_PARTICLE_SHADERS=Object.freeze(['Particles/Additive','Particles/Alpha Blended','Particles/Additive (Soft)','Particles/Alpha Blended Premultiply','Particles/Multiply',
 'View Model/Particles/Additive (Front)','View Model/Particles/Alpha Blend']);
export function softParticleFade(sceneEyeDepth,fragmentEyeDepth,invFade){return Math.min(1,Math.max(0,invFade*(sceneEyeDepth-fragmentEyeDepth)));}
// Unity's LinearEyeDepth for a 0..1 depth-texture value (OpenGL: _ZBufferParams z = (1 - far/near)/far, w = 1/near).
export function linearEyeDepth(d,near,far){return 1/(d*(1-far/near)/far+1/near);}
// Shared by every soft-capable particle program (one update reaches all of them; no recompiles when the level changes):
// the scene depth copy, on/off for the current pass, camera near/far and 1 / target size for the screen position.
export const SOFT_PARTICLE_UNIFORMS={softDepth:{value:null},softOn:{value:0},softNearFar:{value:new THREE.Vector2(0.1,1000)},softInvScreen:{value:new THREE.Vector2(1,1)}};
// Soft-capable particle meshes mark the frame they drew something (browser/soft-particles.mjs requests the scene depth then).
export const SOFT_PARTICLE_DRAWS={frame:0,last:-Infinity};
export function markSoftDraw(){if(this.geometry?.drawRange?.count>0)SOFT_PARTICLE_DRAWS.last=SOFT_PARTICLE_DRAWS.frame;}
export function particleShading(shader,material){const s=shader??'',colors=material?.colors??{},vm=/^View Model\/Particles\//.test(s),tint2=rgbaOf(colors._TintColor,[0.5,0.5,0.5,0.5]).map(v=>2*v);
 const invFade=Number.isFinite(material?.floats?._InvFade)?material.floats._InvFade:1;
 const base={blend:'alpha',tint:[1,1,1,1],fog:'scene',alphaTest:null,depthTest:!vm,front:/\(Front\)/.test(s)&&vm,lit:null,emission:[0,0,0],shader:s,soft:SOFT_PARTICLE_SHADERS.includes(s),invFade};
 if(/^(Particles\/Additive|View Model\/Particles\/Additive)( \(Front\))?$/.test(s))return {...base,blend:'add',tint:tint2,fog:'black',alphaTest:0.01};
 // View Model/Particles/Alpha Blend doubles only the colour: its alpha is texture * vertex * _TintColor.a (MUL result.color.w).
 if(s==='Particles/Alpha Blended')return {...base,tint:tint2,alphaTest:0.01};
 if(s==='View Model/Particles/Alpha Blend')return {...base,tint:[...tint2.slice(0,3),tint2[3]/2],fog:'black',alphaTest:0.01};
 if(s==='Particles/Additive (Soft)')return {...base,blend:'soft',fog:'black'};
 if(s==='Particles/Alpha Blended Premultiply')return {...base,blend:'premultiply',fog:'off'};
 if(s==='Particles/Multiply')return {...base,blend:'multiply',fog:'white'};
 if(s==='Particles/VertexLit Blended')return {...base,lit:'ffp',emission:rgbaOf(colors._EmisColor,[0.2,0.2,0.2,0]).slice(0,3),alphaTest:0.001};
 if(s==='Particles/VertexLit Blended Billboard')return {...base,lit:'billboard',emission:rgbaOf(colors._EmisColor,[0.1,0.1,0.1,1]).slice(0,3),fog:'off'};
 if(s==='Transparent/Lit Colored')return {...base,lit:'forward',tint:rgbaOf(colors._Color,[1,1,1,1]),alphaTest:0};
 return {...base,tint:rgbaOf(colors._Color??material?.color,[1,1,1,1])};}

const VERT=`attribute vec4 pcolor;varying vec4 vColor;varying vec2 vUv;
#ifdef P_SOFT_PARTICLES
varying float vEyeDepth;
#endif
#include <fog_pars_vertex>
void main(){vUv=uv;vColor=pcolor;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;
#ifdef P_SOFT_PARTICLES
 vEyeDepth=-mvPosition.z;
#endif
#include <fog_vertex>
}`;
// Textures loaded as sRGB are sampled linear by the GPU; re-encode so the maths runs on the original gamma values. Fog is
// Unity's linear fixed-function fog, mixed after the program (fogColor is the gamma-space colour three uploads).
const FRAG=`uniform sampler2D map;varying vec4 vColor;varying vec2 vUv;
#ifdef P_SOFT_PARTICLES
uniform sampler2D softDepth;uniform float softOn;uniform vec2 softNearFar;uniform vec2 softInvScreen;uniform float invFade;varying float vEyeDepth;
#endif
#include <fog_pars_fragment>
vec3 pEncode(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-0.055,step(0.0031308,c));}
void main(){vec4 t=texture2D(map,vUv);
#ifdef P_SRGB_TEXTURE
 t.rgb=pEncode(t.rgb);
#endif
 vec4 vc=vColor;
#ifdef P_SOFT_PARTICLES
 if(softOn>0.5){float d=texture2D(softDepth,gl_FragCoord.xy*softInvScreen).r;
  float sceneZ=1.0/(d*(1.0-softNearFar.y/softNearFar.x)/softNearFar.y+1.0/softNearFar.x);
  float fade=clamp(invFade*(sceneZ-vEyeDepth),0.0,1.0);
  #ifdef P_PREMULTIPLY
  vc*=vec4(fade,fade,fade,fade*fade);
  #else
  vc.a*=fade;
  #endif
 }
#endif
 vec4 c=vc*t;
#ifdef P_MULTIPLY
 c=c.a*(c-1.0)+1.0;
#endif
#ifdef P_ALPHA_TEST
 if(!(c.a>P_ALPHA_TEST))discard;
#endif
#ifdef P_SOFT
 c.rgb*=c.a;
#endif
#ifdef USE_FOG
 #ifdef FOG_EXP2
 float pFog=1.0-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
 #else
 float pFog=clamp((vFogDepth-fogNear)/max(fogFar-fogNear,1e-5),0.0,1.0);
 #endif
 #if defined(P_FOG_BLACK)
 c.rgb=mix(c.rgb,vec3(0.0),pFog);
 #elif defined(P_FOG_WHITE)
 c.rgb=mix(c.rgb,vec3(1.0),pFog);
 #else
 c.rgb=mix(c.rgb,fogColor,pFog);
 #endif
#endif
 gl_FragColor=c;}`;
const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
const FACTORS={add:[THREE.SrcAlphaFactor,THREE.OneFactor],alpha:[THREE.SrcAlphaFactor,THREE.OneMinusSrcAlphaFactor],soft:[THREE.OneFactor,THREE.OneMinusSrcColorFactor],
 premultiply:[THREE.OneFactor,THREE.OneMinusSrcAlphaFactor],multiply:[THREE.ZeroFactor,THREE.SrcColorFactor]};
export function particleMaterial(shading,texture){const defines={};
 if(texture?.colorSpace===THREE.SRGBColorSpace)defines.P_SRGB_TEXTURE='';
 if(shading.soft){defines.P_SOFT_PARTICLES='';if(shading.blend==='premultiply')defines.P_PREMULTIPLY='';}
 if(shading.alphaTest!==null)defines.P_ALPHA_TEST=shading.alphaTest.toFixed(4);
 if(shading.blend==='multiply')defines.P_MULTIPLY='';if(shading.blend==='soft')defines.P_SOFT='';
 if(shading.fog==='black')defines.P_FOG_BLACK='';if(shading.fog==='white')defines.P_FOG_WHITE='';
 const [src,dst]=FACTORS[shading.blend];
 // ColorMask RGB: destination alpha is kept.
 return new THREE.ShaderMaterial({name:'Particles '+shading.shader,uniforms:{...THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{map:{value:null},invFade:{value:shading.invFade??1}}]),...(shading.soft?SOFT_PARTICLE_UNIFORMS:{})},vertexShader:VERT,fragmentShader:FRAG,defines,
  transparent:true,depthWrite:false,depthTest:shading.depthTest,side:THREE.DoubleSide,fog:shading.fog!=='off',blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,
  blendSrc:src,blendDst:dst,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor});}

// --- Vertex lighting ------------------------------------------------------------------------------------------------
// lighting: {ambient:[r,g,b], directional:[{direction (unit, towards the light, browser space), color:[r,g,b]}],
// points:[{position, color:[r,g,b], range}]} with Unity light colour * intensity. From three lights in this port's units.
export function particleLightingFrom({ambient=null,directional=[],points=[]}){
 const rgb=(c,k)=>[c.r*k,c.g*k,c.b*k];
 return {ambient:ambient?rgb(ambient.color,ambient.intensity):[0,0,0],
  directional:directional.filter(l=>l&&l.intensity>0).map(l=>({direction:l.position.clone().sub(l.target?.position??new THREE.Vector3()).normalize(),color:rgb(l.color,l.intensity)})),
  // PointLight intensity is m_Intensity * 6 in this port (legacy-materials LEGACY_POINT_LIGHT_SCALE).
  points:points.filter(l=>l&&l.intensity>0&&l.distance>0).map(l=>({position:l.position.clone(),color:rgb(l.color,l.intensity*LEGACY_POINT_LIGHT_SCALE),range:l.distance}))};}
// Particles/VertexLit Blended: Lighting On, ColorMaterial AmbientAndDiffuse, Emission _EmisColor (fixed function):
// emission + ambient * vcol + sum(vcol * light * atten * max(0, N.L)), point atten 1 / (1 + 25 d^2 / r^2); clamped.
// VertexLit Blended Billboard (its vertex program): emission + ambient + vcol * (ambient + sum(light / (1 + d^2 * atten.z))).
// Transparent/Lit Colored (ForwardBase/ForwardAdd Lambert): ambient (SH) + sum(2 * light * max(0, N.L) * atten), unclamped.
export function vertexLight(mode,{color,normal,position,emission=[0,0,0]},lighting){const out=[0,0,0],amb=lighting.ambient;
 const point=(l,ffp)=>{const d2=l.position.distanceToSquared(position),r2=l.range*l.range;return ffp?1/(1+25*d2/r2):lightAttenuation(d2/r2);};
 const toL=new THREE.Vector3();
 for(let i=0;i<3;i++)out[i]=mode==='ffp'?emission[i]+amb[i]*color[i]:mode==='billboard'?emission[i]+amb[i]+amb[i]*color[i]:amb[i];
 for(const l of lighting.directional){const k=mode==='billboard'?1:Math.max(0,normal.dot(l.direction))*(mode==='forward'?2:1);for(let i=0;i<3;i++)out[i]+=(mode==='forward'?1:color[i])*l.color[i]*k;}
 for(const l of lighting.points){if(l.position.distanceTo(position)>l.range&&mode!=='forward')continue;const a=point(l,mode!=='forward');if(!(a>0))continue;
  const k=mode==='billboard'?a:Math.max(0,normal.dot(toL.copy(l.position).sub(position).normalize()))*a*(mode==='forward'?2:1);for(let i=0;i<3;i++)out[i]+=(mode==='forward'?1:color[i])*l.color[i]*k;}
 return mode==='forward'?out:out.map(v=>Math.min(1,Math.max(0,v)));}

// Scene WindZone (ExternalForcesModule): directional zone along its forward axis, windMain times the pulse term. The engine's
// WindZone::ComputeWindForce is native (not in the managed sources); this is the same reconstruction legacy-materials.mjs
// windZoneForce uses for the trees: pulse = 1 + magnitude * (cos p + cos .375p + cos .05p) * .333, p = time * PI * frequency.
// wind: {direction (browser space), main, pulseMagnitude, pulseFrequency} or null.
export function windForce(wind,time){if(!wind)return 0;const p=time*Math.PI*(wind.pulseFrequency??0);
 return wind.main*(1+(Math.cos(p)+Math.cos(p*0.375)+Math.cos(p*0.05))*0.333*(wind.pulseMagnitude??0));}

const CORNERS=[[-1,-1],[1,-1],[1,1],[-1,1]];
export class ParticleEffect {
 // def: serialized ParticleSystem data; renderer: {data, material}; nodeMatrix: browser-space matrix of the emitter relative to its prefab root.
 // options: {meshRender:{geometry, material} for Mesh render mode, shapeMesh:{positions, normals, indices} (browser space) for Mesh shapes}.
 constructor(def,renderer,material,texture,nodeMatrix,rng=Math.random,options={}){
  this.def=def;this.rd=renderer.data;this.rng=rng;this.nodeMatrix=nodeMatrix;this.particles=[];this.emitAccumulator=0;this.time=0;
  // Gravity acts along world down (browser space) whatever the emitter orientation; owners simulating in another space may change it.
  this.id=null;this.subEmitters=null;this.isSubEmitter=false;this.down=new THREE.Vector3(0,-1,0);
  // Shared per-frame lighting ({ambient, directional, points}) for lit particle shaders; null draws them unlit. Wind: scene WindZone.
  this.lighting=null;this.wind=null;this.shapeMesh=options.shapeMesh??null;
  const im=def.InitialModule;this.max=Math.min(im.maxNumParticles,512);
  this.shading=particleShading(material?.shader,material);this.tint=this.shading.tint;
  this.geometry=new THREE.BufferGeometry();this.positions=new Float32Array(this.max*12);this.uvs=new Float32Array(this.max*8);this.colors=new Float32Array(this.max*16);
  const index=new Uint16Array(this.max*6);for(let i=0;i<this.max;i++)index.set([i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3],i*6);
  this.geometry.setIndex(new THREE.BufferAttribute(index,1));this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
  this.geometry.setAttribute('uv',new THREE.BufferAttribute(this.uvs,2).setUsage(THREE.DynamicDrawUsage));this.geometry.setAttribute('pcolor',new THREE.BufferAttribute(this.colors,4).setUsage(THREE.DynamicDrawUsage));
  this.material=particleMaterial(this.shading,texture);this.material.uniforms.map.value=texture??white;
  if(this.rd.m_RenderMode===4){
   // Mesh render mode: instances of the renderer's mesh with its own (opaque, lit) material.
   const mr=options.meshRender;this.meshMode=true;this.mesh=mr?new THREE.InstancedMesh(mr.geometry,mr.material,this.max):new THREE.Mesh(this.geometry,this.material);
   if(mr){this.mesh.count=0;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);}else this.geometry.setDrawRange(0,0);this.instanced=Boolean(mr);
  }else {this.mesh=new THREE.Mesh(this.geometry,this.material);this.geometry.setDrawRange(0,0);}
  this.mesh.frustumCulled=false;this.mesh.renderOrder=this.shading.front?11:10;if(this.shading.soft&&!this.instanced)this.mesh.onBeforeRender=markSoftDraw;
 }
 // Normalised system time for curve-valued start properties and emission rate.
 systemFraction(){const d=this.def,len=d.lengthInSec||1;return d.looping?(this.time%len)/len:Math.min(1,this.time/len);}
 // origin/root: a sub-emitter's spawn point (this system's local Unity space) and the parent particle's simulation root.
 emit(origin=null,root=null){const d=this.def,im=d.InitialModule,r=()=>this.rng();if(this.particles.length>=this.max)return;const ts=this.systemFraction();
  const p={age:0,life:Math.max(0.01,evalMinMax(im.startLifetime,ts,r())),size:evalMinMax(im.startSize,ts,r()),rot:evalMinMax(im.startRotation,ts,r()),color:evalMinMaxGradient(im.startColor,ts,r()),
   rand:[r(),r(),r(),r()],pos:new THREE.Vector3(),vel:new THREE.Vector3(),spin:0,emissionRoot:d.moveWithTransform===false?(root??this.emissionRoot)?.clone()??null:null};
  if(d.VelocityModule?.enabled)p.vrand=[r(),r(),r()];
  // ShapeModule.type: 0 Sphere, 1 SphereShell, 2 Hemisphere, 3 HemisphereShell, 4 Cone, 5 Box, 6 Mesh, 7 ConeShell, 8 ConeVolume, 9 ConeVolumeShell.
  const sh=d.ShapeModule,speed=evalMinMax(im.startSpeed,ts,r()),dir=new THREE.Vector3(0,0,1);
  if(sh.enabled&&(sh.type===4||sh.type>=7&&sh.type<=9)){let x,y;do{x=r()*2-1;y=r()*2-1;}while(x*x+y*y>1);if(sh.type===7||sh.type===9){const l=Math.hypot(x,y)||1;x/=l;y/=l;}
   const t=Math.tan(THREE.MathUtils.degToRad(sh.angle));dir.set(x*t,y*t,1).normalize();p.pos.set(x*sh.radius,y*sh.radius,0);
   // Volume shapes start anywhere along the cone's length, moving along the same direction.
   if(sh.type>=8)p.pos.addScaledVector(dir,(sh.length??0)*r());}
  else if(sh.enabled&&sh.type<=3){const v=randomUnit(r);if(sh.type>=2&&v.z<0)v.z=-v.z;p.pos.copy(v).multiplyScalar(sh.type%2?sh.radius:sh.radius*Math.cbrt(r()));dir.copy(v);}
  else if(sh.enabled&&sh.type===5)p.pos.set((r()-0.5)*sh.boxX,(r()-0.5)*sh.boxY,(r()-0.5)*sh.boxZ);
  else if(sh.enabled&&sh.type===6&&this.shapeMesh)this.meshPoint(sh.placementMode,p.pos,dir,r);
  // randomDirection replaces the shape's direction with a random unit vector (position unchanged).
  if(sh.enabled&&sh.randomDirection)dir.copy(randomUnit(r));
  p.vel.copy(dir).multiplyScalar(speed);
  const f=d.ForceModule;p.force=f?.enabled?new THREE.Vector3(evalMinMax(f.x,0,r()),evalMinMax(f.y,0,r()),evalMinMax(f.z,0,r())):null;
  if(origin)p.pos.add(origin);
  // InitialModule.inheritVelocity: world-space systems add the emitter's velocity times the factor.
  if(im.inheritVelocity&&p.emissionRoot&&this.emitterVelocity)p.vel.addScaledVector(new THREE.Vector3().copy(this.emitterVelocity).applyMatrix3(this.toLocal(p.emissionRoot)),im.inheritVelocity);
  this.particles.push(p);}
 // Mesh shape (placementMode 0 vertex, 1 edge, 2 triangle): a random vertex / point on a random triangle edge / point in a
 // random triangle, moving along the interpolated normal. The export is browser space; particles live in Unity space.
 meshPoint(mode,pos,dir,r){const m=this.shapeMesh,P=m.positions,N=m.normals,I=m.indices,tris=I?I.length/3:P.length/9;if(!tris)return;
  const vert=(i,o,src)=>o.set(src[i*3],src[i*3+1],-src[i*3+2]);const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),na=new THREE.Vector3(),nb=new THREE.Vector3(),nc=new THREE.Vector3();
  const tri=Math.min(tris-1,Math.floor(r()*tris)),ia=I?I[tri*3]:tri*3,ib=I?I[tri*3+1]:tri*3+1,ic=I?I[tri*3+2]:tri*3+2;
  vert(ia,a,P);vert(ib,b,P);vert(ic,c,P);if(N){vert(ia,na,N);vert(ib,nb,N);vert(ic,nc,N);}
  if(mode===0){pos.copy(a);dir.copy(N?na:dir);}
  else if(mode===1){const s=r();pos.lerpVectors(a,b,s);if(N)dir.lerpVectors(na,nb,s);}
  else {let u=r(),v=r();if(u+v>1){u=1-u;v=1-v;}pos.copy(a).addScaledVector(b.clone().sub(a),u).addScaledVector(c.clone().sub(a),v);if(N)dir.copy(na).multiplyScalar(1-u-v).addScaledVector(nb,u).addScaledVector(nc,v);}
  if(dir.lengthSq()>0)dir.normalize();else dir.set(0,0,1);}
 // Inverse linear part of a particle's local-to-browser frame: world-space vectors (gravity, world forces/velocities) into local space.
 toLocal(root){return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().multiplyMatrices(root,this.nodeMatrix).multiply(H)).invert();}
 // `emitting` mirrors FireBarrel's emitter.enableEmission; existing particles live out their lifetime.
 update(dt,emitting,rootMatrix,camera){const d=this.def,e=d.EmissionModule;dt*=d.speed??1;const before=this.time;this.emissionRoot=rootMatrix;this.time+=dt;
  // A non-looping system emits only during its first lengthInSec; sub-emitters only emit through their parent.
  const active=!this.isSubEmitter&&emitting&&e.enabled&&(d.looping||before<d.lengthInSec);
  // EmissionModule.m_Type: 0 rate per second, 1 rate per metre the emitter moves.
  const origin=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(rootMatrix,this.nodeMatrix)),moved=this.lastOrigin?origin.distanceTo(this.lastOrigin):0;
  this.emitterVelocity=this.lastOrigin&&dt>0?origin.clone().sub(this.lastOrigin).divideScalar(dt):new THREE.Vector3();this.lastOrigin=origin;
  if(active&&e.m_Type<=1){this.emitAccumulator+=evalMinMax(e.rate,this.systemFraction(),this.rng())*(e.m_Type===0?dt:moved);while(this.emitAccumulator>=1){this.emitAccumulator-=1;this.emit();}}
  else this.emitAccumulator=0;
  // Bursts fire when the system clock passes their time (each loop for looping systems).
  if(active)for(let i=0;i<(e.m_BurstCount??0);i++){const t=e['time'+i],a=d.looping?before%d.lengthInSec:before,b=a+dt;if((before===0&&t===0)||(t>a&&t<=b))for(let n=0;n<e['cnt'+i];n++)this.emit();}
  const gravity=d.InitialModule.gravityModifier*9.81,clamp=d.ClampVelocityModule,force=d.ForceModule,vm=d.VelocityModule,rbs=d.RotationBySpeedModule,rot=d.RotationModule,ext=d.ExternalForcesModule,r=()=>this.rng();
  const windAccel=ext?.enabled&&ext.multiplier&&this.wind?windForce(this.wind,this.time)*ext.multiplier:0;
  const needsFrame=gravity||windAccel||force?.enabled&&force.inWorldSpace||vm?.enabled&&vm.inWorldSpace;let rootLocal=null;const frame=p=>p.emissionRoot?(p.toLocal??=this.toLocal(p.emissionRoot)):(rootLocal??=this.toLocal(rootMatrix));
  const w=new THREE.Vector3(),anim=new THREE.Vector3(),subs=this.subEmitters;
  for(const p of this.particles){const age0=p.age;p.age+=dt;const t=Math.min(1,p.age/p.life),local=needsFrame?frame(p):null;
   if(p.force){if(force.randomizePerFrame)p.force.set(evalMinMax(force.x,t,r()),evalMinMax(force.y,t,r()),evalMinMax(force.z,t,r()));
    if(force.inWorldSpace)p.vel.addScaledVector(w.copy(p.force).applyMatrix3(local),dt);else p.vel.addScaledVector(p.force,dt);}
   // Gravity is a world-space acceleration (gravityModifier x Physics.gravity), expressed in the particle's local space.
   if(gravity)p.vel.addScaledVector(w.copy(this.down).applyMatrix3(local),gravity*dt);
   if(windAccel)p.vel.addScaledVector(w.copy(this.wind.direction).applyMatrix3(local),windAccel*dt);
   if(clamp?.enabled){const damp=clamp.dampen??1;
    if(!clamp.separateAxis&&clamp.magnitude){const lim=evalMinMax(clamp.magnitude,t,p.rand[0]),len=p.vel.length();if(len>lim)p.vel.multiplyScalar(THREE.MathUtils.lerp(len,lim,damp)/len);}
    else if(clamp.separateAxis)for(const [k,c] of [['x',clamp.x],['y',clamp.y],['z',clamp.z]]){const lim=Math.abs(evalMinMax(c,t,p.rand[0])),v=p.vel[k];if(Math.abs(v)>lim)p.vel[k]=Math.sign(v)*THREE.MathUtils.lerp(Math.abs(v),lim,damp);}}
   // VelocityModule (velocity over lifetime) adds an animated velocity that is not accumulated into the particle velocity.
   anim.set(0,0,0);if(vm?.enabled){anim.set(evalMinMax(vm.x,t,p.vrand[0]),evalMinMax(vm.y,t,p.vrand[1]),evalMinMax(vm.z,t,p.vrand[2]));if(vm.inWorldSpace)anim.applyMatrix3(local);}
   p.pos.addScaledVector(p.vel,dt).addScaledVector(anim,dt);p.speed=w.copy(p.vel).add(anim).length();p.drawVel=(p.drawVel??new THREE.Vector3()).copy(p.vel).add(anim);
   // Rotation over lifetime / by speed: angular velocities integrated over the frame.
   if(rot?.enabled)p.spin+=evalMinMax(rot.curve,t,p.rand[2])*dt;
   if(rbs?.enabled)p.spin+=evalMinMax(rbs.curve,speedFraction(p.speed,rbs.range),p.rand[2])*dt;
   if(subs)for(const [i,l] of subs.birth.entries())this.birthEmit(l,p,i,age0,rootMatrix);}
  if(subs?.death.length)for(const p of this.particles)if(p.age>=p.life)for(const l of subs.death){const em=l.effect.def.EmissionModule;if(!em.enabled)continue;let n=0;for(let i=0;i<(em.m_BurstCount??0);i++)n+=em['cnt'+i];this.subEmit(l,p,n,rootMatrix);}
  this.particles=this.particles.filter(p=>p.age<p.life);
  this.draw(rootMatrix,camera);}
 subEmit(link,p,count,rootMatrix){if(count<=0)return;const origin=p.pos.clone().applyMatrix4(link.toChild),root=p.emissionRoot??rootMatrix;for(let n=0;n<count;n++)link.effect.emit(origin,root);}
 // Birth sub-emitter clock = the parent particle's age (cycled when the child loops); rate and bursts as the child's own emission.
 birthEmit(link,p,index,age0,rootMatrix){const c=link.effect.def,em=c.EmissionModule;if(!em.enabled)return;const len=c.lengthInSec||1,st=(p.sub??=[])[index]??={acc:0};let n=0;
  if(em.m_Type===0&&(c.looping||age0<len)){st.acc+=evalMinMax(em.rate,(p.age%len)/len,this.rng())*(p.age-age0);n=Math.floor(st.acc);st.acc-=n;}
  for(let i=0;i<(em.m_BurstCount??0);i++){const bt=em['time'+i],a=c.looping?age0%len:age0,b=a+(p.age-age0);if((age0===0&&bt===0)||(bt>a&&bt<=b))n+=em['cnt'+i];}
  this.subEmit(link,p,n,rootMatrix);}
 // ParticleSystemRenderer.m_SortMode: 0 none, 1 by distance (far first), 2 oldest in front (drawn last), 3 youngest in front.
 drawOrder(worldOf,camera){const mode=this.rd.m_SortMode??0,list=this.particles;if(!mode||list.length<2)return list;
  if(mode===1){const keyed=list.map(p=>({p,d:worldOf(p).distanceToSquared(camera.position)}));keyed.sort((a,b)=>b.d-a.d);return keyed.map(k=>k.p);}
  return [...list].sort((a,b)=>mode===2?a.age-b.age:b.age-a.age);}
 draw(rootMatrix,camera){if(this.meshMode&&!this.instanced)return;const d=this.def,world=new THREE.Matrix4().multiplyMatrices(rootMatrix,this.nodeMatrix).multiply(H),lin=new THREE.Matrix3().setFromMatrix4(world);
  const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),view=new THREE.Vector3();
  const uv=d.UVModule,stretched=this.rd.m_RenderMode===1,mode=this.rd.m_RenderMode;const c=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),v=new THREE.Vector3();
  const sbs=d.SizeBySpeedModule,cbs=d.ColorBySpeedModule,forward=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,2).negate().normalize();
  const worldUp=new THREE.Vector3(0,1,0),facing=forward.clone().negate(),shade=this.shading,lit=shade.lit&&this.lighting,nd=this.rd.m_NormalDirection??1;
  // ParticleSystemRenderer.m_MaxParticleSize: largest on-screen size as a fraction of the viewport, so the world limit grows with view depth.
  const maxScreen=this.rd.m_MaxParticleSize,planeScale=camera.fov?2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*Math.max(1,camera.aspect??1):0;
  const worldCache=new Map(),particleWorld=p=>p.emissionRoot?(worldCache.get(p)??(worldCache.set(p,new THREE.Matrix4().multiplyMatrices(p.emissionRoot,this.nodeMatrix).multiply(H)),worldCache.get(p))):world;
  const order=this.drawOrder(p=>v.copy(p.pos).applyMatrix4(particleWorld(p)).clone(),camera);
  const inst=this.instanced?this.mesh:null,m4=new THREE.Matrix4(),q=new THREE.Quaternion(),s3=new THREE.Vector3(),zAxis=new THREE.Vector3(0,0,1),n0=new THREE.Vector3(),cornerN=new THREE.Vector3();
  let n=0;for(const p of order){const t=p.age/p.life;
   let size=p.size*(d.SizeModule.enabled?evalMinMax(d.SizeModule.curve,t,p.rand[1]):1);const rot=p.rot+(p.spin??0);
   if(sbs?.enabled)size*=evalMinMax(sbs.curve,speedFraction(p.speed??0,sbs.range),p.rand[1]);
   let col=p.color;if(d.ColorModule.enabled){const g=evalMinMaxGradient(d.ColorModule.gradient,t,p.rand[0]);col=col.map((x,i)=>x*g[i]);}
   if(cbs?.enabled){const g=evalMinMaxGradient(cbs.gradient,speedFraction(p.speed??0,cbs.range),p.rand[0]);col=col.map((x,i)=>x*g[i]);}
   const pw=particleWorld(p);c.copy(p.pos).applyMatrix4(pw);
   if(maxScreen>0&&planeScale){const depth=v.copy(c).sub(camera.position).dot(forward);if(depth>0)size=Math.min(size,maxScreen*planeScale*depth);}
   if(inst){// Mesh particles: the mesh (browser space) at the particle, scaled by size, rotated about the system's Z axis.
    q.setFromAxisAngle(zAxis,-rot);m4.compose(p.pos,q,s3.set(size,size,size));inst.setMatrixAt(n,new THREE.Matrix4().multiplyMatrices(pw,m4).multiply(H));if(++n>=this.max)break;continue;}
   const vel=p.drawVel??p.vel;
   if(stretched){v.copy(vel).applyMatrix3(p.emissionRoot?new THREE.Matrix3().setFromMatrix4(pw):lin);view.copy(c).sub(camera.position);const along=v.clone().normalize(),side=new THREE.Vector3().crossVectors(along,view).normalize();
    const len=(size*this.rd.m_LengthScale+v.length()*this.rd.m_VelocityScale)*0.5;a.copy(side).multiplyScalar(size*0.5);b.copy(along).multiplyScalar(len);}
   else {let ax=right,ay=up;
    // 2 horizontal billboard: flat on the world XZ plane; 3 vertical billboard: faces the camera about the world up axis.
    if(mode===2){ax=new THREE.Vector3(1,0,0);ay=new THREE.Vector3(0,0,-1);}
    else if(mode===3){ay=worldUp;ax=new THREE.Vector3().crossVectors(worldUp,view.copy(camera.position).sub(c)).normalize();if(!ax.lengthSq())ax=right;}
    const cs=Math.cos(rot),sn=Math.sin(rot);a.copy(ax).multiplyScalar(cs*size*0.5).addScaledVector(ay,sn*size*0.5);b.copy(ay).multiplyScalar(cs*size*0.5).addScaledVector(ax,-sn*size*0.5);}
   for(let k=0;k<4;k++){const [sx,sy]=CORNERS[k];this.positions.set([c.x+a.x*sx+b.x*sy,c.y+a.y*sx+b.y*sy,c.z+a.z*sx+b.z*sy],(n*4+k)*3);}
   // Texture sheet: frame = floor(frameOverTime(normalised age cycled) * tiles); single-row mode animates along one row.
   let u0=0,v0=0,du=1,dv=1;if(uv.enabled){const cyc=(t*uv.cycles)%1,rowMode=uv.animationType===1,tiles=rowMode?uv.tilesX:uv.tilesX*uv.tilesY;
    const frame=Math.min(tiles-1,Math.max(0,Math.floor(evalMinMax(uv.frameOverTime,cyc,p.rand[3])*tiles)));du=1/uv.tilesX;dv=1/uv.tilesY;
    const row=rowMode?(uv.randomRow?Math.floor(p.rand[0]*uv.tilesY):uv.rowIndex):Math.floor(frame/uv.tilesX);u0=(frame%uv.tilesX)*du;v0=1-(Math.min(uv.tilesY-1,row)+1)*dv;}
   this.uvs.set([u0,v0,u0+du,v0,u0+du,v0+dv,u0,v0+dv],n*8);
   const tint=this.tint;let rgba=[col[0]*tint[0],col[1]*tint[1],col[2]*tint[2],col[3]*tint[3]];
   // Premultiply: the program multiplies the whole colour by the vertex alpha.
   if(shade.blend==='premultiply')rgba=rgba.map(x=>x*col[3]);
   if(lit){// Vertex lighting at each corner; normals face the camera (m_NormalDirection 1) or bend outwards (0, spherical).
    for(let k=0;k<4;k++){const [sx,sy]=CORNERS[k];n0.copy(facing);if(nd<1){cornerN.copy(a).multiplyScalar(sx).addScaledVector(b,sy).normalize();n0.lerp(cornerN.add(facing).normalize(),1-nd).normalize();}
     const L=vertexLight(shade.lit,{color:col,normal:n0,position:v.set(this.positions[(n*4+k)*3],this.positions[(n*4+k)*3+1],this.positions[(n*4+k)*3+2]),emission:shade.emission},this.lighting);
     const out=shade.lit==='forward'?[rgba[0]*L[0],rgba[1]*L[1],rgba[2]*L[2],rgba[3]]:[L[0],L[1],L[2],rgba[3]];this.colors.set(out,(n*4+k)*4);}}
   else for(let k=0;k<4;k++)this.colors.set(rgba,(n*4+k)*4);
   if(++n>=this.max)break;}
  if(inst){inst.count=n;inst.instanceMatrix.needsUpdate=true;return;}
  this.geometry.setDrawRange(0,n*6);for(const name of ['position','uv','pcolor'])this.geometry.attributes[name].needsUpdate=true;}
 get finished(){return !this.def.looping&&this.time>this.def.lengthInSec&&!this.particles.length;}
 dispose(){this.geometry.dispose();this.material.dispose();}
}
// Rejection-sampled unit vector (bounded: a degenerate generator falls back to +Z).
function randomUnit(r){const v=new THREE.Vector3();for(let i=0;i<16;i++){v.set(r()*2-1,r()*2-1,r()*2-1);const l=v.lengthSq();if(l<=1&&l>1e-8)return v.normalize();}return v.set(0,0,1);}
