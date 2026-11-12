// Host app Updates (host/updates.mjs): add a kit update tar, inspect it, install with backup and restart only the
// affected parts, refuse the website's files without the owner's say-so, roll back once, remove. Temp folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,createReadStream,chmodSync} from 'node:fs';
import {Readable} from 'node:stream';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createUpdates} from '../host/updates.mjs';
import {TAR} from '../tools/kit-install.mjs';

const make=(root,name,files)=>{
 const src=join(root,'src-'+name);for(const [p,t] of Object.entries(files)){mkdirSync(join(src,p,'..'),{recursive:true});writeFileSync(join(src,p),t);}
 const out=join(root,name);assert.equal(spawnSync(TAR,['-cf',out,'-C',src,...Object.keys(files)]).status,0);return out;
};

test('updates: add, inspect, install with restart of the touched parts, website files need consent, roll back, remove',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-upd-')),app=join(root,'app');
 mkdirSync(join(app,'bridge'),{recursive:true});writeFileSync(join(app,'bridge','gateway.mjs'),'v1');
 const restarted=[],u=createUpdates({dataDir:join(root,'data'),app,restartParts:async parts=>{restarted.push(parts);return parts.filter(p=>p!=='host');}});
 try{
  await assert.rejects(u.add('../evil.tar',Readable.from([Buffer.from('x')])),/plain name/);
  await assert.rejects(u.add('junk.tar',Readable.from([Buffer.from('not a tar')])),/not a tar archive/);
  assert.equal(u.list().staged.length,0); // a failed add leaves nothing behind
  const m=await u.add('gw-2.tar',createReadStream(make(root,'gw.tar',{'bridge/gateway.mjs':'v2','host/host.mjs':'new host'})));
  assert.equal(m.files,2);assert.deepEqual(m.parts,['gateway','host','sidecar']);assert.deepEqual(m.refused,[]);assert.match(m.sha256,/^[0-9a-f]{64}$/);
  const r=await u.install('gw-2.tar');
  assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'v2');
  assert.deepEqual(restarted[0],['gateway','host','sidecar']);assert.deepEqual(r.restarted,['gateway','sidecar']);
  assert.ok(r.notes.some(n=>/restart the host app/.test(n)));
  // The website's own files: listed, refused unless the owner allows them.
  await u.add('web.tar',createReadStream(make(root,'web.tar',{'central/db.mjs':'x'})));
  const web=u.list().staged.find(s=>s.name==='web.tar');assert.deepEqual(web.centralFiles,['central/db.mjs']);assert.deepEqual(web.refused,[]);
  await assert.rejects(u.install('web.tar'),/Refusing the update; it contains: central\/db\.mjs/);
  assert.ok(!existsSync(join(app,'central','db.mjs')));
  await u.install('web.tar',{withCentral:true});assert.ok(existsSync(join(app,'central','db.mjs')));
  // History, roll back once.
  const {history}=u.list();assert.equal(history.length,2);
  const first=history.find(h=>h.name==='gw-2.tar');
  const back=await u.rollback(first.backup);assert.deepEqual([back.restored,back.removed],[1,1]);
  assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'v1');assert.ok(!existsSync(join(app,'host','host.mjs')));
  await assert.rejects(u.rollback(first.backup),/already rolled back/);
  await assert.rejects(u.rollback('install-../../x'),/unknown install/);
  assert.equal(u.list().history.find(h=>h.backup===first.backup).rolledBack,true);
  u.remove('gw-2.tar');assert.ok(!u.list().staged.some(s=>s.name==='gw-2.tar'));
  assert.throws(()=>u.remove('gw-2.tar'),/unknown update/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('updates: a full kit restarts only the parts whose files changed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-upd-')),app=join(root,'app');
 mkdirSync(join(app,'bridge'),{recursive:true});mkdirSync(join(app,'browser'),{recursive:true});
 writeFileSync(join(app,'bridge','gateway.mjs'),'same');writeFileSync(join(app,'browser','main.mjs'),'v1');
 const restarted=[],u=createUpdates({dataDir:join(root,'data'),app,restartParts:async parts=>{restarted.push(parts);return parts;}});
 try{
  // Publish-Kit -Full: every file, the bridge unchanged, only the browser file new.
  await u.add('full.tar',createReadStream(make(root,'full.tar',{'bridge/gateway.mjs':'same','browser/main.mjs':'v2'})));
  assert.deepEqual(u.list().staged[0].parts,['central','gateway','sidecar'],'the tar itself touches all three');
  const r=await u.install('full.tar');
  assert.deepEqual(restarted[0],['central']);assert.deepEqual(r.parts,['central']);assert.equal(r.changed,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// The installed service only reads its program folder (Install-RustLegacyHost.ps1). POSIX permissions stand in for the
// Windows ACL here; root ignores them, so the case is skipped there (and on Windows, where chmod sets no folder ACL).
test('updates: a read-only program folder is found before anything is unpacked, with the way to install instead',{skip:process.platform==='win32'||process.getuid?.()===0},async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-upd-')),app=join(root,'app');
 mkdirSync(join(app,'bridge'),{recursive:true});writeFileSync(join(app,'bridge','gateway.mjs'),'v1');
 const restarted=[],u=createUpdates({dataDir:join(root,'data'),app,restartParts:async parts=>{restarted.push(parts);return parts;}});
 try{
  await u.add('gw.tar',createReadStream(make(root,'gw.tar',{'bridge/gateway.mjs':'v2'})));
  chmodSync(app,0o555);chmodSync(join(app,'bridge'),0o555);
  await assert.rejects(u.install('gw.tar'),e=>e.status===403&&/cannot write its program folder/.test(e.message)&&/kit-install\.mjs apply/.test(e.message));
  assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'v1');assert.deepEqual(restarted,[]);
  assert.equal(u.list().history.length,0,'no install record for an install that never started');
 }finally{chmodSync(join(app,'bridge'),0o755);chmodSync(app,0o755);rmSync(root,{recursive:true,force:true});}
});
