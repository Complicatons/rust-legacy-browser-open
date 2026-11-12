// Keeps a harness walker clear of the original server's TruthDetector kick (tools/truth-detector.mjs). Every server
// correction of our own character (ReadClientMove to the owner after GetClientMove) is one move whose trace hit
// something the server has (+100), and the walker that keeps pressing the same line gets one per move in flight: the
// run-two kick ("kicked for violation 592" = six blocked traces, 600, less eight accepted moves). The count only drops
// by one per accepted move (the send rate, 5 per second). So after a correction the walker steps aside before going
// on, and above `pauseAbove` it stands still (moves keep being accepted) for a while.
// The pause is time-based and bounded, so the guard can never hold a walker for good: it waits until the estimate is
// under `resumeBelow`, but at most `maxPauseSeconds`, unless more is needed to get under `safeResume` (room for two
// more corrections before the kick line), and never longer than `hardPauseSeconds` (above 400 the server has kicked
// already, so standing longer cannot help). Corrections that are not TruthDetector's (a GetClientMove dropped as late
// by NetCull.VerifyRPC also answers ReadClientMove, without any violation) are left out by the caller
// (FrameLog.truthCorrectionCount).
export class TruthGuard{
 constructor({perCorrection=100,decayPerSecond=5,pauseAbove=150,resumeBelow=50,safeResume=100,maxPauseSeconds=20,hardPauseSeconds=60}={}){
  Object.assign(this,{perCorrection,decayPerSecond,pauseAbove,resumeBelow,safeResume,maxPauseSeconds,hardPauseSeconds});this.value=0;this.at=null;this.total=0;this.seen=0;}
 // Estimated violation at time t (seconds).
 estimate(t){if(this.at===null)return 0;return Math.max(0,this.value-(t-this.at)*this.decayPerSecond);}
 // `count` corrections so far (a growing counter, e.g. FrameLog.truthCorrectionCount); returns the new ones. A counter
 // that went down (a fresh FrameLog) starts over from there.
 update(count,t){if(count<this.seen)this.seen=count;const fresh=count-this.seen;this.seen=count;
  if(fresh){this.value=this.estimate(t)+fresh*this.perCorrection;this.at=t;this.total+=fresh;}return fresh;}
 mustPause(t){return this.estimate(t)>this.pauseAbove;}
 mayResume(t){return this.estimate(t)<this.resumeBelow;}
 // Seconds of standing still from t (see above); 0 when no pause is needed.
 pauseSeconds(t){const e=this.estimate(t),d=this.decayPerSecond;if(e<=this.pauseAbove)return 0;
  const full=(e-this.resumeBelow)/d,must=(e-this.safeResume)/d;
  return Math.min(this.hardPauseSeconds,Math.max(must,Math.min(full,this.maxPauseSeconds)));}
}
