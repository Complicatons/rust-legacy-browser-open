// Staff wiki articles over HTTP (central/wiki.mjs): permissions, revisions, restore, slug rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';

async function staffAndPlayer(c){
 const staff=await c.register('Warden'),player=await c.register('Rook');
 c.db.addStaff(c.db.playerByUsernameKey('warden').uuid,c.clock.t);
 return {staff,player};
}
const put=(c,who,slug,data)=>c.call('PUT','/wiki/api/articles/'+slug,{data,cookie:who.cookie,csrf:who.data.csrf});

test('only platform staff can write articles', async () => {
 const c=await central();
 try{
  const {player}=await staffAndPlayer(c);
  const r=await put(c,player,'getting-started',{title:'Getting started',section:'guides',body:'Hi',note:'first'});
  assert.equal(r.status,403);assert.equal(r.data.error,'staff-only');
  assert.equal((await c.call('PUT','/wiki/api/articles/getting-started',{data:{title:'x',section:'guides',body:'x'}})).status,401);
 }finally{await c.close();}
});

test('staff create and edit articles; every save is a revision and restore brings back old text', async () => {
 const c=await central();
 try{
  const {staff}=await staffAndPlayer(c);
  assert.equal((await put(c,staff,'raiding-basics',{title:'Raiding basics',section:'raiding',body:'One **charge** per door.',note:'first'})).status,200);
  c.clock.t+=1000;
  assert.equal((await put(c,staff,'raiding-basics',{title:'Raiding basics',section:'raiding',body:'Gateways take five.',note:'second'})).status,200);
  const art=(await c.call('GET','/wiki/api/articles/raiding-basics')).data;
  assert.equal(art.body,'Gateways take five.');assert.equal(art.html,'<p>Gateways take five.</p>');assert.equal(art.updatedBy,'Warden');assert.equal(art.section,'raiding');
  const revs=(await c.call('GET','/wiki/api/articles/raiding-basics/revisions')).data;
  assert.deepEqual(revs.map(r=>r.note),['second','first']);
  const first=revs[1].id;
  assert.equal((await c.call('POST',`/wiki/api/articles/raiding-basics/restore/${first}`,{data:{},cookie:staff.cookie,csrf:staff.data.csrf})).status,200);
  const back=(await c.call('GET','/wiki/api/articles/raiding-basics')).data;
  assert.equal(back.body,'One **charge** per door.');assert.equal(back.html,'<p>One <strong>charge</strong> per door.</p>');
  assert.equal((await c.call('GET','/wiki/api/articles/raiding-basics/revisions')).data.length,3);
  const list=(await c.call('GET','/wiki/api/articles')).data;
  assert.deepEqual(list.map(a=>[a.slug,a.title,a.section]),[['raiding-basics','Raiding basics','raiding']]);
  assert.deepEqual(c.db.auditFor('raiding-basics').map(e=>e.action),['wiki-edit','wiki-edit','wiki-restore']);
 }finally{await c.close();}
});

test('players cannot restore revisions and bad input is refused', async () => {
 const c=await central();
 try{
  const {staff,player}=await staffAndPlayer(c);
  await put(c,staff,'tips',{title:'Tips',section:'guides',body:'a',note:''});
  const id=(await c.call('GET','/wiki/api/articles/tips/revisions')).data[0].id;
  assert.equal((await c.call('POST',`/wiki/api/articles/tips/restore/${id}`,{data:{},cookie:player.cookie,csrf:player.data.csrf})).data.error,'staff-only');
  assert.equal((await put(c,staff,'Bad_Slug',{title:'x',section:'guides',body:'x'})).status,400);
  assert.equal((await put(c,staff,'Bad_Slug',{title:'x',section:'guides',body:'x'})).data.error,'invalid-slug');
  assert.equal((await put(c,staff,'empty',{title:' ',section:'guides',body:'x'})).data.error,'invalid-title');
  assert.equal((await put(c,staff,'big',{title:'Big',section:'guides',body:'x'.repeat(100_001)})).data.error,'body-too-long');
  assert.equal((await c.call('GET','/wiki/api/articles/missing')).status,404);
  assert.equal((await c.call('POST','/wiki/api/articles/tips/restore/99999',{data:{},cookie:staff.cookie,csrf:staff.data.csrf})).status,404);
 }finally{await c.close();}
});
