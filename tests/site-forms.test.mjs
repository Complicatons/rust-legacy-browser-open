// Pure website helpers (site/js/*): shell navigation state and the account corner model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {navState,accountCorner} from '../site/js/shell-state.mjs';

test('navState maps paths to top-bar tabs',()=>{
 assert.equal(navState('/'),'play');
 assert.equal(navState('/servers'),'servers');
 assert.equal(navState('/servers/abc'),'servers');
 assert.equal(navState('/island'),'island');
 assert.equal(navState('/updates/voice-chat'),'updates');
 assert.equal(navState('/roadmap'),'roadmap');
 assert.equal(navState('/guide'),'guide');
 assert.equal(navState('/wiki/items/x'),'wiki');
 assert.equal(navState('/account'),null);
 assert.equal(navState('/serversx'),null);
});

test('accountCorner describes the signed-out and signed-in corner',()=>{
 assert.deepEqual(accountCorner(null,{providers:['steam']}),{kind:'signed-out',providers:['steam']});
 assert.deepEqual(accountCorner(null,{}),{kind:'signed-out',providers:[]});
 assert.deepEqual(accountCorner({name:'Rook',username:'Rook',staff:true,needsUsername:false},{}),{kind:'signed-in',name:'Rook',staff:true,needsUsername:false});
 assert.deepEqual(accountCorner({name:'Old Name',username:null,needsUsername:true},{}),{kind:'signed-in',name:'Old Name',staff:false,needsUsername:true});
});

import {validateField,fieldForCode,RULES} from '../site/js/form-rules.mjs';
import {USERNAME,RESERVED,EMAIL,PASSWORD_MIN,PASSWORD_MAX} from '../central/passwords.mjs';

test('form rules match the server rules',()=>{
 assert.equal(RULES.username.source,USERNAME.source);
 assert.deepEqual(RULES.reserved,RESERVED);
 assert.equal(RULES.email.source,EMAIL.source);
 assert.deepEqual([RULES.passwordMin,RULES.passwordMax],[PASSWORD_MIN,PASSWORD_MAX]);
});

test('validateField gives readable messages',()=>{
 assert.equal(validateField('email','a@b',{}),'Enter an email address like name@example.com.');
 assert.equal(validateField('email','rook@example.com',{}),null);
 assert.equal(validateField('username','Admin',{}),'That username is reserved. Try another.');
 assert.equal(validateField('username','x',{}),'Use 3–20 letters, numbers, _ or -, starting with a letter or number.');
 assert.equal(validateField('username','Rook',{}),null);
 assert.equal(validateField('password','short',{}),'Use at least 8 characters.');
 assert.equal(validateField('password','abcdefgh',{username:'ABCDEFGH'}),"Your password can't be your username or email.");
 assert.equal(validateField('password','a long passphrase',{username:'rook'}),null);
 assert.equal(validateField('login','',{}),'Enter your email or username.');
 assert.equal(validateField('current','',{}),'Enter your current password.');
});

test('server error codes map to the field they belong to',()=>{
 assert.equal(fieldForCode('username-taken'),'username');
 assert.equal(fieldForCode('reserved-username'),'username');
 assert.equal(fieldForCode('email-taken'),'email');
 assert.equal(fieldForCode('password-too-short'),'password');
 assert.equal(fieldForCode('invalid-credentials'),null);
 assert.equal(fieldForCode('rate-limited'),null);
});
