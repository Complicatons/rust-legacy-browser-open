// uLink 1.5.6 message layer and Rust Legacy connection payloads (ULINK-PROTOCOL.md, O575/O896/O1947,
// ClientConnect.DoConnect, ClientConnection.AuthorisationRoutine). Static reconstruction; no captured trace yet.
import {BitWriter,BitReader} from './bits.mjs';

export const INTERNAL={None:0,AllocRequest:1,AllocResponse:2,BufferedRPCs:3,CellConnectResponse:4,CellConnectRequest:5,ClientConnectRequest:6,ClientConnectResponse:7,ConnectDenied:8,Create:9,Dealloc:10,DestroyByPlayerID:11,DestroyByViewID:12,DisconnectPlayerID:13,HandoverRequest:14,HandoverResponse:15,Redirect:16,SecurityRequest:17,SecurityResponse:18,StateSyncOwner:19,StateSyncProxy:20,TrackPosition:21,PlayerIDConnected:22,PlayerIDDisconnected:23,MultiStateSyncProxy:24,MultiStateSyncOwner:25,RedirectPlayerID:26,UnsecurityRequest:27,UnsecurityResponse:28,DestroyAll:29,DestroyInGroup:30,DestroyInGroupByPlayerID:31,LicenseCheck:32,ChangeGroup:33,ResyncClockRequest:34,ResyncClockResponse:35};
export const INTERNAL_CHANNEL=17; // O575(peer, type, player): ReliableInOrder1
export const UNASSIGNED_PLAYER=0,SERVER_PLAYER=65535; // uLink.NetworkPlayer.unassigned / server
const TIMESTAMP_BITS={32:16,64:24,96:40};

// Decode the uLink header (O575 decoding constructor). Returns header fields and a reader positioned at the body.
export function decodeHeader(payload){
 const r=new BitReader(payload),flags=r.u8(),h={flags};
 if(flags&1)h.sender=r.u16();
 switch(flags&6){case 0:h.target='server';break;case 2:h.target=r.u16();break;case 4:h.target='unassigned';break;case 6:h.target='unassigned';h.other=r.u16();break;}
 switch(flags&24){
  case 0:h.internal=r.u8();break;
  case 8:h.viewId=r.u16();h.rpc=r.string();break;
  case 16:h.viewId=r.u16();h.internal=r.u8();break;
  case 24:h.viewId=r.u16();h.rpc=r.string();h.buffered=true;break;
 }
 if(flags&96)h.timestampLow=r.readBits(TIMESTAMP_BITS[flags&96]),h.timestampBits=TIMESTAMP_BITS[flags&96];
 h.typeSafe=Boolean(flags&128);
 return {header:h,body:r};
}
// Encode an internal message as O575(peer, type, player) does: flags Unbuffered|NoTimestamp|TypeUnsafe.
// Targets (O2425/O2426/O2427): 'server' → 0, player id → 2 + u16, 'unassigned' → 4, {other: id} → 6 + u16.
export function encodeInternal(type,{target='server',viewId}={},writeBody=()=>{}){
 const w=new BitWriter();let flags=0;
 if(target==='unassigned')flags|=4;else if(typeof target==='object')flags|=6;else if(typeof target==='number'&&target!==SERVER_PLAYER&&target!==UNASSIGNED_PLAYER)flags|=2;
 if(viewId!==undefined)flags|=16;
 w.u8(flags);if((flags&6)===2)w.u16(target);if((flags&6)===6)w.u16(target.other);if(viewId!==undefined)w.u16(viewId);w.u8(type);
 writeBody(w);return w.toBytes();
}

// Rust Legacy login data (ClientConnect.DoConnect), untyped BitStream appended raw.
export function writeRustLogin(w,{protocol=1069,mode=2,userId,name,ticket}){return w.i32(protocol).u8(mode).u64(BigInt(userId)).string(name).blob(ticket);}
export function readRustLogin(r){return {protocol:r.i32(),mode:r.u8(),userId:r.u64(),name:r.string(),ticket:r.blob()};}
export const clientConnectRequest=(login,requestedPlayerId=0)=>encodeInternal(INTERNAL.ClientConnectRequest,{},w=>writeRustLogin(w.u16(requestedPlayerId),login));
export function readClientConnectRequest(body){return {requestedPlayerId:body.u16(),login:readRustLogin(body)};}

export const connectDenied=error=>encodeInternal(INTERNAL.ConnectDenied,{target:'unassigned'},w=>w.i32(error));
export const readConnectDenied=body=>({error:body.i32()});

// ClientConnectResponse (O896.O3610): player id, view-id ranges, request time, server time, approval objects.
// Rust's approval object is one byte[] (untyped: varuint length + bytes).
export function clientConnectResponse({playerId,viewRanges=[],requestReceivedMs,serverNowMs,approvalData}){
 return encodeInternal(INTERNAL.ClientConnectResponse,{target:'unassigned'},w=>{
  w.u16(playerId).varuint(viewRanges.length);for(const [a,b] of viewRanges)w.u16(a).u16(b);
  w.u64(requestReceivedMs).u64(serverNowMs).blob(approvalData);
 });
}
export function readClientConnectResponse(body){
 const playerId=body.u16(),n=body.varuint(),viewRanges=[];for(let i=0;i<n;i++)viewRanges.push([body.u16(),body.u16()]);
 return {playerId,viewRanges,requestReceivedMs:body.u64(),serverNowMs:body.u64(),approvalData:body.blob()};
}

// Rust approval world info (ClientConnection.AuthorisationRoutine). uLink BitStream booleans are whole bytes (O1760).
export function writeWorldInfo({level,sendRate,hostname,modded,official,steamId,ip,port}){
 return new BitWriter().string(level).f32(sendRate).string(hostname).u8(modded?1:0).u8(official?1:0).u64(BigInt(steamId)).u32(ip).i32(port).toBytes();
}
export function readWorldInfo(bytes){const r=new BitReader(bytes);return {level:r.string(),sendRate:r.f32(),hostname:r.string(),modded:r.u8()!==0,official:r.u8()!==0,steamId:r.u64(),ip:r.u32(),port:r.i32()};}

// O457.O1530: widen a truncated timestamp against the local synchronised clock (both bigint ms).
export function widenTimestamp(localNowMs,low,bits){
 const mask=(1n<<BigInt(bits))-1n,now=BigInt(localNowMs);
 let diff=BigInt.asIntN(64,(now&mask)-BigInt(low));
 if(diff<0n){if(diff>-1000n)return now;diff+=mask;if(BigInt.asUintN(64,diff)>=now)return 0n;}
 return BigInt.asUintN(64,now-diff);
}

// Clock sync from the connect exchange (O1947.O2168) and ResyncClock replies (O2378); all values bigint ms.
// t0 request sent (client clock), t1 received and t2 replied (server clock), t3 reply received (client clock).
export function clockOffset(t0,t1,t2,t3){
 const transit=BigInt.asUintN(64,(BigInt(t3)-BigInt(t0)-(BigInt(t2)-BigInt(t1)))/2n);
 return {transit,offset:BigInt.asUintN(64,BigInt(t2)+transit-BigInt(t3))};
}
export const serverTimeMs=(localMs,offset)=>BigInt.asUintN(64,BigInt(localMs)+offset);
