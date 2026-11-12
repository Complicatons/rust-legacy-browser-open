// A central service on a random port with a controllable clock, plus a JSON caller (tests that need accounts).
import {createServer} from 'node:http';
import {openCentralDb} from '../../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../../central/service.mjs';
import {createSigningKey} from '../../bridge/admission.mjs';
import {listenServer} from '../../bridge/listen.mjs';

export const ORIGIN='https://play.example.test';
// extra: more createCentralService options (identity, phone, steamQuality, screenshotRetentionDays).
export async function central({mailer,providers,rateLimit=1000,trustedProxies,...extra}={}){
 const clock={t:1_800_000_000_000},db=openCentralDb();
 const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:ORIGIN,verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],now:()=>clock.t,secureCookies:false,rateLimit,mailer,mailPauseMs:0,providers,trustedProxies,...extra});
 const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 async function call(method,path,{data,cookie,csrf,origin=ORIGIN}={}){
  const headers={origin};if(data!==undefined)headers['content-type']='application/json';if(cookie)headers.cookie=cookie;if(csrf)headers['x-csrf-token']=csrf;
  const res=await fetch(base+path,{method,headers,body:data!==undefined?JSON.stringify(data):undefined,redirect:'manual'});
  const cookies=res.headers.getSetCookie?.()??[];
  return {status:res.status,data:await res.json().catch(()=>null),cookie:cookies.find(c=>c.startsWith('rlb_session='))?.split(';')[0],cookies,location:res.headers.get('location')};
 }
 const register=(username,email=username.toLowerCase()+'@example.com',password='a long passphrase')=>call('POST','/auth/register',{data:{email,username,password}});
 return {db,svc,clock,base,call,register,close:()=>{http.closeAllConnections();return new Promise(r=>http.close(r));}};
}
