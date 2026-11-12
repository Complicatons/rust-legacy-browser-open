import {versioned,hasVersions,versionIndex} from './asset-versions.mjs';
// Downloads the island's game files into the browser cache while the menu is shown, in the order a join loads them
// (load-order.json, recorded by tools/check-load.mjs LOAD_WRITE_ORDER=1). The world is still built exactly as before
// once a server is chosen; its requests are then answered from the cache (versioned URLs are immutable) or join a
// download already in flight, instead of each waiting on the previous one. Only files in the version index are fetched
// (anything else would be revalidated anyway), at low priority and six at a time (the HTTP/1.1 connection limit; the
// game's own queued requests go first). Skipped when the browser asks to save data.
// Progress is kept across visits (localStorage 'rlb-prefetch': how many files from the start of the list are in the
// cache, for this version index): those files are cached for good (immutable URLs), and reading their bodies again on
// every visit pulled ~160 MB through the page during a warm join. Any changed game file changes the index and starts the
// list over; a file that failed to load stops the count there.
const PROGRESS='rlb-prefetch';
function localStore(){try{return globalThis.localStorage??null;}catch{return null;}}
export function prefetchWorld({list='/load-order.json',concurrency=6,fetchImpl=globalThis.fetch,storage=localStore(),index=versionIndex()}={}){
 if(!hasVersions()||globalThis.navigator?.connection?.saveData)return null;
 const state={total:0,done:0,skipped:0,bytes:0,finished:false};let stopped=false;
 let start=0;try{const p=JSON.parse(storage?.getItem(PROGRESS)??'null');if(p?.index===index&&Number.isInteger(p.files))start=p.files;}catch{}
 const done=(async()=>{const r=await fetchImpl(list);if(!r.ok)return;const files=((await r.json()).files??[]).filter(f=>versioned(f)!==f);state.total=files.length;
  let next=state.skipped=state.done=Math.min(start,files.length),prefix=next,saved=next;const loaded=new Uint8Array(files.length);
  const save=()=>{saved=prefix;try{storage?.setItem(PROGRESS,JSON.stringify({index,files:prefix}));}catch{}};
  await Promise.all(Array.from({length:concurrency},async()=>{while(!stopped&&next<files.length){const i=next++;
   try{const res=await fetchImpl(files[i],{priority:'low'});if(res.ok){state.bytes+=(await res.blob()).size;loaded[i]=1;}}catch{}state.done++;
   while(prefix<files.length&&loaded[prefix])prefix++;if(prefix>=saved+25||prefix===files.length&&saved<prefix)save();}}));
  if(prefix>saved)save();})()
  .catch(e=>console.warn('World prefetch stopped:',e.message)).finally(()=>{state.finished=true;});
 return {state,done,stop(){stopped=true;}};
}
