import * as THREE from 'three';
import {waterColors} from './sky-model.mjs';
import {blitRenderTarget} from './post-chain.mjs';

// Original sea: RustWater (WaterBase + PlanarReflection + WaterColor + SpecularLighting) with the 'Tile' kraut_plane
// (51 x 51 vertices, 1 km apart, 50 km wide at 252.4 m) and the Water4Example material (FX/Water4). Ported from the
// compiled LOD 500 GLSL program, keywords WATER_VERTEX_DISPLACEMENT_ON (no Displace component sets a keyword, so the
// first multi_compile variant is used), WATER_EDGEBLEND_ON (WaterBase.edgeBlend at High quality) and WATER_REFLECTIVE
// (PlanarReflection enables it). Values come from the exported material; _BaseColor/_ReflectionColor follow WaterColor.
//
// Refraction and depth (LOD 500 / WATER_EDGEBLEND_ON): GrabPass {"_RefractionTex"} copies the HDR camera image when the
// sea draws (queue Transparent-200: after opaque geometry and the sky). The port does the same: while the world renders
// into the post chain's HDR camera image (browser/post-chain.mjs requestTarget), the sea's onBeforeRender blits its colour
// and depth into a grab target; refraction samples it at the bump-distorted position (N.xz * _DistortParams.y * 10 / w),
// falling back to the undistorted point when the scene there is nearer than the water (edge-blend variant only), and the
// edge blend reads the real scene depth (LinearEyeDepth - water eye depth) as _CameraDepthTexture did. The LOD 500
// edge-blend-off variant outputs alpha 1 and never depth-tests the distortion, as the compiled program does.
// Without an offscreen camera image (no post chain) the earlier exact-but-undistorted form remains: premultiplied
// blending with the framebuffer (refraction enters linearly) and the terrain-height edge estimate.
// Reflection: PlanarReflection renders at half resolution through an oblique clip plane 0.07 m above the water with a
// helper camera created at runtime: Forward path, hdr off, default ARGB32 RenderTexture, so the reflection is LDR (clamped
// to 0..1 here) while the rest of the frame stays HDR. With 'water.reflection' off (default) its mask holds only the
// Skybox layer (sky dome and clouds); on, it adds CULL500, Terrain (with the terrain trees) and MeshBatched
// (WaterSettings); the helper camera has no layer cull distances, so CULL500 objects beyond the main camera's distance
// are reflected (setReflectionHooks lets the main camera's layer culling step aside for that pass).
export const REFLECT_LAYER=30;
const vertexShader=`
uniform float time;uniform float gerstnerIntensity;uniform vec4 bumpTiling;uniform vec4 bumpDirection;
uniform vec4 gAmplitude;uniform vec4 gFrequency;uniform vec4 gSteepness;uniform vec4 gSpeed;uniform vec4 gDirectionAB;uniform vec4 gDirectionCD;
uniform mat4 reflectionMatrix;uniform vec3 cameraU;uniform float quality;
varying vec4 vNormal;varying vec4 vView;varying vec4 vBump;varying vec4 vReflect;varying vec3 vWorldU;varying float vEyeDepth;varying float vClipZ;
void main(){
 vec3 wb=(modelMatrix*vec4(position,1.0)).xyz,wu=vec3(wb.x,wb.y,-wb.z);vec2 xz=wu.xz;
 // FX/Water4 GerstnerOffset4 / GerstnerNormal4 (Unity world space).
 vec4 t7=gSteepness.xxyy*gAmplitude.xxyy*gDirectionAB,t8=gSteepness.zzww*gAmplitude.zzww*gDirectionCD;
 vec4 ph=gFrequency*vec4(dot(gDirectionAB.xy,xz),dot(gDirectionAB.zw,xz),dot(gDirectionCD.xy,xz),dot(gDirectionCD.zw,xz))+time*gSpeed;
 vec4 c=cos(ph);vec3 offsets=vec3(dot(c,vec4(t7.xz,t8.xz)),dot(sin(ph),gAmplitude),dot(c,vec4(t7.yw,t8.yw)));
 if(quality<0.5)offsets=vec3(0.0); // LOD 200 has no Gerstner displacement
 vec2 v=xz+offsets.xz;vec4 a=gFrequency.xxyy*gAmplitude.xxyy*gDirectionAB,b=gFrequency.zzww*gAmplitude.zzww*gDirectionCD;
 vec4 c2=cos(gFrequency*vec4(dot(gDirectionAB.xy,v),dot(gDirectionAB.zw,v),dot(gDirectionCD.xy,v),dot(gDirectionCD.zw,v))+time*gSpeed);
 vec3 nrml=vec3(-dot(c2,vec4(a.xz,b.xz)),2.0,-dot(c2,vec4(a.yw,b.yw)));nrml.xz*=gerstnerIntensity;
 vNormal=vec4(normalize(nrml),1.0);
 vec3 du=wu+offsets;vec3 db=vec3(du.x,du.y,-du.z);
 vView=vec4(wu-cameraU,clamp(offsets.y,0.0,1.0));
 vBump=(du.xzxz+time/20.0*bumpDirection)*bumpTiling;
 vReflect=reflectionMatrix*vec4(db,1.0);vWorldU=du;
 vec4 mv=viewMatrix*vec4(db,1.0);vEyeDepth=-mv.z;
 gl_Position=projectionMatrix*mv;vClipZ=gl_Position.z;
}`;
const fragmentShader=`
uniform sampler2D bumpMap;uniform sampler2D shoreTex;uniform sampler2D reflectionTex;
uniform vec4 specularColor;uniform vec4 baseColor;uniform vec4 reflectionColor;uniform vec4 invFadeParemeter;uniform float shininess;uniform vec4 worldLightDir;
uniform vec4 distortParams;uniform float fresnelScale;uniform vec4 foam;uniform vec3 cameraForwardU;uniform float edgeBlend;uniform float quality;
uniform highp sampler2D terrainHeights;uniform vec4 terrain;uniform float waterHeight;
uniform vec3 fogColor;uniform vec2 fogRange;uniform float farClip;
uniform sampler2D grabTex;uniform highp sampler2D grabDepth;uniform float grabOn;uniform vec2 invScreen;uniform vec2 depthParams;
varying vec4 vNormal;varying vec4 vView;varying vec4 vBump;varying vec4 vReflect;varying vec3 vWorldU;varying float vEyeDepth;varying float vClipZ;
float linearEye(float d){return depthParams.x*depthParams.y/(depthParams.y-d*(depthParams.y-depthParams.x));} // LinearEyeDepth
float terrainAt(vec2 p){ // bilinear original height at a browser-space xz point; terrain = (originX, originZ, cell, cells)
 vec2 g=vec2((p.x-terrain.x)/terrain.z,(terrain.y-p.y)/terrain.z);
 if(g.x<0.0||g.y<0.0||g.x>terrain.w||g.y>terrain.w)return -1e5;
 ivec2 i=ivec2(floor(g));vec2 f=fract(g);int n=int(terrain.w);ivec2 j=min(i+1,ivec2(n));
 float h00=texelFetch(terrainHeights,i,0).r,h10=texelFetch(terrainHeights,ivec2(j.x,i.y),0).r,h01=texelFetch(terrainHeights,ivec2(i.x,j.y),0).r,h11=texelFetch(terrainHeights,j,0).r;
 return mix(mix(h00,h10,f.x),mix(h01,h11,f.x),f.y);}
vec3 toGamma(vec3 c){return sRGBTransferOETF(vec4(max(c,0.0),1.0)).rgb;}
void main(){
 if(vEyeDepth>farClip)discard; // the original camera's far clip plane
 vec4 bm=texture2D(bumpMap,vBump.xy)+texture2D(bumpMap,vBump.zw); // R = DXT5nm x (alpha), G = y
 vec2 bump=bm.rg-1.0;
 vec3 N=normalize(vNormal.xyz+vec3(bump.x,0.0,bump.y)*distortParams.x);
 vec3 V=normalize(vView.xyz);
 vec2 offset=N.xz*distortParams.y*10.0;
 // The helper camera's ARGB32 target is LDR; the reflection target stores gamma values (sRGB output stage).
 vec3 refl=clamp(texture2D(reflectionTex,(vReflect.xy+offset)/vReflect.w).rgb,0.0,1.0);
 // Scene depth behind the water (eye depth difference): _CameraDepthTexture from the grab, else the terrain under this point.
 float delta=1e4;vec2 uv0=gl_FragCoord.xy*invScreen;
 if(grabOn>0.5){if(edgeBlend>0.5)delta=linearEye(texture2D(grabDepth,uv0).r)-vEyeDepth;}
 else if(edgeBlend>0.5&&V.y<-1e-4){float bed=terrainAt(vec2(vWorldU.x,-vWorldU.z)),dh=waterHeight-bed;delta=dh<=0.0?0.0:dh/(-V.y)*dot(V,cameraForwardU);}
 vec4 edge=edgeBlend>0.5?clamp(invFadeParemeter*delta,0.0,1.0):vec4(1.0,1.0,1.0,1.0);edge.y=1.0-edge.y;
 vec3 Nf=N;Nf.xz*=fresnelScale;
 vec4 base=baseColor-(vView.w*invFadeParemeter.w)*vec4(0.15,0.03,0.01,0.0);
 float F=clamp(distortParams.w+(1.0-distortParams.w)*pow(clamp(1.0-max(dot(-V,Nf),0.0),0.0,1.0),distortParams.z),0.0,1.0);
 vec3 R=mix(refl,reflectionColor.rgb,reflectionColor.a);
 vec3 spec=max(0.0,pow(max(0.0,dot(N,-normalize(worldLightDir.xyz+V))),shininess))*specularColor.rgb;
 vec4 coords=vBump*2.0;
 vec3 foamC=((texture2D(shoreTex,coords.xy)*texture2D(shoreTex,coords.zw)).rgb-0.125)*foam.x*(edge.y+clamp(vView.w-foam.y,0.0,1.0));
 // colour = refraction*K + X, fog as Unity's (gamma). Refraction: the grab at the distorted point, or (no grab) the
 // framebuffer behind through premultiplied blending.
 vec3 X=base.rgb*base.a*(1.0-F)+R*F+spec+foamC;float K=(1.0-base.a)*(1.0-F);
 float fogF=clamp((fogRange.y-vEyeDepth)/(fogRange.y-fogRange.x),0.0,1.0),e=edge.x;
 vec3 refr=vec3(0.0);
 if(grabOn>0.5&&quality>1.5){vec2 uvD=uv0+offset/vEyeDepth; // texture2DProj(grabPassPos + offset): offset / clip w
  if(edgeBlend>0.5&&linearEye(texture2D(grabDepth,uvD).r)<vClipZ)uvD=uv0;
  refr=texture2D(grabTex,uvD).rgb;}
 if(quality<1.5){
  // LOD 300 (Medium, WATER_EDGEBLEND_OFF) / LOD 200 (Low): no refraction; alpha-blended base/reflection fresnel mix.
  vec3 RC=quality<0.5?reflectionColor.rgb:R;X=mix(baseColor.rgb,RC,clamp(F*2.0,0.0,1.0))+spec;K=0.0;
  e=quality<0.5?clamp(F*2.0+0.5,0.0,1.0):clamp(0.5+F,0.0,1.0)*(edgeBlend>0.5?edge.x:1.0);
 }
 vec3 src;float alpha;
 if(grabOn>0.5){if(quality>1.5)X+=refr*K;src=fogF*X+(1.0-fogF)*fogColor;alpha=e;} // Blend SrcAlpha OneMinusSrcAlpha, HDR
 else{src=e*(fogF*X+(1.0-fogF)*fogColor);alpha=e*(1.0-fogF*K);src=min(src,vec3(1.0));}
 gl_FragColor=vec4(sRGBTransferEOTF(vec4(max(src,vec3(0.0)),1.0)).rgb,alpha);
 #include <colorspace_fragment>
}`;

const col=c=>new THREE.Vector4(c.r,c.g,c.b,c.a);
export async function createWater4({base='/assets/recovered/sky/',manifest,bounds,renderer,sky,terrain,reflections=false}){
 const w=manifest.water,m=w.material,loader=new THREE.TextureLoader();
 async function texture(slot){const t=await loader.loadAsync(base+slot.file);t.colorSpace=THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,renderer?.capabilities.getMaxAnisotropy()??1);return t;}
 const [bumpMap,shoreTex]=await Promise.all([texture(m.textures._BumpMap),texture(m.textures._ShoreTex)]);
 const [lo,hi]=bounds,height=lo[1],grid=w.tile?Math.min(w.tile.gridX,w.tile.gridZ)-1:50;
 const geometry=new THREE.PlaneGeometry(hi[0]-lo[0],hi[2]-lo[2],grid,grid).rotateX(-Math.PI/2);
 const f=m.floats,c=m.colors,u=value=>({value});
 // The reflection target is stored like the camera image (sRGB output stage, so the stored values are the original gamma
 // values and the reflection pass shares the world's programs); the shader clamps it as the helper camera's ARGB32 did.
 const floatOk=Boolean(renderer?.extensions.has('EXT_color_buffer_float')||renderer?.extensions.has('EXT_color_buffer_half_float'));
 const reflectionTarget=new THREE.WebGLRenderTarget(2,2,{type:floatOk?THREE.HalfFloatType:THREE.UnsignedByteType,depthBuffer:true});reflectionTarget.texture.name='PlanarReflection _ReflectionTex';
 reflectionTarget.isXRRenderTarget=true;reflectionTarget.texture.colorSpace=THREE.SRGBColorSpace; // XR flag: RGBA8/16F storage, sRGB output stage
 // GrabPass _RefractionTex + _CameraDepthTexture: copies of the HDR camera image taken as the sea starts drawing.
 const grabTarget=new THREE.WebGLRenderTarget(2,2,{type:THREE.HalfFloatType,depthBuffer:true,depthTexture:new THREE.DepthTexture(2,2,THREE.UnsignedIntType),minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false});
 grabTarget.texture.name='Water4 GrabPass _RefractionTex';grabTarget.texture.colorSpace=THREE.NoColorSpace;
 const uniforms={time:u(0),quality:u(w.waterBase.waterQuality),gerstnerIntensity:u(f._GerstnerIntensity),bumpTiling:u(col(c._BumpTiling)),bumpDirection:u(col(c._BumpDirection)),
  gAmplitude:u(col(c._GAmplitude)),gFrequency:u(col(c._GFrequency)),gSteepness:u(col(c._GSteepness)),gSpeed:u(col(c._GSpeed)),gDirectionAB:u(col(c._GDirectionAB)),gDirectionCD:u(col(c._GDirectionCD)),
  reflectionMatrix:u(new THREE.Matrix4()),cameraU:u(new THREE.Vector3()),cameraForwardU:u(new THREE.Vector3(0,0,1)),
  bumpMap:u(bumpMap),shoreTex:u(shoreTex),reflectionTex:u(reflectionTarget.texture),
  specularColor:u(col(c._SpecularColor)),baseColor:u(col(c._BaseColor)),reflectionColor:u(col(c._ReflectionColor)),invFadeParemeter:u(col(c._InvFadeParemeter)),
  shininess:u(f._Shininess),worldLightDir:u(col(c._WorldLightDir)), // stays (0,0,0,0) as in the original: SpecularLighting.specularLight is null in the export, so its Update never sets it; do not wire the sun in
 distortParams:u(col(c._DistortParams)),fresnelScale:u(f._FresnelScale),foam:u(col(c._Foam)),
  edgeBlend:u(w.waterBase.edgeBlend?1:0),terrainHeights:u(terrain?.texture??null),terrain:u(new THREE.Vector4(terrain?.originX??0,terrain?.originZ??0,terrain?(terrain.extent/(terrain.size-1)):1,terrain?terrain.size-1:0)),
  waterHeight:u(height),fogColor:u(new THREE.Vector3(1,1,1)),fogRange:u(new THREE.Vector2(0,4000)),farClip:u(sky?.manifest.camera.far??6000),
  grabTex:u(grabTarget.texture),grabDepth:u(grabTarget.depthTexture),grabOn:u(0),invScreen:u(new THREE.Vector2(1,1)),depthParams:u(new THREE.Vector2(0.05,24000))};
 if(!terrain)uniforms.edgeBlend.value=0;
 const material=new THREE.ShaderMaterial({name:'FX/Water4 (Water4Example)',uniforms,vertexShader,fragmentShader,side:THREE.DoubleSide,transparent:true,depthWrite:false,fog:false,
  blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
 material.forceSinglePass=true; // Cull Off draws the plane once (three would split a double-sided transparent draw in two)
 const mesh=new THREE.Mesh(geometry,material);mesh.name='Original sea (RustWater Tile, FX/Water4)';mesh.position.set((lo[0]+hi[0])/2,height,(lo[2]+hi[2])/2);mesh.frustumCulled=false;
 mesh.renderOrder=-200; // Transparent-200: after the sky dome, before ordinary transparent objects.
 // GrabPass: when the sea starts drawing into the HDR camera image, copy its colour and depth (blitFramebuffer).
 let post=null,grabs=0,grabState='none';
 const wantsGrab=()=>mesh.visible&&(uniforms.quality.value>1.5||uniforms.edgeBlend.value>0.5);
 function grab(target){
  const gl=renderer.getContext(),props=renderer.properties,src=props.get(target).__webglFramebuffer;
  if(!src||Array.isArray(src)||!target.depthTexture||target.texture.type!==THREE.HalfFloatType||!gl.blitFramebuffer)return false;
  const w=target.width,h=target.height;if(grabTarget.width!==w||grabTarget.height!==h){grabTarget.setSize(w,h);grabTarget.depthTexture.image.width=w;grabTarget.depthTexture.image.height=h;}
  if(!blitRenderTarget(renderer,target,grabTarget,gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT))return false;grabs++;return true;}
 mesh.onBeforeRender=(r,scene,camera)=>{
  const target=r.getRenderTarget(),on=Boolean(wantsGrab()&&target&&target===post?.target?.()&&grab(target));
  uniforms.grabOn.value=on?1:0;material.blendSrc=on?THREE.SrcAlphaFactor:THREE.OneFactor;grabState=on?'grab':wantsGrab()?'no-camera-image':'none';
  if(target)uniforms.invScreen.value.set(1/target.width,1/target.height);uniforms.depthParams.value.set(camera.near,camera.far);};
 // Utility/WriteZ 'Plane' (Transparent+1): writes depth only (its colour has alpha 0 with Blend SrcAlpha One).
 let writeZ=null;
 if(w.writeZPlane){const s=w.writeZPlane.worldScale,size=(w.writeZPlane.max[0]-w.writeZPlane.min[0])*s[0];
  writeZ=new THREE.Mesh(new THREE.PlaneGeometry(size,size).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,transparent:true,side:THREE.DoubleSide,fog:false}));
  writeZ.name='Original Utility/WriteZ plane';writeZ.position.set(mesh.position.x,w.writeZPlane.worldY,mesh.position.z);writeZ.renderOrder=1;writeZ.frustumCulled=false;}
 // PlanarReflection camera (three Reflector construction: proper rotation, projective texture lookup, oblique near plane).
 const virtualCamera=new THREE.PerspectiveCamera(),normal=new THREE.Vector3(0,1,0),mirror=new THREE.Vector3(),cameraPos=new THREE.Vector3(),rotation=new THREE.Matrix4(),lookAt=new THREE.Vector3(),target=new THREE.Vector3(),view=new THREE.Vector3();
 const plane=new THREE.Plane(),clipPlane=new THREE.Vector4(),q=new THREE.Vector4(),size=new THREE.Vector2(),clear=new THREE.Color(),fwd=new THREE.Vector3();
 // Clear colour as stored: raw gamma values in the sRGB-output target.
 const cc=w.planarReflection.clearColor,clearColor=new THREE.Color().setRGB(cc.r,cc.g,cc.b,THREE.LinearSRGBColorSpace);
 const clipOffset=w.planarReflection.clipPlaneOffset??0.07;
 let reflect=Boolean(reflections),time=0,rendered=0;
 // WaterBase.UpdateShader: High = LOD 500, Medium = LOD 300, Low = LOD 200 (no reflection texture is sampled).
 const reflected=new Set();let hooks=null;
 function setReflected(object,on=true){object.traverse(o=>{if(on)o.layers.enable(REFLECT_LAYER);else o.layers.disable(REFLECT_LAYER);});if(on)reflected.add(object);else reflected.delete(object);}
 if(sky)setReflected(sky.group);
 // Call once per frame before rendering the main camera (after the sky has followed the camera).
 function beforeRender(scene,camera,dt=0){
  time+=dt;uniforms.time.value=time;
  camera.getWorldPosition(cameraPos);camera.getWorldDirection(fwd);uniforms.cameraU.value.set(cameraPos.x,cameraPos.y,-cameraPos.z);uniforms.cameraForwardU.value.set(fwd.x,fwd.y,-fwd.z);
  if(sky){const fog=sky.fogColor,st=sky.state;uniforms.fogColor.value.set(fog[0],fog[1],fog[2]);uniforms.fogRange.value.set(sky.fogSettings.start,sky.fogSettings.end);
   if(st){const wc=waterColors(fog,st.ambientColor,w.waterColor);uniforms.baseColor.value.set(...wc.baseColor);uniforms.reflectionColor.value.set(...wc.reflectionColor);}}
  renderer.getDrawingBufferSize(size);const rw=Math.max(1,Math.floor(size.x*0.5)),rh=Math.max(1,Math.floor(size.y*0.5));
  if(reflectionTarget.width!==rw||reflectionTarget.height!==rh)reflectionTarget.setSize(rw,rh);
  mirror.set(cameraPos.x,height,cameraPos.z);view.subVectors(mirror,cameraPos);
  if(view.dot(normal)>0||uniforms.quality.value<0.5)return; // camera below the water / Low quality: no reflection pass
  // PlanarReflection.RenderReflectionFor mirrors about w = -Dot(up, position) - clipPlaneOffset: the plane y = water + clipPlaneOffset.
  mirror.y=height+clipOffset;
  rotation.extractRotation(camera.matrixWorld);lookAt.set(0,0,-1).applyMatrix4(rotation).add(cameraPos);
  view.reflect(normal).negate().add(mirror);target.subVectors(mirror,lookAt).reflect(normal).negate().add(mirror);
  virtualCamera.position.copy(view);virtualCamera.up.set(0,1,0).applyMatrix4(rotation).reflect(normal);virtualCamera.lookAt(target);
  virtualCamera.near=camera.near;virtualCamera.far=camera.far;virtualCamera.updateMatrixWorld();virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
  uniforms.reflectionMatrix.value.set(0.5,0,0,0.5,0,0.5,0,0.5,0,0,0.5,0.5,0,0,0,1).multiply(virtualCamera.projectionMatrix).multiply(virtualCamera.matrixWorldInverse);
  // Oblique near plane at the water + clipPlaneOffset (PlanarReflection.CameraSpacePlane / CalculateObliqueMatrix).
  plane.setFromNormalAndCoplanarPoint(normal,mirror.setY(height+clipOffset)).applyMatrix4(virtualCamera.matrixWorldInverse);
  clipPlane.set(plane.normal.x,plane.normal.y,plane.normal.z,plane.constant);const p=virtualCamera.projectionMatrix.elements;
  q.set((Math.sign(clipPlane.x)+p[8])/p[0],(Math.sign(clipPlane.y)+p[9])/p[5],-1,(1+p[10])/p[14]);clipPlane.multiplyScalar(2/clipPlane.dot(q));
  p[2]=clipPlane.x;p[6]=clipPlane.y;p[10]=clipPlane.z+1;p[14]=clipPlane.w;virtualCamera.projectionMatrixInverse.copy(virtualCamera.projectionMatrix).invert();
  const previous=renderer.getRenderTarget(),alpha=renderer.getClearAlpha();renderer.getClearColor(clear);
  mesh.visible=false;if(writeZ)writeZ.visible=false;
  renderer.setRenderTarget(reflectionTarget);renderer.setClearColor(clearColor,1);renderer.clear();
  if(reflect){
   // Every light must pass the reflection camera's layer test too: a different light set would change three's light
   // state between the two passes and make every lit material look up its program again each frame.
   if(rendered%30===0)scene.traverse(o=>{if(o.isLight)o.layers.enableAll();});
   virtualCamera.layers.set(REFLECT_LAYER);terrain?.update?.(virtualCamera);hooks?.before?.();try{renderer.render(scene,virtualCamera);}finally{hooks?.after?.();}}
  // Sky only: the group renders with its own (light-free) three.js render state, leaving the scene's light state alone.
  else if(sky){virtualCamera.layers.set(0);renderer.render(sky.group,virtualCamera);}
  renderer.setRenderTarget(previous);renderer.setClearColor(clear,alpha);mesh.visible=true;if(writeZ)writeZ.visible=true;rendered++;
 }
 return {mesh,writeZ,material,uniforms,reflectionTarget,grabTarget,beforeRender,setReflected,REFLECT_LAYER,
  // {before(), after()} around the reflection camera's scene render (browser/layer-culling.mjs suspend/resume).
  setReflectionHooks(h){hooks=h??null;},
  // The post chain's HDR camera image (browser/post-chain.mjs): the sea asks for it while it needs a GrabPass/depth.
  attachPostChain(chain){post?.requestTarget?.('Water4',null);post=chain??null;post?.requestTarget?.('Water4',wantsGrab);},
  // The original options menu 'Water Reflections' checkbox (water.reflection console variable, default false).
  setReflections(on){reflect=Boolean(on);return reflect;},get reflections(){return reflect;},
  // WaterSettings.RefreshSettings result (see sky-model waterSettings): waterQuality 0 Low / 1 Medium / 2 High, edgeBlend.
  setQuality({waterQuality,edgeBlend}){uniforms.quality.value=Math.max(0,Math.min(2,waterQuality|0));uniforms.edgeBlend.value=edgeBlend&&terrain?1:0;return {waterQuality:uniforms.quality.value,edgeBlend:Boolean(uniforms.edgeBlend.value)};},
  debug:()=>({reflections:reflect,quality:uniforms.quality.value,refraction:grabState,grabs,grabSize:[grabTarget.width,grabTarget.height],reflectionLDR:true,reflectionSize:[reflectionTarget.width,reflectionTarget.height],rendered,height,grid,edgeBlend:uniforms.edgeBlend.value,baseColor:uniforms.baseColor.value.toArray(),reflectionColor:uniforms.reflectionColor.value.toArray(),reflectedRoots:reflected.size})};
}
