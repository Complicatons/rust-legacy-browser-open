// Host app installer releases (HOST-APP-PLAN.md "Owner installer"): the installer manifest signed like the update feed
// (host/release.mjs over host/release-feed.mjs), the website's download route (central/downloads.mjs), the download
// page's reading of it (site/js/docs.mjs), and the code-signing switch (unsigned unless configured).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {signInstaller,verifyInstaller,checkInstallerManifest,PRODUCT,LOADER_PRODUCT} from '../host/release.mjs';
import {releaseLoader,loaderVersion} from '../tools/build-launcher.mjs';
import {publicKeyFrom,KIT_KEY} from '../host/release-feed.mjs';
import {keygen} from '../tools/publish-release.mjs';
import {createDownloadsHandler} from '../central/downloads.mjs';
import {releaseFacts} from '../site/js/docs.mjs';
import {signingConfig,signFiles} from '../tools/code-sign.mjs';
import {listenServer} from '../bridge/listen.mjs';

const manifest=(v='1.2.3')=>({format:'rlb-installer-1',product:PRODUCT,version:v,file:`RustLegacyHostSetup-${v}.exe`,bytes:1234,sha256:'A'.repeat(64),signed:false,publishedAt:1_800_000_000_000});
const keyPair=dir=>{const k=keygen(dir);return {file:k.privateFile,key:publicKeyFrom(readFileSync(k.publicFile,'utf8'))};};

test('installer manifest: signed with the release key like the feed, refused when changed, foreign or malformed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-release-'));
 try{
  const {file,key}=keyPair(dir),text=signInstaller(manifest(),file),env=JSON.parse(text);
  assert.equal(env.format,'rlb-release-feed-1');
  assert.deepEqual(verifyInstaller(text,key),manifest());
  const changed={...env,manifest:Buffer.from(Buffer.from(env.manifest,'base64').toString().replace('1234','4321')).toString('base64')};
  assert.throws(()=>verifyInstaller(changed,key),/bad signature/);
  assert.throws(()=>verifyInstaller(text,keyPair(dir).key),/bad signature/);
  assert.throws(()=>signInstaller({...manifest(),file:'evil.exe'},file),/file must be/);
  assert.match(checkInstallerManifest({...manifest(),sha256:'abc'}).join(),/sha256/);
  // The project's public key ships with the app (the private half stays with the project owner).
  assert.equal(publicKeyFrom(readFileSync(KIT_KEY,'utf8')).asymmetricKeyType,'ed25519');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('website downloads: the installer, its signed manifest and the /download/host redirect; the page reads the numbers',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-downloads-')),host=join(dir,'host');mkdirSync(host);
 const {file}=keyPair(join(dir,'keys')),handler=createDownloadsHandler(dir);
 const http=createServer((q,r)=>{if(!handler(q,r)){r.writeHead(404);r.end();}});await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 try{
  // Nothing published yet: the redirect goes to the docs page.
  let r=await fetch(base+'/download/host',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/docs/install-the-host-app');
  writeFileSync(join(host,'RustLegacyHostSetup-1.2.3.exe'),'MZ fake installer');
  writeFileSync(join(host,'latest.json'),signInstaller(manifest(),file));
  r=await fetch(base+'/download/host',{redirect:'manual'});assert.equal(r.headers.get('location'),'/downloads/host/RustLegacyHostSetup-1.2.3.exe');
  r=await fetch(base+'/downloads/host/RustLegacyHostSetup-1.2.3.exe');
  assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment; filename="RustLegacyHostSetup-1\.2\.3\.exe"/);assert.match(r.headers.get('cache-control'),/immutable/);
  assert.equal(await r.text(),'MZ fake installer');
  r=await fetch(base+'/downloads/host/latest.json');assert.equal(r.headers.get('cache-control'),'no-cache');assert.equal(r.headers.get('content-type'),'application/json');
  assert.deepEqual(releaseFacts(await r.json()),{version:'1.2.3',file:'RustLegacyHostSetup-1.2.3.exe',mb:'0.0',sha256:'A'.repeat(64),signed:false,signer:null,date:'2027-01-15'});
  for(const p of ['/downloads/host/other.exe','/downloads/host/%2e%2e%2fsecret','/downloads/latest.json'])assert.equal((await fetch(base+p)).status,404,p);
  assert.equal(createDownloadsHandler(null)({method:'GET',url:'/downloads/host/latest.json'},null),false);
 }finally{http.closeAllConnections();await new Promise(r=>http.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('website downloads: the kit-update release feed and its tars (H11, owner decision 2)',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-downloads-updates-')),updates=join(dir,'updates');mkdirSync(updates);
 const handler=createDownloadsHandler(dir);
 const http=createServer((q,r)=>{if(!handler(q,r)){r.writeHead(404);r.end();}});await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 try{
  assert.equal((await fetch(base+'/downloads/updates/release-feed.json')).status,404);
  writeFileSync(join(updates,'release-feed.json'),'{"format":"rlb-release-feed-1"}');
  writeFileSync(join(updates,'rlb-1.2.0.tar'),'fake tar bytes');
  let r=await fetch(base+'/downloads/updates/release-feed.json');
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/json');assert.equal(r.headers.get('cache-control'),'no-cache');
  r=await fetch(base+'/downloads/updates/rlb-1.2.0.tar');
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/x-tar');assert.match(r.headers.get('cache-control'),/immutable/);
  assert.equal(await r.text(),'fake tar bytes');
  for(const p of ['/downloads/updates/other.tar','/downloads/updates/%2e%2e%2fsecret','/downloads/updates/rlb-1.2.0.tar.exe'])assert.equal((await fetch(base+p)).status,404,p);
 }finally{http.closeAllConnections();await new Promise(r=>http.close(r));rmSync(dir,{recursive:true,force:true});}
});

const loaderManifest=(v='0.1.0')=>({format:'rlb-installer-1',product:LOADER_PRODUCT,version:v,file:`RustLegacyLoader-${v}.zip`,bytes:99,sha256:'B'.repeat(64),signed:false,publishedAt:1_800_000_000_000});

test('game loader manifest: same envelope and key, its own file name, and not mistaken for the host installer',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-loader-release-'));
 try{
  const {file,key}=keyPair(dir),text=signInstaller(loaderManifest(),file);
  assert.deepEqual(verifyInstaller(text,key,LOADER_PRODUCT),loaderManifest());
  assert.throws(()=>verifyInstaller(text,key,PRODUCT),/not rust-legacy-host/);
  assert.throws(()=>signInstaller({...loaderManifest(),file:'RustLegacyHostSetup-0.1.0.exe'},file),/file must be RustLegacyLoader-<version>\.zip/);
  assert.match(checkInstallerManifest({...loaderManifest(),product:'other'}).join(),/product must be/);
  // The download page reads each product only from its own manifest.
  assert.equal(releaseFacts(JSON.parse(text)),null);
  assert.equal(releaseFacts(JSON.parse(text),LOADER_PRODUCT).file,'RustLegacyLoader-0.1.0.zip');
  assert.equal(loaderVersion('<Version>0.1.0</Version>'),'0.1.0');assert.equal(loaderVersion('<Version>1.0</Version>'),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('game loader release: the app folder zipped with its .sha256 and a signed latest.json',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-loader-zip-')),app=join(dir,'app');mkdirSync(join(app,'web'),{recursive:true});
 try{
  writeFileSync(join(app,'RustLegacyLauncher.exe'),'MZ fake');writeFileSync(join(app,'web','index.html'),'<p>');
  const {file,key}=keyPair(join(dir,'keys')),out=join(dir,'release');
  const {manifest}=releaseLoader({app,out,version:'0.1.0',releaseKey:file,publicKey:key,log:()=>{}});
  assert.equal(manifest.file,'RustLegacyLoader-0.1.0.zip');
  assert.deepEqual(verifyInstaller(readFileSync(join(out,'latest.json'),'utf8'),key,LOADER_PRODUCT),manifest);
  const zip=readFileSync(join(out,manifest.file));assert.equal(zip.subarray(0,2).toString(),'PK');assert.equal(zip.length,manifest.bytes);
  assert.equal(readFileSync(join(out,manifest.file+'.sha256'),'utf8'),`${manifest.sha256}  RustLegacyLoader-0.1.0.zip\n`);
  assert.throws(()=>releaseLoader({app,out,version:'0.1.0',releaseKey:join(dir,'missing.pem')}),/RLB_RELEASE_KEY/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('website downloads: the game loader zip, its manifest and the /download/loader redirect',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-downloads-loader-')),loader=join(dir,'loader');mkdirSync(loader);
 const {file}=keyPair(join(dir,'keys')),handler=createDownloadsHandler(dir);
 const http=createServer((q,r)=>{if(!handler(q,r)){r.writeHead(404);r.end();}});await listenServer(http);
 const base=`http://127.0.0.1:${http.address().port}`;
 try{
  let r=await fetch(base+'/download/loader',{redirect:'manual'});assert.equal(r.headers.get('location'),'/docs/the-game-loader');
  writeFileSync(join(loader,'RustLegacyLoader-0.1.0.zip'),'PK fake zip');writeFileSync(join(loader,'RustLegacyLoader-0.1.0.zip.sha256'),'B  x\n');
  writeFileSync(join(loader,'latest.json'),signInstaller(loaderManifest(),file));
  r=await fetch(base+'/download/loader',{redirect:'manual'});assert.equal(r.headers.get('location'),'/downloads/loader/RustLegacyLoader-0.1.0.zip');
  r=await fetch(base+'/downloads/loader/RustLegacyLoader-0.1.0.zip');
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/zip');assert.match(r.headers.get('content-disposition'),/attachment; filename="RustLegacyLoader-0\.1\.0\.zip"/);
  assert.equal(await r.text(),'PK fake zip');
  r=await fetch(base+'/downloads/loader/RustLegacyLoader-0.1.0.zip.sha256');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/plain/);
  // Each product's folder serves only its own file names.
  for(const p of ['/downloads/loader/RustLegacyHostSetup-1.2.3.exe','/downloads/host/RustLegacyLoader-0.1.0.zip','/downloads/loader/%2e%2e%2fhost%2flatest.json'])assert.equal((await fetch(base+p)).status,404,p);
 }finally{http.closeAllConnections();await new Promise(r=>http.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('code signing: unsigned unless a certificate is configured; a configured one must work',()=>{
 assert.equal(signingConfig({}),null);
 assert.deepEqual(signFiles(['x.exe'],{env:{}}),{signed:false,reason:'no code-signing certificate is configured (RLB_SIGN_*)'});
 assert.equal(signingConfig({RLB_SIGN_THUMBPRINT:'AB'}).method,'store');
 assert.deepEqual(signingConfig({RLB_SIGN_DLIB:'d.dll',RLB_SIGN_DLIB_METADATA:'m.json'}).args.slice(-4),['/dlib','d.dll','/dmdf','m.json']);
 assert.throws(()=>signFiles(['x.exe'],{env:{RLB_SIGN_THUMBPRINT:'AB',RLB_SIGNTOOL:join(tmpdir(),'missing-signtool.exe')}}),/signtool\.exe was not found/);
});
