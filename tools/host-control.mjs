// Drives a running Rust Legacy Host service through its loopback API, for scripts that run as an administrator on the
// same machine (deploy/azure-test/scripts/04-Install-KitViaHost.ps1). Signs in with the owner token in the host's data
// folder, like the desktop app does; nothing else is read or written.
//   node tools/host-control.mjs status [--data <dir>]
//   node tools/host-control.mjs <start|stop|restart> <part> [--data <dir>] [--timeout <s>]
//       waits until the part is running (start, restart) or stopped (stop), or fails after --timeout (default 300 s)
// <dir> defaults to C:\ProgramData\Rust Legacy Host (host.json there gives the port; owner.token the sign-in).
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const DEFAULT_DATA='C:\\ProgramData\\Rust Legacy Host';
const DEFAULT_PORT=28100; // host/config.mjs listen.port
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function hostEndpoint(dataDir=DEFAULT_DATA){
 const tokenFile=join(dataDir,'owner.token');
 if(!existsSync(tokenFile))throw Error(`no owner token in ${dataDir}: is Rust Legacy Host installed here?`);
 const cfgFile=join(dataDir,'host.json');
 const port=existsSync(cfgFile)?JSON.parse(readFileSync(cfgFile,'utf8')).listen?.port??DEFAULT_PORT:DEFAULT_PORT;
 return {base:`http://127.0.0.1:${port}`,token:readFileSync(tokenFile,'utf8').trim()};
}

export async function connectHost({base,token,fetch:f=fetch}){
 // The service refuses a POST without its own Origin and X-RLB-Host (host/service.mjs, CSRF).
 const post={origin:base,'x-rlb-host':'1','content-type':'application/json'};
 const login=await f(base+'/api/login',{method:'POST',headers:post,body:JSON.stringify({token})});
 if(login.status!==200)throw Error(`sign-in refused (${login.status})`);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const call=async(path,body)=>{
  const r=await f(base+path,body===undefined?{headers:{cookie}}:{method:'POST',headers:{...post,cookie},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>null);
  if(r.status>=300)throw Error(`${path}: ${r.status} ${j?.error??''}`.trim());
  return j;
 };
 const status=()=>call('/api/status');
 const part=async name=>(await status()).components.find(c=>c.name===name);
 return {
  status,part,
  // start | stop | restart, then wait for the state that action ends in. A part that went to failed fails at once.
  async act(action,name,{timeoutMs=300000,pollMs=1000}={}){
   const before=await part(name);
   if(!before)throw Error(`the host has no part named ${name}`);
   await call('/api/action',{action,target:name});
   const want=action==='stop'?'stopped':'running',end=Date.now()+timeoutMs;
   // A restart passes through stopping/starting; give the host a moment to leave the old running state.
   if(action==='restart')await sleep(Math.min(2000,pollMs*2));
   for(;;){
    const p=await part(name);
    if(p?.state===want&&!(action!=='stop'&&p.restarting))return p;
    if(p?.state==='failed')throw Error(`${name} failed: ${p.message||'see the host log'}`);
    if(Date.now()>end)throw Error(`${name} is ${p?.state??'gone'} after ${Math.round(timeoutMs/1000)} s (wanted ${want})`);
    await sleep(pollMs);
   }
  },
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const argv=process.argv.slice(2),flag=(n,d)=>{const i=argv.indexOf(n);return i<0?d:argv[i+1];};
 const [cmd,name]=argv;
 try{
  const h=await connectHost(hostEndpoint(flag('--data',DEFAULT_DATA)));
  if(cmd==='status'){
   const s=await h.status();
   for(const c of s.components)console.log(`${c.name}: ${c.state}${c.pid?` (PID ${c.pid}${c.external?', started outside the host':''})`:''}${c.message?` - ${c.message}`:''}`);
  }else if(['start','stop','restart'].includes(cmd)&&name){
   const p=await h.act(cmd,name,{timeoutMs:Number(flag('--timeout','300'))*1000});
   console.log(`${name}: ${p.state}${p.pid?` (PID ${p.pid})`:''}`);
  }else{console.error('usage: node tools/host-control.mjs status | <start|stop|restart> <part> [--data <dir>] [--timeout <s>]');process.exit(2);}
 }catch(e){console.error(e.message);process.exit(1);}
}
