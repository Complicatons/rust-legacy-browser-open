// One account per person (owner decision 22 Oct 2026; HOSTING-ACCOUNTS-BRIDGE-PLAN §3a). Everyone may play, Steam is
// never required by default, so central ties accounts to people with layered identifiers instead:
//  - sign-up by email (throwaway domains refused; addresses canonicalised so one mailbox is one account) or Steam;
//  - browser device signals (a durable device token, soft signals, IP) for admin "possible alt" links only, never bans;
//  - linked-identity bans: an active ban covers every identifier the banned account has used (email, Steam, phone,
//    device token, desktop hardware ID). Another account sharing a hard identifier is refused; sharing only a
//    device token (a family PC) is held for review. Admins clear holds; lifting the ban lifts them all.
// Identifier values are stored only as HMAC-SHA256 under the central pepper (central_meta or the operator's file).
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {BlockList,isIP} from 'node:net';
import {canonicalEmail,checkEmail} from './passwords.mjs';

export const HARD_KINDS=['email','steam','phone','hwid'];
export const LINK_KINDS=[...HARD_KINDS,'device'];
export const DEVICE_TOKEN=/^[A-Za-z0-9_-]{43}$/;
// Desktop launcher hardware ID (DESKTOP-LAUNCHER-PLAN.md "Hardware ID"): "v1:" + base64url SHA-256, 43 characters.
export const HWID=/^v1:[A-Za-z0-9_-]{43}$/;
const DAY=86400e3,NEW_ACCOUNT_MS=7*DAY;
export const SIGHTING_RETENTION_MS=365*DAY,PLAY_SESSION_RETENTION_MS=180*DAY;
export const DEFAULT_DISPOSABLE_FILE=fileURLToPath(new URL('./data/disposable-domains.txt',import.meta.url));
export const DEFAULT_HOSTING_FILE=fileURLToPath(new URL('./data/hosting-ranges.txt',import.meta.url));

// A list file the operator edits without a deploy: one entry per line, '#' starts a comment. Re-read when its
// modification time changes (checked at most every everyMs). A missing file is an empty list.
export function watchedList(file,{now=Date.now,everyMs=30e3}={}){
 let checked=-Infinity,mtime=null,lines=[];
 return ()=>{
  const t=now();if(t-checked<everyMs)return lines;checked=t;
  let m;try{m=statSync(file).mtimeMs;}catch{lines=[];mtime=null;return lines;}
  if(m!==mtime){mtime=m;try{lines=readFileSync(file,'utf8').split(/\r?\n/).map(l=>l.replace(/#.*/,'').trim()).filter(Boolean);}catch{lines=[];}}
  return lines;
 };
}
export const emailDomain=email=>{const e=String(email??'').trim().toLowerCase(),at=e.lastIndexOf('@');return at<0?'':e.slice(at+1).replace(/\.+$/,'');};
// x.y.mailinator.com is blocked by mailinator.com.
export function domainBlocked(domain,set){const parts=domain.split('.');for(let i=0;i<parts.length-1;i++)if(set.has(parts.slice(i).join('.')))return true;return false;}

// "CIDR label…" lines → ip → label of the first matching range, or null.
export function networkLabeller(lines){
 const groups=new Map();
 for(const line of lines){
  const [range,...label]=line.split(/\s+/),[addr,bits]=range.split('/'),v=isIP(addr);if(!v)continue;
  const prefix=bits===undefined?(v===4?32:128):Number(bits);if(!Number.isInteger(prefix)||prefix<1||prefix>(v===4?32:128))continue;
  const name=label.join(' ')||'hosting';if(!groups.has(name))groups.set(name,new BlockList());
  groups.get(name).addSubnet(addr,prefix,v===4?'ipv4':'ipv6');
 }
 return ip=>{const v=isIP(ip);if(!v)return null;for(const [name,list] of groups)if(list.check(ip,v===4?'ipv4':'ipv6'))return name;return null;};
}
// IPv4 as is; IPv6 by its /64 (one household or server), so privacy addresses rotating inside it still match.
export function ipKey(ip){
 const s=String(ip??'').replace(/^::ffff:(?=\d+\.)/i,''),v=isIP(s);if(v===4)return s;if(v!==6)return 'unknown';
 const [head,tail='']=s.toLowerCase().split('::'),h=head?head.split(':'):[],t=tail?tail.split(':'):[];
 const full=s.includes('::')?[...h,...Array(8-h.length-t.length).fill('0'),...t]:h;
 return full.slice(0,4).map(x=>x.replace(/^0+(?=.)/,'')).join(':')+'::/64';
}
// Soft browser signals → one stable string (bounded, no free-form identifiers beyond what the browser exposes).
export function signalString(s={}){
 const str=(v,max)=>typeof v==='string'?v.slice(0,max):'';
 const screen=s.screen&&typeof s.screen==='object'?[s.screen.w,s.screen.h,s.screen.dpr].map(n=>Number.isFinite(n)?Math.round(n*100)/100:0).join('x'):'';
 return JSON.stringify([str(s.ua,300),screen,str(s.tz,64),str(s.webgl,200),str(s.lang,35)]);
}
const overlaps=(a,b)=>{let n=0;for(const x of a)for(const y of b)if(x.started_at<y.last_seen&&y.started_at<x.last_seen)n++;return n;};

export function createIdentity({db,now=Date.now,pepper=null,disposableFile=DEFAULT_DISPOSABLE_FILE,hostingFile=DEFAULT_HOSTING_FILE,listCheckMs=30e3}){
 if(!pepper){if(!db.meta('identity-pepper'))db.setMeta('identity-pepper',randomBytes(32).toString('base64url'));pepper=db.meta('identity-pepper');}
 const hash=(kind,value)=>createHmac('sha256',pepper).update(kind+':'+value).digest('hex');
 const valueFor=(kind,raw)=>kind==='email'?canonicalEmail(raw):String(raw);
 const disposable=watchedList(disposableFile,{now,everyMs:listCheckMs}),hosting=watchedList(hostingFile,{now,everyMs:listCheckMs});
 let hostingLines=null,label=()=>null;
 const network=ip=>{const lines=hosting();if(lines!==hostingLines){hostingLines=lines;label=networkLabeller(lines);}return label(String(ip??'').replace(/^::ffff:(?=\d+\.)/i,''));};

 // Accounts from before identifiers existed: their emails and Steam/Discord sign-ins, once.
 if(!db.meta('identity-backfill-v1')){
  db.tx(()=>{const t=now();
   for(const p of db.raw.prepare('select uuid,email,created_at from players where email is not null').all())db.addIdentifier(p.uuid,'email',hash('email',canonicalEmail(p.email)),p.created_at??t);
   for(const i of db.raw.prepare("select issuer,subject,player_uuid,created_at from login_identities where issuer in ('steam','discord')").all())db.addIdentifier(i.player_uuid,i.issuer,hash(i.issuer,i.subject),i.created_at??t);
   db.setMeta('identity-backfill-v1',String(t));});
 }

 const api={
  hash,network,
  // Sign-up and email-change rule: a valid address that is not on the throwaway list (file + staff additions).
  emailProblem(email){
   const bad=checkEmail(email);if(bad)return bad;
   const set=new Set([...disposable().map(d=>d.toLowerCase()),...db.blockedDomains().map(d=>d.domain)]);
   return domainBlocked(emailDomain(email),set)?'disposable-email':null;
  },
  // Another account already uses this mailbox (dots/+tags/googlemail folded): one email per account.
  emailOwner(email,except=null){return db.playersByEmailCanon(canonicalEmail(email)).find(p=>p.uuid!==except)??null;},
  record(uuid,kind,raw){db.addIdentifier(uuid,kind,hash(kind,valueFor(kind,raw)),now());},
  // A new sign-up or link with this identifier, when a network-banned account has used it: the ban row, else null.
  signupBan(kind,raw){return db.bannedIdentifier(kind,hash(kind,valueFor(kind,raw)),now())??null;},
  // Join check (website ticket, gateway redemption, desktop pass): bans on accounts that share this account's
  // identifiers, on this server or network-wide. Each match becomes an audited hold an admin can clear.
  joinRefusal(player,server){
   const t=now(),rows=db.linkedBans(player.uuid,LINK_KINDS,server,t).sort((a,b)=>HARD_KINDS.includes(b.kind)-HARD_KINDS.includes(a.kind));
   let refused=null;
   for(const b of rows){
    const hard=HARD_KINDS.includes(b.kind),h=db.hold(player.uuid,b.id);
    if(h?.status==='cleared')continue;
    if(!h&&db.addHold({id:randomUUID(),player:player.uuid,ban:b.id,server:b.server_uuid,kind:b.kind,hard,at:t}))db.audit(t,'identity','identity-hold',b.server_uuid??'network',{player:player.uuid,ban:b.id,kind:b.kind,hard});
    if(hard)refused='identity-banned';else refused??='held-for-review';
   }
   return refused;
  },
  // Device token: the HttpOnly cookie, else the page's localStorage copy (cookies cleared), else a new one. Both
  // tokens are recorded when they differ. Returns the token for the page to keep in localStorage.
  sighting({player,cookieToken,storedToken,signals,ip}){
   const tokens=[cookieToken,storedToken].filter(v=>typeof v==='string'&&DEVICE_TOKEN.test(v)),token=tokens[0]??randomBytes(32).toString('base64url'),t=now();
   db.tx(()=>{
    for(const v of new Set([token,...tokens]))db.addIdentifier(player,'device',hash('device',v),t);
    db.addSighting({player,device:hash('device',token),signals:hash('signals',signalString(signals)),ip:hash('ip',ipKey(ip)),network:network(ip)},t);
   });
   return token;
  },
  // "Possible alt" links for the admin pages. Reasons: shared-device, shared-signals-ip, shared-<hard kind>,
  // item-transfer (between accounts under 7 days old); plus whether the two were ever online at the same time.
  alts(uuid,{server=null}={}){
   const links=new Map(),add=(other,reason)=>{if(!links.has(other))links.set(other,new Set());links.get(other).add(reason);};
   for(const r of db.sharedIdentifiers(uuid,LINK_KINDS))add(r.other,r.kind==='device'?'shared-device':'shared-'+r.kind);
   for(const r of db.sharedSignals(uuid))add(r.other,'shared-signals-ip');
   const me=db.player(uuid);
   for(const tr of db.transfersOf(uuid)){
    const other=tr.from_uuid===uuid?tr.to_uuid:tr.from_uuid,o=db.player(other);
    if(o&&other!==uuid&&(tr.at-me.created_at<NEW_ACCOUNT_MS||tr.at-o.created_at<NEW_ACCOUNT_MS))add(other,'item-transfer');
   }
   const mine=db.playSessionsFor(uuid),t=now();
   return {
    networks:[...new Set(db.sightingsFor(uuid).map(s=>s.network).filter(Boolean))],
    devices:new Set(db.sightingsFor(uuid).map(s=>s.device_hash)).size,
    alts:[...links].map(([other,reasons])=>{
     const o=db.player(other),theirs=db.playSessionsFor(other),together=overlaps(mine,theirs);
     return {player:other,name:o?.display_name??null,createdAt:o?.created_at??null,reasons:[...reasons].sort(),onlineTogether:together,
      neverOnlineTogether:mine.length>0&&theirs.length>0&&together===0,banned:Boolean(db.activeBan(other,server??'',t))};
    }).sort((a,b)=>b.reasons.length-a.reasons.length||a.player.localeCompare(b.player)),
   };
  },
  prune(){const t=now();return {sightings:db.pruneSightings(t-SIGHTING_RETENTION_MS),playSessions:db.prunePlaySessions(t-PLAY_SESSION_RETENTION_MS),names:db.pruneNames(t-PLAY_SESSION_RETENTION_MS)};},
 };
 return api;
}
