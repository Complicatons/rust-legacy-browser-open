// Original Tracer.Update, presentation only. This never applies damage or sends hit reports.
export class TracerFlight{
 constructor(from,direction,data,{range=800,rootScale=[1,1,1],silenced=false,random=Math.random}={}){
  this.position=[...from];this.direction=[...direction];this.data=data;this.range=range;this.distance=0;this.dead=false;
  const width=0.75+random()*0.25,length=0.5+random()*0.5;
  this.targetScale=rootScale.map((v,i)=>v*(i===2?length:width));this.scale=[0,0,this.targetScale[2]];
  if(silenced)this.targetScale=[0,0,0];
 }
 update(dt,raycast,camera){
  if(this.dead)return null;dt=Math.max(0,dt);
  const d=this.data;
  if(this.distance>d.fadeDistStart){const k=Math.max(0,Math.min(1,(this.distance-d.fadeDistStart)/d.fadeDistLength));this.scale=this.scale.map((v,i)=>v+(this.targetScale[i]-v)*k);}
  const step=d.speedPerSec*dt,hit=raycast(this.position,this.direction,step);
  if(hit){this.dead=true;const near=Math.hypot(...this.position.map((v,i)=>v-camera[i]))<=75;
   return {hit,near,genericDecal:near&&![17,18,27,21].includes(hit.layer??0)};
  }
  this.position=this.position.map((v,i)=>v+this.direction[i]*step);this.distance+=step;
  if(this.distance>this.range)this.dead=true;
  return null;
 }
}
