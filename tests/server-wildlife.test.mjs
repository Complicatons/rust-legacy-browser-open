import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {ServerWildlife} from '../browser/server-wildlife.mjs';
import {CollisionWorld} from '../browser/collision.mjs';
const emit=(target,type,detail)=>target.dispatchEvent(Object.assign(new Event(type),{detail}));
function fixture(){
 const session=new EventTarget();session.client=new EventTarget();session.client.views=new Map();session.actorCalls=new Map();let now=10;
 const manifest={animals:{wolf_prefab:{movement:{type:'NavMeshMovement'},takeDamage:{maxHealth:100}}}};
 const calls=[],renderer={views:new Map(),event:(a,type,data,time)=>{calls.push({a,type,data,time});if(type==='network')(a.snapshots??=[]).push({t:time,p:a.position.clone(),q:a.rotation.clone()});},update(animals){this.views=new Map([...animals].map(a=>[a,{meshes:[1],current:a.dead?'death':'idle'}]));}};
 const physics={groundInfo:p=>({pos:new Vector3(p.x,0,p.z),normal:new Vector3(0,1,0)})};
 return {session,manifest,renderer,physics,calls,now:()=>now,setTime:t=>now=t};
}
const view={viewId:50,prefab:':wolf_prefab',position:[1,0,-2],rotation:[0,0,0,1]};
test('server wildlife replays state received while loading, applies health, timed attack/death and removal',()=>{
 const f=fixture();f.session.client.views.set(50,view);
 f.session.actorCalls.set(50,new Map([['GetNetworkUpdate',{viewId:50,name:'GetNetworkUpdate',args:{values:[[4,0,5],{pitch:10,yaw:90}]},receivedAt:2}]]));
 const w=new ServerWildlife(f.session,f.manifest,f),a=w.actors.get(50);
 assert.deepEqual(a.position.toArray(),[4,0,5]);// Angle2 pitch 10 (positive looks up): Quaternion.Euler(-10, 90, 0).
 assert.ok(new Vector3(0,0,1).applyQuaternion(a.rotation).distanceTo(new Vector3(Math.cos(Math.PI/18),Math.sin(Math.PI/18),0))<1e-6);
 emit(f.session.client,'rpc',{viewId:50,name:'ClientHealthChange',args:{values:[23]}});assert.equal(a.health,23);
 emit(f.session.client,'rpc',{viewId:50,name:'CL_Attack',args:{values:[]}});w.frame({},10.3,0.1);assert.ok(!f.calls.some(c=>c.type==='attack'));
 w.frame({},10.33,0.1);assert.ok(f.calls.some(c=>c.type==='attack'));
 emit(f.session.client,'rpc',{viewId:50,name:'ClientDeath',args:{values:[[5,1,6],12]}});
 emit(f.session.client,'rpc',{viewId:50,name:'GetNetworkUpdate',args:{values:[[999,999,999],{pitch:0,yaw:0}]}});
 w.frame({},10.4,0.1);assert.equal(a.health,0);assert.equal(a.dead,true);assert.deepEqual(a.position.toArray(),[5,0,6]);
 assert.equal(w.debug()[0].clip,'death');f.session.client.views.clear();emit(f.session.client,'destroy',{});w.frame({},11,0.1);assert.equal(w.animals.size,0);assert.equal(f.renderer.views.size,0);
});
test('unknown prefabs are ignored; server disconnect releases all animal presentations',()=>{
 const f=fixture(),w=new ServerWildlife(f.session,f.manifest,f);emit(f.session.client,'create',{...view,prefab:':unknown'});assert.equal(w.animals.size,0);
 f.session.client.views.set(50,view);emit(f.session.client,'create',view);assert.equal(w.animals.size,1);emit(f.session,'closed',{});w.frame({},11,0.1);assert.equal(w.actors.size,0);assert.equal(f.renderer.views.size,0);
});
test('server wildlife collision follows received transforms and is removed on disconnect',()=>{
 const f=fixture();f.manifest.animals.wolf_prefab.collider={size:[1,1,2],center:[0,0.5,0]};f.collisionWorld=new CollisionWorld();f.session.client.views.set(50,view);
 const w=new ServerWildlife(f.session,f.manifest,f);w.frame({},10.3,0.1);const body=f.collisionWorld.bodies[0];assert.equal(body.onlineActor.viewId,50);assert.equal(body.noCollide,true);assert.deepEqual(body.box.getCenter(new Vector3()).toArray(),[1,0.5,-2]);
 emit(f.session.client,'rpc',{viewId:50,name:'GetNetworkUpdate',args:{values:[[4,0,5],{pitch:0,yaw:0}]}});w.frame({},11,0.1);assert.deepEqual(body.box.getCenter(new Vector3()).toArray(),[4,0.5,-5]);
 emit(f.session,'closed',{});assert.equal(f.collisionWorld.bodies.length,0);
});
