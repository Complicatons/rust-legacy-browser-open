import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from '../tools/serve.mjs';
import {versionOf,staticImports,versionedPage,writeFileAtomic} from '../tools/asset-versions.mjs';
import {listenServer} from '../bridge/listen.mjs';
import {mkdtemp,readFile,readdir,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// The quality-11 brotli copies (os.tmpdir()/rlb-brotli-q11) and the asset-version cache are shared by every server on
// the machine; serve-cache read a half-written main.mjs.br while central-launcher's server was writing it. A plain
// writeFile showed a reader in a loop a partial file on every read (42 of 42); the atomic write shows old or new, whole.
test('cache files are replaced whole: written aside, renamed into place, retried while a reader holds the file', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-atomic-')),file=path.join(dir,'x.br'),size=1<<20;
 try{
  await writeFileAtomic(file,Buffer.alloc(size,1));
  assert.deepEqual(await readdir(dir),['x.br']);assert.equal((await readFile(file))[size-1],1);
  if(process.platform==='win32'){
   // Windows refuses the rename while the file is open. The old file stays whole meanwhile; the write lands once the
   // reader closes it.
   let h=await open(file,'r');const p=writeFileAtomic(file,Buffer.alloc(size,2));
   await new Promise(r=>setTimeout(r,30));
   const during=await readFile(file);assert.equal(during.length,size);assert.ok(during.every(b=>b===1),'the old file, whole');
   await h.close();await p;
   const after=await readFile(file);assert.equal(after.length,size);assert.ok(after.every(b=>b===2),'the new file, whole');
   // A reader that never lets go: the write gives up (best-effort cache) and leaves no temporary file behind.
   h=await open(file,'r');
   try{await assert.rejects(writeFileAtomic(file,Buffer.alloc(size,3)),{code:'EPERM'});}finally{await h.close();}
   assert.ok((await readFile(file)).every(b=>b===2));
  }
  assert.deepEqual(await readdir(dir),['x.br'],'no temporary files left');
 }finally{await rm(dir,{recursive:true,force:true});}
});

const get=(port,path,headers={})=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject));

test('game files revalidate with ETags and compressible files are sent compressed',async()=>{
 const server=createServer();await listenServer(server);const {port}=server.address();
 try{
  const plain=await get(port,'/main.mjs');assert.equal(plain.status,200);assert.ok(plain.headers.etag);assert.equal(plain.headers['content-encoding'],undefined);
  assert.equal((await get(port,'/main.mjs',{'if-none-match':plain.headers.etag})).status,304,'unchanged files are not sent again');
  const br=await get(port,'/main.mjs',{'accept-encoding':'gzip, deflate, br'});assert.equal(br.headers['content-encoding'],'br');assert.ok(br.body.length<plain.body.length/2);
  assert.deepEqual(zlib.brotliDecompressSync(br.body),plain.body,'compressed bytes decode to the original file');
  const gz=await get(port,'/main.mjs',{'accept-encoding':'gzip'});assert.equal(gz.headers['content-encoding'],'gzip');assert.deepEqual(zlib.gunzipSync(gz.body),plain.body);
  assert.match(br.headers.vary,/Accept-Encoding/);
 }finally{server.close();}
});

test('the page carries versioned URLs, and only the current version of a file is answered immutable',async()=>{
 const server=createServer();await listenServer(server);const {port}=server.address();
 try{
  const page=await get(port,'/');assert.equal(page.status,200);assert.equal(page.headers['cache-control'],'no-cache');const html=page.body.toString();
  const map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)[1]).imports;
  const main=readFileSync(new URL('../browser/main.mjs',import.meta.url)),mainVersion=versionOf(main);
  assert.ok(html.includes(`<script type="module" src="/main.mjs?v=${mainVersion}">`),'entry script versioned by its content');
  assert.equal(map['/terrain.mjs'],'/terrain.mjs?v='+versionOf(readFileSync(new URL('../browser/terrain.mjs',import.meta.url))));
  assert.equal(map.three,map['/vendor/three.module.js'],'bare and URL imports of three share one module');assert.match(map['three/addons/math/Capsule.js'],/^\/vendor\/addons\/math\/Capsule\.js\?v=/);
  assert.ok(html.includes(`<link rel="modulepreload" href="${map['/terrain.mjs']}">`),'static imports preloaded');assert.ok(!html.includes('modulepreload" href="/main.mjs'),'the entry itself is not preloaded');
  assert.ok(!/modulepreload" href="\/vendor\/rapier/.test(html),'dynamic imports are not preloaded');
  assert.ok(html.indexOf('<script type="importmap">')<html.indexOf('modulepreload')&&html.indexOf('modulepreload')<html.indexOf('</head>'),'the import map is parsed before any preload (cached preloads resolve at once)');
  assert.equal(html.split('<script type="importmap">').length,2,'one import map');
  const importMap=html.match(/<script type="importmap">(.*?)<\/script>/)[1];
  assert.ok(page.headers['content-security-policy'].includes(`'sha256-${createHash('sha256').update(importMap).digest('base64')}'`),'CSP allows exactly this import map');
  assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'; base-uri 'none'/,'the game page is never framed');
  assert.equal((await get(port,'/',{'if-none-match':page.headers.etag})).status,304);
  const indexUrl=html.match(/<meta name="rlb-asset-versions" content="([^"]+)">/)[1],index=await get(port,indexUrl);
  assert.equal(index.headers['cache-control'],'public, max-age=31536000, immutable');assert.equal(JSON.parse(index.body).files['/main.mjs'],mainVersion);
  assert.equal((await get(port,'/main.mjs?v='+mainVersion)).headers['cache-control'],'public, max-age=31536000, immutable');
  assert.equal((await get(port,'/main.mjs?v=0000000000000000')).headers['cache-control'],'no-cache','an old version is not cached forever');
  assert.equal((await get(port,'/main.mjs')).headers['cache-control'],'no-cache');
  const worker=await get(port,'/vendor/basis-worker.js');assert.equal(worker.status,200);assert.ok(worker.headers.etag,'the Basis worker revalidates instead of downloading again');
  assert.match(worker.headers['content-security-policy'],/'unsafe-eval'/);assert.equal((await get(port,'/vendor/basis-worker.js',{'if-none-match':worker.headers.etag})).status,304);
 }finally{server.close();}
});

test('static import scan and versioned page rewriting',async()=>{
 assert.deepEqual(staticImports("import * as T from 'three';\nimport {a,\n b} from './a.mjs';import './side.mjs';export {c} from \"../c.mjs\";\nconst m=await import('./lazy.mjs');"),['three','./a.mjs','./side.mjs','../c.mjs']);
 const files=new Map([['/main.mjs','m1'],['/a.mjs','a1'],['/b.mjs','b1'],['/style.css','s1'],['/vendor/three.module.js','t1']]);
 const sources={'/main.mjs':"import './a.mjs';import * as THREE from 'three';",'/a.mjs':"import {x} from '/b.mjs';",'/b.mjs':'','/vendor/three.module.js':''};
 const {html,importMap}=await versionedPage('<html><head><link rel="stylesheet" href="/style.css"><link href="/missing.css"></head><body><script type="importmap">{}</script><script type="module" src="/main.mjs"></script></body></html>',files,
  {readModule:async u=>sources[u],indexUrl:'/asset-versions.json?v=i1',baseImports:{'three':'/vendor/three.module.js','three/addons/':'/vendor/addons/'}});
 const map=JSON.parse(importMap).imports;assert.equal(map.three,'/vendor/three.module.js?v=t1');assert.equal(map['/a.mjs'],'/a.mjs?v=a1');assert.equal(map['three/addons/'],'/vendor/addons/');
 assert.ok(html.includes('href="/style.css?v=s1"')&&html.includes('href="/missing.css"')&&html.includes('src="/main.mjs?v=m1"'));
 assert.deepEqual([...html.matchAll(/modulepreload" href="([^"]+)"/g)].map(m=>m[1]).sort(),['/a.mjs?v=a1','/b.mjs?v=b1','/vendor/three.module.js?v=t1']);
 assert.ok(html.includes('<meta name="rlb-asset-versions" content="/asset-versions.json?v=i1">'));
});
