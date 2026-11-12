import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PerspectiveCamera,Quaternion,Vector3,Matrix4} from 'three';
import {HeadBob,BobPunch,bobCurve,bobForce,bobSmooth,bobViewMatrix,withHeadBob} from '../browser/head-bob.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const data=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/headbob.json',import.meta.url)))):null,near=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const key=(time,value)=>({time,value,inSlope:1,outSlope:1}),curve=(mode=2)=>({m_Curve:[key(0,0),key(1,1)],m_PreInfinity:mode,m_PostInfinity:mode});
const sample=(x=0,z=0)=>({position:new Vector3(x,2,z),quaternion:new Quaternion(),grounded:true,input:[0,0,0]});

test('serialized curve wrapping handles negative phase, repeat, ping-pong and clamps',()=>{
 near(bobCurve(curve(1),1.25),0.25);near(bobCurve(curve(1),-0.25),0.75);near(bobCurve(curve(1),2.25),0.25);
 near(bobCurve(curve(2),2),1);near(bobCurve(curve(2),-1),0);
 near(bobCurve(curve(0),1.25),0.75);near(bobCurve(curve(0),-0.25),0.25);
});
test('force phase advances while masked, wraps at eight curve durations and preserves source scaling',()=>{
 const c={positionScale:{x:1,y:1,z:1},outputScale:{x:2,y:3,z:4},forceX:curve(1),forceY:curve(1),forceZ:curve(1),sourceMask:{m_Curve:[key(0,0),key(1,0)]},sourceScale:{m_Curve:[]}},phase=[0,0,0];
 assert.deepEqual(bobForce(c,phase,1,0.25),[0,0,0]);assert.deepEqual(phase,[0.25,0.25,0.25]);
 c.sourceMask.m_Curve=[];assert.deepEqual(bobForce(c,phase,1,0.25),[1,1.5,2]);bobForce(c,phase,1,8);assert.deepEqual(phase,[0.5,0.5,0.5]);
 c.sourceMask.m_Curve=[key(0,0)];bobForce(c,phase,1,1);assert.deepEqual(phase,[0.5,0.5,0.5]);
});
test('Vector3G impulse smoothing clamps the vector magnitude',()=>{
 const v=[0,0,0],out=bobSmooth([0,0,0],[100,100,100],v,0.02,1800,0.01);
 near(out[0],out[1]);near(out[1],out[2]);assert.ok(Math.hypot(...out)<36);assert.ok(v.every(Number.isFinite));
});
test('shipped 100 Hz solver stays still at rest, responds to movement, stops and resets',needsAssets,()=>{
 assert.deepEqual(data.effectOrder,['LazyCam','HeadBob']);assert.equal(data.config.solveRate,100);assert.equal(data.config.additionalCurves.length,4);
 const b=new HeadBob(data);for(let i=0;i<120;i++)b.update(1/60,sample());assert.deepEqual(b.output,{position:[0,0,0],rotation:[0,0,0]});
 let largest=0;for(let i=0;i<120;i++){const s=sample(0,-i/12);s.input=[0,0,1];b.update(1/60,s);largest=Math.max(largest,Math.hypot(...b.output.rotation));}
 assert.ok(largest>0.1);for(let i=0;i<1200;i++)b.update(1/60,sample(0,-119/12));assert.ok(Math.hypot(...b.output.position)<0.001);assert.ok(Math.hypot(...b.output.rotation)<0.1);
 b.reset();assert.deepEqual(b.output,{position:[0,0,0],rotation:[0,0,0]});assert.equal(b.fraction,0);
});
test('fixed integration gives the same constant-input state for different frame partitions',needsAssets,()=>{
 const conf=structuredClone(data);conf.config.additionalCurves=[];conf.config.impulseForceScale={x:0,y:0,z:0};
 const run=dt=>{const b=new HeadBob(conf);for(let i=0;i<Math.round(2/dt);i++)b.update(dt,{...sample(),input:[1,0,0]});return b;};
 const a=run(1/60),b=run(1/100);a.position.value.forEach((v,i)=>near(v,b.position.value[i]));
});
test('spring uses the change in applied force, then damped Euler integration',needsAssets,()=>{
 const conf=structuredClone(data);conf.config.additionalCurves=[];conf.config.impulseForceScale={x:0,y:0,z:0};
 const b=new HeadBob(conf),s={...sample(),input:[1,0,0]};b.update(0.01,s);near(b.position.velocity[0],1);near(b.position.value[0],0.01);
 b.update(0.01,s);near(b.position.velocity[0],0.9475000011920929);near(b.position.value[0],0.01947500001192093);
});
test('ground curves stop progressing in the air and angular sampling crosses 180 by the shortest arc',needsAssets,()=>{
 const b=new HeadBob(data);b.update(0.02,sample());b.update(0.02,sample(0,-0.1));const phases=structuredClone(b.phases);
 b.update(0.02,{...sample(0,-0.2),grounded:false});assert.deepEqual(b.phases,phases);
 for(const deg of [179,-179])b.update(0.02,{...sample(),quaternion:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),deg*Math.PI/180)});
 assert.ok(Math.abs(b.torqueSampler.samples[0].vector[1])<101);
 const saved=structuredClone(b.output);for(const dt of [0,-1,NaN])assert.deepEqual(b.update(dt,sample()),saved);
});
test('camera render offsets are visible inside a draw and restore true eye after success or failure',()=>{
 const c=new PerspectiveCamera();c.position.set(1,2,3);c.rotation.set(0.2,1.1,0,'YXZ');c.updateMatrixWorld(true);const p=c.position.clone(),q=c.quaternion.clone(),output={position:[0.1,0.2,0.3],rotation:[1,2,3]};
 const draw=()=>{assert.ok(c.position.distanceTo(p)>0.3);assert.ok(c.quaternion.angleTo(q)>0.01);};
 for(let i=0;i<50;i++)withHeadBob(c,q,output,draw);assert.deepEqual(c.position.toArray(),p.toArray());assert.deepEqual(c.quaternion.toArray(),q.toArray());
 assert.throws(()=>withHeadBob(c,q,output,()=>{draw();throw Error('draw failed');}),/draw failed/);assert.deepEqual(c.position.toArray(),p.toArray());assert.deepEqual(c.quaternion.toArray(),q.toArray());
});
test('weapon anti-output uses axis swizzles and cancels the camera local translation',needsAssets,()=>{
 const output={position:[1,2,3],rotation:[0,0,0]},m=bobViewMatrix(output,[{positionalAxes:0,positional:{x:1.2,y:1.2,z:1.2},rotationalAxes:0,rotational:{x:0,y:0,z:1.5}}]);
 const p=new Vector3().setFromMatrixPosition(m);near(p.x,0.2);near(p.y,0.4);near(p.z,-0.6);
 assert.deepEqual(bobViewMatrix({position:[0,0,0],rotation:[0,0,0]},data.config.antiOutputs).toArray(),new Matrix4().toArray());
});
test('native punches stack, expire and continue through the spring after the effect ends',needsAssets,()=>{
 const b=new HeadBob(data);for(let i=0;i<150;i++)b.update(1/60,sample());const id=Object.values(data.shotEffects)[0];assert.ok(id);
 assert.equal(b.addEffect(id),true);assert.equal(b.addEffect(id),true);assert.equal(b.addEffect('unknown'),false);b.update(0.02,sample());assert.equal(b.effects.length,2);assert.ok(b.output.rotation[0]>0);
 for(let i=0;i<20;i++)b.update(0.01,sample());assert.equal(b.effects.length,0);assert.ok(Math.hypot(...b.rotation.value)>0);assert.equal(b.effectStarts,2);
 for(let i=0;i<1000;i++)b.update(0.01,sample());assert.deepEqual(b.output.rotation,[0,0,0]);
 // Preserve the native endValue comparison, even though endTime would normally be expected here.
 const punch=new BobPunch({_x:{m_Curve:[key(0,1),key(1,0)]}});punch.step(0.1);assert.equal(punch.step(0.1)[0],0);
});
