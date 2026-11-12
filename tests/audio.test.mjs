import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSurfaceResolver} from '../browser/surface-routing.mjs';
import {FootstepEmitter,footstepBiped,footstepTraitFor,surfaceFootsteps,AmbientAudioState,MusicState,geigerClip,createVolumeSettings,soundPoolAudible,FOOTSTEP,LEG_BREAK} from '../browser/audio.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const audioRoot=new URL('../browser/assets/recovered/audio/',import.meta.url),deployRoot=new URL('../browser/assets/recovered/deployables/',import.meta.url);
const audio=hasRecovered?(JSON.parse(readFileSync(new URL('manifest.json',audioRoot)))):null,deploy=hasRecovered?(JSON.parse(readFileSync(new URL('manifest.json',deployRoot)))):null;
const t=hasRecovered?(deploy.surfaceRoutes.terrain):null,indices=hasRecovered?(new Uint8Array(readFileSync(new URL(t.file,deployRoot)))):null,resolve=hasRecovered?(createSurfaceResolver(deploy,indices)):null;
const keyOf=hasRecovered?(new Map(Object.entries(deploy.surfaces).map(([k,v])=>[v,k]))):null;
const clipNames=list=>list.map(f=>Object.values(audio.clips).find(c=>c.file===f)?.name);
const footstepsFor=hit=>surfaceFootsteps(audio,keyOf.get(resolve(hit))??audio.defaultSurface);
const seq=values=>{let i=0;return ()=>values[i++%values.length];};

test('original footstep traits: players stride 1.8 m (3, 30 m), wildlife BoarFootstepTrait (1, 15 m, animal)',needsAssets,()=>{
 const player=footstepTraitFor(audio,'MalePlayer'),offline=footstepTraitFor(audio,'OfflinePlayer');
 assert.equal(player,offline);assert.equal(player.name,'Footsteps');assert.ok(Math.abs(player.strideDist-1.8)<1e-6);
 assert.deepEqual([player.minAudioDist,player.maxAudioDist,player.animal,player.maxPerSecond],[3,30,false,6]);
 assert.deepEqual(clipNames(player.defaultFootsteps),['gravel3','gravel4','gravel1','gravel2']);
 for(const name of ['Boar_A','Stag_A','Bear','MutantBear','Wolf','MutantWolf']){const tr=footstepTraitFor(audio,name);assert.equal(tr?.name,'BoarFootstepTrait',name);assert.equal(tr.animal,true);}
 for(const name of ['Chicken_A','Rabbit_A'])assert.equal(footstepTraitFor(audio,name),null,name+' has no FootstepEmitter');
 // DeathTransfer plays a random CharacterSoundsTrait.death clip; the shipped PlayerDeath array holds one null clip.
 assert.deepEqual(audio.characters.MalePlayer.sounds.death,[null]);
});

test('surface -> footstep clips: terrain splats, structures, actors and the native default',needsAssets,()=>{
 const names=hit=>clipNames(footstepsFor(hit).biped);
 assert.deepEqual(names({body:null}),['gravel3','gravel4','gravel1','gravel2'],'static geometry uses default (gravel)');
 assert.deepEqual(names({body:{surfaceName:'WoodFoundation'}}),['wood2','wood4']);
 assert.deepEqual(names({body:{surfaceName:'MetalStairs'}}),['metal2','metal4']);
 assert.deepEqual(names({body:{surfaceName:'MalePlayer'}}),['gravel3','gravel4','gravel1','gravel2'],'flesh walks like gravel');
 // Terrain: SurfaceInfoTerrain surfaces [default, grass, grass, grass] by dominant splat index.
 const counts=new Map();for(let i=0;i<indices.length;i+=997)counts.set(indices[i],(counts.get(indices[i])??0)+1);
 for(const index of counts.keys()){const iz=Math.floor(indices.findIndex(v=>v===index)/t.width),ix=indices.findIndex(v=>v===index)%t.width;
  const x=t.origin[0]+(ix+0.5)/t.width*t.extent[0],z=-(t.origin[2]+(iz+0.5)/t.height*t.extent[1]);
  const fs=footstepsFor({terrain:true,point:[x,0,z]});assert.equal(fs.name,index===0?'default':'grass',`splat ${index}`);
  if(index>0)assert.deepEqual(clipNames(fs.biped),['grass_01','grass_02','grass_03','grass_04']);}
 for(const s of Object.values(audio.surfaces))assert.deepEqual(clipNames(s.animal),['hoofstep_1','hoofstep_2','hoofstep_3'],s.name);
});

test('GetFootstepBiped never repeats the last clip: index moves up, or down at the end',()=>{
 const list=['a','b','c'];
 assert.equal(footstepBiped(list,'a',()=>0),'b');assert.equal(footstepBiped(list,'c',()=>0.99),'b');assert.equal(footstepBiped(list,'a',()=>0.5),'b');
 assert.equal(footstepBiped(list,null,()=>0),'a');assert.equal(footstepBiped(['solo'],'solo',()=>0),'solo');
});

test('player step cadence: one step per strideDist^2 (3.24 m) of grounded travel, capped at 6 per second',needsAssets,()=>{
 const trait=footstepTraitFor(audio,'MalePlayer'),e=new FootstepEmitter(trait,{local:true}),steps=[];
 // Walk 4 m/s for 10 s at 60 fps.
 for(let i=0;i<=600;i++){const time=i/60,s=e.update(time,[4*time,0,0],{grounded:true},()=>null,()=>0);if(s)steps.push(time);}
 assert.equal(steps.length,12);const gaps=steps.slice(1).map((v,i)=>v-steps[i]);
 for(const g of gaps)assert.ok(Math.abs(g-0.8167)<0.02,`gap ${g}`); // 3.24 m / 4 m/s, quantised to frames
 // Animal: 0.09 m stride, so the 6 per second limit dominates while walking at 1 m/s.
 const animal=new FootstepEmitter(footstepTraitFor(audio,'Boar_A'));let n=0;
 for(let i=0;i<=600;i++){const time=i/60;if(animal.update(time,[time,0,0],{grounded:true},()=>null,()=>0))n++;}
 assert.ok(n>=55&&n<=61,`animal steps ${n}`);
});

test('airborne frames skip accumulation, so the landing frame steps with the jump distance',needsAssets,()=>{
 const e=new FootstepEmitter(footstepTraitFor(audio,'MalePlayer'));
 assert.equal(e.update(0,[0,0,0],{grounded:true},null,()=>0),null);
 for(let i=1;i<=30;i++)assert.equal(e.update(i/60,[i*0.15,1,0],{grounded:false},null,()=>0),null);
 const land=e.update(31/60,[4.65,0,0],{grounded:true},null,()=>0);assert.ok(land,'landing step');
});

test('step loudness: walking .65 at 3..30 m; crouching .2 at a third of the distances; pitch .95..1.05',needsAssets,()=>{
 const trait=footstepTraitFor(audio,'MalePlayer');
 const w=new FootstepEmitter(trait);w.update(0,[0,0,0],{grounded:true},null,()=>0);const a=w.update(1,[4,0,0],{grounded:true},()=>footstepsFor({body:{surfaceName:'WoodWall'}}),seq([0.4,0]));
 assert.equal(a.volume,FOOTSTEP.volume);assert.deepEqual([a.min,a.max],[3,30]);assert.equal(a.surface,'wood');assert.ok(a.pitch>=0.95&&a.pitch<=1.05);
 const c=new FootstepEmitter(trait);c.update(0,[0,0,0],{grounded:true},null,()=>0);const b=c.update(1,[4,0,0],{grounded:true,crouch:true},null,()=>0.5);
 assert.equal(b.volume,0.2);assert.ok(Math.abs(b.min-0.999)<1e-9&&Math.abs(b.max-9.99)<1e-9);assert.equal(b.surface,null,'nothing below: trait default');
 // footsteps.quality 0 never looks below the feet; 1 only for the local character.
 const q0=new FootstepEmitter(trait,{quality:0});q0.update(0,[0,0,0],{grounded:true},null);let called=false;q0.update(1,[4,0,0],{grounded:true},()=>{called=true;return null;});assert.equal(called,false);
 assert.deepEqual(LEG_BREAK,{volume:1,min:3,max:10});assert.equal(soundPoolAudible(10.5,10),false);assert.equal(soundPoolAudible(19,10,'logarithmic'),true);
});

test('AmbientAudioPlayer: 5 s checks, 0.2/s cross-fade between day and night sources',needsAssets,()=>{
 const s=new AmbientAudioState(),dt=1/50;let time=0,starts=[],stops=[];
 const run=(seconds,night)=>{for(let i=0;i<seconds/dt;i++){const c=s.update(time,dt,night);if(c.start)starts.push([c.start,time]);if(c.stop)stops.push([c.stop,time]);time+=dt;}};
 run(2.5,false);assert.equal(starts[0][0],'day');assert.ok(Math.abs(s.day.volume-0.5)<0.01);
 run(5,false);assert.equal(s.day.volume,1);assert.equal(s.updating,false);
 run(4,true);assert.ok(s.night.volume>0&&s.night.volume<0.4,'night waits for the next 5 s check');assert.ok(starts.some(([w])=>w==='night'));
 run(6,true);assert.equal(s.night.volume,1);assert.equal(s.day.volume,0);assert.deepEqual(stops.map(x=>x[0]),['day']);
 const ex=JSON.parse(JSON.stringify(audio.island.ambient));assert.equal(ex.length,17);
 for(const e of ex){assert.equal(e.daySource.rolloffMode,1);assert.deepEqual([e.daySource.minDistance,e.daySource.maxDistance,e.daySource.loop],[150,300,true]);}
 assert.deepEqual(new Set(ex.map(e=>Object.values(audio.clips).find(c=>c.file===e.daySound).name)),new Set(['day_wind_loop']));
 assert.deepEqual(new Set(ex.map(e=>Object.values(audio.clips).find(c=>c.file===e.nightSound).name)),new Set(['crickets_loop']));
});

test('MusicPlayer: first track after 3 + startDelay s, fades to targetVolume * sound.music, PageUp mute stops it',needsAssets,()=>{
 const cfg=audio.island.music[0];assert.deepEqual([cfg.startDelay,cfg.timeBetweenTracks,cfg.targetVolume.toFixed(1)],[20,600,'0.4']);
 const m=new MusicState(cfg,{time:0,rng:()=>0.5}),dt=0.1;let time=0,events=[];
 const run=(seconds,opts)=>{for(let i=0;i<Math.round(seconds/dt);i++){time+=dt;events.push(...m.update(time,dt,{lengthOf:()=>120,...opts}).map(e=>({...e,time})));}};
 run(22.9,{});assert.ok(!events.some(e=>e.type==='play'));run(0.3,{});assert.ok(events.some(e=>e.type==='play'));
 run(5,{music:0.4});assert.ok(Math.abs(m.volume-0.16)<1e-6);
 assert.ok(Math.abs(m.nextMusicTime-(23.1+120+600))<0.2);
 run(0.1,{muted:true});assert.equal(events.at(-1).type,'stop');
});

test('geiger clip by unarmoured exposure; sound.volume / sound.music settings persist and clamp',needsAssets,()=>{
 assert.equal(geigerClip(0.01),null);assert.equal(geigerClip(0.02),'content/item/sfx/geiger_low');assert.equal(geigerClip(500),'content/item/sfx/geiger_medium');
 assert.equal(geigerClip(700),'content/item/sfx/geiger_high');assert.equal(geigerClip(5000),'content/item/sfx/geiger_ultra');
 for(const p of ['content/item/sfx/geiger_low','content/item/sfx/geiger_ultra','content/shared/sfx/vomit'])assert.ok(audio.named[p],p);
 const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 const s=createVolumeSettings(storage);assert.deepEqual(s.get(),{master:1,sound:1,music:0.4});let seen=null;s.onChange(v=>seen=v);
 s.setVolume({master:0.5,music:2});assert.deepEqual(seen,{master:0.5,sound:0.5,music:1});
 assert.deepEqual(createVolumeSettings(storage).get(),{master:0.5,sound:0.5,music:1});
 assert.deepEqual(s.command('sound.volume 0.25'),{ok:true,text:'sound.volume: 0.25'});assert.equal(s.master,0.25);
 assert.equal(s.command('render.fov 90'),null);assert.equal(s.command('sound.music x').ok,false);
});
