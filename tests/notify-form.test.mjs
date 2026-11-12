// The "get notified" form shared by /launch and the homepage (site/js/notify.mjs): the address check before sending.
import test from 'node:test';
import assert from 'node:assert/strict';
import {looksLikeEmail} from '../site/js/notify.mjs';

test('accepts ordinary addresses and refuses obvious mistakes', ()=>{
 for(const ok of ['you@example.com','first.last+tag@mail.example.co.uk'])assert.ok(looksLikeEmail(ok),ok);
 for(const bad of ['','you','you@','@example.com','you@example','you @example.com','you@exa mple.com','a'.repeat(250)+'@x.com'])assert.ok(!looksLikeEmail(bad),bad);
});
