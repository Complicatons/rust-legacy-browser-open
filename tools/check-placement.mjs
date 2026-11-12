// GPU check of the original placement preview (browser/placement-preview.mjs): a Wood Wall valid and invalid
// (Custom/OutlineHover green/red pulse), a Camp Fire with its BounceArrow gizmo, a Wooden Door with BounceArrowHard.
// Screenshots: analysis/browser-qa/placement-*.png. REQUIRE_GPU=1 refuses software renderers.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const server=createServer();await listenServer(server);let browser;
try{
 browser=await chromium.launch(launchOptions());const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/placement-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}</style><canvas id="world"></canvas><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/placement-qa`);
 await page.evaluate(async()=>{
  const THREE=await import('/vendor/three.module.js'),{createAssetLoader}=await import('/scene.mjs'),{setFlipY}=await import('/texture-source.mjs'),{createPlacementPreview}=await import('/placement-preview.mjs');
  const base='/assets/recovered/placement/',manifest=await(await fetch(base+'manifest.json')).json(),quality=await(await fetch('/assets/recovered/quality/manifest.json')).json();
  const scene=new THREE.Scene();scene.background=new THREE.Color('#30363d');
  // Unity-unit lights as the legacy materials take them: sun colour * intensity, flat ambient.
  const sun=new THREE.DirectionalLight(0xffffff,0.8);sun.position.set(3,6,2);scene.add(sun,sun.target);scene.add(new THREE.AmbientLight(0xffffff,0.35));
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshBasicMaterial({color:'#4b4436'}));ground.rotation.x=-Math.PI/2;scene.add(ground);
  const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#world'),preserveDrawingBuffer:true});renderer.setSize(1000,700);
  const camera=new THREE.PerspectiveCamera(60,1000/700,0.05,500);camera.position.set(0,1.7,0);camera.lookAt(0,1.2,-6);
  let ms=1000;const loader=createAssetLoader(base,manifest);
  const texture=slot=>new THREE.TextureLoader().loadAsync(base+slot.file).then(t=>{t.colorSpace=THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;setFlipY(t,true);return t;});
  const preview=createPlacementPreview(manifest,{loader,texture,scene,cullingMask:quality.camera.cullingMask,now:()=>ms});
  const key=name=>Object.keys(manifest.items).find(k=>manifest.items[k].item===name);
  const gl=renderer.getContext();
  // Pixels that differ from the empty scene (baseline) in the centre region, with their mean red/green change.
  let baseline=null;
  const region=()=>{const w=1000,h=700,px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);if(!baseline)baseline=px;let dr=0,dg=0,n=0,changed=0;
   for(let y=60;y<640;y+=2)for(let x=200;x<800;x+=2){const i=(y*w+x)*4;n++;const r=px[i]-baseline[i],g=px[i+1]-baseline[i+1],b=px[i+2]-baseline[i+2];if(Math.abs(r)+Math.abs(g)+Math.abs(b)>12){changed++;dr+=r;dg+=g;}}
   return {changed:changed/n,dr:changed?dr/changed:0,dg:changed?dg/changed:0};};
  // A Wood Wall as the Explosive Charge's carrier: its root MeshRenderer mesh at the wall's matrix (as main.mjs carrierPreview).
  const {unityMatrix}=await import('/deployables.mjs'),dbase='/assets/recovered/deployables/',dm=await(await fetch(dbase+'manifest.json')).json(),dl=createAssetLoader(dbase,dm);
  const wallPrefab=Object.values(dm.prefabs).find(p=>p?.name==='WoodWall'),wallMesh=wallPrefab.renderers.find(r=>r.node===0).mesh;
  const wallGeometries=async()=>{const a=await dl.attributes(wallMesh),out=[];for(const part of dm.meshes[wallMesh].parts){const g=new THREE.BufferGeometry();for(const [k,v] of Object.entries(a))if(v)g.setAttribute(k,v);g.setIndex(new THREE.BufferAttribute(await dl.binary(part,Uint32Array),1));out.push(g);}return out;};
  const wallCarrier=()=>({key:wallMesh,geometries:wallGeometries,matrix:unityMatrix(new THREE.Vector3(0,0,6),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI),{x:1,y:1,z:1})});
  window.placementQA={
   async show(name,{valid,t,position=[0,0,6],yaw=180,carrier=false}){const k=key(name),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw*Math.PI/180);
    const opts={valid,position:new THREE.Vector3(...position),rotation:q,scale:{x:1,y:1,z:1},t,carrier:carrier?wallCarrier():null,camera,resolution:renderer.getDrawingBufferSize(new THREE.Vector2())};
    for(let i=0;i<200&&!preview.update(k,opts);i++)await new Promise(r=>setTimeout(r,20));
    for(let i=0;i<50&&carrier&&!preview.log.carrier;i++){ms+=16;preview.update(k,opts);await new Promise(r=>setTimeout(r,20));}
    ms+=16;preview.update(k,opts);renderer.render(scene,camera);
    return {...region(),log:{...preview.log},errors:gl.getError()};},
   hide(){preview.hide();renderer.render(scene,camera);return region();}};
 });
 const qa=(name,opts)=>page.evaluate(([n,o])=>window.placementQA.show(n,o),[name,opts]);
 await mkdir('analysis/browser-qa',{recursive:true});
 const empty=await page.evaluate(()=>window.placementQA.hide());
 const wallValid=await qa('Wood Wall',{valid:true,t:0});await page.screenshot({path:'analysis/browser-qa/placement-wall-valid.png'});
 const wallPulse=await qa('Wood Wall',{valid:true,t:Math.PI/16});await page.screenshot({path:'analysis/browser-qa/placement-wall-valid-pulse.png'});
 const wallInvalid=await qa('Wood Wall',{valid:false,t:0});await page.screenshot({path:'analysis/browser-qa/placement-wall-invalid.png'});
 const fire=await qa('Camp Fire',{valid:true,t:0.3,position:[0,0,3.5]});await page.screenshot({path:'analysis/browser-qa/placement-campfire.png'});
 const fireBad=await qa('Camp Fire',{valid:false,t:0.3,position:[0,0,3.5]});await page.screenshot({path:'analysis/browser-qa/placement-campfire-invalid.png'});
 const door=await qa('Wooden Door',{valid:true,t:0.5,position:[0,0,5]});await page.screenshot({path:'analysis/browser-qa/placement-door.png'});
 const c4=await qa('Explosive Charge',{valid:true,t:0.7,position:[0,1.5,5.8]});await page.screenshot({path:'analysis/browser-qa/placement-c4.png'});
 const c4Carrier=await qa('Explosive Charge',{valid:true,t:0.7,position:[0,1.5,5.8],carrier:true});await page.screenshot({path:'analysis/browser-qa/placement-c4-carrier.png'});
 const hidden=await page.evaluate(()=>window.placementQA.hide());
 for(const [label,r] of Object.entries({wallValid,wallPulse,wallInvalid,fire,fireBad,door,c4,c4Carrier}))assert.equal(r.errors,0,label+' GL error');
 // The preview draws something in the centre region, green-dominant when valid and red-dominant when not.
 assert.equal(empty.changed,0);
 assert.ok(wallValid.changed>0.2&&wallValid.dg>wallValid.dr,JSON.stringify(wallValid));
 assert.ok(wallInvalid.changed>0.2&&wallInvalid.dr>wallInvalid.dg,JSON.stringify(wallInvalid));
 // The emission alpha pulses (0.5 at t = 0, 0.75 at t = pi/16): greener.
 assert.ok(wallPulse.log.emission.a>wallValid.log.emission.a&&wallPulse.dg>wallValid.dg,JSON.stringify({wallValid,wallPulse}));
 assert.ok(fire.log.arrow&&fire.changed>0.01&&fire.dg>fire.dr,JSON.stringify(fire));assert.ok(fireBad.changed>0.01&&fireBad.dr>fireBad.dg,JSON.stringify(fireBad));
 assert.ok(door.log.arrow&&door.log.parts===1&&door.changed>0.05,JSON.stringify(door));
 // GameGizmoWaveAnimationCarrier: with a carrier the arrow hides and the wall itself is highlighted (more of the frame changes).
 assert.ok(c4.log.arrow&&!c4.log.carrier,JSON.stringify(c4.log));assert.ok(!c4Carrier.log.arrow&&c4Carrier.log.carrier,JSON.stringify(c4Carrier.log));
 assert.ok(c4Carrier.changed>c4.changed+0.05,JSON.stringify({c4,c4Carrier}));
 assert.equal(hidden.changed,0);
 assert.deepEqual(errors,[]);
 const result={ok:true,graphics:await readGraphics(page),empty,wallValid,wallPulse,wallInvalid,fire,fireBad,door,c4,c4Carrier,hidden,errors};
 await writeFile('analysis/browser-qa/placement.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
