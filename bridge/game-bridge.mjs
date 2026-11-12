// Translates one native uLink session into browser events and whitelisted browser commands into native messages
// (HANDOFF queue item 6; GAMEPLAY-PROTOCOL.md). Server→browser: Create/Destroy, decoded RPCs, NGC entities.
// Browser→server: ready, move (rate-limited, timestamped, parity bits) and to-server RPCs from the schema only.
// Verified against bridge/ulink/mock-server.mjs; never against the original server.
import {EventEmitter} from 'node:events';
import {INTERNAL,widenTimestamp} from './ulink/ulink.mjs';
import {readCreate,readArgs,readNgcInstantiate,readNgcCall,writeNgcCall,ngcAction,MoveParity,encodeAngles,writeArgs,ITEM_ACTIONS} from './ulink/rust.mjs';
import {BitReader,BitWriter} from './ulink/bits.mjs';
import {validateVoice,decodeBase64,VoiceBudget,MAX_FRAMES_PER_MESSAGE} from './voice.mjs';

const SERVER_MANAGEMENT=/(^|\/)ServerManagement$/i,NGC_CARRIER='!Ng',CHARACTER=':player_soldier';
// Move stamps (moveStamp): kept this far behind our estimate of the server clock (sync error headroom), and a squeezed
// gap keeps the step under this speed (m/s; TruthDetector flags above 20).
const STAMP_MARGIN_MS=15n,SAFE_SPEED=10;
// A browser `at` gap is never taken as longer than the gateway's own time between the moves plus this slack, at most
// MAX_QUEUED_MOVES wait (oldest dropped), each re-checked within MAX_MOVE_WAIT_MS: a far-future `at` once overflowed
// setTimeout (> 2^31-1 ms: a 1 ms spin) and held every later move in the queue.
const AT_SLACK_MS=1000,MAX_QUEUED_MOVES=32,MAX_MOVE_WAIT_MS=1000;
// Scene views with manual IDs (server scene uLinkNetworkView._manualViewID). The scene doors (3–62, the scene export
// doors[i].viewID) are added by the caller through `sceneDoors`: they are never Created, yet Context:A targets them.
export const SCENE_VIEWS={996:'ECC',997:'CONSOLE',998:'CONTEXT'};
export const SCENE_DOOR='SCENE_DOOR';
const MANUAL_VIEW_IDS=1000; // scene manual view IDs seen: 3–62 (doors), 996–998
const SCENE_CLASSES={ECC:'EnvironmentControlCenter',CONSOLE:'ConsoleNetworker',CONTEXT:'Context'};
// The native code calls these classes' RPCs as "Class:Method" (grep RPC("Context:…", "Controllable:…", "VoiceCom:…").
const PREFIXED=new Set(['Context','Controllable','VoiceCom']);
const DESTROY={[INTERNAL.DestroyByViewID]:'view',[INTERNAL.DestroyByPlayerID]:'player',[INTERNAL.DestroyAll]:'all',[INTERNAL.DestroyInGroup]:'group',[INTERNAL.DestroyInGroupByPlayerID]:'group-player'};

export class GameBridge extends EventEmitter{
 constructor({client,schema,ngcRegistry={prefabs:[]},sceneDoors=[],playerName,sendRate=5,now=()=>performance.now()/1000}){
  super();Object.assign(this,{client,schema,playerName,now});
  this.views=new Map(Object.entries(SCENE_VIEWS).map(([id,name])=>[Number(id),{prefab:name,owner:0,group:0,scene:true,class:SCENE_CLASSES[name]}]));
  for(const id of sceneDoors)if(Number.isInteger(id)&&id>0&&!this.views.has(id))this.views.set(id,{prefab:SCENE_DOOR,owner:0,group:0,scene:true,class:'BasicDoor'});
  this.ngc=new Map();this.parity=new MoveParity(playerName);
  this.sendInterval=1/Math.max(1,sendRate);this.lastMove=-Infinity;this.lastMoveAt=-Infinity;this.moveQueue=[];this.moveTimer=null;
  this.prefabByIndex=new Map(ngcRegistry.prefabs.map(p=>[p.index,p]));
  this.toServer=new Map(Object.entries(schema).map(([name,handlers])=>[name,handlers.filter(h=>h.direction==='to-server'||h.direction==='both')]).filter(([,h])=>h.length));
  this.voiceBudget=new VoiceBudget({now});
  this.nextReclock=now()+8; // PlayerClient: first auto resync after 8 s, then every 420 s
  client.on('ulink',(h,b)=>this.onUlink(h,b));
 }
 tick(){if(this.now()>=this.nextReclock){this.nextReclock=this.now()+420;this.client.resyncClock(3);}}

 onUlink(header,body){
  if(header.internal===INTERNAL.Create&&header.viewId!==undefined){
   const c=readCreate(body),mine=c.owner===this.client.playerId,prefab=mine?c.ownerPrefab:c.proxyPrefab;
   this.views.set(header.viewId,{prefab,owner:c.owner,group:c.group});
   // info.timestamp on the Instantiate itself (RigidObj.uLink_OnNetworkInstantiate reads it as spawnTime): same header
   // timestamp bits as an RPC's, widened the same way, so a late Create can be told from one that is still in flight.
   const serverMs=this.client.serverMs?.(),stamp=serverMs!=null&&header.timestampBits?{timestampMs:Number(widenTimestamp(serverMs,header.timestampLow,header.timestampBits)),serverMs:Number(serverMs)}:{};
   return this.emit('event',{type:'create',viewId:header.viewId,prefab,owner:c.owner,mine,group:c.group,position:c.position,rotation:c.rotation,initialData:c.initialData,...stamp});
  }
  if(header.internal in DESTROY){
   const kind=DESTROY[header.internal],detail=kind==='view'?{viewId:header.viewId}:kind==='player'?{player:body.u16()}:kind==='group'?{group:body.u16()}:kind==='group-player'?{player:body.u16(),group:body.u16()}:{};
   const removed=[];
   for(const [id,v]of this.views){const remove=kind==='view'?id===detail.viewId:kind==='player'?v.owner===detail.player:kind==='group'?v.group===detail.group:kind==='group-player'?v.group===detail.group&&v.owner===detail.player:!v.scene;if(remove){this.views.delete(id);removed.push(id);}}
   for(const [key,n]of this.ngc)if(!this.views.has(n.carrier))this.ngc.delete(key);
   // views: the IDs a player/group destroy removed (DestroyByPlayerID on a disconnect, DestroyInGroup on a cell change), for
   // the gateway's anti-cheat; the gateway strips them before relaying (the page works them out from its own views).
   return this.emit('event',{type:'destroy',kind,...detail,...(kind!=='view'&&kind!=='all'?{views:removed}:{})});
  }
  if(header.internal===INTERNAL.ChangeGroup){const viewId=body.u16(),group=body.u16(),v=this.views.get(viewId);if(v)v.group=group;return this.emit('event',{type:'group-change',viewId,group});}
  if(header.rpc!==undefined)return this.onRpc(header,body);
  this.emit('event',{type:'internal',internal:header.internal,viewId:header.viewId});
 }

 onRpc(header,body){
  const view=this.views.get(header.viewId),prefab=view?.prefab;
  // uLink drops an RPC whose NetworkView it cannot find ("RPC can't find NetworkView with ", client-ulink.il.txt).
  // Scene views are never Created but exist in the original client's scene: manual IDs (doors 3–62, 996–998) are kept
  // even when the caller passed no scene door list. Counted by the gateway (metrics), never relayed.
  if(!view&&!(header.viewId<MANUAL_VIEW_IDS)){this.emit('dropped','rpc');return;}
  // The server names buffered carrier RPCs per entity ("A1f", "C1f_3"); the client dispatches on the first character.
  if(prefab===NGC_CARRIER&&ngcAction(header.rpc))return this.onNgc(ngcAction(header.rpc),header,body);
  // RS: the server's NetCull.VerifyRPC found late moves (bridge/stall-watch.mjs counts them; never sent to the browser).
  if(header.rpc==='RS'&&prefab&&SERVER_MANAGEMENT.test(prefab)){const [d]=readArgs(['float'],body,header.typeSafe);this.client.resyncClock(d);this.emit('clock-resync',d);return;}
  const [cls,method]=header.rpc.includes(':')?header.rpc.split(':',2):[null,header.rpc];
  const handlers=(this.schema[method]??[]).filter(h=>h.direction!=='to-server'&&(!cls||h.class===cls));
  const args=this.decode(handlers,body,header.typeSafe);
  // info.timestamp (the header's truncated server time, widened against the synchronised clock) and the server clock
  // now, so the browser can place interpolated snapshots and timed events (e.g. SupplyCrate.Landed) on its own clock.
  const serverMs=this.client.serverMs?.(),stamp=serverMs!=null&&header.timestampBits?{timestampMs:Number(widenTimestamp(serverMs,header.timestampLow,header.timestampBits)),serverMs:Number(serverMs)}:{};
  this.emit('event',args?{type:'rpc',viewId:header.viewId,prefab,name:method,args,...stamp}:{type:'rpc-undecoded',viewId:header.viewId,prefab,name:header.rpc});
 }
 // Several classes share short RPC names; accept the handler whose parameter list consumes the body exactly.
 decode(handlers,body,typeSafe=false){
  for(const h of handlers){
   const r=new BitReader(body.bytes,body.end,body.pos);
   try{const args=readArgs(h.params,r,typeSafe);if(r.remainingBytes===0)return {class:h.class,values:args};}catch{}
  }
  return null;
 }
 // NGC calls to handlers without NetworkMessageInfo (e.g. BasicDoor.DOo) arrive type-safe (header 0x80, code 135 before
 // the byte[] length) and without a timestamp: NGC.ShootRPC passes explicit NetworkFlags, so uLink never adds TypeUnsafe.
 // A carrier body that does not decode names the call and shows its bytes (gateway log), so it can be compared with NGC.cs.
 onNgc(action,header,body){
  const at=new BitReader(body.bytes,body.end,body.pos);
  try{return this.ngcAction(action,header,body);}
  catch(error){const n=Math.min(48,at.remainingBytes),hex=Buffer.from(at.raw(n)).toString('hex');
   throw new RangeError(`${error.message} in ${header.rpc} on view ${header.viewId} (flags ${header.flags}${header.buffered?', buffered':''}, ${at.remainingBits} bits: ${hex}${n<at.remainingBytes?'…':''})`);}
 }
 ngcAction(action,header,body){
  if(action==='A'){
   const n=readNgcInstantiate(readArgs(['byte[]'],body,header.typeSafe)[0]),prefab=this.prefabByIndex.get(n.prefabIndex);
   const key=header.viewId+':'+n.innerID;this.ngc.set(key,{prefab,carrier:header.viewId,innerID:n.innerID});
   return this.emit('event',{type:'ngc-create',carrier:header.viewId,innerID:n.innerID,prefab:prefab?.handle??null,prefabIndex:n.prefabIndex,position:n.position,euler:n.euler,initialData:n.initialData});
  }
  if(action==='D'){const [id]=readArgs(['ushort'],body,header.typeSafe);this.ngc.delete(header.viewId+':'+id);return this.emit('event',{type:'ngc-destroy',carrier:header.viewId,innerID:id});}
  const c=readNgcCall(readArgs(['byte[]'],body,header.typeSafe)[0]),entity=this.ngc.get(header.viewId+':'+c.innerID),message=entity?.prefab?.messages?.[c.messageID];
  // NGC.C: Procedure.Call fails for an entity that does not exist ("Did not call rpc to non existant view#"): dropped.
  if(!entity){this.emit('dropped','ngc');return;}
  let args=null;
  if(message){const r=new BitReader(c.args);try{args=readArgs(message.params,r);if(r.remainingBytes)args=null;}catch{args=null;}}
  // serverMs lets the browser place server timestamps (e.g. BasicDoor.DOo) on its own clock.
  this.emit('event',{type:'ngc-call',carrier:header.viewId,innerID:c.innerID,messageID:c.messageID,name:message?.name??null,args,raw:args?undefined:c.args,serverMs:this.client.serverMs?.()});
 }

 // ---- browser commands ----
 command(cmd){
  switch(cmd?.type){
   case 'ready':{const sm=this.find(v=>SERVER_MANAGEMENT.test(v.prefab));if(sm===undefined)return this.reject('no-server-management');this.client.sendRpc({viewId:sm,name:'ClientFirstReady'});return true;}
   case 'move':return this.move(cmd);
   case 'rpc':return this.rpc(cmd);
   case 'context':return this.context(cmd);
   case 'item':return this.item(cmd);
   case 'inventory':return this.inventory(cmd);
   case 'voice':return this.voice(cmd);
   default:return this.reject('unknown-command');
  }
 }
 // `at`: the browser's own clock (ms) when it made the move. The original server's TruthDetector divides each move's
 // distance by the gap between move timestamps (> 20 m/s adds violations, > 400 kicks), and the original client stamps
 // a move when it makes it. Stamping at forward time turned moves a hitching tab delivers together into "speeding".
 move({origin,angles,stateFlags=0,at}){
  const view=this.find(v=>v.prefab===CHARACTER&&v.owner===this.client.playerId);
  if(view===undefined)return this.reject('no-character');
  if(!isVec(origin)||!Number.isFinite(angles?.pitch)||!Number.isFinite(angles?.yaw)||!Number.isInteger(stateFlags)||stateFlags<0||stateFlags>0xffff)return this.reject('bad-move');
  const t=this.now(),clock=Number.isFinite(at)&&at>=0&&at<=Number.MAX_SAFE_INTEGER;
  // The browser's clock may space moves only as far apart as they really were here, plus slack for bunched arrival.
  if(clock&&this.lastMoveAt>-Infinity){const limit=this.lastMoveAt+(t-this.lastClockMove)*1000+AT_SLACK_MS;if(at>limit){at=limit;this.clampedMoves=(this.clampedMoves??0)+1;}}
  // NetClockTester spacing, on the sender's clock when it gave one (bunched arrivals keep their real spacing).
  if(clock?at-this.lastMoveAt<this.sendInterval*900:t-this.lastMove<this.sendInterval*0.9)return this.reject('too-frequent');
  this.lastMove=t;if(clock){this.lastMoveAt=at;this.lastClockMove=t;}
  const rpc={viewId:view,name:'GetClientMove',types:['Vector3','int','ushort'],args:[origin,encodeAngles(angles),this.parity.apply(stateFlags)],timestamp:clock?this.moveStamp(at,origin):true};
  if(clock){if(this.moveQueue.length>=MAX_QUEUED_MOVES){this.moveQueue.shift();this.droppedMoves=(this.droppedMoves??0)+1;}this.moveQueue.push(rpc);this.sendMoves();}else this.client.sendRpc(rpc);
  return true;
 }
 // The browser's move clock mapped onto server time, for the original server's TruthDetector, which adds distance/gap
 // between move stamps to a violation counter (> 20 m/s; kick > 400). Two receiver rules shape it:
 //  - GetClientMove acts on none of NetClockTester's flags; it only drops a stamp at or before the last one. A 1 ms gap
 //    on a 0.45 m step adds 450 and kicks.
 //  - uLink widens the 16-bit stamp against the server clock (O457.O1530, widenTimestamp): a stamp up to 1 s ahead of the
 //    server's now becomes the arrival time, so moves that arrive together lose their spacing. Never send one ahead.
 // So each stamp is the previous one plus the browser's own gap. When that is ahead of the server clock (the anchoring
 // first move arrived late), the gap may shrink only while the step stays under 10 m/s (and to no less than half), and a
 // stamp still ahead waits in moveQueue until the server clock reaches it. Stamps behind now stay there, as the original
 // client's do after a network delay.
 moveStamp(at,origin){
  const now=this.client.serverMs()-STAMP_MARGIN_MS,ms=BigInt(Math.round(at));
  let stamp=now;
  if(this.lastStamp!==undefined){
   const gap=ms-this.lastStampAt,step=Math.hypot(...origin.map((v,i)=>v-this.lastStampOrigin[i]));
   const fast=BigInt(Math.ceil(step*1000/SAFE_SPEED)),half=gap/2n,shortest=gap<(fast>half?fast:half)?gap:(fast>half?fast:half);
   stamp=this.lastStamp+gap;
   if(stamp>now)stamp=this.lastStamp+shortest>now?this.lastStamp+shortest:now;
   if(stamp<=this.lastStamp)stamp=this.lastStamp+1n;
  }
  this.lastStamp=stamp;this.lastStampAt=ms;this.lastStampOrigin=origin;return stamp;
 }
 // Sends queued moves whose stamp the server clock has reached, in order; waits for the head one otherwise.
 sendMoves(){
  clearTimeout(this.moveTimer);this.moveTimer=null;
  while(this.moveQueue.length&&!this.disposed){
   const wait=this.moveQueue[0].timestamp-(this.client.serverMs()-STAMP_MARGIN_MS);
   if(wait>0n){this.moveTimer=setTimeout(()=>this.sendMoves(),Math.min(Number(wait),MAX_MOVE_WAIT_MS));this.moveTimer.unref?.();return;}
   this.client.sendRpc(this.moveQueue.shift());
  }
 }
 dispose(){this.disposed=true;clearTimeout(this.moveTimer);this.moveQueue.length=0;}
 // Item actions on the player's own held-item representation view (ItemRepresentation Action*/Action*B).
 item({viewId,action,data}){
  if(data==null)data={};else if(typeof data!=='object')return this.reject('bad-item-data');
  const view=this.views.get(viewId),build=Object.hasOwn(ITEM_ACTIONS,action)?ITEM_ACTIONS[action]:null;
  if(!view||view.owner!==this.client.playerId)return this.reject('not-your-item');
  if(!build)return this.reject('unknown-item-action');
  let rpc;try{rpc=build(data);writeArgs(rpc.types,rpc.args,new BitWriter());}catch{return this.reject('bad-item-data');}
  this.client.sendRpc({viewId,...rpc});return true;
 }
 // Context interaction (doors, loot, deployables…): query a target, then quick-use, pick a menu option or cancel.
 context({action,target,option}){
  const view=998;
  if(action==='query'){
   const id=this.entityId(target);if(!id)return this.reject('unknown-target');
   this.client.sendRpc({viewId:view,name:'Context:A',types:['NetEntityID'],args:[id]});return true;
  }
  if(action==='quick'){this.client.sendRpc({viewId:view,name:'Context:B'});return true;}
  if(action==='menu'&&Number.isInteger(option)){this.client.sendRpc({viewId:view,name:'Context:C',types:['int'],args:[option]});return true;}
  if(action==='cancel'){this.client.sendRpc({viewId:view,name:'Context:D'});return true;}
  return this.reject('bad-context');
 }
 // NetEntityID: classic view {p1:0, viewId}; NGC entity {p1: carrier group, p2: innerID} (NetEntityID.cs layout).
 // RPOS cell operations (client Inventory.ItemMergeRPC/ItemMoveRPC): `op:'merge'` → ITSM/ITMG with the client's
 // tryCombine (Shift held), `op:'move'` onto an empty cell → ISMV/ITMV. The browser predicts like the native client and
 // only asks when the prediction is > NoOp; the server re-runs SlotOperation.
 inventory({source,action,target,fromSlot,toSlot,op,tryCombine,option,blueprint,amount=1}){
  if(!this.entityId(source))return this.reject('unknown-inventory');
  const slot=n=>Number.isInteger(n)&&n>=0&&n<=255;
  const own=Number.isInteger(source.viewId)&&this.views.get(source.viewId)?.owner===this.client.playerId&&this.views.get(source.viewId)?.prefab===CHARACTER;
  let name,args;
  if(action==='move'){
   if(!slot(fromSlot)||!slot(toSlot)||!this.entityId(target))return this.reject('bad-inventory-move');
   const same=source.viewId!=null?source.viewId===target.viewId:source.carrier===target.carrier&&source.innerID===target.innerID;
   if(op==='merge'&&typeof tryCombine==='boolean'){name=same?'ITSM':'ITMG';args=same?[fromSlot,toSlot,tryCombine]:[this.entityId(target),fromSlot,toSlot,tryCombine];}
   else if(op==='move'){name=same?'ISMV':'ITMV';args=same?[fromSlot,toSlot]:[this.entityId(target),fromSlot,toSlot];}
   else return this.reject('bad-inventory-move');
  }else if(action==='refresh'){name='SVUF';args=[];}
  else if(action==='take-all'){name='TakeAll';args=[];}
  else if(action==='repair'&&source.viewId==null){name='DoRepair';args=[];} // RPOSRepairBenchWindow: NetCull.RPC(bench, "DoRepair", Server)
  else if(action==='stop-looting'){name='StopLooting';args=[];}
  else if(action==='split'&&slot(fromSlot)){name='ITSP';args=[fromSlot];}
  else if(action==='toss'&&own&&slot(fromSlot)&&fromSlot<40){name='TOSS';args=[Uint8Array.of(fromSlot)];}
  else if(action==='menu'&&own&&slot(fromSlot)&&Number.isInteger(option)&&option>=3&&option<=9){name='IACT';args=[fromSlot,option];}
  else if(action==='belt'&&own&&Number.isInteger(fromSlot)&&fromSlot>=30&&fromSlot<36){name='DoBeltUse';args=[fromSlot-30];}
  else if(action==='craft'&&own&&Number.isInteger(blueprint)&&Number.isInteger(amount)&&amount>0&&amount<=2147483647){name='CRFS';args=[amount,blueprint];}
  else if(action==='cancel-craft'&&own){name='CRFX';args=[];}
  else return this.reject('bad-inventory-action');
  if(source.viewId!=null)return this.rpc({viewId:source.viewId,name,args});
  const entity=this.ngc.get(source.carrier+':'+source.innerID),message=entity?.prefab?.messages?.find(m=>m.name===name);
  // The registry names the entity's own class (FireBarrel, CampfireInventory) and the class that declares the RPC (LootableObject,
  // Inventory); the schema lists declaring classes, so either may match (else StopLooting on a camp fire was refused).
  const classes=new Set([message?.class,message?.declaredIn].filter(Boolean));
  const allowed=(this.toServer.get(name)??[]).find(h=>classes.has(h.class)&&h.params.length===args.length);
  if(!message||!allowed)return this.reject('inventory-call-not-allowed');
  let bytes;try{bytes=writeArgs(message.params,args).toBytes();}catch{return this.reject('bad-inventory-arguments');}
  this.client.sendRpc({viewId:source.carrier,name:'C',types:['byte[]'],args:[writeNgcCall({innerID:source.innerID,messageID:message.id,args:bytes})]});return true;
 }
 entityId(target){
  if(Number.isInteger(target?.viewId)&&this.views.has(target.viewId))return {p1:0,viewId:target.viewId};
  if(Number.isInteger(target?.carrier)&&Number.isInteger(target?.innerID)&&this.ngc.has(target.carrier+':'+target.innerID)){
   const group=this.views.get(target.carrier)?.group;if(!group)return null;return {p1:group,p2:target.innerID};
  }
  return null;
 }
 rpc({viewId,name,args=[]}){
  // {args:null} or a string used to throw here (args.length / args.map) and end every session on the gateway.
  if(!Array.isArray(args)||typeof name!=='string')return this.reject('bad-arguments');
  if(name==='GetClientMove'||name==='ClientFirstReady'||name==='clientspeak')return this.reject('use-dedicated-command');
  const handlers=this.toServer.get(name),view=this.views.get(viewId);
  if(!handlers||!view)return this.reject('not-allowed');
  // Short names (A, B, …) exist on several classes: prefer the target view's known class, then arity.
  const h=handlers.find(x=>x.params.length===args.length&&(!view.class||x.class===view.class));
  if(!h)return this.reject('bad-arguments');
  try{writeArgs(h.params,args.map((a,i)=>h.params[i]==='ulong'?BigInt(a):a),new BitWriter());}catch{return this.reject('bad-arguments');}
  this.client.sendRpc({viewId,name:PREFIXED.has(h.class)?h.class+':'+name:name,types:h.params,args:args.map((a,i)=>h.params[i]==='ulong'?BigInt(a):a)});
  return true;
 }
 // VoiceCom.USpeakOnSerializeAudio: RPC "clientspeak"(int setupData, byte[] frames) on our character view, bare name
 // (the server answers others with "VoiceCom:voiceplay"). Only desktop-client shaped payloads within the voice budget.
 voice({setup,data}){
  const view=this.find(v=>v.prefab===CHARACTER&&v.owner===this.client.playerId);
  if(view===undefined)return this.reject('no-character');
  const bytes=decodeBase64(data,MAX_FRAMES_PER_MESSAGE*106);if(!bytes)return this.reject('bad-voice-data');
  const check=validateVoice(setup,bytes);if(!check.ok)return this.reject(check.reason);
  if(!this.voiceBudget.take(check.frames))return this.reject('voice-rate-limited');
  this.client.sendRpc({viewId:view,name:'clientspeak',types:['int','byte[]'],args:[setup,bytes]});return true;
 }
 find(pred){for(const [id,v] of this.views)if(pred(v))return id;return undefined;}
 reject(reason){this.emit('event',{type:'command-rejected',reason});return false;}
}
const isVec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
