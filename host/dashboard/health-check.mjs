// Overview card: the config health check (GET /api/health-check: the last run; POST: run now). Problems first, each
// with its fix; the full list folds open. Runs once by itself the first time the Overview shows.
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const ORDER={FAIL:0,WARN:1,PASS:2,SKIP:3},WORD={PASS:'Pass',WARN:'Warn',FAIL:'Fail',SKIP:'n/a'};

export function createHealthCard({api,toast,span,serverNow}){
 let ran=false,busy=false;
 const card=$('health-card');
 const sum=el('p',{class:'hc-sum mono',id:'hc-sum','aria-live':'polite',text:'Not run yet'});
 const btn=el('button',{class:'btn small',type:'button',id:'hc-run',text:'Run checks',onclick:()=>run()});
 const problems=el('ul',{class:'hc-list',id:'hc-problems'}),all=el('ul',{class:'hc-list'});
 const more=el('details',{class:'hc-all'},el('summary',{class:'mono',text:'All checks'}),all);
 card.replaceChildren(el('header',{class:'panel-h'},el('h2',{class:'mono',id:'hc-h',text:'Health check'}),el('div',{class:'row'},sum,btn)),problems,more);
 const rowEl=r=>el('li',{'data-status':r.status},el('span',{class:'hc-tag',text:WORD[r.status]??r.status}),
  el('div',{},el('b',{text:r.label}),el('p',{text:r.detail}),r.fix?el('p',{class:'hc-fix',text:r.fix}):null));
 function render(r){
  if(!r){sum.textContent='Not run yet';problems.replaceChildren(el('li',{class:'empty muted',text:'Checks ports, the firewall, the server program, our adapter, the website, certificates, disk, backups and the clock.'}));all.replaceChildren();return;}
  const s=r.summary;
  sum.replaceChildren(...[['FAIL',s.fail],['WARN',s.warn],['PASS',s.pass]].filter(([,n])=>n).map(([k,n])=>el('span',{class:'hc-count','data-status':k,text:`${n} ${WORD[k].toLowerCase()}`})),el('span',{class:'muted',text:serverNow()-r.at<10e3?' · just now':' · '+span(serverNow()-r.at)+' ago'}));
  const rows=[...r.rows].sort((a,b)=>ORDER[a.status]-ORDER[b.status]);
  const bad=rows.filter(x=>x.status==='FAIL'||x.status==='WARN');
  problems.replaceChildren(...(bad.length?bad.map(rowEl):[el('li',{class:'empty hc-ok',text:'Everything checked is fine.'})]));
  all.replaceChildren(...rows.map(rowEl));
 }
 async function run(){
  if(busy)return null;busy=true;btn.setAttribute('aria-busy','true');
  try{const r=await api('/api/health-check',{method:'POST'});render(r);return r;}
  catch(e){if(e.message!=='sign-in')toast('The health check could not run: '+e.message,'error');return null;}
  finally{busy=false;btn.removeAttribute('aria-busy');}
 }
 return {
  // The boot screen (boot.mjs) runs the check itself and this card shows its result; the card waits for it.
  async run(){ran=true;return run();},
  async show(){
   if(ran||document.documentElement.dataset.booting)return;ran=true;
   try{const last=await api('/api/health-check');if(last)render(last);else run();}catch{}
  },
  hide(){},
 };
}
