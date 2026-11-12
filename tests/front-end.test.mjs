import test from 'node:test';
import assert from 'node:assert/strict';
import {ConVars,CONVARS,parseConVar,qualityIndex,lookRadiansPerCount,pixelRatioForQuality} from '../browser/convars.mjs';
import {SERVERTYPE,shouldIgnoreServer,categoryFor,historyLabel,detailsText,sortServers,pageOf,paginationItems,playersText,pingText,fromCentral,centralTags,offlineServer,rememberJoin,readList} from '../browser/server-list.mjs';

const memory=()=>{const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};

test('console variable defaults are the shipped convar defaults, not the prefab control values',()=>{
 const c=new ConVars();assert.equal(c.get('input.mousespeed'),5);assert.equal(c.get('input.flipy'),false);assert.equal(c.get('render.vsync'),false);
 assert.equal(c.get('water.reflection'),false);assert.equal(qualityIndex(c.get('render.level')),0);assert.equal(CONVARS['render.level'].value,0); // mainData m_CurrentQuality (Fastest)
 for(const g of ['ssaa','bloom','grain','ssao','tonemap','shafts','damage'])assert.equal(c.get('gfx.'+g),true,'shipped client.cfg gfx.'+g);
});
test('ConvarBinding values parse like ConsoleSystem and persist only on config.save',()=>{
 assert.equal(parseConVar(CONVARS['input.flipy'],'True'),true);assert.equal(parseConVar(CONVARS['input.flipy'],'"False"'),false);assert.equal(parseConVar(CONVARS['input.flipy'],'maybe'),null);
 assert.equal(parseConVar(CONVARS['render.level'],'1.7'),1);assert.equal(parseConVar(CONVARS['input.mousespeed'],'2.5'),2.5);assert.equal(parseConVar(CONVARS['input.mousespeed'],'fast'),null);
 const storage=memory(),c=new ConVars(storage);let changes=[];c.addEventListener('change',e=>changes.push([e.name,e.value]));
 assert.equal(c.set('input.mousespeed','3'),true);assert.equal(c.set('nope.value','1'),false);assert.equal(c.set('input.flipy','sideways'),false);
 assert.deepEqual(changes,[['input.mousespeed',3]]);assert.equal(storage.values.size,0);c.save();
 assert.equal(new ConVars(storage).get('input.mousespeed'),3);
 assert.equal(c.command('input.flipy true').ok,true);assert.equal(c.command('input.flipy').text,'input.flipy: True');assert.equal(c.command('render.fov 90'),null);
});
test('sound convars route to the shared audio settings',()=>{
 let state={volume:1,music:0.4};const sound={get master(){return state.volume;},get music(){return state.music;},setVolume(v){state={...state,...v};}};
 const c=new ConVars(null,{sound});assert.equal(c.get('sound.volume'),1);assert.equal(c.set('sound.volume','0.25'),true);assert.equal(state.volume,0.25);
 assert.equal(c.set('sound.music','2'),true);assert.equal(state.music,1);assert.equal(c.set('sound.music','x'),false);
});
test('render.level rounds like Mathf.RoundToInt and drives the canvas pixel ratio',()=>{
 assert.equal(qualityIndex(0),0);assert.equal(qualityIndex(0.551),3);assert.equal(qualityIndex(0.5),2);assert.equal(qualityIndex(0.7),4);assert.equal(qualityIndex(1),5);
 assert.equal(pixelRatioForQuality(0.6,2),1.5);assert.equal(pixelRatioForQuality(1,1),1);assert.equal(pixelRatioForQuality(0,1),1);assert.equal(pixelRatioForQuality(0.4,2),1);
});
test('mouse look uses the shipped Mouse X axis sensitivity times input.mousespeed degrees',()=>{
 assert.ok(Math.abs(lookRadiansPerCount(5)-0.375*Math.PI/180)<1e-12);assert.equal(lookRadiansPerCount(0),0);
});
test('ServerBrowser.ShouldIgnoreServer and Add_Server category routing',()=>{
 const s=(name,c=0,m=10)=>({name,currentplayers:c,maxplayers:m});
 assert.equal(shouldIgnoreServer(s('Pilot EU')),false);assert.equal(shouldIgnoreServer(s('[color red]X')),true);assert.equal(shouldIgnoreServer(s('A -- B')),true);
 assert.equal(shouldIgnoreServer(s('Server!')),true);assert.equal(shouldIgnoreServer(s('Snow ☃ land')),true);assert.equal(shouldIgnoreServer(s('Full',11,10)),true);assert.equal(shouldIgnoreServer(s('Big',501,600)),true);
 assert.equal(categoryFor(s('Pilot')),SERVERTYPE.COMMUNITY);assert.equal(categoryFor(s('Pilot'),'official'),SERVERTYPE.OFFICIAL);assert.equal(categoryFor(s('Pilot'),'modded'),SERVERTYPE.MODDED);
 assert.equal(categoryFor(s('My Oxide server')),null);assert.equal(categoryFor(s('Group'),'sg:1a2b'),null);
});
test('history labels, details text and sorting follow UpdateServerList',()=>{
 assert.equal(historyLabel('A',1000,1030),'A (30 seconds ago)');assert.equal(historyLabel('A',1000,1000+7200),'A (2 hours ago)');assert.equal(historyLabel('A',0,3*86400),'A (3 days ago)');assert.equal(historyLabel('A',0,86400*1.5),'A (36 hours ago)');
 assert.equal(detailsText(3,2,40),'Found 3 players on 2 servers. We are at 7% capacity.');assert.equal(detailsText(0,0,0),'Found 0 players on 0 servers. We are at 0% capacity.');
 const list=()=>[{name:'b',address:'b',currentplayers:5,ping:null,fave:false,lastplayed:2},{name:'a',address:'a',currentplayers:1,ping:30,fave:false,lastplayed:5},{name:'c',address:'c',currentplayers:9,ping:10,fave:true,lastplayed:1}];
 assert.deepEqual(sortServers(list(),1,2).map(s=>s.name),['c','a','b']);assert.deepEqual(sortServers(list(),1,1).map(s=>s.name),['c','b','a']);
 assert.deepEqual(sortServers(list(),1,0).map(s=>s.name),['c','a','b']);assert.deepEqual(sortServers(list(),SERVERTYPE.HISTORY,0).map(s=>s.name),['a','b','c']);
});
test('pages fit the container height in 34 px rows, with a gap after favourites',()=>{
 const servers=Array.from({length:30},(_,i)=>({name:'s'+i,address:'s'+i,fave:i<2}));const p=pageOf(servers,0,464);
 assert.equal(p.pages,3);assert.equal(p.rows.length,13);assert.deepEqual(p.rows.slice(0,4).map(r=>r.y),[0,34,70,104]);
 assert.equal(pageOf(servers,2,464).rows.length,4);assert.equal(pageOf([],0,464),null);assert.equal(pageOf(servers,9,464),null);
 assert.deepEqual(paginationItems(1,0),[]);
 assert.deepEqual(paginationItems(8,0).map(x=>x.spacer?'..':x.label),['1','2','..','7','8']);
 assert.deepEqual(paginationItems(8,4).map(x=>x.spacer?'..':x.label),['1','2','..','4','5','6','7','8']);
 assert.equal(paginationItems(8,4).find(x=>x.current).label,'5');
});
test('central directory entries are never given invented counts or pings',()=>{
 const s=fromCentral({id:'u1',name:'Pilot',players:3,capacity:50,online:true});assert.equal(playersText(s),'3 / 50');assert.equal(pingText(s),'-');assert.equal(s.address,'u1');
 // The directory's listing tags route it: a server tagged "official" shows under Official, not Community.
 assert.equal(categoryFor(s,centralTags({tags:['Official','pvp']})),SERVERTYPE.OFFICIAL);assert.equal(categoryFor(s,centralTags({tags:['pvp']})),SERVERTYPE.COMMUNITY);
 assert.equal(centralTags({}),'');assert.equal(centralTags({tags:[1,'modded']}),'modded');
 const unknown=fromCentral({id:'u2',name:'X',players:null,capacity:null});assert.equal(playersText(unknown),'0 / ?');
 const offline=offlineServer();assert.equal(offline.offline,true);assert.equal(playersText(offline),'0 / 1');
 const storage=memory();rememberJoin(storage,s,100);rememberJoin(storage,offline,200);rememberJoin(storage,s,300);
 assert.deepEqual(readList(storage,'rlb-server-history').map(e=>[e.address,e.lastplayed]),[['u1',300],['offline',200]]);
});
