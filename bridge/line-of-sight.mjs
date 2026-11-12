// Gateway line of sight (ANTICHEAT-ADMIN-PLAN.md, slices 2 and 7). One instance per gateway, shared by every session: the
// recovered static collision (browser/collision.mjs CollisionWorld: scene colliders, tree colliders), the recovered
// heightmap, the NGC structure pieces (walls, foundations, ceilings…), NGC doors/gates and deployables (boxes, shelters,
// barricades, benches… slice 8) the sessions' bridges have seen created, and the scene MovingDoors whose manual view ID is known. A door blocks only while the stream says it is closed
// and its close animation has settled. Queries take Unity-space points (what the browser sends and the server relays)
// and test the segment in browser space (Z negated), filtered by the server's own layer masks. Verified against unit
// tests and the mock stack only.
import {Vector3,Ray,Matrix4,Quaternion,Euler} from 'three';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CollisionWorld,MovingBody,GridBody,isSpawnMarker} from '../browser/collision.mjs';
import {loadRockColliders} from '../browser/rock-colliders.mjs';
import {sampleTriangle,worldToGrid} from '../browser/terrain.mjs';

// BulletWeaponDataBlock hit mask (layers 0 4 10 12 17-21 27 28) and TruthDetector movement trace (0 1 10 19 20 29).
export const BULLET_MASK=406721553,TRUTH_MASK=538444803;
const TERRAIN_LAYER=19,H=new Matrix4().makeScale(1,1,-1);
const inMask=(mask,layer)=>Number.isInteger(layer)&&(mask&(1<<layer))!==0;
const toBrowser=([x,y,z])=>new Vector3(x,y,-z);
const toUnity=v=>[v.x,v.y,-v.z];
// BasicDoor RunFlags.OpenedForward in MovingDoor.startConfig.
const startsOpened=settings=>((settings?.startConfig??0)&1)===1;

// Solid (non-trigger) colliders of a recovered deployables prefab as browser-local shapes, shared by every instance.
// binary(desc, ArrayType) loads mesh buffers (MeshCollider); prefabs without solid colliders give null.
export async function structureShapes(prefab,meshes,binary){
 const template=new MovingBody(prefab.name);
 for(const c of prefab.colliders??[]){if(c.trigger)continue;const m=new Matrix4().fromArray(c.matrix);
  if(c.type==='BoxCollider')template.addBox(c.size,c.center,m);
  else if(c.type==='CapsuleCollider')template.addCapsule(c.radius,c.height,c.direction,c.center,m);
  else if(c.type==='SphereCollider')template.addCapsule(c.radius,2*c.radius,1,c.center,m);
  else if(c.type==='MeshCollider'&&meshes?.[c.mesh]&&binary){const md=meshes[c.mesh],positions=await binary(md.position,Float32Array);for(const part of md.parts)template.addGeometry(positions,await binary(part,Uint32Array),m);}}
 return template.shapes.length?{name:prefab.name,layer:prefab.nodes?.[0]?.layer??0,scale:prefab.rootScale??{x:1,y:1,z:1},shapes:template.shapes}:null;
}

// A deployable's solid colliders grouped by their own layer (a prefab may mix them: the metal window bars are layer 20
// bars plus a layer-29 PlayerClip box that only stops players), each group a structureShapes()-style def. Groups on layers
// outside both server masks are left out; null when nothing is left.
export async function deployableShapes(prefab,meshes,binary){
 const root=prefab.nodes?.[0]?.layer??0,groups=new Map();
 for(const c of prefab.colliders??[]){if(c.trigger)continue;const layer=Number.isInteger(c.layer)?c.layer:root;if(!inMask(BULLET_MASK|TRUTH_MASK,layer))continue;if(!groups.has(layer))groups.set(layer,[]);groups.get(layer).push(c);}
 const defs=[];
 for(const [layer,colliders] of groups){const def=await structureShapes({...prefab,colliders,nodes:[{layer}]},meshes,binary);if(def)defs.push(def);}
 return defs.length?defs:null;
}

export class LineOfSight{
 // world: CollisionWorld (static tree + bodies with .layer); staticLayers: layers merged into world.tree;
 // ground(x,z): browser-space terrain height; structures: Map prefab handle → structureShapes() result;
 // doors: Map prefab handle → {def: structureShapes() result, settings: MovingDoor fields} (NGC doors and gates, shapes at
 // the closed pose); deployables: Map prefab handle → deployableShapes() result (one body per collider layer); sceneDoors: [{viewId, body, settings}] scene MovingDoors with a known manual view ID, body in world.
 // doorSlack: seconds after a close animation before the door blocks (the player's moves arrive later than the call).
 constructor({world=null,staticLayers=[0],ground=null,structures=new Map(),doors=new Map(),deployables=new Map(),sceneDoors=[],cell=16,maxStructures=50000,terrainStep=2,doorSlack=1,now=()=>performance.now()/1000}={}){
  Object.assign(this,{world,ground,structures,doors,deployables,cell,maxStructures,terrainStep,doorSlack,now});
  this.staticMask=staticLayers.reduce((m,l)=>m|(1<<l),0);
  this.placed=new Map();this.grid=new Map();this.rays=0;
  // Scene doors start unknown (never blocking) until the server's connect-time DOc or a DOo names their state.
  this.sceneDoors=new Map(sceneDoors.map(d=>[d.viewId,d.body.door=this.doorState(null,d.settings)]));
  this.sceneBodies=new Map(sceneDoors.map(d=>[d.viewId,d.body]));
 }
 doorState(open,settings){return {open,settleAt:open===null?Infinity:this.now(),durationOpen:settings?.durationOpen??0,durationClose:settings?.durationClose??0};}
 doorBlocks(d){return d.open===false&&this.now()>=d.settleAt;}
 // BasicDoor.DOo(open, ms) / DOc(open): open 0 closed, 1 forward, 2 reverse. age: seconds since the server's toggle
 // stamp; settled: a connect-time state (no animation running). Repeats from other sessions keep the first timing.
 setDoor(d,open,{age=0,settled=false}={}){
  const isOpen=Number(open)!==0;if(d.open===isOpen)return;
  d.open=isOpen;d.settleAt=settled?this.now():this.now()+(isOpen?d.durationOpen:d.durationClose)-Math.max(0,age)+this.doorSlack;
 }
 ngcDoor(key,open,opts){const d=this.placed.get(key)?.door;if(d)this.setDoor(d,open,opts);return Boolean(d);}
 sceneDoor(viewId,open,opts){const d=this.sceneDoors.get(viewId);if(d)this.setDoor(d,open,opts);return Boolean(d);}
 isDoor(prefab){return this.doors.has(prefab);}
 // A scene door's panel at its closed pose (Unity): bounds centre, a point 1 m above the bottom and 0.3 m below the top,
 // and whether it is closed and settled (only then is the panel where these points say). null for unknown views.
 sceneDoorTarget(viewId){
  const body=this.sceneBodies.get(viewId);if(!body)return null;if(!body.box)body.setMotion(body.motion);if(body.box.isEmpty())return null;
  const c=body.box.getCenter(new Vector3()),{min,max}=body.box;
  const points=[c,new Vector3(c.x,Math.min(max.y,min.y+1),c.z),new Vector3(c.x,Math.max(min.y,max.y-0.3),c.z)].map(toUnity);
  return {body,points,closed:this.doorBlocks(body.door)};
 }
 doorClosed(key){const d=this.placed.get(key)?.door;return Boolean(d)&&this.doorBlocks(d);}
 // Centre of a placed piece's bounds (Unity), and whether a Unity point lies within `margin` of them.
 center(key){const b=this.placed.get(key)?.body;return b?toUnity(b.box.getCenter(new Vector3())):null;}
 near(key,point,margin=0.3){const b=this.placed.get(key)?.body;return Boolean(b)&&b.box.distanceToPoint(toBrowser(point))<=margin;}
 // Transform.TransformPoint of a placed piece (Unity local → Unity world, closed pose for doors), or null.
 localToWorld(key,local){const b=this.placed.get(key)?.body;return b?toUnity(toBrowser(local).applyMatrix4(b.motion)):null;}
 // Nearest blocker on the segment from → to (Unity points), or null when clear. Hits closer than startMargin to
 // `from` or endMargin to `to` do not count (the target's own surface, an eye grazing a wall).
 blocked(from,to,{mask=BULLET_MASK,startMargin=0.05,endMargin=0.3,ignore=null,ignoreBody=null}={}){
  const a=toBrowser(from),b=toBrowser(to),dir=b.clone().sub(a),total=dir.length(),far=total-endMargin;
  this.rays++;if(!(far>startMargin))return null;
  dir.divideScalar(total);const ray=new Ray(a,dir);let best=null;
  const consider=(distance,what)=>{if(distance>=startMargin&&distance<=far&&(!best||distance<best.distance))best={distance,what};};
  if(this.world){
   const skip=body=>body?body===ignoreBody||!inMask(mask,body.layer)||(body.door&&!this.doorBlocks(body.door)):(mask&this.staticMask)===0;
   const hit=this.world.rayHit(ray,far,skip);if(hit)consider(hit.distance,hit.body?.door?'door':'world');
  }
  if(this.ground&&inMask(mask,TERRAIN_LAYER)){
   const steps=Math.max(1,Math.ceil(far/this.terrainStep)),p=new Vector3();
   for(let i=0;i<=steps;i++){const s=startMargin+(far-startMargin)*i/steps;p.copy(a).addScaledVector(dir,s);const g=this.ground(p.x,p.z);
    if(Number.isFinite(g)&&p.y<g-0.25){consider(s,'terrain');break;}}
  }
  if(this.placed.size){
   const seen=new Set(),p=new Vector3(),step=this.cell/4,steps=Math.ceil(far/step);
   for(let i=0;i<=steps;i++){p.copy(a).addScaledVector(dir,Math.min(far,i*step));const list=this.grid.get(this.key(Math.floor(p.x/this.cell),Math.floor(p.z/this.cell)));if(list)for(const k of list)seen.add(k);}
   const entry=new Vector3();
   for(const k of seen){if(k===ignore)continue;const s=this.placed.get(k);if(s.door&&!this.doorBlocks(s.door))continue;
    for(const body of s.bodies){if(!inMask(mask,body.layer))continue;
     if(!body.box.containsPoint(a)){const e=ray.intersectBox(body.box,entry);if(!e||e.distanceTo(a)>far)continue;}
     const hit=body.ensure()?.rayIntersect(ray,far);if(hit)consider(hit.distance,s.door?'door':s.kind);}}
  }
  return best&&{...best,distance:Math.round(best.distance*100)/100,total:Math.round(total*100)/100,at:toUnity(a.clone().addScaledVector(dir,best.distance)).map(v=>Math.round(v*100)/100)};
 }
 // Highest surface under a Unity point within `depth` metres: the terrain, and one ray down through the colliders,
 // structures and closed doors on `mask` (what a player can stand on). Returns {y, what} (Unity) or null.
 groundBelow(point,{mask=TRUTH_MASK,depth=60}={}){
  const [x,y,z]=point,g=this.ground?this.ground(x,-z):NaN;
  let best=Number.isFinite(g)?{y:g,what:'terrain'}:null;
  const bottom=Math.max(y-depth,best?Math.min(best.y,y)-0.1:-Infinity);
  const hit=this.blocked(point,[x,bottom,z],{mask:mask&~(1<<TERRAIN_LAYER),startMargin:0,endMargin:0});
  if(hit&&(!best||y-hit.distance>best.y))best={y:Math.round((y-hit.distance)*100)/100,what:hit.what};
  return best;
 }
 key(cx,cz){return (cx+100000)*200001+(cz+100000);}
 has(key){return this.placed.has(key);}
 // NGC structure piece or door/gate seen by a session (bridge `ngc-create`: Unity position, Unity euler degrees).
 // Reference-counted across sessions; returns whether it is tracked (recovered structure and door prefabs only, up to
 // maxStructures). A door starts in its prefab's default state; the server's buffered DOo follows right after.
 retain(key,prefab,position,euler){
  const existing=this.placed.get(key);if(existing){existing.refs++;return true;}
  const door=this.doors.get(prefab),structure=door?null:this.structures.get(prefab),defs=door?[door.def]:structure?[structure]:this.deployables.get(prefab);
  if(!defs?.length||this.placed.size>=this.maxStructures||!Array.isArray(position)||!Array.isArray(euler))return false;
  const r=Math.PI/180,rotation=new Quaternion().setFromEuler(new Euler(euler[0]*r,euler[1]*r,euler[2]*r,'YXZ')); // Quaternion.Euler: Y·X·Z
  const bodies=defs.map(def=>{const matrix=H.clone().multiply(new Matrix4().compose(new Vector3(...position),rotation,new Vector3(def.scale.x,def.scale.y,def.scale.z))).multiply(H);
   const body=new MovingBody(def.name);body.layer=def.layer;body.shapes=def.shapes;return body.setMotion(matrix);}).filter(b=>!b.box.isEmpty());
  if(!bodies.length)return false;
  const box=bodies.slice(1).reduce((u,b)=>u.union(b.box),bodies[0].box.clone());
  const cells=[];for(let cx=Math.floor(box.min.x/this.cell);cx<=Math.floor(box.max.x/this.cell);cx++)for(let cz=Math.floor(box.min.z/this.cell);cz<=Math.floor(box.max.z/this.cell);cz++){const c=this.key(cx,cz);let list=this.grid.get(c);if(!list)this.grid.set(c,list=new Set());list.add(key);cells.push(c);}
  this.placed.set(key,{body:bodies[0],bodies,kind:door||structure?'structure':'deployable',refs:1,cells,door:door?this.doorState(startsOpened(door.settings),door.settings):null});return true;
 }
 release(key){
  const s=this.placed.get(key);if(!s||--s.refs>0)return;
  for(const c of s.cells){const list=this.grid.get(c);list?.delete(key);if(list&&!list.size)this.grid.delete(c);}
  this.placed.delete(key);
 }
}

// Gateway loader: browser/assets/recovered → LineOfSight. Scene colliders on layers inside both masks go into the
// static octree; any other masked layer becomes its own body. Scene MovingDoor colliders become one body per door when
// the scene export recorded the door's manual view ID (`doors[i].viewID`); without it the gateway cannot follow that
// door's DOc/DOo and leaves it out. NGC structure pieces, doors/gates and deployables (slice 8) block.
export async function loadLineOfSight(recoveredDir,{trees=true}={}){
 const read=f=>readFile(join(recoveredDir,f)),json=async f=>JSON.parse(await read(f));
 const typed=async(file,T)=>{const b=await read(file);return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
 const terrain=await json('manifest.json'),heights=await typed(terrain.heightFile,Float32Array);
 const ground=(x,z)=>sampleTriangle(heights,terrain.size,...worldToGrid(x,z,terrain.extent,terrain.size-1));
 const world=new CollisionWorld(null),both=BULLET_MASK&TRUTH_MASK,staticLayers=new Set();
 const scene=await json('scene/manifest.json'),sceneBinary=(d,T)=>typed('scene/'+d.file,T);
 const doorBodies=new Map(),sceneDoors=[];
 for(const [i,d] of (scene.doors??[]).entries())if(Number.isInteger(d.viewID)&&d.viewID>0){const body=Object.assign(new MovingBody(d.name),{layer:20});doorBodies.set(i,body);sceneDoors.push({viewId:d.viewID,body,settings:d.settings});}
 for(const c of scene.colliders){
  if(!(inMask(BULLET_MASK,c.layer)||inMask(TRUTH_MASK,c.layer))||isSpawnMarker(c,scene.world?.spawnPoints))continue;
  if(c.door!==undefined&&!doorBodies.has(c.door))continue;
  const matrix=new Matrix4().fromArray(c.matrix),door=doorBodies.get(c.door);
  const own=door??(inMask(both,c.layer)?null:Object.assign(new MovingBody(c.name),{layer:c.layer}));
  const target=own??world;if(!own)staticLayers.add(c.layer);else own.layer=c.layer;
  if(c.type==='MeshCollider'){const m=scene.meshes[c.mesh],positions=await sceneBinary(m.position,Float32Array);for(const part of m.parts)target.addGeometry(positions,await sceneBinary(part,Uint32Array),matrix);}
  else if(c.type==='BoxCollider')target.addBox(c.size,c.center,matrix);
  if(own&&!door)world.addBody(own);
 }
 for(const body of doorBodies.values())if(body.shapes.length)world.addBody(body);
 if(trees){
  const res=await json('resources/manifest.json').catch(()=>null),tc=res?.treeColliders;
  if(tc){const rb=(d,T)=>typed('resources/'+d.file,T);world.addBody(Object.assign(new GridBody('Tree colliders',await rb(tc.position,Float32Array),await rb(tc.indices,Uint32Array)),{layer:10}));
   for(const c of tc.capsules){const b=new MovingBody('Tree capsule');b.addCapsule(c.radius,c.height,c.direction,c.center,new Matrix4().fromArray(c.matrix));b.layer=c.layer??10;b.setMotion(new Matrix4());world.addBody(b);}}
 }
 // The server spawns the same RockSpawn SlowSpawn colliders (layer 10: in both masks); 7 shared meshes, so always loaded.
 const rocks=await json('rockspawn/manifest.json').catch(()=>null);
 if(rocks)for(const b of await loadRockColliders(rocks,(d,T)=>typed('rockspawn/'+d.file,T)))world.addBody(b);
 world.build();
 const deploy=await json('deployables/manifest.json'),structures=new Map(),doors=new Map(),deployBinary=(d,T)=>typed('deployables/'+d.file,T);
 for(const entry of Object.values(deploy.structures??{})){const p=deploy.prefabs[entry.prefab];if(!p||structures.has(entry.prefab))continue;const def=await structureShapes(p,deploy.meshes,deployBinary);if(def)structures.set(entry.prefab,def);}
 // Wooden door, metal door, wood gate: MovingDoor on the root, one box collider at the closed pose.
 for(const [handle,p] of Object.entries(deploy.prefabs)){const md=p.components?.MovingDoor?.[0]?.data;if(!md)continue;const def=await structureShapes(p,deploy.meshes,deployBinary);if(def)doors.set(handle,{def,settings:md});}
 // Every other ';deploy_' prefab with solid colliders on a masked layer: boxes, shelters, barricades, spike walls, benches,
 // furnaces, beds, gateways, window bars, stashes, bags, fires. Sleepers and loot sacks are targets, not cover.
 const deployables=new Map();
 for(const [handle,p] of Object.entries(deploy.prefabs)){if(!handle.startsWith(';deploy_')||structures.has(handle)||doors.has(handle))continue;const defs=await deployableShapes(p,deploy.meshes,deployBinary);if(defs)deployables.set(handle,defs);}
 return new LineOfSight({world,staticLayers:[...staticLayers],ground,structures,doors,deployables,sceneDoors});
}
