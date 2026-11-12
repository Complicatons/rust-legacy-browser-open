import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {packClips} from '../tools/pack-clips.mjs';
import {loadClips,unpackClips} from '../browser/clip-pack.mjs';
import {needsAssets} from './helpers/assets.mjs';

const root=new URL('../browser/assets/recovered/',import.meta.url);
// fetch over the recovered folder for the loader.
const fileFetch=async url=>{const rel=url.replace(/^http:\/\/x\/assets\/recovered\//,'');try{const b=await readFile(new URL(rel,root));return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch{return {ok:false};}};
// Same structure and numbers (typed arrays from the pack, plain arrays from the JSON).
function same(a,b,path=''){if(ArrayBuffer.isView(a)||Array.isArray(a)){assert.ok(ArrayBuffer.isView(b)||Array.isArray(b),path);assert.equal(a.length,b.length,path);
  for(let i=0;i<a.length;i++){if(typeof a[i]==='number'){if(a[i]!==b[i])assert.fail(`${path}[${i}] ${a[i]} != ${b[i]}`);}else same(a[i],b[i],path+'['+i+']');}return;}
 if(a&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);for(const k of Object.keys(a))same(a[k],b[k],path+'.'+k);return;}assert.equal(a,b,path);}

test('packing is lossless and shares identical keyframe times',()=>{
 const data={a:{tracks:[{rotation:{times:[0,0.5,1],values:[0.1,0.2,0.3,0.4]},position:{times:[0,0.5,1],values:[1,2,3]}}],length:1}};
 const {skeleton,floats}=packClips(JSON.parse(JSON.stringify(data,(k,v)=>typeof v==='number'?Math.fround(v):v)));
 assert.equal(floats.length,3+4+3,'times stored once');const back=unpackClips(skeleton,floats.buffer);
 same(back,JSON.parse(JSON.stringify(data,(k,v)=>typeof v==='number'?Math.fround(v):v)));
 assert.notEqual(back.a.tracks[0].rotation.times.buffer,back.a.tracks[0].position.times.buffer,'each track owns its times');
 assert.throws(()=>packClips({x:[0.1]}),/exact float32/);
});

for(const dir of ['viewmodels','animals','players'])test(`${dir} clips: the pack is current and loads the same clips as clips.json`,needsAssets,async()=>{
 const text=await readFile(new URL(dir+'/clips.json',root)),pack=JSON.parse(await readFile(new URL(dir+'/clips.pack.json',root)));
 assert.equal(pack.sourceSHA256,createHash('sha256').update(text).digest('hex'),'rerun tools/pack-clips.mjs');
 const loaded=await loadClips(`http://x/assets/recovered/${dir}/clips.json`,fileFetch);assert.ok(ArrayBuffer.isView(Object.values(loaded)[0].tracks[0].rotation.values),'from the pack');
 same(loaded,JSON.parse(text));
});
