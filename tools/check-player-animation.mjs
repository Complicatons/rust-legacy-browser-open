// Deterministic original-skin rendering check. Only project code and static assets execute.
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
 await page.route('**/animation-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#18202a}canvas{display:block}</style><canvas id="world"></canvas><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/animation-qa`);
 await page.evaluate(async()=>{
  const THREE=await import('/vendor/three.module.js'),{createPlayerRenderer}=await import('/player-view.mjs'),{createAssetLoader}=await import('/scene.mjs');
  const base='/assets/recovered/players/',manifest=await(await fetch(base+'manifest.json')).json(),clips=await(await fetch(base+manifest.clipsFile)).json();
  const scene=new THREE.Scene();scene.background=new THREE.Color('#18202a');scene.add(new THREE.HemisphereLight(0xffffff,0x666666,3));
  const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,5,4);scene.add(light);
  const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#world'),preserveDrawingBuffer:true});renderer.setSize(1000,800);
  const camera=new THREE.PerspectiveCamera(35,1.25,0.01,100);camera.position.set(3,2,4);camera.lookAt(0,0.9,0);
  const players=await createPlayerRenderer(scene,manifest,clips,createAssetLoader(base,manifest),{interpDelay:0});
  // The root really moves: PlayerAnimation.CalculateVelocity differentiates the interpolated origin per frame.
  let time=0;const position=[0,0,0];window.animationQA={players,scene,renderer,camera,step({flags=0,x=0,z=0}={},dt=0.05){
   time+=dt;position[0]+=x*dt;position[2]-=z*dt;const v=players.views.get(30);if(v)v.snapshots.length=0;
   players.upsert({viewId:30,position:[...position],rotation:[0,0,0,1],angles:{yaw:0,pitch:0},stateFlags:flags},time);
   players.update(time,dt);camera.position.set(position[0]+3,2,position[2]+4);camera.lookAt(position[0],0.9,position[2]);renderer.render(scene,camera);
   const view=players.views.get(30),vertices=[];for(const mesh of view.meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i+=137)vertices.push(...mesh.getVertexPosition(i,new THREE.Vector3()).toArray());
   const root=new THREE.Vector3().setFromMatrixPosition(view.root.matrix),hand=view.bones.find(b=>b.name.endsWith('RustPlayer_R_Hand'));view.root.updateMatrixWorld(true);
   return {...players.debug()[0],verticesFinite:vertices.every(Number.isFinite),maxVertex:Math.max(...vertices.map(v=>Math.abs(v-0))),hand:new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld).sub(root).toArray()};
  },event(name,speed=1){return players.playEvent(30,name,speed,0,time);},override(group){players.views.get(30).groupOverride=group;}};
 });
 const step=(input={},dt=0.05)=>page.evaluate(({input,dt})=>window.animationQA.step(input,dt),{input,dt});
 const stand=await step({},2);assert.equal(stand.skins,4);assert.ok(stand.verticesFinite);assert.ok(stand.maxVertex<10);
 // One frame of motion before the movement flag: the heading uses the previous frame's local velocity.
 const primed=await step({z:2.1},0.05);assert.equal(primed.sampler.moveWeight,0);
 const moving=await step({flags:64,z:2.1},0.075);assert.ok(Math.abs(moving.sampler.moveWeight-0.5)<1e-6);
 assert.ok(moving.weights.some(([name,w])=>name==='idle_stand'&&w>0));assert.ok(moving.weights.some(([name,w])=>name==='walk_n'&&w>0));
 await step({flags:64,z:2.1},0.075);const turning=await step({flags:64,x:1.5,z:1.5},0.1);assert.equal(turning.sampler.angle,0,'heading lags one frame');
 const diagonal=await step({flags:64,x:1.5,z:1.5},0.1);assert.ok(Math.abs(diagonal.sampler.angle-45)<1e-6);
 assert.ok(diagonal.weights.some(([name])=>name==='walk_n'));assert.ok(diagonal.weights.some(([name])=>name==='walk_e'));
 await mkdir('analysis/browser-qa/anim',{recursive:true});await page.screenshot({path:'analysis/browser-qa/animation-walk.png'});
 const crouch=await step({flags:1},0.1);assert.ok(crouch.pose.includes('idle_crouch'));assert.ok(crouch.pose.includes('idle_stand'));
 await step({flags:1},1);await page.screenshot({path:'analysis/browser-qa/animation-crouch.png'});
 const jumping=await step({flags:17},0.3);assert.ok(Math.abs(jumping.sampler.jumpWeight-0.5)<1e-6);
 const air=await step({flags:16},2);assert.equal(air.sampler.jumpWeight,1);assert.ok(air.verticesFinite);assert.ok(air.maxVertex<10);
 await page.screenshot({path:'analysis/browser-qa/animation-jump-clamped.png'});
 const landed=await step({},0.1);assert.ok(landed.sampler.jumpWeight<1e-6);
 // GroupEvent.Attack (PlayerAnimation.PlayAnimation): the current sampler group's clip, additive on native layer 1.
 assert.equal(await page.evaluate(()=>window.animationQA.event('attack')),false,'noitem has no attack clip');
 await page.evaluate(()=>window.animationQA.override('hatchet'));const armed=await step({},1);assert.equal(armed.sampler.group,'hatchet');
 assert.equal(await page.evaluate(()=>window.animationQA.event('reload')),false,'no shipped group defines Reload');
 assert.equal(await page.evaluate(()=>window.animationQA.event('readyAttack')),false,'no shipped group defines ReadyAttack');
 assert.equal(await page.evaluate(()=>window.animationQA.event('attack')),true);const swing=await step({},0.4);
 assert.equal(swing.event?.name,'attack_hatchet');assert.ok(swing.weights.some(([name,w])=>name==='+attack_hatchet'&&w===1));
 assert.ok(Math.hypot(...swing.hand.map((v,i)=>v-armed.hand[i]))>0.03,'layer-1 attack moves the hand under full locomotion');
 await page.screenshot({path:'analysis/browser-qa/anim/attack-layer1.png'});
 const ended=await step({},1.2);assert.equal(ended.event,null,'Default wrap attack stops at its 1.5 s length');
 assert.ok(Math.hypot(...ended.hand.map((v,i)=>v-armed.hand[i]))<0.01,'pose returns once the event ends');
 assert.deepEqual(errors,[]);const result={ok:true,graphics:await readGraphics(page),stand,primed,moving,turning,diagonal,crouch,jumping,air,landed,armed,swing,ended,errors};
 await writeFile('analysis/browser-qa/player-animation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
