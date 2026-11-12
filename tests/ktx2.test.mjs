import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {decodePng,flipRows,modeFor,classifyUsage} from '../tools/encode-ktx2.mjs';
import {createServer} from '../tools/serve.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {listenServer} from '../bridge/listen.mjs';

// A tiny PNG built in the test: 4x2 RGBA rows with every filter type the decoder must undo.
function makePng(width,height,channels,type,rows,filters){const crc=b=>{let c=~0;for(const x of b){c^=x;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xEDB88320:c>>>1;}return ~c>>>0;};
 const chunk=(t,d)=>{const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,'latin1'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=type;
 const stride=width*channels,raw=[];let prev=Buffer.alloc(stride);
 rows.forEach((row,y)=>{const f=filters[y],line=Buffer.alloc(stride);for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=prev[x],c=x>=channels?prev[x-channels]:0;
  const p=f===0?0:f===1?a:f===2?b:f===3?(a+b)>>1:(()=>{const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;})();line[x]=(row[x]-p)&255;}
  raw.push(Buffer.from([f]),line);prev=Buffer.from(row);});
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(raw))),chunk('IEND',Buffer.alloc(0))]);}

test('PNG decoder undoes all five row filters and expands RGB to RGBA',()=>{
 const rows=[[10,20,30,255,40,50,60,128,70,80,90,0,200,210,220,255],[1,2,3,4,250,251,252,253,5,6,7,8,9,10,11,12]];
 for(const f of [0,1,2,3,4]){const img=decodePng(makePng(4,2,4,6,rows,[f,f]));assert.deepEqual([...img.data],rows.flat(),`filter ${f}`);assert.ok(img.hasAlpha);}
 const rgb=decodePng(makePng(2,1,3,2,[[1,2,3,4,5,6]],[4]));assert.deepEqual([...rgb.data],[1,2,3,255,4,5,6,255]);assert.equal(rgb.hasAlpha,false);
});

test('rows are stored bottom-first (compressed uploads ignore flipY)',()=>{
 const img={width:1,height:3,data:Buffer.from([1,1,1,1,2,2,2,2,3,3,3,3])};assert.deepEqual([...flipRows(img).data],[3,3,3,3,2,2,2,2,1,1,1,1]);
});

test('texture usage picks the encoding mode: normal maps and data textures get UASTC, colour gets ETC1S',()=>{
 assert.equal(modeFor(new Set(['materials.m.textures._BumpMap.file'])),'normal');assert.equal(modeFor(new Set(['terrain.controlNormal.file'])),'normal');
 assert.equal(modeFor(new Set(['terrain.controlColor.file'])),'data');assert.equal(modeFor(new Set(['alpha.file'])),'data');
 assert.equal(modeFor(new Set(['materials.m.textures._MainTex.file'])),'color');assert.equal(modeFor(undefined),'color');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ktx2-usage-'));fs.mkdirSync(path.join(dir,'sub'));
 fs.writeFileSync(path.join(dir,'sub/manifest.json'),JSON.stringify({materials:{a:{textures:{_BumpMap:{file:'n.png'},_MainTex:{file:'c.png'}}}}}));
 const uses=classifyUsage(dir);assert.equal(modeFor(uses.get('sub/n.png')),'normal');assert.equal(modeFor(uses.get('sub/c.png')),'color');fs.rmSync(dir,{recursive:true});
});

test('the Basis worker is served with its own eval-allowing policy; the page policy stays strict',async()=>{
 const server=createServer();await listenServer(server);const base=`http://127.0.0.1:${server.address().port}`;
 try{const w=await fetch(base+'/vendor/basis-worker.js'),body=await w.text();assert.equal(w.status,200);assert.match(w.headers.get('content-security-policy'),/script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'/);
  assert.match(body,/_TranscoderFormat/);assert.match(body,/BASIS/);
  const page=await fetch(base+'/');const csp=page.headers.get('content-security-policy');assert.doesNotMatch(csp,/[ ]'unsafe-eval'/);assert.match(csp,/worker-src 'self';/);assert.doesNotMatch(csp,/blob:/);
  for(const m of ['loaders/KTX2Loader.js','utils/WorkerPool.js','libs/ktx-parse.module.js','libs/zstddec.module.js','libs/basis/basis_transcoder.wasm'])assert.equal((await fetch(base+'/vendor/addons/'+m)).status,200,m);
 }finally{server.close();}
});
