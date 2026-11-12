// Unity coordinates become Three coordinates (x,y,-z). Grid rows follow Unity +Z.
export function worldToGrid(x,z,extent=16000,segments=512) {
  return [(x+7999.99951171875)/extent*segments,(8000-z)/extent*segments];
}
// Unity's terrain surface: every heightmap cell is two triangles split along the (x,z)-(x+1,z+1) diagonal (grid x along
// Unity +X, z along Unity +Z). Heightmap::GetInterpolatedHeight, the PhysX TerrainCollider the server's TruthDetector
// traces against, and the terrain mesh all use it: the 29,050 terrain trees (snapped to it by the editor) sit on it to
// 0.1 mm, and it reproduces every blocked-trace rollback of the 2026-10-23 real runs (GAP-AUDIT T4). The other diagonal
// put the port's ground under the server's on convex cells (1.35 m mid-cell at one of those spots) and over it on concave.
export function cellHeight(a,b,c,d,u,v) {
  return u>=v ? a+(b-a)*u+(d-b)*v : a+(c-a)*v+(d-c)*u;
}
export function sampleTriangle(heights,size,gx,gz) {
  gx=Math.max(0,Math.min(size-1,gx)); gz=Math.max(0,Math.min(size-1,gz));
  const x=Math.min(size-2,Math.floor(gx)), z=Math.min(size-2,Math.floor(gz));
  return cellHeight(heights[z*size+x],heights[z*size+x+1],heights[(z+1)*size+x],heights[(z+1)*size+x+1],gx-x,gz-z);
}
export function makeTerrain(full,size,step=4) {
  const n=(size-1)/step+1, heights=new Float32Array(n*n), positions=new Float32Array(n*n*3), uv=new Float32Array(n*n*2), indices=[];
  for(let z=0;z<n;z++)for(let x=0;x<n;x++) {
    const i=z*n+x; heights[i]=full[z*step*size+x*step];
    positions.set([x/(n-1)*16000-7999.99951171875,heights[i],8000-z/(n-1)*16000],i*3);
    uv.set([x/(n-1),z/(n-1)],i*2);
    if(x<n-1&&z<n-1){ const a=i,b=i+1,c=i+n,d=i+n+1;indices.push(a,b,d,a,d,c); }
  }
  return {heights,size:n,positions,uv,indices};
}
