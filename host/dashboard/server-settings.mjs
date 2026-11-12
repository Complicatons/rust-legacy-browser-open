// Settings → Server: the game server's cfg file (curated values with plain explanations, other values), the admin
// password (write-only: never shown back), who the admins are, and our adapter's own settings (LauncherOnly, message of
// the day). GET/POST /api/server-settings; one Save sends only what changed. The server reads its cfg at start only.
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const KEY=/^[A-Za-z][A-Za-z0-9_]{0,40}\.[A-Za-z][A-Za-z0-9_]{0,40}$/;
const ROLE={owner:'Owner',admin:'Admin',moderator:'Moderator'};

export function createServerSettingsSection({api,toast}){
 let data=null,visible=false;
 const controls=new Map(),other=new Map(),adapterCtl={};
 const status=el('p',{class:'muted set-file'}),note=el('div',{class:'note set-restart',hidden:true});
 const groups=el('div',{class:'set-main'}),side=el('aside',{class:'acc-side'});
 const errors=el('div',{class:'set-errors',role:'alert',hidden:true});
 const dirtyText=el('span',{class:'mono muted',text:'No changes'});
 const saveBtn=el('button',{class:'btn primary',type:'submit',text:'Save',disabled:true});
 const undoBtn=el('button',{class:'btn',type:'button',text:'Undo changes',disabled:true,onclick:()=>render()});
 const form=el('form',{class:'set-form',novalidate:true},el('div',{class:'set-grid'},groups,side),errors,el('div',{class:'set-bar'},dirtyText,el('div',{class:'row'},undoBtn,saveBtn)));
 const section=el('section',{class:'set-section',id:'set-server','aria-labelledby':'set-server-h'},
  el('header',{class:'section-h'},el('div',{},el('h2',{class:'h set-h',id:'set-server-h',text:'Server'}),status)),note,form);

 const effective=d=>d.value??d.shipped??d.def??null;
 function control(d){
  const id='set-'+d.key.replace(/\W/g,'-');let input;
  if(d.type==='bool'){
   input=el('select',{id},el('option',{value:'',text:`Server default${d.def?` (${d.def==='true'?'on':'off'})`:''}`}),el('option',{value:'true',text:'On'}),el('option',{value:'false',text:'Off'}));
  }else if(d.type==='text')input=el('input',{id,type:'text',maxlength:d.max??200,autocomplete:'off',spellcheck:'false',placeholder:d.def?`default ${d.def}`:'not set'});
  else input=el('input',{id,type:'number',min:d.min,max:d.max,step:d.type==='int'?1:'any',inputmode:d.type==='int'?'numeric':'decimal',placeholder:d.def?`default ${d.def}`:'not set'});
  input.value=d.value??'';input.addEventListener('input',dirty);input.addEventListener('change',dirty);
  controls.set(d.key,{input,d});
  const hint=[d.def!=null?`Default ${fmt(d,d.def)}`:null,d.shipped!=null?`shipped ${fmt(d,d.shipped)}`:null,d.min!=null?`${d.min} to ${d.max}${d.unit?' '+d.unit:''}`:null].filter(Boolean).join(' · ');
  return el('div',{class:'set-row'},
   el('label',{for:id},el('span',{class:'set-label',text:d.label}),el('code',{text:d.key})),
   el('div',{class:'set-ctl'},input,d.unit?el('span',{class:'mono muted',text:d.unit}):null),
   el('p',{class:'set-help'},d.help,hint?el('span',{class:'set-hint',text:' '+hint+'.'}):null));
 }
 const fmt=(d,v)=>d.type==='bool'?(v==='true'?'on':'off'):v+(d.unit?' '+d.unit:'');

 function render(){
  const d=data;controls.clear();other.clear();
  errors.hidden=true;
  if(!d.configured){groups.replaceChildren(el('p',{class:'empty muted',text:'No game server in host.json, so there is no server config to edit.'}));side.replaceChildren();status.textContent='';note.hidden=true;dirty();return;}
  status.replaceChildren(d.exists?'':'Not found yet: ',el('code',{text:d.file}),d.exists?' · read when the game server starts':' · saving creates it');
  restartNote();
  // Curated values, by group.
  const byGroup=new Map();for(const v of d.values){if(!byGroup.has(v.group))byGroup.set(v.group,[]);byGroup.get(v.group).push(v);}
  const panels=[...byGroup].map(([g,list])=>el('fieldset',{class:'panel set-group'},el('legend',{class:'mono',text:g}),
   g==='General'&&d.maxPlayers!=null?el('div',{class:'set-row'},el('span',{class:'set-label',text:'Max players'}),el('div',{class:'set-ctl'},el('b',{class:'set-fixed',text:String(d.maxPlayers)})),el('p',{class:'set-help',text:'Set by the server\'s start command (-maxplayers), not this file.'})):null,
   ...list.map(control)));
  // Other values: anything else in the file, editable, plus new ones.
  const tbody=el('tbody');
  for(const o of d.other)tbody.append(otherRow(o));
  const newKey=el('input',{type:'text',placeholder:'section.name',autocomplete:'off',spellcheck:'false','aria-label':'New setting name'}),newVal=el('input',{type:'text',placeholder:'value',autocomplete:'off',spellcheck:'false','aria-label':'New setting value'});
  const addBtn=el('button',{class:'btn small',type:'button',text:'Add',onclick:()=>{
   const k=newKey.value.trim();
   if(!KEY.test(k))return toast('A setting name looks like section.name, for example server.maxsleepers','error');
   if(controls.has(k)||other.has(k))return toast(`${k} is already listed`,'error');
   tbody.append(otherRow({key:k,value:newVal.value,added:true}));newKey.value='';newVal.value='';dirty();}});
  const otherPanel=el('section',{class:'panel set-group','aria-labelledby':'set-other-h'},
   el('header',{class:'panel-h'},el('h3',{class:'mono',id:'set-other-h',text:'Other values'}),el('p',{class:'mono muted',text:d.kept===1?'1 other line kept as it is':`${d.kept??0} other lines kept as they are`})),
   el('p',{class:'set-help pad',text:'Every other value in the file. Names this app does not know are written as you type them; the server ignores ones it does not have.'}),
   el('div',{class:'table-wrap'},el('table',{class:'table set-table'},el('thead',{},el('tr',{},el('th',{scope:'col',text:'Name'}),el('th',{scope:'col',text:'Value'}),el('th',{scope:'col'},el('span',{class:'sr-only',text:'Actions'})))),tbody)),
   el('div',{class:'set-add'},newKey,newVal,addBtn),
   d.duplicates?.length?el('p',{class:'set-help pad',text:`Listed more than once in the file: ${d.duplicates.join(', ')}. Saving one sets every copy.`}):null);
  groups.replaceChildren(...panels,otherPanel);
  side.replaceChildren(adminsPanel(d),adapterPanel(d));
  dirty();
 }
 function otherRow(o){
  const tr=el('tr',{'data-key':o.key});
  if(o.secret){tr.append(el('td',{},el('code',{text:o.key})),el('td',{class:'muted',text:'set (hidden)'}),el('td'));return tr;}
  const input=el('input',{type:'text',value:o.value??'',autocomplete:'off',spellcheck:'false','aria-label':o.key,oninput:dirty});input.value=o.value??'';
  const entry={input,value:o.added?null:o.value,remove:false,added:Boolean(o.added)};other.set(o.key,entry);
  const rm=el('button',{class:'btn small danger',type:'button',text:'Remove',onclick:()=>{
   if(entry.added){tr.remove();other.delete(o.key);}else{entry.remove=!entry.remove;tr.classList.toggle('removing',entry.remove);rm.textContent=entry.remove?'Keep':'Remove';input.disabled=entry.remove;}
   dirty();}});
  tr.append(el('td',{},el('code',{text:o.key})),el('td',{},input),el('td',{},el('div',{class:'acts'},rm)));
  return tr;
 }
 // Give/remove roles (owner decision, HOST-AND-LOADER-BUILD.md question 1, 29 Oct 2026): two-way through the same
 // host key the Players and Anti-cheat pages already use (it acts as this server's owner on central, so it can grant
 // admin, not just moderator). POST /api/central/roles {player, role: 'admin'|'moderator'|null}.
 function adminsPanel(d){
  const pw=el('input',{id:'set-rcon',type:'password',autocomplete:'new-password',spellcheck:'false',maxlength:64,placeholder:d.secrets['rcon.password'].set?'leave empty to keep the current one':'at least 12 characters',oninput:dirty});
  adapterCtl.rcon=pw;
  const roles=el('ul',{class:'set-roles'},el('li',{class:'muted',text:'Loading…'}));
  let ownerUuid=null;
  const playerSel=el('select',{id:'set-role-player','aria-label':'Player'},el('option',{value:'',text:'Loading…'})),
   roleSel=el('select',{id:'set-role-role','aria-label':'Role to give'},el('option',{value:'admin',text:'Admin'}),el('option',{value:'moderator',text:'Moderator'}),el('option',{value:'',text:'Remove role'})),
   grantBtn=el('button',{id:'set-role-save',class:'btn small',type:'button',disabled:true,text:'Save',onclick:async()=>{
    const player=playerSel.value;if(!player)return;
    grantBtn.disabled=true;
    try{await api('/api/central/roles',{method:'POST',body:{player,role:roleSel.value||null}});toast(roleSel.value?`${ROLE[roleSel.value]} given`:'Role removed');await loadRoles();}
    catch(e){toast(e.message,'error');}
    finally{grantBtn.disabled=false;}
   }});
  function loadPlayers(){
   return api('/api/accounts').then(o=>{
    const known=(o.accounts??[]).filter(a=>a.subject&&a.subject!==ownerUuid);
    playerSel.replaceChildren(el('option',{value:'',text:known.length?'Choose a player…':'No known players yet'}),...known.map(a=>el('option',{value:a.subject,text:a.name??a.subject})));
    grantBtn.disabled=!known.length;
   }).catch(()=>{playerSel.replaceChildren(el('option',{value:'',text:'—'}));grantBtn.disabled=true;});
  }
  function loadRoles(){
   return api('/api/central/roles').then(r=>{
    ownerUuid=r.owner?.player??null;
    roles.replaceChildren(...[{name:r.owner?.name,role:'owner'},...(r.roles??[])].filter(x=>x.name).map(x=>el('li',{},el('span',{text:x.name}),el('span',{class:'tag',text:ROLE[x.role]??x.role}))));
    return loadPlayers();
   }).catch(e=>{roles.replaceChildren(el('li',{class:'muted',text:e.status===428?'Connect to your website on the Accounts page to see them here.':'The website did not answer: '+e.message}));playerSel.replaceChildren(el('option',{value:'',text:'—'}));grantBtn.disabled=true;});
  }
  loadRoles();
  return el('section',{class:'panel','aria-labelledby':'set-admins-h'},
   el('header',{class:'panel-h'},el('h3',{class:'mono',id:'set-admins-h',text:'Admins'})),
   el('div',{class:'connect-body'},
    el('p',{},el('b',{text:'In the game. '}),'Legacy has no admin list. A player is admin until they leave after typing ',el('code',{text:'rcon.login <password>'}),' in the F1 console. A wrong password kicks them. Give the password only to people you trust.'),
    el('div',{class:'field'},el('label',{for:'set-rcon',text:'New admin password'}),pw,
     el('p',{class:'set-help',text:d.secrets['rcon.password'].set?'A password is set. It is never shown here; type a new one to replace it.':'No password is set, so nobody can be admin in the game.'})),
    el('p',{},el('b',{text:'On your website. '}),'Admins and moderators use the website\'s admin tools, the same as the Players and Anti-cheat pages here.'),
    roles,
    el('div',{class:'field'},el('label',{text:'Give or remove a role'}),el('div',{class:'set-role-grant'},playerSel,roleSel,grantBtn)),
    el('p',{class:'set-help',text:'Some Oxide plugins have their own admin permissions. Set those with the plugin\'s own commands.'})));
 }
 function adapterPanel(d){
  const a=d.adapter??{};
  const head=el('header',{class:'panel-h'},el('h3',{class:'mono',id:'set-adapter-h',text:'Our adapter'}),el('p',{class:'mono muted',text:a.kind==='oxide'?'Oxide plugin':a.kind==='vanilla'?'Vanilla patch':'not installed'}));
  const wrap=el('section',{class:'panel','aria-labelledby':'set-adapter-h'},head);
  adapterCtl.lo=null;adapterCtl.motd=null;
  if(!a.kind){wrap.append(el('p',{class:'empty muted',text:'Our adapter is not on this server, so browser and loader players cannot join. Oxide servers copy adapter/RustLegacyBrowser.cs into the plugins folder; others run 10-Patch-TestCopy.ps1.'}));return wrap;}
  if(!a.exists||a.error){wrap.append(el('p',{class:'empty muted',text:a.error??(a.kind==='oxide'?'Oxide writes the plugin\'s config the first time the server starts with it. Start the server once, then set these here.':'The adapter config is written by 10-Patch-TestCopy.ps1. Run it first.')}));return wrap;}
  const facts=el('dl',{class:'facts'},...[['File',a.file],['Sidecar',a.values.SidecarUrl||'–'],['Plugin key',a.pluginKey.set?'set':'missing: browser joins are refused']].flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]));
  const body=el('div',{class:'connect-body'});
  for(const def of d.adapterSettings){
   const id='set-ad-'+def.key;let input;
   if(def.type==='bool'){input=el('select',{id,onchange:dirty},el('option',{value:'true',text:'On'}),el('option',{value:'false',text:'Off'}));}
   else input=el('input',{id,type:'text',maxlength:def.max,autocomplete:'off',placeholder:'nothing is sent',oninput:dirty});
   input.value=a.values[def.key]??def.def;adapterCtl[def.key]=input;
   body.append(el('div',{class:'field'},el('label',{for:id,text:def.label}),input,el('p',{class:'set-help',text:def.help})));
  }
  wrap.append(facts,body);return wrap;
 }
 function changes(){
  if(!data?.configured)return null;
  const values={},o={},remove=[],adapter={};let n=0;
  for(const [k,{input,d}] of controls){const now=input.value.trim(),was=d.value??'';if(now!==was){values[k]=now===''?null:now;n++;}}
  for(const [k,e] of other){if(e.remove){remove.push(k);n++;}else if(e.added||e.input.value!==e.value){o[k]=e.input.value;n++;}}
  const rcon=adapterCtl.rcon?.value??'';if(rcon)n++;
  const a=data.adapter;
  if(a?.exists&&!a.error)for(const def of data.adapterSettings){const i=adapterCtl[def.key];if(i&&i.value!==(a.values[def.key]??def.def)){adapter[def.key]=i.value;n++;}}
  return {n,body:{version:data.version,values,other:o,remove,...(rcon?{rconPassword:rcon}:{}),...(Object.keys(adapter).length?{adapter:{version:a.version,...adapter}}:{})}};
 }
 function dirty(){const c=changes(),n=c?.n??0;dirtyText.textContent=n?`${n} unsaved change${n===1?'':'s'}`:'No changes';saveBtn.disabled=!n;undoBtn.disabled=!n;}
 function restartNote(){
  const running=data?.serverState==='running'||data?.serverState==='starting';
  note.hidden=!running||!data.savedSinceStart;
  note.replaceChildren(el('span',{text:'Saved. The game server is running: restart it to use the new values. '}),el('span',{'data-target':'server'},el('button',{class:'btn small',type:'button','data-action':'restart',text:'Restart now'})));
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();const c=changes();if(!c?.n)return;
  // Curated "back to default" removes the line, so the server's own default applies.
  const body=c.body,nulls=Object.entries(body.values).filter(([,v])=>v===null).map(([k])=>k);
  for(const k of nulls)delete body.values[k];if(nulls.length)body.reset=nulls;
  saveBtn.setAttribute('aria-busy','true');errors.hidden=true;
  try{
   const r=await api('/api/server-settings',{method:'POST',body});
   toast(r.restartNeeded?'Saved. Restart the game server to use the new values.':'Saved. The game server uses them at its next start.');
   await load(r.restartNeeded);
  }catch(x){
   if(x.message==='sign-in')return;
   errors.hidden=false;errors.replaceChildren(el('b',{text:'Not saved. '}),x.message);
  }finally{saveBtn.removeAttribute('aria-busy');}
 });
 async function load(saved=false){
  try{const d=await api('/api/server-settings');d.savedSinceStart=saved||data?.savedSinceStart&&d.serverState==='running';data=d;render();}
  catch(e){if(e.message!=='sign-in')toast('Could not load the server settings: '+e.message,'error');}
 }
 return {id:'server',title:'Server',el:section,
  // Unsaved edits are kept while the page is open: no background refresh here.
  show(){visible=true;if(!data||!changes()?.n)load();},hide(){visible=false;}};
}
