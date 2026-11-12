import * as THREE from 'three';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
// Loads a recovered texture as KTX2 (Basis Universal, transcoded to the GPU's compressed format) when tools/encode-ktx2.mjs
// produced one and the browser can transcode it; otherwise the original PNG. KTX2 files are stored bottom-row first, the
// order the PNGs reach with flipY=true, so callers keep their flipY only for PNG results (compressed uploads ignore it).
// Any KTX2 failure (no index, blocked worker/WebAssembly, decode error) falls back to the PNG for that and later loads.
// PNGs without a KTX2 version (not power of two, or over the Basis encoder's size limit, e.g. the 4096x4096 maps) load
// from a lossless WebP copy when tools/encode-webp.py made one (webp.json): the same pixels in a smaller file.
// With a renderer, the WebP is decoded off the main thread by createImageBitmap, bottom row first (the rows a flipY=true
// upload of the image gives) and with no premultiply or colour conversion (three uploads these images with neither), so
// the GPU gets the same texels (tools/check-webp-bitmap.mjs); an <img> would be decoded on the main thread at its first
// upload (about 0.5 s per 4096x4096 map). WebGL ignores flipY for an ImageBitmap, so its texture keeps flipY=false like a
// KTX2 one. Used only when the browser honours imageOrientation (probed once) and the image fits the GPU's texture size
// (three would otherwise resize it through a canvas); any failure falls back to the <img> for that and later loads.
const ASSETS='/assets/recovered/';
const BITMAP={imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'};
let orientation=null;
const bitmapsFlip=()=>orientation??=(async()=>{try{const b=await createImageBitmap(new ImageData(new Uint8ClampedArray([255,0,0,255,0,0,255,255]),1,2),BITMAP),c=document.createElement('canvas');c.width=1;c.height=2;
 const g=c.getContext('2d');g.drawImage(b,0,0);b.close();return g.getImageData(0,0,1,1).data[2]===255;}catch{return false;}})();
export async function decodeBitmap(url){const r=await fetch(url);if(!r.ok)throw Error(`${r.status} ${url}`);return createImageBitmap(await r.blob(),BITMAP);}
export function createTextureSource(renderer,{base=ASSETS,transcoderPath='/vendor/addons/libs/basis/',workerUrl='/vendor/basis-worker.js',enabled=true,webpEnabled=true,bitmapsEnabled=true,timeoutMs=30000}={}){
 const png=new THREE.TextureLoader();let ktx2=null,index=null,broken=!enabled,webp=null,webpBroken=!webpEnabled,bitmaps=Boolean(renderer&&bitmapsEnabled&&typeof createImageBitmap==='function');
 const webpReady=webpBroken?Promise.resolve():fetch(base+'webp.json').then(r=>r.ok?r.json():null).then(j=>{webp=j?.files??null;}).catch(()=>{webpBroken=true;});
 const ready=(async()=>{if(broken)return;try{const r=await fetch(base+'ktx2.json');if(!r.ok){broken=true;return;}index=(await r.json()).files??{};
  ktx2=new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(renderer);await ktx2.init();
  // The transcoder runs in a worker served from its own URL (tools/serve.mjs) with its own policy; the page's CSP
  // allows neither blob: workers nor eval, which KTX2Loader's built-in blob worker would need.
  if(ktx2.workerSourceURL)URL.revokeObjectURL(ktx2.workerSourceURL);
  ktx2.workerPool.setWorkerCreator(()=>{const w=new Worker(workerUrl),bin=ktx2.transcoderBinary.slice(0);w.postMessage({type:'init',config:ktx2.workerConfig,transcoderBinary:bin},[bin]);return w;});
  }catch{broken=true;}})();
 // A worker that cannot start never answers; give up on KTX2 instead of stalling the load.
 const withTimeout=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('KTX2 transcode timed out')),timeoutMs))]);
 const stats={ktx2:0,webp:0,bitmaps:0,png:0,fallbacks:0};
 // url: full URL under the recovered assets root. Returns a texture whose flipY is already correct for its kind.
 async function load(url){await ready;const rel=url.startsWith(base)?url.slice(base.length):null,entry=rel&&index?.[rel];
  if(!broken&&entry?.ktx2){try{const t=await withTimeout(ktx2.loadAsync(base+entry.ktx2));t.flipY=false;t.userData.ktx2=true;stats.ktx2++;return t;}
   catch(e){stats.fallbacks++;console.warn('KTX2 unavailable, using PNG textures',e?.message??e);broken=true;}}
  await webpReady;const lossless=!webpBroken&&rel&&webp?.[rel]?.webp;
  if(lossless&&bitmaps&&Math.max(webp[rel].width,webp[rel].height)<=renderer.capabilities.maxTextureSize&&await bitmapsFlip()){
   try{const t=new THREE.Texture(await decodeBitmap(base+lossless));t.needsUpdate=true;t.flipY=false;t.userData.bitmap=true;stats.webp++;stats.bitmaps++;return t;}
   catch(e){stats.fallbacks++;console.warn('ImageBitmap decoding unavailable, using <img>',e?.message??e);bitmaps=false;}}
  if(lossless){try{const t=await png.loadAsync(base+lossless);t.flipY=true;stats.webp++;return t;}
   catch(e){stats.fallbacks++;console.warn('WebP unavailable, using PNG textures',e?.message??e);webpBroken=true;}}
  const t=await png.loadAsync(url);t.flipY=true;stats.png++;return t;}
 return {load,ready,stats,get active(){return !broken&&Boolean(ktx2);}};}
// Callers that set flipY themselves: keep PNG behaviour, never flip a compressed texture or an ImageBitmap (decoded flipped).
export const setFlipY=(t,flip)=>{if(!t.isCompressedTexture&&!t.userData?.ktx2&&!t.userData?.bitmap)t.flipY=flip;};
// One shared source for the page (set once the renderer exists); before that (the menu background), the PNG or its
// lossless WebP copy, without KTX2.
let shared=null,beforeRenderer=null;
export const useTextureSource=source=>{shared=source;};
export const loadRecovered=url=>shared?shared.load(url):(beforeRenderer??=createTextureSource(null,{enabled:false})).load(url);
export const textureStats=()=>shared?{...shared.stats,active:shared.active}:null;
