// Homepage menu music: the original MenuBackground MusicPlayer track and the wind / fire-barrel loops (spec §5.3),
// built by `npm run build:site` into /site/generated/audio. Browsers forbid sound before a user gesture unless the
// reader has already let this site play sound: an audio context made on load tells which. If it may not run yet, the
// first pointer or key press starts the music. Muting is shared with the game (same storage key).
export const MUTE_KEY='rlb-music-mute';

export function createSiteSound({manifest=null,manifestUrl='/site/generated/audio/manifest.json',base='/site/generated/audio/',storage=globalThis.localStorage,
 gestureTarget=globalThis,AudioCtor=globalThis.AudioContext??globalThis.webkitAudioContext,fetchImpl=(...a)=>fetch(...a),onChange=()=>{}}={}){
 let muted=false;try{muted=storage?.getItem(MUTE_KEY)==='1';}catch{}
 let armed=false,ctx=null,master=null,sources=[],timer=null,starting=null;
 // waiting: music is on but the browser has not allowed it yet (no gesture so far, or still loading).
 const state={get muted(){return muted;},get started(){return sources.length>0;},get waiting(){return !muted&&!sources.length;},ready:Promise.resolve(),toggle};

 async function loadManifest(){if(manifest)return manifest;const r=await fetchImpl(manifestUrl);if(!r.ok)throw Error('no audio manifest');return manifest=await r.json();}
 async function buffer(file){const r=await fetchImpl(base+file);if(!r.ok)throw Error('missing '+file);return ctx.decodeAudioData(await r.arrayBuffer());}
 function play(buf,volume,delay=0){
  const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buf;src.loop=true;gain.gain.value=volume;src.connect(gain);gain.connect(master);
  src.start(ctx.currentTime+delay);sources.push(src);
 }
 function context(){if(!ctx){ctx=new AudioCtor();master=ctx.createGain();master.connect(ctx.destination);}return ctx;}
 async function start(){
  if(muted||!armed||sources.length||starting||!AudioCtor)return;
  starting=(async()=>{
   try{
    const m=await loadManifest();
    context();
    await ctx.resume?.();
    const [music,...loops]=await Promise.all([m.music?buffer(m.music.file):null,...(m.loops??[]).map(l=>buffer(l.file))]);
    if(muted)return;
    (m.loops??[]).forEach((l,i)=>play(loops[i],l.volume));
    if(music)play(music,m.music.targetVolume??.2,m.music.startDelay??0);
   }catch(e){console.warn('Menu music unavailable:',e.message);}
   finally{starting=null;onChange();}
  })();
  state.ready=starting;return starting;
 }
 function stop(){for(const s of sources){try{s.stop();}catch{}}sources=[];clearTimeout(timer);onChange();}
 function toggle(){
  // Pressed while the music is on but silent (often the page's first gesture): the reader wants to hear it.
  if(state.waiting){if(!armed)arm();else state.ready=starting??start()??Promise.resolve();return muted;}
  muted=!muted;try{storage?.setItem(MUTE_KEY,muted?'1':'0');}catch{}
  if(muted)stop();else state.ready=start()??Promise.resolve();
  return muted;
 }
 const arm=()=>{if(armed)return;armed=true;gestureTarget.removeEventListener('pointerdown',arm);gestureTarget.removeEventListener('keydown',arm);state.ready=start()??Promise.resolve();};
 gestureTarget.addEventListener('pointerdown',arm);gestureTarget.addEventListener('keydown',arm);
 if(!muted&&AudioCtor){try{if(context().state==='running')arm();}catch{}}
 return state;
}
