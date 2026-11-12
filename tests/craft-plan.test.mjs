// Resource calculator maths (site/js/craft-plan.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {craftPlan,cookingRecipes,smeltFor,durationLabel,encodeBuild,decodeBuild} from '../site/js/craft-plan.mjs';

// The original explosive charge chain (recipes.json): the Gunpowder and explosives guide's 691 sulfur per charge.
const R=(slug,ings,{amount=1,seconds=1,workbench=false}={})=>({slug,result:{slug,amount},ingredients:Object.entries(ings).map(([s,n])=>({slug:s,amount:n})),seconds,workbench});
const recipes=[
 R('gunpowder',{charcoal:2,sulfur:2},{seconds:.25}),R('flare',{gunpowder:8,'metal-fragments':8}),
 R('low-grade-fuel',{'animal-fat':2,cloth:1},{seconds:2}),
 R('explosives',{gunpowder:20,'low-grade-fuel':2,sulfur:5,'metal-fragments':10},{seconds:.25,workbench:true}),
 R('explosive-charge',{explosives:15,flare:1,leather:5},{seconds:120,workbench:true}),
 R('wood-planks',{wood:10},{seconds:2}),R('arrow',{wood:4,stones:2},{amount:4,seconds:5}),
];
const amounts=list=>Object.fromEntries(list.map(x=>[x.slug,x.amount]));

test('one explosive charge breaks down to the guide totals',()=>{
 const p=craftPlan(recipes,[{slug:'explosive-charge',qty:1}]);
 assert.deepEqual(amounts(p.base),{sulfur:691,charcoal:616,'metal-fragments':158,'animal-fat':60,cloth:30,leather:5});
 assert.deepEqual(p.steps.map(s=>s.slug).slice(-1),['explosive-charge'],'the wanted item is crafted last');
 const order=p.steps.map(s=>s.slug);assert.ok(order.indexOf('gunpowder')<order.indexOf('explosives')&&order.indexOf('gunpowder')<order.indexOf('flare'));
 assert.equal(p.steps.find(s=>s.slug==='gunpowder').crafts,308);assert.ok(p.workbench);
});

test('direct ingredients stop at the wanted items',()=>{
 const p=craftPlan(recipes,[{slug:'explosive-charge',qty:2}],{breakdown:false});
 assert.deepEqual(amounts(p.base),{explosives:30,leather:10,flare:2});assert.equal(p.steps.length,1);assert.equal(p.seconds,240);
});

test('shared intermediates are summed before rounding, with leftovers',()=>{
 const p=craftPlan(recipes,[{slug:'arrow',qty:5}]);
 assert.deepEqual(amounts(p.base),{wood:8,stones:4});assert.equal(p.steps[0].crafts,2);assert.deepEqual(p.leftovers,[{slug:'arrow',amount:3}]);
 const q=craftPlan(recipes,[{slug:'explosives',qty:1},{slug:'gunpowder',qty:5}]);
 assert.equal(q.steps.find(s=>s.slug==='gunpowder').crafts,25);assert.equal(amounts(q.base).sulfur,55);
});

test('zero or bad quantities are ignored; base items pass through',()=>{
 assert.deepEqual(craftPlan(recipes,[{slug:'flare',qty:0},{slug:'flare',qty:'x'}]).steps,[]);
 assert.deepEqual(amounts(craftPlan(recipes,[{slug:'wood',qty:3}]).base),{wood:3});
});

// items.json cooking fields (tools/build-wiki-data.mjs cookingTable).
const items=[
 {slug:'cooked-chicken-breast',type:'consumable',cookedFrom:[{slug:'raw-chicken-breast',station:'campfire',min:1,max:1}]},
 {slug:'sulfur',type:'resource',cookedFrom:[{slug:'sulfur-ore',station:'furnace',min:3,max:4}]},
 {slug:'leather',type:'resource',cookedFrom:[{slug:'cloth',station:'furnace',min:1,max:1}]},
 {slug:'charcoal',type:'resource',cookedFrom:[{slug:'wood',station:'campfire',min:3,max:3,fuel:true},{slug:'wood',station:'furnace',min:2.5,max:2.5,fuel:true}]},
];

test('cooked food is a camp fire step; leather from cloth stays a base resource',()=>{
 const cook=cookingRecipes(items);assert.deepEqual(cook.map(r=>[r.result.slug,r.ingredients[0].slug,r.station]),[['cooked-chicken-breast','raw-chicken-breast','campfire']]);
 const p=craftPlan([...recipes,...cook],[{slug:'cooked-chicken-breast',qty:12}]);
 assert.deepEqual(amounts(p.base),{'raw-chicken-breast':12});assert.equal(p.steps[0].station,'campfire');assert.equal(p.seconds,120);assert.ok(!p.workbench);
});

test('ore and fuel for the smelted and burnt resources, durations and shareable lists',()=>{
 assert.deepEqual(smeltFor([{slug:'sulfur',amount:691},{slug:'charcoal',amount:616},{slug:'leather',amount:5}],items),{
  ore:[{slug:'sulfur-ore',from:'sulfur',station:'furnace',min:173,max:231}],
  fuel:[{slug:'wood',from:'charcoal',station:'campfire',amount:206},{slug:'wood',from:'charcoal',station:'furnace',amount:247}]});
 assert.equal(durationLabel(0.5),'0.5 s');assert.equal(durationLabel(200),'3 min 20 s');assert.equal(durationLabel(7500),'2 h 05 min');
 assert.equal(encodeBuild([{slug:'explosive-charge',qty:2},{slug:'metal-door',qty:1},{slug:'flare',qty:0}]),'explosive-charge*2,metal-door');
 assert.deepEqual(decodeBuild('explosive-charge*2,metal-door,bad slug!,metal-door*3'),[{slug:'explosive-charge',qty:2},{slug:'metal-door',qty:4}]);
});

test('a build that needs a workbench is timed at workbench speed (crafting.workbench_speed 3), cooking at its own pace',()=>{
 const p=craftPlan(recipes,[{slug:'explosive-charge',qty:1}]);
 assert.equal(p.workbench,true);
 assert.equal(p.benchSeconds,Math.round(p.seconds/3*100)/100,'every crafting step at a workbench');
 const hand=craftPlan(recipes,[{slug:'low-grade-fuel',qty:3}]);
 assert.equal(hand.workbench,false);assert.equal(hand.benchSeconds,2,'still faster if you use one');
 const cook=craftPlan([...recipes,{slug:'cooked',result:{slug:'cooked',amount:1},ingredients:[{slug:'raw',amount:1}],seconds:30,workbench:false,cook:true,station:'campfire'}],[{slug:'cooked',qty:2}]);
 assert.equal(cook.benchSeconds,60,'a fire cooks at its own speed');
});
