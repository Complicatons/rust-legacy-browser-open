// Page routes (central/site.mjs pageFor): content slugs come from file names, which can be long.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pageFor} from '../central/site.mjs';

test('long update and wiki slugs still route to their page', () => {
 const long='2026-10-23-100-players-on-the-original-server-and-a-full-playtest'; // 65 characters
 assert.equal(pageFor('/updates/'+long),'update');
 assert.equal(pageFor('/wiki/guides/'+long),'wiki-page');
 assert.equal(pageFor('/updates/'+'a'.repeat(128)),'update');
 assert.equal(pageFor('/updates/'+'a'.repeat(129)),null,'still bounded');
 assert.equal(pageFor('/updates/Not_A_Slug'),null);
});

test('server management and docs pages route; doc slugs follow the content slug rule', () => {
 assert.equal(pageFor('/console'),'console');assert.equal(pageFor('/staff'),'staff');
 assert.equal(pageFor('/list-your-server'),'list-server');
 assert.equal(pageFor('/docs'),'docs');assert.equal(pageFor('/docs/link-your-server'),'doc');
 for(const p of ['/docs/a/b','/docs/Bad_Slug','/staff/servers','/staff/listings'])assert.equal(pageFor(p),null,p);
});
