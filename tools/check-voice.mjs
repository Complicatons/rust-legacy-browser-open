// Voice chat on the real game page against the mock stack (central + sidecar + gateway from tests/helpers/stack.mjs;
// only the Legacy server is mocked). Chromium's fake microphone (--use-fake-device-for-media-stream, permission prompt
// auto-accepted by --use-fake-ui-for-media-stream; flags added only here) stands in for a real one.
// Asserts: no microphone use before the Voice key; holding V sends VoiceCom clientspeak(5, µ-law frames) whose RPC bytes
// are exactly what the original encoder produces from the captured PCM; release closes the microphone; a remote
// VoiceCom:voiceplay is decoded and scheduled on a linear-rolloff 3D source at the speaker; the HUD pnlVoiceIcon layout.
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from './serve.mjs';
import {startStack,poll} from '../tests/helpers/stack.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
import {readArgs,encodeRpc,writeArgs} from '../bridge/ulink/rust.mjs';
import {BitReader} from '../bridge/ulink/bits.mjs';
import {MuLawCodec,audioDataToShorts,frameToBytes,concatBytes,parseFrames,USpeakReceiver} from '../browser/uspeak.mjs';
const out='analysis/browser-qa/voice/';await mkdir(out,{recursive:true});
const web=createServer();await listenServer(web);const origin=`http://127.0.0.1:${web.address().port}`;
const stack=await startStack({gatewayOrigins:[origin]});
// The fake microphone plays a generated 440 Hz tone (0.3 amplitude, 48 kHz 16-bit mono WAV, looped by Chromium).
const tonePath=path.resolve(out,'tone.wav');{const rate=48000,n=rate*2,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)b.writeInt16LE(Math.round(0.3*32767*Math.sin(2*Math.PI*440*i/rate)),44+i*2);await writeFile(tonePath,b);}
const options=launchOptions();
const browser=await chromium.launch({...options,args:[...options.args,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+tonePath]});
const report={};
try{
 const player=await stack.login('voice-player');
 const {ticket}=(await stack.call('POST',`/servers/${stack.serverId}/join-ticket`,{cookie:player.cookie,csrf:player.csrf})).data;
 const join={ticket,endpoint:`ws://127.0.0.1:${stack.gateway.port}/play`,server:stack.serverId,name:'Pilot'};
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});process.on('exit',()=>{if(errors.length)console.error('page errors:',errors);});
 await page.addInitScript(j=>{if(!sessionStorage.getItem('rlb-join-used')){sessionStorage.setItem('rlb-join-used','1');sessionStorage.setItem('rlb-join',JSON.stringify({...j,at:Date.now()}));}
  // Count microphone requests (the page must not ask before the Voice key).
  window.__micRequests=0;const md=navigator.mediaDevices,get=md.getUserMedia.bind(md);md.getUserMedia=c=>{window.__micRequests++;return get(c);};},join);
 await page.goto(origin+'/?dev',{waitUntil:'load',timeout:300000});
 const peer=await poll(()=>[...stack.native.peers.values()].find(p=>p.playerId),120000);
 const speak=[],seen=[];peer.onUlink=(h,b)=>{seen.push(h.rpc);if(h.rpc&&/speak/.test(h.rpc))speak.push({h,payload:b.bytes.slice(),args:readArgs(['int','byte[]'],new BitReader(b.bytes,b.end,b.pos)),at:Date.now()});};
 peer.create({viewId:1,prefab:'ServerManagement'});
 await poll(()=>seen.includes('ClientFirstReady'),120000);
 const spawnU=[5244.1,368,-4839.6];
 peer.create({viewId:20,owner:peer.playerId,prefab:':player_soldier',position:spawnU});
 peer.create({viewId:30,owner:peer.playerId+50,prefab:':player_soldier',position:[spawnU[0]+6,spawnU[1],spawnU[2]+8]});
 await page.waitForFunction(()=>window.explorerState?.online?.state==='in-game'&&window.explorerState.walk&&window.explorerDev.voice?.(),{},{timeout:600000,polling:1000});
 report.graphics=await readGraphics(page);
 // Capture the mouse (a user gesture: audio unlocks). Still no microphone.
 await page.locator('#world').click({position:{x:640,y:360}});await page.waitForFunction(()=>Boolean(document.pointerLockElement));
 await page.waitForTimeout(500);
 let v=await page.evaluate(()=>window.explorerDev.voice());
 assert.equal(v.permission,'not-requested');assert.equal(v.captureStarts,0);assert.equal(await page.evaluate(()=>window.__micRequests),0,'no getUserMedia before the Voice key');
 assert.equal(speak.length,0);assert.equal(v.iconOpacity,0);
 // HUD pnlVoiceIcon: panel 160x168 anchored top-right (margins top 64, right 64), label inset 8 px, 144x152.
 assert.deepEqual(v.iconRect,{left:1280-64-160+8,top:64+8,width:144,height:152});

 // ---- push to talk ----
 await page.keyboard.down('v');
 await page.waitForFunction(()=>window.explorerDev.voice().capturing,{},{timeout:20000});
 await poll(()=>speak.length>=4,20000);
 // VoiceChatIcon: opacity clamp(CurrentVolume * 20) while Voice is held; the tone's mean |x| is about 0.19.
 await page.waitForFunction(()=>window.explorerDev.voice().iconOpacity===1,{},{timeout:5000});
 const mid=await page.evaluate(()=>window.explorerDev.voice());
 assert.ok(mid.currentVolume>0.15&&mid.currentVolume<0.23,'CurrentVolume of the tone: '+mid.currentVolume);
 await page.screenshot({path:out+'talking.png'});
 await page.keyboard.up('v');
 await page.waitForFunction(()=>!window.explorerDev.voice().capturing,{},{timeout:5000});
 const stoppedAt=Date.now(),countAtStop=speak.length;await page.waitForTimeout(800);
 v=await page.evaluate(()=>window.explorerDev.voice());
 assert.equal(v.permission,'granted');assert.equal(v.captureStarts,1);assert.equal(v.captureStops,1);assert.equal(await page.evaluate(()=>window.__micRequests),1);
 assert.equal(speak.length,countAtStop,'nothing is sent after the microphone closed');assert.ok(speak.every(s=>s.at<=stoppedAt+50));
 assert.equal(v.iconOpacity,0,'icon hidden once Voice is released');
 // Exact bytes: every clientspeak is the bare-name RPC on our view with setup 5; frames are 106-byte µ-law containers;
 // the whole uLink payload equals the encoder's output for that view/name/timestamp/arguments; and the encoded bytes
 // equal MuLawCodec(AudioDataToShorts(pcm)) recomputed here from the PCM the page captured.
 const log=await page.evaluate(()=>window.explorerDev.voiceSentLog());const codec=new MuLawCodec();let checked=0,loud=0;
 for(const s of speak){
  assert.equal(s.h.rpc,'clientspeak');assert.equal(s.h.viewId,20);assert.equal(s.args[0],5);
  const {frames,error}=parseFrames(s.args[1]);assert.equal(error,null);assert.ok(frames.length>=1&&frames.length<=24);
  for(const f of frames){assert.equal(f.samples,0);assert.equal(f.encodedData.length,100);if(f.encodedData.some(b=>b!==0xFF&&b!==0x7F))loud++;}
  const expected=encodeRpc({viewId:20,name:'clientspeak',timestampMs:s.h.timestampLow},w=>writeArgs(['int','byte[]'],[5,s.args[1]],w));
  assert.deepEqual([...s.payload],[...expected]);
  const entry=log.find(e=>e.bytes.length===s.args[1].length&&e.bytes.every((b,i)=>b===s.args[1][i]));
  if(entry){assert.equal(entry.pcm.length,frames.length);
   assert.deepEqual([...concatBytes(entry.pcm.map(p=>frameToBytes({encodedData:codec.encode(audioDataToShorts(Float32Array.from(p)))})))],[...s.args[1]]);checked++;}
 }
 assert.ok(checked>=2,'sent payloads recomputed from captured PCM: '+checked);
 assert.ok(loud>=speak.length,'the fake microphone tone reaches the frames: '+loud);
 const intervals=speak.slice(1).map((s,i)=>s.at-speak[i].at);
 report.talk={messages:speak.length,frames:speak.reduce((n,s)=>n+parseFrames(s.args[1]).frames.length,0),checked,loudFrames:loud,medianIntervalMs:intervals.sort((a,b)=>a-b)[intervals.length>>1],midIcon:mid.iconOpacity,currentVolume:mid.currentVolume};
 assert.ok(report.talk.medianIntervalMs>=90&&report.talk.medianIntervalMs<=250,'about 1/8 s between sends: '+report.talk.medianIntervalMs);

 // ---- hearing another player ----
 const tone=Array.from({length:10},(_,k)=>new Float32Array(100).map((_,i)=>0.4*Math.sin(2*Math.PI*440*(k*100+i)/8000)));
 const data=concatBytes(tone.map(p=>frameToBytes({encodedData:codec.encode(audioDataToShorts(p))})));
 const expectedPcm=new USpeakReceiver().receive(5,data).frames;
 peer.rpc(30,'VoiceCom:voiceplay',['float','int','byte[]'],[100,5,data]);
 await page.waitForFunction(()=>window.explorerDev.voice().speakers[0]?.frames===10,{},{timeout:10000});
 const heard=(await page.evaluate(()=>window.explorerDev.voice())).speakers[0];
 const remote=(await page.evaluate(()=>window.explorerDev.onlinePlayers())).find(p=>p.id===30);
 assert.equal(heard.viewId,30);assert.equal(heard.packets,1);assert.equal(heard.error,null);assert.equal(heard.hearDistance,100);
 assert.equal(heard.panner.model,'linear');assert.equal(heard.panner.ref,1);assert.equal(heard.panner.max,100);
 for(let i=0;i<3;i++)assert.ok(Math.abs(heard.position[i]-remote.position[i])<1e-3,'source at the speaker: '+heard.position+' vs '+remote.position);
 assert.ok(heard.volume>0.8&&heard.volume<1,'volume 1 - distance/100: '+heard.volume);
 const s=heard.scheduled;assert.equal(s.length,10);
 for(let i=1;i<s.length;i++)assert.ok(Math.abs(s[i].at-s[i-1].at-100/8000)<1e-6,'frames back to back at 8 kHz');
 assert.ok(s.every((x,i)=>x.samples===100&&Math.abs(x.peak-expectedPcm[i].reduce((m,y)=>Math.max(m,Math.abs(y)),0))<1e-6),'decoded µ-law PCM scheduled');
 // The panner follows the speaker after the next render.
 await page.waitForTimeout(200);const after=(await page.evaluate(()=>window.explorerDev.voice())).speakers[0];
 for(const [i,k] of ['x','y','z'].entries())assert.ok(Math.abs(after.panner[k]-remote.position[i])<1e-2,'panner '+k);
 assert.ok(Math.abs(after.gain-heard.volume)<1e-3,'source gain = speaker volume: '+after.gain);
 report.hear={volume:heard.volume,firstStartDelay:s[0].at-heard.now,position:heard.position};
 // A malformed packet: frames before the bad one still play (ReceiveAudio throws at the bad frame).
 peer.rpc(30,'VoiceCom:voiceplay',['float','int','byte[]'],[100,5,Uint8Array.from([...data.subarray(0,106),7,0])]);
 await page.waitForFunction(()=>window.explorerDev.voice().speakers[0]?.frames===11,{},{timeout:10000});
 assert.equal((await page.evaluate(()=>window.explorerDev.voice())).speakers[0].error,'truncated-length');
 assert.deepEqual(errors,[],'no page errors');
 report.errors=errors;
 console.log(JSON.stringify(report,null,1));
}finally{await writeFile(out+'voice.json',JSON.stringify(report,null,1));await browser.close();await stack.close();web.close();}
