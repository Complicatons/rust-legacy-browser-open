// Offline (single-player) world saves. Networked play is saved by the real server (ServerSaveManager); this keeps the
// browser-only mode's world between visits. A save is versioned JSON: structures (masters → pieces with health),
// deployables (contents, fires, carriers, code locks), the player's inventory, vitals and position.
// Only what the original's ServerSaveManager writes is kept: a load is a server start, so the timers the original does
// not save restart (EnvDecay's stagger, FireBarrel's ConsumeFuel schedule, DeployedRespawn's cooldown, pent-up structure
// decay). The structure decay delay is a duration and needs no rebasing.
import {Vector3,Quaternion} from 'three';
import {StructureMaster,StructureComponent} from './structures.mjs';
import {CodeLock} from './locks.mjs';
import {savesItem} from './item-ops.mjs';

export const SAVE_VERSION=1;
const v3=v=>[v.x,v.y,v.z],q4=q=>[q.x,q.y,q.z,q.w];
const V=a=>new Vector3(...a),Q=a=>new Quaternion(...a);
const rel=(t,now)=>t===null||t===undefined?null:Number.isFinite(t)?t-now:(t<0?'-inf':'inf');
const abs=(t,now)=>t===null||t===undefined?null:t==='-inf'?-Infinity:t==='inf'?Infinity:t+now;
// ItemDataBlock.SaveItem/LoadItem (~380-406): a doesNotSave item (transientMode & 1) is never written or read back.
const kept=(s,items)=>Boolean(s)&&(!items||savesItem(items[s.item]?.data));
const slotsOf=(slots,items)=>slots?slots.map(s=>kept(s,items)?{...s}:null):null;

// The avatar's Vitals hold only what AvatarSaveRestore.SaveAvatar writes: Metabolism.SaveVitals (~476-492) calories,
// hydration, radiation, anti-rads and core temperature; HumanBodyTakeDamage.SaveVitals (~218-229, TakeDamage ~422)
// health, _bleedingLevel and _healOverTime. Everything else (poison, the vomit timer, consume/warm/damage times, tick
// schedulers) starts as the loading character's own. LoadVitals sets _bleedingLevel directly (not SetBleedingLevel), so
// DoBleed stays unscheduled until the next hit or bandage. Older saves carried every number: only these keys are read.
const BODY_VITALS=['health','bleedingLevel','healOverTime'],METABOLISM_VITALS=['caloricLevel','waterLevelLitre','radiationLevel','antiRads','coreTemperature'];
function vitalsState(o,keys){if(!o)return null;const out={};for(const k of keys)if(typeof o[k]==='number')out[k]=Number.isFinite(o[k])?o[k]:rel(o[k],0);return out;}
function applyVitals(o,s,keys){if(!o||!s)return;for(const k of keys){const v=s[k];if(typeof v==='number')o[k]=v;else if(v==='inf'||v==='-inf')o[k]=abs(v,0);}}

// BasicDoor.WriteObjectSave: target Opened (or Closing) saves 1, or 2 when opening in reverse; Opening/Closed save 0.
// `open` stays for saves read by older builds.
const DOOR_OPENED=1,DOOR_CLOSING=2;
function doorSave(door){if(!door)return {};const open=door.target===DOOR_OPENED||door.target===DOOR_CLOSING;return {open,doorState:open?(door.openingInReverse?2:1):0};}

// A dead player (player.dead) is saved as AvatarSaveRestore.ClearAvatar leaves the avatar after HumanController.OnKilled:
// only the inventory (the caller passes the after-death one: empty apart from the bound blueprints, or with the default
// items TryGiveDefaultItems adds on the next load), no position and no vitals, so the next load is a fresh spawn.
export function saveWorld({now,structures,deployables,player={}}){
 if(player.dead)player={inventory:player.inventory};
 const pieces=new Map(),masters=[];
 for(const m of structures?.masters??[]){const mi=masters.length,comps=[];
  for(const c of m.components){pieces.set(c,[mi,comps.length]);comps.push({item:c.itemKey,position:v3(c.position),rotation:q4(c.rotation),health:c.health});}
  masters.push({position:v3(m.position),rotation:q4(m.rotation),materialType:m.materialType,owner:m.ownerId??null,decay:m.decay?.save()??m.decayState??null,components:comps});}
 const objects=[...(deployables?.objects??[])],index=new Map(objects.map((o,i)=>[o,i]));
 const deployed=objects.map(o=>({item:o.itemKey,position:v3(o.position),rotation:q4(o.rotation),health:o.health,owner:o.ownerId??null,slots:slotsOf(o.slots,deployables?.items),
  carrier:o.carrier?(pieces.has(o.carrier)?{structure:pieces.get(o.carrier)}:index.has(o.carrier)?{deployable:index.get(o.carrier)}:null):null,
  // FireBarrel.WriteObjectSave: OnFire only. DeployedRespawn.lastSpawnTime and EnvDecay are not saved.
  fire:o.fire?{isOn:o.fire.isOn}:null,
  ...doorSave(o.door),lock:o.lock?.save()??null}));
 const inv=player.inventory;
 return {version:SAVE_VERSION,
  structures:masters,deployables:deployed,
  player:{position:player.position?v3(player.position):null,yaw:player.yaw??0,pitch:player.pitch??0,
   // PlayerInventory.SaveToAvatar (~177-216): the bound blueprints and the occupied slots only. The active item and the
   // crafting queue are not part of the avatar: a reload holds nothing and has lost what was being crafted.
   inventory:inv?{slots:slotsOf(inv.slots,inv.catalogue?.items),known:[...inv.known]}:null,
   body:vitalsState(player.body,BODY_VITALS),metabolism:vitalsState(player.metabolism,METABOLISM_VITALS)}};
}

// Rebuilds into empty systems. Pieces are restored without placement checks (like ServerSaveManager.IsLoading),
// so a save from an older ruleset still loads. Unknown items are skipped and reported.
export function loadWorld(save,{now,structures,deployables,player={}}){
 if(save?.version!==SAVE_VERSION)throw Error('Unsupported save version');
 const skipped=[],pieces=[];
 for(const sm of save.structures??[]){
  const m=new StructureMaster(structures,V(sm.position),Q(sm.rotation)),list=[];pieces.push(list);
  for(const sc of sm.components){const prefab=structures.prefabFor(sc.item);if(!prefab){skipped.push(sc.item);list.push(null);continue;}
   const c=new StructureComponent(structures,sc.item,prefab,V(sc.position),Q(sc.rotation));c.health=Math.min(sc.health,c.maxHealth);
   m.add(c);structures.components.add(c);list.push(c);}
  if(sm.materialType)m.materialType=sm.materialType;if(sm.owner!==null)m.ownerId=sm.owner;
  if(m.components.size){structures.masters.add(m);if(sm.decay)m.decayState=sm.decay;for(const c of m.components)structures.onAdd?.(c);}
 }
 const grab=deployables.grabCarrier;deployables.grabCarrier=undefined;const made=[];
 try{
  for(const so of save.deployables??[]){if(!deployables.entryFor(so.item)){skipped.push(so.item);made.push(null);continue;}
   const o=deployables.place(so.item,V(so.position),Q(so.rotation),now);made.push(o);
   o.health=Math.min(so.health,o.maxHealth);if(so.owner!==null)o.ownerId=so.owner;
   if(o.slots&&so.slots)so.slots.forEach((s,i)=>{if(i<o.slots.length)o.slots[i]=s?{...s}:null;});
   // FireBarrel.ReadObjectSave: SetOn(OnFire), i.e. a new InvokeRepeating("ConsumeFuel", Random.Range(d/2, d), d) from
   // the load. A respawn point starts with lastSpawnTime -Infinity (DeployedRespawn constructor): no cooldown after a load.
   if(o.fire&&so.fire)o.fire.setOn(Boolean(so.fire.isOn),now);
   if(so.lock)o.lock=CodeLock.load(so.lock);
   // Doors are built by onAdd (main.mjs). BasicDoor.ReadObjectSave: StartOpeningOrClosing(state, 0), so a saved 2 opens
   // in reverse (when the door can) and, timestamped 0, it is fully open at once (no open/opened sounds here).
   // Saves from before doorState only had `open` (forward).
   const doorState=so.doorState??(so.open?1:0);
   if(doorState&&o.door){o.door.startOpeningOrClosing(doorState,0);o.door.state=o.door.target;o.door.enabled=false;o.door.doDoorFraction(1);o.door.changed=true;}
  }
 }finally{deployables.grabCarrier=grab;}
 (save.deployables??[]).forEach((so,i)=>{const o=made[i];if(!o||!so.carrier)return;
  const carrier=so.carrier.structure?pieces[so.carrier.structure[0]]?.[so.carrier.structure[1]]:made[so.carrier.deployable];
  if(carrier?.carried){o.carrier=carrier;carrier.carried.add(o);}});
 // Saves written by older builds while dead (health 0: the player came back dead, with no death screen or respawn):
 // read as the cleared avatar instead: the fresh character's inventory keeps its default loadout and also binds the
 // saved blueprints (LoadToAvatar, then TryGiveDefaultItems).
 const old=save.player??{},wasDead=Boolean(old.body&&!(old.body.health>0)),p=wasDead?{}:old,inv=player.inventory;
 if(wasDead&&inv&&old.inventory)inv.known=new Set([...(inv.known??[]),...(old.inventory.known??[]).filter(k=>inv.catalogue.blueprints[k])]);
 // LoadToAvatar restores items and blueprints only; selected/work/benchUntil written by older builds are ignored (the
 // loading character holds nothing and crafts nothing), and doesNotSave items in them are not read back.
 if(inv&&p.inventory){inv.slots=Array.from({length:inv.slots.length},(_,i)=>{const s=p.inventory.slots[i];return s&&inv.catalogue.items[s.item]&&kept(s,inv.catalogue.items)?{...s}:null;});
  inv.selected=-1;inv.known=new Set(p.inventory.known.filter(k=>inv.catalogue.blueprints[k]));inv.work=null;inv.craftWorkbenchUntil=-Infinity;}
 applyVitals(player.body,p.body,BODY_VITALS);applyVitals(player.metabolism,p.metabolism,METABOLISM_VITALS);
 // LoadAvatar then always runs TryGiveDefaultItems → Loadout.ApplyTo (inventory.mjs giveDefaultItems): a saved character
 // without a Rock gets one back (belt slot 0 when free), an empty one the whole loadout.
 const given=inv?.giveDefaultItems?.()??[];
 return {skipped,position:p.position?V(p.position):null,yaw:p.yaw??0,pitch:p.pitch??0,wasDead,given};
}

// localStorage-style slot. Storage can be missing or throw (private mode, quota): failures return false/null.
export function saveSlot(storage,key='rlb-offline-save'){
 return {
  write(save){try{storage.setItem(key,JSON.stringify(save));return true;}catch{return false;}},
  read(){try{const t=storage.getItem(key);return t?JSON.parse(t):null;}catch{return null;}},
  clear(){try{storage.removeItem(key);}catch{}},
 };
}
