// Admin screenshots (owner request, RustBuster-style; ANTICHEAT-ADMIN-PLAN.md "Screenshots"). Staff of a server ask
// for one on the admin page; gateway anti-cheat flags at or above the server's severity ask automatically. Central →
// gateway (in the /bridge/report reply) → the player's page, which captures its next rendered frame with the HUD drawn
// over it (browser/admin-capture.mjs) → gateway, which adds its own view of the player → POST /bridge/screenshot.
// The player sees no prompt. Requests, views and deletions are audited; images expire after the retention period.
// Evidence, not proof: the page is code the player controls. The checks below make a fake cost more: an unannounced
// one-use id and a deadline, position/yaw compared with the gateway's own view, duplicate and blank-frame detection.
import {randomUUID,createHash} from 'node:crypto';

export const LIMITS=Object.freeze({maxBytes:400_000,maxSide:1920,minSide:64,queuedMs:2*60e3,resultMs:60e3,manualGapMs:30e3,autoGapMs:10*60e3,autoPerDay:200,actorPerHour:30,perReport:5});
const UPLOAD_BODY=Math.ceil(LIMITS.maxBytes*4/3)+16*1024,MAINTAIN_MS=10*60e3,VIEW_AUDIT_MS=10*60e3;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASON=/^[a-z][a-z-]{0,39}$/;

// Width and height from a baseline or progressive JPEG's frame header; null when it is not a complete JPEG.
export function jpegInfo(buf){
 if(!Buffer.isBuffer(buf)||buf.length<4||buf[0]!==0xff||buf[1]!==0xd8||buf[buf.length-2]!==0xff||buf[buf.length-1]!==0xd9)return null;
 let i=2;
 while(i+9<buf.length){
  if(buf[i]!==0xff){i++;continue;}
  const m=buf[i+1];if(m===0xff){i++;continue;}
  if(m===0xd8||m===0x01||(m>=0xd0&&m<=0xd7)){i+=2;continue;}
  const len=buf.readUInt16BE(i+2);if(len<2)return null;
  if(m>=0xc0&&m<=0xcf&&m!==0xc4&&m!==0xc8&&m!==0xcc)return {height:buf.readUInt16BE(i+5),width:buf.readUInt16BE(i+7)};
  i+=2+len;
 }
 return null;
}
const num=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max?Math.round(v*100)/100:null;
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<1e6)?v.map(x=>Math.round(x*100)/100):null;
const pose=p=>p&&typeof p==='object'?{pos:vec(p.pos??p.feet),yaw:num(p.yaw,-720,720)}:null;
const wrap180=d=>((d%360)+540)%360-180;
// Only known fields from the page and the gateway are kept (both are outside central's control).
export function cleanMeta(page={},gateway={}){
 const p=page&&typeof page==='object'?page:{},g=gateway&&typeof gateway==='object'?gateway:{};
 return {
  page:{quality:num(p.quality,0,1),capturedAt:num(p.capturedAt,0,1e14),frameAgeMs:num(p.frameAgeMs,0,60e3),overlays:num(p.overlays,0,1e5),
   viewport:p.viewport&&typeof p.viewport==='object'?{w:num(p.viewport.w,0,20000),h:num(p.viewport.h,0,20000),dpr:num(p.viewport.dpr,0,16)}:null,
   hidden:typeof p.hidden==='boolean'?p.hidden:null,focused:typeof p.focused==='boolean'?p.focused:null,
   luma:p.luma&&typeof p.luma==='object'?{mean:num(p.luma.mean,0,255),sd:num(p.luma.sd,0,255)}:null,camera:pose(p.camera)},
  gateway:{latencyMs:num(g.latencyMs,0,600e3),request:pose(g.request),reply:pose(g.reply)},
 };
}
// Cross-checks shown next to the image: how far the page's camera was from where the gateway saw the player.
export function screenshotChecks(meta,{duplicateOf=null}={}){
 const cam=meta.page.camera,views=[meta.gateway.request,meta.gateway.reply].filter(v=>v?.pos);
 const positionDelta=cam?.pos&&views.length?Math.min(...views.map(v=>Math.hypot(...v.pos.map((x,i)=>x-cam.pos[i])))):null;
 const yaws=views.filter(v=>v.yaw!=null);
 const yawDelta=cam?.yaw!=null&&yaws.length?Math.min(...yaws.map(v=>Math.abs(wrap180(v.yaw-cam.yaw)))):null;
 return {positionDelta:positionDelta==null?null:Math.round(positionDelta*10)/10,yawDelta:yawDelta==null?null:Math.round(yawDelta),
  latencyMs:meta.gateway.latencyMs,blank:meta.page.luma?meta.page.luma.sd<3:null,hidden:meta.page.hidden,duplicateOf};
}

export function createScreenshotRoutes({db,now,body,bridge,HttpError,staffOn,target,fresh,retentionMs=30*86400e3}){
 const actorHits=new Map(),viewed=new Map();let maintainedAt=-Infinity;
 const view=s=>{const meta=s.meta?JSON.parse(s.meta):null;
  return {id:s.id,player:s.player_uuid,name:s.player_name,trigger:s.trigger,flagKind:s.flag_kind,requestedBy:s.requested_by==='anticheat'?'anti-cheat':s.requester_name??s.requested_by,
   status:s.status,reason:s.reason,createdAt:s.created_at,doneAt:s.done_at,expiresAt:s.expires_at,bytes:s.bytes,width:s.width,height:s.height,checks:meta?.checks??null,image:s.status==='done'?`/admin/screenshots/${s.id}/image`:null};};
 function maintain(t){
  if(t-maintainedAt<MAINTAIN_MS)return;maintainedAt=t;
  for(const r of db.expireScreenshots(t))db.audit(t,'retention','screenshots-expired',r.server_uuid,{count:r.n,retentionDays:Math.round(retentionMs/86400e3)});
  db.pruneFailedScreenshots(t-retentionMs);
 }
 function create({server,player,trigger,by,flag=null,flagKind=null}){
  const id=randomUUID();db.addScreenshot({id,server,player,trigger,flag,flagKind,by,at:now()});return id;
 }
 const api={
  maintain,
  // Gateway flag at or above the server's auto severity: one screenshot per player per 10 minutes, capped per day.
  auto(server,player,flag){
   const threshold=db.policy(server).screenshot_auto_severity,t=now();
   if(!(threshold>0)||flag.severity<threshold||db.pendingScreenshot(server,player))return null;
   const last=db.lastScreenshot(server,player,'auto');if(last&&t-last.created_at<LIMITS.autoGapMs)return null;
   if(db.countScreenshots(server,'auto',t-86400e3)>=LIMITS.autoPerDay)return null;
   const id=create({server,player,trigger:'auto',by:'anticheat',flag:flag.id,flagKind:flag.kind});
   db.audit(t,'anticheat','anticheat.screenshot-request',server,{player,screenshot:id,flag:flag.kind,severity:flag.severity});
   return id;
  },
  // Requests for players in this report's roster go out with the reply; stale ones fail (expired / no-result).
  dispatch(server,players){
   const t=now(),online=new Set(players.map(p=>p.subject)),out=[];
   db.failStaleScreenshots(server,t-LIMITS.queuedMs,t-LIMITS.resultMs,t);
   for(const s of db.queuedScreenshots(server)){if(out.length>=LIMITS.perReport)break;if(online.has(s.player_uuid)&&db.setScreenshotSent(s.id,t))out.push({id:s.id,subject:s.player_uuid});}
   return out;
  },
 };
 api.routes={
  'POST /admin/servers/:id/screenshot':async(req,id)=>{
   const ctx=staffOn(req,id,{mutation:true}),b=await body(req),player=target(ctx,b.player),t=now();
   if(!fresh(id)?.players.some(p=>p.subject===player))throw new HttpError(409,'player-offline');
   if(db.pendingScreenshot(id,player))throw new HttpError(409,'screenshot-pending');
   const last=db.lastScreenshot(id,player,'manual');if(last&&t-last.created_at<LIMITS.manualGapMs)throw new HttpError(429,'screenshot-too-soon');
   const hits=(actorHits.get(ctx.player.uuid)??[]).filter(x=>t-x<3600e3);if(hits.length>=LIMITS.actorPerHour)throw new HttpError(429,'rate-limited');
   hits.push(t);actorHits.set(ctx.player.uuid,hits);
   const shot=db.tx(()=>{const s=create({server:id,player,trigger:'manual',by:ctx.player.uuid});db.audit(t,ctx.player.uuid,'admin.screenshot-request',id,{player,screenshot:s});return s;});
   return [202,{screenshot:shot}];
  },
  'GET /admin/servers/:id/screenshots':async(req,id)=>{
   staffOn(req,id);maintain(now());const player=new URL(req.url,'http://central').searchParams.get('player');
   if(player!==null&&!UUID.test(player))throw new HttpError(400,'invalid-player');
   return [200,{retentionDays:Math.round(retentionMs/86400e3),screenshots:db.screenshotsFor(id,player,100).map(view)}];
  },
  // The image itself: same-origin <img> on the admin page; every viewer is audited (once per 10 minutes each).
  'GET /admin/screenshots/:id/image':async(req,id)=>{
   const s=db.screenshot(id);if(!s)throw new HttpError(404,'unknown-screenshot');
   const ctx=staffOn(req,s.server_uuid),image=db.screenshotImage(id);if(!image)throw new HttpError(404,'unknown-screenshot');
   const t=now(),key=ctx.player.uuid+':'+id;
   if(!(t-(viewed.get(key)??-Infinity)<VIEW_AUDIT_MS)){viewed.set(key,t);db.audit(t,ctx.player.uuid,'admin.screenshot-view',s.server_uuid,{player:s.player_uuid,screenshot:id});
    if(viewed.size>10000)for(const [k,v] of viewed)if(t-v>=VIEW_AUDIT_MS)viewed.delete(k);}
   return [200,Buffer.from(image),{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'",'Content-Disposition':`inline; filename="screenshot-${id}.jpg"`,'Referrer-Policy':'no-referrer'}];
  },
  'POST /admin/screenshots/:id/delete':async(req,id)=>{
   const s=db.screenshot(id);if(!s)throw new HttpError(404,'unknown-screenshot');
   const ctx=staffOn(req,s.server_uuid,{mutation:true,min:'admin'});
   db.tx(()=>{db.deleteScreenshot(id);db.audit(now(),ctx.player.uuid,'admin.screenshot-delete',s.server_uuid,{player:s.player_uuid,screenshot:id});});
   return [200,{deleted:true}];
  },
  // Gateway upload: {id, ok, reason?, image (base64 JPEG), meta (page), gateway}. Only a request this server was sent,
  // within its deadline, and only once.
  'POST /bridge/screenshot':async req=>{
   const server=bridge(req),b=await body(req,UPLOAD_BODY),t=now();
   const s=typeof b.id==='string'&&UUID.test(b.id)?db.screenshot(b.id):null;
   if(!s||s.server_uuid!==server)throw new HttpError(404,'unknown-screenshot');
   if(s.status!=='sent')throw new HttpError(409,'not-pending');
   if(t-s.sent_at>LIMITS.resultMs){db.failScreenshot(s.id,'late',t);throw new HttpError(409,'late');}
   if(b.ok!==true){db.failScreenshot(s.id,REASON.test(b.reason??'')?b.reason:'failed',t);return [200,{stored:false}];}
   const image=typeof b.image==='string'&&b.image.length<=UPLOAD_BODY?Buffer.from(b.image,'base64'):null,info=image&&image.length<=LIMITS.maxBytes?jpegInfo(image):null;
   if(!info||info.width>LIMITS.maxSide||info.height>LIMITS.maxSide||info.width<LIMITS.minSide||info.height<LIMITS.minSide){db.failScreenshot(s.id,'invalid-image',t);throw new HttpError(400,'invalid-image');}
   const sha256=createHash('sha256').update(image).digest('hex'),meta=cleanMeta(b.meta,b.gateway);
   meta.checks=screenshotChecks(meta,{duplicateOf:db.screenshotBySha(s.player_uuid,sha256,s.id)?.id??null});
   db.storeScreenshot(s.id,{image,width:info.width,height:info.height,sha256,meta,expires:t+retentionMs},t);
   return [200,{stored:true}];
  },
 };
 return api;
}
