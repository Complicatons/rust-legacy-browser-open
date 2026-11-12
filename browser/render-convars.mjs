// The client console variables of render.cs / water.cs / terrain.cs that are not Options rows, and the listeners of
// GameEvent.QualitySettingsRefresh they drive (decompiled Assembly-CSharp):
//  render.distance [Saved] 0..1, default 0.2 -> CameraSettings.RefreshSettings: CameraLayerDepths[layer] = Minimum +
//                  distance * (Maximum - Minimum) for each ViewDistanceLayers entry (the Scene Camera has one: CULL500,
//                  600..1600 m), i.e. the main camera's layerCullDistances (spherical).
//  render.frames   [Saved] default -1 -> Application.targetFrameRate (no cap for -1).
//  water.level     [Saved] int, default -1 -> WaterSettings.RefreshSettings: when not -1, waterQuality = clamp(level - 1,
//                  0, 2) and edgeBlend = (level == 2), overriding render.level's choice.
//  water.reflection [Saved] (Options row) -> PlanarReflection.reflectionMask 13111296 (CULL500, Terrain, MeshBatched,
//                  Skybox) when on, else 8388608 (Skybox).
//  terrain.idleinterval [Client] (not saved), default 3.2 -> TerrainControl.Update forces TerrainHack.RefreshTreeTextures
//                  after the camera has neither moved (> 0.0075 m) nor turned (> 0.5 deg) for that many seconds.
//  terrain.manual  [Client] (not saved) -> stops TerrainControl.ReassignTerrainData (the browser has no bundle re-assign).
// Every render.* setter (level, distance, frames, fov, vsync) and the render.update command end in render.update(), which
// raises QualitySettingsRefresh; water.level / water.reflection have no setter, so they take effect at the next refresh
// (an Options Apply always sets render.level and render.vsync, which refresh).

export const LAYER_COUNT=32;
// WaterSettings.RefreshSettings reflection masks.
export const REFLECTION_MASK_ON=13111296,REFLECTION_MASK_OFF=8388608;
export const maskLayers=mask=>{const out=[];for(let i=0;i<LAYER_COUNT;i++)if((mask>>>i)&1)out.push(i);return out;};

// Mathf.Clamp01 for render.distance.
export const clamp01=v=>Math.min(1,Math.max(0,v));

// CameraLayerDepths (serialized layer00..layer31) with CameraSettings.ViewDistanceLayers applied for render.distance.
// depths: {layer00:..} params or an array of 32; viewLayers: [{Name,MinimumValue,MaximumValue}]; layerIndex(name) -> index.
export function cameraLayerDistances(depths,viewLayers,renderDistance,layerIndex){
 const out=new Array(LAYER_COUNT).fill(0);
 for(let i=0;i<LAYER_COUNT;i++){const v=Array.isArray(depths)?depths[i]:depths?.['layer'+String(i).padStart(2,'0')];out[i]=Number.isFinite(v)?v:0;}
 for(const l of viewLayers??[]){const i=layerIndex(l.Name);if(i>=0&&i<LAYER_COUNT)out[i]=l.MinimumValue+renderDistance*(l.MaximumValue-l.MinimumValue);}
 return out;
}

// WaterSettings.RefreshSettings: render.level > 0.8 High + edge blend, > 0.5 Medium, else Low; water.level overrides.
export function waterRefresh(renderLevel,waterLevel=-1,reflection=false){
 let waterQuality,edgeBlend;
 if(renderLevel>0.8){waterQuality=2;edgeBlend=true;}else if(renderLevel>0.5){waterQuality=1;edgeBlend=false;}else{waterQuality=0;edgeBlend=false;}
 if(waterLevel!==-1){waterQuality=Math.min(2,Math.max(0,waterLevel-1));edgeBlend=waterLevel===2;}
 const reflectionMask=reflection?REFLECTION_MASK_ON:REFLECTION_MASK_OFF;
 return {waterQuality,edgeBlend,reflectionMask,reflectionLayers:maskLayers(reflectionMask),reflections:Boolean(reflection)};
}

// Application.targetFrameRate in a requestAnimationFrame loop: a frame runs when its time has come (fps <= 0: every
// frame). The schedule advances by whole intervals so a 60 Hz display at 30 runs every other frame without drift.
export class FrameLimiter{
 constructor(fps=-1){this.fps=fps;this.next=null;}
 set target(fps){if(fps!==this.fps){this.fps=fps;this.next=null;}}
 // now: rAF timestamp (ms). Returns true when this frame should run.
 shouldRun(now){
  if(!(this.fps>0))return true;
  const interval=1000/this.fps,slack=Math.min(2,interval*0.25);
  if(this.next===null){this.next=now+interval;return true;}
  if(now+slack<this.next)return false;
  this.next+=interval;if(now-this.next>interval)this.next=now+interval;
  return true;
 }
}

// TerrainControl.Update: returns true when TerrainHack.RefreshTreeTextures runs this frame. now in seconds
// (Time.realtimeSinceStartup), position/forward: MountedCamera.main (forward normalised here).
export const IDLE_MOVE_SQR=5.625e-5,IDLE_TURN_DEGREES=0.5;
export function vectorAngle(a,b){ // Vector3.Angle (degrees); a zero vector gives 90 (dot of normalised zero = 0)
 const la=Math.hypot(a[0],a[1],a[2]),lb=Math.hypot(b[0],b[1],b[2]);
 const d=la>1e-5&&lb>1e-5?(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(la*lb):0;return Math.acos(Math.min(1,Math.max(-1,d)))*180/Math.PI;}
export class TerrainIdleRefresh{
 constructor(interval=3.2){this.interval=interval;this.timeNoticed=0;this.lastPosition=[0,0,0];this.lastForward=[0,0,0];this.refreshes=0;}
 update(now,position,forward){
  const interval=this.interval;let changed;
  if(!(interval>0)||!position)changed=true;
  else{const dx=position[0]-this.lastPosition[0],dy=position[1]-this.lastPosition[1],dz=position[2]-this.lastPosition[2];
   if(dx*dx+dy*dy+dz*dz>IDLE_MOVE_SQR||vectorAngle(forward,this.lastForward)>IDLE_TURN_DEGREES){this.lastPosition=[...position];this.lastForward=[...forward];changed=true;}
   else changed=false;}
  if(changed){this.timeNoticed=now;return false;}
  const elapsed=now-this.timeNoticed;
  if(elapsed>interval){this.timeNoticed=interval>0?now-elapsed%interval:now;this.refreshes++;return true;}
  return false;
 }
}

// render.update / terrain.flushtrees console commands (the variables themselves live in browser/convars.mjs ConVars).
// refresh(): GameEvent.DoQualitySettingsRefresh. Returns null for names this module does not own.
export function renderCommand(line,{refresh,flushTrees}={}){
 const [name]=String(line).trim().split(/\s+/);
 // render.update: "Makes sure settings match their convar values" (render.update() -> QualitySettingsRefresh).
 if(name==='render.update'){refresh?.('render.update');return {ok:true,text:''};}
 // terrain.flushtrees: TerrainHack.RefreshTreeTextures. (terrain.reassign / reassign_nocopy / mat / flush re-bind the
 // bundle TerrainData and material, which the browser terrain never swaps: not ported.)
 if(name==='terrain.flushtrees'&&flushTrees){flushTrees();return {ok:true,text:''};}
 return null;
}
