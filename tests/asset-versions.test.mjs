import test from 'node:test';
import assert from 'node:assert/strict';

// browser/asset-versions.mjs reads the version index named by the page at import time, so the browser globals it uses
// are stubbed first: a page at http://game.test/ whose index lists two files.
const requests=[];
globalThis.location={href:'http://game.test/',origin:'http://game.test'};
globalThis.document={querySelector:q=>q==='meta[name="rlb-asset-versions"]'?{content:'/asset-versions.json?v=i1'}:null};
class StubFontFace{constructor(family,source){this.family=family;this.source=source;}}
globalThis.FontFace=StubFontFace;
const failing=new Set();
globalThis.fetch=async(url,init)=>{requests.push([String(url),init?.priority??null]);if(failing.has(String(url)))return {ok:false,status:500};
 if(String(url).startsWith('/asset-versions.json'))return {ok:true,json:async()=>({files:{'/assets/a.bin':'aa','/assets/b.json':'bb','/load-order.json':'ll','/fonts/x.ttf':'ff'}})};
 if(String(url).startsWith('/load-order.json'))return {ok:true,json:async()=>({files:['/assets/b.json','/assets/unlisted.bin','/assets/a.bin']})};
 return {ok:true,blob:async()=>({size:10})};};
const {versioned,hasVersions,cssUrl,versionIndex}=await import('../browser/asset-versions.mjs');
const {prefetchWorld}=await import('../browser/world-prefetch.mjs');
const THREE=await import('three');

test('listed game files get their version; everything else is left alone',()=>{
 assert.equal(hasVersions(),true);
 assert.equal(versioned('/assets/a.bin'),'/assets/a.bin?v=aa');
 assert.equal(versioned('http://game.test/assets/a.bin'),'/assets/a.bin?v=aa');
 assert.equal(versioned('/assets/a.bin?v=aa'),'/assets/a.bin?v=aa','already versioned');
 assert.equal(versioned('/servers'),'/servers','API paths are not in the index');
 assert.equal(versioned('https://elsewhere.test/assets/a.bin'),'https://elsewhere.test/assets/a.bin');
 assert.equal(THREE.DefaultLoadingManager.resolveURL('/assets/b.json'),'/assets/b.json?v=bb','three.js loaders');
});

test('fetch and FontFace sources use versioned URLs; other methods are untouched',async()=>{
 requests.length=0;await fetch('/assets/a.bin');await fetch(new URL('http://game.test/assets/b.json'));await fetch('/assets/a.bin',{method:'POST'});
 assert.deepEqual(requests.map(r=>r[0]),['/assets/a.bin?v=aa','/assets/b.json?v=bb','/assets/a.bin']);
 assert.equal(new FontFace('X','url("/fonts/x.ttf")').source,'url("/fonts/x.ttf?v=ff")');
 assert.ok(new FontFace('X','url("/fonts/x.ttf")') instanceof StubFontFace);
 // CSS url() values (HUD/RPOS sprites, menu skin) would otherwise revalidate on every join.
 assert.equal(cssUrl('/assets/a.bin'),'url("/assets/a.bin?v=aa")');
 assert.equal(cssUrl('/unlisted.png'),'url("/unlisted.png")');
});

const memoryStorage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),map:m};};
test('the world prefetch downloads listed files in order at low priority and skips unversioned ones',async()=>{
 requests.length=0;const storage=memoryStorage(),p=prefetchWorld({concurrency:1,storage});await p.done;
 assert.deepEqual(requests,[['/load-order.json?v=ll',null],['/assets/b.json?v=bb','low'],['/assets/a.bin?v=aa','low']]);
 assert.deepEqual(p.state,{total:2,done:2,skipped:0,bytes:20,finished:true});
 assert.equal(versionIndex(),'/asset-versions.json?v=i1');
 assert.deepEqual(JSON.parse(storage.map.get('rlb-prefetch')),{index:'/asset-versions.json?v=i1',files:2});
 // The next visit finds both in the cache already and reads no body again; a new version index starts over.
 requests.length=0;const again=prefetchWorld({concurrency:1,storage});await again.done;
 assert.deepEqual(requests,[['/load-order.json?v=ll',null]]);assert.deepEqual(again.state,{total:2,done:2,skipped:2,bytes:0,finished:true});
 requests.length=0;await prefetchWorld({concurrency:1,storage,index:'/asset-versions.json?v=i2'}).done;assert.equal(requests.length,3);
 // A file that failed to load stops the saved count there, so the next visit fetches it again.
 const partial=memoryStorage();requests.length=0;failing.add('/assets/b.json?v=bb');
 try{await prefetchWorld({concurrency:1,storage:partial}).done;}finally{failing.clear();}
 assert.deepEqual(JSON.parse(partial.map.get('rlb-prefetch')??'{"files":0}').files,0);
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{value:{connection:{saveData:true}},configurable:true});
 try{assert.equal(prefetchWorld(),null,'Save-Data turns it off');}finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
});
