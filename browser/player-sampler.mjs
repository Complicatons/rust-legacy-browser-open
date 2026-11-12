import {STATE} from './net-client.mjs';
import {playerLayers} from './player-layers.mjs';

// Stateful part of Facepunch.Movement.Sampler.UpdateWeights and PlayerAnimation.Update.
// Legacy layer weights are resolved separately by playerLayers.
const referenceKeys=new Set(['movement','jump','aim','crouch','stand','sprint','idle','north','east','south','west','up','down','upperBody','moving','fall','attack','reload','readyAttack']);
const inherit=(list,index,key)=>{
 const m=list[index];if(!m)return null;const v=m[key],reference=referenceKeys.has(key);
 if(reference&&v===-2)return null;
 return (v==null||reference&&v===-1)&&m.parent>=0?inherit(list,m.parent,key):v;
};
const rate=seconds=>seconds===0?Infinity:1/Math.abs(seconds??0.2);
const step=(value,target,dt,duration)=>dt===0?value:value+Math.sign(target-value)*Math.min(Math.abs(target-value),dt*rate(duration));
const repeat=x=>((x%1)+1)%1;
const events={attack:'attack',reload:'reload',readyAttack:'readyAttack'};
// Facepunch.Precision.Precise.MoveTowardsAngle: [angle, clamped]; an exact half turn takes the positive branch.
export function moveTowardsAngle(current,target,maxDelta){const t=target-current,r=t-Math.floor(t/360)*360;
 if(r>180)return r-360< -maxDelta?[current-maxDelta,true]:[target,false];
 return r>maxDelta?[current+maxDelta,true]:[target,false];}
// GroupConfiguration attack/reload/readyAttack names (GroupMatrix props 8..10), inherited through parents.
export function groupEventClip(config,group,event){const key=events[event];if(!key)throw Error('Unknown group event '+event);
 const index=typeof group==='number'?group:Math.max(0,config.groupMatrices.findIndex(g=>g.name===group)),clip=inherit(config.groupMatrices,index,key);
 return clip!=null&&clip>=0?config.animationNames[clip]??null:null;}

export class PlayerSampler{
 constructor(config){
  this.config=config;this.moveWeight=0;this.jumpWeight=0;this.wasJumping=false;this.jumpStart=0;this.phase=0;this.unitScale=0;this.heading={north:0,east:0,south:0,west:0};this.angle=0;this.lastAngleSpeed=0;this.aimAllow=0;this.localVelocity=[0,0];this.group=0;
  this.groups=config.groupMatrices.map((g,index)=>({name:g.name,index,weight:0,states:['stand','crouch','sprint'].map(key=>({key,index:inherit(config.groupMatrices,index,key)??0,weight:0}))}));
 }
 update(input={},dt=0,time=0){
  const c=this.config,{x=0,z=0,flags=0,pitch=0,group='noitem'}=input;
  dt=Number.isFinite(dt)?Math.max(0,dt):0;
  const speed=Math.hypot(x,z),airborne=Boolean(flags&STATE.airborne),slipping=Boolean(flags&STATE.slipping);
  const state=airborne?'stand':flags&STATE.crouch?'crouch':flags&STATE.sprint&&speed>=c.runSpeed?'sprint':'stand';
  const target=this.groups.find(g=>g.name===group)??this.groups[0];
  // PlayerAnimation.CalculateVelocity divides the PREVIOUS frame's localVelocity field by this frame's speed:
  // the heading lags one frame and is not unit length unless the turn cap clamps it (then sin/cos of the angle).
  let nx=0,nz=0;
  if(speed>=c.minMoveSpeed){
   const [px,pz]=this.localVelocity;nx=px/speed;nz=pz/speed;
   const current=this.angle;this.angle=Math.atan2(nx,nz)*180/Math.PI;
   if(c.maxTurnSpeed>0&&this.angle!==current&&this.lastAngleSpeed>=0.05){
    const [angle,clamped]=moveTowardsAngle(current,this.angle,dt*c.maxTurnSpeed);this.angle=angle;
    if(clamped){const r=angle*Math.PI/180;nx=Math.sin(r);nz=Math.cos(r);}
   }
   this.lastAngleSpeed=speed;
  }else if(this.lastAngleSpeed>0&&c.maxTimeBetweenTurns>0)this.lastAngleSpeed-=dt/c.maxTimeBetweenTurns;
  this.localVelocity=[x,z];
  // PlayerAnimation.Update: a zero movement normal reuses lastHeadingWeights.
  if(nx!==0||nz!==0)this.heading={north:Math.max(0,nz),east:Math.max(0,nx),south:Math.max(0,-nz),west:Math.max(0,-nx)};
  if(!slipping){
   // Sampler.group only changes outside slipping; GetGroupEvent reads the group of the last such update.
   this.group=target.index;
   this.moveWeight=step(this.moveWeight,flags&STATE.movement?1:0,dt,flags&STATE.movement?c.moveFadeInDuration:c.moveFadeOutDuration);
   this.jumpWeight=step(this.jumpWeight,airborne?1:0,dt,airborne?c.jumpFadeInDuration:c.jumpFadeOutDuration);
   if(airborne&&!this.wasJumping)this.jumpStart=time;
   this.wasJumping=airborne;
   for(const g of this.groups){
    // Shipped GroupConfiguration overwrites apply/reduce rates with upper durations.
    const active=g===target,key=active?'upperApplyDuration':'upperReduceDuration';
    g.weight=step(g.weight,active?1:0,dt,inherit(c.groupMatrices,g.index,key)??0.2);
    for(const s of g.states){const selected=s.key===state;
     s.weight=step(s.weight,selected?1:0,dt,inherit(c.stateMatrices,s.index,selected?'applyDuration':'reduceDuration')??0.2);
    }
   }
   const groupSum=this.groups.reduce((a,g)=>a+g.weight,0);let unit=0;
   for(const g of this.groups){const sum=g.states.reduce((a,s)=>a+s.weight,0);
    g.normalized=groupSum?g.weight/groupSum:0;
    for(const s of g.states){s.normalized=groupSum&&sum?g.weight/groupSum*s.weight/sum:0;
     const movement=inherit(c.stateMatrices,s.index,'movement');
     unit+=(inherit(c.movementMatrices,movement,'northUnits')??2)*s.normalized;
    }
   }
   this.unitScale=unit>0?(1-this.jumpWeight)/unit:0;
  }
  if(Number.isFinite(speed)&&speed>=c.minMoveSpeed)this.phase=repeat(this.phase+Math.abs(this.unitScale*speed*dt));
  const slots=new Map();
  const add=plan=>{if(!plan.name||!(plan.weight>0))return;const key=(plan.additive?'+':'')+plan.name;if(!slots.has(key))slots.set(key,[]);slots.get(key).push(plan);};
  const h=this.heading,length=Math.hypot(h.north,h.east,h.south,h.west),idle=length?(1-this.moveWeight)/length:1;
  for(const g of this.groups){
   let aimStateSum=0,upperStateSum=0;
   for(const s of g.states){const index=inherit(c.stateMatrices,s.index,'aim');s.aimIndex=index;
    if(index!=null&&index>=0){aimStateSum+=s.weight;if(inherit(c.aimMatrices,index,'upperBody')!=null)upperStateSum+=s.weight;}
   }
   // The shipped sampler never resets sumUpperBodyWeight. Preserve that accumulator;
   // role normalisation below prevents it scaling down a single active hold over time.
   if(!slipping)g.sumUpper=(g.sumUpper??0)+upperStateSum;
   if(g===target&&aimStateSum>0&&!slipping)this.aimAllow=Math.max(this.aimAllow,g.weight);
   for(const s of g.states){
    const weight=s.normalized??0;if(!weight)continue;
    const movement=inherit(c.stateMatrices,s.index,'movement')??0,jump=inherit(c.stateMatrices,s.index,'jump')??0;
    add({name:c.animationNames[inherit(c.movementMatrices,movement,'idle')],role:'idle',weight:idle*weight*(1-this.jumpWeight),rate:1});
    for(const direction of ['north','east','south','west']){
     const offset=c[direction+'Offset']??0;
     const normalizedTime=offset<0?repeat(1-(this.phase-offset)+10):repeat(this.phase+offset);
     add({name:c.animationNames[inherit(c.movementMatrices,movement,direction)],role:direction,weight:h[direction]*this.moveWeight*weight,normalizedTime});
    }
    const jumpTime=Math.max(0,time-this.jumpStart)*c.jumpTimeScale;
    add({name:c.animationNames[inherit(c.jumpMatrices,jump,'idle')],role:'idleJump',weight:idle*weight*this.jumpWeight,time:jumpTime,clamp:true});
    add({name:c.animationNames[inherit(c.jumpMatrices,jump,'moving')],role:'movingJump',weight:length*this.moveWeight*weight*this.jumpWeight,time:jumpTime,clamp:true});
    if(s.aimIndex==null||s.aimIndex<0)continue;
    const a=key=>inherit(c.aimMatrices,s.aimIndex,key),angle=(a('offsetDegrees')??0)-pitch*180/Math.PI;
    if(angle&&aimStateSum){const up=angle<0,limit=a(up?'upDegrees':'downDegrees')??90;
     add({name:c.animationNames[a(up?'up':'down')],role:up?'up':'down',weight:g.normalized*s.weight/aimStateSum,additive:true,normalizedTime:limit===0?1:Math.min(1,Math.abs(angle)/limit)});
    }
    const hold=a('upperBody');if(hold!=null&&hold>=0&&g.sumUpper)add({name:c.animationNames[hold],role:'upper',weight:g.normalized*s.weight/g.sumUpper,additive:true,normalizedTime:a('upperBodyNormalizedTime')??1});
   }
  }
  // One AnimationState may occupy several roles. The strongest slot chooses the
  // role/time; only other slots of that same role contribute to its total weight.
  const samples=[...slots.values()].map(list=>{const winner=list.reduce((a,b)=>b.weight>=a.weight?b:a);return {...winner,weight:list.filter(p=>p.role===winner.role).reduce((sum,p)=>sum+p.weight,0)};});
  return playerLayers(samples,this.aimAllow);
 }
 // Sampler.GetGroupEvent -> GroupContext.GetEvent for Attack/Reload/ReadyAttack of the sampler's current group.
 // GroupContext also resolves `fall` (falling back to the walk idle) but no shipped code ever plays it.
 groupEvent(event){return groupEventClip(this.config,this.group,event);}
 fallClip(){const c=this.config,i=inherit(c.groupMatrices,this.group,'fall');if(i!=null&&i>=0)return c.animationNames[i];
  const stand=inherit(c.groupMatrices,this.group,'stand')??0,movement=inherit(c.stateMatrices,stand,'movement')??0,idle=inherit(c.movementMatrices,movement,'idle');return idle!=null&&idle>=0?c.animationNames[idle]:null;}
 debug(){return {group:this.config.groupMatrices[this.group]?.name,fall:this.fallClip(),phase:this.phase,angle:this.angle,aimAllow:this.aimAllow,moveWeight:this.moveWeight,jumpWeight:this.jumpWeight,groups:this.groups.filter(g=>g.weight>0).map(g=>({name:g.name,weight:g.weight,states:g.states.filter(s=>s.weight>0).map(s=>({state:s.key,weight:s.weight,normalized:s.normalized}))}))};}
}
