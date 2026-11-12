import {Vector3,Matrix4,Matrix3,Quaternion,Box3,Sphere} from 'three';
import {MovingBody} from './collision.mjs';
const vector=v=>new Vector3(v.x,v.y,v.z);

// HitShape capsule origin is the first segment endpoint; length excludes the spherical caps.
// Keep analytic ray tests (no tessellation error at a head/limb edge); meshes serve existing overlap queries.
export class PlayerHitBox extends MovingBody{
 constructor(shape,viewId,root=null){
  super('Player hit region '+shape.bodyPart);this.shape=shape;this.onlineActor={viewId,root};this.bodyPart=shape.bodyPart;this.layer=27;this.noCollide=true;
  const s=shape,o=vector(s.origin),d=vector(s.directionOrSize);this.origin=o;this.axis=d;
  if(shape.inversion)throw Error('Unsupported player hit-shape inversion');
  if(shape.kind===4){this.bounds=new Box3().setFromCenterAndSize(o,d);this.addBox(d.toArray(),o.toArray());}
  else if(shape.kind===1){this.addCapsule(shape.radius,shape.radius*2,1,o.toArray());}
  else if(shape.kind===2){const center=o.clone().addScaledVector(d,s.length/2),m=new Matrix4().compose(center,new Quaternion().setFromUnitVectors(new Vector3(0,1,0),d),new Vector3(1,1,1));this.addCapsule(s.radius,s.length+2*s.radius,1,[0,0,0],m);}
  else throw Error('Unsupported player hit-shape kind');
 }
 raycast(ray,far){
  const local=ray.clone().applyMatrix4(this.motion.clone().invert()),s=this.shape,o=this.origin,d=this.axis;let p=null;
  if(s.kind===4)p=local.intersectBox(this.bounds,new Vector3());
  else if(s.kind===1)p=local.intersectSphere(new Sphere(o,s.radius),new Vector3());
  else{
   const end=o.clone().addScaledVector(d,s.length),candidates=[];
   for(const center of [o,end]){const hit=local.intersectSphere(new Sphere(center,s.radius),new Vector3());if(hit)candidates.push(hit);}
   const delta=local.origin.clone().sub(o),rd=local.direction.dot(d),od=delta.dot(d),a=1-rd*rd,b=local.direction.dot(delta)-rd*od,c=delta.lengthSq()-od*od-s.radius*s.radius,disc=b*b-a*c;
   if(a>1e-12&&disc>=0)for(const t of [(-b-Math.sqrt(disc))/a,(-b+Math.sqrt(disc))/a]){const y=od+t*rd;if(t>=0&&y>=0&&y<=s.length)candidates.push(local.at(t,new Vector3()));}
   candidates.sort((a,b)=>a.distanceToSquared(local.origin)-b.distanceToSquared(local.origin));p=candidates[0]??null;
  }
  if(!p)return null;const position=p.clone().applyMatrix4(this.motion),distance=position.distanceTo(ray.origin);if(distance>far)return null;
  let normal;if(s.kind===4){const center=this.bounds.getCenter(new Vector3()),size=this.bounds.getSize(new Vector3()),v=p.clone().sub(center);const axis=['x','y','z'].sort((a,b)=>Math.abs(v[b]/size[b])-Math.abs(v[a]/size[a]))[0];normal=new Vector3();normal[axis]=Math.sign(v[axis]);}
  else{const center=o.clone();if(s.kind===2)center.addScaledVector(d,Math.max(0,Math.min(s.length,p.clone().sub(o).dot(d))));normal=p.clone().sub(center).normalize();}
  normal.applyMatrix3(new Matrix3().getNormalMatrix(this.motion)).normalize();return {position,distance,normal};
 }
}
