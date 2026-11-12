import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {crosshairAlpha,shadowedDraws,centredRect} from '../browser/crosshair.mjs';
import {present} from './helpers/assets.mjs';

const tex={width:32,height:32},dot={width:4,height:4};
const vm=(zoom,notZoomed,extra={})=>({showCrosshairZoom:zoom,showCrosshairNotZoomed:notZoomed,crosshairTexture:tex,dotTexture:dot,crosshairColor:{r:1,g:1,b:1,a:1},crosshairOutline:{r:0,g:0,b:0,a:1},...extra});

test('crosshair: ViewModel.OnGUI alpha rules', ()=>{
 assert.equal(crosshairAlpha(vm(false,false),0),null,'drawCrosshair false');
 assert.equal(crosshairAlpha(vm(true,true),0.7),1);
 assert.equal(crosshairAlpha(vm(false,true),0.25),0.75);assert.equal(crosshairAlpha(vm(false,true),1),null,'alpha 0 returns early');
 assert.equal(crosshairAlpha(vm(true,false),0.4),0.4);assert.equal(crosshairAlpha(vm(true,false),0),null);
 assert.equal(crosshairAlpha(vm(true,true),0,{rposOpen:true}),null,'RPOS.IsOpen');
 assert.equal(crosshairAlpha(vm(true,true),0,{cameraEnabled:false}),null);
 assert.equal(crosshairAlpha(vm(false,true,{crosshairTexture:null,dotTexture:null}),0),null,'no textures (VM-Bandage)');
 assert.equal(crosshairAlpha(null,0),null,'no view model: nothing held');
});

test('crosshair: DrawShadowed outline copies and colour blend', ()=>{
 const white={r:1,g:1,b:1,a:1},black={r:0,g:0,b:0,a:1};
 const full=shadowedDraws(1,white,black);assert.deepEqual(full.slice(0,4).map(d=>[d.dx,d.dy]),[[1,-1],[-1,-1],[-1,1],[1,1]]);
 assert.deepEqual(full[4].color,{r:1,g:1,b:1,a:1});assert.equal(full[0].color.a,1);
 const half=shadowedDraws(0.75,{r:1,g:0,b:0,a:0.95},{r:0,g:0,b:0,a:0.8});assert.equal(half.length,5);assert.ok(Math.abs(half[0].color.a-0.2)<1e-12);
 const low=shadowedDraws(0.25,white,black);assert.equal(low.length,1);assert.ok(Math.abs(low[0].color.a-0.25)<1e-12);assert.ok(Math.abs(low[0].color.r-0.25)<1e-12);
 assert.deepEqual(shadowedDraws(0,white,black),[]);
 assert.deepEqual(centredRect(tex,{width:1280,height:720}),{x:624,y:343,width:32,height:32});
});

const manifest='browser/assets/recovered/crosshair/manifest.json';
test('crosshair: no shipped view model draws one', {skip:!present(manifest)}, ()=>{
 const m=JSON.parse(readFileSync(manifest,'utf8')),vms=Object.values(m.viewmodels);assert.ok(vms.length>=17);
 for(const v of vms)for(const z of [0,0.5,1])assert.equal(crosshairAlpha(v,z),null,v.name);
 const textured=vms.filter(v=>v.crosshairTexture);assert.ok(textured.every(v=>v.crosshairTexture.name==='xhair'&&v.dotTexture.name==='RoundedM'));
 assert.deepEqual(vms.find(v=>v.name==='VM-Vertec').crosshairColor,{r:1,g:0,b:0,a:0.9529411792755127});
});
