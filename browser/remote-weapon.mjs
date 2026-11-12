import {Vector3} from 'three';

// ItemRepresentation.Action1/Action1B forwards the datablock's untyped stream, not a browser command.
export function remoteWeaponAction(kind,bytes,data={}){
 if(!(bytes instanceof Uint8Array))return null;
 const r=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
 const vector=n=>Array.from({length:n},()=>{const x=r.getFloat32(at,true);at+=4;if(!Number.isFinite(x))throw Error('nonfinite');return x;});
 try {let result;
  if(kind==='BowWeaponDataBlock'){const origin=vector(3),rotation=vector(4);if(Math.hypot(...rotation)<0.001)return null;result={type:'bow',origin,rotation};}
  else if(['BulletWeaponDataBlock','ShotgunDataBlock','StrikeGunDataBlock'].includes(kind)){
   // StrikeGunDataBlock (HandCannon) inherits ShotgunDataBlock's pellet stream.
   const count=kind==='BulletWeaponDataBlock'?1:data.numPellets;if(!Number.isInteger(count)||count<1||count>64)return null;
   const hits=[];for(let i=0;i<count;i++){const part=r.getUint8(at++);let target=null;if(part<255){const p1=r.getUint16(at,true),id=r.getUint16(at+2,true);at+=4;target=p1?{p1,p2:id}:{p1,viewId:id};}hits.push({part,target,point:vector(3)});}result={type:'gun',hits};
  }else return null;
  return at===bytes.byteLength?result:null;
 }catch{return null;}
}

// MeleeWeaponDataBlock.DoAction1 (relayed by the server to everyone but the owner, unchanged): bool hasEntity,
// [NetEntityID], Vector3 world point, bool tree flag. Exact length only.
export function remoteMeleeHit(bytes){
 if(!(bytes instanceof Uint8Array))return null;
 const r=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0,target=null;
 try{const has=r.getUint8(at++);if(has>1)return null;
  if(has){const p1=r.getUint16(at,true),id=r.getUint16(at+2,true);at+=4;target=p1?{p1,p2:id}:{p1,viewId:id};}
  const point=[0,0,0].map(()=>{const x=r.getFloat32(at,true);at+=4;return x;});if(!point.every(Number.isFinite))return null;
  const tree=r.getUint8(at++);if(tree>1)return null;
  return at===bytes.byteLength?{type:'hit',target,point,tree:Boolean(tree)}:null;
 }catch{return null;}
}

// ReadHitInfo: a defined remote body part uses its animated bone; other hits use the entity root.
// Player bone matrices map unreflected Unity locals; props and wildlife use reflected browser locals.
export function remoteBulletEnd(hit,bodies,client){
 const p=new Vector3(...hit.point),t=hit.target;
 if(t){const matches=b=>t.p1?b.online?.innerID===t.p2&&client.views.get(b.online.carrier)?.group===t.p1:b.onlineActor?.viewId===t.viewId;
  const candidates=bodies.filter(matches),bone=hit.part<120&&candidates.find(b=>b.bodyPart===hit.part),body=bone||candidates[0];
  if(body){if(bone)return p.applyMatrix4(bone.motion);if(body.onlineActor?.root)return p.applyMatrix4(body.onlineActor.root);p.z=-p.z;return p.applyMatrix4(body.onlineRoot??body.motion);}}
 p.z=-p.z;return p;
}

export function remoteMods(bytes,items){
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes[0]>5||bytes.length!==1+bytes[0]*4)return null;
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),byUID=new Map(Object.values(items).filter(i=>i.data.modFlag!=null).map(i=>[i.data._uniqueID,i.data.modFlag]));let flags=0;
 const mods=[];for(let i=0;i<bytes[0];i++){const uid=d.getInt32(1+i*4,true);if(!byUID.has(uid))return null;mods.push(uid);flags|=byUID.get(uid);}return {mods,flags};
}
