// Leaderboards (public) from gateway reports only. The gateway (bridge/player-stats.mjs) counts what the server's own
// messages show; POST /bridge/report carries {stats:[{subject, counts:{"kind[:sub]": n}}]}, ingested here with
// per-kind rate caps scaled by the time since that server's previous report. Playtime is the roster time between reports.
//   GET  /leaderboard/api/boards?board=&server=&period=&species=   → {board, period, server, rows:[{rank,name,profile,value}], totals}
//   GET  /leaderboard/api/players/<username>?server=&period=      → {name, joinedAt, stats}   (404 when hidden)
//   POST /account/leaderboard {hidden}                            the account's own choice to leave every board
// Boards: playtime (s), animals (species=), pvp, gather, build, craft, distance (m). Periods: all, day, week, month (UTC days).
// Hidden and suspended accounts are left out of every board and total.
export const BOARDS=Object.freeze({playtime:'playtime',animals:'animal',pvp:'pvp',gather:'gather',build:'build',craft:'craft',distance:'distance'});
export const PERIODS=Object.freeze({all:null,day:1,week:7,month:30});
// Most a player can add per second of report interval (generous for real play, small for a replayed or forged report).
export const RATE=Object.freeze({animal:1,pvp:1,death:0.5,gather:150,craft:5,build:2,distance:15});
const SUBS=new Set(['animal','gather','build']),SUB=/^[a-z0-9-]{1,40}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/,DEFAULT_GAP_MS=5e3,MAX_GAP_MS=60e3,BOARD_SIZE=50;
export const dayOf=ms=>new Date(ms).toISOString().slice(0,10);
export const sinceDay=(period,t)=>{const d=PERIODS[period];return d?dayOf(t-(d-1)*86400e3):'';};

// Report ingestion for one server: players (this report's roster), previous ({at, players}) and the raw stats list.
export function ingestStats(db,{server,players,previous,stats,t}){
 const day=dayOf(t),gapMs=Math.min(MAX_GAP_MS,Math.max(1000,previous?t-previous.at:DEFAULT_GAP_MS)),secs=gapMs/1000;
 const before=new Set(previous?.players?.map(p=>p.subject)??[]),known=new Set([...players.map(p=>p.subject),...before]);
 const rows=new Map(); // subject → [[stat,sub,n]]
 const push=(subject,stat,sub,n)=>{if(!rows.has(subject))rows.set(subject,[]);rows.get(subject).push([stat,sub,n]);};
 // Playtime: online in both reports → the time between them.
 for(const p of players)if(before.has(p.subject))push(p.subject,'playtime','',Math.round(secs));
 for(const entry of Array.isArray(stats)?stats.slice(0,1000):[]){
  if(typeof entry?.subject!=='string'||!UUID.test(entry.subject)||!known.has(entry.subject)||!entry.counts||typeof entry.counts!=='object')continue;
  const used={};
  for(const [k,raw] of Object.entries(entry.counts).slice(0,64)){
   const [stat,sub='']=k.split(':',2),n=Number(raw);
   if(!(stat in RATE)||!Number.isFinite(n)||n<=0||(SUBS.has(stat)?!SUB.test(sub):sub!==''))continue;
   const room=RATE[stat]*secs-(used[stat]??0);if(room<=0)continue;
   const take=Math.min(n,room);used[stat]=(used[stat]??0)+take;
   push(entry.subject,stat,sub,stat==='distance'?Math.round(take*10)/10:Math.floor(take));
  }
 }
 db.tx(()=>{for(const [subject,list] of rows)if(db.player(subject))db.addStats(subject,server,day,list.filter(r=>r[2]>0));});
}

export function createStatsRoutes({db,now,website,body,limited,HttpError}){
 const query=req=>new URL(req.url,'http://central').searchParams;
 const scope=q=>{
  const period=q.get('period')??'all';if(!(period in PERIODS))throw new HttpError(400,'invalid-period');
  const server=q.get('server')||null;if(server&&!(UUID.test(server)&&db.server(server)))throw new HttpError(404,'unknown-server');
  return {period,server,since:sinceDay(period,now())};
 };
 const routes={
  'GET /leaderboard/api/boards':async req=>{
   if(limited(req,'leaderboard'))throw new HttpError(429,'rate-limited');
   const q=query(req),board=q.get('board')??'playtime';if(!(board in BOARDS))throw new HttpError(400,'invalid-board');
   const {period,server,since}=scope(q),stat=BOARDS[board];
   const species=board==='animals'&&q.get('species')?q.get('species'):null;if(species&&!SUB.test(species))throw new HttpError(400,'invalid-species');
   const rows=db.statBoard({stat,sub:species,server,since,limit:BOARD_SIZE}).map((r,i)=>({rank:i+1,name:r.name,profile:r.username??null,value:stat==='distance'?Math.round(r.value):r.value}));
   const t=db.statTotals({stat,sub:species,server,since});
   return [200,{board,period,server,species,rows,totals:{players:t.players,value:Math.round(t.value)},
    ...(board==='animals'?{speciesList:db.statSubs('animal',server,since).map(s=>({id:s.sub,value:s.value}))}:{})}];
  },
  'POST /account/leaderboard':async req=>{
   const {player}=website(req,{mutation:true}),hidden=Boolean((await body(req)).hidden);
   db.setLeaderboardHidden(player.uuid,hidden);db.audit(now(),player.uuid,hidden?'leaderboard-hidden':'leaderboard-shown',player.uuid);
   return [200,{hidden}];
  },
 };
 async function profile(req,name){
  if(limited(req,'leaderboard'))throw new HttpError(429,'rate-limited');
  const p=NAME.test(name)?db.playerByUsernameKey(name.toLowerCase()):null;
  if(!p||p.leaderboard_hidden||p.status!=='active')throw new HttpError(404,'unknown-player');
  const {period,server,since}=scope(query(req)),stats={playtime:0,pvp:0,death:0,craft:0,distance:0,animal:{},gather:{},build:{}};
  for(const r of db.statsFor(p.uuid,server,since)){if(SUBS.has(r.stat))stats[r.stat][r.sub]=r.value;else if(r.stat in stats)stats[r.stat]=r.stat==='distance'?Math.round(r.value):r.value;}
  return [200,{name:p.username,joinedAt:p.created_at,period,server,stats}];
 }
 // [handler, name] for /leaderboard/api/players/<name>, or null.
 function resolve(method,pathname){
  const m=/^\/leaderboard\/api\/players\/([^/]+)$/.exec(pathname);
  if(!m||method!=='GET')return null;
  let name;try{name=decodeURIComponent(m[1]);}catch{name='';}
  return [profile,name];
 }
 return {routes,resolve};
}
