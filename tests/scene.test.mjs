import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const base=new URL('../browser/assets/recovered/scene/',import.meta.url);
const manifest=hasRecovered?(JSON.parse(await readFile(new URL('manifest.json',base)))):null;
async function array(desc,Type){const b=await readFile(new URL(desc.file,base));assert.equal(b.length,desc.count*4);return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
test('scene buffers are finite, indexed correctly and preserve source hashes',needsAssets,async()=>{
 for(const [file,hash] of Object.entries(manifest.outputSHA256))assert.equal(createHash('sha256').update(await readFile(new URL(file,base))).digest('hex'),hash,file);
 for(const m of Object.values(manifest.meshes)){
  const p=await array(m.position,Float32Array);assert.ok(p.length%3===0&&p.every(Number.isFinite));
  if(m.normal)assert.equal(m.normal.count,m.position.count);
  if(m.uv)assert.equal(m.uv.count,m.position.count/3*2);
  for(const part of m.parts){const ids=await array(part,Uint32Array);assert.ok(ids.length%3===0&&ids.every(i=>i<p.length/3));}
 }
});
test('original static-batched buildings retain world coordinates and only assigned subsets',needsAssets,()=>{
 // Client scene: 8,739 enabled renderers (server copy: 458); 443 inactive/disabled are recorded separately.
 assert.equal(manifest.instances.length,8739);assert.equal(manifest.visualSource,'client scenes.unity3d');assert.deepEqual(manifest.skipped,[]);
 const warehouse=manifest.instances.find(i=>i.name==='Warehouse1');assert.ok(warehouse.staticBatch);
 assert.deepEqual(warehouse.sourceWorldPosition,[5211.60693359375,368.1206970214844,4788.9013671875]);
 const [lo,hi]=warehouse.worldBounds;
 for(let axis=0;axis<3;axis++)assert.ok(warehouse.sourceWorldPosition[axis]>=lo[axis]-20&&warehouse.sourceWorldPosition[axis]<=hi[axis]+20);
 assert.deepEqual(warehouse.matrix,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 for(const i of manifest.instances){assert.equal(i.subsets.length,i.materials.length);assert.ok(i.matrix.every(Number.isFinite));for(const subset of i.subsets)assert.ok(subset>=0&&subset<manifest.meshes[i.mesh].parts.length);}
});
test('collision export uses original collision meshes and records unavailable shapes',needsAssets,()=>{
 assert.ok(manifest.colliders.length>300);
 for(const c of manifest.colliders){assert.ok(c.matrix.length===16&&c.matrix.every(Number.isFinite));if(c.type==='MeshCollider')assert.ok(manifest.meshes[c.mesh]);if(c.type==='BoxCollider')assert.ok(c.size.every(v=>v>0));}
 assert.ok(manifest.collisionOmissions.every(c=>c.reason==='Null original collision mesh; no visual-mesh substitution'));
});
