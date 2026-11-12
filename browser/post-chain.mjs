import * as THREE from 'three';

// The in-game Scene Camera's image effects, ported from their decompiled C# (TOD_SunShafts.cs, Assembly-UnityScript-
// firstpass AntialiasingAsPostEffect/NoiseAndGrain/Bloom.cs) and the shipped shader programs (analysis/shader-source,
// analysis/sky-source: the OpenGL subprograms). Unity calls OnRenderImage in component order on the HDR (ARGBHalf, gamma
// colour space) camera image: TOD_SunShafts -> AntialiasingAsPostEffect -> NoiseAndGrain -> Bloom -> GameFullscreen; the
// final blit to the back buffer clamps. Which effects run is decided by gfx.* / ImageEffectManager (browser/quality.mjs).
//
// Port: the world (and the view-model pass) render into a half-float target that three treats like the canvas (it is
// flagged as an XR target so programs keep their sRGB output stage: the stored values are the original gamma-space values,
// blending and fog happen in gamma space exactly as on the canvas, and no program is recompiled when the chain switches
// on or off). Without an active effect the world renders straight to the canvas, as Unity's result is the same.
// Approximations: the sun-shaft depth mask is taken before the view-model pass (Unity's depth also held the view model),
// with the full depth buffer (Unity's deferred _CameraDepthTexture held only deferred opaque objects; the sea's WriteZ
// plane therefore masks shafts here); the sky alpha term max(1.0098 - a, luminance) uses a = 1 (the daytime TOD sky alpha).
// GameFullscreen (damage overlay) is a hook: setFullscreenEffect().

export const POST_ORDER=Object.freeze(['TOD_SunShafts','AntialiasingAsPostEffect','NoiseAndGrain','Bloom','GameFullscreen']);
// Shipped Scene Camera component values (tools/export_quality.py quality/manifest.json camera.components).
export const SHIPPED_POST={
 sunShafts:{Resolution:1,BlendMode:0,RadialBlurIterations:2,SunShaftBlurRadius:2.5,SunShaftIntensity:1.5,MaxRadius:0.33,UseDepthTexture:1},
 antialiasing:{mode:2},
 noiseAndGrain:{intensityMultiplier:0,generalIntensity:0.1,blackIntensity:0.1,whiteIntensity:0.1,midGrey:0.2,softness:0,monochrome:0,intensities:{x:0.7663285732269287,y:0.6532977819442749,z:0.9991937279701233},tiling:{x:24,y:28,z:32},monochromeTiling:64,filterMode:1},
 bloom:{tweakMode:0,screenBlendMode:1,hdr:0,sepBlurSpread:2.5,quality:1,bloomIntensity:0.5,bloomThreshhold:1,bloomThreshholdColor:{r:1,g:1,b:1,a:1},bloomBlurIterations:2,lensflareIntensity:0},
};

// Copies buffers of one render target into another in the middle of a pass (GrabPass-style: the sea's refraction/depth,
// the soft particles' depth) and leaves `source` bound for drawing. three's WebGLState caches READ_FRAMEBUFFER on its own
// and initRenderTarget() rebinds FRAMEBUFFER to null, so a cached read binding can be stale (it once blitted from the
// canvas: "Depth/stencil buffer format combination not allowed"). The read/draw binds therefore go straight to GL and
// only FRAMEBUFFER (= read + draw) goes through the cache, before and after.
export function blitRenderTarget(renderer,source,dest,mask){const gl=renderer.getContext(),props=renderer.properties,state=renderer.state;
 const src=props.get(source).__webglFramebuffer;if(!src||Array.isArray(src)||!gl.blitFramebuffer)return false;
 if(!props.get(dest).__webglFramebuffer)renderer.initRenderTarget(dest);
 const dst=props.get(dest).__webglFramebuffer,scissor=gl.isEnabled(gl.SCISSOR_TEST),w=source.width,h=source.height;
 state.bindFramebuffer(gl.FRAMEBUFFER,src);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,src);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,dst);
 if(scissor)gl.disable(gl.SCISSOR_TEST);gl.blitFramebuffer(0,0,w,h,0,0,w,h,mask,gl.NEAREST);if(scissor)gl.enable(gl.SCISSOR_TEST);
 gl.bindFramebuffer(gl.FRAMEBUFFER,src);return true;}

// --- Pure parameter logic (Node tests) --------------------------------------------------------------------------------
// TOD_SunShafts: blur target size per Resolution (Low /4, Normal /2, High full).
export function shaftsSize(resolution,w,h){const d=resolution===2?1:resolution===1?2:4;return [Math.floor(w/d),Math.floor(h/d)];}
// The radial-blur radius each of the 2 * iterations blits uses (first 0.0013020834 * r, then r * (2i + 1) * 6 / 768 and
// r * (2i + 2) * 6 / 768; the last value set is never used by a blit).
export function shaftsBlurRadii(radius,iterations){const out=[];let n=radius*0.0013020834;
 for(let i=0;i<iterations;i++){out.push(n);n=radius*((i*2+1)*6)/768;out.push(n);n=radius*((i*2+2)*6)/768;}return out;}
// _SunColor: (1 - Fogginess) * SunShaftIntensity * SunShaftColor while the sun is in front of the camera, else zero.
export function shaftsSunColor(viewportZ,fogginess,intensity,color){return viewportZ>=0?[0,1,2,3].map(i=>(1-fogginess)*intensity*(color[i]??1)):[0,0,0,0];}
// Bloom (quality > Cheap): blur offsets of iteration i (vertical then horizontal), in UV of the quarter-size target.
export function bloomBlurOffsets(i,spread,aspect){const s=(1+i*0.25)*spread,k=2/1024;return {vertical:[0,s*k],horizontal:[s/aspect*k,0]};}
// Bloom: HDR mode Auto follows the camera (ARGBHalf source + camera.hdr); HDR forces the Add blend.
export function bloomMode(params,cameraHdr){const hdr=params.hdr===0?cameraHdr:params.hdr===1;return {hdr,blend:hdr?1:params.screenBlendMode};}
// NoiseAndGrain uniforms (non-DX11 path): _NoisePerChannel, _NoiseTilingPerChannel, _MidGrey, _NoiseAmount.
export function grainUniforms(p,multiplier){return {perChannel:p.monochrome?[1,1,1]:[p.intensities.x,p.intensities.y,p.intensities.z],tiling:p.monochrome?[p.monochromeTiling,p.monochromeTiling,p.monochromeTiling]:[p.tiling.x,p.tiling.y,p.tiling.z],
 midGrey:[p.midGrey,1/(1-p.midGrey),-1/p.midGrey],amount:[p.generalIntensity*multiplier,p.blackIntensity*multiplier,p.whiteIntensity*multiplier]};}
// DrawNoiseQuadGrid: 64-pixel tiles (TILE_AMOUNT 64), each with a random noise offset quantised to the noise texel.
export const GRAIN_TILE_PIXELS=64;
export function grainReference(src,noise,u){ // per channel, mirrors the ARB fragment program (tests)
 const sat=x=>Math.min(1,Math.max(0,x)),lum=src[0]*0.2199707+src[1]*0.70703125+src[2]*0.070983887,d=lum-u.midGrey[0];
 const k=Math.max(0,sat(d*u.midGrey[1])*u.amount[2]+sat(d*u.midGrey[2])*u.amount[1])+u.amount[0];
 return [0,1,2].map(i=>{const s=sat(src[i]),n=sat(k*u.perChannel[i]*(noise[i]-0.5)+0.5);return s>=0.5?1-(2-2*s)*(1-n):2*s*n;});}

// --- GLSL ------------------------------------------------------------------------------------------------------------
const VERT=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
// Back-buffer blit: clamps like the LDR back buffer; opaque alpha (the canvas has an alpha channel, Unity's had none).
const copyFrag=`uniform sampler2D tSrc;varying vec2 vUv;void main(){gl_FragColor=vec4(clamp(texture2D(tSrc,vUv).rgb,0.0,1.0),1.0);}`;
// TOD Sun Shafts pass 2 (depth): sky pixels (Linear01Depth > 0.99 of the original far plane) near the sun.
const shaftsMaskFrag=`uniform sampler2D tSrc;uniform sampler2D tDepth;uniform vec4 sunPosition;uniform vec3 depthParams;uniform vec2 texel;varying vec2 vUv;
void main(){vec2 f=gl_FragCoord.xy;if(f.x<1.0||f.y<1.0||f.x>1.0/texel.x-1.0||f.y>1.0/texel.y-1.0){gl_FragColor=vec4(0.0);return;} // DrawBorder (Screen Clear)
 float d=texture2D(tDepth,vUv).r;float eyeZ=depthParams.x*depthParams.y/(depthParams.y-d*(depthParams.y-depthParams.x));
 if(!(eyeZ>depthParams.z)){gl_FragColor=vec4(0.0);return;}
 vec4 c=texture2D(tSrc,vUv);float v=max(1.0097656-1.0,dot(c.rgb,vec3(0.58984375,0.30004883,0.10998535)));
 gl_FragColor=vec4(v*clamp(sunPosition.w-length(sunPosition.xy-vUv),0.0,1.0));}`;
// Pass 1: 6-tap radial blur towards the sun.
const shaftsRadialFrag=`uniform sampler2D tSrc;uniform vec4 sunPosition;uniform vec2 blurRadius;varying vec2 vUv;
void main(){vec2 o=(sunPosition.xy-vUv)*blurRadius;vec4 c=vec4(0.0);vec2 p=vUv;for(int i=0;i<6;i++){c+=texture2D(tSrc,p);p+=o;}gl_FragColor=c*0.16666667;}`;
// Pass 0 (Screen): 1 - (1 - src) * (1 - saturate(shafts * _SunColor)).
const shaftsScreenFrag=`uniform sampler2D tSrc;uniform sampler2D tShafts;uniform vec4 sunColor;varying vec2 vUv;
void main(){vec4 s=clamp(texture2D(tShafts,vUv)*sunColor,0.0,1.0);gl_FragColor=1.0-(1.0-texture2D(tSrc,vUv))*(1.0-s);}`;
const shaftsAddFrag=`uniform sampler2D tSrc;uniform sampler2D tShafts;uniform vec4 sunColor;varying vec2 vUv;
void main(){gl_FragColor=texture2D(tSrc,vUv)+clamp(texture2D(tShafts,vUv)*sunColor,0.0,1.0);}`;
// Hidden/FXAA Preset 2 (OpenGL GLSL subprogram, verbatim maths; texture2DGradARB -> textureGrad).
const fxaaFrag=`uniform sampler2D tSrc;uniform vec2 texel;varying vec2 vUv;
float L(vec4 c){return c.y*1.96321+c.x;}
vec4 T(vec2 p){return textureLod(tSrc,p,0.0);}
void main(){vec2 x=vUv,r=texel;vec4 n=T(x+vec2(0.0,-1.0)*r),w=T(x+vec2(-1.0,0.0)*r),m=T(x),e=T(x+vec2(1.0,0.0)*r),s=T(x+vec2(0.0,1.0)*r);
 float lN=L(n),lW=L(w),lM=L(m),lE=L(e),lS=L(s);float rangeMax=max(lM,max(max(lN,lW),max(lS,lE))),range=rangeMax-min(lM,min(min(lN,lW),min(lS,lE)));
 vec3 o;if(range<max(0.0416667,rangeMax*0.125)){o=m.xyz;}else{
  float blendL=min(0.75,max(0.0,abs((lN+lW+lE+lS)*0.25-lM)/range-0.25)*1.33333);
  vec4 nw=T(x+vec2(-1.0,-1.0)*r),ne=T(x+vec2(1.0,-1.0)*r),sw=T(x+vec2(-1.0,1.0)*r),se=T(x+r);
  vec3 rgbL=(n.xyz+w.xyz+m.xyz+e.xyz+s.xyz+nw.xyz+ne.xyz+sw.xyz+se.xyz)*vec3(0.111111);
  float lNW=L(nw),lNE=L(ne),lSW=L(sw),lSE=L(se);
  bool horz=(abs(0.25*lNW-0.5*lW+0.25*lSW)+abs(0.5*lN-lM+0.5*lS)+abs(0.25*lNE-0.5*lE+0.25*lSE))>=(abs(0.25*lNW-0.5*lN+0.25*lNE)+abs(0.5*lW-lM+0.5*lE)+abs(0.25*lSW-0.5*lS+0.25*lSE));
  float lengthSign=horz?-r.y:-r.x;float lumaN=horz?lN:lW,lumaS=horz?lS:lE;
  float gradN=abs(lumaN-lM),gradS=abs(lumaS-lM);lumaN=(lumaN+lM)*0.5;float lumaS2=(lumaS+lM)*0.5;
  bool pair=gradN>=gradS;if(!pair){lumaN=lumaS2;gradN=gradS;lengthSign*=-1.0;}
  vec2 posN=vec2(x.x+(horz?0.0:lengthSign*0.5),x.y+(horz?lengthSign*0.5:0.0));gradN*=0.25;vec2 posP=posN;
  vec2 off=horz?vec2(r.x,0.0):vec2(0.0,r.y);float endN=lumaN,endP=lumaN;bool doneN=false,doneP=false;
  posN+=off*vec2(-1.5);posP+=off*vec2(1.5);vec2 offNP=off*vec2(2.0);
  for(int i=0;i<8;i++){if(!doneN)endN=L(textureGrad(tSrc,posN,offNP,offNP));if(!doneP)endP=L(textureGrad(tSrc,posP,offNP,offNP));
   doneN=doneN||abs(endN-lumaN)>=gradN;doneP=doneP||abs(endP-lumaN)>=gradN;if(doneN&&doneP)break;if(!doneN)posN-=offNP;if(!doneP)posP+=offNP;}
  float dstN=horz?x.x-posN.x:x.y-posN.y,dstP=horz?posP.x-x.x:posP.y-x.y;bool dirN=dstN<dstP;endN=dirN?endN:endP;
  if(((lM-lumaN)<0.0)==((endN-lumaN)<0.0))lengthSign=0.0;
  float subpix=(0.5+(dirN?dstN:dstP)*(-1.0/(dstP+dstN)))*lengthSign;
  vec4 f=T(vec2(x.x+(horz?0.0:subpix),x.y+(horz?subpix:0.0)));o=vec3(-blendL)*f.xyz+(rgbL*vec3(blendL)+f.xyz);}
 gl_FragColor=vec4(o,0.0);}`;
// Hidden/NoiseAndGrain pass 0 with DrawNoiseQuadGrid's per-tile random noise offsets.
const grainFrag=`uniform sampler2D tSrc;uniform sampler2D tNoise;uniform vec3 perChannel;uniform vec3 tiling;uniform vec3 midGrey;uniform vec3 amount;uniform vec2 noiseTexel;uniform float seed;uniform float tilePixels;varying vec2 vUv;
float h(vec2 p){p=fract(p*vec2(443.897,441.423)+seed);p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
void main(){vec2 tile=floor(gl_FragCoord.xy/tilePixels),local=fract(gl_FragCoord.xy/tilePixels);
 vec2 offset=floor(vec2(h(tile),h(tile+71.3))/noiseTexel)*noiseTexel;vec2 t0=offset+local*noiseTexel;
 vec3 nz=vec3(texture2D(tNoise,local*tiling.x*noiseTexel+t0).r,texture2D(tNoise,local*tiling.y*noiseTexel+t0).g,texture2D(tNoise,local*tiling.z*noiseTexel+t0).b);
 vec4 src=texture2D(tSrc,vUv);float lum=dot(src.rgb,vec3(0.2199707,0.70703125,0.070983887))-midGrey.x;
 float k=max(0.0,clamp(lum*midGrey.y,0.0,1.0)*amount.z+clamp(lum*midGrey.z,0.0,1.0)*amount.y)+amount.x;
 vec3 s=clamp(src.rgb,0.0,1.0),hi=step(vec3(0.5),s),n=clamp(k*perChannel*(nz-0.5)+0.5,0.0,1.0);
 gl_FragColor=vec4(hi*(1.0-(2.0-2.0*s)*(1.0-n))+(1.0-hi)*s*n*2.0,src.a);}`;
// Hidden/BlendForBloom pass 2 (5-tap max, half-texel cross), pass 6 (4-tap average), pass 1 (Add), pass 0 (Screen).
const bloomMaxFrag=`uniform sampler2D tSrc;uniform vec2 texel;varying vec2 vUv;void main(){vec2 a=0.5*texel,b=vec2(0.5,-0.5)*texel;
 gl_FragColor=max(max(max(max(texture2D(tSrc,vUv),texture2D(tSrc,vUv+a)),texture2D(tSrc,vUv-a)),texture2D(tSrc,vUv-b)),texture2D(tSrc,vUv+b));}`;
const bloomAvgFrag=`uniform sampler2D tSrc;uniform vec2 texel;varying vec2 vUv;void main(){vec2 a=0.5*texel,b=vec2(0.5,-0.5)*texel;
 gl_FragColor=(texture2D(tSrc,vUv+a)+texture2D(tSrc,vUv-a)+texture2D(tSrc,vUv-b)+texture2D(tSrc,vUv+b))*0.25;}`;
// Hidden/BrightPassFilter2 pass 1 (colour threshold): rgb - threshold, at least 0; alpha kept.
const brightFrag=`uniform sampler2D tSrc;uniform vec4 threshold;varying vec2 vUv;void main(){vec4 c=texture2D(tSrc,vUv);gl_FragColor=vec4(max(c.rgb-threshold.rgb,vec3(0.0)),c.a);}`;
// Hidden/BlurAndFlares pass 4: 9 taps at 0, +-1, +-2, +-3, +-5 offsets with weights .225/.15/.11/.075/.0525.
const blurFrag=`uniform sampler2D tSrc;uniform vec2 offsets;varying vec2 vUv;void main(){vec2 o=offsets;
 gl_FragColor=texture2D(tSrc,vUv)*0.225+(texture2D(tSrc,vUv+o)+texture2D(tSrc,vUv-o))*0.15+(texture2D(tSrc,vUv+2.0*o)+texture2D(tSrc,vUv-2.0*o))*0.11
  +(texture2D(tSrc,vUv+3.0*o)+texture2D(tSrc,vUv-3.0*o))*0.075+(texture2D(tSrc,vUv+5.0*o)+texture2D(tSrc,vUv-5.0*o))*0.0525;}`;
const bloomComposeFrag=`uniform sampler2D tSrc;uniform sampler2D tColor;uniform float intensity;uniform float screen;varying vec2 vUv;
void main(){vec4 b=texture2D(tSrc,vUv)*intensity,c=texture2D(tColor,vUv);gl_FragColor=screen>0.5?1.0-(1.0-b)*(1.0-c):b+c;}`;

// renderer: THREE.WebGLRenderer. Returns the chain; see main.mjs for the per-frame calls.
export function createPostChain({renderer,noiseTexture=null,params=SHIPPED_POST,cameraHdr=true,unityFar=6000}){
 const floatOk=renderer.extensions.has('EXT_color_buffer_float')||renderer.extensions.has('EXT_color_buffer_half_float');
 const hdr=Boolean(cameraHdr&&floatOk),type=hdr?THREE.HalfFloatType:THREE.UnsignedByteType;
 const quadScene=new THREE.Scene(),quadCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2));quad.frustumCulled=false;quadScene.add(quad);
 const mat=(frag,uniforms)=>new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader:frag,uniforms,depthTest:false,depthWrite:false,toneMapped:false});
 const M={copy:mat(copyFrag,{tSrc:{value:null}}),
  shaftsMask:mat(shaftsMaskFrag,{tSrc:{value:null},tDepth:{value:null},sunPosition:{value:new THREE.Vector4()},depthParams:{value:new THREE.Vector3()},texel:{value:new THREE.Vector2()}}),
  shaftsRadial:mat(shaftsRadialFrag,{tSrc:{value:null},sunPosition:{value:new THREE.Vector4()},blurRadius:{value:new THREE.Vector2()}}),
  shaftsScreen:mat(shaftsScreenFrag,{tSrc:{value:null},tShafts:{value:null},sunColor:{value:new THREE.Vector4()}}),
  shaftsAdd:mat(shaftsAddFrag,{tSrc:{value:null},tShafts:{value:null},sunColor:{value:new THREE.Vector4()}}),
  fxaa:mat(fxaaFrag,{tSrc:{value:null},texel:{value:new THREE.Vector2()}}),
  grain:mat(grainFrag,{tSrc:{value:null},tNoise:{value:noiseTexture},perChannel:{value:new THREE.Vector3()},tiling:{value:new THREE.Vector3()},midGrey:{value:new THREE.Vector3()},amount:{value:new THREE.Vector3()},
   noiseTexel:{value:new THREE.Vector2(1/64,1/64)},seed:{value:0},tilePixels:{value:GRAIN_TILE_PIXELS}}),
  bloomMax:mat(bloomMaxFrag,{tSrc:{value:null},texel:{value:new THREE.Vector2()}}),bloomAvg:mat(bloomAvgFrag,{tSrc:{value:null},texel:{value:new THREE.Vector2()}}),
  bright:mat(brightFrag,{tSrc:{value:null},threshold:{value:new THREE.Vector4()}}),blur:mat(blurFrag,{tSrc:{value:null},offsets:{value:new THREE.Vector2()}}),
  bloomCompose:mat(bloomComposeFrag,{tSrc:{value:null},tColor:{value:null},intensity:{value:0.5},screen:{value:0}}),
  bloomMaxBlend:mat(`uniform sampler2D tSrc;varying vec2 vUv;void main(){gl_FragColor=texture2D(tSrc,vUv);}`,{tSrc:{value:null}})};
 // BlendForBloom pass 10: Blend One One, BlendOp Max.
 Object.assign(M.bloomMaxBlend,{blending:THREE.CustomBlending,blendEquation:THREE.MaxEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
 if(noiseTexture){noiseTexture.wrapS=noiseTexture.wrapT=THREE.RepeatWrapping;noiseTexture.magFilter=noiseTexture.minFilter=params.noiseAndGrain.filterMode===0?THREE.NearestFilter:THREE.LinearFilter;noiseTexture.generateMipmaps=false;noiseTexture.flipY=false;noiseTexture.colorSpace=THREE.NoColorSpace;noiseTexture.needsUpdate=true;}
 const rt=(w,h,o={})=>{const t=new THREE.WebGLRenderTarget(Math.max(1,w),Math.max(1,h),{type,format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,generateMipmaps:false,...o});t.texture.colorSpace=THREE.NoColorSpace;return t;};
 let size=[0,0],main=null,ping=null,pong=null,shaftsA=null,shaftsB=null,half=null,quarterA=null,quarterB=null,quarterC=null;
 const effects={shafts:false,fxaa:false,grain:false,bloom:false},sun={viewport:new THREE.Vector3(0.5,0.5,-1),color:[1,1,1,1],fogginess:0};let grainMultiplier=params.noiseAndGrain.intensityMultiplier,fullscreen=null;
 const stats={active:false,passes:[],frames:0};let frame=0;
 function allocate(w,h){if(size[0]===w&&size[1]===h&&main)return;size=[w,h];for(const t of [main,ping,pong,shaftsA,shaftsB,half,quarterA,quarterB,quarterC])t?.dispose();
  // The camera image: half float, depth texture for the sun-shaft mask. Flagged as an XR target so three renders into it
  // with the same programs (sRGB output stage, gamma-space blending) as into the canvas.
  main=rt(w,h,{depthBuffer:true,depthTexture:new THREE.DepthTexture(w,h,THREE.UnsignedIntType)});main.isXRRenderTarget=true;main.texture.colorSpace=THREE.SRGBColorSpace;
  ping=rt(w,h);pong=rt(w,h);const [sw,sh]=shaftsSize(params.sunShafts.Resolution,w,h);shaftsA=rt(sw,sh);shaftsB=rt(sw,sh);
  half=rt(Math.floor(w/2),Math.floor(h/2));quarterA=rt(Math.floor(w/4),Math.floor(h/4));quarterB=rt(Math.floor(w/4),Math.floor(h/4));quarterC=rt(Math.floor(w/4),Math.floor(h/4));}
 // Full-screen quads overwrite every pixel: no clear (BlendForBloom pass 10 also relies on keeping the target).
 function pass(material,target){quad.material=material;renderer.setRenderTarget(target);const clear=renderer.autoClear;renderer.autoClear=false;try{renderer.render(quadScene,quadCamera);}finally{renderer.autoClear=clear;}}
 const texel=(t,v)=>v.set(1/t.width,1/t.height);
 // Passes that read the camera image while the world draws (the sea's GrabPass refraction / _CameraDepthTexture edge blend)
 // ask for the offscreen camera image even when no image effect runs: Unity's camera always rendered into its HDR target.
 const targetRequests=new Map();
 const active=()=>effects.shafts||effects.fxaa||(effects.grain&&grainMultiplier>0)||effects.bloom||Boolean(fullscreen?.active?.())||[...targetRequests.values()].some(f=>f());
 let mainBound=false;const bufferSize=new THREE.Vector2();
 return {
  get hdr(){return hdr;},
  // Effective component switches (ImageEffectManager live state from browser/quality.mjs).
  setEffects(e){Object.assign(effects,{shafts:Boolean(e.shafts),fxaa:Boolean(e.fxaa),grain:Boolean(e.grain),bloom:Boolean(e.bloom)});},
  // Per frame: the sun's camera viewport point (x, y in 0..1, z = eye depth), TOD SunShaftColor and Atmosphere.Fogginess.
  setSun({viewport,color,fogginess}){if(viewport)sun.viewport.copy(viewport);if(color)sun.color=color;if(fogginess!==undefined)sun.fogginess=fogginess;},
  // LocalRadiationEffect: NoiseAndGrain.intensityMultiplier.
  setGrainMultiplier(v){grainMultiplier=Number(v)||0;},
  // GameFullscreen hook (damage overlay, owned by the combat-feedback HUD): {active():bool, render(renderer,inputTexture,outputTarget,pass)}.
  // render draws the effect from inputTexture into outputTarget (null = canvas); pass(material,target) draws a full-screen quad.
  setFullscreenEffect(effect){fullscreen=effect??null;},
  // requestTarget(owner, () => bool): while the callback is true the world renders into the HDR camera image (with its
  // depth texture), which `target()` returns during the world pass; null removes the request.
  requestTarget(owner,wants){if(wants)targetRequests.set(owner,wants);else targetRequests.delete(owner);},
  target(){return mainBound?main:null;},
  // Before the world render: returns the target to render into (null = the canvas).
  begin(){stats.active=active();if(!stats.active){mainBound=false;return null;}const v=renderer.getDrawingBufferSize(bufferSize);allocate(v.x,v.y);renderer.setRenderTarget(main);mainBound=true;return main;},
  // After the world pass, before the view-model pass: the sun-shaft depth mask (needs the world depth).
  afterWorld(camera){if(!mainBound||!effects.shafts)return;const p=params.sunShafts,u=M.shaftsMask.uniforms,v=sun.viewport;
   u.tSrc.value=main.texture;u.tDepth.value=main.depthTexture;u.sunPosition.value.set(v.x,v.y,v.z,p.MaxRadius);u.depthParams.value.set(camera.near,camera.far,0.99*unityFar);texel(shaftsA,u.texel.value);
   const prev=renderer.getRenderTarget();pass(M.shaftsMask,shaftsA);renderer.setRenderTarget(prev);},
  // After the view-model pass: run the active effects in component order; the last one writes the canvas.
  finish(){if(!mainBound){stats.passes=[];return;}mainBound=false;frame++;stats.frames++;
   const chain=[];if(effects.shafts)chain.push('TOD_SunShafts');if(effects.fxaa)chain.push('AntialiasingAsPostEffect');if(effects.grain&&grainMultiplier>0)chain.push('NoiseAndGrain');if(effects.bloom)chain.push('Bloom');if(fullscreen?.active?.())chain.push('GameFullscreen');
   chain.push('blit');stats.passes=chain.slice(0,-1);let src=main.texture,flip=false;
   for(let i=0;i<chain.length;i++){const last=i===chain.length-1,dst=last?null:(flip?pong:ping);flip=!flip;const name=chain[i];
    if(name==='TOD_SunShafts'){const p=params.sunShafts,radii=shaftsBlurRadii(p.SunShaftBlurRadius,p.RadialBlurIterations),u=M.shaftsRadial.uniforms,v=sun.viewport;u.sunPosition.value.set(v.x,v.y,v.z,p.MaxRadius);
      let a=shaftsA,b=shaftsB;for(const r of radii){u.tSrc.value=a.texture;u.blurRadius.value.set(r,r);pass(M.shaftsRadial,b);[a,b]=[b,a];}
      const m=p.BlendMode===0?M.shaftsScreen:M.shaftsAdd;m.uniforms.tSrc.value=src;m.uniforms.tShafts.value=a.texture;m.uniforms.sunColor.value.fromArray(shaftsSunColor(v.z,sun.fogginess,p.SunShaftIntensity,sun.color));pass(m,dst);}
    else if(name==='AntialiasingAsPostEffect'){M.fxaa.uniforms.tSrc.value=src;M.fxaa.uniforms.texel.value.set(1/size[0],1/size[1]);pass(M.fxaa,dst);}
    else if(name==='NoiseAndGrain'){const g=grainUniforms(params.noiseAndGrain,grainMultiplier),u=M.grain.uniforms;u.tSrc.value=src;u.perChannel.value.fromArray(g.perChannel);u.tiling.value.fromArray(g.tiling);u.midGrey.value.fromArray(g.midGrey);u.amount.value.fromArray(g.amount);
      if(noiseTexture?.image)u.noiseTexel.value.set(1/noiseTexture.image.width,1/noiseTexture.image.height);u.seed.value=(frame*0.6180339887)%1;pass(M.grain,dst);}
    else if(name==='Bloom')bloom(src,dst);
    else if(name==='GameFullscreen')fullscreen.render(renderer,src,dst,pass);
    else {M.copy.uniforms.tSrc.value=src;pass(M.copy,null);}
    if(dst)src=dst.texture;}
   renderer.setRenderTarget(null);},
  state:()=>({active:stats.active,hdr,effects:{...effects},grainMultiplier,passes:stats.passes,frames:stats.frames,size,fullscreenHook:Boolean(fullscreen),targetRequests:[...targetRequests].filter(([,f])=>f()).map(([k])=>k)}),
  dispose(){for(const t of [main,ping,pong,shaftsA,shaftsB,half,quarterA,quarterB,quarterC])t?.dispose();for(const m of Object.values(M))m.dispose();quad.geometry.dispose();}};

 // Bloom.OnRenderImage, quality High (> Cheap), lens flares off (lensflareIntensity 0).
 function bloom(src,dst){const p=params.bloom,mode=bloomMode(p,hdr),aspect=size[0]/size[1];
  M.bloomMax.uniforms.tSrc.value=src;texel({width:size[0],height:size[1]},M.bloomMax.uniforms.texel.value);pass(M.bloomMax,half);
  M.bloomMax.uniforms.tSrc.value=half.texture;texel(half,M.bloomMax.uniforms.texel.value);pass(M.bloomMax,quarterC);
  M.bloomAvg.uniforms.tSrc.value=quarterC.texture;texel(quarterC,M.bloomAvg.uniforms.texel.value);pass(M.bloomAvg,quarterA); // "temporary"
  const t=p.bloomThreshholdColor;M.bright.uniforms.tSrc.value=quarterA.texture;M.bright.uniforms.threshold.value.set(p.bloomThreshhold*t.r,p.bloomThreshhold*t.g,p.bloomThreshhold*t.b,p.bloomThreshhold*t.a);pass(M.bright,quarterB); // "renderTexture"
  let rtex=quarterB,spare=quarterC;const iterations=Math.min(10,Math.max(1,p.bloomBlurIterations));
  for(let i=0;i<iterations;i++){const o=bloomBlurOffsets(i,p.sepBlurSpread,aspect);
   M.blur.uniforms.tSrc.value=rtex.texture;M.blur.uniforms.offsets.value.fromArray(o.vertical);pass(M.blur,spare);[rtex,spare]=[spare,rtex];
   M.blur.uniforms.tSrc.value=rtex.texture;M.blur.uniforms.offsets.value.fromArray(o.horizontal);pass(M.blur,spare);[rtex,spare]=[spare,rtex];
   if(i===0){M.bloomMaxBlend.uniforms.tSrc.value=rtex.texture;M.bloomMaxBlend.blending=THREE.NoBlending;pass(M.bloomMaxBlend,quarterA);M.bloomMaxBlend.blending=THREE.CustomBlending;}
   else {M.bloomMaxBlend.uniforms.tSrc.value=rtex.texture;pass(M.bloomMaxBlend,quarterA);}}
  M.bloomAvg.uniforms.tSrc.value=quarterA.texture;texel(quarterA,M.bloomAvg.uniforms.texel.value);pass(M.bloomAvg,rtex);
  // Blit(renderTexture -> half-size temporary) then Add with _ColorBuffer = source (pass 1).
  M.bloomMaxBlend.blending=THREE.NoBlending;M.bloomMaxBlend.uniforms.tSrc.value=rtex.texture;pass(M.bloomMaxBlend,half);M.bloomMaxBlend.blending=THREE.CustomBlending;
  const c=M.bloomCompose.uniforms;c.tSrc.value=half.texture;c.tColor.value=src;c.intensity.value=p.bloomIntensity;c.screen.value=mode.blend===0?1:0;pass(M.bloomCompose,dst);}
}
