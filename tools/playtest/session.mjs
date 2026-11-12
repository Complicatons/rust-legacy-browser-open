// Long-lived playtest session: the mock stack (tools/native/mock.mjs: site, game at /play, central, gateway, mock uLink
// server + referee) and one headless Edge (muted, Pointer Lock stand-in from tools/qa-browser.mjs) that step scripts
// drive one at a time: POST http://127.0.0.1:4199/run?file=<step.mjs> imports the step afresh and calls its default
// export with the session context. Nothing grabs the real mouse or plays sound.
import {chromium} from 'playwright-core';
import http from 'node:http';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {launchOptions} from '../qa-browser.mjs';
import {startMockEnvironment} from '../native/mock.mjs';

const OUT=process.env.PLAYTEST_OUT??'analysis/playtests/'+new Date().toISOString().slice(0,10);await mkdir(OUT,{recursive:true});
const env=await startMockEnvironment({log:(...a)=>console.log('[mock]',...a)});
const options=launchOptions();options.args.push('--mute-audio');
const browser=await chromium.launch(options);
const pages=new Map(),logs=new Map();
// Frame pacing: every rAF gap over 50 ms is kept (time, gap) so steps can report hitches.
const pacing=()=>{window.__hitches=[];let last=0;const tick=t=>{if(last&&t-last>50)window.__hitches.push([Math.round(t),Math.round(t-last)]);if(window.__hitches.length>500)window.__hitches.shift();last=t;requestAnimationFrame(tick);};requestAnimationFrame(tick);};
async function newPage(name,{viewport={width:1280,height:720},context}={}){
 const ctx=context??await browser.newContext({viewport});await ctx.addInitScript(pacing);const page=await ctx.newPage(),log=[];
 page.on('pageerror',e=>log.push({t:Date.now(),type:'pageerror',text:e.message}));
 page.on('console',m=>{if(['error','warning'].includes(m.type()))log.push({t:Date.now(),type:m.type(),text:m.text().slice(0,600)});});
 page.on('response',r=>{if(r.status()>=400)log.push({t:Date.now(),type:'http',text:`${r.status()} ${r.url()}`});});
 page.on('dialog',d=>{log.push({t:Date.now(),type:'dialog',text:d.message()});d.dismiss();});
 pages.set(name,page);logs.set(name,log);return page;}
const ctx={env,browser,pages,logs,newPage,out:OUT,shot:(page,name)=>page.screenshot({path:path.join(OUT,name+'.png')}),state:{}};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 try{
  if(url.pathname==='/stop'){res.end('bye');await browser.close();await env.close();process.exit(0);}
  const file=path.resolve(url.searchParams.get('file'));
  const mod=await import(pathToFileURL(file).href+'?t='+Date.now());
  const result=await mod.default(ctx,Object.fromEntries(url.searchParams));
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result??null,null,1));
 }catch(e){res.writeHead(500,{'content-type':'text/plain'});res.end(String(e?.stack??e));}
}).listen(4199,'127.0.0.1',()=>console.log('playtest session ready',env.origin));
