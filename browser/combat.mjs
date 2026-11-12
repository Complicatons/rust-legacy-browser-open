import {Vector3,Quaternion,Euler,Ray,Box3,Matrix4} from 'three';
import {randomFloat} from './loot.mjs';
// Ports of decompiled WeaponItem/BulletWeaponItem/BulletWeaponDataBlock/ShotgunDataBlock (client firing + server damage),
// RecoilSimulation, BowWeaponItem/BowWeaponDataBlock/ArrowMovement, ThrowableItem/HandGrenadeDataBlock/TimedGrenade,
// TimedExplosive and ExplosionHelper. Unity space throughout; `world` adapters do the physics queries.
// DamageTypeList indices: 0 generic, 1 bullet, 2 melee, 3 explosion, 4 radiation, 5 cold.
export const Damage={Generic:0,Bullet:1,Melee:2,Explosion:3,Radiation:4,Cold:5};
// Inventory.FindItem + InventoryItem.Consume loop (the item with the most uses first; inventory.mjs consumeLargestFirst);
// a plain count/consume inventory (tests) takes in slot order.
const takeAmmo=(inventory,key,n)=>inventory.consumeLargestFirst?inventory.consumeLargestFirst(key,n):inventory.consume(key,n);
const typed=(index,amount)=>{const t=[0,0,0,0,0,0];t[index]=amount;return t;};

// RecoilSimulation: each impulse eases in over its duration (f + f - f^2), summed into eye pitch/yaw.
export class Recoil {
 constructor(){this.impulses=[];}
 add(duration,pitch,yaw){if(duration>0&&(pitch||yaw))this.impulses.push({pitch,yaw,fraction:0,timeScale:1/duration});}
 extract(dt){const sum={pitch:0,yaw:0};
  for(let i=this.impulses.length-1;i>=0;i--){const r=this.impulses[i],before=r.fraction+(r.fraction-r.fraction*r.fraction);r.fraction+=dt*r.timeScale;
   let step;if(r.fraction>=1){step=1-before;this.impulses.splice(i,1);}else step=r.fraction+(r.fraction-r.fraction*r.fraction)-before;
   sum.pitch+=r.pitch*step;sum.yaw+=r.yaw*step;}
  return sum;}
}

// InventoryItem.TryConditionLoss: condition is 0..1; broken items cannot be equipped (HeldItem.CanSetActivate).
export function tryConditionLoss(slot,d,probability,percentLoss,rng){if(!d.doesLoseCondition)return false;if(probability>=rng()){slot.condition=Math.max(0,conditionOf(slot)-percentLoss);return true;}return false;}
export const conditionOf=slot=>slot.condition>1?1:slot.condition??1;
export const isBroken=slot=>conditionOf(slot)<=0;

// Shared WeaponItem timing (deploy, sprint lockout, semi-auto edge detection).
export class WeaponState {
 constructor(d){this.d=d;this.nextPrimaryAttackTime=0;this.nextSecondaryAttackTime=0;this.deployFinishedTime=0;this.lastFrameAttack=false;this.wasSprinting=false;}
 // WeaponItem.OnSetActive
 activate(now){this.deployFinishedTime=now+this.d.deployLength;if(this.deployFinishedTime>this.nextPrimaryAttackTime)this.nextPrimaryAttackTime=this.nextSecondaryAttackTime=this.deployFinishedTime;}
 get deployed(){return true;}
 preFrame(now,input){
  if(input.sprinting){this.nextPrimaryAttackTime=Math.max(this.nextPrimaryAttackTime,now+0.1);this.wasSprinting=true;}
  else if(this.wasSprinting){this.nextPrimaryAttackTime=Math.max(this.nextPrimaryAttackTime,now+0.3);this.wasSprinting=false;}
  if(this.d.isSemiAuto){if(input.attack&&this.lastFrameAttack)input.attack=false;else if(!input.attack&&this.lastFrameAttack)this.lastFrameAttack=false;else if(input.attack&&!this.lastFrameAttack)this.lastFrameAttack=true;}
 }
}

// HeldItem.ItemPreFrame: HumanController.GetInputSample always sets aim = false; AltFire becomes aim (and stops being
// attack2) only when the datablock's secondaryFireAims is set and CanAim(). Look input (sample.yaw/pitch) is then
// scaled by aimSensitivtyPercent. The HandCannon (secondaryFireAims 0) never aims.
export function heldItemPreFrame(d,attack2,canAim){const aim=Boolean(attack2&&d.secondaryFireAims&&canAim);
 return {aim,attack2:Boolean(attack2)&&!aim,sensitivity:aim?d.aimSensitivtyPercent:1};}

// Mathf.PerlinNoise is native Unity code. Read statically from the shipped rust.exe (Unity 4 player): the internal call
// (0x6546b0) returns (noise(x, y) + 0.69) / 1.483 with doubles, stored as a float; noise (0x475bd0) is Ken Perlin's
// improved noise at z = 0 on |x| and |y| (so it mirrors at 0): the reference 512-entry permutation (statically
// initialised, 0xdee3a0), truncation to the lattice, fade 6t^5 - 15t^4 + 10t^3 and the 3D gradient set with z = 0.
// Float stores of the binary are kept with Math.fround; intermediate x87 rounding may differ in the last bits.
const PERLIN_P=(()=>{const p=[151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];return Uint8Array.from([...p,...p]);})();
const f32=Math.fround,fade=t=>f32(t*t*t*(t*(t*6-15)+10)),lerp=(t,a,b)=>f32(a+t*(b-a));
function grad(hash,x,y){const h=hash&15,u=h<8?x:y,v=h<4?y:h===12||h===14?x:0;return f32((h&1?-u:u)+(h&2?-v:v));}
export function perlinNoise(x,y){x=f32(Math.abs(x));y=f32(Math.abs(y));const xi=Math.trunc(x),yi=Math.trunc(y),X=xi&255,Y=yi&255;x=f32(x-xi);y=f32(y-yi);
 const u=fade(x),v=fade(y),p=PERLIN_P,A=p[X]+Y,B=p[X+1]+Y,AA=p[A],AB=p[A+1],BA=p[B],BB=p[B+1];
 const n=lerp(v,lerp(u,grad(p[AA],x,y),grad(p[BA],x-1,y)),lerp(u,grad(p[AB],x,y-1),grad(p[BB],x-1,y-1)));
 return f32((n+f32(0.69))/f32(1.483));}
// BulletWeaponItem.ItemPreFrame, after HeldItem.ItemPreFrame: while aiming (and aimSway > 0), t = Time.time * aimSwaySpeed
// and look input yaw += (PerlinNoise(t, t) - 0.5) * aimSway * (crouch ? 0.6 : 1) * dt, pitch the same with (t + 0.1,
// t + 0.2). Unity degrees: yaw positive turns right, pitch positive looks up.
export function aimSway(d,{aim,crouch},time,dt){if(!aim||!(d.aimSway>0))return null;const t=f32(time*d.aimSwaySpeed),k=f32(d.aimSway*(crouch?0.6:1));
 return {yaw:f32(f32(f32(perlinNoise(t,t)-0.5)*k)*dt),pitch:f32(f32(f32(perlinNoise(f32(t+f32(0.1)),f32(t+f32(0.2)))-0.5)*k)*dt)};}

// BulletWeaponItem (+ ShotgunDataBlock pellets). `slot.uses` is the clip (InstallData sets it to maxClipAmmo).
export class GunState extends WeaponState {
 constructor(d,ammoKey){super(d);this.ammoKey=ammoKey;this.reloadStartTime=-1;this.nextAimTime=0;}
 isReloading(now){return this.reloadStartTime!==-1&&now<this.reloadStartTime+this.d.reloadDuration;}
 canAim(now){return !this.isReloading(now)&&now>this.nextAimTime&&now>this.deployFinishedTime;}
 // One HumanController frame. Returns the events of this frame: dryfire, fire {rays, recoil}, reload {loaded}.
 frame(now,input,slot,inventory,rng=Math.random){const d=this.d,events=[];input={...input};
  if(input.attack&&slot.uses===0&&this.nextPrimaryAttackTime<=now){events.push({type:'dryfire'});this.nextPrimaryAttackTime=now+1;input.attack=false;}
  this.preFrame(now,input);
  if(input.attack&&now>=this.nextPrimaryAttackTime&&slot.uses>0)events.push(this.fire(now,input,slot,rng));
  // BulletWeaponItem.canReload / ActualReload_COD: ammo moves into the clip at once; firing waits reloadDuration.
  if(input.reload&&this.nextPrimaryAttackTime<=now&&slot.uses<d.maxClipAmmo&&inventory.count(this.ammoKey)>0){
   this.reloadStartTime=now;this.nextPrimaryAttackTime=now+d.reloadDuration;const want=d.maxClipAmmo-slot.uses,have=inventory.count(this.ammoKey),n=Math.min(want,have);takeAmmo(inventory,this.ammoKey,n);slot.uses+=n;events.push({type:'reload',loaded:n});}
  return events;}
 // BulletWeaponItem.PrimaryAttack + Local_FireWeapon (ShotgunDataBlock: numPellets spread rays).
 fire(now,input,slot,rng=Math.random){const d=this.d;
   this.nextPrimaryAttackTime=now+d.fireRate;if(d.NoAimingAfterShot)this.nextAimTime=now+d.fireRate;
   slot.uses-=1;
   const pellets=d.numPellets??1,spread=[];for(let i=0;i<pellets;i++)spread.push(d.numPellets?[randomFloat(rng,-d.xSpread,d.xSpread),randomFloat(rng,-d.ySpread,d.ySpread)]:[0,0]);
   // Recoil scale: aiming and crouching subtract (shotguns use aim or crouch, not both).
   let k=1;if(d.numPellets){if(input.aim)k-=d.aimingRecoilSubtract;else if(input.crouch)k-=d.crouchRecoilSubtract;}
   else if(input.aim&&input.crouch)k-=d.aimingRecoilSubtract+d.crouchRecoilSubtract*0.5;else if(input.aim)k-=d.aimingRecoilSubtract;else if(input.crouch)k-=d.crouchRecoilSubtract;
   k=Math.min(1,Math.max(0,k));
   return {type:'fire',spread,range:d.bulletRange,recoil:{duration:d.recoilDuration,pitch:randomFloat(rng,d.recoilPitchMin,d.recoilPitchMax)*k,yaw:randomFloat(rng,d.recoilYawMin,d.recoilYawMax)*k},
    damage:()=>randomFloat(rng,d.damageMin,d.damageMax),conditionLoss:d.numPellets?[0.5,0.02]:[0.33,0.01]};
 }
}
// StrikeGunItem (HandCannon, StrikeGunDataBlock : ShotgunDataBlock). ItemPreFrame order: BulletWeaponItem dry fire,
// WeaponItem timing/PrimaryAttack/Reload, then: release while striking cancels (idle cross-fade, 1 s lockout); Fire on an
// empty clip reloads when it can; once the random strike delay (strikeDurations[n-1], n = Random.Range(1, len + 1)) has
// passed with Fire still held, BulletWeaponItem.PrimaryAttack fires the ShotgunDataBlock pellets.
export class StrikeGunState extends GunState {
 constructor(d,ammoKey){super(d,ammoKey);this.resetFiring();}
 resetFiring(){this.actualFireTime=0;this.beganFiring=false;}
 activate(now){this.resetFiring();super.activate(now);}
 canReload(now,slot,inventory){return this.nextPrimaryAttackTime<=now&&slot.uses<this.d.maxClipAmmo&&inventory.count(this.ammoKey)>0;}
 reload(now,slot,inventory){this.reloadStartTime=now;this.nextPrimaryAttackTime=now+this.d.reloadDuration;const n=Math.min(this.d.maxClipAmmo-slot.uses,inventory.count(this.ammoKey));if(n>0){takeAmmo(inventory,this.ammoKey,n);slot.uses+=n;}return {type:'reload',loaded:n};}
 frame(now,input,slot,inventory,rng=Math.random){const d=this.d,events=[];input={...input};
  if(input.attack&&slot.uses===0&&this.nextPrimaryAttackTime<=now){events.push({type:'dryfire'});this.nextPrimaryAttackTime=now+1;input.attack=false;}
  this.preFrame(now,input);
  // WeaponItem: canPrimaryAttack (BulletWeaponItem adds clipAmmo > 0) -> StrikeGunItem.PrimaryAttack begins the strikes once.
  if(input.attack&&now>=this.nextPrimaryAttackTime&&slot.uses>0&&!this.beganFiring){
   const n=Math.min(Math.max(1+Math.floor(rng()*d.strikeDurations.length),1),d.strikeDurations.length);
   this.actualFireTime=now+d.strikeDurations[n-1];this.beganFiring=true;events.push({type:'strike',strikes:n,pitch:randomFloat(rng,0.96,1.03)});}
  if(input.reload&&this.canReload(now,slot,inventory))events.push(this.reload(now,slot,inventory));
  if(!input.attack&&this.beganFiring){events.push({type:'cancel'});this.nextPrimaryAttackTime=now+1;this.resetFiring();}
  if(input.attack&&slot.uses===0&&this.canReload(now,slot,inventory))events.push(this.reload(now,slot,inventory));
  if(this.beganFiring&&input.attack&&now>this.actualFireTime){events.push(this.fire(now,input,slot,rng));this.resetFiring();}
  return events;}
}
// Pellet ray: Quaternion.LookRotation(eyes) * Euler(x, y, 0) * forward (Unity degrees, left-handed).
export function pelletDirection(eyesDir,[x,y]){const look=lookRotation(eyesDir);return new Vector3(0,0,1).applyQuaternion(new Quaternion().setFromEuler(unityEuler(x,y,0))).applyQuaternion(look);}
// Unity Euler (ZXY order, degrees) in Unity space.
export function unityEuler(x,y,z){const r=Math.PI/180;return new Euler(x*r,y*r,z*r,'YXZ');}
// Quaternion.LookRotation: columns right = up x forward, up' = forward x right, forward.
export function lookRotation(forward,up=new Vector3(0,1,0)){const f=forward.clone().normalize(),r=new Vector3().crossVectors(up,f).normalize(),u=new Vector3().crossVectors(f,r);return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(r,u,f));}

// BowWeaponItem.ItemPreFrame: hold Fire to draw (drawLength), tire after 1 s drawn, cancel after tooTiredLength; release fires.
export class BowState extends WeaponState {
 constructor(d,arrowKey){super(d);this.arrowKey=arrowKey;this.arrowDrawn=false;this.tired=false;this.completeDrawTime=-1;}
 makeReadyIn(now,delay){this.nextPrimaryAttackTime=now+delay;this.tired=false;this.arrowDrawn=false;this.completeDrawTime=-1;}
 activate(now){super.activate(now);}
 deactivate(now){this.makeReadyIn(now,2);}
 get drawing(){return this.completeDrawTime!==-1;}
 frame(now,input,inventory){const d=this.d,events=[];let aim=false;
  if(input.attack&&this.nextPrimaryAttackTime<=now){
   if(this.arrowDrawn){const held=now-this.completeDrawTime;if(held>1){if(!this.tired)events.push({type:'tired'});this.tired=true;}if(held>d.tooTiredLength){events.push({type:'cancel'});this.makeReadyIn(now,d.fireRate*3);}}
   else if(!this.drawing){if(inventory.count(this.arrowKey)<=0){events.push({type:'noarrows'});this.makeReadyIn(now,2);}else {this.completeDrawTime=now+d.drawLength;events.push({type:'draw'});}}
   else if(this.completeDrawTime<now)this.arrowDrawn=true;
   if((this.arrowDrawn||this.drawing)&&now-(this.completeDrawTime-1)>0.5)aim=true;
  } else {
   if(this.arrowDrawn){if(inventory.count(this.arrowKey)<=0){events.push({type:'noarrows'},{type:'cancel'});this.makeReadyIn(now,d.fireRate*3);}
    else {takeAmmo(inventory,this.arrowKey,1);events.push({type:'fire',speed:d.arrowSpeed});this.makeReadyIn(now,d.fireRate);}}
   else if(this.arrowDrawn||this.drawing){events.push({type:'cancel'});this.makeReadyIn(now,d.fireRate*3);}
  }
  return {events,aim};}
}
// ArrowMovement: pitches down dropDegreesPerSec about its right axis, steps speed*dt with a ray each frame; 4 s / 1000 m life.
export class Arrow {
 constructor(position,rotation,speed,drop=5,maxRange=1000,maxLifeTime=4){this.position=position.clone();this.rotation=rotation.clone();this.speed=speed;this.drop=drop;this.maxRange=maxRange;this.maxLifeTime=maxLifeTime;this.age=0;this.distance=0;this.done=false;this.hit=null;}
 get forward(){return new Vector3(0,0,1).applyQuaternion(this.rotation);}
 // raycast(rayU, length) -> {point, normal, target}|null
 step(dt,raycast){if(this.done)return null;this.age+=dt;
  // transform.Rotate(Vector3.right, a): local X rotation; positive tips the nose down in Unity's left-handed space.
  this.rotation.multiply(new Quaternion().setFromEuler(unityEuler(this.drop*dt,0,0)));
  const ray=new Ray(this.position.clone(),this.forward),hit=raycast(ray,this.speed*dt);
  if(hit){this.position.copy(hit.point);this.done=true;this.hit=hit;return hit;}
  this.position.addScaledVector(ray.direction,this.speed*dt);this.distance+=this.speed*dt;
  if(this.distance>this.maxRange||this.age>this.maxLifeTime)this.done=true;return null;}
}
// BowWeaponDataBlock.DoAction2: an arrow hitting anything with TakeDamage deals 75 melee damage.
export const arrowDamage=()=>typed(Damage.Melee,75);

// ThrowableItem/HandGrenadeDataBlock: pull the pin on Fire, release after 1.25 s; the server throws at 20 m/s from eyes + 0.5 m.
export class ThrowState extends WeaponState {
 constructor(d){super(d);this.holdingBack=false;this.holdingStartTime=0;this.minReleaseTime=1.25;}
 activate(now){this.holdingBack=false;super.activate(now);}
 frame(now,input){const events=[];input={...input};this.preFrame(now,input);
  if(input.attack&&now>=this.nextPrimaryAttackTime){this.nextPrimaryAttackTime=now+1000;this.nextSecondaryAttackTime=now+1000;this.holdingBack=true;this.holdingStartTime=now;events.push({type:'pullpin'});}
  if(this.holdingBack&&!input.attack&&now-this.holdingStartTime>this.minReleaseTime){this.nextPrimaryAttackTime=now+1;this.nextSecondaryAttackTime=now+1;this.holdingBack=false;events.push({type:'throw',speed:20});}
  return events;}
}
// RigidObj grenade: gravity, Rigidbody drag, sphere contact with PhysicMaterial bounce (combine Average with a 0-bounce surface) and friction.
export class Grenade {
 constructor(position,velocity,{radius=0.125,drag=0.05,bounciness=0.25,friction=1,fuse=3,explosionRadius=6,damage=120}={}){Object.assign(this,{position:position.clone(),velocity:velocity.clone(),radius,drag,bounce:bounciness*0.5,friction,fuse,explosionRadius,damage});this.age=0;this.exploded=false;this.bounces=0;}
 // contact(centerU, radius) -> {normal, depth}|null
 step(dt,contact){if(this.exploded)return false;this.age+=dt;
  this.velocity.y-=9.81*dt;this.velocity.multiplyScalar(Math.max(0,1-this.drag*dt));this.position.addScaledVector(this.velocity,dt);
  const c=contact(this.position,this.radius);
  if(c){this.position.addScaledVector(c.normal,c.depth);const vn=this.velocity.dot(c.normal);
   if(vn<0){const normal=c.normal.clone().multiplyScalar(vn),tangent=this.velocity.clone().sub(normal);if(-vn>0.15)this.bounces++;
    this.velocity.copy(tangent.multiplyScalar(Math.max(0,1-this.friction*dt*8))).addScaledVector(normal,-this.bounce);}}
  if(this.age>=this.fuse){this.exploded=true;return true;}return false;}
 // TimedGrenade.OnDone: explosion point 0.3 m above the body.
 get explosionPoint(){return this.position.clone().add(new Vector3(0,0.3,0));}
}

// ExplosionHelper.OverlapExplosionUnique + the TimedGrenade/TimedExplosive damage rule.
// targets: [{id, bounds: Box3 (Unity), ...}]; occluded(point, dir, distance, target) -> blocked by another collider.
export function explosionSurfaces(point,radius,targets,occluded){const out=[];
 for(const t of targets){const b=t.bounds,closest=b.clampPoint(point,new Vector3()),boundsSq=closest.distanceToSquared(point);if(boundsSq>radius*radius)continue;
  const center=b.getCenter(new Vector3()),dir=center.clone().sub(point),sq=dir.lengthSq();if(sq>radius*radius)continue;
  const distance=Math.sqrt(sq),ext=b.getSize(new Vector3()).multiplyScalar(0.5);let rayDistance=Math.sqrt(Math.min(sq,(boundsSq<=1e-5?0:boundsSq)+ext.lengthSq()));
  let rayTest=sq>1e-10&&rayDistance>1e-5;const blocked=Boolean(rayTest&&occluded?.(point,dir.clone().normalize(),rayDistance,t));
  out.push({target:t,distance:sq>1e-10?distance:0,blocked});}
 // Unique: one surface per object, unblocked and nearest first.
 out.sort((a,b)=>a.blocked-b.blocked||a.distance-b.distance);const seen=new Set();return out.filter(s=>!seen.has(s.target.id)&&seen.add(s.target.id));}
export function explosionDamage(surface,radius,damage){let n=(1-Math.min(1,Math.max(0,surface.distance/radius)))*damage;if(surface.blocked)n*=0.1;return n;}

// TimedExplosive.Explode (Explosive Charge, fuseLength after placement): every surface except the carrier's object takes
// the falloff damage (no lower cut-off); the TransCarrier it is stuck to then takes the full damage, unoccluded.
export function timedExplosiveHits(point,radius,damage,targets,occluded,carrierId){const hits=[];
 for(const s of explosionSurfaces(point,radius,targets,occluded)){if(carrierId!=null&&s.target.id===carrierId)continue;hits.push({target:s.target,damage:explosionDamage(s,radius,damage),distance:s.distance,blocked:s.blocked});}
 if(carrierId!=null){const c=targets.find(t=>t.id===carrierId);if(c)hits.push({target:c,damage,carrier:true});}
 return hits.map(h=>({...h,types:typed(Damage.Explosion,h.damage)}));}
// TimedGrenade.OnDone: falloff damage, surfaces at or below 0.0001 skipped.
export function grenadeHits(point,radius,damage,targets,occluded){return explosionSurfaces(point,radius,targets,occluded).map(s=>({target:s.target,damage:explosionDamage(s,radius,damage),distance:s.distance,blocked:s.blocked})).filter(h=>h.damage>0.0001).map(h=>({...h,types:typed(Damage.Explosion,h.damage)}));}
// TimedExplosive.Explode's blast point: collider.enabled = false comes first, and a disabled collider's bounds are
// empty (centre zero), so the original always falls back to transform.TransformPoint(0, 0, 0.1).
export function timedExplosivePoint(position,rotation,scale={x:1,y:1,z:1}){return new Vector3(0,0,0.1*scale.z).applyQuaternion(rotation).add(position);}

// Server BulletWeaponDataBlock: GetDamage (Random.Range(min,max), x0.8 silenced) then x0.75 again when silenced
// (so x0.6 in all), headshots x8 on AI and x3 on players.
export function bulletDamage(base,{silenced=false,headshot=false,ai=false}={}){let n=base*(silenced?0.8:1);if(silenced)n*=0.75;if(headshot)n*=ai?8:3;return typed(Damage.Bullet,n);}

// EquipmentWearer.CalculateArmor: the four worn items' armorValues summed (slots 36-39).
export function wornArmor(slots,items){const sum=[0,0,0,0,0,0];for(let i=36;i<40;i++){const s=slots[i],d=s&&items[s.item]?.data;const a=d?.armorValues?.damageArray;if(a)a.forEach((v,j)=>sum[j]+=v);}return sum;}
// PlayerInventory slot flags: 36 head, 37 chest, 38 legs, 39 feet need Equip | that bit on the item.
export const equipSlotFlags={36:4|8,37:4|0x10,38:4|0x20,39:4|0x40};
export const canEquip=(index,d)=>!(index in equipSlotFlags)||((d._itemFlags&equipSlotFlags[index])===equipSlotFlags[index]);
