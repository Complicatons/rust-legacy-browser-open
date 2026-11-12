import {Vector3,Quaternion,Matrix4} from 'three';
import {MovingBody} from './collision.mjs';
import {lookRotationForcedUp} from './resources.mjs';
import {callTime} from './airdrops.mjs';
import {animalMaterial,angle2Quaternion} from './animals.mjs';
// Presentation only: the native server owns AI, health, positions and lifetime. There is no local Wildlife AI.
export class ServerWildlife{
 constructor(session,manifest,{physics,renderer,now=()=>performance.now()/1000,collisionWorld=null,rng=Math.random}){
  Object.assign(this,{session,manifest,physics,renderer,now,collisionWorld,rng});
  // NetCull.sendRate from the approval: the renderer's interpolation delay, also used for the InterpTimedEvents below.
  if(session.client.world?.sendRate)renderer.setSendRate?.(session.client.world.sendRate);this.actors=new Map();this.animals=new Set();
  for(const v of session.client.views.values())this.create(v);
  session.client.addEventListener('create',e=>this.create(e.detail));
  session.client.addEventListener('rpc',e=>this.call(e.detail,callTime(e.detail,now(),session.clock)));
  session.client.addEventListener('destroy',()=>{for(const [id,a]of this.actors)if(!session.client.views.has(id))this.remove(id,a);});
  session.addEventListener('closed',()=>{for(const [id,a]of this.actors)this.remove(id,a);});
 }
 remove(id,a){if(a.body)this.collisionWorld.removeBody(a.body);this.actors.delete(id);this.animals.delete(a);}
 create(v){
  const key=v.prefab?.slice(1),def=v.prefab?.startsWith(':')&&this.manifest.animals[key];if(!def||this.actors.has(v.viewId))return;
  const a={viewId:v.viewId,key,def,position:new Vector3(v.position[0],v.position[1],-v.position[2]),rotation:new Quaternion(-v.rotation[0],-v.rotation[1],v.rotation[2],v.rotation[3]),
   health:def.takeDamage.maxHealth,dead:false,world:{physics:this.physics},pending:[],material:animalMaterial(def,v.viewId,this.rng)};
  if(this.collisionWorld){const b=new MovingBody(def.name);b.addBox(def.collider.size,def.collider.center);b.onlineActor={viewId:v.viewId};b.noCollide=true;b.layer=21;b.surfaceName=def.name;a.body=this.collisionWorld.addBody(b);}
  this.actors.set(v.viewId,a);this.animals.add(a);this.renderer.event(a,'network',null,this.now());
  for(const r of this.session.actorCalls?.get(v.viewId)?.values()??[])this.call(r,callTime(r,r.receivedAt,this.session.clock));
 }
 call(r,time){const a=this.actors.get(r.viewId);if(!a)return;const v=r.args?.values??[];
  // GetNetworkUpdate(Vector3, Angle2): (Quaternion)rot = Angle2.quat = Quaternion.Euler(-pitch, yaw, 0).
  if(r.name==='GetNetworkUpdate'&&!a.dying){a.position.fromArray(v[0]);a.rotation.copy(angle2Quaternion(v[1]));this.renderer.event(a,'network',null,time);
  }else if(r.name==='ClientHealthChange')a.health=Number(v[0]);
  else if(r.name==='ClientDeath'){
   // BasicWildLifeAI.OnClientDeath: ground the death position, LookRotationForcedUp(transform forward, full normal) and
   // SetGoals at the call's timestamp; DoClientDeath at once when attackerNetViewID.isMine, else InterpTimedEvent "DEATH".
   if(a.dying)return;a.dying=true;
   const p=new Vector3(...v[0]),g=this.physics.groundInfo(p.clone().add(new Vector3(0,0.25,0)),10),shown=this.renderer.views?.get(a)?.rotation??a.rotation;
   a.position.copy(g.pos);a.rotation.copy(lookRotationForcedUp(new Vector3(0,0,1).applyQuaternion(shown),g.normal));
   this.renderer.event(a,'goal',{position:a.position.clone(),rotation:a.rotation.clone()},time);
   if(this.session.client.views.get(v[1])?.mine){a.dead=true;a.health=0;}else a.pending.push({type:'death',time});
  }else if(r.name==='CL_Attack')a.pending.push({type:'attack',time});
  else if(r.name==='Snd')a.pending.push({type:'sound',data:v[0],time});
 }
 frame(camera,time,dt){
  const events=[];for(const a of this.animals){const due=a.pending.filter(e=>e.time+(this.renderer.timing?.delay??0.32)<=time);a.pending=a.pending.filter(e=>e.time+(this.renderer.timing?.delay??0.32)>time);
   for(const e of due){if(e.type==='death'){a.dead=true;a.health=0;}events.push([a,e]);}}
  this.renderer.update(this.animals,camera,time,dt);
  for(const a of this.animals)if(a.body){const v=this.renderer.views.get(a);a.body.setMotion(v?.root?.matrix??new Matrix4().makeScale(1,1,-1).multiply(new Matrix4().compose(a.position,a.rotation,new Vector3(1,1,1))));}
  for(const [a,e]of events)if(e.type==='death'||time-e.time<2)this.renderer.event(a,e.type,e.data,time);
 }
 debug(){return [...this.actors].map(([id,a])=>{const v=this.renderer.views.get(a);return {id,key:a.key,health:a.health,dead:a.dead,position:[a.position.x,a.position.y,-a.position.z],center:a.body?.box?.getCenter(new Vector3()).toArray(),rendered:Boolean(v),clip:v?.current,skins:v?.meshes.length??0};});}
}
