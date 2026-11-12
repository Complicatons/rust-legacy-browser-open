// Site shell: active tab, account corner, user menu, mobile menu and toasts. Every page imports this module.
import {navState,accountCorner} from './shell-state.mjs';
import {loadSession,onSession} from './session.mjs';
import {api,explain} from './api.mjs';
export {navState,accountCorner};

const $=s=>document.querySelector(s);
export function toast(text,kind='info'){
 const box=$('.toasts');if(!box)return;
 const t=document.createElement('div');t.className='toast';t.dataset.kind=kind;t.textContent=text;box.append(t);
 setTimeout(()=>t.remove(),kind==='error'?9000:5000);
}

function markTab(){
 const tab=navState(location.pathname);
 document.querySelectorAll('[data-tab]').forEach(a=>{if(a.dataset.tab===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
}

function renderCorner({me,config}){
 const view=accountCorner(me,config),out=$('.acct-out'),inn=$('.acct-in');if(!out||!inn)return;
 out.hidden=view.kind!=='signed-out';inn.hidden=view.kind!=='signed-in';
 document.querySelectorAll('.btn-provider[data-provider]').forEach(b=>{b.hidden=!view.providers?.includes(b.dataset.provider);});
 const with_=$('.acct-out .with'),sep=$('.acct-out .sep');const any=(view.providers??[]).length>0;if(with_)with_.hidden=!any;if(sep)sep.hidden=!any;
 if(view.kind==='signed-in'){$('.user-name').textContent=view.name;$('.staff-only').hidden=!view.staff;}
 const mobile=$('.acct-mobile');
 if(mobile){mobile.replaceChildren();
  const link=(href,text,cls='btn')=>{const a=document.createElement('a');a.href=href;a.className=cls;a.textContent=text;mobile.append(a);};
  if(view.kind==='signed-out'){link('/register','Register','btn-play');link('/signin','Sign in');for(const p of view.providers)link(`/auth/${p}/start`,`Sign in with ${p[0].toUpperCase()+p.slice(1)}`);}
  else{link('/account','Account');link('/owner','Your servers');if(view.staff)link('/staff','Staff panel');}
 }
 if(view.kind==='signed-in'&&view.needsUsername&&!['/welcome','/account'].includes(location.pathname))location.replace('/welcome?mode=username&next='+encodeURIComponent(location.pathname+location.search));
}

function wireMenus(){
 const btn=$('.user-btn'),menu=$('.user-menu');
 if(btn&&menu){
  const close=()=>{menu.hidden=true;btn.setAttribute('aria-expanded','false');};
  btn.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;btn.setAttribute('aria-expanded',String(open));if(open)menu.querySelector('a,button')?.focus();});
  document.addEventListener('click',e=>{if(!e.target.closest('.user'))close();});
  menu.addEventListener('keydown',e=>{if(e.key==='Escape'){close();btn.focus();}});
  menu.querySelector('[data-action=sign-out]')?.addEventListener('click',async()=>{try{await api('POST','/auth/logout');}catch{}location.href='/';});
 }
 const mbtn=$('.menu-btn'),mnav=$('#mobile-nav');
 if(mbtn&&mnav)mbtn.addEventListener('click',()=>{const open=mnav.hidden;mnav.hidden=!open;mbtn.setAttribute('aria-expanded',String(open));mbtn.textContent=open?'Close':'Menu';});
}

// Messages carried back from provider redirects (?signed_in=steam, ?linked=steam, ?login_error=code).
function queryToasts(){
 const q=new URLSearchParams(location.search),name=p=>({steam:'Steam'})[p]??p;let changed=false;
 if(q.get('signed_in')){toast(`Signed in with ${name(q.get('signed_in'))}.`);q.delete('signed_in');changed=true;}
 if(q.get('linked')){toast(`${name(q.get('linked'))} is now linked to your account.`);q.delete('linked');changed=true;}
 if(q.get('login_error')){toast(explain(q.get('login_error')),'error');q.delete('login_error');changed=true;}
 if(q.has('welcome')){toast('Account created. Pick a server to play.');q.delete('welcome');changed=true;}
 if(changed)history.replaceState(null,'',location.pathname+(q.size?'?'+q:''));
}

markTab();wireMenus();queryToasts();
onSession(renderCorner);loadSession();
// Pages with no script of their own (404) are ready once the shell has run.
// (Match the path, not the end of the URL, so a query string on a script never hides it.)
if(!document.querySelector('script[type=module][src^="/site/js/"]:not([src*="/shell.mjs"])'))document.body.dataset.ready='1';
