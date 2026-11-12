// Forum page helpers (site/js/forum-view.mjs) and the forum's page routes, tab and nav (central/site.mjs, shell-state).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forumRoute,ago,dateLabel,pageList,postGate,banUntil} from '../site/js/forum-view.mjs';
import {pageFor} from '../central/site.mjs';
import {navState} from '../site/js/shell-state.mjs';

test('forum routes: index, category, thread; the API and odd paths are not pages', () => {
 assert.deepEqual(forumRoute('/forum'),{view:'index'});
 assert.deepEqual(forumRoute('/forum/help'),{view:'category',category:'help'});
 assert.deepEqual(forumRoute('/forum/t/42'),{view:'thread',id:'42'});
 for(const p of ['/forum/t','/forum/t/x','/forum/Help','/forum/help/2','/wiki'])assert.equal(forumRoute(p),null,p);
 assert.equal(pageFor('/forum'),'forum');assert.equal(pageFor('/forum/general'),'forum');assert.equal(pageFor('/forum/t/7'),'forum');
 for(const p of ['/forum/api','/forum/api/categories','/forum/t','/forum/t/abc','/forum/a/b'])assert.equal(pageFor(p),null,p);
 assert.equal(navState('/forum/t/7'),'forum');
});

test('short times and dates', () => {
 const now=Date.UTC(2026,9,22,12);
 assert.equal(ago(now-30e3,now),'now');assert.equal(ago(now-5*60e3,now),'5m');assert.equal(ago(now-3*3600e3,now),'3h');
 assert.equal(ago(now-12*86400e3,now),'12d');assert.equal(ago(Date.UTC(2026,0,2),now),'2 Jan 2026');
 assert.equal(dateLabel(now),'22 Oct 2026');assert.equal(banUntil(null),'Until removed');
});

test('page links keep the ends and the neighbours', () => {
 assert.deepEqual(pageList(1,1),[]);
 assert.deepEqual(pageList(1,3),[1,2,3]);
 assert.deepEqual(pageList(6,12),[1,null,4,5,6,7,8,null,12]);
 assert.deepEqual(pageList(1,9),[1,2,3,null,9]);
});

test('the composer says why a viewer cannot post', () => {
 assert.equal(postGate(null).kind,'sign-in');
 assert.match(postGate({canPost:false,reason:'forum-banned'}).text,/cannot post/);
 assert.match(postGate({canPost:false,reason:'username-required'}).text,/username/);
 assert.equal(postGate({canPost:true,staff:false},{staffOnly:true}).kind,'staff');
 assert.equal(postGate({canPost:true,staff:false},{locked:true}).kind,'locked');
 assert.equal(postGate({canPost:true,staff:true},{staffOnly:true,locked:true}),null);
 assert.equal(postGate({canPost:true,staff:false}),null);
});

test('the Forum tab is in the top bar, the phone menu and the footer', () => {
 const header=readFileSync(new URL('../site/partials/header.html',import.meta.url),'utf8'),footer=readFileSync(new URL('../site/partials/footer.html',import.meta.url),'utf8');
 assert.equal(header.match(/data-tab="forum" href="\/forum"/g)?.length,2);
 assert.match(footer,/href="\/forum">Forum</);
});
