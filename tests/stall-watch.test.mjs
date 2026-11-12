// bridge/stall-watch.mjs: server-wide correction bursts (SERVER-TESTING-PLAN.md section 12, 2026-10-22 13:04 UTC).
import test from 'node:test';
import assert from 'node:assert/strict';
import {StallWatch,BURST_COOLDOWN_MS,LOOK_BACK_MS} from '../bridge/stall-watch.mjs';

const watch=(inGame=4)=>{const clock={t:1000},lines=[];
 const w=new StallWatch({now:()=>clock.t,wallNow:()=>Date.UTC(2026,9,22,13,4,42),log:(...a)=>lines.push(a.join(' ')),inGame:()=>inGame});
 return {w,clock,lines};};

test('one correction per session within a second is a burst; a lone correction is not', ()=>{
 const {w,clock,lines}=watch(4);
 assert.equal(w.correction(1,{lateS:1.1,serverMs:500000}),null);
 clock.t+=300;assert.equal(w.correction(1,{lateS:1.3}),null,'the same session twice is still one session');
 clock.t+=300;assert.equal(w.correction(2,{lateS:0.9}),null);
 clock.t+=300;const line=w.correction(3,{lateS:2.5,serverMs:500900});
 assert.match(line,/^sessions=3\/4 utc=2026-10-22T13:04:42.000Z serverMs=500900 lateMs p50=1100 max=2500 /);
 assert.deepEqual(lines,['correction-burst '+line]);
 assert.deepEqual([w.metrics.corrections,w.metrics.bursts],[4,1]);
});

test('corrections spread over more than a second, or below a quarter of the players, are no burst', ()=>{
 const {w,clock}=watch(40);
 for(let id=1;id<=9;id++){assert.equal(w.correction(id),null,'9 of 40 is under 25 %');clock.t+=50;}
 const slow=watch(4);
 for(let id=1;id<=4;id++){assert.equal(slow.w.correction(id),null);slow.clock.t+=600;}
});

test('one line per cooldown while the burst goes on', ()=>{
 const {w,clock,lines}=watch(3);
 for(let round=0;round<3;round++){for(let id=1;id<=3;id++)w.correction(id);clock.t+=4000;}
 assert.equal(lines.length,1);
 clock.t+=BURST_COOLDOWN_MS;for(let id=1;id<=3;id++)w.correction(id);
 assert.equal(lines.length,2);
});

test('the line says which side went quiet: browsers, the server, or the gateway itself', ()=>{
 const {w,clock}=watch(3);
 for(const id of [1,2,3]){w.browser(id);w.native(id);}
 // Browsers 1 and 2 silent for 1.5 s (test PC / internet path); the server kept talking to everyone.
 for(let step=0;step<15;step++){clock.t+=100;w.native(1);w.native(2);w.native(3);w.browser(3);w.loop(2);}
 w.browser(1);w.loop(250);w.rpc('CL_ConsoleMessage');w.rpc('ReadClientMove');clock.t+=50;w.rpc('create::player_soldier');w.rpc('CL_ConsoleMessage');
 w.resync(1);w.resync(2);
 w.correction(1,{lateS:1.2});w.correction(2,{lateS:1.4});const line=w.correction(3,{lateS:0.85});
 // Session 2's silence is still open (1550 ms); session 1's ended at 1500 ms.
 assert.match(line,/resyncs10s=2 browserGapMs=1550 browserGapSessions=2 nativeGapMs=- nativeGapSessions=0 loopLagMs=250 /);
 assert.match(line,/before=\[CL_ConsoleMessage×2@-0,create::player_soldier×1@-0\]$/);
 assert.doesNotMatch(line,/ReadClientMove/);
});

test('lists keep only the look-back window; metrics keep the worst tick lag', ()=>{
 const {w,clock}=watch(3);
 w.loop(400);w.resync(1);for(let i=0;i<200;i++)w.rpc('X'+i);
 assert.equal(w.recentLagMs(),400);assert.equal(w.recent.length,64);
 clock.t+=LOOK_BACK_MS+1;w.loop(1);w.resync(2);w.rpc('Y');
 assert.equal(w.recentLagMs(),0);assert.equal(w.metrics.loopLagMaxMs,400);
 assert.deepEqual([w.resyncs.length,w.recent.length],[1,1]);
 w.end(1);assert.equal(w.sessions.has(1),false);
});
