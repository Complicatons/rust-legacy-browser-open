// Pure rules of the original client's player and world audio (no three.js/Web Audio here; see world-audio.mjs).
// Sources (decompiled client): FootstepEmitter, CharacterFootstepTrait, SurfaceInfoObject, footsteps (ConsoleSystem),
// AmbientAudioPlayer, MusicPlayer, sound (ConsoleSystem), LocalRadiationEffect + Radiation, FallDamage, Metabolism.

const clamp01=v=>Math.min(1,Math.max(0,v));
// UnityEngine.Random.Range(int min, int max): max exclusive. Random.Range(float, float): inclusive range.
export const randomIndex=(rng,n)=>Math.min(n-1,Math.floor(rng()*n));
export const randomRange=(rng,a,b)=>a+(b-a)*rng();

// ---- Volume (ConsoleSystem `sound`): sound.volume is AudioListener.volume (master, also scales music);
// sound.music (default 0.4) multiplies MusicPlayer.targetVolume. Both are [Client][Saved] convars.
export const SOUND_DEFAULTS=Object.freeze({volume:1,music:0.4});
const STORAGE_KEY='rlb-sound';
export function createVolumeSettings(storage=globalThis.localStorage){
 let values={...SOUND_DEFAULTS};
 try{const saved=JSON.parse(storage?.getItem(STORAGE_KEY)??'null');if(saved&&typeof saved==='object')for(const k of Object.keys(SOUND_DEFAULTS))if(Number.isFinite(saved[k]))values[k]=clamp01(saved[k]);}catch{}
 const listeners=new Set();
 return {
  get master(){return values.volume;},get music(){return values.music;},
  get(){return {master:values.volume,sound:values.volume,music:values.music};},
  // master/sound/volume all name sound.volume (the original has no separate effects slider); music = sound.music.
  setVolume({master,sound,volume,music}={}){const next={...values},v=master??sound??volume;
   if(v!=null&&Number.isFinite(Number(v)))next.volume=clamp01(Number(v));if(music!=null&&Number.isFinite(Number(music)))next.music=clamp01(Number(music));
   if(next.volume===values.volume&&next.music===values.music)return this.get();values=next;
   try{storage?.setItem(STORAGE_KEY,JSON.stringify(values));}catch{}
   for(const fn of listeners)try{fn(this.get());}catch(e){console.warn(e);}return this.get();},
  onChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  // `sound.volume 0.5` / `sound.music` console syntax; returns the console reply {ok, text}, or null when the line
  // is not a sound convar.
  command(line){const m=/^sound\.(volume|music)(?:\s+(\S+))?$/i.exec(String(line).trim());if(!m)return null;const key=m[1].toLowerCase();
   if(m[2]!=null){const n=Number(m[2]);if(!Number.isFinite(n))return {ok:false,text:`Usage: sound.${key} <0-1>`};this.setVolume({[key]:n});}
   return {ok:true,text:`sound.${key}: ${values[key]}`};},
 };
}
// One instance per page (ES modules are singletons), shared by the game, the menu scene and the Options window.
export const audioSettings=createVolumeSettings();

// ---- Footsteps ----
// footsteps.quality: 0 = default sound, 1 = dynamic for local, 2 = dynamic for all (default 2).
export const FOOTSTEP_QUALITY=2;
// FootstepEmitter.Update: AudioClip.Play(origin, volume, Random.Range(0.95, 1.05), min, max, priority 30), linear rolloff.
export const FOOTSTEP={volume:0.65,crouchVolume:0.2,crouchDistance:0.333,pitch:[0.95,1.05]};

// SurfaceInfoObject.GetFootstepBiped(last): a repeat of the last clip moves one index up (or down at the end) and
// returns that index (the shipped code returns bipedFootsteps[num], i.e. the adjusted clip).
export function footstepBiped(list,last,rng=Math.random){
 if(!list?.length)return null;let num=randomIndex(rng,list.length);
 if(last&&list[num]===last){if(num<list.length-1)num++;else if(num>=1)num--;}
 return list[num]??null;
}
export function footstepAnimal(list,rng=Math.random){return list?.length?list[randomIndex(rng,list.length)]??null:null;}

const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export class FootstepEmitter {
 // trait: CharacterFootstepTrait {defaultFootsteps, strideDist, minAudioDist, maxAudioDist, animal, maxPerSecond}.
 constructor(trait,{local=false,quality=FOOTSTEP_QUALITY}={}){this.trait=trait;this.local=local;this.quality=quality;this.reset();}
 // Start(): lastFootstepPos = origin on the next update; a new character starts with no accumulated movement.
 reset(){this.lastPos=null;this.nextAllowTime=0;this.moved=0;this.lastPlayed=null;}
 get timeLimited(){const m=this.trait.maxPerSecond;return m>0&&Number.isFinite(m);}
 get minInterval(){return this.timeLimited?1/this.trait.maxPerSecond:0;}
 // One Update(). origin: feet position; state {grounded, crouch}; surfaceAt(): the SurfaceInfoObject footstep entry
 // ({biped, animal} clip lists) under the feet, or null when nothing within 1 m (GetBelowObj) - only called on a step.
 // Returns the step to play or null.
 update(time,origin,{grounded=true,crouch=false}={},surfaceAt=null,rng=Math.random){
  if(!this.lastPos)this.lastPos=[origin[0],origin[1],origin[2]];
  const trait=this.trait;
  // Airborne/rate-limited frames return before the distance is accumulated, so the movement made meanwhile is
  // added at once on the next counted frame (a landing usually steps).
  if(!grounded||(this.timeLimited&&this.nextAllowTime>time))return null;
  this.moved+=distance(this.lastPos,origin);this.lastPos=[origin[0],origin[1],origin[2]];
  // The shipped comparison uses sqrStrideDist: a step per strideDist^2 metres (3.24 m for players, 0.09 m for animals).
  if(!(this.moved>=trait.strideDist*trait.strideDist))return null;
  this.moved=0;let clip=null,surface=null;
  if(this.quality>=2||(this.quality===1&&this.local)){
   surface=surfaceAt?.()??null;
   if(surface)clip=this.lastPlayed=trait.animal?footstepAnimal(surface.animal,rng):footstepBiped(surface.biped,this.lastPlayed,rng);
  }
  if(!clip){const list=trait.defaultFootsteps??[];if(!list.length)return null;clip=list[randomIndex(rng,list.length)];if(!clip)return null;}
  const pitch=randomRange(rng,...FOOTSTEP.pitch);
  const step=crouch?{clip,volume:FOOTSTEP.crouchVolume,pitch,min:trait.minAudioDist*FOOTSTEP.crouchDistance,max:trait.maxAudioDist*FOOTSTEP.crouchDistance}
   :{clip,volume:FOOTSTEP.volume,pitch,min:trait.minAudioDist,max:trait.maxAudioDist};
  if(this.timeLimited)this.nextAllowTime=time+this.minInterval;
  step.surface=surface?.name??null;return step;
 }
}

// SurfaceInfo.GetSurfaceInfoFor -> footstep lists. `surfaceKey` is the deployables-manifest SurfaceInfoObject identity
// (terrain splat route, structure/deployable SurfaceInfo or the native default).
export function surfaceFootsteps(audioManifest,surfaceKey){
 const s=audioManifest?.surfaces?.[surfaceKey]??audioManifest?.surfaces?.[audioManifest?.defaultSurface];
 return s?{name:s.name,biped:s.biped,animal:s.animal}:null;
}

// Character prefab name -> its CharacterFootstepTrait (only prefabs that carry a FootstepEmitter).
export function footstepTraitFor(audioManifest,characterName){
 const c=audioManifest?.characters?.[characterName];if(!c?.footstepEmitter||!c.footsteps)return null;return audioManifest.footstepTraits[c.footsteps]??null;
}

// ---- Ambience: AmbientAudioPlayer (17 __WORLD/ForestAmbient emitters share identical timing) ----
// Awake: both sources silent and stopped; InvokeRepeating(CheckTimeChange, 0, 5); while NeedsAudioUpdate,
// UpdateVolume runs every frame: the wanted source starts if stopped and gains 0.2/s, the other loses 0.2/s and
// stops once below zero. Without an EnvironmentControlCenter (no sky) it is always day.
export class AmbientAudioState {
 constructor(){this.day={volume:0,playing:false};this.night={volume:0,playing:false};this.nextCheck=0;this.updating=false;this.started=null;}
 needsUpdate(night){return night?(this.night.volume<1||this.day.volume>0):(this.day.volume<1||this.night.volume>0);}
 // Returns {start:'day'|'night'|null, stop:...} transitions for the caller's sources.
 update(time,dt,night){const out={start:null,stop:null};
  if(this.started===null)this.started=time,this.nextCheck=time;
  while(time>=this.nextCheck){this.nextCheck+=5;if(this.needsUpdate(night))this.updating=true;}
  if(!this.updating)return out;
  if(!this.needsUpdate(night)){this.updating=false;return out;}
  const want=night?this.night:this.day,other=night?this.day:this.night;
  if(!want.playing){want.playing=true;out.start=night?'night':'day';}
  want.volume+=0.2*dt;other.volume-=0.2*dt;if(want.volume>1)want.volume=1;
  if(other.volume<0){other.volume=0;if(other.playing){other.playing=false;out.stop=night?'day':'night';}}
  return out;}
}

// ---- Music: MusicPlayer (island: startDelay 20, timeBetweenTracks 600, targetVolume 0.4; PageUp toggles the saved
// MUSIC_MUTE). Volume = targetVolume * sound.music, raised by dt/3*target per frame, clamped down at once.
export class MusicState {
 constructor(config,{time=0,muted=false,rng=Math.random}={}){this.config=config;this.rng=rng;this.volume=0;this.wasMuted=muted;this.nextMusicTime=time+3+(config.startDelay??0);this.track=null;
  this.enabled=Boolean(config.tracks?.length);}
 // lengthOf(track) -> seconds, or null while the clip is not decoded (the play is deferred, a browser-only wait).
 update(time,dt,{muted=false,music=SOUND_DEFAULTS.music,lengthOf=()=>0}={}){const events=[];if(!this.enabled)return events;
  if(this.wasMuted!==muted){if(this.wasMuted&&time>this.nextMusicTime)this.nextMusicTime=time;else{events.push({type:'stop'});this.track=null;this.nextMusicTime=time;}this.wasMuted=!this.wasMuted;}
  if(this.wasMuted)return events;
  if(time>this.nextMusicTime){const tracks=this.config.tracks,track=tracks[randomIndex(this.rng,tracks.length)],length=lengthOf(track);
   if(length!=null){events.push({type:'stop'});this.track=track;this.nextMusicTime=time+length+this.config.timeBetweenTracks*randomRange(this.rng,0.75,1.25);events.push({type:'play',track});}}
  const target=this.config.targetVolume*music;if(this.volume<target)this.volume+=dt/3*target;if(this.volume>target)this.volume=target;
  return events;}
}

// ---- Radiation geiger loop (LocalRadiationEffect.Update): exposure without armour >= 0.02 plays a looping 2D-placed
// AudioSource on the player; Radiation.GetRadExposureScalar = clamp01(exposure / 1000) picks the clip.
export const GEIGER_CLIPS=['content/item/sfx/geiger_low','content/item/sfx/geiger_medium','content/item/sfx/geiger_high','content/item/sfx/geiger_ultra'];
export function geigerClip(exposure){if(!(exposure>=0.02))return null;const s=clamp01(exposure/1000);return GEIGER_CLIPS[s<=0.25?0:s<=0.5?1:s<=0.75?2:3];}

// FallDamage.FallImpact: legBreakSound.Play(transform.position, 1, 3, 10) (linear rolloff, SoundPool defaults).
export const LEG_BREAK={volume:1,min:3,max:10};
// Metabolism.Vomit: Bundling.Load("content/shared/sfx/vomit").Play(1) - camera-attached, i.e. heard at full volume.
export const VOMIT={path:'content/shared/sfx/vomit',volume:1};
// SoundPool.Play culling: a linear/custom rolloff sound farther than max (logarithmic: 2 * max) from the camera is
// never started.
export function soundPoolAudible(distanceToCamera,max,mode='linear'){return mode==='logarithmic'?distanceToCamera<=max*2:distanceToCamera<=max;}
