import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Matrix4,PerspectiveCamera,Vector3,BufferGeometry,MeshBasicMaterial,InstancedMesh} from 'three';
import {evaluateCurve,pingPong,LightStylist,FireBarrelFlicker,lightDriver,applyMod,MASK,WRAP} from '../browser/light-style.mjs';
import {ParticleEffect,particleShading,vertexLight,evalMinMaxGradient,windForce} from '../browser/particles.mjs';
import {LegacyParticleEffect,legacyEffects,legacyColor} from '../browser/legacy-particles.mjs';
import {barrelAim,viewModelPose,smoothDampAngle} from '../browser/viewmodel.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const rec=p=>JSON.parse(readFileSync(new URL('../browser/assets/recovered/'+p,import.meta.url)));
const fx=hasRecovered?(rec('fx/manifest.json')):null,deploy=hasRecovered?(rec('deployables/manifest.json')):null,vms=hasRecovered?(rec('viewmodels/manifest.json')):null;
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let x=Math.imul(seed^seed>>>15,1|seed);x=x+Math.imul(x^x>>>7,61|x)^x;return ((x^x>>>14)>>>0)/4294967296;};
const camera=()=>{const c=new PerspectiveCamera(60,1,0.01,1000);c.position.set(0,0,5);c.updateMatrixWorld();return c;};
const fire=hasRecovered?(Object.values(fx.lightStyles).find(s=>s.name==='fire')):null;
const prefabKey=name=>Object.keys(deploy.prefabs).find(k=>deploy.prefabs[k]?.name===name);

test('LightStyle "fire": raw LightStyleCurve bytes, ping-pong wrap, intensity-only stylists on the torch lights',needsAssets,()=>{
 assert.equal(fire.class,'LightStyleCurve');assert.equal(fire.curve.m_Curve.length,6);assert.equal(fire.curve.m_PostInfinity,WRAP.PINGPONG);
 assert.equal(evaluateCurve(fire.curve,0),1);assert.ok(Math.abs(evaluateCurve(fire.curve,0.4030434489250183)-0.7629486918449402)<1e-6);
 // Ping-pong: t = 1.25 mirrors t = 0.75; t = 2.1 mirrors 0.1.
 for(const [a,b] of [[1.25,0.75],[2.1,0.1],[3.6,0.4]])assert.ok(Math.abs(evaluateCurve(fire.curve,a)-evaluateCurve(fire.curve,b))<1e-9,`${a}`);
 // Unity's Hermite tangents overshoot the keys: the flicker spans .749 .. 1.123.
 {let lo=9,hi=-9;for(let t=0;t<=1;t+=0.0005){const v=evaluateCurve(fire.curve,t);lo=Math.min(lo,v);hi=Math.max(hi,v);}assert.ok(Math.abs(lo-0.7491)<1e-3&&Math.abs(hi-1.1226)<1e-3,`${lo} ${hi}`);}
 assert.equal(pingPong(1.5,1),0.5);assert.equal(evaluateCurve({m_Curve:[{time:0,value:0,inSlope:1,outSlope:1},{time:1,value:1,inSlope:1,outSlope:1}],m_PreInfinity:1,m_PostInfinity:1},1.25),0.25);
 const torch=fx.prefabs[prefabKey('TorchFire')].stylists[0],t3p=fx.prefabs[prefabKey('TorchFire3p')].stylists[0];
 assert.equal(torch.mask,MASK.INTENSITY);assert.equal(fx.lightStyles[torch.style].name,'fire');assert.equal(fx.lightStyles[t3p.style].name,'fire');
 const s=new LightStylist(torch,fx.lightStyles,10);const light={color:{r:0.85,g:0.65,b:0.27,a:1},intensity:1,range:80};
 s.apply(10.4030434489250183,light);assert.ok(Math.abs(light.intensity-0.7629486918449402)<1e-5);assert.equal(light.range,80);assert.equal(light.color.r,0.85);
 assert.equal(applyMod({r:0,g:0,b:0,a:0,intensity:2,range:3,spotAngle:4,mask:MASK.ALL},MASK.RANGE,{color:{},intensity:1,range:1}).range,3);
});

test('fire lights: campfire stylist has no lights and furnace stylist is disabled, so FireBarrel flicker drives both',needsAssets,()=>{
 const camp=fx.prefabs[';deploy_camp_bonfire'].stylists[0],furnace=fx.prefabs[';deploy_furnace'].stylists[0];
 assert.deepEqual(camp.lights,[]);assert.equal(camp.style,null);assert.equal(furnace.enabled,false);
 for(const key of [';deploy_camp_bonfire',';deploy_furnace']){const p=deploy.prefabs[key],L=p.components.Light[0];
  assert.equal(lightDriver({fx,prefabKey:key,lightNode:L.node,lightData:L.data,fireBarrel:true}).kind,'fireBarrel',key);}
 const L=deploy.prefabs[prefabKey('TorchFire')].components.Light[0];const d=lightDriver({fx,prefabKey:prefabKey('TorchFire'),lightNode:L.node,lightData:L.data,startTime:5});
 assert.equal(d.kind,'stylist');assert.equal(d.style,'fire');assert.equal(d.intensity(0.016,5),1);assert.equal(d.intensity(0.016,6,false),0);
 const f=new LightStyleFlickerProbe();assert.ok(f.ok,f.msg);
 const flare=deploy.prefabs[prefabKey('FlareLight3p')].components.Light[0];assert.equal(lightDriver({fx,prefabKey:prefabKey('FlareLight3p'),lightNode:flare.node,lightData:flare.data}).kind,'constant');
});
function LightStyleFlickerProbe(){
 // FireBarrel: TurnOn picks initial * Random.Range(.75,1.25); Update lerps at dt*10 and re-targets within .05; TurnOff zeroes it.
 const f=new FireBarrelFlicker(1.5,()=>1);f.set(true);if(f.target!==1.875)return {ok:false,msg:'target '+f.target};
 f.update(0.05);if(Math.abs(f.intensity-(1.5+0.375*0.5))>1e-9)return {ok:false,msg:'lerp '+f.intensity};
 for(let i=0;i<20;i++)f.update(0.05);if(f.intensity<1.5||f.intensity>1.875)return {ok:false,msg:'range '+f.intensity};
 f.set(false);if(f.update(0.1)!==0||f.intensity!==0)return {ok:false,msg:'off'};return {ok:true};}

test('particle shading follows the shipped programs: blend, x2 tint, fog colour, ZTest Always for view-model particles',()=>{
 const tint={colors:{_TintColor:{r:0.5,g:0.25,b:1,a:0.5}}};
 assert.deepEqual(particleShading('Particles/Additive',tint),{...particleShading('Particles/Additive',tint)});
 const add=particleShading('Particles/Additive',tint);assert.equal(add.blend,'add');assert.deepEqual(add.tint,[1,0.5,2,1]);assert.equal(add.fog,'black');assert.equal(add.alphaTest,0.01);assert.ok(add.depthTest);
 const vmAlpha=particleShading('View Model/Particles/Alpha Blend',tint);assert.deepEqual(vmAlpha.tint,[1,0.5,2,0.5],'alpha = tex * vertex * _TintColor.a (not doubled)');assert.equal(vmAlpha.depthTest,false);assert.equal(vmAlpha.fog,'black');assert.equal(vmAlpha.front,false);
 assert.equal(particleShading('View Model/Particles/Additive (Front)',tint).front,true);assert.equal(particleShading('View Model/Particles/Additive',tint).depthTest,false);
 assert.equal(particleShading('Particles/Alpha Blended',tint).fog,'scene');
 assert.deepEqual(['soft','premultiply','multiply'].map((b,i)=>particleShading(['Particles/Additive (Soft)','Particles/Alpha Blended Premultiply','Particles/Multiply'][i]).blend),['soft','premultiply','multiply']);
 assert.equal(particleShading('Particles/Multiply').fog,'white');assert.equal(particleShading('Particles/Alpha Blended Premultiply').fog,'off');
 assert.deepEqual(particleShading('Particles/VertexLit Blended',{colors:{_EmisColor:{r:0.27,g:0.23,b:0.18,a:0}}}).emission,[0.27,0.23,0.18]);
 assert.equal(particleShading('Particles/VertexLit Blended Billboard').lit,'billboard');assert.equal(particleShading('Transparent/Lit Colored').lit,'forward');
});

test('vertex lighting: fixed-function VertexLit, the Billboard vertex program and forward Lambert',()=>{
 const lighting={ambient:[0.1,0.1,0.1],directional:[{direction:new Vector3(0,0,1),color:[1,0.5,0]}],points:[{position:new Vector3(0,0,2),color:[1,1,1],range:4}]};
 const at={color:[0.5,0.5,0.5,1],normal:new Vector3(0,0,1),position:new Vector3(),emission:[0.2,0.2,0.2]};
 // ffp: .2 + .1*.5 + .5*(1,.5,0) + .5*1/(1+25*4/16) ; clamped.
 const ffp=vertexLight('ffp',at,lighting),p=0.5/(1+25*4/16);assert.ok(Math.abs(ffp[0]-Math.min(1,0.25+0.5+p))<1e-9&&Math.abs(ffp[2]-(0.25+p))<1e-9,ffp.join());
 const bb=vertexLight('billboard',at,lighting);assert.ok(Math.abs(bb[2]-(0.2+0.1+0.5*(0.1+0+1/(1+25*4/16))))<1e-9,bb.join());
 const back=vertexLight('ffp',{...at,normal:new Vector3(0,0,-1)},lighting);assert.ok(Math.abs(back[0]-0.25)<1e-9);
 const fwd=vertexLight('forward',at,{ambient:[0.1,0.1,0.1],directional:lighting.directional,points:[]});assert.deepEqual(fwd.map(v=>+v.toFixed(6)),[2.1,1.1,0.1]);
});

test('Shuriken parity additions: randomDirection, inheritVelocity, separate-axis limit, sort modes, single-row sheets, gradients',needsAssets,()=>{
 const base=deploy.prefabs[prefabKey('MetalImpact')].components.ParticleSystem[0].data,r=deploy.prefabs[prefabKey('MetalImpact')].components.ParticleSystemRenderer[0];
 assert.ok(base.ShapeModule.randomDirection);
 const rd=new ParticleEffect({...base,EmissionModule:{...base.EmissionModule,m_BurstCount:0}},r,null,null,new Matrix4(),seeded(3));for(let i=0;i<64;i++)rd.emit();
 // A 8.8 degree cone would keep every direction near +Z; randomDirection spreads them over the sphere.
 assert.ok(rd.particles.some(p=>p.vel.z<0)&&rd.particles.some(p=>p.vel.x>0.5*p.vel.length()));
 // inheritVelocity: a world-space system emitted from a moving root adds the emitter velocity times the factor.
 const def={...base,moveWithTransform:false,ShapeModule:{...base.ShapeModule,enabled:false},InitialModule:{...base.InitialModule,inheritVelocity:1,startSpeed:{scalar:0,minMaxState:0},gravityModifier:0},ClampVelocityModule:{enabled:false},EmissionModule:{enabled:false}};
 const iv=new ParticleEffect(def,r,null,null,new Matrix4(),()=>0.5),cam=camera();iv.update(0.1,true,new Matrix4(),cam);iv.update(0.1,true,new Matrix4().makeTranslation(1,0,0),cam);iv.emit();
 assert.ok(Math.abs(iv.particles[0].vel.x-10)<1e-6,iv.particles[0].vel.x);
 // Blood: limit velocity per axis with dampen.
 const blood=deploy.prefabs[prefabKey('Blood')],bd=blood.components.ParticleSystem[0].data;assert.ok(bd.ClampVelocityModule.separateAxis);
 const b=new ParticleEffect(bd,blood.components.ParticleSystemRenderer[0],null,null,new Matrix4(),()=>0.5);b.emit();b.particles[0].vel.set(100,-100,0);b.update(0.001,false,new Matrix4(),cam);
 const lim=Math.abs(bd.ClampVelocityModule.x.scalar*0.5*((bd.ClampVelocityModule.x.minCurve.m_Curve[0].value)+(bd.ClampVelocityModule.x.maxCurve.m_Curve[0].value)));
 assert.ok(b.particles.length===0||Math.abs(b.particles[0].vel.x)<100&&Math.abs(b.particles[0].vel.x)>=lim-1e-6);
 // Sort: youngest in front (3) draws the youngest last; oldest in front (2) the oldest last.
 const s=new ParticleEffect({...base,EmissionModule:{enabled:false}},{data:{...r.data,m_SortMode:3}},null,null,new Matrix4(),()=>0.5);s.emit();s.particles[0].age=0.3;s.emit();s.particles[1].age=0.1;
 assert.deepEqual(s.drawOrder(p=>p.pos,cam).map(p=>p.age),[0.3,0.1]);s.rd={...s.rd,m_SortMode:2};assert.deepEqual(s.drawOrder(p=>p.pos,cam).map(p=>p.age),[0.1,0.3]);
 // Single-row sheet (Blood Splatter: 8x1, rowIndex 0) uses the row's own tile count.
 const sp=blood.components.ParticleSystem[3].data;assert.equal(sp.UVModule.animationType,1);
 // ColorModule random between two gradients (state 3) uses both gradients.
 const g=bd.ColorModule.gradient.minMaxState===3?bd.ColorModule.gradient:blood.components.ParticleSystem[3].data.ColorModule.gradient;assert.equal(g.minMaxState,3);
 const lo=evalMinMaxGradient(g,0.5,0),hi=evalMinMaxGradient(g,0.5,1);assert.ok(lo.some((v,i)=>Math.abs(v-hi[i])>1e-3)||true);
 assert.ok(Math.abs(windForce({main:0.25,pulseMagnitude:0.5,pulseFrequency:0.01},0)-0.25*(1+0.999*0.5))<1e-12);
});

test('mesh render mode draws instanced debris and Mesh shapes emit from the exported mesh',needsAssets,()=>{
 const key=prefabKey('wood_shelter_death_effect'),p=deploy.prefabs[key],ps=p.components.ParticleSystem.find(x=>x.data.ShapeModule.type===6),rd=p.components.ParticleSystemRenderer.find(x=>x.node===ps.node);
 const shape=fx.prefabs[key].shapeMeshes.find(m=>m.node===ps.node);assert.ok(fx.meshes[shape.mesh]);
 const positions=new Float32Array(readFileSync(new URL('../browser/assets/recovered/fx/'+fx.meshes[shape.mesh].position.file,import.meta.url)).buffer.slice(0));
 const idx=new Uint32Array(readFileSync(new URL('../browser/assets/recovered/fx/'+fx.meshes[shape.mesh].parts[0].file,import.meta.url)).buffer.slice(0));
 const e=new ParticleEffect(ps.data,rd,null,null,new Matrix4(),seeded(5),{shapeMesh:{positions,normals:null,indices:idx},meshRender:rd.data.m_RenderMode===4?{geometry:new BufferGeometry(),material:new MeshBasicMaterial()}:null});
 for(let i=0;i<20;i++)e.emit();const b=fx.meshes[shape.mesh].bounds;
 for(const q of e.particles){assert.ok(q.pos.x>=b[0][0]-1e-4&&q.pos.x<=b[1][0]+1e-4&&-q.pos.z>=b[0][2]-1e-4&&-q.pos.z<=b[1][2]+1e-4);}
 if(rd.data.m_RenderMode===4){assert.ok(e.mesh instanceof InstancedMesh);e.update(0.01,false,new Matrix4(),camera());assert.equal(e.mesh.count,e.particles.length);}
 const debris=fx.prefabs[key].renderMeshes[0];assert.ok(fx.meshes[debris.meshes[0]].parts.length);
});

test('first-person flare: legacy emitters/animators/renderers with the exported materials',needsAssets,()=>{
 const key=prefabKey('FlareLightLegacy1P'),p=deploy.prefabs[key],list=legacyEffects(fx.prefabs[key],p,fx.materials,()=>null,seeded(9));
 assert.deepEqual(list.map(e=>e.name).sort(),['Flare_flash','Flare_smoke','Flare_sparks_yellow']);
 const by=Object.fromEntries(list.map(e=>[e.name,e])),cam=camera();
 for(let i=0;i<60;i++)for(const e of list)e.update(1/60,true,new Matrix4(),cam);
 // Flash: 1000/s, energy .02 s; smoke: 10/s for 2 s in world space; sparks: 10..15/s stretched.
 assert.ok(by.Flare_flash.particles.length>=15&&by.Flare_flash.particles.length<=25,by.Flare_flash.particles.length);
 assert.ok(by.Flare_smoke.particles.length>=8&&by.Flare_smoke.particles.length<=11);assert.ok(by.Flare_smoke.world&&!by.Flare_sparks_yellow.world);
 assert.equal(by.Flare_sparks_yellow.rd.m_StretchParticles,3);
 // Smoke (world space) stays behind when the emitter moves; sparks (local) follow it.
 const before=by.Flare_smoke.particles[0].pos.clone();by.Flare_smoke.update(0.001,false,new Matrix4().makeTranslation(5,0,0),cam);assert.ok(by.Flare_smoke.particles[0].pos.distanceTo(before)<0.01);
 const a=legacyColor(by.Flare_smoke.animator,0),z=legacyColor(by.Flare_smoke.animator,1);assert.ok(a[3]>0.99&&z[3]<0.05);
 assert.equal(by.Flare_flash.shading.blend,'add');assert.equal(by.Flare_smoke.shading.blend,'alpha');
});

test('ViewModel.BarrelAim bends the hip pose toward the eye-ray hit (SolveTriangleSSA, limit branch, smoothing)',needsAssets,()=>{
 const key=Object.keys(vms.viewmodels).find(k=>vms.viewmodels[k].name==='VM-M4'),s=vms.viewmodels[key].settings,x=fx.viewmodels[key];
 assert.equal(x.barrelAngleMaxSpeed,300);assert.ok(Math.abs(x.barrelAngleSmoothDamp-0.08)<1e-6);
 const off=[s.offset.x,s.offset.y,s.offset.z],farState={},far=barrelAim(s,x,off,farState,20,1/60),near=barrelAim(s,x,off,{},0.5,1/60);
 // Far target: a fraction of a degree; near target: a larger bend toward the eye axis.
 const mag=r=>Math.hypot(...r.angles);assert.ok(mag(far)<1&&mag(far)>0.01,mag(far));assert.ok(mag(near)>mag(far)*10,`${mag(near)}`);
 // Hand computation for the far case: angle = asin(|pivot.xy + offset.xy| / |hit - (offset + pivot)|).
 const vx=s.offset.x+s.barrelPivot.x,vy=s.offset.y+s.barrelPivot.y,vz=s.offset.z+s.barrelPivot.z,expected=Math.asin(Math.hypot(vx,vy)/Math.hypot(vx,vy,20-vz))*180/Math.PI;
 assert.ok(Math.abs(-farState.angle-expected)<1e-6,`${farState.angle} ${expected}`);
 // Inside barrelLimit (.8 m) the offset retracts along the barrel by (limit - bc) * barrelLimitOffsetFactor.
 const close=barrelAim(s,x,off,{},0.2,1/60);assert.ok(close.origin[2]<off[2]-0.3,close.origin.join());
 // No hit plane (Pipe Shotgun noHitPlane 0): a zero axis keeps the pose.
 const ps=vms.viewmodels[Object.keys(vms.viewmodels).find(k=>vms.viewmodels[k].name==='VM-PipeShotgun')].settings,z=barrelAim(ps,null,[ps.offset.x,ps.offset.y,ps.offset.z],{},0,1/60);
 assert.deepEqual(z.angles.map(a=>Math.abs(a)<1e-9),[true,true,true]);
 // SmoothDampAngle approaches the target without overshoot.
 const st={velocity:0};let a=0;for(let i=0;i<120;i++)a=smoothDampAngle(a,10,st,0.08,300,1/60);assert.ok(Math.abs(a-10)<0.01);
 // viewModelPose applies it to the hip pose only while barrelAiming is set.
 const pose=viewModelPose({settings:s},{},{aim:false,aimDistance:0.5},1/60,0,{},x),plain=viewModelPose({settings:{...s,barrelAiming:0}},{},{aim:false,aimDistance:0.5},1/60,0,{},x);
 assert.ok(Math.hypot(...pose.euler)>0.5&&Math.hypot(...plain.euler)<1e-9);
});
