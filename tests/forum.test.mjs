// Forum over HTTP (central/forum.mjs): categories, threads, replies, pages, edits, staff moderation and bans.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';
import {FORUM_CATEGORIES,POSTS_PER_PAGE,THREADS_PER_PAGE,FLOOD_MS} from '../central/forum.mjs';

async function people(c){
 const staff=await c.register('Warden'),player=await c.register('Rook'),other=await c.register('Bishop');
 c.db.addStaff(c.db.playerByUsernameKey('warden').uuid,c.clock.t);
 return {staff,player,other};
}
const as=(c,who)=>({
 post:(path,data={})=>c.call('POST',path,{data,cookie:who.cookie,csrf:who.data.csrf}),
 put:(path,data)=>c.call('PUT',path,{data,cookie:who.cookie,csrf:who.data.csrf}),
 get:path=>c.call('GET',path,{cookie:who.cookie}),
});
const wait=c=>{c.clock.t+=FLOOD_MS;};

test('anyone reads the categories; counts and the latest thread follow posts', async () => {
 const c=await central();
 try{
  const {player,other}=await people(c);
  let r=await c.call('GET','/forum/api/categories');
  assert.equal(r.status,200);assert.deepEqual(r.data.categories.map(x=>x.id),FORUM_CATEGORIES.map(x=>x.id));
  assert.equal(r.data.viewer,null);assert.ok(r.data.categories.every(x=>x.threads===0&&x.posts===0&&x.latest===null));
  const made=await as(c,player).post('/forum/api/categories/general/threads',{title:'  First   wipe  ',body:'Who is **in**?'});
  assert.equal(made.status,201);wait(c);
  assert.equal((await as(c,other).post(`/forum/api/threads/${made.data.id}/posts`,{body:'Me'})).status,201);
  r=await as(c,player).get('/forum/api/categories');
  const general=r.data.categories.find(x=>x.id==='general');
  assert.equal(general.threads,1);assert.equal(general.posts,2);
  assert.deepEqual(general.latest,{id:made.data.id,title:'First wipe',by:'Bishop',at:c.clock.t});
  assert.deepEqual(r.data.viewer,{name:'Rook',staff:false,canPost:true,reason:null});
  assert.equal(r.data.categories.find(x=>x.id==='announcements').staffOnly,true);
 }finally{await c.close();}
});

test('threads and replies: rendered markdown, post numbers, signed-out readers, edits by the author only', async () => {
 const c=await central();
 try{
  const {player,other}=await people(c);
  assert.equal((await c.call('POST','/forum/api/categories/help/threads',{data:{title:'Hello',body:'x'}})).status,401);
  const t=(await as(c,player).post('/forum/api/categories/help/threads',{title:'How do I craft?',body:'<script>x</script> **bold** [[item:Nothing]]'})).data.id;
  wait(c);const reply=(await as(c,other).post(`/forum/api/threads/${t}/posts`,{body:'Open the inventory.'})).data;
  assert.deepEqual(reply,{id:reply.id,page:1});
  const r=await c.call('GET',`/forum/api/threads/${t}`);
  assert.equal(r.status,200);assert.equal(r.data.thread.title,'How do I craft?');assert.equal(r.data.thread.category.id,'help');
  assert.deepEqual(r.data.posts.map(p=>[p.n,p.author,p.first]),[[1,'Rook',true],[2,'Bishop',false]]);
  assert.equal(r.data.posts[0].html,'<p>&lt;script&gt;x&lt;/script&gt; <strong>bold</strong> <span class="wiki-missing">Nothing</span></p>');
  assert.equal(r.data.posts[0].mine,false,'signed out: nothing is mine');assert.equal(r.data.viewer,null);
  const mine=(await as(c,player).get(`/forum/api/threads/${t}`)).data.posts.map(p=>p.mine);assert.deepEqual(mine,[true,false]);
  // Edits: author only, marked with the time.
  assert.equal((await as(c,other).put(`/forum/api/posts/${r.data.posts[0].id}`,{body:'hijack'})).data.error,'not-your-post');
  c.clock.t+=5000;assert.equal((await as(c,player).put(`/forum/api/posts/${r.data.posts[0].id}`,{body:'Fixed text'})).status,200);
  const edited=(await c.call('GET',`/forum/api/threads/${t}`)).data.posts[0];
  assert.equal(edited.body,'Fixed text');assert.equal(edited.editedAt,c.clock.t);
  // Bad input.
  wait(c);const p=as(c,player);
  assert.equal((await p.post('/forum/api/categories/help/threads',{title:'Hi',body:'x'})).data.error,'invalid-thread-title');
  assert.equal((await p.post('/forum/api/categories/help/threads',{title:'Long enough',body:'   '})).data.error,'empty-post');
  assert.equal((await p.post(`/forum/api/threads/${t}/posts`,{body:'x'.repeat(20_001)})).data.error,'post-too-long');
  assert.equal((await p.post('/forum/api/categories/nowhere/threads',{title:'Long enough',body:'x'})).status,404);
  assert.equal((await c.call('GET','/forum/api/threads/99999')).data.error,'unknown-thread');
  assert.equal((await c.call('GET','/forum/api/threads/abc')).status,404);
  assert.equal((await c.call('GET','/forum/api/categories/nowhere')).data.error,'unknown-category');
  // Mutations need the session's CSRF token and an allowed Origin.
  assert.equal((await c.call('POST',`/forum/api/threads/${t}/posts`,{data:{body:'x'},cookie:player.cookie})).data.error,'csrf');
  assert.equal((await c.call('POST',`/forum/api/threads/${t}/posts`,{data:{body:'x'},cookie:player.cookie,csrf:player.data.csrf,origin:'https://evil.test'})).data.error,'csrf');
 }finally{await c.close();}
});

test('flood control: one post per account per window; staff are exempt', async () => {
 const c=await central();
 try{
  const {staff,player}=await people(c);
  const t=(await as(c,player).post('/forum/api/categories/general/threads',{title:'Spam test',body:'one'})).data.id;
  const again=await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'two'});
  assert.equal(again.status,429);assert.equal(again.data.error,'posting-too-fast');
  c.clock.t+=FLOOD_MS-1;assert.equal((await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'two'})).status,429);
  c.clock.t+=1;assert.equal((await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'two'})).status,201);
  for(let i=0;i<3;i++)assert.equal((await as(c,staff).post(`/forum/api/threads/${t}/posts`,{body:'staff '+i})).status,201);
 }finally{await c.close();}
});

test('categories page threads: pinned first, then the latest reply; threads page by 25 and posts by 20', async () => {
 const c=await central();
 try{
  const {staff,player}=await people(c),s=as(c,staff);
  const ids=[];for(let i=0;i<THREADS_PER_PAGE+2;i++){c.clock.t+=1000;ids.push((await s.post('/forum/api/categories/servers/threads',{title:`Server ${i}`,body:'x'})).data.id);}
  // A reply bumps the oldest thread to the top; pinning the second oldest puts it above everything.
  wait(c);await as(c,player).post(`/forum/api/threads/${ids[0]}/posts`,{body:'bump'});
  assert.equal((await s.post(`/forum/api/threads/${ids[1]}/pin`,{pinned:true})).data.pinned,true);
  const p1=(await c.call('GET','/forum/api/categories/servers')).data;
  assert.equal(p1.total,THREADS_PER_PAGE+2);assert.equal(p1.pages,2);assert.equal(p1.threads.length,THREADS_PER_PAGE);
  assert.deepEqual(p1.threads.slice(0,3).map(t=>[t.id,t.pinned,t.replies]),[[ids[1],true,0],[ids[0],false,1],[ids.at(-1),false,0]]);
  assert.equal(p1.threads[1].lastBy,'Rook');
  const p2=(await c.call('GET','/forum/api/categories/servers?page=2')).data;assert.equal(p2.page,2);assert.equal(p2.threads.length,2);
  assert.equal((await c.call('GET','/forum/api/categories/servers?page=99')).data.page,2,'past the end: the last page');
  // Posts: 20 a page; ?post= opens the page holding that post; a reply answers with its page.
  const t=ids[2];let last;for(let i=0;i<POSTS_PER_PAGE;i++)last=(await s.post(`/forum/api/threads/${t}/posts`,{body:'r'+i})).data;
  assert.equal(last.page,2);
  const page2=(await c.call('GET',`/forum/api/threads/${t}?post=${last.id}`)).data;
  assert.equal(page2.page,2);assert.equal(page2.total,POSTS_PER_PAGE+1);assert.deepEqual(page2.posts.map(p=>p.n),[21]);
  assert.equal((await c.call('GET',`/forum/api/threads/${t}?page=1`)).data.posts.length,POSTS_PER_PAGE);
 }finally{await c.close();}
});

test('announcements: staff start threads, everyone replies', async () => {
 const c=await central();
 try{
  const {staff,player}=await people(c);
  const r=await as(c,player).post('/forum/api/categories/announcements/threads',{title:'Fake news',body:'x'});
  assert.equal(r.status,403);assert.equal(r.data.error,'staff-only');
  const t=(await as(c,staff).post('/forum/api/categories/announcements/threads',{title:'Servers open',body:'Today.'})).data.id;
  assert.equal((await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'Great'})).status,201);
 }finally{await c.close();}
});

test('staff moderation: lock, pin, delete posts and threads, all audited; players cannot moderate', async () => {
 const c=await central();
 try{
  const {staff,player,other}=await people(c),s=as(c,staff),p=as(c,player);
  const t=(await p.post('/forum/api/categories/general/threads',{title:'Trade thread',body:'Selling'})).data.id;
  wait(c);const bad=(await as(c,other).post(`/forum/api/threads/${t}/posts`,{body:'rude words'})).data.id;
  for(const action of ['pin','lock','delete'])assert.equal((await p.post(`/forum/api/threads/${t}/${action}`,{pinned:true,locked:true})).data.error,'staff-only');
  assert.equal((await p.post(`/forum/api/posts/${bad}/delete`)).data.error,'not-your-post');
  // Lock: players can no longer reply or edit; staff still can.
  assert.equal((await s.post(`/forum/api/threads/${t}/lock`,{locked:true})).status,200);
  wait(c);assert.equal((await p.post(`/forum/api/threads/${t}/posts`,{body:'Still selling'})).data.error,'thread-locked');
  const first=(await c.call('GET',`/forum/api/threads/${t}`)).data.posts[0].id;
  assert.equal((await p.put(`/forum/api/posts/${first}`,{body:'edit'})).data.error,'thread-locked');
  assert.equal((await s.post(`/forum/api/threads/${t}/posts`,{body:'Locked: take it to trade.'})).status,201);
  assert.equal((await c.call('GET',`/forum/api/threads/${t}`)).data.thread.locked,true);
  // Delete a reply: it stays as a numbered placeholder without its text.
  assert.equal((await s.post(`/forum/api/posts/${bad}/delete`)).status,200);
  const posts=(await c.call('GET',`/forum/api/threads/${t}`)).data.posts;
  assert.deepEqual(posts.map(x=>[x.n,x.deleted??null]),[[1,null],[2,'staff'],[3,null]]);
  assert.equal(posts[1].body,undefined);assert.equal(posts[1].html,undefined);
  assert.equal((await s.post(`/forum/api/posts/${bad}/delete`)).status,404,'already deleted');
  assert.equal((await s.post(`/forum/api/posts/${first}/delete`)).data.error,'first-post','the first post goes with its thread');
  // Delete the thread: gone from its category and its page.
  assert.deepEqual((await s.post(`/forum/api/threads/${t}/delete`)).data,{deleted:true,category:'general'});
  assert.equal((await c.call('GET',`/forum/api/threads/${t}`)).status,404);
  assert.equal((await c.call('GET','/forum/api/categories/general')).data.total,0);
  assert.equal((await c.call('GET','/forum/api/categories')).data.categories.find(x=>x.id==='general').threads,0);
  assert.deepEqual(c.db.auditFor(`forum-thread:${t}`).map(e=>e.action),['forum-lock','forum-delete-thread']);
  assert.deepEqual(c.db.auditFor(`forum-post:${bad}`).map(e=>e.action),['forum-delete-post']);
 }finally{await c.close();}
});

test('authors delete their own replies; the audit shows it was theirs', async () => {
 const c=await central();
 try{
  const {player,other}=await people(c);
  const t=(await as(c,player).post('/forum/api/categories/general/threads',{title:'Mine',body:'x'})).data.id;
  wait(c);const r=(await as(c,other).post(`/forum/api/threads/${t}/posts`,{body:'oops'})).data.id;
  assert.equal((await as(c,other).post(`/forum/api/posts/${r}/delete`)).status,200);
  assert.equal((await c.call('GET',`/forum/api/threads/${t}`)).data.posts[1].deleted,'author');
  assert.deepEqual(JSON.parse(c.db.auditFor(`forum-post:${r}`)[0].detail),{thread:t});
 }finally{await c.close();}
});

test('forum bans, network bans, suspended accounts and missing usernames stop posting', async () => {
 const c=await central();
 try{
  const {staff,player,other}=await people(c),s=as(c,staff);
  const t=(await s.post('/forum/api/categories/general/threads',{title:'Open thread',body:'x'})).data.id;
  assert.equal((await as(c,player).post('/forum/api/bans',{name:'Bishop',reason:'spam'})).data.error,'staff-only');
  assert.equal((await s.post('/forum/api/bans',{name:'Warden',reason:'x'})).data.error,'cannot-ban-staff');
  assert.equal((await s.post('/forum/api/bans',{name:'Nobody',reason:'x'})).data.error,'unknown-player');
  assert.equal((await s.post('/forum/api/bans',{name:'Rook',reason:''})).data.error,'reason-required');
  assert.equal((await s.post('/forum/api/bans',{name:'Rook',reason:'x',days:0})).data.error,'invalid-days');
  // A 2-day ban: refused while it lasts, listed for staff, then it ends by itself.
  assert.deepEqual((await s.post('/forum/api/bans',{name:'rook',reason:'Spam links',days:2})).data,{name:'Rook',expiresAt:c.clock.t+2*86400e3});
  const refused=await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'hi'});
  assert.equal(refused.status,403);assert.equal(refused.data.error,'forum-banned');
  assert.deepEqual((await as(c,player).get('/forum/api/categories')).data.viewer,{name:'Rook',staff:false,canPost:false,reason:'forum-banned'});
  assert.deepEqual((await s.get('/forum/api/bans')).data.map(b=>[b.name,b.reason,b.by]),[['Rook','Spam links','Warden']]);
  assert.equal((await as(c,player).get('/forum/api/bans')).data.error,'staff-only');
  c.clock.t+=2*86400e3;
  assert.equal((await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'back'})).status,201);
  assert.deepEqual((await s.get('/forum/api/bans')).data,[]);
  // Permanent until removed.
  await s.post('/forum/api/bans',{name:'Rook',reason:'Again'});c.clock.t+=3*86400e3;
  assert.equal((await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'x'})).data.error,'forum-banned');
  assert.equal((await s.post('/forum/api/bans/remove',{name:'Rook'})).data.removed,true);
  assert.equal((await as(c,player).post(`/forum/api/threads/${t}/posts`,{body:'x'})).status,201);
  const rook=c.db.playerByUsernameKey('rook').uuid;
  assert.deepEqual(c.db.auditFor(rook).filter(e=>e.action.startsWith('forum')).map(e=>e.action),['forum-ban','forum-ban','forum-unban']);
  // A network ban (every server) also stops posting; a ban on one server does not.
  const bishop=c.db.playerByUsernameKey('bishop').uuid;
  c.db.addBan({id:'b1',player:bishop,reason:'cheating',by:rook,at:c.clock.t});
  assert.equal((await as(c,other).post(`/forum/api/threads/${t}/posts`,{body:'x'})).data.error,'banned');
  c.db.revokeBan('b1',rook,c.clock.t);assert.equal((await as(c,other).post(`/forum/api/threads/${t}/posts`,{body:'x'})).status,201);
  // A suspended account is refused before anything else.
  c.db.setPlayerStatus(bishop,'suspended');c.clock.t+=FLOOD_MS;
  assert.equal((await as(c,other).post(`/forum/api/threads/${t}/posts`,{body:'x'})).data.error,'account-suspended');
  // An account still choosing its username (provider sign-in before phase 1) reads but cannot post.
  const legacy=await c.call('POST','/auth/login',{data:{subject:'old.name',name:'Old'}});
  const v=(await c.call('GET','/forum/api/categories',{cookie:legacy.cookie})).data.viewer;
  assert.equal(v.canPost,false);assert.equal(v.reason,'username-required');
  assert.equal((await c.call('POST',`/forum/api/threads/${t}/posts`,{data:{body:'x'},cookie:legacy.cookie,csrf:legacy.data.csrf})).data.error,'username-required');
 }finally{await c.close();}
});
