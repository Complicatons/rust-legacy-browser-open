import {Vector3,Quaternion,Matrix4} from 'three';
// Port of the original BasicDoor/MovingDoor (decompiled Assembly-CSharp). Door maths runs in Unity
// space; only the final matrix is converted to browser space with H * M * H, H = diag(1,1,-1,1).
const H=new Matrix4().makeScale(1,1,-1);
const RunFlags={OpenedForward:1,ClosedReverse:2,PointText:4,FixedUpdate:8,NoReverse:16,Waits:32};
export const DoorState={Opening:0,Opened:1,Closing:2,Closed:3};
const Side={Forward:0,Reverse:1},IdealSide={Unknown:0,Reverse:-1,Forward:1};
const v3=p=>new Vector3(p.x,p.y,p.z);
// UnityEngine.Mathf.SmoothStep
const smoothStep=(from,to,t)=>{t=Math.min(1,Math.max(0,t));t=-2*t*t*t+3*t*t;return to*t+from*(1-t);};
// UnityEngine.Quaternion.AngleAxis normalises the axis; a zero axis yields identity.
const angleAxis=(degrees,axis)=>axis.lengthSq()?new Quaternion().setFromAxisAngle(axis.clone().normalize(),degrees*Math.PI/180):new Quaternion();

export class LegacyDoor {
 constructor(record,index){
  this.record=record;this.index=index;this.name=record.name;Object.assign(this,record.settings);
  for(const k of ['closedPositionPivot','openMovement','rotationAxis','rotationCross','pointTextPointOpened','pointTextPointClosed'])this[k]=v3(record.settings[k]);
  for(const k of ['rotationFirst','smooth','movementABS','rotationABS','slerpMovementByDegrees'])this[k]=Boolean(record.settings[k]);
  this.parent=new Matrix4().fromArray(record.parentMatrix);
  // BasicDoor.CaptureOriginals: the serialised transform is the closed pose.
  this.originalLocalPosition=v3(record.localPosition);this.originalLocalRotation=new Quaternion(record.localRotation.x,record.localRotation.y,record.localRotation.z,record.localRotation.w);this.originalLocalScale=v3(record.localScale);
  this.closedWorld=this.worldMatrixFor(this.originalLocalPosition,this.originalLocalRotation);this.closedWorldInverse=this.closedWorld.clone().invert();
  this.timeStampChanged=null;this.lastToggleTimeStamp=null;this.serverLastTimeStamp=null;this.listeners=[];
  // BasicDoor.Awake
  this.openingInReverse=this.defaultReversed;
  if(this.startsOpened){this.target=this.state=DoorState.Opened;this.doDoorFraction(1);}
  else {this.target=this.state=DoorState.Closed;this.doDoorFraction(0);}
  this.enabled=false;
 }
 get startsOpened(){return (this.startConfig&RunFlags.OpenedForward)===RunFlags.OpenedForward;}
 get defaultReversed(){return (this.startConfig&0x12)===RunFlags.ClosedReverse;}
 get reverseOpenDisabled(){return (this.startConfig&RunFlags.NoReverse)===RunFlags.NoReverse;}
 get canOpenReverse(){return !this.reverseOpenDisabled;}
 get fixedUpdate(){return (this.startConfig&RunFlags.FixedUpdate)===RunFlags.FixedUpdate;}
 get pointText(){return (this.startConfig&RunFlags.PointText)===RunFlags.PointText;}
 get waitsTarget(){return (this.startConfig&RunFlags.Waits)===RunFlags.Waits;}
 get on(){return this.target===DoorState.Opened||this.target===DoorState.Opening;}
 elapsed(now){return this.timeStampChanged===null?Infinity:(now-this.timeStampChanged)/1000;}
 onEvent(listener){this.listeners.push(listener);}
 emit(type){for(const listener of this.listeners)listener(type,this);}

 startOpeningOrClosing(open,timestamp){
  let reverse=this.openingInReverse,state,remaining;
  if(open!==0){
   if(this.state===DoorState.Closed)reverse=this.canOpenReverse&&open===2;
   state=DoorState.Opened;if(state===this.state||state===this.state+1)return;
   const e=this.elapsed(timestamp),closedFraction=this.durationClose<=0?0:(e>=this.durationClose?0:1-e/this.durationClose);
   remaining=Math.trunc(closedFraction*this.durationOpen*1000);
  } else {
   state=DoorState.Closed;if(state===this.state||state===this.state+1)return;
   const e=this.elapsed(timestamp),openFraction=this.durationOpen<=0?1:(e>=this.durationOpen?1:e/this.durationOpen);
   remaining=Math.trunc((1-openFraction)*this.durationClose*1000);
  }
  this.timeStampChanged=remaining>timestamp?null:timestamp-remaining;
  this.enabled=true;this.openingInReverse=reverse;this.target=state;
 }
 doDoorFraction(fraction){this.onDoorFraction(this.openingInReverse?-fraction:fraction);}
 onDoorFraction(fraction){this.fraction=fraction;const {position,rotation}=this.updateMovement(fraction);this.localPosition=position;this.localRotation=rotation;this.world=this.worldMatrixFor(position,rotation);this.motion=this.world.clone().multiply(this.closedWorldInverse);this.changed=true;}

 // BasicDoor.DoorUpdate, called from LateUpdate (or FixedUpdate when that flag is set).
 update(now){
  if(!this.enabled)return;const e=this.elapsed(now);if(e<=0)return;const transition=this.state!==this.target;
  if(this.target===DoorState.Opened){
   if(e>=this.durationOpen){this.enabled=false;this.state=DoorState.Opened;this.doDoorFraction(1);if(transition)this.emit('opened');}
   else {if(this.state===DoorState.Closed)this.emit('open');this.state=DoorState.Opening;this.doDoorFraction(e/this.durationOpen);}
  } else if(this.target===DoorState.Closed){
   if(e>=this.durationClose){this.enabled=false;this.state=DoorState.Closed;this.doDoorFraction(0);if(transition)this.emit('closed');}
   else {if(this.state===DoorState.Opened)this.emit('close');this.state=DoorState.Closing;this.doDoorFraction(1-e/this.durationClose);}
  }
 }

 // MovingDoor.UpdateMovement
 updateMovement(openFraction){
  if(openFraction===0)return {position:this.originalLocalPosition.clone(),rotation:this.originalLocalRotation.clone()};
  if(this.smooth)openFraction=openFraction>=0?smoothStep(0,1,openFraction):smoothStep(0,-1,-openFraction);
  const radians=this.degrees*Math.PI/180;let movementFraction;
  if(!this.slerpMovementByDegrees||this.degrees===0||openFraction===0||openFraction===1||Math.sin(radians)===0)movementFraction=openFraction;
  else movementFraction=Math.sin(openFraction*radians)/Math.sin(radians);
  const q=openFraction!==0?angleAxis(this.degrees*(this.rotationABS?Math.abs(openFraction):openFraction),this.rotationAxis):new Quaternion();
  const movement=this.openMovement.clone().multiplyScalar(this.movementABS?Math.abs(movementFraction):movementFraction);
  const pivot=this.closedPositionPivot.clone().negate().applyQuaternion(q).add(this.closedPositionPivot);
  const offset=pivot.add(this.rotationFirst?movement.applyQuaternion(q):movement).applyQuaternion(this.originalLocalRotation);
  return {position:this.originalLocalPosition.clone().add(offset),rotation:this.originalLocalRotation.clone().multiply(q)};
 }
 worldMatrixFor(position,rotation){return this.parent.clone().multiply(H).multiply(new Matrix4().compose(position,rotation,this.originalLocalScale)).multiply(H);}
 // Converts a browser-space point into this door's current Unity local space (Transform.InverseTransformPoint).
 inverseTransformPoint(point){const p=point.clone().applyMatrix4(this.world.clone().invert());p.z=-p.z;return p;}

 // MovingDoor.IdealSideForPoint
 idealSideForPoint(point){const d=this.inverseTransformPoint(point).dot(new Vector3().crossVectors(this.rotationCross,this.rotationAxis));if(!Number.isFinite(d)||Math.abs(d)<1e-6)return IdealSide.Unknown;return d>0?IdealSide.Forward:IdealSide.Reverse;}
 calculateOpenWay(point){
  if(!point)return !this.openingInReverse&&this.canOpenReverse?Side.Reverse:Side.Forward;
  let ideal;if(!this.canOpenReverse||(ideal=this.idealSideForPoint(point))===IdealSide.Forward)return Side.Forward;
  if(ideal===IdealSide.Unknown)return this.openingInReverse?Side.Forward:Side.Reverse;
  return Side.Reverse;
 }
 // BasicDoor.ToggleStateServer(Vector3? openerPoint, ulong timestamp, bool? fallbackReverse)
 toggleState(openerPoint,timestamp){
  if(this.serverLastTimeStamp!==null&&timestamp<=this.serverLastTimeStamp)return false;
  if(this.waitsTarget&&(this.state===DoorState.Opening||this.state===DoorState.Closing))return false;
  this.serverLastTimeStamp=timestamp;const target=this.target,reverse=this.openingInReverse;
  if(this.target===DoorState.Closed)this.startOpeningOrClosing(this.calculateOpenWay(openerPoint)===Side.Forward?1:2,timestamp);
  else this.startOpeningOrClosing(0,timestamp);
  return target!==this.target||reverse!==this.openingInReverse;
 }
 // BasicDoor.ContextRespond_OpenCloseToggle (the quick "use" action). The original compares a
 // millisecond difference against minimumTimeBetweenOpenClose; that behaviour is kept as-is.
 use(openerPoint,timestamp){
  const since=this.lastToggleTimeStamp===null?null:timestamp-this.lastToggleTimeStamp;
  if(since!==null&&since<=this.minimumTimeBetweenOpenClose&&this.lastToggleTimeStamp!==0)return false;
  if(this.toggleState(openerPoint,timestamp)){this.lastToggleTimeStamp=timestamp;return true;}
  return false;
 }
 // Client BasicDoor.ContextText / ContextStatusPoll
 contextText(){return this.state===DoorState.Closed?this.textOpen:this.state===DoorState.Opened?this.textClose:null;}
 get busy(){return this.state!==DoorState.Opened&&this.state!==DoorState.Closed;}
}

// A deployable door (MovingDoor on the prefab root) placed at a Unity-space position/rotation.
export function deployableDoor(prefab,position,rotation){const md=prefab.components.MovingDoor[0];
 return new LegacyDoor({name:prefab.name,parentMatrix:new Matrix4().toArray(),localPosition:{x:position.x,y:position.y,z:position.z},localRotation:{x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w},localScale:prefab.rootScale,settings:md.data,sounds:md.sounds},-1);}
export function createDoors(manifest){return (manifest.doors??[]).map((record,i)=>new LegacyDoor(record,i));}
