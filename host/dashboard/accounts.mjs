// Accounts page (HOST-APP-PLAN.md "Accounts and links"): linked website accounts with their characters and online
// state, unlink with a reason, the identity adapter's health and enrolment, desktop link requests step by step, and the
// link audit. Data: GET /api/accounts (adapter status + central admin API through the host app key).
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const STEPS=[['pending','Code redeemed'],['reserved','Reserved'],['linked','Linked']];
const KEY_ERRORS={400:'That is not a host app key. It starts with rlbh_.',403:'Your website does not accept this key for this server. Make a new one on the Owner page.',409:'Add the gateway to host.json first: the key belongs to its server.',502:'Could not reach your website. Is it running?'};

export function createAccountsPage({api,toast,span,clock,status,serverNow}){
 let data=null,timer=null,visible=false;
 // Today's events by the clock, older ones by age (a link made two days ago must not read as this morning).
 const when=t=>serverNow()-t<12*3600e3?clock(t):span(serverNow()-t)+' ago';
 async function load(){
  try{data=await api('/api/accounts');render();}
  catch(e){if(e.message!=='sign-in')toast('Could not load accounts: '+e.message,'error');}
 }
 function render(){
  const d=data;if(!d)return;
  $('acc-connect').hidden=d.hasKey&&d.central.ok;
  if(d.hasKey&&!d.central.ok){$('acc-key-err').hidden=false;$('acc-key-err').textContent=d.central.status===404?'Your website no longer accepts the saved key (it was replaced or revoked). Paste a new one.':'Could not reach your website: '+d.central.error;}
  const linked=d.accounts.filter(a=>a.linked);
  $('acc-linked').textContent=d.adapter.ok?String(d.adapter.identities.count):'–';
  $('acc-online').textContent=d.adapter.ok?String(d.adapter.leases.filter(l=>l.subject).length):'–';
  $('acc-desktop').textContent=String(d.accounts.filter(a=>a.desktopLink||a.kind==='desktop').length);
  $('acc-reserved').textContent=d.adapter.ok?String(d.adapter.reservations.length):'–';
  $('acc-source').textContent=d.central.ok?'names from your website':d.hasKey?'website unavailable':'names need the host app key';
  // Accounts table
  const rows=d.accounts.map(a=>{
   const kind=a.desktopLink||a.kind==='desktop'?'desktop':a.kind==='native'?'native':'browser';
   const state=a.online?el('span',{class:'online'},el('span',{class:'beacon','data-state':'running'}),'In game'):a.banned?el('span',{class:'tag bad',text:'Banned'}):el('span',{class:'muted',text:'Offline'});
   const unlink=el('button',{class:'btn small danger',type:'button',text:'Unlink',disabled:!a.linked||a.online?'':null,title:a.online?'The player is in the game; unlink after they leave':!a.linked?'Not linked on this server':null,onclick:()=>confirmUnlink(a)});
   return el('tr',{},
    el('td',{},el('span',{class:'name',text:a.name??'Unknown account'}),el('span',{class:'sub',text:a.subject.slice(0,8)})),
    el('td',{},el('span',{class:'tag '+kind,text:kind==='desktop'?'Desktop link':kind==='native'?'Native':'Browser'})),
    el('td',{class:'id',text:a.backendId??a.desktopLink?.backendRef??'–'}),
    el('td',{},state),
    el('td',{class:'id',text:a.lastSeen?span(serverNow()-a.lastSeen)+' ago':a.desktopLink?'linked '+span(serverNow()-a.desktopLink.linkedAt)+' ago':'–'}),
    el('td',{},unlink));
  });
  $('acc-table').tBodies[0].replaceChildren(...rows);$('acc-empty').hidden=rows.length>0;
  // Adapter panel
  const sc=status()?.components.find(c=>c.name==='sidecar'),hb=status()?.gatewayHealth?.heartbeat;
  const st=$('adapter-state');st.dataset.state=d.adapter.ok?'ok':'hung';st.textContent=d.adapter.ok?'Answering':'Not answering';
  const facts=[['Sidecar',sc?(sc.state+(sc.external?' (started outside the host)':'')):'not in host.json'],['Server ID',d.serverId??'–'],['Website',d.centralUrl??'–'],
   ['Last heartbeat',hb?.lastOk?span(serverNow()-hb.lastOk*1000)+' ago':'none yet'],['Host app key',d.hasKey?(d.central.ok?'accepted':'not accepted'):'not set'],
   ['Identities',d.adapter.ok?String(d.adapter.identities.count):'–'],['New characters',d.adapter.ok?(d.adapter.identities.namespace?'allocated for new browser accounts':'linked accounts only'):'–']];
  if(!d.adapter.ok)facts.push(['Problem',d.adapter.error]);
  $('adapter-facts').replaceChildren(...facts.flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]));
  // Desktop link flow: from the in-game code to the link, per request
  const flow=d.linkRequests.slice(0,30).map(r=>{
   const reached=r.status==='linked'?3:r.status==='reserved'?2:1,failed=r.status==='failed';
   return el('li',{},el('div',{class:'who'},el('b',{text:r.name??'Unknown'}),el('time',{class:'mono muted',text:when(r.updatedAt)})),
    el('div',{class:'steps'},...STEPS.map(([,label],i)=>el('span',{class:'step'+(i<reached?' done':failed&&i===reached?' fail':''),text:label}))),
    failed?el('p',{class:'why',text:'Stopped: '+(r.reason??'refused')}):null);
  });
  $('flow').replaceChildren(...(flow.length?flow:[el('li',{},el('p',{class:'muted',text:d.hasKey?'No desktop links yet. A desktop player types /browserlink in game and enters the code on the website.':'Link history needs the host app key.'}))]));
  // Audit
  const audit=[...d.audit.map(e=>({at:e.at,text:`${e.action.replace(/-/g,' ')}${e.playerName?' · '+e.playerName:''}${e.detail?.reason?' · '+e.detail.reason:''}${e.detail?.via?' (host app)':''}`})),
   ...(d.adapter.ok?d.adapter.unlinks.map(u=>({at:u.at,text:`unlinked here · character ${u.backendId} · ${u.reason}`})):[])].sort((a,b)=>b.at-a.at).slice(0,30);
  $('acc-audit').replaceChildren(...(audit.length?audit.map(a=>el('li',{},el('time',{text:when(a.at)}),el('span',{text:a.text}))):[el('li',{class:'empty',text:'No link changes yet.'})]));
 }
 function confirmUnlink(a){
  const dlg=$('unlink');$('unlink-err').hidden=true;$('unlink-reason').value='';
  $('unlink-text').textContent=`${a.name??'This account'} keeps their website account, and the character ${a.backendId??''} stays on the server with its items and buildings. The account will no longer play as that character${a.desktopLink?'; the desktop player can link again with a new code':'; on its next join here it starts a new character'}.`;
  dlg.showModal();
  dlg.onclose=async()=>{
   if(dlg.returnValue!=='ok')return;
   try{await api('/api/accounts/unlink',{method:'POST',body:{subject:a.subject,reason:$('unlink-reason').value}});toast(`Unlinked ${a.name??'the account'}`);await load();}
   catch(e){toast(e.message,'error');}
  };
 }
 $('acc-key-form').addEventListener('submit',async e=>{
  e.preventDefault();const err=$('acc-key-err'),btn=e.submitter;err.hidden=true;btn?.setAttribute('aria-busy','true');
  try{await api('/api/accounts/key',{method:'POST',body:{key:$('acc-key').value.trim()}});$('acc-key').value='';toast('Key saved. Accounts now read your website.');await load();}
  catch(x){err.hidden=false;err.textContent=KEY_ERRORS[x.status]??x.message;}
  finally{btn?.removeAttribute('aria-busy');}
 });
 return {
  show(){visible=true;load();clearInterval(timer);timer=setInterval(()=>{if(visible&&!document.hidden)load();},10000);},
  hide(){visible=false;clearInterval(timer);},
  refresh:()=>visible&&load(),
 };
}
