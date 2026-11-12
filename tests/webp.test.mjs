import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';

const base=new URL('../browser/assets/recovered/',import.meta.url);
const index=hasRecovered?(JSON.parse(await readFile(new URL('webp.json',base))).files):null,ktx2=hasRecovered?(JSON.parse(await readFile(new URL('ktx2.json',base))).files):null;

// The menu background loads before the KTX2 transcoder exists, so its PNGs get WebP copies too (tools/encode-webp.py).
test('lossless WebP copies are current, smaller, and only for PNGs without a KTX2 version or loaded before the renderer',needsAssets,async()=>{
 const kept=Object.entries(index).filter(([,e])=>e.webp);assert.ok(kept.length>=3,'the three 4096x4096 maps at least');
 for(const [png,e] of kept){
  const bytes=await readFile(new URL(png,base));assert.equal(createHash('sha256').update(bytes).digest('hex'),e.sha,`${png}: index matches the PNG (rerun tools/encode-webp.py)`);
  assert.ok(!ktx2[png]?.ktx2||png.startsWith('menu-background/'),`${png} already has a KTX2`);
  const w=await stat(new URL(e.webp,base));assert.equal(w.size,e.webpBytes);assert.ok(w.size<bytes.length*0.95,png);
  assert.equal((await readFile(new URL(e.webp,base))).toString('latin1',0,4),'RIFF');}
 for(const png of ['scene/texture-318e80645b6688ba3bc9.png','scene/texture-8aa1cde503d89bb59509.png','texture--180453854.png','menu-background/texture-dab05924077c6624a132.png'])assert.ok(index[png]?.webp,png);
});
