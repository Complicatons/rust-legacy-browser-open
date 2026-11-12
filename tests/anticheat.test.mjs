// Gateway anti-cheat detector (bridge/anticheat.mjs) with a controllable clock. Limits are the recovered values.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PlayerWatch,DEFAULT_LIMITS,limitsFromPlayerConfig,weaponsFromItems,arrowPath} from '../bridge/anticheat.mjs';
import {LineOfSight,BULLET_MASK,TRUTH_MASK,structureShapes,loadLineOfSight} from '../bridge/line-of-sight.mjs';
import {CollisionWorld,MovingBody} from '../browser/collision.mjs';
import {Matrix4} from 'three';
import {needsAssets} from './helpers/assets.mjs';

const M4=-1852181914,SHOTGUN=1377786400,BOLT=545958908;
const WEAPONS=new Map([[M4,{name:'M4',fireRate:0.125,range:140,pellets:1,clip:24}],[SHOTGUN,{name:'Shotgun',fireRate:1.5,range:30,pellets:12,clip:8}],[BOLT,{name:'Bolt Action Rifle',fireRate:2.2,range:250,pellets:1,clip:3}]]);
function watch(opts={}){
 const clock={t:100,wall:1_800_000_000_000};
 const w=new PlayerWatch({subject:'s',name:'n',playerId:1,weapons:WEAPONS,now:()=>clock.t,wallNow:()=>clock.wall,...opts});
 w.observe({type:'create',viewId:20,mine:true,prefab:':player_soldier',position:[0,10,0]});
 clock.t+=3; // past the spawn grace
 return {w,clock};
}
const itemData=uid=>{const b=new Uint8Array(6),v=new DataView(b.buffer);v.setUint16(0,20,true);v.setInt32(2,uid,true);return b;};
const equip=(w,viewId,uid)=>w.observe({type:'create',viewId,mine:true,prefab:'m4.irp',position:[0,0,0],initialData:itemData(uid)});
// Walk at `speed` m/s along +x for `seconds`, at the native send rate (10/s).
function walk(w,clock,{speed,seconds,y=()=>10,start=0,z=0}){
 const out=[];for(let i=1;i<=seconds*10;i++){clock.t+=0.1;out.push(w.check({type:'move',origin:[start+speed*0.1*i,y(i),z],angles:{yaw:0,pitch:0}}));}
 return out;
}

test('limits derive from the recovered player and item data',needsAssets, async()=>{
 const player=await readFile(new URL('../browser/assets/recovered/player.json',import.meta.url)).then(b=>JSON.parse(b)).catch(()=>null);
 const items=await readFile(new URL('../browser/assets/recovered/items/manifest.json',import.meta.url)).then(b=>JSON.parse(b)).catch(()=>null);
 if(!player||!items)return test.skip?.('recovered assets not present');
 const l=limitsFromPlayerConfig(player);
 assert.deepEqual([l.maxHorizontalSpeed,l.jumpHeight,l.stepOffset,l.slopeLimit,l.maxFallSpeed],[DEFAULT_LIMITS.maxHorizontalSpeed,1.5,0.5,65,80]);
 const w=weaponsFromItems(items);
 assert.deepEqual(w.get(M4),WEAPONS.get(M4));
 assert.equal(w.get(SHOTGUN).pellets,12);
 assert.ok(Math.abs(w.get(BOLT).fireRate-2.2)<1e-6);
 assert.deepEqual(limitsFromPlayerConfig(null),{...DEFAULT_LIMITS});
});

test('honest sprinting, bunched frames and falls are not flagged', ()=>{
 const {w,clock}=watch();
 assert.ok(walk(w,clock,{speed:8,seconds:5}).every(v=>v.allow));
 // Five frames arriving at once after a stall (TCP bunching) stay within the movement budget.
 clock.t+=0.5;for(let i=1;i<=5;i++)assert.equal(w.check({type:'move',origin:[40+0.8*i,10,0]}).allow,true);
 // Jump onto a 1.4 m ledge, walk up a slope, then fall 30 m.
 walk(w,clock,{speed:4,seconds:2,start:44,y:i=>10+Math.min(1.4,i*0.2)});
 walk(w,clock,{speed:4,seconds:2,start:52,y:i=>11.4+i*0.3});
 walk(w,clock,{speed:2,seconds:2,start:60,y:i=>Math.max(-12,17.4-i*1.5)});
 assert.deepEqual(w.counts,{});
 assert.equal(w.summary().score,0);
});

test('speedhack and teleport are flagged; the teleport never reaches the server', ()=>{
 const {w,clock}=watch();
 walk(w,clock,{speed:16,seconds:3});
 assert.ok(w.counts.speed>=2);
 const before=w.prev.pos;
 clock.t+=0.1;
 const v=w.check({type:'move',origin:[before[0]+300,10,0]});
 assert.deepEqual(v,{allow:false,reason:'impossible-move'});
 assert.equal(w.counts.teleport,1);
 assert.deepEqual(w.prev.pos,before); // baseline kept: the next honest move continues from there
 const flag=w.evidence.find(e=>e.kind==='teleport');
 assert.equal(flag.detail.distance,300);assert.equal(flag.severity,40);
 assert.ok(flag.replay.length>10&&flag.replay.every(s=>s.t>=0)); // high severity carries the replay buffer
 assert.equal(flag.at,1_800_000_000_000);
});

test('server-originated positions (spawn, TruthDetector rollback, admin teleport) reset the baseline', ()=>{
 const {w,clock}=watch();
 walk(w,clock,{speed:4,seconds:1});
 w.observe({type:'rpc',viewId:20,name:'ReadClientMove',args:{values:[[500,20,500],0,0,0]}});
 clock.t+=0.1;
 assert.equal(w.check({type:'move',origin:[500.4,20,500]}).allow,true);
 // Another player's ReadClientMove only updates the position table used for hit range.
 w.observe({type:'rpc',viewId:30,name:'ReadClientMove',args:{values:[[1,2,3],0,0,0]}});
 assert.deepEqual(w.positions.get(30),[1,2,3]);
 clock.t+=3;walk(w,clock,{speed:4,seconds:1,start:500.4,y:()=>20,z:500});
 assert.deepEqual(w.counts,{});
 // Admin teleport: RustServerManagement sends UnstickMove on its own view (1), not on the character.
 clock.t+=1;w.observe({type:'rpc',viewId:1,name:'UnstickMove',args:{class:'ServerManagement',values:[[2000,30,-1500]]}});
 clock.t+=0.1;assert.equal(w.check({type:'move',origin:[2000.4,30,-1500]}).allow,true);
 clock.t+=3;walk(w,clock,{speed:4,seconds:1,start:2000.4,y:()=>30,z:-1500});
 assert.deepEqual(w.counts,{},'moves after an admin teleport are neither dropped nor flagged');
});

test('flying straight up and going under the terrain are flagged', ()=>{
 const {w,clock}=watch({groundHeight:()=>10});
 walk(w,clock,{speed:0.2,seconds:2,y:i=>10+i*0.8});
 assert.ok(w.counts.fly>=1);
 const {w:w2,clock:c2}=watch({groundHeight:()=>10});
 walk(w2,c2,{speed:2,seconds:1,y:()=>4});
 assert.equal(w2.counts['under-terrain'],1);
});

test('fire rate follows each weapon; extra pellets and missing reloads are caught', ()=>{
 const {w,clock}=watch();
 equip(w,40,M4);
 const shot=(viewId=40,hits=[{point:[0,0,0]}])=>w.check({type:'item',viewId,action:'bullet-fire',data:{hits}});
 for(let i=0;i<20;i++){clock.t+=0.125;assert.equal(shot().allow,true);} // native 8 shots/s
 assert.deepEqual(w.counts,{});
 let dropped=0;for(let i=0;i<20;i++){clock.t+=0.03;if(!shot().allow)dropped++;} // ~33 shots/s
 assert.ok(dropped>=12,`dropped ${dropped}`);assert.ok(w.counts['fire-rate']>=1);
 // Reload resets the clip count; 24+ shots without one is flagged.
 const {w:w2,clock:c2}=watch();equip(w2,41,M4);
 w2.check({type:'item',viewId:41,action:'bullet-reload'});
 for(let i=0;i<26;i++){c2.t+=0.13;w2.check({type:'item',viewId:41,action:'bullet-fire',data:{hits:[{point:[0,0,0]}]}});}
 assert.equal(w2.counts['no-reload'],1);
 // Shotgun: 12 pellets fine, 13 dropped.
 equip(w2,42,SHOTGUN);c2.t+=2;
 assert.equal(w2.check({type:'item',viewId:42,action:'bullet-fire',data:{hits:Array(12).fill({point:[0,0,0]})}}).allow,true);
 c2.t+=2;
 assert.deepEqual(w2.check({type:'item',viewId:42,action:'bullet-fire',data:{hits:Array(13).fill({point:[0,0,0]})}}),{allow:false,reason:'impossible-shot'});
 // Items the gateway never saw fall back to the 20 shots/s cap.
 const {w:w3,clock:c3}=watch();let ok=0;for(let i=0;i<40;i++){c3.t+=0.01;if(w3.check({type:'item',viewId:99,action:'bullet-fire',data:{hits:[]}}).allow)ok++;}
 assert.ok(ok<=12,`${ok} unknown-item shots allowed`); // burst 2 + 0.4 s × 20/s × 1.15
});

test('hit range and head-shot ratio use positions the gateway already relays', ()=>{
 const {w,clock}=watch();
 equip(w,40,BOLT);
 w.observe({type:'create',viewId:50,mine:false,prefab:':player_soldier',position:[400,10,0]});
 clock.t+=3;
 w.check({type:'item',viewId:40,action:'bullet-fire',data:{hits:[{target:{p1:0,viewId:50},bodyPart:9,point:[0,0,0]}]}});
 assert.equal(w.counts['hit-range'],1);
 w.observe({type:'rpc',viewId:50,name:'ReadClientMove',args:{values:[[100,10,0],0,0,0]}});
 for(let i=0;i<16;i++){clock.t+=2.3;w.check({type:'item',viewId:40,action:'bullet-fire',data:{hits:[{target:{p1:0,viewId:50},bodyPart:i%8?9:2,point:[0,0,0]}]}});}
 assert.equal(w.counts['hit-range'],1);
 assert.equal(w.counts['headshot-ratio'],1);
});

test('score decays, review attaches the replay once, auto-kick only when the policy enables it', ()=>{
 const {w,clock}=watch({policy:{halfLifeSeconds:60,autoKick:false}});
 for(let i=0;i<4;i++){clock.t+=2;w.flag('fly',{});}
 const score=w.summary().score;assert.ok(score>=95&&score<=100,String(score)); // 4 × 25, decaying between flags
 const reviewFlag=w.evidence.find(e=>e.score>=50);assert.ok(reviewFlag.replay);
 assert.equal(w.evidence.filter(e=>e.replay).length,1);
 clock.t+=60;assert.ok(Math.abs(w.summary().score-score/2)<=1);
 assert.equal(w.shouldKick(),false);
 const {w:k,clock:kc}=watch({policy:{autoKick:true,kickScore:90}});
 for(let i=0;i<4;i++){kc.t+=2;k.flag('fly',{});}
 assert.equal(k.shouldKick(),true);
 assert.equal(k.drain().length,4);assert.equal(k.drain().length,0);
});

// ---- slice 2: line of sight, yaw snap, per-command rate buckets ----
// Synthetic collision world in browser space (Z negated): a 10 m wide, 4 m tall, 0.4 m thick wall across Unity
// z = 10 (browser z = -10), standing on flat terrain at y = 10. One structure prefab: a 4.5 × 4.1 × 0.3 m wall box.
// One door prefab: a 2 × 2.4 × 0.2 m panel (layer 20) closed by default, 0.3 s to open, 0.45 s to close (the recovered
// wooden door's MovingDoor timings). extra(world): more static or body colliders before the build.
const WALL_PREFAB=';struct_wood_wall',DOOR_PREFAB=';deploy_door',DOOR_SETTINGS={startConfig:12,durationOpen:0.3,durationClose:0.45};
async function sightWorld({maxStructures,now,extra,sceneDoors=[]}={}){
 const world=new CollisionWorld(null);world.addBox([10,4,0.4],[0,12,-10],new Matrix4());extra?.(world);world.build();
 const def=await structureShapes({name:'wall',colliders:[{type:'BoxCollider',trigger:false,size:[4.5,4.1,0.3],center:[0,2.05,0],matrix:new Matrix4().toArray()}],nodes:[{layer:10}],rootScale:{x:1,y:1,z:1}});
 const door=await structureShapes({name:'door',colliders:[{type:'BoxCollider',trigger:false,size:[2,2.4,0.2],center:[0,1.2,0],matrix:new Matrix4().toArray()}],nodes:[{layer:20}],rootScale:{x:1,y:1,z:1}});
 return new LineOfSight({world,staticLayers:[0],ground:()=>10,structures:new Map([[WALL_PREFAB,def]]),doors:new Map([[DOOR_PREFAB,{def:door,settings:DOOR_SETTINGS}]]),sceneDoors,maxStructures,...(now?{now}:{})});
}
const shootAt=(w,viewId,target,bodyPart=2)=>w.check({type:'item',viewId,action:'bullet-fire',data:{hits:[{target:{p1:0,viewId:target},bodyPart,point:[0,0,0]}]}});
const serverMove=(w,viewId,pos)=>w.observe({type:'rpc',viewId,name:'ReadClientMove',args:{values:[pos,0,0,0]}});

test('line of sight: the masks are the server values; segments are tested against walls, terrain and structures', async()=>{
 assert.equal([0,4,10,12,17,18,19,20,21,27,28].reduce((m,b)=>m|(1<<b),0),BULLET_MASK);
 assert.equal([0,1,10,19,20,29].reduce((m,b)=>m|(1<<b),0),TRUTH_MASK);
 const los=await sightWorld();
 assert.equal(los.blocked([0,11.6,0],[0,11.6,5]),null);
 const wall=los.blocked([0,11.6,0],[0,11.6,20]);
 assert.equal(wall.what,'world');assert.equal(wall.total,20);
 assert.deepEqual(wall.at,[0,11.6,9.8]); // reported in Unity space
 assert.equal(los.blocked([20,11.6,0],[20,11.6,20]),null); // past the end of the wall
 assert.equal(los.blocked([0,11.6,0],[0,11.6,20],{mask:1<<4}),null); // a mask without the wall's layer
 assert.equal(los.blocked([30,10.5,0],[30,9,40]).what,'terrain');
 // Structures are shared and reference-counted across sessions.
 assert.equal(los.retain('7:1',WALL_PREFAB,[30,10,20],[0,0,0]),true);
 assert.equal(los.retain('7:1',WALL_PREFAB,[30,10,20],[0,0,0]),true);
 assert.equal(los.retain('7:2',';deploy_box',[30,10,25],[0,0,0]),false); // only structure pieces block
 assert.equal(los.blocked([30,11.6,15],[30,11.6,25]).what,'structure');
 assert.equal(los.blocked([30,11.6,15],[30,11.6,25],{ignore:'7:1'}),null);
 // Rotated 90° about Y the piece runs along Unity x → z: a shot along z hits its length, one across x at the side misses.
 assert.equal(los.retain('7:3',WALL_PREFAB,[40,10,20],[0,90,0]),true);
 assert.equal(los.blocked([38,11.6,20],[42,11.6,20]).what,'structure');
 assert.equal(los.blocked([38,11.6,23],[42,11.6,23]),null);
 los.release('7:1');assert.equal(los.blocked([30,11.6,15],[30,11.6,25]).what,'structure');
 los.release('7:1');assert.equal(los.blocked([30,11.6,15],[30,11.6,25]),null);assert.equal(los.has('7:1'),false);
 const capped=await sightWorld({maxStructures:1});
 assert.equal(capped.retain('1:1',WALL_PREFAB,[0,10,0],[0,0,0]),true);assert.equal(capped.retain('1:2',WALL_PREFAB,[9,10,0],[0,0,0]),false);
});

test('wall-shot: hits on players behind walls are flagged; visible and just-hidden targets are not', async()=>{
 const los=await sightWorld(),{w,clock}=watch({lineOfSight:los});
 serverMove(w,20,[0,10,0]);clock.t+=3;
 equip(w,40,M4);
 w.observe({type:'create',viewId:50,mine:false,prefab:':player_soldier',position:[0,10,5]});
 clock.t+=0.2;assert.equal(shootAt(w,40,50).allow,true);
 assert.equal(w.counts['wall-shot'],undefined);
 // The target walks behind the wall: shots within the interpolation trail still see the earlier positions.
 serverMove(w,50,[0,10,9.4]);serverMove(w,50,[0,10,20]);
 clock.t+=0.2;shootAt(w,40,50);
 assert.equal(w.counts['wall-shot'],undefined);
 // Later the only known position is behind the wall from both eye heights: flagged, not dropped.
 clock.t+=1;const v=shootAt(w,40,50);
 assert.equal(v.allow,true);assert.equal(w.counts['wall-shot'],1);
 const flag=w.evidence.find(e=>e.kind==='wall-shot');
 assert.deepEqual([flag.detail.weapon,flag.detail.target,flag.detail.blockedBy],['M4',50,'world']);
 // Shotgun pellets on one target share one check (≤ 7 target points × 2 eyes); the per-session ray budget bounds
 // the work, and an exhausted budget skips checks instead of flagging.
 const rays=los.rays;equip(w,42,SHOTGUN);clock.t+=3;
 w.check({type:'item',viewId:42,action:'bullet-fire',data:{hits:Array(12).fill({target:{p1:0,viewId:50},bodyPart:2,point:[0,0,0]})}});
 assert.ok(los.rays-rays<=14,`${los.rays-rays} rays`);
 const {w:b,clock:bc}=watch({lineOfSight:los,limits:{losRaysPerSecond:1,losRayBurst:4}});
 b.observe({type:'create',viewId:50,mine:false,prefab:':player_soldier',position:[0,10,20]});equip(b,40,M4);
 for(let i=0;i<5;i++){bc.t+=0.2;shootAt(b,40,50);}
 assert.ok(b.losSkipped>=3,String(b.losSkipped));assert.equal(b.counts['wall-shot'],undefined);
});

test('wall-use: context queries through walls are flagged; open doors, near and visible targets are not', async()=>{
 const los=await sightWorld(),{w,clock}=watch({lineOfSight:los});
 serverMove(w,20,[0,10,0]);clock.t+=3;
 w.observe({type:'ngc-create',carrier:7,innerID:1,prefab:';deploy_box',position:[0,10,4],euler:[0,0,0]});
 w.observe({type:'ngc-create',carrier:7,innerID:2,prefab:';deploy_box',position:[0,10,14],euler:[0,0,0]});
 w.observe({type:'ngc-create',carrier:7,innerID:3,prefab:DOOR_PREFAB,position:[0,10,14],euler:[0,0,0]});
 // The server's buffered DOo says the door behind the wall is open: its panel is not where the closed pose says.
 w.observe({type:'ngc-call',carrier:7,innerID:3,name:'DOo',args:[1,0n]});
 const use=innerID=>w.check({type:'context',action:'query',target:{carrier:7,innerID}});
 assert.equal(use(1).allow,true);clock.t+=1;assert.equal(use(3).allow,true);
 assert.equal(w.counts['wall-use'],undefined);
 clock.t+=1;assert.equal(use(2).allow,true);assert.equal(w.counts['wall-use'],1);
 assert.equal(w.evidence.at(-1).detail.target,'7:2');
 // Entities follow ngc-destroy and their carrier view; unknown targets are not guessed.
 w.observe({type:'ngc-destroy',carrier:7,innerID:2});clock.t+=6;use(2);assert.equal(w.counts['wall-use'],1);
 // Closed (connect-time DOc: settled), the same door is checked like any other entity.
 w.observe({type:'ngc-call',carrier:7,innerID:3,name:'DOc',args:[0]});use(3);assert.equal(w.counts['wall-use'],2);
 w.observe({type:'destroy',kind:'view',viewId:7});assert.equal(w.entities.size,0);
});

test('noclip: the TruthDetector trace through walls and terrain is flagged; sliding along a wall is not', async()=>{
 const los=await sightWorld(),{w,clock}=watch({lineOfSight:los});
 serverMove(w,20,[0,10,9.4]);clock.t+=3;
 for(let i=1;i<=8;i++){clock.t+=0.1;w.check({type:'move',origin:[i*0.6,10,9.4],angles:{yaw:90,pitch:0}});} // brushing the wall face
 assert.equal(w.counts.noclip,undefined);
 clock.t+=0.1;const v=w.check({type:'move',origin:[4.8,10,10.6],angles:{yaw:0,pitch:0}});
 assert.equal(v.allow,true);assert.equal(w.counts.noclip,1); // flagged; the server's own TruthDetector rolls it back
 assert.equal(w.evidence.at(-1).detail.blockedBy,'world');
 // Diving under a terrain ridge between two points above it.
 const ridge=new LineOfSight({ground:x=>x>2&&x<4?20:10}),{w:t,clock:tc}=watch({lineOfSight:ridge});
 serverMove(t,20,[0,10,0]);tc.t+=3;
 tc.t+=0.1;t.check({type:'move',origin:[0.5,10,0]});tc.t+=0.1;t.check({type:'move',origin:[6,10,0]});
 assert.equal(t.counts.noclip,1);assert.equal(t.evidence.at(-1).detail.blockedBy,'terrain');
 // The structure a session lent to the shared world goes back when the session ends.
 w.observe({type:'ngc-create',carrier:8,innerID:1,prefab:WALL_PREFAB,position:[0,10,30],euler:[0,0,0]});
 assert.equal(los.has('8:1'),true);w.dispose();assert.equal(los.has('8:1'),false);
});

test('yaw-snap: a > 90° turn in one send interval followed by a hit is flagged with the aim error', ()=>{
 const {w,clock}=watch();equip(w,40,BOLT);
 // Target due −x of the shooter: Unity bearing atan2(dx, dz) = −90° (yaw 270°).
 w.observe({type:'create',viewId:50,mine:false,prefab:':player_soldier',position:[-20,10,0]});
 const turn=yaw=>{clock.t+=0.1;w.check({type:'move',origin:[0,10,0],angles:{yaw,pitch:0}});};
 // A fast but honest turn spread over several intervals, then a hit: not a snap.
 for(const y of [0,40,80,120,160,200,240,270])turn(y);
 clock.t+=0.05;shootAt(w,40,50);assert.equal(w.counts['yaw-snap'],undefined);
 // A snap without a hit expires.
 turn(90);clock.t+=1;clock.t+=2.3;shootAt(w,40,50);assert.equal(w.counts['yaw-snap'],undefined);
 // 100° → 270° within one interval, hit 0.1 s later.
 turn(100);turn(270);clock.t+=0.1;shootAt(w,40,50);
 assert.equal(w.counts['yaw-snap'],1);
 const d=w.evidence.find(e=>e.kind==='yaw-snap').detail;
 assert.deepEqual([d.degrees,d.aimError,d.weapon],[170,0,'Bolt Action Rifle']);
 // Melee hits count too; a server-originated position (respawn, rollback) clears a pending snap.
 const {w:m,clock:mc}=watch();equip(m,41,BOLT);
 mc.t+=0.1;m.check({type:'move',origin:[0,10,0],angles:{yaw:0,pitch:0}});mc.t+=0.1;m.check({type:'move',origin:[0,10,0],angles:{yaw:180,pitch:0}});
 assert.ok(m.snap);serverMove(m,20,[0,10,0]);
 mc.t+=0.1;m.check({type:'item',viewId:41,action:'melee-hit',data:{target:{p1:0,viewId:50},point:[0,0,0]}});
 assert.equal(m.counts['yaw-snap'],undefined);
 mc.t+=3;m.check({type:'move',origin:[0,10,0],angles:{yaw:0,pitch:0}});mc.t+=0.1;m.check({type:'move',origin:[0,10,0],angles:{yaw:-150,pitch:0}});
 mc.t+=0.1;m.check({type:'item',viewId:41,action:'melee-hit',data:{target:{p1:0,viewId:50},point:[0,0,0]}});
 assert.equal(m.counts['yaw-snap'],1);
});

test('per-command buckets: inventory, craft, take-all and context spam is flagged and dropped', ()=>{
 const {w,clock}=watch();
 const inv=(action,extra={})=>w.check({type:'inventory',action,source:{viewId:20},...extra});
 // Honest pace: 8 inventory moves/s for 3 s, a craft every second, take-all twice.
 for(let i=0;i<24;i++){clock.t+=0.125;assert.equal(inv('move',{fromSlot:1,toSlot:2,op:'move',target:{viewId:20}}).allow,true);if(i%8===0)assert.equal(inv('craft',{blueprint:1,amount:1}).allow,true);}
 assert.equal(inv('take-all').allow,true);assert.equal(inv('take-all').allow,true);
 assert.deepEqual(w.counts,{});
 // Dupe-style spam: 100 split/merge requests in one second.
 let dropped=0;for(let i=0;i<100;i++){clock.t+=0.01;const v=inv(i%2?'split':'move',{fromSlot:1,toSlot:2,op:'merge',tryCombine:true,target:{viewId:20}});if(!v.allow){dropped++;assert.equal(v.reason,'command-rate');}}
 assert.ok(dropped>=65&&dropped<=75,`dropped ${dropped}`); // burst 20 + 1 s × 10/s
 assert.equal(w.counts['command-rate'],1); // cooldown: one flag per 5 s, every excess request still dropped
 assert.equal(w.evidence.at(-1).detail.command,'inventory');
 clock.t+=6;let crafts=0;for(let i=0;i<10;i++)if(inv('craft',{blueprint:1,amount:1}).allow)crafts++;
 assert.equal(crafts,4);
 let takes=0;for(let i=0;i<10;i++)if(inv('take-all').allow)takes++;assert.equal(takes,3);
 let queries=0;for(let i=0;i<30;i++)if(w.check({type:'context',action:'query',target:{viewId:99}}).allow)queries++;assert.equal(queries,10);
 // Refresh and context menu choices are not bucketed.
 for(let i=0;i<30;i++){assert.equal(inv('refresh').allow,true);assert.equal(w.check({type:'context',action:'menu',option:1}).allow,true);}
 assert.equal(w.counts['command-rate'],2);
});

test('the recovered collision world blocks bullets at the warehouse roof and loads the structure prefabs',needsAssets, async()=>{
 const dir=new URL('../browser/assets/recovered/',import.meta.url);
 const present=await readFile(new URL('scene/manifest.json',dir)).then(()=>true,()=>false);
 if(!present)return test.skip?.('recovered assets not present');
 const los=await loadLineOfSight(decodeURIComponent(dir.pathname.replace(/^\/([A-Za-z]:)/,'$1')),{trees:false});
 assert.equal(los.structures.size,16);assert.deepEqual([...los.doors.keys()].sort(),[';deploy_metal_door',';deploy_wood_door',';deploy_woodgate']);
 // Warehouse roof (tests/motor.test.mjs: support at browser (5211.6, 4788.9) is 370–380 m).
 const roof=los.blocked([5211.6,390,-4788.9],[5211.6,360,-4788.9],{mask:TRUTH_MASK});
 assert.equal(roof.what,'world');assert.ok(roof.at[1]>370&&roof.at[1]<380,JSON.stringify(roof));
 // A recovered foundation placed on open ground blocks a shot through it.
 const g=los.ground(0,0);assert.ok(Number.isFinite(g));
 assert.equal(los.retain('1:1',';struct_wood_foundation',[0,g,0],[0,0,0]),true);
 assert.equal(los.blocked([-6,g+1,0],[6,g+1,0]).what,'structure');
 // A recovered wooden door (closed by default) blocks until the server opens it.
 assert.equal(los.retain('1:2',';deploy_wood_door',[40,g,0],[0,0,0]),true);
 const c=los.center('1:2'),across=[[c[0],c[1],c[2]-3],[c[0],c[1],c[2]+3]];
 assert.equal(los.blocked(...across).what,'door');
 los.ngcDoor('1:2',1);assert.equal(los.blocked(...across),null);
});

test('recovered scene doors join the trace world by manual view ID and follow DOc/DOo from the stream',needsAssets, async()=>{
 const dir=new URL('../browser/assets/recovered/',import.meta.url);
 const scene=await readFile(new URL('scene/manifest.json',dir)).then(b=>JSON.parse(b),()=>null);
 if(!scene)return test.skip?.('recovered assets not present');
 // Every exported scene door carries its uLinkNetworkView._manualViewID (3–62, unique).
 const views=scene.doors.map(d=>d.viewID);
 assert.equal(views.length,32);assert.equal(new Set(views).size,32);assert.ok(views.every(v=>Number.isInteger(v)&&v>=3&&v<=62));
 // BlueDoor_94 in the warehouse block (door 5, view 38): a 0.19 m thick panel across browser x = 5180.29.
 const door=scene.doors[5];assert.equal(door.name,'BlueDoor_94');assert.equal(door.viewID,38);
 const los=await loadLineOfSight(decodeURIComponent(dir.pathname.replace(/^\/([A-Za-z]:)/,'$1')),{trees:false});
 assert.equal(los.sceneDoors.size,32);
 const {w,clock}=watch({lineOfSight:los});los.now=()=>clock.t;
 const across=[[5178.8,369.6,-4797.2],[5181.8,369.6,-4797.2]];
 assert.equal(los.blocked(...across),null); // unknown until the server names its state
 // The native session: scene view 38 is never Created, so the RPCs decode by name (BasicDoor in the schema).
 const {GameBridge}=await import('../bridge/game-bridge.mjs'),{BitReader}=await import('../bridge/ulink/bits.mjs'),{writeArgs}=await import('../bridge/ulink/rust.mjs'),{EventEmitter}=await import('node:events');
 const schema=JSON.parse(await readFile(new URL('../bridge/ulink/rpc-schema.json',import.meta.url)));
 let serverMs=90000n;const client=Object.assign(new EventEmitter(),{serverMs:()=>serverMs}),bridge=new GameBridge({client,schema,playerName:'p'});
 bridge.on('event',e=>w.observe(e));
 const rpc=(name,types,values)=>bridge.onRpc({viewId:38,rpc:name,timestampLow:Number(serverMs&0xffffn),timestampBits:16},new BitReader(writeArgs(types,values).toBytes()));
 rpc('DOc',['sbyte'],[0]); // connect-time state: closed, settled
 assert.equal(los.blocked(...across).what,'door');assert.equal(los.blocked(...across,{mask:TRUTH_MASK}).what,'door');
 serverMs+=5000n;rpc('DOo',['sbyte','ulong'],[1,serverMs]);assert.equal(los.blocked(...across),null); // opened
 serverMs+=5000n;rpc('DOo',['sbyte','ulong'],[0,serverMs]); // closing: 0.45 s animation + 1 s slack
 clock.t+=1.2;assert.equal(los.blocked(...across),null);clock.t+=0.3;assert.equal(los.blocked(...across).what,'door');
 assert.equal(los.sceneDoor(999,1),false); // views without a recovered door are ignored
});

// ---- slice 7: doors in the trace world, melee/arrow/NGC/animal sight, hover ----
const HATCHET=2,BOW=3;
const WEAPONS7=new Map([...WEAPONS,[HATCHET,{name:'Hatchet',fireRate:0.9,pellets:1}],[BOW,{name:'Hunting Bow',fireRate:1,pellets:1,arrowSpeed:80}]]);
// A 2 × 2.4 × 0.2 m scene door body (layer 20) across Unity z = 30, view 5.
const sceneDoorBody=()=>{const body=Object.assign(new MovingBody('BlueDoor'),{layer:20});body.addBox([2,2.4,0.2],[0,11.2,-30],new Matrix4());return body;};

test('doors: NGC doors and gates and scene doors block only while the stream says closed and settled', async()=>{
 const clock={t:100},body=sceneDoorBody();
 const los=await sightWorld({now:()=>clock.t,extra:world=>world.addBody(body),sceneDoors:[{viewId:5,body,settings:{durationOpen:1,durationClose:1}}]});
 const through=[[20,11,15],[20,11,25]];
 assert.equal(los.retain('9:1',DOOR_PREFAB,[20,10,20],[0,0,0]),true);
 assert.equal(los.blocked(...through).what,'door'); // the prefab default (startConfig 12: closed)
 assert.equal(los.blocked(...through,{mask:TRUTH_MASK}).what,'door'); // layer 20 is in both server masks
 los.ngcDoor('9:1',1);assert.equal(los.blocked(...through),null); // opening: never blocks
 los.ngcDoor('9:1',0);assert.equal(los.blocked(...through),null); // closing: not until 0.45 s + 1 s slack
 clock.t+=1.2;assert.equal(los.blocked(...through),null);clock.t+=0.3;assert.equal(los.blocked(...through).what,'door');
 los.ngcDoor('9:1',2,{settled:true});assert.equal(los.blocked(...through),null);
 assert.equal(los.ngcDoor('9:9',0),false); // unknown pieces are ignored
 // Scene doors start unknown (never blocking) until DOc/DOo on their manual view.
 const scene=[[0,11,25],[0,11,35]];assert.equal(los.blocked(...scene),null);
 const {w,clock:wc}=watch({lineOfSight:los});
 w.observe({type:'rpc',viewId:5,name:'DOc',args:{class:'BasicDoor',values:[0]}});assert.equal(los.blocked(...scene).what,'door');
 w.observe({type:'rpc',viewId:5,name:'DOo',args:{class:'BasicDoor',values:[1,5000n]},serverMs:5100});assert.equal(los.blocked(...scene),null);
 // An old buffered DOo (closed 10 s before this session saw it) is settled at once.
 w.observe({type:'rpc',viewId:5,name:'DOo',args:{class:'BasicDoor',values:[0,5000n]},serverMs:15000});assert.equal(los.blocked(...scene).what,'door');
 // NGC doors from the stream: ngc-create lends the door, ngc-call DOo/DOc set its state; noclip sees closed doors only.
 w.observe({type:'ngc-create',carrier:8,innerID:4,prefab:DOOR_PREFAB,position:[-20,10,20],euler:[0,0,0]});
 serverMove(w,20,[-20,10,19.4]);wc.t+=3;
 w.observe({type:'ngc-call',carrier:8,innerID:4,name:'DOo',args:[1,0n],serverMs:0});
 wc.t+=0.1;w.check({type:'move',origin:[-20,10,20.6]});assert.equal(w.counts.noclip,undefined);
 w.observe({type:'ngc-call',carrier:8,innerID:4,name:'DOc',args:[0]});
 wc.t+=0.1;w.check({type:'move',origin:[-20,10,19.4]});assert.equal(w.counts.noclip,1);assert.equal(w.evidence.at(-1).detail.blockedBy,'door');
 w.dispose();assert.equal(los.has('8:4'),false);
});

test('wall-use on scene doors: Context:A on a manual door view is traced to its panel while it is closed', async()=>{
 const clock={t:100},body=sceneDoorBody();
 const los=await sightWorld({now:()=>clock.t,extra:world=>world.addBody(body),sceneDoors:[{viewId:5,body,settings:{durationOpen:1,durationClose:1}}]});
 // The panel at its closed pose: centre (0, 11.2, 30) Unity, plus points 1 m above its bottom and 0.3 m below its top.
 const d=los.sceneDoorTarget(5);assert.deepEqual(d.points.map(p=>p.map(v=>Math.round(v*100)/100)),[[0,11.2,30],[0,10.95,30],[0,12.15,30]]);
 assert.equal(d.closed,false);assert.equal(los.sceneDoorTarget(6),null);
 const {w,clock:wc}=watch({lineOfSight:los,now:()=>clock.t});wc.t=clock.t;
 const use=()=>w.check({type:'context',action:'query',target:{viewId:5}});
 const at=pos=>{serverMove(w,20,pos);clock.t+=3;};
 // Behind the 4 m wall at z = 10, 20 m from the door: unknown state (no DOc yet) is never checked.
 at([0,10,0]);assert.equal(use().allow,true);assert.equal(w.counts['wall-use'],undefined);
 // Closed and settled (connect-time DOc): reaching it through the wall is flagged, not dropped.
 w.observe({type:'rpc',viewId:5,name:'DOc',args:{class:'BasicDoor',values:[0]}});
 assert.equal(use().allow,true);assert.equal(w.counts['wall-use'],1);
 const e=w.evidence.at(-1);assert.deepEqual([e.detail.target,e.detail.targetKind,e.detail.blockedBy],[5,'scene-door','world']);
 // In front of the door (either side), its own panel never counts as the blocker.
 clock.t+=6;at([0,10,27]);use();at([0,10,33]);clock.t+=6;use();assert.equal(w.counts['wall-use'],1);
 // Opened, or still swinging shut, the panel is not where the closed pose says: exempt.
 at([0,10,0]);clock.t+=6;w.observe({type:'rpc',viewId:5,name:'DOo',args:{class:'BasicDoor',values:[1,0n]},serverMs:0});use();
 w.observe({type:'rpc',viewId:5,name:'DOo',args:{class:'BasicDoor',values:[0,0n]},serverMs:0});use();assert.equal(w.counts['wall-use'],1);
 clock.t+=2.5;use();assert.equal(w.counts['wall-use'],2);
});

test('wall-use on a recovered scene door (BlueDoor_94, view 38) through GameBridge',needsAssets, async()=>{
 const dir=new URL('../browser/assets/recovered/',import.meta.url);
 const present=await readFile(new URL('scene/manifest.json',dir)).then(()=>true,()=>false);
 if(!present)return test.skip?.('recovered assets not present');
 const los=await loadLineOfSight(decodeURIComponent(dir.pathname.replace(/^\/([A-Za-z]:)/,'$1')),{trees:false});
 const {w,clock}=watch({lineOfSight:los});los.now=()=>clock.t;
 const d=los.sceneDoorTarget(38);assert.ok(d,'door view 38 has a panel');
 const [cx,cy,cz]=d.points[0];
 los.sceneDoor(38,0,{settled:true});assert.equal(los.sceneDoorTarget(38).closed,true);
 const use=()=>w.check({type:'context',action:'query',target:{viewId:38}});
 // Standing 1.5 m in front of the panel (either side of browser x = 5180.29): clear.
 for(const dx of [-1.5,1.5]){serverMove(w,20,[cx+dx,cy-1.2,cz]);clock.t+=6;use();}
 assert.equal(w.counts['wall-use'],undefined);
 // From the warehouse roof 12 m above it: the roof is between the eye and the door.
 serverMove(w,20,[cx,cy+12,cz]);clock.t+=6;use();
 assert.equal(w.counts['wall-use'],1,JSON.stringify(w.evidence.at(-1)?.detail));
});

test('melee hits on animals and NGC entities are traced; reach follows the server rule', async()=>{
 const los=await sightWorld(),{w,clock}=watch({lineOfSight:los,weapons:WEAPONS7});
 serverMove(w,20,[0,10,9.4]);clock.t+=3;equip(w,41,HATCHET);
 const swing=(target,point)=>w.check({type:'item',viewId:41,action:'melee-hit',data:{target,point,flag:false}});
 w.observe({type:'create',viewId:60,mine:false,prefab:':wolf_prefab',position:[0,10,8.4]});
 clock.t+=1;assert.equal(swing({p1:0,viewId:60},[0,10.6,8.6]).allow,true);assert.equal(w.counts['wall-shot'],undefined);
 // The wolf runs behind the wall (server GetNetworkUpdate); the swing still lands: flagged, not dropped.
 w.observe({type:'rpc',viewId:60,name:'GetNetworkUpdate',args:{class:'BasicWildLifeAI',values:[[0,10,11],{pitch:0,yaw:0}]}});
 clock.t+=1;assert.equal(swing({p1:0,viewId:60},[0,10.6,11]).allow,true);assert.equal(w.counts['wall-shot'],1);
 assert.deepEqual([w.evidence.at(-1).detail.attack,w.evidence.at(-1).detail.targetKind,w.evidence.at(-1).detail.blockedBy],['melee','animal','world']);
 // A client hit point on the visible side does not clear a target it is not on.
 clock.t+=2.5;swing({p1:0,viewId:60},[0,10.6,9]);assert.equal(w.counts['wall-shot'],2);
 // NGC target through its carrier group: a box behind the wall, then the reach rule (≥ 6 m ignored by the server).
 w.observe({type:'create',viewId:7,mine:false,prefab:'!Ng',group:33,position:[0,0,0]});
 w.observe({type:'ngc-create',carrier:7,innerID:5,prefab:';deploy_box',position:[1,10,11],euler:[0,0,0]});
 w.observe({type:'ngc-create',carrier:7,innerID:6,prefab:';deploy_box',position:[-12,10,9.4],euler:[0,0,0]});
 clock.t+=2.5;swing({p1:33,p2:5},[1,10.5,11]);assert.equal(w.counts['wall-shot'],3);assert.equal(w.evidence.at(-1).detail.target,'7:5');
 clock.t+=2.5;swing({p1:33,p2:6},[-12,10.5,9.4]);assert.equal(w.counts['wall-shot'],3);
 assert.equal(w.counts['hit-range'],1);assert.deepEqual([w.evidence.at(-1).detail.attack,w.evidence.at(-1).detail.range],['melee',6]);
});

test('bullet hits on NGC entities and animals use the same sight check; NGC hit points are entity-local', async()=>{
 const los=await sightWorld(),{w,clock}=watch({lineOfSight:los});
 serverMove(w,20,[0,10,0]);clock.t+=3;equip(w,40,M4);
 w.observe({type:'create',viewId:7,mine:false,prefab:'!Ng',group:33,position:[0,0,0]});
 w.observe({type:'ngc-create',carrier:7,innerID:1,prefab:WALL_PREFAB,position:[0,10,14],euler:[0,0,0]});
 w.observe({type:'ngc-create',carrier:7,innerID:2,prefab:WALL_PREFAB,position:[30,10,14],euler:[0,0,0]});
 const shoot=(target,point=[0,0,0])=>w.check({type:'item',viewId:40,action:'bullet-fire',data:{hits:[{target,bodyPart:254,point}]}});
 clock.t+=0.2;shoot({p1:33,p2:2},[0,3,0]);assert.equal(w.counts['wall-shot'],undefined); // a piece in the open
 clock.t+=0.2;shoot({p1:33,p2:1},[0,3,0]);assert.equal(w.counts['wall-shot'],1); // a piece wholly behind the wall
 assert.deepEqual([w.evidence.at(-1).detail.targetKind,w.evidence.at(-1).detail.attack],['entity','bullet']);
 assert.deepEqual(w.entityWorld(w.resolve({p1:33,p2:1}),[1,3,0]).map(v=>Math.round(v*100)/100),[1,13,14]);
 w.observe({type:'create',viewId:61,mine:false,prefab:':stag_prefab',position:[3,10,20]});
 clock.t+=2.5;shoot({p1:0,viewId:61});assert.equal(w.counts['wall-shot'],2);assert.equal(w.evidence.at(-1).detail.targetKind,'animal');
 assert.equal(w.hits.players,0); // animals and entities never count towards the head-shot ratio
});

test('arrows are traced along their own path from the bow-fire origin when the hit arrives', async()=>{
 // ArrowMovement: 80 m/s, 5°/s pitch-down. After 1 s the arrow is 3.49 m lower and 79.9 m along.
 const p=arrowPath([0,0,0],[0,0,0,1],80,5)(1);assert.ok(Math.abs(p[1]+3.4884)<1e-3&&Math.abs(p[2]-79.8985)<1e-3,String(p));
 const los=await sightWorld(),{w,clock}=watch({lineOfSight:los,weapons:WEAPONS7});
 serverMove(w,20,[0,10,0]);clock.t+=3;equip(w,43,BOW);
 const fire=(origin=[0,11.65,0],rotation=[0,0,0,1])=>w.check({type:'item',viewId:43,action:'bow-fire',data:{origin,rotation}});
 const hit=viewId=>w.check({type:'item',viewId:43,action:'bow-hit',data:{target:{p1:0,viewId},position:[0,0,0]}});
 w.observe({type:'create',viewId:60,mine:false,prefab:':wolf_prefab',position:[0,10,6]});
 w.observe({type:'create',viewId:62,mine:false,prefab:':wolf_prefab',position:[0,10,20]});
 fire();clock.t+=0.1;assert.equal(hit(60).allow,true);assert.equal(w.counts['wall-shot'],undefined);
 // Behind the wall: the path (≈ 0.2 m lower at 20 m) crosses the wall.
 clock.t+=1.1;fire();clock.t+=0.3;hit(62);assert.equal(w.counts['wall-shot'],1);
 const f=w.evidence.at(-1).detail;assert.deepEqual([f.attack,f.weapon,f.blockedBy],['arrow','Hunting Bow','world']);assert.ok(f.flight>0.2&&f.flight<0.3,String(f.flight));
 // Fired along +x, landed on a wolf 6 m off the path: arrow-path.
 clock.t+=1.1;fire(undefined,[0,Math.SQRT1_2,0,Math.SQRT1_2]);clock.t+=0.1;hit(60);assert.equal(w.counts['arrow-path'],1);
 assert.ok(w.evidence.at(-1).detail.offPath>4);
 // An origin claimed past the wall is replaced by the nearest gateway eye.
 clock.t+=2.5;fire([0,11.65,15]);clock.t+=0.1;hit(62);assert.equal(w.counts['wall-shot'],2);assert.equal(w.evidence.at(-1).detail.originOffset,15);
 // A miss lands the oldest arrow; a hit with no arrow in flight is not checked (the server ignores it too).
 clock.t+=1.1;fire();w.check({type:'item',viewId:43,action:'bow-miss',data:{position:[0,0,0]}});clock.t+=2.5;hit(62);
 assert.equal(w.counts['wall-shot'],2);
 clock.t+=1.1;fire();clock.t+=6;hit(62);assert.equal(w.counts['wall-shot'],2); // older than the arrow's 4 s life
});

test('hover: airborne for 2 s without sinking is flagged; roofs, structures and falls are not', async()=>{
 // A 10 × 0.2 × 10 m roof whose top is 5.1 m above the terrain, centred on Unity (50, 15, 50).
 const los=await sightWorld({extra:world=>world.addBox([10,0.2,10],[50,15,-50],new Matrix4())}),{w,clock}=watch({lineOfSight:los});
 const hold=(pos,seconds,dy=()=>0)=>{for(let i=1;i<=seconds*10;i++){clock.t+=0.1;w.check({type:'move',origin:[pos[0]+i*0.02,pos[1]+dy(i/10),pos[2]]});}};
 serverMove(w,20,[50,15.1,50]);clock.t+=3;hold([50,15.1,50],3);assert.equal(w.counts.hover,undefined);
 w.observe({type:'ngc-create',carrier:9,innerID:1,prefab:WALL_PREFAB,position:[70,10,50],euler:[0,0,0]});
 serverMove(w,20,[70,14.1,50]);clock.t+=3;hold([70,14.1,50],3);assert.equal(w.counts.hover,undefined);
 // Free fall from 40 m: sinks far more than 2 m in 2 s.
 serverMove(w,20,[90,40,0]);clock.t+=3;hold([90,40,0],2.5,s=>-4.9*s*s);assert.equal(w.counts.hover,undefined);
 // Hovering 5 m above open ground.
 serverMove(w,20,[30,15,0]);clock.t+=3;hold([30,15,0],2.5);assert.equal(w.counts.hover,1);
 const f=w.evidence.at(-1).detail;assert.deepEqual([f.height,f.surface],[5,'terrain']);assert.ok(f.seconds>=2&&f.drop<2);
 // At most one probe (the centre and the eight rim points) per 0.25 s while airborne.
 const rays=los.rays;hold([30,15,0],1);assert.ok(los.rays-rays<=5*9,String(los.rays-rays));
 // Without a line-of-sight world (terrain-only) there is no hover check.
 const {w:plain,clock:pc}=watch();serverMove(plain,20,[30,15,0]);pc.t+=3;
 for(let i=0;i<30;i++){pc.t+=0.1;plain.check({type:'move',origin:[30,15,0]});}assert.equal(plain.counts.hover,undefined);
});

test('hover: a character standing on the edge of a tall structure (centre past the edge) is not hovering', async()=>{
 // A 0.5 m thick, 4 m tall wall top (P7 p7.hover-structure: a Wood Barricade, root 0.19 m off its collider): the capsule
 // (m_Radius 0.405) stands on it with its centre 0.25 m past the edge, 4 m above the terrain.
 const los=await sightWorld({extra:world=>world.addBox([4,4,0.5],[60,12,-60],new Matrix4())}),{w,clock}=watch({lineOfSight:los});
 const hold=(pos,seconds)=>{for(let i=1;i<=seconds*10;i++){clock.t+=0.1;w.check({type:'move',origin:pos});}};
 serverMove(w,20,[60,14,60.5]);clock.t+=3;hold([60,14,60.5],3);assert.equal(w.counts.hover,undefined,JSON.stringify(w.evidence.at(-1)?.detail));
 // Past the rim (centre 0.6 m off the edge): airborne again, measured from the terrain.
 serverMove(w,20,[60,14,60.85]);clock.t+=3;hold([60,14,60.85],3);assert.equal(w.counts.hover,1);assert.equal(w.evidence.at(-1).detail.surface,'terrain');
});

// ---- slice 8: deployables in the trace world ----
test('deployables: one body per collider layer; bullets stop at bars, players at the clip box; boxes are ground', async()=>{
 const {deployableShapes}=await import('../bridge/line-of-sight.mjs');
 const box=(size,center,layer,extra={})=>({type:'BoxCollider',trigger:false,size,center,layer,matrix:new Matrix4().toArray(),...extra});
 // Window bars: a thin layer-20 panel and a layer-29 PlayerClip box (only TruthDetector's mask has 29); a trigger is dropped.
 const bars=await deployableShapes({name:'bars',nodes:[{layer:20}],rootScale:{x:1,y:1,z:1},colliders:[box([2,2.5,0.05],[0,1.25,0],20),box([2,2.5,0.3],[0,1.25,0],29),box([3,3,3],[0,1,0],0,{trigger:true})]});
 assert.deepEqual(bars.map(d=>d.layer),[20,29]);
 const woodBox=await deployableShapes({name:'box',nodes:[{layer:0}],rootScale:{x:1,y:1,z:1},colliders:[box([1,0.75,1],[0,0.375,0],0)]});
 assert.equal(await deployableShapes({name:'fx',nodes:[{layer:9}],colliders:[box([1,1,1],[0,0,0],9)]}),null); // layer 9: in neither mask
 const world=new CollisionWorld(null);world.build();
 const los=new LineOfSight({world,ground:()=>10,deployables:new Map([[';deploy_metalwindowbars',bars],[';deploy_wood_box',woodBox]])});
 assert.equal(los.retain('5:1',';deploy_metalwindowbars',[0,10,20],[0,0,0]),true);
 const through=[[0,11,18],[0,11,22]];
 assert.equal(los.blocked(...through).what,'deployable');assert.equal(los.blocked(...through,{mask:TRUTH_MASK}).what,'deployable');
 assert.equal(los.blocked(...through,{mask:1<<29}).what,'deployable');assert.equal(los.blocked(...through,{mask:1<<20,ignore:'5:1'}),null);
 // Standing on a wood box: the probe finds its top (0.75 m), so hover measures from there.
 assert.equal(los.retain('5:2',';deploy_wood_box',[10,10,0],[0,0,0]),true);
 const below=los.groundBelow([10,15,0]);assert.equal(below.what,'deployable');assert.ok(Math.abs(below.y-10.75)<0.06,JSON.stringify(below));
 los.release('5:2');assert.equal(los.groundBelow([10,15,0]).what,'terrain');
 // A session's PlayerWatch lends them like structures: a shot through the bars is a wall-shot.
 const {w,clock}=watch({lineOfSight:los});serverMove(w,20,[0,10,15]);clock.t+=3;equip(w,40,M4);
 w.observe({type:'ngc-create',carrier:9,innerID:1,prefab:';deploy_metalwindowbars',position:[0,10,20],euler:[0,0,0]});
 w.observe({type:'create',viewId:50,mine:false,prefab:':player_soldier',position:[0,9.9,25]});
 clock.t+=1;shootAt(w,40,50);assert.equal(w.counts['wall-shot'],1);assert.equal(w.evidence.at(-1).detail.blockedBy,'deployable');
});

test('recovered deployables join the trace world: a large wood storage box blocks a shot',needsAssets, async()=>{
 const dir=new URL('../browser/assets/recovered/',import.meta.url);
 const present=await readFile(new URL('scene/manifest.json',dir)).then(()=>true,()=>false);
 if(!present)return test.skip?.('recovered assets not present');
 const los=await loadLineOfSight(decodeURIComponent(dir.pathname.replace(/^\/([A-Za-z]:)/,'$1')),{trees:false});
 for(const h of [';deploy_wood_box',';deploy_wood_storage_large',';deploy_wood_shelter',';deploy_wood_barricade',';deploy_metalwindowbars',';deploy_workbench'])assert.ok(los.deployables.has(h),h);
 assert.ok(!los.deployables.has(';deploy_wood_door')&&!los.deployables.has(';struct_wood_wall'),'doors and structures keep their own tables');
 assert.deepEqual(los.deployables.get(';deploy_metalwindowbars').map(d=>d.layer).sort((a,b)=>a-b),[20,29]);
 const g=los.ground(100,100);assert.ok(Number.isFinite(g));
 assert.equal(los.retain('1:1',';deploy_wood_storage_large',[100,g,-100],[0,0,0]),true);
 const c=los.center('1:1');assert.equal(los.blocked([c[0]-4,c[1],c[2]],[c[0]+4,c[1],c[2]]).what,'deployable');
});

