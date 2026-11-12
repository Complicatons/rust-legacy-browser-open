// Signed release feed: tools/publish-release.mjs makes a key pair and signs a feed from a kit update tar; the host
// (host/release-feed.mjs) checks the signature against its pinned key, downloads into updates/staged with a size and
// SHA-256 check, and hands it to the Updates flow. Tampered feeds, tars, replays, other keys and other sites are refused;
// "install automatically" waits for an empty server. A local HTTP server and a test key only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {listenServer} from '../bridge/listen.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TAR} from '../tools/kit-install.mjs';
import {keygen,addRelease} from '../tools/publish-release.mjs';
import {createReleaseFeed,verifyFeed,publicKeyFrom,compareVersions,feedConfigErrors} from '../host/release-feed.mjs';
import {createUpdates} from '../host/updates.mjs';

const kitTar=(root,name,files)=>{
 const src=join(root,'src-'+name);for(const [p,t] of Object.entries(files)){mkdirSync(join(src,p,'..'),{recursive:true});writeFileSync(join(src,p),t);}
 const out=join(root,name);assert.equal(spawnSync(TAR,['-cf',out,'-C',src,...Object.keys(files)]).status,0);return out;
};
async function serve(routes){
 const hits=[];
 const s=createServer((req,res)=>{hits.push(req.url);const r=routes[req.url];if(!r){res.writeHead(404);return res.end();}if(r.redirect){res.writeHead(302,{location:r.redirect});return res.end();}res.writeHead(200);res.end(typeof r==='function'?r():r);});
 await listenServer(s);
 return {base:`http://127.0.0.1:${s.address().port}`,routes,hits,close:()=>new Promise(r=>{s.closeAllConnections?.();s.close(r);})};
}

test('publish-release: key pair, signed feed from a kit tar, append; verify refuses other keys and tampering',()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-pub-'));
 try{
  const k=keygen(join(root,'keys'));assert.match(k.privateFile,/signing-[0-9a-f-]{36}\.pem$/);
  const pub=publicKeyFrom(readFileSync(k.publicFile,'utf8'));
  const tar=kitTar(root,'kit-1.tar',{'bridge/gateway.mjs':'v1','host/host.mjs':'h'});
  const a=addRelease({keyFile:k.privateFile,tar,version:'1.1.0',notes:'Gateway fixes.'});
  const m=verifyFeed(a.text,pub);assert.equal(m.releases.length,1);
  assert.deepEqual(m.releases[0].parts,['gateway','host','sidecar']);assert.equal(m.releases[0].url,'kit-1.tar');
  writeFileSync(join(root,'feed.json'),a.text);
  const b=addRelease({keyFile:k.privateFile,tar,feedFile:join(root,'feed.json'),version:'1.2.0-beta.1',channel:'beta',now:1});
  const m2=verifyFeed(b.text,pub);assert.deepEqual(m2.releases.map(r=>r.version),['1.2.0-beta.1','1.1.0']);assert.ok(m2.publishedAt>m.publishedAt,'publishedAt only grows');
  // Another key: refused. A changed manifest without a new signature: refused.
  const other=keygen(join(root,'other'));
  assert.throws(()=>verifyFeed(a.text,publicKeyFrom(readFileSync(other.publicFile,'utf8'))),/signature does not match/);
  assert.throws(()=>addRelease({keyFile:other.privateFile,tar,feedFile:join(root,'feed.json'),version:'9.9.9'}),/signature does not match/);
  const env=JSON.parse(a.text),man=JSON.parse(Buffer.from(env.manifest,'base64'));man.releases[0].sha256='0'.repeat(64);
  assert.throws(()=>verifyFeed(JSON.stringify({...env,manifest:Buffer.from(JSON.stringify(man)).toString('base64')}),pub),/signature does not match/);
  assert.throws(()=>addRelease({keyFile:k.privateFile,tar,version:'one'}),/--version/);
  assert.ok(compareVersions('1.2.10','1.2.9')>0&&compareVersions('1.3.0-beta.1','1.3.0')<0&&compareVersions('1.3.0-beta.1','1.2.9')>0);
  assert.deepEqual(feedConfigErrors({url:'https://example.org/feed.json',publicKey:readFileSync(k.publicFile,'utf8')}),[]);
  assert.match(feedConfigErrors({url:'http://example.org/feed.json'}).join(),/https/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('release feed on the host: check, verify, download to staged, inspect; tampered tar, replay and other sites refused; auto install when empty',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rlb-feed-')),app=join(root,'app');mkdirSync(join(app,'bridge'),{recursive:true});writeFileSync(join(app,'bridge','gateway.mjs'),'v1');
 const k=keygen(join(root,'keys')),tar=kitTar(root,'kit-1.1.0.tar',{'bridge/gateway.mjs':'v2'});
 const good=readFileSync(tar),feed1=addRelease({keyFile:k.privateFile,tar,version:'1.1.0',notes:'Gateway: steadier joins.',now:1000}).text;
 const srv=await serve({'/feed.json':feed1,'/kit-1.1.0.tar':good});
 let inGame=null;const logs=[],restarted=[];
 const updates=createUpdates({dataDir:join(root,'data'),app,restartParts:async p=>{restarted.push(p);return p;}});
 const mk=(cfg={})=>createReleaseFeed({dataDir:join(root,'data'),config:{url:srv.base+'/feed.json',publicKeyFile:k.publicFile,...cfg},updates,players:()=>inGame==null?null:{inGame},appVersion:'1.0.0',log:m=>logs.push(m)});
 const f=mk();
 try{
  // Not configured: nothing happens.
  const off=createReleaseFeed({dataDir:join(root,'off'),config:{},updates,appVersion:'1.0.0'});
  assert.equal(off.status().configured,false);await assert.rejects(off.check(),/No release feed/);
  // A tar on the server that is not the signed one: refused, nothing staged.
  srv.routes['/kit-1.1.0.tar']=Buffer.concat([good.subarray(0,good.length-1),Buffer.from([good.at(-1)^1])]);
  await assert.rejects(f.check(),/does not match the signed manifest/);
  assert.equal(updates.list().staged.length,0);assert.deepEqual(readdirSync(join(root,'data','updates','staged')),[]);
  srv.routes['/kit-1.1.0.tar']=Buffer.concat([good,Buffer.alloc(512)]);
  await assert.rejects(f.check(),/larger than the signed manifest/);
  // The real one: verified, downloaded, inspected, waiting on the Updates page with its notes.
  srv.routes['/kit-1.1.0.tar']=good;
  const st=await f.check();
  assert.equal(st.lastError,null);assert.equal(st.releases[0].version,'1.1.0');assert.equal(st.releases[0].staged,true);assert.equal(st.installed,'1.0.0');
  const staged=updates.list().staged;assert.equal(staged.length,1);assert.equal(staged[0].name,'rlb-1.1.0.tar');
  assert.equal(staged[0].release.notes,'Gateway: steadier joins.');assert.equal(staged[0].sha256,st.releases[0].sha256);
  assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'v1','never installed without the owner');
  // A feed signed by another key, and a manifest changed after signing: refused, the accepted state stays.
  const other=keygen(join(root,'other'));
  srv.routes['/feed.json']=addRelease({keyFile:other.privateFile,tar,version:'6.6.6',now:5000}).text;
  await assert.rejects(f.check(),/signature does not match/);
  const env=JSON.parse(feed1),man=JSON.parse(Buffer.from(env.manifest,'base64'));man.releases[0].url='http://evil.example/x.tar';
  srv.routes['/feed.json']=JSON.stringify({...env,manifest:Buffer.from(JSON.stringify(man)).toString('base64')});
  await assert.rejects(f.check(),/signature does not match/);
  assert.equal(f.status().releases.length,1);assert.match(f.status().lastError,/signature/);
  // A newer feed, then the old one replayed: refused.
  writeFileSync(join(root,'feed.json'),feed1);
  const tar2=kitTar(root,'kit-1.2.0.tar',{'bridge/gateway.mjs':'v3'});
  const feed2=addRelease({keyFile:k.privateFile,tar:tar2,feedFile:join(root,'feed.json'),version:'1.2.0',url:'http://other.example/kit-1.2.0.tar',now:2000}).text;
  srv.routes['/feed.json']=feed2;
  // Its tar lives on another site the owner did not list: refused.
  await assert.rejects(f.check(),/not the feed's own site/);
  srv.routes['/feed.json']=feed1;
  await assert.rejects(f.check(),/older than one this host already accepted/);
  // Install automatically: only when the owner turned it on, and only when the server is known to be empty.
  srv.routes['/feed.json']=addRelease({keyFile:k.privateFile,tar:tar2,feedFile:join(root,'feed.json'),version:'1.2.0',url:'/kit-1.2.0.tar',now:3000}).text;
  srv.routes['/kit-1.2.0.tar']=readFileSync(tar2);
  await f.check();assert.ok(updates.list().staged.some(s=>s.name==='rlb-1.2.0.tar'));
  assert.equal(await f.autoInstall(),null,'off by default');
  f.saveSettings({autoInstall:true});
  inGame=null;assert.equal(await f.autoInstall(),null,'unknown player count is not empty');
  inGame=2;assert.equal(await f.autoInstall(),null,'players online');
  inGame=0;const r=await f.autoInstall();
  assert.equal(r.name,'rlb-1.2.0.tar');assert.equal(readFileSync(join(app,'bridge','gateway.mjs'),'utf8'),'v3');assert.deepEqual(restarted.at(-1),['gateway','sidecar']);
  assert.equal(f.status().installed,'1.2.0');assert.equal(f.status().releases.find(x=>x.version==='1.1.0').newer,false);
  assert.equal(await f.autoInstall(),null,'nothing newer');
  // Roll back: the installed version goes back too.
  await updates.rollback(updates.list().history[0].backup);assert.equal(f.status().installed,'1.0.0');
  // Only the known channels.
  assert.throws(()=>f.saveSettings({channel:'nightly'}),/unknown channel/);
 }finally{f.stop();await srv.close();rmSync(root,{recursive:true,force:true});}
});
