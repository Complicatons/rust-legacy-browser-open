// Remote control through the website (SERVER-MANAGEMENT-PLAN.md section 1). The owner's host app listens on loopback
// only, so it calls out: every couple of seconds it reports its status and new log lines with its host app key and
// picks up the commands queued here. Everything lives in memory (logs can hold player names and addresses); a central
// restart empties it and the next report fills it again.
//
// Host app (Authorization: Bearer rlbh_…): POST /host-relay/report {status, backups?, control, logs:[{seq,source,stream,
//   text,at,level}], results:[{id, ok, error?}]} → {commands:[{id, op, target?, name?, label?}], nextInMs}
// Website (server owner or site staff): GET /owner/servers/{id}/console?since=n, POST /owner/servers/{id}/console-command
//   {op, target | name | label | minutes}; restart-in {minutes} and restart-cancel reach the host app's schedule
//   (host/schedule.mjs: a game server restart with in-game warnings). The report's status.schedule.lastWipe.at becomes
//   the server's public last wipe date; status.launcherOnly becomes the public "login type" on the server list
//   (OFFSHOOT-COMPATIBILITY-PLAN.md work item 7, "server profiles") so a player sees it before trying to join.
import {randomUUID} from 'node:crypto';

export const OPS=new Set(['start','stop','restart','backup-keep','backup-restore','restart-in','restart-cancel']);
export const RELAY={keepLines:2000,pageLines:500,maxLinesPerReport:1000,maxText:2000,onlineMs:10e3,commandTtlMs:60e3,keepCommands:30,reportEveryMs:2000};
const MAX_REPORT=2*1024*1024;
const str=(v,max)=>typeof v==='string'?v.slice(0,max):'';

export function createHostRelayRoutes({db,now,body,website,HttpError,hashKey}){
 const hosts=new Map(); // server → {at, status, backups, control, lines:[], n, commands:[]}
 const entry=id=>{let h=hosts.get(id);if(!h){h={at:0,status:null,backups:null,control:false,lines:[],n:0,commands:[]};hosts.set(id,h);}return h;};
 const connected=h=>Boolean(h&&h.at&&now()-h.at<=RELAY.onlineMs);
 const expire=h=>{for(const c of h.commands)if(c.state==='queued'&&now()-c.at>RELAY.commandTtlMs){c.state='expired';c.updatedAt=now();}};

 function hostServer(req){
  const m=/^Bearer (rlbh_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'');
  const id=m&&db.hostTokenServer(hashKey(m[1]),now());
  if(!id)throw new HttpError(401,'host-unauthenticated');
  return id;
 }
 // The server owner and site staff only: power control and logs are not for the server's admins and moderators.
 // Unknown servers and other people's servers look the same (no enumeration).
 function ownerOf(req,id,mutation){
  const {player}=website(req,{mutation}),s=db.server(id);
  if(!s||(s.owner_uuid!==player.uuid&&!db.isStaff(player.uuid)))throw new HttpError(404,'unknown-server');
  return {player,server:s,staff:s.owner_uuid!==player.uuid};
 }

 const routes={
  'POST /host-relay/report':async req=>{
   const id=hostServer(req),b=await body(req,MAX_REPORT),h=entry(id);
   const logs=Array.isArray(b.logs)?b.logs:[];
   if(logs.length>RELAY.maxLinesPerReport)throw new HttpError(413,'too-many-lines');
   h.at=now();if(typeof b.control==='boolean')h.control=b.control;
   if(b.status&&typeof b.status==='object')h.status=b.status;
   if(b.backups&&typeof b.backups==='object')h.backups=b.backups;
   const wiped=b.status?.schedule?.lastWipe?.at;
   if(Number.isSafeInteger(wiped)&&wiped>0&&wiped<=now()+86400e3&&wiped!==h.lastWipeAt){db.setLastWipe(id,wiped);h.lastWipeAt=wiped;}
   if(typeof b.status?.launcherOnly==='boolean'&&b.status.launcherOnly!==h.launcherOnly){db.setLauncherOnly(id,b.status.launcherOnly);h.launcherOnly=b.status.launcherOnly;}
   for(const l of logs){
    if(!l||typeof l!=='object')continue;
    h.lines.push({n:++h.n,source:str(l.source,32),stream:str(l.stream,16),level:str(l.level,16),at:Number.isFinite(l.at)?l.at:h.at,text:str(l.text,RELAY.maxText)});
   }
   if(h.lines.length>RELAY.keepLines)h.lines.splice(0,h.lines.length-RELAY.keepLines);
   for(const r of Array.isArray(b.results)?b.results:[]){
    const c=h.commands.find(x=>x.id===r?.id&&x.state==='sent');
    if(c){c.state=r.ok?'done':'failed';c.error=r.ok?null:str(r.error,300)||'failed';c.updatedAt=now();}
   }
   expire(h);
   const out=h.commands.filter(c=>c.state==='queued');
   for(const c of out){c.state='sent';c.updatedAt=now();}
   return [200,{commands:out.map(c=>({id:c.id,op:c.op,by:c.byName,...(c.target?{target:c.target}:{}),...(c.name?{name:c.name}:{}),...(c.label?{label:c.label}:{}),...(c.minutes!=null?{minutes:c.minutes}:{})})),nextInMs:RELAY.reportEveryMs}];
  },
  'GET /owner/servers/:id/console':async(req,id)=>{
   ownerOf(req,id,false);
   const h=hosts.get(id),since=Number(new URL(req.url,'http://central').searchParams.get('since'))||0;
   if(h)expire(h);
   const logs=h?h.lines.filter(l=>l.n>since).slice(0,RELAY.pageLines):[];
   return [200,{connected:connected(h),lastReportAt:h?.at||null,control:Boolean(h?.control),status:h?.status??null,backups:h?.backups??null,
    seq:h?.n??0,logs,commands:(h?.commands??[]).slice(-RELAY.keepCommands).reverse().map(c=>({id:c.id,op:c.op,target:c.target??null,name:c.name??null,label:c.label??null,minutes:c.minutes??null,state:c.state,error:c.error??null,at:c.at,by:c.byName}))}];
  },
  'POST /owner/servers/:id/console-command':async(req,id)=>{
   const ctx=ownerOf(req,id,true),b=await body(req),h=hosts.get(id);
   if(!OPS.has(b.op))throw new HttpError(400,'unknown-command');
   const cmd={id:randomUUID(),op:b.op,at:now(),updatedAt:now(),state:'queued',by:ctx.player.uuid,byName:ctx.player.display_name};
   if(['start','stop','restart'].includes(b.op)){
    const names=(h?.status?.components??[]).map(c=>c.name);
    if(typeof b.target!=='string'||!(b.target==='all'||names.includes(b.target)))throw new HttpError(400,'unknown-component');
    cmd.target=b.target;
   }else if(b.op==='restart-in'){
    if(!Number.isInteger(b.minutes)||b.minutes<0||b.minutes>180)throw new HttpError(400,'minutes-0-to-180');
    cmd.minutes=b.minutes;
   }else if(b.op==='restart-cancel'){
   }else if(b.op==='backup-restore'){
    if(typeof b.name!=='string'||!/^[\w.@-]{1,120}$/.test(b.name))throw new HttpError(400,'backup-name-required');
    cmd.name=b.name;
   }else cmd.label=str(b.label,60).trim()||null;
   if(!connected(h))throw new HttpError(409,'host-offline');
   if(!h.control)throw new HttpError(409,'control-off');
   h.commands.push(cmd);if(h.commands.length>RELAY.keepCommands*2)h.commands.splice(0,h.commands.length-RELAY.keepCommands*2);
   db.audit(now(),ctx.player.uuid,'host-command',id,{op:cmd.op,target:cmd.target??cmd.name??cmd.label??cmd.minutes??null,...(ctx.staff?{as:'site-staff'}:{})});
   return [202,{id:cmd.id}];
  },
 };
 // For the site staff panel: whether a server's host app is reporting, and when it last did.
 const summary=id=>{const h=hosts.get(id);return {connected:connected(h),lastReportAt:h?.at||null,control:Boolean(h?.control)};};
 return {routes,summary};
}
