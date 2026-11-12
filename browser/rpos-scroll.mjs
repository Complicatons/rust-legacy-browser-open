// RPOS list scrolling (tools/export_rpos.py `scrolling`): NGUI UIDraggablePanel + UIScrollBar on the crafting blueprint list
// and the loot window. Both: scale (0,1,0), scrollWheelFactor −0.08, momentumAmount 35, dragEffect None,
// restrictWithinPanel off but restrictWithinPanelWithScroll on, HardClip, showScrollBars OnlyIfNeeded, and no
// UIDragPanelContents under them, so the wheel and the scroll bar are the only ways to scroll (no dragging the contents).
// Positions here are y-down pixels: `offset` is how far the contents have moved up (NGUI localPosition.y), and content
// `top`/`bottom` are measured from the clip top at offset 0.

// NGUIMath.SpringLerp / SpringDampen: per-millisecond steps.
export function springLerp(from,to,strength,dt){const n=Math.round(dt*1000),t=0.001*strength;for(let i=0;i<n;i++)from+=(to-from)*t;return from;}
export function springDampen(velocity,strength,dt){if(velocity===0)return {offset:0,velocity:0};const k=1-strength*0.001,n=Math.round(dt*1000);let offset=0;
 for(let i=0;i<n;i++){offset+=velocity*0.06;velocity*=k;}return {offset,velocity};}
// Mathf.Sign: 1 for zero.
const sign=v=>v>=0?1:-1,clamp01=v=>Math.min(1,Math.max(0,v)),lerp=(a,b,t)=>a+(b-a)*clamp01(t);
// UIPanel.CalculateConstrainOffset (HardClip: no softness) → NGUIMath.ConstrainRect, vertical only: content taller than the
// clip may sit anywhere that keeps the clip covered; shorter content must stay inside the clip (so it can be scrolled down
// inside it). Returns the change to `offset`.
export function constrainOffset({top,bottom},offset,clipHeight){const minRect=offset-bottom,maxRect=offset-top;let minArea=-clipHeight,maxArea=0,v=0;
 const h=maxRect-minRect;if(h>clipHeight){minArea-=h-clipHeight;maxArea+=h-clipHeight;}
 if(minRect<minArea)v+=minArea-minRect;if(maxRect>maxArea)v-=maxRect-maxArea;return v;}
// UIDraggablePanel.UpdateScrollbars (vertical) → UIScrollBar barSize/scrollValue.
export function scrollBarState({top,bottom},offset,clipHeight){const size=bottom-top;if(!(size>0))return null;
 const below=clamp01((bottom-offset-clipHeight)/size),above=clamp01((offset-top)/size),hidden=below+above;
 return {barSize:clamp01(1-hidden),scrollValue:hidden>0.001?clamp01(1-below/hidden):0};}
// UIScrollBar.ForceUpdate, vertical, sprites without borders ("black"/"white"): the foreground hangs from the top (pivot
// Top), barSize of the background long, moved down by the unused length × scrollValue; MakePixelPerfect rounds it off the ends.
export function thumbRect({barSize,scrollValue},length){const h=length*clamp01(barSize),y=(length-h)*clamp01(scrollValue),inner=scrollValue>0.001&&scrollValue<0.999;
 return inner?{top:Math.round(y),height:Math.round(h)}:{top:y,height:h};}
// UIScrollBar.CenterOnPos (vertical): the scroll value that puts the foreground's centre at `y` (px from the bar's top).
export function barValueAt(y,{barSize},length){const fg=length*clamp01(barSize),free=length-fg;return free>0?clamp01((y-fg/2)/free):0;}
// UIDraggablePanel.SetDragAmount (vertical): the offset for a scroll value: 0 = content top at the clip top, 1 = content
// bottom at the clip bottom.
export const dragAmountOffset=({top,bottom},value,clipHeight)=>lerp(top,bottom-clipHeight,value);
// Unity's ScrollWheel Event.delta.y (UICamera scrollWheelMode UseEvents): 3 per wheel notch on Windows, positive downwards.
export function wheelDelta(e){return e.deltaMode===1?e.deltaY:e.deltaMode===2?e.deltaY*3:e.deltaY*3/100;}

// One panel's state. unitPixels: UI pixels per world unit, Screen.height / 2 under UIRoot automatic (scale 2 / height);
// UIDraggablePanel.MoveAbsolute converts the world-space momentum into panel pixels with it.
export function createDraggablePanel(config){
 const scaleY=config.scale?.y??1,factor=config.scrollWheelFactor,show=config.showScrollBars,restrict=(config.restrictWithinPanel||config.restrictWithinPanelWithScroll)&&config.panel?.clipping!=='None';
 const clipHeight=config.panel.clipRange.w;let offset=0,momentum=0,scroll=0,alpha=null;
 const move=(d,bounds)=>{offset+=d;if(restrict){const c=constrainOffset(bounds,offset,clipHeight);if(Math.abs(c)>0.001){offset+=c;momentum=0;scroll=0;return true;}}return false;};
 return {
  clipHeight,get offset(){return offset;},get momentum(){return momentum;},get alpha(){return alpha??0;},
  // UIDraggablePanel.Scroll (via OnHoverScroll): the accumulator resets whenever its sign differs from the new delta's.
  wheel(delta){if(sign(scroll)!==sign(delta))scroll=0;scroll+=delta*factor;},
  // UIDraggablePanel.LateUpdate with the panel enabled; dt in seconds (IgnoreTimeScale, whole milliseconds).
  frame(dt,bounds,unitPixels){const needed=bounds.bottom-bounds.top>clipHeight;
   // Start: alpha 1 when needed (or Always), else 0; then OnlyIfNeeded fades in at 6/s and out at 3/s.
   if(alpha===null)alpha=show==='Always'||needed?1:0;else if(show!=='Always')alpha=clamp01(alpha+(show==='WhenDragging'||!needed?-dt*3:dt*6));
   momentum+=scaleY*(-scroll*0.05);
   if(Math.abs(momentum)>0.0001){scroll=springLerp(scroll,0,20,dt);const d=springDampen(momentum,9,dt);momentum=d.velocity;move(d.offset*unitPixels,bounds);return;}
   scroll=0;momentum=springDampen(momentum,9,dt).velocity;},
  // The scroll bar moved (OnVerticalBar → SetDragAmount); no restriction is applied, as in the original.
  setValue(value,bounds){offset=dragAmountOffset(bounds,value,clipHeight);},
  bar(bounds){return scrollBarState(bounds,offset,clipHeight);},
  // Panel disabled (window hidden): LateUpdate drops the momentum.
  hidden(){momentum=0;},
 };
}

// DOM binding for one list. list: the clip element (its children are the panel contents, moved with a CSS translate);
// hotSpots: the selector of the children that are NGUI hot spots (the wheel only reaches the panel through a hovered hot
// spot); bar: {left, top, length} of the scroll bar in the window, from the export.
// active(): false while the port reuses the list for a window without this panel (the fire and repair layouts of #loot).
export function attachRposScroll({list,config,hotSpots,active=()=>true,document=globalThis.document,height=()=>globalThis.innerHeight}){
 const panel=createDraggablePanel(config),sb=config.verticalScrollBar,bg=sb?.background,fg=sb?.foreground,length=bg?.scale.y??config.panel.clipRange.w;
 list.classList.add('rpos-scrolled');list.style.setProperty('--rpos-scroll','0px');
 const track=document.createElement('div');track.className='rpos-scroll-bar';track.setAttribute('aria-hidden','true');const thumb=document.createElement('div');thumb.className='rpos-scroll-thumb';track.append(thumb);
 const rgb=c=>`rgb(${c.slice(0,3).map(v=>Math.round(v*255)).join(' ')})`;
 // Sprite × colour: "black" stays black, "white" takes the colour; widget alpha is the bar's alpha.
 if(bg)track.style.backgroundColor=bg.sprite==='black'?'#000':rgb(bg.color);if(fg)thumb.style.backgroundColor=fg.sprite==='black'?'#000':rgb(fg.color);
 track.style.width=(bg?.scale.x??6)+'px';track.style.height=length+'px';
 const bounds=()=>{const kids=[...list.children];if(!kids.length)return {top:0,bottom:0};let top=Infinity,bottom=-Infinity;
  for(const k of kids){if(k.offsetParent===null&&getComputedStyle(k).display==='none')continue;top=Math.min(top,k.offsetTop);bottom=Math.max(bottom,k.offsetTop+k.offsetHeight);}
  return Number.isFinite(top)?{top,bottom}:{top:0,bottom:0};};
 let last=null,acc=0,cached={top:0,bottom:0};
 // The contents move only by --rpos-scroll; a native scroll of the clip (focus, scrollIntoView) is undone.
 function paint(b){list.style.setProperty('--rpos-scroll',panel.offset+'px');if(list.scrollTop)list.scrollTop=0;const s=panel.bar(b)??{barSize:1,scrollValue:0},t=thumbRect(s,length);
  thumb.style.top=t.top+'px';thumb.style.height=t.height+'px';track.style.opacity=String(panel.alpha);track.style.visibility=panel.alpha>0?'visible':'hidden';}
 list.addEventListener('wheel',e=>{e.preventDefault();const spot=e.target?.closest?.(hotSpots);if(!spot||!list.contains(spot))return;panel.wheel(wheelDelta(e));},{passive:false});
 // UIScrollBar: pressing or dragging the background centres the foreground on the pointer; dragging the foreground moves
 // it by the pointer's total movement from where it was grabbed.
 const valueAt=y=>barValueAt(y-track.getBoundingClientRect().top,panel.bar(cached)??{barSize:1},length);
 track.addEventListener('pointerdown',e=>{if(e.button!==0||panel.alpha<=0)return;e.preventDefault();e.stopPropagation();track.setPointerCapture?.(e.pointerId);const onThumb=e.target===thumb,b=cached,s=panel.bar(b)??{barSize:1,scrollValue:0},t=thumbRect(s,length);
  const centre=track.getBoundingClientRect().top+t.top+t.height/2,start=e.clientY,set=y=>{panel.setValue(onThumb?valueAt(centre+y-start):valueAt(y),b);paint(b);};if(!onThumb)set(e.clientY);
  const moveTo=ev=>set(ev.clientY),up=()=>{track.removeEventListener('pointermove',moveTo);track.removeEventListener('pointerup',up);track.removeEventListener('pointercancel',up);};
  track.addEventListener('pointermove',moveTo);track.addEventListener('pointerup',up);track.addEventListener('pointercancel',up);});
 return {panel,track,
  // Per frame while the inventory is open (now: ms). A hidden panel returns from LateUpdate before IgnoreTimeScale reads the
  // clock, so its first frame back gets the whole hidden time (the bar's fade completes at once) and no momentum.
  update(now){if(list.offsetParent===null||!active()){panel.hidden();track.style.visibility='hidden';return;}const dtRaw=last===null?0:Math.max(0,(now-last)/1000);last=now;
   acc+=dtRaw;const dt=0.001*Math.round(acc*1000);acc-=dt;cached=bounds();panel.frame(dt,cached,height()/2);paint(cached);},
 };
}
