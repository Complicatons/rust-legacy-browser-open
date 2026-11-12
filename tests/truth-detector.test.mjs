// The original server's TruthDetector as a model (tools/truth-detector.mjs, decompiled TruthDetector.cs/truth.cs), the
// harness walkers' guard against its kick (tools/native/truth-guard.mjs), the move streams check-native now keeps for an
// offline replay, the replay's segment length, and the spawn-point marker boxes the original destroys on Awake.
// The 2026-10-23 run-two kick: "[NetUser|NativeTarget|…|35] kicked for violation 592" = six blocked traces (600)
// less eight accepted moves, while the old straight-line walkTo kept pressing the line the server rolled it back from.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Matrix4,Ray,Vector3} from 'three';
import {TruthDetector,losTrace,replayMoves,TRUTH_THRESHOLD} from '../tools/truth-detector.mjs';
import {TruthGuard} from '../tools/native/truth-guard.mjs';
import {FrameLog} from '../tools/native/lib.mjs';
import {replayStream} from '../tools/replay-truth-trace.mjs';
import {LineOfSight,TRUTH_MASK} from '../bridge/line-of-sight.mjs';
import {CollisionWorld,isSpawnMarker} from '../browser/collision.mjs';
import {present} from './helpers/assets.mjs';

const SEND=0.2; // NetCull.sendInterval at server.sendRate 5
test('TruthDetector rules: speed over 20 m/s (100 down) between stamps, a blocked trace adds 100 and rolls back, kick above 400', ()=>{
 const td=new TruthDetector();td.noteTeleported([0,0,0]);
 assert.equal(td.noteMoved([0,0,0],10).action,'none','first move after a teleport is only recorded');
 td.noteMoved([2,0,0],10.25);assert.equal(td.violation,0,'8 m/s sprint');
 td.noteMoved([2.5,0,0],10.25+1/1024);assert.equal(td.violation,511,'0.5 m in 1/1024 s adds 512, then one less');
 const down=new TruthDetector();down.noteTeleported([0,10,0]);down.noteMoved([0,10,0],1);down.noteMoved([0,0,0],1.2);assert.equal(down.violation,0,'falling 50 m/s is under the 100 m/s limit');
 // The trace: the move is not accepted (no decrement, no kick check) and the player is put back.
 const wall=new TruthDetector({trace:(o,n)=>o[0]<5&&n[0]>=5?{what:'wall'}:null});wall.noteTeleported([0,0,0]);
 let t=1;for(let x=0;x<=4;x+=1)wall.noteMoved([x,0,0],t+=SEND);
 const r=wall.noteMoved([5.5,0,0],t+=SEND);assert.equal(r.action,'moved');assert.deepEqual(r.pos,[4,0,0]);assert.equal(wall.violation,100);
 // A small blocked step (< 0.5 m) rolls back to the newest snapshot it can leave.
 const small=wall.noteMoved([5.2,0,0],t+=SEND);assert.equal(small.action,'moved');assert.equal(wall.violation,200);
 // NoteTeleported (a respawn) keeps the violation; it only decays per accepted move.
 wall.noteTeleported([100,0,0]);wall.noteMoved([100,0,0],t+=SEND);wall.noteMoved([101,0,0],t+=SEND);assert.equal(wall.violation,198);
 assert.equal(TRUTH_THRESHOLD,400);
});

test('regression: six blocked traces and eight accepted moves kick "for violation 592" (the run-two kick)', ()=>{
 // (The first move after the spawn is only recorded.) Four blocked moves, seven accepted ones (stepping back and in again), two more blocked: the next accepted move kicks.
 const pattern='ABBBBAAAAAAABBA',blocked=new Set();let x=0;const moves=[];
 for(const [i,c] of [...pattern].entries()){x+=c==='B'?1:0.3;moves.push({t:(1+i*SEND)*1000,origin:[x,0,0]});if(c==='B')blocked.add(x);}
 const out=replayMoves(moves.map(m=>({...m,t:m.t/1000})),{trace:(o,n)=>blocked.has(n[0])?{what:'server-only'}:null});
 assert.deepEqual(out.kicked&&{violation:out.kicked.violation},{violation:592});
 assert.equal(out.events.filter(e=>e.blocked).length,6);
});

// A post the server has on the walker's line and the port's world does not; corrections reach the client one round
// trip later (it keeps sending from beyond the post meanwhile). The old walkTo walked straight at the target again.
function walkThroughPost({guard=null,rtt=0.15,seconds=40}={}){
 const post={x:20,z:0,r:0.45};
 const trace=(o,n)=>{const bx=n[0]-o[0],bz=n[2]-o[2],L2=bx*bx+bz*bz;if(L2<1e-9)return null;let t=((post.x-o[0])*bx+(post.z-o[2])*bz)/L2;t=Math.max(0,Math.min(1,t));
  return Math.hypot(o[0]+bx*t-post.x,o[2]+bz*t-post.z)<post.r?{what:'post'}:null;};
 const td=new TruthDetector({trace});td.noteTeleported([0,0,0.1]);
 let p=[0,0,0.1],t=0,next=0,pending=[],corrections=0,aside=0,pauseUntil=0;const dt=1/60;
 while(t<seconds&&p[0]<40){t+=dt;
  for(const c of pending.filter(c=>c.at<=t)){p=[...c.pos];corrections++;}pending=pending.filter(c=>c.at>t);
  if(guard&&guard.update(corrections,t)){aside=0.7;if(guard.mustPause(t))pauseUntil=t+guard.pauseSeconds(t);}
  if(t<pauseUntil){}else if(aside>0){aside-=dt;p[2]+=4*dt;}else p[0]+=8*dt; // strafe 4 m/s, sprint 8 m/s
  if(t>=next){next+=SEND;const r=td.noteMoved([...p],100+t);if(r.action==='kicked')break;if(r.action==='moved')pending.push({at:t+rtt,pos:r.pos});}
 }
 return {kicked:td.kicked,peak:td.peak,x:p[0],corrections};
}
test('walker guard: after a server correction step aside (and wait out a high estimate) instead of walking the line again', ()=>{
 const old=walkThroughPost();assert.ok(old.kicked,'pressing on through the post kicks: '+JSON.stringify(old));
 for(const rtt of [0.1,0.15,0.25,0.4]){const r=walkThroughPost({guard:new TruthGuard(),rtt,seconds:120});
  assert.equal(r.kicked,null,`rtt ${rtt}: ${JSON.stringify(r)}`);assert.ok(r.peak<=300,`peak ${r.peak}`);assert.ok(r.x>=40,`walked past the post at rtt ${rtt}`);}
 // The estimate: +100 per correction, five less per second (one per accepted move at sendRate 5).
 const g=new TruthGuard();assert.equal(g.update(3,0),3);assert.equal(g.estimate(0),300);assert.equal(g.estimate(10),250);
 assert.ok(g.mustPause(10));assert.equal(g.pauseSeconds(10),30,'to the safe line (100): 30 s, capped at 20 s only when that is enough');assert.equal(g.update(3,10),0);assert.ok(g.mayResume(60));
});

test('a representative sprint (1.9 km at 5 Hz over hills, stamps on the browser clock) stays at violation 0', ()=>{
 const moves=[];let x=0,z=0;for(let i=0;i<1200;i++){x+=1.6*Math.cos(i/90);z+=1.6*Math.sin(i/90);moves.push({t:10+i*SEND+(i%7)*0.004,origin:[x,400+12*Math.sin(x/60)+5*Math.cos(z/45),z]});}
 const out=replayMoves(moves);assert.equal(out.peak,0);assert.equal(out.kicked,null);
});

test('replay: only hits inside the moved segment count', ()=>{
 const world=new CollisionWorld(null);world.addBox([4,4,4],[30,10,0],new Matrix4());world.build();
 const los=new LineOfSight({world,staticLayers:[0],ground:()=>0}),trace=losTrace(los,TRUTH_MASK);
 assert.equal(trace([0,10,0],[1.6,10,0]),null,'a 1.6 m step 27 m short of the box is clear');
 assert.equal(trace([26,10,0],[29,10,0])?.what,'world','a step into the box is blocked');
 const ridge=losTrace(new LineOfSight({world,staticLayers:[0],ground:x=>x>0.2&&x<1.4?11:0}),TRUTH_MASK);
 assert.equal(ridge([0,10,0],[1.6,10,0])?.what,'terrain','a terrain ridge 0.5 m above the feet line blocks');
});

// The old tools/replay-truth-trace.mjs counted world.rayHit(ray, len) as blocked whatever its distance; on the island
// the static octree returns hits far past the step (here 23 m on a 1.7 m step east of spawn 3), so replays reported
// "static scene" blocks the server never saw.
const recovered=new URL('../browser/assets/recovered/',import.meta.url);
test('replay regression: a real-island static hit past the step is not a blocked trace', {skip:!present(new URL('scene/manifest.json',recovered))}, async()=>{
 const {loadLineOfSight}=await import('../bridge/line-of-sight.mjs');const los=await loadLineOfSight(fileURLToPath(recovered),{trees:false});
 const o=[6131.952734830846,374.8096452013546,-3597.096081560753],n=[6130.2371717308215,374.8009471700643,-3596.8486708929413];
 const a=new Vector3(o[0],o[1]+0.5,-o[2]),d=new Vector3(n[0]-o[0],n[1]-o[1],o[2]-n[2]),len=d.length();
 const raw=los.world.rayHit(new Ray(a,d.normalize()),len,b=>b?!((TRUTH_MASK>>>b.layer)&1):(TRUTH_MASK&los.staticMask)===0);
 assert.ok(raw&&raw.distance>len,'the octree hit lies past the step: '+raw.distance);
 assert.equal(losTrace(los,TRUTH_MASK)(o,n),null);
});

test('FrameLog keeps the move stream across a kick for the replay (sent moves, spawns, corrections, the disconnect)', ()=>{
 let now=0;const log=new FrameLog({now:()=>now}),rx=e=>log.add(JSON.stringify(e),'rx'),tx=e=>log.add(JSON.stringify(e),'tx');
 rx({type:'approved',playerId:1,world:{sendRate:5}});
 now=1000;rx({type:'create',viewId:20,prefab:':player_soldier',owner:1,mine:true,position:[0,400,0]});
 now=1200;tx({type:'move',origin:[0,400,0],angles:{yaw:0,pitch:0},stateFlags:0,at:1190});
 now=1400;tx({type:'move',origin:[1.6,400,0],angles:{yaw:0,pitch:0},stateFlags:0,at:1390});
 now=1500;rx({type:'rpc',viewId:20,name:'ReadClientMove',args:{class:'HumanController',values:[[0,400,0],0,0,0.05]}});
 now=1600;rx({type:'disconnected',reason:'Kicked because of violation'});
 assert.deepEqual(log.moveLog.map(m=>Object.keys(m).find(k=>['spawn','correction','end'].includes(k))??'move'),['spawn','move','move','correction','end']);
 assert.equal(log.moveLog[1].at,1190);assert.equal(log.correctionCount,1);
 const r=replayStream(log.moveLog,()=>null);assert.equal(r.moves,2);assert.equal(r.serverCorrections,1);assert.equal(r.peak,0);assert.equal(r.end.end,'disconnected');
});

const sceneUrl=new URL('../browser/assets/recovered/scene/manifest.json',import.meta.url);
test('spawn-point marker cubes are left out (SpawnManager.InstallSpawns destroys the spawn children on Awake)', {skip:!present(sceneUrl)}, async()=>{
 const scene=JSON.parse(await readFile(sceneUrl)),sp=scene.world.spawnPoints;
 const markers=scene.colliders.filter(c=>isSpawnMarker(c,sp));assert.equal(markers.length,sp.length);
 assert.ok(markers.every(c=>c.layer===0&&c.size.join()==='1,1,1'));
 assert.equal(scene.colliders.filter(c=>c.name==='Cube'&&!isSpawnMarker(c,sp)).length,scene.colliders.filter(c=>c.name==='Cube').length-sp.length);
});
