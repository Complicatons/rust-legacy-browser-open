// Saved client console variables that the original Options window binds (ConvarBinding on BuildPlayer-GameUI's Options rows;
// OptionsWindow.DoApply -> UpdateConVars + "config.save"). Defaults are the shipped console-variable defaults, not the prefab's
// serialized control values (ConvarBinding.Start/UpdateFromConVar overwrite those): input.cs mousespeed 5 / flipy false,
// render.cs vsync false, water.cs reflection false. sound.volume / sound.music live in audio.mjs (audioSettings, shared with
// the game's audio) and are routed there when a `sound` provider is given.
// render.level is QualitySettings.GetQualityLevel()/(names-1). Its default is the build's m_CurrentQuality (mainData
// QualitySettings: 0, Fastest), the level a fresh install started at (browser/quality.mjs DEFAULT_QUALITY_INDEX).
// gfx.* (gfx.cs, [Client][Saved]) are the camera image effects; defaults are the shipped client.cfg values (all True, which
// is also ImageEffectManager.GetEnabled's answer for a never-set state). render.level changes rewrite some of them
// (render.update, browser/quality.mjs renderUpdateGfx).
import {DEFAULT_QUALITY_INDEX,qualityLevel,pixelRatioForQuality as pixelRatioForIndex} from './quality.mjs';
const KEY='rlb-convars';
export const QUALITY_LEVELS=['Fastest','Fast','Simple','Good','Beautiful','Fantastic'];
export const CONVARS={
 'render.level':{type:'float',value:qualityLevel(DEFAULT_QUALITY_INDEX),min:0,max:1},
 'render.vsync':{type:'bool',value:false},
 'water.reflection':{type:'bool',value:false},
 'input.mousespeed':{type:'float',value:5},
 'input.flipy':{type:'bool',value:false},
 // grass.cs [Client][Saved][User] (FPGrass): displacement = Supported && !DisplacementExpensive (true with WebGL2 render
 // targets), shadowcast/shadowreceive mirror FPGrass.castShadows/receiveShadows. The original grass.on default is
 // Support.Supported (on); the browser port starts with grass OFF by the project owner's explicit decision. Players
 // turn it on with Options > browser > Grass (or F1 "grass.on true").
 'grass.on':{type:'bool',value:false},
 'grass.forceredraw':{type:'bool',value:false},
 'grass.displacement':{type:'bool',value:true},
 'grass.disp_trail_seconds':{type:'float',value:10},
 'grass.shadowcast':{type:'bool',value:false},
 'grass.shadowreceive':{type:'bool',value:true},
 'gfx.ssaa':{type:'bool',value:true},'gfx.bloom':{type:'bool',value:true},'gfx.grain':{type:'bool',value:true},'gfx.ssao':{type:'bool',value:true},
 'gfx.tonemap':{type:'bool',value:true},'gfx.shafts':{type:'bool',value:true},'gfx.damage':{type:'bool',value:true},
 // footsteps.cs [Client][Saved] int quality = 2 (0 default sound, 1 dynamic for local, 2 dynamic for all); int.Parse, no range.
 'footsteps.quality':{type:'int',value:2},
 // render.cs / water.cs / terrain.cs variables without an Options row (browser/render-convars.mjs applies them):
 // render.distance [Saved] float (setter Mathf.Clamp01, default 0.2); render.frames [Saved] int targetFrameRate (-1 = no
 // cap); water.level [Saved] int (-1 = follow render.level); terrain.* are [Client] only (not saved).
 'render.distance':{type:'float',value:0.2,min:0,max:1},
 'render.frames':{type:'int',value:-1},
 'water.level':{type:'int',value:-1},
 'terrain.idleinterval':{type:'float',value:3.2,saved:false},
 'terrain.manual':{type:'bool',value:false,saved:false}};
// [Saved] variables only persist (config.save writes ConsoleSystem's saved convars).
const savedConVar=k=>CONVARS[k]&&CONVARS[k].saved!==false;
// ConVar.GetBool / bool.Parse accept "True"/"False" (any case); ConsoleSystem also accepts 1/0.
export function parseConVar(def,text){const s=String(text).trim().replace(/^"(.*)"$/,'$1');
 if(def.type==='bool'){if(/^(true|1)$/i.test(s))return true;if(/^(false|0)$/i.test(s))return false;return null;}
 if(def.type==='int'){if(!/^[-+]?\d+$/.test(s))return null;const n=Number(s);return n>=-2147483648&&n<=2147483647?n:null;}
 if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s))return null;let v=Number(s);if(!Number.isFinite(v))return null;
 // sound.volume sets AudioListener.volume (clamped 0..1 by Unity); render.level rounds to a quality index in its setter.
 if(def.min!==undefined)v=Math.min(def.max,Math.max(def.min,v));return v;}
// render.level setter: Mathf.RoundToInt(value * (names - 1)) (banker's rounding on .5).
export function qualityIndex(level,count=QUALITY_LEVELS.length){const x=Math.min(1,Math.max(0,level))*(count-1),f=Math.floor(x),d=x-f;return d>0.5?f+1:d<0.5?f:(f%2===0?f:f+1);}
// GameInput.mouseDeltaX = Input.GetAxis("Mouse X") * input.mousespeed; the shipped InputManager "Mouse X"/"Mouse Y" axes have
// sensitivity 0.075, and HumanController adds the result to the eye angles in degrees. Returns radians per mouse count.
export const MOUSE_AXIS_SENSITIVITY=0.075;
export function lookRadiansPerCount(mousespeed){return MOUSE_AXIS_SENSITIVITY*mousespeed*Math.PI/180;}
// Canvas pixel ratio for a render.level value (browser/quality.mjs pixelRatioForQuality: 1 CSS pixel below Good, HiDPI
// up to 1.5 from Good up; textures follow QualitySettings.masterTextureLimit in the shaders).
export function pixelRatioForQuality(level,devicePixelRatio=1){return pixelRatioForIndex(qualityIndex(level),devicePixelRatio);}

const SOUND={'sound.volume':'volume','sound.music':'music'};
// Saves written before the Grass option existed may hold grass.on true (the old default); only saves carrying this
// marker (every save since) restore grass.on, so earlier players still start with grass off until they opt in.
const GRASS_OPTION_MARKER='grass.option';
export class ConVars extends EventTarget{
 constructor(storage=null,{sound=null}={}){super();this.storage=storage;this.sound=sound;this.values=Object.fromEntries(Object.entries(CONVARS).map(([k,d])=>[k,d.value]));
  try{const saved=JSON.parse(storage?.getItem(KEY)??'null');if(saved&&typeof saved==='object')for(const [k,v] of Object.entries(saved))if(savedConVar(k)&&(k!=='grass.on'||saved[GRASS_OPTION_MARKER]===1)){const p=parseConVar(CONVARS[k],v);if(p!==null)this.values[k]=p;}}catch{}}
 get(name){if(SOUND[name]&&this.sound)return SOUND[name]==='volume'?this.sound.master:this.sound.music;return this.values[name];}
 // ConsoleSystem.Run('<name> "<value>"'); returns false for unknown names or unparsable values.
 set(name,value){if(SOUND[name]&&this.sound){const v=parseConVar({type:'float',min:0,max:1},value);if(v===null)return false;this.sound.setVolume({[SOUND[name]]:v});return true;}const def=CONVARS[name];if(!def)return false;const v=parseConVar(def,value);if(v===null)return false;const changed=this.values[name]!==v;this.values[name]=v;if(changed)this.dispatchEvent(Object.assign(new Event('change'),{name,value:v}));
  // 'set' fires for every successful set, changed or not: property setters such as render.level / render.vsync run
  // render.update() (QualitySettingsRefresh) even when the value is the same.
  this.dispatchEvent(Object.assign(new Event('set'),{name,value:v,changed}));return true;}
 // config.load (ConsoleSystem.RunFile of the saved cfg): every saved value is set again (change events fire); returns
 // false when nothing is saved, so the caller runs the default config instead.
 load(){let saved=null;try{saved=JSON.parse(this.storage?.getItem(KEY)??'null');}catch{}if(!saved||typeof saved!=='object')return false;
  for(const [k,v] of Object.entries(saved))if(savedConVar(k)&&(k!=='grass.on'||saved[GRASS_OPTION_MARKER]===1))this.set(k,v);return true;}
 // config.save: the [Saved] client variables persist (here in this browser's localStorage).
 save(){try{this.storage?.setItem(KEY,JSON.stringify({...Object.fromEntries(Object.entries(this.values).filter(([k])=>savedConVar(k))),[GRASS_OPTION_MARKER]:1}));}catch{}}
 // F1 console form: "<name>" prints, "<name> <value>" sets. Unknown names return null so other handlers can try.
 command(line){const [name,...args]=line.trim().split(/\s+/);const def=CONVARS[name];if(!def)return null;
  if(args.length===0)return {ok:true,text:`${name}: ${this.format(name)}`};
  if(!this.set(name,args.join(' ')))return {ok:false,text:`Usage: ${name} <${def.type==='bool'?'true|false':'number'}>`};this.save();return {ok:true,text:`${name}: ${this.format(name)}`};}
 format(name){const v=this.values[name];return typeof v==='boolean'?(v?'True':'False'):String(v);}
}
