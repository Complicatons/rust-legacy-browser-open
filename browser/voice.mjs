import {PositionalAudio,Vector3} from 'three';
import {USpeakSender,USpeakReceiver,PlaybackClock,MALE_PLAYER_USPEAKER,BoxResampler,splitPayload,parseFrames,speakerVolume,iconOpacity,bandFrequency,VOICE_MIN_DISTANCE} from './uspeak.mjs';
import {controlOf} from './dfgui.mjs';
import {anchorLayout} from './death-screen.mjs';
import {color32} from './popup-ui.mjs';
import {loadFrontendSkin} from './frontend-skin.mjs';
// Rust Legacy voice chat in the browser (VoiceCom + USpeaker + VoiceChatIcon; rules and codec in uspeak.mjs).
//
// Talking: GameInput "Voice" (default bind V, client.cfg "input.bind Voice V None"; rebindable, key-bindings.mjs). VoiceCom.ShouldSend = character
// alive && Voice held. While sending, 100-sample µ-law frames at 8 kHz go to the server every 1/8 s as
// clientspeak(5, frames) on our character view (the gateway's 'voice' command; bridge/voice.mjs).
// Privacy: the desktop client opens the microphone when the character spawns and keeps it recording. The browser opens
// it only on a Voice key press (the first press shows the browser's permission prompt; a refusal is final for the
// page) and closes it as soon as the key is released and the last buffered frames are sent. Nothing is captured while
// the key is up, and nothing is captured at all offline.
// Hearing: VoiceCom.voiceplay(hearDistance, setupData, data) from the server for every other speaker in range.
// Volume = clamp01(1 - |camera - speaker eyes| / hearDistance), then a 3D source on the speaker (linear rolloff,
// min 1 m, max hearDistance) under the AudioListener master gain (sound.volume, audioSettings). The original shows no
// icon for other speakers: VoiceChatIcon (HUD pnlVoiceIcon) shows only our own level while Voice is held.

const GAIN_EPSILON=1e-4;
// Parent-relative rectangles (dfControl.AnchorLayout) of the exported HUD nodes; the HUD root anchors to the screen.
function hudLayout(nodes,viewport){const rects=[];nodes.forEach((n,i)=>{const c=controlOf(n);if(!c)return;const p=n.parent>=0?rects[n.parent]:null;
 rects[i]=anchorLayout(c.data.layout,c.data.size,p?{x:p.width,y:p.height}:{x:viewport.width,y:viewport.height});});return rects;}

// send(setup, bytes) -> bool; canTalk() -> alive && in game && no menu/chat; getListener() -> THREE.AudioListener|null;
// speaker(viewId) -> {position:[x,y,z] browser-space character root, eyes:[x,y,z]}|null.
export async function createVoiceChat({send,canTalk=()=>false,getListener=()=>null,unlock=()=>{},scene=null,camera=null,speaker=()=>null,isOwn=()=>false,
 input,mediaDevices=globalThis.navigator?.mediaDevices,AudioContextImpl=globalThis.AudioContext,workletUrl=new URL('./voice-capture-worklet.mjs',import.meta.url).href,
 document=globalThis.document,base='/assets/recovered/voice/',skin=loadFrontendSkin(),settings=MALE_PLAYER_USPEAKER,hidden=()=>false}={}){
 const sender=new USpeakSender({settings}),frequency=bandFrequency(settings.BandwidthMode);
 const stats={permission:'not-requested',captureStarts:0,captureStops:0,micBlocks:0,sent:0,sentFrames:0,sendFailures:0,received:0,receivedFrames:0,errors:[]};
 // Recent sends with the microphone PCM behind them (checks recompute the encoding); never leaves the page.
 const sentLog=[];
 let capture=null,starting=null,denied=false;
 // GameInput.GetButton("Voice").IsDown(): VoiceCom.ShouldSend and VoiceChatIcon both read the held state directly.
 const isVoiceDown=()=>Boolean(input?.isDown('Voice'));
 const speakers=new Map();

 // ---- HUD pnlVoiceIcon (exported by tools/export_voice.py) ----
 let icon=null,iconRects=null,manifest=null;
 try{const r=await fetch(base+'manifest.json');if(r.ok)manifest=await r.json();}catch{}
 if(manifest&&document){const s=await skin.catch(()=>null),fonts=s?.manifest.fonts??{};const label=manifest.hud.nodes[manifest.hud.icon].components.dfLabel[0],font=fonts[label.fontKey];
  icon=document.createElement('div');icon.id='voice-icon';icon.setAttribute('aria-hidden','true');icon.textContent=label.text;
  const size=Math.ceil((font?.size??16)*(label.textScale??1)),c=color32(label.color.rgba);
  Object.assign(icon.style,{position:'fixed',margin:'0',padding:'0',pointerEvents:'none',zIndex:'5',display:'flex',alignItems:label.vertAlign===1?'center':label.vertAlign===2?'flex-end':'flex-start',
   justifyContent:label.align===1?'center':label.align===2?'flex-end':'flex-start',whiteSpace:'pre',fontFamily:`"${font?.name??'fontawesome-webfont'}"`,fontSize:size+'px',lineHeight:Math.round(size*(font?.lineHeight??font?.size??16)/(font?.size??16))+'px',
   color:`rgb(${c.r},${c.g},${c.b})`,opacity:'0'});
  document.body.append(icon);
  const layout=()=>{iconRects=hudLayout(manifest.hud.nodes,{width:innerWidth,height:innerHeight});let x=0,y=0;for(let i=manifest.hud.icon;i>=0;i=manifest.hud.nodes[i].parent){x+=iconRects[i].x;y+=iconRects[i].y;}
   const r=iconRects[manifest.hud.icon];Object.assign(icon.style,{left:x+'px',top:y+'px',width:r.width+'px',height:r.height+'px'});};
  addEventListener('resize',layout);layout();}
 // dfControl.Opacity stores a Color32 alpha: (byte)(value * 255).
 let shownOpacity=0;
 function setIcon(o){const a=Math.trunc(o*255)/255;if(a===shownOpacity)return;shownOpacity=a;if(icon)icon.style.opacity=String(+a.toFixed(4));}

 // ---- microphone (push-to-talk only) ----
 async function startCapture(){
  if(capture||starting||denied||!mediaDevices?.getUserMedia)return;
  starting=(async()=>{let stream=null;
   try{stats.permission='requested';stream=await mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});stats.permission='granted';}
   catch(e){stats.permission=e?.name==='NotAllowedError'||e?.name==='SecurityError'?'denied':'unavailable';denied=stats.permission==='denied';stats.errors.push('microphone: '+(e?.name??e));return;}
   // Released while the prompt was open: close the microphone at once.
   if(!isVoiceDown()){for(const t of stream.getTracks())t.stop();return;}
   const context=new AudioContextImpl(),resampler=new BoxResampler(context.sampleRate,frequency);
   const c={stream,context,resampler,nodes:[]};capture=c;stats.captureStarts++;sender.reset();
   const onBlock=data=>{if(capture!==c)return;stats.micBlocks++;sender.push(resampler.push(data));};
   try{
    if(context.state==='suspended')await context.resume().catch(()=>{});
    const source=context.createMediaStreamSource(stream),sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);
    let tap;
    if(context.audioWorklet){await context.audioWorklet.addModule(workletUrl);tap=new AudioWorkletNode(context,'rlb-voice-capture');tap.port.onmessage=e=>onBlock(e.data);}
    else{tap=context.createScriptProcessor(1024,1,1);tap.onaudioprocess=e=>onBlock(Float32Array.from(e.inputBuffer.getChannelData(0)));}
    source.connect(tap);tap.connect(sink);c.nodes.push(source,tap,sink);
   }catch(e){stats.errors.push('capture: '+(e?.message??e));stopCapture();}
  })().finally(()=>{starting=null;});
 }
 function stopCapture(){const c=capture;if(!c)return;capture=null;stats.captureStops++;
  for(const t of c.stream.getTracks())t.stop();for(const n of c.nodes)try{n.disconnect();}catch{}c.context.close().catch(()=>{});sender.reset();}

 // The microphone is requested only from a Voice press (a key or mouse event: the user activation the permission prompt
 // needs), never from a frame update.
 const press=e=>{if(e.detail?.button!=='Voice'||!canTalk())return;unlock();startCapture();};
 input?.addEventListener('press',press);

 // ---- remote speakers ----
 function speakerAudio(viewId,listener){let s=speakers.get(viewId);if(s&&s.listener===listener)return s;if(s)dispose(viewId);
  const ctx=listener.context,inputGain=ctx.createGain(),audio=new PositionalAudio(listener);
  audio.panner.panningModel='equalpower';audio.setDistanceModel('linear');audio.setRefDistance(VOICE_MIN_DISTANCE);audio.setRolloffFactor(1);audio.setMaxDistance(100);audio.setNodeSource(inputGain);audio.setVolume(0);
  scene?.add(audio);
  s={viewId,listener,input:inputGain,audio,receiver:new USpeakReceiver({settings}),clock:new PlaybackClock(),volume:0,hearDistance:100,packets:0,frames:0,scheduled:[],sources:new Set(),error:null};
  speakers.set(viewId,s);return s;}
 function dispose(viewId){const s=speakers.get(viewId);if(!s)return;speakers.delete(viewId);for(const src of s.sources)try{src.stop();}catch{}try{s.audio.disconnect();}catch{}scene?.remove(s.audio);}
 const tmp=new Vector3();
 function cameraPosition(){if(!camera)return [0,0,0];camera.getWorldPosition(tmp);return [tmp.x,tmp.y,tmp.z];}

 // VoiceCom.voiceplay(float hearDistance, int setupData, byte[] data) on viewId. Returns what happened (for checks).
 function receive(viewId,hearDistance,setupData,data){
  const listener=getListener();
  if(!listener||!camera||!(hearDistance>0)||!(data instanceof Uint8Array))return null; // no Camera.main / audio yet
  if(isOwn(viewId))return null; // SpeakerMode.Local ignores received audio (DebugPlayback off)
  const where=speaker(viewId);if(!where)return null;
  const s=speakerAudio(viewId,listener),ctx=listener.context;
  s.hearDistance=hearDistance;s.volume=speakerVolume(cameraPosition(),where.eyes,hearDistance);s.position=where.position;
  s.audio.setMaxDistance(Math.max(hearDistance,VOICE_MIN_DISTANCE+0.01));s.audio.position.set(...where.position);s.audio.setVolume(s.applied=Math.max(s.volume,0));
  const {frames,error}=s.receiver.receive(setupData,data);s.packets++;stats.received++;if(error){s.error=error;stats.errors.push(`voiceplay ${viewId}: ${error}`);}
  const starts=s.clock.schedule(ctx.currentTime,frames.map(f=>f.length/frequency));
  frames.forEach((f,i)=>{const at=starts[i];if(at==null||!f.length)return;
   const buffer=ctx.createBuffer(1,f.length,frequency);buffer.copyToChannel(f,0);const src=ctx.createBufferSource();src.buffer=buffer;src.connect(s.input);src.start(at);
   s.sources.add(src);src.onended=()=>{s.sources.delete(src);try{src.disconnect();}catch{}};
   s.frames++;stats.receivedFrames++;s.scheduled.push({at,samples:f.length,peak:f.reduce((m,x)=>Math.max(m,Math.abs(x)),0)});if(s.scheduled.length>64)s.scheduled.shift();});
  return {viewId,frames:frames.length,starts,volume:s.volume,error};
 }

 return {
  receive,
  // VoiceCom.init(int): USpeaker.InitializeSettings (also replaces earlier settings).
  init(viewId,data){const listener=getListener();if(!listener||isOwn(viewId))return;speakerAudio(viewId,listener).receiver.initialize(data);},
  removeSpeaker:dispose,
  // Per game frame: microphone frames -> clientspeak; icon; speaker positions.
  update(dt){
   const talk=()=>isVoiceDown()&&canTalk();
   for(const payload of sender.update(dt,talk)){let first=0;for(const part of splitPayload(payload,24)){const n=parseFrames(part).frames.length,pcm=sender.lastSentPcm.slice(first,first+n);first+=n;
    if(send(sender.setupData,part)){stats.sent++;stats.sentFrames+=n;sentLog.push({bytes:part,pcm});if(sentLog.length>16)sentLog.shift();}else stats.sendFailures++;}}
   // The microphone closes once the key is up (or talking is no longer possible) and nothing is left to send.
   if(capture&&!talk()&&!sender.sendBuffer.length)stopCapture();
   setIcon(hidden()?0:iconOpacity(isVoiceDown(),sender.currentVolume));
   for(const [id,s] of speakers){const where=speaker(id);if(!where){if(!s.sources.size)dispose(id);continue;}s.position=where.position;s.audio.position.set(...where.position);
    if(Math.abs(s.applied-s.volume)>GAIN_EPSILON)s.audio.setVolume(s.applied=s.volume);}
  },
  clear(){for(const id of [...speakers.keys()])dispose(id);stopCapture();},
  dispose(){this.clear();input?.removeEventListener('press',press);icon?.remove();},
  get talking(){return isVoiceDown()&&canTalk();},
  // Developer checks only (explorerDev): the last sends with their PCM, as plain arrays.
  sentLog:()=>sentLog.map(e=>({bytes:Array.from(e.bytes),pcm:e.pcm.map(p=>Array.from(p))})),
  debug(){return {...stats,voiceDown:isVoiceDown(),capturing:Boolean(capture),setup:sender.setupData,currentVolume:sender.currentVolume,iconOpacity:shownOpacity,iconRect:icon?(({left,top,width,height})=>({left,top,width,height}))(icon.getBoundingClientRect()):null,
   speakers:[...speakers.values()].map(s=>({viewId:s.viewId,packets:s.packets,frames:s.frames,volume:s.volume,hearDistance:s.hearDistance,position:s.position,gain:s.audio.getVolume(),
    panner:{model:s.audio.panner.distanceModel,ref:s.audio.panner.refDistance,max:s.audio.panner.maxDistance,x:s.audio.panner.positionX.value,y:s.audio.panner.positionY.value,z:s.audio.panner.positionZ.value},scheduled:s.scheduled.slice(-16),now:s.listener.context.currentTime,error:s.error}))};},
 };
}
