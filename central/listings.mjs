// Server listings and the site staff panel (SERVER-MANAGEMENT-PLAN.md sections 2 and 3).
//
// Owner (website): GET|POST /owner/servers/{id}/listing {description, tags, discord, website, wipe, language, agree}
// Site staff only (platform_staff; everyone else 403): GET /staff/servers, GET /staff/listings?state=,
//   POST /staff/servers/{id}/listing-review {decision: approve|reject, note}, POST /staff/servers/{id}/suspend {suspended, reason}
// With listingReview on (production) a listing waits for site staff; off (test stacks) it is approved when sent.
export const LISTING_LIMITS={description:600,tags:6,tag:24,wipe:64,language:32,note:500,url:200};
const DISCORD=/^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,32}\/?$/;
const FLAGS_WINDOW_MS=24*3600e3;

export function listingView(l){
 if(!l)return null;
 let tags=[];try{tags=JSON.parse(l.tags);}catch{}
 return {state:l.state,description:l.description,tags,discord:l.discord,website:l.website,wipe:l.wipe,language:l.language,submittedAt:l.submitted_at,reviewedAt:l.reviewed_at,note:l.note};
}
// The public server list adds the approved listing's details.
export const publicListing=l=>{const v=l&&l.state==='approved'?listingView(l):null;return v?{description:v.description,tags:v.tags,discord:v.discord,website:v.website,wipeSchedule:v.wipe,language:v.language}:{};};

export function createListingRoutes({db,now,body,website,HttpError,online,listingReview=false,relay=null}){
 const text=(v,max,{required=false}={})=>{
  if(v==null||v==='')
   {if(required)throw new HttpError(400,'invalid-listing');return null;}
  if(typeof v!=='string'||v.trim().length>max)throw new HttpError(400,'invalid-listing');
  return v.trim()||null;
 };
 const url=(v,test)=>{const s=text(v,LISTING_LIMITS.url);if(!s)return null;let u;try{u=new URL(s);}catch{throw new HttpError(400,'invalid-listing');}if(u.protocol!=='https:'||u.username||u.password||(test&&!test.test(u.href)))throw new HttpError(400,'invalid-listing');return u.href;};
 function ownServer(req,id,mutation){
  const ctx=website(req,{mutation}),s=db.server(id);
  if(!s||s.owner_uuid!==ctx.player.uuid)throw new HttpError(404,'unknown-server');
  return {...ctx,server:s};
 }
 function staff(req,mutation=false){
  const ctx=website(req,{mutation});
  if(!db.isStaff(ctx.player.uuid))throw new HttpError(403,'staff-only');
  return ctx;
 }
 const staffServer=id=>{const s=db.server(id);if(!s)throw new HttpError(404,'unknown-server');return s;};

 const routes={
  'GET /owner/servers/:id/listing':async(req,id)=>{const {server}=ownServer(req,id,false);return [200,{reviewRequired:listingReview,listing:listingView(db.listing(server.uuid))}];},
  'POST /owner/servers/:id/listing':async(req,id)=>{
   const {player,server}=ownServer(req,id,true),b=await body(req);
   if(server.status!=='active')throw new HttpError(409,'server-suspended');
   if(b.agree!==true)throw new HttpError(400,'rules-not-accepted');
   const tags=Array.isArray(b.tags)?b.tags:[];
   if(tags.length>LISTING_LIMITS.tags||tags.some(t=>typeof t!=='string'||!t.trim()||t.trim().length>LISTING_LIMITS.tag))throw new HttpError(400,'invalid-listing');
   const prev=db.listing(id);
   // A listing that is already approved stays approved when edited; anything else (re)enters the queue.
   const state=!listingReview||prev?.state==='approved'?'approved':'pending';
   db.saveListing({server:id,description:text(b.description,LISTING_LIMITS.description,{required:true}),tags:[...new Set(tags.map(t=>t.trim().toLowerCase()))],
    discord:url(b.discord,DISCORD),website:url(b.website),wipe:text(b.wipe,LISTING_LIMITS.wipe),language:text(b.language,LISTING_LIMITS.language),state,by:player.uuid},now());
   db.audit(now(),player.uuid,'server-listing-submitted',id,{state});
   let listed=Boolean(server.listed);
   if(state==='approved'&&prev?.state!=='approved'&&online(server)&&!listed){db.setListed(id,true);listed=true;}
   return [200,{state,listed}];
  },
  'GET /staff/servers':async req=>{
   staff(req);
   return [200,{reviewRequired:listingReview,servers:db.staffServers(now()-FLAGS_WINDOW_MS).map(s=>({id:s.uuid,name:s.name,region:s.region,endpoint:s.endpoint,owner:s.owner_name,ownerId:s.owner_uuid,
    status:s.status,listed:Boolean(s.listed),listing:s.listing_state??null,online:online(s),lastHeartbeat:s.last_heartbeat,players:online(s)?s.players:null,capacity:s.capacity,
    createdAt:s.created_at,steamVerified:Boolean(s.steam_verified),flags24h:s.flags,openReports:s.reports,holds:s.holds,hostApp:relay?relay.summary(s.uuid):{connected:false,lastReportAt:null}}))}];
  },
  'GET /staff/listings':async req=>{
   staff(req);const state=new URL(req.url,'http://central').searchParams.get('state');
   if(state&&!['pending','approved','rejected'].includes(state))throw new HttpError(400,'invalid-state');
   return [200,{reviewRequired:listingReview,listings:db.listingsByState(state||null).map(l=>({server:l.server_uuid,name:l.name,region:l.region,endpoint:l.endpoint,owner:l.owner_name,
    online:online(l),serverStatus:l.server_status,...listingView(l)}))}];
  },
  'POST /staff/servers/:id/listing-review':async(req,id)=>{
   const {player}=staff(req,true),b=await body(req),s=staffServer(id);
   if(!['approve','reject'].includes(b.decision))throw new HttpError(400,'invalid-decision');
   const note=text(b.note,LISTING_LIMITS.note,{required:b.decision==='reject'});
   if(!db.listing(id))throw new HttpError(404,'no-listing');
   const state=b.decision==='approve'?'approved':'rejected';
   db.tx(()=>{db.reviewListing(id,state,player.uuid,note,now());
    if(state==='rejected'&&s.listed)db.setListed(id,false);
    if(state==='approved'&&s.status==='active'&&online(s))db.setListed(id,true);
    db.audit(now(),player.uuid,'server-listing-'+state,id,note?{note}:null);});
   return [200,{state,listed:Boolean(db.server(id).listed)}];
  },
  'POST /staff/servers/:id/suspend':async(req,id)=>{
   const {player}=staff(req,true),b=await body(req);staffServer(id);
   const suspended=b.suspended===true,reason=text(b.reason,LISTING_LIMITS.note,{required:suspended});
   db.tx(()=>{db.setServerStatus(id,suspended?'suspended':'active');db.audit(now(),player.uuid,suspended?'server-suspended':'server-restored',id,reason?{reason}:null);});
   return [200,{status:suspended?'suspended':'active'}];
  },
 };
 // Publish (service.mjs) asks this first: a suspended server never lists; with review on, only an approved listing does.
 const publishRefusal=(server,listed)=>{
  if(!listed)return null;
  if(server.status!=='active')return 'server-suspended';
  if(listingReview&&db.listing(server.uuid)?.state!=='approved')return 'listing-not-approved';
  return null;
 };
 return {routes,publishRefusal};
}
