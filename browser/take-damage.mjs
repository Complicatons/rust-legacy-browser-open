// Ports of the server's TakeDamage / ProtectionTakeDamage / StructureComponentTakeDamage (decompiled server
// Assembly-CSharp) for deployables and structure pieces, plus the client's HealthDimmer tint.
//
// TakeDamage.HurtShared: a DamageTypeList quantity first passes ApplyDamageTypeList (ProtectionTakeDamage scales each
// type by Clamp01(1 - armor/200) when both are > 0), then every type that is not ~0 is summed into ONE damage event.
// A plain float quantity (HurtSelf from decay, Kill = +Infinity) skips the armour entirely.
// TakeDamage.Hurt: dead -> IsDead (no change); health > amount -> IsAlive (health -= amount); else WasKilled (health = 0).
// Objects without a TakeDamage (the Explosive Charge) cannot be hurt at all (HurtShared returns Failed).
export const LifeStatus={Failed:-1,IsAlive:0,WasKilled:1,IsDead:2};
export const MAX_ARMOR=200; // ProtectionTakeDamage._maxArmorValue
const EPSILON8=1.1210387714598537e-44; // Mathf.Approximately(v, 0): |v| < max(1e-6 * |v|, Mathf.Epsilon * 8)
const clamp01=v=>v<0?0:v>1?1:v;

// The prefab's TakeDamage component: {kind, maxHealth, armor (null for a plain TakeDamage)} or null.
export function takeDamageData(prefab){const c=prefab?.components??{};
 for(const kind of ['StructureComponentTakeDamage','ProtectionTakeDamage','TakeDamage']){const d=c[kind]?.[0]?.data;if(!d)continue;
  return {kind,maxHealth:d._maxHealth??100,armor:kind==='TakeDamage'?null:[...(d._startArmorValues?.damageArray??[0,0,0,0,0,0])]};}
 return null;}

// DamageTypeList from a (typeIndex, amount) pair, or the list itself.
export const damageList=(amount,typeIndex)=>{const l=[0,0,0,0,0,0];l[typeIndex]=amount;return l;};

export class TakeDamage {
 constructor({maxHealth=100,armor=null}={}){const h=maxHealth<0.001?0.001:maxHealth; // Awake: HealthAliveValueClamp
  this.maxHealth=h;this.health=h;this.armor=armor?[...armor]:null;this.lastDamageTime=0;}
 get alive(){return this.health>0;}
 get dead(){return this.health<=0;}
 get healthFraction(){return this.health/this.maxHealth;}
 // ProtectionTakeDamage.ApplyDamageTypeList then TakeDamage.ApplyDamageTypeList.
 applyDamageTypeList(types){const t=[0,0,0,0,0,0];for(let i=0;i<6;i++)t[i]=Number(types[i]??0);
  if(this.armor)for(let i=0;i<6;i++)if(this.armor[i]>0&&t[i]>0)t[i]*=clamp01(1-this.armor[i]/MAX_ARMOR);
  let amount=0,flags=0;for(let i=0;i<6;i++)if(!(Math.abs(t[i])<EPSILON8)){flags|=1<<i;amount+=t[i];}
  return {amount,flags,types:t};}
 // quantity: number = health points (no armour), array = DamageTypeList. Returns the DamageEvent.
 // now: TakeDamage.HurtShared's MarkDamageTime (every hurt, even one that changes nothing), for TimeSinceHurt.
 hurt(quantity,now=null){if(now!=null)this.lastDamageTime=now;let amount,flags=0,types=null;
  if(Array.isArray(quantity))({amount,flags,types}=this.applyDamageTypeList(quantity));else amount=Number(quantity);
  const status=this.dead?LifeStatus.IsDead:this.health>amount?LifeStatus.IsAlive:LifeStatus.WasKilled;
  if(status===LifeStatus.WasKilled)this.health=0;else if(status===LifeStatus.IsAlive)this.health-=amount; // ProcessDamageEvent
  return {status,amount,flags,types};}
 timeSinceHurt(now){return now-this.lastDamageTime;}
 // TakeDamage.Heal (repair). usedAmount is computed after the clamp in the original, so a partial repair reports 0.
 heal(amount){if(amount<=0||this.dead||this.health===this.maxHealth)return 0;
  if(this.health>this.maxHealth-amount){this.health=this.maxHealth;return 0;}
  this.health+=amount;return amount;}
}

// A failed hurt (no TakeDamage on the object).
export const FAILED_HURT=Object.freeze({status:LifeStatus.Failed,amount:0,flags:0,types:null});

// Normalises the port's hurt(amount, typeIndex) call forms: (list), (amount, typeIndex) or (healthPoints).
export function quantityOf(amountOrList,typeIndex){if(Array.isArray(amountOrList))return amountOrList;return typeIndex===undefined||typeIndex===null?amountOrList:damageList(amountOrList,typeIndex);}

// HealthDimmer.MakeColor (client): the grey _Color written into the renderers' MaterialPropertyBlock on
// ClientHealthUpdate. averageRGB = mean of the first material's _Color; structure pieces darken towards 0.35,
// deployables towards a third of their colour.
export function healthDimmerGrey(percent,averageRGB,structureStyle){
 if(structureStyle)return 0.35+(averageRGB-0.35)*percent;
 const low=averageRGB*0.33;return low+(averageRGB-low)*percent;}
