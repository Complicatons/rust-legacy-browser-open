// The wiki: home (/wiki), section lists (/wiki/<section>) and pages (/wiki/<section>/<slug>) from the generated game
// data in /site/generated/wiki, plus staff articles from /wiki/api/articles. Search over search.json and articles.
import {SECTIONS,TYPE_LABEL,routeOf,rankSearch,propRows,protectionRows,chanceLabel,chargesLabel,shortHash,groupGuides,guideHero,featuredGuides} from './wiki-view.mjs';
import {renderMarkdown,parseFrontMatter} from './markdown.mjs';
import {onSession} from './session.mjs';

const $=s=>document.querySelector(s),main=$('#wiki-main'),G='/site/generated/wiki/';
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k==='html')e.innerHTML=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const cache=new Map();
// Guides come from the content index (site/content/guides/*.md); everything else from the generated game data.
const data=name=>{if(!cache.has(name))cache.set(name,(name==='guides'?fetch('/site/generated/content/guides.json').then(r=>r.ok?r.json():null).then(l=>l&&{entries:l}):fetch(G+name+'.json').then(r=>r.ok?r.json():null)).catch(()=>null));return cache.get(name);};
const articles=()=>{if(!cache.has('articles'))cache.set('articles',fetch('/wiki/api/articles').then(r=>r.ok?r.json():[]).catch(()=>[]));return cache.get('articles');};
const label=id=>SECTIONS.find(s=>s.id===id)?.label??id.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());
let me=null;onSession(s=>{me=s.me;document.body.classList.toggle('is-staff',Boolean(me?.staff));});

// Shared bits
const icon=(src,size='')=>src?el('img',{class:'ico '+size,src,alt:'',loading:'lazy',width:64,height:64}):el('span',{class:'ico none '+size,'aria-hidden':'true'});
const itemLink=(it,amount)=>el('a',{class:'chip-item',href:'/wiki/items/'+it.slug},icon(it.icon,'sm'),el('span',{text:it.name}),amount!=null?el('b',{class:'mono',text:'×'+amount}):null);
const source=hash=>el('p',{class:'source mono'},'From the original game data',hash?el('span',{text:' · '+shortHash(hash)}):null);
const stats=list=>el('dl',{class:'stats wiki-stats'},list.filter(x=>x&&x[1]!=null&&x[1]!=='').map(([l,v,cls])=>el('div',{class:'stat'},el('dt',{class:'mono',text:l}),el('dd',{class:cls??'',text:String(v)}))));
const table=(head,rows,cls='')=>el('div',{class:'table-wrap'},el('table',{class:'wtable '+cls},head.some(h=>h.label??h)?el('thead',{},el('tr',{},head.map(h=>el('th',{class:h.num?'num':'',text:h.label??h})))):null,el('tbody',{},rows.map(r=>el('tr',{},r.map((c,i)=>el('td',{class:head[i]?.num?'num':''},c??'—')))))));
const pending=(title,text)=>el('div',{class:'pending'},el('b',{text:title}),el('span',{text}));
function crumbs(...parts){$('#crumbs').replaceChildren(el('a',{href:'/wiki',text:'Wiki'}),...parts.map(([t,h])=>h?el('a',{href:h,text:t}):el('span',{text:t})));}
function page(title,...kids){document.title=title==='Wiki'?'Wiki · Rust Legacy Browser':`${title} · Wiki · Rust Legacy Browser`;main.replaceChildren(...kids.flat().filter(Boolean));main.removeAttribute('aria-busy');document.body.dataset.ready='1';}
const missingData=()=>page('Wiki',pending('Wiki data not generated yet','Run npm run build:site on the server to build the wiki from the game files.'));

async function rail(current){
 const counts=await Promise.all(SECTIONS.map(async s=>{const d=await data(s.id);return d?d.entries.length+(d.loot?.length??0):null;}));
 $('#wiki-rail').replaceChildren(el('a',{href:'/wiki',class:'rail-home','aria-current':current?false:'page'},'Wiki'),
  ...SECTIONS.map((s,i)=>el('a',{href:'/wiki/'+s.id,'aria-current':current===s.id?'page':false},el('span',{text:s.label}),counts[i]!=null?el('b',{class:'mono',text:String(counts[i])}):null)),
  el('a',{href:'/wiki/calculator',class:'rail-tool','aria-current':current==='calculator'?'page':false},el('span',{text:'Calculator'})));
}

// Home: section tiles with counts, recent articles.
async function home(){
 crumbs();const [arts,...secs]=await Promise.all([articles(),...SECTIONS.map(s=>data(s.id))]);
 if(secs.every(d=>!d))return missingData();
 const tiles=SECTIONS.map((s,i)=>el('a',{class:'tile',href:'/wiki/'+s.id},el('b',{text:secs[i]?String(secs[i].entries.length+(secs[i].loot?.length??0)):'—'}),el('span',{class:'mono',text:s.label})));
 if(arts.length)tiles.push(el('a',{class:'tile',href:'#articles'},el('b',{text:String(arts.length)}),el('span',{class:'mono',text:'Articles'})));
 page('Wiki',el('header',{class:'wiki-hero'},el('h1',{class:'h',text:'Wiki'}),el('p',{class:'mono muted',text:'Original game data · staff guides'})),
  el('div',{class:'tiles'},tiles),
  el('a',{class:'calc-promo',href:'/wiki/calculator'},el('b',{text:'Resource calculator'}),el('span',{class:'muted',text:'Pick anything you can craft or build and how many: get every resource, the crafting order and the time.'}),el('span',{class:'mono',text:'Open →'})),
  recommendedGuides(secs[SECTIONS.findIndex(s=>s.id==='guides')]?.entries,true),
  el('section',{class:'wiki-sec',id:'articles'},el('div',{class:'sec-h'},el('h2',{class:'mono',text:'Articles'}),el('a',{class:'btn small staff-only',href:'/wiki/edit',text:'New article'})),
   arts.length?el('ul',{class:'art-list'},arts.slice(0,12).map(a=>el('li',{},el('a',{href:`/wiki/${a.section}/${a.slug}`},el('span',{text:a.title}),el('span',{class:'mono muted',text:label(a.section)}))))):el('p',{class:'muted',text:'No articles yet.'})),
  source(secs[0]?.source));
}

// Guide cards; the featured ones (front matter `featured`) head /wiki and /wiki/guides.
const guideCard=g=>el('a',{class:'guide-card',href:'/wiki/guides/'+g.slug},
 g.image?shot(g.image,'guide-thumb'):el('span',{class:'guide-thumb none','aria-hidden':'true'}),el('b',{text:g.title}),g.summary?el('span',{class:'muted',text:g.summary}):null);
function recommendedGuides(list,more=false){const f=featuredGuides(list??[]);if(!f.length)return null;
 return el('section',{class:'wiki-sec',id:'recommended-guides'},el('div',{class:'sec-h'},el('h2',{class:'mono',text:'Recommended guides'}),more?el('a',{class:'mono more',href:'/wiki/guides',text:`All ${list.length} guides →`}):null),el('div',{class:'guide-grid'},f.map(guideCard)));}

// Section lists
async function section(id){
 if(id==='calculator')return calculatorPage();
 crumbs([label(id)]);
 const d=await data(id),arts=(await articles()).filter(a=>a.section===id);
 const artList=arts.length?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Articles'}),el('ul',{class:'art-list'},arts.map(a=>el('li',{},el('a',{href:`/wiki/${id}/${a.slug}`},el('span',{text:a.title})))))):null;
 const head=(title,count)=>el('header',{class:'wiki-hero'},el('h1',{class:'h',text:title}),count!=null?el('p',{class:'count mono',text:String(count)}):null);
 if(!SECTIONS.some(s=>s.id===id)){if(!arts.length)return notFound();return page(label(id),head(label(id),arts.length),artList);}
 if(!d)return missingData();
 const items=await data('items'),bySlug=new Map((items?.entries??[]).map(i=>[i.slug,i]));
 const R={
  guides:()=>[recommendedGuides(d.entries),...groupGuides(d.entries).map(([group,list])=>el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:group}),el('div',{class:'guide-grid'},list.map(guideCard))))],
  items:()=>itemGrid(d.entries),
  recipes:()=>table([{label:'Result'},{label:'Ingredients'},{label:'Time',num:1},{label:'Bench'}],d.entries.map(r=>[
   el('a',{class:'cell-item',href:'/wiki/recipes/'+r.slug},icon(bySlug.get(r.result.slug)?.icon,'sm'),el('span',{text:bySlug.get(r.result.slug)?.name??r.name}),r.result.amount>1?el('b',{class:'mono',text:'×'+r.result.amount}):null),
   el('div',{class:'ings'},r.ingredients.map(g=>bySlug.get(g.slug)?itemLink(bySlug.get(g.slug),g.amount):null)),`${r.seconds} s`,r.workbench?'Yes':'']),'recipes'),
  building:()=>table([{label:'Piece'},{label:'Kind'},{label:'Health',num:1},{label:'Bullet',num:1},{label:'Melee',num:1},{label:'Explosion',num:1},{label:'Charges',num:1}],
   d.entries.map(p=>[el('a',{class:'cell-item',href:'/wiki/items/'+p.slug},icon(bySlug.get(p.slug)?.icon,'sm'),el('span',{text:p.name})),TYPE_LABEL[p.kind]??p.kind,p.health,p.protection?.bullet,p.protection?.melee,p.protection?.explosion,
    el('span',{class:p.charges==null?'imm':'',text:chargesLabel(p.charges)})])),
  raiding:()=>[el('div',{class:'explosive panel'},el('a',{class:'cell-item big',href:'/wiki/items/'+d.explosive.slug},icon(bySlug.get(d.explosive.slug)?.icon),el('span',{text:d.explosive.name})),
    stats([['Damage',d.explosive.damage],['Radius',d.explosive.radius+' m'],['Fuse',d.explosive.fuse+' s']])),
   table([{label:'Target'},{label:'Health',num:1},{label:'Charges',num:1}],[...d.entries].sort((a,b)=>(a.charges??1e9)-(b.charges??1e9)||a.target.localeCompare(b.target)).map(t=>[
    el('a',{class:'cell-item',href:'/wiki/items/'+t.slug},icon(bySlug.get(t.slug)?.icon,'sm'),el('span',{text:t.target})),t.health,el('span',{class:t.charges==null?'imm':'charges',text:chargesLabel(t.charges)})]))],
  animals:()=>el('div',{class:'card-grid'},d.entries.map(a=>el('a',{class:'card',href:'/wiki/animals/'+a.slug},el('b',{class:'card-t',text:a.name}),stats([['Health',a.health],['Run',a.runSpeed!=null?a.runSpeed+' m/s':null]]),el('span',{class:'mono '+(a.hostile?'rad':'muted'),text:a.hostile?'Hostile':'Passive'})))),
  resources:()=>[el('h2',{class:'mono sub',text:'Nodes'}),table([{label:'Node'},{label:'Yields'}],d.entries.map(n=>[el('a',{href:'/wiki/resources/'+n.slug,text:n.name}),el('div',{class:'ings'},n.yields.map(y=>bySlug.get(y.slug)?itemLink(bySlug.get(y.slug),y.min===y.max?y.min:`${y.min}–${y.max}`):null))])),
   el('h2',{class:'mono sub',text:'Loot containers'}),table([{label:'Container'},{label:'Where'},{label:'Rolls',num:1},{label:'Slots',num:1},{label:'Items',num:1}],d.loot.map(c=>[el('a',{href:'/wiki/resources/'+c.slug,text:c.name}),{crate:'Crate spots',airdrop:'Airdrops',drop:'Mutant kills'}[c.kind]??'',rollsLabel(c.rolls),c.slots,c.contents.length]))],
  places:()=>el('div',{class:'card-grid'},d.entries.map(p=>el('a',{class:'card',href:'/wiki/places/'+p.slug},el('b',{class:'card-t',text:p.title}),stats([['Structures',p.structures],['Rad/min',p.rad||null,'rad']]),el('span',{class:'mono muted',text:(p.features??[]).slice(1,4).join(' · ')})))),
  radiation:()=>table([{label:'Zone'},{label:'Rad/min',num:1},{label:'Radius',num:1},{label:'Map'}],d.entries.map(z=>[el('a',{href:'/wiki/radiation/'+z.slug,text:z.title}),el('span',{class:'rad',text:String(z.exposure)}),z.r+' m',el('a',{class:'mono',href:`/island?x=${z.x}&z=${z.z}&zoom=4`,text:'Open'})])),
 };
 const count=d.entries.length+(d.loot?.length??0);
 page(label(id),head(label(id),count),R[id](),artList,source(d.source));
}

function itemGrid(entries){
 const types=[...new Set(entries.map(i=>i.type))].sort((a,b)=>(TYPE_LABEL[a]??a).localeCompare(TYPE_LABEL[b]??b));
 const q=new URLSearchParams(location.search);let type=types.includes(q.get('type'))?q.get('type'):null;
 const grid=el('div',{class:'item-grid'}),chips=el('div',{class:'chips',role:'group','aria-label':'Item type'});
 const draw=()=>{chips.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.type||null)===type)));
  grid.replaceChildren(...entries.filter(i=>!type||i.type===type).sort((a,b)=>a.name.localeCompare(b.name)).map(i=>el('a',{class:'item-card',href:'/wiki/items/'+i.slug},icon(i.icon),el('b',{text:i.name}),el('span',{class:'mono',text:TYPE_LABEL[i.type]??i.type}))));
  const u=new URL(location.href);if(type)u.searchParams.set('type',type);else u.searchParams.delete('type');history.replaceState(null,'',u);};
 chips.append(el('button',{type:'button',class:'chip','data-type':'',text:'All',onclick:()=>{type=null;draw();}}),...types.map(t=>el('button',{type:'button',class:'chip','data-type':t,text:TYPE_LABEL[t]??t,onclick:()=>{type=t;draw();}})));
 draw();return [chips,grid];
}

// Pages
async function detail(sec,slug){
 if(sec==='guides')return guidePage(slug);
 const R={items:itemPage,recipes:recipePage,animals:animalPage,resources:resourcePage,places:placePage,radiation:radiationPage};
 if(R[sec]){const d=await data(sec);if(!d)return missingData();const entry=d.entries.find(e=>e.slug===slug)??d.loot?.find(e=>e.slug===slug);if(entry)return R[sec](entry,d);}
 const r=await fetch('/wiki/api/articles/'+encodeURIComponent(slug));
 if(r.ok)return articlePage(await r.json(),sec);
 notFound();
}
async function itemPage(it,d){
 crumbs([label('items'),'/wiki/items'],[it.name]);
 const [recipes,items,res,ani]=await Promise.all([data('recipes'),data('items'),data('resources'),data('animals')]),bySlug=new Map(items.entries.map(i=>[i.slug,i]));
 const recipe=recipes?.entries.find(r=>r.slug===it.recipe),usedIn=(it.usedIn??[]).map(s=>recipes?.entries.find(r=>r.slug===s)).filter(Boolean);
 // Loot that is the item itself (a looted blueprint shares the slug of what it teaches: that shows under How to learn it).
 const self=x=>x.slug===it.slug&&!x.blueprint;
 const found=[...(res?.loot??[]).filter(c=>c.contents.some(self)).map(c=>({name:c.name,href:'/wiki/resources/'+c.slug,c:c.contents.find(self)})),
  ...(res?.entries??[]).filter(n=>n.yields.some(y=>y.slug===it.slug)).map(n=>({name:n.name,href:'/wiki/resources/'+n.slug,y:n.yields.find(y=>y.slug===it.slug)})),
  ...(ani?.entries??[]).filter(a=>a.yields?.some(y=>y.slug===it.slug)).map(a=>({name:a.name,href:'/wiki/animals/'+a.slug,y:a.yields.find(y=>y.slug===it.slug),animal:true}))];
 const rows=propRows(it,{nameOf:s=>bySlug.get(s)?.name}).map(([k,v])=>[k,typeof v==='object'?el('a',{href:v.href,text:v.text}):String(v)]);
 page(it.name,el('header',{class:'detail-head'},icon(it.icon,'lg'),el('div',{},el('h1',{class:'h',text:it.name}),el('span',{class:'type-chip mono',text:TYPE_LABEL[it.type]??it.type}))),
  it.props.description?el('p',{class:'item-desc',text:it.props.description}):null,
  headline(it),
  el('div',{class:'detail-cols'},
   el('div',{},rows.length?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Properties'}),table(['',''],rows,'kv')):null,
    it.props.protection?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Protection'}),table(['',''],protectionRows(it.props.protection).map(([k,v])=>[k,String(v)]),'kv')):null),
   el('div',{},recipe?recipeBlock(recipe,bySlug,'Crafted from'):el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Crafted from'}),el('p',{class:'muted',text:'Not craftable'})),
    recipe?learnBlock(recipe,it):null,
    cookingBlock(it,bySlug),
    usedIn.length?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Used in'}),el('div',{class:'ings'},usedIn.map(r=>bySlug.get(r.result.slug)?itemLink(bySlug.get(r.result.slug)):null))):null,
    found.length?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Found in'}),table(['','',''],found.map(f=>[el('a',{href:f.href,text:f.name}),f.c?`${f.c.min===f.c.max?f.c.min:f.c.min+'–'+f.c.max}`:`${f.y.min===f.y.max?f.y.min:f.y.min+'–'+f.y.max}`,f.c?(f.c.chance==null?'Possible':chanceLabel(f.c.chance)+' per roll'):f.animal?'per harvest':'per gather']),'kv')):null)),
  source(d.source));
}
// Camp fire and furnace: what the item cooks into, what it is cooked from, the charcoal burnt wood leaves (items.json).
const FIRE={campfire:['Camp Fire','camp-fire'],furnace:['Furnace','furnace']};
function cookingBlock(it,bySlug){
 const fire=st=>{const [n,slug]=FIRE[st]??[st];const f=bySlug.get(slug);return f?itemLink(f):el('span',{text:n});};
 const each=c=>c.fuel?`${c.min} per wood`:c.min===c.max?(c.min===1?'1 each':`${c.min} each`):`${c.min}–${c.max} each`;
 const rows=[...(it.cooks??[]).map(c=>[fire(c.station),bySlug.get(c.slug)?itemLink(bySlug.get(c.slug)):c.slug,c.burns?'Burns to charcoal':each(c)]),
  ...(it.cookedFrom??[]).map(c=>[fire(c.station),bySlug.get(c.slug)?itemLink(bySlug.get(c.slug)):c.slug,c.fuel?`${c.min} per wood burnt`:`${each(c)} from`]),
  ...(it.burns??[]).map(b=>[fire(b.station),bySlug.get(b.slug)?itemLink(bySlug.get(b.slug)):b.slug,`${b.perWood} per wood`])];
 if(!rows.length)return null;
 const title=it.cooks?.length?'Cooking':it.burns?.length?'Fuel':'Made in the fire';
 return el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:title}),table(['','',''],rows,'kv'));
}
// Big numbers for the item's headline values.
function headline(it){const p=it.props,dmg=p.damage?(p.damage[0]===p.damage[1]?p.damage[0]:`${p.damage[0]}–${p.damage[1]}`):null;
 const list=it.type==='weapon'?[['Damage',dmg],['Clip',p.clip],['Fire rate',p.fireRate!=null?p.fireRate+' s':null]]
  :it.type==='armour'?protectionRows(p.protection).slice(0,4)
  :it.type==='consumable'?[['Calories',p.calories],['Heals',p.heal],['Water',p.water!=null?p.water+' L':null],['Anti-rads',p.antiRads]]
  :it.type==='medical'?[['Heals',Array.isArray(p.heal)?(p.heal[0]===p.heal[1]?p.heal[0]:p.heal.join('–')):p.heal],['Blood',p.bloodTaken]]
  :[['Stack',p.stack],['Uses',p.uses]];
 const shown=list.filter(x=>x[1]!=null);return shown.length?stats(shown):null;}
function recipeBlock(r,bySlug,title){
 return el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:title}),el('div',{class:'ings'},r.ingredients.map(g=>bySlug.get(g.slug)?itemLink(bySlug.get(g.slug),g.amount):null)),
  stats([['Time',r.seconds+' s'],['Makes',r.result.amount],['Workbench',r.workbench?'Yes':'No']]),el('a',{class:'mono more',href:'/wiki/recipes/'+r.slug,text:r.name}));}
// How a player learns a recipe: known from the start (Default Loadout), a looted blueprint, or researching the item.
function learnBlock(r,res){
 const rows=[];
 if(r.known)rows.push([el('b',{text:'Known from the start'}),'Every new player has this blueprint']);
 for(const f of r.foundIn??[])rows.push([el('a',{href:'/wiki/resources/'+f.slug,text:f.name}),`Blueprint, ${chanceLabel(f.chance)} per roll`]);
 if(!r.known&&res?.props?.researchable)rows.push([el('a',{href:'/wiki/guides/research-and-blueprints',text:'Research'}),`Research a ${res.name} with a Research Kit at a workbench`]);
 return rows.length?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'How to learn it'}),table(['',''],rows,'kv')):null;
}
async function recipePage(r,d){
 crumbs([label('recipes'),'/wiki/recipes'],[r.name]);const items=await data('items'),bySlug=new Map(items.entries.map(i=>[i.slug,i])),res=bySlug.get(r.result.slug);
 page(r.name,el('header',{class:'detail-head'},icon(res?.icon,'lg'),el('div',{},el('h1',{class:'h',text:r.name}),el('span',{class:'type-chip mono',text:'Blueprint'}))),
  recipeBlock(r,bySlug,'Ingredients'),res?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Makes'}),el('div',{class:'ings'},itemLink(res,r.result.amount))):null,learnBlock(r,res),source(d.source));
}
// In-game pictures (tools/capture-guide-images.mjs → site/generated/media/guides/) for animal and loot pages, by slug.
// A picture that has not been captured yet drops out, and an empty gallery goes with it.
const PICS={
 'chicken':[['animal-chicken.jpg','A chicken']],'boar':[['animal-boar.jpg','A boar']],'stag':[['animal-stag.jpg','A stag']],
 'wolf':[['animal-wolf.jpg','A wolf closing in']],'bear':[['animal-bear.jpg','A bear']],
 'mutant-wolf':[['animal-mutant-wolf.jpg','A mutant wolf charging'],['mutant-sack.jpg','The loot sack it leaves beside its body']],
 'mutant-bear':[['animal-mutant-bear.jpg','A mutant bear charging'],['mutant-sack.jpg','The loot sack a mutant leaves beside its body']],
 'mutant-loot-sack':[['mutant-sack.jpg','A mutant loot sack beside a dead mutant wolf'],['mutant-sack-loot.jpg','Searching the sack']],
 'supply-crate':[['airdrop-crate.jpg','A supply crate coming down on its parachute'],['airdrop-plane.jpg','The C130 that drops it'],['airdrop-smoke.jpg','A supply signal calling a drop']],
};
function pictures(slug){
 const list=PICS[slug];if(!list)return null;
 const box=el('div',{class:'detail-pics','data-n':String(list.length)});
 for(const [file,caption] of list){const img=el('img',{src:'/site/generated/media/guides/'+file,alt:caption,loading:'lazy'}),fig=el('figure',{},img,el('figcaption',{text:caption}));
  img.addEventListener('error',()=>{fig.remove();if(!box.children.length)box.remove();else box.dataset.n=String(box.children.length);});box.append(fig);}
 return box;
}
async function animalPage(a,d){
 crumbs([label('animals'),'/wiki/animals'],[a.name]);const [items,res]=await Promise.all([data('items'),data('resources')]),bySlug=new Map((items?.entries??[]).map(i=>[i.slug,i]));
 const drop=a.drop?res?.loot?.find(c=>c.slug===a.drop):null,dmg=a.attack?(a.attack.damage[0]===a.attack.damage[1]?a.attack.damage[0]:a.attack.damage.join('–')):null;
 page(a.name,el('header',{class:'detail-head'},el('div',{},el('h1',{class:'h',text:a.name}),el('span',{class:'type-chip mono '+(a.hostile?'rad':''),text:a.hostile?'Hostile':'Passive'}))),
  stats([['Health',a.health],['Bite',dmg],['Bites every',a.attack?a.attack.rate+' s':null],['Walk',a.walkSpeed!=null?a.walkSpeed+' m/s':null],['Run',a.runSpeed!=null?a.runSpeed+' m/s':null]]),
  pictures(a.slug),
  a.yields?.length?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Harvest'}),el('div',{class:'ings'},a.yields.map(y=>bySlug.get(y.slug)?itemLink(bySlug.get(y.slug),y.min===y.max?y.min:`${y.min}–${y.max}`):el('span',{text:y.name})))):null,
  drop?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Drops on death'}),
   el('p',{},'Every kill leaves a ',el('a',{href:'/wiki/resources/'+drop.slug,text:drop.name}),` beside the body: ${drop.contents.length} possible items, including blueprints and research kits. It disappears after ${Math.round(drop.lifetime/60)} minutes or once emptied.`)):null,
  source(d.source));
}
async function resourcePage(n,d){
 crumbs([label('resources'),'/wiki/resources'],[n.name]);const items=await data('items'),bySlug=new Map((items?.entries??[]).map(i=>[i.slug,i]));
 const crate=Boolean(n.contents),ani=crate&&n.droppedBy?await data('animals'):null;
 // Where the container comes from: crate spots on the map, an airdrop, or a mutant's body.
 const where=n.kind==='airdrop'?el('p',{},'Comes down on a parachute in an ',el('a',{href:'/wiki/guides/airdrops',text:'airdrop'}),`. It disappears ${Math.round(n.lifetime/60)} minutes after it appears, or once emptied.`)
  :n.kind==='drop'&&n.droppedBy?el('p',{},'Left beside the body every time you kill a ',...n.droppedBy.flatMap((s,i)=>{const a=ani?.entries.find(x=>x.slug===s);return [i?' or a ':'',el('a',{href:'/wiki/animals/'+s,text:a?.name??s})];}),
   `. It disappears ${Math.round(n.lifetime/60)} minutes after the kill, or once emptied.`)
  :n.kind==='crate'?el('p',{},'Spawns at the crate spots on ',el('a',{href:'/island',text:'The Island'}),' and refills after it is looted.'):null;
 const lootLink=c=>c.blueprint?el('a',{class:'cell-item',href:'/wiki/recipes/'+c.slug},icon(bySlug.get(c.slug)?.icon,'sm'),el('span',{text:c.name}),el('span',{class:'type-chip mono',text:'Blueprint'}))
  :bySlug.get(c.slug)?itemLink(bySlug.get(c.slug)):c.name;
 const KIND={crate:'Loot crate',airdrop:'Airdrop',drop:'Dropped by mutants'};
 page(n.name,el('header',{class:'detail-head'},el('div',{},el('h1',{class:'h',text:n.name}),el('span',{class:'type-chip mono',text:crate?KIND[n.kind]??'Loot crate':'Resource node'}))),
  crate?[stats([['Rolls',rollsLabel(n.rolls)],['Slots',n.slots],['Items',n.contents.length],['Lasts',n.lifetime?Math.round(n.lifetime/60)+' min':null]]),where,pictures(n.slug),el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Contents · chance per roll'}),
   table([{label:'Item'},{label:'Amount',num:1},{label:'Chance',num:1}],[...n.contents].sort((a,b)=>(b.chance??0)-(a.chance??0)).map(c=>[lootLink(c),c.min===c.max?c.min:`${c.min}–${c.max}`,chanceLabel(c.chance)])))]
   :[stats([['Gather ×',n.gatherEfficiency]]),el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Yields'}),el('div',{class:'ings'},n.yields.map(y=>bySlug.get(y.slug)?itemLink(bySlug.get(y.slug),`${y.min}–${y.max}`):null)))],
  source(d.source));
}
async function placePage(p,d){
 crumbs([label('places'),'/wiki/places'],[p.title]);const rad=(await data('radiation'))?.entries.filter(z=>z.place?.slug===p.slug)??[];
 page(p.title,el('header',{class:'detail-head'},el('div',{},el('h1',{class:'h',text:p.title}),el('span',{class:'type-chip mono',text:(p.features??[]).slice(1,4).join(' · ')||p.kind}))),
  stats([['Structures',p.structures],['Rad/min',p.rad||null,'rad'],['X',p.x],['Z',p.z]]),
  rad.length?el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Radiation'}),el('ul',{class:'art-list'},rad.map(z=>el('li',{},el('a',{href:'/wiki/radiation/'+z.slug},el('span',{text:z.title}),el('span',{class:'rad mono',text:z.exposure+'/min'})))))):null,
  await mapSnippet(p.x,p.z,p.slug),source(d.source));
}
async function radiationPage(z,d){
 crumbs([label('radiation'),'/wiki/radiation'],[z.title]);const items=await data('items');
 const suit=(items?.entries??[]).filter(i=>/^Rad Suit/.test(i.name)),suitTotal=suit.reduce((s,i)=>s+(i.props.protection?.radiation??0),0),pills=items?.entries.find(i=>i.props.antiRads);
 page(z.title,el('header',{class:'detail-head'},el('div',{},el('h1',{class:'h',text:z.title}),el('span',{class:'type-chip mono rad',text:'Radiation zone'}))),
  stats([['Rad/min',z.exposure,'rad'],['Radius',z.r+' m'],['Rad suit',suitTotal||null],['Pills',pills?.props.antiRads??null]]),
  el('section',{class:'wiki-sec'},el('h2',{class:'mono',text:'Protection'}),el('div',{class:'ings'},suit.map(i=>itemLink(i,null)),pills?itemLink(pills):null)),
  z.place?el('p',{},el('a',{class:'btn small',href:'/wiki/places/'+z.place.slug,text:z.place.title})):null,
  await mapSnippet(z.x,z.z),source(d.source));
}
// A small modern-map view centred on a point, with a link into The Island.
async function mapSnippet(x,z,place){
 const href=`/island?layer=modern&x=${x}&z=${z}&zoom=4${place?'&place='+place:''}`;
 const box=el('div',{class:'snippet-map'}),wrap=el('section',{class:'wiki-sec snippet'},el('div',{class:'sec-h'},el('h2',{class:'mono',text:'Map'}),el('a',{class:'btn small',href,text:'Open on the island'})),box);
 const [map,manifest]=await Promise.all([fetch('/site/generated/map/modern.json').then(r=>r.ok?r.json():null).catch(()=>null),fetch('/site/generated/map/modern/manifest.json').then(r=>r.ok?r.json():null).catch(()=>null)]);
 if(!map||!manifest)return null;
 const {mountMap}=await import('./map-viewer.mjs');
 requestAnimationFrame(()=>mountMap(box,{layers:{modern:{manifest,base:'/site/generated/map/modern/'},aerial:null,classic:null},data:map,initial:{layer:'modern',x,z,zoom:4}}));
 return wrap;
}
async function articlePage(a,sec){
 crumbs([label(a.section),'/wiki/'+a.section],[a.title]);
 if(sec!==a.section)history.replaceState(null,'',`/wiki/${a.section}/${a.slug}`);
 page(a.title,el('header',{class:'detail-head'},el('div',{},el('h1',{class:'h',text:a.title}),el('span',{class:'type-chip mono',text:label(a.section)}))),
  el('article',{class:'prose',html:a.html}),
  el('p',{class:'source mono'},`Updated ${new Date(a.updatedAt).toISOString().slice(0,10)} by ${a.updatedBy}`,el('a',{class:'staff-only',href:'/wiki/edit/'+a.slug,text:' · Edit'})));
}
// A crate's number of picks from its loot list, e.g. 1–2.
const rollsLabel=r=>!r?null:r[0]===r[1]?String(r[0]):r[0]+'–'+r[1];
// A screenshot that may not exist yet (generated on the server): drop it rather than show a broken image.
function shot(src,cls){const img=el('img',{src,alt:'',class:cls,loading:'lazy'});img.addEventListener('error',()=>img.replaceWith(el('span',{class:cls+' none','aria-hidden':'true'})));return img;}
// Guide pages: markdown from site/content/guides with item icons and map links resolved from the wiki data.
async function guidePage(slug){
 const [r,items,places,idx]=await Promise.all([fetch('/site/content/guides/'+encodeURIComponent(slug)+'.md').catch(()=>null),data('items'),data('places'),data('guides')]);
 if(!r?.ok)return notFound();
 const {meta,body}=parseFrontMatter(await r.text()),key=s=>s.trim().toLowerCase();
 const itemMap=new Map((items?.entries??[]).map(i=>[key(i.name),i])),placeMap=new Map((places?.entries??[]).map(p=>[key(p.title),p]));
 const art=el('article',{class:'prose guide',html:renderMarkdown(body,{resolveItem:n=>itemMap.get(key(n))??null,resolvePlace:n=>placeMap.get(key(n))??null})});
 // Pictures become figures captioned with their alt text; ones not captured yet are removed.
 for(const img of art.querySelectorAll('img:not(.wiki-item img)')){if(img.closest('.wiki-item'))continue;const fig=el('figure',{});img.replaceWith(fig);fig.append(img);
  if(img.alt)fig.append(el('figcaption',{text:img.alt}));img.addEventListener('error',()=>fig.remove());}
 const list=groupGuides(idx?.entries??[]).flatMap(([,l])=>l),i=list.findIndex(g=>g.slug===slug),prev=list[i-1],next=list[i+1];
 crumbs([label('guides'),'/wiki/guides'],[meta.title]);
 page(meta.title,el('header',{class:'detail-head'},el('div',{},el('h1',{class:'h',text:meta.title}),el('span',{class:'type-chip mono',text:meta.group??'Guide'}))),
  meta.summary?el('p',{class:'lede',text:meta.summary}):null,guideHero(meta.image,body)?shot(meta.image,'guide-hero'):null,art,
  el('nav',{class:'guide-nav','aria-label':'More guides'},prev?el('a',{href:'/wiki/guides/'+prev.slug},el('span',{class:'mono',text:'Previous'}),el('b',{text:prev.title})):el('span'),next?el('a',{class:'next',href:'/wiki/guides/'+next.slug},el('span',{class:'mono',text:'Next'}),el('b',{text:next.title})):null),
  el('p',{class:'source mono'},'Numbers from the original game data and code'));
}
async function calculatorPage(){
 crumbs(['Calculator']);const [items,recipes]=await Promise.all([data('items'),data('recipes')]);
 if(!items||!recipes)return missingData();
 const {calculator}=await import('./calculator.mjs');
 page('Resource calculator',calculator({items,recipes,el,icon}),source(recipes.source));
}
function notFound(){crumbs(['Not found']);page('Not found',pending('Page not found','Search the wiki or pick a section.'));}

// Search: search.json plus article titles; "/" focuses, arrows move, Enter opens.
function bindSearch(){
 const input=$('#wiki-q'),list=$('#wiki-results');let index=null,results=[],active=-1;
 const load=async()=>{if(index)return index;const [idx,arts]=await Promise.all([data('search'),articles()]);
  const guides=(await data('guides'))?.entries??[];
  index=[{t:'Resource calculator',u:'/wiki/calculator',s:'Tool',k:'calculator cost craft build resources raid sulfur gunpowder how many'},...guides.map(g=>({t:g.title,u:'/wiki/guides/'+g.slug,s:'Guides',k:`${g.summary} ${g.tags} ${g.group}`.toLowerCase()})),...(Array.isArray(idx)?idx:[]),...arts.map(a=>({t:a.title,u:`/wiki/${a.section}/${a.slug}`,s:'Article',k:a.section}))];return index;};
 const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
 const mark=()=>{[...list.children].forEach((li,i)=>li.setAttribute('aria-selected',String(i===active)));if(active>=0)input.setAttribute('aria-activedescendant','wr-'+active);};
 input.addEventListener('focus',load,{once:true});
 input.addEventListener('input',async()=>{await load();results=rankSearch(index,input.value);active=results.length?0:-1;
  list.replaceChildren(...(results.length?results.map((r,i)=>el('li',{role:'option',id:'wr-'+i,onmousedown:e=>{e.preventDefault();location.href=r.u;}},el('span',{text:r.t}),el('span',{class:'mono muted',text:r.s}))):
   input.value.trim()?[el('li',{class:'none',role:'option','aria-disabled':'true',text:'No results'})]:[]));
  list.hidden=!list.children.length;input.setAttribute('aria-expanded',String(!list.hidden));mark();});
 input.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(!results.length)return;e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+results.length)%results.length;mark();}
  else if(e.key==='Enter'){if(results[active]){e.preventDefault();location.href=results[active].u;}}
  else if(e.key==='Escape'){close();input.blur();}});
 input.addEventListener('blur',()=>setTimeout(close,100));
 document.addEventListener('keydown',e=>{if(e.key==='/'&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)&&!e.ctrlKey&&!e.metaKey){e.preventDefault();input.focus();}});
}

bindSearch();
const {section:sec,slug}=routeOf(location.pathname);
rail(sec);
await (slug?detail(sec,slug):sec?section(sec):home());
