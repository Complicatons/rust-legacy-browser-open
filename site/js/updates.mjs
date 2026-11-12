// Updates: the list (/updates) from the generated index, and one entry (/updates/<slug>) rendered from its markdown.
import {renderMarkdown,parseFrontMatter} from './markdown.mjs';

const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k==='html')e.innerHTML=v;else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(Boolean));return e;};
const fmt=d=>new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).toUpperCase();
// Generated screenshots load as their WebP copy (tools/site-webp.mjs: the list's 220-px thumbnails take the 480-px one;
// 2.6 MB of JPEGs on /updates before), then the JPEG if that is missing; absent altogether (not built yet), the frame goes.
const webpFor=(src,width)=>{const m=/^\/site\/generated\/media\/([a-z0-9-]+)\.jpg$/.exec(src??'');return m&&!m[1].startsWith('share-')?`/site/generated/media/${m[1]}${width?'-'+width:''}.webp`:null;};
const shot=(src,cls,width=null)=>{if(!src)return null;const webp=webpFor(src,width),img=el('img',{src:webp??src,alt:'',class:cls,loading:'lazy'});
 img.addEventListener('error',()=>{if(webp&&img.getAttribute('src')===webp)img.src=src;else img.remove();});return img;};
const pending=(t,s)=>el('div',{class:'pending'},el('b',{text:t}),el('span',{text:s}));
const index=await fetch('/site/generated/content/updates.json').then(r=>r.ok?r.json():null).catch(()=>null);

if(document.body.dataset.page==='updates'){
 const list=$('#up-list');list.removeAttribute('aria-busy');
 if(!index)list.replaceWith(pending('Updates not built yet','Run npm run build:site on the server.'));
 else{$('#up-count').textContent=String(index.length);
  list.replaceChildren(...index.map(u=>el('li',{},el('a',{href:'/updates/'+u.slug},el('time',{class:'mono',datetime:u.date,text:fmt(u.date)}),
   el('div',{class:'up-text'},el('h2',{text:u.title}),el('p',{text:u.summary})),shot(u.image,'up-thumb',480)))));}
}else{
 const slug=location.pathname.split('/').filter(Boolean)[1],art=$('#up-article');art.removeAttribute('aria-busy');
 const r=await fetch(`/site/content/updates/${slug}.md`).catch(()=>null);
 if(!r?.ok)art.replaceChildren(pending('Update not found','It may have moved. See all updates.'));
 else{const {meta,body}=parseFrontMatter(await r.text());document.title=`${meta.title} · Updates · Rust Legacy Browser`;
  $('.crumbs').append(el('span',{text:meta.title}));
  art.replaceChildren(el('header',{},el('time',{class:'mono',datetime:meta.date,text:fmt(meta.date)}),el('h1',{class:'h',text:meta.title}),meta.summary?el('p',{class:'lede',text:meta.summary}):null),
   shot(meta.image,'up-hero'),el('div',{class:'prose',html:renderMarkdown(body)}));
  const i=index?.findIndex(u=>u.slug===slug)??-1;
  if(i>=0){const newer=index[i-1],older=index[i+1];
   $('#up-nav').replaceChildren(...[[older,'Older'],[newer,'Newer']].filter(x=>x[0]).map(([u,l])=>el('a',{href:'/updates/'+u.slug,class:'up-nav-'+l.toLowerCase()},el('span',{class:'mono',text:l}),el('b',{text:u.title}))));}}
}
document.body.dataset.ready='1';
