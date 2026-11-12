// Schedule page (host/schedule.mjs): what is next, a countdown with Cancel, "Restart in N minutes" (optionally with a
// wipe, confirmed first), the schedule editor (daily restarts, the wipe rule, warnings, time zone) and the history.
// GET /api/schedule; POST /api/schedule/save|restart-in|cancel. The markup is built here so index.html only holds the view.
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const WEEKDAYS=[['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday']];
const NTH=[[1,'First'],[2,'Second'],[3,'Third'],[4,'Fourth'],[-1,'Last']];
const WIPE={world:'Map wipe',full:'Full wipe'},WIPE_WHAT={world:'the map (buildings and items in the world)',full:'the map and every character (inventories and blueprints)'};
const OUTCOME={done:['Done','browser'],skipped:['Skipped',''],failed:['Failed','bad'],cancelled:['Cancelled','warn']};
const secText=s=>s%60===0?s/60+'m':s+'s';
const field=(id,label,input)=>el('div',{class:'field'},el('label',{for:id,text:label}),input);
const opts=(list,sel)=>list.map(([v,t])=>el('option',{value:String(v),selected:String(v)===String(sel)?'':null,text:t}));

export function createScheduleView(){
 const view=document.querySelector('section.view[data-view=schedule]');
 view.append(
  el('header',{class:'page-head'},el('p',{class:'eyebrow',text:'Restarts and wipes'}),el('h1',{class:'h',id:'sch-h',text:'Schedule'})),
  el('div',{class:'stats'},...[['sch-next','until the next restart'],['sch-wipe','until the next wipe'],['sch-last','since the last wipe'],['sch-done','restarts done']].map(([id,t])=>el('div',{class:'stat'},el('b',{id,text:'–'}),el('span',{text:t})))),
  el('p',{class:'note',id:'sch-note',hidden:''}),
  el('section',{class:'panel block countdown',id:'sch-pending',hidden:'','aria-live':'polite'},
   el('div',{class:'countdown-body'},el('p',{class:'mono',id:'sch-pending-what'}),el('b',{id:'sch-pending-left'}),el('p',{class:'muted',id:'sch-pending-when'})),
   el('button',{class:'btn danger',type:'button',id:'sch-cancel',text:'Cancel'})),
  el('div',{class:'acc-grid'},
   el('section',{class:'panel','aria-labelledby':'schf-h'},
    el('header',{class:'panel-h'},el('h2',{class:'mono',id:'schf-h',text:'Schedule'}),el('p',{class:'mono muted',id:'sch-zone-now'})),
    el('form',{class:'connect-body sch-form',id:'sch-form'},
     field('sch-tz','Time zone',el('input',{id:'sch-tz',list:'sch-zones',autocomplete:'off',spellcheck:'false',required:''})),el('datalist',{id:'sch-zones'}),
     el('fieldset',{class:'sch-set'},el('legend',{class:'mono',text:'Daily restarts'}),
      el('label',{class:'check'},el('input',{type:'checkbox',id:'sch-r-on'}),'Restart the game server every day'),
      field('sch-r-times','At (24-hour times, comma separated)',el('input',{id:'sch-r-times',placeholder:'06:00, 18:00',autocomplete:'off'}))),
     el('fieldset',{class:'sch-set'},el('legend',{class:'mono',text:'Wipes'}),
      el('label',{class:'check'},el('input',{type:'checkbox',id:'sch-w-on'}),'Wipe on a schedule'),
      el('div',{class:'sch-row'},
       field('sch-w-type','What',el('select',{id:'sch-w-type'},...opts([['world','Map only'],['full','Map and characters']]))),
       field('sch-w-every','Repeat',el('select',{id:'sch-w-every'},...opts([['month','Every month'],['weeks','Every few weeks'],['days','Every few days']]))),
       field('sch-w-time','At',el('input',{id:'sch-w-time',type:'time',required:''}))),
      el('div',{class:'sch-row',id:'sch-w-month'},
       field('sch-w-nth','Which',el('select',{id:'sch-w-nth'},...opts(NTH))),
       field('sch-w-day','Day',el('select',{id:'sch-w-day'},...opts(WEEKDAYS)))),
      el('div',{class:'sch-row',id:'sch-w-count',hidden:''},
       field('sch-w-n','Every',el('input',{id:'sch-w-n',type:'number',min:'1',max:'90',step:'1'})),
       field('sch-w-from','Starting',el('input',{id:'sch-w-from',type:'date'}))),
      el('p',{class:'muted sch-rule',id:'sch-w-rule'})),
     el('fieldset',{class:'sch-set'},el('legend',{class:'mono',text:'Warnings in chat'}),
      field('sch-warn','Before a restart (m minutes, s seconds)',el('input',{id:'sch-warn',placeholder:'30m, 15m, 10m, 5m, 1m, 10s',autocomplete:'off'})),
      el('label',{class:'check'},el('input',{type:'checkbox',id:'sch-quiet'}),'No warnings when nobody is online')),
     el('p',{class:'err',id:'sch-err',role:'alert',hidden:''}),
     el('div',{class:'row'},el('button',{class:'btn primary',type:'submit',text:'Save schedule'})))),
   el('aside',{class:'acc-side'},
    el('section',{class:'panel','aria-labelledby':'schn-h'},
     el('header',{class:'panel-h'},el('h2',{class:'mono',id:'schn-h',text:'Restart now'})),
     el('form',{class:'connect-body',id:'sch-now'},
      el('p',{text:'Players get the warnings that still fit, then the server saves, quits and starts again.'}),
      el('div',{class:'sch-row'},
       field('sch-now-min','In',el('select',{id:'sch-now-min'},...opts([[0,'Now'],[1,'1 minute'],[5,'5 minutes'],[10,'10 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour']],5))),
       field('sch-now-wipe','Also',el('select',{id:'sch-now-wipe'},...opts([['','No wipe'],['world','Wipe the map'],['full','Wipe map and characters']])))),
      el('button',{class:'btn primary',type:'submit',text:'Restart with warnings'}))),
    el('section',{class:'panel','aria-labelledby':'schu-h'},
     el('header',{class:'panel-h'},el('h2',{class:'mono',id:'schu-h',text:'Coming up'})),
     el('dl',{class:'facts',id:'sch-coming'})))),
  el('section',{class:'panel block sch-history','aria-labelledby':'schh-h'},
   el('header',{class:'panel-h'},el('h2',{class:'mono',id:'schh-h',text:'History'}),el('p',{class:'mono muted',text:'wipes are archived in backups, never deleted'})),
   el('div',{class:'table-wrap'},el('table',{class:'table',id:'sch-table'},el('thead',{},el('tr',{},...['When','What','By','Result','Note'].map(t=>el('th',{scope:'col',text:t})))),el('tbody'))),
   el('p',{class:'empty muted',id:'sch-empty',hidden:'',text:'Nothing yet. Restarts and wipes, scheduled or by hand, are listed here.'})));
}

export function createSchedulePage({api,toast,span,serverNow}){
 createScheduleView();
 let timer=null,tickTimer=null,visible=false,data=null,dirty=false;
 try{const zones=Intl.supportedValuesOf?.('timeZone')??[];$('sch-zones').replaceChildren(...zones.map(z=>el('option',{value:z})));}catch{}
 function confirmDialog(title,text,ok){
  const dlg=$('confirm');$('confirm-h').textContent=title;$('confirm-text').textContent=text;$('confirm-ok').textContent=ok;dlg.showModal();
  return new Promise(r=>dlg.addEventListener('close',()=>r(dlg.returnValue==='ok'),{once:true}));
 }
 const until=t=>t?span(t-serverNow()):'–';
 const what=e=>e.wipe?WIPE[e.wipe]:'Restart';
 function fill(s){
  $('sch-tz').value=s.timeZone;
  $('sch-r-on').checked=s.restarts.enabled;$('sch-r-times').value=s.restarts.times.join(', ');
  const w=s.wipe,r=w.rule;
  $('sch-w-on').checked=w.enabled;$('sch-w-type').value=w.type;$('sch-w-every').value=r.every;$('sch-w-time').value=r.time;
  if(r.every==='month'){$('sch-w-nth').value=String(r.nth);$('sch-w-day').value=r.weekday;}
  else{$('sch-w-n').value=String(r.n);$('sch-w-from').value=r.from;}
  $('sch-warn').value=s.warnings.map(secText).join(', ');$('sch-quiet').checked=s.skipWarningsWhenEmpty;
  every();
 }
 function every(){const m=$('sch-w-every').value==='month';$('sch-w-month').hidden=!m;$('sch-w-count').hidden=m;}
 function read(){
  const every=$('sch-w-every').value,warn=$('sch-warn').value.split(/[,\s]+/).filter(Boolean).map(x=>{const m=/^(\d+)\s*([ms]?)$/i.exec(x);return m?Number(m[1])*(m[2].toLowerCase()==='s'?1:60):NaN;});
  return {timeZone:$('sch-tz').value.trim(),restarts:{enabled:$('sch-r-on').checked,times:$('sch-r-times').value.split(/[,\s]+/).filter(Boolean)},
   wipe:{enabled:$('sch-w-on').checked,type:$('sch-w-type').value,rule:every==='month'?{every,nth:Number($('sch-w-nth').value),weekday:$('sch-w-day').value,time:$('sch-w-time').value}
    :{every,n:Number($('sch-w-n').value),from:$('sch-w-from').value,time:$('sch-w-time').value}},
   warnings:warn,skipWarningsWhenEmpty:$('sch-quiet').checked};
 }
 function renderPending(){
  const p=data?.running??data?.pending,box=$('sch-pending');box.hidden=!p;if(!p)return;
  const left=Math.max(0,p.at-serverNow());
  $('sch-pending-what').textContent=data.running?`${what(p)} running now`:`${what(p)} counting down${p.by!=='schedule'?` (by the ${p.by})`:''}`;
  $('sch-pending-left').textContent=data.running?'Now':left<60e3?Math.ceil(left/1000)+'s':span(left);
  $('sch-pending-when').textContent=`${p.local} · ${p.warned?'players have been warned':'no warning sent yet'}`;
  $('sch-cancel').hidden=Boolean(data.running);
 }
 function render(d){
  data=d;
  if(!d.configured){$('sch-note').hidden=false;$('sch-note').textContent='No game server in host.json, so there is nothing to restart.';return;}
  const g=d.graceful;
  $('sch-note').hidden=Boolean(g?.available);
  if(g&&!g.available)$('sch-note').textContent=`The server cannot be asked to save right now (${g.reason}). Restarts still happen, but warnings may not reach players and play since the last save is lost.`;
  $('sch-next').textContent=until(d.next.restart?.at);$('sch-wipe').textContent=until(d.next.wipe?.at);
  $('sch-last').textContent=d.lastWipe?span(serverNow()-d.lastWipe.at):'–';
  $('sch-done').textContent=String(d.history.filter(h=>h.outcome==='done').length);
  $('sch-zone-now').textContent=`${d.timeZone} · now ${d.nowLocal}`;
  $('sch-w-rule').textContent=d.schedule.wipe.enabled?`${d.rule}. Archived to backups before the server starts again.`:'Off. Turn it on to wipe on a rule like the first Thursday of each month.';
  const facts=[['Restart',d.next.restart?.local??'none scheduled'],['Wipe',d.next.wipe?`${d.next.wipe.local} (${WIPE[d.next.wipe.type].toLowerCase()})`:'none scheduled'],['Last wipe',d.lastWipe?`${new Date(d.lastWipe.at).toLocaleDateString()} (${WIPE[d.lastWipe.type].toLowerCase()})`:'never']];
  $('sch-coming').replaceChildren(...facts.flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]));
  $('sch-table').tBodies[0].replaceChildren(...d.history.slice(0,30).map(h=>{const [word,cls]=OUTCOME[h.outcome]??[h.outcome,''];return el('tr',{},
   el('td',{class:'id',text:new Date(h.at).toLocaleString()}),el('td',{},el('span',{class:'name',text:what(h)}),h.archive?el('span',{class:'sub',text:h.archive}):null),
   el('td',{text:h.by==='schedule'?'Schedule':h.by==='website'?'Website':'You'}),el('td',{},el('span',{class:'tag '+cls,text:word})),el('td',{class:'muted',text:h.note??''}));}));
  $('sch-empty').hidden=d.history.length>0;
  if(!dirty)fill(d.schedule);
  renderPending();
 }
 async function load(){
  try{render(await api('/api/schedule'));}catch(e){if(e.message!=='sign-in')toast('Could not load the schedule: '+e.message,'error');}
 }
 $('sch-form').addEventListener('input',()=>{dirty=true;});
 $('sch-w-every').addEventListener('change',every);
 // Turning wipes on, or changing what or when they wipe, is confirmed here first; the host refuses it otherwise (428).
 const rule=r=>r.every==='month'?`${NTH.find(n=>n[0]===r.nth)?.[1]} ${WEEKDAYS.find(w=>w[0]===r.weekday)?.[1]} of each month at ${r.time}`:`every ${r.n} ${r.every} from ${r.from} at ${r.time}`;
 $('sch-form').addEventListener('submit',async e=>{
  e.preventDefault();const err=$('sch-err');err.hidden=true;
  const schedule=read(),w=schedule.wipe,old=data?.schedule?.wipe;
  const confirmWipe=w.enabled&&(!old?.enabled||old.type!==w.type||JSON.stringify(old.rule)!==JSON.stringify(w.rule));
  if(confirmWipe&&!await confirmDialog('Wipe on this schedule?',`${rule(w.rule)}, ${WIPE_WHAT[w.type]} is moved to the backups folder and the server starts fresh. Players are warned first.`,'Turn on wipes'))return;
  try{const d=await api('/api/schedule/save',{method:'POST',body:{schedule,confirmWipe}});dirty=false;render({...d,graceful:data?.graceful});toast('Schedule saved');}
  catch(x){if(x.message==='sign-in')return;err.hidden=false;err.textContent=x.message;}
 });
 $('sch-now').addEventListener('submit',async e=>{
  e.preventDefault();
  const minutes=Number($('sch-now-min').value),wipe=$('sch-now-wipe').value||null,when=minutes?`in ${minutes} minute${minutes===1?'':'s'}`:'now';
  const ok=wipe?await confirmDialog(`${WIPE[wipe]} ${when}?`,`The server restarts ${when}. ${WIPE_WHAT[wipe][0].toUpperCase()+WIPE_WHAT[wipe].slice(1)} is moved to the backups folder (kept, not deleted) and the server starts fresh.`,WIPE[wipe])
   :await confirmDialog(`Restart ${when}?`,minutes?`Players are warned in chat, then the server saves, quits and starts again ${when}.`:'The server saves, quits and starts again now. Players get no warning.','Restart');
  if(!ok)return;
  try{render({...await api('/api/schedule/restart-in',{method:'POST',body:{minutes,wipe,confirm:Boolean(wipe)}}),graceful:data?.graceful});toast(`${wipe?WIPE[wipe]:'Restart'} ${when}`);}
  catch(x){if(x.message!=='sign-in')toast(x.message,'error');}
 });
 $('sch-cancel').addEventListener('click',async()=>{
  try{render({...await api('/api/schedule/cancel',{method:'POST',body:{}}),graceful:data?.graceful});toast('Cancelled. Players who were warned are told.');}
  catch(x){if(x.message!=='sign-in')toast(x.message,'error');}
 });
 return {
  show(){visible=true;load();clearInterval(timer);clearInterval(tickTimer);timer=setInterval(()=>{if(visible&&!document.hidden)load();},5000);tickTimer=setInterval(()=>{if(visible)renderPending();},1000);},
  hide(){visible=false;clearInterval(timer);clearInterval(tickTimer);},
 };
}
