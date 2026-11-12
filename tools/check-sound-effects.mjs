// Rendered check for the 2026-10-23 sound/effect round (GAP-AUDIT "Sounds and effects"): MeleeWeaponDataBlock.DoMeleeEffects'
// WoodImpact burst (impactEffectWood, 1.5 s) and a surface melee effect (1 s) through tracer-effects.impact, plus the
// Uber Hunting Bow's UberWorldArrow drawn with Custom/OutlineHover. One small page (no island), one browser.
//   node tools/check-sound-effects.mjs   -> analysis/browser-qa/sound-effects/*.png + result.json
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const OUT='analysis/browser-qa/sound-effects';
const server=createServer();await listenServer(server);let browser;
try{
 browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/sound-fx-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}</style><canvas id="world"></canvas><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/sound-fx-qa`);
 await page.evaluate(async()=>{
  const THREE=await import('/vendor/three.module.js'),{createAssetLoader}=await import('/scene.mjs'),{createTracerEffects}=await import('/tracer-effects.mjs'),{ParticleEffect}=await import('/particles.mjs'),{meleeImpact}=await import('/melee-effects.mjs');
  const base='/assets/recovered/deployables/',manifest=await(await fetch(base+'manifest.json')).json(),items=(await(await fetch('/assets/recovered/items/manifest.json')).json()).items,assets=createAssetLoader(base,manifest),scene=new THREE.Scene();
  scene.background=new THREE.Color('#18202a');scene.add(new THREE.HemisphereLight(0xffffff,0x666666,3));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,4);scene.add(light);
  const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#world'),preserveDrawingBuffer:true});renderer.setSize(1000,800);
  const camera=new THREE.PerspectiveCamera(45,1.25,0.01,1000);camera.position.set(0.6,0.3,-6.2);camera.lookAt(0,0,-8);
  // A trunk stand-in: the burst leaves its surface along the hit normal (+Z here).
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,6,24),new THREE.MeshStandardMaterial({color:'#5a4330'}));trunk.position.set(0,0,-8.5);scene.add(trunk);scene.updateMatrixWorld(true);
  const textures=new Map(),texture=async file=>{if(file&&!textures.has(file)){const t=await new THREE.TextureLoader().loadAsync(base+file);t.colorSpace=THREE.SRGBColorSpace;textures.set(file,t);}return textures.get(file);};
  const makeEffects=p=>(p.components.ParticleSystem??[]).flatMap(ps=>{const r=p.components.ParticleSystemRenderer?.find(r=>r.node===ps.node);if(!r?.enabled)return [];const m=manifest.materials[r.materials[0]],file=m.textures?._MainTex?.file??m.texture;return [new ParticleEffect(ps.data,r,m,textures.get(file),new THREE.Matrix4().fromArray(p.nodes[ps.node].matrix))];});
  const key=name=>Object.keys(items).find(k=>items[k].data.m_Name===name),hatchet=manifest.weapons[key('Hatchet')];
  for(const k of [hatchet.prefabs.impactEffectWood,...Object.values(manifest.surfaces).flatMap(s=>s.meleeEffects)])for(const r of manifest.prefabs[k].components.ParticleSystemRenderer??[]){const m=manifest.materials[r.materials[0]];await texture(m?.textures?._MainTex?.file??m?.texture);}
  const sounds=[],effects=await createTracerEffects(manifest,assets,scene,{base,random:()=>0.5,makeEffects,playSound:(file,p,min,max)=>sounds.push({file,min,max}),raycast:()=>null});
  const point=new THREE.Vector3(0,0,-8),rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),new THREE.Vector3(0,0,1));
  // Uber Hunting Bow arrow (UberWorldArrow, Custom/OutlineHover) beside the trunk.
  const arrowKey=manifest.weapons[key('Uber Hunting Bow')].prefabs.arrowPrefab,arrow=manifest.prefabs[arrowKey],arrowGroup=new THREE.Group();
  for(const r of arrow.renderers){const part=new THREE.Group();part.matrixAutoUpdate=false;part.matrix.fromArray(r.matrix);for(const mesh of await assets.parts(r.mesh,r.materials,r.materials.map((_,i)=>i),null,r.name))part.add(mesh);arrowGroup.add(part);}
  arrowGroup.position.set(0,0.2,-7.4);arrowGroup.rotation.y=Math.PI/2.4;arrowGroup.visible=false;scene.add(arrowGroup);
  window.fxQA={THREE,effects,manifest,scene,renderer,camera,sounds,hatchet,
   tree(){const impact=meleeImpact({tree:true,point:point.toArray()},{sounds:hatchet.sounds,prefabs:hatchet.prefabs,manifest});const fx=effects.impact(impact.effect,point.clone(),rotation,impact.life);return {name:manifest.prefabs[impact.effect].name,life:impact.life,particles:fx.particles,sound:fx.sound};},
   surface(){const key=manifest.surfaces[Object.keys(manifest.surfaces).find(k=>manifest.surfaces[k].name==='wood')]?.meleeEffects?.[0];const fx=effects.impact(key,point.clone(),rotation,1);return {name:manifest.prefabs[key].name,particles:fx.particles,sound:fx.sound};},
   arrow(){arrowGroup.visible=true;trunk.visible=false;camera.position.set(0.3,0.6,-4.6);camera.lookAt(0,0.2,-7.4);const mats=[];arrowGroup.traverse(o=>{if(o.material)mats.push({type:o.material.type,name:o.material.name,shader:Boolean(o.material.uniforms?.pushOut)});});return mats;},
   step(dt){effects.frame(dt,camera);scene.updateMatrixWorld(true);renderer.render(scene,camera);return effects.debug();}};
 });
 const step=dt=>page.evaluate(dt=>window.fxQA.step(dt),dt);await mkdir(OUT,{recursive:true});
 const tree=await page.evaluate(()=>window.fxQA.tree());assert.equal(tree.name,'WoodImpact');assert.equal(tree.life,1.5);assert.ok(tree.particles>0);assert.ok(tree.sound,'WoodImpact EffectSoundPlayer clip');
 let shot=null;for(let i=0;i<6;i++)shot=await step(0.05);assert.equal(shot.impacts,1);await page.screenshot({path:`${OUT}/tree-wood-impact.png`});
 const atOne=await step(0.75);assert.equal(atOne.impacts,1,'still alive at 1.05 s (Destroy 1.5 s)');const gone=await step(0.5);assert.equal(gone.impacts,0);
 const surface=await page.evaluate(()=>window.fxQA.surface());assert.ok(surface.particles>0);for(let i=0;i<4;i++)await step(0.05);await page.screenshot({path:`${OUT}/surface-melee-impact.png`});
 const surfaceGone=await step(0.85);assert.equal(surfaceGone.impacts,0,'gone after 1 s (SurfaceInfo.DoImpact)');
 const arrow=await page.evaluate(()=>window.fxQA.arrow());assert.ok(arrow.length&&arrow.some(m=>m.shader),JSON.stringify(arrow));await step(0);await page.screenshot({path:`${OUT}/uber-arrow.png`});
 assert.deepEqual(errors,[]);
 const result={ok:true,graphics:await readGraphics(page),tree,surface,arrow,errors};await writeFile(`${OUT}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
