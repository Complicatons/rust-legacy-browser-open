// Register, sign in, welcome (finish a Steam sign-up), forgot and reset pages.
import {api,setCsrf,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {bindForm,passwordToggle,passwordMeter,debounce} from './forms.mjs';
import {validateField} from './form-rules.mjs';
import {safeNext} from './auth.mjs';

const $=s=>document.querySelector(s),page=document.body.dataset.page,params=new URLSearchParams(location.search);
const next=safeNext(params.get('next')??'');

// Provider buttons: copies of the header's Steam button, only for providers the site has enabled.
function providerButtons(box,providers){
 if(!box)return;
 const buttons=[...document.querySelectorAll('.bar .btn-provider')].filter(b=>providers.includes(b.dataset.provider)).map(b=>{const c=b.cloneNode(true);c.querySelector('span').textContent=`Continue with ${c.querySelector('span').textContent}`;return c;});
 box.replaceChildren(...buttons);
 document.querySelectorAll('.provider-block').forEach(el=>{if(el!==box&&el.id!=='restart')el.hidden=!buttons.length;});
 box.hidden=!buttons.length;
}
function keepNext(){if(params.get('next'))document.querySelectorAll('a.keep-next').forEach(a=>{a.search='?next='+encodeURIComponent(next);});}
function wirePassword(){
 const input=$('#f-password'),toggle=$('.pw-toggle'),meter=$('.meter');
 if(input&&toggle)passwordToggle(input,toggle);if(input&&meter)passwordMeter(input,meter);
}
// Live username availability (debounced) shown under the field.
function availability(){
 const input=$('#f-username'),status=$('#f-username-status');if(!input||!status)return;
 const check=debounce(async()=>{
  const name=input.value.trim();status.textContent='';
  if(!name||validateField('username',name))return;
  try{const r=await api('GET','/auth/username-available?name='+encodeURIComponent(name));if(input.value.trim()!==name)return;
   status.textContent=r.available?'✓ Available':'';if(!r.available){const err=$('#f-username-err');err.textContent=explain(r.reason);err.hidden=false;input.setAttribute('aria-invalid','true');}}catch{}
 },400);
 input.addEventListener('input',check);
}
const signedIn=r=>{setCsrf(r.csrf);};

const pages={
 async register({me,config}){
  if(me)return location.replace(next);
  providerButtons($('.providers'),config.providers??[]);keepNext();wirePassword();availability();
  // From the launch sign-up page: the email they just gave (handed over in sessionStorage, never in the URL).
  try{const pre=sessionStorage.getItem('rlb-signup-email');sessionStorage.removeItem('rlb-signup-email');if(pre&&pre.length<=254&&pre.includes('@'))$('#f-email').value=pre;}catch{}
  bindForm($('#register-form'),{fields:['email','username','password'],busyText:'Creating account…',
   submit:async v=>{signedIn(await api('POST','/auth/register',{email:v.email.trim(),username:v.username.trim(),password:v.password}));location.href=params.get('next')?next:'/servers?welcome=1';}});
 },
 async signin({me,config}){
  if(me)return location.replace(next);
  providerButtons($('.providers'),config.providers??[]);keepNext();wirePassword();
  $('.forgot').hidden=!config.mail;
  bindForm($('#signin-form'),{fields:['login'],busyText:'Signing in…',
   submit:async v=>{if(!v.password)throw {code:'invalid-credentials'};signedIn(await api('POST','/auth/password',{login:v.login.trim(),password:v.password}));location.href=next;}});
 },
 async welcome({me,config}){
  const form=$('#welcome-form');availability();
  // Accounts from before website usernames: choose one now.
  if(me){
   const after=params.get('next')?next:'/servers?welcome=1';
   if(!me.needsUsername)return location.replace(params.get('next')?next:'/servers');
   $('#welcome-lede').textContent='Pick the name you want in game and on the site. You can only set it once.';$('#email-field').hidden=true;form.hidden=false;
   bindForm(form,{fields:['username'],busyText:'Saving…',submit:async v=>{await api('POST','/account/username',{username:v.username.trim()});location.href=after;}});
   return;
  }
  let pending;
  try{pending=await api('GET','/auth/pending');}
  catch{$('#expired').hidden=false;$('#welcome-lede').hidden=true;providerButtons($('#restart'),config.providers??[]);return;}
  const name={steam:'Steam'}[pending.provider]??pending.provider;
  const badge=$('#provider-badge');badge.textContent=`✓ ${name} sign-in confirmed`;badge.hidden=false;
  $('#f-username').value=pending.suggestedName;form.hidden=false;$('#f-username').dispatchEvent(new Event('input'));
  bindForm(form,{fields:['username'],busyText:'Creating account…',
   submit:async v=>{const email=v.email.trim();if(email){const m=validateField('email',email);if(m)throw {code:'invalid-email'};}
    signedIn(await api('POST','/auth/complete-signup',{username:v.username.trim(),...(email?{email}:{})}));location.href='/servers?welcome=1';}});
 },
 async forgot({config}){
  if(!config.mail){$('#mail-off').hidden=false;$('#forgot-form').hidden=true;return;}
  bindForm($('#forgot-form'),{fields:['email'],busyText:'Sending…',submit:async v=>{await api('POST','/auth/forgot',{email:v.email.trim()});$('#forgot-form').hidden=true;$('#sent').hidden=false;}});
 },
 async reset(){
  const token=params.get('token');wirePassword();
  if(!token){$('#reset-form').hidden=true;$('#bad-link').hidden=false;return;}
  bindForm($('#reset-form'),{fields:['password'],busyText:'Saving…',
   submit:async v=>{try{await api('POST','/auth/reset',{token,password:v.password});}catch(e){if(e.code==='invalid-token'){$('#reset-form').hidden=true;$('#bad-link').hidden=false;return;}throw e;}
    $('#reset-form').hidden=true;$('#done').hidden=false;}});
 },
};

const session=await loadSession();
await pages[page]?.(session);
document.body.dataset.ready='1';
