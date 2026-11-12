// Public OVH game VPS (deploy/game-vps, README there): rendered configs validate, the gateway is public-safe (TLS from
// secrets, Cloudflare-only proxies, the live website as the only origin), browser-only (LauncherOnly, no native port),
// and the firewall script opens nothing but 443 from Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateConfig} from '../bridge/gateway-launcher.mjs';
import {createClientIp,CLOUDFLARE_RANGES} from '../bridge/client-ip.mjs';
import {kitAppFiles} from '../tools/build-azure-kit.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const PUBLIC='203.0.113.83',ID='12345678-1234-4123-8123-123456789abc';
const render=t=>t.replaceAll('__PUBLIC_IP__',PUBLIC).replaceAll('__SERVER_ID__',ID).replaceAll('__ROOT__','C:/RLB-host').replaceAll('__REPO__','C:/RLB-kit/app');
const cfg=n=>JSON.parse(render(read(`deploy/game-vps/config/${n}.game-vps.json`)));

test('game VPS gateway validates: TLS on the public address 443, live website only, Cloudflare as the only proxy',()=>{
 const g={...cfg('gateway'),credential:'A'.repeat(43),controlKeyHex:'ab'.repeat(32)};
 assert.deepEqual(validateConfig(g),[]);
 assert.equal(g.mode,undefined);assert.equal(g.allowInsecureOrigins,undefined);assert.equal(g.allowPlainHttp,undefined);
 assert.deepEqual(g.listen,{host:PUBLIC,port:443});
 assert.deepEqual(g.tls,{pfx:'C:/RLB-host/secrets/gateway-tls.pfx',passphraseFile:'C:/RLB-host/secrets/gateway-tls.pass'});
 assert.equal(g.centralUrl,'https://your-domain.example/');assert.deepEqual(g.allowedOrigins,['https://your-domain.example']);
 assert.deepEqual(g.trustedProxies,['cloudflare']);
 assert.equal(g.native.host,'127.0.0.1');assert.equal(new URL(g.sidecarUrl).hostname,'127.0.0.1');
 assert.equal(g.desktop,undefined,'browser-only until the desktop launcher ships');
 assert.equal(g.anticheat.policy.autoKick,false,'flag-only until real-player data');
 assert.equal(g.capacity,100);
 // Behind Cloudflare the gateway's per-client limits see the player, and a direct caller cannot claim another address.
 const ip=createClientIp(g.trustedProxies);
 assert.equal(ip({socket:{remoteAddress:'104.16.0.1'},headers:{'x-forwarded-for':'198.51.100.7'}}),'198.51.100.7');
 assert.equal(ip({socket:{remoteAddress:'203.0.113.9'},headers:{'x-forwarded-for':'198.51.100.7'}}),'203.0.113.9');
});

test('game VPS sidecar and adapter config: loopback sidecar, LauncherOnly on',()=>{
 const s=cfg('sidecar');
 assert.equal(s.port,28090);assert.equal(s.controlKeyFile,'C:/RLB-host/secrets/control.key');assert.equal(s.pluginKeyFile,'C:/RLB-host/secrets/plugin.key');
 assert.equal(s.serverId,ID);
 const t=read('deploy/game-vps/config/rustlegacybrowser.cfg.template');
 assert.match(t,/^LauncherOnly=true$/m);assert.match(t,/^SidecarUrl=http:\/\/127\.0\.0\.1:28090\/plugin$/m);assert.match(t,/^PluginKeyHex=__PLUGIN_KEY_HEX__$/m);
});

test('firewall script: only TCP 443 for node from Cloudflare, admin access only from the owner, never the game port',()=>{
 const s=read('deploy/game-vps/scripts/01-Set-GameVpsConfig.ps1');
 const rules=[...s.matchAll(/New-NetFirewallRule[^\n]*\n?[^\n]*/g)].map(m=>m[0]);
 assert.equal(rules.length,1,'one new rule');
 assert.match(rules[0],/-Direction Inbound -Action Allow -Protocol TCP/);assert.match(rules[0],/-LocalPort 443 /);
 assert.match(rules[0],/-RemoteAddress \$ranges/);assert.match(rules[0],/-Program \$node/);assert.match(rules[0],/-LocalAddress \$PublicIp/);
 assert.ok(!/29015|-Protocol UDP/.test(s.replace(/nothing opens UDP 29015[^\n]*/,'')),'the server port is never opened');
 assert.match(s,/DisplayGroup 'Remote Desktop'[^\n]*Set-NetFirewallRule -RemoteAddress \$OwnerIp/);
 assert.match(s,/OpenSSH-Server-In-TCP'[^\n]*Set-NetFirewallRule -RemoteAddress \$OwnerIp/);
 assert.match(s,/client-ip\.mjs/,'falls back to the gateway\'s own Cloudflare list');
 assert.ok(CLOUDFLARE_RANGES.length>=20);
 for(const f of ['01-Set-GameVpsConfig.ps1','02-New-OriginCsr.ps1','03-Install-OriginCert.ps1'])
  assert.match(read('deploy/game-vps/scripts/'+f),/Confirm-OrExit \$Apply\.IsPresent/,f+' is a dry run unless -Apply');
});

test('certificate scripts keep the key on the VPS and only in the gateway PFX',()=>{
 const csr=read('deploy/game-vps/scripts/02-New-OriginCsr.ps1'),inst=read('deploy/game-vps/scripts/03-Install-OriginCert.ps1');
 assert.match(csr,/MachineKeySet = TRUE/);assert.match(csr,/KeyAlgorithm = ECDSA_P256/);assert.match(csr,/certreq\.exe -new/);
 assert.match(inst,/CloudFlare Origin/);assert.match(inst,/certreq\.exe -accept -machine/);
 assert.match(inst,/Export-PfxCertificate[^\n]*gateway-tls|\$pfx[^\n]*-CryptoAlgorithmOption AES256_SHA256/);
 assert.match(inst,/Remove-Item[^\n]*-DeleteKey/,'deleted from the store after export');
 assert.ok(!/Export-Certificate[^\n]*Pkcs8|ExportPkcs8|private key/i.test(inst.replace(/has its private key/,'')),'never writes the key anywhere else');
});

test('the kit carries the game VPS layer',()=>{
 assert.ok(kitAppFiles().trees.includes('deploy/game-vps'));
});
