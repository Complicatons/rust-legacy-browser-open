// The forum (/forum, /forum/<category>, /forum/t/<id>) over central/forum.mjs. Posts arrive as server-rendered,
// escaped HTML; the composer previews with the same restricted markdown. Staff get pin, lock, delete and posting bans.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {renderMarkdown} from './markdown.mjs';
import {toast} from './shell.mjs';
import {forumRoute,ago,dateLabel,pageList,postGate,BAN_LENGTHS,banUntil} from './forum-view.mjs';

const $=s=>document.querySelector(s),main=$('#fm-main'),crumbs=$('#fm-crumbs');
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k==='html')e.innerHTML=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const stat=(n,label)=>el('div',{class:'stat'},el('b',{text:String(n)}),el('span',{class:'mono',text:label}));
const time=ts=>el('time',{datetime:new Date(ts).toISOString(),title:dateLabel(ts),text:ago(ts)});
const show=(...kids)=>main.replaceChildren(...kids.flat().filter(x=>x!=null&&x!==false));
const tag=(text,cls='')=>el('span',{class:'fm-tag mono '+cls,text});
const params=()=>new URLSearchParams(location.search);
const route=forumRoute(location.pathname);

function setCrumbs(...parts){crumbs.replaceChildren(...parts.map(([text,href])=>href?el('a',{href,text}):el('span',{text})));}
function pager(page,pages,base){
 const list=pageList(page,pages);if(!list.length)return null;
 return el('nav',{class:'fm-pager mono','aria-label':'Pages'},list.map(n=>n===null?el('span',{class:'gap',text:'…'}):
  n===page?el('span',{'aria-current':'page',text:String(n)}):el('a',{href:`${base}?page=${n}`,text:String(n)})));
}
async function busy(btn,fn){btn.dataset.busy='';try{return await fn();}catch(e){toast(explain(e.code),'error');}finally{delete btn.dataset.busy;}}

// Title (new threads only) + text with a preview toggle. onSubmit({title, body}) resolves when posted.
function composer({withTitle=false,label,value='',onSubmit,onCancel}){
 const title=withTitle?el('input',{id:'fm-title',name:'title',maxlength:'120',required:true,autocomplete:'off'}):null;
 const body=el('textarea',{id:withTitle?'fm-body':null,name:'body',rows:'8',maxlength:'20000',required:true,'aria-label':'Text'});body.value=value;
 const preview=el('div',{class:'prose fm-preview',hidden:true});
 const toggle=el('button',{class:'btn small',type:'button','aria-pressed':'false',text:'Preview',onclick:()=>{
  const on=preview.hidden;preview.hidden=!on;body.hidden=on;toggle.setAttribute('aria-pressed',String(on));
  if(on)preview.innerHTML=body.value.trim()?renderMarkdown(body.value):'<p class="muted">Nothing yet.</p>';}});
 const submit=el('button',{class:'btn-play fm-submit',type:'submit',text:label});
 const form=el('form',{class:'fm-composer',novalidate:true},
  title&&el('div',{class:'field'},el('label',{for:'fm-title',text:'Title'}),title),
  el('div',{class:'field'},withTitle&&el('label',{for:'fm-body',text:'Text'}),body,preview,
   el('span',{class:'help syntax mono',text:'**bold** · *italic* · - list · [link](/wiki) · ## heading · [[item:Hatchet]]'})),
  el('div',{class:'fm-actions'},submit,toggle,onCancel&&el('button',{class:'btn small',type:'button',text:'Cancel',onclick:onCancel})));
 form.addEventListener('submit',async e=>{e.preventDefault();
  if(title&&title.value.trim().length<3){title.focus();return toast('Add a title (3–120 characters).','error');}
  if(!body.value.trim()){if(body.hidden)toggle.click();body.focus();return toast('Write something first.','error');}
  await busy(submit,()=>onSubmit({title:title?.value,body:body.value}));});
 return form;
}
const gateNote=g=>el('div',{class:'fm-gate'},el('span',{text:g.text}),g.kind==='sign-in'&&el('a',{class:'btn small',href:'/signin?next='+encodeURIComponent(location.pathname+location.search),text:'Sign in'}),
 g.text.includes('username')&&el('a',{class:'btn small',href:'/account',text:'Account'}));

// ---- /forum
async function index(){
 const {categories,viewer}=await api('GET','/forum/api/categories');
 setCrumbs(['Forum']);document.title='Forum · Rust Legacy Browser';
 const sum=k=>categories.reduce((n,c)=>n+c[k],0);
 show(
  el('header',{class:'fm-hero'},el('h1',{class:'h',text:'Forum'}),el('div',{class:'stats fm-stats'},stat(sum('threads'),'Threads'),stat(sum('posts'),'Posts'))),
  el('ol',{class:'fm-cats'},categories.map(c=>el('li',{class:'fm-cat'},
   el('div',{class:'fm-cat-t'},el('a',{href:'/forum/'+c.id,text:c.title}),el('span',{class:'muted',text:c.blurb}),c.staffOnly&&tag('Staff posts')),
   el('div',{class:'fm-num'},el('b',{text:String(c.threads)}),el('span',{class:'mono',text:'Threads'})),
   el('div',{class:'fm-num'},el('b',{text:String(c.posts)}),el('span',{class:'mono',text:'Posts'})),
   el('div',{class:'fm-latest'},c.latest?[el('a',{href:'/forum/t/'+c.latest.id,text:c.latest.title}),el('span',{class:'mono muted'},c.latest.by+' · ',time(c.latest.at))]:el('span',{class:'mono muted',text:'—'}))))),
  viewer?.staff?moderation():null);
}
// Staff: who is banned from posting, and a form to ban by username.
function moderation(){
 const rows=el('tbody'),empty=el('p',{class:'mono muted',text:'No bans',hidden:true});
 const reload=async()=>{const bans=await api('GET','/forum/api/bans');empty.hidden=bans.length>0;
  rows.replaceChildren(...bans.map(b=>el('tr',{},el('td',{text:b.name}),el('td',{text:b.reason}),el('td',{class:'num',text:banUntil(b.expiresAt)}),
   el('td',{},el('button',{class:'btn small',type:'button',text:'Remove',onclick:e=>busy(e.currentTarget,async()=>{await api('POST','/forum/api/bans/remove',{name:b.name});toast('Ban removed');await reload();})})))));};
 const panel=el('section',{class:'panel fm-mod',id:'fm-mod'},el('div',{class:'panel-h mono',text:'Posting bans'}),
  el('div',{class:'table-wrap'},el('table',{class:'wtable'},el('thead',{},el('tr',{},['Account','Reason','Until',''].map(t=>el('th',{text:t})))),rows)),empty,
  banForm('',async()=>{await reload();}));
 reload().catch(e=>toast(explain(e.code),'error'));
 return panel;
}
function banForm(name,done,onCancel){
 const who=el('input',{name:'name',value:name,required:true,'aria-label':'Username',placeholder:'Username',autocomplete:'off'});
 const reason=el('input',{name:'reason',maxlength:'200',required:true,'aria-label':'Reason',placeholder:'Reason'});
 const days=el('select',{name:'days','aria-label':'Length'},BAN_LENGTHS.map(([v,t])=>el('option',{value:v,text:t})));
 const go=el('button',{class:'btn small danger',type:'submit',text:'Ban from posting'});
 const form=el('form',{class:'fm-ban',novalidate:true},who,reason,days,go,onCancel&&el('button',{class:'btn small',type:'button',text:'Cancel',onclick:onCancel}));
 form.addEventListener('submit',e=>{e.preventDefault();if(!who.value.trim()||!reason.value.trim())return toast('Add a username and a reason.','error');
  busy(go,async()=>{const r=await api('POST','/forum/api/bans',{name:who.value.trim(),reason:reason.value.trim(),days:days.value||null});toast(`${r.name} banned from posting`);reason.value='';if(!name)who.value='';await done();});});
 return form;
}

// ---- /forum/<category>
async function category(){
 const page=Number(params().get('page'))||1,d=await api('GET',`/forum/api/categories/${route.category}?page=${page}`),c=d.category;
 setCrumbs(['Forum','/forum'],[c.title]);document.title=`${c.title} · Forum · Rust Legacy Browser`;
 const gate=postGate(d.viewer,{staffOnly:c.staffOnly});
 const form=gate?null:composer({withTitle:true,label:'Post thread',onSubmit:async({title,body})=>{const r=await api('POST',`/forum/api/categories/${c.id}/threads`,{title,body});location.href='/forum/t/'+r.id;}});
 const box=el('section',{class:'fm-new',id:'fm-new',hidden:true},form);
 const open=gate?null:el('button',{class:'btn-play',type:'button',id:'fm-new-btn',text:'New thread',onclick:()=>{box.hidden=!box.hidden;if(!box.hidden)$('#fm-title').focus();}});
 show(
  el('header',{class:'fm-hero'},el('div',{},el('h1',{class:'h',text:c.title}),el('p',{class:'muted',text:c.blurb})),
   el('div',{class:'stats fm-stats'},stat(d.total,'Threads')),open??gateNote(gate)),
  box,
  d.threads.length?el('ol',{class:'fm-threads'},d.threads.map(t=>el('li',{class:'fm-thread'+(t.pinned?' pinned':'')},
   el('div',{class:'fm-thread-t'},el('div',{class:'fm-tags'},t.pinned&&tag('Pinned','or'),t.locked&&tag('Locked')),el('a',{href:'/forum/t/'+t.id,text:t.title}),el('span',{class:'mono muted',text:t.author})),
   el('div',{class:'fm-num'},el('b',{text:String(t.replies)}),el('span',{class:'mono',text:'Replies'})),
   el('div',{class:'fm-last mono muted'},el('span',{text:t.lastBy}),time(t.lastAt)))))
  :el('div',{class:'pending'},el('b',{text:'No threads yet'}),gate?null:el('span',{text:'Start the first one.'})),
  pager(d.page,d.pages,'/forum/'+c.id));
}

// ---- /forum/t/<id>
async function thread(){
 const q=params(),hash=/^#p(\d+)$/.exec(location.hash);
 const query=q.get('page')?`?page=${Number(q.get('page'))||1}`:hash?`?post=${hash[1]}`:'';
 const d=await api('GET',`/forum/api/threads/${route.id}${query}`),t=d.thread,v=d.viewer,staff=Boolean(v?.staff);
 setCrumbs(['Forum','/forum'],[t.category.title,'/forum/'+t.category.id],[t.title]);document.title=`${t.title} · Forum · Rust Legacy Browser`;
 // Pin/Unpin, Lock/Unlock: [button when off, when on, toast when turned on, when turned off].
 const flag=(key,action,[on,off,done,undone])=>el('button',{class:'btn small',type:'button',text:t[key]?off:on,onclick:e=>busy(e.currentTarget,async()=>{await api('POST',`/forum/api/threads/${t.id}/${action}`,{[key]:!t[key]});toast(t[key]?undone:done);await render();})});
 const tools=staff?el('div',{class:'fm-tools'},flag('pinned','pin',['Pin','Unpin','Pinned','Unpinned']),flag('locked','lock',['Lock','Unlock','Locked','Unlocked']),
  el('button',{class:'btn small danger',type:'button',text:'Delete thread',onclick:e=>{if(!confirm(`Delete "${t.title}" and all its posts?`))return;
   return busy(e.currentTarget,async()=>{const r=await api('POST',`/forum/api/threads/${t.id}/delete`,{});toast('Thread deleted');location.href='/forum/'+r.category;});}})):null;
 const gate=postGate(v,{locked:t.locked});
 const reply=gate?gateNote(gate):composer({label:'Reply',onSubmit:async({body})=>{const r=await api('POST',`/forum/api/threads/${t.id}/posts`,{body});
  location.href=`/forum/t/${t.id}?page=${r.page}#p${r.id}`;if(r.page===d.page)await render();}});
 show(
  el('header',{class:'fm-hero fm-thread-head'},el('div',{},el('div',{class:'fm-tags'},t.pinned&&tag('Pinned','or'),t.locked&&tag('Locked')),el('h1',{class:'h',text:t.title})),
   el('div',{class:'stats fm-stats'},stat(d.total,'Posts')),tools),
  el('ol',{class:'fm-posts'},d.posts.map(p=>post(p,t,v))),
  pager(d.page,d.pages,'/forum/t/'+t.id),
  el('section',{class:'fm-reply',id:'fm-reply'},el('h2',{class:'mono',text:'Reply'}),reply));
 if(hash)document.getElementById('p'+hash[1])?.scrollIntoView({block:'start'});
}
function post(p,t,v){
 const head=el('header',{class:'fm-post-h'},el('b',{text:p.author}),el('span',{class:'mono muted'},el('a',{href:`#p${p.id}`,text:'#'+p.n}),' · ',time(p.createdAt),p.editedAt?' · edited':''));
 if(p.deleted)return el('li',{class:'fm-post removed',id:'p'+p.id},head,el('p',{class:'mono muted',text:p.deleted==='staff'?'Removed by staff':'Removed by its author'}));
 const body=el('div',{class:'prose fm-post-b',html:p.html}),actions=el('div',{class:'fm-post-a'}),li=el('li',{class:'fm-post',id:'p'+p.id},head,body,actions);
 const staff=Boolean(v?.staff),canEdit=p.mine&&v?.canPost&&(!t.locked||staff);
 if(canEdit)actions.append(el('button',{class:'btn small',type:'button',text:'Edit',onclick:()=>{
  const form=composer({label:'Save',value:p.body,onSubmit:async({body:text})=>{await api('PUT',`/forum/api/posts/${p.id}`,{body:text});toast('Saved');await render();},onCancel:()=>{form.replaceWith(body);actions.hidden=false;}});
  body.replaceWith(form);actions.hidden=true;form.querySelector('textarea').focus();}}));
 if(!p.first&&(p.mine||staff))actions.append(el('button',{class:'btn small danger',type:'button',text:'Delete',onclick:e=>{if(!confirm('Delete this post?'))return;
  return busy(e.currentTarget,async()=>{await api('POST',`/forum/api/posts/${p.id}/delete`,{});toast('Post deleted');await render();});}}));
 if(staff&&!p.mine)actions.append(el('button',{class:'btn small danger',type:'button',text:'Ban author',onclick:()=>{
  const form=banForm(p.author,async()=>{form.remove();},()=>form.remove());actions.after(form);form.querySelector('[name=reason]').focus();}}));
 if(!actions.childElementCount)actions.remove();
 return li;
}

async function render(){
 try{await (route.view==='index'?index:route.view==='category'?category:thread)();}
 catch(e){
  const missing=e.status===404;setCrumbs(['Forum','/forum'],[missing?'Not found':'Offline']);
  main.replaceChildren(el('div',{class:'pending'},el('b',{text:missing?'Not found':'Forum offline'}),el('span',{text:missing?'That thread or category does not exist.':explain(e.code)}),
   missing?el('a',{class:'btn small',href:'/forum',text:'Forum home'}):el('button',{class:'btn small',type:'button',text:'Retry',onclick:render})));
 }finally{main.removeAttribute('aria-busy');document.body.dataset.ready='1';}
}
await loadSession(); // sets the CSRF token for posting
await render();
