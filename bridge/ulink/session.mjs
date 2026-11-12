// Lidgren gen2 connection state machine (client or server role) and a uLink client on top of it.
// Transport-agnostic: callers supply send(bytes) and feed received datagrams; tick(now) drives timers.
// Follows ULINK-PROTOCOL.md; checked against the original server on 2026-10-21 (join, approval, spawn).
import {randomBytes,randomInt} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {KIND,SYSTEM,APP_IDENTIFIER,DEFAULTS,CLIENT_DEFAULTS,decodeDatagram,encodeMessage,encodeSystem,parseSystem,connectBody,responseBody,readResponse,reasonBody,pingBody,pongBody,encodeAcks,parseAcks,splitPayload,Reassembler,ChannelReceiver,nextSeq,isReliable,resendDelay} from './lidgren.mjs';
import {INTERNAL,INTERNAL_CHANNEL,decodeHeader,encodeInternal,clientConnectRequest,readClientConnectResponse,readConnectDenied,readWorldInfo,clockOffset,serverTimeMs} from './ulink.mjs';
import {encodeRpc,writeArgs} from './rust.mjs';

const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);

export class LidgrenConnection extends EventEmitter{
 constructor({role,send,now,config={}}){
  super();Object.assign(this,{role,sendRaw:send,now});
  this.config={...DEFAULTS,...config};
  this.state='idle';this.signature=new Uint8Array(randomBytes(16));this.nonce=randomInt(0,65534);
  // O104: nonce = Random(0, 65534); every channel's send sequence starts at the local nonce (O2111) and every expected
  // receive sequence at the remote nonce (O2110). A peer that starts at 0 has its first reliable message acked and dropped.
  this.sendSeq=new Array(32).fill(this.nonce);this.pending=Array.from({length:16},()=>[]);
  this.receiver=new ChannelReceiver();this.reassembler=new Reassembler();this.ackQueue=[];this.fragmentGroup=1;
  this.avgRtt=0.1;this.lastPong=now();this.nextPing=now()+this.config.timeBetweenPings;
 }
 // Client: start the handshake (O109.O415). hail = UTF-8 password bytes; Rust uses none.
 connect(hail=new Uint8Array(0)){
  this.state='connecting';this.hail=hail;this.attempts=0;this.sendConnect();
 }
 sendConnect(){this.attempts++;this.nextHandshake=this.now()+this.config.handshakeRetryDelay;this.sendRaw(encodeSystem(SYSTEM.Connect,connectBody({appId:APP_IDENTIFIER,signature:this.signature,nonce:this.nonce,hail:this.hail})));}
 // Server: accept a Connect already validated by the caller (O391 unconnected handler).
 accept(connect){
  Object.assign(this,{remoteSignature:connect.signature,remoteNonce:connect.nonce,remoteHail:connect.hail,state:'connecting',attempts:1});
  this.receiver=new ChannelReceiver(connect.nonce);
  this.sendResponse();
 }
 sendResponse(){this.nextHandshake=this.now()+this.config.handshakeRetryDelay;this.sendRaw(encodeSystem(SYSTEM.ConnectResponse,responseBody({signature:this.signature,nonce:this.nonce,peerSignature:this.remoteSignature,peerNonce:this.remoteNonce})));}
 // The handshake counts as the first pong (initial RTT sample), so the dead-peer clock starts here.
 setConnected(){if(this.state==='connected')return;this.state='connected';this.lastPong=this.now();this.emit('connected');}
 close(reason,{notify=true}={}){
  if(this.state==='closed')return;
  if(notify&&this.state!=='idle')this.sendRaw(encodeSystem(SYSTEM.Disconnect,reasonBody(reason)));
  this.state='closed';this.emit('closed',reason);
 }
 receive(datagram){
  if(this.state==='closed')return;
  for(const m of decodeDatagram(datagram)){
   if(this.state==='closed')return; // a handler may close the connection mid-datagram
   try{this.handle(m);}catch(error){this.emit('protocol-error',error);}
  }
  this.flushAcks();
 }
 handle(m){
  if(m.kind===KIND.System)return this.handleSystem(parseSystem(m.payload));
  if(m.kind===KIND.Acknowledge)return this.handleAcks(parseAcks(m.payload));
  if(m.kind!==KIND.User&&m.kind!==KIND.UserFragmented)return;
  if(this.role==='server'&&this.state==='connecting')this.setConnected(); // O989: first user message completes the handshake
  if(this.state!=='connected')return;
  const {deliver,ack}=this.receiver.push(m);
  if(ack)this.ackQueue.push(ack);
  for(const d of deliver){
   const payload=d.kind===KIND.UserFragmented?this.reassembler.add(d.payload):d.payload;
   if(payload)this.emit('message',payload,d.channel);
  }
 }
 handleSystem({type,body}){
  switch(type){
   case SYSTEM.ConnectResponse:{
    if(this.role!=='client'||(this.state!=='connecting'&&this.state!=='connected'))return;
    const r=readResponse(body);
    if(!same(r.peerSignature,this.signature)||r.peerNonce!==this.nonce)return this.close('Not the same connection');
    if(this.remoteSignature&&(!same(r.signature,this.remoteSignature)||r.nonce!==this.remoteNonce))return this.close('Not the same connection');
    if(!this.remoteSignature)this.receiver=new ChannelReceiver(r.nonce);
    this.remoteSignature=r.signature;this.remoteNonce=r.nonce;
    this.sendRaw(encodeSystem(SYSTEM.ConnectionEstablished,responseBody({signature:this.signature,nonce:this.nonce,peerSignature:r.signature,peerNonce:r.nonce})));
    this.rtt(this.now()-(this.nextHandshake-this.config.handshakeRetryDelay));
    return this.setConnected();
   }
   case SYSTEM.ConnectionEstablished:{
    if(this.role!=='server'||this.state!=='connecting')return;
    const r=readResponse(body);
    if(!same(r.signature,this.remoteSignature)||r.nonce!==this.remoteNonce||!same(r.peerSignature,this.signature)||r.peerNonce!==this.nonce)return this.close('Not the same connection');
    return this.setConnected();
   }
   case SYSTEM.ConnectionRejected:return this.close('Rejected: '+body.string(),{notify:false});
   case SYSTEM.Disconnect:return this.close(body.remainingBytes?body.string():'Disconnected',{notify:false});
   case SYSTEM.Ping:{const echo=body.remainingBytes>=8?body.u64():0n;return this.sendRaw(encodeSystem(SYSTEM.Pong,pongBody(echo,this.ms())));}
   case SYSTEM.Pong:{this.lastPong=this.now();if(body.remainingBytes>=8){const echo=body.u64();this.rtt(this.now()-Number(echo)/1000);}return;}
  }
 }
 ms(){return BigInt(Math.floor(this.now()*1000));}
 rtt(sample){if(sample>=0&&Number.isFinite(sample))this.avgRtt=this.avgRtt*0.7+sample*0.3;}
 handleAcks(acks){
  for(const {channel,seq} of acks){
   const list=this.pending[channel-16],i=list.findIndex(p=>p.seq===seq);
   if(i<0)continue;
   list.splice(i,1);
   for(const earlier of list.slice(0,i))if(earlier.seq<seq)this.transmit(earlier); // O986 fast retransmit
  }
 }
 // Queue a uLink payload on a channel (O109.O1110): fragments over the MTU, reliable channels are resent until acked.
 send(payload,channel=INTERNAL_CHANNEL){
  if(this.state!=='connected')throw new Error('Status must be Connected to send messages');
  const parts=channel===0?[{kind:KIND.User,payload}]:splitPayload(payload,{mtu:this.config.mtu,groupId:this.fragmentGroup});
  if(parts.length>1)this.fragmentGroup=(this.fragmentGroup+1)&0xffff||1;
  for(const part of parts){
   const msg={...part,channel,seq:this.sendSeq[channel],resends:0};
   this.sendSeq[channel]=nextSeq(this.sendSeq[channel]);
   if(isReliable(channel))this.pending[channel-16].push(msg);
   this.transmit(msg,true);
  }
 }
 transmit(msg,first=false){
  if(this.state==='closed')return;
  if(!first)msg.resends++;
  msg.due=this.now()+resendDelay(msg.resends,this.avgRtt);
  this.sendRaw(encodeMessage(msg).toBytes());
 }
 flushAcks(){if(this.state==='closed'||!this.ackQueue.length)return;for(const d of encodeAcks(this.ackQueue.splice(0),this.config.mtu))this.sendRaw(d);}
 tick(){
  const t=this.now();
  if(this.state==='connecting'&&t>=this.nextHandshake){
   if(this.attempts>=this.config.handshakeRetries)return this.close('No answer from remote host',{notify:false});
   if(this.role==='client')this.sendConnect();else{this.attempts++;this.sendResponse();}
  }
  if(this.state!=='connected')return;
  // Lidgren checks for a dead peer when the next ping is due: no Pong within timeoutDelay closes the connection (and
  // tells the peer), whatever else still arrives.
  if(t>=this.nextPing){
   if(t-this.lastPong>this.config.timeoutDelay)return this.close(`Connection timed out; no pong for ${t-this.lastPong} seconds`);
   this.nextPing=t+this.config.timeBetweenPings;this.sendRaw(encodeSystem(SYSTEM.Ping,pingBody(this.ms())));
  }
  for(const list of this.pending)for(const msg of list)if(t>=msg.due)this.transmit(msg);
  this.flushAcks();
 }
}

// A uLink client connection that ends before ClientConnectResponse raises uLink_OnFailedToConnect: a Lidgren rejection
// maps by its reason string, anything else (no answer to the handshake, timed out, disconnected) is ConnectionFailed.
export const REJECTED_ERRORS={'Server full':17,'Invalid password':22,'Connection banned':21,'Special server':71,'App id bad':64};
export const failedToConnectError=reason=>{const m=/^Rejected: (.*)$/s.exec(reason??'');return (m&&REJECTED_ERRORS[m[1]])||14;};

// uLink client: after the Lidgren handshake sends the Rust login (ClientConnectRequest), reports the approval,
// keeps the server clock offset (O1947.O2168, ResyncClock) and sends RPCs.
export class UlinkClient extends EventEmitter{
 constructor({send,now,login,config}){
  super();this.login=login;this.now=now;this.offset=0n;
  this.connection=new LidgrenConnection({role:'client',send,now,config:{...CLIENT_DEFAULTS,...config}});
  this.connection.on('connected',()=>{this.requestSentMs=this.localMs();this.connection.send(clientConnectRequest(login));});
  this.connection.on('closed',reason=>this.emit('closed',reason));
  this.connection.on('message',payload=>this.onMessage(payload));
 }
 start(){this.connection.connect();}
 receive(d){this.connection.receive(d);}
 tick(){this.connection.tick();this.tickResync();}
 close(reason='Disconnected'){this.connection.close(reason);}
 localMs(){return BigInt(Math.floor(this.now()*1000));}
 serverMs(){return serverTimeMs(this.localMs(),this.offset);}
 onMessage(payload){
  const {header,body}=decodeHeader(payload);
  // BufferedRPCs (O2898.O598): the server's buffered Instantiates and RPCs for a newly connected player (scene objects
  // such as ServerManagement included), as varuint count + count × (varuint byte length + a complete uLink message).
  if(header.viewId===undefined&&header.internal===INTERNAL.BufferedRPCs){
   // Each inner message is length-prefixed and independent: one that fails to decode must not drop the rest.
   for(let n=body.varuint();n>0;n--){const inner=body.raw(body.varuint());try{this.onMessage(inner);}catch(error){this.connection.emit('protocol-error',error);}}
   return;
  }
  if(header.viewId===undefined&&header.internal===INTERNAL.ClientConnectResponse){
   const r=readClientConnectResponse(body);this.playerId=r.playerId;
   this.offset=clockOffset(this.requestSentMs,r.requestReceivedMs,r.serverNowMs,this.localMs()).offset;
   return this.emit('approved',{...r,worldInfo:readWorldInfo(r.approvalData)});
  }
  if(header.viewId===undefined&&header.internal===INTERNAL.ConnectDenied)return this.emit('denied',readConnectDenied(body).error);
  if(header.viewId===undefined&&header.internal===INTERNAL.ResyncClockResponse){
   const t0=body.u64(),t1=body.u64(),t2=body.u64(),sample=clockOffset(t0,t1,t2,this.localMs());
   if(this.resync&&sample.transit<=this.resync.best.transit)this.resync.best=sample;
   return;
  }
  this.emit('ulink',header,body);
 }
 // NetCull.ResynchronizeClock(duration): request every 50 ms, keep the lowest-transit sample, apply at the end.
 resyncClock(durationSeconds){
  if(this.resync)return;
  this.resync={until:this.now()+durationSeconds,next:0,best:{transit:2n**64n-1n,offset:this.offset}};
 }
 tickResync(){
  const r=this.resync;if(!r||this.connection.state!=='connected')return;
  const t=this.now();
  if(t>=r.until){this.offset=r.best.offset;this.resync=null;this.emit('clock',this.offset);return;}
  if(t>=r.next){r.next=t+0.05;const t0=this.localMs();this.connection.send(encodeInternal(INTERNAL.ResyncClockRequest,{},w=>w.u64(t0)),0);}
 }
 // RPC by name on a view, untyped arguments, reliable channel 17, 16-bit server timestamp by default (`timestamp`: true =
 // now, a BigInt = that server ms, false = none).
 sendRpc({viewId,name,types=[],args=[],timestamp=true,target='server'}){
  const timestampMs=typeof timestamp==='bigint'?timestamp:timestamp?this.serverMs():undefined;
  this.connection.send(encodeRpc({viewId,name,target,timestampMs},w=>writeArgs(types,args,w)));
 }
}
