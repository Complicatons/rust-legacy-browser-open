// Leaderboards (central/stats.mjs): gateway reports → per-day counts with rate caps, boards by server and period,
// public profiles, and the account's own choice to hide.
import test from 'node:test';
import assert from 'node:assert/strict';
import {central} from './helpers/central-fixture.mjs';
import {createRemoteAccount,enrolGateway} from '../bridge/remote-account.mjs';
import {RATE} from '../central/stats.mjs';

async function setup(){
 const c=await central(),owner=await c.register('Owner'),rook=await c.register('Rook'),bishop=await c.register('Bishop');
 const uuid=n=>c.db.playerByUsernameKey(n).uuid;
 async function server(name){
  const made=(await c.call('POST','/owner/servers',{data:{name,region:'eu',endpoint:`wss://${name.toLowerCase()}.example/play`},cookie:owner.cookie,csrf:owner.data.csrf})).data;
  const {credential}=await enrolGateway({baseUrl:c.base,code:made.enrolmentCode});
  const remote=createRemoteAccount({baseUrl:c.base,credential});await remote.heartbeat({players:0,capacity:50});
  await c.call('POST',`/owner/servers/${made.id}/publish`,{data:{listed:true},cookie:owner.cookie,csrf:owner.data.csrf});
  return {id:made.id,remote};
 }
 const roster=(...names)=>names.map((n,i)=>({subject:uuid(n),name:n,playerId:i+1,score:0,flags:{},connectedAt:c.clock.t}));
 // One gateway report every `gap` ms with these stats.
 const report=async(s,names,stats=[],gap=5000)=>{c.clock.t+=gap;await s.remote.report({players:roster(...names),flags:[],stats:stats.map(([n,counts])=>({subject:uuid(n),counts}))});};
 return {c,rook,bishop,uuid,server,report};
}
const board=(c,q)=>c.call('GET','/leaderboard/api/boards?'+new URLSearchParams(q)).then(r=>r.data);

test('reports become boards: playtime between reports, kills, gathering, building; hidden accounts leave every board', async () => {
 const {c,rook,server,report}=await setup();
 try{
  const a=await server('Alpha');
  await report(a,['rook','bishop']); // first sight: no playtime yet
  await report(a,['rook','bishop'],[['rook',{'animal:wolf':2,'animal:chicken':1,pvp:1,'gather:wood':300,'gather:stones':40,'build:structure':3,craft:4,distance:55.5}],['bishop',{death:1,'gather:wood':20,'animal:wolf':1}]]);
  await report(a,['rook']);
  let b=await board(c,{board:'playtime'});
  assert.deepEqual(b.rows.map(r=>[r.rank,r.name,r.value]),[[1,'Rook',10],[2,'Bishop',5]]);assert.equal(b.rows[0].profile,'Rook');
  b=await board(c,{board:'animals'});assert.deepEqual(b.rows.map(r=>[r.name,r.value]),[['Rook',3],['Bishop',1]]);
  assert.deepEqual(b.speciesList,[{id:'wolf',value:3},{id:'chicken',value:1}]);
  assert.deepEqual((await board(c,{board:'animals',species:'chicken'})).rows.map(r=>[r.name,r.value]),[['Rook',1]]);
  assert.deepEqual((await board(c,{board:'gather'})).rows.map(r=>[r.name,r.value]),[['Rook',340],['Bishop',20]]);
  assert.deepEqual((await board(c,{board:'gather'})).totals,{players:2,value:360});
  for(const [k,v] of [['pvp',1],['build',3],['craft',4],['distance',56]])assert.equal((await board(c,{board:k})).rows[0].value,v,k);
  // Profile: every stat; hiding removes the profile and the rows, showing brings them back.
  const p=(await c.call('GET','/leaderboard/api/players/rook')).data;
  assert.equal(p.name,'Rook');assert.deepEqual(p.stats.animal,{wolf:2,chicken:1});assert.equal(p.stats.playtime,10);assert.equal(p.stats.distance,56);assert.deepEqual(p.stats.build,{structure:3});
  assert.equal((await c.call('POST','/account/leaderboard',{data:{hidden:true},cookie:rook.cookie,csrf:rook.data.csrf})).data.hidden,true);
  assert.equal((await c.call('GET','/me',{cookie:rook.cookie})).data.leaderboardHidden,true);
  assert.equal((await c.call('GET','/leaderboard/api/players/rook')).status,404);
  assert.deepEqual((await board(c,{board:'playtime'})).rows.map(r=>r.name),['Bishop']);
  assert.deepEqual((await board(c,{board:'gather'})).totals,{players:1,value:20});
  await c.call('POST','/account/leaderboard',{data:{hidden:false},cookie:rook.cookie,csrf:rook.data.csrf});
  assert.equal((await board(c,{board:'playtime'})).rows[0].name,'Rook');
  assert.deepEqual(c.db.auditFor(c.db.playerByUsernameKey('rook').uuid).map(e=>e.action).filter(a=>a.startsWith('leaderboard')),['leaderboard-hidden','leaderboard-shown']);
  assert.equal((await c.call('POST','/account/leaderboard',{data:{hidden:true}})).status,401);
 }finally{await c.close();}
});

test('rate caps scale with the time since the server last reported; only roster players and known kinds count', async () => {
 const {c,uuid,server,report}=await setup();
 try{
  const a=await server('Alpha');
  await report(a,['rook']);
  // 5 s since the last report: at most RATE × 5 of each.
  await report(a,['rook'],[['rook',{'animal:wolf':99,'gather:wood':1e6,distance:1e6,'teleports':5,'gather:Bad Key':3,'pvp:extra':1}],['bishop',{'animal:wolf':5}]]);
  assert.equal((await board(c,{board:'animals'})).rows[0].value,RATE.animal*5);
  assert.equal((await board(c,{board:'gather'})).rows[0].value,RATE.gather*5);
  assert.equal((await board(c,{board:'distance'})).rows[0].value,RATE.distance*5);
  assert.deepEqual((await board(c,{board:'animals'})).rows.map(r=>r.name),['Rook'],'bishop was not on the roster');
  assert.deepEqual((await board(c,{board:'pvp'})).rows,[]);
  // A report right after the last one leaves almost no room: a replayed report adds next to nothing.
  await report(a,['rook'],[['rook',{'animal:wolf':99}]],100);
  assert.equal((await board(c,{board:'animals'})).rows[0].value,RATE.animal*5+1,'the cap floor is one second');
  // Someone who just left (on the previous roster, not this one) still gets their last counts.
  await report(a,['rook','bishop']);await report(a,['rook'],[['bishop',{craft:2}]]);
  assert.deepEqual((await board(c,{board:'craft'})).rows.map(r=>[r.name,r.value]),[['Bishop',2]]);
  assert.ok(uuid('bishop'));
  // Bad requests.
  assert.equal((await c.call('GET','/leaderboard/api/boards?board=nope')).data.error,'invalid-board');
  assert.equal((await c.call('GET','/leaderboard/api/boards?period=year')).data.error,'invalid-period');
  assert.equal((await c.call('GET','/leaderboard/api/boards?server=00000000-0000-4000-8000-000000000000')).status,404);
  assert.equal((await c.call('GET','/leaderboard/api/players/nobody')).status,404);
  assert.equal((await c.call('GET','/leaderboard/api/players/%E0%A4%A')).status,404);
 }finally{await c.close();}
});

test('boards by server and by period (UTC days)', async () => {
 const {c,server,report}=await setup();
 try{
  const a=await server('Alpha'),b=await server('Bravo');
  c.clock.t=Date.UTC(2027,0,1,12);
  await report(a,['rook']);await report(a,['rook'],[['rook',{'gather:wood':100}]]);
  await report(b,['bishop']);await report(b,['bishop'],[['bishop',{'gather:wood':50}]]);
  c.clock.t+=10*86400e3; // ten days later, on Alpha only
  await report(a,['bishop']);await report(a,['bishop'],[['bishop',{'gather:wood':200}]]);
  const rows=async q=>(await board(c,{board:'gather',...q})).rows.map(r=>[r.name,r.value]);
  assert.deepEqual(await rows({}),[['Bishop',250],['Rook',100]]);
  assert.deepEqual(await rows({server:a.id}),[['Bishop',200],['Rook',100]]);
  assert.deepEqual(await rows({server:b.id}),[['Bishop',50]]);
  assert.deepEqual(await rows({period:'day'}),[['Bishop',200]]);
  assert.deepEqual(await rows({period:'week'}),[['Bishop',200]]);
  assert.deepEqual(await rows({period:'month'}),[['Bishop',250],['Rook',100]]);
  assert.deepEqual((await c.call('GET',`/leaderboard/api/players/Bishop?server=${b.id}`)).data.stats.gather,{wood:50});
 }finally{await c.close();}
});
