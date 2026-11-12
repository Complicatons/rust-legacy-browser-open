// Combat feedback presentation, ported from the decompiled client (static export: tools/export_feedback.py):
// - WeaponDataBlock/BowWeaponDataBlock.PlayHitNotification: content/shared/sfx/hitnotification PlayLocal on the camera and a
//   content/hud/HUDHitIndicator (Custom/HitIndicator shader, alpha AnimationCurve, follows the world point unless aiming).
// - ClientVitalsSync.ClientHealthChange: LocalDamageDisplay.SetNewHealthPercent (bob choice + GameFullscreen overlays) and
//   HUDDirectionalDamage.CreateIndicator(eyes difference, amount, NetCull.time, 1.6 s) (Custom/DamageIndicatorFaded shader).
// - LocalDamageDisplay.LateUpdate -> GameFullscreen overlays 0/1 (damage_overlay_large / damage_overlay_2, shader pass 3).
// Pure rules are exported for Node tests; createCombatFeedback draws them with three.js after the frame.
import * as THREE from 'three';

// BulletWeaponDataBlock: Head, Jaw, Brain, L_Eye, R_Eye (Facepunch.HitBox BodyPart values).
export const HEAD_PARTS=new Set([9,12,16,20,21]);
export const isHeadshotPart=part=>HEAD_PARTS.has(part);
export const DIRECTIONAL_DURATION=1.600000023841858; // ClientVitalsSync: (double)1.6f

// TakeDamage.ShouldPlayHitNotification: playsHitNotification && alive (evaluated on the client before any damage).
export function shouldPlayHitNotification(flags,prefabName,alive){return Boolean(flags?.[prefabName]?.plays)&&Boolean(alive);}

// Unity AnimationCurve (cubic Hermite between keys, clamped outside the key range).
export function evaluateCurve(keys,t){
 if(!keys.length)return 0;if(t<=keys[0].time)return keys[0].value;const last=keys[keys.length-1];if(t>=last.time)return last.value;
 let i=0;while(i<keys.length-2&&t>keys[i+1].time)i++;const a=keys[i],b=keys[i+1],dt=b.time-a.time;if(!(dt>0))return a.value;
 const s=(t-a.time)/dt,s2=s*s,s3=s2*s,m0=a.outSlope*dt,m1=b.inSlope*dt;
 return (2*s3-3*s2+1)*a.value+(s3-2*s2+s)*m0+(-2*s3+3*s2)*b.value+(s3-s2)*m1;}
// HUDHitIndicator.Continue: finished after the last key; _AlphaValue = Clamp(curve.Evaluate(age), 1/255, 254/255).
export function hitIndicatorAlpha(curve,age,clamp=[1/255,254/255]){const keys=curve.keys;if(age>keys[keys.length-1].time)return null;
 return Math.min(clamp[1],Math.max(clamp[0],evaluateCurve(keys,age)));}
// Custom/HitIndicator fragment (ARB fp): a = 1 - tex.a*col.a; out.a = k * (1 - max(a, k)) / (1 - k).
export function hitIndicatorFragmentAlpha(texAlpha,colorAlpha,k){return k*(1-Math.max(1-texAlpha*colorAlpha,k))/(1-k);}

// TransitionFunctions.Spline(t, a, b).
export function spline(t,a,b){if(t<=0)return a;if(t>=1)return b;const s=3*(t*t)-2*(t*t)*t;return a*(1-s)+b*s;}

// HUDDirectionalDamage: Start() randomises channel windows; Continue() animates _MinChannels/_MaxChannels.
export class DirectionalDamage{
 constructor(rng=Math.random,{duration=DIRECTIONAL_DURATION,damageTime=0,worldDirection=[0,0,0],amount=0}={}){
  const range=(a,b)=>a+(b-a)*rng(),f=Math.fround;
  this.randMin=[0,0,0,0].map(()=>f(range(0,0.06)));this.randMax=[0,0,0,0].map(()=>f(range(0.94,1)));
  const n=Math.min(63,Math.floor(rng()*64));
  this.swap=[(n&1)===1,(n&2)===2,(n&4)===4];this.inverse=[(n&8)===8,(n&16)===16,(n&32)===32];
  const mod=i=>1.12-(1-(this.randMax[i]-this.randMin[i]));const w=mod(3);this.speed=[mod(0)/w,mod(1)/w,mod(2)/w];
  Object.assign(this,{duration,damageTime,worldDirection,amount});this.angle=0;
 }
 // Continue(): null when finished, else the shader vectors.
 channels(stepTime){if(this.duration<=0)return null;const num=stepTime-this.damageTime;if(num>this.duration)return null;
  const n2=num/this.duration,fold=v=>v>1?1-(v-1):v,n3=fold(n2*this.speed[0]),n4=fold(n2*this.speed[1]),n5=fold(n2*this.speed[2]);
  const n6=spline(n3,1,0),n7=n4<0.10000000149011612?spline(n4/0.1,0,1):spline((n4-0.1)/0.9,1,0),n8=Math.cos(n5*(Math.PI/2)),f=Math.fround;
  const min=[f(n8),f(n6),f(n7),f(n2)],max=[f(n8/this.speed[0]),f(n6/this.speed[1]),f(n7/this.speed[2]),f(1-n2)];
  for(let i=0;i<3;i++){if(this.inverse[i])max[i]=f(1-max[i]);}
  for(let i=0;i<3;i++)if(this.swap[i]){const x=max[i];max[i]=min[i];min[i]=x;}
  return {min,max};}
}
// HUDDirectionalDamage.Continue rotation: v = Scale(1,1,-1) * worldToCameraMatrix * worldDirection (Unity camera local:
// x right, y up, z forward); kept unchanged when y^2 > 0.99. Browser view matrices give (x, y, -z) of the same frame.
// Returns degrees about the screen normal (0 = right of centre, 90 = top) or null to keep the previous angle.
export function directionalAngle(worldDirection,viewMatrix){
 const v=new THREE.Vector3(...worldDirection).transformDirection(viewMatrix);if(Math.hypot(...worldDirection)<1e-5)v.set(0,0,0);
 const x=v.x,y=v.y,z=-v.z;if(y*y>0.99)return null;return Math.atan2(z,x)*57.29578;}
// The arc DamageHalve texture shader (Custom/DamageIndicatorFaded, decoded from the shipped ARB/ps_2_0 programs).
export function damageIndicatorAlpha(tex,min,max,colorAlpha=1){
 const inside=[0,1,2].map(i=>tex[i]>=min[i]&&max[i]>=tex[i]?1:0),norm=[0,1,2].map(i=>inside[i]?0:(tex[i]-min[i])/(max[i]-min[i])*max[3]);
 const any=Math.max(...inside),v=Math.min(1,Math.max(0,Math.max(...norm)-min[3]+any));return colorAlpha*v*tex[3]*max[3];}

// ClientVitalsSync.ClientHealthChange on the local character: `amount` is the new absolute health.
export class ClientVitals{
 constructor(maxHealth=100){this.maxHealth=maxHealth;this.health=maxHealth;}
 change(amount){const before=this.health;this.health=amount;const delta=Math.abs(amount-before),decreased=amount<before;
  return {before,health:amount,delta,decreased,fraction:amount/this.maxHealth,display:delta>=1,indicator:decreased&&delta>=1};}
}
// Mathf.RoundToInt (banker's rounding).
export function roundToInt(x){const f=Math.floor(x),d=x-f;return d>0.5?f+1:d<0.5?f:(f%2===0?f:f+1);}
// Server ClientVitalsSync.OnHurt / OnRepair: when the server sends Local_HealthChange (offline the browser is the server).
export class VitalsSender{
 constructor(){this.last=null;}
 hurt(health){const h=Math.max(0,health);if(this.last===null||(h===0&&this.last!==0)||roundToInt(this.last)-roundToInt(h)!==0){this.last=health;return true;}return false;}
 repair(health){this.last=health;return true;}
}
// LocalDamageDisplay: bob choice and the two GameFullscreen overlay alphas.
export class LocalDamageDisplay{
 constructor(){this.lastHealthPercent=1;this.lastTakeDamageTime=0;}
 // Returns the HeadBob effect name to add, or null.
 setNewHealthPercent(percent,attacker,time){let bob=null;if(percent<this.lastHealthPercent)bob=this.hurt(percent,attacker,time);this.lastHealthPercent=percent;return bob;}
 hurt(percent,attacker,time){if(percent<0.05)return null;this.lastTakeDamageTime=time;return attacker?.wildlife||attacker?.zombie?'meleeBob':'takeDamageBob';}
 // UpdateFadeValues + GameFullscreen.Overlay.willRender (texture set by the flag, drawn only when alpha > 0).
 overlays(time){let alpha=1-this.lastHealthPercent,flags=0;const pulse=Math.abs(Math.sin(time*6));
  if(this.lastHealthPercent<=0.6&&alpha>0){flags|=1;alpha=(alpha-0.6)*2.5*pulse;}
  const impact=1-Math.min(1,Math.max(0,(time-this.lastTakeDamageTime)/0.5));if(impact>0)flags|=2;
  return {flags,damage:(flags&1)&&alpha>0?alpha:0,impact:(flags&2)&&impact>0?impact:0,pulse};}
}
// worldDamageDirection: Character attackers use the eyes difference, other objects origin - attacker position.
export function damageDirection(victim,attacker){const a=attacker.eyes??attacker.position,v=attacker.eyes?victim.eyes:victim.origin;return [v[0]-a[0],v[1]-a[1],v[2]-a[2]];}

// NGUI widget quad(s) in widget-local units: geometry x 0..1, y -1..0 plus the pivot offset, then the local scale/position.
const PIVOT=[[0,0],[-0.5,0],[-1,0],[0,0.5],[-0.5,0.5],[-1,0.5],[0,1],[-0.5,1],[-1,1]];
export function widgetQuads(widget){const [ox,oy]=PIVOT[widget.pivot]??[0,0],sx=widget.scale.x,sy=widget.scale.y,px=widget.position.x,py=widget.position.y;
 const P=(x,y)=>[(x+ox)*sx+px,(y+oy)*sy+py];
 // UITexture.OnFill: quads a,b,c,d with their (u,v).
 const q=widget.mirrorY?[[[1,-0.5,1,0],[1,-1,1,1],[0,-1,0,1],[0,-0.5,0,0]],[[1,0,1,1],[1,-0.5,1,0],[0,-0.5,0,0],[0,0,0,1]]]:[[[1,0,1,1],[1,-1,1,0],[0,-1,0,0],[0,0,0,1]]];
 if(widget.mirrorX)throw Error('mirrorX widgets are not used by these prefabs');
 return q.map(quad=>quad.map(([x,y,u,v])=>({p:P(x,y),uv:[u,v]})));}
function quadGeometry(quads){const pos=[],uv=[],index=[];for(const quad of quads){const o=pos.length/3;for(const v of quad){pos.push(v.p[0],v.p[1],0);uv.push(...v.uv);}index.push(o,o+1,o+2,o,o+2,o+3);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);return g;}

const UI_VERTEX='varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
const HIT_FRAGMENT='uniform sampler2D map;uniform vec4 color;uniform float alphaValue;varying vec2 vUv;void main(){vec4 t=texture2D(map,vUv);'+
 'float a=max(1.0-t.a*color.a,alphaValue);gl_FragColor=vec4(t.rgb*color.rgb,(1.0-a)/(1.0-alphaValue)*alphaValue);}';
const ARC_FRAGMENT='uniform sampler2D map;uniform vec4 color,minC,maxC;varying vec2 vUv;void main(){vec4 t=texture2D(map,vUv);'+
 'vec3 inside=step(minC.xyz,t.xyz)*step(t.xyz,maxC.xyz);vec3 n=(t.xyz-minC.xyz)/(maxC.xyz-minC.xyz)*maxC.w;n=mix(n,vec3(0.0),inside);'+
 'float any=max(max(inside.x,inside.y),inside.z);float v=clamp(max(max(n.x,n.y),n.z)-minC.w+any,0.0,1.0);gl_FragColor=vec4(color.rgb,color.a*v*t.a*maxC.w);}';
const OVERLAY_FRAGMENT='uniform sampler2D src,overlay0,overlay1;uniform float blend0,blend1;uniform vec3 lum;varying vec2 vUv;'+
 'vec3 pass3(vec3 c,vec4 o,float b){return c+b*o.a*(o.rgb*dot(c,lum)-c);}'+
 'void main(){vec3 c=texture2D(src,vUv).rgb;if(blend0>0.0)c=clamp(pass3(c,texture2D(overlay0,vUv),blend0),0.0,1.0);if(blend1>0.0)c=clamp(pass3(c,texture2D(overlay1,vUv),blend1),0.0,1.0);gl_FragColor=vec4(c,1.0);}';

// manifest: feedback/manifest.json; base: its URL directory. Options: {clock() seconds, rng, enabled() (gfx.damage),
// playLocal(url) (2D, Play(1) on the camera)}.
export async function createCombatFeedback(renderer,manifest,base,{clock=()=>performance.now()/1000,rng=Math.random,enabled=()=>true,playLocal=()=>{}}={}){
 const loader=new THREE.TextureLoader(),load=file=>loader.loadAsync(base+file).then(t=>{t.colorSpace=THREE.NoColorSpace;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.needsUpdate=true;return t;});
 const H=manifest.hitIndicator,D=manifest.directionalDamage,O=manifest.overlay;
 const [hitTexture,arcTexture,overlay0,overlay1]=await Promise.all([load(H.widget.material.texture),load(D.widget.material.texture),load(O.damageOverlay.file),load(O.damageOverlay2.file)]);
 const hudScene=new THREE.Scene(),hudCamera=new THREE.OrthographicCamera(-1,1,1,-1,-10,10),quadCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 const hitGeometry=quadGeometry(widgetQuads(H.widget)),arcGeometry=quadGeometry(widgetQuads(D.widget)),c=v=>new THREE.Vector4(v.r,v.g,v.b,v.a);
 const uiMaterial=(fragmentShader,uniforms)=>new THREE.ShaderMaterial({uniforms,vertexShader:UI_VERTEX,fragmentShader,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor,toneMapped:false});
 const L=O.gameFullscreen.luminance;let copy=null;
 const overlayMaterial=new THREE.ShaderMaterial({uniforms:{src:{value:null},overlay0:{value:overlay0},overlay1:{value:overlay1},blend0:{value:0},blend1:{value:0},lum:{value:new THREE.Vector3(L[0],L[1],L[2])}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:OVERLAY_FRAGMENT,depthTest:false,depthWrite:false,blending:THREE.NoBlending,toneMapped:false});
 const overlayScene=new THREE.Scene(),overlayQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),overlayMaterial);overlayQuad.frustumCulled=false;overlayScene.add(overlayQuad);
 const hits=[],arcs=[];let display=new LocalDamageDisplay(),vitals=new ClientVitals(),stepTime=clock(),lastOverlay={flags:0,damage:0,impact:0,drawn:false},counts={hitSounds:0,hitsCreated:0,arcsCreated:0,overlayFrames:0};
 let lastHealth=null,lastArc=null,lastHit=null,size=new THREE.Vector2(1,1),stepCamera=null,chained=false;
 const api={
  // PlayHitNotification(point, shooter): sound + indicator. `point` browser world; follow = !shooter || !aiming.
  hitNotification(point,{follow=true,sound=true}={}){if(sound&&manifest.sounds.hitnotification){playLocal(base+manifest.sounds.hitnotification);counts.hitSounds++;}
   const material=uiMaterial(HIT_FRAGMENT,{map:{value:hitTexture},color:{value:c(H.widget.color)},alphaValue:{value:H.widget.material.floats._AlphaValue??1}});
   const mesh=new THREE.Mesh(hitGeometry,material);mesh.frustumCulled=false;mesh.renderOrder=2;hudScene.add(mesh);
   const h={mesh,start:clock(),world:new THREE.Vector3().copy(point),follow,screen:null};hits.push(h);counts.hitsCreated++;lastHit={point:point.toArray?point.toArray():[...point],follow,time:h.start};return h;},
  // HUDDirectionalDamage.CreateIndicator(worldDamageDirection, amount, NetCull.time, 1.6): worldDirection = -damageDirection.
  directional(worldDamageDirection,amount){const state=new DirectionalDamage(rng,{damageTime:clock(),worldDirection:worldDamageDirection.map(v=>-v),amount});
   const material=uiMaterial(ARC_FRAGMENT,{map:{value:arcTexture},color:{value:c(D.widget.color)},minC:{value:new THREE.Vector4()},maxC:{value:new THREE.Vector4()}});
   const group=new THREE.Group(),mesh=new THREE.Mesh(arcGeometry,material);mesh.frustumCulled=false;mesh.renderOrder=1;group.add(mesh);hudScene.add(group);
   const a={state,group,material};arcs.push(a);counts.arcsCreated++;lastArc={direction:state.worldDirection,amount,time:state.damageTime};return a;},
  // ClientVitalsSync.ClientHealthChange for the local character. attacker: null (unassigned), {self:true}, or
  // {eyes|position:[x,y,z] browser world, wildlife?:bool}. victim: {eyes, origin} browser world. Returns the bob name or null.
  healthChange(amount,attacker,victim){const r=vitals.change(amount);let bob=null;
   if(r.display)bob=display.setNewHealthPercent(r.fraction,attacker,clock());
   let direction=null;if(attacker&&r.indicator){direction=attacker.self?[0,0,0]:damageDirection(victim,attacker);this.directional(direction,amount);}
   lastHealth={...r,bob,direction,attacker:attacker?(attacker.self?'self':attacker.wildlife?'wildlife':'other'):null};return bob;},
  // A new local character (spawn): new ClientVitalsSync/LocalDamageDisplay; HUD indicators are not owned by it.
  reset(maxHealth=100){vitals=new ClientVitals(maxHealth);display=new LocalDamageDisplay();},
  // HUDIndicator.Step + LocalDamageDisplay.LateUpdate. `active`: the local character exists (LocalDamageDisplay enabled).
  frame(camera,active=true){stepTime=clock();renderer.getSize(size);const W=size.x,Ht=size.y;
   hudCamera.left=-W/2;hudCamera.right=W/2;hudCamera.top=Ht/2;hudCamera.bottom=-Ht/2;hudCamera.updateProjectionMatrix();
   camera.updateMatrixWorld();const view=camera.matrixWorldInverse;stepCamera=camera.quaternion.toArray();
   for(let i=hits.length-1;i>=0;i--){const h=hits[i],alpha=hitIndicatorAlpha(H.curve,stepTime-h.start,H.alphaClamp);
    if(alpha===null){hudScene.remove(h.mesh);h.mesh.material.dispose();hits.splice(i,1);continue;}
    h.mesh.material.uniforms.alphaValue.value=alpha;h.alpha=alpha;
    if(h.follow||!h.screen){const p=h.world.clone().project(camera);h.screen=[p.x*W/2,p.y*Ht/2];}
    h.mesh.position.set(h.screen[0],h.screen[1],0);}
   const scale=Ht/D.manualHeight;
   for(let i=arcs.length-1;i>=0;i--){const a=arcs[i],ch=a.state.channels(stepTime);
    if(!ch){hudScene.remove(a.group);a.material.dispose();arcs.splice(i,1);continue;}
    a.material.uniforms.minC.value.fromArray(ch.min);a.material.uniforms.maxC.value.fromArray(ch.max);a.channels=ch;
    const angle=directionalAngle(a.state.worldDirection,view);if(angle!==null)a.state.angle=angle;
    a.group.rotation.z=a.state.angle*Math.PI/180;a.group.scale.setScalar(scale);}
   const o=active&&enabled()?display.overlays(stepTime):{flags:0,damage:0,impact:0};lastOverlay={...o,drawn:o.damage>0||o.impact>0};
   overlayMaterial.uniforms.blend0.value=o.damage;overlayMaterial.uniforms.blend1.value=o.impact;},
  // GameFullscreen at its Scene Camera position (after TOD_SunShafts, AntialiasingAsPostEffect, NoiseAndGrain, Bloom) inside
  // the image-effect chain (browser/post-chain.mjs setFullscreenEffect); once taken, render() no longer copies the frame.
  fullscreenEffect(){chained=true;return {active:()=>lastOverlay.drawn,render:(r,input,output,pass)=>{overlayMaterial.uniforms.src.value=input;pass(overlayMaterial,output);counts.overlayFrames++;}};},
  // After the frame: GameFullscreen (main camera image effect, unless chained) then the NGUI indicator layer.
  render(){const autoClear=renderer.autoClear;
   try{renderer.autoClear=false;
    if(lastOverlay.drawn&&!chained){const s=renderer.getDrawingBufferSize(new THREE.Vector2());
     if(!copy||copy.image.width!==s.x||copy.image.height!==s.y){copy?.dispose();copy=new THREE.FramebufferTexture(s.x,s.y);}overlayMaterial.uniforms.src.value=copy;
     renderer.setRenderTarget(null);renderer.copyFramebufferToTexture(copy);renderer.render(overlayScene,quadCamera);counts.overlayFrames++;}
    if(hits.length||arcs.length){renderer.setRenderTarget(null);renderer.render(hudScene,hudCamera);}}
   finally{renderer.autoClear=autoClear;}},
  state(){return {hits:hits.map(h=>({age:stepTime-h.start,alpha:h.alpha??null,screen:h.screen,follow:h.follow})),arcs:arcs.map(a=>({angle:a.state.angle,age:stepTime-a.state.damageTime,direction:a.state.worldDirection,channels:a.channels??null})),
   camera:stepCamera,overlay:{...lastOverlay,lastHealthPercent:display.lastHealthPercent,lastTakeDamageTime:display.lastTakeDamageTime},clientHealth:vitals.health,lastHealth,lastArc,lastHit,...counts};}};
 return api;
}
