// Leaderboard pages (site/js/leaderboard.mjs, leaderboard-view.mjs) against a real central in the tiny fake DOM, plus
// the page routes, the Servers-tab placement and the account toggle's API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {central,ORIGIN} from './helpers/central-fixture.mjs';
import {installDom} from './helpers/fake-dom.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {formatValue,boardQuery,readQuery,profileTiles,breakdown,subLabel} from '../site/js/leaderboard-view.mjs';
import {pageFor} from '../central/site.mjs';
import {navState} from '../site/js/shell-state.mjs';
import {listenServer} from '../bridge/listen.mjs';

test('formats, queries and routes', () => {
 assert.equal(formatValue('playtime',5400),'1.5');assert.equal(formatValue('playtime',36000*5),'50');assert.equal(formatValue('distance',12345),'12');
 assert.equal(formatValue('distance',1234),'1.2');assert.equal(formatValue('gather',12345),'12,345');
 assert.equal(boardQuery({}),'');assert.equal(boardQuery({board:'animals',species:'wolf',period:'week'}),'?board=animals&period=week&species=wolf');
 assert.equal(boardQuery({board:'pvp',species:'wolf'}),'?board=pvp');
 assert.deepEqual(readQuery('?board=nope&period=year&species=x'),{board:'playtime',period:'all',server:'',species:''});
 assert.deepEqual(profileTiles({playtime:7200,pvp:1,death:2,craft:3,distance:2500,animal:{wolf:2,bear:1},gather:{wood:10},build:{}}).map(t=>t.join(' ')),
  ['2.0 Hours','3 Animals','1 PvP kills','2 Deaths','10 Gathered','0 Built','3 Crafted','2.5 Km']);
 assert.deepEqual(breakdown({wood:5,'metal-ore':9}),[['Metal ore','9'],['Wood','5']]);assert.equal(subLabel('mutant-bear'),'Mutant bear');
 assert.equal(pageFor('/leaderboard'),'leaderboard');assert.equal(pageFor('/players/Rook_1'),'player');
 for(const p of ['/players','/players/ab','/players/a/b','/players/bad name'])assert.equal(pageFor(p),null,p);
 assert.equal(navState('/leaderboard'),'servers');assert.equal(navState('/players/Rook'),'servers');
 const header=readFileSync(new URL('../site/partials/header.html',import.meta.url),'utf8');
 assert.equal(header.match(/href="\/leaderboard"/g)?.length,2,'Servers tab menu and the phone menu');
 assert.match(readFileSync(new URL('../site/pages/privacy.html',import.meta.url),'utf8'),/Leaderboards\.<\/b>[\s\S]*hide yourself/);
});

const realFetch=globalThis.fetch;let n=0;
test('the board and profile pages render from real reports; hiding takes the player off', async () => {
 const c=await central();let cookie=null;
 globalThis.fetch=(path,opts={})=>String(path).startsWith('http')?realFetch(path,opts):realFetch(c.base+path,{...opts,headers:{...opts.headers,origin:ORIGIN,...(cookie?{cookie}:{})}});
 const {loadSession}=await import('../site/js/session.mjs');
 async function open(url,page){
  const dom=installDom(url);const main=dom.el('main'),box=dom.el('div');box.setAttribute('id','lb-main');main.append(box);dom.body.append(main);dom.body.dataset.page=page;
  await loadSession({refresh:true});await import('../site/js/leaderboard.mjs?page='+(++n));
  assert.equal(dom.body.dataset.ready,'1',url);
  return {...dom,text:()=>box.textContent,buttons:()=>dom.document.querySelectorAll('button')};
 }
 try{
  const owner=await c.register('Owner'),rook=await c.register('Rook');await c.register('Bishop');
  const uuid=x=>c.db.playerByUsernameKey(x).uuid;
  const made=(await c.call('POST','/owner/servers',{data:{name:'Alpha',region:'eu',endpoint:'wss://alpha.example/play'},cookie:owner.cookie,csrf:owner.data.csrf})).data;
  const {credential}=await enrolGateway({baseUrl:c.base,code:made.enrolmentCode});const remote=createRemoteAccount({baseUrl:c.base,credential});
  await remote.heartbeat({players:0,capacity:50});await c.call('POST',`/owner/servers/${made.id}/publish`,{data:{listed:true},cookie:owner.cookie,csrf:owner.data.csrf});
  const roster=[{subject:uuid('rook'),name:'Rook',playerId:1,score:0,flags:{},connectedAt:1},{subject:uuid('bishop'),name:'Bishop',playerId:2,score:0,flags:{},connectedAt:1}];
  for(let i=0;i<3;i++){c.clock.t+=5000;await remote.report({players:roster,flags:[],stats:i?[{subject:uuid('rook'),counts:{'animal:wolf':2,'gather:wood':100}},{subject:uuid('bishop'),counts:{'animal:chicken':1}}]:[]});}
  let p=await open('/leaderboard',null);
  assert.match(p.text(),/Leaderboard2Players[\s\S]*Most active[\s\S]*1Bishop0.0Hours2Rook0.0Hours/);
  // Switch to the hunters board, then one species.
  await p.buttons().find(b=>b.textContent==='Hunters').click();await new Promise(r=>setTimeout(r,50));
  assert.match(p.text(),/1Rook4Animals2Bishop2Animals/);assert.match(p.location.assigned.join()+'',/^$/);
  await p.buttons().find(b=>b.textContent==='Chicken').click();await new Promise(r=>setTimeout(r,50));
  assert.match(p.text(),/1Bishop2Animals/);assert.doesNotMatch(p.text(),/Rook4/);
  // Profile, then hidden.
  p=await open('/players/Rook','player');
  assert.match(p.text(),/LeaderboardRook[\s\S]*Rook[\s\S]*Joined[\s\S]*4Animals[\s\S]*200Gathered[\s\S]*Wolf4[\s\S]*Wood200/);
  await c.call('POST','/account/leaderboard',{data:{hidden:true},cookie:rook.cookie,csrf:rook.data.csrf});
  p=await open('/players/Rook','player');assert.match(p.text(),/Not found/);
  p=await open('/leaderboard?board=animals',null);assert.doesNotMatch(p.text(),/Rook/);
  p=await open('/leaderboard?board=craft',null);assert.match(p.text(),/No scores yet/);
 }finally{globalThis.fetch=realFetch;await c.close();}
});

test('unknown or hidden profiles are real 404 pages; known ones get the profile page', async () => {
 const {createServer}=await import('node:http'),{createSiteHandler}=await import('../central/site.mjs');
 const site=createSiteHandler({profileExists:name=>name.toLowerCase()==='rook'});
 const http=createServer((q,r)=>{if(!site(q,r)){r.writeHead(418);r.end('api');}});await listenServer(http);
 const get=p=>realFetch(`http://127.0.0.1:${http.address().port}${p}`,{headers:{accept:'text/html'}}).then(async r=>({status:r.status,text:await r.text()}));
 try{
  const known=await get('/players/Rook');assert.equal(known.status,200);assert.match(known.text,/data-page="player"/);
  const unknown=await get('/players/Nobody');assert.equal(unknown.status,404);assert.match(unknown.text,/noindex/);assert.doesNotMatch(unknown.text,/data-page="player"/);
 }finally{await new Promise(r=>http.close(r));}
});
