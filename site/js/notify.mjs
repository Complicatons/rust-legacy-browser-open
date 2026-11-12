// "Get notified" email form, shared by /launch and the homepage: POST /launch/notify (central/waitlist.mjs) with the
// honeypot field, an error line, and onDone(email) once the address is on the list.
import {api,explain} from './api.mjs';

export const looksLikeEmail=e=>e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function mountNotify({form,input,website,err,onDone}){
 const fail=text=>{err.textContent=text;err.hidden=false;input.setAttribute('aria-invalid','true');input.focus();};
 form.addEventListener('submit',async e=>{
  e.preventDefault();err.hidden=true;input.removeAttribute('aria-invalid');
  const email=input.value.trim();if(!looksLikeEmail(email))return fail('Enter an email address like you@example.com.');
  const btn=form.querySelector('button'),label=btn.textContent;btn.dataset.busy='';btn.textContent='Saving…';
  try{await api('POST','/launch/notify',{email,website:website.value});onDone(email);}
  catch(x){fail(x.code==='rate-limited'?'Too many tries from here. Wait a minute and try again.':explain(x.code));}
  finally{delete btn.dataset.busy;btn.textContent=label;}
 });
}

// Register picks the address up from sessionStorage, so it never travels in the URL.
export const carryEmail=(link,email)=>link.addEventListener('click',()=>{try{sessionStorage.setItem('rlb-signup-email',email);}catch{}});
