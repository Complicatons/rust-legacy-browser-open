// Original key bindings (decompiled GameInput.cs, input.cs, config.cs, OptionsKeyBinding.cs, OptionsWindow.cs,
// HumanController.InputSample.Poll, Context.cs) and the shipped InputManager axes (mainData, read statically by
// tools/_tags-inputmgr.py).
//  - GameInput.Buttons: 16 GameButtons, each with two Unity KeyCode bindings. IsDown/IsPressed/IsReleased below are the
//    original logic (a second binding equal to the first counts once; a press of one binding while the other is held
//    is not a new press).
//  - Defaults: config.cs defaultConfig (also the shipped cfg/client.cfg). `input.bind <Button> <KeyA> <KeyB>` parses
//    names with Enum.Parse(ignoreCase) and keeps the old binding when a name does not parse; unknown buttons are
//    ignored. `input.keys` prints GameInput.GetConfig(). There is no conflict handling: one key may drive several
//    buttons, and all of them act.
//  - Not rebindable in the original (Unity InputManager axes, read with Input.GetButton*): world use "WorldUse"
//    (e / mouse 2) - the "Use" GameButton row exists but nothing reads it - and the belt "UseItem1".."UseItem6" (1-6).
//  - The mouse wheel is not a KeyCode (Unity 4): it cannot be bound. Mouse buttons are Mouse0 (left), Mouse1 (right),
//    Mouse2 (middle), Mouse3/Mouse4 (back/forward).
// Browser-port additions kept outside the bindings: F1 console, the mouse release key, Alt+Enter, Escape.

export const GAME_BUTTONS=['Left','Right','Up','Down','Jump','Duck','Sprint','Fire','AltFire','Reload','Use','Inventory','Flashlight','Laser','Voice','Chat'];
export const DEFAULT_CONFIG=['input.bind Left A None','input.bind Right D None','input.bind Up W None','input.bind Down S None','input.bind Jump Space None','input.bind Duck LeftControl None','input.bind Sprint LeftShift None','input.bind Fire Mouse0 None','input.bind AltFire Mouse1 None','input.bind Reload R None','input.bind Use E None','input.bind Inventory Tab None','input.bind Flashlight F None','input.bind Laser G None','input.bind Voice V None','input.bind Chat Return T'].join('\n');
// InputManager buttons the client reads directly (positiveButton / altPositiveButton as KeyCode names).
export const INPUT_MANAGER_AXES={WorldUse:['E','Mouse2'],UseItem1:['Alpha1','None'],UseItem2:['Alpha2','None'],UseItem3:['Alpha3','None'],UseItem4:['Alpha4','None'],UseItem5:['Alpha5','None'],UseItem6:['Alpha6','None']};
export const STORAGE_KEY='rlb-input-binds';

// Unity 4 UnityEngine.KeyCode values (the order matters: OptionsKeyBinding.FetchKey returns the lowest held code).
export const KEYCODE=(()=>{const k={None:0,Backspace:8,Tab:9,Clear:12,Return:13,Pause:19,Escape:27,Space:32,Exclaim:33,DoubleQuote:34,Hash:35,Dollar:36,Ampersand:38,Quote:39,LeftParen:40,RightParen:41,Asterisk:42,Plus:43,Comma:44,Minus:45,Period:46,Slash:47};
 for(let i=0;i<10;i++)k['Alpha'+i]=48+i;Object.assign(k,{Colon:58,Semicolon:59,Less:60,Equals:61,Greater:62,Question:63,At:64,LeftBracket:91,Backslash:92,RightBracket:93,Caret:94,Underscore:95,BackQuote:96});
 for(let i=0;i<26;i++)k[String.fromCharCode(65+i)]=97+i;k.Delete=127;for(let i=0;i<10;i++)k['Keypad'+i]=256+i;
 Object.assign(k,{KeypadPeriod:266,KeypadDivide:267,KeypadMultiply:268,KeypadMinus:269,KeypadPlus:270,KeypadEnter:271,KeypadEquals:272,UpArrow:273,DownArrow:274,RightArrow:275,LeftArrow:276,Insert:277,Home:278,End:279,PageUp:280,PageDown:281});
 for(let i=1;i<=15;i++)k['F'+i]=281+i;Object.assign(k,{Numlock:300,CapsLock:301,ScrollLock:302,RightShift:303,LeftShift:304,RightControl:305,LeftControl:306,RightAlt:307,LeftAlt:308,RightCommand:309,LeftCommand:310,LeftWindows:311,RightWindows:312,AltGr:313,Help:315,Print:316,SysReq:317,Break:318,Menu:319});
 for(let i=0;i<7;i++)k['Mouse'+i]=323+i;for(let i=0;i<20;i++)k['JoystickButton'+i]=330+i;
 for(let j=1;j<=4;j++)for(let i=0;i<20;i++)k[`Joystick${j}Button${i}`]=330+20*j+i;return Object.freeze(k);})();
const ALIASES={RightApple:'RightCommand',LeftApple:'LeftCommand'};
const BY_LOWER=new Map(Object.keys(KEYCODE).map(n=>[n.toLowerCase(),n]));for(const [a,n] of Object.entries(ALIASES))BY_LOWER.set(a.toLowerCase(),n);
const BY_VALUE=new Map();for(const [n,v] of Object.entries(KEYCODE))if(!BY_VALUE.has(v))BY_VALUE.set(v,n);

// GameButton.ParseKeyCode: Enum.Parse(typeof(KeyCode), name, ignoreCase) - a name or a defined numeric value. null when
// it does not parse (the caller keeps the previous binding).
export function parseKeyCode(name){const s=String(name??'').trim();if(!s)return null;const n=BY_LOWER.get(s.toLowerCase());if(n)return n;
 if(/^[-+]?\d+$/.test(s)){const v=Number(s);return BY_VALUE.get(v)??null;}return null;}

// KeyboardEvent.code -> KeyCode name (Unity's Windows keyboard mapping).
const CODE={Enter:'Return',Escape:'Escape',Space:'Space',Tab:'Tab',Backspace:'Backspace',Delete:'Delete',Insert:'Insert',Home:'Home',End:'End',PageUp:'PageUp',PageDown:'PageDown',
 ArrowUp:'UpArrow',ArrowDown:'DownArrow',ArrowLeft:'LeftArrow',ArrowRight:'RightArrow',ShiftLeft:'LeftShift',ShiftRight:'RightShift',ControlLeft:'LeftControl',ControlRight:'RightControl',
 AltLeft:'LeftAlt',AltRight:'RightAlt',MetaLeft:'LeftWindows',MetaRight:'RightWindows',OSLeft:'LeftWindows',OSRight:'RightWindows',CapsLock:'CapsLock',NumLock:'Numlock',ScrollLock:'ScrollLock',Pause:'Pause',
 PrintScreen:'Print',ContextMenu:'Menu',Help:'Help',Minus:'Minus',Equal:'Equals',BracketLeft:'LeftBracket',BracketRight:'RightBracket',Backslash:'Backslash',IntlBackslash:'Backslash',Semicolon:'Semicolon',
 Quote:'Quote',Backquote:'BackQuote',Comma:'Comma',Period:'Period',Slash:'Slash',NumpadDecimal:'KeypadPeriod',NumpadDivide:'KeypadDivide',NumpadMultiply:'KeypadMultiply',NumpadSubtract:'KeypadMinus',
 NumpadAdd:'KeypadPlus',NumpadEnter:'KeypadEnter',NumpadEqual:'KeypadEquals'};
for(let i=0;i<26;i++){const c=String.fromCharCode(65+i);CODE['Key'+c]=c;}for(let i=0;i<10;i++){CODE['Digit'+i]='Alpha'+i;CODE['Numpad'+i]='Keypad'+i;}for(let i=1;i<=15;i++)CODE['F'+i]='F'+i;
export const keyCodeForCode=code=>CODE[code]??null;
// MouseEvent.button -> KeyCode: 0 left = Mouse0, 2 right = Mouse1, 1 middle = Mouse2, 3/4 = Mouse3/Mouse4.
export const mouseKeyCode=button=>[ 'Mouse0','Mouse2','Mouse1','Mouse3','Mouse4'][button]??(Number.isInteger(button)&&button>=0&&button<7?'Mouse'+button:null);
export function keyCodeForEvent(e){if(!e)return null;if(typeof e.code==='string'&&e.code)return keyCodeForCode(e.code);if(Number.isInteger(e.button)&&/^(pointer|mouse)/.test(e.type??'pointer'))return mouseKeyCode(e.button);return null;}
export const keyValue=name=>KEYCODE[name]??-1;
// OptionsKeyBinding.FetchKey: the lowest KeyCode (0..428) currently held, or None.
export function fetchKey(held){let best='None',value=Infinity;for(const n of held){const v=KEYCODE[n];if(v===undefined||v<=0||v>=429)continue;if(v<value){value=v;best=n;}}return best;}
// OptionsKeyBinding.Update result text for a listened key: Escape clears the cell (" "), anything else is its name.
export const listenText=key=>key==='None'?null:key==='Escape'?' ':key;
// OptionsKeyBinding.Setup / UpdateConVars text <-> binding.
export const bindingText=key=>key==='None'?' ':key;
export const textBinding=text=>text.length>0&&text!==' '?text:'None';

// Held keys and the per-frame Input.GetKeyDown/GetKeyUp sets (cleared by endFrame).
export class InputState{
 constructor(){this.held=new Set();this.down=new Set();this.up=new Set();}
 press(code){if(!code||code==='None'||this.held.has(code))return false;this.held.add(code);this.down.add(code);return true;}
 release(code){if(!code||!this.held.has(code))return false;this.held.delete(code);this.up.add(code);return true;}
 // A press and release between two frames: GetKeyDown and GetKeyUp both report it once.
 tap(code){if(!code||code==='None')return;this.down.add(code);this.up.add(code);}
 isHeld(code){return code!=='None'&&this.held.has(code);}
 wasPressed(code){return code!=='None'&&this.down.has(code);}
 wasReleased(code){return code!=='None'&&this.up.has(code);}
 clear(){for(const c of this.held)this.up.add(c);this.held.clear();}
 endFrame(){this.down.clear();this.up.clear();}
}

export class GameButton{
 constructor(name,one='None',two='None'){this.name=name;this.bindingOne=one;this.bindingTwo=two;}
 // GameButton.Bind -> SetKeyCode twice: an unparsable name keeps the old code.
 bind(a,b){this.bindingOne=parseKeyCode(a)??this.bindingOne;this.bindingTwo=parseKeyCode(b)??this.bindingTwo;}
 binds(code){return code!=='None'&&(this.bindingOne===code||this.bindingTwo===code);}
 isDown(s){return s.isHeld(this.bindingOne)||(this.bindingOne!==this.bindingTwo&&s.isHeld(this.bindingTwo));}
 isPressed(s){const a=this.bindingOne,b=this.bindingTwo;if(s.wasPressed(a))return b===a||s.wasPressed(b)||!s.isHeld(b);if(b!==a&&s.wasPressed(b))return !s.isHeld(a);return false;}
 isReleased(s){const a=this.bindingOne,b=this.bindingTwo;if(s.wasReleased(a))return b===a||s.wasReleased(b)||!s.isHeld(b);if(b!==a&&s.wasReleased(b))return !s.isHeld(a);return false;}
 // The same rules for one key event (only `code` changed state): used by event-driven consumers.
 pressedBy(code,s){const a=this.bindingOne,b=this.bindingTwo;if(code==='None')return false;if(code===a)return b===a||code===b||!s.isHeld(b);if(code===b)return !s.isHeld(a);return false;}
 releasedBy(code,s){const a=this.bindingOne,b=this.bindingTwo;if(code==='None')return false;if(code===a)return b===a||code===b||!s.isHeld(b);if(code===b)return !s.isHeld(a);return false;}
 toString(){return this.name??'';}
}

export class KeyBindings extends EventTarget{
 constructor(config=DEFAULT_CONFIG){super();this.buttons=GAME_BUTTONS.map(n=>new GameButton(n));this.byName=new Map(this.buttons.map(b=>[b.name,b]));this.runConfig(config);}
 // GameInput.GetButton: exact (case-sensitive) name.
 button(name){return this.byName.get(name)??null;}
 get(name){const b=this.button(name);return b?[b.bindingOne,b.bindingTwo]:null;}
 // input.bind: needs three arguments; returns false when nothing was bound.
 bind(name,a,b){const button=this.button(name);if(!button||a===undefined||b===undefined)return false;const before=button.bindingOne+' '+button.bindingTwo;button.bind(a,b);
  if(before!==button.bindingOne+' '+button.bindingTwo)this.dispatchEvent(Object.assign(new Event('change'),{button:name}));return true;}
 // GameInput.GetConfig (also input.save_bound_keys).
 config(){return this.buttons.map(b=>`input.bind ${b.name} ${b.bindingOne} ${b.bindingTwo}`).join('\n')+'\n';}
 // ConsoleSystem.RunFile for the input.bind lines of a config (other lines are not ours and are ignored).
 runConfig(text){for(const line of String(text??'').split(/\r?\n/)){const parts=line.trim().split(/\s+/);if(parts[0]?.toLowerCase()!=='input.bind'||parts.length<4)continue;this.bind(parts[1],parts[2],parts[3]);}}
 reset(){for(const b of this.buttons){b.bindingOne='None';b.bindingTwo='None';}this.runConfig(DEFAULT_CONFIG);this.dispatchEvent(Object.assign(new Event('change'),{button:null}));}
 // config.load: the saved cfg if present, else defaultConfig. config.save: GetConfig into this browser's storage.
 load(storage){let saved=null;try{saved=storage?.getItem(STORAGE_KEY)??null;}catch{}for(const b of this.buttons){b.bindingOne='None';b.bindingTwo='None';}this.runConfig(DEFAULT_CONFIG);if(saved)this.runConfig(saved);return Boolean(saved);}
 save(storage){try{storage?.setItem(STORAGE_KEY,this.config());return true;}catch{return false;}}
 // F1 console: input.bind <Button> <KeyA> <KeyB> (fewer arguments do nothing, as args.HasArgs(3)); input.keys.
 command(line,storage=null){const parts=String(line).trim().split(/\s+/),name=parts[0]?.toLowerCase();
  if(name==='input.keys')return {ok:true,text:this.config().trimEnd()};
  if(name!=='input.bind')return null;if(parts.length<4)return {ok:true,text:''};
  if(this.bind(parts[1],parts[2],parts[3])&&storage)this.save(storage);return {ok:true,text:''};}
}

const typingTarget=t=>typeof Element!=='undefined'&&t instanceof Element&&t.matches('input,textarea,select,[contenteditable],[contenteditable] *');
// Bindings + key state + the fixed InputManager axes. Events: 'press'/'release' {detail:{button}} for GameButtons
// (IsPressed/IsReleased per key event) and 'axis-press'/'axis-release' {detail:{axis}}.
export class GameInput extends EventTarget{
 constructor({bindings=new KeyBindings(),state=new InputState()}={}){super();this.bindings=bindings;this.state=state;this.attached=false;
  // While the Options window listens for a key (OptionsKeyBinding), keys are not game input.
  this.suspended=false;}
 button(name){return this.bindings.button(name);}
 binding(name){return this.bindings.get(name);}
 isDown(name){return Boolean(this.button(name)?.isDown(this.state));}
 isPressed(name){return Boolean(this.button(name)?.isPressed(this.state));}
 isReleased(name){return Boolean(this.button(name)?.isReleased(this.state));}
 axisDown(axis){const k=INPUT_MANAGER_AXES[axis];return Boolean(k)&&k.some(c=>this.state.isHeld(c));}
 axisPressed(axis){const k=INPUT_MANAGER_AXES[axis];return Boolean(k)&&k.some(c=>this.state.wasPressed(c));}
 // Every GameButton or axis a key drives (a key may drive several: no conflict resolution in the original).
 bound(code){return this.bindings.buttons.some(b=>b.binds(code))||Object.values(INPUT_MANAGER_AXES).some(k=>k.includes(code));}
 press(code,event=null){if(!this.state.press(code))return false;for(const b of this.bindings.buttons)if(b.binds(code)&&b.pressedBy(code,this.state))this.emit('press',{button:b.name,code,event});
  for(const [axis,keys] of Object.entries(INPUT_MANAGER_AXES))if(keys.includes(code)&&keys.filter(k=>k!==code).every(k=>!this.state.isHeld(k)))this.emit('axis-press',{axis,code,event});return true;}
 release(code,event=null){if(!this.state.release(code))return false;for(const b of this.bindings.buttons)if(b.binds(code)&&b.releasedBy(code,this.state))this.emit('release',{button:b.name,code,event});
  for(const [axis,keys] of Object.entries(INPUT_MANAGER_AXES))if(keys.includes(code)&&keys.every(k=>!this.state.isHeld(k)))this.emit('axis-release',{axis,code,event});return true;}
 // A click shorter than a frame (the original latched it as GetKeyDown + GetKeyUp in one frame).
 tap(code){this.press(code);this.release(code);this.state.tap(code);}
 clear(){for(const code of [...this.state.held])this.release(code);}
 endFrame(){this.state.endFrame();}
 emit(type,detail){this.dispatchEvent(Object.assign(new Event(type),{detail}));}
 // Keyboard tracking for the page (capture phase, before other handlers). Mouse buttons come from the game canvas
 // (main.mjs) because clicks on menus and windows are not game input; any mouse release ends a held button.
 // GameButton.IsDown is Input.GetKey: a key stays held through RPOS, chat, the console or a cursor relock (LockCursorManager
 // only calls Input.ResetInputAxes, which clears axes, not GetKey). Only blur/visibilitychange clear the held set here.
 // An auto-repeat of a key that is physically down but not held (it went down in a text field) holds it again without a
 // press: Unity's GetKeyDown fires only on the physical down transition.
 attach(target=globalThis){if(this.attached||!target?.addEventListener)return this;this.attached=true;
  target.addEventListener('keydown',e=>{if(this.suspended)return;if(typingTarget(e.target))return;const code=keyCodeForCode(e.code);if(!code)return;
   if(e.repeat){if(!this.state.isHeld(code))this.state.held.add(code);return;}
   if(this.bound(code)&&!e.ctrlKey&&!e.metaKey&&!(e.altKey&&code==='Return'))e.preventDefault();this.press(code,e);},true);
  target.addEventListener('keyup',e=>{const code=keyCodeForCode(e.code);if(code)this.release(code,e);},true);
  target.addEventListener('pointerup',e=>{const code=mouseKeyCode(e.button);if(code)this.release(code,e);},true);
  target.addEventListener('blur',()=>this.clear());target.document?.addEventListener?.('visibilitychange',()=>this.clear());return this;}
}

// One shared instance for the page: main.mjs (movement, fire, use...), inventory-ui.mjs, chat, the Options window and
// the voice chat (GameInput "Voice": getGameInput().isDown('Voice') / binding('Voice') / 'press'+'release' events).
let shared=null;
export function getGameInput({storage=globalThis.localStorage}={}){if(!shared){const bindings=new KeyBindings();bindings.load(storage);shared=new GameInput({bindings});if(typeof window!=='undefined')shared.attach(window);}return shared;}
