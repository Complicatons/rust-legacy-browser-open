// Loopback sidecar beside the game server: holds the identity adapter state for the C# plugin
// (adapter/RustLegacyBrowser.cs) and the gateway control channel. Mock-tested only; not yet run beside a real server.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';

const MAX_BODY=262144,BOOT_WINDOW_MS=30000; // a poll carries the player list with positions (up to 500 entries) and evidence facts

// Plugin requests: raw JSON body {boot, seq, ts, type, ...} with header x-rlb-mac = base64url(HMAC-SHA256(key, raw body)).
// MAC over raw bytes avoids depending on identical JSON serialisation in C# and JS.
export function signPluginBody(key,raw){return createHmac('sha256',key).update(raw).digest('base64url');}

export function loadIdentityEntries(path){return existsSync(path)?JSON.parse(readFileSync(path,'utf8')).entries:[];}
export function saveIdentityEntries(path,entries){const tmp=path+'.tmp';writeFileSync(tmp,JSON.stringify({version:1,entries}));renameSync(tmp,path);}

export function createAdapterSidecar({adapter,pluginKey,now=Date.now}){
 const boots=new Map(); // boot id -> last seq
 function verifyPlugin(raw,mac){
  const expected=Buffer.from(signPluginBody(pluginKey,raw),'base64url'),given=Buffer.from(String(mac??''),'base64url');
  if(given.length!==expected.length||!timingSafeEqual(given,expected))return null;
  let m;try{m=JSON.parse(raw);}catch{return null;}
  if(typeof m?.boot!=='string'||!/^[0-9a-f]{32}$/.test(m.boot)||!Number.isSafeInteger(m.seq)||!Number.isSafeInteger(m.ts))return null;
  const last=boots.get(m.boot);
  if(last===undefined){if(Math.abs(now()-m.ts)>BOOT_WINDOW_MS)return null;}
  else if(m.seq<=last)return null;
  boots.set(m.boot,m.seq);return m;
 }
 function dispatch(m){
  // Admin command channel (no connection): poll for commands, report each result.
  if(m.type==='poll'){if(m.players!==undefined)adapter.setRoster(m.players);if(m.moves!==undefined||m.shots!==undefined||m.hits!==undefined||m.ops!==undefined)adapter.evidence?.(m);return {ok:true,commands:adapter.takeCommands()};}
  if(m.type==='command-result')return {ok:adapter.commandResult(m)};
  const id=typeof m.connectionId==='string'&&/^[0-9a-f]{32}$/.test(m.connectionId)?'conn:'+m.connectionId:null;
  if(!id)return {ok:false,reason:'malformed'};
  switch(m.type){
   case 'approval':{
    if(typeof m.authBytes!=='string'||m.authBytes.length>2048||!/^\d{1,20}$/.test(String(m.claimedUserId)))return {ok:false,reason:'malformed'};
    const r=adapter.onNativeApproval({authBytes:Buffer.from(m.authBytes,'base64'),claimedUserId:String(m.claimedUserId),connection:id});
    return {ok:true,...r};
   }
   case 'native-authenticated':return {ok:/^\d{1,20}$/.test(String(m.userId))&&adapter.onNativeAuthenticated({backendId:String(m.userId),connection:id})};
   case 'disconnect':adapter.onDisconnect(id);return {ok:true};
   case 'link-challenge':{const code=adapter.issueLinkChallenge(id);return code?{ok:true,code}:{ok:false,reason:'not-eligible'};}
   case 'report':return adapter.report({connection:id,targetName:m.targetName,targetId:m.targetId,text:m.text});
   default:return {ok:false,reason:'unknown-message'};
  }
 }
 async function readBody(req){let raw='';for await(const c of req){raw+=c;if(raw.length>MAX_BODY)throw Error('too large');}return raw;}
 function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
 return {
  async handle(req,res){
   try{
    const remote=req.socket.remoteAddress;
    if(remote!=='127.0.0.1'&&remote!=='::1'&&remote!=='::ffff:127.0.0.1'){send(res,403,{ok:false,reason:'loopback-only'});return;}
    if(req.method!=='POST'||req.headers['content-type']!=='application/json'){send(res,405,{ok:false,reason:'method'});return;}
    const raw=await readBody(req);
    if(req.url==='/plugin'){const m=verifyPlugin(raw,req.headers['x-rlb-mac']);if(!m){send(res,401,{ok:false,reason:'unauthenticated'});return;}send(res,200,dispatch(m));return;}
    if(req.url==='/control'){const r=adapter.handleControl(JSON.parse(raw));send(res,r.reason==='unauthenticated'?401:200,r);return;}
    send(res,404,{ok:false,reason:'unknown-endpoint'});
   }catch{send(res,400,{ok:false,reason:'invalid-request'});}
  },
 };
}
