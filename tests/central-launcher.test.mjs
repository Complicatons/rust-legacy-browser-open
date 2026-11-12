import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {checkCentralConfig} from '../tools/central.mjs';
import {writeSigningKey,loadSigningKey} from '../central/keys.mjs';
import {listenServer} from '../bridge/listen.mjs';

test('central config validation and signing key files', ()=>{
 const example=JSON.parse(readFileSync(new URL('../deploy/central.example.json',import.meta.url)));
 assert.deepEqual(checkCentralConfig(example),[]);
 assert.ok(checkCentralConfig({...example,publicUrl:'http://x/'}).some(e=>/https/.test(e)));
 assert.ok(checkCentralConfig({...example,listen:{host:'0.0.0.0'}}).some(e=>/TLS/.test(e)));
 assert.ok(checkCentralConfig({...example,steam:{}}).some(e=>/enable steam/.test(e)));
 // Dev sign-in for the gameplay test tools: insecure test deployments only, never production.
 assert.ok(checkCentralConfig({...example,testDevSignIn:true}).some(e=>/testDevSignIn/.test(e)));
 assert.deepEqual(checkCentralConfig({...example,testDevSignIn:true,allowInsecure:true}),[]);
 const dir=mkdtempSync(join(tmpdir(),'rlb-keys-')),{kid,file}=writeSigningKey(dir);
 if(process.platform==='win32'){
  const sid=execFileSync(join(process.env.SystemRoot??'C:\\Windows','System32','whoami.exe'),['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-\d+(?:-\d+)+/)[0];
  const acl=execFileSync('powershell.exe',['-NoProfile','-Command','[System.IO.File]::GetAccessControl($env:RLB_TEST_KEY).GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)'],{encoding:'utf8',windowsHide:true,env:{...process.env,RLB_TEST_KEY:file}}).trim();
  const alias={'S-1-5-18':'SY','S-1-5-19':'LS','S-1-5-20':'NS'}[sid]; // SDDL writes well-known accounts by alias (SYSTEM is SY)
  assert.equal(acl.replace(/^D:PAI/,'D:P'),`D:P(A;;FA;;;${alias??sid})`,'protected ACL grants only the service account');
 }else assert.equal(statSync(file).mode&0o777,0o600);
 const k=loadSigningKey(file);assert.equal(k.kid,kid);assert.equal(k.privateKey.asymmetricKeyType,'ed25519');
 assert.throws(()=>loadSigningKey(join(dir,'other.pem')),/named signing-/);
});

test('serveGame mounts the game at /play on the website origin (same-origin join hand-off)', async()=>{
 const {buildCentral}=await import('../tools/central.mjs');
 const {createServer}=await import('node:http');
 const dir=mkdtempSync(join(tmpdir(),'rlb-central-')),{file}=writeSigningKey(dir);
 const handler=buildCentral({publicUrl:'https://play.example.test/',signingKeys:[file],steam:{enabled:true},database:':memory:',serveGame:true});
 const http=createServer(handler);await listenServer(http);
 const get=async p=>{const r=await fetch(`http://127.0.0.1:${http.address().port}${p}`);return {status:r.status,type:r.headers.get('content-type'),text:await r.text()};};
 try{
  assert.match((await get('/play')).text,/src="\/main\.mjs\?v=[0-9a-f]{16}"/,'the game page, with versioned URLs (tools/asset-versions.mjs)');
  assert.match((await get('/')).text,/data-page="home"/,'the title-screen homepage');
  assert.match((await get('/main.mjs')).type,/javascript/);
  assert.equal(JSON.parse((await get('/site-config.json')).text).playUrl,'/play');
  assert.equal((await get('/servers')).status,200,'API routes still reach the service');
  assert.equal((await get('/nothing.mjs')).status,404);
 }finally{await new Promise(r=>http.close(r));}
});
