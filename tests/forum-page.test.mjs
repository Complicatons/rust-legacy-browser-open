// The forum page script (site/js/forum.mjs) against a real central in a tiny fake DOM (tests/helpers/fake-dom.mjs):
// every view renders, the composer posts and edits, staff tools pin, ban and delete. No browser: the rendered check
// with layout and screenshots is tools/check-site.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central,ORIGIN} from './helpers/central-fixture.mjs';
import {installDom} from './helpers/fake-dom.mjs';
import {FLOOD_MS} from '../central/forum.mjs';

const realFetch=globalThis.fetch;
let n=0;
test('forum pages: read, post, reply, edit, moderate', async () => {
 const c=await central();let cookie=null;
 globalThis.fetch=(path,opts={})=>String(path).startsWith('http')?realFetch(path,opts):realFetch(c.base+path,{...opts,headers:{...opts.headers,origin:ORIGIN,...(cookie?{cookie}:{})}});
 globalThis.confirm=()=>true;
 const {loadSession}=await import('../site/js/session.mjs');
 // A fresh page at url, as `who` (null = signed out): the page script runs to its first render.
 async function open(url,who){
  cookie=who?.cookie??null;const dom=installDom(url);
  const main=dom.el('main'),crumbs=dom.el('nav'),box=dom.el('div');crumbs.setAttribute('id','fm-crumbs');box.setAttribute('id','fm-main');main.append(crumbs,box);dom.body.append(main);
  await loadSession({refresh:true});await import('../site/js/forum.mjs?page='+(++n));
  assert.equal(dom.body.dataset.ready,'1',url);
  const button=text=>dom.document.querySelectorAll('button').find(b=>b.textContent===text);
  return {...dom,main:box,crumbs,button,text:()=>box.textContent};
 }
 try{
  const staff=await c.register('Warden'),rook=await c.register('Rook');c.db.addStaff(c.db.playerByUsernameKey('warden').uuid,c.clock.t);
  // Index, signed out: the categories with numbers, no moderation panel.
  let p=await open('/forum',null);
  assert.match(p.text(),/Announcements[\s\S]*General[\s\S]*Bug reports/);assert.equal(p.document.querySelector('#fm-mod'),null);
  assert.equal(p.crumbs.textContent,'Forum');
  // A category: signed out sees "Sign in to post"; signed in opens the composer and posts a thread.
  p=await open('/forum/general',null);assert.match(p.text(),/Sign in to post[\s\S]*No threads yet/);
  p=await open('/forum/general',rook);
  await p.document.querySelector('#fm-new-btn').click();assert.equal(p.document.querySelector('#fm-new').hidden,false);
  p.document.querySelector('#fm-title').value='First wipe';p.document.querySelector('#fm-body').value='Who is **in**?';
  await p.document.querySelector('form').dispatch('submit');
  const to=p.location.assigned.at(-1),id=/^\/forum\/t\/(\d+)$/.exec(to)?.[1];assert.ok(id,`went to the thread (${to})`);
  // The thread: the post renders, then a reply goes to its page and anchor.
  c.clock.t+=FLOOD_MS;p=await open(to,rook);
  assert.equal(p.document.querySelectorAll('.fm-post').length,1);assert.equal(p.document.querySelector('.fm-post-b').innerHTML,'<p>Who is <strong>in</strong>?</p>');
  assert.match(p.crumbs.textContent,/ForumGeneralFirst wipe/);
  p.document.querySelector('#fm-reply').querySelector('textarea').value='Me too';
  await p.document.querySelector('#fm-reply').querySelector('form').dispatch('submit');
  assert.match(p.location.assigned.at(-1),new RegExp(`^/forum/t/${id}\\?page=1#p\\d+$`));
  assert.equal(p.document.querySelectorAll('.fm-post').length,2,'re-rendered on the same page');
  // Edit the first post in place.
  await p.button('Edit').click();p.document.querySelector('.fm-post').querySelector('textarea').value='Edited text';
  await p.document.querySelector('.fm-post').querySelector('form').dispatch('submit');
  assert.equal(p.document.querySelector('.fm-post-b').innerHTML,'<p>Edited text</p>');assert.match(p.document.querySelector('.fm-post-h').textContent,/edited/);
  assert.equal(p.button('Pin'),undefined,'no staff tools for players');
  // Staff: pin, ban the author from posting, delete the reply.
  p=await open(`/forum/t/${id}`,staff);
  await p.button('Pin').click();assert.ok(p.button('Unpin'),'the button flips');assert.equal((await c.call('GET',`/forum/api/threads/${id}`)).data.thread.pinned,true);
  await p.button('Ban author').click();const ban=p.document.querySelector('.fm-ban');ban.querySelector('[name=reason]').value='Spam';
  await ban.dispatch('submit');assert.deepEqual((await c.call('GET','/forum/api/bans',{cookie:staff.cookie})).data.map(b=>b.name),['Rook']);
  await p.document.querySelectorAll('.fm-post')[1].querySelectorAll('button').find(b=>b.textContent==='Delete').click();
  assert.match(p.document.querySelectorAll('.fm-post')[1].textContent,/Removed by staff/);
  // The index for staff lists the ban; the banned player is told why they cannot post.
  p=await open('/forum',staff);await new Promise(r=>setTimeout(r,50));
  assert.match(p.document.querySelector('#fm-mod').textContent,/Rook[\s\S]*Spam[\s\S]*Until removed/);
  assert.match(p.text(),/GeneralAnything Rust Legacy1Threads1PostsFirst wipeRook/);
  p=await open(`/forum/t/${id}`,rook);assert.match(p.document.querySelector('#fm-reply').textContent,/cannot post/);
  // Staff delete the thread and land on its category; a missing thread shows Not found.
  p=await open(`/forum/t/${id}`,staff);await p.button('Delete thread').click();assert.equal(p.location.assigned.at(-1),'/forum/general');
  p=await open(`/forum/t/${id}`,null);assert.match(p.text(),/Not found/);
 }finally{globalThis.fetch=realFetch;await c.close();}
});
