import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cellState,armorRows} from '../browser/rpos.mjs';
import {needsAssets} from './helpers/assets.mjs';
test('RPOS stack labels suppress single stacks and show native x prefix',()=>{
 const d={_splittable:true};assert.equal(cellState(d,{uses:1}).label,'');assert.equal(cellState(d,{uses:7}).label,'x7');assert.equal(cellState(d,{uses:7}).color,'white');assert.equal(cellState(d,null).label,'');
});
test('RPOS non-stack uses follow minimum-display threshold and yellow labels',()=>{
 assert.equal(cellState({_maxUses:12,_minUsesForDisplay:1},{uses:7}).label,'7');assert.equal(cellState({_maxUses:12},{uses:0}).color,'yellow');
 assert.equal(cellState({_maxUses:1,_minUsesForDisplay:1},{uses:1}).label,'');
});
test('RPOS icon condition bands and installed/free mod dots use native limits',()=>{
 const state=condition=>cellState({}, {uses:1,condition,maxCondition:1,totalModSlots:5,mods:[1,2]});
 assert.equal(state(0).tint,'red');assert.equal(state(0.4).tint,'yellow');assert.equal(state(0.40001).tint,'white');assert.deepEqual(state(1).mods,[true,true,false,false,false]);
 assert.equal(cellState({}, {totalModSlots:9,mods:[]}).mods.length,5);assert.equal(cellState({}, {uses:1}).tint,'white');
});
test('armor window sums equipped items only, omits zeros and truncates native integer output',()=>{
 const slots=[];slots[0]={item:'a'};slots[36]={item:'a'};slots[39]={item:'b'};const items={a:{data:{armorValues:{damageArray:[0,10.6,1,0,0,0]}}},b:{data:{armorValues:{damageArray:[0,2.5,0,0,5,1]}}}};
 assert.deepEqual(armorRows(slots,items),[{name:'Bullet',value:13},{name:'Melee',value:1},{name:'Radiation',value:5},{name:'Cold',value:1}]);
});
test('recovered RPOS windows retain source inventory, loot and armor grids',needsAssets,()=>{
 const x=JSON.parse(readFileSync(new URL('../browser/assets/recovered/rpos/layout.json',import.meta.url)));
 assert.equal(Object.keys(x.windows).length,6);const grid=x.windows.InventoryPanel.nodes.flatMap(n=>n.components.RPOSInvCellManager??[])[0];
 assert.deepEqual([grid.NumCellsHorizontal,grid.NumCellsVertical,grid.CellSize,grid.CellSpacing],[6,5,64,10]);
 const armor=x.windows.ArmorPanel.nodes.flatMap(n=>n.components.RPOSInventoryCell??[]);assert.equal(armor.length,4);
});
