// Website accounts over HTTP (central/accounts.mjs): register, password sign-in, lockout, username checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {safeNext} from '../site/js/auth.mjs';
import {central} from './helpers/central-fixture.mjs';

test('register creates an account and signs it in',async()=>{
 const c=await central();
 try{
  const r=await c.register('Rook');
  assert.equal(r.status,200);assert.match(r.cookie,/^rlb_session=/);assert.ok(r.data.csrf);
  const me=(await c.call('GET','/me',{cookie:r.cookie})).data;
  assert.equal(me.username,'Rook');assert.equal(me.name,'Rook');assert.equal(me.hasPassword,true);assert.equal(me.needsUsername,false);
  assert.equal(me.email,'rook@example.com');assert.equal(me.emailVerified,false);assert.equal(me.staff,false);
  assert.deepEqual(me.identities,['password']);
 }finally{await c.close();}
});

test('register rejects taken usernames and emails regardless of case and spaces',async()=>{
 const c=await central();
 try{
  await c.register('Rook');
  const dupName=await c.register(' rook ','other@example.com');assert.equal(dupName.status,409);assert.equal(dupName.data.error,'username-taken');
  const dupMail=await c.register('Other','ROOK@example.com');assert.equal(dupMail.status,409);assert.equal(dupMail.data.error,'email-taken');
  assert.equal((await c.register('ad')).data.error,'invalid-username');
  assert.equal((await c.register('Admin')).data.error,'reserved-username');
  assert.equal((await c.register('Fine1','bad')).data.error,'invalid-email');
  assert.equal((await c.call('POST','/auth/register',{data:{email:'p@example.com',username:'Fine2',password:'short'}})).data.error,'password-too-short');
  assert.equal((await c.call('POST','/auth/register',{data:{email:'q@example.com',username:'Fine3',password:'fine3'.padEnd(8,'3')}})).status,200,'different from the name');
  assert.equal((await c.call('POST','/auth/register',{origin:'https://evil.example',data:{email:'z@example.com',username:'Evil1',password:'a long passphrase'}})).status,403);
 }finally{await c.close();}
});

test('password sign-in works by username or email and hides which part was wrong',async()=>{
 const c=await central();
 try{
  await c.register('Rook');
  for(const login of ['Rook','ROOK','rook@example.com',' Rook@Example.com ']){const r=await c.call('POST','/auth/password',{data:{login,password:'a long passphrase'}});assert.equal(r.status,200,login);assert.match(r.cookie,/^rlb_session=/);}
  const wrong=await c.call('POST','/auth/password',{data:{login:'Rook',password:'nope nope'}}),unknown=await c.call('POST','/auth/password',{data:{login:'Ghost',password:'nope nope'}});
  assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.equal(wrong.data.error,'invalid-credentials');assert.equal(unknown.data.error,'invalid-credentials');
 }finally{await c.close();}
});

test('ten failed sign-ins lock the account for 15 minutes',async()=>{
 const c=await central();
 try{
  await c.register('Rook');
  for(let i=0;i<10;i++)assert.equal((await c.call('POST','/auth/password',{data:{login:'rook',password:'wrong password '+i}})).status,401);
  const locked=await c.call('POST','/auth/password',{data:{login:'Rook',password:'a long passphrase'}});
  assert.equal(locked.status,429);assert.equal(locked.data.error,'account-locked');
  c.clock.t+=15*60e3+1;
  assert.equal((await c.call('POST','/auth/password',{data:{login:'Rook',password:'a long passphrase'}})).status,200);
 }finally{await c.close();}
});

test('failures by username and by email count against the same account',async()=>{
 const c=await central();
 try{
  await c.register('Rook');
  for(let i=0;i<10;i++)await c.call('POST','/auth/password',{data:{login:i%2?'rook':'ROOK@example.com',password:'wrong password '+i}});
  assert.equal((await c.call('POST','/auth/password',{data:{login:'rook@example.com',password:'a long passphrase'}})).data.error,'account-locked');
  assert.equal((await c.call('POST','/auth/password',{data:{login:'Rook',password:'a long passphrase'}})).data.error,'account-locked');
 }finally{await c.close();}
});

test('username availability check',async()=>{
 const c=await central();
 try{
  await c.register('Rook');
  assert.deepEqual((await c.call('GET','/auth/username-available?name=ROOK')).data,{available:false,reason:'username-taken'});
  assert.deepEqual((await c.call('GET','/auth/username-available?name=ad')).data,{available:false,reason:'invalid-username'});
  assert.deepEqual((await c.call('GET','/auth/username-available?name=Raven')).data,{available:true});
 }finally{await c.close();}
});

test('safeNext only allows same-origin paths',()=>{
 assert.equal(safeNext('/servers/x?join=1'),'/servers/x?join=1');
 assert.equal(safeNext('/account'),'/account');
 for(const bad of ['//evil.example','https://evil.example','/\\evil','\\\\evil','javascript:alert(1)','','servers',null,undefined,'/%2f%2fevil.example'])assert.equal(safeNext(bad),'/servers',String(bad));
});

const capture=()=>({enabled:true,sent:[],async send(m){this.sent.push(m);}});
const tokenFrom=(mail,path)=>new URL(mail.text.match(new RegExp(String.raw`https?://\S+`+path+String.raw`\?token=[\w-]+`))[0]).searchParams.get('token');

test('changing the password needs the current one and signs out other sessions',async()=>{
 const c=await central();
 try{
  const a=await c.register('Rook'),b=await c.call('POST','/auth/password',{data:{login:'Rook',password:'a long passphrase'}});
  const wrong=await c.call('POST','/account/password',{cookie:a.cookie,csrf:a.data.csrf,data:{current:'nope nope nope',next:'a newer passphrase'}});
  assert.deepEqual([wrong.status,wrong.data.error],[401,'invalid-credentials']);
  assert.equal((await c.call('POST','/account/password',{cookie:a.cookie,csrf:a.data.csrf,data:{current:'a long passphrase',next:'short'}})).data.error,'password-too-short');
  assert.equal((await c.call('POST','/account/password',{cookie:a.cookie,csrf:a.data.csrf,data:{current:'a long passphrase',next:'a newer passphrase'}})).status,200);
  assert.equal((await c.call('GET','/me',{cookie:a.cookie})).status,200,'this session stays');
  assert.equal((await c.call('GET','/me',{cookie:b.cookie})).status,401,'other sessions end');
  assert.equal((await c.call('POST','/auth/password',{data:{login:'Rook',password:'a newer passphrase'}})).status,200);
 }finally{await c.close();}
});

test('sign out everywhere keeps only the current session',async()=>{
 const c=await central();
 try{
  const a=await c.register('Rook'),b=await c.call('POST','/auth/password',{data:{login:'Rook',password:'a long passphrase'}});
  assert.equal((await c.call('POST','/account/sessions/revoke',{cookie:a.cookie,csrf:a.data.csrf})).status,200);
  assert.equal((await c.call('GET','/me',{cookie:a.cookie})).status,200);
  assert.equal((await c.call('GET','/me',{cookie:b.cookie})).status,401);
 }finally{await c.close();}
});

test('password reset by email works once and ends every session',async()=>{
 const mailer=capture(),c=await central({mailer});
 try{
  const a=await c.register('Rook');
  mailer.sent.length=0;
  assert.equal((await c.call('POST','/auth/forgot',{data:{email:'ghost@example.com'}})).status,202);
  assert.equal(mailer.sent.length,0,'no mail for unknown addresses, same answer');
  assert.equal((await c.call('POST','/auth/forgot',{data:{email:'ROOK@example.com'}})).status,202);
  assert.equal(mailer.sent.length,1);assert.equal(mailer.sent[0].to,'rook@example.com');
  assert.match(mailer.sent[0].html,/<!doctype html>/i);assert.ok(mailer.sent[0].html.includes(mailer.sent[0].text.match(/https?:\S+/)[0]),'the html has the same reset link as the text');
  const token=tokenFrom(mailer.sent[0],'/reset');
  assert.equal((await c.call('POST','/auth/reset',{data:{token,password:'short'}})).data.error,'password-too-short','rules apply and the link stays usable');
  assert.equal((await c.call('POST','/auth/reset',{data:{token,password:'a brand new passphrase'}})).status,200);
  assert.equal((await c.call('POST','/auth/reset',{data:{token,password:'another passphrase'}})).data.error,'invalid-token');
  assert.equal((await c.call('GET','/me',{cookie:a.cookie})).status,401,'sessions revoked');
  assert.equal((await c.call('POST','/auth/password',{data:{login:'rook',password:'a brand new passphrase'}})).status,200);
 }finally{await c.close();}
});

test('reset links expire after 30 minutes',async()=>{
 const mailer=capture(),c=await central({mailer});
 try{
  await c.register('Rook');await c.call('POST','/auth/forgot',{data:{email:'rook@example.com'}});
  const token=tokenFrom(mailer.sent.at(-1),'/reset');c.clock.t+=30*60e3+1;
  assert.equal((await c.call('POST','/auth/reset',{data:{token,password:'a brand new passphrase'}})).data.error,'invalid-token');
 }finally{await c.close();}
});

test('email verification and change',async()=>{
 const mailer=capture(),c=await central({mailer});
 try{
  const a=await c.register('Rook');
  const verify=mailer.sent.find(m=>/verify-email\?token=/.test(m.text));assert.ok(verify,'registration sends a verification link');
  assert.match(verify.html,/<!doctype html>/i);assert.ok(verify.html.includes(verify.text.match(/https?:\S+/)[0]),'the html has the same verification link as the text');
  const ok=await c.call('GET','/auth/verify-email?token='+tokenFrom(verify,'/auth/verify-email'));
  assert.equal(ok.status,302);assert.match(ok.location,/\/account\?verified=1$/);
  assert.equal((await c.call('GET','/me',{cookie:a.cookie})).data.emailVerified,true);
  assert.match((await c.call('GET','/auth/verify-email?token=used-or-made-up')).location,/verify_error=1/);
  await c.register('Other','other@example.com');
  assert.equal((await c.call('POST','/account/email',{cookie:a.cookie,csrf:a.data.csrf,data:{email:'OTHER@example.com',current:'a long passphrase'}})).data.error,'email-taken');
  const changed=await c.call('POST','/account/email',{cookie:a.cookie,csrf:a.data.csrf,data:{email:'new@example.com',current:'a long passphrase'}});
  assert.equal(changed.status,200);const me=(await c.call('GET','/me',{cookie:a.cookie})).data;assert.equal(me.email,'new@example.com');assert.equal(me.emailVerified,false);
 }finally{await c.close();}
});

test('changing the email needs the current password, or a fresh session for accounts without one',async()=>{
 const c=await central();
 try{
  const a=await c.register('Rook'),call=data=>c.call('POST','/account/email',{cookie:a.cookie,csrf:a.data.csrf,data});
  assert.deepEqual([(await call({email:'new@example.com'})).status,(await call({email:'new@example.com'})).data.error],[401,'invalid-credentials']);
  assert.equal((await call({email:'new@example.com',current:'wrong one'})).data.error,'invalid-credentials');
  assert.equal((await c.call('GET','/me',{cookie:a.cookie})).data.email,'rook@example.com');
  assert.equal((await call({email:'new@example.com',current:'a long passphrase'})).status,200);
  const dev=await c.call('POST','/auth/login',{data:{subject:'nopass',name:'NoPass'}}),devCall=()=>c.call('POST','/account/email',{cookie:dev.cookie,csrf:dev.data.csrf,data:{email:'nopass@example.com'}});
  c.clock.t+=16*60e3;assert.equal((await devCall()).data.error,'reauthenticate');
 }finally{await c.close();}
});

test('without a mailer, reset by email is unavailable',async()=>{
 const c=await central();
 try{await c.register('Rook');const r=await c.call('POST','/auth/forgot',{data:{email:'rook@example.com'}});assert.deepEqual([r.status,r.data.error],[404,'mail-disabled']);}
 finally{await c.close();}
});

test('accounts without a password set one only from a fresh session',async()=>{
 const c=await central();
 try{
  c.db.createAccount({uuid:'00000000-0000-4000-8000-0000000000aa',username:'Steamer',email:null,passwordHash:null,at:1});c.db.addIdentity('dev','steamer-dev','00000000-0000-4000-8000-0000000000aa',1);
  const s=await c.call('POST','/auth/login',{data:{subject:'steamer-dev'}});
  assert.equal((await c.call('POST','/account/password',{cookie:s.cookie,csrf:s.data.csrf,data:{next:'a fresh passphrase'}})).status,200);
  const s2=await c.call('POST','/auth/login',{data:{subject:'steamer-dev'}});
  c.db.setPassword('00000000-0000-4000-8000-0000000000aa',null,1);
  c.clock.t+=16*60e3;
  assert.equal((await c.call('POST','/account/password',{cookie:s2.cookie,csrf:s2.data.csrf,data:{next:'a fresh passphrase'}})).data.error,'reauthenticate');
 }finally{await c.close();}
});
