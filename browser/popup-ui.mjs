import {loadFrontendSkin} from './frontend-skin.mjs';
// Original HUD inventory popup: PopupUI.CreateInventory -> PopupInventory.Setup(1.5s, "N x Item").
// Driven by the client console command notice.inventory (notice.inventory(), Rust.Notice.Inventory); the server sends it
// from ResourceTarget.DoGather and MeleeWeaponDataBlock (tree wood) only. Layout, colours and dfTweenVector3 curves come from
// the static PopupUI prefab export (tools/export_popup.py); fonts/atlas sprites come from the frontend export.

// dfControl colours are serialized as a packed Color32 (r in the low byte).
export function color32(rgba){const v=rgba>>>0;return {r:v&255,g:(v>>>8)&255,b:(v>>>16)&255,a:(v>>>24)/255};}
export const cssColor=c=>`rgba(${c.r},${c.g},${c.b},${+c.a.toFixed(4)})`;

// UnityEngine.AnimationCurve.Evaluate: cubic Hermite between keys using the stored slopes; serialized
// pre/post infinity 2 is clamp.
export function evaluateCurve(keys,t){if(!keys?.length)return t;if(t<=keys[0].time)return keys[0].value;const last=keys[keys.length-1];if(t>=last.time)return last.value;
 let i=0;while(t>keys[i+1].time)i++;const a=keys[i],b=keys[i+1],dt=b.time-a.time;if(dt<=0)return b.value;const s=(t-a.time)/dt,s2=s*s,s3=s2*s;
 return (2*s3-3*s2+1)*a.value+(s3-2*s2+s)*a.outSlope*dt+(-2*s3+3*s2)*b.value+(s3-s2)*b.inSlope*dt;}

// dfTweenComponent<Vector3>.Execute with Linear easing, offset start/end values and Once looping.
export function tweenAt(tween,base,elapsed){const length=tween.length;const start=tween.startValueIsOffset?add(tween.startValue,base):tween.startValue,end=tween.endValueIsOffset?add(tween.endValue,base):tween.endValue;
 if(elapsed>=length)return {...end};const time=evaluateCurve(tween.animCurve?.m_Curve,Math.max(0,elapsed)/length);return {x:start.x+(end.x-start.x)*time,y:start.y+(end.y-start.y)*time,z:start.z+(end.z-start.z)*time};}
const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:(a.z??0)+(b.z??0)});

// Pull the fields PopupInventory uses out of the exported prefab.
export function inventoryPrefab(prefab){const nodes=prefab.nodes,root=nodes[0].components,popup=root.PopupInventory[0],tweens=root.dfTweenVector3;
 const byId=id=>nodes.flatMap(n=>Object.values(n.components).flat()).find(c=>c.id===id);const label=byId(popup.labelTextKey),panel=root.dfPanel[0];
 const icon=nodes.flatMap(n=>n.components.dfRichTextLabel??[]).find(c=>c!==label),background=nodes.flatMap(n=>n.components.dfSprite??[])[0];
 const out=tweens.find(t=>t.id===popup.tweenOutKey),moveIn=tweens.find(t=>t!==out&&t.autoRun);
 const rect=c=>({x:c.layout.margins.left,y:c.layout.margins.top,width:c.size.x,height:c.size.y});
 return {seconds:1.5,height:panel.size.y,background:{color:color32(background.color.rgba),sprite:background.spriteName,atlasKey:background.atlasKey},
  icon:{...rect(icon),text:icon.text,fontKey:icon.fontKey,fontSize:icon.fontSize,color:color32(icon.color.rgba),align:icon.align},
  label:{...rect(label),fontKey:label.fontKey,fontSize:label.fontSize,color:color32(label.color.rgba)},moveIn,moveOut:out};}

// PopupInventory.Setup: width from the measured text, entry just past the right edge at ~70% height, six cycling rows,
// randomised exit direction. `range(min,max)` is UnityEngine.Random.Range(float,float); call order matches the source.
export function setupInventoryPopup(p,{parentWidth,parentHeight,textWidth,row,range}){const labelWidth=textWidth+16,width=p.label.x+labelWidth+8;
 const x=parentWidth+range(-16,16);let y=parentHeight*0.7+range(-16,16);y+=(row/6-0.5)*parentHeight*0.2;
 const outEndY=range(-100,100);return {x,y,width,labelWidth,nextRow:row+1>5?0:row+1,moveOut:{...p.moveOut,endValue:{...p.moveOut.endValue,y:outEndY}}};}

// PopupNotice.Setup (PopupUI.CreateNotice): the label is the measured text + 16 wide, the panel label x + label + 8;
// it enters centred above the PopupUI panel (x +-32, y = -height +-32, Random.Range in that order), MoveIn auto-runs (to
// +200 y), PlayOut after fSeconds plays MoveOut and the popup is destroyed after its length.
export function setupNoticePopup({labelX,height},{parentWidth,textWidth,range}){const labelWidth=textWidth+16,width=labelX+labelWidth+8;
 return {x:(parentWidth-width)/2+range(-32,32),y:height*-1+range(-32,32),width,labelWidth};}
export function noticePosition({moveIn,moveOut},setup,seconds,elapsed){const placed={x:setup.x,y:setup.y,z:0},shown=moveIn?tweenAt(moveIn,placed,elapsed):placed;
 if(elapsed<seconds||!moveOut)return {...shown,done:false};const held=moveIn?tweenAt(moveIn,placed,seconds):placed,t=elapsed-seconds;return {...tweenAt(moveOut,held,t),done:t>=moveOut.length};}

// Position of one popup `elapsed` seconds after creation: MoveIn auto-runs, then PlayOut after `seconds`, destroyed after MoveOut.length.
export function popupPosition(p,setup,elapsed){const placed={x:setup.x,y:setup.y,z:0};const shown=tweenAt(p.moveIn,placed,elapsed);
 if(elapsed<p.seconds)return {...shown,done:false};const held=tweenAt(p.moveIn,placed,p.seconds),t=elapsed-p.seconds;return {...tweenAt(setup.moveOut,held,t),done:t>=setup.moveOut.length};}

// Browser safety caps (the original keeps every popup until its tweens end): a server can send notice.popup with any
// duration and as often as it likes, so live popups of each kind are capped (the oldest goes first) and the hold time is
// clamped. Far more than a screen shows at once; the original's own sources use 1.5-10 s.
export const MAX_LIVE_POPUPS=24,MAX_NOTICE_SECONDS=60;
export const noticeSeconds=v=>{const n=Number(v);return Number.isFinite(n)?Math.min(MAX_NOTICE_SECONDS,Math.max(0,n)):0;};
// Drop the oldest entries of an insertion-ordered Set until one more fits under the cap.
export function capLive(set,max,dispose){while(set.size>=max){const oldest=set.values().next().value;set.delete(oldest);dispose(oldest);}}
export async function createPopupUI({document=globalThis.document,base='/assets/recovered/popup/',skin=loadFrontendSkin(),now=()=>performance.now()/1000,random=Math.random}={}){
 const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original PopupUI export missing');const manifest=await response.json(),p=inventoryPrefab(manifest.inventory),frontend=(await skin).manifest;
 const fontName=key=>frontend.fonts[key]?.name??'sans-serif';
 const layer=document.createElement('div');layer.id='popup-ui';layer.setAttribute('role','status');layer.setAttribute('aria-live','polite');document.body.append(layer);
 const measure=document.createElement('canvas').getContext('2d'),labelFont=`${p.label.fontSize}px "${fontName(p.label.fontKey)}"`;
 const range=(min,max)=>min+random()*(max-min),live=new Set();let row=0,frame=0;
 const tick=()=>{frame=0;const t=now();for(const item of live){const pos=popupPosition(p,item.setup,t-item.start);if(pos.done){item.el.remove();live.delete(item);continue;}item.el.style.transform=`translate(${pos.x}px,${pos.y}px)`;}if(live.size)frame=requestAnimationFrame(tick);};
 function inventory(text){measure.font=labelFont;const parent=layer.getBoundingClientRect(),setup=setupInventoryPopup(p,{parentWidth:parent.width,parentHeight:parent.height,textWidth:measure.measureText(text).width,row,range});row=setup.nextRow;
  const el=document.createElement('div');el.className='popup-inventory';el.style.width=setup.width+'px';el.style.height=p.height+'px';
  // Background dfSprite uses the solid white BLANK_TEXTURE atlas cell, so it renders as its tint colour.
  const bg=document.createElement('i');bg.className='popup-background';bg.style.backgroundColor=cssColor(p.background.color);
  const icon=document.createElement('b');icon.className='popup-icon';icon.setAttribute('aria-hidden','true');icon.textContent=p.icon.text;Object.assign(icon.style,{left:p.icon.x+'px',top:p.icon.y+'px',width:p.icon.width+'px',height:p.icon.height+'px',font:`${p.icon.fontSize}px "${fontName(p.icon.fontKey)}"`,lineHeight:p.icon.height+'px',color:cssColor(p.icon.color),textAlign:p.icon.align===2?'center':p.icon.align===1?'right':'left'});
  const label=document.createElement('span');label.className='popup-label';label.textContent=text;Object.assign(label.style,{left:p.label.x+'px',top:p.label.y+'px',width:setup.labelWidth+'px',height:p.label.height+'px',font:labelFont,lineHeight:p.label.height+'px',color:cssColor(p.label.color)});
  el.append(bg,icon,label);layer.append(el);const item={el,setup,start:now()};capLive(live,MAX_LIVE_POPUPS,i=>i.el.remove());live.add(item);el.style.transform=`translate(${setup.x}px,${setup.y}px)`;if(!frame)frame=requestAnimationFrame(tick);return el;}
 // PopupUI.CreateNotice(fSeconds, strIcon, strText): the original PopupNotice prefab drawn by the dfGUI renderer.
 const {createDfTree,loadDfAssets}=await import('./dfgui.mjs'),assets=await loadDfAssets(skin),noticePrefab=manifest.notice,notices=new Set();layer.classList.add('df-host');
 const noticeTick=()=>{const t=now();for(const n of notices){const pos=noticePosition(n,n.setup,n.seconds,t-n.start);if(pos.done){n.tree.dispose();notices.delete(n);continue;}n.panel.position={x:pos.x,y:pos.y};n.tree.layout(viewport());}if(notices.size)requestAnimationFrame(noticeTick);};
 const viewport=()=>{const r=layer.getBoundingClientRect();return {width:r.width,height:r.height};};
 function notice(seconds,icon,text){if(!noticePrefab)return null;const tree=createDfTree(noticePrefab.nodes,assets,{container:layer,className:'df-instance popup-notice',viewport}),panel=tree.items[0],label=tree.find('Rich Text Label'),iconLabel=tree.find('Icon');
  const ld=label.control.data,font=assets.fonts[ld.fontKey];measure.font=`${ld.fontSize}px "${font?.name}"`;
  const setup=setupNoticePopup({labelX:ld.layout.margins.left,height:panel.control.data.size.y},{parentWidth:viewport().width,textWidth:measure.measureText(String(text)).width,range});
  label.size={x:setup.labelWidth,y:ld.size.y};panel.size={x:setup.width,y:panel.control.data.size.y};panel.position={x:setup.x,y:setup.y};tree.setText(iconLabel,icon??'');tree.setText(label,String(text));tree.root.dataset.text=String(text);
  const tweens=panel.node.components.dfTweenVector3??[],n={tree,panel,setup,seconds:noticeSeconds(seconds),start:now(),moveIn:tweens.find(t=>t.tweenName==='MoveIn'),moveOut:tweens.find(t=>t.tweenName==='MoveOut')};
  tree.layout(viewport());capLive(notices,MAX_LIVE_POPUPS,o=>o.tree.dispose());const first=!notices.size;notices.add(n);if(first)requestAnimationFrame(noticeTick);return tree.root;}
 return {inventory,notice,layer,live:()=>live.size+notices.size,notices:()=>[...notices].map(n=>n.tree.root.dataset.text)};
}
