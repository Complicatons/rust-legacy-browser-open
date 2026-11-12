// Account passwords and rules (central/passwords.mjs) and the player schema migration (central/db.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {hashPassword,verifyPassword,checkUsername,checkEmail,checkPassword,usernameKey,emailKey} from '../central/passwords.mjs';
import {openCentralDb} from '../central/db.mjs';

test('password hashes verify only the right password',async()=>{
 const stored=await hashPassword('correct horse');
 assert.match(stored,/^scrypt\$15\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
 assert.equal(await verifyPassword('correct horse',stored),true);
 assert.equal(await verifyPassword('correct horsf',stored),false);
 assert.notEqual(await hashPassword('correct horse'),stored,'salted');
 for(const bad of ['', 'scrypt$15$8$1$x', 'bcrypt$...', null])assert.equal(await verifyPassword('correct horse',bad),false);
});

test('username rules',()=>{
 assert.equal(checkUsername('ab'),'invalid-username');
 assert.equal(checkUsername('_abc'),'invalid-username');
 assert.equal(checkUsername('has space'),'invalid-username');
 assert.equal(checkUsername('x'.repeat(21)),'invalid-username');
 assert.equal(checkUsername('Admin'),'reserved-username');
 assert.equal(checkUsername('RustLegacy'),'reserved-username');
 assert.equal(checkUsername('Rook_99'),null);
 assert.equal(checkUsername('r-1'),null);
 assert.equal(usernameKey('  Rook '),'rook');
});

test('email and password rules',()=>{
 assert.equal(checkEmail('a@b'),'invalid-email');
 assert.equal(checkEmail('not an email'),'invalid-email');
 assert.equal(checkEmail(' rook@example.com '),null);
 assert.equal(checkEmail('x'.repeat(250)+'@a.io'),'invalid-email');
 assert.equal(emailKey(' Rook@Example.com '),'rook@example.com');
 assert.equal(checkPassword('short',{}),'password-too-short');
 assert.equal(checkPassword('x'.repeat(129),{}),'password-too-long');
 assert.equal(checkPassword('RookRook',{username:'rookrook'}),'password-matches-name');
 assert.equal(checkPassword('Rook@Example.com',{email:'rook@example.com'}),'password-matches-name');
 assert.equal(checkPassword('a long passphrase',{username:'rook',email:'rook@example.com'}),null);
});

test('opening an old central database adds account columns and keeps players',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-db-')),file=join(dir,'central.db');
 try{
  const old=new DatabaseSync(file);
  old.exec("create table players(uuid text primary key, display_name text not null, status text not null default 'active', created_at integer not null)");
  old.prepare('insert into players(uuid,display_name,created_at) values(?,?,?)').run('p-1','Old Timer',1);old.close();
  const db=openCentralDb(file);
  const cols=db.raw.prepare('pragma table_info(players)').all().map(c=>c.name);
  for(const c of ['username','username_key','email','email_key','email_verified_at','password_hash','password_changed_at'])assert.ok(cols.includes(c),c);
  const p=db.player('p-1');assert.equal(p.display_name,'Old Timer');assert.equal(p.username,null);
  db.close();
  openCentralDb(file).close(); // a second open is a no-op migration
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('accounts are unique by case-insensitive username and email',()=>{
 const db=openCentralDb();
 db.createAccount({uuid:'a',username:'Rook',email:'rook@example.com',passwordHash:'h',at:1});
 assert.equal(db.player('a').display_name,'Rook');
 assert.equal(db.playerByUsernameKey('rook').uuid,'a');
 assert.equal(db.playerByEmailKey('rook@example.com').uuid,'a');
 assert.throws(()=>db.createAccount({uuid:'b',username:'rook',email:'other@example.com',passwordHash:'h',at:2}),/UNIQUE/);
 assert.throws(()=>db.createAccount({uuid:'c',username:'Other',email:'ROOK@example.com',passwordHash:'h',at:3}),/UNIQUE/);
 db.createAccount({uuid:'d',username:'NoMail',email:null,passwordHash:null,at:4});
 db.createAccount({uuid:'e',username:'NoMail2',email:null,passwordHash:null,at:5}); // many accounts without email
});

test('password resets and email verifications are one-use and expire',()=>{
 const db=openCentralDb();
 db.createAccount({uuid:'a',username:'Rook',email:'rook@example.com',passwordHash:'h',at:1});
 db.addPasswordReset('t1','a',100);
 assert.equal(db.usePasswordReset('t1',50),'a');
 assert.equal(db.usePasswordReset('t1',60),null,'used');
 db.addPasswordReset('t2','a',100);
 assert.equal(db.usePasswordReset('t2',150),null,'expired');
 db.addEmailVerification('v1','a','rook@example.com',100);
 assert.deepEqual(db.useEmailVerification('v1',10),{uuid:'a',email:'rook@example.com'});
 assert.equal(db.useEmailVerification('v1',11),null);
 db.markEmailVerified('a',10);assert.equal(db.player('a').email_verified_at,10);
 db.setPassword('a','h2',20);assert.equal(db.player('a').password_hash,'h2');assert.equal(db.player('a').password_changed_at,20);
});
