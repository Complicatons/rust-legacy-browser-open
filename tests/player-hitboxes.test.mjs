import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Matrix4,Ray} from 'three';
import {PlayerHitBox} from '../browser/player-hitboxes.mjs';
import {CollisionWorld} from '../browser/collision.mjs';
const shape=(kind,extra={})=>({kind,bodyPart:16,bone:0,inversion:0,origin:{x:0,y:0,z:0},directionOrSize:{x:0,y:1,z:0},length:2,radius:0.5,...extra});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('original capsule endpoints, side and cap rays retain native body-part identity',()=>{
 const world=new CollisionWorld(),body=world.addBody(new PlayerHitBox(shape(2),42));body.setMotion(new Matrix4().makeTranslation(10,3,-5));
 for(const [origin,direction,distance] of [[[10,4,-8],[0,0,1],2.5],[[10,7,-5],[0,-1,0],1.5],[[10,1,-5],[0,1,0],1.5]]){
  const ray=new Ray(new Vector3(...origin),new Vector3(...direction)),hit=world.raycast(ray,10);near(hit.distance,distance);assert.equal(hit.body.bodyPart,16);assert.equal(hit.body.onlineActor.viewId,42);near(hit.normal.length(),1);assert.equal(world.raycast(ray,distance-0.01),null);
 }
 assert.equal(world.raycast(new Ray(new Vector3(11,4,-8),new Vector3(0,0,1)),10),null);
 assert.ok(!world.capsuleHit(world.capsule(new Vector3(10,3,-5),1.8,0.4)),'hit regions do not obstruct movement');
 world.removeBody(body);assert.equal(world.bodies.length,0);
});
test('reflected and scaled bone matrices return world-space normals and exact box/sphere edges',()=>{
 for(const s of [shape(1),shape(4,{directionOrSize:{x:1,y:1,z:1}})]){
  const world=new CollisionWorld(),body=world.addBody(new PlayerHitBox(s,7));body.setMotion(new Matrix4().makeScale(2,2,-2));
  const hit=world.raycast(new Ray(new Vector3(0,0,-5),new Vector3(0,0,1)),10);near(hit.distance,4);near(hit.normal.z,-1);
  const local=hit.position.clone().applyMatrix4(body.motion.clone().invert());near(local.z,0.5);
 }
});
