// Server settings editor (HOST-AND-LOADER-BUILD.md H4): the game server's cfg file and our adapter's own settings.
// The original server runs `-cfg cfg/server.cfg` (deploy/host-test/settings.json args, from the shipped Run Server.bat)
// and reads it only at start, as console lines `name "value"`; it never writes it, so a save in progress does not
// matter here and every change needs a restart. Files are rewritten line by line: comments, unknown lines and their
// order stay as they were. Each write is atomic (temp file + rename) after a copy into <dataDir>/settings-backups.
// Paths (host.json, optional): components.server.cfgFile (default from -cfg) and components.server.oxideDir.
import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync,readdirSync,unlinkSync,copyFileSync} from 'node:fs';
import {join,resolve,basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {hostTestSettings} from './config.mjs';

const err=(message,status=400,extra={})=>Object.assign(Error(message),{status,...extra});
const argAfter=(args,flag)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const sha=t=>createHash('sha256').update(t).digest('hex').slice(0,16);

// Where the server's files are. Oxide's folder is an assumption (OFFSHOOT-COMPATIBILITY-PLAN.md: "copy into
// oxide/plugins"); Legacy hosts differ, so the first of these that exists wins and host.json can name it.
export function serverPaths(config,{settings}={}){
 const s=config.components?.server;if(!s?.dir)return null;
 const args=s.kind==='original'?(settings??hostTestSettings()).server.args:[];
 const datadir=argAfter(args,'-datadir')??'rust_server_Data/',dir=s.dir;
 const oxideCandidates=s.oxideDir?[resolve(dir,s.oxideDir)]:[join(dir,'oxide'),join(dir,datadir,'oxide'),join(dir,'serverdata','oxide'),join(dir,'save','oxide')];
 const oxideDir=oxideCandidates.find(d=>existsSync(d))??oxideCandidates[0];
 const max=Number(argAfter(args,'-maxplayers'));
 return {dir,kind:s.kind,datadir,cfgFile:resolve(dir,s.cfgFile??argAfter(args,'-cfg')??'cfg/server.cfg'),
  vanillaCfg:join(dir,datadir,'cfg','rustlegacybrowser.cfg'),oxideDir,pluginsDir:join(oxideDir,'plugins'),oxideConfig:join(oxideDir,'config','RustLegacyBrowser.json'),
  managed:join(dir,datadir,'Managed'),maxPlayers:Number.isInteger(max)?max:null};
}

// Curated settings. Only names this repository has evidence for (`evidence`): the shipped cfg/server.cfg
// (deploy/vm-test/server/server.cfg), or the decompiled server as ported and documented here. `def` is the original's
// own default where known, `shipped` the value in the shipped cfg.
const SHIPPED='shipped cfg/server.cfg';
export const SETTINGS=[
 {key:'server.hostname',group:'General',label:'Server name',type:'text',max:64,shipped:'Server Name',help:'The name players see in the server list.',evidence:SHIPPED+'; the adapter reads server.hostname'},
 {key:'server.pvp',group:'Gameplay',label:'PvP',type:'bool',shipped:'true',help:'Players can hurt and kill each other.',evidence:SHIPPED},
 {key:'sleeper.on',group:'Gameplay',label:'Sleepers',type:'bool',shipped:'true',help:'A player who leaves stays in the world asleep, and can be killed and looted.',evidence:SHIPPED+' (meaning from the name)'},
 {key:'falldamage.enabled',group:'Gameplay',label:'Fall damage',type:'bool',shipped:'true',help:'Falling from a height hurts and can break legs.',evidence:SHIPPED},
 {key:'player.backpackLockTime',group:'Gameplay',label:'Death bag lock',type:'int',min:0,max:3600,unit:'s',def:'0',shipped:'30',help:'Seconds only the dead player can open their own loot bag.',evidence:SHIPPED+'; HumanController.OnKilled (HANDOFF.md)'},
 {key:'crafting.workbench_speed',group:'Gameplay',label:'Workbench speed',type:'float',min:0.1,max:100,def:'3',help:'How many times faster crafting is at a workbench.',evidence:'CraftingInventory (site/js/craft-plan.mjs)'},
 {key:'airdrop.min_players',group:'Airdrops',label:'Airdrop players',type:'int',min:0,max:500,def:'50',shipped:'20',help:'Automatic airdrops come only when more than this many players are online.',evidence:SHIPPED+'; SupplyDropTimer (browser/airdrops.mjs)'},
 {key:'decay.deploy_maxhealth_sec',group:'Decay',label:'Deployable decay',type:'int',min:60,max:31536000,unit:'s',def:'43200',help:'Seconds an unprotected deployable (box, bed, fire) takes to decay from full health.',evidence:'EnvDecay console variables (browser/decay.mjs)'},
 {key:'decay.decaytickrate',group:'Decay',label:'Decay tick',type:'int',min:10,max:86400,unit:'s',def:'300',help:'Seconds between decay checks.',evidence:'EnvDecay console variables (browser/decay.mjs)'},
 {key:'env.daylength',group:'World',label:'Day length',type:'float',min:1,max:1440,unit:'min',def:'45',help:'Real minutes of daytime.',evidence:'EnvironmentControlCenter (browser/tod.mjs, PORT-STATUS.md)'},
 {key:'env.nightlength',group:'World',label:'Night length',type:'float',min:1,max:1440,unit:'min',def:'15',help:'Real minutes of night.',evidence:'EnvironmentControlCenter (browser/tod.mjs, PORT-STATUS.md)'},
 {key:'voice.distance',group:'World',label:'Voice distance',type:'float',min:0,max:1000,unit:'m',def:'100',help:'How far voice chat carries. 0 turns voice off.',evidence:'VoiceCom (GAMEPLAY-PROTOCOL.md)'},
 {key:'save.autosavetime',group:'Saving',label:'Autosave every',type:'int',min:60,max:7200,unit:'s',def:'600',help:'Seconds between world saves. Less often means more lost after a crash.',evidence:'ServerSaveManager (HOST-APP-PLAN.md "Watchdog")'},
 {key:'truth.enforce',group:'Anti-cheat',label:'Movement check',type:'bool',shipped:'true',help:'The original game\'s own movement check (TruthDetector). Keep it on.',evidence:SHIPPED+'; SERVER-TESTING-PLAN.md P7'},
 {key:'truth.punish',group:'Anti-cheat',label:'Kick on movement check',type:'bool',def:'true',help:'Kick players whose movement score passes the limit below.',evidence:'TruthDetector (ANTICHEAT-ADMIN-PLAN.md)'},
 {key:'truth.threshold',group:'Anti-cheat',label:'Movement limit',type:'int',min:50,max:5000,def:'400',help:'Score that gets a player kicked. Lower is stricter (200 is a common choice).',evidence:'TruthDetector (ANTICHEAT-ADMIN-PLAN.md)'},
 {key:'cheaters.log',group:'Anti-cheat',label:'Log cheaters',type:'bool',shipped:'true',help:'Write anti-cheat detections to the server log.',evidence:SHIPPED+' (meaning from the name)'},
 {key:'chat.serverlog',group:'Logging',label:'Log chat',type:'bool',shipped:'true',help:'Write player chat to the server log.',evidence:SHIPPED+' (meaning from the name)'},
 {key:'server.clienttimeout',group:'Network',label:'Client timeout',type:'int',min:5,max:600,unit:'s',shipped:'30',help:'Seconds without a reply before a player is dropped.',evidence:SHIPPED},
 {key:'server.sendrate',group:'Network',label:'Send rate',type:'int',min:1,max:60,shipped:'5',help:'Network updates per second. Leave at 5 unless you know why.',evidence:SHIPPED+'; WildlifeManager (PORT-STATUS.md)'},
 {key:'server.framerate',group:'Network',label:'Server frame rate',type:'int',min:10,max:200,shipped:'30',help:'Server ticks per second. Higher uses more CPU.',evidence:SHIPPED},
 {key:'wildlife.forceupdate',group:'World',label:'Wildlife always on',type:'bool',shipped:'true',help:'Animals keep moving even where no player is near.',evidence:SHIPPED+' (meaning from the name)'},
];
const BY_KEY=new Map(SETTINGS.map(s=>[s.key.toLowerCase(),s]));
export const SECRET_KEYS=new Set(['rcon.password']);
// Console lines that do something instead of setting a value never belong in a cfg written from a web page.
const ACTION_KEY=/^(rcon\.login|teleport\.|inv\.|airdrop\.drop$|.*\.(quit|stop|kill|give|drop|kick|ban\w*|login|run|exec|load|save|reload)$)/i;
export const KEY=/^[A-Za-z][A-Za-z0-9_]{0,40}\.[A-Za-z][A-Za-z0-9_]{0,40}$/;
const secretish=k=>SECRET_KEYS.has(k.toLowerCase())||/password|secret|token|key$/i.test(k);
// Values are written quoted; the cfg has no escape, so no quotes, backslashes or control characters.
function cleanText(v,max,what){
 const s=String(v??'');
 if(s.length>max)throw err(`${what} is longer than ${max} characters`);
 if(/["\\\u0000-\u001f\u007f]/.test(s))throw err(`${what} cannot contain quotes, backslashes or line breaks`);
 return s;
}
export function normalize(def,v){
 const what=def.label??def.key;
 if(def.type==='bool'){if(v===true||v==='true')return 'true';if(v===false||v==='false')return 'false';throw err(`${what} must be on or off`);}
 if(def.type==='int'||def.type==='float'){
  const n=typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;
  if(!Number.isFinite(n)||(def.type==='int'&&!Number.isInteger(n)))throw err(`${what} must be a ${def.type==='int'?'whole ':''}number`);
  if(n<def.min||n>def.max)throw err(`${what} must be between ${def.min} and ${def.max}`);
  return String(n);
 }
 return cleanText(v,def.max??200,what);
}

// One line per entry: {raw} for anything we do not understand (kept as is), or {raw,key,value}.
const LINE=/^\s*([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)\s+(?:"([^"]*)"|(\S+))\s*$/;
export function parseCfg(text){
 const bom=text.startsWith('\ufeff'),body=bom?text.slice(1):text,eol=/\r\n/.test(body)?'\r\n':'\n';
 const parts=body?body.split(/\r?\n/):[],trailing=parts.length>1&&parts.at(-1)==='';if(trailing)parts.pop();
 return {bom,eol,trailing,lines:parts.map(raw=>{const m=LINE.exec(raw);return m?{raw,key:m[1],value:m[2]??m[3]}:{raw};})};
}
export function cfgValues(parsed){const m=new Map();for(const l of parsed.lines)if(l.key)m.set(l.key.toLowerCase(),{key:l.key,value:l.value});return m;}
// set: {key: value} (every line of that key gets the value; the server runs the file top to bottom, so a duplicate
// left behind with an old value would win); remove: [key]. New keys go at the end. Keys match without case.
export function applyCfg(text,{set={},remove=[]}={}){
 const p=parseCfg(text),want=new Map(Object.entries(set).map(([k,v])=>[k.toLowerCase(),{key:k,value:v}])),drop=new Set(remove.map(k=>k.toLowerCase())),seen=new Set();
 const out=[];
 for(const l of p.lines){
  const k=l.key?.toLowerCase();
  if(k&&drop.has(k))continue;
  if(k&&want.has(k)){seen.add(k);out.push(`${l.key} "${want.get(k).value}"`);continue;}
  out.push(l.raw);
 }
 for(const [k,w] of want)if(!seen.has(k))out.push(`${w.key} "${w.value}"`);
 return (p.bom?'\ufeff':'')+out.join(p.eol)+(p.trailing||!text?p.eol:'');
}

// Our adapter's settings: the vanilla patch reads <datadir>/cfg/rustlegacybrowser.cfg (Key=Value lines, adapter/vanilla),
// the Oxide plugin reads its Oxide config (oxide/config/RustLegacyBrowser.json: Oxide's convention, assumed).
export const ADAPTER_SETTINGS=[
 {key:'LauncherOnly',label:'Website players only',type:'bool',def:'false',help:'On: only players who signed in on your website (browser, or the desktop game through our loader) can join. Everyone else gets "Authorization failed". Turn it on for a public server that runs only our software; leave it off to keep players who join with their own desktop game.'},
 {key:'Motd',label:'Message of the day',type:'text',max:200,def:'',help:'Shown in chat to every player a few seconds after they join. Empty sends nothing.'},
];
export function parseKeyValue(text){
 const bom=text.startsWith('\ufeff'),body=bom?text.slice(1):text,eol=/\r\n/.test(body)?'\r\n':'\n';
 const parts=body.split(/\r?\n/),trailing=parts.length>1&&parts.at(-1)==='';if(trailing)parts.pop();
 // Same rule as ReadConfig in adapter/vanilla: trimmed, '#' comments, split at the first '='.
 return {bom,eol,trailing,lines:parts.map(raw=>{const t=raw.trim(),eq=t.indexOf('=');return t&&t[0]!=='#'&&eq>0?{raw,key:t.slice(0,eq).trim(),value:t.slice(eq+1).trim()}:{raw};})};
}
export function applyKeyValue(text,set){
 const p=parseKeyValue(text),seen=new Set(),out=[];
 for(const l of p.lines){if(l.key&&l.key in set){if(seen.has(l.key))continue;seen.add(l.key);out.push(`${l.key}=${set[l.key]}`);}else out.push(l.raw);}
 for(const [k,v] of Object.entries(set))if(!seen.has(k))out.push(`${k}=${v}`);
 return (p.bom?'\ufeff':'')+out.join(p.eol)+p.eol;
}

const stamp=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15)+'-'+String(t%1000).padStart(3,'0');
// Copy aside, then temp file + rename in the same folder, so a crash mid-write never leaves half a file.
export function writeAtomic(file,text,{backupDir,now=Date.now,keep=20}={}){
 let backup=null;
 if(backupDir&&existsSync(file)){
  mkdirSync(backupDir,{recursive:true});backup=join(backupDir,`${basename(file)}.${stamp(now())}`);copyFileSync(file,backup);
  const mine=readdirSync(backupDir).filter(f=>f.startsWith(basename(file)+'.')).sort().reverse();
  for(const old of mine.slice(keep)){try{unlinkSync(join(backupDir,old));}catch{}}
 }
 mkdirSync(dirname(file),{recursive:true});
 const tmp=file+'.rlb-tmp';writeFileSync(tmp,text);renameSync(tmp,file);
 return backup;
}

export function createServerSettings({config,settings,serverState=()=>'stopped',log=()=>{},now=Date.now}){
 const paths=serverPaths(config,{settings}),backupDir=join(config.dataDir,'settings-backups');
 const readText=f=>existsSync(f)?readFileSync(f,'utf8'):null;
 function adapterFile(){
  if(!paths)return null;
  if(existsSync(paths.vanillaCfg))return {kind:'vanilla',file:paths.vanillaCfg};
  if(existsSync(paths.oxideConfig)||existsSync(join(paths.pluginsDir,'RustLegacyBrowser.cs')))return {kind:'oxide',file:paths.oxideConfig};
  return null;
 }
 function readAdapter(){
  const a=adapterFile();if(!a)return {kind:null};
  const text=readText(a.file);
  if(text===null)return {...a,exists:false};
  let values;
  if(a.kind==='vanilla'){values={};for(const l of parseKeyValue(text).lines)if(l.key)values[l.key]=l.value;}
  else{try{values=JSON.parse(text.replace(/^\ufeff/,''));}catch{return {...a,exists:true,error:'The Oxide config is not valid JSON'};}}
  const str=v=>v==null?'':String(v);
  return {...a,exists:true,version:sha(text),values:{LauncherOnly:str(values.LauncherOnly).toLowerCase()==='true'?'true':'false',Motd:str(values.Motd),SidecarUrl:str(values.SidecarUrl)},
   pluginKey:{set:/^([0-9a-fA-F]{2}){32,}$/.test(str(values.PluginKeyHex))}};
 }
 const api={
  paths:()=>paths,
  readAdapter,
  read(){
   if(!paths)return {configured:false};
   const text=readText(paths.cfgFile),state=serverState();
   const base={configured:true,serverState:state,restartNeeded:state==='running'||state==='starting',file:paths.cfgFile,exists:text!==null,maxPlayers:paths.maxPlayers,
    adapter:readAdapter(),adapterSettings:ADAPTER_SETTINGS,backupDir};
   if(text===null)return {...base,values:SETTINGS.map(s=>({...s,value:null})),other:[],secrets:{'rcon.password':{set:false}},kept:0};
   const p=parseCfg(text),vals=cfgValues(p),counts=new Map();
   for(const l of p.lines)if(l.key)counts.set(l.key.toLowerCase(),(counts.get(l.key.toLowerCase())??0)+1);
   return {...base,version:sha(text),
    values:SETTINGS.map(s=>({...s,value:vals.get(s.key.toLowerCase())?.value??null})),
    // Secrets never leave the host: only whether one is set.
    secrets:{'rcon.password':{set:Boolean(vals.get('rcon.password')?.value)}},
    other:[...vals.values()].filter(v=>!BY_KEY.has(v.key.toLowerCase())&&!SECRET_KEYS.has(v.key.toLowerCase())).map(v=>secretish(v.key)?{key:v.key,secret:true}:{key:v.key,value:v.value}),
    duplicates:[...counts].filter(([,n])=>n>1).map(([k])=>vals.get(k).key),
    kept:p.lines.filter(l=>!l.key).length};
  },
  // body: {version, values:{key:value} (curated), reset:[key] (curated, back to the default), other:{key:value},
  // remove:[key] (other values only), rconPassword,
  // adapter:{version, LauncherOnly, Motd}}. Everything is checked before any file changes.
  save(body={}){
   if(!paths)throw err('No game server in host.json',404);
   const set={},remove=[],problems=[];
   const tryDo=f=>{try{f();}catch(e){problems.push(e.message);}};
   for(const [k,v] of Object.entries(body.values??{})){const def=BY_KEY.get(k.toLowerCase());if(!def){problems.push(`${k} is not one of the listed settings`);continue;}tryDo(()=>{set[def.key]=normalize(def,v);});}
   for(const [k,v] of Object.entries(body.other??{}))tryDo(()=>{
    if(!KEY.test(k))throw err(`"${k}" is not a setting name (like section.name)`);
    if(BY_KEY.has(k.toLowerCase()))throw err(`${k} has its own field above`);
    if(secretish(k))throw err(`${k} looks like a secret; it cannot be set here`);
    if(ACTION_KEY.test(k))throw err(`${k} is a command, not a setting`);
    set[k]=cleanText(v,200,k);
   });
   // reset: listed settings back to the server's own default (their lines are removed).
   for(const k of body.reset??[]){const def=typeof k==='string'&&BY_KEY.get(k.toLowerCase());if(def)remove.push(def.key);else problems.push(`${k} is not one of the listed settings`);}
   for(const k of body.remove??[]){if(typeof k!=='string'||!KEY.test(k)||BY_KEY.has(k.toLowerCase())||secretish(k))problems.push(`${k} cannot be removed here`);else remove.push(k);}
   if(body.rconPassword!=null&&body.rconPassword!=='')tryDo(()=>{
    const pw=String(body.rconPassword);
    if(!/^[\x21-\x7e]{12,64}$/.test(pw)||/["\\;]/.test(pw))throw err('The admin password needs 12 to 64 characters: letters, digits and symbols, no spaces, quotes, backslashes or semicolons');
    set['rcon.password']=pw;
   });
   const adapterSet={};
   if(body.adapter)for(const def of ADAPTER_SETTINGS)if(def.key in body.adapter)tryDo(()=>{adapterSet[def.key]=normalize(def,body.adapter[def.key]);});
   if(problems.length)throw err(problems.join('; '),400,{problems});
   const written=[],backups=[];
   if(Object.keys(set).length||remove.length){
    const text=readText(paths.cfgFile)??'';
    if(body.version&&text&&sha(text)!==body.version)throw err('The server\'s cfg file changed since this page loaded it. Reload the page and make your change again',409);
    const next=applyCfg(text,{set,remove});
    if(next!==text){backups.push(writeAtomic(paths.cfgFile,next,{backupDir,now}));written.push(paths.cfgFile);}
   }
   if(Object.keys(adapterSet).length){
    const a=adapterFile();
    if(!a)throw err('Our adapter is not installed on this server, so its settings cannot be saved',409);
    const text=readText(a.file);
    // The adapter writes its own file with the plugin key at first start (or 10-Patch-TestCopy does); a file made here
    // without the key would leave browser joins refused.
    if(text===null)throw err(a.kind==='oxide'?'Start the server once with the plugin so Oxide writes its config, then set these here':'Run 10-Patch-TestCopy.ps1 first: it writes the adapter config with its key',409);
    if(body.adapter.version&&sha(text)!==body.adapter.version)throw err('The adapter config changed since this page loaded it. Reload the page and make your change again',409);
    let next;
    if(a.kind==='vanilla')next=applyKeyValue(text,adapterSet);
    else{const j=JSON.parse(text.replace(/^\ufeff/,''));for(const [k,v] of Object.entries(adapterSet))j[k]=k==='LauncherOnly'?v==='true':v;next=JSON.stringify(j,null,2);}
    if(next!==text){backups.push(writeAtomic(a.file,next,{backupDir,now}));written.push(a.file);}
   }
   const keys=[...Object.keys(set).map(k=>SECRET_KEYS.has(k)?k+' (new value hidden)':k),...remove.map(k=>k+' removed'),...Object.keys(adapterSet).map(k=>'adapter '+k)];
   if(written.length)log(`Owner: server settings saved (${keys.join(', ')}); ${serverState()==='running'?'restart the game server to use them':'used at the next start'}`,'warn');
   const state=serverState();
   return {ok:true,written,backups:backups.filter(Boolean).map(b=>basename(b)),changed:keys,restartNeeded:written.length>0&&(state==='running'||state==='starting')};
  },
 };
 return api;
}
