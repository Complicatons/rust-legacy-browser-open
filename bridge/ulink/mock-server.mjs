// Project-owned mock of the uLink 1.5.6 server side, for testing the gateway session engine only.
// It reproduces the decompiled server behaviour we rely on (O391 Connect handling, O896 approval replies);
// it is not the original server and proves nothing about native compatibility by itself.
import {createSocket} from 'node:dgram';
import {decodeDatagram,parseSystem,readConnect,encodeSystem,reasonBody,KIND,SYSTEM,APP_IDENTIFIER} from './lidgren.mjs';
import {LidgrenConnection} from './session.mjs';
import {INTERNAL,decodeHeader,encodeInternal,readClientConnectRequest,clientConnectResponse,connectDenied,writeWorldInfo} from './ulink.mjs';
import {BitWriter} from './bits.mjs';
import {encodeRpc,writeArgs,write,writeNgcInstantiate,writeNgcCall,ngcAddName,ngcBufferedCallName} from './rust.mjs';

export async function startMockUlinkServer({approve,onDisconnect,world,now=()=>performance.now()/1000,config,dropOutgoing=()=>false,port=0}={}){
 const socket=createSocket('udp4'),peers=new Map();let nextPlayer=1;
 const send=(rinfo)=>bytes=>{if(!dropOutgoing(bytes))socket.send(bytes,rinfo.port,rinfo.address);};
 socket.on('message',(msg,rinfo)=>{
  const key=rinfo.address+':'+rinfo.port,data=new Uint8Array(msg);
  let peer=peers.get(key);
  if(!peer){
   const m=decodeDatagram(data).find(x=>x.kind===KIND.System);
   if(!m)return;
   const {type,body}=parseSystem(m.payload);
   if(type!==SYSTEM.Connect)return;
   const c=readConnect(body);
   if(c.appId!==APP_IDENTIFIER){send(rinfo)(encodeSystem(SYSTEM.ConnectionRejected,reasonBody('Bad app id')));return;}
   const connection=new LidgrenConnection({role:'server',send:send(rinfo),now,config});
   peer={connection,key,received:[],...serverHelpers(now)};peer.connection=connection;peers.set(key,peer);
   connection.on('closed',()=>{peers.delete(key);onDisconnect?.(peer);}); // the plugin's OnPlayerDisconnected → sidecar
   connection.on('message',payload=>onMessage(peer,payload));
   connection.accept(c);
   return;
  }
  peer.connection.receive(data);
 });
 async function onMessage(peer,payload){
  const {header,body}=decodeHeader(payload);
  if(header.viewId===undefined&&header.internal===INTERNAL.ResyncClockRequest){
   const t0=body.u64(),t=BigInt(Math.floor(now()*1000));
   return peer.connection.send(encodeInternal(INTERNAL.ResyncClockResponse,{target:peer.playerId},w=>w.u64(t0).u64(t).u64(t)),0);
  }
  if(header.internal!==INTERNAL.ClientConnectRequest){peer.received.push(header);return peer.onUlink?.(header,body);}
  const request=readClientConnectRequest(body),decision=await approve(request.login,peer); // may be async, like the plugin's sidecar call
  if(decision.deny!==undefined){peer.connection.send(connectDenied(decision.deny));peer.connection.close('Normal disconnect');return;}
  const t=BigInt(Math.floor(now()*1000));peer.playerId=nextPlayer++;
  peer.connection.send(clientConnectResponse({playerId:peer.playerId,viewRanges:[[1000,1099]],requestReceivedMs:t,serverNowMs:t,approvalData:writeWorldInfo(world)}));
 }
 const timer=setInterval(()=>{for(const p of peers.values())p.connection.tick();},10);
 await new Promise((r,j)=>{socket.once('error',j);socket.bind(port,'127.0.0.1',()=>{socket.off('error',j);r();});}); // port: fixed for the host app's mock game server
 return {port:socket.address().port,peers,close:()=>new Promise(r=>{clearInterval(timer);socket.close(r);})};
}

// Server→client messages shaped like the original encoder (O575): Create = flags 0x74 (unassigned target,
// internal on view, 40-bit timestamp, untyped); RPCs to one player with a 16-bit timestamp. Mixed into a peer that has
// `connection.send(bytes)` and `playerId` (the UDP mock above; tests can drive a peer without a socket).
export function serverHelpers(now=()=>performance.now()/1000){
  const ms=()=>BigInt(Math.floor(now()*1000));
  return {
   create({viewId,owner=0,group=0,position=[0,0,0],rotation=[0,0,0,1],prefab,initialData=new Uint8Array(0)},{buffered=false}={}){
    const w=new BitWriter().u8(0x74).u16(viewId).u8(INTERNAL.Create).writeBits(ms(),40).u16(owner).u16(group);
    write.vector3(w,position);write.quaternion(w,rotation);w.string(prefab).string(prefab).string(prefab).raw(initialData);
    if(buffered)return w.toBytes();
    this.connection.send(w.toBytes());
   },
   // What the original server sends a newly connected player (O1629.O3123): messages wrapped in one BufferedRPCs.
   buffered(messages){this.connection.send(encodeInternal(INTERNAL.BufferedRPCs,{target:this.playerId},w=>{w.varuint(messages.length);for(const m of messages)w.blob(m);}));},
   destroyView(viewId){this.connection.send(new BitWriter().u8(0x04|16).u16(viewId).u8(INTERNAL.DestroyByViewID).toBytes());},
   destroyGroup(group,player){this.connection.send(encodeInternal(player==null?INTERNAL.DestroyInGroup:INTERNAL.DestroyInGroupByPlayerID,{target:'unassigned'},w=>{if(player!=null)w.u16(player);w.u16(group);}));},
   changeGroup(viewId,group){this.connection.send(encodeInternal(INTERNAL.ChangeGroup,{target:'unassigned'},w=>w.u16(viewId).u16(group)));},
   destroyAll(){this.connection.send(encodeInternal(INTERNAL.DestroyAll,{target:'unassigned'}));},
   // {buffered:true}: the bytes for buffered(), flagged buffered with a 40-bit timestamp like the server's stored RPCs.
   // {info:false}: sent with explicit NetworkFlags.NoTimestamp, so no timestamp and a type-safe body (uLink adds
   // TypeUnsafe only to the default flags).
   // {buffered:true,live:true}: a buffered RPC sent now to a connected player (the server sends it and keeps a copy).
   rpc(viewId,name,types,args,{buffered=false,info=true,live=false}={}){const m=encodeRpc({viewId,name,target:this.playerId,timestampMs:info?ms():undefined,buffered,typeSafe:!info},w=>writeArgs(types,args,w,!info));if(buffered&&!live)return m;this.connection.send(m);},
   // NGC on a '!Ng' carrier with the original server's RPC names: NGC.ServerInstantiate sends "A" + innerID hex
   // (AllBuffered), buffered calls are "C" + innerID hex + "_" + message hex, unbuffered calls "C", destroys "D".
   // info:false = the NGC handler has no NetworkMessageInfo parameter (NGC Method.defaultNetworkFlags → NoTimestamp).
   ngcCreate(carrier,n,opts){return this.rpc(carrier,ngcAddName(n.innerID),['byte[]'],[writeNgcInstantiate(n)],opts);},
   ngcCall(carrier,call,{buffered=false,info=true,live=false}={}){return this.rpc(carrier,buffered?ngcBufferedCallName(call.innerID,call.messageID):'C',['byte[]'],[writeNgcCall(call)],{buffered,info,live});},
   ngcDestroy(carrier,innerID){this.rpc(carrier,'D',['ushort'],[innerID]);},
  };
}
