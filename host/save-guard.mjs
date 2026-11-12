// Keeps the last good world save (HOST-APP-PLAN.md "Watchdog"). The original ServerSaveManager.Save logs
// "Saving to '<path>'", writes <path>.new, rotates <path>.old.0..5, renames <path>.new to <path>, then logs
// " Saved N Object(s). Took T seconds." per the decompiled code; the real server on the Azure VM (2026-10-24) logs only
// "Saving to" (and "saved all." when run as the save.all command). So a save also counts as complete once the .new is
// gone and <path> was rewritten after the "Saving to" line (check(), on every log line and on the host's timer).
// A completed save is copied to <backupDir>/last-good; before a restart after a
// hang or crash, a missing or empty save, or a leftover .new, is moved to <backupDir>/damaged-<time> and the newest
// good copy is put back. The server's own .old.N files are never touched.
// The Backups page adds copies the owner keeps (<backupDir>/owner, never pruned) and restores a chosen copy while the
// server is stopped; the save it replaces is set aside in <backupDir>/replaced-<time>, never deleted.
import {existsSync,statSync,mkdirSync,copyFileSync,renameSync,readdirSync,unlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {join,basename} from 'node:path';

export const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15)+'-'+String(t%1000).padStart(3,'0');
const size=p=>{try{return statSync(p).size;}catch{return -1;}};
const mtime=p=>{try{return statSync(p).mtimeMs;}catch{return null;}};

export function createSaveGuard({savePath,backupDir,keep=6,now=()=>Date.now(),log=()=>{}}){
 const goodDir=join(backupDir,'last-good'),ownerDir=join(backupDir,'owner'),name=basename(savePath);
 let saving=null,keptFromFiles=null;
 const listIn=(dir,source)=>{
  if(!existsSync(dir))return [];
  return readdirSync(dir).filter(f=>f.endsWith('.sav')).sort().reverse().map(f=>{
   const meta=(()=>{try{return JSON.parse(readFileSync(join(dir,f+'.json'),'utf8'));}catch{return {};}})();
   return {file:join(dir,f),name:f,source,bytes:size(join(dir,f)),...meta};
  });
 };
 const list=()=>listIn(goodDir,'auto');
 const copyTo=(dir,meta)=>{
  const bytes=size(savePath);if(bytes<=0)return null;
  mkdirSync(dir,{recursive:true});
  const at=now(),file=join(dir,`${name.replace(/\.sav$/,'')}.${stamp(at)}.sav`);
  copyFileSync(savePath,file);writeFileSync(file+'.json',JSON.stringify({at,bytes,...meta}));
  return {file,name:basename(file),at,bytes,...meta};
 };
 const ownerFile=file=>{
  const hit=listIn(ownerDir,'owner').find(b=>b.name===file);
  if(!hit)throw Object.assign(Error('unknown copy'),{status:404});
  return hit.file;
 };
 const guard={
  get saving(){return saving;},
  onLogLine(text){
   if(/^Saving to '/.test(text)){saving={at:now(),mtime:mtime(savePath)};return null;}
   const m=/^\s*Saved (\d+) Object\(s\)/.exec(text);
   if(m){saving=null;if(keptFromFiles!=null&&mtime(savePath)===keptFromFiles)return null;return guard.snapshot({objects:Number(m[1])});} // not twice when check() kept this file
   return guard.check();
  },
  // A save in progress is done when its .new is gone and the save file is newer than when "Saving to" was logged.
  check(){
   if(!saving||existsSync(savePath+'.new'))return null;
   const m=mtime(savePath);if(m==null||(saving.mtime!=null&&m<=saving.mtime))return null;
   saving=null;keptFromFiles=m;return guard.snapshot();
  },
  snapshot(meta={}){
   const bytes=size(savePath);
   if(bytes<=0){log(`save guard: ${name} is ${bytes<0?'missing':'empty'} after a completed save; not kept`,'warn');return null;}
   const kept=copyTo(goodDir,meta);
   for(const old of list().slice(keep)){try{unlinkSync(old.file);unlinkSync(old.file+'.json');}catch{}}
   log(`save guard: kept ${name} (${bytes} bytes${meta.objects!=null?`, ${meta.objects} objects`:''})`);
   return kept;
  },
  lastGood:()=>list()[0]??null,
  backups:list,
  // Backups page ----------------------------------------------------------------------------------------------------
  ownerCopies:()=>listIn(ownerDir,'owner'),
  // A copy the owner keeps: refused while a save is being written (the file would be half done).
  keepNow(label){
   if(saving)throw Object.assign(Error('The server is saving right now; try again in a moment'),{status:409});
   const kept=copyTo(ownerDir,{label:String(label??'').trim().slice(0,80)||null,manual:true});
   if(!kept)throw Object.assign(Error(`There is no save to copy yet (${name} is missing or empty)`),{status:409});
   log(`save guard: owner kept a copy of ${name} (${kept.bytes} bytes)`);return kept;
  },
  deleteOwnerCopy(file){
   const f=ownerFile(file);unlinkSync(f);try{unlinkSync(f+'.json');}catch{}
   log(`save guard: owner deleted the copy ${basename(f)}`);
  },
  // The server's own rotation (.sav.old.0 newest … .old.5), read only.
  rotation:()=>[0,1,2,3,4,5].map(n=>{const p=`${savePath}.old.${n}`;try{const st=statSync(p);return {name:basename(p),bytes:st.size,at:st.mtimeMs};}catch{return null;}}).filter(Boolean),
  current:()=>{try{const st=statSync(savePath);return {name,bytes:st.size,at:st.mtimeMs};}catch{return {name,bytes:-1,at:null};}},
  // Folders of saves the guard or a restore set aside.
  setAside:()=>existsSync(backupDir)?readdirSync(backupDir).filter(d=>/^(damaged|replaced)-/.test(d)).sort().reverse().map(d=>({name:d,kind:d.startsWith('damaged')?'damaged':'replaced',files:readdirSync(join(backupDir,d))})):[],
  // Server must be stopped (the host checks). Puts a kept copy back; the current save goes to replaced-<time>.
  restore(file){
   const src=[...list(),...listIn(ownerDir,'owner')].find(b=>b.name===file);
   if(!src)throw Object.assign(Error('unknown backup'),{status:404});
   if(src.bytes<=0)throw Object.assign(Error('that copy is empty'),{status:409});
   const aside=join(backupDir,'replaced-'+stamp(now()));const moved=[];
   for(const p of [savePath,savePath+'.new'])if(existsSync(p)){mkdirSync(aside,{recursive:true});renameSync(p,join(aside,basename(p)));moved.push(basename(p));}
   copyFileSync(src.file,savePath);saving=null;
   log(`save guard: owner restored ${src.name}${moved.length?`; the replaced save is in ${aside}`:''}`,'warn');
   return {restored:src.name,setAside:moved.length?aside:null};
  },
  problem(){
   const bytes=size(savePath);
   if(existsSync(savePath+'.new'))return 'unfinished save (.new left behind)';
   // The real server writes a 0-byte save for a world with nothing in it (Azure VM, 2026-10-24): empty is only damage
   // when there is a good copy to go back to and the server's own last rotation (.old.0) was not empty too.
   if(bytes===0)return list().length&&size(savePath+'.old.0')!==0?'save file is empty':null;
   if(bytes<0&&list().length)return 'save file is missing';
   return null;
  },
  // Server must be stopped. Returns {restored, problem, moved, from}.
  restoreIfBad(){
   const problem=guard.problem();saving=null;
   if(!problem)return {restored:false,problem:null};
   const failed=join(backupDir,'damaged-'+stamp(now()));mkdirSync(failed,{recursive:true});
   const moved=[];
   for(const p of [savePath,savePath+'.new'])if(existsSync(p)){renameSync(p,join(failed,basename(p)));moved.push(basename(p));}
   const good=list()[0];
   if(good){copyFileSync(good.file,savePath);log(`save guard: ${problem}; moved ${moved.join(', ')||'nothing'} to ${failed}, restored ${basename(good.file)}`,'warn');}
   else log(`save guard: ${problem}; moved ${moved.join(', ')||'nothing'} to ${failed}; no good save kept yet, the server starts a fresh world`,'warn');
   return {restored:Boolean(good),problem,moved,failedDir:failed,from:good?.file??null};
  },
 };
 return guard;
}
