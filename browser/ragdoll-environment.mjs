import {Box3,Vector3} from 'three';
// Browser collision -> Unity triangle winding, with a patch of the existing gameplay terrain.
// `collides(layer)`: the layer collision matrix row of the simulated layer (ragdolls: layer 27 "Ragdoll", which
// collides with Default/Static/CULL500/Terrain/Vehicle but not Debris, Mechanical doors or Character Collision).
export function ragdollEnvironment(world,center,radius=20,collides=layer=>![17,18,21,27].includes(layer)){
 const area=new Box3().setFromCenterAndSize(center,new Vector3(radius*2,radius*2,radius*2));
 const triangles=(world?.nearbyTriangles(area,b=>b.noCollide||b.cosmeticRigid||b.ragdollCorpse||!collides(b.layer??0))??[]).map(t=>[t.a.x,t.a.y,-t.a.z,t.c.x,t.c.y,-t.c.z,t.b.x,t.b.y,-t.b.z]);
 if(world?.ground){const step=2,x0=Math.floor((center.x-radius)/step)*step,z0=Math.floor((center.z-radius)/step)*step;
  // Uses the same terrain query as gameplay; tessellation between samples is an approximation.
  for(let x=x0;x<center.x+radius;x+=step)for(let z=z0;z<center.z+radius;z+=step){const a=[x,world.ground(x,z),-z],b=[x+step,world.ground(x+step,z),-z],c=[x,world.ground(x,z+step),-z-step],d=[x+step,world.ground(x+step,z+step),-z-step];if([...a,...b,...c,...d].every(Number.isFinite))triangles.push([...a,...b,...c],[...b,...d,...c]);}
 }return triangles;
}
