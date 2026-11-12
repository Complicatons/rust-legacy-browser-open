// Stands in for rust_server.exe in host app tests and demos (HOST-APP-PLAN.md "Testing"). It is NOT the original
// server: it binds the project's mock uLink socket on the game port, writes a Unity-style
// rust_server_Data/output_log.txt in its working directory (rewritten at each start, like Unity), and autosaves with
// the original ServerSaveManager.Save file sequence and log lines. stdin commands:
//   freeze  log "Saving to", leave 0-byte .sav.new and .sav, then block the event loop with 0 CPU (the 2026-10-22 freeze)
//   crash   exit with code 3          quit   save and exit 0          save   autosave now          say <text>   log a line
//   broadcast <text>   log "[CHAT] Server: <text>" (the host's restart warnings; the plugin's broadcast on the real server)
// Usage: node host/mock-game-server.mjs --port 29015 [--datadir rust_server_Data/] [--map rust_island_2013]
//        [--autosave 600] [--objects 4123] [--chatter]
import {mkdirSync,writeFileSync,appendFileSync,existsSync,renameSync,unlinkSync} from 'node:fs';
import {startMockUlinkServer} from '../bridge/ulink/mock-server.mjs';

const arg=(name,def)=>{const i=process.argv.indexOf('--'+name);return i<0?def:(process.argv[i+1]??true);};
const port=Number(arg('port',29015)),datadir=String(arg('datadir','rust_server_Data/')),map=String(arg('map','rust_island_2013'));
const autosave=Number(arg('autosave',600)),objects=Number(arg('objects',4123)),chatter=process.argv.includes('--chatter');
const logFile='rust_server_Data/output_log.txt',savePath=datadir+map+'.sav';
mkdirSync('rust_server_Data',{recursive:true});mkdirSync(datadir,{recursive:true});
writeFileSync(logFile,'');
const log=text=>appendFileSync(logFile,text+'\r\n');

function save(){
 const t=performance.now();
 log(`Saving to '${savePath}'`);
 writeFileSync(savePath+'.new',`mock world save: ${objects} objects at ${new Date().toISOString()}\n`.repeat(64));
 if(existsSync(savePath+'.old.5'))unlinkSync(savePath+'.old.5');
 for(let n=4;n>=0;n--)if(existsSync(`${savePath}.old.${n}`))renameSync(`${savePath}.old.${n}`,`${savePath}.old.${n+1}`);
 if(existsSync(savePath))renameSync(savePath,savePath+'.old.0');
 renameSync(savePath+'.new',savePath);
 log(` Saved ${objects} Object(s). Took ${((performance.now()-t)/1000).toFixed(4)} seconds.`);
}
function freeze(){
 log(`Saving to '${savePath}'`);
 writeFileSync(savePath+'.new','');writeFileSync(savePath,'');
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); // blocks forever, no CPU, no packets, no log
}

log('Mock game server for the Rust Legacy host app (stands in for rust_server.exe; not the original server)');
log(`Loading level ${map}`);
const world={level:map,sendRate:20,hostname:'Mock host-app server',modded:false,official:false,steamId:1n,ip:0x7f000001,port};
let server;
try{server=await startMockUlinkServer({world,port,approve:()=>({approve:true})});}
catch(e){log(`Could not bind UDP ${port}: ${e.message}`);process.exit(2);}
log(`Server listening on UDP ${port}`);
if(existsSync(savePath))log(`Loaded save '${savePath}'`);else log('No save found; starting a fresh world');

// A frame loop: a Unity server always uses some CPU while it ticks (about 1 ms per 50 ms frame here, comfortably above
// Windows' 15.6 ms CPU-time granularity over a probe interval).
let frame=0;setInterval(()=>{const end=performance.now()+1;let x=0;while(performance.now()<end)x+=Math.sqrt(++frame);return x;},50);
setInterval(save,autosave*1000);
const CHATTER=['Spawned resource group (mock)','Animal spawner tick: 14 alive (mock)','Loot respawn pass: 32 containers (mock)','Decay pass: 0 structures (mock)','Network: 0 players, 0 sleepers (mock)'];
if(chatter)(function next(){setTimeout(()=>{log(CHATTER[Math.floor(Math.random()*CHATTER.length)]);next();},3000+Math.random()*6000);})();

process.stdin.setEncoding('utf8');
let pending='';
process.stdin.on('data',d=>{
 pending+=d;let i;
 while((i=pending.indexOf('\n'))>=0){
  const cmd=pending.slice(0,i).trim();pending=pending.slice(i+1);
  if(cmd==='freeze')freeze();
  else if(cmd==='crash'){log('Crash!!! (mock)');process.exit(3);}
  else if(cmd==='quit'){save();log('Quitting');server.close().then(()=>process.exit(0));}
  else if(cmd==='save')save();
  else if(cmd.startsWith('say '))log(cmd.slice(4));
  else if(cmd.startsWith('broadcast '))log('[CHAT] Server: '+cmd.slice(10));
 }
});
process.stdin.on('end',()=>process.exit(0)); // the host went away
