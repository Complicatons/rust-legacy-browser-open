// Walk-to-meet path planning for the native matrix's two-player rows (tools/native/gameplay.mjs meet()): a route a
// player can walk across the island from one character to the other. It plans on the original server's island navmesh
// (tools/export_navmesh.py: Detour tiles baked for a 0.5 m radius, 2 m tall agent, so it already leaves out the sea,
// cliffs and scene rocks/buildings), using the port's own Detour A* and funnel (browser/navmesh.mjs). The corners are
// split into short legs (the walker re-aims at each) and every leg is checked on the terrain heightmap: above the
// water line and no steeper than the motor can climb (CCMotor slopeLimit; legs over `preferSlope` are reported).
// Node only (reads browser/assets/recovered from disk). Positions in and out are browser space (Unity x, y, -z).
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Vector3} from 'three';
import {loadNavMesh} from '../../browser/navmesh.mjs';
import {sampleTriangle,worldToGrid} from '../../browser/terrain.mjs';

const REC=new URL('../../browser/assets/recovered/',import.meta.url);
const SLOPE_LIMIT=65,PREFER_SLOPE=45; // CCMotor m_SlopeLimit (player.json); the planner reports legs above 45°
const bytes=async url=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};

let cached=null;
// The island: navmesh + terrain heights + water line, loaded once. Rejects with a readable reason when an export is
// missing (the harness host needs the private asset overlay, like loadCatalogue).
export function loadIsland(){
 cached??=(async()=>{
  const nav=await loadNavMesh(new URL('navmesh/',REC),async url=>({ok:true,arrayBuffer:()=>bytes(url)}));
  const terrain=JSON.parse(await readFile(new URL('manifest.json',REC),'utf8')),heights=new Float32Array(await bytes(new URL(terrain.heightFile,REC)));
  const scene=JSON.parse(await readFile(new URL('scene/manifest.json',REC),'utf8'));
  let slopeLimit=SLOPE_LIMIT;try{const p=JSON.parse(await readFile(new URL('player.json',REC),'utf8'));const s=findKey(p,'m_SlopeLimit');if(Number.isFinite(s))slopeLimit=s;}catch{}
  const size=terrain.size,segments=size-1,extent=terrain.extent;
  return {nav,slopeLimit,waterLine:scene.world?.waterLine??0,spawnPoints:(scene.world?.spawnPoints??[]).map(s=>s.position),
   ground:(x,z)=>sampleTriangle(heights,size,...worldToGrid(x,z,extent,segments))};
 })();
 cached.catch(()=>{cached=null;});
 return cached;
}
function findKey(o,k){if(!o||typeof o!=='object')return undefined;if(k in o)return o[k];for(const v of Object.values(o)){const r=findKey(v,k);if(r!==undefined)return r;}return undefined;}

const toU=p=>new Vector3(p[0],p[1],-p[2]);
const toB=v=>[v.x,v.y,-v.z];
export const distXZ=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
// Snaps a browser-space position onto the navmesh: the polygon under/over it, else the nearest within 30 m.
function snap(nav,p){const u=toU(p);return nav.groundAt(u,4,8)??nav.findNearest(u,{x:3,y:6,z:3})??nav.samplePosition(u,30);}

// Plans from `from` to `to` (browser space). Returns {ok, why, partial, waypoints, length, straight, endGap, profile}:
// waypoints are browser-space points at most `leg` m apart ending at the navmesh point nearest `to`; endGap is how far
// that end is from `to` (a partial path, or a target standing off the mesh, e.g. on a foundation).
// `avoid`: navmesh polygons the A* may not enter (a detour round a spot the walker keeps getting blocked at); the
// walker's and the target's own polygons are never avoided.
export function planWalk(island,from,to,{leg=20,maxNodes=262144,avoid=null}={}){
 const {nav}=island,straight=distXZ(from,to),a=snap(nav,from),b=snap(nav,to);
 if(!a)return {ok:false,why:`the walker (${from.map(Math.round).join(', ')}) is more than 30 m from the navmesh`,straight};
 if(!b)return {ok:false,why:`the target (${to.map(Math.round).join(', ')}) is more than 30 m from the navmesh`,straight};
 const path=avoiding(nav,avoid,a.poly,b.poly).findPath(a.poly,a.point,b.poly,b.point,maxNodes);
 const end=path.partial?nav.closestPointOnPoly(path.polys.at(-1),b.point):b.point;
 const corners=[a.point,...nav.straightPath(a.point,end,path.polys)].map(toB);
 const waypoints=[];
 for(let i=1;i<corners.length;i++){const p=corners[i-1],q=corners[i],n=Math.max(1,Math.ceil(distXZ(p,q)/leg));
  for(let k=1;k<=n;k++){const x=p[0]+(q[0]-p[0])*k/n,z=p[2]+(q[2]-p[2])*k/n;waypoints.push([x,k===n?q[1]:island.ground(x,z),z]);}}
 if(!waypoints.length)waypoints.push(toB(end));
 const profile=pathProfile(island,[toB(a.point),...waypoints]),endGap=distXZ(waypoints.at(-1),to);
 const ok=profile.wet===0&&profile.maxSlope<=island.slopeLimit;
 return {ok,why:ok?null:profile.wet?`the path crosses water (${profile.wet} samples below the water line)`:`the path has a ${profile.maxSlope}° slope (motor limit ${island.slopeLimit}°)`,
  partial:path.partial,waypoints,corners:corners.length,polys:path.polys.length,corridor:path.polys,length:profile.length,straight:+straight.toFixed(1),endGap:+endGap.toFixed(1),profile};
}
// Terrain along a polyline (2 m samples): length, steepest climb/descent, legs above PREFER_SLOPE, lowest clearance
// above the water line and the number of samples under it.
export function pathProfile(island,points,step=2){
 let length=0,maxSlope=0,steep=0,minClear=Infinity,wet=0;
 for(let i=1;i<points.length;i++){const p=points[i-1],q=points[i],L=distXZ(p,q);length+=L;const n=Math.max(1,Math.ceil(L/step));let prev=island.ground(p[0],p[2]);
  for(let k=1;k<=n;k++){const x=p[0]+(q[0]-p[0])*k/n,z=p[2]+(q[2]-p[2])*k/n,h=island.ground(x,z),s=Math.atan2(Math.abs(h-prev),L/n)*180/Math.PI;
   if(s>maxSlope)maxSlope=s;if(s>PREFER_SLOPE)steep++;const c=h-island.waterLine;if(c<minClear)minClear=c;if(c<0)wet++;prev=h;}}
 return {length:+length.toFixed(1),maxSlope:+maxSlope.toFixed(1),steepSamples:steep,minClearance:+minClear.toFixed(1),wet};
}
// The waypoint to steer at: skips every waypoint already reached (within `reach`) or passed (the walker is beyond the
// perpendicular through it on the leg towards it), so a walker that cut a corner does not turn back.
export function nextWaypoint(waypoints,i,at,reach=3){
 while(i<waypoints.length-1){const q=waypoints[i],p=i?waypoints[i-1]:null;if(distXZ(at,q)<=reach){i++;continue;}
  if(p){const dx=q[0]-p[0],dz=q[2]-p[2];if((at[0]-q[0])*dx+(at[2]-q[2])*dz>0){i++;continue;}}break;}
 return i;
}
// The navmesh seen through a polygon filter: links into an avoided polygon are left out, so the port's own A*
// (browser/navmesh.mjs findPath, unchanged) routes round them.
function avoiding(nav,avoid,...keep){
 if(!avoid?.size)return nav;const view=Object.create(nav),links=nav.links.bind(nav);
 view.links=function*(p){for(const i of links(p)){const to=nav.linkTo[i];if(!avoid.has(to)||keep.includes(to))yield i;}};
 return view;
}
// The navmesh polygon under (or nearest to) a browser-space point, or null.
export function polyAt(island,p){return snap(island.nav,p)?.poly??null;}

// ---- detours (walk-meet.mjs) -----------------------------------------------------------------------------------
// A spot the walker was blocked at: `p` (browser space, just ahead of where it stood), `r` metres. Blocks that the
// navmesh and the port's world do not know (a server-only object behind TruthDetector corrections, a rock or fence
// the navmesh was baked through) are remembered as these discs; a route whose first `within` metres pass through one
// gets a detour.
export function routeHitsDisc(points,discs,{within=60}={}){
 let run=0;
 for(let i=1;i<points.length&&run<within;i++){const p=points[i-1],q=points[i];
  for(const d of discs)if(intoDisc(p,q,d))return d;run+=distXZ(p,q);}
 return null;
}
// The leg p -> q goes into disc d: it passes closer to the centre than d.r, and closer than where it starts (a walker
// standing at the edge of a disc may still walk away from it).
export function intoDisc(p,q,d){return offLeg(p,q,d.p)<Math.min(d.r,distXZ(p,d.p))-0.05;}
// The port's collision world for escape and detour checks (the gateway's LineOfSight world: scene colliders, trees,
// RockSpawn rocks, heightmap), loaded once; null when the recovered export is missing.
let collision=null;
export function loadCollision(){
 collision??=(async()=>{const {loadLineOfSight,BULLET_MASK,TRUTH_MASK}=await import('../../bridge/line-of-sight.mjs');
  const los=await loadLineOfSight(fileURLToPath(REC));
  return {los,mask:(BULLET_MASK|TRUTH_MASK)&~(1<<19)};})(); // solids only: the terrain is pathProfile's
 collision.catch(()=>{collision=null;});
 return collision;
}
// A straight walk a -> b (browser space) a player can make: over the terrain (no water, no slope over the motor
// limit), on the navmesh at both ends and, with the collision world, nothing solid at knee, chest and head height.
export function walkable(island,a,b,col=null){
 const pr=pathProfile(island,[a,b],1);if(pr.wet||pr.maxSlope>island.slopeLimit)return false;
 if(!island.nav.groundAt({x:b[0],y:b[1],z:-b[2]},4,8))return false;
 if(col)for(const h of [0.4,1.0,1.7]){const u=p=>[p[0],p[1]+h,-p[2]];if(col.los.blocked(u(a),u(b),{mask:col.mask,startMargin:0,endMargin:0}))return false;}
 return true;
}
// Detour options round the disc `d` the walker is blocked at, from `at`: back `back` m from it (when that is
// walkable), sideways (`side` +1 right / -1 left of the heading at -> d.p) by 4-26 m, then on past the disc; every leg
// walkable() and clear of every disc. Shortest first: {side, lateral, points: [back?, aside, past], length}.
export function detourPoints(island,at,d,discs,col=null,{lateral=[4,7,10,14,18,26],beyond=[8,12],back=3.5}={}){
 const dx=d.p[0]-at[0],dz=d.p[2]-at[2],L=Math.hypot(dx,dz)||1,fx=dx/L,fz=dz/L,out=[];
 const pt=(x,z)=>[x,island.ground(x,z),z],clear=(a,b)=>!discs.some(e=>intoDisc(a,b,e));
 let b=pt(at[0]-fx*back,at[2]-fz*back);if(!(clear(at,b)&&walkable(island,at,b,col)))b=at;
 for(const s of lateral)for(const side of [1,-1])for(const f of beyond){
  const c=pt(b[0]-fz*side*s,b[2]+fx*side*s),e=pt(d.p[0]-fz*side*s+fx*f,d.p[2]+fx*side*s+fz*f);
  if(!clear(b,c)||!clear(c,e)||!walkable(island,b,c,col)||!walkable(island,c,e,col))continue;
  out.push({side,lateral:s,points:b===at?[c,e]:[b,c,e],length:distXZ(at,b)+distXZ(b,c)+distXZ(c,e)});}
 return out.sort((a,b)=>a.length-b.length);
}
// How far `at` is (xz) from the leg p -> q.
export function offLeg(p,q,at){const dx=q[0]-p[0],dz=q[2]-p[2],l=dx*dx+dz*dz,t=l>0?Math.max(0,Math.min(1,((at[0]-p[0])*dx+(at[2]-p[2])*dz)/l)):0;return Math.hypot(at[0]-p[0]-dx*t,at[2]-p[2]-dz*t);}
// Distance left along the path from `at` (straight to waypoint i, then the legs after it).
export function remaining(waypoints,i,at){let d=distXZ(at,waypoints[i]);for(let k=i+1;k<waypoints.length;k++)d+=distXZ(waypoints[k-1],waypoints[k]);return d;}
