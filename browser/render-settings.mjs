const KEY='rlb-render-settings';
export function parseFov(value){if(!/^[-+]?\d+$/.test(String(value).trim()))return null;const n=Number(value);return Number.isFinite(n)?Math.min(120,Math.max(60,Math.trunc(n))):null;}
// render.cs: saved integer render.fov, range 60..120. The decompiled default is 60; the owner asked for 90 as this
// port's own default (2026-10-29) — a deliberate deviation, not a fidelity fix.
// showFps: browser-port FPS counter (Options > browser), off by default.
// fullscreen: browser port, play in fullscreen (game-controls.mjs enters it on capture so Keyboard Lock can keep Ctrl+W
// and the other browser shortcuts in the game); the player's last fullscreen choice, on by default.
export class RenderSettings extends EventTarget{
 constructor(storage=null,{fullscreen=true}={}){super();this.storage=storage;this.fov=90;this.releaseKey='F2';this.showFps=false;this.fullscreen=Boolean(fullscreen);try{const saved=JSON.parse(storage?.getItem(KEY)??'null');this.fov=parseFov(saved?.fov)??90;if(['F2','F3','F4'].includes(saved?.releaseKey))this.releaseKey=saved.releaseKey;this.showFps=saved?.showFps===true;if(typeof saved?.fullscreen==='boolean')this.fullscreen=saved.fullscreen;}catch{}}
 save(){try{this.storage?.setItem(KEY,JSON.stringify({fov:this.fov,releaseKey:this.releaseKey,showFps:this.showFps,fullscreen:this.fullscreen}));}catch{}this.dispatchEvent(new Event('change'));}
 setFullscreen(value){if(this.fullscreen===Boolean(value))return true;this.fullscreen=Boolean(value);this.save();return true;}
 setFov(value){const fov=parseFov(value);if(fov==null)return false;this.fov=fov;this.save();return true;}
 setShowFps(value){this.showFps=Boolean(value);this.save();return true;}
 setReleaseKey(value){if(!['F2','F3','F4'].includes(value))return false;this.releaseKey=value;this.save();return true;}
 command(line){const [name,...args]=line.trim().split(/\s+/);if(name!=='render.fov')return {ok:false,text:`Unknown command: ${name}`};if(args.length===0)return {ok:true,text:`render.fov: ${this.fov}`};if(args.length!==1||!this.setFov(args[0]))return {ok:false,text:'Usage: render.fov <60-120>'};return {ok:true,text:`render.fov: ${this.fov}`};}
}
