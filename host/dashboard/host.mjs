// Rust Legacy Host dashboard: sign-in, Overview (server, vital signs, components, host events) and live Logs.
// Reads /api/status once and then the /api/events stream (HOST-APP-PLAN.md "Dashboard").
import {createAccountsPage} from './accounts.mjs';
import {createAdminPages} from './admin-pages.mjs';
import {createBackupsPage} from './backups.mjs';
import {createUpdatesPage} from './updates.mjs';
import {createSettingsPage} from './settings.mjs';
import {createPluginsPage} from './plugins.mjs';
import {createHealthCard} from './health-check.mjs';
import {createHealthPage} from './health.mjs';
import {createSchedulePage} from './schedule.mjs';
import {stopWarning} from './stop-text.mjs';
import {createSetupPage} from './setup.mjs';
import {pickBridge} from './desktop-bridge.mjs';
import {createBoot} from './boot.mjs';
import {createTerminalPanel} from './terminal.mjs';
const $=id=>document.getElementById(id);
// Inside the desktop app (host/desktop) the page has a bridge to the window: the owner token, the tray icon and real
// shells for the terminal panel. In a plain browser there is none, and the page is the same dashboard without them.
const bridge=pickBridge();
document.documentElement.dataset.shell=bridge?.kind??'browser';
// The app signs in by itself; its sign-in form is only the fallback, so it speaks of the token, not of a link.
if(bridge)$('signin-help').textContent='Paste the owner token from owner.token in the host\'s data folder. Next time the app opens, it signs you in by itself.';
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const LABEL={central:'Website',sidecar:'Sidecar',server:'Game server',gateway:'Gateway',host:'Host'};
const STATE_WORD={stopped:'Stopped',starting:'Starting',running:'Running',stopping:'Stopping',backoff:'Restarting',failed:'Failed'};
const VERB={start:['Start','Starting'],stop:['Stop','Stopping'],restart:['Restart','Restarting'],freeze:['Simulate the freeze','Freezing']};
const MAX_LINES=5000,SHOWN=1500;

let status=null,skew=0,es=null;
const logs=[];let errorsUnseen=0;
const ticks={log:[],udp:[],cpu:[]};
const serverNow=()=>Date.now()+skew;
// The SSE stream's events for the boot screen and the terminal's Host tab (the same stream the pages use).
const listeners={status:new Set(),state:new Set(),log:new Set()};
const subscribe=(kind,fn)=>{listeners[kind].add(fn);return ()=>listeners[kind].delete(fn);};
const emit=(kind,data)=>{for(const f of [...listeners[kind]])try{f(data);}catch(e){console.error(e);}};

// ---------- API ----------
async function api(path,{method='GET',body}={}){
 const res=await fetch(path,{method,credentials:'same-origin',headers:method==='POST'?{'content-type':'application/json','x-rlb-host':'1'}:{},body:body?JSON.stringify(body):undefined});
 if(res.status===401&&path!=='/api/login'){showSignIn();throw Error('sign-in');}
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Object.assign(Error(data.error??res.status),{status:res.status});
 return data;
}

// ---------- Formatting ----------
const pad=n=>String(n).padStart(2,'0');
const clock=t=>{const d=new Date(t);return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;};
function span(ms){
 if(ms==null||ms<0)return '–';const s=Math.floor(ms/1000);
 if(s<60)return s+'s';const m=Math.floor(s/60);if(m<60)return m+'m';const h=Math.floor(m/60);if(h<48)return `${h}h ${pad(m%60)}m`;return Math.floor(h/24)+'d';
}
const ageText=s=>s==null?'–':s<10?s.toFixed(1)+'s':Math.round(s)+'s';

// ---------- Sign-in ----------
function showSignIn(msg){
 es?.close();es=null;appStarted=false;
 $('app').hidden=true;$('signin').hidden=false;
 const err=$('signin-err');err.hidden=!msg;err.textContent=msg??'';
 $('token').focus();
}
async function signIn(token,{quiet=false}={}){
 try{await api('/api/login',{method:'POST',body:{token}});}
 catch(e){if(!quiet)showSignIn(e.status===401?'That is not this host\'s owner token.':'Sign-in failed ('+e.message+').');return false;}
 return true;
}
$('signin-form').addEventListener('submit',async e=>{e.preventDefault();if(await signIn($('token').value.trim())){$('token').value='';$('signin').hidden=true;boot({signedIn:true,via:'form'});}});
$('signout').addEventListener('click',async()=>{await api('/api/logout',{method:'POST'}).catch(()=>{});showSignIn();});

// ---------- Views ----------
function route(){
 const view=(location.hash.slice(1).split('?')[0])||'overview';
 const known=[...document.querySelectorAll('.view')].some(v=>v.dataset.view===view)?view:'overview';
 for(const v of document.querySelectorAll('.view'))v.hidden=v.dataset.view!==known;
 for(const a of document.querySelectorAll('.rail a'))if(a.dataset.view===known)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 if(known==='logs'){errorsUnseen=0;renderErrorCount();renderLogs(true);}
 if(known==='overview')drawStrip();
 for(const [name,page] of Object.entries(pages))if(name===known)page.show(pendingArg);else page.hide();
 pendingArg=null;
}
addEventListener('hashchange',route);

// ---------- Actions ----------
const comp=name=>status?.components.find(c=>c.name===name);
async function act(action,target,button){
 const server=comp('server');
 if((action==='stop'||action==='restart')&&(target==='server'||target==='all')&&server?.kind==='original'&&server.state==='running'){
  // Fresh: whether the server plugin answers now decides between save-and-quit and the old kill.
  const fresh=await api('/api/status').catch(()=>status),lastSave=fresh.saves?.lastGood?.at;
  $('confirm-h').textContent=action==='restart'?'Restart the game server?':target==='all'?'Stop everything?':'Stop the game server?';
  $('confirm-text').textContent=stopWarning({action,target,graceful:fresh.graceful,saveSeconds:fresh.graceful?.saveSeconds,lastSaveAgo:lastSave?span(serverNow()-lastSave):null});
  $('confirm-ok').textContent=VERB[action][0];
  $('confirm').showModal();
  const ok=await new Promise(r=>$('confirm').addEventListener('close',()=>r($('confirm').returnValue==='ok'),{once:true}));
  if(!ok)return false;
 }
 const label=button?.textContent;
 if(button){button.setAttribute('aria-busy','true');button.textContent=VERB[action][1]+'…';}
 try{await api('/api/action',{method:'POST',body:{action,target}});toast(action==='freeze'?'The mock server is frozen like the 2026-10-22 autosave. Watch the three lanes go quiet.':`${VERB[action][1]} ${target==='all'?'all components':LABEL[target]??target}…`);return true;}
 catch(e){if(e.message!=='sign-in')toast(`Could not ${action} ${LABEL[target]??target}: ${e.message}`,'error');return false;}
 finally{if(button)setTimeout(()=>{button.removeAttribute('aria-busy');button.textContent=label;},600);}
}
document.addEventListener('click',e=>{
 const b=e.target.closest('button[data-action]');if(!b)return;
 const target=b.closest('[data-target]')?.dataset.target;if(target)act(b.dataset.action,target,b);
});
function toast(text,kind='info'){
 const t=document.createElement('div');t.className='toast';t.dataset.kind=kind;t.textContent=text;$('toasts').append(t);
 setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),reduced.matches?0:160);},4000);
}

// ---------- Overview ----------
function renderServer(){
 const s=comp('server');
 const has=Boolean(s);
 document.querySelector('.hero-actions').hidden=!has;
 if(!has){$('server-state').textContent='Not configured';$('server-msg').textContent='Prepare it on the Setup page';$('server-beacon').dataset.state='stopped';return;}
 $('server-kind').textContent=s.kind==='mock'?'Mock game server (testing)':'Original Legacy server';
 $('server-beacon').dataset.state=s.state;
 $('server-state').textContent=STATE_WORD[s.state]??s.state;
 $('server-msg').textContent=[s.pid?`PID ${s.pid}`:'',s.message].filter(Boolean).join(' · ');
 const btn=a=>document.querySelector(`.hero-actions [data-action=${a}]`);
 btn('start').disabled=s.state==='running'||s.state==='starting'||s.state==='stopping';
 btn('stop').disabled=s.state==='stopped';
 btn('restart').disabled=s.state!=='running';
 $('st-restarts').textContent=s.restarts;
 const freeze=$('freeze-row');freeze.hidden=s.kind!=='mock';freeze.querySelector('button').disabled=s.state!=='running';
}
function renderStats(){
 const s=comp('server');
 $('st-uptime').textContent=s&&(s.state==='running'||s.state==='starting')&&s.startedAt?span(serverNow()-s.startedAt):'–';
 $('st-players').textContent=status?.players?String(status.players.inGame):'–';
 const g=status?.saves?.lastGood;$('st-save').textContent=g?span(serverNow()-g.at):'–';
 const since=serverNow()-60000;let n=0;for(let i=logs.length-1;i>=0&&logs[i].at>=since;i--)n++;
 $('st-rate').textContent=n;
}
function cardFor(c){
 let el=document.querySelector(`.card[data-name="${c.name}"]`);
 if(!el){
  el=document.createElement('article');el.className='card';el.dataset.name=c.name;el.dataset.target=c.name;
  el.innerHTML=`<div class="card-h"><span class="beacon"></span><h3 class="h"></h3><span class="card-state"></span></div><dl></dl><p class="msg" hidden></p>
   <div class="row"><button class="btn small" data-action="start" type="button">Start</button><button class="btn small" data-action="restart" type="button">Restart</button><button class="btn small danger" data-action="stop" type="button">Stop</button></div>`;
  el.style.animationDelay=document.querySelectorAll('.card').length*60+'ms';
  $('cards').append(el);
 }
 el.dataset.state=c.state;
 el.querySelector('.beacon').dataset.state=c.state;
 el.querySelector('.h').textContent=c.label??LABEL[c.name]??c.name;
 el.querySelector('.card-state').textContent=STATE_WORD[c.state]??c.state;
 const rows=[['Address',c.endpoint],['PID',c.pid],['Up',c.state==='running'&&c.startedAt?span(serverNow()-c.startedAt):null],['Restarts',c.restarts||null]].filter(r=>r[1]!=null&&r[1]!=='');
 el.querySelector('dl').replaceChildren(...rows.flatMap(([k,v])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;return [dt,dd];}));
 const msg=el.querySelector('.msg');msg.hidden=!c.message;msg.textContent=c.message??'';
 el.querySelector('[data-action=start]').disabled=c.state==='running'||c.state==='starting'||c.state==='stopping';
 el.querySelector('[data-action=stop]').disabled=c.state==='stopped';
 el.querySelector('[data-action=restart]').disabled=c.state!=='running';
}
function renderCards(){for(const c of status.components)if(c.name!=='server')cardFor(c);if(!status.components.some(c=>c.name!=='server'))$('cards').innerHTML=status.components.length?'<p class="muted">Only the game server is configured.</p>':'<p class="muted">No parts set up yet. <a class="inline-link" href="#setup">Open Setup</a> to prepare this server step by step.</p>';}
function renderEvents(){
 const host=logs.filter(l=>l.source==='host'||l.stream==='host').slice(-12).reverse();
 const list=$('event-list');
 if(!host.length){list.innerHTML='<li class="empty">Nothing yet. Starts, stops, crashes and hangs show up here.</li>';return;}
 list.replaceChildren(...host.map(l=>{const li=document.createElement('li');li.dataset.level=l.level;const t=document.createElement('time');t.textContent=clock(l.at);const s=document.createElement('span');s.textContent=(l.source!=='host'?LABEL[l.source]+': ':'')+l.text.replace(new RegExp('^'+l.source+' '),'');li.append(t,s);return li;}));
}

// ---------- Vital signs ----------
const VERDICT={idle:'Server stopped',grace:'Start-up grace',ok:'Alive',suspect:'Going quiet',hung:'Hung: restarting'};
function renderVerdict(){
 const w=status?.watchdog,s=comp('server');
 const state=!w||!w.enabled?'idle':(s?.state==='running'||s?.state==='starting')?(w.state??'idle'):'idle';
 const v=$('verdict');v.dataset.state=state;
 v.textContent=w&&!w.enabled?'Watchdog off':state==='grace'?`Start-up grace · ${Math.ceil(w.graceLeft??0)}s`:VERDICT[state]??state;
 for(const k of ['log','udp','cpu']){
  const el=$('age-'+k),age=state==='idle'?null:w?.ages?.[k];
  // The UDP probe runs only when the log and CPU are quiet (it shows in the server's log), so its age is not a warning.
  const onDemand=k==='udp'&&w?.udpIdle&&state!=='idle';
  el.textContent=onDemand?'not needed':k==='cpu'&&w?.cpuKnown===false&&state!=='idle'?'n/a':ageText(age);
  el.dataset.level=onDemand||age==null?'':age>=w.hangSeconds?'bad':age>=w.hangSeconds/2?'warn':'';
 }
 $('vitals-note').textContent=w?.enabled===false?'The watchdog is off in host.json.':`The watchdog restarts the server when all three are quiet for ${w?.hangSeconds??90} s at once, and puts the last good save back first.${w?.hangs?.length?` Hangs caught: ${w.hangs.length}.`:''}`;
}
function onWatchdog(w){
 const prev=status.watchdog;status.watchdog=w;
 const t=serverNow();
 if(w.probe?.ok&&w.probe.at!==prev?.probe?.at)ticks.udp.push(w.probe.at);
 if(w.ages&&w.ages.cpu<1.5&&w.state!=='idle')ticks.cpu.push(t-w.ages.cpu*1000);
 renderVerdict();
}
let stripRaf=0,lastStatic=0;
function drawStrip(){
 const c=$('strip');if(!c||c.closest('.view').hidden)return;
 const dpr=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;
 if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
 const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
 const css=getComputedStyle(document.documentElement),col=n=>css.getPropertyValue(n).trim();
 const wd=status?.watchdog,s=comp('server'),live=s&&(s.state==='running'||s.state==='starting')&&wd?.enabled!==false;
 const hang=(wd?.hangSeconds??90)*1000,windowMs=Math.max(120000,hang*1.6),now=serverNow(),x=t=>w-(now-t)/windowMs*w,lane=h/3;
 // Time grid every 30 s.
 g.strokeStyle=col('--line');g.lineWidth=1;
 for(let t=0;t<windowMs;t+=30000){const gx=Math.round(w-t/windowMs*w)+.5;g.beginPath();g.moveTo(gx,0);g.lineTo(gx,h);g.stroke();}
 for(let i=1;i<3;i++){g.beginPath();g.moveTo(0,i*lane+.5);g.lineTo(w,i*lane+.5);g.stroke();}
 // Hang line: a gap that reaches it on all three lanes is a hang.
 const hx=Math.round(w-hang/windowMs*w)+.5;
 g.setLineDash([3,4]);g.strokeStyle=col('--red');g.globalAlpha=.6;g.beginPath();g.moveTo(hx,0);g.lineTo(hx,h);g.stroke();g.setLineDash([]);g.globalAlpha=1;
 g.font='700 10px '+col('--mono');g.fillStyle=col('--red-text');g.textAlign='right';g.fillText(`HANG ${hang/1000}s`,hx-6,12);
 ['log','udp','cpu'].forEach((k,i)=>{
  const y0=i*lane,arr=ticks[k];while(arr.length&&arr[0]<now-windowMs-60000)arr.shift();
  if(!live){g.fillStyle=col('--w4');g.globalAlpha=.25;for(const t of arr){const tx=x(t);if(tx>=0)g.fillRect(Math.round(tx),y0+lane*.3,2,lane*.4);}g.globalAlpha=1;return;}
  // The silent gap since the last tick grows from the right edge toward the hang line.
  const last=Math.max(arr.length?arr[arr.length-1]:0,s.startedAt??0),age=now-last,ratio=age/hang;
  const onDemand=k==='udp'&&wd?.udpIdle; // probed only when log and CPU are quiet: its gap is no warning
  const gapCol=onDemand?col('--w4'):ratio>=1?col('--red'):ratio>=.5?col('--amber'):col('--w4');
  g.fillStyle=gapCol;g.globalAlpha=!onDemand&&ratio>=.5?.22:.08;g.fillRect(Math.max(0,x(last)),y0+6,w-Math.max(0,x(last)),lane-12);g.globalAlpha=1;
  g.fillStyle=k==='log'?col('--or'):k==='udp'?col('--teal'):col('--w2');
  for(const t of arr){const tx=x(t);if(tx<-2)continue;g.globalAlpha=Math.max(.35,1-(now-t)/windowMs);g.fillRect(Math.round(tx),y0+lane*.22,2,lane*.56);}
  g.globalAlpha=1;
 });
}
function loop(t){
 // Reduced motion: no drift; the strip jumps once a second instead.
 if(!reduced.matches||t-lastStatic>1000){lastStatic=t;drawStrip();}
 stripRaf=requestAnimationFrame(loop);
}

// ---------- Logs ----------
const filters={sources:new Set(['server','gateway','central','sidecar','host']),level:'all',q:''};
let follow=true,pendingNew=0;
function renderChips(){
 const names=['server','central','sidecar','gateway','host'].filter(n=>n==='host'||status?.components.some(c=>c.name===n));
 $('chips').replaceChildren(...names.map(n=>{const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.src=n;b.setAttribute('aria-pressed',String(filters.sources.has(n)));b.innerHTML='<i></i>';b.append(LABEL[n]);b.addEventListener('click',()=>{filters.sources.has(n)?filters.sources.delete(n):filters.sources.add(n);b.setAttribute('aria-pressed',String(filters.sources.has(n)));renderLogs(true);});return b;}));
}
const match=l=>filters.sources.has(l.source)&&(filters.level==='all'||(filters.level==='warn'?l.level!=='info':l.level==='error'))&&(!filters.q||l.text.toLowerCase().includes(filters.q));
function lineEl(l,fresh){
 const d=document.createElement('div');d.className='ln'+(fresh&&!reduced.matches?' new':'');d.dataset.level=l.level;d.dataset.stream=l.stream;d.dataset.src=l.source;
 const t=document.createElement('time');t.textContent=clock(l.at);
 const s=document.createElement('span');s.className='src';s.textContent=LABEL[l.source]??l.source;
 const x=document.createElement('span');x.className='txt';
 if(filters.q){const i=l.text.toLowerCase().indexOf(filters.q);x.append(l.text.slice(0,i));const m=document.createElement('mark');m.textContent=l.text.slice(i,i+filters.q.length);x.append(m,l.text.slice(i+filters.q.length));}
 else x.textContent=l.text;
 d.append(t,s,x);return d;
}
function renderLogs(all){
 const box=$('log');if(box.closest('.view').hidden)return;
 if(all){
  const shown=logs.filter(match).slice(-SHOWN);
  if(!shown.length){box.innerHTML='<p class="empty-log">No lines match. Turn on more sources or clear the search.</p>';return;}
  box.replaceChildren(...shown.map(l=>lineEl(l,false)));
  if(follow)box.scrollTop=box.scrollHeight;
 }
}
function appendLogs(batch){
 const box=$('log');if(box.closest('.view').hidden)return;
 const rows=batch.filter(match);if(!rows.length)return;
 box.querySelector('.empty-log')?.remove();
 const f=document.createDocumentFragment();for(const l of rows)f.append(lineEl(l,rows.length<40));box.append(f);
 while(box.childElementCount>SHOWN)box.firstElementChild.remove();
 if(follow)box.scrollTop=box.scrollHeight;else{pendingNew+=rows.length;$('jump').hidden=false;$('jump').textContent=`Show newest (${pendingNew})`;}
}
function setFollow(on){follow=on;$('follow').setAttribute('aria-pressed',String(on));$('follow').textContent=on?'Following':'Paused';if(on){pendingNew=0;$('jump').hidden=true;$('log').scrollTop=$('log').scrollHeight;}}
$('follow').addEventListener('click',()=>setFollow(!follow));
$('jump').addEventListener('click',()=>setFollow(true));
$('log').addEventListener('scroll',()=>{const b=$('log'),atEnd=b.scrollHeight-b.scrollTop-b.clientHeight<24;if(atEnd!==follow&&(atEnd||document.activeElement===b||b.matches(':hover')))setFollow(atEnd);},{passive:true});
$('level').addEventListener('change',e=>{filters.level=e.target.value;renderLogs(true);});
let searchTimer;$('search').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{filters.q=e.target.value.trim().toLowerCase();renderLogs(true);},150);});
document.querySelector('[data-source=host]').addEventListener('click',()=>{filters.sources=new Set(['host']);renderChips();});
function renderErrorCount(){const c=$('nav-errors');c.hidden=!errorsUnseen;c.textContent=errorsUnseen>99?'99+':errorsUnseen;}

// ---------- Live stream ----------
let pendingLogs=[],logFlush=0;
function onLog(l){
 if(logs.length&&l.seq<=logs[logs.length-1].seq)return;
 logs.push(l);emit('log',l);if(logs.length>MAX_LINES)logs.splice(0,logs.length-MAX_LINES);
 if(l.source==='server'&&l.stream==='file')ticks.log.push(l.at);
 if(l.level==='error'&&$('log').closest('.view').hidden){errorsUnseen++;renderErrorCount();}
 pendingLogs.push(l);if(pendingLogs.length>SHOWN)pendingLogs.splice(0,pendingLogs.length-SHOWN);
 // A timer, not requestAnimationFrame: a background tab still drains its lines (browsers slow it to about 1 s).
 logFlush||=setTimeout(()=>{logFlush=0;const b=pendingLogs;pendingLogs=[];appendLogs(b);if(b.some(x=>x.source==='host'||x.stream==='host'))renderEvents();},50);
}
function setLink(state,text){for(const el of document.querySelectorAll('[data-link-state]')){el.querySelector('.beacon').dataset.state=state;el.lastElementChild.textContent=text;}}
function connect(){
 es?.close();
 es=new EventSource('/api/events');
 es.addEventListener('open',()=>setLink('running','Live'));
 es.addEventListener('error',async()=>{
  setLink('starting','Reconnecting');
  const s=await fetch('/api/session').then(r=>r.json()).catch(()=>null);
  if(s&&!s.signedIn)showSignIn('Your session ended. Sign in again.');
 });
 es.addEventListener('status',e=>{status=JSON.parse(e.data);skew=status.now-Date.now();renderAll();emit('status',status);});
 es.addEventListener('log',e=>onLog(JSON.parse(e.data)));
 es.addEventListener('state',e=>{
  const c=JSON.parse(e.data),i=status.components.findIndex(x=>x.name===c.name);
  if(i>=0)status.components[i]={...status.components[i],...c};
  if(c.name==='server'){renderServer();renderVerdict();}else cardFor(status.components[i]);
  renderBar();emit('state',i>=0?status.components[i]:c);
 });
 es.addEventListener('watchdog',e=>{onWatchdog(JSON.parse(e.data));renderBar();});
 es.addEventListener('saves',e=>{status.saves=JSON.parse(e.data);renderStats();});
 es.addEventListener('players',e=>{status.players=JSON.parse(e.data);renderStats();renderBar();});
 es.addEventListener('setup',e=>pages.setup.onEvent(JSON.parse(e.data)));
}
function renderAll(){renderServer();renderStats();renderVerdict();renderCards();renderChips();renderEvents();renderLogs(true);renderBar();}

// Data pages load when shown and refresh while visible.
// go(view, arg): open a page with something selected (Players → a player's evidence under Anti-cheat).
let pendingArg=null;
const go=(view,arg)=>{pendingArg=arg??null;if(location.hash==='#'+view)route();else location.hash=view;};
const admin=createAdminPages({api,toast,span,clock,serverNow,go});
const pages={accounts:createAccountsPage({api,toast,span,clock,status:()=>status,serverNow}),players:admin.players,anticheat:admin.anticheat,backups:createBackupsPage({api,toast,span,clock,serverNow}),updates:createUpdatesPage({api,toast,span,serverNow}),schedule:createSchedulePage({api,toast,span,serverNow}),
 health:createHealthPage({api,toast,span}),settings:createSettingsPage({api,toast,span,clock,serverNow}),plugins:createPluginsPage({api,toast,span,serverNow}),setup:createSetupPage({api,toast,span,clock,serverNow}),overview:createHealthCard({api,toast,span,serverNow})};

let started=false,appStarted=false;
function start(){
 if(appStarted)return;appStarted=true;
 $('signin').hidden=true;$('app').hidden=false;
 route();connect();terminal.activate();
 if(!started){
  started=true;stripRaf=requestAnimationFrame(loop);
  setInterval(()=>{if(status){renderStats();renderBar();for(const c of status.components)if(c.name!=='server'&&c.state==='running')cardFor(c);}},1000);
  // The website link's state is only in /api/status; refresh it now and then for the status bar.
  setInterval(async()=>{if(!appStarted||document.hidden)return;const s=await api('/api/status').catch(()=>null);if(s&&status){status.remote=s.remote;renderBar();}},15000);
 }
}

// ---------- App frame: status bar, terminal panel, shortcuts, tray ----------
const REMOTE={connected:['running','Connected'],'no-key':['stopped','No host app key'],'no-website':['stopped','Not set up'],unreachable:['failed','Unreachable'],'key-refused':['failed','Key refused'],starting:['starting','Connecting']};
let lastTray='';
function renderBar(){
 if(!status)return;
 const s=comp('server'),cs=status.components;
 const st=s?.state??(!cs.length?'stopped':cs.every(c=>c.state==='running')?'running':cs.some(c=>c.state==='failed')?'failed':cs.some(c=>['starting','stopping','backoff'].includes(c.state))?'starting':'stopped');
 $('sb-name').textContent=s?'Game server':'Parts';
 $('sb-beacon').dataset.state=st;$('sb-state').textContent=s||cs.length?STATE_WORD[st]??st:'Not set up';
 $('sb-players').textContent=status.players?String(status.players.inGame):'–';
 $('sb-up').textContent=s&&(s.state==='running'||s.state==='starting')&&s.startedAt?span(serverNow()-s.startedAt):'–';
 const [rs,rt]=REMOTE[status.remote?.state]??['stopped','–'];$('sb-web-beacon').dataset.state=rs;$('sb-web').textContent=rt;
 // The tray icon follows the game server (or the parts when there is none); a hang or a crash gets a notice there.
 if(bridge){
  const tray=status.watchdog?.state==='hung'?'frozen':st==='backoff'?'crashed':st==='stopping'?'starting':st;
  const text=`${s?'Game server':'Rust Legacy Host'}: ${tray==='frozen'?'frozen, restarting':tray==='crashed'?'crashed, restarting':(STATE_WORD[st]??st).toLowerCase()}${status.players?` · ${status.players.inGame} in game`:''}`;
  if(tray+text!==lastTray){lastTray=tray+text;bridge.trayState(tray,text);}
 }
}
const terminal=createTerminalPanel({bridge,root:$('term'),toggleButton:$('term-toggle'),reduced,
 host:{api,act:(a,t)=>act(a,t),status:()=>status,logs:()=>logs,subscribe,serverNow}});
$('term-toggle').addEventListener('click',()=>terminal.toggle());
const pageKeys=()=>[...document.querySelectorAll('.rail a[data-view]')].slice(0,9);
pageKeys().forEach((a,i)=>{a.setAttribute('aria-keyshortcuts',`Control+${i+1}`);a.title=`Ctrl+${i+1}`;});
addEventListener('keydown',e=>{
 if(document.documentElement.dataset.booting||$('app').hidden)return;
 if(e.ctrlKey&&!e.altKey&&!e.metaKey&&e.code==='Backquote'){e.preventDefault();e.stopPropagation();terminal.toggle();return;}
 const n=/^Digit([1-9])$/.exec(e.code);
 if(n&&e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey){const a=pageKeys()[n[1]-1];if(a){e.preventDefault();e.stopPropagation();location.hash=a.dataset.view;}}
},true);
// Tray menu: Start, Stop and Restart act on the game server (on every part when there is none), like the buttons.
bridge?.on('tray.action',m=>{if(['start','stop','restart'].includes(m.action)&&appStarted)act(m.action,comp('server')?'server':'all');});

// Boot screen, then the dashboard (boot.mjs). In the desktop app it signs in with the owner token the app reads.
async function boot({signedIn=false,via}={}){
 const b=createBoot({bridge,api,reduced,status:()=>status,subscribe,signIn,start,port:location.port||'80',healthRun:()=>pages.overview.run()});
 const r=await b.run({signedIn,via});
 terminal.intro(r.transcript);
 if(!r.signedIn){
  if(bridge)$('signin-help').textContent=`This app could not sign in by itself${r.tokenError?` (${r.tokenError})`:''}. Paste the owner token from owner.token in the host's data folder, or run the installer again so your Windows account can read it.`;
  return showSignIn();
 }
 route(); // the Overview's health card shows the boot's result (or runs now if the boot was skipped)
 if(r.counts.fail&&!r.skipped)toast(`Start-up found ${r.counts.fail} problem${r.counts.fail>1?'s':''}. The start-up log is in the terminal's Host tab.`,'error');
}

// The sign-in link carries the token in the fragment, which never reaches the server's logs; it is removed at once.
(async()=>{
 const m=/(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(location.hash);
 if(m){history.replaceState(null,'',location.pathname+'#overview');if(await signIn(m[1]))return boot({signedIn:true,via:'link'});return;}
 const s=await fetch('/api/session').then(r=>r.json()).catch(()=>({signedIn:false}));
 // The app boots each time it opens; a browser tab that is already signed in opens the dashboard straight away.
 if(bridge)return boot({signedIn:s.signedIn});
 s.signedIn?start():showSignIn();
})();
