// Plugin manager (host/plugins.mjs, HOST-AND-LOADER-BUILD.md H7) in a temp Oxide folder: list with [Info] parsed,
// turn off and on (plugins/disabled), upload (name, size, [Info] and class checks; a replaced file is archived), remove
// into plugins/removed, our own adapter protected, reload without a console path, and nothing outside the folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {Readable} from 'node:stream';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlugins,parseInfo,compareVersions,MAX_PLUGIN_BYTES} from '../host/plugins.mjs';

const own=readFileSync(new URL('../adapter/RustLegacyBrowser.cs',import.meta.url),'utf8');
const plugin=(cls,title=cls,author='Someone',version='1.0.0')=>`using Oxide.Core;\nnamespace Oxide.Plugins\n{\n    [Info("${title}", "${author}", "${version}")]\n    [Description("Does a thing")]\n    class ${cls} : RustLegacyPlugin { }\n}\n`;
const body=t=>Readable.from([Buffer.from(t)]);
function setup(opts={}){
 const root=mkdtempSync(join(tmpdir(),'rlb-plugins-')),dir=join(root,'oxide','plugins');mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,'RustLegacyBrowser.cs'),own);writeFileSync(join(dir,'Kits.cs'),plugin('Kits','Kits','Reneb','2.3.1'));
 writeFileSync(join(dir,'notes.txt'),'not a plugin');writeFileSync(join(root,'outside.cs'),plugin('outside'));
 const logs=[];
 return {root,dir,logs,p:createPlugins({dir,ownSource:own,log:t=>logs.push(t),now:()=>Date.parse('2026-10-24T12:00:00Z'),...opts}),done:()=>rmSync(root,{recursive:true,force:true})};
}

test('parseInfo reads Oxide\'s [Info] and [Description], verbatim strings too; versions compare as numbers',()=>{
 assert.deepEqual(parseInfo(plugin('Kits','Kits','Reneb','2.3.1')),{title:'Kits',author:'Reneb',version:'2.3.1',description:'Does a thing',className:'Kits'});
 assert.equal(parseInfo('[Info(@"Name", @"Me", "0.2")] class X : P {}').version,'0.2');
 assert.equal(parseInfo('class X {}').title,null);
 const o=parseInfo(own);assert.equal(o.title,'RustLegacyBrowser');assert.match(o.version,/^\d+\.\d+\.\d+$/);
 assert.equal(compareVersions('0.10.0','0.9.1'),1);assert.equal(compareVersions('1.0','1.0.0'),0);assert.equal(compareVersions('0.1.0','0.1.1'),-1);assert.equal(compareVersions(null,'1'),null);
});

test('plugins: list, turn off and on, remove into the archive, our adapter protected, reload waits for a restart',async()=>{
 const t=setup();
 try{
  let s=t.p.status();
  assert.deepEqual(s.plugins.map(x=>[x.name,x.state,x.version,x.protected]),[['Kits','on','2.3.1',false],['RustLegacyBrowser','on',parseInfo(own).version,true]]);
  assert.equal(s.reloadAvailable,false);
  const off=await t.p.disable('Kits');assert.equal(off.applied,false);assert.match(off.note,/next restart/);
  assert.ok(existsSync(join(t.dir,'disabled','Kits.cs'))&&!existsSync(join(t.dir,'Kits.cs')));
  assert.deepEqual(t.p.status().plugins.find(x=>x.name==='Kits').state,'off');
  await assert.rejects(async()=>t.p.disable('Kits'),/not on/);
  await t.p.enable('Kits');assert.ok(existsSync(join(t.dir,'Kits.cs')));
  for(const verb of ['disable','remove','reload'])await assert.rejects(async()=>t.p[verb]('RustLegacyBrowser'),e=>e.status===403,verb);
  for(const bad of ['../outside','..\\outside','oxide/plugins/Kits','Kits.cs','','1Kits','Ki ts',null,{}])await assert.rejects(async()=>t.p.disable(bad),e=>e.status===400,String(bad));
  assert.match((await t.p.reload('Kits')).note,/next restart/);
  await t.p.remove('Kits');
  assert.deepEqual(readdirSync(join(t.dir,'removed')),['Kits.20261024-120000.cs.removed']);
  assert.equal(t.p.status().removed[0].name,'Kits');assert.ok(existsSync(join(t.root,'outside.cs')));
  assert.match(t.logs.join('\n'),/Kits removed/);
 }finally{t.done();}
});

test('plugins: upload checks the name, size, text, [Info] and class; a replaced plugin is archived',async()=>{
 const t=setup();
 try{
  const bad=[['../evil.cs',plugin('evil'),400],['Evil.dll','x',400],['RustLegacyBrowser.cs',own,403],['Big.cs','x'.repeat(MAX_PLUGIN_BYTES+1),413],
   ['Empty.cs','',400],['NoInfo.cs','class NoInfo : RustLegacyPlugin {}',400],['Wrong.cs',plugin('Other'),400],['Bin.cs','\u0000\u0001',400]];
  for(const [name,src,status] of bad)await assert.rejects(t.p.upload(name,body(src)),e=>e.status===status,name);
  assert.deepEqual(readdirSync(t.dir).sort(),['Kits.cs','RustLegacyBrowser.cs','notes.txt'],'nothing written by a refused upload');
  const r=await t.p.upload('Teleport.cs',body(plugin('Teleport','Teleport','Someone','0.4.0')));
  assert.equal(r.name,'Teleport');assert.equal(r.version,'0.4.0');assert.equal(r.replaced,false);assert.match(r.note,/next restart/);
  const again=await t.p.upload('Kits.cs',body(plugin('Kits','Kits','Reneb','2.4.0')));
  assert.equal(again.replaced,true);
  assert.equal(t.p.status().plugins.find(x=>x.name==='Kits').version,'2.4.0');
  assert.equal(readdirSync(join(t.dir,'removed')).length,1);
  assert.ok(!readdirSync(t.dir).some(f=>f.endsWith('.rlb-tmp')));
 }finally{t.done();}
});

test('plugins: with a console command path, a change is sent as oxide.load/unload/reload',async()=>{
 const sent=[],t=setup({consoleCommand:async c=>{sent.push(c);}});
 try{
  assert.equal(t.p.status().reloadAvailable,true);
  await t.p.disable('Kits');await t.p.enable('Kits');const r=await t.p.reload('Kits');
  assert.deepEqual(sent,['oxide.unload Kits','oxide.load Kits','oxide.reload Kits']);assert.equal(r.applied,true);
 }finally{t.done();}
 const u=createPlugins({dir:null});assert.deepEqual(u.status(),{configured:false});
});

// Through the service: the same sign-in, Origin and X-RLB-Host rules as every other route; upload is the raw body.
test('API: Settings, Plugins and the health check sit behind the service\'s sign-in and CSRF checks',{timeout:60000},async()=>{
 const {startHost}=await import('../host/host.mjs'),{createServiceHandler}=await import('../host/service.mjs');
 const {createServer,request}=await import('node:http'),{listenServer}=await import('../bridge/listen.mjs');
 const root=mkdtempSync(join(tmpdir(),'rlb-tools-api-')),dir=join(root,'Rust Server');
 mkdirSync(join(dir,'oxide','plugins'),{recursive:true});mkdirSync(join(dir,'cfg'),{recursive:true});
 writeFileSync(join(dir,'oxide','plugins','RustLegacyBrowser.cs'),own);writeFileSync(join(dir,'cfg','server.cfg'),'server.hostname "API test"\nrcon.password "never-shown-12345"\n');
 const host=await startHost({listen:{host:'127.0.0.1',port:0},dataDir:join(root,'data'),components:{server:{kind:'mock',dir,port:1}},watchdog:{enabled:false,hangSeconds:90,graceSeconds:300,probeEveryMs:5000}},{noRemote:true});
 const http=createServer();await listenServer(http);const port=http.address().port,token='t'.repeat(43);
 const handler=createServiceHandler({host,token,port});http.on('request',handler);
 const call=(path,{method='GET',body,raw,cookie,csrf=true}={})=>new Promise((res,rej)=>{
  const headers={host:`127.0.0.1:${port}`,...(cookie?{cookie}:{}),...(method==='POST'?{origin:`http://127.0.0.1:${port}`,'content-type':raw?'text/plain':'application/json',...(csrf?{'x-rlb-host':'1'}:{})}:{})};
  const q=request({host:'127.0.0.1',port,path,method,headers},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{let json=null;try{json=JSON.parse(b);}catch{}res({status:r.statusCode,headers:r.headers,json,text:b});});});
  q.on('error',rej);q.end(raw??(body?JSON.stringify(body):undefined));
 });
 try{
  for(const p of ['/api/server-settings','/api/plugins','/api/health-check'])assert.equal((await call(p)).status,401,p);
  const cookieHeader=(await call('/api/login',{method:'POST',body:{token}})).headers['set-cookie'][0].split(';')[0];
  const s=await call('/api/server-settings',{cookie:cookieHeader});
  assert.equal(s.status,200);assert.equal(s.json.values.find(v=>v.key==='server.hostname').value,'API test');assert.ok(!s.text.includes('never-shown'));
  assert.equal((await call('/api/server-settings',{method:'POST',cookie:cookieHeader,csrf:false,body:{values:{'server.pvp':false}}})).status,403);
  const saved=await call('/api/server-settings',{method:'POST',cookie:cookieHeader,body:{version:s.json.version,values:{'server.pvp':false}}});
  assert.equal(saved.status,200);assert.match(readFileSync(join(dir,'cfg','server.cfg'),'utf8'),/server\.pvp "false"/);
  assert.equal((await call('/api/server-settings',{method:'POST',cookie:cookieHeader,body:{values:{'server.pvp':'maybe'}}})).status,400);
  assert.equal((await call('/api/plugins/upload?name=Hello.cs',{method:'POST',cookie:cookieHeader,csrf:false,raw:plugin('Hello')})).status,403);
  const up=await call('/api/plugins/upload?name=Hello.cs',{method:'POST',cookie:cookieHeader,raw:plugin('Hello')});
  assert.equal(up.status,200);assert.ok(existsSync(join(dir,'oxide','plugins','Hello.cs')));
  assert.equal((await call('/api/plugins/upload?name=..%2FHello.cs',{method:'POST',cookie:cookieHeader,raw:plugin('Hello')})).status,400);
  assert.equal((await call('/api/plugins/disable',{method:'POST',cookie:cookieHeader,body:{name:'RustLegacyBrowser'}})).status,403);
  assert.equal((await call('/api/plugins/disable',{method:'POST',cookie:cookieHeader,body:{name:'Hello'}})).status,200);
  assert.equal((await call('/api/plugins/rename',{method:'POST',cookie:cookieHeader,body:{name:'Hello'}})).status,404);
  const list=await call('/api/plugins',{cookie:cookieHeader});assert.deepEqual(list.json.plugins.map(p=>[p.name,p.state]),[['RustLegacyBrowser','on'],['Hello','off']]);
  assert.equal((await call('/api/health-check',{cookie:cookieHeader})).json,null,'nothing run yet');
  const hc=await call('/api/health-check',{method:'POST',cookie:cookieHeader});
  assert.equal(hc.status,200);assert.ok(hc.json.rows.some(r=>r.id==='adapter'&&r.status==='PASS'),JSON.stringify(hc.json.rows.find(r=>r.id==='adapter')));
  assert.equal((await call('/api/health-check',{cookie:cookieHeader})).json.at,hc.json.at);
 }finally{handler.close();await new Promise(r=>http.close(r));await host.close();rmSync(root,{recursive:true,force:true});}
});
