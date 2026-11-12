import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,realpath,stat,mkdir} from 'node:fs/promises';
import os from 'node:os';
import {promisify} from 'node:util';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {createAssetVersions,defaultCacheFile,versionedPage,versionOf,writeFileAtomic} from './asset-versions.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.wasm':'application/wasm','.ktx2':'image/ktx2','.ttf':'font/ttf','.otf':'font/otf','.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.f32':'application/octet-stream','.u32':'application/octet-stream','.u8':'application/octet-stream','.bin':'application/octet-stream','.ogg':'audio/ogg','.wav':'audio/wav'};
const modules={'/vendor/three.module.js':'build/three.module.js','/vendor/three.core.js':'build/three.core.js','/vendor/addons/math/Octree.js':'examples/jsm/math/Octree.js','/vendor/addons/math/Capsule.js':'examples/jsm/math/Capsule.js',
 // KTX2/Basis texture transcoding (browser/texture-source.mjs).
 '/vendor/addons/loaders/KTX2Loader.js':'examples/jsm/loaders/KTX2Loader.js','/vendor/addons/utils/WorkerPool.js':'examples/jsm/utils/WorkerPool.js','/vendor/addons/libs/ktx-parse.module.js':'examples/jsm/libs/ktx-parse.module.js',
 '/vendor/addons/libs/zstddec.module.js':'examples/jsm/libs/zstddec.module.js','/vendor/addons/math/ColorSpaces.js':'examples/jsm/math/ColorSpaces.js','/vendor/addons/libs/basis/basis_transcoder.js':'examples/jsm/libs/basis/basis_transcoder.js','/vendor/addons/libs/basis/basis_transcoder.wasm':'examples/jsm/libs/basis/basis_transcoder.wasm'};
const importMap='{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}';
const importHash=createHash('sha256').update(importMap).digest('base64');
export function createServer(api=null,options={}) {
 const game=createGameHandler(options);
 return http.createServer(async(req,res)=>{
  if(api&&req.url.startsWith('/api/')){await api.handle(req,res);return;}
  await game(req,res);
 });
}
// Geometry, JSON, scripts and height data compress to 15-50% (PNG/OGG/KTX2/WebP are already compressed). Encoded copies
// are kept in memory per file version, so each file is compressed once rather than once per player. Brotli is sent at
// quality 5 at once; with brotliUpgrade (central, the dev server) each file is then recompressed at quality 11 with a
// 16 MB window in the background, one at a time (~20% fewer bytes: 27.4 -> 22.2 MB for an island join), and the copy is
// kept on disk by content version, so a restart or redeploy reuses it. Harnesses leave it off: it runs for minutes.
const brotli=promisify(zlib.brotliCompress),gzip=promisify(zlib.gzip),compressible=new Set(['.wasm','.json','.mjs','.js','.css','.html','.bin','.f32','.u32','.u8','.ttf','.otf','.wav']);
const encodedCache=new Map(),ENCODED_CACHE_BYTES=512*1024*1024,BEST_DIR=path.join(os.tmpdir(),'rlb-brotli-q11');let encodedBytes=0,upgrades=Promise.resolve();
function remember(key,entry){const old=encodedCache.get(key);if(old){encodedCache.delete(key);encodedBytes-=old.data.length;}encodedCache.set(key,entry);encodedBytes+=entry.data.length;
 for(const [k,v] of encodedCache){if(encodedBytes<=ENCODED_CACHE_BYTES)break;encodedCache.delete(k);encodedBytes-=v.data.length;}}
function upgrade(file,version,key){upgrades=upgrades.then(async()=>{const source=await readFile(file);if(versionOf(source)!==version)return;
 const data=await brotli(source,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:11,[zlib.constants.BROTLI_PARAM_LGWIN]:24,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:source.length}});
 if(data.length>=source.length)return;await mkdir(BEST_DIR,{recursive:true});await writeFileAtomic(path.join(BEST_DIR,version+'.br'),data);if(encodedCache.has(key))remember(key,{data,encoding:'br'});}).catch(()=>{});}
async function encoded(file,etag,ext,accept,upgradeBrotli=false){const raw=()=>readFile(file).then(data=>({data,encoding:null}));
 const encoding=!compressible.has(ext)?null:/\bbr\b/.test(accept)?'br':/\bgzip\b/.test(accept)?'gzip':null;if(!encoding)return raw();
 const key=`${file}|${etag}|${encoding}`;if(encodedCache.has(key)){const hit=encodedCache.get(key);encodedCache.delete(key);encodedCache.set(key,hit);return hit;}
 const source=await readFile(file);if(source.length<1024)return {data:source,encoding:null};
 if(encoding==='br'){const version=versionOf(source),best=await readFile(path.join(BEST_DIR,version+'.br')).catch(()=>null);
  if(best){const entry={data:best,encoding};remember(key,entry);return entry;}if(upgradeBrotli)upgrade(file,version,key);}
 const data=encoding==='br'?await brotli(source,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:5,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:source.length}}):await gzip(source,{level:6});
 const entry=data.length<source.length?{data,encoding}:{data:source,encoding:null};remember(key,entry);
 return entry;}
// Basis Universal transcoder worker for KTX2 textures (browser/texture-source.mjs), built from three's own KTX2Loader worker and
// basis_transcoder.js exactly as KTX2Loader would put in a blob. The Emscripten embind bindings generate functions at
// runtime, so this worker - and only this worker, which has no DOM and only decodes our texture files - gets its own
// policy with 'unsafe-eval'. The page itself keeps a strict script-src.
let basisWorkerBody=null;
async function basisWorker(req,res){
 if(!basisWorkerBody){const {KTX2Loader}=await import('three/examples/jsm/loaders/KTX2Loader.js'),fn=KTX2Loader.BasisWorker.toString(),js=await readFile(path.join(root,'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js'),'utf8');
  basisWorkerBody=Buffer.from(['/* constants */','let _EngineFormat = '+JSON.stringify(KTX2Loader.EngineFormat),'let _EngineType = '+JSON.stringify(KTX2Loader.EngineType),'let _TranscoderFormat = '+JSON.stringify(KTX2Loader.TranscoderFormat),
   'let _BasisFormat = '+JSON.stringify(KTX2Loader.BasisFormat),'/* basis_transcoder.js */',js,'/* worker */',fn.substring(fn.indexOf('{')+1,fn.lastIndexOf('}'))].join('\n'));
  basisWorkerBody={body:basisWorkerBody,br:zlib.brotliCompressSync(basisWorkerBody),gzip:zlib.gzipSync(basisWorkerBody),etag:'"'+versionOf(basisWorkerBody)+'"'};}
 // ETag + compression: without a validator every join downloaded the ~65 KB worker again.
 sendPacked(req,res,basisWorkerBody,{'Content-Type':'text/javascript','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'"});}
// Versioned URLs (tools/asset-versions.mjs): `file?v=<content version>` is answered immutable for a year when the version
// is the file's current one; any other request keeps no-cache + ETag. One scanner per process, shared by every handler.
const IMMUTABLE='public, max-age=31536000, immutable',RAPIER='node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
let sharedVersions=null;
const assetVersions=()=>sharedVersions??=createAssetVersions({cacheFile:defaultCacheFile(root),accept:u=>Boolean(mime[path.extname(u)]),
 sources:[{url:'/',dir:path.join(root,'browser')},...Object.entries(modules).map(([url,rel])=>({url,file:path.join(root,'node_modules/three',rel)})),{url:'/vendor/rapier.mjs',file:path.join(root,RAPIER)}]});
// The page and the version index, rebuilt when any version changes. The page itself is always revalidated (no-cache).
let pageCache=null;
async function versionedIndex(){const {generation,files}=await assetVersions().current();if(pageCache?.generation===generation)return pageCache;
 const index=Buffer.from(JSON.stringify({files:Object.fromEntries(files)})),indexUrl='/asset-versions.json?v='+versionOf(index);
 const urlFile=new Map([['/vendor/rapier.mjs',RAPIER],...Object.entries(modules).map(([u,rel])=>[u,'node_modules/three/'+rel])]);
 const readModule=url=>readFile(path.join(root,urlFile.get(url)??'browser'+decodeURIComponent(url)),'utf8');
 const {html,importMap}=await versionedPage(await readFile(path.join(root,'browser/index.html'),'utf8'),files,{readModule,indexUrl,baseImports:{'three':'/vendor/three.module.js','three/addons/':'/vendor/addons/'}});
 const pack=body=>({body,br:zlib.brotliCompressSync(body),gzip:zlib.gzipSync(body),etag:'"'+versionOf(body)+'"'});
 return pageCache={generation,page:{...pack(Buffer.from(html)),csp:createHash('sha256').update(importMap).digest('base64')},index:{...pack(index),version:indexUrl.split('=')[1]}};}
function sendPacked(req,res,packed,headers){headers={...headers,ETag:packed.etag,'Vary':'Accept-Encoding','X-Content-Type-Options':'nosniff'};
 if(req.headers['if-none-match']===packed.etag){res.writeHead(304,headers);res.end();return;}
 const accept=req.headers['accept-encoding']??'',encoding=/\bbr\b/.test(accept)?'br':/\bgzip\b/.test(accept)?'gzip':null,body=encoding?packed[encoding]:packed.body;
 if(encoding)headers['Content-Encoding']=encoding;res.writeHead(200,{...headers,'Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);}
// frame-ancestors/base-uri: the game page is never framed (no clickjacking of its buttons) and has no <base>.
const pageCsp=hash=>`default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'; style-src 'self'; img-src 'self' data:; worker-src 'self'; connect-src 'self' wss: ws://127.0.0.1:* ws://localhost:*; frame-ancestors 'none'; base-uri 'none'`;
// Static game files (browser/, three.js vendor modules, recovered assets). Also mounted by the central service.
export function createGameHandler({brotliUpgrade=false}={}) {
 assetVersions().current().catch(()=>{}); // first scan (hashes only new or changed files) before the first visitor
 return async(req,res)=>{
  try {
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
   const url=decodeURIComponent(req.url.split('?')[0]);
   if(url.includes('..')||url.includes('\\')||url.includes('\0'))throw Error('Invalid path');
   if(url==='/vendor/basis-worker.js'){await basisWorker(req,res);return;}
   // The page with versioned URLs; if the version scan fails it is served as the plain file below.
   if(url==='/'||url==='/index.html'){const v=await versionedIndex().catch(e=>{console.warn('Asset versions unavailable:',e.message);return null;});
    if(v){sendPacked(req,res,v.page,{'Content-Type':'text/html','Cache-Control':'no-cache','Content-Security-Policy':pageCsp(v.page.csp)});return;}}
   if(url==='/asset-versions.json'){const v=await versionedIndex(),want=new URLSearchParams(req.url.split('?')[1]??'').get('v');
    sendPacked(req,res,v.index,{'Content-Type':'application/json','Cache-Control':want===v.index.version?IMMUTABLE:'no-cache'});return;}
   const rapier=url==='/vendor/rapier.mjs';
   const module=rapier?'dist/rapier.mjs':Object.hasOwn(modules,url)?modules[url]:null;
   const base=path.join(root,module?(rapier?'node_modules/@dimforge/rapier3d-compat':'node_modules/three'):'browser');
   const file=path.resolve(base,module||'.'+(url==='/'?'/index.html':url));
   const actual=await realpath(file),actualBase=await realpath(base);
   // Recovered assets may be a link to a shared copy (extra worktrees); its own real path is the second allowed root.
   const assets=module?null:await realpath(path.join(base,'assets/recovered')).catch(()=>null);
   if(!actual.startsWith(actualBase+path.sep)&&!(assets&&url.startsWith('/assets/recovered/')&&actual.startsWith(assets+path.sep)))throw Error('Outside root');
   const ext=path.extname(actual);if(!mime[ext])throw Error('Unsupported file');
   // Revalidation: without a validator, Cache-Control: no-cache made browsers download every asset (~375 MB) on each visit.
   const info=await stat(actual),etag=`"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
   const want=new URLSearchParams(req.url.split('?')[1]??'').get('v'),current=want&&sharedVersions?.version(req.url.split('?')[0],info);
   const headers={'Content-Type':mime[ext],'X-Content-Type-Options':'nosniff','Cache-Control':want&&want===current?IMMUTABLE:'no-cache','ETag':etag,'Vary':'Accept-Encoding'};
   if(req.headers['if-none-match']===etag){res.writeHead(304,headers);res.end();return;}
   const body=await encoded(actual,etag,ext,req.headers['accept-encoding']??'',brotliUpgrade);if(body.encoding)headers['Content-Encoding']=body.encoding;headers['Content-Length']=body.data.length;
   res.writeHead(200,{...headers,'Content-Security-Policy':pageCsp(importHash)});res.end(req.method==='HEAD'?undefined:body.data);
  }catch {res.writeHead(404);res.end('Not found');}
 };
}
if(process.argv[1]===fileURLToPath(import.meta.url))createServer(null,{brotliUpgrade:true}).listen(4173,'127.0.0.1',()=>console.log('Local explorer: http://127.0.0.1:4173'));
