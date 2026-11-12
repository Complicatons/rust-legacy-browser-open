// The original island navmesh (exported by tools/export_navmesh.py from the server's Detour tile set) and the parts
// of Unity's NavMesh/NavMeshAgent the animals use: SamplePosition, path finding (A* over polygons through Detour's
// portal edge midpoints, partial path to the closest reached polygon), straight-path string pulling (Detour's
// findStraightPath funnel) and surface-constrained movement. All coordinates are Unity space.
import {Vector3} from 'three';

const FILES={verts:['verts.f32',Float32Array],polyVerts:['poly-verts.u32',Uint32Array],polyIndex:['poly-index.u32',Uint32Array],
 linkStart:['link-start.u32',Uint32Array],linkTo:['link-to.u32',Uint32Array],linkEdge:['link-edge.u8',Uint8Array],linkRange:['link-range.u8',Uint8Array]};
export async function loadNavMesh(base,fetchImpl=fetch){
 const out={};await Promise.all(Object.entries(FILES).map(async([k,[file,T]])=>{const r=await fetchImpl(new URL(file,base));if(!r.ok)throw Error('Navmesh file missing: '+file);out[k]=new T(await r.arrayBuffer());}));
 return new NavMesh(out);
}

// Detour dtTriArea2D (xz).
const triArea2D=(a,b,c)=>(c.x-a.x)*(b.z-a.z)-(b.x-a.x)*(c.z-a.z);
const H_SCALE=0.999;

class Heap{constructor(){this.a=[];}push(n){const a=this.a;a.push(n);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=n.f)break;a[i]=a[p];i=p;}a[i]=n;}
 pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){let i=0;for(;;){let c=2*i+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c;}a[i]=last;}return top;}
 get size(){return this.a.length;}}

export class NavMesh {
 constructor({verts,polyVerts,polyIndex,linkStart,linkTo,linkEdge,linkRange},{cell=16}={}){
  Object.assign(this,{verts,polyVerts,polyIndex,linkStart,linkTo,linkEdge,linkRange,cell});
  const n=this.polyCount=polyVerts.length-1;this.bounds=new Float32Array(n*6);
  let gx0=Infinity,gz0=Infinity,gx1=-Infinity,gz1=-Infinity;
  for(let p=0;p<n;p++){let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;
   for(let k=polyVerts[p];k<polyVerts[p+1];k++){const v=polyIndex[k]*3,x=verts[v],y=verts[v+1],z=verts[v+2];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;if(z<z0)z0=z;if(z>z1)z1=z;}
   this.bounds.set([x0,y0,z0,x1,y1,z1],p*6);if(x0<gx0)gx0=x0;if(z0<gz0)gz0=z0;if(x1>gx1)gx1=x1;if(z1>gz1)gz1=z1;}
  // Uniform xz grid (CSR) of polygons by bounding box.
  this.gx0=gx0;this.gz0=gz0;this.gw=Math.max(1,Math.ceil((gx1-gx0)/cell)+1);this.gh=Math.max(1,Math.ceil((gz1-gz0)/cell)+1);
  const counts=new Uint32Array(this.gw*this.gh+1),each=f=>{for(let p=0;p<n;p++){const b=p*6,cx0=this.cx(this.bounds[b]),cx1=this.cx(this.bounds[b+3]),cz0=this.cz(this.bounds[b+2]),cz1=this.cz(this.bounds[b+5]);for(let z=cz0;z<=cz1;z++)for(let x=cx0;x<=cx1;x++)f(z*this.gw+x,p);}};
  each(c=>counts[c+1]++);for(let i=1;i<counts.length;i++)counts[i]+=counts[i-1];
  this.cellStart=counts;this.cellPolys=new Uint32Array(counts[counts.length-1]);const fill=counts.slice(0,-1);each((c,p)=>{this.cellPolys[fill[c]++]=p;});
 }
 cx(x){return Math.min(this.gw-1,Math.max(0,Math.floor((x-this.gx0)/this.cell)));}
 cz(z){return Math.min(this.gh-1,Math.max(0,Math.floor((z-this.gz0)/this.cell)));}
 vert(i,out=new Vector3()){const v=i*3;return out.set(this.verts[v],this.verts[v+1],this.verts[v+2]);}
 polyVert(p,k,out){return this.vert(this.polyIndex[this.polyVerts[p]+k],out);}
 vertCount(p){return this.polyVerts[p+1]-this.polyVerts[p];}
 center(p,out=new Vector3()){out.set(0,0,0);const n=this.vertCount(p),v=new Vector3();for(let k=0;k<n;k++)out.add(this.polyVert(p,k,v));return out.divideScalar(n);}
 // Polygons whose xz bounds overlap the box (deduplicated).
 query(x0,z0,x1,z1,y0=-Infinity,y1=Infinity){const seen=new Set();
  for(let z=this.cz(z0);z<=this.cz(z1);z++)for(let x=this.cx(x0);x<=this.cx(x1);x++){const c=z*this.gw+x;
   for(let i=this.cellStart[c];i<this.cellStart[c+1];i++){const p=this.cellPolys[i],b=p*6;if(seen.has(p))continue;
    if(this.bounds[b]>x1||this.bounds[b+3]<x0||this.bounds[b+2]>z1||this.bounds[b+5]<z0||this.bounds[b+1]>y1||this.bounds[b+4]<y0)continue;seen.add(p);}}
  return seen;}
 // Height of the polygon's surface at (x,z) via its vertex fan, or null when (x,z) is outside it.
 heightAt(p,x,z){const n=this.vertCount(p),a=this.polyVert(p,0),b=new Vector3(),c=new Vector3();
  for(let k=1;k<n-1;k++){this.polyVert(p,k,b);this.polyVert(p,k+1,c);
   const d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(d)<1e-12)continue;
   const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/d,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/d,w=1-u-v,e=-1e-5;
   if(u>=e&&v>=e&&w>=e)return u*a.y+v*b.y+w*c.y;}
  return null;}
 closestPointOnPoly(p,pos,out=new Vector3()){const h=this.heightAt(p,pos.x,pos.z);if(h!==null)return out.set(pos.x,h,pos.z);
  const n=this.vertCount(p),a=new Vector3(),b=new Vector3(),q=new Vector3();let best=Infinity;
  for(let k=0;k<n;k++){this.polyVert(p,k,a);this.polyVert(p,(k+1)%n,b);const ab=b.clone().sub(a),len=ab.x*ab.x+ab.z*ab.z;
   const t=len>0?Math.min(1,Math.max(0,((pos.x-a.x)*ab.x+(pos.z-a.z)*ab.z)/len)):0;q.copy(a).addScaledVector(ab,t);const d=q.distanceToSquared(pos);if(d<best){best=d;out.copy(q);}}
  return out;}
 // dtNavMeshQuery.findNearestPoly within a half-extent box (Unity's agent placement uses this).
 findNearest(pos,ext={x:2,y:4,z:2}){let best=null,bestD=Infinity;const q=new Vector3();
  for(const p of this.query(pos.x-ext.x,pos.z-ext.z,pos.x+ext.x,pos.z+ext.z,pos.y-ext.y,pos.y+ext.y)){this.closestPointOnPoly(p,pos,q);const d=q.distanceToSquared(pos);if(d<bestD){bestD=d;best={poly:p,point:q.clone()};}}
  return best;}
 // NavMesh.SamplePosition: nearest navmesh point within maxDistance (sphere).
 samplePosition(pos,maxDistance){const hit=this.findNearest(pos,{x:maxDistance,y:maxDistance,z:maxDistance});return hit&&hit.point.distanceTo(pos)<=maxDistance?hit:null;}
 // The surface directly under/over (x,z): the polygon whose height is closest to pos.y within [-down, +up].
 groundAt(pos,up=5,down=1000){let best=null,bestD=Infinity;
  for(const p of this.query(pos.x,pos.z,pos.x,pos.z,pos.y-down,pos.y+up)){const h=this.heightAt(p,pos.x,pos.z);if(h===null||h>pos.y+up||h<pos.y-down)continue;const d=Math.abs(h-pos.y);if(d<bestD){bestD=d;best={poly:p,point:new Vector3(pos.x,h,pos.z)};}}
  return best;}
 // TransformHelpers.GetGroundInfoNavMesh (spawning): ground along the vertical line, else SamplePosition(15).
 groundInfo(pos,maxVariationFallback=15){return this.groundAt(pos)??this.samplePosition(pos,maxVariationFallback);}
 *links(p){for(let i=this.linkStart[p];i<this.linkStart[p+1];i++)yield i;}
 linkBetween(a,b){for(const i of this.links(a))if(this.linkTo[i]===b)return i;return -1;}
 // dtNavMeshQuery::getPortalPoints; oriented so `left` is on the walker's left coming from `from` (Detour funnel convention).
 portal(a,b,from){const i=this.linkBetween(a,b);if(i<0)return null;const e=this.linkEdge[i],n=this.vertCount(a);
  let l=this.polyVert(a,e),r=this.polyVert(a,(e+1)%n);const lo=this.linkRange[i*2],hi=this.linkRange[i*2+1];
  if(lo!==0||hi!==255){const d=r.clone().sub(l);[l,r]=[l.clone().addScaledVector(d,lo/255),l.clone().addScaledVector(d,hi/255)];}
  if(triArea2D(from,l,r)<0)[l,r]=[r,l];
  return {left:l,right:r};}
 edgeMid(a,b,from){const pt=this.portal(a,b,from??this.center(a));return pt?pt.left.clone().add(pt.right).multiplyScalar(0.5):this.center(b);}
 // dtNavMeshQuery::findPath: A* from start to end polygon; partial path to the node closest to the goal when
 // the node pool runs out or the goal is unreachable.
 findPath(startPoly,start,endPoly,end,maxNodes=2048){
  if(startPoly===endPoly)return {polys:[startPoly],partial:false};
  const nodes=new Map(),open=new Heap(),first={poly:startPoly,pos:start.clone(),g:0,f:start.distanceTo(end)*H_SCALE,parent:null,closed:false};
  nodes.set(startPoly,first);open.push(first);let last=first,lastH=first.f;
  while(open.size){const best=open.pop();if(best.closed)continue;best.closed=true;
   if(best.poly===endPoly){last=best;break;}
   for(const i of this.links(best.poly)){const nb=this.linkTo[i];if(best.parent&&nb===best.parent.poly)continue;
    let node=nodes.get(nb);if(!node){if(nodes.size>=maxNodes)continue;node={poly:nb,pos:this.edgeMid(best.poly,nb,best.pos),g:Infinity,f:Infinity,parent:null,closed:false};nodes.set(nb,node);}
    const g=best.g+best.pos.distanceTo(node.pos)+(nb===endPoly?node.pos.distanceTo(end):0),h=nb===endPoly?0:node.pos.distanceTo(end)*H_SCALE;
    if(g>=node.g)continue;node.g=g;node.f=g+h;node.parent=best;node.closed=false;open.push(node);
    if(h<lastH){lastH=h;last=node;}}}
  const polys=[];for(let n=last;n;n=n.parent)polys.push(n.poly);polys.reverse();
  return {polys,partial:polys[polys.length-1]!==endPoly};}
 // dtNavMeshQuery::findStraightPath (no area/offmesh flags): corners from start to end through the corridor. With
 // `maxCorners` the funnel stops once that many corners are found (the end is then not included).
 straightPath(start,end,polys,{maxCorners=Infinity}={}){const corners=[];if(!polys.length)return corners;
  const portals=[];let from=start;for(let i=0;i+1<polys.length;i++){const pt=this.portal(polys[i],polys[i+1],from);if(!pt)break;portals.push(pt);from=pt.left.clone().add(pt.right).multiplyScalar(0.5);}
  portals.push({left:end,right:end});
  let apex=start.clone(),left=start.clone(),right=start.clone(),apexI=0,leftI=0,rightI=0;const eq=(a,b)=>(a.x-b.x)**2+(a.z-b.z)**2<1e-6;
  for(let i=0;i<portals.length;i++){const {left:l,right:r}=portals[i];
   if(triArea2D(apex,right,r)<=0){
    if(eq(apex,right)||triArea2D(apex,left,r)>0){right=r.clone();rightI=i;}
    else {apex=left.clone();apexI=leftI;if(!corners.length||!eq(corners[corners.length-1],apex))corners.push(apex.clone());if(corners.length>=maxCorners)return corners;left=apex.clone();right=apex.clone();leftI=rightI=apexI;i=apexI;continue;}}
   if(triArea2D(apex,left,l)>=0){
    if(eq(apex,left)||triArea2D(apex,right,l)<0){left=l.clone();leftI=i;}
    else {apex=right.clone();apexI=rightI;if(!corners.length||!eq(corners[corners.length-1],apex))corners.push(apex.clone());if(corners.length>=maxCorners)return corners;left=apex.clone();right=apex.clone();leftI=rightI=apexI;i=apexI;continue;}}}
  corners.push(end.clone());return corners;}
 // NavMeshAgent.SetDestination: both ends are snapped to the mesh; an unreachable target yields a partial path.
 // `startPoly` (an agent's current polygon) replaces the nearest-polygon lookup for the start.
 plan(from,to,{ext={x:2,y:4,z:2},maxNodes=2048,startPoly=-1}={}){
  const s=startPoly>=0?{poly:startPoly,point:this.closestPointOnPoly(startPoly,from)}:this.findNearest(from,ext);if(!s)return null;const e=this.findNearest(to,ext)??this.samplePosition(to,20);if(!e)return null;
  const path=this.findPath(s.poly,s.point,e.poly,e.point,maxNodes);
  const end=path.partial?this.closestPointOnPoly(path.polys[path.polys.length-1],e.point):e.point;
  return {polys:path.polys,partial:path.partial,corners:this.straightPath(s.point,end,path.polys),start:s.point,end};}
 // dtNavMeshQuery::moveAlongSurface (simplified): walk from `poly` toward `target` through neighbouring polygons
 // and stop at the boundary when leaving the mesh. Returns {poly, point, visited} (visited polygons in order).
 moveAlongSurface(poly,from,target){let p=poly;const visited=new Set([p]),order=()=>[...visited];
  for(let steps=0;steps<16;steps++){const h=this.heightAt(p,target.x,target.z);if(h!==null)return {poly:p,point:new Vector3(target.x,h,target.z),visited:order()};
   let next=-1;for(const i of this.links(p)){const nb=this.linkTo[i];if(visited.has(nb))continue;if(this.heightAt(nb,target.x,target.z)!==null){next=nb;break;}}
   if(next<0){// cross the edge the segment exits through, if it leads anywhere
    const pt=this.closestPointOnPoly(p,target);let crossed=-1;for(const i of this.links(p)){const nb=this.linkTo[i];if(visited.has(nb))continue;const q=this.closestPointOnPoly(nb,pt);if(q.distanceToSquared(pt)<1e-4){crossed=nb;break;}}
    if(crossed<0)return {poly:p,point:pt,visited:order()};next=crossed;}
   visited.add(next);p=next;}
  return {poly:p,point:this.closestPointOnPoly(p,target),visited:order()};}
}
