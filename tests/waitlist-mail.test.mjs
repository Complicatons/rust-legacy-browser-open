// The opening-day email to the launch list (central/waitlist.mjs): staff test send, the mailing itself, unsubscribe.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';

// A mailer that records what it would send; addresses in `fail` are refused like a bad mailbox.
const fakeMailer=(fail=[])=>{const sent=[];return {enabled:true,from:'hello@play.example.test',sent,async send(m){if(fail.includes(m.to))throw new Error('550 mailbox unavailable');sent.push(m);}};};
const notify=(c,email)=>c.call('POST','/launch/notify',{data:{email}});
async function withStaff(c){
 const staff=await c.register('Warden');c.db.addStaff(c.db.playerByUsernameKey('warden').uuid,c.clock.t);
 // Registering sends a verification email through the same mailer: start each test from an empty outbox.
 c.mailer?.sent?.splice(0);
 const as=(method,path,data)=>c.call(method,path,{data,cookie:staff.cookie,csrf:staff.data.csrf});
 return {staff,as};
}
async function finished(as,id){
 for(let i=0;i<100;i++){const m=(await as('GET','/admin/waitlist')).data.mailings.find(x=>x.id===id);if(m?.finishedAt)return m;await new Promise(r=>setTimeout(r,20));}
 throw new Error('mailing never finished');
}

test('a test send goes only to the staff member, with the footer people will see', async()=>{
 const mailer=fakeMailer(),c=await central({mailer});
 try{
  c.mailer=mailer;const {as}=await withStaff(c);await notify(c,'rook@example.com');
  const r=await as('POST','/admin/waitlist/mail',{subject:'Servers are open',text:'Come and play.',test:true});
  assert.deepEqual([r.status,r.data],[200,{sent:1,to:'warden@example.com'}]);
  assert.equal(mailer.sent.length,1);assert.equal(mailer.sent[0].to,'warden@example.com');assert.equal(mailer.sent[0].subject,'[Test] Servers are open');
  assert.match(mailer.sent[0].text,/^Come and play\.\n\n—\nYou're getting this because you signed up at https:\/\/play\.example\.test\/launch/);
  assert.match(mailer.sent[0].text,/Unsubscribe: https:\/\/play\.example\.test\/unsubscribe\?t=test/);
  assert.match(mailer.sent[0].html,/<!doctype html>/i);assert.match(mailer.sent[0].html,/Come and play\./);
  assert.match(mailer.sent[0].html,/href="https:\/\/play\.example\.test\/unsubscribe\?t=test"[^>]*>Unsubscribe</);
  assert.equal((await as('GET','/admin/waitlist')).data.mailings.length,0,'a test is not a mailing');
 }finally{await c.close();}
});

test('the mailing reaches everyone on the list once, each with their own unsubscribe link', async()=>{
 const mailer=fakeMailer(['bad@example.com']),c=await central({mailer});
 try{
  c.mailer=mailer;const {as}=await withStaff(c);for(const e of ['one@example.com','bad@example.com','two@example.com'])await notify(c,e);
  const r=await as('POST','/admin/waitlist/mail',{subject:'Servers are open',text:'Come and play.'});
  assert.equal(r.status,202);assert.equal(r.data.total,3);
  const m=await finished(as,r.data.mailing);
  assert.deepEqual([m.total,m.sent,m.failed,m.subject],[3,2,1,'Servers are open']);
  assert.deepEqual(mailer.sent.map(x=>x.to).sort(),['one@example.com','two@example.com']);
  const links=mailer.sent.map(x=>/unsubscribe\?t=([0-9a-f]{32})/.exec(x.text)[1]);assert.notEqual(links[0],links[1]);
  for(const x of mailer.sent){
   assert.match(x.headers['List-Unsubscribe'],/^<https:\/\/play\.example\.test\/launch\/unsubscribe\?t=[0-9a-f]{32}>$/);
   assert.equal(x.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  }
  // Resuming sends only to those it has not reached (the refused address is tried again).
  const again=await as('POST','/admin/waitlist/mail/resume',{mailing:r.data.mailing});assert.equal(again.status,202);
  const m2=await finished(as,r.data.mailing);assert.equal(mailer.sent.length,2,'nobody gets it twice');assert.equal(m2.sent,2);
  assert.ok(c.db.auditFor('waitlist').some(e=>e.action==='waitlist-mail'));
 }finally{await c.close();}
});

test('the unsubscribe link takes an address off the list, also as a one-click POST from a mail app', async()=>{
 const mailer=fakeMailer(),c=await central({mailer});
 try{
  c.mailer=mailer;const {as}=await withStaff(c);await notify(c,'one@example.com');await notify(c,'two@example.com');
  const r=await as('POST','/admin/waitlist/mail',{subject:'Hello',text:'x'});await finished(as,r.data.mailing);
  const token=e=>/unsubscribe\?t=([0-9a-f]{32})/.exec(mailer.sent.find(x=>x.to===e).text)[1];
  // From the page: JSON with the token.
  assert.deepEqual((await c.call('POST','/launch/unsubscribe',{data:{token:token('one@example.com')}})).data,{ok:true});
  // RFC 8058 one-click: a form POST to the List-Unsubscribe URL, no Origin.
  const res=await fetch(c.base+'/launch/unsubscribe?t='+token('two@example.com'),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});
  assert.equal(res.status,200);
  assert.deepEqual(c.db.waitlist(),[]);
  assert.deepEqual((await c.call('POST','/launch/unsubscribe',{data:{token:'0'.repeat(32)}})).data,{ok:true},'unknown tokens look the same');
 }finally{await c.close();}
});

test('without a mail provider, or without staff rights, nothing is sent', async()=>{
 const c=await central();
 try{
  const {as}=await withStaff(c);await notify(c,'one@example.com');
  assert.equal((await as('GET','/admin/waitlist')).data.mail,false);
  assert.deepEqual([(await as('POST','/admin/waitlist/mail',{subject:'Hi',text:'x'})).status,(await as('POST','/admin/waitlist/mail',{subject:'Hi',text:'x'})).data.error],[409,'mail-disabled']);
  const rook=await c.register('Rook');
  assert.equal((await c.call('POST','/admin/waitlist/mail',{data:{subject:'Hi',text:'x'},cookie:rook.cookie,csrf:rook.data.csrf})).data.error,'staff-only');
 }finally{await c.close();}
 const c2=await central({mailer:fakeMailer()});
 try{
  const {as}=await withStaff(c2);
  assert.equal((await as('POST','/admin/waitlist/mail',{subject:'',text:'x'})).data.error,'subject-required');
  assert.equal((await as('POST','/admin/waitlist/mail',{subject:'Hi',text:' '})).data.error,'text-required');
  assert.equal((await as('POST','/admin/waitlist/mail',{subject:'Hi',text:'x'})).data.error,'list-empty');
 }finally{await c2.close();}
});
