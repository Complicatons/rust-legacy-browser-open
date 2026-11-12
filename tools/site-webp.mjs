// WebP copies of the website's top-level screenshots (site/generated/media/<name>.jpg → <name>.webp, <name>-960.webp,
// <name>-480.webp; the share-*.jpg link-preview cards stay JPEG only, as link previews expect). The page backgrounds offer
// them first through image-set() (site/css/pages/title.css, launch.css, auth.css; 960 px on phones) and the updates list
// and update pages load them with the JPEG as fallback (site/js/updates.mjs). Encoded by the browser (OffscreenCanvas
// convertToBlob, quality 0.8), so no image library is needed. Measured 2026-10-23: hero-menu 378 KB JPEG → 213 KB WebP,
// 81 KB at 960 px; gather 707 → 515 / 157 KB.
//   node tools/site-webp.mjs        (also the build-site "webp" step, after "media")
import {chromium} from 'playwright-core';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {launchOptions} from './qa-browser.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),MEDIA=path.join(root,'site/generated/media');
// The page backgrounds named in CSS (tests/site-release.test.mjs checks the CSS against these).
export const BACKGROUNDS=['hero-menu','gather'];
export const SMALL_WIDTH=960,THUMB_WIDTH=480,QUALITY=0.8;
// WebP URL for a generated top-level screenshot, or null for anything else (site/js/updates.mjs keeps its own copy).
export const webpFor=(src,width=null)=>{const m=/^\/site\/generated\/media\/([a-z0-9-]+)\.jpg$/.exec(src??'');return m&&!m[1].startsWith('share-')?`/site/generated/media/${m[1]}${width?'-'+width:''}.webp`:null;};

export async function buildSiteWebp({dir=MEDIA}={}){
 const names=existsSync(dir)?(await readdir(dir)).filter(f=>/^[a-z0-9-]+\.jpg$/.test(f)&&!f.startsWith('share-')).map(f=>f.slice(0,-4)):[];
 if(!names.length)return {written:[],missing:BACKGROUNDS};
 const browser=await chromium.launch(launchOptions()),written=[];
 try{
  const page=await browser.newPage();
  for(const name of names){
   const jpeg=(await readFile(path.join(dir,name+'.jpg'))).toString('base64');
   const out=await page.evaluate(async([b64,widths,q])=>{
    const bitmap=await createImageBitmap(await (await fetch('data:image/jpeg;base64,'+b64)).blob());
    const encode=async width=>{width=Math.min(width,bitmap.width);const height=Math.round(bitmap.height*width/bitmap.width),c=new OffscreenCanvas(width,height),g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(bitmap,0,0,width,height);
     const blob=await c.convertToBlob({type:'image/webp',quality:q});if(blob.type!=='image/webp')throw Error('this browser cannot encode WebP');
     return [...new Uint8Array(await blob.arrayBuffer())];};
    const r={};for(const w of widths)r[w]=await encode(w||bitmap.width);return r;
   },[jpeg,[0,SMALL_WIDTH,THUMB_WIDTH],QUALITY]);
   for(const [w,bytes] of Object.entries(out))await writeFile(path.join(dir,`${name}${+w?'-'+w:''}.webp`),Buffer.from(bytes));
   written.push(`${name} ${Math.round(out[0].length/1024)}/${Math.round(out[SMALL_WIDTH].length/1024)}/${Math.round(out[THUMB_WIDTH].length/1024)} KB`);
  }
 }finally{await browser.close();}
 return {written,missing:BACKGROUNDS.filter(n=>!names.includes(n))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=await buildSiteWebp();console.log('webp (full/960/480):',r.written.join('; ')||'nothing',r.missing.length?`(no ${r.missing.join(', ')}.jpg)`:'');
}
