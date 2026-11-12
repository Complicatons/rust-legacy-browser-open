// Launch sign-ups ("notify me when the servers open") and the opening-day email, mounted by service.mjs.
//   POST /launch/notify {email, website}      public, same-origin, rate limited; always answers {ok:true} for a valid
//                                             email (no hint whether it was already on the list). `website` is a
//                                             hidden trap field: when a bot fills it, nothing is stored.
//   POST /launch/unsubscribe {token} | ?t=    public, rate limited, no Origin needed (mail apps' RFC 8058 one-click
//                                             POST to the List-Unsubscribe URL); always {ok:true}
//   GET  /admin/waitlist                      platform staff: {count, entries:[{email, createdAt}], mail, from, mailings}
//   POST /admin/waitlist/remove {email}       platform staff (CSRF); audited as waitlist-remove
//   POST /admin/waitlist/mail {subject, text, test?}   platform staff (CSRF): test → only to the staff member's own
//                                             email; otherwise a mailing to everyone on the list, sent one by one in the
//                                             background (202), each with their own unsubscribe link; audited
//   POST /admin/waitlist/mail/resume {mailing}         sends that mailing to whoever it has not reached yet
import {checkEmail,emailKey} from './passwords.mjs';
import {createNullMailer} from './mailer.mjs';
import {waitlistMailHtml} from './mail-templates.mjs';

const TOKEN=/^[0-9a-f]{32}$/;

export function createWaitlistRoutes({db,now,body,website,limited,HttpError,allowedOrigins,mailer=createNullMailer(),publicUrl='https://play.example.test/',pauseMs=250}){
 const staff=(req,mutation)=>{const ctx=website(req,{mutation});if(!db.isStaff(ctx.player.uuid))throw new HttpError(403,'staff-only');return ctx;};
 const link=p=>new URL(p,publicUrl).href;
 // What every recipient sees under the message, and the headers mail apps use for their own unsubscribe button.
 const letter=({subject,text},token)=>{
  const launchUrl=link('launch'),unsubscribeUrl=link('unsubscribe?t='+token);
  return {subject,
   text:`${text.trimEnd()}\n\n—\nYou're getting this because you signed up at ${launchUrl} to hear when Rust Legacy Browser opens.\nUnsubscribe: ${unsubscribeUrl}`,
   html:waitlistMailHtml({subject,text,launchUrl,unsubscribeUrl}),
   headers:{'List-Unsubscribe':`<${link('launch/unsubscribe?t='+token)}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
 };
 const message=b=>{
  const subject=String(b.subject??'').trim(),text=String(b.text??'');
  if(!subject)throw new HttpError(400,'subject-required');if(subject.length>150)throw new HttpError(400,'subject-too-long');
  if(!text.trim())throw new HttpError(400,'text-required');if(text.length>20000)throw new HttpError(400,'text-too-long');
  return {subject,text};
 };
 let running=null;
 async function run(id){
  running=id;
  try{
   const m=db.mailing(id),pending=db.waitlistPending(id);db.startMailingRun(id,pending.length);
   for(const e of pending){
    try{await mailer.send({to:e.email,...letter({subject:m.subject,text:m.body},e.token)});db.recordDelivery(id,e.email_key,now(),null);}
    catch(x){db.recordDelivery(id,e.email_key,null,String(x?.message??x).slice(0,200));}
    db.countMailing(id);if(pauseMs)await new Promise(r=>setTimeout(r,pauseMs));
   }
  }finally{db.countMailing(id);db.finishMailing(id,now());running=null;}
 }
 const start=id=>{run(id).catch(()=>{});return [202,{mailing:id,total:db.mailing(id).total}];};
 const view=m=>({id:m.id,subject:m.subject,createdAt:m.created_at,total:m.total,sent:m.sent,failed:m.failed,finishedAt:m.finished_at,running:running===m.id});
 return {
  'POST /launch/notify':async req=>{
   if(limited(req,'notify'))throw new HttpError(429,'rate-limited');
   if(!allowedOrigins.includes(req.headers.origin))throw new HttpError(403,'origin');
   const b=await body(req),email=String(b.email??'').trim();
   const bad=checkEmail(email);if(bad)throw new HttpError(400,bad);
   if(!b.website)db.addWaitlist(email,emailKey(email),now());
   return [200,{ok:true}];
  },
  'POST /launch/unsubscribe':async req=>{
   if(limited(req,'unsubscribe'))throw new HttpError(429,'rate-limited');
   let token=new URL(req.url,'http://central').searchParams.get('t');
   if(req.headers['content-type']==='application/json')token=String((await body(req)).token??'')||token;
   else for await(const _ of req){}
   if(token&&TOKEN.test(token))db.unsubscribeWaitlist(token);
   return [200,{ok:true}];
  },
  'GET /admin/waitlist':async req=>{
   staff(req,false);const entries=db.waitlist().map(e=>({email:e.email,createdAt:e.created_at}));
   return [200,{count:entries.length,entries,mail:mailer.enabled,from:mailer.from,mailings:db.mailings().map(view)}];
  },
  'POST /admin/waitlist/remove':async req=>{
   const ctx=staff(req,true),email=String((await body(req)).email??'').trim(),removed=db.removeWaitlist(emailKey(email));
   if(removed)db.audit(now(),ctx.player.uuid,'waitlist-remove','waitlist',{email:emailKey(email)});
   return [200,{removed}];
  },
  'POST /admin/waitlist/mail':async req=>{
   const ctx=staff(req,true),b=await body(req);
   if(!mailer.enabled)throw new HttpError(409,'mail-disabled');
   const m=message(b);
   if(b.test){
    const to=ctx.player.email;if(!to)throw new HttpError(400,'no-email');
    try{await mailer.send({to,...letter({subject:'[Test] '+m.subject,text:m.text},'test')});}catch{throw new HttpError(502,'mail-failed');}
    return [200,{sent:1,to}];
   }
   if(running)throw new HttpError(409,'mailing-running');
   const total=db.waitlistPending(0).length;if(!total)throw new HttpError(400,'list-empty');
   const id=db.createMailing(m.subject,m.text,now(),ctx.player.uuid,total);
   db.audit(now(),ctx.player.uuid,'waitlist-mail','waitlist',{mailing:id,subject:m.subject,total});
   return start(id);
  },
  'POST /admin/waitlist/mail/resume':async req=>{
   const ctx=staff(req,true),id=Number((await body(req)).mailing);
   if(!mailer.enabled)throw new HttpError(409,'mail-disabled');
   if(!db.mailing(id))throw new HttpError(404,'not-found');if(running)throw new HttpError(409,'mailing-running');
   db.audit(now(),ctx.player.uuid,'waitlist-mail-resume','waitlist',{mailing:id});
   return start(id);
  },
 };
}
