// The terminal panel's Host tab (terminal.mjs): the host app's own command line, in the app and in a plain browser.
// It is not a shell. Each command is one call to a dashboard API route that already exists, made with the dashboard's
// own api() (session cookie; POST with Origin and X-RLB-Host), so it can do exactly what the buttons can and no more.
// ROUTES lists those calls (/api/action through the dashboard's act(), which asks before stopping a running original
// server); tests/host-desktop.test.mjs checks them against host/service.mjs.
export const PARTS={website:'central',central:'central',sidecar:'sidecar',server:'server',game:'server',gateway:'gateway'};
export const LABEL={central:'Website',sidecar:'Sidecar',server:'Game server',gateway:'Gateway',host:'Host'};
export const ROUTES=[['POST','/api/action'],['POST','/api/health-check'],['POST','/api/backups/keep'],
 ['POST','/api/schedule/restart-in'],['POST','/api/schedule/cancel'],['GET','/api/central/players']];
export const COMMANDS={
 help:{usage:'help',about:'List the commands and shortcuts'},
 status:{usage:'status',about:"Each part's state, the watchdog and players"},
 start:{usage:'start <part|all>',about:'Start the website, sidecar, server or gateway, or all of them',parts:true},
 stop:{usage:'stop <part|all>',about:'Stop a part (the game server saves first when it can)',parts:true},
 restart:{usage:'restart <part|all>',about:'Restart a part',parts:true},
 logs:{usage:'logs [part] [-n 20] [--follow]',about:'Recent log lines; --follow keeps streaming until Ctrl+C',parts:true,flags:['--follow','-n']},
 health:{usage:'health',about:'Run the health check'},
 backup:{usage:'backup now [label]',about:'Keep a copy of the current world save',words:['now']},
 'restart-in':{usage:'restart-in <minutes>',about:'Restart the game server, warning players in game first'},
 'cancel-restart':{usage:'cancel-restart',about:'Cancel a pending restart'},
 players:{usage:'players',about:'Who is playing now'},
 clear:{usage:'clear',about:'Clear the screen (Ctrl+L)'},
};
const PART_WORDS=['website','sidecar','server','gateway','all'];

// ANSI, themed by terminal.mjs (green → teal, yellow → amber, red → the red text colour); orange in true colour.
export const C={reset:'\x1b[0m',dim:'\x1b[2m',bold:'\x1b[1m',or:'\x1b[38;2;205;90;40m',ok:'\x1b[32m',warn:'\x1b[33m',bad:'\x1b[31m',blue:'\x1b[34m',white:'\x1b[97m'};
export const TAG={OK:`${C.ok}[ OK ]${C.reset}`,WARN:`${C.warn}[WARN]${C.reset}`,FAIL:`${C.bad}[FAIL]${C.reset}`,SKIP:`${C.dim}[ -- ]${C.reset}`,INFO:`${C.dim}[ .. ]${C.reset}`};
const STATUS_TAG={PASS:TAG.OK,WARN:TAG.WARN,FAIL:TAG.FAIL,SKIP:TAG.SKIP};
const STATE_COLOUR={running:C.ok,starting:C.warn,stopping:C.warn,backoff:C.warn,failed:C.bad,stopped:C.dim};

export function tokenize(line){
 const out=[];let cur=null,q=null;
 for(const ch of line){
  if(q){if(ch===q)q=null;else cur+=ch;continue;}
  if(ch==='"'||ch==="'"){q=ch;cur??='';continue;}
  if(/\s/.test(ch)){if(cur!==null){out.push(cur);cur=null;}continue;}
  cur=(cur??'')+ch;
 }
 if(cur!==null)out.push(cur);
 return out;
}

// Tab completion: {line, options}. One match completes (with a space after it); several list the choices.
export function complete(line){
 const words=tokenize(line),fresh=/\s$/.test(line)||!line.length;
 const done=fresh?words:words.slice(0,-1),part=fresh?'':words.at(-1)??'';
 let pool;
 if(!done.length)pool=Object.keys(COMMANDS);
 else{const c=COMMANDS[done[0]];pool=!c?[]:c.parts?(done.length===1||done[0]==='logs'?[...PART_WORDS.filter(w=>done[0]!=='logs'||w!=='all'),...(c.flags??[])]:[]):c.words&&done.length===1?c.words:[];}
 const options=pool.filter(w=>w.startsWith(part.toLowerCase()));
 if(options.length===1)return {line:[...done,options[0]].join(' ')+' ',options};
 // Several: complete their common start.
 if(options.length>1){let p=options[0];for(const o of options)while(!o.startsWith(p))p=p.slice(0,-1);if(p.length>part.length)return {line:[...done,p].join(' '),options};}
 return {line,options};
}

const pad=n=>String(n).padStart(2,'0');
const clock=t=>{const d=new Date(t);return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;};
export function span(ms){
 if(ms==null||ms<0)return '–';const s=Math.floor(ms/1000);
 if(s<60)return s+'s';const m=Math.floor(s/60);if(m<60)return m+'m';const h=Math.floor(m/60);if(h<48)return `${h}h ${pad(m%60)}m`;return Math.floor(h/24)+'d';
}

// write(text) prints (\r\n line ends); api(path, {method, body}) is the dashboard's; act(action, target) is the
// dashboard's own (it asks before stopping a running original server) and resolves true when the request was taken.
// status() is the latest /api/status as the SSE stream keeps it; logs() the lines the page holds; subscribe(kind, fn)
// hears 'state' and 'log' events from the same stream and returns an unsubscribe function.
export function createHostShell({api,act,status,logs,subscribe,write,now=()=>Date.now(),serverNow=now,timeouts={settle:90000}}){
 let cancel=null;
 const line=(s='')=>write(s+'\r\n');
 const comps=()=>status()?.components??[];
 const nameOf=c=>c.label??LABEL[c.name]??c.name;
 const stateWord=(s,w=0)=>`${STATE_COLOUR[s]??''}${String(s).padEnd(w)}${C.reset}`;
 const fail=e=>line(`${TAG.FAIL} ${e.message==='sign-in'?'Your session ended. Sign in again.':e.message}`);
 // A command that waits (a restart settling, logs --follow) can be cancelled with Ctrl+C.
 const waitable=(setup)=>new Promise(resolve=>{let cleanup=()=>{};const finish=v=>{cancel=null;cleanup();resolve(v);};cancel=()=>finish('cancelled');cleanup=setup(finish)??(()=>{});});

 const handlers={
  help(){
   line(`${C.bold}Host commands${C.reset} ${C.dim}(they use the dashboard's own controls; this is not a shell)${C.reset}`);
   for(const c of Object.values(COMMANDS))line(`  ${C.or}${c.usage.padEnd(30)}${C.reset}${c.about}`);
   line(`${C.dim}  Parts: website, sidecar, server, gateway. Tab completes, ↑ ↓ go through history, Ctrl+C stops a command.${C.reset}`);
   line(`${C.dim}  Shortcuts: Ctrl+\` shows or hides this panel; Ctrl+1 to Ctrl+9 open the pages in the sidebar.${C.reset}`);
  },
  status(){
   const s=status();if(!s){line(`${TAG.WARN} No status yet: the live connection is still opening.`);return;}
   if(!s.components.length)line(`${TAG.SKIP} No parts in host.json yet. Open Setup to prepare this server.`);
   for(const c of s.components){
    const up=c.state==='running'&&c.startedAt?'up '+span(serverNow()-c.startedAt):'';
    const bits=[c.pid?'PID '+c.pid:'',up,c.endpoint??'',c.external?'started outside the app':'',c.restarts?c.restarts+' restarts':''].filter(Boolean).join(' · ');
    line(`  ${nameOf(c).padEnd(13)}${stateWord(c.state,9)} ${C.dim}${bits}${C.reset}`);
   }
   const w=s.watchdog;
   if(w)line(`  ${'Watchdog'.padEnd(13)}${!w.enabled?`${C.warn}off${C.reset}`:w.state==='ok'?`${C.ok}alive${C.reset}`:w.state==='hung'?`${C.bad}hung${C.reset}`:w.state==='suspect'?`${C.warn}going quiet${C.reset}`:w.state==='grace'?`start-up grace ${C.dim}(${Math.ceil(w.graceLeft??0)} s left)${C.reset}`:`${C.dim}idle${C.reset}`} ${C.dim}hang after ${w.hangSeconds} s quiet${C.reset}`);
   line(`  ${'Players'.padEnd(13)}${s.players?s.players.inGame:`${C.dim}–${C.reset}`}`);
   const r=s.remote;if(r)line(`  ${'Website link'.padEnd(13)}${r.state==='connected'?`${C.ok}connected${C.reset}`:r.state==='no-key'?`${C.dim}no host app key${C.reset}`:r.state==='unreachable'||r.state==='key-refused'?`${C.bad}${r.state.replace('-',' ')}${C.reset}`:`${C.dim}${r.state}${C.reset}`}`);
  },
  async power(action,args){
   const word=(args[0]??'').toLowerCase(),target=word==='all'?'all':PARTS[word];
   if(!target){line(`${TAG.WARN} Say which part: ${action} website|sidecar|server|gateway|all`);return;}
   const names=target==='all'?comps().map(c=>c.name):[target];
   if(!names.length||(target!=='all'&&!comps().some(c=>c.name===target))){line(`${TAG.WARN} ${LABEL[target]??word} is not set up on this host.`);return;}
   const before=Object.fromEntries(names.map(n=>[n,comps().find(c=>c.name===n)?.pid??null]));
   const done=new Set(),seenDown=new Set();
   const settled=(c)=>action==='stop'?c.state==='stopped':c.state==='running'&&(action==='start'||seenDown.has(c.name)||c.pid!==before[c.name]);
   line(`${C.dim}${action==='stop'?'Stopping':action==='start'?'Starting':'Restarting'} ${target==='all'?'every part':LABEL[target]}…${C.reset}`);
   // Listen before asking, so no state change is missed.
   const result=waitable(finish=>{
    const timer=setTimeout(()=>finish('timeout'),timeouts.settle);
    const check=c=>{
     if(!names.includes(c.name)||done.has(c.name))return;
     if(c.state!=='running')seenDown.add(c.name);
     line(`  ${C.dim}${clock(now())}${C.reset}  ${nameOf(c).padEnd(13)}${stateWord(c.state)}${c.state==='failed'&&c.message?` ${C.dim}${c.message}${C.reset}`:''}`);
     if(c.state==='failed'){done.add(c.name);line(`${TAG.FAIL} ${nameOf(c)} failed. Its log has the reason: logs ${c.name==='central'?'website':c.name}`);}
     else if(settled(c)){done.add(c.name);line(`${TAG.OK} ${nameOf(c)} ${action==='stop'?'stopped':'running'}${c.pid&&action!=='stop'?` ${C.dim}(PID ${c.pid})${C.reset}`:''}`);}
     if(done.size===names.length)finish('done');
    };
    const off=subscribe('state',check);
    return ()=>{clearTimeout(timer);off();};
   });
   let ok;try{ok=await act(action,target);}catch(e){ok=false;fail(e);}
   if(!ok){cancel?.();line(`${C.dim}Not done.${C.reset}`);return;}
   // Already where we were asked to be (start on a running part): say so instead of waiting for a change.
   if(action!=='restart')for(const n of names){const c=comps().find(x=>x.name===n);if(c&&settled(c)&&!done.has(n)){done.add(n);line(`${TAG.OK} ${nameOf(c)} ${action==='stop'?'stopped':'running'}`);}}
   if(done.size===names.length){cancel?.();return;}
   const how=await result;
   if(how==='timeout')line(`${TAG.WARN} Still not settled after ${Math.round(timeouts.settle/1000)} s. Follow it on the Overview or with: status`);
   if(how==='cancelled')line(`${C.dim}Stopped waiting; the ${action} carries on.${C.reset}`);
  },
  async logs(args){
   let source=null,n=20,follow=false;
   for(let i=0;i<args.length;i++){
    const a=args[i].toLowerCase();
    if(a==='--follow'||a==='-f')follow=true;
    else if(a==='-n'){n=Math.max(1,Math.min(500,Number(args[++i])||20));}
    else if(PARTS[a])source=PARTS[a];else if(a==='host')source='host';
    else{line(`${TAG.WARN} Unknown part "${args[i]}". Parts: website, sidecar, server, gateway, host.`);return;}
   }
   const show=l=>line(`${C.dim}${clock(l.at)}${C.reset} ${C.or}${(LABEL[l.source]??l.source).toUpperCase().padEnd(12)}${C.reset}${l.level==='error'?C.bad:l.level==='warn'?C.warn:''}${l.text}${C.reset}`);
   const pick=logs().filter(l=>!source||l.source===source).slice(-n);
   if(!pick.length&&!follow)line(`${C.dim}No lines${source?' from '+LABEL[source]:''} yet.${C.reset}`);
   for(const l of pick)show(l);
   if(!follow)return;
   line(`${C.dim}Following${source?' '+LABEL[source]:''}. Ctrl+C stops.${C.reset}`);
   await waitable(()=>subscribe('log',l=>{if(!source||l.source===source)show(l);}));
  },
  async health(){
   line(`${C.dim}Running the health check…${C.reset}`);
   let r;try{r=await api('/api/health-check',{method:'POST'});}catch(e){fail(e);return;}
   const order={FAIL:0,WARN:1,PASS:2,SKIP:3};
   for(const row of [...r.rows].sort((a,b)=>order[a.status]-order[b.status])){
    line(`${STATUS_TAG[row.status]??TAG.INFO} ${row.label} ${C.dim}${row.detail}${C.reset}`);
    if(row.fix&&row.status!=='PASS')line(`       ${C.or}fix:${C.reset} ${row.fix}`);
   }
   const s=r.summary;line(`${s.fail?TAG.FAIL:s.warn?TAG.WARN:TAG.OK} ${s.pass} pass, ${s.warn} warn, ${s.fail} fail`);
  },
  async backup(args){
   if((args[0]??'').toLowerCase()!=='now'){line(`${TAG.WARN} Usage: backup now [label]`);return;}
   const label=args.slice(1).join(' ').trim()||undefined;
   try{const k=await api('/api/backups/keep',{method:'POST',body:{label}});line(`${TAG.OK} Kept a copy${k?.name?' '+C.dim+k.name+C.reset:''}${label?` ("${label}")`:''}. It is never removed by the watchdog.`);}catch(e){fail(e);}
  },
  async 'restart-in'(args){
   const minutes=Number(args[0]);
   if(!Number.isInteger(minutes)||minutes<0){line(`${TAG.WARN} Usage: restart-in <minutes> (a whole number; 0 restarts now)`);return;}
   try{await api('/api/schedule/restart-in',{method:'POST',body:{minutes}});line(`${TAG.OK} ${minutes?`Game server restart in ${minutes} min. Players in game are warned as it gets close.`:'Restarting the game server now (it saves first).'} Cancel with: cancel-restart`);}catch(e){fail(e);}
  },
  async 'cancel-restart'(){
   try{await api('/api/schedule/cancel',{method:'POST',body:{}});line(`${TAG.OK} Cancelled. Players who were warned are told.`);}catch(e){fail(e);}
  },
  async players(){
   const p=status()?.players;
   line(`  In game now: ${p?p.inGame:`${C.dim}unknown (the gateway is not answering)${C.reset}`}`);
   try{
    const r=await api('/api/central/players');
    const all=[...r.players.map(x=>({...x,kind:'browser'})),...r.desktop.map(x=>({...x,kind:'desktop'}))];
    if(!all.length)line(`${C.dim}  Nobody is playing right now.${C.reset}`);
    for(const x of all)line(`  ${String(x.name??x.handle??'?').padEnd(24)}${C.dim}${x.kind}${x.connectedAt?' · '+span(serverNow()-x.connectedAt):''}${x.review?' · under review':''}${C.reset}`);
   }catch(e){line(`${C.dim}  Names need the host app key (Accounts page): ${e.message}${C.reset}`);}
  },
 };

 return {
  get busy(){return cancel!==null;},
  cancel(){cancel?.();},
  async run(text){
   const [cmd0,...args]=tokenize(text.trim()),cmd=(cmd0??'').toLowerCase();
   if(!cmd)return;
   try{
    if(cmd==='help'||cmd==='?')return handlers.help();
    if(cmd==='clear'||cmd==='cls'){write('\x1b[2J\x1b[3J\x1b[H');return;}
    if(cmd==='status')return handlers.status();
    if(cmd==='start'||cmd==='stop'||cmd==='restart')return await handlers.power(cmd,args);
    if(handlers[cmd]&&COMMANDS[cmd])return await handlers[cmd](args);
    line(`${TAG.WARN} Unknown command "${cmd0}". Type ${C.or}help${C.reset} for the list. ${C.dim}(This tab runs host commands only.${C.reset}${C.dim} In the desktop app, open a PowerShell or CMD tab for a real shell.)${C.reset}`);
   }catch(e){fail(e);}
  },
 };
}
