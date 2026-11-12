// Website static handler (central/site.mjs): page routes with shared partials, /site/* assets, security headers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {listenServer} from '../bridge/listen.mjs';

const HTML='text/html,application/xhtml+xml,*/*;q=0.8';
import {createHash} from 'node:crypto';
import {createSiteHandler,IMPORT_MAP} from '../central/site.mjs';
// The only inline script a page may carry is the game's import map (for the live title screen), allowed by its hash.
// connect-src also allows wss to our own game-server subdomains (eu1.your-domain.example, ...): the game page's
// WebSocket to the gateway is a different host than the site itself, which 'self' alone does not cover (found 29
// Oct: a real browser silently refuses the connection, with no network request at all, while curl — which does not
// enforce CSP — looked fine).
const CSP=`default-src 'self'; script-src 'self' 'sha256-${createHash('sha256').update(IMPORT_MAP).digest('base64')}'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' wss://*.your-domain.example; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;

async function fixture(options={},files={}){
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-site-'));
 const put=async(rel,text)=>{const f=path.join(dir,rel);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,text);};
 await put('partials/header.html','<header class="bar">HEADER-PARTIAL</header>');
 await put('partials/footer.html','<footer>FOOTER-PARTIAL</footer>');
 for(const page of ['index','servers','server','wiki','wiki-page','404'])await put(`pages/${page}.html`,`<!doctype html><body data-page="${page}"><!--#header--><main>${page}</main><!--#footer--></body>`);
 await put('css/a.css','body{color:red}');
 await put('js/a.exe','nope');
 await put('generated/map/heights.bin','');
 for(const [rel,text] of Object.entries(files))await put(rel,text);
 const site=createSiteHandler({root:pathToFileURL(dir+path.sep),...options});
 const http=createServer((q,r)=>{if(!site(q,r)){if(!site(q,r,{fallback:true})){r.writeHead(418);r.end('api');}}});
 await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 const get=async(p,headers={})=>{const res=await fetch(base+p,{headers});return {status:res.status,headers:res.headers,text:await res.text()};};
 return {get,close:async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));await rm(dir,{recursive:true,force:true});}};
}

test('serves pages with partials included',async()=>{
 const f=await fixture();
 try{
  const r=await f.get('/servers',{accept:HTML});
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/html/);
  assert.match(r.text,/HEADER-PARTIAL[\s\S]*<main>servers<\/main>[\s\S]*FOOTER-PARTIAL/);
  assert.doesNotMatch(r.text,/<!--#header-->/);
 }finally{await f.close();}
});

test('page routes are only served to requests that accept html',async()=>{
 const f=await fixture();
 try{assert.equal((await f.get('/servers',{accept:'application/json'})).status,418);assert.equal((await f.get('/servers')).status,418);assert.match((await f.get('/')).text,/<main>index<\/main>/,'pages without an API twin ignore Accept');}
 finally{await f.close();}
});

test('sets CSP and security headers',async()=>{
 const f=await fixture();
 try{const r=await f.get('/',{accept:HTML});assert.equal(r.headers.get('content-security-policy'),CSP);assert.equal(r.headers.get('x-content-type-options'),'nosniff');}
 finally{await f.close();}
});

test('serves allowlisted assets with etag and 304',async()=>{
 const f=await fixture();
 try{
  const r=await f.get('/site/css/a.css');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/css/);assert.ok(r.headers.get('etag'));
  assert.equal((await f.get('/site/css/a.css',{'if-none-match':r.headers.get('etag')})).status,304);
 }finally{await f.close();}
});

test('rejects traversal and unknown types',async()=>{
 const f=await fixture();
 try{
  for(const p of ['/site/css/../../central/db.mjs','/site/css/%2e%2e/%2e%2e/central/db.mjs','/site/js/a.exe','/site/partials/header.html']){
   const r=await f.get(p);assert.ok([404,418].includes(r.status),p+' → '+r.status);assert.doesNotMatch(r.text,/openCentralDb|nope|HEADER-PARTIAL/);
  }
 }finally{await f.close();}
});

test('missing generated files are 404 not 500',async()=>{
 const f=await fixture();
 try{assert.equal((await f.get('/site/generated/map/modern.json')).status,404);}finally{await f.close();}
});

test('binary map data is served as octet-stream',async()=>{
 const f=await fixture();
 try{const r=await f.get('/site/generated/map/heights.bin');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/octet-stream');}finally{await f.close();}
});

test('site-config reports mail flag',async()=>{
 const f=await fixture({providers:['steam'],mail:true});
 try{assert.deepEqual(JSON.parse((await f.get('/site-config.json')).text),{providers:['steam'],devLogin:false,playUrl:null,mail:true});}
 finally{await f.close();}
});

test('uuid server page and slug pages route',async()=>{
 const f=await fixture();
 try{
  assert.match((await f.get('/servers/0b4e7f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b',{accept:HTML})).text,/<main>server<\/main>/);
  assert.match((await f.get('/wiki/items/hatchet',{accept:HTML})).text,/<main>wiki-page<\/main>/);
  assert.match((await f.get('/wiki/items',{accept:HTML})).text,/<main>wiki<\/main>/);
  assert.equal((await f.get('/wiki/api/articles',{accept:HTML})).status,404,'the wiki API path never becomes a page; the fallback 404 page answers html');
 }finally{await f.close();}
});

test('fallback serves the 404 page for unknown html requests',async()=>{
 const f=await fixture();
 try{const r=await f.get('/nowhere',{accept:HTML});assert.equal(r.status,404);assert.match(r.text,/<main>404<\/main>/);}
 finally{await f.close();}
});

test('the import map matches the one the game page uses',async()=>{
 const {readFileSync}=await import('node:fs');
 assert.ok(readFileSync(new URL('../browser/index.html',import.meta.url),'utf8').includes(`<script type="importmap">${IMPORT_MAP}</script>`));
});

test('serves mp4 clips as video/mp4 with byte ranges',async()=>{
 const f=await fixture({},{'generated/media/roadmap/a.mp4':'0123456789'});
 try{
  const r=await f.get('/site/generated/media/roadmap/a.mp4');
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'video/mp4');assert.equal(r.headers.get('accept-ranges'),'bytes');assert.equal(r.text,'0123456789');
  const part=await f.get('/site/generated/media/roadmap/a.mp4',{range:'bytes=2-5'});
  assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),'bytes 2-5/10');assert.equal(part.text,'2345');
  assert.equal((await f.get('/site/generated/media/roadmap/a.mp4',{range:'bytes=7-'})).text,'789');
  assert.equal((await f.get('/site/generated/media/roadmap/a.mp4',{range:'bytes=-3'})).text,'789');
  assert.equal((await f.get('/site/generated/media/roadmap/a.mp4',{range:'bytes=20-'})).status,416);
 }finally{await f.close();}
});

test('roadmap page and index: entries in date order, media only when built',async()=>{
 const f=await fixture({},{
  'pages/roadmap.html':'<!doctype html><body data-page="roadmap"><!--#header--><main>roadmap</main><!--#footer--></body>',
  'content/roadmap/2026-10-17-1-b.md':'---\ndate: 2026-10-17\nend: 2026-10-18\ntitle: Second\nstats: 12 | zones; 3 s | fuse\nmedia: a.mp4 | A clip; gone.jpg | Not built\n---\nBody **two**',
  'content/roadmap/2026-10-16-1-a.md':'---\ndate: 2026-10-16\ntitle: First\n---\nBody one',
  'content/roadmap/2026-10-19-1-bad.md':'---\ntitle: No date\n---\nx',
  'content/roadmap/whats-coming.md':'---\nkind: coming\ntitle: Next up\n---\n## Real servers',
  'generated/media/roadmap/a.mp4':'v','generated/media/roadmap/a.poster.jpg':'p',
 });
 try{
  assert.match((await f.get('/roadmap',{accept:HTML})).text,/HEADER-PARTIAL[\s\S]*<main>roadmap<\/main>/);
  const r=await f.get('/site/content/roadmap/index.json');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/json');
  const {entries,coming}=JSON.parse(r.text);
  assert.deepEqual(entries.map(e=>e.title),['First','Second'],'sorted by date; the malformed entry is left out');
  assert.deepEqual(entries[1].stats,[{value:'12',label:'zones'},{value:'3 s',label:'fuse'}]);
  assert.deepEqual(entries[1].media,[{type:'video',src:'/site/generated/media/roadmap/a.mp4',poster:'/site/generated/media/roadmap/a.poster.jpg',caption:'A clip'}]);
  assert.equal(entries[1].end,'2026-10-18');assert.equal(entries[1].body,'Body **two**');
  assert.equal(coming.title,'Next up');assert.match(coming.body,/Real servers/);
 }finally{await f.close();}
});
