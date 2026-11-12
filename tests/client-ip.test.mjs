// Real client address behind trusted reverse proxies (bridge/client-ip.mjs): Caddy on loopback in front of central,
// Cloudflare in front of Caddy and the gateway. Rate limits key on this address, so spoofed headers must never count.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientIp,trustedProxyErrors} from '../bridge/client-ip.mjs';
import {checkCentralConfig} from '../tools/central.mjs';
import {validateConfig} from '../bridge/gateway-launcher.mjs';
import {central} from './helpers/central-fixture.mjs';
import {startStack} from './helpers/stack.mjs';
import {readFileSync} from 'node:fs';

const CF_EDGE='104.16.0.1',CF_EDGE6='2606:4700::1';
const req=(peer,headers={})=>({socket:{remoteAddress:peer},headers});

test('without trusted proxies the socket address is the client, whatever the headers claim',()=>{
 const ip=createClientIp();
 assert.equal(ip(req('203.0.113.9',{'x-forwarded-for':'198.51.100.7','cf-connecting-ip':'198.51.100.8'})),'203.0.113.9');
 assert.equal(ip(req('::ffff:203.0.113.9')),'203.0.113.9','IPv4-mapped IPv6 is shown as plain IPv4');
});

test('behind Caddy and Cloudflare the first untrusted hop from the right is the client',()=>{
 const ip=createClientIp(['loopback','cloudflare']);
 // Cloudflare sends X-Forwarded-For: <client>; Caddy (trusting Cloudflare) appends the edge address.
 assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':`198.51.100.7, ${CF_EDGE}`})),'198.51.100.7');
 // A client that sends its own X-Forwarded-For only adds entries to the left of the real one.
 assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':`10.9.9.9, 198.51.100.7, ${CF_EDGE}`})),'198.51.100.7');
 // Someone reaching Caddy directly: Caddy appends their real address, which is not trusted.
 assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'198.51.100.7, 203.0.113.66'})),'203.0.113.66');
 // Caddy that replaced the header with only the edge address: CF-Connecting-IP, set by Cloudflare, names the client.
 assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':CF_EDGE,'cf-connecting-ip':'198.51.100.7'})),'198.51.100.7');
 assert.equal(ip(req('::ffff:127.0.0.1',{'x-forwarded-for':`2001:db8::5, ${CF_EDGE6}`})),'2001:db8::5','IPv6 clients and edges');
 // Loopback with no forwarding headers is a local caller.
 assert.equal(ip(req('127.0.0.1')),'127.0.0.1');
});

test('headers from an untrusted peer are ignored, and CF-Connecting-IP needs a Cloudflare hop',()=>{
 const both=createClientIp(['loopback','cloudflare']),loop=createClientIp(['loopback']),cf=createClientIp(['cloudflare']);
 assert.equal(both(req('203.0.113.66',{'x-forwarded-for':'198.51.100.7','cf-connecting-ip':'198.51.100.7'})),'203.0.113.66');
 assert.equal(loop(req('127.0.0.1',{'cf-connecting-ip':'198.51.100.7'})),'127.0.0.1','loopback alone is not Cloudflare');
 assert.equal(loop(req('127.0.0.1',{'x-forwarded-for':'198.51.100.7'})),'198.51.100.7');
 // The gateway sits straight behind Cloudflare.
 assert.equal(cf(req(CF_EDGE,{'x-forwarded-for':'198.51.100.7'})),'198.51.100.7');
 assert.equal(cf(req(CF_EDGE,{'cf-connecting-ip':'198.51.100.7'})),'198.51.100.7');
 assert.equal(cf(req('127.0.0.1',{'x-forwarded-for':'198.51.100.7'})),'127.0.0.1','loopback is not trusted unless listed');
 // Garbage left of trusted hops: stop at the last address we trust instead of guessing.
 assert.equal(both(req('127.0.0.1',{'x-forwarded-for':`unknown, ${CF_EDGE}`})),CF_EDGE);
 assert.equal(both(req('127.0.0.1',{'x-forwarded-for':CF_EDGE,'cf-connecting-ip':'not-an-ip'})),CF_EDGE);
 // Explicit ranges work like the keywords.
 assert.equal(createClientIp(['10.0.0.0/8'])(req('10.1.2.3',{'x-forwarded-for':'198.51.100.7'})),'198.51.100.7');
});

test('trustedProxies validation',()=>{
 assert.deepEqual(trustedProxyErrors(undefined),[]);
 assert.deepEqual(trustedProxyErrors(['loopback','cloudflare','10.0.0.0/8','::1/128','192.0.2.4']),[]);
 assert.ok(trustedProxyErrors('cloudflare').length);
 assert.ok(trustedProxyErrors(['everyone']).length);
 assert.ok(trustedProxyErrors(['10.0.0.0/33']).length);
 assert.ok(trustedProxyErrors(['0.0.0.0/0']).length,'trusting every address would let anyone pick their own');
 const example=JSON.parse(readFileSync(new URL('../deploy/central.example.json',import.meta.url)));
 assert.deepEqual(checkCentralConfig({...example,trustedProxies:['loopback','cloudflare']}),[]);
 assert.ok(checkCentralConfig({...example,trustedProxies:['nope']}).some(e=>/trustedProxies/.test(e)));
 assert.ok(validateConfig({trustedProxies:['nope']}).some(e=>/trustedProxies/.test(e)));
 assert.ok(!validateConfig({trustedProxies:['cloudflare']}).some(e=>/trustedProxies/.test(e)));
});

// Raw POST to the waitlist (rate limited per client) with chosen forwarding headers.
const notify=(c,i,headers={})=>fetch(c.base+'/launch/notify',{method:'POST',headers:{origin:'https://play.example.test','content-type':'application/json',...headers},body:JSON.stringify({email:`p${i}@example.com`})}).then(r=>r.status);

test('central: behind a trusted proxy each player has their own rate limit',async()=>{
 const c=await central({rateLimit:2,trustedProxies:['loopback']});
 try{
  const a=[],b=[];
  for(let i=0;i<3;i++)a.push(await notify(c,i,{'x-forwarded-for':'198.51.100.7'}));
  for(let i=3;i<6;i++)b.push(await notify(c,i,{'x-forwarded-for':'198.51.100.8'}));
  assert.deepEqual(a,[200,200,429]);assert.deepEqual(b,[200,200,429]);
 }finally{await c.close();}
 // Without trustedProxies the header is ignored: everyone behind the proxy shares one bucket, and spoofing gains nothing.
 const d=await central({rateLimit:2});
 try{
  const s=[];for(let i=0;i<3;i++)s.push(await notify(d,i,{'x-forwarded-for':'198.51.100.'+i}));
  assert.deepEqual(s,[200,200,429]);
 }finally{await d.close();}
});

test('gateway: desktop admission limits each forwarded client separately',async()=>{
 const s=await startStack({gateway:{desktop:{publicHost:'game.pilot.example',publicPort:28015},trustedProxies:['loopback']}});
 try{
  const admit=xff=>fetch(`http://127.0.0.1:${s.gateway.port}/desktop/admit`,{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':xff},body:'{}'}).then(r=>r.status);
  const one=[];for(let i=0;i<31;i++)one.push(await admit('198.51.100.7'));
  assert.equal(one.at(-1),429,'the 31st request in a minute from one client is refused');
  assert.ok(one.slice(0,30).every(x=>x===400),'earlier ones reach admission (malformed pass)');
  assert.equal(await admit('198.51.100.8'),400,'another client is not affected');
 }finally{await s.close();}
});
