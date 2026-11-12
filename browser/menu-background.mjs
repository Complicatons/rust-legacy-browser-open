import * as THREE from 'three';
import {createAssetLoader} from './scene.mjs';
import {LegacyAnimation} from './legacy-animation.mjs';
import {ParticleEffect} from './particles.mjs';

// Original MenuBackground scene. Geometry/camera/skin/animation come from the static export.
export async function loadMenuBackground({base='/assets/recovered/menu-background/',aspect=innerWidth/innerHeight}={}){
 const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original menu background export missing');
 const manifest=await response.json(),assets=createAssetLoader(base,manifest),scene=new THREE.Scene(),data=manifest.camera.data;
 const color=c=>new THREE.Color(c.r,c.g,c.b);scene.background=color(data.m_BackGroundColor);
 const camera=new THREE.PerspectiveCamera(data['field of view'],aspect,data['near clip plane'],data['far clip plane']);camera.matrixAutoUpdate=false;camera.matrix.fromArray(manifest.camera.matrix);camera.updateMatrixWorld(true);
 scene.add(new THREE.AmbientLight(color(manifest.renderSettings.m_AmbientLight),1));
 for(const source of manifest.lights){const d=source.data,matrix=new THREE.Matrix4().fromArray(source.matrix),position=new THREE.Vector3().setFromMatrixPosition(matrix);let light;
  if(d.m_Type===1){light=new THREE.DirectionalLight(color(d.m_Color),d.m_Intensity);light.position.copy(position);light.target.position.copy(position).add(new THREE.Vector3(0,0,-1).transformDirection(matrix));scene.add(light.target);}
  else if(d.m_Type===2){light=new THREE.PointLight(color(d.m_Color),d.m_Intensity,d.m_Range,1);light.position.copy(position);}else throw Error('Unsupported original menu light');scene.add(light);
 }
 // Every mesh, skin buffer and particle texture is requested at once; the scene is still assembled in export order.
 const instanceParts=manifest.instances.map(instance=>assets.parts(instance.mesh,instance.materials,instance.subsets,[],instance.name));instanceParts.forEach(p=>p.catch(()=>{}));
 const skinBuffers=manifest.bear.skins.map(s=>Promise.all([...['position','normal','uv'].map(n=>assets.binary(s[n],Float32Array)),assets.binary(s.skinIndex,Uint16Array),assets.binary(s.skinWeight,Float32Array),...s.parts.map(p=>assets.binary(p,Uint32Array))]));skinBuffers.forEach(p=>p.catch(()=>{}));
 let meshParts=0;for(const [k,instance] of manifest.instances.entries()){const group=new THREE.Group();group.name=instance.name;group.matrixAutoUpdate=false;group.matrix.fromArray(instance.matrix);for(const [i,part]of (await instanceParts[k]).entries()){if(/^Transparent\//.test(manifest.materials[instance.materials[i]].shader)){part.material.transparent=true;part.material.depthWrite=false;}group.add(part);meshParts++;}scene.add(group);}
 const def=manifest.bear,root=new THREE.Group();root.name=def.name;root.matrixAutoUpdate=false;root.matrix.fromArray(def.matrix);
 const bones=def.skeleton.map((b,i)=>{const bone=new THREE.Bone();bone.name=String(i)+'_'+b.name;if(i){bone.position.fromArray(b.position);bone.quaternion.fromArray(b.rotation);bone.scale.fromArray(b.scale);}return bone;});
 for(const [i,b]of def.skeleton.entries())if(b.parent>=0)bones[b.parent].add(bones[i]);root.add(bones[0]);scene.add(root);
 const skinned=[];for(const s of def.skins){const geometry=new THREE.BufferGeometry();
  for(const [name,Type,size]of [['position',Float32Array,3],['normal',Float32Array,3],['uv',Float32Array,2],['skinIndex',Uint16Array,4],['skinWeight',Float32Array,4]])geometry.setAttribute(name,new THREE.BufferAttribute(await assets.binary(s[name],Type),size));
  const indices=[];for(const [i,p]of s.parts.entries()){const values=await assets.binary(p,Uint32Array);geometry.addGroup(indices.length,values.length,i);for(const value of values)indices.push(value);}geometry.setIndex(indices);
  const mesh=new THREE.SkinnedMesh(geometry,await Promise.all(s.materials.map(k=>assets.material(k))));mesh.bindMode='detached';mesh.frustumCulled=false;mesh.bind(new THREE.Skeleton(s.bones.map(i=>bones[i]),s.bindposes.map(m=>new THREE.Matrix4().fromArray(m))),new THREE.Matrix4());scene.add(mesh);skinned.push(mesh);
 }
 const animation=new LegacyAnimation(def.skeleton,def.clips),effects=[],textureLoader=new THREE.TextureLoader();
 const particleTextures=manifest.particles.map(source=>{const file=manifest.materials[source.renderer.material].texture;return file?textureLoader.loadAsync(base+file):null;});particleTextures.forEach(p=>p?.catch(()=>{}));
 for(const [k,source] of manifest.particles.entries()){const mat=manifest.materials[source.renderer.material],texture=mat.texture?await particleTextures[k]:null;if(texture)texture.colorSpace=THREE.SRGBColorSpace;
  const effect=new ParticleEffect(source.data,source.renderer,mat,texture,new THREE.Matrix4().fromArray(source.matrix));effects.push(effect);scene.add(effect.mesh);
 }
 const identity=new THREE.Matrix4();
 return {scene,camera,manifest,frame(dt){if(def.playAutomatically&&def.defaultClip)animation.apply(bones,[{name:def.defaultClip,weight:1}],dt);scene.updateMatrixWorld(true);for(const effect of effects)effect.update(dt,true,identity,camera);},snapshot(){return {instances:manifest.instances.length,meshParts,skins:skinned.length,bones:bones.length,clip:def.defaultClip,particles:effects.reduce((n,e)=>n+e.particles.length,0),time:animation.times.get(def.defaultClip)??0};},resize(width,height){camera.aspect=width/height;camera.updateProjectionMatrix();},dispose(){const geometries=new Set(),materials=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const material of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}if(o.isSkinnedMesh)o.skeleton.dispose();});for(const value of [...geometries,...materials,...textures])value.dispose();scene.clear();}};
}
