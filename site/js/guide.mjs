// How to play: live requirement checks, the controls table from the game's own default bindings, first-night recipes.
import {controlRows} from './guide-controls.mjs';

const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(Boolean));return e;};
const state=(id,ok,yes,no)=>{const s=$(id);s.textContent=ok?yes:no;s.classList.add(ok?'ok':'bad');};

// Requirements, checked on this device.
const desktop=matchMedia('(hover:hover) and (pointer:fine)').matches;
let webgl=false;try{webgl=Boolean(document.createElement('canvas').getContext('webgl2'));}catch{}
state('#req-device',desktop,'This device','Phone or tablet');
state('#req-input',matchMedia('(pointer:fine)').matches,'Mouse found','No mouse found');
state('#req-webgl',webgl,'Supported','Not available');

// Controls: the game serves its key bindings module on the same origin as the site.
try{const kb=await import('/key-bindings.mjs');
 $('#controls-table').replaceChildren(el('table',{class:'wtable keys'},el('tbody',{},controlRows(kb).filter(r=>r.keys.length).map(r=>el('tr',{},el('th',{scope:'row',class:'mono',text:r.action}),el('td',{},r.keys.map(k=>el('kbd',{class:'key',text:k}))))))));}
catch{$('#controls-table').replaceChildren(el('div',{class:'pending'},el('b',{text:'Controls unavailable'}),el('span',{text:'The game is not served from this address.'})));}

// First night: real recipes from the wiki data.
const STEPS=[['Gather','Hit trees and wood piles for wood.',[]],['Fire','A camp fire gives light and warmth.',['camp-fire']],['Tools','A stone hatchet gathers faster.',['stone-hatchet']],
 ['Light','A torch for the dark.',['torch']],['Shelter','A roof and a door before night.',['wood-shelter','wooden-door']],['Respawn','A sleeping bag sets where you wake up.',['sleeping-bag']]];
const [recipes,items]=await Promise.all(['recipes','items'].map(n=>fetch(`/site/generated/wiki/${n}.json`).then(r=>r.ok?r.json():null).catch(()=>null)));
const bySlug=new Map((items?.entries??[]).map(i=>[i.slug,i])),recipe=new Map((recipes?.entries??[]).map(r=>[r.slug,r]));
const chip=(slug,amount)=>{const it=bySlug.get(slug);if(!it)return null;const a=el('a',{class:'chip-item',href:'/wiki/items/'+slug});
 if(it.icon)a.append(el('img',{src:it.icon,alt:'',class:'ico sm',width:24,height:24}));a.append(el('span',{text:it.name}));if(amount!=null)a.append(el('b',{class:'mono',text:'×'+amount}));return a;};
$('#night').replaceChildren(...STEPS.map(([title,text,slugs],i)=>el('li',{},el('b',{class:'mono',text:String(i+1).padStart(2,'0')}),el('h3',{text:title}),el('p',{text}),
 ...slugs.map(s=>{const r=recipe.get(s);return el('div',{class:'craft'},chip(s),r?el('span',{class:'mono muted',text:'='}):null,r?r.ingredients.map(g=>chip(g.slug,g.amount)):null);}))));
document.body.dataset.ready='1';
