import {color32,cssColor} from './popup-ui.mjs';
import {anchorLayout,tweenColor} from './death-screen.mjs';
// Minimal Daikon Forge (dfGUI) renderer for the statically exported BuildPlayer-GameUI hierarchies (tools/export_frontend.py).
// The GameUI dfGUIManager is pixelPerfectMode=1 (fixedHeight 1080, uiScale 1): GetScreenSize() is the real screen size in
// pixels, so controls keep their serialized pixel sizes and only the dfAnchorStyle layout reacts to the window size
// (dfControl.AnchorLayout.performLayoutAbsolute, ported in death-screen.mjs). Opacity is dfControl.color.a and multiplies
// down the hierarchy (dfControl.CalculateOpacity), which CSS opacity on nested elements reproduces. Sprites are the
// original atlas cells tinted by the control colour (Daikon Forge/Default UI Shader: texture * vertex colour).

// dfDragHandle / dfResizeHandle draw nothing but are dfControls: their children (ConsoleWindow's title label) lay out
// inside them.
const CONTROLS=['dfPanel','dfScrollPanel','dfButton','dfLabel','dfRichTextLabel','dfSlider','dfCheckbox','dfSprite','dfSlicedSprite','dfTextureSprite','dfScrollbar','dfProgressBar','dfTextbox','dfDragHandle','dfResizeHandle'];
export const controlOf=node=>{for(const kind of CONTROLS){const data=node.components[kind]?.[0];if(data)return {kind,data};}return null;};
const rgb=c=>`rgb(${c.r},${c.g},${c.b})`;
// UnityEngine.TextAlignment (dfLabel/dfButton): Left 0, Center 1, Right 2. dfMarkupTextAlign (dfRichTextLabel): Left, Right, Center, Justify.
const labelAlign=a=>a===1?'center':a===2?'right':'left',richAlign=a=>a===1?'right':a===2?'center':a===3?'justify':'left';
// dfVerticalAlignment Top 0, Middle 1, Bottom 2.
const vertical=a=>a===1?'center':a===2?'flex-end':'flex-start';

const images=new Map();
function image(url){if(!images.has(url)){const img=new Image();img.src=url;images.set(url,img.decode().then(()=>img));}return images.get(url);}

// Loads every atlas sprite and bitmap font page once so drawing is synchronous.
export async function loadDfAssets(skin){const s=await skin,sprites=new Map(),manifest=s.manifest;
 // Every atlas image is requested at once (image() shares pending loads); the maps are filled in export order below.
 for(const atlas of Object.values(manifest.atlases))for(const sprite of Object.values(atlas.sprites))image(s.base+sprite.file).catch(()=>{});
 for(const atlas of Object.values(manifest.atlases))for(const [name,sprite] of Object.entries(atlas.sprites))sprites.set(name,{...sprite,image:await image(s.base+sprite.file)});
 const bitmaps=new Map();for(const [key,font] of Object.entries(manifest.fonts))if(font.kind==='bitmap'){const sprite=manifest.atlases[font.atlas].sprites[font.sprite];bitmaps.set(key,{font,image:await image(s.base+sprite.file),glyphs:new Map(font.glyphs.map(g=>[g.id,g])),kerning:new Map((font.kerning??[]).map(k=>[k.first+','+k.second,k.amount]))});}
 return {skin:s,manifest,sprites,bitmaps,fonts:manifest.fonts,texture:file=>image(s.base+file)};}

// Nine-slice (dfSlicedSprite / bordered dfPanel background) or stretched (dfSprite) atlas cell, tinted by multiplying with
// the control colour; `fill` is dfSprite.FillAmount for horizontal fills (left to right unless invertFill).
export function paintSprite(canvas,sprite,width,height,color,{fill=1,invert=false,sliced=true}={}){
 const w=Math.max(1,Math.round(width)),h=Math.max(1,Math.round(height));if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);if(!sprite||width<=0||height<=0||fill<=0)return;
 const draw=()=>{const {image:img,border:b}=sprite,sw=img.width,sh=img.height;
  if(!sliced||!(b.left||b.right||b.top||b.bottom)){ctx.drawImage(img,0,0,sw,sh,0,0,w,h);return;}
  const l=Math.min(b.left,w/2),r=Math.min(b.right,w/2),t=Math.min(b.top,h/2),bo=Math.min(b.bottom,h/2);
  const xs=[[0,b.left,0,l],[b.left,sw-b.left-b.right,l,w-l-r],[sw-b.right,b.right,w-r,r]],ys=[[0,b.top,0,t],[b.top,sh-b.top-b.bottom,t,h-t-bo],[sh-b.bottom,b.bottom,h-bo,bo]];
  for(const [sx,sW,dx,dW] of xs)for(const [sy,sH,dy,dH] of ys)if(sW>0&&sH>0&&dW>0&&dH>0)ctx.drawImage(img,sx,sy,sW,sH,dx,dy,dW,dH);};
 ctx.save();if(fill<1){ctx.beginPath();const fw=w*fill;ctx.rect(invert?w-fw:0,0,fw,h);ctx.clip();}
 draw();if(color&&(color.r!==255||color.g!==255||color.b!==255)){
  // Composite operations apply to the whole canvas per call, so the alpha mask is one image, not nine slices.
  const mask=document.createElement('canvas');mask.width=w;mask.height=h;mask.getContext('2d').drawImage(canvas,0,0);
  ctx.globalCompositeOperation='multiply';ctx.fillStyle=rgb(color);ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);}
 ctx.restore();}

// dfFont (bitmap) text: glyph quads scaled by textScale, tinted by the label colour.
export function bitmapText(canvas,face,text,scale,color){const {font,image:img,glyphs,kerning}=face;let x=0,prev=null;const list=[];
 for(const ch of text){const id=ch.codePointAt(0),g=glyphs.get(id);if(!g){prev=null;continue;}if(prev!==null)x+=kerning.get(prev+','+id)??0;list.push([g,x]);x+=g.xadvance;prev=id;}
 const w=Math.max(1,Math.ceil(x*scale)),h=Math.max(1,Math.ceil(font.lineHeight*scale));canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=scale!==Math.round(scale);
 for(const [g,gx] of list)ctx.drawImage(img,g.x,g.y,g.width,g.height,Math.round((gx+g.xoffset)*scale),Math.round(g.yoffset*scale),Math.round(g.width*scale),Math.round(g.height*scale));
 if(color&&(color.r!==255||color.g!==255||color.b!==255)){ctx.globalCompositeOperation='source-in';ctx.fillStyle=rgb(color);ctx.fillRect(0,0,w,h);}return {width:x*scale,height:font.lineHeight*scale};}

// One instantiated hierarchy (a screen or a prefab instance). Elements are absolutely positioned divs, one per dfControl.
export function createDfTree(nodes,assets,{container,className='',viewport=()=>({width:innerWidth,height:innerHeight})}={}){
 const items=nodes.map((node,index)=>({node,index,control:controlOf(node),children:[],el:null,visible:true,active:node.active!==false,text:null,state:'default',focused:false,color:null,opacity:1,value:null,checked:null,fill:null,rect:null}));
 const byPath=new Map(),listeners=new Map(),tweens=[];let frame=0;
 for(const item of items){const p=item.node.parent;if(p>=0)items[p].children.push(item);for(const [kind,list] of Object.entries(item.node.components))for(const data of list)if(data.pathID!==undefined)byPath.set(data.pathID,{item,kind,data});}
 const root=document.createElement('div');root.className=('df-layer '+className).trim();container?.append(root);
 for(const item of items){const c=item.control;if(!c)continue;const el=item.el=document.createElement('div');el.className='df df-'+c.kind;el.dataset.dfName=item.node.name;
  const parentEl=item.node.parent>=0?items[item.node.parent].el:root;(parentEl??root).append(el);
  const d=c.data;item.visible=Boolean(d.isVisible);item.color=color32(d.color.rgba);item.opacity=item.color.a;el.style.zIndex=String(d.zindex??0);
  el.style.pointerEvents=d.isInteractive?'auto':'none';
  if(['dfPanel','dfScrollPanel','dfButton','dfLabel','dfSlider','dfSprite','dfSlicedSprite','dfTextureSprite','dfTextbox'].includes(c.kind)){const bg=document.createElement('canvas');bg.className='df-bg';bg.setAttribute('aria-hidden','true');el.append(bg);item.bg=bg;}
  if(['dfButton','dfLabel','dfRichTextLabel'].includes(c.kind)){const t=document.createElement('span');t.className='df-text';el.append(t);item.textEl=t;item.text=d.text??'';}
  if(c.kind==='dfSlider'){item.value=d.rawValue;}if(c.kind==='dfCheckbox')item.checked=Boolean(d.isChecked);if(c.kind==='dfScrollPanel')el.classList.add('df-scroll');
  if(c.kind==='dfButton'||c.kind==='dfCheckbox'||c.kind==='dfSlider'){el.addEventListener('mouseenter',()=>{if(item.state!=='disabled'){item.state='hover';paint(item);}});el.addEventListener('mouseleave',()=>{if(item.state!=='disabled'){item.state=item.focused?'focus':'default';paint(item);}});
   el.addEventListener('mousedown',e=>{if(e.button===0&&item.state!=='disabled'){for(const other of items)if(other!==item&&other.focused){other.focused=false;if(other.state==='focus')other.state='default';paint(other);}item.focused=true;item.state='pressed';paint(item);}});
   el.addEventListener('mouseup',()=>{if(item.state==='pressed'){item.state='hover';paint(item);}});}
  if(c.kind==='dfCheckbox')el.addEventListener('click',()=>{if(item.state!=='disabled'){item.checked=!item.checked;paint(item);emit(item,'CheckChanged');}});
  if(c.kind==='dfSlider'){const set=e=>{const r=el.getBoundingClientRect(),d2=d,k=Math.min(1,Math.max(0,(e.clientX-r.left)/Math.max(1,r.width)));let v=d2.minValue+(d2.maxValue-d2.minValue)*(d2.rightToLeft?1-k:k);if(d2.stepSize>0)v=Math.round(v/d2.stepSize)*d2.stepSize;item.value=v;paint(item);emit(item,'ValueChanged');};
   el.addEventListener('pointerdown',e=>{if(e.button!==0||item.state==='disabled')return;el.setPointerCapture(e.pointerId);set(e);const move=ev=>set(ev),up=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);});
   el.addEventListener('wheel',e=>{e.preventDefault();item.value=Math.min(d.maxValue,Math.max(d.minValue,item.value+(e.deltaY<0?1:-1)*d.scrollSize));paint(item);emit(item,'ValueChanged');},{passive:false});}
  for(const [dom,name] of [['click','Click'],['dblclick','DoubleClick'],['mousedown','MouseDown'],['mouseenter','MouseEnter'],['mouseleave','MouseLeave']])el.addEventListener(dom,e=>{if(dom==='mousedown'&&e.button!==0)return;if(item.state==='disabled'&&dom!=='mouseleave')return;emit(item,name,e);});
 }
 // Accessibility only: buttons whose caption is a child label are announced by that label's text.
 for(const item of items)if(item.control?.kind==='dfButton'){item.el.setAttribute('role','button');if(!item.text){const label=item.children.find(c=>c.control?.kind==='dfRichTextLabel'&&c.control.data.text?.trim()&&c.control.data.zindex>0)??item.children.find(c=>c.control?.data.text?.trim());if(label)item.el.setAttribute('aria-label',label.control.data.text.trim());}}
 function emit(item,name,event){for(const [kind,list] of Object.entries(item.node.components))for(const data of list){const fns=listeners.get(data.pathID+':'+name);if(fns)for(const fn of fns)fn(event,{item,kind,data});}}
 function on(target,name,fn){const ids=typeof target==='number'?[target]:Object.values(target.node.components).flat().map(d=>d.pathID);for(const id of ids){const k=id+':'+name;if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn);}}
 const fontOf=key=>assets.fonts[key];
 function textStyle(item){const {kind,data:d}=item.control,font=fontOf(d.fontKey),t=item.textEl;if(!t)return;
  const color=kind==='dfButton'?color32(({default:d.textColor,hover:d.hoverText,pressed:d.pressedText,focus:d.focusText,disabled:d.disabledText}[item.state]??d.textColor).rgba):item.color;
  t.replaceChildren();const value=item.text??'';
  if(font?.kind==='bitmap'){const face=assets.bitmaps.get(d.fontKey),canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');const m=bitmapText(canvas,face,value,d.textScale??1,color??{r:255,g:255,b:255});t.append(canvas);t.dataset.text=value;t.setAttribute('aria-label',value);item.textWidth=m.width;
   canvas.style.width=m.width+'px';canvas.style.height=m.height+'px';}
  else if(font){const size=kind==='dfRichTextLabel'?d.fontSize:Math.ceil(font.size*(d.textScale??1));
   Object.assign(t.style,{fontFamily:`"${font.name}"`,fontSize:size+'px',lineHeight:Math.round(size*font.lineHeight/font.size)+'px',fontWeight:d.fontStyle===1||d.fontStyle===3?'bold':'normal',fontStyle:d.fontStyle>=2?'italic':'normal'});
   if(Array.isArray(item.parts))for(const p of item.parts){if(p.href){const a=document.createElement('a');a.href=p.href;a.textContent=p.text;t.append(a);}else t.append(p.text);}else t.textContent=value;
   if(color&&kind==='dfButton')t.style.color=rgb(color);}
  if(kind!=='dfButton')t.style.color=rgb(item.color);
  const align=kind==='dfRichTextLabel'?richAlign(d.align):labelAlign(kind==='dfButton'?d.textAlign:d.align);t.style.textAlign=align;t.style.justifyContent=align==='center'?'center':align==='right'?'flex-end':'flex-start';
  const pad=d.padding??{m_Left:0,m_Right:0,m_Top:0,m_Bottom:0};Object.assign(t.style,{paddingLeft:pad.m_Left+'px',paddingRight:pad.m_Right+'px',paddingTop:pad.m_Top+'px',paddingBottom:pad.m_Bottom+'px',alignItems:kind==='dfRichTextLabel'?'flex-start':vertical(d.vertAlign??0),whiteSpace:d.wordWrap||kind==='dfRichTextLabel'?'pre-wrap':'pre'});}
 // Draws one control's sprite/background/text for its current state and rectangle.
 function paint(item){const c=item.control;if(!c||!item.rect)return;const {kind,data:d}=c,{width,height}=item.rect;
  item.el.style.opacity=String(+item.opacity.toFixed(4));
  if(item.bg){let sprite=null,color=null,fill=1,invert=false,sliced=true;
   if(kind==='dfPanel'||kind==='dfScrollPanel'||kind==='dfLabel'){sprite=d.backgroundSprite;color=color32(d.backgroundColor.rgba);}
   else if(kind==='dfButton'){sprite=({hover:d.hoverSprite,pressed:d.pressedSprite,focus:d.focusSprite,disabled:d.disabledSprite}[item.state])||d.backgroundSprite;color=color32(({hover:d.hoverColor,pressed:d.pressedColor,focus:d.focusColor}[item.state]??d.color).rgba);}
   else if(kind==='dfSlider'){sprite=d.backgroundSprite;color=item.color;}
   // dfTextbox: FocusSprite while it has focus (falls back to the background sprite), tinted by Color.
   else if(kind==='dfTextbox'){sprite=(item.focused&&d.focusSprite)||d.backgroundSprite;color=item.color;}
   else if(kind==='dfSprite'||kind==='dfSlicedSprite'){sprite=d.spriteName;color=item.color;fill=item.fill??d.fillAmount;invert=Boolean(d.invertFill);sliced=kind==='dfSlicedSprite';}
   if(kind==='dfTextureSprite'){item.bg.hidden=!d.textureFile;if(d.textureFile)assets.texture(d.textureFile).then(img=>paintSprite(item.bg,{image:img,border:{left:0,right:0,top:0,bottom:0}},width,height,item.color,{sliced:false}));}
   else paintSprite(item.bg,sprite?assets.sprites.get(sprite):null,width,height,color,{fill,invert,sliced:sliced&&kind!=='dfSprite'});}
  if(kind==='dfSlider'){const fillItem=byPath.get(d.fillIndicator?.m_PathID)?.item;if(fillItem){fillItem.fill=(item.value-d.minValue)/Math.max(1e-6,d.maxValue-d.minValue);paint(fillItem);}}
  if(kind==='dfCheckbox'){const icon=byPath.get(d.checkIcon?.m_PathID)?.item;if(icon){icon.visible=item.checked;applyVisibility(icon);}}
  textStyle(item);
  if(kind==='dfLabel'&&d.autoSize&&item.textWidth!==undefined){const pad=d.padding??{m_Left:0,m_Right:0};const w=Math.ceil(item.textWidth+pad.m_Left+pad.m_Right);if(Math.abs(w-width)>0.5){item.rect.width=w;item.el.style.width=w+'px';paint(item);}}}
 function applyVisibility(item){if(item.el)item.el.hidden=!(item.visible&&item.active);}
 // dfControl.AnchorLayout for the whole hierarchy; roots anchor to the screen (GetScreenSize, pixel perfect) or `origin`.
 function layout(view=viewport()){for(const item of items){const c=item.control;if(!c)continue;const p=item.node.parent>=0?items[item.node.parent]:null;
  const parentSize=p?.rect?{x:p.rect.width,y:p.rect.height}:{x:view.width,y:view.height};const override=item.position;
  const size={x:item.size?.x??c.data.size.x,y:item.size?.y??c.data.size.y};let r=override?{x:override.x,y:override.y,width:size.x,height:size.y}:anchorLayout(c.data.layout,size,parentSize);item.rect=r;
  Object.assign(item.el.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});applyVisibility(item);paint(item);}}
 // dfTweenColor32 bound through dfTweenEventBinding (MouseEnter/MouseLeave), Linear easing, syncStartWhenRun.
 for(const item of items)for(const binding of item.node.components.dfTweenEventBinding??[]){const tween=byPath.get(binding.Tween.m_PathID);if(!tween||tween.kind!=='dfTweenColor32')continue;
  const target=byPath.get(tween.data.target.Component.m_PathID)?.item??item;
  if(binding.StartEvent)on(binding.EventSource.m_PathID,binding.StartEvent,()=>startTween(target,tween.data));if(binding.StopEvent)on(binding.EventSource.m_PathID,binding.StopEvent,()=>stopTween(target,tween.data));}
 function startTween(item,data){for(let i=tweens.length-1;i>=0;i--)if(tweens[i].item===item)tweens.splice(i,1);tweens.push({item,data,start:performance.now()/1000,from:{...item.color,a:item.color.a}});if(!frame)frame=requestAnimationFrame(tick);}
 function stopTween(item,data){for(let i=tweens.length-1;i>=0;i--)if(tweens[i].item===item&&tweens[i].data===data)tweens.splice(i,1);}
 function tick(){frame=0;const now=performance.now()/1000;for(let i=tweens.length-1;i>=0;i--){const tw=tweens[i],elapsed=now-tw.start,c=tweenColor(tw.data,elapsed,tw.from);setColor(tw.item,c);if(elapsed>=tw.data.length)tweens.splice(i,1);}if(tweens.length)frame=requestAnimationFrame(tick);}
 function setColor(item,c){item.color=c;item.opacity=c.a;if(item.textEl){item.textEl.style.color=rgb(c);}item.el.style.opacity=String(+c.a.toFixed(4));if(item.bg&&['dfSprite','dfSlicedSprite'].includes(item.control.kind))paint(item);}
 const find=(name,parentName)=>items.find(i=>i.node.name===name&&(parentName===undefined||items[i.node.parent]?.node.name===parentName));
 const api={root,items,byPath,layout,on,emit,find,paint,
  item:target=>typeof target==='number'?byPath.get(target)?.item:target,
  setVisible(item,visible){if(!item)return;const was=item.visible;item.visible=visible;applyVisibility(item);if(was!==visible)emit(item,'IsVisibleChanged');},
  setActive(item,active){if(!item)return;item.active=active;applyVisibility(item);},
  isVisible:item=>Boolean(item?.visible&&item.active),
  setText(item,text,parts){if(!item)return;item.text=String(text);item.parts=parts??null;paint(item);},
  setOpacity(item,o){if(!item)return;item.opacity=o;item.el.style.opacity=String(o);},
  setEnabled(item,enabled){if(!item)return;item.state=enabled?'default':'disabled';paint(item);},
  setColor,
  dispose(){cancelAnimationFrame(frame);root.remove();}};
 return api;}
