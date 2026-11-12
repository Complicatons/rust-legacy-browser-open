// Original render-quality rules (pure; browser/quality-controller code and Node tests use them). Sources (all static):
//  - client mainData QualitySettings (tools/export_quality.py -> quality/manifest.json): six levels Fastest..Fantastic.
//    The build's m_CurrentQuality is 0, the level a fresh install starts at (Unity's launcher dialog preselects it).
//  - render.cs: render.level = QualitySettings index / (names - 1); the setter rounds value * 5 and calls update(), whose
//    switch (only when the level differs from PlayerPrefs "UnityGraphicsQualityBackup") sets the gfx.* image effects:
//    levels 0-2 ssaa/bloom/ssao/tonemap/shafts off, 3 shafts only, 4 unchanged (the decompiled `case 4: break`), 5 all on.
//  - gfx.cs + ImageEffectManager.cs: gfx.<x> reads/writes ImageEffectManager states (default enabled when never set);
//    SetEnabled also flips the live camera component. ImageEffectManager.Start walks the camera's MonoBehaviours in
//    component order, applies stored states and STOPS at the first disabled one: on the shipped Scene Camera that is the
//    serialized-disabled Bloom, so Bloom (and GameFullscreen after it) keep their serialized flags at camera start.
//  - SSAOEffect and Tonemapping are not components of the in-game Scene Camera (only of an unused 'Main Camera' prefab),
//    so gfx.ssao / gfx.tonemap only store a state: they change nothing on screen, as in the original.
//  - TOD_Sky.SetupSunAndMoon: the sun/moon Light is Soft-shadowed whenever its shadowStrength is non-zero (Day/Night 1).
//  - Unity 4 engine rules (not in any data; from the Unity 4 manual): directional shadow map size =
//    NextPowerOfTwo(max(screen w, h) * 1.9) capped at 4096 for High, /2 Medium, /4 Low, x2 Very High (cap 4096);
//    Stable Fit cascades select by split spheres, splits 1/3 (2 cascades) and 1/15, 3/15, 7/15 (4 cascades).

export const QUALITY_NAMES=Object.freeze(['Fastest','Fast','Simple','Good','Beautiful','Fantastic']);
// mainData QualitySettings.m_CurrentQuality (the standalone build's default level).
export const DEFAULT_QUALITY_INDEX=0;
// Shipped QualitySettings (fallback when the export is missing; tests compare the export against it).
const q=(name,pixelLightCount,shadows,shadowResolution,shadowCascades,shadowDistance,blendWeights,textureQuality,anisotropicTextures,softParticles,softVegetation)=>
 Object.freeze({name,pixelLightCount,shadows,shadowResolution,shadowProjection:1,shadowCascades,shadowDistance,blendWeights,textureQuality,anisotropicTextures,antiAliasing:0,softParticles,softVegetation,vSyncCount:0,lodBias:1,maximumLODLevel:0,particleRaycastBudget:4});
export const SHIPPED_QUALITY=Object.freeze([
 q('Fastest',0,0,0,1,15,1,2,0,false,false),
 q('Fast',0,1,0,1,20,1,1,0,false,false),
 q('Simple',1,2,0,1,20,1,1,0,false,false),
 q('Good',2,2,1,1,100,2,0,1,false,true),
 q('Beautiful',3,2,2,2,150,4,0,1,true,true),
 q('Fantastic',6,2,3,4,250,4,0,1,true,true)]);
// RustSky/Light m_Shadows (exported); TOD_Sky forces the type to Soft while shadowStrength != 0.
export const SHIPPED_SUN_SHADOWS=Object.freeze({m_Type:2,m_Resolution:-1,m_Strength:1,m_Bias:0.25,m_Softness:4.94,m_SoftnessFade:2.92});

// render.level setter: Mathf.RoundToInt(value * (names - 1)) (banker's rounding on .5); getter index / (names - 1).
export function qualityIndex(level,count=QUALITY_NAMES.length){const x=Math.min(1,Math.max(0,Number(level)||0))*(count-1),f=Math.floor(x),d=x-f;return d>0.5?f+1:d<0.5?f:(f%2===0?f:f+1);}
export function qualityLevel(index,count=QUALITY_NAMES.length){return Math.min(count-1,Math.max(0,index|0))/(count-1);}

// gfx convar -> image-effect component (gfx.cs).
export const GFX_EFFECTS=Object.freeze({'gfx.ssaa':'AntialiasingAsPostEffect','gfx.bloom':'Bloom','gfx.grain':'NoiseAndGrain','gfx.ssao':'SSAOEffect','gfx.tonemap':'Tonemapping','gfx.shafts':'TOD_SunShafts','gfx.damage':'GameFullscreen'});
// render.update(): the gfx values written when the quality level differs from the stored backup (null: nothing written).
export function renderUpdateGfx(index,backup){
 if(index===backup)return null;
 if(index<=2)return {'gfx.ssaa':false,'gfx.bloom':false,'gfx.ssao':false,'gfx.tonemap':false,'gfx.shafts':false};
 if(index===3)return {'gfx.ssaa':false,'gfx.bloom':false,'gfx.ssao':false,'gfx.tonemap':false,'gfx.shafts':true};
 if(index===4)return {}; // `case 4: break` - the backup is still updated
 return {'gfx.ssaa':true,'gfx.bloom':true,'gfx.ssao':true,'gfx.tonemap':true,'gfx.shafts':true};
}

// The shipped Scene Camera's MonoBehaviours in component order with their serialized enabled flags.
export const SCENE_CAMERA_BEHAVIOURS=Object.freeze(['ClearFirstFrame','TOD_Camera','TOD_SunShafts','CameraFXPre','CameraFXPost','MountedCamera','SoundPoolFilter','CameraSettings',
 'CameraLayerDepths','LaserFilter','CameraEventMaskClear','FPGrassLayer','MeshBatchLayer','ImageEffectManager','AntialiasingAsPostEffect','NoiseAndGrain','Bloom','GameFullscreen','OpaqueCapture']
 .map(type=>Object.freeze({type,enabled:type!=='Bloom'})));
export class ImageEffectManager{
 constructor(behaviours=SCENE_CAMERA_BEHAVIOURS){this.behaviours=behaviours.map(b=>({type:b.type,enabled:Boolean(b.enabled)}));this.states=new Map();this.instance=null;}
 // gfx.<x> getter: true unless a state says otherwise.
 getEnabled(type){return !this.states.has(type)||this.states.get(type);}
 // gfx.<x> setter: the live component (when the camera exists) and the stored state.
 setEnabled(type,value){value=Boolean(value);if(this.instance?.has(type))this.instance.set(type,value);this.states.set(type,value);}
 // Scene Camera spawn: ImageEffectManager.Start (break at the first disabled behaviour).
 start(){this.instance=new Map(this.behaviours.map(b=>[b.type,b.enabled]));for(const b of this.behaviours){if(!this.instance.get(b.type))break;if(this.states.has(b.type))this.instance.set(b.type,this.states.get(b.type));}return this;}
 stop(){this.instance=null;}
 // Whether the effect's component on the live camera is enabled (false without a camera or component).
 active(type){return Boolean(this.instance?.get(type));}
 snapshot(){return {states:Object.fromEntries(this.states),live:this.instance?Object.fromEntries(this.instance):null};}
}

// Unity 4 directional shadow map size (manual: Shadow Size Details). resolution: 0 Low, 1 Medium, 2 High, 3 Very High.
export function nextPowerOfTwo(x){return 2**Math.ceil(Math.log2(Math.max(1,x)));}
export function shadowMapSize(resolution,width,height,{cap=4096}={}){const high=Math.min(cap,nextPowerOfTwo(Math.max(width,height)*1.9));
 return Math.max(64,Math.min(cap,[high/4,high/2,high,high*2][Math.max(0,Math.min(3,resolution|0))]));}
// Cascades share the one shadow map: two or four cascades each get half its width (2x2 / side-by-side tiles).
export function cascadeMapSize(size,cascades){return cascades>1?size/2:size;}
// Unity 4 cascade split fractions of the shadow distance (Stable Fit).
export const CASCADE_SPLITS=Object.freeze({1:Object.freeze([1]),2:Object.freeze([1/3,1]),4:Object.freeze([1/15,3/15,7/15,1])});
export function cascadeRanges(count,distance,near){const s=CASCADE_SPLITS[count]??CASCADE_SPLITS[1];let n=near;return s.map(f=>{const r=[n,f*distance];n=f*distance;return r;});}
// Smallest sphere around the view-frustum slice [n, f] (symmetric frustum; k = tan^2(fovX/2) + tan^2(fovY/2)): the
// centre lies on the view axis at distance c, clamped to the slice. Returns {center (distance along the view axis), radius}.
export function frustumSliceSphere(n,f,tanHalfY,aspect){const tanHalfX=tanHalfY*aspect,k=tanHalfX*tanHalfX+tanHalfY*tanHalfY;
 const c=Math.min(f,Math.max(n,(1+k)*(f+n)/2)),r2=x=>(x-c)**2+x*x*k;return {center:c,radius:Math.sqrt(Math.max(r2(n),r2(f)))};}
// Fade over the last tenth of the shadow distance: saturate(d * z + w) is added to the shadow term (1 = unshadowed).
export function shadowFade(distance){return {scale:10/distance,bias:-9};}
export function shadowFadeAt(d,distance){const {scale,bias}=shadowFade(distance);return Math.min(1,Math.max(0,d*scale+bias));}

// The effective state of one quality level (what the port can apply; see README of each field in the comments).
export function effectiveQuality(index,{settings=SHIPPED_QUALITY,sunShadows=SHIPPED_SUN_SHADOWS,shadowStrength=1,width=1280,height=720,maxTextureSize=4096}={}){
 const i=Math.max(0,Math.min(settings.length-1,index|0)),s=settings[i];
 // Light shadow type: TOD_Sky sets Soft while shadowStrength != 0; QualitySettings 0 Disable, 1 Hard Only, 2 All.
 const lightType=shadowStrength!==0?2:0,type=Math.min(s.shadows,lightType);
 const size=shadowMapSize(sunShadows.m_Resolution>=0?sunShadows.m_Resolution:s.shadowResolution,width,height,{cap:Math.min(4096,maxTextureSize)});
 return {index:i,name:s.name,level:qualityLevel(i,settings.length),
  pixelLightCount:s.pixelLightCount,
  shadows:{type:['none','hard','soft'][type],distance:s.shadowDistance,cascades:s.shadowCascades,resolution:s.shadowResolution,projection:s.shadowProjection===1?'StableFit':'CloseFit',
   mapSize:size,cascadeMapSize:cascadeMapSize(size,s.shadowCascades),strength:shadowStrength*(sunShadows.m_Strength??1),bias:sunShadows.m_Bias,softness:sunShadows.m_Softness,softnessFade:sunShadows.m_SoftnessFade},
  // QualitySettings.masterTextureLimit: mip levels dropped from every mipmapped texture (0 full, 1 half, 2 quarter).
  textureLimit:s.textureQuality,anisotropic:s.anisotropicTextures>0,antiAliasing:s.antiAliasing,
  softParticles:Boolean(s.softParticles),softVegetation:Boolean(s.softVegetation),blendWeights:s.blendWeights,lodBias:s.lodBias,maximumLODLevel:s.maximumLODLevel};
}

// Soft shadows: Unity 4 blurs the collected screen-space shadow (Shadow-ScreenBlur, 8 taps scaled by the light's
// softness and depth); the port filters in the shadow map instead with a PCF radius in texels (approximation).
export function softShadowRadius(softness){return Math.max(1,softness*0.5);}

// LocalRadiationEffect.Update: NoiseAndGrain.intensityMultiplier = 10 * Radiation.GetRadExposureScalar(exposure with armour).
export function grainIntensityMultiplier(exposure){return 10*Math.min(1,Math.max(0,(Number(exposure)||0)/1000));}

// QualitySettings.anisotropicTextures: Disable (Fastest..Simple) turns anisotropic filtering off everywhere; Enable
// (Good..Fantastic) uses each texture's own m_Aniso (exported per texture path ID; most original textures are 1).
// Loaders register textures by exported file name (texture-<pathID>.png); applyAnisotropy re-uploads changed ones.
const anisoState={enabled:false,levels:{},max:16,textures:new Set()};
export function textureAnisoLevel(file,levels=anisoState.levels){const m=/texture-(-?\d+)\.png$/.exec(String(file??''));return m?Math.max(1,levels[m[1]]??1):1;}
export function anisotropyFor(level,enabled,max=16){return enabled?Math.max(1,Math.min(max,level)):1;}
export function setTextureAnisoLevels(levels,max){anisoState.levels=levels??{};if(max)anisoState.max=max;for(const e of anisoState.textures)e.level=textureAnisoLevel(e.file);}
// Loaders register a texture once it is final (colour space, wrap, flipY set); listeners see each one (main.mjs uploads
// them while the join waits on other work).
const registered=new Set();export function onTextureRegistered(fn){registered.add(fn);return ()=>registered.delete(fn);}
export function registerTexture(texture,file){const e={texture,file,level:textureAnisoLevel(file)};anisoState.textures.add(e);texture.anisotropy=anisotropyFor(e.level,anisoState.enabled,anisoState.max);for(const fn of registered)fn(texture,file);return texture;}
export function applyAnisotropy(enabled,max=anisoState.max){anisoState.enabled=Boolean(enabled);anisoState.max=max;let changed=0;
 for(const {texture,level} of anisoState.textures){const a=anisotropyFor(level,anisoState.enabled,max);if(texture.anisotropy!==a){texture.anisotropy=a;texture.needsUpdate=true;changed++;}}return changed;}
export function anisotropyState(){let on=0;for(const {texture} of anisoState.textures)if(texture.anisotropy>1)on++;return {enabled:anisoState.enabled,registered:anisoState.textures.size,anisotropic:on};}

// Browser canvas resolution per level. The original renders at the window's resolution at every level (QualitySettings
// has no resolution field); the port keeps HiDPI upscaling (up to 1.5) for Good and above only, so the lowest levels
// render one pixel per CSS pixel. Texture resolution now follows textureLimit like the original.
export function pixelRatioForQuality(index,devicePixelRatio=1){return Math.min(devicePixelRatio,index>=3?1.5:1);}
