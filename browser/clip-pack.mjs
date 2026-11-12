// Loads exported animation clips from the float32 pack (tools/pack-clips.mjs: clips.pack.json + clips.bin) and rebuilds
// the clips.json structure with Float32Arrays, falling back to clips.json when there is no pack. Value arrays are views
// into the one buffer; keyframe `times` are stored once in the pack, so each track gets its own copy (three's track
// helpers such as shift/scale/trim change times in place).
export function unpackClips(skeleton,buffer){
 const walk=(v,key)=>{if(Array.isArray(v))return v.map(x=>walk(x));if(!v||typeof v!=='object')return v;
  if(typeof v.$f==='number'){const view=new Float32Array(buffer,v.$f*4,v.n);return key==='times'?view.slice():view;}
  const o={};for(const [k,x] of Object.entries(v))o[k]=walk(x,k);return o;};
 return walk(skeleton);}
// url: the clips.json URL. fetchImpl: for tests.
export async function loadClips(url,fetchImpl=globalThis.fetch){
 const packUrl=url.replace(/\.json$/,'.pack.json');
 try{const r=await fetchImpl(packUrl);if(r.ok){const pack=await r.json(),b=await fetchImpl(new URL(pack.bin,new URL(packUrl,globalThis.location?.href??'http://x/')).href);
   if(b.ok){const buffer=await b.arrayBuffer();if(buffer.byteLength===pack.floats*4)return unpackClips(pack.data,buffer);}}}catch{}
 const r=await fetchImpl(url);if(!r.ok)throw Error('Missing '+url);return r.json();}
