import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
import {clientUICommand,codeError,digitsOnly,typedCharacterAllowed,pasteText,textboxScroll,LOCK_NOTICE_ICON,LOCK_NOTICE_SECONDS} from '../browser/lock-entry.mjs';
import {anchorLayout} from '../browser/death-screen.mjs';
import {present} from './helpers/assets.mjs';
test('native lock entry validates four digits while preserving leading zeros',()=>{assert.equal(codeError('0123'),null);assert.equal(codeError('123'),'Password must be 4 digits.');assert.equal(codeError('12x3'),'Must be digits only.');
 // LockEntry.PasswordEntered checks the length before the digits; char.IsDigit accepts any Unicode decimal digit.
 assert.equal(codeError('12x'),'Password must be 4 digits.');assert.equal(codeError(''),'Password must be 4 digits.');assert.equal(codeError('١٢٣٤'),null);
 assert.equal(LOCK_NOTICE_ICON,'');assert.equal(LOCK_NOTICE_SECONDS,5);});
test('DigitEntryRestrictions keeps digits only and the textbox pastes like dfTextbox.pasteAtCursor',()=>{
 assert.equal(digitsOnly('1a2 3-4'),'1234');assert.equal(digitsOnly('abc'),'');
 assert.ok(typedCharacterAllowed('7'));assert.ok(!typedCharacterAllowed('a'));assert.ok(!typedCharacterAllowed(' '));assert.ok(typedCharacterAllowed('\b'));
 // MaxLength (4) cuts the pasted text before OnTextChanged strips the non-digits: "12a3" pasted into "" leaves "123".
 assert.deepEqual(pasteText('',0,0,'12a3',4),{text:'123',cursor:3});
 assert.deepEqual(pasteText('19',1,1,'0\n5',4),{text:'1059',cursor:3});assert.deepEqual(pasteText('1234',0,4,'98765',4),{text:'9876',cursor:4});});
test('dfTextbox left-aligned scrolling keeps the cursor inside the inner width',()=>{
 assert.equal(textboxScroll([10,10,10,10],0,4,69),0);assert.equal(textboxScroll([20,20,20,20],0,4,69),1);assert.equal(textboxScroll([20,20,20,20],3,1,69),1);});
test('server console UI recognises lock/notice messages and never accepts a general console command',()=>{
 assert.deepEqual(clientUICommand('lockentry.show true'),{type:'lock',changing:true});assert.deepEqual(clientUICommand('lockentry.show false'),{type:'lock',changing:false});assert.deepEqual(clientUICommand('lockentry.hide'),{type:'hide-lock'});
 assert.deepEqual(clientUICommand('notice.popup 5 key "Incorrect password."'),{type:'notice',message:'Incorrect password.',seconds:5,icon:'key'});assert.equal(clientUICommand('lockentry.show true; quit'),null);assert.equal(clientUICommand('global.quit'),null);assert.equal(clientUICommand('notice.popup 5 key "a"; quit'),null);
});
const manifestFile=new URL('../browser/assets/recovered/frontend/manifest.json',import.meta.url);
test('exported LockEntry panel matches the original GameUI layout',{skip:!present(manifestFile)&&'frontend export missing'},()=>{
 const screen=JSON.parse(readFileSync(manifestFile,'utf8')).screens.LockEntry;assert.ok(screen,'LockEntry exported by tools/export_frontend.py');
 const [root,sprite,okay,box,textbox,cancel,label]=screen.nodes,le=root.components.LockEntry[0];
 assert.deepEqual(screen.nodes.map(n=>n.name),['LockEntry','Sprite','OkayButton','Sprite','Textbox','CancelButton','Rich Text Label']);
 assert.equal(le.passwordInput.m_PathID,textbox.components.dfTextbox[0].pathID);assert.equal(le.entryLabel.m_PathID,label.components.dfRichTextLabel[0].pathID);
 const t=textbox.components.dfTextbox[0];assert.equal(t.maxLength,4);assert.equal(t.displayAsPassword,0);assert.equal(t.selectOnFocus,1);assert.ok(textbox.components.DigitEntryRestrictions);
 assert.deepEqual(root.components.dfControlKeyBinding.map(k=>[k.keyCode,k.target.MemberName]),[[13,'PasswordEntered']]);
 assert.deepEqual(root.components.dfEventBinding.map(b=>[b.DataSource.Component.m_PathID,b.DataTarget.MemberName]).sort(),[[cancel.components.dfButton[0].pathID,'CancelPressed'],[okay.components.dfButton[0].pathID,'PasswordEntered']].sort());
 assert.deepEqual([okay.components.dfButton[0].text,cancel.components.dfButton[0].text],['Okay','Cancel']);
 // 400x300 panel centred on a 1280x720 screen; the 253x112 sprite centred inside it.
 const p=root.components.dfPanel[0],r=anchorLayout(p.layout,p.size,{x:1280,y:720});assert.deepEqual(r,{x:440,y:210,width:400,height:300});
 const s=sprite.components.dfSprite[0],sr=anchorLayout(s.layout,s.size,{x:400,y:300});assert.deepEqual(sr,{x:74,y:94,width:253,height:112});assert.equal(s.spriteName,'BLANK_TEXTURE');
});
