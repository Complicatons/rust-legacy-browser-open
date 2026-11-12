import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {makeTerrain,sampleTriangle,worldToGrid} from '../browser/terrain.mjs';
import {createServer} from '../tools/serve.mjs';
import {readdir} from 'node:fs/promises';
import {listenServer} from '../bridge/listen.mjs';
import {needsAssets} from './helpers/assets.mjs';
test('coordinate reflection and upward triangle winding',()=>{
 assert.deepEqual(worldToGrid(-7999.99951171875,8000),[0,0]);
 const t=makeTerrain(new Float32Array(9),3,1);
 const [a,b,c]=t.indices.slice(0,3).map(i=>Array.from(t.positions.slice(i*3,i*3+3)));
 const normalY=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
 assert.ok(normalY>0);
});
test('walk collision uses rendered triangles rather than bilinear interpolation',()=>{
 // Unity's split: the (x,z)-(x+1,z+1) diagonal (tests/terrain-surface.test.mjs)
 const h=new Float32Array([0,0,10,0]);
 assert.equal(sampleTriangle(h,2,0.25,0.25),0);
 assert.equal(sampleTriangle(h,2,0.25,0.75),5);
 assert.equal(sampleTriangle(h,2,5,5),0);
});
test('recovered data is complete, finite and matches manifest hashes',needsAssets,async()=>{
 const base=new URL('../browser/assets/recovered/',import.meta.url),m=JSON.parse(await readFile(new URL('manifest.json',base)));
 for(const [name,hash] of Object.entries(m.outputSHA256))assert.equal(createHash('sha256').update(await readFile(new URL(name,base))).digest('hex'),hash,name);
 const b=await readFile(new URL(m.heightFile,base)),h=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 assert.equal(h.length,m.size**2);assert.ok(h.every(Number.isFinite));assert.ok(m.heightValidation.maxMetres<0.3);
 const trees=JSON.parse(await readFile(new URL('trees.json',base)));assert.equal(trees.length,29050);
 for(const p of trees)assert.ok(p.length===7&&p.every(Number.isFinite)&&p[3]>=0&&p[3]<4&&p[6]>=0&&p[6]<=0xffffffff);
 for(const l of [...m.layers,m.alpha]){const p=await readFile(new URL(l.file,base));assert.equal(p.readUInt32BE(16),l.width);assert.equal(p.readUInt32BE(20),l.height);}
 for(const model of m.models){const g=JSON.parse(await readFile(new URL(model.file,base)));assert.equal(g.normals.length,g.positions.length);for(const p of g.parts)assert.ok(p.indices.every(i=>i>=0&&i<g.positions.length/3));}
});
test('local server restricts file access and HTTP methods',async()=>{
 const server=createServer();await listenServer(server);
 try{const base=`http://127.0.0.1:${server.address().port}`;
 for(const p of ['/','/main.mjs','/vendor/three.module.js','/vendor/three.core.js','/vendor/rapier.mjs'])assert.equal((await fetch(base+p)).status,200,p);
 for(const p of ['/HANDOFF.md','/analysis/signatures.json','/node_modules/three/package.json','/%2e%2e%5cHANDOFF.md','/vendor/other.js','/vendor/rapier/LICENSE','/vendor/dist/rapier.mjs'])assert.equal((await fetch(base+p)).status,404,p);
 assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
 }finally{await new Promise(r=>server.close(r));}
});
test('the game route serves original PCM and compressed audio with correct types and bytes',needsAssets,async()=>{
 const base=new URL('../browser/assets/recovered/deployables/',import.meta.url),files=await readdir(base),server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
 try{for(const [extension,type] of [['.wav','audio/wav'],['.ogg','audio/ogg']]){const name=files.find(f=>f.endsWith(extension));assert.ok(name);const r=await fetch(origin+'/assets/recovered/deployables/'+name);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),type);assert.deepEqual(Buffer.from(await r.arrayBuffer()),await readFile(new URL(name,base)));}}
 finally{await new Promise(r=>server.close(r));}
});
