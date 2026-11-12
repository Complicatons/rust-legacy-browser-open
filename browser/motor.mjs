import {Vector3,Ray,Matrix3,Matrix4,Quaternion,Box3} from 'three';
import {segmentTriangle} from './collision.mjs';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
// Unity AnimationCurve Hermite interpolation, including recovered key tangents.
export function evaluateCurve(curve,time){const keys=curve.m_Curve;if(time<=keys[0].time)return keys[0].value;if(time>=keys.at(-1).time)return keys.at(-1).value;
 for(let i=1;i<keys.length;i++){const a=keys[i-1],b=keys[i];if(time>b.time)continue;const duration=b.time-a.time,t=(time-a.time)/duration,t2=t*t,t3=t2*t;return (2*t3-3*t2+1)*a.value+(t3-2*t2+t)*duration*a.outSlope+(-2*t3+3*t2)*b.value+(t3-t2)*duration*b.inSlope;}
}
export function directionalSpeed(x,forward,settings){const mag=Math.hypot(x,forward);if(mag===0||settings.maxSidewaysSpeed===0)return 0;const ratio=(forward>0?settings.maxForwardSpeed:settings.maxBackwardsSpeed)/settings.maxSidewaysSpeed;return ratio?settings.maxSidewaysSpeed*mag/Math.hypot(x,forward/ratio):0;}
// CurveUtility.EvaluateClampedTime: advances `state[key]` by `advance` within the curve's key range (only while it is
// not already at that end), then evaluates the curve there.
function evaluateClampedTime(curve,state,key,advance){const keys=curve.m_Curve;if(!keys.length)return 1;if(keys.length===1)return evaluateCurve(curve,0);
 if(advance>0){const end=keys.at(-1).time;if(state[key]<end){state[key]+=advance;if(state[key]>end)state[key]=end;}}
 else if(advance<0){const start=keys[0].time;if(state[key]>start){state[key]+=advance;if(state[key]<start)state[key]=start;}}
 return evaluateCurve(curve,state[key]);}
// Mathf.Approximately.
const approximately=(a,b)=>Math.abs(b-a)<Math.max(1e-6*Math.max(Math.abs(a),Math.abs(b)),1.1920929e-7*8);
// Vector3.Slerp between unit vectors.
function slerp(a,b,t){const d=clamp(a.dot(b),-1,1),theta=Math.acos(d);if(theta<1e-6)return a.clone().lerp(b,t);const s=Math.sin(theta);
 return a.clone().multiplyScalar(Math.sin((1-t)*theta)/s).addScaledVector(b,Math.sin(t*theta)/s);}

// HumanController.UpdateInput (lines 421-442) on a polled InputSample ({forward (walk), right (strafe), jump, crouch,
// sprint, attack2}): a leg injury forces crouch and no jump; sprint is cancelled unless walking forward without strafe
// (|strafe| < 0.05), and never with AltFire held, while crafting or injured; InputSample.MovementScale halves the
// movement for crafting and again for a leg injury. The sample then goes to the held item's ItemPreFrame (which may
// set aim) and to the motor (ProcessInput).
export function humanInputSample(raw={},{crafting=false,injured=false}={}){
 const s={forward:raw.forward||0,right:raw.right||0,jump:Boolean(raw.jump),crouch:Boolean(raw.crouch),sprint:Boolean(raw.sprint),attack2:Boolean(raw.attack2),aim:Boolean(raw.aim)};
 if(injured){s.crouch=true;s.jump=false;}
 if(s.forward<=0||Math.abs(s.right)>=0.05||s.attack2||crafting||injured)s.sprint=false;
 let scale=1;if(crafting)scale*=0.5;if(injured)scale*=0.5;s.scale=(raw.scale??1)*scale;
 return s;}
// InputSample.is_sprinting (WeaponItem.ItemPreFrame's sprint fire lockout): sprint && !aim && walk != 0, read before
// ProcessInput's airborne clear.
export const isSprinting=s=>Boolean(s?.sprint&&!s.aim&&(s.forward||0)!==0);

// CCTotem.Configuration for the player's CCTotemPole (minimumHeight 1.3, maximumHeight 2.08, bottomBufferUnits .2) and
// its CCDesc figure prefab (CharacterController radius .405, height 1.16, skinWidth .045). The pole is a stack of
// `figures` CharacterControllers whose skinned capsules (radius + skin) overlap into one capsule from the feet
// (worldSkinnedBottom) to feet + height, so a single skinned capsule is the same solid volume.
export function totemConfiguration(totem,controller){
 const skin=controller.m_SkinWidth,radius=controller.m_Radius,skinnedRadius=radius+skin,skinnedHeight=controller.m_Height+2*skin,slide=skinnedHeight-2*skinnedRadius;
 let units=totem.bottomBufferUnits;if(Math.abs(units)<1e-6)units=0;let bottomBuffer=slide*0.5*units;if(bottomBuffer>slide)bottomBuffer=slide;
 const mostContracted=skinnedHeight+bottomBuffer,contracted=Math.max(mostContracted,totem.minimumHeight),expanded=Math.max(contracted,totem.maximumHeight);
 const fixed=skinnedRadius+bottomBuffer+skinnedRadius,sliding=Math.ceil((expanded-fixed)/slide);
 // CCTotemPole.Members: initialHeight = min + (max - min) * initialHeightFraction; Create() starts the pole at it.
 const initial=clamp(totem.minimumHeight+(totem.maximumHeight-totem.minimumHeight)*totem.initialHeightFraction,contracted,expanded);
 return {skin,radius,skinnedRadius,skinnedHeight,slide,bottomBuffer,contracted,expanded,initial,figures:1+sliding};
}

// Crouchable.Smoothing (kSmoothInterval .003223976 s, stiffness 5, damp .5, input damp 0): the local eye's crouch offset
// catches up with the totem height in fixed sub-steps. Ported literally, including the remainder extrapolation.
export class CrouchSmoothing {
 constructor(){this.reset();}
 reset(){this.I=false;this.T=0;this.A=0;this.V=0;this.Y=0;this.Z=0;}
 addSeconds(s){if(s>0){this.Z+=s;this.Y+=s;}}
 catchUp(target){let num;const EPS=1.401298464324817e-45;
  if(!this.I){this.Y=this.V=this.Z=0;this.I=true;num=this.T=this.A=target;}
  else {if(this.Z>0){this.V+=(target-this.T)/this.Z*0;this.Z=0;}
   const dt=0.003223976065201692;let y=this.Y;
   if(y>=dt){let x=this.A-(this.T=target),v=this.V;do{const prev=x;x+=v*dt;const a=-x*5-0.5*v;x+=a*dt;v=(x-prev)/dt;}while((y-=dt)>=dt);this.A=target+x;this.V=v;this.Y=y;}
   num=!(y<EPS)?this.A+this.V*y:this.A;}
  return (!(num<EPS)||!(num>-EPS))?Math.fround(num):0;}
}

// Facepunch.Geometry Solve.IntersectDirect(Box, Sphere): squared distance from the sphere centre to the box <= r².
export function boxIntersectsSphere(box,center,radius){const d=[center.x-box.center[0],center.y-box.center[1],center.z-box.center[2]];let sq=0;
 for(const [axis,size] of [[box.x,box.size[0]],[box.y,box.size[1]],[box.z,box.size[2]]]){const p=axis[0]*d[0]+axis[1]*d[1]+axis[2]*d[2],h=size*0.5,o=p<-h?p+h:p>h?p-h:0;sq+=o*o;}
 return sq<=radius*radius;}
// Unity BoxCollider vs sphere (Physics.OverlapSphere broad test), in the collider's local space.
function colliderIntersectsSphere(c,center,radius){return boxIntersectsSphere({center:c.center,size:c.size,x:[1,0,0],y:[0,1,0],z:[0,0,1]},center,radius);}
// CCPusher.Push(Sphere, ref Velocity) in collider-local space. Plane.DirectionPoint stores Distance = -(dir·point) and
// Plane.DistanceTo returns dir·x - Distance, i.e. dir·(x + point) (sic); both planes are measured at the sphere's
// surface point along each plane direction, and the push goes along plane 0 only when its value is larger.
export function ccPusherPush(p,center,radius,dt){
 if(!boxIntersectsSphere(p.shape,center,radius))return null;
 const unit=v=>{const l=Math.hypot(v[0],v[1],v[2]);return [v[0]/l,v[1]/l,v[2]/l];},n0=unit(p.pushDir0),n1=unit(p.pushDir1);
 const distance=(dir,point,n)=>{const x=[center.x+n[0]*radius,center.y+n[1]*radius,center.z+n[2]*radius];return dir[0]*x[0]+dir[1]*x[1]+dir[2]*x[2]+(dir[0]*point[0]+dir[1]*point[1]+dir[2]*point[2]);};
 const a=distance(p.pushDir0,p.pushPoint0,n0),b=distance(p.pushDir1,p.pushPoint1,n1),n=a>b?n0:n1,s=p.pushSpeed*dt;
 return new Vector3(n[0]*s,n[1]*s,n[2]*s);}
// Rotation about +Y between two body matrices (browser space), radians: platform yaw carried onto the character.
function yawBetween(now,then){const q=new Quaternion().setFromRotationMatrix(now),p=new Quaternion().setFromRotationMatrix(then),d=q.multiply(p.invert());
 const f=new Vector3(0,0,-1).applyQuaternion(d);return Math.hypot(f.x,f.z)<1e-9?0:Math.atan2(-f.x,-f.z);}
// Ground that is not a moving body (terrain or the static scene) is still a "platform" in CCMotor's bookkeeping.
const STATIC={static:true,motion:new Matrix4()};
// TimeManager Fixed Timestep (client mainData).
const FIXED_TIMESTEP=0.019999999552965164;
// Gap (m) at which the motor's sweeps count the capsule as touching a triangle.
const SWEEP_CONTACT=1e-4,DOWN=new Vector3(0,-1,0);

export class LegacyMotor {
 // options.collisionMask: the original layer-collision row of the controller's layer (16, physics.json); bodies whose
 // solid layers it excludes never block the player. Without it every body except noCollide ones collides.
 constructor(config,world,options={}){this.config=config;this.world=world;this.settings=config.motorSettings.data;this.controls=config.traits.HumanControlConfiguration.data;
  const c=config.controller.data;this.totem=totemConfiguration(config.totem.data,c);this.skin=this.totem.skin;this.controllerRadius=c.m_Radius;
  // PhysX keeps the controller skinWidth (contact offset) away from geometry: the solid hull is radius + skin.
  this.radius=this.totem.skinnedRadius;this.stepOffset=c.m_StepOffset;this.slopeCos=Math.cos(c.m_SlopeLimit*Math.PI/180);
  this.standing=this.totem.expanded;this.minimum=this.totem.contracted;this.eyeHeight=config.eyes.m_LocalPosition.y;
  this.mask=options.collisionMask??null;this.skip=b=>Boolean(b&&(b.noCollide||this.ghosts.has(b)||(this.mask!==null&&!(b.solidLayers??[b.layer??0]).some(l=>(this.mask>>>l)&1))));
  // Kinematic pusher doors that moved into the controller: PhysX does not depenetrate a CharacterController from a moving
  // kinematic body, so the door passes through and its CCPusher pushes the player out; collision resumes once clear.
  this.ghosts=new Set();this.ghostMoved=new Map();this.pusherMotion=new Map();
  this.smoothing=new CrouchSmoothing();this.height=this.standing;this.eye=this.eyeHeight;this.feet=new Vector3();this.velocity=new Vector3();this.grounded=false;this.crouched=false;this.crouchBlocked=false;
  this.sprintTime=0;this.crouchTime=0;this.time=0;this.accumulator=0;this.collisions=0;this.frameDt=1/60;this.resetHuman();
  this.platform=null;this.platformLocal=new Vector3();this.platformGlobal=new Vector3();this.platformMatrix=new Matrix4();this.platformLast=new Matrix4();this.newPlatform=false;
  this.platformVelocity=new Vector3();this.frameVelocity=new Vector3();this.pendingSubtract=null;this.yawDelta=0;this.pushing=false;}
 // CCMotor.Teleport -> CCTotemPole.Teleport recreates the pole at its initial height (fraction 0: contracted) and the
 // eye smoothing restarts (a new character on respawn). `settle` (developer helpers only) starts fully expanded.
 teleport(position,{settle=false}={}){this.teleports=(this.teleports??0)+1;this.ghosts.clear();this.feet.copy(position);this.velocity.set(0,0,0);this.grounded=false;this.height=settle?this.standing:this.totem.initial;
  this.sprintTime=0;this.crouchTime=0;this.accumulator=0;this.resetHuman();this.platform=null;this.platformVelocity.set(0,0,0);this.frameVelocity.set(0,0,0);this.pendingSubtract=null;this.crouchBlocked=false;
  this.world.resolve(this.feet,this.height,this.radius,this.skip);this.smoothing.reset();this.updateEye(0);}
 cameraPosition(){return this.feet.clone().add(new Vector3(0,this.eye,0));}
 // HumanController steps the motor once per frame with Time.deltaTime; the port sub-steps at 120 Hz. CCPusher uses the
 // frame's Time.deltaTime, so the frame length is kept for it.
 update(dt,input,yaw){this.frameDt=Math.min(dt,0.1);this.accumulator+=Math.min(dt,0.1);while(this.accumulator>=1/120){this.step(1/120,input,yaw);this.accumulator-=1/120;}}
 // Platform yaw (radians, browser +Y) accumulated for the camera; CCMotor.BindCharacter adds it to eyesYaw.
 takeYawDelta(){const d=this.yawDelta;this.yawDelta=0;return d;}
 // Largest upward offset (<= distance) at which the standing capsule stays clear: the autostep's ceiling check.
 clearance(feet,distance){const p=feet.clone();p.y+=distance;if(!this.world.overlaps(p,this.height,this.radius,1e-4,this.skip))return distance;
  let lo=0,hi=distance;for(let i=0;i<10;i++){const mid=(lo+hi)/2;p.y=feet.y+mid;if(this.world.overlaps(p,this.height,this.radius,1e-4,this.skip))hi=mid;else lo=mid;}
  return Math.max(0,lo-0.01);} // headroom so the side pass does not graze the ceiling edge
 // CCTotem.TotemPole.Move: after the bottom figure moves, the top figure sweeps to the wanted height and stops at the
 // first contact (a partly raised pole), the middle figures spread between. Returns the reached height.
 // The probe is the top figure's skinned capsule; only contacts above it (CollisionFlags.Above) stop the expansion.
 expandTo(feet,from,to){const fig=this.totem.skinnedHeight,p=new Vector3(),above=h=>{p.set(feet.x,feet.y+h-fig,feet.z);const hit=this.world.capsuleHit(this.world.capsule(p,fig,this.radius),this.skip);return Boolean(hit&&hit.depth>2e-3&&hit.normal.y<-1e-3);};
  if(!above(to))return to;if(above(from))return from;let lo=from,hi=to;for(let i=0;i<12;i++){const mid=(lo+hi)/2;if(above(mid))hi=mid;else lo=mid;}return lo;}
 // First solid (not skipped) contact when the capsule moves straight down by up to `distance`. Terrain is a
 // heightfield and handled separately.
 sweepDown(feet,distance){return this.contact(feet,DOWN,distance,this.sweepTriangles(feet,distance));}
 // Solid triangles (not skipped) the capsule at `feet` can reach within `reach` metres, with their unit normals.
 sweepTriangles(feet,reach){const r=this.radius+reach+SWEEP_CONTACT,area=new Box3(new Vector3(feet.x-r,feet.y-reach-SWEEP_CONTACT,feet.z-r),new Vector3(feet.x+r,feet.y+this.height+reach+SWEEP_CONTACT,feet.z+r));
  return this.world.bodyTriangles(area,this.skip).map(x=>({...x,normal:x.triangle.getNormal(new Vector3())}));}
 // PhysX CharacterController sweep (SweepTest): the first contact of the capsule moving from `feet` along unit `dir`
 // within `length`, as {distance, normal (from the contact towards the capsule axis), body}, or null. Mesh sweeps are
 // single-sided as in PhysX: only a triangle facing the motion stops the capsule, and only with the capsule in front of
 // it, so a capsule touching a face from behind (inside a rock, a lip it came up under) moves on instead of being pushed
 // through. `flat` (a grounded side pass) skips contacts whose normal has no horizontal part.
 contact(feet,dir,length,triangles,flat=false){const r=this.radius,low=feet.y+r,high=feet.y+Math.max(r,this.height-r),p=new Vector3(),q=new Vector3(),onAxis=new Vector3(),onTri=new Vector3(),away=new Vector3();
  let best=null,toi=length;
  for(const {triangle:t,normal:n,body} of triangles){if(n.dot(dir)>=0)continue; // back-face culled
   const gap=s=>{p.set(feet.x+dir.x*s,low+dir.y*s,feet.z+dir.z*s);q.set(p.x,high+dir.y*s,p.z);return segmentTriangle(p,q,t,n,onAxis,onTri)-r;};
   // Conservative advancement: the axis-to-triangle distance shrinks by at most the distance moved, so stepping by the
   // gap never skips a contact; a 2 mm minimum step (bisected back on overshoot) bounds grazing approaches.
   let s=0,last=0,g=gap(0),touching=false;
   for(let k=0;k<64;k++){if(g<0){let lo=last,hi=s;for(let j=0;j<12;j++){const m=(lo+hi)/2;if(gap(m)<0)hi=m;else lo=m;}s=lo;g=gap(s);touching=true;break;}
    if(g<SWEEP_CONTACT){touching=true;break;}if(s>=toi)break;last=s;s=Math.min(toi,s+Math.max(g,0.002));g=gap(s);}
   if(!touching)continue;const d=g+r;
   // The axis passes through the triangle (the capsule came in from behind it): it goes on, but never back out
   // through the front, and slides along the face instead.
   if(d<1e-6){if(flat&&Math.hypot(n.x,n.z)<1e-3)continue;toi=s;best={distance:s,normal:n.clone(),body};continue;}
   // Touching: it stops the capsule when the capsule is in front of the face and still closing on it (the distance is
   // convex along the sweep, so a contact that is not closing never stops it further on).
   if(n.dot(away.subVectors(onAxis,t.a))<0)continue;away.subVectors(onAxis,onTri).divideScalar(d);if(away.dot(dir)>-1e-6)continue;
   if(flat&&Math.hypot(away.x,away.z)<1e-3)continue;
   toi=s;best={distance:s,normal:away.clone(),body};}
  return best;}
 // PhysX tests slopeLimit against the touched triangle, not the capsule's contact normal: a capsule resting on a
 // stair nosing gets a diagonal contact normal from a flat tread. Sample the surface just inside the contact.
 // PhysX also refuses a step whose contact point is more than stepOffset above where the move started.
 // Returns the ground normal CCMotor.OnHit records (the touched triangle's for a nosing contact), or null.
 walkable(feet,contact,maxY){const n=contact.normal,flat=Math.hypot(n.x,n.z)||1,c=new Vector3(feet.x,feet.y-contact.distance+this.radius,feet.z).addScaledVector(n,-this.radius);
  if(c.y>maxY+1e-3)return null;if(n.y>=this.slopeCos)return n.clone();
  const hit=this.world.rayHit(new Ray(new Vector3(c.x-n.x/flat*0.02,c.y+0.05,c.z-n.z/flat*0.02),new Vector3(0,-1,0)),0.1,this.skip);
  if(!(hit&&hit.distance<=0.1))return null;const t=hit.triangle.getNormal(new Vector3());if(t.y<0)t.negate();return t.y>=this.slopeCos?t:null;}
 // Moves `feet` by `motion` in up to `iterations` sweeps: each stops at the first contact and the rest of the motion
 // slides along it (collision response, bump 0, friction 0), so the capsule never travels further than asked and never
 // passes a solid. Returns the contact normals. A grounded side pass (`flat`) slides along contacts in the horizontal
 // plane only, so obstacles taller than the autostep (or a nosing caught by the capsule's lower sphere) block instead
 // of lifting the controller.
 sweep(feet,motion,flat=false,iterations=10){const normals=[],total=motion.length();if(total<1e-9)return normals;
  const triangles=this.sweepTriangles(feet,total),rest=motion.clone(),dir=new Vector3();
  for(let i=0;i<iterations;i++){const length=rest.length();if(length<1e-7)break;dir.copy(rest).divideScalar(length);
   const c=this.contact(feet,dir,length,triangles,flat);feet.addScaledVector(dir,c?c.distance:length);if(!c)break;
   const n=c.normal;if(flat){n.y=0;n.normalize();}
   rest.copy(dir).multiplyScalar(length-c.distance);rest.addScaledVector(n,-rest.dot(n));normals.push(n);}
  return normals;}
 // Raises `feet` towards height `y` as a sweep that stops under a solid above; with `slide` it slides along what it
 // touches (an overhanging wall), otherwise it stops at the first contact.
 riseTo(feet,y,slide=false){if(y>feet.y)this.sweep(feet,new Vector3(0,y-feet.y,0),false,slide?10:1);return feet;}
 // One CharacterController.Move in PhysX character-controller order: up pass (jump rise + autostep lift), side pass,
 // down pass. While grounded CCMotor.StepPhysics adds max(stepOffset, horizontal distance) of downward motion
 // (num3) so the controller follows stairs and slopes down. If nothing is below, PhysX moves the whole distance: the
 // original's `vector6.y += num3` on losing the ground only corrects the moving-platform bookkeeping point, not the
 // transform, so walking off a ledge drops up to num3 in that frame.
 move(before,delta,snapping,stepOffset){const feet=before.clone(),normals=[],h=Math.hypot(delta.x,delta.z);
  const lift=stepOffset>0?this.clearance(feet,stepOffset):0,up=Math.max(0,delta.y)+lift;
  if(up>0)normals.push(...this.sweep(feet,new Vector3(0,up,0),false,1));
  let blocked=false;if(h>0){const side=this.sweep(feet,new Vector3(delta.x,0,delta.z),snapping);blocked=side.length>0;normals.push(...side);}
  const sideY=feet.y;
  let required=lift+Math.max(0,-delta.y),remaining=required+(snapping?Math.max(this.stepOffset,h):0),ground=null,groundBody=null,free=true;const lowest=feet.y-remaining;
  // The TerrainCollider is part of the same down sweep: a solid contact below the terrain surface (a rock's buried
  // base) is never reached; the terrain is.
  for(let i=0;i<3&&remaining>1e-6;i++){const c=this.sweepDown(feet,remaining),below=this.world.ground?.(feet.x,feet.z);if(!c||Number.isFinite(below)&&feet.y-below<c.distance)break;
   const walk=c.normal.y>0.01?this.walkable(feet,c,before.y+this.stepOffset):null;if(walk){feet.y-=c.distance;ground=walk;groundBody=c.body??STATIC;break;}
   // Too steep to stand on: move onto it and slide 2 cm further down along it (no lower than the terrain) instead of
   // hanging on the contact.
   feet.y-=c.distance;remaining-=c.distance;required=Math.max(0,required-c.distance);normals.push(c.normal.clone());
   const fall=Math.min(remaining,0.02),slide=new Vector3(0,-fall,0).addScaledVector(c.normal,fall*c.normal.y),floor=this.world.ground?.(feet.x,feet.z);
   if(Number.isFinite(floor)&&-slide.y>feet.y-floor)slide.multiplyScalar(Math.max(0,feet.y-floor)/-slide.y);
   const y=feet.y;normals.push(...this.sweep(feet,slide));const d=y-feet.y;remaining-=d;required=Math.max(0,required-d);if(d<1e-6||i===2){free=false;break;}}
  // Terrain heightfield: a grounded controller also follows walkable terrain down within the same reach, when no solid
  // stopped the down sweep first.
  const t=this.world.ground?.(feet.x,feet.z);
  if(!ground&&free&&Number.isFinite(t)&&t<=feet.y+1e-6&&t>=lowest-1e-6){const n=this.world.terrainNormal(feet.x,feet.z);if(n.y>=this.slopeCos){feet.y=t+0.001;ground=n;groundBody=STATIC;}}
  // Nothing solid within reach (or the terrain first): the whole distance. Below the terrain the sweep has stopped on
  // the TerrainCollider (step() puts the feet back on it or undoes a climb up steep terrain).
  if(!ground&&free&&remaining>1e-9)feet.y-=remaining;
  return {feet,normals,ground,groundBody,lift,blocked,sideY};}
 // Whether moving the capsule from `a` to `b` (feet) took its axis (bottom, middle and top sphere centres) through a
 // solid's front face. Rays only meet front faces, so leaving a solid from inside is never blocked.
 crossedSolid(a,b){const d=b.clone().sub(a),length=d.length();if(length<1e-6)return false;d.divideScalar(length);
  for(const h of [this.radius,this.height/2,this.height-this.radius]){const hit=this.world.rayHit(new Ray(new Vector3(a.x,a.y+h,a.z),d),length,this.skip);if(hit&&hit.distance<=length)return true;}
  return false;}
 // CCMotor.ApplyHorizontalPushVelocity: OverlapSphere(pole worldCenter, effectiveSkinnedHeight, layers 18|20) and each
 // collider's CCPusher tests (Sphere)capsule = the pole capsule's bottom sphere (Line.A, unskinned radius).
 pushVelocity(){const list=this.world.pushers;if(!list?.length)return null;
  const center=this.feet.clone();center.y+=this.height/2;const bottom=this.feet.clone();bottom.y+=this.skin+this.controllerRadius;
  const sum=new Vector3();let pushed=false;const inv=new Matrix4();
  for(const p of list){if(!((1310720>>>(p.layer??0))&1))continue;const m=p.matrix?.();if(!m)continue;inv.copy(m).invert();
   if(p.collider&&!colliderIntersectsSphere(p.collider,center.clone().applyMatrix4(inv),this.height))continue;
   const v=ccPusherPush(p,bottom.clone().applyMatrix4(inv),this.controllerRadius,this.frameDt);if(!v)continue;
   pushed=true;sum.add(v.applyMatrix3(new Matrix3().setFromMatrix4(m)));}
  if(!pushed)return null;sum.y=0;return sum;}
 // CCMotor FixedUpdate: platformVelocity from the active platform's motion since the last step (zero for a new one).
 platformStep(dt){if(!this.platform){this.platformVelocity.set(0,0,0);return;}const m=this.platform.motion;
  if(!this.newPlatform){const a=this.platformLocal.clone().applyMatrix4(m),b=this.platformLocal.clone().applyMatrix4(this.platformLast);this.platformVelocity.copy(a.sub(b).divideScalar(dt));}
  else this.newPlatform=false;this.platformLast.copy(m);}
 updateEye(dt){this.smoothing.addSeconds(dt);this.eye=this.eyeHeight+this.smoothing.catchUp(this.height-this.standing);}
 // A pusher door moving into the controller (its skinned capsule) becomes a ghost: PhysX never moves a CharacterController
 // for another body's motion, so the door passes into it and only CCPusher pushes the player out. The ghost is released
 // once the door has been still for 0.1 s and the unskinned capsule (radius .405) is clear; skin contacts then resolve.
 updateGhosts(){const list=this.world.pushers;if(!list?.length)return;const outer=this.world.capsule(this.feet,this.height,this.radius),inner=this.world.capsule(this.feet,this.height,this.controllerRadius);
  for(const p of list){const b=p.body;if(!b)continue;const last=this.pusherMotion.get(b);if(!last){this.pusherMotion.set(b,b.motion.clone());continue;}
   if(!last.equals(b.motion)){last.copy(b.motion);if(this.ghosts.has(b))this.ghostMoved.set(b,this.time);else{const h=this.world.capsuleHit(outer,x=>x!==b);if(h&&h.depth>1e-4){this.ghosts.add(b);this.ghostMoved.set(b,this.time);}}}}
  for(const g of [...this.ghosts]){if(this.time-(this.ghostMoved.get(g)??-Infinity)<0.1)continue;const h=this.world.capsuleHit(inner,b=>b!==g);if(!h||h.depth<=1e-4)this.ghosts.delete(g);}}
 // HumanController/CCMotor state a new character starts with (CCMotor.JumpingContext defaults, HumanController fields).
 resetHuman(){this.groundNormal=new Vector3();this.moveDirection=new Vector3();this.inputDirection=[0,0,0];this.jumpInput=false;this.crouchSpeed=1;
  this.jumping=false;this.holdingJumpButton=false;this.startedJumping=false;this.lastStartTime=0;this.lastButtonDownTime=-100;this.lastLandTime=-Infinity;this.jumpDir=new Vector3(0,1,0);this.jumps=0;
  this.wasInAir=false;this.magnitudeAir=0;this.landingSpeedPenaltyTime=3.4028234663852886e38;
  this.sample={sprint:false,crouch:false,aim:false,crouchBlocked:false,grounded:false,sliding:false,airborne:true,cleared:true,moving:false};}
 // CCMotor.tooSteep / isSliding (slidingEnable is 0 for the player, so it never slips).
 get tooSteep(){return this.groundNormal.y<=this.slopeCos;}
 get isSliding(){return this.grounded&&Boolean(this.settings.slidingEnable)&&this.tooSteep;}
 // HumanController.ProcessInput (lines 464-577), the motor half, once per motor step on the sample UpdateInput made
 // ({forward, right, jump, crouch, sprint, aim, scale}). Off the ground it clears sprint, crouch, aim and the crouch block
 // (the pole regrows, the aim flag drops) and locks the move magnitude to the one the player left the ground with;
 // landing restarts the landing speed penalty curve. Builds CCMotor.InputFrame (moveDirection, crouchSpeed, jump).
 processInput(dt,input,yaw){const c=this.controls,grounded=this.grounded,sliding=this.isSliding;
  const sample={sprint:Boolean(input.sprint),crouch:Boolean(input.crouch),aim:Boolean(input.aim),crouchBlocked:this.crouchBlocked,grounded,sliding,airborne:!grounded,cleared:!grounded&&!sliding,moving:Boolean(input.forward||input.right)};
  if(sample.cleared){sample.sprint=false;sample.crouch=false;sample.aim=false;sample.crouchBlocked=false;
   if(!this.wasInAir){this.wasInAir=true;this.magnitudeAir=this.moveDirection.length();}}
  else if(this.wasInAir){this.wasInAir=false;this.magnitudeAir=1;this.landingSpeedPenaltyTime=0;}
  // flag3: crouching or last frame's crouch block.
  const flag3=sample.crouch||sample.crouchBlocked;this.crouched=flag3;
  let x=input.right||0,f=input.forward||0;
  if(x!==0||f!==0){let mag=Math.hypot(x,f);if(mag<1){x/=mag;f/=mag;mag*=mag;x*=mag;f*=mag;}else if(mag>1){x/=mag;f/=mag;}
   const scale=input.scale??1;if(scale<1){if(scale>0){x*=scale;f*=scale;}else x=f=0;}
   const sx=x*c.sprintScalars.x,sf=f*c.sprintScalars.y;let advance;
   if(sample.sprint&&!flag3&&!sample.aim)advance=dt;else{sample.sprint=false;advance=-dt;} // sprintInMulTime 1
   const sprint=evaluateClampedTime(c.sprintAddSpeedByTime,this,'sprintTime',advance);x+=sx*sprint;f+=sf*sprint;
   const crouch=evaluateClampedTime(c.crouchMulSpeedByTime,this,'crouchTime',flag3?dt:-dt);x*=crouch;f*=crouch; // crouchInMulTime 1
   if(this.wasInAir){const m=Math.hypot(x,f);if(m>0&&!approximately(m,this.magnitudeAir)){x=x/m*this.magnitudeAir;f=f/m*this.magnitudeAir;}}
   else{const k=evaluateClampedTime(c.landingSpeedPenalty,this,'landingSpeedPenaltyTime',dt);x*=k;f*=k;}}
  else{this.sprintTime=0;this.crouchTime=sample.crouch?c.crouchMulSpeedByTime.m_Curve.at(-1).time:0;this.magnitudeAir=1;}
  // Body-local Unity space (HeadBob's input force) and world (browser) space.
  this.inputDirection=[x,0,f];this.moveDirection.set(-Math.sin(yaw)*f+Math.cos(yaw)*x,0,-Math.cos(yaw)*f-Math.sin(yaw)*x);
  this.jumpInput=Boolean(input.jump);this.crouchSpeed=sample.crouch?-1:1;
  return sample;}
 // CCMotor.DesiredHorizontalVelocity (lines 944-957): MaxSpeedInDirection, times slopeSpeedMultiplier at the angle of
 // the current velocity (asin(velocity.normalized.y)) while grounded, plus the CCPusher push.
 desiredHorizontalVelocity(){const s=this.settings,[x,,f]=this.inputDirection;let speed=directionalSpeed(x,f,s);
  if(this.grounded){const v=this.velocity,l=v.length(),ny=l>1e-5?v.y/l:0;speed*=evaluateCurve(s.slopeSpeedMultiplier,Math.asin(clamp(ny,-1,1))*57.29578);}
  const desired=this.moveDirection.clone().multiplyScalar(speed);
  if(this.grounded){const push=this.pushVelocity();this.pushing=Boolean(push);if(push){this.pushSteps=(this.pushSteps??0)+1;desired.x+=push.x;desired.z+=push.z;}}else this.pushing=false;
  return desired;}
 // CCMotor.ApplyInputVelocityChange (lines 985-1079). On too-steep ground (tooSteep, no slidingEnable check) the
 // desired velocity slides down the slope at slidingSpeed with speedControl/sidewaysControl input; grounded, it is
 // turned into the ground plane keeping its length; airborne, velocity.y is left to gravity. Then the acceleration limit,
 // and a grounded velocity never points up.
 applyInputVelocityChange(dt,velocity){const s=this.settings,input=this.moveDirection,n=this.groundNormal;let desired;
  if(this.grounded&&this.tooSteep){desired=new Vector3(n.x,0,n.z);const h=desired.x*desired.x+desired.z*desired.z;if(h!==1&&h>0){const r=Math.sqrt(h);desired.x/=r;desired.z/=r;}
   const p=input.clone().projectOnVector(desired);
   desired.x+=p.x*s.slidingSpeedControl+(input.x-p.x)*s.slidingSidewaysControl;desired.z+=p.z*s.slidingSpeedControl+(input.z-p.z)*s.slidingSidewaysControl;
   desired.y=p.y*s.slidingSpeedControl+(input.y-p.y)*s.slidingSidewaysControl;desired.multiplyScalar(s.slidingSpeed);}
  else desired=this.desiredHorizontalVelocity();
  // movingPlatform PermaTransfer: the velocity a platform gave on leaving it stays part of the desired velocity.
  if(s.platformMovementEnable&&s.platformMovementTransfer===2){desired.x+=this.frameVelocity.x;desired.z+=this.frameVelocity.z;desired.y=0;}
  if(this.grounded){const l2=desired.lengthSq();if(l2!==0){desired=new Vector3(0,1,0).cross(desired).cross(n);const k2=desired.lengthSq();if(k2!==l2&&k2>0)desired.multiplyScalar(Math.sqrt(l2)/Math.sqrt(k2));}}
  else velocity.y=0;
  const max=(this.grounded?s.maxGroundAcceleration:s.maxAirAcceleration)*dt,change=desired.sub(velocity),c2=change.lengthSq();if(c2>max*max)change.multiplyScalar(max/Math.sqrt(c2));velocity.add(change);
  if(this.grounded&&velocity.y>0)velocity.y=0;}
 // CCMotor.ApplyGravityAndJumping (lines 1081-1190). A press counts for 0.2 s (lastButtonDownTime, -100 = none) and a
 // jump needs minTimeBetweenJumps (1 s) since the last landing from a jump. Airborne: gravity, the held-jump extra
 // height (jumpDir * gravity for extraHeight / jump speed seconds), the inputAirVelocityRatio blend of the new and old
 // horizontal velocity, maxFallSpeed and maxAirHorizontalSpeed. Returns `simulate` (airborne).
 applyGravityAndJumping(dt,velocity,acceleration){const s=this.settings,time=this.time,g=s.gravity,v0=Math.sqrt(2*s.jumpBaseHeight*g);
  if(!this.jumpInput){this.holdingJumpButton=false;this.lastButtonDownTime=-100;}
  if(this.jumpInput&&this.lastButtonDownTime<0)this.lastButtonDownTime=time;
  if(this.grounded){velocity.y=velocity.y>=0?-g*dt:velocity.y-g*dt;const minimum=this.config.traits.CharacterCCMotorTrait.data._minTimeBetweenJumps;
   if(s.jumpEnable&&time-this.lastButtonDownTime<0.2&&(minimum<=0||time-this.lastLandTime>=minimum)){
    this.grounded=false;this.jumping=true;this.lastStartTime=time;this.lastButtonDownTime=-100;this.holdingJumpButton=true;
    this.jumpDir=slerp(new Vector3(0,1,0),this.groundNormal,this.tooSteep?s.jumpSteepPerpAmount:s.jumpPerpAmount);
    velocity.x+=this.jumpDir.x*v0;velocity.y=this.jumpDir.y*v0;velocity.z+=this.jumpDir.z*v0;
    if(s.platformMovementEnable&&(s.platformMovementTransfer===1||s.platformMovementTransfer===2)){this.frameVelocity.copy(this.platformVelocity);velocity.add(this.platformVelocity);}
    this.startedJumping=true;this.jumps++;}
   else this.holdingJumpButton=false;
   return false;}
  acceleration.set(0,-g,0);
  if(this.jumping&&this.holdingJumpButton&&time<this.lastStartTime+s.jumpExtraHeight/v0)acceleration.addScaledVector(this.jumpDir,g);
  velocity.y=this.velocity.y+acceleration.y*dt;const r=s.inputAirVelocityRatio;
  if(r===1){velocity.x+=acceleration.x*dt;velocity.z+=acceleration.z*dt;}
  else if(r===0){velocity.x=this.velocity.x+acceleration.x*dt;velocity.z=this.velocity.z+acceleration.z*dt;}
  else{const k=1-r;velocity.x=velocity.x*r+this.velocity.x*k+acceleration.x*dt;velocity.z=velocity.z*r+this.velocity.z*k+acceleration.z*dt;}
  if(-velocity.y>s.maxFallSpeed)velocity.y=-s.maxFallSpeed;
  if(s.maxAirHorizontalSpeed>0){const h2=velocity.x*velocity.x+velocity.z*velocity.z,m=s.maxAirHorizontalSpeed;if(h2>m*m){const k=m/Math.sqrt(h2);velocity.x*=k;velocity.z*=k;}}
  return true;}
 step(dt,input,yaw){this.time+=dt;const s=this.settings;this.platformStep(dt);this.updateGhosts();
  if(this.pendingSubtract&&(this.pendingSubtract.seconds-=dt)<=1e-9){this.velocity.sub(this.platformVelocity);this.pendingSubtract=null;}
  const sample=this.processInput(dt,input,yaw);
  // CCMotor.StepPhysics (lines 719-896).
  const vector=this.velocity.clone(),acceleration=new Vector3();this.applyInputVelocityChange(dt,vector);const simulate=this.applyGravityAndJumping(dt,vector,acceleration);
  // movingWithPlatform: follow the active platform's displacement (and yaw) since the last step before moving.
  if(this.grounded&&this.platform&&!this.platform.static&&s.platformMovementEnable){const m=this.platform.motion,d=this.platformLocal.clone().applyMatrix4(m).sub(this.platformGlobal);
   if(d.lengthSq()>0){this.feet.copy(this.move(this.feet,d,false,0).feet);}const turn=yawBetween(m,this.platformMatrix);if(turn)this.yawDelta+=turn;}
  // Airborne the step is the trapezoid of the old velocity and this step's acceleration (exact for constant gravity);
  // grounded it is the new velocity.
  const before=this.feet.clone(),delta=simulate?this.velocity.clone().addScaledVector(acceleration,dt/2).multiplyScalar(dt):vector.clone().multiplyScalar(dt);
  const moved=Math.hypot(delta.x,delta.z)>1e-6,wasGrounded=this.grounded,h2=delta.x*delta.x+delta.z*delta.z,num3=h2>this.stepOffset*this.stepOffset?Math.sqrt(h2):this.stepOffset;
  // CCDesc hits count as ground (CCMotor.OnHit) only while the move goes down (grounded moves push down by num3).
  const downward=delta.y-(wasGrounded?num3:0)<0;
  // CharacterController.Move autostep (stepOffset .5) is only taken while grounded and walking; a step that ends
  // on a surface steeper than slopeLimit is cancelled and the move is repeated without it. When the raised side pass
  // is obstructed (e.g. a ceiling edge the lifted capsule would graze) the unraised move is kept if it gets further.
  let r=this.move(before,delta,wasGrounded,wasGrounded&&moved?this.stepOffset:0);
  if(r.lift>0&&(r.blocked||!r.ground&&r.feet.y>before.y+0.01)){const flat=this.move(before,delta,wasGrounded,0),gain=m=>(m.feet.x-before.x)*delta.x+(m.feet.z-before.z)*delta.z;
   if(!r.ground&&r.feet.y>before.y+0.01||gain(flat)>gain(r)+1e-7)r=flat;}
  this.feet.copy(r.feet);this.collisions+=r.normals.length;
  let touched=Boolean(r.ground)||r.normals.length>0,terrainNormal=null,groundBody=null;
  const terrain=this.world.ground?.(this.feet.x,this.feet.z);
  if(Number.isFinite(terrain)&&this.feet.y<terrain){let normal=this.world.terrainNormal(this.feet.x,this.feet.z);touched=true;
   // The TerrainCollider is part of the same sweeps: the capsule rises onto it as a sweep (riseTo), so it never goes
   // up through a solid above and may stay short of the terrain under one.
   if(normal.y<this.slopeCos&&terrain>before.y+0.01){const top=this.world.ground(before.x,before.z)+0.001;
    // Too steep to climb: back where the step started, onto the terrain there.
    this.feet.set(before.x,before.y<top?before.y:Math.max(this.feet.y,top),before.z);this.riseTo(this.feet,top);normal=this.world.terrainNormal(before.x,before.z);}
   else if(terrain+0.001>r.sideY){const p=this.riseTo(new Vector3(this.feet.x,r.sideY,this.feet.z),terrain+0.001,true);
    // Up from the side pass's height, sliding along an overhanging wall. More than 1 cm short, the capsule is wedged
    // between an uphill and a rock's underside, and the move (with any slide) is undone.
    if(p.y<terrain-0.01){this.feet.copy(before);this.riseTo(this.feet,this.world.ground(before.x,before.z)+0.001);normal=this.world.terrainNormal(before.x,before.z);}else this.feet.copy(p);}
   // Down from the side pass's height: the down pass found nothing above the terrain.
   else this.feet.y=terrain+0.001;
   terrainNormal=normal;}
  // CharacterController.Move sweeps, so the controller never passes through the front of a solid. Every pass above
  // sweeps too; as a safety net (the rock walk probe never trips it), a step that carried the capsule's axis through a
  // front face is undone (the ground the step started on is kept).
  const undone=this.crossedSolid(before,this.feet);if(undone)this.feet.copy(before);
  // CCMotor.OnHit: the ground normal is the most upward hit normal (y > 0) of a downward move; the ground collider
  // (hitPlatform) becomes the active platform. Grounded = groundNormal.y > 0.01, steep or not.
  let ground=null;
  if(!undone&&downward){const consider=(n,body)=>{if(n&&n.y>0&&(!ground||n.y>ground.y)){ground=n.clone();groundBody=body;}};
   consider(r.ground,r.groundBody??STATIC);for(const n of r.normals)consider(n,STATIC);consider(terrainNormal,STATIC);}
  if(!undone)this.groundNormal=ground??new Vector3();
  if(ground&&groundBody&&groundBody!==this.platform){this.platform=groundBody;this.platformLast.copy(this.platform.motion);this.newPlatform=true;}
  if(ground)this.frameVelocity.set(0,0,0);
  // With any collision the velocity is the actual displacement: horizontally a 0..1 fraction of the wanted
  // horizontal velocity along it, vertically the displacement unless it went further down than wanted (a step down);
  // blocked going up ends the held jump. Without a collision it is the wanted velocity.
  if(touched||undone){const actual=this.feet.clone().sub(before).divideScalar(dt),vx=vector.x,vz=vector.z;this.velocity.y=actual.y;
   if(vx===0&&vz===0){this.velocity.x=0;this.velocity.z=0;}
   else{const k=(actual.x*vx+actual.z*vz)/(vx*vx+vz*vz);if(k<=0){this.velocity.x=0;this.velocity.z=0;}else if(k>=1){this.velocity.x=vx;this.velocity.z=vz;}else{this.velocity.x=vx*k;this.velocity.z=vz*k;}}
   if(this.velocity.y<vector.y-0.001){if(this.velocity.y<0)this.velocity.y=vector.y;else this.holdingJumpButton=false;}}
  else this.velocity.copy(vector);
  const groundedNow=undone?wasGrounded:this.groundNormal.y>0.01;
  if(this.grounded!==groundedNow){
   if(this.grounded){this.grounded=false;this.leavePlatform();}
   else{this.grounded=true;this.jumping=false;if(this.startedJumping){this.startedJumping=false;this.lastLandTime=this.time;}
    // SubtractNewPlatformVelocity: at once, or two FixedUpdates later for a new platform
    if(s.platformMovementEnable&&(s.platformMovementTransfer===1||s.platformMovementTransfer===2)){if(this.newPlatform)this.pendingSubtract={seconds:2*FIXED_TIMESTEP};else this.velocity.sub(this.platformVelocity);}}}
  if(this.grounded&&this.platform){const m=this.platform.motion;this.platformGlobal.set(this.feet.x,this.feet.y+this.skin+this.controllerRadius,this.feet.z);
   this.platformLocal.copy(this.platformGlobal).applyMatrix4(m.clone().invert());this.platformMatrix.copy(m);}
  // CCTotem height: the pole moves first, then its top sweeps toward Height + crouchSpeed * dt (crouchSpeed = -1 when
  // crouching, else 1) and stops at a ceiling. movement.crouchBlocked = standing up and the top hit something above.
  const wanted=clamp(this.height+this.crouchSpeed*dt,this.minimum,this.standing),reached=wanted>this.height?this.expandTo(this.feet,this.height,wanted):wanted;
  this.crouchBlocked=this.crouchSpeed>0&&reached<wanted-1e-6;this.height=reached;
  this.updateEye(dt);
  // Crouchable.LocalPlayerUpdateCrouchState: a blocked pole reports crouching (the state flags' crouch/crouchBlocked).
  if(this.crouchBlocked){sample.crouch=true;sample.crouchBlocked=true;}else sample.crouchBlocked=false;
  this.sample=sample;
 }
 // Leaving the ground (fall) keeps the platform's velocity (InitTransfer/PermaTransfer).
 leavePlatform(){const s=this.settings;if(!s.platformMovementEnable||!(s.platformMovementTransfer===1||s.platformMovementTransfer===2))return;this.frameVelocity.copy(this.platformVelocity);this.velocity.add(this.platformVelocity);}
}
