// Optional live title-screen background: the game's own MenuBackground scene (browser/menu-background.mjs, ~36 MB,
// the same files Play downloads, so it also warms the cache). Only on capable desktops, never on save-data or slow
// connections, never with reduced motion, and only where the game is served on this origin.
export const LIVE_OPT_OUT_KEY='rlb-live-bg-off';

export function shouldLoadLive({width,finePointer,webgl2,reducedMotion,saveData,effectiveType,optOut,gameOrigin}){
 return width>=1100&&finePointer&&webgl2&&!reducedMotion&&!saveData&&(effectiveType===undefined||effectiveType==='4g')&&!optOut&&gameOrigin;
}

export function environment({gameOrigin,storage=globalThis.localStorage}={}){
 let optOut=false;try{optOut=storage?.getItem(LIVE_OPT_OUT_KEY)==='1';}catch{}
 // The probe context is released at once (browsers cap live WebGL contexts; the live scene makes its own).
 let webgl2=false;try{const gl=document.createElement('canvas').getContext('webgl2');webgl2=Boolean(gl);gl?.getExtension('WEBGL_lose_context')?.loseContext();}catch{}
 return {width:innerWidth,finePointer:matchMedia('(hover: hover) and (pointer: fine)').matches,webgl2,
  reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,saveData:Boolean(navigator.connection?.saveData),
  effectiveType:navigator.connection?.effectiveType,optOut,gameOrigin};
}

// Renders the live scene into `canvas` and fades it in. Any failure leaves the still image in place.
export async function startLive(canvas){
 try{
  const THREE=await import('three'),{loadMenuBackground}=await import('/menu-background.mjs');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  const size=()=>{const r=canvas.getBoundingClientRect();renderer.setSize(r.width,r.height,false);bg?.resize(r.width,r.height);};
  let bg=null;size();
  bg=await loadMenuBackground({aspect:canvas.clientWidth/Math.max(1,canvas.clientHeight)});size();
  let last=performance.now(),frame=0;
  const draw=t=>{if(document.hidden){frame=requestAnimationFrame(draw);last=t;return;}bg.frame(Math.min(.05,(t-last)/1000));last=t;renderer.render(bg.scene,bg.camera);frame=requestAnimationFrame(draw);};
  frame=requestAnimationFrame(t=>{last=t;draw(t);canvas.classList.add('live');});
  addEventListener('resize',size);
  return {stop(){cancelAnimationFrame(frame);removeEventListener('resize',size);bg.dispose();renderer.dispose();canvas.classList.remove('live');}};
 }catch(e){console.warn('Live title screen unavailable:',e.message);return null;}
}
