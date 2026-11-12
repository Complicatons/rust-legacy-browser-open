// The wiki's resource calculator (/wiki/calculator): pick craftable items and quantities, get the base resources, the
// crafting order, time and leftovers from the original recipes, plus cooking (food on a camp fire, ore and charcoal). Maths in craft-plan.mjs; the list lives in ?build=.
import {craftPlan,cookingRecipes,smeltFor,durationLabel,encodeBuild,decodeBuild,WORKBENCH_SPEED} from './craft-plan.mjs';
import {TYPE_LABEL} from './wiki-view.mjs';

const QUICK=['explosive-charge','metal-door','wood-wall','furnace','556-ammo','f1-grenade'];
const MAX=9999;

// items/recipes: the wiki's generated JSON; el/icon: the wiki page's element helpers. Returns the page's nodes.
export function calculator({items,recipes,el,icon:wikiIcon}){
 if(!document.querySelector('link[href$="/calculator.css"]'))document.head.append(el('link',{rel:'stylesheet',href:'/site/css/pages/calculator.css'}));
 // Recipes plus cooking steps for food that only comes off a fire (Cooked Chicken Breast).
 const all=[...recipes.entries,...cookingRecipes(items.entries)];
 const bySlug=new Map(items.entries.map(i=>[i.slug,i])),byResult=new Map(all.map(r=>[r.result.slug,r]));
 const FIRE={campfire:'camp fire',furnace:'furnace'};
 // Leave out the leftover part items (Armor/Weapon Part 1–7, empty and primed casings): they have recipes but nothing in
 // the game uses them, so nobody crafts them.
 const unused=i=>i.type==='misc'&&!(i.usedIn??[]).length;
 const craftable=items.entries.filter(i=>byResult.has(i.slug)&&!unused(i)).sort((a,b)=>a.name.localeCompare(b.name));
 const types=[...new Set(craftable.map(i=>i.type))].sort((a,b)=>(TYPE_LABEL[a]??a).localeCompare(TYPE_LABEL[b]??b));
 const q=new URLSearchParams(location.search);
 let build=decodeBuild(q.get('build')).filter(x=>byResult.has(x.slug)&&!unused(bySlug.get(x.slug)??{})).map(x=>({...x,qty:Math.min(MAX,x.qty)})),mode=q.get('mode')==='direct'?'direct':'base',type=null,filter='';
 const name=s=>bySlug.get(s)?.name??s;
 // Items without an exported icon get their initials.
 const iconOf=(slug,size='')=>{const it=bySlug.get(slug);return it?.icon?wikiIcon(it.icon,size):el('span',{class:'ico mono-ico '+size,'aria-hidden':'true',text:name(slug).split(/[\s-]+/).filter(w=>/^[A-Za-z0-9]/.test(w)).slice(0,2).map(w=>w[0]).join('').toUpperCase()});};

 // Picker: search, type chips, a grid of every craftable item.
 const search=el('input',{type:'search',class:'calc-q',placeholder:'Find an item to craft',autocomplete:'off',spellcheck:'false','aria-label':'Find an item to craft'});
 const chips=el('div',{class:'chips',role:'group','aria-label':'Item type'});
 const grid=el('div',{class:'calc-items',role:'list'});
 chips.append(el('button',{type:'button',class:'chip','data-type':'',text:'All',onclick:()=>{type=null;drawPicker();}}),
  ...types.map(t=>el('button',{type:'button',class:'chip','data-type':t,text:TYPE_LABEL[t]??t,onclick:()=>{type=t;drawPicker();}})));
 search.addEventListener('input',()=>{filter=search.value.trim().toLowerCase();drawPicker();});
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){const first=grid.querySelector('button');if(first){e.preventDefault();first.click();}}});
 function drawPicker(){
  chips.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.type||null)===type)));
  const focused=document.activeElement?.closest?.('.calc-item')?.dataset.slug;
  const list=craftable.filter(i=>(!type||i.type===type)&&(!filter||i.name.toLowerCase().includes(filter)));
  grid.replaceChildren(...list.map(i=>{const n=build.find(x=>x.slug===i.slug)?.qty;
   return el('div',{role:'listitem'},el('button',{type:'button',class:'calc-item'+(n?' on':''),'data-slug':i.slug,title:`Add ${i.name}`,onclick:()=>addItem(i.slug,1)},
    iconOf(i.slug),el('span',{class:'nm',text:i.name}),n?el('b',{class:'mono badge',text:'×'+n}):null));}),
   ...(list.length?[]:[el('p',{class:'muted calc-none',text:'No craftable item matches.'})]));
  if(focused)grid.querySelector(`[data-slug="${focused}"]`)?.focus();
 }

 // Build list and results.
 const buildBox=el('div',{class:'calc-build'}),results=el('div',{class:'calc-results','aria-live':'polite'});
 const modeCtl=el('div',{class:'seg-ctl calc-mode',role:'group','aria-label':'Show'},
  el('button',{type:'button','data-mode':'base',text:'From scratch',title:'Everything down to what you gather',onclick:()=>{mode='base';update();}}),
  el('button',{type:'button','data-mode':'direct',text:'Recipe only',title:'Just what the recipes themselves take',onclick:()=>{mode='direct';update();}}));
 const copy=el('button',{type:'button',class:'btn small',text:'Copy link',onclick:async()=>{try{await navigator.clipboard.writeText(location.href);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy link',1500);}catch{copy.textContent='Copy the address bar';}}});

 function addItem(slug,n){const row=build.find(x=>x.slug===slug);if(row)row.qty=Math.min(MAX,row.qty+n);else build.push({slug,qty:n});update(slug);}
 function setQty(slug,n){const row=build.find(x=>x.slug===slug);if(!row)return;row.qty=Math.max(0,Math.min(MAX,Math.floor(n)||0));if(!row.qty)build=build.filter(x=>x!==row);update(slug);}
 function drawBuild(focus){
  if(!build.length){buildBox.replaceChildren(el('div',{class:'calc-empty'},el('b',{text:'Pick what you want to craft'}),
   el('span',{class:'muted',text:'Choose items on the left, or start with one of these:'}),
   el('div',{class:'ings'},QUICK.filter(s=>byResult.has(s)).map(s=>el('button',{type:'button',class:'chip-item',onclick:()=>addItem(s,1)},iconOf(s,'sm'),el('span',{text:name(s)}))))));return;}
  buildBox.replaceChildren(el('div',{class:'sec-h'},el('h2',{class:'mono',text:'Your build'}),el('div',{class:'calc-acts'},copy,el('button',{type:'button',class:'btn small',text:'Clear',onclick:()=>{build=[];update();}}))),
   el('ul',{class:'calc-rows'},build.map(x=>{const it=bySlug.get(x.slug),r=byResult.get(x.slug);
    const input=el('input',{type:'number',min:'0',max:String(MAX),step:'1',inputmode:'numeric',value:String(x.qty),'aria-label':`How many ${it?.name??x.slug}`});
    input.addEventListener('change',()=>setQty(x.slug,input.value));input.addEventListener('keydown',e=>{if(e.key==='Enter')setQty(x.slug,input.value);});
    const li=el('li',{'data-slug':x.slug},el('a',{class:'cell-item',href:'/wiki/items/'+x.slug},iconOf(x.slug,'sm'),el('span',{text:it?.name??x.slug})),
     r?.result.amount>1?el('span',{class:'mono muted per',text:`makes ${r.result.amount}`}):el('span',{class:'per'}),
     el('div',{class:'stepper'},el('button',{type:'button','aria-label':'One less',text:'−',onclick:()=>setQty(x.slug,x.qty-1)}),input,el('button',{type:'button','aria-label':'One more',text:'+',onclick:()=>setQty(x.slug,x.qty+1)})),
     el('button',{type:'button',class:'rm','aria-label':`Remove ${it?.name??x.slug}`,text:'×',onclick:()=>setQty(x.slug,0)}));
    if(x.slug===focus)requestAnimationFrame(()=>li.classList.add('flash'));return li;})));
 }
 const tile=(slug,amount,cls='')=>el('a',{class:'calc-tile '+cls,href:'/wiki/items/'+slug},iconOf(slug),el('b',{class:'num','data-n':String(amount),text:amount.toLocaleString('en')}),el('span',{class:'mono',text:name(slug)}));
 // Every number in the set is sized for the longest one (--len, calculator.css), so big totals fit and the tiles match.
 const tiles=list=>{const box=el('div',{class:'calc-tiles'},list.map(b=>tile(b.slug,b.amount)));
  box.style.setProperty('--len',String(Math.max(3,...list.map(b=>b.amount.toLocaleString('en').length))));return box;};
 function drawResults(){
  modeCtl.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
  if(!build.length){results.replaceChildren();return;}
  const p=craftPlan(all,build,{breakdown:mode==='base'}),{ore,fuel}=mode==='base'?smeltFor(p.base,items.entries):{ore:[],fuel:[]};
  const n=v=>v.toLocaleString('en'),wood=fuel.length?fuel:null,fire=ore.length||wood;
  // The results read in the order you play them: gather, smelt and burn, then craft.
  const stage=(i,text)=>el('h2',{class:'mono calc-stage'},el('span',{class:'calc-stage-n',text:String(i)}),text);
  results.replaceChildren(...[
   el('div',{class:'sec-h'},stage(1,mode==='base'?'Gather':'Ingredients'),modeCtl),
   el('p',{class:'calc-for'},'For ',...build.flatMap((x,i)=>[i?', ':'',el('b',{text:`${n(x.qty)} × ${name(x.slug)}`})])),
   tiles(p.base),
   el('dl',{class:'stats wiki-stats calc-stats'},[['Times you craft',n(p.crafts)],[p.workbench?'Crafting time at a workbench':'Crafting time',durationLabel(p.workbench?p.benchSeconds:p.seconds)],['Workbench',p.workbench?'Needed':'Not needed']].map(([l,v])=>el('div',{class:'stat'},el('dt',{class:'mono',text:l}),el('dd',{text:v})))),
   fire?el('section',{class:'wiki-sec calc-ore'},stage(2,'Smelt and burn'),
    el('div',{class:'ings'},ore.map(o=>el('a',{class:'chip-item',href:'/wiki/items/'+o.slug},iconOf(o.slug,'sm'),el('span',{text:name(o.slug)}),el('b',{class:'mono',text:o.min===o.max?n(o.min):`${n(o.min)}–${n(o.max)}`}))),
     (wood??[]).map(f=>el('a',{class:'chip-item',href:'/wiki/items/'+f.slug},iconOf(f.slug,'sm'),el('span',{text:`${name(f.slug)} (${FIRE[f.station]})`}),el('b',{class:'mono',text:n(f.amount)})))),
    el('p',{class:'muted note',text:[ore.length?`Smelt ore in a furnace: ${ore.map(o=>{const c=bySlug.get(o.from)?.cookedFrom?.find(x=>x.slug===o.slug);return `${c.min}–${c.max} ${name(o.from).toLowerCase()} per ${name(o.slug).toLowerCase()}`;}).join(', ')}, so the range runs from lucky to unlucky.`:null,
     wood?'Charcoal is what burnt wood leaves behind: 3 per wood on a camp fire, 2.5 in a furnace (the same wood that smelts your ore).':null].filter(Boolean).join(' ')})):null,
   el('section',{class:'wiki-sec'},stage(fire?3:2,'Craft in this order'),el('ol',{class:'calc-steps'},p.steps.map(s=>{const r=byResult.get(s.slug);
    return el('li',{class:s.cook?'cook':''},iconOf(s.slug,'sm'),el('div',{},el('b',{},el('a',{href:s.cook?'/wiki/items/'+s.slug:'/wiki/recipes/'+r.slug,text:`${s.cook?'Cook ':''}${n(s.crafts)} × ${name(s.slug)}`})),
     el('span',{class:'mono muted',text:[r.ingredients.map(g=>`${n(g.amount*s.crafts)} ${name(g.slug)}`).join(' · '),s.cook?`about ${durationLabel(s.seconds)}`:durationLabel(p.workbench?s.seconds/WORKBENCH_SPEED:s.seconds),s.cook?`on a ${FIRE[s.station]}`:s.workbench?'workbench':null].filter(Boolean).join('  ·  ')})),
     s.makes!==s.crafts?el('span',{class:'mono makes',text:'→ '+s.makes.toLocaleString('en')}):null);}))),
   p.leftovers.length?el('p',{class:'muted note'},'Left over: ',p.leftovers.map(l=>`${l.amount} ${name(l.slug)}`).join(', '),'.'):null,
   p.steps.some(s=>!s.cook)&&el('p',{class:'muted note'},'Every recipe needs its blueprint first (see ',el('a',{href:'/wiki/guides/research-and-blueprints',text:'Research and blueprints'}),'). Workbench recipes need you to stand at a workbench, where everything crafts three times faster',
    p.workbench?': the times above are at a workbench.':` (${durationLabel(p.benchSeconds)} instead of ${durationLabel(p.seconds)}).`)].filter(Boolean));
  countUp(results);
 }
 function update(focus){
  const u=new URL(location.href),code=encodeBuild(build);if(code)u.searchParams.set('build',code);else u.searchParams.delete('build');
  if(mode==='direct')u.searchParams.set('mode','direct');else u.searchParams.delete('mode');history.replaceState(null,'',u);
  drawBuild(focus);drawResults();drawPicker();
 }
 update();
 const how=el('ol',{class:'calc-how','aria-label':'How it works'},[['Pick','what you want to craft'],['Set','how many'],['Read','what to gather, smelt and craft']].map(([b,t])=>el('li',{},el('b',{text:b}),' '+t)));
 return [el('header',{class:'wiki-hero'},el('h1',{class:'h',text:'Calculator'}),how),
  el('div',{class:'calc'},el('section',{class:'calc-pick','aria-label':'Craftable items'},search,chips,grid),el('section',{class:'calc-out'},buildBox,results))];
}

// Totals roll up from their previous value (skipped with reduced motion).
const shown=new Map();
function countUp(root){
 const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
 for(const b of root.querySelectorAll('.calc-tile .num')){
  const key=b.closest('a').getAttribute('href'),to=Number(b.dataset.n),from=shown.get(key)??0;shown.set(key,to);
  if(still||from===to)continue;const t0=performance.now(),D=380;
  const step=t=>{const k=Math.min(1,(t-t0)/D),e=1-(1-k)**3;b.textContent=Math.round(from+(to-from)*e).toLocaleString('en');if(k<1&&b.isConnected)requestAnimationFrame(step);};
  requestAnimationFrame(step);
 }
}
