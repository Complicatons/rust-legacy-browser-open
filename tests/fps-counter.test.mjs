import test from 'node:test';
import assert from 'node:assert/strict';
import {framesPerSecond,createFpsMeter,FPS_REFRESH_MS} from '../browser/fps-counter.mjs';
import {RenderSettings} from '../browser/render-settings.mjs';

test('fps from real frame intervals, refreshed about twice a second',()=>{
 assert.equal(FPS_REFRESH_MS,500);assert.equal(framesPerSecond(30,500),60);assert.equal(framesPerSecond(0,500),0);assert.equal(framesPerSecond(5,0),0);
 const m=createFpsMeter();assert.equal(m.frame(0),null);let reading=null,t=0;
 for(let i=0;i<200&&reading===null;i++){t+=1000/144;reading=m.frame(t);}
 assert.equal(reading,144);
 // Uneven frames: 10 frames over 520 ms -> 19 fps.
 let r=null;for(let i=1;i<=10;i++)r=m.frame(t+52*i);assert.equal(r,19);
 m.reset();assert.equal(m.frame(5000),null);
});

test('FPS counter option is off by default and persists',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const s=new RenderSettings(storage);assert.equal(s.showFps,false);s.setShowFps(true);assert.equal(new RenderSettings(storage).showFps,true);
 s.setShowFps(false);assert.equal(new RenderSettings(storage).showFps,false);assert.equal(new RenderSettings(null).showFps,false);
});
