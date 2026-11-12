// Server browser helpers (site/js/server-data.mjs): filters, sort, regions, URL state and the join hand-off.
import test from 'node:test';
import assert from 'node:assert/strict';
import {filterServers,sortServers,regionsOf,queryFromState,stateFromQuery,isDesktop,joinServer,launcherOnlyLabel,shownTags} from '../site/js/server-data.mjs';

test('shownTags hides the in-game "official" category tag from the website',()=>{
 assert.deepEqual(shownTags(['official','vanilla','pvp']),['vanilla','pvp']);
 assert.deepEqual(shownTags([' Official ']),[]);
 assert.deepEqual(shownTags(),[]);
});

const S=(name,region,online,players,capacity)=>({id:name.toLowerCase().replace(/\W/g,''),name,region,online,players,capacity,endpoint:'wss://x/play'});
const list=[S('Legacy Vanilla EU','eu',true,18,50),S('Full House','EU',true,50,50),S('Weekly NA','na',true,4,null),S('Old Pilot','eu',false,null,null)];

test('filterServers by name, region, full and offline',()=>{
 assert.deepEqual(filterServers(list,{q:'VANILLA'}).map(s=>s.name),['Legacy Vanilla EU']);
 assert.deepEqual(filterServers(list,{region:'EU'}).map(s=>s.name),['Legacy Vanilla EU','Full House','Old Pilot']);
 assert.deepEqual(filterServers(list,{hideFull:true}).map(s=>s.name),['Legacy Vanilla EU','Weekly NA','Old Pilot'],'unknown capacity is never full');
 assert.deepEqual(filterServers(list,{hideOffline:true}).map(s=>s.name),['Legacy Vanilla EU','Full House','Weekly NA']);
 assert.equal(filterServers(list,{}).length,4);
});

test('sortServers keeps offline servers last',()=>{
 assert.deepEqual(sortServers(list,'players').map(s=>s.name),['Full House','Legacy Vanilla EU','Weekly NA','Old Pilot']);
 assert.deepEqual(sortServers(list,'name').map(s=>s.name),['Full House','Legacy Vanilla EU','Weekly NA','Old Pilot']);
 assert.deepEqual(sortServers(list,'region').map(s=>s.name),['Full House','Legacy Vanilla EU','Weekly NA','Old Pilot']);
 assert.notEqual(sortServers(list,'players'),list,'does not mutate');
});

test('regionsOf lists each region once, uppercase',()=>{assert.deepEqual(regionsOf(list),['EU','NA']);});

test('URL state round trip',()=>{
 const state={q:'legacy',region:'EU',hideFull:true,hideOffline:false,sort:'name'};
 assert.equal(String(queryFromState(state)),'q=legacy&region=EU&full=0&sort=name');
 assert.deepEqual(stateFromQuery(queryFromState(state)),state);
 assert.deepEqual(stateFromQuery(new URLSearchParams('')),{q:'',region:null,hideFull:false,hideOffline:false,sort:'players'});
 assert.equal(stateFromQuery(new URLSearchParams('sort=evil')).sort,'players');
});

test('launcherOnlyLabel: a badge only when the owner\'s host app reported it on, unknown and off show nothing',()=>{
 assert.equal(launcherOnlyLabel({launcherOnly:true}),'Website or launcher account');
 assert.equal(launcherOnlyLabel({launcherOnly:false}),null);
 assert.equal(launcherOnlyLabel({launcherOnly:null}),null);
 assert.equal(launcherOnlyLabel({}),null);
});

test('isDesktop needs a fine pointer and WebGL 2',()=>{
 assert.equal(isDesktop({finePointer:true,webgl2:true}),true);
 assert.equal(isDesktop({finePointer:false,webgl2:true}),false);
 assert.equal(isDesktop({finePointer:true,webgl2:false}),false);
});

test('joinServer: sign in first, desktop only, then a ticket for the game page',async()=>{
 const s=list[0];
 assert.deepEqual(await joinServer(s,{me:null}),{redirect:'/signin?next='+encodeURIComponent(`/servers/${s.id}?join=1`)});
 await assert.rejects(joinServer(s,{me:{},desktop:false}),e=>e.code==='desktop-required');
 const noCall=async()=>{throw Error('no ticket before a username');};
 assert.deepEqual(await joinServer(s,{me:{needsUsername:true},desktop:true,api:noCall}),{redirect:'/welcome?mode=username&next='+encodeURIComponent(`/servers/${s.id}?join=1`)});
 const store=new Map(),storage={setItem:(k,v)=>store.set(k,v)},calls=[];
 const api=async(method,path)=>{calls.push([method,path]);return {ticket:'a.b.c',endpoint:'wss://x/play'};};
 const r=await joinServer(s,{me:{},desktop:true,api,storage,config:{playUrl:'/play'},now:()=>5});
 assert.deepEqual(calls,[['POST',`/servers/${s.id}/join-ticket`]]);
 assert.deepEqual(r,{redirect:'/play'});
 assert.deepEqual(JSON.parse(store.get('rlb-join')),{ticket:'a.b.c',endpoint:'wss://x/play',server:s.id,name:s.name,at:5});
 assert.deepEqual(await joinServer(s,{me:{},desktop:true,api,storage,config:{playUrl:null},now:()=>5}),{redirect:null});
});

test('filterServers also finds a server by its list entry tags and description',()=>{
 const listed=[{name:'Dusk',region:'eu',online:true,tags:['weekly wipe','pvp'],description:'Active admins, no kits.'},{name:'Quiet Isle',region:'na',online:true}];
 assert.deepEqual(filterServers(listed,{q:'weekly'}).map(s=>s.name),['Dusk']);
 assert.deepEqual(filterServers(listed,{q:'no kits'}).map(s=>s.name),['Dusk']);
 assert.deepEqual(filterServers(listed,{q:'quiet'}).map(s=>s.name),['Quiet Isle']);
});
