// Serves the website (site/) from the central service's origin. Page routes answer only requests that accept HTML, so
// the JSON API on the same paths (GET /servers, /servers/{id}, /wiki/api/…) keeps working for fetch() clients.
// /site/content/roadmap/index.json is built per request from the roadmap markdown (central/roadmap.mjs).
// Pages include site/partials/{header,footer}.html at <!--#header--> / <!--#footer-->. Assets: /site/{css,js,icons,generated,content}/.
import {readFileSync,readdirSync,realpathSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRoadmap} from './roadmap.mjs';

// The game's import map (browser/index.html): the homepage's live title screen loads the game's menu scene, which
// imports 'three'. It is the only inline script a page may carry, allowed by its hash.
export const IMPORT_MAP='{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}';
// connect-src also allows wss to our own game-server subdomains (eu1.your-domain.example, ...): the game page's WebSocket
// to a server's gateway is a different host than the site itself, which 'self' alone does not cover. A server on
// another operator's own domain (OFFSHOOT-COMPATIBILITY-PLAN.md) still needs this extended case by case; tracked
// there, not solved by a CSP that cannot know every future endpoint in advance.
const CSP=`default-src 'self'; script-src 'self' 'sha256-${createHash('sha256').update(IMPORT_MAP).digest('base64')}'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' wss://*.your-domain.example; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,SLUG=/^[a-z0-9][a-z0-9-]{0,127}$/; // content slugs are file names: some updates run past 64
const ASSET_DIRS=new Set(['css','js','icons','generated','content']);
const TYPES={'.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ogg':'audio/ogg','.mp4':'video/mp4','.md':'text/markdown; charset=utf-8','.bin':'application/octet-stream'};
const EXACT={'/':'index','/servers':'servers','/island':'island','/updates':'updates','/roadmap':'roadmap','/guide':'guide','/wiki':'wiki','/wiki/edit':'wiki-edit','/forum':'forum','/leaderboard':'leaderboard',
 '/register':'register','/signin':'signin','/welcome':'welcome','/forgot':'forgot','/reset':'reset','/verify':'verify','/account':'account','/owner':'owner','/admin':'admin','/launch':'launch','/desktop/approve':'desktop-approve','/signups':'signups','/unsubscribe':'unsubscribe',
 '/privacy':'privacy','/terms':'terms','/cookies':'cookies','/contact':'contact',
 '/console':'console','/staff':'staff','/list-your-server':'list-server','/docs':'docs','/downloads':'downloads'};
const RESERVED_WIKI=new Set(['api','edit']);
// Security headers on every page and asset. Browser features the website never uses are switched off; HSTS is added when
// the public URL is https (behind Cloudflare and Caddy), never on the plain-http test deployments.
const PERMISSIONS='camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()';
const IMMUTABLE='public, max-age=31536000, immutable';
// Search engines: the public pages (robots.txt, sitemap.xml, a canonical link); account, staff and flow pages carry
// <meta name="robots" content="noindex"> in their HTML and get no canonical link.
const SITEMAP_PAGES=['/','/servers','/island','/updates','/roadmap','/guide','/wiki','/wiki/calculator','/forum','/leaderboard','/launch','/privacy','/terms','/cookies','/contact','/docs','/downloads','/list-your-server'];
const WIKI_SECTIONS=['guides','items','recipes','building','raiding','animals','resources','places','radiation'];
const ROBOTS_DISALLOW=['/admin','/owner','/console','/staff','/account','/signups','/unsubscribe','/wiki/edit','/wiki/api/','/forum/api/','/auth/','/desktop/','/play','/assets/'];
const NOINDEX=/<meta name="robots" content="noindex">/;
const xmlEscape=s=>String(s).replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
// Routes whose path is also a JSON API: served as pages only to requests that accept HTML.
const API_TWINS=new Set(['servers','server']);

// Page name for a pathname, or null.
export function pageFor(pathname){
 if(Object.hasOwn(EXACT,pathname))return EXACT[pathname];
 const p=pathname.split('/').filter(Boolean);
 if(p[0]==='servers'&&p.length===2&&UUID.test(p[1]))return 'server';
 if(p[0]==='updates'&&p.length===2&&SLUG.test(p[1]))return 'update';
 if(p[0]==='docs'&&p.length===2&&SLUG.test(p[1]))return 'doc';
 // The forum: /forum/<category> and /forum/t/<id> share one page (site/js/forum.mjs); /forum/api/… is the JSON API.
 if(p[0]==='forum'&&((p.length===2&&p[1]!=='api'&&p[1]!=='t'&&SLUG.test(p[1]))||(p.length===3&&p[1]==='t'&&/^\d{1,12}$/.test(p[2]))))return 'forum';
 // Public player profiles: /players/<username> (usernames keep their case).
 if(p[0]==='players'&&p.length===2&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/.test(p[1]))return 'player';
 if(p[0]==='wiki'&&p[1]==='edit'&&p.length===3&&SLUG.test(p[2]))return 'wiki-edit';
 if(p[0]==='wiki'&&p.length>=2&&p.length<=3&&!RESERVED_WIKI.has(p[1])&&p.slice(1).every(s=>SLUG.test(s)))return p.length===2?'wiki':'wiki-page';
 return null;
}

// profileExists(username): whether /players/<username> is a public profile; without it every valid name gets the page.
export function createSiteHandler({providers=[],devLogin=false,playUrl=null,mail=false,publicUrl=null,progress=null,profileExists=null,root=new URL('../site/',import.meta.url)}={}){
 const base=fileURLToPath(root),pages=new Map();
 // Link previews need absolute og:url/og:image/twitter:image; pages write site paths and get the public origin here.
 const origin=publicUrl?new URL(publicUrl).origin:null;
 const share=html=>origin?html.replace(/(<meta (?:property="og:(?:url|image)"|name="twitter:image") content=")\//g,`$1${origin}/`):html;
 const etag=buf=>'"'+createHash('sha256').update(buf).digest('hex').slice(0,16)+'"';
 // Stylesheet links get ?v=<content hash>, so a browser holding an old copy (one cached under Cloudflare's old 4-hour
 // browser TTL, say) fetches the new file as soon as it changes. Files that don't exist are left alone. Scripts are not
 // versioned: modules import each other by plain path (./shell.mjs), and a ?v= entry would load a second copy.
 const versionOf=rel=>{try{return createHash('sha256').update(readFileSync(path.join(base,rel))).digest('hex').slice(0,10);}catch{return null;}};
 const versioned=html=>html.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/g,tag=>
  tag.replace(/\bhref="\/site\/(css\/[^"?#]+)"/,(m,rel)=>{const v=versionOf(rel);return v?`href="/site/${rel}?v=${v}"`:m;}));
 function page(name){
  if(!pages.has(name)){
   const part=n=>{try{return readFileSync(path.join(base,'partials',n+'.html'),'utf8');}catch{return '';}};
   const html=versioned(share(readFileSync(path.join(base,'pages',name+'.html'),'utf8').replace('<!--#header-->',part('header')).replace('<!--#footer-->',part('footer'))));
   const body=Buffer.from(html);pages.set(name,{body,etag:etag(body),html,noindex:NOINDEX.test(html)});
  }
  return pages.get(name);
 }
 const hsts=origin?.startsWith('https:')?{'Strict-Transport-Security':'max-age=31536000'}:{};
 const headers=(type,tag,cache='no-cache')=>({'Content-Type':type,'Cache-Control':cache,ETag:tag,'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY','Permissions-Policy':PERMISSIONS,'Cross-Origin-Opener-Policy':'same-origin',...hsts});
 function send(req,res,status,type,{body,etag:tag,cache}){
  if(status===200&&req.headers['if-none-match']===tag){res.writeHead(304,{ETag:tag});res.end();return true;}
  // One byte range for video (Safari needs it to play, others to seek).
  const range=type.startsWith('video/')&&/^bytes=(\d*)-(\d*)$/.exec(req.headers.range??'');
  if(range&&(range[1]||range[2])){
   const n=body.length,start=range[1]?Number(range[1]):Math.max(0,n-Number(range[2])),end=range[1]&&range[2]?Math.min(Number(range[2]),n-1):n-1;
   if(start>end||start>=n){res.writeHead(416,{'Content-Range':`bytes */${n}`});res.end();return true;}
   res.writeHead(206,{...headers(type,tag,cache),'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${n}`,'Content-Length':end-start+1});
   res.end(req.method==='HEAD'?undefined:body.subarray(start,end+1));return true;
  }
  res.writeHead(status,{...headers(type,tag,cache),...(type.startsWith('video/')?{'Accept-Ranges':'bytes'}:{})});res.end(req.method==='HEAD'?undefined:body);return true;
 }
 // <link rel="canonical"> to the public URL of this path (no query), for indexable pages when the public origin is known.
 function canonical(p,pathname){
  if(!origin||p.noindex)return p;
  const body=Buffer.from(p.html.replace('</head>',`<link rel="canonical" href="${xmlEscape(origin+pathname)}">\n</head>`));return {body,etag:etag(body)};
 }
 function robots(){return ['User-agent: *',...ROBOTS_DISALLOW.map(p=>'Disallow: '+p),...(origin?['',`Sitemap: ${origin}/sitemap.xml`]:[]),''].join('\n');}
 // The public pages, the updates (site/content/updates/<date>-<slug>.md) and the wiki sections and entries
 // (site/generated/wiki/<section>.json); rebuilt at most every 10 minutes.
 let sitemapCache=null;
 function sitemap(){
  if(sitemapCache&&Date.now()-sitemapCache.at<600e3)return sitemapCache.xml;
  const urls=SITEMAP_PAGES.map(p=>({loc:p}));
  try{for(const f of readdirSync(path.join(base,'content/updates')).filter(f=>/^[a-z0-9][a-z0-9-]*\.md$/.test(f)).sort().reverse()){
   const slug=f.slice(0,-3),date=/^\d{4}-\d{2}-\d{2}/.exec(slug)?.[0];urls.push({loc:'/updates/'+slug,...(date?{lastmod:date}:{})});}}catch{}
  try{for(const f of readdirSync(path.join(base,'content/docs')).filter(f=>/^[a-z0-9][a-z0-9-]*\.md$/.test(f)).sort())urls.push({loc:'/docs/'+f.slice(0,-3)});}catch{}
  for(const section of WIKI_SECTIONS){urls.push({loc:'/wiki/'+section});
   try{const {entries=[]}=JSON.parse(readFileSync(path.join(base,'generated/wiki',section+'.json'),'utf8'));
    for(const slug of new Set(entries.map(e=>e.slug).filter(s=>SLUG.test(s??''))))urls.push({loc:`/wiki/${section}/${slug}`});}catch{}}
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
   urls.map(u=>` <url><loc>${xmlEscape(origin+u.loc)}</loc>${u.lastmod?`<lastmod>${u.lastmod}</lastmod>`:''}</url>`).join('\n')+'\n</urlset>\n';
  sitemapCache={at:Date.now(),xml};return xml;
 }
 // A stylesheet requested with its current ?v= (versioned() above) never changes under that URL: cached for a year.
 function asset(pathname,search=''){
  let rel;try{rel=decodeURIComponent(pathname.slice('/site/'.length));}catch{return null;}
  const dir=rel.split('/')[0],type=TYPES[path.extname(rel).toLowerCase()];
  if(!ASSET_DIRS.has(dir)||!type||rel.includes('\0')||rel.includes('\\'))return null;
  const file=path.resolve(base,rel);
  try{const real=realpathSync(file),allowed=realpathSync(path.join(base,dir));if(!real.startsWith(allowed+path.sep)||!statSync(real).isFile())return null;
   const body=readFileSync(real),want=new URLSearchParams(search).get('v');
   const current=Boolean(want)&&createHash('sha256').update(body).digest('hex').slice(0,10)===want;
   return {type,data:{body,etag:etag(body),...(current?{cache:IMMUTABLE}:{})}};}catch{return null;}
 }
 return (req,res,{fallback=false,error=false}={})=>{
  if(req.method!=='GET'&&req.method!=='HEAD')return false;
  const url=new URL(req.url,'http://site'),pathname=url.pathname,wantsHtml=/text\/html/.test(req.headers.accept??'');
  // fallback: the 404 page, or with {error:true} the 500 page, for a browser navigation the API could not answer.
  if(fallback){if(!wantsHtml)return false;const p=page(error?'500':'404');res.writeHead(error?500:404,{...headers('text/html; charset=utf-8',p.etag),'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:p.body);return true;}
  if(pathname==='/robots.txt'){const body=Buffer.from(robots());return send(req,res,200,'text/plain; charset=utf-8',{body,etag:etag(body)});}
  if(pathname==='/sitemap.xml'&&origin){const body=Buffer.from(sitemap());return send(req,res,200,'application/xml; charset=utf-8',{body,etag:etag(body)});}
  if(pathname==='/site-config.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({providers,devLogin,playUrl,mail}));return true;}
  if(pathname==='/site/content/roadmap/index.json'){
   let data;try{const {entries,coming}=readRoadmap(path.join(base,'content/roadmap'),path.join(base,'generated/media/roadmap'));data={entries:entries.map(({files,...e})=>e),coming};}
   catch{res.writeHead(500,{'Content-Type':'text/plain'});res.end('roadmap unavailable');return true;}
   const body=Buffer.from(JSON.stringify(data));return send(req,res,200,'application/json',{body,etag:etag(body)});
  }
  // Roadmap progress bar: live numbers from the public journal (central/progress.mjs); without a source, the file.
  if(pathname==='/site/content/progress.json'&&progress){
   progress.get().then(data=>{const body=Buffer.from(JSON.stringify(data));send(req,res,200,'application/json',{body,etag:etag(body)});},
    ()=>{res.writeHead(500,{'Content-Type':'text/plain'});res.end('progress unavailable');});
   return true;
  }
  // Crawlers and tools ask for a root favicon; the pages link /site/icons/favicon.svg, served here as well.
  if(pathname==='/favicon.ico'||pathname==='/favicon.svg'){const a=asset('/site/icons/favicon.svg','');if(a)return send(req,res,200,a.type,a.data);}
  if(pathname.startsWith('/site/')){const a=asset(pathname,url.search);if(!a){res.writeHead(404,{'Content-Type':'text/plain','X-Content-Type-Options':'nosniff'});res.end('not found');return true;}return send(req,res,200,a.type,a.data);}
  const name=pageFor(pathname);
  if(!name||(API_TWINS.has(name)&&!wantsHtml))return false;
  // Unknown or hidden player profiles are real 404s (search engines then drop them).
  if(name==='player'&&profileExists&&!profileExists(pathname.split('/')[2])){if(!wantsHtml)return false;const p=page('404');res.writeHead(404,{...headers('text/html; charset=utf-8',p.etag),'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:p.body);return true;}
  try{return send(req,res,200,'text/html; charset=utf-8',canonical(page(name),pathname));}catch{return false;}
 };
}
