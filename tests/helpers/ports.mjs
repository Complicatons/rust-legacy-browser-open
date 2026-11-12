// Free ports for child processes that need a port number in their config before they start (the host app stack).
// Fixed numbers are not safe here: this machine hands out ephemeral ports from 1024 up, one after another and
// system-wide, so sooner or later a concurrent test's client socket sits on any fixed port. A port the OS just gave
// us and we released is not handed out again until that counter wraps round, so the child can take it.
import {createServer} from 'node:net';
import {createSocket} from 'node:dgram';
import {listenServer} from '../../bridge/listen.mjs';

// n distinct TCP ports on 127.0.0.1 (held together while picking, so they differ), none that fetch refuses.
export async function freeTcpPorts(n){
 const held=[];
 try{for(let i=0;i<n;i++)held.push(await listenServer(createServer()));return held.map(s=>s.address().port);}
 finally{await Promise.all(held.map(s=>new Promise(r=>s.close(()=>r()))));}
}

export const freeUdpPort=()=>new Promise(r=>{const s=createSocket('udp4');s.bind(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
