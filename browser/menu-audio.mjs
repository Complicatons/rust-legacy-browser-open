import {AudioListener,Audio,PositionalAudio,AudioLoader,Object3D} from 'three';
import {MusicState,audioSettings} from './audio.mjs';
// Menu Background scene audio (tools/export_audio.py `menu`): the "Menu Background/MusicPlayer" MusicPlayer (2D music track,
// startDelay 3, targetVolume 0.2, timeBetweenTracks 0) and the playOnAwake looping AudioSources "wind" and "FireBarrel"
// (3D, Logarithmic rolloff, min 1, max 500) heard by the scene's only enabled AudioListener, on its Main Camera. Volumes go
// through audioSettings: sound.volume is AudioListener.volume (master), sound.music scales MusicPlayer.targetVolume.
// MusicPlayer.settings.mute (PlayerPrefs MUSIC_MUTE, PageUp) is shared with the island's MusicPlayer (world-audio.mjs).
// Browsers start audio only after a user gesture: the scene clock runs from the menu start (MusicPlayer.Start), and the
// AudioContext resumes on the first pointer or key press, so a track that was due meanwhile starts then.

export const MUTE_KEY='rlb-music-mute';
// Unity Logarithmic rolloff (gain = minDistance / distance beyond minDistance) is Web Audio's inverse model with refDistance
// = minDistance and rolloffFactor 1.
export function rolloffGain(distance,{minDistance=1,rolloffMode=0}={},maxDistance=500){
 if(rolloffMode===1)return Math.max(0,1-(Math.min(distance,maxDistance)-minDistance)/Math.max(1e-6,maxDistance-minDistance));
 return distance<=minDistance?1:minDistance/distance;}
// Unity positions (left-handed) to the menu scene's browser space (z mirrored, as the exported camera matrix).
export const browserPosition=p=>[p[0],p[1],-p[2]];

export function createMenuAudio({manifest,base='/assets/recovered/audio/',camera,settings=audioSettings,storage=globalThis.localStorage,
 gestureTarget=globalThis,keyTarget=globalThis.document,loader=new AudioLoader(),now=()=>performance.now()/1000,rng=Math.random}){
 const menu=manifest?.menu??{},musicConfig=menu.music?.[0]??null,loops=(menu.loops??[]).filter(l=>l.active!==false&&l.enabled!==false&&l.playOnAwake&&l.clip);
 const buffers=new Map(),decode=file=>{if(!buffers.has(file)){const entry={buffer:null,promise:null};entry.promise=loader.loadAsync(base+file).then(b=>entry.buffer=b).catch(e=>console.warn('Menu audio unavailable: '+file,e));buffers.set(file,entry);}return buffers.get(file);};
 let listener=null,disposed=false,unlocked=false,frame=0,last=now();const sources=[],state={music:null,musicSound:null};
 let muted=false;try{muted=storage?.getItem(MUTE_KEY)==='1';}catch{}
 const music=musicConfig?new MusicState(musicConfig,{time:last,muted,rng}):null;
 const anchor=new Object3D();
 function ensureListener(){if(listener)return listener;listener=new AudioListener();listener.matrixAutoUpdate=false;anchor.add(listener);
  // The listener follows the Main Camera's exported world matrix.
  listener.matrix.copy(camera.matrixWorld);listener.updateMatrixWorld(true);listener.setMasterVolume(settings.master);
  for(const l of loops){const s=new PositionalAudio(listener);s.panner.panningModel='equalpower';s.setDistanceModel(l.rolloffMode===1?'linear':'inverse');s.setRefDistance(Math.max(0.01,l.minDistance??1));
   s.setMaxDistance(Math.max(l.maxDistance??500,(l.minDistance??1)+0.01));s.setRolloffFactor(1);s.setLoop(true);s.setVolume(l.volume??1);s.setPlaybackRate(l.pitch??1);
   s.matrixAutoUpdate=false;s.matrix.makeTranslation(...browserPosition(l.position));anchor.add(s);s.updateMatrixWorld(true);
   const entry=decode(l.clip);entry.promise.then(()=>{if(disposed||!entry.buffer)return;s.setBuffer(entry.buffer);s.play();});sources.push({loop:l,sound:s});}
  return listener;}
 const offMaster=settings.onChange(()=>listener?.setMasterVolume(settings.master));
 // Every gesture retries until the context runs (Escape, for one, is not a user activation).
 function unlock(){if(disposed)return;ensureListener();const ctx=listener.context;for(const t of musicConfig?.tracks??[])decode(t);
  if(ctx.state==='running'){unlocked=true;return;}ctx.resume().then(()=>{unlocked=ctx.state==='running';}).catch(()=>{});}
 const gesture=e=>{if(e.isTrusted===false)return;unlock();};
 for(const type of ['pointerdown','keydown'])gestureTarget?.addEventListener?.(type,gesture,true);
 const onKey=e=>{if(e.code!=='PageUp'||e.repeat||/^(INPUT|TEXTAREA)$/.test(e.target?.tagName??''))return;muted=!muted;try{if(muted)storage?.setItem(MUTE_KEY,'1');else storage?.removeItem(MUTE_KEY);}catch{}};
 keyTarget?.addEventListener?.('keydown',onKey);
 function step(){if(disposed)return;const t=now(),dt=Math.min(0.25,Math.max(0,t-last));last=t;
  if(!unlocked&&listener?.context.state==='running')unlocked=true;
  if(music){const events=music.update(t,dt,{muted,music:settings.music,lengthOf:track=>unlocked?buffers.get(track)?.buffer?.duration??null:null});
   for(const ev of events){if(ev.type==='stop'&&state.musicSound){if(state.musicSound.isPlaying)state.musicSound.stop();state.musicSound.disconnect();state.musicSound=null;}
    if(ev.type==='play'){const s=state.musicSound=new Audio(listener);s.setBuffer(buffers.get(ev.track).buffer);s.setVolume(music.volume);s.play();state.music=ev.track;}}
   if(state.musicSound)state.musicSound.setVolume(music.volume);}
  frame=requestAnimationFrame(step);}
 frame=requestAnimationFrame(step);
 return {
  unlock,
  snapshot(){return {unlocked,context:listener?.context.state??null,master:listener?listener.getMasterVolume():null,muted,
   music:music&&{volume:music.volume,track:state.music,playing:Boolean(state.musicSound?.isPlaying),next:music.nextMusicTime},
   loops:sources.map(s=>({path:s.loop.path,playing:Boolean(s.sound.isPlaying),volume:s.sound.getVolume()}))};},
  dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(frame);offMaster();for(const type of ['pointerdown','keydown'])gestureTarget?.removeEventListener?.(type,gesture,true);keyTarget?.removeEventListener?.('keydown',onKey);
   for(const s of sources){if(s.sound.isPlaying)s.sound.stop();s.sound.disconnect();}if(state.musicSound){if(state.musicSound.isPlaying)state.musicSound.stop();state.musicSound.disconnect();}listener?.removeFromParent();}};
}
