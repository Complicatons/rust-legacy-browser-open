// Port of the decompiled light styling (LightStyle.cs, LightStyleCurve.cs, LightStyleDefault.cs, LightStylist.cs) and of
// FireBarrel's own light flicker (FireBarrel.cs Update / NewFlickerTarget / TurnOn / TurnOff). Data: fx/manifest.json
// (tools/export_fx.py): per-prefab LightStylist components and the LightStyle assets they reference.
//
// Shipped content (static export): the only LightStyle asset is "fire" (resources.assets, a LightStyleCurve, ping-pong
// wrap). It drives the first-person torch (TorchFire) and the third-person torch (TorchFire3p) lights, mask Intensity
// only, so the light's intensity is set to the curve value itself every LateUpdate. The Campfire's LightStylist has no
// lights and no style, and the Furnace's LightStylist component is disabled, so both fires are driven by FireBarrel's
// flicker instead: intensity lerps towards initial * Random.Range(.75, 1.25) at rate dt * 10, picking a new target within
// .05. The flare lights have no LightStylist (constant intensity).
//
// LightStyle.time is NetCull.time online and Time.time offline; a simulation's start time is LightStylist.Start's time,
// and the curve is evaluated at (time - start). Only the relative time matters, so any monotonic clock gives the same light.

// AnimationCurve internal wrap modes (m_PreInfinity / m_PostInfinity): 0 ping-pong, 1 repeat, 2 clamp.
export const WRAP=Object.freeze({PINGPONG:0,REPEAT:1,CLAMP:2});
// LightStyle.Mod.Mask
export const MASK=Object.freeze({RED:1,GREEN:2,BLUE:4,ALPHA:8,INTENSITY:16,RANGE:32,SPOT_ANGLE:64,ALL:127});

function hermite(k,t){if(t<=k[0].time)return k[0].value;const last=k[k.length-1];if(t>=last.time)return last.value;
 for(let i=0;i<k.length-1;i++){const a=k[i],b=k[i+1];if(t>b.time)continue;const dt=b.time-a.time;if(dt<=0)return b.value;
  // Unity treats an infinite tangent as a step.
  if(!Number.isFinite(a.outSlope)||!Number.isFinite(b.inSlope))return a.value;
  const s=(t-a.time)/dt,s2=s*s,s3=s2*s;return (2*s3-3*s2+1)*a.value+(s3-2*s2+s)*dt*a.outSlope+(-2*s3+3*s2)*b.value+(s3-s2)*dt*b.inSlope;}
 return last.value;}
// Mathf.Repeat / Mathf.PingPong
export const repeat=(t,length)=>length>0?t-Math.floor(t/length)*length:0;
export const pingPong=(t,length)=>{t=repeat(t,length*2);return length-Math.abs(t-length);};
// AnimationCurve.Evaluate with its pre/post wrap modes.
export function evaluateCurve(curve,t){const k=curve?.m_Curve??[];if(!k.length)return 0;if(k.length===1)return k[0].value;
 const begin=k[0].time,end=k[k.length-1].time,len=end-begin;
 const wrap=t<begin?curve.m_PreInfinity:t>end?curve.m_PostInfinity:WRAP.CLAMP;
 if(len>0&&wrap===WRAP.REPEAT)t=begin+repeat(t-begin,len);else if(len>0&&wrap===WRAP.PINGPONG)t=begin+pingPong(t-begin,len);
 return hermite(k,t);}

// LightStyle.Mod.ApplyTo(light, mask) on a plain {color:{r,g,b,a}, intensity, range, spotAngle} record; the mod
// carries the same fields. Only elements in both masks change.
export function applyMod(mod,mask,light){const m=mod.mask&mask;
 if(m&MASK.RED)light.color.r=mod.r;if(m&MASK.GREEN)light.color.g=mod.g;if(m&MASK.BLUE)light.color.b=mod.b;if(m&MASK.ALPHA)light.color.a=mod.a;
 if(m&MASK.INTENSITY)light.intensity=mod.intensity;if(m&MASK.RANGE)light.range=mod.range;if(m&MASK.SPOT_ANGLE)light.spotAngle=mod.spotAngle;return light;}
const uniform=(v,mask=MASK.ALL)=>({r:v,g:v,b:v,a:v,intensity:v,range:v,spotAngle:v,mask});

// LightStyle simulations: LightStyleCurve sets every element to curve(time - start); LightStyleDefault sets all to 1.
export class LightStyleSimulation{
 constructor(style,startTime){this.style=style??null;this.startTime=startTime;this.mod=uniform(1);}
 resetTime(time){this.startTime=time;}
 bind(time){if(this.style?.curve)this.mod=uniform(evaluateCurve(this.style.curve,time-this.startTime));return this.mod;}
}

// LightStylist with only its idle style (the shipped game never calls Play/Blend/CrossFade on these): LateUpdate binds
// the idle simulation with _mask and applies it to every assigned light. entry: fx manifest stylist record.
export class LightStylist{
 constructor(entry,styles,startTime){this.entry=entry;this.mask=entry.mask??MASK.ALL;this.lights=entry.lights??[];
  this.simulation=new LightStyleSimulation(entry.style?styles?.[entry.style]??null:null,startTime);}
 // A disabled component or inactive GameObject never runs LateUpdate.
 get active(){return this.entry.enabled!==false&&this.entry.active!==false&&this.lights.length>0;}
 drives(node){return this.active&&this.lights.includes(node);}
 apply(time,light){if(!this.active)return light;return applyMod(this.simulation.bind(time),this.mask,light);}
}

// FireBarrel light flicker. rng() in [0, 1) stands in for Random.Range(.75, 1.25) (inclusive in Unity).
export class FireBarrelFlicker{
 constructor(initialIntensity,rng=Math.random){this.initial=initialIntensity;this.intensity=initialIntensity;this.target=1;this.rng=rng;this.on=null;}
 newTarget(){this.target=this.initial*(0.75+0.5*this.rng());}
 // SetOn: TurnOn enables the light and picks a target; TurnOff disables it and zeroes its intensity.
 set(on){if(on===this.on)return;this.on=on;if(on)this.newTarget();else this.intensity=0;}
 update(dt){if(!this.on)return 0;this.intensity+=(this.target-this.intensity)*Math.min(1,Math.max(0,dt*10));
  if(Math.abs(this.intensity-this.target)<0.05)this.newTarget();return this.intensity;}
}

// The light driver for one exported Light of a prefab: the LightStylist that lists it, else FireBarrel's flicker when
// it is the prefab's fireLight, else its serialized intensity. Returns {intensity(dt, time, on)} in Unity units.
export function lightDriver({fx,prefabKey,lightNode,lightData,fireBarrel=false,startTime=0,rng=Math.random}){
 const entry=fx?.prefabs?.[prefabKey],stylist=(entry?.stylists??[]).map(s=>new LightStylist(s,fx.lightStyles,startTime)).find(s=>s.drives(lightNode));
 const base=lightData?.m_Intensity??1;
 if(stylist)return {kind:'stylist',style:stylist.simulation.style?.name??'default',intensity:(dt,time,on=true)=>on?stylist.apply(time,{color:{},intensity:base}).intensity:0};
 if(fireBarrel){const f=new FireBarrelFlicker(base,rng);return {kind:'fireBarrel',flicker:f,intensity:(dt,time,on=true)=>{f.set(on);return f.update(dt);}};}
 return {kind:'constant',intensity:(dt,time,on=true)=>on?base:0};}
