// Replays browser players' moves through the original server's TruthDetector (tools/truth-detector.mjs) against the
// gateway's copy of the server collision world (bridge/line-of-sight.mjs: scene, trees, rocks, heightmap; the NGC
// structures and deployables of a live server are not in it). Needs browser/assets/recovered.
//   node tools/replay-truth-trace.mjs analysis/native-runs/<run>/moves.json   (check-native: both players' move streams)
//   node tools/replay-truth-trace.mjs analysis/native-runs/<run>-soak/soak.json (soak: the moves sent before each correction)
// moves.json: per player, every sent move with its stamp, spawns (NoteTeleported), server corrections and the
// disconnect. The replay prints each violation the model adds (speed over 20 m/s between stamps, blocked traces with
// what they hit), the peak, and whether and when it kicks (> 400), next to the corrections the real server sent.
// A real-server correction the replay does not reproduce means the server had something on that line which the
// recovered world lacks (a structure, deployable or resource node of the live server, or a gap in the export).
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {loadLineOfSight,TRUTH_MASK} from '../bridge/line-of-sight.mjs';
import {TruthDetector,losTrace} from './truth-detector.mjs';

export function replayStream(moves,trace){
 const td=new TruthDetector({trace});let started=false,serverCorrections=0,end=null,predicted=0;
 for(const m of moves){
  if(m.spawn){if(m.origin)td.noteTeleported(m.origin);started=true;continue;}
  if(m.correction){serverCorrections++;continue;}
  if(m.end){end=m;continue;}
  if(!started){td.noteTeleported(m.origin);started=true;}
  const r=td.noteMoved(m.origin,(m.at??m.t)/1000);if(r.action==='moved')predicted++;if(r.action==='kicked')break;
 }
 return {moves:moves.filter(m=>m.origin&&!m.spawn&&!m.correction).length,serverCorrections,predictedCorrections:predicted,peak:td.peak,violation:td.violation,kicked:td.kicked,end,events:td.events};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [file]=process.argv.slice(2),run=JSON.parse(readFileSync(file,'utf8'));
 const los=await loadLineOfSight('browser/assets/recovered'),trace=losTrace(los,TRUTH_MASK);
 if(Array.isArray(run.events)){
  // soak.json: the (up to 3) moves sent before each correction.
  let n=0;const byWhat={};
  for(const e of run.events.filter(e=>e.kind==='correction'&&e.sent?.length>=2)){
   const hits=[];for(let i=1;i<e.sent.length;i++){const h=trace(e.sent[i-1],e.sent[i]);if(h)hits.push(h);}
   n++;for(const h of hits)byWhat[h.what]=(byWhat[h.what]??0)+1;
   console.log(`bot ${e.bot} t ${(e.t/1000).toFixed(1)}s server ${JSON.stringify(e.origin)} sent ${JSON.stringify(e.sent.at(-1))} blocked: ${hits.length?JSON.stringify(hits):'-'}`);
  }
  console.log('corrections',n,'blocked segments by body',byWhat);
  for(const e of run.events.filter(e=>e.kind==='disconnected'))console.log('disconnect',e.bot,(e.t/1000).toFixed(1)+'s',e.reason,JSON.stringify(e.origin));
 }else for(const [who,p] of Object.entries(run)){
  const r=replayStream(p.moves,trace);
  console.log(`${who} (${p.name??'?'}): ${r.moves} moves, server corrections ${r.serverCorrections}, replay corrections ${r.predictedCorrections}, peak ${r.peak}, ${r.kicked?`kicked at ${r.kicked.violation}`:'no kick'}${r.end?`, ended ${r.end.end} ${r.end.reason??''}`:''}`);
  for(const e of r.events)console.log(`  ${new Date(e.time*1000).toISOString()} +${e.add} -> ${e.violation}${e.speed?` speed ${e.speed.toFixed(1)} m/s over ${(e.dt*1000).toFixed(0)} ms`:''}${e.blocked?` blocked by ${e.blocked.what} at ${e.blocked.distance} m`:''}${e.kick?' KICK':''}`);
 }
}
