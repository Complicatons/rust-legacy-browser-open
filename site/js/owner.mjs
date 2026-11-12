// Server owner tools (/owner): owned servers with publish, Steam-verified, enrolment-code and host-app-key controls, the
// server list entry (central/listings.mjs; reviewed by site staff when the site asks for it), and registration.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {toast} from './shell.mjs';

const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(Boolean));return e;};

function showEnrolment(id,code){
 $('#enrolment').hidden=false;$('#enrol-code').textContent=code;$('#enrol-command').textContent=`node tools/gateway.mjs enrol gateway.json ${code}\n# gateway.json "serverId": "${id}"`;
 $('#enrolment').scrollIntoView({behavior:'smooth',block:'nearest'});
}
// The host app's key (HOST-APP-PLAN.md "Accounts and links"): acts as you on this server's admin pages, shown once.
function showHostKey(key){
 $('#hostkey').hidden=false;$('#hostkey-value').textContent=key;
 $('#hostkey').scrollIntoView({behavior:'smooth',block:'nearest'});
}
const LISTING_STATE={pending:'Waiting for review',approved:'Approved',rejected:'Not approved'};
// The list entry's own fields as one string, so a name-only change saves without resending the listing.
const listingFields=f=>JSON.stringify(['description','tags','wipe','language','discord','website'].map(k=>f[k].value.trim()));
// The list entry form, filled from what was sent before.
function showListing(s,listing,reviewRequired){
 const f=$('#listing-form');f.server.value=s.id;$('#listing-title').textContent=`Server list entry · ${s.name}`;
 f.description.value=listing?.description??'';f.tags.value=(listing?.tags??[]).join(', ');f.wipe.value=listing?.wipe??'';f.language.value=listing?.language??'';
 f.discord.value=listing?.discord??'';f.website.value=listing?.website??'';f.agree.checked=false;
 f.servername.value=s.name;f.dataset.name=s.name;f.dataset.listing=listingFields(f);
 const st=$('#listing-state');st.dataset.state=listing?.state??'';
 st.textContent=!listing?(reviewRequired?'Fill this in and send it: the Rust Legacy team checks every new server before it shows in the list, usually within a day.':'Fill this in and send it: the server shows in the list as soon as its gateway reports.')
  :listing.state==='pending'?'Sent. The Rust Legacy team is checking it; you can still change it below.'
  :listing.state==='rejected'?`Not approved: ${(listing.note??'see the listing rules').replace(/[.\s]+$/,'')}. Change it and send it again.`
  :'Approved. Changes you send now go live straight away.';
 $('#listing').hidden=false;$('#listing').scrollIntoView({behavior:'smooth',block:'nearest'});f.description.focus({preventScroll:true});
}
async function act(btn,fn){btn.dataset.busy='';try{await fn();}catch(e){toast(explain(e.code),'error');}finally{delete btn.dataset.busy;}}

async function load(){
 const {servers}=await api('GET','/owner/servers');
 const listings=await Promise.all(servers.map(s=>api('GET',`/owner/servers/${s.id}/listing`).catch(()=>({listing:null,reviewRequired:false}))));
 $('#owned-count').textContent=String(servers.length);$('#owned-empty').hidden=servers.length>0;
 $('#owned').replaceChildren(...servers.map(s=>{
  const i=servers.indexOf(s),{listing,reviewRequired}=listings[i],approved=!reviewRequired||listing?.state==='approved',suspended=s.status==='suspended';
  const toggle=(label,path,body)=>el('button',{class:'btn small',type:'button',text:label,onclick:e=>act(e.currentTarget,async()=>{await api('POST',`/owner/servers/${s.id}/${path}`,body);await load();})});
  return el('li',{class:'owned-row'},
   el('div',{class:'owned-main'},el('span',{class:'dot'+(s.online?'':' off'),'aria-hidden':'true'}),el('b',{text:s.name}),el('span',{class:'mono muted',text:s.region.toUpperCase()})),
   el('dl',{class:'owned-stats'},
    el('div',{},el('dt',{class:'mono',text:'Status'}),el('dd',{text:s.online?'Online':'Offline'})),
    el('div',{},el('dt',{class:'mono',text:'Players'}),el('dd',{text:s.online?`${s.players??0}/${s.capacity??'?'}`:'—'})),
    el('div',{},el('dt',{class:'mono',text:'Listed'}),el('dd',{text:suspended?'Suspended':s.listed?'Yes':listing?LISTING_STATE[listing.state]:'No'})),
    el('div',{},el('dt',{class:'mono',text:'Client'}),el('dd',{text:s.steamVerified?'Steam':'Emulator'}))),
   el('div',{class:'owned-actions'},
    approved&&!suspended?toggle(s.listed?'Unlist':'Publish','publish',{listed:!s.listed}):null,
    suspended?null:el('button',{class:'btn small',type:'button',text:listing?'Edit listing':'Send listing',onclick:()=>showListing(s,listing,reviewRequired)}),
    el('a',{class:'btn small',href:'/console?server='+s.id,text:'Console'}),
    toggle(s.steamVerified?'Mark as emulator':'Mark Steam-verified','steam-verified',{verified:!s.steamVerified}),
    el('button',{class:'btn small',type:'button',text:'New enrolment code',onclick:e=>act(e.currentTarget,async()=>showEnrolment(s.id,(await api('POST',`/owner/servers/${s.id}/enrolment-code`)).enrolmentCode))}),
    el('button',{class:'btn small',type:'button',text:'New host app key',onclick:e=>act(e.currentTarget,async()=>showHostKey((await api('POST',`/owner/servers/${s.id}/host-key`)).hostKey))}),
    el('a',{class:'btn small',href:'/admin?server='+s.id,text:'Server admin'})));
 }));
}

const {me}=await loadSession();
if(!me){$('#owner-gate').hidden=false;}
else{
 $('#owner-tools').hidden=false;
 $('#register').addEventListener('submit',e=>{e.preventDefault();const f=e.target,btn=f.querySelector('button');
  if(!f.name.value.trim()||!f.region.value.trim())return toast('Add a name and a region','error');
  if(!/^wss:\/\//i.test(f.endpoint.value))return toast('The gateway address must start with wss://','error');
  act(btn,async()=>{const r=await api('POST','/owner/servers',{name:f.name.value,region:f.region.value.trim().toLowerCase(),endpoint:f.endpoint.value});f.reset();await load();showEnrolment(r.id,r.enrolmentCode);});});
 $('#listing-form').addEventListener('submit',e=>{e.preventDefault();const f=e.target,btn=f.querySelector('button[type=submit]');
  const name=f.servername.value.trim(),renamed=name!==f.dataset.name;
  if(!name)return toast('Add a server name','error');
  const rename=async()=>{if(renamed){await api('POST',`/owner/servers/${f.server.value}/name`,{name});f.dataset.name=name;}};
  if(renamed&&f.dataset.listing===listingFields(f))
   return act(btn,async()=>{await rename();toast('Server renamed');$('#listing').hidden=true;await load();});
  if(!f.description.value.trim())return toast('Add a description','error');
  if(!f.agree.checked)return toast('Tick the listing rules box first','error');
  const tags=f.tags.value.split(',').map(t=>t.trim()).filter(Boolean);
  if(tags.length>6)return toast('Use up to 6 tags','error');
  act(btn,async()=>{await rename();const r=await api('POST',`/owner/servers/${f.server.value}/listing`,{description:f.description.value,tags,wipe:f.wipe.value,language:f.language.value,discord:f.discord.value,website:f.website.value,agree:true});
   toast(r.state==='pending'?'Listing sent for review':r.listed?'Listed: players can find it now':'Listing saved');$('#listing').hidden=true;await load();});});
 $('#ls-desc').addEventListener('input',e=>{$('#ls-desc-count').textContent=`${e.target.value.length} of 600 characters.`;});
 $('#enrol-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#enrol-code').textContent);toast('Code copied');}catch{toast('Copy the code by hand','error');}});
 $('#hostkey-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#hostkey-value').textContent);toast('Key copied');}catch{toast('Copy the key by hand','error');}});
 await load().catch(e=>toast(explain(e.code),'error'));
}
document.body.dataset.ready='1';
