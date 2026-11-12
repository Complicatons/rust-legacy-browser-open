import {Vitals} from './animals.mjs';
import {randomFloat,randomInt} from './loot.mjs';
import {hurtSelf} from './fall-damage.mjs';
// Ports of decompiled Metabolism, HumanBodyTakeDamage (bleeding, heal over time), ConsumableDataBlock.UseItem and
// BasicHealthKitDataBlock.UseItem. Times are seconds (Unity Time.time); rng returns [0,1).
// Metabolism (TakeDamage.HurtSelf), DoBleed (TakeDamage.Hurt(attacker, victim, float)) and harmful food hurt with a plain
// float Quantity: no DamageTypeList, so ProtectionTakeDamage armour never applies (hurtSelf, fall-damage.mjs).

const BULLET=1<<1,MELEE=1<<2,EXPLOSION=1<<3;

// HumanBodyTakeDamage: ProtectionTakeDamage + bleeding + heal-over-time (CheckLevels every 1 s).
export class HumanBody extends Vitals {
 constructor({maxHealth=100,bleedInterval=8,rng=Math.random}={}){super(maxHealth);this.rng=rng;this.bleedInterval=bleedInterval;this.bleedingLevel=0;this.bleedingLevelMax=100;this.healOverTime=0;this.nextBleed=null;this.nextCheck=null;this.lastCheck=0;this.listeners=[];}
 get healthLoss(){return this.maxHealth-this.health;}
 get healthLossFraction(){return 1-this.health/this.maxHealth;}
 isBleeding(){return this.bleedingLevel>0;}
 setBleedingLevel(level,now){this.bleedingLevel=level;this.nextBleed=level>0?now+this.bleedInterval:null;}
 bandage(amount,now){this.setBleedingLevel(Math.min(Math.max(this.bleedingLevel-amount,0),this.bleedingLevelMax),now);}
 heal(amount){if(amount<=0||this.dead)return 0;const used=Math.min(amount,this.maxHealth-this.health);this.health+=used;return used;}
 // HumanBodyTakeDamage.Hurt: melee/bullet/explosion damage cancels heal-over-time; heavy hits may start bleeding.
 hurtTyped(types,now){
  const r=this.hurt(types);let flags=0;types.forEach((v,i)=>{if(Math.abs(v)>1e-6)flags|=1<<i;});
  const physical=(flags&(BULLET|MELEE|EXPLOSION))!==0;if(physical)this.healOverTime=0;
  if(r.status==='WasKilled'){this.nextBleed=null;}
  else if(r.status==='IsAlive'&&this.healthLossFraction>0.2){
   const fraction=r.amount/this.maxHealth;
   if((flags&(BULLET|MELEE))!==0&&r.amount>this.maxHealth*0.05){
    const tier=fraction>=0.25?1:fraction>=0.15?2:fraction>=0.05?3:0;
    // Random.Range(0, tier) == 1 || tier == 1
    if(randomInt(this.rng,0,tier)===1||tier===1)this.setBleedingLevel(this.bleedingLevel+Math.min(Math.max(r.amount*0.15,1),this.maxHealth),now);
   }
  }
  return r;
 }
 // CheckLevels (1 s) and DoBleed (every bleedInterval while bleeding).
 update(now,warm=false,onDamage){
  if(this.nextCheck===null)this.nextCheck=now+1;
  while(now>=this.nextCheck){const dt=this.lastCheck>0?this.nextCheck-this.lastCheck:0;this.lastCheck=this.nextCheck;
   if(this.healOverTime>0){const amount=Math.min(Math.max(dt*3,0),this.healOverTime);this.healOverTime=Math.max(0,this.healOverTime-amount);this.heal(amount);}
   this.nextCheck+=1;}
  while(this.nextBleed!==null&&now>=this.nextBleed){const at=this.nextBleed;this.nextBleed+=this.bleedInterval;
   if(!this.alive||this.bleedingLevel<=0){this.nextBleed=null;break;}
   const amount=this.bleedingLevel*(warm?0.4:1),r=hurtSelf(this,amount);onDamage?.(r,'bleed');
   if(r.status==='IsAlive')this.bleedingLevel=Math.max(0,this.bleedingLevel-0.2);else this.nextBleed=null;
   if(this.bleedingLevel<=0)this.nextBleed=null;void at;}
 }
}

// Metabolism (player trait: tickRate 2 s, selfTick). Water is tracked but never consumed, as in the original.
export class Metabolism {
 constructor({tickRate=2,rng=Math.random}={}){Object.assign(this,{tickRate,rng,caloricLevel:1250,maxCaloricLevel:3000,caloriesPerHP:5,starvingDamagePerMin:10,waterLevelLitre:30,maxWaterLevelLitre:30,
  caloricMetabolicRate:300,caloricMetabolicRateMax:3000,radiationLevel:0,maxRadiationLevel:3000,antiRads:0,antiRadUsePerMin:3000,activityLevel:0,targetActivityLevel:0,lastConsumeTime:-Infinity,coreTemperature:0,lastWarmTime:-1000,nextVomitTime:0,poisonLevel:0,lastDamageTime:-Infinity,lastTick:null,night:false});this.shown=this.networkValues();}
 // What Metabolism.DoNetworkUpdate sends after a tick (RecieveNetwork -> RPOS.MetabolismUpdate). Until the first one the
 // client shows its own Metabolism's defaults. warm: the client's IsWarm right after a receive is temp >= 1.
 networkValues(){return {caloricLevel:this.caloricLevel,waterLevelLitre:this.waterLevelLitre,radiationLevel:this.radiationLevel,antiRads:this.antiRads,coreTemperature:this.coreTemperature,poisonLevel:this.poisonLevel,warm:this.coreTemperature>=1};}
 setTargetActivityLevel(level){this.targetActivityLevel=level;}
 canConsumeYet(now){return this.lastConsumeTime+3<now;}
 markConsumptionTime(now){this.lastConsumeTime=now;}
 remainingCaloricSpace(){return this.maxCaloricLevel-this.caloricLevel;}
 subtractCalories(n){this.caloricLevel=Math.max(0,this.caloricLevel-n);}
 addCalories(n){this.caloricLevel=Math.min(this.maxCaloricLevel,this.caloricLevel+n);}
 addWater(l){this.waterLevelLitre=Math.min(this.maxWaterLevelLitre,this.waterLevelLitre+l);}
 addAntiRad(n){this.antiRads+=n;}
 addRads(n){this.radiationLevel+=n;}
 addPoison(amount,now){this.poisonLevel+=amount;if(now>this.nextVomitTime)this.nextVomitTime=now+5;}
 subtractPoison(amount){this.poisonLevel-=amount;if(this.poisonLevel<=0)this.nextVomitTime=0;}
 markWarm(now){this.lastWarmTime=now;}
 isWarm(now){return now-this.lastWarmTime<=1;}
 // Online: Metabolism.RecieveNetwork(calories, water, rad, anti, temp, poison) sets the values, _lastWarmTime = now when
 // temp >= 1 (-1000 when temp < 0), then RPOS.MetabolismUpdate sets the plaques once (PlaqueWarm = IsWarm()); they stay
 // until the next RecieveNetwork (the server's 2 s tick), so `plaqueWarm` is latched here rather than read per frame.
 receiveNetwork(values,now){Object.assign(this,values);if(values.coreTemperature>=1)this.lastWarmTime=now;else if(values.coreTemperature<0)this.lastWarmTime=-1000;this.plaqueWarm=this.isWarm(now);}
 isPoisoned(){return this.poisonLevel>1;}
 hasRadiationPoisoning(){return this.radiationLevel>500;}
 markDamageTime(now){this.lastDamageTime=now;}
 // MetabolicUpdateFrame -> CalculateMetabolicVitals, applied to the HumanBody as HurtSelf or Heal.
 update(now,body,events={}){
  if(!body.alive)return;if(this.lastTick===null){this.lastTick=now;return;}
  while(now-this.lastTick>=this.tickRate&&body.alive){const t=this.tickRate;this.lastTick+=t;this.tick(t,this.lastTick,body,events);}
 }
 tick(timePassed,now,body,events){
  let hurt=0,heal=0;const minutes=timePassed/60,hours=minutes/60;
  this.activityLevel+=(this.targetActivityLevel-this.activityLevel)*Math.min(1,timePassed/15);
  // Core temperature: warm near fire (HeatZone), cold at night (EnvironmentControlCenter.IsNight, set by the time of day).
  this.coreTemperature=this.isWarm(now)?1:this.night?-1:0;let coldBurn=0;
  if(this.coreTemperature<0){this.coreTemperature=Math.min(0,this.coreTemperature+body.armor[5]*0.05);if(this.coreTemperature<0)coldBurn=1500*Math.abs(this.coreTemperature);}
  const burn=(this.caloricMetabolicRate+this.activityLevel*(this.caloricMetabolicRateMax-this.caloricMetabolicRate)+coldBurn)*hours;
  if(this.caloricLevel<=burn){hurt+=minutes*this.starvingDamagePerMin;this.caloricLevel=0;}
  else {this.caloricLevel-=burn;
   if(body.healthLoss>0&&this.radiationLevel<500&&!body.isBleeding()&&this.coreTemperature>=0&&now-this.lastDamageTime>10){
    let hp=10*minutes;const cost=this.caloriesPerHP*hp;if(this.isWarm(now))hp*=5;if(this.caloricLevel>=cost){this.caloricLevel-=cost;heal+=hp;}}}
  if(this.antiRads>0){const used=Math.min(Math.max(this.antiRadUsePerMin*minutes,0),this.antiRads);this.radiationLevel=Math.max(0,this.radiationLevel-used);this.antiRads-=used;}
  if(this.radiationLevel>0){const decay=this.radiationLevel/this.maxRadiationLevel*300*minutes;this.radiationLevel=Math.min(Math.max(this.radiationLevel-decay*(this.isWarm(now)?10:5),0),this.radiationLevel);
   if(this.radiationLevel>500)hurt+=decay*(this.isWarm(now)?0.33:1);}
  if(now>this.nextVomitTime&&this.poisonLevel>0){this.nextVomitTime=now+10;events.vomit?.();this.subtractCalories(randomInt(this.rng,100,200));hurt+=2;this.subtractPoison(1);}
  if(this.poisonLevel>0)hurt+=this.poisonLevel*10*minutes;
  if(hurt!==heal){if(hurt>heal){const r=hurtSelf(body,hurt-heal);events.damage?.(r,'metabolism');}else body.heal(heal-hurt);}
  // MetabolicUpdateFrame: DoNetworkUpdate only while still alive (always dirty: every tick touches the temperature).
  if(body.alive)this.shown=this.networkValues();
 }
}

// InventoryItem menu option for an item, as RetreiveMenuOptions/GetConsumeMenuItem name it.
export function menuOption(item){
 if(item.calories!==undefined&&('litresOfWater' in item)){if(item.calories>0&&item.litresOfWater<=0)return 'Eat';if(item.litresOfWater>0&&item.calories<=0)return 'Drink';return 'Consume';}
 if('healthAddMin' in item)return 'Use';return null;
}
// ConsumableDataBlock.UseItem / BasicHealthKitDataBlock.UseItem. Returns false when nothing happened.
export function useItem(item,state,{metabolism,body,now,rng=Math.random,events={}}){
 if('healthAddMin' in item){
  if(now<(state.lastUseTime??-Infinity)+5||body.healthLoss===0)return false;
  if(item.stopsBleeding)body.bandage(1000,now);const amount=randomFloat(rng,item.healthAddMin,item.healthAddMax);if(amount>0)body.healOverTime+=amount;state.lastUseTime=now;return true;
 }
 if(!metabolism.canConsumeYet(now))return false;metabolism.markConsumptionTime(now);
 const calories=Math.min(metabolism.remainingCaloricSpace(),item.calories);
 if(item.calories>0)metabolism.addCalories(calories);if(item.litresOfWater>0)metabolism.addWater(item.litresOfWater);if(item.antiRads>0)metabolism.addAntiRad(item.antiRads);
 if(item.healthToHeal>0)body.healOverTime+=item.healthToHeal;else if(item.healthToHeal<0){const r=hurtSelf(body,Math.abs(item.healthToHeal));events.damage?.(r,'food');}
 if(item.poisonAmount>0)metabolism.addPoison(item.poisonAmount,now);
 return true;
}
