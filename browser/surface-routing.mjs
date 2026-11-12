// SurfaceInfo.GetSurfaceInfoFor + SurfaceInfoTerrain.SurfaceObj. No inferred material names.
// Native OLD_GetMainTexture uses the first strict maximum, unlike the unused cache's >=.
export function terrainSurfaceIndex(terrain,indices,point){
 if(!terrain||!indices)return 0;
 const [x,,z]=point,ix=Math.trunc((x-terrain.origin[0])/terrain.extent[0]*terrain.width),iz=Math.trunc((-z-terrain.origin[2])/terrain.extent[1]*terrain.height);
 if(ix<0||iz<0||ix>=terrain.width||iz>=terrain.height)return 0;
 return indices[iz*terrain.width+ix]??0;
}
export function createSurfaceResolver(manifest,indices){
 const routes=manifest.surfaceRoutes??{},defs=manifest.surfaces??{};
 return hit=>{
  let key;
  if(hit.terrain){const t=routes.terrain,i=terrainSurfaceIndex(t,indices,hit.point);key=t?.surfaces[i]??t?.surfaces[0];}
  else{
   const b=hit.body,prefab=b?.surfacePrefab??b?.deployed?.prefab??b?.structure?.prefab??b?.resourceNode?.prefab??b?.crate?.prefab;
   const explicit=prefab?.components?.SurfaceInfo?.[0];
   const name=b?.surfaceName??prefab?.name??b?.animal?.def?.name;
   key=explicit?explicit.surface:routes.actors?.[name];
  }
  return defs[key??manifest.defaultSurface]??defs[manifest.defaultSurface];
 };
}
