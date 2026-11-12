import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3,Matrix4} from 'three';
import {CollisionWorld,MovingBody} from '../browser/collision.mjs';
import {serverMeleeCast} from '../browser/server-combat.mjs';
// MeleeWeaponDataBlock.Physics2SphereCast(eyesRay, 0.3, range, 406721553) as collision.mjs physics2SphereCast.
const box=(world,name,x,{layer=0,bodyPart=null}={})=>{const b=new MovingBody(name);b.addBox([1,3,1],[0,0,0]);b.layer=layer;if(bodyPart!=null)b.bodyPart=bodyPart;world.addBody(b);b.setMotion(new Matrix4().makeTranslation(0,1.5,-x));return b;};
const forward=()=>new Ray(new Vector3(0,1.6,0),new Vector3(0,0,-1));
const close=(a,b,eps=0.03)=>Math.abs(a-b)<eps;

test('the terrain (layer 19) is in the melee mask: swinging at the ground hits it',()=>{
 const w=new CollisionWorld(()=>0).build(),ray=new Ray(new Vector3(0,1.6,0),new Vector3(0,-1,-1).normalize());
 assert.equal(w.sphereCast(ray,0.3,2.5),null); // the solids-only sweep never touched the heightfield
 const hit=w.physics2SphereCast(ray,0.3,2.5);assert.ok(hit?.terrain,JSON.stringify(hit));
 // Sphere sweep first; the ray (which reaches the ground at 1.6 * sqrt(2) = 2.26 m) only refines it when nearer.
 assert.ok(hit.distance<2.26&&hit.distance>1.5,String(hit.distance));
 assert.equal(w.physics2SphereCast(new Ray(new Vector3(0,1.6,0),new Vector3(0,0,-1)),0.3,2.5),null);
});

test('bodies are filtered by the hit mask; layer 17 and hit-box bodies are not solids for the sweep',()=>{
 const w=new CollisionWorld(()=>-10);box(w,'character',1.2,{layer:16});box(w,'wall',1.8);w.build();
 const hit=w.physics2SphereCast(forward(),0.3,2.5);assert.equal(hit.body.name,'wall');assert.ok(close(hit.distance,1.8-0.5-0.3));
 const w2=new CollisionWorld(()=>-10);box(w2,'broadphase',1.2,{layer:17});w2.build();assert.equal(w2.physics2SphereCast(forward(),0.3,2.5),null);
});

test('Physics2.Raycast2: a hit box nearer than the solid hit wins and reports its body part; a farther one does not',()=>{
 const w=new CollisionWorld(()=>-10);box(w,'head',1.2,{layer:27,bodyPart:9});box(w,'wall',2);w.build();
 const hit=w.physics2SphereCast(forward(),0.3,2.5);assert.equal(hit.body.name,'head');assert.equal(hit.bodyPart,9);assert.ok(close(hit.distance,0.7,0.01));
 const w2=new CollisionWorld(()=>-10);box(w2,'wall',1.2);box(w2,'head',2,{layer:27,bodyPart:9});w2.build();assert.equal(w2.physics2SphereCast(forward(),0.3,2.5).body.name,'wall');
 // A hit box the sweep misses entirely still counts through Raycast2.
 const w3=new CollisionWorld(()=>-10);box(w3,'head',1.6,{layer:27,bodyPart:9});w3.build();assert.equal(w3.physics2SphereCast(forward(),0.3,2.5).bodyPart,9);
});

test('with nothing solid hit, a layer-17 broadphase around the eyes is a hit 0.5 m ahead',()=>{
 const w=new CollisionWorld(()=>-10).build(),target={name:'HB Hit',onlineActor:{viewId:7}},seen=[];
 const hit=serverMeleeCast(w,forward(),2.5,(c,r)=>{seen.push([c.toArray(),r]);return target;});
 assert.equal(hit.body,target);assert.ok(hit.overlap);assert.deepEqual(hit.point.toArray(),[0,1.6,-0.5]);assert.deepEqual(hit.normal.toArray(),[-0,-0,1]);assert.deepEqual(seen,[[[0,1.6,0],0.3]]);
 const w2=new CollisionWorld(()=>-10);box(w2,'wall',1.8);w2.build();let asked=false;assert.equal(serverMeleeCast(w2,forward(),2.5,()=>{asked=true;return target;}).body.name,'wall');assert.equal(asked,false);
});

test('the sampled sweep is refined to the contact distance, as a continuous Physics.SphereCast reports it',()=>{
 // A 1 m box centred 1.513 m ahead: its face is at 1.013 m, so a 0.3 m sphere touches it after 0.713 m (2 cm samples: 0.72).
 const w=new CollisionWorld(null);box(w,'wall',1.513);w.build();
 const hit=w.sphereSweep(forward(),0.3,2);assert.ok(Math.abs(hit.distance-0.713)<1e-4,String(hit.distance));assert.ok(Math.abs(hit.point.z+1.013)<1e-3);
 // Terrain: flat ground at y 0 under a sphere falling from 1.6 m touches after 1.3 m.
 const g=new CollisionWorld(()=>0).build(),down=g.terrainSphereCast(new Ray(new Vector3(0,1.6,0),new Vector3(0,-1,0)),0.3,2);assert.ok(Math.abs(down.distance-1.3)<1e-4,String(down.distance));
 // Already overlapping at the start stays a hit at 0.
 assert.equal(w.sphereSweep(new Ray(new Vector3(0,1.6,-0.8),new Vector3(0,0,-1)),0.3,2).distance,0);
});
