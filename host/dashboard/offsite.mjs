// Backups page, Off-site section: where sets go (a folder from host.json, or S3-compatible storage), when, how many are
// kept, encryption; the last upload; the stored sets with Download and restore. GET /api/offsite. The secret key and the
// passphrase are write-only: the page only learns whether one is saved.
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const size=b=>b==null?'–':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';
const STEP=s=>s.replace(/\.enc$/,'');

export function createOffsitePanel({api,toast,span,clock,serverNow,onRestored=()=>{}}){
 let timer=null,visible=false,last=null,formDirty=false;
 const when=t=>t?(serverNow()-t<12*3600e3?clock(t):new Date(t).toLocaleString()):'–';
 $('os-daily').replaceChildren(el('option',{value:'',text:'No daily run'}),...Array.from({length:24},(_,h)=>el('option',{value:String(h),text:String(h).padStart(2,'0')+':00'})));
 const showFields=()=>{const t=$('os-target').value;$('os-s3').hidden=t!=='s3';$('os-folder').hidden=t!=='folder';const enc=$('os-encrypt').checked;$('os-pass-f').hidden=!enc;$('os-pass-warn').hidden=!enc;};
 $('os-form').addEventListener('input',()=>{formDirty=true;showFields();});

 function fillForm(d){
  const s=d.settings;
  $('os-target').value=s.target;$('os-endpoint').value=s.s3.endpoint??'';$('os-region').value=s.s3.region??'';$('os-bucket').value=s.s3.bucket??'';
  $('os-prefix').value=s.s3.prefix??'';$('os-keyid').value=s.s3.accessKeyId??'';$('os-pathstyle').checked=s.s3.pathStyle!==false;
  $('os-secret').value='';$('os-secret').placeholder=d.secrets.s3SecretKey?'Saved. Type a new one to replace it':'';
  $('os-pass').value='';$('os-pass').placeholder=d.secrets.passphrase?'Saved. Type a new one to replace it':'At least 10 characters';
  $('os-every').value=String(s.everyHours);$('os-daily').value=s.dailyHour==null?'':String(s.dailyHour);
  $('os-recent').value=String(s.keepRecent);$('os-days').value=String(s.keepDays);$('os-encrypt').checked=s.encrypt;
  $('os-folder').textContent=d.folder?`Folder: ${d.folder}`:'No folder is set. Add "offsite": {"folder": "…"} to host.json (a network share, or a OneDrive or Dropbox folder), then restart the host app.';
  formDirty=false;showFields();
 }
 function render(d){
  last=d;
  if(!formDirty)fillForm(d);
  const sets=d.sets??[],complete=sets.filter(x=>x.complete),off=d.settings.target==='off';
  $('os-since').textContent=d.last?.ok?span(serverNow()-d.last.at):'–';
  $('os-count').textContent=off?'–':String(complete.length);
  $('os-next').textContent=d.nextAt?span(Math.max(0,d.nextAt-serverNow())):'–';
  $('os-size').textContent=complete[0]?size(complete[0].bytes):'–';
  const note=off?'Off-site backups are off. Choose where to send them on the right.'
   :d.listError?'Cannot read the stored sets: '+d.listError
   :d.last&&!d.last.ok?'The last upload failed: '+d.last.error
   :d.settings.encrypt&&!d.secrets.passphrase?'Encryption is on but no passphrase is saved, so nothing can be sent.':null;
  $('os-note').hidden=!note;$('os-note').textContent=note??'';
  $('os-busy').hidden=!d.busy;$('os-busy').textContent=d.busy?`${d.busy.op==='backup'?'Backing up':'Restoring'}: ${STEP(d.busy.step)} (${span(serverNow()-d.busy.startedAt)})`:'';
  $('os-run').disabled=off||Boolean(d.busy);$('os-run').setAttribute('aria-busy',d.busy?.op==='backup'?'true':'false');
  const l=d.last;
  $('os-last').replaceChildren(...(l?[['Result',l.ok?'Sent':'Failed'],['When',when(l.at)],...(l.ok?[['Set',l.set],['Size',size(l.bytes)],['Took',span(l.ms)],['Holds',`world save, ${l.userdataFiles} player files, ${l.identities==null?'no account links yet':l.identities+' account links'}`]]:[['Why',l.error]]),['To',l.target??'–'],['Started by',l.reason==='schedule'?'the schedule':'you']]
   :[['Result','Nothing sent yet']]).flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]));
  if(d.lastRestore)$('os-last').append(el('dt',{text:'Last restore'}),el('dd',{text:d.lastRestore.ok?`${d.lastRestore.set}, ${when(d.lastRestore.at)}`:`failed: ${d.lastRestore.error}`}));
  const blocked=d.restoreBlocked;
  $('os-table').tBodies[0].replaceChildren(...sets.map(x=>el('tr',{},
   el('td',{},el('span',{class:'name',text:when(x.at)}),el('span',{class:'sub',text:x.id})),
   el('td',{},x.complete?el('div',{class:'kinds'},el('span',{class:'tag',text:'World'}),x.userdataFiles!=null?el('span',{class:'tag',text:`${x.userdataFiles} player files`}):null,
     el('span',{class:'tag'+(x.identities==null?' warn':''),text:x.identities==null?'No links':`${x.identities} links`}),x.encrypted?el('span',{class:'tag browser',text:'Encrypted'}):null)
    :el('span',{class:'tag bad',text:'Unfinished'})),
   el('td',{class:'id',text:x.complete?size(x.bytes):'–'}),el('td',{class:'id',text:x.from??'–'}),
   el('td',{},el('div',{class:'acts'},x.complete&&!x.error?el('button',{class:'btn small',type:'button',text:'Restore',disabled:blocked||d.busy?'':null,title:blocked??null,onclick:()=>restore(x)}):null)))));
  $('os-empty').hidden=sets.length>0;
  $('os-empty').textContent=off?'Off-site backups are off.':d.listError?'The stored sets cannot be read right now.':'No sets yet. The first one goes up within a minute of saving the settings, once the watchdog has kept a completed save.';
 }
 async function load(refresh=false){
  let d;try{d=await api('/api/offsite'+(refresh?'?refresh=1':''));}catch(e){if(e.message!=='sign-in')toast('Could not load off-site backups: '+e.message,'error');return;}
  if(!d.available){$('offsite').hidden=true;return;}
  $('offsite').hidden=false;render(d);
  clearTimeout(timer);if(visible)timer=setTimeout(()=>{if(!document.hidden)load(Boolean(last?.busy));else load();},d.busy?1500:15000);
 }
 async function restore(x){
  const dlg=$('os-restore');
  $('osr-text').textContent=`The world, the player folder and the account links go back to ${when(x.at)} (${x.id}). What they replace is set aside in the backups folder, not deleted. The server and the sidecar stay stopped until you start them.`;
  $('osr-pass-f').hidden=!x.encrypted;$('osr-pass').value='';dlg.showModal();
  const ok=await new Promise(r=>dlg.addEventListener('close',()=>r(dlg.returnValue==='ok'),{once:true}));
  if(!ok)return;
  const p=api('/api/offsite/restore',{method:'POST',body:{set:x.id,passphrase:$('osr-pass').value||undefined}});$('osr-pass').value='';
  setTimeout(()=>load(),300);
  try{const r=await p;toast(`Restored ${r.set}.${r.setAside?' The replaced files are set aside.':''} Start the sidecar and the server to load it.`);onRestored();}
  catch(e){toast(e.message,'error');}
  load(true);
 }
 $('os-run').addEventListener('click',async()=>{
  try{await api('/api/offsite/run',{method:'POST',body:{}});toast('Off-site backup started');}catch(e){toast(e.message,'error');}
  load();
 });
 $('os-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const num=id=>Number($(id).value);
  const body={target:$('os-target').value,everyHours:num('os-every'),dailyHour:$('os-daily').value===''?null:num('os-daily'),keepRecent:num('os-recent'),keepDays:num('os-days'),encrypt:$('os-encrypt').checked,
   s3:{endpoint:$('os-endpoint').value,region:$('os-region').value,bucket:$('os-bucket').value,prefix:$('os-prefix').value,accessKeyId:$('os-keyid').value,pathStyle:$('os-pathstyle').checked}};
  if($('os-secret').value)body.s3SecretKey=$('os-secret').value;
  if($('os-pass').value)body.passphrase=$('os-pass').value;
  if(body.target!=='s3')delete body.s3; // fields of a target not in use are left as they were
  try{await api('/api/offsite/settings',{method:'POST',body});$('os-secret').value='';$('os-pass').value='';formDirty=false;toast('Off-site settings saved');load(true);}
  catch(x){toast(x.message,'error');}
 });
 return {
  show(){visible=true;load(true);},
  hide(){visible=false;clearTimeout(timer);},
 };
}
