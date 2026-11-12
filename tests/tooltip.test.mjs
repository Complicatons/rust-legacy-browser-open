import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {itemTooltip,itemTitle,conditionString,fmtFloat} from '../browser/tooltip.mjs';
import {hasRecovered,needsAssets} from './helpers/assets.mjs';
const catalogue=hasRecovered?(JSON.parse(await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)))):null;
const item=name=>Object.values(catalogue.items).find(i=>i.data.m_Name===name);
const text=rows=>rows.map(r=>r.kind==='progress'?`${r.text} ${r.amount}`:r.kind==='stat'?`${r.text} ${r.value}`:r.text);

test('tooltips follow the original PopulateInfoWindow overrides',needsAssets, ()=>{
 assert.deepEqual(text(itemTooltip(item('Chocolate Bar'))),['Chocolate Bar','Consumable','350 Calories','+8 Health',
  'This is a food item, eating it will satisfy some of your hunger. It will also provide minor healing']);
 const m4=itemTooltip(item('M4'),{condition:0.55});
 assert.deepEqual(text(m4),['M4','Condition : 55/100','Weapon Stats','Fire Rate 8','Damage 35','Recoil 8','Range 140','This is a weapon. Drag it to your belt (right side of screen) and press the corresponding number key to use it.']);
 assert.equal(m4[1].color,'yellow');assert.equal(m4.find(r=>r.text==='Damage').fraction,0.35);
 const vest=text(itemTooltip(item('Cloth Vest'),{condition:0.9}));
 assert.deepEqual(vest.slice(0,3),['Perfect Cloth Vest','Condition : 90/100','Protection']);
 assert.ok(vest.includes('Bullet +10')&&vest.includes('Chest'));
 assert.deepEqual(text(itemTooltip(item('Large Medkit'))),['Large Medkit','Medical','Heals 100 health.']);
 assert.deepEqual(itemTooltip(item('Hunting Bow')),[]);
 const bp=text(itemTooltip(item('Wood Storage Box Blueprint'),null,catalogue));
 assert.deepEqual(bp.slice(0,5),['Wood Storage Box Blueprint','Ingredients','Wood x30','Result Item','Wood Storage Box']);
 assert.equal(text(itemTooltip(item('Wood Planks'))).at(-1),'A type of resource');
});

test('condition names and .NET number formats', ()=>{
 const d={doesLoseCondition:1,m_Name:'Hatchet'};
 assert.deepEqual([1.2,0.8,0.6,0.5,0.4,0.1,0].map(c=>conditionString(d,c)),['Artifact','Perfect','Quality','','Shoddy','Bad','Broken']);
 assert.equal(itemTitle(d,{condition:0.45}),'Shoddy Hatchet');assert.equal(itemTitle(d,{condition:100}),'Perfect Hatchet');assert.equal(itemTitle({m_Name:'Wood'},{condition:0}),'Wood');
 assert.equal(fmtFloat(0.4000000059604645),'0.4');assert.equal(fmtFloat(350),'350');
});
