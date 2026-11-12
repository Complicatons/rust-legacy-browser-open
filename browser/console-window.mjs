import {createDfTree} from './dfgui.mjs';
import {color32} from './popup-ui.mjs';
import {tokenizeMarkup,markupColor} from './chat.mjs';
// Original F1 console window (BuildPlayer-GameUI ConsoleWindow, ConsoleWindow.cs) drawn from the static export
// (tools/export_frontend.py) with the dfGUI renderer: window_background panel anchored top-right, drag handle with the
// "Rust Console" Small Fonts title, the QuickRun icon buttons (RunConsoleCommand, asIfTypedIntoConsole), the scrollbar
// containing the text_input scroll panel with the output dfLabel (Small Fonts, word wrap, auto height, markup), the faint
// gear watermark, the BLANK_CURVED thumb, the text_input/text_input_active textbox and the resize handle.
// ConsoleWindow.OnInput runs the textbox text as typed (untrimmed, empty lines too); there is no command history, no
// local `clear` (it goes to the server like any unknown command) and Escape does not close it (only F1 does).

// ConsoleWindow.TrimBuffer: once the output reaches 5000 characters, its first line goes (once per AddText).
export const CONSOLE_TRIM_LENGTH=5000;
// ConsoleWindow.AddText(str, bFromServer): server text is wrapped in [color #00ffff] and ends with an extra line.
export function appendConsoleText(text,str,fromServer=false){
 if(fromServer)str='[color #00ffff]'+str+'[/color]\n';
 let out=text+str+'\n';
 if(out.length>=CONSOLE_TRIM_LENGTH){const i=out.indexOf('\n');if(i!==-1)out=out.slice(i+1);}
 return out;}
// ConsoleWindow.RunCommand echo and client output colours.
export const echoLine=input=>'[color #00ff00]> '+input+'[/color]';
export const outputLine=text=>'[color #ffff00]'+text+'[/color]';
// ConsoleWindow.CaptureLog (ConsoleSystem log callback): Debug.Log lines in #eeeeee, warnings, errors and exceptions in
// #ff0000, both after "> "; two uLink/screenshot messages are skipped (null).
export function captureLine(log,type='log'){log=String(log??'');if(log.startsWith('This uLink evaluation license is temporary.')||log.startsWith('Failed to capture screen shot'))return null;
 return (type==='log'?'[color #eeeeee]> ':'[color #ff0000]> ')+log+'[/color]';}

// dfFont glyph advance with kerning (dfFont.GetCharacterWidths).
export function glyphWidths(face,text){const out=[];let prev=null;for(const ch of text){const id=ch.codePointAt(0),g=face.glyphs.get(id);if(!g){out.push(0);prev=null;continue;}out.push((prev!==null?face.kerning.get(prev+','+id)??0:0)+g.xadvance);prev=id;}return out;}
const sum=a=>a.reduce((n,v)=>n+v,0);

// dfFont.calculateLinebreaks + renderLine for a word-wrapped, multi-line, markup-processing dfLabel. A newline token ends
// a line; a text token whose width would reach MaxSize.x breaks the line at the last whitespace token after the line
// start (that whitespace belongs to neither line; scanning restarts after it); a line without whitespace overflows.
// [color] pushes a colour, [/color] pops while more than one remains; the stack carries across lines. Text is tinted by
// the label colour. Returns rows {runs:[{text,color,width}], line} (line = index of the '\n'-separated buffer line).
export function layoutConsoleText(text,face,maxWidth,defaultColor={r:255,g:255,b:255,a:1}){
 const tokens=tokenizeMarkup(text),width=t=>t.type==='text'||t.type==='whitespace'?Math.ceil(sum(glyphWidths(face,t.value))):0,ranges=[];
 let breakAt=0,start=0,i=0,w=0;
 while(i<tokens.length){const t=tokens[i];
  if(t.type==='newline'){ranges.push([start,i]);start=breakAt=++i;w=0;continue;}
  const tw=width(t);
  if(breakAt>start&&t.type==='text'&&w+tw>=maxWidth){ranges.push([start,breakAt-1]);start=i=++breakAt;w=0;continue;}
  if(t.type==='whitespace')breakAt=i;w+=tw;i++;}
 if(start<tokens.length)ranges.push([start,tokens.length-1]);
 const WHITE={r:255,g:255,b:255,a:1},colors=[WHITE],rows=[];
 const tint=c=>({r:Math.trunc(c.r*defaultColor.r/255),g:Math.trunc(c.g*defaultColor.g/255),b:Math.trunc(c.b*defaultColor.b/255),a:c.a*defaultColor.a});
 let line=0,consumed=0;const lineOf=at=>{for(;consumed<at;consumed++)if(tokens[consumed].type==='newline')line++;return line;};
 for(const [a,b] of ranges){const runs=[],row={runs,line:lineOf(a)};
  for(let k=a;k<=b;k++){const t=tokens[k];
   if(t.type==='start'){if(t.value.toLowerCase()==='color')colors.push(markupColor(t.attributes,defaultColor));}
   else if(t.type==='end'){if(t.value.toLowerCase()==='color'&&colors.length>1)colors.pop();}
   else if(t.type==='text'||t.type==='whitespace')runs.push({text:t.value,color:tint(colors.at(-1)),width:width(t)});}
  rows.push(row);}
 return rows;}
// The buffer line without markup tags (what a reader sees).
export const plainLine=raw=>tokenizeMarkup(raw).filter(t=>t.type==='text'||t.type==='whitespace').map(t=>t.value).join('');

// dfScrollPanel/dfScrollbar values for the output: view height (dfScrollPanel.calculateViewSize with the label at
// scrollPadding.top - scroll), the scroll range and the thumb (dfScrollbar.updateThumb).
export function consoleScroll({contentHeight,panelHeight,padding=8,scroll=0}){
 const inner=panelHeight-2*padding,maxScroll=Math.max(0,contentHeight-inner),s=Math.max(0,Math.min(maxScroll,Math.round(scroll)));
 const maxValue=Math.max(padding+contentHeight-s,inner)-(padding-s);
 return {scroll:s,maxScroll,maxValue,scrollSize:inner,value:s};}
export function thumbRect({maxValue,scrollSize,value},track,{thumbWidth=16,padTop=1,padBottom=1,minHeight=0}={}){
 if(maxValue<=0||maxValue<=scrollSize)return null;
 const h=Math.max(scrollSize/maxValue*track.height,minHeight),k=(value)/(maxValue-scrollSize);
 return {x:track.x+(track.width-thumbWidth)*0.5,y:track.y+padTop+k*(track.height-h),width:thumbWidth,height:h-padTop-padBottom};}

// One rendered line of bitmap text (coloured runs) on a canvas.
function drawRuns(face,runs){const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');const w=Math.max(1,Math.ceil(sum(runs.map(r=>r.width)))),h=face.font.lineHeight;canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;let x=0;
 for(const run of runs){const widths=glyphWidths(face,run.text);if(run.text.trim()===''){x+=sum(widths);continue;}
  const tmp=document.createElement('canvas');tmp.width=Math.max(1,Math.ceil(sum(widths)));tmp.height=h;const t=tmp.getContext('2d');t.imageSmoothingEnabled=false;let gx=0,prev=null;
  for(const ch of run.text){const id=ch.codePointAt(0),g=face.glyphs.get(id);if(!g){prev=null;continue;}if(prev!==null)gx+=face.kerning.get(prev+','+id)??0;t.drawImage(face.image,g.x,g.y,g.width,g.height,gx+g.xoffset,g.yoffset,g.width,g.height);gx+=g.xadvance;prev=id;}
  const c=run.color;if(c.r!==255||c.g!==255||c.b!==255){t.globalCompositeOperation='source-in';t.fillStyle=`rgb(${c.r},${c.g},${c.b})`;t.fillRect(0,0,tmp.width,tmp.height);}
  ctx.globalAlpha=c.a;ctx.drawImage(tmp,x,0);ctx.globalAlpha=1;x+=sum(widths);}
 canvas.style.width=w+'px';canvas.style.height=h+'px';return canvas;}

export function createConsoleWindow({assets,container=document.body,command=()=>null,onShow=()=>{},onHide=()=>{}}){
 const screen=assets.manifest.screens.ConsoleWindow;if(!screen)throw Error('Original ConsoleWindow export missing');
 const section=document.createElement('section');section.id='game-console';section.className='df-host';section.hidden=true;section.setAttribute('aria-label','Rust Console');container.append(section);
 const viewport=()=>({width:innerWidth,height:innerHeight});
 const tree=createDfTree(screen.nodes,assets,{container:section,className:'df-console',viewport});
 const root=tree.items[0],cw=root.node.components.ConsoleWindow[0],item=id=>tree.item(id);
 const output=item(cw.consoleOutput.m_PathID),textbox=item(cw.consoleInput.m_PathID),scrollbar=item(cw.consoleScroller.m_PathID);
 const sb=scrollbar.control.data,panel=tree.items.find(i=>i.control?.kind==='dfScrollPanel'),track=item(sb.track.m_PathID),thumb=item(sb.thumb.m_PathID);
 const dragHandle=tree.items.find(i=>i.control?.kind==='dfDragHandle'),resizeHandle=tree.items.find(i=>i.control?.kind==='dfResizeHandle');
 // dfControl.clipChildren (the scrollbar clips the gear watermark and the scrolled label).
 for(const i of tree.items)if(i.el&&i.control.data.clipChildren)i.el.style.overflow='hidden';
 const od=output.control.data,face=assets.bitmaps.get(od.fontKey),labelColor=color32(od.color.rgba);
 // Output label: the original text buffer, drawn line by line (each line a <p> for reading back), scrolled by the panel.
 let text=od.text??'',scroll=0,shouldScrollDown=true;output.text='';const lines=document.createElement('div');lines.className='console-log';lines.setAttribute('role','log');output.el.append(lines);
 // dfTextbox: a real (transparent) input keeps editing, selection, IME and the trusted submit; the original look is drawn.
 const td=textbox.control.data,inputFace=assets.bitmaps.get(td.fontKey),textColor=color32(td.textColor.rgba),selection=color32(td.selectionBackground.rgba);
 const form=document.createElement('form');form.className='console-form';const input=document.createElement('input');Object.assign(input,{id:'console-input',maxLength:td.maxLength,autocomplete:'off',spellcheck:false});input.setAttribute('aria-label','Console command');
 const drawn=document.createElement('div');drawn.className='console-input-text';drawn.setAttribute('aria-hidden','true');form.append(input);textbox.el.append(drawn,form);
 let blinkStart=performance.now(),scrollIndex=0,frame=0;
 function paintInput(){const value=input.value,widths=glyphWidths(inputFace,value),pad=td.padding,inner=textbox.rect?textbox.rect.width-pad.m_Left-pad.m_Right:0;
  const start=Math.min(input.selectionStart??value.length,value.length),end=Math.min(input.selectionEnd??start,value.length),cursor=input.selectionDirection==='backward'?start:end;
  // dfTextbox.renderText (left aligned): scrollIndex never passes the cursor and advances until the cursor fits.
  scrollIndex=Math.min(scrollIndex,cursor,value.length);let w=sum(widths.slice(scrollIndex,cursor));while(w>=inner&&scrollIndex<cursor)w-=widths[scrollIndex++];
  drawn.replaceChildren();const shown=value.slice(scrollIndex);const canvas=drawRuns(inputFace,[{text:shown,color:textColor,width:sum(glyphWidths(inputFace,shown))}]);canvas.className='console-input-glyphs';
  Object.assign(drawn.style,{left:pad.m_Left+'px',top:pad.m_Top+'px',width:Math.max(0,inner)+'px',height:Math.max(0,(textbox.rect?.height??0)-pad.m_Top-pad.m_Bottom)+'px'});
  if(start!==end){const a=Math.max(start,scrollIndex),x0=sum(widths.slice(scrollIndex,a)),x1=sum(widths.slice(scrollIndex,Math.max(a,end)));const sel=document.createElement('i');sel.className='console-selection';Object.assign(sel.style,{left:x0+'px',width:Math.max(0,x1-x0)+'px',background:`rgb(${selection.r},${selection.g},${selection.b})`});drawn.append(sel);}
  else if(document.activeElement===input&&Math.floor((performance.now()-blinkStart)/(td.cursorBlinkTime*1000))%2===0){const caret=document.createElement('i');caret.className='console-caret';Object.assign(caret.style,{left:Math.round(sum(widths.slice(scrollIndex,cursor)))+'px',width:td.cursorWidth+'px',background:`rgb(${textColor.r},${textColor.g},${textColor.b})`});drawn.append(caret);}
  drawn.append(canvas);}
 // dfTextbox cursor blink (cursorBlinkTime on/off): repaint only when the phase changes.
 let phase=-1;const blink=()=>{frame=0;if(section.hidden)return;const p=Math.floor((performance.now()-blinkStart)/(td.cursorBlinkTime*1000));if(p!==phase){phase=p;paintInput();}frame=requestAnimationFrame(blink);};
 for(const e of ['input','select','keyup','keydown','focus','blur','pointerup'])input.addEventListener(e,()=>{blinkStart=performance.now();queueMicrotask(paintInput);});
 input.addEventListener('focus',()=>{textbox.focused=true;tree.paint(textbox);});input.addEventListener('blur',()=>{textbox.focused=false;tree.paint(textbox);});
 function render(){const r=output.rect;if(!r)return;const rows=layoutConsoleText(text,face,r.width,labelColor),buffer=text.split('\n'),ps=[];
  // One <p> per buffer line (its wrapped rows inside); the plain text is kept for reading back.
  for(const row of rows){let p=ps.at(-1);if(!p||Number(p.dataset.line)!==row.line){p=document.createElement('p');p.dataset.line=String(row.line);p.append(Object.assign(document.createElement('span'),{className:'console-plain',textContent:plainLine(buffer[row.line]??'')}));ps.push(p);}
   p.insertBefore(drawRuns(face,row.runs),p.lastChild);}
  lines.replaceChildren(...ps);
  const h=rows.length*face.font.lineHeight;output.size={x:od.size.x,y:h};
  applyScroll();}
 function applyScroll(){const pr=panel.rect,h=output.size?.y??0;if(!pr)return;const pad=panel.control.data.scrollPadding.m_Top,s=consoleScroll({contentHeight:h,panelHeight:pr.height,padding:pad,scroll});scroll=s.scroll;state=s;
  output.el.style.transform=`translateY(${-scroll}px)`;output.el.style.height=h+'px';
  const t=thumbRect(s,track.rect??{x:0,y:0,width:0,height:0},{thumbWidth:thumb.control.data.size.x,padTop:sb.thumbPadding.m_Top,padBottom:sb.thumbPadding.m_Bottom});
  if(!t){tree.setVisible(thumb,false);return;}
  thumb.position={x:t.x,y:t.y};thumb.size={x:t.width,y:t.height};thumb.rect={...t};Object.assign(thumb.el.style,{left:t.x+'px',top:t.y+'px',width:t.width+'px',height:t.height+'px'});tree.setVisible(thumb,true);tree.paint(thumb);}
 let state={maxValue:0,scrollSize:0,value:0};
 // ConsoleWindow.Update: snap to the bottom when AddText found the view within 50 px of it.
 function scrollToBottomIfNeeded(){if(shouldScrollDown&&state.value!==state.maxValue-state.scrollSize){scroll=Infinity;applyScroll();shouldScrollDown=false;}}
 function layout(){tree.layout(viewport());render();paintInput();}
 // dfScrollPanel.OnMouseWheel: vertScroll.IncrementAmount (50) x the "Mouse ScrollWheel" axis (InputManager sensitivity .1 per notch).
 panel.el.addEventListener('wheel',e=>{e.preventDefault();const notches=e.deltaMode===1?e.deltaY/3:e.deltaMode===2?e.deltaY:e.deltaY/100;scroll+=sb.increment*0.1*notches;applyScroll();},{passive:false});
 // dfDragHandle moves the window; dfResizeHandle (edges Right|Bottom) resizes it; children re-anchor.
 const drag=(handle,fn)=>{if(!handle?.el)return;handle.el.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();handle.el.setPointerCapture(e.pointerId);const start={x:e.clientX,y:e.clientY,rect:{...root.rect}};
  const move=ev=>{fn(start,ev.clientX-start.x,ev.clientY-start.y);layout();},up=()=>{handle.el.removeEventListener('pointermove',move);handle.el.removeEventListener('pointerup',up);};handle.el.addEventListener('pointermove',move);handle.el.addEventListener('pointerup',up);});};
 drag(dragHandle,(s,dx,dy)=>{root.position={x:s.rect.x+dx,y:s.rect.y+dy};});
 drag(resizeHandle,(s,dx,dy)=>{root.position={x:s.rect.x,y:s.rect.y};root.size={x:Math.max(1,s.rect.width+dx),y:Math.max(1,s.rect.height+dy)};});
 addEventListener('resize',()=>{if(!section.hidden)layout();});
 function addText(str,fromServer=false){text=appendConsoleText(text,str,fromServer);if(state.value>=state.maxValue-state.scrollSize-50)shouldScrollDown=true;if(!section.hidden){render();scrollToBottomIfNeeded();}}
 // ConsoleWindow.RunCommand (echo, run client side or forward, yellow client output).
 function runCommand(line,{trusted=false,raw=line}={}){addText(echoLine(line));
  const reply=command(line,{trusted,raw});if(reply?.text)addText(outputLine(reply.text));}
 // ConsoleWindow.OnInput (dfTextbox submit): the text exactly as typed, emptied first.
 form.addEventListener('submit',e=>{e.preventDefault();const raw=input.value;input.value='';scrollIndex=0;runCommand(raw,{trusted:e.isTrusted,raw});paintInput();});
 // QuickRun buttons: RunConsoleCommand.RunCommandImmediately with asIfTypedIntoConsole.
 for(const i of tree.items){const rc=i.node.components.RunConsoleCommand?.[0];if(!rc)continue;i.el.dataset.command=rc.consoleCommand;i.el.setAttribute('aria-label',rc.consoleCommand);tree.on(i,'Click',()=>{if(rc.asIfTypedIntoConsole)runCommand(rc.consoleCommand);else command(rc.consoleCommand,{trusted:false});});}
 const visible=()=>!section.hidden;
 // ConsoleWindow.Update (F1): Show + BringToFront + focus, or unfocus + Hide; the textbox is emptied either way.
 function show(){section.hidden=false;input.value='';scrollIndex=0;layout();scrollToBottomIfNeeded();input.focus();onShow();if(!frame)frame=requestAnimationFrame(blink);}
 function hide(){input.blur();input.value='';section.hidden=true;onHide();}
 return {element:section,input,form,tree,show,hide,toggle(){if(visible())hide();else show();},isVisible:visible,addText,runCommand,
  text:()=>text,clear(){text='';scroll=0;if(visible())render();},
  snapshot:()=>({visible:visible(),rect:root.rect&&{...root.rect},scroll,maxValue:state.maxValue,scrollSize:state.scrollSize,thumb:tree.isVisible(thumb),lines:text.split('\n')})};
}
