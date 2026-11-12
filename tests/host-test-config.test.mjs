// Firewall-locked host test topology (deploy/host-test, SERVER-TESTING-PLAN.md §10): every service on 127.0.0.1, the
// shipped configs validate, and the settings pin the verified server files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {validateConfig} from '../bridge/gateway-launcher.mjs';
import {checkCentralConfig} from '../tools/central.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const SERVER='12345678-1234-4123-8123-123456789abc';
const render=t=>t.replaceAll('__SERVER_ID__',SERVER).replaceAll('__ROOT__','C:/RLB-host').replaceAll('__REPO__','C:/repo');
const hostGateway=()=>({...JSON.parse(render(read('deploy/host-test/config/gateway.host-test.json'))),credential:'A'.repeat(43),controlKeyHex:'ab'.repeat(32)});
const settings=JSON.parse(read('deploy/host-test/settings.json'));

test('host-test gateway config validates as a production-mode loopback gateway with TLS', ()=>{
 const c=hostGateway();
 assert.deepEqual(validateConfig(c),[]);
 assert.equal(c.mode,undefined,'no vm-test mode: the ordinary loopback rules apply');
 assert.equal(c.listen.host,'127.0.0.1');assert.equal(c.native.host,'127.0.0.1');assert.equal(new URL(c.sidecarUrl).hostname,'127.0.0.1');
 assert.equal(new URL(c.centralUrl).hostname,'127.0.0.1');assert.deepEqual(c.allowedOrigins,['http://127.0.0.1:8080']);
 assert.ok(c.tls.pfx.startsWith('C:/RLB-host/secrets/'),'TLS key lives in the locked secrets folder');
 assert.equal(c.native.port,settings.ports.server);assert.equal(c.listen.port,settings.ports.gateway);
});

test('host-test central and sidecar configs stay on loopback', ()=>{
 const central=JSON.parse(read('deploy/host-test/config/central.host-test.json').replace('__STATE_DIR__','C:/RLB-host/central').replace('__SIGNING_KEY__','C:/RLB-host/central/keys/signing-x.pem'));
 assert.equal(central.listen.host,'127.0.0.1');assert.equal(new URL(central.publicUrl).hostname,'127.0.0.1');
 assert.deepEqual(checkCentralConfig(central),[]);
 const side=JSON.parse(render(read('deploy/host-test/config/sidecar.host-test.json')));
 assert.equal(side.port,settings.ports.sidecar);assert.equal(side.controlKeyFile,hostGateway().controlKeyFile);
 assert.match(read('deploy/host-test/config/rustlegacybrowser.cfg.template'),/^SidecarUrl=http:\/\/127\.0\.0\.1:28090\/plugin$/m);
 const native=JSON.parse(read('deploy/host-test/config/native-test.host-test.json'));
 assert.equal(new URL(native.centralUrl).hostname,'127.0.0.1');assert.equal(new URL(native.metrics.url).hostname,'127.0.0.1');
});

test('host-test settings pin the verified server files and keep the unverified ones out', ()=>{
 assert.equal(settings.server.exeSha256,'7D80D881AD9B7D458C2BCA85D550167609369CC35D213A69D6F4B5C828E307B7');
 assert.equal(settings.server.zipSha256,JSON.parse(read('deploy/vm-test/settings.json')).server.zipSha256);
 assert.equal(settings.server.assemblyCSharpSha256,JSON.parse(read('deploy/vm-test/settings.json')).server.assemblyCSharpSha256);
 assert.deepEqual(settings.server.removeFromTestCopy,['VAC2.dll']);
 assert.deepEqual(settings.server.lumaEmu,{SteamStatus:{Offline:'1'},MasterServer:{Master:'0'},DLC:{UnlockDLC:'2'}});
 assert.deepEqual(settings.server.args,JSON.parse(read('deploy/vm-test/settings.json')).server.args);
});

test('no secrets committed in deploy/host-test', ()=>{
 const files=[...readdirSync(new URL('../deploy/host-test/config/',import.meta.url)).map(f=>'deploy/host-test/config/'+f),'deploy/host-test/settings.json',...readdirSync(new URL('../deploy/host-test/scripts/',import.meta.url)).map(f=>'deploy/host-test/scripts/'+f)];
 for(const f of files)assert.ok(!/[0-9a-f]{64}/.test(read(f)),f+' holds no lowercase 64-hex key material');
});
