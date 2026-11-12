import {createDfTree,loadDfAssets} from './dfgui.mjs';
import {loadFrontendSkin} from './frontend-skin.mjs';
import {color32} from './popup-ui.mjs';
// Recognise native UI messages only; server console text is never executed as code or commands.
export function clientUICommand(text){
 if(typeof text!=='string')return null;const show=/^lockentry\.show\s+(true|false)\s*$/i.exec(text);if(show)return {type:'lock',changing:show[1].toLowerCase()==='true'};
 if(/^lockentry\.hide\s*$/i.test(text))return {type:'hide-lock'};
 // notice.inventory (Rust.Notice.Inventory, server QuoteSafe-quoted) -> PopupUI.CreateInventory.
 const inventory=/^notice\.inventory\s+(?:"((?:[^"\\\r\n]|\\.)*)"|([^\s";]+))\s*$/i.exec(text);if(inventory)return {type:'inventory',message:(inventory[1]??inventory[2]).replace(/\\(["\\])/g,'$1')};
 // deathscreen.reason (server DeathScreen.SetReason, String.QuoteSafe-quoted) sets the client convar shown by DeathScreen.Show.
 const reason=/^deathscreen\.reason\s+(?:"((?:[^"\\\r\n]|\\.)*)"|([^\s";]+))\s*$/i.exec(text);if(reason)return {type:'death-reason',message:(reason[1]??reason[2]).replace(/\\(["\\])/g,'$1')};
 // notice.popup <seconds> <icon> <text> (Rust.Notice.Popup, QuoteSafe-quoted) -> PopupUI.CreateNotice(seconds, icon, text).
 const popup=/^notice\.popup\s+(\d+(?:\.\d+)?)\s+(?:"([^"\r\n]*)"|(\S+))\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(text);return popup?{type:'notice',message:popup[4].replace(/\\(["\\])/g,'$1'),seconds:Number(popup[1]),icon:popup[2]??popup[3]}:null;
}

// Original client LockEntry (LockEntry.cs, BuildPlayer-GameUI "LockEntry" panel exported by tools/export_frontend.py):
// a 400x300 dfPanel centred on the screen holding a dark 253x112 BLANK_TEXTURE sprite with the entry label
// ("Password:" / "New Password:"), a black box with the 4-character digit-only dfTextbox and the Okay / Cancel buttons.
// Okay and Return (dfControlKeyBinding KeyCode.Return, no modifiers, on the panel) run PasswordEntered; Cancel hides.
// A bad entry is not sent and the panel stays open: ConsoleSystem.Run("notice.popup 5 \uf084 \"...\"").
export const LOCK_NOTICE_ICON='\uf084',LOCK_NOTICE_SECONDS=5;
// char.IsDigit is per UTF-16 unit and accepts every Unicode decimal digit (Nd), not only 0-9.
const isDigit=unit=>/\p{Nd}/u.test(unit);
const units=v=>Array.from({length:v.length},(_,i)=>v[i]);
// LockEntry.PasswordEntered: length first, then every character a digit.
export function codeError(code){return code.length!==4?'Password must be 4 digits.':!units(code).every(isDigit)?'Must be digits only.':null;}
// DigitEntryRestrictions.OnKeyPress (a typed non-control, non-digit character is used up) and OnTextChanged (the text keeps
// only its digits, e.g. after a paste). The textbox's MaxLength (4) applies before the filter (dfTextbox.pasteAtCursor).
export const digitsOnly=v=>units(String(v)).filter(isDigit).join('');
export const typedCharacterAllowed=ch=>ch.length!==1||/\p{Cc}/u.test(ch)||isDigit(ch);
// dfTextbox.pasteAtCursor: characters below ' ' are skipped, the result is cut to MaxLength, then OnTextChanged filters.
export function pasteText(text,start,end,clip,maxLength){const kept=units(String(clip)).filter(c=>c>=' ').join('');let out=text.slice(0,start)+kept+text.slice(end);const cursor=Math.min(start+kept.length,maxLength);out=out.slice(0,maxLength);return {text:digitsOnly(out),cursor:Math.min(cursor,digitsOnly(out).length)};}
// dfTextbox.renderText (TextAlign Left): scrollIndex never passes the cursor and advances until the cursor fits.
export function textboxScroll(widths,scrollIndex,cursor,inner){let s=Math.min(scrollIndex,cursor,widths.length),w=0;for(let i=s;i<cursor;i++)w+=widths[i];while(w>=inner&&s<cursor)w-=widths[s++];return s;}

export function createLockEntryUI({document=globalThis.document,container=document.body,onOpen=()=>{},onClose=()=>{},popup=()=>{},assets=null}={}){
 const section=document.createElement('section');section.id='lock-entry';section.className='df-host';section.hidden=true;section.setAttribute('role','dialog');section.setAttribute('aria-modal','true');section.setAttribute('aria-label','Lock entry');container.append(section);
 let ui=null,submit=null,changing=false,visible=false,pendingShow=false,failed=false;
 const ready=(assets?Promise.resolve(assets):loadDfAssets(loadFrontendSkin())).then(a=>{const screen=a.manifest.screens.LockEntry;if(!screen)throw Error('Original LockEntry export missing');ui=build(a,screen);if(pendingShow)open();return ui;});
 ready.catch(e=>{failed=true;console.warn('Original LockEntry unavailable:',e.message);if(pendingShow){pendingShow=false;submit=null;onClose();}});
 function build(assets,screen){
  const tree=createDfTree(screen.nodes,assets,{container:section,className:'df-lock-entry'}),root=tree.items[0],le=root.node.components.LockEntry[0];
  const textbox=tree.item(le.passwordInput.m_PathID),label=tree.item(le.entryLabel.m_PathID),td=textbox.control.data,font=assets.fonts[td.fontKey];
  // Okay / Cancel through the panel's dfEventBindings (DataSource Click -> PasswordEntered / CancelPressed).
  const actions={PasswordEntered:()=>passwordEntered(),CancelPressed:()=>hide()};
  for(const b of root.node.components.dfEventBinding??[]){const source=tree.item(b.DataSource.Component.m_PathID),fn=actions[b.DataTarget.MemberName];if(source&&fn&&b.DataSource.MemberName==='Click'){tree.on(b.DataSource.Component.m_PathID,'Click',()=>{if(visible)fn();});source.el.dataset.action=b.DataTarget.MemberName;}}
  const keyBinding=root.node.components.dfControlKeyBinding?.[0];label.el.id='lock-label';
  // dfTextbox: a real (transparent) input keeps focus, editing, selection and IME; the original text, caret and selection are drawn.
  const input=document.createElement('input');Object.assign(input,{id:'lock-code',type:'text',maxLength:td.maxLength,autocomplete:'off',spellcheck:false});input.setAttribute('inputmode','numeric');input.setAttribute('aria-labelledby','lock-label');
  const drawn=document.createElement('div');drawn.className='lock-input-text';drawn.setAttribute('aria-hidden','true');textbox.el.append(drawn,input);textbox.el.style.pointerEvents='auto';
  const scale=td.textScale??1,size=Math.ceil(font.size*scale),lineHeight=Math.round(size*font.lineHeight/font.size),textColor=color32(td.textColor.rgba),selection=color32(td.selectionBackground.rgba),pad=td.padding;
  const measure=document.createElement('canvas').getContext('2d'),widths=v=>{measure.font=`${size}px "${font.name}"`;return units(v).map(c=>measure.measureText(c).width);};
  let scrollIndex=0,undoText='',blinkStart=0,frame=0,phase=-1;
  const rgb=c=>`rgb(${c.r},${c.g},${c.b})`;
  function paintInput(){const value=input.value,w=widths(value),r=textbox.rect;if(!r)return;const inner=r.width-pad.m_Left-pad.m_Right;
   const start=Math.min(input.selectionStart??value.length,value.length),end=Math.min(input.selectionEnd??start,value.length),cursor=input.selectionDirection==='backward'?start:end;
   scrollIndex=textboxScroll(w,scrollIndex,cursor,inner);const sum=(a,b)=>w.slice(a,b).reduce((n,x)=>n+x,0);
   Object.assign(drawn.style,{left:pad.m_Left+'px',top:pad.m_Top+'px',width:Math.max(0,inner)+'px',height:Math.max(0,r.height-pad.m_Top-pad.m_Bottom)+'px'});drawn.replaceChildren();
   if(start!==end){const a=Math.max(start,scrollIndex),sel=document.createElement('i');sel.className='lock-selection';Object.assign(sel.style,{left:sum(scrollIndex,a)+'px',width:Math.max(0,sum(a,Math.max(a,end)))+'px',height:lineHeight+'px',background:rgb(selection)});drawn.append(sel);}
   // dfTextbox.doCursorBlink: cursorShown toggles every cursorBlinkTime while focused.
   else if(document.activeElement===input&&Math.floor((performance.now()-blinkStart)/(td.cursorBlinkTime*1000))%2===0){const caret=document.createElement('i');caret.className='lock-caret';Object.assign(caret.style,{left:Math.round(sum(scrollIndex,cursor))+'px',width:td.cursorWidth+'px',height:lineHeight+'px',background:rgb(textColor)});drawn.append(caret);}
   const text=document.createElement('span');text.className='lock-text';text.textContent=value.slice(scrollIndex);Object.assign(text.style,{fontFamily:`"${font.name}"`,fontSize:size+'px',lineHeight:lineHeight+'px',color:rgb(textColor)});drawn.append(text);}
  const blink=()=>{frame=0;if(!visible)return;const p=Math.floor((performance.now()-blinkStart)/(td.cursorBlinkTime*1000));if(p!==phase){phase=p;paintInput();}frame=requestAnimationFrame(blink);};
  for(const e of ['select','keyup','pointerup','focus','blur'])input.addEventListener(e,()=>{blinkStart=performance.now();queueMicrotask(paintInput);});
  input.addEventListener('focus',()=>{textbox.focused=true;tree.paint(textbox);
   // dfTextbox.OnEnterFocus: undoText = Text; selectOnFocus selects everything.
   undoText=input.value;if(td.selectOnFocus)input.setSelectionRange(0,input.value.length);});
  input.addEventListener('blur',()=>{textbox.focused=false;tree.paint(textbox);});
  // DigitEntryRestrictions: typed non-digits are used up; anything else that changes the text keeps only its digits.
  input.addEventListener('beforeinput',e=>{if(!e.data||!e.inputType.startsWith('insert')||units(e.data).every(c=>typedCharacterAllowed(c)))return;e.preventDefault();if(units(e.data).length===1)return;
   // Several characters at once (IME, drop, scripted insert) go in like dfTextbox.pasteAtCursor + OnTextChanged.
   const r=pasteText(input.value,input.selectionStart??input.value.length,input.selectionEnd??input.value.length,e.data,td.maxLength);input.value=r.text;input.setSelectionRange(r.cursor,r.cursor);paintInput();});
  input.addEventListener('paste',e=>{const clip=e.clipboardData?.getData('text')??'';e.preventDefault();const r=pasteText(input.value,input.selectionStart??input.value.length,input.selectionEnd??input.value.length,clip,td.maxLength);input.value=r.text;input.setSelectionRange(r.cursor,r.cursor);paintInput();});
  input.addEventListener('input',()=>{const at=input.selectionStart??input.value.length,before=input.value.slice(0,at),v=digitsOnly(input.value).slice(0,td.maxLength);if(v!==input.value){input.value=v;const c=Math.min(digitsOnly(before).length,v.length);input.setSelectionRange(c,c);}blinkStart=performance.now();paintInput();});
  input.addEventListener('keydown',e=>{e.stopPropagation();
   // The panel's dfControlKeyBinding: KeyCode.Return (not KeypadEnter) with Shift/Control/Alt exactly as bound.
   if(keyBinding&&e.code==='Enter'&&e.shiftKey===Boolean(keyBinding.shiftPressed)&&e.ctrlKey===Boolean(keyBinding.controlPressed)&&e.altKey===Boolean(keyBinding.altPressed)){e.preventDefault();if(e.repeat)return;passwordEntered();return;}
   if(e.code==='Enter'||e.code==='NumpadEnter'){e.preventDefault();return;}
   // dfTextbox Escape: ClearSelection, cursor/scroll to 0, OnCancel (Text = undoText). The panel stays open.
   if(e.code==='Escape'){e.preventDefault();input.value=undoText;scrollIndex=0;input.setSelectionRange(0,0);paintInput();}});
  input.addEventListener('keyup',e=>e.stopPropagation());
  // The buttons and panel never take focus (dfButton/dfPanel canFocus 0): the textbox keeps it, without a new select-on-focus.
  section.addEventListener('mousedown',e=>{if(e.target!==input&&visible)e.preventDefault();});section.addEventListener('pointerdown',e=>{if(e.target!==input&&visible)queueMicrotask(()=>{if(document.activeElement!==input)input.focus();});});
  const layout=()=>{tree.layout();paintInput();};addEventListener('resize',()=>{if(visible)layout();});
  return {tree,root,textbox,label,input,layout,paintInput,startBlink(){blinkStart=performance.now();phase=-1;if(!frame)frame=requestAnimationFrame(blink);}};
 }
 // LockEntry.SetVisible(true): label by changingEntry, Show + BringToFront, Text = "", Focus.
 function open(){pendingShow=false;if(!ui)return;ui.tree.setText(ui.label,changing?'New Password:':'Password:');section.hidden=false;visible=true;ui.input.value='';ui.layout();ui.input.focus();ui.startBlink();}
 // LockEntry.PasswordEntered.
 function passwordEntered(){if(!visible||!ui)return;const code=ui.input.value,problem=codeError(code);if(problem){popup(problem,LOCK_NOTICE_ICON,LOCK_NOTICE_SECONDS);return;}const fn=submit;hide();fn?.(code,changing);}
 // LockEntry.SetVisible(false): Hide + Unfocus (OnDisable releases the cursor unlock node).
 function hide(){const was=visible||pendingShow;pendingShow=false;visible=false;submit=null;section.hidden=true;if(ui){ui.input.blur();ui.input.value='';}if(was)onClose();}
 return {element:section,ready,
  // LockEntry.Show(changing) (lockentry.show): the cursor is released (UnlockCursorNode) and game input stops (HumanController).
  show(change,onSubmit){changing=Boolean(change);submit=onSubmit;if(failed)return;onOpen();if(ui)open();else pendingShow=true;},
  hide,isOpen:()=>visible||pendingShow,
  snapshot:()=>({visible,label:ui?.label.text??null,text:ui?.input.value??null,rect:ui?.root.rect&&{...ui.root.rect}})};
}
