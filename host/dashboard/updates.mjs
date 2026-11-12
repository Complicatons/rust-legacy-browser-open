// Updates page: kit update tars added here, inspected before anything changes (SHA-256, files, the parts they touch,
// anything refused), installed with a backup of every replaced file, and rolled back. GET /api/updates.
import {createFeedPanel} from './release-feed.mjs';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const size=b=>b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
const PART={central:'Website',gateway:'Gateway',sidecar:'Sidecar',host:'Host app','server-adapter':'Server adapter'};

export function createUpdatesPage({api,toast,span,serverNow}){
 let timer=null,visible=false;
 const feed=createFeedPanel({api,toast,span,serverNow,onStaged:()=>load()});
 function confirmDialog(title,text,ok){
  const dlg=$('confirm');$('confirm-h').textContent=title;$('confirm-text').textContent=text;$('confirm-ok').textContent=ok;dlg.showModal();
  return new Promise(r=>dlg.addEventListener('close',()=>r(dlg.returnValue==='ok'),{once:true}));
 }
 const done=r=>{toast(`${r.files!=null?plural(r.files,'file'):''}${r.restarted?.length?'; restarted '+r.restarted.map(p=>PART[p]).join(', '):''}`);for(const n of r.notes??[])toast(n,'error');};
 async function load(){
  let d;try{d=await api('/api/updates');}catch(e){if(e.message!=='sign-in')toast('Could not load updates: '+e.message,'error');return;}
  $('up-app').textContent='into '+d.app;
  $('up-staged').textContent=String(d.staged.length);$('up-installed').textContent=String(d.history.filter(h=>!h.rolledBack).length);
  $('up-last').textContent=d.history[0]?span(serverNow()-d.history[0].at):'–';
  $('up-staged-list').replaceChildren(...(d.staged.length?d.staged.map(u=>{
   if(u.error)return el('li',{},el('b',{text:u.name}),el('p',{class:'refused',text:u.error}));
   const central=el('input',{type:'checkbox',id:'c-'+u.name});
   return el('li',{},
    el('div',{class:'top'},el('b',{text:u.name}),el('span',{class:'mono muted',text:`${plural(u.files,'file')} · ${size(u.size)}`})),
    u.release?el('p',{class:'notes',text:`Release ${u.release.version} from the signed feed (${u.release.channel}).`}):null,
    el('span',{class:'sha',text:'SHA-256 '+u.sha256}),
    el('div',{class:'kinds'},...u.parts.map(p=>el('span',{class:'tag',text:PART[p]??p}))),
    u.refused.length?el('p',{class:'refused',text:'Refused, so it cannot be installed: '+u.refused.slice(0,5).join(', ')}):null,
    u.centralFiles.length?el('label',{class:'check'},central,`Also replace the website's own files (${u.centralFiles.length})`):null,
    el('div',{class:'acts'},
     el('button',{class:'btn small danger',type:'button',text:'Remove',onclick:async()=>{try{await api('/api/updates/remove',{method:'POST',body:{name:u.name}});load();}catch(e){toast(e.message,'error');}}}),
     el('button',{class:'btn small primary',type:'button',text:'Install',disabled:u.refused.length?'':null,onclick:async e=>{
      if(u.centralFiles.length&&!central.checked)return toast('This update replaces website files: tick the box to allow it, or ask for an update without them','error');
      if(!await confirmDialog('Install this update?',`${u.files} files go into the app folder. Every file it replaces is copied aside first, so you can roll back. ${u.parts.filter(p=>['central','gateway','sidecar'].includes(p)).map(p=>PART[p]).join(', ')||'Nothing'} will restart; the game server keeps running.`,'Install'))return;
      e.target.setAttribute('aria-busy','true');
      try{done(await api('/api/updates/install',{method:'POST',body:{name:u.name,withCentral:central.checked}}));await api('/api/updates/remove',{method:'POST',body:{name:u.name}});load();}
      catch(x){toast(x.message,'error');}finally{e.target.removeAttribute('aria-busy');}}})));
  }):[el('li',{},el('span',{class:'empty muted',text:'Nothing waiting. Add an update file on the right.'}))]));
  $('up-history').replaceChildren(...(d.history.length?d.history.slice(0,20).map(h=>el('li',{},
   el('div',{class:'top'},el('b',{text:h.name??h.backup}),el('span',{class:'mono muted',text:span(serverNow()-h.at)+' ago'})),
   el('span',{class:'sha',text:`${plural(h.files,'file')} · ${h.replaced} replaced · ${h.added} new · ${h.parts.map(p=>PART[p]??p).join(', ')}`}),
   h.rolledBack?el('span',{class:'tag',text:'Rolled back'}):el('div',{class:'acts'},el('button',{class:'btn small',type:'button',text:'Roll back',onclick:async()=>{
    if(!await confirmDialog('Roll back this update?','The files it replaced are put back and the files it added are removed. The parts it touched restart.','Roll back'))return;
    try{const r=await api('/api/updates/rollback',{method:'POST',body:{backup:h.backup}});done({files:r.restored+r.removed,...r});load();}catch(x){toast(x.message,'error');}}})))):[el('li',{},el('span',{class:'empty muted',text:'No updates installed by the host app yet.'}))]));
 }
 $('up-form').addEventListener('submit',async e=>{
  e.preventDefault();const file=$('up-file').files[0],btn=e.submitter;if(!file)return;
  btn?.setAttribute('aria-busy','true');
  try{
   const res=await fetch('/api/updates/upload?name='+encodeURIComponent(file.name),{method:'POST',credentials:'same-origin',headers:{'x-rlb-host':'1','content-type':'application/x-tar'},body:file});
   const r=await res.json().catch(()=>({}));if(!res.ok)throw Error(r.error??res.status);
   toast(`Added ${r.name}: ${plural(r.files,'file')}, SHA-256 ${r.sha256.slice(0,16)}…`);$('up-file').value='';load();
  }catch(x){toast(x.message,'error');}finally{btn?.removeAttribute('aria-busy');}
 });
 return {
  show(){visible=true;load();feed.load();clearInterval(timer);timer=setInterval(()=>{if(visible&&!document.hidden){load();feed.load();}},15000);},
  hide(){visible=false;clearInterval(timer);},
 };
}
