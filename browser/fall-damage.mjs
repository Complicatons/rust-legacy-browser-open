import {randomFloat,randomInt} from './loot.mjs';
// Offline port of the fall-damage chain (decompiled client HumanController.ProcessInput, client/server FallDamage):
// HumanController remembers where the character left the ground and the last airborne velocity; on landing more
// than 2 m below that point it calls FallDamage.SendFallImpact, which only reports velocity.y <= -18. The server's
// fIm/ValidateFallVelocity needs |velocity.y| >= falldamage.min_vel, then FallImpact applies bleeding, leg injury and
// TakeDamage.HurtSelf(10 + fraction * maxHealth). Online the client only sends fIm(velocity); the server applies
// everything and answers fIc (bob + legBreakSound) and fIo (leg injury level).

// falldamage ConsoleSystem defaults (identical in client and server assemblies).
export const FALL_DAMAGE={min_vel:24,max_vel:38,enabled:true,injury_length:40};

// HumanController.ProcessInput, evaluated once per rendered frame like the original Update.
export class FallTracker {
 constructor(){this.reset();}
 reset(){this.wasInAir=false;this.midairStartY=0;this.lastFrameVelocityY=0;this.lastFrameVelocity=[0,0,0];this.landingVelocity=null;}
 // Returns the landing velocity.y when SendFallImpact would be called, else null. `velocity` (optional, Unity space
 // [x,y,z]) is HumanController.lastFrameVelocity = CCMotor.velocity; the whole vector is what fIm carries.
 update(grounded,y,velocityY,velocity=null){
  this.landingVelocity=null;
  if(!grounded){if(!this.wasInAir){this.wasInAir=true;this.midairStartY=y;}this.lastFrameVelocityY=velocityY;this.lastFrameVelocity=velocity?[...velocity]:[0,velocityY,0];return null;}
  if(!this.wasInAir)return null;
  this.wasInAir=false;const start=this.midairStartY,v=this.lastFrameVelocityY,full=this.lastFrameVelocity;this.lastFrameVelocityY=0;this.lastFrameVelocity=[0,0,0];this.midairStartY=0;
  if(!(y<start&&Math.abs(y-start)>2))return null;
  this.landingVelocity=full;return v;
 }
}

// FallDamage.SendFallImpact: networkView.RPC("fIm", RPCMode.Server, velocity) unless velocity.y > -18 (so NaN is sent too).
// Returns the Unity-space Vector3 the original client sends, or null. The server alone validates and applies damage.
export function fallImpactMessage(velocity){return velocity&&!(velocity[1]>-18)?[...velocity]:null;}

// Client FallDamage.fIo(float) -> SetLegInjury: the owner's injury level is whatever the server last sent; HumanController
// treats GetLegInjury() > 0 as injured and RPOS.InjuryUpdate shows PlaqueInjury. The client never clears it on a timer.
export const legInjured=level=>level>0;

// FallDamage.SendFallImpact (client: !(velocity.y > -18)) + ValidateFallVelocity (server: |velocity.y| >= min_vel).
export function fallSpeed(velocityY,settings=FALL_DAMAGE){
 if(!(velocityY<=-18)||!settings.enabled)return 0;const speed=Math.abs(velocityY);return speed>=settings.min_vel?speed:0;
}

// Server FallDamage.FallImpact. healthFraction is read before any of the effects are applied.
export function fallImpact(fallspeed,{maxHealth,healthFraction,rng=Math.random,settings=FALL_DAMAGE}){
 const fraction=(fallspeed-settings.min_vel)/(settings.max_vel-settings.min_vel);
 const bleeding=fraction>0.25?3+(fraction-0.25)*10:0;
 // Random.Range(0, 3) == 0 (int overload: 0..2); evaluated after the 0.35 test, as C# short-circuits.
 const legInjury=fraction>0.35||randomInt(rng,0,3)===0||healthFraction<0.5;
 return {fraction,bleeding,legInjury,damage:10+fraction*maxHealth};
}

// FallDamage.ResetInjuryTime: injury_length * Random.Range(0.9, 1.1) seconds, restarted whenever injury is set > 0.
export function injuryDuration(rng=Math.random,settings=FALL_DAMAGE){return settings.injury_length*randomFloat(rng,0.9,1.1);}

// HumanController.UpdateInput while GetLegInjury() > 0: forced crouch, no jump or sprint, InputSample.MovementScale *= 0.5.
export function injuredInput(input,injured){return injured?{...input,crouch:true,jump:false,sprint:false,scale:(input.scale??1)*0.5}:input;}

// TakeDamage.HurtSelf(idMain, float): a plain HealthPoints quantity with no DamageTypeList, so ProtectionTakeDamage
// armour, the heal-over-time reset and the bullet/melee bleed roll of HumanBodyTakeDamage.Hurt do not apply.
// Same life-status rules as Vitals.hurt; a kill cancels DoBleed.
export function hurtSelf(vitals,amount){const status=vitals.dead?'IsDead':vitals.health>amount?'IsAlive':'WasKilled';
 if(status==='WasKilled'){vitals.health=0;if('nextBleed' in vitals)vitals.nextBleed=null;}else if(status==='IsAlive')vitals.health-=amount;return {status,amount};}
