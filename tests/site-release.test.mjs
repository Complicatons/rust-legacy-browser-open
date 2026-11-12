// Website release readiness (GAP-AUDIT "Release readiness 2026-10-23"): security headers, robots.txt, sitemap.xml,
// canonical links, immutable versioned stylesheets, and the shipped pages' head tags (title, description or noindex,
// favicon, language, viewport).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createSiteHandler} from '../central/site.mjs';
import {listenServer} from '../bridge/listen.mjs';

const HTML='text/html,application/xhtml+xml,*/*;q=0.8';
const head=(extra='')=>`<!doctype html><html lang="en"><head><title>T</title>${extra}<link rel="stylesheet" href="/site/css/a.css"></head><body><!--#header--><main>x</main></body></html>`;

async function fixture(options={}){
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-site-release-'));
 const put=async(rel,text)=>{const f=path.join(dir,rel);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,text);};
 await put('partials/header.html','<header>H</header>');await put('partials/footer.html','');
 for(const p of ['index','servers','wiki','wiki-page','update'])await put(`pages/${p}.html`,head());
 for(const p of ['account','404','500'])await put(`pages/${p}.html`,head('<meta name="robots" content="noindex">'));
 await put('css/a.css','body{color:red}');await put('icons/favicon.svg','<svg xmlns="http://www.w3.org/2000/svg"/>');
 await put('content/updates/2026-10-22-the-website-is-live.md','# x');await put('content/updates/notes.txt','x');
 await put('generated/wiki/items.json',JSON.stringify({entries:[{slug:'hatchet'},{slug:'rock'},{slug:'Bad Slug'}]}));
 const site=createSiteHandler({root:pathToFileURL(dir+path.sep),...options});
 const http=createServer((q,r)=>{if(!site(q,r)&&!site(q,r,{fallback:true})){r.writeHead(418);r.end('api');}});
 await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 const get=async(p,headers={})=>{const res=await fetch(base+p,{headers});return {status:res.status,headers:res.headers,text:await res.text()};};
 return {get,close:async()=>{http.closeAllConnections();await new Promise(r=>http.close(r));await rm(dir,{recursive:true,force:true});}};
}

test('security headers on pages and assets; HSTS only for an https public URL',async()=>{
 const f=await fixture({publicUrl:'https://your-domain.example/'}),plain=await fixture({publicUrl:'http://203.0.113.207:8080/'});
 try{
  for(const p of ['/','/site/css/a.css','/robots.txt']){
   const h=(await f.get(p,{accept:HTML})).headers;
   assert.equal(h.get('x-frame-options'),'DENY',p);assert.equal(h.get('cross-origin-opener-policy'),'same-origin',p);
   assert.match(h.get('permissions-policy'),/camera=\(\), microphone=\(\), geolocation=\(\)/,p);
   assert.equal(h.get('strict-transport-security'),'max-age=31536000',p);assert.match(h.get('content-security-policy'),/frame-ancestors 'none'/,p);
  }
  assert.equal((await f.get('/nowhere',{accept:HTML})).headers.get('x-frame-options'),'DENY','the 404 page too');
  assert.equal((await plain.get('/',{accept:HTML})).headers.get('strict-transport-security'),null,'never on plain http');
 }finally{await f.close();await plain.close();}
});

test('root /favicon.ico and /favicon.svg serve the site favicon',async()=>{
 const f=await fixture();
 try{for(const p of ['/favicon.ico','/favicon.svg']){const r=await f.get(p);assert.equal(r.status,200,p);assert.match(r.headers.get('content-type'),/svg/,p);assert.match(r.text,/<svg/,p);}}
 finally{await f.close();}
});

test('robots.txt keeps crawlers off private pages, the API and the game; names the sitemap',async()=>{
 const f=await fixture({publicUrl:'https://your-domain.example/'}),bare=await fixture();
 try{
  const r=await f.get('/robots.txt');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/plain/);
  for(const p of ['/admin','/owner','/console','/staff','/account','/wiki/edit','/auth/','/play','/assets/'])assert.ok(r.text.includes('Disallow: '+p+'\n'),p);
  assert.match(r.text,/^User-agent: \*$/m);assert.match(r.text,/^Sitemap: https:\/\/your-domain.example\/sitemap\.xml$/m);
  assert.doesNotMatch((await bare.get('/robots.txt')).text,/Sitemap/,'no absolute sitemap URL without a public origin');
 }finally{await f.close();await bare.close();}
});

test('sitemap.xml lists public pages, updates and wiki entries with absolute URLs',async()=>{
 const f=await fixture({publicUrl:'https://your-domain.example/'}),bare=await fixture();
 try{
  const r=await f.get('/sitemap.xml');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^application\/xml/);
  const locs=[...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  for(const p of ['/','/servers','/wiki/calculator','/updates/2026-10-22-the-website-is-live','/wiki/items','/wiki/items/hatchet','/wiki/items/rock'])
   assert.ok(locs.includes('https://your-domain.example'+p),p);
  assert.ok(!locs.some(l=>/account|admin|Bad|notes/.test(l)),'no private pages or invalid slugs');
  assert.match(r.text,/<loc>https:\/\/your-domain.example\/updates\/2026-10-22-the-website-is-live<\/loc><lastmod>2026-10-22<\/lastmod>/);
  assert.equal(new Set(locs).size,locs.length,'no duplicates');
  assert.equal((await bare.get('/sitemap.xml')).status,418,'without a public origin there is no sitemap');
 }finally{await f.close();await bare.close();}
});

test('indexable pages get a canonical link to the public URL; noindex pages and unknown origins do not',async()=>{
 const f=await fixture({publicUrl:'https://your-domain.example/'}),bare=await fixture();
 try{
  const wiki=await f.get('/wiki/items/hatchet?ref=x',{accept:HTML});
  assert.match(wiki.text,/<link rel="canonical" href="https:\/\/your-domain.example\/wiki\/items\/hatchet">\n<\/head>/);
  const home=await f.get('/',{accept:HTML});assert.match(home.text,/href="https:\/\/your-domain.example\/"/);
  assert.equal((await f.get('/',{accept:HTML,'if-none-match':home.headers.get('etag')})).status,304);
  assert.notEqual(home.headers.get('etag'),wiki.headers.get('etag'));
  assert.doesNotMatch((await f.get('/account',{accept:HTML})).text,/canonical/);
  assert.doesNotMatch((await f.get('/nowhere',{accept:HTML})).text,/canonical/);
  assert.doesNotMatch((await bare.get('/',{accept:HTML})).text,/canonical/);
 }finally{await f.close();await bare.close();}
});

test('a stylesheet at its current ?v= is immutable; any other request revalidates',async()=>{
 const f=await fixture();
 try{
  const v=createHash('sha256').update('body{color:red}').digest('hex').slice(0,10);
  assert.match((await f.get('/',{accept:HTML})).text,new RegExp(`href="/site/css/a\\.css\\?v=${v}"`));
  assert.equal((await f.get('/site/css/a.css?v='+v)).headers.get('cache-control'),'public, max-age=31536000, immutable');
  assert.equal((await f.get('/site/css/a.css?v=0000000000')).headers.get('cache-control'),'no-cache');
  assert.equal((await f.get('/site/css/a.css')).headers.get('cache-control'),'no-cache');
 }finally{await f.close();}
});

test('the error fallback serves the 500 page to browsers only, never cached',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-site-500-'));
 try{
  await mkdir(path.join(dir,'pages'),{recursive:true});await writeFile(path.join(dir,'pages/500.html'),head('<meta name="robots" content="noindex">').replace('<main>x','<main>five hundred'));
  const site=createSiteHandler({root:pathToFileURL(dir+path.sep)});
  const http=createServer((q,r)=>{if(!site(q,r,{fallback:true,error:true})){r.writeHead(500);r.end('{"error":"internal"}');}});await listenServer(http);
  const base=`http://127.0.0.1:${http.address().port}`;
  try{
   const page=await fetch(base+'/auth/steam/callback',{headers:{accept:HTML}});assert.equal(page.status,500);assert.match(await page.text(),/five hundred/);assert.equal(page.headers.get('cache-control'),'no-store');
   const api=await fetch(base+'/me',{headers:{accept:'application/json'}});assert.equal(api.status,500);assert.equal(await api.text(),'{"error":"internal"}');
  }finally{http.closeAllConnections();await new Promise(r=>http.close(r));}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('page backgrounds offer the WebP copies tools/site-webp.mjs writes, with the JPEG as fallback',async()=>{
 const {BACKGROUNDS,SMALL_WIDTH}=await import('../tools/site-webp.mjs');
 const css=['title','launch','auth'].map(n=>readFileSync(new URL(`../site/css/pages/${n}.css`,import.meta.url),'utf8')).join('\n');
 const sets=[...css.matchAll(/image-set\(url\(\/site\/generated\/media\/([a-z0-9-]+)\.webp\) type\("image\/webp"\),url\(\/site\/generated\/media\/([a-z0-9-]+)\.jpg\) type\("image\/jpeg"\)\)/g)];
 assert.equal(sets.length,6);
 for(const [,webp,jpg] of sets){assert.ok(BACKGROUNDS.includes(jpg),jpg);assert.ok(webp===jpg||webp===`${jpg}-${SMALL_WIDTH}`,webp);}
 const {webpFor}=await import('../tools/site-webp.mjs');
 assert.equal(webpFor('/site/generated/media/gather.jpg',480),'/site/generated/media/gather-480.webp');assert.equal(webpFor('/site/generated/media/dusk.jpg'),'/site/generated/media/dusk.webp');
 assert.equal(webpFor('/site/generated/media/share-home.jpg'),null,'link-preview cards stay JPEG');assert.equal(webpFor('/site/generated/media/guides/a.jpg'),null);
 // site/js/updates.mjs carries the same rule (it cannot import tools/).
 assert.ok(readFileSync(new URL('../site/js/updates.mjs',import.meta.url),'utf8').includes("const webpFor=(src,width)=>{const m=/^\\/site\\/generated\\/media\\/([a-z0-9-]+)\\.jpg$/.exec(src??'');return m&&!m[1].startsWith('share-')?`/site/generated/media/${m[1]}${width?'-'+width:''}.webp`:null;};"));
 assert.equal((css.match(/@media \(max-width:960px\)\{\.[a-z-]+\{background-image:image-set\(url\(\/site\/generated\/media\/[a-z-]+-960\.webp\)/g)??[]).length,3,'phones get the 960-px copy');
});

// The shipped pages.
const PAGES=fileURLToPath(new URL('../site/pages/',import.meta.url));
const PRIVATE=new Set(['404','500','account','admin','owner','console','staff','signups','unsubscribe','wiki-edit','forgot','reset','verify','welcome','desktop-approve','signin']);
test('every shipped page has lang, viewport, title, the favicon, and a description or noindex',()=>{
 const pages=readdirSync(PAGES).filter(f=>f.endsWith('.html'));assert.ok(pages.length>=25);
 for(const f of pages){
  const html=readFileSync(path.join(PAGES,f),'utf8'),name=f.slice(0,-5),noindex=/<meta name="robots" content="noindex">/.test(html);
  assert.match(html,/<html lang="en">/,f);assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1">/,f);
  assert.match(html,/<title>[^<]{3,70}<\/title>/,f);assert.ok(html.includes('<link rel="icon" href="/site/icons/favicon.svg" type="image/svg+xml">'),f+' favicon');
  assert.equal(noindex,PRIVATE.has(name),`${f}: noindex exactly on private and flow pages`);
  if(!noindex){const d=html.match(/<meta name="description" content="([^"]+)">/);assert.ok(d,f+' description');assert.ok(d[1].length>=40&&d[1].length<=160,`${f}: description length ${d[1].length}`);}
 }
 assert.match(readFileSync(new URL('../site/icons/favicon.svg',import.meta.url),'utf8'),/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});
