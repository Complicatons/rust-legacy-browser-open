// Server browser (/servers) and server page (/servers/{id}): live directory, filters in the URL, keyboard selection,
// join hand-off to the game page and optional desktop-character linking.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {toast} from './shell.mjs';
import {environment} from './live-bg.mjs';
import {formatPlayers,filterServers,sortServers,regionsOf,queryFromState,stateFromQuery,isDesktop,joinServer,requirementLabels,launcherOnlyLabel,shownTags} from './server-data.mjs';

const $=s=>document.querySelector(s),page=document.body.dataset.page;
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?'':v);}e.append(...kids.filter(Boolean));return e;};
const {me,config}=await loadSession();
const env=environment({gameOrigin:false}),desktop=isDesktop(env);
let servers=[],selected=null,updatedAt=0,state=stateFromQuery(new URLSearchParams(location.search));

// ---- Join and linking ---------------------------------------------------------------------------------------------
async function join(s,button){
 if(!desktop){toast(explain('desktop-required'),'error');return;}
 const label=button?.innerHTML;if(button){button.dataset.busy='';button.innerHTML='<span class="spinner" aria-hidden="true"></span><span>Joining…</span>';}
 try{
  const r=await joinServer(s,{me,desktop,api,config});
  if(r.redirect)location.href=r.redirect;else toast(`Join ticket ready for ${s.name}. The game page is not connected to this site yet.`);
 }catch(e){toast(explain(e.code),'error');}
 finally{if(button&&!document.hidden){delete button.dataset.busy;button.innerHTML=label;}}
}
function linkForm(s){
 const input=el('input',{id:'link-code',name:'code',required:true,maxlength:10,autocomplete:'off',spellcheck:'false',pattern:'[A-HJ-NP-Za-hj-np-z2-9]{10}'});
 const status=el('p',{'aria-live':'polite'});
 const form=el('form',{class:'link-form',hidden:true,novalidate:true},
  el('p',{text:'In the desktop game on this server, type /browserlink in chat and enter the code here. Keep the desktop game connected while it links.'}),
  el('div',{class:'field'},el('label',{for:'link-code',text:'Link code'}),input),
  el('button',{class:'btn',type:'submit',text:'Link character'}),status);
 form.addEventListener('submit',async e=>{
  e.preventDefault();const code=input.value.trim().toUpperCase();
  if(!/^[A-HJ-NP-Z2-9]{10}$/.test(code)){status.textContent=explain('invalid-code');return;}
  try{
   const {request}=await api('POST',`/servers/${s.id}/link`,{code});status.textContent='Linking… keep the desktop game connected.';
   for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,1000));const st=await api('GET',`/links/${request}/status`);
    if(st.status==='linked'){status.textContent=`Linked. Disconnect the desktop game, then join from here.`;return;}
    if(st.status==='failed'){status.textContent=explain(st.reason);return;}}
   status.textContent='Linking is taking longer than expected. The server may be offline.';
  }catch(err){status.textContent=explain(err.code);}
 });
 return form;
}

// ---- Detail panel -------------------------------------------------------------------------------------------------
// The owner's approved list entry (central/listings.mjs): description, tags, wipe rhythm, language and links.
function listingDetails(s){
 const links=[s.discord?el('a',{class:'btn small',href:s.discord,target:'_blank',rel:'noopener nofollow',text:'Discord'}):null,s.website?el('a',{class:'btn small',href:s.website,target:'_blank',rel:'noopener nofollow',text:'Website'}):null].filter(Boolean);
 const facts=[s.wipeSchedule?`Wipes ${s.wipeSchedule}`:null,s.language?s.language:null].filter(Boolean);
 const tags=shownTags(s.tags);
 return [s.description?el('p',{class:'srv-desc',text:s.description}):null,
  tags.length?el('p',{class:'note reqs'},...tags.map(t=>el('span',{class:'badge',text:t}))):null,
  facts.length?el('p',{class:'note mono',text:facts.join(' · ')}):null,
  links.length?el('div',{class:'actions'},...links):null];
}
function renderDetail(s){
 const box=$('#detail');if(!box)return;
 if(!s){box.replaceChildren(el('p',{class:'muted',text:servers.length?'Select a server to see its details.':''}));return;}
 const stat=(value,label,na,small)=>el('div',{class:'stat'},el('b',{class:(na?'na ':'')+(small?'small':''),text:value}),el('span',{class:'mono',text:label}));
 const joinable=s.browserReady!==false;
 const playBtn=el('button',{class:'btn-play',type:'button',onclick:e=>join(s,e.currentTarget)},el('span',{text:me?'Join server':'Sign in to join'}),el('span',{class:'key',text:'Enter'}));
 if(!s.online||!joinable)playBtn.disabled=true;
 const link=me&&s.online&&joinable?linkForm(s):null;
 box.replaceChildren(...[
  el('div',{},el('span',{class:'mono muted',text:'Selected server'}),el('h2',{class:'h',text:s.name})),
  el('div',{class:'status mono'},el('span',{class:'dot'+(s.online?'':' off'),'aria-hidden':'true'}),el('span',{text:s.online?'Online':'Offline'})),
  el('div',{class:'stats'},stat(s.online&&Number.isFinite(s.players)?String(s.players):'—','Players',!(s.online&&Number.isFinite(s.players))),stat(Number.isFinite(s.capacity)?String(s.capacity):'—','Slots',!Number.isFinite(s.capacity)),stat(String(s.region??'—').toUpperCase(),'Region',false,true),stat(s.wipe??'—','Wipe',!s.wipe,true)),
  ...listingDetails(s),
  (()=>{const labels=[...requirementLabels(s.requirements),...(launcherOnlyLabel(s)?[launcherOnlyLabel(s)]:[])];return labels.length?el('p',{class:'note reqs'},el('span',{class:'mono muted',text:'To join '}),...labels.map(t=>el('span',{class:'badge',text:t}))):null;})(),
  !joinable?el('p',{class:'note',text:`Listed from ${s.source??'another directory'}. It has no Rust Legacy Browser adapter, so it can't be joined from here or the desktop launcher — only from the original game, directly.`}):s.online?playBtn:el('p',{class:'note',text:'This server is offline right now. It will appear as online once its gateway checks in.'}),
  desktop?null:el('p',{class:'note',text:'Gameplay needs a desktop browser with a keyboard and mouse. You can still browse servers here.'}),
  el('div',{class:'actions'},
   link?el('button',{class:'btn small',type:'button',onclick:()=>{link.hidden=!link.hidden;if(!link.hidden)link.querySelector('input').focus();},text:'Link desktop character'}):null,
   el('button',{class:'btn small',type:'button',onclick:async()=>{const url=location.origin+'/servers/'+s.id;try{await navigator.clipboard.writeText(url);toast('Link copied.');}catch{toast(url);}},text:'Copy link'})),
  link].filter(Boolean));
}

// ---- List page ----------------------------------------------------------------------------------------------------
function visible(){return sortServers(filterServers(servers,state),state.sort);}
function setState(patch){state={...state,...patch};const q=queryFromState(state);history.replaceState(null,'',location.pathname+(String(q)?'?'+q:''));render();}
function renderStateBox(kind){
 const box=$('#state');box.hidden=!kind;$('#list').hidden=Boolean(kind);if(!kind)return;
 const views={
  empty:[el('div',{class:'h',text:'No servers yet'}),el('p',{text:'No browser-ready servers are listed right now.'}),el('a',{class:'btn',href:'/list-your-server',text:'List your server'})],
  nomatch:[el('div',{class:'h',text:'No matches'}),el('p',{text:'No servers match these filters.'}),el('button',{class:'btn',type:'button',text:'Clear filters',onclick:()=>{$('#q').value='';setState({q:'',region:null,hideFull:false,hideOffline:false});syncControls();}})],
  error:[el('div',{class:'h',text:'Directory offline'}),el('p',{text:'Could not reach the server directory.'}),el('button',{class:'btn',type:'button',text:'Retry',onclick:refresh})],
 };
 box.replaceChildren(...views[kind]);
}
function row(s){
 const pct=Number.isFinite(s.players)&&Number.isFinite(s.capacity)&&s.capacity>0?Math.min(100,Math.round(s.players/s.capacity*100)):0;
 const meter=el('span',{class:'bar-meter','aria-hidden':'true'},el('i'));meter.firstChild.style.width=pct+'%';
 const pick=el('button',{class:'srv-row',type:'button','aria-label':`${s.name}, ${s.online?'online':'offline'}, ${formatPlayers(s)} players`,onclick:()=>select(s.id)},
  el('span',{class:'dot'+(s.online?'':' off'),'aria-hidden':'true'}),el('b',{text:s.name}),el('span',{class:'r',text:String(s.region??'').toUpperCase()}),
  el('span',{class:'pop'},s.online?meter:null,el('span',{text:s.online?formatPlayers(s):'Offline'})),el('span',{class:'w',text:s.wipe??'—'}));
 const joinBtn=s.browserReady===false?el('span',{class:'mono muted small',text:'Not joinable here'}):el('button',{class:'btn small join',type:'button',disabled:!s.online,text:desktop?'Join':'Desktop',onclick:e=>join(s,e.currentTarget)});
 return el('li',{class:s.online?'':'offline','aria-selected':String(s.id===selected),'data-id':s.id},pick,joinBtn);
}
function render(){
 if(page!=='servers')return;
 const list=$('#list'),rows=visible();list.removeAttribute('aria-busy');
 renderStateBox(!servers.length?'empty':!rows.length?'nomatch':null);
 list.replaceChildren(...rows.map(row));
 if(!rows.some(s=>s.id===selected))selected=rows[0]?.id??null;
 list.querySelectorAll('li').forEach(li=>li.setAttribute('aria-selected',String(li.dataset.id===selected)));
 renderDetail(rows.find(s=>s.id===selected)??null);
}
function select(id){selected=id;document.querySelectorAll('#list li').forEach(li=>li.setAttribute('aria-selected',String(li.dataset.id===id)));renderDetail(servers.find(s=>s.id===id)??null);}
function syncControls(){
 $('#q').value=state.q;$('#hide-full').checked=state.hideFull;$('#hide-offline').checked=state.hideOffline;$('#sort').value=state.sort;
 const regions=regionsOf(servers);
 $('#regions').replaceChildren(el('button',{class:'chip',type:'button','aria-pressed':String(!state.region),text:'All',onclick:()=>{setState({region:null});syncControls();}}),
  ...regions.map(r=>el('button',{class:'chip',type:'button','aria-pressed':String(state.region===r),text:r,onclick:()=>{setState({region:r});syncControls();}})));
}
function skeleton(){$('#list').replaceChildren(...[0,1,2].map(()=>el('li',{},el('div',{class:'srv-row'},el('span'),el('b',{class:'skeleton',text:'Loading server name'}),el('span'),el('span'),el('span')))));}

async function refresh(){
 try{servers=(await api('GET','/servers')).servers;updatedAt=Date.now();if(page==='servers'){syncControls();render();$('#updated').textContent='Updated just now';}}
 catch{if(page==='servers'&&!servers.length){$('#list').removeAttribute('aria-busy');renderStateBox('error');}else toast('Could not refresh the server list.','error');}
}

if(page==='servers'){
 skeleton();
 $('#q').addEventListener('input',e=>setState({q:e.target.value}));
 $('#hide-full').addEventListener('change',e=>setState({hideFull:e.target.checked}));
 $('#hide-offline').addEventListener('change',e=>setState({hideOffline:e.target.checked}));
 $('#sort').addEventListener('change',e=>setState({sort:e.target.value}));
 $('#refresh').addEventListener('click',refresh);
 document.addEventListener('keydown',e=>{
  if(e.target.closest('input,select,textarea,form')){if(e.key==='Escape')e.target.blur?.();return;}
  if(e.key==='/'){e.preventDefault();$('#q').focus();return;}
  const rows=visible(),i=rows.findIndex(s=>s.id===selected);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=rows[Math.max(0,Math.min(rows.length-1,i+(e.key==='ArrowDown'?1:-1)))];if(n){select(n.id);document.querySelector(`#list li[data-id="${n.id}"]`)?.scrollIntoView({block:'nearest'});}}
  if(e.key==='Enter'&&!e.target.closest('button,a')){const s=rows[i];if(s?.online&&s.browserReady!==false){e.preventDefault();join(s,$('#detail .btn-play'));}}
 });
 setInterval(()=>{if(updatedAt)$('#updated').textContent=`Updated ${Math.max(0,Math.round((Date.now()-updatedAt)/1000))}s ago`;},1000);
 setInterval(()=>{if(document.visibilityState==='visible')refresh();},30e3);
 await refresh();
}else{
 // /servers/{id}: one server, shareable. ?join=1 continues a join that started before signing in.
 const id=location.pathname.split('/')[2];
 try{
  const s=await api('GET','/servers/'+id);servers=[s];document.title=`${s.name} · Rust Legacy Browser`;renderDetail(s);
  if(new URLSearchParams(location.search).get('join')==='1'&&me&&s.online&&desktop){history.replaceState(null,'',location.pathname);join(s,$('#detail .btn-play'));}
 }catch(e){
  const box=$('#state');box.hidden=false;$('#detail').hidden=true;
  box.replaceChildren(el('div',{class:'h',text:e.code==='unknown-server'?'Server not found':'Directory offline'}),el('p',{text:e.code==='unknown-server'?'This server is no longer listed.':'Could not reach the server directory.'}),el('a',{class:'btn',href:'/servers',text:'All servers'}));
 }
}
document.body.dataset.ready='1';
