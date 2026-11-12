import {loadFrontendSkin} from './frontend-skin.mjs';
import {color32,cssColor,evaluateCurve} from './popup-ui.mjs';
import {markupRuns} from './chat.mjs';
// Original GameUI DeathScreen (DeathScreen.cs, deathscreen.reason, DeathTransfer.SetDeathReason). Layout, text, fonts,
// colours, button bindings and FadeIn/FadeOut dfTweenColor32 curves come from the static BuildPlayer-GameUI export
// (tools/export_frontend.py). The GameUI dfGUIManager is pixel perfect (fixedHeight 1080): control sizes are screen
// pixels, only ScreenResolution text scales with Screen.height / 1080.

// Client console variable deathscreen.reason starts as "..." and DeathScreen.Show() clears it after use.
export const DEFAULT_REASON='...';
// Server DeathTransfer.SetDeathReason for a local game. HurtSelf (metabolism, bleeding, drowning, own explosives) passes the
// victim as attacker -> "You killed yourself..."; a non-player Character (wildlife) falls through to the TODO branch with
// UnityEngine.Object.ToString() = "<name>(Clone) (Character)".
export function deathReason(attacker){
 if(attacker?.animal){const name=attacker.animal.def?.name??attacker.animal.key??'Unknown';return `TODO: Handle this death condition ${name}(Clone) (Character)`;}
 if(attacker?.player)return attacker.weapon?`${attacker.player} killed you using a ${attacker.weapon} with a hit to your ${attacker.bodyPart}`:`${attacker.player} killed you with a hit to your ${attacker.bodyPart}`;
 return 'You killed yourself. You silly sod.';
}
// Mathf.RoundToInt (banker's rounding on .5).
export const roundToInt=v=>{const f=Math.floor(v),d=v-f;return d>0.5?f+1:d<0.5?f:(f%2===0?f:f+1);};
// dfControl.AnchorLayout.performLayoutAbsolute (dfAnchorStyle Top 1, Bottom 2, Left 4, Right 8, CenterHorizontal 64, CenterVertical 128).
export function anchorLayout(layout,size,parent){const m=layout.margins,s=layout.anchorStyle;let x=m.left,y=m.top,r=x+size.x,b=y+size.y;
 if(s&64){x=roundToInt((parent.x-size.x)*0.5);r=roundToInt(x+size.x);}else{if(s&4){x=m.left;r=x+size.x;}if(s&8){r=parent.x-m.right;if(!(s&4))x=r-size.x;}}
 if(s&128){y=roundToInt((parent.y-size.y)*0.5);b=roundToInt(y+size.y);}else{if(s&1){y=m.top;b=y+size.y;}if(s&2){b=parent.y-m.bottom;if(!(s&1))y=b-size.y;}}
 return {x,y,width:Math.max(0,r-x),height:Math.max(0,b-y)};}
const control=n=>{for(const kind of ['dfPanel','dfSprite','dfLabel','dfButton']){const c=n.components[kind]?.[0];if(c)return {kind,data:c};}return null;};
// Parent-relative rectangles of every DeathScreen control for a viewport; the root DeathWindow anchors to the screen.
export function deathScreenLayout(nodes,viewport){const rects=new Map();
 nodes.forEach((n,i)=>{const c=control(n);if(!c)return;const parent=n.parent<0?{x:viewport.width,y:viewport.height}:(()=>{const p=rects.get(n.parent);return {x:p.width,y:p.height};})();
  const r=anchorLayout(c.data.layout,c.data.size,parent),p=rects.get(n.parent);rects.set(i,{name:n.name,kind:c.kind,data:c.data,...r,absX:(p?.absX??0)+r.x,absY:(p?.absY??0)+r.y});});
 return rects;}
// dfTweenColor32 with Linear easing: Color32 lerp by the evaluated curve. syncStartWhenRun starts from the current colour.
export function tweenColor(tween,elapsed,current){const start=tween.syncStartWhenRun&&current?current:color32(tween.startValue.rgba),end=color32(tween.endValue.rgba);
 const t=elapsed>=tween.length?1:Math.max(0,evaluateCurve(tween.animCurve?.m_Curve,Math.max(0,elapsed)/tween.length));
 const k=Math.min(1,Math.max(0,t)),mix=(a,b)=>a+(b-a)*k;return {r:Math.round(mix(start.r,end.r)),g:Math.round(mix(start.g,end.g)),b:Math.round(mix(start.b,end.b)),a:mix(start.a,end.a)};}
// dfDynamicFont: pixel size CeilToInt(FontSize * scale), line height Baseline * scale, character spacing * scale.
export function textMetrics(font,textScale,{mode=0,screenHeight=1080,fixedHeight=1080}={}){const scale=textScale*(mode===2?screenHeight/fixedHeight:1);
 return {size:Math.ceil(font.size*scale),lineHeight:font.baseline*scale,scale};}

// lblDescription has processMarkup (frontend manifest): deathscreen.reason goes through dfMarkupTokenizer like chat text.
// Runs carry the markup colour alone (white unless [color]); the label colour (the FadeIn tween's, and the gradient's
// top/bottom) multiplies it when painted. [sprite] runs draw nothing here (no death reason uses one).
export function reasonRuns(text){return markupRuns(String(text??'')).filter(r=>r.kind!=='sprite');}
export const multiplyColor=(a,b)=>({r:Math.trunc(a.r*b.r/255),g:Math.trunc(a.g*b.g/255),b:Math.trunc(a.b*b.b/255),a:a.a*b.a});
const isWhite=c=>c.r===255&&c.g===255&&c.b===255&&c.a===1;
export function createDeathScreen({document=globalThis.document,root=document.querySelector('#death'),skin=loadFrontendSkin(),now=()=>performance.now()/1000}={}){
 let reason=DEFAULT_REASON,screen=null,fonts=null,shownAt=null,outroAt=null,hideTimer=0,frame=0,infoBottom=null,infoTop=null;const colours=new Map();
 const els={background:root.querySelector('.death-background'),title:root.querySelector('.death-title'),youAre:root.querySelector('.death-you-are'),dead:root.querySelector('.death-dead'),info:root.querySelector('.death-info'),buttons:root.querySelector('.death-buttons'),respawn:root.querySelector('#respawn'),camp:root.querySelector('#respawn-camp')};
 const byName={Background:els.background,'You Are Dead':els.title,lblYouAre:els.youAre,lblDead:els.dead,lblInfo:els.info,Buttons:els.buttons,btnRespawn:els.respawn,btnAtCamp:els.camp};
 skin.then(s=>{const nodes=s.manifest.screens.DeathScreen?.nodes;if(!nodes)return;screen=nodes;fonts=s.manifest.fonts;root.dataset.assets='original';apply();}).catch(e=>console.warn('Original death screen unavailable:',e.message));
 const fontOf=data=>fonts?.[data.fontKey];
 function apply(){if(!screen)return;const W=innerWidth,H=innerHeight,rects=deathScreenLayout(screen,{width:W,height:H});
  for(const [i,r]of rects){const el=byName[r.name];if(!el)continue;const d=r.data,top=el.parentElement===root;Object.assign(el.style,{left:(top?r.absX:r.x)+'px',top:(top?r.absY:r.y)+'px',width:r.width+'px',height:r.height+'px'});
   if(r.kind==='dfLabel'||r.kind==='dfButton'){const font=fontOf(d);if(font){const m=textMetrics(font,d.textScale,{mode:d.textScaleMode,screenHeight:H});
     Object.assign(el.style,{fontFamily:`"${font.name}"`,fontSize:m.size+'px',lineHeight:m.lineHeight+'px',letterSpacing:(d.charSpacing??0)*m.scale+'px'});}
    // UnityEngine.TextAlignment Left 0, Center 1, Right 2.
    const align=r.kind==='dfButton'?d.textAlign:d.align;el.style.textAlign=align===1?'center':align===2?'right':'left';}
   if(r.kind==='dfLabel'){const top=color32(d.color.rgba);el.style.color=cssColor(top);
    // enableGradient: dfFont renderers shade each line from Color (top) to BottomColor (bottom).
    if(d.enableGradient&&d.bottomColor.rgba!==d.color.rgba){el.style.backgroundImage=`linear-gradient(${cssColor(top)},${cssColor(color32(d.bottomColor.rgba))})`;el.style.backgroundSize=`100% ${el.style.lineHeight||'100%'}`;el.dataset.bottom=cssColor(color32(d.bottomColor.rgba));el.classList.add('death-gradient');if(el===els.info)infoBottom=color32(d.bottomColor.rgba);}
    if(el===els.info){infoTop=top;paintRuns(top);}
    if(d.padding)el.style.paddingTop=d.padding.m_Top+'px';}
   if(r.kind==='dfButton'){el.style.setProperty('--text',cssColor(color32(d.textColor.rgba)));el.style.setProperty('--hover',cssColor(color32(d.hoverText.rgba)));el.style.setProperty('--pressed',cssColor(color32(d.pressedText.rgba)));
    // dfVerticalAlignment Middle: one line centred in the button height.
    if(d.vertAlign===1)el.style.lineHeight=r.height+'px';}}
  // lblInfo autoHeight + CenterVertical: re-centre on the grown height inside its Background parent.
  const info=[...rects.values()].find(r=>r.name==='lblInfo'),parent=info&&[...rects.values()].find(r=>r.name==='Background');
  if(info&&parent&&getComputedStyle(root).display!=='none'){els.info.style.height='auto';const h=Math.max(els.info.offsetHeight,0);els.info.style.top=parent.absY+roundToInt((parent.height-h)*0.5)+'px';}
  paintTweens();}
 const tweensOf=name=>{const i=screen?.findIndex(n=>n.name===name);return i>=0?screen[i].components.dfTweenColor32??[]:[];};
 // Background sprite/lblInfo tweens set their own Color; the two panels' Color alpha is the children's opacity.
 function paintTweens(){if(!screen)return;const t=now(),phase=outroAt!==null?'FadeOut':'FadeIn',elapsed=t-(outroAt??shownAt??t);let running=false;
  for(const [name,el]of Object.entries(byName)){const tween=tweensOf(name).find(w=>w.tweenName===phase);if(!tween||!el)continue;const c=tweenColor(tween,elapsed,colours.get(name+':in'));if(phase==='FadeIn')colours.set(name+':in',c);if(elapsed<tween.length)running=true;
   if(name==='Background')el.style.backgroundColor=cssColor(c);else if(name==='lblInfo'){el.style.color=cssColor(c);el.style.opacity='1';
    // The tween sets Color (the gradient's top); BottomColor stays as serialized.
    if(el.dataset.bottom)el.style.backgroundImage=`linear-gradient(${cssColor(c)},${el.dataset.bottom})`;paintRuns(c);}else el.style.opacity=String(+c.a.toFixed(4));}
  if(running)frame||=requestAnimationFrame(()=>{frame=0;paintTweens();});}
 // A [color] run: its colour times the label colour; with the gradient each run shades top to bottom on its own.
 function paintRuns(top){for(const span of els.info.querySelectorAll('.death-run')){const run=span.runColor;if(!run||isWhite(run))continue;const c=multiplyColor(run,top);
  if(infoBottom){Object.assign(span.style,{backgroundImage:`linear-gradient(${cssColor(c)},${cssColor(multiplyColor(run,infoBottom))})`,backgroundSize:els.info.style.backgroundSize,backgroundRepeat:'repeat-y',webkitBackgroundClip:'text',backgroundClip:'text',webkitTextFillColor:'transparent'});}
  else span.style.color=cssColor(c);}}
 function setInfo(text){els.info.replaceChildren(...reasonRuns(text).map(r=>{const span=document.createElement('span');span.className='death-run';span.textContent=r.text;span.runColor=r.color;return span;}));if(infoTop)paintRuns(infoTop);}
 addEventListener('resize',apply);
 function hide(){clearTimeout(hideTimer);hideTimer=0;outroAt=null;shownAt=null;root.classList.remove('death-outro');root.hidden=true;}
 return {
  setReason(text){reason=String(text);},
  // DeathScreen.Show: label = deathscreen.reason, FadeIn tweens, reason cleared; the cursor unlock node turns on.
  show(){clearTimeout(hideTimer);hideTimer=0;outroAt=null;colours.clear();setInfo(reason);reason='';root.hidden=false;root.classList.remove('death-outro');shownAt=now();apply();},
  // RequestRespawn(_InCamp) -> OutroAnimations: FadeOut tweens, cursor lock released, Hide() invoked 5 s later.
  outro(){if(root.hidden||outroAt!==null)return;outroAt=now();root.classList.add('death-outro');paintTweens();hideTimer=setTimeout(hide,5000);},
  hide,isOpen:()=>!root.hidden&&outroAt===null,reason:()=>reason,element:root};
}
