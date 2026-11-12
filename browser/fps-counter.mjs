// Browser-port FPS counter (Options > browser > FPS Counter; not part of the original game). Counts real animation
// frames and refreshes a small corner readout twice a second.
export const FPS_REFRESH_MS=500;

// Frames per second over a window of `frames` frames that took `elapsedMs` (rounded; 0 for an empty window).
export function framesPerSecond(frames,elapsedMs){return elapsedMs>0&&frames>0?Math.round(frames*1000/elapsedMs):0;}

// Accumulates frame timestamps; returns a new reading once at least FPS_REFRESH_MS has passed, otherwise null.
export function createFpsMeter(refreshMs=FPS_REFRESH_MS){let start=null,frames=0;
 return {frame(now){if(start===null){start=now;frames=0;return null;}frames++;const elapsed=now-start;if(elapsed<refreshMs)return null;const fps=framesPerSecond(frames,elapsed);start=now;frames=0;return fps;},
  reset(){start=null;frames=0;}};}

// visible(): whether the readout should show now (option on and in game). Returns {element, stop()}.
export function createFpsCounter({visible,parent=document.body,raf=globalThis.requestAnimationFrame?.bind(globalThis)}){
 const el=document.createElement('div');el.id='fps-counter';el.hidden=true;el.setAttribute('aria-hidden','true');
 Object.assign(el.style,{position:'fixed',top:'4px',right:'6px',zIndex:'40',pointerEvents:'none',font:'12px/1.2 monospace',color:'#e8e8e8',
  textShadow:'0 0 2px #000,1px 1px 1px #000',opacity:'0.8'});
 parent.append(el);const meter=createFpsMeter();let running=true;
 const tick=now=>{if(!running)return;const show=Boolean(visible());if(el.hidden===show)el.hidden=!show;
  if(show){if(!el.textContent)el.textContent='-- FPS';const fps=meter.frame(now);if(fps!==null)el.textContent=`${fps} FPS`;}else meter.reset();raf(tick);};
 raf(tick);
 return {element:el,stop(){running=false;el.remove();}};
}
