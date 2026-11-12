// Gateway-side anti-cheat (ANTICHEAT-ADMIN-PLAN.md). One PlayerWatch per in-game browser session sees every command
// before game-bridge.mjs turns it into a native message: impossible commands are dropped, suspicious ones are scored
// and recorded as evidence with a short replay buffer. Limits come from recovered static data (player.json,
// items/manifest.json), never from the browser. With a shared bridge/line-of-sight.mjs world, hits, context queries and
// movement traces are also tested against the recovered collision, the NGC structures and the doors the session has seen
// (closed ones only), and airborne moves are probed for the ground under them (hover). Positions are Unity space (the
// browser converts before sending).
// Verified against unit tests and the mock stack only, never against the original server.

import {Quaternion,Euler,Vector3} from 'three';
import {BULLET_MASK,TRUTH_MASK} from './line-of-sight.mjs';

// Defaults equal the recovered values so a gateway without the asset files still checks.
export const DEFAULT_LIMITS=Object.freeze({
 maxHorizontalSpeed:8,   // CCMotor maxForwardSpeed 4 × (1 + sprint curve 1 × sprintScalars.y 1)
 maxFallSpeed:80,        // CCMotor maxFallSpeed
 jumpHeight:1.5,         // jumpBaseHeight 1 + jumpExtraHeight 0.5
 stepOffset:0.5,         // CharacterController m_StepOffset
 slopeLimit:65,          // CharacterController m_SlopeLimit (degrees)
 speedTolerance:1.25,    // latency/interpolation headroom on every speed limit
 burstSeconds:1,         // movement credit that absorbs bunched WebSocket frames
 speedSlack:1.5,         // metres of overspend before a speed flag
 teleportDistance:25,    // one step this far beyond the travel budget is dropped
 riseWindow:2,           // seconds of history for the fly (rise) check
 underTerrain:3,         // metres below the heightmap (only with a groundHeight sampler)
 resetGrace:2,           // seconds without movement flags after a server-originated position
 fireTolerance:1.15,     // fire-rate refill headroom
 fireBurst:2,            // shots that may arrive together
 unknownFireRate:0.05,   // 20 shots/s cap for items without recovered data
 headshotMinHits:15,
 headshotRatio:0.65,
 eyeHeights:[1.6476,0.8676], // player.json eyes.m_LocalPosition.y standing; crouched = − (totem max 2.08 − min 1.3)
 truthLift:0.5,          // TruthDetector traces from old + 0.5 m up
 targetTrail:0.6,        // seconds of a target's past positions that may still be on the shooter's screen
 losRaysPerSecond:80,    // per-session ray budget (CPU bound); checks beyond it are skipped, not guessed
 losRayBurst:160,
 maxEntities:20000,      // per-session NGC entity positions kept for context checks
 snapDegrees:90,         // yaw change within one send interval…
 snapWindow:0.35,        // …followed by a hit this soon
 rates:{inventory:[10,20],craft:[2,4],'take-all':[2,3],context:[5,10]}, // per-command buckets: [per second, burst]
 hoverHeight:3,          // feet this far above the probed ground (structures, doors and deployables included; kept at 3 m until real traffic)…
 hoverSeconds:2,         // …for this long…
 hoverDrop:2,            // …while sinking less than this (a fall from rest covers ~20 m in 2 s)
 hoverProbeInterval:0.25,// at most one ground probe (centre, then the footprint rim) per this many seconds while airborne
 footRadius:0.405,       // CharacterController m_Radius: the capsule stands on anything under its footprint, not only its centre
 meleeReach:6,           // MeleeWeaponDataBlock.DoAction1: the server ignores hits on objects ≥ 6 m from the attacker…
 meleeSlack:2,           // …flagged only beyond reach + slack (the gateway's positions lag)
 arrowSpeed:80,          // Hunting Bow arrowSpeed (items/manifest.json overrides per weapon)
 arrowDrop:5,            // ArrowMovement.dropDegreesPerSec
 arrowLife:4,            // ArrowMovement maxLifeTime (s)
 arrowOffPath:4,         // a bow hit on a target this far from every point of the arrow's path
 originSlack:2,          // reported shot origins this far from every gateway eye are replaced by the nearest eye
 pointSlack:1.5,         // client hit points on untracked NGC entities count as sight targets only this close to the root
});
export const DEFAULT_POLICY=Object.freeze({halfLifeSeconds:600,reviewScore:50,kickScore:150,autoKick:false,evidenceLimit:50,replaySeconds:20,replayLimit:200});
export const SEVERITY=Object.freeze({teleport:40,speed:10,fly:25,'under-terrain':30,'fire-rate':15,'pellet-count':50,'no-reload':20,'hit-range':20,'headshot-ratio':30,'command-flood':5,
 'wall-shot':25,'wall-use':20,noclip:30,'yaw-snap':15,'command-rate':10,hover:25,'arrow-path':20});
// Facepunch.HitBox BodyPart: Neck 8, Head 9, Scalp 10, Nostrils 11, Jaw 12, Tongue 13-14, Brain 16, Eyes 20-21.
const HEAD_PARTS=new Set([8,9,10,11,12,13,14,16,20,21]);
const FIRE_ACTIONS=new Set(['bullet-fire','bow-fire','melee-hit','grenade-throw','throwable-throw','torch-throw']);
const COOLDOWN={speed:1,fly:2,'under-terrain':5,'no-reload':5,'hit-range':2,'headshot-ratio':60,'command-flood':10,'fire-rate':0.5,
 'wall-shot':2,'wall-use':5,noclip:2,'yaw-snap':5,'command-rate':5,hover:5,'arrow-path':5};
const CHARACTER=':player_soldier',STATE_CROUCH=1,NGC_CARRIER='!Ng';
// Recovered wildlife prefabs (animals/manifest.json); the server moves them with BasicWildLifeAI.GetNetworkUpdate.
const ANIMALS=new Set([':chicken_prefab',':rabbit_prefab_a',':boar_prefab',':stag_prefab',':wolf_prefab',':bear_prefab',':mutant_wolf',':mutant_bear']);
// Sight-target heights above a root: players (chest, head, feet), animals (box centres 0.23–0.75 m), NGC entities.
const HEIGHTS={player:[1,1.6,0.3],animal:[0.25,0.6,1],entity:[0.5,1]};
// Browser inventory commands (bridge/game-bridge.mjs inventory()) → rate bucket: ITMV/ITMG/ITSM/ISMV/ITSP, CRFS, TakeAll.
const INVENTORY_BUCKET={move:'inventory',split:'inventory',craft:'craft','take-all':'take-all'};
const wrap180=d=>((d%360)+540)%360-180;

// Limits from the recovered player.json (motorSettings, HumanControlConfiguration, controller).
export function limitsFromPlayerConfig(config){
 const m=config?.motorSettings?.data,c=config?.traits?.HumanControlConfiguration?.data,ctl=config?.controller?.data;
 if(!m)return {...DEFAULT_LIMITS};
 const sprintMax=Math.max(0,...(c?.sprintAddSpeedByTime?.m_Curve??[{value:1}]).map(k=>k.value));
 const sprint=1+sprintMax*Math.max(c?.sprintScalars?.x??1,c?.sprintScalars?.y??1);
 return {...DEFAULT_LIMITS,
  maxHorizontalSpeed:Math.max(m.maxForwardSpeed,m.maxSidewaysSpeed,m.maxBackwardsSpeed)*sprint,
  maxFallSpeed:m.maxFallSpeed??DEFAULT_LIMITS.maxFallSpeed,
  jumpHeight:(m.jumpBaseHeight??1)+(m.jumpExtraHeight??0.5),
  stepOffset:ctl?.m_StepOffset??DEFAULT_LIMITS.stepOffset,
  slopeLimit:ctl?.m_SlopeLimit??DEFAULT_LIMITS.slopeLimit,
  footRadius:ctl?.m_Radius??DEFAULT_LIMITS.footRadius};
}

// uniqueID → {name, fireRate, range, pellets, clip} for every recovered datablock with a fireRate.
export function weaponsFromItems(manifest){
 const table=new Map();
 for(const item of Object.values(manifest?.items??{})){
  const d=find(item,'fireRate')!==undefined?item:null;if(!d)continue;
  const uid=find(item,'uniqueID')??find(item,'_uniqueID'),fireRate=Number(find(item,'fireRate'));
  if(!Number.isInteger(uid)||!(fireRate>0))continue;
  table.set(uid,{name:String(find(item,'name')??find(item,'m_Name')??uid),fireRate,range:num(find(item,'bulletRange')),pellets:num(find(item,'numPellets'))??1,clip:num(find(item,'maxClipAmmo')),...(num(find(item,'arrowSpeed'))!=null?{arrowSpeed:num(find(item,'arrowSpeed'))}:{})});
 }
 return table;
}
function find(o,key,depth=0){
 if(!o||typeof o!=='object'||depth>6)return undefined;
 if(Object.hasOwn(o,key))return o[key];
 for(const v of Object.values(o)){const r=find(v,key,depth+1);if(r!==undefined)return r;}
 return undefined;
}
const num=v=>Number.isFinite(Number(v))&&v!==null&&v!==undefined?Number(v):undefined;
const round=v=>Math.round(v*100)/100;
const isVec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const isQuat=q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&q.some(v=>v!==0);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

// ArrowMovement (decompiled client): each frame the arrow pitches down dropDegreesPerSec about its own right axis, then
// moves speed × dt along its forward. In closed form the path is a circle arc in the shot's vertical plane:
// p(t) = origin + speed · rotation · (0, (cos ωt − 1)/ω, sin ωt/ω), ω = drop in rad/s. Unity points; rotation [x,y,z,w].
export function arrowPath(origin,rotation,speed,dropDegrees){
 const q=new Quaternion(...rotation).normalize(),w=dropDegrees*Math.PI/180,v=new Vector3();
 return t=>{if(w>0)v.set(0,(Math.cos(w*t)-1)/w,Math.sin(w*t)/w);else v.set(0,0,t);v.multiplyScalar(speed).applyQuaternion(q);return [origin[0]+v.x,origin[1]+v.y,origin[2]+v.z];};
}
// Unity Transform.TransformPoint for an NGC root (position, euler degrees as Quaternion.Euler, uniform scale 1).
function entityPoint(e,local){
 const r=Math.PI/180,v=new Vector3(...local).applyQuaternion(new Quaternion().setFromEuler(new Euler(e.euler[0]*r,e.euler[1]*r,e.euler[2]*r,'YXZ')));
 return [e.pos[0]+v.x,e.pos[1]+v.y,e.pos[2]+v.z];
}

export class PlayerWatch{
 // lineOfSight: shared bridge/line-of-sight.mjs instance (null disables wall-shot, wall-use, noclip, hover and arrow-path);
 // sendInterval: the server's NetCull send interval (1 / worldInfo.sendRate) for yaw-snap timing.
 constructor({subject,name,playerId,limits=DEFAULT_LIMITS,weapons=new Map(),policy=DEFAULT_POLICY,groundHeight=null,lineOfSight=null,sendInterval=0.1,now=()=>performance.now()/1000,wallNow=Date.now}){
  Object.assign(this,{subject,name,playerId,limits:{...DEFAULT_LIMITS,...limits},weapons,policy:{...DEFAULT_POLICY,...policy},groundHeight,los:lineOfSight,sendInterval,now,wallNow});
  this.connectedAt=wallNow();this.score=0;this.scoreAt=now();this.counts={};this.evidence=[];this.pending=[];this.replay=[];
  this.lastFlag={};this.reviewed=false;this.characterView=null;this.items=new Map();this.positions=new Map();
  // Bounded per-session state: recent player positions (targetTrail), NGC entities (maxEntities), fixed buckets.
  this.trails=new Map();this.entities=new Map();this.carriers=new Map();this.buckets={};
  // Animal views among `positions`, NGC carrier view per network group (NetEntityID p1), arrows in flight per bow view.
  this.animals=new Set();this.groups=new Map();this.arrows=new Map();
  this.losTokens=this.limits.losRayBurst;this.losAt=now();this.losSkipped=0;this.moveFlags=0;
  this.hits={players:0,head:0};this.resetMovement(null);
 }
 resetMovement(position){this.prev=position?{pos:position,t:this.now()}:null;this.credit=this.limits.maxHorizontalSpeed*this.limits.burstSeconds;this.history=[];this.graceUntil=this.now()+this.limits.resetGrace;this.lastAim=null;this.snap=null;this.airborne=null;this.probe=null;}

 // ---- server → browser events (relayed by the gateway) ----
 observe(e){
  if(e.type==='create'){
   if(e.mine&&e.prefab===CHARACTER){this.characterView=e.viewId;if(isVec(e.position))this.resetMovement(e.position);}
   else if(e.prefab===CHARACTER&&isVec(e.position))this.seen(e.viewId,e.position);
   else if(ANIMALS.has(e.prefab)&&isVec(e.position)){this.animals.add(e.viewId);this.seen(e.viewId,e.position);}
   else if(e.prefab===NGC_CARRIER&&Number.isInteger(e.group))this.groups.set(e.group,e.viewId);
   // ItemRepresentation initialData: parent NetworkViewID (ushort), HeldItemDataBlock uniqueID (int32).
   const b=e.initialData;
   if(e.mine&&b instanceof Uint8Array&&b.length>=6)this.items.set(e.viewId,{uid:new DataView(b.buffer,b.byteOffset,b.byteLength).getInt32(2,true),tokens:this.limits.fireBurst,t:this.now(),shots:0});
   return;
  }
  if(e.type==='destroy'){
   if(e.kind==='view')this.forget(e.viewId);
   else if(e.kind==='all'){this.items.clear();this.positions.clear();this.trails.clear();this.animals.clear();this.groups.clear();this.arrows.clear();this.characterView=null;this.dispose();}
   // DestroyInGroup (cell exit), DestroyByPlayerID (disconnect), DestroyInGroupByPlayerID: the bridge lists the views
   // it removed. Their NGC structures go back to the shared line-of-sight world (else stale walls flag later shots and
   // fill maxEntities).
   else if(Array.isArray(e.views))for(const id of e.views)this.forget(id);
   return;
  }
  if(e.type==='ngc-create'){this.addEntity(e);return;}
  if(e.type==='ngc-destroy'){this.removeEntity(e.carrier+':'+e.innerID);return;}
  // BasicDoor state for the shared trace world: NGC doors (buffered DOo) and scene doors (DOc on connect, DOo on toggle).
  if((e.type==='ngc-call'||(e.type==='rpc'&&e.args?.class==='BasicDoor'))&&(e.name==='DOo'||e.name==='DOc')&&this.los){
   const v=Array.isArray(e.args)?e.args:e.args?.values;if(!Array.isArray(v)||!Number.isFinite(Number(v[0])))return;
   // DOo's ulong stamp is the server's ms clock; with the server's now it gives how long the animation has run.
   const stamp=e.name==='DOo'&&v[1]!=null?Number(v[1]):NaN,age=Number.isFinite(stamp)&&e.serverMs!=null?(Number(e.serverMs)-stamp)/1000:0,opts={age,settled:e.name==='DOc'};
   if(e.type==='ngc-call')this.los.ngcDoor(e.carrier+':'+e.innerID,v[0],opts);else this.los.sceneDoor(e.viewId,v[0],opts);
   return;
  }
  if(e.type==='rpc'&&e.name==='GetNetworkUpdate'&&e.args?.class==='BasicWildLifeAI'&&isVec(e.args.values?.[0])){this.animals.add(e.viewId);this.seen(e.viewId,e.args.values[0]);return;}
  if(e.type==='rpc'&&e.name==='ReadClientMove'&&isVec(e.args?.values?.[0])){
   // A position the server sends to the owner is authoritative (TruthDetector rollback).
   if(e.viewId===this.characterView)this.resetMovement(e.args.values[0]);else this.seen(e.viewId,e.args.values[0]);
  }
  // RustServerManagement.TeleportPlayerToWorld (website Go to / Bring, the teleport console command, unstick): the
  // server RPCs UnstickMove on its ServerManagement view to the moved player only, so it is always this character.
  if(e.type==='rpc'&&e.name==='UnstickMove'&&isVec(e.args?.values?.[0])&&this.characterView!=null)this.resetMovement(e.args.values[0]);
 }
 // One destroyed view: its positions, items, arrows, NGC entities (carrier) and group mapping.
 forget(viewId){
  this.items.delete(viewId);this.positions.delete(viewId);this.trails.delete(viewId);this.animals.delete(viewId);this.arrows.delete(viewId);
  if(viewId===this.characterView)this.characterView=null;
  for(const key of [...this.carriers.get(viewId)??[]])this.removeEntity(key);
  for(const [g,v] of this.groups)if(v===viewId)this.groups.delete(g);
 }
 // Another player's position; the short trail covers the shooter's interpolation delay.
 seen(viewId,pos){
  const t=this.now();this.positions.set(viewId,pos);let trail=this.trails.get(viewId);if(!trail)this.trails.set(viewId,trail=[]);
  trail.push({t,pos});while(trail.length>8||(trail.length>1&&trail[0].t<t-this.limits.targetTrail))trail.shift();
 }
 // NGC entities: positions for context checks; structure pieces are lent to the shared line-of-sight world.
 addEntity(e){
  if(!Number.isInteger(e.carrier)||!Number.isInteger(e.innerID)||!isVec(e.position))return;
  const key=e.carrier+':'+e.innerID;this.removeEntity(key);
  if(this.entities.size>=this.limits.maxEntities)return;
  const retained=this.los?.retain(key,e.prefab,e.position,e.euler)??false;
  this.entities.set(key,{carrier:e.carrier,pos:e.position,euler:isVec(e.euler)?e.euler:[0,0,0],prefab:e.prefab,retained});
  let keys=this.carriers.get(e.carrier);if(!keys)this.carriers.set(e.carrier,keys=new Set());keys.add(key);
 }
 removeEntity(key){
  const entry=this.entities.get(key);if(!entry)return;this.entities.delete(key);
  if(entry.retained)this.los.release(key);
  const keys=this.carriers.get(entry.carrier);keys?.delete(key);if(keys&&!keys.size)this.carriers.delete(entry.carrier);
 }
 // Session over (or level change): give back every structure this session lent to the shared world.
 dispose(){for(const key of [...this.entities.keys()])this.removeEntity(key);}

 // ---- browser commands: returns {allow:true} or {allow:false, reason} ----
 check(cmd){
  if(cmd?.type==='move')return this.move(cmd);
  if(cmd?.type==='item')return this.item(cmd);
  if(cmd?.type==='inventory')return this.inventory(cmd);
  if(cmd?.type==='context')return this.context(cmd);
  return {allow:true};
 }
 // Per-command buckets: inventory moves/merges/splits, craft starts, take-all, context queries.
 rate(bucket){
  const [perSecond,burst]=this.limits.rates?.[bucket]??[];if(!(perSecond>0))return {allow:true};
  const t=this.now(),b=this.buckets[bucket]??={tokens:burst,t};
  b.tokens=Math.min(burst,b.tokens+(t-b.t)*perSecond);b.t=t;
  if(b.tokens<1){this.flag('command-rate',{command:bucket,perSecond,burst});return {allow:false,reason:'command-rate'};}
  b.tokens-=1;return {allow:true};
 }
 inventory({action}){const bucket=Object.hasOwn(INVENTORY_BUCKET,action)?INVENTORY_BUCKET[action]:null;return bucket?this.rate(bucket):{allow:true};}
 context({action,target}){
  if(action!=='query')return {allow:true};
  const verdict=this.rate('context');if(!verdict.allow)return verdict;
  if(!this.los||!this.prev||this.now()<this.graceUntil)return verdict;
  const r=this.resolve(target)??this.sceneDoor(target);if(!r)return verdict;
  // An open or swinging door's panel is not where its closed pose says: only closed, settled doors are checked.
  if(r.kind==='entity'&&this.los.isDoor(r.entity.prefab)&&!this.los.doorClosed(r.id))return verdict;
  if(r.kind==='scene-door'&&!r.closed)return verdict;
  const pos=r.pos;
  this.record({kind:'use',target:r.id,pos});
  const eyes=this.eyes();if(dist(pos,this.prev.pos)<1)return verdict;
  let targets;
  if(r.kind==='scene-door')targets=r.points;
  else{targets=[[pos[0],pos[1]+1,pos[2]],[pos[0],pos[1]+0.5,pos[2]]];if(r.entity?.retained){const c=this.los.center(r.id);if(c)targets.push(c);}}
  // The used piece itself never blocks (a door is reached by touching its own panel).
  const res=this.sightline(eyes,targets,{mask:BULLET_MASK,endMargin:0.75,ignore:r.kind==='entity'?r.id:null,ignoreBody:r.body??null});
  if(res&&!res.clear)this.flag('wall-use',{target:r.id,...(r.kind==='scene-door'?{targetKind:'scene-door'}:{}),distance:res.blocker.total,blockedBy:res.blocker.what,at:res.blocker.at});
  return verdict;
 }
 // A static scene door (Context:A on its manual view ID, never Created, so never in `positions`): its panel from the
 // shared world, at the closed pose → {kind: scene-door, id, pos (bounds centre), points, closed, body}; else null.
 sceneDoor(target){
  if(!Number.isInteger(target?.viewId)||target.p1)return null;
  const d=this.los?.sceneDoorTarget?.(target.viewId);return d?{kind:'scene-door',id:target.viewId,pos:d.points[0],points:d.points,closed:d.closed,body:d.body}:null;
 }
 // A NetEntityID (hits: {p1:0, viewId} or {p1: carrier group, p2: innerID}) or a context target ({viewId} or
 // {carrier, innerID}) → {kind: player|animal|entity, id, pos, entity?}, from positions the gateway has seen; else null.
 resolve(target){
  if(Number.isInteger(target?.viewId)&&!target.p1){const pos=this.positions.get(target.viewId);return pos?{kind:this.animals.has(target.viewId)?'animal':'player',id:target.viewId,pos}:null;}
  let key=null;
  if(Number.isInteger(target?.carrier)&&Number.isInteger(target?.innerID))key=target.carrier+':'+target.innerID;
  else if(Number.isInteger(target?.p1)&&target.p1>0&&Number.isInteger(target?.p2)&&this.groups.has(target.p1))key=this.groups.get(target.p1)+':'+target.p2;
  const e=key&&this.entities.get(key);return e?{kind:'entity',id:key,pos:e.pos,entity:e}:null;
 }
 // Points a hit on `r` may have been aimed at: a player's or animal's recent positions at body heights (players also
 // to the sides); an NGC entity's bounds centre (tracked pieces) and root heights, plus the client's own hit point
 // (Unity world) when it lies on the tracked piece's bounds or, for untracked entities (boxes, bags), near the root.
 sightTargets(r,point=null){
  const L=this.limits,out=[];
  if(r.kind==='entity'){
   if(r.entity.retained){const c=this.los.center(r.id);if(c)out.push(c);}
   if(point&&(r.entity.retained?this.los.near(r.id,point):dist(point,r.pos)<=L.pointSlack))out.unshift(point);
   for(const h of HEIGHTS.entity)out.push([r.pos[0],r.pos[1]+h,r.pos[2]]);
   return out;
  }
  const t=this.now(),trail=(this.trails.get(r.id)??[]).filter(p=>p.t>=t-L.targetTrail).reverse();if(!trail.length)trail.push({pos:r.pos});
  for(const {pos} of trail)for(const h of HEIGHTS[r.kind])out.push([pos[0],pos[1]+h,pos[2]]);
  // To the sides at fixed offsets (players' shoulders, animals' head and rump), never the client's own point: one claimed
  // on the near side of a wall would clear a hidden target.
  const [x,y,z]=trail[0].pos,[side,h]=r.kind==='player'?[0.45,1]:[0.9,0.6];
  for(const [dx,dz] of [[side,0],[-side,0],[0,side],[0,-side]])out.push([x+dx,y+h,z+dz]);
  return out;
 }
 // Eye positions (Unity) at the last accepted move: standing and crouched, the current stance first.
 eyes(){const [stand,crouch]=this.limits.eyeHeights,p=this.prev.pos,order=this.moveFlags&STATE_CROUCH?[crouch,stand]:[stand,crouch];return order.map(h=>[p[0],p[1]+h,p[2]]);}
 // One ray from the per-session budget; false (and counted as skipped) when it ran out.
 takeRay(){
  const t=this.now(),L=this.limits;this.losTokens=Math.min(L.losRayBurst,this.losTokens+(t-this.losAt)*L.losRaysPerSecond);this.losAt=t;
  if(this.losTokens<1){this.losSkipped++;return false;}
  this.losTokens--;return true;
 }
 // First clear eye→target pair wins; all blocked gives the first blocker; null when the ray budget ran out.
 sightline(eyes,targets,opts){
  let first=null;
  for(const target of targets)for(const eye of eyes){
   if(!this.takeRay())return null;
   const b=this.los.blocked(eye,target,opts);if(!b)return {clear:true};first??=b;
  }
  return {clear:false,blocker:first};
 }
 // Yaw jump > snapDegrees between two moves one send interval apart; a hit within snapWindow turns it into a flag.
 aim(angles,t){
  const yaw=angles?.yaw;if(!Number.isFinite(yaw))return;
  const last=this.lastAim,delta=last?Math.abs(wrap180(yaw-last.yaw)):0;
  if(last&&t>=this.graceUntil&&t-last.t<=this.sendInterval*1.5+0.02&&delta>this.limits.snapDegrees)this.snap={t,to:yaw,delta,seconds:t-last.t};
  this.lastAim={t,yaw};
 }
 snapHit(target,weapon){
  const s=this.snap,t=this.now();if(!s)return;if(t-s.t>this.limits.snapWindow){this.snap=null;return;}
  this.snap=null;const pos=Number.isInteger(target?.viewId)?this.positions.get(target.viewId):undefined,detail={degrees:round(s.delta),seconds:round(s.seconds),hitAfter:round(t-s.t),weapon:weapon??'unknown'};
  // How far the snapped yaw is from the target's bearing (small = the snap landed on the target).
  if(pos&&this.prev)detail.aimError=round(Math.abs(wrap180(Math.atan2(pos[0]-this.prev.pos[0],pos[2]-this.prev.pos[2])*180/Math.PI-s.to)));
  this.flag('yaw-snap',detail);
 }
 // Bullet or melee hit on a player, animal or NGC entity the attacker could not have seen: every eye height to every
 // sight target blocked by the bullet mask (the target's own piece ignored). Flagged, never dropped.
 hiddenHit(r,detail,point=null){
  if(!this.los||!this.prev||this.now()<this.graceUntil)return;
  const res=this.sightline(this.eyes(),this.sightTargets(r,point),{mask:BULLET_MASK,ignore:r.kind==='entity'?r.id:null});
  if(res&&!res.clear)this.flag('wall-shot',{...detail,target:r.id,targetKind:r.kind,distance:res.blocker.total,blockedBy:res.blocker.what,at:res.blocker.at});
 }
 // A bullet record's point on an NGC entity → Unity world: the tracked piece's own transform (scale included), else the
 // entity's root at scale 1.
 entityWorld(r,local){return (r.entity.retained&&this.los.localToWorld(r.id,local))||entityPoint(r.entity,local);}
 // MeleeWeaponDataBlock.DoAction1: the server ignores hits on objects ≥ 6 m from the attacker and traces nothing.
 meleeHit(data,weapon){
  const r=this.resolve(data.target),L=this.limits;if(!r||!this.prev)return;
  const d=dist(r.pos,this.prev.pos);
  if(this.now()>=this.graceUntil&&d>L.meleeReach+L.meleeSlack)this.flag('hit-range',{weapon,attack:'melee',distance:round(d),range:L.meleeReach,target:r.id});
  this.hiddenHit(r,{weapon,attack:'melee'},isVec(data.point)?data.point:null);
 }
 // BowWeaponDataBlock.DoAction2 (bow-hit) only checks that an arrow is in flight; the hit arrives after the flight. The
 // oldest arrow of that bow is landed and its own path, from the bow-fire origin, is traced to where it passes the target.
 arrowLanded(viewId,action,data){
  const L=this.limits,t=this.now(),list=this.arrows.get(viewId);
  while(list?.length&&t-list[0].t>L.arrowLife+1)list.shift();
  const arrow=list?.shift();if(!arrow||action!=='bow-hit'||!arrow.eyes||!this.los||t<this.graceUntil)return;
  const r=this.resolve(data.target);if(!r)return;
  const detail={weapon:arrow.weapon?.name??'unknown',attack:'arrow',target:r.id,targetKind:r.kind};
  // The origin is the page's camera: one far from every gateway eye at the shot is replaced by the nearest eye.
  let origin=arrow.origin;const eye=arrow.eyes.reduce((a,b)=>dist(a,origin)<=dist(b,origin)?a:b);
  if(dist(eye,origin)>L.originSlack){detail.originOffset=round(dist(eye,origin));origin=eye;}
  const path=arrowPath(origin,arrow.rotation,arrow.weapon?.arrowSpeed??L.arrowSpeed,L.arrowDrop),targets=this.sightTargets(r);
  let best={d:Infinity,s:0};
  for(let i=0;i<=L.arrowLife*50;i++){const s=i/50,p=path(s);for(const q of targets){const d=dist(p,q);if(d<best.d)best={d,s};}}
  detail.flight=round(best.s);detail.offPath=round(best.d);
  if(best.d>L.arrowOffPath){this.flag('arrow-path',detail);return;}
  // Chords of ≤ 0.25 s (≤ 5 cm off the arc at 80 m/s) up to the closest point; the last stops 0.3 m short (wall-shot margin).
  const n=Math.max(1,Math.ceil(best.s/0.25));let a=path(0);
  for(let i=1;i<=n;i++){
   if(!this.takeRay())return;
   const b=path(best.s*i/n),hit=this.los.blocked(a,b,{mask:BULLET_MASK,startMargin:i===1?0.05:0,endMargin:i===n?0.3:0,ignore:r.kind==='entity'?r.id:null});
   if(hit){this.flag('wall-shot',{...detail,distance:hit.total,blockedBy:hit.what,at:hit.at});return;}
   a=b;
  }
 }
 // Hover: feet more than hoverHeight above the highest surface under them (terrain first; probe rays through the
 // collision world, structures and closed doors only when the terrain alone says airborne: the centre, then the
 // footprint rim while the centre finds nothing close) for hoverSeconds without
 // sinking hoverDrop. Legacy has no swimming, ladders or vehicles; the server never moves a character by itself.
 hover(origin,t){
  const L=this.limits,g=this.los.ground(origin[0],-origin[2]);
  if(!Number.isFinite(g)||origin[1]-g<=L.hoverHeight){this.airborne=null;return;}
  let s=this.probe;
  if(!s||t-s.t>=L.hoverProbeInterval||Math.hypot(origin[0]-s.x,origin[2]-s.z)>1){
   // The centre first; while that still says airborne, the rim of the capsule's footprint (eight points at footRadius):
   // a character on the edge of a wall top, a barricade or a rock stands on it with its centre past the edge.
   const probe=(dx,dz)=>this.los.groundBelow([origin[0]+dx,origin[1]+0.1,origin[2]+dz]),high=b=>b&&origin[1]-b.y<=L.hoverHeight;
   if(!this.takeRay())return;
   let below=probe(0,0);
   for(let k=0;k<8&&!high(below)&&L.footRadius>0;k++){if(!this.takeRay())break;const a=k*Math.PI/4,b=probe(L.footRadius*Math.cos(a),L.footRadius*Math.sin(a));if(b&&(!below||b.y>below.y))below=b;}
   s=this.probe={t,x:origin[0],z:origin[2],y:below?.y??g,what:below?.what??'terrain'};
  }
  const height=origin[1]-s.y;if(height<=L.hoverHeight){this.airborne=null;return;}
  const a=this.airborne??={t,y:origin[1]};
  if(t-a.t>=L.hoverSeconds){
   const drop=a.y-origin[1];
   if(drop<L.hoverDrop)this.flag('hover',{height:round(height),seconds:round(t-a.t),drop:round(drop),surface:s.what,at:origin.map(round)});
   this.airborne={t,y:origin[1]};
  }
 }
 move({origin,angles,stateFlags}){
  if(!isVec(origin))return {allow:true}; // the bridge rejects malformed moves itself
  const t=this.now(),L=this.limits;
  this.record({kind:'move',pos:origin,yaw:angles?.yaw,pitch:angles?.pitch});
  this.aim(angles,t);if(Number.isInteger(stateFlags))this.moveFlags=stateFlags;
  if(!this.prev){this.prev={pos:origin,t};this.history=[{t,y:origin[1],travelled:0}];return {allow:true};}
  const dt=Math.max(0,t-this.prev.t),[dx,dy,dz]=origin.map((v,i)=>v-this.prev.pos[i]),dh=Math.hypot(dx,dz);
  const grace=t<this.graceUntil,cap=L.maxHorizontalSpeed*L.burstSeconds*L.speedTolerance;
  this.credit=Math.min(cap,this.credit+L.maxHorizontalSpeed*L.speedTolerance*dt);
  if(!grace&&dh-this.credit>L.teleportDistance){
   this.flag('teleport',{distance:round(dh),budget:round(this.credit),seconds:round(dt),from:this.prev.pos.map(round),to:origin.map(round)});
   return {allow:false,reason:'impossible-move'}; // keep the last accepted position as the baseline
  }
  this.credit-=dh;
  if(this.credit<-L.speedSlack){if(!grace)this.flag('speed',{metresOver:round(-this.credit),limit:L.maxHorizontalSpeed,seconds:round(dt)});this.credit=0;}
  if(!grace&&dy<0&&dt>0&&-dy/dt>L.maxFallSpeed*L.speedTolerance&&-dy>L.teleportDistance/2)this.flag('speed',{fallSpeed:round(-dy/dt),limit:L.maxFallSpeed});
  // Rise: compare with the lowest point of the last riseWindow seconds and the horizontal travel since then.
  const travelled=(this.history.at(-1)?.travelled??0)+dh;
  this.history.push({t,y:origin[1],travelled});while(this.history.length&&this.history[0].t<t-L.riseWindow)this.history.shift();
  let low=this.history[0];for(const h of this.history)if(h.y<low.y)low=h;
  const rise=origin[1]-low.y,allowed=L.jumpHeight+L.stepOffset+(travelled-low.travelled)*Math.tan(L.slopeLimit*Math.PI/180)+0.5;
  if(!grace&&rise>allowed)this.flag('fly',{rise:round(rise),allowed:round(allowed),seconds:round(t-low.t)});
  if(!grace&&this.groundHeight){const g=this.groundHeight(origin[0],origin[2]);if(Number.isFinite(g)&&origin[1]<g-L.underTerrain)this.flag('under-terrain',{depth:round(g-origin[1]),at:origin.map(round)});}
  if(!grace&&this.los?.ground)this.hover(origin,t);
  // TruthDetector's movement trace (old + 0.5 m up → new) against its own mask: walls, structures, terrain.
  if(!grace&&this.los&&dh+Math.abs(dy)>0.05){
   const lift=p=>[p[0],p[1]+L.truthLift,p[2]],r=this.sightline([lift(this.prev.pos)],[lift(origin)],{mask:TRUTH_MASK,endMargin:0.05});
   if(r&&!r.clear)this.flag('noclip',{from:this.prev.pos.map(round),to:origin.map(round),blockedBy:r.blocker.what,at:r.blocker.at});
  }
  this.prev={pos:origin,t};
  return {allow:true};
 }
 item({viewId,action,data}){
  if(!data||typeof data!=='object')data={}; // {data:null} used to throw (data.hits / data.origin)
  const item=this.items.get(viewId);
  if(action==='bullet-reload'){if(item)item.shots=0;return {allow:true};}
  if(action==='bow-hit'||action==='bow-miss'){this.arrowLanded(viewId,action,data);return {allow:true};}
  if(!FIRE_ACTIONS.has(action))return {allow:true};
  const t=this.now(),weapon=item?this.weapons.get(item.uid):undefined,L=this.limits;
  const hits=action==='bullet-fire'&&Array.isArray(data.hits)?data.hits:[];
  this.record({kind:'fire',action,viewId,weapon:weapon?.name,hits:hits.map(h=>({bodyPart:h?.bodyPart,target:h?.target?.viewId}))});
  if(action==='bullet-fire'&&hits.length>(weapon?.pellets??1)&&weapon){
   this.flag('pellet-count',{weapon:weapon.name,records:hits.length,pellets:weapon.pellets});
   return {allow:false,reason:'impossible-shot'};
  }
  // Token bucket per held item view; items the gateway has not seen use the global cap.
  const state=item??(this.unknownItem??={tokens:L.fireBurst,t,shots:0});
  const rate=1/(weapon?.fireRate??L.unknownFireRate);
  state.tokens=Math.min(L.fireBurst,state.tokens+(t-state.t)*rate*L.fireTolerance);state.t=t;
  if(state.tokens<1){this.flag('fire-rate',{weapon:weapon?.name??'unknown',minInterval:weapon?.fireRate??L.unknownFireRate});return {allow:false,reason:'fire-rate'};}
  state.tokens-=1;
  if(action==='bullet-fire'&&weapon?.clip&&++state.shots>weapon.clip+1)this.flag('no-reload',{weapon:weapon.name,shots:state.shots,clip:weapon.clip});
  if(action==='bow-fire'&&isVec(data.origin)&&isQuat(data.rotation)){
   let list=this.arrows.get(viewId);if(!list)this.arrows.set(viewId,list=[]);
   list.push({t,origin:data.origin,rotation:data.rotation,eyes:this.prev?this.eyes():null,weapon});if(list.length>4)list.shift();
  }
  if(action==='melee-hit'&&data.target){this.snapHit(data.target,weapon?.name);this.meleeHit(data,weapon?.name??'unknown');}
  const shotAt=new Set();
  for(const h of hits){
   if(h?.target)this.snapHit(h.target,weapon?.name);
   const r=this.resolve(h?.target);if(!r)continue;
   if(r.kind==='player'){this.hits.players++;if(HEAD_PARTS.has(h.bodyPart))this.hits.head++;}
   if(weapon?.range&&this.prev){const d=dist(r.pos,this.prev.pos);if(d>weapon.range*1.1+5)this.flag('hit-range',{weapon:weapon.name,distance:round(d),range:weapon.range,target:r.id});}
   // Pellets on one target share one check. An NGC hit point is local to the entity (ReadHitInfo TransformPoint).
   if(!shotAt.has(r.id)){shotAt.add(r.id);this.hiddenHit(r,{weapon:weapon?.name??'unknown',attack:'bullet'},r.kind==='entity'&&isVec(h.point)?this.entityWorld(r,h.point):null);}
  }
  if(this.hits.players>=L.headshotMinHits&&this.hits.head/this.hits.players>L.headshotRatio)this.flag('headshot-ratio',{hits:this.hits.players,head:this.hits.head,ratio:round(this.hits.head/this.hits.players)});
  return {allow:true};
 }

 // ---- scoring and evidence ----
 currentScore(){const t=this.now();this.score*=Math.pow(0.5,(t-this.scoreAt)/this.policy.halfLifeSeconds);this.scoreAt=t;return this.score;}
 flag(kind,detail={}){
  const t=this.now();
  if(COOLDOWN[kind]&&t-(this.lastFlag[kind]??-Infinity)<COOLDOWN[kind])return null;
  this.lastFlag[kind]=t;
  const severity=SEVERITY[kind]??10,score=this.currentScore()+severity;this.score=score;
  this.counts[kind]=(this.counts[kind]??0)+1;
  const entry={subject:this.subject,kind,severity,score:Math.round(score),at:this.wallNow(),detail};
  // Attach the replay to high-severity flags and to the first flag over the review score.
  if(severity>=40||(!this.reviewed&&score>=this.policy.reviewScore)){this.reviewed||=score>=this.policy.reviewScore;entry.replay=this.replaySnapshot();}
  this.evidence.push(entry);if(this.evidence.length>this.policy.evidenceLimit)this.evidence.shift();
  this.pending.push(entry);if(this.pending.length>this.policy.evidenceLimit*4)this.pending.shift();
  return entry;
 }
 record(sample){
  const t=this.now();this.replay.push({t:round(t),...sample});
  while(this.replay.length&&(this.replay[0].t<t-this.policy.replaySeconds||this.replay.length>this.policy.replayLimit))this.replay.shift();
 }
 replaySnapshot(){const t0=this.replay[0]?.t??0;return this.replay.map(s=>({...s,t:round(s.t-t0)}));}
 shouldKick(){return this.policy.autoKick&&this.currentScore()>=this.policy.kickScore;}
 drain(){const out=this.pending;this.pending=[];return out;}
 summary(){return {subject:this.subject,name:this.name,playerId:this.playerId,connectedAt:this.connectedAt,score:Math.round(this.currentScore()),flags:{...this.counts}};}
}
