// The installer manifest the website serves at /downloads/host/latest.json (HOST-APP-PLAN.md "Owner installer"): signed
// like the update feed (host/release-feed.mjs), with the same project release key and envelope, so the download page and
// a host can tell it came from the project.
//   envelope: {format: 'rlb-release-feed-1', kid, manifest: base64(JSON), signature: base64(Ed25519 over those bytes)}
//   manifest: {format: 'rlb-installer-1', product: 'rust-legacy-host'|'rust-legacy-loader', version, file, bytes, sha256, signed, signer?, publishedAt}
// The game loader's manifest is served the same way at /downloads/loader/latest.json.
// The key is made with `node tools/publish-release.mjs keygen`; its public half ships as host/release-feed.pub.pem.
//   node host/release.mjs verify <latest.json>
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {publicKeyFrom,signFeed,KIT_KEY} from './release-feed.mjs';
import {createPublicKey,verify} from 'node:crypto';

export const PRODUCT='rust-legacy-host',LOADER_PRODUCT='rust-legacy-loader';
// Each product's download name; the game loader ships as a zip of build/launcher/app (tools/build-launcher.mjs --release).
export const RELEASE_FILES={[PRODUCT]:v=>`RustLegacyHostSetup-${v}.exe`,[LOADER_PRODUCT]:v=>`RustLegacyLoader-${v}.zip`};
const VERSION=/^\d{1,5}\.\d{1,5}\.\d{1,5}$/,SHA=/^[0-9A-F]{64}$/;

export function checkInstallerManifest(m){
 const e=[],name=RELEASE_FILES[m?.product];
 if(m?.format!=='rlb-installer-1')e.push('format must be rlb-installer-1');
 if(!name)e.push(`product must be ${PRODUCT} or ${LOADER_PRODUCT}`);
 if(!VERSION.test(m?.version??''))e.push('version must be x.y.z');
 if(name&&m?.file!==name(m?.version))e.push('file must be '+name('<version>'));
 if(!Number.isSafeInteger(m?.bytes)||m.bytes<1)e.push('bytes must be the file size');
 if(!SHA.test(m?.sha256??''))e.push('sha256 must be upper-case hex');
 if(typeof m?.signed!=='boolean')e.push('signed must say whether the installer is code-signed');
 if(!Number.isSafeInteger(m?.publishedAt))e.push('publishedAt must be a time');
 return e;
}

// keyFile: the project release key, signing-<uuid>.pem (central/keys.mjs format). Returns the envelope's text.
export function signInstaller(manifest,keyFile){
 const problems=checkInstallerManifest(manifest);if(problems.length)throw Error('Bad installer manifest: '+problems.join('; '));
 const kid=/^signing-([0-9a-f-]{36})\.pem$/.exec(basename(keyFile))?.[1]??null;
 return signFeed(manifest,readFileSync(keyFile,'utf8'),kid);
}

// Returns the manifest when the envelope is signed by the release key and well formed; throws otherwise.
export function verifyInstaller(text,publicKey=publicKeyFrom(readFileSync(KIT_KEY,'utf8')),product=null){
 const env=typeof text==='string'?JSON.parse(text):text;
 if(env?.format!=='rlb-release-feed-1'||typeof env.manifest!=='string'||typeof env.signature!=='string')throw Error('not a signed release envelope');
 const bytes=Buffer.from(env.manifest,'base64'),sig=Buffer.from(env.signature,'base64');
 const key=publicKey?.asymmetricKeyType?publicKey:createPublicKey(publicKey);
 if(sig.length!==64||!verify(null,bytes,key,sig))throw Error('bad signature');
 const m=JSON.parse(bytes.toString('utf8')),problems=checkInstallerManifest(m);
 if(problems.length)throw Error('bad installer manifest: '+problems.join('; '));
 if(product&&m.product!==product)throw Error(`the manifest is for ${m.product}, not ${product}`);
 return m;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [cmd,file]=process.argv.slice(2);
 try{
  if(cmd==='verify'&&file)console.log(JSON.stringify(verifyInstaller(readFileSync(file,'utf8'))));
  else{console.error('usage: node host/release.mjs verify <latest.json>');process.exit(2);}
 }catch(e){console.error(e.message);process.exit(1);}
}
