// Absolute native ClientVitalsSync/Metabolism snapshots. Local survival simulation never changes this state.
import {callTime} from './airdrops.mjs';
export class ServerVitals{
 constructor(session,{maxHealth=100,now=()=>performance.now()/1000,onChange=()=>{},onDeath=()=>{},onSpawn=()=>{},onVomit=()=>{},onHealth=()=>{},delay=()=>0}={}){
  // onHealth(health, attackerViewID): ClientVitalsSync.ClientHealthChange presentation. Local_HealthChange queues it as the
  // "DMG" InterpTimedEvent at the RPC's timestamp; it runs (and sets the health) once Interpolation.time, page time - delay(),
  // reaches that (frame), or at once when the character dies (DeathTransfer: InterpTimedEvent.Clear(invokePending)).
  Object.assign(this,{session,maxHealth,now,onChange,onDeath,onSpawn,onVomit,onHealth,delay});this.reset();
  for(const call of session.vitalsCalls.values())this.apply(call);
  if(session.state==='dead')this.kill();
  session.addEventListener('vitals-call',e=>this.apply(e.detail));
  session.addEventListener('character',()=>{this.reset();onSpawn();this.changed();});
  session.addEventListener('character-lost',()=>this.kill());this.changed();
 }
 reset(){this.health=this.maxHealth;this.bleeding=0;this.metabolism=null;this.notifiedDeath=false;this.pending=[];}
 changed(){this.onChange({health:this.health,bleeding:this.bleeding,metabolism:this.metabolism});}
 kill(){if(!this.notifiedDeath)for(const e of this.pending.splice(0)){this.health=e.health;this.onHealth(e.health,e.attacker);}this.pending.length=0;this.health=0;this.session.state='dead';this.changed();if(!this.notifiedDeath){this.notifiedDeath=true;this.onDeath();}}
 frame(time=this.now()){const playhead=time-this.delay();while(this.pending.length&&this.pending[0].at<=playhead)this.dmg(this.pending.shift());}
 dmg({health,attacker}){if(this.notifiedDeath)return;this.health=health;this.onHealth(health,attacker);if(this.health<=0){this.kill();return;}this.changed();}
 apply(call){const {name,args=[],receivedAt=this.now()}=call;
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  if(name==='Local_HealthChange'&&finite(args[0])){if(this.notifiedDeath)return;const at=callTime(call,receivedAt,this.session.clock);let i=this.pending.length;while(i>0&&this.pending[i-1].at>at)i--;
   this.pending.splice(i,0,{health:args[0],attacker:Number.isInteger(args[1])?args[1]:0,at});this.frame();return;}
  else if(name==='Local_BleedChange'&&finite(args[0]))this.bleeding=args[0];
  else if(name==='RecieveNetwork'&&args.length===6&&args.every(finite)){
   const [calories,water,rad,anti,temp,poison]=args;this.metabolism={caloricLevel:calories,waterLevelLitre:water,radiationLevel:rad,antiRads:anti,coreTemperature:temp,poisonLevel:poison,receivedAt};
  }else if(/^Client_OnKilled(?:By|Shot|ShotBy)?$/.test(name)){this.kill();return;}
  else if(name==='Vomit'){if(this.now()-receivedAt<2)this.onVomit();return;}
  else return;this.changed();
 }
}
