// Account form rules for instant feedback. They mirror central/passwords.mjs (a test keeps the two identical) and use
// the same messages as server errors, so a field reads the same whichever side caught the problem.
import {explain} from './api.mjs';

export const RULES={
 username:/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/,
 reserved:['admin','administrator','moderator','mod','staff','support','system','root','facepunch','rustlegacy','null','undefined'],
 email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
 passwordMin:8,passwordMax:128,
};

const codeFor={
 email:v=>v.trim().length<=254&&RULES.email.test(v.trim())?null:'invalid-email',
 username:v=>!RULES.username.test(v.trim())?'invalid-username':RULES.reserved.includes(v.trim().toLowerCase())?'reserved-username':null,
 password:(v,{username,email}={})=>v.length<RULES.passwordMin?'password-too-short':v.length>RULES.passwordMax?'password-too-long':
  (username&&v.toLowerCase()===username.trim().toLowerCase())||(email&&v.toLowerCase()===email.trim().toLowerCase())?'password-matches-name':null,
};
const required={login:'Enter your email or username.',current:'Enter your current password.'};

// A message for the field's value, or null when it is fine. ctx carries {username, email} for the password check.
export function validateField(name,value,ctx={}){
 const v=String(value??'');
 if(required[name])return v.trim()?null:required[name];
 const code=codeFor[name]?.(v,ctx)??null;
 return code&&explain(code);
}

// Which form field a server error code belongs to (null: show it in the summary only).
export function fieldForCode(code){
 if(/username/.test(code))return 'username';
 if(/^email-|invalid-email|disposable-email/.test(code))return 'email';
 if(/^phone-code-/.test(code))return 'code';
 if(/phone/.test(code))return 'phone';
 if(/^password-/.test(code))return 'password';
 return null;
}
