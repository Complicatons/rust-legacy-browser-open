// Assembles a runnable gateway: central-service redemption, adapter sidecar control channel, browser WebSocket
// endpoint, native server session engine, heartbeats and a health endpoint. Used by tools/gateway.mjs.
// Pilot code: verified against mocks only.
import {createServer as createHttp} from 'node:http';
import {createServer as createHttps} from 'node:https';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {createControlSender} from './adapter.mjs';
import {createGatewayAdmission} from './gateway.mjs';
import {createGatewayService,GATEWAY_LIMITS} from './gateway-service.mjs';
import {createRemoteAccount} from './remote-account.mjs';
import {AdmissionError} from './admission.mjs';
import {createClientIp,trustedProxyErrors} from './client-ip.mjs';
import {listenServer} from './listen.mjs';

// Isolated-VM testing (SERVER-TESTING-PLAN.md, deploy/vm-test): `mode: "vm-test"` plus `testHostOnlyBind` lets the
// gateway listen on a host-only VM address (plain ws or TLS). Only private subnets, only addresses inside that
// subnet, never wildcard/loopback/public binds; production configs (no mode) reject the option.
export const DEFAULT_HOST_ONLY_SUBNET='192.168.56.0/24';
const PRIVATE_NETS=['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'];
export function parseIPv4(s){
 const m=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s??''));if(!m)return null;
 const o=m.slice(1).map(Number);if(o.some(x=>x>255)||m.slice(1).some(x=>x.length>1&&x[0]==='0'))return null;
 return ((o[0]<<24)>>>0)+(o[1]<<16)+(o[2]<<8)+o[3];
}
export function parseSubnet(s){
 const m=/^([0-9.]+)\/(\d{1,2})$/.exec(String(s??''));if(!m)return null;
 const ip=parseIPv4(m[1]),bits=Number(m[2]);if(ip===null||bits<1||bits>32)return null;
 const mask=bits===32?0xffffffff:(~(0xffffffff>>>bits))>>>0;
 return (ip&mask)>>>0===ip?{base:ip,bits,mask,size:2**(32-bits)}:null; // host bits must be zero
}
export const inSubnet=(ip,net)=>ip!==null&&net!==null&&((ip&net.mask)>>>0)===net.base;
export const isPrivateIPv4=ip=>PRIVATE_NETS.some(n=>inSubnet(ip,parseSubnet(n)));
const hostOnlySubnet=c=>c.testHostOnlyBind===true?DEFAULT_HOST_ONLY_SUBNET:c.testHostOnlyBind?.subnet;

function vmTestErrors(c){
 const e=[];
 if(c.mode!==undefined&&c.mode!=='production'&&c.mode!=='vm-test')e.push('mode must be "production" (default) or "vm-test"');
 if(c.testHostOnlyBind!==undefined&&c.mode!=='vm-test')e.push('testHostOnlyBind is only allowed with mode "vm-test" (isolated test VM); production gateways serve TLS or listen on 127.0.0.1');
 if(c.mode!=='vm-test')return e;
 if(c.testHostOnlyBind!==true&&(typeof c.testHostOnlyBind!=='object'||c.testHostOnlyBind===null)){e.push('mode "vm-test" requires testHostOnlyBind: {subnet: "192.168.56.0/24"}');return e;}
 const raw=hostOnlySubnet(c),net=parseSubnet(raw);
 if(!net){e.push(`testHostOnlyBind.subnet must be an IPv4 CIDR with zero host bits, e.g. ${DEFAULT_HOST_ONLY_SUBNET}`);return e;}
 if(net.bits<16||net.bits>30)e.push('testHostOnlyBind.subnet prefix must be /16../30');
 if(!isPrivateIPv4(net.base)||!isPrivateIPv4((net.base+net.size-1)>>>0))e.push('testHostOnlyBind.subnet must lie inside a private range (10/8, 172.16/12, 192.168/16)');
 const host=parseIPv4(c.listen?.host);
 if(host===null)e.push('vm-test listen.host must be an IPv4 address (no hostnames, no wildcard)');
 else if(host===0)e.push('vm-test refuses the wildcard address 0.0.0.0');
 else if(host>>>24===127)e.push('vm-test listen.host is loopback: drop mode "vm-test" for a loopback gateway');
 else if(!isPrivateIPv4(host))e.push(`vm-test refuses public listen address ${c.listen.host}`);
 else if(!inSubnet(host,net))e.push(`vm-test listen.host ${c.listen.host} is outside the host-only subnet ${raw}`);
 else if(host===net.base||host===((net.base+net.size-1)>>>0))e.push('vm-test listen.host must not be the network or broadcast address');
 if(!Number.isInteger(c.listen?.port)||c.listen.port<1||c.listen.port>65535)e.push('vm-test listen.port must be set explicitly');
 if(c.native?.host!=='127.0.0.1')e.push('vm-test native.host must be 127.0.0.1 (server on the VM loopback)');
 try{const u=new URL(c.centralUrl),ip=parseIPv4(u.hostname);if(!inSubnet(ip,net))e.push('vm-test centralUrl must point at the host-only host address (inside the subnet)');}catch{}
 if(c.allowPlainHttp)e.push('vm-test: remove allowPlainHttp (testHostOnlyBind replaces it)');
 if(c.allowInsecureOrigins)e.push('vm-test: remove allowInsecureOrigins (origins must be inside the host-only subnet)');
 for(const o of Array.isArray(c.allowedOrigins)?c.allowedOrigins:[]){
  let u;try{u=new URL(o);}catch{e.push(`vm-test origin ${o} is not a URL`);continue;}
  if(!/^https?:$/.test(u.protocol)||u.origin!==o||!inSubnet(parseIPv4(u.hostname),net))e.push(`vm-test origin ${o} must be http(s)://<host-only address>[:port]`);
 }
 return e;
}

// Runtime check (vm-test): the bind address must belong to this machine. `interfaces` is os.networkInterfaces() shape.
export function hostOnlyBindProblems(c,interfaces=networkInterfaces()){
 if(c.mode!=='vm-test')return [];
 const mine=Object.values(interfaces).flat().filter(a=>a&&(a.family==='IPv4'||a.family===4)).map(a=>a.address);
 return mine.includes(c.listen?.host)?[]:[`vm-test listen.host ${c.listen?.host} is not an address of this machine (have: ${mine.join(', ')||'none'})`];
}
export function vmTestBanner(c){
 const line='!'.repeat(78);
 return [line,`!! VM-TEST MODE: gateway bound to host-only address ${c.listen?.host}:${c.listen?.port} (${hostOnlySubnet(c)})`,
  `!! ${c.tls?'TLS with a test certificate':'PLAIN ws:// (no TLS)'}. For the isolated test VM only; never use this config in production.`,line].join('\n');
}
function tlsOptions(t){
 if(t.pfx)return {pfx:readFileSync(t.pfx),passphrase:t.passphraseFile?readFileSync(t.passphraseFile,'utf8').trim():t.passphrase};
 return {cert:readFileSync(t.cert),key:readFileSync(t.key)};
}

export function validateConfig(c){
 const errors=[...vmTestErrors(c)];
 const hostOnly=c.mode==='vm-test'&&errors.length===0;
 if(!/^[0-9a-f-]{36}$/.test(c.serverId??''))errors.push('serverId must be the central server UUID');
 try{new URL(c.centralUrl);}catch{errors.push('centralUrl must be a URL');}
 if(!/^[A-Za-z0-9_-]{43}$/.test(c.credential??''))errors.push('credential missing (run enrol first)');
 if(!c.native?.host||!Number.isInteger(c.native?.port))errors.push('native.host and native.port are required');
 if(!Array.isArray(c.allowedOrigins)||!c.allowedOrigins.length||c.allowedOrigins.some(o=>!/^https:\/\//.test(o)&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o)&&!c.allowInsecureOrigins&&!hostOnly))errors.push('allowedOrigins must list the https website origins');
 try{if(new URL(c.sidecarUrl).hostname!=='127.0.0.1')errors.push('sidecarUrl must be on 127.0.0.1');}catch{errors.push('sidecarUrl must be a URL');}
 if(!/^([0-9a-f]{2}){32,}$/i.test(c.controlKeyHex??''))errors.push('controlKeyHex must hold at least 32 bytes of hex');
 if(!c.tls&&c.listen?.host!=='127.0.0.1'&&!c.allowPlainHttp&&!hostOnly&&c.mode!=='vm-test')errors.push('serve TLS (tls.cert/tls.key) or listen on 127.0.0.1 behind an HTTPS proxy');
 if(c.tls&&!(c.tls.pfx||(c.tls.cert&&c.tls.key)))errors.push('tls needs cert and key files, or a pfx file (with passphraseFile)');
 if(c.reportMs!==undefined&&!(Number.isInteger(c.reportMs)&&c.reportMs>=20&&c.reportMs<=60000))errors.push('reportMs must be 20..60000');
 if(c.anticheat?.policy?.autoKick!==undefined&&typeof c.anticheat.policy.autoKick!=='boolean')errors.push('anticheat.policy.autoKick must be true or false');
 for(const k of ['lineOfSight','trees'])if(c.anticheat?.[k]!==undefined&&typeof c.anticheat[k]!=='boolean')errors.push(`anticheat.${k} must be true or false`);
 // desktop: {publicHost, publicPort, leaseKick?} enables POST /desktop/admit for the desktop launcher (DESKTOP-LAUNCHER-PLAN.md);
 // publicHost:publicPort is the game address players' clients connect to (native.host is usually loopback).
 if(c.desktop!==undefined){
  if(typeof c.desktop?.publicHost!=='string'||!/^[A-Za-z0-9.-]{1,253}$/.test(c.desktop.publicHost)||!Number.isInteger(c.desktop?.publicPort)||c.desktop.publicPort<1||c.desktop.publicPort>65535)errors.push('desktop.publicHost and desktop.publicPort must name the game address desktop players connect to');
  if(c.desktop?.leaseKick!==undefined&&typeof c.desktop.leaseKick!=='boolean')errors.push('desktop.leaseKick must be true or false');
 }
 if(c.metricsToken!==undefined&&!/^[\x21-\x7e]{24,}$/.test(String(c.metricsToken)))errors.push('metricsToken must be at least 24 printable characters');
 // trustedProxies: ["cloudflare", "loopback", CIDR…] in front of the gateway; their forwarding headers name the client
 // for per-client limits (bridge/client-ip.mjs). Straight behind Cloudflare: ["cloudflare"].
 errors.push(...trustedProxyErrors(c.trustedProxies));
 if(c.capacity!==undefined&&!(Number.isInteger(c.capacity)&&c.capacity>=1&&c.capacity<=1000))errors.push('capacity must be 1..1000 players');
 // limits: overrides of bridge/gateway-service.mjs GATEWAY_LIMITS (e.g. perIp / admitsPerMinute for a load test).
 if(c.limits!==undefined){
  if(typeof c.limits!=='object'||c.limits===null||Array.isArray(c.limits))errors.push('limits must be an object');
  else for(const [k,v] of Object.entries(c.limits))if(!Object.hasOwn(GATEWAY_LIMITS,k)||k==='capacity'||!(Number.isInteger(v)&&v>=1))errors.push(`limits.${k} is not a gateway limit (${Object.keys(GATEWAY_LIMITS).filter(n=>n!=='capacity').join(', ')}) with a whole number >= 1`);
 }
 return errors;
}
// Gateway limits from the config: capacity is the advertised figure; an isolated test VM (one tester host driving many
// bots) is not held to the per-address limits unless its config sets them.
export function gatewayLimits(c){
 return {capacity:c.capacity??50,...(c.mode==='vm-test'?{perIp:GATEWAY_LIMITS.maxConnections,admitsPerMinute:6000}:{}),...c.limits};
}

// anticheat: {limits, weapons (Map uid→weapon), groundHeight, lineOfSight} built by the caller from recovered data (tools/gateway.mjs);
// config.anticheat.policy (JSON) may set autoKick/kickScore/reviewScore. sceneDoors: the scene MovingDoors manual view IDs
// (recovered scene/manifest.json doors[i].viewID), so the browser can use static doors through Context:A.
export async function startGateway(config,{schema,ngcRegistry,sceneDoors=[],anticheat={},fetchImpl=fetch,log=()=>{},warn=console.warn,interfaces}={}){
 const errors=validateConfig(config);if(errors.length)throw Error('Invalid gateway config:\n - '+errors.join('\n - '));
 if(config.mode==='vm-test'){
  const problems=hostOnlyBindProblems(config,interfaces??networkInterfaces());
  if(problems.length)throw Error('Refusing vm-test bind:\n - '+problems.join('\n - '));
  warn(vmTestBanner(config));
 }
 const account=createRemoteAccount({baseUrl:config.centralUrl,credential:config.credential,fetchImpl});
 const control=createControlSender(Buffer.from(config.controlKeyHex,'hex'));
 const sendControl=async body=>{
  const res=await fetchImpl(new URL('/control',config.sidecarUrl),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(control(body))});
  return res.json();
 };
 const admission=createGatewayAdmission({serverId:config.serverId,account,sendControl});
 const service=createGatewayService({admission,native:config.native,allowedOrigins:config.allowedOrigins,schema,ngcRegistry,sceneDoors,anticheat:{...anticheat,policy:{...anticheat.policy,...config.anticheat?.policy}},limits:gatewayLimits(config),clientIp:createClientIp(config.trustedProxies),log});
 // connecting: sessions mid native-handshake (host/udp-probe.mjs's watchdog skips its probe while this is above 0,
 // since uLink only has one pending-connection slot and the probe would starve a real join, HANDOFF.md H12).
 const stats=()=>{let inGame=0,connecting=0;for(const s of service.sessions){if(s.state==='in-game')inGame++;else if(s.state==='admitting'||s.state==='connecting')connecting++;}return {sessions:service.sessions.size,inGame,connecting};};
 const heartbeats={ok:0,failed:0,lastOk:0},reports={ok:0,failed:0},captures={ok:0,failed:0};
 const metricsText=()=>{const m=service.metrics,st=stats(),lines=[];
  const metric=(name,type,help,values)=>{lines.push(`# HELP rlb_gateway_${name} ${help}`,`# TYPE rlb_gateway_${name} ${type}`);for(const [labels,v] of values)lines.push(`rlb_gateway_${name}${labels} ${v}`);};
  metric('sessions','gauge','Open browser WebSocket sessions.',[['',st.sessions]]);
  metric('in_game','gauge','Sessions approved by the native server.',[['',st.inGame]]);
  metric('connections_total','counter','Accepted WebSocket connections.',[['',m.connections]]);
  metric('upgrades_rejected_total','counter','Refused upgrades (path, origin or subprotocol).',[['',m.upgradeRejected]]);
  metric('admitted_total','counter','Join tickets redeemed.',[['',m.admitted]]);
  metric('denied_total','counter','Admissions refused, by reason.',Object.entries(m.denied).map(([r,v])=>[`{reason="${r.replace(/[^a-z0-9_-]/gi,'_')}"}`,v]));
  metric('approved_total','counter','Native server approvals.',[['',m.approved]]);
  metric('server_denied_total','counter','Native server denials.',[['',m.serverDenied]]);
  metric('native_connect_failed_total','counter','Native connections that ended before approval (server stopped or unreachable).',[['',m.nativeFailed]]);
  metric('native_closed_total','counter','Native connections closed.',[['',m.nativeClosed]]);
  metric('rate_limited_total','counter','Commands dropped by the per-session rate limit.',[['',m.rateLimited]]);
  metric('malformed_total','counter','Sessions ended for malformed messages.',[['',m.malformed]]);
  metric('session_errors_total','counter','Errors while handling one session (that session alone ended or the event was still relayed).',[['',m.sessionErrors]]);
  metric('upgrades_limited_total','counter','Refused upgrades over the per-address or total socket limit.',[['',m.upgradeLimited]]);
  metric('slow_consumers_total','counter','Sessions ended because the page fell too far behind (unsent bytes over the hard cap).',[['',m.slowConsumers]]);
  metric('coalesced_events_total','counter','Position/animal updates merged while a page was behind.',[['',m.coalesced]]);
  metric('ping_timeouts_total','counter','Sessions ended after unanswered WebSocket pings.',[['',m.pingTimeouts]]);
  metric('missing_view_drops_total','counter','Server RPCs for views or NGC entities the session does not have (dropped, as uLink and NGC do).',Object.entries(m.missingView).map(([k,v])=>[`{kind="${k}"}`,v]));
  metric('admission_timeouts_total','counter','Sessions that never sent a join ticket.',[['',m.admissionTimeouts]]);
  metric('anticheat_dropped_total','counter','Commands dropped by anti-cheat checks.',[['',m.anticheatDropped]]);
  metric('anticheat_flags_total','counter','Anti-cheat flags raised.',[['',m.anticheatFlags]]);
  metric('kicked_total','counter','Sessions kicked by admins, bans or policy.',[['',m.kicked]]);
  const sm=service.stalls.metrics;
  metric('move_corrections_total','counter','Server corrections of a player\'s own position (ReadClientMove to its owner).',[['',sm.corrections]]);
  metric('clock_resyncs_total','counter','Server clock resync requests (RS: late moves).',[['',sm.resyncs]]);
  metric('correction_bursts_total','counter','Many sessions corrected within one second (logged as correction-burst).',[['',sm.bursts]]);
  metric('loop_lag_max_ms','gauge','Longest delay of the gateway\'s 10 ms tick since start.',[['',sm.loopLagMaxMs]]);
  metric('loop_lag_recent_ms','gauge','Longest delay (>= 100 ms) of the gateway\'s 10 ms tick in the last 10 s.',[['',service.stalls.recentLagMs()]]);
  metric('desktop_admitted_total','counter','Desktop launcher passes admitted.',[['',desktopMetrics.admitted]]);
  metric('desktop_denied_total','counter','Desktop launcher passes refused.',[['',desktopMetrics.denied]]);
  metric('desktop_end_kicks_total','counter','Desktop characters kicked after their launcher signed out or lost its lease.',[['',desktopMetrics.endKicks]]);
  metric('reports_total','counter','Roster/evidence reports to central, by result.',[['{result="ok"}',reports.ok],['{result="failed"}',reports.failed]]);
  metric('heartbeats_total','counter','Directory heartbeats, by result.',[['{result="ok"}',heartbeats.ok],['{result="failed"}',heartbeats.failed]]);
  metric('screenshots_total','counter','Admin screenshot results passed to central, by upload result.',[['{result="ok"}',captures.ok],['{result="failed"}',captures.failed]]);
  metric('last_heartbeat_ok_seconds','gauge','Unix time of the last successful heartbeat.',[['',heartbeats.lastOk]]);
  return lines.join('\n')+'\n';};
 // Desktop launcher admission: {pass} → {backendId, envelope, native}. The pass travels in the body only, never the URL.
 const admits=new Map(),clientIp=createClientIp(config.trustedProxies),json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 const desktopMetrics={admitted:0,denied:0,endKicks:0};
 async function desktopAdmit(req,res){
  if(!config.desktop)return json(res,404,{error:'desktop-disabled'});
  const ip=clientIp(req),t=Date.now(),w=admits.get(ip);
  if(!w||t-w.start>60e3)admits.set(ip,{start:t,n:1});else if(++w.n>30)return json(res,429,{error:'rate-limited'});
  if(admits.size>10000)for(const [k,v] of admits)if(t-v.start>60e3)admits.delete(k);
  if(req.headers['content-type']!=='application/json')return json(res,415,{error:'json-required'});
  let raw='';for await(const c of req){raw+=c;if(raw.length>4096)return json(res,413,{error:'too-large'});}
  let pass;try{pass=JSON.parse(raw).pass;}catch{return json(res,400,{error:'malformed'});}
  if(typeof pass!=='string'||pass.length>2048)return json(res,400,{error:'malformed'});
  try{
   const r=await admission.admitDesktop(pass,{ip});desktopMetrics.admitted++;log('desktop admitted',r.subject);
   json(res,200,{backendId:r.backendId,name:r.name??null,envelope:r.envelope.toString('base64'),native:{host:config.desktop.publicHost,port:config.desktop.publicPort},expiresInSeconds:30});
  }catch(e){desktopMetrics.denied++;const reason=e instanceof AdmissionError?e.code:'admission-failed';log('desktop denied',reason);json(res,403,{error:reason});}
 }
 const handler=(req,res)=>{
  if(req.method==='POST'&&req.url==='/desktop/admit'){desktopAdmit(req,res).catch(()=>json(res,500,{error:'internal'}));return;}
  if(req.method==='GET'&&req.url==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,...stats(),heartbeat:{lastOk:heartbeats.lastOk,failed:heartbeats.failed}}));return;} // heartbeat: the host app's enrolment panel
  // Prometheus text format; only when the operator configured a bearer token (the listener is public).
  if(req.method==='GET'&&req.url==='/metrics'&&config.metricsToken){
   const auth=Buffer.from(String(req.headers.authorization??'')),want=Buffer.from('Bearer '+config.metricsToken);
   if(auth.length!==want.length||!timingSafeEqual(auth,want)){res.writeHead(401,{'Content-Type':'text/plain'});res.end('unauthorized\n');return;}
   res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4','Cache-Control':'no-store'});res.end(metricsText());return;
  }
  res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"not-found"}');
 };
 // Sessions a previous gateway process left on the server (crash, kill): the adapter has the plugin kick them, so their
 // players can rejoin now instead of being refused "already connected" until the server times them out.
 const leftover=await sendControl({type:'gateway-started',serverId:config.serverId}).catch(()=>null);
 if(leftover?.kicked||leftover?.released)log('gateway start: leftover browser sessions kicked',leftover.kicked,'released',leftover.released);
 const server=config.tls?createHttps(tlsOptions(config.tls),handler):createHttp(handler);
 service.attach(server,config.path??'/play');
 await listenServer(server,{port:config.listen?.port??0,host:config.listen?.host??'127.0.0.1'});
 const beat=async()=>{try{await account.heartbeat({players:stats().inGame,capacity:config.capacity??50,wipe:config.wipe});heartbeats.ok++;heartbeats.lastOk=Math.floor(Date.now()/1000);}catch(e){heartbeats.failed++;log('heartbeat failed',e.message);}};
 // A desktop launcher's lease ended (sign-out, revoke, heartbeat lost) or its account was kicked: the adapter kicks the
 // character only while a launcher login holds it. desktop.leaseKick: false keeps the launcher a join-time check only.
 const endDesktop=async(subject,reason)=>{
  if(!config.desktop||config.desktop.leaseKick===false)return;
  const r=await sendControl({type:'end-desktop',serverId:config.serverId,subject,reason:String(reason??'launcher-ended').slice(0,40)}).catch(()=>null);
  if(r?.kicked){desktopMetrics.endKicks++;log('desktop session ended',subject,reason);}
 };
 // Desktop character links: central → (this outbound poll) → adapter reservation → central commit → adapter confirm.
 const runLinks=async()=>{
  let tasks;try{tasks=await account.tasks();}catch{return;}
  for(const t of tasks){
   if(t.type==='desktop-ended'){if(typeof t.subject==='string')await endDesktop(t.subject,t.reason);continue;}
   if(t.type!=='link')continue;
   const r=await sendControl({type:'reserve-link',serverId:config.serverId,code:t.code,subject:t.subject}).catch(()=>({ok:false,reason:'adapter-unavailable'}));
   const {data}=await account.linkReserved(t.request,r.ok?{ok:true,backendId:r.backendId}:{ok:false,reason:r.reason});
   if(!data.commit)continue; // the adapter reservation expires on its own
   const c=await sendControl({type:'confirm-link',serverId:config.serverId,reservationId:r.reservationId}).catch(()=>({ok:false}));
   await account.linkConfirmed(t.request,Boolean(c.ok));
  }
 };
 // Anti-cheat roster/evidence → central; central answers with kicks (admin kicks and accounts with active bans).
 // Admin commands travel central → (report reply) → adapter queue → plugin poll; results and in-game reports travel
 // back through the adapter outbox and the next report. Events that could not be delivered wait for the next one.
 let reporting=false,events=[];
 const report=async()=>{
  if(reporting)return;reporting=true;const flags=service.drainFlags(),stats=service.drainStats?.()??[];
  const drained=await sendControl({type:'drain-events',serverId:config.serverId}).catch(()=>null);
  if(Array.isArray(drained?.events))events.push(...drained.events);
  const sending=events.splice(0,200),desktop=Array.isArray(drained?.desktop)?drained.desktop:null;
  try{
   const {kicks,commands,screenshots}=await account.report({players:service.roster(),flags,events:sending,desktop,stats});reports.ok++;
   // Admin screenshots run beside the report loop: the page has up to 20 s, the upload goes straight to central.
   for(const s of screenshots)if(typeof s?.id==='string'&&typeof s.subject==='string')service.capture(s.subject,s.id).then(r=>account.screenshot({id:s.id,...r})).then(()=>{captures.ok++;},e=>{captures.failed++;log('screenshot upload failed',e.message);});
   for(const k of kicks)if(typeof k?.subject==='string'){const why=typeof k.reason==='string'?k.reason.slice(0,40):'kicked';service.kick(k.subject,why);await endDesktop(k.subject,why);}
   for(const c of commands){
    const r=await sendControl({type:'admin-command',serverId:config.serverId,id:c.id,action:c.action,subject:c.subject,handle:c.handle,actorSubject:c.actorSubject,reason:c.reason,message:c.message}).catch(()=>({ok:false,reason:'adapter-unavailable'}));
    if(!r?.ok)events.push({type:'command-result',id:c.id,ok:false,reason:String(r?.reason??'adapter-refused').slice(0,40)});
   }
  }
  catch(e){reports.failed++;service.requeueFlags(flags);service.requeueStats?.(stats);events=[...sending,...events].slice(-500);log('report failed',e.message);}
  finally{reporting=false;}
 };
 await beat();const timer=setInterval(beat,15000),linkTimer=setInterval(runLinks,config.linkPollMs??2000),reportTimer=setInterval(report,config.reportMs??5000);
 return {port:server.address().port,stats,service,close:async()=>{clearInterval(timer);clearInterval(linkTimer);clearInterval(reportTimer);service.close();await new Promise(r=>server.close(r));}};
}
