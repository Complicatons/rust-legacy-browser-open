// Settings → Discord alerts (host/alerts.mjs): the webhook URL (shown masked once saved), which events send an alert,
// the anti-cheat severity, a test alert, and the alerts sent lately. GET /api/alerts, POST /api/alerts/settings|test.
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const SEVERITY_WORDS={10:'Every flag (10 and up)',20:'20 and up (firing too fast and worse)',40:'40 and up (teleports, impossible shots)',60:'60 and up (only the clearest cases)'};

export const alertsSection={id:'alerts',title:'Discord alerts',create({api,toast,span,clock,serverNow}){
 let view=null;
 const when=t=>serverNow()-t<12*3600e3?clock(t):span(serverNow()-t)+' ago';
 const state=el('p',{class:'verdict','data-state':'idle',text:'–'});
 const url=el('input',{id:'al-url',type:'url',autocomplete:'off',spellcheck:'false',placeholder:'https://discord.com/api/webhooks/…'});
 const err=el('p',{class:'err',role:'alert',hidden:''});
 const saved=el('p',{class:'saved mono',hidden:''});
 const remove=el('button',{class:'btn small danger',type:'button',text:'Remove',hidden:''});
 const form=el('form',{class:'connect-body',id:'al-form'},
  el('p',{text:'Get a message in your Discord when something needs you. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL, then paste it here.'}),
  el('div',{class:'field'},el('label',{for:'al-url',text:'Webhook URL'}),url),saved,err,
  el('div',{class:'row'},el('button',{class:'btn primary',type:'submit',text:'Save'}),remove));
 const kinds=el('fieldset',{class:'switches',id:'al-kinds'},el('legend',{class:'mono',text:'Send an alert when'}));
 const sev=el('select',{id:'al-sev'});
 const test=el('button',{class:'btn',type:'button',id:'al-test',text:'Send test alert'});
 const recent=el('ol',{class:'event-list',id:'al-recent'});
 const part=el('section',{class:'panel','aria-labelledby':'al-h'},
  el('header',{class:'panel-h'},el('h2',{class:'mono',id:'al-h',text:'Discord alerts'}),state),
  el('div',{class:'settings-grid'},
   el('div',{},form,el('div',{class:'connect-body'},kinds,el('div',{class:'field'},el('label',{for:'al-sev',text:'Anti-cheat flags from severity'}),sev),el('div',{class:'row'},test))),
   el('div',{class:'settings-side'},el('h3',{class:'mono',text:'Sent lately'}),recent)));

 function render(v){
  view=v;
  state.dataset.state=v.configured?(v.lastError?'suspect':'ok'):'idle';state.textContent=v.configured?(v.lastError?'Not reaching Discord':'On'):'Off';
  saved.hidden=!v.configured;saved.textContent=v.configured?'Saved: '+v.url:'';
  url.placeholder=v.configured?'Paste a new URL to replace it':'https://discord.com/api/webhooks/…';
  remove.hidden=!v.configured;test.disabled=!v.configured;
  err.hidden=!v.lastError;err.textContent=v.lastError??'';
  if(!kinds.querySelector('input'))for(const [k,label] of Object.entries(v.kinds)){
   const box=el('input',{type:'checkbox',id:'al-k-'+k,'data-kind':k});
   box.addEventListener('change',()=>save({events:{[k]:box.checked}},(box.checked?'On: ':'Off: ')+label));
   kinds.append(el('label',{class:'check',for:'al-k-'+k},box,label));
  }
  for(const box of kinds.querySelectorAll('input'))box.checked=Boolean(v.events[box.dataset.kind]);
  if(!sev.options.length)for(const s of v.severities)sev.append(el('option',{value:String(s),text:SEVERITY_WORDS[s]??String(s)}));
  sev.value=String(v.flagSeverity);
  recent.replaceChildren(...(v.recent.length?v.recent.map(r=>el('li',{'data-level':r.ok?'info':'error'},el('time',{text:when(r.at)}),el('span',{text:`${r.title}${r.ok?'':' · not sent: '+r.error}`}))):[el('li',{class:'empty',text:'Nothing sent yet.'})]));
 }
 async function save(body,done){
  try{render(await api('/api/alerts/settings',{method:'POST',body}));if(done)toast(done);return true;}
  catch(e){if(view)render(view);if(e.message!=='sign-in'){err.hidden=false;err.textContent=e.message;}return false;}
 }
 const load=async()=>{try{render(await api('/api/alerts'));}catch(e){if(e.message!=='sign-in')toast('Could not load the alert settings: '+e.message,'error');}};
 form.addEventListener('submit',async e=>{e.preventDefault();if(!url.value.trim()){err.hidden=false;err.textContent='Paste the webhook URL first.';return;}if(await save({url:url.value.trim()},'Discord alerts saved. Send a test alert to check the channel.'))url.value='';});
 remove.addEventListener('click',()=>save({url:''},'Discord alerts removed'));
 sev.addEventListener('change',()=>save({flagSeverity:Number(sev.value)},'Flag severity saved'));
 test.addEventListener('click',async()=>{
  test.setAttribute('aria-busy','true');
  try{await api('/api/alerts/test',{method:'POST',body:{}});toast('Test alert sent. Check your Discord channel.');}
  catch(e){if(e.message!=='sign-in')toast('Discord did not take it: '+e.message,'error');}
  finally{test.removeAttribute('aria-busy');load();}
 });
 return {el:part,load};
}};
