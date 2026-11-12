import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const server=createServer();await listenServer(server);let browser;
try{
 browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/tracer-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}</style><canvas id="world"></canvas><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/tracer-qa`);
 await page.evaluate(async()=>{
  const THREE=await import('/vendor/three.module.js'),{createAssetLoader}=await import('/scene.mjs'),{createTracerEffects}=await import('/tracer-effects.mjs'),{ParticleEffect}=await import('/particles.mjs');
  const base='/assets/recovered/deployables/',manifest=await(await fetch(base+'manifest.json')).json(),presentation=await(await fetch('/assets/recovered/presentation/manifest.json')).json(),assets=createAssetLoader(base,manifest),scene=new THREE.Scene();scene.background=new THREE.Color('#18202a');scene.add(new THREE.HemisphereLight(0xffffff,0x666666,3));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,4);scene.add(light);
  const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#world'),preserveDrawingBuffer:true});renderer.setSize(1000,800);
  const camera=new THREE.PerspectiveCamera(45,1.25,0.01,1000);camera.position.set(2,1,2);camera.lookAt(0,0,-5);
  const wallGroup=new THREE.Group(),wall=new THREE.Mesh(new THREE.PlaneGeometry(6,4),new THREE.MeshStandardMaterial({color:'#b4a590',side:THREE.DoubleSide}));wall.position.z=-8;wallGroup.add(wall);scene.add(wallGroup);scene.updateMatrixWorld(true);
  const body={layer:0,deployed:{view:{group:wallGroup},destroyed:false}},textures=new Map();
  for(const s of Object.values(manifest.surfaces))for(const key of s.bulletEffects)for(const r of manifest.prefabs[key].components.ParticleSystemRenderer??[]){const m=manifest.materials[r.materials[0]],file=m?.textures?._MainTex?.file??m?.texture;if(file&&!textures.has(file)){const t=await new THREE.TextureLoader().loadAsync(base+file);t.colorSpace=THREE.SRGBColorSpace;textures.set(file,t);}}
  const makeEffects=p=>(p.components.ParticleSystem??[]).flatMap(ps=>{const r=p.components.ParticleSystemRenderer?.find(r=>r.node===ps.node);if(!r?.enabled)return [];const m=manifest.materials[r.materials[0]],file=m.textures?._MainTex?.file??m.texture;return [new ParticleEffect(ps.data,r,m,textures.get(file),new THREE.Matrix4().fromArray(p.nodes[ps.node].matrix))];});
  const sounds=[],lights=[0,1].map(()=>{const l=new THREE.PointLight(0xffffff,0,1,1);scene.add(l);return l;}),effects=await createTracerEffects(manifest,assets,scene,{base,random:()=>0.5,makeEffects,presentation,lights,playSound:(file,p,min,max)=>sounds.push({file,min,max}),raycast:(ray,range)=>{scene.updateMatrixWorld(true);const h=new THREE.Raycaster(ray.origin,ray.direction,0,range).intersectObject(wall)[0];return h&&{position:h.point,normal:new THREE.Vector3(0,0,1),body,terrain:body.testTerrain};}});
  const key=Object.values(manifest.weapons).find(w=>w.item==='M4').prefabs.tracerPrefab;
  window.tracerQA={THREE,effects,manifest,scene,renderer,camera,wallGroup,body,sounds,spawn(silenced=false){effects.spawn(key,new THREE.Vector3(),new THREE.Vector3(0,0,-100),{range:100,silenced});},step(dt){effects.frame(dt,camera);scene.updateMatrixWorld(true);renderer.render(scene,camera);return effects.debug();}};
 });
 const step=dt=>page.evaluate(dt=>window.tracerQA.step(dt),dt);await step(0);
 await page.evaluate(()=>window.tracerQA.spawn());const first=await step(0.01);assert.equal(first.visible,0);const flying=await step(0.01);assert.equal(flying.visible,1);
 await mkdir('analysis/browser-qa',{recursive:true});await page.screenshot({path:'analysis/browser-qa/tracer-mesh.png'});
 const hit=await step(0.01);assert.equal(hit.active,0);assert.equal(hit.hits,1);assert.equal(hit.decals,1);assert.equal(hit.impacts,1);
 const decal=await page.evaluate(()=>{const q=window.tracerQA;return {parent:q.effects.decals[0].root.parent===q.wallGroup,alphaTest:(m=>m.legacyUniforms?.legacyCutoff&&m.defines?.LEGACY_CUTOUT!==undefined?m.legacyUniforms.legacyCutoff.value:m.alphaTest)(q.effects.decals[0].root.children[0].children[0].material) /* Transparent/Cutout/Diffuse discards below _Cutoff in the legacy shader */,sounds:q.sounds};});assert.equal(decal.parent,true);assert.ok(decal.alphaTest>0.89);/* Tracer.Update plays both: SurfaceInfo.DoImpact instantiates the surface's Bullet impact prefab, whose
  EffectSoundPlayer.Start plays one clip (1..10 m), then the generic decal branch plays Tracer.impactSounds (2..15 m). */
 assert.equal(decal.sounds.length,2);assert.deepEqual(decal.sounds.map(s=>s.max).sort((a,b)=>a-b),[10,15]);
 await page.evaluate(()=>{const q=window.tracerQA;q.camera.position.set(0.2,0.2,-6);q.camera.lookAt(0,0,-8);});await step(0.03);await page.screenshot({path:'analysis/browser-qa/tracer-impact.png'});
 const settled=await step(1.1);assert.equal(settled.impacts,0);assert.equal(settled.decals,1);await page.screenshot({path:'analysis/browser-qa/tracer-decal.png'});
 const before=await page.evaluate(()=>window.tracerQA.effects.decals[0].root.getWorldPosition(window.tracerQA.camera.position.clone()).toArray());await page.evaluate(()=>window.tracerQA.wallGroup.position.x=1);await step(0);
 const after=await page.evaluate(()=>window.tracerQA.effects.decals[0].root.getWorldPosition(window.tracerQA.camera.position.clone()).toArray());assert.ok(Math.abs(after[0]-before[0]-1)<1e-6);
 await page.evaluate(()=>{const q=window.tracerQA;q.wallGroup.position.x=0;q.spawn(true);});await step(0.01);const hidden=await step(0.01);assert.equal(hidden.visible,0);const silentHit=await step(0.01);assert.equal(silentHit.hits,2);assert.equal(silentHit.decals,2);
 await page.evaluate(()=>{window.tracerQA.body.layer=27;window.tracerQA.body.surfaceName='MalePlayer';window.tracerQA.spawn();});await step(0.01);await step(0.01);const flesh=await step(0.01);assert.equal(flesh.hits,3);assert.equal(flesh.decals,2);assert.equal(flesh.lastImpact.surface,'flesh');await page.screenshot({path:'analysis/browser-qa/surface-flesh.png'});
 await page.evaluate(()=>{const q=window.tracerQA;q.camera.position.set(200,0,0);q.body.layer=0;q.spawn();});await step(0.01);await step(0.01);const far=await step(0.01);assert.equal(far.hits,3);assert.equal(far.decals,2);
 const cleanup=await step(15);assert.equal(cleanup.decals,0);assert.equal(cleanup.impacts,0);assert.deepEqual(errors,[]);
 const surfaces={};for(const [name,surface]of [['WoodFoundation','wood'],['MetalFoundation','metal']]){
  await page.evaluate(name=>{const q=window.tracerQA;q.camera.position.set(0.2,0.2,-6);q.body.layer=0;q.body.surfaceName=name;q.spawn();},name);await step(0.01);await step(0.01);surfaces[surface]=await step(0.01);assert.equal(surfaces[surface].lastImpact.surface,surface);
  // QuickLight: only MetalImpact carries one; range 1 at the hit, minus dt / 0.1 per frame, then range and intensity 0.
  assert.equal(surfaces[surface].lastImpact.light,surface==='metal');if(surface==='metal')assert.deepEqual(surfaces[surface].quickLights.lit[0],{range:1,intensity:30});
  const lit=await step(0.03);if(surface==='metal'){assert.ok(Math.abs(lit.quickLights.lit[0].range-0.7)<1e-6);assert.equal(lit.quickLights.lit[0].intensity,30);surfaces.metalLightAfter30ms=lit.quickLights.lit[0];}await page.screenshot({path:`analysis/browser-qa/surface-${surface}.png`});if(surface==='metal'){const out=await step(0.08);assert.deepEqual(out.quickLights.lit[0],{range:0,intensity:0});}await step(15);
 }
 const expectedTerrain=await page.evaluate(async()=>{const q=window.tracerQA,T=q.THREE,t=q.manifest.surfaceRoutes.terrain,root=await(await fetch('/assets/recovered/manifest.json')).json(),texture=await new T.TextureLoader().loadAsync('/assets/recovered/'+root.alpha.file);
  texture.colorSpace=T.NoColorSpace;texture.minFilter=texture.magFilter=T.NearestFilter;
  const x=Math.trunc((0-t.origin[0])/t.extent[0]*t.width),z=Math.trunc((8-t.origin[2])/t.extent[1]*t.height),target=new T.WebGLRenderTarget(4,1),probe=new T.Scene(),geometry=new T.PlaneGeometry(2,2),material=new T.ShaderMaterial({uniforms:{map:{value:texture},uvPoint:{value:new T.Vector2((x+0.5)/t.width,(z+0.5)/t.height)}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'uniform sampler2D map;uniform vec2 uvPoint;void main(){vec4 v=texture2D(map,uvPoint);float n=gl_FragCoord.x;float c=n<1.0?v.r:n<2.0?v.g:n<3.0?v.b:v.a;gl_FragColor=vec4(c,0.0,0.0,1.0);}'});
  probe.add(new T.Mesh(geometry,material));q.renderer.setRenderTarget(target);q.renderer.render(probe,new T.Camera());const pixels=new Uint8Array(16);q.renderer.readRenderTargetPixels(target,0,0,4,1,pixels);q.renderer.setRenderTarget(null);target.dispose();geometry.dispose();material.dispose();texture.dispose();let best=0;for(let i=1;i<4;i++)if(pixels[i*4]>pixels[best*4])best=i;
  delete q.body.surfaceName;q.body.testTerrain=true;q.spawn();return q.manifest.surfaces[t.surfaces[best]].name;});
 await step(0.01);await step(0.01);surfaces.terrain=await step(0.01);assert.equal(surfaces.terrain.lastImpact.surface,expectedTerrain);await step(15);assert.deepEqual(errors,[]);
 // P3-17 Shuriken parity on shipped prefabs: muzzle flash (additive x2 tint), lit impact flecks (Transparent/Lit Colored forward
 // Lambert), VertexLit dirt (fixed-function), instanced Mesh-mode debris with Mesh shapes and the scene WindZone.
 await page.evaluate(async()=>{const q=window.tracerQA,T=q.THREE,{ParticleEffect,linkSubEmitters}=await import('/particles.mjs'),{createFxAssets}=await import('/fx-assets.mjs');
  const fxm=await(await fetch('/assets/recovered/fx/manifest.json')).json(),fx=await createFxAssets('/assets/recovered/',fxm,{deployManifest:q.manifest});
  const tex=async m=>{const f=m?.textures?._MainTex?.file??m?.texture;if(!f)return null;const t=await new T.TextureLoader().loadAsync('/assets/recovered/deployables/'+f);t.colorSpace=T.SRGBColorSpace;return t;};
  const byName=n=>Object.values(q.manifest.prefabs).find(p=>p?.name===n);
  fx.updateLighting({ambient:{color:new T.Color(0.25,0.25,0.25),intensity:1},directional:[q.scene.children.find(c=>c.isDirectionalLight)],points:[]});
  q.fxRun=async(name,at,steps)=>{const p=byName(name),list=[];for(const ps of p.components.ParticleSystem??[]){if(!p.nodes[ps.node].active)continue;const r=p.components.ParticleSystemRenderer.find(x=>x.node===ps.node);if(!r?.enabled)continue;
    const m=q.manifest.materials[r.materials[0]],e=Object.assign(new ParticleEffect(ps.data,r,m,await tex(m),new T.Matrix4().fromArray(p.nodes[ps.node].matrix),Math.random,fx.effectOptions(p,ps.node,r)),{id:ps.id??null,name:p.nodes[ps.node].name});e.lighting=fx.lighting;e.wind=fx.wind;list.push(e);}
   linkSubEmitters(list);for(const e of list)q.scene.add(e.mesh);const root=new T.Matrix4().makeTranslation(...at);
   for(let i=0;i<steps;i++)for(const e of list)e.update(1/60,true,root,q.camera);q.scene.updateMatrixWorld(true);q.renderer.render(q.scene,q.camera);q.fxLast=list;
   return list.map(e=>({name:e.name,shader:e.shading.shader,lit:e.shading.lit,blend:e.shading.blend,particles:e.particles.length,instanced:Boolean(e.instanced),count:e.instanced?e.mesh.count:null,color:Array.from(e.colors.slice(0,4))}));};
  q.fxClear=()=>{for(const e of q.fxLast??[]){q.scene.remove(e.mesh);e.dispose();}q.fxLast=[];};
  q.camera.position.set(0.3,0.4,-5.2);q.camera.lookAt(0,0.2,-7.2);q.camera.updateMatrixWorld();});
 const fxShots={};await mkdir('analysis/browser-qa/fx',{recursive:true});
 for(const [name,steps,file] of [['flash_tp',3,'muzzle-flash-world'],['Impact',8,'impact-flecks-lit'],['DirtImpact',10,'dirt-vertexlit'],['wood_wall_debris',40,'death-debris-mesh'],['Explosion1',20,'explosion']]){
  fxShots[name]=await page.evaluate(([n,s])=>window.tracerQA.fxRun(n,[0,0.2,-7.2],s),[name,steps]);await page.screenshot({path:`analysis/browser-qa/fx/${file}.png`});await page.evaluate(()=>window.tracerQA.fxClear());}
 assert.ok(fxShots.flash_tp.some(e=>e.blend==='add'&&e.particles>0),JSON.stringify(fxShots.flash_tp));
 const flecks=fxShots.Impact.find(e=>e.lit==='forward');assert.ok(flecks&&flecks.particles>0&&flecks.color.slice(0,3).every(v=>Number.isFinite(v)&&v>0),JSON.stringify(fxShots.Impact));
 const dirt=fxShots.DirtImpact.find(e=>e.lit==='ffp');assert.ok(dirt&&dirt.particles>0&&dirt.color.slice(0,3).every(v=>v>=0&&v<=1),JSON.stringify(fxShots.DirtImpact));
 const debris=fxShots.wood_wall_debris.find(e=>e.instanced);assert.ok(debris&&debris.count>0,JSON.stringify(fxShots.wood_wall_debris));assert.deepEqual(errors,[]);
 const result={ok:true,graphics:await readGraphics(page),first,flying,hit,decal,settled,hidden,silentHit,flesh,far,cleanup,surfaces,expectedTerrain,fxShots,errors};await writeFile('analysis/browser-qa/tracers.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
