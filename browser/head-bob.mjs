import {Vector3,Quaternion,Euler,Matrix4} from 'three';
import {evalCurve} from './particles.mjs';
const axes=['x','y','z'],zero=()=>[0,0,0],clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mod=(v,n)=>(v%n+n)%n,D=Math.PI/180;
// Unity serialized infinity is not the public WrapMode enum: 0 ping-pong, 1 repeat, 2 clamp.
// Cross-check: Orillusion/orillusion src/math/AnimationCurve.ts and enum/WrapTimeMode.ts (deserialize m_PreInfinity).
export function bobCurve(curve,t){const keys=curve?.m_Curve??[];if(keys.length<2)return keys[0]?.value??0;
 const a=keys[0],b=keys.at(-1),duration=b.time-a.time;
 if(duration>0&&(t<a.time||t>b.time)){const mode=t<a.time?curve.m_PreInfinity:curve.m_PostInfinity;
  if(mode===1)t=a.time+mod(t-a.time,duration);
  else if(mode===0){const p=mod(t-a.time,duration*2);t=a.time+(p>duration?duration*2-p:p);}}
 return evalCurve(curve,t);}

// BobForceCurve.Calculate: the phase continues even when sourceMask makes the output zero.
export function bobForce(curve,phase,pow,dt){const mask=curve.sourceMask.m_Curve,scale=curve.sourceScale.m_Curve;
 if(mask.length===1&&mask[0].value===0)return zero();
 const m=mask.length?bobCurve(curve.sourceMask,pow):1,s=scale.length?bobCurve(curve.sourceScale,pow):1;
 return axes.map((axis,i)=>{const c=curve['force'+axis.toUpperCase()],keys=c.m_Curve;if(!keys.length||(keys.length===1&&keys[0].value===0))return 0;
  if(keys.length>1&&s!==0){phase[i]+=pow*dt*s*curve.positionScale[axis];const duration=(keys.at(-1).time-keys[0].time)*8;
   if(phase[i]>duration)phase[i]-=duration;else if(phase[i]<-duration)phase[i]+=duration;}
  return m===0?0:bobCurve(c,phase[i])*curve.outputScale[axis]*m;});}

// Vector3G.SmoothDamp uses a magnitude limit, not independent component limits.
export function bobSmooth(current,target,velocity,smooth,max,dt){if(smooth<=0)return [...target];
 const omega=2/Math.max(0.0001,smooth),x=omega*dt,exp=1/(1+x+0.48*x*x+0.235*x*x*x),change=current.map((v,i)=>v-target[i]);
 const length=Math.hypot(...change),limit=max*smooth;if(length>limit)for(let i=0;i<3;i++)change[i]*=limit/length;
 const next=current.map((v,i)=>{const temp=(velocity[i]+omega*change[i])*dt;velocity[i]=(velocity[i]-omega*temp)*exp;return v-change[i]+(change[i]+temp)*exp;});
 if(target.reduce((sum,v,i)=>sum+(v-current[i])*(next[i]-v),0)>0){velocity.fill(0);return [...target];}return next;}
const element=()=>({value:zero(),velocity:zero(),force:zero(),impulse:zero(),impulseVelocity:zero()});
// BobPunchEffect deliberately compares the time against endValue (not endTime) in the shipped source.
export class BobPunch {
 constructor(data){this.curves=['_x','_y','_z','_pitch','_yaw','_roll'].map(k=>data[k]?.m_Curve??[]);this.time=0;
  // InitializeNonSerializedData considers x,z,yaw,pitch,roll; the shipped method omits y.
  this.end=Math.max(0,...[0,2,4,3,5].map(i=>{const keys=this.curves[i];return keys.length>1&&keys.some(k=>k.value!==keys[0].value)?keys.at(-1).time:0;}));}
 step(dt){if(this.time>=this.end)return null;const t=this.time;this.time+=dt;return this.curves.map(keys=>{if(!keys.length)return 0;const first=keys[0],last=keys.at(-1);
   if(keys.every(k=>k.value===first.value)||t<=first.time)return first.value;if(t>=last.value)return last.value;return evalCurve({m_Curve:keys},t);});}
}
class AccelerationSampler {
 constructor(){this.samples=[];this.accel=zero();}
 sample(vector,time){if(this.samples[0]?.time===time)this.samples.shift();this.samples.unshift({vector:[...vector],time});this.samples.length=Math.min(3,this.samples.length);
  const older=this.samples.slice(1).filter(s=>s.time!==time);if(older.length)this.accel=vector.map((v,i)=>older.reduce((sum,s)=>sum+(v-s.vector[i])/(time-s.time),0)/older.length);return this.accel;}
}
// Shipped variant: 100 Hz, simStep=false, intermitRate=0. Reject other configurations rather than silently approximate them.
export class HeadBob {
 constructor(data){if(data.component.simStep||data.config.intermitRate)throw Error('Unsupported HeadBob solver variant');this.data=data;this.cfg=data.config;this.reset();}
 reset(){this.position=element();this.rotation=element();this.phases=this.cfg.additionalCurves.map(zero);this.effects=[];this.effectStarts=0;this.forceSampler=new AccelerationSampler();this.torqueSampler=new AccelerationSampler();this.last=null;this.time=0;this.accumulator=0;this.fraction=0;this.allowValue=0;this.output={position:zero(),rotation:zero()};}
 addEffect(id){const data=this.data.effects?.[id];if(!data)return false;const effect=new BobPunch(data);if(!effect.end)return false;this.effects.push(effect);this.effectStarts++;return true;}
 solve(dt,sources,input){const c=this.cfg,previous=[this.position.force,this.rotation.force];this.position.force=zero();this.rotation.force=zero();
  c.additionalCurves.forEach((curve,i)=>{const f=bobForce(curve,this.phases[i],sources[curve.source]??0,dt),out=curve.target===1?this.rotation.force:this.position.force;f.forEach((v,j)=>out[j]+=v);});
  const punches=[];this.effects=this.effects.filter(effect=>{const values=effect.step(dt);if(!values)return false;punches.push(values);return true;});
  for(const [n,e] of [this.position,this.rotation].entries()){const angular=n===1,scale=angular?c.angularImpulseForceScale:c.impulseForceScale;
   e.impulse=bobSmooth(e.impulse,angular?this.torqueSampler.accel:this.forceSampler.accel,e.impulseVelocity,angular?c.angleImpulseForceSmooth:c.impulseForceSmooth,angular?c.angleImpulseForceMaxChangeAcceleration:c.impulseForceMaxChangeAcceleration,dt);
   axes.forEach((a,i)=>e.force[i]+=e.impulse[i]*scale[a]+(angular?0:input[i]*c.inputForceMultiplier[a]));
   for(const values of punches)axes.forEach((a,i)=>e.force[i]+=values[i+(angular?3:0)]);
   const v=[...e.value];if(!angular){const length=Math.hypot(...v.map((x,i)=>x/c.elipsoidRadii[axes[i]]));if(length>1)v.forEach((x,i)=>v[i]=x/length);}
   axes.forEach((a,i)=>{const spring=angular?c.angularSpringConstant:c.springConstant,damp=angular?c.angularSpringDampen:c.springDampen,mass=angular?c.angularWeightMass:c.weightMass;
    e.velocity[i]+=(e.force[i]-previous[n][i]+(-v[i]*spring[a]-e.velocity[i]*damp[a])*mass)*dt;
    e.value[i]+=(angular?e.velocity[i]:clamp(e.velocity[i],-c.maxVelocity[a],c.maxVelocity[a]))*dt;});}
 }
 // Input is the true browser eye, body yaw, normalized/scaled motor input (body-local Unity space).
 update(dt,{position,quaternion,yaw=0,input=zero(),grounded=false,sliding=false,allow=true,positionScale=1,rotationScale=1}={}){
  if(!Number.isFinite(dt)||dt<=0)return this.output;this.time+=dt;
  const p=[position.x,position.y,-position.z],unityQ=new Quaternion(-quaternion.x,-quaternion.y,quaternion.z,quaternion.w),e=new Euler().setFromQuaternion(unityQ,'YXZ'),angles=[e.x/D,e.y/D,e.z/D];
  let world=zero(),angular=zero();if(this.last){world=p.map((v,i)=>(v-this.last.position[i])/dt);angular=angles.map((v,i)=>(mod(v-this.last.angles[i]+180,360)-180)/dt);}
  const local=new Vector3(...world).applyAxisAngle(new Vector3(0,1,0),yaw).toArray();this.forceSampler.sample(local,this.time);this.torqueSampler.sample(angular,this.time);this.last={position:p,angles};
  const onGround=grounded&&!sliding,ground=onGround?local:zero(),groundWorld=onGround?world:zero(),turn=onGround?angular:zero();
  const sources=[Math.hypot(...ground),...ground,Math.hypot(...groundWorld),...groundWorld,Math.hypot(...local),...local,Math.hypot(...world),...world,Math.hypot(...angular),...angular,Math.hypot(...turn),...turn];
  const c=this.cfg,curve=allow?c.allowCurve:c.forbidCurve,length=curve.m_Curve.length;
  this.fraction=length?clamp(this.fraction+(allow?dt:-dt)/length,0,1):(allow?1:0);
  this.allowValue=this.fraction===0?0:this.fraction===1?1:allow?bobCurve(curve,this.fraction*length):1-bobCurve(curve,(1-this.fraction)*length);
  this.accumulator+=dt;const interval=1/Math.abs(c.solveRate);while(this.accumulator+1e-12>=interval){this.accumulator=Math.max(0,this.accumulator-interval);this.solve(interval*c.timeScale,sources,input);}
  const component=this.data.component;
  const out=(e,deadzone,scalar)=>e.value.map((v,i)=>(v>=-deadzone[axes[i]]&&v<deadzone[axes[i]]?0:v)*this.allowValue*component._globalScalar*scalar);
  this.output={position:out(this.position,c.positionDeadzone,positionScale*component._globalPositionScalar),rotation:out(this.rotation,c.rotationDeadzone,rotationScale*component._globalRotationScalar)};return this.output;
 }
 state(){return {allowValue:this.allowValue,fraction:this.fraction,effects:this.effects.length,effectStarts:this.effectStarts,...structuredClone(this.output)};}
}

const selectAxes=(v,bits)=>[v[(bits&3)===2?1:(bits&3)===3?2:0],v[((bits>>2)&3)===1?0:((bits>>2)&3)===3?2:1],v[((bits>>4)&3)===1?0:((bits>>4)&3)===2?1:2]];
// CameraFX.PostPreCull cancels the camera's local offset on "Eye Camera Difference".
// BobAntiOutput.Add writes the view-model transform, so the result is T(-p)*R(-r)*T(antiP)*R(antiR).
export function bobViewMatrix(output,antiOutputs){const p=new Vector3(...output.position),q=new Quaternion().setFromEuler(new Euler(...output.rotation.map(v=>v*D),'YXZ'));
 const m=new Matrix4().compose(p.clone().negate(),q.clone().invert(),new Vector3(1,1,1));
 // Add iterates backwards and assigns, so index zero supplies the final pose.
 const anti=antiOutputs?.[0];if(anti){const ap=selectAxes(output.position,anti.positionalAxes).map((v,i)=>v*anti.positional[axes[i]]),ar=selectAxes(output.rotation,anti.rotationalAxes).map((v,i)=>v*anti.rotational[axes[i]]*D);
  m.multiply(new Matrix4().compose(new Vector3(...ap),new Quaternion().setFromEuler(new Euler(...ar,'YXZ')),new Vector3(1,1,1)));}
 const h=new Matrix4().makeScale(1,1,-1);return h.clone().multiply(m).multiply(h);}

// HeadBob.PreCull adds to the camera's mount-local Euler angles, after LazyCam, then PostRender restores them.
export function withHeadBob(camera,eye,output,draw){const p=camera.position.clone(),q=camera.quaternion.clone();try{
  const local=eye.clone().invert().multiply(q),u=new Quaternion(-local.x,-local.y,local.z,local.w),e=new Euler().setFromQuaternion(u,'YXZ');
  e.x+=output.rotation[0]*D;e.y+=output.rotation[1]*D;e.z+=output.rotation[2]*D;u.setFromEuler(e);
  camera.quaternion.copy(eye).multiply(new Quaternion(-u.x,-u.y,u.z,u.w));camera.position.add(new Vector3(output.position[0],output.position[1],-output.position[2]).applyQuaternion(eye));camera.updateMatrixWorld(true);return draw();
 }finally{camera.position.copy(p);camera.quaternion.copy(q);camera.updateMatrixWorld(true);}}
