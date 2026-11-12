// Probes the native server's UDP endpoint the way the gateway does, printing every datagram both ways.
//   node tools/ulink-probe.mjs [host=127.0.0.1] [port=29015] [seconds=12] [envelope]
// 1) raw Lidgren Discovery and Connect, 2) a full UlinkClient login with a dummy ticket. A plain dummy ticket takes the
// native Steam path (never answered offline); "envelope" sends a bogus "RLBA" browser envelope instead, which the
// patched server must hand to the sidecar and then deny. Run it on the server's own machine; sends nothing else.
import {createSocket} from 'node:dgram';
import {SYSTEM,APP_IDENTIFIER,encodeSystem,decodeDatagram,connectBody} from '../bridge/ulink/lidgren.mjs';
import {UlinkClient} from '../bridge/ulink/session.mjs';
import {randomBytes} from 'node:crypto';

const [host='127.0.0.1',port='29015',seconds='12',mode]=process.argv.slice(2);
const ticket=mode==='envelope'?new Uint8Array([...Buffer.from('RLBA'),...randomBytes(60)]):new Uint8Array(16);
const bindHost=/^(127\.|localhost$)/.test(host)?'127.0.0.1':'0.0.0.0'; // as bridge/gateway-service.mjs
const hex=b=>Buffer.from(b).toString('hex').replace(/(..)/g,'$1 ').trim();
const sysName=Object.fromEntries(Object.entries(SYSTEM).map(([k,v])=>[v,k]));
const describe=b=>{try{return decodeDatagram(new Uint8Array(b)).map(m=>m.kind===7?`System.${sysName[m.payload[0]]??m.payload[0]}(${m.payload.length}B)`:`kind${m.kind}/ch${m.channel}/seq${m.seq}(${m.payload.length}B)`).join(' + ')||'(no messages)';}catch(e){return 'undecodable: '+e.message;}};
const t0=performance.now(),stamp=()=>((performance.now()-t0)/1000).toFixed(2).padStart(6)+'s';

function socket(label){
 const s=createSocket('udp4');
 s.on('message',(m,r)=>console.log(stamp(),label,'<-',`${r.address}:${r.port}`,m.length+'B',describe(m),'\n        ',hex(m.subarray(0,96))));
 s.on('error',e=>console.log(stamp(),label,'socket error',e.code??e.message));
 return s;
}
const send=(s,label,bytes)=>{console.log(stamp(),label,'->',`${host}:${port}`,bytes.length+'B',describe(bytes),'\n        ',hex(bytes.subarray(0,96)));s.send(bytes,Number(port),host);};

console.log(`uLink probe → ${host}:${port}, app identifier "${APP_IDENTIFIER}", ${mode==='envelope'?'RLBA envelope':'plain'} ticket`);
const raw=socket('raw');
raw.bind(0,bindHost,()=>{
 send(raw,'raw',encodeSystem(SYSTEM.Discovery,Buffer.from(APP_IDENTIFIER)));
 setTimeout(()=>send(raw,'raw',encodeSystem(SYSTEM.Connect,connectBody({signature:new Uint8Array(randomBytes(16)),nonce:12345,hail:new Uint8Array(0)}))),500);
});

setTimeout(()=>{
 const s=socket('client'),now=()=>performance.now()/1000;
 const client=new UlinkClient({now,login:{userId:76561197960265728n,name:'probe',ticket},send:b=>{console.log(stamp(),'client ->',b.length+'B',describe(b));s.send(b,Number(port),host);}});
 s.removeAllListeners('message');
 s.on('message',(m,r)=>{console.log(stamp(),'client <-',`${r.address}:${r.port}`,m.length+'B',describe(m),'\n        ',hex(m));client.receive(new Uint8Array(m));});
 client.connection.on('connected',()=>console.log(stamp(),'client: Lidgren connected, sending uLink login'));
 client.on('approved',a=>console.log(stamp(),'client: APPROVED',a.playerId,a.worldInfo));
 client.on('denied',e=>console.log(stamp(),'client: DENIED by server',e));
 client.on('closed',r=>console.log(stamp(),'client: closed —',r));
 const tick=setInterval(()=>client.tick(),10);
 s.bind(0,bindHost,()=>s.connect(Number(port),host,()=>client.start()));
 setTimeout(()=>{clearInterval(tick);console.log(stamp(),'client state:',client.connection.state);raw.close();s.close();},Number(seconds)*1000);
},3000);
