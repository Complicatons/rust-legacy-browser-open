// Island map hover labels (site/js/map-hover.mjs): what the label next to the cursor says.
import test from 'node:test';
import assert from 'node:assert/strict';
import {hoverLabel,areaAt} from '../site/js/map-hover.mjs';

const places=[{id:'smoke',title:'Smokestack Compound',kind:'smokestack',x:5000,z:3000,rad:1000,features:['Smokestack','Sheds']},{id:'barn',title:'Barn',kind:'barn',x:6000,z:4000}];

test('the area is the nearest place within 200 m', ()=>{
 assert.equal(areaAt(places,5100,3050)?.title,'Smokestack Compound');
 assert.equal(areaAt(places,5990,4010)?.title,'Barn');
 assert.equal(areaAt(places,5500,3500),null,'open country has no area');
});

test('a crate spot reads as a loot crate with its odds and the area', ()=>{
 const crate={type:'crate',x:5020,z:3010,respawn:[10,20],crates:[{name:'Box Loot',chance:.545},{name:'Ammo Loot Box',chance:.182},{name:'Weapon Loot Box',chance:.091}]};
 assert.deepEqual(hoverLabel(crate,places),{title:'Loot crate',lines:['Box 55% · Ammo 18% · Weapon 9%','Smokestack Compound']});
});

test('zones name what they are and what is in them', ()=>{
 assert.deepEqual(hoverLabel({type:'rad',x:5000,z:3000,r:100,exposure:1000},places),{title:'Radiation zone',lines:['1000 rad/min','Smokestack Compound']});
 assert.deepEqual(hoverLabel({type:'mutant',x:5500,z:3500,r:100,animals:[{name:'Mutant Bear',count:3},{name:'Mutant Wolf',count:3}],resources:[]},places),
  {title:'Mutant zone',lines:['Mutant Bear ×3 · Mutant Wolf ×3']});
 assert.deepEqual(hoverLabel({type:'animals',x:5500,z:3500,r:250,animals:[{name:'Boar',count:4},{name:'Wolf',count:4}],resources:[{name:'Wood Pile',count:8}]},places),
  {title:'Wildlife zone',lines:['Boar ×4 · Wolf ×4']});
 assert.deepEqual(hoverLabel({type:'resources',x:5500,z:3500,r:100,animals:[],resources:[{name:'Wood Pile',count:3},{name:'Ore 1',count:2}]},places),
  {title:'Resource zone',lines:['Wood Pile ×3 · Ore 1 ×2']});
 assert.deepEqual(hoverLabel({type:'nobuild',x:5990,z:4000,r:24.3},places),{title:'No-build zone',lines:['Nothing can be placed here','Barn']});
});

test('a place marker shows its name, what is there and its radiation', ()=>{
 assert.deepEqual(hoverLabel({type:'place',...places[0]},places),{title:'Smokestack Compound',lines:['Smokestack · Sheds','1000 rad/min']});
 assert.deepEqual(hoverLabel({type:'place',...places[1]},places),{title:'Barn',lines:[]});
 assert.deepEqual(hoverLabel({type:'place',title:'Barn',x:0,z:0,features:['Barn']},places),{title:'Barn',lines:[]},'no line repeating the name');
 assert.deepEqual(hoverLabel({type:'place',title:'Hangar',x:0,z:0,features:['Hangar','Sheds']},places),{title:'Hangar',lines:['Sheds']});
});

test('plain ground shows the area name, or nothing in open country', ()=>{
 assert.deepEqual(hoverLabel({type:'point',x:5050,z:3000},places),{title:'Smokestack Compound',lines:[]});
 assert.equal(hoverLabel({type:'point',x:5500,z:3500},places),null);
 assert.equal(hoverLabel(null,places),null);
});
