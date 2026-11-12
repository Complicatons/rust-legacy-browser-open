// Rust Legacy gameplay payload codec (bridge/ulink/rust.mjs). Fixtures derived by hand from the decompiled rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BitWriter,BitReader} from '../bridge/ulink/bits.mjs';
import {decodeHeader} from '../bridge/ulink/ulink.mjs';
import {encode360,decode360,encodeAngles,decodeAngles,monoStringHash,MoveParity,clientMove,readClientMoveArgs,readCreate,readNgcInstantiate,writeNgcInstantiate,readNgcCall,writeNgcCall,readInventory,write,read} from '../bridge/ulink/rust.mjs';

test('Angle2 octant encoding matches Encode360/Decode360', ()=>{
 assert.deepEqual([0,45,90,180,270,-90,360].map(encode360),[0,8192,16384,32768,49152,49152,0]);
 assert.equal(encode360(359.99),65534);
 for(const a of [-179.5,-37.25,0.01,12.5,89.99,135,179.9]){assert.ok(Math.abs(decode360(encode360(a))-a)<0.01,String(a));}
 const e=encodeAngles({pitch:-30,yaw:90});
 assert.equal(e,(16384<<16)|encode360(-30));
 const d=decodeAngles(e);assert.ok(Math.abs(d.pitch+30)<0.01&&Math.abs(d.yaw-90)<0.01);
});

test('Mono string hash and the GetClientMove parity sequence', ()=>{
 assert.equal(monoStringHash('a'),97);
 assert.equal(monoStringHash('ab'),97*31+98);
 assert.equal(monoStringHash('x'.repeat(20))|0,monoStringHash('x'.repeat(20)));
 const odd=new MoveParity('a'); // 97 is odd → p starts true
 assert.deepEqual([odd.apply(0x0001),odd.apply(0x0001),odd.apply(0x0001),odd.apply(0x6001)],[0x0001,0x2001,0x4001,0x2001]);
 const evenName='b';assert.equal(monoStringHash(evenName)&1,0);
 const p=new MoveParity(evenName);assert.deepEqual([p.apply(0),p.apply(0),p.apply(0)],[0,0x4000,0x2000]);
});

test('GetClientMove RPC wire layout', ()=>{
 const bytes=clientMove({viewId:0x0102,timestampMs:0x12345678n,origin:[1,2,3],angles:{pitch:0,yaw:45},stateFlags:0x2005});
 assert.deepEqual([...bytes.slice(0,4)],[0x28,0x02,0x01,13]);
 const {header,body}=decodeHeader(bytes);
 assert.deepEqual([header.viewId,header.rpc,header.timestampBits,header.timestampLow,header.typeSafe,header.target],[0x0102,'GetClientMove',16,0x5678n,false,'server']);
 assert.deepEqual(read.vector3(body),[1,2,3]);
 assert.equal(body.i32(),8192<<16);
 assert.equal(body.u16(),0x2005);
 const w=new BitWriter();write.vector3(w,[4,5,6]).i32(encodeAngles({pitch:10,yaw:20})).u16(7).f32(0.25);
 const m=readClientMoveArgs(new BitReader(w.toBytes()));assert.deepEqual([m.origin,m.stateFlags,m.timeAfterServerReceived],[[4,5,6],7,0.25]);
});

test('NetEntityID, Create and NGC payloads', ()=>{
 const w=new BitWriter();write.netEntityID(w,{p1:0,viewId:77});write.netEntityID(w,{p1:3,p2:9});
 const r=new BitReader(w.toBytes());assert.deepEqual([read.netEntityID(r),read.netEntityID(r)],[{p1:0,viewId:77},{p1:3,p2:9}]);
 const c=new BitWriter().u16(4).u16(0);write.vector3(c,[1,2,3]);write.quaternion(c,[0,0,0,1]);c.string(':player_soldier').string(':player_soldier').string(':player_soldier').raw(Uint8Array.of(1,2)); // initial data = rest of the message (original server)
 const created=readCreate(new BitReader(c.toBytes()));
 assert.deepEqual([created.owner,created.ownerPrefab,[...created.initialData],created.rotation],[4,':player_soldier',[1,2],[0,0,0,1]]);
 const inst=writeNgcInstantiate({prefabIndex:-123456,innerID:5,position:[1,2,3],euler:[0,90,0],initialData:Uint8Array.of(9)});
 assert.equal(inst.length,31);
 const back=readNgcInstantiate(inst);assert.deepEqual([back.prefabIndex,back.innerID,back.position,back.euler,[...back.initialData]],[-123456,5,[1,2,3],[0,90,0],[9]]);
 const call=writeNgcCall({innerID:5,messageID:2,args:Uint8Array.of(7)});
 assert.deepEqual([...call],[2,0,5,0,7]);
 assert.deepEqual(readNgcCall(call).messageID,2);
});

test('inventory GNUP full and dirty payloads', ()=>{
 const info=id=>({1234:{losesCondition:true,held:true},55:{losesCondition:false,held:false}})[id];
 const full=new BitWriter().u8(3).u8(1)
  .u8(1).i32(1234).u8(7).f32(0.5).f32(1).u8(3).u8(1).i32(99)
  .u8(0)
  .u8(1).i32(55).u8(20).toBytes();
 const f=readInventory(full,info);
 assert.deepEqual(f,{capacity:3,full:true,slots:[{slot:0,item:{datablock:1234,uses:7,condition:0.5,maxCondition:1,totalModSlots:3,mods:[99]}},{slot:2,item:{datablock:55,uses:20}}]});
 const dirty=new BitWriter().u8(3).u8(0).u8(2).u8(0).u8(1).u8(1).u8(2).i32(55).u8(4).toBytes();
 assert.deepEqual(readInventory(dirty,info).slots,[{slot:1,item:null},{slot:2,item:{datablock:55,uses:4}}]);
 assert.throws(()=>readInventory(new BitWriter().u8(1).u8(1).u8(1).i32(999).toBytes(),info),/Unknown item/);
});

test('generic RPC argument codec covers every schema type, including the reversed byte-array chunks', async()=>{
 const {readArgs,writeArgs,readByteArrayMinimal,writeByteArrayMinimal}=await import('../bridge/ulink/rust.mjs');
 const schema=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
 const types=[...new Set(Object.values(schema).flat().flatMap(h=>h.params))];
 const sample={'float':1.5,'int':-7,'byte':200,'sbyte':-3,'bool':true,'ushort':65000,'ulong':76561198000000001n,'string':'hi','byte[]':Uint8Array.of(1,2),'Vector3':[1,2,3],'Quaternion':[0,0,0,1],'Angle2':{pitch:0,yaw:90},'uLink.NetworkViewID':5,'uLink.NetworkPlayer':6,'NetEntityID':{p1:0,viewId:9},'ContextMenuData':[{name:3,text:'Open'}]};
 const plain=types.filter(t=>t!=='uLink.BitStream');
 assert.deepEqual(plain.filter(t=>!(t in sample)),[]);
 const back=readArgs(plain,new BitReader(writeArgs(plain,plain.map(t=>sample[t])).toBytes()));
 plain.forEach((t,i)=>{if(t==='Angle2')assert.ok(Math.abs(back[i].yaw-90)<0.01);else assert.deepEqual(back[i],sample[t],t);});
 // 11 bytes: chunks odd byte [10], uint16 [8..9], then uint64 [0..7], each little-endian over its slice.
 const bytes=Uint8Array.from({length:11},(_,i)=>i+1);
 const w=writeByteArrayMinimal(new BitWriter(),bytes);
 assert.deepEqual([...w.toBytes()],[11,0,0,0, 11, 9,10, 1,2,3,4,5,6,7,8]);
 assert.deepEqual(readByteArrayMinimal(new BitReader(w.toBytes())),bytes);
});

test('item action layouts match the client datablock writers', async()=>{
 const {ITEM_ACTIONS,readArgs,read}=await import('../bridge/ulink/rust.mjs');
 const fire=ITEM_ACTIONS['bullet-fire']({hits:[{target:{p1:0,viewId:7},bodyPart:2,point:[1,2,3]},{point:[4,5,6]}]});
 assert.equal(fire.name,'Action1B');
 const r=new BitReader(fire.args[0]);
 assert.deepEqual([r.u8(),read.netEntityID(r),read.vector3(r),r.u8(),read.vector3(r)],[2,{p1:0,viewId:7},[1,2,3],255,[4,5,6]]);
 const melee=new BitReader(ITEM_ACTIONS['melee-hit']({point:[0,1,0],flag:true}).args[0]);
 assert.deepEqual([melee.u8(),read.vector3(melee),melee.u8()],[0,[0,1,0],1]);
 const place=ITEM_ACTIONS['structure-place']({origin:[0,1,0],direction:[0,0,1],position:[0,0,5],rotation:[0,0,0,1]});
 assert.deepEqual([place.name,place.types.length,place.args[4]],['Action1',5,0]);
 assert.equal(ITEM_ACTIONS['throwable-throw']({origin:[0,0,0],forward:[0,0,1]}).types[0],'uLink.BitStream');
 assert.equal(ITEM_ACTIONS['bow-miss']({position:[1,1,1]}).name,'Action3B');
});
