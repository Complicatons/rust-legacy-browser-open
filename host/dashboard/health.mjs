// Health page (host/metrics.mjs, GET /api/metrics?range=24h|7d): big-number stats and one small chart per measure,
// hand-drawn SVG, on one shared time axis. A crosshair follows the pointer (or the arrow keys) across every chart at once
// and reads out every series at that minute; freezes and restarts are marked on every chart. One y axis per chart, two
// series only where they share a unit (with a legend). Chart colours: orange and a teal step that passes the
// colour-vision checks on the panel surface (the dashboard's teal reads too grey for a data line).
const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const svg=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))if(v!=null)e.setAttribute(k,v);return e;};
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const C1='#cd5a28',C2='#2a9d8f';
const CHARTS=[
 {id:'players',title:'Players',unit:'',series:[{k:'players',name:'in game',c:C1,area:true},{k:'sessions',name:'browser sessions',c:C2}]},
 {id:'cpu',title:'Game server CPU',unit:'%',note:'% of one core',series:[{k:'cpu',name:'CPU',c:C1,area:true}]},
 {id:'mem',title:'Game server memory',unit:' MB',series:[{k:'memMb',name:'memory',c:C1,area:true}]},
 {id:'rtt',title:'Response time',unit:' ms',series:[{k:'udpMs',name:'game server (UDP)',c:C1},{k:'gwMs',name:'gateway',c:C2}]},
 {id:'errors',title:'Error lines in the logs',unit:'',series:[{k:'errors',name:'errors',c:C1,area:true}]},
];
const H=168,M={l:46,r:14,t:14,b:24};
const pad=n=>String(n).padStart(2,'0');
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const hm=t=>{const d=new Date(t);return `${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const dayLabel=t=>{const d=new Date(t);return `${DAYS[d.getDay()]} ${d.getDate()}`;};
const fmt=(v,unit='')=>v==null?'–':unit===' MB'&&v>=1000?(v/1024).toFixed(v>=10240?0:1)+' GB':(Math.abs(v)>=1000?(v/1000).toFixed(v>=10000?0:1)+'K':String(Math.round(v*10)/10))+unit;
// A clean axis top: 1, 2 or 5 times a power of ten, at or above the largest value.
function niceMax(v){if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v)),m=v/p;return (m<=1?1:m<=2?2:m<=5?5:10)*p;}

export function createHealthPage({api,toast,span}){
 let data=null,range='24h',visible=false,timer=null,cursor=null,built=false;const charts=[];
 const box=$('hl-charts');

 function build(){
  if(built)return;built=true;
  for(const def of CHARTS){
   const legend=def.series.length>1?el('ul',{class:'legend'},...def.series.map(s=>{const li=el('li',{},el('i',{class:'key'}),s.name);li.firstChild.dataset.c=s.c===C1?'1':'2';return li;})):el('p',{class:'mono muted',text:def.note??''});
   const plot=el('div',{class:'plot',tabindex:'0',role:'img','aria-label':def.title});
   const tip=el('div',{class:'tip',hidden:''});
   const panel=el('section',{class:'panel chart','aria-label':def.title},el('header',{class:'panel-h'},el('h2',{class:'mono',text:def.title}),legend),plot,tip);
   box.append(panel);
   const c={def,plot,tip,svg:null,w:0};charts.push(c);
   plot.addEventListener('pointermove',e=>{if(!data)return;const r=plot.getBoundingClientRect(),x=e.clientX-r.left;setCursor(indexAt(x,c.w),c);});
   plot.addEventListener('pointerleave',()=>setCursor(null));
   plot.addEventListener('focus',()=>{if(data&&cursor==null)setCursor(lastIndex(),c);});
   plot.addEventListener('blur',()=>setCursor(null));
   plot.addEventListener('keydown',e=>{
    if(!data)return;const n=data.series.players.length;let i=cursor??lastIndex();
    const step={ArrowLeft:-1,ArrowRight:1,PageUp:-60,PageDown:60}[e.key];
    if(step)i=Math.max(0,Math.min(n-1,i+(e.shiftKey?step*10:step)));else if(e.key==='Home')i=0;else if(e.key==='End')i=lastIndex();else return;
    e.preventDefault();setCursor(i,c);
   });
  }
  new ResizeObserver(()=>{if(visible)draw();}).observe(box);
 }
 const lastIndex=()=>{if(!data)return 0;const i=Math.floor((data.now-data.from)/data.step);return Math.max(0,Math.min(data.series.players.length-1,i));};
 const xOf=(i,w)=>M.l+(i+0.5)/data.series.players.length*(w-M.l-M.r);
 const indexAt=(x,w)=>Math.max(0,Math.min(data.series.players.length-1,Math.floor((x-M.l)/(w-M.l-M.r)*data.series.players.length)));

 function drawChart(c){
  const w=Math.max(280,c.plot.clientWidth);c.w=w;
  const s=svg('svg',{viewBox:`0 0 ${w} ${H}`,width:w,height:H,'aria-hidden':'true'});
  const vals=c.def.series.flatMap(x=>data.series[x.k]).filter(v=>v!=null),max=niceMax(Math.max(0,...vals)),n=data.series.players.length;
  const y=v=>M.t+(1-v/max)*(H-M.t-M.b);
  // Grid: three hairlines with clean values; time ticks every 4 hours (24 h) or each midnight (7 days).
  for(const v of [0,max/2,max]){s.append(svg('line',{class:'grid',x1:M.l,x2:w-M.r,y1:y(v),y2:y(v)}));const t=svg('text',{class:'tick',x:M.l-8,y:y(v)+4,'text-anchor':'end'});t.textContent=fmt(v,c.def.unit===' MB'?' MB':'');s.append(t);}
  const every=data.range==='24h'?4*3600e3:86400e3;
  for(let t=Math.ceil(data.from/every)*every;t<data.to;t+=every){
   const local=data.range==='24h'?t:new Date(new Date(t).toDateString()).getTime();if(local<data.from)continue;
   const x=xOf((local-data.from)/data.step-0.5,w);const tx=svg('text',{class:'tick',x,y:H-6,'text-anchor':'middle'});tx.textContent=data.range==='24h'?hm(local):dayLabel(local);s.append(tx);
  }
  // Freeze and restart markers on every chart, so a spike can be read against them.
  for(const e of data.events){const x=xOf(Math.floor((e.t-data.from)/data.step),w);s.append(svg('line',{class:'mark '+e.kind,x1:x,x2:x,y1:M.t,y2:H-M.b}));
   s.append(e.kind==='freeze'?svg('path',{class:'mark-g freeze',d:`M${x-5} ${M.t-2}h10l-5 8z`}):svg('circle',{class:'mark-g restart',cx:x,cy:M.t+2,r:4}));}
  // Lines (2 px) with gaps where nothing was recorded; a 10% wash under the first series.
  for(const ser of c.def.series){
   const arr=data.series[ser.k];let d='',area='',run=[];
   const close=()=>{if(run.length){area+=`M${run[0][0]} ${y(0)}L${run.map(p=>p.join(' ')).join('L')}L${run.at(-1)[0]} ${y(0)}Z`;run=[];}};
   for(let i=0;i<n;i++){const v=arr[i];if(v==null){close();continue;}const p=[xOf(i,w).toFixed(1),y(v).toFixed(1)];d+=(run.length?'L':'M')+p.join(' ');run.push(p);}
   close();
   if(ser.area&&area)s.append(svg('path',{class:'area',d:area,fill:ser.c}));
   if(d)s.append(svg('path',{class:'line',d,stroke:ser.c}));
   // A lone minute between gaps still shows: a dot.
   for(let i=0;i<n;i++)if(arr[i]!=null&&arr[i-1]==null&&arr[i+1]==null)s.append(svg('circle',{class:'dot',cx:xOf(i,w),cy:y(arr[i]),r:3,fill:ser.c}));
  }
  const hair=svg('line',{class:'hair',x1:0,x2:0,y1:M.t,y2:H-M.b,visibility:'hidden'});s.append(hair);
  c.dots=c.def.series.map(ser=>{const d=svg('circle',{class:'cursor-dot',r:4,fill:ser.c,visibility:'hidden'});s.append(d);return d;});
  c.hair=hair;c.y=y;
  if(!vals.length){const t=svg('text',{class:'none',x:w/2,y:H/2,'text-anchor':'middle'});t.textContent='No readings in this range';s.append(t);}
  c.plot.replaceChildren(s);c.svg=s;
  c.plot.setAttribute('aria-label',`${c.def.title}: ${c.def.series.map(x=>{const v=data.series[x.k].filter(v=>v!=null);return v.length?`${x.name} highest ${fmt(Math.max(...v),c.def.unit)}, latest ${fmt(v.at(-1),c.def.unit)}`:`${x.name} no readings`;}).join('; ')}. Use the arrow keys to read values.`);
 }
 function setCursor(i,active){
  cursor=i;
  for(const c of charts){
   if(!c.svg)continue;
   if(i==null){c.hair.setAttribute('visibility','hidden');c.dots.forEach(d=>d.setAttribute('visibility','hidden'));c.tip.hidden=true;continue;}
   const x=xOf(i,c.w);c.hair.setAttribute('x1',x);c.hair.setAttribute('x2',x);c.hair.setAttribute('visibility','visible');
   c.def.series.forEach((ser,k)=>{const v=data.series[ser.k][i],d=c.dots[k];if(v==null){d.setAttribute('visibility','hidden');return;}d.setAttribute('cx',x);d.setAttribute('cy',c.y(v));d.setAttribute('visibility','visible');});
   // One read-out, in the chart the reader is on: the time, every series' value, and any freeze or restart then.
   if(c!==active){c.tip.hidden=true;continue;}
   const t0=data.from+i*data.step,evs=data.events.filter(e=>e.t>=t0&&e.t<t0+data.step);
   c.tip.replaceChildren(el('p',{class:'when',text:data.step===60e3?`${dayLabel(t0)} ${hm(t0)}`:`${dayLabel(t0)} ${hm(t0)}–${hm(t0+data.step)}`}),
    ...c.def.series.map(ser=>{const r=el('p',{class:'row'},el('b',{text:fmt(data.series[ser.k][i],c.def.unit)}),el('span',{text:ser.name}));const k=el('i',{class:'key'});k.dataset.c=ser.c===C1?'1':'2';r.prepend(k);return r;}),
    ...evs.map(e=>el('p',{class:'ev '+e.kind,text:e.kind==='freeze'?'Freeze caught, server restarted':'Restart'})));
   c.tip.hidden=false;
   const left=Math.min(Math.max(0,x+12),c.w-c.tip.offsetWidth-4);c.tip.style.left=(x+12+c.tip.offsetWidth>c.w?x-12-c.tip.offsetWidth:left)+'px';
  }
 }
 function draw(){if(!data)return;for(const c of charts)drawChart(c);if(cursor!=null)setCursor(cursor,charts.find(c=>c.plot===document.activeElement||c.plot.matches(':hover')));}

 function renderStats(){
  const s=data.stats;
  $('hl-eyebrow').textContent=range==='24h'?'Last 24 hours':'Last 7 days';
  $('hl-peak').textContent=s.peakPlayers??'–';$('hl-peak-l').textContent=s.peakAt?`peak players · ${range==='24h'?hm(s.peakAt):dayLabel(s.peakAt)+' '+hm(s.peakAt)}`:'peak players';
  $('hl-up').textContent=s.uptimePct==null?'–':s.uptimePct+'%';$('hl-freezes').textContent=String(s.freezes);$('hl-restarts').textContent=String(s.restarts);$('hl-errors').textContent=fmt(s.errors);
  const note=$('hl-note');
  if(data.demoUntil&&data.demoUntil>=data.from){note.hidden=false;note.textContent=`Demo data up to ${dayLabel(data.demoUntil)} ${hm(data.demoUntil)}: made up by the demo so the graphs have something to show. Real readings follow, one a minute.`;}
  else if(!s.minutes){note.hidden=false;note.textContent='No readings yet. The host records one a minute while it runs, and keeps 7 days.';}
  else note.hidden=true;
 }
 // The same numbers without the charts: an hour (24 h) or a day (7 days) a row.
 function renderTable(){
  const per=range==='24h'?60:144,n=data.series.players.length,rows=[];
  for(let i=0;i<n;i+=per){
   const slice=k=>data.series[k].slice(i,i+per).filter(v=>v!=null),mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,sum=a=>a.reduce((x,y)=>x+y,0);
   const t=data.from+i*data.step,up=slice('up');
   if(!up.length&&!slice('players').length)continue;
   rows.push([`${dayLabel(t)} ${hm(t)}`,fmt(slice('players').length?Math.max(...slice('players')):null),fmt(mean(slice('cpu')),'%'),fmt(mean(slice('memMb')),' MB'),fmt(mean(slice('udpMs')),' ms'),String(sum(slice('errors'))),String(sum(slice('freezes'))),String(sum(slice('restarts'))),up.length?Math.round(mean(up)*1000)/10+'%':'–']);
  }
  const t=$('hl-table');
  t.tHead.replaceChildren(el('tr',{},...[range==='24h'?'Hour from':'24 hours from','Peak players','CPU','Memory','UDP reply','Errors','Freezes','Restarts','Uptime'].map(h=>el('th',{scope:'col',text:h}))));
  t.tBodies[0].replaceChildren(...rows.reverse().map(r=>el('tr',{},...r.map((v,i)=>el('td',{class:i?'id':'name',text:v})))));
 }
 async function load(){
  try{data=await api('/api/metrics?range='+range);}catch(e){if(e.message!=='sign-in')toast('Could not load the health readings: '+e.message,'error');return;}
  if(!visible)return;
  renderStats();draw();renderTable();
 }
 for(const b of document.querySelectorAll('.range [data-range]'))b.addEventListener('click',()=>{
  range=b.dataset.range;for(const x of document.querySelectorAll('.range [data-range]'))x.setAttribute('aria-pressed',String(x===b));cursor=null;load();
 });
 return {
  show(){visible=true;build();load();clearInterval(timer);timer=setInterval(()=>{if(visible&&!document.hidden)load();},60e3);},
  hide(){visible=false;clearInterval(timer);},
 };
}
