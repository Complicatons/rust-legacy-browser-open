// Staff wiki articles (website spec §6.2), mounted by service.mjs. Anyone reads; platform staff write and restore.
//   GET  /wiki/api/articles                        → [{slug,title,section,updatedAt}]
//   GET  /wiki/api/articles/<slug>                 → {slug,title,section,body,html,updatedAt,updatedBy}
//   PUT  /wiki/api/articles/<slug> {title,section,body,note}   staff; every save is a revision (audited wiki-edit)
//   GET  /wiki/api/articles/<slug>/revisions       → [{id,title,note,createdAt,createdBy}]
//   POST /wiki/api/articles/<slug>/restore/<id>    staff; saves that revision's text as a new one (audited wiki-restore)
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {renderMarkdown} from '../site/js/markdown.mjs';

export const WIKI_SLUG=/^[a-z0-9-]{1,64}$/;
const SECTION=/^[a-z0-9-]{1,32}$/,MAX_TITLE=120,MAX_NOTE=200,MAX_BODY=100_000;
const PATH=/^\/wiki\/api\/articles\/([^/]+)(?:\/(revisions)|\/restore\/([^/]+))?$/;

// Item and place embeds resolve against the generated wiki data when it exists (read once, on first use).
export function generatedResolvers(dir=new URL('../site/generated/wiki/',import.meta.url)){
 let cache=null;
 const load=()=>{if(cache)return cache;const read=f=>{try{return JSON.parse(readFileSync(fileURLToPath(new URL(f,dir)),'utf8')).entries;}catch{return [];}};
  const key=s=>String(s).trim().toLowerCase();cache={items:new Map(read('items.json').map(i=>[key(i.name),i])),places:new Map(read('places.json').map(p=>[key(p.title),p]))};return cache;};
 return {resolveItem:n=>load().items.get(n.trim().toLowerCase())??null,resolvePlace:n=>load().places.get(n.trim().toLowerCase())??null};
}

export function createWikiRoutes({db,now,website,body,HttpError,resolvers=generatedResolvers()}){
 const staff=(req)=>{const ctx=website(req,{mutation:true});if(!db.isStaff(ctx.player.uuid))throw new HttpError(403,'staff-only');return ctx;};
 const article=slug=>{const a=db.wikiArticle(slug);if(!a)throw new HttpError(404,'not-found');return a;};
 const text=(v,max,code)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw new HttpError(400,code);return v.trim();};
 const routes={
  'GET /wiki/api/articles':async()=>[200,db.wikiArticles().map(a=>({slug:a.slug,title:a.title,section:a.section,updatedAt:a.updated_at}))],
  'GET /wiki/api/articles/:slug':async(req,slug)=>{const a=article(slug);
   return [200,{slug:a.slug,title:a.title,section:a.section,body:a.body,html:renderMarkdown(a.body,resolvers),updatedAt:a.updated_at,updatedBy:a.updated_by_name}];},
  'PUT /wiki/api/articles/:slug':async(req,slug)=>{const ctx=staff(req),b=await body(req,600_000);
   const title=text(b.title,MAX_TITLE,'invalid-title');
   if(typeof b.section!=='string'||!SECTION.test(b.section))throw new HttpError(400,'invalid-section');
   if(typeof b.body!=='string')throw new HttpError(400,'invalid-body');if(b.body.length>MAX_BODY)throw new HttpError(400,'body-too-long');
   const note=typeof b.note==='string'?b.note.trim().slice(0,MAX_NOTE):'';
   const id=db.tx(()=>{const id=db.saveWikiArticle({slug,title,section:b.section,body:b.body,note,by:ctx.player.uuid,at:now()});db.audit(now(),ctx.player.uuid,'wiki-edit',slug,{revision:id});return id;});
   return [200,{slug,revision:id}];},
  'GET /wiki/api/articles/:slug/revisions':async(req,slug)=>{article(slug);
   return [200,db.wikiRevisions(slug).map(r=>({id:r.id,title:r.title,note:r.note,createdAt:r.created_at,createdBy:r.created_by_name}))];},
  'POST /wiki/api/articles/:slug/restore/:id':async(req,slug,rev)=>{const ctx=staff(req);article(slug);
   const r=/^\d{1,12}$/.test(rev)?db.wikiRevision(slug,Number(rev)):null;if(!r)throw new HttpError(404,'unknown-revision');
   const id=db.tx(()=>{const id=db.saveWikiArticle({slug,title:r.title,section:r.section,body:r.body,note:`Restored revision ${r.id}`,by:ctx.player.uuid,at:now()});db.audit(now(),ctx.player.uuid,'wiki-restore',slug,{from:r.id,revision:id});return id;});
   return [200,{slug,revision:id}];},
 };
 // Slug paths: [route, ...args] for a /wiki/api/articles/<slug>… request, or null. A malformed slug is a 400.
 function resolve(method,pathname){
  const m=PATH.exec(pathname);if(!m)return null;const [,slug,revisions,rev]=m;
  const key=method+' /wiki/api/articles/:slug'+(revisions?'/revisions':rev!==undefined?'/restore/:id':'');
  if(!routes[key])return null;
  if(!WIKI_SLUG.test(slug))return [async()=>{throw new HttpError(400,'invalid-slug');}];
  return [routes[key],slug,rev];
 }
 return {routes:{'GET /wiki/api/articles':routes['GET /wiki/api/articles']},resolve};
}
