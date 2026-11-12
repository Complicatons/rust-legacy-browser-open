// Encode the recovered PNG textures to KTX2 (Basis Universal) next to each PNG, plus browser/assets/recovered/ktx2.json.
// The browser loads a .ktx2 when the GPU supports it and falls back to the PNG otherwise (browser/texture-source.mjs).
// Rules: power-of-two textures only (WebGL compressed formats need 4-multiples at every mip); mipmaps generated;
// rows flipped bottom-first because compressed uploads ignore flipY (the PNGs rely on flipY=true to restore Unity's
// row order). Normal maps and data textures (control/splat/alpha/mask) use UASTC; colour textures use ETC1S.
// Incremental: a PNG is re-encoded only when its SHA-256 changes. Usage: node tools/encode-ktx2.mjs [--force] [--only dir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {encodeToKTX2} from 'ktx2-encoder';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../browser/assets/recovered');
const args=process.argv.slice(2),force=args.includes('--force'),only=args.includes('--only')?args[args.indexOf('--only')+1]:null;

// Minimal PNG decoder (8-bit, non-interlaced; grey, grey+alpha, RGB, RGBA, palette) to RGBA rows.
export function decodePng(buf){
 if(buf.readUInt32BE(0)!==0x89504e47)throw Error('not a PNG');let p=8,w=0,h=0,depth=0,type=0,interlace=0,palette=null,trns=null;const idat=[];
 while(p<buf.length){const len=buf.readUInt32BE(p),t=buf.toString('latin1',p+4,p+8),d=buf.subarray(p+8,p+8+len);p+=12+len;
  if(t==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);depth=d[8];type=d[9];interlace=d[12];}else if(t==='PLTE')palette=d;else if(t==='tRNS')trns=d;else if(t==='IDAT')idat.push(d);else if(t==='IEND')break;}
 if(depth!==8||interlace)throw Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
 const channels={0:1,2:3,3:1,4:2,6:4}[type];if(!channels)throw Error('unsupported colour type '+type);
 const raw=zlib.inflateSync(Buffer.concat(idat)),stride=w*channels,out=Buffer.alloc(w*h*4),prev=Buffer.alloc(stride),cur=Buffer.alloc(stride);
 for(let y=0;y<h;y++){const f=raw[y*(stride+1)],line=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
  for(let x=0;x<stride;x++){const a=x>=channels?cur[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;let v=line[x];
   if(f===1)v+=a;else if(f===2)v+=b;else if(f===3)v+=(a+b)>>1;else if(f===4){const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}cur[x]=v&255;}
  for(let x=0;x<w;x++){const o=(y*w+x)*4,i=x*channels;
   if(type===6){out[o]=cur[i];out[o+1]=cur[i+1];out[o+2]=cur[i+2];out[o+3]=cur[i+3];}
   else if(type===2){out[o]=cur[i];out[o+1]=cur[i+1];out[o+2]=cur[i+2];out[o+3]=255;}
   else if(type===0){out[o]=out[o+1]=out[o+2]=cur[i];out[o+3]=255;}
   else if(type===4){out[o]=out[o+1]=out[o+2]=cur[i];out[o+3]=cur[i+1];}
   else {const k=cur[i];out[o]=palette[k*3];out[o+1]=palette[k*3+1];out[o+2]=palette[k*3+2];out[o+3]=trns&&k<trns.length?trns[k]:255;}}
  cur.copy(prev);}
 return {width:w,height:h,data:out,hasAlpha:type===4||type===6||Boolean(trns)};}
export const flipRows=(img)=>{const row=img.width*4,out=Buffer.alloc(img.data.length);for(let y=0;y<img.height;y++)img.data.copy(out,(img.height-1-y)*row,y*row,(y+1)*row);return {...img,data:out};};
const pow2=n=>n>=4&&(n&(n-1))===0;

// How each PNG is used, from the key it sits under in any recovered JSON (e.g. textures._BumpMap.file, controlNormal.file).
export function classifyUsage(rootDir){const uses=new Map();
 const visit=(v,keys,dir)=>{if(Array.isArray(v)){v.forEach(x=>visit(x,keys,dir));return;}if(!v||typeof v!=='object')return;
  for(const [k,x] of Object.entries(v)){if(typeof x==='string'&&x.endsWith('.png')){const rel=path.relative(rootDir,path.join(dir,x)).split(path.sep).join('/');if(!uses.has(rel))uses.set(rel,new Set());uses.get(rel).add([...keys,k].join('.'));}else visit(x,[...keys,k],dir);}};
 const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.json')&&fs.statSync(p).size<200e6){try{visit(JSON.parse(fs.readFileSync(p,'utf8')),[],dir);}catch{}}}};
 walk(rootDir);return uses;}
export function modeFor(keys){const k=[...(keys??[])].join(' ');if(/bump|normal/i.test(k))return 'normal';if(/control|splat|alpha\b|\.alpha|mask|noise|height/i.test(k))return 'data';return 'color';}

// One texture: decode, check, flip, encode. Runs inside a worker (each has its own WASM encoder instance).
export async function encodeOne(file,mode){const buf=fs.readFileSync(file);let img;try{img=decodePng(buf);}catch(e){return {skip:e.message};}
 if(!pow2(img.width)||!pow2(img.height))return {skip:`not power of two (${img.width}x${img.height})`};
 const flipped=flipRows(img);
 const options={isUASTC:mode!=='color',isNormalMap:mode==='normal',isPerceptual:mode==='color',generateMipmap:true,needSupercompression:true,qualityLevel:192,compressionLevel:2,uastcLDRQualityLevel:2,enableRDO:mode!=='data',rdoQualityLevel:1,
  imageDecoder:async()=>({width:flipped.width,height:flipped.height,data:new Uint8Array(flipped.data.buffer,flipped.data.byteOffset,flipped.data.length)})};
 const ktx=await encodeToKTX2(new Uint8Array(buf),options);return {ktx,width:img.width,height:img.height,alpha:img.hasAlpha,pngBytes:buf.length};}

async function main(){
 const uses=classifyUsage(root),indexFile=path.join(root,'ktx2.json'),index=fs.existsSync(indexFile)&&!force?JSON.parse(fs.readFileSync(indexFile,'utf8')):{files:{}};
 const pngs=[];const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.png'))pngs.push(p);}};walk(only?path.join(root,only):root);
 const jobs=[];let unchanged=0;
 for(const file of pngs){const rel=path.relative(root,file).split(path.sep).join('/'),sha=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),out=file.replace(/.png$/,'.ktx2');
  if(index.files[rel]?.sha===sha&&(index.files[rel].skip||fs.existsSync(out))){unchanged++;continue;}jobs.push({file,rel,sha,out,mode:modeFor(uses.get(rel))});}
 // Largest first so the long encodes overlap; leave half the cores for everything else on the machine.
 jobs.sort((a,b)=>fs.statSync(b.file).size-fs.statSync(a.file).size);
 const threads=Math.max(1,Math.min(jobs.length,Number(process.env.KTX2_THREADS)||Math.min(12,Math.floor(os.cpus().length/2))));
 console.log(`${jobs.length} to encode, ${unchanged} unchanged, ${threads} workers`);
 let done=0,saved=0;const started=Date.now(),queue=[...jobs];
 await Promise.all(Array.from({length:threads},()=>new Promise((resolve,reject)=>{const w=new Worker(fileURLToPath(import.meta.url),{workerData:{worker:true},stdout:true,stderr:true});
  w.stdout.resume();w.stderr.resume(); // the Basis encoder logs every slice; drop it
  const next=()=>{const job=queue.shift();if(!job){w.terminate();resolve();return;}w.job=job;w.postMessage({file:job.file,mode:job.mode});};
  w.on('message',r=>{const job=w.job;if(r.error){index.files[job.rel]={sha:job.sha,skip:'encode failed: '+r.error};}
   else if(r.skip)index.files[job.rel]={sha:job.sha,skip:r.skip};
   else {fs.writeFileSync(job.out,Buffer.from(r.ktx));index.files[job.rel]={sha:job.sha,ktx2:job.rel.replace(/.png$/,'.ktx2'),mode:job.mode,width:r.width,height:r.height,alpha:r.alpha,pngBytes:r.pngBytes,ktx2Bytes:r.ktx.byteLength};saved+=r.pngBytes-r.ktx.byteLength;}
   done++;fs.writeFileSync(indexFile,JSON.stringify(index));
   if(done%10===0||done===jobs.length)console.log(`${done}/${jobs.length} done, ${((Date.now()-started)/1000).toFixed(0)} s, ${(saved/1048576).toFixed(1)} MB saved`);next();});
  w.on('error',reject);next();})));
 const all=Object.values(index.files),enc=all.filter(f=>f.ktx2);index.summary={textures:enc.length,skipped:all.length-enc.length,pngBytes:enc.reduce((a,f)=>a+f.pngBytes,0),ktx2Bytes:enc.reduce((a,f)=>a+f.ktx2Bytes,0),
  byMode:Object.fromEntries(['color','normal','data'].map(m=>[m,enc.filter(f=>f.mode===m).length]))};
 fs.writeFileSync(indexFile,JSON.stringify(index));console.log(JSON.stringify(index.summary));}
if(!isMainThread&&workerData?.worker)parentPort.on('message',async({file,mode})=>{try{const r=await encodeOne(file,mode);if(r.ktx)r.ktx=new Uint8Array(r.ktx);parentPort.postMessage(r,r.ktx?[r.ktx.buffer]:[]);}catch(e){parentPort.postMessage({error:String(e?.message??e)});}});
if(isMainThread&&process.argv[1]===fileURLToPath(import.meta.url))await main();
