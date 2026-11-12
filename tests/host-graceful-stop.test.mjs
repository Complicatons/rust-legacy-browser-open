// Save-and-quit for the game server (HOST-AND-LOADER-BUILD.md H1): the adapter's server-wide commands (save, broadcast,
// quit), the supervisor's graceful run with its kill fallback, and the host's Stop, Restart and scheduled restart on the
// mock game server, once over its console and once over the real adapter command queue with a stand-in for the server
// plugin's poll. No original binaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createSocket} from 'node:dgram';
import {createServer,request} from 'node:http';
import {createIdentityAdapter,createControlSender,SERVER_ACTIONS} from '../bridge/adapter.mjs';
import {createProcess} from '../host/supervisor.mjs';
import {createLogHub} from '../host/log-hub.mjs';
import {startHost} from '../host/host.mjs';
import {createServiceHandler} from '../host/service.mjs';
import {validateHostConfig} from '../host/config.mjs';
import {stopWarning} from '../host/dashboard/stop-text.mjs';
import {listenServer} from '../bridge/listen.mjs';

const until=async(pred,ms=15000,what='condition')=>{const t=Date.now();while(Date.now()-t<ms){if(await pred())return;await new Promise(r=>setTimeout(r,50));}throw Error(what+' not met');};
const freeUdpPort=()=>new Promise(r=>{const s=createSocket('udp4');s.bind(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});

test('adapter: server-wide save, broadcast and quit are a fixed list, carry no target, and report back to the host only',()=>{
 let t=1_000_000;const key=randomBytes(32),a=createIdentityAdapter({serverId:'s1',controlKey:key,now:()=>t}),send=createControlSender(key);
 const ctl=body=>a.handleControl(send({serverId:'s1',...body}));
 assert.deepEqual(Object.keys(SERVER_ACTIONS),['save','broadcast','quit']);
 assert.equal(ctl({type:'server-command',action:'save.all'}).reason,'malformed');
 assert.equal(ctl({type:'server-command',action:'broadcast'}).reason,'malformed');
 assert.equal(ctl({type:'server-command',action:'broadcast',message:'x'.repeat(201)}).reason,'malformed');
 assert.equal(a.handleControl(send({serverId:'other',type:'server-command',action:'save'})).reason,'wrong-server');
 // Before the plugin has polled, the host knows it cannot rely on it.
 assert.equal(ctl({type:'server-commands'}).plugin.polledAgoMs,null);
 const save=ctl({type:'server-command',action:'save'}),say=ctl({type:'server-command',action:'broadcast',message:' Restart in 5 minutes. '});
 assert.equal(save.ok,true);assert.match(save.id,/^[0-9a-f-]{36}$/);
 a.setRoster([{id:'76561198000000001',name:'Desk'}]);t+=500;
 const got=a.takeCommands();
 assert.deepEqual(got,[{id:save.id,action:'save'},{id:say.id,action:'broadcast',message:'Restart in 5 minutes.'}]); // no targetId
 t+=1500;
 assert.equal(a.commandResult({id:save.id,ok:true}),true);assert.equal(a.commandResult({id:say.id,ok:false,reason:'error'}),true);
 const st=ctl({type:'server-commands'});
 assert.equal(st.plugin.polledAgoMs,1500);assert.equal(st.plugin.players,1);
 assert.deepEqual(st.commands.map(c=>[c.action,c.state,c.reason??null]),[['save','done',null],['broadcast','failed','error']]);
 // Not website admin commands: nothing goes to the gateway's outbox for central.
 assert.deepEqual(ctl({type:'drain-events'}).events,[]);
 // Unclaimed server commands expire quietly.
 const quit=ctl({type:'server-command',action:'quit'});t+=61000;a.takeCommands();
 assert.equal(ctl({type:'server-commands'}).commands.find(c=>c.id===quit.id).state,'expired');
 assert.deepEqual(ctl({type:'drain-events'}).events,[]);
});

test('supervisor: a graceful run waits for the exit; a refused one, or one that does not end, falls back to the kill',async()=>{
 const code="process.stdin.on('data',d=>{if(String(d).includes('quit')){console.log('bye');process.exit(0);}});setInterval(()=>{},1000)";
 const hub=createLogHub(),runs=[];
 let answer=true;
 const spec={name:'server',command:process.execPath,args:['-e',code],gracefulStop:{run:async(c,{reason})=>{runs.push(reason);if(answer===true){c.stdin.write('quit\n');return 5000;}return answer;}}};
 const p=createProcess(spec,{hub,stopTimeoutMs:500});
 await p.start();await p.stop();
 assert.equal(p.info().lastExit.code,0);assert.ok(hub.since(0).some(l=>l.text==='bye'));
 answer=false;await p.start();await p.stop();
 assert.notEqual(p.info().lastExit.code,0); // killed
 answer=300;await p.start();const t=Date.now();await p.stop({reason:'restart'}); // asked, never quits: killed after 300 ms
 assert.ok(Date.now()-t<3000);assert.equal(p.state,'stopped');
 // A hang never asks: a frozen server cannot save.
 await p.start();await p.stop({reason:'hang'});
 assert.deepEqual(runs,['stop','stop','restart']);
});

test('stop dialog text: says the server saves first when it can, and what is lost when it cannot',()=>{
 assert.match(stopWarning({action:'stop',target:'server',graceful:{available:true,via:'adapter'},saveSeconds:60,lastSaveAgo:'4m'}),/saves the world first, then quits/);
 const blunt=stopWarning({action:'restart',target:'server',graceful:{available:false,reason:'the server plugin has not polled the sidecar'},lastSaveAgo:'4m'});
 assert.match(blunt,/ended at once/);assert.match(blunt,/4m ago/);assert.match(blunt,/has not polled/);
});

async function stack(t,{control,gracefulStop={saveSeconds:5,quitSeconds:5}}={}){
 const root=mkdtempSync(join(tmpdir(),'rlb-graceful-')),udp=await freeUdpPort();
 const config={listen:{host:'127.0.0.1',port:0},dataDir:join(root,'data'),components:{server:{kind:'mock',dir:join(root,'Rust Server'),port:udp,autosaveSeconds:3600,...(control?{control}:{}),gracefulStop}},
  watchdog:{enabled:false,hangSeconds:90,graceSeconds:300,probeEveryMs:1000}};
 assert.deepEqual(validateHostConfig({...config,listen:{host:"127.0.0.1",port:28100}}),[]);
 return {root,config};
}
const texts=host=>host.hub.since(0).map(l=>l.text);

test('host: Stop and Restart save first over the mock console; a scheduled restart in 0 minutes does the same',{timeout:60000},async()=>{
 const {root,config}=await stack();
 const host=await startHost(config,{noRemote:true});
 const http=createServer();await listenServer(http);const port=http.address().port;
 const handler=createServiceHandler({host,token:'t'.repeat(43),port});http.on('request',handler);
 const call=(path,{method='GET',body,cookie}={})=>new Promise((res,rej)=>{const q=request({host:'127.0.0.1',port,path,method,headers:{host:`127.0.0.1:${port}`,...(cookie?{cookie}:{}),...(method==='POST'?{origin:`http://127.0.0.1:${port}`,'content-type':'application/json','x-rlb-host':'1'}:{})}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res({status:r.statusCode,json:JSON.parse(b||'null'),headers:r.headers}));});q.on('error',rej);if(body)q.write(JSON.stringify(body));q.end();});
 try{
  const server=host.procs.get('server');
  assert.equal(host.status().graceful.available,false);
  await host.act('start','server');assert.equal(server.state,'running');
  assert.deepEqual(host.status().graceful,{available:true,via:'console',reason:null,players:null,saveSeconds:5});
  await host.act('stop','server');
  assert.equal(server.state,'stopped');assert.equal(server.info().lastExit.code,0);
  const lines=texts(host),asked=lines.findIndex(l=>/saving the world before it stops/.test(l)),saved=lines.findIndex((l,i)=>i>asked&&/^ Saved \d+ Object\(s\)/.test(l)),quit=lines.findIndex(l=>/saved; asked it to quit/.test(l));
  assert.ok(asked>=0&&saved>asked&&quit>saved,lines.join('\n'));
  assert.ok(host.status().saves.lastGood,'the final save is kept as the last good save');

  // Restart: saved, quit, started again with a new process.
  await host.act('start','server');const pid=server.info().pid;
  await host.act('restart','server');
  assert.equal(server.state,'running');assert.notEqual(server.info().pid,pid);
  assert.equal(texts(host).filter(l=>/saved; asked it to quit/.test(l)).length,2);

  // The dashboard API: schedule status, a bad schedule, restart in 0 minutes (graceful), wipe needs confirming.
  const login=await call('/api/login',{method:'POST',body:{token:'t'.repeat(43)}}),cookie=login.headers['set-cookie'][0].split(';')[0];
  const sch=(await call('/api/schedule',{cookie})).json;
  assert.equal(sch.configured,true);assert.equal(sch.next.restart,null);
  assert.equal((await call('/api/schedule/save',{method:'POST',cookie,body:{schedule:{...sch.schedule,timeZone:'Nowhere/Else'}}})).status,400);
  assert.equal((await call('/api/schedule/restart-in',{method:'POST',cookie,body:{minutes:5,wipe:'world'}})).status,428);
  assert.equal((await call('/api/schedule/restart-in',{method:'POST',cookie,body:{minutes:'5; rm -rf /'}})).status,400);
  const before=server.info().pid;
  assert.equal((await call('/api/schedule/restart-in',{method:'POST',cookie,body:{minutes:0}})).status,200);
  await until(()=>host.schedule.status().history.length===1,20000,'scheduled restart done');
  assert.equal(host.schedule.status().history[0].outcome,'done');assert.equal(server.state,'running');assert.notEqual(server.info().pid,before);
  assert.equal(texts(host).filter(l=>/saved; asked it to quit/.test(l)).length,3);
  assert.equal((await call('/api/schedule/cancel',{method:'POST',cookie,body:{}})).status,409);
  assert.equal(host.status().schedule.pending,null);
 }finally{handler.close();await new Promise(r=>http.close(r));http.closeAllConnections?.();await host.close();rmSync(root,{recursive:true,force:true});}
});

test('host: the same flow over the adapter command queue (a stand-in for the server plugin polls it); no poll means the old kill',{timeout:60000},async()=>{
 const {root,config}=await stack(undefined,{control:'adapter'});
 let t=Date.now();const key=randomBytes(32),adapter=createIdentityAdapter({serverId:'s1',controlKey:key,now:()=>t}),send=createControlSender(key);
 const adapterControl=async body=>adapter.handleControl(send({...body,serverId:'s1'}));
 const host=await startHost(config,{noRemote:true,adapterControl});
 // What adapter/RustLegacyBrowser.cs does every 2 s, against the mock: poll, run each server action, report the result.
 let polling=true;const ran=[];
 const plugin=setInterval(()=>{
  if(!polling)return;t=Date.now();
  adapter.setRoster([]);
  for(const c of adapter.takeCommands()){
   const child=host.procs.get('server').child;ran.push(c.action);
   if(c.action==='broadcast')child?.stdin.write(`broadcast ${c.message}\n`);else child?.stdin.write(c.action+'\n');
   adapter.commandResult({id:c.id,ok:Boolean(child)});
  }
 },100);
 try{
  const server=host.procs.get('server');
  await host.act('start','server');
  await host.serverControl.refresh();
  assert.equal(host.status().graceful.available,true);assert.equal(host.status().graceful.via,'adapter');assert.equal(host.status().graceful.players,0);
  await host.serverControl.send('broadcast',{message:'Hello from the host'});
  await until(()=>texts(host).some(l=>l==='[CHAT] Server: Hello from the host'),5000,'broadcast in the server log');
  await host.act('stop','server');
  assert.equal(server.info().lastExit.code,0);assert.deepEqual(ran,['broadcast','save','quit']);
  const done=adapter.handleControl(send({serverId:'s1',type:'server-commands'})).commands.map(c=>[c.action,c.state]);
  assert.deepEqual(done,[['broadcast','done'],['save','done'],['quit','done']]);

  // The plugin stops polling (not installed, or the server is busy loading): Stop ends the process as before.
  polling=false;await host.act('start','server');t=Date.now()+20000;await host.serverControl.refresh();
  assert.equal(host.status().graceful.available,false);assert.match(host.status().graceful.reason,/plugin/);
  await host.act('stop','server');
  assert.notEqual(server.info().lastExit.code,0);
  assert.ok(texts(host).some(l=>/cannot save first/.test(l)));
 }finally{clearInterval(plugin);await host.close();rmSync(root,{recursive:true,force:true});}
});

test('host: a wipe through the schedule leaves a fresh world: the old save is archived and not restored by the save guard',{timeout:60000},async()=>{
 const {root,config}=await stack();
 const host=await startHost(config,{noRemote:true});
 try{
  const server=host.procs.get('server');
  await host.act('start','server');
  server.child.stdin.write('save\n');await until(()=>host.status().saves?.lastGood,10000,'a good save');
  await host.schedule.restartIn(0,{wipe:'world',confirm:true,by:'owner'});await host.schedule.idle();
  const h=host.schedule.status().history[0];assert.equal(h.outcome,'done',h.note);
  assert.equal(server.state,'running');
  await until(()=>texts(host).some(l=>/No save found; starting a fresh world/.test(l)),10000,'fresh world');
  assert.ok(readdirSync(join(config.dataDir,'backups',h.archive)).includes('rust_island_2013.sav'));
  assert.ok(existsSync(join(config.dataDir,'backups',h.archive,'last-good')));
  assert.equal(host.status().schedule.lastWipe.type,'world');
 }finally{await host.close();rmSync(root,{recursive:true,force:true});}
});

// The C# plugins cannot be compiled here; pin that both run the same fixed server actions, before any target is parsed.
test('server plugins: both run save, broadcast and quit, the same way, without a target',async()=>{
 const {readFileSync}=await import('node:fs');
 for(const file of ['RustLegacyBrowser.cs','vanilla/RustLegacyBrowserVanilla.cs']){
  const src=readFileSync(new URL(`../adapter/${file}`,import.meta.url),'utf8');
  const body=src.slice(src.indexOf('string RunServerCommand('),src.indexOf('public static bool IsEnvelope'));
  assert.deepEqual([...body.matchAll(/case "([a-z]+)":/g)].map(m=>m[1]),Object.keys(SERVER_ACTIONS),file);
  assert.ok(body.includes('ConsoleSystem.Run("save.all", false);')&&body.includes('UnityEngine.Application.Quit')&&body.includes('"Server"'),file);
  const run=src.slice(src.indexOf('string RunCommand('));
  assert.ok(run.indexOf('RunServerCommand(action')<run.indexOf('targetId'),`${file}: server actions are routed before the target is parsed`);
 }
});
