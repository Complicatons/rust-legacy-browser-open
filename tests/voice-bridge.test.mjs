// Voice through the whole stack (tests/helpers/stack.mjs: central + sidecar + gateway, only the Legacy server mocked):
// browser GatewayClient.voice -> gateway 'voice' command -> exact clientspeak RPC bytes at the server; server
// VoiceCom:voiceplay -> decoded browser event; strict payload checks and the dedicated voice budget (bridge/voice.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {startStack,poll} from './helpers/stack.mjs';
import {readArgs} from '../bridge/ulink/rust.mjs';
import {BitReader} from '../bridge/ulink/bits.mjs';
import {validateVoice,VoiceBudget,MAX_FRAMES_PER_MESSAGE} from '../bridge/voice.mjs';
import {frameToBytes,concatBytes,MuLawCodec,ADPCMCodec,audioDataToShorts,USpeakReceiver} from '../browser/uspeak.mjs';

const mulawFrame=(value=0.5)=>frameToBytes({samples:0,encodedData:new MuLawCodec().encode(audioDataToShorts(new Float32Array(100).fill(value)))});
const frames=(n,f=mulawFrame())=>concatBytes(Array(n).fill(f));

test('voice payload rules: desktop-client shapes only', ()=>{
 assert.deepEqual(validateVoice(5,frames(2)),{ok:true,frames:2});
 assert.equal(validateVoice(1,frameToBytes({encodedData:new ADPCMCodec().encode(new Int16Array(100))})).ok,true);
 assert.equal(validateVoice(8,frames(1)).reason,'bad-voice-setup'); // codec 2 does not exist in CodecManager
 assert.equal(validateVoice(3,frames(1)).reason,'bad-voice-setup'); // ToByte never sets both band bits
 assert.equal(validateVoice(1,frames(1)).reason,'bad-voice-frame'); // Âµ-law sized frame under the ADPCM setup
 assert.equal(validateVoice(5,frameToBytes({samples:100,encodedData:new Uint8Array(100)})).reason,'bad-voice-frame'); // Samples is always 0
 assert.equal(validateVoice(5,frames(2).subarray(0,150)).reason,'bad-voice-frame');
 assert.equal(validateVoice(5,frames(MAX_FRAMES_PER_MESSAGE+1)).reason,'voice-too-long');
 assert.equal(validateVoice(5,new Uint8Array(0)).reason,'bad-voice-data');
 let t=0;const b=new VoiceBudget({now:()=>t});
 assert.equal(b.take(160),true);assert.equal(b.take(1),false,'2 s burst used up');
 t=1;assert.equal(b.take(100),true);assert.equal(b.take(1),false,'refills at 100 frames/s');
 t=100;for(let i=0;i<20;i++)assert.equal(b.take(1),true);assert.equal(b.take(1),false,'20 messages/s');
});

test('clientspeak reaches the server byte-exact; voiceplay reaches the browser', async()=>{
 const s=await startStack();
 try{
  const player=await s.login('voice-player');
  const {ticket}=(await s.call('POST',`/servers/${s.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;
  const client=s.browser();const approved=await client.connect({ticket});
  const [peer]=s.native.peers.values();const speak=[],rejected=[];
  peer.onUlink=(h,b)=>{if(h.rpc?.includes('speak'))speak.push({h,payload:b.bytes.slice(),args:readArgs(['int','byte[]'],new BitReader(b.bytes,b.end,b.pos))});};
  client.addEventListener('command-rejected',e=>rejected.push(e.detail.reason));
  assert.equal(client.voice(5,frames(1)),false,'no character yet');
  peer.create({viewId:20,owner:approved.playerId,prefab:':player_soldier'});
  await poll(()=>client.characterView===20);

  const data=frames(2);assert.equal(client.voice(5,data),true);
  await poll(()=>speak.length===1);
  const {h,payload,args}=speak[0];
  assert.equal(h.rpc,'clientspeak','bare RPC name, as VoiceCom.USpeakOnSerializeAudio sends it');assert.equal(h.viewId,20);assert.equal(h.target,'server');assert.equal(h.timestampBits,16);
  assert.equal(args[0],5);assert.deepEqual([...args[1]],[...data]);
  // uLink RPC: flags 0x28 (RPC | 16-bit timestamp, untyped), view 20, "clientspeak", timestamp, int32 5, varuint 212, frames.
  const ts=Number(h.timestampLow);
  const expected=[0x28,20,0,11,...Buffer.from('clientspeak'),ts&255,ts>>8,5,0,0,0,0xD4,0x01,...data];
  assert.deepEqual([...payload],expected);

  // Strict checks: nothing malformed or oversized reaches the server; the generic rpc path cannot carry clientspeak.
  client.voice(8,frames(1));client.voice(5,frames(MAX_FRAMES_PER_MESSAGE+1));client.voice(5,frames(1).subarray(0,50));
  client.send({type:'voice',setup:5,data:'%%%'});client.rpc(20,'clientspeak',[5,'AAAA']);
  await poll(()=>rejected.length>=5);
  assert.deepEqual(rejected.slice(0,5),['bad-voice-setup','bad-voice-data','bad-voice-frame','bad-voice-data','use-dedicated-command']); // 25 frames already exceed the base64 size cap
  // A full 24-frame message fits the gateway's 4 KB JSON limit.
  assert.equal(client.voice(5,frames(MAX_FRAMES_PER_MESSAGE)),true);await poll(()=>speak.length===2);assert.equal(speak[1].args[1].length,24*106);
  // Budget: a flood is cut off with voice-rate-limited (the 2 s burst minus what was already sent).
  rejected.length=0;for(let i=0;i<10;i++)client.voice(5,frames(MAX_FRAMES_PER_MESSAGE));
  await poll(()=>speak.length+rejected.length>=12);
  assert.ok(rejected.includes('voice-rate-limited'));assert.ok(speak.length<12);

  // Server -> browser: another speaker's voiceplay(hearDistance, setupData, data) on its character view.
  const plays=[];client.addEventListener('rpc',e=>{if(e.detail.name==='voiceplay')plays.push(e.detail);});
  peer.create({viewId:30,owner:approved.playerId+1,prefab:':player_soldier',position:[3,0,0]});
  peer.rpc(30,'VoiceCom:voiceplay',['float','int','byte[]'],[100,5,data]);
  const play=await poll(()=>plays[0]);
  assert.equal(play.viewId,30);assert.equal(play.args.class,'VoiceCom');assert.equal(play.args.values[0],100);assert.equal(play.args.values[1],5);
  assert.ok(play.args.values[2] instanceof Uint8Array);assert.deepEqual([...play.args.values[2]],[...data]);
  const decoded=new USpeakReceiver().receive(play.args.values[1],play.args.values[2]);assert.equal(decoded.frames.length,2);assert.equal(decoded.frames[1][99],Math.fround(1628/3267));
 }finally{await s.close();}
});
