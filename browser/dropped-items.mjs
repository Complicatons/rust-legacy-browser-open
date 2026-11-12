import {Matrix4,Quaternion,Vector3} from 'three';
import {RagdollPhysics} from './ragdoll-physics.mjs';
import {ragdollEnvironment} from './ragdoll-environment.mjs';
import {transferable} from './item-ops.mjs';
const H=new Matrix4().makeScale(1,1,-1);
// Offline DropHelper/ItemPickup rules. Online pickups are server snapshots in ServerRigid.
export class DroppedItems{
 constructor({engine,manifest,world,items,now=()=>performance.now()/1000,rng=Math.random,onAdd,onPose,onRemove}){
  Object.assign(this,{engine,manifest,world,items,now,rng,onAdd,onPose,onRemove});this.objects=new Set();this.nextId=1;
  const p=manifest.pickupPhysics,n={name:'GenericItemPickup',parent:-1,position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
  const scale=manifest.prefabs[manifest.pickup].rootScale;if(Math.abs(scale.x-scale.y)>1e-6||Math.abs(scale.x-scale.z)>1e-6)throw Error('Nonuniform pickup scale requires shape-specific conversion');this.scale=new Matrix4().makeScale(scale.x,scale.y,scale.z);
  const colliders=structuredClone(p.colliders);for(const c of colliders){for(const field of ['m_Center','m_Size'])if(c.data[field])for(const axis of ['x','y','z'])c.data[field][axis]*=scale.x;for(const field of ['m_Radius','m_Height'])if(c.data[field]!=null)c.data[field]*=scale.x;}
  this.definition={nodes:[n],bodies:[{bone:0,name:n.name,data:p.body,colliders}],joints:[]};
 }
 toss(inventory,index,origin,direction){const item=inventory.slots[index],data=item&&this.items[item.item]?.data;if(!data||!Number.isInteger(index)||index<0||index>=40)return false;
  // DropHelper.DropItem (server ~71): an untransferable item (transientMode & 2) is removed instead of dropped.
  if(!transferable(data)){inventory.slots[index]=null;return false;}
  if(![...origin,...direction].every(Number.isFinite)||direction.lengthSq()<1e-8)return false;
  const position=origin.clone().add(new Vector3(0,-.25,0)),matrix=new Matrix4().makeTranslation(...position),physics=new RagdollPhysics(this.engine,this.definition,[matrix]);let o;
  try{physics.setEnvironment(ragdollEnvironment(this.world,new Vector3(position.x,position.y,-position.z)));physics.bodies[0].setLinvel(direction.clone().normalize().multiplyScalar(4+2*this.rng()),true);
   o={id:this.nextId++,item,physics,expires:this.now()+90,environmentAt:this.now(),matrix:H.clone().multiply(matrix).multiply(H).multiply(this.scale)};this.onAdd?.(o);
  }catch(error){physics.dispose();throw error;}
  inventory.slots[index]=null;this.objects.add(o);return true;
 }
 take(o,inventory){if(!this.objects.has(o))return false;const before=o.item.uses,remaining=inventory.insert(o.item);if(remaining===0){this.remove(o);return true;}if(this.items[o.item.item].data._splittable&&remaining<before){o.item.uses=remaining;return true;}return false;}
 text(o){const d=this.items[o.item.item].data;return `Take '${d.m_Name}${d._splittable&&o.item.uses>1?' x'+o.item.uses:''}'`;}
 remove(o){if(!this.objects.delete(o))return;o.physics.dispose();this.onRemove?.(o);}
 clear(){for(const o of [...this.objects])this.remove(o);}
 frame(time,dt){for(const o of [...this.objects]){if(time>=o.expires){this.remove(o);continue;}
   if(time-o.environmentAt>=1){const p=o.physics.bodies[0].translation();o.physics.setEnvironment(ragdollEnvironment(this.world,new Vector3(p.x,p.y,-p.z)));o.environmentAt=time;}
   o.physics.update(dt);o.matrix.copy(H).multiply(o.physics.matrices()[0]).multiply(H).multiply(this.scale);this.onPose?.(o);
  }}
 debug(){return [...this.objects].map(o=>({id:o.id,name:this.items[o.item.item].data.m_Name,uses:o.item.uses,expires:o.expires,position:new Vector3().setFromMatrixPosition(o.matrix).toArray()}));}
}
