// The server's clock on the page clock (seconds, performance.now() / 1000).
// The original places every interpolator goal and timed event at the sender's synchronised stamp: HumanController.
// ReadClientMove -> UpdateStateNew(..., info.timestamp), InterpTimedEvent.Queue(..., ref info), and samples at
// Interpolation.time (CharacterStateInterpolator.Syncronize), all on uLink's synchronised NetCull clock. The page only
// sees the bridge's server clock at the moment an RPC reached the gateway (`serverMs`, bridge/game-bridge.mjs onRpc)
// and its own clock when it processes the message, which also carries the gateway -> browser latency, its jitter,
// WebSocket batching and main-thread hitches. Placing each message at receivedAt - (serverMs - timestampMs) gives a
// batch near-equal times (snapping, walk-speed pulsing, sprint flicker). Instead one offset for every message: the
// smallest receivedAt - serverMs of the last `window` seconds (the latency floor: no message arrives faster).
// For the first `warmup` seconds the offset is that floor itself (the join burst refines it quickly); afterwards it
// moves toward the floor by at most `slew` seconds per second (a 5 % rate change at most, so the window's floor
// changes never show as speed changes), except that a change past `snap` seconds (a gateway clock resync, a lasting
// latency change) is taken at once.
export class ServerClock{
 constructor({window=5,slew=0.05,snap=0.5,warmup=2}={}){Object.assign(this,{window,slew,snap,warmup});this.reset();}
 // One message: the bridge's server clock at its arrival (ms) and the page clock when the page processes it (s).
 observe(serverMs,receivedAt){serverMs=Number(serverMs);if(!Number.isFinite(serverMs)||!Number.isFinite(receivedAt))return;const x=receivedAt-serverMs/1000,s=this.samples;
  // Monotonic deque: increasing arrival and offset, so the front is the window's minimum.
  while(s.length&&s[s.length-1].x>=x)s.pop();s.push({t:receivedAt,x});while(s[0].t<receivedAt-this.window)s.shift();
  const target=s[0].x;this.first??=receivedAt;
  if(this.offset==null||receivedAt-this.first<this.warmup||Math.abs(target-this.offset)>this.snap)this.offset=target;
  else{const step=this.slew*Math.max(0,receivedAt-this.last);this.offset+=Math.max(-step,Math.min(step,target-this.offset));}
  this.last=receivedAt;}
 get ready(){return this.offset!=null;}
 // A server timestamp (ms) on the page clock.
 time(timestampMs){return Number(timestampMs)/1000+this.offset;}
 reset(){this.samples=[];this.offset=null;this.last=null;this.first=null;}
 debug(){return {offset:this.offset,floor:this.samples[0]?.x??null,samples:this.samples.length};}
}
