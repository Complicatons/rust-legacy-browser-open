// Account page: profile, sign-in methods (password, Steam) and sessions.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {bindForm,passwordToggle,passwordMeter} from './forms.mjs';
import {toast} from './shell.mjs';

const $=s=>document.querySelector(s);
const {me,config}=await loadSession();
if(!me)location.replace('/signin?next=/account');
else{
 const q=new URLSearchParams(location.search);
 if(q.has('verified'))toast('Email confirmed.');
 if(q.has('verify_error'))toast('That confirmation link has expired or was already used.','error');
 if(q.size)history.replaceState(null,'','/account');

 document.querySelector("#staff-links").hidden=!me.staff;
 function render(p){
  const user=$('#acc-username');user.textContent=p.username??p.name;user.classList.remove('skeleton');
  const email=$('#acc-email');email.textContent=p.email??'No email yet';email.classList.remove('skeleton');email.classList.toggle('muted',!p.email);
  const badge=$('#acc-verified');badge.hidden=!p.email;badge.className='badge '+(p.emailVerified?'ok':'warn');badge.textContent=p.emailVerified?'Verified':'Not verified';
  $('#email-edit').textContent=p.email?'Change':'Add';
  $('#acc-password').textContent=p.hasPassword?'Set':'Not set';$('#password-edit').textContent=p.hasPassword?'Change':'Set';
  $('#f-current').closest('.field').hidden=!p.hasPassword;
  for(const row of document.querySelectorAll('.acc-row[data-provider]')){
   const name=row.dataset.provider,linked=p.identities.includes(name),enabled=(config.providers??[]).includes(name);
   row.hidden=!linked&&!enabled;row.querySelector('.state').textContent=linked?'Linked':'Not linked';row.querySelector('[data-link]').hidden=linked;
  }
  // Phone verification (servers may require it): shown only when central has a phone provider.
  $('#phone').hidden=!p.phoneVerification;$('#acc-phone-state').textContent=p.phoneVerified?'Verified':'Not verified';$('#phone-edit').textContent=p.phoneVerified?'Change':'Verify';
  // Leaderboards (central/stats.mjs): shown unless the player hides themselves.
  const hidden=Boolean(p.leaderboardHidden);$('#acc-board-state').textContent=hidden?'Hidden':'Shown';$('#board-toggle').textContent=hidden?'Show me':'Hide me';$('#board-toggle').setAttribute('aria-pressed',String(hidden));
  $('#account-root').removeAttribute('aria-busy');
 }
 render(me);

 const reveal=(button,form)=>{button.addEventListener('click',()=>{form.hidden=false;form.querySelector('input:not([type=hidden])')?.focus();});form.querySelector('[data-cancel]').addEventListener('click',()=>{form.hidden=true;form.reset();});};
 // Accounts with a password confirm it to change the email (where resets are sent).
 $('#email-current-field').hidden=!me.hasPassword;
 reveal($('#email-edit'),$('#email-form'));reveal($('#password-edit'),$('#password-form'));reveal($('#phone-edit'),$('#phone-form'));
 $('#phone-code-form').querySelector('[data-cancel]').addEventListener('click',()=>{$('#phone-code-form').hidden=true;$('#phone-code-form').reset();});
 passwordToggle($('#f-password'),$('.pw-toggle'));passwordMeter($('#f-password'),$('.meter'));

 bindForm($('#email-form'),{fields:['email'],busyText:'Saving…',submit:async v=>{
  const r=await api('POST','/account/email',{email:v.email.trim(),...(me.hasPassword?{current:v.current}:{})});$('#email-form').hidden=true;
  toast(r.verificationSent?'Email saved. Check your inbox to confirm it.':'Email saved.');render((await loadSession({refresh:true})).me);}});
 bindForm($('#phone-form'),{fields:[],busyText:'Sending…',submit:async v=>{
  await api('POST','/account/phone/start',{phone:v.phone});$('#phone-form').hidden=true;$('#phone-code-form').hidden=false;$('#f-phone-code').focus();toast('Code sent.');}});
 bindForm($('#phone-code-form'),{fields:[],busyText:'Checking…',submit:async v=>{
  await api('POST','/account/phone/verify',{code:v.code.trim()});$('#phone-code-form').hidden=true;$('#phone-code-form').reset();toast('Phone verified.');render((await loadSession({refresh:true})).me);}});
 bindForm($('#password-form'),{fields:['password'],ctx:()=>({username:me.username,email:me.email}),busyText:'Saving…',submit:async v=>{
  await api('POST','/account/password',{next:v.password,...(me.hasPassword?{current:v.current}:{})});
  $('#password-form').hidden=true;$('#password-form').reset();toast('Password saved. Other devices were signed out.');render((await loadSession({refresh:true})).me);}});

 document.querySelectorAll('[data-link]').forEach(b=>b.addEventListener('click',async()=>{
  try{location.href=(await api('POST',`/auth/${b.dataset.link}/link-start`)).url;}
  catch(e){toast(e.code==='reauthenticate'?'For security, sign out and sign in again, then link it.':explain(e.code),'error');}
 }));
 $('#sign-out').addEventListener('click',async()=>{try{await api('POST','/auth/logout');}catch{}location.href='/';});
 $('#board-toggle').addEventListener('click',async e=>{const b=e.currentTarget,hide=b.getAttribute('aria-pressed')!=='true';b.dataset.busy='';
  try{await api('POST','/account/leaderboard',{hidden:hide});const {me:fresh}=await loadSession({refresh:true});render(fresh);toast(hide?'You are hidden from the leaderboards.':'You are back on the leaderboards.');}catch(x){toast(explain(x.code),'error');}finally{delete b.dataset.busy;}});
 $('#revoke').addEventListener('click',async()=>{try{await api('POST','/account/sessions/revoke');toast('Other devices and launchers were signed out.');loadLaunchers();}catch(e){toast(explain(e.code),'error');}});

 // Desktop launchers signed in to this account (DESKTOP-LAUNCHER-PLAN.md): device, last check-in, and whether in game.
 const when=t=>{const s=Math.round((Date.now()-t)/1000);return s<90?'just now':s<5400?Math.round(s/60)+' min ago':s<129600?Math.round(s/3600)+' h ago':new Date(t).toLocaleDateString();};
 async function loadLaunchers(){
  const list=$('#launcher-list');
  let sessions;try{({sessions}=await api('GET','/account/desktop-sessions'));}catch{list.replaceChildren();return;}
  list.replaceChildren(...sessions.map(s=>{
   const row=document.createElement('div');row.className='acc-row';
   const dt=document.createElement('dt');dt.textContent=s.device;
   const dd=document.createElement('dd');dd.className='muted';dd.textContent=(s.state==='in-game'?'In game · ':s.state==='connected'?'Connected · ':'')+'last seen '+when(s.lastSeen);
   const b=document.createElement('button');b.type='button';b.className='btn small';b.textContent='Sign out';
   b.addEventListener('click',async()=>{try{await api('POST','/account/desktop-sessions/revoke',{id:s.id});toast(s.device+' was signed out.');loadLaunchers();}catch(e){toast(explain(e.code),'error');}});
   row.append(dt,dd,b);return row;}));
 }
 loadLaunchers();
}
document.body.dataset.ready='1';
