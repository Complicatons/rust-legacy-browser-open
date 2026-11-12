import test from 'node:test';
import assert from 'node:assert/strict';
import {parseManifest,updateFiles} from '../tools/build-kit-update.mjs';

test('kit updates carry the tools 04-Install-KitViaHost runs from the kit',()=>{
 const files=new Set(updateFiles());
 for(const f of ['tools/kit-install.mjs','tools/host-control.mjs'])assert.ok(files.has(f),f);
});

test('VM manifest lines map app-relative paths to lower-case hashes',()=>{
 const a='A'.repeat(64),b='b'.repeat(64);
 const m=parseManifest(`${a} *browser/main.mjs\r\n${b} *app/bridge\\voice.mjs\nnot a line\n`);
 assert.equal(m.size,2);
 assert.equal(m.get('browser/main.mjs'),'a'.repeat(64));
 assert.equal(m.get('bridge/voice.mjs'),b);
});
