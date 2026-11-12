// Pure pieces of the real-server harnesses (tools/native/lib.mjs): arguments, config validation and secrets, row
// filtering, results recording/markdown, the gateway frame log, sky/clock decoding and soak statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseArgs,validateConfig,withDefaults,readSecret,configFromEnv,loadConfig,redactConfig,redactText,findInlineSecrets,ROWS,selectRows,plannedSkip,
 createRecorder,toMarkdown,writeResults,ok,FrameLog,summariseFrame,consoleMessage,decodeSkyState,clockDrift,percentile,describe,slopePerSecond,parsePrometheus,runStamp,parseNet} from '../tools/native/lib.mjs';

const real={centralUrl:'https://192.168.56.1:8443',serverId:'408de739-9727-4e95-884c-8ddbbbc87898',player:{auth:'password',login:'native-tester',passwordEnv:'RLB_NATIVE_PASSWORD'}};

test('parseArgs: flags, values, inline values and errors',()=>{
 assert.deepEqual(parseArgs(['--mock','--rows','move.*,chat.say','--dry']),{...parseArgs([]),mock:true,dry:true,rows:'move.*,chat.say'});
 assert.equal(parseArgs(['--config=x.json']).config,'x.json');
 const s=parseArgs(['--bots','3','--duration','60','--behaviours','walk, chat']);assert.equal(s.bots,3);assert.equal(s.duration,60);assert.deepEqual(s.behaviours,['walk','chat']);
 assert.throws(()=>parseArgs(['--rows']),/needs a value/);assert.throws(()=>parseArgs(['--rows','--dry']),/needs a value/);
 assert.equal(parseArgs(['--bots','0']).bots,0);assert.throws(()=>parseArgs(['--bots','-1']),/whole number/);assert.throws(()=>parseArgs(['--duration','-1']),/positive number/);
 assert.throws(()=>parseArgs(['--frobnicate']),/unknown argument/);
});

test('parseArgs: load-test flags (lite bots, stages, bad network)',()=>{
 const o=parseArgs(['--lite','44','--stages','10,20,50','--stage-seconds','300','--net','latency=250,jitter=50,loss=2','--inventory-check','--label','load a']);
 assert.equal(o.lite,44);assert.deepEqual(o.stages,[10,20,50]);assert.equal(o.stageSeconds,300);assert.deepEqual(o.net,{latency:250,jitter:50,loss:2});assert.equal(o.inventoryCheck,true);assert.equal(o.label,'loada');
 assert.equal(parseArgs(['--lite','0']).lite,0);assert.throws(()=>parseArgs(['--lite','-1']),/whole number/);assert.throws(()=>parseArgs(['--stages','10,x']),/positive integer/);
 assert.deepEqual(parseNet('latency=100'),{latency:100,jitter:0,loss:0});
 assert.throws(()=>parseNet('delay=5'),/unknown key/);assert.throws(()=>parseNet('loss=80'),/bad value/);assert.throws(()=>parseNet('latency=-3'),/bad value/);
});

test('validateConfig: a complete real config passes; endpoints, accounts and numbers are checked',()=>{
 assert.deepEqual(validateConfig(withDefaults(real)),[]);
 assert.deepEqual(validateConfig({},{mock:true}),[]);
 const e=validateConfig({centralUrl:'ftp://x',serverId:'nope',player:{auth:'password',login:'a'},walkSeconds:-2});
 assert.ok(e.some(x=>/centralUrl/.test(x))&&e.some(x=>/serverId/.test(x))&&e.some(x=>/passwordEnv or passwordFile/.test(x))&&e.some(x=>/walkSeconds/.test(x)),e.join('\n'));
 assert.ok(validateConfig({...real,player:{auth:'magic'}}).some(x=>/auth must be/.test(x)));
 assert.ok(validateConfig({...real,player:{auth:'dev'}}).some(x=>/subject required/.test(x)));
 assert.ok(validateConfig({...real,gameUrl:'https://elsewhere.example/play'}).some(x=>/share the website origin/.test(x)));
 assert.deepEqual(validateConfig({...real,gameUrl:'https://192.168.56.1:8443/play'}),[]);
 assert.ok(validateConfig({...real,metrics:{url:'http://192.168.56.10:8080/metrics'}}).some(x=>/tokenEnv or tokenFile/.test(x)));
});

test('validateConfig: inline secrets are rejected anywhere in the file',()=>{
 const e=validateConfig({...real,player:{...real.player,password:'hunter2'},rconPassword:'x',metrics:{url:'http://h/metrics',token:'t'}});
 for(const p of ['player.password','rconPassword','metrics.token'])assert.ok(e.some(x=>x.startsWith(p+':')),p+' in '+e.join('\n'));
 assert.deepEqual(findInlineSecrets({a:{password:''},b:{password:null}}),[],'empty values are not secrets');
 assert.equal(JSON.stringify(redactConfig({player:{password:'hunter2',passwordEnv:'X'}})).includes('hunter2'),false);
 assert.equal(redactText('rcon.login hunter2 now',['hunter2']),'rcon.login [redacted] now');
});

test('validateConfig: soak bot accounts need a {n} pattern and known behaviours',()=>{
 const soak={centralUrl:real.centralUrl,serverId:real.serverId,bots:{accounts:{auth:'password',loginPattern:'soak-bot-{n}',passwordEnv:'RLB_SOAK_PASSWORD'}}};
 assert.deepEqual(validateConfig(withDefaults(soak),{soak:true}),[]);
 assert.ok(validateConfig({...soak,bots:{accounts:{auth:'password',loginPattern:'bot',passwordEnv:'X'}}},{soak:true}).some(x=>/\{n\}/.test(x)));
 assert.ok(validateConfig({...soak,soak:{behaviours:['walk','dance']}},{soak:true}).some(x=>/behaviours/.test(x)));
 assert.ok(validateConfig({...soak,soak:{bots:65}},{soak:true}).some(x=>/soak.bots/.test(x)));assert.ok(!validateConfig({...soak,soak:{bots:0}},{soak:true}).some(x=>/soak.bots/.test(x)));
});

test('secrets come only from env vars or files; env overrides build a config',()=>{
 assert.equal(readSecret({passwordEnv:'P'},'password',{env:{P:'s3cret'}}),'s3cret');
 assert.throws(()=>readSecret({passwordEnv:'P'},'password',{env:{}}),/P is not set/);
 assert.equal(readSecret({passwordFile:'f'},'password',{readFile:()=>'fromfile\n'}),'fromfile');
 assert.equal(readSecret({},'password'),null);
 const env={RLB_NATIVE_CENTRAL:'https://h',RLB_NATIVE_SERVER:'abcdef12-0000',RLB_NATIVE_LOGIN:'me',RLB_NATIVE_RCON_PASSWORD:'r'};
 assert.deepEqual(configFromEnv(env),{centralUrl:'https://h',serverId:'abcdef12-0000',player:{auth:'password',login:'me',passwordEnv:'RLB_NATIVE_PASSWORD'},rconPasswordEnv:'RLB_NATIVE_RCON_PASSWORD'});
 const c=loadConfig({file:'c.json',env:{RLB_NATIVE_SERVER:'ffffffff-1'},readFile:()=>JSON.stringify({serverId:'00000000-1',walkSeconds:3})});
 assert.equal(c.serverId,'ffffffff-1','env wins over the file');assert.equal(c.walkSeconds,3);assert.equal(c.replyMs,8000,'defaults filled in');
});

test('selectRows: ids, globs, systems, exclusions, matrix order, unknown terms',()=>{
 const ids=f=>selectRows(ROWS,f).map(r=>r.id);
 assert.equal(ids(null).length,ROWS.length);assert.equal(ids('all').length,ROWS.length);
 assert.deepEqual(ids('chat.say,move.*'),['move.walk','move.modes','chat.say','move.fall'],'matrix order, not filter order');
 assert.deepEqual(ids('Movement'),['move.walk','move.modes','move.fall']);
 assert.deepEqual(ids('movement,-move.fall'),['move.walk','move.modes']);
 assert.equal(ids('-Join/spawn').includes('join.website'),false);assert.equal(ids('-Join/spawn').length,ROWS.length-4);
 assert.deepEqual(ids('*.say'),['chat.say']);
 assert.throws(()=>ids('chat.sya'),/unknown row or system "chat.sya"/);
 assert.equal(new Set(ROWS.map(r=>r.id)).size,ROWS.length,'row ids are unique');
});

test('plannedSkip: manual rows always, real-only rows on the mock',()=>{
 const row=id=>ROWS.find(r=>r.id===id);
 assert.match(plannedSkip(row('voice.clients')),/^manual:/);
 assert.equal(plannedSkip(row('gather.node')),null);assert.match(plannedSkip(row('gather.node'),{mock:true}),/real server only/);
 assert.equal(plannedSkip(row('airdrop.drop'),{mock:true}),null,'partial rows run on the mock');
 assert.equal(plannedSkip(row('chat.say'),{mock:true}),null);
});

test('Admin tools rows: website-admin rows before net.kick, skipped without a target account or desktop client',()=>{
 const row=id=>ROWS.find(r=>r.id===id),admin=ROWS.filter(r=>r.system==='Admin tools');
 assert.deepEqual(admin.map(r=>r.id),['admin.teleport-to','admin.bring','admin.message','admin.report','admin.desktop-list','admin.kick-native','admin.ban-native','admin.unban-native','admin.join-policy']);
 assert.ok(admin.every(r=>r.site&&r.mock===true&&r.needs?.length));
 assert.ok(ROWS.indexOf(admin.at(-1))<ROWS.indexOf(row('net.kick')),'net.kick ends our session, so it runs after them');
 assert.match(plannedSkip(row('admin.bring'),{config:real}),/second website account/);
 assert.match(plannedSkip(row('admin.kick-native'),{config:real}),/desktop client/);
 assert.equal(plannedSkip(row('admin.bring'),{config:{...real,target:{auth:'password',login:'t',passwordEnv:'T'}}}),null);
 assert.equal(plannedSkip(row('admin.bring')),null,'without a config only manual/real-only rules apply');
 // Config: target is a second password account (never the player), desktop a character name.
 const target={auth:'password',login:'native-target',passwordEnv:'RLB_NATIVE_TARGET_PASSWORD'};
 assert.deepEqual(validateConfig(withDefaults({...real,target,desktop:{name:'Desk'}})),[]);
 assert.ok(validateConfig({...real,target:{...target,login:'native-tester'}}).some(x=>/different account/.test(x)));
 assert.ok(validateConfig({...real,target:{auth:'password',login:'t'}}).some(x=>/target: set passwordEnv/.test(x)));
 assert.ok(validateConfig({...real,desktop:{name:''}}).some(x=>/desktop.name/.test(x)));
 assert.ok(validateConfig({...real,adminWaitMs:0}).some(x=>/adminWaitMs/.test(x)));
 assert.deepEqual(configFromEnv({RLB_NATIVE_TARGET_LOGIN:'t',RLB_NATIVE_DESKTOP_NAME:'Desk'}),{target:{auth:'password',login:'t',passwordEnv:'RLB_NATIVE_TARGET_PASSWORD'},desktop:{name:'Desk'}});
});

test('recorder: statuses, durations, summary, markdown and files',async()=>{
 let now=1000;const rec=createRecorder({run:{mode:'mock'},now:()=>now});
 const a=rec.begin(ROWS[0]);now+=1500;rec.finish(a,'pass',{evidence:{inGameMs:900,screenshots:['join.website-in-game.png']}});
 const b=rec.begin(ROWS[4]);now+=200;rec.finish(b,'fail',{reason:'2 | corrections',evidence:{corrections:2}});
 rec.skip(ROWS.at(-1),'manual: x');
 assert.throws(()=>rec.finish(rec.begin(ROWS[1]),'maybe'),/bad status/);rec.rows.pop();
 assert.deepEqual(rec.summary(),{pass:1,fail:1,skip:1,error:0});assert.equal(ok(rec.summary()),false);assert.equal(ok({pass:3,fail:0,skip:2,error:0}),true);
 const result=rec.result({rpcCounts:{'ConsoleNetworker.CL_ConsoleMessage':3}});assert.equal(result.rows[0].ms,1500);assert.equal(result.run.mode,'mock');
 const md=toMarkdown(result);
 assert.match(md,/1 pass, 1 fail, 0 error, 1 skip/);assert.match(md,/\| `move.walk` \| Movement \| \*\*fail\*\* \| 0.2 s \| 2 \\\| corrections — corrections: 2 \|/);
 assert.match(md,/\[join.website-in-game.png\]\(join.website-in-game.png\)/);assert.match(md,/CL_ConsoleMessage: 3/);
 const dir=await mkdtemp(path.join(tmpdir(),'native-'));
 try{const files=await writeResults(dir,result);assert.deepEqual(JSON.parse(await readFile(files.json,'utf8')).summary,result.summary);assert.equal(await readFile(files.md,'utf8'),md);}
 finally{await rm(dir,{recursive:true,force:true});}
 assert.match(runStamp(new Date('2026-10-20T17:42:38.305Z')),/^2026-10-20T17-42-38$/);
});

test('FrameLog: own character, corrections, waitFor, rpc counts and redaction',async()=>{
 let now=0;const log=new FrameLog({now:()=>now,redact:['hunter2']}),rx=e=>log.add(JSON.stringify(e),'rx'),tx=e=>log.add(JSON.stringify(e),'tx');
 rx({type:'approved',playerId:1,world:{sendRate:10}});
 rx({type:'create',viewId:30,prefab:':player_soldier',owner:2,mine:false,position:[0,0,0]});
 now=10;rx({type:'create',viewId:20,prefab:':player_soldier',owner:1,mine:true,position:[1,2,3],rotation:[0,0.7071,0,0.7071]});
 assert.equal(log.characterView,20);
 assert.deepEqual(log.rx(0,f=>f.viewId===20)[0].rotation,[0,0.7071,0,0.7071],'join.facing reads the spawn rotation from the Create');
 now=20;rx({type:'rpc',viewId:30,name:'ReadClientMove',args:{class:'Character',values:[[0,0,0],0,0,0.05]}}); // someone else's move
 tx({type:'rpc',viewId:997,name:'SV_RunConsoleCommand',args:['rcon.login hunter2']});
 assert.equal(log.corrections(0).length,0);
 now=30;rx({type:'rpc',viewId:20,name:'ReadClientMove',args:{class:'Character',values:[[1,2,3],0,0,0.05]}});
 rx({type:'rpc',viewId:1,name:'UnstickMove',args:{class:'ServerManagement',values:[[1,2,3]]}});
 assert.equal(log.corrections(0).length,2);assert.equal(log.corrections(31).length,0);
 assert.equal(log.tx(0)[0].values[0],'rcon.login [redacted]');assert.equal(JSON.stringify(log.frames).includes('hunter2'),false);
 assert.equal(log.rpcCounts['ServerManagement.UnstickMove'],1);assert.deepEqual(log.counts.rx>0&&log.counts.tx,1);
 const later=log.waitFor(31,consoleMessage,1000,{poll:1,sleep:async()=>{now+=5;if(now===40)rx({type:'rpc',viewId:997,name:'CL_ConsoleMessage',args:{class:'ConsoleNetworker',values:['hostname: x']}});}});
 assert.equal((await later).values[0],'hostname: x');
 assert.equal(await log.waitFor(1000,consoleMessage,20,{poll:1,sleep:async()=>{now+=5;}}),null,'times out');
 now=50;rx({type:'destroy',kind:'view',viewId:20});assert.equal(log.characterView,null);
 assert.deepEqual(summariseFrame('not json','rx'),{dir:'rx',type:'invalid',bytes:8});
 const big=summariseFrame(JSON.stringify({type:'rpc',viewId:20,name:'GNUP',args:{class:'Inventory',values:[{base64:'AAAAAAAA'}]}}),'rx');assert.deepEqual(big.values,[{bytes:6}]);
 const keep=summariseFrame(JSON.stringify({type:'rpc',viewId:996,name:'CL_UpdateSkyState',args:{values:[{base64:'AAAA'}]}}),'rx');assert.deepEqual(keep.values,[{base64:'AAAA'}]);
 const fl=new FrameLog({keep:3});for(let i=0;i<5;i++)fl.add('{"type":"move"}','tx');assert.equal(fl.frames.length,3);assert.equal(fl.counts.tx,5);
});

// Against the original server join.website took ~10 min (headless world load) while world traffic kept arriving; a
// plain 20000-frame ring had dropped the spawn's GNUP by the time join.inventory looked for it (P5 run 2026-10-21).
test('FrameLog keeps the join one-shot frames past keep while world traffic is dropped',async()=>{
 let now=0;const log=new FrameLog({now:()=>now,keep:100}),rx=e=>log.add(JSON.stringify(e),'rx');
 rx({type:'approved',playerId:1,world:{sendRate:5}});
 now=1;rx({type:'create',viewId:20,prefab:':player_soldier',owner:1,mine:true,position:[0,0,0]});
 rx({type:'create',viewId:30,prefab:':player_soldier',owner:2,mine:false,position:[0,0,0]});
 rx({type:'rpc',viewId:20,name:'GNUP',args:{class:'Inventory',values:[{base64:'AAAA'}]}});
 rx({type:'rpc',viewId:20,name:'ReceiveBoundBPs',args:{class:'PlayerInventory',values:[{base64:'AA=='}]}});
 for(let i=0;i<5000;i++){now=2+i;rx({type:'rpc',viewId:60000+i%50,name:'GetNetworkUpdate',args:{class:'BasicWildLifeAI',values:[[0,0,0]]}});}
 const unpinned=log.frames.filter(f=>f.name==='GetNetworkUpdate');
 assert.ok(unpinned.length>=100&&unpinned.length<=110,'world traffic still bounded: '+unpinned.length);
 assert.equal(unpinned.at(-1).t,5001,'newest kept');assert.ok(unpinned[0].t>4800,'oldest dropped');
 assert.deepEqual(log.frames.slice(0,4).map(f=>f.type==='rpc'?f.name:f.type),['approved','create','GNUP','ReceiveBoundBPs'],'pinned, in order');
 assert.equal(log.frames.some(f=>f.type==='create'&&f.viewId===30),false,'another player character is not pinned');
 const g=await log.waitFor(0,f=>f.dir==='rx'&&f.type==='rpc'&&f.name==='GNUP'&&f.viewId===log.characterView,0);
 assert.equal(g?.t,1,'the spawn GNUP is still found from the join on');
 assert.equal(log.counts.rx,5005);
});

test('decodeSkyState and clockDrift',()=>{
 const b=Buffer.alloc(38);b.writeFloatLE(45,0);b.writeFloatLE(15,4);b.writeFloatLE(0.5,8);b.writeInt32LE(2014,28);b[32]=6;b[33]=15;b.writeFloatLE(21.5,34);
 assert.deepEqual(decodeSkyState({base64:b.toString('base64')}),{daylength:45,nightlength:15,moonPhase:0.5,year:2014,month:6,day:15,hour:21.5});
 assert.equal(decodeSkyState({base64:Buffer.alloc(10).toString('base64')}),null);assert.equal(decodeSkyState(null),null);
 const d=clockDrift([{t:0,serverMs:5000},{t:500},{t:10000,serverMs:15050}]);assert.deepEqual(d,{samples:2,localMs:10000,serverMs:10050,ratio:1.005});
 assert.equal(clockDrift([{t:0,serverMs:1}]),null);
});

test('soak statistics and Prometheus parsing',()=>{
 assert.equal(percentile([5,1,3,2,4],50),3);assert.equal(percentile([1,2,3,4,100],95),100);assert.equal(percentile([],50),null);
 assert.deepEqual(describe([10,20,30,NaN]),{n:3,min:10,p50:20,p95:30,max:30,mean:20});assert.deepEqual(describe([]),{n:0});
 assert.equal(slopePerSecond([[0,100],[1000,102],[2000,104]]),2);assert.equal(slopePerSecond([[0,1]]),null);
 assert.deepEqual(parsePrometheus('# HELP x\nrlb_gateway_sessions 3\nrlb_gateway_reports_total{result="ok"} 245\nbad line\n'),{rlb_gateway_sessions:3,'rlb_gateway_reports_total{result="ok"}':245});
});
