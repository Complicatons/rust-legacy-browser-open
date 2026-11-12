// Setup's third choice, "An existing server, as it is" (host/setup.mjs): your server and its SHA-256, browser ready, the
// website, the public address, and the confirmation to run. GET /api/attach, POST /api/attach/<step>. Changes need the
// game server stopped. Shown inside the Setup page (setup.mjs) when that mode is chosen.
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const FRAMEWORK={stock:'Stock',['stock-patched']:'Stock + adapter',oxide:'Oxide',fougerite:'Fougerite',modded:'Modded'};
const STEPS=['server','browserReady','website','address','run'];
const facts=(id,rows)=>$(id).replaceChildren(...rows.filter(r=>r[1]!=null&&r[1]!=='').flatMap(([k,v,tag])=>[el('dt',{text:k}),el('dd',{},String(v),tag?el('span',{class:'tag '+(tag.kind??''),text:tag.text}):null)]));
const showErr=(id,e)=>{const p=$(id);p.hidden=!e;p.textContent=e?e.message??String(e):'';};
const b64=file=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]??'');r.onerror=()=>rej(r.error);r.readAsDataURL(file);});

export function createAttachPage({api,toast,onChange=()=>{}}){
 let data=null,checked=null,busy=false;
 function serverFacts(i){
  if(!i)return [];
  if(i.error)return [['Folder',i.dir],['Problem',i.error]];
  return [['Folder',i.dir],
   ['rust_server.exe',i.exe?.sha256??'missing',i.exe?.sha256?(i.exe.verified?{text:'verified build',kind:'browser'}:{text:'not the verified build',kind:'warn'}):null],
   ['Assembly-CSharp.dll',i.assembly?.sha256,i.framework?{text:FRAMEWORK[i.framework]??i.framework}:null],
   ['Command line',i.launch?`${i.launch.args.join(' ')}  (${i.launch.source==='default'?'shipped default':i.launch.source})`:null],
   ...(i.notes??[]).map(n=>['Note',n])];
 }
 function render(){
  const s=data.steps,done=STEPS.filter(k=>s[k].done).length;
  $('at-done').textContent=String(done);
  $('at-framework').textContent=FRAMEWORK[s.server.info?.framework]??'–';
  $('at-site').textContent=s.website.done?'Linked':'Not yet';
  const note=$('at-note');
  note.hidden=!data.scripts;note.textContent=data.scripts?'This host shares its setup with the deploy\\host-test scripts (scripts.root in host.json). Steps here change only the app\'s own setup.':'';
  for(const k of STEPS){
   const li=document.querySelector(`.step[data-step=${k}]`);li.dataset.done=String(s[k].done);
   const v=li.querySelector('.verdict');v.dataset.state=s[k].done?'ok':'idle';v.textContent=s[k].done?'Done':'To do';
  }
  // 1. Server
  facts('at-server-facts',serverFacts(s.server.info));
  if(!$('at-dir').value&&s.server.dir)$('at-dir').value=s.server.dir;
  // 2. Browser ready
  const r=s.browserReady;
  $('at-ready-text').textContent=!s.server.done?'Choose your server first.':r.possible||r.done?
   (r.how==='oxide'?'Adds our one Oxide plugin (RustLegacyBrowser.cs) and its config. Your other plugins are left alone.':'Patches your own Assembly-CSharp.dll with our adapter (the original is kept beside it) and writes cfg/rustlegacybrowser.cfg. Undo puts every file back.')
   :(r.reason??'This server cannot be made browser ready.');
  $('at-ready-files').replaceChildren(...r.files.map(f=>el('li',{text:f})));
  $('at-launcher').checked=r.launcherOnly;
  $('at-ready-go').disabled=!(s.server.done&&(r.possible||r.done));$('at-ready-go').textContent=r.done?'Apply again':'Make browser ready';
  $('at-ready-undo').hidden=!r.byHost;
  // 3. Website
  const w=s.website;
  try{$('at-owner-link').href=new URL('/owner',w.website).href;}catch{}
  facts('at-site-facts',[['Website',w.website],['Server id',w.serverId],['Host app key',w.serverId?(w.hostKey?'saved':'missing: paste one on the Accounts page'):null],['Linked',w.connectedAt?new Date(w.connectedAt).toLocaleString():null]]);
  // 4. Address
  const a=s.address;
  const radio=document.querySelector(`#at-addr-form input[name=mode][value=${a.mode??'none'}]`);if(radio&&!document.querySelector('#at-addr-form input[name=mode]:checked'))radio.checked=true;
  if(!$('at-port').value&&a.port)$('at-port').value=a.port;$('at-cloudflare').checked||=Boolean(a.cloudflare);
  addrFields();
  $('at-addr-form').querySelector('[type=submit]').disabled=!w.done;
  if(!w.done)showErr('at-addr-err',{message:'Connect to the website first: the address goes into the gateway it enrols.'});else if($('at-addr-err').textContent.startsWith('Connect to the website first'))showErr('at-addr-err',null);
  // 5. Run
  $('at-confirm').checked=s.run.done;$('at-run-go').disabled=!s.server.done;
  onChange(data);
 }
 function addrFields(){
  const mode=document.querySelector('#at-addr-form input[name=mode]:checked')?.value??'none';
  $('at-addr-port-f').hidden=mode==='none';$('at-addr-cert-f').hidden=mode!=='certificate';
  $('at-port').placeholder=mode==='certificate'?'443':'28443';
 }
 async function load(){
  try{data=await api('/api/attach');}catch(e){if(e.message!=='sign-in')toast('Could not load setup: '+e.message,'error');return;}
  if(!data.available){$('at-note').hidden=false;$('at-note').textContent='Setup is not available: this host was started from a configuration object, not a host.json file.';return;}
  render();
 }
 async function step(name,body,{button,err}){
  if(busy)return null;busy=true;showErr(err,null);button?.setAttribute('aria-busy','true');
  try{const r=await api('/api/attach/'+name,{method:'POST',body});await load();return r;}
  catch(e){if(e.message!=='sign-in')showErr(err,e);return null;}
  finally{busy=false;button?.removeAttribute('aria-busy');}
 }
 $('at-server-form').addEventListener('submit',async e=>{
  e.preventDefault();showErr('at-server-err',null);$('at-check').hidden=true;
  const btn=e.submitter;btn?.setAttribute('aria-busy','true');
  try{checked=await api('/api/attach/inspect',{method:'POST',body:{dir:$('at-dir').value.trim()}});
   facts('at-check-facts',serverFacts(checked));$('at-check').hidden=false;
   $('at-accept-f').hidden=!checked.found||checked.exe.verified;$('at-accept').checked=false;$('at-use').disabled=!checked.found;}
  catch(x){showErr('at-server-err',x);}finally{btn?.removeAttribute('aria-busy');}
 });
 $('at-use').addEventListener('click',async e=>{
  if(!checked)return;
  if(!checked.exe.verified&&!$('at-accept').checked)return showErr('at-server-err',{message:'Tick the box to accept your own build, or choose the folder of the verified server.'});
  if(await step('server',{dir:checked.dir,accept:$('at-accept').checked},{button:e.currentTarget,err:'at-server-err'})){$('at-check').hidden=true;toast('Server set. The host reloaded its parts.');}
 });
 $('at-ready-go').addEventListener('click',async e=>{const r=await step('browser-ready',{launcherOnly:$('at-launcher').checked},{button:e.currentTarget,err:'at-ready-err'});if(r)toast(`Browser ready (${r.how==='oxide'?'Oxide plugin':'adapter patch'}).`);});
 $('at-ready-undo').addEventListener('click',async e=>{const r=await step('browser-ready/undo',{},{button:e.currentTarget,err:'at-ready-err'});if(r)toast(`Put back ${r.restored} file${r.restored===1?'':'s'}.`);});
 $('at-site-form').addEventListener('submit',async e=>{
  e.preventDefault();const r=await step('connect',{code:$('at-code').value.trim()},{button:e.submitter,err:'at-site-err'});
  if(r){$('at-code').value='';toast(r.hostKey?'Linked to the website: the gateway is enrolled and the console can reach this host.':'Gateway enrolled. Paste a host app key on the Accounts page for the website console.');}
 });
 for(const r of document.querySelectorAll('#at-addr-form input[name=mode]'))r.addEventListener('change',addrFields);
 $('at-addr-form').addEventListener('submit',async e=>{
  e.preventDefault();const mode=document.querySelector('#at-addr-form input[name=mode]:checked')?.value??'none';
  const body={mode,cloudflare:$('at-cloudflare').checked};const port=Number($('at-port').value);if(mode!=='none'&&port)body.port=port;
  if(mode==='certificate'){
   const files=[...$('at-pfx').files];
   const pfx=files.find(f=>/\.(pfx|p12)$/i.test(f.name)),key=files.find(f=>/\.key$/i.test(f.name)||/key/i.test(f.name)&&/\.pem$/i.test(f.name)),cert=files.find(f=>f!==key&&/\.(pem|crt)$/i.test(f.name));
   if(pfx){body.pfx=await b64(pfx);body.passphrase=$('at-pass').value;}else if(cert&&key){body.cert=await b64(cert);body.key=await b64(key);}
  }
  if(await step('address',body,{button:e.submitter,err:'at-addr-err'})){$('at-pfx').value='';$('at-pass').value='';toast('Address saved. The gateway restarted with it.');}
 });
 $('at-run-go').addEventListener('click',async e=>{if(await step('run',{confirm:$('at-confirm').checked},{button:e.currentTarget,err:'at-run-err'}))toast($('at-confirm').checked?'Saved. Start the server on the Overview.':'Saved. The host will not start the server.');});
 return {load,show(){load();},hide(){}};
}
