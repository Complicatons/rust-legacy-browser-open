// Original hold-E context menu: ContextUI.cs (client state + OnGUI drawing) and Context.cs (WorldUse RPCs A..M,
// kQuickTapMillisecondLimit 300 ms), driven by ContextProbe (press = Context.ButtonDown -> BeginQuery, ButtonUp ->
// EndQuery). The look is the ContextUI GUISkin "ctxbox"/"ctxbutton" styles (tools/export_context.py): a centred
// window_dropshadow_sprite box with one ProFontWindows 9 px button per option, held open only while the use key is down.
// Offline the page is the server (offlineContextServer mirrors the server Context/ContextQuery rules); online the
// transport is the bridge's context command and Context:E..M replies (online.mjs OnlineContext).

export const QUICK_TAP_MS=300;
// ContextClientState.
export const STATE=Object.freeze({off:'off',polling:'polling',options:'options',validating:'validating'});

// ContextUI + Context client side. `send(kind, arg)`: 'query' (Context:A target), 'quick' (B), 'menu' (C option name),
// 'cancel' (D). Hooks: unlock() (clientUnlock.On = true, DoNotResetInput), tryLock() -> bool (clientUnlock.TryLock
// success), onChange() redraw, onWorking(bool) (ContextUI.clientWorkingCallbacks).
export class ContextClient{
 constructor({send=()=>{},unlock=()=>{},tryLock=()=>false,onChange=()=>{},onWorking=()=>{}}={}){
  Object.assign(this,{send,unlock,tryLock,onChange,onWorking});
  this.state=STATE.off;this.queryTime=0;this.options=[];this.selection=-1;this.enabled=false;this.unlocked=false;this.showAt=null;this.validatingString='';
  // ContextUI.temp: the static GUIContent GUIOptions fills with each option text; GUIString draws it as it was left (the
  // last option's text), not validatingString.
  this.lastText='';this.target=null;}
 // Context.Working / WorkingInMenu.
 get working(){return this.state!==STATE.off;}
 get workingInMenu(){return this.state===STATE.polling||this.state===STATE.options;}
 setState(state){if(this.state===state)return;const was=this.state;this.state=state;if(was===STATE.off)this.onWorking(true);else if(state===STATE.off)this.onWorking(false);this.onChange();}
 // Context.BeginQuery -> ContextUI.OnServerQuerySent -> OnClientPromptBegin.
 press(target,nowMs){if(this.state!==STATE.off||target==null)return false;this.target=target;this.queryTime=nowMs;this.send('query',target);this.setState(STATE.polling);return true;}
 // Context.EndQuery (ContextProbe on ButtonUp, ContextUI.OnGUI when the button is no longer held).
 release(nowMs){if(!this.workingInMenu)return;
  if(nowMs-this.queryTime<=QUICK_TAP_MS){this.send('quick');}else this.send('cancel');
  if(this.state===STATE.options)this.hideMenu();this.setState(STATE.validating);}
 // Per frame: the Invoke("OnClientShowMenu") timer and ContextUI.OnGUI's end check (options drawn, > 300 ms since the
 // query, WorldUse no longer held).
 frame(nowMs,held){if(this.showAt!==null&&nowMs>=this.showAt){this.showAt=null;this.showMenu();}
  if(this.enabled&&this.state===STATE.options&&nowMs-this.queryTime>QUICK_TAP_MS&&!held)this.release(nowMs);}
 // ContextUI.OnClientSelection (a GUI.Button click).
 select(i){if(!this.enabled||this.state!==STATE.options||!this.options[i])return false;this.selection=i;this.send('menu',this.options[i].name);this.validatingString=this.options[i].text+'..';this.setState(STATE.validating);return true;}
 // ContextUI.OnClientOptionsMade: shown at once after 300 ms, otherwise Invoke'd (elapsed + 50) ms later.
 optionsMade(nowMs){if(this.state===STATE.validating)return;const elapsed=nowMs-this.queryTime;if(elapsed>QUICK_TAP_MS)this.showMenu();else this.showAt=nowMs+elapsed+50;this.setState(STATE.options);this.onChange();}
 showMenu(){this.selection=-1;if(!this.unlocked){this.unlocked=true;this.unlock();}this.enabled=true;if(this.options.length)this.lastText=this.options.at(-1).text;this.onChange();}
 // ContextUI.OnClientHideMenu. The original then swallows one WorldUse ButtonDown when the key is still held: that is the
 // spurious press Input.ResetInputAxes produces for a held key, which browser key events never produce.
 hideMenu(){this.showAt=null;const wasUnlocked=this.unlocked;this.unlocked=false;this.enabled=false;if(wasUnlocked)this.tryLock();this.onChange();}
 promptEnd(){this.hideMenu();this.setState(STATE.off);this.target=null;}
 optionsCleared(){this.selection=-1;this.options=[];}
 // Server replies (Context:E..M).
 reply(name,values=[],nowMs=0){
  switch(name){
   case 'E':this.options=[...(values[0]??[])].map(o=>({name:o.name,text:String(o.text)}));this.optionsMade(nowMs);break;
   case 'F':this.options=[];this.promptEnd();break; // OnServerNoOp
   case 'G':this.promptEnd();break; // OnServerCancel
   case 'H':case 'J':case 'L':this.promptEnd();break; // failed immediate / failed selection / stale selection
   case 'I':case 'K':this.optionsCleared();this.promptEnd();break; // success: validated, cleared, prompt end
   case 'M':this.optionsCleared();this.setState(STATE.polling);this.optionsMade(nowMs);break; // OnServerRestartPolling
   default:return false;}
  return true;}
 snapshot(){return {state:this.state,enabled:this.enabled,options:this.options.map(o=>o.text),selection:this.selection,showAt:this.showAt,queryTime:this.queryTime};}
}

// ---- server side for the offline island (server Context.cs ClientQuery / ClientSelection_*) ---------------------------
// A target with menu() is ContextExecution.Quick|Menu (BasicDoor, FireBarrel): the query answers the menu (E), or NoOp
// (F) when it is empty; quick tap (B) runs use(); a choice (C) runs menuAction(text); cancel (D) is a NoOp. A target
// without a menu is Quick only (LootableObject, SleepingBag, ItemPickup): the query itself runs use() (I/H at once).
// use()/menuAction() returning false is a failure (H/J), anything else success (I/K). Replies arrive asynchronously.
// eyes()/now(): the controllable's eyes origin and the message timestamp the server's ContextRespondQuick uses (a
// BasicDoor opens away from that point).
// exists(target): Contextual.exists. The server's DEQUEUE answers a quick tap, a menu choice or a cancel on a destroyed
// contextual with CouldNotGetPlayerContextContextual -> ClientRequest_StaleSelection (L) and runs nothing (Context.cs
// DEQUEUE, ExecuteClientResponse_MenuSelection): a door destroyed while its menu is up opens no lock entry.
export const contextualExists=t=>Boolean(t)&&(typeof t.exists==='function'?Boolean(t.exists()):!(t.destroyed||t.deployed?.destroyed||t.crate?.destroyed));
export function offlineContextServer({reply,eyes=()=>undefined,now=()=>undefined,defer=fn=>queueMicrotask(fn),exists=contextualExists}){let stage=null;
 const ok=r=>r!==false;
 return function send(kind,arg){
  if(kind==='query'){const target=arg;stage=null;
   if(typeof target.menu==='function'){const options=target.menu()??[];if(!options.length){defer(()=>reply('F'));return;}stage={target,options};defer(()=>reply('E',[options.map((text,name)=>({name,text}))]));return;}
   const r=target.use?.(eyes(),now());defer(()=>reply(ok(r)?'I':'H'));return;}
  const s=stage;stage=null;
  if(s&&!exists(s.target)){defer(()=>reply('L'));return;}
  if(kind==='quick'){if(!s){defer(()=>reply('L'));return;}const r=s.target.use?.(eyes(),now());defer(()=>reply(ok(r)?'K':'J'));return;}
  if(kind==='menu'){if(!s){defer(()=>reply('L'));return;}const text=s.options[arg];if(text===undefined){defer(()=>reply('J'));return;}const r=s.target.menuAction?.(text);defer(()=>reply(ok(r)?'K':'J'));return;}
  if(kind==='cancel'){defer(()=>reply('F'));}};}

// ---- OnGUI layout (ContextUI.BoxRect / GUIOptions / GUIString) ------------------------------------------------------
const addOffset=(r,o)=>({x:r.x-o.left,y:r.y-o.top,width:r.width+o.left+o.right,height:r.height+o.top+o.bottom});
const removeOffset=(r,o)=>({x:r.x+o.left,y:r.y+o.top,width:r.width-o.left-o.right,height:r.height-o.top-o.bottom});
// GUIStyle.CalcSize: the text size plus padding.
export const calcSize=(style,text,measure)=>{const m=measure(text);return {x:m.width+style.padding.left+style.padding.right,y:m.height+style.padding.top+style.padding.bottom};};
// BoxRect: content plus box padding, centred with FloorToInt; the content offsets are the floored inner corner.
export function boxRect(content,box,screen){const r=addOffset({x:0,y:0,width:content.x,height:content.y},box.padding);r.x+=Math.floor((screen.width-r.width)*0.5);r.y+=Math.floor((screen.height-r.height)*0.5);
 const inner=removeOffset(r,box.padding);return {rect:r,xOffset:Math.floor(inner.x),yOffset:Math.floor(inner.y)};}
// GUIOptions: each button is padding.Add(CeilToInt(CalcSize)) (the padding counted twice, as the source does), the box
// holds the widest button and the summed margin-added heights; buttons stack from the inner top-left, each next one at
// FloorToInt(margin.Add(margin.Add(button)).yMax), drawn at margin.Remove of its margin-added rect.
export function optionsLayout(texts,{box,button},measure,screen){
 const fixedW=button.fixedWidth||null,fixedH=button.fixedHeight||null,rects=[];let width=-Infinity,height=0;
 for(const text of texts){const c=calcSize(button,text,measure),r=addOffset({x:0,y:0,width:fixedW??Math.ceil(c.x),height:fixedH??Math.ceil(c.y)},button.padding);rects.push(r);
  const m=addOffset(r,button.margin);width=Math.max(width,m.width);height+=m.height;}
 const b=boxRect({x:width,y:height},box,screen);let y=b.yOffset;const buttons=[];
 for(const r of rects){const r2=addOffset(r,button.margin);r2.width=width;r2.x=b.xOffset;r2.y=y;y=Math.floor(addOffset(r2,button.margin).y+addOffset(r2,button.margin).height);buttons.push(removeOffset(r2,button.margin));}
 return {box:b.rect,buttons};}
// GUIString: a box sized to CalcSize of the shared GUIContent.
export function stringLayout(text,box,measure,screen){const c=calcSize(box,text,measure);return {box:boxRect(c,box,screen).rect};}
// GUI.Box/GUI.Button background: the style's overflow widens the drawn background.
export const backgroundRect=(rect,style)=>addOffset(rect,style.overflow);

// ---- DOM renderer (browser only) -------------------------------------------------------------------------------------
// Unity GUIStyle state: hover/active only when that state has a background; normal otherwise.
const styleState=(style,{hover=false,active=false}={})=>active&&style.states.active?.background?style.states.active:hover&&style.states.hover?.background?style.states.hover:style.states.normal;
const css=c=>`rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${c.a})`;
export async function createContextUI({base='/assets/recovered/context/',document=globalThis.document,screen=()=>({width:innerWidth,height:innerHeight}),onSelect=()=>{}}={}){
 const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original ContextUI export missing');const manifest=await response.json(),{ctxbox:box,ctxbutton:button}=manifest.styles;
 const fontInfo=manifest.fonts[button.font],family='ContextUI-'+fontInfo.name;const face=new FontFace(family,`url("${base+fontInfo.file}")`);await face.load();document.fonts.add(face);
 const images=new Map();const image=file=>{if(!images.has(file)){const img=new Image();img.src=base+file;images.set(file,img);img.decode().catch(()=>{});}return images.get(file);};
 for(const s of [box,button])for(const st of Object.values(s.states))if(st.background)await image(st.background.file).decode();
 // Dynamic font metrics at the style size: integer advances (FreeType hinted pixel sizes), line height from the font's
 // line spacing scaled to the size.
 const ctx=document.createElement('canvas').getContext('2d'),fontCss=`${button.fontSize}px "${family}"`,lineHeight=Math.round(fontInfo.lineSpacing*button.fontSize/fontInfo.fontSize);
 const measure=text=>{ctx.font=fontCss;let w=0;for(const ch of String(text))w+=Math.round(ctx.measureText(ch).width);return {width:w,height:lineHeight};};
 const layer=document.createElement('div');layer.id='context-ui';layer.setAttribute('role','menu');layer.hidden=true;document.body.append(layer);
 // Nine-slice GUI texture drawing (point filtered, border in texture pixels).
 function nineSlice(canvas,img,rect,border){const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));canvas.width=w;canvas.height=h;Object.assign(canvas.style,{left:rect.x+'px',top:rect.y+'px',width:w+'px',height:h+'px'});
  const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;const sw=img.naturalWidth,sh=img.naturalHeight,b=border;
  const xs=[[0,b.left,0,b.left],[b.left,sw-b.left-b.right,b.left,w-b.left-b.right],[sw-b.right,b.right,w-b.right,b.right]],ys=[[0,b.top,0,b.top],[b.top,sh-b.top-b.bottom,b.top,h-b.top-b.bottom],[sh-b.bottom,b.bottom,h-b.bottom,b.bottom]];
  for(const [sx,sW,dx,dW] of xs)for(const [sy,sH,dy,dH] of ys)if(sW>0&&sH>0&&dW>0&&dH>0)c.drawImage(img,sx,sy,sW,sH,dx,dy,dW,dH);}
 const background=(style,rect,state)=>{const st=styleState(style,state),bg=st.background;const canvas=document.createElement('canvas');canvas.className='ctx-bg';canvas.setAttribute('aria-hidden','true');if(bg)nineSlice(canvas,images.get(bg.file),backgroundRect(rect,style),style.border);return canvas;};
 // TextAnchor MiddleCenter inside the padded rect.
 const label=(style,rect,text,state)=>{const span=document.createElement('span');span.className='ctx-text';span.textContent=text;const inner=removeOffset(rect,style.padding);
  Object.assign(span.style,{left:inner.x+'px',top:inner.y+'px',width:inner.width+'px',height:inner.height+'px',lineHeight:inner.height+'px',font:`${style.fontSize}px "${family}"`,color:css(styleState(style,state).textColor)});return span;};
 let client=null,key='';
 // ContextUI.OnGUI lays the box out every frame from Screen.width/height: a resize or fullscreen change re-centres it.
 addEventListener('resize',()=>render());
 function render(c=client){client=c;const s=c?.state,showOptions=Boolean(c?.enabled&&s===STATE.options),showString=Boolean(c?.enabled&&s===STATE.validating);
  const sig=JSON.stringify([showOptions,showString,c?.options.map(o=>o.text),c?.lastText,screen()]);if(sig===key)return;key=sig;
  layer.replaceChildren();layer.hidden=!(showOptions||showString);if(layer.hidden)return;const view=screen();
  if(showOptions){const texts=c.options.map(o=>o.text),l=optionsLayout(texts,{box,button},measure,view);layer.append(background(box,l.box,{}));
   l.buttons.forEach((r,i)=>{const el=document.createElement('div');el.className='ctx-button';el.setAttribute('role','menuitem');el.dataset.option=texts[i];Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
    const local={x:0,y:0,width:r.width,height:r.height};let hover=false,active=false;const paint=()=>el.replaceChildren(background(button,local,{hover,active}),label(button,local,texts[i],{hover,active}));paint();
    el.addEventListener('pointerenter',()=>{hover=true;paint();});el.addEventListener('pointerleave',()=>{hover=false;paint();});
    el.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();active=true;paint();el.setPointerCapture?.(e.pointerId);});
    // GUI.Button returns true on the mouse-up over the button that took the mouse-down.
    el.addEventListener('pointerup',e=>{if(e.button!==0||!active)return;active=false;const rr=el.getBoundingClientRect(),inside=e.clientX>=rr.left&&e.clientX<rr.right&&e.clientY>=rr.top&&e.clientY<rr.bottom;paint();if(inside&&client?.select(i))onSelect(texts[i]);});
    layer.append(el);});}
  else{const text=c.lastText,l=stringLayout(text,box,measure,view);layer.append(background(box,l.box,{}),label(box,l.box,text,{}));}}
 return {render,layer,measure,styles:manifest.styles,isMenuVisible:()=>!layer.hidden,snapshot:()=>({visible:!layer.hidden,buttons:[...layer.querySelectorAll('.ctx-button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.dataset.option,x:r.x,y:r.y,width:r.width,height:r.height};}),string:layer.querySelector('.ctx-button')?null:layer.querySelector('.ctx-text')?.textContent??null})};
}
