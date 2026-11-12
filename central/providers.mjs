// Website sign-in providers for central/service.mjs. No secrets or tokens are kept after the callback.
//  - Steam: OpenID 2.0 (not OIDC). Every positive assertion is re-verified with Steam via check_authentication;
//    return_to, op_endpoint, claimed_id/identity format and one-use response nonces are checked locally.
// Returns {issuer, subject, name}. Tested against mock endpoints only.
import {randomBytes} from 'node:crypto';

export const STEAM_OPENID='https://steamcommunity.com/openid/login';
const STEAM_ID=/^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;
const OPENID_NS='http://specs.openid.net/auth/2.0';

export class LoginError extends Error{constructor(code){super(code);this.code=code;}}

export function steamProvider({returnTo,realm,apiKey,fetchImpl=fetch,now=Date.now}){
 const nonces=new Map(); // response_nonce → expiry (Steam nonces embed a timestamp; keep a 10-minute window)
 return {
  name:'steam',
  authorizeUrl({state}){
   const u=new URL(STEAM_OPENID),rt=new URL(returnTo);rt.searchParams.set('state',state);
   for(const [k,v] of Object.entries({'openid.ns':OPENID_NS,'openid.mode':'checkid_setup','openid.return_to':rt.href,'openid.realm':realm,'openid.identity':OPENID_NS+'/identifier_select','openid.claimed_id':OPENID_NS+'/identifier_select'}))u.searchParams.set(k,v);
   return u.href;
  },
  async complete(query,{state}){
   const p=Object.fromEntries([...query].filter(([k])=>k.startsWith('openid.')));
   if(p['openid.mode']!=='id_res'||p['openid.ns']!==OPENID_NS)throw new LoginError('steam-not-positive');
   if(p['openid.op_endpoint']!==STEAM_OPENID)throw new LoginError('steam-wrong-endpoint');
   const rt=new URL(returnTo);rt.searchParams.set('state',state);
   if(p['openid.return_to']!==rt.href)throw new LoginError('steam-wrong-return-to');
   const m=STEAM_ID.exec(p['openid.claimed_id']??'');
   if(!m||p['openid.identity']!==p['openid.claimed_id'])throw new LoginError('steam-bad-identity');
   const signed=(p['openid.signed']??'').split(',');
   for(const f of ['op_endpoint','claimed_id','identity','return_to','response_nonce','assoc_handle'])if(!signed.includes(f))throw new LoginError('steam-unsigned-field');
   const nonce=p['openid.response_nonce'],t=now();
   for(const [k,e] of nonces)if(e<=t)nonces.delete(k);
   if(!nonce||nonces.has(nonce))throw new LoginError('steam-replayed');
   const issued=Date.parse(nonce.slice(0,20));
   if(!Number.isFinite(issued)||Math.abs(t-issued)>5*60e3)throw new LoginError('steam-stale');
   const body=new URLSearchParams({...p,'openid.mode':'check_authentication'});
   const res=await fetchImpl(STEAM_OPENID,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(8000)});
   const text=await res.text();
   if(!res.ok||!/^is_valid:true$/m.test(text))throw new LoginError('steam-not-verified');
   nonces.set(nonce,t+10*60e3);
   const steamId=m[1];
   return {issuer:'steam',subject:steamId,name:await steamName(steamId)};
  },
 };
 async function steamName(id){
  if(!apiKey)return 'Steam '+id.slice(-4);
  try{
   const u=new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');u.searchParams.set('key',apiKey);u.searchParams.set('steamids',id);
   const r=await (await fetchImpl(u,{signal:AbortSignal.timeout(5000)})).json();
   return String(r?.response?.players?.[0]?.personaname??'Steam player').slice(0,32);
  }catch{return 'Steam player';}
 }
}

export const newLoginState=()=>({state:randomBytes(24).toString('base64url'),verifier:randomBytes(48).toString('base64url')});
