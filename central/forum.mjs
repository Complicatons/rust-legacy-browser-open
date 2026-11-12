// Forum (website phase 2), mounted by service.mjs. Anyone reads; signed-in accounts with a username post; platform staff
// moderate. Posts are the wiki's restricted markdown (site/js/markdown.mjs), rendered here with escaping.
//   GET  /forum/api/categories                        → {categories:[{id,title,blurb,staffOnly,threads,posts,lastAt,latest}], viewer}
//   GET  /forum/api/categories/<cat>?page=            → {category, threads:[…], page, pages, total, viewer}
//   POST /forum/api/categories/<cat>/threads {title,body}   → {id, post}   (Announcements: staff only)
//   GET  /forum/api/threads/<id>?page=|?post=<id>     → {thread, posts:[{id,n,author,html,body,…}], page, pages, total, viewer}
//   POST /forum/api/threads/<id>/posts {body}         → {id, page}       (locked threads: staff only)
//   PUT  /forum/api/posts/<id> {body}                 author edits their own post
//   POST /forum/api/posts/<id>/delete                 author (own replies) or staff (audited forum-delete-post)
//   POST /forum/api/threads/<id>/pin {pinned} | /lock {locked} | /delete    staff (audited forum-pin/-unpin/-lock/-unlock/-delete-thread)
//   GET  /forum/api/bans                              staff: [{name,reason,by,createdAt,expiresAt}]
//   POST /forum/api/bans {name,reason,days?}          staff: no posting for `days` (none = until removed); audited forum-ban
//   POST /forum/api/bans/remove {name}                staff; audited forum-unban
// Who may post: an active account (suspended ones are refused by website()) with a username, no forum ban and no
// network ban. Writes are rate limited per IP (limited 'forum') and one post per FLOOD_MS per account (staff exempt).
import {renderMarkdown} from '../site/js/markdown.mjs';
import {generatedResolvers} from './wiki.mjs';

export const FORUM_CATEGORIES=Object.freeze([
 {id:'announcements',title:'Announcements',blurb:'News from the team',staffOnly:true},
 {id:'general',title:'General',blurb:'Anything Rust Legacy'},
 {id:'help',title:'Help',blurb:'Questions about playing'},
 {id:'servers',title:'Servers',blurb:'Server news and owners'},
 {id:'suggestions',title:'Suggestions',blurb:'Ideas for the port and site'},
 {id:'bugs',title:'Bug reports',blurb:'Something broken'},
]);
export const THREADS_PER_PAGE=25,POSTS_PER_PAGE=20,FLOOD_MS=15e3;
const MAX_TITLE=120,MIN_TITLE=3,MAX_BODY=20_000,MAX_REASON=200,MAX_DAYS=3650;
const PATH=/^\/forum\/api\/(categories|threads|posts)\/([^/]+)(?:\/([a-z]+))?$/,ID=/^\d{1,12}$/;
const ROUTES={categories:{'GET':'category','POST threads':'create'},threads:{'GET':'thread','POST posts':'reply','POST pin':'pin','POST lock':'lock','POST delete':'deleteThread'},posts:{'PUT':'edit','POST delete':'deletePost'}};
const category=id=>FORUM_CATEGORIES.find(c=>c.id===id)??null;

export function createForumRoutes({db,now,website,body,limited,HttpError,resolvers=generatedResolvers()}){
 const lastPost=new Map(); // account → time of its last post (flood control, memory only)
 const signedIn=req=>{try{return website(req,{mutation:false});}catch{return null;}};
 // Why this account may not post right now, or null.
 function refusal(player){
  if(!player.username)return 'username-required';
  if(db.isStaff(player.uuid))return null;
  if(db.forumBan(player.uuid,now()))return 'forum-banned';
  if(db.activeBan(player.uuid,null,now()))return 'banned';
  return null;
 }
 const viewer=ctx=>ctx&&{name:ctx.player.username??ctx.player.display_name,staff:db.isStaff(ctx.player.uuid),canPost:!refusal(ctx.player),reason:refusal(ctx.player)};
 // A write: same-origin session with CSRF, per-IP limit, then the posting rules.
 function writer(req){
  if(limited(req,'forum'))throw new HttpError(429,'rate-limited');
  const ctx=website(req,{mutation:true}),why=refusal(ctx.player);if(why)throw new HttpError(403,why);
  return {...ctx,staff:db.isStaff(ctx.player.uuid)};
 }
 const staff=req=>{if(limited(req,'forum'))throw new HttpError(429,'rate-limited');const ctx=website(req,{mutation:true});if(!db.isStaff(ctx.player.uuid))throw new HttpError(403,'staff-only');return ctx;};
 function flood(ctx){
  if(ctx.staff)return;const last=lastPost.get(ctx.player.uuid);
  if(last!=null&&now()-last<FLOOD_MS)throw new HttpError(429,'posting-too-fast');
 }
 const posted=ctx=>{lastPost.set(ctx.player.uuid,now());if(lastPost.size>5000)for(const [k,t] of lastPost)if(now()-t>=FLOOD_MS)lastPost.delete(k);};
 const title=v=>{const t=typeof v==='string'?v.trim().replace(/\s+/g,' '):'';if(t.length<MIN_TITLE||t.length>MAX_TITLE)throw new HttpError(400,'invalid-thread-title');return t;};
 const postText=v=>{const t=typeof v==='string'?v.trim():'';if(!t)throw new HttpError(400,'empty-post');if(t.length>MAX_BODY)throw new HttpError(400,'post-too-long');return t;};
 const pageOf=(req,pages)=>{const p=Number(new URL(req.url,'http://central').searchParams.get('page'));return Number.isInteger(p)&&p>=1?Math.min(p,Math.max(pages,1)):1;};
 const pagesFor=(n,per)=>Math.max(1,Math.ceil(n/per));
 const thread=id=>{const t=ID.test(id)?db.forumThread(Number(id)):null;if(!t||t.deleted_at!=null)throw new HttpError(404,'unknown-thread');return t;};
 const post=id=>{const p=ID.test(id)?db.forumPost(Number(id)):null;if(!p||p.deleted_at!=null)throw new HttpError(404,'unknown-post');thread(String(p.thread_id));return p;};
 const audit=(ctx,action,target,detail)=>db.audit(now(),ctx.player.uuid,action,target,detail);
 const threadRow=t=>({id:t.id,title:t.title,author:t.author,createdAt:t.created_at,lastAt:t.last_post_at,lastBy:t.last_by,posts:t.posts,replies:Math.max(0,t.posts-1),pinned:Boolean(t.pinned),locked:Boolean(t.locked)});
 const postView=(p,n,first,ctx)=>({id:p.id,n,author:p.author,createdAt:p.created_at,first,
  ...(p.deleted_at!=null?{deleted:p.deleted_by===p.author_uuid?'author':'staff'}:{body:p.body,html:renderMarkdown(p.body,resolvers),editedAt:p.edited_at??null,mine:ctx?.player.uuid===p.author_uuid})});

 const handlers={
  async category(req,id){
   const c=category(id);if(!c)throw new HttpError(404,'unknown-category');
   const total=db.forumThreadCount(c.id),pages=pagesFor(total,THREADS_PER_PAGE),page=pageOf(req,pages);
   return [200,{category:c,threads:db.forumThreads(c.id,THREADS_PER_PAGE,(page-1)*THREADS_PER_PAGE).map(threadRow),page,pages,total,viewer:viewer(signedIn(req))}];
  },
  async create(req,id){
   const c=category(id);if(!c)throw new HttpError(404,'unknown-category');
   const ctx=writer(req),b=await body(req,64_000);
   if(c.staffOnly&&!ctx.staff)throw new HttpError(403,'staff-only');
   const t=title(b.title),words=postText(b.body);flood(ctx);
   const made=db.tx(()=>db.createForumThread({category:c.id,title:t,body:words,by:ctx.player.uuid,at:now()}));posted(ctx);
   return [201,{id:made.thread,post:made.post}];
  },
  async thread(req,id){
   const t=thread(id),ctx=signedIn(req),total=db.forumPostCount(t.id),pages=pagesFor(total,POSTS_PER_PAGE);
   const at=new URL(req.url,'http://central').searchParams.get('post');
   const page=at&&ID.test(at)?Math.min(pages,Math.max(1,Math.ceil(db.forumPostPosition(t.id,Number(at))/POSTS_PER_PAGE))):pageOf(req,pages);
   const first=db.forumFirstPost(t.id),offset=(page-1)*POSTS_PER_PAGE;
   return [200,{thread:{id:t.id,title:t.title,author:t.author,createdAt:t.created_at,pinned:Boolean(t.pinned),locked:Boolean(t.locked),category:category(t.category)},
    posts:db.forumPosts(t.id,POSTS_PER_PAGE,offset).map((p,i)=>postView(p,offset+i+1,p.id===first,ctx)),page,pages,total,viewer:viewer(ctx)}];
  },
  async reply(req,id){
   const t=thread(id),ctx=writer(req),b=await body(req,64_000);
   if(t.locked&&!ctx.staff)throw new HttpError(403,'thread-locked');
   const words=postText(b.body);flood(ctx);
   const pid=db.addForumPost({thread:t.id,body:words,by:ctx.player.uuid,at:now()});posted(ctx);
   return [201,{id:pid,page:pagesFor(db.forumPostCount(t.id),POSTS_PER_PAGE)}];
  },
  async edit(req,id){
   const p=post(id),ctx=writer(req),b=await body(req,64_000);
   if(p.author_uuid!==ctx.player.uuid)throw new HttpError(403,'not-your-post');
   if(db.forumThread(p.thread_id).locked&&!ctx.staff)throw new HttpError(403,'thread-locked');
   db.editForumPost(p.id,postText(b.body),now());
   return [200,{id:p.id}];
  },
  async deletePost(req,id){
   const p=post(id);if(limited(req,'forum'))throw new HttpError(429,'rate-limited');
   const ctx=website(req,{mutation:true}),isStaff=db.isStaff(ctx.player.uuid);
   if(!isStaff&&p.author_uuid!==ctx.player.uuid)throw new HttpError(403,'not-your-post');
   if(db.forumFirstPost(p.thread_id)===p.id)throw new HttpError(400,'first-post');
   db.tx(()=>{db.deleteForumPost(p.id,ctx.player.uuid,now());audit(ctx,'forum-delete-post',`forum-post:${p.id}`,{thread:p.thread_id,...(p.author_uuid!==ctx.player.uuid?{author:p.author_uuid}:{})});});
   return [200,{deleted:true}];
  },
  async pin(req,id){
   const t=thread(id),ctx=staff(req),on=Boolean((await body(req)).pinned);
   db.tx(()=>{db.setForumThreadFlag(t.id,'pinned',on);audit(ctx,on?'forum-pin':'forum-unpin',`forum-thread:${t.id}`);});
   return [200,{pinned:on}];
  },
  async lock(req,id){
   const t=thread(id),ctx=staff(req),on=Boolean((await body(req)).locked);
   db.tx(()=>{db.setForumThreadFlag(t.id,'locked',on);audit(ctx,on?'forum-lock':'forum-unlock',`forum-thread:${t.id}`);});
   return [200,{locked:on}];
  },
  async deleteThread(req,id){
   const t=thread(id),ctx=staff(req);
   db.tx(()=>{db.deleteForumThread(t.id,ctx.player.uuid,now());audit(ctx,'forum-delete-thread',`forum-thread:${t.id}`,{title:t.title,category:t.category});});
   return [200,{deleted:true,category:t.category}];
  },
 };
 const target=name=>{const p=typeof name==='string'&&name.trim()?db.playerByUsernameKey(name.trim().toLowerCase()):null;if(!p)throw new HttpError(404,'unknown-player');return p;};
 const routes={
  'GET /forum/api/categories':async req=>{
   const stats=new Map(db.forumCategoryStats().map(s=>[s.category,s])),latest=new Map(db.forumLatest().map(l=>[l.category,l]));
   return [200,{categories:FORUM_CATEGORIES.map(c=>{const s=stats.get(c.id),l=latest.get(c.id);
    return {...c,staffOnly:Boolean(c.staffOnly),threads:s?.threads??0,posts:s?.posts??0,lastAt:s?.last_at??null,latest:l?{id:l.id,title:l.title,by:l.last_by,at:l.last_post_at}:null};}),viewer:viewer(signedIn(req))}];
  },
  'GET /forum/api/bans':async req=>{const ctx=website(req,{mutation:false});if(!db.isStaff(ctx.player.uuid))throw new HttpError(403,'staff-only');
   return [200,db.forumBans(now()).map(b=>({name:b.name,reason:b.reason,by:b.by_name,createdAt:b.created_at,expiresAt:b.expires_at}))];},
  'POST /forum/api/bans':async req=>{
   const ctx=staff(req),b=await body(req),p=target(b.name);
   if(db.isStaff(p.uuid))throw new HttpError(400,'cannot-ban-staff');
   const reason=typeof b.reason==='string'?b.reason.trim():'';if(!reason||reason.length>MAX_REASON)throw new HttpError(400,'reason-required');
   const days=b.days==null||b.days===''?null:Number(b.days);if(days!==null&&!(Number.isInteger(days)&&days>=1&&days<=MAX_DAYS))throw new HttpError(400,'invalid-days');
   const expires=days?now()+days*86400e3:null;
   db.tx(()=>{db.setForumBan({player:p.uuid,reason,by:ctx.player.uuid,at:now(),expires});audit(ctx,'forum-ban',p.uuid,{reason,expires});});
   return [200,{name:p.username,expiresAt:expires}];
  },
  'POST /forum/api/bans/remove':async req=>{
   const ctx=staff(req),p=target((await body(req)).name);
   const removed=db.tx(()=>{const r=db.removeForumBan(p.uuid);if(r)audit(ctx,'forum-unban',p.uuid);return r;});
   return [200,{removed}];
  },
 };
 // [handler, id] for a /forum/api/{categories|threads|posts}/<id>[/<action>] request, or null.
 function resolve(method,pathname){
  const m=PATH.exec(pathname);if(!m)return null;
  const name=ROUTES[m[1]][m[3]?`${method} ${m[3]}`:method];
  return name?[handlers[name],m[2]]:null;
 }
 return {routes,resolve};
}
