// Browser admission tickets (account service side). Project-owned contract from BROWSER-SERVER-DECISION.md.
// Not connected to any native server hook yet: tests exercise it with mocks only.
import {generateKeyPairSync,sign,verify,randomUUID} from 'node:crypto';

export const ADMISSION_TYPE='rlb-admission+v1';
export const MAX_TICKET_LENGTH=2048;
// The browser joins through the gateway's WebSocket; desktop launchers (DESKTOP-LAUNCHER-PLAN.md) through POST /desktop/admit.
export const BROWSER_PROFILE='legacy-1069-browser-v1',DESKTOP_PROFILE='legacy-1069-desktop-v1';
const b64=v=>Buffer.from(v).toString('base64url');
const unb64=s=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]*$/.test(s))throw new AdmissionError('malformed');return Buffer.from(s,'base64url');};

export class AdmissionError extends Error{constructor(code){super(code);this.code=code;}}

// One-use claim store. claim() must be atomic in a real deployment (e.g. a unique-key insert).
export class MemoryReplayStore{
 constructor(){this.used=new Map();}
 claim(id,expiresAt,now){for(const [k,e] of this.used)if(e<=now)this.used.delete(k);if(this.used.has(id))return false;this.used.set(id,expiresAt);return true;}
}

export function createSigningKey(kid=randomUUID()){const {privateKey,publicKey}=generateKeyPairSync('ed25519');return {kid,privateKey,publicKey};}

// Account service: issues and redeems admissions. Signing keys never leave it; gateways only call redeem().
export function createAccountService({issuer,keys,replay=new MemoryReplayStore(),lifetimeMs=60000,now=Date.now,profiles=[BROWSER_PROFILE]}){
 if(!keys?.length)throw Error('No signing key');
 const byKid=new Map(keys.map(k=>[k.kid,k.publicKey]));
 return {
  issueAdmission({subject,serverId,profile=profiles[0]}){
   if(typeof subject!=='string'||!subject||typeof serverId!=='string'||!serverId)throw new AdmissionError('invalid-request');
   if(!profiles.includes(profile))throw new AdmissionError('unsupported-profile');
   const key=keys[0],t=now(),header={alg:'EdDSA',typ:ADMISSION_TYPE,kid:key.kid};
   const payload={iss:issuer,sub:subject,aud:serverId,jti:randomUUID(),iat:Math.floor(t/1000),exp:Math.floor((t+lifetimeMs)/1000),profile};
   const body=b64(JSON.stringify(header))+'.'+b64(JSON.stringify(payload));
   return body+'.'+b64(sign(null,Buffer.from(body),key.privateKey));
  },
  // Verifies and consumes a ticket for one server. Returns the verified claims or throws AdmissionError.
  redeemAdmission(ticket,{serverId}){
   const claims=verifyAdmission(ticket,{issuer,serverId,byKid,profiles,now:now(),maxLifetimeMs:lifetimeMs});
   if(!replay.claim(claims.jti,claims.exp*1000,now()))throw new AdmissionError('replayed');
   return claims;
  },
 };
}

const SKEW_S=5;
export function verifyAdmission(ticket,{issuer,serverId,byKid,profiles,now,maxLifetimeMs}){
 if(typeof ticket!=='string'||ticket.length>MAX_TICKET_LENGTH)throw new AdmissionError('malformed');
 const parts=ticket.split('.');if(parts.length!==3)throw new AdmissionError('malformed');
 let header,payload;
 try{header=JSON.parse(unb64(parts[0]).toString('utf8'));payload=JSON.parse(unb64(parts[1]).toString('utf8'));}catch{throw new AdmissionError('malformed');}
 if(header?.typ!==ADMISSION_TYPE||header.alg!=='EdDSA')throw new AdmissionError('malformed');
 const key=byKid.get(header.kid);if(!key)throw new AdmissionError('unknown-key');
 if(!verify(null,Buffer.from(parts[0]+'.'+parts[1]),key,unb64(parts[2])))throw new AdmissionError('bad-signature');
 const {iss,sub,aud,jti,iat,exp,profile}=payload??{};
 if(iss!==issuer)throw new AdmissionError('wrong-issuer');
 if(aud!==serverId)throw new AdmissionError('wrong-server');
 if(typeof sub!=='string'||!sub||typeof jti!=='string'||!jti||!Number.isSafeInteger(iat)||!Number.isSafeInteger(exp))throw new AdmissionError('malformed');
 if(!profiles.includes(profile))throw new AdmissionError('unsupported-profile');
 const t=Math.floor(now/1000);
 if(iat>t+SKEW_S||exp-iat>Math.ceil(maxLifetimeMs/1000))throw new AdmissionError('bad-lifetime');
 if(exp<=t-SKEW_S)throw new AdmissionError('expired');
 return {subject:sub,serverId:aud,jti,iat,exp,profile};
}
