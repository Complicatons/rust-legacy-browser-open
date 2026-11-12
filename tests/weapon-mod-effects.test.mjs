import test from 'node:test';import assert from 'node:assert/strict';import {Matrix4,Vector3} from 'three';
import {laserTrace,modEnabled,modNodeMatrices,alphaMaskPixels} from '../browser/weapon-mod-effects.mjs';
test('original alpha-only masks remain visible as cookie RGB and additive laser opacity',()=>{
 const pixels=new Uint8Array([0,0,0,0,0,0,0,128,0,0,0,255]);assert.deepEqual([...alphaMaskPixels(pixels,true)],[0,0,0,255,128,128,128,255,255,255,255,255]);assert.deepEqual([...alphaMaskPixels(pixels)],[255,255,255,0,255,255,255,128,255,255,255,255]);assert.equal(pixels[4],0);
});
test('lamp and laser follow their independent native CharacterStateFlags',()=>{
 assert.equal(modEnabled({modFlag:1},2048),true);assert.equal(modEnabled({modFlag:1},4096),false);assert.equal(modEnabled({modFlag:2},4096),true);assert.equal(modEnabled({modFlag:2},2048),false);assert.equal(modEnabled({modFlag:1},0),false);
});
test('laser uses socket forward, native masks, hit distance widths and no dot target on a miss',()=>{
 const data={beamMaxDistance:100,beamLayers:{m_Bits:1703937},beamWidthStart:0.075,beamWidthEnd:0.1,dotRadiusStart:0.1,dotRadiusEnd:1},matrix=new Matrix4().makeTranslation(10,2,30);
 const hit=laserTrace(data,matrix,(ray,range,mask)=>{assert.deepEqual(ray.direction.toArray(),[0,0,-1]);assert.equal(range,100);assert.equal(mask,1703937);return {position:ray.at(25,new Vector3()),normal:new Vector3(0,0,1)};});
 assert.deepEqual(hit.point.toArray(),[10,2,5]);assert.equal(hit.distance,25);assert.equal(hit.dotRadius,0.325);assert.ok(Math.abs(hit.pointWidth-0.08125)<1e-12);
 const miss=laserTrace(data,matrix,()=>null);assert.equal(miss.hit,null);assert.deepEqual(miss.point.toArray(),[10,2,-70]);assert.equal(miss.distance,100);
 assert.equal(laserTrace({...data,beamLayers:{m_Bits:0}},matrix,()=>{throw Error('zero mask must not raycast');}).hit,null);
});
test('effect child transforms reflect Unity once and ignore prefab root authoring position/rotation',()=>{
 const root={position:[9,8,7],rotation:[0,1,0,0],scale:[1,1,1],parent:-1},child={position:[0,0,2],rotation:[0,0,0,1],scale:[1,1,1],parent:0};
 const [a,b]=modNodeMatrices({skeleton:[root,child]});assert.deepEqual(new Vector3().setFromMatrixPosition(a).toArray(),[0,0,0]);assert.deepEqual(new Vector3().setFromMatrixPosition(b).toArray(),[0,0,-2]);
});
test('LaserGraphics range colours, RenderBeam widths per end and the two-quad dot',async()=>{
 const {rangeColor,laserFrame}=await import('../browser/weapon-mod-effects.mjs');
 assert.deepEqual(rangeColor([0.337*0.5,0,0],1),[1,0,0,Math.round(0.1685*255)/255]);assert.deepEqual(rangeColor([3,0,0],12),[1,0,0,Math.round(0.25*255)/255]);assert.deepEqual(rangeColor([0,0,0],12),[0,0,0,Math.round(255/12)/255]);
 const d={beamMaxDistance:100,beamWidthStart:0.075,beamWidthEnd:0.1,beamOutput:0.9,beamColor:{x:0.337,y:0,z:0,w:1},dotColor:{x:3,y:0,z:0,w:1}},id=new Matrix4();
 const trace={origin:new Vector3(0,-1,-5),point:new Vector3(0,-1,-25),hit:{normal:new Vector3(0,0,1)},distance:20,fraction:0.2,pointWidth:0.08,dotRadius:0.28};
 const f=laserFrame(d,trace,id,id);const [m0,m1,m2,m3]=f.beam.positions;
 assert.ok(Math.abs(m0.distanceTo(m1)-0.075)<1e-9&&Math.abs(m2.distanceTo(m3)-0.08)<1e-9);assert.ok(m0.x>0&&m2.x>0);assert.deepEqual(f.beam.uvs[3],[0.2,1]);assert.deepEqual(f.beam.normals[2],[0.08,-20]);
 assert.equal(f.dot.quads.length,2);assert.ok(f.dot.quads[1].every(v=>Math.abs(v.z+25-0.01)<1e-9));
 assert.equal(laserFrame(d,{...trace,hit:{normal:new Vector3(0,0,-1)}},id,id).dot,null);assert.equal(laserFrame(d,trace,id,id,()=>false).dot,null);
 const miss=laserFrame(d,{...trace,hit:null},id,id);assert.equal(miss.dot,null);assert.deepEqual(miss.beam.uvs[2],[1,0]);assert.deepEqual(miss.beam.normals[0],[0.075,-100]);
});
