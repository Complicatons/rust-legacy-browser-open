// Plugins page: the Oxide plugins in the server's plugins folder, with name, version and author from their [Info]
// line. Turn off/on (plugins/disabled), add a .cs file, remove (kept in plugins/removed), reload where the server has
// a console command path. Our own adapter is listed and protected. GET /api/plugins.
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const size=b=>b<1024?b+' B':(b/1024).toFixed(0)+' KB';

export function createPluginsPage({api,toast,span,serverNow}){
 let timer=null,visible=false,data=null;
 function confirmDialog(title,text,ok){
  const dlg=$('confirm');$('confirm-h').textContent=title;$('confirm-text').textContent=text;$('confirm-ok').textContent=ok;dlg.showModal();
  return new Promise(r=>dlg.addEventListener('close',()=>r(dlg.returnValue==='ok'),{once:true}));
 }
 const act=async(verb,name,btn)=>{
  btn?.setAttribute('aria-busy','true');
  try{const r=await api('/api/plugins/'+verb,{method:'POST',body:{name}});toast(`${name}: ${{disable:'turned off',enable:'turned on',remove:'removed',reload:'reload asked'}[verb]}. ${r.note??''}`);load();}
  catch(e){if(e.message!=='sign-in')toast(e.message,'error');}finally{btn?.removeAttribute('aria-busy');}
 };
 async function load(){
  let d;try{d=await api('/api/plugins');}catch(e){if(e.message!=='sign-in')toast('Could not load plugins: '+e.message,'error');return;}
  data=d;
  const note=$('pg-note');
  if(!d.configured){note.hidden=false;note.textContent='No game server in host.json, so there is no plugins folder.';$('pg-table').tBodies[0].replaceChildren();return;}
  note.hidden=d.exists;note.textContent=`No Oxide plugins folder at ${d.dir}. If this server runs Oxide, set components.server.oxideDir in host.json. A server without Oxide (the vanilla patch) has no plugins.`;
  $('pg-dir').textContent=d.dir;
  const on=d.plugins.filter(p=>p.state==='on'),off=d.plugins.filter(p=>p.state==='off');
  $('pg-on').textContent=String(on.length);$('pg-off').textContent=String(off.length);$('pg-removed').textContent=String(d.removed.length);
  $('pg-table').tBodies[0].replaceChildren(...d.plugins.map(p=>el('tr',{'data-name':p.name},
   el('td',{},el('span',{class:'name',text:p.title??p.name}),el('span',{class:'sub',text:[p.file,p.author?'by '+p.author:null,p.description].filter(Boolean).join(' · ')})),
   el('td',{class:'id',text:p.version??'–'}),
   el('td',{},p.protected?el('span',{class:'tag browser',text:'Our adapter'}):el('span',{class:'tag'+(p.state==='on'?'':' warn'),text:p.state==='on'?'On':'Off'})),
   el('td',{},el('div',{class:'acts'},...(p.protected?[el('span',{class:'mono muted',text:'managed by setup and updates'})]:[
    p.state==='on'?el('button',{class:'btn small',type:'button',text:'Reload',title:d.reloadAvailable?null:'Takes effect at the next restart',onclick:e=>act('reload',p.name,e.target)}):null,
    el('button',{class:'btn small',type:'button',text:p.state==='on'?'Turn off':'Turn on',onclick:e=>act(p.state==='on'?'disable':'enable',p.name,e.target)}),
    el('button',{class:'btn small danger',type:'button',text:'Remove',onclick:async e=>{
     if(!await confirmDialog(`Remove ${p.title??p.name}?`,'The file is moved to plugins/removed, so you can put it back by hand. Its data and config files stay where they are.','Remove'))return;
     act('remove',p.name,e.target);}})]))))));
  $('pg-empty').hidden=d.plugins.length>0;
  $('pg-reload-note').textContent=d.reloadAvailable?'Changes are sent to the server as oxide.load, unload and reload.':'Changes take effect at the next restart of the game server (Oxide may also pick them up by itself).';
  $('pg-removed-list').replaceChildren(...(d.removed.length?d.removed.map(r=>el('li',{},el('time',{text:span(serverNow()-r.at)}),el('span',{text:r.file}))):[el('li',{class:'empty',text:'Nothing removed yet.'})]));
 }
 $('pg-form').addEventListener('submit',async e=>{
  e.preventDefault();const file=$('pg-file').files[0],btn=e.submitter;if(!file)return;
  if(!/^[A-Za-z][A-Za-z0-9_]{0,63}\.cs$/.test(file.name))return toast('A plugin file is named like MyPlugin.cs: letters, digits and underscores','error');
  if(data&&file.size>data.maxBytes)return toast(`A plugin file is at most ${data.maxBytes/1024} KB`,'error');
  const replacing=data?.plugins.some(p=>p.file===file.name);
  if(replacing&&!await confirmDialog(`Replace ${file.name}?`,'The plugin already here is moved to plugins/removed first.','Replace'))return;
  btn?.setAttribute('aria-busy','true');
  try{
   const res=await fetch('/api/plugins/upload?name='+encodeURIComponent(file.name),{method:'POST',credentials:'same-origin',headers:{'x-rlb-host':'1','content-type':'text/plain'},body:file});
   const r=await res.json().catch(()=>({}));if(!res.ok)throw Error(r.error??res.status);
   toast(`Added ${r.title} ${r.version??''} by ${r.author??'unknown'}. ${r.note??''}`);$('pg-file').value='';load();
  }catch(x){toast(x.message,'error');}finally{btn?.removeAttribute('aria-busy');}
 });
 return {
  show(){visible=true;load();clearInterval(timer);timer=setInterval(()=>{if(visible&&!document.hidden)load();},15000);},
  hide(){visible=false;clearInterval(timer);},
 };
}
