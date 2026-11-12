// Roadmap content (site/content/roadmap/*.md): every shipped entry parses, names only media the build step knows,
// and the "What's coming" section exists. The index itself is tested through the site handler.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readRoadmap,pairs} from '../central/roadmap.mjs';
import {sourceFor} from '../tools/build-roadmap-media.mjs';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=fileURLToPath(new URL('../site/content/roadmap/',import.meta.url));

test('every roadmap entry parses and its media has a source in the build step',()=>{
 const {entries,coming,errors}=readRoadmap(dir,fileURLToPath(new URL('../site/generated/media/roadmap/',import.meta.url)));
 assert.deepEqual(errors,[]);
 assert.ok(entries.length>=20,'the history so far');
 assert.equal(entries[0].date,'2026-10-16','starts at the first build');
 for(const e of entries){
  assert.ok(e.summary,`${e.slug}: summary`);assert.ok(e.body.length>200,`${e.slug}: a real explanation`);
  assert.ok(e.slug.startsWith(e.date),`${e.slug}: file name starts with its date`);
  for(const f of e.files)assert.ok(sourceFor(f),`${e.slug}: ${f} has no source in tools/build-roadmap-media.mjs`);
 }
 assert.ok(coming?.body.includes('##'),"What's coming");
});

test('entries of one day keep their number order past 9',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'rlb-roadmap-'));
 const names=['2026-10-22-10-ten','2026-10-22-2-two','2026-10-22-9-nine','2026-10-22-1-one','2026-10-22-12-twelve','2026-10-21-10-earlier-day','2026-10-22-2-also-two'];
 for(const n of names)writeFileSync(join(tmp,n+'.md'),`---\ndate: ${n.slice(0,10)}\ntitle: ${n}\n---\n\nBody.\n`);
 const {entries,errors}=readRoadmap(tmp,tmp);
 assert.deepEqual(errors,[]);
 assert.deepEqual(entries.map(e=>e.slug),['2026-10-21-10-earlier-day','2026-10-22-1-one','2026-10-22-2-also-two','2026-10-22-2-two',
  '2026-10-22-9-nine','2026-10-22-10-ten','2026-10-22-12-twelve']);
});

test('front matter pairs split on ; and |',()=>{
 assert.deepEqual(pairs('15.2 → ~6 s | load time; 8 | animals;'),[['15.2 → ~6 s','load time'],['8','animals']]);
 assert.deepEqual(pairs(''),[]);
});
