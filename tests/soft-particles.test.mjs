import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {particleShading,particleMaterial,softParticleFade,linearEyeDepth,SOFT_PARTICLE_SHADERS,SOFT_PARTICLE_UNIFORMS} from '../browser/particles.mjs';
import {wantsSceneDepth,SOFT_HOOK_ORDER,FORWARD_OPAQUE_ORDER} from '../browser/soft-particles.mjs';
import {effectiveQuality,SHIPPED_QUALITY} from '../browser/quality.mjs';
import {present} from './helpers/assets.mjs';

const shaderDir=new URL('../analysis/shader-source/',import.meta.url),deployables=new URL('../browser/assets/recovered/deployables/manifest.json',import.meta.url);

test('soft particles are on at Beautiful and Fantastic only (QualitySettings.softParticles)',()=>{
 assert.deepEqual(SHIPPED_QUALITY.map((q,i)=>effectiveQuality(i).softParticles),[false,false,false,false,true,true]);
});

test('LinearEyeDepth matches Unity _ZBufferParams and the hardware depth of a point',()=>{
 const near=0.05,far=24000;
 // Window depth of eye distance z for a standard perspective projection: (f / (f - n)) * (1 - n / z).
 for(const z of [0.05,0.3,2,17.5,400,23999]){const d=far/(far-near)*(1-near/z);assert.ok(Math.abs(linearEyeDepth(d,near,far)-z)/z<1e-6,String(z));}
 // Unity: 1 / (z * d + w) with z = (1 - far/near) / far, w = (far/near) / far.
 const zb=[(1-far/near)/far,(far/near)/far];assert.ok(Math.abs(linearEyeDepth(0.7,near,far)-1/(zb[0]*0.7+zb[1]))<1e-9);
});

test('fade = saturate(_InvFade * (scene - particle eye depth))',()=>{
 assert.equal(softParticleFade(10,10,1),0);assert.equal(softParticleFade(10,9.5,1),0.5);assert.equal(softParticleFade(10,9.5,3),1);
 assert.equal(softParticleFade(10,11,1),0);assert.ok(Math.abs(softParticleFade(10,9.9,0.01)-0.001)<1e-12);
});

test('soft-capable shaders, _InvFade from the material, static program variants',()=>{
 const mat=(shader,invFade)=>({shader,floats:{_InvFade:invFade}});
 for(const s of SOFT_PARTICLE_SHADERS){const sh=particleShading(s,mat(s,2.0628));assert.equal(sh.soft,true,s);assert.equal(sh.invFade,2.0628);
  const m=particleMaterial(sh,null);assert.ok('P_SOFT_PARTICLES' in m.defines,s);assert.equal('P_PREMULTIPLY' in m.defines,s==='Particles/Alpha Blended Premultiply');
  // Shared uniform objects: one update reaches every program; the per-material factor is its own.
  for(const k of Object.keys(SOFT_PARTICLE_UNIFORMS))assert.equal(m.uniforms[k],SOFT_PARTICLE_UNIFORMS[k],k);assert.equal(m.uniforms.invFade.value,2.0628);}
 for(const s of ['View Model/Particles/Additive','Particles/VertexLit Blended','Particles/VertexLit Blended Billboard','Transparent/Lit Colored']){
  const sh=particleShading(s,mat(s,3));assert.equal(sh.soft,false,s);assert.ok(!('P_SOFT_PARTICLES' in particleMaterial(sh,null).defines),s);}
 assert.equal(particleShading('Particles/Additive',{}).invFade,1,'shader default');
});

test('the shipped particle shaders: which SOFTPARTICLES_ON fragment programs read _CameraDepthTexture',{skip:!present(shaderDir)},()=>{
 const reads=new Map();
 for(const f of readdirSync(shaderDir).filter(f=>/Particles/.test(f))){const t=readFileSync(new URL(f,shaderDir),'utf8').replace(/\r\n/g,'\n'),name=/Shader "([^"]+)"/.exec(t)[1],fp=t.slice(t.indexOf('Program "fp"'));
  if(t.indexOf('Program "fp"')<0)continue;
  for(const m of fp.matchAll(/SubProgram "opengl " \{\nKeywords \{([^}]*)\}([\s\S]*?)\n"\n\}/g))if(m[1].includes('SOFTPARTICLES_ON'))reads.set(name,(reads.get(name)||false)||/_CameraDepthTexture/.test(m[2])&&/_InvFade/.test(m[2]));}
 const soft=[...reads].filter(([,r])=>r).map(([n])=>n).sort();
 // ~Additive-Multiply also has one, but no shipped particle material uses it (particleShading has no mapping for it).
 assert.deepEqual(soft.filter(n=>n!=='Particles/~Additive-Multiply'),[...SOFT_PARTICLE_SHADERS].sort());
 assert.equal(reads.get('View Model/Particles/Additive'),false,'its SOFTPARTICLES_ON program reads no depth');
});

test('exported particle materials keep their _InvFade',{skip:!present(deployables)},()=>{
 const m=JSON.parse(readFileSync(deployables,'utf8')).materials,soft=Object.values(m).filter(x=>SOFT_PARTICLE_SHADERS.includes(x.shader));
 assert.ok(soft.length>5);for(const x of soft)assert.equal(particleShading(x.shader,x).invFade,x.floats?._InvFade??1);
});

test('scene depth is requested while soft particles drew recently',()=>{
 assert.equal(wantsSceneDepth({enabled:false,frame:10,lastDraw:10}),false);
 assert.equal(wantsSceneDepth({enabled:true,frame:10,lastDraw:-Infinity}),false);
 assert.equal(wantsSceneDepth({enabled:true,frame:10,lastDraw:9}),true);
 assert.equal(wantsSceneDepth({enabled:true,frame:100,lastDraw:9,keep:30}),false);
 assert.ok(SOFT_HOOK_ORDER>0&&SOFT_HOOK_ORDER<FORWARD_OPAQUE_ORDER,'opaque copy after deferred opaques (order 0), before forward-only leaves/billboards and every transparent');
});
