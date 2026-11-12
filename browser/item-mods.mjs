import * as THREE from 'three';

export const modFlags=(uids,manifest)=>uids.reduce((bits,uid)=>bits|(manifest.mods[uid]?.modFlag??0),0);
export const orderedMods=(uids,manifest)=>[true,false].flatMap(mesh=>uids.map(uid=>manifest.mods[uid]).filter(m=>m&&Boolean(m.isMesh)===mesh));
const euler=v=>new THREE.Quaternion().setFromEuler(new THREE.Euler(...v.map(x=>x*Math.PI/180),'YXZ'));
export function modSocket(socket,bones){return socket&&{...socket,parent:bones[socket.bone]};}

// Keep the original skin/bindposes (including the separate unlit reticle), with no rest-pose mesh substitution.
export async function createItemModAssets(manifest,assets){
 const templates=new Map();
 for(const [key,def] of Object.entries(manifest.prefabs)){
  const skins=[];for(const s of def.skins){const geometry=new THREE.BufferGeometry();
   for(const [name,Type,size] of [['position',Float32Array,3],['normal',Float32Array,3],['uv',Float32Array,2],['skinIndex',Uint16Array,4],['skinWeight',Float32Array,4]])geometry.setAttribute(name,new THREE.BufferAttribute(await assets.binary(s[name],Type),size));
   const indices=[];for(const [i,part] of s.parts.entries()){const ids=await assets.binary(part,Uint32Array);geometry.addGroup(indices.length,ids.length,i);indices.push(...ids);}geometry.setIndex(indices);geometry.computeBoundingSphere();
   // View Model/Unlit is ported by legacy-materials.mjs (tex.rgb, no fog, Offset -1,-1).
   const materials=await Promise.all(s.materials.map(key=>assets.material(key)));skins.push({s,geometry,materials});
  }templates.set(key,{def,skins});
 }
 return {manifest,build(key,scene){const t=templates.get(key);if(!t)return null;const {def}=t;
  const bones=def.skeleton.map((d,i)=>{const b=new THREE.Bone();b.name=d.name;b.scale.fromArray(d.scale);if(i){b.position.fromArray(d.position);b.quaternion.fromArray(d.rotation);}return b;});
  for(const [i,d]of def.skeleton.entries())if(d.parent>=0)bones[d.parent].add(bones[i]);
  const meshes=t.skins.map(({s,geometry,materials})=>{const m=new THREE.SkinnedMesh(geometry,materials);m.name=s.name;m.bindMode='detached';m.frustumCulled=false;
   m.bind(new THREE.Skeleton(s.bones.map(i=>bones[i]),s.bindposes.map(m=>new THREE.Matrix4().fromArray(m))),new THREE.Matrix4());scene.add(m);return m;});
  return {def,bones,root:bones[0],meshes,socket:modSocket(def.socketOverride,bones),dispose(){bones[0].removeFromParent();for(const m of meshes){scene.remove(m);m.skeleton.dispose();}}};
 }};
}

// InstallToViewModel: mesh attaches with socket local pose, and may replace another socket and zoom fields.
export function installMeshMods(view,uids,modAssets,scene){
 const id=JSON.stringify(uids);if(view.modID===id)return;view.modID=id;
 for(const rig of view.mods??[])rig.dispose();view.mods=[];view.settings=structuredClone(view.def.settings);
 view.sockets=Object.fromEntries(Object.entries(view.def.sockets).map(([name,s])=>[name,modSocket(s,view.bones)]));
 for(const mod of orderedMods(uids,modAssets.manifest).filter(m=>m.isMesh)){
  const socket=view.sockets[mod.attachSocketName];if(!socket?.parent||!mod.vm)continue;const rig=modAssets.build(mod.vm,scene);if(!rig)continue;
  socket.parent.add(rig.root);rig.root.position.fromArray(socket.offset);rig.root.quaternion.copy(euler(socket.eulerRotate));view.mods.push(rig);
  if(mod.socketOverrideName&&rig.socket){view.sockets[mod.socketOverrideName]=rig.socket;if(mod.modifyZoomOffset){view.settings.punchScalar=mod.punchScalar;view.settings.zoomOffset.z=mod.zoomOffsetZ;}}
 }
}
