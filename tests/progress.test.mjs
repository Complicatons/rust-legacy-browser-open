// Roadmap progress bar (central/progress.mjs): the numbers come from the public GitHub journal's README.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseProgress,createProgress} from '../central/progress.mjs';
import {listenServer} from '../bridge/listen.mjs';

// The shape of the public README (OWNER/rust-legacy-browser), trimmed.
const README=`<p align="center">
  <img alt="Overall progress: 76%" src="https://img.shields.io/badge/PROGRESS-76%25-e96938?style=for-the-badge">
</p>

## Progress — 20 October 2026

\`\`\`
Overall   ███████████████░░░░░  76%
\`\`\`

| Area | Progress | Working now | Left to do |
|---|---|---|---|
| **Original world and graphics** | \`█████████░\` 90% | The island. | Polish. |
| **First real server** | \`█░░░░░░░░░\` 10% | The bridge is built | Run it |
| **Website, accounts and server list** | \`████▌░░░░░\` 45% | Sign-in | Launch |
`;

test('reads the overall figure, the date and each area from the README', ()=>{
 assert.deepEqual(parseProgress(README),{overall:76,date:'2026-10-20',areas:[
  {name:'Original world and graphics',pct:90},{name:'First real server',pct:10},{name:'Website, accounts and server list',pct:45}]});
});

test('a README without a progress figure gives null', ()=>{
 assert.equal(parseProgress('# Hello\nNothing here.'),null);
 assert.equal(parseProgress('Overall 140%'),null,'out of range');
});

async function snapshotDir(data){
 const dir=await mkdtemp(path.join(tmpdir(),'rlb-progress-'));const file=path.join(dir,'progress.json');
 await writeFile(file,JSON.stringify(data));return {file,done:()=>rm(dir,{recursive:true,force:true})};
}

test('serves the live README and caches it', async()=>{
 const snap=await snapshotDir({overall:50,date:'2026-10-01',areas:[]});let calls=0,t=0;
 const p=createProgress({url:'https://example.test/README.md',snapshot:snap.file,ttlMs:1000,now:()=>t,fetch:async()=>{calls++;return {ok:true,text:async()=>README};}});
 try{
  assert.equal((await p.get()).overall,76);assert.equal((await p.get()).source,'https://example.test/README.md');
  await p.get();assert.equal(calls,1,'cached within the ttl');
  t=2000;await p.get();assert.equal(calls,2,'refreshed after the ttl');
 }finally{await snap.done();}
});

test('falls back to the saved snapshot when GitHub cannot be reached or the README changed shape', async()=>{
 const snap=await snapshotDir({overall:50,date:'2026-10-01',areas:[{name:'A',pct:5}]});
 try{
  const down=createProgress({url:'https://example.test/README.md',snapshot:snap.file,fetch:async()=>{throw new Error('offline');}});
  assert.deepEqual(await down.get(),{overall:50,date:'2026-10-01',areas:[{name:'A',pct:5}],source:'snapshot'});
  const odd=createProgress({url:'https://example.test/README.md',snapshot:snap.file,fetch:async()=>({ok:true,text:async()=>'# no numbers'})});
  assert.equal((await odd.get()).source,'snapshot');
  const off=createProgress({url:null,snapshot:snap.file,fetch:async()=>{throw new Error('must not fetch');}});
  assert.equal((await off.get()).overall,50,'no url: snapshot only');
 }finally{await snap.done();}
});

test('a failed fetch keeps the last good live numbers', async()=>{
 const snap=await snapshotDir({overall:50,date:'2026-10-01',areas:[]});let t=0,up=true;
 const p=createProgress({url:'https://example.test/README.md',snapshot:snap.file,ttlMs:10,now:()=>t,fetch:async()=>{if(!up)throw new Error('down');return {ok:true,text:async()=>README};}});
 try{assert.equal((await p.get()).overall,76);up=false;t=100;assert.equal((await p.get()).overall,76);}finally{await snap.done();}
});

test('the committed snapshot parses like the README', async()=>{
 const {readFile}=await import('node:fs/promises');
 const s=JSON.parse(await readFile(new URL('../site/content/progress.json',import.meta.url),'utf8'));
 assert.ok(s.overall>0&&s.overall<=100);assert.match(s.date,/^\d{4}-\d{2}-\d{2}$/);assert.ok(s.areas.length>=5);
 for(const a of s.areas){assert.equal(typeof a.name,'string');assert.ok(a.pct>=0&&a.pct<=100);}
});

test('the site serves live progress numbers when a progress source is given', async()=>{
 const {createServer}=await import('node:http'),{createSiteHandler}=await import('../central/site.mjs');
 const serve=async opts=>{const site=createSiteHandler(opts),http=createServer((q,r)=>{if(!site(q,r)){r.writeHead(404);r.end();}});await listenServer(http);
  return {get:async p=>{const res=await fetch(`http://127.0.0.1:${http.address().port}${p}`);return [res.status,res.headers.get('cache-control'),await res.json()];},close:()=>{http.closeAllConnections();return new Promise(r=>http.close(r));}};};
 const live=await serve({progress:{get:async()=>({overall:81,date:'2026-11-01',areas:[],source:'https://example.test/README.md'})}});
 try{const [status,cache,data]=await live.get('/site/content/progress.json');assert.equal(status,200);assert.equal(cache,'no-cache');assert.equal(data.overall,81);}finally{await live.close();}
 const plain=await serve({});
 try{const [status,,data]=await plain.get('/site/content/progress.json');assert.equal(status,200);assert.ok(data.overall>0,'the committed snapshot as a plain file');}finally{await plain.close();}
});
