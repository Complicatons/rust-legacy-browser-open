// The mock referee's world (tools/native/mock.mjs) for the gameplay rows: held items, crafting, building, deployables,
// doors and locks, loot containers, fires, explosive charges, player and animal damage, death sacks, falls and camp
// respawns. Message names, arguments and who receives them follow the decompiled server (analysis/decompiled/server:
// CraftingInventory, StructureComponentDataBlock, DeployableItemDataBlock, BasicDoor, LockEntry, Context, LootableObject,
// FireBarrel, TimedExplosive, MeleeWeaponDataBlock, BulletWeaponDataBlock, FallDamage, DropHelper). Numbers that need
// physics or prefab data the mock does not have (placement raycasts, damage scaling, cook times) are simple stand-ins.
// It is NOT the original server and proves nothing about it; it lets every row's request/reply path run locally.
import {readArgs,writeArgs,readNgcCall,ngcWire} from '../../bridge/ulink/rust.mjs';
import {BitReader} from '../../bridge/ulink/bits.mjs';
import {cullGroup,nearbyGroups,groupChangeFor} from './mock-cull.mjs';

const CARRIER=900,CARRIER_GROUP=7;
// The map crate's view (above the scene doors' manual views 3-62, below the referee's first allocated view 100).
const CRATE_VIEW=70,CRATE_SLOTS=12,CRATE_LOOT=[{name:'Cloth',uses:5},{name:'Bandage',uses:1}];
const quote=s=>'"'+String(s).replaceAll('"','\\"')+'"';
// Item -> NGC prefab handle (DeployableItemDataBlock.ObjectToPlace / StructureComponentDataBlock.structureToPlace).
const PLACES={'Camp Fire':';deploy_camp_bonfire','Furnace':';deploy_furnace','Wood Storage Box':';deploy_wood_box','Large Wood Storage':';deploy_wood_storage_large','Small Stash':';deploy_small_stash',
 'Sleeping Bag':';deploy_camp_sleepingbag','Wooden Door':';deploy_wood_door','Metal Door':';deploy_metal_door','Explosive Charge':';explosive_charge','Repair Bench':';deploy_repairbench','Workbench':';deploy_workbench',
 'Wood Foundation':';struct_wood_foundation','Wood Pillar':';struct_wood_pillar','Wood Wall':';struct_wood_wall','Wood Doorway':';struct_wood_doorway','Wood Ceiling':';struct_wood_ceiling','Wood Stairs':';struct_wood_stairs',
 'Wood Window':';struct_wood_windowframe','Wood Ramp':';struct_wood_ramp','Wood Barricade':';deploy_wood_barricade','Spike Wall':';deploy_woodspikewall','Large Spike Wall':';deploy_largewoodspikewall'};
const STRUCT_TYPE={';struct_wood_pillar':'pillar',';struct_wood_wall':'wall',';struct_wood_doorway':'doorway',';struct_wood_windowframe':'wall',';struct_wood_ceiling':'ceiling',';struct_wood_stairs':'stairs',';struct_wood_foundation':'foundation',';struct_wood_ramp':'ramp'};
const CAPACITY={';deploy_wood_box':12,';deploy_wood_storage_large':30,';deploy_small_stash':4,';deploy_camp_bonfire':8,';deploy_furnace':8,';deploy_repairbench':1,';drop_lootsack':36};
const COOKS={'Raw Chicken Breast':'Cooked Chicken Breast','Raw Meat':'Cooked Meat','Metal Ore':'Metal Fragments','Sulfur Ore':'Sulfur'};
const FIRE_TICK_MS=4000,FUSE_MS=10000,CRAFT_SCALE=1; // FireBarrel cook duration and TimedExplosive fuse stand-ins
const CHARGE_RANGE=2.4; // Explosive Charge placeRange 2 + minCastRadius 0.15, with a little slack for the centre point
// Unity quaternion helpers (x, y, z, w).
const qrot=([x,y,z,w],[vx,vy,vz])=>{const ix=w*vx+y*vz-z*vy,iy=w*vy+z*vx-x*vz,iz=w*vz+x*vy-y*vx,iw=-x*vx-y*vy-z*vz;return [ix*w+iw*-x+iy*-z-iz*-y,iy*w+iw*-y+iz*-x-ix*-z,iz*w+iw*-z+ix*-y-iy*-x];};
const qinv=([x,y,z,w])=>[-x,-y,-z,w];
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),scale=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const yawOf=([x,y,z,w])=>Math.atan2(2*(w*y+x*z),1-2*(y*y+x*x))*180/Math.PI;
// Ray (origin, unit-ish dir) to point: distance along the ray and off it.
function rayTo(o,d,p){const l=Math.hypot(...d)||1,u=scale(d,1/l),v=sub(p,o),t=dot(v,u);return {t,off:Math.hypot(...sub(v,scale(u,t)))};}

// backpackLockMs: player.backpackLockTime in ms (the original's default is 0, the shipped server.cfg sets 30 s).
// sceneDoors: the scene MovingDoors' manual view IDs the gateway knows (BasicDoor, quick use only: Context:A toggles).
export function createMockWorld({catalogue,registry,peers,nextView,held:heldItems={},sceneDoors=[],backpackLockMs=0,log=()=>{}}){
 // ItemRepresentation net names by item (deployables manifest `held`): other players draw a held item from its create.
 const reps=new Map(Object.values(heldItems).map(h=>[h.item,h]));
 const items=Object.entries(catalogue.items),byName=new Map(items.map(([k,v])=>[v.data.m_Name,{key:k,item:v}])),byUid=new Map(items.map(([k,v])=>[v.data._uniqueID,{key:k,item:v}]));
 const prefabs=new Map(registry.prefabs.map(p=>[p.handle,p]));
 const bpByUid=new Map(Object.keys(catalogue.blueprints).map(k=>[catalogue.items[k].data._uniqueID,k]));
 const defaults=Object.values(catalogue.loadouts).find(l=>l.data.m_Name==='Default Loadout')?.data._defaultBlueprints.map(r=>Object.keys(catalogue.blueprints).find(k=>k.endsWith(':'+r.m_PathID))).filter(Boolean)??[];
 const ents=new Map(),masters=new Map(),animals=new Map();let nextInner=1;
 const all=()=>peers().filter(p=>p.character!=null||p.attachedWorld);
 const nameOf=slot=>slot&&(slot.name??catalogue.items[slot.item]?.data.m_Name);
 const dataOf=name=>byName.get(name)?.item.data;
 const classOf=name=>byName.get(name)?.item.class;
 // ---- inventories (slot entries {name, uses, condition?}) -----------------------------------------------------------
 const maxUses=name=>dataOf(name)?._maxUses??1,splittable=name=>Boolean(dataOf(name)?._splittable);
 function addItem(slots,name,n,{from=0,to=36}={}){
  for(let i=from;i<to&&n>0;i++){const s=slots[i];if(s&&s.name===name&&splittable(name)&&s.uses<maxUses(name)){const k=Math.min(n,maxUses(name)-s.uses);s.uses+=k;n-=k;}}
  for(let i=from;i<to&&n>0;i++)if(!slots[i]){const k=splittable(name)?Math.min(n,maxUses(name)):1;slots[i]={name,uses:splittable(name)?k:(classOf(name)==='BulletWeaponDataBlock'?0:Math.max(1,maxUses(name)===1?1:k))};n-=splittable(name)?k:1;}
  return n;}
 const countItem=(slots,name)=>slots.reduce((a,s)=>a+(s?.name===name?(splittable(name)?s.uses:1):0),0);
 function takeItem(slots,name,n){if(countItem(slots,name)<n)return false;for(let i=slots.length-1;i>=0&&n>0;i--){const s=slots[i];if(s?.name!==name)continue;if(!splittable(name)){slots[i]=null;n--;continue;}const k=Math.min(n,s.uses);s.uses-=k;n-=k;if(!s.uses)slots[i]=null;}return true;}
 // ---- messages -------------------------------------------------------------------------------------------------------
 const popup=(peer,text,icon='',seconds=4)=>peer.rpc(997,'CL_ConsoleCommand',['string'],[`notice.popup ${seconds} ${quote(icon)} ${quote(text)}`]);
 const inventoryNotice=(peer,text)=>peer.rpc(997,'CL_ConsoleCommand',['string'],[`notice.inventory ${quote(text)}`]);
 const msgOf=(ent,name)=>ent.prefab.messages.findIndex(m=>m.name===name);
 // As the original server sends it (ngcWire): SetLooter/ClearLooter/ReceiveNetState type-safe without a timestamp, the
 // buffered ones (SetLooter, ReceiveNetState, DOo, modelindex) under their per-entity name.
 function call(peer,ent,name,values){const id=msgOf(ent,name);if(id<0)return;const m=ent.prefab.messages[id];try{peer.ngcCall(CARRIER,{innerID:ent.innerID,messageID:id,args:writeArgs(m.params,values).toBytes()},{...ngcWire(name),live:true});}catch(e){log('mock world call',name,e.message);}}
 const callAll=(ent,name,values)=>{for(const p of all())call(p,ent,name,values);};
 const createFor=(peer,ent)=>peer.ngcCreate(CARRIER,{prefabIndex:ent.prefab.index,innerID:ent.innerID,position:ent.position,euler:ent.euler});
 // Calls that carry an entity's state to a player who sees it for the first time (the original buffers them).
 function stateFor(peer,ent){
  if(ent.master!=null)call(peer,ent,'SMSet',[ent.master]);
  if(ent.kind==='door')call(peer,ent,'DOc',[ent.open?1:0]);
  if(ent.kind==='fire')call(peer,ent,'ReceiveNetState',[Boolean(ent.lit)]);
  if(ent.health!=null&&ent.health<ent.maxHealth)call(peer,ent,'ClientHealthUpdate',[ent.health]);
 }
 function spawnEntity(handle,position,euler,extra={}){
  const prefab=prefabs.get(handle);if(!prefab){log('mock world: no NGC prefab',handle);return null;}
  const ent={innerID:nextInner++,handle,prefab,position:[...position],euler:[...euler],kind:null,...extra};
  if(CAPACITY[handle]){ent.slots=ent.slots??Array(CAPACITY[handle]).fill(null);ent.looter=null;}
  if(handle===';deploy_wood_door'||handle===';deploy_metal_door'){Object.assign(ent,{kind:'door',open:false,lockActive:false,code:'',access:new Set()});}
  else if(handle===';deploy_camp_bonfire'||handle===';deploy_furnace')ent.kind='fire';
  else if(STRUCT_TYPE[handle])Object.assign(ent,{kind:'structure',type:STRUCT_TYPE[handle],maxHealth:handle===';struct_wood_foundation'?1000:500,health:handle===';struct_wood_foundation'?1000:500});
  else if(handle===';explosive_charge')ent.kind='charge';
  else if(handle===';deploy_camp_sleepingbag')ent.kind='bag';
  else if(handle===';drop_lootsack')ent.kind='sack';
  if(ent.slots&&!ent.kind)ent.kind='box';
  ents.set(ent.innerID,ent);for(const p of all()){createFor(p,ent);stateFor(p,ent);}return ent;
 }
 function destroyEntity(ent){ents.delete(ent.innerID);for(const p of all())p.ngcDestroy(CARRIER,ent.innerID);}
 const gnupEntity=(peer,ent,full=true)=>call(peer,ent,'GNUP',[inventoryBytes(ent.slots,{capacity:ent.slots.length})]);
 let inventoryBytes=()=>new Uint8Array(0); // set by the referee (tests/helpers/inventory-fixture)
 // ---- network culling (tools/native/mock-cull.mjs) ------------------------------------------------------------------
 // Characters (Controllable.SpawnPlayerRoot) live in the group of their CullGrid cell and their item representations
 // ride on them (NetCull piggy-back: the same group, moved with RunRiderCommand(ApplyGroupChange)). A player hears a
 // character's Create, moves and calls only while subscribed to its group. A peer without cull state (a test's bare
 // fake peer) is seen by everyone, as before.
 const sees=(o,peer)=>peer.charGroup==null||Boolean(o.cullGroups?.has(peer.charGroup));
 // uLink keeps the Instantiate a view was created with (position = where the character SPAWNED) and only rewrites its
 // group bytes when the group changes; a player who meets the character later is sent that copy.
 const characterCreate=o=>({viewId:o.character,owner:o.playerId,group:o.charGroup,prefab:':player_soldier',position:o.spawnedAt??o.last??[0,0,0],rotation:o.spawnRot??[0,0,0,1]});
 function bufferedViews(peer,to){const out=[peer.create(characterCreate(peer),{buffered:true})];const rep=peer.held&&repCreate(peer,to);if(rep)out.push(peer.create(rep,{buffered:true}));return out;}
 // O1629.O3135 for one view: ChangeGroup / BufferedRPCs(Create) / DestroyByViewID per other player, ChangeGroup to the owner.
 function moveView(peer,viewId,from,to,createBytes){
  for(const o of peers()){if(o===peer||!o.attachedWorld||!o.cullGroups)continue;
   const what=groupChangeFor(o.cullGroups,from,to);
   try{if(what==='change')o.changeGroup(viewId,to);else if(what==='create'){const m=createBytes(o);if(m)o.buffered([m]);}else if(what==='destroy')o.destroyView(viewId);}catch{}}
  try{peer.changeGroup(viewId,to);}catch{}
 }
 // CullGrid.SetPlayerCenterFromGroupID: union first (AddPlayerToGroup: the group's buffered views, one BufferedRPCs),
 // then except (RemovePlayerFromGroup: DestroyInGroup when the group still holds views).
 function subscribe(peer,center){
  const next=nearbyGroups(center),prev=peer.cullGroups??new Set();peer.cullGroups=next;
  const others=g=>peers().filter(o=>o!==peer&&o.attachedWorld&&o.character!=null&&o.charGroup===g);
  for(const g of next)if(!prev.has(g)){const views=others(g).flatMap(o=>bufferedViews(o,peer));if(views.length)try{peer.buffered(views);}catch{}}
  for(const g of prev)if(!next.has(g)&&others(g).length)try{peer.destroyGroup(g);}catch{}
 }
 // NetCull.CullProcessor: the character crossed into another cell (checked on every move, like CheckMover).
 function recull(peer,origin){
  const to=cullGroup(origin),from=peer.charGroup;if(from==null||to===from)return;
  peer.charGroup=to;
  moveView(peer,peer.character,from,to,()=>peer.create(characterCreate(peer),{buffered:true}));
  if(peer.held)moveView(peer,peer.held.rep,from,to,o=>{const c=repCreate(peer,o);return c&&peer.create(c,{buffered:true});});
  subscribe(peer,to);
 }
 // ---- players ----------------------------------------------------------------------------------------------------
 const charOf=viewId=>peers().find(p=>p.character===viewId);
 // EquipmentWearer: armour totals of the worn slots 36-39 (ArmorDataBlock.armorValues, DamageTypeList order).
 function armourOf(peer){const t=[0,0,0,0,0,0];for(let i=36;i<40;i++){const a=dataOf(nameOf(peer.slots[i]))?.armorValues?.damageArray;if(a)a.forEach((v,j)=>t[j]+=v);}return t;}
 function sendArmour(peer){const b=Buffer.alloc(24);armourOf(peer).forEach((v,i)=>b.writeFloatLE(v,i*4));peer.rpc(peer.character,'ArmorData',['byte[]'],[new Uint8Array(b)]);}
 // HumanBodyTakeDamage stand-in: protection = summed armour of that damage type, capped at 80 %.
 function hurtPlayer(victim,amount,type,attacker,{bleed=0}={}){
  if(victim.character==null||victim.health<=0)return;
  const armour=armourOf(victim)[type]??0,dealt=amount*(1-Math.min(0.8,armour/200));victim.health=Math.max(0,victim.health-dealt);
  victim.rpc(victim.character,'Local_HealthChange',['float','uLink.NetworkViewID'],[victim.health,attacker?.character??0]);
  if(bleed&&victim.health>0){victim.bleed=(victim.bleed??0)+bleed;victim.rpc(victim.character,'Local_BleedChange',['float'],[victim.bleed]);}
  if(victim.health<=0)kill(victim,attacker);
 }
 // DeathTransfer + DropHelper.DropInventoryContents: killed-by to the victim, the body's items into a loot sack.
 // HumanController.OnKilled: with player.backpackLockTime > 0 the sack gets a TimedLockable owned by the dead player,
 // locked for that long (HasAccess: !lockActive || userid == ownerID).
 function kill(victim,attacker){
  const view=victim.character;
  // DeathTransfer to every client on the victim's view (others run the death and ragdoll from it).
  for(const p of peers())if(p===victim||(p.attachedWorld&&sees(p,victim)))try{if(attacker?.character!=null)p.rpc(view,'Client_OnKilledBy',['uLink.NetworkViewID'],[attacker.character]);else p.rpc(view,'Client_OnKilled',[],[]);}catch{}
  const items=victim.slots.map((s,i)=>s&&{...s}).filter(Boolean);for(let i=0;i<victim.slots.length;i++)victim.slots[i]=null;
  if(items.length){const slots=Array(CAPACITY[';drop_lootsack']).fill(null);items.forEach((s,i)=>{slots[i]=s;});const sack=spawnEntity(';drop_lootsack',victim.last??[0,0,0],[0,0,0],{slots});
   if(sack&&backpackLockMs>0)sack.timedLock={owner:victim.user,until:Date.now()+backpackLockMs};}
  victim.dead=true;victim.dropHeld?.();victim.character=null;setTimeout(()=>{for(const p of peers())try{p.destroyView(view);}catch{}},400);
 }
 // ---- held items (Inventory.DoBeltUse -> IAST with the item representation view) ---------------------------------
 function useBelt(peer,belt){
  const slot=30+belt,s=peer.slots[slot];if(!s)return;
  if(peer.held?.slot===slot)return;
  dropHeld(peer);
  const rep=nextView();peer.held={slot,rep,name:s.name};for(const p of peers())if(p===peer||(p.attachedWorld&&sees(p,peer)))showRep(p,peer);
  peer.rpc(peer.character,'IAST',['byte','uLink.NetworkViewID'],[slot,rep]);
 }
 // The representation is network-instantiated for everyone: initialData = parent NetworkViewID (ushort) + item uniqueID.
 function repCreate(owner,to){const h=owner.held,info=reps.get(h.name);if(!info&&to!==owner)return null;
  const data=new Uint8Array(6),v=new DataView(data.buffer);v.setUint16(0,owner.character??0,true);v.setInt32(2,info?.uid??0,true);
  return {viewId:h.rep,owner:owner.playerId,group:owner.charGroup??0,prefab:info?.netName??'MockHeldItem',initialData:data};}
 function showRep(to,owner){const c=repCreate(owner,to);if(c)to.create(c);}
 // Inventory.DeactivateItem: the representation goes and the owner hears ITDE.
 function dropHeld(peer){if(!peer.held)return;for(const p of peers())try{p.destroyView(peer.held.rep);}catch{}try{if(peer.character!=null)peer.rpc(peer.character,'ITDE',[],[]);}catch{}peer.held=null;}
 // ---- crafting (CraftingInventory) ----------------------------------------------------------------------------------
 function craftStart(peer,amount,uid){
  const key=bpByUid.get(uid),bp=key&&catalogue.blueprints[key];if(!bp||amount<1)return;
  // BlueprintDataBlock.CanWork: workbench and ingredients only (the server does not check that the blueprint is known).
  if(bp.workbench)return;
  for(const ing of bp.ingredients)if(countItem(peer.slots,catalogue.items[ing.item].data.m_Name)<ing.amount*amount)return;
  clearTimeout(peer.craft?.timer);const duration=bp.seconds*amount*CRAFT_SCALE;
  peer.craft={key,amount,started:Date.now(),timer:setTimeout(()=>craftDone(peer),duration*1000)};
  peer.rpc(peer.character,'CRFU',['float','float','float','float','int','int'],[Date.now()/1000%100000,duration,1,0,uid,amount]);
 }
 function craftDone(peer){
  const c=peer.craft;if(!c)return;peer.craft=null;const bp=catalogue.blueprints[c.key];
  if(bp.ingredients.every(i=>countItem(peer.slots,catalogue.items[i.item].data.m_Name)>=i.amount*c.amount)){
   for(const i of bp.ingredients)takeItem(peer.slots,catalogue.items[i.item].data.m_Name,i.amount*c.amount);
   addItem(peer.slots,catalogue.items[bp.result].data.m_Name,bp.amount*c.amount);peer.gnup();}
  peer.rpc(peer.character,'CRFC',[],[]);
 }
 function craftCancel(peer){if(!peer.craft)return;clearTimeout(peer.craft.timer);peer.craft=null;peer.rpc(peer.character,'CRFC',[],[]);}
 function sendBlueprints(peer){const uids=[...peer.known].map(k=>catalogue.items[k].data._uniqueID),b=Buffer.alloc(4+4*uids.length);b.writeInt32LE(uids.length,0);uids.forEach((u,i)=>b.writeInt32LE(u,4+4*i));peer.rpc(peer.character,'ReceiveBoundBPs',['byte[]'],[new Uint8Array(b)]);}
 // InventoryItem.MenuItem.Study (IACT option) -> BlueprintDataBlock.UseItem.
 function menuAction(peer,slot,option){
  const s=peer.slots[slot];if(!s)return;
  if(classOf(s.name)==='BlueprintDataBlock'){const key=byName.get(s.name).key;
   if(peer.known.has(key))return popup(peer,'You already have this blueprint','');
   peer.known.add(key);takeItem(peer.slots,s.name,1);peer.gnup();sendBlueprints(peer);popup(peer,'You can now craft: '+catalogue.items[catalogue.blueprints[key].result].data.m_Name,'');}
 }
 // ---- building (StructureComponentDataBlock.DoAction1 + StructureComponent.CheckLocation, simplified) -------------
 const local=(m,p)=>qrot(qinv(m.rotation),sub(p,m.position));
 const cell=v=>[Math.round(v[0]/2.5),Math.round(v[1]/4),Math.round(v[2]/2.5)].join();
 const at=(m,l,type)=>[...ents.values()].find(e=>e.kind==='structure'&&e.masterRef===m&&cell(local(m,e.position))===cell(l)&&(!type||e.type===type));
 function placeStructure(peer,name,[origin,dir,pos,rot,masterId]){
  const handle=PLACES[name],type=STRUCT_TYPE[handle];if(!type)return false;
  if(Math.hypot(...sub(pos,origin))>12)return false;
  let m=masterId?masters.get(masterId):null;
  if(!m){if(type!=='foundation')return false;
   for(const o of masters.values())if(Math.hypot(pos[0]-o.position[0],pos[2]-o.position[2])<7.4)return false;
   m={viewId:nextView(),position:[...pos],rotation:[...rot]};masters.set(m.viewId,m);for(const p of all())p.create({viewId:m.viewId,prefab:'StructureMasterPrefab',position:m.position,rotation:m.rotation});}
  else{
   const l=local(m,pos),right=qrot(rot,[2.5,0,0]),wallType=type==='wall'||type==='doorway';
   if(at(m,l))return false;
   if(wallType){const a=at(m,local(m,add(pos,right)),'pillar'),b=at(m,local(m,sub(pos,right)),'pillar');if(!a||!b)return false;}
   else if(type==='pillar'){const below=at(m,[l[0],l[1]-4,l[2]],'pillar'),onFoundation=Math.round(l[1])===4&&Math.abs(l[0])<=2.51&&Math.abs(l[2])<=2.51;if(!below&&!onFoundation)return false;}
   else if(type==='ceiling'||type==='stairs'){for(const [x,z]of [[-2.5,-2.5],[2.5,2.5],[-2.5,2.5],[2.5,-2.5]])if(!at(m,[l[0]+x,l[1],l[2]+z],'pillar'))return false;}
   else if(type==='foundation'){const ok=Math.round(l[1])===0&&((Math.abs(Math.abs(l[0])-5)<0.01&&Math.abs(l[2])<0.01)||(Math.abs(Math.abs(l[2])-5)<0.01&&Math.abs(l[0])<0.01));if(!ok)return false;}
   else return false;
  }
  const ent=spawnEntity(handle,pos,[0,yawOf(rot),0],{masterRef:m,master:m.viewId,owner:peer.user});
  return Boolean(ent);
 }
 // ---- deployables (DeployableItemDataBlock.DoAction1: the server redoes the placement from the eye ray) -----------
 function placeDeployable(peer,name,[origin,dir]){
  const handle=PLACES[name];if(!handle)return false;
  if(handle===';deploy_wood_door'||handle===';deploy_metal_door'){
   const dw=[...ents.values()].filter(e=>e.type==='doorway').map(e=>({e,r:rayTo(origin,dir,add(e.position,[0,2,0]))})).filter(x=>x.r.t>0&&x.r.t<8&&x.r.off<2).sort((a,b)=>a.r.off-b.r.off)[0];
   if(!dw||[...ents.values()].some(e=>e.kind==='door'&&e.doorway===dw.e.innerID))return false;
   return Boolean(spawnEntity(handle,dw.e.position,dw.e.euler,{owner:peer.user,doorway:dw.e.innerID}));}
  // The Explosive Charge's placeRange is 2 m (+ its 0.15 m cast radius): further away the original drops it to the
  // ground below the ray's end, never onto the wall. A wall panel is 5 m wide and 4 m high around its centre.
  if(handle===';explosive_charge'){
   const target=[...ents.values()].filter(e=>e.kind==='structure'&&e.type!=='foundation').map(e=>({e,r:rayTo(origin,dir,add(e.position,[0,2,0]))})).filter(x=>x.r.t>0&&x.r.t<CHARGE_RANGE&&x.r.off<(x.e.type==='pillar'?0.6:2.6)).sort((a,b)=>a.r.t-b.r.t)[0];
   if(!target)return false;const l=Math.hypot(...dir)||1,p=add(origin,scale(dir,target.r.t/l));
   const ent=spawnEntity(handle,p,[0,0,0],{owner:peer.user,stuckTo:target.e.innerID});if(ent)setTimeout(()=>explode(ent),FUSE_MS);return Boolean(ent);}
  // Ground: the eye ray down to the player's feet height, 1-4.5 m away.
  if(!(dir[1]<-0.05))return false;const feet=peer.last?.[1]??origin[1]-1.7,t=(feet-origin[1])/dir[1],p=add(origin,scale(dir,t)),d=Math.hypot(p[0]-origin[0],p[2]-origin[2]);
  // A flat plane at the feet stands in for the terrain raycast, so on slopes it is only roughly where the client put
  // its preview: keep to the range and stay off structures; the client already checked overlaps with deployables.
  if(d<0.5||d>6)return false;if([...ents.values()].some(e=>e.kind==='structure'&&Math.hypot(e.position[0]-p[0],e.position[2]-p[2])<3.3&&Math.abs(e.position[1]-p[1])<4.5))return false;
  return Boolean(spawnEntity(handle,[p[0],feet,p[2]],[0,Math.atan2(dir[0],dir[2])*180/Math.PI,0],{owner:peer.user}));
 }
 // TimedExplosive.Explode: damage falls off over 3 m (ExplosionHelper stand-in: 300 to the piece it sits on).
 function explode(ent){
  if(!ents.has(ent.innerID))return;callAll(ent,'ClientExplode',[]);
  for(const e of [...ents.values()]){if(e.kind!=='structure')continue;const d=Math.hypot(...sub(add(e.position,[0,2,0]),ent.position));if(d>3.2&&e.innerID!==ent.stuckTo)continue;
   e.health=Math.max(0,e.health-(e.innerID===ent.stuckTo?300:120));callAll(e,'ClientHealthUpdate',[e.health]);if(e.health<=0){callAll(e,'ClientKilled',[]);destroyEntity(e);}}
  setTimeout(()=>destroyEntity(ent),200);
 }
 // ---- item actions on the held representation ---------------------------------------------------------------------
 function itemAction(peer,h,b){
  const held=peer.held;if(!held||h.viewId!==held.rep)return;const s=peer.slots[held.slot];if(!s)return;const cls=classOf(s.name),d=dataOf(s.name);
  // ItemRepresentation.ActionStream / Action(n, AllExceptOwner): weapon actions reach the other clients unchanged.
  const raw=/B$/.test(h.rpc)?readArgs(['byte[]'],b)[0]:null,stream=()=>new BitReader(raw);
  if(raw||(h.rpc==='Action3'&&!/^Deployable|Structure/.test(cls)))for(const p of peers())if(p!==peer&&p.attachedWorld&&sees(p,peer))try{p.rpc(held.rep,h.rpc,raw?['byte[]']:[],raw?[raw]:[]);}catch{}
  if(h.rpc==='Action1'&&cls==='StructureComponentDataBlock'){if(placeStructure(peer,s.name,readArgs(['Vector3','Vector3','Vector3','Quaternion','uLink.NetworkViewID'],b))){takeItem(peer.slots,s.name,1);if(!peer.slots[held.slot])dropHeld(peer);peer.gnup();}return;}
  if(h.rpc==='Action1'&&/^Deployable/.test(cls)){if(placeDeployable(peer,s.name,readArgs(['Vector3','Vector3'],b))){s.uses-=1;if(s.uses<=0){peer.slots[held.slot]=null;dropHeld(peer);}peer.gnup();}return;}
  if(h.rpc==='Action1B'&&cls==='MeleeWeaponDataBlock'){const r=stream(),target=r.u8()?readArgs(['NetEntityID'],r)[0]:null,[point]=readArgs(['Vector3'],r),tree=r.u8()!==0;
   if(tree){addItem(peer.slots,'Wood',1);inventoryNotice(peer,'1 x Wood');peer.gnup();return;}
   if(target?.p1===0){const v=charOf(target.viewId);if(v&&v!==peer)return hurtPlayer(v,d.damageMax??20,2,peer,{bleed:Math.random()<0.3?1:0});
    const a=animals.get(target.viewId);if(a)return hurtAnimal(peer,a,d.damageMax??20);}
   return;}
  if(cls==='BowWeaponDataBlock'){
   if(h.rpc==='Action1B'){if(takeItem(peer.slots,'Arrow',1))peer.gnup();return;}
   if(h.rpc==='Action2B'){const [target]=readArgs(['NetEntityID'],stream());if(target?.p1===0){const v=charOf(target.viewId);if(v&&v!==peer)hurtPlayer(v,40,1,peer,{bleed:1});const a=animals.get(target.viewId);if(a)hurtAnimal(peer,a,40);}return;}
   return;}
  if(cls==='BulletWeaponDataBlock'){
   if(h.rpc==='Action3'){const need=(d._maxUses??8)-s.uses,have=countItem(peer.slots,'9mm Ammo'),k=Math.min(need,have);if(k>0){takeItem(peer.slots,'9mm Ammo',k);s.uses+=k;peer.gnup();}return;}
   if(h.rpc==='Action1B'){if(s.uses<=0)return;s.uses-=1;peer.gnup();const r=stream();
    while(r.remainingBytes>=13){const part=r.u8(),target=part===255?null:readArgs(['NetEntityID'],r)[0];readArgs(['Vector3'],r);
     if(target?.p1===0){const v=charOf(target.viewId),dmg=(d.damageMin??28)+Math.random()*((d.damageMax??30)-(d.damageMin??28));if(v&&v!==peer)hurtPlayer(v,dmg,1,peer,{bleed:1});const a=animals.get(target.viewId);if(a)hurtAnimal(peer,a,dmg);}}
    return;}
  }
 }
 // ---- context (Context:A query, B quick, C menu option, D cancel; replies E menu, H/I immediate, J/K selection) --------
 const reply=(peer,letter,types=[],values=[])=>peer.rpc(998,'Context:'+letter,types,values);
 const DOOR={open:{name:1,text:'Open Door'},close:{name:2,text:'Close Door'},change:{name:3,text:'Change Lock'},unlock:{name:4,text:'Unlock'},lock:{name:5,text:'Lock'},code:{name:6,text:'Enter Code'}};
 const FIRE={ignite:{name:0,text:'Ignite'},extinguish:{name:1,text:'Extinguish'},open:{name:2,text:'Open'}};
 const hasFuel=ent=>ent.slots.some(s=>s?.name==='Wood');
 function menuFor(peer,ent){
  if(ent.kind==='door'){const owner=ent.owner===peer.user,unlocked=ent.access.has(peer.user)||owner,can=owner||unlocked||!ent.lockActive,out=[];
   if(can)out.push(ent.open?DOOR.close:DOOR.open);if(!unlocked)out.push(DOOR.code);if(owner)out.push(ent.lockActive?DOOR.unlock:DOOR.lock);if(owner)out.push(DOOR.change);return out;}
  if(ent.kind==='fire'){if(ent.looter!=null)return [];const out=[];if(ent.lit)out.push(FIRE.extinguish);else if(hasFuel(ent))out.push(FIRE.ignite);out.push(FIRE.open);return out;}
  return null; // quick only (boxes, sacks)
 }
 function toggleDoor(peer,ent){
  if(!(ent.owner===peer.user||!ent.lockActive||ent.access.has(peer.user))){popup(peer,'The door is locked!','');return false;}
  ent.open=!ent.open;callAll(ent,'DOo',[ent.open?1:0,BigInt(Date.now())]);return true;
 }
 // LootableObject.ContextRespond_OpenLoot: a locked LockableObject refuses (FailBreak -> Context:H) after
 // Notice.Popup(icon , GetLockedStringForPopup, 5 s); TimedLockable says "Locked for a while...".
 const timedLocked=(peer,ent)=>Boolean(ent.timedLock&&Date.now()<ent.timedLock.until&&peer.user!==ent.timedLock.owner);
 function openLoot(peer,ent){if(timedLocked(peer,ent)){popup(peer,'Locked for a while...','',5);return false;}if(ent.looter!=null&&ent.looter!==peer.playerId)return false;ent.looter=peer.playerId;peer.looting=ent;callAll(ent,'SetLooter',[peer.playerId]);gnupEntity(peer,ent);return true;}
 function stopLoot(peer,ent){if(ent.looter!==peer.playerId)return;ent.looter=null;if(peer.looting===ent)peer.looting=null;callAll(ent,'ClearLooter',[]);}
 function setFire(ent,on){if(on&&!hasFuel(ent))on=false;if(Boolean(ent.lit)===on)return;ent.lit=on;clearInterval(ent.timer);if(on)ent.timer=setInterval(()=>burn(ent),FIRE_TICK_MS);callAll(ent,'ReceiveNetState',[on]);}
 // FireBarrel.ConsumeFuel: one Wood, a Charcoal by-product (slot 7), raw slots 3-5 cooked into 0-2.
 function burn(ent){
  if(!ents.has(ent.innerID)){clearInterval(ent.timer);return;}
  const fuel=ent.slots.findIndex(s=>s?.name==='Wood');if(fuel<0)return setFire(ent,false);
  ent.slots[fuel].uses-=1;if(!ent.slots[fuel].uses)ent.slots[fuel]=null;
  const c=ent.slots[7];if(!c)ent.slots[7]={name:'Charcoal',uses:1};else if(c.name==='Charcoal')c.uses=Math.min(250,c.uses+1);
  for(let i=3;i<6;i++){const s=ent.slots[i],out=s&&COOKS[s.name];if(!out)continue;s.uses-=1;if(!s.uses)ent.slots[i]=null;const o=ent.slots[i-3];if(!o)ent.slots[i-3]={name:out,uses:1};else if(o.name===out)o.uses+=1;}
  const looter=peers().find(p=>p.playerId===ent.looter);if(looter)gnupEntity(looter,ent);
  if(!hasFuel(ent))setFire(ent,false);
 }
 // ---- map crates and scene doors (classic views) ---------------------------------------------------------------------
 // A LootableObjectSpawner crate (NetCull.InstantiateStatic: a classic view named after its prefab) placed next to the
 // first character that moves, refilled once emptied; LootableObject SetLooter/ClearLooter and Inventory GNUP/ITMV on
 // its view, as on the original. Scene doors: Context:A toggles (BasicDoor has no menu), DOo to everyone.
 let crate=null;const doorOpen=new Map(sceneDoors.filter(Number.isInteger).map(id=>[id,false]));
 const crateCreate=()=>({viewId:CRATE_VIEW,prefab:'BoxLoot',position:crate.position,rotation:[0,0,0,1]});
 function placeCrate(origin){crate={position:[origin[0]+3,origin[1],origin[2]+3],slots:Array(CRATE_SLOTS).fill(null),looter:null};CRATE_LOOT.forEach((s,i)=>{crate.slots[i]={...s};});for(const p of all())p.create(crateCreate());}
 const gnupCrate=peer=>peer.rpc(CRATE_VIEW,'GNUP',['byte[]'],[inventoryBytes(crate.slots,{capacity:crate.slots.length})]);
 function openCrate(peer){if(crate.looter!=null&&crate.looter!==peer.playerId)return false;crate.looter=peer.playerId;for(const p of all())p.rpc(CRATE_VIEW,'SetLooter',['uLink.NetworkPlayer'],[peer.playerId]);gnupCrate(peer);return true;}
 function closeCrate(peer){if(!crate||crate.looter!==peer.playerId)return;crate.looter=null;for(const p of all())p.rpc(CRATE_VIEW,'ClearLooter',[],[]);if(!crate.slots.some(Boolean))CRATE_LOOT.forEach((s,i)=>{crate.slots[i]={...s};});}
 function crateMove(peer,[to,fromSlot,toSlot]){if(crate?.looter!==peer.playerId||to?.p1!==0||to.viewId!==peer.character)return;if(moveBetween(crate.slots,fromSlot,peer.slots,toSlot)){peer.gnup();gnupCrate(peer);}}
 function toggleSceneDoor(viewId){const open=!doorOpen.get(viewId);doorOpen.set(viewId,open);for(const p of all())p.rpc(viewId,'DOo',['sbyte','ulong'],[open?1:0,BigInt(Date.now())]);return true;}
 function contextQuery(peer,target){
  if(target?.p1===0){peer.ctx=null;if(crate&&target.viewId===CRATE_VIEW)return reply(peer,openCrate(peer)?'I':'H');if(doorOpen.has(target.viewId))return reply(peer,toggleSceneDoor(target.viewId)?'I':'H');return reply(peer,'G');}
  peer.ctx=null;const ent=target?.p1===CARRIER_GROUP?ents.get(target.p2):null;if(!ent)return reply(peer,'G');
  if(ent.kind==='door'){peer.lastDoor=ent;}
  const menu=menuFor(peer,ent);
  if(menu==null){const ok=ent.slots?openLoot(peer,ent):false;return reply(peer,ok?'I':'H');}
  if(!menu.length)return reply(peer,'F');
  peer.ctx={ent,menu};reply(peer,'E',['ContextMenuData'],[menu]);
 }
 function contextQuick(peer){const c=peer.ctx;peer.ctx=null;if(!c)return reply(peer,'G');let ok=false;
  if(c.ent.kind==='door')ok=toggleDoor(peer,c.ent);else if(c.ent.kind==='fire'){if(c.ent.lit){setFire(c.ent,false);ok=true;}else if(hasFuel(c.ent)){setFire(c.ent,true);ok=c.ent.lit;}else ok=openLoot(peer,c.ent);}
  reply(peer,ok?'K':'J');}
 function contextOption(peer,option){const c=peer.ctx;peer.ctx=null;if(!c||!c.menu.some(m=>m.name===option))return reply(peer,'L');const e=c.ent;let ok=true;
  if(e.kind==='door'){
   if(option===1||option===2)ok=(option===1)!==e.open&&toggleDoor(peer,e);
   else if(option===4||option===5){e.lockActive=option===5;popup(peer,'Door is now '+(e.lockActive?'locked.':'unlocked'),e.lockActive?'':'');}
   else if(option===3)peer.rpc(997,'CL_ConsoleCommand',['string'],['lockentry.show true']);
   else if(option===6)peer.rpc(997,'CL_ConsoleCommand',['string'],['lockentry.show false']);}
  else if(e.kind==='fire'){if(option===2)ok=openLoot(peer,e);else{setFire(e,option===0);ok=Boolean(e.lit)===(option===0);}}
  reply(peer,ok?'I':'H');}
 // lockentry.passwordentry <4 digits> <change>: the door the player last used stands in for the eye raycast.
 function passwordEntry(peer,code,change){
  const door=peer.lastDoor;if(!door||!ents.has(door.innerID)||!/^\d{4}$/.test(code))return;
  if(change){if(door.owner===peer.user){door.code=code;door.access=new Set();popup(peer,'Password is now : '+code,'');}return;}
  if(door.code&&code===door.code){door.access.add(peer.user);popup(peer,'You can now access this door!','');}else popup(peer,'Incorrect password.','');
 }
 // ---- inventory moves between the player and an open container ----------------------------------------------------
 function moveBetween(fromSlots,fromSlot,toSlots,toSlot){const a=fromSlots[fromSlot];if(!a)return false;const c=toSlots[toSlot];
  if(!c){toSlots[toSlot]=a;fromSlots[fromSlot]=null;return true;}
  if(c.name===a.name&&splittable(a.name)){const k=Math.min(a.uses,maxUses(a.name)-c.uses);c.uses+=k;a.uses-=k;if(!a.uses)fromSlots[fromSlot]=null;return k>0;}
  toSlots[toSlot]=a;fromSlots[fromSlot]=c;return true;}
 function playerMoveTo(peer,[target,fromSlot,toSlot]){
  const ent=target?.p1===CARRIER_GROUP?ents.get(target.p2):null;if(!ent?.slots||ent.looter!==peer.playerId)return false;
  if(moveBetween(peer.slots,fromSlot,ent.slots,toSlot)){if(peer.held?.slot===fromSlot&&!peer.slots[fromSlot])dropHeld(peer);peer.gnup();gnupEntity(peer,ent);if(ent.kind==='fire'&&!hasFuel(ent))setFire(ent,false);return true;}
  return false;}
 function entityCall(peer,b){
  const c=readNgcCall(readArgs(['byte[]'],b)[0]),ent=ents.get(c.innerID),m=ent?.prefab.messages[c.messageID];if(!m)return;
  const args=readArgs(m.params,new BitReader(c.args));
  if(m.name==='StopLooting')return stopLoot(peer,ent);
  if(ent.looter!==peer.playerId)return;
  if(m.name==='TakeAll'){for(let i=0;i<ent.slots.length;i++)if(ent.slots[i]){const left=addItem(peer.slots,ent.slots[i].name,ent.slots[i].uses);if(left)ent.slots[i].uses=left;else ent.slots[i]=null;}peer.gnup();gnupEntity(peer,ent);if(ent.kind==='sack'&&!ent.slots.some(Boolean))destroyEntity(ent);return;}
  if(m.name==='ITMV'){const [to,from,toSlot]=args;if(to.p1===0&&to.viewId===peer.character&&moveBetween(ent.slots,from,peer.slots,toSlot)){peer.gnup();gnupEntity(peer,ent);}return;}
  if(m.name==='ISMV'||m.name==='ITSM'){const [from,to]=args;if(moveBetween(ent.slots,from,ent.slots,to))gnupEntity(peer,ent);return;}
 }
 // ---- animals ------------------------------------------------------------------------------------------------------
 function spawnAnimal(at){const viewId=nextView(),a={viewId,prefab:':chicken_prefab',position:[...at],health:30,dead:false,harvest:3};animals.set(viewId,a);for(const p of all())showAnimal(p,a);return a;}
 function showAnimal(p,a){p.create({viewId:a.viewId,prefab:a.prefab,position:a.position});p.rpc(a.viewId,'GetNetworkUpdate',['Vector3','Angle2'],[a.position,{pitch:0,yaw:0}]);if(a.dead)p.rpc(a.viewId,'ClientDeath',['Vector3','uLink.NetworkViewID'],[a.position,0]);}
 function hurtAnimal(peer,a,dmg){
  if(a.dead){if(a.harvest>0){a.harvest--;addItem(peer.slots,'Raw Chicken Breast',1);inventoryNotice(peer,'1 x Raw Chicken Breast');peer.gnup();}return;}
  a.health=Math.max(0,a.health-dmg);for(const p of all())p.rpc(a.viewId,'ClientHealthChange',['float'],[a.health]);
  if(!a.health){a.dead=true;for(const p of all())p.rpc(a.viewId,'ClientDeath',['Vector3','uLink.NetworkViewID'],[a.position,peer.character??0]);}
 }
 // ---- falls (FallDamage.fIm -> ValidateFallVelocity / FallImpact) ---------------------------------------------------
 function fall(peer,[velocity]){
  const speed=Math.abs(velocity?.[1]??0);if(speed<24||peer.character==null)return;
  for(const p of all())if(p!==peer&&p.character!=null&&sees(p,peer))p.rpc(peer.character,'fIc',['float'],[speed]);
  const fraction=(speed-24)/14,frac=peer.health/100;
  if(fraction>0.25){peer.bleed=(peer.bleed??0)+3+(fraction-0.25)*10;peer.rpc(peer.character,'Local_BleedChange',['float'],[peer.bleed]);}
  if(fraction>0.35||Math.floor(Math.random()*3)===0||frac<0.5){for(const p of all())if(p.character!=null&&(p===peer||sees(p,peer)))p.rpc(peer.character,'fIo',['float'],[1]);}
  peer.health=Math.max(0,peer.health-(10+fraction*100));peer.rpc(peer.character,'Local_HealthChange',['float','uLink.NetworkViewID'],[peer.health,peer.character]);
  if(!peer.health)kill(peer,null);
 }

 return {
  CARRIER,
  setInventoryEncoder(f){inventoryBytes=f;},
  addItem,countItem,takeItem,
  // A peer the referee attached: the NGC carrier and everything already in the world.
  attach(peer){
   peer.attachedWorld=true;peer.known=new Set(defaults);peer.health=100;
   peer.dropHeld=()=>dropHeld(peer);
   peer.create({viewId:CARRIER,prefab:'!Ng',group:CARRIER_GROUP});
   for(const m of masters.values())peer.create({viewId:m.viewId,prefab:'StructureMasterPrefab',position:m.position,rotation:m.rotation});
   for(const ent of ents.values()){createFor(peer,ent);stateFor(peer,ent);}
   for(const a of animals.values())showAnimal(peer,a);
   if(crate)peer.create(crateCreate());
   for(const [id,open] of doorOpen)if(open)peer.rpc(id,'DOc',['sbyte'],[1]);
   // Other characters arrive when this player's own character subscribes it to their cells (spawned -> subscribe).
  },
  // The group a character spawned at `position` is instantiated in (NetCull.FindGroupID -> CullGrid.WorldGroupID).
  cullGroup,
  // After the referee spawned a character: players subscribed to its cell see it, its owner is subscribed to the cells
  // around it (and hears the characters there), gets its blueprints and an animal to hunt.
  spawned(peer,position){
   peer.health=100;peer.bleed=0;peer.dead=false;peer.held=null;peer.craft=null;
   peer.spawnedAt=[...position];peer.charGroup=cullGroup(position);
   for(const o of peers())if(o!==peer&&o.attachedWorld&&sees(o,peer))o.create(characterCreate(peer));
   subscribe(peer,peer.charGroup);
   sendBlueprints(peer);sendArmour(peer);peer.animalCheck=0;
  },
  // RequestRespawn(campRequest): RustServerManagement.GetCampSpawnForPlayer, the newest bag of this user.
  campSpawn(peer){const bag=[...ents.values()].filter(e=>e.kind==='bag'&&e.owner===peer.user).at(-1);return bag?[bag.position[0],bag.position[1]+0.3,bag.position[2]]:null;},
  // Remote players move: HumanController.ReadClientMove to everyone else.
  moved(peer,[origin,angles,flags]){
   if(peer.character!=null)recull(peer,origin);
   if(!crate&&peer.character!=null)placeCrate(origin);
   // An animal to hunt near every new character, placed at its first reported feet height (the mock has no terrain).
   // (re-checked every 10 s, like GenericSpawner refilling an area the player is in).
   if(!(peer.animalCheck>Date.now())){peer.animalCheck=Date.now()+10000;if(![...animals.values()].some(a=>!a.dead&&Math.hypot(a.position[0]-origin[0],a.position[2]-origin[2])<80)){const near=[...ents.values()].filter(e=>e.kind==='structure').map(e=>({e,d:Math.hypot(e.position[0]-origin[0],e.position[2]-origin[2])})).sort((x,y)=>x.d-y.d)[0];
    // Away from the nearest building (the mock has no navmesh to keep it out of one).
    const dx=near&&near.d<20?origin[0]-near.e.position[0]:-3,dz=near&&near.d<20?origin[2]-near.e.position[2]:-1.5,l=Math.hypot(dx,dz)||1;spawnAnimal([origin[0]+dx/l*4,origin[1],origin[2]+dz/l*4]);}}
   for(const o of peers())if(o!==peer&&o.attachedWorld&&peer.character!=null&&sees(o,peer))try{o.rpc(peer.character,'ReadClientMove',['Vector3','int','ushort','float'],[origin,angles,flags,0]);}catch{}},
  slotsChanged(peer,slots){if(slots.some(i=>i>=36))sendArmour(peer);},
  passwordEntry,
  teleport(peer,position){peer.rpc(1,'UnstickMove',['Vector3'],[position]);peer.last=[...position];},
  // Returns true when the message was the world's.
  handle(peer,h,b){
   switch(h.rpc){
    case 'DoBeltUse':useBelt(peer,readArgs(['int'],b)[0]);return true;
    case 'CRFS':{const [amount,uid]=readArgs(['int','int'],b);craftStart(peer,amount,uid);return true;}
    case 'CRFX':craftCancel(peer);return true;
    case 'IACT':{const [slot,option]=readArgs(['byte','byte'],b);menuAction(peer,slot,option);return true;}
    case 'ITMV':if(h.viewId===peer.character){playerMoveTo(peer,readArgs(['NetEntityID','byte','byte'],b));return true;}if(h.viewId===CRATE_VIEW){crateMove(peer,readArgs(['NetEntityID','byte','byte'],b));return true;}return false;
    case 'StopLooting':if(h.viewId===CRATE_VIEW){closeCrate(peer);return true;}return false;
    case 'TakeAll':if(h.viewId===CRATE_VIEW&&crate?.looter===peer.playerId){for(let i=0;i<crate.slots.length;i++)if(crate.slots[i]){const left=addItem(peer.slots,crate.slots[i].name,crate.slots[i].uses);if(left)crate.slots[i].uses=left;else crate.slots[i]=null;}peer.gnup();gnupCrate(peer);return true;}return false;
    case 'Context:A':contextQuery(peer,readArgs(['NetEntityID'],b)[0]);return true;
    case 'Context:B':contextQuick(peer);return true;
    case 'Context:C':contextOption(peer,readArgs(['int'],b)[0]);return true;
    case 'Context:D':peer.ctx=null;reply(peer,'F');return true;
    case 'fIm':fall(peer,readArgs(['Vector3'],b));return true;
    case 'C':if(h.viewId===CARRIER){entityCall(peer,b);return true;}return false;
    case 'Action1':case 'Action1B':case 'Action2':case 'Action2B':case 'Action3':case 'Action3B':itemAction(peer,h,b);return true;
   }
   return false;
  },
  // Inventory changes the referee makes (moves inside the player's inventory) can unequip the held item.
  checkHeld(peer){if(peer.held&&peer.slots[peer.held.slot]?.name!==peer.held.name)dropHeld(peer);},
  killed:kill,
  stop(){for(const e of ents.values())clearInterval(e.timer);for(const p of peers())clearTimeout(p.craft?.timer);},
 };
}
