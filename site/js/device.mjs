// Device signals for the one-account rule (central/identity.mjs, POST /account/device): a device token the server keeps
// in an HttpOnly cookie with a copy here, and soft signals (browser, screen, timezone, graphics). Central stores hashes
// only and uses them for admin "possible alt" notes, never to ban anyone. Sent at most twice a day per signed-in browser.
import {api} from './api.mjs';

const KEY='rlb-device',SENT='rlb-device-sent',EVERY_MS=12*3600e3;
const store={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}}};

export function deviceSignals(){
 let webgl='';
 try{const gl=document.createElement('canvas').getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');webgl=gl?String(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)):'';gl?.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
 return {ua:navigator.userAgent,screen:{w:screen.width,h:screen.height,dpr:devicePixelRatio},tz:Intl.DateTimeFormat().resolvedOptions().timeZone??'',webgl,lang:navigator.language??''};
}

export async function reportDevice(me,now=Date.now()){
 if(!me)return;
 const last=Number(store.get(SENT+':'+me.player));if(Number.isFinite(last)&&now-last<EVERY_MS)return;
 try{const r=await api('POST','/account/device',{token:store.get(KEY),signals:deviceSignals()});if(typeof r.token==='string')store.set(KEY,r.token);store.set(SENT+':'+me.player,String(now));}catch{}
}
