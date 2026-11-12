import {listenServer} from '../bridge/listen.mjs';
import {chromium} from 'playwright-core';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
import {createSessionAPI} from './session-server.mjs';
const api=await createSessionAPI(),server=createServer(api);await listenServer(server);
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--mute-audio']});
 const contextA=await browser.newContext(),contextB=await browser.newContext(),a=await contextA.newPage(),b=await contextB.newPage();
 const errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 const url=`http://127.0.0.1:${server.address().port}`;
 // A small same-origin harness page isolates transport/physics from rendering GPU load.
 for(const p of [a,b]){await p.goto(url+'/style.css');await p.evaluate(async()=>{const {LocalSession}=await import('/session.mjs');window.testSession=new LocalSession();});}
 const joinA=await a.evaluate(()=>window.testSession.join('Local A')),joinB=await b.evaluate(()=>window.testSession.join('Local B'));
 const initial=await b.evaluate(()=>window.testSession.state());assert.equal(initial.players.length,2);
 const start=initial.players.find(p=>p.id===joinA.id).feet;
 for(let i=0;i<10;i++){await a.evaluate(()=>window.testSession.input({forward:1,yaw:Math.PI}));await a.waitForTimeout(100);}
 const moving=await b.evaluate(()=>window.testSession.state()),peer=moving.players.find(p=>p.id===joinA.id);assert.ok(peer.feet[2]-start[2]>0.5&&peer.feet[2]-start[2]<6);
 // The other client observes server-derived motion; submitted teleport fields are ignored.
 await a.evaluate(async()=>{await window.testSession.request('input','POST',{seq:100,forward:1,right:0,yaw:0,pitch:0,sprint:false,crouch:false,jump:false,feet:[1e9,1e9,1e9]});});
 const afterTeleport=(await b.evaluate(()=>window.testSession.state())).players.find(p=>p.id===joinA.id);assert.ok(afterTeleport.feet.every(v=>Math.abs(v)<10000));
 const invalid=await a.evaluate(async()=>{try{await window.testSession.request('input','POST',{seq:101,forward:100,right:0,yaw:0,pitch:0,sprint:false,crouch:false,jump:false});return false;}catch{return true;}});assert.ok(invalid);
 await a.waitForTimeout(600);const resting=await b.evaluate(()=>window.testSession.state());assert.ok(Math.hypot(...resting.players.find(p=>p.id===joinA.id).velocity)<0.1);
 const unauthorized=await fetch(url+'/api/state');assert.equal(unauthorized.status,401);
 const crossOrigin=await fetch(url+'/api/session',{method:'POST',headers:{Origin:'https://example.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(crossOrigin.status,403);
 await a.evaluate(()=>window.testSession.leave());const left=await b.evaluate(()=>window.testSession.state());assert.equal(left.players.length,1);assert.equal(left.players[0].id,joinB.id);
 await b.evaluate(()=>window.testSession.leave());assert.deepEqual(errors,[]);
 const result={protocol:'local-port-test-v1',scope:'Two isolated Edge clients; local HTTP transport and server-authoritative recovered movement only. Not original uLink/server compatibility.',players:2,observedMovementMetres:peer.feet[2]-start[2],inputTimeout:true,clientPositionIgnored:true,unauthorizedRejected:true,crossOriginRejected:true,disconnect:true,errors};
 await mkdir('analysis/multiplayer-qa',{recursive:true});await writeFile('analysis/multiplayer-qa/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();api.close();await new Promise(r=>server.close(r));}
