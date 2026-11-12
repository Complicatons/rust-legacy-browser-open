// USpeak 2.x voice pipeline as shipped in the Rust Legacy client (pure rules, no Web Audio; see voice.mjs).
// Ported from the decompiled client Assembly-CSharp (identical in the server build): USpeaker, VoiceCom,
// MoPhoGames.USpeak.Codec.{ADPCMCodec,MuLawCodec}, MoPhoGames.USpeak.Core.{USpeakAudioClipCompressor,
// USpeakAudioClipConverter,USpeakFrameContainer,USpeakSettingsData}, USpeakCodecManager, VoiceChatIcon.
// Serialized values come from the client bundles (tools/export_voice.py): the MalePlayer prefab's USpeaker and the
// Resources/CodecManager asset. Every quirk below is the shipped behaviour, kept so desktop clients hear us and we
// hear them exactly as they hear each other.

// content/character/male/maleplayer USpeaker (gameobject.000 path 1178867802): Narrow band, codec 1, 8 sends/s,
// Constant sending, no VAD, Full3D clip. (A second USpeaker on rust/player/voicecom/uspeak/prefabs/networkeduspeaker is
// the unused USpeak sample prefab.)
export const MALE_PLAYER_USPEAKER=Object.freeze({SpeakerMode:0,BandwidthMode:0,SendRate:8,SendingMode:0,UseVAD:0,_3DMode:2,DebugPlayback:0,AskPermission:1,Mute:0,SpeakerVolume:1,VolumeThreshold:0.01,Codec:1});
// Resources/CodecManager (resources.assets path 134): CodecNames in index order.
export const CODEC_NAMES=Object.freeze(['MoPhoGames.USpeak.Codec.ADPCMCodec','MoPhoGames.USpeak.Codec.MuLawCodec']);
export const BAND={Narrow:0,Wide:1,UltraWide:2};
// USpeaker.audioFrequency (recording and playback rate of the receiving prefab's own BandwidthMode).
export const bandFrequency=band=>band===BAND.Wide?16000:band===BAND.UltraWide?32000:8000;
// ICodec.GetSampleSize returns 0 for both codecs, so USpeaker.Update falls back to blocks of 100 samples
// (`if (num3 == 0) num3 = 100;`); OnAudioAvailable's SplitArray(1280) then leaves every block whole.
export const FRAME_SAMPLES=100;
export const SPLIT_SIZE=1280;
// VoiceCom.voiceplay: AudioSource rolloff Linear, minDistance 1, maxDistance hearDistance (server voice.distance, 100).
export const VOICE_MIN_DISTANCE=1;
export const SERVER_VOICE_DISTANCE=100; // server voice.cs [Admin] distance default

const f32=Math.fround;

// ---- USpeakSettingsData ----
// ToByte: Narrow -> bit 1, Wide -> bit 2, UltraWide -> neither; codec index << 2.
export function settingsToByte({bandMode=BAND.Narrow,codec=0}={}){let b=0;if(bandMode===BAND.Narrow)b|=1;else if(bandMode===BAND.Wide)b|=2;return (b|((codec<<2)&0xff))&0xff;}
// USpeakSettingsData(byte): bit 1 wins over bit 2; codec = src >> 2. VoiceCom passes the int setupData cast to byte.
export function settingsFromByte(src){src&=0xff;return {bandMode:(src&1)===1?BAND.Narrow:(src&2)===2?BAND.Wide:BAND.UltraWide,codec:src>>2};}
// The setup byte every desktop client sends (USpeaker.UpdateSettings with the MalePlayer values): Narrow | MuLaw<<2 = 5.
export const MALE_PLAYER_SETUP=settingsToByte({bandMode:MALE_PLAYER_USPEAKER.BandwidthMode,codec:MALE_PLAYER_USPEAKER.Codec});

// ---- ADPCMCodec (an IMA-style coder with the shipped quirks) ----
const INDEX_TABLE=Object.freeze([-1,-1,-1,-1,2,4,6,8,-1,-1,-1,-1,2,4,6,8]);
// 88 entries, including the shipped typo 203500 (IMA has 20350) at index 82. Index is clamped to 88, one past the end:
// reaching it throws IndexOutOfRangeException in the original (see adpcmStep).
export const ADPCM_STEPS=Object.freeze([7,8,9,10,11,12,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,
 371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1522,1707,1876,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,
 6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,203500,22385,24623,27086,29794,32767]);
const toShort=v=>(v<<16)>>16;
export class ADPCMCodec{
 constructor(){this.init();}
 init(){this.predictedSample=0;this.stepsize=7;this.index=0;this.newSample=0;}
 step(){if(this.index>=ADPCM_STEPS.length)throw new RangeError(`IndexOutOfRangeException: ADPCMCodec.stepsizeTable[${this.index}]`);this.stepsize=ADPCM_STEPS[this.index];}
 // ADPCM_Decode: the shipped decoder does not accumulate a predictor; it returns the scaled difference itself, and its
 // first term multiplies the whole nibble (sign bit included).
 decodeNibble(s){const st=this.stepsize;let num=Math.trunc(st*s/4)+Math.trunc(st/8);
  if((s&4)===4)num+=st;if((s&2)===2)num+=st>>1;if((s&1)===1)num+=st>>2;num+=st>>3;if((s&8)===8)num=-num;
  this.newSample=num>32767?32767:num<-32768?-32768:num;
  this.index+=INDEX_TABLE[s];if(this.index<0)this.index=0;if(this.index>88)this.index=88;this.step();return toShort(this.newSample);}
 encodeSample(sample){let num=sample-this.predictedSample;
  if(num>=0)this.newSample=0;else{this.newSample=8;num=-num;}
  let b=4,num2=this.stepsize;for(let i=0;i<3;i++){if(num>=num2){this.newSample|=b;num-=num2;}num2>>=1;b>>=1;}
  const st=this.stepsize;num=st>>3;if(this.newSample&4)num+=st;if(this.newSample&2)num+=st>>1;if(this.newSample&1)num+=st>>2;if(this.newSample&8)num=-num;
  this.predictedSample+=num;if(this.predictedSample>32767)this.predictedSample=32767;if(this.predictedSample<-32768)this.predictedSample=-32768;
  this.index+=INDEX_TABLE[this.newSample];if(this.index<0)this.index=0;else if(this.index>88)this.index=88;this.step();return this.newSample&0xff;}
 // Encode: state reset per call (per frame); floor(n/2) bytes rounded up to even; low nibble = even sample.
 // An odd-length input drops its last sample; bytes past the input stay as USpeakPoolUtils.GetByte returned them
 // (zero for a fresh array; never the case for the 100-sample frames USpeaker produces).
 encode(data){this.init();let n=Math.trunc(data.length/2);if(n%2!==0)n++;const out=new Uint8Array(n);
  for(let i=0;i<out.length&&i*2<data.length;i++){const lo=this.encodeSample(data[i*2]);let hi=0;if(i*2+1<data.length)hi=this.encodeSample(data[i*2+1]);out[i]=((hi<<4)|lo)&0xff;}
  return out;}
 decode(data){this.init();const out=new Int16Array(data.length*2);
  for(let i=0;i<data.length;i++){const b=data[i];out[i*2]=this.decodeNibble(b&0xf);out[i*2+1]=this.decodeNibble(b>>4);}
  return out;}
 encodedLength(samples){let n=Math.trunc(samples/2);if(n%2!==0)n++;return n;}
}

// ---- MuLawCodec (G.711 µ-law, BIAS 132, clip 32635) ----
function muLawEncodeValue(pcm){const sign=(pcm&0x8000)>>8;if(sign!==0)pcm=-pcm;if(pcm>32635)pcm=32635;pcm+=132;
 let exponent=7,mask=16384;while((pcm&mask)===0){exponent--;mask>>=1;}const mantissa=(pcm>>(exponent+3))&0xf;return (~(sign|(exponent<<4)|mantissa))&0xff;}
function muLawDecodeValue(mulaw){mulaw=(~mulaw)&0xff;const sign=mulaw&0x80,exponent=(mulaw&0x70)>>4;let m=mulaw&0xf;m|=0x10;m<<=1;m++;m<<=exponent+2;m-=132;return toShort(sign!==0?-m:m);}
// Static tables as MuLawEncoder/MuLawDecoder build them. The decoder loop is `for (byte b = 0; b < byte.MaxValue; b++)`,
// so entry 255 keeps its default 0 (which equals its decoded value anyway).
const PCM_TO_MULAW=new Uint8Array(65536);for(let i=-32768;i<=32767;i++)PCM_TO_MULAW[i&0xffff]=muLawEncodeValue(i);
const MULAW_TO_PCM=new Int16Array(256);for(let b=0;b<255;b++)MULAW_TO_PCM[b]=muLawDecodeValue(b);
export class MuLawCodec{
 encode(data){const out=new Uint8Array(data.length);for(let i=0;i<data.length;i++)out[i]=PCM_TO_MULAW[data[i]&0xffff];return out;}
 decode(data){const out=new Int16Array(data.length);for(let i=0;i<data.length;i++)out[i]=MULAW_TO_PCM[data[i]];return out;}
 encodedLength(samples){return samples;}
}
// USpeakCodecManager.Instance: one codec instance per CodecNames entry (Activator.CreateInstance), shared by every speaker.
export function createCodecs(){return [new ADPCMCodec(),new MuLawCodec()];}

// ---- USpeakAudioClipConverter ----
// AudioDataToShorts: float gain, clamp to ±1, scale by 3267 (not 32767: the shipped constant), truncate to short.
// Single-precision steps (Math.fround) as IEEE float32; x87 extended-precision intermediates in the Mono JIT are not modelled.
export function audioDataToShorts(samples,gain=1){const out=new Int16Array(samples.length);
 for(let i=0;i<samples.length;i++){let num=f32(f32(samples[i])*f32(gain));if(Math.abs(num)>1)num=num>0?1:-1;out[i]=Math.trunc(f32(num*3267));}
 return out;}
export function shortsToAudioData(data,gain=1){const out=new Float32Array(data.length);for(let i=0;i<data.length;i++)out[i]=f32(f32(data[i]/3267)*f32(gain));return out;}

// ---- USpeakAudioClipCompressor ----
// CompressAudioData never assigns its out sample_count beyond 0, so every frame's Samples field is 0 on the wire.
export function compressAudioData(samples,codec,gain=1){return {bytes:codec.encode(audioDataToShorts(samples,gain)),sampleCount:0};}
export function decompressAudio(bytes,codec,gain=1){return shortsToAudioData(codec.decode(bytes),gain);}

// ---- USpeakFrameContainer: int32 LE encoded length, uint16 LE Samples, encoded bytes ----
export function frameToBytes({samples=0,encodedData}){const out=new Uint8Array(6+encodedData.length),v=new DataView(out.buffer);v.setInt32(0,encodedData.length,true);v.setUint16(4,samples,true);out.set(encodedData,6);return out;}
export function concatBytes(parts){let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
// USpeaker.ReceiveAudio's frame walk: BitConverter.ToInt32 at i, a (len + 6) byte copy, LoadFrom. A truncated or negative
// frame throws there in the original, after the earlier frames of the same packet were already queued: `error` marks
// that and `frames` holds what the original would have played.
export function parseFrames(data){const frames=[],v=new DataView(data.buffer,data.byteOffset,data.byteLength);let i=0;
 while(i<data.length){
  if(i+4>data.length)return {frames,error:'truncated-length'};
  const n=v.getInt32(i,true);if(n<0)return {frames,error:'negative-length'};
  if(i+n+6>data.length)return {frames,error:'truncated-frame'};
  frames.push({samples:v.getUint16(i+4,true),encodedData:data.subarray(i+6,i+6+n)});i+=n+6;}
 return {frames,error:null};}

// ---- USpeaker (local speaker): microphone blocks -> frames -> one clientspeak per send interval ----
// Feed microphone samples already at audioFrequency with push(); call update(dt, shouldSend) once per game frame.
// Mirrors USpeaker.Update for SpeakerMode.Local with SendingMode Constant and UseVAD off (the MalePlayer values):
//  * whole 100-sample blocks are read; ShouldSend is asked once per update and applies to every block read in it;
//  * OnAudioAvailable sets the static CurrentVolume (mean |sample| of the block) and queues it for encoding;
//  * blocks read while not sending are discarded; sendTimer accumulates every update and, once >= 1/SendRate, resets
//    to 0 and sends every buffered frame as one byte[] (concatenated USpeakFrameContainers).
// ProcessPendingEncodeBuffer's 10 ms per-frame encode budget is not modelled: browsers encode 100 samples in microseconds.
export class USpeakSender{
 constructor({settings=MALE_PLAYER_USPEAKER,codecs=createCodecs(),gain=1}={}){
  this.settings=settings;this.codecs=codecs;this.gain=gain;
  this.frequency=bandFrequency(settings.BandwidthMode);this.setupData=settingsToByte({bandMode:settings.BandwidthMode,codec:settings.Codec});
  this.sendInterval=1/settings.SendRate;this.sendTimer=0;this.pending=[];this.pendingLength=0;this.sendBuffer=[];this.currentVolume=0;this.talkTimer=0;this.lastSentPcm=[];
 }
 get codec(){return this.codecs[this.settings.Codec];}
 push(samples){if(samples.length){this.pending.push(Float32Array.from(samples));this.pendingLength+=samples.length;}}
 // Drops unread microphone audio (a new Microphone.Start restarts the clip at position 0).
 reset(){this.pending=[];this.pendingLength=0;}
 take(n){const out=new Float32Array(n);let o=0;while(o<n){const head=this.pending[0],k=Math.min(n-o,head.length);out.set(head.subarray(0,k),o);o+=k;if(k===head.length)this.pending.shift();else this.pending[0]=head.subarray(k);}this.pendingLength-=n;return out;}
 // Returns the byte[] payloads to send this update (normally zero or one).
 update(dt,shouldSend){this.talkTimer-=dt;let flag=null;
  while(this.pendingLength>=FRAME_SAMPLES){const block=this.take(FRAME_SAMPLES);if(flag===null)flag=Boolean(shouldSend());if(flag){this.talkTimer=1;this.onAudioAvailable(block);}}
  this.sendTimer+=dt;if(this.sendTimer<this.sendInterval)return [];
  this.sendTimer=0;if(!this.sendBuffer.length)return [];
  const frames=this.sendBuffer;this.sendBuffer=[];this.lastSentPcm=frames.map(x=>x.pcm);return [concatBytes(frames.map(frameToBytes))];}
 onAudioAvailable(pcm){let v=0;for(const x of pcm)v=f32(v+Math.abs(f32(x)));this.currentVolume=pcm.length?f32(v/pcm.length):0;
  for(let i=0;i<pcm.length;i+=SPLIT_SIZE){const chunk=pcm.subarray(i,i+SPLIT_SIZE),{bytes}=compressAudioData(chunk,this.codec,this.gain);this.sendBuffer.push({samples:0,encodedData:bytes,pcm:chunk});}}
}
// Splits one send into payloads of at most maxFrames frames. The desktop client sends one RPC per interval; the browser
// gateway caps a message at 4 KB of JSON, so a send larger than that (only after a stalled frame) goes as several RPCs.
export function splitPayload(bytes,maxFrames){const {frames}=parseFrames(bytes);const out=[];for(let i=0;i<frames.length;i+=maxFrames)out.push(concatBytes(frames.slice(i,i+maxFrames).map(frameToBytes)));return out;}

// ---- VoiceCom.voiceplay / USpeaker.ReceiveAudio (remote speaker) ----
// Returns null when the original ignores the call (no camera or hearDistance <= 0), else the speaker volume and the
// decoded frames. Settings are initialised from the first setupData only (`if (!HasSettings()) InitializeSettings`).
export function speakerVolume(cameraPosition,eyes,hearDistance){const d=Math.hypot(cameraPosition[0]-eyes[0],cameraPosition[1]-eyes[1],cameraPosition[2]-eyes[2]);return Math.min(1,Math.max(0,1-d/hearDistance));}
export class USpeakReceiver{
 constructor({settings=MALE_PLAYER_USPEAKER,codecs=createCodecs(),remoteGain=1}={}){this.frequency=bandFrequency(settings.BandwidthMode);this.codecs=codecs;this.remoteGain=remoteGain;this.settings=null;this.talkTimer=0;}
 initialize(setupData){this.settings=settingsFromByte(setupData);}
 // data -> {frames: Float32Array[] at this.frequency, error}. A codec index the CodecManager does not have, or the ADPCM
 // table overrun, throws in the original at that frame; earlier frames still play.
 receive(setupData,data){if(!this.settings)this.initialize(setupData);this.talkTimer=1;
  const {frames,error}=parseFrames(data),out=[];const codec=this.codecs[this.settings.codec];
  if(!codec)return {frames:out,error:'unknown-codec'};
  for(const f of frames){try{out.push(decompressAudio(f.encodedData,codec,this.remoteGain));}catch(e){return {frames:out,error:'decode: '+e.message};}}
  return {frames:out,error};}
}
// USpeaker playback clock: a stopped source starts playDelay = 2 x (first frame's duration) after the packet; frames play
// back to back; when playback catches up with what was received the source stops and the next packet starts again.
// The clip is a 10 s loop (audioFrequency * 10 samples): audio more than 10 s ahead would overwrite unplayed samples.
export class PlaybackClock{
 constructor({clipSeconds=10}={}){this.cursor=0;this.clipSeconds=clipSeconds;}
 schedule(now,durations){const starts=[];if(now>=this.cursor&&durations.length)this.cursor=now+durations[0]*2;
  for(const d of durations){if(this.cursor+d-now>this.clipSeconds){starts.push(null);continue;}starts.push(this.cursor);this.cursor+=d;}
  return starts;}
 playing(now){return now<this.cursor;}
}

// ---- VoiceChatIcon.Update: label opacity = Voice held ? clamp(CurrentVolume * 20, 0, 1) : 0 ----
export const iconOpacity=(voiceDown,currentVolume)=>voiceDown?Math.min(1,Math.max(0,currentVolume*20)):0;

// ---- Microphone resampling (Unity's Microphone.Start(device, false, 21, audioFrequency) resampled inside the engine;
// the browser captures at the device rate). Box-filter decimation: each output sample is the mean of the input span it
// covers (fractional edges weighted). An approximation of the OS/FMOD resampler, not a port.
export class BoxResampler{
 constructor(inRate,outRate){this.ratio=inRate/outRate;this.acc=0;this.weight=0;this.need=this.ratio;}
 push(input){const out=[];for(let i=0;i<input.length;i++){const x=input[i];let left=1;
   while(left>1e-12){const take=Math.min(left,this.need);this.acc+=x*take;this.weight+=take;this.need-=take;left-=take;
    if(this.need<=1e-9){out.push(this.acc/this.weight);this.acc=0;this.weight=0;this.need+=this.ratio;}}}
  return Float32Array.from(out);}
}

// Base64 for the gateway's JSON commands.
export function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s);}
