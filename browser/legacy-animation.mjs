import {QuaternionKeyframeTrack,VectorKeyframeTrack} from 'three';

// Unity 4 legacy Animation blending, per animated property (bone + position/rotation/scale):
// - Blend states: layers are visited from the highest number down. Each layer takes at most the weight still
//   unclaimed by higher layers (an over-full layer is scaled down), so lower layers only receive the remainder.
//   A property whose claimed total stays below one is normalised to the states that animate it.
//   Rotations are a weighted quaternion sum (each sample turned into the first sample's hemisphere) then
//   normalised; positions/scales are weighted sums.
// - Additive states never claim that weight budget: after the blend they add their first-frame-relative delta
//   with their own weight, in ascending layer order, then component clip order within a layer.
// - States that do not key a property leave it to the other states; a property no enabled state keys keeps
//   the original rest transform (the browser never accumulates last-frame results).
// This follows Unity's documented legacy layer/weight/additive rules. Exact engine-internal parity (for example
// the order Unity composes several additive quaternions) is a runtime comparison item, not verified here.
export class LegacyAnimation{
 constructor(skeleton,clips){
  this.rest=skeleton.map(b=>({position:[...b.position],rotation:[...b.rotation],scale:[...b.scale]}));
  this.clips=new Map();this.times=new Map();let order=0;
  for(const [name,clip]of Object.entries(clips)){
   const tracks=[];
   for(const t of clip.tracks){if(t.bone===0)continue;
    for(const property of ['position','rotation','scale'])if(t[property]){
     const data=t[property],Track=property==='rotation'?QuaternionKeyframeTrack:VectorKeyframeTrack;
     const curve=new Track('',data.times,data.values).createInterpolant();
     tracks.push({bone:t.bone,property,key:t.bone*3+(property==='position'?0:property==='rotation'?1:2),curve,reference:Array.from(curve.evaluate(0))});
    }
   }
   this.clips.set(name,{length:clip.length,tracks,order:order++});
  }
 }
 sample(plans,dt){
  // Clips without an explicit time keep running even while their weight is zero, as Animation.Play does.
  for(const [name,c]of this.clips)this.times.set(name,c.length>0?((this.times.get(name)??0)+dt)%c.length:0);
  const properties=new Map();
  for(const p of plans){const c=this.clips.get(p.name);if(!c||!(p.weight>0))continue;
   const time=p.normalizedTime!=null?p.normalizedTime*c.length:p.time!=null?Math.min(c.length,Math.max(0,p.time)):this.times.get(p.name);
   const layer=p.layer??0;
   for(const t of c.tracks){let list=properties.get(t.key);if(!list)properties.set(t.key,list=[]);
    list.push({bone:t.bone,property:t.property,value:Array.from(t.curve.evaluate(time)),reference:t.reference,weight:p.weight,layer,order:c.order,additive:Boolean(p.additive)});
   }
  }
  const pose=this.rest.map(b=>({position:[...b.position],rotation:[...b.rotation],scale:[...b.scale]}));
  for(const entries of properties.values()){
   const {bone,property}=entries[0],normal=entries.filter(v=>!v.additive),rotation=property==='rotation';
   let value=pose[bone][property];
   if(normal.length){
    normal.sort((a,b)=>b.layer-a.layer||a.order-b.order);
    let remaining=1,claimed=0;const used=[];
    for(let i=0;i<normal.length&&remaining>1e-9;){
     let j=i,sum=0;while(j<normal.length&&normal[j].layer===normal[i].layer)sum+=normal[j++].weight;
     const take=Math.min(sum,remaining);for(let k=i;k<j;k++)used.push([normal[k],normal[k].weight/sum*take]);
     remaining-=take;claimed+=take;i=j;
    }
    if(claimed>0)value=rotation?quaternionAverage(used,claimed):used.reduce((out,[v,w])=>out.map((x,n)=>x+v.value[n]*w/claimed),value.map(()=>0));
   }
   const additive=entries.filter(v=>v.additive).sort((a,b)=>a.layer-b.layer||a.order-b.order);
   for(const v of additive){
    if(rotation)value=normalise(multiply(value,weightedDelta(v.reference,v.value,v.weight)));
    else if(property==='scale')value=value.map((x,i)=>x*(1+((v.reference[i]===0?1:v.value[i]/v.reference[i])-1)*v.weight));
    else value=value.map((x,i)=>x+(v.value[i]-v.reference[i])*v.weight);
   }
   pose[bone][property]=value;
  }
  return pose;
 }
 apply(bones,plans,dt){const pose=this.sample(plans,dt);
  for(let i=1;i<bones.length;i++){bones[i].position.fromArray(pose[i].position);bones[i].quaternion.fromArray(pose[i].rotation);bones[i].scale.fromArray(pose[i].scale);}
 }
}

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
function normalise(q){const n=Math.hypot(q[0],q[1],q[2],q[3]);return n>1e-12?q.map(x=>x/n):[0,0,0,1];}
function multiply(a,b){const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;
 return [ax*bw+aw*bx+ay*bz-az*by,ay*bw+aw*by+az*bx-ax*bz,az*bw+aw*bz+ax*by-ay*bx,aw*bw-ax*bx-ay*by-az*bz];}
// Weighted quaternion sum aligned to the first sample's hemisphere, then normalised.
export function quaternionAverage(used,total=1){const first=used[0][0].value,out=[0,0,0,0];
 for(const [v,w]of used){const s=dot(v.value,first)<0?-w/total:w/total;for(let i=0;i<4;i++)out[i]+=v.value[i]*s;}
 return normalise(out);}
// Additive rotation delta from the clip's first frame, scaled by weight as a blend from identity.
export function weightedDelta(reference,value,weight){const [rx,ry,rz,rw]=reference,inverse=[-rx,-ry,-rz,rw];let d=multiply(inverse,value);
 if(d[3]<0)d=d.map(x=>-x);
 return normalise([d[0]*weight,d[1]*weight,d[2]*weight,1-weight+d[3]*weight]);}
