// Plugin manager (HOST-AND-LOADER-BUILD.md H7): Oxide plugins in the server's Oxide plugins folder (server-settings.mjs
// serverPaths: host.json components.server.oxideDir, or the first of oxide/, <datadir>/oxide, serverdata/oxide, save/oxide).
// Oxide compiles every <Name>.cs at the top of plugins/; disabling moves the file into plugins/disabled/, removing into
// plugins/removed/ with a time stamp and a .removed suffix (never compiled, never deleted). That Oxide does not look in
// sub-folders is Oxide's usual behaviour, not checked on a Legacy server. Names from the browser are checked against
// NAME and only ever joined to these folders. Our own adapter plugin is listed but cannot be changed here.
import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export const NAME=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const OWN='RustLegacyBrowser';
export const MAX_PLUGIN_BYTES=512*1024;
const err=(message,status=400)=>Object.assign(Error(message),{status});
const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);

// [Info("Title", "Author", "1.2.3")] (Oxide's attribute; a plain or verbatim string each) and [Description("...")].
export function parseInfo(src){
 const str='\\s*@?"((?:[^"\\\\]|\\\\.)*)"\\s*';
 const m=new RegExp(`\\[\\s*Info\\s*\\(${str},${str},${str}(?:,[^)]*)?\\)\\s*\\]`).exec(src);
 const d=new RegExp(`\\[\\s*Description\\s*\\(${str}\\)\\s*\\]`).exec(src);
 const cls=/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(src);
 return {title:m?.[1]??null,author:m?.[2]??null,version:m?.[3]??null,description:d?.[1]??null,className:cls?.[1]??null};
}
// Compares dotted versions numerically ("0.10.0" > "0.9.1"); null when either is missing.
export function compareVersions(a,b){
 if(!a||!b)return null;
 const pa=String(a).split(/[.-]/).map(Number),pb=String(b).split(/[.-]/).map(Number);
 for(let i=0;i<Math.max(pa.length,pb.length);i++){const x=pa[i]||0,y=pb[i]||0;if(x!==y)return x<y?-1:1;}
 return 0;
}

// consoleCommand(text): a server console command path (another piece adds one to the sidecar → plugin queue); null means
// none, and a reload then waits for the next restart.
export function createPlugins({dir,log=()=>{},now=Date.now,consoleCommand=null,ownSource}){
 const disabledDir=join(dir??'','disabled'),removedDir=join(dir??'','removed');
 const own=ownSource?parseInfo(ownSource):null;
 if(dir)cleanTemp(dir);
 const entry=(folder,file,state)=>{
  const f=join(folder,file),st=statSync(f),src=readFileSync(f,'utf8'),name=file.slice(0,-3);
  return {name,file,state,bytes:st.size,modified:st.mtimeMs,sha256:createHash('sha256').update(src).digest('hex'),...parseInfo(src),protected:name===OWN};
 };
 const listIn=(folder,state)=>existsSync(folder)?readdirSync(folder).filter(f=>f.endsWith('.cs')&&NAME.test(f.slice(0,-3))).sort((a,b)=>a.localeCompare(b)).map(f=>entry(folder,f,state)):[];
 const checkName=name=>{
  if(typeof name!=='string'||!NAME.test(name))throw err('A plugin name is letters, digits and underscores, starting with a letter');
  if(name===OWN)throw err('This is our own server adapter. It is installed and updated by the setup and the Updates page, not here',403);
  return name;
 };
 const archive=(from,name)=>{mkdirSync(removedDir,{recursive:true});const to=join(removedDir,`${name}.${stamp(now())}.cs.removed`);renameSync(from,to);return to;};
 const p={
  dir,
  status(){
   if(!dir)return {configured:false};
   const active=listIn(dir,'on'),disabled=listIn(disabledDir,'off');
   const removed=existsSync(removedDir)?readdirSync(removedDir).filter(f=>f.endsWith('.cs.removed')).sort().reverse().slice(0,20).map(f=>({file:f,name:f.split('.')[0],at:statSync(join(removedDir,f)).mtimeMs})):[];
   return {configured:true,dir,exists:existsSync(dir),plugins:[...active,...disabled],removed,reloadAvailable:Boolean(consoleCommand),maxBytes:MAX_PLUGIN_BYTES,
    own:own?{version:own.version}:null};
  },
  disable(name){
   checkName(name);const from=join(dir,name+'.cs');
   if(!existsSync(from))throw err('That plugin is not on',404);
   mkdirSync(disabledDir,{recursive:true});const to=join(disabledDir,name+'.cs');
   if(existsSync(to))archive(to,name); // an older disabled copy of the same name
   renameSync(from,to);log(`Owner: plugin ${name} turned off (moved to plugins/disabled)`,'warn');
   return p.afterChange(name,'unload');
  },
  enable(name){
   checkName(name);const from=join(disabledDir,name+'.cs'),to=join(dir,name+'.cs');
   if(!existsSync(from))throw err('That plugin is not in the turned-off list',404);
   if(existsSync(to))throw err('A plugin with that name is already on',409);
   renameSync(from,to);log(`Owner: plugin ${name} turned on`,'warn');
   return p.afterChange(name,'load');
  },
  remove(name){
   checkName(name);
   const at=[join(dir,name+'.cs'),join(disabledDir,name+'.cs')].find(f=>existsSync(f));
   if(!at)throw err('No plugin with that name',404);
   const wasOn=at===join(dir,name+'.cs');archive(at,name);log(`Owner: plugin ${name} removed (kept in plugins/removed)`,'warn');
   return wasOn?p.afterChange(name,'unload'):{ok:true};
  },
  // A new or replacement plugin. The file name is the plugin name (Oxide requires the class to match it).
  async upload(fileName,stream){
   if(!dir)throw err('No Oxide plugins folder: add components.server.oxideDir to host.json',404);
   if(typeof fileName!=='string'||!/\.cs$/.test(fileName))throw err('A plugin is a .cs file');
   const name=checkName(fileName.slice(0,-3));
   const chunks=[];let bytes=0;
   for await(const c of stream){bytes+=c.length;if(bytes>MAX_PLUGIN_BYTES)throw err(`A plugin file is at most ${MAX_PLUGIN_BYTES/1024} KB`,413);chunks.push(c);}
   const buf=Buffer.concat(chunks),src=buf.toString('utf8');
   if(!bytes)throw err('That file is empty');
   if(src.includes('\u0000')||Buffer.from(src,'utf8').length!==buf.length)throw err('That is not a text file');
   const info=parseInfo(src);
   if(!info.title)throw err('That file has no [Info("Name", "Author", "1.0.0")] line, so it is not an Oxide plugin');
   if(info.className!==name)throw err(`The plugin's class is ${info.className??'missing'}; Oxide needs the file to be called ${info.className??'<class name>'}.cs`);
   mkdirSync(dir,{recursive:true});
   const target=join(dir,name+'.cs'),off=join(disabledDir,name+'.cs');let replaced=null;
   for(const f of [target,off])if(existsSync(f)){replaced=archive(f,name);}
   const tmp=target+'.rlb-tmp';writeFileSync(tmp,buf);renameSync(tmp,target);
   log(`Owner: plugin ${name} ${replaced?'replaced':'added'} (${info.title} ${info.version??''} by ${info.author??'unknown'}, ${bytes} bytes)`,'warn');
   return {...p.afterChange(name,'load'),name,...info,replaced:Boolean(replaced)};
  },
  // Oxide's own console command; only with a console path, otherwise the change waits for the next restart.
  async reload(name){checkName(name);if(!existsSync(join(dir,name+'.cs')))throw err('That plugin is not on',404);return p.afterChange(name,'reload',true);},
  afterChange(name,verb,explicit=false){
   if(!consoleCommand)return {ok:true,applied:false,note:explicit?'The server has no console command path here yet, so this takes effect at the next restart.':'Takes effect at the next restart (Oxide may also pick up the change by itself).'};
   return Promise.resolve(consoleCommand(`oxide.${verb} ${name}`)).then(()=>({ok:true,applied:true,note:`Sent oxide.${verb} ${name} to the server.`}),e=>({ok:true,applied:false,note:`Could not send oxide.${verb}: ${e.message}. It takes effect at the next restart.`}));
  },
  // For the health check: our adapter plugin's version on the server against the one this host ships.
  ownInstalled(){if(!dir)return null;const f=join(dir,OWN+'.cs');return existsSync(f)?parseInfo(readFileSync(f,'utf8')):null;},
  ownExpected:()=>own,
 };
 return p;
}
// Removes a stray temp file from an interrupted upload (called at start).
export function cleanTemp(dir){try{for(const f of readdirSync(dir))if(f.endsWith('.rlb-tmp'))unlinkSync(join(dir,f));}catch{}}
