// Island map viewer maths (DOM-free). North-up: the scene's z is −Unity z, so north is the smallest z and sits at
// the top; x (east) runs right. A view is {window, width, height, scale (px per metre), cx, cz (centre, metres)}.
export const MAX_ZOOM=16;

export function createView({window,width,height}){
 const fit=Math.min(width/(window.x1-window.x0),height/(window.z1-window.z0));
 return {window,width,height,fit,scale:fit,cx:(window.x0+window.x1)/2,cz:(window.z0+window.z1)/2};
}
export const worldToScreen=(v,[x,z])=>[v.width/2+(x-v.cx)*v.scale,v.height/2+(z-v.cz)*v.scale];
export const screenToWorld=(v,[px,py])=>[v.cx+(px-v.width/2)/v.scale,v.cz+(py-v.height/2)/v.scale];

// Zoom by `factor` about a screen point, which stays over the same ground; clamped between fit and 16x fit.
export function zoomAt(v,factor,[px,py]){
 const [wx,wz]=screenToWorld(v,[px,py]),scale=Math.min(v.fit*MAX_ZOOM,Math.max(v.fit,v.scale*factor));
 return clampView({...v,scale,cx:wx-(px-v.width/2)/scale,cz:wz-(py-v.height/2)/scale});
}
// Keep the centre inside the window so the island can't be dragged away.
export function clampView(v){
 const {x0,x1,z0,z1}=v.window,clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
 return {...v,cx:clamp(v.cx,x0,x1),cz:clamp(v.cz,z0,z1)};
}
export const pan=(v,dx,dy)=>clampView({...v,cx:v.cx-dx/v.scale,cz:v.cz-dy/v.scale});

// 16 x 16 squares: letters A–P west to east, numbers 1–16 north to south.
export function gridLabel([x,z],w){
 const u=(x-w.x0)/(w.x1-w.x0),t=(z-w.z0)/(w.z1-w.z0);
 if(u<0||u>=1||t<0||t>=1)return null;
 return String.fromCharCode(65+Math.floor(u*16))+(Math.floor(t*16)+1);
}

// Tiles of a pyramid (manifest {size, tile, levels}) covering the view, at the coarsest level that is still sharp.
export function tilesFor(v,m,{base,dpr=1}={}){
 const span=v.window.x1-v.window.x0,need=Math.log2(v.scale*dpr*span/m.size);
 const z=Math.max(0,Math.min(m.levels,m.levels+Math.ceil(need-1e-9)));
 const levelPx=m.size*2**(z-m.levels),tileMetres=m.tile*span/levelPx,n=Math.ceil(levelPx/m.tile),size=tileMetres*v.scale;
 const [wx0,wz0]=screenToWorld(v,[0,0]),[wx1,wz1]=screenToWorld(v,[v.width,v.height]);
 const tx0=Math.max(0,Math.floor((wx0-v.window.x0)/tileMetres)),tx1=Math.min(n-1,Math.floor((wx1-v.window.x0)/tileMetres));
 const ty0=Math.max(0,Math.floor((wz0-v.window.z0)/tileMetres)),ty1=Math.min(n-1,Math.floor((wz1-v.window.z0)/tileMetres));
 const out=[];
 for(let y=ty0;y<=ty1;y++)for(let x=tx0;x<=tx1;x++){
  const [left,top]=worldToScreen(v,[v.window.x0+x*tileMetres,v.window.z0+y*tileMetres]);
  out.push({z,x,y,url:`${base}${z}/${x}_${y}.jpg`,left,top,size});
 }
 return out;
}

// Least-squares affine map image → world from control points [{image:[u,v], world:[x,z]}] (≥3): x = a u + b v + c, z = d u + e v + f.
export function fitAffine(points){
 const solve=target=>{
  const A=[[0,0,0],[0,0,0],[0,0,0]],r=[0,0,0];
  for(const p of points){const row=[p.image[0],p.image[1],1],t=target(p);for(let i=0;i<3;i++){r[i]+=row[i]*t;for(let j=0;j<3;j++)A[i][j]+=row[i]*row[j];}}
  for(let i=0;i<3;i++){let k=i;for(let j=i+1;j<3;j++)if(Math.abs(A[j][i])>Math.abs(A[k][i]))k=j;[A[i],A[k]]=[A[k],A[i]];[r[i],r[k]]=[r[k],r[i]];
   for(let j=i+1;j<3;j++){const f=A[j][i]/A[i][i];for(let c=i;c<3;c++)A[j][c]-=f*A[i][c];r[j]-=f*r[i];}}
  const x=[0,0,0];for(let i=2;i>=0;i--){let s=r[i];for(let j=i+1;j<3;j++)s-=A[i][j]*x[j];x[i]=s/A[i][i];}
  return x;
 };
 return [...solve(p=>p.world[0]),...solve(p=>p.world[1])];
}
