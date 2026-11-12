// Launcher window controller: renders launcher/core.mjs state into the three steps of index.html (Account → Server →
// Game) and wires the buttons. The host (hosts.mjs) is the WebView2 bridge in the Windows app, or a simulation with
// ?demo in a plain browser. No state lives here beyond the selected server row and the toast timer.
import {createLauncher,reasonText} from '../core.mjs';
import {webviewHost,demoHost} from './hosts.mjs';

const $=id=>document.getElementById(id);
const win=document.querySelector('.window');
const steps={account:$('step-account'),server:$('step-server'),game:$('step-game')};
// Seam fill per step reached (node positions down the seam), and which step each phase opens.
const FILL={account:0,server:.45,game:.86,done:1};
const STEP_OF={'starting':null,'signed-out':'account','signing-in':'account','signing-up':'account','device':'account','signing-out':'account',
 'signed-in':'server','connecting':'server','connected':'game','launching':'game','in-game':'game'};
const BUSY=new Set(['signing-in','signing-up','signing-out','connecting','launching']);
// Which field a refusal belongs to, so it can be marked and focused (the toast says why).
export function fieldForCode(code,mode){
 if(/email/.test(code))return mode==='register'?'email':'login';
 if(/username/.test(code))return mode==='register'?'username':'login';
 if(/password|credentials/.test(code))return 'password';
 return null;
}

export function stepStates(phase){
 const current=STEP_OF[phase],order=['account','server','game'],at=current?order.indexOf(current):-1;
 const out={};
 for(const [i,name] of order.entries())
  out[name]=at<0?'idle':i<at?'done':i>at?'idle':(BUSY.has(phase)?'busy':phase==='in-game'?'done':'active');
 return out;
}
export const seamFill=phase=>phase==='in-game'?FILL.done:FILL[STEP_OF[phase]]??0;

export function serverRow(s,selectedId,i){
 const li=document.createElement('li');
 li.className='server';li.setAttribute('role','option');li.style.setProperty('--i',i);
 li.dataset.id=s.id;li.tabIndex=s.online?0:-1;
 li.setAttribute('aria-selected',String(s.id===selectedId));
 if(!s.online)li.setAttribute('aria-disabled','true');
 const name=document.createElement('b');name.textContent=s.name;
 const meta=document.createElement('span');meta.className='meta';meta.textContent=[s.region,s.wipe?'wiped '+s.wipe:null].filter(Boolean).join(' · ');
 const pop=document.createElement('span');pop.className='pop';
 pop.append(document.createElement('i'),s.online?`${s.players??0}/${s.capacity}`:'offline');
 li.append(name,pop,meta);
 return li;
}

async function main(){
 const demo=new URLSearchParams(location.search).has('demo')||!window.chrome?.webview;
 const host=demo?demoHost():webviewHost();
 if(demo)document.documentElement.dataset.demo='';
 const settings=await host.settings();
 const launcher=createLauncher({centralUrl:settings.centralUrl,host,fetchImpl:host.fetch});
 let selected=null,toastTimer=null,lastError=null,lastBeat=null,lastStep=null,mode='signin';
 // "Remember my email or username": the name kept by the host from last time (never a password).
 if(settings.login){$('login').value=settings.login;}
 // The website's own pages; the host opens them in the player's browser.
 for(const [id,path] of [['terms','terms'],['privacy','privacy']]){const a=$(id);a.href=new URL(path,settings.centralUrl).href;a.addEventListener('click',e=>{e.preventDefault();host.openUrl(a.href);});}

 function toast(text,kind='info',ms=kind==='error'?7000:3500){
  const t=$('toast');clearTimeout(toastTimer);
  t.textContent=text;t.dataset.kind=kind;t.toggleAttribute('data-show',!!text);
  if(text)toastTimer=setTimeout(()=>t.removeAttribute('data-show'),ms);
 }
 const pulse=(attr,ms)=>{win.removeAttribute(attr);void win.offsetWidth;win.setAttribute(attr,'');setTimeout(()=>win.removeAttribute(attr),ms);};
 const busy=(id,on)=>$(id).toggleAttribute('data-busy',on);

 function render(s){
  win.dataset.phase=s.phase;
  const st=stepStates(s.phase);
  for(const [name,el] of Object.entries(steps)){el.dataset.state=st[name];el.toggleAttribute('data-open',STEP_OF[s.phase]===name);}
  win.style.setProperty('--fill',seamFill(s.phase));
  const step=STEP_OF[s.phase];
  if(lastStep&&step&&step!==lastStep&&st[lastStep]==='done')pulse('data-spark',1200);
  lastStep=step;

  // Account
  const signing=s.phase==='signing-in'||s.phase==='signing-up';
  $('signin').hidden=$('mode-signin').parentElement.hidden=s.phase==='device';$('device').hidden=s.phase!=='device';
  busy('signin-button',signing);$('signin-button').disabled=signing;
  for(const b of [$('mode-signin'),$('mode-register')])b.disabled=signing;
  $('account-summary').textContent=s.account?s.account.name:'';
  $('signout').hidden=!s.account||s.phase==='in-game'||s.phase==='launching';
  if(s.device){$('device-code').textContent=s.device.userCode;$('device-url').textContent=s.device.url;}

  // Server
  const list=$('servers');
  if(s.phase==='signed-in'||s.phase==='connecting'){
   if(selected&&!s.servers.some(x=>x.id===selected&&x.online))selected=null;
   list.replaceChildren(...(s.servers.length?s.servers.map((x,i)=>serverRow(x,selected,i)):[Object.assign(document.createElement('li'),{className:'empty',textContent:'No servers are listed yet.'})]));
  }
  busy('connect',s.phase==='connecting');
  $('connect').disabled=s.phase!=='signed-in'||!selected;
  const c=s.connection;
  $('server-summary').replaceChildren(...(c?[c.server.name,Object.assign(document.createElement('small'),{textContent:c.native?`${c.native.host}:${c.native.port}`:''})]:[]));
  $('disconnect').hidden=!c||s.phase==='in-game'||s.phase==='launching';

  // Game
  busy('launch',s.phase==='launching');$('launch').disabled=s.phase!=='connected';
  $('launch').hidden=$('launch-hint').hidden=s.phase==='in-game';
  $('ingame').hidden=s.phase!=='in-game';
  $('game-summary').textContent=s.phase==='in-game'?'Playing':'';
  if(c){
   const addr=c.native?`${c.native.host}:${c.native.port}`:'';
   $('ingame-text').textContent=`You are signed in as ${c.name??s.account?.name}. Keep this window open in the tray while you play.`;
   $('ro-server').textContent=c.server.name;$('ro-address').textContent=addr;$('ro-connect').textContent='net.connect '+addr;
  }
  win.toggleAttribute('data-live',!!c);
  if(s.lastBeat&&s.lastBeat!==lastBeat){lastBeat=s.lastBeat;pulse('data-beat',1300);if(s.phase==='in-game')pulse('data-spark',1200);}

  // Core clears error at the start of every action, so a repeated refusal shows again.
  // A new attempt clears the last refusal's toast, so it never sits under a success.
  if(!s.error&&lastError&&$('toast').dataset.kind==='error')toast('');
  if(s.error&&s.error!==lastError){toast(reasonText(s.error),'error');const f=fieldForCode(s.error,mode);if(f&&STEP_OF[s.phase]==='account')$(f).setAttribute('aria-invalid','true');}
  lastError=s.error;
  reported={phase:s.phase,server:c?.server.name??null,name:s.account?.name??null};fit();
 }
 // The window fits its content (MainForm.OnState height): no dead space under a short step such as the in-game
 // read-out. The toast's row is counted in, so a message never resizes the window. Measured after layout, and again
 // whenever the steps change size (their bodies animate open and shut).
 let reported={},fitFrame=0;
 const fit=()=>{cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(()=>{
  const steps=document.querySelector('.steps');host.report({...reported,height:Math.ceil(steps.offsetTop+steps.offsetHeight+$('toast').offsetHeight)});
 });};
 new ResizeObserver(fit).observe(document.querySelector('.steps'));
 launcher.on(render);

 // Next check-in countdown.
 setInterval(()=>{const s=launcher.state,c=s.connection;if(!c||!s.lastBeat)return;
  $('ro-beat').textContent=Math.max(0,Math.ceil((s.lastBeat+c.heartbeatSeconds*1000-Date.now())/1000))+' s';},500);

 // Sign in / Create account: one form, the fields of the other mode hidden (and so out of the tab order).
 function setMode(next,focus=true){
  mode=next;$('signin').dataset.mode=mode;
  for(const el of $('signin').querySelectorAll('[data-for]'))el.hidden=el.dataset.for!==mode;
  $('mode-signin').setAttribute('aria-pressed',String(mode==='signin'));$('mode-register').setAttribute('aria-pressed',String(mode==='register'));
  $('signin-label').textContent=mode==='register'?'Create account':'Sign in';
  $('password').autocomplete=mode==='register'?'new-password':'current-password';
  for(const i of $('signin').querySelectorAll('[aria-invalid]'))i.removeAttribute('aria-invalid');
  if(focus)$(mode==='register'?'email':$('login').value?'password':'login').focus();
 }
 $('mode-signin').addEventListener('click',()=>setMode('signin'));
 $('mode-register').addEventListener('click',()=>setMode('register'));
 $('signin').addEventListener('input',e=>e.target.removeAttribute('aria-invalid'));
 $('signin').addEventListener('submit',async e=>{
  e.preventDefault();
  for(const i of $('signin').querySelectorAll('[aria-invalid]'))i.removeAttribute('aria-invalid');
  const remember=$('remember').checked,rememberLogin=$('remember-login').checked,password=$('password').value;
  const ok=mode==='register'
   ?await launcher.register({email:$('email').value,username:$('username').value,password,remember,rememberLogin})
   :await launcher.signIn({login:$('login').value,password,remember,rememberLogin});
  if(ok){
   $('password').value='';
   if(mode==='register'){toast(`Account created. Welcome, ${launcher.state.account.name}.`);$('login').value=rememberLogin?$('username').value.trim():'';$('email').value=$('username').value='';setMode('signin',false);}
   else toast('Signed in.');
   if(!rememberLogin)$('login').value='';
  }
  else{const f=$('signin');f.removeAttribute('data-shake');void f.offsetWidth;f.setAttribute('data-shake','');
   const bad=f.querySelector('[aria-invalid=true]')??$('password');bad.focus();bad.select?.();}
 });
 $('device-start').addEventListener('click',()=>launcher.startDevice({remember:$('remember').checked}));
 $('device-open').addEventListener('click',()=>launcher.state.device&&host.openUrl(launcher.state.device.url));
 $('device-cancel').addEventListener('click',()=>launcher.cancelDevice());
 $('signout').addEventListener('click',async()=>{await launcher.signOut();toast('Signed out.');});

 const pick=li=>{if(!li||li.getAttribute('aria-disabled')==='true')return;selected=li.dataset.id;render(launcher.state);$('servers').querySelector(`[data-id="${CSS.escape(selected)}"]`)?.focus();};
 $('servers').addEventListener('click',e=>pick(e.target.closest('.server')));
 $('servers').addEventListener('dblclick',e=>{pick(e.target.closest('.server'));if(!$('connect').disabled)$('connect').click();});
 $('servers').addEventListener('keydown',e=>{
  const rows=[...$('servers').querySelectorAll('.server:not([aria-disabled=true])')],at=rows.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();pick(rows[(at+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length]);}
  else if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(e.target.closest('.server'));if(e.key==='Enter'&&!$('connect').disabled)$('connect').click();}
 });
 $('connect').addEventListener('click',async()=>{if(selected&&await launcher.connect(selected))toast('Connected. You can launch the game.');});
 $('disconnect').addEventListener('click',()=>launcher.disconnect());
 $('launch').addEventListener('click',async()=>{
  toast(''); // "Connected…" is old news once the game starts
  if(await launcher.launch())return;
  // First launch: no folder chosen yet. Ask once, then try again.
  if(launcher.state.error==='game-not-found'&&await host.chooseGameFolder())await launcher.launch();
 });

 // Host events: the proxy's ticket request inside the game's connect, and the game process ending.
 host.on('ticketRequest',async m=>host.answerTicket(m.requestId,await launcher.requestTicket()));
 host.on('gameExited',()=>launcher.gameExited());
 host.on('signOut',()=>launcher.signOut());

 render(launcher.state);
 if(demo)window.launcherDemo={launcher,host};
 await launcher.restore();
 if(launcher.state.phase==='signed-out')$(settings.login?'password':'login').focus();
}

if(typeof document!=='undefined'&&document.querySelector('.window'))main().catch(e=>{console.error(e);document.body.dataset.failed='';});
