import * as THREE from 'three';
import {particleShading,particleMaterial,unpack,markSoftDraw} from './particles.mjs';
// Unity 4 legacy particles (EllipsoidParticleEmitter + ParticleAnimator + ParticleRenderer), used by the first-person flare
// light (FlareLightLegacy1P: Flare_flash, Flare_smoke, Flare_sparks_yellow). Data: fx/manifest.json prefabs[key].legacy
// (tools/export_fx.py); materials use the shipped particle programs from particles.mjs.
// Emitter: rate Random(minEmission, maxEmission) per second (accumulated), energy/size Random(min, max), position inside the
// ellipsoid (scale of the unit sphere, MinEmitterRange hollow), velocity = worldVelocity + localVelocity (emitter axes) +
// rndVelocity * Random(-1, 1)/2 per axis + tangentVelocity (x, y across the surface, z along its normal) + emitter velocity
// * emitterVelocityScale; Simulate In Worldspace false keeps particles in the emitter's space; rndRotation, angular velocity.
// Animator: colour through the 5 colorAnimation keys over the particle's life, force/rndForce (world), damping, sizeGrow.
// Renderer: billboard or stretched (m_StretchParticles 3, lengthScale, velocityScale), m_MaxParticleSize.
// Approximations (no reference implementation in the decompiled code): sizeGrow as a per-second relative growth
// (size *= 1 + sizeGrow * dt), damping as velocity *= damping ^ (dt * 60), ellipsoid used as radii.
const H=new THREE.Matrix4().makeScale(1,1,-1),CORNERS=[[-1,-1],[1,-1],[1,1],[-1,1]];
const v3=o=>new THREE.Vector3(o?.x??0,o?.y??0,o?.z??0);
export const LEGACY_RENDER=Object.freeze({BILLBOARD:0,SORTED_BILLBOARD:2,STRETCH:3,HORIZONTAL:4,VERTICAL:5});
// Colour key k at fraction (1 - energy / startEnergy) * 4 between keys.
export function legacyColor(animator,fraction){const keys=[0,1,2,3,4].map(i=>unpack(animator[`colorAnimation[${i}]`].rgba)),f=Math.min(4,Math.max(0,fraction*4)),i=Math.min(3,Math.floor(f)),t=f-i;
 return keys[i].map((v,c)=>v+(keys[i+1][c]-v)*t);}

export class LegacyParticleEffect{
 // emitter/animator/renderer: serialized component data; material: exported material; nodeMatrix: browser-space node matrix.
 constructor({emitter,animator,renderer},material,texture,nodeMatrix,rng=Math.random){
  Object.assign(this,{emitter,animator,rd:renderer,nodeMatrix,rng});this.particles=[];this.acc=0;this.max=256;this.lastOrigin=null;
  this.shading=particleShading(material?.shader,material);this.world=Boolean(emitter['Simulate in Worldspace?']);
  this.geometry=new THREE.BufferGeometry();this.positions=new Float32Array(this.max*12);this.uvs=new Float32Array(this.max*8);this.colors=new Float32Array(this.max*16);
  const index=new Uint16Array(this.max*6);for(let i=0;i<this.max;i++){index.set([i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3],i*6);this.uvs.set([0,0,1,0,1,1,0,1],i*8);}
  this.geometry.setIndex(new THREE.BufferAttribute(index,1));this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
  this.geometry.setAttribute('uv',new THREE.BufferAttribute(this.uvs,2));this.geometry.setAttribute('pcolor',new THREE.BufferAttribute(this.colors,4).setUsage(THREE.DynamicDrawUsage));
  this.material=particleMaterial(this.shading,texture);this.material.uniforms.map.value=texture??new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);this.material.uniforms.map.value.needsUpdate=true;
  this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.mesh.renderOrder=10;this.geometry.setDrawRange(0,0);
  // Soft-capable shaders (particles.mjs SOFT_PARTICLE_SHADERS) ask for the scene depth while they draw.
  if(this.shading.soft)this.mesh.onBeforeRender=markSoftDraw;}
 range(a,b){return a+(b-a)*this.rng();}
 emit(frame,local,velocity){const e=this.emitter,r=()=>this.rng();
  // Point in the ellipsoid (MinEmitterRange leaves a hollow centre); normal = direction from the centre.
  let dir=new THREE.Vector3();for(let i=0;i<16;i++){dir.set(r()*2-1,r()*2-1,r()*2-1);if(dir.lengthSq()<=1&&dir.lengthSq()>1e-8)break;}if(!(dir.lengthSq()>1e-8))dir.set(0,0,1);
  const radius=this.range(e.m_MinEmitterRange??0,1)*Math.min(1,dir.length());dir.normalize();const pos=dir.clone().multiplyScalar(radius).multiply(v3(e.m_Ellipsoid));
  const tangentX=new THREE.Vector3().crossVectors(dir,Math.abs(dir.y)<0.99?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize(),tangentY=new THREE.Vector3().crossVectors(dir,tangentX);
  const tv=v3(e.tangentVelocity),rv=v3(e.rndVelocity);
  const velLocal=v3(e.localVelocity).add(new THREE.Vector3((r()-0.5)*rv.x,(r()-0.5)*rv.y,(r()-0.5)*rv.z)).addScaledVector(tangentX,tv.x).addScaledVector(tangentY,tv.y).addScaledVector(dir,tv.z);
  // World vectors (Unity world) -> browser space; local vectors through the emitter frame.
  const worldVel=v3(e.worldVelocity).multiply(new THREE.Vector3(1,1,-1)).addScaledVector(velocity,e.emitterVelocityScale??0);
  const energy=this.range(e.minEnergy,e.maxEnergy),p={energy,start:energy,size:this.range(e.minSize,e.maxSize),rot:e.rndRotation?r()*Math.PI*2:0,
   spin:THREE.MathUtils.degToRad((e.angularVelocity??0)+(r()-0.5)*(e.rndAngularVelocity??0)*2)};
  if(this.world){p.pos=pos.applyMatrix4(frame);p.vel=velLocal.applyMatrix3(new THREE.Matrix3().setFromMatrix4(frame)).add(worldVel);}
  else {p.pos=pos;p.vel=velLocal.add(worldVel.applyMatrix3(local));}
  this.particles.push(p);}
 update(dt,emitting,rootMatrix,camera){const e=this.emitter,a=this.animator,frame=new THREE.Matrix4().multiplyMatrices(rootMatrix,this.nodeMatrix).multiply(H),local=new THREE.Matrix3().setFromMatrix4(frame).invert();
  const origin=new THREE.Vector3().setFromMatrixPosition(frame),velocity=this.lastOrigin&&dt>0?origin.clone().sub(this.lastOrigin).divideScalar(dt):new THREE.Vector3();this.lastOrigin=origin;
  if(emitting&&e.m_Emit&&e.m_Enabled!==false){if(e.m_OneShot){if(!this.shot){this.shot=true;const n=Math.round(this.range(e.minEmission,e.maxEmission));for(let i=0;i<n&&this.particles.length<this.max;i++)this.emit(frame,local,velocity);}}
   else {this.acc+=this.range(e.minEmission,e.maxEmission)*dt;while(this.acc>=1){this.acc-=1;if(this.particles.length<this.max)this.emit(frame,local,velocity);}}}
  const force=v3(a?.force).multiply(new THREE.Vector3(1,1,-1)),rnd=v3(a?.rndForce),damping=a?.damping??1,grow=a?.sizeGrow??0;
  for(const p of this.particles){p.energy-=dt;
   const f=force.clone().add(new THREE.Vector3((this.rng()-0.5)*rnd.x,(this.rng()-0.5)*rnd.y,-(this.rng()-0.5)*rnd.z));
   p.vel.addScaledVector(this.world?f:f.applyMatrix3(local),dt);if(damping!==1)p.vel.multiplyScalar(Math.pow(damping,dt*60));
   p.pos.addScaledVector(p.vel,dt);p.rot+=p.spin*dt;if(grow)p.size*=1+grow*dt;}
  this.particles=this.particles.filter(p=>p.energy>0);this.draw(frame,camera);}
 draw(frame,camera){const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1),forward=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,2).negate().normalize();
  const lin=new THREE.Matrix3().setFromMatrix4(frame),c=new THREE.Vector3(),va=new THREE.Vector3(),vb=new THREE.Vector3(),v=new THREE.Vector3(),stretch=this.rd.m_StretchParticles===LEGACY_RENDER.STRETCH;
  const maxScreen=this.rd.m_MaxParticleSize??0,planeScale=camera.fov?2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*Math.max(1,camera.aspect??1):0,tint=this.shading.tint;let n=0;
  for(const p of this.particles){c.copy(p.pos);if(!this.world)c.applyMatrix4(frame);let size=p.size;
   if(maxScreen>0&&planeScale){const depth=v.copy(c).sub(camera.position).dot(forward);if(depth>0)size=Math.min(size,maxScreen*planeScale*depth);}
   if(stretch){v.copy(p.vel);if(!this.world)v.applyMatrix3(lin);const along=v.clone().normalize(),side=new THREE.Vector3().crossVectors(along,c.clone().sub(camera.position)).normalize();
    va.copy(side).multiplyScalar(size*0.5);vb.copy(along).multiplyScalar((size*this.rd.m_LengthScale+v.length()*(this.rd.m_VelocityScale??0))*0.5);}
   else {const cs=Math.cos(p.rot),sn=Math.sin(p.rot);va.copy(right).multiplyScalar(cs*size*0.5).addScaledVector(up,sn*size*0.5);vb.copy(up).multiplyScalar(cs*size*0.5).addScaledVector(right,-sn*size*0.5);}
   for(let k=0;k<4;k++){const [sx,sy]=CORNERS[k];this.positions.set([c.x+va.x*sx+vb.x*sy,c.y+va.y*sx+vb.y*sy,c.z+va.z*sx+vb.z*sy],(n*4+k)*3);}
   const col=this.animator?.['Does Animate Color?']?legacyColor(this.animator,1-p.energy/p.start):[1,1,1,1],rgba=col.map((x,i)=>x*tint[i]);
   for(let k=0;k<4;k++)this.colors.set(rgba,(n*4+k)*4);if(++n>=this.max)break;}
  this.geometry.setDrawRange(0,n*6);this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.pcolor.needsUpdate=true;}
 get finished(){return false;}
 dispose(){this.geometry.dispose();this.material.dispose();}
}
// The legacy systems of one exported prefab (fx manifest entry), grouped per node. texture(file) -> THREE.Texture.
export function legacyEffects(fxPrefab,prefab,materials,texture,rng=Math.random){const byNode=new Map();
 for(const c of fxPrefab?.legacy??[]){if(!c.active)continue;const n=byNode.get(c.node)??{};if(c.kind==='EllipsoidParticleEmitter')n.emitter=c.data;else if(c.kind==='ParticleAnimator')n.animator=c.data;else if(c.kind==='ParticleRenderer'){n.renderer=c.data;n.material=c.materials?.[0];}byNode.set(c.node,n);}
 const out=[];for(const [node,n] of byNode){if(!n.emitter||!n.renderer||n.renderer.m_Enabled===false)continue;const m=materials[n.material];
  out.push(Object.assign(new LegacyParticleEffect(n,m,texture(m?.textures?._MainTex?.file??m?.texture),new THREE.Matrix4().fromArray(prefab.nodes[node].matrix),rng),{node,name:prefab.nodes[node].name}));}
 return out;}
