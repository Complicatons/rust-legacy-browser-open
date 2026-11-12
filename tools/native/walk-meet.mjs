// Walk-to-meet: one browser player walks across the island to another one like a player would, along a navmesh path
// (tools/native/walk-plan.mjs). Ordinary input only, so the original server's TruthDetector sees normal movement: the
// view turns to the next waypoint (the mouse-look stand-in), W is held (Shift too while far from the end and not
// sidestepping; the motor cancels sprint on strafe/back), no teleports. About once a second it re-reads both positions
// and the walker's vitals; it re-plans when stuck (no progress for 3 s), after a server correction, when the walker
// strays off the path or when the target moved more than 20 m from where the path ends. The last metres go straight.
//
// Blocks the navmesh does not know (a server-only object behind TruthDetector corrections, a rock or fence the navmesh
// was baked through) are remembered as discs just ahead of where the walker was stopped. The second block at the same
// spot, or a re-plan that returns the same path from the same place, makes the next plan avoid the disc's navmesh
// polygon and, when the route still runs through it, go round it: sideways 4-18 m (each leg checked on the heightmap,
// the navmesh and the port's collision world), past the disc, then on along a fresh plan. Escapes before a re-plan:
// release, back off (from the second block on), jump, and sidestep to the side that is clear. A walker that dies on
// the way (wildlife, a fall) stops at once with the death reason instead of "walking" a dead character until time out.
//
// The walker logic only talks to a `body` (pageBody below for a browser page, tools/native/walk-sim.mjs for the
// port's motor offline): now(), sleep(ms), feet(), status() {dead, health, reason}, aim(point), keys([codes]),
// release(), corrections() (TruthDetector corrections so far) and optional lock().
import {feet,aimAt,lockPointer,truthCorrectionCount,sleepMs as sleep} from './driver.mjs';
import {TruthGuard} from './truth-guard.mjs';
import {loadIsland,loadCollision,planWalk,nextWaypoint,remaining,offLeg,distXZ,routeHitsDisc,detourPoints,polyAt,walkable} from './walk-plan.mjs';

const KEYS=['KeyW','ShiftLeft','KeyA','KeyD','KeyS','Space'];
const round=v=>v==null?v:+Number(v).toFixed(1);
// A browser page as the walker's body.
export function pageBody(page){
 const held=new Set();
 return {now:()=>Date.now(),sleep,feet:()=>feet(page),aim:p=>aimAt(page,p),lock:()=>lockPointer(page),corrections:()=>truthCorrectionCount(page),
  async status(){try{return await page.evaluate(()=>{const s=window.explorerState,box=document.querySelector('#death');
   return {dead:Boolean(s?.vitals?.dead)||Boolean(s?.online&&s.online.state==='in-game'&&s.online.character==null),health:s?.vitals?.health??null,
    reason:box&&!box.hidden?document.querySelector('#death-reason')?.textContent??null:null};});}catch{return {dead:false};}},
  async keys(keys){for(const k of [...held])if(!keys.includes(k)){await page.keyboard.up(k);held.delete(k);}for(const k of keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}},
  async release(){held.clear();for(const k of KEYS)await page.keyboard.up(k).catch(()=>{});}};
}
// page: the walker; target(): the other player's browser-space feet (re-read during the walk).
export function walkToMeet(page,target,opts={}){return walkMeetCore(pageBody(page),target,opts);}

// Returns {arrived, died, why, ms, startDistance, distanceLeft, path, replans, stuck, samePath, blocks[], detours[],
// hurt[], progress[], plans[], truth?, final?}.
export async function walkMeetCore(body,target,{within=2.2,ms=null,tick=250,stuckMs=3000,retarget=20,stray=12,finalLeg=10,sprint=true,collision=true,
 discSeconds=180,guard=null,island:given=null,log=()=>{}}={}){
 const t0=body.now(),sec=()=>Math.round((body.now()-t0)/1000);
 const ev={arrived:false,died:null,why:null,ms:0,startDistance:null,distanceLeft:null,path:null,replans:0,stuck:0,samePath:0,blocks:[],detours:[],hurt:[],progress:[],plans:[]};
 let island;try{island=given??await loadIsland();}catch(e){ev.why='no island navmesh on this host: '+e.message.split('\n')[0];return ev;}
 const col=collision?await loadCollision().catch(()=>null):null;
 let at=await body.feet(),goal=await target();if(!at||!goal){ev.why='no position for '+(!at?'the walker':'the target');return ev;}
 ev.startDistance=round(distXZ(at,goal));
 // Blocks: each one a point just ahead of where the walker was stopped, weight 1 (stuck, same path) or 2 (a server
 // correction: the server has said there is something on that line). A point's disc gets `hits` = the weight of
 // every point within 6 m (one obstacle hit at several places, e.g. a wall) and a radius growing with it; discs with
 // 2 hits or more are avoided.
 const points=[];
 const discs=()=>{const now=body.now();for(let k=points.length;k--;)if(points[k].until<now)points.splice(k,1);
  return points.map(x=>{const hits=points.reduce((n,y)=>n+(distXZ(x.p,y.p)<6?y.w:0),0);return {p:x.p,hits,r:Math.min(3,1.5+0.25*hits)};});};
 const block=(from,ahead,kind)=>{const dx=ahead[0]-from[0],dz=ahead[2]-from[2],L=Math.hypot(dx,dz)||1,p=[from[0]+dx/L*1.5,from[1],from[2]+dz/L*1.5];
  points.push({p,w:kind==='correction'?2:1,until:body.now()+discSeconds*1000});if(points.length>60)points.shift();
  const d=discs().at(-1);ev.blocks.push({at:sec(),kind,p:p.map(Math.round),hits:d.hits});if(ev.blocks.length>40)ev.blocks.splice(10,1);return d;};
 let last=null;
 const note=(why,p,extra={})=>{ev.plans.push({at:sec(),why,from:at.map(Math.round),to:goal.map(Math.round),ok:p.ok,partial:p.partial??null,length:p.length??null,straight:p.straight,endGap:p.endGap??null,maxSlope:p.profile?.maxSlope??null,why2:p.why??null,...extra});};
 const plan=why=>{
  const all=discs(),firm=all.filter(d=>d.hits>=2),avoid=new Set(firm.map(d=>polyAt(island,d.p)).filter(p=>p!=null));
  let r=avoid.size?planWalk(island,at,goal,{avoid}):null;if(!r?.ok||r.partial)r=planWalk(island,at,goal);
  if(!r.ok){note(why,r);return r;}
  // The same path from the same place: the re-plan changes nothing, so the spot ahead counts as blocked once more.
  const same=last&&distXZ(last.from,at)<2&&samePath(last.waypoints,r.waypoints);last={from:at,waypoints:r.waypoints};
  if(same&&why!=='retarget'){ev.samePath++;block(at,r.waypoints[0],'same path');}
  const d=routeHitsDisc([at,...r.waypoints],firm);
  // Each earlier detour round the same spot (within 25 m) asks for a wider one: 4, 7, 10, 14, 18, 26 m aside.
  if(d){const LAT=[4,7,10,14,18,26],before=ev.detours.filter(x=>distXZ(x.round,d.p)<25).length,all=detourPoints(island,at,d,firm,col),wide=all.filter(o=>o.lateral>=LAT[Math.min(before,LAT.length-1)]);
   for(const o of wide.length?wide:all){const past=o.points.at(-1),rest=planWalk(island,past,goal,{avoid});
    if(!rest.ok||routeHitsDisc([past,...rest.waypoints],firm))continue;
    const route={...rest,waypoints:[...o.points,...rest.waypoints],length:+(o.length+rest.length).toFixed(1),detour:{side:o.side,lateral:o.lateral}};
    ev.detours.push({at:sec(),round:d.p.map(Math.round),hits:d.hits,side:o.side,lateral:o.lateral});note(why,route,{detour:o.lateral*o.side});return route;}
   note(why,r,{detour:'none'});return r;}
  note(why,r);return r;
 };
 let route=plan('start');if(!route.ok){ev.why='no walkable path: '+route.why;return ev;}
 ev.path={length:route.length,straight:route.straight,corners:route.corners,waypoints:route.waypoints.length,partial:route.partial,endGap:route.endGap,profile:route.profile};
 // ~5 m/s over the path (sprint is faster, slopes slower) plus a minute of slack; cfg.meetMs overrides.
 // Standing out a high violation estimate is not walking time: the guard's pauses extend it by up to 2 minutes.
 const budget=ms??Math.max(60000,route.length*200+60000);let end=t0+budget;ev.budgetMs=budget;
 await body.lock?.();
 // Only corrections from now on count (a shared guard keeps its own count and estimate).
 const truth=guard??new TruthGuard(),ts={corrections:0,pausedS:0};if(!guard)truth.seen=await body.corrections();
 const hold=async(keys,t)=>{await body.keys(keys);await nap(t);await body.keys([]);};
 let lastHealth=null;
 // Vitals: a dead walker stops here (true); damage on the way is kept as evidence (wildlife, falls).
 const dead=async()=>{const st=await body.status()??{};if(Number.isFinite(st.health)){if(lastHealth!=null&&st.health<lastHealth-0.5&&ev.hurt.length<20)ev.hurt.push([sec(),Math.round(st.health)]);lastHealth=st.health;}
  if(!st.dead)return false;ev.died={at:sec(),reason:st.reason??null,where:at?.map(Math.round)??null};ev.why=`the walker died after ${sec()} s${st.reason?': '+st.reason:''}`;return true;};
 // Stands still (moves keep being accepted) for `s` seconds, watching the vitals.
 const stand=async s=>{const until=body.now()+s*1000;while(body.now()<until){await body.sleep(Math.min(1000,until-body.now()));if(await dead())return false;}return true;};
 // The side (+1 right, -1 left of the heading at -> ahead) a 2.5 m sidestep can take; `prefer` first.
 const clearSide=(from,ahead,prefer)=>{const dx=ahead[0]-from[0],dz=ahead[2]-from[2],L=Math.hypot(dx,dz)||1;
  for(const s of [prefer,-prefer]){const x=from[0]-dz/L*s*2.5,z=from[2]+dx/L*s*2.5;if(walkable(island,from,[x,island.ground(x,z),z],col))return s;}return prefer;};
 // A server correction (TruthDetector rolled a move back: the server has something on this line that the port's world
 // and the navmesh do not): let the teleport back land, mark the spot, step aside, wait out a high violation estimate.
 // Corrections that arrive while it steps aside or stands are taken in too, and each high estimate is waited out.
 const yieldTruth=async ahead=>{let fresh=truth.update(await body.corrections(),body.now()/1000);if(!fresh)return false;
  ts.corrections+=fresh;await body.keys([]);await body.sleep(400);at=await body.feet()??at;
  // Back off along the line the server accepted, then step aside: a strafe right at the blocked line can cross it.
  // With the estimate already high it only backs off (another blocked move now would cost 100 more).
  if(ahead)block(at,ahead,'correction');side=ahead?clearSide(at,ahead,-side):-side;
  await hold(['KeyS'],500);if(!truth.mustPause(body.now()/1000))await hold([side>0?'KeyD':'KeyA'],600);
  for(let k=0;k<20;k++){fresh=truth.update(await body.corrections(),body.now()/1000);ts.corrections+=fresh;
   const now=body.now()/1000;if(!truth.mustPause(now)&&!fresh)break;
   const s=Math.max(truth.pauseSeconds(now),fresh?1:0);if(ts.pausedS<120)end+=Math.min(s,120-ts.pausedS)*1000;ts.pausedS+=s;if(!await stand(s))return true;}
  return true;};
 // The loop's wait between steering updates: cut short (keys released at once) when a correction comes in, so the
 // walker does not press on into the same line for the rest of the tick.
 const nap=async t=>{const until=body.now()+t;while(body.now()<until){await body.sleep(Math.min(50,until-body.now()));if(await body.corrections()>truth.seen){await body.keys([]);return;}}};
 let i=0,side=1,lastMove={t:body.now(),at},lastLog=-Infinity,lastCheck=-Infinity;
 try{
  while(body.now()<end){
   if(await yieldTruth(route.waypoints[i])){if(ev.died)break;at=await body.feet();if(!at){ev.why='the walker lost its character';break;}
    const r=plan('correction');if(r.ok){route=r;i=0;ev.replans++;}lastMove={t:body.now(),at};continue;}
   at=await body.feet();if(!at){ev.why='the walker lost its character';break;}
   const now=body.now();
   if(now-lastCheck>=1000){lastCheck=now;if(await dead())break;const g=await target();if(g)goal=g;
    const left=distXZ(at,goal);if(now-lastLog>=15000){lastLog=now;ev.progress.push([sec(),Math.round(left)]);log(`walk-to-meet ${Math.round(left)} m left`);}
    if(left<=finalLeg)break;
    // Re-plan: the target walked off (or respawned) away from the path's end, or the walker strayed off the path.
    const strayed=i>0&&offLeg(route.waypoints[i-1],route.waypoints[i],at)>stray;
    if(distXZ(route.waypoints.at(-1),goal)>retarget+route.endGap||strayed){const r=plan(strayed?'strayed':'retarget');if(r.ok){route=r;i=0;ev.replans++;}}
    // Stuck: under 1 m in 3 s. Release, back off (a known spot), jump, sidestep to the clear side, plan again.
    if(distXZ(at,lastMove.at)>=1){lastMove={t:now,at};}
    else if(now-lastMove.t>=stuckMs){ev.stuck++;await body.keys([]);const ahead=route.waypoints[i],d=block(at,ahead,'stuck'),n=Math.min(4,d.hits);
     if(n>1)await hold(['KeyS'],300*n);
     side=clearSide(at,ahead,-side);await hold(['Space'],120);await hold([side>0?'KeyD':'KeyA','KeyW'],700*n);await hold(['KeyW'],400);
     at=await body.feet()??at;const r=plan('stuck');if(r.ok){route=r;i=0;ev.replans++;}lastMove={t:body.now(),at};continue;}
   }
   i=nextWaypoint(route.waypoints,i,at);
   // Past the path's end (a partial path, or the target is off the mesh): finish with the straight walk below.
   if(i===route.waypoints.length-1&&distXZ(at,route.waypoints[i])<=3)break;
   const wp=route.waypoints[i];await body.aim([wp[0],at[1]+1.5,wp[2]]);
   const far=remaining(route.waypoints,i,at)>finalLeg*2;
   await body.keys(sprint&&far?['KeyW','ShiftLeft']:['KeyW']);
   await nap(tick);
  }
  // The last metres (and a partial path's gap) straight at the target: jump and sidestep when it stalls.
  if(!ev.why&&body.now()<end){const fin={distance:Infinity,steps:0,stuck:0},stop=Math.min(end,body.now()+Math.max(20000,distXZ(at,goal)*400));let d=Infinity,stalled=0;
   while(body.now()<stop){
    if(await yieldTruth(null)){if(ev.died)break;stalled=0;d=Infinity;continue;}
    at=await body.feet();if(!at)break;if(await dead())break;goal=(await target())??goal;
    const prev=d;d=distXZ(at,goal);if(d<=within)break;stalled=prev-d<0.25?stalled+1:0;
    await body.aim([goal[0],at[1]+1.5,goal[2]]);
    if(stalled>=3){fin.stuck++;stalled=0;side=clearSide(at,goal,-side);await hold(['Space'],120);await hold([side>0?'KeyD':'KeyA','KeyW'],700);continue;}
    await hold(d>8?['ShiftLeft','KeyW']:['KeyW'],Math.max(120,Math.min(900,(d-within*0.6)*(d>8?160:240))));fin.steps++;}
   fin.distance=round(d);ev.final=fin;ev.stuck+=fin.stuck;}
 }finally{await body.release().catch(()=>{});}
 at=await body.feet();goal=(await target())??goal;
 if(ts.corrections)ev.truth={corrections:ts.corrections,pausedS:Math.round(ts.pausedS),estimate:Math.round(truth.estimate(body.now()/1000))};
 ev.distanceLeft=at&&goal?round(distXZ(at,goal)):null;ev.arrived=!ev.died&&ev.distanceLeft!=null&&ev.distanceLeft<=within;ev.ms=body.now()-t0;
 if(!ev.arrived&&!ev.why)ev.why=body.now()>=end?`out of time after ${Math.round(ev.ms/1000)} s`:`stopped ${ev.distanceLeft} m short`;
 if(ev.plans.length>8)ev.plans=[...ev.plans.slice(0,4),...ev.plans.slice(-4)];
 return ev;
}
// Two routes are the same when their first three waypoints are within 1 m of each other.
export function samePath(a,b){const n=Math.min(3,a.length,b.length);if(!n)return false;for(let k=0;k<n;k++)if(distXZ(a[k],b[k])>1)return false;return true;}
