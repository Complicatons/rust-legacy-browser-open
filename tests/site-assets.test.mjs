// Asset versions (central/site.mjs): pages link stylesheets with ?v=<content hash>, so a browser holding an old copy
// (e.g. one cached by Cloudflare's old 4-hour browser TTL) fetches the new file as soon as it changes. Scripts stay plain:
// modules import each other by plain path, and a versioned entry would load a second copy of a shared module.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSiteHandler} from '../central/site.mjs';
import {listenServer} from '../bridge/listen.mjs';

async function site(files){
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-assets-'));
 for(const [rel,text] of Object.entries(files)){const f=path.join(dir,rel);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,text);}
 const handler=createSiteHandler({root:pathToFileURL(dir+path.sep)});
 const http=createServer((q,r)=>{if(!handler(q,r)){r.writeHead(404);r.end();}});await listenServer(http);
 const get=async p=>{const res=await fetch(`http://127.0.0.1:${http.address().port}${p}`,{headers:{accept:'text/html'}});return [res.status,await res.text()];};
 return {dir,get,close:async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));}};
}
const FILES={
 'pages/index.html':'<!doctype html><head><link rel="stylesheet" href="/site/css/a.css"><script type="module" src="/site/js/b.mjs"></script><link rel="icon" href="data:,"></head><body><!--#header--></body>',
 'partials/header.html':'<link rel="stylesheet" href="/site/css/missing.css"><a href="/site/css/a.css">not a stylesheet link</a>',
 'css/a.css':'body{color:red}','js/b.mjs':'export const b=1;',
};

test('stylesheet links carry a version that follows the file content; scripts keep their plain path', async()=>{
 const one=await site(FILES);let v1;
 try{
  const [,html]=await one.get('/');
  v1=/href="\/site\/css\/a\.css\?v=([0-9a-f]{10})"/.exec(html)?.[1];assert.ok(v1,'stylesheet versioned');
  assert.match(html,/<script type="module" src="\/site\/js\/b\.mjs">/,'script left plain');
  assert.match(html,/href="\/site\/css\/missing\.css"/,'a missing file is left as it is');
  assert.match(html,/<a href="\/site\/css\/a\.css">/,'only stylesheet links change');
  const [status,css]=await one.get('/site/css/a.css?v='+v1);assert.equal(status,200);assert.equal(css,'body{color:red}');
 }finally{await one.close();await rm(one.dir,{recursive:true,force:true});}
 const two=await site({...FILES,'css/a.css':'body{color:blue}'});
 try{const [,html]=await two.get('/');assert.notEqual(/a\.css\?v=([0-9a-f]{10})/.exec(html)[1],v1,'new content, new version');}
 finally{await two.close();await rm(two.dir,{recursive:true,force:true});}
});
