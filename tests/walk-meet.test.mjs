// Walk-to-meet (tools/native/walk-meet.mjs) offline: the walker logic driving the port's own motor on the port's
// collision world with the original server's TruthDetector judging its moves (tools/native/walk-sim.mjs).
// The 2026-10-23 run two-c (analysis/native-runs/2026-10-23-gameplay-real-two-c, row mixed.move): the target walked
// 1127 -> 734 m in 63 s, got three server corrections on the line west of browser [6419, 409, 3652] and
// [6389, 416, 3652] (the terrain: the port's ground used the other cell diagonal and lay under the server's there;
// since GAP-AUDIT T4 tools/replay-truth-trace.mjs replays all three),
// stood out the guard's 42 s pause and was dead 3 s after the last correction (its move stream stops at 112.9 s; the
// character was gone for the next rows). The old walker never looked: it "walked" the dead character for 230 s, 25
// stuck events and 28 re-plans returning the same 771.6 m path from the same spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {TruthGuard} from '../tools/native/truth-guard.mjs';
import {FrameLog,lateDrop} from '../tools/native/lib.mjs';
import {walkMeetCore,samePath} from '../tools/native/walk-meet.mjs';
import {present} from './helpers/assets.mjs';

const have=present(new URL('../browser/assets/recovered/navmesh/manifest.json',import.meta.url))&&present(new URL('../browser/assets/recovered/rockspawn/manifest.json',import.meta.url));
const RUN_GOAL=[5671.84,400.32,3496.0]; // the player's spawn in run two-c (browser space)
const STUCK=[6389.0,416.0,3652.4];      // where the target stood from 63 s on
const BEFORE=[6450.4,392.7,3652.1];     // the target's position ~7 s before the first correction
const lazy=async()=>{const [{loadIsland,planWalk,distXZ,polyAt},sim]=await Promise.all([import('../tools/native/walk-plan.mjs'),import('../tools/native/walk-sim.mjs')]);
 return {island:await loadIsland(),world:await sim.loadSimWorld(),planWalk,distXZ,polyAt,...sim};};
// A post (Unity-space centre [x, z], radius) on TruthDetector's trace that only the server has.
const segCircle=(o,n,[cx,cz],r)=>{const bx=n[0]-o[0],bz=n[2]-o[2],L2=bx*bx+bz*bz;if(L2<1e-9)return false;const t=Math.max(0,Math.min(1,((cx-o[0])*bx+(cz-o[2])*bz)/L2));return Math.hypot(o[0]+bx*t-cx,o[2]+bz*t-cz)<r;};
const posts=list=>(o,n)=>list.some(([c,r])=>segCircle(o,n,c,r))?{what:'server-only'}:null;

test('truth guard: pauses are time-bounded, so the estimate can never hold a walker for good', ()=>{
 const g=new TruthGuard();
 for(const n of [1,2,3,5,10,40]){const h=new TruthGuard();h.update(n,0);const s=h.pauseSeconds(0);
  assert.ok(s>=0&&s<=h.hardPauseSeconds,`${n} corrections: ${s} s`);
  if(n*100<=h.pauseAbove)assert.equal(s,0);else{assert.ok(h.estimate(s)<=Math.max(h.safeResume,n*100-h.hardPauseSeconds*h.decayPerSecond)+1e-9,`${n}: resumes at ${h.estimate(s)}`);}
  assert.equal(h.estimate(n*100/h.decayPerSecond),0,'the estimate decays to nothing with time alone');}
 // Run two-c: three corrections at 101.9, 107.7 and 109.6 s. The old guard (resume under 50, no cap) stood 42 s.
 g.update(1,101.9);g.update(2,107.7);g.update(3,109.6);assert.ok(Math.abs(g.estimate(109.6)-261.5)<0.01);
 const s=g.pauseSeconds(109.6);assert.ok(Math.abs(s-32.3)<0.01,'stands until the safe line (100), not 50: '+s);
 assert.ok(g.estimate(109.6+s)<=g.safeResume+1e-9);
 const low=new TruthGuard();low.update(2,0);assert.equal(low.pauseSeconds(0),20,'200 -> 100: the 20 s cap, not 30 s to 50');
 // A counter that starts over (a fresh FrameLog) does not swallow the next corrections.
 const r=new TruthGuard();r.update(5,0);assert.equal(r.update(1,100),0);assert.equal(r.update(2,101),1);
});

test('FrameLog: a late-dropped move (ReadClientMove after RPCVerificationLate) costs no violation; lateS is kept for the replay', ()=>{
 let now=0;const log=new FrameLog({now:()=>now}),rx=e=>log.add(JSON.stringify(e),'rx');
 rx({type:'create',viewId:20,prefab:':player_soldier',owner:1,mine:true,position:[0,400,0]});
 now=100;rx({type:'rpc',viewId:20,name:'ReadClientMove',args:{class:'HumanController',values:[[0,400,0],0,0,0.06]}});
 now=200;rx({type:'rpc',viewId:20,name:'ReadClientMove',args:{class:'HumanController',values:[[0,400,0],0,0,1.7]}});
 now=300;rx({type:'rpc',viewId:20,name:'UnstickMove',args:{class:'HumanController',values:[[5,400,0]]}});
 assert.equal(log.correctionCount,3);assert.equal(log.truthCorrectionCount,1,'only the TruthDetector rollback counts');
 assert.deepEqual(log.moveLog.filter(m=>m.correction).map(m=>m.lateS??null),[0.06,1.7,null]);
 assert.equal(lateDrop({name:'ReadClientMove',values:[[0,0,0],0,0,0.9]}),false,'normal transit time');
});

test('same path test helper', ()=>{
 assert.ok(samePath([[0,0,0],[10,0,0],[20,0,0]],[[0.5,0,0],[10,0,0.5],[20,0,0],[99,0,0]]));
 assert.ok(!samePath([[0,0,0],[10,0,0]],[[0,0,0],[10,0,5]]));
});

// A body that never moves (a dead-still character the page still reports, or a block nothing gets round): every
// stuck re-plan comes from the same spot.
function stillBody(at,{dead=()=>false}={}){let t=0;return {now:()=>t,async sleep(ms){t+=ms;},async feet(){return at;},async status(){return dead(t)?{dead:true,health:0,reason:'TODO: Handle this death condition Wolf(Clone) (Character)'}:{dead:false,health:100};},
 async aim(){},async keys(){},async release(){},async corrections(){return 0;}};}

test('a same-path re-plan loop is broken: the spot is marked blocked and the next plan detours round it', {skip:!have}, async()=>{
 const {island}=await lazy();
 const ev=await walkMeetCore(stillBody(STUCK),async()=>RUN_GOAL,{island,ms:30000});
 assert.ok(ev.samePath>=1,'the stuck re-plan from the same place returned the same path: '+JSON.stringify(ev.plans.map(p=>[p.at,p.why,p.length])));
 assert.ok(ev.detours.length>=1,'and the walker was sent round the blocked spot');
 const first=ev.plans.find(p=>p.detour!=null&&p.detour!=='none');assert.ok(first,'a plan with a detour');
 assert.ok(Math.abs(first.detour)>=4);
 // A still body is not dead: it stops on time, not with a death.
 assert.equal(ev.died,null);assert.match(ev.why,/out of time/);
});

test('a walker that dies on the way stops at once with the death reason (run two-c walked a dead target for 230 s)', {skip:!have}, async()=>{
 const {island}=await lazy();
 const ev=await walkMeetCore(stillBody(STUCK,{dead:t=>t>=69000}),async()=>RUN_GOAL,{island});
 assert.ok(ev.died,'death reported');assert.ok(ev.ms<72000,`stopped after ${ev.ms} ms`);
 assert.match(ev.why,/died after \d+ s: TODO: Handle this death condition Wolf/);assert.equal(ev.arrived,false);
});

test('run two-c stuck spot, offline: the port motor walks on from where the target stood and reaches the player', {skip:!have}, async()=>{
 const {island,world,simBody}=await lazy();
 const s=simBody(world,STUCK);
 const ev=await walkMeetCore(s.body,async()=>RUN_GOAL,{island});
 assert.ok(ev.arrived,JSON.stringify({why:ev.why,left:ev.distanceLeft,blocks:ev.blocks}));
 assert.equal(s.kicked,null);assert.equal(s.td.peak,0,'nothing on the port world stops the trace');
 assert.ok(ev.ms<ev.budgetMs,`${ev.ms} ms of ${ev.budgetMs}`);
});

test('run two-c with server-only posts where its three corrections were: back off, step aside, no kick, reaches the player', {skip:!have}, async()=>{
 const {island,world,simBody}=await lazy();
 // The rejected moves: 6419.4 -> 6418.1 (z -3651.9), 6389.9 -> 6388.3 (z -3652.7..-3653.1), 6388.7 -> 6387.4 (z -3651.4..-3651.9).
 const s=simBody(world,BEFORE,{serverOnly:posts([[[6418.7,-3651.93],0.5],[[6387.8,-3652.5],1.5]])});
 const ev=await walkMeetCore(s.body,async()=>RUN_GOAL,{island});
 assert.ok(ev.arrived,JSON.stringify({why:ev.why,left:ev.distanceLeft,blocks:ev.blocks}));
 assert.equal(s.kicked,null);assert.ok(s.td.peak<300,'peak '+s.td.peak);
 assert.ok(ev.truth?.corrections>=1,'the server-only post was met');
 assert.ok(ev.blocks.some(b=>b.kind==='correction'));
});

test('a 14 m server-only wall across the path: repeated corrections make the walker go round it without a kick', {skip:!have}, async()=>{
 const {island,world,simBody,planWalk,distXZ}=await lazy();
 const p=planWalk(island,STUCK,RUN_GOAL);let run=0,prev=STUCK,at=null,dir=null;
 for(const w of p.waypoints){const L=distXZ(prev,w);if(run+L>=40){const f=(40-run)/L;at=[prev[0]+(w[0]-prev[0])*f,prev[2]+(w[2]-prev[2])*f];dir=[(w[0]-prev[0])/L,(w[2]-prev[2])/L];break;}run+=L;prev=w;}
 const a=[at[0]+dir[1]*7,-(at[1]-dir[0]*7)],b=[at[0]-dir[1]*7,-(at[1]+dir[0]*7)]; // Unity xz ends of the wall
 const side=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
 const wall=(o,n)=>{const A=[o[0],o[2]],B=[n[0],n[2]];return side(a,b,A)*side(a,b,B)<0&&side(A,B,a)*side(A,B,b)<0?{what:'server wall'}:null;};
 const s=simBody(world,STUCK,{serverOnly:wall});
 const ev=await walkMeetCore(s.body,async()=>RUN_GOAL,{island});
 assert.ok(ev.arrived,JSON.stringify({why:ev.why,left:ev.distanceLeft,blocks:ev.blocks,detours:ev.detours}));
 assert.equal(s.kicked,null);assert.ok(s.td.peak<300,'peak '+s.td.peak);assert.ok(ev.detours.length>=1);
});

test('a rock the navmesh was baked through (port world only): stuck, same spot again, then a detour round it', {skip:!have}, async()=>{
 const {island,world,simBody,addPortBox,planWalk,distXZ}=await lazy();
 const p=planWalk(island,STUCK,RUN_GOAL);let run=0,prev=STUCK,at=null,dir=null;
 for(const w of p.waypoints){const L=distXZ(prev,w);if(run+L>=40){const f=(40-run)/L;at=[prev[0]+(w[0]-prev[0])*f,0,prev[2]+(w[2]-prev[2])*f];dir=[(w[0]-prev[0])/L,(w[2]-prev[2])/L];break;}run+=L;prev=w;}
 at[1]=island.ground(at[0],at[2]);
 const box=addPortBox(world,at,[14,30,1.2],Math.atan2(dir[0],dir[1]));
 try{const s=simBody(world,STUCK);const ev=await walkMeetCore(s.body,async()=>RUN_GOAL,{island});
  assert.ok(ev.arrived,JSON.stringify({why:ev.why,left:ev.distanceLeft,blocks:ev.blocks}));
  assert.ok(ev.stuck>=2&&ev.stuck<=8,'stuck '+ev.stuck);assert.ok(ev.detours.length>=1,'went round');
  assert.equal(s.kicked,null);}
 finally{box.remove();}
});

test('detour planning: avoided navmesh polygons are left out of the A* corridor', {skip:!have}, async()=>{
 const {island,planWalk,polyAt}=await lazy();
 const base=planWalk(island,STUCK,RUN_GOAL),poly=base.corridor[Math.floor(base.corridor.length/2)];
 assert.ok(base.ok&&poly!=null&&polyAt(island,STUCK)!==poly);
 const r=planWalk(island,STUCK,RUN_GOAL,{avoid:new Set([poly])});
 assert.ok(r.ok&&!r.partial,r.why);assert.ok(!r.corridor.includes(poly),'the corridor leaves the avoided polygon out');
 assert.ok(r.length>=base.length-0.5,'and is no shorter');
});
