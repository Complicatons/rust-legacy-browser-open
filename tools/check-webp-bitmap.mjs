// Checks that a lossless WebP decoded off the main thread (browser/texture-source.mjs: createImageBitmap, flipped, no
// premultiply or colour conversion) reaches the GPU as exactly the texels three uploads from the same WebP as an <img>
// with flipY: both go through three's own WebGLRenderer upload, as a colour (sRGB) and as a data texture, and level 0
// is read back from a framebuffer. Run: node tools/check-webp-bitmap.mjs
import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from './serve.mjs';
import {launchOptions} from './qa-browser.mjs';
const index=JSON.parse(await readFile('browser/assets/recovered/webp.json','utf8')).files;
const pairs=Object.entries(index).filter(([,e])=>e.webp).map(([png,e])=>[png,e.webp]);
const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch(launchOptions());
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/assets/recovered/webp.json');
 await page.setContent('<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script><canvas id="c" width="4" height="4"></canvas>');
 await page.evaluate(async()=>{const THREE=await import('three'),{createTextureSource}=await import('/texture-source.mjs');
  const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#c')}),gl=renderer.getContext(),source=createTextureSource(renderer,{enabled:false});
  const texels=t=>{renderer.initTexture(t);const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,renderer.properties.get(t).__webglTexture,0);
   const {width,height}=t.image,out=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,out);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(fb);t.dispose();return out;};
  window.compare=async(png,webp)=>{const res={glError:0};
   for(const [name,space] of [['srgb',THREE.SRGBColorSpace],['data',THREE.NoColorSpace]]){
    const img=await new THREE.TextureLoader().loadAsync('/assets/recovered/'+webp);img.flipY=true;img.colorSpace=space;
    const bmp=await source.load('/assets/recovered/'+png);bmp.colorSpace=space;res.bitmap=Boolean(bmp.userData.bitmap&&bmp.image instanceof ImageBitmap);
    const a=texels(img),b=texels(bmp);let diff=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff++;res[name]=diff;res.size=[img.image.width,img.image.height];bmp.image.close?.();}
   res.glError=gl.getError();return res;};});
 for(const [png,webp] of pairs){const r=await page.evaluate(([a,b])=>window.compare(a,b),[png,webp]);console.log(png,JSON.stringify(r));
  assert.ok(r.bitmap,'decoded as an ImageBitmap');assert.equal(r.glError,0);assert.equal(r.srgb,0,'identical texels (sRGB texture)');assert.equal(r.data,0,'identical texels (data texture)');}
 assert.deepEqual(errors,[]);
 console.log('PASS check-webp-bitmap',pairs.length,'textures',await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}));
}finally{await browser.close();server.close();}
