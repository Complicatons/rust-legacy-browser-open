import {Group,Vector3,Quaternion,Matrix4,Ray,TextureLoader,ShaderMaterial,Vector4,AdditiveBlending,DoubleSide,SRGBColorSpace} from 'three';
import {TracerFlight} from './tracer-flight.mjs';
import {createSurfaceResolver} from './surface-routing.mjs';
import {quickLightFor,quickLightStep} from './presentation-extras.mjs';
const mask=406721553,forward=new Vector3(0,0,-1);

export async function createTracerEffects(manifest,assets,scene,{base,raycast,makeEffects,playSound,random=Math.random,presentation=null,lights=[],lightScale=6}={}){
 const templates=new Map(),textures=new Map(),materialCache=new Map(),flights=[],decals=[],impacts=[];let count=0,hitCount=0,lastImpact=null,quickLightCount=0;
 // QuickLight impact prefabs (MetalImpact): the prefab's Light at its node, from a pool of point lights (a free one, else
 // the one closest to going out), shrinking per quickLightStep. Intensities are Unity's x lightScale, as for explosions.
 const quickLights=lights.map(light=>({light,range:0,intensity:0,duration:1}));
 function quickLight(key,p,matrix){const q=quickLightFor(presentation,key),L=p.components?.Light?.[0];if(!q||!L||!quickLights.length)return false;
  const slot=quickLights.find(s=>s.range<=0)??quickLights.reduce((a,b)=>a.range<=b.range?a:b),c=L.data.m_Color;
  Object.assign(slot,{range:L.data.m_Range,intensity:L.data.m_Intensity,duration:q.duration});slot.light.color.setRGB(c.r,c.g,c.b);
  slot.light.position.setFromMatrixPosition(matrix.clone().multiply(new Matrix4().fromArray(p.nodes[L.node].matrix)));showLight(slot);quickLightCount++;return true;}
 function showLight(s){s.light.distance=s.range;s.light.intensity=s.range>0?s.intensity*lightScale:0;}
 async function material(key){if(materialCache.has(key))return materialCache.get(key);const m=manifest.materials[key],s=m.textures?._MainTex;
  let map;if(s){if(!textures.has(s.file)){const t=await new TextureLoader().loadAsync(base+s.file);t.colorSpace=SRGBColorSpace;textures.set(s.file,t);}map=textures.get(s.file);}
  const tint=m.colors?._TintColor??m.color,additive=m.shader==='Particles/Additive';let mat;
  if(additive)mat=new ShaderMaterial({uniforms:{map:{value:map},tint:{value:new Vector4(tint.r,tint.g,tint.b,tint.a)},st:{value:new Vector4(s?.scale.x??1,s?.scale.y??1,s?.offset.x??0,s?.offset.y??0)}},vertexShader:'varying vec2 vUv; uniform vec4 st; void main(){vUv=uv*st.xy+st.zw; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D map; uniform vec4 tint; varying vec2 vUv; void main(){gl_FragColor=2.0*tint*texture2D(map,vUv);\n#include <colorspace_fragment>\n}',transparent:true,depthWrite:false,blending:AdditiveBlending,side:DoubleSide});
  else mat=(await assets.material(key)).clone();
  mat.name=m.name;materialCache.set(key,mat);return mat;
 }
 async function template(key){if(templates.has(key))return templates.get(key);const p=manifest.prefabs[key];if(!p)return null;const root=new Group();root.name=p.name;
  for(const r of p.renderers){const part=new Group();part.matrixAutoUpdate=false;part.matrix.fromArray(r.matrix);
   const meshes=await assets.parts(r.mesh,r.materials,r.materials.map((_,i)=>i),null,r.name);
   for(let i=0;i<meshes.length;i++){meshes[i].material=await material(r.materials[i]);part.add(meshes[i]);}root.add(part);
  }templates.set(key,root);return root;
 }
 for(const w of Object.values(manifest.weapons)){const key=w.prefabs?.tracerPrefab,p=manifest.prefabs[key];if(!p)continue;await template(key);for(const entry of p.components.Tracer??[])if(entry.effects?.decalPrefab)await template(entry.effects.decalPrefab);}
 const terrain=manifest.surfaceRoutes?.terrain,indices=terrain?await assets.binary({file:terrain.file,count:terrain.width*terrain.height},Uint8Array):null;
 const surfaceFor=createSurfaceResolver(manifest,indices);
 // EffectSoundPlayer.Start on an instantiated impact prefab: one random clip at its position, volume 1, 1..10 m.
 function effectSound(p,position){const player=(p?.components?.EffectSoundPlayer??[]).find(e=>e.enabled!==false&&e.sounds?.length);const file=player?.sounds[Math.floor(random()*player.sounds.length)];if(file)playSound?.(file,position,1,10);return file??null;}
 function collision(entry,event){if(!event.near)return;hitCount++;const hit=event.hit,position=new Vector3(...hit.point),normal=new Vector3(...hit.normal),rotation=new Quaternion().setFromUnitVectors(forward,normal);
  const surface=surfaceFor(hit),keys=surface?.bulletEffects??[],key=keys[Math.floor(random()*keys.length)],p=manifest.prefabs[key];lastImpact={surface:surface?.name,effect:key,position:hit.point,layer:hit.layer,genericDecal:event.genericDecal};
  if(p&&makeEffects){const effects=makeEffects(p),matrix=new Matrix4().compose(position.clone().addScaledVector(normal,0.01),rotation,new Vector3(p.rootScale.x,p.rootScale.y,p.rootScale.z));
   for(const fx of effects)scene.add(fx.mesh);impacts.push({effects,matrix,age:0});lastImpact.sound=effectSound(p,position);lastImpact.light=quickLight(key,p,matrix);}
  if(!event.genericDecal)return;
  const sounds=entry.component.sounds?.impactSounds??[],sound=sounds[Math.floor(random()*sounds.length)];if(sound)playSound?.(sound,position,2,15);
  const decalKey=entry.component.effects?.decalPrefab,source=templates.get(decalKey),prefab=manifest.prefabs[decalKey];if(!source)return;
  const root=source.clone();root.position.copy(position).addScaledVector(normal,0.01+random()*0.02);root.quaternion.copy(rotation).multiply(new Quaternion().setFromAxisAngle(forward,(Math.floor(random()*60)-30)*Math.PI/180));root.scale.set(prefab.rootScale.x,prefab.rootScale.y,prefab.rootScale.z);scene.add(root);
  const body=hit.body,attachment=body?.deployed?.view?.group??body?.structure?.view?.group;
  if(attachment){attachment.updateMatrixWorld(true);attachment.attach(root);}
  decals.push({root,age:0,body});
 }
 return {
  flights,decals,impacts,surfaceFor,
  spawn(key,from,to,{range=800,silenced=false}={}){const prefab=manifest.prefabs[key],component=prefab?.components.Tracer?.[0],template=templates.get(key);if(!component||!template)return false;
   const direction=to.clone().sub(from);if(direction.lengthSq()<1e-12)return false;direction.normalize();
   const s=prefab.rootScale,flight=new TracerFlight(from.toArray(),direction.toArray(),component.data,{range,rootScale:[s.x,s.y,s.z],silenced,random}),root=template.clone();root.quaternion.setFromUnitVectors(forward,direction);root.position.copy(from);root.scale.fromArray(flight.scale);scene.add(root);flights.push({flight,root,component});count++;return true;
  },
  frame(dt,camera){
   // Lights made earlier shrink first, so a new impact light is drawn once at its full range (its first Update is next frame).
   for(const s of quickLights)if(s.range>0)showLight(quickLightStep(s,dt));
   for(let i=flights.length-1;i>=0;i--){const e=flights[i],event=e.flight.update(dt,(position,direction,range)=>{const h=raycast(new Ray(new Vector3(...position),new Vector3(...direction)),range,b=>Boolean(b&&!(mask&(1<<(b.layer??0)))));return h&&{point:h.position.toArray(),normal:h.normal.toArray(),layer:h.body?.layer??0,body:h.body,terrain:h.terrain};},camera.position.toArray());
    // Tracer.Update: a hit more than 75 m from the camera destroys the tracer before anything else (event.near false), so
    // only a near hit pushes a non-kinematic rigidbody (a corpse) with AddForceAtPosition.
    if(event){if(event.near)event.hit.body?.rigidImpact?.(new Vector3(...event.hit.point),new Vector3(...e.flight.direction));collision(e,event);}e.root.position.fromArray(e.flight.position);e.root.scale.fromArray(e.flight.scale);if(e.flight.dead){e.root.removeFromParent();flights.splice(i,1);}
   }
   for(let i=decals.length-1;i>=0;i--){const d=decals[i];d.age+=dt;if(d.age>=15||d.body?.deployed?.destroyed||d.body?.structure?.destroyed){d.root.removeFromParent();decals.splice(i,1);}}
   for(let i=impacts.length-1;i>=0;i--){const e=impacts[i];e.age+=dt;if(e.age>=(e.life??1)){for(const fx of e.effects){scene.remove(fx.mesh);fx.dispose();}impacts.splice(i,1);}else for(const fx of e.effects)fx.update(dt,true,e.matrix,camera);}
  },
  // SurfaceInfo.DoImpact-style one-shot effect prefab (melee/arrow impacts): its particles at a world pose, removed
  // after `life` seconds (DoImpact 1 s, ArrowMovement 1.5 s), and its EffectSoundPlayer clip.
  impact(key,position,rotation,life=1){const p=manifest.prefabs[key];if(!p)return null;const sound=effectSound(p,position);if(!makeEffects)return {sound,particles:0};const effects=makeEffects(p);
   const matrix=new Matrix4().compose(position.clone(),rotation.clone(),new Vector3(p.rootScale.x,p.rootScale.y,p.rootScale.z));for(const fx of effects)scene.add(fx.mesh);impacts.push({effects,matrix,age:0,life});return {sound,particles:effects.length,light:quickLight(key,p,matrix)};},
  clear(){for(const s of quickLights){s.range=0;showLight(s);}for(const e of flights)e.root.removeFromParent();flights.length=0;for(const d of decals)d.root.removeFromParent();decals.length=0;for(const e of impacts)for(const fx of e.effects){scene.remove(fx.mesh);fx.dispose();}impacts.length=0;},
  debug(){return {count,active:flights.length,visible:flights.filter(e=>e.flight.scale[0]>0&&e.flight.scale[1]>0).length,hits:hitCount,decals:decals.length,impacts:impacts.length,lastImpact,quickLights:{made:quickLightCount,lit:quickLights.map(s=>({range:s.range,intensity:s.light.intensity}))}};}
 };
}
