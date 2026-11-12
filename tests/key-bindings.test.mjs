import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_BUTTONS,DEFAULT_CONFIG,KeyBindings,GameButton,InputState,GameInput,parseKeyCode,keyCodeForCode,mouseKeyCode,keyCodeForEvent,fetchKey,listenText,bindingText,textBinding,KEYCODE,STORAGE_KEY,INPUT_MANAGER_AXES} from '../browser/key-bindings.mjs';

const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};

test('GameInput.Buttons and config.cs defaultConfig binds', ()=>{
 assert.equal(GAME_BUTTONS.length,16);
 assert.deepEqual(GAME_BUTTONS,['Left','Right','Up','Down','Jump','Duck','Sprint','Fire','AltFire','Reload','Use','Inventory','Flashlight','Laser','Voice','Chat']);
 const b=new KeyBindings();
 assert.deepEqual(b.get('Up'),['W','None']);assert.deepEqual(b.get('Duck'),['LeftControl','None']);assert.deepEqual(b.get('Fire'),['Mouse0','None']);
 assert.deepEqual(b.get('AltFire'),['Mouse1','None']);assert.deepEqual(b.get('Chat'),['Return','T']);assert.deepEqual(b.get('Voice'),['V','None']);
 // GameInput.GetConfig round trip (input.keys / save_bound_keys format).
 assert.equal(b.config().trim(),DEFAULT_CONFIG);
});

test('input.bind parses KeyCode names case-insensitively and keeps the old code on bad names', ()=>{
 const b=new KeyBindings();
 assert.equal(b.bind('Jump','leftalt','mouse3'),true);assert.deepEqual(b.get('Jump'),['LeftAlt','Mouse3']);
 b.bind('Jump','NotAKey','None');assert.deepEqual(b.get('Jump'),['LeftAlt','None']);
 // GameInput.GetButton is an exact name match; unknown buttons are ignored.
 assert.equal(b.bind('jump','K','None'),false);assert.equal(b.bind('Nope','K','None'),false);assert.deepEqual(b.get('Jump'),['LeftAlt','None']);
 // Enum.Parse also accepts a defined numeric value.
 assert.equal(parseKeyCode('32'),'Space');assert.equal(parseKeyCode('314'),null);assert.equal(parseKeyCode('LeftApple'),'LeftCommand');
 assert.equal(parseKeyCode(''),null);assert.equal(parseKeyCode('...'),null);
 // A cell still showing "..." at Apply: the name does not parse, the previous binding stays.
 b.bind('Reload','...','None');assert.deepEqual(b.get('Reload'),['R','None']);
});

test('input.bind / input.keys console commands (args.HasArgs(3))', ()=>{
 const b=new KeyBindings(),s=memory();
 assert.deepEqual(b.command('input.bind Up'),{ok:true,text:''});
 assert.deepEqual(b.get('Up'),['W','None']);
 b.command('input.bind Up UpArrow W',s);assert.deepEqual(b.get('Up'),['UpArrow','W']);
 assert.match(s.getItem(STORAGE_KEY),/input\.bind Up UpArrow W/);
 assert.match(b.command('input.keys').text,/^input\.bind Left A None\n/);
 assert.equal(b.command('render.fov 70'),null);
});

test('persistence: saved config over defaults, reset restores defaults', ()=>{
 const s=memory(),a=new KeyBindings();a.bind('Up','K','None');a.bind('Fire','Mouse0','Space');a.save(s);
 const b=new KeyBindings();assert.equal(b.load(s),true);assert.deepEqual(b.get('Up'),['K','None']);assert.deepEqual(b.get('Fire'),['Mouse0','Space']);
 // A corrupt or foreign entry leaves the defaults for every line it does not set.
 s.setItem(STORAGE_KEY,'garbage\ninput.bind Down DownArrow None\ninput.bind Up');const c=new KeyBindings();c.load(s);
 assert.deepEqual(c.get('Down'),['DownArrow','None']);assert.deepEqual(c.get('Up'),['W','None']);
 const d=new KeyBindings();assert.equal(d.load(memory()),false);assert.equal(d.config().trim(),DEFAULT_CONFIG);
 b.reset();assert.equal(b.config().trim(),DEFAULT_CONFIG);
});

test('GameButton IsDown / IsPressed / IsReleased follow the original two-binding rules', ()=>{
 const s=new InputState(),b=new GameButton('Chat','Return','T');
 s.press('Return');assert.equal(b.isDown(s),true);assert.equal(b.isPressed(s),true);s.endFrame();
 // T pressed while Return is still held: not a new press.
 s.press('T');assert.equal(b.isPressed(s),false);assert.equal(b.pressedBy('T',s),false);s.endFrame();
 // Releasing one of two held keys is not a release.
 s.release('Return');assert.equal(b.isReleased(s),false);assert.equal(b.isDown(s),true);s.endFrame();
 s.release('T');assert.equal(b.isReleased(s),true);assert.equal(b.isDown(s),false);s.endFrame();
 // Same key in both slots counts once.
 const same=new GameButton('Jump','Space','Space');s.press('Space');assert.equal(same.isPressed(s),true);assert.equal(same.pressedBy('Space',s),true);s.release('Space');assert.equal(same.isReleased(s),true);s.endFrame();
 // None never matches.
 const none=new GameButton('Laser','None','None');s.press('G');assert.equal(none.isDown(s),false);assert.equal(none.isPressed(s),false);
 // A tap inside one frame: pressed and released in that frame, not held.
 const t=new InputState(),fire=new GameButton('Fire','Mouse0','None');t.tap('Mouse0');assert.equal(fire.isPressed(t),true);assert.equal(fire.isDown(t),false);assert.equal(fire.isReleased(t),true);
});

test('no conflict resolution: one key drives every button bound to it', ()=>{
 const input=new GameInput(),pressed=[];input.bindings.bind('Jump','W','None');input.addEventListener('press',e=>pressed.push(e.detail.button));
 input.press('W');assert.deepEqual(pressed.sort(),['Jump','Up']);assert.equal(input.isDown('Up'),true);assert.equal(input.isDown('Jump'),true);
 input.release('W');assert.equal(input.isDown('Up'),false);
});

test('GameInput events, axes and frame latches', ()=>{
 const input=new GameInput(),events=[];for(const t of ['press','release','axis-press','axis-release'])input.addEventListener(t,e=>events.push([t,e.detail.button??e.detail.axis]));
 input.press('E');input.press('Mouse2');input.release('E');input.release('Mouse2');
 // E is both the (unused) Use GameButton and the InputManager WorldUse axis; mouse 2 is WorldUse's alternative.
 assert.deepEqual(events,[['press','Use'],['axis-press','WorldUse'],['release','Use'],['axis-release','WorldUse']]);
 events.length=0;input.press('Alpha3');assert.deepEqual(events,[['axis-press','UseItem3']]);assert.equal(input.axisPressed('UseItem3'),true);input.endFrame();assert.equal(input.axisPressed('UseItem3'),false);assert.equal(input.axisDown('UseItem3'),true);
 input.tap('Mouse0');assert.equal(input.isPressed('Fire'),true);assert.equal(input.isDown('Fire'),false);input.endFrame();assert.equal(input.isPressed('Fire'),false);
 // Rebinding moves the button; the axis stays fixed.
 input.bindings.bind('Up','UpArrow','None');input.press('W');assert.equal(input.isDown('Up'),false);input.press('UpArrow');assert.equal(input.isDown('Up'),true);
 input.clear();assert.equal(input.state.held.size,0);
 assert.deepEqual(INPUT_MANAGER_AXES.WorldUse,['E','Mouse2']);
});

test('browser key/mouse codes map to Unity KeyCode names', ()=>{
 assert.equal(keyCodeForCode('KeyW'),'W');assert.equal(keyCodeForCode('Digit1'),'Alpha1');assert.equal(keyCodeForCode('Enter'),'Return');assert.equal(keyCodeForCode('ControlLeft'),'LeftControl');
 assert.equal(keyCodeForCode('ShiftRight'),'RightShift');assert.equal(keyCodeForCode('Space'),'Space');assert.equal(keyCodeForCode('ArrowUp'),'UpArrow');assert.equal(keyCodeForCode('Numpad5'),'Keypad5');assert.equal(keyCodeForCode('NumpadEnter'),'KeypadEnter');
 assert.equal(keyCodeForCode('Backquote'),'BackQuote');assert.equal(keyCodeForCode('F12'),'F12');assert.equal(keyCodeForCode('Unidentified'),null);
 assert.equal(mouseKeyCode(0),'Mouse0');assert.equal(mouseKeyCode(2),'Mouse1');assert.equal(mouseKeyCode(1),'Mouse2');assert.equal(mouseKeyCode(3),'Mouse3');assert.equal(mouseKeyCode(4),'Mouse4');
 assert.equal(keyCodeForEvent({type:'keydown',code:'KeyT'}),'T');assert.equal(keyCodeForEvent({type:'pointerdown',button:2}),'Mouse1');
 for(const name of ['A','Space','Return','LeftControl','Mouse0','Mouse1','Alpha1','F1','Tab'])assert.equal(typeof KEYCODE[name],'number');
 assert.equal(KEYCODE.Mouse0,323);assert.equal(KEYCODE.LeftShift,304);assert.equal(KEYCODE.A,97);assert.equal(KEYCODE.F1,282);assert.equal(KEYCODE.Keypad0,256);
});

test('OptionsKeyBinding listen: lowest held KeyCode, Escape clears, labels map to binds', ()=>{
 // FetchKey scans KeyCode 0..428 and returns the first held: with LeftShift (304) held, A (97) wins either way.
 assert.equal(fetchKey(['LeftShift','A']),'A');assert.equal(fetchKey(['A','LeftShift']),'A');assert.equal(fetchKey(['Mouse1','LeftControl']),'LeftControl');
 assert.equal(fetchKey([]),'None');assert.equal(fetchKey(['Bogus']),'None');
 assert.equal(listenText('Escape'),' ');assert.equal(listenText('K'),'K');assert.equal(listenText('None'),null);
 assert.equal(bindingText('None'),' ');assert.equal(bindingText('Mouse0'),'Mouse0');
 assert.equal(textBinding(' '),'None');assert.equal(textBinding(''),'None');assert.equal(textBinding('Space'),'Space');
});
