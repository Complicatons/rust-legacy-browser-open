// Sign in a desktop launcher with a device code (DESKTOP-LAUNCHER-PLAN.md). The code is typed, never taken from the
// URL: a link carrying someone else's code would sign their launcher in as you.
import {api,explain} from './api.mjs';
import {loadSession} from './session.mjs';
import {bindForm} from './forms.mjs';

const $=s=>document.querySelector(s);
const {me}=await loadSession();
if(!me)location.replace('/signin?next=/desktop/approve');
else{
 const input=$('#f-code');
 // Upper case, unambiguous characters only, dash after four.
 input.addEventListener('input',()=>{const raw=input.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,'').slice(0,8);input.value=raw.length>4?raw.slice(0,4)+'-'+raw.slice(4):raw;});
 const form=bindForm($('#approve-form'),{fields:[],busyText:'Signing in…',submit:async v=>{
  const code=String(v.code??'').trim();
  if(!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)){form.setError('code',explain('invalid-launcher-code'));throw {code:'invalid-launcher-code'};}
  try{const r=await api('POST','/desktop/device/approve',{userCode:code});$('#approved-device').textContent=r.device;$('#approve-form').hidden=true;$('#approved').hidden=false;}
  catch(e){const code=e.code==='invalid-code'?'invalid-launcher-code':e.code==='unknown-code'?'unknown-launcher-code':e.code;form.setError('code',explain(code));throw {code};}
 }});
 input.focus();
}
document.body.dataset.ready='1';
