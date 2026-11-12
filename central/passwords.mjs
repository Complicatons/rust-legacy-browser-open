// Website account passwords (scrypt) and the username / email / password rules (website spec §6.1).
// The same rules are mirrored for instant form feedback in site/js/forms.mjs (tests keep the two lists equal).
import {scrypt,randomBytes,timingSafeEqual} from 'node:crypto';

const N_LOG2=15,R=8,P=1,KEY=32,MAXMEM=64*1024*1024;
export const USERNAME=/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
export const RESERVED=['admin','administrator','moderator','mod','staff','support','system','root','facepunch','rustlegacy','null','undefined'];
export const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN=8,PASSWORD_MAX=128;

const derive=(plain,salt,n=2**N_LOG2,r=R,p=P)=>new Promise((res,rej)=>scrypt(String(plain),salt,KEY,{N:n,r,p,maxmem:MAXMEM},(e,k)=>e?rej(e):res(k)));

export async function hashPassword(plain){
 const salt=randomBytes(16),key=await derive(plain,salt);
 return `scrypt$${N_LOG2}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(plain,stored){
 const m=/^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([\w-]{22})\$([\w-]{43})$/.exec(typeof stored==='string'?stored:'');
 if(!m||Number(m[1])>20)return false;
 const expected=Buffer.from(m[5],'base64url');
 try{return timingSafeEqual(await derive(plain,Buffer.from(m[4],'base64url'),2**Number(m[1]),Number(m[2]),Number(m[3])),expected);}catch{return false;}
}
// Verified against when the account does not exist, so unknown users cost the same time as wrong passwords.
export const DUMMY_HASH='scrypt$15$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const usernameKey=name=>String(name??'').trim().toLowerCase();
export const emailKey=email=>String(email??'').trim().toLowerCase();
// One address per person (central/identity.mjs): lowercase, "+tag" dropped everywhere, and for Gmail the dots too
// (googlemail.com is the same mailbox). j.o.e+rust@googlemail.com → joe@gmail.com.
const GMAIL=new Set(['gmail.com','googlemail.com']);
export function canonicalEmail(email){
 const e=emailKey(email),at=e.lastIndexOf('@');if(at<1)return e;
 let local=e.slice(0,at),domain=e.slice(at+1).replace(/\.+$/,'');
 local=local.split('+')[0]||local;
 if(GMAIL.has(domain)){local=local.replaceAll('.','');domain='gmail.com';}
 return local+'@'+domain;
}
export function checkUsername(name){
 const n=String(name??'').trim();
 if(!USERNAME.test(n))return 'invalid-username';
 return RESERVED.includes(n.toLowerCase())?'reserved-username':null;
}
export function checkEmail(email){const e=String(email??'').trim();return e.length<=254&&EMAIL.test(e)?null:'invalid-email';}
export function checkPassword(pw,{username,email}={}){
 const p=String(pw??'');
 if(p.length<PASSWORD_MIN)return 'password-too-short';
 if(p.length>PASSWORD_MAX)return 'password-too-long';
 const lower=p.toLowerCase();
 if((username&&lower===usernameKey(username))||(email&&lower===emailKey(email)))return 'password-matches-name';
 return null;
}
