// AnimationBlender (ViewModel.idleMixer): a residual idle frame plus idle channels (idle, move, crouch, bow, fall, slip,
// zoom) blended under the one-shot clips (deploy, fire, reload). Only VM-Revolver defines one in the shipped data.
// LegacyAnimation stands in for Unity's legacy Animation component: per-state enabled/weight/time/speed/layer, and
// the per-frame weights it would sample with (higher layers first, the rest to lower layers, then normalised).
import {evaluateCurve} from './motor.mjs';

// AnimationBlender.CurveInfo
export function curveInfo(curve){const keys=curve?.m_Curve??[],length=keys.length;
 if(!length)return {curve,length,start:0,firstTime:0,end:0,lastTime:0,duration:0,percentRate:Infinity};
 const firstTime=keys[0].time;let end=length!==1?keys[length-1].time:firstTime,lastTime=end,start=firstTime<0?firstTime:0;
 if(end<start){end=start;start=lastTime;}const duration=end-start;return {curve,length,start,firstTime,end,lastTime,duration,percentRate:1/duration};}
const timeToPercent=(info,time)=>(time-info.start)/info.duration;
const sampleTime=(info,time)=>info.length?evaluateCurve(info.curve,time):0;

const freshState=()=>({active:false,time:0,percent:0,delay:0,value:0});
const freshInfluence=()=>({active:false,value:0,percent:0,timeleft:0,duration:0});

// AnimationBlender.Channel: induce (in curve) / reduce (out curve) transitions with delays and influence carry-over.
export class Channel {
 constructor(index,animationIndex,name,field){
  this.field=field;this.name=name;this.active=false;this.valid=animationIndex!==-1;this.wasActive=false;this.startedTransition=false;
  this.induce={info:curveInfo(field.inCurve),state:freshState(),influence:freshInfluence(),delayDuration:field.inDelay??0,induces:true};
  this.reduce={info:curveInfo(field.outCurve),state:freshState(),influence:freshInfluence(),delayDuration:field.outDelay??0,induces:false};
  this.index=index;this.animationIndex=animationIndex;const rb=field.residualBlend??0;this.maxBlend=rb<=0?1:rb>=1?0:1-rb;
  this.playbackRate=field.playbackRate??1;this.startTime=field.startFrame??0;
 }
 startTransition(from,to,dt,startNow){
  if(to.state.delay===0&&startNow)to.state.delay=to.delayDuration;
  if(to.state.delay>dt.v){to.state.delay-=dt.v;return false;}
  dt.v-=to.state.delay;to.state.delay=0;to.influence.percent=0;to.influence.duration=from.state.percent*to.info.duration;to.influence.value=from.state.value;
  to.influence.active=from.state.percent>0;to.influence.timeleft=to.influence.duration;from.state.delay=to.delayDuration;from.state.active=false;to.state.active=true;
  if(to.induces){from.state.time=from.info.start;from.state.percent=0;}
  return true;
 }
 step(transitioning,from,to,dt){
  if(transitioning&&to.state.delay>0)return from.state.value;
  let num=dt.v,num2=dt.v;
  if(to.induces){to.state.time+=dt.v;if(to.state.time>=to.info.end){num=to.state.time-to.info.end;to.state.time=to.info.end;to.state.percent=1;from.state.delay=from.delayDuration;}
   else{num=0;to.state.percent=timeToPercent(to.info,to.state.time);}}
  else if(to.influence.duration===0){num=dt.v;to.state.percent=1;to.state.time=to.info.end;}
  else{const rate=from.info.duration/to.influence.duration;to.state.time+=dt.v*rate;
   if(to.state.time>=to.info.end){num=(to.state.time-to.info.end)/rate;to.state.percent=1;to.state.time=to.info.end;}
   else{num=0;to.state.percent=timeToPercent(to.info,to.state.time);}}
  const sampled=sampleTime(to.info,to.state.time);
  if(to.influence.active){
   if(to.induces){if(to.influence.timeleft>dt.v){to.influence.timeleft-=dt.v;num2=0;to.influence.percent=to.influence.timeleft/to.influence.duration;}
    else{num2=dt.v-to.influence.timeleft;to.influence.timeleft=0;to.influence.percent=0;to.influence.active=false;}}
   else if(to.state.percent>=1&&to.influence.active){to.influence.active=false;from.state=freshState();}
  }
  to.state.value=to.induces?(!to.influence.active?sampled:sampled+(to.influence.value-sampled)*to.influence.percent):to.influence.value*sampled;
  dt.v=num2<num?num2:num;
  return to.state.value;
 }
 update(dtIn){const dt={v:dtIn};let flag=this.active!==this.wasActive;
  if(flag){const startNow=this.startedTransition!==this.active;this.startedTransition=this.active;
   if(!this.active?this.startTransition(this.induce,this.reduce,dt,startNow):this.startTransition(this.reduce,this.induce,dt,startNow)){flag=false;this.wasActive=this.active;}}
  return this.wasActive?this.step(flag,this.reduce,this.induce,dt):this.step(flag,this.induce,this.reduce,dt);}
}

const weightUnit=()=>({raw:0,scaled:0,normalized:0});
// AnimationBlender.WeightOf: zero weights are swapped to the end of `index`; the rest are scaled by the largest and normalised.
export function weightOf(items,index){
 let sum=0,max=0,winner=-1,count=0,i=0,last=index.length-1;
 while(i<=last){let w=items[index[i]].weight.raw;
  if(w<=0){const u=items[index[i]].weight;u.raw=u.scaled=u.normalized=0;const t=index[last];index[last--]=index[i];index[i]=t;continue;}
  count++;const u=items[index[i]].weight;if(w>=1){w=1;u.raw=u.scaled=u.normalized=1;}else{u.scaled=u.raw;u.normalized=1;}
  sum+=w;if(w>max){max=w;winner=i;}i++;}
 let scaled,normalized,any;
 if(winner===-1){scaled=0;normalized=0;any=false;}
 else{any=true;
  if(count===1){scaled=1;normalized=1;const u=items[index[0]].weight;u.scaled=u.normalized=1;}
  else{if(max<1){scaled=0;const r=1/max;for(let j=0;j<count;j++){const u=items[index[j]].weight;scaled+=u.normalized=u.scaled=u.raw*r;}}else scaled=sum;
   if(scaled===1)normalized=1;else{normalized=0;const r=1/scaled;for(let j=0;j<count;j++){const u=items[index[j]].weight;normalized+=u.normalized=u.scaled*r;}}}}
 return {any,result:{count,winner,sum:{raw:sum,scaled,normalized}}};
}

// AnimationBlender.Mixer over a LegacyAnimation.
export class Mixer {
 constructor(animation,residual,channelConfigs){
  this.animation=animation;this.residualField=residual;
  this.hasResidual=Boolean(residual?.clipName&&animation.getClip(residual.clipName));
  this.oneShotBlendIn=this.hasResidual&&residual.introCurve?curveInfo(residual.introCurve):curveInfo(null);this.hasOneShotBlendIn=this.oneShotBlendIn.duration>0;
  this.residualState=this.hasResidual?animation.state(residual.clipName):null;
  this.channelCount=channelConfigs.length;this.channels=[];this.trackers=[];this.nameToChannel=new Map();this.queued=[];
  this.playingOneShot=false;this.oneShotAnimation=null;this.animationBlocking=false;this.oneShotBlendInTime=0;
  for(let i=0;i<this.channelCount;i++){const {name,field}=channelConfigs[i];this.nameToChannel.set(name,i);let num=-1;
   if(field.clipName&&animation.getClip(field.clipName)){const clip=animation.getClip(field.clipName);
    for(;;){if(++num===this.trackers.length){this.trackers.push({weight:weightUnit(),value:{clip,state:animation.state(field.clipName),channels:[],channelWeight:null,playbackRate:0,blendFraction:0,startTime:0,enabled:false,wasEnabled:false}});break;}
     if(this.trackers[num].value.clip===clip)break;}}
   this.channels.push({weight:weightUnit(),value:new Channel(i,num,name,field)});}
  for(let k=0;k<this.channelCount;k++){const a=this.channels[k].value.animationIndex;if(a!==-1)this.trackers[a].value.channels.push(k);}
  this.trackerCount=this.trackers.length;this.blender={trackers:this.trackers.map((_,i)=>i),trackerCount:this.trackerCount,trackerWeight:null};
  if(!this.hasResidual)return;
  if(residual.changeAnimLayer){this.residualState.layer=residual.animLayer;for(const t of this.trackers)t.value.state.layer=residual.animLayer;}
  this.residualState.blendMode=residual.residualBlend;for(const t of this.trackers)t.value.state.blendMode=residual.channelBlend;
 }
 setActive(channel,value){this.channels[typeof channel==='string'?this.nameToChannel.get(channel):channel].value.active=value;}
 setSolo(channel){const c=typeof channel==='string'?this.nameToChannel.get(channel):channel;for(let i=0;i<this.channelCount;i++)this.setActive(i,i===c);}
 setOneShotAnimation(name){const s=name&&this.animation.state(name);if(!s)return false;this.oneShotAnimation=s;return this.playingOneShot=true;}
 // PlayOpt: without a PlayMode, Animation.Stop() first, so the clip always starts over.
 play(name,{speed,startTime}={}){const s=name&&this.animation.state(name);if(!s)return false;this.animation.stop();if(speed!==undefined)s.speed=speed;
  if(!this.animation.play(name))return false;this.queued.length=0;this.playingOneShot=true;this.oneShotAnimation=s;if(startTime!==undefined)s.time=startTime;return true;}
 crossFade(name,{fadeLength=0.3,speed,startTime}={}){const s=name&&this.animation.state(name);if(!s)return false;if(speed!==undefined)s.speed=speed;this.animation.crossFade(name,fadeLength);
  this.queued.length=0;this.playingOneShot=true;this.oneShotAnimation=s;if(startTime!==undefined)s.time=startTime;return true;}
 playQueued(name){if(!name||!this.animation.playQueued(name))return false;for(const t of this.trackers)t.value.state.enabled=false;
  if(this.playingOneShot)this.queued.push(name);else this.setOneShotAnimation(name);return true;}
 manualAnimationsPlaying(clearWhenNone){if(!this.playingOneShot)return false;
  while(!this.oneShotAnimation||!this.oneShotAnimation.enabled){if(!this.queued.length){if(clearWhenNone){this.oneShotAnimation=null;this.playingOneShot=false;}return false;}this.setOneShotAnimation(this.queued.shift());}
  return true;}
 updateChannel(channel,dt){const c=channel.value,blocked=c.field.blockedByAnimation&&this.animationBlocking&&c.active;if(blocked)c.active=false;channel.weight.raw=c.update(dt);if(blocked)c.active=true;}
 updateTracker(tracker,dt){const t=tracker.value;for(const i of t.channels)this.updateChannel(this.channels[i],dt);
  const {any,result}=weightOf(this.channels,t.channels);t.channelWeight=result;
  if(t.enabled=any){t.startTime=this.channels[t.channels[result.winner]].value.startTime;let rate=0,blend=0;
   for(let j=0;j<result.count;j++){const c=this.channels[t.channels[j]],n=c.weight.normalized;rate+=c.value.playbackRate*n;blend+=c.value.maxBlend*n;}
   t.playbackRate=rate;t.blendFraction=blend;}
  tracker.weight.raw=result.sum.raw;}
 disableTracker(t){if(t.wasEnabled){t.state.enabled=t.wasEnabled=false;t.state.weight=0;}}
 bindTracker(tracker,externalBlend){let num=tracker.weight.normalized;if(this.hasResidual)num*=tracker.value.blendFraction;if(this.blender.trackerWeight.sum.raw<1)num*=this.blender.trackerWeight.sum.raw;
  const t=tracker.value;if(num>0){if(!t.wasEnabled){t.state.enabled=t.wasEnabled=true;t.state.time=t.startTime;}t.state.weight=num*externalBlend;t.state.speed=t.playbackRate;}
  else if(t.wasEnabled)this.disableTracker(t);return num;}
 updateBlender(dt,externalBlend){const b=this.blender;for(let i=0;i<this.trackerCount;i++)this.updateTracker(this.trackers[b.trackers[i]],dt);
  b.trackerWeight=weightOf(this.trackers,b.trackers).result;
  for(let j=b.trackerWeight.count;j<b.trackerCount;j++)this.disableTracker(this.trackers[b.trackers[j]].value);
  let sum=0;for(let k=0;k<b.trackerWeight.count;k++)sum+=this.bindTracker(this.trackers[b.trackers[k]],externalBlend);
  const residualBlend=(1-sum)*externalBlend;return {any:residualBlend>0,residualBlend};}
 // Mixer.Update(blend, dt): ViewModel.Update calls it with blend 1 every frame.
 update(blend,dt){const intro=this.oneShotBlendIn;
  if(this.playingOneShot){
   if(!this.manualAnimationsPlaying(true)){this.oneShotBlendInTime=intro.start+dt;if(this.oneShotBlendInTime>intro.end)this.oneShotBlendInTime=intro.end;this.animationBlocking=false;for(const t of this.trackers)t.value.wasEnabled=false;}
   else{this.oneShotBlendInTime=intro.start;if(!this.hasOneShotBlendIn)blend=0;this.animationBlocking=true;}
  }else{this.animationBlocking=false;if(this.oneShotBlendInTime<intro.end&&(this.oneShotBlendInTime+=dt)>intro.end)this.oneShotBlendInTime=intro.end;}
  if(this.hasOneShotBlendIn)blend*=sampleTime(intro,this.oneShotBlendInTime);
  blend=Math.min(1,Math.max(0,blend));
  const {any,residualBlend}=this.updateBlender(dt,blend);
  if(any){if(this.hasResidual){const s=this.residualState,fresh=!s.enabled;s.enabled=true;s.weight=residualBlend;if(fresh){s.time=this.residualField.startFrame;s.speed=this.residualField.playbackRate;}}}
  else if(this.hasResidual&&this.residualState.enabled){this.residualState.enabled=false;this.residualState.weight=0;}
 }
}

// Unity legacy Animation component: states advance by speed; Default/Once clips stop (and rewind) at their end, Loop and
// PingPong wrap, ClampForever holds. Play stops the state's layer and starts it at weight 1; Stop rewinds everything.
export class LegacyAnimation {
 constructor(clips){this.states=new Map();for(const {name,length,wrapMode} of clips)this.states.set(name,{name,length,wrapMode,layer:0,blendMode:0,enabled:false,weight:0,time:0,speed:1,fade:null});this.queue=[];}
 getClip(name){return this.states.has(name);}
 state(name){return this.states.get(name)??null;}
 stopState(s){s.enabled=false;s.time=0;s.weight=0;s.fade=null;}
 stop(){for(const s of this.states.values())this.stopState(s);this.queue.length=0;}
 play(name){const s=this.states.get(name);if(!s)return false;for(const o of this.states.values())if(o!==s&&o.layer===s.layer)this.stopState(o);if(!s.enabled)s.time=0;s.enabled=true;s.weight=1;s.fade=null;return true;}
 crossFade(name,fadeLength=0.3){const s=this.states.get(name);if(!s)return false;if(!s.enabled){s.enabled=true;s.weight=0;s.time=0;}
  for(const o of this.states.values())if(o.layer===s.layer&&o.enabled)o.fade={target:o===s?1:0,rate:1/Math.max(fadeLength,1e-6)};return true;}
 playQueued(name){const s=this.states.get(name);if(!s)return false;this.queue.push(name);return true;}
 // Advance one frame; returns each enabled state's sample time and the weight Unity would apply.
 advance(dt){const samples=[];
  for(const s of this.states.values()){if(!s.enabled)continue;
   if(s.fade){s.weight+=Math.sign(s.fade.target-s.weight)*s.fade.rate*dt;if((s.fade.target===1&&s.weight>=1)||(s.fade.target===0&&s.weight<=0)){s.weight=s.fade.target;const out=s.fade.target===0;s.fade=null;if(out){this.stopState(s);continue;}}}
   s.time+=s.speed*dt;const L=s.length||1e-6;let t=s.time,ended=false;
   if(s.wrapMode===2)t=((t%L)+L)%L;else if(s.wrapMode===4){const c=((t%(2*L))+2*L)%(2*L);t=c>L?2*L-c:c;}
   else if(s.wrapMode===8)t=Math.min(Math.max(t,0),L);else if(t>=L||t<0){t=Math.min(Math.max(t,0),L);ended=true;}
   samples.push({state:s,time:t,ended});}
  // Weights: higher layers first; each layer's sum capped at 1 and at what is left; a total under 1 is normalised.
  const layers=[...new Set(samples.map(x=>x.state.layer))].sort((a,b)=>b-a);let remaining=1;
  for(const layer of layers){const inLayer=samples.filter(x=>x.state.layer===layer),sum=inLayer.reduce((a,x)=>a+Math.max(0,x.state.weight),0);
   if(sum<=0||remaining<=0){for(const x of inLayer)x.weight=0;continue;}const capped=Math.min(sum,1),take=Math.min(capped,remaining),scale=take/sum;
   for(const x of inLayer)x.weight=Math.max(0,x.state.weight)*scale;remaining-=take;}
  const total=1-remaining;if(total>0&&total<1)for(const x of samples)x.weight/=total;
  for(const x of samples)if(x.ended){this.stopState(x.state);if(this.queue.length)this.play(this.queue.shift());}
  return samples;}
}

// ViewModel.LateUpdate: which idle channel is solo (indices as ViewModel defines them); a still player looking around
// faster than 2 degrees a second drops the idle channel. Returns the new last-look angles.
export function idleSolo(mixer,flags,look,lastLook,dt){
 let speed=0;if(look[0]!==lastLook[0]||look[1]!==lastLook[1]){const d=(a,b)=>{let x=((b-a)%360+360)%360;if(x>180)x-=360;return Math.abs(x);};speed=Math.hypot(d(lastLook[0],look[0]),d(lastLook[1],look[1]))/dt;lastLook=look.slice();}
 if(!flags.grounded)mixer.setSolo(6);else if(flags.slipping)mixer.setSolo(7);else if(flags.aim)mixer.setSolo(8);
 else if(flags.bow)mixer.setSolo(flags.movement?5:4);else if(flags.crouch)mixer.setSolo(flags.movement?3:2);else if(flags.movement)mixer.setSolo(1);
 else{mixer.setSolo(0);if(speed<-2||speed>2)mixer.setActive(0,false);}
 return lastLook;
}
