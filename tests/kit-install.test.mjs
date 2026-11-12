// Kit update install (tools/kit-install.mjs) for the host app's Updates page: the same refusals as
// 03-Install-KitUpdate.ps1 (pinned to the script's own patterns), backup of replaced files, roll back, affected parts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspect,apply,rollback,partsFor,CENTRAL_ONLY,UNSAFE,TAR} from '../tools/kit-install.mjs';

const make=(root,files,{name='u.tar',raw=false}={})=>{
 const src=join(root,'src');for(const [p,t] of Object.entries(files)){mkdirSync(join(src,p,'..'),{recursive:true});writeFileSync(join(src,p),t);}
 const out=join(root,name),r=spawnSync(TAR,['-cf',out,...(raw?['-P']:[]),'-C',src,...Object.keys(files)],{encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);return out;
};

test('kit install: the refusals are the ones 03-Install-KitUpdate.ps1 applies',()=>{
 const ps=readFileSync(new URL('../deploy/azure-test/scripts/03-Install-KitUpdate.ps1',import.meta.url),'utf8');
 // The script's two refusal lines, so a change there fails here until the module follows.
 assert.ok(ps.includes(`$_ -match '(^|[\\\\/])\\.\\.([\\\\/]|$)' -or $_ -match '^([A-Za-z]:|[\\\\/])'`),'03 path refusal changed');
 assert.ok(ps.includes(`$_ -eq 'tools/central.mjs' -or $_ -match '^(central|site)/'`),'03 central refusal changed');
 for(const e of ['../x.mjs','a/../../b','C:/Windows/x','/etc/x','\\x'])assert.ok(UNSAFE.test(e),e);
 for(const e of ['bridge/gateway.mjs','tools/x..y.mjs','browser/a.js'])assert.ok(!UNSAFE.test(e),e);
 for(const e of ['tools/central.mjs','central/db.mjs','site/js/a.mjs'])assert.ok(CENTRAL_ONLY(e),e);
 assert.ok(!CENTRAL_ONLY('tools/gateway.mjs'));
 assert.deepEqual(partsFor(['bridge/adapter.mjs','host/host.mjs','central/db.mjs','browser/main.mjs']),['central','gateway','host','sidecar']);
});

test('kit install: inspect, apply with backup, roll back; refused updates change nothing',()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-kit-')),app=join(root,'app');
 mkdirSync(join(app,'bridge'),{recursive:true});writeFileSync(join(app,'bridge','gateway.mjs'),'old gateway');
 const t=make(root,{'bridge/gateway.mjs':'new gateway','bridge/new-file.mjs':'added'});
 const info=inspect(t);assert.equal(info.entries.length,2);assert.deepEqual(info.refused,[]);assert.deepEqual(info.parts,['gateway','sidecar']);assert.match(info.sha256,/^[0-9a-f]{64}$/);
 const r=apply(t,{app,backup:join(root,'backup-1')});
 assert.deepEqual(r.replaced,['bridge/gateway.mjs']);assert.deepEqual(r.added,['bridge/new-file.mjs']);
 assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'new gateway');
 assert.equal(readFileSync(join(root,'backup-1','files','bridge','gateway.mjs'),'utf8'),'old gateway');
 const back=rollback(join(root,'backup-1'),{app});
 assert.deepEqual(back,{restored:1,removed:1,parts:['gateway','sidecar']});
 assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'old gateway');assert.ok(!existsSync(join(app,'bridge','new-file.mjs')));
 // The website's files need --with-central, exactly like 03.
 const c=make(root,{'central/db.mjs':'x','bridge/gateway.mjs':'y'},{name:'c.tar'});
 assert.deepEqual(inspect(c).refused,['central/db.mjs']);
 assert.throws(()=>apply(c,{app,backup:join(root,'backup-2')}),/Refusing the update; it contains: central\/db\.mjs/);
 assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'old gateway'); // nothing unpacked
 assert.deepEqual(inspect(c,{withCentral:true}).refused,[]);
 rmSync(root,{recursive:true,force:true});
});
