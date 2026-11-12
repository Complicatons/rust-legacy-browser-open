// Checks that every lossless WebP copy (tools/encode-webp.py, browser/assets/recovered/webp.json) reaches the GPU as
// exactly the same texels as its PNG: both are uploaded with the game's pixel-store settings (flipY, no premultiply,
// with and without browser colour conversion) and read back from a framebuffer. Run: node tools/check-webp.mjs
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions,readGraphics} from './qa-browser.mjs';
const index=JSON.parse(await readFile('browser/assets/recovered/webp.json','utf8')).files;
const pairs=Object.entries(index).filter(([,e])=>e.webp).map(([png,e])=>[png,e.webp]);
const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(launchOptions());
try{
 const page=await browser.newPage();await page.goto(origin+'/assets/recovered/webp.json');
 for(const [png,webp] of pairs){
  const r=await page.evaluate(async([a,b])=>{
   const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
   const load=url=>new Promise((ok,fail)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>fail(Error('load '+url));i.src=url;});
   const texels=(img,conversion)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,conversion);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,img);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
    const out=new Uint8Array(img.width*img.height*4);gl.readPixels(0,0,img.width,img.height,gl.RGBA,gl.UNSIGNED_BYTE,out);gl.deleteFramebuffer(fb);gl.deleteTexture(t);return out;};
   const [pi,wi]=await Promise.all([load(a),load(b)]);if(pi.width!==wi.width||pi.height!==wi.height)return {size:false};
   const res={size:true,width:pi.width,height:pi.height,glError:0};
   for(const [name,mode] of [['none',gl.NONE],['browserDefault',gl.BROWSER_DEFAULT_WEBGL]]){const x=texels(pi,mode),y=texels(wi,mode);let diff=0;for(let i=0;i<x.length;i++)if(x[i]!==y[i])diff++;res[name]=diff;}
   res.glError=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return res;},['/assets/recovered/'+png,'/assets/recovered/'+webp]);
  console.log(png,JSON.stringify(r));
  assert.ok(r.size,'same size');assert.equal(r.glError,0);assert.equal(r.none,0,'identical texels (no colour conversion)');assert.equal(r.browserDefault,0,'identical texels (browser colour conversion)');
 }
 console.log('PASS check-webp',pairs.length,'textures',(await readGraphics(page).catch(()=>({renderer:'n/a'}))).renderer);
}finally{await browser.close();server.close();}
