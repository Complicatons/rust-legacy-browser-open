// Desktop combat checks from the vanilla adapter's server-side facts (ANTICHEAT-ADMIN-PLAN.md slice 8): fire rate on
// arrival times, hit range, the server's own line of sight and the head-shot ratio, as flags on the desktop player's
// PlayerWatch; plus source checks that tools/vanilla-patcher passes each evidence hook what its C# signature takes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {DesktopCombat} from '../bridge/desktop-combat.mjs';
import {PlayerWatch} from '../bridge/anticheat.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender,DESKTOP_LIMITS} from '../bridge/adapter.mjs';

const M4={uid:-1852181914,name:'M4',rate:0.125};
function watch(){const clock={t:100,wall:1_800_000_000_000};return {clock,w:new PlayerWatch({subject:'h',name:'Desk',playerId:0,limits:DESKTOP_LIMITS,now:()=>clock.t,wallNow:()=>clock.wall})};}
const hit=(extra={})=>({id:'1',uid:M4.uid,name:'M4',range:140,kind:'player',target:'2',part:2,eye:[0,11.6,0],at:[0,10,30],end:[0,11,30],clear:true,...extra});

test('fire rate: arrival times at the weapon rate pass, faster ones are flagged once per poll', ()=>{
 const {w,clock}=watch(),c=new DesktopCombat();
 // A full M4 clip at 8 shots/s, arrivals bunched in twos by the network: within tolerance and burst.
 const honest=[];for(let i=0;i<24;i++)honest.push(10000+Math.floor(i/2)*250);
 c.shots(w,[{...M4,t:honest}]);assert.deepEqual(w.counts,{});
 // 40 shots in 1 s (a rate cheat the client's own timestamps could hide from ValidatePrimaryMessageTime).
 clock.t+=2;const fast=[];for(let i=0;i<40;i++)fast.push(20000+i*25);
 c.shots(w,[{...M4,t:fast}]);
 assert.equal(w.counts['fire-rate'],1);
 const d=w.evidence.at(-1).detail;assert.deepEqual([d.weapon,d.minInterval,d.shots,d.source,d.fastestGap],['M4',0.125,40,'server',0.03]);assert.ok(d.excess>=25&&d.excess<=35,String(d.excess));
 // Times from before the bucket's last shot (server restart, repeats) are never scored; bad entries are skipped.
 clock.t+=2;c.shots(w,[{...M4,t:[100,200,300]},{uid:'x',rate:1,t:[1]},{...M4,rate:0,t:[1]}]);assert.equal(w.counts['fire-rate'],1);
});

test('hits: range, the server line of sight and the head-shot ratio flag; visible hits in range do not', ()=>{
 const {w,clock}=watch(),c=new DesktopCombat();
 c.hit(w,hit());assert.deepEqual(w.counts,{});
 c.hit(w,hit({at:[0,10,200]}));assert.equal(w.counts['hit-range'],1);
 assert.deepEqual([w.evidence.at(-1).detail.distance,w.evidence.at(-1).detail.range,w.evidence.at(-1).detail.source],[200.01,140,'server']);
 clock.t+=3;c.hit(w,hit({clear:false,blockedBy:'rock_large',layer:10,blockedAt:[0,11,15.234]}),{targetName:'Bob'});
 const e=w.evidence.at(-1);assert.equal(e.kind,'wall-shot');
 assert.deepEqual([e.detail.target,e.detail.targetKind,e.detail.blockedBy,e.detail.layer,e.detail.at],['Bob','player','rock_large',10,[0,11,15.23]]);
 // Head-shot ratio after 15 player hits (animals do not count).
 for(let i=0;i<20;i++)c.hit(w,hit({kind:'animal',part:9}));assert.equal(w.counts['headshot-ratio'],undefined);
 for(let i=0;i<14;i++)c.hit(w,hit({part:9}));
 assert.equal(w.counts['headshot-ratio'],1);assert.equal(w.evidence.at(-1).detail.hits,15); // 3 body hits above, then 12 heads
 // Malformed facts are ignored.
 c.hit(w,{});c.hit(w,hit({eye:[0,1]}));
 assert.ok(w.replay.some(s=>s.kind==='hit'));
});

test('inventory spam: more server slot operations than the gateway bucket allows are flagged', ()=>{
 const {w}=watch(),c=new DesktopCombat();
 c.inventory(w,40,2);assert.deepEqual(w.counts,{}); // 10/s × 2 s + 20
 c.inventory(w,120,2);assert.equal(w.counts['command-rate'],1);assert.deepEqual(w.evidence.at(-1).detail,{command:'inventory',ops:120,seconds:2,allowed:40,source:'server'});
});

test('adapter: combat facts in a poll flag desktop players only, as desktop-flag events by handle', ()=>{
 const clock={t:1_800_000_000_000},key=randomBytes(32),send=createControlSender(key);
 const adapter=createIdentityAdapter({serverId:'srv',controlKey:key,now:()=>clock.t,identities:createIdentityMap()});
 // Facts for players without a desktop watch (browser sessions, which the gateway checks, or no sampled position) are ignored.
 const players=[{id:'76561198000000007',name:'Desk',pos:[0,10,0],life:'1'},{id:'76561198000000008',name:'Bob',pos:[0,10,30],life:'1'}];
 clock.t+=2000;adapter.setRoster(players);
 const fast=[];for(let i=0;i<40;i++)fast.push(50000+i*25);
 clock.t+=2000;adapter.setRoster(players);
 adapter.evidence({shots:[{id:'76561198000000007',...M4,t:fast},{id:'nope',...M4,t:fast}],hits:[hit({id:'76561198000000007',target:'76561198000000008',clear:false,blockedBy:'wall'}),hit({id:'76561198000000099'})],ops:{'76561198000000007':500},window:2});
 const flags=adapter.handleControl(send({serverId:'srv',type:'drain-events'})).events.filter(e=>e.type==='desktop-flag');
 assert.deepEqual(flags.map(f=>f.kind).sort(),['command-rate','fire-rate','wall-shot']);
 assert.ok(flags.every(f=>f.name==='Desk'&&/^[A-Za-z0-9_-]{16}$/.test(f.handle)));
 assert.equal(flags.find(f=>f.kind==='wall-shot').detail.target,'Bob');
 assert.ok(!JSON.stringify(flags).includes('76561198'),'native IDs never leave the adapter');
 assert.deepEqual(adapter.stats().evidence,{moves:0,transfers:0,shots:40,hits:2,lost:0});
 const row=adapter.handleControl(send({serverId:'srv',type:'drain-events'})).desktop.find(p=>p.name==='Desk');
 assert.ok(row.score>=50&&row.flags['wall-shot']===1,JSON.stringify(row));
});

// The patcher's evidence plan (tools/vanilla-patcher/Program.cs) must match the hooks' C# parameter lists, and every
// hook it names must exist: neither can run on this host, so drift would only show on a live server.
test('vanilla patcher: every evidence hook exists with the parameters the plan passes', ()=>{
 const plan=readFileSync(new URL('../tools/vanilla-patcher/Program.cs',import.meta.url),'utf8');
 const hooks=readFileSync(new URL('../adapter/vanilla/RustLegacyBrowserVanilla.Evidence.cs',import.meta.url),'utf8');
 const signature=new Map([...hooks.matchAll(/public static void (On\w+)\(([^)]*)\)/g)].map(m=>[m[1],m[2].trim()?m[2].split(',').length:0]));
 const calls=[...plan.matchAll(/(Entry|Exits)\((\w+|Exact\([^)]*\)), "(On\w+)",?\s*([-\d,\s]*)\)/g)].map(m=>({hook:m[3],args:m[4].split(',').map(s=>s.trim()).filter(Boolean).map(Number),exits:m[1]==='Exits'}));
 assert.ok(calls.length>=13,`${calls.length} plan entries`);
 for(const c of calls){
  const passed=c.exits?c.args.length-1:c.args.length; // Exits(method, hook, derefArg, args…)
  assert.ok(signature.has(c.hook),`${c.hook} missing from Evidence.cs`);
  assert.equal(signature.get(c.hook),passed,`${c.hook}: plan passes ${passed}, C# takes ${signature.get(c.hook)}`);
 }
 // Every evidence hook in the C# file is used by the plan, and the poll carries the facts.
 for(const name of signature.keys())assert.ok(calls.some(c=>c.hook===name),`${name} is never injected`);
 assert.match(readFileSync(new URL('../adapter/vanilla/RustLegacyBrowserVanilla.cs',import.meta.url),'utf8'),/ListPlayers\(\) \+ TakeEvidence\(\)/);
 assert.match(plan,/const int ExpectedSites = 21;/);
});
