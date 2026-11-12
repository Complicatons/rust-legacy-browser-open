// Gameplay rows of the native matrix (SERVER-TESTING-PLAN.md section 6) that need items, a second player or a place
// in the world: gathering, crafting, building, doors, deployables, raiding, combat, wildlife, falls and network faults.
// Every row drives the game like a player (keys, mouse, RPOS cells, the E context key) through tools/native/driver.mjs
// and judges the server's replies in the gateway frame log (GNUP, creates, NGC creates/calls, RPCs, notices).
// Items: an admin run gives them with inv.give; without admin rights a few rows get by like a fresh player (Rock on
// terrain trees for Wood, crafting from it). A second browser player ("target") is the other side of combat and doors.
import {readFileSync} from 'node:fs';
import {inventoryCells,countOf,openInventory,closeInventory,dragCell,cellSelector,lootSelector,lootCells,lootOpen,lockPointer,feet,toUnity,distXZ,
 aimAt,click,walkTo,useKey,hold,shapeNet,say,sleepMs as sleep} from './driver.mjs';
import {consoleCommand as isConsoleCommand} from './lib.mjs';
import {walkToMeet} from './walk-meet.mjs';

const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const named=name=>new RegExp('^'+esc(name)+'$');
const b64=v=>typeof v==='string'?v:v?.base64??null;
const round=(v,n=2)=>v==null?v:+Number(v).toFixed(n);
const round3=p=>Array.isArray(p)?p.map(v=>round(v)):p;
// The recovered item catalogue (blueprint keys, unique IDs); the harness host has the private asset overlay.
let catalogue;
export function loadCatalogue(){if(catalogue===undefined){try{catalogue=JSON.parse(readFileSync(new URL('../../browser/assets/recovered/items/manifest.json',import.meta.url),'utf8'));}catch{catalogue=null;}}return catalogue;}
// PlayerInventory.SendBoundBPs: int32 count, then count x int32 blueprint uniqueID.
export function decodeBoundBlueprints(value){const s=b64(value);if(!s)return null;const b=Buffer.from(s,'base64');if(b.length<4)return null;const n=b.readInt32LE(0);if(n<0||b.length!==4+4*n)return null;return Array.from({length:n},(_,i)=>b.readInt32LE(4+4*i));}
// EquipmentWearer.ArmorData: six floats (DamageTypeList order: generic, bullet, melee, explosion, radiation, cold).
export function decodeArmorData(value){const s=b64(value);if(!s)return null;const b=Buffer.from(s,'base64');if(b.length!==24)return null;return Array.from({length:6},(_,i)=>round(b.readFloatLE(i*4)));}
// Master-local structure grid (StructureMaster: 2.5 m x 4 m cells) to Unity world, from the foundation's NGC create.
export function structureWorld(foundation,[lx,ly,lz]){const y=(foundation.euler?.[1]??0)*Math.PI/180,c=Math.cos(y),s=Math.sin(y),p=foundation.position;return [p[0]+lx*c+lz*s,p[1]+ly,p[2]-lx*s+lz*c];}
const browserOf=([x,y,z])=>[x,y,-z];

export function createGameplayRows(h){
 const {ctx,cfg,pass,fail,skip}=h;
 const consoleCommand=(s,text,o)=>h.consoleCommand(s,text,o);
 const me=()=>ctx.session;
 // ---- frames --------------------------------------------------------------------------------------------------------
 const rpcOn=(s,name)=>f=>f.dir==='rx'&&f.type==='rpc'&&f.name===name&&f.viewId===s.frames.characterView;
 const waitRx=(s,t,pred,ms=cfg.replyMs)=>s.frames.waitFor(t,f=>f.dir==='rx'&&pred(f),ms);
 const waitTx=(s,t,pred,ms=cfg.replyMs)=>s.frames.waitFor(t,f=>f.dir==='tx'&&pred(f),ms);
 const gnup=(s,t,ms)=>waitRx(s,t,rpcOn(s,'GNUP'),ms);
 const notices=(s,t)=>s.frames.rx(t,f=>isConsoleCommand(f)&&/^notice\./.test(f.values[0])).map(f=>f.values[0]);
 const popup=(s,t,re,ms=cfg.replyMs)=>waitRx(s,t,f=>isConsoleCommand(f)&&/^notice\.popup/.test(f.values[0])&&re.test(f.values[0]),ms);
 const ngcCreates=(s,t,re)=>s.frames.rx(t,f=>f.type==='ngc-create'&&re.test(f.prefab??''));
 const ngcKey=f=>f.carrier+':'+f.innerID;
 const health=s=>s.frames.rx(0,rpcOn(s,'Local_HealthChange')).at(-1)?.values?.[0]??null;
 // Our page's drawn copy of another player (explorerDev.onlinePlayers: position, held item, pose, attack event).
 const remoteView=id=>me().page.evaluate(v=>window.explorerDev.onlinePlayers().find(p=>p.id===v)??null,id);
 const token=()=>'native-'+Math.random().toString(36).slice(2,8);
 // ---- inventory ----------------------------------------------------------------------------------------------------
 const count=async(s,name)=>countOf(await inventoryCells(s.page),named(name));
 async function give(s,name,n){
  const before=await count(s,name),t=Date.now()-1,c=await consoleCommand(s,`inv.give "${name}" ${n}`,{ms:cfg.replyMs});
  await gnup(s,t);await sleep(400);const after=await count(s,name);
  return after>before?null:`inv.give "${name}" ${n} added nothing (${c.text?.trim()??'no reply'})`;
 }
 // Items for a row: present already, given (admin) or, for Wood with `survival`, gathered from trees.
 // Returns null when everything is there, else {skip} (no way to get it) or {fail} (the server refused).
 async function supply(s,items,{survival=false}={}){
  for(const [name,n]of items){
   const have=await count(s,name);if(have>=n)continue;
   if(await h.ensureAdmin(s)){const e=await give(s,name,n-have);if(e)return {fail:e};continue;}
   if(survival&&name==='Wood'){if(!await has(s,'trees'))return {skip:OLD_BUILD('trees')};const g=await gatherWood(s,n);if(g.have>=n)continue;return {fail:`gathered only ${g.have}/${n} Wood from ${g.trees} trees`,evidence:g};}
   return {skip:`needs admin rights to give ${name} (inv.give): ${h.adminWhy(s)}`};
  }
  return null;
 }
 const unmet=(x,ev={})=>x.skip?skip(x.skip,ev):fail(x.fail,{...ev,...x.evidence});
 // Read-only page helpers added with these rows (explorerDev.trees, useTarget, cliff, buildZones, onlineObject): a server
 // still serving an older game build lacks them, and the rows that need one skip instead of failing.
 const has=(s,name)=>s.page.evaluate(n=>typeof window.explorerDev?.[n]==='function',name).catch(()=>false);
 const OLD_BUILD=name=>`the game build this server serves predates explorerDev.${name} (deploy the current build)`;
 // The newest held-item state of our character: IAST(slot, item representation view) or ITDE (holstered).
 const heldNow=s=>{const f=s.frames.rx(0,x=>x.type==='rpc'&&(x.name==='IAST'||x.name==='ITDE')&&x.viewId===s.frames.characterView).at(-1);return f?.name==='IAST'?{slot:f.values?.[0],rep:f.values?.[1]}:null;};
 // Puts the named item on the belt (dragging it from the bag) and selects it with its number key; waits for IAST.
 async function equip(s,name,{needRep=true}={}){
  let cells=await inventoryCells(s.page),cell=cells.find(c=>c.name===name);if(!cell)return null;
  if(cell.slot<30||cell.slot>35){
   const used=new Set(cells.map(c=>c.slot));let free=[30,31,32,33,34,35].find(i=>!used.has(i));
   if(!await openInventory(s.page))return null;
   if(free==null){const bag=[...Array(30).keys()].find(i=>!used.has(i));if(bag==null){await closeInventory(s.page);return null;}const t=Date.now();await dragCell(s.page,cellSelector(35),cellSelector(bag));await gnup(s,t);await sleep(300);free=35;}
   const t=Date.now();await dragCell(s.page,cellSelector(cell.slot),cellSelector(free));await gnup(s,t);await closeInventory(s.page);await sleep(300);
   cell=(await inventoryCells(s.page)).find(c=>c.name===name);if(!cell||cell.slot<30||cell.slot>35)return null;
  }
  const now=heldNow(s);if(now&&now.slot===cell.slot)return {...now,slot:cell.slot};
  await lockPointer(s.page);const t=Date.now();await s.page.keyboard.press('Digit'+(cell.slot-29));
  if(!needRep){await sleep(500);return {slot:cell.slot,rep:null};}
  const iast=await waitRx(s,t,f=>f.type==='rpc'&&f.name==='IAST'&&f.viewId===s.frames.characterView&&f.values?.[0]===cell.slot);
  await sleep(700);return iast?{slot:cell.slot,rep:iast.values[1]}:null;
 }
 // Moves a stack between our inventory cells and an open loot window (RPOS drag), waiting for the server's GNUPs.
 async function dragToLoot(s,fromSlot,toLoot){const t=Date.now();await dragCell(s.page,cellSelector(fromSlot),lootSelector(toLoot));await waitRx(s,t,f=>f.type==='ngc-call'&&f.name==='GNUP'||rpcOn(s,'GNUP')(f),cfg.replyMs);await sleep(500);}
 // The loot window has no Take all (TakeAllButton inactive, LootableObject.TakeAll empty): drag a loot cell to the first
 // free bag cell (ITMV), waiting for the server's GNUPs. Returns false when the bag is full.
 async function takeFromLoot(s,lootSlot){const used=new Set((await inventoryCells(s.page)).map(c=>c.slot)),bag=[...Array(30).keys()].find(i=>!used.has(i));if(bag==null)return false;
  const t=Date.now();await dragCell(s.page,lootSelector(lootSlot),cellSelector(bag));await waitRx(s,t,f=>f.type==='ngc-call'&&f.name==='GNUP'||rpcOn(s,'GNUP')(f),cfg.replyMs);await sleep(500);return true;}
 // ---- gathering ----------------------------------------------------------------------------------------------------
 // MeleeWeaponDataBlock.DoAction1: a swing that hits a terrain tree (hit flag) adds efficiencies[StaticTree] Wood.
 async function gatherWood(s,n,{ms=cfg.gatherMs??240000}={}){
  const end=Date.now()+ms,tried=new Set(),tool=['Hatchet','Stone Hatchet','Rock'];let have=await count(s,'Wood'),swings=0,trees=0;
  let names=(await inventoryCells(s.page)).map(c=>c.name),held=tool.find(t=>names.includes(t));
  // A character kept from earlier runs may have lost its Rock (Azure VM, 2026-10-24: "no tool"): respawn like a player,
  // which starts with one.
  if(!held){const back=await respawn(s,'suicide');if(back.spawned){names=(await inventoryCells(s.page)).map(c=>c.name);held=tool.find(t=>names.includes(t));have=await count(s,'Wood');}}
  if(!held||!await equip(s,held))return {have,trees,swings,why:'no tool'};
  while(have<n&&Date.now()<end){
   const tree=(await s.page.evaluate(()=>window.explorerDev.trees(90))).find(t=>!tried.has(t.position.join()));if(!tree)break;tried.add(tree.position.join());
   const p=tree.position,w=await walkTo(s.page,p,{within:1.2,ms:Math.min(25000,end-Date.now())});if(w.distance>2.4)continue; // blocked: next tree
   let ok=false;
   for(let step=0;step<3&&!ok;step++){for(const dy of [1.3,1.0,1.6,0.7]){await aimAt(s.page,[p[0],(await feet(s.page))[1]+dy,p[2]]);await sleep(120);if((await s.page.evaluate(()=>window.explorerDev.aim(1.5))).hit?.tree){ok=true;break;}}if(!ok)await hold(s.page,['KeyW'],150);}
   if(!ok)continue;trees++;
   for(let idle=0;have<n&&idle<4&&Date.now()<end;){const before=have;await click(s.page);swings++;await sleep(2100);have=await count(s,'Wood');idle=have>before?0:idle+1;}
  }
  return {have,trees,swings};
 }
 // ---- a second player ----------------------------------------------------------------------------------------------
 // The target in game next to us (within 2.5 m, facing us), cheapest first:
 //  1. admin: teleport.toplayer (RustServerManagement teleport, UnstickMove); cfg.meetTeleport:false leaves it out;
 //  2. respawns like a player while the target is beyond cfg.meetWalkMax (150 m), at most cfg.meetRespawns (3) times:
 //     a lucky spawn point saves a long walk (the target only carries the starting kit);
 //  3. walk-to-meet (tools/native/walk-meet.mjs): the target walks to us along the island navmesh, re-planning when
 //     stuck or when we are no longer where its path ends; cfg.meetMs caps it (default from the path length).
 // The row's evidence gets `meet` (how, distances, the walk's re-plans/stuck count/progress) whatever the outcome.
 async function meet(r,{fresh=false}={}){
  const tg=await h.targetPlayer();if(!tg)return {skip:h.targetWhy()};
  if(fresh&&(health(tg.session)??100)<90){const back=await respawn(tg.session,'suicide');if(!back.spawned)return {fail:'the target could not respawn at full health: '+back.why,evidence:back};}
  // A target left dead by an earlier row (a failed meet, a fall) respawns like a player before this row.
  if(!tg.session.frames.characterView){const back=await respawn(tg.session,null);if(!back.spawned)return {fail:'the target has no character and could not respawn: '+back.why};}
  const apart=async()=>round(distXZ(await feet(me().page),await feet(tg.session.page)));
  const ev={how:'close',startDistance:await apart(),respawns:[]};if(r?.evidence)r.evidence.meet=ev;
  const steps=[];
  if(ev.startDistance>2.5){
   if(cfg.meetTeleport!==false&&await h.ensureAdmin(me())){const t=Date.now()-1;steps.push('teleport');await consoleCommand(me(),`teleport.toplayer "${tg.me.name}" "${ctx.me.name}"`,{ms:cfg.replyMs});await waitRx(tg.session,t,f=>f.type==='rpc'&&f.name==='UnstickMove',cfg.replyMs);await sleep(1500);}
   for(let i=0;i<(cfg.meetRespawns??3)&&await apart()>(cfg.meetWalkMax??150);i++){
    const back=await respawn(tg.session,'suicide');if(!back.spawned)break;ev.respawns.push(await apart());}
   if(ev.respawns.length)steps.push('respawn '+ev.respawns.join('/')+' m');
   // A target that dies on the way (wildlife, a fall: walk-meet stops at once with the death reason) respawns like a
   // player and walks again from its new spawn, at most cfg.meetDeaths (1) times.
   for(let deaths=0;await apart()>2.5;deaths++){steps.push('walk');
    const w=await walkToMeet(tg.session.page,()=>feet(me().page),{within:2.2,ms:cfg.meetMs??null,log:cfg.meetLog?console.log:undefined});
    const walk={from:w.startDistance,left:w.distanceLeft,seconds:Math.round(w.ms/1000),replans:w.replans,stuck:w.stuck,samePath:w.samePath,path:w.path&&{length:w.path.length,straight:w.path.straight,maxSlope:w.path.profile.maxSlope},progress:w.progress,why:w.why,died:w.died,hurt:w.hurt.length?w.hurt:undefined,truth:w.truth,blocks:w.blocks.length?w.blocks:undefined,detours:w.detours.length?w.detours:undefined,plans:w.plans,final:w.final};
    if(ev.walk)(ev.earlierWalks??=[]).push(ev.walk);ev.walk=walk;ev.how=steps.join(', then ');
    if(w.arrived)break;
    if(w.died&&deaths<(cfg.meetDeaths??1)){const back=await respawn(tg.session,null);if(back.spawned){steps.push('respawn after death '+await apart()+' m');continue;}}
    return {fail:`walk-to-meet failed: ${w.why} (target ${w.startDistance} m away, ${w.distanceLeft??'?'} m left after ${Math.round(w.ms/1000)} s, ${w.replans} re-plans, ${w.stuck} stuck)`,evidence:{meet:ev}};}
   ev.how=steps.join(', then ')||'close';
  }
  const p=await feet(me().page),q=await feet(tg.session.page);
  await aimAt(tg.session.page,[p[0],p[1]+1.5,p[2]]);await aimAt(me().page,[q[0],q[1]+1.2,q[2]]);
  ev.distance=round(distXZ(p,q));
  return {tg,how:ev.how,distance:ev.distance,meet:ev};
 }
 // Death and back in game: 'suicide' (console) or an earlier death; clicks Respawn (or At camp).
 async function respawn(s,cause,{camp=false}={}){
  const t=Date.now()-1,old=s.frames.characterView;
  if(cause==='suicide')await consoleCommand(s,'suicide',{ms:cfg.replyMs});
  if(!await s.page.waitForSelector('#death:not([hidden])',{timeout:cfg.replyMs}).then(()=>true,()=>false))return {why:'no death screen',killed:s.frames.rx(t,x=>x.type==='rpc'&&/^Client_OnKilled|Local_HealthChange/.test(x.name??'')).map(x=>x.name)};
  const button=camp?'#respawn-camp':'#respawn';
  await s.page.waitForFunction(b=>{const e=document.querySelector(b);return e&&!e.disabled&&e.offsetParent!==null;},button,{timeout:20000}).catch(()=>{});
  const tr=Date.now();await s.page.locator(button).click();
  const req=await waitTx(s,tr,f=>f.type==='rpc'&&f.name==='RequestRespawn',5000);
  const spawned=await waitRx(s,tr,f=>f.type==='create'&&f.mine&&f.prefab===':player_soldier'&&f.viewId!==old,cfg.replyMs*2);
  if(!spawned)return {why:req?'RequestRespawn sent but no new character':'the respawn button sent nothing',request:req?.values??null};
  await s.page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&document.querySelector('#death')?.hidden,{},{timeout:cfg.replyMs*2}).catch(()=>{});
  await lockPointer(s.page);await sleep(800);return {request:req?.values??null,spawned,deathAt:t};
 }
 // ---- placing ------------------------------------------------------------------------------------------------------
 const placement=s=>s.page.evaluate(()=>window.explorerDev.placement());
 // Aims at each candidate (browser space) until the client preview is valid (and, with `expect`, snaps within 0.7 m
 // of it; previews are in Unity space like the structure maths), then clicks once like Fire and waits for the server's
 // NGC create matching `prefab`.
 // A click that sent nothing: what the page has at the screen centre (the harness clicks there) and the pointer lock.
 const underCursor=page=>page.evaluate(()=>{const e=document.elementFromPoint(innerWidth/2,innerHeight/2),m=window.explorerDev?.inputState?.();
  return {locked:document.pointerLockElement?.id??null,element:e?e.id||e.tagName.toLowerCase():null,input:m??null,events:window.__clickLog?.slice(-8)??null};});
 async function place(s,{prefab,candidates,expect=null,ms=cfg.replyMs}){
  let valid=0,elsewhere=null,refused=0;
  for(const c of candidates){
   await aimAt(s.page,c);await sleep(250);const pl=await placement(s);
   if(!pl?.valid)continue;valid++;if(expect&&Math.hypot(...pl.position.map((v,i)=>v-expect[i]))>0.7){elsewhere=round3(pl.position);continue;}
   await s.page.evaluate(()=>{if(window.__clickLog)return;window.__clickLog=[];for(const type of ['pointerdown','pointerup','mousedown','mouseup'])addEventListener(type,e=>{window.__clickLog.push(type+':'+(e.target?.id||e.target?.tagName)+':'+e.button+(document.pointerLockElement?':locked':''));if(window.__clickLog.length>20)window.__clickLog.shift();},true);});
   const t=Date.now();await click(s.page);
   const sent=await waitTx(s,t,f=>f.type==='item'&&/place/.test(f.action??''),3000);
   const made=sent&&await waitRx(s,t,f=>f.type==='ngc-create'&&prefab.test(f.prefab??''),ms);
   // The server redoes the placement from the eye ray and may refuse a spot the preview liked: try the next one (3 sends).
   if(!made&&sent&&++refused<3)continue;
   return {made,sent:Boolean(sent),refused,aim:round3(c),preview:pl&&{position:round3(pl.position),master:pl.master},ackMs:made?made.t-t:null,...(sent?{}:{under:await underCursor(s.page)})};
  }
  return {made:null,sent:refused>0,refused,tried:candidates.length,valid,elsewhere,expect:round3(expect),preview:await placement(s)};
 }
 // Ground points around us at `d` metres (browser space), eight headings, for deployables and the first foundation.
 const around=(p,d,y=-0.1)=>Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return [p[0]+d*Math.cos(a),p[1]+y,p[2]+d*Math.sin(a)];});
 // The NGC entity's collider centre in the page (read-only), or its create position.
 // A classic-view target ({viewId, useKey, centre}: map crates, scene doors) brings its own centre and probe key.
 const centre=async(s,f)=>f.centre?await f.centre():(await s.page.evaluate(k=>window.explorerDev.onlineObject?.(k),ngcKey(f)))?.center??browserOf(f.position);
 const targetKey=f=>f.useKey??ngcKey(f),sameTarget=(x,f)=>f.useKey?x.viewId===f.viewId:ngcKey(x)===ngcKey(f);
 // Walks to `d` metres from an entity (from our side, turned by `turn` radians around it) and faces its collider centre.
 async function approach(s,f,d=1.6,turn=0){const c=await centre(s,f),p=await feet(s.page),a=Math.atan2(p[2]-c[2],p[0]-c[0])+turn;
  const spot=[c[0]+Math.cos(a)*d,p[1],c[2]+Math.sin(a)*d];await walkTo(s.page,spot,{within:0.6,ms:30000});await aimAt(s.page,await centre(s,f));return c;}
 // Context on an entity: quick use (E tap) or a menu option (E held). Waits for the server's Context reply.
 // The ContextProbe (3 m ray from the eyes) must be on this entity (an open door is a thin panel, a box sits low): re-aim
 // around its centre, then step around it, until the page's probe names it.
 // Then across the entity's whole box: from a doorway an open door's centre can sit behind the foundation's edge (a
 // 30 Oct run's ray hit the foundation, then the frame, never the panel).
 async function onTarget(s,f){const c=await centre(s,f),key=targetKey(f),probe=await has(s,'useTarget');
  const size=f.useKey?null:(await s.page.evaluate(k=>window.explorerDev.onlineObject?.(k),ngcKey(f)))?.size,box=[];
  if(size)for(const ky of [0.3,0.15])for(const kx of [-0.35,0.35,0])for(const kz of [-0.35,0.35,0])if(kx||kz)box.push([size[0]*kx,size[1]*ky,size[2]*kz]);
  for(const [dx,dy,dz] of [[0,0,0],[0,-0.25,0],[0,0.25,0],[0,-0.5,0],[0.3,0,0],[-0.3,0,0],[0,0,0.3],[0,0,-0.3],[0,0.5,0],...box]){await aimAt(s.page,[c[0]+dx,c[1]+dy,c[2]+dz]);await sleep(180);if(probe?(f.lastProbe=await s.page.evaluate(()=>window.explorerDev.useTarget()))===key:await s.page.evaluate(()=>Boolean(document.querySelector('#use-hint')?.textContent?.trim())))return true;}return false;}
 async function use(s,f,{option=null,d=1.6}={}){
  let aimed=false;const seen=[];for(const [dd,turn] of [[d,0],[d,0.8],[d,-0.8],[Math.max(0.9,d-0.5),0],[d,1.6],[d,-1.6]]){await approach(s,f,dd,turn);if(aimed=await onTarget(s,f))break;
   seen.push({at:round3(await feet(s.page)),centre:round3(await centre(s,f)),probe:f.lastProbe??null,hit:await s.page.evaluate(()=>window.explorerDev.useHit?.()??null)});}
  const t=Date.now(),menu=await useKey(s.page,{option});
  const reply=await waitRx(s,t,x=>x.type==='rpc'&&/^Context:?[E-L]$|^[E-L]$/.test(x.name??'')&&x.viewId===998,cfg.replyMs);
  const final=option!=null?await waitRx(s,t,x=>x.type==='rpc'&&x.viewId===998&&/[HIJKL]$/.test(x.name??''),cfg.replyMs):reply;
  return {menu,reply:reply?.name??null,final:final?.name??null,aimed,...(aimed?{}:{seen:seen.slice(0,3)})};
 }
 // ---- the base (build.base), reused by doors, raiding and the rules row ---------------------------------------------
 const STRUCTS=[['Wood Pillar',/;struct_wood_pillar$/],['Wood Wall',/;struct_wood_wall$/],['Wood Doorway',/;struct_wood_doorway$/],['Wood Ceiling',/;struct_wood_ceiling$/],['Wood Stairs',/;struct_wood_stairs$/]];
 // NoPlacementZone (monuments): nothing can be built or deployed inside; walk straight out of the one we stand in.
 async function leaveZones(s){
  const p=await feet(s.page),zones=await s.page.evaluate(()=>window.explorerDev.buildZones?.()??[]);
  const z=zones.map(z=>({...z,d:distXZ(p,z.position)})).filter(z=>z.d<z.radius+6).sort((a,b)=>a.d-b.d)[0];if(!z)return null;
  const dx=p[0]-z.position[0],dz=p[2]-z.position[2],l=Math.hypot(dx,dz)||1,go=z.radius-z.d+14;
  const w=await walkTo(s.page,[p[0]+dx/l*go,p[1],p[2]+dz/l*go],{within:3,ms:go*400+20000});return {zone:round3(z.position),radius:round(z.radius),walked:round(go),arrived:w.arrived};
 }
 // Steps away from the nearest of `points` (browser space) until `d` metres clear of it (earlier builds refuse overlaps).
 async function clearOf(s,points,d){const p=await feet(s.page),near=points.map(a=>({a,d:distXZ(p,a)})).filter(x=>x.d<d).sort((x,y)=>x.d-y.d)[0];if(!near)return;
  // The navmesh walk: a straight line from inside or on top of a base (door rows end there) stalls on its walls.
  const dx=p[0]-near.a[0],dz=p[2]-near.a[2],l=Math.hypot(dx,dz)||1,to=[near.a[0]+dx/l*(d+2),p[1],near.a[2]+dz/l*(d+2)];const w=await walkToMeet(s.page,()=>to,{within:1.5,ms:45000});
  if(!w.path)await walkTo(s.page,to,{within:1.5,ms:30000});}
 async function placeFoundation(s,avoid=[]){
  await leaveZones(s);
  await clearOf(s,avoid,16);
  if(!await equip(s,'Wood Foundation'))return {made:null,why:'could not hold the Wood Foundation'};
  const p=await feet(s.page),cands=[];for(const d of [6,7,5,8])for(const c of around(p,d,-0.3))if(avoid.every(a=>distXZ(c,a)>11))cands.push(c);
  return place(s,{prefab:/;struct_wood_foundation$/,candidates:cands});
 }
 // A piece at master-local [x, y, z] (y 4 = on the foundation, 8 = the next floor): stands outside the foundation (the
 // open sides first, then beyond the piece's own edge) and sweeps the aim up through the cell; only a valid preview that
 // snaps to the expected cell is placed. Structure placement reaches 8 m (ceilings 4 m), so the stands are close.
 async function placePiece(s,base,item,prefab,local){
  if(!await equip(s,item))return {made:null,why:`could not hold ${item}`};
  const expect=structureWorld(base.foundation,local),at=l=>browserOf(structureWorld(base.foundation,l)),onTop=p=>[p[0],base.top,p[2]];
  const out=(v,d)=>v?v+Math.sign(v)*d:0,stands=[[5,0],[-5,0],[out(local[0],3.5),out(local[2],3.5)],[4,0],[-4,0],[0,-6]].map(([x,z])=>onTop(at([x,0,z])));
  const aims=[];for(const dy of [0.1,1,2,3,4.2,4.6,5.2])for(const k of [1,0.85,1.1])aims.push(at([local[0]*k,0,local[2]*k]).map((v,i)=>i===1?base.top+(local[1]-4)+dy:v));
  const seen=new Set();let last=null;
  for(const st of stands){const k=st.map(v=>v.toFixed(1)).join();if(seen.has(k))continue;seen.add(k);
   await walkTo(s.page,st,{within:0.8,ms:15000});last=await place(s,{prefab,candidates:aims,expect});if(last.made||last.sent)return last;}
  return last??{made:null,preview:await placement(s)};
 }
 const baseReady=()=>ctx.base&&ctx.base.session===me().page&&!ctx.base.lost;

 // ---- rows ---------------------------------------------------------------------------------------------------------
 const rows={
  async 'gather.tree'(r){
   const s=me();if(!await has(s,'trees'))return skip(OLD_BUILD('trees'));
   const t=Date.now()-1,before=await count(s,'Wood'),g=await gatherWood(s,before+3,{ms:240000});await ctx.shot(r,'gathered');
   const ev={...g,before,notices:notices(s,t).slice(0,4),swingsSent:s.frames.tx(t,f=>f.type==='item'&&f.action==='melee-hit').length,treeHits:s.frames.tx(t,f=>f.type==='item'&&f.action==='melee-hit'&&f.data?.flag).length};
   if(g.why)return skip(g.why,ev);
   return g.have>before?pass(ev):fail(g.trees?'swung at trees but the server added no Wood':'found no terrain tree to swing at',ev);
  },
  async 'craft.blueprints'(r){
   const s=me(),f=s.frames.rx(0,rpcOn(s,'ReceiveBoundBPs')).at(-1)??await waitRx(s,0,rpcOn(s,'ReceiveBoundBPs'));
   if(!f)return fail('no ReceiveBoundBPs for our character');
   const uids=decodeBoundBlueprints(f.values?.[0]);if(!uids)return fail('ReceiveBoundBPs payload not count + int32 ids',{values:f.values});
   if(!await openInventory(s.page))return fail('inventory did not open (Tab)');
   const shown=await s.page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].map(b=>({key:b.dataset.blueprint,name:b.textContent.trim()})));
   await ctx.shot(r,'list');await closeInventory(s.page);
   const cat=loadCatalogue(),ev={server:uids.length,shown:shown.length,names:shown.map(x=>x.name).slice(0,60)};
   if(!cat)return uids.length===shown.length?pass(ev,'no item catalogue on this host: counts compared only'):fail('the craft list does not match ReceiveBoundBPs',ev);
   const uidOf=k=>cat.items[k]?.data?._uniqueID,server=new Set(uids),page=new Set(shown.map(x=>uidOf(x.key)));
   const missing=[...server].filter(u=>!page.has(u)),extra=[...page].filter(u=>!server.has(u));
   const unknown=Object.keys(cat.blueprints).filter(k=>!server.has(uidOf(k))).map(k=>cat.items[cat.blueprints[k].result]?.data?.m_Name);
   Object.assign(ev,{missing:missing.length,extra:extra.length,unknownExamples:unknown.slice(0,5),unknownOffered:shown.filter(x=>!server.has(uidOf(x.key))).map(x=>x.name)});
   if(!uids.length)return fail('the server bound no blueprints',ev);
   return missing.length||extra.length?fail('the craft list does not match ReceiveBoundBPs',ev):pass(ev);
  },
  async 'craft.cancel'(r){return craftRow(r,{cancel:true});},
  async 'craft.finish'(r){return craftRow(r,{cancel:false});},
  async 'craft.study'(r){
   const s=me(),x=await supply(s,[['P250 Blueprint',1]]);if(x)return unmet(x);
   const cell=(await inventoryCells(s.page)).find(c=>c.name==='P250 Blueprint');if(!cell)return fail('no P250 Blueprint cell');
   const bps=s.frames.rx(0,rpcOn(s,'ReceiveBoundBPs')).length,before=decodeBoundBlueprints(s.frames.rx(0,rpcOn(s,'ReceiveBoundBPs')).at(-1)?.values?.[0])?.length??0;
   if(!await openInventory(s.page))return fail('inventory did not open (Tab)');
   const box=await s.page.locator(cellSelector(cell.slot)).boundingBox();const t=Date.now();await s.page.mouse.click(box.x+box.width/2,box.y+box.height/2,{button:'right'});
   const opened=await s.page.waitForSelector('#item-menu:not([hidden]) [data-menu-option="Study"]',{timeout:5000}).then(()=>true,()=>false);
   if(!opened){await closeInventory(s.page);return fail('the item menu offers no Study');}
   await s.page.locator('#item-menu [data-menu-option="Study"]').click();
   const sent=await waitTx(s,t,f=>f.type==='inventory'&&f.action==='menu',3000),bp=await waitRx(s,t,rpcOn(s,'ReceiveBoundBPs')),note=await popup(s,t,/craft|blueprint/i);
   await sleep(600);const listed=await s.page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].some(b=>b.textContent.trim()==='P250'));await ctx.shot(r,'studied');await closeInventory(s.page);
   const after=decodeBoundBlueprints(bp?.values?.[0])?.length??null,left=await count(s,'P250 Blueprint');
   const ev={sent:Boolean(sent),before,after,notice:note?.values?.[0]??null,listed,itemLeft:left,receiveBoundBPs:bps};
   if(!sent)return fail('Study sent nothing',ev);if(!bp)return fail('no ReceiveBoundBPs after Study',ev);
   if(!(after>before))return fail('the bound blueprint list did not grow',ev);
   if(left)return fail('the blueprint item was not used up',ev);
   return listed?pass(ev):fail('the craft list does not offer the P250',ev);
  },
  async 'build.foundation'(r){
   const s=me(),x=await supply(s,[['Wood Foundation',1]]);if(x)return unmet(x);
   const res=await placeFoundation(s,ctx.base?[browserOf(ctx.base.foundation.position)]:[]);if(res.made)await ctx.shot(r,'placed');else await ctx.shot(r,'not-placed');
   const ev={prefab:res.made?.prefab??null,position:round3(res.made?.position),ackMs:res.ackMs,sent:res.sent,preview:res.preview,...(res.under?{under:res.under}:{})};
   if(res.made)ctx.lone={foundation:res.made};
   return res.made?pass(ev):fail(res.sent?'placement sent but no structure created':'no valid foundation spot in front of the player',ev);
  },
  async 'build.base'(r){
   const s=me(),parts=[['Wood Foundation',1],['Wood Pillar',8],['Wood Wall',1],['Wood Doorway',1],['Wood Ceiling',1],['Wood Stairs',1]];
   const x=await supply(s,parts);if(x)return unmet(x);
   const f=await placeFoundation(s,ctx.lone?[browserOf(ctx.lone.foundation.position)]:[]);if(!f.made){await ctx.shot(r,'no-foundation');return fail('foundation not created',f);}
   const o=await s.page.evaluate(k=>window.explorerDev.onlineObject?.(k),ngcKey(f.made));await sleep(500);
   const base={foundation:f.made,session:s.page,pieces:{foundation:f.made},top:o?.center&&o.size?o.center[1]+o.size[1]/2:browserOf(f.made.position)[1]+4};ctx.base=base;
   const plan=[['pillar1','Wood Pillar',/;struct_wood_pillar$/,[2.5,4,2.5]],['pillar2','Wood Pillar',/;struct_wood_pillar$/,[-2.5,4,2.5]],['pillar3','Wood Pillar',/;struct_wood_pillar$/,[-2.5,4,-2.5]],['pillar4','Wood Pillar',/;struct_wood_pillar$/,[2.5,4,-2.5]],
    ['wall','Wood Wall',/;struct_wood_wall$/,[0,4,2.5]],['doorway','Wood Doorway',/;struct_wood_doorway$/,[0,4,-2.5]],['ceiling','Wood Ceiling',/;struct_wood_ceiling$/,[0,4,0]],
    ['pillar5','Wood Pillar',/;struct_wood_pillar$/,[2.5,8,2.5]],['pillar6','Wood Pillar',/;struct_wood_pillar$/,[-2.5,8,2.5]],['pillar7','Wood Pillar',/;struct_wood_pillar$/,[-2.5,8,-2.5]],['pillar8','Wood Pillar',/;struct_wood_pillar$/,[2.5,8,-2.5]],
    ['stairs','Wood Stairs',/;struct_wood_stairs$/,[0,8,0]]];
   const done=[],failed=[];
   for(const [id,item,prefab,local]of plan){const p=await placePiece(s,base,item,prefab,local);if(p.made){base.pieces[id]=p.made;done.push(id);}else failed.push({id,sent:p.sent,preview:p.preview,why:p.why});}
   await sleep(800);await walkTo(s.page,browserOf(structureWorld(base.foundation,[0,0,-9])).map((v,i)=>i===1?base.top:v),{within:1.5,ms:20000});await aimAt(s.page,[...browserOf(structureWorld(base.foundation,[0,0,0])).map((v,i)=>i===1?base.top+2:v)]);await sleep(600);await ctx.shot(r,'base');
   const masters=s.frames.rx(f.made.t-1,x=>x.type==='create'&&x.prefab==='StructureMasterPrefab').map(x=>x.viewId);
   // StructureMaster.AddStructureComponent -> SMSet(master view) on every piece (buffered, so once per piece we saw made).
   const smset=s.frames.rx(f.made.t-1,x=>x.type==='ngc-call'&&x.name==='SMSet'),keys=new Set(Object.values(base.pieces).map(ngcKey));
   const bound=new Set(smset.filter(x=>keys.has(ngcKey(x))).map(ngcKey)),masterIds=new Set(smset.filter(x=>keys.has(ngcKey(x))).map(x=>x.values?.[0]));
   const ev={placed:['foundation',...done],failed,masters,boundPieces:bound.size,pieces:keys.size,masterIds:[...masterIds],sameMaster:bound.size===keys.size&&masterIds.size===1};
   if(!masters.length)return fail('no StructureMasterPrefab created for the foundation',ev);
   if(failed.length)return fail(`${failed.length} pieces not created: ${failed.map(x=>x.id).join(', ')}`,ev);
   return ev.sameMaster?pass(ev):fail('pieces were not all bound (SMSet) to one structure master',ev);
  },
  async 'build.rules'(r){
   const s=me(),x=await supply(s,[['Wood Wall',1],['Wood Foundation',1]]);if(x)return unmet(x);
   const ev={};
   // A wall on a bare foundation (no pillars at its ends): the preview stays invalid and nothing is sent or created.
   const lone=ctx.lone?.foundation??null;
   if(lone&&await equip(s,'Wood Wall')){
    const o=await s.page.evaluate(k=>window.explorerDev.onlineObject?.(k),ngcKey(lone)),top=o?.center&&o.size?o.center[1]+o.size[1]/2:browserOf(lone.position)[1]+4;
    const edge=browserOf(structureWorld(lone,[0,4,2.5]));await walkTo(s.page,browserOf(structureWorld(lone,[0,0,8])).map((v,i)=>i===1?top:v),{within:1,ms:20000});
    let anyValid=false;const t=Date.now();for(const dy of [0.2,1,2]){await aimAt(s.page,[edge[0],top+dy,edge[2]]);await sleep(250);if((await placement(s))?.valid)anyValid=true;await click(s.page);await sleep(600);}
    ev.wallWithoutPillars={previewValid:anyValid,sent:s.frames.tx(t,f=>f.type==='item'&&f.action==='structure-place').length,created:ngcCreates(s,t,/;struct_wood_wall$/).length};
   }else ev.wallWithoutPillars=lone?'could not hold the Wood Wall':'needs build.foundation earlier in the run (a foundation without pillars)';
   // A second foundation overlapping the base's foundation: invalid preview, nothing sent or created.
   if(baseReady()&&await equip(s,'Wood Foundation')){
    const c=browserOf(structureWorld(ctx.base.foundation,[1.5,4,1])),t=Date.now();await walkTo(s.page,browserOf(structureWorld(ctx.base.foundation,[9,0,0])).map((v,i)=>i===1?ctx.base.top:v),{within:1.2,ms:20000});
    let anyValid=false;for(const k of [0,0.5,-0.5]){await aimAt(s.page,[c[0]+k,ctx.base.top,c[2]]);await sleep(250);if((await placement(s))?.valid)anyValid=true;await click(s.page);await sleep(600);}
    ev.overlappingFoundation={previewValid:anyValid,sent:s.frames.tx(t,f=>f.type==='item'&&f.action==='structure-place').length,created:ngcCreates(s,t,/;struct_wood_foundation$/).length};
   }else ev.overlappingFoundation='needs build.base earlier in the run';
   await ctx.shot(r,'refused');
   const checks=[ev.wallWithoutPillars,ev.overlappingFoundation].filter(v=>typeof v==='object');
   if(!checks.length)return skip('needs build.foundation and build.base earlier in the run',ev);
   const bad=checks.filter(c=>c.created||c.sent||c.previewValid);
   return bad.length?fail('a placement the rules forbid was offered, sent or created',ev):pass(ev);
  },
  async 'door.use'(r){
   if(!baseReady())return skip('needs build.base earlier in the run (a doorway)');
   const s=me(),x=await supply(s,[['Wooden Door',1]]);if(x)return unmet(x);
   const m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);
   if(!await equip(s,'Wooden Door'))return fail('could not hold the Wooden Door');
   // DeployableItem.CheckPlacement on a door: Hardpoint.GetHardpointFromRay needs the ray to hit the doorway itself (a post
   // or the lintel), not the open gap.
   const out=browserOf(structureWorld(ctx.base.foundation,[0,0,-6.5])).map((v,i)=>i===1?ctx.base.top:v),post=(x,dy)=>{const w=browserOf(structureWorld(ctx.base.foundation,[x,4,-2.5]));return [w[0],ctx.base.top+dy,w[2]];};
   await walkTo(s.page,out,{within:1,ms:20000});
   const d=await place(s,{prefab:/;deploy_wood_door$/,candidates:[post(1.15,1.2),post(-1.15,1.2),post(0,2.8),post(1.25,0.6),post(-1.25,0.6),post(1.0,2.2),post(-1.0,2.2),post(0,3.2)]});
   if(!d.made){await ctx.shot(r,'no-door');return fail('door not created on the doorway',{sent:d.sent,preview:d.preview});}
   ctx.door=d.made;await sleep(800);
   const states=s=>s.frames.rx(0,f=>f.type==='ngc-call'&&f.name==='DOo'&&ngcKey(f)===ngcKey(d.made)).map(f=>f.values?.[0]);
   const t1=Date.now(),open=await use(s,d.made,{d:2}),o1=await waitRx(s,t1,f=>f.type==='ngc-call'&&f.name==='DOo'&&ngcKey(f)===ngcKey(d.made));
   const seen1=await waitRx(m.tg.session,t1,f=>f.type==='ngc-call'&&f.name==='DOo'&&ngcKey(f)===ngcKey(d.made));
   await sleep(1500);await ctx.shot(r,'open');
   const t2=Date.now(),close=await use(s,d.made,{d:2}),o2=await waitRx(s,t2,f=>f.type==='ngc-call'&&f.name==='DOo'&&ngcKey(f)===ngcKey(d.made));await sleep(1200);
   const ev={door:ngcKey(d.made),placeAckMs:d.ackMs,open:{context:open,state:o1?.values?.[0]??null},close:{context:close,state:o2?.values?.[0]??null},targetSaw:seen1?.values?.[0]??null,states:states(s),page:await s.page.evaluate(k=>window.explorerDev.onlineObject?.(k)?.door,ngcKey(d.made))};
   if(!o1)return fail('no DOo after using the door',ev);if(!seen1)return fail('the other player got no DOo',ev);
   if(!o2)return fail('no DOo after using it again',ev);
   return o1.values?.[0]!==0&&o2.values?.[0]===0?pass(ev):fail('door states were not open then closed',ev);
  },
  async 'door.lock'(r){
   if(!ctx.door)return skip('needs door.use earlier in the run');
   const s=me(),m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session,door=ctx.door,code=String(1000+Math.floor(Math.random()*9000));
   const ev={};
   // Owner: Lock, then Change Lock -> lockentry.show true -> a 4-digit code.
   let t=Date.now();ev.lock=await use(s,door,{option:'Lock',d:2});ev.lockNotice=(await popup(s,t,/locked/i))?.values?.[0]??null;
   t=Date.now();ev.change=await use(s,door,{option:'Change Lock',d:2});
   ev.entry=Boolean(await waitRx(s,t,f=>isConsoleCommand(f)&&/^lockentry\.show true/.test(f.values[0])));
   if(ev.entry&&await s.page.waitForSelector('#lock-entry:not([hidden]) #lock-code',{timeout:5000}).then(()=>true,()=>false)){t=Date.now();await s.page.locator('#lock-code').fill(code);await s.page.locator('#lock-code').press('Enter');ev.codeNotice=(await popup(s,t,/Password/i))?.values?.[0]??null;}
   // The other player: refused, offered Enter Code, then let in by the code.
   t=Date.now();ev.targetUse=await use(tg,door,{d:2});ev.refused=(await popup(tg,t,/locked/i))?.values?.[0]??null;
   t=Date.now();ev.targetEnter=await use(tg,door,{option:'Enter Code',d:2});
   if(await waitRx(tg,t,f=>isConsoleCommand(f)&&/^lockentry\.show false/.test(f.values[0]))&&await tg.page.waitForSelector('#lock-entry:not([hidden]) #lock-code',{timeout:5000}).then(()=>true,()=>false)){
    const t2=Date.now();await tg.page.locator('#lock-code').fill(code);await tg.page.locator('#lock-code').press('Enter');ev.accessNotice=(await popup(tg,t2,/access/i))?.values?.[0]??null;}
   t=Date.now();ev.targetOpen=await use(tg,door,{d:2});const opened=await waitRx(tg,t,f=>f.type==='ngc-call'&&f.name==='DOo'&&ngcKey(f)===ngcKey(door));ev.openedState=opened?.values?.[0]??null;
   await sleep(1000);await ctx.shot(r,'target-opened',tg.page);
   if(opened){t=Date.now();await use(tg,door,{d:2});await waitRx(tg,t,f=>f.type==='ngc-call'&&f.name==='DOo'&&ngcKey(f)===ngcKey(door));}
   if(!ev.lockNotice)return fail('no "Door is now locked" from the server',ev);
   if(!ev.codeNotice)return fail('setting the code got no "Password is now" reply',ev);
   if(!ev.refused)return fail('the other player was not refused ("The door is locked!")',ev);
   if(!ev.accessNotice)return fail('the right code did not grant access',ev);
   return opened?pass(ev):fail('the other player could not open the door with the code',ev);
  },
  async 'deploy.storage'(r){
   const s=me(),x=await supply(s,[['Wood Storage Box',1]]);if(x)return unmet(x);
   const box=await deploy(s,'Wood Storage Box',/;deploy_wood_box$/);if(!box.made){await ctx.shot(r,'not-placed');return fail('storage box not created',box);}
   const item=(await inventoryCells(s.page)).find(c=>/^(Torch|Bandage|Wood)$/.test(c.name));if(!item)return skip('nothing to store');
   const ev={box:ngcKey(box.made),item:item.name};
   const o1=await openLoot(s,box.made);ev.open=o1;if(!o1.open)return fail('the box did not open (no SetLooter/GNUP)',ev);
   await dragToLoot(s,item.slot,0);ev.stored=await lootCells(s.page);await ctx.shot(r,'stored');
   await closeInventory(s.page);await sleep(600);const stop=s.frames.tx(o1.t,f=>f.type==='inventory'&&f.action==='stop-looting').length;
   const o2=await openLoot(s,box.made);ev.reopen=o2;ev.after=await lootCells(s.page);
   const back=ev.after.find(c=>c.name===item.name);let took=false;
   if(back){await takeFromLoot(s,back.slot);await sleep(600);took=(await inventoryCells(s.page)).some(c=>c.name===item.name);}
   await closeInventory(s.page);Object.assign(ev,{stopLooting:stop,tookBack:took});
   if(!ev.stored.some(c=>c.name===item.name))return fail('the item did not move into the box',ev);
   if(!back)return fail('the item was not in the box when reopened',ev);
   return took?pass(ev):fail('dragging the item out of the box did not bring it back',ev);
  },
  // LootableObjectSpawner crates are classic views the server creates and fills; the page must open the server's crate
  // (SetLooter + GNUP on its view) and a drag out of it must reach the server (ITMV). EU 1, 30 Oct: the page opened its
  // own offline crates instead, whose loot nothing could move.
  async 'loot.crate'(r){
   const s=me(),crates=await s.page.evaluate(()=>window.explorerDev.onlineCrates?.()??null);if(!crates)return skip(OLD_BUILD('onlineCrates'));
   const here=await feet(s.page),list=crates.filter(c=>c.body&&!c.looter).map(c=>({...c,d:distXZ(c.center,here)})).sort((a,b)=>a.d-b.d),c=list[0];
   const ev={crates:crates.length,offline:await s.page.evaluate(()=>window.explorerDev.crates?.().length??null)};
   if(ev.offline)return fail('the page spawned its own offline crates on an online server',ev);
   if(!c)return skip('the server sent no crate',ev);
   Object.assign(ev,{crate:c.viewId,name:c.name,distance:round(c.d)});if(c.d>(cfg.crateRadius??1500))return skip(`nearest crate ${round(c.d)} m away`,ev);
   if(c.d>3)ev.walk=await walkToMeet(s.page,()=>c.center,{within:1.8,ms:cfg.crateWalkMs??null});
   const f={viewId:c.viewId,useKey:'view:'+c.viewId,centre:async()=>(await s.page.evaluate(id=>window.explorerDev.onlineCrates().find(x=>x.viewId===id)?.center??null,c.viewId))??c.center};
   const o=await openLoot(s,f);ev.open=o;if(!o.open){await ctx.shot(r,'not-open');return fail('the crate did not open (no SetLooter/GNUP on its view)',ev);}
   const cells=await lootCells(s.page);ev.loot=cells.map(x=>x.name);await ctx.shot(r,'open');
   const item=cells[0];if(!item){await closeInventory(s.page);return skip('the crate is empty (another player looted it)',ev);}
   const before=await count(s,item.name),t=Date.now();await takeFromLoot(s,item.slot);await sleep(800);
   ev.sent=s.frames.tx(t,x=>x.type==='inventory'&&x.action==='move').map(x=>x.data??x).slice(0,3).length;ev.gnup=Boolean(await gnup(s,t,3000));
   const after=await count(s,item.name);Object.assign(ev,{item:item.name,before,after});
   const tc=Date.now();await closeInventory(s.page);ev.stopLooting=Boolean(await waitTx(s,tc,x=>x.type==='inventory'&&x.action==='stop-looting',3000));
   if(!ev.sent)return fail('taking the item sent no move to the server',ev);
   return after>before?pass(ev):fail('the item did not arrive in our inventory (server refused the move)',ev);
  },
  // Town and monument doors (scene MovingDoors on manual views): E must ask the server (Context:A on the view) and the
  // server's DOo must move the door for us. EU 1, 30 Oct: a gateway without recoveredDir rejected every use.
  async 'door.scene'(r){
   const s=me(),doors=await s.page.evaluate(()=>window.explorerDev.sceneDoors?.()??null);if(!doors)return skip(OLD_BUILD('sceneDoors'));
   const here=await feet(s.page),door=doors.filter(d=>d.viewId>0).map(d=>({...d,d:distXZ(d.spot,here)})).sort((a,b)=>a.d-b.d)[0];
   if(!door)return skip('no scene door with a manual view');
   const ev={door:door.index,viewId:door.viewId,distance:round(door.d)};
   if(!door.online)return fail('the use key goes to the page\'s own offline door, not the server',ev);
   if(door.d>(cfg.sceneDoorRadius??3000))return skip(`nearest scene door ${round(door.d)} m away`,ev);
   // An admin teleports there and back: left at a town door, the base rows after this one (raid, hunt, fall) ran from
   // the wrong place (the 13 m fall landed on a town roof, 30 Oct).
   let home=null;
   if(door.d>4){
    // An admin teleports next to it (RustServerManagement teleport.topos: UnstickMove); anyone else walks.
    if(await h.ensureAdmin(s)){home=here;const u=toUnity(door.spot),t=Date.now();ev.teleport=(await consoleCommand(s,`teleport.topos "${ctx.me.name}" ${u[0].toFixed(2)} ${(u[1]+0.5).toFixed(2)} ${u[2].toFixed(2)}`,{ms:cfg.replyMs})).text?.trim()??null;
     ev.unstick=Boolean(await waitRx(s,t,x=>x.type==='rpc'&&x.name==='UnstickMove',5000));await sleep(1500);}
    else ev.walk=await walkToMeet(s.page,()=>door.spot,{within:1,ms:cfg.sceneDoorWalkMs??null});
    await walkTo(s.page,door.spot,{within:0.6,ms:15000});
   }
   const f={viewId:door.viewId,useKey:'view:'+door.viewId,centre:async()=>door.center},state=async()=>(await s.page.evaluate(i=>window.explorerDev.sceneDoors()[i].state,door.index));
   const toggle=async()=>{const t=Date.now(),from=await state(),u=await use(s,f,{d:1.8});const call=await waitRx(s,t,x=>x.type==='rpc'&&/DOo$/.test(x.name??'')&&x.viewId===door.viewId);await sleep(2500);return {use:u,doo:call?call.values?.[0]??true:null,from,to:await state()};};
   const back=async()=>{if(!home)return;const u=toUnity(home);await consoleCommand(s,`teleport.topos "${ctx.me.name}" ${u[0].toFixed(2)} ${(u[1]+0.5).toFixed(2)} ${u[2].toFixed(2)}`,{ms:cfg.replyMs});await sleep(1500);ev.back=round(distXZ(await feet(s.page),home));};
   try{
    ev.open=await toggle();await ctx.shot(r,'opened');
    if(ev.open.doo==null)return fail(ev.open.use.reply?'the server answered the use but sent no DOo':'no reply to the use (Context:A refused or unanswered)',ev);
    if(ev.open.to===ev.open.from)return fail('DOo arrived but the page\'s door did not move',ev);
    ev.close=await toggle(); // put it back the way it was
    return ev.close.doo!=null?pass(ev):fail('the second use (close) got no DOo',ev);
   }finally{await back();}
  },
  async 'deploy.campfire'(r){
   const s=me();let crafted=false;
   if(!(await count(s,'Camp Fire'))){
    if(await h.ensureAdmin(s)){const e=await give(s,'Camp Fire',1);if(e)return fail(e);}
    else{const w=await supply(s,[['Wood',8]],{survival:true});if(w)return unmet(w);const c=await craft(s,'Camp Fire',{cancel:false});if(!c.done)return fail('could not craft the Camp Fire',c);crafted=true;}
   }
   const fuel=await supply(s,[['Wood',3]],{survival:true});if(fuel)return unmet(fuel);
   if(await h.ensureAdmin(s)&&!(await count(s,'Raw Chicken Breast')))await give(s,'Raw Chicken Breast',2);
   const fire=await deploy(s,'Camp Fire',/;deploy_camp_bonfire$/);if(!fire.made){await ctx.shot(r,'not-placed');return fail('camp fire not created',fire);}
   return fireRow(r,s,fire.made,{fuel:'Wood',cook:['Raw Chicken Breast',/^Cooked Chicken Breast$/],crafted});
  },
  async 'deploy.furnace'(r){
   const s=me(),x=await supply(s,[['Furnace',1],['Wood',5],['Metal Ore',5]]);if(x)return unmet(x);
   const f=await deploy(s,'Furnace',/;deploy_furnace$/);if(!f.made){await ctx.shot(r,'not-placed');return fail('furnace not created',f);}
   return fireRow(r,s,f.made,{fuel:'Wood',cook:['Metal Ore',/^Metal Fragments$/]});
  },
  async 'raid.charge'(r){
   if(!baseReady())return skip('needs build.base earlier in the run (a wall)');
   const s=me(),x=await supply(s,[['Explosive Charge',1]]);if(x)return unmet(x);
   const wall=ctx.base.pieces.wall;if(!wall)return skip('the base has no wall');
   if(!await equip(s,'Explosive Charge'))return fail('could not hold the Explosive Charge');
   // The charge's placeRange is 2 m: a player stands within reach of the wall's outer face (1.1 m out from its centre,
   // away from the foundation), or the original drops the charge to the ground below the ray's end.
   const ev0={},wc=await centre(s,wall),fc=browserOf(structureWorld(ctx.base.foundation,[0,0,0])),out=[wc[0]-fc[0],wc[2]-fc[2]],n=Math.hypot(...out)||1;
   const stand=[wc[0]+out[0]/n*1.1,ctx.base.top,wc[2]+out[1]/n*1.1];
   // From wherever the rows before left us (a respawn, another spot): the navmesh walk first, the last metres straight.
   if(distXZ(stand,await feet(s.page))>8)ev0.walk=await walkToMeet(s.page,()=>stand,{within:3});
   await walkTo(s.page,stand,{within:0.4,ms:25000});
   const at=await feet(s.page),reach=round3(Math.hypot(at[0]-wc[0],at[2]-wc[2]));
   if(!(reach<=1.8)){await ctx.shot(r,'out-of-reach');return fail('could not stand within reach of the wall (placeRange 2 m)',{reach,stand:round3(stand),...ev0});}
   const p=await place(s,{prefab:/;explosive_charge$/,candidates:[[wc[0],wc[1]-0.6,wc[2]],[wc[0],wc[1],wc[2]],[wc[0],wc[1]-1.2,wc[2]]]});
   if(!p.made){await ctx.shot(r,'not-placed');return fail('the charge was not created on the wall',{sent:p.sent,preview:p.preview,reach,under:p.under});}
   // Run: TimedExplosive fuse (10 s in the original prefab) at a safe distance, then watch the wall.
   const t=Date.now();await walkTo(s.page,browserOf(structureWorld(ctx.base.foundation,[0,0,18])).map((v,i)=>i===1?ctx.base.top:v),{within:2,ms:15000});
   await aimAt(s.page,wc);
   const boom=await waitRx(s,t,f=>f.type==='ngc-call'&&f.name==='ClientExplode'&&ngcKey(f)===ngcKey(p.made),25000);
   await sleep(1500);await ctx.shot(r,'after');
   const wallKey=ngcKey(wall),hits=s.frames.rx(t,f=>f.type==='ngc-call'&&ngcKey(f)===wallKey&&/ClientHealthUpdate|ClientKilled/.test(f.name??'')).map(f=>({name:f.name,values:f.values}));
   const gone=s.frames.rx(t,f=>f.type==='ngc-destroy'&&ngcKey(f)===wallKey).length>0,damaged=s.frames.rx(t,f=>f.type==='ngc-call'&&/ClientHealthUpdate|ClientKilled/.test(f.name??'')).map(f=>({key:ngcKey(f),name:f.name,values:f.values}));
   const ev={charge:ngcKey(p.made),fuseMs:boom?boom.t-p.made.t:null,wall:wallKey,wallCalls:hits,wallDestroyed:gone,otherDamage:damaged.filter(d=>d.key!==wallKey).slice(0,6),chargeGone:s.frames.rx(t,f=>f.type==='ngc-destroy'&&ngcKey(f)===ngcKey(p.made)).length>0};
   if(gone)ctx.base.pieces.wall=null;
   if(!boom)return fail('no ClientExplode from the charge',ev);
   return hits.length||gone?pass(ev):fail('the charge exploded but the wall took no damage',ev);
  },
  async 'wildlife.hunt'(r){
   // Server animals as the page draws them (explorerDev.onlineAnimals: view id, body centre, health, dead), nearest first.
   // A Rock reaches 1.5 m (+0.3 m sphere) from the eyes, so small animals are hit crouched from under a metre.
   const s=me(),weapon=(await inventoryCells(s.page)).find(c=>/^(Hatchet|Stone Hatchet|Rock)$/.test(c.name))?.name;if(!weapon||!await equip(s,weapon))return skip('no melee weapon to hunt with');
   const animals=()=>s.page.evaluate(()=>window.explorerDev.onlineAnimals()),t0=Date.now(),end=t0+(cfg.huntMs??180000),ev={tried:[]};
   // Where the animal is now (it moves while we walk); null once it is gone or dead.
   const where=async id=>{const a=(await animals()).find(x=>x.id===id);return a&&!a.dead?a.center??a.position:null;};
   // Crouched: HumanController.ServerFrame sends HearFootstep within 5 m walking and 10 m sprinting, none crouched.
   // The aim point is re-read right before the swing.
   const swing=async(id,fallback)=>{await s.page.keyboard.down('ControlLeft');try{await sleep(250);await aimAt(s.page,(await where(id))??fallback);await click(s.page);await sleep(2000);}finally{await s.page.keyboard.up('ControlLeft');}};
   while(Date.now()<end){
    const here=await feet(s.page),seen=(await animals()).filter(a=>!a.dead&&(a.center||a.position)).map(a=>({...a,at:a.center??a.position,d:distXZ(a.center??a.position,here)})).sort((x,y)=>x.d-y.d),list=seen.filter(a=>a.d<120);
    ev.seen={alive:seen.length,nearest:seen[0]?{animal:seen[0].key,distance:round(seen[0].d)}:null};
    const prey=list.find(a=>!ev.tried.includes(a.id))??list[0];if(!prey){await sleep(3000);continue;}
    if(!ev.tried.includes(prey.id))ev.tried.push(prey.id);
    const id=prey.id,tc=Date.now();
    let misses=0;ev.closest=null;
    for(let i=0;i<40&&Date.now()<end&&misses<6;i++){
     let c=await where(id);if(!c)break;
     // Walk (sprinting beyond 12 m) to 5.5 m, then crouch-walk the rest so a passive animal does not hear us and flee.
     // walkToMeet re-plans round what blocks a straight line (a base built earlier in the run kept the hunter 25 m off).
     if(distXZ(c,await feet(s.page))>5.5){await walkToMeet(s.page,async()=>(await where(id))??c,{within:5.5,ms:20000});c=await where(id);if(!c)break;}
     await s.page.keyboard.down('ControlLeft');try{await walkTo(s.page,c,{within:0.8,ms:5000,sprintBeyond:Infinity});}finally{await s.page.keyboard.up('ControlLeft');}
     c=await where(id);if(!c)break;const d=distXZ(c,await feet(s.page));ev.closest=Math.min(ev.closest??Infinity,round(d));if(d>1.6){misses++;continue;}misses=0;await swing(id,c);
    }
    // Evidence: our melee-hit records and ClientDeath. The server never sends ClientHealthChange for animals
    // (BasicWildLifeAI has the RPC but nothing calls it), so it is not looked for.
    const hits=s.frames.tx(tc,f=>f.type==='item'&&f.action==='melee-hit'&&f.data?.target?.viewId===id).length;
    const died=s.frames.rx(tc,x=>x.type==='rpc'&&x.viewId===id&&x.name==='ClientDeath')[0];
    ev.prey={viewId:id,animal:prey.key,startDistance:round(prey.d),hitsSent:hits,died:Boolean(died),killedBy:died?.values?.[1]??null};
    if(died){
     // Harvest: swings at the corpse add meat, leather or fat (notice.inventory) while it lasts.
     const th=Date.now(),before=await inventoryCells(s.page),corpse=(await animals()).find(x=>x.id===id),c=corpse?.center??corpse?.position??prey.at;for(let i=0;i<4;i++)await swing(null,c);
     const after=await inventoryCells(s.page);ev.harvest={notices:notices(s,th).slice(0,4),gained:after.filter(x=>!before.some(b=>b.slot===x.slot&&b.name===x.name&&b.count>=x.count)).map(x=>`${x.name} x${x.count}`)};
     await ctx.shot(r,'hunted');
     if(died.values?.[1]!==s.frames.characterView)return fail('the animal died but not by our hand',ev);
     return pass(ev,ev.harvest.gained.length?null:'killed; the corpse gave nothing to the Rock');
    }
    if(ev.tried.length>=4)break;
   }
   await ctx.shot(r,'not-hunted');
   if(!ev.tried.length)return skip('no animals within 120 m',ev);
   return fail('no animal died within the hunt time',ev);
  },
  // ---- mixed clients (P6): how our page draws the other browser player ---------------------------------------------
  async 'mixed.move'(r){
   const m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session,id=tg.frames.characterView;
   const start=await feet(tg.page),seen0=await remoteView(id);if(!seen0)return fail('we draw no copy of the other player',{viewId:id});
   // Both pages sampled on one clock: when the target's own feet first move, and when our copy of it first moves.
   const track={own:null,copy:null,poses:new Set()},t0=Date.now();let walking=true;
   // The target page can navigate away mid-poll (a drop and rejoin at the sleeper); stop sampling, not crash the run.
   const poll=(async()=>{while(walking||Date.now()-t0<9000){const [a,b]=await Promise.all([feet(tg.page),remoteView(id)]).catch(()=>[null,null]);if(!a)break;const t=Date.now();
    if(track.own==null&&distXZ(a,start)>0.3)track.own=t;if(b&&track.copy==null&&distXZ(b.position,seen0.position)>0.3)track.copy=t;for(const p of b?.pose??[])track.poses.add(p);await sleep(40);}})();
   await lockPointer(tg.page);const q=await feet(me().page),dx=start[0]-q[0]||1,dz=start[2]-q[2];await aimAt(tg.page,[start[0]+dx*5,start[1]+1.5,start[2]+dz*5]);
   await hold(tg.page,['KeyW'],3000);walking=false;await sleep(2500);await poll;
   const end=await feet(tg.page),copy=await remoteView(id);await ctx.shot(r,'copy');
   const ev={walked:round(distXZ(end,start)),copyEnd:round3(copy?.position),distance:copy?round(distXZ(copy.position,end)):null,lagMs:track.own&&track.copy?track.copy-track.own:null,poses:[...track.poses].slice(0,8),meet:m.meet};
   ctx.moveLagMs=ev.lagMs;
   // What our page heard about the target's view meanwhile (Destroy, ChangeGroup, death) and whether we still track it.
   if(!copy){ev.viewCalls=me().frames.rx(t0,f=>f.viewId===id&&(f.type==='destroy'||f.type==='group-change'||f.type==='create'||/OnKilled/.test(f.name??''))).map(f=>({dt:f.t-t0,type:f.type,name:f.name??null,group:f.group??null,by:/By$/.test(f.name??'')?f.values?.[0]??null:undefined}));ev.targetView=tg.frames.characterView;ev.copies=(await me().page.evaluate(()=>window.explorerDev.onlinePlayers().map(p=>p.id)));
    // A copy that turned into a ragdoll is a death, not a lost view (2026-10-23-gameplay-real-two-e: a wolf killed the
    // walking target; our page ragdolled it, which onlinePlayers() no longer lists). The killer's prefab from its Create.
    const death=ev.viewCalls.find(c=>/^Client_OnKilled/.test(c.name??''));
    if(death||tg.frames.characterView!==id){const killer=death?.by!=null?me().frames.rx(0,f=>f.type==='create'&&f.viewId===death.by).at(-1)?.prefab??null:null;
     ev.died={call:death?.name??null,killerView:death?.by??null,killer,targetLostCharacter:tg.frames.characterView!==id,ragdolls:(await me().page.evaluate(()=>window.explorerDev.onlineRagdolls().length))};
     return skip(`the other player died during the walk${killer?' (killed by '+killer+')':''}`,ev);}
    return fail('our copy of the other player vanished',ev);}
   if(ev.walked<1)return skip('the other player could not walk here',ev);
   if(ev.lagMs==null)return fail('our copy never moved',ev);
   if(ev.distance>0.75)return fail('our copy did not end where the other player stopped',ev);
   return ev.lagMs<2000?pass(ev):fail('our copy lags the other player by more than 2 s',ev);
  },
  async 'mixed.held'(r){
   const m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session,id=tg.frames.characterView,ev={steps:[]};
   for(const name of ['Rock','Torch']){
    if(!(await count(tg,name))){ev.steps.push({name,missing:true});continue;}
    const e=await equip(tg,name),t=Date.now();let seen=null;
    while(Date.now()-t<6000){const v=await remoteView(id);if(v?.held&&e&&v.held.rep===e.rep){seen=v.held;break;}await sleep(150);}
    ev.steps.push({name,rep:e?.rep??null,seenRep:seen?.rep??null,seenItem:seen?.item??null,ms:seen?Date.now()-t:null});
   }
   await ctx.shot(r,'held');
   const done=ev.steps.filter(x=>!x.missing);if(!done.length)return skip('the other player has neither a Rock nor a Torch',ev);
   const bad=done.filter(x=>!x.seenRep);return bad.length?fail('our copy did not hold: '+bad.map(x=>x.name).join(', '),ev):pass(ev);
  },
  async 'mixed.swing'(r){
   const m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session,id=tg.frames.characterView;
   const weapon=(await inventoryCells(tg.page)).find(c=>/^(Hatchet|Stone Hatchet|Rock)$/.test(c.name))?.name;if(!weapon||!await equip(tg,weapon))return skip('the other player has no melee weapon');
   // A swing at the air, away from us: our copy's attack event against the moment the target's page sent the swing.
   const q=await feet(me().page),p=await feet(tg.page);await aimAt(tg.page,[p[0]+(p[0]-q[0]||1)*4,p[1]+1.5,p[2]+(p[2]-q[2])*4]);await sleep(300);
   const t=Date.now();let seen=null;await click(tg.page);const sent=await waitTx(tg,t,f=>f.type==='item'&&/^melee-/.test(f.action??''),3000);
   while(Date.now()-t<4000){const v=await remoteView(id);if(v?.event?.event==='attack'){seen={at:Date.now(),event:v.event};break;}await sleep(30);}
   await ctx.shot(r,'swing');
   const ev={weapon,sent:sent?.action??null,eventLagMs:seen&&sent?seen.at-sent.t:null,event:seen?.event??null,moveLagMs:ctx.moveLagMs??null};
   if(!sent)return fail("the other player's swing sent nothing",ev);
   if(!seen)return fail('our copy never played the attack',ev);
   if(ev.moveLagMs!=null)ev.offsetMs=ev.eventLagMs-ev.moveLagMs;
   if(ev.moveLagMs==null)return pass(ev,'no movement lag measured (mixed.move did not run)');
   return Math.abs(ev.offsetMs)<600?pass(ev):fail('the attack plays out of step with the drawn body (event lag vs movement lag)',ev);
  },
  async 'mixed.chat'(r){
   const m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session,tok=token(),t=Date.now()-1;
   await say(tg.page,'mixed '+tok);const line=await waitRx(me(),t,f=>isConsoleCommand(f)&&f.values[0].startsWith('chat.add')&&f.values[0].includes(tok));
   await sleep(500);await ctx.shot(r,'chat');const ev={line:line?.values?.[0]??null,ms:line?line.t-t:null};
   if(!line)return fail('no chat.add from the other player reached us',ev);
   return line.values[0].includes(m.tg.me.name)?pass(ev):fail("the chat line is not under the other player's name",ev);
  },
  async 'mixed.death'(r){
   const m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session,id=tg.frames.characterView;
   const where=(await remoteView(id))?.position,before=(await me().page.evaluate(()=>window.explorerDev.onlineRagdolls())).length,t=Date.now();
   // Watch from the moment of death (the RAG event runs on the interpolation clock, while the target is still respawning).
   let rag=null,watching=true;const watch=(async()=>{while(watching&&!rag&&Date.now()-t<15000){const rs=await me().page.evaluate(()=>window.explorerDev.onlineRagdolls()).catch(()=>[]);if(rs.length>before){rag={...rs.at(-1),ms:Date.now()-t};break;}await sleep(100);}})();
   const back=await respawn(tg,'suicide');await sleep(1000);watching=false;await watch;
   await ctx.shot(r,'ragdoll');
   const kill=me().frames.rx(t,f=>f.type==='rpc'&&f.viewId===id&&/^Client_OnKilled/.test(f.name??'')).map(f=>f.name),gone=me().frames.rx(t,f=>f.type==='destroy'&&f.viewId===id).length>0;
   const at=rag?.positions?.[0]??null,ev={deathCalls:kill,viewDestroyed:gone,ragdoll:rag&&{bodies:rag.bodies,at:round3(at),ms:rag.ms},distance:at&&where?round(distXZ(at,where)):null,respawned:back.spawned?{viewId:back.spawned.viewId}:back.why};
   if(!kill.length)return fail('we got no DeathTransfer call for the other player',ev);
   if(!rag)return fail("no ragdoll for the other player's death",ev);
   if(ev.distance>3)return fail('the ragdoll is not where the other player stood',ev);
   return back.spawned?pass(ev):fail('the other player did not come back: '+back.why,ev);
  },
  async 'combat.melee'(r){
   const m=await meet(r,{fresh:true});if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);
   const s=me(),tg=m.tg.session,weapon=(await inventoryCells(s.page)).find(c=>/^(Hatchet|Stone Hatchet|Rock)$/.test(c.name))?.name;if(!weapon||!await equip(s,weapon))return skip('no melee weapon');
   const hits=await strike(s,tg,{swings:2,weapon});await ctx.shot(r,'hit',tg.page);
   const ev={meet:m.meet,meetDistance:m.distance,weapon,...hits};
   if(!hits.sentHits)return fail('our swings never reported a hit on the other player',ev);
   if(!hits.damage.length)return fail('the other player got no Local_HealthChange from our hits',ev);
   if(!hits.damage.every(d=>d.attacker===s.frames.characterView))return fail('the damage is not attributed to our character',ev);
   return pass(ev);
  },
  async 'combat.bow'(r){
   const s=me(),x=await supply(s,[['Hunting Bow',1],['Arrow',5]]);if(x)return unmet(x);
   const m=await meet(r,{fresh:true});if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session;
   await backOff(s,tg,6);if(!await equip(s,'Hunting Bow'))return fail('could not hold the Hunting Bow');await sleep(2000); // deployLength
   const t=Date.now(),arrows=await count(s,'Arrow');
   // BowWeaponDataBlock: hold Fire through drawLength, release to loose.
   for(let i=0;i<2;i++){await aimChest(s,tg);await s.page.mouse.down();await sleep(2400);await aimChest(s,tg);await s.page.mouse.up();await sleep(1500);}
   await sleep(1000);await ctx.shot(r,'shot',tg.page);
   const fired=s.frames.tx(t,f=>f.type==='item'&&f.action==='bow-fire').length,hit=s.frames.tx(t,f=>f.type==='item'&&f.action==='bow-hit').length;
   const dmg=damageSince(tg,t,s.frames.characterView),ev={fired,hits:hit,misses:s.frames.tx(t,f=>f.type==='item'&&f.action==='bow-miss').length,damage:dmg,arrowsBefore:arrows,arrowsAfter:await count(s,'Arrow')};
   if(!fired)return fail('drawing and releasing sent no bow-fire',ev);
   if(!hit)return fail('no arrow reported a hit on the other player',ev);
   if(!dmg.length)return fail('arrow hits but no Local_HealthChange on the other player',ev);
   return ev.arrowsAfter<arrows?pass(ev):fail('arrows were not used up (GNUP)',ev);
  },
  async 'combat.gun'(r){
   const s=me(),x=await supply(s,[['Revolver',1],['9mm Ammo',24]]);if(x)return unmet(x);
   const m=await meet(r,{fresh:true});if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session;
   await backOff(s,tg,5);if(!await equip(s,'Revolver'))return fail('could not hold the Revolver');await sleep(2000); // deployLength
   const t=Date.now();await hold(s.page,['KeyR'],250);const reload=await waitTx(s,t,f=>f.type==='item'&&f.action==='bullet-reload',4000);await sleep(2500);
   const shots=await shoot(s,tg,2);await ctx.shot(r,'shot',tg.page);
   const ev={reload:Boolean(reload),...shots};ctx.gunHits=shots.damage;
   if(!shots.fired)return fail('firing sent no bullet-fire',ev);
   if(!shots.hitRecords)return fail('no bullet reported a hit on the other player',ev);
   if(!shots.damage.length)return fail('bullet hits but no Local_HealthChange on the other player',ev);
   return shots.ammoAfter<shots.ammoBefore?pass(ev):fail('the revolver clip did not go down (GNUP)',ev);
  },
  async 'combat.armour'(r){
   const s=me(),m0=await h.targetPlayer();if(!m0)return skip(h.targetWhy());
   const kit=['Kevlar Helmet','Kevlar Vest','Kevlar Pants','Kevlar Boots'];
   const m=await meet(r,{fresh:true});if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);const tg=m.tg.session;
   if(!(await h.ensureAdmin(tg)))return skip('the target needs admin rights to be given armour (inv.give): '+h.adminWhy(tg));
   for(const k of kit){const e=await give(tg,k,1);if(e)return fail(e);}
   if(!await openInventory(tg.page))return fail('the target inventory did not open');
   const t=Date.now();
   for(const [i,k]of kit.entries()){const c=(await inventoryCells(tg.page)).find(x=>x.name===k);if(!c)continue;const tt=Date.now();await dragCell(tg.page,cellSelector(c.slot),cellSelector(36+i));await gnup(tg,tt);await sleep(300);}
   await closeInventory(tg.page);await waitRx(tg,t,rpcOn(tg,'ArmorData'));await sleep(1500);const armor=tg.frames.rx(t,rpcOn(tg,'ArmorData')).at(-1); // the totals after the last piece
   const worn=(await inventoryCells(tg.page)).filter(c=>c.slot>=36).map(c=>c.name);
   if(!(await count(s,'Revolver'))){const x=await supply(s,[['Revolver',1],['9mm Ammo',24]]);if(x)return unmet(x);}
   await backOff(s,tg,5);if(!await equip(s,'Revolver'))return fail('could not hold the Revolver');await sleep(2000);
   const tr=Date.now();await hold(s.page,['KeyR'],250);await waitTx(s,tr,f=>f.type==='item'&&f.action==='bullet-reload',4000);await sleep(2500);
   const shots=await shoot(s,tg,2);await ctx.shot(r,'armoured',tg.page);
   const base=(ctx.gunHits??[]).filter(d=>d.delta>0),now=shots.damage.filter(d=>d.delta>0),avg=a=>a.length?a.reduce((x,d)=>x+d.delta,0)/a.length:null;
   const ev={worn,armorData:decodeArmorData(armor?.values?.[0]),unarmouredPerHit:round(avg(base)),armouredPerHit:round(avg(now)),...shots};
   if(worn.length<4)return fail('the target could not wear the Kevlar set',ev);
   if(!armor)return fail('no ArmorData for the target after equipping',ev);
   if(!(ev.armorData?.[1]>0))return fail('ArmorData shows no bullet protection',ev);
   if(!now.length)return fail('no damage reached the armoured target',ev);
   if(ev.unarmouredPerHit==null)return pass(ev,'no unarmoured baseline (combat.gun did not run): armour values checked only');
   return ev.armouredPerHit<ev.unarmouredPerHit?pass(ev):fail('armour did not lower the damage per hit',ev);
  },
  async 'combat.death'(r){
   const m=await meet(r);if(m.skip||m.fail)return m.skip?skip(m.skip):fail(m.fail,m.evidence);
   const s=me(),tg=m.tg.session;
   // Fight 6 m clear of earlier loot sacks (a fresh-respawn suicide leaves one where the target stood), so the sack we
   // open is this death's.
   {const sacks=s.frames.rx(0,f=>f.type==='ngc-create'&&/;drop_lootsack$/.test(f.prefab??'')).map(f=>browserOf(f.position)),q=await feet(tg.page);
    if(sacks.some(p=>distXZ(p,q)<5)){const p=await feet(s.page),dx=q[0]-p[0],dz=q[2]-p[2],l=Math.hypot(dx,dz)||1;await walkTo(tg.page,[q[0]-dz/l*6,q[1],q[2]+dx/l*6],{within:1,ms:15000});}}
   const t=Date.now(),victimView=tg.frames.characterView,carried=(await inventoryCells(tg.page)).map(c=>c.name);
   const gun=(await count(s,'Revolver'))&&(await count(s,'9mm Ammo'));let how;
   for(let i=0;i<12&&!tg.frames.rx(t,f=>f.type==='rpc'&&/^Client_OnKilled/.test(f.name??'')).length;i++){
    if(gun){how='Revolver';if(i===0){await backOff(s,tg,5);await equip(s,'Revolver');await sleep(2000);}await shoot(s,tg,1);}
    else{how=(await inventoryCells(s.page)).find(c=>/^(Hatchet|Stone Hatchet|Rock)$/.test(c.name))?.name;if(i===0&&(!how||!await equip(s,how)))return skip('no weapon',{inventory:(await inventoryCells(s.page)).map(c=>c.name)});await strike(s,tg,{swings:1,weapon:how});}
   }
   const killed=tg.frames.rx(t,f=>f.type==='rpc'&&/^Client_OnKilled/.test(f.name??''))[0];
   const shown=await tg.page.waitForSelector('#death:not([hidden])',{timeout:cfg.replyMs}).then(()=>true,()=>false);await sleep(1200);await ctx.shot(r,'victim',tg.page);
   const ev={weapon:how,killedBy:killed?{name:killed.name,values:killed.values}:null,deathScreen:shown,reason:await tg.page.evaluate(()=>document.querySelector('#death .death-info')?.textContent?.trim()??null).catch(()=>null),carried};
   if(!killed)return fail('the other player never received Client_OnKilled*',ev);
   // DropHelper.DropInventoryContents: the body's items in a loot sack (NGC ;drop_lootsack) where it fell.
   const sack=await waitRx(s,t,f=>f.type==='ngc-create'&&/;drop_lootsack$/.test(f.prefab??''),cfg.replyMs);ev.sack=sack&&{key:ngcKey(sack),position:round3(sack.position)};
   // HumanController death: with player.backpackLockTime > 0 (the shipped server.cfg sets 30) the sack gets a TimedLockable
   // for its dead owner, so anyone else is refused ("Locked for a while...") until it runs out. Wait it out, then loot.
   if(sack){const tl=Date.now();let o=await openLoot(s,sack);const lock=await popup(s,tl,/Locked for a while/i,3000);
    if(!o.open&&lock){ev.lockedFor={popup:lock.values[0],after:Date.now()-killed.t};await sleep(Math.max(0,killed.t+(cfg.backpackLockMs??31000)-Date.now()));o=await openLoot(s,sack);ev.lockedFor.openedAfterMs=Date.now()-killed.t;}
    ev.loot=o;ev.items=await lootCells(s.page);await ctx.shot(r,'loot');
    if(ev.items.length){const before=(await inventoryCells(s.page)).length;for(const c of ev.items)if(!await takeFromLoot(s,c.slot))break;await sleep(700);ev.took=(await inventoryCells(s.page)).length-before;}
    await closeInventory(s.page);}
   const back=await respawn(tg,null);ev.respawn=back.spawned?{request:back.request,newView:back.spawned.viewId,position:round3(back.spawned.position)}:back;
   ev.victimItemsAfter=back.spawned?(await inventoryCells(tg.page)).map(c=>c.name):null;
   if(!shown)return fail('no death screen for the other player',ev);
   if(!sack)return fail('no loot sack for the dead player',ev);
   if(!ev.loot?.open)return fail('the loot sack did not open',ev);
   if(!ev.items?.length)return fail('the loot sack was empty',ev);
   if(!back.spawned)return fail('the other player could not respawn: '+back.why,ev);
   return back.spawned.viewId!==victimView?pass(ev):fail('no new character after respawn',ev);
  },
  async 'move.fall'(r){
   const s=me(),t0=Date.now(),ev={};
   // CCMotor gravity 35 m/s2: fIm needs |velocity.y| >= falldamage.min_vel 24 (8.2 m); FallImpact always injures the
   // legs past fraction 0.35 (11.9 m) and kills near max_vel 38 (20.6 m). So 13 m: admin teleports up from where we
   // stand (teleport.topos), otherwise the nearest terrain edge with a 12 m drop is walked to and stepped off.
   // Away from the run's bases first: a teleport up over one lands on its roof after a few metres (−18.7 m/s, no damage).
   await clearOf(s,[ctx.base?.foundation,ctx.lone?.foundation].filter(Boolean).map(f=>browserOf(f.position)),20);
   const here=await feet(s.page);
   if(await h.ensureAdmin(s)){const u=toUnity(here);ev.how='teleport.topos';await consoleCommand(s,`teleport.topos "${ctx.me.name}" ${u[0].toFixed(1)} ${(u[1]+13).toFixed(1)} ${u[2].toFixed(1)}`,{ms:cfg.replyMs});}
   else{
    if(!await has(s,'cliff'))return skip('needs admin rights (teleport.topos) or '+OLD_BUILD('cliff'));
    // 400 m found no 12-18 m drop near any of today's real-run spawn points (offline check against the recovered
    // heightmap); 800 m found one for 4 of 5, 1200 m for all 5 (closest 424 m, farthest 902 m) - widened so this row
    // can actually run without rcon most of the time, not skip every run.
    const cliff=await s.page.evaluate(([r,drop])=>window.explorerDev.cliff(r,drop,18),[cfg.cliffRadius??1200,12]);
    if(!cliff)return skip(`needs admin rights (teleport.topos) or a 12-18 m terrain drop within ${cfg.cliffRadius??1200} m: `+h.adminWhy(s));
    // walkTo alone (a straight line, minor obstacle handling) isn't enough over the 400-900 m the wider radius now
    // needs: a real run got stuck 68 of 200 steps on open terrain. walkToMeet re-plans round what it gets stuck on,
    // same as the two-player meet() walk; the cliff point doesn't move, so its target getter just returns it.
    ev.how='cliff';ev.cliff=cliff;let target=cliff,w=await walkToMeet(s.page,()=>target.top,{within:1,ms:cfg.cliffWalkMs??null});ev.walk=w;
    // Crossing 400-1200 m of open ground now runs into the island's own hazards (wildlife killed a walker 60 m from a
    // cliff, 2026-10-29) that cliffRadius's own widening made more likely, not a pathing bug: walkToMeet already
    // stops cleanly on death with the real reason in w.why. One bounded retry from the fresh spawn, not a loop.
    if(w.died){
     const back=await respawn(s,null);ev.respawn=back.spawned?{position:round3(back.spawned.position)}:back;
     if(!back.spawned)return fail('died on the way to the cliff and could not respawn: '+w.why,ev);
     const cliff2=await s.page.evaluate(([r,drop])=>window.explorerDev.cliff(r,drop,18),[cfg.cliffRadius??1200,12]);
     if(!cliff2)return fail('died on the way, respawned, but no cliff within range from the new spawn: '+w.why,ev);
     target=cliff2;ev.cliff2=cliff2;w=await walkToMeet(s.page,()=>target.top,{within:1,ms:cfg.cliffWalkMs??null});ev.walk2=w;
     if(w.died)return fail('died again on the retry walk: '+w.why,ev);
    }
    if(!w.arrived)return fail('could not reach the cliff top',ev);
    await aimAt(s.page,[target.below[0],target.top[1]+1,target.below[2]]);await hold(s.page,['KeyW'],1500);
   }
   const fim=await waitTx(s,t0,f=>f.type==='rpc'&&f.name==='fIm',20000);
   const hurt=fim&&await waitRx(s,fim.t,rpcOn(s,'Local_HealthChange'),cfg.replyMs),leg=fim&&await waitRx(s,fim.t,rpcOn(s,'fIo'),cfg.replyMs);
   await sleep(1000);await ctx.shot(r,'landed');
   Object.assign(ev,{fIm:fim?.values??null,health:hurt?.values?.[0]??null,legInjury:leg?.values?.[0]??null,bleed:fim?s.frames.rx(fim.t,rpcOn(s,'Local_BleedChange')).map(f=>f.values?.[0]):null,
    page:await s.page.evaluate(()=>({injured:window.explorerState?.player?.legInjury??null,lastFall:window.explorerState?.player?.lastFall??null}))});
   if(!fim)return fail('the landing sent no fIm (no fall over 18 m/s?)',ev);
   if(!hurt&&Math.abs(fim.values?.[0]?.[1]??0)<24)return fail(`landed on something: fIm ${round(fim.values?.[0]?.[1]??0)} m/s is under falldamage.min_vel 24, so no damage is correct`,ev);
   if(!hurt)return fail('fIm sent but no Local_HealthChange from the server',ev);
   if(leg==null)return pass(ev,'damage applied; this fall rolled no leg injury (FallImpact: random unless fraction > 0.35)');
   return pass(ev);
  },
  async 'deploy.sleepingbag'(r){
   const s=me(),x=await supply(s,[['Sleeping Bag',1]]);if(x)return unmet(x);
   const bag=await deploy(s,'Sleeping Bag',/;deploy_camp_sleepingbag$/);if(!bag.made){await ctx.shot(r,'not-placed');return fail('sleeping bag not created',bag);}
   // Die away from the bag so a random spawn could not be mistaken for the camp spawn.
   await walkTo(s.page,(await feet(s.page)).map((v,i)=>i===0?v+25:v),{within:3,ms:20000});
   const back=await respawn(s,'suicide',{camp:true});await ctx.shot(r,'respawned');
   const at=back.spawned?.position??null,d=at?distXZ(at,bag.made.position):null;
   const ev={bag:ngcKey(bag.made),bagAt:round3(bag.made.position),request:back.request??null,spawnAt:round3(at),distance:round(d)};
   if(!back.spawned)return fail('no respawn at camp: '+back.why,ev);
   if(back.request?.[0]!==true)return fail('RequestRespawn was not sent with campRequest true',ev);
   return d<5?pass(ev):fail('respawned away from the sleeping bag',ev);
  },
  async 'net.loss'(r){
   const s=me(),page=s.page,t=Date.now(),ev={};
   // 1) 150 ms +-150 ms jitter both ways while walking: moves accepted, no TruthDetector corrections or kicks.
   await shapeNet(page,{delayMs:150,jitterMs:150});await lockPointer(page);const start=await feet(page);
   await hold(page,['KeyW'],3000);await hold(page,['KeyS'],3000);await sleep(1500);
   ev.latency={corrections:s.frames.corrections(t).length,moved:round(distXZ(await feet(page),start)),open:s.socketOpen()};
   // 2) a 5 s stall (nothing either way), then everything delivered at once.
   const t2=Date.now();await shapeNet(page,{hold:true});await hold(page,['KeyW'],2000);await sleep(3000);await shapeNet(page,{release:true});await shapeNet(page,{delayMs:0,jitterMs:0});await sleep(3000);
   const c=await h.consoleCommand(s,'findsv chat',{match:/^Finding chat/,ms:cfg.replyMs});
   ev.stall={corrections:s.frames.corrections(t2).length,open:s.socketOpen(),replyAfter:Boolean(c.reply)};
   // 3) the connection drops: the page shows the disconnect, the website join puts us back at the sleeper.
   const last=toUnity(await feet(page)),t3=Date.now();await shapeNet(page,{drop:true});
   const menu=await page.waitForFunction(()=>!window.rlbFrontEnd||window.rlbFrontEnd.state().menu||window.explorerState?.online?.state!=='in-game',{},{timeout:15000}).then(()=>true,()=>false);
   await sleep(1500);await ctx.shot(r,'dropped');ev.drop={closed:!s.socketOpen(),menu,notices:await page.evaluate(()=>window.rlbFrontEnd?.state()?.notices??null).catch(()=>null)};
   await page.goto(ctx.origin+'/',{waitUntil:'load'});await sleep(3000);
   let j=null;try{j=await h.joinRetrying(s);h.afterRejoin(j);}catch(e){ev.rejoinError=e.message.split('\n')[0];}
   if(j){await lockPointer(page);await ctx.shot(r,'rejoined');ev.rejoin={ms:j.inGameMs,distance:round(distXZ(j.spawned.position,last)),attempts:j.attempts.length};}
   ev.lostMs=j?Date.now()-t3:null;
   if(ev.latency.corrections||!ev.latency.open)return fail('latency and jitter caused corrections or a disconnect',ev);
   if(ev.latency.moved<0.5)return fail('could not move under latency',ev);
   if(!ev.stall.open||!ev.stall.replyAfter)return fail('the session did not survive a 5 s stall',ev);
   if(!ev.drop.closed)return fail('the dropped socket stayed open',ev);
   if(!j)return fail('could not rejoin after the drop',ev);
   return ev.rejoin.distance<3?pass(ev):fail('rejoined away from where the connection dropped',ev);
  },
 };
 // The row helpers for other row sets (tools/native/anticheat-rows.mjs); not enumerable, so not a row of RUN.
 Object.defineProperty(rows,'helpers',{value:{supply,unmet,equip,place,placement,leaveZones,clearOf,placeFoundation,gatherWood,meet,respawn,use,openLoot,heldNow,count,give,has,centre,ngcKey,waitRx,waitTx,rpcOn,health,around,browserOf,OLD_BUILD}});
 return rows;

 // ---- row bodies shared by several rows ---------------------------------------------------------------------------
 async function craft(s,name,{cancel}){
  const t=Date.now(),ev={item:name};
  if(!await openInventory(s.page))return {...ev,why:'inventory did not open'};
  const ok=await s.page.evaluate(n=>{const b=[...document.querySelectorAll('#blueprint-list [data-blueprint]')].find(x=>x.textContent.trim()===n);if(!b)return false;b.click();return true;},name);
  if(!ok){await closeInventory(s.page);return {...ev,why:`no ${name} blueprint in the craft list`};}
  await s.page.waitForFunction(()=>!document.querySelector('#craft').disabled,{},{timeout:5000}).catch(()=>{});
  await s.page.locator('#craft').click();
  const sent=await waitTx(s,t,f=>f.type==='inventory'&&f.action==='craft',3000),started=await waitRx(s,t,rpcOn(s,'CRFU'));ev.sent=Boolean(sent);ev.progress=started?.values?.slice(1,6)??null;
  if(!started){await closeInventory(s.page);return ev;}
  ev.button=await s.page.locator('#craft').textContent();
  if(cancel){await sleep(1500);const tc=Date.now();await s.page.locator('#craft').click();ev.cancelSent=Boolean(await waitTx(s,tc,f=>f.type==='inventory'&&f.action==='cancel-craft',3000));const cleared=await waitRx(s,tc,rpcOn(s,'CRFC'));ev.cleared=Boolean(cleared);ev.done=false;}
  else{const dur=(Number(started.values?.[1])||20)*1000;const cleared=await waitRx(s,t,rpcOn(s,'CRFC'),dur+cfg.replyMs);ev.cleared=Boolean(cleared);ev.done=Boolean(cleared);ev.craftMs=cleared?cleared.t-started.t:null;await sleep(800);}
  ev.gnups=s.frames.rx(t,rpcOn(s,'GNUP')).length;await closeInventory(s.page);return ev;
 }
 async function craftRow(r,{cancel}){
  const s=me(),x=await supply(s,[['Wood',5]],{survival:true});if(x)return unmet(x);
  const wood=await count(s,'Wood'),fires=await count(s,'Camp Fire'),c=await craft(s,'Camp Fire',{cancel});await ctx.shot(r,cancel?'cancelled':'crafted');
  const ev={...c,woodBefore:wood,woodAfter:await count(s,'Wood'),campFiresBefore:fires,campFiresAfter:await count(s,'Camp Fire')};
  if(c.why)return fail(c.why,ev);
  if(!c.sent)return fail('the Craft button sent nothing',ev);
  if(!c.progress)return fail('no CRFU from the server after CRFS',ev);
  if(cancel){if(!c.cancelSent)return fail('Cancel sent no CRFX',ev);if(!c.cleared)return fail('no CRFC after cancelling',ev);return ev.woodAfter===wood&&ev.campFiresAfter===fires?pass(ev):fail('a cancelled craft changed the inventory',ev);}
  if(!c.cleared)return fail('the craft never finished (no CRFC)',ev);
  if(ev.campFiresAfter!==fires+1)return fail('no Camp Fire added when the craft finished',ev);
  return ev.woodAfter===wood-5?pass(ev):fail('the craft did not use exactly 5 Wood',ev);
 }
 // Deployable placement: hold it, look at the ground a few metres ahead (eight headings), Fire.
 async function deploy(s,item,prefab){
  await leaveZones(s);const avoid=[ctx.base,ctx.lone].filter(Boolean).map(b=>browserOf(b.foundation.position));await clearOf(s,avoid,12);
  if(!await equip(s,item))return {made:null,why:`could not hold ${item}`};
  const p=await feet(s.page),cands=[];for(const d of [2.5,3,2])for(const c of around(p,d,-0.2))if(avoid.every(a=>distXZ(c,a)>6))cands.push(c);
  return place(s,{prefab,candidates:cands});
 }
 // Opens a lootable entity (E): SetLooter to us and its GNUP, then the RPOS loot window.
 async function openLoot(s,f,{option=null}={}){
  const t=Date.now(),u=await use(s,f,{option,d:1.4});
  const call=(x,name)=>(x.type==='ngc-call'||x.type==='rpc')&&x.name===name&&sameTarget(x,f);
  const looter=await waitRx(s,t,x=>call(x,'SetLooter')),inv=await waitRx(s,t,x=>call(x,'GNUP'));
  const open=await s.page.waitForFunction(()=>Boolean(document.querySelector('#inventory')?.open&&!document.querySelector('#loot-panel')?.hidden),{},{timeout:5000}).then(()=>true,()=>false);
  // Everything the server said about this entity since the use (to tell a missing SetLooter from a missing window).
  const calls=open?undefined:s.frames.rx(t,x=>(x.type==='ngc-call'||x.type==='rpc-undecoded'||(f.useKey&&x.type==='rpc'))&&(f.useKey?x.viewId===f.viewId:x.carrier==null||sameTarget(x,f))).map(x=>[x.type,x.name,x.values]).slice(0,12);
  return {t,context:u,setLooter:Boolean(looter),gnup:Boolean(inv),open,calls};
 }
 // Camp fire / furnace: fuel and something to cook in, ignite from the menu, then watch the server's GNUPs.
 async function fireRow(r,s,f,{fuel,cook,crafted=false}){
  const key=ngcKey(f),ev={entity:key,crafted};
  const o=await openLoot(s,f,{option:'Open'});ev.open=o;
  if(!o.open){const o2=await openLoot(s,f);ev.open2=o2;if(!o2.open)return fail('could not open it (no SetLooter/GNUP)',ev);}
  // FireBarrel layout: 0-2 cooked, 3-5 raw, 6 fuel, 7 by-product.
  const fuelCell=(await inventoryCells(s.page)).find(c=>c.name===fuel);if(!fuelCell)return fail('no '+fuel+' to burn',ev);await dragToLoot(s,fuelCell.slot,6);
  const raw=(await inventoryCells(s.page)).find(c=>c.name===cook[0]);if(raw)await dragToLoot(s,raw.slot,3);ev.cooking=raw?cook[0]:null;
  ev.loaded=await lootCells(s.page);await closeInventory(s.page);await sleep(600);
  const t=Date.now();ev.ignite=await use(s,f,{option:'Ignite'});const on=await waitRx(s,t,x=>x.type==='ngc-call'&&x.name==='ReceiveNetState'&&ngcKey(x)===key&&x.values?.[0]===true);
  ev.lit=Boolean(on);await sleep(1500);await ctx.shot(r,'lit');
  if(!on)return fail('igniting sent no ReceiveNetState(true)',ev);
  // FireBarrel.ConsumeFuel every cook duration: one Wood burnt, Charcoal by-product, raw -> cooked. Look while looting.
  const deadline=Date.now()+(cfg.cookMs??75000);let cells=[];
  const op=await openLoot(s,f,{option:'Open'});ev.reopen=op;
  while(Date.now()<deadline){cells=await lootCells(s.page);if(cells.some(c=>cook[1].test(c.name))||(!raw&&cells.some(c=>c.name==='Charcoal')))break;await sleep(2000);}
  ev.after=cells;await ctx.shot(r,'after');await closeInventory(s.page);
  const charcoal=cells.some(c=>c.name==='Charcoal'),cooked=cells.some(c=>cook[1].test(c.name)),burnt=(cells.find(c=>c.slot===6)?.count??0)<(ev.loaded.find(c=>c.slot===6)?.count??0);
  Object.assign(ev,{charcoal,cooked,fuelBurnt:burnt});
  // Put it out again so the run does not leave a fire burning.
  const te=Date.now();await use(s,f,{option:'Extinguish'});ev.extinguished=Boolean(await waitRx(s,te,x=>x.type==='ngc-call'&&x.name==='ReceiveNetState'&&ngcKey(x)===key&&x.values?.[0]===false,5000));
  if(!charcoal&&!burnt)return fail('the fire burnt no fuel (no Charcoal, Wood unchanged)',ev);
  if(raw&&!cooked)return fail(`${cook[0]} did not turn into ${cook[1].source.replace(/[\^$]/g,'')}`,ev);
  return pass(ev,raw?null:'no raw meat (it needs admin rights or a hunt): fuel burning checked only');
 }
 // ---- combat helpers -------------------------------------------------------------------------------------------------
 async function chest(tg){const q=await feet(tg.page);return [q[0],q[1]+1.25,q[2]];}
 async function aimChest(s,tg){return aimAt(s.page,await chest(tg));}
 // Health changes on the victim caused by `attacker` (Local_HealthChange(health, attacker view)) since t, with deltas.
 function damageSince(tg,t,attacker){const all=tg.frames.rx(0,rpcOn(tg,'Local_HealthChange'));const out=[];
  for(let i=0;i<all.length;i++){const f=all[i];if(f.t<t||f.values?.[1]!==attacker)continue;const prev=all[i-1]?.values?.[0]??100;out.push({health:round(f.values[0]),delta:round(prev-f.values[0]),attacker:f.values[1]});}return out;}
 async function backOff(s,tg,d){const p=await feet(s.page),q=await feet(tg.page),dx=p[0]-q[0],dz=p[2]-q[2],l=Math.hypot(dx,dz)||1;if(l>=d-0.5)return;
  await aimAt(s.page,[q[0],p[1]+1.5,q[2]]);await hold(s.page,['KeyS'],Math.min(2500,(d-l)*350));await sleep(300);}
 async function strike(s,tg,{swings}){
  const t=Date.now();
  for(let i=0;i<swings;i++){const q=await feet(tg.page);await walkTo(s.page,q,{within:1.3,ms:6000});await aimChest(s,tg);await click(s.page);await sleep(2100);}
  await sleep(800);
  return {swings,sentHits:s.frames.tx(t,f=>f.type==='item'&&f.action==='melee-hit'&&f.data?.target).length,damage:damageSince(tg,t,s.frames.characterView),
   bleed:tg.frames.rx(t,rpcOn(tg,'Local_BleedChange')).map(f=>round(f.values?.[0])).slice(0,4),targetHealth:round(health(tg))};
 }
 async function shoot(s,tg,n){
  const t=Date.now(),clip=async()=>{const c=(await inventoryCells(s.page)).find(x=>x.name==='Revolver');return c?.count??null;},before=await clip();
  // Until n bullets report a hit on the target (a step or a re-equip can spoil one), at most 2n+2 shots.
  const hitsSoFar=()=>s.frames.tx(t,f=>f.type==='item'&&f.action==='bullet-fire').flatMap(f=>f.data?.hits??[]).filter(x=>x.target).length;
  // A clear line first: if the eye ray meets something else (a tree, a wall), step towards the target and look again.
  const clear=async()=>{for(let k=0;k<4;k++){await aimChest(s,tg);await sleep(150);const b=(await s.page.evaluate(()=>window.explorerDev.aim(30).ray))?.body??'';if(/^Player hit/.test(b))return true;await walkTo(s.page,await feet(tg.page),{within:Math.max(2,4-k),ms:6000});}return false;};
  for(let i=0;i<2*n+2&&hitsSoFar()<n;i++){await clear();await sleep(250);await click(s.page,60);await sleep(1100);if(i>=n&&(await clip())===0){await hold(s.page,['KeyR'],250);await sleep(2500);}}
  await aimChest(s,tg);const ray=await s.page.evaluate(v=>({aim:window.explorerDev.aim(30).ray,hitboxes:window.explorerDev.onlineHitboxCount(),player:window.explorerDev.onlinePlayers().find(p=>p.viewId===v)??null}),tg.frames.characterView).catch(e=>String(e));
  await sleep(1200);const fired=s.frames.tx(t,f=>f.type==='item'&&f.action==='bullet-fire');
  return {ray,fired:fired.length,hitRecords:fired.flatMap(f=>f.data?.hits??[]).filter(x=>x.target).length,parts:fired.flatMap(f=>f.data?.hits??[]).map(x=>x.part),damage:damageSince(tg,t,s.frames.characterView),
   bleed:tg.frames.rx(t,rpcOn(tg,'Local_BleedChange')).map(f=>round(f.values?.[0])).slice(0,4),ammoBefore:before,ammoAfter:await clip(),targetHealth:round(health(tg))};
 }
}
