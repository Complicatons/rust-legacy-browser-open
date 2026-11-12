import {Vector3,Quaternion,Euler} from 'three';
import {StructureSystem,StructureMaster,StructureComponent} from './structures.mjs';
const values=r=>Array.isArray(r.args)?r.args:r.args?.values??[];
const keyOf=n=>n.key??n.carrier+':'+n.innerID;
// Read-only projection for client placement previews. The native server creates masters/pieces and validates requests.
export class ServerBuildings{
 constructor(session,manifest,items,world){Object.assign(this,{session,manifest});this.system=new StructureSystem(manifest,items,world);this.masters=new Map();this.parts=new Map();this.prefabs=new Map(Object.entries(manifest.structures).map(([item,e])=>[e.prefab,item]));
  for(const v of session.client.views.values())this.master(v);for(const n of session.client.entities.values())this.entity(n);
  session.client.addEventListener('create',e=>this.master(e.detail));session.client.addEventListener('entity',e=>this.entity(e.detail));session.client.addEventListener('ngc-call',e=>this.call(e.detail));
  session.client.addEventListener('entity-destroy',e=>this.remove(keyOf(e.detail)));
  session.client.addEventListener('destroy',()=>{for(const [id,m]of this.masters)if(!session.client.views.has(id)){for(const c of [...m.components])m.remove(c);this.system.masters.delete(m);this.masters.delete(id);}});
  session.addEventListener('closed',()=>{for(const k of [...this.parts.keys()])this.remove(k);this.masters.clear();this.system.masters.clear();});
 }
 master(v){if(v.prefab!=='StructureMasterPrefab'||this.masters.has(v.viewId))return;const m=new StructureMaster(this.system,new Vector3(v.position[0],v.position[1],-v.position[2]),new Quaternion(-v.rotation[0],-v.rotation[1],v.rotation[2],v.rotation[3]));m.nativeViewId=v.viewId;this.masters.set(v.viewId,m);this.system.masters.add(m);for(const p of this.parts.values())if(p.masterId===v.viewId)this.bind(p);}
 entity(n){const item=this.prefabs.get(n.prefab),key=keyOf(n);if(!item||this.parts.has(key))return;const r=Math.PI/180,q=new Quaternion().setFromEuler(new Euler(n.euler[0]*r,n.euler[1]*r,n.euler[2]*r,'YXZ')),c=new StructureComponent(this.system,item,this.manifest.prefabs[n.prefab],new Vector3(n.position[0],n.position[1],-n.position[2]),q);this.system.components.add(c);this.parts.set(key,{component:c,masterId:null});for(const call of this.session.entityCalls.get(key)?.values()??[])this.call(call);}
 bind(p){const m=this.masters.get(p.masterId);if(p.component.master===m)return;if(p.component.master)p.component.master.remove(p.component);if(m)m.add(p.component);}
 call(r){const key=keyOf(r),p=this.parts.get(key);if(!p)return;const args=values(r);if(r.name==='SMSet'){p.masterId=args[0];this.bind(p);}else if(r.name==='ClientHealthUpdate')p.component.health=Number(args[0]);} // ClientKilled only plays the death effect; the piece leaves on destroy (cl_predestroy -> CullComponent)
 remove(key){const p=this.parts.get(key);if(!p)return;const c=p.component;c.destroyed=true;if(c.master)c.master.remove(c);this.system.components.delete(c);this.parts.delete(key);}
 part(key){return this.parts.get(key)?.component??null;}
 debug(){return {masters:[...this.masters.values()].map(m=>({viewId:m.nativeViewId,parts:m.components.size})),parts:[...this.parts].map(([key,p])=>({key,master:p.masterId,bound:Boolean(p.component.master),health:p.component.health}))};}
}
