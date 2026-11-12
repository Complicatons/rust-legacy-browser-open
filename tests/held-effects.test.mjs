import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Matrix4,PerspectiveCamera,PointLight,Vector3,Quaternion} from 'three';
import {meleeSwingSound,meleeImpact} from '../browser/melee-effects.mjs';
import {MeleeGather} from '../browser/resources.mjs';
import {ParticleEffect,linkSubEmitters,speedFraction} from '../browser/particles.mjs';
import {mirrorPointLights} from '../browser/viewmodel.mjs';
import {createSurfaceResolver} from '../browser/surface-routing.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const root=new URL('../browser/assets/recovered/deployables/',import.meta.url),manifest=hasRecovered?(JSON.parse(readFileSync(new URL('manifest.json',root)))):null;
const items=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url))).items):null;
const t=hasRecovered?(manifest.surfaceRoutes.terrain):null,surfaceFor=hasRecovered?(createSurfaceResolver(manifest,new Uint8Array(readFileSync(new URL(t.file,root))))):null;
const itemKey=name=>Object.keys(items).find(k=>items[k].data.m_Name===name);
const seeded=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let x=Math.imul(seed^seed>>>15,1|seed);x=x+Math.imul(x^x>>>7,61|x)^x;return ((x^x>>>14)>>>0)/4294967296;};
const surfaceName=name=>Object.values(manifest.surfaces).find(s=>s.name===name);

test('melee swing sound: swingSound, Random.Range(.85,1) pitch, PlayLocal 3..20 for every original melee tool',needsAssets,()=>{
 for(const name of ['Rock','Hatchet','Stone Hatchet','Pick Axe']){const sounds=manifest.weapons[itemKey(name)].sounds;
  assert.ok(sounds.swingSound&&sounds.impactSoundWood,name);
  const lo=meleeSwingSound(sounds,()=>0),hi=meleeSwingSound(sounds,()=>0.999999);
  assert.equal(lo.file,sounds.swingSound);assert.equal(lo.pitch,0.85);assert.ok(hi.pitch<1&&hi.pitch>0.99);assert.deepEqual([lo.volume,lo.min,lo.max],[1,3,20]);}
 assert.equal(meleeSwingSound({}),null);
});

test('melee impacts: tree tag plays impactSoundWood (2..10), others the SurfaceInfo melee effect EffectSoundPlayer clip (1..10)',needsAssets,()=>{
 const sounds=manifest.weapons[itemKey('Rock')].sounds;
 const tree=meleeImpact({tree:true,point:[0,0,0]},{sounds,surfaceFor,manifest});
 assert.deepEqual(tree.sound,{file:sounds.impactSoundWood,volume:1,min:2,max:10});
 // Static island geometry (no SurfaceInfo) uses the default surface: ImpactMelee -> default_hits_melee (impact_generic).
 const generic=meleeImpact({point:[0,0,0],body:null,terrain:false},{sounds,surfaceFor,manifest});
 assert.equal(generic.surface,'default');assert.equal(manifest.prefabs[generic.effect].name,'ImpactMelee');assert.deepEqual([generic.sound.min,generic.sound.max],[1,10]);
 assert.ok(manifest.prefabs[generic.effect].components.EffectSoundPlayer[0].sounds.includes(generic.sound.file));
 // Wildlife routes to flesh (Blood effect: two melee_body_hit clips), structures to their explicit surfaces.
 const flesh=meleeImpact({point:[0,0,0],body:{animal:{def:{name:'Boar_A'}}}},{sounds,surfaceFor,manifest,random:()=>0.99});
 assert.equal(flesh.surface,'flesh');assert.equal(flesh.sound.file,manifest.prefabs[surfaceName('flesh').meleeEffects[0]].components.EffectSoundPlayer[0].sounds[1]);
 const metal=meleeImpact({point:[0,0,0],body:{surfaceName:'MetalWall'}},{sounds,surfaceFor,manifest});assert.equal(metal.surface,'metal');assert.ok(metal.sound.file);
 const wood=meleeImpact({point:[0,0,0],body:{surfaceName:'WoodWall'}},{sounds,surfaceFor,manifest});assert.equal(manifest.prefabs[wood.effect].name,'WoodImpactMelee');assert.ok(wood.sound.file);
 // Every surface's melee effects carry exported clips whose files exist.
 for(const s of Object.values(manifest.surfaces))for(const k of s.meleeEffects){const clips=manifest.prefabs[k].components.EffectSoundPlayer?.[0]?.sounds??[];assert.ok(clips.length,s.name);for(const f of clips)assert.ok(readFileSync(new URL(f,root)).length>100,f);}
 assert.equal(meleeImpact(null,{sounds,surfaceFor,manifest}),null);
});

test('MeleeGather queues SwingSound at swingSoundDelay (independent of mid-swing) and holstering clears both',needsAssets,()=>{
 const rock=items[itemKey('Rock')].data,melee=new MeleeGather({rng:()=>0.5});
 assert.ok(melee.frame(10,{attack:true,sprinting:false},rock,'rock'));
 assert.equal(melee.dueSwingSound(10+rock.swingSoundDelay-0.01),null);const s=melee.dueSwingSound(10+rock.swingSoundDelay+0.01);assert.equal(s.toolKey,'rock');
 assert.equal(melee.dueSwingSound(20),null);assert.ok(melee.dueSwing(10+rock.midSwingDelay));
 melee.frame(20,{attack:true,sprinting:false},rock,'rock');melee.cancelQueued();assert.equal(melee.dueSwingSound(30),null);assert.equal(melee.dueSwing(30),null);
});

const torch=hasRecovered?(manifest.prefabs[manifest.weapons[itemKey('Torch')].prefabs.FirstPersonLightPrefab]):null;
function torchEffects(rng){const out=[];for(const ps of torch.components.ParticleSystem){const r=torch.components.ParticleSystemRenderer.find(x=>x.node===ps.node);
 out.push(Object.assign(new ParticleEffect(ps.data,r,manifest.materials[r.materials[0]],null,new Matrix4().fromArray(torch.nodes[ps.node].matrix),rng),{id:ps.id,name:torch.nodes[ps.node].name}));}return linkSubEmitters(out);}
test('first-person torch: sub-emitters resolve by serialized id; flames come from the TorchFire carriers, not self-emission',needsAssets,()=>{
 const fx=torchEffects(seeded(7)),by=Object.fromEntries(fx.map(e=>[e.name,e]));
 assert.deepEqual(by.TorchFire.subEmitters.birth.map(l=>l.effect.name),['Ambers','Glow']);assert.deepEqual(by.TorchFire.subEmitters.death.map(l=>l.effect.name),['Back Flames','Front Flames']);
 assert.deepEqual(by['Front Flames'].subEmitters.death.map(l=>l.effect.name),['BackSmoke']);
 for(const n of ['Ambers','Glow','Back Flames','Front Flames','BackSmoke'])assert.ok(by[n].isSubEmitter,n);
 for(const n of ['TorchFire','Noisy Flames','Side Flames'])assert.ok(!by[n].isSubEmitter,n);
 const camera=new PerspectiveCamera(60,16/9,0.02,25);camera.position.set(0,0,1);camera.updateMatrixWorld();const rootM=new Matrix4().makeRotationX(-Math.PI/2);
 let peak=0;for(let i=0;i<60;i++){for(const e of fx)e.update(1/60,true,rootM,camera);peak=Math.max(peak,by['Back Flames'].particles.length);}
 // 20 carriers/s, each dying into 3 Back Flames bursts (0.5 s life) => tens alive; Back Flames' own rate/length never runs.
 assert.ok(peak>=10,peak);assert.ok(by['Front Flames'].particles.length>0);assert.ok(by.Ambers.particles.length+by.Glow.particles.length>0);assert.ok(by.BackSmoke.particles.length>0);
 // Cone-volume carriers start along the 0.075 m head (type 9 shell, radius .025) rather than on its base.
 const zs=by.TorchFire.particles.map(p=>p.pos.z);assert.ok(zs.length&&Math.max(...zs)>0.02,String(zs));
 // ColorBySpeed tints Side Flames orange (the flame colour comes from the speed gradient, start colour is grey).
 const side=by['Side Flames'],cb=side.colors;let r=0,b=0;for(let i=0;i<side.particles.length;i++){r+=cb[i*16];b+=cb[i*16+2];}assert.ok(side.particles.length&&r>b*1.3,`${r} ${b}`);
});

test('Shuriken additions: speed fraction, world-down gravity in rotated emitters, maxParticleSize clamp',needsAssets,()=>{
 assert.ok(Math.abs(speedFraction(0.5,{x:0.2,y:0.8})-0.5)<1e-12);assert.equal(speedFraction(5,{x:0,y:1}),1);assert.equal(speedFraction(0,{x:0.2,y:0.8}),0);
 const ps=torch.components.ParticleSystem.find(p=>torch.nodes[p.node].name==='Ambers'),r=torch.components.ParticleSystemRenderer.find(x=>x.node===ps.node);
 const def={...ps.data,ShapeModule:{...ps.data.ShapeModule,enabled:false},InitialModule:{...ps.data.InitialModule,startSpeed:{minMaxState:0,scalar:0},startLifetime:{minMaxState:0,scalar:10}}};
 const e=new ParticleEffect(def,r,null,null,new Matrix4(),()=>0.5),camera=new PerspectiveCamera(60,1,0.01,100);camera.position.set(0,0,5);camera.updateMatrixWorld();
 // Emitter pointing its local Z up (torch head): gravity still pulls along world -Y, i.e. local -Z after the Z-reflection.
 const up=new Matrix4().makeRotationX(-Math.PI/2);e.emit(null,up);for(let i=0;i<10;i++)e.update(0.01,false,up,camera);
 const world=e.particles[0].pos.clone().applyMatrix4(new Matrix4().multiplyMatrices(e.particles[0].emissionRoot??up,new Matrix4().makeScale(1,1,-1)));
 assert.ok(world.y<-0.003&&Math.abs(world.x)<1e-9&&Math.abs(world.z)<1e-6,world.toArray().join());
 // m_MaxParticleSize .5 of the viewport: a 0.006 m ember is unaffected, a huge one is clamped to .5 x frustum height at its depth.
 const big=new ParticleEffect({...def,SizeModule:{enabled:false}},{data:{...r.data,m_MaxParticleSize:0.1}},null,null,new Matrix4(),()=>0.5);big.emit();big.particles[0].size=100;big.update(0,false,new Matrix4(),camera);
 const p=big.positions,width=Math.hypot(p[3]-p[0],p[4]-p[1],p[5]-p[2]);assert.ok(Math.abs(width-0.1*2*Math.tan(Math.PI/6)*5)<1e-3,String(width));
});

test('view-model light mirror: nearest lit in-range point lights, positions in eye space, fixed pool size',()=>{
 const light=(x,z,intensity=6,distance=20)=>{const l=new PointLight(0xff8800,intensity,distance,1);l.position.set(x,0,z);return l;};
 const eye=new Vector3(100,0,0),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2);
 const far=light(150,0),off=light(101,0,0),near=light(101,0),mid=light(100,-5),out=mirrorPointLights([far,off,near,mid,null],eye,q,4);
 assert.equal(out.length,2);assert.equal(out[0].intensity,6);
 // Eye turned +90 deg about Y looks along world -X: a light 1 m along +X is 1 m behind the camera (+Z in view space).
 assert.ok(out[0].position.distanceTo(new Vector3(0,0,1))<1e-9,out[0].position.toArray().join());
 assert.ok(out[1].position.distanceTo(new Vector3(5,0,0))<1e-9,out[1].position.toArray().join());
 assert.equal(mirrorPointLights(Array.from({length:9},(_,i)=>light(100+i*0.1,0)),eye,q,4).length,4);
});
