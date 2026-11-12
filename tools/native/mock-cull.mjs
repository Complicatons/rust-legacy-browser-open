// The original server's network culling grid, for the mock referee (tools/native/mock-world.mjs). Static reading only:
// analysis/decompiled/server/Assembly-CSharp CullGrid.cs (CullGridRuntime.FlatCell, EnumerateNearbyCells), the island
// scene's __CULL_GRID component (setup: 200 m cells, 80 x 80, groups from 100, 3 x 3 gathering with every bit set,
// transform at the origin), NetCull.CullProcessor (a moving view's group follows its cell) and uLink's group change
// (uLink O1629.O3135: players in the old and the new group get ChangeGroup, players only in the new group get a
// BufferedRPCs with the view's buffered Create, players only in the old group get DestroyByViewID, the owner always
// gets ChangeGroup). A player is subscribed to the 3 x 3 cells around its character's cell (CullGrid
// SetPlayerCenterFromGroupID: AddPlayerToGroup sends the new groups' buffered views, RemovePlayerFromGroup sends
// DestroyInGroup for a group that still has views).
export const CULL_GRID=Object.freeze({cellSquareDimension:200,cellsWide:80,cellsTall:80,groupBegin:100,gatheringCellsWide:3,gatheringCellsTall:3,gatheringCellsCenter:4});

// CullGridRuntime: flat_wide_ofs = cellSquareDimension * (cellsWide / 2 - (1 - (cellsWide & 1)) / 2) (7900 m here);
// x = floor((point.x + ofs) / size) clamped to the grid, y the same from Unity z. Unity-space position [x, y, z].
const offset=(n,size)=>size*(n/2-(1-(n&1))/2);
export function cullCell([x,,z],g=CULL_GRID){
 const axis=(v,n)=>{const d=v+offset(n,g.cellSquareDimension);return d<=0?0:d>=(n-1)*g.cellSquareDimension?n-1:Math.floor(d/g.cellSquareDimension);};
 return axis(z,g.cellsTall)*g.cellsWide+axis(x,g.cellsWide);
}
export const cullGroup=(position,g=CULL_GRID)=>g.groupBegin+cullCell(position,g);
// EnumerateNearbyCells: the gathering window around the cell (centre index 4 of 3 x 3), clipped at the grid's edge.
export function nearbyGroups(group,g=CULL_GRID){
 const cell=group-g.groupBegin,cx=cell%g.cellsWide,cy=Math.floor(cell/g.cellsWide),out=new Set();
 const ox=-(g.gatheringCellsCenter%g.gatheringCellsWide),oy=-Math.floor(g.gatheringCellsCenter/g.gatheringCellsWide);
 for(let j=0;j<g.gatheringCellsWide;j++)for(let k=0;k<g.gatheringCellsTall;k++){const x=cx+ox+j,y=cy+oy+k;
  if(x>=0&&x<g.cellsWide&&y>=0&&y<g.cellsTall)out.add(g.groupBegin+y*g.cellsWide+x);}
 return out;
}
// Who hears what when a view moves from one group to another (O1629.O3135), for each player that is not the owner.
export function groupChangeFor(subscribed,from,to){
 const inOld=subscribed.has(from),inNew=subscribed.has(to);
 return inOld&&inNew?'change':inNew?'create':inOld?'destroy':null;
}
