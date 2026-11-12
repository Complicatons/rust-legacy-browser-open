import {BufferGeometry,BufferAttribute,Mesh,ShaderMaterial,Vector3,Vector4,AdditiveBlending,DoubleSide} from 'three';

// Unity 4 TrailRenderer on WorldArrow (tools/export_trails.py): points are dropped once the transform has moved
// m_MinVertexDistance from the last one and live m_Time seconds; width runs from m_StartWidth at the head to
// m_EndWidth at the oldest point and the five m_Colors keys are spread evenly over the same age range. The strip
// faces the camera. ArrowMovement disables the renderer on impact (it disappears at once).
// The material is Particles/Additive with no texture: 2 * _TintColor * vertex colour, Blend SrcAlpha One.
// Exact Unity vertex placement/tessellation of the strip is not reproduced.
export function trailState(def,points,head,time){
 const life=def.time>0?def.time:0,kept=points.filter(p=>time-p.time<life);
 const all=[...kept,{position:head,time}];
 return all.map(p=>{const age=life>0?Math.min(1,Math.max(0,(time-p.time)/life)):0;return {position:p.position,width:def.startWidth+(def.endWidth-def.startWidth)*age,color:gradient(def.colors,age)};});
}
export function gradient(colors,t){if(!colors?.length)return {r:1,g:1,b:1,a:1};const x=Math.min(1,Math.max(0,t))*(colors.length-1),i=Math.min(colors.length-2,Math.floor(x)),f=x-i,a=colors[i],b=colors[i+1]??a;
 return {r:a.r+(b.r-a.r)*f,g:a.g+(b.g-a.g)*f,b:a.b+(b.b-a.b)*f,a:a.a+(b.a-a.a)*f};}

const MAX=64;
export class ArrowTrail{
 constructor(def,material,scene){
  this.def=def;this.points=[];this.enabled=def.enabled!==false;this.scene=scene;
  const tint=material?.colors?._TintColor??{r:.5,g:.5,b:.5,a:.5};
  this.geometry=new BufferGeometry();this.geometry.setAttribute('position',new BufferAttribute(new Float32Array(MAX*2*3),3));this.geometry.setAttribute('color',new BufferAttribute(new Float32Array(MAX*2*4),4));
  const index=[];for(let i=0;i<MAX-1;i++){const a=i*2;index.push(a,a+1,a+2,a+1,a+3,a+2);}this.geometry.setIndex(index);this.geometry.setDrawRange(0,0);
  this.mesh=new Mesh(this.geometry,new ShaderMaterial({uniforms:{tint:{value:new Vector4(tint.r,tint.g,tint.b,tint.a)}},
   vertexShader:'attribute vec4 color; varying vec4 vColor; void main(){vColor=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
   fragmentShader:'uniform vec4 tint; varying vec4 vColor; void main(){gl_FragColor=2.0*tint*vColor;\n#include <colorspace_fragment>\n}',
   transparent:true,depthWrite:false,blending:AdditiveBlending,side:DoubleSide}));
  this.mesh.frustumCulled=false;this.mesh.name='arrowTrail';scene.add(this.mesh);
 }
 // head: browser-space position of the arrow transform this frame.
 update(head,time,camera){
  if(!this.enabled){this.geometry.setDrawRange(0,0);return 0;}
  const last=this.points.at(-1);if(!last||last.position.distanceTo(head)>=this.def.minVertexDistance)this.points.push({position:head.clone(),time});
  this.points=this.points.filter(p=>time-p.time<this.def.time).slice(-(MAX-1));
  const tail=this.points.at(-1)?.position.distanceTo(head)<1e-9?this.points.slice(0,-1):this.points,state=trailState(this.def,tail,head,time).reverse(),n=state.length,pos=this.geometry.attributes.position,col=this.geometry.attributes.color,eye=camera.position,side=new Vector3(),dir=new Vector3();
  if(n<2){this.geometry.setDrawRange(0,0);return 0;}
  for(let i=0;i<n;i++){const p=state[i].position,next=state[Math.min(n-1,i+1)].position,prev=state[Math.max(0,i-1)].position;
   dir.subVectors(next,prev);if(dir.lengthSq()<1e-12)dir.set(0,0,1);side.crossVectors(dir,new Vector3().subVectors(eye,p)).normalize().multiplyScalar(state[i].width/2);
   pos.setXYZ(i*2,p.x+side.x,p.y+side.y,p.z+side.z);pos.setXYZ(i*2+1,p.x-side.x,p.y-side.y,p.z-side.z);
   const c=state[i].color;col.setXYZW(i*2,c.r,c.g,c.b,c.a);col.setXYZW(i*2+1,c.r,c.g,c.b,c.a);}
  pos.needsUpdate=true;col.needsUpdate=true;this.geometry.setDrawRange(0,(n-1)*6);this.geometry.computeBoundingSphere();return n;
 }
 disable(){this.enabled=false;this.geometry.setDrawRange(0,0);}
 dispose(){this.scene.remove(this.mesh);this.geometry.dispose();this.mesh.material.dispose();}
}
