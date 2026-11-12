// Demo and test stack for the host app: our real website (central), sidecar and gateway, enrolled the normal way,
// beside the mock game server (host/mock-game-server.mjs). Never the original server.
//   node host/demo.mjs [dataDir] [--port 28100] [--fresh]
// Ports: host 28100, website 28180, sidecar 28190, gateway 28143, mock game server UDP 29115.
import {mkdirSync,writeFileSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer,request} from 'node:http';
import {pathToFileURL} from 'node:url';
import {writeSigningKey} from '../central/keys.mjs';
import {enrolGateway} from '../bridge/remote-account.mjs';
import {startService} from './service.mjs';
import {loadHostConfig} from './config.mjs';
import {openCentralDb} from '../central/db.mjs';
import {listenServer} from '../bridge/listen.mjs';
import {writeDemoServerFiles} from './demo-server-files.mjs';
import {seedDemoMetrics} from './metrics.mjs';
import {practiceSetup} from './wizard-practice.mjs';

export const DEMO_PORTS={host:28100,central:28180,sidecar:28190,gateway:28143,server:29115};

function post(port,path,body,headers={}){
 return new Promise((res,rej)=>{const data=JSON.stringify(body);
  const r=request({host:'127.0.0.1',port,path,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data),...headers}},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>res({status:x.statusCode,headers:x.headers,json:JSON.parse(b||'{}')}));});
  r.on('error',rej);r.end(data);});
}

// Writes every config under dataDir and enrols the gateway with a temporary in-process copy of the website.
export async function prepareDemo(dataDir,{ports=DEMO_PORTS,watchdog={enabled:true,hangSeconds:30,graceSeconds:20,probeEveryMs:2000},autosaveSeconds=90}={}){
 const d=p=>join(dataDir,p),cfg=d('config'),secrets=d('secrets');
 for(const x of [cfg,secrets,d('central'),d('sidecar')])mkdirSync(x,{recursive:true});
 const {file:signingKey}=writeSigningKey(secrets);
 const origin=`http://127.0.0.1:${ports.central}`;
 const central={listen:{host:'127.0.0.1',port:ports.central},publicUrl:origin+'/',allowInsecure:true,testDevSignIn:true,database:d('central/central.db'),
  signingKeys:[signingKey],allowedOrigins:[origin],steam:{enabled:true},mail:{transport:'console'},progressUrl:null};
 writeFileSync(join(cfg,'central.json'),JSON.stringify(central,null,1));
 for(const k of ['control.key','plugin.key'])writeFileSync(join(secrets,k),randomBytes(32).toString('hex')+'\n',{mode:0o600});

 // Enrol: dev sign-in as the demo owner, add the server on the owner page's API, redeem the code as the gateway.
 const {buildCentral}=await import('../tools/central.mjs');
 const web=createServer(buildCentral(central));await listenServer(web);const wp=web.address().port;
 try{
  const login=await post(wp,'/auth/login',{subject:'demo-owner',name:'Demo owner'},{origin});
  if(login.status!==200)throw Error('demo sign-in failed: '+JSON.stringify(login.json));
  const cookie=login.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ');
  const made=await post(wp,'/owner/servers',{name:'Host app demo',region:'EU',endpoint:`wss://127.0.0.1:${ports.gateway}/play`},{origin,cookie,'x-csrf-token':login.json.csrf});
  if(made.status!==201)throw Error('demo server creation failed: '+JSON.stringify(made.json));
  const {serverId,credential}=await enrolGateway({baseUrl:`http://127.0.0.1:${wp}/`,code:made.json.enrolmentCode});
  // The host app key, made the way an owner makes it on /owner ("New host app key").
  const hk=await post(wp,`/owner/servers/${serverId}/host-key`,{},{origin,cookie,'x-csrf-token':login.json.csrf});
  if(hk.status!==201)throw Error('demo host key failed: '+JSON.stringify(hk.json));
  mkdirSync(d('host'),{recursive:true});writeFileSync(d('host/central-host.key'),hk.json.hostKey+'\n',{mode:0o600});
  // Demo accounts for the Accounts page, labelled as such: two that played in the browser (characters allocated in the
  // sidecar's namespace) and one desktop character linked with an in-game code. Written through the normal tables.
  const demo=[];
  for(const [i,name] of ['Demo player 1','Demo player 2','Demo desktop player'].entries()){
   const r=await post(wp,'/auth/login',{subject:'demo-player-'+(i+1),name},{origin});demo.push(r.json.player);
  }
  const ids=['90000000000000101','90000000000000102','76561190000000301'];
  const cdb=openCentralDb(central.database),t=Date.now();
  cdb.touchPlaySession(serverId,demo[0],t-3*3600e3,t-3600e3,60e3);cdb.touchPlaySession(serverId,demo[1],t-26*3600e3,t-25*3600e3,60e3);
  cdb.link(serverId,demo[2],ids[2],t-2*86400e3);
  cdb.raw.prepare("insert into link_requests(id,server_uuid,player_uuid,status,created_at,updated_at) values(?,?,?,'linked',?,?)").run(randomUUID(),serverId,demo[2],t-2*86400e3,t-2*86400e3);
  // Demo anti-cheat evidence (Anti-cheat page), shaped like the gateway's PlayerWatch flags: a teleport with its replay
  // path, a fire-rate flag, a desktop speed flag from the adapter, and an open player report. All labelled demo.
  const path=[];for(let i=0;i<24;i++)path.push({t:i*0.1,kind:'move',pos:[100+i*0.9,12+(i>15?0.4:0),200+i*0.3]});
  path.push({t:2.5,kind:'move',pos:[160,12.4,230]},{t:2.6,kind:'fire',weapon:'M4'});
  const flag=(player,mins,kind,severity,score,detail,replay)=>cdb.addFlag({server:serverId,player,at:t-mins*60e3,received:t-mins*60e3,kind,severity,score,detail:JSON.stringify({detail,replay})});
  flag(demo[0],95,'speed',10,10,{overspend:2.4,budget:9.6,demo:true});
  flag(demo[0],90,'teleport',40,52,{step:38.7,allowed:25,dropped:true,demo:true},path);
  flag(demo[0],88,'fire-rate',20,70,{weapon:'M4',interval:0.071,minimum:0.125,demo:true});
  cdb.addDesktopFlag({server:serverId,handle:'DemoHandle000001',name:'Demo desktop player',player:demo[2],at:t-30*60e3,received:t-30*60e3,kind:'speed',severity:10,score:10,detail:JSON.stringify({detail:{overspend:3.1,sampleSeconds:2,demo:true}})});
  cdb.addReport({id:randomUUID(),server:serverId,reporter:demo[1],player:demo[0],name:'Demo player 1',reason:'cheating',detail:'Crossed the field in a second (demo report)',at:t-85*60e3});
  // Demo player history (Players page): earlier sessions, an earlier in-game name, a desktop character without an
  // account, and a past kick in the audit log. Labelled demo like the rest.
  for(const days of [6,4,3,2])cdb.raw.prepare('insert into play_sessions(server_uuid,player_uuid,started_at,last_seen) values(?,?,?,?)').run(serverId,demo[0],t-days*86400e3-2*3600e3,t-days*86400e3);
  cdb.touchName(serverId,demo[0],'browser','DemoOne',t-6*86400e3-2*3600e3);cdb.touchName(serverId,demo[0],'browser','DemoOne',t-3*86400e3);
  cdb.touchName(serverId,demo[0],'browser','Demo player 1',t-2*86400e3-2*3600e3);cdb.touchName(serverId,demo[0],'browser','Demo player 1',t-3600e3);
  cdb.touchName(serverId,demo[1],'browser','Demo player 2',t-25*3600e3);
  cdb.touchName(serverId,demo[2],'desktop','Demo desktop player',t-30*60e3);
  cdb.touchName(serverId,'desktop:DemoHandle000002','desktop','Demo stranger (pc)',t-5*3600e3);
  cdb.audit(t-80*60e3,login.json.player,'admin.kick',serverId,{player:demo[0],reason:'Teleporting (demo)',via:'host'});
  cdb.raw.close?.();
  writeFileSync(d('sidecar/identities.json'),JSON.stringify({version:1,entries:demo.map((s,i)=>[s,ids[i]])}));
  writeFileSync(join(secrets,'gateway.credential'),credential+'\n',{mode:0o600});
  writeFileSync(join(cfg,'sidecar.json'),JSON.stringify({serverId,port:ports.sidecar,dataFile:d('sidecar/identities.json'),pluginKeyFile:join(secrets,'plugin.key'),controlKeyFile:join(secrets,'control.key')},null,1));
  writeFileSync(join(cfg,'gateway.json'),JSON.stringify({serverId,centralUrl:origin+'/',credentialFile:join(secrets,'gateway.credential'),controlKeyFile:join(secrets,'control.key'),
   sidecarUrl:`http://127.0.0.1:${ports.sidecar}`,native:{host:'127.0.0.1',port:ports.server},allowedOrigins:[origin],listen:{host:'127.0.0.1',port:ports.gateway},path:'/play',
   capacity:50,wipe:'demo',anticheat:{policy:{autoKick:false}}},null,1));
 }finally{await new Promise(r=>web.close(r));web.closeAllConnections?.();}
 // Labelled demo cfg, Oxide plugins and adapter config for the Settings and Plugins pages and the health check.
 writeDemoServerFiles(d('Rust Server'),{pluginKeyHex:readFileSync(join(secrets,'plugin.key'),'utf8').trim(),sidecarPort:ports.sidecar});
 // Demo health history (Health page): 7 days of made-up minutes, labelled as demo on the page.
 seedDemoMetrics(d('host/metrics'),{now:Date.now()});
 writeFileSync(d('host.json'),JSON.stringify({listen:{host:'127.0.0.1',port:ports.host},dataDir:'host',
  components:{central:{config:'config/central.json'},sidecar:{config:'config/sidecar.json'},server:{kind:'mock',dir:'Rust Server',port:ports.server,autosaveSeconds,chatter:true},gateway:{config:'config/gateway.json'}},
  watchdog},null,1));
 return d('host.json');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),flag=n=>args.indexOf(n),port=flag('--port')>=0?Number(args[flag('--port')+1]):DEMO_PORTS.host;
 const dataDir=resolve(args.find((a,i)=>!a.startsWith('--')&&args[i-1]!=='--port')??join(tmpdir(),'rlb-host-demo'));
 if(args.includes('--fresh'))rmSync(dataDir,{recursive:true,force:true});
 const file=join(dataDir,'host.json');
 if(!existsSync(file)){console.log('Preparing the demo stack in',dataDir);await prepareDemo(dataDir,{ports:{...DEMO_PORTS,host:port}});}
 const config=loadHostConfig(file);
 // The Setup page runs practice stand-ins here (host/wizard-practice.mjs): the demo never changes the PC.
 const svc=await startService(config,{hostOptions:{setup:practiceSetup()}});
 if(args.includes('--start'))svc.host.act('start','all');
 let closing=false;
 for(const s of ['SIGINT','SIGTERM','SIGBREAK'])process.on(s,async()=>{if(closing)return;closing=true;console.log('Stopping every component…');await svc.close();process.exit(0);});
}
