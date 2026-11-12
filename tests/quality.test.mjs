import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import * as THREE from 'three';
import {SHIPPED_QUALITY,DEFAULT_QUALITY_INDEX,QUALITY_NAMES,qualityIndex,qualityLevel,renderUpdateGfx,ImageEffectManager,SCENE_CAMERA_BEHAVIOURS,GFX_EFFECTS,shadowMapSize,
 cascadeMapSize,cascadeRanges,frustumSliceSphere,shadowFadeAt,effectiveQuality,grainIntensityMultiplier,pixelRatioForQuality,textureAnisoLevel,anisotropyFor,
 registerTexture,applyAnisotropy,setTextureAnisoLevels,softShadowRadius} from '../browser/quality.mjs';
import {shaftsSize,shaftsBlurRadii,shaftsSunColor,bloomBlurOffsets,bloomMode,grainUniforms,grainReference,SHIPPED_POST,POST_ORDER} from '../browser/post-chain.mjs';
import {limitBlendWeights,limitedLod,leafShadowTerm,LegacyMaterial,createLegacyMaterial} from '../browser/legacy-materials.mjs';
import {defaultShadowFlags,applyShadowFlags,SUN_SHADOW_GLSL} from '../browser/sun-shadows.mjs';
import {ConVars} from '../browser/convars.mjs';
import {present} from './helpers/assets.mjs';

const manifestPath=new URL('../browser/assets/recovered/quality/manifest.json',import.meta.url);
const manifest=present(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);

test('the export matches the shipped QualitySettings table, default level and camera components',{skip:!manifest&&'run tools/export_quality.py'},()=>{
 assert.equal(manifest.defaultQuality,DEFAULT_QUALITY_INDEX);assert.deepEqual(manifest.qualityNames,QUALITY_NAMES);
 for(const [i,q] of manifest.qualitySettings.entries())for(const [k,v] of Object.entries(SHIPPED_QUALITY[i]))assert.equal(q[k],v,`${q.name}.${k}`);
 assert.deepEqual(manifest.camera.monoBehaviourOrder,SCENE_CAMERA_BEHAVIOURS.map(b=>b.type));
 for(const b of SCENE_CAMERA_BEHAVIOURS)assert.equal(manifest.camera.components.find(c=>c.type===b.type).enabled,b.enabled,b.type);
 assert.ok(!manifest.camera.components.some(c=>c.type==='SSAOEffect'||c.type==='Tonemapping'),'no SSAO/Tonemapping on the in-game camera');
 assert.equal(manifest.camera.hdr,true);assert.equal(manifest.camera.renderingPath,2);assert.equal(manifest.source.prefabMatchesScene,true);
 const shafts=manifest.camera.components.find(c=>c.type==='TOD_SunShafts').params;for(const k of Object.keys(SHIPPED_POST.sunShafts))close(shafts[k],SHIPPED_POST.sunShafts[k]);
 const bloom=manifest.camera.components.find(c=>c.type==='Bloom').params;for(const k of ['bloomIntensity','bloomThreshhold','sepBlurSpread','bloomBlurIterations','quality','hdr','screenBlendMode','lensflareIntensity'])close(bloom[k],SHIPPED_POST.bloom[k]);
 const grain=manifest.camera.components.find(c=>c.type==='NoiseAndGrain').params;assert.equal(grain.intensityMultiplier,0);close(grain.generalIntensity,0.1);
 assert.equal(manifest.sunLight.shadows.m_Type,2);close(manifest.sunLight.shadows.m_Bias,0.25);assert.deepEqual(manifest.sunLight.excludedLayers,[8,9,26,31]);
 assert.equal(manifest.shadowFlags.terrainCastShadows,false);assert.equal(manifest.todShadowStrength.day,1);assert.equal(manifest.todShadowStrength.night,1);
 const road=Object.values(manifest.shadowFlags.scene).find(f=>f.name==='road');assert.deepEqual([road.cast,road.receive],[false,true]);
});

test('render.level maps to the six levels with RoundToInt, and back',()=>{
 assert.deepEqual([0,0.1,0.2,0.3,0.5,0.7,0.9,1].map(v=>qualityIndex(v)),[0,0,1,2,2,4,4,5]);
 for(let i=0;i<6;i++)assert.equal(qualityIndex(qualityLevel(i)),i);
});

test('render.update writes the gfx switch only when the level differs from the backup',()=>{
 assert.equal(renderUpdateGfx(2,2),null);
 for(const i of [0,1,2])assert.deepEqual(renderUpdateGfx(i,-1),{'gfx.ssaa':false,'gfx.bloom':false,'gfx.ssao':false,'gfx.tonemap':false,'gfx.shafts':false});
 assert.deepEqual(renderUpdateGfx(3,5),{'gfx.ssaa':false,'gfx.bloom':false,'gfx.ssao':false,'gfx.tonemap':false,'gfx.shafts':true});
 assert.deepEqual(renderUpdateGfx(4,0),{},'Beautiful leaves the effects as they were');
 assert.deepEqual(Object.values(renderUpdateGfx(5,0)),[true,true,true,true,true]);
 assert.equal(renderUpdateGfx(0,0)?.['gfx.grain'],undefined);assert.ok(!('gfx.grain' in renderUpdateGfx(5,0))&&!('gfx.damage' in renderUpdateGfx(5,0)),'grain/damage are never switched');
});

test('ImageEffectManager: states default on, Start stops at the disabled Bloom, live toggles reach the camera',()=>{
 const m=new ImageEffectManager();assert.equal(m.getEnabled('Bloom'),true);assert.equal(m.active('TOD_SunShafts'),false,'no camera yet');
 for(const t of Object.values(GFX_EFFECTS))m.setEnabled(t,true);m.setEnabled('TOD_SunShafts',false);m.setEnabled('GameFullscreen',false);
 m.start();assert.equal(m.active('TOD_SunShafts'),false,'state applied before the break');assert.equal(m.active('AntialiasingAsPostEffect'),true);
 assert.equal(m.active('Bloom'),false,'serialized disabled Bloom ends the loop');assert.equal(m.active('GameFullscreen'),true,'after the break: serialized flag');
 assert.equal(m.active('SSAOEffect'),false);assert.equal(m.active('Tonemapping'),false);m.setEnabled('SSAOEffect',true);assert.equal(m.active('SSAOEffect'),false,'not a camera component');
 m.setEnabled('Bloom',true);assert.equal(m.active('Bloom'),true,'gfx.bloom while in game enables the component');assert.equal(m.getEnabled('GameFullscreen'),false);
 const fresh=new ImageEffectManager().start();assert.equal(fresh.active('TOD_SunShafts'),true);assert.equal(fresh.active('Bloom'),false);
});

test('Unity 4 directional shadow map sizes and Stable Fit cascades',()=>{
 assert.equal(shadowMapSize(2,1280,720),4096);assert.equal(shadowMapSize(1,1280,720),2048);assert.equal(shadowMapSize(0,1280,720),1024);assert.equal(shadowMapSize(3,1280,720),4096);
 assert.equal(shadowMapSize(2,800,600),2048);assert.equal(shadowMapSize(3,800,600),4096);assert.equal(shadowMapSize(2,1280,720,{cap:2048}),2048);
 assert.equal(cascadeMapSize(4096,4),2048);assert.equal(cascadeMapSize(2048,1),2048);
 assert.deepEqual(cascadeRanges(1,100,0.05),[[0.05,100]]);
 const four=cascadeRanges(4,250,0.05);assert.equal(four.length,4);close(four[0][1],250/15);close(four[1][1],50);close(four[2][1],250*7/15);close(four[3][1],250);close(four[1][0],four[0][1]);
 // The sphere encloses all eight slice corners.
 const tanY=Math.tan(60/2*Math.PI/180),aspect=16/9;for(const [n,f] of four){const s=frustumSliceSphere(n,f,tanY,aspect);
  for(const z of [n,f])for(const sx of [-1,1])for(const sy of [-1,1]){const x=sx*z*tanY*aspect,y=sy*z*tanY;assert.ok(Math.hypot(x,y,z-s.center)<=s.radius+1e-9);}}
 assert.equal(shadowFadeAt(80,100),0);close(shadowFadeAt(95,100),0.5);assert.equal(shadowFadeAt(100,100),1);
});

test('effective settings per level follow QualitySettings',()=>{
 const e=SHIPPED_QUALITY.map((_,i)=>effectiveQuality(i,{width:1280,height:720}));
 assert.deepEqual(e.map(x=>x.shadows.type),['none','hard','soft','soft','soft','soft']);
 assert.deepEqual(e.map(x=>x.shadows.distance),[15,20,20,100,150,250]);assert.deepEqual(e.map(x=>x.shadows.cascades),[1,1,1,1,2,4]);
 assert.deepEqual(e.map(x=>x.shadows.cascadeMapSize),[1024,1024,1024,2048,2048,2048]);
 assert.deepEqual(e.map(x=>x.textureLimit),[2,1,1,0,0,0]);assert.deepEqual(e.map(x=>x.anisotropic),[false,false,false,true,true,true]);
 assert.deepEqual(e.map(x=>x.blendWeights),[1,1,1,2,4,4]);assert.deepEqual(e.map(x=>x.softVegetation),[false,false,false,true,true,true]);
 assert.ok(e.every(x=>x.antiAliasing===0));assert.equal(effectiveQuality(5,{shadowStrength:0}).shadows.type,'none','no shadows without shadow strength');
 assert.ok(softShadowRadius(4.94)>1);
});

test('radiation grain, canvas pixel ratio and texture anisotropy',()=>{
 assert.equal(grainIntensityMultiplier(0),0);assert.equal(grainIntensityMultiplier(500),5);assert.equal(grainIntensityMultiplier(5000),10);
 assert.equal(pixelRatioForQuality(0,2),1);assert.equal(pixelRatioForQuality(3,2),1.5);assert.equal(pixelRatioForQuality(5,1),1);
 const levels={'1755570237':9,'-993076511':4};assert.equal(textureAnisoLevel('texture-1755570237.png',levels),9);assert.equal(textureAnisoLevel('scene/texture--993076511.png',levels),4);assert.equal(textureAnisoLevel('texture-5.png',levels),1);
 assert.equal(anisotropyFor(9,false),1);assert.equal(anisotropyFor(9,true,8),8);
 setTextureAnisoLevels(levels,16);const t={anisotropy:1,needsUpdate:false},u={anisotropy:1,needsUpdate:false};registerTexture(t,'texture-1755570237.png');registerTexture(u,'texture-42.png');
 assert.equal(applyAnisotropy(true,16),1);assert.equal(t.anisotropy,9);assert.equal(t.needsUpdate,true);assert.equal(u.anisotropy,1);
 t.needsUpdate=false;assert.equal(applyAnisotropy(true,16),0);assert.equal(t.needsUpdate,false,'no re-upload without a change');assert.equal(applyAnisotropy(false),1);assert.equal(t.anisotropy,1);
});

test('post-effect parameters follow the decompiled image effects',()=>{
 assert.deepEqual(POST_ORDER,['TOD_SunShafts','AntialiasingAsPostEffect','NoiseAndGrain','Bloom','GameFullscreen']);
 assert.deepEqual(shaftsSize(1,1280,720),[640,360]);assert.deepEqual(shaftsSize(0,1280,720),[320,180]);
 const r=shaftsBlurRadii(2.5,2);assert.equal(r.length,4);close(r[0],2.5*0.0013020834);close(r[1],2.5*6/768);close(r[2],2.5*12/768);close(r[3],2.5*18/768);
 assert.deepEqual(shaftsSunColor(-0.1,0,1.5,[1,1,1,1]),[0,0,0,0]);assert.deepEqual(shaftsSunColor(0.5,0.2,1.5,[1,0.5,0,1]).map(v=>+v.toFixed(6)),[1.2,0.6,0,1.2]);
 const o=bloomBlurOffsets(1,2.5,16/9);close(o.vertical[1],1.25*2.5*2/1024);close(o.horizontal[0],1.25*2.5/(16/9)*2/1024);
 assert.deepEqual(bloomMode(SHIPPED_POST.bloom,true),{hdr:true,blend:1});assert.deepEqual(bloomMode(SHIPPED_POST.bloom,false),{hdr:false,blend:1});
 // Zero intensity (the shipped multiplier without radiation) leaves the image unchanged (clamped).
 const g0=grainUniforms(SHIPPED_POST.noiseAndGrain,0);for(const src of [[0.1,0.5,0.9],[0.3,0.7,0.49]])for(const n of [[0,1,0.5],[0.9,0.1,0.3]])grainReference(src,n,g0).forEach((v,i)=>close(v,src[i]));
 const g=grainUniforms(SHIPPED_POST.noiseAndGrain,10);assert.ok(Math.abs(grainReference([0.5,0.5,0.5],[1,1,1],g)[0]-0.5)>0.05,'radiation grain is visible');
 assert.deepEqual(g.tiling,[24,28,32]);close(g.midGrey[1],1/0.8);close(g.midGrey[2],-5);
});

test('quality-driven shading helpers: blend weights, texture limit, leaf shadow',()=>{
 assert.deepEqual(limitBlendWeights([0.5,0.3,0.15,0.05],4),[0.5,0.3,0.15,0.05]);
 assert.deepEqual(limitBlendWeights([0.5,0.3,0.15,0.05],1),[1,0,0,0]);
 limitBlendWeights([0.3,0.5,0.05,0.15],2).forEach((v,i)=>close(v,[0.375,0.625,0,0][i]));
 assert.equal(limitedLod(-1,2),2);assert.equal(limitedLod(3,2),3);assert.equal(limitedLod(-1,0),-1);
 assert.equal(leafShadowTerm(1,1),1);assert.equal(leafShadowTerm(0,1),0);assert.equal(leafShadowTerm(0,0.5),0.5);
 assert.match(SUN_SHADOW_GLSL,/legacyShadowSpheres/);assert.match(SUN_SHADOW_GLSL,/LEGACY_FIRST_SUN NUM_DIR_LIGHT_SHADOWS/);
});

test('renderer shadow flags: opaque legacy surfaces cast and receive, blended neither, terrain and trees only receive',async()=>{
 const tex=async()=>new THREE.Texture();
 const opaque=await createLegacyMaterial({name:'t',shader:'Diffuse'},tex),blend=await createLegacyMaterial({name:'t',shader:'Transparent/Diffuse'},tex),cut=await createLegacyMaterial({name:'t',shader:'Transparent/Cutout/Diffuse',floats:{_Cutoff:0.3}},tex);
 const leaf=await createLegacyMaterial({name:'t',shader:'Hidden/Nature/Tree Creator Leaves Fast Optimized'},tex),vm=await createLegacyMaterial({name:'t',shader:'View Model/Unlit'},tex);
 assert.deepEqual(defaultShadowFlags(opaque),{cast:true,receive:true});assert.deepEqual(defaultShadowFlags(blend),{cast:false,receive:false});
 assert.deepEqual(defaultShadowFlags(leaf),{cast:false,receive:true});assert.deepEqual(defaultShadowFlags(vm),{cast:false,receive:true});
 assert.equal(defaultShadowFlags(new THREE.MeshBasicMaterial()),null);assert.deepEqual(defaultShadowFlags([opaque,blend]),{cast:false,receive:false});
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(),cut);applyShadowFlags(mesh,defaultShadowFlags(cut));assert.equal(mesh.castShadow,true);assert.ok(mesh.customDepthMaterial?.isMeshDepthMaterial,'cutout casters clip in the depth pass');
 assert.equal(mesh.userData.shadowFlags.source,'set');assert.equal(mesh.userData.shadowFlags.material,cut);assert.ok(cut instanceof LegacyMaterial);
});

test('gfx convars are saved console variables that default to the shipped client.cfg values',()=>{
 const c=new ConVars();for(const name of Object.keys(GFX_EFFECTS))assert.equal(c.get(name),true,name);
 assert.equal(c.command('gfx.bloom false').ok,true);assert.equal(c.get('gfx.bloom'),false);assert.equal(c.command('gfx.bloom').text,'gfx.bloom: False');
});
