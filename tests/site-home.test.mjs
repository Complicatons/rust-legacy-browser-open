// Homepage helpers: server summaries, quick join, live-background gate and the menu music gesture rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeServers,formatPlayers,quickJoin} from '../site/js/server-data.mjs';
import {shouldLoadLive} from '../site/js/live-bg.mjs';
import {createSiteSound,MUTE_KEY} from '../site/js/sound.mjs';

const S=(name,online,players,capacity)=>({id:name,name,online,players,capacity,region:'eu'});

test('summarizeServers counts online servers and players, ignoring unknown counts',()=>{
 assert.deepEqual(summarizeServers([S('a',true,18,50),S('b',true,null,null),S('c',false,null,null)]),{servers:2,players:18});
 assert.deepEqual(summarizeServers([S('b',true,null,null)]),{servers:1,players:null});
 assert.deepEqual(summarizeServers([]),{servers:0,players:null});
 assert.deepEqual(summarizeServers([S('z',true,0,50)]),{servers:1,players:0});
});

test('formatPlayers never shows NaN or 0/0',()=>{
 assert.equal(formatPlayers(S('a',true,18,50)),'18/50');
 assert.equal(formatPlayers(S('a',true,4,null)),'4');
 assert.equal(formatPlayers(S('a',true,null,50)),'—');
 assert.equal(formatPlayers(S('a',false,null,null)),'—');
 assert.equal(formatPlayers(S('a',false,12,50)),'—','offline servers show no count');
});

test('quickJoin picks online servers by players then name',()=>{
 const list=[S('Beta',true,4,50),S('Alpha',true,4,50),S('Gone',false,null,null),S('Zed',true,18,50),S('Null',true,null,null)];
 assert.deepEqual(quickJoin(list).map(s=>s.name),['Zed','Alpha','Beta']);
 assert.deepEqual(quickJoin(list,5).map(s=>s.name),['Zed','Alpha','Beta','Null']);
});

test('shouldLoadLive only on capable desktops that did not opt out',()=>{
 const ok={width:1440,finePointer:true,webgl2:true,reducedMotion:false,saveData:false,effectiveType:'4g',optOut:false,gameOrigin:true};
 assert.equal(shouldLoadLive(ok),true);
 assert.equal(shouldLoadLive({...ok,effectiveType:undefined}),true);
 for(const [k,v] of [['width',1099],['finePointer',false],['webgl2',false],['reducedMotion',true],['saveData',true],['effectiveType','3g'],['optOut',true],['gameOrigin',false]])
  assert.equal(shouldLoadLive({...ok,[k]:v}),false,k);
});

class FakeAudio{
 static made=[];static started=0;
 constructor(){FakeAudio.made.push(this);this.destination={};this.currentTime=0;this.state='suspended';}
 resume(){this.state='running';return Promise.resolve();}
 createGain(){return {gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}
 createBufferSource(){return {buffer:null,loop:false,connect(){},start(){FakeAudio.started++;},stop(){}};}
 decodeAudioData(){return Promise.resolve({duration:10});}
 close(){return Promise.resolve();}
}
const store=(init={})=>{const m=new Map(Object.entries(init));return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),map:m};};
const manifest={music:{file:'music.ogg',startDelay:0,targetVolume:.2},loops:[{file:'wind.ogg',volume:.045},{file:'fire.ogg',volume:.582}]};
const tick=()=>new Promise(r=>setTimeout(r,20));

test('menu music stays silent until the first gesture when the browser holds sound back',async()=>{
 FakeAudio.made=[];FakeAudio.started=0;let fetches=0;
 const gestureTarget=new EventTarget(),fetchImpl=async()=>{fetches++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
 const sound=createSiteSound({manifest,base:'/a/',storage:store(),gestureTarget,AudioCtor:FakeAudio,fetchImpl});
 await tick();
 // One suspended context asks the browser whether sound is already allowed; nothing is fetched or played.
 assert.ok(FakeAudio.made.length<=1,'at most the probe');assert.equal(fetches,0);assert.equal(FakeAudio.started,0);assert.equal(sound.started,false);assert.equal(sound.waiting,true);
 gestureTarget.dispatchEvent(new Event('keydown'));await sound.ready;await tick();
 assert.equal(FakeAudio.started,3,'music and two loops');assert.equal(fetches,3);assert.equal(sound.started,true);
});

test('a mute saved by the game silences the site and fetches nothing',async()=>{
 FakeAudio.made=[];FakeAudio.started=0;let fetches=0;
 const gestureTarget=new EventTarget(),storage=store({[MUTE_KEY]:'1'}),fetchImpl=async()=>{fetches++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
 const sound=createSiteSound({manifest,base:'/a/',storage,gestureTarget,AudioCtor:FakeAudio,fetchImpl});
 assert.equal(MUTE_KEY,'rlb-music-mute');assert.equal(sound.muted,true);
 gestureTarget.dispatchEvent(new Event('pointerdown'));await sound.ready;await tick();
 assert.equal(fetches,0);assert.equal(FakeAudio.started,0);
 assert.equal(sound.toggle(),false,'toggle unmutes');assert.equal(storage.map.get(MUTE_KEY),'0');
 await sound.ready;await tick();assert.equal(FakeAudio.started,3,'unmuting after a gesture starts the music');
 assert.equal(sound.toggle(),true);assert.equal(storage.map.get(MUTE_KEY),'1');
});
