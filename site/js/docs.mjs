// Help (/docs and /docs/<slug>): the groups from the generated index (tools/build-site.mjs content → docs.json), and one
// page rendered from its markdown in site/content/docs, with the rest of its group beside it.
import {renderMarkdown,parseFrontMatter} from './markdown.mjs';

export const DOC_GROUPS=['Playing online','Running a server','Server teams','Site staff'];
const groupId=g=>g.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k==='html')e.innerHTML=v;else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(Boolean));return e;};
const pending=(t,s)=>el('div',{class:'pending'},el('b',{text:t}),el('span',{text:s}));
import {downloadBox} from './downloads-box.mjs';
export {releaseFacts} from './downloads-box.mjs';
const DOWNLOAD_PAGES={'install-the-host-app':'host','the-game-loader':'loader'};
// Groups in DOC_GROUPS order (unknown groups last), pages by `order` then title.
export function groupDocs(docs){
 const by=new Map();for(const d of docs){if(!by.has(d.group))by.set(d.group,[]);by.get(d.group).push(d);}
 const rank=g=>{const i=DOC_GROUPS.indexOf(g);return i<0?DOC_GROUPS.length:i;};
 return [...by].sort((a,b)=>rank(a[0])-rank(b[0])||a[0].localeCompare(b[0])).map(([group,list])=>({group,id:groupId(group),docs:list.sort((a,b)=>(a.order??99)-(b.order??99)||a.title.localeCompare(b.title))}));
}

if(typeof document!=='undefined'){
 const index=await fetch('/site/generated/content/docs.json').then(r=>r.ok?r.json():null).catch(()=>null);
 if(document.body.dataset.page==='docs'){
  const box=$('#docs-groups');box.removeAttribute('aria-busy');
  if(!index)box.replaceChildren(pending('Help not built yet','Run npm run build:site on the server.'));
  else box.replaceChildren(...groupDocs(index).map(g=>el('section',{class:'docs-group',id:g.id,'aria-labelledby':g.id+'-h'},
   el('h2',{class:'mono',id:g.id+'-h',text:g.group}),
   el('ul',{},g.docs.map(d=>el('li',{},el('a',{href:'/docs/'+d.slug},el('b',{text:d.title}),d.summary?el('span',{text:d.summary}):null)))))));
 }else{
  const slug=location.pathname.split('/').filter(Boolean)[1],art=$('#doc-article');art.removeAttribute('aria-busy');
  const r=await fetch(`/site/content/docs/${slug}.md`).catch(()=>null);
  if(!r?.ok)art.replaceChildren(pending('Page not found','It may have moved. See all help pages.'));
  else{
   const {meta,body}=parseFrontMatter(await r.text());document.title=`${meta.title} · Help · Rust Legacy Browser`;
   $('.crumbs').append(el('a',{href:'/docs#'+groupId(meta.group??''),text:meta.group??''}),el('span',{text:meta.title}));
   // replaceChildren stringifies a bare null/undefined argument to the text "null" instead of skipping it (unlike
   // el()'s own append, which filters falsy children) — so the optional download box is filtered out here first.
   art.replaceChildren(...[el('header',{},el('p',{class:'mono doc-group',text:meta.group??''}),el('h1',{class:'h',text:meta.title}),meta.summary?el('p',{class:'lede',text:meta.summary}):null),
    DOWNLOAD_PAGES[slug]?await downloadBox(DOWNLOAD_PAGES[slug]):null,
    el('div',{class:'prose',html:renderMarkdown(body)})].filter(Boolean));
   const group=index?groupDocs(index).find(g=>g.group===meta.group):null;
   if(group)$('#doc-side').replaceChildren(el('p',{class:'mono',text:group.group}),
    el('ul',{},group.docs.map(d=>el('li',{},el('a',{href:'/docs/'+d.slug,...(d.slug===slug?{'aria-current':'page'}:{}),text:d.title})))),
    el('p',{},el('a',{class:'mono',href:'/docs',text:'All help'})));
  }
 }
 document.body.dataset.ready='1';
}
