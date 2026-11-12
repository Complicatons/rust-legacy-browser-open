// Homepage menu music (site/js/sound.mjs): when it starts, and what the bar's sound button does before and after.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSiteSound} from '../site/js/sound.mjs';

const manifest={music:{file:'m.ogg',targetVolume:.2},loops:[{file:'w.ogg',volume:.1}]};
function fakes({running=false}={}){
 const listeners={},target={addEventListener:(t,f)=>(listeners[t]??=new Set()).add(f),removeEventListener:(t,f)=>listeners[t]?.delete(f)};
 const fire=t=>[...(listeners[t]??[])].forEach(f=>f({type:t}));
 const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 class Ctx{
  constructor(){this.state=running?'running':'suspended';this.currentTime=0;this.destination={};}
  createGain(){return {gain:{value:0},connect(){}};}
  createBufferSource(){return {connect(){},start(){},stop(){}};}
  decodeAudioData(){return Promise.resolve({});}
  resume(){this.state='running';return Promise.resolve();}
 }
 const fetchImpl=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
 return {fire,storage,target,opts:{manifest,storage,gestureTarget:target,AudioCtor:Ctx,fetchImpl}};
}

test('music starts on the first click anywhere on the page', async () => {
 const f=fakes(),s=createSiteSound(f.opts);
 assert.equal(s.started,false);
 f.fire('pointerdown');await s.ready;
 assert.equal(s.started,true);assert.equal(s.muted,false);
});

test('the sound button pressed first starts the music instead of muting it', async () => {
 const f=fakes(),s=createSiteSound(f.opts);
 f.fire('pointerdown');      // the button press is also the page's first gesture
 const muted=s.toggle();await s.ready;
 assert.equal(muted,false);assert.equal(s.muted,false);assert.equal(s.started,true);
 assert.equal(f.storage.getItem('rlb-music-mute'),null,'nothing saved: the reader did not ask for silence');
});

test('once playing, the button mutes, and pressed again plays', async () => {
 const f=fakes(),s=createSiteSound(f.opts);
 f.fire('pointerdown');await s.ready;
 assert.equal(s.toggle(),true);assert.equal(s.started,false);
 assert.equal(s.toggle(),false);await s.ready;assert.equal(s.started,true);
});

test('a browser that already allows sound plays it without waiting for a click', async () => {
 const f=fakes({running:true}),s=createSiteSound(f.opts);await s.ready;
 assert.equal(s.started,true);
});

test('muted readers stay muted, and waiting reports music that is on but not yet allowed', async () => {
 const f=fakes();
 const s=createSiteSound(f.opts);assert.equal(s.waiting,true);
 f.fire('keydown');await s.ready;assert.equal(s.waiting,false);
 f.storage.setItem('rlb-music-mute','1');
 const m=createSiteSound(f.opts);f.fire('pointerdown');await m.ready;
 assert.equal(m.started,false);assert.equal(m.waiting,false);
});
