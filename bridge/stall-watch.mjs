// Server-wide correction bursts (SERVER-TESTING-PLAN.md section 12: at 13:04 UTC on 2026-10-22 every bot was
// corrected and replies stalled for seconds while server and gateway CPU stayed at 3-4 %).
// The original server sends a player's own position back to it (HumanController.GetClientMove -> ReadClientMove to the
// sender; values[3] = how old that move's stamp was, in s) when NetCull.VerifyRPC drops a move stamped more than
// packet.dropms (800 ms) plus one network frame behind its clock, and RS (a clock resync) on every second late move
// (packet.dropclockthresh 2). GameBridge.moveStamp keeps the browser's own spacing, so a move is late once the
// browser -> server delay has grown by about a second over that session's best. When many sessions are corrected
// within one second, one log line says where the delay was: the server's age of the dropped moves, the longest silence
// in each session's browser traffic (test PC or internet path), in its server traffic (server stalled), this gateway's
// own event-loop lag (gateway or whole VM paused), and the server RPCs just before.
export const BURST_WINDOW_MS=1000,BURST_MIN_SESSIONS=3,BURST_SHARE=0.25,BURST_COOLDOWN_MS=10000,LOOK_BACK_MS=10000;
// Silences and loop lag shorter than these are normal traffic (moves every 100-200 ms; a 10 ms tick).
export const GAP_MS=500,LAG_MS=100;
const RECENT=64;

const pct=(v,p)=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.max(0,Math.ceil(p/100*s.length)-1))];};
const round=v=>v==null?'-':Math.round(v);

export class StallWatch{
 // now: ms (monotonic); wallNow: ms since 1970 (log times); inGame(): in-game sessions now.
 constructor({now=()=>performance.now(),wallNow=Date.now,log=()=>{},inGame=()=>0}={}){
  Object.assign(this,{now,wallNow,log,inGame});
  this.sessions=new Map();this.corrections=[];this.resyncs=[];this.gaps=[];this.lags=[];this.recent=[];this.lastBurst=-Infinity;
  this.metrics={corrections:0,resyncs:0,bursts:0,loopLagMaxMs:0};
 }
 // Time-ordered lists keep only the last LOOK_BACK_MS (recent server RPCs also at most RECENT entries).
 add(list,x){const a=this[list];a.push(x);while(a.length&&(x.t-a[0].t>LOOK_BACK_MS||(list==='recent'&&a.length>RECENT)))a.shift();}
 within(list,t,ms=LOOK_BACK_MS){return this[list].filter(x=>t-x.t<=ms);}
 // A message from the browser / a datagram from the server for session `id`.
 browser(id){this.traffic(id,'browser');}
 native(id){this.traffic(id,'native');}
 traffic(id,side){
  const t=this.now();let s=this.sessions.get(id);if(!s)this.sessions.set(id,s={browser:null,native:null});
  if(s[side]!=null&&t-s[side]>=GAP_MS)this.add('gaps',{t,id,side,ms:t-s[side]});
  s[side]=t;
 }
 // A server RPC (or create/destroy) that reached a session: kept by name for "what came just before".
 rpc(name){if(name&&name!=='ReadClientMove')this.add('recent',{t:this.now(),name});}
 // ServerManagement.RS for session `id` (NetCull.VerifyRPC: every second late move).
 resync(id){this.metrics.resyncs++;this.add('resyncs',{t:this.now(),id});}
 // How late the gateway's 10 ms tick fired, in ms.
 loop(lagMs){if(lagMs>this.metrics.loopLagMaxMs)this.metrics.loopLagMaxMs=Math.round(lagMs);if(lagMs>=LAG_MS)this.add('lags',{t:this.now(),ms:lagMs});}
 // Longest tick lag of at least LAG_MS in the last LOOK_BACK_MS (0 if none): the gateway /metrics gauge.
 recentLagMs(){return Math.round(Math.max(0,...this.within('lags',this.now()).map(x=>x.ms)));}
 end(id){this.sessions.delete(id);}
 // ReadClientMove on session `id`'s own character. lateS: values[3]; serverMs: the message's server timestamp.
 // Logs and returns the burst line when this correction completes one, else null.
 correction(id,{lateS,serverMs}={}){
  const t=this.now();this.metrics.corrections++;
  this.add('corrections',{t,id,lateMs:Number.isFinite(lateS)?lateS*1000:null,serverMs:Number.isFinite(serverMs)?serverMs:null});
  const hit=this.within('corrections',t,BURST_WINDOW_MS),ids=new Set(hit.map(c=>c.id)),inGame=Math.max(this.inGame(),ids.size);
  if(ids.size<Math.max(BURST_MIN_SESSIONS,Math.ceil(BURST_SHARE*inGame))||t-this.lastBurst<BURST_COOLDOWN_MS)return null;
  this.lastBurst=t;this.metrics.bursts++;
  const line=this.describe(t,hit,ids.size,inGame);this.log('correction-burst',line);return line;
 }
 describe(t,hit,corrected,inGame){
  const late=hit.map(c=>c.lateMs).filter(Number.isFinite),server=hit.map(c=>c.serverMs).filter(Number.isFinite);
  // Longest silence per side in the last LOOK_BACK_MS, ended or still open, and how many sessions had one >= 1 s.
  const side=k=>{
   const g=this.within('gaps',t).filter(x=>x.side===k).map(x=>({id:x.id,ms:x.ms}));
   for(const [id,s] of this.sessions)if(s[k]!=null&&t-s[k]>=GAP_MS)g.push({id,ms:t-s[k]});
   return `${k}GapMs=${round(g.length?Math.max(...g.map(x=>x.ms)):null)} ${k}GapSessions=${new Set(g.filter(x=>x.ms>=BURST_WINDOW_MS).map(x=>x.id)).size}`;
  };
  // Most recent first, one entry per name: name×count@-ms.
  const names=new Map(),recent=this.within('recent',t);
  for(let i=recent.length-1;i>=0;i--){const r=recent[i],n=names.get(r.name);if(n)n.count++;else names.set(r.name,{count:1,ago:t-r.t});}
  const before=[...names].slice(0,10).map(([name,n])=>`${name}×${n.count}@-${round(n.ago)}`).join(',');
  return [`sessions=${corrected}/${inGame}`,`utc=${new Date(this.wallNow()).toISOString()}`,`serverMs=${server.length?Math.max(...server):'-'}`,
   `lateMs p50=${round(pct(late,50))} max=${round(pct(late,100))}`,`resyncs10s=${this.within('resyncs',t).length}`,side('browser'),side('native'),
   `loopLagMs=${this.recentLagMs()}`,`before=[${before}]`].join(' ');
 }
}
