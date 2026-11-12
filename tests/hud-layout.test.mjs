import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {statusLayout,labelBox} from '../browser/hud.mjs';import {cellState} from '../browser/rpos.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const hud=hasRecovered?(JSON.parse(readFileSync(new URL('../browser/assets/recovered/hud/manifest.json',import.meta.url)))):null;
test('StatusPanel boxes come from the exported NGUI locals; STATUS title is inactive in the source',needsAssets,()=>{
 const L=statusLayout(hud.status);assert.deepEqual(L.origin,{right:5,bottom:hud.status[0].position.y});
 assert.deepEqual(L.background,{left:-130,top:-49,width:140,height:69});assert.equal(L.statusTitle.active,false);
 assert.deepEqual(L.bars.health.background,{left:-73.30624389648438,top:-37.720428466796875,width:54,height:14});assert.deepEqual(L.bars.health.foreground.width,50);
 assert.equal(L.bars.health.foreground.left-L.bars.health.background.left,2);assert.equal(L.bars.food.background.top,-24);
 assert.deepEqual([L.titles.health.x,L.titles.health.y,L.titles.health.pivot],[-115,-37,0]);assert.deepEqual([L.values.health.x,L.values.health.pivot],[-43.5,4]);
 // Titles use the plain ProFont; values the outlined ProFont.
 assert.ok(hud.cellFont.source.endsWith(':'+L.titles.health.font));assert.ok(hud.font.source.endsWith(':'+L.values.health.font));
 assert.deepEqual(labelBox(L.titles.health,36,12),{left:-118,top:-37});assert.deepEqual(labelBox(L.values.health,18,12),{left:-55.5,top:-38});
});
test('RPOS condition tint clamps to maxcondition and treats saves without it as a fresh 1/1 item',()=>{
 assert.equal(cellState({},{uses:1,condition:100}).tint,'white');assert.equal(cellState({},{uses:1,condition:0.3}).tint,'yellow');assert.equal(cellState({},{uses:1,condition:0}).tint,'red');
 assert.equal(cellState({},{uses:1,condition:0.25,maxCondition:0.7}).tint,'yellow');assert.equal(cellState({},{uses:1,condition:0.3,maxCondition:0.5}).tint,'white');
});
