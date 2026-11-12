// Config health check (host/health-check.mjs, HOST-AND-LOADER-BUILD.md H9): each check against an injected environment
// (no server, no network), the run summary, and a check that throws becoming a WARN row instead of breaking the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {CHECKS,runHealthChecks,MIN_NODE} from '../host/health-check.mjs';

const NOW=Date.parse('2026-10-24T12:00:00Z'),DAY=86400e3;
const env=(over={})=>({
 platform:'linux',nodeVersion:'22.22.0',now:()=>NOW,dataDir:'/data',settings:{server:{exeSha256:'AA'.repeat(32)}},
 server:{kind:'original',state:'running',udpPort:29015,exe:'/srv/rust_server.exe'},gateway:{host:'127.0.0.1',port:28443,tls:null},
 probeUdp:async()=>({ok:true,ms:3}),tcpOpen:async()=>true,lockdown:async()=>[],sha256File:async()=>'AA'.repeat(32),exists:()=>true,readFile:()=>Buffer.from(''),
 freeBytes:()=>50*1024**3,ownInstalled:()=>({title:'RustLegacyBrowser',version:'0.1.1'}),ownExpected:()=>({version:'0.1.1'}),pluginsDir:'/srv/oxide/plugins',
 vanillaDll:()=>null,vanillaSourceTime:()=>null,adapterConfig:()=>({kind:'oxide',exists:true,values:{LauncherOnly:'true'},pluginKey:{set:true}}),
 centralUrl:'https://example.test/',hostKey:()=>'rlbh_x',website:async()=>({status:200,date:NOW,at:NOW}),
 lastGood:()=>({at:NOW-5*60e3}),autosaveSeconds:()=>600,...over});
const one=async(name,over)=>{const r=await CHECKS[name](env(over));return Array.isArray(r)?r:[r];};
const st=async(name,over)=>(await one(name,over)).map(r=>r.status).join(',');

test('game and gateway ports',async()=>{
 assert.equal(await st('gamePort'),'PASS');
 assert.equal(await st('gamePort',{probeUdp:async()=>({ok:false,reason:'timeout'})}),'FAIL');
 const stopped=(await one('gamePort',{server:{kind:'original',state:'stopped',udpPort:29015}}))[0];
 assert.equal(stopped.status,'WARN');assert.match(stopped.fix,/Start the game server/);
 assert.equal(await st('gamePort',{server:null}),'SKIP');
 assert.equal(await st('gatewayPort'),'PASS');assert.equal(await st('gatewayPort',{tcpOpen:async()=>false}),'FAIL');assert.equal(await st('gatewayPort',{gateway:null}),'SKIP');
});

test('firewall: Test-RlbLockdown rows on Windows for the original server, not available elsewhere',async()=>{
 const linux=(await one('firewall'))[0];assert.equal(linux.status,'SKIP');assert.match(linux.detail,/Not available here/);
 const rows=await one('firewall',{platform:'win32',lockdown:async()=>[{Check:'Windows Firewall on (all profiles)',Status:'PASS',Detail:'Domain, Private, Public'},{Check:'Process Monitor recording',Status:'WARN',Detail:'not running'},{Check:'secrets folder closed to the test account',Status:'FAIL',Detail:'readable'}]});
 assert.deepEqual(rows.map(r=>r.status),['PASS','WARN','FAIL']);assert.equal(rows[0].fix,null);assert.match(rows[2].fix,/setup step/);
 assert.equal((await one('firewall',{platform:'win32',lockdown:async()=>{throw Error('lock-down check could not run: no PowerShell');}}))[0].status,'WARN');
 assert.equal(await st('firewall',{platform:'win32',server:{kind:'mock',state:'running'}}),'SKIP');
});

test('server program hash and our adapter version',async()=>{
 assert.equal(await st('serverExe'),'PASS');
 assert.equal(await st('serverExe',{sha256File:async()=>'BB'.repeat(32)}),'FAIL');
 assert.equal(await st('serverExe',{exists:()=>false}),'FAIL');
 assert.equal(await st('serverExe',{server:{kind:'mock',state:'running'}}),'SKIP');
 assert.equal(await st('adapter'),'PASS');
 const old=(await one('adapter',{ownInstalled:()=>({title:'RustLegacyBrowser',version:'0.1.0'})}))[0];
 assert.equal(old.status,'WARN');assert.match(old.detail,/older/);
 assert.match((await one('adapter',{ownInstalled:()=>({version:'0.2.0'})}))[0].detail,/newer/);
 assert.equal(await st('adapter',{ownInstalled:()=>null,vanillaDll:()=>({mtime:NOW}),vanillaSourceTime:()=>NOW-DAY}),'PASS');
 assert.equal(await st('adapter',{ownInstalled:()=>null,vanillaDll:()=>({mtime:NOW-2*DAY}),vanillaSourceTime:()=>NOW-DAY}),'WARN');
 const none=(await one('adapter',{ownInstalled:()=>null}))[0];assert.equal(none.status,'FAIL');assert.match(none.fix,/\/srv\/oxide\/plugins/);
});

test('LauncherOnly: on passes, off warns, a missing key fails',async()=>{
 assert.equal(await st('launcherOnly'),'PASS');
 const off=(await one('launcherOnly',{adapterConfig:()=>({kind:'vanilla',exists:true,values:{LauncherOnly:'false'},pluginKey:{set:true}})}))[0];
 assert.equal(off.status,'WARN');assert.match(off.fix,/Website players only/);
 assert.equal(await st('launcherOnly',{adapterConfig:()=>({kind:'vanilla',exists:true,values:{LauncherOnly:'true'},pluginKey:{set:false}})}),'FAIL');
 assert.equal(await st('launcherOnly',{adapterConfig:()=>({kind:null})}),'SKIP');
 assert.equal(await st('launcherOnly',{adapterConfig:()=>({kind:'oxide',exists:false})}),'WARN');
});

test('website and host app key, and the clock against the website',async()=>{
 assert.equal(await st('website'),'PASS');
 assert.equal(await st('website',{hostKey:()=>null}),'WARN');
 assert.equal(await st('website',{website:async()=>({status:403,date:NOW,at:NOW})}),'FAIL');
 assert.match((await one('website',{website:async()=>({error:'ECONNREFUSED',date:null,at:NOW})}))[0].detail,/Cannot reach/);
 assert.equal(await st('website',{centralUrl:null}),'SKIP');
 assert.equal(await st('clock'),'PASS');
 assert.equal(await st('clock',{website:async()=>({status:200,date:NOW+15e3,at:NOW})}),'WARN');
 const far=(await one('clock',{website:async()=>({status:200,date:NOW-60e3,at:NOW})}))[0];
 assert.equal(far.status,'FAIL');assert.match(far.detail,/60 s ahead of the website/);
 assert.equal(await st('clock',{website:async()=>({error:'x',date:null,at:NOW})}),'SKIP');
});

test('gateway certificate expiry: PASS, WARN under 14 days, FAIL when expired',async()=>{
 // The check reads validTo with X509Certificate; the certificate is made here (selfSigned below), the clock moves.
 const {pem,validTo}=selfSigned();
 const at=d=>({now:()=>validTo-d,gateway:{host:'0.0.0.0',port:28443,tls:{cert:'/c.pem'}},readFile:()=>pem});
 assert.equal(await st('tls',at(30*DAY)),'PASS');
 assert.equal(await st('tls',at(3*DAY)),'WARN');
 assert.equal(await st('tls',at(-DAY)),'FAIL');
 assert.equal(await st('tls',{gateway:{host:'0.0.0.0',port:1,tls:{cert:'/c.pem'}},readFile:()=>Buffer.from('nope')}),'FAIL');
 assert.equal(await st('tls',{gateway:{host:'127.0.0.1',port:1,tls:null}}),'SKIP');
 assert.equal(await st('tls',{gateway:{host:'0.0.0.0',port:1,tls:null}}),'WARN');
 assert.equal(await st('tls',{gateway:{host:'0.0.0.0',port:1,tls:{pfx:'/x.pfx'}}}),'SKIP');
});

test('disk space, recent backups, Node version',async()=>{
 assert.equal(await st('disk'),'PASS');assert.equal(await st('disk',{freeBytes:()=>3*1024**3}),'WARN');assert.equal(await st('disk',{freeBytes:()=>0.5*1024**3}),'FAIL');
 assert.equal(await st('backups'),'PASS');
 const stale=(await one('backups',{lastGood:()=>({at:NOW-2*3600e3})}))[0];assert.equal(stale.status,'WARN');assert.match(stale.detail,/save every 10 min/);
 assert.equal(await st('backups',{lastGood:()=>({at:NOW-2*3600e3}),server:{kind:'original',state:'stopped'}}),'PASS');
 assert.equal(await st('backups',{lastGood:()=>null}),'WARN');
 assert.equal(await st('node'),'PASS');assert.equal(await st('node',{nodeVersion:'20.11.1'}),'FAIL');assert.equal(await st('node',{nodeVersion:MIN_NODE}),'PASS');
});

test('a full run: every row has a status and plain detail; a failing check becomes a WARN row',async()=>{
 const r=await runHealthChecks(env());
 assert.equal(r.at,NOW);
 for(const row of r.rows){assert.ok(['PASS','WARN','FAIL','SKIP'].includes(row.status),row.id);assert.ok(row.label&&row.detail,row.id);if(row.status==='WARN'||row.status==='FAIL')assert.ok(row.fix,row.id+' needs a fix line');}
 assert.equal(r.summary.pass+r.summary.warn+r.summary.fail+r.summary.skip,r.rows.length);
 const broken=await runHealthChecks(env(),{boom:async()=>{throw Error('kaput');}});
 assert.deepEqual(broken.rows.map(x=>[x.status,/kaput/.test(x.detail)]),[['WARN',true]]);
});

// A minimal self-signed certificate (P-256, one year) built from node:crypto pieces: DER by hand, signed with ECDSA.
function selfSigned(){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
 const len=n=>n<128?Buffer.from([n]):n<256?Buffer.from([0x81,n]):Buffer.from([0x82,n>>8,n&255]);
 const tlv=(tag,...parts)=>{const b=Buffer.concat(parts);return Buffer.concat([Buffer.from([tag]),len(b.length),b]);};
 const seq=(...p)=>tlv(0x30,...p),oid=hex=>tlv(0x06,Buffer.from(hex,'hex'));
 const time=t=>tlv(0x17,Buffer.from(new Date(t).toISOString().replace(/[-:T]/g,'').slice(2,14)+'Z'));
 const from=Date.parse('2026-01-01T00:00:00Z'),to=Date.parse('2027-01-01T00:00:00Z');
 const name=seq(tlv(0x31,seq(oid('550403'),tlv(0x0c,Buffer.from('rlb test')))));
 const ecdsaSha256=seq(oid('2a8648ce3d040302'));
 const tbs=seq(tlv(0xa0,tlv(0x02,Buffer.from([2]))),tlv(0x02,Buffer.from([1])),ecdsaSha256,name,seq(time(from),time(to)),name,publicKey.export({type:'spki',format:'der'}));
 const sig=createSign('sha256').update(tbs).sign(privateKey);
 const der=seq(tbs,ecdsaSha256,tlv(0x03,Buffer.from([0]),sig));
 return {pem:Buffer.from(`-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`),validTo:to};
}
