// Launch sign-up list (central/waitlist.mjs): public notify-me form, staff-only list and removal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';

const notify=(c,data,opts={})=>c.call('POST','/launch/notify',{data,...opts});

test('an email joins the list once, whatever its case or spaces, and every answer looks the same',async()=>{
 const c=await central();
 try{
  const a=await notify(c,{email:'Rook@Example.com'}),b=await notify(c,{email:'  rook@example.COM '});
  assert.deepEqual([a.status,a.data],[200,{ok:true}]);assert.deepEqual([b.status,b.data],[200,{ok:true}]);
  assert.deepEqual(c.db.waitlist().map(e=>e.email),['Rook@Example.com']);
 }finally{await c.close();}
});

test('bad input, other origins and the bot trap are refused or ignored',async()=>{
 const c=await central();
 try{
  assert.equal((await notify(c,{email:'not-an-email'})).data.error,'invalid-email');
  assert.equal((await notify(c,{email:'x@example.com'},{origin:'https://evil.example'})).status,403);
  const trap=await notify(c,{email:'bot@example.com',website:'http://spam'});
  assert.deepEqual([trap.status,trap.data],[200,{ok:true}]);
  assert.equal(c.db.waitlist().length,0);
 }finally{await c.close();}
});

test('only platform staff can see and remove sign-ups',async()=>{
 const c=await central();
 try{
  await notify(c,{email:'one@example.com'});c.clock.t+=60e3;await notify(c,{email:'two@example.com'});
  const staff=await c.register('Warden'),player=await c.register('Rook');
  c.db.addStaff(c.db.playerByUsernameKey('warden').uuid,c.clock.t);
  assert.equal((await c.call('GET','/admin/waitlist')).status,401);
  assert.equal((await c.call('GET','/admin/waitlist',{cookie:player.cookie})).data.error,'staff-only');
  const list=(await c.call('GET','/admin/waitlist',{cookie:staff.cookie})).data;
  assert.equal(list.count,2);assert.deepEqual(list.entries.map(e=>e.email),['two@example.com','one@example.com']);assert.ok(list.entries[0].createdAt>list.entries[1].createdAt);
  assert.equal((await c.call('POST','/admin/waitlist/remove',{data:{email:'ONE@example.com'},cookie:player.cookie,csrf:player.data.csrf})).data.error,'staff-only');
  assert.deepEqual((await c.call('POST','/admin/waitlist/remove',{data:{email:'ONE@example.com'},cookie:staff.cookie,csrf:staff.data.csrf})).data,{removed:true});
  assert.deepEqual(c.db.waitlist().map(e=>e.email),['two@example.com']);
  assert.ok(c.db.auditFor('waitlist').some(e=>e.action==='waitlist-remove'));
 }finally{await c.close();}
});

test('sign-ups from one address are rate limited',async()=>{
 const c=await central({rateLimit:3});
 try{
  const codes=[];for(let i=0;i<5;i++)codes.push((await notify(c,{email:`p${i}@example.com`})).status);
  assert.deepEqual(codes,[200,200,200,429,429]);
 }finally{await c.close();}
});
