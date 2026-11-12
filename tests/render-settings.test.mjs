import test from 'node:test';
import assert from 'node:assert/strict';
import {RenderSettings,parseFov} from '../browser/render-settings.mjs';
test('native integer FOV range and invalid console input',()=>{
 assert.equal(parseFov('59'),60);assert.equal(parseFov('121'),120);assert.equal(parseFov('90'),90);
 for(const value of ['90x','90.5','','NaN','Infinity',null])assert.equal(parseFov(value),null);
 const settings=new RenderSettings();assert.equal(settings.fov,90,'port default (owner, 2026-10-29); the decompiled original default is 60');assert.equal(settings.command('render.fov').text,'render.fov: 90');
 assert.equal(settings.command('render.fov 95').ok,true);assert.equal(settings.fov,95);
 assert.equal(settings.command('render.fov 90 100').ok,false);assert.equal(settings.fov,95);
});
test('settings and console share persistence and change notifications',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},settings=new RenderSettings(storage);let changes=0;settings.addEventListener('change',()=>changes++);
 settings.setFov(105);settings.setReleaseKey('F3');assert.equal(changes,2);
 const restored=new RenderSettings(storage);assert.equal(restored.fov,105);assert.equal(restored.releaseKey,'F3');restored.command('render.fov 75');assert.equal(new RenderSettings(storage).fov,75);
 assert.equal(settings.setReleaseKey('Escape'),false);assert.equal(settings.releaseKey,'F3');
 assert.doesNotThrow(()=>new RenderSettings({getItem(){throw Error('blocked');}}));assert.doesNotThrow(()=>new RenderSettings({setItem(){throw Error('blocked');}}).setFov(90));
});
test('play-in-fullscreen choice: default from the caller, persisted, unreadable storage tolerated',()=>{
 assert.equal(new RenderSettings().fullscreen,true);assert.equal(new RenderSettings(null,{fullscreen:false}).fullscreen,false);
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},settings=new RenderSettings(storage);let changes=0;settings.addEventListener('change',()=>changes++);
 settings.setFullscreen(false);settings.setFullscreen(false);assert.equal(changes,1,'unchanged choice does not notify');
 assert.equal(new RenderSettings(storage).fullscreen,false);assert.equal(new RenderSettings(storage,{fullscreen:true}).fullscreen,false,'saved choice wins over the default');
 settings.setFullscreen(true);assert.equal(new RenderSettings(storage,{fullscreen:false}).fullscreen,true);
 values.set('rlb-render-settings',JSON.stringify({fov:90}));assert.equal(new RenderSettings(storage).fullscreen,true,'older saves keep the default');
});
