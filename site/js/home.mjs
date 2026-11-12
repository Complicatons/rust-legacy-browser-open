// Title-screen homepage: menu, quick join (live server directory), menu music and the optional live background.
import {api} from './api.mjs';
import {loadSession} from './session.mjs';
import {createMenu} from './menu.mjs';
import {createSiteSound} from './sound.mjs';
import {shouldLoadLive,environment,startLive,LIVE_OPT_OUT_KEY} from './live-bg.mjs';
import {summarizeServers,formatPlayers,quickJoin} from './server-data.mjs';
import {mountNotify,carryEmail} from './notify.mjs';

const $=s=>document.querySelector(s);
createMenu($('.ts-menu'));

// Progress: the public GitHub journal's overall figure (central/progress.mjs, as on /roadmap), filled and counted up
// once unless reduced motion is asked for. Hidden when there is no figure.
async function progress(){
 const p=await fetch('/site/content/progress.json').then(r=>r.ok?r.json():null).catch(()=>null);
 if(!(p?.overall>=0)){$('#hp').hidden=true;return;}
 const bar=$('#hp-bar'),pct=$('#hp-pct');bar.setAttribute('aria-valuenow',String(p.overall));bar.setAttribute('aria-valuetext',p.overall+'%');
 if(p.date)$('#hp-src').textContent='GitHub journal · '+new Date(p.date+'T00:00:00Z').toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'short'});
 const fill=()=>{bar.firstElementChild.style.width=p.overall+'%';};
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){pct.textContent=p.overall+'%';fill();return;}
 requestAnimationFrame(()=>requestAnimationFrame(fill));
 const t0=performance.now(),step=t=>{const k=Math.min(1,(t-t0)/1600);pct.textContent=Math.round(p.overall*(1-Math.pow(1-k,3)))+'%';if(k<1)requestAnimationFrame(step);};
 requestAnimationFrame(step);
}
const progressDone=progress();

// Get notified: the same opening-day list as /launch, then the offer to make an account.
mountNotify({form:$('#hn-form'),input:$('#hn-email'),website:$('#hn-website'),err:$('#hn-err'),onDone:email=>{
 $('#hn-step').hidden=true;const done=$('#hn-done');done.hidden=false;done.focus();carryEmail($('#hn-create'),email);
}});

// Music: plays at once if the browser allows it, else on the first click or key press; the bar toggle mutes it here
// and in game. While the browser still holds it back, the button pulses and its first press starts the music.
const toggle=$('.sound-toggle'),sync=()=>{if(!toggle)return;
 toggle.setAttribute('aria-pressed',String(!sound.muted));toggle.toggleAttribute('data-waiting',sound.waiting);
 toggle.setAttribute('aria-label',sound.muted?'Turn menu music on':sound.waiting?'Start menu music':'Turn menu music off');};
const sound=createSiteSound({onChange:()=>sync()});
if(toggle){toggle.hidden=false;sync();toggle.addEventListener('click',e=>{e.stopPropagation();sound.toggle();sync();});}

// Quick join panel.
const list=$('#qj-list');
function li(...children){const el=document.createElement('li');el.append(...children);return el;}
function text(tag,cls,value){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=value;return el;}
function render(servers){
 const {servers:count,players}=summarizeServers(servers);
 for(const el of [$('#qj-servers'),$('#qj-players')])el.classList.remove('skeleton');
 $('#qj-servers').textContent=String(count);$('#qj-players').textContent=players===null?'—':String(players);$('#qj-players').classList.toggle('na',players===null);
 $('#qj-dot').className='dot'+(count?'':' off');$('#qj-state').textContent=count?'Live':'Offline';
 const top=quickJoin(servers);
 if(!top.length){
  list.replaceChildren(li(text('span','empty',servers.length?'No servers are online right now.':'No servers are listed yet.')));
  $('#qj-play').firstElementChild.textContent='View servers';return;
 }
 $('#qj-play').firstElementChild.textContent='Play';
 list.replaceChildren(...top.map(s=>{
  const dot=text('span','dot','');dot.setAttribute('aria-hidden','true');
  const join=document.createElement('a');join.href=`/servers/${s.id}?join=1`;join.textContent='Join';join.setAttribute('aria-label',`Join ${s.name}`);
  return li(dot,text('b','',s.name),text('span','n',formatPlayers(s)),join);
 }));
}
function failed(){
 $('#qj-state').textContent='Directory offline';$('#qj-dot').className='dot warn';
 const retry=document.createElement('button');retry.type='button';retry.className='btn small';retry.textContent='Retry';retry.addEventListener('click',refresh);
 list.replaceChildren(li(text('span','empty','Could not reach the server directory. '),retry));
}
async function refresh(){try{render((await api('GET','/servers')).servers);}catch{failed();}}
refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},30e3);

// Optional live background (the game's own menu scene) on capable desktops where the game shares this origin.
const {config}=await loadSession();
const canvas=$('.bg-canvas'),liveToggle=$('#live-toggle');let live=null;
const env=environment({gameOrigin:config.playUrl==='/play'});
if(liveToggle&&shouldLoadLive({...env,optOut:false})){
 liveToggle.hidden=false;
 const setLabel=on=>{liveToggle.setAttribute('aria-pressed',String(on));liveToggle.textContent=`Live background: ${on?'on':'off'}`;};
 const begin=()=>startLive(canvas).then(l=>{live=l;});
 setLabel(!env.optOut);
 liveToggle.addEventListener('click',()=>{const on=!live;try{localStorage.setItem(LIVE_OPT_OUT_KEY,on?'0':'1');}catch{}setLabel(on);if(on)begin();else{live?.stop();live=null;}});
 if(!env.optOut){const idle=globalThis.requestIdleCallback??(fn=>setTimeout(fn,1500));const go=()=>idle(begin,{timeout:4000});document.readyState==='complete'?go():addEventListener('load',go,{once:true});}
}
await progressDone;
document.body.dataset.ready='1';
