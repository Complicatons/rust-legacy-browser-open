// Online mode: joins a server through the project gateway with the one-use ticket the website left in this tab's
// sessionStorage ('rlb-join', site/site.mjs), then keeps the local player in sync (browser/net-client.mjs).
// Non-visual; main.mjs supplies the motor/camera hooks and draws remote views.
import {ContextClient,QUICK_TAP_MS} from './context-ui.mjs';
import {Vector3,Quaternion,Euler} from 'three';
import {GatewayClient,STATE} from './net-client.mjs';
import {deathShot} from './ragdoll-death.mjs';
import {toBrowserPosition} from './net-client.mjs';
import {readSkyState} from './tod.mjs';
import {disconnectMessage,NET_ERROR} from './net-error.mjs';
import {readPlayerClientData,GAME_TIP} from './name-tags.mjs';
import {ServerClock} from './server-clock.mjs';

export const JOIN_KEY='rlb-join';
const SERVER_MANAGEMENT=/(^|\/)ServerManagement$/i; // as bridge/game-bridge.mjs
const TICKET_MAX_AGE_MS=60e3; // join tickets live ~60 s at the central service
// Gateway kicks ({type:'kicked', reason}, bridge/gateway-service.mjs) as the NetError a native kick carries
// (NetUser.Kick → ServerManagement.KP), so MainMenu's "Disconnected (<NiceString>)" text follows. Other reasons are
// website admin or policy kicks (Kicked by admin).
export const GATEWAY_KICKS=Object.freeze({anticheat:NET_ERROR.Facepunch_Kick_Violation,kicked:NET_ERROR.Facepunch_Kick_RCON,admin:NET_ERROR.Facepunch_Kick_RCON,
 banned:NET_ERROR.Facepunch_Kick_Ban,ban:NET_ERROR.Facepunch_Kick_Ban,replaced:NET_ERROR.Facepunch_Connector_ConnectedElsewhere});

// Reads and removes the hand-off (it must never be reused). Returns null when absent, stale or malformed.
export function takeJoin(storage,now=Date.now()){
 let raw=null;try{raw=storage?.getItem(JOIN_KEY);storage?.removeItem(JOIN_KEY);}catch{return null;}
 if(!raw)return null;
 let j;try{j=JSON.parse(raw);}catch{return null;}
 if(typeof j?.ticket!=='string'||typeof j.endpoint!=='string'||!Number.isFinite(j.at)||now-j.at>TICKET_MAX_AGE_MS||j.at>now+5e3)return null;
 let url;try{url=new URL(j.endpoint);}catch{return null;}
 // wss:// only, except a loopback gateway during local development.
 const loopback=url.hostname==='127.0.0.1'||url.hostname==='localhost';
 if(url.protocol!=='wss:'&&!(url.protocol==='ws:'&&loopback))return null;
 return {ticket:j.ticket,endpoint:url.href,server:j.server,name:j.name};
}

// motor: {feet():[x,y,z] browser space, yaw(), pitch(), flags(), teleport([x,y,z]), look?({yaw, pitch})}. The session connects as soon as the
// page starts (tickets are short-lived) and the motor may be attached once the world has loaded; spawn and
// correction teleports that arrive earlier are applied on attach.
export class OnlineSession extends EventTarget{
 constructor({join,motor,ClientImpl=GatewayClient,WebSocketImpl,now}){
  super();this.join=join;this.motor=null;this.pendingTeleport=null;this.state='connecting';this.remote=new Map();
  this.playerClients=new Map();this.localUserId=null; // view owner -> {userId, name, viewId}
  this.actorCalls=new Map();
  this.deathCalls=new Map();
  this.vitalsCalls=new Map();
  this.consoleCalls=[];
  this.client=new ClientImpl({url:join.endpoint,...(WebSocketImpl?{WebSocketImpl}:{}),...(now?{now}:{})});
  const c=this.client;if(motor)this.attach(motor);
  // The server clock on the page clock (server-clock.mjs), fed by every stamped message before any other listener reads
  // it: snapshots and timed events are placed at timestampMs / 1000 + clock offset (airdrops.mjs callTime).
  this.clock=new ServerClock();const pageNow=now??(()=>performance.now()/1000),observe=e=>this.clock.observe(e.detail?.serverMs,pageNow());
  for(const type of ['rpc','remote-move','correction','ngc-call'])c.addEventListener(type,observe);
  c.addEventListener('create',e=>{const v=e.detail;
   // ServerManagement.ClientFirstReady makes the server spawn us (NetUser.InitializeClientToServer). The original client
   // sends it when the level has loaded (RustLevel ~88 -> LocalClientPoliteReady), so the page waits for attach(): until
   // then no character of ours stands in the world while the island is still loading.
   if(SERVER_MANAGEMENT.test(v.prefab??'')){this.serverManagement=true;this.sendReady();return;}
   // ":client" (ServerManagement.CreatePlayerClientForUser): PlayerClient userID + userName, owned by that player.
   if(v.prefab===':client'){const d=readPlayerClientData(v.initialData);if(d){this.playerClients.set(v.owner,{...d,viewId:v.viewId});if(v.owner===c.playerId)this.localUserId=d.userId;this.emit('player-client',{owner:v.owner,...d});}return;}
   // InventoryHolder.uLink_OnNetworkInstantiate on our own character (isMine): inventory.RequestFullUpdate() -> SVUF.
   if(v.viewId===c.characterView){this.vitalsCalls.clear();this.characterCreate=v;this.teleport(v.position);this.state='in-game';c.inventory('refresh',{viewId:v.viewId});this.emit('character',v);return;}
   // Player.uLink_OnNetworkInstantiate: GameTip.text = playerClient.userName of the view owner, once, at instantiation.
   if(v.prefab===':player_soldier'){this.deathCalls.delete(v.viewId);this.remote.set(v.viewId,{...v,userName:this.playerClients.get(v.owner)?.name??GAME_TIP.text});this.emit('remote-create',this.remote.get(v.viewId));}});
  c.addEventListener('rpc',e=>{const r=e.detail,death=deathShot(r);if(!death||!this.remote.has(r.viewId)||this.deathCalls.has(r.viewId))return;
   const call={viewId:r.viewId,...death,receivedAt:(now??(()=>performance.now()/1000))(),timestampMs:r.timestampMs,serverMs:r.serverMs};this.deathCalls.set(r.viewId,call);this.emit('remote-death',call);});
  // r.moved: the record now holds a ReadClientMove (an interpolator goal), not just the Create's spawn position.
  c.addEventListener('remote-move',e=>{const m=e.detail,r=this.remote.get(m.viewId);if(!r)return;r.moved=true;r.position=m.position;r.angles=m.angles;r.stateFlags=m.stateFlags;r.timestampMs=m.timestampMs;r.serverMs=m.serverMs;this.emit('remote-move',r);});
  c.addEventListener('equipment',e=>{const r=this.remote.get(e.detail.viewId);if(r){r.armor=e.detail.armor;this.emit('remote-equipment',r);}});
  // ConsoleNetworker.CL_ConsoleMessage: server console output (replies to SV_RunConsoleCommand) for the F1 console; text only.
  c.addEventListener('rpc',e=>{const r=e.detail;if(r.viewId!==997||r.name!=='CL_ConsoleMessage'||r.args?.class!=='ConsoleNetworker'||typeof r.args.values?.[0]!=='string')return;this.emit('console-message',{text:r.args.values[0]});});
  c.addEventListener('rpc',e=>{const r=e.detail;if(r.viewId!==997||r.name!=='CL_ConsoleCommand'||r.args?.class!=='ConsoleNetworker')return;const text=r.args.values[0];this.consoleCalls.push(text);if(this.consoleCalls.length>32)this.consoleCalls.shift();this.emit('console-command',{text});});
  // The server is authoritative over the local position when it corrects (TruthDetector, respawn): HumanController.
  // ReadClientMove -> UpdateStateNew on our own view sets origin and eyesAngles (a dropped move answers with the server's
  // stored origin and angles) and CCMotor.Teleport.
  c.addEventListener('correction',e=>{this.teleport(e.detail.position);const a=e.detail.angles;if(Number.isFinite(a?.yaw)&&Number.isFinite(a?.pitch))this.look(a);});
  // Server state the original client keeps outside the world model (retained so the page can attach after loading):
  //  ServerManagement.KP(int) kick reason (shown on disconnect), ServerManagement.UnstickMove(Vector3) teleport,
  //  FallDamage.fIo(float) leg injury of our character, EquipmentWearer.ArmorData(byte[]) armour totals (owner only),
  //  EnvironmentControlCenter.CL_UpdateSkyState(BitStream) on scene view 996.
  this.kickReason=null;this.legInjury=0;this.armorValues=null;this.skyState=null;
  // A server KP that arrived first wins.
  c.addEventListener('kicked',e=>{if(this.kickReason!=null)return;const r=e.detail?.reason;this.kickReason=typeof r==='string'&&Object.hasOwn(GATEWAY_KICKS,r)?GATEWAY_KICKS[r]:NET_ERROR.Facepunch_Kick_RCON;});
  this.addEventListener('character',()=>{this.legInjury=0;this.armorValues=null;this.emit('leg-injury',{level:0});this.emit('armor-values',{values:null});});
  c.addEventListener('rpc',e=>{const r=e.detail,cls=r.args?.class,v=r.args?.values??[];
   if(cls==='ServerManagement'&&r.name==='KP'&&Number.isInteger(v[0])){this.kickReason=v[0];return;}
   if(cls==='ServerManagement'&&r.name==='UnstickMove'&&Array.isArray(v[0])&&v[0].every(Number.isFinite)){if(c.characterView!=null){this.teleport(toBrowserPosition(v[0]));this.emit('unstick',{position:toBrowserPosition(v[0])});}return;}
   if(r.viewId===c.characterView&&cls==='FallDamage'&&r.name==='fIo'&&Number.isFinite(v[0])){this.legInjury=v[0];this.emit('leg-injury',{level:v[0]});return;}
   if(r.viewId===c.characterView&&cls==='EquipmentWearer'&&r.name==='ArmorData'){const values=readArmorData(v[0]);if(values){this.armorValues=values;this.emit('armor-values',{values});}return;}
   if(r.viewId===996&&cls==='EnvironmentControlCenter'&&r.name==='CL_UpdateSkyState'){try{this.skyState=readSkyState(v[0]);this.emit('sky-state',this.skyState);}catch(error){this.emit('protocol-error',{message:error.message});}}});
  c.addEventListener('destroy',e=>{for(const id of [...this.remote.keys()])if(!c.views.has(id)){this.remote.delete(id);this.emit('remote-destroy',{viewId:id});}
   for(const [owner,p] of [...this.playerClients])if(!c.views.has(p.viewId))this.playerClients.delete(owner);
   for(const id of this.actorCalls.keys())if(!c.views.has(id))this.actorCalls.delete(id);
   for(const id of this.deathCalls.keys())if(!c.views.has(id))this.deathCalls.delete(id);
   for(const key of this.inventoryCalls?.keys()??[])if(key.startsWith('v:')&&!c.views.has(Number(key.slice(2))))this.inventoryCalls.delete(key);
   if(c.characterView==null&&this.state==='in-game'){this.state='dead';this.emit('character-lost',{});}});
  // Latest state-setting call per entity and message, replayed when the page draws the entity (calls can arrive
  // while the island is still loading).
  this.entityCalls=new Map();
  this.inventoryCalls=new Map();
  const retainInventory=(source,d)=>{
   if(!['GNUP','SetLooter','ClearLooter','ReceiveBoundBPs','IAST','ITDE','CRFU','CRFC','wbi'].includes(d.name))return;
   const key=source.viewId!=null?'v:'+source.viewId:'n:'+source.carrier+':'+source.innerID,call={source,name:d.name,args:Array.isArray(d.args)?d.args:d.args?.values};
   const list=this.inventoryCalls.get(key)??[];
   // A full snapshot replaces earlier slot deltas; retain the newest value of all other state calls.
   if(d.name==='GNUP'){const bytes=call.args?.[0];if(bytes?.[1])for(let i=list.length-1;i>=0;i--)if(list[i].name==='GNUP')list.splice(i,1);}
   else for(let i=list.length-1;i>=0;i--)if(list[i].name===d.name)list.splice(i,1);
   list.push(call);this.inventoryCalls.set(key,list);this.emit('inventory-call',call);
  };
  c.addEventListener('rpc',e=>retainInventory({viewId:e.detail.viewId},e.detail));
  c.addEventListener('rpc',e=>{const r=e.detail;if(r.viewId!==c.characterView||!['Local_HealthChange','Local_BleedChange','RecieveNetwork','Vomit','Client_OnKilled','Client_OnKilledBy','Client_OnKilledShot','Client_OnKilledShotBy'].includes(r.name))return;
   const call={name:r.name,args:r.args?.values??[],receivedAt:(now??(()=>performance.now()/1000))(),timestampMs:r.timestampMs,serverMs:r.serverMs};this.vitalsCalls.set(r.name,call);this.emit('vitals-call',call);});
  c.addEventListener('ngc-call',e=>retainInventory({carrier:e.detail.carrier,innerID:e.detail.innerID},e.detail));
  // Retain the latest wildlife state while the island loads; transient sound/attack calls carry their receive time.
  // ItemRepresentation Action2/Action3: a torch's buffered light state (server-held.mjs); the newer of the two is kept, last.
   c.addEventListener('rpc',e=>{const r=e.detail,torchAction=r.args?.class==='ItemRepresentation'&&/^Action[23]B?$/.test(r.name);if(!(r.name==='Mods'&&r.args?.class==='ItemRepresentation')&&!torchAction&&!['BasicWildLifeAI','HostileWildlifeAI','RigidObj','TimedGrenade','SignalGrenade','BasicTorchItemRep','TorchItemRep','ItemPickup','SupplyCrate','SupplyDropPlane'].includes(r.args?.class))return;
   if(!this.actorCalls.has(r.viewId))this.actorCalls.set(r.viewId,new Map());
   if(torchAction)for(const n of ['Action2','Action3','Action2B','Action3B'])this.actorCalls.get(r.viewId).delete(n);
   if(r.args?.class==='ItemPickup'&&['PKIS','PKIF'].includes(r.name))this.actorCalls.get(r.viewId).delete(r.name==='PKIS'?'PKIF':'PKIS');
   this.actorCalls.get(r.viewId).set(r.name,{...r,receivedAt:(now??(()=>performance.now()/1000))()});});
  c.addEventListener('ngc-call',e=>{const d=e.detail,k=d.carrier+':'+d.innerID;if(!this.entityCalls.has(k))this.entityCalls.set(k,new Map());
   const m=this.entityCalls.get(k);if(d.name==='DOc')m.delete('DOo');if(d.name==='SetLooter'||d.name==='ClearLooter'){m.delete('SetLooter');m.delete('ClearLooter');}m.set(d.name,d);});
  // Scene MovingDoors (BasicDoor on manual views 3–62, never Created): the latest DOc/DOo per view, replayed onto the
  // island's LegacyDoors once they exist (sceneDoorViews / applySceneDoorCall).
  this.sceneDoorCalls=new Map();
  c.addEventListener('rpc',e=>{const r=e.detail;if(r.args?.class==='BasicDoor'&&(r.name==='DOc'||r.name==='DOo'))this.sceneDoorCalls.set(r.viewId,r);});
  c.addEventListener('entity-destroy',e=>{this.entityCalls.delete(e.detail.carrier+':'+e.detail.innerID);this.inventoryCalls.delete('n:'+e.detail.carrier+':'+e.detail.innerID);});
  c.addEventListener('closed',()=>{this.clock.reset();this.remote.clear();this.playerClients.clear();this.actorCalls.clear();this.deathCalls.clear();this.entityCalls.clear();this.sceneDoorCalls.clear();this.inventoryCalls.clear();this.consoleCalls.length=0;c.views.clear();c.entities.clear();c.characterView=null;
   if(!this.closedEmitted){this.closedEmitted=true;this.state='closed';this.emit('closed',{});}});
 }
 // MainMenu.uLink_OnDisconnectedFromServer text: the KP kick reason if the server sent one.
 disconnectText(){return disconnectMessage(this.kickReason);}
 teleport(p){if(this.motor)this.motor.teleport(p);else this.pendingTeleport=p;}
 // Browser {yaw, pitch} radians onto the motor (motor.look is optional).
 look(a){if(this.motor)this.motor.look?.(a);else this.pendingLook=a;}
 attach(motor){this.motor=motor;if(this.pendingTeleport){motor.teleport(this.pendingTeleport);this.pendingTeleport=null;}if(this.pendingLook){motor.look?.(this.pendingLook);this.pendingLook=null;}this.sendReady();}
 sendReady(){if(this.readySent||!this.serverManagement||!this.motor)return false;this.readySent=true;this.client.ready();return true;}
 emit(type,detail){this.dispatchEvent(Object.assign(new Event(type),{detail}));}
 async connect(){
  try{const r=await this.client.connect({ticket:this.join.ticket});this.state=this.client.characterView!=null?'in-game':'approved';this.emit('approved',r);return r;}
  catch(e){this.state='closed';this.emit('denied',{reason:e.reason??e.message,error:e.error});throw e;}
 }
 // Called every frame; the client rate-limits to the server's send rate.
 frame(){if(this.state!=='in-game'||!this.motor)return false;return this.client.sendMove({feet:this.motor.feet(),yaw:this.motor.yaw(),pitch:this.motor.pitch(),flags:this.motor.flags()});}
 respawn(camp=false){if(this.state!=='dead')return false;const v=[...this.client.views.values()].find(v=>SERVER_MANAGEMENT.test(v.prefab??''));if(!v)return false;
  this.client.rpc(v.viewId,'RequestRespawn',[Boolean(camp)]);return true;}
 close(){this.state='closed';this.client.close();}
}
export {STATE};

// EquipmentWearer.ArmorData(byte[]): an untyped BitStream of six floats (DamageTypeList generic, bullet, melee,
// explosion, radiation, cold) -> ProtectionTakeDamage.SetArmorValues. Returns null for a malformed payload.
export function readArmorData(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength!==24)return null;const d=new DataView(bytes.buffer,bytes.byteOffset,24);
 const values=Array.from({length:6},(_,i)=>d.getFloat32(i*4,true));return values.every(Number.isFinite)?values:null;}

// NGC instantiations carry a browser-space position (net-client) and Unity euler degrees (NGC.Instantiate's
// rotation.eulerAngles). Returns the Unity-space transform the offline placement code uses (unityMatrix).
export function entityTransform({position,euler}){
 const r=Math.PI/180,rotation=new Quaternion().setFromEuler(new Euler(euler[0]*r,euler[1]*r,euler[2]*r,'YXZ')); // Quaternion.Euler: Y·X·Z
 return {position:new Vector3(position[0],position[1],-position[2]),rotation};
}

// Server calls on NGC entities that change what the browser shows (decompiled client handlers):
//  BasicDoor.DOc(sbyte) connect-time state, BasicDoor.DOo(sbyte, ulong ms) animated toggle,
//  ResourceObject.modelindex(int) depletion stage, FireBarrel.ReceiveNetState(bool) lit, LootableObject.SetLooter/ClearLooter.
// `obj` holds {door?, modelIndex, lit}; localMs maps a server timestamp onto the page clock.
export function applyEntityCall(obj,{name,args,serverMs},{localNowMs}){
 if(!args)return null;
 const v=Array.isArray(args)?args:args.values; // ngc-call args are an array; rpc events wrap them in {values}
 if(name==='DOc'&&obj.door){const d=obj.door,open=Number(v[0]);
  d.target=d.state=open!==0?1:3;if(open!==0)d.openingInReverse=open===2;d.doDoorFraction(open!==0?1:0);d.timeStampChanged=null;d.enabled=false;d.changed=true;return 'door';}
 if(name==='DOo'&&obj.door){const d=obj.door,open=Number(v[0]);if(open!==0)d.openingInReverse=open===2;
  const age=serverMs!=null?Math.max(0,Number(serverMs)-Number(v[1])):0;d.startOpeningOrClosing(open,localNowMs-age);return 'door';}
 if(name==='modelindex'){obj.modelIndex=Number(v[0]);return 'model';}
 if(name==='ReceiveNetState'){obj.lit=Boolean(v[0]);return 'lit';}
 // LootableObject.SetLooter(NetworkPlayer) / ClearLooter: who is looting (0 = uLink.NetworkPlayer.unassigned); FireBarrel inherits it.
 if(name==='SetLooter'){obj.looter=Number(v[0])||null;return 'looter';}
 if(name==='ClearLooter'){obj.looter=null;return 'looter';}
 return null;
}

// Scene doors online: the server scene's uLinkNetworkView._manualViewID of each MovingDoor (scene export doors[i].viewID)
// -> its LegacyDoor. Context.BeginQuery targets a static door by that view (NetEntityID.Of finds the door's
// uLink.NetworkView: {p1: 0, viewID}), and BasicDoor.DOc/DOo arrive as RPCs on it.
export function sceneDoorViews(doors){const m=new Map();for(const d of doors){const id=d.record?.viewID;if(Number.isInteger(id)&&id>0)m.set(id,d);}return m;}
// A BasicDoor RPC on a scene view, with the NGC doors' maths (applyEntityCall). Returns the door it moved, else null.
export function applySceneDoorCall(views,call,clock){const door=call?.args?.class==='BasicDoor'?views.get(call.viewId):null;
 return door&&applyEntityCall({door},call,clock)==='door'?door:null;}

// Context interaction online: the ContextUI/Context client (context-ui.mjs ContextClient) over the bridge. Press sends
// Context:A(target), a release within 300 ms Context:B, a later release Context:D; the server's menu (Context:E) is shown
// while the use key is held and a choice is Context:C(option name); Context:F..M end or restart the prompt.
export {QUICK_TAP_MS};
export class OnlineContext extends ContextClient{
 constructor(client,{now=()=>Date.now(),...hooks}={}){
  super({...hooks,send:(kind,arg)=>{if(kind==='query')client.context('query',arg);else if(kind==='menu')client.context('menu',undefined,arg);else client.context(kind);}});
  this.client=client;this.now=now;
  client.addEventListener('rpc',e=>{const r=e.detail;if(r.args?.class!=='Context'||typeof r.name!=='string'||r.name.length!==1)return;this.reply(r.name,r.args.values??[],this.now());});
 }
}
