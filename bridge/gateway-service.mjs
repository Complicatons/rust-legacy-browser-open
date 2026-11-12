// Browser-facing gateway (decision document: "Gateway service", colocated with the game server).
// One WebSocket per player: verified admission → one native uLink session to the operator-configured server.
// After approval, bridge/game-bridge.mjs translates native traffic to JSON events and whitelisted browser commands
// to native messages; nothing is passed through raw. Tested only against bridge/ulink/mock-server.mjs.
import {createSocket} from 'node:dgram';
import {WebSocketServer} from 'ws';
import {UlinkClient,failedToConnectError} from './ulink/session.mjs';
import {AdmissionError} from './admission.mjs';
import {GameBridge} from './game-bridge.mjs';
import {PlayerWatch} from './anticheat.mjs';
import {StallWatch} from './stall-watch.mjs';
import {PlayerStats} from './player-stats.mjs';
import {createClientIp} from './client-ip.mjs';
import {netErrorName} from '../browser/net-error.mjs';

const MAX_MESSAGE=4096,ADMIT_TIMEOUT_MS=10000,MAX_COMMANDS_PER_SECOND=60;
// Admin screenshots (central/screenshots.mjs): one larger message is accepted only while this gateway waits for that
// session's capture; every other message keeps the 4 KB limit. The WebSocket layer itself buffers at most MAX_FRAME per
// message (larger ones close the socket, 1009) and lifts that to MAX_CAPTURE_MESSAGE only for the capture answer.
export const MAX_CAPTURE_MESSAGE=600*1024,CAPTURE_TIMEOUT_MS=20e3,MAX_FRAME=16*1024;
export const BROWSER_PROTOCOL='rlb-gateway.v1';
// Per-gateway limits (createGatewayService({limits})). capacity: sessions joining or in the game (the launcher passes
// config.capacity, the figure it advertises); a join beyond it is refused as the server's own TooManyConnectedPlayers.
export const GATEWAY_LIMITS=Object.freeze({
 capacity:50,
 maxConnections:256,      // open sockets in any state
 perIp:8,                 // open sockets per client address (client-ip.mjs, trustedProxies-aware)
 admitsPerMinute:30,      // join tickets per client address per minute (as POST /desktop/admit)
 preApprovalMessages:8,   // messages a socket may send between its ticket and the server's approval
 softBufferBytes:1<<20,   // unsent bytes above which coalescible events are merged (latest per view and RPC)
 hardBufferBytes:8<<20,   // unsent bytes above which the session ends as a slow consumer
 pingIntervalMs:15000,    // WebSocket ping (and an in-game keepalive message the page's 60 s watchdog sees)
 missedPongs:2,           // pings without a pong before the session is ended
});
// Server state the page only needs the latest of: other players' moves and animal updates. The own character's
// ReadClientMove is a correction and never merged.
const COALESCIBLE=new Set(['ReadClientMove','GetNetworkUpdate']);
// NetError.TooManyConnectedPlayers: what ConnectionAcceptor.uLink_OnPlayerApproval denies a full server with.
const TOO_MANY_CONNECTED_PLAYERS=17;
// ws applies maxPayload from its receiver on every frame (ws 8.x Receiver._maxPayload); unknown internals leave it be.
const payloadLimit=(ws,bytes)=>{if(ws?._receiver&&typeof ws._receiver._maxPayload==='number')ws._receiver._maxPayload=bytes;};

// Display names reach the server's chat and logs: keep printable characters only, bounded like the native client.
export function sanitizeName(name){const s=String(name??'').replace(/[^\p{L}\p{N} _.\-\[\]()]/gu,'').trim().slice(0,32);return s||'Browser Player';}

// JSON for browser events: bigint → decimal string, bytes → base64.
export const toJson=value=>JSON.stringify(value,(k,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?{base64:Buffer.from(v).toString('base64')}:v);

// In-game command shapes, checked before anti-cheat and the bridge see them: {type:'item', data:null} or
// {type:'rpc', args:null} used to throw there and, with no catch, end the gateway process (every session at once).
// Returns the command (item data / rpc args defaulted) or null for a shape no page sends.
export function commandShape(msg){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 if(msg.type==='item'){
  if(!Number.isInteger(msg.viewId)||typeof msg.action!=='string')return null;
  return msg.data==null?{...msg,data:{}}:object(msg.data)?msg:null;
 }
 if(msg.type==='rpc'){
  if(!Number.isInteger(msg.viewId)||typeof msg.name!=='string')return null;
  return msg.args===undefined?{...msg,args:[]}:Array.isArray(msg.args)?msg:null;
 }
 if(msg.type==='inventory'&&!object(msg.source))return null;
 if(msg.type==='context'&&msg.target!=null&&!object(msg.target))return null;
 if(msg.type==='move'&&msg.angles!=null&&!object(msg.angles))return null;
 return msg;
}

// Process-level last resort for tools/gateway.mjs: log and keep serving. Per-session failures are caught in the
// session itself (it alone ends); exiting here would drop every player, and the original server then refuses their
// rejoins as "already connected" (ConnectionAcceptor.uLink_OnPlayerApproval IsConnected) until it times them out.
const guarded=new WeakSet();
export function guardProcess({log=console.error,proc=process}={}){
 if(guarded.has(proc))return false;guarded.add(proc);
 proc.on('unhandledRejection',e=>log('unhandled rejection (gateway kept running):',e?.stack??e));
 proc.on('uncaughtException',e=>log('uncaught exception (gateway kept running):',e?.stack??e));
 return true;
}

// anticheat: {limits, weapons, policy, groundHeight, lineOfSight} for bridge/anticheat.mjs (defaults = recovered values;
// lineOfSight is one bridge/line-of-sight.mjs world shared by every session).
// limits: overrides of GATEWAY_LIMITS; clientIp: req → client address (createClientIp(trustedProxies)).
export function createGatewayService({admission,native,allowedOrigins,ulinkConfig,schema,ngcRegistry,sceneDoors=[],anticheat={},limits:limitOverrides={},clientIp=createClientIp([]),now=()=>performance.now()/1000,wallNow=Date.now,log=()=>{}}){
 if(!native?.host||!Number.isInteger(native.port))throw Error('Configure the native server address');
 const limits={...GATEWAY_LIMITS,...limitOverrides};
 const wss=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME});
 const sessions=new Set();
 // Aggregate counters only (no identities), exported by the launcher's /metrics.
 const metrics={connections:0,admitted:0,approved:0,denied:{},serverDenied:0,nativeFailed:0,nativeClosed:0,rateLimited:0,malformed:0,admissionTimeouts:0,upgradeRejected:0,anticheatDropped:0,anticheatFlags:0,kicked:0,sessionErrors:0,
  upgradeLimited:0,slowConsumers:0,coalesced:0,pingTimeouts:0,missingView:{rpc:0,ngc:0},kickCodes:{},moveClamped:0,moveDropped:0};
 // Open raw sockets per client address (from the accepted upgrade until the TCP socket closes) and join tickets per
 // address in the current minute.
 const openByIp=new Map(),admitsByIp=new Map();let openSockets=0;
 // A failure while handling one session's traffic ends that session only (reply 'malformed', close 4002).
 const sessionError=(session,where,error)=>{metrics.sessionErrors++;log('session',session.id,'error in',where,String(error?.stack??error).slice(0,2000));if(session.state==='closed'||session.ending)return;session.reply?.({type:'error',reason:'malformed'});session.end?.(4002,'malformed');};
 // Evidence from sessions that already ended waits here until the next report to central.
 let orphanFlags=[];
 // Leaderboard counts (bridge/player-stats.mjs) per account subject, waiting for the next report.
 let pendingStats=new Map();
 const keepStats=(subject,counts)=>{if(!counts)return;const into=pendingStats.get(subject)??{};for(const [k,n] of Object.entries(counts))into[k]=(into[k]??0)+n;pendingStats.set(subject,into);};
 const deny=reason=>{metrics.denied[reason]=(metrics.denied[reason]??0)+1;};
 // Server-wide correction bursts: one log line with which side was slow (bridge/stall-watch.mjs).
 const stalls=new StallWatch({now:()=>now()*1000,wallNow,log,inGame:()=>{let n=0;for(const s of sessions)if(s.state==='in-game')n++;return n;}});
 let lastTick=now();
 const tick=setInterval(()=>{const t=now();stalls.loop((t-lastTick)*1000-10);lastTick=t;for(const s of sessions){s.client?.tick();s.bridge?.tick();if(s.held?.size&&s.ws.bufferedAmount<limits.softBufferBytes)flushHeld(s);
  // A quiet in-game page still hears from the gateway every ping interval (its 60 s watchdog counts messages only).
  if(s.state==='in-game'&&t-(s.sentAt??t)>=limits.pingIntervalMs/1000)s.reply({type:'keepalive'});}},10);
 // Liveness: a socket that answers no ping for missedPongs intervals is ended (its native session with a Lidgren
 // Disconnect, so the server frees the player at once). Browsers answer pings without telling the page, so quiet in-game
 // pages also get a keepalive message (tick above); the page closes after 60 s without any gateway message.
 const liveness=setInterval(()=>{
  for(const s of [...sessions]){
   if(s.ws.readyState!==s.ws.OPEN)continue;
   if(s.missedPongs>=limits.missedPongs){metrics.pingTimeouts++;s.trace('no pong for',s.missedPongs,'pings');s.end(4009,'ping timeout');s.ws.terminate();continue;}
   s.missedPongs=(s.missedPongs??0)+1;try{s.ws.ping();}catch{}
  }
 },limits.pingIntervalMs);liveness.unref?.();
 // Server → page events, with backpressure: past softBufferBytes unsent, coalescible state is held (latest per view and
 // RPC) until the socket drains; past hardBufferBytes the page is a slow consumer and its session ends.
 function relay(session,e){
  const {ws}=session;if(ws.readyState!==ws.OPEN)return;
  if(e.type==='destroy'&&e.views){const {views,...rest}=e;e=rest;}
  const buffered=ws.bufferedAmount;
  if(buffered>limits.hardBufferBytes)return slowConsumer(session,buffered);
  if(buffered>limits.softBufferBytes&&e.type==='rpc'&&COALESCIBLE.has(e.name)&&e.viewId!==session.character){(session.held??=new Map()).set(e.viewId+':'+e.name,e);metrics.coalesced++;return;}
  if(session.held?.size&&buffered<limits.softBufferBytes)flushHeld(session);
  ws.send(toJson(e));session.sentAt=now();
 }
 function flushHeld(session){
  const held=session.held;session.held=null;
  for(const e of held.values())if(session.bridge?.views.has(e.viewId)&&session.ws.readyState===session.ws.OPEN)session.ws.send(toJson(e));
 }
 function slowConsumer(session,buffered){
  metrics.slowConsumers++;session.trace('slow consumer: ending with',buffered,'bytes unsent');
  session.end(4008,'slow consumer');session.ws.terminate(); // the close frame would wait behind the backlog
 }
 let nextSession=1;

 wss.on('connection',(ws,req)=>{
  const session={ws,id:nextSession++,state:'awaiting-admission',ip:req?.rlbClientIp};sessions.add(session);metrics.connections++;
  // One line per step of a join, so a failed join shows where it stopped (no tickets or addresses).
  const trace=(...a)=>log('session',session.id,...a);trace('open');
  const reply=data=>{if(ws.readyState===ws.OPEN){ws.send(JSON.stringify(data));session.sentAt=now();}};
  const end=(code,reason)=>{if(session.state==='closed'||session.ending)return;session.ending=true;session.capture?.finish({ok:false,reason:'disconnected'});trace('end',code,reason,'in state',session.state);if(session.watch){session.watch.dispose();orphanFlags.push(...session.watch.drain());orphanFlags=orphanFlags.slice(-500);}if(session.stats)keepStats(session.join.subject,session.stats.drain());session.bridge?.dispose();session.client?.close('Disconnected');admission.release?.(session.join?.backendId,session.join?.sessionId);stalls.end(session.id);session.state='closed';try{session.socket?.close();}catch{}sessions.delete(session);clearTimeout(session.admitTimer);if(ws.readyState===ws.OPEN)ws.close(code,reason);};
  session.end=end;session.trace=trace;session.reply=reply;
  session.admitTimer=setTimeout(()=>{metrics.admissionTimeouts++;reply({type:'error',reason:'admission-timeout'});end(4001,'admission timeout');},ADMIT_TIMEOUT_MS);
  ws.on('close',()=>end(1000,'closed'));
  // Protocol errors (e.g. a message over the frame limit, 1009): ws closes the socket itself; without a listener the
  // 'error' event would throw and end the process.
  ws.on('error',e=>trace('socket error',e?.code??e?.message));
  ws.on('pong',()=>{session.missedPongs=0;});
  ws.on('message',(data,isBinary)=>{onMessage(data,isBinary).catch(error=>sessionError(session,'browser message',error));});
  const onMessage=async(data,isBinary)=>{
   if(session.state==='in-game')stalls.browser(session.id);
   let msg;
   try{if(isBinary||(data.length>MAX_MESSAGE&&!session.capture))throw 0;msg=JSON.parse(String(data));if(msg===null||typeof msg!=='object'||Array.isArray(msg)||typeof msg.type!=='string')throw 0;}catch{metrics.malformed++;reply({type:'error',reason:'malformed'});return end(4002,'malformed');}
   if(session.state==='in-game'&&msg?.type==='capture'){
    // The page's answer to a screenshot request: never a game command, never counted against the command budget.
    if(session.capture&&msg.id===session.capture.id)session.capture.finish({ok:msg.ok===true&&typeof msg.image==='string',reason:typeof msg.reason==='string'?msg.reason.slice(0,40):undefined,image:typeof msg.image==='string'?msg.image:undefined,meta:msg.meta&&typeof msg.meta==='object'?msg.meta:undefined});
    return;
   }
   if(data.length>MAX_MESSAGE){metrics.malformed++;reply({type:'error',reason:'malformed'});return end(4002,'malformed');}
   if(session.state==='in-game'){
    const second=Math.floor(now());if(session.window!==second){session.window=second;session.commands=0;}
    if(++session.commands>MAX_COMMANDS_PER_SECOND){metrics.rateLimited++;if(session.watch.flag('command-flood',{perSecond:MAX_COMMANDS_PER_SECOND}))metrics.anticheatFlags++;reply({type:'error',reason:'rate-limited'});return;}
    msg=commandShape(msg);if(!msg){reply({type:'command-rejected',reason:'bad-command'});return;}
    // Anti-cheat sees the command first; impossible moves/shots never reach the native server.
    const flags=session.watch.pending.length,verdict=session.watch.check(msg);
    metrics.anticheatFlags+=session.watch.pending.length-flags;
    if(session.watch.shouldKick())return kick(session,'anticheat');
    if(!verdict.allow){metrics.anticheatDropped++;reply({type:'command-rejected',reason:verdict.reason});return;}
    if(msg?.type==='ready')trace('browser ready');
    if(session.bridge.command(msg)!==false)session.stats.command(msg);return;
   }
   // Between the ticket and the approval a page sends nothing; a few stray messages are answered, a stream ends it.
   if(session.state!=='awaiting-admission'){if(++session.early>limits.preApprovalMessages){metrics.malformed++;return end(4002,'too many messages before approval');}reply({type:'error',reason:'unsupported'});return;}
   if(msg?.type!=='admit'||typeof msg.ticket!=='string'){reply({type:'error',reason:'admission-required'});return end(4003,'admission required');}
   session.state='admitting';session.early=0;clearTimeout(session.admitTimer);
   // Join tickets per client address (POST /desktop/admit's limit), before central is asked to redeem one.
   const t=wallNow(),w=admitsByIp.get(session.ip);
   if(!w||t-w.start>60e3)admitsByIp.set(session.ip,{start:t,n:1});else if(++w.n>limits.admitsPerMinute){deny('rate-limited');reply({type:'denied',reason:'rate-limited'});return end(4029,'rate limited');}
   if(admitsByIp.size>10000)for(const [k,v] of admitsByIp)if(t-v.start>60e3)admitsByIp.delete(k);
   // Capacity is enforced, not only advertised: joining and in-game sessions count.
   let joined=0;for(const s of sessions)if(s!==session&&(s.state==='admitting'||s.state==='connecting'||s.state==='in-game'))joined++;
   if(joined>=limits.capacity){deny('server-full');trace('server full',joined);reply({type:'denied',reason:'server-full',error:TOO_MANY_CONNECTED_PLAYERS});return end(4007,'server full');}
   let join;
   // A newer join from the same account replaces this gateway's stale session for it (e.g. a tab left open).
   const replace=subject=>{let found=false;for(const s of [...sessions])if(s!==session&&s.join?.subject===subject){s.trace?.('replaced by a newer join');s.reply?.({type:'kicked',reason:'replaced'});s.end(4011,'replaced');found=true;}return found;};
   try{join=await admission.admit(msg.ticket,{replace,...(session.ip&&session.ip!=='unknown'?{ip:session.ip}:{})});}
   catch(error){const reason=error instanceof AdmissionError?error.code:'admission-failed';deny(reason);trace('admission denied',reason,error instanceof AdmissionError?'':error.message);reply({type:'denied',reason});return end(4004,'denied');}
   metrics.admitted++;trace('admitted; connecting to native',`${native.host}:${native.port}`);
   if(session.state==='closed')return;
   // The central account's display name wins; the browser-supplied name is only a fallback for local testing.
   startNative(session,join,sanitizeName(join.name??msg.name),reply,end);
  };
 });

 function kick(session,reason){
  metrics.kicked++;log('kicked',session.join?.subject,reason);
  if(session.ws.readyState===session.ws.OPEN)session.ws.send(JSON.stringify({type:'kicked',reason}));
  session.end(4010,'kicked');
 }

 function startNative(session,join,name,reply,end){
  const {ws}=session;session.join=join;
  // The backend address comes from operator configuration only, never from the browser.
  const socket=createSocket('udp4');session.socket=socket;
  const client=new UlinkClient({now,config:ulinkConfig,login:{userId:BigInt(join.backendId),name,ticket:join.authBytes},send:b=>{if(session.state!=='closed')socket.send(b);}});
  session.client=client;session.state='connecting';
  // A connected UDP socket resolves operator hostnames and filters the peer in the OS. Comparing
  // rinfo.address to the configured hostname would drop every reply when it is e.g. "localhost".
  socket.on('message',m=>{try{if(session.state==='in-game')stalls.native(session.id);client.receive(new Uint8Array(m));}catch(error){sessionError(session,'native datagram',error);}});
  // Before approval the browser shows the original client's uLink_OnFailedToConnect text ("Failed to connect
  // (ConnectionFailed)"); after it, MainMenu.uLink_OnDisconnectedFromServer's (net-client 'closed').
  const failed=reason=>{const error=failedToConnectError(reason);metrics.nativeFailed++;session.trace?.('native connect failed',reason);reply({type:'denied',reason:'connection-failed',error});end(4006,'connection failed');};
  // ICMP port unreachable from a stopped server (ECONNREFUSED on Linux): Lidgren ignores ConnectionReset and keeps
  // retrying, so only the handshake retries or the pong timeout end the session, as in the original client.
  socket.on('error',e=>{if(e?.code==='ECONNREFUSED'||e?.code==='ECONNRESET')return;if(session.state==='connecting'&&!session.ending)return failed('native socket error '+(e?.code??''));reply({type:'disconnected',reason:'native socket error'});end(1011,'native socket error');});
  client.on('approved',a=>{
   session.bridge=new GameBridge({client,schema,ngcRegistry,sceneDoors,playerName:name,sendRate:a.worldInfo.sendRate,now});
   session.watch=new PlayerWatch({subject:join.subject,name,playerId:a.playerId,...anticheat,sendInterval:a.worldInfo.sendRate>0?1/a.worldInfo.sendRate:0.1,now,wallNow});
   session.stats=new PlayerStats({subject:join.subject,client,views:session.bridge.views,now,wallNow});
   session.bridge.on('clock-resync',()=>stalls.resync(session.id));
   session.bridge.on('event',e=>{
    if(e.type==='create'&&e.mine&&e.prefab===':player_soldier')session.character=e.viewId;
    // ServerManagement.KP(int): the original server's own kick reason (NetError), cached for the trace/metrics below
    // since the Lidgren Disconnect that follows carries no code of its own (browser/net-error.mjs; browser/online.mjs
    // caches the same RPC to show "Disconnected (<NiceString>)"). Never a player identity, only the numeric reason.
    if(e.type==='rpc'&&e.name==='KP'&&e.args?.class==='ServerManagement'&&Number.isInteger(e.args.values?.[0])){
     session.kickCode=e.args.values[0];metrics.kickCodes[session.kickCode]=(metrics.kickCodes[session.kickCode]??0)+1;
    }
    // Own-character ReadClientMove is always a server correction (normal relays go to OthersExceptOwner).
    if(e.type==='rpc'&&e.name==='ReadClientMove'&&e.viewId===session.character)stalls.correction(session.id,{lateS:e.args?.values?.[3],serverMs:e.timestampMs});
    else if(e.type==='rpc'||e.type==='rpc-undecoded'||e.type==='ngc-call')stalls.rpc(e.name??'ngc');
    else if(e.type==='create'||e.type==='destroy')stalls.rpc(e.type+(e.prefab?':'+e.prefab:''));
    // Join milestones only: the world's ServerManagement, our own views (the character first) and refusals.
    if(e.type==='create'&&(e.mine||/ServerManagement/i.test(e.prefab??'')))session.trace('create',e.prefab,'view',e.viewId,e.mine?'(ours)':'');
    else if(e.type==='command-rejected'&&(session.rejectsLogged=(session.rejectsLogged??0)+1)<=5)session.trace('command rejected',e.reason); // first few only
    // An observer failure is logged and the event still reaches the page (it never ends the session or the process).
    try{session.watch.observe(e);session.stats.observe(e);}catch(error){metrics.sessionErrors++;log('session',session.id,'observer error',String(error?.stack??error).slice(0,2000));}
    relay(session,e);});
   session.bridge.on('dropped',kind=>{metrics.missingView[kind]=(metrics.missingView[kind]??0)+1;});
   session.state='in-game';metrics.approved++;log('approved',join.subject,a.playerId);
   reply({type:'approved',playerId:a.playerId,world:{level:a.worldInfo.level,hostname:a.worldInfo.hostname,sendRate:a.worldInfo.sendRate,modded:a.worldInfo.modded,official:a.worldInfo.official}});
  });
  client.connection.on('connected',()=>session.trace?.('native handshake done; login sent'));
  // Native decode failures, so a stalled spawn shows what could not be read.
  client.connection.on('protocol-error',e=>session.trace?.('native protocol error',e?.message??e));
  client.on('denied',error=>{metrics.serverDenied++;session.trace?.('native server denied',error);reply({type:'denied',reason:'server-denied',error});end(4005,'server denied');});
  client.on('closed',reason=>{
   if(session.state==='connecting'&&!session.ending)return failed(reason);
   metrics.nativeClosed++;
   // A native kick carries no evidence of its own past this point (the KP RPC above is the only record of why), so the
   // trace line is this session's one chance to connect the generic Lidgren Disconnect to a reason and recent move
   // timing (bridge/game-bridge.mjs's clampedMoves/droppedMoves: moves the stall/hitch handling had to reshape or give
   // up on) — evidence for a TruthDetector-style violation kick the gateway itself never decided and cannot see inside.
   const kick=session.kickCode!=null?` kickCode=${session.kickCode} (${netErrorName(session.kickCode)})`:'',
    moves=session.bridge?` moveClamped=${session.bridge.clampedMoves??0} moveDropped=${session.bridge.droppedMoves??0}`:'';
   if(session.bridge){metrics.moveClamped+=session.bridge.clampedMoves??0;metrics.moveDropped+=session.bridge.droppedMoves??0;}
   session.trace?.('native closed',reason+kick+moves);
   reply({type:'disconnected',reason});end(1000,'native closed');
  });
  const loopback=native.host==='127.0.0.1'||native.host==='localhost';
  socket.bind(0,loopback?'127.0.0.1':'0.0.0.0',()=>{if(session.state!=='closed')socket.connect(native.port,native.host,()=>{if(session.state!=='closed')client.start();});});
 }

 return {
  // Attach to an HTTPS/HTTP server; only the gateway path and allowed origins may upgrade.
  attach(server,path='/play'){
   server.on('upgrade',(req,socket,head)=>{
    const url=new URL(req.url,'http://gateway');
    if(url.pathname!==path||!allowedOrigins.includes(req.headers.origin)||!String(req.headers['sec-websocket-protocol']??'').split(',').map(s=>s.trim()).includes(BROWSER_PROTOCOL)){metrics.upgradeRejected++;socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
    // Open sockets per client address and in total, counted from here until the TCP socket closes.
    const ip=clientIp(req)||'unknown',open=openByIp.get(ip)??0;
    if(openSockets>=limits.maxConnections||open>=limits.perIp){metrics.upgradeLimited++;socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    openSockets++;openByIp.set(ip,open+1);req.rlbClientIp=ip;
    socket.once('close',()=>{openSockets--;const n=(openByIp.get(ip)??1)-1;if(n>0)openByIp.set(ip,n);else openByIp.delete(ip);});
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
   });
  },
  sessions,
  metrics,
  stalls,
  // Admin or policy kick by central account subject; returns whether a session was found.
  kick(subject,reason='kicked'){let found=false;for(const s of [...sessions])if(s.join?.subject===subject){kick(s,reason);found=true;}return found;},
  // Live roster and new evidence for the central report (bridge/gateway-launcher.mjs).
  roster(){return [...sessions].filter(s=>s.state==='in-game'&&s.watch).map(s=>s.watch.summary());},
  drainFlags(){const out=orphanFlags;orphanFlags=[];for(const s of sessions)if(s.watch)out.push(...s.watch.drain());return out;},
  requeueFlags(flags){orphanFlags=[...flags,...orphanFlags].slice(-500);},
  // Leaderboard counts since the last report: [{subject, counts:{kind[:sub]: n}}] (central/stats.mjs).
  drainStats(){for(const s of sessions)if(s.stats)keepStats(s.join.subject,s.stats.drain());const out=[...pendingStats].map(([subject,counts])=>({subject,counts}));pendingStats=new Map();return out;},
  requeueStats(list){for(const {subject,counts} of list)keepStats(subject,counts);if(pendingStats.size>2000)pendingStats=new Map([...pendingStats].slice(-2000));},
  // Admin screenshot for central request `id`: asks the account's page for its next frame (no prompt is shown) and
  // resolves {ok, image?, meta?, reason?, gateway} with this gateway's own view of the player at request and reply.
  capture(subject,id,timeoutMs=CAPTURE_TIMEOUT_MS){
   const session=[...sessions].find(s=>s.state==='in-game'&&s.watch&&s.join?.subject===subject);
   if(!session)return Promise.resolve({ok:false,reason:'not-connected'});
   if(session.capture)return Promise.resolve({ok:false,reason:'busy'});
   const pose=()=>({pos:session.watch.prev?.pos??null,yaw:session.watch.lastAim?.yaw??null}),started=wallNow(),request=pose();
   return new Promise(resolve=>{
    const timer=setTimeout(()=>session.capture?.finish({ok:false,reason:'no-response'}),timeoutMs);
    payloadLimit(session.ws,MAX_CAPTURE_MESSAGE);
    session.capture={id,finish:r=>{clearTimeout(timer);session.capture=null;payloadLimit(session.ws,MAX_FRAME);resolve({...r,gateway:{latencyMs:wallNow()-started,request,reply:pose()}});}};
    session.reply({type:'capture',id});
   });
  },
  limits,
  close(){clearInterval(tick);clearInterval(liveness);for(const s of [...sessions]){s.end(1001,'Gateway shutting down');s.ws.terminate();}sessions.clear();wss.close();},
 };
}
