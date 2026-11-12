// The terminal panel, docked on the right (at the bottom on narrow windows), resizable and collapsible (Ctrl+`).
// Tabs: Host (host-commands.mjs: the host app's own commands through the dashboard API, everywhere) and, only in the
// desktop app, PowerShell and CMD: real shells the app runs in a pseudo console (ConPTY) as the signed-in Windows
// user, reached over the WebView2 bridge (desktop-bridge.mjs) and never over HTTP. In a plain browser those tabs do
// not exist. Rendering is xterm.js, served by the service from node_modules (/vendor/), themed with the design tokens.
import {createHostShell,complete,C} from './host-commands.mjs';
const STORE='rlb-host-terminal',HISTORY='rlb-host-history';
const read=k=>{try{return JSON.parse(localStorage.getItem(k)??'null');}catch{return null;}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const SHELL_NAME={powershell:'PowerShell',cmd:'CMD'};
const PROMPT=`${C.or}host${C.reset}${C.dim}›${C.reset} `;

let xtermLoad=null;
// xterm and its fit addon, once; the mono font first, or xterm measures the fallback font's cells.
function loadXterm(){
 // xterm adds <style> elements of its own; the page's CSP (host/service.mjs pageCsp) lets in only those carrying this
 // response's nonce, which the server put on xterm's stylesheet link. Our own scripts are the only ones that run here.
 const nonce=document.querySelector('link[href="/vendor/xterm.css"]')?.nonce;
 if(nonce&&!document.createElement.rlbNonce){
  const make=document.createElement.bind(document);
  document.createElement=Object.assign(function(tag,opts){const e=make(tag,opts);if(String(tag).toLowerCase()==='style')e.nonce=nonce;return e;},{rlbNonce:true});
 }
 xtermLoad??=Promise.all([import('/vendor/xterm.mjs'),import('/vendor/addon-fit.mjs'),document.fonts?.load('500 13px "JetBrains Mono RLB"').catch(()=>{})])
  .then(([x,f])=>({Terminal:x.Terminal,FitAddon:f.FitAddon}));
 return xtermLoad;
}
function theme(){
 const css=getComputedStyle(document.documentElement),v=n=>css.getPropertyValue(n).trim();
 return {background:'#070707',foreground:v('--w2'),cursor:v('--or'),cursorAccent:'#070707',selectionBackground:'rgba(205,90,40,.35)',
  black:'#0a0a0a',red:v('--red-text'),green:v('--teal'),yellow:v('--amber'),blue:v('--blue'),magenta:'#c58fb8',cyan:'#7fc4bb',white:v('--w2'),
  brightBlack:v('--w4'),brightRed:'#ff8a7f',brightGreen:'#86cfc5',brightYellow:'#f3c46a',brightBlue:'#a8c1e6',brightMagenta:'#dcb0d2',brightCyan:'#a6dcd5',brightWhite:v('--w')};
}

// bridge: desktop-bridge.mjs (null in a plain browser). host: {api, act, status, logs, subscribe, serverNow} for the
// Host tab. toggleButton: the status bar's terminal button.
export function createTerminalPanel({bridge,host,root,toggleButton,reduced}){
 const saved=read(STORE)??{};
 const narrow=matchMedia('(max-width:1100px)'),phone=matchMedia('(max-width:720px)');
 const state={open:saved.open??(!phone.matches&&innerWidth>=1100),w:saved.w??460,h:saved.h??300};
 const tabs=[];let active=null,seq=0,xt=null;
 const tablist=el('div',{class:'term-tabs',role:'tablist','aria-label':'Terminal tabs'});
 const adders=bridge?el('div',{class:'term-add'},...['powershell','cmd'].map(s=>el('button',{class:'term-new',type:'button','data-shell':s,title:`Open ${SHELL_NAME[s]} as your Windows account`,onclick:()=>openShell(s)},el('span',{'aria-hidden':'true',text:'+'}),SHELL_NAME[s]))):null;
 const hide=el('button',{class:'term-hide',type:'button','aria-label':'Hide the terminal (Ctrl+`)',title:'Hide (Ctrl+`)',onclick:()=>setOpen(false)},el('span',{'aria-hidden':'true'}));
 const body=el('div',{class:'term-body'});
 const grip=el('div',{class:'term-grip',role:'separator',tabindex:'0','aria-label':'Resize the terminal','aria-controls':root.id});
 root.replaceChildren(grip,el('header',{class:'term-head'},tablist,adders,hide),body);

 // ---------- Size and docking ----------
 const clampW=w=>Math.round(Math.max(320,Math.min(w,Math.min(960,innerWidth*0.6)))),clampH=h=>Math.round(Math.max(160,Math.min(h,innerHeight*0.7)));
 function apply(){
  document.documentElement.style.setProperty('--term-w',clampW(state.w)+'px');
  document.documentElement.style.setProperty('--term-h',clampH(state.h)+'px');
  root.hidden=!state.open;document.documentElement.dataset.term=state.open?'open':'closed';
  toggleButton?.setAttribute('aria-expanded',String(state.open));
  grip.setAttribute('aria-orientation',narrow.matches?'horizontal':'vertical');
  grip.setAttribute('aria-valuenow',String(narrow.matches?clampH(state.h):clampW(state.w)));
 }
 const persist=()=>save(STORE,{open:state.open,w:clampW(state.w),h:clampH(state.h)});
 function setOpen(open){
  state.open=open;apply();persist();
  if(open){ensureHost();requestAnimationFrame(()=>{fitAll();active?.term?.focus();});}
  else if(root.contains(document.activeElement))document.getElementById('main')?.focus();
 }
 grip.addEventListener('pointerdown',e=>{
  e.preventDefault();grip.setPointerCapture(e.pointerId);root.classList.add('resizing');
  const sx=e.clientX,sy=e.clientY,w0=clampW(state.w),h0=clampH(state.h);
  const move=m=>{if(narrow.matches)state.h=clampH(h0-(m.clientY-sy));else state.w=clampW(w0-(m.clientX-sx));apply();};
  const up=()=>{grip.removeEventListener('pointermove',move);root.classList.remove('resizing');persist();fitAll();};
  grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up,{once:true});grip.addEventListener('pointercancel',up,{once:true});
 });
 grip.addEventListener('keydown',e=>{
  const step=e.shiftKey?96:24,grow=narrow.matches?{ArrowUp:1,ArrowDown:-1}[e.key]:{ArrowLeft:1,ArrowRight:-1}[e.key];
  if(!grow)return;e.preventDefault();
  if(narrow.matches)state.h=clampH(state.h+grow*step);else state.w=clampW(state.w+grow*step);
  apply();persist();fitAll();
 });
 narrow.addEventListener('change',()=>{apply();fitAll();});
 addEventListener('resize',()=>{apply();});

 // ---------- Tabs ----------
 function addTab({kind,label,closable}){
  const id='tt-'+(++seq);
  const pane=el('div',{class:'term-pane',role:'tabpanel',id:id+'-p','aria-labelledby':id,hidden:true});
  const close=closable?el('span',{class:'term-x',role:'button',tabindex:'-1','aria-label':`Close ${label}`,title:'Close',onclick:e=>{e.stopPropagation();closeTab(t);}},'×'):null;
  const button=el('button',{class:'term-tab',type:'button',role:'tab',id,'aria-controls':id+'-p','aria-selected':'false','data-kind':kind,onclick:()=>select(t)},el('span',{class:'term-dot','aria-hidden':'true'}),el('span',{class:'term-label',text:label}),close);
  button.addEventListener('keydown',e=>{const i=tabs.indexOf(t),d={ArrowRight:1,ArrowLeft:-1}[e.key];if(d){e.preventDefault();const n=tabs[(i+d+tabs.length)%tabs.length];select(n);n.button.focus();}});
  const t={id,kind,label,button,pane,term:null,fit:null,tid:null,ended:false};
  tabs.push(t);tablist.append(button);body.append(pane);return t;
 }
 function select(t){
  active=t;
  for(const x of tabs){const on=x===t;x.button.setAttribute('aria-selected',String(on));x.button.tabIndex=on?0:-1;x.pane.hidden=!on;}
  requestAnimationFrame(()=>{fit(t);t.term?.focus();});
 }
 async function makeTerm(t){
  xt??=await loadXterm();
  const term=new xt.Terminal({fontFamily:'"JetBrains Mono RLB","Cascadia Mono",Consolas,monospace',fontSize:13,lineHeight:1.25,letterSpacing:0,
   cursorBlink:!reduced.matches,cursorStyle:'bar',theme:theme(),scrollback:5000,allowProposedApi:false,convertEol:false,macOptionIsMeta:true,smoothScrollDuration:0});
  const fit=new xt.FitAddon();term.loadAddon(fit);term.open(t.pane);
  // Ctrl+C with a selection copies (as in Windows Terminal); without one it goes to the program. Ctrl+` belongs to the panel.
  term.attachCustomKeyEventHandler(e=>{
   if(e.type!=='keydown')return true;
   if(e.ctrlKey&&!e.shiftKey&&(e.key==='c'||e.key==='C')&&term.hasSelection()){navigator.clipboard?.writeText(term.getSelection()).catch(()=>{});term.clearSelection();return false;}
   if(e.ctrlKey&&e.shiftKey&&(e.key==='C'||e.key==='c')){if(term.hasSelection())navigator.clipboard?.writeText(term.getSelection()).catch(()=>{});return false;}
   return true;
  });
  t.term=term;t.fit=fit;fit.fit();
  return term;
 }
 let fitTimer=0;
 function fit(t){
  if(!t?.term||root.hidden||t.pane.hidden)return;
  const {cols,rows}=t.term;
  try{t.fit.fit();}catch{}
  if(t.tid!=null&&!t.ended&&(t.term.cols!==cols||t.term.rows!==rows))bridge.resize(t.tid,t.term.cols,t.term.rows);
 }
 const fitAll=()=>{clearTimeout(fitTimer);fitTimer=setTimeout(()=>fit(active),40);};
 new ResizeObserver(fitAll).observe(body);

 // ---------- Host tab: a line editor over the host commands ----------
 let hostTab=null,pendingIntro=[];
 const history=(read(HISTORY)??[]).filter(x=>typeof x==='string').slice(-100);
 function ensureHost(){
  if(hostTab)return hostTab.ready;
  hostTab=addTab({kind:'host',label:'Host',closable:false});
  hostTab.ready=(async()=>{
   const term=await makeTerm(hostTab);
   let buf='',cur=0,hi=history.length,running=false;
   const write=s=>term.write(s);
   const shell=createHostShell({...host,write});
   const redraw=()=>{write('\r\x1b[2K'+PROMPT+buf);if(cur<buf.length)write(`\x1b[${buf.length-cur}D`);};
   const prompt=()=>{buf='';cur=0;hi=history.length;write(PROMPT);};
   write(`${C.bold}Rust Legacy Host${C.reset} ${C.dim}· host commands · type ${C.reset}${C.or}help${C.reset}${C.dim} for the list${C.reset}\r\n`);
   for(const l of pendingIntro)write(l+'\r\n');pendingIntro=null;
   prompt();
   // Lines that arrive later (the boot transcript) print above the prompt, which is drawn again under them.
   hostTab.above=lines=>{if(running){write(lines.join('\r\n')+'\r\n');return;}write('\r\x1b[2K'+lines.join('\r\n')+'\r\n');redraw();};
   hostTab.run=async text=>{
    write('\r\n');
    if(text.trim()&&history.at(-1)!==text.trim()){history.push(text.trim());if(history.length>100)history.shift();save(HISTORY,history);}
    running=true;try{await shell.run(text);}finally{running=false;}prompt();
   };
   term.onData(async d=>{
    if(running){if(d==='\x03'&&shell.busy){write('^C\r\n');shell.cancel();}return;}
    if(d==='\r'){const text=buf;buf='';cur=0;await hostTab.run(text);return;}
    if(d==='\x7f'||d==='\b'){if(cur>0){buf=buf.slice(0,cur-1)+buf.slice(cur);cur--;redraw();}return;}
    if(d==='\x1b[3~'){if(cur<buf.length){buf=buf.slice(0,cur)+buf.slice(cur+1);redraw();}return;}
    if(d==='\t'){const r=complete(buf);if(r.options.length>1&&r.line===buf){write('\r\n'+r.options.map(o=>C.dim+o+C.reset).join('   ')+'\r\n');}buf=r.line;cur=buf.length;redraw();return;}
    if(d==='\x1b[A'){if(hi>0){hi--;buf=history[hi];cur=buf.length;redraw();}return;}
    if(d==='\x1b[B'){if(hi<history.length){hi++;buf=history[hi]??'';cur=buf.length;redraw();}return;}
    if(d==='\x1b[D'){if(cur>0){cur--;write(d);}return;}
    if(d==='\x1b[C'){if(cur<buf.length){cur++;write(d);}return;}
    if(d==='\x1b[H'||d==='\x01'){cur=0;redraw();return;}
    if(d==='\x1b[F'||d==='\x05'){cur=buf.length;redraw();return;}
    if(d==='\x03'){write('^C\r\n');prompt();return;}
    if(d==='\x0c'){write('\x1b[2J\x1b[3J\x1b[H');redraw();return;}
    if(d==='\x15'){buf=buf.slice(cur);cur=0;redraw();return;}
    if(d.startsWith('\x1b'))return;
    // Typing or a paste: printable characters only; a pasted line break runs the line.
    const lines=d.replace(/\r\n?/g,'\n').split('\n');
    const text=lines[0].replace(/[\x00-\x1f\x7f]/g,'');
    buf=buf.slice(0,cur)+text+buf.slice(cur);cur+=text.length;redraw();
    if(lines.length>1){const t=buf;buf='';cur=0;await hostTab.run(t);}
   });
   if(!active||active===hostTab)select(hostTab);
  })();
  return hostTab.ready;
 }

 // ---------- Shell tabs (desktop app only) ----------
 const byTid=new Map();
 if(bridge){
  bridge.on('terminal.data',m=>{const t=byTid.get(m.tid);t?.term?.write(m.data);});
  bridge.on('terminal.exit',m=>{
   const t=byTid.get(m.tid);if(!t)return;t.ended=true;t.button.dataset.ended='true';
   t.term.write(`\r\n${C.dim}[${SHELL_NAME[t.kind]} ended${m.code!=null?` with code ${m.code}`:''}. Press any key to close this tab.]${C.reset}`);
  });
 }
 async function openShell(shell){
  if(!bridge)return;
  if(!state.open)setOpen(true);
  await ensureHost();
  const n=tabs.filter(t=>t.kind===shell).length+1;
  const t=addTab({kind:shell,label:SHELL_NAME[shell]+(n>1?' '+n:''),closable:true});
  select(t);
  const term=await makeTerm(t);
  term.write(`${C.dim}Starting ${SHELL_NAME[shell]}…${C.reset}`);
  try{
   const {tid}=await bridge.open({shell,cols:term.cols,rows:term.rows});
   t.tid=tid;byTid.set(tid,t);term.write('\r\x1b[2K');
   term.onData(d=>{if(t.ended){closeTab(t);return;}bridge.input(tid,d);});
   fit(t);
  }catch(e){t.ended=true;t.button.dataset.ended='true';term.write(`\r\x1b[2K${C.bad}Could not start ${SHELL_NAME[shell]}: ${e.message}${C.reset}\r\n`);term.onData(()=>closeTab(t));}
  return t;
 }
 function closeTab(t){
  if(t.kind==='host')return;
  if(t.tid!=null&&!t.ended)bridge.close(t.tid).catch(()=>{}); // the app ends the shell's whole process tree (Job Object)
  byTid.delete(t.tid);t.term?.dispose();t.button.remove();t.pane.remove();
  const i=tabs.indexOf(t);tabs.splice(i,1);
  if(active===t)select(tabs[Math.max(0,i-1)]);
 }

 apply();
 // The Host tab is made once the app is on screen (xterm measures its cells when it opens).
 return {
  activate(){apply();if(state.open)ensureHost();},
  toggle:()=>setOpen(!state.open),
  setOpen,
  get open(){return state.open;},
  // The boot transcript, so the Host tab opens with what the boot screen found.
  intro(lines){if(pendingIntro)pendingIntro.push(...lines);else hostTab?.ready.then(()=>hostTab.above(lines));},
  async focusHost(){if(!state.open)setOpen(true);await ensureHost();select(hostTab);},
  async run(text){await this.focusHost();hostTab.term.write(text);await hostTab.run(text);},
  openShell,
  hasShells:Boolean(bridge),
 };
}
