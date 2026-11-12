// Packs an exported animation clips.json (viewmodels, animals, players) into clips.pack.json + clips.bin: every numeric
// array becomes a run of little-endian float32s in the .bin, and identical keyframe `times` arrays are stored once. The
// exporters write Unity's float32 curve data, so this is lossless; the pack refuses any number that is not exactly a
// float32. browser/clip-pack.mjs loads the pack (and falls back to clips.json). Re-run after an exporter rewrites clips.json.
//   node tools/pack-clips.mjs [dir…]   (default: viewmodels animals players)
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// skeleton: the JSON with numeric arrays replaced by {"$f":offset,"n":length} (offsets in float32 units).
export function packClips(data){const runs=[],seen=new Map();let length=0;
 const put=(arr,dedupe)=>{const key=dedupe?arr.join(','):null;if(key!==null&&seen.has(key))return seen.get(key);
  for(const v of arr)if(typeof v!=='number'||Math.fround(v)!==v)throw Error('not an exact float32: '+v);
  const ref={$f:length,n:arr.length};runs.push(arr);length+=arr.length;if(key!==null)seen.set(key,ref);return ref;};
 const walk=(v,key)=>{if(Array.isArray(v)){if(v.length&&v.every(x=>typeof x==='number'))return put(v,key==='times');return v.map(x=>walk(x));}
  if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v))o[k]=walk(x,k);return o;}return v;};
 const skeleton=walk(data),floats=new Float32Array(length);let o=0;for(const r of runs){floats.set(r,o);o+=r.length;}
 return {skeleton,floats};}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const dirs=process.argv.slice(2).length?process.argv.slice(2):['viewmodels','animals','players'];
 for(const dir of dirs){const base=`browser/assets/recovered/${dir}/`,text=readFileSync(base+'clips.json'),{skeleton,floats}=packClips(JSON.parse(text));
  const bin=Buffer.from(floats.buffer,floats.byteOffset,floats.byteLength);writeFileSync(base+'clips.bin',bin);
  writeFileSync(base+'clips.pack.json',JSON.stringify({format:'rlb-clips-1',bin:'clips.bin',floats:floats.length,binSHA256:createHash('sha256').update(bin).digest('hex'),
   sourceSHA256:createHash('sha256').update(text).digest('hex'),note:'tools/pack-clips.mjs: numeric arrays as float32 runs in clips.bin; identical times arrays stored once',data:skeleton}));
  console.log(dir,`${(text.length/1048576).toFixed(1)} MB JSON -> ${(bin.length/1048576).toFixed(1)} MB bin`);}
}
