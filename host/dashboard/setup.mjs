// Setup page: the setup wizard (host/wizard.mjs) as a vertical stepper. Each step shows what it will change (the
// script's own dry run), who runs it, Run or Run again, its live output ('setup' events), and PASS/WARN/FAIL with the
// check rows. Steps the host may not run give the owner one line for PowerShell as administrator, with a copy button.
import {createAttachPage} from './attach.mjs';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const WORD={PASS:'Passed',WARN:'Passed, with warnings',FAIL:'Failed','needs-admin':'Needs administrator',running:'Running',waiting:'Waiting for you',todo:'Not run yet'};
const MARK={PASS:'✓',WARN:'!',FAIL:'×','needs-admin':'!'};
const LOG_SHOWN=400;
const MODE_SUB={'own-pc':'Everything on 127.0.0.1, for trying it out.',vps:'Players join through Cloudflare; the website runs elsewhere.',attach:'Your server keeps its files, plugins and saves; the app adds our adapter and links it to the website.'};

export function createSetupPage({api,toast,span,clock,serverNow}){
 let data=null,visible=false,loading=false;
 const open=new Set(),errors=new Map(),planning=new Set(),attach=createAttachPage({api,toast});
 const stateOf=s=>data?.running?.step===s.id||s.last?.status==='running'?'running':s.handoff?'waiting':s.last?.status??'todo';
 const fail=(id,msg)=>{errors.set(id,msg);renderStep(id);};

 async function load(){
  if(loading)return;loading=true;
  try{
   data=await api('/api/setup');
   // A server the installer already attached as it is: that is the mode.
   if(!data.mode){const a=await api('/api/attach').catch(()=>null);if(a?.available&&a.steps?.server?.dir)data=await api('/api/setup/mode',{method:'POST',body:{mode:'attach'}});}
  }catch(e){if(e.message!=='sign-in')toast('Could not load setup: '+e.message,'error');return;}finally{loading=false;}
  if(!open.size){const next=data.steps.find(s=>stateOf(s)==='running'||stateOf(s)==='waiting')??data.steps.find(s=>!['PASS','WARN'].includes(stateOf(s)));if(next)open.add(next.id);}
  render();
  for(const id of open){const s=data.steps.find(x=>x.id===id);if(s)autoPlan(s);}
 }
 function render(){
  if(!data)return;
  const note=[data.practice?'Practice mode: stand-in scripts run here, and nothing on this PC changes.':null,
   !data.available?'This host cannot run PowerShell, so every step gives you a line to paste into PowerShell on the server.':null].filter(Boolean);
  $('su-note').hidden=!note.length;$('su-note').textContent=note.join(' ');
  $('su-modes').replaceChildren(el('legend',{class:'mono',text:'Where does this server run?'}),...Object.entries(data.modes).map(([k,label])=>el('label',{class:'mode'},
   el('input',{type:'radio',name:'su-mode',value:k,checked:data.mode===k?'':null,onchange:async()=>{
    try{data=await api('/api/setup/mode',{method:'POST',body:{mode:k}});open.clear();load();}catch(e){toast(e.message,'error');}}}),
   el('span',{},el('b',{text:label}),el('span',{class:'sub',text:MODE_SUB[k]??''})))));
  // An existing server: the app's own five steps (attach.mjs) instead of the scripts.
  const attaching=data.mode==='attach';
  $('at').hidden=!attaching;$('su-steps').hidden=attaching;
  if(attaching){$('su-stats').hidden=true;$('su-empty').hidden=true;$('su-finish').hidden=true;attach.load();return;}
  renderFinish();
  const counts={done:0,warn:0,fail:0,todo:0};
  for(const s of data.steps){const x=stateOf(s);counts[x==='PASS'?'done':x==='WARN'?'warn':x==='FAIL'||x==='needs-admin'?'fail':'todo']++;}
  $('su-stats').hidden=!data.mode;
  $('su-done').textContent=String(counts.done);$('su-warn').textContent=String(counts.warn);$('su-fail').textContent=String(counts.fail);$('su-todo').textContent=String(counts.todo);
  $('su-empty').hidden=Boolean(data.mode);
  const list=$('su-steps');
  // Keep existing items (and what the owner typed in them); add, order and drop by step id.
  const want=data.steps.map(s=>s.id);
  for(const li of [...list.children])if(!want.includes(li.dataset.step))li.remove();
  want.forEach((id,i)=>{let li=list.querySelector(`[data-step="${id}"]`);if(!li){li=el('li',{class:'sstep','data-step':id});}if(list.children[i]!==li)list.insertBefore(li,list.children[i]??null);renderStep(id);});
 }
 // "Add the parts to host.json" (owner decision, HOST-AND-LOADER-BUILD.md question 3, 29 Oct 2026): shown once the
 // scripts have written something host.json does not have yet.
 function renderFinish(){
  const ready=data.finish?.ready??[];
  $('su-finish').hidden=!data.finish?.can||!ready.length;
  if(!data.finish?.can||!ready.length)return;
  $('su-finish-text').textContent=`The scripts have finished ${ready.join(', ')}. Add any of ${ready.length===1?'it':'them'} host.json does not have yet, so the dashboard runs ${ready.length===1?'it':'them'} too.`;
  $('su-finish-btn').onclick=async()=>{
   $('su-finish-btn').disabled=true;
   try{const r=await api('/api/setup/finish',{method:'POST'});toast(r.added.length?`Added to host.json: ${r.added.join(', ')}. Restart the host app to pick them up.`:'Nothing new to add.');data=await api('/api/setup');render();}
   catch(e){toast(e.message,'error');}
   finally{$('su-finish-btn').disabled=false;}
  };
 }
 function field(s,name){
  const f=data.fields[name],id=`su-${s.id}-${name}`,value=name==='code'?'':data.options[name]??'';
  return el('div',{class:'field'},el('label',{for:id,text:f.label}),
   el('input',{id,name,type:f.secret?'password':'text',autocomplete:'off',spellcheck:'false',value,placeholder:name==='code'&&data.hasCode?'(kept from before; enter it again to change it)':f.hint}));
 }
 const options=li=>Object.fromEntries([...li.querySelectorAll('.su-fields input')].filter(i=>i.value.trim()||i.name!=='code').map(i=>[i.name,i.value.trim()]));
 function renderStep(id){
  const s=data?.steps.find(x=>x.id===id),li=$('su-steps').querySelector(`[data-step="${id}"]`);if(!s||!li)return;
  const x=stateOf(s),n=data.steps.indexOf(s)+1,isOpen=open.has(id);
  // Typed values and focus survive a re-render.
  const typed=Object.fromEntries([...li.querySelectorAll('input')].map(i=>[i.id,i.value])),focus=li.contains(document.activeElement)?document.activeElement.id:null;
  li.dataset.state=x;
  const head=el('button',{class:'sstep-head',type:'button','aria-expanded':String(isOpen),'aria-controls':`su-body-${id}`,onclick:()=>{isOpen?open.delete(id):open.add(id);renderStep(id);if(!isOpen)autoPlan(s);}},
   el('span',{class:'sstep-mark','aria-hidden':'true'},x==='running'?el('span',{class:'beacon','data-state':'starting'}):MARK[x]??String(n)),
   el('span',{class:'sstep-title'},el('b',{text:s.title}),el('span',{class:'sub',text:s.why})),
   el('span',{class:'sstep-side'},el('span',{class:'tag'+(s.by==='host'?' browser':' desktop'),text:s.by==='host'?'Runs here':'You run it'}),el('span',{class:'sstep-status',text:WORD[x]??x})));
  const body=isOpen?el('div',{class:'sstep-body',id:`su-body-${id}`},
   planBlock(s),
   s.needs.length?el('div',{class:'su-fields'},...s.needs.map(n=>field(s,n))):null,
   s.by==='owner'?el('p',{class:'su-who'},el('b',{text:'You run this step. '}),s.byWhy??''):null,
   errors.get(id)?el('p',{class:'err',role:'alert',text:errors.get(id)}):null,
   actions(s,x),
   s.handoff?handoff(s):null,
   result(s),
   logBlock(s)):null;
  li.replaceChildren(head,...(body?[body]:[]));
  for(const [k,v] of Object.entries(typed)){const i=li.querySelector('#'+CSS.escape(k));if(i)i.value=v;}
  if(focus)li.querySelector('#'+CSS.escape(focus))?.focus();
  if(body){const box=li.querySelector('.slog');if(box)box.scrollTop=box.scrollHeight;}
 }
 function planBlock(s){
  const p=s.plan;
  if(planning.has(s.id))return el('div',{class:'su-plan'},el('p',{class:'mono',text:'What it will change'}),el('p',{class:'muted',text:'Reading the plan from the script…'}));
  if(!p)return el('div',{class:'su-plan'},el('p',{class:'mono',text:'What it will change'}),el('p',{class:'muted',text:s.missing.length?'Fill in the fields below to see the plan.':'The plan comes from the script\'s own dry run.'}));
  if(p.error)return el('div',{class:'su-plan'},el('p',{class:'mono',text:'What it will change'}),el('p',{class:'err',text:'The dry run stopped: '+p.error}));
  return el('div',{class:'su-plan'},
   el('div',{class:'su-plan-h'},el('p',{class:'mono',text:'What it will change'}),
    p.changesSecurity?el('span',{class:'tag warn',text:'Changes Windows security'}):null,p.runsOriginalBinaries?el('span',{class:'tag bad',text:'Runs the original server'}):null,
    el('span',{class:'mono muted',text:'dry run '+span(Math.max(0,serverNow()-p.at))+' ago'})),
   el('ol',{},...p.steps.map(t=>el('li',{text:t}))));
 }
 function actions(s,x){
  const busy=Boolean(data.running),again=['PASS','WARN','FAIL','needs-admin'].includes(x);
  const run=async(by)=>{
   errors.delete(s.id);
   try{const r=await api('/api/setup/run',{method:'POST',body:{step:s.id,options:options($('su-steps').querySelector(`[data-step="${s.id}"]`)),...(by?{by}:{})}});
    if(r.by==='owner')toast('Paste the line into PowerShell as administrator. The result shows here.');}
   catch(e){if(e.message!=='sign-in')fail(s.id,e.message);}
  };
  const label=s.by==='host'?(again?'Run again':'Run'):(s.handoff?'Make a new line':again?'Run again myself':'Get the line to run');
  return el('div',{class:'row su-actions'},
   el('button',{class:'btn primary',type:'button',text:label,disabled:busy||x==='running'?'':null,onclick:()=>run()}),
   el('button',{class:'btn',type:'button',text:'Check the plan',disabled:planning.has(s.id)?'':null,onclick:()=>plan(s,true)}),
   s.by==='host'?el('button',{class:'btn ghost',type:'button',text:'Run it myself instead',disabled:busy?'':null,onclick:()=>run('owner')}):null,
   busy&&data.running.step!==s.id?el('span',{class:'mono muted',text:'Another step is running'}):null);
 }
 function handoff(s){
  const cmd=s.handoff.command;
  const box=cmd?el('textarea',{class:'su-cmd',readonly:'',rows:'4',spellcheck:'false','aria-label':'Command for PowerShell as administrator'}):null;
  if(box)box.value=cmd;
  const copy=async()=>{
   try{await navigator.clipboard.writeText(cmd);toast('Copied');}
   catch{box.focus();box.select();toast('Press Ctrl+C to copy the selected line');}
  };
  return el('div',{class:'su-handoff'},
   el('p',{},el('b',{text:'Open PowerShell as administrator, paste this line and press Enter.'}),' Follow its prompts there. Its output and result show here as it runs.'),
   box??el('p',{class:'muted',text:'The host restarted since this line was made. Get a new line to run it.'}),
   el('div',{class:'row'},cmd?el('button',{class:'btn small primary',type:'button',text:'Copy',onclick:copy}):null,
    el('button',{class:'btn small',type:'button',text:'Cancel',onclick:async()=>{try{await api('/api/setup/cancel',{method:'POST',body:{step:s.id}});}catch(e){toast(e.message,'error');}}}),
    el('span',{class:'mono muted waiting',text:'Waiting for your result since '+clock(s.handoff.at)})));
 }
 function result(s){
  const r=s.last;if(!r||r.status==='running')return null;
  const rows=r.rows??[];
  return el('div',{class:'su-result','data-status':r.status},
   el('p',{},el('b',{text:WORD[r.status]??r.status}),r.detail?el('span',{text:' · '+r.detail}):null,el('span',{class:'mono muted',text:` · ${r.by==='owner'?'run by you':'run here'}, ${r.endedAt?span(Math.max(0,serverNow()-r.endedAt))+' ago':''}`})),
   r.status==='needs-admin'?el('p',{text:'The host is not an administrator. Get the line to run it yourself in PowerShell as administrator.'}):null,
   r.hint==='owner'?el('p',{text:'The host\'s account may not change these files. Run it yourself instead: the button above gives you the line.'}):null,
   rows.length?el('div',{class:'table-wrap'},el('table',{class:'table'},el('thead',{},el('tr',{},el('th',{scope:'col',text:'Check'}),el('th',{scope:'col',text:'Result'}),el('th',{scope:'col',text:'Detail'}))),
    el('tbody',{},...rows.map(x=>el('tr',{},el('td',{text:x.check}),el('td',{},el('span',{class:'tag'+(x.status==='FAIL'?' bad':x.status==='WARN'?' warn':' browser'),text:x.status})),el('td',{class:'id',text:x.detail})))))):null);
 }
 function logBlock(s){
  const lines=s.log.filter(l=>!l.text.startsWith('##rlb ')).slice(-LOG_SHOWN);
  if(!lines.length)return null;
  return el('div',{class:'slog',role:'log','aria-label':s.title+' output',tabindex:'0'},...lines.map(lineEl));
 }
 const lineEl=l=>el('div',{class:'sln','data-stream':l.stream,text:l.text||' '});
 async function plan(s,force){
  if(planning.has(s.id)||(!force&&(s.plan||s.missing.length)))return;
  const li=$('su-steps').querySelector(`[data-step="${s.id}"]`);errors.delete(s.id);
  planning.add(s.id);renderStep(s.id);
  try{const v=await api('/api/setup/plan',{method:'POST',body:{step:s.id,options:li?options(li):undefined}});replace(v);}
  catch(e){if(e.message!=='sign-in')errors.set(s.id,e.message);}
  finally{planning.delete(s.id);renderStep(s.id);}
 }
 const autoPlan=s=>plan(s,false);
 function replace(v){const i=data.steps.findIndex(x=>x.id===v.id);if(i>=0)data.steps[i]=v;}

 return {
  show(){visible=true;load();},
  hide(){visible=false;},
  // 'setup' events: live lines of a running step, a step's new state, or a new mode.
  onEvent(d){
   if(!data)return;
   if(d.mode){data=d.state;if(visible)render();return;}
   const s=data.steps.find(x=>x.id===d.step);if(!s)return;
   if(d.state){
    const was=stateOf(s);replace(d.state);
    data.running=d.state.last?.status==='running'?{step:d.step,by:'host',startedAt:d.state.last.at}:data.running?.step===d.step?null:data.running;
    if(visible){if(was!=='running'&&stateOf(d.state)==='running')open.add(d.step);render();}
    return;
   }
   if(d.lines){
    s.log.push(...d.lines);if(s.log.length>LOG_SHOWN)s.log.splice(0,s.log.length-LOG_SHOWN);
    const li=visible&&$('su-steps').querySelector(`[data-step="${d.step}"]`);if(!li||!open.has(d.step))return;
    let box=li.querySelector('.slog');
    if(!box){renderStep(d.step);return;}
    const atEnd=box.scrollHeight-box.scrollTop-box.clientHeight<24;
    box.append(...d.lines.filter(l=>!l.text.startsWith('##rlb ')).map(lineEl));
    while(box.childElementCount>LOG_SHOWN)box.firstElementChild.remove();
    if(atEnd)box.scrollTop=box.scrollHeight;
   }
  },
 };
}
