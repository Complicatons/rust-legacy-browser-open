// CameraFX.PostPreCull with the PlayerCamera's AdaptiveNearPlane (maxNear 0.65, minNear 0.22, threshold 0.05,
// ignoreLayers 16 + 17, forceLayers 0; the camera culls nothing, so the mask is every layer but 16 and 17):
//  - Physics.OverlapSphere(eye, minNear + maxNear, mask) picks the colliders (Unity 4: by their bounds);
//  - an 8 x 8 grid ((i - 3.5) / 3.5 in NDC x and y) is unprojected at NDC z 0 and 1 through the double-precision
//    Matrix4x4G.Perspective(fov, aspect, minNear, maxNear + threshold) (OpenGL depth -1..1, so z 0 is the harmonic mean
//    of the two planes, not the near plane) and each segment is cast against those colliders (Collider.Raycast, length
//    = the segment, shortened by every nearer hit);
//  - a hit at distance d on a segment of length L gives minNear + d / L * (maxNear + threshold - minNear); the smallest,
//    minus threshold and clamped to minNear..maxNear, is the near plane; no hit leaves maxNear.
// The original negates the unprojected points into Unity's +z-forward camera space, which mirrors x and y too; the
// grid is symmetric, so the same 64 segments are cast here in three's -z-forward camera space.
export const ADAPTIVE_NEAR_PLANE={maxNear:Math.fround(0.65),minNear:Math.fround(0.22),threshold:Math.fround(0.05),ignoreLayers:196608,forceLayers:0,cullingMask:0xffffffff};
export const adaptiveNearMask=(s=ADAPTIVE_NEAR_PLANE)=>((s.cullingMask&~s.ignoreLayers)|s.forceLayers)>>>0;

// Matrix4x4G.Perspective then Inverse (doubles), applied with Mult's w divide.
function inversePerspective(fovy,aspect,znear,zfar){const h=znear*Math.tan(fovy*Math.PI/360),w=h*aspect,n2=2*znear,d=zfar-znear;
 const m00=n2/(w*2),m11=n2/(h*2),m22=(-zfar-znear)/d,m23=-n2*zfar/d; // m32 = -1, m33 = 0
 // The inverse of [[m00,0,0,0],[0,m11,0,0],[0,0,m22,m23],[0,0,-1,0]] with the divide: view z = -m23 / (Z + m22).
 return (x,y,z)=>{const vz=-m23/(z+m22),w=-vz;return [x*w/m00,y*w/m11,vz];};
}

// camera: {matrixWorld (three Matrix4), fov (vertical degrees), aspect}; cast(origin [x,y,z], direction [x,y,z]
// (unit), maxDistance) -> nearest hit distance within maxDistance, or null. Returns {near, hits, nearest}.
// prepare(min, max), when given, is called once with the bounds of all 64 segments before any cast.
export function adaptiveNearPlane(camera,cast,s=ADAPTIVE_NEAR_PLANE,prepare=null){const f32=Math.fround,e=camera.matrixWorld.elements;
 const unproject=inversePerspective(camera.fov,camera.aspect,s.minNear,s.maxNear+s.threshold),world=([x,y,z])=>[e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]];
 const minNear=s.minNear,span=f32(s.maxNear+s.threshold-minNear),segments=[],lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let best=Infinity,hits=0;
 for(let i=0;i<8;i++)for(let j=0;j<8;j++){const nx=(i-3.5)/3.5,ny=(j-3.5)/3.5,a=world(unproject(nx,ny,0)),b=world(unproject(nx,ny,1));segments.push([a,b]);
  for(const p of [a,b])for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}}
 prepare?.(lo,hi);
 for(const [a,b] of segments){const v=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],length=f32(Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]));
  const d=cast(a.map(f32),v.map(c=>c/length),length);if(d==null||!(d<length))continue;hits++;
  const value=f32(minNear+f32(f32(d)/length)*span);if(best>value)best=value;}
 if(!Number.isFinite(best))return {near:s.maxNear,hits,nearest:null};
 const n=f32(best-s.threshold);return {near:n>=s.maxNear?s.maxNear:n<=s.minNear?s.minNear:n,hits,nearest:best};}

// Unity 4 Physics.OverlapSphere: a collider is a candidate when its bounds touch the sphere (eye, minNear + maxNear).
export function boundsTouchSphere(box,center,radius){let d=0;for(const k of ['x','y','z']){const c=center[k],lo=box.min[k],hi=box.max[k];if(c<lo)d+=(lo-c)**2;else if(c>hi)d+=(c-hi)**2;}return d<=radius*radius;}
