// Player history on one server (HOST-AND-LOADER-BUILD.md H5), for the host app's Players page and the website's admin
// tools: when the player was first and last seen, play time and sessions (play_sessions), the in-game names the
// gateway and the server adapter reported (player_names, recorded here from each /bridge/report), flags by kind, bans,
// kicks and in-game actions from the audit log (admins and up, like GET .../audit), reports against them, and the kinds
// of character (browser, desktop).
//   GET /admin/servers/{id}/player-history                  → {players:[…]} recent accounts and desktop handles
//   GET /admin/servers/{id}/player-history?player=<uuid>    → one account's history
//   GET /admin/servers/{id}/player-history?handle=<handle>  → one desktop character's history (not linked to an account)
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,HANDLE=/^[A-Za-z0-9_-]{16}$/;
const NAME_WRITE_MS=60e3,CACHE_MAX=20000;
const parse=s=>{try{return s?JSON.parse(s):null;}catch{return null;}};

// Names from one report. A name is written when it changes and then at most once a minute per character, so a busy
// server costs about one small upsert per player per minute (the same order as play_sessions).
export function createNameRecorder(db){
 const seen=new Map(); // server|who|kind → {name, at}
 return function record(server,{players,desktop},t){
  if(seen.size>CACHE_MAX)seen.clear();
  const rows=[];
  const add=(who,kind,name)=>{
   name=String(name??'').trim();if(!name)return;
   const k=`${server}|${who}|${kind}`,last=seen.get(k);
   if(last&&last.name===name&&t-last.at<NAME_WRITE_MS)return;
   seen.set(k,{name,at:t});rows.push([who,kind,name]);
  };
  for(const p of players)add(p.subject,'browser',p.name);
  for(const d of desktop??[])add(d.subject??'desktop:'+d.handle,'desktop',d.name);
  if(!rows.length)return;
  db.tx(()=>{for(const [who,kind,name] of rows)if(who.startsWith('desktop:')||db.player(who))db.touchName(server,who,kind,name,t);});
 };
}

export function createPlayerHistoryRoutes({db,now,staffOn,fresh,HttpError,RANK}){
 const query=req=>new URL(req.url,'http://central').searchParams;
 const names=new Map();const nameOf=u=>{if(!UUID.test(u??''))return u;if(!names.has(u))names.set(u,db.player(u)?.display_name??null);return names.get(u);};
 const banView=b=>({id:b.id,scope:b.server_uuid?'server':'global',reason:b.reason,createdBy:nameOf(b.created_by),createdAt:b.created_at,expiresAt:b.expires_at,revokedAt:b.revoked_at,active:!b.revoked_at&&(b.expires_at==null||b.expires_at>now())});
 const flagView=rows=>({total:rows.reduce((n,r)=>n+r.count,0),kinds:rows.map(r=>({kind:r.kind,count:r.count,maxSeverity:r.max_severity,lastAt:r.last_at}))});
 const nameView=r=>({name:r.name,kind:r.kind,firstSeen:r.first_seen,lastSeen:r.last_seen});
 function moderation(ctx,id,player,handle){
  if(RANK[ctx.role]<RANK.admin)return null; // the audit log is for admins and up, as GET .../audit
  return db.playerAudit(id,player,handle).map(e=>{const d=parse(e.detail)??{};return {at:e.at,action:e.action,actorName:nameOf(e.actor)??e.actor,reason:d.reason??null,
   ...(d.action?{command:d.action}:{}),...(d.minutes!==undefined?{minutes:d.minutes}:{}),...(d.scope?{scope:d.scope}:{}),...(d.via?{via:d.via}:{})};});
 }
 const reportView=r=>({id:r.id,at:r.created_at,reason:r.reason,detail:r.detail,status:r.status,reporterName:r.reporter_name,name:r.reported_name});

 function account(ctx,id,uuid){
  const p=db.player(uuid);if(!p)throw new HttpError(404,'unknown-player');
  const sessions=db.serverSessionsFor(id,uuid),list=db.namesFor(id,uuid),link=db.linksFor(id).find(l=>l.player_uuid===uuid);
  const r=fresh(id),kinds=new Set(list.map(n=>n.kind));if(link)kinds.add('desktop');
  const seen=[...sessions.flatMap(s=>[s.started_at,s.last_seen]),...list.flatMap(n=>[n.first_seen,n.last_seen])];
  return {player:{player:uuid,name:p.display_name,handle:null},
   firstSeen:seen.length?Math.min(...seen):null,lastSeen:seen.length?Math.max(...seen):null,
   sessions:sessions.length,playTimeMs:sessions.reduce((n,s)=>n+(s.last_seen-s.started_at),0),recentSessions:sessions.slice(0,10).map(s=>({startedAt:s.started_at,lastSeen:s.last_seen})),
   names:list.map(nameView),kinds:[...kinds],desktopLink:link?{linkedAt:link.created_at}:null,
   online:Boolean(r?.players.some(x=>x.subject===uuid)||r?.desktop?.some(x=>x.subject===uuid)),
   flags:flagView(db.flagKindsFor(id,uuid,null)),bans:db.playerBans(id,uuid).map(banView),moderation:moderation(ctx,id,uuid,null),
   reports:db.reportsAgainst(id,uuid,list.map(n=>n.name)).map(reportView)};
 }
 function desktop(ctx,id,handle){
  const list=db.namesFor(id,'desktop:'+handle),r=fresh(id);
  if(!list.length&&!db.desktopFlagsFor(id,handle,1).length)throw new HttpError(404,'unknown-player');
  return {player:{player:null,name:list[0]?.name??db.desktopFlagsFor(id,handle,1)[0]?.name??handle,handle},
   firstSeen:list.length?Math.min(...list.map(n=>n.first_seen)):null,lastSeen:list.length?Math.max(...list.map(n=>n.last_seen)):null,
   sessions:null,playTimeMs:null,recentSessions:[],names:list.map(nameView),kinds:['desktop'],desktopLink:null,
   online:Boolean(r?.desktop?.some(x=>x.handle===handle)),
   flags:flagView(db.flagKindsFor(id,null,handle)),bans:[],moderation:moderation(ctx,id,null,handle),
   reports:list.length?db.reportsAgainst(id,null,list.map(n=>n.name)).map(reportView):[]};
 }
 function recent(id){
  const flags=new Map(db.flagCountsByPlayer(id).map(r=>[r.player_uuid,r.n])),r=fresh(id);
  const online=new Set([...(r?.players??[]).map(p=>p.subject),...(r?.desktop??[]).map(p=>p.subject??p.handle)]);
  const out=[...db.serverPlayerTotals(id,500).map(a=>({player:a.player_uuid,handle:null,name:a.display_name,firstSeen:a.first_seen,lastSeen:a.last_seen,sessions:a.sessions,playTimeMs:a.play_ms,flags:flags.get(a.player_uuid)??0,online:online.has(a.player_uuid)})),
   ...db.desktopHandlesSeen(id,200).map(d=>({player:null,handle:d.handle,name:d.name,firstSeen:d.first_seen,lastSeen:d.last_seen,sessions:null,playTimeMs:null,flags:null,online:online.has(d.handle)}))];
  return out.sort((a,b)=>b.lastSeen-a.lastSeen).slice(0,500);
 }
 return {
  'GET /admin/servers/:id/player-history':async(req,id)=>{
   const ctx=staffOn(req,id),q=query(req),player=q.get('player'),handle=q.get('handle');
   if(player!==null){if(!UUID.test(player))throw new HttpError(400,'invalid-player');return [200,{...account(ctx,id,player),role:ctx.role}];}
   if(handle!==null){if(!HANDLE.test(handle))throw new HttpError(400,'invalid-handle');return [200,{...desktop(ctx,id,handle),role:ctx.role}];}
   return [200,{players:recent(id),role:ctx.role}];
  },
 };
}
