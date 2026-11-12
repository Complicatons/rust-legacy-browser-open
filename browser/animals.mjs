import {Vector3,Quaternion,Ray,Euler} from 'three';
import {randomFloat,randomInt,lookRotation} from './loot.mjs';
import {ResourceTarget,lookRotationForcedUp} from './resources.mjs';
import {NavCrowd} from './nav-crowd.mjs';
// Ports of decompiled BasicWildLifeAI, HostileWildlifeAI, BasicWildLifeMovement, Facepunch.Procedural.MillisClock
// and Direction, TakeDamage/ProtectionTakeDamage and NavMeshMovement; NavMeshAgent is simulated by nav-crowd.mjs.
// All animal state is kept in Unity space (left-handed, Z forward); queries convert to browser space (Z negated).

export const State={Default:0,Idle:1,Flee:2,Roam:5,Dead:7,Chase:9,Attack:10};
export const Sound={Idle:0,Warn:1,Attack:2,Afraid:3,Death:4,Chase:5,ChaseClose:6};
const UP=new Vector3(0,1,0),FORWARD=new Vector3(0,0,1);
const approx=(a,b)=>a.distanceToSquared(b)<1e-10;

// Facepunch.Procedural.MillisClock. Note: an unset or already elapsed clock reports "reached" on every call.
export class MillisClock {
 constructor(){this.remain=0;this.duration=0;this.once=false;}
 resetRandomDurationSeconds(rng,min,max){return this.resetDurationSeconds(min+rng()*(max-min));}
 resetDurationSeconds(seconds){return this.resetDurationMillis(Math.ceil(seconds*1000));}
 resetDurationMillis(ms){if(ms<=1){this.setImmediate();return;}this.once=true;this.remain=this.duration=ms;}
 setImmediate(){this.once=true;this.remain=1;this.duration=2;}
 get percent(){return this.remain===0?1:this.remain<this.duration?1-this.remain/this.duration:0;}
 // 'stationary' | 'moved' | 'movedDestination'
 integrate(ms){if(!this.once||this.remain===0||this.duration===0||ms===0)return 'stationary';if(this.remain<=ms){this.remain=0;return 'stationary';}this.remain-=ms;return this.remain<this.duration?'moved':'movedDestination';}
 reached(ms){return this.integrate(ms)==='stationary';}
}

// UnityEngine.Vector3.Slerp for directions (magnitudes interpolated linearly).
function slerpVectors(a,b,t){const la=a.length(),lb=b.length();if(la<1e-9||lb<1e-9)return a.clone().lerp(b,t);
 const na=a.clone().divideScalar(la),nb=b.clone().divideScalar(lb),dot=Math.min(1,Math.max(-1,na.dot(nb))),theta=Math.acos(dot)*t;
 let rel=nb.clone().addScaledVector(na,-dot);if(rel.lengthSq()<1e-12)rel=new Vector3(-na.z,0,na.x);rel.normalize();
 return na.multiplyScalar(Math.cos(theta)).addScaledVector(rel,Math.sin(theta)).multiplyScalar(la+(lb-la)*t);}
const angleDeg=(a,b)=>{const d=Math.sqrt(a.lengthSq()*b.lengthSq());return d<1e-15?0:Math.acos(Math.min(1,Math.max(-1,a.dot(b)/d)))*180/Math.PI;};

// Facepunch.Procedural.Direction (Integrated<Vector3>): turns toward a target at a fixed degree speed.
export class Direction {
 constructor(){this.current=FORWARD.clone();this.begin=FORWARD.clone();this.end=FORWARD.clone();this.clock=new MillisClock();}
 setImmediate(v){this.current.copy(v);this.begin.copy(v);this.end.copy(v);this.clock.setImmediate();}
 target(v,degreeSpeed){
  if(!this.clock.once){this.setImmediate(v);return;}
  const angle=Math.abs(angleDeg(this.current,v));
  if(angle<degreeSpeed*1.401298e-45||degreeSpeed===0){this.setImmediate(v);return;}
  this.begin.copy(this.current);this.end.copy(v);const speed=Math.abs(degreeSpeed);
  this.clock.duration=this.clock.remain=Math.ceil(angle*1000/speed);if(this.clock.remain<=1)this.setImmediate(v);
 }
 // As in the original, the final step reports 'stationary' and leaves the last slerped direction in place.
 advance(ms){const r=this.clock.integrate(ms);if(r==='moved')this.current.copy(slerpVectors(this.begin,this.end,this.clock.percent));else if(r==='movedDestination')this.current.copy(this.end);return r;}
}

// Angle2.Direction(0, yaw) and Angle2.LookDirection(dir).yaw in Unity's convention.
export const yawDirection=yaw=>new Vector3(Math.sin(yaw*Math.PI/180),0,Math.cos(yaw*Math.PI/180));
const yawOf=dir=>Math.atan2(dir.x,dir.z)*180/Math.PI;

// TransformHelpers.GetGroundInfo and the AI's sight/obstacle rays: Physics.Raycast(…, -472317957), which leaves out layers
// 2, 16, 17, 18, 21 (animals), 26, 27 (player hit regions, ragdolls) and 28.
export const WILDLIFE_GROUND_MASK=-472317957;
// Physics adapter over the browser CollisionWorld, honouring that layer mask: animals (layer 21, also when a body only
// carries `animal`) and bodies on the other left-out layers are not hit. The static scene and the terrain always are.
export function wildlifePhysics(world){
 const skip=b=>Boolean(b?.animal||(b?.layer!=null&&!((WILDLIFE_GROUND_MASK>>>b.layer)&1))),toB=v=>new Vector3(v.x,v.y,-v.z),toU=toB;
 return {
  // TransformHelpers.GetGroundInfo(startPos, range): ray down from 0.25 m above; misses return startPos(+0.25) and up.
  groundInfo(start,range){const s=start.clone();s.y+=0.25;const hit=world.raycast(new Ray(toB(s),new Vector3(0,-1,0)),range,skip);return hit?{hit:true,pos:toU(hit.position),normal:toU(hit.normal).normalize()}:{hit:false,pos:s,normal:UP.clone()};},
  // Physics.Raycast(origin, dir, distance, -472317957)
  blocked(origin,dir,distance){const d=toB(dir).normalize();return Boolean(world.raycast(new Ray(toB(origin),d),distance,skip));},
 };
}

// BasicWildLifeMovement (passive wildlife): stepped once per AI think from the look direction.
export class BasicWildLifeMovement {
 constructor(def,physics){Object.assign(this,{lookDegreeSpeed:80,maxSlope:45,simRate:5,moveCastOffset:0.25},def.movement);this.physics=physics;this.collisionRadius=0.3;this.hullLength=0.1;this.desiredSpeed=0;this.look=new Direction();this.actualMoveSpeedPerSec=0;
  this.positionSet=new Vector3(Infinity,0,0);this.rotationSet=new Quaternion(2,0,0,0);this.groundPos=new Vector3();this.groundNormal=UP.clone();this.movePos=new Vector3(Infinity,0,0);this.moveNormal=new Vector3();this.rayPos=new Vector3(Infinity,0,0);this.ground=false;this.force2nd=false;}
 initialize(ai){const f=FORWARD.clone().applyQuaternion(ai.rotation);this.look.setImmediate(f);this.hullLength=ai.def.collider.size[2]*0.5;this.dropToGround(ai,ai.position.clone());}
 setMoveDirection(dir,speed){this.look.target(dir.clone(),this.lookDegreeSpeed);this.desiredSpeed=speed;}
 setMovePosition(pos,speed,ai){this.setMoveDirection(pos.clone().sub(ai.position).normalize(),speed);}
 stop(){this.desiredSpeed=0;}
 setMoveTarget(target,speed,ai){const d=target.position.clone().sub(ai.position);d.y=0;d.normalize();this.setMoveDirection(d,speed);}
 setLookDirection(dir){this.setMoveDirection(dir,0);}
 isStuck(){return false;}
 dropToGround(ai,point){const g=this.physics.groundInfo(point,300);this.setTransform(ai,g.pos,lookRotationForcedUp(this.look.current.clone(),g.normal));}
 setTransform(ai,pos,q){if(!approx(pos,this.positionSet)||!(Math.abs(q.dot(this.rotationSet))>0.9999999)){this.positionSet.copy(pos);this.rotationSet.copy(q);ai.position.copy(pos);ai.rotation.copy(q);}}
 frame(){}
 doMove(ai,ms){
  if(ms===0)return;const seconds=ms*0.001;this.look.advance(ms);
  if(this.desiredSpeed<0.01){
   this.force2nd=false;
   // `ground` is never set true in the original, so this always takes the 10 m branch.
   if(!this.ground){const g=this.physics.groundInfo(this.positionSet.clone(),10);this.groundPos.copy(g.pos);this.groundNormal.copy(g.normal);}
   this.setTransform(ai,this.groundPos.clone(),lookRotationForcedUp(this.look.current.clone(),this.groundNormal));this.actualMoveSpeedPerSec=this.desiredSpeed;return;
  }
  const from=this.positionSet.clone(),step=this.desiredSpeed*seconds,origin=from.clone();origin.y+=this.moveCastOffset;origin.addScaledVector(this.look.current,this.hullLength);
  let hitSomething=false,next;
  if(!this.physics.blocked(origin,this.look.current,this.collisionRadius+step))next=from.clone().addScaledVector(this.look.current.clone().normalize(),step);
  else {next=from.clone();hitSomething=true;this.force2nd=false;}
  if(this.ground||this.force2nd||!approx(this.rayPos,next)){
   this.ground=false;this.force2nd=false;this.rayPos.copy(next);
   const g=this.physics.groundInfo(next,5);
   if(g.hit){if(!approx(g.pos,this.movePos)||!approx(g.normal,this.moveNormal)){this.movePos.copy(g.pos);this.moveNormal.copy(g.normal);this.setTransform(ai,g.pos,lookRotationForcedUp(this.look.current.clone(),this.moveNormal));}}
   else {hitSomething=true;this.force2nd=true;}
  }
  this.actualMoveSpeedPerSec=Math.hypot(from.x-this.positionSet.x,from.z-this.positionSet.z)/seconds;
  if(hitSomething)ai.hitSomething();
 }
}

// NavMeshMovement drives a Unity NavMeshAgent (CharacterNavAgentTrait.CopyTo: speed, acceleration, angular speed,
// radius, stopping distance, auto braking, height, obstacle avoidance type and priority). With the island navmesh the
// agent is simulated by NavCrowd (browser/nav-crowd.mjs, Detour dtCrowd rules); the agent ignores physics colliders,
// as Unity's does. Without a navmesh (unit tests only) it steers straight at its destination over the colliders.
export class AgentMovement {
 constructor(def,physics,crowd=null){Object.assign(this,{lookDegreeSpeed:180,maxSlope:45},def.movement);this.physics=physics;const a=def.navAgent??{};
  this.agent={speed:a._speed??3,acceleration:a._acceleration??8,angularSpeed:a._angularSpeed??120,stoppingDistance:a._stoppingDistance??0,radius:a._radius??0.5,autoBraking:a._autoBraking!==0,
   height:a._height??2,obstacleAvoidanceType:a._obstacleAvoidanceType??1,avoidancePriority:a._avoidancePriority??50};
  this.destination=null;this.stoppedFlag=true;this.updateRotation=false;this.straightVelocity=new Vector3();this.desiredSpeed=0;this.straightPath=false;
  this.crowd=crowd;this.nav=crowd?.nav??null;this.handle=null;this.offMesh=false;}
 get velocity(){return this.handle?this.handle.vel:this.straightVelocity;}
 get hasPath(){return this.handle?this.handle.hasPath:this.straightPath;}
 set hasPath(v){if(this.handle){if(!v)this.crowd.resetPath(this.handle);}else this.straightPath=v;}
 get stopped(){return this.handle?this.handle.stopped:this.stoppedFlag;}
 get poly(){return this.handle?.poly??-1;}
 // Unity places an enabled agent on the nearest navmesh point; one that cannot be placed stays disabled and
 // NavMeshMovement.RemoveIfNotOnNavmesh kills the animal (WildlifeWorld.add).
 initialize(ai){const g=this.physics.groundInfo(ai.position.clone(),300);ai.position.copy(g.pos);
  if(this.crowd){const a=this.agent;this.handle=this.crowd.addAgent({radius:a.radius,height:a.height,maxSpeed:a.speed,maxAcceleration:a.acceleration,stoppingDistance:a.stoppingDistance,autoBraking:a.autoBraking,
    obstacleAvoidanceType:a.obstacleAvoidanceType,avoidancePriority:a.avoidancePriority},ai.position);
   if(!this.handle)this.offMesh=true;else {ai.position.x=this.handle.pos.x;ai.position.z=this.handle.pos.z;}}}
 setSpeed(speed){this.agent.speed=speed;if(this.handle)this.handle.params.maxSpeed=speed;}
 setMoveDirection(dir,speed,ai){this.updateRotation=true;this.setDestination(ai.position.clone().addScaledVector(dir,30));this.setSpeed(speed);}
 // NavMeshMovement.Stop: NavMeshAgent.Stop() (path kept, movement halted) and aiming off.
 stop(){if(this.handle)this.crowd.stop(this.handle);else this.stoppedFlag=true;this.updateRotation=false;this.desiredSpeed=0;}
 isStuck(ai){const local=this.velocity.clone().applyQuaternion(ai.rotation.clone().invert());return this.hasPath&&this.agent.speed>0.5&&local.z<this.agent.speed*0.25;}
 setLookDirection(dir,ai){this.setDestination(ai.position.clone());this.stop();if(dir.lengthSq()>0)ai.rotation.copy(lookRotation(dir.clone()));}
 setMovePosition(pos,speed){this.updateRotation=true;this.setDestination(pos.clone());this.setSpeed(speed);}
 setMoveTarget(target,speed,ai){this.updateRotation=true;const d=target.position.clone().sub(ai.position).normalize();this.setDestination(target.position.clone().addScaledVector(d,0.5));this.setSpeed(speed);}
 setDestination(p){this.destination=p;if(this.handle){this.crowd.requestMoveTarget(this.handle,p);return;}this.straightPath=true;this.stoppedFlag=false;}
 // NavMeshMovement.OnKilled: agent.Stop(true); agent.enabled = false (it leaves the crowd).
 disable(){if(this.handle){this.crowd.removeAgent(this.handle);this.handle.vel.set(0,0,0);}this.straightVelocity.set(0,0,0);this.stoppedFlag=true;}
 doMove(){}
 // After the crowd update: the transform follows the agent (ground height from the colliders, as clients ground it)
 // and turns toward its velocity at angularSpeed while updateRotation is on.
 frame(ai,dt){
  if(!ai.alive||dt<=0)return;
  if(this.handle){const a=this.handle,moved=Math.hypot(a.pos.x-ai.position.x,a.pos.z-ai.position.z)>1e-7;
   if(moved){const g=this.physics.groundInfo(new Vector3(a.pos.x,Math.max(a.pos.y,ai.position.y)+1,a.pos.z),5);ai.position.set(a.pos.x,g.hit?g.pos.y:a.pos.y,a.pos.z);}
   if(this.updateRotation&&a.vel.lengthSq()>1e-8){const target=lookRotation(new Vector3(a.vel.x,0,a.vel.z));ai.rotation.rotateTowards(target,this.agent.angularSpeed*Math.PI/180*dt);}
   return;}
  const a=this.agent;let desired=new Vector3();
  if(this.straightPath&&!this.stoppedFlag&&this.destination){const to=this.destination.clone().sub(ai.position);to.y=0;const dist=to.length();
   if(dist<=Math.max(a.stoppingDistance,0.05))this.straightPath=false;
   else {let speed=a.speed;if(a.autoBraking){const slow=a.radius*2;if(dist<slow)speed*=dist/slow;}desired=to.divideScalar(dist).multiplyScalar(speed);}}
  const change=desired.sub(this.straightVelocity),max=a.acceleration*dt;if(change.length()>max)change.setLength(max);this.straightVelocity.add(change);
  if(this.straightVelocity.lengthSq()<1e-8)return;
  const step=this.straightVelocity.clone().multiplyScalar(dt),origin=ai.position.clone();origin.y+=0.5;
  if(this.physics.blocked(origin,step.clone().normalize(),a.radius+step.length())){this.straightVelocity.set(0,0,0);return;}
  const g=this.physics.groundInfo(ai.position.clone().add(step).setY(ai.position.y+1),5);
  if(!g.hit){this.straightVelocity.set(0,0,0);return;}
  ai.position.copy(g.pos);
  if(this.updateRotation){const target=lookRotation(new Vector3(this.straightVelocity.x,0,this.straightVelocity.z));ai.rotation.rotateTowards(target,a.angularSpeed*Math.PI/180*dt);}
 }
}

// TakeDamage/ProtectionTakeDamage: armor scales each damage type by clamp01(1 - armor/200).
export class Vitals {
 constructor(maxHealth,armor=[0,0,0,0,0,0],sendMessageWhenDead=false){this.maxHealth=maxHealth;this.health=maxHealth;this.armor=armor;this.sendMessageWhenDead=sendMessageWhenDead;}
 get alive(){return this.health>0;}
 get dead(){return this.health<=0;}
 // Returns 'IsAlive' | 'WasKilled' | 'IsDead'
 hurt(types){let amount=0;types.forEach((v,i)=>{if(Math.abs(v)>1e-6)amount+=this.armor[i]>0&&v>0?v*Math.min(1,Math.max(0,1-this.armor[i]/200)):v;});
  const status=this.dead?'IsDead':this.health>amount?'IsAlive':'WasKilled';if(status==='WasKilled')this.health=0;else if(status==='IsAlive')this.health-=amount;return {status,amount};}
}
export const meleeDamage=amount=>[0,0,amount,0,0,0];

// BasicWildLifeAI + HostileWildlifeAI.
export class Wildlife {
 constructor(world,key,def,spawner,entry,position,rotation){
  this.world=world;this.key=key;this.def=def;this.ai=def.ai;this.hostile=def.hostile;this.spawner=spawner;this.entry=entry;this.position=position.clone();this.rotation=rotation.clone();
  this.vitals=new Vitals(def.takeDamage.maxHealth,def.takeDamage.armor,def.takeDamage.sendMessageWhenDead);this.vis={alert:false,mute:false,deaf:false,blind:false};
  this.state=State.Idle;this.lastState=State.Idle;this.lastBounceTime=-Infinity;this.destroyed=false;this.thinking=true;
  for(const c of ['idleClock','roamClock','fleeClock','idleSoundRefireClock','nextAttackClock','attackStrikeClock','chaseSoundClock','targetReachClock','stuckClock','warnClock'])this[c]=new MillisClock();
  this.target=null;this.wasStuck=false;this.nextScentListenTime=0;this.lastNetwork=null;this.deathTime=null;
  this.harvest=new ResourceTarget(def.resourceTarget,world.rng);this.harvest.resourcesDepleted=()=>this.resourcesDepleted();
  this.move=def.movement.type==='NavMeshMovement'?new AgentMovement(def,world.physics,world.crowd):new BasicWildLifeMovement(def,world.physics);
  const viewId=randomInt(world.rng,1,1<<20);this.viewId=viewId;this.material=animalMaterial(def,viewId,world.rng);
  this.move.initialize(this);
 }
 get alive(){return this.vitals.alive;}
 get forward(){return FORWARD.clone().applyQuaternion(this.rotation);}
 sound(type){this.world.emit?.(this,'sound',type);}
 // WildlifeManager -> ManagedUpdate(millis)
 managedUpdate(ms){if(!this.alive||!this.thinking)return false;if(this.simAIState(ms))this.move.doMove(this,ms);this.doNetwork();return true;}
 simAIState(ms){
  if(this.hostile){
   if(this.warnClock.reached(ms)){this.world.audible(this,this.position,10,'hearDanger',this.position.clone());this.warnClock.resetRandomDurationSeconds(this.world.rng,4,5);}
   if(this.state===State.Chase){this.simChase(ms);return true;}
   if(this.state===State.Attack){this.simAttack(ms);return true;}
  }
  switch(this.state){case State.Idle:this.simIdle(ms);return true;case State.Flee:this.simFlee(ms);return true;case State.Roam:this.simRoam(ms);return true;default:return false;}
 }
 exitCurrentState(){
  let exited=true;
  switch(this.state){case State.Attack:case State.Chase:if(!this.hostile)exited=false;break;case State.Flee:this.vis.alert=false;break;case State.Roam:this.move.stop();break;case State.Idle:break;default:exited=false;}
  if(exited)this.lastState=this.state;return exited;
 }
 enterIdle(){const rng=this.world.rng;this.idleClock.resetRandomDurationSeconds(rng,8,10);this.move.setLookDirection(yawDirection(randomFloat(rng,0,360)),this);this.state=State.Idle;if(!this.idleSoundRefireClock.once)this.idleSoundRefireClock.resetRandomDurationSeconds(rng,2,4);}
 simIdle(ms){if(this.idleClock.reached(ms)){this.exitCurrentState();this.enterRoam();}else if(this.idleSoundRefireClock.reached(ms)){this.idleSoundRefireClock.resetDurationMillis(4000);this.sound(Sound.Idle);}}
 enterFlee(from,duration=5000){this.sound(Sound.Afraid);this.vis.alert=true;const dir=this.position.clone().sub(from).normalize();dir.y=0;this.fleeClock.resetDurationMillis(duration);this.move.setMoveDirection(dir,randomFloat(this.world.rng,this.ai.runSpeed*0.9,this.ai.runSpeed*1.1),this);this.state=State.Flee;}
 simFlee(ms){if(this.fleeClock.reached(ms)){this.exitCurrentState();this.enterIdle();}}
 enterRoam(){let dir=null;
  if(this.spawner){const a=new Vector3(this.position.x,0,this.position.z),s=this.world.spawnerPosition(this.spawner);if(a.distanceTo(new Vector3(s.x,0,s.z))>this.spawner.radius*0.5)dir=new Vector3(s.x,0,s.z).sub(a).normalize();}
  if(!dir)dir=yawDirection(randomFloat(this.world.rng,0,360));
  this.move.setMoveDirection(dir,this.ai.walkSpeed,this);this.state=State.Roam;this.roamClock.resetRandomDurationSeconds(this.world.rng,3,5);}
 simRoam(ms){if(this.roamClock.reached(ms)){this.exitCurrentState();this.enterIdle();}}
 enterDead(){this.state=State.Dead;this.vis.mute=this.vis.deaf=this.vis.blind=true;this.sound(Sound.Death);}
 bounceDirection(){const yaw=yawOf(this.forward.negate())+randomFloat(this.world.rng,-30,30);return yawDirection(yaw);}
 hitSomething(){
  if(this.hostile){this.loseTarget();this.move.setMoveDirection(this.bounceDirection(),this.ai.runSpeed,this);this.exitCurrentState();this.enterRoam();return;}
  const t=this.world.time;if(this.state!==State.Dead&&(this.state===State.Flee||(this.state===State.Roam&&this.lastBounceTime+0.5<t))){this.lastBounceTime=t;this.move.setLookDirection(this.bounceDirection(),this);}
 }
 hearFootstep(origin){if(this.hostile)return;if(this.state!==State.Flee&&this.state!==State.Dead&&this.ai.afraidOfFootsteps){this.exitCurrentState();this.enterFlee(origin);}}
 hearDanger(origin){if(this.state!==State.Flee&&this.state!==State.Dead&&this.ai.afraidOfDanger){this.exitCurrentState();this.enterFlee(origin);}}
 // HumanController.ServerFrame -> AudibleMessage(radius, "Scent", takeDamage)
 scent(target){if(!this.hostile)return;if(this.world.time>=this.nextScentListenTime&&this.state!==State.Flee&&this.state!==State.Dead&&!this.hasTarget()){this.exitCurrentState();this.target=target;this.enterChase();}}
 onHurt(attacker){
  if(this.hostile){if(!this.hasTarget()&&attacker?.character){this.target=attacker;this.exitCurrentState();this.enterChase();}return;}
  if(this.state!==State.Flee&&this.state!==State.Dead&&attacker?.character){const rng=this.world.rng,x=randomFloat(rng,-1,1),z=randomFloat(rng,-1,1);this.exitCurrentState();this.enterFlee(this.position.clone().add(new Vector3(x,0,z)));}
 }
 onKilled(){
  // HostileWildlifeAI.OnKilled instantiates dropOnDeathString first (";drop_lootsack_zombie" on the mutant wolf and bear,
  // empty on every other animal), then the base handler runs. The world places the sack (death-drop.mjs hostileDeathDrop).
  if(this.hostile&&this.ai?.dropOnDeathString)this.world.dropOnDeath?.(this,this.ai.dropOnDeathString);
  this.exitCurrentState();this.enterDead();if(this.move instanceof AgentMovement){this.move.stop();this.move.disable();}
  this.deathTime=this.world.time;this.destroyAt=this.world.time+90;this.thinking=false;this.world.emit?.(this,'death');
 }
 // TakeDamage.Hurt with relayed OnHurt/OnKilled.
 hurt(types,attacker){const r=this.vitals.hurt(types);
  if(r.status==='IsAlive'||r.status==='WasKilled'||(r.status==='IsDead'&&this.vitals.sendMessageWhenDead))this.onHurt(attacker);
  if(r.status==='WasKilled')this.onKilled();return r;}
 // TakeDamage.KillSelf: Quantity.AllHealth from the victim itself (OnHurt then OnKilled while alive).
 killSelf(){if(this.vitals.dead){if(this.vitals.sendMessageWhenDead)this.onHurt({character:this,self:true});return 'IsDead';}this.vitals.health=0;this.onHurt({character:this,self:true});this.onKilled();return 'WasKilled';}
 resourcesDepleted(){this.destroy();}
 destroy(){if(this.destroyed)return;this.destroyed=true;const list=this.entry?.spawned,i=list?list.indexOf(this):-1;if(i>=0)list.splice(i,1);this.world.remove(this);}
 doNetwork(){
  const changed=!this.lastNetwork||!approx(this.lastNetwork.p,this.position)||Math.abs(this.lastNetwork.q.dot(this.rotation))<0.9999999;
  // GetNetworkUpdate(pos, Angle2): the wire carries pitch and yaw only, so the client never sees the roll.
  if(!changed)return;this.lastNetwork={p:this.position.clone(),q:this.rotation.clone()};this.world.emit?.(this,'network',{rotation:angle2Rotation(this.rotation)});
  // DoNetwork: wildlife at or below WaterLine.Height takes twice its health.
  if(this.world.waterLine!==0&&this.position.y<=this.world.waterLine&&this.alive)this.hurt([this.vitals.health*2,0,0,0,0,0],{character:null,self:true});
 }
 // Hostile chase/attack
 hasTarget(){return Boolean(this.target&&this.target.alive);}
 loseTarget(){this.nextScentListenTime=this.world.time+10;this.target=null;this.exitCurrentState();this.enterIdle();}
 enterChase(){this.state=State.Chase;this.targetReachClock.resetRandomDurationSeconds(this.world.rng,50,60);}
 targetRange(){return this.position.distanceTo(this.target.position);}
 simChase(ms){
  if(!this.target){this.loseTarget();return;}
  const range=this.targetRange();if(range>this.ai.loseTargetRange){this.loseTarget();return;}
  const v=this.target.position.clone().sub(this.position);v.y=0;
  if(range<=this.ai.attackRange){this.move.setLookDirection(v.normalize(),this);this.exitCurrentState();this.state=State.Attack;return;}
  if(this.move.isStuck(this)){
   if(!this.wasStuck){this.wasStuck=true;this.stuckClock.resetRandomDurationSeconds(this.world.rng,1,2);}
   else if(this.stuckClock.reached(ms)){const p=this.target.position.clone();this.loseTarget();this.exitCurrentState();this.enterFlee(p,10000);return;}
  } else this.wasStuck=false;
  if(this.chaseSoundClock.reached(ms)){this.sound(range<5?Sound.ChaseClose:Sound.Chase);this.chaseSoundClock.resetRandomDurationSeconds(this.world.rng,1.5,2.5);}
  this.move.setMoveTarget(this.target,this.ai.runSpeed,this);
  if(this.targetReachClock.reached(ms)){this.loseTarget();this.exitCurrentState();this.enterIdle();}
 }
 simAttack(ms){
  if(!this.hasTarget()){this.loseTarget();return;}
  const range=this.targetRange(),v=this.target.position.clone().sub(this.position);v.y=0;this.move.setLookDirection(v.normalize(),this);
  if(this.nextAttackClock.reached(ms)){this.nextAttackClock.resetDurationSeconds(this.ai.attackRate);this.attackStrikeClock.resetDurationSeconds(0.25);this.sound(Sound.Attack);this.world.emit?.(this,'attack');}
  if(this.attackStrikeClock.reached(ms)){this.target.hurt(meleeDamage(randomFloat(this.world.rng,this.ai.attackDamageMin,this.ai.attackDamageMax)),{character:this,animal:this});this.attackStrikeClock.resetDurationSeconds(this.ai.attackRate*2);}
  if(range>this.ai.attackRangeMax){this.exitCurrentState();this.enterChase();}
 }
}

// ChickenAI.uLink_OnNetworkInstantiate -> SetGender(((id & 0xE) >> 1) <= 2, (id & 1) == 1) from the network view ID
// (rooster, ChickenMatA, ChickenMatB); WolfAI.Start: mats[Random.Range(0, mats.Length)] on the client. Others keep theirs.
export function animalMaterial(def,viewId,rng=Math.random){
 if(def.aiClass==='ChickenAI')return ((viewId&0xE)>>1)<=2?'roosterMat':(viewId&1)===1?'ChickenMatB':'ChickenMatA';
 const mats=def.materialVariants?.mats;return mats?.length?mats[randomInt(rng,0,mats.length)]:undefined;}
// Angle2 (Unity space): the server stores pitch = -eulerAngles.x, yaw = eulerAngles.y (roll dropped); the client rebuilds
// Quaternion.Euler(-pitch, yaw, 0). Unity's Euler order (Z, then X, then Y) is three's 'YXZ'.
export const angle2Quaternion=({pitch,yaw})=>new Quaternion().setFromEuler(new Euler(-pitch*Math.PI/180,yaw*Math.PI/180,0,'YXZ'));
export function quaternionAngle2(q){const e=new Euler().setFromQuaternion(q,'YXZ');return {pitch:-e.x*180/Math.PI,yaw:e.y*180/Math.PI};}
export const angle2Rotation=q=>angle2Quaternion(quaternionAngle2(q));

// Client move-animation choice (ChickenAI/RabbitAI/BoarAI/StagAI/WolfAI/BearAI Update) from the observed speed.
export function moveAnimation(def,speed){
 const c=def.aiClass,ai=def.ai;
 const idle={ChickenAI:'idleEat',RabbitAI:'idle1',BoarAI:'idle1',StagAI:'idle1',WolfAI:'idle',BearAI:'idle4Legs'}[c]??'idle';
 if(speed<=0.001)return {clip:idle,speed:1};
 if(speed<=2){if(c==='ChickenAI')return {clip:'walk',speed:speed/0.75};if(c==='RabbitAI')return {clip:'hop',speed:speed/0.75};return {clip:'walk',speed:speed/ai.walkAnimScalar};}
 if(c==='ChickenAI'||c==='RabbitAI')return {clip:'run',speed:speed/3};return {clip:'run',speed:speed/ai.runAnimScalar};
}
export const deathAnimation=def=>def.aiClass==='BearAI'?'4LegsDeath':'death';
export function attackAnimation(def,rng){if(def.aiClass==='BearAI')return ['4LegsClawsAttackL','4LegsClawsAttackR','4LegsBiteAttack'][randomInt(rng,0,3)];return 'bite';}
// Client PlaySnd volume / min / max distance per sound type.
export const soundSettings={[Sound.Idle]:['idleSounds',0.4,0.25,8],[Sound.Afraid]:['fleeStartSounds',0.9,1.25,10],[Sound.Death]:['deathSounds',1,2.25,20],[Sound.Chase]:['chaseSoundsFar',1,0.25,25],[Sound.ChaseClose]:['chaseSoundsClose',1,0,10],[Sound.Attack]:['attackSounds',1,0,10]};

// WildlifeManager + VisNode audible messages. Thinks every floor(1000 * sendInterval) ms (server.cfg sendrate 5).
export class WildlifeWorld {
 constructor({rng=Math.random,physics,waterLine=0,thinkInterval=200,emit,onRemove,dropOnDeath}={}){this.rng=rng;this.physics=physics;this.waterLine=waterLine;this.thinkInterval=thinkInterval;this.emit=emit;this.onRemove=onRemove;this.dropOnDeath=dropOnDeath;this.animals=new Set();this.time=0;
  // One crowd for every NavMeshMovement animal; physics.navObstacles() supplies enabled NavMeshObstacle cylinders.
  this.crowd=physics?.navmesh?new NavCrowd(physics.navmesh,{obstacles:()=>physics.navObstacles?.()??[]}):null;}
 spawnerPosition(spawner){const p=spawner.position;return new Vector3(p[0],p[1],-p[2]);}
 // NavMeshMovement.SharedNetworkInstantiate -> RemoveIfNotOnNavmesh: an agent that could not be placed on the navmesh
 // (disabled) is killed with TakeDamage.KillSelf; the corpse stays for BasicWildLifeAI's 90 s DelayedDestroy.
 add(animal){animal.lastUpdate=null;this.animals.add(animal);if(animal.move.offMesh)animal.killSelf();return animal;}
 remove(animal){this.animals.delete(animal);this.onRemove?.(animal);}
 // VisNode.AudibleMessage: every listener within radius except the instigator receives the message.
 audible(instigator,origin,radius,message,arg){for(const a of [...this.animals])if(a!==instigator&&!a.destroyed&&a.position.distanceTo(origin)<=radius)a[message]?.(arg);}
 // WildlifeManager thinks run in Update; Unity then advances the NavMeshAgents (crowd) and their transforms.
 update(seconds,dt){this.time=seconds;const now=Math.floor(seconds*1000);
  for(const a of [...this.animals]){
   if(a.destroyed)continue;
   if(!a.alive){if(a.destroyAt!==undefined&&seconds>=a.destroyAt)a.destroy();continue;}
   if(a.lastUpdate===null){a.lastUpdate=now-this.thinkInterval;}
   const elapsed=now-a.lastUpdate;if(elapsed<this.thinkInterval-15)continue;a.lastUpdate=now;a.managedUpdate(elapsed);
  }
  this.crowd?.update(dt);
  for(const a of this.animals)if(!a.destroyed)a.move.frame?.(a,dt);
 }
}
