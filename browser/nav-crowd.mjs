// Unity 4 NavMeshAgent simulation over the original island navmesh (browser/navmesh.mjs), following Detour's dtCrowd,
// which Unity 4's navigation is built on: per-frame corner finding along the path corridor (findCorners, max 4),
// straight steering to the first corner, end-of-path slowdown (autoBraking), obstacle avoidance by adaptive velocity
// sampling (dtObstacleAvoidanceQuery) against neighbour agents, NavMeshObstacle cylinders and navmesh wall segments,
// acceleration-limited integration, agent-agent separation and moveAlongSurface. Agent parameters come from each
// animal's CharacterNavAgentTrait (CopyTo: radius, speed, acceleration, angularSpeed, stoppingDistance, autoBraking,
// height, obstacleAvoidanceType, avoidancePriority).
// Unity's native constants are not in the managed assemblies, so the Detour reference values are used: avoidance
// parameter sets per quality (RecastDemo Low/Medium/Good/High), collisionQueryRange = radius * 12, 6 neighbours,
// 8 wall segments. All coordinates are Unity space.
import {Vector3} from 'three';

export const AVOIDANCE=Object.freeze([null,
 {velBias:0.5,adaptiveDivs:5,adaptiveRings:2,adaptiveDepth:1},
 {velBias:0.5,adaptiveDivs:5,adaptiveRings:2,adaptiveDepth:2},
 {velBias:0.5,adaptiveDivs:7,adaptiveRings:2,adaptiveDepth:3},
 {velBias:0.5,adaptiveDivs:7,adaptiveRings:3,adaptiveDepth:3}].map(p=>p&&Object.freeze({weightDesVel:2,weightCurVel:0.75,weightSide:0.75,weightToi:2.5,horizTime:2.5,...p})));
const MAX_NEIGHBOURS=6,MAX_SEGMENTS=8,MAX_LOCAL_POLYS=16,MAX_CORNERS=4,MIN_TARGET_DIST=0.01,COLLISION_RESOLVE_FACTOR=0.7;
const dist2D=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const triArea2D=(a,b,c)=>(c.x-a.x)*(b.z-a.z)-(b.x-a.x)*(c.z-a.z);
const perp2D=(u,v)=>u.z*v.x-u.x*v.z;
function distPtSegSqr2D(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;let t=dx*(p.x-a.x)+dz*(p.z-a.z);if(d>0)t/=d;t=Math.max(0,Math.min(1,t));const x=a.x+t*dx-p.x,z=a.z+t*dz-p.z;return x*x+z*z;}
// Detour sweepCircleCircle: times along v when circle (c0,r0) touches (c1,r1).
function sweepCircleCircle(c0,r0,v,c1,r1){const sx=c1.x-c0.x,sz=c1.z-c0.z,r=r0+r1,c=sx*sx+sz*sz-r*r;let a=v.x*v.x+v.z*v.z;if(a<0.0001)return null;
 const b=v.x*sx+v.z*sz,d=b*b-a*c;if(d<0)return null;a=1/a;const rd=Math.sqrt(d);return [(b-rd)*a,(b+rd)*a];}
function isectRaySeg(ap,u,bp,bq){const v={x:bq.x-bp.x,z:bq.z-bp.z},w={x:ap.x-bp.x,z:ap.z-bp.z};let d=perp2D(u,v);if(Math.abs(d)<1e-6)return null;d=1/d;
 const t=perp2D(v,w)*d;if(t<0||t>1)return null;const s=perp2D(u,w)*d;if(s<0||s>1)return null;return t;}

// dtObstacleAvoidanceQuery::sampleVelocityAdaptive (+ prepare and processSample, without the early-out shortcut).
export function sampleVelocityAdaptive({pos,radius,vmax,vel,dvel,circles=[],segments=[]},params){
 for(const c of circles){const dp=new Vector3(c.p.x-pos.x,0,c.p.z-pos.z);const l=Math.hypot(dp.x,dp.z);if(l>1e-9)dp.multiplyScalar(1/l);c.dp=dp;
  const dv={x:c.dvel.x-dvel.x,z:c.dvel.z-dvel.z},a=triArea2D({x:0,z:0},dp,dv);c.np=a<0.01?{x:-dp.z,z:dp.x}:{x:dp.z,z:-dp.x};}
 for(const s of segments)s.touch=distPtSegSqr2D(pos,s.p,s.q)<0.01*0.01;
 const invHorizTime=1/params.horizTime,invVmax=vmax>0?1/vmax:Number.MAX_VALUE;
 const penalty=vc=>{const vpen=params.weightDesVel*(dist2D(vc,dvel)*invVmax),vcpen=params.weightCurVel*(dist2D(vc,vel)*invVmax);let tmin=params.horizTime,side=0,nside=0;
  for(const c of circles){const vab={x:vc.x*2-vel.x-c.vel.x,z:vc.z*2-vel.z-c.vel.z};side+=Math.max(0,Math.min(1,Math.min((c.dp.x*vab.x+c.dp.z*vab.z)*0.5+0.5,(c.np.x*vab.x+c.np.z*vab.z)*2)));nside++;
   const hit=sweepCircleCircle(pos,radius,vab,c.p,c.rad);if(!hit)continue;let [htmin,htmax]=hit;if(htmin<0&&htmax>0)htmin=-htmin*0.5;if(htmin>=0&&htmin<tmin)tmin=htmin;}
  for(const s of segments){let htmin;
   if(s.touch){const sdir={x:s.q.x-s.p.x,z:s.q.z-s.p.z},snorm={x:-sdir.z,z:sdir.x};if(snorm.x*vc.x+snorm.z*vc.z<0)continue;htmin=0;}
   else {const t=isectRaySeg(pos,vc,s.p,s.q);if(t===null)continue;htmin=t;}
   htmin*=2;if(htmin<tmin)tmin=htmin;}
  if(nside)side/=nside;return vpen+vcpen+params.weightSide*side+params.weightToi*(1/(0.1+tmin*invHorizTime));};
 const ndivs=Math.max(1,Math.min(32,params.adaptiveDivs)),nrings=Math.max(1,Math.min(4,params.adaptiveRings)),depth=Math.max(1,Math.min(8,params.adaptiveDepth));
 const da=(1/ndivs)*Math.PI*2,ca=Math.cos(da),sa=Math.sin(da);
 let dl=Math.hypot(dvel.x,dvel.z);const d0=dl>1e-9?{x:dvel.x/dl,z:dvel.z/dl}:{x:0,z:0};
 // dtRorate2D(ddir+3, ddir, da*0.5)
 const half=da*0.5,d1={x:d0.x*Math.cos(half)-d0.z*Math.sin(half),z:d0.x*Math.sin(half)+d0.z*Math.cos(half)},ddir=[d0,d1];
 const pat=[{x:0,z:0}];
 for(let j=0;j<nrings;j++){const r=(nrings-j)/nrings,first={x:ddir[j%2].x*r,z:ddir[j%2].z*r};pat.push(first);let last1=first,last2=first;
  for(let i=1;i<ndivs-1;i+=2){const right={x:last1.x*ca+last1.z*sa,z:-last1.x*sa+last1.z*ca},left={x:last2.x*ca-last2.z*sa,z:last2.x*sa+last2.z*ca};pat.push(right,left);last1=right;last2=left;}
  if((ndivs&1)===0)pat.push({x:last2.x*ca-last2.z*sa,z:last2.x*sa+last2.z*ca});}
 let cr=vmax*(1-params.velBias),res={x:dvel.x*params.velBias,z:dvel.z*params.velBias},samples=0;
 for(let k=0;k<depth;k++){let minPenalty=Infinity,best={x:0,z:0};
  for(const p of pat){const vc={x:res.x+p.x*cr,z:res.z+p.z*cr};if(vc.x*vc.x+vc.z*vc.z>(vmax+0.001)**2)continue;const pen=penalty(vc);samples++;if(pen<minPenalty){minPenalty=pen;best=vc;}}
  res=best;cr*=0.5;}
 return {velocity:new Vector3(res.x,0,res.z),samples};
}

export class NavCrowd {
 // obstacles(): NavMeshObstacle cylinders [{x,y,z,radius,height}] in Unity space (enabled ones only).
 constructor(nav,{obstacles=()=>[]}={}){this.nav=nav;this.obstacles=obstacles;this.agents=new Set();this.frame=0;}
 // NavMeshAgent creation: placed on the nearest navmesh point, else the agent stays disabled (RemoveIfNotOnNavmesh).
 addAgent(params,position,{ext={x:2,y:4,z:2},fallback=5}={}){const hit=this.nav.findNearest(position,ext)??this.nav.samplePosition(position,fallback);if(!hit)return null;
  const agent={params:{radius:0.5,height:2,maxSpeed:3,maxAcceleration:8,stoppingDistance:0,autoBraking:true,obstacleAvoidanceType:1,avoidancePriority:50,...params},
   pos:hit.point.clone(),poly:hit.poly,vel:new Vector3(),dvel:new Vector3(),nvel:new Vector3(),corridor:null,corners:[],cornerEnd:false,remaining:Infinity,stopped:true,hasPath:false,
   boundary:{center:new Vector3(Infinity,0,0),segments:[]},neighbours:[],partial:false};
  agent.params.collisionQueryRange=agent.params.radius*12;this.agents.add(agent);return agent;}
 removeAgent(agent){this.agents.delete(agent);}
 // SetDestination: path request from the agent's polygon; an unreachable target gives the partial path.
 requestMoveTarget(agent,target,{maxNodes=4096}={}){const plan=this.nav.plan(agent.pos,target,{maxNodes,startPoly:agent.poly});
  if(!plan){agent.corridor=null;agent.hasPath=false;return false;}
  agent.corridor={polys:plan.polys,target:plan.end.clone()};agent.partial=plan.partial;agent.hasPath=true;agent.stopped=false;return true;}
 stop(agent){agent.stopped=true;}
 resetPath(agent){agent.corridor=null;agent.hasPath=false;agent.corners=[];}
 // dtPathCorridor::findCorners: corners from the agent through the corridor (up to MAX_CORNERS), near ones pruned.
 findCorners(agent){const c=agent.corridor;if(!c){agent.corners=[];agent.cornerEnd=false;return;}
  const all=this.nav.straightPath(agent.pos,c.target,c.polys,{maxCorners:MAX_CORNERS+2});
  while(all.length&&dist2D(all[0],agent.pos)<MIN_TARGET_DIST&&all.length>1)all.shift();
  agent.corners=all.slice(0,MAX_CORNERS);agent.cornerEnd=all.length<=MAX_CORNERS&&all.length>0&&all.at(-1).equals(c.target);
  let d=0,from=agent.pos;for(const k of agent.corners){d+=dist2D(from,k);from=k;}agent.remaining=agent.cornerEnd?d:Infinity;}
 // dtLocalBoundary::update: wall edges of the polygons around the agent, closest MAX_SEGMENTS within range.
 updateBoundary(agent){const b=agent.boundary,range=agent.params.collisionQueryRange;if(dist2D(b.center,agent.pos)<range*0.25&&b.poly===agent.poly)return;
  b.center.copy(agent.pos);b.poly=agent.poly;const nav=this.nav,polys=[agent.poly],seen=new Set(polys),a=new Vector3(),c=new Vector3();
  for(let i=0;i<polys.length&&polys.length<MAX_LOCAL_POLYS;i++)for(const l of nav.links(polys[i])){const nb=nav.linkTo[l];if(seen.has(nb))continue;
   const pt=nav.portal(polys[i],nb,agent.pos);if(!pt||distPtSegSqr2D(agent.pos,pt.left,pt.right)>range*range)continue;seen.add(nb);polys.push(nb);if(polys.length>=MAX_LOCAL_POLYS)break;}
  const segs=[];for(const p of polys){const n=nav.vertCount(p),linked=new Set();for(const l of nav.links(p))linked.add(nav.linkEdge[l]);
   const mid=nav.center(p);for(let e=0;e<n;e++){if(linked.has(e))continue;nav.polyVert(p,e,a);nav.polyVert(p,(e+1)%n,c);const d=distPtSegSqr2D(agent.pos,a,c);if(d>range*range)continue;
    // Oriented like Recast's wall segments: the polygon interior is on the triArea2D >= 0 side (winding independent).
    segs.push(triArea2D(mid,a,c)>=0?{d,p:a.clone(),q:c.clone()}:{d,p:c.clone(),q:a.clone()});}}
  segs.sort((x,y)=>x.d-y.d);b.segments=segs.slice(0,MAX_SEGMENTS);}
 update(dt){if(dt<=0)return;this.frame++;const list=[...this.agents],obstacles=list.some(a=>a.params.obstacleAvoidanceType>0)?this.obstacles():[];
  for(const ag of list){if(ag.stopped||!ag.corridor){ag.corners=[];ag.cornerEnd=false;ag.remaining=Infinity;continue;}this.findCorners(ag);}
  for(const ag of list){const range=ag.params.collisionQueryRange,n=[];
   for(const o of list){if(o===ag)continue;const dy=Math.abs(o.pos.y-ag.pos.y);if(dy>=(ag.params.height+o.params.height)/2)continue;const d=dist2D(o.pos,ag.pos);if(d>range)continue;n.push({agent:o,d});}
   n.sort((a,b)=>a.d-b.d);ag.neighbours=n.slice(0,MAX_NEIGHBOURS);}
  // Steering
  for(const ag of list){ag.dvel.set(0,0,0);if(ag.stopped||!ag.corridor||!ag.corners.length)continue;const p=ag.params;
   if(ag.cornerEnd&&ag.remaining<=Math.max(p.stoppingDistance,0.05)){ag.hasPath=false;ag.corridor=null;continue;}
   const k=ag.corners[0],dir=new Vector3(k.x-ag.pos.x,0,k.z-ag.pos.z),l=dir.length();if(l<1e-6)continue;dir.multiplyScalar(1/l);
   // dtCrowd end-of-path slowdown radius = 2 * agent radius (autoBraking).
   const slow=p.radius*2,scale=p.autoBraking?(ag.cornerEnd?Math.min(ag.remaining,slow):slow)/slow:1;ag.dvel.copy(dir).multiplyScalar(p.maxSpeed*scale);}
  // Velocity planning (obstacle avoidance)
  for(const ag of list){const p=ag.params,params=AVOIDANCE[p.obstacleAvoidanceType];if(!params||(ag.dvel.lengthSq()===0&&ag.vel.lengthSq()===0)){ag.nvel.copy(ag.dvel);continue;}
   const circles=[];
   // Unity avoidancePriority: an agent ignores neighbours of lower priority (higher number) while avoiding.
   for(const {agent:o} of ag.neighbours)if(o.params.avoidancePriority<=p.avoidancePriority)circles.push({p:o.pos,rad:o.params.radius,vel:o.vel,dvel:o.dvel});
   for(const o of obstacles){if(Math.abs(o.y-ag.pos.y)>p.height+o.height)continue;if(Math.hypot(o.x-ag.pos.x,o.z-ag.pos.z)>p.collisionQueryRange+o.radius)continue;circles.push({p:{x:o.x,z:o.z},rad:o.radius,vel:{x:0,z:0},dvel:{x:0,z:0}});}
   this.updateBoundary(ag);const segments=ag.boundary.segments.filter(s=>triArea2D(ag.pos,s.p,s.q)>=0).map(s=>({p:s.p,q:s.q}));
   ag.nvel.copy(sampleVelocityAdaptive({pos:ag.pos,radius:p.radius,vmax:p.maxSpeed,vel:ag.vel,dvel:ag.dvel,circles,segments},params).velocity);}
  // Integrate
  for(const ag of list){const max=ag.params.maxAcceleration*dt,dv=ag.nvel.clone().sub(ag.vel);dv.y=0;const ds=dv.length();if(ds>max)dv.multiplyScalar(max/ds);ag.vel.add(dv);
   ag.npos=ag.pos.clone();if(ag.vel.length()>0.0001)ag.npos.addScaledVector(ag.vel,dt);else ag.vel.set(0,0,0);}
  // Handle collisions between agents (4 iterations).
  for(let it=0;it<4;it++)for(const ag of list){const disp=new Vector3();let w=0;
   for(const {agent:o} of ag.neighbours){const diff=new Vector3(ag.npos.x-o.npos.x,0,ag.npos.z-o.npos.z),r=ag.params.radius+o.params.radius;let d=diff.lengthSq();if(d>r*r)continue;d=Math.sqrt(d);let pen=r-d;
    if(d<0.0001){diff.set(-ag.dvel.z,0,ag.dvel.x);pen=0.01;}else pen=(1/d)*(pen*0.5)*COLLISION_RESOLVE_FACTOR;disp.addScaledVector(diff,pen);w+=1;}
   if(w>0)ag.npos.addScaledVector(disp,1/w);}
  // dtPathCorridor::movePosition: constrained to the navmesh surface; the corridor start follows.
  for(const ag of list){if(dist2D(ag.npos,ag.pos)<1e-9)continue;const m=this.nav.moveAlongSurface(ag.poly,ag.pos,ag.npos);ag.poly=m.poly;ag.pos.copy(m.point);
   const h=this.nav.heightAt(ag.poly,ag.pos.x,ag.pos.z);if(h!==null)ag.pos.y=h;
   // The surface move can stop short at a wall: the velocity keeps what was actually travelled (dtCrowd uses npos too).
   if(ag.corridor)ag.corridor.polys=mergeCorridorStartMoved(ag.corridor.polys,m.visited??[m.poly]);}
 }
}
// dtMergeCorridorStartMoved: keep the corridor from the furthest visited polygon that is on it.
export function mergeCorridorStartMoved(path,visited){let furthestPath=-1,furthestVisited=-1;
 for(let i=path.length-1;i>=0;i--){let found=false;for(let j=visited.length-1;j>=0;j--)if(path[i]===visited[j]){furthestPath=i;furthestVisited=j;found=true;}if(found)break;}
 if(furthestPath===-1||furthestVisited===-1)return path;
 const out=[];for(let i=visited.length-1;i>=furthestVisited;i--)out.push(visited[i]);return out.concat(path.slice(furthestPath+1));}
