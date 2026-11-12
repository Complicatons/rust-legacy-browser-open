// Server console (/console?server=<id>): the owner's host app as the website sees it (central/host-relay.mjs).
// Health, the parts with start/stop/restart, a game server restart with in-game warnings (the host app's schedule), the
// live log (every 2 s), backups and recent commands. For the server
// owner and site staff; the commands wait for the host app's next report and every one is in the audit log.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {toast} from './shell.mjs';

const $=s=>document.querySelector(s);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(k=>k!=null&&k!==false));return e;};
const POLL_MS=2000,KEEP_LINES=2000;
const WATCH={idle:'Server not running',grace:'Starting up',ok:'Healthy',suspect:'Quiet',hung:'Hang found'};
const STATE_NAME={running:'Running',starting:'Starting',stopping:'Stopping',stopped:'Stopped',failed:'Failed',crashed:'Crashed',backoff:'Restarting soon'};
const ago=t=>{if(!t)return 'never';const s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?`${s} s ago`:s<3600?`${Math.round(s/60)} min ago`:`${Math.round(s/3600)} h ago`;};
const dur=ms=>{if(!ms)return '—';const m=Math.floor(ms/60000);return m<60?`${m} min`:m<1440?`${Math.floor(m/60)} h ${m%60} min`:`${Math.floor(m/1440)} d ${Math.floor(m%1440/60)} h`;};
const size=b=>b==null?'':b>1048576?`${(b/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(b/1024))} KB`;
const time=t=>t?new Date(t).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';

let server=null,seq=0,timer=null,paused=false,held=[],view={connected:false,control:false,status:null},source='all',find='';
const lines=[];

function notice(text,kind='info'){const n=$('#notice');n.textContent=text;n.dataset.kind=kind;n.hidden=!text;}

async function command(body,label,btn){
 if(btn)btn.disabled=true;
 try{await api('POST',`/owner/servers/${server}/console-command`,body);toast(`${label}: sent to the host app`);await poll();}
 catch(e){toast(explain(e.code),'error');}
 finally{if(btn)btn.disabled=false;}
}
const power=(op,target,name,btn)=>{
 if(op!=='start'&&!confirm(`${op==='stop'?'Stop':'Restart'} ${name}? Players on the server will be disconnected.`))return;
 command({op,target},`${op[0].toUpperCase()+op.slice(1)} ${name}`,btn);
};

function renderStatus(){
 const s=view.status,on=view.connected;
 $('#con-link').textContent=on?(view.control?'Host app connected':'Connected · control off'):'Not connected';
 $('#con-link').dataset.state=on?'on':'off';
 $('#con-seen').textContent=view.lastReportAt?`Last report ${ago(view.lastReportAt)}`:'No report yet';
 $('#con-offline').hidden=on;
 const canAct=on&&view.control;
 for(const b of document.querySelectorAll('.con-all button'))b.disabled=!canAct;
 $('#con-keep').querySelector('button').disabled=!canAct;
 for(const b of document.querySelectorAll('#con-restart-in button'))b.disabled=!canAct;
 // The host app's schedule (host/schedule.mjs): what is counting down, what is next, the last wipe.
 const sch=s?.schedule,kind=e=>e.wipe==='full'?'full wipe':e.wipe?'map wipe':'restart';
 $('#con-schedule').textContent=!sch?'':[sch.pending?`A ${kind(sch.pending)} is counting down to ${time(sch.pending.at)}`:sch.next?`Next ${kind(sch.next)}: ${time(sch.next.at)}`:'No restart scheduled',
  sch.lastWipe?`last wipe ${time(sch.lastWipe.at)}`:null].filter(Boolean).join(' · ');
 const parts=s?.components??[],server=parts.find(p=>p.name==='server'),wd=s?.watchdog;
 const tile=(label,value,state)=>el('div',{class:'con-tile'+(state?' '+state:'')},el('dt',{class:'mono',text:label}),el('dd',{text:value}));
 $('#con-tiles').replaceChildren(
  tile('Players',s?.players?String(s.players.inGame??0):'—'),
  tile('Game server',server?STATE_NAME[server.state]??server.state:'—',server?.state==='running'?'ok':server?'bad':null),
  tile('Watchdog',wd?(wd.enabled===false?'Off':WATCH[wd.state]??'Watching'):'—',wd?.state==='hung'?'bad':wd?.state==='suspect'?'warn':null),
  tile('Last good save',s?.saves?.lastGood?.at?ago(s.saves.lastGood.at):'—'));
 $('#con-parts').tBodies[0].replaceChildren(...(parts.length?parts.map(p=>{
  const name=p.label??p.name,running=p.state==='running'||p.state==='starting';
  const act=(op,text,secondary)=>el('button',{type:'button',class:'small'+(secondary?' secondary':''),text,disabled:!canAct,onclick:e=>power(op,p.name,name,e.currentTarget)});
  return el('tr',{},el('td',{},el('b',{text:name}),p.external?el('span',{class:'meta',text:' started outside the host app'}):null),
   el('td',{},el('span',{class:'con-state','data-state':p.state,text:STATE_NAME[p.state]??p.state})),el('td',{class:'mono con-parts-wide',text:running?dur(p.uptimeMs):'—'}),
   el('td',{class:'mono con-parts-wide',text:String(p.restarts??0)}),
   el('td',{},el('span',{class:'actions'},running?act('restart','Restart',true):act('start','Start'),running?act('stop','Stop',true):null)));
 }):[el('tr',{},el('td',{colspan:'5',class:'meta',text:on?'The host app reports no parts.':'Waiting for the host app.'}))]));
}

function renderBackups(){
 const b=view.backups,canAct=view.connected&&view.control;
 $('#con-backups-note').textContent=!b?'Backups show here once the host app reports.':!b.configured?'This host app has no game server set up, so there are no saves to back up.':
  b.serverState==='running'?'Stop the game server before restoring a copy: a running server would overwrite it at its next autosave.':'The game server is stopped: a copy can be restored.';
 $('#con-backups').replaceChildren(...(b?.copies??[]).map(c=>el('li',{class:'server con-backup'},
  el('span',{},el('b',{text:c.label||c.name}),el('span',{class:'meta',text:` ${c.source==='owner'?'kept by you':'automatic'} · ${time(c.at)} · ${size(c.bytes)}`})),
  el('button',{type:'button',class:'small secondary',text:'Restore',disabled:!canAct||b.serverState==='running',onclick:e=>{
   if(!confirm(`Restore ${c.label||c.name}? The current save is set aside first.`))return;
   command({op:'backup-restore',name:c.name},'Restore',e.currentTarget);}}))));
}

function renderCommands(){
 const NAME={done:'Done',failed:'Failed',queued:'Waiting',sent:'Running',expired:'Not picked up'};
 $('#con-cmds').replaceChildren(...(view.commands?.length?view.commands.map(c=>el('li',{class:'server con-cmd'},
  el('span',{},el('b',{text:`${c.op}${c.target?' '+c.target:''}${c.name?' '+c.name:''}${c.label?' ('+c.label+')':''}`}),el('span',{class:'meta',text:` ${c.by??''} · ${time(c.at)}`})),
  el('span',{class:'con-state','data-state':c.state,text:NAME[c.state]??c.state}),c.error?el('span',{class:'meta',text:' '+c.error}):null)):
  [el('li',{class:'server meta',text:'Nothing yet.'})]));
}

// The log: the newest 2000 lines in memory; the view applies the source chips and the search box.
const shows=l=>(source==='all'||l.source===source)&&(!find||l.text.toLowerCase().includes(find));
const lineEl=l=>el('div',{class:'con-line','data-level':l.level||'info'},el('span',{class:'con-t mono',text:new Date(l.at).toLocaleTimeString('en-GB')}),el('span',{class:'con-src mono',text:l.source}),el('span',{class:'con-x',text:l.text}));
function renderSources(){
 const names=['all',...new Set(lines.map(l=>l.source))];
 const box=$('#con-sources');if(box.dataset.names===names.join())return;box.dataset.names=names.join();
 box.replaceChildren(...names.map(n=>el('button',{type:'button',class:'chip','aria-pressed':String(n===source),text:n==='all'?'All':n,onclick:()=>{source=n;for(const b of box.children)b.setAttribute('aria-pressed',String(b.textContent===(n==='all'?'All':n)));redrawLog();}})));
}
function redrawLog(){const log=$('#con-log');log.replaceChildren(...lines.filter(shows).map(lineEl));log.scrollTop=log.scrollHeight;}
function addLines(add){
 if(!add.length)return;
 const log=$('#con-log'),atEnd=log.scrollHeight-log.scrollTop-log.clientHeight<40;
 lines.push(...add);
 if(lines.length>KEEP_LINES){lines.splice(0,lines.length-KEEP_LINES);redrawLog();}
 else log.append(...add.filter(shows).map(lineEl));
 while(log.childElementCount>KEEP_LINES)log.firstChild.remove();
 if(atEnd)log.scrollTop=log.scrollHeight;
 renderSources();
}

async function poll(){
 if(!server)return;
 try{
  // Up to four pages at a time so a long backlog catches up quickly.
  for(let i=0;i<4;i++){
   const r=await api('GET',`/owner/servers/${server}/console?since=${seq}`);
   view=r;if(r.seq<seq){seq=0;lines.length=0;redrawLog();continue;} // central restarted: its numbering began again
   if(paused)held.push(...r.logs);else addLines(r.logs);
   if(r.logs.length)seq=r.logs.at(-1).n;
   if(r.logs.length<500)break;
  }
  renderStatus();renderBackups();renderCommands();notice('');
 }catch(e){notice(explain(e.code),'error');}
}

async function open(id,list){
 server=id;seq=0;lines.length=0;$('#con-log').replaceChildren();delete $('#con-sources').dataset.names;
 const s=list.find(x=>x.id===id);$('#con-name').textContent=s?.name??'';$('#con-admin').href='/admin?server='+id;
 history.replaceState(null,'','/console?server='+id);
 clearInterval(timer);await poll();timer=setInterval(()=>{if(!document.hidden)poll();},POLL_MS);
}

const {me}=await loadSession();
if(!me){$('#con-gate').hidden=false;}
else{
 // The servers this account may run: its own, or every server for site staff.
 const {servers=[]}=await api('GET','/admin/servers').catch(()=>({servers:[]}));
 const mine=servers.filter(s=>s.role==='owner'||s.role==='staff');
 if(!mine.length)$('#con-none').hidden=false;
 else{
  $('#con').hidden=false;
  const pick=$('#con-server');pick.replaceChildren(...mine.map(s=>el('option',{value:s.id,text:s.name})));
  const want=new URLSearchParams(location.search).get('server'),first=mine.some(s=>s.id===want)?want:mine[0].id;pick.value=first;
  pick.addEventListener('change',()=>open(pick.value,mine));
  for(const b of document.querySelectorAll('.con-all button'))b.addEventListener('click',e=>power(b.dataset.op,'all','every part',e.currentTarget));
  $('#con-restart-in').addEventListener('submit',e=>{e.preventDefault();const m=Number(e.target.minutes.value);if(!confirm(`Restart the game server in ${m} min? Players are warned in chat, then it saves and starts again.`))return;command({op:'restart-in',minutes:m},`Restart in ${m} min`,e.target.querySelector('button'));});
  $('#con-restart-cancel').addEventListener('click',e=>command({op:'restart-cancel'},'Cancel the restart',e.currentTarget));
  $('#con-keep').addEventListener('submit',e=>{e.preventDefault();const f=e.target;command({op:'backup-keep',label:f.label.value.trim()},'Keep a copy',f.querySelector('button'));f.reset();});
  $('#con-pause').addEventListener('click',e=>{paused=!paused;if(!paused){addLines(held.slice(-KEEP_LINES));held=[];}e.currentTarget.setAttribute('aria-pressed',String(paused));e.currentTarget.textContent=paused?'Resume':'Pause';});
  $('#con-find').addEventListener('input',e=>{find=e.target.value.trim().toLowerCase();redrawLog();});
  await open(first,mine);
 }
}
document.body.dataset.ready='1';
