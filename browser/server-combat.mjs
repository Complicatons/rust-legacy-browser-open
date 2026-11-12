import {GunState,StrikeGunState,BowState,WeaponState,pelletDirection,isBroken} from './combat.mjs';
import {WoodBlockers} from './resources.mjs';
import {Vector3,Ray} from 'three';
const reflect=v=>new Vector3(v.x,v.y,-v.z);

// Presentation prediction is separate from GNUP inventory. Reconciliation retains deploy/reload/fire timers.
export class ServerFirearm{
 constructor(){this.active=null;}
 held(inv,catalogue,ammoKey,assets,now,enabled=true){
  const slot=enabled&&inv.slots[inv.activeSlot],item=slot&&catalogue.items[slot.item],rep=inv.activeRep;
  if(rep==null||!['BulletWeaponDataBlock','ShotgunDataBlock','StrikeGunDataBlock'].includes(item?.class)){this.active=null;return null;}
  if(this.active?.rep!==rep||this.active.key!==slot.item){const state=new (item.class==='StrikeGunDataBlock'?StrikeGunState:GunState)(item.data,ammoKey(item.data));state.activate(now);this.active={rep,key:slot.item,d:item.data,kind:'gun',state,assets:assets[slot.item]??{sounds:{}}};}
  const w=this.active;
  if(w.revision!==inv.revision||w.source!==slot){w.source=slot;w.revision=inv.revision;w.slot={...slot};w.reserved=0;}
  w.inventory={count:key=>Math.max(0,inv.count(key)-(key===w.state.ammoKey?w.reserved:0)),consume:(key,n)=>{if(key===w.state.ammoKey)w.reserved+=n;}};
  return w;
 }
}

export class ServerBow{
 constructor(){this.active=null;}
 held(inv,catalogue,arrowKey,assets,now,enabled=true){const slot=enabled&&inv.slots[inv.activeSlot],item=slot&&catalogue.items[slot.item],rep=inv.activeRep;
  if(rep==null||item?.class!=='BowWeaponDataBlock'||isBroken(slot)){this.active?.state.deactivate(now);this.active=null;return null;}
  if(this.active?.rep!==rep||this.active.key!==slot.item){const state=new BowState(item.data,arrowKey(item.data));state.activate(now);this.active={rep,key:slot.item,d:item.data,kind:'bow',state,assets:assets[slot.item]??{sounds:{}}};}
  const w=this.active;w.slot=slot;if(w.revision!==inv.revision){w.revision=inv.revision;w.reserved=0;}
  w.reserved??=0;w.inventory={count:key=>Math.max(0,inv.count(key)-(key===w.state.arrowKey?w.reserved:0)),consume:(key,n)=>{if(key===w.state.arrowKey)w.reserved+=n;}};return w;
 }
}

// ArrowReportHit sends the target ROOT position, not the impact point or body-part transform.
// ArrowMovement marks static impacts reported even when ArrowReportHit has no TakeDamage target;
// those impacts send no fallback miss. Only an arrow expiring in flight reports a miss.
export function serverBowImpact(body,client){const target=serverTarget(body,client);if(!target||(!body.onlineActor&&!body.onlineDamage))return null;
 const root=body.onlineActor?.root??body.onlineRoot??body.motion;return {target,position:new Vector3().setFromMatrixPosition(root).toArray()};
}

// MeleeWeaponItem queues mid-swing and sound independently. SecondaryAttack in the shipped item only
// delays attacks; Local_SecondaryFire is not called, and the shipped DoAction2 does no repair work.
export class MeleeState extends WeaponState{
 activate(now){super.activate(now);this.hitAt=this.soundAt=null;}
 frame(now,input){const events=[];input={...input};this.preFrame(now,input);
  if(input.attack&&now>=this.nextPrimaryAttackTime){this.nextPrimaryAttackTime=this.nextSecondaryAttackTime=now+this.d.fireRate*(input.starving?2:1);this.hitAt=now+this.d.midSwingDelay;this.soundAt=now+this.d.swingSoundDelay;events.push({type:'swing'});}
  if(input.attack2&&now>=this.nextSecondaryAttackTime)this.nextPrimaryAttackTime=this.nextSecondaryAttackTime=now+this.d.fireRate;
  if(this.hitAt!==null&&now>this.hitAt){this.hitAt=null;events.push({type:'hit'});}
  if(this.soundAt!==null&&now>this.soundAt){this.soundAt=null;events.push({type:'sound'});}
  return events;
 }
}

export class ServerMelee{
 constructor({rng=Math.random}={}){this.active=null;this.blockers=new WoodBlockers(rng);}
 held(inv,catalogue,assets,now,enabled=true){const slot=enabled&&inv.slots[inv.activeSlot],item=slot&&catalogue.items[slot.item],rep=inv.activeRep;
  if(rep==null||item?.class!=='MeleeWeaponDataBlock'||isBroken(slot)){this.active=null;return null;}
  if(this.active?.rep!==rep||this.active.key!==slot.item){const state=new MeleeState(item.data);state.activate(now);this.active={rep,key:slot.item,d:item.data,kind:'melee',state,assets:assets[slot.item]??{sounds:{}}};}
  return this.active;
 }
 record(hit,ray,range,client,now,tool,notice=()=>{}){const target=serverTarget(hit?.body,client);let flag=Boolean(hit?.body?.isTree);
  if(flag){const blocker=this.blockers.forPoint(hit.point,now);if(blocker.numWood<1){flag=false;notice("There's no wood left here");}else blocker.numWood=Math.max(0,blocker.numWood-tool.efficiencies[2]);}
  return {...(target?{target}:{}),point:(hit?.point??ray.at(range,new Vector3())).toArray(),flag};
 }
}

// MeleeWeaponDataBlock.Local_MidSwing: vm.CrossFade("pull_out", 0.05, StopSameLayer, 1.1) after a cast hit when the hit
// IDMain has a TakeDamage (players, animals, structures, deployables; ore and wood-pile nodes have none) or the collider is
// a "Tree Collider" whose WoodBlockerTemp still had wood. Distance and other server checks do not enter into it.
export const meleePullOut=({takeDamage=false,treeWood=false}={})=>Boolean(takeDamage||treeWood);
// Online: the cast body (onlineActor: characters and animals; NGC bodies: onlineDamage from the prefab's TakeDamage) and
// the record's tree flag (already false when the blocker had no wood).
export const onlinePullOut=(body,record)=>meleePullOut({takeDamage:Boolean(body?.onlineActor||body?.onlineDamage),treeWood:Boolean(record?.flag)});
// Offline: MeleeGather.resolve results; animals and deployables/structures carry TakeDamage, trees count when they had wood.
export const offlinePullOut=result=>meleePullOut({takeDamage:['animal','deployable'].includes(result?.kind),treeWood:result?.kind==='tree'&&Boolean(result.hadWood)});

export function serverTarget(body,client){
 if(body?.onlineActor)return {p1:0,viewId:body.onlineActor.viewId};
 if(body?.online){const group=client.views.get(body.online.carrier)?.group;if(group)return {p1:group,p2:body.online.innerID};}
 return null;
}

// MeleeWeaponDataBlock.Local_MidSwing: Physics2SphereCast(eyesRay, 0.3, range, 406721553) (collision.mjs). overlap17: other
// players' layer-17 HitBoxSystem broadphase capsules (player-view.mjs hitBroadphase), for the origin-overlap fallback.
export function serverMeleeCast(world,ray,range,overlap17=null){return world.physics2SphereCast(ray,0.3,range,406721553,{overlap17});}

// GatewayClient reflects vectors once. Bone matrices already map raw Unity bone coordinates to browser world;
// NGC root matrices map browser-local coordinates to browser world, so only bone points need pre-reflection.
export function serverBulletRecord(hit,end,client){
 const b=hit?.body,target=serverTarget(b,client);
 if(!target)return {point:(hit?.position??end).toArray()};
 let point=hit.position.clone().applyMatrix4((b.onlineRoot??b.motion).clone().invert());if(b.onlineActor)point=reflect(point);
 return {target,bodyPart:b.bodyPart??254,point:point.toArray()};
}

export function serverGunRays(event,camera,worldHit,client){
 const eyes=reflect(camera.getWorldDirection(new Vector3()));
 return event.spread.map(spread=>{const direction=reflect(pelletDirection(eyes,spread)).normalize(),ray=new Ray(camera.position.clone(),direction),hit=worldHit(ray,event.range),end=hit?.position.clone()??ray.at(event.range,new Vector3());
  // Native misses report 1000 metres even for shorter weapon ranges.
  return {hit,end,record:serverBulletRecord(hit,ray.at(1000,new Vector3()),client)};});
}
