// Leaderboards (/leaderboard) and public player profiles (/players/<name>) over central/stats.mjs. Boards, server and
// period live in the URL query so a view can be shared.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {BOARDS,PERIODS,boardOf,formatValue,subLabel,boardQuery,readQuery,profileTiles,breakdown} from './leaderboard-view.mjs';
import {dateLabel} from './forum-view.mjs';

const main=document.querySelector('#lb-main'),profile=document.body.dataset.page==='player';
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v===true?'':v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const show=(...kids)=>main.replaceChildren(...kids.flat().filter(x=>x!=null&&x!==false));
const stat=(n,label)=>el('div',{class:'stat'},el('b',{text:String(n)}),el('span',{class:'mono',text:label}));
const chip=(text,pressed,onclick)=>el('button',{class:'chip',type:'button','aria-pressed':String(pressed),text,onclick});
let state=readQuery(location.search),servers=[];

function filters(){
 const select=el('select',{class:'lb-server','aria-label':'Server',onchange:e=>go({...state,server:e.target.value})},
  el('option',{value:'',text:'All servers'}),servers.map(s=>el('option',{value:s.id,text:s.name})));
 select.value=state.server;
 return el('div',{class:'lb-filters'},select,el('div',{class:'chips',role:'group','aria-label':'Period'},PERIODS.map(([id,label])=>chip(label,state.period===id,()=>go({...state,period:id})))));
}
function go(next){state=next;history.replaceState(null,'',location.pathname+(profile?boardQuery({...next,board:'playtime'}):boardQuery(next)));render();}
const scope=()=>{const q=new URLSearchParams();if(state.server)q.set('server',state.server);if(state.period!=='all')q.set('period',state.period);return q;};

async function board(){
 const q=scope();q.set('board',state.board);if(state.species)q.set('species',state.species);
 const d=await api('GET','/leaderboard/api/boards?'+q),b=boardOf(d.board);
 document.title='Leaderboard · Rust Legacy Browser';
 show(
  el('header',{class:'lb-hero'},el('h1',{class:'h',text:'Leaderboard'}),el('div',{class:'stats lb-stats'},stat(d.totals.players,'Players'),stat(formatValue(b.id,d.totals.value),b.unit))),
  el('nav',{class:'lb-boards',role:'tablist','aria-label':'Boards'},BOARDS.map(x=>el('button',{type:'button',role:'tab','aria-selected':String(x.id===b.id),class:'lb-board',text:x.label,onclick:()=>go({...state,board:x.id,species:''})}))),
  filters(),
  b.id==='animals'&&d.speciesList?.length?el('div',{class:'chips lb-species',role:'group','aria-label':'Species'},chip('Every animal',!state.species,()=>go({...state,species:''})),
   d.speciesList.map(s=>chip(subLabel(s.id),state.species===s.id,()=>go({...state,species:s.id})))):null,
  d.rows.length?el('ol',{class:'lb-rows'},d.rows.map(r=>el('li',{class:'lb-row'+(r.rank<=3?' top':'')},
   el('span',{class:'lb-rank mono',text:String(r.rank)}),
   r.profile?el('a',{class:'lb-name',href:'/players/'+encodeURIComponent(r.profile),text:r.name}):el('span',{class:'lb-name',text:r.name}),
   el('span',{class:'lb-value'},el('b',{text:formatValue(b.id,r.value)}),el('span',{class:'mono',text:b.unit})))))
  :el('div',{class:'pending'},el('b',{text:'No scores yet'}),el('span',{text:'Play on a server to get on the board.'})));
}

async function player(){
 const name=decodeURIComponent(location.pathname.split('/')[2]??'');
 const d=await api('GET',`/leaderboard/api/players/${encodeURIComponent(name)}?${scope()}`),s=d.stats;
 document.title=`${d.name} · Rust Legacy Browser`;
 const list=(title,rows)=>rows.length?el('section',{class:'lb-break'},el('h2',{class:'mono',text:title}),el('dl',{},rows.map(([k,v])=>el('div',{},el('dt',{text:k}),el('dd',{class:'mono',text:v}))))):null;
 show(
  el('nav',{class:'crumbs mono','aria-label':'Breadcrumb'},el('a',{href:'/leaderboard',text:'Leaderboard'}),el('span',{text:d.name})),
  el('header',{class:'lb-hero'},el('div',{},el('h1',{class:'h',text:d.name}),el('p',{class:'mono muted',text:'Joined '+dateLabel(d.joinedAt)}))),
  filters(),
  el('div',{class:'stats lb-tiles'},profileTiles(s).map(([v,l])=>stat(v,l))),
  el('div',{class:'lb-breaks'},list('Animals',breakdown(s.animal)),list('Gathered',breakdown(s.gather)),list('Built',breakdown(s.build))));
}

async function render(){
 try{await (profile?player:board)();}
 catch(e){show(el('div',{class:'pending'},el('b',{text:e.status===404?'Not found':'Leaderboard offline'}),
  el('span',{text:e.status===404?'No public player has that name.':explain(e.code)}),el('a',{class:'btn small',href:'/leaderboard',text:'Leaderboard'})));}
 finally{main.removeAttribute('aria-busy');document.body.dataset.ready='1';}
}
await loadSession();
servers=(await api('GET','/servers').catch(()=>({servers:[]}))).servers??[];
await render();
