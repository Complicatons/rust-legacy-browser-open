// Unarmed PlayerAnimation locomotion: original movement matrices, distance-based clip timing and state flags.
import {STATE} from './net-client.mjs';
const member=(list,index,key)=>{const m=list[index];if(!m)return null;const v=m[key];if(v===-2)return null;return (v==null||v===-1)&&m.parent>=0?member(list,m.parent,key):v;};
function stateIndex(config,{x=0,z=0,flags=0,group='noitem'}={}){const crouch=Boolean(flags&STATE.crouch),run=!crouch&&Boolean(flags&STATE.sprint)&&Math.hypot(x,z)>=config.runSpeed,g=Math.max(0,config.groupMatrices.findIndex(g=>g.name===group));return member(config.groupMatrices,g,run?'sprint':crouch?'crouch':'stand')??0;}
export function playerMotion(config,{x=0,z=0,flags=0,group='noitem'}={}){
 const speed=Math.hypot(x,z),names=config.animationNames;
 if(flags&STATE.airborne){const j=config.jumpMatrices[0],i=speed>=config.minMoveSpeed?j.moving:j.idle;return [{name:names[i],weight:1,rate:config.jumpTimeScale}];}
 const state=stateIndex(config,{x,z,flags,group}),index=member(config.stateMatrices,state,'movement')??0;
 const inherited=(i,key)=>{const m=config.movementMatrices[i],v=m[key];return (v==null||v===-1)&&m.parent>=0?inherited(m.parent,key):v;};
 if(speed<config.minMoveSpeed||!(flags&STATE.movement))return [{name:names[inherited(index,'idle')],weight:1,rate:1}];
 const total=Math.abs(x)+Math.abs(z),out=[];
 for(const [heading,n] of [['north',Math.max(0,z)],['south',Math.max(0,-z)],['east',Math.max(0,x)],['west',Math.max(0,-x)]]){
  if(n===0)continue;const i=inherited(index,heading),units=inherited(index,heading+'Units');
  if(i>=0)out.push({name:names[i],weight:n/total,rate:speed/units,offset:config[heading+'Offset']??0,distanceTimed:true});
 }
 return out;
}

// StateConfiguration.GetAimTimeWeight: upper hold and pitch samples are separate ADDITIVE channels.
// The returned time samples their original clips; they must never advance as ordinary looping locomotion.
export function playerAim(config,{x=0,z=0,flags=0,group='noitem',pitch=0}={}){
 const state=stateIndex(config,{x,z,flags,group}),index=member(config.stateMatrices,state,'aim');if(index==null||index<0)return [];
 const a=key=>member(config.aimMatrices,index,key),out=[],upper=a('upperBody'),names=config.animationNames;
 if(upper!=null&&upper>=0)out.push({name:names[upper],weight:1,additive:true,normalizedTime:a('upperBodyNormalizedTime')??1});
 const angle=(a('offsetDegrees')??0)-pitch*180/Math.PI;
 if(angle){const up=angle<0,i=a(up?'up':'down'),limit=a(up?'upDegrees':'downDegrees')??90;if(i!=null&&i>=0)out.push({name:names[i],weight:1,additive:true,normalizedTime:limit===0?1:Math.min(1,Math.abs(angle)/limit)});}
 return out;
}
export function playerGroupEvent(config,group,event){const i=Math.max(0,config.groupMatrices.findIndex(g=>g.name===group)),clip=member(config.groupMatrices,i,event);return clip!=null&&clip>=0?config.animationNames[clip]:null;}

// CharacterStateInterpolator (HumanInterpolator trait: allowExtrapolation 0, allowableTimeSpan 0.1, capacity 32):
// CharacterInterpolatorBase.Push keeps the buffer sorted by server timestamp (equal stamps replace, a full buffer drops
// the oldest); Sample walks newest -> oldest: after the newest it holds the newest, before the oldest the oldest. Between
// two samples the gap is capped at allowableTimeSpan + NetCull.sendInterval: past the cap the older sample is held until
// (newer - cap). Angles: yaw += DeltaAngle * t, pitch = DeltaAngle(0, ...) (radians here); state flags: the older sample's
// with the newer's crouch/sprint/movement bits (0x43) added, airborne if the two disagree on grounded.
// SampleWorldVelocity (same cap) gives `velocity`; zero outside a bracket.
export const HUMAN_INTERPOLATOR=Object.freeze({capacity:32,allowableTimeSpan:0.1});
export function pushSnapshot(snapshots,s,capacity=HUMAN_INTERPOLATOR.capacity){
 for(let i=snapshots.length-1;i>=0;i--){if(snapshots[i].time===s.time){snapshots[i]=s;return;}if(snapshots[i].time<s.time){snapshots.splice(i+1,0,s);if(snapshots.length>capacity)snapshots.shift();return;}}
 if(snapshots.length<capacity)snapshots.unshift(s);}
const TAU=Math.PI*2,deltaAngle=(a,b)=>{let d=((b-a)%TAU+TAU)%TAU;if(d>Math.PI)d-=TAU;return d;};
export function samplePlayer(snapshots,time,{allowableTimeSpan=HUMAN_INTERPOLATOR.allowableTimeSpan,sendInterval=0.2}={}){
 const n=snapshots.length,zero=[0,0,0];if(!n)return null;if(n===1)return {...snapshots[0],velocity:zero};
 const cap=allowableTimeSpan+sendInterval;
 for(let i=n-1;i>=0;i--){const a=snapshots[i];
  if(a.time>time)continue;
  if(a.time===time||i===n-1)return {...a,velocity:zero};
  const b=snapshots[i+1];let start=a.time,gap=b.time-a.time;
  if(gap>cap){start=b.time-(gap=cap);if(start>=time)return {...a,velocity:zero};}
  const k=(time-start)/gap,flags=(a.flags&~0x10)|((a.flags|b.flags)&0x10)|(b.flags&0x43)|((a.flags^b.flags)&0x10?0x10:0);
  const pitchA=a.pitch??0,pitch=deltaAngle(0,pitchA+deltaAngle(pitchA,b.pitch??0)*k);
  return {...a,position:a.position.map((v,j)=>v+(b.position[j]-v)*k),yaw:a.yaw+deltaAngle(a.yaw,b.yaw)*k,pitch,flags:k>=1?b.flags:k<=0?a.flags:flags,
   velocity:a.position.map((v,j)=>(b.position[j]-v)/gap)};}
 return {...snapshots[0],velocity:zero};}

// A remote character's interpolator input. HumanController.uLink_OnNetworkInstantiate starts the proxy's
// CharacterStateInterpolator EMPTY: the Create only places the transform, and Sample returns false (the transform stays
// put) until the first goal, which only HumanController.ReadClientMove -> UpdateStateNew sets. So the Create's position
// is never interpolated toward. That matters on the original server: uLink keeps a view's Instantiate as it was sent at
// spawn (O1629.O3135 only rewrites its group bytes), and a player who meets the character later (a NetCull cell change
// brings it into one of their groups: BufferedRPCs + Create) gets the position it SPAWNED at, possibly far away.
// `goal`: false for a Create (rest pose only, kept while no goal exists), true for a ReadClientMove.
// HumanController.UpdateStateNew (~815-825): the FIRST ReadClientMove after the instantiate (firstState) is not a goal
// either: it sets character.origin / eyesAngles / stateFlags directly and returns before SetGoals, so it only moves the
// rest pose; the second one is the interpolator's first goal. `v.firstStateDone` is per view (a new Create builds a new
// view: firstState starts true again).
export function placeRemote(v,{position,yaw=0,pitch=0,flags=0},time,{goal=true}={}){
 const s={time,position:[...position],yaw,pitch,flags};
 if(!goal){if(!v.snapshots.length)v.rest=s;return false;}
 if(!v.firstStateDone){v.firstStateDone=true;if(!v.snapshots.length){v.rest=s;return false;}}
 pushSnapshot(v.snapshots,s);return true;}
// CharacterStateInterpolator.Sample, or the instantiate pose while the buffer is empty.
export function sampleRemote(v,time,opts){return samplePlayer(v.snapshots,time,opts)??(v.rest?{...v.rest,velocity:[0,0,0]}:null);}
