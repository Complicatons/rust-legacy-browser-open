// Unsubscribe from the opening-day list (/unsubscribe?t=…, the link at the bottom of every mailing). It waits for a
// click, so mail scanners that open links do not unsubscribe anyone; mail apps' one-click button posts directly.
import {api,explain} from './api.mjs';

const $=s=>document.querySelector(s),token=new URLSearchParams(location.search).get('t')??'';
if(!/^[0-9a-f]{32}$/.test(token)){$('#un-ask').hidden=true;$('#un-missing').hidden=false;}
else $('#un-go').addEventListener('click',async e=>{
 const btn=e.currentTarget;btn.dataset.busy='';
 try{await api('POST','/launch/unsubscribe',{token});$('#un-ask').hidden=true;const done=$('#un-done');done.hidden=false;done.focus();}
 catch(x){const err=$('#un-err');err.textContent=explain(x.code);err.hidden=false;}
 finally{delete btn.dataset.busy;}
});
document.body.dataset.ready='1';
