// P7 "cheat" helper for the native matrix (SERVER-TESTING-PLAN.md P7, tools/native/anticheat-rows.mjs): makes the TEST
// page misbehave the way a modified browser would, and reads back what the gateway's anti-cheat (bridge/anticheat.mjs)
// made of it through the website admin evidence API (GET /admin/servers/{id}/flags?player=, ANTICHEAT-ADMIN-PLAN.md).
// Harness only: the page side (cheatEngine) is evaluated into the test page by Playwright after the join and drives the
// page through its existing dev hooks (explorerDev.teleport/airdropGround, explorerState) and the harness's own socket
// wrapper (driver.mjs netShaper, window.__rlbNetShape). Nothing here is part of the game build players load.
// Positions: browser space (Unity x, y, -z) unless named Unity; forged gateway commands are Unity space like the page's.
import {Quaternion,Euler} from 'three';

export const EYE_HEIGHT=1.6476; // player.json eyes.m_LocalPosition.y (bridge/anticheat.mjs eyeHeights[0])
export const toUnity=([x,y,z])=>[x,y,-z];
export const toBrowser=([x,y,z])=>[x,y,-z];
export const eyeOf=feet=>[feet[0],feet[1]+EYE_HEIGHT,feet[2]];
const round=(v,n=2)=>v==null||!Number.isFinite(v)?v:+Number(v).toFixed(n);
export const round3=p=>Array.isArray(p)?p.map(v=>round(v)):p;
export const distXZ=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);

// ---- headings ------------------------------------------------------------------------------------------------------
// Unity yaw (degrees, 0 = +z, 90 = +x; the angles the page sends) <-> horizontal direction.
export const unityForward=yaw=>{const r=yaw*Math.PI/180;return [Math.sin(r),0,Math.cos(r)];};
export const browserForward=yaw=>{const [x,,z]=unityForward(yaw);return [x,0,-z];};
// A point `d` metres from `p` along Unity yaw, in the same space as p (browser when browser=true).
export function along(p,yaw,d,{browser=true}={}){const f=browser?browserForward(yaw):unityForward(yaw);return [p[0]+f[0]*d,p[1],p[2]+f[2]*d];}
export const wrap180=d=>((d%360)+540)%360-180;
// Unity yaw from a browser-space camera direction (explorerDev.aim().dir): browser yaw atan2(-x,-z), Unity = -browser.
export const unityYawOfBrowserDir=d=>-Math.atan2(-d[0],-d[2])*180/Math.PI;
// Unity look rotation from `from` to `to` (Unity points) as [x, y, z, w]: Quaternion.Euler(pitch, yaw, 0) with pitch
// positive looking down, the rotation ArrowMovement flies along (bridge/anticheat.mjs arrowPath).
export function lookRotation(from,to){
 const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],yaw=Math.atan2(dx,dz),pitch=-Math.atan2(dy,Math.hypot(dx,dz));
 const q=new Quaternion().setFromEuler(new Euler(pitch,yaw,0,'YXZ'));return [q.x,q.y,q.z,q.w];
}
// Does a segment (browser space), lifted by `lift`, stay above the terrain `ground(x, z)` (browser x, z)? TruthDetector
// traces old + 0.5 m up to new, terrain included: a cheat path that dips into a hill would add a noclip flag and a
// server rollback to the row, so the rows only push along clear lines.
export function lineClear(ground,a,b,{lift=0.5,step=1,clearance=0.05}={}){
 const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])/step));
 for(let i=0;i<=n;i++){const k=i/n,x=a[0]+(b[0]-a[0])*k,y=a[1]+(b[1]-a[1])*k+lift,z=a[2]+(b[2]-a[2])*k,g=ground(x,z);if(Number.isFinite(g)&&y<g+clearance)return false;}
 return true;
}
// Steepest terrain climb along a ground path (degrees), sampled every `step` m: a push stays on walkable ground.
export function pathSlope(ground,a,b,{step=2}={}){
 const L=distXZ(a,b),n=Math.max(1,Math.ceil(L/step));let prev=ground(a[0],a[2]),max=0;
 for(let i=1;i<=n;i++){const x=a[0]+(b[0]-a[0])*i/n,z=a[2]+(b[2]-a[2])*i/n,g=ground(x,z);if(Number.isFinite(g)&&Number.isFinite(prev))max=Math.max(max,Math.atan2(Math.abs(g-prev),L/n)*180/Math.PI);prev=g;}
 return round(max,1);
}
// Picks the heading for a cheat: candidates [{yaw, ray}] where ray is the page's eye-level camera ray distance to the first
// collider (null = nothing within its range); the first one clear for `need` metres whose ground line (when `ground`)
// stays climbable and above the water line. `line` (metres): also a straight jump that far must clear the terrain
// (lineClear). Returns {yaw, ray, slope} or null.
export function pickHeading(candidates,{from=null,ground=null,need=10,maxSlope=35,waterLine=-Infinity,line=0}={}){
 for(const c of candidates){
  if(c.ray!=null&&c.ray<need)continue;
  if(ground&&from){const to=along(from,c.yaw,need);const g=ground(to[0],to[2]);if(Number.isFinite(g)&&g<waterLine+0.5)continue;
   const slope=pathSlope(ground,from,to);if(slope>maxSlope)continue;
   if(line>0){const j=along(from,c.yaw,line),gj=ground(j[0],j[2]);if(Number.isFinite(gj))j[1]=gj;if(!lineClear(ground,from,j))continue;}
   return {...c,slope};}
  return {...c,slope:null};
 }
 return null;
}

// ---- forged gateway commands (rlb-gateway.v1, what browser/net-client.mjs sends) -----------------------------------
// A copy of the page's last move with another origin (and optionally yaw): the gateway sees one more move frame.
export function forgedMove(last,{origin,yaw=null,dtMs=50}={}){
 return {type:'move',origin:origin.map(v=>+v.toFixed(3)),angles:{yaw:yaw??last?.angles?.yaw??0,pitch:last?.angles?.pitch??0},stateFlags:last?.stateFlags??0,at:Number.isFinite(last?.at)?last.at+dtMs:Math.round(dtMs)};
}
// NetEntityID of an NGC entity (bridge/game-bridge.mjs entityId): {p1: the carrier's network group, p2: innerID}.
export const ngcTarget=(entity,group)=>({p1:group,p2:entity.innerID});
export const contextTarget=entity=>({carrier:entity.carrier,innerID:entity.innerID});
export const meleeHit=(rep,{target=null,point,flag=false})=>({type:'item',viewId:rep,action:'melee-hit',data:target?{target,point,flag}:{point,flag}});
// One bullet record per hit; an NGC hit point is local to the entity (BulletWeaponDataBlock.ReadHitInfo TransformPoint).
export const bulletFire=(rep,hits)=>({type:'item',viewId:rep,action:'bullet-fire',data:{hits:hits.map(h=>h.target?{target:h.target,bodyPart:h.bodyPart??254,point:h.point}:{point:h.point})}});
export const bowFire=(rep,origin,rotation)=>({type:'item',viewId:rep,action:'bow-fire',data:{origin,rotation}});
export const bowHit=(rep,target,position)=>({type:'item',viewId:rep,action:'bow-hit',data:{target,position}});
export const contextQuery=target=>({type:'context',action:'query',target});
export const contextCancel=()=>({type:'context',action:'cancel'});

// ---- what came back -------------------------------------------------------------------------------------------------
// The gateway's replies to dropped commands (bridge/gateway-service.mjs: {type:'command-rejected', reason}).
export const rejections=(frames,t)=>frames.rx(t,f=>f.type==='command-rejected').map(f=>f.reason??null);
// The original server's reaction since t: TruthDetector rollbacks (ReadClientMove to the owner), teleports (UnstickMove),
// KP kick reasons and gateway kicks/disconnects. `open`: the session is still connected.
export function serverReaction(frames,t,{open=true}={}){
 const c=frames.corrections(t),kp=frames.rx(t,f=>f.type==='rpc'&&f.name==='KP').map(f=>f.values?.[0]??null);
 return {corrections:c.length,rollbacks:c.filter(x=>x.name==='ReadClientMove').slice(0,3).map(x=>round3(x.values?.[0]??null)),unstick:c.filter(x=>x.name==='UnstickMove').length,
  kp,ended:frames.rx(t,f=>f.type==='kicked'||f.type==='disconnected').map(f=>({type:f.type,reason:f.reason??null})),open};
}
// Flags as the admin API returns them ({id, at, kind, severity, score, detail:{detail, replay}}), newest first.
export const newFlags=(flags,after)=>flags.filter(f=>f.id>after).sort((a,b)=>a.id-b.id);
export function countKinds(flags){const k={};for(const f of flags)k[f.kind]=(k[f.kind]??0)+1;return k;}
// Evidence-sized view of a flag (the replay buffer is only counted).
export const flagView=f=>({id:f.id,kind:f.kind,severity:f.severity,score:f.score,detail:f.detail?.detail??null,replay:Array.isArray(f.detail?.replay)?f.detail.replay.length:0});
// A cheat row's verdict: every `expect` kind flagged, no `forbid` kind; `expectRejected`: reasons the gateway must have
// sent back for dropped commands.
export function judge(flags,{expect=[],forbid=[],rejected=[],expectRejected=[]}={}){
 const kinds=countKinds(flags),missing=expect.filter(k=>!kinds[k]),forbidden=forbid.filter(k=>kinds[k]),notRejected=expectRejected.filter(r=>!rejected.includes(r));
 const why=[missing.length&&`not flagged: ${missing.join(', ')}`,forbidden.length&&`unexpected flags: ${forbidden.map(k=>`${k} x${kinds[k]}`).join(', ')}`,notRejected.length&&`the gateway did not drop it (no command-rejected ${notRejected.join(', ')})`].filter(Boolean);
 return {ok:!why.length,kinds,missing,forbidden,notRejected,reason:why.join('; ')||null};
}
// The clean row: no flag of any kind, nothing dropped, no TruthDetector correction.
export function cleanVerdict({flags,rejected=[],reaction=null}){
 const kinds=countKinds(flags),why=[];
 if(flags.length)why.push(`${flags.length} gateway flag${flags.length>1?'s':''} during normal play: ${Object.entries(kinds).map(([k,n])=>`${k} x${n}`).join(', ')}`);
 if(rejected.length)why.push(`the gateway dropped ${rejected.length} command${rejected.length>1?'s':''} (${[...new Set(rejected)].join(', ')})`);
 if(reaction?.corrections)why.push(`${reaction.corrections} server correction${reaction.corrections>1?'s':''}`);
 if(reaction?.kp?.length)why.push('kicked by the server (KP '+reaction.kp.join(', ')+')');
 return {ok:!why.length,kinds,reason:why.join('; ')||null};
}

// Reads one account's flags on one server through the website admin API (`api(method, path)` -> {status, body}; the
// caller's session needs a moderator role or above there). Flags reach central with the gateway's next report
// (reportMs, 5 s by default), so expected flags are polled for and absent ones are waited out.
export function createFlagReader({api,path,subject,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}){
 async function list(){const r=await api('GET',`${path()}/flags?player=${encodeURIComponent(subject())}`);if(r.status!==200)throw Error(`GET flags: HTTP ${r.status} ${r.body?.error??''}`.trim());return r.body?.flags??[];}
 return {
  list,
  // The newest flag id now (0 = none): later flags are the row's.
  async mark(){return (await list()).reduce((m,f)=>Math.max(m,f.id),0);},
  // New flags since `after` once every kind in `kinds` is there (or `ms` ran out), then `settleMs` more for stragglers.
  async waitFor(after,kinds,{ms=30000,settleMs=0,poll=500}={}){
   const end=now()+ms;let got=[];
   for(;;){got=newFlags(await list(),after);const k=countKinds(got);if(kinds.every(x=>k[x])||now()>=end)break;await sleep(poll);}
   if(settleMs>0){await sleep(settleMs);got=newFlags(await list(),after);}
   return got;
  },
  // New flags since `after`, read after `ms` (one report interval and a margin): for rows that want none.
  async settle(after,{ms=7000}={}){await sleep(ms);return newFlags(await list(),after);},
 };
}

// ---- the page side ----------------------------------------------------------------------------------------------------
// Evaluated into the test page (page.evaluate(cheatEngine)); installs window.__rlbCheat. Every movement cheat holds the
// character with explorerDev.teleport each 16 ms tick, so the page's own moves (and the motor's position) carry it:
// the page and what it sends stay consistent, and a server correction is overridden at the next tick like a real
// cheat client would. send() puts one extra frame on the game socket through the harness's netShaper wrapper.
export function cheatEngine(){
 if(window.__rlbCheat)return true;
 const dev=()=>window.explorerDev,feet=()=>window.explorerState?.player?.feet?.slice()??null;
 const ground=(x,z)=>{try{const g=dev()?.airdropGround?.(x,z);return Number.isFinite(g)?g:null;}catch{return null;}};
 let job=null;
 function stop(){if(!job)return;clearInterval(job.timer);const j=job;job=null;j.done(feet());}
 // step(seconds since start, dt) each tick for ms; resolves with the feet at the end.
 function run(step,ms){
  stop();
  return new Promise(done=>{const t0=performance.now();let last=t0;
   const tick=()=>{const t=performance.now(),s=(t-t0)/1000;try{if(!window.explorerState?.online||window.explorerState.online.state==='in-game')step(Math.min(s,ms/1000),(t-last)/1000);}catch(e){window.__rlbCheat.errors.push(String(e).slice(0,200));}last=t;if(t-t0>=ms&&job?.timer===timer)stop();};
   const timer=setInterval(tick,16);job={timer,done};tick();});
 }
 const tp=p=>dev().teleport(p);
 window.__rlbCheat={
  errors:[],
  // One frame on every open /play socket (harness netShaper wrapper); returns how many sockets took it.
  send(cmd){let n=0;for(const ws of window.__rlbNetShape?.sockets??[])if(ws.readyState===1){ws.send(JSON.stringify(cmd));n++;}return n;},
  // Holds the feet on the straight line from -> to over ms (from = the feet now when null).
  glide(from,to,ms){const a=from??feet();return run(s=>{const k=Math.min(1,s*1000/Math.max(1,ms));tp(a.map((v,i)=>v+(to[i]-v)*k));},ms);},
  pin(p,ms){return run(()=>tp(p),ms);},
  // Moves along the ground (browser xz direction) at `speed` m/s, terrain and structure height from the page.
  push(dir,speed,ms){const l=Math.hypot(dir[0],dir[1])||1,u=[dir[0]/l,dir[1]/l];let at=feet();
   return run((s,dt)=>{at=[at[0]+u[0]*speed*dt,at[1],at[2]+u[1]*speed*dt];const g=ground(at[0],at[2]);if(g!=null)at[1]=g+0.02;tp(at);},ms);},
  stop,
  busy:()=>Boolean(job),
 };
 return true;
}
