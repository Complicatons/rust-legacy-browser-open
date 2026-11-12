import {loadFrontendSkin} from './frontend-skin.mjs';
import {loadDfAssets} from './dfgui.mjs';
import {createConsoleWindow,captureLine} from './console-window.mjs';
import {isBrowserShortcut} from './browser-shortcuts.mjs';
const logText=a=>{if(a instanceof Error)return a.message;if(typeof a==='string')return a;try{return JSON.stringify(a)??String(a);}catch{return String(a);}};
// The F1 console from boot. ConsoleWindow lives in the GameUI scene with MainMenu and LoadingScreen, so it is there on the
// main menu and the loading screen too: ConsoleWindow.Update toggles it on F1 (Input.GetKeyDown, nothing else checked)
// and CaptureLog (ConsoleSystem.RegisterLogCallback in Start) takes every log line from then on: log(text) is
// Debug.Log, console.warn/console.error and uncaught errors are LogWarning/LogError/LogException (red).
// route(line, {trusted, raw}): ConsoleSystem.RunCommand_Clientside, then SendCommandToServer (nothing to send to before
// a server is joined); setRoute swaps it once the game exists. setHooks({beforeShow, afterHide}) around F1.
export async function createBootConsole({route=()=>null}={}){
 const assets=await loadDfAssets(loadFrontendSkin());let current=route;const hooks={beforeShow:()=>{},afterHide:()=>{}};
 const win=createConsoleWindow({assets,command:(line,opts)=>current(line,opts)});
 addEventListener('keydown',e=>{if(e.code!=='F1')return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;if(win.isVisible()){win.hide();hooks.afterHide();}else{hooks.beforeShow();win.show();}},true);
 let busy=false;const log=(text,type='log')=>{if(busy)return;busy=true;try{const line=captureLine(text,type);if(line!==null)win.addText(line);}finally{busy=false;}};
 for(const [name,type] of [['warn','warning'],['error','error']]){const original=console[name].bind(console);console[name]=(...args)=>{original(...args);log(args.map(logText).join(' '),type);};}
 addEventListener('error',e=>log(e.message||logText(e.error),'exception'));addEventListener('unhandledrejection',e=>log(logText(e.reason),'exception'));
 return {window:win,log,setRoute(fn){current=fn;},setHooks(h){Object.assign(hooks,h);}};
}
// onEscapeKey (player entry, front-end.mjs): LockCursorManager.onEscapeKey -> MainMenu.Show when Escape (or the browser's own
// Escape handling) ends Pointer Lock; deliberate releases (release key, console, menus) do not count. command: extra console
// variables tried before render.fov. bootConsole: createBootConsole's console (made here when not given).
export async function createGameControls({canvas,settings,canPlay=()=>false,blocked=()=>false,onCapture=()=>{},onRelease=()=>{},onEscapeKey=null,command=null,bootConsole=null}){
 const dialog=document.createElement('dialog');dialog.id='game-settings';dialog.className='legacy-front legacy-settings';
 dialog.innerHTML='<h2>options</h2><div class="legacy-setting-row"><label for="render-fov">Field of View</label><input id="render-fov" type="range" min="60" max="120" step="1"><output for="render-fov"></output></div><div class="legacy-setting-row"><label for="game-fullscreen">Fullscreen</label><input id="game-fullscreen" type="checkbox"></div><div class="legacy-setting-row"><label for="mouse-release">Release Mouse</label><select id="mouse-release"><option>F2</option><option>F3</option><option>F4</option></select><span>Escape also releases the mouse</span></div><p class="legacy-controls-status" role="status"></p><button type="button" id="settings-apply">Apply Changes</button>';
 document.body.append(dialog);const slider=dialog.querySelector('#render-fov'),output=dialog.querySelector('output'),fullscreen=dialog.querySelector('#game-fullscreen'),release=dialog.querySelector('#mouse-release'),status=dialog.querySelector('[role=status]');
 // F1 console: the original ConsoleWindow (console-window.mjs) with the in-game command routing (command / settings).
 const boot=bootConsole??await createBootConsole(),consoleWin=boot.window,consoleOpen=()=>consoleWin.isVisible();
 boot.setRoute((line,opts)=>command?.(line,opts)??settings.command(line));
 const mouseStatus=document.createElement('p');mouseStatus.id='mouse-capture-status';mouseStatus.setAttribute('role','status');mouseStatus.hidden=true;document.body.append(mouseStatus);
 // A blocked or unsupported lock leaves drag-to-look, where a plain click is Fire (main.mjs); otherwise a click on the
 // free cursor only captures it (the original re-locks the cursor itself when RPOS closes, so that click never fires).
 let lockFailed=false,escapeKeys=0;const escapeKey=()=>{escapeKeys++;onEscapeKey?.();}; // escapeKeys: QA count of onEscapeKey events
 const captureFailed=()=>{lockFailed=true;mouseStatus.textContent='Mouse capture was blocked. Click the game to retry, or open this demo in Edge or Chrome.';mouseStatus.hidden=false;};
 // Returns whether a lock was requested (LockCursorManager.TryLock success).
 const capture=()=>{if(!canPlay()||blocked()||dialog.open||consoleOpen()||document.pointerLockElement===canvas)return false;onCapture();
  // Fullscreen (settings.fullscreen, on unless the player left it) first, in the same click, so Keyboard Lock holds.
  if(settings.fullscreen&&!document.fullscreenElement&&document.fullscreenEnabled!==false)document.documentElement.requestFullscreen?.({navigationUI:'hide'})?.catch(()=>{});
  // Raw mouse deltas (no OS pointer acceleration), as the desktop game read the mouse; plain lock where unsupported.
  const plain=()=>{try{canvas.requestPointerLock()?.catch(captureFailed);}catch{captureFailed();}};
  try{const result=canvas.requestPointerLock({unadjustedMovement:true});if(result)result.catch(e=>e?.name==='NotSupportedError'?plain():captureFailed());}catch{plain();}return true;};
 // keepInput: UnlockCursorFlags.DoNotResetInput (ContextUI): held keys stay held.
 let releasing=false,keepInput=false;const free=({keepInput:keep=false}={})=>{if(document.pointerLockElement){releasing=true;keepInput=keep;document.exitPointerLock();}if(!keep)onRelease();};
 // ConsoleWindow.Update (F1): cursorManager.On frees the cursor; this port's settings dialog closes under it.
 // Hiding it turns the node off again (cursorManager.On = false), which relocks the cursor unless something else keeps it
 // free (capture() checks); F1 is a user gesture, so the page may lock.
 boot.setHooks({beforeShow:()=>{free();if(dialog.open)dialog.close();},afterHide:()=>{canvas.focus();if(!lockFailed&&(!navigator.userActivation||navigator.userActivation.isActive))capture();}});
 function sync(){slider.value=String(settings.fov);output.value=String(settings.fov);output.textContent=String(settings.fov);release.value=settings.releaseKey;fullscreen.checked=Boolean(document.fullscreenElement);}
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();status.textContent='';}catch{status.textContent='Fullscreen could not be enabled.';}sync();}
 slider.addEventListener('input',()=>settings.setFov(slider.value));release.addEventListener('change',()=>settings.setReleaseKey(release.value));settings.addEventListener('change',sync);fullscreen.addEventListener('change',toggleFullscreen);document.addEventListener('fullscreenchange',sync);document.addEventListener('pointerlockerror',captureFailed);document.addEventListener('pointerlockchange',()=>{const locked=document.pointerLockElement===canvas;if(locked)lockFailed=false;canvas.classList.toggle('mouse-captured',locked);if(locked)mouseStatus.hidden=true;else{const deliberate=releasing,keep=keepInput;releasing=keepInput=false;if(!keep)onRelease();
  // LockCursorManager raises onEscapeKey only for a KeyDown Escape while locked: a lock lost to alt-tab, a hidden tab or
  // another window taking focus is not Escape and must not open MainMenu.
  if(!deliberate&&document.hasFocus()&&document.visibilityState!=='hidden')escapeKey();}});
 dialog.querySelector('#settings-apply').onclick=()=>dialog.close();dialog.addEventListener('close',()=>canvas.focus());
 // print: plain lines (ConsoleWindow.AddText); addText(str, fromServer): CL_ConsoleMessage -> AddText(message, true).
 const print=lines=>{for(const l of [lines].flat())consoleWin.addText(String(l));};
 addEventListener('keydown',e=>{if(e.repeat)return;if(e.altKey&&e.code==='Enter'){e.preventDefault();toggleFullscreen();return;}
  if(e.code===settings.releaseKey){e.preventDefault();free();return;}
  // blocked() (inventory, a context menu, chat, a lock entry) wins: let the event through to that layer's own Escape
  // handler instead of stopping it here and opening the settings menu underneath it.
  if(e.code==='Escape'&&document.pointerLockElement){e.preventDefault();free();if(!blocked()){if(onEscapeKey)e.stopImmediatePropagation();escapeKey();}}
 },true);
 // Browser shortcuts must not end a game. Crouch is Ctrl (original bind), so Ctrl+W while crouch-walking would close the tab.
 // Chromium never lets a page cancel Ctrl+W/T/N/Q/Tab outside fullscreen, so for the whole session (front end 'finished',
 // or the first click on the island without it, until allowLeave): confirm before leaving; in fullscreen take the whole
 // keyboard (Keyboard Lock API; a short Escape still reaches the game, holding it leaves fullscreen); and cancel the
 // shortcuts browsers do let pages cancel (browser-shortcuts.mjs).
 let session=false,guarded=false;const confirmLeave=e=>{e.preventDefault();e.returnValue='';};
 const guard=on=>{if(on===guarded)return;guarded=on;if(on)addEventListener('beforeunload',confirmLeave);else removeEventListener('beforeunload',confirmLeave);};
 let keyLocked=false;const keyboardLock=()=>{const k=navigator.keyboard;if(session&&document.fullscreenElement){if(!keyLocked&&k?.lock){keyLocked=true;k.lock().catch(()=>{keyLocked=false;});}}else if(keyLocked){keyLocked=false;k?.unlock?.();}};
 const beginSession=()=>{if(session)return;session=true;guard(true);keyboardLock();};
 canvas.addEventListener('pointerdown',e=>{if(e.isTrusted)beginSession();});
 document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement===canvas)beginSession();});
 // The player's last fullscreen choice (Alt+Enter, Options, holding Escape) is what the next capture does.
 document.addEventListener('fullscreenchange',()=>{keyboardLock();settings.setFullscreen?.(Boolean(document.fullscreenElement));});
 const typing=t=>t instanceof Element&&t.matches('input,textarea,select,[contenteditable]');
 addEventListener('keydown',e=>{if(!session&&document.pointerLockElement!==canvas&&!document.fullscreenElement)return;if(isBrowserShortcut(e,{typing:typing(e.target)}))e.preventDefault();},true);
 canvas.tabIndex=0;canvas.addEventListener('click',e=>{if(document.pointerLockElement!==canvas&&canPlay()&&!blocked()){e.preventDefault();capture();}},true);
 sync();return {print,log:boot.log,addText:(str,fromServer=false)=>consoleWin.addText(String(str??''),fromServer),console:consoleWin,beginSession,allowLeave(){session=false;guard(false);keyboardLock();},showSettings(){free();if(consoleOpen())consoleWin.hide();sync();if(!dialog.open)dialog.showModal();},toggleFullscreen,capture,release:free,isOpen:()=>dialog.open||consoleOpen(),willCapture:()=>!lockFailed&&canPlay()&&!blocked()&&!dialog.open&&!consoleOpen()&&document.pointerLockElement!==canvas,snapshot:()=>({fov:settings.fov,releaseKey:settings.releaseKey,locked:document.pointerLockElement===canvas,fullscreen:Boolean(document.fullscreenElement),fullscreenPreferred:settings.fullscreen,session,escapeKeys,leaveGuard:guarded,keyboardLocked:keyLocked,settings:dialog.open,console:consoleOpen(),consoleWindow:consoleWin.snapshot()})};
}
