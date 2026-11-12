import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3,Quaternion,Box3} from 'three';
import {ADAPTIVE_NEAR_PLANE as S,adaptiveNearMask,adaptiveNearPlane,boundsTouchSphere} from '../browser/adaptive-near-plane.mjs';

// A camera at the origin looking down -z (three's camera space) and a wall plane z = -D in front of it.
const camera=(matrix=new Matrix4())=>({matrixWorld:matrix,fov:70,aspect:16/9});
const wall=D=>(o,d,max)=>{if(d[2]>=0||o[2]<=-D)return null;const t=(-D-o[2])/d[2];return t<=max?t:null;};
// Matrix4x4G.Perspective(n = 0.22, f = 0.70) with OpenGL depth: NDC z 0 is at 2nf / (n + f), z 1 at f.
const n=S.minNear,f=S.maxNear+S.threshold,start=2*n*f/(n+f);
const expected=D=>Math.min(S.maxNear,Math.max(S.minNear,n+(D-start)/(f-start)*(f-n)-S.threshold));

test('AdaptiveNearPlane data and mask: 0.22..0.65 m, threshold 0.05, every layer but 16 (characters) and 17 (hit boxes)',()=>{
 assert.equal(S.maxNear,Math.fround(0.65));assert.equal(S.minNear,Math.fround(0.22));assert.equal(S.threshold,Math.fround(0.05));
 const mask=adaptiveNearMask();assert.equal((mask>>>16)&1,0);assert.equal((mask>>>17)&1,0);for(const l of [0,10,19,21,27])assert.equal((mask>>>l)&1,1,'layer '+l);
});

test('CameraFX.PostPreCull: nothing near keeps maxNear; a wall maps its hit fraction onto minNear..maxNear + threshold',()=>{
 assert.deepEqual(adaptiveNearPlane(camera(),()=>null),{near:S.maxNear,hits:0,nearest:null});
 for(const D of [0.40,0.45,0.55,0.62]){const r=adaptiveNearPlane(camera(),wall(D));assert.equal(r.hits,64,'every grid ray hits a wall');assert.ok(Math.abs(r.near-expected(D))<2e-6,`${D}: ${r.near} vs ${expected(D)}`);}
 assert.ok(Math.abs(adaptiveNearPlane(camera(),wall(0.45)).near-0.3214)<1e-4);
 // Clamped to minNear just past the segment starts; beyond the far end no ray reaches it.
 assert.equal(adaptiveNearPlane(camera(),wall(0.34)).near,S.minNear);assert.equal(adaptiveNearPlane(camera(),wall(0.8)).near,S.maxNear);
 // A wall closer than the segments' start (NDC z 0, 0.335 m) is never hit: the original keeps maxNear there too.
 assert.equal(adaptiveNearPlane(camera(),wall(0.3)).near,S.maxNear);
});

test('the grid follows the camera pose and only the nearest hit per segment counts',()=>{
 const pose=new Matrix4().compose(new Vector3(5,2,-3),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2),new Vector3(1,1,1));
 // Looking down -x from x = 5: a wall at x = 5 - 0.45.
 const r=adaptiveNearPlane(camera(pose),(o,d,max)=>{if(d[0]>=0)return null;const t=(5-0.45-o[0])/d[0];return t>=0&&t<=max?t:null;});
 assert.ok(Math.abs(r.near-expected(0.45))<2e-6);
 // One corner ray hitting something nearer drives the result (min over the grid).
 let calls=0;const one=adaptiveNearPlane(camera(),(o,d,max)=>++calls===1?max*0.1:null);assert.equal(calls,64);assert.equal(one.hits,1);
 assert.ok(Math.abs(one.near-Math.max(S.minNear,n+0.1*(f-n)-S.threshold))<1e-6);
});

test('Physics.OverlapSphere (Unity 4) takes colliders by their bounds',()=>{
 const box=new Box3(new Vector3(1,0,0),new Vector3(2,1,1));
 assert.equal(boundsTouchSphere(box,new Vector3(0.2,0.5,0.5),0.87),true);assert.equal(boundsTouchSphere(box,new Vector3(0,0.5,0.5),0.87),false);
 assert.equal(boundsTouchSphere(box,new Vector3(1.5,0.5,0.5),0.1),true,'inside');
});
