import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone,Quaternion,Vector3} from 'three';
import {CameraSway,rotateSocket,withSocketSway} from '../browser/camera-sway.mjs';
const yaw=degrees=>new Quaternion().setFromAxisAngle(new Vector3(0,1,0),degrees*Math.PI/180);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('LazyCam keeps a bounded dead zone and leaves the true aim unchanged',()=>{
 const cam=new CameraSway(),start=yaw(179);for(let i=0;i<120;i++)cam.update(start,1/60,{angle:1,allow:true});
 const aim=yaw(-151),saved=aim.clone(),result=cam.update(aim,1/60,{angle:1,allow:true});
 near(cam.angle,1);assert.ok(aim.equals(saved));near(result.view.clone().multiply(result.counter).angleTo(aim),0);
 const still=cam.update(aim,1/60,{angle:1,allow:true});near(still.view.angleTo(result.view),0);
 // Quaternion shortest arc across +/-180, including a motion smaller than the dead zone.
 cam.view.copy(start);cam.update(yaw(-180.5),0,{angle:1,allow:true});near(cam.angle,0.5);
});

test('aim/sprint disable ramps sway off, zero-angle items settle and zero dt remains finite',()=>{
 const cam=new CameraSway();for(let i=0;i<30;i++)cam.update(yaw(i*3),1/60,{angle:1,allow:true});
 assert.equal(cam.fraction,1);assert.ok(cam.angle>0.9);
 for(let i=0;i<120;i++)cam.update(yaw(i*3),1/60,{angle:1,allow:false});
 assert.equal(cam.fraction,0);assert.equal(cam.maxAngle,0);near(cam.angle,0);
 for(let i=0;i<120;i++)cam.update(yaw(i*5),1/60,{angle:0,allow:true});near(cam.angle,0);
 for(const dt of [0,NaN,-1]){const r=cam.update(yaw(30),dt);assert.ok(r.view.toArray().every(Number.isFinite));}
});

test('CameraSpace socket rotation keeps the socket point fixed with scaled/rotated bones',()=>{
 const b=new Bone();b.position.set(1,2,3);b.scale.setScalar(0.5);b.quaternion.copy(yaw(37));b.updateMatrixWorld(true);
 const offset=[0.1,-0.3,0.7],point=new Vector3(...offset).applyMatrix4(b.matrixWorld);
 rotateSocket(b,offset,yaw(13));b.updateMatrixWorld(true);near(point.distanceTo(new Vector3(...offset).applyMatrix4(b.matrixWorld)),0);
});

test('two original pivots translate the weapon and restore all bones after successful or failed draws',()=>{
 const b=new Bone();b.position.set(0.1,-0.2,0.3);b.quaternion.copy(yaw(23));const pos=b.position.clone(),rot=b.quaternion.clone();
 const sockets={pivot:{bone:0,offset:[0,-0.06,-0.19]},pivot2:{bone:0,offset:[0,0,-0.38]}};
 const draw=()=>{assert.ok(b.position.distanceTo(pos)>0.001);near(b.quaternion.angleTo(rot),0);};
 for(let i=0;i<20;i++)withSocketSway([b],sockets,yaw(1),draw);
 assert.deepEqual(b.position.toArray(),pos.toArray());assert.deepEqual(b.quaternion.toArray(),rot.toArray());
 assert.throws(()=>withSocketSway([b],sockets,yaw(1),()=>{draw();throw Error('drawing failed');}),/drawing failed/);
 assert.deepEqual(b.position.toArray(),pos.toArray());assert.deepEqual(b.quaternion.toArray(),rot.toArray());
});
