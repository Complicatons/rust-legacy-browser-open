// Installs a kit update tar (tools/build-kit-update.mjs, deploy/azure-test/pc/Publish-Kit.ps1) into an app folder with
// the rules of deploy/azure-test/scripts/03-Install-KitUpdate.ps1, so the host app's Updates page and the script treat
// an update the same way (tests/kit-install.test.mjs pins the refusal rule to the script's):
//  - files only; refuse an entry with a .. segment or an absolute path,
//  - refuse the website's own files (tools/central.mjs, central/, site/) unless withCentral,
//  - copy every file the update replaces to a backup folder first, then unpack with Windows' tar.exe (bsdtar).
// The host app adds a roll back (the backup also records the files the update added, to remove them again).
//   node tools/kit-install.mjs inspect <tar> [--with-central]
//   node tools/kit-install.mjs apply <tar> --app <dir> --backup <dir> [--with-central]
//   node tools/kit-install.mjs rollback <backup dir> --app <dir>
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,unlinkSync,statSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const UNSAFE=/(^|[\\/])\.\.([\\/]|$)|^([A-Za-z]:|[\\/])/;
export const CENTRAL_ONLY=e=>e==='tools/central.mjs'||/^(central|site)\//.test(e);
// Which running parts an entry belongs to, so only those restart.
export function partsFor(entries){
 const parts=new Set();
 for(const e of entries){
  if(CENTRAL_ONLY(e)||e==='tools/serve.mjs'||e.startsWith('browser/'))parts.add('central'); // central serves the game page
  if(e.startsWith('bridge/')||e==='tools/gateway.mjs')parts.add('gateway');
  if(e.startsWith('bridge/')||e==='tools/adapter-sidecar.mjs')parts.add('sidecar');
  if(e.startsWith('host/'))parts.add('host');
  if(e.startsWith('adapter/')||e.startsWith('build/vm-test/adapter'))parts.add('server-adapter');
 }
 return [...parts].sort();
}
// Windows' own bsdtar, as 03 uses; under Git Bash a plain tar.exe on PATH is GNU tar, which reads C:\… as a remote host.
const SYSTEM_TAR=join(process.env.SystemRoot??'C:/Windows','System32','tar.exe');
export const TAR=process.platform==='win32'&&existsSync(SYSTEM_TAR)?SYSTEM_TAR:'tar';
const tar=(args,opts={})=>{const r=spawnSync(TAR,args,{encoding:'utf8',windowsHide:true,maxBuffer:64<<20,...opts});if(r.error)throw r.error;if(r.status!==0)throw Error(`tar ${args[0]} failed: ${(r.stderr||'').trim().split('\n')[0]}`);return r.stdout;};

export function sha256(path){const h=createHash('sha256');h.update(readFileSync(path));return h.digest('hex');}
const sameBytes=(a,b)=>statSync(a).size===statSync(b).size&&readFileSync(a).equals(readFileSync(b));

export function inspect(tarPath,{withCentral=false}={}){
 const entries=tar(['-tf',tarPath]).split(/\r?\n/).filter(e=>e&&!e.endsWith('/'));
 const refused=[...entries.filter(e=>UNSAFE.test(e)),...(withCentral?[]:entries.filter(CENTRAL_ONLY))];
 return {entries,refused:[...new Set(refused)],parts:partsFor(entries),bytes:statSync(tarPath).size,sha256:sha256(tarPath)};
}

export function apply(tarPath,{app,backup,withCentral=false}){
 const info=inspect(tarPath,{withCentral});
 if(info.refused.length)throw Object.assign(Error('Refusing the update; it contains: '+info.refused.slice(0,10).join(', ')),{status:409,refused:info.refused});
 mkdirSync(backup,{recursive:true});
 const replaced=[],added=[];
 for(const e of info.entries){
  const src=join(app,e);
  if(existsSync(src)&&statSync(src).isFile()){const dst=join(backup,'files',e);mkdirSync(dirname(dst),{recursive:true});copyFileSync(src,dst);replaced.push(e);}
  else added.push(e);
 }
 writeFileSync(join(backup,'install.json'),JSON.stringify({at:Date.now(),tar:tarPath,sha256:info.sha256,entries:info.entries.length,replaced,added,parts:info.parts},null,1));
 tar(['-xf',tarPath,'-C',app]);
 // A full kit (Publish-Kit -Full) carries every file: only the files whose bytes changed decide what has to restart.
 const changed=[...added,...replaced.filter(e=>!sameBytes(join(backup,'files',e),join(app,e)))],changedParts=partsFor(changed);
 const rec=JSON.parse(readFileSync(join(backup,'install.json'),'utf8'));
 writeFileSync(join(backup,'install.json'),JSON.stringify({...rec,changed:changed.length,changedParts},null,1));
 return {...info,replaced,added,changed,changedParts,backup};
}

// Puts the replaced files back and removes the files the update added.
export function rollback(backup,{app}){
 const rec=JSON.parse(readFileSync(join(backup,'install.json'),'utf8'));
 for(const e of rec.replaced){if(UNSAFE.test(e))continue;const dst=join(app,e);mkdirSync(dirname(dst),{recursive:true});copyFileSync(join(backup,'files',e),dst);}
 for(const e of rec.added){if(UNSAFE.test(e))continue;try{unlinkSync(join(app,e));}catch{}}
 writeFileSync(join(backup,'rolled-back.json'),JSON.stringify({at:Date.now()}));
 return {restored:rec.replaced.length,removed:rec.added.length,parts:rec.parts};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [cmd,target]=process.argv.slice(2),flag=n=>{const i=process.argv.indexOf(n);return i<0?null:process.argv[i+1];},withCentral=process.argv.includes('--with-central');
 try{
  if(cmd==='inspect'){const r=inspect(target,{withCentral});console.log(JSON.stringify({...r,entries:r.entries.length},null,1));process.exit(r.refused.length?1:0);}
  else if(cmd==='apply'){const r=apply(target,{app:resolve(flag('--app')),backup:resolve(flag('--backup')),withCentral});console.log(`Unpacked ${r.entries.length} files (${r.replaced.length} replaced, ${r.changed.length} changed, backed up in ${r.backup}); restart: ${r.changedParts.join(', ')||'nothing'}`);}
  else if(cmd==='rollback'){const r=rollback(resolve(target),{app:resolve(flag('--app'))});console.log(`Rolled back: ${r.restored} restored, ${r.removed} removed; restart: ${r.parts.join(', ')||'nothing'}`);}
  else{console.error('usage: node tools/kit-install.mjs inspect <tar> | apply <tar> --app <dir> --backup <dir> | rollback <backup> --app <dir> [--with-central]');process.exit(2);}
 }catch(e){console.error(e.message);process.exit(1);}
}
