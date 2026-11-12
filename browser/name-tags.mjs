// Player name tags: original GameTip (player prefab) drawn by GameTooltipManager (BuildPlayer-GameUI "GameTooltips").
// Decompiled GameTip.cs, GameTooltipManager.cs, Player.uLink_OnNetworkInstantiate (player.cs), PlayerClient.cs and
// Controllable (PlayerClient.Find by the view owner). Serialized values read statically from the client bundles
// (tools/_tags-probe.py, tools/_tags-probe2.py; data only):
//  - GameTip sits on the body SkinnedMeshRenderer "MAKE US WHOLE" (child of RustPlayer_Pelvis). text "Unnammed",
//    lineOfSight 1, testOffset (0,.8,0), positionOffset (0,1.85,0), textColor white, maxDistance 20 (the class default
//    16 is overridden by the prefab), TargetCollider = the character's own collider.
//  - tooltipPrefab "prefabTooltip": dfLabel 287x48, RobotoCondensed-Bold (dfDynamicFont, base size 16) at textScale 3,
//    autoSize, centred, white, no outline or shadow. 16 pooled tooltips.
// Rules: the owner's own tip is disabled; other players show PlayerClient.userName of the view owner, read once when
// the character is instantiated (no PlayerClient yet = "Unnammed"). Shown while the body renderer is drawn by the main
// camera, within maxDistance, and not blocked: alpha 1 - d/max, scale 2 / (d * 2 tan(fov/2)). Sleepers and corpses are
// other prefabs without a GameTip, so they never show a name. `gametip.scale` exists but nothing reads it.

export const GAME_TIP=Object.freeze({text:'Unnammed',lineOfSight:true,testOffset:[0,0.8,0],positionOffset:[0,1.85,0],textColor:[1,1,1,1],maxDistance:20,
 // "MAKE US WHOLE" local transform under RustPlayer_Pelvis (Unity space).
 node:{parent:'RustPlayer_Pelvis',position:[-0,-0.9355078935623169,0.01507797371596098],rotation:[-0.7071067094802856,0,-0,0.7071069478988647],scale:[1,0.9999999403953552,0.9999999403953552]}});
export const TOOLTIP=Object.freeze({pool:16,font:'RobotoCondensed-Bold',fontSize:16*3,width:287,height:48,hideAfterFrames:3});

// ":client" initial data (ServerManagement.CreatePlayerClientForUser; PlayerClient.uLink_OnNetworkInstantiate):
// untyped BitStream ulong userID, string userName (varuint length + UTF-8). null when malformed.
export function readPlayerClientData(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<9)return null;const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const userId=v.getBigUint64(0,true);let p=8,n=0,shift=0,b;do{if(p>=bytes.length||shift>28)return null;b=bytes[p++];n|=(b&0x7f)<<shift;shift+=7;}while(b&0x80);
 n>>>=0;if(p+n>bytes.length)return null;let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p,p+n));}catch{return null;}
 return {userId:userId.toString(),name};}
// The matching writer (tests and the mock server).
export function writePlayerClientData(userId,name){const text=new TextEncoder().encode(name),len=[];let n=text.length;do{let b=n&0x7f;n>>>=7;if(n)b|=0x80;len.push(b);}while(n);
 const out=new Uint8Array(8+len.length+text.length);new DataView(out.buffer).setBigUint64(0,BigInt(userId),true);out.set(len,8);out.set(text,8+len.length);return out;}

// GameTip.OnWillRenderObject.
export const tipAlpha=(d,max=GAME_TIP.maxDistance)=>1-d/max;
export const tipScale=(d,fovDegrees)=>2/(d*(2*Math.tan(fovDegrees/2*Math.PI/180)));
// GameTip.TestLineOfSight on the first hit of a ray from the camera towards tip + testOffset, `distance` long
// (distance to the tip itself). Returns true when the tip is hidden.
export function lineOfSightBlocked(hit,distance,ownHit=()=>false){if(!hit)return false;if(hit.distance>distance-0.5)return false;return !ownHit(hit);}
export function tipVisible({distance,maxDistance=GAME_TIP.maxDistance,rendered=true,blocked=false}){return rendered&&!(distance>maxDistance)&&!blocked;}
// GameTooltipManager.UpdateTip placement: the label's bottom centre at the projected point (screen y from the top).
export function tipRect(screenX,screenY,width,scale,height=TOOLTIP.height){return {x:screenX-width/2*scale,y:screenY-height*scale,scale};}

// GameTooltipManager: 16 pooled tooltips; a tip unseen for 3 frames hides, its container is reused.
export class TooltipPool{
 constructor(size=TOOLTIP.pool){this.items=Array.from({length:size},()=>({target:null,lastSeen:0,visible:false,text:'',color:null,alpha:1,x:0,y:0,scale:1}));this.frame=0;}
 // Update(): hide every tooltip not seen within the last 3 frames (lastSeen <= frameCount - 3).
 beginFrame(frame=this.frame+1){this.frame=frame;const num=frame-3;for(const t of this.items)if(!(t.lastSeen>num)&&t.visible)t.visible=false;}
 container(target){const num=this.frame-3;for(const t of this.items)if(!(t.lastSeen<num)&&t.target===target)return t;for(const t of this.items){if(t.target==null)return t;if(t.lastSeen<num)return t;}return null;}
 update(target,{text,color,alpha,x,y,scale}){const t=this.container(target);if(!t)return null;t.visible=true;Object.assign(t,{text,color,alpha,x,y,scale,lastSeen:this.frame,target});return t;}
}

// DOM layer for the pool (GameUI is pixel-perfect: one GUI pixel per CSS pixel).
export function createNameTagLayer({document=globalThis.document,parent=document?.body}={}){
 const layer=document.createElement('div');layer.id='name-tags';layer.setAttribute('aria-hidden','true');parent.append(layer);
 const pool=new TooltipPool(),els=pool.items.map(()=>{const el=document.createElement('div');el.className='name-tag';el.hidden=true;layer.append(el);return el;});
 const measure=document.createElement('canvas').getContext('2d'),widths=new Map();
 document.fonts?.addEventListener?.('loadingdone',()=>widths.clear()); // measured again once the original font is in
 const width=text=>{if(!widths.has(text)){measure.font=`${TOOLTIP.fontSize}px "${TOOLTIP.font}"`;widths.set(text,Math.ceil(measure.measureText(text).width));if(widths.size>256)widths.delete(widths.keys().next().value);}return widths.get(text);};
 return {layer,pool,width,
  // tips: [{target, text, screenX, screenY, alpha, scale, color}] for this frame.
  frame(tips){pool.beginFrame();for(const tip of tips){const w=width(tip.text),r=tipRect(tip.screenX,tip.screenY,w,tip.scale);pool.update(tip.target,{text:tip.text,color:tip.color??GAME_TIP.textColor,alpha:tip.alpha,x:r.x,y:r.y,scale:r.scale,width:w});}
   pool.items.forEach((t,i)=>{const el=els[i];if(!t.visible){if(!el.hidden)el.hidden=true;return;}el.hidden=false;if(el.textContent!==t.text)el.textContent=t.text;
    const [r,g,b]=t.color.map(c=>Math.round(c*255));el.style.color=`rgb(${r},${g},${b})`;el.style.opacity=String(Math.max(0,Math.min(1,t.alpha*(t.color[3]??1))));
    el.style.width=t.width+'px';el.style.transform=`translate(${t.x.toFixed(1)}px,${t.y.toFixed(1)}px) scale(${t.scale.toFixed(4)})`;});},
  snapshot:()=>pool.items.filter(t=>t.visible).map(t=>({text:t.text,alpha:t.alpha,x:t.x,y:t.y,scale:t.scale})),
  hide(){pool.beginFrame(pool.frame+4);for(const el of els)el.hidden=true;}};
}
