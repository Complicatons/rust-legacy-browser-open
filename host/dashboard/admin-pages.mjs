// Players and Anti-cheat pages (HOST-APP-PLAN.md slice 4): central's admin routes for this server through the host
// app key (GET|POST /api/central/<route>). The same actions and rules as the website's admin page: the owner acts, and
// every action is audited (marked "via host"). Names on the Players page open the player's history (player-history.mjs).
import {createPlayerHistory} from './player-history.mjs';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v!=null&&v!==false)e.setAttribute(k,v);}e.append(...kids.flat().filter(x=>x!=null&&x!==false));return e;};
const REVIEW=50,KICK=150;
// central/admin.mjs error codes in the owner's words.
const ERRORS={'server-offline':'The server is not reporting to your website right now (is the gateway running?).','reason-required':'Give a reason; it goes in the audit log.',
 'message-required':'Write the message first.','cannot-target-self':'That is your own account.','target-outranks-you':'That account ranks at or above you on this server.',
 'unknown-player':'That player is no longer on the server.','insufficient-role':'Your role on this server does not allow that.','already-revoked':'That ban was already lifted.',
 'already-resolved':'Someone already handled that report.','no host app key yet':'Save the host app key on the Accounts page first.'};
const explain=e=>ERRORS[e.message]??e.message;
const KIND_WORDS={speed:'Too fast',teleport:'Teleport',fly:'Flying','under-terrain':'Under the ground','fire-rate':'Firing too fast','pellet-count':'Too many pellets','no-reload':'No reload',
 'hit-range':'Hit out of range','headshot-ratio':'Head-shot ratio','command-flood':'Command flood','wall-shot':'Shot through a wall','wall-use':'Used through a wall',noclip:'Through a wall','yaw-snap':'Aim snap','command-rate':'Actions too fast',hover:'Hovering'};
const kindWord=k=>KIND_WORDS[k]??k;

// One dialog for every in-game action. kind decides the fields; resolves with the request to send, or null.
const ACTIONS={
 message:{title:'Message',verb:'Send',text:p=>`Only ${p.name} sees this, in the game chat.`,msg:true},
 'teleport-to':{title:'Go to player',verb:'Go',text:p=>`Your own character, on this server, is moved to ${p.name}. You must be in the game.`},
 bring:{title:'Bring player',verb:'Bring',text:p=>`${p.name} is moved to your character. You must be in the game.`},
 kick:{title:'Kick',verb:'Kick',text:p=>`${p.name} is disconnected and can join again.`,reason:true},
 ban:{title:'Ban',verb:'Ban',text:p=>`${p.name} is kicked and cannot join this server${p.handle?'':' with this website account, or with the devices and identities linked to it'}.`,reason:true,duration:true,native:p=>!p.handle},
 screenshot:{title:'Screenshot',verb:'Take it',text:p=>`Asks ${p.name}'s game for a picture of their screen. It appears under Anti-cheat when it arrives.`},
};
function requestFor(kind,p,form){
 if(kind==='kick'&&!p.handle)return ['kick',{player:p.player,reason:form.reason}];
 if(kind==='ban'&&!p.handle)return ['bans',{player:p.player,reason:form.reason,minutes:form.minutes,...(form.native?{native:true}:{})}];
 if(kind==='screenshot')return ['screenshot',{player:p.player}];
 const action=kind==='kick'?'kick-native':kind==='ban'?'ban-native':kind;
 return ['command',{action,...(p.handle&&!p.player?{handle:p.handle}:{player:p.player}),...(form.reason?{reason:form.reason}:{}),...(form.message?{message:form.message}:{})}];
}
function askAction(kind,p){
 const a=ACTIONS[kind],dlg=$('act');
 $('act-h').textContent=`${a.title}: ${p.name}`;$('act-text').textContent=a.text(p);$('act-ok').textContent=a.verb;
 $('act-ok').className='btn '+(kind==='kick'||kind==='ban'?'danger':'primary');
 $('act-msg-f').hidden=!a.msg;$('act-reason-f').hidden=!a.reason;$('act-dur-f').hidden=!a.duration||Boolean(p.handle);$('act-native-f').hidden=!a.native?.(p);
 $('act-msg').required=Boolean(a.msg);$('act-reason').required=Boolean(a.reason);
 $('act-msg').value='';$('act-reason').value='';$('act-dur').value='1440';$('act-native').checked=false;
 dlg.showModal();
 return new Promise(res=>{dlg.onclose=()=>res(dlg.returnValue==='ok'?{message:$('act-msg').value.trim(),reason:$('act-reason').value.trim(),minutes:$('act-dur').value?Number($('act-dur').value):null,native:$('act-native').checked}:null);});
}

export function createAdminPages({api,toast,span,clock,serverNow,go}){
 const when=t=>serverNow()-t<12*3600e3?clock(t):span(serverNow()-t)+' ago';
 const history=createPlayerHistory({api,span,serverNow,go,kindWord});
 const central=(route,body)=>api('/api/central/'+route,body?{method:'POST',body}:{});
 async function act(kind,p,after){
  const form=await askAction(kind,p);if(!form)return;
  const [route,body]=requestFor(kind,p,form);
  try{await central(route,body);toast({kick:`Kicking ${p.name}`,ban:`${p.name} is banned`,screenshot:`Screenshot requested from ${p.name}`,message:`Message sent to ${p.name}`}[kind]??`${ACTIONS[kind].title} sent; the result shows under In-game actions`);after?.();}
  catch(e){toast(explain(e),'error');}
 }
 const scoreEl=s=>{const e=el('span',{class:'score'+(s>=KICK?' kick':s>=REVIEW?' review':'')},el('i'),String(s));e.firstChild.style.setProperty('--fill',String(Math.min(1,s/KICK)));return e;};
 const kindsEl=flags=>el('span',{class:'kinds'},...Object.entries(flags??{}).filter(([,n])=>n>0).map(([k,n])=>el('span',{class:'tag warn',text:`${kindWord(k)} ${n}`})));
 const noteFor=(note,e)=>{note.hidden=false;note.textContent=e.status===428?'Players, bans and anti-cheat come from your website. Save the host app key on the Accounts page to see them here.':'Could not reach your website: '+explain(e);};

 // ---------- Players ----------
 const players={timer:null,visible:false,
  async load(){
   let r,bans,cmds;
   try{[r,bans,cmds]=await Promise.all([central('players'),central('bans'),central('commands')]);$('pl-note').hidden=true;}
   catch(e){if(e.message!=='sign-in')noteFor($('pl-note'),e);return;}
   if((players.loads=(players.loads??0)+1)%6===1)history.loadRecent(); // every 30 s; the live tables every 5 s
   $('pl-browser').textContent=String(r.players.length);$('pl-desktop').textContent=String(r.desktop.length);
   $('pl-review').textContent=String([...r.players,...r.desktop].filter(p=>p.review).length);
   $('pl-reported').textContent=r.online?`server reported ${span(serverNow()-r.reportedAt)} ago`:'server not reporting';
   if(!r.online){$('pl-note').hidden=false;$('pl-note').textContent='The server is not reporting to your website right now, so nobody shows as online and in-game actions wait. Is the gateway running?';}
   const reload=()=>players.load();
   $('pl-table').tBodies[0].replaceChildren(...r.players.map(p=>el('tr',{},
    el('td',{},history.nameButton(p),p.banned?el('span',{class:'tag bad',text:'Banned'}):null),
    el('td',{class:'id',text:p.connectedAt?span(serverNow()-p.connectedAt):'–'}),
    el('td',{},scoreEl(p.score)),el('td',{},kindsEl(p.flags)),
    el('td',{},el('div',{class:'acts'},
     el('button',{class:'btn small',type:'button',text:'Message',onclick:()=>act('message',p,reload)}),
     el('button',{class:'btn small',type:'button',text:'Go to',onclick:()=>act('teleport-to',p,reload)}),
     el('button',{class:'btn small',type:'button',text:'Bring',onclick:()=>act('bring',p,reload)}),
     el('button',{class:'btn small',type:'button',text:'Evidence',onclick:()=>go('anticheat',{player:p.player,name:p.name})}),
     el('button',{class:'btn small danger',type:'button',text:'Kick',onclick:()=>act('kick',p,reload)}),
     el('button',{class:'btn small danger',type:'button',text:'Ban',onclick:()=>act('ban',p,reload)}))))));
   $('pl-empty').hidden=r.players.length>0;
   $('pl-desk').tBodies[0].replaceChildren(...r.desktop.map(p=>el('tr',{},
    el('td',{},history.nameButton(p),p.banned?el('span',{class:'tag bad',text:'Banned'}):null),
    el('td',{text:p.account??'not linked'}),el('td',{},scoreEl(p.score)),el('td',{},kindsEl(p.flags)),
    el('td',{},el('div',{class:'acts'},
     el('button',{class:'btn small',type:'button',text:'Message',onclick:()=>act('message',p,reload)}),
     el('button',{class:'btn small',type:'button',text:'Go to',onclick:()=>act('teleport-to',p,reload)}),
     el('button',{class:'btn small',type:'button',text:'Evidence',onclick:()=>go('anticheat',{handle:p.handle,name:p.name})}),
     el('button',{class:'btn small danger',type:'button',text:'Kick',onclick:()=>act('kick',p,reload)}),
     el('button',{class:'btn small danger',type:'button',text:'Ban',onclick:()=>act('ban',p,reload)}))))));
   $('pl-desk-empty').hidden=r.desktop.length>0;
   const active=bans.bans.filter(b=>b.active);$('pl-bans-n').textContent=String(active.length);
   $('pl-bans').tBodies[0].replaceChildren(...bans.bans.slice(0,50).map(b=>el('tr',{},
    el('td',{},history.nameButton({player:b.player,name:b.name})),el('td',{text:b.reason}),el('td',{class:'id',text:b.expiresAt?new Date(b.expiresAt).toLocaleString():'permanent'}),
    el('td',{},el('span',{class:'tag'+(b.active?' bad':''),text:b.active?'Active':b.revokedAt?'Lifted':'Ended'})),
    el('td',{},b.active&&b.scope==='server'?el('button',{class:'btn small',type:'button',text:'Unban',onclick:async()=>{try{await central('unban',{ban:b.id});toast(`Ban on ${b.name} lifted`);reload();}catch(e){toast(explain(e),'error');}}}):null))));
   $('pl-bans-empty').hidden=bans.bans.length>0;
   const list=cmds.commands??[];
   $('pl-cmds').replaceChildren(...(list.length?list.slice(0,20).map(c=>el('li',{'data-level':c.status==='failed'?'error':c.status==='no-result'?'warn':'info'},el('time',{text:when(c.createdAt)}),el('span',{text:`${c.action.replace(/-/g,' ')} · ${c.name??c.handle??''} · ${c.status}${c.reason?' ('+c.reason+')':''}`}))):[el('li',{class:'empty',text:'No in-game actions yet.'})]));
  },
  show(){players.visible=true;players.loads=0;players.load();clearInterval(players.timer);players.timer=setInterval(()=>{if(players.visible&&!document.hidden)players.load();},5000);},
  hide(){players.visible=false;clearInterval(players.timer);},
 };

 // ---------- Anti-cheat ----------
 let selected=null;
 function replayPlot(samples){
  const moves=samples.filter(s=>s.kind==='move'&&Array.isArray(s.pos)),shots=samples.filter(s=>s.kind==='fire'&&Array.isArray(s.pos));
  const box=el('div',{class:'replay'},el('span',{class:'meta',text:`Replay: ${samples.length} samples over ${samples.at(-1)?.t??0} s, ${samples.filter(s=>s.kind==='fire').length} shots`}));
  if(moves.length<2)return box;
  const xs=moves.map(s=>s.pos[0]),zs=moves.map(s=>s.pos[2]),minX=Math.min(...xs),minZ=Math.min(...zs),w=Math.max(...xs)-minX,h=Math.max(...zs)-minZ,size=Math.max(1,w,h);
  const ox=(200-w/size*200)/2,oz=(200-h/size*200)/2,pt=p=>[(ox+(p[0]-minX)/size*200).toFixed(1),(200-oz-(p[2]-minZ)/size*200).toFixed(1)];
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','-5 -5 210 210');svg.setAttribute('role','img');svg.setAttribute('aria-label','Path seen from above');
  const line=document.createElementNS(ns,'polyline');line.setAttribute('points',moves.map(s=>pt(s.pos).join(',')).join(' '));svg.append(line);
  for(const s of shots){const c=document.createElementNS(ns,'circle');const [x,y]=pt(s.pos);c.setAttribute('cx',x);c.setAttribute('cy',y);c.setAttribute('r','3');svg.append(c);}
  box.append(svg,el('span',{class:'meta',text:`${size.toFixed(1)} m across · height ${Math.min(...moves.map(s=>s.pos[1])).toFixed(1)} to ${Math.max(...moves.map(s=>s.pos[1])).toFixed(1)} m`}));
  return box;
 }
 const detailText=d=>{if(!d||typeof d!=='object')return '';return Object.entries(d).filter(([,v])=>v!=null&&typeof v!=='object').map(([k,v])=>`${k} ${typeof v==='number'?Math.round(v*100)/100:v}`).join(' · ');};
 async function showEvidence(p){
  selected=p;$('ace-h').textContent='Evidence';
  for(const tr of $('ac-flags').tBodies[0].rows)tr.setAttribute('aria-selected',String(tr.dataset.key===(p.player??p.handle)));
  const box=$('ac-evidence');box.replaceChildren(el('p',{class:'empty muted',text:'Loading…'}));
  try{
   const [flags,shots]=await Promise.all([p.player?central('flags?player='+p.player):central('desktop-flags?handle='+encodeURIComponent(p.handle)),p.player?central('screenshots?player='+p.player).catch(()=>({screenshots:[]})):Promise.resolve({screenshots:[]})]);
   if(selected!==p)return;
   const list=el('ol',{class:'ev-list'},...flags.flags.map(f=>el('li',{},
    el('div',{class:'ev-head'},el('b',{text:kindWord(f.kind)}),el('span',{class:'sev'+(f.severity>=40?' hi':f.severity>=20?' mid':''),text:`severity ${f.severity}`}),el('time',{class:'mono muted',text:when(f.at)})),
    detailText(f.detail?.detail)?el('p',{class:'ev-detail',text:detailText(f.detail.detail)}):null,
    f.detail?.replay?.length?replayPlot(f.detail.replay):null)));
   const pics=(shots.screenshots??[]).slice(0,12).map(s=>el('figure',{},el('img',{src:'/api/screenshot/'+s.id,alt:`Screenshot of ${p.name}'s screen`,loading:'lazy'}),el('figcaption',{text:`${when(s.createdAt??s.created_at)} · ${s.trigger??''}`})));
   box.replaceChildren(el('p',{class:'who'},el('b',{text:p.name})),flags.flags.length?list:el('p',{class:'empty muted',text:'No flags for this player.'}),...(pics.length?[el('div',{class:'shots'},...pics)]:[]));
   $('ac-actions').replaceChildren(...(p.player?[el('button',{class:'btn small',type:'button',text:'Screenshot',onclick:()=>act('screenshot',p,()=>showEvidence(p))})]:[]),
    el('button',{class:'btn small danger',type:'button',text:'Kick',onclick:()=>act('kick',p)}),el('button',{class:'btn small danger',type:'button',text:'Ban',onclick:()=>act('ban',p)}));
  }catch(e){box.replaceChildren(el('p',{class:'empty muted',text:explain(e)}));}
 }
 const anticheat={timer:null,visible:false,
  async load(){
   let flags,reports,roster;
   try{[flags,reports,roster]=await Promise.all([central('recent-flags'),central('reports?status=open'),central('players').catch(()=>null)]);$('ac-note').hidden=true;}
   catch(e){if(e.message!=='sign-in')noteFor($('ac-note'),e);return;}
   const day=flags.flags.filter(f=>serverNow()-f.at<86400e3);
   $('ac-day').textContent=String(day.length);$('ac-players').textContent=String(new Set(day.map(f=>f.player??f.handle)).size);
   $('ac-review').textContent=roster?String([...roster.players,...roster.desktop].filter(p=>p.review).length):'–';$('ac-open').textContent=String(reports.reports.length);
   $('ac-flags').tBodies[0].replaceChildren(...flags.flags.slice(0,100).map(f=>{
    const p={player:f.source==='browser'?f.player:null,handle:f.source==='desktop'?f.handle:null,name:f.name};
    return el('tr',{'data-key':p.player??p.handle,'aria-selected':String(Boolean(selected)&&(selected.player??selected.handle)===(p.player??p.handle)),tabindex:'0',onclick:()=>showEvidence(p),onkeydown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showEvidence(p);}}},
     el('td',{class:'id',text:when(f.at)}),el('td',{},el('span',{class:'name',text:f.name}),f.source==='desktop'?el('span',{class:'sub',text:'desktop'}):null),
     el('td',{text:kindWord(f.kind)}),el('td',{},el('span',{class:'sev'+(f.severity>=40?' hi':f.severity>=20?' mid':''),text:String(f.severity)})));
   }));
   $('ac-empty').hidden=flags.flags.length>0;
   $('ac-reports').replaceChildren(...(reports.reports.length?reports.reports.map(r=>el('li',{},
    el('div',{class:'what'},el('b',{text:`${r.name} · ${r.reason==='in-game'?'reported in game':r.reason}`}),el('span',{text:`by ${r.reporterName} · ${when(r.createdAt)}${r.detail?' · '+r.detail:''}`})),
    el('div',{class:'acts'},r.player?el('button',{class:'btn small',type:'button',text:'Evidence',onclick:()=>showEvidence({player:r.player,name:r.name})}):null,
     el('button',{class:'btn small',type:'button',text:'Resolved',onclick:()=>resolve(r,'resolved')}),el('button',{class:'btn small',type:'button',text:'Dismiss',onclick:()=>resolve(r,'dismissed')})))):[el('li',{},el('span',{class:'muted',text:'No open reports. Players report others with /report in game or on the website.'}))]));
  },
  show(arg){anticheat.visible=true;anticheat.load();if(arg)showEvidence(arg);clearInterval(anticheat.timer);anticheat.timer=setInterval(()=>{if(anticheat.visible&&!document.hidden)anticheat.load();},10000);},
  hide(){anticheat.visible=false;clearInterval(anticheat.timer);},
 };
 async function resolve(r,status){try{await central('resolve-report',{report:r.id,status});toast(status==='resolved'?'Report resolved':'Report dismissed');anticheat.load();}catch(e){toast(explain(e),'error');}}
 return {players,anticheat};
}
