// Roadmap (/roadmap): the dated story from /site/content/roadmap/index.json (central/roadmap.mjs builds it from the
// markdown in site/content/roadmap/), with a sticky date list on desktop, galleries and the "What's coming" section.
import {renderMarkdown} from './markdown.mjs';
import {entryText,matcher} from './roadmap-search.mjs';

const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k==='html')e.innerHTML=v;else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(Boolean));return e;};
const day=d=>new Date(d+'T00:00:00Z'),DAY=864e5;
const fmt=(d,o)=>day(d).toLocaleDateString('en-GB',{timeZone:'UTC',...o});
const short=d=>fmt(d,{day:'2-digit',month:'short'});
// "17 Oct 2026" or "17–18 Oct 2026"
function when(e){
 if(!e.end||e.end===e.date)return fmt(e.date,{day:'2-digit',month:'short',year:'numeric'});
 const a=day(e.date),b=day(e.end),same=a.getUTCMonth()===b.getUTCMonth();
 return (same?fmt(e.date,{day:'2-digit'}):short(e.date))+'–'+fmt(e.end,{day:'2-digit',month:'short',year:'numeric'});
}
const pending=(t,s)=>el('div',{class:'pending'},el('b',{text:t}),el('span',{text:s}));
const figs=stats=>stats.length?el('dl',{class:'rm-figs'},stats.map(s=>el('div',{},el('dt',{text:s.label}),el('dd',{text:s.value})))):null;
// "Test run: …" / "Test scene: …" captions get a tag, so harness captures read as such.
function caption(text){
 const m=/^(Test (?:run|scene)):\s*(.*)$/.exec(text);
 return el('figcaption',{},m?el('span',{class:'rm-tag',text:m[1]}):null,m?m[2].charAt(0).toUpperCase()+m[2].slice(1):text);
}
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
// Clips play muted while on screen (unless reduced motion is asked for); controls stay available.
const clips=reduced?null:new IntersectionObserver(list=>{for(const x of list){const v=x.target;if(x.isIntersecting)v.play().catch(()=>{});else v.pause();}},{threshold:.6});

// The first item of a gallery is shown large (clips with controls); the smaller ones open in the viewer.
function media(m,large){
 let node;
 if(m.type==='video'){
  const v=el('video',{src:m.src,poster:m.poster,muted:'',loop:'',playsinline:'',controls:large?'':null,preload:'none','aria-label':m.caption||'Clip'});
  v.muted=true;v.addEventListener('error',()=>v.closest('figure')?.remove());clips?.observe(v);
  node=large?v:el('button',{class:'rm-zoom rm-clip',type:'button','aria-label':'Play: '+(m.caption||'clip')},v);
 }else node=el('button',{class:'rm-zoom',type:'button','aria-label':'Enlarge: '+(m.caption||'picture')},el('img',{src:m.src,alt:m.caption,loading:'lazy'}));
 if(node.tagName==='BUTTON')node.addEventListener('click',()=>view(m));
 node.querySelector?.('img')?.addEventListener('error',()=>node.closest('figure')?.remove());
 return el('figure',{class:'rm-fig'},node,m.caption?caption(m.caption):null);
}
// The viewer: a picture, or a clip with controls and sound available.
function view(m){
 const d=$('#rm-view'),box=d.querySelector('.rm-view-media');
 box.replaceChildren(m.type==='video'?el('video',{src:m.src,poster:m.poster,controls:'',autoplay:'',loop:'',playsinline:'','aria-label':m.caption||'Clip'}):el('img',{src:m.src,alt:m.caption}));
 d.querySelector('p').textContent=m.caption;d.showModal();
}
$('#rm-view').addEventListener('close',e=>e.currentTarget.querySelector('.rm-view-media').replaceChildren());
$('#rm-view').addEventListener('click',e=>{if(e.target.id==='rm-view')e.currentTarget.close();});

// Progress bar: the public GitHub journal's figures (central/progress.mjs). The bar fills and the number counts up
// once, unless reduced motion is asked for. Without figures only the GitHub and Discord links stay.
async function progressBar(){
 const p=await fetch('/site/content/progress.json').then(r=>r.ok?r.json():null).catch(()=>null),sec=$('#rm-progress');
 if(!(p?.overall>=0)){sec.classList.add('no-figures');return;}
 const bar=$('#rm-bar'),pct=$('#rm-pct');bar.setAttribute('aria-valuenow',String(p.overall));bar.setAttribute('aria-valuetext',p.overall+'%');
 $('#rm-progress-src').textContent='From the public journal on GitHub'+(p.date?' · '+fmt(p.date,{day:'numeric',month:'short',year:'numeric'}):'');
 $('#rm-areas').replaceChildren(...(p.areas??[]).map(a=>el('li',{},el('span',{class:'rm-area-name',text:a.name}),el('b',{text:a.pct+'%'}),el('i',{'data-pct':String(a.pct)},el('s')))));
 const fill=()=>{bar.querySelector('i').style.width=p.overall+'%';for(const i of document.querySelectorAll('#rm-areas i'))i.firstChild.style.width=i.dataset.pct+'%';sec.classList.add('filled');};
 if(reduced){pct.textContent=p.overall+'%';fill();return;}
 requestAnimationFrame(()=>requestAnimationFrame(fill));
 const t0=performance.now(),D=1600,step=t=>{const k=Math.min(1,(t-t0)/D),e=1-Math.pow(1-k,3);pct.textContent=Math.round(p.overall*e)+'%';if(k<1)requestAnimationFrame(step);};
 requestAnimationFrame(step);
}
const progressDone=progressBar();

const data=await fetch('/site/content/roadmap/index.json').then(r=>r.ok?r.json():null).catch(()=>null);
const line=$('#rm-line');line.removeAttribute('aria-busy');
if(!data?.entries?.length)line.replaceWith(pending('Roadmap unavailable','Try again in a moment.'));
else{
 const {entries,coming}=data,first=day(entries[0].date),dayN=d=>Math.round((day(d)-first)/DAY)+1;
 const last=entries.reduce((m,e)=>(e.end??e.date)>m?(e.end??e.date):m,entries[0].date);
 const count=t=>entries.reduce((n,e)=>n+e.media.filter(m=>m.type===t).length,0);
 $('#rm-totals').replaceChildren(...[[dayN(last),'days'],[entries.length,'milestones'],[count('video'),'clips'],[count('image'),'pictures']]
  .filter(([n],i)=>i<2||n>0).map(([n,l])=>el('div',{},el('dt',{text:l}),el('dd',{text:String(n)}))));

 // Entries grouped by the day they started, each day opened by a divider.
 const byDay=new Map();for(const e of entries){if(!byDay.has(e.date))byDay.set(e.date,[]);byDay.get(e.date).push(e);}
 const card=e=>el('li',{class:'rm-entry',id:e.slug},el('article',{class:'rm-card','aria-labelledby':e.slug+'-h'},
  el('header',{class:'rm-card-head'},
   el('p',{class:'rm-meta'},el('time',{datetime:e.date,text:when(e)}),el('span',{text:'Day '+dayN(e.date)+(e.end&&e.end!==e.date?'–'+dayN(e.end):'')})),
   el('h2',{id:e.slug+'-h'},el('a',{href:'#'+e.slug,text:e.title})),
   e.summary?el('p',{class:'rm-sum',text:e.summary}):null),
  e.media.length?el('div',{class:'rm-gallery','data-n':String(e.media.length)},e.media.map((m,i)=>media(m,i===0))):null,
  el('div',{class:'rm-card-body'},figs(e.stats),el('div',{class:'rm-text',html:renderMarkdown(e.body)}))));
 // One day per task: building every card in one go was a 565 ms task on a 4×-slowed phone (blocking taps); the first
 // days (top of the page) still appear at once and the rest follow within the next frames.
 line.replaceChildren();
 for(const [i,[d,list]] of [...byDay].entries()){
  if(i)await new Promise(r=>setTimeout(r,0));
  line.append(el('li',{class:'rm-dayhead',id:'day-'+d},el('span',{class:'rm-daynum',text:'Day '+dayN(d)}),el('span',{text:fmt(d,{weekday:'long',day:'numeric',month:'long',year:'numeric'})})),
   ...list.map(card));
 }

 // Date list beside the entries on desktop; day chips on smaller screens.
 $('#rm-nav').replaceChildren(...[...byDay].map(([d,list])=>el('div',{class:'rm-nav-day'},el('a',{class:'rm-nav-date',href:'#day-'+d,text:'Day '+dayN(d)+' · '+short(d)}),
  el('ul',{},list.map(e=>el('li',{},el('a',{href:'#'+e.slug,'data-slug':e.slug,text:e.title})))))),
  coming?el('div',{class:'rm-nav-day'},el('a',{class:'rm-nav-date next',href:'#coming',text:'Next'}),el('ul',{},el('li',{},el('a',{href:'#coming','data-slug':'coming',text:coming.title})))):null);
 $('#rm-days').replaceChildren(...[...byDay].map(([d])=>el('a',{href:'#day-'+d},el('b',{text:'Day '+dayN(d)}),' '+short(d))),coming?el('a',{class:'next',href:'#coming',text:'Next'}):null);

 // What's coming: each "##" item of the markdown becomes its own card.
 if(coming){
  const sec=$('#coming');sec.hidden=false;
  const body=el('div',{html:renderMarkdown(coming.body)}),items=[];let cur=null;
  for(const n of [...body.childNodes]){if(n.tagName==='H3'){cur=el('div',{class:'rm-next-item'});items.push(cur);}(cur??body).append(n);}
  sec.replaceChildren(el('div',{class:'rm-coming-head'},el('p',{class:'rm-eyebrow',text:'Next'}),el('h2',{id:'coming-h',text:coming.title}),
   coming.summary?el('p',{class:'rm-sum',text:coming.summary}):null,figs(coming.stats)),
   items.length?el('div',{class:'rm-next-grid'},items.map(i=>{i.classList.add('rm-text');return i;})):el('div',{class:'rm-text',html:renderMarkdown(coming.body)}));
 }

 // Highlight the entry being read in the date list.
 const links=new Map([...document.querySelectorAll('#rm-nav a')].map(a=>[a.dataset.slug,a]));
 const seen=new IntersectionObserver(list=>{for(const x of list)if(x.isIntersecting){
  for(const a of links.values())a.removeAttribute('aria-current');
  const a=links.get(x.target.id);if(!a)continue;a.setAttribute('aria-current','true');
  // Keep the current entry visible in the date list when it is taller than the window.
  const nav=$('#rm-nav'),r=a.getBoundingClientRect(),n=nav.getBoundingClientRect();if(r.top<n.top||r.bottom>n.bottom)nav.scrollTop+=r.top-n.top-n.height/3;
 }},{rootMargin:'-30% 0px -60% 0px'});
 for(const n of [...document.querySelectorAll('.rm-entry'),$('#coming')])if(!n.hidden)seen.observe(n);
 if(location.hash)document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();

 // Search: entries that don't match every word hide, with days left empty in the timeline, the date list and the day
 // chips. The query stays in the address (?q=) so a search can be shared; Esc clears it, "/" jumps to the box.
 const texts=new Map(entries.map(e=>[e.slug,entryText(e)])),comingText=coming?entryText(coming):'';
 const q=$('#rm-q'),counter=$('#rm-search-count'),none=$('#rm-none');
 function search(){
  const m=matcher(q.value),active=q.value.trim().length>0;let shown=0;
  for(const [d,list] of byDay){let any=false;
   for(const e of list){const ok=m(texts.get(e.slug));document.getElementById(e.slug).hidden=!ok;if(ok){any=true;shown++;}}
   document.getElementById('day-'+d).hidden=!any;}
  for(const a of document.querySelectorAll('#rm-nav li a[data-slug]'))a.closest('li').hidden=a.dataset.slug==='coming'?!m(comingText):!m(texts.get(a.dataset.slug));
  for(const div of document.querySelectorAll('#rm-nav .rm-nav-day'))div.hidden=[...div.querySelectorAll('li')].every(li=>li.hidden);
  for(const a of document.querySelectorAll('#rm-days a')){const h=a.getAttribute('href');a.hidden=h==='#coming'?Boolean(coming)&&!m(comingText):Boolean(document.getElementById(h.slice(1))?.hidden);}
  if(coming)$('#coming').hidden=!m(comingText);
  counter.textContent=active?`${shown} of ${entries.length} entries`:'';
  none.hidden=!active||shown>0||(coming&&m(comingText));none.querySelector('b').textContent=`“${q.value.trim()}”`;
  const u=new URL(location.href);if(active)u.searchParams.set('q',q.value.trim());else u.searchParams.delete('q');history.replaceState(null,'',u);
 }
 let timer=0;q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(search,120);});
 q.addEventListener('keydown',e=>{if(e.key==='Escape'&&q.value){q.value='';search();}});
 addEventListener('keydown',e=>{if(e.key==='/'&&!e.target.closest?.('input,textarea,select,[contenteditable]')){e.preventDefault();q.focus();}});
 const initial=new URLSearchParams(location.search).get('q');if(initial){q.value=initial;search();}
}
await progressDone;
document.body.dataset.ready='1';
