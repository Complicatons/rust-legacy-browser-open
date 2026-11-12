import * as THREE from 'three';
import {effectiveQuality,qualityIndex,renderUpdateGfx,ImageEffectManager,GFX_EFFECTS,SHIPPED_QUALITY,SHIPPED_SUN_SHADOWS,pixelRatioForQuality,grainIntensityMultiplier,
 applyAnisotropy,setTextureAnisoLevels,anisotropyState} from './quality.mjs';
import {createSunShadows,defaultShadowFlags,applyShadowFlags} from './sun-shadows.mjs';
import {createPostChain,SHIPPED_POST} from './post-chain.mjs';
import {createSoftParticles} from './soft-particles.mjs';
import {LEGACY_GLOBAL_UNIFORMS} from './legacy-materials.mjs';

// Ties Render Quality (render.level) and the gfx.* image effects to the renderer: QualitySettings level -> sun shadows,
// texture limit, anisotropy, skin weights, pixel ratio (browser/quality.mjs); render.update's gfx switch with its
// PlayerPrefs backup; ImageEffectManager states/start; the post chain. Water (WaterSettings) and grass (SoftVegetation)
// follow render.level themselves. manifest: quality/manifest.json (tools/export_quality.py) or null for the shipped tables.
const BACKUP_KEY='rlb-quality-backup'; // PlayerPrefs "UnityGraphicsQualityBackup"
export async function createQualityController({renderer,scene,sun,convars,manifest=null,base='/assets/recovered/quality/',storage=null,devicePixelRatio=1,devMode=false}){
 const settings=manifest?.qualitySettings?.length===6?manifest.qualitySettings:SHIPPED_QUALITY,sunShadows=manifest?.sunLight?.shadows??SHIPPED_SUN_SHADOWS;
 const behaviours=manifest?.camera?.monoBehaviourOrder?.map(type=>({type,enabled:manifest.camera.components.find(c=>c.type===type)?.enabled!==false}));
 const param=(type,fallback)=>{const c=manifest?.camera?.components?.find(x=>x.type===type);if(!c)return fallback;const out={...fallback};for(const k of Object.keys(fallback))if(c.params[k]!==undefined)out[k]=c.params[k];return out;};
 const post=createPostChain({renderer,cameraHdr:manifest?.camera?.hdr??true,unityFar:manifest?.camera?.far??6000,
  noiseTexture:manifest?.noiseTexture?await new THREE.TextureLoader().loadAsync(base+manifest.noiseTexture.file).catch(()=>null):null,
  params:{sunShafts:param('TOD_SunShafts',SHIPPED_POST.sunShafts),antialiasing:param('AntialiasingAsPostEffect',SHIPPED_POST.antialiasing),noiseAndGrain:param('NoiseAndGrain',SHIPPED_POST.noiseAndGrain),bloom:param('Bloom',SHIPPED_POST.bloom)}});
 const soft=createSoftParticles({renderer,scene,post}); // QualitySettings.softParticles (browser/soft-particles.mjs)
 const shadows=createSunShadows({renderer,scene,sun}),effects=new ImageEffectManager(behaviours?.length?behaviours:undefined);
 const maxAniso=renderer.capabilities.getMaxAnisotropy(),maxTexture=renderer.capabilities.maxTextureSize;setTextureAnisoLevels(manifest?.textureAniso?.levels??{},maxAniso);
 // gfx.* values are ImageEffectManager states (config load sets every one of them in the shipped client.cfg).
 for(const [name,type] of Object.entries(GFX_EFFECTS))effects.setEnabled(type,convars.get(name)!==false);
 let current=null,eff=null,sweepAt=0,lastSize='',warmCamera=null,warmups=0;const flagCounts={casters:0,receivers:0};
 const readBackup=()=>{try{const v=storage?.getItem(BACKUP_KEY);return v==null?-1:Number(v);}catch{return -1;}};
 const writeBackup=i=>{try{storage?.setItem(BACKUP_KEY,String(i));}catch{}};
 // render.update(): the gfx switch when the level differs from the backup (convars.set fires the gfx listeners below).
 function renderUpdate(index){const gfx=renderUpdateGfx(index,readBackup());if(gfx===null)return false;writeBackup(index);for(const [k,v] of Object.entries(gfx))convars.set(k,v?'True':'False');convars.save?.();return true;}
 function applyLevel(index,{force=false}={}){if(index===current&&!force)return;current=index;
  // Pixel ratio first: the shadow map size follows the drawing buffer.
  if(!devMode){renderer.setPixelRatio(pixelRatioForQuality(index,devicePixelRatio));renderer.setSize(innerWidth,innerHeight);}
  const size=renderer.getDrawingBufferSize(new THREE.Vector2());lastSize=`${size.x}x${size.y}`;
  eff=effectiveQuality(index,{settings,sunShadows,shadowStrength:1,width:size.x,height:size.y,maxTextureSize:maxTexture});
  shadows.setQuality(eff.shadows);soft.setEnabled(eff.softParticles);LEGACY_GLOBAL_UNIFORMS.legacyTextureLimit.value=eff.textureLimit;LEGACY_GLOBAL_UNIFORMS.legacyBlendWeights.value=eff.blendWeights;
  applyAnisotropy(eff.anisotropic,maxAniso);sweep(true);syncEffects();
  // A level change changes the light/shadow program variants: compile every world object's program now (in parallel
  // where KHR_parallel_shader_compile exists) instead of stalling later frames when objects first come into view.
  if(warmCamera)renderer.compileAsync(scene,warmCamera).then(()=>{warmups++;},e=>console.warn('Quality warm-up skipped',e));}
 function syncEffects(){post.setEffects({shafts:effects.active('TOD_SunShafts'),fxaa:effects.active('AntialiasingAsPostEffect'),grain:effects.active('NoiseAndGrain'),bloom:effects.active('Bloom')});}
 // Original renderer flags: most renderers cast and receive; alpha-blended (forward) ones neither. Scene instances carry
 // their exported exceptions; terrain, trees and grass set theirs explicitly (userData.shadowFlags).
 function sweep(force=false){const now=performance.now();if(!force&&now-sweepAt<1000)return;sweepAt=now;
  let casters=0,receivers=0;scene.traverse(o=>{if(!o.isMesh)return;const sf=o.userData.shadowFlags;if(!sf||(sf.source==='default'&&sf.material!==o.material)){const f=defaultShadowFlags(o.material);if(f)applyShadowFlags(o,f,'default');else if(sf){o.castShadow=o.receiveShadow=false;o.userData.shadowFlags=null;}}if(o.castShadow)casters++;if(o.receiveShadow)receivers++;});
  flagCounts.casters=casters;flagCounts.receivers=receivers;}
 convars.addEventListener('change',e=>{
  if(e.name==='render.level'){const i=qualityIndex(e.value);renderUpdate(i);applyLevel(i);}
  else if(GFX_EFFECTS[e.name]){effects.setEnabled(GFX_EFFECTS[e.name],e.value);syncEffects();}});
 // Startup: client.cfg's render.frames line runs render.update() once with the starting level.
 const startIndex=qualityIndex(convars.get('render.level'));renderUpdate(startIndex);applyLevel(startIndex,{force:true});
 const viewport=new THREE.Vector3(),toSun=new THREE.Vector3(),fwd=new THREE.Vector3(),bufferSize=new THREE.Vector2();
 // The Scene Camera is part of the level scene: ImageEffectManager.Start runs once the level has loaded.
 effects.start();syncEffects();
 return {shadows,post,effects,soft,
  get effective(){return eff;},
  // The Scene Camera exists (level loaded): ImageEffectManager.Start.
  start(){effects.start();syncEffects();},
  stop(){effects.stop();syncEffects();},
  // Per frame before the world render. tod: TimeOfDay (sunDirection Unity space, sunShaftColor, p.Atmosphere.Fogginess);
  // radiation: exposure with armour (LocalRadiationEffect).
  frame(camera,{tod=null,radiation=0}={}){warmCamera=camera;
   // Unity sizes directional shadow maps from the screen: recompute them when the drawing buffer changes.
  const v=renderer.getDrawingBufferSize(bufferSize),key=`${v.x}x${v.y}`;
  if(key!==lastSize){lastSize=key;eff=effectiveQuality(current,{settings,sunShadows,shadowStrength:1,width:v.x,height:v.y,maxTextureSize:maxTexture});shadows.setQuality(eff.shadows);}
   sweep();shadows.update(camera);post.setGrainMultiplier(grainIntensityMultiplier(radiation));
   if(tod?.sunDirection){const d=tod.sunDirection;toSun.set(d.x,d.y,-d.z).normalize();camera.getWorldDirection(fwd);
    viewport.copy(camera.position).addScaledVector(toSun,1000).project(camera);
    post.setSun({viewport:viewport.set(viewport.x*0.5+0.5,viewport.y*0.5+0.5,toSun.dot(fwd)),fogginess:tod.p?.Atmosphere?.Fogginess??0,
     color:tod.sunShaftColor?[tod.sunShaftColor.r,tod.sunShaftColor.g,tod.sunShaftColor.b,1]:[1,1,1,1]});}},
  // Renders the frame: world (into the HDR target when an image effect runs), view models, then the effects.
  render(camera,drawWorld,drawViewModels){post.begin();soft.beginWorld();try{drawWorld();post.afterWorld(camera);drawViewModels?.();}finally{soft.endFrame();}post.finish();},
  state:()=>({level:convars.get('render.level'),index:current,name:eff?.name,effective:eff,shadows:shadows.state(),post:post.state(),softParticles:soft.state(),imageEffects:effects.snapshot(),
   textureLimit:LEGACY_GLOBAL_UNIFORMS.legacyTextureLimit.value,blendWeights:LEGACY_GLOBAL_UNIFORMS.legacyBlendWeights.value,anisotropy:anisotropyState(),pixelRatio:renderer.getPixelRatio(),backup:readBackup(),flags:{...flagCounts},warmups})};
}
