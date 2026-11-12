import {Matrix4,Vector3,Quaternion} from 'three';
// LootableObjectSpawner crates on an online server: the server spawns them (NetCull.InstantiateStatic: a classic view named
// after the prefab, "BoxLoot", "AmmoLootBox", "MedicalLootBox", "WeaponLootBox") and owns their contents. The page draws
// each at its Create transform and routes Use through Context, so the server's SetLooter + GNUP open the window on
// ServerInventory, whose takeTo/store/move send ITMV/ITMG. A page-side crate there would hold loot no request can move.
const vec3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const quat4=q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.hypot(...q)>1e-8;
// The client's views hold the Create's root position/rotation already in page space (net-client.mjs toBrowserPosition /
// toBrowserQuaternion: Unity's with z flipped, as loot.mjs crateMatrix's H·M·H), so they compose as they are. Flipping
// them again put every map crate at its z-mirrored spot on EU 1 (30 Oct).
export function serverCrateMatrix(prefab,position,rotation){const s=prefab.rootScale;
 return new Matrix4().compose(new Vector3(...position),new Quaternion(...rotation).normalize(),new Vector3(s.x,s.y,s.z));}

export class ServerCrates{
 constructor(session,prefabs,{spawn=()=>{},remove=()=>{}}={}){
  Object.assign(this,{session,prefabs,spawnView:spawn,removeView:remove});this.crates=new Map();
  this.byName=new Map(Object.entries(prefabs).map(([key,p])=>[p.name,key]));
  const c=session.client;for(const v of c.views.values())this.create(v);
  c.addEventListener('create',e=>this.create(e.detail));
  c.addEventListener('rpc',e=>this.call(e.detail));
  c.addEventListener('destroy',()=>{for(const id of [...this.crates.keys()])if(!c.views.has(id))this.remove(id);});
  session.addEventListener('closed',()=>{for(const id of [...this.crates.keys()])this.remove(id);});
 }
 create(v){const key=this.byName.get(v?.prefab);if(!key||this.crates.has(v.viewId)||!vec3(v.position)||!quat4(v.rotation))return;
  const prefab=this.prefabs[key],crate={viewId:v.viewId,prefabKey:key,prefab,matrix:serverCrateMatrix(prefab,v.position,v.rotation),looter:0,online:{viewId:v.viewId}};
  // LootableObject.SetLooter/ClearLooter are retained with this view's inventory calls (online.mjs).
  for(const call of this.session.inventoryCalls?.get('v:'+v.viewId)??[])this.looter(crate,call.name,call.args??[]);
  this.crates.set(v.viewId,crate);this.spawnView(crate);}
 call(r){const crate=this.crates.get(r?.viewId);if(crate&&r.args?.class==='LootableObject')this.looter(crate,r.name,r.args.values??[]);}
 looter(crate,name,args){if(name==='SetLooter')crate.looter=Number(args[0])||0;else if(name==='ClearLooter')crate.looter=0;}
 remove(id){const crate=this.crates.get(id);if(!crate)return;this.crates.delete(id);this.removeView(crate);}
}
