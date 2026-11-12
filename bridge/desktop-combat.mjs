// Desktop combat checks on the sidecar (ANTICHEAT-ADMIN-PLAN.md slice 8). Desktop (native client) players never pass the
// gateway, so the vanilla adapter reports what the server itself saw (adapter/vanilla/RustLegacyBrowserVanilla.Evidence.cs):
// the arrival time of every weapon action (Bullet/Shotgun/Melee/BowWeaponDataBlock.DoAction1) and every bullet hit the
// server is about to damage a player, sleeper or animal for (BulletWeaponDataBlock.ApplyDamage), with the shooter's server
// eye position, the target's server position, the weapon's own GetBulletRange and the server's own line of sight
// (Physics.RaycastAll on the bullet mask; triggers and characters ignored). These rules flag a desktop player's
// PlayerWatch (bridge/anticheat.mjs) so the scores, evidence and replay are the same as for browser players. Flags only.
// Tested against unit tests only, never against the original server.

// Facepunch.HitBox BodyPart: Neck 8, Head 9, Scalp 10, Nostrils 11, Jaw 12, Tongue 13-14, Brain 16, Eyes 20-21.
const HEAD_PARTS=new Set([8,9,10,11,12,13,14,16,20,21]);
export const DESKTOP_COMBAT=Object.freeze({
 fireTolerance:1.15, // refill headroom, as the gateway
 fireBurst:3,        // one more than the gateway: UDP arrivals bunch more than one WebSocket stream
 rangeTolerance:1.1, rangeSlack:5, // GetBulletRange × 1.1 + 5 m, as the gateway
 headshotMinHits:15, headshotRatio:0.65,
 inventoryPerSecond:10, inventoryBurst:20, // the gateway's inventory bucket (ITMV/ITMG/ITSM/ISMV/ITSP)
});
const isVec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const round=v=>Math.round(v*100)/100;

export class DesktopCombat{
 constructor(limits={}){this.limits={...DESKTOP_COMBAT,...limits};this.buckets=new Map();this.hits={players:0,head:0};}
 // shots: [{uid, name, rate, t:[arrival ms since server start]}] for this player in one poll.
 shots(watch,list){
  const L=this.limits;
  for(const s of list){
   const rate=Number(s?.rate),times=Array.isArray(s?.t)?s.t.filter(Number.isFinite).sort((a,b)=>a-b):[];
   if(!(rate>0)||!times.length||!Number.isInteger(s.uid))continue;
   let b=this.buckets.get(s.uid);if(!b)this.buckets.set(s.uid,b={tokens:L.fireBurst,t:times[0]});
   let excess=0,fastest=Infinity,last=null;
   for(const t of times){
    if(t<b.t)continue; // a restart of the server clock or a repeat: never scored
    b.tokens=Math.min(L.fireBurst,b.tokens+(t-b.t)/1000/rate*L.fireTolerance);b.t=t;
    if(last!==null)fastest=Math.min(fastest,t-last);last=t;
    if(b.tokens<1){excess++;continue;}
    b.tokens-=1;
   }
   watch.record({kind:'fire',weapon:String(s.name??s.uid).slice(0,40),shots:times.length});
   if(excess)watch.flag('fire-rate',{weapon:String(s.name??s.uid).slice(0,40),minInterval:rate,shots:times.length,excess,...(Number.isFinite(fastest)?{fastestGap:round(fastest/1000)}:{}),source:'server'});
  }
 }
 // hits: [{uid, name, range, kind: player|sleeper|animal, target?, part, eye, at, end, clear, blockedBy?, layer?, blockedAt?}].
 hit(watch,h,{targetName=null}={}){
  const L=this.limits;if(!isVec(h?.eye)||!isVec(h?.at))return;
  const weapon=String(h.name??h.uid??'unknown').slice(0,40),kind=['player','sleeper','animal'].includes(h.kind)?h.kind:'entity',d=dist(h.eye,h.at);
  const target=targetName??(kind==='animal'?'animal':kind);
  watch.record({kind:'hit',weapon,targetKind:kind,distance:round(d),bodyPart:h.part,clear:h.clear!==false});
  if(Number(h.range)>0&&d>Number(h.range)*L.rangeTolerance+L.rangeSlack)watch.flag('hit-range',{weapon,distance:round(d),range:round(Number(h.range)),target,targetKind:kind,source:'server'});
  if(h.clear===false)watch.flag('wall-shot',{weapon,attack:'bullet',target,targetKind:kind,distance:round(d),blockedBy:String(h.blockedBy??'').slice(0,64)||'world',...(Number.isInteger(h.layer)?{layer:h.layer}:{}),...(isVec(h.blockedAt)?{at:h.blockedAt.map(round)}:{}),source:'server'});
  if(kind==='player'){
   this.hits.players++;if(HEAD_PARTS.has(h.part))this.hits.head++;
   if(this.hits.players>=L.headshotMinHits&&this.hits.head/this.hits.players>L.headshotRatio)watch.flag('headshot-ratio',{hits:this.hits.players,head:this.hits.head,ratio:round(this.hits.head/this.hits.players),source:'server'});
  }
 }
 // Inventory slot operations (moves, merges, splits) the server handled for this player in `seconds`.
 inventory(watch,ops,seconds){
  const L=this.limits,allowed=L.inventoryPerSecond*Math.max(0,seconds)+L.inventoryBurst;
  if(Number.isInteger(ops)&&ops>allowed)watch.flag('command-rate',{command:'inventory',ops,seconds:round(seconds),allowed:Math.floor(allowed),source:'server'});
 }
}
