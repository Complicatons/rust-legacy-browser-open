// Firefox smoke check without Playwright's Firefox build: starts the installed Firefox headless with a fresh temporary
// profile and drives it over WebDriver BiDi (Node's built-in WebSocket). Loads the offline island with ?dev, waits for
// the world, enters walk mode, records console errors, renderer, texture sources and frame rate, takes a screenshot.
//   node tools/check-firefox.mjs     (FIREFOX_PATH overrides the executable; writes analysis/browser-qa/firefox/)
import {listenServer} from '../bridge/listen.mjs';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
const exe=process.env.FIREFOX_PATH??'C:/Program Files/Mozilla Firefox/firefox.exe',out='analysis/browser-qa/firefox/',port=9300+Math.floor(Math.random()*500);
await mkdir(out,{recursive:true});
const server=createServer();await listenServer(server);const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'rlb-firefox-'));
const ff=spawn(exe,['--headless','--no-remote','--profile',profile,'--remote-debugging-port',String(port),'--width','1280','--height','720','about:blank'],{stdio:['ignore','pipe','pipe']});
let stderr='';ff.stderr.on('data',d=>stderr+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws=null,id=0;const pending=new Map(),events=[];
async function connect(){for(let i=0;i<100;i++){try{const s=new WebSocket(`ws://127.0.0.1:${port}/session`);await new Promise((ok,fail)=>{s.onopen=ok;s.onerror=fail;});return s;}catch{await wait(300);}}throw Error('Firefox BiDi did not start: '+stderr.slice(-500));}
const send=(method,params={})=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{ok,fail});ws.send(JSON.stringify({id:n,method,params}));});
const result={};
try{
 ws=await connect();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.type==='error'?p.fail(Error(m.error+': '+m.message)):p.ok(m.result);}else if(m.type==='event')events.push(m);};
 const session=await send('session.new',{capabilities:{}});result.browser=`${session.capabilities.browserName} ${session.capabilities.browserVersion}`;
 await send('session.subscribe',{events:['log.entryAdded']});
 const context=(await send('browsingContext.getTree',{})).contexts[0].context;
 const evaluate=async(expression)=>{const r=await send('script.evaluate',{expression,target:{context},awaitPromise:true,resultOwnership:'none'});if(r.type==='exception')throw Error(r.exceptionDetails.text);return r.result;};
 const value=r=>r.type==='string'||r.type==='number'||r.type==='boolean'?r.value:r.type==='null'||r.type==='undefined'?null:r;
 const t0=Date.now();await send('browsingContext.navigate',{context,url:origin+'/?dev',wait:'complete'});
 let state=null;
 for(;Date.now()-t0<600000;await wait(1000)){state=value(await evaluate(`JSON.stringify({ready:Boolean(window.explorerState?.ready),frames:window.explorerState?.frames??0,status:document.querySelector('#status')?.textContent??''})`));state=JSON.parse(state);if(state.ready||/Could not/.test(state.status))break;}
 result.readyMs=Date.now()-t0;result.status=state.status;assert.ok(state.ready,'world loaded in Firefox: '+state.status);
 result.graphics=JSON.parse(value(await evaluate(`(()=>{const gl=document.querySelector('#world').getContext('webgl2');const e=gl.getExtension('WEBGL_debug_renderer_info');return JSON.stringify({renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),glError:gl.getError()});})()`)));
 await evaluate(`document.querySelector('#mode').click()`);await wait(3000);
 result.textures=JSON.parse(value(await evaluate(`JSON.stringify(window.explorerDev.textures())`)));
 const f0=value(await evaluate('window.explorerState.frames'));await wait(5000);result.fps=+((value(await evaluate('window.explorerState.frames'))-f0)/5).toFixed(1);
 result.walk=value(await evaluate('window.explorerState.walk'));result.diagnostics=JSON.parse(value(await evaluate('JSON.stringify(window.explorerDev.diagnostics())')));
 await evaluate(`for(const el of document.querySelectorAll('body>header,body>aside'))el.style.display='none'`);await wait(500);
 const shot=await send('browsingContext.captureScreenshot',{context});await writeFile(out+'island.png',Buffer.from(shot.data,'base64'));
 result.errors=events.filter(e=>e.method==='log.entryAdded'&&e.params.level==='error').map(e=>e.params.text).filter(t=>!/^Failed to load resource/.test(t));
 result.warnings=events.filter(e=>e.method==='log.entryAdded'&&e.params.level==='warn').map(e=>e.params.text).slice(0,20);
 await writeFile(out+'result.json',JSON.stringify(result,null,1));console.log(JSON.stringify({...result,diagnostics:undefined},null,1));
 assert.equal(result.walk,true,'walk mode');assert.deepEqual(result.errors,[],'no console errors');
 console.log('PASS check-firefox',result.browser);
}finally{try{await send('session.end',{});}catch{}ws?.close();ff.kill();server.close();await wait(500);await rm(profile,{recursive:true,force:true}).catch(()=>{});}
