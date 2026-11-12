// Airdrops: the C130 supply plane, SupplyCrate with its parachute, and the server rules that call them.
// Sources (decompiled Assembly-CSharp, client and server): SupplyDropZone, SupplyDropTimer, SupplyDropPlane, SupplyCrate,
// SupplyParachute, NetDoppler, KillZone, SignalGrenade.OnDone, airdrop (console), LootableObject, TransformInterpolator /
// RigidbodyInterpolator / StateInterpolator.Push, Interpolation.BindTiming, InterpTimedEvent. Static data from
// tools/export_airdrop.py (browser/assets/recovered/airdrop/manifest.json).
// Online the server owns everything: the page only interpolates GetNetworkUpdate snapshots, plays Landed and loots
// through the server inventory flow. Offline, OfflineAirdrops runs the server half (timer, drop zones, plane flight,
// crate physics, KillZone, loot) and feeds the same presentation as the network would.
import * as THREE from 'three';
import {evalCurve,ParticleEffect,linkSubEmitters} from './particles.mjs';
import {LootCrate,lookRotation,randomFloat,randomInt} from './loot.mjs';
const {Vector3,Quaternion,Matrix4}=THREE;
const H=new Matrix4().makeScale(1,1,-1);

// ---------------------------------------------------------------- timing and interpolation
// uLinkPrefs sendRate (5); the server's NetCull.sendRate. Clients get it in the approval world info.
export const SEND_RATE=5,FIXED_STEP=0.02;
// Interpolation.BindTiming(delayMillis 20, sendRateRatio 1.5, sendRate): ceil(1000*ratio/sendRate) + delay, in seconds.
export function interpolationDelay(sendRate=SEND_RATE,delayMillis=20,ratio=1.5){const fromRate=sendRate>0&&ratio>0?Math.ceil(1000*ratio/sendRate):0;return (fromRate+delayMillis)/1000;}

// Unity Quaternion.Lerp: shortest-path normalised lerp, t clamped.
export function quatLerp(a,b,t){t=Math.min(1,Math.max(0,t));const s=a.dot(b)<0?-1:1;return new Quaternion(a.x+t*(s*b.x-a.x),a.y+t*(s*b.y-a.y),a.z+t*(s*b.z-a.z),a.w+t*(s*b.w-a.w)).normalize();}
// Vector3.MoveTowards
export function moveTowards(current,target,maxDelta){const d=target.clone().sub(current),len=d.length();return len<=maxDelta||len===0?target.clone():current.clone().addScaledVector(d,maxDelta/len);}

// StateInterpolator<PosRot> with TransformInterpolator/RigidbodyInterpolator.Sample (identical code). The buffer is kept
// newest first (Push); a full buffer drops a sample older than all kept ones; equal timestamps replace. Unity space.
export class PosRotInterpolator{
 constructor({capacity=32,allowDifference=0.1,sendInterval=1/SEND_RATE,exterpolate=false}={}){Object.assign(this,{capacity,allowDifference,sendInterval,exterpolate});this.buffer=[];}
 get length(){return this.buffer.length;}
 setGoals(position,rotation,timeStamp){const v={position:position.clone(),rotation:rotation.clone(),timeStamp},b=this.buffer;
  for(let i=0;i<b.length;i++){if(b[i].timeStamp<timeStamp){b.splice(i,0,v);if(b.length>this.capacity)b.pop();return;}if(b[i].timeStamp===timeStamp){b[i]=v;return;}}
  if(b.length<this.capacity)b.push(v);}
 // PosRot.Lerp: Vector3.Lerp + Quaternion.Slerp, both clamped.
 lerp(a,b,t){t=Math.min(1,Math.max(0,t));return {position:a.position.clone().lerp(b.position,t),rotation:a.rotation.clone().slerp(b.rotation,t)};}
 sample(time){const b=this.buffer;if(!b.length)return null;if(b.length===1)return {position:b[0].position.clone(),rotation:b[0].rotation.clone()};
  let newer=-1;
  for(let i=0;i<b.length;i++){const ts=b[i].timeStamp;
   if(ts>time){newer=i;continue;}
   if(ts===time)return {position:b[i].position.clone(),rotation:b[i].rotation.clone()};
   if(newer===-1){if(this.exterpolate&&i<b.length-1){const o=b[i+1];return this.lerp(o,b[i],(time-o.timeStamp)/(b[i].timeStamp-o.timeStamp));}return {position:b[i].position.clone(),rotation:b[i].rotation.clone()};}
   let start=ts,gap=b[newer].timeStamp-ts;const limit=this.gapLimit;
   if(gap>limit){start=b[newer].timeStamp-(gap=limit);if(start>=time)return {position:b[i].position.clone(),rotation:b[i].rotation.clone()};}
   return this.lerp(b[i],b[newer],(time-start)/gap);}
  const last=b[b.length-1];return {position:last.position.clone(),rotation:last.rotation.clone()};}
 // allowDifference + NetCull.sendInterval: the longest gap Sample/SampleWorldVelocity interpolate over.
 get gapLimit(){return this.allowDifference+this.sendInterval;}
 // TransformInterpolator.SampleWorldVelocity(time): (newer - older) / gap between the samples bracketing `time`, the gap
 // limited to gapLimit; null (Vector3.zero, false) with fewer than two samples, with no sample newer than `time`, or while
 // `time` is not yet past newer - gapLimit (the server sends only on change, so idle gaps of many seconds do not count).
 sampleWorldVelocity(time){const b=this.buffer;if(b.length<2)return null;let newer=-1;
  for(let i=0;i<b.length;i++){let ts=b[i].timeStamp;if(ts>time){newer=i;continue;}if(newer===-1)return null;
   const top=b[newer].timeStamp,limit=this.gapLimit;let gap=top-ts;if(gap>=limit){gap=limit;ts=top-gap;if(time<=ts)return null;}
   return b[newer].position.clone().sub(b[i].position).divideScalar(gap);}
  return null;}
}

// NetDoppler.Update: pitch = 1 + minPitch * (1 - clamp01(distance / audio.maxDistance)).
export const netDopplerPitch=(distance,maxDistance,minPitch)=>1+minPitch*(1-Math.min(1,Math.max(0,distance/maxDistance)));
// AudioSource rolloffMode 2 (Custom): volume * rolloffCustomCurve(distance / MaxDistance).
export function customRolloff(curve,distance,maxDistance,volume=1){return volume*Math.max(0,evalCurve(curve,Math.min(1,Math.max(0,distance/maxDistance))));}

// ---------------------------------------------------------------- server rules (offline runs these)
// SupplyDropZone.GetSupplyTargetPosition: transform.position + insideUnitCircle * radius on XZ.
export function supplyTargetPosition(zone,rng=Math.random){let x,y;do{x=rng()*2-1;y=rng()*2-1;}while(x*x+y*y>1);
 return new Vector3(zone.position[0]+x*zone.radius,zone.position[1],zone.position[2]+y*zone.radius);}
// SupplyDropZone.GetRandomTargetPos: one of the zones (Random.RandomRange(0, count)); none -> Vector3.zero.
export function randomTargetPos(zones,rng=Math.random){if(!zones.length)return new Vector3();return supplyTargetPosition(zones[randomInt(rng,0,zones.length)],rng);}
// SupplyDropZone.RandomDirectionXZ
export function randomDirectionXZ(rng=Math.random){const f=randomFloat(rng,-Math.PI,Math.PI);return new Vector3(Math.cos(f),0,Math.sin(f));}
// SupplyDropZone.CallAirDropAt: the C130 starts 20 * maxSpeed away in a random XZ direction, 400 m above the target,
// facing the drop point 300 m above the target.
export function airDropFlight(targetPos,rng=Math.random,maxSpeed=250){
 const start=targetPos.clone().add(randomDirectionXZ(rng).multiplyScalar(20*maxSpeed)),dropTarget=targetPos.clone().add(new Vector3(0,300,0));start.y+=400;
 return {position:start,rotation:lookRotation(dropTarget.clone().sub(start).normalize()),dropTarget};}
// SignalGrenade.OnDone (server): CallAirDropAt(rigidbody.position + (Range(-20,20), 75, Range(-20,20))).
export const signalTarget=(position,rng=Math.random)=>{const x=randomFloat(rng,-20,20),z=randomFloat(rng,-20,20);return position.clone().add(new Vector3(x,75,z));};

// SupplyDropTimer: Start -> ResetDropTime (Range(10,14) hours); Update needs EnvironmentControlCenter.GetTime();
// calls an airdrop once the hour passes the pending time if NetCull.connections.Length > airdrop.min_players.
export class SupplyDropTimer{
 constructor(rng=Math.random,{dropTimeDayMin=10,dropTimeDayMax=14}={}){Object.assign(this,{rng,dropTimeDayMin,dropTimeDayMax});this.nextDropTime=-1;this.started=false;}
 get pending(){return this.nextDropTime!==-1;}
 reset(){this.nextDropTime=randomFloat(this.rng,this.dropTimeDayMin,this.dropTimeDayMax);}
 update(hour,connections,minPlayers){if(!this.started){this.started=true;this.reset();}if(hour==null)return false;let call=false;
  if(this.pending&&hour>this.nextDropTime){if(connections>minPlayers)call=true;this.nextDropTime=-1;}
  if(!this.pending&&hour<this.dropTimeDayMin)this.reset();return call;}
}

// SupplyDropPlane (server): DoNetwork every send interval from instantiation runs DoMovement, then GetNetworkUpdate.
// Returns timed events: {type:'update'|'drop'|'destroy', time, ...}. Unity-space Vector3/Quaternion.
export class SupplyDropPlaneServer{
 constructor({position,rotation,dropTarget,time,rng=Math.random,sendInterval=1/SEND_RATE,maxSpeed=250,numCrates=3}){
  Object.assign(this,{position:position.clone(),rotation:rotation.clone(),rng,sendInterval,maxSpeed,numCrates});
  this.dropTargetPos=dropTarget.clone();this.targetPos=dropTarget.clone();this.lastDist=Infinity;this.approachingTarget=true;this.droppedPayload=false;
  this.lastMoveTime=time;this.nextNetwork=time;this.invokes=[];this.destroyed=false;}
 get forward(){return new Vector3(0,0,1).applyQuaternion(this.rotation);}
 doMovement(time){const dt=time-this.lastMoveTime;this.lastMoveTime=time;if(dt<=0)return [];
  let to=this.rotation.clone(),vector=this.forward;
  if(this.targetPos.distanceTo(this.position)>5){vector=this.targetPos.clone().sub(this.position).normalize();to=lookRotation(vector);}
  this.position.addScaledVector(vector,this.maxSpeed*dt);const d=this.position.distanceTo(this.dropTargetPos);
  this.rotation=quatLerp(this.rotation,to,dt*0.25);
  const out=[];if(this.approachingTarget&&d>this.lastDist){this.approachingTarget=false;this.targetReached(time);}
  this.lastDist=d;return out;}
 // TargetReached: Range(1, TEMP_numCratesToDrop + 1) crates, Invoke("DropCrate") at 0 then += RandomRange(0.3, 0.6);
 // climb away (forward * maxSpeed * 30, +800 m) and NetDestroy after 20 s.
 targetReached(time){if(this.droppedPayload)return;this.droppedPayload=true;const n=randomInt(this.rng,1,this.numCrates+1);let delay=0;
  for(let i=0;i<n;i++){this.invokes.push({at:time+delay,name:'drop'});delay+=randomFloat(this.rng,0.3,0.6);}
  this.targetPos.addScaledVector(this.forward,this.maxSpeed*30);this.targetPos.y+=800;this.invokes.push({at:time+20,name:'destroy'});}
 // DropCrate: SupplyCrate at transform.position - forward * 50, Euler(0, Range(0,360), 0); centerOfMass (0,-1.5,0);
 // AddForceAtPosition(-forward * 50, crate.position - (0,1,0)).
 dropCrate(time){const f=this.forward;return {type:'drop',time,position:this.position.clone().addScaledVector(f,-50),rotation:new Quaternion().setFromAxisAngle(new Vector3(0,1,0),randomFloat(this.rng,0,360)*Math.PI/180),force:f.clone().multiplyScalar(-50)};}
 update(time){const events=[];if(this.destroyed)return events;
  for(;;){const inv=this.invokes.reduce((m,x)=>!m||x.at<m.at?x:m,null),netAt=this.nextNetwork;const at=Math.min(netAt,inv?.at??Infinity);if(at>time)break;
   if(netAt<=at){this.nextNetwork+=this.sendInterval;this.doMovement(netAt);events.push({type:'update',time:netAt,position:this.position.clone(),rotation:this.rotation.clone()});continue;}
   this.invokes.splice(this.invokes.indexOf(inv),1);
   if(inv.name==='drop')events.push(this.dropCrate(inv.at));
   else {this.invokes=[];this.destroyed=true;events.push({type:'destroy',time:inv.at});break;}} // NetDestroy: CancelInvoke(); NetCull.Destroy
  return events;}
}

// Server crate rigidbody (PhysX in the original; Rapier here, Unity space). Rigidbody mass/drag/angularDrag and the
// BoxCollider/SupplyCratePhysicsMaterial come from the prefab; centerOfMass (0,-1.5,0) keeps the collider's inertia.
// Drag is applied as PhysX 2 linear damping (v *= 1 - drag*dt). IsSleeping is approximated with Unity 4 defaults:
// |v| < 0.15 and |w| < 0.14 for 20 fixed steps (Physics.sleepVelocity/sleepAngularVelocity, PhysX wake counter).
export class CratePhysics{
 constructor(R,prefab,position,rotation,{step=FIXED_STEP}={}){
  this.R=R;this.step=step;this.world=new R.World({x:0,y:-9.81,z:0});this.world.timestep=step;this.staticBody=null;this.events=new R.EventQueue(true);
  const rb=prefab.components.Rigidbody[0].data,c=prefab.colliders.find(c=>!c.trigger&&c.type==='BoxCollider'),[sx,sy,sz]=c.size,m=rb.m_Mass;Object.assign(this,{drag:rb.m_Drag,angularDrag:rb.m_AngularDrag,gravity:rb.m_UseGravity});
  this.body=this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(position.x,position.y,position.z).setRotation({x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w}).setCanSleep(false).setGravityScale(rb.m_UseGravity?1:0)
   .setAdditionalMassProperties(m,{x:0,y:-1.5,z:0},{x:m*(sy*sy+sz*sz)/12,y:m*(sx*sx+sz*sz)/12,z:m*(sx*sx+sy*sy)/12},{x:0,y:0,z:0,w:1}));
  const pm=c.physicMaterial??{},rules=[R.CoefficientCombineRule.Average,R.CoefficientCombineRule.Multiply,R.CoefficientCombineRule.Min,R.CoefficientCombineRule.Max];
  const [cx,cy,cz]=c.unityCenter;this.collider=this.world.createCollider(R.ColliderDesc.cuboid(sx/2,sy/2,sz/2).setTranslation(cx,cy,cz).setDensity(0).setFriction(pm.dynamicFriction??0.6).setRestitution(pm.bounciness??0)
   .setFrictionCombineRule(rules[pm.frictionCombine]??rules[0]).setRestitutionCombineRule(rules[pm.bounceCombine]??rules[0]).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),this.body);
  this.quiet=0;}
 setEnvironment(triangles){if(this.staticBody)this.world.removeRigidBody(this.staticBody);this.staticBody=null;if(!triangles.length)return;
  const v=new Float32Array(triangles.length*9),i=new Uint32Array(triangles.length*3);triangles.forEach((t,k)=>{v.set(t,k*9);i.set([k*3,k*3+1,k*3+2],k*3);});
  this.staticBody=this.world.createRigidBody(this.R.RigidBodyDesc.fixed());this.world.createCollider(this.R.ColliderDesc.trimesh(v,i),this.staticBody);}
 // ForceMode.Force applies force * fixedDeltaTime in the next step.
 addForceAtPosition(force,point){this.body.applyImpulseAtPoint({x:force.x*this.step,y:force.y*this.step,z:force.z*this.step},{x:point.x,y:point.y,z:point.z},true);}
 // One fixed step; true when a contact started (OnCollisionEnter).
 simulate(){this.world.step(this.events);let hit=false;this.events.drainCollisionEvents((a,b,started)=>{if(started)hit=true;});
  const v=this.body.linvel(),w=this.body.angvel(),kl=Math.max(0,1-this.drag*this.step),ka=Math.max(0,1-this.angularDrag*this.step);
  this.body.setLinvel({x:v.x*kl,y:v.y*kl,z:v.z*kl},true);this.body.setAngvel({x:w.x*ka,y:w.y*ka,z:w.z*ka},true);
  const lv=this.body.linvel(),av=this.body.angvel();this.quiet=Math.hypot(lv.x,lv.y,lv.z)<0.15&&Math.hypot(av.x,av.y,av.z)<0.14?this.quiet+1:0;return hit;}
 get sleeping(){return this.quiet>=20;}
 get position(){const p=this.body.translation();return new Vector3(p.x,p.y,p.z);}
 get rotation(){const q=this.body.rotation();return new Quaternion(q.x,q.y,q.z,q.w);}
 get velocity(){const v=this.body.linvel();return new Vector3(v.x,v.y,v.z);}
 dispose(){this.world.free();this.events.free?.();}
}

// KillZone trigger (crate BubbleWrap box) against the player's capsule, both Unity space. Samples the capsule segment.
export function boxTouchesCapsule(boxCenter,boxSize,matrix,a,b,radius){const inv=matrix.clone().invert(),h=new Vector3(...boxSize).multiplyScalar(0.5),c=new Vector3(...boxCenter);
 // Distances are measured in box space; prefab scale is 1 so lengths are preserved.
 let best=Infinity;for(let i=0;i<=8;i++){const p=a.clone().lerp(b,i/8).applyMatrix4(inv).sub(c),q=new Vector3(Math.max(-h.x,Math.min(h.x,p.x)),Math.max(-h.y,Math.min(h.y,p.y)),Math.max(-h.z,Math.min(h.z,p.z)));best=Math.min(best,p.distanceTo(q));}
 return best<=radius;}

// ---------------------------------------------------------------- client presentation (online and offline)
// One networked C130 or SupplyCrate: interpolated pose, LAND timed event, parachute growth, propellers, looter.
export class AirdropActors{
 constructor({sendRate=SEND_RATE,manifest=null}={}){this.actors=new Map();this.setSendRate(sendRate);this.manifest=manifest;}
 setSendRate(sendRate){this.sendRate=sendRate;this.delay=interpolationDelay(sendRate);for(const a of this.actors?.values()??[])a.interp.sendInterval=1/sendRate;}
 interpData(kind){const p=this.manifest&&this.manifest.prefabs[kind==='plane'?this.manifest.plane:this.manifest.crate],c=p?.components[kind==='plane'?'TransformInterpolator':'RigidbodyInterpolator']?.[0]?.data;
  return {capacity:c?._bufferCapacity??32,allowDifference:c?.allowDifference??0.1,exterpolate:Boolean(c?.exterpolate)};}
 create(id,kind,position,rotation,time,extra={}){if(this.actors.has(id))return this.actors.get(id);
  const a={id,kind,createdAt:time,interp:new PosRotInterpolator({...this.interpData(kind),sendInterval:1/this.sendRate}),position:position.clone(),rotation:rotation.clone().normalize(),
   landAt:null,landed:false,landing:null,chuteScale:new Vector3(0.01,0.01,0.01),chute:kind==='crate',propAngle:0,looter:0,started:false,...extra};
  this.actors.set(id,a);return a;}
 update(id,position,rotation,time){const a=this.actors.get(id);if(!a)return false;a.interp.setGoals(position,rotation.clone().normalize(),time);return true;}
 // SupplyCrate.Landed -> InterpTimedEvent.Queue("LAND"): handled when the interpolation playhead reaches the timestamp.
 land(id,time){const a=this.actors.get(id);if(!a||a.kind!=='crate'||a.landAt!==null)return false;a.landAt=time;return true;}
 setLooter(id,player){const a=this.actors.get(id);if(a)a.looter=player;}
 remove(id){const a=this.actors.get(id);if(!a)return null;this.actors.delete(id);a.removed=true;return a;}
 clear(){for(const id of [...this.actors.keys()])this.remove(id);}
 // Client Update for every actor; returns the LAND events that fired this frame (pose at that moment).
 frame(now,dt){const playhead=now-this.delay,landed=[];
  for(const a of this.actors.values()){const s=a.interp.sample(playhead);if(s){a.position.copy(s.position);a.rotation.copy(s.rotation);}
   if(a.kind==='plane')a.propAngle+=12*dt; // SupplyDropPlane.Update: RotateAroundLocal(Vector3.forward, 12 * deltaTime) (radians)
   if(a.chute){if(!a.started){a.started=true;a.chuteScale.set(0.01,0.01,0.01);} // SupplyParachute.Start, then Update
    a.chuteScale.copy(moveTowards(a.chuteScale,new Vector3(1,1,1),dt*2));}
   if(a.landAt!==null&&!a.landed&&playhead>=a.landAt){a.landed=true;a.chute=false;a.landing={position:a.position.clone(),rotation:a.rotation.clone(),time:now};landed.push(a);}} // LandShared + landedEffect + chute.Landed
  return landed;}
 contextText(a){return a.looter?'Occupied':'Search';} // LootableObject.ContextText (no PlayerClient name lookup here)
 debug(){return [...this.actors.values()].map(a=>({id:a.id,kind:a.kind,position:a.position.toArray(),rotation:a.rotation.toArray(),samples:a.interp.length,newest:a.interp.buffer[0]?.timeStamp??null,landAt:a.landAt,landed:a.landed,chute:a.chute,chuteScale:a.chuteScale.x,propAngle:a.propAngle,looter:a.looter,offline:Boolean(a.loot)}));}
}

// ---------------------------------------------------------------- online
const vec3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const quat4=q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.hypot(...q)>1e-8;
// Validated airdrop RPC: {name, position?, rotation?} in Unity space, or null when malformed / not an airdrop call.
// Plane and crate share GetNetworkUpdate(Vector3, Quaternion) (the bridge may report either class); the view's prefab decides.
export function decodeAirdropCall(kind,r){const v=r?.args?.values;if(!Array.isArray(v))return null;
 if(r.name==='GetNetworkUpdate'&&['SupplyCrate','SupplyDropPlane'].includes(r.args.class)&&v.length===2&&vec3(v[0])&&quat4(v[1]))return {name:'update',position:new Vector3(...v[0]),rotation:new Quaternion(...v[1]).normalize()};
 if(kind==='crate'&&r.name==='Landed'&&r.args.class==='SupplyCrate'&&v.length===0)return {name:'landed'};
 if(kind==='crate'&&r.args.class==='LootableObject'&&r.name==='SetLooter'&&v.length===1&&Number.isInteger(v[0]))return {name:'looter',player:v[0]};
 if(kind==='crate'&&r.args.class==='LootableObject'&&r.name==='ClearLooter'&&v.length===0)return {name:'looter',player:0};
 return null;}
export const AIRDROP_PREFABS={C130:'plane',SupplyCrate:'crate'};
// Server time of a call on the page clock: the bridge forwards the RPC's widened uLink timestamp and its own server clock.
// With the session's ServerClock (server-clock.mjs: one latency-floor offset for every message) the stamp alone decides
// the time, so jittered or batched arrivals keep their server spacing; without one (or before its first message) the
// call's own arrival is the reference.
export function callTime(r,receivedAt,clock=null){if(!Number.isFinite(r?.timestampMs)||!Number.isFinite(r?.serverMs))return receivedAt;
 return clock?.ready?clock.time(r.timestampMs):receivedAt-Math.max(0,r.serverMs-r.timestampMs)/1000;}
const unityPosition=p=>new Vector3(p[0],p[1],-p[2]),unityRotation=q=>new Quaternion(-q[0],-q[1],q[2],q[3]);

export class ServerAirdrops{
 constructor(session,actors,{now=()=>performance.now()/1000}={}){
  Object.assign(this,{session,actors,now});const c=session.client;if(c.world?.sendRate)actors.setSendRate(c.world.sendRate);
  for(const v of c.views.values())this.create(v);
  c.addEventListener('create',e=>this.create(e.detail));
  c.addEventListener('rpc',e=>this.call(e.detail,now()));
  c.addEventListener('destroy',()=>{for(const id of [...actors.actors.keys()])if(!c.views.has(id))actors.remove(id);});
  session.addEventListener('closed',()=>actors.clear());}
 create(v){const kind=AIRDROP_PREFABS[v.prefab];if(!kind||this.actors.actors.has(v.viewId))return;
  const retained=[...(this.session.actorCalls?.get(v.viewId)?.values()??[])].sort((a,b)=>a.receivedAt-b.receivedAt);
  this.actors.create(v.viewId,kind,unityPosition(v.position),unityRotation(v.rotation),this.now(),{online:{viewId:v.viewId}});
  for(const r of retained)this.call(r,r.receivedAt);
  // LootableObject.SetLooter is retained with the inventory calls of this view.
  for(const call of this.session.inventoryCalls?.get('v:'+v.viewId)??[])if(call.name==='SetLooter')this.actors.setLooter(v.viewId,call.args?.[0]??0);else if(call.name==='ClearLooter')this.actors.setLooter(v.viewId,0);}
 call(r,receivedAt){const a=this.actors.actors.get(r.viewId);if(!a)return;const d=decodeAirdropCall(a.kind,r);if(!d)return;const t=callTime(r,receivedAt,this.session.clock);
  if(d.name==='update')this.actors.update(r.viewId,d.position,d.rotation,t);else if(d.name==='landed')this.actors.land(r.viewId,t);else if(d.name==='looter')this.actors.setLooter(r.viewId,d.player);}
}

// ---------------------------------------------------------------- offline server
// The single-player page is its own server: one connection, the owner may use the [Admin] airdrop console commands.
export class OfflineAirdrops{
 constructor({manifest,lootManifest,items,engine,actors,environment=()=>[],now=()=>performance.now()/1000,rng=Math.random,sendRate=SEND_RATE,connections=()=>1,hour=()=>null,player=()=>null,onCrush=()=>{},ui={open(){},close(){}},crateSpawnList=null}){
  Object.assign(this,{manifest,lootManifest,items,engine,actors,environment,now,rng,sendRate,connections,hour,player,onCrush,ui});
  this.sendInterval=1/sendRate;this.skew=0;this.nextId=1;this.planes=new Map();this.crates=new Map();
  this.minPlayers=manifest.server.airdrop.min_players;this.zones=manifest.server.dropZones.filter(z=>z.active);
  this.timer=manifest.server.dropTimers?new SupplyDropTimer(rng,manifest.server.timer):null;
  this.plane=manifest.prefabs[manifest.plane];this.cratePrefab=manifest.prefabs[manifest.crate];const lo=this.cratePrefab.components.LootableObject[0].data;
  this.lootSystem={manifest:{prefabs:{SupplyCrate:{name:'SupplyCrate',lootable:{LootCycle:lo.LootCycle,lifeTime:lo.lifeTime,destroyOnEmpty:lo.destroyOnEmpty,NumberOfSlots:lo.NumberOfSlots,lateSized:lo.lateSized,spawnList:crateSpawnList??lo._lootSpawnListName.name}}},lists:lootManifest.lists},
   items,rng,onDestroy:loot=>this.lootDestroyed(loot),onEject:loot=>this.ui.close(loot)};
  const bw=this.cratePrefab.colliders.find(c=>c.trigger&&this.cratePrefab.nodes[c.node].name==='BubbleWrap');this.killZone=bw&&this.cratePrefab.components.KillZone?{center:bw.unityCenter,size:bw.size}:null;}
 time(){return this.now()+this.skew;}
 // SupplyDropZone.CallAirDrop / CallAirDropAt(targetPos).
 callAirDrop(){return this.callAirDropAt(randomTargetPos(this.zones,this.rng));}
 callAirDropAt(target){const p=this.plane.components.SupplyDropPlane[0].data,f=airDropFlight(target,this.rng,p.maxSpeed),t=this.time(),id=this.nextId++;
  const plane=new SupplyDropPlaneServer({...f,time:t,rng:this.rng,sendInterval:this.sendInterval,maxSpeed:p.maxSpeed,numCrates:p.TEMP_numCratesToDrop});plane.id=id;
  this.planes.set(id,plane);this.actors.create(id,'plane',f.position,f.rotation,t);return {id,target:target.toArray(),dropTarget:f.dropTarget.toArray(),start:f.position.toArray()};}
 // SignalGrenade.OnDone at the grenade's rigidbody position.
 signal(position){return this.callAirDropAt(signalTarget(position,this.rng));}
 spawnCrate(e){const id=this.nextId++,t=e.time,physics=new CratePhysics(this.engine,this.cratePrefab,e.position,e.rotation);
  const crate={id,physics,landing:false,static:false,killArmed:Boolean(this.killZone),inside:false,nextNetwork:t+this.sendInterval,lastStep:t,environmentAt:-Infinity,environmentPos:null,position:e.position.clone(),rotation:e.rotation.clone()};
  physics.addForceAtPosition(e.force,e.position.clone().sub(new Vector3(0,1,0)));
  // LootableObject.uLink_OnNetworkInstantiate -> InitializeServerState: TryAddLoot, ResetInvokes (lifeTime 600 s); accessLocked until LandShared.
  const loot=new LootCrate(this.lootSystem,{crate:null},'SupplyCrate',new Matrix4().makeTranslation(e.position.x,e.position.y,-e.position.z),t);loot.position.copy(e.position);loot.airdrop=crate;crate.loot=loot;
  loot.target={kind:'crate',crate:loot,contextText:()=>loot.contextText(),use:()=>this.use(crate)};
  this.crates.set(id,crate);this.actors.create(id,'crate',e.position,e.rotation,t,{loot});return crate;}
 use(crate){if(!crate.landed||crate.loot.destroyed)return false; // ContextRespond_OpenLoot: accessLocked -> FailBreak
  if(!crate.loot.useEnter('local',this.time()))return false;this.ui.open(crate.loot,()=>crate.loot.useExit(this.time()));return true;}
 lootDestroyed(loot){const crate=loot.airdrop;this.ui.close(loot);if(!crate)return;crate.physics?.dispose();crate.physics=null;this.crates.delete(crate.id);this.actors.remove(crate.id);}
 crateStep(crate,t){const ph=crate.physics,player=this.player();
  // SupplyCrate.FixedUpdate: a small upward force above the root while falling; once landing, settle then land.
  if(!crate.landing)ph.addForceAtPosition(new Vector3(0,10*FIXED_STEP,0),ph.position.add(new Vector3(0,1,0)));
  else if(ph.sleeping){this.goStatic(crate,t);return;}
  const hit=ph.simulate();crate.position=ph.position;crate.rotation=ph.rotation;crate.loot.position.copy(crate.position);
  // KillZone.OnTriggerEnter while the BubbleWrap triggers are enabled.
  if(crate.killArmed&&player?.alive){const m=new Matrix4().compose(crate.position,crate.rotation,new Vector3(1,1,1)),a=player.feet.clone().add(new Vector3(0,player.radius,0)),b=player.feet.clone().add(new Vector3(0,Math.max(player.radius,player.height-player.radius),0));
   const inside=boxTouchesCapsule(this.killZone.center,this.killZone.size,m,a,b,player.radius);if(inside&&!crate.inside)this.onCrush(crate);crate.inside=inside;}
  if(hit&&!crate.landing){crate.landing=true;crate.killArmed=false;} // OnCollisionEnter: _landing, bubble wrap triggers off
 }
 // GoStatic: stop DoNetwork, kinematic, one buffered GetNetworkUpdate, no collisions; DoLand: LandShared + Landed buffered.
 goStatic(crate,t){crate.static=true;crate.landed=true;crate.position=crate.physics.position;crate.rotation=crate.physics.rotation;crate.physics.dispose();crate.physics=null;
  this.actors.update(crate.id,crate.position,crate.rotation,t);this.actors.land(crate.id,t);crate.loot.position.copy(crate.position);}
 stepTo(T){
  for(const [id,plane]of [...this.planes])for(const e of plane.update(T)){
   if(e.type==='update')this.actors.update(id,e.position,e.rotation,e.time);
   else if(e.type==='drop')this.spawnCrate(e);
   else if(e.type==='destroy'){this.planes.delete(id);this.actors.remove(id);}}
  for(const crate of [...this.crates.values()]){
   while(!crate.static&&crate.physics&&crate.lastStep+FIXED_STEP<=T+1e-9){const t=crate.lastStep+=FIXED_STEP;
    // Collision geometry near the crate (the same ground/structure query the ragdolls use), refreshed as it moves.
    if(t-crate.environmentAt>=1||!crate.environmentPos||crate.environmentPos.distanceTo(crate.position)>8){crate.physics.setEnvironment(this.environment(crate.position));crate.environmentAt=t;crate.environmentPos=crate.position.clone();}
    this.crateStep(crate,t);
    if(!crate.static&&t>=crate.nextNetwork-1e-9){crate.nextNetwork+=this.sendInterval;this.actors.update(crate.id,crate.position,crate.rotation,t);}}
   if(!crate.loot.destroyed){const p=this.player();crate.loot.update(T,p?.alive?p.feet:null);}}
  if(this.timer){const hour=this.hour();if(this.timer.update(hour,this.connections(),this.minPlayers))this.callAirDrop();}}
 update(){this.stepTo(this.time());}
 // Development/test helper: run the server ahead by `seconds` (presentation time follows).
 advance(seconds){const end=this.time()+seconds;for(let t=this.time();t<end;t=Math.min(end,t+0.5)){this.skew+=Math.min(0.5,end-t);this.stepTo(this.time());}}
 // airdrop.drop / airdrop.min_players ([Admin] server ConsoleSystem members).
 // ConsoleSystem: class names are case-insensitive, member names exact.
 command(line){const m=/^\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)(?:\s+(.*))?$/.exec(String(line??''));if(!m||m[1].toLowerCase()!=='airdrop')return null;const fn=m[2],args=m[3]?m[3].trim().split(/\s+/):[];
  if(fn==='drop'){this.callAirDrop();return {ok:true,text:'Called airdrop...'};}
  if(fn==='min_players'){const v=args[0];if(v!=null){const n=Number.parseInt(v,10);if(Number.isFinite(n))this.minPlayers=n;}return {ok:true,text:`airdrop.min_players: ${this.minPlayers}`};}
  return null;}
 clear(){for(const c of [...this.crates.values()]){c.physics?.dispose();this.ui.close(c.loot);}this.crates.clear();this.planes.clear();this.actors.clear();}
 debug(){return {minPlayers:this.minPlayers,zones:this.zones.length,timer:this.timer&&{next:this.timer.nextDropTime},planes:[...this.planes.values()].map(p=>({id:p.id,position:p.position.toArray(),dropped:p.droppedPayload})),
  crates:[...this.crates.values()].map(c=>({id:c.id,position:c.position.toArray(),landing:c.landing,landed:Boolean(c.landed),items:c.loot.slots.filter(Boolean).length,expires:c.loot.timers.get('destroy')??null,looter:c.loot.looter}))};}
}

// ---------------------------------------------------------------- rendering (browser)
// Queues the plane's and crate's downloads and textures (createAssetLoader prefetch), creating no three object; main.mjs
// calls it early in the join with the loader it later passes to createAirdropRenderer.
export function prefetchAirdropAssets(manifest,assets){const templateRenderers=p=>{const sprites=new Set((p.components.ContextSprite??[]).map(c=>c.node));return p.renderers.filter(r=>!sprites.has(r.node));};
 for(const key of [manifest.plane,manifest.crate])for(const r of templateRenderers(manifest.prefabs[key]))assets.prefetch?.(r.mesh,r.materials,r.materials.map((_,i)=>i));}
// deps: {scene, manifest, base, assets (createAssetLoader), collisionWorld, MovingBody, camera, listener():AudioListener|null}
export async function createAirdropRenderer({scene,manifest,base,assets,collisionWorld,MovingBody,camera,listener=()=>null}){
 const templates=new Map(),textures=new Map(),audioLoader=new THREE.AudioLoader(),buffers=new Map();
 const texture=file=>{if(!file)return null;if(!textures.has(file)){const t=new THREE.TextureLoader().load(base+file);t.colorSpace=THREE.SRGBColorSpace;textures.set(file,t);}return textures.get(file);};
 async function part(p,r){const g=new THREE.Group();g.matrixAutoUpdate=false;g.matrix.fromArray(r.matrix);g.userData.node=r.node;for(const m of await assets.parts(r.mesh,r.materials,r.materials.map((_,i)=>i),null,r.name))g.add(m);return g;}
 prefetchAirdropAssets(manifest,assets); // downloads start together; parts are built in order
 for(const key of [manifest.plane,manifest.crate]){const p=manifest.prefabs[key],sprites=new Set((p.components.ContextSprite??[]).map(c=>c.node)),parts=[];
  for(const r of p.renderers)if(!sprites.has(r.node))parts.push(await part(p,r));templates.set(key,parts);}
 const plane=manifest.prefabs[manifest.plane],crate=manifest.prefabs[manifest.crate],sc=crate.components.SupplyCrate[0],props=plane.components.SupplyDropPlane[0].propellerNodes;
 const src=plane.components.AudioSource?.[0],doppler=plane.components.NetDoppler?.[0]?.data,fxPrefab=manifest.prefabs[sc.landedEffect];
 const solid=crate.colliders.filter(c=>!c.trigger),views=new Map(),effects=[],sprites=new Set((crate.components.ContextSprite??[]).map(c=>c.node));
 const matrixOf=(a,scale=1)=>H.clone().multiply(new Matrix4().compose(a.position,a.rotation,new Vector3(scale,scale,scale))).multiply(H);
 function view(a){const key=a.kind==='plane'?manifest.plane:manifest.crate,group=new THREE.Group();group.name=a.kind==='plane'?'C130':'SupplyCrate';group.matrixAutoUpdate=false;
  const parts=templates.get(key).map(t=>{const c=t.clone();c.userData.base=t.matrix.clone();return c;});group.add(...parts);scene.add(group);
  const v={group,parts,props:parts.filter(p=>props?.includes(p.userData.node)),chute:parts.find(p=>p.userData.node===sc.chuteNode)??null,body:null,audio:null};
  if(a.kind==='crate'){const b=new MovingBody('SupplyCrate');for(const c of solid)b.addBox(c.size,c.center,new Matrix4().fromArray(c.matrix));b.layer=crate.nodes[0].layer;b.surfaceName='SupplyCrate';b.cosmeticRigid=true;
   // LootableObject.ContextTextPoint: the crate's ContextSprite node 0.15 m higher (the sprite node is left out of the drawn parts).
   const spriteNode=crate.renderers.find(r=>sprites.has(r.node)),textPoint=()=>{const m=group.matrix.clone();if(spriteNode)m.multiply(new Matrix4().fromArray(spriteNode.matrix));const p=new Vector3().setFromMatrixPosition(m);if(spriteNode)p.y+=0.15;return p;};
   if(a.online){b.online=a.online;b.onlineTarget={kind:'online',online:a.online,contextText:()=>a.looter?'Occupied':'Search',textPoint};}else if(a.loot){b.crate=a.loot;if(a.loot.target)a.loot.target.textPoint=textPoint;}
   b.setMotion(matrixOf(a));v.body=collisionWorld.addBody(b);}
  return v;}
 function sound(a,v){const l=listener();if(!src?.clip||!l||v.audio)return;const s=v.audio=new THREE.PositionalAudio(l);s.setLoop(Boolean(src.data.Loop));s.setDistanceModel('linear');s.setRefDistance(1);s.setMaxDistance(1e6);s.setRolloffFactor(0);s.setVolume(0);scene.add(s);
  const url=base+src.clip;if(!buffers.has(url))buffers.set(url,audioLoader.loadAsync(url));buffers.get(url).then(b=>{if(v.disposed)return;s.setBuffer(b);if(src.data.m_PlayOnAwake)s.play();}).catch(()=>{});}
 function dispose(v){v.disposed=true;scene.remove(v.group);if(v.body)collisionWorld.removeBody(v.body);if(v.audio){if(v.audio.isPlaying)v.audio.stop();v.audio.disconnect();scene.remove(v.audio);}}
 function landedEffect(a){if(!fxPrefab)return;const root=matrixOf({position:a.landing.position,rotation:a.landing.rotation});
  const list=[];for(const ps of fxPrefab.components.ParticleSystem??[]){if(!fxPrefab.nodes[ps.node].active)continue;const r=(fxPrefab.components.ParticleSystemRenderer??[]).find(x=>x.node===ps.node);if(!r?.enabled)continue;const mat=manifest.materials[r.materials[0]];
   list.push(Object.assign(new ParticleEffect(ps.data,r,mat,texture(mat?.textures?._MainTex?.file??mat?.texture),new Matrix4().fromArray(fxPrefab.nodes[ps.node].matrix)),{id:ps.id??null}));}
  for(const fx of linkSubEmitters(list)){scene.add(fx.mesh);effects.push({fx,root,until:a.landing.time+2.5});}} // Object.Destroy(effect, 2.5f)
 return {
  frame(actors,landed,now,dt){
   for(const [id,v]of views)if(!actors.actors.has(id)||actors.actors.get(id)!==v.actor){dispose(v);views.delete(id);}
   const eye=camera.getWorldPosition(new Vector3()),eyeU=new Vector3(eye.x,eye.y,-eye.z);
   for(const a of actors.actors.values()){let v=views.get(a.id);if(!v){v=view(a);v.actor=a;views.set(a.id,v);}
    const m=matrixOf(a);v.group.matrix.copy(m);v.group.matrixWorldNeedsUpdate=true;
    if(v.body&&!v.body.motion.equals(m))v.body.setMotion(m);
    for(const p of v.props)p.matrix.copy(p.userData.base).multiply(new Matrix4().makeRotationZ(a.propAngle));
    if(v.chute){v.chute.visible=a.chute;if(a.chute)v.chute.matrix.copy(v.chute.userData.base).multiply(new Matrix4().makeScale(a.chuteScale.x,a.chuteScale.y,a.chuteScale.z));}
    if(a.kind==='plane'){sound(a,v);if(v.audio){const d=a.position.distanceTo(eyeU);v.audio.position.set(a.position.x,a.position.y,-a.position.z);
     v.volume=customRolloff(src.rolloffCustomCurve,d,src.data.MaxDistance,src.data.m_Volume??1);v.audio.setVolume(v.volume);
     if(doppler){v.pitch=netDopplerPitch(d,src.data.MaxDistance,doppler.minPitch);if(Math.abs((v.audio.playbackRate??1)-v.pitch)>1e-3)v.audio.setPlaybackRate(v.pitch);}}}}
   for(const a of landed)landedEffect(a);
   for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.fx.update(dt,true,e.root,camera);if(now>=e.until){scene.remove(e.fx.mesh);e.fx.dispose();effects.splice(i,1);}}},
  debug(){return {views:[...views.entries()].map(([id,v])=>({id,kind:v.actor.kind,body:Boolean(v.body),chuteVisible:v.chute?.visible??null,audio:Boolean(v.audio),playing:Boolean(v.audio?.isPlaying),volume:v.volume??null,pitch:v.pitch??null,center:v.body?.box?.getCenter(new Vector3()).toArray()??null})),
   effects:effects.length,particles:effects.reduce((n,e)=>n+e.fx.particles.length,0)};},
  clear(){for(const v of views.values())dispose(v);views.clear();for(const e of effects){scene.remove(e.fx.mesh);e.fx.dispose();}effects.length=0;}};
}
