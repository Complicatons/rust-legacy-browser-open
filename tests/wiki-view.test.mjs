// Wiki page helpers (site/js/wiki-view.mjs): search ranking, property rows, labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rankSearch,propRows,protectionRows,chanceLabel,chargesLabel,shortHash,routeOf,guideHero} from '../site/js/wiki-view.mjs';

const index=[
 {t:'Hatchet',u:'/wiki/items/hatchet',s:'Items',k:'hatchet blueprint weapon'},
 {t:'Stone Hatchet',u:'/wiki/items/stone-hatchet',s:'Items',k:'weapon'},
 {t:'Hatchet Blueprint',u:'/wiki/recipes/hatchet',s:'Crafting',k:'craft blueprint'},
 {t:'Wood',u:'/wiki/items/wood',s:'Items',k:'resource'},
 {t:'Wood Pile',u:'/wiki/resources/wood-pile',s:'Resources',k:'wood'},
 {t:'Explosive Charge',u:'/wiki/items/explosive-charge',s:'Items',k:'explosive'},
];

test('search ranks exact, then prefix, then word start, then keywords', () => {
 assert.deepEqual(rankSearch(index,'hatchet').map(r=>r.t),['Hatchet','Hatchet Blueprint','Stone Hatchet']);
 assert.deepEqual(rankSearch(index,'wood').map(r=>r.t),['Wood','Wood Pile']);
 assert.deepEqual(rankSearch(index,'explosive').map(r=>r.t),['Explosive Charge']);
 assert.deepEqual(rankSearch(index,'craft').map(r=>r.t),['Hatchet Blueprint']);
 assert.deepEqual(rankSearch(index,'  '),[]);
 assert.equal(rankSearch(index,'a',{limit:2}).length,2);
});

test('property rows format the exported values with units', () => {
 assert.deepEqual(propRows({type:'weapon',props:{damage:[30,40],fireRate:0.125,clip:24,ammo:'556-ammo',stack:undefined,researchable:true}},{nameOf:s=>s==='556-ammo'?'556 Ammo':s}),
  [['Damage','30–40'],['Fire rate','0.125 s'],['Clip',24],['Ammo',{text:'556 Ammo',href:'/wiki/items/556-ammo'}],['Researchable','Yes']]);
 assert.deepEqual(propRows({type:'weapon',props:{damage:[25,25],range:1.5}}),[['Damage','25'],['Range','1.5 m']]);
 assert.deepEqual(propRows({type:'consumable',props:{calories:350,heal:8,stack:250}}),[['Stack',250],['Calories',350],['Heals',8]]);
 assert.deepEqual(propRows({type:'medical',props:{heal:[40,40],stopsBleeding:true}}),[['Heals','40'],['Stops bleeding','Yes']]);
 assert.deepEqual(protectionRows({bullet:30,melee:30,explosion:15,cold:10}),[['Bullet',30],['Melee',30],['Explosion',15],['Cold',10]]);
});

test('labels for chance, charges and hashes', () => {
 assert.equal(chanceLabel(0.119),'11.9%');assert.equal(chanceLabel(0.0005),'<0.1%');assert.equal(chanceLabel(null),'—');
 assert.equal(chargesLabel(5),'5');assert.equal(chargesLabel(null),'Immune');
 assert.equal(shortHash('abcdef0123456789abcdef'),'abcdef012345');assert.equal(shortHash(null),'');
});

test('routes split section and slug from the wiki path', () => {
 assert.deepEqual(routeOf('/wiki'),{section:null,slug:null});
 assert.deepEqual(routeOf('/wiki/items'),{section:'items',slug:null});
 assert.deepEqual(routeOf('/wiki/items/hatchet/'),{section:'items',slug:'hatchet'});
});

test('a guide shows its header picture only when the text does not show it too', () => {
 assert.equal(guideHero('/m/a.jpg','Intro.\n\n![A](/m/a.jpg)\n'),null);
 assert.equal(guideHero('/m/a.jpg','![B](/m/b.jpg) and /m/a.jpg in prose'),'/m/a.jpg');
 assert.equal(guideHero(undefined,'![A](/m/a.jpg)'),null);
});
