// USpeak codec/frame port (browser/uspeak.mjs). Expected bytes are hand-derived by stepping through the decompiled
// client code (MoPhoGames.USpeak.Codec.ADPCMCodec/MuLawCodec, USpeakAudioClipConverter, USpeakFrameContainer,
// USpeakSettingsData, USpeaker); the derivations are in the comments next to each vector.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {ADPCMCodec,MuLawCodec,ADPCM_STEPS,audioDataToShorts,shortsToAudioData,settingsToByte,settingsFromByte,MALE_PLAYER_SETUP,MALE_PLAYER_USPEAKER,CODEC_NAMES,BAND,
 frameToBytes,parseFrames,USpeakSender,USpeakReceiver,PlaybackClock,speakerVolume,iconOpacity,BoxResampler,splitPayload,bandFrequency,FRAME_SAMPLES} from '../browser/uspeak.mjs';

test('settings byte: USpeakSettingsData.ToByte / (byte) constructor', ()=>{
 // MalePlayer: BandwidthMode Narrow (bit 1) | Codec 1 (MuLawCodec) << 2 = 5.
 assert.equal(MALE_PLAYER_SETUP,5);
 assert.equal(settingsToByte({bandMode:BAND.Wide,codec:0}),2);assert.equal(settingsToByte({bandMode:BAND.UltraWide,codec:1}),4);
 assert.deepEqual(settingsFromByte(5),{bandMode:BAND.Narrow,codec:1});
 assert.deepEqual(settingsFromByte(6),{bandMode:BAND.Wide,codec:1});
 assert.deepEqual(settingsFromByte(4),{bandMode:BAND.UltraWide,codec:1});
 assert.deepEqual(settingsFromByte(3),{bandMode:BAND.Narrow,codec:0}); // bit 1 checked first
 assert.deepEqual(settingsFromByte(0x105),{bandMode:BAND.Narrow,codec:1}); // VoiceCom passes (byte)data
 assert.equal(bandFrequency(BAND.Narrow),8000);assert.equal(bandFrequency(BAND.Wide),16000);assert.equal(bandFrequency(BAND.UltraWide),32000);
});

test('AudioDataToShorts: x gain, clamp ±1, x 3267, truncate toward zero; ShortsToAudioData divides by 3267', ()=>{
 // 0.5*3267 = 1633.5 -> 1633; 0.1f*3267 = 326.70001 -> 326; 1.5 clamps to 1 -> 3267; -2 -> -3267.
 assert.deepEqual([...audioDataToShorts([0.5,-0.5,0.1,1.5,-2,0])],[1633,-1633,326,3267,-3267,0]);
 assert.deepEqual([...audioDataToShorts([0.5],2)],[3267]); // 0.5*2 = 1, not clamped (|1| > 1 is false)
 assert.equal(shortsToAudioData(Int16Array.of(3267))[0],1);
 assert.equal(shortsToAudioData(Int16Array.of(1628))[0],Math.fround(1628/3267));
});

test('µ-law: encoder/decoder tables match G.711 with BIAS 132', ()=>{
 const c=new MuLawCodec();
 // encode(0): 0+132 = 132, exponent 0 (bit 128), mantissa (132>>3)&15 = 0 -> ~0x00 = 0xFF.
 // encode(-1): sign 0x80, 1+132 = 133, exponent 0, mantissa 0 -> ~0x80 = 0x7F.
 // encode(3267): 3399 = 0b1101_0100_0111, top bit 2048 -> exponent 4, mantissa (3399>>7)&15 = 10 -> ~0x4A = 0xB5.
 // encode(-3267): ~(0x80|0x4A) = 0x35. encode(32767): clipped to 32635, +132 = 32767 -> exponent 7, mantissa 15 -> ~0x7F = 0x80.
 // encode(-32768): -(-32768) = 32768 > 32635 -> clipped -> ~0xFF = 0x00. encode(1633): 1765, exponent 3, mantissa 11 -> ~0x3B = 0xC4.
 assert.deepEqual([...c.encode(Int16Array.of(0,-1,3267,-3267,32767,-32768,1633))],[0xFF,0x7F,0xB5,0x35,0x80,0x00,0xC4]);
 // decode(0xB5): ~ = 0x4A, mantissa (10|16)<<1|1 = 53, << (4+2) = 3392, -132 = 3260. 0x35 -> -3260.
 // decode(0x80): ~ = 0x7F -> 63 << 9 = 32256 - 132 = 32124. decode(0x00) -> -32124. decode(0xC4): 55 << 5 = 1760 - 132 = 1628.
 // decode(0xFF) = 0 (table entry 255 is never filled by the `b < byte.MaxValue` loop; its value is 0 anyway).
 assert.deepEqual([...c.decode(Uint8Array.of(0xB5,0x35,0x80,0x00,0xC4,0xFF,0x7F))],[3260,-3260,32124,-32124,1628,0,0]);
});

test('ADPCM encode: per-call reset, low nibble first, shipped step table', ()=>{
 // Samples [0, 100, -50, 3267]; state pred 0, step 7, index 0.
 //  0: diff 0 -> code 0; delta 7>>3 = 0; index -1 -> 0.
 //  100: diff 100 >= 7 -> |4 (93), >= 3 -> |2 (90), >= 1 -> |1: code 7; delta 0+7+3+1 = 11 -> pred 11; index 8, step 17.
 //  byte 0 = (7 << 4) | 0 = 0x70.
 //  -50: diff -61 -> sign 8; 61 >= 17 |4 (44), >= 8 |2 (36), >= 4 |1: code 15; delta -(2+17+8+4) = -31 -> pred -20; index 16, step 37.
 //  3267: diff 3287 -> code 7; delta 4+37+18+9 = 68 -> pred 48; index 24.  byte 1 = (7 << 4) | 15 = 0x7F.
 const c=new ADPCMCodec();
 assert.deepEqual([...c.encode(Int16Array.of(0,100,-50,3267))],[0x70,0x7F]);
 assert.deepEqual([...c.encode(Int16Array.of(0,100,-50,3267))],[0x70,0x7F],'Init() resets the state per call');
 // Length: floor(n/2), rounded up to even. 5 samples -> 2 bytes (the 5th sample is dropped); 6 -> 4 bytes (last zero).
 assert.equal(c.encode(new Int16Array(5)).length,2);assert.equal(c.encode(new Int16Array(6)).length,4);assert.equal(c.encode(new Int16Array(100)).length,50);
 assert.equal(ADPCM_STEPS.length,88);assert.equal(ADPCM_STEPS[82],203500);
});

test('ADPCM decode: the shipped decoder returns the scaled difference (no predictor), and overruns its table', ()=>{
 const c=new ADPCMCodec();
 // 0x70: nibble 0 -> 7*0/4 + 7/8 + 7>>3 = 0, index 0.  nibble 7 -> 7*7/4 (12) + 0 + 7 + 3 + 1 + 0 = 23, index 8, step 17.
 // 0x7F: nibble 15 -> 17*15/4 (63) + 2 + 17 + 8 + 4 + 2 = 96, sign -> -96, index 16, step 37.
 //       nibble 7 -> 37*7/4 (64) + 4 + 37 + 18 + 9 + 4 = 136.
 assert.deepEqual([...c.decode(Uint8Array.of(0x70,0x7F))],[0,23,-96,136]);
 // Ten nibbles of 7 -> index 80; nibble 4 (+2) -> 82, step 203500; nibble 0 -> 203500/8 + 203500>>3 = 50874 -> 32767.
 const d=c.decode(Uint8Array.of(0x77,0x77,0x77,0x77,0x77,0x04));assert.equal(d[11],32767);assert.equal(c.index,81);
 // Eleven nibbles of 7 reach index 88 = stepsizeTable.Length: IndexOutOfRangeException in the original.
 assert.throws(()=>c.decode(Uint8Array.of(0x77,0x77,0x77,0x77,0x77,0x77)),/IndexOutOfRange/);
});

test('frame container and RPC payload: int32 length, uint16 Samples (always 0), encoded bytes', ()=>{
 const enc=new MuLawCodec().encode(audioDataToShorts(new Float32Array(100).fill(0.5)));
 const frame=frameToBytes({samples:0,encodedData:enc});
 assert.deepEqual([...frame.subarray(0,6)],[100,0,0,0,0,0]);assert.equal(frame.length,106);assert.ok(frame.subarray(6).every(b=>b===0xC4));
 const two=Uint8Array.from([...frame,...frame]);assert.equal(parseFrames(two).frames.length,2);assert.equal(parseFrames(two).error,null);
 // ReceiveAudio: frames before a malformed one are still played.
 assert.deepEqual(parseFrames(Uint8Array.from([...frame,1,0])).error,'truncated-length');assert.equal(parseFrames(Uint8Array.from([...frame,1,0])).frames.length,1);
 assert.equal(parseFrames(Uint8Array.of(255,255,255,255,0,0)).error,'negative-length');
 assert.equal(parseFrames(Uint8Array.of(9,0,0,0,0,0,1)).error,'truncated-frame');
 assert.equal(splitPayload(Uint8Array.from(Array.from({length:30},()=>[...frame]).flat()),24).map(p=>p.length).join(),[24*106,6*106].join());
});

test('USpeaker local: 100-sample blocks, ShouldSend once per update, one byte[] per 1/SendRate', ()=>{
 assert.equal(MALE_PLAYER_USPEAKER.SendRate,8);assert.equal(CODEC_NAMES[MALE_PLAYER_USPEAKER.Codec],'MoPhoGames.USpeak.Codec.MuLawCodec');
 const s=new USpeakSender();assert.equal(s.frequency,8000);assert.equal(s.setupData,5);
 s.push(new Float32Array(1050).fill(0.5));let asked=0;
 assert.deepEqual(s.update(0.05,()=>{asked++;return true;}),[]);assert.equal(asked,1);assert.equal(s.sendBuffer.length,10);assert.equal(s.pendingLength,50);
 assert.equal(s.currentVolume,0.5);
 const [payload]=s.update(0.08,()=>true);assert.equal(payload.length,10*106);assert.equal(s.sendTimer,0);
 assert.deepEqual([...payload.subarray(0,8)],[100,0,0,0,0,0,0xC4,0xC4]);
 // Not talking: blocks are read and discarded, nothing is sent; CurrentVolume keeps its last value (static field).
 s.push(new Float32Array(400));assert.deepEqual(s.update(0.2,()=>false),[]);assert.equal(s.pendingLength,50);assert.equal(s.currentVolume,0.5);
 // VoiceChatIcon: opacity only while Voice is held.
 assert.equal(iconOpacity(true,0.02),0.4);assert.equal(iconOpacity(true,0.5),1);assert.equal(iconOpacity(false,0.5),0);
});

test('USpeaker remote: first setup wins, frames decoded with RemoteGain 1, playback clock', ()=>{
 const r=new USpeakReceiver(),frame=frameToBytes({encodedData:Uint8Array.from({length:100},()=>0xC4)});
 const a=r.receive(5,frame);assert.equal(a.error,null);assert.equal(a.frames[0].length,FRAME_SAMPLES);assert.equal(a.frames[0][0],Math.fround(1628/3267));
 assert.equal(r.receive(1,frame).frames[0][0],Math.fround(1628/3267),'later setupData is ignored once settings exist');
 const adpcm=new USpeakReceiver();assert.equal(adpcm.receive(1,frameToBytes({encodedData:Uint8Array.of(0x70,0x7F)})).frames[0][1],Math.fround(23/3267));
 assert.equal(new USpeakReceiver().receive(8,frame).error,'unknown-codec');
 // Clock: stopped -> start 2 frame lengths later; back to back while playing; restart after running dry.
 const c=new PlaybackClock(),d=Array(10).fill(0.0125);
 const first=c.schedule(1,d);assert.ok(Math.abs(first[0]-1.025)<1e-9);assert.ok(Math.abs(first[9]-(1.025+9*0.0125))<1e-9);
 assert.ok(Math.abs(c.schedule(1.1,[0.0125])[0]-1.15)<1e-9);
 assert.ok(Math.abs(c.schedule(3,[0.0125])[0]-3.025)<1e-9);
 assert.deepEqual(new PlaybackClock({clipSeconds:0.5}).schedule(0,Array(4).fill(0.125)),[0.25,0.375,null,null]); // 10 s clip, scaled down
 // VoiceCom.voiceplay volume: clamp01(1 - distance / hearDistance).
 assert.equal(speakerVolume([0,0,0],[0,0,25],100),0.75);assert.equal(speakerVolume([0,0,0],[0,0,150],100),0);
});

test('microphone resampling to the USpeak rate', ()=>{
 const r=new BoxResampler(48000,8000);const out=r.push(new Float32Array(480).fill(0.25));assert.equal(out.length,80);assert.ok(out.every(x=>Math.abs(x-0.25)<1e-6));
 const r2=new BoxResampler(44100,8000);let n=0;for(let i=0;i<100;i++)n+=r2.push(new Float32Array(441)).length;assert.ok(Math.abs(n-8000)<=1);
});

test('exported serialized values match the port constants (when the export exists)', ()=>{
 const file=new URL('../browser/assets/recovered/voice/manifest.json',import.meta.url);if(!existsSync(file))return;
 const m=JSON.parse(readFileSync(file,'utf8'));
 for(const k of ['BandwidthMode','SendRate','SendingMode','UseVAD','_3DMode','Codec'])assert.equal(m.uspeaker[k],MALE_PLAYER_USPEAKER[k],k);
 assert.deepEqual(m.codecNames,CODEC_NAMES);
});
