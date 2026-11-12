// The Island page: loads the generated map data, mounts the viewer, wires layers, overlays, search and the place card.
import {mountMap} from './map-viewer.mjs';
import {gridLabel} from './map-viewer-math.mjs';

const $=s=>document.querySelector(s),G='/site/generated/map/';
const json=url=>fetch(url).then(r=>r.ok?r.json():null).catch(()=>null);
const [data,modern,aerial,classic]=await Promise.all([json(G+'modern.json'),json(G+'modern/manifest.json'),json(G+'aerial/manifest.json'),json(G+'classic.json')]);
const layers={modern:modern&&data?{manifest:modern,base:G+'modern/'}:null,aerial:aerial?{manifest:aerial,base:G+'aerial/'}:null,classic:classic?{...classic,image:G+classic.image}:null};
const q=new URLSearchParams(location.search),num=k=>q.has(k)&&Number.isFinite(Number(q.get(k)))?Number(q.get(k)):null;
const firstLayer=['modern','aerial','classic'].find(n=>layers[n])??'modern';
let layer=['modern','aerial','classic'].includes(q.get('layer'))?q.get('layer'):firstLayer;
export const slugOf=p=>`${p.title}-${p.x}-${p.z}`.toLowerCase().replace(/[^a-z0-9]+/g,'-');

if(!data&&!aerial&&!classic){
 $('#map').innerHTML='<div class="pending map-missing"><b>Map not generated yet</b><span>Run npm run build:site on the server to create the island maps.</span></div>';
 document.body.dataset.ready='1';
}else{
 const places=data?.places??[];
 const map=mountMap($('#map'),{layers,data,initial:{layer,x:num('x'),z:num('z'),zoom:num('zoom')},onSelect:select,onView:remember,onPick:showFeature,elevationUrl:data?.elevation?G+data.elevation.file:null});

 // Stats: numbers with short labels.
 const stat=(n,label)=>{const d=document.createElement('div');d.className='stat';d.innerHTML='<b></b><span class="mono"></span>';d.querySelector('b').textContent=n;d.querySelector('span').textContent=label;return d;};
 $('#island-stats').replaceChildren(stat(places.length,'Places'),stat(data?.loot?.length??'—','Crates'),stat(data?.rad.length??'—','Rad zones'),stat(data?.zones?.filter(z=>z.kind==='mutant').length??'—','Mutant zones'));

 // Layer control and compare.
 const ctl=$('#layer-ctl');
 function syncLayers(){ctl.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layer===layer)));map.setLayer(layer);
  if($('#compare').checked)map.setCompare(['aerial','modern','classic'].find(n=>n!==layer&&layers[n])??null);else map.setCompare(null);}
 ctl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;layer=b.dataset.layer;syncLayers();remember(map.view);});
 $('#compare').addEventListener('change',syncLayers);
 document.querySelectorAll('[data-overlay]').forEach(c=>c.addEventListener('change',()=>map.toggle(c.dataset.overlay,c.checked)));
 syncLayers();

 // Sidebar list grouped like the map legend; search filters it.
 const groups=[['Compounds',p=>['smokestack','warehouse','hangar','tank','oiltank','apartment'].includes(p.kind)],['Sites',()=>true]];
 function list(filter=''){
  const f=filter.trim().toLowerCase(),seen=new Set(),frag=document.createDocumentFragment();
  for(const [name,test] of groups){
   const items=places.filter(p=>!seen.has(p)&&test(p)&&(!f||p.title.toLowerCase().includes(f)||p.features.some(x=>x.toLowerCase().includes(f))));
   items.forEach(p=>seen.add(p));if(!items.length)continue;
   const h=document.createElement('h2');h.textContent=name;frag.append(h);
   for(const p of items.sort((a,b)=>b.rad-a.rad||b.structures-a.structures)){
    const b=document.createElement('button');b.type='button';b.dataset.id=p.id;b.innerHTML='<span></span><span class="n"></span>';b.firstChild.textContent=p.title;
    const n=b.lastChild;n.textContent=p.rad?`${p.rad} rad`:`${p.structures}`;if(p.rad)n.classList.add('hot');
    b.addEventListener('click',()=>{select(p);map.flyTo([p.x,p.z],5);if(matchMedia('(max-width:900px)').matches)$('#map').scrollIntoView({behavior:'smooth',block:'center'});});frag.append(b);
   }
  }
  if(!frag.childNodes.length){const e=document.createElement('p');e.className='muted';e.textContent='No places match.';frag.append(e);}
  $('#place-list').replaceChildren(frag);
 }
 $('#place-q').addEventListener('input',e=>list(e.target.value));list();

 // A clicked crate spot or zone: what spawns there (static data from the game files).
 const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 function showFeature(f){
  if(!f||f.type==='point')return;
  document.querySelectorAll('#place-list button').forEach(b=>b.setAttribute('aria-current','false'));map.select(null);
  const card=$('#place-card'),h=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
  const dl=document.createElement('dl'),row=(k,v,cls)=>{const dt=h('dt',k),dd=h('dd',String(v),cls);dl.append(dt,dd);};
  const link=(text,href)=>{const a=h('a',text,'btn small');a.href=href;return a;};
  const title={crate:'Crate spawn',mutant:'Mutant zone',rad:'Radiation zone',animals:'Wildlife zone',resources:'Resource zone',nobuild:'No-build zone'}[f.type];
  const kids=[h('h2',title)],actions=document.createElement('div');actions.className='actions';
  if(f.type==='crate'){
   const odds=document.createElement('div');odds.className='odds';
   for(const c of f.crates){const d=document.createElement('div');const bar=document.createElement('i'),fill=document.createElement('b');fill.style.width=c.chance*100+'%';bar.append(fill);
    const a=h('a',c.name);a.href='/wiki/resources/'+slug(c.name);d.append(a,h('span',Math.round(c.chance*100)+'%'),bar);odds.append(d);}
   kids.push(odds);row('Respawn',f.respawn[0]+'–'+f.respawn[1]+' min');actions.append(link('Loot crates','/wiki/resources'));
  }else if(f.type==='rad'){row('Rad/min',f.exposure,'rad');row('Radius',f.r+' m');actions.append(link('Radiation','/wiki/radiation'));}
  else if(f.type==='nobuild'){row('Radius',f.r+' m');kids.push(h('p','Nothing can be placed inside.','features'));}
  else{const list=f.type==='resources'?f.resources:[...f.animals,...(f.type==='animals'?f.resources:[])];
   for(const a of list)row(a.name,'×'+a.count);row('Radius',f.r+' m');
   for(const a of f.animals.slice(0,2))actions.append(link(a.name,'/wiki/animals/'+slug(a.name)));}
  row('Grid',gridLabel([f.x,f.z],data.window));row('X · Z',f.x+' · '+f.z);
  kids.push(dl,actions);card.replaceChildren(...kids);card.hidden=false;
  if(matchMedia('(max-width:900px)').matches)card.scrollIntoView({behavior:'smooth',block:'nearest'});
 }
 function select(p){
  map.select(p.id);document.querySelectorAll('#place-list button').forEach(b=>b.setAttribute('aria-current',String(b.dataset.id===p.id)));
  const card=$('#place-card');card.hidden=false;
  card.innerHTML='<h2></h2><p class="features"></p><dl></dl><div class="actions"><a class="btn small" data-wiki>Wiki page</a><button class="btn small" type="button" data-zoom>Zoom in</button></div>';
  card.querySelector('h2').textContent=p.title;card.querySelector('.features').textContent=p.features.join(' · ');
  const dl=card.querySelector('dl');
  for(const [k,v,cls] of [['Structures',p.structures],['Radiation',p.rad?`${p.rad}/min`:'None',p.rad?'rad':''],['Grid',gridLabel([p.x,p.z],data.window)],['X · Z',`${p.x} · ${p.z}`]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;if(cls)dd.className=cls;dl.append(dt,dd);}
  card.querySelector('[data-wiki]').href='/wiki/places/'+slugOf(p);
  card.querySelector('[data-zoom]').addEventListener('click',()=>map.flyTo([p.x,p.z],8));
 }
 // Shareable view: layer and position in the address bar (debounced).
 let t=0;function remember(v){if(!v)return;clearTimeout(t);t=setTimeout(()=>{const p=new URLSearchParams({layer,x:Math.round(v.cx),z:Math.round(v.cz),zoom:(v.scale/v.fit).toFixed(2)});history.replaceState(null,'',location.pathname+'?'+p);},300);}
 const focus=q.get('place');if(focus){const p=places.find(x=>slugOf(x)===focus||x.id===focus);if(p){select(p);map.flyTo([p.x,p.z],5);}}
 document.body.dataset.ready='1';
}
