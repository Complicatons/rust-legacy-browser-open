import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {cameraLayerDistances,waterRefresh,FrameLimiter,TerrainIdleRefresh,vectorAngle,renderCommand,maskLayers,REFLECTION_MASK_ON,REFLECTION_MASK_OFF} from '../browser/render-convars.mjs';
import {createLayerCuller,rendererCulled} from '../browser/layer-culling.mjs';
import {ConVars,CONVARS} from '../browser/convars.mjs';
import {moonBasis,rotateVector} from '../browser/sky-model.mjs';
import {treeAnimateVertex,windZoneForce} from '../browser/legacy-materials.mjs';
import {treeSettings} from '../browser/trees.mjs';

const recovered=async name=>{try{return JSON.parse(await readFile(new URL('../browser/assets/recovered/'+name,import.meta.url)));}catch{return null;}};
class MemoryStorage{constructor(){this.map=new Map();}getItem(k){return this.map.has(k)?this.map.get(k):null;}setItem(k,v){this.map.set(k,String(v));}}

test('CameraSettings raises CULL500 from 600 m by render.distance * 1000 m over the CameraLayerDepths values',async()=>{
 const index=name=>({CULL500:12,Sprite:11})[name]??-1,view=[{Name:'CULL500',MinimumValue:600,MaximumValue:1600}],depths={layer11:5,layer12:600};
 assert.equal(cameraLayerDistances(depths,view,0.2,index)[12],800);assert.equal(cameraLayerDistances(depths,view,0,index)[12],600);assert.equal(cameraLayerDistances(depths,view,1,index)[12],1600);
 const d=cameraLayerDistances(depths,view,0.2,index);assert.equal(d[11],5);assert.equal(d.length,32);assert.equal(d.filter(v=>v!==0).length,2);
 // The exported Scene Camera carries exactly these components (tools/export_quality.py).
 const q=await recovered('quality/manifest.json');if(!q)return;
 const comp=t=>q.camera.components.find(c=>c.type===t).params;
 assert.deepEqual(comp('CameraSettings').ViewDistanceLayers,view);assert.equal(comp('CameraLayerDepths').layer12,600);assert.equal(comp('CameraLayerDepths').layer11,5);assert.equal(comp('CameraLayerDepths').spherical,1);
});

test('WaterSettings.RefreshSettings: render.level thresholds, water.level override and reflection masks',()=>{
 assert.deepEqual([0,0.4,0.6,0.8,0.81,1].map(l=>waterRefresh(l).waterQuality),[0,0,1,1,2,2]);
 assert.equal(waterRefresh(1).edgeBlend,true);assert.equal(waterRefresh(0.6).edgeBlend,false);
 // water.level: quality clamp(level - 1, 0, 2), edge blend only for level 2.
 assert.deepEqual([0,1,2,3,4,9].map(l=>[waterRefresh(1,l).waterQuality,waterRefresh(1,l).edgeBlend]),[[0,false],[0,false],[1,true],[2,false],[2,false],[2,false]]);
 assert.deepEqual(waterRefresh(0,3),{...waterRefresh(0,3),waterQuality:2,edgeBlend:false});
 assert.deepEqual(waterRefresh(0,-1,true).reflectionLayers,[12,19,22,23]);assert.deepEqual(waterRefresh(0,-1,false).reflectionLayers,[23]);
 assert.equal(REFLECTION_MASK_ON,13111296);assert.equal(REFLECTION_MASK_OFF,8388608);assert.deepEqual(maskLayers(1<<4),[4]);
});

test('render.frames: targetFrameRate caps a requestAnimationFrame loop without drift',()=>{
 const run=(fps,hz,seconds=2)=>{const l=new FrameLimiter(fps);let n=0;for(let t=0;t<seconds*1000;t+=1000/hz)if(l.shouldRun(t))n++;return n/seconds;};
 assert.equal(run(-1,60),60);assert.equal(run(0,60),60);
 assert.ok(Math.abs(run(30,60)-30)<=1,String(run(30,60)));assert.ok(Math.abs(run(60,144)-60)<=2,String(run(60,144)));assert.ok(Math.abs(run(60,60)-60)<=1);
 const l=new FrameLimiter(30);l.shouldRun(0);l.target=-1;assert.equal(l.shouldRun(1),true);
});

test('terrain.idleinterval: TerrainControl forces a tree refresh only while the camera stays still',()=>{
 const r=new TerrainIdleRefresh(3.2),fwd=[0,0,1];let pos=[0,0,0];const fires=[];
 for(let i=0;i<=200;i++){const t=i*0.1;if(t<5)pos=[t,0,0];if(r.update(t,pos,fwd))fires.push(+t.toFixed(1));}
 // moving until 4.9 s, then still: first refresh once more than 3.2 s have passed, then every 3.2 s.
 assert.deepEqual(fires,[8.2,11.4,14.6,17.8]);
 // turning more than 0.5 degrees counts as a camera change; less does not.
 const t2=new TerrainIdleRefresh(1);t2.update(0,[0,0,0],[0,0,1]);const small=[Math.sin(0.4*Math.PI/180),0,Math.cos(0.4*Math.PI/180)];
 assert.equal(t2.update(0.6,[0,0,0],small),false);assert.equal(t2.update(1.1,[0,0,0],small),true);
 assert.equal(t2.update(1.2,[0,0,0],[1,0,0]),false);assert.equal(t2.update(2.1,[0,0,0],[1,0,0]),false);assert.equal(t2.update(2.3,[0,0,0],[1,0,0]),true);
 // tiny moves below 0.0075 m do not reset the timer
 const t3=new TerrainIdleRefresh(1);t3.update(0,[0,0,0],fwd);t3.update(0.5,[0.005,0,0],fwd);assert.equal(t3.update(1.05,[0.006,0,0],fwd),true);
 // 0 or less: never forced
 const off=new TerrainIdleRefresh(0);let any=false;for(let i=0;i<100;i++)any||=off.update(i,[0,0,0],fwd);assert.equal(any,false);
 assert.equal(vectorAngle([0,0,1],[0,0,0]),90);assert.ok(Math.abs(vectorAngle([1,0,0],[0,1,0])-90)<1e-9);
});

test('render/water/terrain console variables: types, ranges, saved flags and the set event',()=>{
 const storage=new MemoryStorage(),c=new ConVars(storage);
 assert.equal(c.get('render.distance'),0.2);assert.equal(c.get('render.frames'),-1);assert.equal(c.get('water.level'),-1);assert.equal(c.get('terrain.idleinterval'),3.2);assert.equal(c.get('terrain.manual'),false);
 assert.equal(c.command('render.distance 3').text,'render.distance: 1');assert.equal(c.command('render.frames 60').text,'render.frames: 60');assert.equal(c.command('render.frames 60.5').ok,false);
 assert.equal(c.command('water.level 2').text,'water.level: 2');assert.equal(c.command('terrain.idleinterval 0').text,'terrain.idleinterval: 0');assert.equal(c.command('terrain.manual true').text,'terrain.manual: True');
 const saved=JSON.parse(storage.getItem('rlb-convars'));assert.equal(saved['render.distance'],1);assert.equal(saved['render.frames'],60);assert.equal(saved['water.level'],2);
 assert.equal('terrain.idleinterval' in saved,false);assert.equal('terrain.manual' in saved,false);
 const again=new ConVars(storage);assert.equal(again.get('render.frames'),60);assert.equal(again.get('terrain.idleinterval'),3.2);
 // a stray saved terrain value is not restored ([Client] only)
 storage.setItem('rlb-convars',JSON.stringify({...saved,'terrain.idleinterval':9}));assert.equal(new ConVars(storage).get('terrain.idleinterval'),3.2);
 const events=[];again.addEventListener('set',e=>events.push([e.name,e.changed]));again.set('render.level',String(again.get('render.level')));again.set('render.distance','0.5');
 assert.deepEqual(events,[['render.level',false],['render.distance',true]]);
 assert.equal(CONVARS['render.distance'].min,0);assert.equal(CONVARS['render.distance'].max,1);
 let refreshed=0;assert.deepEqual(renderCommand('render.update',{refresh:()=>refreshed++}),{ok:true,text:''});assert.equal(refreshed,1);assert.equal(renderCommand('render.distance',{}),null);
 let flushed=0;assert.deepEqual(renderCommand('terrain.flushtrees',{flushTrees:()=>flushed++}),{ok:true,text:''});assert.equal(flushed,1);
 // terrain.manual at level load keeps the scene Terrain's serialized tree settings (no RestoreTerrainSettings)
 const m={treeRendering:{effective:{treeDistance:2000,treeBillboardDistance:214,treeCrossFadeLength:5,treeMaximumFullLODCount:60},serializedTerrain:{treeDistance:2000,treeBillboardDistance:171,treeCrossFadeLength:13.1,treeMaximumFullLODCount:25}}};
 assert.equal(treeSettings(m).treeBillboardDistance,214);assert.deepEqual(treeSettings(m,{manual:true}),{treeDistance:2000,treeBillboardDistance:171,treeCrossFadeLength:13.1,treeMaximumFullLODCount:25});
});

test('per-layer culling: CULL500 by spherical centre distance, other layers by the far plane, reflection sees all',()=>{
 assert.equal(rendererCulled([0,0,801],1,[0,0,0],[0,0,1],800,6000),true);assert.equal(rendererCulled([0,0,799],1,[0,0,0],[0,0,1],800,6000),false);
 assert.equal(rendererCulled([0,700,700],1,[0,0,0],[0,0,1],800,6000),true,'spherical: the full 3-D distance');
 assert.equal(rendererCulled([0,0,6100],50,[0,0,0],[0,0,1],0,6000),true);assert.equal(rendererCulled([0,0,6040],50,[0,0,0],[0,0,1],0,6000),false);assert.equal(rendererCulled([6100,0,0],50,[0,0,0],[0,0,1],0,6000),false,'far plane is planar');
 const root=new THREE.Group(),geo=new THREE.BoxGeometry(),mat=new THREE.MeshBasicMaterial();
 const near=new THREE.Group();near.userData={layer:12,worldBounds:[[-1,-1,-101],[1,1,-99]]};near.add(new THREE.Mesh(geo,mat));root.add(near);
 const far=new THREE.Group();far.userData={layer:12,worldBounds:[[-1,-1,-1001],[1,1,-999]]};far.add(new THREE.Mesh(geo,mat));root.add(far);
 const other=new THREE.Group();other.userData={layer:0,worldBounds:[[-1,-1,-1001],[1,1,-999]]};other.add(new THREE.Mesh(geo,mat));root.add(other);
 const inst=new THREE.InstancedMesh(geo,mat,3),m=new THREE.Matrix4();[[0,0,-10],[0,0,-900],[0,0,-20]].forEach((p,i)=>inst.setMatrixAt(i,m.makeTranslation(...p)));
 inst.userData={layer:12,instanceBounds:[[[-1,-1,-11],[1,1,-9]],[[-1,-1,-901],[1,1,-899]],[[-1,-1,-21],[1,1,-19]]]};root.add(inst);root.updateMatrixWorld(true);
 const distances=new Array(32).fill(0);distances[12]=800;const culler=createLayerCuller({far:6000,distances});culler.addScene(root);
 const camera=new THREE.PerspectiveCamera();camera.updateMatrixWorld(true);culler.apply(camera);
 assert.equal(near.children[0].layers.isEnabled(0),true);assert.equal(far.children[0].layers.isEnabled(0),false);assert.equal(other.children[0].layers.isEnabled(0),true);
 assert.equal(inst.count,2);const z=i=>{inst.getMatrixAt(i,m);return new THREE.Vector3().setFromMatrixPosition(m).z;};assert.deepEqual([z(0),z(1),z(2)],[-10,-20,-900],'visible instances first, original order');
 culler.suspend();assert.equal(inst.count,3);culler.resume();assert.equal(inst.count,2);
 culler.setDistances(distances.map((v,i)=>i===12?1600:v));culler.apply(camera);assert.equal(inst.count,3);assert.equal(far.children[0].layers.isEnabled(0),true);
 camera.position.set(0,0,5000);camera.updateMatrixWorld(true);culler.apply(camera);assert.equal(inst.count,0);assert.equal(inst.layers.isEnabled(0),false);
 // reflection pass (layer 30 only) keeps seeing culled containers
 assert.equal(culler.stats().objects,3);assert.equal(culler.stats().instances,3);
});

test('moon roll: LookAt(centre, previous up) keeps the serialized RustSky/Moon roll instead of the world up',async()=>{
 const pos=t=>[Math.cos(t)*0.2,Math.sin(t),Math.cos(t)*0.98].map((v,_,a)=>v/Math.hypot(...a));
 let up=[0.3,0.2,0.93],prev=null;const ups=[];
 for(let i=0;i<=200;i++){const b=moonBasis(pos(i*0.01),up,prev);up=b.up;prev=b;ups.push(b);}
 for(const b of ups){assert.ok(Math.abs(Math.hypot(...b.right)-1)<1e-9);assert.ok(Math.abs(b.right[0]*b.forward[0]+b.right[1]*b.forward[1]+b.right[2]*b.forward[2])<1e-9);}
 // differs from the world-up construction (the old approximation) while staying continuous
 const world=moonBasis(pos(2));assert.ok(Math.hypot(...world.up.map((v,i)=>v-up[i]))>0.05);
 for(let i=1;i<ups.length;i++)assert.ok(Math.hypot(...ups[i].up.map((v,k)=>v-ups[i-1].up[k]))<0.05);
 // degenerate: up parallel to forward keeps the previous frame
 const keep=moonBasis([0,-1,0],[0,1,0],ups[5]);assert.equal(keep,ups[5]);
 const extras=await recovered('render-extras.json');if(!extras)return;
 const r=extras.moon.localRotation,q=[r.x,r.y,r.z,r.w],p=extras.moon.localPosition,f=rotateVector(q,[0,0,1]);
 assert.ok(Math.hypot(f[0]+p.x,f[1]+p.y,f[2]+p.z)<1e-5,'serialized moon looks at the dome centre');
 const b=moonBasis([p.x,p.y,p.z],rotateVector(q,[0,1,0]));assert.ok(Math.hypot(...b.up.map((v,i)=>v-extras.moon.up[i]))<1e-6);
});

test('Tree Creator AnimateVertex and the scene WindZone',async()=>{
 const still=treeAnimateVertex([1,2,3],[0,1,0],[0.5,1,0.4,0.6],[0,0,0,0],10);assert.deepEqual(still,[1,2,3]);
 // primary bending: a constant lean along _Wind.xyz (no turbulence)
 const lean=treeAnimateVertex([1,2,3],[0,1,0],[0.5,0,0.4,0],[0,0,0.25,0],7);assert.ok(Math.abs(lean[2]-3.1)<1e-12&&lean[0]===1&&lean[1]===2);
 // secondary: branch bending moves y with the slow waves and stays bounded
 let lo=Infinity,hi=-Infinity;for(let t=0;t<20;t+=0.05){const p=treeAnimateVertex([0,5,0],[0,0,0],[0.3,0,0,1],[0,0,0.25,0.25],t);lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1]);}
 assert.ok(hi-lo>0.05&&hi-lo<0.5,String([lo,hi]));
 const zone={windMain:0.25,windTurbulence:0.25,windPulseMagnitude:0.5,windPulseFrequency:0.01,forward:[0,0,1]};
 const f0=windZoneForce(zone,0);assert.ok(Math.abs(f0[2]-0.25*(1+0.5*0.999))<1e-12&&f0[0]===0&&Math.abs(f0[3]-f0[2])<1e-12);
 const extras=await recovered('render-extras.json');if(!extras)return;
 assert.deepEqual({mode:extras.windZone.mode,main:extras.windZone.windMain,turbulence:extras.windZone.windTurbulence,forward:extras.windZone.forward},{mode:0,main:0.25,turbulence:0.25,forward:[0,0,1]});
 assert.deepEqual(extras.treeWind.map(t=>t.vertices),[2611,3319,5167,1307]);
 for(const t of extras.treeWind){assert.equal(t.branchPhase.length,t.vertices);assert.ok(t.edgeFlutter.every(v=>v>=0&&v<=255));}
});
