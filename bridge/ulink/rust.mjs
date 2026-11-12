// Rust Legacy gameplay payloads over uLink (GAMEPLAY-PROTOCOL.md). Static reconstruction from the decompiled
// server/client Assembly-CSharp; byte layouts are fixture-tested but not yet checked against a captured trace.
import {BitWriter,BitReader} from './bits.mjs';

const f32=Math.fround;
// Mathf.RoundToInt: Math.Round on a float, i.e. round half to even.
function roundToInt(x){const r=Math.round(x);return Math.abs(x%1)===0.5&&r%2!==0?r-1:r;}
// Mathf.DeltaAngle(0, x): signed angle in (-180, 180].
function deltaAngle(x){let d=(x%360+360)%360;if(d>180)d-=360;return d;}

// Angle2.Encode360 / Decode360 (8192 steps per 45 degree octant).
export function encode360(angle){
 let x=f32(deltaAngle(angle));if(x<0)x=f32(x+360);
 const k=Math.floor(Math.floor(x)/45);
 if(k===8)return 0;
 return roundToInt(f32((x-45*k)*182.04444444444445))+8192*k;
}
export function decode360(v){const k=Math.trunc(v/8192),a=f32(k*45+f32((v-k*8192)/65536*360));return a<180?a:a-360;}
export const encodeAngles=({pitch,yaw})=>((encode360(yaw)<<16)|encode360(pitch))|0;
export const decodeAngles=encoded=>({pitch:decode360(encoded&0xffff),yaw:decode360((encoded>>>16)&0xffff)});

// Mono 2.x String.GetHashCode (believed: h = h*31 + c over UTF-16 units, int32). Only the low bit is used.
export function monoStringHash(s){let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return h;}

// HumanController.SendToServer parity bits for GetClientMove stateFlags.
export class MoveParity{
 constructor(userName){this.userName=userName;this.p=undefined;}
 apply(stateFlags){
  let flags=stateFlags&~0x6000&0xffff;
  if(this.p===undefined)this.p=(monoStringHash(this.userName)&1)===1;
  else{flags|=this.p?0x2000:0x4000;this.p=!this.p;}
  return flags;
 }
}

// Value writers/readers for untyped RPC arguments (uLink BitStream codecs).
export const write={
 vector3:(w,v)=>w.f32(v[0]).f32(v[1]).f32(v[2]),
 quaternion:(w,q)=>w.f32(q[0]).f32(q[1]).f32(q[2]).f32(q[3]),
 netEntityID:(w,{p1,viewId,p2})=>{w.u16(p1);return p1===0?w.u16(viewId):w.u16(p2);},
};
export const read={
 vector3:r=>[r.f32(),r.f32(),r.f32()],
 quaternion:r=>[r.f32(),r.f32(),r.f32(),r.f32()],
 netEntityID:r=>{const p1=r.u16();return p1===0?{p1,viewId:r.u16()}:{p1,p2:r.u16()};},
};

// RPC by name on a view (O575 header flags 0x08 | timestamp bits); untyped arguments (server rpcTypeSafe=Off) unless
// typeSafe (0x80: the sender passed explicit NetworkFlags without TypeUnsafe, e.g. NGC calls; ULINK-PROTOCOL.md).
export function encodeRpc({viewId,name,target='server',timestampMs,buffered=false,typeSafe=false},writeArgs=()=>{}){
 const w=new BitWriter();let flags=buffered?24:8;
 if(typeof target==='number')flags|=2;
 if(timestampMs!==undefined)flags|=buffered?96:32;
 if(typeSafe)flags|=128;
 w.u8(flags);if(flags&2)w.u16(target);w.u16(viewId).string(name);
 if(timestampMs!==undefined)w.writeBits(BigInt(timestampMs),buffered?40:16);
 writeArgs(w);return w.toBytes();
}

export function clientMove({viewId,timestampMs,origin,angles,stateFlags}){
 return encodeRpc({viewId,name:'GetClientMove',timestampMs},w=>write.vector3(w,origin).i32(encodeAngles(angles)).u16(stateFlags));
}
export function readClientMoveArgs(r){return {origin:read.vector3(r),angles:decodeAngles(r.i32()),stateFlags:r.u16(),timeAfterServerReceived:r.f32()};}

// uLink Create body (O1947.O2251), read after the header (which carries the view id and a 40-bit timestamp).
// O490.O591 Create: the initial data is the rest of the message (O499 itself), not a length-prefixed blob. Seen on the
// original server: ServerManagement's Create ends right after the three prefab strings.
export function readCreate(r){
 return {owner:r.u16(),group:r.u16(),position:read.vector3(r),rotation:read.quaternion(r),proxyPrefab:r.string(),ownerPrefab:r.string(),serverPrefab:r.string(),initialData:r.raw(r.remainingBytes)};
}

// NGC payloads: plain little-endian .NET layouts inside the byte[] RPC argument.
export function readNgcInstantiate(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 return {prefabIndex:v.getInt32(0,true),innerID:v.getUint16(4,true),position:[0,1,2].map(i=>v.getFloat32(6+4*i,true)),euler:[0,1,2].map(i=>v.getFloat32(18+4*i,true)),initialData:bytes.subarray(30)};
}
export function writeNgcInstantiate({prefabIndex,innerID,position,euler,initialData=new Uint8Array(0)}){
 const b=new Uint8Array(30+initialData.length),v=new DataView(b.buffer);
 v.setInt32(0,prefabIndex,true);v.setUint16(4,innerID,true);position.forEach((x,i)=>v.setFloat32(6+4*i,x,true));euler.forEach((x,i)=>v.setFloat32(18+4*i,x,true));b.set(initialData,30);return b;
}
export function readNgcCall(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),key=v.getInt32(0,true);return {innerID:(key>>>16)&0xffff,messageID:key&0xffff,args:bytes.subarray(4)};}
export function writeNgcCall({innerID,messageID,args=new Uint8Array(0)}){const b=new Uint8Array(4+args.length);new DataView(b.buffer).setInt32(0,(innerID<<16)|(messageID&0xffff),true);b.set(args,4);return b;}
// RPC names on a '!Ng' carrier. The server gives every buffered RPC its own name so it can remove it later
// (NGC.GenerateRPCName, NGCView.GetBufferedCallRPCName): add "A" + innerID hex, buffered call "C" + innerID hex + "_" +
// message hex; unbuffered calls are "C" and destroys "D". NGCInternalView.OnRPC dispatches on the first character only.
export const ngcAction=name=>typeof name==='string'&&'ACD'.includes(name[0]??'_')?name[0]:null;
export const ngcAddName=innerID=>'A'+innerID.toString(16);
export const ngcBufferedCallName=(innerID,messageID)=>'C'+innerID.toString(16)+'_'+messageID.toString(16);
// How the original server puts an NGC call on the wire, by message name (for mocks and fixtures). `info`: the handler
// takes a uLink.NetworkMessageInfo (same set in the decompiled server and client); every other NGC message gets
// NetworkFlags.NoTimestamp (NGC Method.defaultNetworkFlags), so its call is type-safe with no timestamp (e.g.
// LootableObject.SetLooter, ClearLooter, FireBarrel.ReceiveNetState). `buffered`: the server sends it with a Buffered
// RPCMode (LootableObject.SendCurrentLooter, FireBarrel.SetOn, ResourceObject, BasicDoor.InvalidateState for
// non-static doors, DeployableObject, SleepingAvatar), so it carries the per-entity name "C<innerID>_<message>".
const NGC_INFO=new Set(['modelindex','GNUP','ISMV','ITMG','ITMV','ITSM','ITSP','SVUC','SVUF','StopLooting','SACH','SAKL','DoRepair']);
const NGC_BUFFERED=new Set(['SetLooter','ReceiveNetState','modelindex','DOo','GetOwnerInfo','Client_OnKilled','SAAM']);
export const ngcWire=name=>({info:NGC_INFO.has(name),buffered:NGC_BUFFERED.has(name)});

// Inventory.GNUP payload. itemInfo(uniqueID) → {losesCondition, held}; unknown items stop decoding (layout depends on them).
export function readInventory(bytes,itemInfo){
 const r=new BitReader(bytes),capacity=r.u8(),full=r.u8()!==0,slots=[];
 const item=()=>{
  const id=r.i32(),info=itemInfo(id);if(!info)throw new Error('Unknown item datablock '+id);
  const it={datablock:id,uses:r.u8()};
  if(info.losesCondition){it.condition=r.f32();it.maxCondition=r.f32();}
  if(info.held){it.totalModSlots=r.u8();const used=r.u8();it.mods=Array.from({length:used},()=>r.i32());}
  return it;
 };
 if(full){for(let i=0;i<capacity;i++){if(r.u8())slots.push({slot:i,item:item()});}}
 else{const n=r.u8();for(let k=0;k<n;k++){const present=r.u8()!==0,slot=r.u8();slots.push({slot,item:present?item():null});}}
 return {capacity,full,slots};
}

// uLinkExtentions.Read/WriteByteArray_MinimumCalls: int32 length, then the array from its end in chunks
// (odd byte, uint16, uint32, then uint64s), each chunk little-endian over its bytes.
function chunkPlan(n){const plan=[];if(n%2)plan.push(1);if(Math.floor(n/2)%2)plan.push(2);if(Math.floor(n/4)%2)plan.push(4);for(let i=0;i<Math.floor(n/8);i++)plan.push(8);return plan;}
export function readByteArrayMinimal(r){
 const n=r.i32();if(n<=0)return new Uint8Array(0);if(n>r.remainingBytes)throw new RangeError('Byte array longer than buffer');
 const out=new Uint8Array(n);let end=n;
 for(const size of chunkPlan(n)){const v=r.readBits(size*8);for(let i=0;i<size;i++)out[end-size+i]=Number((v>>BigInt(8*i))&0xffn);end-=size;}
 return out;
}
export function writeByteArrayMinimal(w,bytes){
 w.i32(bytes.length);let end=bytes.length;
 for(const size of chunkPlan(bytes.length)){let v=0n;for(let i=0;i<size;i++)v|=BigInt(bytes[end-size+i])<<BigInt(8*i);w.writeBits(v,size*8);end-=size;}
 return w;
}

// Generic untyped RPC argument codec for every parameter type in bridge/ulink/rpc-schema.json.
const argReaders={
 'float':r=>r.f32(),'int':r=>r.i32(),'byte':r=>r.u8(),'sbyte':r=>(r.u8()<<24)>>24,'bool':r=>r.u8()!==0,'ushort':r=>r.u16(),'ulong':r=>r.u64(),
 'string':r=>r.string(),'byte[]':r=>r.blob(),'Vector3':read.vector3,'Quaternion':read.quaternion,'Angle2':r=>decodeAngles(r.i32()),
 'uLink.NetworkViewID':r=>r.u16(),'uLink.NetworkPlayer':r=>r.u16(),'NetEntityID':read.netEntityID,
 'uLink.BitStream':r=>r.raw(r.remainingBytes),
 'ContextMenuData':r=>{const n=r.i32();return Array.from({length:Math.max(n,0)},()=>({name:r.i32(),text:new TextDecoder().decode(readByteArrayMinimal(r))}));},
};
const argWriters={
 'float':(w,v)=>w.f32(v),'int':(w,v)=>w.i32(v),'byte':(w,v)=>w.u8(v),'sbyte':(w,v)=>w.u8(v&0xff),'bool':(w,v)=>w.u8(v?1:0),'ushort':(w,v)=>w.u16(v),'ulong':(w,v)=>w.u64(v),
 'string':(w,v)=>w.string(v),'byte[]':(w,v)=>w.blob(v),'Vector3':write.vector3,'Quaternion':write.quaternion,'Angle2':(w,v)=>w.i32(encodeAngles(v)),
 'uLink.NetworkViewID':(w,v)=>w.u16(v),'uLink.NetworkPlayer':(w,v)=>w.u16(v),'NetEntityID':write.netEntityID,
 'uLink.BitStream':(w,v)=>w.raw(v),
 'ContextMenuData':(w,items)=>{w.i32(items.length);for(const it of items){w.i32(it.name);writeByteArrayMinimal(w,new TextEncoder().encode(it.text));}return w;},
};
// Type-safe streams (header flag 0x80) put the value's BitStreamTypeCode byte before each argument (uLink BitStream
// WriteBytes/ReadBytes: 135 = 128 + Byte, checked on read). Rust's own codecs (Angle2, NetEntityID, ContextMenuData)
// have user codes 64–127 that are not mapped yet; a trailing BitStream argument is appended raw, without a code.
const TYPE_CODES={'bool':1,'sbyte':5,'byte':7,'ushort':11,'int':13,'ulong':19,'float':21,'string':29,'uLink.NetworkPlayer':31,'uLink.NetworkViewID':33,'Vector3':39,'Quaternion':43,'byte[]':135};
function readTypeCode(r,t){
 const code=r.u8(),want=TYPE_CODES[t];
 if(want===undefined?code<64||code>127:code!==want)throw new RangeError(`Type-safe code ${code} should have been ${want??'a user code (64-127)'} for ${t}`);
}
export function readArgs(types,r,typeSafe=false){return types.map(t=>{const f=argReaders[t];if(!f)throw new Error('No codec for RPC parameter type '+t);if(typeSafe&&t!=='uLink.BitStream')readTypeCode(r,t);return f(r);});}
export function writeArgs(types,values,w=new BitWriter(),typeSafe=false){
 if(values.length!==types.length)throw new Error('Argument count mismatch');
 types.forEach((t,i)=>{
  const f=argWriters[t];if(!f)throw new Error('No codec for RPC parameter type '+t);
  if(typeSafe&&t!=='uLink.BitStream'){if(TYPE_CODES[t]===undefined)throw new Error('No type-safe code for RPC parameter type '+t);w.u8(TYPE_CODES[t]);}
  f(w,values[i]);
 });
 return w;
}

// Item actions (ItemRepresentation): ActionStream(n) → RPC "ActionNB"(byte[] untyped stream);
// Action(n, mode, args…) → RPC "ActionN" with the args appended raw (the server handler reads them as its BitStream).
// Layouts from the client datablocks (GAMEPLAY-PROTOCOL.md "Item actions"). All vectors are Unity space.
function hitRecord(w,{target,bodyPart,point}){
 if(target){w.u8(bodyPart??254);write.netEntityID(w,target);}else w.u8(255);
 return write.vector3(w,point);
}
const stream=(n,fill)=>{const w=new BitWriter();fill(w);return {name:`Action${n}B`,types:['byte[]'],args:[w.toBytes()]};};
const direct=(n,types=[],args=[])=>({name:`Action${n}`,types,args});
export const ITEM_ACTIONS={
 'bullet-fire':d=>stream(1,w=>{for(const h of d.hits)hitRecord(w,h);}),           // one record per bullet/pellet
 'bullet-reload':()=>direct(3),
 'melee-hit':d=>stream(1,w=>{if(d.target){w.u8(1);write.netEntityID(w,d.target);}else w.u8(0);write.vector3(w,d.point);w.u8(d.flag?1:0);}),
 'melee-target':d=>direct(2,['NetEntityID'],[d.target]),
 'melee-swing':()=>direct(3),
 'bow-fire':d=>stream(1,w=>{write.vector3(w,d.origin);write.quaternion(w,d.rotation);}),
 'bow-hit':d=>stream(2,w=>{write.netEntityID(w,d.target);write.vector3(w,d.position);}),
 'bow-miss':d=>stream(3,w=>write.vector3(w,d.position)),
 'grenade-throw':d=>stream(1,w=>{write.vector3(w,d.origin);write.vector3(w,d.velocity);}),
 'throwable-throw':d=>{const w=new BitWriter();write.vector3(w,d.origin);write.vector3(w,d.forward);return direct(1,['uLink.BitStream'],[w.toBytes()]);},
 'torch-throw':d=>stream(1,w=>{write.vector3(w,d.origin);write.vector3(w,d.forward);}),
 'torch-toggle':()=>direct(2),
 'bandage-use':()=>direct(3),
 'structure-place':d=>direct(1,['Vector3','Vector3','Vector3','Quaternion','uLink.NetworkViewID'],[d.origin,d.direction,d.position,d.rotation,d.master??0]),
 'deployable-place':d=>direct(1,['Vector3','Vector3'],[d.origin,d.direction]),
};
