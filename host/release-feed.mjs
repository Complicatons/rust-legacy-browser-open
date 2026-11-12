// Signed release feed (HOST-APP-PLAN.md "Install and updates", HOST-AND-LOADER-BUILD.md H11). The project publishes
// one JSON file, made by tools/publish-release.mjs:
//   {format: 'rlb-release-feed-1', kid, manifest: base64(JSON), signature: base64(Ed25519 over the manifest bytes)}
//   manifest: {format: 'rlb-release-manifest-1', publishedAt, releases: [{version, channel, date, notes, url, sha256,
//              size, parts}]}
// The host polls the URL the owner set (host.json releaseFeed.url; off until then), checks the signature against the
// public key pinned in host.json or the kit (host/release-feed.pub.pem), refuses a feed older than one it already
// accepted (a replayed old feed cannot hide a fix), downloads the newest release for its channel into
// updates/staged (streamed, size-capped, SHA-256 checked against the signed manifest) and hands it to the normal
// Updates flow (host/updates.mjs): inspected, then installed by the owner. It installs by itself only when the owner
// turned on "install automatically when the server is empty", and never an update that touches the website's own
// files (those always need the owner's tick).
// The feed URL and the key are host.json only: a dashboard session cannot point the host at another feed or key.
import {createPublicKey,createPrivateKey,sign,verify,createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,createWriteStream,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {LOOPBACK} from './s3.mjs';
import {MAX_UPDATE_BYTES} from './updates.mjs';

export const KIT_KEY=fileURLToPath(new URL('./release-feed.pub.pem',import.meta.url));
export const CHANNELS=['stable','beta']; // a beta host also sees stable releases
export const FEED_DEFAULTS={everyHours:6,channel:'stable',autoInstall:false};
const PARTS=['central','gateway','sidecar','host','server-adapter'],VERSION=/^\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.]{1,40})?$/,MAX_FEED=1<<20;
const err=(message,status=400)=>Object.assign(Error(message),{status});
const readJson=(f,d)=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return d;}};
const okUrl=u=>u.protocol==='https:'||(u.protocol==='http:'&&LOOPBACK(u.hostname));

// 1.2.10 > 1.2.9; a pre-release (1.3.0-beta.1) sorts before its release.
export function compareVersions(a,b){
 const [x,xp='']=String(a).split('-',2),[y,yp='']=String(b).split('-',2),xs=x.split('.').map(Number),ys=y.split('.').map(Number);
 for(let i=0;i<3;i++)if((xs[i]||0)!==(ys[i]||0))return (xs[i]||0)-(ys[i]||0);
 if(xp===yp)return 0;if(!xp)return 1;if(!yp)return -1;return xp<yp?-1:1;
}

// Public key: an SPKI PEM, or base64 of the DER. Private key: central/keys.mjs's PKCS#8 PEM.
export function publicKeyFrom(text){
 const s=String(text).trim();
 const k=s.startsWith('-----')?createPublicKey(s):createPublicKey({key:Buffer.from(s,'base64'),format:'der',type:'spki'});
 if(k.asymmetricKeyType!=='ed25519')throw Error('The release key must be Ed25519');
 return k;
}
export const keyFingerprint=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex').slice(0,16);

export function signFeed(manifest,privateKey,kid=null){
 const k=typeof privateKey==='string'?createPrivateKey(privateKey):privateKey,bytes=Buffer.from(JSON.stringify(manifest,null,1));
 return JSON.stringify({format:'rlb-release-feed-1',kid,manifest:bytes.toString('base64'),signature:sign(null,bytes,k).toString('base64')},null,1)+'\n';
}

// Checks the signature first, then the shape. Returns the manifest.
export function verifyFeed(text,publicKey){
 let env;try{env=JSON.parse(text);}catch{throw err('The release feed is not JSON',502);}
 if(env?.format!=='rlb-release-feed-1'||typeof env.manifest!=='string'||typeof env.signature!=='string')throw err('That is not a release feed',502);
 const bytes=Buffer.from(env.manifest,'base64'),sig=Buffer.from(env.signature,'base64');
 if(sig.length!==64||!verify(null,bytes,publicKey,sig))throw err('The release feed\'s signature does not match the pinned key; nothing was downloaded',502);
 const m=JSON.parse(bytes.toString('utf8'));
 if(m?.format!=='rlb-release-manifest-1'||!Number.isSafeInteger(m.publishedAt)||!Array.isArray(m.releases))throw err('The signed manifest has the wrong shape',502);
 for(const r of m.releases){
  const bad=!VERSION.test(r?.version??'')?'version':!/^[a-z]{1,20}$/.test(r.channel??'')?'channel':typeof r.url!=='string'||r.url.length>2000?'url':!/^[0-9a-f]{64}$/.test(r.sha256??'')?'sha256':
   !(Number.isSafeInteger(r.size)&&r.size>0&&r.size<=MAX_UPDATE_BYTES)?'size':typeof (r.notes??'')!=='string'||(r.notes??'').length>8000?'notes':!Array.isArray(r.parts??[])||(r.parts??[]).some(p=>!PARTS.includes(p))?'parts':null;
  if(bad)throw err(`Release ${String(r?.version).slice(0,20)} in the signed manifest has a bad ${bad}`,502);
 }
 return m;
}

export function feedConfigErrors(c){
 if(c===undefined)return [];
 const e=[];
 if(typeof c!=='object'||!c)return ['releaseFeed must be an object'];
 if(c.url!==undefined){let u=null;try{u=new URL(c.url);}catch{}if(!u||!okUrl(u))e.push('releaseFeed.url must be an https URL (plain http only for a loopback test server)');}
 if(c.publicKey!==undefined){try{publicKeyFrom(c.publicKey);}catch(x){e.push('releaseFeed.publicKey: '+x.message);}}
 if(c.publicKeyFile!==undefined&&!existsSync(c.publicKeyFile))e.push('releaseFeed.publicKeyFile not found: '+c.publicKeyFile);
 if(c.everyHours!==undefined&&!(Number.isInteger(c.everyHours)&&c.everyHours>=1&&c.everyHours<=168))e.push('releaseFeed.everyHours must be 1..168');
 if(c.channel!==undefined&&!CHANNELS.includes(c.channel))e.push(`releaseFeed.channel must be ${CHANNELS.join(' or ')}`);
 if(c.downloadOrigins!==undefined&&!(Array.isArray(c.downloadOrigins)&&c.downloadOrigins.every(o=>{try{const u=new URL(o);return okUrl(u)&&u.origin===o;}catch{return false;}})))e.push('releaseFeed.downloadOrigins must be a list of origins such as https://downloads.example.org');
 return e;
}

// opts: {dataDir, config (host.json releaseFeed), updates (host/updates.mjs), install(name) (the host's install,
//        so parts restart the usual way), players() → {inGame}|null, appVersion, now, log, fetch}
export function createReleaseFeed({dataDir,config={},updates,install=name=>updates.install(name),players=()=>null,appVersion='0.0.0',now=()=>Date.now(),log=()=>{},fetch:fetchImpl=fetch}){
 const files={settings:join(dataDir,'release-feed.json'),state:join(dataDir,'updates','feed-state.json')};
 mkdirSync(join(dataDir,'updates'),{recursive:true});
 const keyText=config.publicKey??(config.publicKeyFile?readFileSync(config.publicKeyFile,'utf8'):existsSync(KIT_KEY)?readFileSync(KIT_KEY,'utf8'):null);
 const key=keyText?publicKeyFrom(keyText):null;
 const configured=Boolean(config.url&&key);
 const settings=()=>({...FEED_DEFAULTS,...config,...readJson(files.settings,{})});
 let state=readJson(files.state,{lastCheckAt:0,lastOkAt:0,lastError:null,publishedAt:0,releases:[],downloaded:{}});
 const save=()=>writeFileSync(files.state,JSON.stringify(state));
 let busy=null,timer=null,consentNoted=null;
 const visible=r=>{const mine=CHANNELS.indexOf(settings().channel),theirs=CHANNELS.indexOf(r.channel);return theirs>=0&&theirs<=mine;};
 // The installed version: the newest feed release installed through the host and not rolled back, else the app's own.
 const installed=()=>{
  let v=appVersion;
  for(const h of updates.list().history)if(h.release?.version&&!h.rolledBack&&compareVersions(h.release.version,v)>0)v=h.release.version;
  return v;
 };
 const stagedFor=version=>updates.list().staged.find(s=>s.release?.version===version&&!s.error)??null;
 const newest=()=>state.releases.filter(r=>visible(r)&&compareVersions(r.version,installed())>0).sort((a,b)=>compareVersions(b.version,a.version))[0]??null;
 const lock=async(op,fn)=>{if(busy)throw err(`A ${busy} is already running`,409);busy=op;try{return await fn();}finally{busy=null;}};

 async function download(version){
  const r=state.releases.find(x=>x.version===version&&visible(x));
  if(!r)throw err('That release is not in the feed for this channel',404);
  const have=stagedFor(version);if(have)return have;
  // Relative URLs are relative to the feed; any other origin must be one the owner listed in host.json.
  const u=new URL(r.url,config.url);
  if(u.origin!==new URL(config.url).origin&&!(config.downloadOrigins??[]).includes(u.origin))throw err(`The release is on ${u.origin}, which is not the feed's own site; add it to releaseFeed.downloadOrigins in host.json to allow it`,502);
  if(!okUrl(u))throw err('The release URL must be https',502);
  const name=`rlb-${r.version.replace(/[^0-9A-Za-z.-]/g,'-')}.tar`,tmp=join(dataDir,'updates','staged',name+'.download');
  const res=await fetchImpl(u,{signal:AbortSignal.timeout(60*60e3)});
  if(!res.ok)throw err(`Download of ${r.version} failed: HTTP ${res.status}`,502);
  if(!okUrl(new URL(res.url||u)))throw err('The download was redirected to a plain http address',502);
  const h=createHash('sha256');let n=0;
  const check=async function*(src){for await(const c of src){n+=c.length;if(n>r.size)throw err(`The download of ${r.version} is larger than the signed manifest says; deleted`,502);h.update(c);yield c;}};
  try{
   await pipeline(Readable.fromWeb(res.body),check,createWriteStream(tmp));
   if(n!==r.size||h.digest('hex')!==r.sha256)throw err(`The download of ${r.version} does not match the signed manifest (size or SHA-256); deleted`,502);
   const m=updates.adopt(name,tmp,{release:{version:r.version,channel:r.channel,date:r.date??null,notes:r.notes??'',sha256:r.sha256}});
   state.downloaded[r.version]=name;save();
   log(`release feed: downloaded ${r.version} (${r.channel}); it waits on the Updates page`);
   return m;
  }catch(e){try{unlinkSync(tmp);}catch{}log(`release feed: ${e.message}`,'error');throw e;}
 }

 async function check(){
  if(!configured)throw err('No release feed is set up (releaseFeed.url and the public key in host.json)',409);
  state.lastCheckAt=now();
  try{
   const u=new URL(config.url);
   const res=await fetchImpl(u,{signal:AbortSignal.timeout(60e3),redirect:'error'});
   if(!res.ok)throw err(`The release feed answered HTTP ${res.status}`,502);
   const text=await res.text();if(text.length>MAX_FEED)throw err('The release feed is too large',502);
   const m=verifyFeed(text,key);
   if(m.publishedAt<state.publishedAt)throw err('The release feed is older than one this host already accepted; refused (a replayed old feed)',502);
   Object.assign(state,{lastOkAt:now(),lastError:null,publishedAt:m.publishedAt,releases:m.releases});save();
   const n=newest();
   if(n&&!stagedFor(n.version))await download(n.version);
   return o.status();
  }catch(e){state.lastError=e.message;save();log(`release feed: ${e.message}`,'error');throw e;}
 }

 // Installs the newest downloaded release when the owner allowed it and nobody is playing.
 async function autoInstall(){
  if(!settings().autoInstall||busy)return null;
  const n=newest(),s=n&&stagedFor(n.version);if(!s)return null;
  if(s.refused?.length)return null;
  if(s.centralFiles?.length){if(consentNoted!==n.version){consentNoted=n.version;log(`release feed: ${n.version} changes the website's own files, so it waits for you on the Updates page`,'warn');}return null;}
  if(players()?.inGame!==0)return null; // unknown counts as not empty
  return lock('install',async()=>{log(`release feed: the server is empty; installing ${n.version} automatically`,'warn');const r=await install(s.name);try{updates.remove(s.name);}catch{}return r;});
 }

 const o={
  status(){
   const s=settings(),inst=configured?installed():appVersion;
   return {configured,url:config.url??null,key:key?keyFingerprint(key):null,channel:s.channel,autoInstall:s.autoInstall,everyHours:s.everyHours,busy,
    lastCheckAt:state.lastCheckAt||null,lastOkAt:state.lastOkAt||null,lastError:state.lastError,publishedAt:state.publishedAt||null,installed:inst,
    nextAt:configured?(state.lastCheckAt||0)+s.everyHours*3600e3:null,
    releases:state.releases.filter(visible).sort((a,b)=>compareVersions(b.version,a.version)).slice(0,20).map(r=>({...r,newer:compareVersions(r.version,inst)>0,staged:Boolean(stagedFor(r.version))}))};
  },
  check:()=>lock('check',check),
  download:v=>lock('download',()=>download(String(v??''))),
  autoInstall,
  saveSettings(b={}){
   const cur=readJson(files.settings,{});
   if(b.channel!==undefined){if(!CHANNELS.includes(b.channel))throw err('unknown channel');cur.channel=b.channel;}
   if(b.autoInstall!==undefined){if(typeof b.autoInstall!=='boolean')throw err('autoInstall must be true or false');cur.autoInstall=b.autoInstall;}
   if(b.everyHours!==undefined){if(!(Number.isInteger(b.everyHours)&&b.everyHours>=1&&b.everyHours<=168))throw err('check every 1 to 168 hours');cur.everyHours=b.everyHours;}
   writeFileSync(files.settings,JSON.stringify(cur,null,1));
   log(`Owner: release feed settings saved (${settings().channel}, install automatically ${settings().autoInstall?'on':'off'})`);
   return o.status();
  },
  async tick(){
   if(!configured)return;
   if(!busy&&now()-(state.lastCheckAt||0)>=settings().everyHours*3600e3)await o.check().catch(()=>{});
   await autoInstall().catch(e=>log('release feed: automatic install failed: '+e.message,'error'));
  },
  start(everyMs=60e3){clearInterval(timer);if(!configured)return;timer=setInterval(()=>{o.tick();},everyMs);timer.unref?.();},
  stop(){clearInterval(timer);},
 };
 return o;
}
