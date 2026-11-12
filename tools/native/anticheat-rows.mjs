// P7 anti-cheat rows of the native matrix (SERVER-TESTING-PLAN.md P7). Each cheat row makes the test page misbehave
// once, through tools/native/cheats.mjs (harness-only page hooks), and asserts that the gateway's anti-cheat
// (bridge/anticheat.mjs) flagged it, read back from the website admin evidence API as the player (who needs a moderator
// role or above on the server there, like the Admin tools rows). Where the original server reacts (TruthDetector
// rollbacks, kicks) the row records it next to the flags. p7.clean plays normally for 3-5 minutes and wants no flag at
// all: the false-positive check.
// Safe on a shared test server: every hit lands on our own Wood Storage Box behind our own Wood Barricade (placed
// where the row stands), never on a player; movement cheats stay within ~80 m of where the row starts and under the
// TruthDetector kick threshold (speed > 20 m/s adds the speed per move, kick above 400).
import {feet,toUnity,distXZ,aimAt,click,walkTo,hold,lockPointer,closeInventory,sleepMs as sleep} from './driver.mjs';
import {loadIsland,planWalk} from './walk-plan.mjs';
import {walkToMeet} from './walk-meet.mjs';
import {cheatEngine,createFlagReader,forgedMove,meleeHit,bulletFire,bowFire,bowHit,contextQuery,contextCancel,ngcTarget,contextTarget,lookRotation,
 along,browserForward,unityYawOfBrowserDir,wrap180,pickHeading,eyeOf,judge,cleanVerdict,flagView,rejections,serverReaction,round3,EYE_HEIGHT} from './cheats.mjs';

const round=(v,n=2)=>v==null||!Number.isFinite(v)?v:+Number(v).toFixed(n);
const browserOf=([x,y,z])=>[x,y,-z];
// Gateway reasons for commands the anti-cheat dropped (bridge/anticheat.mjs, gateway-service.mjs command flood).
const ANTICHEAT_REJECTS=new Set(['impossible-move','impossible-shot','fire-rate','command-rate','rate-limited']);
const MOVEMENT=['teleport','speed','fly','hover','noclip','under-terrain'];

export function createAntiCheatRows(h){
 const {ctx,cfg,pass,fail,skip,g}=h;
 const me=()=>ctx.session;
 const reader=createFlagReader({api:(m,p)=>h.api(m,p),path:h.adminPath,subject:()=>ctx.me.player});
 const waitMs=cfg.adminWaitMs??30000,settleMs=cfg.flagSettleMs??(h.mock?2000:8000),los=cfg.anticheatLineOfSight!==false;
 // ---- page helpers ---------------------------------------------------------------------------------------------------
 const inject=(s,cmd)=>s.page.evaluate(c=>window.__rlbCheat.send(c),cmd);
 const cheat=(s,name,args)=>s.page.evaluate(([n,a])=>window.__rlbCheat[n](...a),[name,args]);
 const lastMove=s=>s.frames.tx(0,f=>f.type==='move'&&Array.isArray(f.origin)).at(-1)??null;
 const camYaw=async s=>unityYawOfBrowserDir(await s.page.evaluate(()=>window.explorerDev.aim(0).dir));
 const groundAt=(s,p)=>s.page.evaluate(([x,z])=>window.explorerDev.airdropGround?.(x,z)??null,[p[0],p[2]]);
 const faceYaw=async(s,yaw)=>{const p=await feet(s.page),q=along(p,yaw,30);await aimAt(s.page,[q[0],p[1]+EYE_HEIGHT,q[2]]);};
 // Turns the view to a point in steps of at most `step` degrees every 80 ms (a mouse turn, not the harness's instant
 // aimAt), so a hit after it is not an aim snap (yaw change > 90° within one send interval).
 async function smoothAim(s,point,{step=30}={}){
  const st=await s.page.evaluate(()=>({dir:window.explorerDev.aim(0).dir,eye:window.explorerState.position}));
  const from=Math.atan2(-st.dir[0],-st.dir[2]),dx=point[0]-st.eye[0],dy=point[1]-st.eye[1],dz=point[2]-st.eye[2];
  const to=Math.atan2(-dx,-dz),pitch=Math.asin(dy/(Math.hypot(dx,dy,dz)||1)),delta=wrap180((to-from)*180/Math.PI),n=Math.max(1,Math.ceil(Math.abs(delta)/step));
  for(let i=1;i<n;i++){await s.page.evaluate(([y,p])=>window.explorerDev.face(y,p),[from+delta*Math.PI/180*i/n,pitch]);await sleep(80);}
  await aimAt(s.page,point);await sleep(80);
 }
 // The engine, the dev hooks it needs, and the gateway's 2 s grace after a server-originated position run out.
 async function prepare(s){
  const hooks=await s.page.evaluate(()=>({teleport:typeof window.explorerDev?.teleport==='function',ground:typeof window.explorerDev?.airdropGround==='function',shaper:Boolean(window.__rlbNetShape)})).catch(()=>({}));
  if(!hooks.teleport||!hooks.shaper)return skip('the test page lacks the dev hooks the cheat helper drives (explorerDev.teleport, the harness socket wrapper)',{hooks});
  await s.page.evaluate(cheatEngine);
  const own=s.frames.characters.at(-1)?.t??0,corr=s.frames.correctionLog.at(-1)?.t??0,wait=Math.max(own,corr)+2600-Date.now();
  if(wait>0)await sleep(wait);
  await lockPointer(s.page);return null;
 }
 // A heading around the player clear at eye height for `need` metres (the page's camera ray; island heightmap for the
 // slope, the water and, with `line`, a straight jump's TruthDetector trace).
 async function heading(s,{need=10,line=0,maxSlope=35}={}){
  let island=null;try{island=await loadIsland();}catch{}
  const p=await feet(s.page),y0=await camYaw(s),cands=[];
  for(let i=0;i<8;i++){const yaw=wrap180(y0+i*45),far=along(p,yaw,60);await aimAt(s.page,[far[0],p[1]+EYE_HEIGHT,far[2]]);await sleep(60);
   cands.push({yaw,ray:await s.page.evaluate(()=>window.explorerDev.aim(0).ray?.distance??null)});}
  return pickHeading(cands,{from:p,ground:island?.ground??null,need,line,maxSlope,waterLine:island?.waterLine??-Infinity});
 }
 const reaction=async(s,t,ms=2500)=>{await sleep(ms);return serverReaction(s.frames,t,{open:s.socketOpen()});};
 const result=(verdict,ev,extra=null)=>verdict.ok?pass(ev,extra):fail(verdict.reason,ev);
 const flagsOf=(list,kind)=>list.filter(f=>f.kind===kind).map(flagView);
 // ---- the range: our box behind our barricade --------------------------------------------------------------------------
 // From a flat, clear stand: a Wood Storage Box 4.5 m ahead, then a Wood Barricade (2.9 x 3.7 x 0.5 m, layer 10: in the
 // bullet and TruthDetector masks) 2.2 m ahead between us and the box. Kept for the run in ctx.p7range.
 const alive=(s,e)=>e&&!s.frames.rx(e.t-1,f=>f.type==='ngc-destroy'&&f.carrier===e.carrier&&f.innerID===e.innerID).length;
 async function range(){
  const s=me(),old=ctx.p7range;
  if(old&&old.page===s.page&&alive(s,old.box)&&alive(s,old.barricade))return old;
  const x=await g.supply(s,[['Wood Storage Box',1],['Wood Barricade',1]]);if(x)return {unmet:x};
  await g.leaveZones(s);
  const avoid=[ctx.base,ctx.lone].filter(Boolean).map(b=>browserOf(b.foundation.position));if(old?.box)avoid.push(browserOf(old.box.position));await g.clearOf(s,avoid,12);
  const hd=await heading(s,{need:9,maxSlope:12});if(!hd)return {fail:'no flat, clear heading for the range around the player'};
  await faceYaw(s,hd.yaw);await sleep(300);const stand=await feet(s.page);
  const ahead=d=>{const q=along(stand,hd.yaw,d);q[1]=stand[1]-0.1;return q;};
  if(!await g.equip(s,'Wood Storage Box'))return {fail:'could not hold the Wood Storage Box'};
  const box=await g.place(s,{prefab:/;deploy_wood_box$/,candidates:[4.5,4.8,4.2,5.1].map(ahead)});
  if(!box.made)return {fail:'the box was not created',evidence:{box}};
  await faceYaw(s,hd.yaw);await sleep(200);
  if(!await g.equip(s,'Wood Barricade'))return {fail:'could not hold the Wood Barricade'};
  const bar=await g.place(s,{prefab:/;deploy_wood_barricade$/,candidates:[2.2,2.4,2.0,2.6].map(ahead)});
  if(!bar.made)return {fail:'the barricade was not created',evidence:{box:box.made.position,barricade:bar}};
  const group=s.frames.rx(0,f=>f.type==='create'&&f.viewId===box.made.carrier&&Number.isInteger(f.group)).at(-1)?.group??null;
  if(group==null)return {fail:'no network group for the NGC carrier of the box'};
  const boxU=[box.made.position[0],box.made.position[1]+0.375,box.made.position[2]];
  const o=await s.page.evaluate(k=>window.explorerDev.onlineObject?.(k)??null,bar.made.carrier+':'+bar.made.innerID);
  const top=o?.center&&o.size?o.center[1]+o.size[1]/2:browserOf(bar.made.position)[1]+3.5;
  const rg={page:s.page,stand,yaw:hd.yaw,box:box.made,barricade:bar.made,group,boxU,barTop:round(top,3),barCentre:o?.center?round3(o.center):null};
  // What the page itself sees from the stand: the eye ray to the box centre should stop on the barricade.
  await aimAt(s.page,browserOf(boxU));await sleep(150);rg.pageRay=await s.page.evaluate(()=>window.explorerDev.aim(0).ray);
  ctx.p7range=rg;return rg;
 }
 const rangeFail=x=>x.unmet?g.unmet(x.unmet):fail(x.fail,x.evidence??{});
 // Back on the stand, facing the box, the aim settled (no snap pending).
 async function atStand(s,rg){await walkTo(s.page,rg.stand,{within:0.5,ms:20000});await smoothAim(s,browserOf(rg.boxU));await sleep(700);}
 const rangeEv=rg=>({box:rg.box.carrier+':'+rg.box.innerID,barricade:rg.barricade.carrier+':'+rg.barricade.innerID,stand:round3(rg.stand),barricadeTop:rg.barTop,pageRay:rg.pageRay?.body??null});
 // The held item's representation view (IAST), with the deploy wait for guns and bows.
 async function holding(s,name,wait=0){const e=await g.equip(s,name);if(!e?.rep)return null;if(wait)await sleep(wait);return e;}

 return {
  // ---- the false-positive check ------------------------------------------------------------------------------------
  async 'p7.clean'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;
   const t0=Date.now(),mark=await reader.mark(),ev={steps:{}},minMs=(cfg.cleanSeconds??180)*1000,maxMs=Math.max(minMs,(cfg.cleanMaxSeconds??300)*1000);
   const step=async(name,fn)=>{const t=Date.now();try{ev.steps[name]={...(await fn()??{}),seconds:Math.round((Date.now()-t)/1000)};}catch(e){ev.steps[name]={error:e.message.split('\n')[0].slice(0,200),seconds:Math.round((Date.now()-t)/1000)};}};
   // Jumps every ~2.5 s while a walk runs (on slopes when the route climbs).
   const jumping=()=>{let on=true,n=0;const loop=(async()=>{while(on){await sleep(2500);if(!on)break;await s.page.keyboard.down('Space');await sleep(120);await s.page.keyboard.up('Space');n++;}})();return async()=>{on=false;await loop;return n;};};
   let island=null;try{island=await loadIsland();}catch{}
   // 1. Walk, sprint and jump to a point 60-90 m away, preferring a route that climbs (slopes), and back.
   await step('walk',async()=>{
    if(!island)return {skipped:'no island navmesh on this host'};
    const p=await feet(s.page),plans=[];
    for(let i=0;i<8;i++)for(const d of [70,90]){const q=along(p,i*45,d);q[1]=island.ground(q[0],q[2]);const pl=planWalk(island,p,q);if(pl.ok&&pl.profile.maxSlope<=40)plans.push({q,pl});}
    plans.sort((a,b)=>b.pl.profile.maxSlope-a.pl.profile.maxSlope);const pick=plans[0];if(!pick)return {skipped:'no walkable route 70-90 m from here'};
    const out={to:round3(pick.q),path:pick.pl.length,maxSlope:pick.pl.profile.maxSlope};
    let stopJumps=jumping();const a=await walkToMeet(s.page,async()=>pick.q,{within:3,ms:120000});out.jumps=await stopJumps();
    stopJumps=jumping();const b=await walkToMeet(s.page,async()=>p,{within:3,ms:120000});out.jumps+=await stopJumps();
    return {...out,there:{arrived:a.arrived,seconds:Math.round(a.ms/1000),stuck:a.stuck},back:{arrived:b.arrived,seconds:Math.round(b.ms/1000),stuck:b.stuck}};
   });
   // 2. Crouch-walk and strafe.
   await step('crouch',async()=>{await hold(s.page,['ControlLeft','KeyW'],4000);await hold(s.page,['KeyA'],1500);await hold(s.page,['KeyD'],1500);return {};});
   // 3. Gather Wood from terrain trees with the Rock.
   await step('gather',async()=>{if(!await g.has(s,'trees'))return {skipped:g.OLD_BUILD('trees')};const before=await g.count(s,'Wood'),w=await g.gatherWood(s,before+3,{ms:90000});return {wood:[before,w.have],trees:w.trees,swings:w.swings,why:w.why??null};});
   // 4. Build (admin gives a Wood Foundation): place it, step up onto it, walk across and jump off.
   await step('build',async()=>{
    if(!await h.ensureAdmin(s))return {skipped:'needs admin rights to give a Wood Foundation: '+h.adminWhy(s)};
    const x=await g.supply(s,[['Wood Foundation',1]]);if(x)return {skipped:x.skip??x.fail};
    const avoid=[ctx.base,ctx.lone].filter(Boolean).map(b=>browserOf(b.foundation.position));if(ctx.p7range)avoid.push(browserOf(ctx.p7range.box.position),browserOf(ctx.p7range.barricade.position));
    const f=await g.placeFoundation(s,avoid);if(!f.made)return {placed:false,sent:f.sent};
    const c=browserOf(f.made.position),o=await s.page.evaluate(k=>window.explorerDev.onlineObject?.(k)??null,f.made.carrier+':'+f.made.innerID);
    const on=await walkTo(s.page,c,{within:1,ms:20000}),top=(await feet(s.page))[1];
    const p=await feet(s.page);await hold(s.page,['Space'],120);const off=await walkTo(s.page,[c[0]+6,p[1],c[2]],{within:1,ms:15000});
    return {placed:true,foundation:round3(f.made.position),top:o?.center&&o.size?round(o.center[1]+o.size[1]/2):null,onTop:on.arrived,feetOnTop:round(top),off:off.arrived};
   });
   // 5. Wildlife: walk up to the nearest animal (crouched for the last metres), turn to it like a mouse and swing.
   await step('wildlife',async()=>{
    const animals=()=>s.page.evaluate(()=>window.explorerDev.onlineAnimals?.()??[]);const here=await feet(s.page);
    const prey=(await animals()).filter(a=>!a.dead&&(a.center||a.position)).map(a=>({...a,at:a.center??a.position})).map(a=>({...a,d:distXZ(a.at,here)})).filter(a=>a.d<60).sort((a,b)=>a.d-b.d)[0];
    if(!prey)return {skipped:'no animal within 60 m'};
    const rock=await holding(s,'Rock');if(!rock)return {skipped:'could not hold the Rock'};
    let swings=0;const end=Date.now()+60000;
    while(Date.now()<end&&swings<6){const a=(await animals()).find(x=>x.id===prey.id);if(!a||a.dead)break;const c=a.center??a.position;
     if(distXZ(c,await feet(s.page))>1.4){await s.page.keyboard.down('ControlLeft');try{await walkTo(s.page,c,{within:1.1,ms:8000,sprintBeyond:Infinity});}finally{await s.page.keyboard.up('ControlLeft');}continue;}
     await smoothAim(s,c);await sleep(350);await click(s.page);swings++;await sleep(2200);}
    const died=s.frames.rx(t0,f=>f.type==='rpc'&&f.viewId===prey.id&&f.name==='ClientDeath').length>0;
    return {animal:prey.key??null,startDistance:round(prey.d),swings,died};
   });
   // 6. Use: a door from door.use earlier in the run, else our range box (open and close it).
   await step('use',async()=>{
    const door=ctx.door&&!s.frames.rx(ctx.door.t-1,f=>f.type==='ngc-destroy'&&f.carrier===ctx.door.carrier&&f.innerID===ctx.door.innerID).length?ctx.door:null;
    if(door){const a=await g.use(s,door,{d:2});await sleep(1500);const b=await g.use(s,door,{d:2});await sleep(1500);return {door:true,first:a.reply,second:b.reply};}
    const box=ctx.p7range&&alive(s,ctx.p7range.box)?ctx.p7range.box:null;if(!box)return {skipped:'no door (door.use) or range box (p7 range rows) in this run'};
    const o=await g.openLoot(s,box);await sleep(800);await closeInventory(s.page);return {box:true,opened:o.open};
   });
   // 7. More walking until the 3 minutes are up (short legs around the start, sprinting and jumping).
   await step('more',async()=>{let legs=0;const home=await feet(s.page);
    while(Date.now()-t0<minMs&&Date.now()-t0<maxMs-20000){const yaw=legs*137%360,q=along(home,yaw,18);const stopJumps=jumping();await walkTo(s.page,q,{within:2,ms:15000,sprintBeyond:6});await stopJumps();legs++;}
    return {legs};});
   const flags=await reader.settle(mark,{ms:settleMs}),rejected=rejections(s.frames,t0),re=serverReaction(s.frames,t0,{open:s.socketOpen()});
   Object.assign(ev,{seconds:Math.round((Date.now()-t0)/1000),flags:flags.map(flagView),rejected:[...new Set(rejected)],server:re});
   await ctx.shot(r,'after');
   const v=cleanVerdict({flags,rejected:rejected.filter(x=>ANTICHEAT_REJECTS.has(x)),reaction:re});
   return result(v,ev);
  },
  // ---- movement --------------------------------------------------------------------------------------------------
  async 'p7.teleport'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;
   const hd=await heading(s,{need:17,line:15,maxSlope:20});if(!hd)return skip('no clear heading for a 15 m jump around the player');
   await faceYaw(s,hd.yaw);await sleep(800);const ev={heading:round(hd.yaw,1)};
   // 1. One forged move 60 m ahead: the gateway flags teleport and drops it (the server never sees it).
   let mark=await reader.mark(),last=lastMove(s);if(!last)return fail('the page sent no move to copy');
   const t1=Date.now(),to=along(last.origin,hd.yaw,60,{browser:false}),n=await inject(s,forgedMove(last,{origin:to}));
   const f1=await reader.waitFor(mark,['teleport'],{ms:waitMs});
   ev.forged={sockets:n,from:round3(last.origin),to:round3(to),flags:f1.map(flagView),rejected:rejections(s.frames,t1),server:await reaction(s,t1)};
   const v1=judge(f1,{expect:['teleport'],rejected:ev.forged.rejected,expectRejected:['impossible-move']});
   // 2. The page really jumps 15 m (under the 25 m drop limit): flagged speed, forwarded, the server's reaction recorded.
   mark=await reader.mark();const t2=Date.now(),p=await feet(s.page),dest=along(p,hd.yaw,15),gy=await groundAt(s,dest);if(Number.isFinite(gy))dest[1]=gy+0.02;
   await s.page.evaluate(q=>window.explorerDev.teleport(q),dest);
   const f2=await reader.waitFor(mark,['speed'],{ms:waitMs});
   ev.jump={from:round3(toUnity(p)),to:round3(toUnity(dest)),flags:f2.map(flagView),rejected:rejections(s.frames,t2),server:await reaction(s,t2)};
   const v2=judge(f2,{expect:['speed'],forbid:['teleport'],rejected:ev.jump.rejected});
   // 3. Walking on from there is accepted and clean (the gateway kept the right baseline).
   mark=await reader.mark();const t3=Date.now(),before=await feet(s.page);await hold(s.page,['KeyW'],3000);
   const f3=await reader.settle(mark,{ms:settleMs});
   ev.after={walked:round(distXZ(await feet(s.page),before)),flags:f3.map(flagView),rejected:rejections(s.frames,t3),server:serverReaction(s.frames,t3,{open:s.socketOpen()})};
   const v3=judge(f3,{forbid:MOVEMENT,rejected:ev.after.rejected});
   await ctx.shot(r,'after');
   const bad=[!v1.ok&&'forged 60 m move: '+v1.reason,!v2.ok&&'15 m jump: '+v2.reason,!v3.ok&&'walking on: '+v3.reason,ev.after.rejected.includes('impossible-move')&&'walking on: moves still dropped'].filter(Boolean);
   return bad.length?fail(bad.join('; '),ev):pass(ev);
  },
  async 'p7.speed'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;
   const hd=await heading(s,{need:40,maxSlope:25});if(!hd)return skip('no clear heading for an 80 m run around the player');
   await faceYaw(s,hd.yaw);await sleep(800);
   const mark=await reader.mark(),t=Date.now(),dir=browserForward(hd.yaw),a=await feet(s.page);
   const b=await cheat(s,'push',[[dir[0],dir[2]],15,4000]),c=await cheat(s,'push',[[dir[0],dir[2]],25,600]);
   const flags=await reader.waitFor(mark,['speed'],{ms:waitMs,settleMs:Math.min(settleMs,3000)});
   const ev={heading:round(hd.yaw,1),run:{metres:round(distXZ(a,b)),seconds:4,speed:round(distXZ(a,b)/4,1)},burst:{metres:round(distXZ(b,c)),seconds:0.6,speed:round(distXZ(b,c)/0.6,1)},
    flags:flags.map(flagView),rejected:rejections(s.frames,t),server:await reaction(s,t),errors:await s.page.evaluate(()=>window.__rlbCheat.errors.slice(-3))};
   await ctx.shot(r,'after');
   return result(judge(flags,{expect:['speed'],forbid:['teleport'],rejected:ev.rejected}),ev);
  },
  async 'p7.fly'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;
   const mark=await reader.mark(),t=Date.now(),p=await feet(s.page),up=[p[0],p[1]+5,p[2]];
   await cheat(s,'glide',[null,up,500]);await cheat(s,'pin',[up,3000]);await ctx.shot(r,'airborne');
   const gy=await groundAt(s,p),down=[p[0],(Number.isFinite(gy)?gy:p[1])+0.02,p[2]];await cheat(s,'glide',[up,down,1200]);
   const expect=los?['fly','hover']:['fly'],flags=await reader.waitFor(mark,expect,{ms:waitMs});
   const ev={from:round3(toUnity(p)),height:5,seconds:3,lineOfSight:los,flags:flags.map(flagView),hover:flagsOf(flags,'hover'),rejected:rejections(s.frames,t),server:await reaction(s,t)};
   return result(judge(flags,{expect,forbid:['teleport'],rejected:ev.rejected}),ev,los?null:'hover not required: cfg.anticheatLineOfSight is false (the gateway has no ground probe)');
  },
  // ---- combat ------------------------------------------------------------------------------------------------------
  async 'p7.fire-rate'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;
   const rock=await holding(s,'Rock',2500);if(!rock)return fail('could not hold the Rock (no IAST)');
   const yaw=await camYaw(s),here=toUnity(await feet(s.page)),point=along(here,yaw,1.2,{browser:false});point[1]=here[1]+0.05;
   const mark=await reader.mark(),t=Date.now();
   for(let i=0;i<5;i++){await inject(s,meleeHit(rock.rep,{point}));await sleep(30);}
   const flags=await reader.waitFor(mark,['fire-rate'],{ms:waitMs}),rejected=rejections(s.frames,t);
   const ev={weapon:'Rock',fireRateSeconds:1.95,sent:5,dropped:rejected.filter(x=>x==='fire-rate').length,flags:flags.map(flagView),rejected,server:await reaction(s,t,1000)};
   return result(judge(flags,{expect:['fire-rate'],rejected,expectRejected:['fire-rate']}),ev);
  },
  async 'p7.wall-melee'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;if(!los)return skip('cfg.anticheatLineOfSight is false: the gateway has no line-of-sight world');
   const rg=await range();if(rg.unmet||rg.fail)return rangeFail(rg);
   const rock=await holding(s,'Rock');if(!rock)return fail('could not hold the Rock (no IAST)');await atStand(s,rg);
   const mark=await reader.mark(),t=Date.now();await inject(s,meleeHit(rock.rep,{target:ngcTarget(rg.box,rg.group),point:rg.boxU}));
   const flags=await reader.waitFor(mark,['wall-shot'],{ms:waitMs}),ws=flagsOf(flags,'wall-shot');await ctx.shot(r,'range');
   const ev={range:rangeEv(rg),distance:round(distXZ(browserOf(rg.boxU),await feet(s.page))),flags:flags.map(flagView),wallShot:ws,rejected:rejections(s.frames,t),server:await reaction(s,t,1000)};
   const v=judge(flags,{expect:['wall-shot'],forbid:['hit-range']});if(v.ok&&ws[0]?.detail?.attack!=='melee')return fail('wall-shot flagged, but not as a melee attack',ev);
   return result(v,ev);
  },
  async 'p7.wall-shot'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;if(!los)return skip('cfg.anticheatLineOfSight is false: the gateway has no line-of-sight world');
   const rg=await range();if(rg.unmet||rg.fail)return rangeFail(rg);
   const x=await g.supply(s,[['Revolver',1],['9mm Ammo',8]]);if(x)return g.unmet(x);
   const gun=await holding(s,'Revolver',2000);if(!gun)return fail('could not hold the Revolver (no IAST)');
   const tr=Date.now();await hold(s.page,['KeyR'],250);const reload=await g.waitTx(s,tr,f=>f.type==='item'&&f.action==='bullet-reload',4000);await sleep(2500);
   await atStand(s,rg);
   const mark=await reader.mark(),t=Date.now();await inject(s,bulletFire(gun.rep,[{target:ngcTarget(rg.box,rg.group),point:[0,0.375,0]}]));
   const flags=await reader.waitFor(mark,['wall-shot'],{ms:waitMs}),ws=flagsOf(flags,'wall-shot');
   const ev={range:rangeEv(rg),reload:Boolean(reload),flags:flags.map(flagView),wallShot:ws,rejected:rejections(s.frames,t),server:await reaction(s,t,1000)};
   const v=judge(flags,{expect:['wall-shot'],forbid:['hit-range','pellet-count'],rejected:ev.rejected});if(v.ok&&ws[0]?.detail?.attack!=='bullet')return fail('wall-shot flagged, but not as a bullet',ev);
   return result(v,ev);
  },
  async 'p7.wall-arrow'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;if(!los)return skip('cfg.anticheatLineOfSight is false: the gateway has no line-of-sight world');
   const rg=await range();if(rg.unmet||rg.fail)return rangeFail(rg);
   const x=await g.supply(s,[['Hunting Bow',1],['Arrow',5]]);if(x)return g.unmet(x);
   const bow=await holding(s,'Hunting Bow',2000);if(!bow)return fail('could not hold the Hunting Bow (no IAST)');await atStand(s,rg);
   const eye=eyeOf(toUnity(await feet(s.page))),target=ngcTarget(rg.box,rg.group),mark=await reader.mark(),t=Date.now();
   // 1. Loosed straight at the box: the arrow's own path runs through the barricade.
   await inject(s,bowFire(bow.rep,eye,lookRotation(eye,rg.boxU)));await sleep(150);await inject(s,bowHit(bow.rep,target,rg.boxU));
   await sleep(1300);
   // 2. Loosed 90° to the side, yet "hit" the box: the hit is far from every point of the arrow's path.
   const side=along(eye,rg.yaw+90,10,{browser:false});
   await inject(s,bowFire(bow.rep,eye,lookRotation(eye,side)));await sleep(150);await inject(s,bowHit(bow.rep,target,rg.boxU));
   const flags=await reader.waitFor(mark,['wall-shot','arrow-path'],{ms:waitMs}),ws=flagsOf(flags,'wall-shot');
   const ev={range:rangeEv(rg),flags:flags.map(flagView),wallShot:ws,arrowPath:flagsOf(flags,'arrow-path'),rejected:rejections(s.frames,t),server:await reaction(s,t,1000)};
   const v=judge(flags,{expect:['wall-shot','arrow-path'],rejected:ev.rejected});if(v.ok&&ws[0]?.detail?.attack!=='arrow')return fail('wall-shot flagged, but not for the arrow',ev);
   return result(v,ev);
  },
  async 'p7.wall-use'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;if(!los)return skip('cfg.anticheatLineOfSight is false: the gateway has no line-of-sight world');
   const rg=await range();if(rg.unmet||rg.fail)return rangeFail(rg);await atStand(s,rg);
   const mark=await reader.mark(),t=Date.now();await inject(s,contextQuery(contextTarget(rg.box)));
   const flags=await reader.waitFor(mark,['wall-use'],{ms:waitMs});
   const replies=s.frames.rx(t,f=>f.type==='rpc'&&f.viewId===998).map(f=>f.name);
   await closeInventory(s.page);await inject(s,contextCancel());await sleep(500);
   const ev={range:rangeEv(rg),flags:flags.map(flagView),wallUse:flagsOf(flags,'wall-use'),serverReplies:replies,rejected:rejections(s.frames,t),server:await reaction(s,t,1000)};
   return result(judge(flags,{expect:['wall-use'],rejected:ev.rejected}),ev);
  },
  async 'p7.aim-snap'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;
   const rg=await range();if(rg.unmet||rg.fail)return rangeFail(rg);
   // A stand 2 m to the side of the box, clear of the barricade: only the snap is wrong with this hit.
   const box=browserOf(rg.boxU),side=along([box[0],rg.stand[1],box[2]],rg.yaw+90,2);
   const rock=await holding(s,'Rock');if(!rock)return fail('could not hold the Rock (no IAST)');
   await walkTo(s.page,side,{within:0.6,ms:20000});const p=await feet(s.page),away=[p[0]+(p[0]-box[0])*5,p[1]+EYE_HEIGHT,p[2]+(p[2]-box[2])*5];
   await smoothAim(s,away);await sleep(900);
   const mark=await reader.mark(),t=Date.now(),before=await camYaw(s);
   await aimAt(s.page,box);const yaw=await camYaw(s),last=lastMove(s);
   // The snapped view goes out in the next move; a forged copy right away makes the two moves one send interval apart.
   if(last)await inject(s,forgedMove(last,{origin:last.origin,yaw}));await sleep(60);
   await inject(s,meleeHit(rock.rep,{target:ngcTarget(rg.box,rg.group),point:rg.boxU}));
   const flags=await reader.waitFor(mark,['yaw-snap'],{ms:waitMs});
   const ev={range:rangeEv(rg),turn:round(Math.abs(wrap180(yaw-before)),1),distance:round(distXZ(box,p)),flags:flags.map(flagView),yawSnap:flagsOf(flags,'yaw-snap'),rejected:rejections(s.frames,t),server:await reaction(s,t,1000)};
   return result(judge(flags,{expect:['yaw-snap'],forbid:['wall-shot']}),ev);
  },
  async 'p7.hover-structure'(r){
   const s=me(),pre=await prepare(s);if(pre)return pre;if(!los)return skip('cfg.anticheatLineOfSight is false: the gateway has no ground probe');
   const rg=await range();if(rg.unmet||rg.fail)return rangeFail(rg);
   await walkTo(s.page,rg.stand,{within:0.5,ms:20000});await sleep(2600);
   // The barricade's root sits on the collider's edge (BoxCollider centre z 0.435 m, 0.5 m thick): standing at the root
   // is standing on the edge, the capsule (0.405 m radius) on the top with its centre past it.
   const b=browserOf(rg.barricade.position),c=rg.barCentre??b,mid=[c[0],rg.barTop+0.03,c[2]],edge=[b[0],rg.barTop+0.03,b[2]],high=[c[0],rg.barTop+5,c[2]],ev={range:rangeEv(rg)};
   // 1. Stand on the barricade's top (3.5 m above the terrain), 3 s in the middle and 3 s on the edge: no hover.
   let mark=await reader.mark(),t=Date.now();await cheat(s,'glide',[null,mid,1000]);await cheat(s,'pin',[mid,3000]);await ctx.shot(r,'on-top');
   await cheat(s,'glide',[mid,edge,300]);await cheat(s,'pin',[edge,3000]);
   const f1=await reader.settle(mark,{ms:settleMs});ev.onTop={height:round(rg.barTop-b[1]),edgeOffset:round(distXZ(edge,mid)),flags:f1.map(flagView)};
   // 2. 5 m above its top for 3 s: hover over a structure.
   mark=await reader.mark();t=Date.now();await cheat(s,'glide',[edge,high,500]);await cheat(s,'pin',[high,3000]);await ctx.shot(r,'above');
   const gy=await groundAt(s,rg.stand);await cheat(s,'glide',[high,[rg.stand[0],(Number.isFinite(gy)?gy:rg.stand[1])+0.02,rg.stand[2]],1800]);
   const f2=await reader.waitFor(mark,['hover'],{ms:waitMs}),hv=flagsOf(f2,'hover');
   Object.assign(ev,{above:{flags:f2.map(flagView),hover:hv},server:await reaction(s,t,1000)});
   const bad=[f1.some(f=>f.kind==='hover')&&'hover flagged while standing on the barricade (false positive)',!hv.length&&'no hover flag 5 m above the barricade',
    hv.length&&hv.every(f=>f.detail?.surface==='terrain')&&'hover flagged against the terrain, not the barricade under it'].filter(Boolean);
   return bad.length?fail(bad.join('; '),ev):pass(ev);
  },
 };
}
