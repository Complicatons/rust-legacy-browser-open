// The host app's own server setup (host/setup.mjs): inspecting the owner's server folder, browser ready (vanilla patch
// and Oxide plugin) with an exact undo, one enrolment code for the website, the public address, and the Setup status.
// Fake server folders and a stand-in patcher only (tests/fixtures/fake-patcher.mjs); no original binaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectServer,readLaunchArgs,initHostJson,setServer,confirmRun,makeBrowserReady,undoBrowserReady,connectWebsite,setAddress,setupStatus,paths} from '../host/setup.mjs';
import {loadHostConfig,validateHostConfig} from '../host/config.mjs';
import {validateConfig} from '../bridge/gateway-launcher.mjs';
import {central} from './helpers/central-fixture.mjs';

const sha=t=>createHash('sha256').update(t).digest('hex').toUpperCase();
const settings={account:'rlbserver',server:{exe:'rust_server.exe',exeSha256:sha('EXE'),assemblyCSharpSha256:sha('STOCK'),zipSha256:sha('ZIP'),
 args:['-batchmode','-cfg','cfg/server.cfg','-maxplayers','100','-port','29015','-datadir','rust_server_Data/','-nographics']}};
const patcher=[process.execPath,fileURLToPath(new URL('./fixtures/fake-patcher.mjs',import.meta.url))];
function fakeServer(root,{exe='EXE',asm='STOCK',bat=true,extra={}}={}){
 const dir=join(root,'Rust Server Zoë'),managed=join(dir,'rust_server_Data','Managed');
 mkdirSync(managed,{recursive:true});writeFileSync(join(dir,'rust_server.exe'),exe);writeFileSync(join(managed,'Assembly-CSharp.dll'),asm);
 if(bat)writeFileSync(join(dir,'Run Server.bat'),'@echo off\r\nrem start it\r\nrust_server.exe -batchmode -cfg "cfg/server.cfg" -maxplayers 50 -port 29115 -datadir rust_server_Data/ -nographics\r\n');
 for(const [f,t] of Object.entries(extra)){mkdirSync(join(dir,f,'..'),{recursive:true});writeFileSync(join(dir,f),t);}
 return dir;
}
const tmp=()=>mkdtempSync(join(tmpdir(),'rlb-setup-'));

test('inspect: verified build, the owner\'s own command line, and each framework',async()=>{
 const root=tmp();
 try{
  await assert.rejects(inspectServer(join(root,'missing'),{settings}),e=>e.status===404);
  mkdirSync(join(root,'empty'));
  const none=await inspectServer(join(root,'empty'),{settings});assert.equal(none.found,false);assert.match(none.notes[0],/rust_server\.exe/);
  const dir=fakeServer(root),stock=await inspectServer(dir,{settings});
  assert.equal(stock.exe.verified,true);assert.equal(stock.framework,'stock');assert.deepEqual([stock.browserReady.possible,stock.browserReady.how],[true,'vanilla']);
  assert.deepEqual(stock.launch.args,['-batchmode','-cfg','cfg/server.cfg','-maxplayers','50','-port','29115','-datadir','rust_server_Data/','-nographics']);
  assert.equal(stock.port,29115);assert.equal(stock.cfgFile,join(dir,'rust_server_Data','cfg','rustlegacybrowser.cfg'));
  assert.equal(readLaunchArgs(join(root,'empty'),{settings}).source,'default');
  const own=await inspectServer(fakeServer(join(root,'own'),{exe:'OTHER'}),{settings});
  assert.equal(own.exe.verified,false);assert.match(own.notes.join(),/accept it as yours/);
  const oxide=await inspectServer(fakeServer(join(root,'ox'),{asm:'OXIDE',extra:{'rust_server_Data/Managed/Oxide.Core.dll':'x','serverdata/oxide/plugins/Kits.cs':'// theirs'}}),{settings});
  assert.equal(oxide.framework,'oxide');assert.equal(oxide.browserReady.how,'oxide');assert.ok(oxide.oxide.dir.endsWith(join('serverdata','oxide')));
  const fresh=await inspectServer(fakeServer(join(root,'ox2'),{asm:'OXIDE',extra:{'rust_server_Data/Managed/Oxide.Core.dll':'x'}}),{settings});
  assert.equal(fresh.browserReady.possible,false);assert.match(fresh.browserReady.reason,/Start the server once/);
  const fou=await inspectServer(fakeServer(join(root,'fou'),{asm:'FOU',extra:{'rust_server_Data/Managed/Fougerite.dll':'x'}}),{settings});
  assert.equal(fou.framework,'fougerite');assert.equal(fou.browserReady.possible,false);
  const mod=await inspectServer(fakeServer(join(root,'mod'),{asm:'MODDED'}),{settings});
  assert.equal(mod.framework,'modded');assert.match(mod.browserReady.reason,/not one we know/);
  const done=await inspectServer(fakeServer(join(root,'done'),{asm:'PATCHED',extra:{'rust_server_Data/Managed/Assembly-CSharp.dll.rlb-original':'STOCK','rust_server_Data/Managed/RustLegacyBrowser.Vanilla.dll':'x'}}),{settings});
  assert.equal(done.framework,'stock-patched');assert.equal(done.browserReady.done,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('server and run confirmation: a build we do not know needs the owner\'s OK, and is recorded',async()=>{
 const root=tmp(),file=join(root,'data','host.json');
 try{
  mkdirSync(join(root,'data'));
  await initHostJson(file,{dataDir:join(root,'data'),settings});
  assert.deepEqual(validateHostConfig(loadHostConfig(file)),[]);
  for(const k of ['controlKey','pluginKey','metricsToken'])assert.match(readFileSync(paths(join(root,'data'))[k],'utf8'),/^[0-9a-f]{48,}\n$/);
  const own=fakeServer(root,{exe:'OTHER'});
  await assert.rejects(setServer(file,own,{settings}),e=>e.status===409);
  await setServer(file,own,{settings,accept:true});
  let s=loadHostConfig(file).components.server;
  assert.equal(s.exeSha256,sha('OTHER'));assert.equal(s.args[6],'29115');assert.equal(s.confirmRunOriginalBinaries,false);
  confirmRun(file,true);assert.equal(loadHostConfig(file).components.server.confirmRunOriginalBinaries,true);
  await setServer(file,own,{settings,accept:true});
  assert.equal(loadHostConfig(file).components.server.confirmRunOriginalBinaries,true,'same folder and build keep the confirmation');
  await setServer(file,fakeServer(join(root,'second')),{settings});
  s=loadHostConfig(file).components.server;
  assert.equal(s.confirmRunOriginalBinaries,false,'another folder asks again');assert.equal(s.exeSha256,undefined);
  assert.deepEqual(validateHostConfig(loadHostConfig(file)),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('browser ready (vanilla): patch, cfg with the plugin key, refused while running, and undo puts every file back',async()=>{
 const root=tmp(),data=join(root,'data'),file=join(data,'host.json'),bin=join(root,'bin');
 try{
  mkdirSync(data);mkdirSync(bin);writeFileSync(join(bin,'RustLegacyBrowser.Vanilla.dll'),'ADAPTER');
  const dir=fakeServer(root,{extra:{'rust_server_Data/cfg/rustlegacybrowser.cfg':'old settings'}});
  await initHostJson(file,{dataDir:data,server:dir,settings});
  const managed=join(dir,'rust_server_Data','Managed'),cfg=join(dir,'rust_server_Data','cfg','rustlegacybrowser.cfg');
  await assert.rejects(makeBrowserReady(file,{settings,patcher,adapterDir:bin,serverRunning:()=>true}),/Stop the game server/);
  const r=await makeBrowserReady(file,{settings,patcher,adapterDir:bin,launcherOnly:true});
  assert.equal(r.how,'vanilla');
  assert.equal(readFileSync(join(managed,'Assembly-CSharp.dll'),'utf8'),'PATCHED');
  assert.equal(readFileSync(join(managed,'RustLegacyBrowser.Vanilla.dll'),'utf8'),'ADAPTER');
  const key=readFileSync(paths(data).pluginKey,'utf8').trim(),text=readFileSync(cfg,'utf8');
  assert.match(text,new RegExp(`PluginKeyHex=${key}`));assert.match(text,/SidecarUrl=http:\/\/127\.0\.0\.1:28090\/plugin/);assert.match(text,/LauncherOnly=true/);
  let st=await setupStatus(file,{settings});
  assert.equal(st.steps.browserReady.done,true);assert.equal(st.steps.browserReady.byHost,true);assert.equal(st.steps.server.info.framework,'stock-patched');
  // Making it ready again (e.g. LauncherOnly off) rewrites the cfg only.
  await makeBrowserReady(file,{settings,patcher,adapterDir:bin,launcherOnly:false});
  assert.match(readFileSync(cfg,'utf8'),/LauncherOnly=false/);
  await undoBrowserReady(file,{patcher});
  assert.equal(readFileSync(join(managed,'Assembly-CSharp.dll'),'utf8'),'STOCK');
  assert.ok(!existsSync(join(managed,'RustLegacyBrowser.Vanilla.dll'))&&!existsSync(join(managed,'Assembly-CSharp.dll.rlb-original')));
  assert.equal(readFileSync(cfg,'utf8'),'old settings');
  st=await setupStatus(file,{settings});assert.equal(st.steps.browserReady.done,false);
  await assert.rejects(undoBrowserReady(file,{patcher}),e=>e.status===404);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('browser ready (Oxide): our one plugin and its config, their plugins untouched, undo removes ours',async()=>{
 const root=tmp(),data=join(root,'data'),file=join(data,'host.json');
 try{
  mkdirSync(data);
  const dir=fakeServer(root,{asm:'OXIDE',extra:{'rust_server_Data/Managed/Oxide.Core.dll':'x','serverdata/oxide/plugins/Kits.cs':'// theirs','serverdata/oxide/config/Kits.json':'{}'}});
  await initHostJson(file,{dataDir:data,server:dir,settings});
  await makeBrowserReady(file,{settings});
  const ox=join(dir,'serverdata','oxide');
  assert.match(readFileSync(join(ox,'plugins','RustLegacyBrowser.cs'),'utf8'),/class RustLegacyBrowser : RustLegacyPlugin/);
  const conf=JSON.parse(readFileSync(join(ox,'config','RustLegacyBrowser.json'),'utf8'));
  assert.equal(conf.PluginKeyHex,readFileSync(paths(data).pluginKey,'utf8').trim());assert.equal(conf.LauncherOnly,false);
  assert.equal(readFileSync(join(ox,'plugins','Kits.cs'),'utf8'),'// theirs');
  await undoBrowserReady(file);
  assert.ok(!existsSync(join(ox,'plugins','RustLegacyBrowser.cs'))&&!existsSync(join(ox,'config','RustLegacyBrowser.json')));
  assert.equal(readFileSync(join(ox,'plugins','Kits.cs'),'utf8'),'// theirs');assert.equal(readFileSync(join(ox,'config','Kits.json'),'utf8'),'{}');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('website and address: one enrolment code gives the credential and the host key; the gateway config is valid',async()=>{
 const root=tmp(),data=join(root,'data'),file=join(data,'host.json'),c=await central();
 try{
  mkdirSync(data);
  await initHostJson(file,{dataDir:data,server:fakeServer(root),website:c.base+'/',settings});
  const login=await c.call('POST','/auth/login',{data:{subject:'owner-1',name:'Owner'}}),owner={cookie:login.cookie,csrf:login.data.csrf};
  const made=await c.call('POST','/owner/servers',{data:{name:'Setup test',region:'eu',endpoint:'wss://play.example.test/play'},...owner});
  await assert.rejects(connectWebsite(file,{code:'not-a-real-code-but-long-enough'}),e=>e.status===401);
  const r=await connectWebsite(file,{code:made.data.enrolmentCode});
  assert.deepEqual(r,{serverId:made.data.id,hostKey:true});
  const p=paths(data),key=readFileSync(p.hostKey,'utf8').trim();
  assert.equal((await fetch(c.base+`/admin/servers/${made.data.id}/accounts`,{headers:{authorization:'Bearer '+key}})).status,200);
  const h=loadHostConfig(file);assert.deepEqual(Object.keys(h.components).sort(),['gateway','server','sidecar']);assert.deepEqual(validateHostConfig(h),[]);
  const gwFile=()=>JSON.parse(readFileSync(p.gateway,'utf8'));
  const load=g=>({...g,credential:readFileSync(g.credentialFile,'utf8').trim(),controlKeyHex:readFileSync(g.controlKeyFile,'utf8').trim()});
  let gw=gwFile();
  assert.equal(gw.native.port,29115,'the owner\'s own -port');assert.deepEqual(gw.listen,{host:'127.0.0.1',port:28443});
  assert.deepEqual(validateConfig(load(gw)),[]);
  assert.equal(JSON.parse(readFileSync(p.sidecar,'utf8')).serverId,made.data.id);
  setAddress(file,{mode:'proxy',port:8443,cloudflare:false});gw=gwFile();
  assert.deepEqual([gw.listen,gw.trustedProxies],[{host:'127.0.0.1',port:8443},['loopback']]);assert.deepEqual(validateConfig(load(gw)),[]);
  assert.throws(()=>setAddress(file,{mode:'certificate'}),/Add the certificate/);
  setAddress(file,{mode:'certificate',port:443,cloudflare:true,pfx:Buffer.from('PFX').toString('base64'),passphrase:'pw'});gw=gwFile();
  assert.equal(readFileSync(join(p.secrets,'gateway-tls.pfx'),'utf8'),'PFX');assert.equal(readFileSync(join(p.secrets,'gateway-tls.pass'),'utf8').trim(),'pw');
  assert.deepEqual([gw.listen.host,gw.trustedProxies],['0.0.0.0',['cloudflare']]);assert.deepEqual(validateConfig(load(gw)),[]);
  let st=await setupStatus(file,{settings});
  assert.deepEqual(Object.fromEntries(Object.entries(st.steps).map(([k,v])=>[k,v.done])),{server:true,browserReady:false,website:true,address:true,run:false});
  assert.equal(st.complete,false);
 }finally{await c.close();rmSync(root,{recursive:true,force:true});}
});
