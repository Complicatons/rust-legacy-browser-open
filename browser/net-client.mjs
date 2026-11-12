// Browser side of the gateway protocol (rlb-gateway.v1; bridge/gateway-service.mjs). Non-visual: keeps a world
// model of server objects in browser coordinates and sends the local player's moves. Rendering integration is
// separate (main.mjs). Talks only to the project gateway, never directly to a Legacy server.
import {decodeArmor} from './armor.mjs';
export const GATEWAY_PROTOCOL='rlb-gateway.v1';
export const GATEWAY_SILENCE_S=60; // checkAlive
// CharacterStateFlags (decompiled CharacterStateFlags.cs); bits 0x6000 are added by the gateway (move parity).
export const STATE={crouch:1,sprint:2,aim:4,attack:8,airborne:16,slipping:32,movement:64,lostFocus:128,attack2:256,bleeding:512,crouchBlocked:1024,lamp:2048,laser:4096};

// Unity (left-handed, Z forward) ↔ browser (Three, Z negated): positions (x,y,z)→(x,y,−z), quaternions (x,y,z,w)→(−x,−y,z,w).
export const toBrowserPosition=([x,y,z])=>[x,y,-z];
export const toUnityPosition=([x,y,z])=>[x,y,-z];
export const toBrowserQuaternion=([x,y,z,w])=>[-x,-y,z,w];
// Browser yaw (radians, forward = (−sin, 0, −cos)) and pitch (radians, positive looks up) → Rust Angle2 degrees
// Angle2.quat = Quaternion.Euler(-pitch, yaw, 0): its pitch is positive looking UP, unlike euler X.
export const toUnityAngles=({yaw,pitch})=>({yaw:-yaw*180/Math.PI,pitch:pitch*180/Math.PI});
export const toBrowserAngles=({yaw,pitch})=>({yaw:-yaw*Math.PI/180,pitch:pitch*Math.PI/180});
// Character.EyesSetup on a new character (client and server ~1219-1231): yaw = transform.localEulerAngles.y of the
// rotation it was instantiated with (ServerManagement.SpawnPlayer: the spawn point, DeployedRespawn.GetSpawnRot or the
// saved avatar's yaw-only Ang), pitch = -eyes localEulerAngles.x = 0 (the player prefab's eyes have no rotation).
// Unity quaternion [x,y,z,w] -> browser look {yaw, pitch} in radians. Euler y is Unity's ZXY order (three's 'YXZ').
export function spawnLook([x,y,z,w]){const m23=2*(y*z-w*x),yawU=Math.abs(m23)<0.9999999?Math.atan2(2*(x*z+w*y),1-2*(x*x+y*y)):Math.atan2(-2*(x*z-w*y),1-2*(y*y+z*z));
 return {yaw:-yawU,pitch:0};}

// Angle2.Decode360 for RPCs that carry the encoded int (e.g. ReadClientMove): 8192 steps per 45° octant.
function decode360(v){const k=Math.trunc(v/8192),a=Math.fround(k*45+Math.fround((v-k*8192)/65536*360));return a<180?a:a-360;}
export const decodeAngle2=encoded=>({pitch:decode360(encoded&0xffff),yaw:decode360((encoded>>>16)&0xffff)});

const fromBase64=v=>v&&typeof v==='object'&&typeof v.base64==='string'?Uint8Array.from(atob(v.base64),c=>c.charCodeAt(0)):v;
function revive(e){const decoded=fromBase64(e);if(decoded!==e)return decoded;
 if(Array.isArray(e))return e.map(revive);if(e&&typeof e==='object')for(const k of Object.keys(e))e[k]=revive(e[k]);return e;}

export class GatewayClient extends EventTarget{
 constructor({url,WebSocketImpl=globalThis.WebSocket,now=()=>performance.now()/1000}){
  super();Object.assign(this,{url,WebSocketImpl,now});
  this.views=new Map();this.entities=new Map();this.playerId=null;this.characterView=null;this.lastMove=-Infinity;
 }
 // Resolves with {playerId, world} after the server approves; rejects with the denial reason.
 connect({ticket,name}){
  return new Promise((resolve,reject)=>{
   const ws=this.ws=new this.WebSocketImpl(this.url,[GATEWAY_PROTOCOL]);
   this.heardAt=this.now();this.silenced=false;this.rejectConnect=reject;
   this.watchdog=setInterval(()=>this.checkAlive(),1000);this.watchdog.unref?.();
   ws.addEventListener('open',()=>ws.send(JSON.stringify({type:'admit',ticket,name})));
   ws.addEventListener('close',()=>{clearInterval(this.watchdog);if(this.silenced)return;reject(new Error('closed'));this.emit('closed',{});});
   ws.addEventListener('message',m=>{
    this.heardAt=this.now();
    const e=revive(JSON.parse(typeof m.data==='string'?m.data:String(m.data)));
    if(e.type==='approved'){this.playerId=e.playerId;this.world=e.world;this.sendInterval=1/Math.max(1,e.world.sendRate);resolve(e);return;}
    if(e.type==='denied'){reject(Object.assign(new Error('denied: '+e.reason),{reason:e.reason,error:e.error}));return;}
    this.apply(e);
   });
  });
 }
 apply(e){
  switch(e.type){
   case 'create':{
    const v={viewId:e.viewId,prefab:e.prefab,owner:e.owner,mine:e.mine,group:e.group,position:toBrowserPosition(e.position),rotation:toBrowserQuaternion(e.rotation),initialData:e.initialData};
    this.views.set(e.viewId,v);if(e.mine&&e.prefab===':player_soldier')this.characterView=e.viewId;
    return this.emit('create',v);
   }
   case 'destroy':
    if(e.kind==='view'){this.views.delete(e.viewId);if(this.characterView===e.viewId)this.characterView=null;}
    if(e.kind==='player')for(const [id,v] of this.views)if(v.owner===e.player)this.views.delete(id);
    if(e.kind==='group'||e.kind==='group-player')for(const [id,v]of this.views)if(v.group===e.group&&(e.kind==='group'||v.owner===e.player))this.views.delete(id);
    if(e.kind==='all')this.views.clear();
    for(const [key,n]of this.entities){const carrier=Number(key.split(':')[0]);if(!this.views.has(carrier)){this.entities.delete(key);this.emit('entity-destroy',{carrier,innerID:Number(key.split(':')[1])});}}
    if(!this.views.has(this.characterView))this.characterView=null;
    return this.emit('destroy',e);
   case 'group-change':{const v=this.views.get(e.viewId);if(v)v.group=e.group;return this.emit('group-change',e);}
   case 'ngc-create':{
    const n={key:e.carrier+':'+e.innerID,prefab:e.prefab,position:toBrowserPosition(e.position),euler:e.euler,initialData:e.initialData};
    this.entities.set(n.key,n);return this.emit('entity',n);
   }
   case 'ngc-destroy':this.entities.delete(e.carrier+':'+e.innerID);return this.emit('entity-destroy',e);
   case 'rpc':
    if(e.name==='CFAR'&&this.views.get(e.viewId)?.prefab===':player_soldier'){
     try{const v=this.views.get(e.viewId);v.armor=decodeArmor(e.args.values[0]);this.emit('equipment',{viewId:e.viewId,armor:v.armor});}catch(error){this.emit('protocol-error',{message:error.message});}
     return this.emit('rpc',e);
    }
    if(e.name==='ReadClientMove'){
     const [origin,angles,stateFlags,delay]=e.args.values;
     const move={viewId:e.viewId,position:toBrowserPosition(origin),angles:toBrowserAngles(typeof angles==='number'?decodeAngle2(angles):angles),stateFlags,delay,timestampMs:e.timestampMs,serverMs:e.serverMs};
     return this.emit(e.viewId===this.characterView?'correction':'remote-move',move);
    }
    return this.emit('rpc',e);
   default:return this.emit(e.type,e);
  }
 }
 // The original client gives the server 60 s (ClientConnect.DoConnect: NetCull.config.timeoutDelay = 60) and then shows
 // MainMenu's "Disconnected from server.". Here: 60 s without any gateway message (in game it sends a keepalive every
 // 15 s) closes the socket and ends the session the same way, even while the browser's own close handshake hangs.
 checkAlive(){
  if(!this.ws||this.silenced||this.now()-this.heardAt<=GATEWAY_SILENCE_S)return false;
  this.silenced=true;clearInterval(this.watchdog);
  try{this.ws.close(4000,'gateway silent');}catch{}
  this.rejectConnect?.(new Error('timeout'));this.emit('closed',{reason:'timeout'});return true;
 }
 emit(type,detail){this.dispatchEvent(Object.assign(new Event(type),{detail}));}
 send(cmd){if(this.ws?.readyState===1)this.ws.send(JSON.stringify(cmd));}
 ready(){this.send({type:'ready'});}
 // Call every frame with the local motor state; sends at most once per server send interval (gateway enforces 0.9×).
 sendMove({feet,yaw,pitch,flags=0}){
  if(this.characterView==null||!this.sendInterval)return false;
  const t=this.now();if(t-this.lastMove<this.sendInterval)return false;
  this.lastMove=t;
  // at: when the move was made (ms); the gateway stamps it for the server with this, not with its arrival time.
  this.send({type:'move',origin:toUnityPosition(feet),angles:toUnityAngles({yaw,pitch}),stateFlags:flags&0x1fff,at:Math.round(t*1000)});
  return true;
 }
 // Item actions (bridge ITEM_ACTIONS); vectors/rotations in browser space are converted to Unity space here.
 item(viewId,action,data={}){
  const v=x=>Array.isArray(x)&&x.length===3?toUnityPosition(x):x,q=x=>Array.isArray(x)&&x.length===4?toBrowserQuaternion(x):x; // the quaternion reflection is its own inverse
  const out={...data};for(const k of ['point','origin','direction','forward','position','velocity'])if(k in out)out[k]=v(out[k]);
  if('rotation' in out)out.rotation=q(out.rotation);
  if(Array.isArray(out.hits))out.hits=out.hits.map(h=>({...h,point:v(h.point)}));
  this.send({type:'item',viewId,action,data:out});
 }
 context(action,target,option){this.send({type:'context',action,target,option});}
 inventory(action,source,data={}){this.send({type:'inventory',action,source,...data});}
 rpc(viewId,name,args=[]){this.send({type:'rpc',viewId,name,args:args.map(a=>typeof a==='bigint'?a.toString():a)});}
 // VoiceCom clientspeak(setupData, frames): the gateway sends it on our character view (bridge/voice.mjs limits).
 voice(setup,bytes){if(this.characterView==null)return false;let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));this.send({type:'voice',setup,data:btoa(s)});return true;}
 close(){this.ws?.close();}
}
