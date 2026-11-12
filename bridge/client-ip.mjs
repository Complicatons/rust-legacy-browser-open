// The real client address behind trusted reverse proxies, for per-client rate limits in central and the gateway.
// trustedProxies: entries "loopback" (127.0.0.0/8, ::1: Caddy on the same host), "cloudflare" (the ranges below) or a
// CIDR/address. Without any, the socket address is the client and forwarding headers are ignored.
//
// X-Forwarded-For is walked from the right: the socket peer first, then each forwarded hop, skipping only trusted
// addresses; the first untrusted one is the client. Entries a client writes itself land left of the real one and are
// never reached. CF-Connecting-IP is used only when the forwarded hops run out at a Cloudflare address (a proxy that
// replaced X-Forwarded-For with the edge address alone).
import {BlockList,isIP} from 'node:net';

// cloudflare.com/ips-v4 and /ips-v6, fetched 22 Oct 2026. Cloudflare changes these rarely; refresh with the Caddy and
// firewall lists in the hosting runbook.
export const CLOUDFLARE_RANGES=[
 '173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18',
 '190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13',
 '104.24.0.0/14','172.64.0.0/13','131.0.72.0/22',
 '2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32',
];
export const LOOPBACK_RANGES=['127.0.0.0/8','::1/128'];
const MAX_HOPS=32;

// '::ffff:1.2.3.4', '[2001:db8::1]', '1.2.3.4:5678' → {ip, type} or null.
function parse(s){
 let a=String(s??'').trim();
 const bracket=/^\[([^\]]+)\](?::\d+)?$/.exec(a);if(bracket)a=bracket[1];
 else if(/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(a))a=a.slice(0,a.lastIndexOf(':'));
 if(/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(a))a=a.slice(7);
 const v=isIP(a);return v?{ip:a,type:v===4?'ipv4':'ipv6'}:null;
}
function parseRange(entry){
 const [addr,bits,extra]=String(entry).split('/');if(extra!==undefined)return null;
 const p=parse(addr);if(!p)return null;
 const max=p.type==='ipv4'?32:128,prefix=bits===undefined?max:/^\d{1,3}$/.test(bits)?Number(bits):NaN;
 return prefix>=1&&prefix<=max?{...p,prefix}:null; // /0 would trust every address
}
const expand=e=>e==='cloudflare'?CLOUDFLARE_RANGES:e==='loopback'?LOOPBACK_RANGES:[e];
function blockList(ranges){
 const b=new BlockList();
 for(const r of ranges){const p=parseRange(r);b.addSubnet(p.ip,p.prefix,p.type);}
 return b;
}

export function trustedProxyErrors(list){
 if(list===undefined)return [];
 if(!Array.isArray(list))return ['trustedProxies must be a list of "loopback", "cloudflare" or CIDR ranges'];
 return list.filter(e=>typeof e!=='string'||(e!=='loopback'&&e!=='cloudflare'&&!parseRange(e)))
  .map(e=>`trustedProxies: ${JSON.stringify(e)} is not "loopback", "cloudflare" or a CIDR range (prefix 1 or more)`);
}

export function createClientIp(trustedProxies=[]){
 const trusted=blockList(trustedProxies.flatMap(expand));
 const cloudflare=trustedProxies.includes('cloudflare')?blockList(CLOUDFLARE_RANGES):null;
 const peerOnly=req=>parse(req.socket?.remoteAddress)?.ip??String(req.socket?.remoteAddress??'');
 if(!trustedProxies.length)return peerOnly;
 return req=>{
  let hop=parse(req.socket?.remoteAddress);if(!hop)return peerOnly(req);
  const forwarded=String(req.headers['x-forwarded-for']??'').split(',').map(s=>s.trim()).filter(Boolean).slice(-MAX_HOPS);
  while(trusted.check(hop.ip,hop.type)){
   if(!forwarded.length){
    const cf=cloudflare?.check(hop.ip,hop.type)?parse(req.headers['cf-connecting-ip']):null;
    return (cf??hop).ip;
   }
   const next=parse(forwarded.pop());if(!next)return hop.ip; // unreadable entry: stop at the last trusted hop
   hop=next;
  }
  return hop.ip;
 };
}
