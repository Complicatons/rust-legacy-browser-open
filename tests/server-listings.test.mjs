// Listing a server (SERVER-MANAGEMENT-PLAN.md sections 2 and 3): the owner's listing form, site staff's review queue,
// the details on the public server list, and the site staff panel (every server, suspend). Every staff route is
// closed to owners and players.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';

async function setup(opts={}){
 const c=await central(opts);
 const sign=async subject=>{const r=await c.call('POST','/auth/login',{data:{subject,name:subject}});return {cookie:r.cookie,csrf:r.data.csrf,player:r.data.player};};
 const owner=await sign('owner'),staff=await sign('warden'),player=await sign('player');
 c.db.addStaff(staff.player,c.clock.t);
 const made=await c.call('POST','/owner/servers',{data:{name:'Dusk Legacy',region:'eu',endpoint:'wss://dusk.example.test/play'},...owner});
 const id=made.data.id;
 // Enrol and heartbeat so the server counts as online.
 const enrol=await c.call('POST','/bridge/enrol',{data:{code:made.data.enrolmentCode}});
 const beat=()=>fetch(c.base+'/bridge/heartbeat',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+enrol.data.credential},body:JSON.stringify({players:7,capacity:100})});
 await beat();
 return {c,owner,staff,player,id,beat};
}
const listing={description:'Vanilla 2013 Legacy, weekly wipes, active admins.',tags:['vanilla','pvp','weekly wipe'],discord:'https://discord.gg/abc123',website:'https://dusk.example.test/',wipe:'Thursdays 18:00 UTC',language:'English',agree:true};

test('with review on, a submitted listing waits for site staff; approval lists it with its details', async () => {
 const {c,owner,staff,id}=await setup({listingReview:true});
 try{
  assert.equal((await c.call('POST',`/owner/servers/${id}/publish`,{data:{listed:true},...owner})).status,409,'no approved listing yet');
  assert.equal((await c.call('POST',`/owner/servers/${id}/listing`,{data:{...listing,agree:false},...owner})).status,400,'the listing rules must be accepted');
  assert.equal((await c.call('POST',`/owner/servers/${id}/listing`,{data:{...listing,discord:'https://evil.example/'},...owner})).status,400,'Discord invites only');
  const sub=await c.call('POST',`/owner/servers/${id}/listing`,{data:listing,...owner});
  assert.equal(sub.status,200);assert.equal(sub.data.state,'pending');
  assert.equal((await c.call('GET','/servers')).data.servers.length,0);
  const mine=await c.call('GET',`/owner/servers/${id}/listing`,owner);
  assert.equal(mine.data.listing.state,'pending');assert.equal(mine.data.reviewRequired,true);
  const queue=await c.call('GET','/staff/listings?state=pending',staff);
  assert.deepEqual(queue.data.listings.map(l=>[l.server,l.name,l.owner]),[[id,'Dusk Legacy','owner']]);
  const ok=await c.call('POST',`/staff/servers/${id}/listing-review`,{data:{decision:'approve'},...staff});
  assert.equal(ok.status,200);assert.equal(ok.data.listed,true);
  const pub=(await c.call('GET','/servers')).data.servers[0];
  assert.equal(pub.name,'Dusk Legacy');assert.equal(pub.description,listing.description);assert.deepEqual(pub.tags,listing.tags);
  assert.equal(pub.discord,listing.discord);assert.equal(pub.wipeSchedule,listing.wipe);
  // Once approved the owner can hide and show it again without another review.
  assert.equal((await c.call('POST',`/owner/servers/${id}/publish`,{data:{listed:false},...owner})).status,200);
  assert.equal((await c.call('POST',`/owner/servers/${id}/publish`,{data:{listed:true},...owner})).status,200);
 }finally{await c.close();}
});

test('a rejected listing tells the owner why and can be sent again', async () => {
 const {c,owner,staff,id}=await setup({listingReview:true});
 try{
  await c.call('POST',`/owner/servers/${id}/listing`,{data:listing,...owner});
  assert.equal((await c.call('POST',`/staff/servers/${id}/listing-review`,{data:{decision:'reject'},...staff})).status,400,'a rejection needs a note');
  await c.call('POST',`/staff/servers/${id}/listing-review`,{data:{decision:'reject',note:'Add your rules to the description.'},...staff});
  const mine=await c.call('GET',`/owner/servers/${id}/listing`,owner);
  assert.equal(mine.data.listing.state,'rejected');assert.equal(mine.data.listing.note,'Add your rules to the description.');
  const again=await c.call('POST',`/owner/servers/${id}/listing`,{data:{...listing,description:listing.description+' Rules: no cheating.'},...owner});
  assert.equal(again.data.state,'pending');
 }finally{await c.close();}
});

test('with review off (test stacks), submitting approves and lists at once and publish works as before', async () => {
 const {c,owner,id}=await setup();
 try{
  const sub=await c.call('POST',`/owner/servers/${id}/listing`,{data:listing,...owner});
  assert.equal(sub.data.state,'approved');assert.equal(sub.data.listed,true);
  assert.equal((await c.call('GET','/servers')).data.servers.length,1);
 }finally{await c.close();}
 const t=await setup();
 try{assert.equal((await t.c.call('POST',`/owner/servers/${t.id}/publish`,{data:{listed:true},...t.owner})).status,200,'no listing needed');}
 finally{await t.c.close();}
});

test('site staff panel: every server with its health; owners and players get 403 on every staff route', async () => {
 const {c,owner,staff,player,id}=await setup({listingReview:true});
 try{
  const other=await c.call('POST','/owner/servers',{data:{name:'Quiet Isle',region:'na',endpoint:'wss://quiet.example.test/play'},...player});
  const all=await c.call('GET','/staff/servers',staff);
  assert.equal(all.status,200);
  const dusk=all.data.servers.find(s=>s.id===id);
  assert.equal(dusk.owner,'owner');assert.equal(dusk.online,true);assert.equal(dusk.players,7);assert.equal(dusk.capacity,100);
  assert.equal(dusk.status,'active');assert.equal(dusk.listing,null);assert.equal(dusk.hostApp.connected,false);
  for(const k of ['flags24h','openReports','holds'])assert.equal(dusk[k],0,k);
  assert.equal(all.data.servers.find(s=>s.id===other.data.id).online,false);
  for(const who of [owner,player]){
   assert.equal((await c.call('GET','/staff/servers',who)).status,403);
   assert.equal((await c.call('GET','/staff/listings',who)).status,403);
   assert.equal((await c.call('POST',`/staff/servers/${id}/listing-review`,{data:{decision:'approve'},...who})).status,403);
   assert.equal((await c.call('POST',`/staff/servers/${id}/suspend`,{data:{suspended:true,reason:'x'},...who})).status,403);
  }
  assert.equal((await c.call('GET','/staff/servers')).status,401);
 }finally{await c.close();}
});

test('suspending a server takes it off the list and stops its gateway; restoring brings it back', async () => {
 const {c,owner,staff,id,beat}=await setup();
 try{
  await c.call('POST',`/owner/servers/${id}/listing`,{data:listing,...owner});
  assert.equal((await c.call('POST',`/staff/servers/${id}/suspend`,{data:{suspended:true},...staff})).status,400,'a reason is required');
  assert.equal((await c.call('POST',`/staff/servers/${id}/suspend`,{data:{suspended:true,reason:'Cheating admins'},...staff})).status,200);
  assert.equal((await c.call('GET','/servers')).data.servers.length,0);
  assert.equal((await beat()).status,401,'its gateway credential stops working');
  const mine=(await c.call('GET','/owner/servers',owner)).data.servers[0];
  assert.equal(mine.status,'suspended');
  assert.equal((await c.call('POST',`/owner/servers/${id}/publish`,{data:{listed:true},...owner})).status,409,'the owner cannot relist it');
  await c.call('POST',`/staff/servers/${id}/suspend`,{data:{suspended:false},...staff});
  assert.equal((await beat()).status,200);
  assert.equal((await c.call('GET','/servers')).data.servers.length,1,'listed again as before');
  assert.deepEqual(c.db.raw.prepare("select action from audit_events where target=? and action like 'server-%' order by id").all(id).map(r=>r.action).filter(a=>/suspend|restore|listing/.test(a)),['server-listing-submitted','server-suspended','server-restored']);
 }finally{await c.close();}
});
