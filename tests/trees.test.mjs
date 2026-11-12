import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ORIGINAL_TREE_SETTINGS,treeSettings,classifyTreeDistance,squashAmount,selectFullTrees,unpackColor,billboardHalfSize} from '../browser/trees.mjs';
import {needsAssets} from './helpers/assets.mjs';

const S=ORIGINAL_TREE_SETTINGS;

test('original TerrainControl tree settings are the fallback and the exported effective values win',()=>{
 assert.deepEqual({...S},{treeDistance:2000,treeBillboardDistance:214,treeCrossFadeLength:5,treeMaximumFullLODCount:60});
 assert.deepEqual(treeSettings({}),{...S});
 assert.deepEqual(treeSettings({treeRendering:{effective:{treeDistance:800,treeBillboardDistance:100,treeCrossFadeLength:40,treeMaximumFullLODCount:30,detailObjectDistance:75}}}),{treeDistance:800,treeBillboardDistance:100,treeCrossFadeLength:40,treeMaximumFullLODCount:30});
});

test('distance classes: mesh candidate, billboard from the billboard distance, nothing beyond tree distance',()=>{
 assert.equal(classifyTreeDistance(0,S),'mesh');
 assert.equal(classifyTreeDistance(213.99,S),'mesh');
 assert.equal(classifyTreeDistance(214,S),'billboard');
 assert.equal(classifyTreeDistance(2000,S),'billboard');
 assert.equal(classifyTreeDistance(2000.01,S),'none');
});

test('cross-fade squashes a mesh tree flat over the last crossFade metres before the billboard distance',()=>{
 assert.equal(squashAmount(10,S),1);
 assert.equal(squashAmount(209,S),1);
 assert.ok(Math.abs(squashAmount(211.5,S)-0.5)<1e-9);
 assert.equal(squashAmount(214,S),0);
 assert.equal(squashAmount(500,S),0);
 // Zero-length fade switches at the billboard distance.
 const hard={...S,treeCrossFadeLength:0};assert.equal(squashAmount(213,hard),1);assert.equal(squashAmount(214,hard),0);
 // Monotonic non-increasing with distance.
 let prev=1;for(let d=200;d<=220;d+=0.25){const v=squashAmount(d,S);assert.ok(v<=prev+1e-12&&v>=0&&v<=1);prev=v;}
});

test('only the nearest treeMaximumFullLODCount trees inside the billboard distance are meshes',()=>{
 const candidates=[];for(let i=0;i<100;i++)candidates.push({index:i,distance:(i*37)%200});
 candidates.push({index:500,distance:250}); // beyond the billboard distance: never a mesh candidate
 const {full,overflow}=selectFullTrees(candidates,S);
 assert.equal(full.length,60);assert.equal(overflow.length,40);
 const fullDist=full.map(f=>f.distance),maxFull=Math.max(...fullDist),minOver=Math.min(...overflow.map(i=>candidates.find(c=>c.index===i).distance));
 assert.ok(maxFull<=minOver,'every mesh tree is at least as near as every overflow billboard');
 for(let i=1;i<full.length;i++)assert.ok(full[i].distance>=full[i-1].distance);
 assert.ok(!full.some(f=>f.index===500)&&!overflow.includes(500));
 for(const f of full)assert.equal(f.squash,squashAmount(f.distance,S));
});

test('cap edge cases: fewer candidates than the cap, zero cap, deterministic ties',()=>{
 const few=[{index:3,distance:50},{index:1,distance:10}];
 assert.deepEqual(selectFullTrees(few,S).full.map(f=>f.index),[1,3]);
 assert.deepEqual(selectFullTrees(few,S).overflow,[]);
 const none=selectFullTrees(few,{...S,treeMaximumFullLODCount:0});assert.equal(none.full.length,0);assert.deepEqual(none.overflow.sort(),[1,3]);
 const ties=[{index:9,distance:20},{index:2,distance:20},{index:5,distance:20}];
 assert.deepEqual(selectFullTrees(ties,{...S,treeMaximumFullLODCount:2}).full.map(f=>f.index),[2,5]);
});

test('Unity ColorRGBA32 tree colours unpack r|g<<8|b<<16|a<<24',()=>{
 assert.deepEqual(unpackColor(4294967295),[1,1,1,1]);
 const [r,g,b,a]=unpackColor(0xff102030);assert.equal(r,0x30/255);assert.equal(g,0x20/255);assert.equal(b,0x10/255);assert.equal(a,1);
});

test('billboard frame tilts its height towards the width when looking down',()=>{
 assert.deepEqual(billboardHalfSize(8,20,0),[8,20]);
 const [w,h]=billboardHalfSize(8,20,-1);assert.equal(w,8);assert.ok(Math.abs(h-8)<1e-9);
 const [,h45]=billboardHalfSize(8,20,Math.SQRT1_2);assert.ok(Math.abs(h45-(20+8)*Math.SQRT1_2)<1e-9);
});

test('exported manifest records the original terrain tree settings with source IDs',needsAssets,async(t)=>{
 let m;try{m=JSON.parse(await readFile(new URL('../browser/assets/recovered/manifest.json',import.meta.url)));}catch{t.skip('recovered assets not present');return;}
 if(!m.treeRendering){t.skip('manifest predates the tree settings export');return;}
 const r=m.treeRendering;
 assert.equal(r.source.terrainComponent,5405);assert.equal(r.source.terrainControl,5393);
 assert.deepEqual(r.serializedTerrain.treeBillboardDistance,171);assert.equal(r.serializedTerrain.treeMaximumFullLODCount,25);
 assert.deepEqual(treeSettings(m),{...S});
 assert.equal(r.treePrototypes.length,4);for(const p of r.treePrototypes)assert.equal(p.bendFactor,0);
 assert.equal(r.detail.prototypes.length,2);assert.ok(r.detail.prototypes.every(p=>p.usePrototypeMesh===1));
 for(const model of m.models){assert.ok(model.bounds&&model.bounds.extent.every(v=>v>0));}
});
