import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tooltipPosition} from '../browser/inventory-interactions.mjs';
import {captureLine,echoLine} from '../browser/console-window.mjs';
import {LABEL_TINTS} from '../browser/rpos.mjs';
import {UNITY_YELLOW,hudState} from '../browser/hud.mjs';
const source=name=>readFileSync(new URL('../browser/'+name,import.meta.url),'utf8');

test('ItemToolTip.RepositionAtCursor: top-left at the cursor, right/bottom screen clamp only', ()=>{
 const screen={width:1280,height:720},size={width:250,height:120};
 assert.deepEqual(tooltipPosition({x:100,y:200},size,screen),{left:100,top:200},'no offset from the cursor');
 assert.deepEqual(tooltipPosition({x:1200,y:200},size,screen),{left:1030,top:200},'moved left by what passes the right edge');
 assert.deepEqual(tooltipPosition({x:100,y:700},size,screen),{left:100,top:600},'moved up by what passes the bottom edge');
 assert.deepEqual(tooltipPosition({x:1280,y:720},size,screen),{left:1030,top:600});
 assert.deepEqual(tooltipPosition({x:100,y:50},{width:250,height:900},screen),{left:100,top:-180},'no top clamp (the original has none)');
});

test('ConsoleWindow.CaptureLog colours and the skipped uLink/screenshot lines', ()=>{
 assert.equal(captureLine('LoadingScreen: connecting..'),'[color #eeeeee]> LoadingScreen: connecting..[/color]');
 assert.equal(captureLine('Original grass not loaded: x','warning'),'[color #ff0000]> Original grass not loaded: x[/color]');
 assert.equal(captureLine('boom','error'),'[color #ff0000]> boom[/color]');assert.equal(captureLine('boom','exception'),'[color #ff0000]> boom[/color]');
 assert.equal(captureLine('This uLink evaluation license is temporary. x'),null);assert.equal(captureLine('Failed to capture screen shot y','error'),null);
 // ConsoleWindow.RunCommand echoes the input as typed (blank too).
 assert.equal(echoLine('  status '),'[color #00ff00]>   status [/color]');assert.equal(echoLine(''),'[color #00ff00]> [/color]');
});

test('ConsoleWindow: no history, no local clear, untrimmed input, only F1 closes it', ()=>{
 const win=source('console-window.mjs'),controls=source('game-controls.mjs');
 assert.doesNotMatch(win,/ArrowUp|history\.push/,'no command history');
 assert.doesNotMatch(win,/==='clear'/,'"clear" is not a client command (it goes to the server)');
 assert.match(win,/runCommand\(raw,/,'OnInput runs the text as typed');
 assert.doesNotMatch(controls,/Escape'&&consoleOpen\(\)/,'Escape does not close the console');
 assert.match(controls,/export async function createBootConsole/,'the console exists from boot');
});

test('Unity Color.yellow (255,235,4) for the health bar, cell labels and condition tint', ()=>{
 assert.equal(UNITY_YELLOW,'#ffeb04');assert.equal(hudState({health:60}).healthColor,UNITY_YELLOW);assert.equal(hudState({health:41}).healthColor,UNITY_YELLOW);
 assert.deepEqual(LABEL_TINTS.yellow.map(v=>Math.round(v*255)),[255,235,4]);assert.deepEqual(LABEL_TINTS.red,[1,0,0]);assert.deepEqual(LABEL_TINTS.green,[0,1,0]);
 assert.match(source('rpos.mjs'),/id="rpos-yellow"[^>]*><feColorMatrix type="matrix" values="1 0 0 0 0  0 0\.92156863 0 0 0  0 0 0\.015686275 0 0  0 0 0 1 0"/);
});

test('RPOS: drag-only cells, non-modal over chat/console, belt keys with RPOS open, Escape everywhere', ()=>{
 const ui=source('inventory-ui.mjs'),fx=source('inventory-interactions.mjs'),front=source('front-end.mjs'),chat=source('chat.mjs');
 assert.doesNotMatch(ui,/showModal\(/,'RPOS is shown non-modally so chat and the console stay usable');
 assert.doesNotMatch(ui,/loot\.take\(/,'no click-to-take in the loot window (RPOSInventoryCell.OnClick is empty)');
 assert.doesNotMatch(ui,/picked/,'no click-pick / click-place');
 assert.doesNotMatch(ui,/beltKey=n=>\{if\(dialog\.open\)return/,'belt keys work with RPOS open');
 assert.match(ui,/keyGate\.inventory\(\)/);assert.match(ui,/e\.code==='Escape'&&!e\.repeat&&dialog\.open\)dialog\.close\(\)/,'Escape hides RPOS (HumanController)');
 assert.doesNotMatch(fx,/>=5\)/,'a drag starts on the first move');assert.doesNotMatch(fx,/x\+12|y\+12/,'no tooltip offset');
 assert.match(front,/code==='Escape'\)escapeToggle\(e\)/,'Escape in a key listen also toggles the menu');
 assert.match(chat,/if\(member!=='CancelChatting'\)e\.stopPropagation\(\)/,'chat Escape reaches the menu');
});

// Owner playtest (2026-10-29): Escape while RPOS (inventory/loot) is open closed it AND opened the settings menu
// underneath, needing a second Escape to get the mouse back. Root cause: the per-frame loop (main.mjs inputBlocked)
// already exits Pointer Lock as soon as RPOS opens, so by the time Escape is pressed, game-controls.mjs's own
// locked-Escape handler never fires (document.pointerLockElement is already null) — the event reaches front-end.mjs's
// bubble-phase escapeToggle unfiltered, which (unlike escapeKey(), used for the OTHER direction: Escape ending
// Pointer Lock while nothing was open) never checked game.uiOpen() before showing the menu. The original Rust Legacy
// client had this exact quirk too (Input.GetKeyDown polling: HumanController and MainMenu.Update both see the same
// keypress, independently, every frame) — the owner asked for this one deviation from 1:1 fidelity.
test('Escape while RPOS/a context menu/chat/a lock entry is open closes just that layer, never the settings menu too', ()=>{
 const front=source('front-end.mjs'),controls=source('game-controls.mjs');
 assert.match(front,/else if\(!game\?\.uiOpen\?\.\(\)\)show\(\)/,'escapeToggle only opens the menu when nothing else (inventory, a context menu, chat, a lock entry) is already open');
 assert.match(controls,/if\(!blocked\(\)\)\{if\(onEscapeKey\)e\.stopImmediatePropagation\(\);escapeKey\(\);\}/,'the locked-Escape path also defers to a blocking UI layer instead of opening the menu underneath it');
});

// Owner playtest (2026-10-29): Ctrl+W/T closing the tab mid-game. Chromium never lets a page cancel those shortcuts
// outside fullscreen (browser-shortcuts.mjs), and Keyboard Lock (game-controls.mjs keyboardLock()) only engages in
// fullscreen — so this is a one-time, dismissible tip on join instead of a fix that isn't possible. It points at
// Options (reached by pressing Escape) for rebinding Crouch, since a full crouch-rebind control already exists there
// (OptionsInput.Start: one Controls-Line per GAME_BUTTONS entry, Duck included) — no new rebind UI was needed.
test("Ctrl+W tip: a one-time, dismissible banner on join points at fullscreen or rebinding Crouch in Options", ()=>{
 const front=source('front-end.mjs');
 assert.match(front,/session\?\.getItem\(TIP_KEY\)/,'skips once dismissed this session');
 assert.match(front,/session\?\.setItem\(TIP_KEY,'1'\)/,'dismissing it is remembered for the session');
 assert.match(front,/Ctrl\+W, Ctrl\+T/,'names the shortcuts the tip is about');
 assert.match(front,/rebind Crouch in Options \(press Esc\)/,'points at the existing Options > Controls rebind, not new UI');
 assert.match(front,/hide\(\);game\?\.beginSession\?\.\(\);showControlsTip\(\);/,'shown exactly when gameplay actually starts (MainMenu.Hide, HUD on)');
});
