// Mock gateway stack for the edge-case tests (tests/gateway-hardening.test.mjs): account service, identity adapter,
// mock uLink server whose approval calls the adapter, and one gateway service with caller options.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createAccountService,createSigningKey} from '../../bridge/admission.mjs';
import {createIdentityAdapter,createIdentityMap,createControlSender} from '../../bridge/adapter.mjs';
import {createGatewayAdmission} from '../../bridge/gateway.mjs';
import {createGatewayService,BROWSER_PROTOCOL} from '../../bridge/gateway-service.mjs';
import {startMockUlinkServer} from '../../bridge/ulink/mock-server.mjs';
import {listenServer} from '../../bridge/listen.mjs';

export const SERVER='3f6c1b1e-0000-4000-8000-000000000001',ORIGIN='https://play.example.test';
export const world={level:'rust_island_2013',sendRate:5,hostname:'Mock Legacy',modded:true,official:false,steamId:1n,ip:0x7f000001,port:28015};
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const until=async(f,ms=5000)=>{const t=Date.now();while(!f()){if(Date.now()-t>ms)throw Error('timed out');await sleep(10);}};

// wrapAdmission: admission → the admission the gateway uses (e.g. one that never answers).
export async function gatewayStack({gateway:options={},log,wrapAdmission=a=>a}={}){
 const controlKey=randomBytes(32),account=createAccountService({issuer:'https://accounts.example.test',keys:[createSigningKey('k1')]});
 const adapter=createIdentityAdapter({serverId:SERVER,controlKey,identities:createIdentityMap({namespace:{base:'90000000000000000',size:'1000000'}})});
 const sender=createControlSender(controlKey),control=b=>adapter.handleControl(sender(b));
 const admission=createGatewayAdmission({serverId:SERVER,account,sendControl:control,replaceTries:2,replaceDelayMs:20});
 const native=await startMockUlinkServer({world,onDisconnect:peer=>adapter.onDisconnect(peer.key),approve:(login,peer)=>{
  const r=adapter.onNativeApproval({authBytes:Buffer.from(login.ticket),claimedUserId:login.userId.toString(),connection:peer.key});
  return r.path==='browser'&&r.approved?{approve:true}:{deny:154};
 }});
 const schema=JSON.parse(await readFile(new URL('../../bridge/ulink/rpc-schema.json',import.meta.url)));
 const gateway=createGatewayService({admission:wrapAdmission(admission),native:{host:'127.0.0.1',port:native.port},allowedOrigins:[ORIGIN],schema,log,...options});
 const http=createServer();gateway.attach(http);await listenServer(http);
 const url=`ws://127.0.0.1:${http.address().port}/play`;
 const open=(headers={},wsOptions={})=>new WebSocket(url,[BROWSER_PROTOCOL],{origin:ORIGIN,headers,...wsOptions});
 // Joins one account: {ws, approved, peer, inbox} (inbox collects every later message).
 const join=async(subject,{headers,wsOptions}={})=>{
  const ws=open(headers,wsOptions);await once(ws,'open');const inbox=[];
  const first=new Promise(r=>ws.once('message',m=>r(JSON.parse(String(m)))));
  ws.send(JSON.stringify({type:'admit',ticket:account.issueAdmission({subject,serverId:SERVER})}));
  const approved=await first;ws.on('message',m=>inbox.push(JSON.parse(String(m))));
  const peer=[...native.peers.values()].find(p=>p.playerId===approved.playerId);
  return {ws,approved,peer,inbox};
 };
 return {account,adapter,control,native,gateway,open,join,url,close:async()=>{gateway.close();await native.close();http.closeAllConnections?.();await new Promise(r=>http.close(r));}};
}

