// Publishes a release to the signed release feed that Rust Legacy Host polls (host/release-feed.mjs).
//   node tools/publish-release.mjs keygen --out <dir>
//       A new Ed25519 key pair in central/keys.mjs's format: <dir>/signing-<uuid>.pem (private, owner-only; keep it
//       offline) and <dir>/release-<uuid>.pub.pem (public: pin it in host.json releaseFeed.publicKey, or ship it in the
//       kit as host/release-feed.pub.pem).
//   node tools/publish-release.mjs sign --key <signing-uuid.pem> --tar <kit update tar> --version 1.2.0
//       [--channel stable|beta] [--notes "text" | --notes-file notes.txt] [--url <download URL, default the tar's
//       name next to the feed>] [--feed <current feed.json to add to>] [--out <feed.json>]
//       Adds the release (SHA-256, size and the parts it restarts, from the tar) to the feed and signs it. With --feed,
//       the current feed must verify with the same key; a release with the same version and channel is replaced.
// The tar comes from tools/build-kit-update.mjs. Upload the tar and the feed file together, tar first.
import {existsSync,mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {join,resolve,basename,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeSigningKey,loadSigningKey} from '../central/keys.mjs';
import {inspect} from './kit-install.mjs';
import {signFeed,verifyFeed,compareVersions,CHANNELS,keyFingerprint} from '../host/release-feed.mjs';

export function keygen(dir){
 mkdirSync(dir,{recursive:true});
 const {kid,file}=writeSigningKey(dir),pub=join(dir,`release-${kid}.pub.pem`);
 writeFileSync(pub,loadSigningKey(file).publicKey.export({type:'spki',format:'pem'}));
 return {kid,privateFile:file,publicFile:pub};
}

// The release entry for a kit update tar. Refuses a tar the host would refuse anyway (.. or absolute entries).
export function releaseFor(tar,{version,channel='stable',notes='',url,date=new Date().toISOString().slice(0,10)}){
 if(!/^\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.]{1,40})?$/.test(version??''))throw Error('--version must look like 1.2.0 or 1.3.0-beta.1');
 if(!CHANNELS.includes(channel))throw Error(`--channel must be ${CHANNELS.join(' or ')}`);
 const i=inspect(tar,{withCentral:true});
 if(i.refused.length)throw Error('The tar has entries no host will unpack: '+i.refused.slice(0,5).join(', '));
 return {version,channel,date,notes,url:url??basename(tar),sha256:i.sha256,size:statSync(tar).size,parts:i.parts};
}

export function addRelease({keyFile,tar,feedFile,now=Date.now(),...opts}){
 const {kid,privateKey,publicKey}=loadSigningKey(keyFile);
 let releases=[],publishedAt=0;
 if(feedFile&&existsSync(feedFile)){const m=verifyFeed(readFileSync(feedFile,'utf8'),publicKey);releases=m.releases;publishedAt=m.publishedAt;}
 const r=releaseFor(tar,opts);
 releases=[...releases.filter(x=>!(x.version===r.version&&x.channel===r.channel)),r].sort((a,b)=>compareVersions(b.version,a.version));
 // publishedAt only ever grows: hosts refuse a feed older than one they accepted.
 return {release:r,kid,fingerprint:keyFingerprint(publicKey),text:signFeed({format:'rlb-release-manifest-1',publishedAt:Math.max(now,publishedAt+1),releases},privateKey,kid)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [cmd]=process.argv.slice(2),flag=n=>{const i=process.argv.indexOf(n);return i<0?undefined:process.argv[i+1];};
 try{
  if(cmd==='keygen'){
   if(!flag('--out'))throw Error('--out <dir> is required');
   const k=keygen(resolve(flag('--out')));
   console.log(`Private key: ${k.privateFile}\n  Keep it offline and backed up; anyone with it can publish updates to every host that pins this key.\nPublic key:  ${k.publicFile}\n  Pin it in host.json: "releaseFeed": {"url": "https://…/release-feed.json", "publicKeyFile": "…/release-${k.kid}.pub.pem"}\n${readFileSync(k.publicFile,'utf8')}`);
  }else if(cmd==='sign'){
   const tar=flag('--tar'),keyFile=flag('--key');if(!tar||!keyFile)throw Error('--key and --tar are required');
   const feedFile=flag('--feed')&&resolve(flag('--feed')),out=resolve(flag('--out')??feedFile??join(dirname(resolve(tar)),'release-feed.json'));
   const notes=flag('--notes-file')?readFileSync(flag('--notes-file'),'utf8').trim():flag('--notes')??'';
   const r=addRelease({keyFile:resolve(keyFile),tar:resolve(tar),feedFile,version:flag('--version'),channel:flag('--channel')??'stable',notes,url:flag('--url')});
   writeFileSync(out,r.text);
   console.log(`Signed ${r.release.version} (${r.release.channel}, ${r.release.size} bytes, SHA-256 ${r.release.sha256}, restarts ${r.release.parts.join(', ')||'nothing'})\n  feed: ${out}\n  key ${r.kid} (fingerprint ${r.fingerprint})\nUpload ${basename(tar)} first, then the feed file.`);
  }else{console.error('usage: node tools/publish-release.mjs keygen --out <dir> | sign --key <signing-uuid.pem> --tar <tar> --version <x.y.z> [--channel stable|beta] [--notes text|--notes-file f] [--url u] [--feed feed.json] [--out feed.json]');process.exit(2);}
 }catch(e){console.error(e.message);process.exit(1);}
}
