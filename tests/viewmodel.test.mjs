import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3,Quaternion} from 'three';
import {deltaAngle,evaluateClampedTime,viewModelPose,unityEuler,eulerOf} from '../browser/viewmodel.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/viewmodels/manifest.json',import.meta.url)))):null;
const clips=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/viewmodels/'+manifest.clipsFile,import.meta.url)))):null;
const items=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))).items):null;
const byName=name=>Object.values(manifest.viewmodels).find(v=>v.name===name);

test('every held item with an original viewmodel maps to its exported prefab, skins and clips',needsAssets,()=>{
 const names=Object.keys(manifest.items).map(k=>items[k].data.m_Name).sort();
 for(const n of ['Rock','Hatchet','Stone Hatchet','Pick Axe','Torch','M4','MP5A4','P250','9mm Pistol','Revolver','Shotgun','Pipe Shotgun','Bolt Action Rifle','Hunting Bow','F1 Grenade','Supply Signal','Flare'])assert.ok(names.includes(n),n);
 for(const [key,v] of Object.entries(manifest.viewmodels)){assert.ok(v.skins.length>0,v.name);
  for(const s of v.skins)assert.ok(s.bones.every(b=>b>=0&&b<v.skeleton.length));
  for(const c of v.clips)assert.ok(clips[`${key}:${c}`],`${v.name}:${c}`);
  assert.ok(v.clips.includes(v.settings.deployAnimName??'deploy'),v.name);}
 assert.deepEqual(byName('VM-M4').clips.sort(),['deploy','fire_1','reload']);assert.ok(byName('VM-HuntingBow').clips.includes('drawarrow'));
});

test('every holdable item with a _viewModelPrefab has a viewmodels manifest entry (cab-datablock.000 Uber tools included)',needsAssets,()=>{
 const withVm=Object.entries(items).filter(([,v])=>v.data._viewModelPrefab?.m_PathID);
 assert.equal(withVm.length,20);
 for(const [k,v] of withVm){const vm=manifest.items[k];assert.ok(vm,v.data.m_Name);assert.ok(manifest.viewmodels[vm],v.data.m_Name);
  assert.ok(vm.endsWith(':'+v.data._viewModelPrefab.m_PathID),v.data.m_Name);assert.ok(manifest.viewmodels[vm].usedBy.some(u=>u.item===k),v.data.m_Name);}
 const key=name=>Object.keys(items).find(k=>items[k].data.m_Name===name),vmOf=name=>manifest.viewmodels[manifest.items[key(name)]].name;
 assert.ok(key('Uber Hatchet').startsWith('cab-datablock.000:'));
 assert.equal(vmOf('Uber Hatchet'),'VM-Hatchet');assert.equal(vmOf('Uber Hunting Bow'),'VM-HuntingBow');
 // The view model is shared; timings stay the item's own datablock fields (combat.mjs / resources.mjs read catalogue data).
 const uh=items[key('Uber Hatchet')].data,h=items[key('Hatchet')].data;
 assert.deepEqual([uh.fireRate,uh.midSwingDelay,uh.deployLength,uh.range].map(x=>+x.toFixed(3)),[0.2,0.1,0.1,3]);assert.notEqual(uh.fireRate,h.fireRate);
 const ub=items[key('Uber Hunting Bow')].data;assert.deepEqual([ub.drawLength,ub.fireRate,ub.deployLength,ub.arrowSpeed].map(x=>+x.toFixed(3)),[0.01,0.01,0.01,128]);
});

test('Mathf.DeltaAngle and CurveUtility.EvaluateClampedTime',()=>{
 assert.equal(deltaAngle(350,10),20);assert.equal(deltaAngle(10,350),-20);assert.equal(deltaAngle(0,180),180);
 const curve={m_Curve:[{time:0,value:0,inSlope:0,outSlope:0},{time:1,value:1,inSlope:0,outSlope:0}]},st={};
 assert.equal(evaluateClampedTime(curve,st,'t',0.25),0.15625);assert.equal(st.t,0.25);evaluateClampedTime(curve,st,'t',5);assert.equal(st.t,1);evaluateClampedTime(curve,st,'t',-9);assert.equal(st.t,0);
 assert.equal(evaluateClampedTime({m_Curve:[]},{},'t',1),1);
 const q=unityEuler(10,20,30);const back=unityEuler(...eulerOf(q));assert.ok(Math.abs(q.dot(back))>1-1e-9);
});

test('ViewModel pose: hip offset at rest; aiming brings the sight onto the eye axis over zoomInDuration',needsAssets,()=>{
 const def=byName('VM-M4'),s=def.settings,state={};
 const hip=viewModelPose({settings:{...s,barrelAiming:0}},state,{aim:false},1/60,10,{});assert.deepEqual(hip.position.map(v=>+v.toFixed(6)),[s.offset.x,s.offset.y,s.offset.z].map(v=>+v.toFixed(6)));assert.equal(hip.zoom,0);
 // With barrelAiming (M4 ships it on) the hip pose bends slightly toward the noHitPlane point (tests/fx-port.test.mjs covers BarrelAim).
 const bent=viewModelPose(def,{},{aim:false},1/60,10,{});assert.ok(bent.position.every((v,i)=>Math.abs(v-[s.offset.x,s.offset.y,s.offset.z][i])<0.01)&&Math.hypot(...bent.euler)>0.05);
 // A sight 0.1 m right and 0.05 m down, unrotated: fully zoomed, the root moves by the opposite vector plus zoomOffset.
 const sight={position:new Vector3(0.1,-0.05,0.2),rotation:new Quaternion()};let pose;
 for(let i=0;i<120;i++)pose=viewModelPose(def,state,{aim:true},1/60,20+i/60,{sight});
 assert.equal(pose.zoom,1);assert.ok(Math.abs(pose.position[0]-(-0.1+s.zoomOffset.x))<1e-6);assert.ok(Math.abs(pose.position[1]-(0.05+s.zoomOffset.y))<1e-6);assert.ok(Math.abs(pose.position[2]-(-0.2+s.zoomOffset.z))<1e-6);
 // Sprint lowering (bowAllowed) blends toward the bowPivot pose instead.
 const low=viewModelPose(def,{},{bow:true},10,30,{bowPivot:{position:new Vector3(),rotation:new Quaternion()}});assert.equal(low.bow,1);
 assert.deepEqual(low.position.map(v=>+v.toFixed(6)),[s.bowOffsetPoint.x,s.bowOffsetPoint.y,s.bowOffsetPoint.z].map(v=>+v.toFixed(6)));
});

test('zoom punch pushes the zoomed gun back after firing, from the recovered zoomPunch curve',needsAssets,()=>{
 const def=byName('VM-M4'),state={zoomTime:1,punchTime:5};const sight={position:new Vector3(),rotation:new Quaternion()};
 const at=t=>viewModelPose(def,{...state},{aim:true},0,t,{sight}).position[2];
 assert.ok(at(5.146)<at(10),'punched back right after the shot');
});
