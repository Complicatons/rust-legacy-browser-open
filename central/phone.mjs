// Phone verification for servers that opt in (join policy "require phone"). Provider-agnostic: a provider has
//   {name, async start(phone)}            send a code to an E.164 number
//   {      async check(phone, code)}      true when the code is right (the provider may hold the code itself)
// so an SMS service (one that generates its own codes, or one that only sends text) can replace the console provider
// below without touching central. Central keeps only an HMAC of the number (central/identity.mjs), never the number.
import {randomInt} from 'node:crypto';

// "+44 7700 900123", "0044 7700-900123" → "+447700900123"; anything that is not E.164 (8–15 digits) → null.
export function normalisePhone(raw){
 let s=String(raw??'').replace(/[\s().-]/g,'');
 if(s.startsWith('00'))s='+'+s.slice(2);
 return /^\+[1-9]\d{7,14}$/.test(s)?s:null;
}

// Development and test provider: codes go to the log (or the test), never to a phone.
export function createConsolePhoneProvider({log=(...a)=>console.log(...a),codeTtlMs=10*60e3,now=Date.now}={}){
 const codes=new Map(); // phone → {code, expires}
 return {
  name:'console',
  async start(phone){const code=String(randomInt(0,1e6)).padStart(6,'0');codes.set(phone,{code,expires:now()+codeTtlMs});log(`[phone] code for ${phone}: ${code}`);},
  async check(phone,code){const c=codes.get(phone);if(!c||c.expires<=now()||c.code!==String(code))return false;codes.delete(phone);return true;},
  peek:phone=>codes.get(phone)?.code??null,
 };
}
