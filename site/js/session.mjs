// Loads the site configuration and the signed-in player once per page.
import {api,setCsrf} from './api.mjs';
import {reportDevice} from './device.mjs';

let pending=null;const listeners=new Set();
export function loadSession({refresh=false}={}){
 if(!pending||refresh)pending=(async()=>{
  const config=await fetch('/site-config.json').then(r=>r.json()).catch(()=>({providers:[]}));
  let me=null;try{me=await api('GET','/me');setCsrf(me.csrf);}catch{setCsrf(null);}
  if(me&&!refresh)reportDevice(me); // device signals for admin alt notes (site/js/device.mjs)
  const session={me,config};for(const fn of listeners)fn(session);return session;
 })();
 return pending;
}
export function onSession(fn){listeners.add(fn);if(pending)pending.then(fn);return()=>listeners.delete(fn);}
