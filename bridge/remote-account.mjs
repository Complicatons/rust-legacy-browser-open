// Gateway-side client of the central service (central/service.mjs): ticket redemption and heartbeats with this
// server instance's bearer credential. Fails closed: any transport error refuses the new join.
import {AdmissionError} from './admission.mjs';

export function createRemoteAccount({baseUrl,credential,fetchImpl=fetch,timeoutMs=5000}){
 if(!/^[A-Za-z0-9_-]{43}$/.test(credential??''))throw Error('Invalid server credential');
 async function post(path,data){
  const res=await fetchImpl(new URL(path,baseUrl),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credential},body:JSON.stringify(data),signal:AbortSignal.timeout(timeoutMs)});
  return {status:res.status,data:await res.json().catch(()=>({}))};
 }
 return {
  // kind 'desktop': a launcher's desktop pass (central refuses the other kind on each route). ip: the player's address
  // as this gateway saw it (central logs it and checks IP bans).
  async redeemAdmission(ticket,{serverId,kind,ip}){
   let r;try{r=await post('/bridge/redeem',{ticket,...(kind?{kind}:{}),...(typeof ip==='string'&&ip?{ip}:{})});}catch{throw new AdmissionError('account-service-unavailable');}
   if(r.status===200)return {subject:r.data.subject,serverId,jti:r.data.jti,exp:r.data.exp,profile:r.data.profile,name:r.data.name,steamId:r.data.steamId};
   throw new AdmissionError(r.status===401?'gateway-unauthenticated':r.data.error??'account-service-error');
  },
  heartbeat:({players,capacity,wipe})=>post('/bridge/heartbeat',{players,capacity,wipe}),
  // Live roster + anti-cheat evidence; the reply lists accounts to kick (admin kicks and active bans).
  // events: adapter outbox (admin command results, in-game reports). Reply: kicks and admin commands for the adapter.
  // desktop: the adapter's handle roster of desktop players (null = unknown, left out of the report).
  // screenshots: admin screenshot requests {id, subject} for players on this gateway (central/screenshots.mjs).
  // stats: leaderboard counts per account since the last report (bridge/player-stats.mjs).
  report:async({players,flags,events=[],desktop=null,stats=[]})=>{const r=await post('/bridge/report',{players,flags,events,...(Array.isArray(desktop)?{desktop}:{}),...(stats.length?{stats}:{})});if(r.status!==200)throw Error('report '+r.status);return {kicks:Array.isArray(r.data.kicks)?r.data.kicks:[],commands:Array.isArray(r.data.commands)?r.data.commands:[],screenshots:Array.isArray(r.data.screenshots)?r.data.screenshots:[]};},
  // A capture's result (image or failure reason) for one request; uploads get a longer timeout.
  screenshot:async result=>{const res=await fetchImpl(new URL('/bridge/screenshot',baseUrl),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credential},body:JSON.stringify(result),signal:AbortSignal.timeout(Math.max(timeoutMs,30e3))});return {status:res.status,data:await res.json().catch(()=>({}))};},
  tasks:async()=>(await post('/bridge/tasks',{})).data.tasks??[],
  linkReserved:(request,result)=>post('/bridge/link-reserved',{request,...result}),
  linkConfirmed:(request,ok)=>post('/bridge/link-confirmed',{request,ok}),
 };
}

// One-time enrolment: exchange the owner's code for this instance's credential (store it securely).
export async function enrolGateway({baseUrl,code,hostKey=false,fetchImpl=fetch}){
 const res=await fetchImpl(new URL('/bridge/enrol',baseUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(hostKey?{code,hostKey:true}:{code})});
 const data=await res.json().catch(()=>({}));
 if(res.status!==201)throw Error('Enrolment failed: '+(data.error??res.status));
 return data;
}
