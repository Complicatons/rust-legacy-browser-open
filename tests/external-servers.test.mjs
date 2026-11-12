// Optional import of a public Rust Legacy server list (OFFSHOOT-COMPATIBILITY-PLAN.md work item 9). Off by default;
// never joinable here (no adapter); fails soft and respects the source's own "serverlist":"false" hide flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createExternalServers} from '../central/external-servers.mjs';
import {openCentralDb} from '../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../central/service.mjs';
import {createSigningKey} from '../bridge/admission.mjs';
import {listenServer} from '../bridge/listen.mjs';

const ROW=({name='Classic EU',ip='1.2.3.4',port='28015',players='3',maxplayers='50',online='1',serverlist='true'}={})=>
 ({name,ip,port,players,maxplayers,online,serverlist});
const fetchJson=rows=>async()=>({ok:true,json:async()=>rows});

test('off by default: never fetches, returns nothing',async()=>{
 let called=false;
 const ext=createExternalServers({fetchImpl:async()=>{called=true;return {ok:true,json:async()=>[]};}});
 assert.deepEqual(await ext.list(),[]);assert.equal(called,false);
});

test('on: online, listed entries come back shaped like publicServer, never joinable',async()=>{
 const ext=createExternalServers({enabled:true,fetchImpl:fetchJson([ROW()])});
 const [s]=await ext.list();
 assert.deepEqual(s,{id:'rustlegacy.eu:1.2.3.4:28015',name:'Classic EU',region:null,online:true,players:3,capacity:50,wipe:null,lastWipeAt:null,
  browserReady:false,launcherOnly:null,requirements:{minAccountAgeMinutes:0,steam:false,phone:false},external:true,source:'rustlegacy.eu'});
});

test('offline entries, and ones the source itself hides (serverlist:false), are left out',async()=>{
 const ext=createExternalServers({enabled:true,fetchImpl:fetchJson([ROW(),ROW({name:'Offline',online:'0'}),ROW({name:'Hidden test box',serverlist:'false'})])});
 assert.deepEqual((await ext.list()).map(s=>s.name),['Classic EU']);
});

test('fails soft: a bad fetch keeps the last good cache instead of going empty',async()=>{
 let fail=false;
 const ext=createExternalServers({enabled:true,ttlMs:50,fetchImpl:async()=>{if(fail)throw Error('network down');return {ok:true,json:async()=>[ROW()]};}});
 assert.equal((await ext.list()).length,1);
 fail=true;await new Promise(r=>setTimeout(r,60));
 assert.equal((await ext.list()).length,1,'stale cache beats showing nothing');
});

test('caches within the TTL: a second call inside the window does not refetch',async()=>{
 let calls=0;
 const ext=createExternalServers({enabled:true,ttlMs:10_000,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>[ROW()]};}});
 await ext.list();await ext.list();
 assert.equal(calls,1);
});

test('GET /servers only carries external entries when the owner has turned the import on',async()=>{
 const db=openCentralDb();
 const run=async externalServers=>{
  const svc=createCentralService({db,keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:['https://play.example.test'],secureCookies:false,...(externalServers?{externalServers}:{})});
  const http=createServer((q,r)=>svc.handle(q,r));await listenServer(http);
  try{return (await (await fetch(`http://127.0.0.1:${http.address().port}/servers`)).json()).servers;}
  finally{await new Promise(r=>http.close(r));}
 };
 assert.deepEqual(await run(),[],'off by default, nothing to merge in yet');
 const withExternal=await run({enabled:true,fetchImpl:fetchJson([ROW()])});
 assert.deepEqual(withExternal.map(s=>s.id),['rustlegacy.eu:1.2.3.4:28015']);
 assert.equal(withExternal[0].browserReady,false);
});
