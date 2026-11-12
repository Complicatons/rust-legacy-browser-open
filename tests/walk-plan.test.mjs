import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {loadIsland,planWalk,pathProfile,nextWaypoint,remaining,offLeg,distXZ} from '../tools/native/walk-plan.mjs';
import {present} from './helpers/assets.mjs';

const MOCK_SPAWN_BROWSER=[5244.1,368,4839.6]; // tools/native/mock.mjs MOCK_SPAWN (Unity z -4839.6)
const have=present(new URL('../browser/assets/recovered/navmesh/manifest.json',import.meta.url));

test('waypoint stepping: reached and passed waypoints are skipped, the distance left follows the legs', ()=>{
 const wp=[[10,0,0],[20,0,0],[20,0,10],[20,0,30]];
 assert.equal(nextWaypoint(wp,0,[0,0,0]),0);
 assert.equal(nextWaypoint(wp,0,[8,0,0]),1,'within reach of the first');
 assert.equal(nextWaypoint(wp,1,[21,0,1]),2,'cut the corner: past the second');
 assert.equal(nextWaypoint(wp,2,[20,0,29]),3,'the last one is never skipped');
 assert.equal(nextWaypoint(wp,3,[50,0,50]),3);
 assert.equal(remaining(wp,1,[15,0,0]),5+10+20);
 assert.equal(offLeg([0,0,0],[10,0,0],[5,0,3]),3);
 assert.equal(offLeg([0,0,0],[10,0,0],[14,0,3]),5);
});

test('walk-to-meet plans across the real island between spawn points 500-1900 m apart', {skip:!have}, async()=>{
 const island=await loadIsland();
 assert.equal(island.slopeLimit,65,'CCMotor slopeLimit from player.json');
 const sp=island.spawnPoints;assert.ok(sp.length>=50,'original spawn points');
 const far=sp.map(s=>({s,d:distXZ(s,MOCK_SPAWN_BROWSER)})).filter(x=>x.d>=500&&x.d<=1900).sort((a,b)=>a.d-b.d);
 assert.ok(far.length>=5);
 for(const {s,d} of [far[0],far[Math.floor(far.length/2)],far.at(-1)]){
  const t=Date.now(),r=planWalk(island,s,MOCK_SPAWN_BROWSER);
  assert.ok(r.ok,r.why);assert.equal(r.partial,false,'full path');assert.ok(r.endGap<1,`ends at the target (${r.endGap} m)`);
  assert.ok(Date.now()-t<2000,'plans in under 2 s');
  assert.ok(r.length>=d-1&&r.length<d*1.6,`length ${r.length} for ${Math.round(d)} m straight`);
  assert.equal(r.profile.wet,0,'stays above the water line');assert.ok(r.profile.minClearance>5);
  assert.ok(r.profile.maxSlope<=island.slopeLimit,`steepest ${r.profile.maxSlope}°`);
  assert.ok(r.profile.steepSamples<=0.01*r.length/2,`${r.profile.steepSamples} samples over 45°`);
  // Short legs to re-aim at, each on walkable ground: the terrain or the navmesh surface (some corners lie on scene
  // geometry a few metres above the terrain, e.g. rocks and building floors the agent was baked to walk over).
  for(let i=1;i<r.waypoints.length;i++)assert.ok(distXZ(r.waypoints[i-1],r.waypoints[i])<=20.01);
  for(const w of r.waypoints)assert.ok(Math.abs(w[1]-island.ground(w[0],w[2]))<3||island.nav.groundAt({x:w[0],y:w[1],z:-w[2]},1,1),`waypoint ${w.map(Math.round)} on walkable ground`);
  assert.ok(distXZ(r.waypoints[0],s)<=20.01);
 }
});

test('the planned path goes round water and cliffs that the straight line crosses', {skip:!have}, async()=>{
 const island=await loadIsland(),sp=island.spawnPoints;
 let wet=null,steep=null;
 for(let i=0;i<sp.length&&!(wet&&steep);i++)for(let j=i+1;j<sp.length;j++){const d=distXZ(sp[i],sp[j]);if(d<300||d>2000)continue;
  const st=pathProfile(island,[sp[i],sp[j]]);if(!wet&&st.wet)wet=[sp[i],sp[j]];if(!steep&&st.maxSlope>island.slopeLimit)steep=[sp[i],sp[j]];}
 assert.ok(wet&&steep,'the island has spawn pairs across water and across a cliff');
 for(const [a,b] of [wet,steep]){const r=planWalk(island,a,b);
  assert.ok(r.ok&&!r.partial,r.why);assert.equal(r.profile.wet,0);assert.ok(r.profile.maxSlope<=island.slopeLimit,`${r.profile.maxSlope}°`);assert.ok(r.endGap<1);}
});

test('every pair of original spawn points has a walkable path', {skip:!have}, async()=>{
 const island=await loadIsland(),sp=island.spawnPoints,bad=[];
 for(let i=0;i<sp.length;i+=3)for(let j=i+1;j<sp.length;j+=2){const r=planWalk(island,sp[i],sp[j]);if(!r.ok||r.partial||r.endGap>2)bad.push([i,j,r.why??(r.partial?'partial':'end '+r.endGap)]);}
 assert.deepEqual(bad,[]);
});

test('positions far from the navmesh are refused with a reason', {skip:!have}, async()=>{
 const island=await loadIsland(),r=planWalk(island,[0,0,0],MOCK_SPAWN_BROWSER);
 assert.equal(r.ok,false);assert.match(r.why,/walker .* more than 30 m from the navmesh/);
});
