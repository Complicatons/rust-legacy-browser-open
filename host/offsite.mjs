// Automatic off-site backups (HOST-AND-LOADER-BUILD.md H8). On a schedule (every N hours, plus once a day) the host
// sends one backup *set* to a folder (a network share, or a OneDrive/Dropbox folder that syncs) or to S3-compatible
// storage (AWS S3, Backblaze B2, Cloudflare R2, Wasabi; host/s3.mjs). A set is everything a recovery needs, together:
//   world.sav        the newest save the save guard kept (a completed save, never the live file mid-write),
//   userdata.tar     rust_server_Data/userdata/ (each player's folder, avatar.bin and the rest),
//   identities.json  the sidecar's identity map (which website account owns which character): a world without it is
//                    not a recovery (HOSTING-ACCOUNTS-BRIDGE-PLAN.md §4),
//   set.json         written last: names, sizes and SHA-256 of the stored objects. A set without it is unfinished.
// Files are encrypted with the owner's passphrase when encryption is on (recommended for cloud storage; AES-256-GCM,
// host/offsite-files.mjs). Retention keeps the newest N sets plus the newest set of each day for D days.
// Restore downloads a set, checks every size and SHA-256, decrypts, and only then, with the server and the sidecar
// stopped, puts the files in place; what they replace goes to <backupDir>/replaced-<time>, never deleted.
// Settings: host.json "offsite" (the folder path lives only there: nothing from the browser becomes a path), overlaid
// by <dataDir>/offsite.json from the dashboard. Secrets (S3 secret key, passphrase) only in <dataDir>/offsite-secrets.json
// (owner-only), never sent back to the browser.
import {existsSync,mkdirSync,readFileSync,writeFileSync,chmodSync,copyFileSync,renameSync,rmSync,readdirSync,statSync,cpSync,unlinkSync} from 'node:fs';
import {join,basename} from 'node:path';
import {hostname} from 'node:os';
import {createS3Client,LOOPBACK} from './s3.mjs';
import {writeTar,readTar,encryptFile,decryptFile,sha256File} from './offsite-files.mjs';

export const SET=/^rlb-\d{8}-\d{6}-\d{3}$/;
const OBJECTS=['world.sav','userdata.tar','identities.json'],MAX_OBJECT=8*1024**3,PREFIX=/^([A-Za-z0-9._-]+\/)*$/;
export const OFFSITE_DEFAULTS={target:'off',everyHours:6,dailyHour:4,keepRecent:8,keepDays:14,encrypt:null,s3:{endpoint:'',region:'',bucket:'',prefix:'rust-legacy-host/',pathStyle:true,accessKeyId:''}};
const err=(message,status=400)=>Object.assign(Error(message),{status});
const setId=t=>'rlb-'+new Date(t).toISOString().replace(/[-:]/g,'').replace('T','-').replace(/\.(\d{3})Z$/,'-$1');
const setTime=id=>{const m=/^rlb-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(\d{3})$/.exec(id);return m?Date.UTC(m[1],m[2]-1,m[3],m[4],m[5],m[6],m[7]):0;};
const readJson=(f,d)=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return d;}};
const writeOwnerOnly=(f,v)=>{writeFileSync(f,JSON.stringify(v,null,1),{mode:0o600});try{chmodSync(f,0o600);}catch{}};
const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
// A rename, or copy-and-remove when the two folders are on different drives.
const move=(a,b)=>{try{renameSync(a,b);}catch(e){if(e.code!=='EXDEV')throw e;cpSync(a,b,{recursive:true});rmSync(a,{recursive:true,force:true});}};

// host.json "offsite" checks, for validateHostConfig.
export function offsiteConfigErrors(o){
 if(o===undefined)return [];
 const e=[];
 if(typeof o!=='object'||!o)return ['offsite must be an object'];
 if(o.folder!==undefined&&(typeof o.folder!=='string'||!o.folder))e.push('offsite.folder must be the folder for backup sets (a network share or a synced folder)');
 for(const m of settingsErrors({...OFFSITE_DEFAULTS,...o,s3:{...OFFSITE_DEFAULTS.s3,...o.s3}},{folder:o.folder}))e.push('offsite: '+m);
 return e;
}
function settingsErrors(s,{folder}){
 const e=[];
 if(!['off','folder','s3'].includes(s.target))e.push('target must be off, folder or s3');
 if(s.target==='folder'&&!folder)e.push('a folder target needs "offsite": {"folder": "…"} in host.json');
 if(!int(s.everyHours,0,168))e.push('every N hours must be 0 (off) to 168');
 if(!(s.dailyHour===null||int(s.dailyHour,0,23)))e.push('the daily hour must be 0 to 23, or none');
 if(!int(s.keepRecent,1,1000))e.push('keep recent must be 1 to 1000');
 if(!int(s.keepDays,0,3650))e.push('keep daily must be 0 to 3650 days');
 if(s.encrypt!==null&&typeof s.encrypt!=='boolean')e.push('encrypt must be true or false');
 const x=s.s3;
 if(s.target==='s3'){
  try{const u=new URL(x.endpoint);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&LOOPBACK(u.hostname)))e.push('the S3 endpoint must use https');else if(u.pathname!=='/'||u.search||u.username)e.push('the S3 endpoint must be just the scheme and host');}
  catch{e.push('the S3 endpoint must be a URL such as https://s3.us-east-1.amazonaws.com');}
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(x.bucket))e.push('the bucket name must be 3 to 63 lower-case letters, digits, dots or dashes');
  if(!/^[A-Za-z0-9-]{1,40}$/.test(x.region||'us-east-1'))e.push('the region looks wrong (for example us-east-1, or auto for Cloudflare R2)');
  if(!/^[A-Za-z0-9+/=._-]{3,200}$/.test(x.accessKeyId))e.push('the access key ID is required');
 }
 if(typeof x.prefix!=='string'||!PREFIX.test(x.prefix)||x.prefix.length>200||/(^|\/)\.\.?\//.test(x.prefix))e.push('the key prefix may hold letters, digits, dot, dash, underscore and ends with /');
 if(typeof x.pathStyle!=='boolean')e.push('path style must be true or false');
 return e;
}

// Targets: the same five calls over a folder or a bucket. Objects are <set>/<name>.
function folderTarget(root){
 const dir=id=>join(root,id);
 // The folder itself is never created here: a share that is not connected must fail, not fill a local stand-in.
 const there=()=>{if(!existsSync(root))throw Error(`The backup folder ${root} is not there (is the share connected?)`);};
 return {
  label:root,
  async put(id,name,file,sha256){
   there();mkdirSync(dir(id),{recursive:true});
   const final=join(dir(id),name),tmp=join(dir(id),`.${name}.partial`);
   copyFileSync(file,tmp);renameSync(tmp,final);
   // Read it back: a sync client or a flaky share must not leave a copy that only looks right.
   const bytes=statSync(final).size;if(bytes!==statSync(file).size||await sha256File(final)!==sha256)throw Error(`The copy of ${name} in the folder does not match; the folder may be full or failing`);
  },
  async putText(id,name,text){there();mkdirSync(dir(id),{recursive:true});const tmp=join(dir(id),`.${name}.partial`);writeFileSync(tmp,text);renameSync(tmp,join(dir(id),name));},
  async list(){
   there();return readdirSync(root).filter(d=>SET.test(d)).map(id=>({id,complete:existsSync(join(dir(id),'set.json'))}));
  },
  async getText(id,name){const f=join(dir(id),name);if(statSync(f).size>1<<20)throw Error(name+' is too large');return readFileSync(f,'utf8');},
  async get(id,name,dest,maxBytes){const f=join(dir(id),name);if(statSync(f).size>maxBytes)throw Error(`${name} is larger than its set says`);copyFileSync(f,dest);},
  async remove(id){if(SET.test(id))rmSync(dir(id),{recursive:true,force:true});},
 };
}
function s3Target(s,secret,fetchImpl){
 const c=createS3Client({...s,region:s.region||'us-east-1',secretAccessKey:secret,fetch:fetchImpl}),k=(id,name)=>s.prefix+id+'/'+name;
 return {
  label:`${s.bucket} at ${new URL(s.endpoint).host}`,
  async put(id,name,file,sha256){
   const {bytes}=await c.putFile(k(id,name),file,sha256);
   const h=await c.head(k(id,name));if(!h||h.bytes!==bytes)throw Error(`The storage reports ${name} as ${h?h.bytes+' bytes':'missing'} after the upload, not ${bytes} bytes`);
  },
  putText:(id,name,text)=>c.putText(k(id,name),text),
  async list(){
   const sets=new Map();
   for(const o of await c.list(s.prefix)){const [id,name]=o.key.slice(s.prefix.length).split('/');if(!SET.test(id))continue;const x=sets.get(id)??{id,complete:false,keys:[]};x.keys.push(o.key);if(name==='set.json')x.complete=true;sets.set(id,x);}
   return [...sets.values()];
  },
  getText:(id,name)=>c.getText(k(id,name)),
  get:(id,name,dest,maxBytes)=>c.getFile(k(id,name),dest,maxBytes),
  async remove(id,known){for(const key of known?.keys??OBJECTS.flatMap(n=>[n,n+'.enc']).concat('set.json').map(n=>k(id,n)))await c.delete(key);},
 };
}

// Which sets retention keeps: the newest keepRecent, and the newest of each UTC day for keepDays days.
export function retained(ids,{keepRecent,keepDays},now){
 const sorted=[...ids].sort().reverse(),keep=new Set(sorted.slice(0,keepRecent)),days=new Set();
 for(const id of sorted){const t=setTime(id),day=new Date(t).toISOString().slice(0,10);if(now-t<=keepDays*86400e3&&!days.has(day)){days.add(day);keep.add(id);}}
 return keep;
}

// opts: {dataDir, backupDir, savePath, userdataDir, identityFile, config (host.json offsite), lastGood(), canRestore()
//        → null or the reason it may not, now, log, fetch}
export function createOffsite({dataDir,backupDir,savePath,userdataDir,identityFile,config={},lastGood,canRestore=()=>null,now=()=>Date.now(),log=()=>{},fetch:fetchImpl}){
 const dir=join(dataDir,'offsite');mkdirSync(dir,{recursive:true});
 const files={settings:join(dataDir,'offsite.json'),secrets:join(dataDir,'offsite-secrets.json'),state:join(dir,'state.json')};
 const folder=config.folder??null;
 const settings=()=>{const ui=readJson(files.settings,{});return {...OFFSITE_DEFAULTS,...config,...ui,folder:undefined,s3:{...OFFSITE_DEFAULTS.s3,...config.s3,...ui.s3}};};
 const secrets=()=>readJson(files.secrets,{});
 let state=readJson(files.state,{last:null,lastRestore:null,lastAttemptAt:0,lastOkAt:0});
 const saveState=()=>writeFileSync(files.state,JSON.stringify(state));
 let busy=null,cache={at:0,sets:null,error:null};
 const encrypting=s=>s.encrypt??s.target==='s3';
 const target=(s=settings())=>{
  if(s.target==='folder'){if(!folder)throw err('No folder is set in host.json (offsite.folder)',409);return folderTarget(folder);}
  if(s.target==='s3'){const k=secrets().s3SecretKey;if(!k)throw err('Enter the S3 secret key first',409);return s3Target(s.s3,k,fetchImpl);}
  throw err('Off-site backups are off: choose a folder or S3 storage first',409);
 };
 const lock=async(op,fn)=>{
  if(busy)throw err(`An off-site ${busy.op} is already running`,409);
  busy={op,step:'starting',startedAt:now()};
  try{return await fn(step=>{busy.step=step;});}finally{busy=null;}
 };
 // When the next scheduled run is due: every N hours after the last attempt (a failure retries after an hour at the
 // earliest), and once a day after dailyHour (local time) when no set went up since.
 function nextAt(s=settings()){
  if(s.target==='off')return null;
  const c=[];
  if(s.everyHours>0)c.push(state.lastAttemptAt?state.lastAttemptAt+(state.last?.ok===false?Math.min(s.everyHours,1):s.everyHours)*3600e3:now());
  if(s.dailyHour!=null){const d=new Date(now());d.setHours(s.dailyHour,0,0,0);let t=d.getTime();if(t<=Math.max(state.lastOkAt,state.lastAttemptAt))t+=86400e3;c.push(t);}
  return c.length?Math.max(now(),Math.min(...c)):null; // past due shows as now
 }

 async function listSets(t=target()){
  const sets=await t.list(),out=[];
  for(const x of sets){
   if(!x.complete){out.push({id:x.id,at:setTime(x.id),complete:false,_raw:x});continue;}
   let m=cache.manifests?.get(x.id);
   if(!m){try{m=JSON.parse(await t.getText(x.id,'set.json'));}catch(e){m={error:e.message};}(cache.manifests??=new Map()).set(x.id,m);}
   out.push({id:x.id,at:setTime(x.id),complete:true,encrypted:Boolean(m.encrypted),bytes:(m.objects??[]).reduce((n,o)=>n+(o.bytes||0),0),save:m.save??null,userdataFiles:m.userdataFiles??null,identities:m.identities??null,from:m.host??null,error:m.error??null,_raw:x});
  }
  return out.sort((a,b)=>b.at-a.at);
 }
 const pub=sets=>sets.map(({_raw,...x})=>x);

 async function backup(setStep,{reason='owner'}={}){
  const s=settings(),t=target(s),enc=encrypting(s),pass=secrets().passphrase;
  if(enc&&!pass)throw err('Encryption is on: set a passphrase first (or turn encryption off)',409);
  const good=lastGood();
  if(!good)throw err('There is no completed save to send yet; the watchdog keeps one after each autosave',409);
  const at=now(),id=setId(at),work=join(dir,'outgoing',id);mkdirSync(work,{recursive:true});
  state.lastAttemptAt=at;saveState();
  try{
   setStep('packing');
   copyFileSync(good.file,join(work,'world.sav'));
   const ud=writeTar(userdataDir,'userdata',join(work,'userdata.tar'));
   let identities=null;
   if(identityFile&&existsSync(identityFile)){copyFileSync(identityFile,join(work,'identities.json'));identities=(readJson(join(work,'identities.json'),{}).entries??[]).length;}
   const names=OBJECTS.filter(n=>existsSync(join(work,n))),objects=[];
   for(const n of names){
    let f=join(work,n),name=n;
    if(enc){setStep('encrypting');await encryptFile(f,f+'.enc',pass);unlinkSync(f);f+='.enc';name+='.enc';}
    objects.push({name,file:f,bytes:statSync(f).size,sha256:await sha256File(f)});
   }
   for(const o of objects){setStep('sending '+o.name);await t.put(id,o.name,o.file,o.sha256);}
   const manifest={format:'rlb-offsite-set-1',id,createdAt:at,host:hostname(),reason,encrypted:enc,
    save:{name:basename(savePath),keptAt:good.at??null,objects:good.objects??null},userdataFiles:ud.files,identities,
    objects:objects.map(({name,bytes,sha256})=>({name,bytes,sha256}))};
   setStep('finishing');await t.putText(id,'set.json',JSON.stringify(manifest,null,1));
   const bytes=objects.reduce((n,o)=>n+o.bytes,0);
   let pruned=0;
   try{setStep('removing old sets');pruned=await prune(t,s);}catch(e){log(`off-site: the new set is safe, but removing old sets failed: ${e.message}`,'warn');}
   state.last={ok:true,at,set:id,bytes,ms:now()-at,pruned,target:t.label,reason,identities,userdataFiles:ud.files};state.lastOkAt=at;saveState();
   cache.at=0;
   log(`off-site: sent set ${id} to ${t.label} (${(bytes/1048576).toFixed(1)} MB${enc?', encrypted':''}; ${identities==null?'no identity map yet':identities+' linked identities'}; ${ud.files} player files)${pruned?`; removed ${pruned} old set(s)`:''}`);
   return state.last;
  }catch(e){
   state.last={ok:false,at,error:e.message,target:t.label,reason};saveState();
   log(`off-site: backup to ${t.label} failed: ${e.message}`,'error');throw e;
  }finally{rmSync(work,{recursive:true,force:true});}
 }
 async function prune(t,s){
  const sets=await listSets(t),keep=retained(sets.filter(x=>x.complete).map(x=>x.id),s,now());let n=0;
  for(const x of sets){
   // An unfinished set (no set.json) is removed once it is a day old: an upload that died part way.
   if(x.complete?keep.has(x.id):now()-x.at<86400e3)continue;
   await t.remove(x.id,x._raw);cache.manifests?.delete(x.id);n++;
  }
  return n;
 }

 async function restore(id,{passphrase}={},setStep){
  if(!SET.test(id??''))throw err('unknown set',404);
  const why=canRestore();if(why)throw err(why,409);
  const t=target(),work=join(dir,'incoming',id);
  rmSync(work,{recursive:true,force:true});mkdirSync(work,{recursive:true});
  try{
   setStep('reading the set');
   let m;try{m=JSON.parse(await t.getText(id,'set.json'));}catch(e){throw err(`Set ${id} cannot be read: ${e.message}`,e.status===404?404:502);}
   if(m.format!=='rlb-offsite-set-1'||m.id!==id||!Array.isArray(m.objects))throw err('That set\'s set.json is not one this host wrote',409);
   const allowed=new Set(OBJECTS.flatMap(n=>[n,n+'.enc']));
   for(const o of m.objects)if(!allowed.has(o.name)||!int(o.bytes,0,MAX_OBJECT)||!/^[0-9a-f]{64}$/.test(o.sha256))throw err('That set lists a file it should not: '+String(o.name).slice(0,60),409);
   const get=n=>m.objects.find(o=>o.name.replace(/\.enc$/,'')===n);
   if(!get('world.sav'))throw err('That set has no world save',409);
   const pass=passphrase||secrets().passphrase;
   if(m.encrypted&&!pass)throw err('That set is encrypted: enter its passphrase',409);
   const plain={};
   for(const o of m.objects){
    setStep('downloading '+o.name);
    const f=join(work,o.name);await t.get(id,o.name,f,o.bytes);
    if(statSync(f).size!==o.bytes||await sha256File(f)!==o.sha256)throw err(`${o.name} does not match its set (size or SHA-256); nothing was changed`,409);
    const n=o.name.replace(/\.enc$/,'');
    if(o.name.endsWith('.enc')){setStep('decrypting '+n);await decryptFile(f,join(work,n),pass);unlinkSync(f);}
    plain[n]=join(work,n);
   }
   if(statSync(plain['world.sav']).size===0)throw err('The world save in that set is empty',409);
   setStep('checking');
   let ud=null;if(plain['userdata.tar']){ud=join(work,'userdata');readTar(plain['userdata.tar'],'userdata',ud);}
   let ids=null;if(plain['identities.json']){const j=readJson(plain['identities.json'],null);if(!Array.isArray(j?.entries))throw err('The identity map in that set is damaged',409);ids=j.entries.length;}
   // Check again: downloading can take minutes, and the owner may have started the server meanwhile.
   const why2=canRestore();if(why2)throw err(why2,409);
   setStep('putting files in place');
   const aside=join(backupDir,'replaced-'+setId(now()).slice(4)),moved=[];
   const putAside=(p,name)=>{if(!existsSync(p))return;mkdirSync(aside,{recursive:true});move(p,join(aside,name));moved.push(name);};
   putAside(savePath,basename(savePath));putAside(savePath+'.new',basename(savePath)+'.new');
   move(plain['world.sav'],savePath);
   if(ud){putAside(userdataDir,'userdata');move(ud,userdataDir);}
   if(ids!=null&&identityFile){putAside(identityFile,basename(identityFile));move(plain['identities.json'],identityFile);}
   const r={ok:true,at:now(),set:id,setAside:moved.length?aside:null,moved,userdata:Boolean(ud),identities:ids!=null&&identityFile?ids:null};
   state.lastRestore=r;saveState();
   log(`off-site: restored set ${id} from ${t.label}: the world save${ud?', the player folder':''}${r.identities!=null?`, the identity map (${ids} identities)`:''}${moved.length?`; the replaced files are in ${aside}`:''}`,'warn');
   if(ids!=null&&!identityFile)log('off-site: the set has an identity map but there is no sidecar in host.json; put identities.json in place by hand','warn');
   return r;
  }catch(e){
   state.lastRestore={ok:false,at:now(),set:id,error:e.message};saveState();
   log(`off-site: restore of ${id} failed: ${e.message}`,'error');throw e;
  }finally{rmSync(work,{recursive:true,force:true});}
 }

 let timer=null;
 const o={
  async status({refresh=false}={}){
   const s=settings(),sec=secrets();
   if(s.target!=='off'&&!busy&&(refresh||!cache.sets||now()-cache.at>60e3)){
    try{cache={...cache,at:now(),sets:pub(await listSets()),error:null};}catch(e){cache={...cache,at:now(),sets:null,error:e.message};}
   }
   return {available:true,settings:{...s,encrypt:encrypting(s)},folder,secrets:{s3SecretKey:Boolean(sec.s3SecretKey),passphrase:Boolean(sec.passphrase)},
    busy,last:state.last,lastRestore:state.lastRestore,nextAt:nextAt(s),sets:s.target==='off'?[]:cache.sets,listError:s.target==='off'?null:cache.error,restoreBlocked:canRestore()};
  },
  // Dashboard settings: fixed fields only. Secrets are replaced when given and never returned.
  saveSettings(b={}){
   const cur=readJson(files.settings,{}),next={...cur,s3:{...cur.s3}};
   for(const k of ['target','everyHours','dailyHour','keepRecent','keepDays','encrypt'])if(b[k]!==undefined)next[k]=b[k];
   for(const k of ['endpoint','region','bucket','prefix','pathStyle','accessKeyId'])if(b.s3?.[k]!==undefined)next.s3[k]=typeof b.s3[k]==='string'?b.s3[k].trim():b.s3[k];
   if(next.s3.prefix!==undefined&&next.s3.prefix!==''&&!next.s3.prefix.endsWith('/'))next.s3.prefix+='/';
   const merged={...OFFSITE_DEFAULTS,...config,...next,s3:{...OFFSITE_DEFAULTS.s3,...config.s3,...next.s3}};
   const problems=settingsErrors(merged,{folder});if(problems.length)throw err(problems.join('; '));
   const sec=secrets();
   if(b.s3SecretKey!==undefined&&b.s3SecretKey!==''){if(typeof b.s3SecretKey!=='string'||!/^\S{8,200}$/.test(b.s3SecretKey))throw err('The secret key looks wrong');sec.s3SecretKey=b.s3SecretKey;}
   if(b.passphrase!==undefined&&b.passphrase!==''){if(typeof b.passphrase!=='string'||b.passphrase.length<10||b.passphrase.length>200)throw err('The passphrase must be 10 to 200 characters');sec.passphrase=b.passphrase;}
   writeOwnerOnly(files.settings,next);writeOwnerOnly(files.secrets,sec);cache={at:0,sets:null,error:null};
   log(`Owner: off-site backup settings saved (${merged.target}${merged.target==='s3'?' '+merged.s3.bucket:''})`);
   return {ok:true};
  },
  backupNow:(opts)=>lock('backup',step=>backup(step,opts)),
  restore:(id,opts)=>lock('restore',step=>restore(id,opts,step)),
  // Starts a run in the background when one is due (called every minute by the host).
  tick(){
   const n=nextAt();if(busy||n==null||n>now()||!lastGood())return false; // no completed save yet: nothing to send
   o.backupNow({reason:'schedule'}).catch(()=>{});return true;
  },
  start(everyMs=60e3){clearInterval(timer);timer=setInterval(()=>{try{o.tick();}catch{}},everyMs);timer.unref?.();},
  stop(){clearInterval(timer);},
  get busy(){return busy;},
 };
 return o;
}
