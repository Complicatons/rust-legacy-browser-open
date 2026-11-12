// Staff article editor (/wiki/edit, /wiki/edit/<slug>): title, address, section, text with live preview, change note,
// history with restore. Saves through PUT /wiki/api/articles/<slug>; everyone else sees the staff-only notice.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {renderMarkdown} from './markdown.mjs';
import {ARTICLE_SECTIONS} from './wiki-view.mjs';
import {toast} from './shell.mjs';

const $=s=>document.querySelector(s),form=$('#edit-form');
const slugify=s=>s.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);
const editing=location.pathname.split('/').filter(Boolean)[2]??null;
const label=s=>s.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());

// Embeds preview against the generated data, like the server does.
const key=s=>s.trim().toLowerCase();
const load=f=>fetch('/site/generated/wiki/'+f).then(r=>r.ok?r.json():{entries:[]}).catch(()=>({entries:[]}));
const [items,places]=await Promise.all([load('items.json'),load('places.json')]);
const itemMap=new Map(items.entries.map(i=>[key(i.name),i])),placeMap=new Map(places.entries.map(p=>[key(p.title),p]));
const resolvers={resolveItem:n=>itemMap.get(key(n))??null,resolvePlace:n=>placeMap.get(key(n))??null};

const {me}=await loadSession();
if(!me?.staff){$('#edit-gate').hidden=false;document.body.dataset.ready='1';}
else{
 const title=$('#ed-title'),slug=$('#ed-slug'),section=$('#ed-section'),body=$('#ed-body'),note=$('#ed-note'),preview=$('#ed-preview');
 section.replaceChildren(...ARTICLE_SECTIONS.map(s=>Object.assign(document.createElement('option'),{value:s,textContent:label(s)})));
 let slugTouched=Boolean(editing);
 const url=()=>{$('#ed-url').textContent=`/wiki/${section.value}/${slug.value||'…'}`;};
 const draw=()=>{preview.innerHTML=renderMarkdown(body.value,resolvers);};
 let t=0;body.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(draw,120);});
 title.addEventListener('input',()=>{if(!slugTouched){slug.value=slugify(title.value);url();}});
 slug.addEventListener('input',()=>{slugTouched=true;slug.value=slugify(slug.value);url();});
 section.addEventListener('change',url);
 async function history(){
  if(!editing)return;
  const revs=await api('GET',`/wiki/api/articles/${editing}/revisions`).catch(()=>[]);
  $('#ed-history-wrap').hidden=!revs.length;
  $('#ed-history').replaceChildren(...revs.map((r,i)=>{const li=document.createElement('li');
   const meta=document.createElement('span');meta.className='mono muted';meta.textContent=`${new Date(r.createdAt).toISOString().slice(0,16).replace('T',' ')} · ${r.createdBy}`;
   const n=document.createElement('span');n.textContent=r.note||'No note';li.append(n,meta);
   if(i>0){const b=document.createElement('button');b.type='button';b.className='btn small';b.textContent='Restore';
    b.addEventListener('click',async()=>{b.dataset.busy='';try{await api('POST',`/wiki/api/articles/${editing}/restore/${r.id}`,{});toast('Revision restored');await open();}catch(e){toast(explain(e.code),'error');}finally{delete b.dataset.busy;}});li.append(b);}
   return li;}));
 }
 async function open(){
  if(editing){
   try{const a=await api('GET','/wiki/api/articles/'+editing);title.value=a.title;slug.value=a.slug;section.value=a.section;body.value=a.body;}
   catch{slug.value=editing;}
   slug.readOnly=true;$('#edit-h').textContent=title.value?'Edit article':'New article';
   const view=$('#ed-view');view.hidden=!title.value;view.href=`/wiki/${section.value}/${slug.value}`;
  }
  url();draw();await history();
 }
 form.addEventListener('submit',async e=>{e.preventDefault();
  const s=slug.value;if(!title.value.trim()){title.focus();return toast('Add a title','error');}if(!/^[a-z0-9-]{1,64}$/.test(s)){slug.focus();return toast('Add an address','error');}
  const btn=$('#ed-save');btn.dataset.busy='';
  try{await api('PUT','/wiki/api/articles/'+s,{title:title.value,section:section.value,body:body.value,note:note.value});
   note.value='';$('#ed-status').textContent='Saved';
   if(!editing){location.href='/wiki/edit/'+s;return;}
   await open();}
  catch(err){toast(explain(err.code),'error');}finally{delete btn.dataset.busy;}
 });
 form.hidden=false;await open();document.body.dataset.ready='1';
}
