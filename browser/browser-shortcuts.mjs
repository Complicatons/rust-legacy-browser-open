// Browser port: keyboard shortcuts the browser would act on mid-game (close/reload/new tab, save, print, find, history,
// zoom, address bar). Crouch is Ctrl (config.cs default bind), so Ctrl+<movement key> is pressed all the time.
// isBrowserShortcut(e, {typing}) -> whether game-controls.mjs should cancel the keydown. typing: focus is in a text
// field (chat, console, lock code), where the text-editing chords keep working.
const EDIT_CHORDS=new Set(['KeyA','KeyC','KeyV','KeyX','KeyZ','KeyY','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Backspace','Delete','Insert']);
// F11 (browser fullscreen) and F12 (developer tools) stay with the browser; F1 is the game console.
const FUNCTION_KEYS=new Set(['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10']);
const NAV_KEYS=new Set(['BrowserBack','BrowserForward','BrowserRefresh','BrowserHome','BrowserSearch','BrowserFavorites']);
export function isBrowserShortcut(e,{typing=false}={}){const code=e?.code??'';
 if(NAV_KEYS.has(code)||FUNCTION_KEYS.has(code))return true;
 if(e.ctrlKey||e.metaKey){if(/^(Control|Meta)(Left|Right)$/.test(code))return false;return !(typing&&EDIT_CHORDS.has(code));}
 // Alt+Left/Right/Home (history, home page), Alt+D (address bar), Alt+F/E (browser menu).
 if(e.altKey)return /^(ArrowLeft|ArrowRight|Home|KeyD|KeyF|KeyE)$/.test(code);
 // Backspace outside a text field (history back in older browsers).
 return !typing&&code==='Backspace';}
