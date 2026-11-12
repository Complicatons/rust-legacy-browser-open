import {WeaponState,ThrowState,isBroken} from './combat.mjs';

export class FlareState extends WeaponState{
 activate(now){super.activate(now);this.lit=false;this.igniteAt=this.throwAt=this.secondaryAt=null;}
 ignite(now,events){if(this.lit)return;this.igniteAt=now+0.8;this.nextPrimaryAttackTime=this.nextSecondaryAttackTime=now+1.5;events.push({type:'ignite-animation'});}
 secondary(now,events){this.nextSecondaryAttackTime=now+this.d.fireRateSecondary;if(!this.lit){this.ignite(now,events);this.secondaryAt=now+1.51;}else{this.throwAt=now+0.5;this.nextPrimaryAttackTime=this.nextSecondaryAttackTime=now+1.5;events.push({type:'throw-animation'});}}
 frame(now,input){const events=[];input={...input};this.preFrame(now,input);
  if(input.attack&&now>=this.nextPrimaryAttackTime){this.nextPrimaryAttackTime=now+this.d.fireRate;this.ignite(now,events);}
  if(input.attack2&&now>=this.nextSecondaryAttackTime)this.secondary(now,events);
  if(this.throwAt!==null&&now>=this.throwAt){this.throwAt=null;this.lit=false;events.push({type:'flare-throw'});}
  if(this.igniteAt!==null&&now>=this.igniteAt){this.igniteAt=null;this.lit=true;events.push({type:'ignite'});}
  if(this.secondaryAt!==null&&now>=this.secondaryAt){this.secondaryAt=null;this.secondary(now,events);}return events;
 }
}

// GNUP alone changes the stack. Reservations only prevent repeat throws while confirmation is pending.
export class ServerThrowables{
 held(inv,catalogue,assets,now,enabled=true){const slot=enabled&&inv.slots[inv.activeSlot],item=slot&&catalogue.items[slot.item],rep=inv.activeRep;
  if(rep==null||!['HandGrenadeDataBlock','TorchItemDataBlock','BasicTorchItemDataBlock'].includes(item?.class)||isBroken(slot)){this.active=null;return null;}
  if(this.active?.rep!==rep||this.active.key!==slot.item){const kind=item.class==='HandGrenadeDataBlock'?'grenade':item.class==='TorchItemDataBlock'?'flare':'torch',state=kind==='grenade'?new ThrowState(item.data):kind==='flare'?new FlareState(item.data):{lit:true,nextPrimaryAttackTime:Infinity};state.activate?.(now);this.active={rep,key:slot.item,kind,d:item.data,state,assets:assets[slot.item]??{},ignitePending:kind==='torch'};}
  const w=this.active;w.slot=slot;if(w.revision!==inv.revision){w.revision=inv.revision;w.reserved=0;}w.reserved??=0;return w;
 }
 frame(w,now,input){if(w.ignitePending){w.ignitePending=false;return [{type:'ignite'}];}if(w.kind==='torch'||w.slot.uses-w.reserved<=0)return [];
  const events=w.state.frame(now,input);for(const e of events)if(e.type==='throw'||e.type==='flare-throw'){w.reserved++;if(e.type==='throw')e.strength=w.d.throwStrengthMin;/* Native heldThrowStrength clamps min to min, not max. */}return events;
 }
}
