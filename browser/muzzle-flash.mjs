import {Matrix4,PointLight,Vector3} from 'three';

// BulletWeaponDataBlock destroys each flash after one second; MuzzleFlash fades its light over .1 seconds.
export class MuzzleFlashes {
 constructor(manifest,world,makeEffects){Object.assign(this,{manifest,world,makeEffects});this.entries=[];this.count=0;this.worldLight=new PointLight(0xffffff,0);world.add(this.worldLight);this.viewLight=new PointLight(0xffffff,0);}
 start(key,getMatrix,{viewScene=null}={}){const prefab=this.manifest.prefabs[key];if(!prefab||!getMatrix())return;
  const scene=viewScene??this.world,effects=this.makeEffects(prefab);for(const effect of effects)scene.add(effect.mesh);
  if(viewScene&&this.viewLight.parent!==viewScene)viewScene.add(this.viewLight);
  this.entries.push({scene,effects,prefab,getMatrix,view:Boolean(viewScene),age:0});this.count++;
 }
 remove(e){for(const fx of e.effects){e.scene.remove(fx.mesh);fx.dispose();}this.entries.splice(this.entries.indexOf(e),1);if(!this.entries.some(e=>e.view))this.viewLight.intensity=0;if(!this.entries.some(e=>!e.view))this.worldLight.intensity=0;}
 frame(dt,camera,view=false){const light=view?this.viewLight:this.worldLight;light.intensity=0;let nearest=Infinity;
  for(const e of [...this.entries]){let matrix=e.getMatrix();if(!matrix){this.remove(e);continue;}if(e.view!==view)continue;
   e.age+=dt;if(e.age>=1){this.remove(e);continue;}
   const s=e.prefab.rootScale;matrix=matrix.clone().scale(new Vector3(s.x,s.y,s.z));
   for(const fx of e.effects)fx.update(dt,true,matrix,camera);
   const source=e.prefab.components.Light?.find(l=>l.enabled);if(!source||e.age>=0.1)continue;
   const position=new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(matrix,new Matrix4().fromArray(e.prefab.nodes[source.node].matrix))),distance=position.distanceToSquared(camera.position);
   if(distance<nearest){nearest=distance;const d=source.data;light.color.setRGB(d.m_Color.r,d.m_Color.g,d.m_Color.b);light.distance=d.m_Range;light.intensity=d.m_Intensity*6*Math.max(0,1-e.age/0.1);light.position.copy(position);}
  }
 }
 clear(){for(const e of [...this.entries])this.remove(e);this.worldLight.intensity=this.viewLight.intensity=0;}
 debug(){return {count:this.count,active:this.entries.length,particles:this.entries.reduce((n,e)=>n+e.effects.reduce((n,fx)=>n+fx.particles.length,0),0),worldLight:this.worldLight.intensity,viewLight:this.viewLight.intensity};}
}
