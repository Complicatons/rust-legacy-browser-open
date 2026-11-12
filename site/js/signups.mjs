// Launch sign-ups for platform staff (/signups): the list, a CSV download for the opening-day email, copy, remove, and
// the opening-day email itself once a mail provider is connected (central/waitlist.mjs).
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {toast} from './shell.mjs';

const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null)e.setAttribute(k,v);}e.append(...kids);return e;};
const when=t=>new Date(t).toISOString().slice(0,16).replace('T',' ');
let entries=[],mailState=null,poll=0;

async function load(){
 const r=await api('GET','/admin/waitlist');entries=r.entries;mail(r);
 $('#su-count').textContent=String(r.count);$('#su-empty').hidden=r.count>0;
 const day=24*3600e3,now=Date.now(),stat=(n,l)=>el('div',{class:'stat'},el('b',{text:String(n)}),el('span',{class:'mono',text:l}));
 $('#su-stats').replaceChildren(stat(r.count,'Total'),stat(entries.filter(e=>now-e.createdAt<day).length,'Last 24 h'),stat(entries.filter(e=>now-e.createdAt<7*day).length,'Last 7 days'));
 $('#su-rows').replaceChildren(...entries.map(e=>el('tr',{},el('td',{text:e.email}),el('td',{class:'num',text:when(e.createdAt)}),
  el('td',{},el('button',{class:'btn small',type:'button',text:'Remove',onclick:async ev=>{if(!confirm(`Remove ${e.email} from the list?`))return;ev.currentTarget.dataset.busy='';
   try{await api('POST','/admin/waitlist/remove',{email:e.email});toast('Removed');await load();}catch(x){toast(explain(x.code),'error');}}})))));
}

// Opening-day email: the form appears once a mail provider is connected; mailings show progress, and Resume picks up
// whoever a stopped or partly failed mailing has not reached.
const MAIL_ERRORS={'mail-disabled':'Email is not connected yet.','subject-required':'Add a subject.','text-required':'Write the message.',
 'subject-too-long':'The subject is too long.','text-too-long':'The message is too long.','list-empty':'Nobody is on the list yet.',
 'mailing-running':'A mailing is still sending. Wait for it to finish.','no-email':'Your account has no email address to send the test to.',
 'mail-failed':'The mail provider refused the test. Check the central mail settings.'};
function mail(r){
 mailState=r;$('#su-mail-off').hidden=r.mail;$('#su-mail-form').hidden=!r.mail;$('#su-from').textContent=r.mail&&r.from?'From '+r.from:'';
 $('#su-send').textContent=`Send to ${r.count} ${r.count===1?'person':'people'}`;
 $('#su-mailings-wrap').hidden=!r.mailings.length;
 $('#su-mailings').replaceChildren(...r.mailings.map(m=>el('tr',{},el('td',{text:m.subject}),el('td',{class:'num',text:when(m.createdAt)}),
  el('td',{class:'num',text:`${m.sent} / ${m.total}`}),el('td',{class:'num',text:String(m.failed)}),
  el('td',{},m.running?el('span',{class:'mono',text:'Sending…'})
   :r.mail&&m.sent<m.total?el('button',{class:'btn small',type:'button',text:'Resume',onclick:()=>send('/admin/waitlist/mail/resume',{mailing:m.id})})
   :el('span',{class:'mono',text:'Done'})))));
 clearTimeout(poll);if(r.mailings.some(m=>m.running))poll=setTimeout(()=>load().catch(()=>{}),2000);
}
async function send(path,data){
 const err=$('#su-mail-err');err.hidden=true;
 try{
  const r=await api('POST',path,data);toast(r.to?'Test sent to '+r.to:'Sending…');
  // A sent mailing clears the form, so the same announcement is not sent twice by accident.
  if(!r.to&&path==='/admin/waitlist/mail'){$('#su-subject').value='';$('#su-text').value='';}
  await load();
 }
 catch(x){err.textContent=MAIL_ERRORS[x.code]??explain(x.code);err.hidden=false;}
}
const draft=()=>({subject:$('#su-subject').value,text:$('#su-text').value});

const {me}=await loadSession();
if(!me?.staff){$('#su-gate').hidden=false;}
else{
 $('#su-tools').hidden=false;
 $('#su-csv').addEventListener('click',()=>{
  const csv='email,signed_up_utc\r\n'+entries.map(e=>`"${e.email.replace(/"/g,'""')}",${new Date(e.createdAt).toISOString()}`).join('\r\n')+'\r\n';
  const a=el('a',{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:`launch-signups-${new Date().toISOString().slice(0,10)}.csv`});document.body.append(a);a.click();a.remove();});
 $('#su-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(entries.map(e=>e.email).join(', '));toast(`Copied ${entries.length} emails`);}catch{toast('Copy failed: use the CSV','error');}});
 $('#su-test').addEventListener('click',()=>send('/admin/waitlist/mail',{...draft(),test:true}));
 $('#su-mail-form').addEventListener('submit',e=>{e.preventDefault();
  if(!confirm(`Send "${$('#su-subject').value.trim()}" to ${mailState?.count??0} people? This can't be undone.`))return;
  send('/admin/waitlist/mail',draft());});
 await load().catch(x=>toast(explain(x.code),'error'));
}
document.body.dataset.ready='1';
