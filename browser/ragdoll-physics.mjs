import {Matrix4,Quaternion,Vector3} from 'three';
const vec=o=>new Vector3(o?.x??0,o?.y??0,o?.z??0),unit=new Vector3(1,1,1);
export function restMatrices(nodes){return nodes.map((n,i,all)=>{const m=new Matrix4().compose(new Vector3().fromArray(n.position),new Quaternion().fromArray(n.rotation),new Vector3().fromArray(n.scale));return m;}).map((m,i,array)=>{if(nodes[i].parent>=0)m.premultiply(array[nodes[i].parent]);return m;});}
function frame(axis,swing){const x=vec(axis).normalize(),candidate=swing?vec(swing):Math.abs(x.y)<0.9?new Vector3(0,1,0):new Vector3(1,0,0),y=candidate.addScaledVector(x,-candidate.dot(x)).normalize(),z=new Vector3().crossVectors(x,y);return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z));}

// Unity 4 built-in default PhysicMaterial (PhysicsManager.m_DefaultMaterial is a built-in resource, not game data).
export const DEFAULT_MATERIAL={dynamicFriction:0.6,staticFriction:0.6,bounciness:0,frictionCombine:0,bounceCombine:0};
// Unity's documented defaults, used only when the recovered PhysicsManager/TimeManager block is missing.
const DEFAULT_PHYSICS={gravity:{x:0,y:-9.81,z:0},solverIterationCount:7,sleepVelocity:0.15,sleepAngularVelocity:0.14,maxAngularVelocity:7,fixedTimestep:0.02,maximumAllowedTimestep:1/3,layerCollisionMatrix:null};
const RAGDOLL_LAYER=27;
// Layer collision matrix row: does `layer` collide with the ragdoll layer?
export function collidesWithRagdoll(physics,layer=0){const m=physics?.layerCollisionMatrix;if(!m)return ![16,17,18,21,RAGDOLL_LAYER].includes(layer);return Boolean((m[RAGDOLL_LAYER]>>>layer)&1);}

// Swing/twist decomposition of the child joint frame relative to the parent frame, twist about frame X.
// Returns the swing rotation vector components about frame Y (swing 1) and frame Z (swing 2) in radians.
export function swingTwist(qRel){const t=new Quaternion(qRel.x,0,0,qRel.w),n=t.length();
 if(n<1e-9)t.set(0,0,0,1);else if(t.w<0)t.set(-t.x/n,0,0,-t.w/n);else t.set(t.x/n,0,0,t.w/n);
 const s=qRel.clone().multiply(t.clone().invert());if(s.w<0)s.set(-s.x,-s.y,-s.z,-s.w);
 const sin=Math.hypot(s.y,s.z),angle=2*Math.atan2(sin,s.w),k=sin>1e-9?angle/sin:2;
 return {swing1:s.y*k,swing2:s.z*k,twist:2*Math.atan2(t.x,t.w)};}
// PhysX D6 elliptical swing cone (swing1 about Y, swing2 about Z). Returns null inside the cone, else the limit
// error (radians, along the rotation direction) and the outward cone normal in the (y, z) swing plane.
export function swingConeViolation(swing1,swing2,limit1,limit2){
 const l1=Math.max(limit1,1e-4),l2=Math.max(limit2,1e-4),f=(swing1/l1)**2+(swing2/l2)**2;if(f<=1)return null;
 const angle=Math.hypot(swing1,swing2),ny=swing1/angle,nz=swing2/angle,limit=1/Math.hypot(ny/l1,nz/l2),gy=swing1/(l1*l1),gz=swing2/(l2*l2),g=Math.hypot(gy,gz);
 return {error:angle-limit,normal:[gy/g,gz/g]};}
// The child-relative joint rotation clamped onto the twist range and the elliptical swing cone (hinges: no swing):
// the swing is scaled radially onto the ellipse and the twist clamped to [low, high].
export function clampJointRotation(rel,l,out=new Quaternion()){
 const st=swingTwist(rel),twist=Math.min(l.high,Math.max(l.low,st.twist));let s1=st.swing1,s2=st.swing2;
 if(l.hinge)s1=s2=0;else{const f=(s1/Math.max(l.swing1,1e-4))**2+(s2/Math.max(l.swing2,1e-4))**2;if(f>1){const k=1/Math.sqrt(f);s1*=k;s2*=k;}}
 const angle=Math.hypot(s1,s2);out.set(0,0,0,1);if(angle>1e-9)out.setFromAxisAngle(_v5.set(0,s1/angle,s2/angle),angle);
 return out.multiply(_q3.setFromAxisAngle(_X,twist));
}

// Shared Rapier world for every cosmetic ragdoll, configured from the client's PhysicsManager/TimeManager:
// fixed 0.02 s steps (at most maximumAllowedTimestep of simulation per frame), 7 solver iterations, gravity,
// max angular velocity 7 rad/s and corpse-vs-corpse contacts (layer 27 collides with 27).
// Port measures for the joint limits (see RagdollPhysics), corpse worlds only: each fixed step runs as
// CORPSE_SUBSTEPS Rapier steps with CORPSE_PGS internal Gauss-Seidel sweeps per solver iteration (the 0.02 s
// rate, gravity and the 7 iterations stay); before each substep the joint boxes follow the PhysX ranges
// (updateLimits) and after it the joint angles are projected onto them (solveJoints).
// The prefab's IgnoreColliders pairs (pelvis/spine/limb capsules that overlap in the rest pose) are applied with a
// contact filter hook; Rapier only runs contact hooks when the step also gets an event queue.
// Presentation only: nothing here touches health, inventory or the network.
export const CORPSE_SUBSTEPS=8,CORPSE_PGS=4;
export class RagdollWorld{
 constructor(R,physics={},{ignorePairs=true,substeps=CORPSE_SUBSTEPS,pgsIterations=CORPSE_PGS}={}){
  this.R=R;this.physics={...DEFAULT_PHYSICS,...physics};const p=this.physics;
  this.world=new R.World(p.gravity);this.step=p.fixedTimestep;this.substeps=Math.max(1,substeps|0);this.world.timestep=this.step/this.substeps;
  this.world.numSolverIterations=p.solverIterationCount;this.world.numInternalPgsIterations=Math.max(1,pgsIterations|0);
  this.accumulator=0;this.ragdolls=new Set();this.ignore=new Set();this.steps=0;this.applyIgnore=ignorePairs;this.events=ignorePairs?new R.EventQueue(true):null;
  const ignore=this.ignore;
  this.hooks={filterContactPair:(c1,c2)=>ignore.has(c1<c2?c1+':'+c2:c2+':'+c1)?null:R.SolverFlags.COMPUTE_IMPULSE,filterIntersectionPair:()=>true};
 }
 ignorePair(a,b){this.ignore.add(a<b?a+':'+b:b+':'+a);}
 update(dt){
  this.accumulator+=Math.min(Math.max(dt,0),this.physics.maximumAllowedTimestep);
  while(this.accumulator+1e-9>=this.step){
   const awake=[...this.ragdolls].filter(r=>!r.asleep()),max=this.physics.maxAngularVelocity;
   for(let i=0;i<this.substeps;i++){
    for(const r of awake)r.updateLimits();
    if(this.applyIgnore&&this.ignore.size)this.world.step(this.events,this.hooks);else this.world.step();
    for(const r of awake)r.solveJoints();
    if(max>0)for(const r of this.ragdolls)for(const b of r.bodies){const w=b.angvel(),m=Math.hypot(w.x,w.y,w.z);if(m>max)b.setAngvel({x:w.x*max/m,y:w.y*max/m,z:w.z*max/m},false);}
   }
   this.steps++;this.accumulator-=this.step;
  }
 }
 dispose(){this.events?.free();this.world.free();this.ragdolls.clear();}
}

// Unity-space bodies keep the original dimensions, mass and rest joint frames.
// Joint angle sense: the jointed (child) body's frame relative to the connected (parent) body's frame (evidence in
// jointFrames). Rapier's generic angular limits measure the opposite sense, so twist/hinge ranges are negated.
// CharacterJoint (PhysX 2.8 D6 in Unity 4): linear axes locked, twist [low, high] about the joint axis and an
// elliptical swing cone (swing1 about swingAxis, swing2 about their cross product); the exported spring, damper and
// bounciness are all 0 (hard, inelastic limits). HingeJoint: two locked angular axes and the hinge range.
// Rapier's iterative limits alone leaked badly in this chain (light spine/clavicle/foot bodies between heavy ones,
// a static box instead of the cone: 60-110 degrees on lying corpses), so the limits are held in two layers:
// 1. Inside Rapier's solver, with the contacts: the substep/PGS budget above, and each CharacterJoint's per-axis
//    box re-fitted to the PhysX cone before every substep (updateLimits).
// 2. After every substep, a joint-space projection for what still leaks past LIMIT_MARGIN (impacts): the child's
//    sub-chain and the rest of the corpse turn rigidly about the joint anchor in opposite senses, split by their
//    moments of inertia about it (no other joint angle changes, no anchor separates, the centre of mass stays while
//    airborne), except that no terrain contact point is turned into the ground; the relative angular velocity
//    leaving the range is then removed by an internal angular impulse on the joint's two bodies (never adds energy).
export class RagdollPhysics{
 constructor(R,def,matrices,{world=null,gravity,step,ignorePairs=true,substeps}={}){
  this.R=R;this.def=def;this.ownsWorld=!world;
  this.shared=world??new RagdollWorld(R,{...def.physics,...(gravity?{gravity}:{}),...(step?{fixedTimestep:step}:{})},{ignorePairs,...(def.joints.length?{substeps:substeps??CORPSE_SUBSTEPS}:{substeps:1,pgsIterations:1})});
  this.world=this.shared.world;this.step=this.shared.step;this.staticBody=null;this.staticCollider=null;this.colliderBody=new Map();
  this.bodies=def.bodies.map((s,index)=>{const p=new Vector3(),q=new Quaternion(),scale=new Vector3();matrices[s.bone].decompose(p,q,scale);const d=s.data;
   const body=this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...p).setRotation(q).setLinearDamping(d.m_Drag).setAngularDamping(d.m_AngularDrag).setGravityScale(d.m_UseGravity?1:0).setCcdEnabled(Boolean(d.m_CollisionDetection)));
   const enabled=s.colliders.filter(c=>c.data.m_Enabled&&!c.data.m_IsTrigger);body.colliders=[];
   for(const c of enabled){const a=c.data;let shape;
    if(c.type==='CapsuleCollider'){shape=R.ColliderDesc.capsule(Math.max(0,a.m_Height/2-a.m_Radius),a.m_Radius);const axis=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)][a.m_Direction];shape.setRotation(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),axis));}
    else if(c.type==='BoxCollider')shape=R.ColliderDesc.cuboid(a.m_Size.x/2,a.m_Size.y/2,a.m_Size.z/2);
    else if(c.type==='SphereCollider')shape=R.ColliderDesc.ball(a.m_Radius);else throw Error('Unsupported ragdoll collider '+c.type);
    const m=c.material??DEFAULT_MATERIAL,rules=[R.CoefficientCombineRule.Average,R.CoefficientCombineRule.Multiply,R.CoefficientCombineRule.Min,R.CoefficientCombineRule.Max];
    shape.setTranslation(a.m_Center.x,a.m_Center.y,a.m_Center.z).setMass(d.m_Mass/enabled.length).setFriction(m.dynamicFriction??0.6).setRestitution(m.bounciness??0).setFrictionCombineRule(rules[m.frictionCombine]??rules[0]).setRestitutionCombineRule(rules[m.bounceCombine]??rules[0]).setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS);
    const collider=this.world.createCollider(shape,body);body.colliders.push(collider);this.colliderBody.set(collider.handle,index);
   }return body;
  });
  for(const [a,b]of def.ignore??[])for(const ca of this.bodies[a]?.colliders??[])for(const cb of this.bodies[b]?.colliders??[])this.shared.ignorePair(ca.handle,cb.handle);
  const rest=restMatrices(def.nodes),bodyByBone=new Map(def.bodies.map((b,i)=>[b.bone,i]));this.limits=[];this.constraints=[];
  this.joints=def.joints.map(s=>{const index=bodyByBone.get(s.bone),a=this.bodies[index],b=this.bodies[s.connectedBody],data=s.data,anchor=vec(data.m_Anchor),ra=rest[s.bone],rb=rest[def.bodies[s.connectedBody].bone];
   // Auto-connected anchors and zero joint angles are calculated in the prefab rest pose, before death/sleep pose transfer.
   const connected=data.m_AutoConfigureConnectedAnchor?anchor.clone().applyMatrix4(ra).applyMatrix4(rb.clone().invert()):vec(data.m_ConnectedAnchor);
   const qa=new Quaternion().setFromRotationMatrix(ra),qb=new Quaternion().setFromRotationMatrix(rb),f1=s.type==='FixedJoint'?new Quaternion():frame(data.m_Axis,data.m_SwingAxis),f2=qb.invert().multiply(qa).multiply(f1);
   if(!['FixedJoint','CharacterJoint','HingeJoint'].includes(s.type))throw Error('Unsupported ragdoll joint '+s.type);
   const mask=R.JointAxesMask.LinX|R.JointAxesMask.LinY|R.JointAxesMask.LinZ|(s.type==='HingeJoint'?R.JointAxesMask.AngY|R.JointAxesMask.AngZ:0);
   const desc=s.type==='FixedJoint'?R.JointData.fixed(anchor,f1,connected,f2):R.JointData.generic(anchor,connected,{x:1,y:0,z:0},mask);
   const joint=this.world.createImpulseJoint(desc,a,b,true);joint.setLocalFrame1(anchor,f1);joint.setLocalFrame2(connected,f2);joint.setContactsEnabled(Boolean(data.m_EnableCollision));
   const r=Math.PI/180,raw=this.world.impulseJoints.raw,common={joint,a,b,child:index,parent:s.connectedBody,anchor,connected,f1,f2};
   // Rapier's generic angular limit measures the connected body relative to the jointed one: negate the range.
   if(s.type==='CharacterJoint'){const l={...common,low:data.m_LowTwistLimit.limit*r,high:data.m_HighTwistLimit.limit*r,swing1:Math.abs(data.m_Swing1Limit.limit)*r,swing2:Math.abs(data.m_Swing2Limit.limit)*r};
    raw.jointSetLimits(joint.handle,3,-l.high,-l.low);raw.jointSetLimits(joint.handle,4,-l.swing1,l.swing1);raw.jointSetLimits(joint.handle,5,-l.swing2,l.swing2);
    this.limits.push(l);this.constraints.push(l);
   }else if(s.type==='HingeJoint'){const l={...common,hinge:true,low:data.m_UseLimits?data.m_Limits.min*r:-Math.PI,high:data.m_UseLimits?data.m_Limits.max*r:Math.PI,swing1:0,swing2:0};
    if(data.m_UseLimits)raw.jointSetLimits(joint.handle,3,-l.high,-l.low);this.constraints.push(l);}
   return joint;
  });
  // Parents first; each projection only changes its own joint angle, so the order matters little.
  const parentOf=new Map(def.joints.map(j=>[bodyByBone.get(j.bone),j.connectedBody])),depth=i=>parentOf.has(i)?1+depth(parentOf.get(i)):0;
  const children=new Map();for(const [child,parent]of parentOf){if(!children.has(parent))children.set(parent,[]);children.get(parent).push(child);}
  const subtree=i=>[i,...(children.get(i)??[]).flatMap(subtree)];
  // Per-body mass properties (Rapier computed them from the colliders above) and scratch state for the projection.
  this.state=this.bodies.map(b=>{const m=b.mass(),c=b.localCom(),i=b.principalInertia(),f=b.principalInertiaLocalFrame();
   return {body:b,mass:m,localCom:new Vector3(c.x,c.y,c.z),inertia:new Vector3(i.x,i.y,i.z),frame:new Quaternion(f.x,f.y,f.z,f.w),com:new Vector3(),com0:new Vector3(),q:new Quaternion(),dirty:false,dw:new Vector3(),contacts:[]};});
  for(const l of this.constraints){l.depth=depth(l.child);const inside=new Set(subtree(l.child));l.subtree=[...inside].map(i=>this.bodies[i]);
   l.group=this.state.filter((s,i)=>inside.has(i));l.rest=this.state.filter((s,i)=>!inside.has(i));l.sa=this.state[l.child];l.sb=this.state[l.parent];l.axis=new Vector3();l.share=0.5;}
  this.limits.sort((x,y)=>x.depth-y.depth);this.constraints.sort((x,y)=>x.depth-y.depth);
  this.shared.ragdolls.add(this);
 }
 // PhysicsManager sleep thresholds (0.15 m/s, 0.14 rad/s) on the root body, filtered over ~0.25 s: below them for
 // 1 s (or below twice them for 3 s, while limbs still settle against the limits) the corpse sleeps and is no
 // longer projected until an impulse or a contact wakes Rapier's island. Port heuristic for PhysX island sleeping.
 asleep(){const root=this.bodies[0];if(!root||this.bodies.every(b=>b.isSleeping()))return true;
  const v=root.linvel(),w=root.angvel(),p=this.shared.physics,k=Math.min(1,this.step/0.25);
  this.rootSpeed=(this.rootSpeed??1)*(1-k)+Math.hypot(v.x,v.y,v.z)*k;this.rootSpin=(this.rootSpin??1)*(1-k)+Math.hypot(w.x,w.y,w.z)*k;
  const below=f=>this.rootSpeed<p.sleepVelocity*f&&this.rootSpin<p.sleepAngularVelocity*f;
  this.still=below(1)?(this.still??0)+this.step:0;this.settling=below(2)?(this.settling??0)+this.step:0;
  if(this.still>=1||this.settling>=3){for(const b of this.bodies)b.sleep();this.still=this.settling=0;return true;}return false;}
 // Joint angles are the jointed (child) body's frame relative to the connected (parent) body's frame. Evidence:
 // the original sleep pose puts both knees (+61, +20) and elbows (+127, +74) inside their -5..85 / -5..130 hinge
 // ranges, and 19 of 22 joints within range, only in this sense (the opposite sense leaves all four outside).
 jointFrames(l){const ra=l.a.rotation(),rb=l.b.rotation(),fa=new Quaternion(ra.x,ra.y,ra.z,ra.w).multiply(l.f1),fb=new Quaternion(rb.x,rb.y,rb.z,rb.w).multiply(l.f2);return {fa,fb,rel:fb.clone().invert().multiply(fa)};}
 swing(index){const l=this.limits[index],{rel}=this.jointFrames(l),s=swingTwist(rel);return {...s,name:this.def.bodies[l.child].name,low:l.low,high:l.high,limit1:l.swing1,limit2:l.swing2,cone:(s.swing1/l.swing1)**2+(s.swing2/l.swing2)**2};}
 // Angle (radians) by which each joint lies outside its PhysX range (hinges include any bend off their axis).
 violations(){return this.constraints.map(l=>{const {rel}=this.jointFrames(l),d=clampJointRotation(rel,l).invert().multiply(rel);return {name:this.def.bodies[l.child].name,hinge:Boolean(l.hinge),angle:2*Math.acos(Math.min(1,Math.abs(d.w)))};});}
 // Rapier's angular limits are a per-axis box on the imaginary part (x, y, z) of the joint rotation quaternion
 // (connected frame relative to jointed frame): x = -sin(twist/2)cos(swing/2), and (y, z) the swing's sin(swing/2)
 // vector turned by half the twist. Before each substep every CharacterJoint's box is set to the PhysX range through
 // the current state: the twist bounds at the current swing, and each swing axis' bounds at the current value of the
 // other one (a cross-section of the cone's ellipse; outside the cone, through the point scaled back onto it, so
 // the bounds do not chase the state). Inside the solver the limit is then the cone where the joint actually is.
 updateLimits(){const raw=this.world.impulseJoints.raw,set=(h,axis,lo,hi)=>raw.jointSetLimits(h,axis,2*Math.asin(Math.max(-1,Math.min(1,lo))),2*Math.asin(Math.max(-1,Math.min(1,hi))));
  for(const l of this.limits){const {rel}=this.jointFrames(l),st=swingTwist(rel),e=rel.invert(),h=l.joint.handle;if(e.w<0)e.set(-e.x,-e.y,-e.z,-e.w);
   // Hysteresis: a joint that has not moved since its box was fitted keeps it (no feedback while resting on a limit).
   const fit=l.fitted??=new Vector3(NaN);if(Math.abs(fit.x-e.x)<LIMIT_REFIT&&Math.abs(fit.y-e.y)<LIMIT_REFIT&&Math.abs(fit.z-e.z)<LIMIT_REFIT)continue;fit.set(e.x,e.y,e.z);
   const cs=Math.cos(Math.hypot(st.swing1,st.swing2)/2);set(h,3,-Math.sin(l.high/2)*cs,-Math.sin(l.low/2)*cs);
   const c=Math.cos(st.twist/2),s=Math.sin(st.twist/2),i1=Math.sin(Math.max(l.swing1,1e-3)/2)**-2,i2=Math.sin(Math.max(l.swing2,1e-3)/2)**-2;
   const A11=c*c*i1+s*s*i2,A22=s*s*i1+c*c*i2,A12=c*s*(i2-i1),f=A11*e.y*e.y+2*A12*e.y*e.z+A22*e.z*e.z,k=f>1?1/Math.sqrt(f):1;
   const [y0,y1]=section(A11,A12,A22,e.z*k),[z0,z1]=section(A22,A12,A11,e.y*k);set(h,4,y0,y1);set(h,5,z0,z1);}}
 // Terrain contact points and normals (out of the ground) per body, for the projection's contact test.
 gatherContacts(){this.touching=false;for(const s of this.state)s.contacts.length=0;if(!this.staticCollider)return;
  for(const s of this.state)for(const c of s.body.colliders)this.world.contactPair(this.staticCollider,c,(m,flipped)=>{const n=m.normal(),k=flipped?-1:1,t=c.translation(),r=c.rotation(),q=new Quaternion(r.x,r.y,r.z,r.w);
   for(let i=0;i<m.numContacts();i++){const dist=m.contactDist(i),p=flipped?m.localContactPoint1(i):m.localContactPoint2(i);if(dist>CONTACT_RANGE||!p)continue;
    s.contacts.push({p:new Vector3(p.x,p.y,p.z).applyQuaternion(q).add(new Vector3(t.x,t.y,t.z)),n:new Vector3(n.x*k,n.y*k,n.z*k),dist});this.touching=true;}});}
 // Joint-space projection onto the ranges (see above), then removal of the relative velocity leaving them.
 solveJoints(){
  const S=this.state;let active=0,gathered=false;
  for(const s of S){const t=s.body.translation(),r=s.body.rotation();s.q.set(r.x,r.y,r.z,r.w);s.com.copy(s.localCom).applyQuaternion(s.q).add(_v1.set(t.x,t.y,t.z));s.com0.copy(s.com);s.dirty=false;s.dw.set(0,0,0);}
  for(const l of this.constraints){l.active=false;const d=jointCorrection(l);if(!d)continue;if(!gathered){this.gatherContacts();gathered=true;}
   const {axis,angle,pivot}=d;l.active=true;active++;l.axis.copy(axis);
   // Split by moments of inertia about the anchor, limited so that no terrain contact point is turned into the
   // ground: what one side cannot take goes to the other, and what neither can take is left to the contact solver.
   const ic=groupInertia(l.group,axis,pivot),ir=groupInertia(l.rest,axis,pivot),maxC=allowedTurn(l.group,axis,1,pivot),maxR=allowedTurn(l.rest,axis,-1,pivot);
   let turnC=angle*ir/(ic+ir),turnR=angle-turnC;if(turnC>maxC){turnR+=turnC-maxC;turnC=maxC;}if(turnR>maxR){turnC=Math.min(maxC,turnC+turnR-maxR);turnR=maxR;}
   l.share=turnC+turnR>1e-12?turnC/(turnC+turnR):ir/(ic+ir);
   for(const s of l.group)rotateAbout(s,axis,turnC,pivot);for(const s of l.rest)rotateAbout(s,axis,-turnR,pivot);}
  if(!active)return 0;
  // Internal corrections do not move the centre of mass of an airborne corpse.
  if(!this.touching){let m=0;const shift=_v1.set(0,0,0);for(const s of S){m+=s.mass;shift.addScaledVector(_v2.copy(s.com).sub(s.com0),s.mass);}if(m>0)shift.divideScalar(m);if(shift.lengthSq()>0)for(const s of S){s.com.sub(shift);s.dirty=true;}}
  for(const s of S){if(!s.dirty)continue;const o=_v1.copy(s.localCom).applyQuaternion(s.q).negate().add(s.com);s.body.setTranslation({x:o.x,y:o.y,z:o.z},false);s.body.setRotation({x:s.q.x,y:s.q.y,z:s.q.z,w:s.q.w},false);}
  // Inelastic limit: an angular impulse pair on the joint's two bodies (the parent alone when the terrain holds the
  // child's side, and vice versa) removes exactly the leaving relative angular velocity; it conserves momentum and
  // never adds energy, and Rapier's point constraint passes the reaction on along the chain.
  for(const l of this.constraints){if(!l.active)continue;const n=l.axis,a=l.sa,b=l.sb,wa=a.body.angvel(),wb=b.body.angvel();
   const c=(wa.x+a.dw.x-wb.x-b.dw.x)*n.x+(wa.y+a.dw.y-wb.y-b.dw.y)*n.y+(wa.z+a.dw.z-wb.z-b.dw.z)*n.z;if(c>=0)continue;
   const ia=l.share===0?null:invInertia(a,n.clone()),ib=l.share===1?null:invInertia(b,n.clone()),k=(ia?n.dot(ia):0)+(ib?n.dot(ib):0);if(!(k>0))continue;
   if(ia)a.dw.addScaledVector(ia,-c/k);if(ib)b.dw.addScaledVector(ib,c/k);}
  for(const s of S){if(s.dw.lengthSq()===0)continue;const w=s.body.angvel();s.body.setAngvel({x:w.x+s.dw.x,y:w.y+s.dw.y,z:w.z+s.dw.z},false);}
  return active;
 }
 setEnvironment(triangles){if(this.staticBody)this.world.removeRigidBody(this.staticBody);this.staticBody=this.staticCollider=null;if(!triangles.length)return;
  const vertices=new Float32Array(triangles.length*9),indices=new Uint32Array(triangles.length*3);triangles.forEach((t,i)=>{vertices.set(t,i*9);indices.set([i*3,i*3+1,i*3+2],i*3);});
  const m=DEFAULT_MATERIAL;this.staticBody=this.world.createRigidBody(this.R.RigidBodyDesc.fixed());this.staticCollider=this.world.createCollider(this.R.ColliderDesc.trimesh(vertices,indices).setFriction(m.dynamicFriction).setRestitution(m.bounciness),this.staticBody);
 }
 // QueuedShotDeathInfo / Tracer / ArrowMovement AddForceAtPosition(force) from Update: one fixed step of that force.
 force(index,worldPoint,worldForce){const b=this.bodies[index];if(!b)return false;b.applyImpulseAtPoint({x:worldForce[0]*this.step,y:worldForce[1]*this.step,z:worldForce[2]*this.step},{x:worldPoint[0],y:worldPoint[1],z:worldPoint[2]},true);return true;}
 // TimedGrenade.OnDone: Physics.OverlapSphere(position, radius, 1 << 27) and, per collider found on a non-kinematic body,
 // Rigidbody.AddExplosionForce(force, position, radius, upwardsModifier) (ForceMode.Force, one fixed step like force()).
 // Unity's documented model (the engine's native code is not read here): the force points from the explosion centre,
 // lowered by upwardsModifier, to the body's centre of mass; its magnitude falls off linearly with the centre's distance
 // to the centre of mass (force * (1 - distance / radius), the full force for radius 0, none beyond the radius).
 // Unity space; returns how many colliders were pushed.
 explosionForce(force,position,radius,upwardsModifier=0){let n=0;const p={x:position.x,y:position.y,z:position.z},v=new Vector3();
  for(const b of this.bodies){if(!b.isDynamic())continue;
   for(const c of b.colliders){const proj=c.projectPoint(p,true);if(!proj||!proj.isInside&&Math.hypot(proj.point.x-p.x,proj.point.y-p.y,proj.point.z-p.z)>radius)continue;
    const com=b.worldCom(),distance=Math.hypot(com.x-p.x,com.y-p.y,com.z-p.z),k=radius>0?1-distance/radius:1;
    v.set(com.x-p.x,com.y-p.y+upwardsModifier,com.z-p.z);if(!(k>0)||v.lengthSq()<1e-12)continue;v.normalize().multiplyScalar(force*k*this.step);
    b.applyImpulse({x:v.x,y:v.y,z:v.z},true);n++;}}
  return n;}
 shot(bone,localPoint,localDirection){const i=this.def.bodies.findIndex(b=>b.name===bone);if(i<0)return false;const b=this.bodies[i],q=b.rotation(),rotation=new Quaternion(q.x,q.y,q.z,q.w),point=new Vector3().fromArray(localPoint).applyQuaternion(rotation).add(b.translation()),impulse=new Vector3().fromArray(localDirection).applyQuaternion(rotation).multiplyScalar(1000*this.step);
  b.applyImpulseAtPoint(impulse,point,true);return true;
 }
 update(dt){if(this.ownsWorld)this.shared.update(dt);}
 // Leaf bodies (toes, hands, head) are drawn with what still leaks past their range turned back about the anchor:
 // the projection cannot correct a leaf pressed into the terrain together with its parent (toes reached ~26 degrees
 // for a frame). Presentation only; the simulated bodies keep their state.
 matrices(){const out=this.bodies.map(b=>{const p=b.translation(),r=b.rotation();return new Matrix4().compose(new Vector3(p.x,p.y,p.z),new Quaternion(r.x,r.y,r.z,r.w),unit);});
  for(const l of this.constraints){if(l.subtree.length!==1)continue;for(const s of [l.sa,l.sb]){const t=s.body.translation(),r=s.body.rotation();s.q.set(r.x,r.y,r.z,r.w);s.com.copy(s.localCom).applyQuaternion(s.q).add(_v1.set(t.x,t.y,t.z));}
   const d=jointCorrection(l);if(!d)continue;const turn=_q3.setFromAxisAngle(d.axis,d.angle),t=l.sa.body.translation(),p=_v1.set(t.x,t.y,t.z).sub(d.pivot).applyQuaternion(turn).add(d.pivot);
   out[l.child].compose(p,_q4.copy(l.sa.q).premultiply(turn),unit);}
  return out;}
 // violations() as drawn by matrices().
 drawnViolations(){const m=this.matrices(),q=m.map(x=>new Quaternion().setFromRotationMatrix(x));return this.constraints.map(l=>{const rel=q[l.parent].clone().multiply(l.f2).invert().multiply(q[l.child].clone().multiply(l.f1)),d=clampJointRotation(rel,l).invert().multiply(rel);return {name:this.def.bodies[l.child].name,angle:2*Math.acos(Math.min(1,Math.abs(d.w)))};});}
 dispose(){this.shared.ragdolls.delete(this);
  if(this.ownsWorld){this.shared.dispose();return;}
  for(const b of this.bodies)for(const c of b.colliders){for(const key of [...this.shared.ignore])if(key.split(':').includes(String(c.handle)))this.shared.ignore.delete(key);}
  for(const j of this.joints)this.world.removeImpulseJoint(j,true);for(const b of this.bodies)this.world.removeRigidBody(b);if(this.staticBody)this.world.removeRigidBody(this.staticBody);this.bodies=[];this.joints=[];this.limits=[];this.constraints=[];this.state=[];this.staticBody=this.staticCollider=null;}
}
// CONTACT_RANGE: terrain contacts considered by the projection (m); LIMIT_MARGIN: leak past a range left to Rapier's
// in-solver limit before the projection acts (1 degree, so the two never fight at the boundary).
const CONTACT_RANGE=0.02,LIMIT_MARGIN=Math.PI/180,LIMIT_REFIT=0.004,_v1=new Vector3(),_v2=new Vector3(),_v5=new Vector3(),_q1=new Quaternion(),_q2=new Quaternion(),_q3=new Quaternion(),_q4=new Quaternion(),_fa=new Quaternion(),_fb=new Quaternion(),_X=new Vector3(1,0,0);
// Bounds of v on the ellipse a v^2 + 2 b v w + c w^2 <= 1 for the given w (its centre when w is outside).
function section(a,b,c,w){const d=b*b*w*w-a*(c*w*w-1),m=-b*w/a;if(d<=0)return [m,m];const r=Math.sqrt(d)/a;return [m-r,m+r];}
// World rotation (axis, angle) taking the child joint frame back to within LIMIT_MARGIN of its range, and the joint
// anchor (pivot); null when the joint is within that.
function jointCorrection(l){const a=l.sa,b=l.sb;_fa.copy(a.q).multiply(l.f1);_fb.copy(b.q).multiply(l.f2);
 const d=clampJointRotation(_q1.copy(_fb).invert().multiply(_fa),l,_q2).premultiply(_fb).multiply(_fa.invert());if(d.w<0)d.set(-d.x,-d.y,-d.z,-d.w);
 const sin=Math.hypot(d.x,d.y,d.z),angle=2*Math.atan2(sin,d.w)-LIMIT_MARGIN;if(!(angle>0))return null;
 return {axis:new Vector3(d.x/sin,d.y/sin,d.z/sin),angle,pivot:new Vector3().copy(l.anchor).sub(a.localCom).applyQuaternion(a.q).add(a.com)};}
// Moment of inertia of a rigid group of bodies about the axis n through pivot (parallel-axis theorem per body).
function groupInertia(group,n,pivot){let k=0;for(const s of group){const r=_v1.copy(s.com).sub(pivot),along=r.dot(n),local=_v2.copy(n).applyQuaternion(_q4.copy(s.q).multiply(s.frame).invert());
 k+=local.x*local.x*s.inertia.x+local.y*local.y*s.inertia.y+local.z*local.z*s.inertia.z+s.mass*(r.lengthSq()-along*along);}return Math.max(k,1e-9);}
// Largest turn (radians) of the group about n (times sign) through pivot before one of its terrain contact points
// would sink further than it already is (to first order).
function allowedTurn(group,n,sign,pivot){let max=Infinity;for(const s of group)for(const c of s.contacts){const rate=-_v2.crossVectors(n,_v1.copy(c.p).sub(pivot)).dot(c.n)*sign;if(rate>1e-6)max=Math.min(max,Math.max(0,c.dist)/rate);}return max;}
function rotateAbout(s,axis,angle,pivot){if(!(Math.abs(angle)>1e-12))return;_q3.setFromAxisAngle(axis,angle);s.q.premultiply(_q3).normalize();s.com.sub(pivot).applyQuaternion(_q3).add(pivot);
 for(const c of s.contacts){_v1.copy(c.p);c.p.sub(pivot).applyQuaternion(_q3).add(pivot);c.dist+=_v1.sub(c.p).negate().dot(c.n);}s.dirty=true;}
// World inverse inertia of one body applied to v (in place).
function invInertia(s,v){_q4.copy(s.q).multiply(s.frame);v.applyQuaternion(_q1.copy(_q4).invert());v.set(v.x/s.inertia.x,v.y/s.inertia.y,v.z/s.inertia.z);return v.applyQuaternion(_q4);}
