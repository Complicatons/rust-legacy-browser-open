// Voice (VoiceCom.clientspeak) checks for the gateway: only payloads a desktop Rust Legacy client could produce are
// relayed, within a dedicated bandwidth budget. Layouts from the decompiled client (USpeaker, USpeakFrameContainer,
// USpeakSettingsData, Resources/CodecManager); browser/uspeak.mjs holds the full codec port.
//
// What desktop clients send: VoiceCom.USpeakOnSerializeAudio -> networkView.RPC("clientspeak", RPCMode.Server,
// int setupData, byte[] data) on the player's own character view, the RPC name without a class prefix. data is a run of
// USpeakFrameContainers (int32 LE length, uint16 LE Samples = 0, encoded bytes) for 100-sample blocks. The server
// relays it unchanged as "VoiceCom:voiceplay"(voice.distance, setupData, data) to every other player within
// voice.distance; receivers decode with codec settings.Codec and throw on anything malformed.

// USpeakSettingsData.ToByte values: band bits Narrow 1 / Wide 2 / UltraWide 0, codec index << 2, CodecManager has two
// codecs (0 ADPCMCodec, 1 MuLawCodec). The MalePlayer prefab always sends 5 (Narrow, MuLaw).
export const VOICE_SETUPS=new Set([0,1,2,4,5,6]);
export const FRAME_SAMPLES=100;
// Encoded bytes of one 100-sample block: ADPCM floor(100/2) = 50 (even, so no round-up), µ-law one byte per sample.
export const FRAME_BYTES=[50,100];
// 24 µ-law frames = 2544 bytes, 3392 base64 characters: the JSON command stays under the gateway's 4096-byte message cap.
export const MAX_FRAMES_PER_MESSAGE=24;
// Budget: a Narrow speaker produces 80 frames/s (8000 Hz / 100) at 8 sends/s (MalePlayer SendRate). Allow 25% over real
// time with a 2 s burst, and at most 20 voice messages a second (splitting after a stall sends a few at once).
export const VOICE_LIMITS=Object.freeze({framesPerSecond:100,burstFrames:160,messagesPerSecond:20});

const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export function decodeBase64(text,maxBytes){
 if(typeof text!=='string'||text.length>Math.ceil(maxBytes/3)*4||!BASE64.test(text))return null;
 return new Uint8Array(Buffer.from(text,'base64'));
}

// Returns {ok:true, frames} or {ok:false, reason}.
export function validateVoice(setup,data){
 if(!Number.isInteger(setup)||!VOICE_SETUPS.has(setup))return {ok:false,reason:'bad-voice-setup'};
 if(!(data instanceof Uint8Array)||data.length===0)return {ok:false,reason:'bad-voice-data'};
 const size=FRAME_BYTES[setup>>2],view=new DataView(data.buffer,data.byteOffset,data.byteLength);let frames=0;
 for(let i=0;i<data.length;i+=6+size){
  if(i+6+size>data.length||view.getInt32(i,true)!==size||view.getUint16(i+4,true)!==0)return {ok:false,reason:'bad-voice-frame'};
  if(++frames>MAX_FRAMES_PER_MESSAGE)return {ok:false,reason:'voice-too-long'};
 }
 return {ok:true,frames};
}

// Token buckets in frames and messages, refilled continuously.
export class VoiceBudget{
 constructor({now,limits=VOICE_LIMITS}){Object.assign(this,{now,limits});this.frames=limits.burstFrames;this.messages=limits.messagesPerSecond;this.at=now();}
 take(frames){
  const t=this.now(),dt=Math.max(0,t-this.at),L=this.limits;this.at=t;
  this.frames=Math.min(L.burstFrames,this.frames+dt*L.framesPerSecond);this.messages=Math.min(L.messagesPerSecond,this.messages+dt*L.messagesPerSecond);
  if(this.messages<1||this.frames<frames)return false;
  this.messages-=1;this.frames-=frames;return true;
 }
}
