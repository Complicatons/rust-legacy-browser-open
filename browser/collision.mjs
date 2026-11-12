import {Vector3,Matrix4,Triangle,BoxGeometry,CapsuleGeometry,Ray,Box3,Plane} from 'three';
import {Octree} from 'three/addons/math/Octree.js';
import {Capsule} from 'three/addons/math/Capsule.js';

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const _d1=new Vector3(),_d2=new Vector3(),_r=new Vector3(),_s1=new Vector3(),_s2=new Vector3(),_x=new Vector3();
// Squared distance between segments p1q1 and p2q2; c1, c2 receive the closest points (Ericson, Real-Time Collision
// Detection 5.1.9).
function segmentSegment(p1,q1,p2,q2,c1,c2){const d1=_d1.subVectors(q1,p1),d2=_d2.subVectors(q2,p2),r=_r.subVectors(p1,p2),a=d1.dot(d1),e=d2.dot(d2),f=d2.dot(r);let s=0,t=0;
 if(a<=1e-12){if(e>1e-12)t=clamp(f/e,0,1);}
 else{const c=d1.dot(r);if(e<=1e-12)s=clamp(-c/a,0,1);
  else{const b=d1.dot(d2),denom=a*e-b*b;s=denom>1e-12?clamp((b*f-c*e)/denom,0,1):0;t=(b*s+f)/e;if(t<0){t=0;s=clamp(-c/a,0,1);}else if(t>1){t=1;s=clamp((b-c)/a,0,1);}}}
 c1.copy(p1).addScaledVector(d1,s);c2.copy(p2).addScaledVector(d2,t);return c1.distanceToSquared(c2);}
// Distance between segment pq (a capsule axis) and triangle t with unit normal n; onAxis, onTri receive the closest
// points. Zero when the segment passes through the triangle.
export function segmentTriangle(p,q,t,n,onAxis,onTri){const dp=n.dot(_x.subVectors(p,t.a)),dq=n.dot(_x.subVectors(q,t.a));
 if(dp*dq<=0&&dp!==dq){onAxis.copy(p).lerp(q,dp/(dp-dq));if(t.containsPoint(onAxis)){onTri.copy(onAxis);return 0;}}
 let best=Infinity;
 for(const x of [p,q]){t.closestPointToPoint(x,_s2);const d=x.distanceToSquared(_s2);if(d<best){best=d;onAxis.copy(x);onTri.copy(_s2);}}
 for(const [a,b] of [[t.a,t.b],[t.b,t.c],[t.c,t.a]]){const d=segmentSegment(p,q,a,b,_s1,_s2);if(d<best){best=d;onAxis.copy(_s1);onTri.copy(_s2);}}
 return Math.sqrt(best);}
const _plane=new Plane(),_onAxis=new Vector3(),_onTri=new Vector3();

function* triangles(positions,indices,matrix){
 const flip=matrix.determinant()<0;
 for(let i=0;i<indices.length;i+=3){const points=[indices[i],indices[i+1],indices[i+2]].map(id=>new Vector3().fromArray(positions,id*3).applyMatrix4(matrix));if(flip)[points[1],points[2]]=[points[2],points[1]];const triangle=new Triangle(...points);if(triangle.getArea()>1e-10)yield triangle;}
}
// Unity CapsuleCollider: height includes both caps; direction 0/1/2 = X/Y/Z axis.
function capsuleShape(radius,height,direction,center){const g=new CapsuleGeometry(radius,Math.max(0,height-2*radius),6,12);if(direction===0)g.rotateZ(Math.PI/2);else if(direction===2)g.rotateX(Math.PI/2);g.translate(...center);const shape={positions:g.attributes.position.array,indices:g.index.array};g.dispose();return shape;}
function boxShape(size,center){const g=new BoxGeometry(...size);g.translate(...center);const shape={positions:g.attributes.position.array,indices:g.index.array};g.dispose();return shape;}

// Box3.intersectsTriangle (three r186) with the same arithmetic but no temporary arrays or Vector3 calls: the octree
// build runs it for every triangle in every child cell. Zero components of the separating axes are left out of the
// sums (x*0 adds only a signed zero), the box's face axes go first (the order of the axes cannot change the answer),
// and a triangle with a non-finite coordinate goes to three's own test, where x*0 would be NaN.
const separated=(p0,p1,p2,r)=>p0>r&&p1>r&&p2>r||p0<-r&&p1<-r&&p2<-r;
export function boxIntersectsTriangle(box,triangle){const mn=box.min,mx=box.max;if(mx.x<mn.x||mx.y<mn.y||mx.z<mn.z)return false;
 const {a,b,c}=triangle,cx=(mn.x+mx.x)*0.5,cy=(mn.y+mx.y)*0.5,cz=(mn.z+mx.z)*0.5,ex=mx.x-cx,ey=mx.y-cy,ez=mx.z-cz;
 const ax=a.x-cx,ay=a.y-cy,az=a.z-cz,bx=b.x-cx,by=b.y-cy,bz=b.z-cz,qx=c.x-cx,qy=c.y-cy,qz=c.z-cz,sum=ax+ay+az+bx+by+bz+qx+qy+qz;
 if(sum-sum!==0)return box.intersectsTriangle(triangle);
 if(separated(ax,bx,qx,ex)||separated(ay,by,qy,ey)||separated(az,bz,qz,ez))return false;
 const f0x=bx-ax,f0y=by-ay,f0z=bz-az,f1x=qx-bx,f1y=qy-by,f1z=qz-bz,f2x=ax-qx,f2y=ay-qy,f2z=az-qz;
 // u_x × f_j = (0, -f.z, f.y), u_y × f_j = (f.z, 0, -f.x), u_z × f_j = (-f.y, f.x, 0)
 if(separated(az*f0y-ay*f0z,bz*f0y-by*f0z,qz*f0y-qy*f0z,ey*Math.abs(f0z)+ez*Math.abs(f0y)))return false;
 if(separated(az*f1y-ay*f1z,bz*f1y-by*f1z,qz*f1y-qy*f1z,ey*Math.abs(f1z)+ez*Math.abs(f1y)))return false;
 if(separated(az*f2y-ay*f2z,bz*f2y-by*f2z,qz*f2y-qy*f2z,ey*Math.abs(f2z)+ez*Math.abs(f2y)))return false;
 if(separated(ax*f0z-az*f0x,bx*f0z-bz*f0x,qx*f0z-qz*f0x,ex*Math.abs(f0z)+ez*Math.abs(f0x)))return false;
 if(separated(ax*f1z-az*f1x,bx*f1z-bz*f1x,qx*f1z-qz*f1x,ex*Math.abs(f1z)+ez*Math.abs(f1x)))return false;
 if(separated(ax*f2z-az*f2x,bx*f2z-bz*f2x,qx*f2z-qz*f2x,ex*Math.abs(f2z)+ez*Math.abs(f2x)))return false;
 if(separated(ay*f0x-ax*f0y,by*f0x-bx*f0y,qy*f0x-qx*f0y,ex*Math.abs(f0y)+ey*Math.abs(f0x)))return false;
 if(separated(ay*f1x-ax*f1y,by*f1x-bx*f1y,qy*f1x-qx*f1y,ex*Math.abs(f1y)+ey*Math.abs(f1x)))return false;
 if(separated(ay*f2x-ax*f2y,by*f2x-bx*f2y,qy*f2x-qx*f2y,ex*Math.abs(f2y)+ey*Math.abs(f2x)))return false;
 // the triangle's normal f0 × f1, summed in three's order
 const nx=f0y*f1z-f0z*f1y,ny=f0z*f1x-f0x*f1z,nz=f0x*f1y-f0y*f1x;
 return !separated(ax*nx+ay*ny+az*nz,bx*nx+by*ny+bz*nz,qx*nx+qy*ny+qz*nz,ex*Math.abs(nx)+ey*Math.abs(ny)+ez*Math.abs(nz));}

// three's Octree splits every node holding more than 8 triangles down to 16 levels. Triangle fans that meet at one
// point can never be separated, so the island's 124k triangles became 2.1 M leaves and 8.4 M triangle references
// (about 10 s to build and most of the page's memory). This keeps the same queries but stops splitting at cells
// smaller than MIN_CELL metres, and gathers ray candidates with a Set (three uses indexOf, quadratic in candidates)
// only from cells the ray reaches within `far`. Candidate sets stay supersets, so query results are unchanged.
export class CollisionOctree extends Octree {
 static TRIANGLES_PER_LEAF=16;static MIN_CELL=2;static MAX_LEVEL=16;static intersectsTriangle=boxIntersectsTriangle;
 constructor(box){super(box);}
 // three pads only the minimum corner; a triangle lying in the maximum face plane can then fall outside every child box
 // after rounding and be dropped by split (e.g. the top face of an axis-aligned mesh in its own space). Pad both corners.
 calcBox(){super.calcBox();this.box.max.addScalar(0.01);return this;}
 // three tests whether the triangle contains a point interpolated from the capsule ends' plane distances, which is not
 // where the axis meets the plane: an axis through a large triangle (a falling capsule over a rock slope) was missed
 // and the capsule dropped into the rock. Same contacts from the exact axis-to-triangle distance: the plane normal and
 // three's depth when the axis passes through the face, else away from the closest point; nothing when both capsule
 // ends are behind the plane, as in three.
 triangleCapsuleIntersect(capsule,triangle){triangle.getPlane(_plane);const r=capsule.radius,e1=_plane.distanceToPoint(capsule.start),e2=_plane.distanceToPoint(capsule.end);
  if(e1>r&&e2>r||e1<0&&e2<0)return false;const d=segmentTriangle(capsule.start,capsule.end,triangle,_plane.normal,_onAxis,_onTri);if(d>=r)return false;
  if(d<1e-9)return {normal:_plane.normal.clone(),point:_onAxis.clone(),depth:r-Math.min(e1,e2)};
  return {normal:_onAxis.clone().sub(_onTri).divideScalar(d),point:_onTri.clone(),depth:r-d};}
 split(level){if(!this.box)return this;const C=this.constructor,half=new Vector3().subVectors(this.box.max,this.box.min).multiplyScalar(0.5),subTrees=[];
  for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){const box=new Box3();box.min.set(this.box.min.x+x*half.x,this.box.min.y+y*half.y,this.box.min.z+z*half.z);box.max.copy(box.min).add(half);subTrees.push(new C(box));}
  // A child the triangle's bounds miss by more than 1 µm (far beyond the test's rounding) fails the exact test's face
  // axes, so it is skipped without one.
  let triangle;while((triangle=this.triangles.pop())){const {a,b,c}=triangle,x0=Math.min(a.x,b.x,c.x)-1e-6,x1=Math.max(a.x,b.x,c.x)+1e-6,y0=Math.min(a.y,b.y,c.y)-1e-6,y1=Math.max(a.y,b.y,c.y)+1e-6,z0=Math.min(a.z,b.z,c.z)-1e-6,z1=Math.max(a.z,b.z,c.z)+1e-6;
   for(const t of subTrees){const {min,max}=t.box;if(x0>max.x||x1<min.x||y0>max.y||y1<min.y||z0>max.z||z1<min.z)continue;if(C.intersectsTriangle(t.box,triangle))t.triangles.push(triangle);}}
  const small=Math.max(half.x,half.y,half.z)<C.MIN_CELL*2;
  for(const t of subTrees){const n=t.triangles.length;if(n>C.TRIANGLES_PER_LEAF&&level<C.MAX_LEVEL&&!small)t.split(level+1);if(n)this.subTrees.push(t);}
  return this;}
 getRayTriangles(ray,triangles,far=Infinity,seen=new Set()){const hit=new Vector3();
  // Ray.intersectBox gives the exit point when the ray starts inside a box, so test containment first.
  for(const t of this.subTrees){if(!t.box.containsPoint(ray.origin)&&(!ray.intersectBox(t.box,hit)||hit.distanceTo(ray.origin)>far))continue;
   if(t.triangles.length){for(const tri of t.triangles)if(!seen.has(tri)){seen.add(tri);triangles.push(tri);}}else t.getRayTriangles(ray,triangles,far,seen);}}
 // Same result as Octree.rayIntersect (back faces included), but only cells within `far` are searched.
 rayIntersect(ray,far=Infinity){const triangles=[],point=new Vector3();let triangle,position,distance=1e100;this.getRayTriangles(ray,triangles,far);
  for(const t of triangles){const r=ray.intersectTriangle(t.a,t.b,t.c,true,point);if(r){const d=r.sub(ray.origin).length();if(distance>d){position=r.clone().add(ray.origin);distance=d;triangle=t;}}}
  return distance<1e100?{distance,triangle,position}:false;}
}

// Original colliders on an object that moves at runtime (e.g. MovingDoor). Shapes keep their source
// world matrix; setMotion applies the object's displacement from that source pose.
export class MovingBody {
 constructor(name){this.name=name;this.shapes=[];this.tree=null;this.triangleCount=0;this.motion=new Matrix4();}
 addGeometry(positions,indices,matrix=new Matrix4()){this.shapes.push({positions,indices,matrix:matrix.clone()});}
 addBox(size,center,matrix){const s=boxShape(size,center);this.addGeometry(s.positions,s.indices,matrix);}
 addCapsule(radius,height,direction,center,matrix){const s=capsuleShape(radius,height,direction,center);this.addGeometry(s.positions,s.indices,matrix);}
 // Bounds update immediately; the octree is rebuilt lazily on the first query that reaches these bounds. Companion bodies
 // (a prefab's colliders on other layers, main.mjs prefabBody) move with it.
 setMotion(motion){for(const c of this.companions??[])c.setMotion(motion);this.motion.copy(motion);this.stale=true;this.tree=null;this.box=new Box3();
  for(const s of this.shapes){if(!s.bounds){s.bounds=new Box3();const v=new Vector3();for(const id of s.indices)s.bounds.expandByPoint(v.fromArray(s.positions,id*3));}if(!s.bounds.isEmpty())this.box.union(s.bounds.clone().applyMatrix4(motion.clone().multiply(s.matrix)));}
  if(!this.box.isEmpty())this.box.expandByScalar(0.05);return this;}
 ensure(){if(this.stale){const tree=new CollisionOctree();let count=0;for(const s of this.shapes)for(const t of triangles(s.positions,s.indices,this.motion.clone().multiply(s.matrix))){tree.addTriangle(t);count++;}this.triangleCount=count;this.tree=count?tree.build():null;this.stale=false;}return this.tree;}
 setShapes(shapes){this.shapes=shapes;return this.setMotion(this.motion);}
}

// Static triangle soup indexed on an x/z grid. Used for the client's baked tree colliders: trunks are tall,
// thin triangles, which an Octree duplicates into every cell they cross. Triangles stay in the typed arrays.
class TriangleGrid {
 constructor(positions,indices,cell){this.p=positions;this.i=indices;this.cell=cell;this.cells=new Map();this.helper=new CollisionOctree();this.box=new Box3();
  const v=new Vector3();
  for(let t=0;t<indices.length;t+=3){let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
   for(let k=0;k<3;k++){v.fromArray(positions,indices[t+k]*3);this.box.expandByPoint(v);x0=Math.min(x0,v.x);x1=Math.max(x1,v.x);z0=Math.min(z0,v.z);z1=Math.max(z1,v.z);}
   for(let cx=Math.floor(x0/cell);cx<=Math.floor(x1/cell);cx++)for(let cz=Math.floor(z0/cell);cz<=Math.floor(z1/cell);cz++){const key=this.key(cx,cz);let list=this.cells.get(key);if(!list)this.cells.set(key,list=[]);list.push(t);}}
 }
 key(cx,cz){return (cx+100000)*200001+(cz+100000);}
 triangle(t,target=new Triangle()){target.a.fromArray(this.p,this.i[t]*3);target.b.fromArray(this.p,this.i[t+1]*3);target.c.fromArray(this.p,this.i[t+2]*3);return target;}
 gather(x0,x1,z0,z1,out){const c=this.cell;for(let cx=Math.floor(x0/c);cx<=Math.floor(x1/c);cx++)for(let cz=Math.floor(z0/c);cz<=Math.floor(z1/c);cz++){const list=this.cells.get(this.key(cx,cz));if(list)for(const t of list)out.add(t);}return out;}
 // Same accumulation as Octree.capsuleIntersect.
 capsuleIntersect(capsule){const c=capsule.clone(),r=capsule.radius,tri=new Triangle();let hit=false;
  const ids=this.gather(Math.min(c.start.x,c.end.x)-r,Math.max(c.start.x,c.end.x)+r,Math.min(c.start.z,c.end.z)-r,Math.max(c.start.z,c.end.z)+r,new Set());
  for(const t of ids){const result=this.helper.triangleCapsuleIntersect(c,this.triangle(t,tri));if(result){hit=true;c.translate(result.normal.multiplyScalar(result.depth));}}
  if(!hit)return false;const v=c.getCenter(new Vector3()).sub(capsule.getCenter(new Vector3())),depth=v.length();return {normal:v.normalize(),depth};
 }
 // Nearest front-facing hit within `far` metres (cells sampled along the ray).
 rayIntersect(ray,far=1000){const ids=new Set(),step=this.cell/2,p=new Vector3(),reach=Math.min(far,5000);
  for(let s=0;s<=reach+step;s+=step){p.copy(ray.origin).addScaledVector(ray.direction,Math.min(s,reach));this.gather(p.x-1,p.x+1,p.z-1,p.z+1,ids);if(Math.abs(ray.direction.x)<1e-9&&Math.abs(ray.direction.z)<1e-9)break;}
  let best=null,distance=Infinity;const tri=new Triangle(),point=new Vector3();
  for(const t of ids){this.triangle(t,tri);if(ray.intersectTriangle(tri.a,tri.b,tri.c,true,point)){const d=point.distanceTo(ray.origin);if(d<distance&&d<=far){distance=d;best={distance:d,triangle:tri.clone(),position:point.clone()};}}}
  return best??false;
 }
}
// GridBody and InstancedMeshBody are static colliders: an identity `motion` (as the static scene's) for whatever stands
// on them (the motor's platform) or sticks in them (arrows).
export class GridBody {
 constructor(name,positions,indices,cell=8){this.name=name;this.tree=new TriangleGrid(positions,indices,cell);this.box=this.tree.box.clone().expandByScalar(0.05);this.triangleCount=indices.length/3;this.static=true;this.motion=new Matrix4();}
 ensure(){return this.tree;}
}

// Many placements of a few meshes, each a rigid (rotation + translation) copy: the island's SlowSpawn rock colliders
// (8,344 MeshColliders of 7 meshes). One octree per mesh in its own space; queries move the capsule or ray into each
// nearby instance's space and the result back, so memory stays per mesh instead of per placement. Instances are
// indexed on an x/z grid by their world bounds. Results match a world-space triangle soup of the same placements.
export class InstancedMeshBody {
 constructor(name,meshes,matrices,meshIndex,cell=64){this.name=name;this.cell=cell;this.tree=this;this.static=true;this.motion=new Matrix4();this.meshes=meshes.map(({positions,indices})=>{
   const tree=new CollisionOctree();let count=0;for(const t of triangles(positions,indices,new Matrix4())){tree.addTriangle(t);count++;}
   const bounds=new Box3();const v=new Vector3();for(const id of indices)bounds.expandByPoint(v.fromArray(positions,id*3));return {tree:count?tree.build():null,bounds,count};});
  // Packed per instance (8,344 rocks): source matrices (Float32, as exported), inverses (Float64) and world bounds.
  this.count=meshIndex.length;this.mesh=meshIndex;this.matrices=matrices;this.inverses=new Float64Array(this.count*16);this.boxes=new Float32Array(this.count*6);
  this.cells=new Map();this.box=new Box3();this.triangleCount=0;const m=new Matrix4(),b=new Box3();
  for(let i=0;i<this.count;i++){const mesh=this.meshes[meshIndex[i]];m.fromArray(matrices,i*16);b.copy(mesh.bounds).applyMatrix4(m);m.invert().toArray(this.inverses,i*16);
   b.min.toArray(this.boxes,i*6);b.max.toArray(this.boxes,i*6+3);this.box.union(b);this.triangleCount+=mesh.count;
   for(let cx=Math.floor(b.min.x/cell);cx<=Math.floor(b.max.x/cell);cx++)for(let cz=Math.floor(b.min.z/cell);cz<=Math.floor(b.max.z/cell);cz++){const k=this.key(cx,cz);let list=this.cells.get(k);if(!list)this.cells.set(k,list=[]);list.push(i);}}
  if(!this.box.isEmpty())this.box.expandByScalar(0.05);
  this._m=new Matrix4();this._i=new Matrix4();this._b=new Box3();
 }
 matrix(i,target=new Matrix4()){return target.fromArray(this.matrices,i*16);}
 inverseMatrix(i,target=new Matrix4()){return target.fromArray(this.inverses,i*16);}
 instanceBounds(i,target=new Box3()){target.min.fromArray(this.boxes,i*6);target.max.fromArray(this.boxes,i*6+3);return target;}
 key(cx,cz){return (cx+100000)*200001+(cz+100000);}
 ensure(){return this;}
 gather(x0,x1,z0,z1,out=new Set()){const c=this.cell;for(let cx=Math.floor(x0/c);cx<=Math.floor(x1/c);cx++)for(let cz=Math.floor(z0/c);cz<=Math.floor(z1/c);cz++){const list=this.cells.get(this.key(cx,cz));if(list)for(const i of list)out.add(i);}return out;}
 // Same accumulation as Octree.capsuleIntersect: each overlap pushes the capsule out before the next one is tested.
 capsuleIntersect(capsule){const c=capsule.clone(),r=capsule.radius,area=new Box3(),local=new Capsule();let hit=false;
  area.min.copy(c.start).min(c.end).subScalar(r);area.max.copy(c.start).max(c.end).addScalar(r);
  for(const i of this.gather(area.min.x,area.max.x,area.min.z,area.max.z)){const tree=this.meshes[this.mesh[i]].tree;if(!tree)continue;
   area.min.copy(c.start).min(c.end).subScalar(r);area.max.copy(c.start).max(c.end).addScalar(r);if(!this.instanceBounds(i,this._b).intersectsBox(area))continue;
   const inv=this.inverseMatrix(i,this._i);local.set(c.start.clone().applyMatrix4(inv),c.end.clone().applyMatrix4(inv),r);
   const result=tree.capsuleIntersect(local);if(result){hit=true;c.translate(result.normal.clone().transformDirection(this.matrix(i,this._m)).multiplyScalar(result.depth));}}
  if(!hit)return false;const v=c.getCenter(new Vector3()).sub(capsule.getCenter(new Vector3())),depth=v.length();return {normal:v.normalize(),depth};
 }
 // Nearest front-facing hit within `far` metres; instances are visited along the ray's cells (2D DDA).
 rayIntersect(ray,far=Infinity){const reach=Math.min(far,5000),c=this.cell,ids=new Set(),o=ray.origin,d=ray.direction;
  let cx=Math.floor(o.x/c),cz=Math.floor(o.z/c);const sx=Math.sign(d.x),sz=Math.sign(d.z),
   tdx=sx?c/Math.abs(d.x):Infinity,tdz=sz?c/Math.abs(d.z):Infinity;let tx=sx?((sx>0?(cx+1)*c-o.x:o.x-cx*c)/Math.abs(d.x)):Infinity,tz=sz?((sz>0?(cz+1)*c-o.z:o.z-cz*c)/Math.abs(d.z)):Infinity;
  for(let guard=0;guard<10000;guard++){const list=this.cells.get(this.key(cx,cz));if(list)for(const i of list)ids.add(i);if(Math.min(tx,tz)>reach)break;if(tx<tz){cx+=sx;tx+=tdx;}else{cz+=sz;tz+=tdz;}}
  let best=null;const entry=new Vector3(),local=new Ray();
  for(const i of ids){const tree=this.meshes[this.mesh[i]].tree,b=this.instanceBounds(i,this._b);if(!tree)continue;
   if(!b.containsPoint(o)){const p=ray.intersectBox(b,entry);if(!p||p.distanceTo(o)>Math.min(far,best?.distance??Infinity))continue;}
   const inv=this.inverseMatrix(i,this._i);local.origin.copy(o).applyMatrix4(inv);local.direction.copy(d).transformDirection(inv);
   const hit=tree.rayIntersect(local,Math.min(far,best?.distance??Infinity));if(!hit||hit.distance>far||best&&hit.distance>=best.distance)continue;
   const m=this.matrix(i),t=hit.triangle;best={distance:hit.distance,position:hit.position.clone().applyMatrix4(m),triangle:new Triangle(t.a.clone().applyMatrix4(m),t.b.clone().applyMatrix4(m),t.c.clone().applyMatrix4(m)),instance:i};}
  return best??false;
 }
 // World-space triangles of the instances overlapping `area` (CollisionWorld.nearbyTriangles).
 nearbyTriangles(area,out){for(const i of this.gather(area.min.x,area.max.x,area.min.z,area.max.z)){if(!this.instanceBounds(i,this._b).intersectsBox(area))continue;const tree=this.meshes[this.mesh[i]].tree;if(!tree)continue;
  const local=area.clone().applyMatrix4(this.inverseMatrix(i)),m=this.matrix(i),walk=node=>{if(node.box&&!node.box.intersectsBox(local))return;
   for(const t of node.triangles??[])if(local.intersectsTriangle(t)){const w=new Triangle(t.a.clone().applyMatrix4(m),t.b.clone().applyMatrix4(m),t.c.clone().applyMatrix4(m));if(area.intersectsTriangle(w))out.add(w);}
   for(const child of node.subTrees??[])walk(child);};walk(tree);}return out;}
}

// A sampled sweep found its first overlap at t (none at t - 0.02): bisect between the two to the first touching
// distance (12 halvings, ~5 �m), as a continuous sweep (Physics.SphereCast) reports it. An overlap at the start stays 0.
function sweepContact(at,t){let lo=Math.max(0,t-0.02),hi=t,hit=at(t);if(t>0)for(let i=0;i<12;i++){const m=(lo+hi)/2,h=at(m);if(h){hi=m;hit=h;}else lo=m;}
 return {...hit,distance:hi};}
export class CollisionWorld {
 constructor(ground){this.tree=new CollisionOctree();this.ground=ground;this.triangleCount=0;this.colliderCount=0;this.bodies=[];}
 addGeometry(positions,indices,matrix=new Matrix4()){for(const t of triangles(positions,indices,matrix)){this.tree.addTriangle(t);this.triangleCount++;}}
 addBox(size,center,matrix){const s=boxShape(size,center);this.addGeometry(s.positions,s.indices,matrix);}
 // A body's companions (its prefab's colliders on other layers) are added and removed with it.
 addBody(body){this.bodies.push(body);for(const c of body.companions??[])this.bodies.push(c);return body;}
 removeBody(body){for(const b of [body,...(body?.companions??[])]){const i=this.bodies.indexOf(b);if(i>=0)this.bodies.splice(i,1);}}
 // Read-only triangle snapshot for cosmetic rigid-body simulation; never adds gameplay collision.
 nearbyTriangles(area,skip=null){const out=new Set();this.eachNearbyTriangles(area,skip,set=>{for(const t of set)out.add(t);});return [...out];}
 // The player motor's sweeps: nearby triangles with the body each belongs to (null: the static scene), filtered like
 // capsuleHit (`skip(null)` excludes the static scene).
 bodyTriangles(area,skip=null){const out=[];this.eachNearbyTriangles(area,skip,(set,body)=>{for(const t of set)out.push({triangle:t,body});},true);return out;}
 // fn(Set of world-space triangles overlapping `area`, body) per source; the static scene comes first with body null.
 eachNearbyTriangles(area,skip,fn,skipStatic=false){
  const gather=(tree,out)=>{if(!tree||tree.box&&!tree.box.intersectsBox(area))return out;
   for(const t of tree.triangles??[])if(area.intersectsTriangle(t))out.add(t);
   for(const child of tree.subTrees??[])gather(child,out);
   return out;
  };
  if(!(skipStatic&&skip?.(null)))fn(gather(this.tree,new Set()),null);
  for(const body of this.bodies){if(skip?.(body)||!body.box?.intersectsBox(area))continue;const tree=body.ensure(),out=new Set();
   if(tree instanceof TriangleGrid){for(const id of tree.gather(area.min.x,area.max.x,area.min.z,area.max.z,new Set())){const t=tree.triangle(id);if(area.intersectsTriangle(t))out.add(t);}}
   else if(tree instanceof InstancedMeshBody)tree.nearbyTriangles(area,out);
   else gather(tree,out);
   fn(out,body);
  }
 }
 // Unity Physics.Raycast equivalent over terrain and all solids: nearest hit within `range` metres.
 raycast(ray,range=Infinity,skip=null){let best=null;const hit=this.rayHit(ray,range,skip);if(hit&&hit.distance<=range)best={position:hit.position,normal:hit.normal??hit.triangle.getNormal(new Vector3()),distance:hit.distance,body:hit.body};
  if(this.ground&&!skip?.(null)&&ray.direction.y<0&&Math.abs(ray.direction.x)<1e-9&&Math.abs(ray.direction.z)<1e-9){const y=this.ground(ray.origin.x,ray.origin.z),d=ray.origin.y-y;if(Number.isFinite(y)&&d>=0&&d<=range&&(!best||d<best.distance))best={position:new Vector3(ray.origin.x,y,ray.origin.z),normal:this.terrainNormal(ray.origin.x,ray.origin.z),distance:d,body:null,terrain:true};}
  return best;}
 // TransformHelpers.GetGroundInfoTerrainOnly: the first thing hit must be the terrain collider.
 raycastTerrainOnly(ray,range){const hit=this.raycast(ray,range);return hit?.terrain?hit:null;}
 // Sphere sweep over the solids (no terrain): SphereCast(radius, range - radius) plus Raycast(range), nearest wins; the
 // sweep is sampled every 2 cm, then refined to the contact (sweepContact). Placement and dev aiming use it; melee uses
 // physics2SphereCast below.
 sphereCast(ray,radius,range,skip=null){let sphere=null;const length=Math.max(0,range-radius);
  sphere=this.sphereSweep(ray,radius,length,skip);
  const r=this.rayHit(ray,range,skip),rayHit=r&&r.distance<=range?{point:r.position,distance:r.distance,body:r.body??null}:null;
  // As in the original, the raycast only competes once the sphere cast has hit something.
  if(!sphere)return null;return rayHit&&rayHit.distance<sphere.distance?rayHit:sphere;}
 // Ray against the terrain heightfield: 0.25 m steps, then 20 bisections to the crossing.
 terrainRay(ray,range){if(!this.ground)return null;const p=new Vector3(),below=t=>{p.copy(ray.origin).addScaledVector(ray.direction,t);const g=this.ground(p.x,p.z);return Number.isFinite(g)&&p.y<g;};if(below(0))return null;
  let prev=0;for(let t=0.25;;t+=0.25){const tt=Math.min(t,range);if(below(tt)){let a=prev,b=tt;for(let i=0;i<20;i++){const m=(a+b)/2;if(below(m))b=m;else a=m;}p.copy(ray.origin).addScaledVector(ray.direction,b);
    return {position:p.clone(),point:p.clone(),normal:this.terrainNormal(p.x,p.z),distance:b,body:null,terrain:true};}prev=tt;if(tt>=range)return null;}}
 // Sphere swept against the heightfield, sampled like sphereCast: the first centre within radius of the (locally planar)
 // surface; the contact is the surface point below that centre along the terrain normal.
 terrainSphereCast(ray,radius,length){if(!this.ground)return null;const c=new Vector3();
  const at=t=>{c.copy(ray.origin).addScaledVector(ray.direction,t);const g=this.ground(c.x,c.z);if(!Number.isFinite(g))return null;const n=this.terrainNormal(c.x,c.z),d=(c.y-g)*n.y;
   return d<=radius?{point:c.clone().addScaledVector(n,-d),normal:n,body:null,terrain:true}:null;};
  for(let t=0;t<=length+1e-9;t+=0.02)if(at(t))return sweepContact(at,t);
  return null;}
 // MeleeWeaponDataBlock.Physics2SphereCast(ray, radius, range, hitMask) (client): Physics.SphereCast(radius, range - radius)
 // and, only once that hit, Physics.Raycast(range), both with hitMask minus layer 17; the nearer is the solid hit. Then
 // Physics2.Raycast2(range, hitMask) (hit-box shapes as well as solids) wins when it hits nearer than the solid hit (or
 // when nothing solid was hit), reporting its body part. With no solid hit, Physics.OverlapSphere(origin, 0.3, layer 17)
 // finding a HitBoxSystem broadphase collider (overlap17(center, radius) -> body) is a hit 0.5 m ahead, normal -direction.
 // The terrain (layer 19) and static scene solids are in the melee mask 406721553; bodies are filtered by their layer.
 physics2SphereCast(ray,radius,range,mask=406721553,{overlap17=null}={}){const inMask=b=>b.layer==null||((mask>>>b.layer)&1)===1;
  const solidSkip=b=>Boolean(b&&(b.bodyPart!=null||b.layer===17||!inMask(b))),anySkip=b=>Boolean(b&&(b.layer===17||!inMask(b))); // a layer-17 HitBoxSystem collider is only a broadphase: Raycast2 tests its hit-box shapes (the port's bodyPart bodies)
  const nearer=(a,b)=>!a?b:!b?a:b.distance<a.distance?b:a,ray3=(skip)=>{const r=this.rayHit(ray,range,skip);return r&&r.distance<=range?{point:r.position,normal:r.normal??r.triangle?.getNormal(new Vector3()),distance:r.distance,body:r.body??null,bodyPart:r.body?.bodyPart}:null;};
  // Physics.SphereCast over solids and terrain; Physics.Raycast only competes once it hit.
  const sweep=nearer(this.sphereSweep(ray,radius,Math.max(0,range-radius),solidSkip),this.terrainSphereCast(ray,radius,Math.max(0,range-radius)));
  let solid=null;if(sweep){solid=sweep;const exact=nearer(ray3(solidSkip),this.terrainRay(ray,range));if(exact&&exact.distance<solid.distance)solid={...exact,bodyPart:undefined};}
  const h2=nearer(ray3(anySkip),this.terrainRay(ray,range));
  if(h2&&(!solid||h2.distance<solid.distance))return h2;
  if(!solid){const b=overlap17?.(ray.origin,0.3);return b?{point:ray.origin.clone().addScaledVector(ray.direction,0.5),normal:ray.direction.clone().negate(),distance:0.5,body:b,bodyPart:undefined,overlap:true}:null;}
  return solid;}
 // The sphere sweep alone over solids: 2 cm steps to the first overlapping position, refined to the contact.
 sphereSweep(ray,radius,length,skip=null){const c=new Vector3(),at=t=>{c.copy(ray.origin).addScaledVector(ray.direction,t);const hit=this.sphereOverlap(c,radius,skip);
  return hit&&{point:c.clone().addScaledVector(hit.normal,-(radius-hit.depth)),normal:hit.normal.clone(),body:hit.body};};
  for(let t=0;t<=length+1e-9;t+=0.02)if(at(t))return sweepContact(at,t);return null;}
 sphereOverlap(center,radius,skip=null){const capsule=this.capsule(new Vector3(center.x,center.y-radius,center.z),2*radius,radius);let best=null;
  const s=this.triangleCount&&!skip?.(null)&&this.tree.capsuleIntersect(capsule);if(s)best={normal:s.normal.clone(),depth:s.depth,body:null};
  const area=new Box3().setFromCenterAndSize(center,new Vector3(2*radius,2*radius,2*radius));
  for(const b of this.bodies){if(skip?.(b)||!b.box||!b.box.intersectsBox(area)||!b.ensure())continue;const h=b.tree.capsuleIntersect(capsule);if(h&&(!best||h.depth>best.depth))best={normal:h.normal.clone(),depth:h.depth,body:b};}
  return best;}
 build(){if(this.triangleCount)this.tree.build();for(const b of this.bodies)if(!b.box)b.setMotion(b.motion);return this;}
 // Deepest penetration across static geometry and moving bodies.
 // Octree returns a shared module vector as the normal, so results are copied before comparing trees.
 // `skip(body)` filters bodies by layer; skip(null) excludes the static scene. The player motor passes its layer filter (noCollide + layer mask); hits carry their body.
 capsuleHit(capsule,skip=null){const own=(hit,body=null)=>hit&&{normal:hit.normal.clone(),depth:hit.depth,body};let best=own(this.triangleCount&&!skip?.(null)&&this.tree.capsuleIntersect(capsule));const area=new Box3(capsule.start.clone().min(capsule.end),capsule.start.clone().max(capsule.end)).expandByScalar(capsule.radius);
  // Player movement ignores bodies flagged noCollide (wildlife boxes; melee still hits them).
  for(const b of this.bodies){if((skip?skip(b):b.noCollide)||!b.box||!b.box.intersectsBox(area)||!b.ensure())continue;const hit=own(b.tree.capsuleIntersect(capsule),b);if(hit&&(!best||hit.depth>best.depth))best=hit;}return best;}
 // Nearest ray hit; `body` is set when the hit belongs to a moving body.
 // `far` limits which moving bodies are considered, so a long ray does not build distant lazy octrees.
 rayHit(ray,far=Infinity,skip=null){let best=this.triangleCount&&!skip?.(null)?this.tree.rayIntersect(ray,far):false;const entry=new Vector3();for(const b of this.bodies){if(!b.box||skip?.(b))continue;if(!b.box.containsPoint(ray.origin)){const p=ray.intersectBox(b.box,entry);if(!p||p.distanceTo(ray.origin)>far)continue;}const hit=b.raycast?b.raycast(ray,far):b.ensure()?.rayIntersect(ray,far);if(hit&&(!best||hit.distance<best.distance))best={...hit,body:b};}return best;}
 capsule(feet,height,radius){return new Capsule(new Vector3(feet.x,feet.y+radius,feet.z),new Vector3(feet.x,feet.y+Math.max(radius,height-radius),feet.z),radius);}
 // `skip(body)` as in capsuleHit (the player motor passes its layer-mask filter).
 resolve(feet,height,radius,skip=null){const c=this.capsule(feet,height,radius),start=c.start.clone(),normals=[];
  for(let i=0;i<5;i++){const hit=this.capsuleHit(c,skip);if(!hit||hit.depth<1e-7)break;c.translate(hit.normal.clone().multiplyScalar(hit.depth+1e-5));normals.push(hit.normal.clone());}
  const delta=c.start.sub(start);feet.add(delta);return normals;
 }
 overlaps(feet,height,radius,tolerance=0.002,skip=null){const hit=this.capsuleHit(this.capsule(feet,height,radius),skip);return Boolean(hit&&hit.depth>tolerance);}
 terrainNormal(x,z){if(!this.ground)return new Vector3(0,1,0);const e=0.1;return new Vector3((this.ground(x-e,z)-this.ground(x+e,z))/(2*e),1,(this.ground(x,z-e)-this.ground(x,z+e))/(2*e)).normalize();}
 // Standing surface under (x,z). Like capsuleHit, bodies flagged noCollide (wildlife boxes, player hit regions) are
 // never ground: the original player CharacterController does not collide with those layers.
 support(x,z,top,bottom){let height=-Infinity,normal=new Vector3(0,1,0);const terrain=this.ground?.(x,z);
  if(Number.isFinite(terrain)&&terrain<=top&&terrain>=bottom){height=terrain;normal=this.terrainNormal(x,z);}
  const hit=this.rayHit(new Ray(new Vector3(x,top,z),new Vector3(0,-1,0)),top-bottom,b=>Boolean(b?.noCollide));
  if(hit&&hit.position.y>=bottom&&hit.position.y>height){height=hit.position.y;normal=hit.triangle.getNormal(new Vector3());}
  return Number.isFinite(height)?{height,normal}:null;
 }
}

// A prefab's solid colliders grouped by layer: queries filter by a body's layer, so main.mjs prefabBody makes one body per
// layer, the others companions of the `main` one: the only solid layer, else the root's layer when it has solids, else the
// first (the root's when there are none; spike walls keep a layer-26 trigger on the root and the solid box on layer 10).
export function solidLayerGroups(colliders,rootLayer){const groups=new Map();for(const c of colliders){if(c.trigger)continue;if(!groups.has(c.layer))groups.set(c.layer,[]);groups.get(c.layer).push(c);}
 const layers=[...groups.keys()],main=layers.length===1?layers[0]:groups.has(rootLayer)?rootLayer:layers[0]??rootLayer;return {main,groups,layers};}

// SpawnManager.InstallSpawns (client and server alike) records each child spawn point and then destroys it on Awake,
// with the 1 x 2 x 1 "Cube" box collider every spawn point carries; the scene export still lists those 63 boxes, which
// would stand solid (layer 0) at every spawn in the port's world and the gateway's trace world.
export function isSpawnMarker(c,spawnPoints){if(c.type!=='BoxCollider'||c.name!=='Cube'||!spawnPoints?.length)return false;const m=c.matrix;
 return spawnPoints.some(s=>{const p=s.position??s;return Math.abs(m[12]-p[0])<0.01&&Math.abs(m[14]-p[2])<0.01&&m[13]-p[1]>-0.01&&m[13]-p[1]<2.01;});}

export async function buildOriginalCollision(original,ground,onProgress){const world=new CollisionWorld(ground),{manifest,binary}=original,bodies=new Map();
 for(const c of manifest.colliders){if(isSpawnMarker(c,manifest.world?.spawnPoints))continue;const matrix=new Matrix4().fromArray(c.matrix);
  // Colliders under a MovingDoor move with it; they are kept out of the static octree.
  let target=world;if(c.door!==undefined){if(!bodies.has(c.door))bodies.set(c.door,world.addBody(new MovingBody(manifest.doors[c.door].name)));target=bodies.get(c.door);
   // Door colliders keep their original layer (MovingDoors are layer 20 Mechanical) for layer-masked queries.
   target.layer??=c.layer;target.solidLayers=[...new Set([...(target.solidLayers??[]),c.layer])];}
  if(c.type==='MeshCollider'){const m=manifest.meshes[c.mesh],positions=await binary(m.position,Float32Array);for(const part of m.parts)target.addGeometry(positions,await binary(part,Uint32Array),matrix);}
  else if(c.type==='BoxCollider')target.addBox(c.size,c.center,matrix);
  else throw Error(`Unsupported original solid: ${c.type}`);
  world.colliderCount++;if(world.colliderCount%40===0){onProgress?.(world.colliderCount);await new Promise(r=>setTimeout(r,0));}
 }
 world.doorBodies=bodies;return world.build();
}
