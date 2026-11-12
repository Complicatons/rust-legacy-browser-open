// Roadmap search (site/js/roadmap-search.mjs): which entries match what the reader typed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {entryText,matcher} from '../site/js/roadmap-search.mjs';

const entry={slug:'2026-10-21-3-launch-sign-ups',date:'2026-10-21',title:'Launch sign-ups',summary:'A page to leave your email.',
 body:'## Your email\n\nStored **once** per [address](/launch). Mutant `loot`.',stats:[{value:'2',label:'share cards'}],
 media:[{type:'image',caption:'The staff list of sign-ups'}]};

test('the searchable text covers title, summary, body without markdown, stats, captions and the date', () => {
 const t=entryText(entry);
 for(const w of ['launch sign-ups','leave your email','stored once per address','mutant loot','share cards','staff list','21 october 2026','oct'])assert.ok(t.includes(w),w);
 assert.ok(!/[#*`\[\]()]/.test(t),'markdown removed');
});

test('every word must match, in any order and case; an empty query matches everything', () => {
 const t=entryText(entry);
 assert.equal(matcher('')(t),true);assert.equal(matcher('   ')(t),true);
 assert.equal(matcher('EMAIL launch')(t),true);
 assert.equal(matcher('email airdrop')(t),false);
 assert.equal(matcher('sign-ups')(t),true);
 assert.equal(matcher('signups')(t),true,'hyphens are optional');
});
