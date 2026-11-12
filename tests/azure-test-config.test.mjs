// Azure test VM topology (deploy/azure-test, SERVER-TESTING-PLAN.md §11): rendered configs validate, the website and
// gateway listen on the VM's private address with the public address as origin, and the kit carries what the VM needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateConfig} from '../bridge/gateway-launcher.mjs';
import {checkCentralConfig} from '../tools/central.mjs';
import {kitAppFiles} from '../tools/build-azure-kit.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const PRIVATE='10.0.0.4',PUBLIC='20.90.1.2';
const render=t=>t.replaceAll('__PRIVATE_IP__',PRIVATE).replaceAll('__PUBLIC_IP__',PUBLIC).replaceAll('__SERVER_ID__','12345678-1234-4123-8123-123456789abc')
 .replaceAll('__ROOT__','C:/RLB-host').replaceAll('__REPO__','C:/RLB-kit/app').replaceAll('__STATE_DIR__','C:/RLB-host/central').replaceAll('__SIGNING_KEY__','C:/RLB-host/central/keys/signing-x.pem');
const cfg=n=>JSON.parse(render(read(`deploy/azure-test/config/${n}.azure-test.json`)));

test('Azure gateway config validates: TLS on the private address, the public website as origin', ()=>{
 const g={...cfg('gateway'),credential:'A'.repeat(43),controlKeyHex:'ab'.repeat(32)};
 assert.deepEqual(validateConfig(g),[]);
 assert.equal(g.mode,undefined,'no vm-test exception');
 assert.equal(g.listen.host,PRIVATE);assert.ok(g.tls.pfx.startsWith('C:/RLB-host/secrets/'));
 assert.equal(g.native.host,'127.0.0.1');assert.equal(new URL(g.sidecarUrl).hostname,'127.0.0.1');
 assert.deepEqual(g.allowedOrigins,[`http://${PUBLIC}:8080`]);assert.equal(new URL(g.centralUrl).hostname,PRIVATE);
 const noTls={...g};delete noTls.tls;
 assert.ok(validateConfig(noTls).some(e=>/serve TLS/.test(e)),'a non-loopback gateway without TLS is refused');
});

test('Azure central config validates and is reached on the public address', ()=>{
 const c=cfg('central');
 assert.deepEqual(checkCentralConfig(c),[]);
 assert.equal(c.listen.host,PRIVATE);assert.equal(new URL(c.publicUrl).host,`${PUBLIC}:8080`);
 assert.deepEqual(c.allowedOrigins,[`http://${PUBLIC}:8080`]);assert.equal(c.serveGame,true);
 const side=cfg('sidecar');assert.equal(side.controlKeyFile,'C:/RLB-host/secrets/control.key');
 const native=JSON.parse(read('deploy/azure-test/config/native-test.azure-test.json').replaceAll('__PUBLIC_IP__',PUBLIC));
 assert.equal(new URL(native.centralUrl).hostname,PUBLIC);
});

test('Cloud Shell script opens only RDP, website and gateway, only to the owner IP', ()=>{
 const s=read('deploy/azure-test/cloudshell/New-RlbTestVm.ps1');
 const rules=[...s.matchAll(/nsg rule create[^\n]*\n[^\n]*--source-address-prefixes "\$MyIp\/32" --destination-port-ranges ([0-9 ]+)/g)].map(m=>m[1].trim());
 assert.deepEqual(rules,['3389','8080 28443']);
 assert.ok(!/29015/.test(s.replace(/UDP 29015 stays closed[^\n]*/,'')),'the server port is never opened');
 assert.match(s,/--size \$Size/);assert.match(s,/\[string\]\$Size = 'Standard_D2as_v7'/);assert.match(s,/\[string\]\$Location = 'ukwest'/);assert.match(s,/--disk-controller-type NVMe/);
 assert.match(s,/vm auto-shutdown/);assert.ok(!/--admin-password/.test(s),'az prompts for the password; the script never handles it');
});

test('kit carries the website, game, gateway, sidecar, scripts and adapter build', ()=>{
 const {files,trees,packages}=kitAppFiles();
 for(const f of ['tools/central.mjs','tools/gateway.mjs','tools/adapter-sidecar.mjs','tools/serve.mjs','package.json','deploy/vm-test/server/server.cfg','deploy/vm-test/host/probe-gateway-cert.mjs'])assert.ok(files.includes(f),f);
 for(const t of ['browser','site','central','bridge','deploy/host-test','deploy/azure-test','build/vm-test/adapter','node_modules/three','node_modules/ws','node_modules/@dimforge/rapier3d-compat'])assert.ok(trees.includes(t),t);
 assert.ok(packages.includes('ws'));
});
