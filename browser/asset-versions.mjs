import * as THREE from 'three';
// Versioned game-file URLs (tools/asset-versions.mjs). The page names the server's version index in
// <meta name="rlb-asset-versions">; every fetch() and three.js loader request for a listed file then asks for
// `file?v=<content version>`, which the server answers as immutable, so a repeat visit loads the game from the browser
// cache with no request at all. Unlisted URLs (the API, a page served without the index) are left unchanged.
// Imported first by main.mjs: its top-level await finishes before main.mjs starts loading anything.
let files=null;
const meta=globalThis.document?.querySelector('meta[name="rlb-asset-versions"]');
if(meta){try{const r=await fetch(meta.content);if(r.ok)files=(await r.json()).files??null;}catch(e){console.warn('Asset versions unavailable:',e.message);}}

export function versioned(url){
 if(!files||typeof url!=='string')return url;
 let u;try{u=new URL(url,location.href);}catch{return url;}
 if(u.origin!==location.origin||u.search||!Object.hasOwn(files,u.pathname))return url;
 return u.pathname+'?v='+files[u.pathname];}
export const hasVersions=()=>Boolean(files);
// The index's own versioned URL: it changes whenever any listed file does.
export const versionIndex=()=>files?meta.content:null;
// A CSS url() value (inline styles and custom properties: HUD/RPOS cells and shadows, the menu skin) for a game file.
export const cssUrl=url=>`url("${versioned(url)}")`;

if(files){
 THREE.DefaultLoadingManager.setURLModifier(versioned);
 const nativeFetch=globalThis.fetch.bind(globalThis);
 const get=init=>!init?.method||init.method==='GET';
 globalThis.fetch=(input,init)=>nativeFetch(get(init)&&(typeof input==='string'||input instanceof URL)?versioned(String(input)):input,init);
 // <img> elements and FontFace sources (UI atlases, item icons, fonts) take the same URLs. Nothing reads img.src back.
 const src=globalThis.HTMLImageElement&&Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
 if(src)Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value){src.set.call(this,versioned(value));}});
 const NativeFontFace=globalThis.FontFace;
 if(NativeFontFace)globalThis.FontFace=class FontFace extends NativeFontFace{constructor(family,source,descriptors){super(family,typeof source==='string'?source.replace(/url\("([^"]+)"\)/g,(_,u)=>`url("${versioned(u)}")`):source,descriptors);}};
}
