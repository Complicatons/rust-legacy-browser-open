// Link previews (Discord, social sites): og:image/og:url must be absolute, so the site handler fills in publicUrl.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSiteHandler} from '../central/site.mjs';
import {listenServer} from '../bridge/listen.mjs';

const PAGE='<!doctype html><head><meta property="og:url" content="/launch"><meta property="og:image" content="/site/generated/media/share-launch.jpg"><meta name="twitter:image" content="/site/generated/media/share-launch.jpg"><meta property="og:title" content="/not-a-path"></head><body><!--#header--></body>';

async function serve(options){
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-share-'));
 await mkdir(path.join(dir,'pages'),{recursive:true});await mkdir(path.join(dir,'partials'),{recursive:true});
 await writeFile(path.join(dir,'pages/launch.html'),PAGE);
 const site=createSiteHandler({...options,root:pathToFileURL(dir+path.sep)});
 const http=createServer((q,r)=>{if(!site(q,r)){r.writeHead(404);r.end();}});await listenServer(http);
 const get=async p=>(await fetch(`http://127.0.0.1:${http.address().port}${p}`,{headers:{accept:'text/html'}})).text();
 return {get,close:async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));await rm(dir,{recursive:true,force:true});}};
}

test('share tags point at the public site when publicUrl is known', async()=>{
 const s=await serve({publicUrl:'https://rustlegacy.example/'});
 try{
  const html=await s.get('/launch');
  assert.match(html,/<meta property="og:url" content="https:\/\/rustlegacy\.example\/launch">/);
  assert.match(html,/<meta property="og:image" content="https:\/\/rustlegacy\.example\/site\/generated\/media\/share-launch\.jpg">/);
  assert.match(html,/<meta name="twitter:image" content="https:\/\/rustlegacy\.example\/site\/generated\/media\/share-launch\.jpg">/);
  assert.match(html,/<meta property="og:title" content="\/not-a-path">/,'only url and image tags are rewritten');
 }finally{await s.close();}
});

test('without publicUrl the share tags keep their site paths', async()=>{
 const s=await serve({});
 try{assert.match(await s.get('/launch'),/<meta property="og:image" content="\/site\/generated\/media\/share-launch\.jpg">/);}finally{await s.close();}
});

test('the launch and home pages carry a large share card', async()=>{
 for(const page of ['launch','index']){
  const html=await readFile(new URL(`../site/pages/${page}.html`,import.meta.url),'utf8');
  for(const tag of ['og:title','og:description','og:url','og:image','og:type','og:site_name'])assert.match(html,new RegExp(`<meta property="${tag}" content="[^"]+">`),`${page}: ${tag}`);
  assert.match(html,/<meta name="twitter:card" content="summary_large_image">/,`${page}: twitter:card`);
  assert.match(html,/<meta property="og:image" content="\/site\/generated\/media\/share-[a-z]+\.jpg">/,`${page}: card image`);
 }
});
