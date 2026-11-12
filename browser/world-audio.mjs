import {Audio,PositionalAudio,Vector3,Ray} from 'three';
import {FootstepEmitter,FOOTSTEP_QUALITY,footstepTraitFor,surfaceFootsteps,AmbientAudioState,MusicState,geigerClip,LEG_BREAK,VOMIT,soundPoolAudible,audioSettings} from './audio.mjs';
// Web Audio presentation of the original client's player/world sounds (rules in audio.mjs, data from
// tools/export_audio.py). Everything is local presentation: footsteps of the local player (offline and online),
// remote players (interpolated positions + network state flags) and wildlife, fall impacts, vomit, the radiation
// geiger loop, the 17 ForestAmbient day/night loops and the island MusicPlayer. Volume follows `sound.volume`
// (AudioListener master gain) and `sound.music` from audioSettings.

const STATE_CROUCH=1,STATE_AIRBORNE=16; // CharacterStateFlags kCrouch / kAirborne
const down=new Vector3(0,-1,0);
// Presentation-only randomness (clip choice, pitch, music gaps) from its own generator, so sounds never shift the
// Math.random stream that gameplay (and seeded checks) draw from.
function presentationRandom(seed=(Date.now()^0x9e3779b9)>>>0||1){let s=seed;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};}

// footstepQuality(): the footsteps.quality convar (0 default sound, 1 dynamic for local, 2 dynamic for all), read each frame.
export async function createWorldAudio({manifest,base,getListener,scene,camera,buffers,loader,collisionWorld,surfaceFor,deploySurfaces,settings=audioSettings,
 storage=globalThis.localStorage,keyTarget=globalThis.document,rng=presentationRandom(),footstepQuality=()=>FOOTSTEP_QUALITY}){
 const url=file=>base+file,clipInfo=new Map(Object.values(manifest.clips??{}).map(c=>[c.file,c]));
 // Deployables-manifest surface objects -> their identity, so a SurfaceInfo route maps onto the footstep arrays.
 const surfaceKeys=new Map(Object.entries(deploySurfaces??{}).map(([k,v])=>[v,k]));
 const playerTrait=footstepTraitFor(manifest,'MalePlayer'),offlineTrait=footstepTraitFor(manifest,'OfflinePlayer')??playerTrait;
 // Every SurfaceInfoObject shares one animalFootsteps array in the shipped data; then the ray cannot change the clip.
 const animalLists=new Set(Object.values(manifest.surfaces??{}).map(s=>JSON.stringify(s.animal)));
 const animalRayMatters=animalLists.size>1;
 const stats={footsteps:0,localFootsteps:0,remoteFootsteps:0,animalFootsteps:0,fallImpacts:0,vomits:0,lastFootstep:null,last:{local:null,remote:null,animal:null},culled:0};
 let listener=null;

 function buffer(file){const u=url(file);if(!buffers.has(u))buffers.set(u,loader.loadAsync(u));return buffers.get(u);}
 const decoded=new Map();
 function decode(file){if(!file||decoded.has(file))return;decoded.set(file,null);buffer(file).then(b=>decoded.set(file,b)).catch(e=>{console.warn('Audio unavailable: '+file,e);});}
 function applyMaster(){if(listener)listener.setMasterVolume(settings.master);}
 settings.onChange(applyMaster);

 // SoundPool one-shot: 3D clips use linear rolloff (min, max) at a world position; 2D clips (m_3D false) and
 // camera-attached plays are heard without attenuation. Culled when farther than max from the camera.
 function oneShot(file,position,{volume=1,pitch=1,min=1,max=500,attached=false}={}){
  if(!listener||!file)return false;
  if(!attached&&!soundPoolAudible(position.distanceTo(camera.position),max)){stats.culled++;return false;}
  const info=clipInfo.get(file),spatial=!attached&&info?.is3D!==false;
  buffer(file).then(b=>{const s=spatial?new PositionalAudio(listener):new Audio(listener);s.setBuffer(b);s.setVolume(volume);s.setPlaybackRate(pitch);
   if(spatial){s.panner.panningModel='equalpower';s.setDistanceModel('linear');s.setRefDistance(Math.max(min,0.01));s.setMaxDistance(Math.max(max,min+0.01));s.setRolloffFactor(1);s.position.copy(position);scene.add(s);}
   s.onEnded=()=>{s.disconnect();if(spatial)scene.remove(s);};s.play();}).catch(()=>{});
  return true;}

 // FootstepEmitter.GetBelowObj: Physics.Raycast(transform.position + 0.25 up, down, 1 m). Hit regions and other
 // no-collide bodies are not PhysX colliders in the original (HitBoxSystem shapes), so they are skipped.
 const skip=b=>Boolean(b?.noCollide);
 function surfaceBelow(origin){const o=new Vector3(origin[0],origin[1]+0.25,origin[2]),hit=collisionWorld.raycast(new Ray(o,down),1,skip);if(!hit)return null;
  const surface=surfaceFor({terrain:Boolean(hit.terrain),body:hit.body,point:hit.position.toArray()});return surfaceFootsteps(manifest,surfaceKeys.get(surface)??manifest.defaultSurface);}

 function playStep(step,origin,kind){if(!step)return;stats.footsteps++;stats[kind+'Footsteps']++;
  const p=new Vector3(origin[0],origin[1],origin[2]);const played=oneShot(step.clip,p,{volume:step.volume,pitch:step.pitch,min:step.min,max:step.max});
  stats.lastFootstep=stats.last[kind]={kind,clip:clipInfo.get(step.clip)?.name??step.clip,surface:step.surface,volume:step.volume,min:step.min,max:step.max,played,position:origin};}

 // Local character (OfflinePlayer offline, MalePlayer online): stateFlags from the motor.
 let local=null,localTeleports=-1;
 const remotes=new Map(),animals=new Map();
 const tmp=new Vector3();
 function originOf(matrix){tmp.setFromMatrixPosition(matrix);return [tmp.x,tmp.y,tmp.z];}

 // AmbientAudioPlayer: one shared timing state, 17 emitters x (day, night) linear 150..300 m sources.
 const ambient=manifest.island?.ambient??[],ambientState=new AmbientAudioState(),ambientSources={day:[],night:[]};
 function startAmbient(which){if(!listener)return;
  for(const e of ambient){const src=which==='day'?e.daySource:e.nightSource,file=which==='day'?e.daySound:e.nightSound,b=decoded.get(file);if(!b)continue;
   const s=new PositionalAudio(listener);s.panner.panningModel='equalpower';s.setBuffer(b);s.setLoop(src.loop);s.setVolume(0);
   s.setDistanceModel(src.rolloffMode===1?'linear':'inverse');s.setRefDistance(src.minDistance);s.setMaxDistance(src.maxDistance);s.setRolloffFactor(1);
   s.position.set(e.position[0],e.position[1],e.position[2]);scene.add(s);ambientSources[which].push({sound:s,base:src.volume});}
  // Same AudioContext time for every emitter, as Unity starts them in the same frame.
  for(const a of ambientSources[which])a.sound.play();}
 function stopAmbient(which){for(const a of ambientSources[which]){if(a.sound.isPlaying)a.sound.stop();a.sound.disconnect();scene.remove(a.sound);}ambientSources[which]=[];}
 let ambientPending=null;

 // MusicPlayer (island scene). 2D clip; the browser starts its clock when audio is first unlocked.
 const musicConfig=manifest.island?.music?.[0]??null;let music=null,musicSound=null;const MUTE_KEY='rlb-music-mute';
 let muted=false;try{muted=storage?.getItem(MUTE_KEY)==='1';}catch{}
 keyTarget?.addEventListener?.('keydown',e=>{if(e.code!=='PageUp'||e.repeat||/^(INPUT|TEXTAREA)$/.test(e.target?.tagName??''))return;muted=!muted;try{if(muted)storage?.setItem(MUTE_KEY,'1');else storage?.removeItem(MUTE_KEY);}catch{}});

 // Geiger loop on the local character.
 let geiger=null,geigerPath=null;
 function setGeiger(path,origin){if(path===geigerPath&&geiger){geiger.position.set(origin[0],origin[1],origin[2]);return;}
  if(geiger){if(geiger.isPlaying)geiger.stop();geiger.disconnect();scene.remove(geiger);geiger=null;}geigerPath=path;if(!path||!listener)return;
  const file=manifest.named?.[path],b=decoded.get(file);if(!b){decode(file);geigerPath=null;return;}
  // new GameObject(typeof(AudioSource)): Unity defaults volume 1, logarithmic rolloff, min 1, max 500.
  const s=geiger=new PositionalAudio(listener);s.panner.panningModel='equalpower';s.setBuffer(b);s.setLoop(true);s.setDistanceModel('inverse');s.setRefDistance(1);s.setMaxDistance(500);s.setRolloffFactor(1);
  s.position.set(origin[0],origin[1],origin[2]);scene.add(s);s.play();}

 return {
  stats,
  // frame state: local {origin, grounded, crouch, teleports, active}, remotes Map id -> view ({root, flags}),
  // animals Map animal -> view ({root, animal}), night (TOD IsNight), radiation exposure without armour.
  frame(time,dt,{local:me=null,remotes:remoteViews=null,animals:animalViews=null,night=false,radiation=0}={}){
   const l=getListener?.()??null;if(l!==listener){listener=l;applyMaster();
    // Long loops are fetched once audio is unlocked, keeping them out of the island's load bandwidth.
    if(listener){for(const e of ambient){decode(e.daySound);decode(e.nightSound);}for(const t of musicConfig?.tracks??[])decode(t);}}
   const quality=footstepQuality();
   // Local character.
   if(me?.active){if(!local||me.teleports!==localTeleports){local=new FootstepEmitter(me.online?playerTrait:offlineTrait,{local:true});localTeleports=me.teleports;}
    local.quality=quality;const step=local.update(time,me.origin,{grounded:me.grounded,crouch:me.crouch},()=>surfaceBelow(me.origin),rng);playStep(step,me.origin,'local');}
   else local=null;
   // Remote players (FootstepEmitter on every MalePlayer proxy; grounded/crouch from the interpolated state flags).
   if(remoteViews&&playerTrait){for(const [id,v] of remoteViews){let e=remotes.get(id);if(!e)remotes.set(id,e=new FootstepEmitter(playerTrait));e.seen=time;
     e.quality=quality;const origin=originOf(v.root.matrix),flags=v.flags??0;
     playStep(e.update(time,origin,{grounded:!(flags&STATE_AIRBORNE),crouch:Boolean(flags&STATE_CROUCH)},()=>surfaceBelow(origin),rng),origin,'remote');}
    for(const [id,e] of remotes)if(e.seen!==time)remotes.delete(id);}
   // Wildlife: client stateFlags are never set for animals, so they always count as grounded.
   if(animalViews){for(const [a,v] of animalViews){const trait=footstepTraitFor(manifest,a.def?.name);if(!trait)continue;let e=animals.get(a);if(!e)animals.set(a,e=new FootstepEmitter(trait));e.seen=time;
     e.quality=quality;const origin=originOf(v.root.matrix);
     playStep(e.update(time,origin,{grounded:true},animalRayMatters?()=>surfaceBelow(origin):()=>surfaceFootsteps(manifest,manifest.defaultSurface),rng),origin,'animal');}
    for(const [a,e] of animals)if(e.seen!==time)animals.delete(a);}
   // Ambience.
   if(ambient.length){const change=ambientState.update(time,dt,night);
    if(change.stop)stopAmbient(change.stop);if(change.start)ambientPending=change.start;
    if(ambientPending&&listener&&ambient.every(e=>decoded.get(ambientPending==='day'?e.daySound:e.nightSound))){startAmbient(ambientPending);ambientPending=null;}
    for(const which of ['day','night'])for(const a of ambientSources[which])a.sound.setVolume(a.base*ambientState[which].volume);}
   // Music.
   if(musicConfig&&listener){music??=new MusicState(musicConfig,{time,muted,rng});
    for(const ev of music.update(time,dt,{muted,music:settings.music,lengthOf:t=>decoded.get(t)?.duration??null})){
     if(ev.type==='stop'&&musicSound){if(musicSound.isPlaying)musicSound.stop();musicSound.disconnect();musicSound=null;}
     if(ev.type==='play'){const s=musicSound=new Audio(listener);s.setBuffer(decoded.get(ev.track));s.setVolume(music.volume);s.play();}}
    if(musicSound)musicSound.setVolume(music.volume);}
   // Geiger.
   if(me?.active)setGeiger(geigerClip(radiation),me.origin);else setGeiger(null);
  },
  // FallDamage.FallImpact (offline landing, or the server's fIc for any character).
  fallImpact(origin){const file=manifest.characters?.MalePlayer?.legBreakSound;stats.fallImpacts++;return oneShot(file,origin.clone?origin.clone():new Vector3(...origin),LEG_BREAK);},
  vomit(){stats.vomits++;return oneShot(manifest.named?.[VOMIT.path],camera.position.clone(),{volume:VOMIT.volume,attached:true});},
  // debug([x,y,z]) also reports the footstep surface GetBelowObj finds under that point.
  debug(point){return {...stats,last:{...stats.last},...(point?{surfaceAt:surfaceBelow(point)?.name??null}:{}),listener:Boolean(listener),master:settings.master,music:{volume:music?.volume??0,track:music?.track?clipInfo.get(music.track)?.name:null,playing:Boolean(musicSound?.isPlaying),muted,next:music?.nextMusicTime??null},
   ambient:{day:ambientState.day.volume,night:ambientState.night.volume,playing:{day:ambientSources.day.length,night:ambientSources.night.length},pending:ambientPending,emitters:ambient.length},
   geiger:geigerPath,emitters:{local:Boolean(local),remote:remotes.size,animal:animals.size}};},
 };
}
