// Updates page (HOST-APP-PLAN.md "Install and updates"): kit update tars (tools/build-kit-update.mjs / Publish-Kit.ps1)
// installed into the app folder with tools/kit-install.mjs, the rules of 03-Install-KitUpdate.ps1. Updates are added
// to <dataDir>/updates, inspected (SHA-256, files, refusals, affected parts) before anything changes, installed with a
// backup of every replaced file, and can be rolled back. Only the running parts an update touches are restarted; the
// original server is never restarted by an update (its patched files need 10-Patch-TestCopy, which the owner runs).
import {mkdirSync,readdirSync,existsSync,readFileSync,writeFileSync,statSync,unlinkSync,createWriteStream,renameSync} from 'node:fs';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {inspect,apply,rollback} from '../tools/kit-install.mjs';

const NAME=/^[A-Za-z0-9._-]{1,120}\.tar$/,BACKUP=/^install-[0-9T-]+$/;
export const MAX_UPDATE_BYTES=2*1024**3;
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-').slice(0,23); // to the millisecond
const err=(message,status)=>Object.assign(Error(message),{status});

export function createUpdates({dataDir,app,restartParts=async()=>[],log=()=>{}}){
 const dir=join(dataDir,'updates'),staged=join(dir,'staged'),installs=join(dir,'installs');
 for(const d of [staged,installs])mkdirSync(d,{recursive:true});
 const info=name=>{
  const f=join(staged,name),meta=f+'.json';
  if(existsSync(meta)){const m=JSON.parse(readFileSync(meta,'utf8'));if(m.size===statSync(f).size)return m;}
  const i=inspect(f),central=inspect(f,{withCentral:true});
  const m={name,size:i.bytes,sha256:i.sha256,files:i.entries.length,parts:i.parts,refused:central.refused,centralFiles:i.refused.filter(e=>!central.refused.includes(e)),addedAt:statSync(f).mtimeMs};
  writeFileSync(meta,JSON.stringify(m));return m;
 };
 const u={
  list(){
   const files=readdirSync(staged).filter(f=>NAME.test(f));
   const history=readdirSync(installs).filter(d=>BACKUP.test(d)&&existsSync(join(installs,d,'install.json'))).sort().reverse().map(d=>{
    const r=JSON.parse(readFileSync(join(installs,d,'install.json'),'utf8'));
    return {backup:d,at:r.at,sha256:r.sha256,files:r.entries,replaced:r.replaced.length,added:r.added.length,parts:r.parts,name:r.name??null,release:r.release??null,rolledBack:existsSync(join(installs,d,'rolled-back.json'))};
   });
   return {app,staged:files.map(f=>{try{return info(f);}catch(e){return {name:f,error:e.message};}}),history};
  },
  // Streams an uploaded tar to disk (no buffering of the whole file), then inspects it.
  async add(name,stream){
   if(!NAME.test(name??''))throw err('The update must be a .tar file with a plain name (letters, digits, dot, dash, underscore)',400);
   const f=join(staged,name),part=f+'.part';let bytes=0;
   const counter=async function*(src){for await(const c of src){bytes+=c.length;if(bytes>MAX_UPDATE_BYTES)throw err('The update is larger than 2 GB',413);yield c;}};
   try{await pipeline(stream,counter,createWriteStream(part));}catch(e){try{unlinkSync(part);}catch{}throw e.status?e:err('Upload failed: '+e.message,400);}
   renameSync(part,f);try{unlinkSync(f+'.json');}catch{}
   try{const m=info(name);log(`update added: ${name} (${m.files} files, SHA-256 ${m.sha256.slice(0,16)}…)`);return m;}
   catch(e){unlinkSync(f);throw err('That file is not a tar archive tar.exe can read: '+e.message,400);}
  },
  // A tar the release feed (host/release-feed.mjs) downloaded and checked against its signed manifest: moved into
  // staged and inspected like an upload; extra (the release's version and notes) is kept with it.
  adopt(name,file,extra={}){
   if(!NAME.test(name??''))throw err('bad update name',400);
   const f=join(staged,name);renameSync(file,f);try{unlinkSync(f+'.json');}catch{}
   let m;try{m=info(name);}catch(e){unlinkSync(f);throw err('That file is not a tar archive tar.exe can read: '+e.message,400);}
   m={...m,...extra};writeFileSync(f+'.json',JSON.stringify(m));
   log(`update added from the release feed: ${name} (${m.files} files, SHA-256 ${m.sha256.slice(0,16)}…)`);return m;
  },
  remove(name){if(!NAME.test(name??'')||!existsSync(join(staged,name)))throw err('unknown update',404);unlinkSync(join(staged,name));try{unlinkSync(join(staged,name+'.json'));}catch{}},
  async install(name,{withCentral=false}={}){
   if(!NAME.test(name??'')||!existsSync(join(staged,name)))throw err('unknown update',404);
   // One folder per install, even for two installs in the same millisecond (the record must never be overwritten).
   assertWritable(app);
   let backup=join(installs,'install-'+stamp());for(let i=2;existsSync(backup);i++)backup=join(installs,`install-${stamp()}-${i}`);
   const r=apply(join(staged,name),{app,backup,withCentral});
   const rec=JSON.parse(readFileSync(join(backup,'install.json'),'utf8'));rec.name=name;rec.release=info(name).release??null;writeFileSync(join(backup,'install.json'),JSON.stringify(rec,null,1));
   log(`update installed: ${name} (${r.entries.length} files, ${r.replaced.length} replaced); backup ${backup}`,'warn');
   const restarted=await restartParts(r.changedParts);
   return {name,files:r.entries.length,replaced:r.replaced.length,added:r.added.length,changed:r.changed.length,parts:r.changedParts,restarted,backup:backup.split(/[\\/]/).pop(),
    notes:notesFor(r.changedParts)};
  },
  async rollback(backupName){
   if(!BACKUP.test(backupName??'')||!existsSync(join(installs,backupName,'install.json')))throw err('unknown install',404);
   if(existsSync(join(installs,backupName,'rolled-back.json')))throw err('That install was already rolled back',409);
   assertWritable(app);
   const r=rollback(join(installs,backupName),{app});
   log(`update rolled back: ${backupName} (${r.restored} restored, ${r.removed} removed)`,'warn');
   const restarted=await restartParts(r.parts);
   return {...r,restarted,notes:notesFor(r.parts)};
  },
 };
 return u;
}
// The installed service only reads its program folder (Install-RustLegacyHost.ps1 grants no write): the website and
// gateway it runs face the internet, and a bug in them must not be able to rewrite their own code. Find that out before
// anything is unpacked, and say how to install instead.
export const READ_ONLY_APP=app=>`This host cannot write its program folder (${app}): the service only reads it, on purpose, so the internet-facing website and gateway cannot change their own code. Install the update from an administrator PowerShell instead: node tools\\kit-install.mjs apply <update.tar> --app "${app}" --backup <folder>, then restart the parts here (on the Azure test VM: deploy\\azure-test\\scripts\\04-Install-KitViaHost.ps1).`;
function assertWritable(app){
 const probe=join(app,`.rlb-write-test-${process.pid}-${Date.now()}`);
 try{writeFileSync(probe,'');unlinkSync(probe);}
 catch(e){if(e.code==='EPERM'||e.code==='EACCES')throw err(READ_ONLY_APP(app),403);throw e;}
}
// What the owner still has to do after an update, in their words.
function notesFor(parts){
 const n=[];
 if(parts.includes('host'))n.push('The host app\'s own files changed: restart the host app to load them.');
 if(parts.includes('server-adapter'))n.push('The server adapter changed: stop the server and run 10-Patch-TestCopy.ps1 -Apply before the next start.');
 return n;
}
