import * as THREE from 'three';
import {skyState,materialValues,fogColor,sampleAtmosphere,CloudAnimation,sunBasis,moonBasis,unityEuler,rotateVector} from './sky-model.mjs';

// Original TOD_Sky dome (Time of Day package as shipped in RustSky), ported from the compiled shader programs:
//  Space (Transparent-490): stars, uv = n.xz / (n.y + 1) * tiling, rgb - _Subtract (no blending)
//  Moon (-480): lit sphere, light = normalize(toCamera + 5 * (phase, -|phase|, -|phase|)), * 2(1-|phase|), ^_Contrast
//  Atmosphere (-470): per-vertex SampleAtmosphere, alpha blended
//  Sun (-460): quad, alpha texture * _Color * (1 + |0.25 sin(t/2)|) * 2, blended OneMinusDstColor/One
//  Cloud Layers (Bumped) (-450): two noise layers with DXT5nm normals, alpha blended
// The first four are composited in one draw on the original Icosphere (atmosphere/star UVs per vertex as in the
// original programs; the sun quad and moon sphere are intersected per pixel). Clouds draw the original Half_Icosphere
// with its own tangents. All maths runs in Unity's gamma space; outputs are decoded so three's sRGB output encoding
// writes the original gamma values (blending on the canvas therefore also happens in gamma space, as in Unity).
// Directions are Unity space; the meshes use a -1 Z scale to sit in the browser's reflected world.
const GAMMA_OUT=`
vec4 skyOut(vec3 c,float a){return vec4(sRGBTransferEOTF(vec4(clamp(c,0.0,1.0),1.0)).rgb,a);}`;

const domeVertex=`
uniform vec3 sunDir;uniform vec3 moonDir;uniform vec3 sunColor;uniform vec3 moonColor;uniform vec4 additiveColor;uniform vec3 cloudColor;uniform vec4 moonHaloColor;
uniform float contrast;uniform float haziness;uniform float horizon;uniform float fogginess;
uniform vec2 opticalDepth;uniform vec3 oneOverBeta;uniform vec3 betaRayleigh;uniform vec3 betaRayleighTheta;uniform vec3 betaMie;uniform vec3 betaMieTheta;uniform vec2 betaMiePhase;uniform vec3 betaNight;
uniform vec4 starST;
varying vec4 vAtmosphere;varying vec2 vStarUv;varying vec3 vDir;
void main(){
 vec3 n=normal;
 // Time of Day/Atmosphere vertex program.
 float h=pow(clamp(n.y+horizon,0.001,1.0),haziness),base=(1.0-h)*190000.0;
 float sr=base+h*(opticalDepth.x-base),sm=base+h*(opticalDepth.y-base);
 vec3 ext=betaRayleigh*sr+betaMie*sm;
 float mu=max(dot(-n,sunDir),0.0);
 vec3 theta=betaRayleighTheta+betaMieTheta/pow(betaMiePhase.x-betaMiePhase.y*mu,1.5);
 vec3 scatter=(1.0-exp(-ext))*(sunColor*(1.0+mu*mu)*theta*oneOverBeta+moonColor*betaNight);
 vec4 c=vec4(scatter,10.0*max(max(scatter.x,scatter.y),scatter.z));
 c+=moonHaloColor*pow(max(dot(-n,moonDir),0.0),10.0)+additiveColor;
 c.rgb=mix(c.rgb,cloudColor,fogginess);c.a+=fogginess;
 vAtmosphere=vec4(pow(max(c.rgb,0.0),vec3(contrast)),pow(clamp(c.a,0.0,1.0),contrast));
 // Time of Day/Space vertex program.
 vec3 q=normalize(position);vStarUv=q.xz/(q.y+1.0)*starST.xy+starST.zw;
 vDir=position;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

const domeFragment=`
uniform sampler2D stars;uniform sampler2D moonMap;uniform sampler2D sunMap;
uniform float starSubtract;uniform float spaceOn;
uniform float moonOn;uniform vec3 moonPos;uniform vec3 moonRight;uniform vec3 moonUp;uniform float moonScale;uniform vec4 moonMeshColor;uniform float moonPhase;uniform float moonContrast;
uniform float sunOn;uniform vec3 sunPos;uniform vec3 sunRight;uniform vec3 sunUp;uniform float sunScale;uniform vec4 sunMeshColor;uniform float sinTimeZ;
varying vec4 vAtmosphere;varying vec2 vStarUv;varying vec3 vDir;
${GAMMA_OUT}
void main(){
 vec3 d=normalize(vDir);
 vec3 c=spaceOn*clamp(texture2D(stars,vStarUv).rgb-starSubtract,0.0,1.0);
 if(moonOn>0.5){
  // Sphere (radius moonScale) at moonPos, seen from the dome centre.
  float tc=dot(d,moonPos),r2=moonScale*moonScale,dist2=1.0-tc*tc;
  if(tc>0.0&&dist2<r2){
   vec3 p=d*(tc-sqrt(r2-dist2)),nw=(p-moonPos)/moonScale,fw=-moonPos;
   vec3 no=vec3(dot(nw,moonRight),dot(nw,moonUp),dot(nw,fw));
   vec3 toCam=-p;vec3 tco=normalize(vec3(dot(toCam,moonRight),dot(toCam,moonUp),dot(toCam,fw)));
   float ap=abs(moonPhase);vec3 l=normalize(tco+5.0*vec3(moonPhase,-ap,-ap));
   vec2 uv=vec2(fract(0.25+atan(no.z,no.x)/6.2831853),0.5+asin(clamp(no.y,-1.0,1.0))/3.1415927);
   vec3 m=textureLod(moonMap,uv,0.0).rgb*(max(dot(no,l),0.0)*2.0*(1.0-ap))*moonMeshColor.rgb;
   c=pow(max(m,0.0),vec3(moonContrast));
  }
 }
 c=clamp(mix(c,vAtmosphere.rgb,vAtmosphere.a),0.0,1.0);
 if(sunOn>0.5){
  float k=dot(d,sunPos);
  if(k>0.0){
   vec3 local=d/k-sunPos;float x=dot(local,sunRight)/sunScale,y=dot(local,sunUp)/sunScale;
   if(abs(x)<=1.0&&abs(y)<=1.0){
    float a=textureLod(sunMap,vec2((1.0-x)*0.5,(1.0+y)*0.5),0.0).r;
    vec3 s=a*sunMeshColor.a*sunMeshColor.rgb*(abs(0.25*sinTimeZ)+1.0)*2.0;
    c=clamp(s*(1.0-c)+c,0.0,1.0);
   }
  }
 }
 gl_FragColor=skyOut(c,1.0);
 #include <colorspace_fragment>
}`;

const cloudVertex=`
attribute vec4 tangent;
uniform float oneOverGamma;uniform vec3 cloudColor;uniform vec3 sunDir;uniform vec3 moonDir;uniform vec3 lightDir;
uniform float sunGlow;uniform float moonGlow;uniform float cloudDensity;uniform vec2 cloudScale1;uniform vec2 cloudScale2;uniform vec4 cloudUV;
varying vec4 vUv;varying vec3 vLight;varying vec3 vShade;varying vec3 vColor;
void main(){
 // Time of Day/Cloud Layers (Bumped) vertex program.
 vec3 n=normalize(position);float w=1.0/pow(n.y+0.1,0.75);
 vUv=vec4((n.xz*w+cloudUV.xy)/cloudScale1,(n.xz*w+cloudUV.zw)/cloudScale2);
 vec3 binormal=cross(normal,tangent.xyz)*tangent.w;
 vLight=vec3(dot(tangent.xyz,-lightDir),dot(binormal,-lightDir),dot(normal,-lightDir));
 float glow=max(dot(normal,-sunDir),0.0)*sunGlow+max(dot(normal,-moonDir),0.0)*moonGlow;
 vShade=vec3(clamp(n.y*n.y*100.0,0.0,1.0)*cloudDensity,pow(glow,10.0)*oneOverGamma*0.5,0.5*oneOverGamma);
 vColor=pow(max(cloudColor,0.0),vec3(oneOverGamma));
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`;

const cloudFragment=`
uniform sampler2D noise1;uniform sampler2D noise2;uniform sampler2D normals1;uniform sampler2D normals2;uniform float cloudSharpness;
varying vec4 vUv;varying vec3 vLight;varying vec3 vShade;varying vec3 vColor;
${GAMMA_OUT}
void main(){
 // Normal maps were exported as R = DXT5nm x (alpha), G = y; noise masks as R = alpha.
 vec2 a=texture2D(normals1,vUv.xy).rg,b=texture2D(normals2,vUv.zw).rg;
 vec3 nrm=vec3(a.x+b.x-1.0,a.y+b.y-1.0,0.0);nrm.z=sqrt(1.0-clamp(dot(nrm.xy,nrm.xy),0.0,1.0));
 float density=pow(texture2D(noise1,vUv.xy).r*texture2D(noise2,vUv.zw).r,cloudSharpness)*vShade.x;
 float shade=pow((dot(nrm,vLight)+1.0)*0.5,vShade.z)+0.099975586;
 float extinction=1.0/pow(2.71875,density*0.19995117)+0.099975586;
 vec3 c=(vColor+clamp(1.5-density,0.0,1.0)*vShade.y)*shade*extinction;
 gl_FragColor=skyOut(c,clamp(density,0.0,1.0));
 #include <colorspace_fragment>
}`;

const v3=a=>new THREE.Vector3(a[0],a[1],a[2]);

// moon: render-extras.json moon (RustSky/Moon serialized rotation), the starting point of the moon's LookAt roll.
export async function createSky({base='/assets/recovered/sky/',renderer,moon=null}={}){
 const r=await fetch(base+'manifest.json');if(!r.ok)throw Error('Sky export missing; run tools/export_sky.py');
 const manifest=await r.json(),loader=new THREE.TextureLoader();
 async function buffer(desc,Type){const res=await fetch(base+desc.file);if(!res.ok)throw Error('Missing sky mesh '+desc.file);const a=new Type(await res.arrayBuffer());if(a.length!==desc.count)throw Error('Invalid sky mesh '+desc.file);return a;}
 async function geometry(m,tangents){const g=new THREE.BufferGeometry();const [p,n,t,i]=await Promise.all([buffer(m.position,Float32Array),buffer(m.normal,Float32Array),tangents?buffer(m.tangent,Float32Array):null,buffer(m.index,Uint32Array)]);
  g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('normal',new THREE.BufferAttribute(n,3));if(t)g.setAttribute('tangent',new THREE.BufferAttribute(t,4));g.setIndex(new THREE.BufferAttribute(i,1));return g;}
 async function texture(slot,repeat){const t=await loader.loadAsync(base+slot.file);t.colorSpace=THREE.NoColorSpace;t.wrapS=t.wrapT=repeat?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
  t.anisotropy=Math.min(4,renderer?.capabilities.getMaxAnisotropy()??1);return t;}
 const mats=manifest.materials,stars=manifest.tod.Stars,radius=manifest.camera.todCamera.DomeScaleFactor*manifest.camera.far;
 const [domeGeometry,cloudGeometry,starMap,moonMap,sunMap,noise1,noise2,normals1,normals2]=await Promise.all([
  geometry(manifest.meshes.icosphere,false),geometry(manifest.meshes.halfIcosphere,true),
  texture(mats.space.textures._MainTex,true),texture(mats.moon.textures._MainTex,false),texture(mats.sun.textures._MainTex,false),
  texture(mats.clouds.textures._NoiseTexture1,true),texture(mats.clouds.textures._NoiseTexture2,true),texture(mats.clouds.textures._NoiseNormals1,true),texture(mats.clouds.textures._NoiseNormals2,true)]);
 const u=(value)=>({value});
 const shared={sunDir:u(new THREE.Vector3()),moonDir:u(new THREE.Vector3()),cloudColor:u(new THREE.Vector3())};
 const domeUniforms={...shared,sunColor:u(new THREE.Vector3()),moonColor:u(new THREE.Vector3()),additiveColor:u(new THREE.Vector4()),moonHaloColor:u(new THREE.Vector4()),
  contrast:u(1),haziness:u(0.5),horizon:u(0),fogginess:u(0),opticalDepth:u(new THREE.Vector2()),oneOverBeta:u(new THREE.Vector3()),betaRayleigh:u(new THREE.Vector3()),betaRayleighTheta:u(new THREE.Vector3()),
  betaMie:u(new THREE.Vector3()),betaMieTheta:u(new THREE.Vector3()),betaMiePhase:u(new THREE.Vector2()),betaNight:u(new THREE.Vector3()),
  starST:u(new THREE.Vector4(stars.Tiling,stars.Tiling,mats.space.textures._MainTex.offset.x,mats.space.textures._MainTex.offset.y)),stars:u(starMap),starSubtract:u(1-Math.pow(stars.Density,0.1)),spaceOn:u(1),
  moonMap:u(moonMap),moonOn:u(0),moonPos:u(new THREE.Vector3()),moonRight:u(new THREE.Vector3()),moonUp:u(new THREE.Vector3()),moonScale:u(0.07),moonMeshColor:u(new THREE.Vector4()),moonPhase:u(0),moonContrast:u(mats.moon.floats._Contrast??0.75),
  sunMap:u(sunMap),sunOn:u(0),sunPos:u(new THREE.Vector3()),sunRight:u(new THREE.Vector3()),sunUp:u(new THREE.Vector3()),sunScale:u(0.14),sunMeshColor:u(new THREE.Vector4()),sinTimeZ:u(0)};
 const cloudUniforms={...shared,oneOverGamma:u(1/manifest.gamma),lightDir:u(new THREE.Vector3()),sunGlow:u(0),moonGlow:u(0),cloudDensity:u(0),cloudSharpness:u(1),cloudScale1:u(new THREE.Vector2(3,3)),cloudScale2:u(new THREE.Vector2(7,7)),
  cloudUV:u(new THREE.Vector4()),noise1:u(noise1),noise2:u(noise2),normals1:u(normals1),normals2:u(normals2)};
 // Both render after opaque geometry (the original queues are Transparent-490..-450, before the sea at -200) without
 // writing depth, at the TOD_Camera radius (0.95 * the original 6000 m far clip), so terrain beyond it is covered.
 const domeMaterial=new THREE.ShaderMaterial({name:'TOD Sky (Space/Moon/Atmosphere/Sun)',uniforms:domeUniforms,vertexShader:domeVertex,fragmentShader:domeFragment,side:THREE.DoubleSide,depthWrite:false,transparent:true,blending:THREE.NoBlending,fog:false});
 const cloudMaterial=new THREE.ShaderMaterial({name:'TOD Cloud Layers (Bumped)',uniforms:cloudUniforms,vertexShader:cloudVertex,fragmentShader:cloudFragment,side:THREE.DoubleSide,depthWrite:false,transparent:true,blending:THREE.NormalBlending,fog:false});
 const dome=new THREE.Mesh(domeGeometry,domeMaterial),clouds=new THREE.Mesh(cloudGeometry,cloudMaterial),group=new THREE.Group();
 dome.name='TOD Sky dome';clouds.name='TOD Clouds';group.name='Original sky (TOD_Sky)';
 for(const m of [dome,clouds]){m.frustumCulled=false;m.scale.set(radius,radius,-radius);group.add(m);}
 dome.renderOrder=-490;clouds.renderOrder=-450;
 const animation=new CloudAnimation(manifest.animation,manifest.tod.Clouds);
 const q=new THREE.Quaternion(),fwd=new THREE.Vector3(),camPos=new THREE.Vector3();
 let state=null,values=null,fog=[1,1,1,1],time=0;
 const r0=moon?.localRotation;let moonUp=r0?rotateVector([r0.x,r0.y,r0.z,r0.w],[0,1,0]):[0,1,0],moonFrame=null;
 // Advances the original per-frame values for this camera and time of day. dt in seconds.
 function update(camera,tod,dt=0){
  time+=dt;camera.getWorldPosition(camPos);camera.getWorldQuaternion(q);camera.getWorldDirection(fwd);
  for(const m of [dome,clouds]){m.position.copy(camPos);m.updateMatrix();}
  const params={...tod.p,Stars:stars};
  state=skyState(tod,params);values=materialValues(state,{gamma:manifest.gamma,stars});
  const forwardU=[fwd.x,fwd.y,-fwd.z];fog=fogColor(forwardU,state);
  const d=domeUniforms,c=cloudUniforms;
  shared.sunDir.value.set(...state.sunDirection);shared.moonDir.value.set(...state.moonDirection);shared.cloudColor.value.set(...state.cloudColor.slice(0,3));
  d.sunColor.value.set(...state.sunColor.slice(0,3));d.moonColor.value.set(...state.moonColor.slice(0,3));d.additiveColor.value.set(...state.additiveColor);d.moonHaloColor.value.set(...state.moonHaloColor);
  d.contrast.value=values.contrast;d.haziness.value=values.haziness;d.horizon.value=values.horizon;d.fogginess.value=values.fogginess;
  const s=state.scattering;d.opticalDepth.value.set(...s.opticalDepth);d.oneOverBeta.value.set(...s.oneOverBeta);d.betaRayleigh.value.set(...s.betaRayleigh);d.betaRayleighTheta.value.set(...s.betaRayleighTheta);
  d.betaMie.value.set(...s.betaMie);d.betaMieTheta.value.set(...s.betaMieTheta);d.betaMiePhase.value.set(...s.betaMiePhase);d.betaNight.value.set(...s.betaNight);
  d.spaceOn.value=state.spaceVisible?1:0;d.starSubtract.value=values.starSubtract;
  d.moonOn.value=state.moonVisible?1:0;d.moonPos.value.set(...state.moonPos);const mb=moonBasis(state.moonPos,moonUp,moonFrame);moonUp=mb.up;moonFrame=mb;d.moonRight.value.set(...mb.right);d.moonUp.value.set(...mb.up);
  d.moonScale.value=values.moonScale;d.moonMeshColor.value.set(...values.moonColor);d.moonPhase.value=values.moonPhase;
  // Sun roll: 2 * Time.time + |camera euler x| + |y| + |z| (Unity degrees; browser quaternion mirrored to Unity).
  const euler=unityEuler([-q.x,-q.y,q.z,q.w]),roll=2*time+Math.abs(euler[0])+Math.abs(euler[1])+Math.abs(euler[2]),sb=sunBasis(state.sunPos,roll);
  d.sunOn.value=state.sunVisible?1:0;d.sunPos.value.set(...state.sunPos);d.sunRight.value.set(...sb.right);d.sunUp.value.set(...sb.up);d.sunScale.value=values.sunScale;d.sunMeshColor.value.set(...values.sunColor);
  d.sinTimeZ.value=Math.sin(time/2);
  c.lightDir.value.set(...state.lightDirection);c.sunGlow.value=values.sunGlow;c.moonGlow.value=values.moonGlow;c.cloudDensity.value=values.cloudDensity;c.cloudSharpness.value=values.cloudSharpness;
  c.cloudScale1.value.set(...values.cloudScale1);c.cloudScale2.value.set(...values.cloudScale2);
  const uv=animation.update(dt),off=CloudAnimation.offset([camPos.x,camPos.y,-camPos.z],radius);c.cloudUV.value.set(uv[0]+off[0],uv[1]+off[1],uv[2]+off[2],uv[3]+off[3]);
  clouds.visible=state.cloudsVisible;
  return state;
 }
 // RenderSettings fog (mode, start, end) from the client scene; colour = TOD_Sky.SampleFogColor (gamma space).
 const rs=manifest.renderSettings;
 const fogSettings={enabled:rs.fog,mode:rs.fogMode,start:rs.linearFogStart,end:rs.linearFogEnd,density:rs.fogDensity};
 return {group,dome,clouds,manifest,radius,fogSettings,update,
  get state(){return state;},get values(){return values;},get fogColor(){return fog;},
  // Applies the TOD fog colour to a three.js Fog (linear working space) and background.
  applyFog(scene){if(!scene.fog||!scene.fog.isFog)scene.fog=new THREE.Fog(0xffffff,fogSettings.start,fogSettings.end);scene.fog.near=fogSettings.start;scene.fog.far=fogSettings.end;
   scene.fog.color.setRGB(fog[0],fog[1],fog[2],THREE.SRGBColorSpace);if(scene.background?.isColor)scene.background.copy(scene.fog.color);},
  // TOD_Sky.SampleAtmosphere for a Unity-space direction with the current state (gamma RGBA), for checks.
  sample:dir=>state&&sampleAtmosphere(dir,state),
  // EnvironmentControlCenter.CL_UpdateSkyState sets TOD_Animation.CloudUV; the wind keeps moving it from there.
  setCloudUV(uv){animation.uv=[...uv];},
  debug:()=>state&&({lerp:state.lerpValue,sun:state.sunPos,moon:state.moonPos,moonUp:[...moonUp],moonRollSource:r0?'RustSky/Moon':'world up',sunVisible:state.sunVisible,moonVisible:state.moonVisible,spaceVisible:state.spaceVisible,fog,cloudUV:cloudUniforms.cloudUV.value.toArray(),
   sunColor:state.sunColor,cloudColor:state.cloudColor,ambient:state.ambientColor,fogSettings,radius})};
}
