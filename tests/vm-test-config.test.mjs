// Isolated-VM test topology (deploy/vm-test, SERVER-TESTING-PLAN.md §4/§7): the gateway's vm-test host-only bind
// rules, the shipped vm-test configs, and the ISO builder's import closure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {validateConfig,hostOnlyBindProblems,vmTestBanner,startGateway,parseSubnet,parseIPv4,inSubnet,isPrivateIPv4} from '../bridge/gateway-launcher.mjs';
import {checkCentralConfig} from '../tools/central.mjs';
import {importClosure} from '../tools/build-vm-iso.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const SERVER='12345678-1234-4123-8123-123456789abc';
const vmGateway=()=>({...JSON.parse(read('deploy/vm-test/config/gateway.vm-test.json').replace('__SERVER_ID__',SERVER)),credential:'A'.repeat(43),controlKeyHex:'ab'.repeat(32)});
const has=(errors,re)=>errors.some(e=>re.test(e));
const VM_IFACES={Ethernet0:[{family:'IPv4',address:'192.168.56.10'}],Loopback:[{family:'IPv4',address:'127.0.0.1'}]};

test('IPv4/CIDR helpers', ()=>{
 assert.equal(parseIPv4('192.168.56.10'),0xc0a8380a);
 for(const bad of ['256.1.1.1','1.2.3','01.2.3.4','a.b.c.d','',undefined])assert.equal(parseIPv4(bad),null,String(bad));
 assert.equal(parseSubnet('192.168.56.1/24'),null,'host bits must be zero');
 const net=parseSubnet('192.168.56.0/24');
 assert.ok(inSubnet(parseIPv4('192.168.56.200'),net));assert.ok(!inSubnet(parseIPv4('192.168.57.1'),net));
 assert.ok(isPrivateIPv4(parseIPv4('10.1.2.3'))&&isPrivateIPv4(parseIPv4('172.31.0.1'))&&!isPrivateIPv4(parseIPv4('172.32.0.1'))&&!isPrivateIPv4(parseIPv4('8.8.8.8')));
});

test('shipped vm-test gateway config validates and binds only the VM host-only address', ()=>{
 const c=vmGateway();
 assert.deepEqual(validateConfig(c),[]);
 assert.deepEqual(hostOnlyBindProblems(c,VM_IFACES),[]);
 assert.ok(has(hostOnlyBindProblems(c,{Loopback:[{family:'IPv4',address:'127.0.0.1'}]}),/not an address of this machine/));
 assert.match(vmTestBanner(c),/VM-TEST MODE.*192\.168\.56\.10:28443/);
 assert.match(vmTestBanner(c),/never use this config in production/);
 // Plain ws:// is allowed only in vm-test with the host-only bind.
 const plain={...c};delete plain.tls;
 assert.deepEqual(validateConfig(plain),[]);
 assert.match(vmTestBanner(plain),/PLAIN ws/);
});

test('testHostOnlyBind is rejected outside an explicit mode "vm-test"', ()=>{
 const c=vmGateway();
 assert.ok(has(validateConfig({...c,mode:undefined}),/only allowed with mode "vm-test"/));
 assert.ok(has(validateConfig({...c,mode:'production'}),/only allowed with mode "vm-test"/));
 assert.ok(has(validateConfig({...c,mode:'test'}),/mode must be/));
 const noBind={...c};delete noBind.testHostOnlyBind;
 assert.ok(has(validateConfig(noBind),/requires testHostOnlyBind/));
 // Production-shaped config without TLS on a non-loopback address still needs TLS.
 const prod={...c,mode:undefined};delete prod.testHostOnlyBind;delete prod.tls;
 assert.ok(has(validateConfig(prod),/serve TLS/));
});

test('vm-test refuses public, wildcard, hostname and out-of-subnet binds', ()=>{
 const c=vmGateway(),bind=host=>validateConfig({...c,listen:{host,port:28443}});
 assert.ok(has(bind('8.8.8.8'),/refuses public listen address/));
 assert.ok(has(bind('0.0.0.0'),/wildcard/));
 assert.ok(has(bind('gateway.local'),/IPv4 address/));
 assert.ok(has(bind('192.168.1.10'),/outside the host-only subnet/));
 assert.ok(has(bind('127.0.0.1'),/loopback/));
 assert.ok(has(bind('192.168.56.0'),/network or broadcast/));
 assert.ok(has(bind('192.168.56.255'),/network or broadcast/));
 assert.ok(has(validateConfig({...c,listen:{host:'192.168.56.10'}}),/listen.port/));
});

test('vm-test subnet is configurable but must be private and narrow', ()=>{
 const c=vmGateway(),withNet=(subnet,host)=>({...c,testHostOnlyBind:{subnet},listen:{host,port:28443},centralUrl:`http://${host.replace(/\d+$/,'1')}:8080/`,allowedOrigins:[`http://${host.replace(/\d+$/,'1')}:8080`]});
 assert.deepEqual(validateConfig(withNet('10.42.7.0/24','10.42.7.10')),[]);
 assert.ok(has(validateConfig(withNet('8.8.8.0/24','8.8.8.10')),/private range/));
 assert.ok(has(validateConfig(withNet('10.0.0.0/8','10.0.0.10')),/prefix/));
 assert.ok(has(validateConfig(withNet('192.168.56.5/24','192.168.56.10')),/zero host bits/));
 assert.ok(has(validateConfig({...c,testHostOnlyBind:{}}),/CIDR/));
 assert.deepEqual(validateConfig({...c,testHostOnlyBind:true}),[],'true means the default 192.168.56.0/24');
});

test('vm-test keeps the rest of the topology on loopback and inside the subnet', ()=>{
 const c=vmGateway();
 assert.ok(has(validateConfig({...c,native:{host:'192.168.56.20',port:29015}}),/native.host must be 127.0.0.1/));
 assert.ok(has(validateConfig({...c,centralUrl:'https://play.example.com/'}),/centralUrl/));
 assert.ok(has(validateConfig({...c,allowedOrigins:['http://evil.example']}),/origin http:\/\/evil.example/));
 assert.ok(has(validateConfig({...c,allowedOrigins:['http://192.168.56.1:8080/path']}),/must be http\(s\)/));
 assert.ok(has(validateConfig({...c,allowPlainHttp:true}),/remove allowPlainHttp/));
 assert.ok(has(validateConfig({...c,allowInsecureOrigins:true}),/remove allowInsecureOrigins/));
 assert.ok(has(validateConfig({...c,sidecarUrl:'http://192.168.56.10:28090'}),/sidecarUrl must be on 127.0.0.1/));
 assert.ok(has(validateConfig({...c,tls:{pfx:''}}),/tls needs/));
});

test('startGateway refuses a vm-test bind address this machine does not have, before listening', async()=>{
 const warnings=[];
 await assert.rejects(startGateway(vmGateway(),{schema:{},interfaces:{Loopback:[{family:'IPv4',address:'127.0.0.1'}]},warn:w=>warnings.push(w),fetchImpl:()=>{throw Error('must not contact central');}}),/Refusing vm-test bind/);
 assert.equal(warnings.length,0);
});

test('production example is unchanged by the vm-test rules', ()=>{
 const ex={...JSON.parse(read('deploy/gateway.example.json')),serverId:SERVER,credential:'A'.repeat(43),controlKeyHex:'ab'.repeat(32)};
 assert.deepEqual(validateConfig(ex),[]);
 assert.ok(has(validateConfig({...ex,testHostOnlyBind:{subnet:'192.168.56.0/24'}}),/only allowed with mode "vm-test"/));
});

test('shipped vm-test central, sidecar and server configs', ()=>{
 const central=JSON.parse(read('deploy/vm-test/config/central.vm-test.json').replace('__STATE_DIR__','C:/state').replace('__SIGNING_KEY__','C:/state/keys/signing-x.pem'));
 assert.deepEqual(checkCentralConfig(central),[]);
 const settings=JSON.parse(read('deploy/vm-test/settings.json'));
 assert.equal(central.listen.host,settings.network.hostAddress,'central binds only the host-only address');
 const gw=vmGateway();
 assert.equal(gw.listen.host,settings.network.vmAddress);assert.equal(gw.listen.port,settings.ports.gateway);
 assert.equal(gw.native.port,settings.ports.server);assert.ok(settings.server.args.includes(String(settings.ports.server)));
 assert.equal(new URL(gw.centralUrl).port,String(settings.ports.central));
 const side=JSON.parse(read('deploy/vm-test/config/sidecar.vm-test.json'));
 assert.equal(side.port,settings.ports.sidecar);assert.equal(side.controlKeyFile,gw.controlKeyFile);
 assert.ok(BigInt(side.namespace.base)>76561202255233023n&&BigInt(side.namespace.base)+BigInt(side.namespace.size)<2n**63n,'test identities stay clear of the Steam ID range');
 // server.cfg: the shipped file with only the rcon password replaced (line endings aside: a Windows checkout may
 // convert the committed copy to CRLF).
 const lf=t=>t.replace(/\r\n/g,'\n'),ref=lf(read('deploy/vm-test/server/server.cfg'));
 assert.match(ref,/^rcon\.password "__RCON_PASSWORD__"$/m);
 const shipped=new URL('../analysis/server-audit/cfg/server.cfg',import.meta.url);
 if(existsSync(shipped))assert.equal(ref.replace('"__RCON_PASSWORD__"','"rconpassword"'),lf(readFileSync(shipped,'utf8')));
 // No secrets committed: only placeholders.
 for(const f of ['config/gateway.vm-test.json','config/sidecar.vm-test.json','config/central.vm-test.json','config/rustlegacybrowser.cfg.template','server/server.cfg'])
  assert.ok(!/[0-9a-f]{64}/i.test(read('deploy/vm-test/'+f)),f+' holds no key material');
});

test('ISO builder import closure covers the gateway and sidecar entry points', ()=>{
 const c=importClosure(['tools/gateway.mjs','tools/adapter-sidecar.mjs']);
 assert.deepEqual(c.missing,[]);
 for(const f of ['tools/gateway.mjs','tools/adapter-sidecar.mjs','bridge/gateway-launcher.mjs','bridge/sidecar.mjs'])assert.ok(c.files.map(x=>x.replace(/\\/g,'/')).includes(f),f);
 assert.ok(c.packages.includes('ws'));
});
