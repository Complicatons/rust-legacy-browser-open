// Player history (central GET /admin/servers/{id}/player-history through the host app key): the Players page's recent
// players table, and a side panel for one player opened from any name on that page: first and last seen, play time,
// names on this server, flags by kind, bans, kicks and in-game actions, reports against them.
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const ACTION_WORDS={'admin.kick':'Kicked','admin.ban':'Banned','admin.unban':'Unbanned','admin.command':'In-game action','admin.report-resolved':'Report resolved','admin.report-dismissed':'Report dismissed',
 'admin.hold-cleared':'Hold cleared','anticheat.screenshot-request':'Screenshot asked for','link-removed':'Unlinked'};
const dur=ms=>{if(ms==null)return '–';const m=Math.round(ms/60e3);if(m<60)return m+'m';const h=Math.floor(m/60);return h<48?`${h}h ${String(m%60).padStart(2,'0')}m`:`${Math.floor(h/24)}d ${h%24}h`;};

export function createPlayerHistory({api,span,serverNow,go,kindWord=k=>k}){
 const date=t=>t?new Date(t).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'–';
 const ago=t=>t?span(serverNow()-t)+' ago':'–';
 const dlg=$('history');let current=null;
 $('hi-close').addEventListener('click',()=>dlg.close());
 dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close();}); // the backdrop
 const kindTag=k=>el('span',{class:'tag '+(k==='desktop'?'desktop':'browser'),text:k});
 // A name that opens the panel; keeps the table's name style.
 const nameButton=p=>el('button',{class:'linkish name',type:'button',text:p.name??p.handle??'?',onclick:()=>open(p)});

 const section=(title,...body)=>el('section',{class:'hi-sec'},el('h3',{class:'mono',text:title}),...body);
 const list=(items,empty)=>items.length?el('ol',{class:'event-list'},...items):el('p',{class:'muted small',text:empty});
 async function open(p){
  current=p;
  $('hi-h').textContent=p.name??p.handle??'Player';$('hi-kind').textContent='Player history';
  $('hi-body').replaceChildren(el('p',{class:'empty muted',text:'Loading…'}));
  if(!dlg.open)dlg.showModal();
  let h;
  try{h=await api('/api/central/player-history?'+(p.player?'player='+p.player:'handle='+encodeURIComponent(p.handle)));}
  catch(e){if(current===p)$('hi-body').replaceChildren(el('p',{class:'empty muted',text:e.status===404?'This server has no history for that player yet.':e.status===428?'Save the host app key on the Accounts page first.':'Could not load the history: '+e.message}));return;}
  if(current!==p)return;
  $('hi-h').textContent=h.player.name??p.name;
  $('hi-kind').textContent=h.player.handle?'Desktop character, no website account':'Website account';
  const flagMax=Math.max(1,...h.flags.kinds.map(k=>k.count));
  $('hi-body').replaceChildren(...[
   el('div',{class:'hi-tags'},...h.kinds.map(kindTag),h.online?el('span',{class:'tag browser',text:'online now'}):null,h.bans.some(b=>b.active)?el('span',{class:'tag bad',text:'banned'}):null,h.desktopLink?el('span',{class:'tag',text:'desktop linked '+date(h.desktopLink.linkedAt)}):null),
   el('div',{class:'stats hi-stats'},
    el('div',{class:'stat'},el('b',{text:h.firstSeen?span(serverNow()-h.firstSeen):'–'}),el('span',{text:'since first seen'})),
    el('div',{class:'stat'},el('b',{text:h.lastSeen?(serverNow()-h.lastSeen<120e3?'now':span(serverNow()-h.lastSeen)):'–'}),el('span',{text:'since last seen'})),
    el('div',{class:'stat'},el('b',{text:dur(h.playTimeMs)}),el('span',{text:'play time'})),
    el('div',{class:'stat'},el('b',{text:h.sessions??'–'}),el('span',{text:'sessions'}))),
   h.sessions==null?el('p',{class:'muted small',text:'Play time is counted for website accounts. A desktop character without one shows when the server plugin listed it.'}):null,
   section('Names on this server',list(h.names.map(n=>el('li',{},el('time',{text:ago(n.lastSeen)}),el('span',{},el('b',{text:n.name}),` · ${n.kind} · first ${date(n.firstSeen)}`))),'No in-game names recorded yet.')),
   section(`Flags · ${h.flags.total}`,h.flags.kinds.length?el('ul',{class:'hi-flags'},...h.flags.kinds.map(k=>{const bar=el('i');bar.style.setProperty('--fill',String(k.count/flagMax));
    return el('li',{},el('span',{text:kindWord(k.kind)}),el('span',{class:'bar'},bar),el('b',{text:String(k.count)}),el('span',{class:'sev'+(k.maxSeverity>=40?' hi':k.maxSeverity>=20?' mid':''),text:'max '+k.maxSeverity}));})):el('p',{class:'muted small',text:'No anti-cheat flags.'}),
    h.flags.total?el('button',{class:'btn small',type:'button',text:'Evidence',onclick:()=>{dlg.close();go('anticheat',h.player.player?{player:h.player.player,name:h.player.name}:{handle:h.player.handle,name:h.player.name});}}):null),
   section('Bans',list(h.bans.map(b=>el('li',{'data-level':b.active?'error':'info'},el('time',{text:ago(b.createdAt)}),el('span',{text:`${b.active?'Active':b.revokedAt?'Lifted':'Ended'} · ${b.reason} · ${b.expiresAt?'until '+date(b.expiresAt):'permanent'}${b.scope==='global'?' · network-wide':''}${b.createdBy?' · by '+b.createdBy:''}`}))),'Never banned here.')),
   section('Kicks and actions',h.moderation==null?el('p',{class:'muted small',text:'Only admins and the owner see the audit log.'}):
    list(h.moderation.map(m=>el('li',{},el('time',{text:ago(m.at)}),el('span',{text:`${ACTION_WORDS[m.action]??m.action}${m.command?' ('+m.command.replace(/-/g,' ')+')':''}${m.reason?' · '+m.reason:''} · ${m.actorName??'?'}${m.via==='host'?' (host app)':''}`}))),'No kicks, bans or in-game actions.')),
   section('Reports against them',list(h.reports.map(r=>el('li',{'data-level':r.status==='open'?'warn':'info'},el('time',{text:ago(r.at)}),el('span',{text:`${r.reason==='in-game'?'in game':r.reason} · by ${r.reporterName} · ${r.status}${r.detail?' · '+r.detail:''}`}))),'No reports.')),
   h.recentSessions.length?section('Recent sessions',list(h.recentSessions.map(s=>el('li',{},el('time',{text:ago(s.lastSeen)}),el('span',{text:`${date(s.startedAt)} · ${dur(s.lastSeen-s.startedAt)}`}))),'')):null].filter(Boolean));
 }

 // Players page: the server's recent players, accounts and desktop characters.
 async function loadRecent(){
  let r;try{r=await api('/api/central/player-history');}catch{return;}
  $('pl-recent').tBodies[0].replaceChildren(...r.players.slice(0,50).map(p=>el('tr',{},
   el('td',{},nameButton(p),p.online?el('span',{class:'sub',text:'online now'}):null),
   el('td',{},kindTag(p.handle?'desktop':'browser')),
   el('td',{class:'id',text:p.online?'now':ago(p.lastSeen)}),
   el('td',{class:'id',text:p.playTimeMs==null?'–':dur(p.playTimeMs)+(p.sessions?` · ${p.sessions} session${p.sessions>1?'s':''}`:'')}),
   el('td',{class:'id',text:p.flags==null?'–':String(p.flags)}))));
  $('pl-recent-empty').hidden=r.players.length>0;
 }
 return {open,nameButton,loadRecent};
}
