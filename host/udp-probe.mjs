// Asks a uLink server's socket for a sign of life without creating a connection (HOST-APP-PLAN.md "Watchdog").
// A Lidgren Connect with a foreign app id is answered by the server's unconnected handler (O391) with
// ConnectionRejected("Bad app id") and leaves no pending connection (ULINK-PROTOCOL.md). uLink reads its socket on the
// Unity main thread, so a frozen main thread stops answering.
import {createSocket} from 'node:dgram';
import {randomBytes,randomInt} from 'node:crypto';
import {encodeSystem,connectBody,decodeDatagram,parseSystem,KIND,SYSTEM} from '../bridge/ulink/lidgren.mjs';

export const PROBE_APP_ID='rlb-host-probe';

export function probeUlink({host='127.0.0.1',port,timeoutMs=2000}={}){
 return new Promise(resolve=>{
  const socket=createSocket('udp4'),t0=performance.now();let done=false;
  const finish=r=>{if(done)return;done=true;clearTimeout(timer);try{socket.close();}catch{}resolve({...r,ms:Math.round(performance.now()-t0)});};
  const timer=setTimeout(()=>finish({ok:false,reason:'no-reply'}),timeoutMs);
  // Windows reports an ICMP port-unreachable as an error on the socket: nothing is bound to that port.
  socket.on('error',e=>finish({ok:false,reason:e.code==='ECONNRESET'||e.code==='ECONNREFUSED'?'port-closed':e.code??e.message}));
  socket.on('message',msg=>{
   let reason='reply';
   try{const m=decodeDatagram(new Uint8Array(msg)).find(x=>x.kind===KIND.System);if(m){const {type,body}=parseSystem(m.payload);if(type===SYSTEM.ConnectionRejected)reason=body.string();}}catch{}
   finish({ok:true,reason});
  });
  const datagram=encodeSystem(SYSTEM.Connect,connectBody({appId:PROBE_APP_ID,signature:randomBytes(16),nonce:randomInt(-(2**31),2**31-1)}));
  // Bind first: an unbound send fails with EADDRNOTAVAIL on Windows.
  socket.bind(0,host==='127.0.0.1'||host==='localhost'?'127.0.0.1':undefined,()=>socket.send(datagram,port,host,e=>{if(e)finish({ok:false,reason:e.code??e.message});}));
 });
}
