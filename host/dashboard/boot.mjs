// The boot screen (HOST-AND-LOADER-BUILD.md A1): a full-window terminal that walks through the real start-up before the
// dashboard opens. Every line is a real check or a real state: the service answering, signing in (in the desktop app
// with the owner token the app reads, so the owner never pastes a link), the live event stream, host.json's parts,
// each part's state as /api/status and the SSE 'state' events report it (website → sidecar → game server → gateway),
// the watchdog, and the health check's rows with their fixes. Nothing is faked and nothing blocks: a step that stalls
// is shown as stalled and the dashboard opens anyway. Skip (button or Esc) opens it at once.
// Shown each time the desktop app opens, and in a plain browser right after signing in (not on every reload).
// Reduced motion: lines appear whole, no spinners, no scanlines, no exit animation.
import {C,TAG,LABEL} from './host-commands.mjs';
const ORDER=['central','sidecar','server','gateway'];
const SPIN=['[=   ]','[==  ]','[ == ]','[  ==]','[   =]','[  ==]','[ == ]','[==  ]']; // the classic boot-log bar, in ASCII so every font has it
const TAGS={ok:'[ OK ]',warn:'[WARN]',fail:'[FAIL]',skip:'[ -- ]',wait:'[ .. ]'};
const STATE_WORD={stopped:'stopped',starting:'starting',running:'running',stopping:'stopping',backoff:'restarting after a crash',failed:'failed'};
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// "RUST LEGACY HOST" in a block face (the site's heavy wide capitals, as text).
const GLYPHS={
 R:['██████╗ ','██╔══██╗','██████╔╝','██╔══██╗','██║  ██║','╚═╝  ╚═╝'],U:['██╗   ██╗','██║   ██║','██║   ██║','██║   ██║','╚██████╔╝',' ╚═════╝ '],
 S:['███████╗','██╔════╝','███████╗','╚════██║','███████║','╚══════╝'],T:['████████╗','╚══██╔══╝','   ██║   ','   ██║   ','   ██║   ','   ╚═╝   '],
 L:['██╗     ','██║     ','██║     ','██║     ','███████╗','╚══════╝'],E:['███████╗','██╔════╝','█████╗  ','██╔══╝  ','███████╗','╚══════╝'],
 G:[' ██████╗ ','██╔════╝ ','██║  ███╗','██║   ██║','╚██████╔╝',' ╚═════╝ '],A:[' █████╗ ','██╔══██╗','███████║','██╔══██║','██║  ██║','╚═╝  ╚═╝'],
 C:[' ██████╗','██╔════╝','██║     ','██║     ','╚██████╗',' ╚═════╝'],Y:['██╗   ██╗','╚██╗ ██╔╝',' ╚████╔╝ ','  ╚██╔╝  ','   ██║   ','   ╚═╝   '],
 H:['██╗  ██╗','██║  ██║','███████║','██╔══██║','██║  ██║','╚═╝  ╚═╝'],O:[' ██████╗ ','██╔═══██╗','██║   ██║','██║   ██║','╚██████╔╝',' ╚═════╝ '],' ':['  ','  ','  ','  ','  ','  '],
};
export function logoRows(text='RUST LEGACY HOST'){return GLYPHS.R.map((_,i)=>[...text].map(ch=>GLYPHS[ch][i]).join(''));}
// Drawn as SVG cells (crisp at any size, no font seams): the solid blocks in off-white over an orange copy set down
// and right, the site's heavy capitals with their accent. Each row wipes in from the left.
const SVG='http://www.w3.org/2000/svg';
function logoSvg(){
 const rows=logoRows(),w=rows[0].length,H=1.6;
 const svg=document.createElementNS(SVG,'svg');svg.setAttribute('viewBox',`-0.5 -0.5 ${w+1.5} ${rows.length*H+1.5}`);svg.setAttribute('class','boot-logo');svg.setAttribute('aria-hidden','true');
 rows.forEach((r,y)=>{
  const g=document.createElementNS(SVG,'g');g.setAttribute('class','boot-logo-row');g.style.animationDelay=y*55+'ms';
  for(const [dx,dy,cls] of [[.55,.5,'shade'],[0,0,'ink']])for(const m of r.matchAll(/█+/g)){
   const rect=document.createElementNS(SVG,'rect');
   rect.setAttribute('x',m.index+dx);rect.setAttribute('y',y*H+dy);rect.setAttribute('width',m[0].length);rect.setAttribute('height',H+.12);rect.setAttribute('class',cls);g.append(rect);
  }
  svg.append(g);
 });
 return svg;
}

// deps: bridge (desktop-bridge.mjs or null), api (the dashboard's), reduced (matchMedia), status() (latest status from
// the SSE stream once start() has run), subscribe(kind, fn), signIn(token) → bool, start() (opens the dashboard and its
// stream underneath), healthRun() → the health check result (it also fills the Overview card), port.
export function createBoot(deps){
 const {bridge,api,reduced,status,subscribe,signIn,start,healthRun,port}=deps;
 const transcript=[],t0=performance.now();
 let skipped=false,skipNow,finished=false,typing=Promise.resolve();
 const skipP=new Promise(r=>{skipNow=r;});
 const race=(p,ms)=>Promise.race([p,skipP.then(()=>'skipped'),...(ms?[sleep(ms).then(()=>'timeout')]:[])]);
 const instant=()=>reduced.matches||skipped;

 const log=el('ol',{class:'boot-log',role:'log','aria-live':'polite','aria-label':'Start-up steps'});
 const bar=el('i'),pct=el('b',{text:'0%'}),now=el('span',{text:'starting'});
 const skip=el('button',{class:'boot-skip',type:'button',onclick:()=>doSkip()},'Skip ',el('kbd',{text:'Esc'}));
 const logo=logoSvg();
 const sub=el('p',{class:'boot-sub'});
 const root=el('div',{class:'boot',id:'boot',role:'dialog','aria-modal':'true','aria-labelledby':'boot-h'},
  el('div',{class:'boot-scan','aria-hidden':'true'}),
  el('header',{class:'boot-top'},el('p',{class:'boot-h',id:'boot-h'},el('i'),'Rust Legacy Host · start-up'),skip),
  el('div',{class:'boot-screen'},logo,sub,log),
  el('footer',{class:'boot-foot'},el('div',{class:'boot-bar',role:'progressbar','aria-label':'Start-up','aria-valuemin':'0','aria-valuemax':'100'},bar),el('p',{class:'boot-now'},pct,now)));
 const onKey=e=>{if(e.key==='Escape'){e.preventDefault();doSkip();}};

 // Progress: real steps done out of the steps known so far (the parts are counted once host.json is read).
 let total=7,done=0;
 const progress=(text)=>{const p=Math.min(100,Math.round(done/total*100));bar.style.transform=`scaleX(${p/100})`;pct.textContent=p+'%';root.querySelector('.boot-bar').setAttribute('aria-valuenow',String(p));if(text)now.textContent=text;};
 const step=text=>{done++;progress(text);};

 // A line: tag + text (typed), and an optional fix under it. Returns a handle to finish a waiting line.
 function line(tag,text,{fix,dim,summary}={}){
  const tg=el('span',{class:'bt','data-tag':tag,text:TAGS[tag]}),tx=el('span',{class:'bx'+(dim?' dim':'')}),li=el('li',{'data-tag':tag},tg,tx);
  const rec={tag,text,fix,summary};transcript.push(rec);
  const typed=typing=typing.then(async()=>{
   log.append(li);li.scrollIntoView({block:'end'});
   if(instant())tx.textContent=text;
   else{const n=Math.max(3,Math.ceil(text.length/10));for(let i=0;i<text.length&&!instant();i+=n){tx.textContent=text.slice(0,i)+'▌';await new Promise(r=>requestAnimationFrame(r));}}
   tx.textContent=rec.text;
   if(fix)addFix(li,fix);
  });
  return {
   typed,
   async set(newTag,newText,newFix){
    await typed;rec.tag=newTag;rec.text=newText??rec.text;if(newFix)rec.fix=newFix;
    tg.dataset.tag=newTag;li.dataset.tag=newTag;tg.textContent=TAGS[newTag];tx.textContent=rec.text;
    if(newFix)addFix(li,newFix);
    if(!instant()){li.classList.remove('flash');void li.offsetWidth;li.classList.add('flash');}
   },
   text(t){rec.text=t;typed.then(()=>{tx.textContent=t;});},
  };
 }
 const addFix=(li,fix)=>{li.append(el('p',{class:'bfix'},el('span',{text:'fix '}),fix));li.scrollIntoView({block:'end'});};
 const spin=setInterval(()=>{if(reduced.matches)return;const i=Math.floor(performance.now()/90);for(const t of root.querySelectorAll('.bt[data-tag=wait]'))t.textContent=SPIN[i%SPIN.length];},90);

 function doSkip(){if(finished||skipped)return;skipped=true;skipNow();}

 // ---------- The steps ----------
 async function steps(opts){
  let signedIn=opts.signedIn,tokenError=null,info=null;
  if(bridge){try{info=await race(bridge.info(),3000);}catch{info=null;}}
  sub.textContent=info&&typeof info==='object'?`${info.machine?info.machine+' · ':''}${info.user?'signed in to Windows as '+info.user+' · ':''}app ${info.version}`:`dashboard on 127.0.0.1:${port}`;

  // 1. The service.
  {
   const l=line('wait',`Connecting to the host service on 127.0.0.1:${port}`);
   const t=performance.now();let ok=false;
   for(let tries=0;!ok&&!skipped;tries++){
    const r=await race(fetch('/api/session',{cache:'no-store'}).then(r=>r.ok).catch(()=>false),5000);
    if(r===true){ok=true;break;}if(r==='skipped')break;
    if(tries===0)l.set('fail',`No answer from the host service on 127.0.0.1:${port}`,'Start it from Services (Rust Legacy Host → Start) or run Install-RustLegacyHost.ps1 -Apply. This app does not start it: that needs administrator rights.');
    if(tries>=10){line('warn','Still no answer after 20 s; opening the dashboard anyway. It reconnects by itself.');break;}
    await race(sleep(2000));
   }
   if(ok)await l.set('ok',`Host service answering on 127.0.0.1:${port} ${'('+Math.max(1,Math.round(performance.now()-t))+' ms)'}`);
   step('signing in');
  }
  if(skipped)return {signedIn,tokenError};

  // 2. Signing in.
  if(signedIn)await line('ok',opts.via==='link'?'Signed in with the sign-in link':opts.via==='form'?'Signed in with the owner token':'Signed in (this window\'s session)').typed;
  else if(bridge){
   const l=line('wait','Signing in with the owner token (owner.token)');
   try{
    const r=await race(bridge.token(),5000);
    if(r==='timeout'||r==='skipped')throw Object.assign(Error(r==='timeout'?'the app did not answer':'skipped'),{code:r});
    if(!(await signIn(r.token,{quiet:true})))throw Object.assign(Error('the service did not accept it (is this the same host?)'),{code:'wrong-token'});
    signedIn=true;await l.set('ok','Signed in with the owner token from owner.token');
   }catch(e){
    if(e.code==='skipped')return {signedIn,tokenError:null};
    tokenError=e.message;
    await l.set('fail',`Could not sign in by itself: ${e.message}`,e.code==='token-unreadable'?'Run Install-RustLegacyHost.ps1 -Apply again as the Windows account that uses this app (it lets that account read owner.token), or sign in with the owner token below.':'Sign in with the owner token below.');
   }
  }
  step('opening the live stream');
  if(!signedIn||skipped)return {signedIn,tokenError};

  // 3. The live stream (the dashboard's own, opened underneath) and host.json.
  start();
  {
   const l=line('wait','Opening the live event stream');
   const first=await race(new Promise(r=>{if(status())return r(true);const off=subscribe('status',()=>{off();r(true);});}),10000);
   if(first===true)await l.set('ok','Live event stream open (logs, states, watchdog)');
   else if(first==='timeout')await l.set('warn','The live stream has not opened after 10 s; the dashboard keeps trying.');
   step('reading the configuration');
  }
  if(skipped)return {signedIn,tokenError};
  let s=status()??await api('/api/status').catch(()=>null);
  const parts=(s?.components??[]).filter(c=>ORDER.includes(c.name)).sort((a,b)=>ORDER.indexOf(a.name)-ORDER.indexOf(b.name));
  total=5+parts.length+1;progress();
  if(!s)await line('warn','Could not read the host\'s status.').typed;
  else if(!parts.length)await line('warn','No parts in host.json yet',{fix:'Open Setup to prepare this server step by step.'}).typed;
  else await line('ok',`Configuration read: ${parts.length} part${parts.length>1?'s':''} (${parts.map(c=>(LABEL[c.name]??c.name).toLowerCase()).join(', ')})${s.watchdog?`, watchdog ${s.watchdog.enabled?'on':'off'}`:''}`).typed;
  step('checking each part');

  // 4. Each part in start order, following its state live while it changes; one shared 45 s budget.
  const deadline=performance.now()+45000;let stopped=0;
  for(const c0 of parts){
   if(skipped)break;
   const name=LABEL[c0.name]??c0.name,cur=()=>(status()?.components??[]).find(c=>c.name===c0.name)??c0;
   const desc=c=>[c.endpoint,c.pid?'PID '+c.pid:'',c.external?'started outside the app':''].filter(Boolean).join(' · ');
   const head=`${name.padEnd(12)} `;
   let c=cur(),l;
   const moving=x=>['starting','stopping','backoff'].includes(x.state)||(x.state==='stopped'&&x.restarting===true);
   if(moving(c)){
    l=line('wait',`${head}${STATE_WORD[c.state]}`);now.textContent=`${name.toLowerCase()} ${STATE_WORD[c.state]}`;
    const seen=[c.state];
    const r=await race(new Promise(res=>{
     const off=subscribe('state',x=>{if(x.name!==c0.name)return;if(seen.at(-1)!==x.state)seen.push(x.state);l.text(`${head}${seen.map(s=>STATE_WORD[s]??s).join(' → ')}`);if(!moving(x)){off();res(x);}});
    }),Math.max(1000,deadline-performance.now()));
    c=cur();
    if(r==='timeout'||r==='skipped'){await l.set('warn',`${head}still ${STATE_WORD[c.state]}`,'Follow it on the Overview; the dashboard opens anyway.');step();continue;}
   }
   const text=`${head}${STATE_WORD[c.state]??c.state}${desc(c)?'  ·  '+desc(c):''}`;
   if(c.state==='running'){if(l)await l.set('ok',text);else await line('ok',text).typed;}
   else if(c.state==='failed'){const fix=`${c.message?c.message+'. ':''}Its log is on the Logs page; type logs ${c0.name==='central'?'website':c0.name} in the terminal.`;if(l)await l.set('fail',text,fix);else await line('fail',text,{fix}).typed;}
   else{stopped++;if(l)await l.set('skip',text);else await line('skip',text,{dim:true}).typed;}
   step(`${name.toLowerCase()} ${c.state}`);
  }
  if(stopped&&!skipped)await line('skip',stopped===parts.length?'Everything is stopped. Start it on the Overview, or type start all in the terminal.':'Stopped parts start from the Overview or with start <part> in the terminal.',{dim:true}).typed;
  if(skipped)return {signedIn,tokenError};

  // 5. The watchdog.
  s=status()??s;const w=s?.watchdog,sv=(s?.components??[]).find(c=>c.name==='server');
  if(w){
   const live=sv&&(sv.state==='running'||sv.state==='starting');
   if(!w.enabled)await line('warn','Watchdog off in host.json: a frozen server would not be restarted.').typed;
   else if(!live)await line('skip',`Watchdog ready; it arms when the game server runs (hang after ${w.hangSeconds} s quiet)`,{dim:true}).typed;
   else if(w.state==='grace')await line('ok',`Watchdog armed · start-up grace, ${Math.ceil(w.graceLeft??0)} s left · hang after ${w.hangSeconds} s of no log, no UDP reply and no CPU`).typed;
   else if(w.state==='ok')await line('ok',`Watchdog armed · server alive on log lines, UDP replies and CPU · hang after ${w.hangSeconds} s`).typed;
   else if(w.state==='suspect')await line('warn','Watchdog: the server is going quiet',{fix:'Watch Vital signs on the Overview; it restarts the server with the last good save if all three stay quiet.'}).typed;
   else if(w.state==='hung')await line('fail','Watchdog: the server is hung and is being restarted').typed;
   else await line('ok',`Watchdog on (hang after ${w.hangSeconds} s quiet)`).typed;
  }
  step('running the health check');
  if(skipped)return {signedIn,tokenError};

  // 6. The health check, row by row with its fixes.
  {
   const l=line('wait','Running the health check',{summary:true});now.textContent='health check';
   const r=await race(healthRun(),30000);
   if(r==='timeout')await l.set('warn','The health check is still running after 30 s; its result will show on the Overview.');
   else if(r&&r!=='skipped'&&r.rows){
    const order={FAIL:0,WARN:1,PASS:2,SKIP:3},tag={PASS:'ok',WARN:'warn',FAIL:'fail',SKIP:'skip'};
    const sm=r.summary;
    await l.set(sm.fail?'fail':sm.warn?'warn':'ok',`Health check: ${sm.pass} pass, ${sm.warn} warn, ${sm.fail} fail`);
    for(const row of [...r.rows].sort((a,b)=>order[a.status]-order[b.status])){
     if(skipped)break;
     await line(tag[row.status]??'skip',`  ${row.label} · ${row.detail}`,{fix:row.status==='WARN'||row.status==='FAIL'?row.fix:null,dim:row.status==='SKIP'}).typed;
    }
   }else if(r!=='skipped')await l.set('warn','The health check could not run; try it from the Overview.');
   step('ready');
  }
  return {signedIn,tokenError};
 }

 return {
  root,
  async run(opts={}){
   document.body.append(root);document.documentElement.dataset.booting='true';
   addEventListener('keydown',onKey,true);
   requestAnimationFrame(()=>root.classList.add('on'));
   skip.focus({preventScroll:true});
   let r;
   try{r=await steps(opts);}catch(e){r={signedIn:false,tokenError:e.message};line('fail','Start-up stopped: '+e.message);}
   // Skipped before signing in: the app still signs in with its token, silently.
   if(skipped&&!r.signedIn&&bridge&&!r.tokenError){try{const t=await bridge.token();r.signedIn=await signIn(t.token,{quiet:true});}catch(e){r.tokenError=e.message;}}
   if(r.signedIn)start(); // once only (host.mjs); after a skip the dashboard may not have opened yet
   const counts={fail:transcript.filter(x=>x.tag==='fail'&&!x.summary).length,warn:transcript.filter(x=>x.tag==='warn'&&!x.summary).length};
   if(!skipped){
    done=total;progress('ready');
    const secs=((performance.now()-t0)/1000).toFixed(1);
    const end=line(counts.fail?'fail':counts.warn?'warn':'ok',`Ready in ${secs} s${counts.fail||counts.warn?` · ${counts.fail} problem${counts.fail===1?'':'s'}, ${counts.warn} warning${counts.warn===1?'':'s'}`:' · all clear'}${r.signedIn?' · opening the dashboard':''}`);
    await end.typed;root.dataset.result=counts.fail?'fail':counts.warn?'warn':'ok';root.classList.add('ready');
    if(r.signedIn)await race(sleep(reduced.matches?350:counts.fail?1800:950));
   }
   finished=true;clearInterval(spin);removeEventListener('keydown',onKey,true);
   // Exit: the screen lifts away and the dashboard rises in (none under reduced motion).
   if(!reduced.matches&&!skipped){root.classList.add('out');await sleep(420);}
   root.remove();delete document.documentElement.dataset.booting;
   return {...r,counts,skipped,transcript:transcriptLines()};
  },
 };
 // For the terminal's Host tab: the counts, then only what needs the owner (problems and warnings, with their fixes).
 function transcriptLines(){
  const tag={ok:TAG.OK,warn:TAG.WARN,fail:TAG.FAIL,skip:TAG.SKIP,wait:TAG.INFO},rows=transcript.filter(x=>!x.summary&&!/^Ready in/.test(x.text));
  const n=k=>rows.filter(x=>x.tag===k).length,bad=rows.filter(x=>x.tag==='warn'||x.tag==='fail');
  const many=(k,w)=>`${n(k)} ${w}${n(k)===1?'':'s'}`;
  return [`${C.dim}── start-up ${new Date().toLocaleTimeString()} · ${n('ok')} ok, ${many('warn','warning')}, ${many('fail','problem')} ──${C.reset}`,
   ...(bad.length?bad.flatMap(x=>[`${tag[x.tag]} ${x.text.trim()}`,...(x.fix?[`       ${C.or}fix:${C.reset} ${x.fix}`]:[])]):[`${TAG.OK} Everything checked is fine.`]),
   `${C.dim}────────────────────────────────────────────${C.reset}`];
 }
}
