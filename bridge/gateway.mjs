// Gateway admission step: redeem a browser admission and prepare one pending native session.
// The native uLink session engine that would carry the envelope is NOT implemented; callers get the
// envelope bytes and the backend ID to place in the native login (fields per ClientConnect.DoConnect).
import {createHash,randomBytes} from 'node:crypto';
import {encodeEnvelope} from './adapter.mjs';
import {AdmissionError} from './admission.mjs';

export function createGatewayAdmission({serverId,account,sendControl,wait=ms=>new Promise(r=>setTimeout(r,ms)),replaceTries=20,replaceDelayMs=250}){
 return {
  // account.redeemAdmission and sendControl may be local or remote (await works for both).
  // replace(subject): ends this gateway's own stale session for the same account (a tab that never closed its
  // socket) and returns true; the join then waits for the server to release the account instead of failing
  // "already-connected". A desktop client holding the identity is never replaced (replace finds no session).
  // ip: the browser's address (central logs it and refuses an IP-banned one).
  async admit(ticket,{replace,ip}={}){
   const claims=await account.redeemAdmission(ticket,{serverId,...(ip?{ip}:{})});
   const sessionId=randomBytes(16),secret=randomBytes(32);
   const register=()=>sendControl({type:'register-pending',serverId,subject:claims.subject,joinId:claims.jti,...(claims.steamId?{steamId:claims.steamId}:{}),sessionId:sessionId.toString('hex'),secretDigest:createHash('sha256').update(secret).digest('hex')});
   let reply=await register();
   if(reply?.reason==='already-connected'&&await replace?.(claims.subject))
    for(let i=0;i<replaceTries&&reply?.reason==='already-connected';i++){await wait(replaceDelayMs);reply=await register();}
   if(!reply?.ok)throw new AdmissionError(reply?.reason??'adapter-unavailable');
   return {backendId:reply.backendId,subject:claims.subject,joinId:claims.jti,name:claims.name,authBytes:encodeEnvelope({sessionId,secret}),sessionId:sessionId.toString('hex')};
  },
  // Desktop launcher (DESKTOP-LAUNCHER-PLAN.md): the same redemption and pending admission, but the envelope goes back
  // to the launcher, whose steam_api proxy puts it in the player's own native login. A live session is never replaced.
  async admitDesktop(pass,{ip}={}){
   const claims=await account.redeemAdmission(pass,{serverId,kind:'desktop',...(ip?{ip}:{})});
   const sessionId=randomBytes(16),secret=randomBytes(32);
   const reply=await sendControl({type:'register-pending',kind:'desktop',serverId,subject:claims.subject,joinId:claims.jti,...(claims.steamId?{steamId:claims.steamId}:{}),sessionId:sessionId.toString('hex'),secretDigest:createHash('sha256').update(secret).digest('hex')});
   if(!reply?.ok)throw new AdmissionError(reply?.reason??'adapter-unavailable');
   return {backendId:reply.backendId,subject:claims.subject,name:claims.name,envelope:encodeEnvelope({sessionId,secret,kind:'desktop'})};
  },
  // Tells the adapter this gateway's own session for backendId/sessionId has ended, so it can release the identity
  // lease right away instead of waiting for the plugin's next roster poll to notice (which, after the real server
  // itself restarts rather than just that one player disconnecting, can take much longer than LEASE_GRACE_MS: the
  // plugin that would normally report the disconnect died with the old server process). Best effort: a failure here
  // just falls back to the roster-based release, so callers never need to await or handle it.
  release(backendId,sessionId){if(backendId&&sessionId)Promise.resolve(sendControl({type:'release-lease',serverId,backendId,sessionId})).catch(()=>{});},
 };
}
