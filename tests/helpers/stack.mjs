// Shared full-stack fixture: central service, adapter sidecar, plugin-style approval, mock uLink server, gateway.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import WebSocket from 'ws';
import {openCentralDb} from '../../central/db.mjs';
import {createCentralService,createDevLoginVerifier} from '../../central/service.mjs';
import {createSigningKey} from '../../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap} from '../../bridge/adapter.mjs';
import {createAdapterSidecar,signPluginBody} from '../../bridge/sidecar.mjs';
import {enrolGateway} from '../../bridge/remote-account.mjs';
import {startGateway} from '../../bridge/gateway-launcher.mjs';
import {listenServer} from '../../bridge/listen.mjs';
export const METRICS_TOKEN='test-metrics-token-0123456789';
import {startMockUlinkServer} from '../../bridge/ulink/mock-server.mjs';
import {GatewayClient} from '../../browser/net-client.mjs';

export const ORIGIN='https://play.example.test';
// Recovered M4 datablock values (items/manifest.json) so the fixture does not need the ignored asset files.
export const STACK_WEAPONS=new Map([[-1852181914,{name:'M4',fireRate:0.125,range:140,pellets:1,clip:24}]]);
const listen=async handler=>{const s=createServer(handler);await listenServer(s);return s;};
export const poll=async(f,ms=6000)=>{const t=Date.now();while(Date.now()-t<ms){const v=await f();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};

// anticheat: overrides for the gateway's anti-cheat options (e.g. a small lineOfSight world).
// gateway: extra gateway config (e.g. desktop for the launcher's /desktop/admit). sceneDoors: scene MovingDoor manual view
// IDs (tools/gateway.mjs passes them from the scene export).
export async function startStack({gatewayOrigins=[],anticheat={},gateway:gatewayConfig={},sceneDoors=[]}={}){
 const schema=JSON.parse(await readFile(new URL('../../bridge/ulink/rpc-schema.json',import.meta.url)));
 const ngcRegistry=await readFile(new URL('../../browser/assets/recovered/ngc/registry.json',import.meta.url)).then(b=>JSON.parse(b)).catch(()=>undefined);
 const central=createCentralService({db:openCentralDb(),keys:[createSigningKey('k1')],issuer:'https://accounts.example.test',verifyLogin:createDevLoginVerifier(),allowedOrigins:[ORIGIN],secureCookies:false});
 const centralHttp=await listen((q,r)=>central.handle(q,r)),centralUrl=`http://127.0.0.1:${centralHttp.address().port}`;
 const call=async(method,path,{data,cookie,csrf}={})=>{const res=await fetch(centralUrl+path,{method,headers:{origin:ORIGIN,...(data?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};};
 const login=async s=>{const r=await call('POST','/auth/login',{data:{subject:s,name:s}});return {cookie:r.cookie,csrf:r.data.csrf,player:r.data.player};};
 const owner=await login('owner');
 const created=(await call('POST','/owner/servers',{cookie:owner.cookie,csrf:owner.csrf,data:{name:'Pilot',region:'eu',endpoint:'wss://pilot.example/play'}})).data;
 const {credential}=await enrolGateway({baseUrl:centralUrl,code:created.enrolmentCode});
 const controlKey=randomBytes(32),pluginKey=randomBytes(32);
 const adapter=createIdentityAdapter({serverId:created.id,controlKey,identities:createIdentityMap({namespace:{base:'90000000000000000',size:'1000000000'}})});
 const sidecar=createAdapterSidecar({adapter,pluginKey}),sidecarHttp=await listen((q,r)=>sidecar.handle(q,r));
 const sidecarUrl=`http://127.0.0.1:${sidecarHttp.address().port}`,boot=randomBytes(16).toString('hex');let seq=0,last=Promise.resolve();
 // One request at a time: the sidecar refuses a seq at or below the last one it saw, so overlapping posts (approvals
 // during a poll loop, as tools/native/mock.mjs runs) must not overtake each other.
 const post=async body=>{const raw=JSON.stringify({...body,boot,seq:++seq,ts:Date.now()});return (await fetch(sidecarUrl+'/plugin',{method:'POST',headers:{'content-type':'application/json','x-rlb-mac':signPluginBody(pluginKey,raw)},body:raw})).json();};
 const plugin=body=>{const r=last.then(()=>post(body));last=r.catch(()=>{});return r;};
 const approvals=[];
 const native=await startMockUlinkServer({world:{level:'rust_island_2013',sendRate:10,hostname:'Pilot',modded:true,official:false,steamId:1n,ip:1,port:28015},approve:async(login,peer)=>{
  peer.cid=peer.cid??randomBytes(16).toString('hex');
  const r=await plugin({type:'approval',connectionId:peer.cid,claimedUserId:login.userId.toString(),authBytes:Buffer.from(login.ticket).toString('base64')});
  approvals.push({userId:login.userId,result:r});peer.userId=login.userId.toString();
  return r.approved?{approve:true}:{deny:154};
 }});
 const gateway=await startGateway({serverId:created.id,centralUrl,credential,sidecarUrl,controlKeyHex:controlKey.toString('hex'),native:{host:'127.0.0.1',port:native.port},allowedOrigins:[ORIGIN,...gatewayOrigins],listen:{host:'127.0.0.1',port:0},linkPollMs:50,reportMs:50,metricsToken:METRICS_TOKEN,
  // Every page here connects from 127.0.0.1 (mock soak bots included): the per-address limits are tested on their own.
  limits:{perIp:256,admitsPerMinute:10000},...gatewayConfig},{schema,ngcRegistry,sceneDoors,anticheat:{limits:{resetGrace:0.1},weapons:STACK_WEAPONS,...anticheat}});
 await call('POST',`/owner/servers/${created.id}/publish`,{cookie:owner.cookie,csrf:owner.csrf,data:{listed:true}});
 class OriginWebSocket extends WebSocket{constructor(url,protocols){super(url,protocols,{origin:ORIGIN});}}
 const clients=[];
 const browser=()=>{const c=new GatewayClient({url:`ws://127.0.0.1:${gateway.port}/play`,WebSocketImpl:OriginWebSocket});clients.push(c);return c;};
 return {serverId:created.id,centralUrl,owner,call,login,plugin,adapter,native,gateway,approvals,browser,
  close:async()=>{for(const c of clients)c.close();await gateway.close();await native.close();for(const s of [sidecarHttp,centralHttp])await new Promise(r=>s.close(r));}};
}
