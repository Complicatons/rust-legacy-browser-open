// GUIHeldItem: the item icon carried by the RPOS cursor. Picking an item up starts the icon on its cell and eases it to
// the cursor (offset SmoothDamp 0.06 s, at most 600 px/s); putting it into a cell eases it there while it fades out
// (SmoothDamp 0.1 s, 50 UI units/s, alpha = share of the way still left). Positions are CSS px (1 NGUI px each).
export const OFFSET_SMOOTH_TIME=0.06,OFFSET_SPEED=600,FADE_SMOOTH_TIME=0.1,FADE_SPEED=50;

// Vector3.SmoothDamp on points of any length; velocity is updated in place.
export function smoothDampVector(current,target,velocity,smoothTime,maxSpeed,dt){
 smoothTime=Math.max(0.0001,smoothTime);const omega=2/smoothTime,x=omega*dt,exp=1/(1+x+0.48*x*x+0.235*x*x*x);
 let change=current.map((c,i)=>c-target[i]);const maxLength=maxSpeed*smoothTime,length=Math.hypot(...change);
 if(length>maxLength)change=change.map(c=>c*maxLength/length);
 const temp=change.map((c,i)=>(velocity[i]+omega*c)*dt);for(let i=0;i<velocity.length;i++)velocity[i]=(velocity[i]-omega*temp[i])*exp;
 let output=current.map((c,i)=>c-change[i]+(change[i]+temp[i])*exp);
 if(target.reduce((sum,t,i)=>sum+(t-current[i])*(output[i]-t),0)>0){output=target.slice();velocity.fill(0);}
 return output;
}

const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);

export class HeldItem {
 // unitPx: pixels per UI world unit (UIRoot automatic: screen height / 2), which turns FADE_SPEED into px/s.
 constructor({unitPx=()=>innerHeight/2}={}){this.unitPx=unitPx;this.hasItem=false;this.fadingOut=false;this.icon=null;this.position=null;this.opaque();}
 opaque(){this.alpha=1;this.fadeStart=[0,0,0];this.fadeEnd=[1,0,0];this.fadeDistance=1;this.fadeMagnitude=1;this.fadeNormal=[1,0,0];this.fadeVelocity=[0,0,0];this.fadingOut=false;}
 // SetHeldItem(RPOSInventoryCell): the icon starts on the cell's centroid.
 set(icon,centroid,mouse){this.hasItem=true;this.icon=icon;this.offset=centroid?[centroid[0]-mouse[0],centroid[1]-mouse[1]]:[0,0];this.offsetVelocity=[0,0];this.opaque();this.position=[mouse[0]+this.offset[0],mouse[1]+this.offset[1]];}
 // ClearHeldItem(): the icon goes at once.
 clear(){if(!this.hasItem)return;this.empty();if(!this.fadingOut){this.opaque();this.icon=null;this.position=null;}}
 // ClearHeldItem(RPOSInventoryCell): the icon eases into the cell and fades on the way.
 clearInto(centroid){if(!this.hasItem)return;this.fadingOut=true;this.clear();if(!centroid||!this.position){this.opaque();return;}this.fadeOutToPoint(centroid);}
 // A drop on the icon's own spot moves it one UI unit along the view axis (fadeOutPointEnd.z++): it fades in place.
 fadeOutToPoint(point){this.opaque();const start=[...this.position,0],end=[point[0],point[1],0];if(start[0]===end[0]&&start[1]===end[1])end[2]+=this.unitPx();
  const n=end.map((e,i)=>e-start[i]),m=Math.hypot(...n);this.fadeStart=start;this.fadeEnd=end;this.fadeMagnitude=m;this.fadeNormal=n.map(v=>v/m);
  this.fadeDistance=dot(this.fadeNormal,start);this.alpha=1;this.fadingOut=true;this.fadePoint=start;}
 empty(){this.hasItem=false;}
 get visible(){return this.hasItem||this.fadingOut;}
 // GUIHeldItem.Update: returns what to draw ({x,y,alpha} centre in px) or null.
 update(dt,mouse){
  if(this.hasItem){this.position=[mouse[0]+this.offset[0],mouse[1]+this.offset[1]];this.offset=smoothDampVector(this.offset,[0,0],this.offsetVelocity,OFFSET_SMOOTH_TIME,OFFSET_SPEED,dt);return {x:this.position[0],y:this.position[1],alpha:1};}
  if(!this.fadingOut)return null;
  this.fadePoint=smoothDampVector(this.fadePoint,this.fadeEnd,this.fadeVelocity,FADE_SMOOTH_TIME,FADE_SPEED*this.unitPx(),dt);
  const along=dot(this.fadeNormal,this.fadePoint);
  this.alpha=1-Math.min(1,Math.max(0,Math.abs(along-this.fadeDistance)/this.fadeMagnitude));
  if(this.alpha<=1/256){this.fadingOut=false;this.icon=null;this.position=null;return null;}
  this.position=this.fadePoint.slice(0,2);return {x:this.position[0],y:this.position[1],alpha:this.alpha};
 }
}
