// The original server's TruthDetector (analysis/decompiled/server/Assembly-CSharp/TruthDetector.cs, truth.cs) as a
// model, for replaying a browser player's move stream offline (tools/replay-truth-trace.mjs, tests). Per accepted
// GetClientMove (HumanController.GetClientMove -> NoteMoved(origin, angles, info.timestamp)):
//  - Test_MovementSpeed: |new - old| / (stamp gap) over 20 m/s (100 m/s when moving down) adds (int) speed;
//  - Test_MovementTrace: Physics.Raycast(old + 0.5 m up, (new - old).normalized, |new - old|, 538444803) hitting
//    anything adds 100 and rolls the player back to the newest snapshot it can leave (>= 0.5 m from the new point);
//    that move returns Moved before the decrement and the kick check, and the owner gets ReadClientMove (correction);
//  - otherwise the move is recorded (16-snapshot ring of points >= 0.5 m apart), then violation-- and, while
//    truth.punish, violation > truth.threshold (400) kicks: "[v][NetUser|name|id|player] kicked for violation v".
// NoteTeleported (spawn: ServerManagement.SpawnPlayer; teleports: 2 s grace) clears the snapshots and the previous
// stamp (the next move is only recorded) but never the violation count, which decays one per accepted move.
// Positions are Unity-space [x, y, z]; times are seconds. trace(old, new) returns a hit description or null.
export const TRUTH_THRESHOLD=400,TRUTH_MIN_MOVEMENT=0.5;
const sq=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
const moved=(a,b)=>sq(a,b)>=0.25;
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1]&&a[2]===b[2];

export class TruthDetector{
 constructor({trace=()=>null,threshold=TRUTH_THRESHOLD,punish=true}={}){
  this.trace=trace;this.threshold=threshold;this.punish=punish;this.violation=0;this.prev={pos:[0,0,0],time:0};
  this.ignoreSeconds=0;this.snapshots=[];this.events=[];this.kicked=null;this.peak=0;}
 noteTeleported(pos,graceSeconds=0){this.snapshots=[];this.prev={pos:[...pos],time:0};
  if(graceSeconds>0)this.ignoreSeconds=this.ignoreSeconds<0?graceSeconds:this.ignoreSeconds+graceSeconds;}
 // Returns {action:'none'|'moved'|'kicked', pos} (pos: where the server puts the player, the rollback for 'moved').
 noteMoved(pos,time){
  const ev={time,pos:[...pos],add:0};
  if(this.prev.time>0){
   if(this.ignoreSeconds>0){if(time>this.prev.time)this.ignoreSeconds-=time-this.prev.time;}
   else{
    const dt=time-this.prev.time;
    if(dt>0){const d=Math.sqrt(sq(pos,this.prev.pos)),speed=d/dt,limit=pos[1]-this.prev.pos[1]<0?100:20;
     if(speed>limit){const add=Math.trunc(speed);this.violation+=add;ev.add+=add;ev.speed=speed;ev.dt=dt;ev.distance=d;}}
    const hit=this.trace(this.prev.pos,pos);
    if(hit){this.violation+=100;ev.add+=100;ev.blocked=hit;
     let a=this.prev.pos;
     if(this.punish){
      // Rollback: newest snapshot the player can be put back to (>= 0.5 m from the new point), at its own time.
      if(!moved(a,pos)&&this.snapshots.length>0){do{a=this.snapshots.at(-1).pos;}while(!moved(a,pos)&&this.rollback());this.prev={...this.snapshots.at(-1)};}
     }
     ev.rollback=[...a];ev.violation=this.violation;this.events.push(ev);this.peak=Math.max(this.peak,this.violation);
     return {action:'moved',pos:a};}
   }
  }
  this.prev={pos:[...pos],time};this.record();
  if(this.violation>0){this.violation--;
   if(this.punish&&this.violation>this.threshold){ev.violation=this.violation;ev.kick=true;this.events.push(ev);this.kicked={time,violation:this.violation};this.peak=Math.max(this.peak,this.violation);return {action:'kicked',pos};}}
  if(ev.add){ev.violation=this.violation;this.events.push(ev);}
  this.peak=Math.max(this.peak,this.violation);
  return {action:'none',pos};
 }
 rollback(){if(this.snapshots.length>1){this.snapshots.pop();return true;}return false;}
 record(){
  if(!this.snapshots.length){this.snapshots.push({...this.prev});return;}
  const last=this.snapshots.at(-1).pos;
  if(this.snapshots.length<16){if(same(this.prev.pos,last))return;}
  else{if(!moved(this.prev.pos,last))return;this.snapshots.shift();}
  this.snapshots.push({...this.prev});
 }
}

// TruthDetector's trace against a LineOfSight (bridge/line-of-sight.mjs): the segment old + 0.5 m -> new + 0.5 m on
// the TruthDetector mask, without the eye/target margins the sight checks use. Only hits within the segment count.
// The heightfield (layer 19) is sampled every 2 cm here (LineOfSight samples every 2 m, a whole move) with no slack: the
// recovered heightmap is Unity's own surface (sample / 32766 * 1500, cells split along the (x,z)-(x+1,z+1) diagonal,
// browser/terrain.mjs), on which every terrain tree sits to 0.1 mm. In the 2026-10-23 real runs the 31 blocked moves
// dip 1.4 mm to 0.24 m into it and the 5,406 accepted ones clear it by at least 9 mm (GAP-AUDIT T4).
const TERRAIN=1<<19;
export function losTrace(los,mask,{terrainStep=0.02,terrainSlack=0}={}){
 return (o,n)=>{if(sq(o,n)<1e-8)return null;const a=[o[0],o[1]+0.5,o[2]],b=[n[0],n[1]+0.5,n[2]];
  const h=los.blocked(a,b,{mask:mask&~TERRAIN,startMargin:0,endMargin:0});if(h)return {what:h.what,distance:h.distance,at:h.at};
  if((mask&TERRAIN)&&los.ground){const len=Math.sqrt(sq(a,b)),steps=Math.max(1,Math.ceil(len/terrainStep));
   for(let i=1;i<=steps;i++){const f=i/steps,x=a[0]+(b[0]-a[0])*f,y=a[1]+(b[1]-a[1])*f,z=a[2]+(b[2]-a[2])*f,g=los.ground(x,-z);
    if(Number.isFinite(g)&&y<g-terrainSlack)return {what:'terrain',distance:Math.round(len*f*100)/100,at:[x,y,z].map(v=>Math.round(v*100)/100)};}}
  return null;};
}

// Replays moves [{t (s), origin:[x,y,z] Unity, spawn?:true}] (a spawn = NoteTeleported before the move). Server
// corrections are applied by the caller's stream already (the next move starts from where the client was put).
export function replayMoves(moves,{trace,threshold}={}){
 const td=new TruthDetector({trace,threshold});let first=true;
 for(const m of moves){if(first||m.spawn){td.noteTeleported(m.origin);first=false;}const r=td.noteMoved(m.origin,m.t);if(r.action==='kicked')break;}
 return {violation:td.violation,peak:td.peak,kicked:td.kicked,events:td.events};
}
