import * as THREE from 'three';
const H=new THREE.Matrix4().makeScale(1,1,-1),UP=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1);
// Original cookie/laser textures store their mask in alpha with black RGB. Three's colour maps need a
// GPU-format conversion: cookie RGB receives the mask; additive beam/dot use white RGB and mask alpha.
export function alphaMaskPixels(rgba,cookie=false){const out=new Uint8Array(rgba.length);for(let i=0;i<rgba.length;i+=4){out[i]=out[i+1]=out[i+2]=cookie?rgba[i+3]:255;out[i+3]=cookie?255:rgba[i+3];}return out;}
export function modNodeMatrices(def){const out=[];for(const [i,d]of def.skeleton.entries()){
 const m=new THREE.Matrix4().compose(new THREE.Vector3(...(i?d.position:[0,0,0])),i?new THREE.Quaternion(...d.rotation):new THREE.Quaternion(),new THREE.Vector3(...d.scale));
 out.push(d.parent<0?H.clone().multiply(m).multiply(H):out[d.parent].clone().multiply(H).multiply(m).multiply(H));}return out;}
export function modEnabled(mod,flags){return Boolean(flags&(mod.modFlag===1?2048:mod.modFlag===2?4096:0));}
// LaserGraphics.UpdateBeam: transform forward, beamLayers raycast, projected hit distance, widths/radius by distance fraction.
export function laserTrace(data,matrix,raycast){const origin=new THREE.Vector3().setFromMatrixPosition(matrix),direction=new THREE.Vector3(0,0,-1).transformDirection(matrix),ray=new THREE.Ray(origin,direction),hit=data.beamLayers.m_Bits?raycast(ray,data.beamMaxDistance,data.beamLayers.m_Bits):null;
 const point=hit?.position??ray.at(data.beamMaxDistance,new THREE.Vector3()),distance=point.clone().sub(origin).dot(direction),fraction=distance/data.beamMaxDistance;
 return {origin,direction,point,distance,fraction,hit,pointWidth:THREE.MathUtils.lerp(data.beamWidthStart,data.beamWidthEnd,fraction),dotRadius:THREE.MathUtils.lerp(data.dotRadiusStart,data.dotRadiusEnd,fraction)};}
// Unity 4 keeps mesh colours as ColorRGBA32: LaserGraphics.RangeBeamColor/RangeDotColor divide RGB by the largest channel and
// carry it in alpha (/1 beam, /12 dot; the input alpha is dropped), and the shaders multiply it back.
const byte=v=>Math.round(Math.min(1,Math.max(0,v))*255)/255;
export function rangeColor([r,g,b],maxAlpha){const n=r>g?(b>r?b:r):(b>g?b:g);return (n!==0?[r/n,g/n,b/n,n/maxAlpha]:[r,g,b,1/maxAlpha]).map(byte);}
// Quaternion.LookRotation(forward, up) * Vector3.right = normalize(Cross(up, forward)); parallel vectors fall back to FromToRotation.
export function lookRight(forward,up){const f=forward.clone().normalize(),r=new THREE.Vector3().crossVectors(up,f);return r.lengthSq()>1e-12?r.normalize():new THREE.Vector3(1,0,0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z,f));}
// LaserGraphics.RenderBeam in camera space (view: world -> camera, world: camera -> world). Vertices m0..m3 (the mesh draws
// the quad m0, m1, m3, m2); normals carry (+-width, -distance, fraction) for the shader; the dot is two quads, one facing the
// camera ray and one on the surface pushed 1 cm out, only when the surface faces the camera (-normal camera z < 0) and the
// cullLayers linecast to 95 % of the way is clear.
export function laserFrame(d,trace,view,world,clear=()=>true){
 const o=trace.origin.clone().applyMatrix4(view),p=trace.point.clone().applyMatrix4(view),f=p.clone().sub(o).normalize(),hit=Boolean(trace.hit);
 const fraction=hit?trace.fraction:1,distance=hit?trace.distance:d.beamMaxDistance,ow=d.beamWidthStart,pw=hit?trace.pointWidth:d.beamWidthEnd;
 const num=1-(1-Math.abs(f.z))*d.beamOutput,ro=lookRight(f,o).multiplyScalar(ow*0.5),rp=lookRight(f,p).multiplyScalar(pw*0.5);
 const beam={positions:[o.clone().add(ro),o.clone().sub(ro),p.clone().add(rp),p.clone().sub(rp)].map(v=>v.applyMatrix4(world)),
  normals:[[ow,-distance],[-ow,-distance],[pw,-distance],[-pw,-distance]],uvs:[[0,0],[0,1],[fraction,0],[fraction,1]],
  color:rangeColor([d.beamColor.x*num,d.beamColor.y*num,d.beamColor.z*num],1)};
 let dot=null;
 if(hit){const back=trace.hit.normal.clone().negate().transformDirection(view);
  if(back.z<0&&clear()){const r=trace.dotRadius,quad=(forward,push)=>{const right=lookRight(forward,UP),fn=forward.clone().normalize(),up=new THREE.Vector3().crossVectors(fn,right),z=fn.multiplyScalar(push);
    return [[r,-r],[r,r],[-r,-r],[-r,r]].map(([x,y])=>p.clone().addScaledVector(right,x).addScaledVector(up,y).add(z).applyMatrix4(world));};
   dot={quads:[quad(p,0),quad(back,-0.01)],color:rangeColor([d.dotColor.x,d.dotColor.y,d.dotColor.z],12)};}}
 return {beam,dot,num};}

// Effects/LaserBeam (LOD 200 sub-shader) and Effects/LaserDot programs. Third person: Transparent queue, ZTest LEqual; First
// Person: Overlay, ZTest Always, V_MUNITY_MATRIX_P. Both ZWrite Off, BlendOp Max (factors unused), ColorMask RGB. Beam: Fog Off;
// the _ParticleTex lookup uses Unity world position, the interpolated normal and _Time.x/_SinTime.x/_CosTime.x. Dot: x12 range,
// Offset 0,-3000, default (scene) fog.
const PROJ=`#ifdef LASER_VIEW_MODEL
uniform mat4 vmProjection;
#define LASER_PROJECTION vmProjection
#else
#define LASER_PROJECTION projectionMatrix
#endif
`;
const BEAM_VERT=PROJ+`attribute vec4 lcolor;attribute vec2 lnormal;uniform vec4 mainST;varying vec2 vUv;varying vec4 vColor;varying vec3 vWorld;varying vec2 vNormal;
void main(){vUv=uv*mainST.xy+mainST.zw;vColor=lcolor;vWorld=vec3(position.xy,-position.z);vNormal=lnormal;gl_Position=LASER_PROJECTION*(modelViewMatrix*vec4(position,1.0));}`;
const BEAM_FRAG=`uniform sampler2D mainTex;uniform sampler2D particleTex;uniform vec4 particleST;uniform float particleMix;uniform vec3 unityTime;
varying vec2 vUv;varying vec4 vColor;varying vec3 vWorld;varying vec2 vNormal;
void main(){float a=texture2D(mainTex,vUv).r;
 vec2 q=vec2(vNormal.x*unityTime.y+vWorld.z,vNormal.y*unityTime.z+(vWorld.x+vWorld.y-vNormal.x*unityTime.x))*particleST.xy+particleST.zw;
 vec3 n=texture2D(particleTex,q).rgb*2.0-1.0,c=vColor.rgb;float l=length(c*2.0-n-1.0)+1.0;
 gl_FragColor=vec4(((c*max(l*0.5-c,0.0)-c)*particleMix+c)*vColor.a*a,a);}`;
const DOT_VERT=PROJ+`attribute vec4 lcolor;uniform vec4 mainST;varying vec2 vUv;varying vec4 vColor;
#include <fog_pars_vertex>
void main(){vUv=uv*mainST.xy+mainST.zw;vColor=lcolor;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=LASER_PROJECTION*mvPosition;
#include <fog_vertex>
}`;
const DOT_FRAG=`uniform sampler2D mainTex;varying vec2 vUv;varying vec4 vColor;
#include <fog_pars_fragment>
void main(){vec4 r=vColor*texture2D(mainTex,vUv).r;vec3 c=r.a*r.rgb*12.0;
#ifdef USE_FOG
 #ifdef FOG_EXP2
 float f=1.0-exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
 #else
 float f=clamp((vFogDepth-fogNear)/max(fogFar-fogNear,1e-5),0.0,1.0);
 #endif
 c=mix(c,fogColor,f);
#endif
 gl_FragColor=vec4(c,r.a);}`;
// Unity FilterMode 0 point, 1 bilinear (nearest mip), 2 trilinear; TextureWrapMode 0 repeat, 1 clamp.
function sampler(t,e){const mips=Boolean(e?.mipmaps&&t.mipmaps?.length);t.wrapS=t.wrapT=e?.wrap===0?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
 t.magFilter=e?.filter===0?THREE.NearestFilter:THREE.LinearFilter;t.minFilter=e?.filter===0?(mips?THREE.NearestMipmapNearestFilter:THREE.NearestFilter):mips?(e.filter===2?THREE.LinearMipmapLinearFilter:THREE.LinearMipmapNearestFilter):THREE.LinearFilter;
 t.generateMipmaps=false;t.needsUpdate=true;return t;}

// The node a mod's PlaySound attaches to: LampModRep's light (the first exported light), LaserModRep's beam, else the root.
export function modSoundNode(prefab){return prefab?.lights?.[0]?.node??prefab?.lasers?.[0]?.node??null;}

export async function createWeaponModEffects(manifest,scene,{base,raycast,playSound=()=>{},clock=()=>performance.now()/1000}){
 const textures=new Map(),loader=new THREE.TextureLoader(),nodes=new Map(Object.entries(manifest.prefabs).map(([key,p])=>[key,modNodeMatrices(p)])),info=manifest.laserTextures??{},start=clock();
 const texture=async(file,cookie=false)=>{if(!file)return null;const key=file+':'+cookie;if(!textures.has(key)){const source=await loader.loadAsync(base+file),image=source.image,canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);
   const data=context.getImageData(0,0,image.width,image.height),t=new THREE.DataTexture(alphaMaskPixels(data.data,cookie),image.width,image.height);t.flipY=true;t.minFilter=t.magFilter=THREE.LinearFilter;t.needsUpdate=true;source.dispose();textures.set(key,t);}return textures.get(key);};
 // Laser textures as the shader samples them: Alpha8 with Unity's own mip chain (R8, rows bottom-up), RGB noise as stored.
 const laserTexture=async file=>{if(!file)return null;const key=file+':laser';if(textures.has(key))return textures.get(key);const e=info[file];let t;
  if(e?.alpha){const bytes=new Uint8Array(await (await fetch(base+e.alpha)).arrayBuffer()),mips=e.levels.map(([w,h,o])=>({data:bytes.subarray(o,o+w*h),width:w,height:h}));
   t=new THREE.DataTexture(mips[0].data,mips[0].width,mips[0].height,THREE.RedFormat,THREE.UnsignedByteType);t.mipmaps=mips;t.unpackAlignment=1;t.flipY=false;}
  else if(e)t=await loader.loadAsync(base+file);
  else{const a=await texture(file);t=a;}
  textures.set(key,e?sampler(t,e):t);return textures.get(key);};
 for(const p of Object.values(manifest.prefabs)){for(const l of p.lights)await texture(l.cookie,true);for(const laser of p.lasers)for(const k of ['beamMaterial','dotMaterial'])for(const slot of Object.values(manifest.materials[laser[k]].textures??{}))await laserTexture(slot.file);}
 const vmProjection={value:new THREE.Matrix4()},unityTime={value:new THREE.Vector3()},materials=new Map();
 const st=s=>new THREE.Vector4(s?.scale?.x??1,s?.scale?.y??1,s?.offset?.x??0,s?.offset?.y??0);
 function laserMaterial(key,dot){if(materials.has(key))return materials.get(key);const m=manifest.materials[key],tx=m.textures??{},fp=/First Person/.test(m.shader??''),mainTex=textures.get(tx._MainTex?.file+':laser')??null;
  const material=new THREE.ShaderMaterial({name:m.shader,defines:fp?{LASER_VIEW_MODEL:''}:{},vertexShader:dot?DOT_VERT:BEAM_VERT,fragmentShader:dot?DOT_FRAG:BEAM_FRAG,
   uniforms:dot?{...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),mainTex:{value:mainTex},mainST:{value:st(tx._MainTex)},vmProjection}
    :{mainTex:{value:mainTex},particleTex:{value:textures.get(tx._ParticleTex?.file+':laser')??null},mainST:{value:st(tx._MainTex)},particleST:{value:st(tx._ParticleTex)},particleMix:{value:m.floats?._ParticleMix??0.5},unityTime,vmProjection},
   fog:dot,transparent:true,depthWrite:false,depthTest:!fp,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.MaxEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
   blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor,polygonOffset:dot&&!fp,polygonOffsetFactor:0,polygonOffsetUnits:dot&&!fp?-3000:0});
  material.userData.order=fp?4000:10;materials.set(key,material);return material;}
 function laserMesh(count,material){const g=new THREE.BufferGeometry(),index=[];for(let q=0;q<count/4;q++)index.push(q*4,q*4+1,q*4+3,q*4,q*4+3,q*4+2);
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(count*2),2).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('lcolor',new THREE.BufferAttribute(new Float32Array(count*4),4).setUsage(THREE.DynamicDrawUsage));g.setAttribute('lnormal',new THREE.BufferAttribute(new Float32Array(count*2),2).setUsage(THREE.DynamicDrawUsage));g.setIndex(index);
  const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;mesh.renderOrder=material.userData.order;return mesh;}
 // Fixed pools keep shader light counts bounded as characters enter/leave range.
 const lights=Array.from({length:4},()=>{const spot=new THREE.SpotLight(0xffffff,0),point=new THREE.PointLight(0xffffff,0);spot.decay=point.decay=0;scene.add(spot,spot.target,point);return {spot,point};});
 const active=new Map();
 function remove(id,e){for(const x of e.lasers){scene.remove(x.beam,x.dot);x.beam.geometry.dispose();x.dot.geometry.dispose();}scene.remove(e.anchor);active.delete(id);}
 function build(mod,key){const p=manifest.prefabs[key],lasers=p.lasers.map(l=>{const beam=laserMesh(4,laserMaterial(l.beamMaterial,false)),dot=laserMesh(8,laserMaterial(l.dotMaterial,true));
   for(let q=0;q<2;q++)dot.geometry.attributes.uv.array.set([0,0,0,1,1,0,1,1],q*8);scene.add(beam,dot);return {source:l,beam,dot};});
  // LampModRep/LaserModRep.PlaySound: clip.PlayLocal(anyLight/anyBeam transform, zero, 1, Logarithmic, 1, 4), else the item
  // rep's transform: the on/off click is attached to the first light or beam node and follows it while it plays.
  const anchor=new THREE.Object3D();anchor.matrixAutoUpdate=false;scene.add(anchor);
  return {mod,key,p,lasers,lastOn:null,anchor,soundNode:modSoundNode(p)};}
 const write=(attribute,values)=>{values.forEach((v,i)=>attribute.array.set(v,i*attribute.itemSize));attribute.needsUpdate=true;};
 return {sync(records,camera,{viewProjection=null}={}){const seen=new Set(),lampCandidates=[];camera.updateMatrixWorld();
  const t=clock()-start;unityTime.value.set(t/20,Math.sin(t/8),Math.cos(t/8));vmProjection.value.copy(viewProjection??camera.projectionMatrix);
  for(const r of records)for(const uid of r.mods){const mod=manifest.mods[uid];if(!mod||mod.isMesh)continue;const key=r.local?mod.vm:mod.rep;if(!key)continue;const matrix=r.matrix(mod.attachSocketName);if(!matrix)continue;
   const id=r.id+':'+uid;seen.add(id);let e=active.get(id);if(e?.key!==key){if(e)remove(id,e);e=build(mod,key);active.set(id,e);}const on=modEnabled(mod,r.flags);
   e.anchor.matrix.copy(e.soundNode!=null?matrix.clone().multiply(nodes.get(key)[e.soundNode]):matrix);e.anchor.matrixWorldNeedsUpdate=true;
   if(e.lastOn!==null&&e.lastOn!==on){const file=mod.sounds[on?'onSound':'offSound'];if(file)playSound(file,new THREE.Vector3().setFromMatrixPosition(e.anchor.matrix),e.anchor);}e.lastOn=on;e.on=on;
   if(on&&e.p.lights.length)lampCandidates.push({e,matrix,distance:new THREE.Vector3().setFromMatrixPosition(matrix).distanceToSquared(camera.position)});
   for(const l of e.lasers){l.beam.visible=on;l.dot.visible=false;if(!on)continue;const lm=matrix.clone().multiply(nodes.get(key)[l.source.node]),d=l.source.data,trace=laserTrace(d,lm,raycast);e.trace=trace;
    const frame=laserFrame(d,trace,camera.matrixWorldInverse,camera.matrixWorld,()=>{const to=trace.point.clone().sub(camera.position),range=to.length()*0.95;return !raycast(new THREE.Ray(camera.position.clone(),to.normalize()),range,d.cullLayers.m_Bits);});e.frame=frame;
    const g=l.beam.geometry.attributes;write(g.position,frame.beam.positions.map(v=>v.toArray()));write(g.uv,frame.beam.uvs);write(g.lnormal,frame.beam.normals);write(g.lcolor,Array(4).fill(frame.beam.color));
    if(frame.dot){l.dot.visible=true;const a=l.dot.geometry.attributes;write(a.position,frame.dot.quads.flat().map(v=>v.toArray()));write(a.lcolor,Array(8).fill(frame.dot.color));}}
  }
  for(const [id,e]of active)if(!seen.has(id))remove(id,e);
  lampCandidates.sort((a,b)=>a.distance-b.distance);for(const [i,pool]of lights.entries()){pool.spot.intensity=pool.point.intensity=0;const c=lampCandidates[i];if(!c)continue;
   for(const source of c.e.p.lights){const m=c.matrix.clone().multiply(nodes.get(c.e.key)[source.node]),d=source.data,light=d.m_Type===0?pool.spot:pool.point;light.position.setFromMatrixPosition(m);light.color.setRGB(d.m_Color.r,d.m_Color.g,d.m_Color.b);light.distance=d.m_Range;light.intensity=d.m_Intensity*6;light.userData.mask=d.m_CullingMask.m_Bits;
    if(d.m_Type===0){pool.spot.angle=d.m_SpotAngle*Math.PI/360;pool.spot.penumbra=0;pool.spot.map=textures.get(source.cookie+':true')??null;pool.spot.target.position.copy(light.position).add(new THREE.Vector3(0,0,-1).transformDirection(m));}}
  }
 },
 // Lamp point lights whose culling mask includes the View Model layer (13): the view-model pass lights the held item with them
 // (the first-person spot excludes layer 13; its radial light and the third-person lights include it).
 viewLights:()=>lights.map(p=>p.point).filter(l=>l.intensity>0&&(l.userData.mask&8192)),
 viewSpots:()=>lights.map(p=>p.spot).filter(l=>l.intensity>0&&(l.userData.mask&8192)),
 clear(){for(const [id,e]of active)remove(id,e);for(const p of lights)p.spot.intensity=p.point.intensity=0;},
 debug:()=>({effects:[...active].map(([id,e])=>({id,name:e.mod.name,on:e.on,hit:Boolean(e.trace?.hit),point:e.trace?.point.toArray(),origin:e.trace?.origin.toArray(),dot:Boolean(e.frame?.dot),beamColor:e.frame?.beam.color,num:e.frame?.num})),lights:lights.filter(p=>p.spot.intensity>0).length,lasers:[...active.values()].filter(e=>e.on&&e.lasers.length).length})};
}
