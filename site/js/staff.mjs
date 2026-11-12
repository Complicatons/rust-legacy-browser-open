// Site staff panel (/staff, central/listings.mjs): every registered server with its health at a glance, the listing
// requests waiting for review, and suspend/restore. Each server opens its console and admin panel, where site staff
// has the owner's powers. Refreshes every 15 s.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {toast} from './shell.mjs';

const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(k=>k!=null&&k!==false));return e;};
const ago=t=>{if(!t)return 'never';const s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?`${s} s ago`:s<3600?`${Math.round(s/60)} min ago`:s<86400?`${Math.round(s/3600)} h ago`:`${Math.round(s/86400)} d ago`;};
const LISTING={approved:'Approved',pending:'Waiting',rejected:'Rejected'};

let servers=[],sort={key:'state',dir:1};
function notice(text,kind='info'){const n=$('#notice');n.textContent=text;n.dataset.kind=kind;n.hidden=!text;}
const stateOf=s=>s.status!=='active'?'suspended':s.online?'online':'offline';
const attention=s=>s.status!=='active'||s.flags24h>0||s.openReports>0||s.holds>0||s.listing==='pending'||(s.listed&&!s.online);
const sortValue={name:s=>s.name.toLowerCase(),owner:s=>(s.owner??'').toLowerCase(),state:s=>({online:0,offline:1,suspended:2})[stateOf(s)],players:s=>-(s.players??-1),
 host:s=>s.hostApp.connected?0:1,listing:s=>({pending:0,approved:1,rejected:2})[s.listing]??3,flags24h:s=>-s.flags24h,openReports:s=>-s.openReports,holds:s=>-s.holds};

function tiles(){
 const t=(label,value,warn)=>el('div',{class:'st-tile'+(warn?' warn':'')},el('dd',{text:String(value)}),el('dt',{class:'mono',text:label}));
 const on=servers.filter(s=>s.online&&s.status==='active');
 $('#st-tiles').replaceChildren(t('Servers',servers.length),t('Online',on.length),t('Players now',on.reduce((n,s)=>n+(s.players??0),0)),
  t('Listing requests',servers.filter(s=>s.listing==='pending').length,servers.some(s=>s.listing==='pending')),
  t('Flags 24 h',servers.reduce((n,s)=>n+s.flags24h,0)),t('Open reports',servers.reduce((n,s)=>n+s.openReports,0),servers.some(s=>s.openReports>0)));
}

function table(){
 const find=$('#st-find').value.trim().toLowerCase(),show=$('#st-show').value;
 const rows=servers.filter(s=>(!find||s.name.toLowerCase().includes(find)||(s.owner??'').toLowerCase().includes(find))&&
  (show==='all'||(show==='online'&&s.online&&s.status==='active')||(show==='attention'&&attention(s))||(show==='suspended'&&s.status!=='active')))
  .sort((a,b)=>{const x=sortValue[sort.key](a),y=sortValue[sort.key](b);return (x<y?-1:x>y?1:a.name.localeCompare(b.name))*sort.dir;});
 for(const b of document.querySelectorAll('.st-sort'))b.closest('th').setAttribute('aria-sort',b.dataset.key===sort.key?(sort.dir>0?'ascending':'descending'):'none');
 const n=(v,warn)=>el('td',{class:'mono'+(v>0&&warn?' st-warn':''),text:String(v)});
 $('#st-servers').tBodies[0].replaceChildren(...(rows.length?rows.map(s=>{
  const st=stateOf(s);
  return el('tr',{class:st==='suspended'?'st-suspended':null},
   el('td',{},el('b',{text:s.name}),el('span',{class:'meta',text:` ${s.region.toUpperCase()}`})),
   el('td',{text:s.owner??'—'}),
   el('td',{},el('span',{class:'tag '+(st==='online'?'ok':st==='suspended'?'bad':''),text:st}),st==='offline'?el('span',{class:'meta',text:' '+ago(s.lastHeartbeat)}):null),
   el('td',{class:'mono',text:s.online&&st!=='suspended'?`${s.players??0}/${s.capacity??'?'}`:'—'}),
   el('td',{},el('span',{class:'tag '+(s.hostApp.connected?'ok':''),text:s.hostApp.connected?'Connected':'No'})),
   el('td',{},s.listing?el('span',{class:'tag '+(s.listing==='pending'?'warn':s.listing==='approved'?'ok':'bad'),text:LISTING[s.listing]}):el('span',{class:'meta',text:'None'}),s.listed?el('span',{class:'meta',text:' listed'}):null),
   n(s.flags24h,true),n(s.openReports,true),n(s.holds,true),
   el('td',{},el('span',{class:'actions row-actions'},
    el('a',{class:'btn small',href:'/console?server='+s.id,text:'Console'}),
    el('a',{class:'btn small',href:'/admin?server='+s.id,text:'Admin'}),
    el('button',{type:'button',class:'small secondary',text:s.status==='active'?'Suspend':'Restore',onclick:e=>suspend(s,e.currentTarget)}))));
 }):[el('tr',{},el('td',{colspan:'10',class:'meta',text:servers.length?'No server matches.':'No servers registered yet.'}))]));
}

async function suspend(s,btn){
 const on=s.status==='active';let reason=null;
 if(on){reason=prompt(`Suspend ${s.name}? It leaves the server list and its gateway stops working. The reason goes in the audit log:`);if(!reason?.trim())return;}
 else if(!confirm(`Restore ${s.name}? Its gateway works again and, if it was listed, it shows on the list again.`))return;
 btn.disabled=true;
 try{await api('POST',`/staff/servers/${s.id}/suspend`,{suspended:on,reason});toast(on?`${s.name} suspended`:`${s.name} restored`);await load();}
 catch(e){toast(explain(e.code),'error');}finally{btn.disabled=false;}
}

async function review(l,decision,btn){
 let note=null;
 if(decision==='reject'){note=prompt(`Why is ${l.name} not listed? The owner sees this note:`);if(!note?.trim())return;}
 btn.disabled=true;
 try{const r=await api('POST',`/staff/servers/${l.server}/listing-review`,{decision,note});
  toast(decision==='approve'?(r.listed?`${l.name} is on the server list`:`${l.name} approved; it lists once its gateway reports`):`${l.name} rejected`);await load();}
 catch(e){toast(explain(e.code),'error');}finally{btn.disabled=false;}
}

function queue(listings,reviewRequired){
 $('#st-review-mode').textContent=reviewRequired?'New listings wait here until approved.':'Review is off on this site: listings are approved as they are sent. These are the ones already sent.';
 const link=(href,text)=>href?el('a',{href,target:'_blank',rel:'noopener nofollow',text}):null;
 $('#st-queue').replaceChildren(...(listings.length?listings.map(l=>el('li',{class:'st-req'},
  el('div',{class:'st-req-head'},el('b',{text:l.name}),el('span',{class:'meta',text:` ${l.region.toUpperCase()} · by ${l.owner} · sent ${ago(l.submittedAt)} · ${l.online?'online':'offline'}`})),
  el('p',{text:l.description}),
  el('p',{class:'st-req-tags'},...l.tags.map(t=>el('span',{class:'tag',text:t}))),
  el('p',{class:'meta'},[l.wipe?`Wipes: ${l.wipe}`:null,l.language?`Language: ${l.language}`:null].filter(Boolean).join(' · ')||null,' ',link(l.discord,'Discord'),' ',link(l.website,'Website'),' ',el('code',{text:l.endpoint})),
  el('p',{class:'actions'},el('button',{type:'button',class:'small',text:'Approve',onclick:e=>review(l,'approve',e.currentTarget)}),el('button',{type:'button',class:'small secondary',text:'Reject',onclick:e=>review(l,'reject',e.currentTarget)}))))
  :[el('li',{class:'server meta',text:'Nothing waiting.'})]));
}

async function load(){
 try{
  const [s,q]=await Promise.all([api('GET','/staff/servers'),api('GET','/staff/listings?state=pending')]);
  servers=s.servers;tiles();table();queue(q.listings,s.reviewRequired);notice('');
 }catch(e){notice(explain(e.code),'error');}
}

const {me}=await loadSession();
if(!me?.staff){$('#st-gate').hidden=false;}
else{
 $('#st').hidden=false;
 for(const b of document.querySelectorAll('.st-sort'))b.addEventListener('click',()=>{sort=sort.key===b.dataset.key?{key:sort.key,dir:-sort.dir}:{key:b.dataset.key,dir:1};table();});
 $('#st-find').addEventListener('input',table);$('#st-show').addEventListener('change',table);
 await load();setInterval(()=>{if(!document.hidden)load();},15000);
}
document.body.dataset.ready='1';
