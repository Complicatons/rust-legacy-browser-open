// The Island page's modern map, built from the original scene (static data only): real building footprints from their
// meshes, radiation zones, spawns and named places. Output: site/generated/map/modern.json, then
// `tools/site_map_tiles.py` draws the base raster tiles (terrain, and the scene's meshes and trees seen from above).
//   node tools/site-map.mjs modern
//   node tools/site-map.mjs classic --image <file> --points <json> [--credit <text>]   (points: [{image:[u,v], world:[x,z]}], ≥3)
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {fitAffine} from '../site/js/map-viewer-math.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Playable window in scene coordinates (x east, z as stored in the scene manifest).
export const WINDOW={x0:4000,x1:7400,z0:2600,z1:6000};

// Static spawn data for the map (nothing live): fixed loot-crate spawners, animal/mutant/resource spawn zones and the
// scene's no-build circles, all inside the playable window.
const inWin=(x,z)=>x>=WINDOW.x0&&x<=WINDOW.x1&&z>=WINDOW.z0&&z<=WINDOW.z1;
const words=n=>n.replace(/([a-z])([A-Z])/g,'$1 $2');
// ':wolf_prefab' → Wolf, ':mutant_bear' → Mutant Bear, ';res_ore_1' → Ore 1, ';res_woodpile' → Wood Pile.
const spawnName=p=>String(p).replace(/^[:;]/,'').replace(/^res_/,'').replace(/_prefab(_a)?$/,'').replace(/^woodpile$/,'wood_pile').split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
export function lootSpawns(loot){
 return loot.spawners.filter(s=>inWin(s.position[0],s.position[2])).map(s=>{const total=s.chances.reduce((n,c)=>n+c.weight,0);
  return {x:Math.round(s.position[0]),z:Math.round(s.position[2]),crates:s.chances.map(c=>({name:words(loot.prefabs[c.prefab]?.name??'Crate'),chance:Math.round(c.weight/total*1000)/1000})),respawn:[s.spawnTimeMin,s.spawnTimeMax]};});
}
export function spawnZones(resources){
 return resources.spawners.filter(s=>inWin(s.position[0],s.position[2])).map(s=>{
  const animals=s.spawnList.filter(e=>e.prefabName.startsWith(':')).map(e=>({name:spawnName(e.prefabName),count:e.targetPopulation}));
  const res=s.spawnList.filter(e=>e.prefabName.startsWith(';')).map(e=>({name:spawnName(e.prefabName),count:e.targetPopulation}));
  return {x:Math.round(s.position[0]),z:Math.round(s.position[2]),r:s.radius,kind:s.name==='MutantAnimalSpawner'?'mutant':animals.length?'wildlife':'resources',animals,resources:res};});
}
export const noBuildZones=world=>(world.noPlacementZones??[]).filter(z=>inWin(z.position[0],z.position[2])).map(z=>({x:Math.round(z.position[0]),z:Math.round(z.position[2]),r:Math.round(z.radius*10)/10}));

// Terrain height (metres) at scene (x, z) from the 2049² heightmap, bilinear between its 7.8125 m cells.
const CELL=7.8125;
export function heightAt(H,x,z,n=2049){
 const fr=(8000-z)/CELL,fc=(x+8000)/CELL,r=Math.max(0,Math.min(n-2,Math.floor(fr))),c=Math.max(0,Math.min(n-2,Math.floor(fc))),tr=fr-r,tc=fc-c;
 const top=H[r*n+c]*(1-tc)+H[r*n+c+1]*tc,bot=H[(r+1)*n+c]*(1-tc)+H[(r+1)*n+c+1]*tc;
 return top*(1-tr)+bot*tr;
}
// Marching squares over a height grid {nx, nz, step, x0, z0, h (row-major, rows along z)}: the segments where the
// terrain crosses `level`, in scene coordinates. Saddles pair top-right and bottom-left.
export function contourSegments(g,level){
 const segs=[],H=(i,j)=>g.h[j*g.nx+i],X=i=>g.x0+i*g.step,Z=j=>g.z0+j*g.step;
 const cross=(ha,hb,pa,pb)=>{if((ha<level)===(hb<level))return null;const t=(level-ha)/(hb-ha);return [pa[0]+(pb[0]-pa[0])*t,pa[1]+(pb[1]-pa[1])*t];};
 for(let j=0;j<g.nz-1;j++)for(let i=0;i<g.nx-1;i++){
  const a=H(i,j),b=H(i+1,j),c=H(i+1,j+1),d=H(i,j+1),A=[X(i),Z(j)],B=[X(i+1),Z(j)],C=[X(i+1),Z(j+1)],D=[X(i),Z(j+1)];
  const pts=[cross(a,b,A,B),cross(b,c,B,C),cross(d,c,D,C),cross(a,d,A,D)].filter(Boolean);
  if(pts.length>=2)segs.push([pts[0],pts[1]]);if(pts.length===4)segs.push([pts[2],pts[3]]);
 }
 return segs;
}

export function transformPoint(m,[x,y,z]){
 return [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
}
// Andrew's monotone chain; counter-clockwise, no repeated end point.
export function convexHull(points){
 const p=[...new Map(points.map(q=>[q[0]+','+q[1],q])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(p.length<3)return p;
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lower=[],upper=[];
 for(const q of p){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),q)<=0)lower.pop();lower.push(q);}
 for(const q of [...p].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),q)<=0)upper.pop();upper.push(q);}
 return lower.slice(0,-1).concat(upper.slice(0,-1));
}
// Outline and height of one placed mesh: vertices through the instance matrix, projected to the ground plane.
export function footprint(positions,matrix){
 const pts=[];let lo=Infinity,hi=-Infinity;
 for(let i=0;i<positions.length;i+=3){const [x,y,z]=transformPoint(matrix,[positions[i],positions[i+1],positions[i+2]]);pts.push([Math.round(x*100)/100,Math.round(z*100)/100]);lo=Math.min(lo,y);hi=Math.max(hi,y);}
 return {polygon:convexHull(pts),height:hi-lo};
}

const KINDS=[[/^hangar/i,'hangar'],[/^watertank/i,'tank'],[/^smokestack/i,'smokestack'],[/^warehouse/i,'warehouse'],[/^smallapartment|^apartment/i,'apartment'],
 [/^bunker/i,'bunker'],[/^barn/i,'barn'],[/guardtower/i,'tower'],[/^garage/i,'garage'],[/^shack/i,'shack'],[/^(skeletonshed|shedgarage)/i,'shed'],[/^oiltank/i,'oiltank'],[/^building_h/i,'building']];
export function classifyBuilding(name){const n=String(name).replace(/[ _]?\(?\d+\)?$/,'');for(const [re,k] of KINDS)if(re.test(n))return k;return 'misc';}
const TITLES={hangar:'Hangar',tank:'Water Tank',smokestack:'Smokestack Compound',warehouse:'Warehouse Compound',apartment:'Apartments',bunker:'Bunker',barn:'Barn',tower:'Guard Tower',garage:'Garages',shack:'Shacks',shed:'Sheds',oiltank:'Oil Tanks',building:'Building'};
const PRIORITY=Object.keys(TITLES);

// Named places: buildings within `radius` of each other form one place, titled by its most important kind.
export function clusterPlaces(buildings,{radius=150,zones=[]}={}){
 const named=buildings.filter(b=>b.kind!=='misc'),clusters=[];
 for(const b of named){const hit=clusters.find(c=>c.some(o=>Math.hypot(o.x-b.x,o.z-b.z)<radius));if(hit)hit.push(b);else clusters.push([b]);}
 return clusters.map((c,i)=>{
  const kinds=[...new Set(c.map(b=>b.kind))].sort((a,b)=>PRIORITY.indexOf(a)-PRIORITY.indexOf(b));
  const x=c.reduce((s,b)=>s+b.x,0)/c.length,z=c.reduce((s,b)=>s+b.z,0)/c.length;
  const rad=Math.max(0,...zones.filter(r=>Math.hypot(r.x-x,r.z-z)<r.r+120).map(r=>r.exposure));
  return {id:`${kinds[0]}-${i}`,title:TITLES[kinds[0]],kind:kinds[0],features:[...new Set(kinds.map(k=>TITLES[k]))],x:Math.round(x),z:Math.round(z),structures:c.length,rad};
 });
}

// ---- CLI -------------------------------------------------------------------------------------------------------------
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),R=path.join(root,'browser/assets/recovered'),OUT=path.join(root,'site/generated/map');
const readBin=async(file,Type)=>{const b=await readFile(file);return new Type(b.buffer,b.byteOffset,b.byteLength/Type.BYTES_PER_ELEMENT);};

export async function buildModern(){
 const S=path.join(R,'scene'),m=JSON.parse(await readFile(path.join(S,'manifest.json'),'utf8'));
 const inWindow=(x,z,pad=0)=>x>WINDOW.x0-pad&&x<WINDOW.x1+pad&&z>WINDOW.z0-pad&&z<WINDOW.z1+pad;
 // An instance's own vertices: those its submeshes (subsets) index. Static batches pack many objects into one mesh
 // (identity matrix, world-space vertices), so using the whole mesh would merge neighbouring buildings into one outline.
 const meshCache=new Map(),partCache=new Map();
 const positionsOf=async(key,subsets=[0])=>{
  const mesh=m.meshes[key];if(!mesh)return null;
  if(!meshCache.has(key))meshCache.set(key,await readBin(path.join(S,mesh.position.file),Float32Array));
  const all=meshCache.get(key),used=new Set();
  for(const s of subsets){const part=mesh.parts[s];if(!part)continue;if(!partCache.has(part.file))partCache.set(part.file,await readBin(path.join(S,part.file),Uint32Array));for(const i of partCache.get(part.file))used.add(i);}
  const out=new Float32Array(used.size*3);let o=0;for(const i of used){out[o++]=all[i*3];out[o++]=all[i*3+1];out[o++]=all[i*3+2];}
  return out;
 };
 const buildings=[];
 for(const inst of m.instances){
  if(/^\d+$/.test(inst.name)||!inst.mesh||!inst.worldBounds||/^(road|Clouds|Atmosphere|Sun|Plane|sprite|ContextHint|Tile)$/.test(inst.name))continue;
  const [lo,hi]=inst.worldBounds,cx=(lo[0]+hi[0])/2,cz=(lo[2]+hi[2])/2;if(!inWindow(cx,cz,50))continue;
  const pos=await positionsOf(inst.mesh,inst.subsets);if(!pos?.length)continue;
  const f=footprint(pos,inst.matrix);if(f.polygon.length<3)continue;
  buildings.push({id:inst.gameObjectPathID,name:inst.name,kind:classifyBuilding(inst.name),x:Math.round(cx),z:Math.round(cz),height:Math.round(f.height*10)/10,polygon:f.polygon});
 }
 const zones=(m.world.radiationZones??[]).map(z=>({x:Math.round(z.position[0]),z:Math.round(z.position[2]),r:z.radius,exposure:z.exposurePerMin}));
 let places=clusterPlaces(buildings,{zones});
 // Optional community names: site/content/place-names.json [{near:[x,z], name}] renames the nearest place within 250 m.
 try{for(const {near,name} of JSON.parse(await readFile(path.join(root,'site/content/place-names.json'),'utf8'))){const p=places.reduce((a,b)=>Math.hypot(b.x-near[0],b.z-near[1])<Math.hypot(a.x-near[0],a.z-near[1])?b:a);if(Math.hypot(p.x-near[0],p.z-near[1])<250)p.title=name;}}catch{}
 const trees=JSON.parse(await readFile(path.join(R,'trees.json'),'utf8')).filter(t=>inWindow(t[0],t[2])).length;
 const spawnData=async n=>JSON.parse(await readFile(path.join(R,n,'manifest.json'),'utf8'));
 const [lootM,resM]=await Promise.all([spawnData('loot'),spawnData('resources')]);
 // Elevation: a 20 m height grid (int16 decimetres, row-major north to south) and contour lines every 25 m.
 const Hm=new Float32Array((await readFile(path.join(R,'heights.f32'))).buffer.slice(0)),STEP=20,nx=(WINDOW.x1-WINDOW.x0)/STEP+1,nz=(WINDOW.z1-WINDOW.z0)/STEP+1;
 const grid={nx,nz,step:STEP,x0:WINDOW.x0,z0:WINDOW.z0,h:[]};for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)grid.h.push(heightAt(Hm,WINDOW.x0+i*STEP,WINDOW.z0+j*STEP));
 const top=Math.max(...grid.h),pathOf=segs=>segs.map(([p,q])=>`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('');
 const contours=[{level:m.world.waterLine,coast:true,d:pathOf(contourSegments(grid,m.world.waterLine))}];
 for(let lv=Math.ceil((m.world.waterLine+1)/25)*25;lv<top;lv+=25)contours.push({level:lv,major:lv%100===0,d:pathOf(contourSegments(grid,lv))});
 await mkdir(OUT,{recursive:true});await writeFile(path.join(OUT,'heights.bin'),Buffer.from(Int16Array.from(grid.h,v=>Math.round(v*10)).buffer));
 const out={window:WINDOW,waterLine:m.world.waterLine,buildings,rad:zones,elevation:{file:'heights.bin',nx,nz,step:STEP,x0:WINDOW.x0,z0:WINDOW.z0,scale:0.1},contours,loot:lootSpawns(lootM),zones:spawnZones(resM),noBuild:noBuildZones(m.world),spawns:(m.world.spawnPoints??[]).map(s=>[Math.round(s.position[0]),Math.round(s.position[2])]),places,trees,source:{scene:m.outputSHA256??null}};
 await mkdir(OUT,{recursive:true});await writeFile(path.join(OUT,'modern.json'),JSON.stringify(out));
 return out;
}

// The community map: copy the image beside the tiles and store the image→world affine fitted from control points.
export async function buildClassic({image,points,credit}){
 const pts=JSON.parse(await readFile(points,'utf8'));if(!Array.isArray(pts)||pts.length<3)throw new Error('need at least 3 control points');
 const name='classic'+path.extname(image).toLowerCase();
 await mkdir(OUT,{recursive:true});await copyFile(image,path.join(OUT,name));
 const out={image:name,affine:fitAffine(pts),credit:credit??null,points:pts.length};
 await writeFile(path.join(OUT,'classic.json'),JSON.stringify(out));return out;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='modern'){const o=await buildModern();console.log(`modern.json: ${o.buildings.length} buildings, ${o.loot.length} crate spawns, ${o.zones.length} spawn zones, ${o.noBuild.length} no-build zones, ${o.places.length} places, ${o.rad.length} radiation zones, ${o.spawns.length} spawns, ${o.trees} trees`);}
 else if(process.argv[2]==='classic'){
  const {values:a}=parseArgs({args:process.argv.slice(3),options:{image:{type:'string'},points:{type:'string'},credit:{type:'string'}}});
  if(!a.image||!a.points){console.error('classic needs --image and --points');process.exit(2);}
  const o=await buildClassic(a);console.log(`classic.json: ${o.image}, affine from ${o.points} points`);
 }
 else{console.error('usage: node tools/site-map.mjs modern | classic --image <file> --points <json>');process.exit(2);}
}
