import test from 'node:test';import assert from 'node:assert/strict';import {hudState} from '../browser/hud.mjs';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {needsAssets} from './helpers/assets.mjs';
test('native HUD health colours and food fill use absolute health/100 and calories/3000',()=>{
 const s=hudState({health:72,calories:987,radiation:75});assert.equal(s.health,'72');assert.equal(s.calories,'987');assert.equal(s.healthFill,0.72);assert.equal(s.foodFill,0.329);assert.equal(s.healthColor,'#ffeb04','Unity Color.yellow 255,235,4');assert.equal(hudState({health:75}).healthColor,'#ffeb04');assert.equal(hudState({health:76}).healthColor,'#00ff00');assert.equal(hudState({health:40}).healthColor,'#ff0000');assert.equal(hudState({health:200,calories:-10}).healthFill,1);assert.equal(hudState({calories:-10}).foodFill,0);
});
test('native plaques respect strict thresholds, including radiation >500 rather than any exposure',()=>{
 const s=hudState({calories:500,radiation:500,poison:1});assert.equal(s.plaques.Hunger,false);assert.equal(s.plaques.Radiation,false);assert.equal(s.plaques.Poison,false);
 const t=hudState({calories:499,radiation:501,poison:2,temperature:-0.5,bleeding:3,warm:true,workbench:true,crafting:true,injured:true});assert.ok(Object.values(t.plaques).every(Boolean));assert.equal(t.foodColor,'#ff0000');
});
test('original HUD export retains atlas dimensions, glyph bounds and verified output hashes',needsAssets,()=>{
 const root=new URL('../browser/assets/recovered/hud/',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',root)));assert.equal(Object.keys(m.sprites).length,18);assert.equal(m.font.glyphs.length,190);assert.equal(Object.keys(m.plaques).length,9);assert.equal(m.font.size,12);assert.ok(m.sprites.blooddrop&&m.sprites.cell);
 const texture=Object.values(m.textures).find(t=>t.file===m.font.texture);for(const g of m.font.glyphs)assert.ok(g.x>=0&&g.y>=0&&g.x+g.width<=texture.width&&g.y+g.height<=texture.height);
 for(const [file,hash]of Object.entries(m.outputSHA256))assert.equal(createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex'),hash,file);
});
