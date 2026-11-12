// The island terrain surface as the original's (GAP-AUDIT T4). Unity's terrain splits each heightmap cell along the
// (x,z)-(x+1,z+1) diagonal and normalises the int16 samples by 32766; the port split cells along the other diagonal
// and divided by 32767, so on convex cells its ground lay under the server's TerrainCollider (1.35 m mid-cell at the first spot below). In the
// 2026-10-23 real run two-e (analysis/native-runs/2026-10-23-gameplay-real-two-e, row mixed.move) the original server
// rolled the walking target back 20 times (ReadClientMove with a normal 33-76 ms transit time, so TruthDetector
// blocked traces, not VerifyRPC late drops), 8 of them at Unity [6390, 430, -3730] (plus one higher on that slope) and 8 at [5002, 428, -3583]: its
// Physics.Raycast from 0.5 m above the last accepted point (mask 538444803, which includes the terrain layer 19) went
// into the real terrain, while the port's motor walked on its lower surface. The segments below are the target's
// recorded moves there (Unity space): [accepted start, accepted end = blocked start, blocked end].
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cellHeight,sampleTriangle,worldToGrid,makeTerrain} from '../browser/terrain.mjs';
import {present} from './helpers/assets.mjs';

const REC=new URL('../browser/assets/recovered/',import.meta.url);
const have=present(new URL('manifest.json',REC))&&present(new URL('trees.json',REC));
const haveWorld=have&&present(new URL('rockspawn/manifest.json',REC))&&present(new URL('navmesh/manifest.json',REC));
const SPOT_6390=[
 [[6391.1256,429.2439,-3732.2703],[6390.2112,429.8491,-3732.0534],[6389.0774,430.4051,-3731.8331]],
 [[6390.9765,429.6382,-3729.7647],[6390.2025,430.112,-3729.7282],[6389.0394,430.6632,-3729.6751]],
 [[6390.8927,429.7036,-3729.7594],[6390.2167,430.1055,-3729.7266],[6389.0737,430.6475,-3729.6711]],
 [[6390.8361,429.7477,-3729.7566],[6390.079,430.1708,-3729.7199],[6388.9246,430.7182,-3729.6638]],
 [[6390.7878,429.7853,-3729.7544],[6390.0418,430.1885,-3729.7182],[6388.8988,430.7305,-3729.6627]],
 [[6390.6472,429.8948,-3729.7476],[6389.7564,430.3238,-3729.7044],[6388.597,430.8736,-3729.6481]],
 [[6390.4344,430.0023,-3729.7373],[6389.6216,430.3877,-3729.6978],[6388.4786,430.9297,-3729.6423]],
 [[6389.3654,430.8143,-3726.9446],[6388.2338,431.2619,-3727.6887],[6387.1056,431.7058,-3728.4524]],
 [[6371.7571,435.7237,-3750.7984],[6372.01,435.7275,-3749.2535],[6372.114,435.5195,-3747.5359]],
];
const SPOT_5002=[
 [[5000.8,428.0391,-3582.6187],[5002.0969,427.6515,-3581.6462],[5003.4028,427.4579,-3580.6668]],
 [[5001.4617,427.8252,-3582.2951],[5001.8953,427.6109,-3582.8734],[5002.3555,427.3835,-3583.487]],
 [[5001.8955,427.6108,-3582.8735],[5001.9577,427.5861,-3582.892],[5002.6407,427.3149,-3583.095]],
 [[5001.2251,427.8769,-3582.6745],[5001.5534,427.7814,-3582.4007],[5002.5156,427.5015,-3581.5982]],
 [[5000.9911,427.9451,-3582.8695],[5001.7603,427.7212,-3582.228],[5002.9192,427.3841,-3581.2615]],
 [[5001.0781,427.9197,-3582.7969],[5001.2781,427.8615,-3582.6302],[5002.1416,427.6103,-3581.91]],
 [[5000.788,427.9852,-3583.2408],[5001.7633,427.5987,-3583.523],[5003.1662,427.0428,-3583.9288]],
 [[5001.1128,427.8661,-3583.2325],[5001.8253,427.6656,-3582.5659],[5002.9244,427.3563,-3581.5375]],
];
// The port's former surface (other diagonal, samples / 32767), for showing what the server saw.
const oldCell=(a,b,c,d,u,v)=>u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
const terrain=have?(()=>{const m=JSON.parse(readFileSync(new URL('manifest.json',REC),'utf8')),b=readFileSync(new URL(m.heightFile,REC));return {m,h:new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))};})():null;
// Browser-space (x, z), like LineOfSight.ground.
const oldGround=(x,z)=>{const {m,h}=terrain,[gx,gz]=worldToGrid(x,z,m.extent,m.size-1),cx=Math.min(m.size-2,Math.floor(gx)),cz=Math.min(m.size-2,Math.floor(gz));
 return oldCell(h[cz*m.size+cx],h[cz*m.size+cx+1],h[(cz+1)*m.size+cx],h[(cz+1)*m.size+cx+1],gx-cx,gz-cz)*32766/32767;};

test('a heightmap cell is split along the (x,z)-(x+1,z+1) diagonal, as Unity\'s terrain', ()=>{
 // a (x,z)=0, b (x+1,z)=0, c (x,z+1)=0, d (x+1,z+1)=10: the diagonal a-d is a crease, b and c are on flat triangles.
 const h=new Float32Array([0,0,0,10]);
 assert.equal(sampleTriangle(h,2,0.5,0.5),5);
 assert.equal(sampleTriangle(h,2,0.75,0.25),2.5);assert.equal(sampleTriangle(h,2,0.25,0.75),2.5);
 assert.equal(sampleTriangle(h,2,1,0),0);assert.equal(sampleTriangle(h,2,0,1),0);assert.equal(sampleTriangle(h,2,1,1),10);
 assert.equal(cellHeight(1,2,3,4,0,0),1);assert.equal(cellHeight(1,2,3,4,1,0),2);assert.equal(cellHeight(1,2,3,4,0,1),3);assert.equal(cellHeight(1,2,3,4,1,1),4);
 // the drawn mesh uses the same split (and keeps its upward winding)
 const t=makeTerrain(new Float32Array(9),3,1);assert.deepEqual(t.indices.slice(0,6),[0,1,4,0,4,3]);
});

test('every terrain tree (placed on Unity\'s interpolated height) sits on the recovered surface to 1 mm', {skip:!have}, ()=>{
 const m=JSON.parse(readFileSync(new URL('manifest.json',REC),'utf8')),b=readFileSync(new URL(m.heightFile,REC)),h=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 const trees=JSON.parse(readFileSync(new URL('trees.json',REC),'utf8'));let worst=0,worstOld=0;
 for(const t of trees){const [gx,gz]=worldToGrid(t[0],t[2],m.extent,m.size-1);worst=Math.max(worst,Math.abs(sampleTriangle(h,m.size,gx,gz)-t[1]));
  const x=Math.min(m.size-2,Math.floor(gx)),z=Math.min(m.size-2,Math.floor(gz));worstOld=Math.max(worstOld,Math.abs(oldCell(h[z*m.size+x],h[z*m.size+x+1],h[(z+1)*m.size+x],h[(z+1)*m.size+x+1],gx-x,gz-z)-t[1]));}
 assert.ok(worst<0.001,`worst tree ${worst} m`);assert.ok(worstOld>1,`the other diagonal misses trees by ${worstOld} m`);
 assert.ok(m.heightValidation.maxMetres<0.001,'the exporter validates the same');
});

test('run two-e: the gateway\'s TruthDetector trace now blocks the server\'s rolled-back moves at [6390, 430, -3730] and [5002, 428, -3583], and only those', {skip:!haveWorld}, async()=>{
 const [{loadLineOfSight,TRUTH_MASK},{losTrace}]=await Promise.all([import('../bridge/line-of-sight.mjs'),import('../tools/truth-detector.mjs')]);
 const los=await loadLineOfSight(fileURLToPath(REC)),trace=losTrace(los,TRUTH_MASK);
 for(const [accepted,from,to] of [...SPOT_6390,...SPOT_5002]){
  assert.equal(trace(accepted,from),null,`accepted ${JSON.stringify(accepted)} -> ${JSON.stringify(from)}`);
  const hit=trace(from,to);assert.equal(hit?.what,'terrain',`blocked ${JSON.stringify(from)} -> ${JSON.stringify(to)}: ${JSON.stringify(hit)}`);
  // the target's feet were on the port's former surface, under the server's: its moves started inside the real terrain
  assert.ok(Math.abs(from[1]-oldGround(from[0],-from[2]))<0.002,'feet on the former surface');
  assert.ok(from[1]<los.ground(from[0],-from[2])+0.002,'at or under the server surface');
 }
});

// The port's motor on the corrected world walks those lines on the server's surface: at the server send rate, the
// TruthDetector model blocks none of its moves. On the former surface it sent moves the server rolls back.
test('run two-e spots: the port motor walking up the [6390, 430] slope and across [5002, 428] sends no move TruthDetector blocks', {skip:!haveWorld}, async()=>{
 const {loadSimWorld,simBody}=await import('../tools/native/walk-sim.mjs');
 const sim=await loadSimWorld(),world=sim.los.world,ground=world.ground;
 // Unity [start, through] lines the target walked before its rollbacks (browser space = Unity x, y, -z).
 const walks=[{start:[6396.421,424.967,-3733.89],through:[6389.04,430.66,-3729.68]},{start:[6390.98,429.64,-3729.76],through:[6386.5,432.1,-3729.6]},
  {start:[4994.169,428.685,-3587.592],through:[5003.4,427.46,-3580.67]},{start:[5000.79,427.99,-3583.24],through:[5004.5,426.6,-3584.3]}];
 const walk=async({start,through})=>{const s=simBody(sim,[start[0],start[1],-start[2]]);const goal=[through[0],through[1],-through[2]];
  await s.body.aim(goal);await s.body.keys(['KeyW','ShiftLeft']); // the harness walker sprints
  let f=null;for(let i=0;i<60;i++){await s.body.sleep(100);f=await s.body.feet();if(!f)break;await s.body.aim(goal);if(Math.hypot(f[0]-goal[0],f[2]-goal[2])<0.6)break;}
  return {blocked:s.td.events.filter(e=>e.blocked).length,kicked:s.kicked,left:f?Math.hypot(f[0]-goal[0],f[2]-goal[2]):null,moves:s.stats.moves};};
 try{
  for(const w of walks){const r=await walk(w);assert.equal(r.blocked,0,`${JSON.stringify(w)}: ${JSON.stringify(r)}`);assert.equal(r.kicked,null);assert.ok(r.left<1,`reached ${JSON.stringify(w.through)}: ${JSON.stringify(r)}`);}
  world.ground=oldGround;const before=[];for(const w of walks)before.push(await walk(w));
  assert.ok(before.reduce((n,r)=>n+r.blocked,0)>=2,`the former surface sends moves the server's terrain blocks: ${JSON.stringify(before)}`);
 }finally{world.ground=ground;}
});
