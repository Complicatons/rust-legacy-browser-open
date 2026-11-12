import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import * as THREE from 'three';
import {unpackNormalDXT5nm,luminance,LUMINANCE,lightAttenuation,ATTEN_FADE_START,overlayBlend,deferredLight,deferredFinal,leafVertexLight,
 legacyShaderModel,legacyDefines,createLegacyMaterial,terrainAlbedo,LEGACY_SHADERS,LegacyMaterial,legacyTreeVariant,legacyTextureSlots} from '../browser/legacy-materials.mjs';
import {needsAssets} from './helpers/assets.mjs';
// scene.mjs imports three from /vendor (browser path); read its engine-material list from the source instead.
const engineMaterials=new Set(JSON.parse(readFileSync('browser/scene.mjs','utf8').match(/engineMaterials=new Set\((\[[^\]]*\])\)/)[1].replace(/'/g,'"')));

const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const closeV=(a,b,e=1e-6)=>a.forEach((v,i)=>close(v,b[i],e));

test('UnpackNormalDXT5nm takes x from alpha and y from green, z from the unit length', ()=>{
 closeV(unpackNormalDXT5nm([1,0.5,1,0.5]),[0,0,1]);
 closeV(unpackNormalDXT5nm([0,1,0,0.5]),[0,1,0]);           // red/blue ignored (Unity copies y into rgb)
 closeV(unpackNormalDXT5nm([0.3,0.5,0.3,1]),[1,0,0]);
 // saturate(x^2 + y^2): out-of-range packed values (e.g. ocean areas of the baked rock normal map) give z = 0, not NaN.
 const n=unpackNormalDXT5nm([0,0,0,0]);closeV(n,[-1,-1,0]);
 const k=unpackNormalDXT5nm([0,0.8,0,0.25]);close(Math.hypot(...k),1,1e-9);
});

test('deferred light buffer uses the compiled Luminance weights and saturated attenuation for spec only', ()=>{
 assert.deepEqual([...LUMINANCE],[0.2199707,0.70703125,0.070983887]);close(luminance([1,1,1]),0.998,1e-3);
 const up=[0,1,0],C=[2,2,2];
 const l=deferredLight({normal:up,toLight:up,toView:up,lightColor:C,atten:1,shininess:0.5});
 closeV(l.rgb,[2,2,2]);close(l.a,luminance(C));
 // Light below the surface: no diffuse, but the pre-pass still adds spec where N.H > 0 (no N.L gate in the program).
 const s=Math.SQRT1_2,grazing=deferredLight({normal:up,toLight:[1,-0.01,0].map(v=>v/Math.hypot(1,0.01)),toView:[-s,s,0],lightColor:C,atten:1,shininess:0.03});
 closeV(grazing.rgb,[0,0,0]);assert.ok(grazing.a>0);
 const strong=deferredLight({normal:up,toLight:up,toView:up,lightColor:C,atten:3,shininess:1});closeV(strong.rgb,[6,6,6]);close(strong.a,luminance(C)); // spec * saturate(atten)
});

test('PrePassFinal: Lambert ignores light.a, BlinnPhong spec colour includes the SH term', ()=>{
 const light={rgb:[0.5,0.5,0.5],a:0.25},ambient=[0.25,0.25,0.25],albedo=[0.4,0.3,0.2];
 closeV(deferredFinal({albedo,light,ambient}),[0.3,0.225,0.15]);
 const spec=deferredFinal({albedo,light,ambient,specColor:[0.5,0.5,0.5],gloss:0.8,spec:true});
 closeV(spec,albedo.map(a=>a*0.75+0.75*0.5*0.25*0.8));
});

test('point light attenuation follows 1/(1 + 25 t) and reaches zero at the range', ()=>{
 close(lightAttenuation(0),1);close(lightAttenuation(0.04),0.5);assert.equal(lightAttenuation(1),0);assert.equal(lightAttenuation(2),0);
 let prev=Infinity;for(let t=0;t<=1;t+=0.01){const a=lightAttenuation(t);assert.ok(a<=prev+1e-12);prev=a;}
 close(lightAttenuation(ATTEN_FADE_START-1e-9),lightAttenuation(ATTEN_FADE_START+1e-9),1e-6);
});

test('Enviro overlay blend picks screen only when under > 0.5 (compiled CMP on -(under - 0.5))', ()=>{
 close(overlayBlend(0.5,0.5),0.5);close(overlayBlend(0.2,0.5),0.2);close(overlayBlend(0.2,0.5000001),1-2*0.8*0.4999999);
 close(overlayBlend(1,0.25),0.5);close(overlayBlend(0,0.75),0.5);
});

test('Leaves Fast Optimized vertex lighting: wrap diffuse, translucency, emphasised AO and 0.25 ambient', ()=>{
 const base={normal:[0,1,0],toLight:[0,1,0],toView:[0,1,0],lightColor:[1,1,1],ambientFront:[0.5,0.5,0.5],ambientBack:[0.5,0.5,0.5],color:[1,1,1],ao:0.9,translucencyColor:[0.6,0.7,0.4],viewDependency:0.5};
 const aoE=Math.min(1,Math.pow(0.9+0.0999756,3));
 // Front lit: nl 1 -> wrap 1, back 0; view facing the light -> viewBack 0 -> ambient back weight lerp(1,0,0.5)=0.5.
 closeV(leafVertexLight(base),[0.6,0.7,0.4].map(t=>(0.25*(0.5+0.5*0.5*t)+1)*aoE));
 // Lit from behind, viewed against the light: translucency term lerp(saturate(-nl)=1, viewBack=1, vd) = 1.
 const back=leafVertexLight({...base,toLight:[0,-1,0],toView:[0,1,0],ao:0});
 const ao0=Math.pow(0.0999756,3);closeV(back,[0.6,0.7,0.4].map(t=>(0.25*(0.5+0.5*1*t)+t)*ao0)); // wrap max(0, -0.6 + 0.4) = 0
});

test('shader catalogue: every material shader in the exports is ported, engine-drawn or an explicit fallback', ()=>{
 const base='browser/assets/recovered/';
 // Custom/OutlineHover: placement-preview.mjs createOutlineHoverMaterial (scene.mjs routes world meshes such as UberWorldArrow to it).
 const handledElsewhere=/^(Particles\/|View Model\/Particles|FX\/|Effects\/|Context\/Sprite|Time of Day\/|Utility\/WriteZ|Custom\/OutlineHover$)/;
 const counts={};
 for(const dir of ['scene','deployables','loot','resources','animals','players','viewmodels','item-mods','menu-background']){
  const f=base+dir+'/manifest.json';if(!existsSync(f))continue;const m=JSON.parse(readFileSync(f,'utf8'));
  for(const mat of Object.values(m.materials)){const s=mat.shader;counts[s]=(counts[s]??0)+1;
   if(engineMaterials.has(mat.name)||handledElsewhere.test(s??''))continue;
   assert.ok(s,`${dir}/${mat.name} has no shader name (run tools/export_material_shaders.py)`);
   assert.ok(LEGACY_SHADERS.includes(s),`${dir}/${mat.name}: ${s} not ported`);}
 }
 if(existsSync(base+'world-materials.json')){const w=JSON.parse(readFileSync(base+'world-materials.json','utf8'));
  for(const t of w.trees)for(const p of t.parts)assert.ok(LEGACY_SHADERS.includes(p.shader),p.shader);
  assert.equal(w.terrain.shader,'Nature/Terrain/Facepunch Terrain');}
});

test('shading families and defines follow the compiled passes', ()=>{
 assert.deepEqual(legacyDefines(legacyShaderModel('Bumped Specular')),{LEGACY_SPEC:'',LEGACY_BUMP:''});
 assert.deepEqual(legacyDefines(legacyShaderModel('Diffuse')),{});
 assert.deepEqual(legacyDefines(legacyShaderModel('Enviro/BumpedDiffuseOverlaySM3')),{LEGACY_BUMP:'',LEGACY_OVERLAY:''});
 assert.deepEqual(legacyDefines(legacyShaderModel('Custom/Road')),{LEGACY_CUTOUT:''});
 assert.equal(legacyShaderModel('View Model/Bumped Specular').lighting,'blinnphong');
 assert.equal(legacyShaderModel('Hidden/Nature/Tree Creator Leaves Fast Optimized').lighting,'leaf');
 const unknown=legacyShaderModel('Some/Unported');assert.equal(unknown.lighting,'lambert');assert.equal(unknown.exact,false);
});

test('materials take _ST per slot, ignore leftover _Cutoff on opaque shaders and clone with their uniforms', async()=>{
 const tex=async slot=>{const t=new THREE.Texture();t.name=slot.file;return t;};
 const slot=(file,sx=1)=>({file,scale:{x:sx,y:sx},offset:{x:0,y:0.5}});
 const opaque=await createLegacyMaterial({name:'wall',shader:'Diffuse',textures:{_MainTex:slot('a',4)},floats:{_Cutoff:0.5},colors:{_Color:{r:0.588,g:0.588,b:0.588,a:1}}},tex);
 assert.ok(!('LEGACY_CUTOUT' in opaque.defines));assert.equal(opaque.side,THREE.FrontSide);
 assert.deepEqual(opaque.legacyUniforms.legacyMainST.value.toArray(),[4,4,0,0.5]);close(opaque.legacyUniforms.legacyColor.value.x,0.588);
 const road=await createLegacyMaterial({name:'roadMat',shader:'Custom/Road',textures:{_MainTex:slot('r')},floats:{_Cutoff:0.3035714328289032},colors:{_Color:{r:0.54,g:0.56,b:0.56,a:1}}},tex);
 assert.ok('LEGACY_CUTOUT' in road.defines);close(road.legacyUniforms.legacyCutoff.value,0.3035714328289032);assert.equal(road.polygonOffset,true);assert.equal(road.polygonOffsetFactor,-2);
 const rock=await createLegacyMaterial({name:'baked_diffuse',shader:'Enviro/BumpedDiffuseOverlaySM3',textures:{_MainTex:slot('over',50),_BumpMap:slot('overN',50),_MainTex2:slot('under'),_BumpMap2:slot('underN')},floats:{_Opacity:0.75},colors:{_Color:{r:1,g:1,b:1,a:1}}},tex);
 assert.equal(rock.legacyUniforms.legacyMainTex2.value.name,'under');assert.equal(rock.legacyUniforms.legacyBumpMap.value.name,'overN');close(rock.legacyUniforms.legacyOpacity.value,0.75);
 assert.equal(rock.legacyMainMap.name,'over'); // enumerable for renderer.initTexture pre-uploads
 const glass=await createLegacyMaterial({name:'g',shader:'Transparent/Diffuse',textures:{_MainTex:slot('g')}},tex);assert.equal(glass.transparent,true);assert.equal(glass.depthWrite,false);
 const copy=rock.clone();assert.ok(copy instanceof LegacyMaterial);assert.deepEqual(copy.defines,rock.defines);assert.equal(copy.legacyUniforms.legacyMainTex2.value,rock.legacyUniforms.legacyMainTex2.value);
 assert.notEqual(copy.legacyUniforms.legacyMainST.value,rock.legacyUniforms.legacyMainST.value);assert.equal(copy.customProgramCacheKey(),rock.customProgramCacheKey());
 const bark=await createLegacyMaterial({name:'Optimized Bark Material',shader:'Hidden/Nature/Tree Creator Bark Optimized',textures:{_MainTex:slot('atlas'),_BumpSpecMap:slot('bs'),_TranslucencyMap:slot('tr')},colors:{_SpecColor:{r:0.5,g:0.5,b:0.5,a:1}}},tex);
 assert.equal(bark.legacyUniforms.legacyBumpMap.value.name,'bs');assert.equal(bark.legacyUniforms.legacyGlossMap.value.name,'tr');
 const shared={value:new THREE.Vector3(0,0,-1)};legacyTreeVariant(bark,{squashCenter:new THREE.Vector3(1,2,3),squashNormal:shared});assert.equal(bark.legacyUniforms.treeSquashNormal,shared);assert.ok('LEGACY_TREE_SQUASH' in bark.defines);
});

test('Facepunch Terrain albedo: colour-map ratio near, colour map far, smoothstep 300..500 m', ()=>{
 const colTex=[[0.27,0.286,0.294],[0.224,0.224,0.224],[0.38,0.38,0.38],[0.39,0.39,0.39]];
 const args={ctrl:[0,1,0,0],splat0Near:[1,1,1],splat0Half:[1,1,1],splat0Far:[1,1,1],splat1:[0.5,0.4,0.3],splat2:[0,0,0],splat3:[0,0,0],controlColor:[0.448,0.448,0.224],colTex};
 closeV(terrainAlbedo({...args,distance:100}),[0.5*2,0.4*2,0.3*1]);
 closeV(terrainAlbedo({...args,distance:600}),[0.448*1.25,0.448*1.25,0.224*1.25]);
 const mid=terrainAlbedo({...args,distance:400});closeV(mid,[0.5*2,0.4*2,0.3].map((n,i)=>n+([0.56,0.56,0.28][i]-n)*0.5));
 const rock={...args,ctrl:[1,0,0,0],splat0Near:[0.2,0.2,0.2],splat0Half:[0.6,0.6,0.6],controlColor:[0.27,0.286,0.294]};
 closeV(terrainAlbedo({...rock,distance:0}),[0.34,0.34,0.34],1e-6);
});
// Asset loaders prefetch legacyTextureSlots(m) before building (scene.mjs prefetch); it must name exactly the textures
// createLegacyMaterial(m) loads, in its order, for every exported material.
test('legacyTextureSlots lists exactly the textures createLegacyMaterial loads',needsAssets,async()=>{let materials=0,slots=0;
 for(const dir of ['scene','resources','deployables','loot','animals','airdrop','viewmodels','item-mods','players','placement','menu-background']){
  const file=`browser/assets/recovered/${dir}/manifest.json`;if(!existsSync(file))continue;
  for(const m of Object.values(JSON.parse(readFileSync(file,'utf8')).materials??{})){const loaded=[];
   await createLegacyMaterial(m,async slot=>{loaded.push(slot.file);return new THREE.Texture();});
   assert.deepEqual(legacyTextureSlots(m).map(s=>s.file),loaded,`${dir}: ${m.name}`);materials++;slots+=loaded.length;}}
 assert.ok(materials>150&&slots>250,`${materials} materials, ${slots} textures`);
});
