import {Quaternion,Vector3} from 'three';

// LazyCam on the shipped camera (cab-gameobject.000:-1887986911), not the class's 10 degree defaults.
export const lazyCameraSettings=Object.freeze({maxAngle:5,damp:0.01,enableSeconds:0.1,disableSeconds:0.1});
const degrees=180/Math.PI;
export class CameraSway {
 constructor(settings=lazyCameraSettings){this.settings=settings;this.maxAngle=settings.maxAngle;this.velocity=0;this.fraction=0;this.view=null;this.target=5;this.allowed=false;this.angle=0;}
 // LazyCam.PreCull. This only returns presentation transforms; it never changes the eye supplied by the caller.
 update(aim,dt,{angle=this.target,allow=false}={}){
  dt=Math.max(0,Number.isFinite(dt)?dt:0);this.view??=aim.clone();this.target=angle;this.allowed=allow;
  const duration=allow?this.settings.enableSeconds:this.settings.disableSeconds;
  if(dt>0)this.fraction=Math.max(0,Math.min(1,this.fraction+(allow?1:-1)*(duration>0?dt/duration:1)));
  if(dt>0){const target=angle*this.fraction,omega=2/Math.max(0.0001,this.settings.damp),x=omega*dt,exp=1/(1+x+0.48*x*x+0.235*x*x*x);
   const change=this.maxAngle-target,temp=(this.velocity+omega*change)*dt;
   this.velocity=(this.velocity-omega*temp)*exp;let next=target+(change+temp)*exp;
   if((target>this.maxAngle)===(next>target)){next=target;this.velocity=0;}this.maxAngle=next;}
  // Unity's float Approximate-to-zero eventually disables the component; avoid a permanent double precision tail.
  if(this.maxAngle<1e-7){this.maxAngle=0;this.velocity=0;this.view.copy(aim);}
  else {const distance=this.view.angleTo(aim)*degrees;if(distance>=this.maxAngle&&distance>0)this.view.slerp(aim,1-this.maxAngle/distance);}
  this.angle=this.maxAngle===0?0:this.view.angleTo(aim)*degrees;
  return {view:this.view.clone(),counter:this.view.clone().invert().multiply(aim)};
 }
 state(){return {angle:this.angle,maxAngle:this.maxAngle,fraction:this.fraction,allowed:this.allowed};}
}

// Socket.CameraSpace.Rotate: rotate the parent around its own transformed offset. Socket Euler orientation is
// deliberately absent: the original axis uses parent.TransformDirection, not socket.rotation.
export function rotateSocket(bone,offset,rotation){
 const arm=new Vector3(...offset).multiply(bone.scale),before=arm.clone().applyQuaternion(bone.quaternion);
 bone.quaternion.multiply(rotation);bone.position.add(before.sub(arm.applyQuaternion(bone.quaternion)));
}

// Render a temporary ViewModel.lazyRotation, then restore every affected bone even if drawing fails.
export function withSocketSway(bones,sockets,counter,draw){
 if(!counter)return draw();
 const saved=new Map(),unity=new Quaternion(-counter.x,-counter.y,counter.z,counter.w);
 try {for(const [name,q] of [['pivot',unity],['pivot2',unity.clone().invert()]]){const socket=sockets[name],bone=socket&&bones[socket.bone];if(!bone)continue;
   if(!saved.has(bone))saved.set(bone,{position:bone.position.clone(),quaternion:bone.quaternion.clone()});rotateSocket(bone,socket.offset,q);}
  bones[0]?.updateMatrixWorld(true);return draw();
 }finally{for(const [bone,pose] of saved){bone.position.copy(pose.position);bone.quaternion.copy(pose.quaternion);}bones[0]?.updateMatrixWorld(true);}
}
