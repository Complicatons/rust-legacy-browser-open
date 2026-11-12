// P7 cheat helper (tools/native/cheats.mjs): headings, forged gateway commands, the flag reader and verdicts, and the
// page-side engine against a fake page. The forged commands are fed to the real gateway checks (bridge/anticheat.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {along,unityForward,browserForward,unityYawOfBrowserDir,lookRotation,lineClear,pathSlope,pickHeading,forgedMove,meleeHit,bulletFire,bowFire,bowHit,
 contextQuery,ngcTarget,contextTarget,rejections,serverReaction,newFlags,countKinds,flagView,judge,cleanVerdict,createFlagReader,cheatEngine,eyeOf,EYE_HEIGHT} from '../tools/native/cheats.mjs';
import {PlayerWatch,arrowPath} from '../bridge/anticheat.mjs';
import {FrameLog} from '../tools/native/lib.mjs';
import {ROWS,selectRows} from '../tools/native/lib.mjs';

const near=(a,b,e=1e-6)=>a.every((v,i)=>Math.abs(v-b[i])<e);

test('headings: Unity yaw, browser space and the camera direction agree', ()=>{
 assert.ok(near(unityForward(0),[0,0,1]));assert.ok(near(unityForward(90),[1,0,0]));
 assert.ok(near(browserForward(0),[0,0,-1]));
 assert.ok(near(along([1,2,3],90,10),[11,2,3]));assert.ok(near(along([1,2,3],0,10,{browser:false}),[1,2,13]));
 // A browser camera looking along browser -z is Unity yaw 0; along +x is Unity yaw 90.
 assert.ok(Math.abs(unityYawOfBrowserDir([0,0,-1]))<1e-9);assert.ok(Math.abs(unityYawOfBrowserDir([1,0,0])-90)<1e-9);
 for(const yaw of [-170,-45,0,30,135])assert.ok(Math.abs(unityYawOfBrowserDir(browserForward(yaw))-yaw)<1e-9,String(yaw));
});

test('lookRotation: the gateway\'s arrow path from the rotation passes through the aimed point', ()=>{
 const from=[10,20,30],to=[14,19,33],q=lookRotation(from,to),path=arrowPath(from,q,80,0),t=Math.hypot(4,-1,3)/80;
 assert.ok(near(path(t),to,1e-4),JSON.stringify(path(t)));
 assert.ok(Math.abs(Math.hypot(...q)-1)<1e-9);
});

test('lineClear, pathSlope and pickHeading keep cheats off hills, water and colliders', ()=>{
 const flat=()=>10,hill=(x)=>x>5&&x<7?12:10;
 assert.equal(lineClear(flat,[0,10,0],[15,10,0]),true);
 assert.equal(lineClear(hill,[0,10,0],[15,10,0]),false,'a 2 m bump cuts the lifted line');
 assert.equal(pathSlope(flat,[0,10,0],[20,10,0]),0);assert.ok(pathSlope((x)=>x,[0,0,0],[20,0,0])>44);
 // Camera ray hits at 5 m on yaw 0; yaw 45 runs into water; yaw 90 is clear.
 const ground=(x,z)=>z>3?-5:10;
 const pick=pickHeading([{yaw:0,ray:5},{yaw:180,ray:null},{yaw:90,ray:null}],{from:[0,10,0],ground,need:10,waterLine:0});
 assert.equal(pick.yaw,90);
 assert.equal(pickHeading([{yaw:0,ray:3}],{need:10}),null);
 // With `line`, a straight jump over a bump is refused.
 assert.equal(pickHeading([{yaw:90,ray:null}],{from:[0,10,0],ground:hill,need:4,line:15}),null);
});

test('forged commands have the gateway protocol shapes', ()=>{
 const last={type:'move',origin:[1,2,3],angles:{yaw:30,pitch:5},stateFlags:4,at:1000};
 assert.deepEqual(forgedMove(last,{origin:[61,2,3]}),{type:'move',origin:[61,2,3],angles:{yaw:30,pitch:5},stateFlags:4,at:1050});
 assert.deepEqual(forgedMove(last,{origin:[1,2,3],yaw:-150}).angles,{yaw:-150,pitch:5});
 const box={carrier:900,innerID:3};
 assert.deepEqual(ngcTarget(box,7),{p1:7,p2:3});assert.deepEqual(contextTarget(box),{carrier:900,innerID:3});
 assert.deepEqual(meleeHit(50,{point:[1,2,3]}),{type:'item',viewId:50,action:'melee-hit',data:{point:[1,2,3],flag:false}});
 assert.deepEqual(meleeHit(50,{target:{p1:7,p2:3},point:[1,2,3]}).data.target,{p1:7,p2:3});
 assert.deepEqual(bulletFire(50,[{target:{p1:7,p2:3},point:[0,0.4,0]}]).data.hits,[{target:{p1:7,p2:3},bodyPart:254,point:[0,0.4,0]}]);
 assert.deepEqual(bowFire(50,[1,2,3],[0,0,0,1]).data,{origin:[1,2,3],rotation:[0,0,0,1]});
 assert.deepEqual(bowHit(50,{p1:7,p2:3},[4,5,6]).data,{target:{p1:7,p2:3},position:[4,5,6]});
 assert.deepEqual(contextQuery({carrier:900,innerID:3}),{type:'context',action:'query',target:{carrier:900,innerID:3}});
 assert.ok(near(eyeOf([1,2,3]),[1,2+EYE_HEIGHT,3]));
});

test('forged commands are what the real gateway checks flag', ()=>{
 const clock={t:100},w=new PlayerWatch({subject:'s',limits:{},now:()=>clock.t,wallNow:()=>clock.t*1000});
 w.observe({type:'create',mine:true,prefab:':player_soldier',viewId:20,position:[0,10,0]});clock.t+=3;
 for(let i=1;i<=10;i++){clock.t+=0.1;assert.equal(w.check({type:'move',origin:[0,10,i*0.3],angles:{yaw:0,pitch:0}}).allow,true);}
 const last={origin:[0,10,3],angles:{yaw:0,pitch:0},stateFlags:0,at:0};
 const v=w.check(forgedMove(last,{origin:along(last.origin,90,60,{browser:false})}));
 assert.deepEqual(v,{allow:false,reason:'impossible-move'});assert.equal(w.counts.teleport,1);
 // Five Rock hits 30 ms apart on an item the gateway knows (Rock fireRate 1.95 s): two pass, three are dropped.
 const rock=new Uint8Array(6);new DataView(rock.buffer).setInt32(2,-971007166,true);
 const ww=new PlayerWatch({subject:'s',weapons:new Map([[-971007166,{name:'Rock',fireRate:1.95,pellets:1}]]),now:()=>clock.t});
 ww.observe({type:'create',mine:true,prefab:'rock.irp',viewId:50,initialData:rock});
 const out=[];for(let i=0;i<5;i++){clock.t+=0.03;out.push(ww.check(meleeHit(50,{point:[0,10,1]})).allow);}
 assert.deepEqual(out,[true,true,false,false,false]);assert.equal(ww.counts['fire-rate'],1);
});

test('what came back: rejections, server reaction, flags and verdicts', ()=>{
 let now=1000;const frames=new FrameLog({now:()=>now});
 frames.add(JSON.stringify({type:'create',viewId:20,prefab:':player_soldier',mine:true,position:[0,0,0]}),'rx');
 now=2000;frames.add(JSON.stringify({type:'command-rejected',reason:'impossible-move'}),'rx');
 frames.add(JSON.stringify({type:'rpc',viewId:20,name:'ReadClientMove',args:{values:[[1,2,3],0,0,0]}}),'rx');
 frames.add(JSON.stringify({type:'rpc',viewId:1,name:'KP',args:{values:[142]}}),'rx');
 assert.deepEqual(rejections(frames,1500),['impossible-move']);
 const re=serverReaction(frames,1500,{open:false});
 assert.deepEqual([re.corrections,re.rollbacks,re.unstick,re.kp,re.open],[1,[[1,2,3]],0,[142],false]);
 const flags=[{id:9,kind:'speed'},{id:7,kind:'teleport',severity:40,score:40,detail:{detail:{distance:60},replay:[{},{}]}},{id:5,kind:'speed'}];
 assert.deepEqual(newFlags(flags,5).map(f=>f.id),[7,9]);assert.deepEqual(countKinds(flags),{speed:2,teleport:1});
 assert.deepEqual(flagView(flags[1]),{id:7,kind:'teleport',severity:40,score:40,detail:{distance:60},replay:2});
 assert.equal(judge(flags,{expect:['teleport']}).ok,true);
 assert.match(judge(flags,{expect:['fly'],forbid:['speed']}).reason,/not flagged: fly; unexpected flags: speed x2/);
 assert.match(judge([],{expectRejected:['fire-rate'],rejected:[]}).reason,/did not drop it/);
 assert.deepEqual(cleanVerdict({flags:[]}),{ok:true,kinds:{},reason:null});
 assert.match(cleanVerdict({flags:[{id:1,kind:'hover'}],rejected:['fire-rate'],reaction:{corrections:2,kp:[]}}).reason,/1 gateway flag during normal play: hover x1; the gateway dropped 1 command \(fire-rate\); 2 server corrections/);
});

test('flag reader: mark, wait for kinds, settle; errors name the HTTP status', async()=>{
 let flags=[],t=0;const calls=[];
 const api=async(m,p)=>{calls.push(p);return {status:200,body:{flags:[...flags].reverse()}};};
 const r=createFlagReader({api,path:()=>'/admin/servers/x',subject:()=>'u u',sleep:async ms=>{t+=ms;const add=f=>{if(!flags.some(x=>x.id===f.id))flags.push(f);};if(t>=1000)add({id:3,kind:'fly'});if(t>=2000)add({id:4,kind:'hover'});},now:()=>t});
 flags=[{id:1,kind:'speed'},{id:2,kind:'speed'}];
 assert.equal(await r.mark(),2);assert.equal(calls[0],'/admin/servers/x/flags?player=u%20u');
 assert.deepEqual((await r.waitFor(2,['fly','hover'],{ms:10000})).map(f=>f.kind),['fly','hover']);
 assert.deepEqual((await r.settle(4,{ms:100})),[]);
 const timeout=await r.waitFor(4,['noclip'],{ms:1500});assert.deepEqual(timeout,[]);
 const bad=createFlagReader({api:async()=>({status:403,body:{error:'insufficient-role'}}),path:()=>'/a',subject:()=>'u'});
 await assert.rejects(bad.list(),/HTTP 403 insufficient-role/);
});

test('cheat engine: send goes on the play sockets; glide, pin and push hold the feet through explorerDev.teleport', async()=>{
 const sent=[],tps=[];let feet=[0,10,0];
 globalThis.window={explorerState:{player:{get feet(){return feet;}},online:{state:'in-game'}},
  explorerDev:{teleport:p=>{tps.push(p);feet=p.slice();},airdropGround:()=>12},
  __rlbNetShape:{sockets:new Set([{readyState:1,send:s=>sent.push(JSON.parse(s))},{readyState:3,send:()=>assert.fail('closed socket')}])}};
 try{
  assert.equal(cheatEngine(),true);const c=window.__rlbCheat;
  assert.equal(c.send({type:'move'}),1);assert.deepEqual(sent,[{type:'move'}]);
  const end=await c.glide(null,[0,15,0],80);assert.ok(Math.abs(end[1]-15)<1e-9);assert.ok(tps.some(p=>p[1]>10&&p[1]<15),'in between');
  tps.length=0;await c.pin([1,2,3],50);assert.ok(tps.length>=2&&tps.every(p=>near(p,[1,2,3])));
  feet=[0,12,0];const at=await c.push([1,0],20,200);assert.ok(at[0]>2.5&&at[0]<6,String(at[0]));assert.ok(Math.abs(at[1]-12.02)<1e-9,'follows the page ground');
  // A new job ends the running one (its promise resolves) and stop() is safe twice.
  const a=c.pin([0,0,0],10000),b=c.pin([5,5,5],30);assert.ok(Array.isArray(await a));await b;c.stop();c.stop();assert.equal(c.busy(),false);
 }finally{delete globalThis.window;}
});

test('P7 rows: one system, every cheat needs the website role, the range rows admin; clean runs last', ()=>{
 const p7=selectRows(ROWS,'Anti-cheat');
 assert.deepEqual(p7.map(r=>r.id),selectRows(ROWS,'p7.*').map(r=>r.id));
 assert.ok(p7.every(r=>r.site&&r.mock===true));
 assert.deepEqual(p7.filter(r=>r.admin).map(r=>r.id),['p7.wall-melee','p7.wall-shot','p7.wall-arrow','p7.wall-use','p7.aim-snap','p7.hover-structure']);
 assert.equal(p7.at(-1).id,'p7.clean');
 assert.ok(ROWS.indexOf(p7.at(-1))<ROWS.findIndex(r=>r.id==='deploy.sleepingbag'),'before the rows that respawn or rejoin');
});
