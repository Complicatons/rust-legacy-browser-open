import {loadFrontendSkin} from './frontend-skin.mjs';
import {color32} from './popup-ui.mjs';
import {anchorLayout} from './death-screen.mjs';
import {controlOf,paintSprite} from './dfgui.mjs';
// Original text chat (ChatUI.cs, ChatLine.cs, chat.cs client + server, ConsoleSystem.Arg, Facepunch.Utility.String,
// dfMarkupTokenizer/dfDynamicFont markup, TimedObjectDestructor). Layout, colours, fonts and timings come from the static
// HUD export (tools/export_chat.py: rust/ui/game/HUD pnlChat + the ChatLine prefab).
//
// Flow: GameInput "Chat" (Return / T, GameInput.Buttons + default binds) -> HumanController.Poll -> ChatUI.Open (text "",
// show, focus, ClearText after .05 s, cursor unlock node on). Return (dfControlKeyBinding 13) -> SendChat ->
// ConsoleNetworker.SendCommandToServer("chat.say " + QuoteSafe(text)) -> SV_RunConsoleCommand on view 997. Escape
// (dfControlKeyBinding 27) and LostFocus -> CancelChatting: text "" now, .2 s later TryLock + Unfocus + Hide.
// Server chat.say (User): NetUser.CanChat (>1 s since the last line), text cut to 128, broadcast
// "chat.add " + QuoteSafe(Displayname) + " " + QuoteSafe(text) to every client (CL_ConsoleCommand); global.say (Admin)
// broadcasts chat.add "SERVER CONSOLE" <text>. Client chat.add (chat.enabled) -> ChatUI.AddLine(name + ":", text):
// a pnlChatLine instance stacked bottom-up by ReLayout, destroyed after TimedObjectDestructor.timeOut (16 s).

// ---- ConsoleSystem / Facepunch.Utility.String (identical in the client and server assemblies) ----
// ConsoleSystem.Arg.RemoveInvalidCharacters keeps char.IsLetterOrDigit / IsPunctuation / IsSeparator / IsSymbol per UTF-16
// unit: control characters, format characters, combining marks and surrogate halves (emoji) are dropped.
const KEPT=/^[\p{L}\p{Nd}\p{P}\p{Z}\p{S}]$/u;
export function removeInvalidCharacters(str){if(str==null)return null;let out='';for(let i=0;i<str.length;i++){const c=str[i];if(KEPT.test(c))out+=c;}return out;}
// String.QuoteSafe: escape double quotes, then drop trailing backslashes, then wrap in quotes.
export function quoteSafe(str){return '"'+String(str).replaceAll('"','\\"').replace(/\\+$/,'')+'"';}
const trimChars=(s,chars)=>{let a=0,b=s.length;while(a<b&&chars.includes(s[a]))a++;while(b>a&&chars.includes(s[b-1]))b--;return s.slice(a,b);};
// String.SplitQuotesStrings: \" -> &qute;, regex "([^"]+)"|'([^']+)'|\S+, each whole match trimmed of ' ' and '"'.
export function splitQuotesStrings(input){input=input.replaceAll('\\"','&qute;');return [...input.matchAll(/"([^"]+)"|'([^']+)'|\S+/g)].map(m=>trimChars(m[0],' "').replaceAll('&qute;','"'));}
// ConsoleSystem.Arg(string): class before the first '.', lower-cased (no '.' or a space before it -> "global."); the
// function keeps its case (Function.ToLower()'s result is discarded; Type.GetMethod is case-sensitive).
export function parseConsoleArg(command){const r={invalid:true,className:'',fn:'',args:null};let s=removeInvalidCharacters(String(command??''));
 const dot=s.indexOf('.');if(dot<=0||s.slice(0,dot).includes(' '))s='global.'+s;const d=s.indexOf('.');if(d<=0)return r;
 const cls=s.slice(0,d);if(cls.length<=1)return r;r.className=cls.toLowerCase();let fn=s.slice(r.className.length+1);r.fn=fn;
 if(fn.length>1){r.invalid=false;const sp=fn.indexOf(' ');if(sp>0){r.args=splitQuotesStrings(fn.slice(sp).trim());r.fn=fn.slice(0,sp);}}return r;}
// Arg.GetString -> Parse.DefaultString: a missing or empty argument gives the default.
export function argString(arg,i,def=''){const v=arg.args&&arg.args.length>=i+1?arg.args[i]:null;return v?v:def;}

// ---- chat.cs ----
export const CHAT_SERVER_MAX=128,CHAT_INTERVAL=1;
// dfTextbox: OnKeyPress ignores char.IsControl, pasteAtCursor keeps c >= ' ', Text is cut to maxLength (128 in the HUD).
export function chatInputText(text,maxLength=CHAT_SERVER_MAX){return String(text??'').replace(/[\x00-\x1f\x7f-\x9f]/g,'').slice(0,maxLength);}
// ChatUI.SendChat: the only command the chat box can produce. Empty text sends nothing.
export function chatSayCommand(text,maxLength=CHAT_SERVER_MAX){const t=chatInputText(text,maxLength);return t===''?null:'chat.say '+quoteSafe(t);}
// Server chat.say (and global.say) for the offline island, where this browser is its own server.
export function serverChatSay(command,{name,time,lastChat=-Infinity,enabled=true}){const arg=parseConsoleArg(command),none={broadcast:null,lastChat};
 if(arg.invalid||arg.className!=='chat'||arg.fn!=='say')return none;
 if(!enabled||!(time-lastChat>CHAT_INTERVAL))return none; // NetUser.CanChat: Time.time - fLastChat > 1
 let text=argString(arg,0,'text');if(text.length>CHAT_SERVER_MAX)text=text.slice(0,CHAT_SERVER_MAX);
 return {broadcast:'chat.add '+quoteSafe(name)+' '+quoteSafe(text),lastChat:time};}
export function serverSay(text){const t=quoteSafe(text);return 'chat.add "SERVER CONSOLE" '+t;} // global.say
// Client chat.add: both arguments must be non-empty. Anything else is not a chat line (never executed).
export function chatAddLine(command,{enabled=true}={}){if(typeof command!=='string')return null;const arg=parseConsoleArg(command);
 if(arg.invalid||arg.className!=='chat'||arg.fn!=='add')return null;if(!enabled)return {ignored:true};const name=argString(arg,0,''),text=argString(arg,1,'');
 return name===''||text===''?{ignored:true}:{name,text};}
// The offline island has no Steam persona (NetUser.user.Displayname): the signed-in website name is used, else this
// placeholder (a port choice; the original had no offline play).
export const LOCAL_PLAYER_NAME='Player';
export function createLocalChatServer({name=()=>'',time=()=>performance.now()/1000}={}){let last=-Infinity;
 return command=>{const r=serverChatSay(command,{name:name(),time:time(),lastChat:last});last=r.lastChat;return r.broadcast;};}

// ---- dfMarkupTokenizer (dfLabel.ProcessMarkup; lblChatText has it on, lblChatName off) ----
const isLetter=c=>/^\p{L}$/u.test(c),isLetterOrDigit=c=>/^[\p{L}\p{Nd}]$/u.test(c);
const isWhiteSpace=c=>c==='\x85'||(c!=='﻿'&&/^\s$/.test(c)); // char.IsWhiteSpace
const VALID_TAGS=['color','sprite'];
// Exact port, including inclusive end offsets and Advance() returning the character it lands on. Token values are
// Source.Substring(start, min(end - start + 1, length - start)).
export function tokenizeMarkup(source){const tokens=[];let index=0;const len=source.length;
 const peek=(o=0)=>index+o>len-1?'\0':source[index+o],advance=(n=1)=>{index+=n;return peek();};
 const obtain=(type,start,end)=>({type,start,end,attributes:[],value:source.substring(start,start+Math.max(0,Math.min(end-start+1,len-start)))});
 const isValidTag=(at,endTag)=>{for(const tag of VALID_TAGS){let ok=true;for(let j=0;j<tag.length-1&&j+at<len-1&&(endTag||source[j+at]!==' ')&&source[j+at]!==']';j++)if(tag[j].toLowerCase()!==source[j+at].toLowerCase()){ok=false;break;}if(ok)return true;}return false;};
 const atTag=()=>{if(peek()!=='[')return false;const c=peek(1);if(c==='/')return isLetter(peek(2))?isValidTag(index+2,true):false;return isLetter(c)?isValidTag(index+1,false):false;};
 const whitespace=()=>{const start=index;let end=index;if(peek()==='\n'){advance();return obtain('newline',start,start);}while(index<len){const c=advance();if(c==='\n'||c==='\r'||!isWhiteSpace(c))break;end++;}return obtain('whitespace',start,end);};
 const nonWhitespace=()=>{const start=index;let end=index;while(index<len){const c=advance();if(isWhiteSpace(c)||atTag())break;end++;}return obtain('text',start,end);};
 const quoted=()=>{const q=peek();if(q!=='"'&&q!=="'")return null;advance();const start=index;let end=index;while(index<len&&advance()!==q)end++;if(peek()===q)advance();return obtain('text',start,end);};
 const endTag=()=>{advance(2);const start=index;let end=index;while(index<len&&isLetterOrDigit(advance()))end++;if(peek()===']')advance();return obtain('end',start,end);};
 const tag=()=>{if(peek()!=='[')return null;if(peek(1)==='/')return endTag();advance();if(!isLetterOrDigit(peek()))return null;const start=index;let end=index;while(index<len&&isLetterOrDigit(advance()))end++;
  const t=obtain('start',start,end);
  if(index<len&&peek()!==']'){if(isWhiteSpace(peek()))whitespace();const s2=index;let e2=index;if(peek()==='"')t.attributes.push(quoted().value);else{while(index<len&&advance()!==']')e2++;t.attributes.push(obtain('text',s2,e2).value);}}
  if(peek()===']')advance();return t;};
 while(index<len){const c=peek();if(atTag()){const t=tag();if(t)tokens.push(t);continue;}let t=null;if(isWhiteSpace(c)){if(c!=='\r')t=whitespace();}else t=nonWhitespace();if(t===null)advance();else tokens.push(t);}
 return tokens;}
const matches=(t,name)=>t.value.length===name.length&&t.value.toLowerCase()===name;
// dfMarkupStyle.namedColors as Color32 (Unity Color.gray .5 -> 127, Color.yellow (1,.9216,.0157) -> 255,235,4).
export const NAMED_COLORS=Object.freeze({aqua:[0,255,255],black:[0,0,0],blue:[0,0,255],cyan:[0,255,255],fuchsia:[255,0,255],gray:[127,127,127],green:[0,255,0],lime:[0,255,0],magenta:[255,0,255],maroon:[128,0,0],navy:[0,0,128],olive:[128,128,0],orange:[255,165,0],purple:[128,0,128],red:[255,0,0],silver:[192,192,192],teal:[0,128,128],white:[255,255,255],yellow:[255,235,4]});
const rgb=([r,g,b])=>({r,g,b,a:1}),WHITE=rgb([255,255,255]);
// uint.TryParse(NumberStyles.HexNumber): optional ASCII white space around hex digits, value must fit 32 bits.
const hexUint=s=>{const m=/^[\t\n\v\f\r ]*([0-9a-fA-F]+)[\t\n\v\f\r ]*$/.exec(s);if(!m)return null;const v=BigInt('0x'+m[1]);return v>0xFFFFFFFFn?null:Number(v);};
const fromUint=v=>rgb([(v>>>16)&255,(v>>>8)&255,v&255]);
// dfDynamicFont.parseColor: one attribute; "#RRGGBB" (7 chars, a failed parse gives black) else dfMarkupStyle.ParseColor
// ("#..." other lengths: red when unparsable; named colours; otherwise the label colour). No attribute: white.
export function markupColor(attributes,defaultColor=WHITE){if(attributes.length!==1)return WHITE;const v=attributes[0];
 if(v.length===7&&v[0]==='#')return fromUint(hexUint(v.slice(1))??0);
 if(v.startsWith('#')){const n=hexUint(v.slice(1));return n===null?rgb([255,0,0]):fromUint(n);}
 const named=NAMED_COLORS[v.toLowerCase()];return named?rgb(named):defaultColor;}
const multiply=(a,b)=>({r:Math.trunc(a.r*b.r/255),g:Math.trunc(a.g*b.g/255),b:Math.trunc(a.b*b.b/255),a:a.a*b.a});
// dfDynamicFont render order: colour stack starts white; [color] pushes, [/color] pops while more than one remains; text
// is tinted colour x label colour; [sprite name] draws that atlas sprite in the current colour; other tags draw nothing.
export function markupRuns(text,{defaultColor=WHITE}={}){const colors=[WHITE],runs=[];
 for(const t of tokenizeMarkup(text)){if(t.type==='text'||t.type==='whitespace')runs.push({kind:t.type,text:t.value,color:multiply(colors.at(-1),defaultColor)});
  else if(t.type==='start'){if(matches(t,'sprite')){if(t.attributes.length===1)runs.push({kind:'sprite',name:t.attributes[0],color:colors.at(-1)});}else if(matches(t,'color'))colors.push(markupColor(t.attributes,defaultColor));}
  else if(t.type==='end'&&matches(t,'color')&&colors.length>1)colors.pop();}
 return runs;}

// ---- layout (ChatUI.ReLayout, dfAnchorStyle via death-screen.mjs anchorLayout) ----
// Parent-relative rectangles of every exported control; the HUD root anchors to the (pixel-perfect GameUI) screen.
export function hudLayout(nodes,viewport){const rects=[];nodes.forEach((n,i)=>{const c=controlOf(n);if(!c)return;const p=n.parent>=0?rects[n.parent]:null;
 rects[i]={name:n.name,kind:c.kind,data:c.data,...anchorLayout(c.data.layout,c.data.size,p?{x:p.width,y:p.height}:{x:viewport.width,y:viewport.height})};});return rects;}
// ReLayout: container at (0,0); children stacked so the newest line's bottom meets the container's bottom.
export function stackLines(heights,containerHeight){const total=heights.reduce((a,b)=>a+b,0);let y=containerHeight-total;return heights.map(h=>{const top=y;y+=h;return top;});}
// The fields ChatUI/ChatLine read from the export.
export function chatPrefab(manifest){const all=list=>list.flatMap(n=>Object.values(n.components).flat()),hud=manifest.hud.nodes,line=manifest.chatLine.nodes;
 const byPath=(list,id)=>all(list).find(c=>c.pathID===id),index=(list,id)=>list.findIndex(n=>Object.values(n.components).flat().some(c=>c.pathID===id));
 const chatLine=line[0].components.ChatLine[0],timed=line[0].components.TimedObjectDestructor?.[0],pnlChat=hud.findIndex(n=>n.components.ChatUI);
 const keys=Object.fromEntries((hud[pnlChat].components.dfControlKeyBinding??[]).map(k=>[k.keyCode,k.target.MemberName]));
 const events=(hud[pnlChat].components.dfEventBinding??[]).map(e=>({source:e.DataSource.Component.m_PathID,event:e.DataSource.MemberName,target:e.DataTarget.MemberName}));
 const label=id=>{const d=byPath(line,id);return {data:d,rect:anchorLayout(d.layout,d.size,line[0].components.dfPanel[0].size)};};
 const textbox=byPath(hud,manifest.textInput),icon=hud.find(n=>n.parent===index(hud,manifest.textInput)&&n.components.dfRichTextLabel)?.components.dfRichTextLabel[0];
 return {pnlChat,textboxIndex:index(hud,manifest.textInput),containerIndex:index(hud,manifest.chatContainer),textbox,icon,
  line:{panel:line[0].components.dfPanel[0],name:label(chatLine.lblName.m_PathID),text:label(chatLine.lblText.m_PathID),timeOut:timed?.timeOut??1},
  keys,events,maxLength:textbox.maxLength};}

// ---- the HUD ChatUI ----
const SHADOW=d=>d.shadow?`${d.shadowOffset.x}px ${-d.shadowOffset.y}px 0 rgba(${color32(d.shadowColor.rgba).r},${color32(d.shadowColor.rgba).g},${color32(d.shadowColor.rgba).b},${color32(d.shadowColor.rgba).a})`:'none';
const css=c=>`rgb(${c.r},${c.g},${c.b})`;
// Browser-only safety cap: lines past the top of pnlChat are clipped (and gone after 16 s) anyway; this only bounds the
// DOM if a server floods chat.add. Far more lines than any screen shows.
export const MAX_DOM_LINES=256;

// canOpen(): HumanController.Poll reaches the Chat button (alive in-game, no console/main menu/lock entry). send(command):
// the server (online SV_RunConsoleCommand) or the offline island's local chat.say. release()/tryLock(): the cursor unlock
// node (pointer lock). Returns {open, close, isOpen, addLine, consoleCommand, command, snapshot}.
export async function createChatUI({document=globalThis.document,base='/assets/recovered/chat/',skin=loadFrontendSkin(),canOpen=()=>false,send=()=>{},release=()=>{},tryLock=()=>{},gameInput=null,
 now=()=>performance.now(),timers={set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)}}={}){
 const response=await fetch(base+'manifest.json');if(!response.ok)throw Error('Original ChatUI export missing (tools/export_chat.py)');
 const manifest=await response.json(),p=chatPrefab(manifest),s=await skin,frontend=s.manifest;
 const fontName=key=>frontend.fonts[key]?.name??'sans-serif',fontOf=key=>frontend.fonts[key];
 const textSize=d=>{const f=fontOf(d.fontKey);const size=Math.ceil((f?.size??16)*(d.textScale??1));return {size,line:Math.round(size*(f?.lineHeight??f?.size??size)/(f?.size??size))};};
 const layer=document.createElement('div');layer.id='chat-ui';
 const panel=document.createElement('div');panel.className='chat-panel';
 const container=document.createElement('div');container.className='chat-container';container.setAttribute('role','log');container.setAttribute('aria-live','polite');container.setAttribute('aria-label','Chat');
 const box=document.createElement('div');box.className='chat-textbox';box.hidden=true;
 const icon=document.createElement('span');icon.className='chat-quotes';icon.setAttribute('aria-hidden','true');
 const input=document.createElement('input');input.id='chat-input';input.type='text';input.autocomplete='off';input.spellcheck=false;input.maxLength=p.maxLength;input.setAttribute('aria-label','Chat message');
 box.append(icon,input);panel.append(container,box);layer.append(panel);document.body.append(layer);
 // clipChildren clips; it never scrolls (a focused input would otherwise scroll the overflow-hidden panel).
 panel.addEventListener('scroll',()=>{panel.scrollTop=0;panel.scrollLeft=0;});
 // dfTextbox: no background sprite; text colour/scale/padding/shadow, selection colour, 1 px cursor.
 {const d=p.textbox,t=textSize(d),c=color32(d.textColor.rgba),sel=color32(d.selectionBackground.rgba);
  Object.assign(input.style,{fontFamily:`"${fontName(d.fontKey)}"`,fontSize:t.size+'px',color:css(c),caretColor:css(c),textShadow:SHADOW(d),paddingLeft:d.padding.m_Left+'px',paddingRight:d.padding.m_Right+'px',paddingTop:d.padding.m_Top+'px',paddingBottom:d.padding.m_Bottom+'px'});
  layer.style.setProperty('--chat-selection',`rgb(${sel.r},${sel.g},${sel.b})`);}
 if(p.icon){const d=p.icon;icon.textContent=d.text;Object.assign(icon.style,{left:d.layout.margins.left+'px',top:d.layout.margins.top+'px',width:d.size.x+'px',height:d.size.y+'px',fontFamily:`"${fontName(d.fontKey)}"`,fontSize:d.fontSize+'px',lineHeight:d.fontSize+'px',color:css(color32(d.color.rgba))});}
 const place=(el,r)=>Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
 let rects=null;const lines=[];
 function layout(){rects=hudLayout(manifest.hud.nodes,{width:innerWidth,height:innerHeight});const root=rects[0];
  const pr=rects[p.pnlChat];place(panel,{...pr,x:root.x+pr.x,y:root.y+pr.y});place(container,rects[p.containerIndex]);place(box,rects[p.textboxIndex]);reLayout();}
 function reLayout(){if(!rects)return;const ys=stackLines(lines.map(()=>p.line.panel.size.y),rects[p.containerIndex].height);lines.forEach((l,i)=>{l.el.style.top=ys[i]+'px';});}
 addEventListener('resize',layout);layout();
 const spriteFor=name=>{for(const atlas of Object.values(frontend.atlases)){const sprite=atlas.sprites[name];if(sprite)return sprite;}return null;};
 const images=new Map(),image=file=>{if(!images.has(file)){const img=new Image();img.src=s.base+file;images.set(file,img.decode().then(()=>img));}return images.get(file);};
 function label(el,l,text,markup){const d=l.data,t=textSize(d);el.className='chat-label';place(el,l.rect);
  Object.assign(el.style,{fontFamily:`"${fontName(d.fontKey)}"`,fontSize:t.size+'px',lineHeight:t.line+'px',textAlign:d.align===2?'right':d.align===1?'center':'left',textShadow:SHADOW(d),color:css(color32(d.color.rgba))});
  if(!markup){el.textContent=text;return;}
  // dfDynamicFont sprite: height Baseline x TextScale, width keeps the atlas cell's aspect.
  const baseline=Math.ceil((fontOf(d.fontKey)?.baseline??16)*(d.textScale??1));
  for(const run of markupRuns(text,{defaultColor:color32(d.color.rgba)})){
   if(run.kind==='sprite'){const sprite=spriteFor(run.name);if(!sprite)continue;const c=document.createElement('canvas');c.className='chat-sprite';const w=Math.ceil(baseline*sprite.width/sprite.height);c.style.width=w+'px';c.style.height=baseline+'px';el.append(c);
    image(sprite.file).then(img=>paintSprite(c,{image:img,border:{left:0,right:0,top:0,bottom:0}},w,baseline,run.color,{sliced:false})).catch(()=>{});continue;}
   const span=document.createElement('span');span.textContent=run.text;span.style.color=css(run.color);el.append(span);}}
 // ChatUI.AddLine: instantiate pnlChatLine, ChatLine.Setup(name + ":", text), AddControl -> ReLayout; destroyed after timeOut.
 function addLine(name,text){const el=document.createElement('div');el.className='chat-line';Object.assign(el.style,{left:'0px',width:p.line.panel.size.x+'px',height:p.line.panel.size.y+'px'});
  const nameEl=document.createElement('span'),textEl=document.createElement('span');label(nameEl,p.line.name,name+':',Boolean(p.line.name.data.processMarkup));label(textEl,p.line.text,text,Boolean(p.line.text.data.processMarkup));
  nameEl.classList.add('chat-name');textEl.classList.add('chat-text');el.append(nameEl,textEl);container.append(el);
  const entry={el,name,text,at:now()};entry.timer=timers.set(()=>remove(entry),p.line.timeOut*1000);lines.push(entry);
  while(lines.length>MAX_DOM_LINES)remove(lines[0]);reLayout();return el;}
 function remove(entry){const i=lines.indexOf(entry);if(i<0)return;lines.splice(i,1);timers.clear(entry.timer);entry.el.remove();reLayout();}
 let visible=false,closing=null,enabled=true;
 const isOpen=()=>visible;
 function open(){if(visible)return false;visible=true;input.value='';box.hidden=false;release();input.focus({preventScroll:true});panel.scrollTop=0;timers.set(()=>{input.value='';},50);return true;}
 // CancelChatting: clear now; .2 s later TryLock, clear, Unfocus (-> LostFocus -> CancelChatting again), Hide.
 // (TryLock runs once the box is hidden here, so the game's own "is any UI open" check lets the cursor lock again.)
 function cancel(){input.value='';timers.set(()=>{input.value='';visible=false;box.hidden=true;if(document.activeElement===input)input.blur();tryLock();},200);}
 function sendChat(){const command=chatSayCommand(input.value,p.maxLength);if(command)send(command);cancel();}
 // dfControlKeyBinding keyCode (Unity KeyCode Return 13 / Escape 27; keypad Enter is KeypadEnter, not bound), no modifiers.
 const KEY_CODE={Enter:13,Escape:27};
 input.addEventListener('keydown',e=>{const member=p.keys[KEY_CODE[e.code]];
  // An IME composition owns Enter (commit) and Escape (cancel): they neither send nor cancel the chat, and they do not
  // reach the page's own Escape handling (MainMenu, RPOS).
  if(e.isComposing||e.keyCode===229){if(member)e.stopPropagation();return;}
  if(e.key==='Tab'){e.preventDefault();return;}
  // Escape goes on to the page: MainMenu.Update and HumanController (RPOS.Hide) read the same key with Input.GetKeyDown.
  if(!member||e.altKey||e.ctrlKey||e.shiftKey||e.metaKey)return;e.preventDefault();if(member!=='CancelChatting')e.stopPropagation();if(member==='SendChat')sendChat();else if(member==='CancelChatting')cancel();});
 if(p.events.some(e=>e.event==='LostFocus'&&e.target==='CancelChatting'))input.addEventListener('blur',()=>{if(visible)cancel();});
 // GameButton "Chat": Return / T by default (Unity KeyCode.Return; keypad Enter is a different key). IsPressed: no auto-repeat.
 // With a GameInput (key-bindings.mjs) the player's Chat binding opens it; otherwise the default keys.
 const typing=t=>t instanceof Element&&t.matches('input,textarea,select,[contenteditable],[contenteditable] *');
 if(gameInput)gameInput.addEventListener('press',e=>{const ev=e.detail.event;if(e.detail.button!=='Chat'||visible||ev?.altKey||ev?.ctrlKey||ev?.metaKey||!canOpen())return;ev?.preventDefault?.();open();});
 else addEventListener('keydown',e=>{if(visible||e.repeat||e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||typing(e.target))return;if(e.code!=='Enter'&&e.code!=='KeyT')return;if(!canOpen())return;e.preventDefault();open();});
 function receive(name,text){if(!enabled)return false;addLine(name,text);return true;}
 return {layer,input,isOpen,open,close:cancel,addLine:receive,
  // A server console command (CL_ConsoleCommand): only chat.add is recognised; returns true when it was a chat command.
  consoleCommand(text){const line=chatAddLine(text,{enabled});if(!line)return false;if(line.name)addLine(line.name,line.text);return true;},
  // Client console (F1): chat.enabled [bool] (chat.cs [Client] field, bool.Parse) and chat.add (ConsoleSystem replies).
  command(text){const arg=parseConsoleArg(text);if(arg.invalid||arg.className!=='chat')return null;
   if(arg.fn==='add'){this.consoleCommand(text);return {text:'command chat.add was executed'};}
   if(arg.fn!=='enabled')return null;const was=enabled?'True':'False';
   if(!arg.args?.length)return {text:`chat.enabled: ${quoteSafe(was)} (Boolean)`};
   const v=arg.args[0].trim().toLowerCase();if(v!=='true'&&v!=='false')return {text:'error setting value: chat.enabled'};
   enabled=v==='true';return {text:`chat.enabled: changed ${quoteSafe(was)} to ${quoteSafe(enabled?'True':'False')} (Boolean)`};},
  snapshot:()=>({open:visible,text:input.value,enabled,lines:lines.map(l=>({name:l.name,text:l.text}))}),
  layout};
}
