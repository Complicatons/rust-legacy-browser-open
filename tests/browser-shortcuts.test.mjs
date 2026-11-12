import test from 'node:test';
import assert from 'node:assert/strict';
import {isBrowserShortcut} from '../browser/browser-shortcuts.mjs';
const key=(code,mods={})=>({code,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...mods});
test('crouch (Ctrl) chords and browser shortcuts are cancelled in game',()=>{
 for(const code of ['KeyW','KeyA','KeyS','KeyD','KeyR','KeyT','KeyN','KeyQ','KeyP','KeyF','Tab','Digit1','Equal','Minus','Space'])
  assert.equal(isBrowserShortcut(key(code,{ctrlKey:true})),true,'Ctrl+'+code);
 assert.equal(isBrowserShortcut(key('KeyR',{metaKey:true})),true,'Cmd+R');assert.equal(isBrowserShortcut(key('KeyN',{ctrlKey:true,shiftKey:true})),true,'Ctrl+Shift+N');
 for(const code of ['F1','F3','F5','F6','F7','F10','BrowserBack','BrowserForward','BrowserRefresh'])assert.equal(isBrowserShortcut(key(code)),true,code);
 for(const code of ['ArrowLeft','ArrowRight','Home','KeyD'])assert.equal(isBrowserShortcut(key(code,{altKey:true})),true,'Alt+'+code);
 assert.equal(isBrowserShortcut(key('Backspace')),true);
});
test('plain game keys, F11/F12, modifiers alone and Escape keep their defaults',()=>{
 for(const code of ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','Tab','Digit1','Escape','Enter','KeyE','F11','F12'])assert.equal(isBrowserShortcut(key(code)),false,code);
 assert.equal(isBrowserShortcut(key('ControlLeft',{ctrlKey:true})),false);assert.equal(isBrowserShortcut(key('MetaLeft',{metaKey:true})),false);
 assert.equal(isBrowserShortcut(key('KeyW',{shiftKey:true})),false,'sprint+forward');
});
test('text fields keep editing chords but not tab or page shortcuts',()=>{
 for(const code of ['KeyA','KeyC','KeyV','KeyX','KeyZ','KeyY','ArrowLeft','Backspace','Delete','Home','End'])assert.equal(isBrowserShortcut(key(code,{ctrlKey:true}),{typing:true}),false,'Ctrl+'+code);
 for(const code of ['KeyW','KeyT','KeyR','KeyS','KeyP','Tab'])assert.equal(isBrowserShortcut(key(code,{ctrlKey:true}),{typing:true}),true,'Ctrl+'+code);
 assert.equal(isBrowserShortcut(key('Backspace'),{typing:true}),false);assert.equal(isBrowserShortcut(key('F5'),{typing:true}),true);
});
