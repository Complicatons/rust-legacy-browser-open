// Pure pieces of the real-server harnesses (tools/check-native.mjs, tools/soak-bots.mjs): argument parsing, config
// loading/validation (secrets only from env or files), the gameplay matrix (SERVER-TESTING-PLAN.md section 6), row
// filtering, results recording (results.json + results.md) and the gateway frame log the assertions read.
// No browser, network or file-system side effects except writeResults().
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';

// ---- arguments ---------------------------------------------------------------------------------------------------
// --config <file> --mock --dry --list --rows <filter> --out <dir> --bots <n> --duration <s> --behaviours <a,b>
export function parseArgs(argv){
 const o={mock:false,dry:false,list:false,help:false,config:null,rows:null,out:null,bots:null,duration:null,behaviours:null,keep:false,lite:null,stages:null,stageSeconds:null,net:null,inventoryCheck:false,label:null,shots:false};
 const value=(i,name)=>{const v=argv[i+1];if(v===undefined||v.startsWith('--'))throw Error(`${name} needs a value`);return v;};
 for(let i=0;i<argv.length;i++){
  const a=argv[i],[flag,inline]=a.includes('=')?[a.slice(0,a.indexOf('=')),a.slice(a.indexOf('=')+1)]:[a,undefined];
  const take=()=>{if(inline!==undefined)return inline;const v=value(i,flag);i++;return v;};
  switch(flag){
   case '--mock':o.mock=true;break;
   case '--dry':o.dry=true;break;
   case '--list':o.list=true;break;
   case '--keep-open':o.keep=true;break;
   case '-h':case '--help':o.help=true;break;
   case '--config':o.config=take();break;
   case '--rows':o.rows=take();break;
   case '--out':o.out=take();break;
   case '--bots':o.bots=nonNegativeInt(take(),'--bots');break; // 0: lite bots only (tools/soak-bots.mjs --lite)
   case '--duration':o.duration=positiveNumber(take(),'--duration');break;
   case '--behaviours':case '--behaviors':o.behaviours=take().split(',').map(s=>s.trim()).filter(Boolean);break;
   case '--lite':o.lite=nonNegativeInt(take(),'--lite');break;
   case '--stages':o.stages=take().split(',').map(s=>positiveInt(s.trim(),'--stages'));break;
   case '--stage-seconds':o.stageSeconds=positiveNumber(take(),'--stage-seconds');break;
   case '--net':o.net=parseNet(take());break;
   case '--inventory-check':o.inventoryCheck=true;break;
   case '--shots':o.shots=true;break;
   case '--label':o.label=take().replace(/[^\w.-]/g,'').slice(0,40);break;
   default:throw Error(`unknown argument ${a}`);
  }
 }
 return o;
}
function positiveInt(v,name){const n=Number(v);if(!Number.isInteger(n)||n<1)throw Error(`${name} must be a positive integer`);return n;}
function nonNegativeInt(v,name){const n=Number(v);if(!Number.isInteger(n)||n<0)throw Error(`${name} must be a whole number`);return n;}
// --net latency=250,jitter=50,loss=2: added round-trip latency (ms), jitter (± ms on each one-way delay) and the % of
// WebSocket frames that are "lost" (TCP: the frame and everything behind it wait one retransmit, see netShim).
export function parseNet(text){
 const net={latency:0,jitter:0,loss:0};
 for(const part of String(text).split(',').map(s=>s.trim()).filter(Boolean)){
  const [k,v]=part.split('='),n=Number(v);
  if(!(k in net))throw Error(`--net: unknown key ${k} (latency, jitter, loss)`);
  if(!Number.isFinite(n)||n<0||(k==='loss'&&n>50)||n>5000)throw Error(`--net: bad value for ${k}`);
  net[k]=n;
 }
 return net;
}
function positiveNumber(v,name){const n=Number(v);if(!Number.isFinite(n)||n<=0)throw Error(`${name} must be a positive number`);return n;}

// ---- config ------------------------------------------------------------------------------------------------------
// Account: {auth:'password', login, passwordEnv | passwordFile} or {auth:'dev', subject} (dev sign-in, mock/dev central only).
// Bot accounts: {auth, loginPattern:'soak-bot-{n}', passwordEnv | passwordFile} or {auth:'dev', subjectPattern}.
// Secrets never live in the config file: an inline "password"/"rconPassword"/"token" key is rejected.
export const DEFAULTS=Object.freeze({
 walkSeconds:8,modeSeconds:2,replyMs:8000,loadMs:600000,skyWaitMs:60000,airdropWaitMs:90000,gatherRadius:60,adminWaitMs:30000,
 viewport:{width:960,height:600},ignoreHttpsErrors:false,
 soak:{bots:3,durationSeconds:60,behaviours:['walk','gather','chat','reconnect'],chatEverySeconds:20,reconnectEverySeconds:45,sampleSeconds:10,walkSeconds:4},
});
const SECRET_KEYS=new Set(['password','rconPassword','token','metricsToken','secret']);
export function findInlineSecrets(obj,at=''){
 const out=[];if(!obj||typeof obj!=='object')return out;
 for(const [k,v]of Object.entries(obj)){const p=at?`${at}.${k}`:k;if(SECRET_KEYS.has(k)&&v!=null&&v!=='')out.push(p);else if(v&&typeof v==='object')out.push(...findInlineSecrets(v,p));}
 return out;
}
const isUrl=(v,protocols)=>{try{return protocols.includes(new URL(v).protocol);}catch{return false;}};
function checkAccount(a,where,{pattern=false}={}){
 const e=[];if(!a||typeof a!=='object')return [`${where} must be an object`];
 if(a.auth==='dev'){if(!(pattern?a.subjectPattern:a.subject))e.push(`${where}.${pattern?'subjectPattern':'subject'} required for dev sign-in`);}
 else if(a.auth==='password'){
  if(!(pattern?a.loginPattern:a.login))e.push(`${where}.${pattern?'loginPattern':'login'} required`);
  if(pattern&&a.loginPattern&&!a.loginPattern.includes('{n}'))e.push(`${where}.loginPattern must contain {n}`);
  if(!a.passwordEnv&&!a.passwordFile)e.push(`${where}: set passwordEnv or passwordFile (never an inline password)`);
 }else e.push(`${where}.auth must be "password" or "dev"`);
 if(pattern&&a.auth==='dev'&&a.subjectPattern&&!a.subjectPattern.includes('{n}'))e.push(`${where}.subjectPattern must contain {n}`);
 return e;
}
// Returns a list of problems (empty = valid). `mock` relaxes the endpoint fields the mock stack fills in.
export function validateConfig(c,{mock=false,soak=false}={}){
 const e=[];if(!c||typeof c!=='object')return ['config must be an object'];
 for(const p of findInlineSecrets(c))e.push(`${p}: secrets must come from an env var or file (use ${p}Env / ${p}File)`);
 if(!mock){
  if(!isUrl(c.centralUrl,['https:','http:']))e.push('centralUrl must be an http(s) URL (the website origin)');
  if(typeof c.serverId!=='string'||!/^[0-9a-f-]{8,}$/i.test(c.serverId))e.push('serverId must be the server id shown on the website');
  if(c.gameUrl!=null&&!isUrl(c.gameUrl,['https:','http:']))e.push('gameUrl must be an http(s) URL');
  if(c.gameUrl&&isUrl(c.centralUrl,['https:','http:'])&&new URL(c.gameUrl).origin!==new URL(c.centralUrl).origin)e.push('gameUrl must share the website origin (the join ticket is handed over in sessionStorage)');
  if(!soak)e.push(...checkAccount(c.player,'player'));
  // Admin tools rows: a second, plain website account (target) and the in-game name of a desktop client in the VM.
  if(!soak&&c.target!=null){e.push(...checkAccount(c.target,'target'));if(c.target.login&&c.target.login===c.player?.login)e.push('target must be a different account from player');}
  if(soak)e.push(...checkAccount(c.bots?.accounts,'bots.accounts',{pattern:true}));
 }
 if(c.desktop!=null&&!(typeof c.desktop?.name==='string'&&c.desktop.name.trim()&&c.desktop.name.length<=32))e.push('desktop.name must be the desktop character name (1-32 characters)');
 if(c.rconPasswordEnv!=null&&typeof c.rconPasswordEnv!=='string')e.push('rconPasswordEnv must be an env var name');
 if(c.metrics!=null){if(!isUrl(c.metrics.url,['http:','https:']))e.push('metrics.url must be an http(s) URL');if(c.metrics.tokenEnv==null&&c.metrics.tokenFile==null)e.push('metrics: set tokenEnv or tokenFile');}
 for(const k of ['walkSeconds','modeSeconds','replyMs','loadMs','skyWaitMs','airdropWaitMs','gatherRadius','adminWaitMs'])if(c[k]!=null&&!(Number.isFinite(c[k])&&c[k]>0))e.push(`${k} must be a positive number`);
 if(c.soak){const s=c.soak;
  if(s.bots!=null&&!(Number.isInteger(s.bots)&&s.bots>=0&&s.bots<=64))e.push('soak.bots must be an integer 0..64');
  if(s.durationSeconds!=null&&!(s.durationSeconds>0))e.push('soak.durationSeconds must be positive');
  if(s.behaviours!=null&&(!Array.isArray(s.behaviours)||s.behaviours.some(b=>!BEHAVIOURS.includes(b))))e.push(`soak.behaviours must be a subset of ${BEHAVIOURS.join(', ')}`);
 }
 return e;
}
export const BEHAVIOURS=['walk','gather','chat','reconnect'];
export function withDefaults(c={}){return {...DEFAULTS,...c,viewport:{...DEFAULTS.viewport,...c.viewport},soak:{...DEFAULTS.soak,...c.soak}};}
// Reads a secret named by `<key>Env` / `<key>File` on `obj` (e.g. passwordEnv); returns null when neither is set.
export function readSecret(obj,key,{env=process.env,readFile=f=>readFileSync(f,'utf8')}={}){
 if(!obj)return null;
 if(obj[key+'Env']){const v=env[obj[key+'Env']];if(v==null||v==='')throw Error(`environment variable ${obj[key+'Env']} is not set`);return v;}
 if(obj[key+'File'])return String(readFile(obj[key+'File'])).trim();
 return null;
}
// Env overrides so a run needs no file at all: RLB_NATIVE_CENTRAL, RLB_NATIVE_SERVER, RLB_NATIVE_LOGIN (password in
// RLB_NATIVE_PASSWORD), RLB_NATIVE_RCON_PASSWORD (admin rows via rcon.login), RLB_NATIVE_TARGET_LOGIN (password in
// RLB_NATIVE_TARGET_PASSWORD) and RLB_NATIVE_DESKTOP_NAME (Admin tools rows).
export function configFromEnv(env=process.env){
 const c={};
 if(env.RLB_NATIVE_CENTRAL)c.centralUrl=env.RLB_NATIVE_CENTRAL;
 if(env.RLB_NATIVE_SERVER)c.serverId=env.RLB_NATIVE_SERVER;
 if(env.RLB_NATIVE_LOGIN)c.player={auth:'password',login:env.RLB_NATIVE_LOGIN,passwordEnv:'RLB_NATIVE_PASSWORD'};
 if(env.RLB_NATIVE_RCON_PASSWORD)c.rconPasswordEnv='RLB_NATIVE_RCON_PASSWORD';
 if(env.RLB_NATIVE_TARGET_LOGIN)c.target={auth:'password',login:env.RLB_NATIVE_TARGET_LOGIN,passwordEnv:'RLB_NATIVE_TARGET_PASSWORD'};
 if(env.RLB_NATIVE_DESKTOP_NAME)c.desktop={name:env.RLB_NATIVE_DESKTOP_NAME};
 if(env.RLB_NATIVE_IGNORE_HTTPS_ERRORS==='1')c.ignoreHttpsErrors=true;
 return c;
}
export function loadConfig({file=null,env=process.env,readFile=f=>readFileSync(f,'utf8')}={}){
 const fromFile=file?JSON.parse(readFile(file)):{};
 return withDefaults({...fromFile,...configFromEnv(env)});
}
// A copy safe to print or store: env/file references stay, nothing secret is present by construction.
export function redactConfig(c){return JSON.parse(JSON.stringify(c,(k,v)=>SECRET_KEYS.has(k)?'[redacted]':v));}
// Removes secrets from text that will be stored (console lines, captured frames).
export function redactText(text,secrets=[]){let s=String(text);for(const x of secrets)if(x)s=s.split(x).join('[redacted]');return s;}

// ---- the matrix --------------------------------------------------------------------------------------------------
// mock: true = the mock self-test exercises it; 'partial' = only the request/reply half; false = real server only.
// manual: not automated (needs a second client, microphone, packet shaping or a human referee) -> always skip.
// admin: in-game admin rights (rcon.login). site: an admin role on this server on the website (ANTICHEAT-ADMIN-PLAN.md
// slices 3-4: website -> central -> gateway report -> sidecar queue -> the server plugin's 2 s poll -> result back).
// needs: config the row cannot run without (NEEDS below). gives: items an admin run hands out with inv.give; rows marked
// `survival` get by without admin rights the way a fresh player does (Rock on trees for Wood, crafting from it).
// Order matters: rows that end or reset the session (death, rejoin, kicks) come after the rows that need it intact.
export const ROWS=Object.freeze([
 {id:'join.website',system:'Join/spawn',title:'Sign in, website join ticket, gateway approval, server spawn',mock:true},
 {id:'join.inventory',system:'Join/spawn',title:'Initial inventory GNUP: Rock, Bandage, Torch',mock:true},
 {id:'time.sky',system:'Time/sky',title:'CL_UpdateSkyState received and applied',mock:true},
 {id:'time.clock',system:'Time/sky',title:'Server timestamps advance with wall-clock time (clock sync)',mock:true},
 {id:'move.walk',system:'Movement',title:'Walk N seconds: no ReadClientMove corrections or UnstickMove',mock:true},
 {id:'move.modes',system:'Movement',title:'Sprint, crouch, jump: flags sent, no corrections',mock:true},
 {id:'chat.say',system:'Chat/console/voice',title:'chat.say echoed by the server as chat.add',mock:true},
 {id:'console.forward',system:'Chat/console/voice',title:'F1 forwarding: findsv reply (CL_ConsoleMessage)',mock:true},
 {id:'inventory.move',system:'Inventory',title:'Move an item in the inventory UI; server answers with GNUP',mock:true},
 {id:'console.admin',system:'Chat/console/voice',title:'Admin rights: rcon.login (if configured) and status reply',mock:true,admin:true},
 {id:'inventory.give',system:'Inventory',title:'inv.give (admin): GNUP adds the item',mock:true,admin:true},
 {id:'time.env',system:'Time/sky',title:'env.time 12 (admin): sky hour follows the server',mock:true,admin:true},
 {id:'gather.node',system:'Gathering',title:'Walk to a server resource node, swing the Rock, inventory grows',mock:false},
 {id:'gather.tree',system:'Gathering',title:'Swing the Rock at a terrain tree: the server adds Wood (notice.inventory + GNUP)',mock:true},
 {id:'craft.blueprints',system:'Crafting',title:'Craft list is exactly the server\'s ReceiveBoundBPs; unknown blueprints are not offered',mock:true},
 {id:'craft.cancel',system:'Crafting',title:'Craft a Camp Fire (CRFS): CRFU progress, Cancel (CRFX): CRFC and no Wood used',mock:true,survival:'gathers Wood from trees'},
 {id:'craft.finish',system:'Crafting',title:'Craft a Camp Fire to the end: CRFC, Wood consumed and Camp Fire added by GNUP',mock:true,survival:'gathers Wood from trees'},
 {id:'craft.study',system:'Crafting',title:'Study a P250 Blueprint: ReceiveBoundBPs grows, the item is used up, the craft list offers it',mock:true,admin:true,gives:['P250 Blueprint']},
 {id:'build.foundation',system:'Building',title:'Place a Wood Foundation (admin gives it): structure entity created',mock:true,admin:true},
 {id:'build.base',system:'Building',title:'Foundation, 4 pillars, 2 walls, doorway, ceiling and stairs: every piece created on one structure master',mock:true,admin:true,gives:['Wood Foundation','Wood Pillar','Wood Wall','Wood Doorway','Wood Ceiling','Wood Stairs']},
 {id:'build.rules',system:'Building',title:'Placement rules: a wall without pillars and an overlapping foundation are refused',mock:true,admin:true,gives:['Wood Wall','Wood Foundation']},
 {id:'door.use',system:'Doors',title:'Wooden Door on the doorway: open and close (DOo to both players)',mock:true,admin:true,gives:['Wooden Door'],needs:['target']},
 {id:'door.lock',system:'Doors',title:'Owner locks and sets a code; the other player is refused, enters the code, then opens',mock:true,admin:true,needs:['target']},
 {id:'deploy.storage',system:'Deployables',title:'Wood Storage Box: place, store an item (ITMV), reopen, take it back',mock:true,admin:true,gives:['Wood Storage Box']},
 {id:'loot.crate',system:'Loot',title:'Map crate (the server\'s BoxLoot/AmmoLootBox/...): opens on its view (SetLooter + GNUP), an item dragged out arrives (ITMV)',mock:true},
 {id:'door.scene',system:'Doors',title:'Town/monument door (scene MovingDoor, manual view): E asks the server, DOo opens it, a second E closes it',mock:true},
 {id:'deploy.campfire',system:'Deployables',title:'Camp Fire: place, add Wood (and raw meat), ignite; the server burns fuel (Charcoal) and cooks',mock:true,survival:'crafts the Camp Fire from tree Wood; cooks only with meat'},
 {id:'deploy.furnace',system:'Deployables',title:'Furnace: place, add Wood and Metal Ore, ignite; Metal Fragments come out',mock:true,admin:true,gives:['Furnace','Wood','Metal Ore']},
 {id:'raid.charge',system:'Raiding',title:'Explosive Charge on a wall of the base: it explodes and the wall loses health or is destroyed',mock:true,admin:true,gives:['Explosive Charge']},
 {id:'airdrop.drop',system:'Airdrops',title:'airdrop.drop (admin): reply and C130 plane created',mock:'partial',admin:true},
 {id:'wildlife.seen',system:'Wildlife',title:'Server animals created and moving near the player',mock:false},
 {id:'wildlife.hunt',system:'Wildlife',title:'Hunt a server animal with the Rock: it takes damage and dies (ClientDeath), corpse harvested',mock:true},
 {id:'mixed.move',system:'Mixed clients',title:'The other player walks: our drawn copy follows and ends where it stopped; the lag is the interpolation delay',mock:true,needs:['target']},
 {id:'mixed.held',system:'Mixed clients',title:'The other player switches held items (Rock, Torch): our copy holds what it holds',mock:true,needs:['target']},
 {id:'mixed.swing',system:'Mixed clients',title:'The other player swings: our copy plays the attack in step with its drawn body (InterpTimedEvent clock)',mock:true,needs:['target']},
 {id:'mixed.chat',system:'Mixed clients',title:'The other player chats: we get its chat.add line under its name',mock:true,needs:['target']},
 {id:'mixed.death',system:'Mixed clients',title:'The other player dies: its body becomes a ragdoll where it stood, and it comes back as a new character',mock:true,needs:['target']},
 {id:'combat.melee',system:'Combat',title:'Melee the other player: Local_HealthChange from our character, health drops by the weapon damage',mock:true,needs:['target'],survival:'Rock; the target walks over when nobody can teleport'},
 {id:'combat.bow',system:'Combat',title:'Hunting Bow at the other player: arrow fired (Action1B), hit (Action2B), damage arrives',mock:true,admin:true,needs:['target'],gives:['Hunting Bow','Arrow']},
 {id:'combat.gun',system:'Combat',title:'Revolver at the other player: reload, bullets hit, damage and bleeding arrive, ammo goes down',mock:true,admin:true,needs:['target'],gives:['Revolver','9mm Ammo']},
 {id:'combat.armour',system:'Combat',title:'Kevlar on the target: ArmorData sent, the same shots do less damage than without armour',mock:true,admin:true,needs:['target'],gives:['Kevlar Helmet','Kevlar Vest','Kevlar Pants','Kevlar Boots']},
 {id:'combat.death',system:'Combat',title:'Kill the other player: killed-by, loot sack with their items, we loot it, they respawn',mock:true,needs:['target'],survival:'Rock'},
 {id:'move.fall',system:'Movement',title:'Fall from a height: fIm sent, damage, fIo leg injury from the server',mock:true,survival:'walks to a measured cliff near the player when nobody can teleport'},
 // P7 anti-cheat (tools/native/anticheat-rows.mjs): each cheat row makes the page misbehave through harness-only page
 // hooks and reads the gateway's flags back from the website admin API (site role); p7.clean plays normally and wants none.
 {id:'p7.teleport',system:'Anti-cheat',title:'A forged 60 m move is flagged teleport and dropped; a real 15 m jump is flagged speed; walking on afterwards is clean',mock:true,site:true},
 {id:'p7.speed',system:'Anti-cheat',title:'Speedhack: 15 m/s for 4 s, then 25 m/s for 0.6 s: flagged speed (TruthDetector reaction recorded)',mock:true,site:true},
 {id:'p7.fly',system:'Anti-cheat',title:'Fly: rise 5 m and hover 3 s over open terrain: flagged fly and hover',mock:true,site:true},
 {id:'p7.fire-rate',system:'Anti-cheat',title:'Five Rock hits 30 ms apart (fireRate 1.95 s): flagged fire-rate, the extra hits dropped',mock:true,site:true},
 {id:'p7.wall-melee',system:'Anti-cheat',title:'Melee hit on our box through a Wood Barricade: flagged wall-shot (melee)',mock:true,site:true,admin:true,gives:['Wood Barricade','Wood Storage Box']},
 {id:'p7.wall-shot',system:'Anti-cheat',title:'Revolver hit on our box through the barricade: flagged wall-shot (bullet)',mock:true,site:true,admin:true,gives:['Revolver','9mm Ammo']},
 {id:'p7.wall-arrow',system:'Anti-cheat',title:'Arrow through the barricade (wall-shot) and a hit far off the arrow\'s path (arrow-path)',mock:true,site:true,admin:true,gives:['Hunting Bow','Arrow']},
 {id:'p7.wall-use',system:'Anti-cheat',title:'Context use of our box through the barricade: flagged wall-use',mock:true,site:true,admin:true},
 {id:'p7.aim-snap',system:'Anti-cheat',title:'Aim snaps 180° in one move, then a hit: flagged yaw-snap',mock:true,site:true,admin:true},
 {id:'p7.hover-structure',system:'Anti-cheat',title:'Standing on the 3.5 m barricade is not hover; 5 m above it for 3 s is (surface: the barricade)',mock:true,site:true,admin:true},
 {id:'p7.clean',system:'Anti-cheat',title:'3-5 min of normal play (walk, sprint, jumps on slopes, gather, build, wildlife, use a door or the P7 box): zero gateway flags',mock:true,site:true,survival:'skips the build step without admin rights'},
 {id:'deploy.sleepingbag',system:'Deployables',title:'Sleeping Bag: place, die, respawn at camp (RequestRespawn(true)) next to the bag',mock:true,admin:true,gives:['Sleeping Bag']},
 {id:'death.suicide',system:'Death',title:'suicide: death screen, respawn request, new character',mock:true},
 {id:'join.facing',system:'Join/spawn',title:'Respawn looks level along the server spawn rotation (Character.EyesSetup), not the look before death',mock:true},
 {id:'join.sleeper',system:'Join/spawn',title:'Disconnect and rejoin: back at the sleeper position',mock:true},
 {id:'admin.teleport-to',system:'Admin tools',title:'Website Go to: the plugin teleports us to the target (UnstickMove), command done',mock:true,site:true,needs:['target']},
 {id:'admin.bring',system:'Admin tools',title:'Website Bring: the target is teleported to us (UnstickMove), command done',mock:true,site:true,needs:['target']},
 {id:'admin.message',system:'Admin tools',title:'Website Message: the target gets chat.add from "Admin", command done',mock:true,site:true,needs:['target']},
 {id:'admin.report',system:'Admin tools',title:'In-game /report from our linked character: plugin reply, report on the admin page',mock:true,site:true,needs:['target']},
 {id:'admin.desktop-list',system:'Admin tools',title:'Desktop client listed by opaque handle in the Desktop players panel (no SteamIDs)',mock:true,site:true,needs:['desktop']},
 {id:'admin.kick-native',system:'Admin tools',title:'Website Kick on a desktop handle: kick-native done, the player leaves the roster',mock:true,site:true,needs:['desktop']},
 {id:'admin.ban-native',system:'Admin tools',title:'Website ban copied to the game server ban list: ban-native done, target session ends',mock:true,site:true,needs:['target']},
 {id:'admin.unban-native',system:'Admin tools',title:'Website unban: unban-native done, the target joins again',mock:true,site:true,needs:['target']},
 {id:'admin.join-policy',system:'Admin tools',title:'Join policy (720 h minimum account age) refuses the new target account a ticket',mock:true,site:true,needs:['target']},
 {id:'net.loss',system:'Network edge cases',title:'Latency, jitter and a stall on the page\'s gateway socket, then a dropped socket and a rejoin at the sleeper',mock:true},
 {id:'net.kick',system:'Network edge cases',title:'kick self (admin): KP reason shown on disconnect',mock:true,admin:true},
 {id:'voice.clients',system:'Chat/console/voice',title:'Voice clientspeak/voiceplay between browsers',manual:'needs two clients and a microphone'},
 {id:'net.restart',system:'Network edge cases',title:'Original server restarted while browsers are connected',manual:'needs the VM console (the VM session restarts the server)'},
]);
// Filter: comma list; each term is an exact id, a glob (move.*, *.say), a system name (Movement) or "all";
// a leading "-" excludes. Exclusions only: start from all. Unknown terms throw (typos must not silently run nothing).
export function selectRows(rows,filter){
 if(filter==null||String(filter).trim()==='')return [...rows];
 const terms=String(filter).split(',').map(s=>s.trim()).filter(Boolean);
 const match=term=>{
  if(term==='all')return rows;
  if(term.includes('*')){const re=new RegExp('^'+term.split('*').map(s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$');return rows.filter(r=>re.test(r.id));}
  const byId=rows.filter(r=>r.id===term);if(byId.length)return byId;
  const bySystem=rows.filter(r=>r.system.toLowerCase()===term.toLowerCase());if(bySystem.length)return bySystem;
  throw Error(`--rows: unknown row or system "${term}" (try --list)`);
 };
 const include=terms.filter(t=>!t.startsWith('-')),exclude=terms.filter(t=>t.startsWith('-')).map(t=>t.slice(1));
 let chosen=include.length?new Set(include.flatMap(t=>match(t).map(r=>r.id))):new Set(rows.map(r=>r.id));
 for(const t of exclude)for(const r of match(t))chosen.delete(r.id);
 return rows.filter(r=>chosen.has(r.id)); // matrix order, not filter order
}
export const NEEDS=Object.freeze({
 target:'needs a second website account: set "target" (a plain account under 30 days old, no role on the server)',
 desktop:'needs the original desktop client connected inside the VM: set "desktop": {"name": "<in-game name>"}',
});
// Why a row will not run (or null): manual rows, real-only rows in a mock run, rows missing their config.
export function plannedSkip(row,{mock=false,config=null}={}){
 if(row.manual)return 'manual: '+row.manual;
 if(mock&&row.mock===false)return 'real server only: the mock stack does not model this';
 if(config)for(const n of row.needs??[])if(config[n]==null)return NEEDS[n];
 return null;
}

// ---- results -----------------------------------------------------------------------------------------------------
export const STATUS=Object.freeze({pass:'pass',fail:'fail',skip:'skip',error:'error'});
export function createRecorder({run={},now=()=>Date.now()}={}){
 const rows=[],startedAt=now();
 return {
  rows,
  begin(row){const r={id:row.id,system:row.system,title:row.title,status:null,reason:null,startedAt:now(),ms:null,evidence:{}};rows.push(r);return r;},
  finish(r,status,{reason=null,evidence={}}={}){if(!Object.values(STATUS).includes(status))throw Error('bad status '+status);r.status=status;r.reason=reason;r.ms=now()-r.startedAt;Object.assign(r.evidence,evidence);return r;},
  skip(row,reason){const r=this.begin(row);return this.finish(r,'skip',{reason});},
  summary(){const counts={pass:0,fail:0,skip:0,error:0};for(const r of rows)if(r.status)counts[r.status]++;return counts;},
  result(extra={}){return {run:{...run,startedAt:new Date(startedAt).toISOString(),finishedAt:new Date(now()).toISOString(),ms:now()-startedAt},summary:this.summary(),rows,...extra};},
 };
}
export const ok=summary=>summary.fail===0&&summary.error===0;
const cell=v=>String(v??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
function evidenceLine(e){
 const parts=[];for(const [k,v]of Object.entries(e??{})){if(k==='screenshots'||v===undefined)continue;const s=typeof v==='string'?v:JSON.stringify(v);parts.push(`${k}: ${s.length>160?s.slice(0,157)+'...':s}`);}
 return parts.join('; ');
}
export function toMarkdown(result){
 const {run,summary,rows}=result,L=[];
 L.push(`# Native gameplay matrix — ${run.mode??'real'} run`,'');
 L.push(`- Started: ${run.startedAt}, ${(run.ms/1000).toFixed(1)} s`);
 if(run.centralUrl)L.push(`- Central: ${run.centralUrl}, server ${run.serverId??'?'}`);
 if(run.admin!=null)L.push(`- Admin rights: ${run.admin?'yes':'no'}`);
 if(run.graphics)L.push(`- Graphics: ${run.graphics}`);
 L.push(`- Result: **${summary.pass} pass, ${summary.fail} fail, ${summary.error} error, ${summary.skip} skip**`,'');
 L.push('| Row | System | Status | Time | Reason / evidence |','|---|---|---|---|---|');
 for(const r of rows){const why=[r.reason,evidenceLine(r.evidence)].filter(Boolean).join(' — ');L.push(`| \`${r.id}\` | ${cell(r.system)} | ${r.status==='pass'?'pass':`**${r.status}**`} | ${r.ms!=null?(r.ms/1000).toFixed(1)+' s':''} | ${cell(why)} |`);}
 const shots=rows.flatMap(r=>(r.evidence?.screenshots??[]).map(s=>`- \`${r.id}\`: [${s}](${s})`));
 if(shots.length)L.push('','## Screenshots','',...shots);
 if(result.rpcCounts)L.push('','## Server RPCs received (top 40)','',...Object.entries(result.rpcCounts).sort((a,b)=>b[1]-a[1]).slice(0,40).map(([k,v])=>`- ${k}: ${v}`));
 if(result.pageErrors?.length)L.push('','## Page errors','',...result.pageErrors.slice(0,50).map(e=>'- '+cell(e)));
 return L.join('\n')+'\n';
}
export const runStamp=(d=new Date())=>d.toISOString().replace(/[:]/g,'-').replace(/\..+$/,'');
export async function writeResults(dir,result,markdown=toMarkdown(result)){
 await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'results.json'),JSON.stringify(result,null,1));
 await writeFile(path.join(dir,'results.md'),markdown);
 return {json:path.join(dir,'results.json'),md:path.join(dir,'results.md')};
}

// ---- gateway frame log -------------------------------------------------------------------------------------------
// Every WebSocket frame between the page and the gateway (rlb-gateway.v1 JSON, one event per frame), as a player's
// browser sees it. Assertions read only these (what the server sent, translated by the gateway) plus the page's
// read-only state. Large payloads are summarised; bytes ({base64}) are kept only for the few calls rows decode.
const KEEP_BYTES=new Set(['CL_UpdateSkyState','ReceiveBoundBPs','ArmorData']);
export function summariseFrame(json,dir){
 let e;try{e=JSON.parse(json);}catch{return {dir,type:'invalid',bytes:json.length};}
 const f={dir,type:e.type,bytes:json.length};
 if(e.type==='rpc'){f.viewId=e.viewId;f.name=e.name;f.cls=e.args?.class??null;f.serverMs=e.serverMs??null;f.timestampMs=e.timestampMs??null;
  const v=e.args?.values;if(Array.isArray(v)){if(v.every(x=>typeof x!=='object'||x===null||Array.isArray(x)))f.values=v;else if(KEEP_BYTES.has(e.name))f.values=v;else f.values=v.map(x=>x&&typeof x==='object'&&'base64' in x?{bytes:Math.floor(x.base64.length*3/4)}:x);}
  if(Array.isArray(e.args))f.values=e.args;}
 else if(e.type==='create'){Object.assign(f,{viewId:e.viewId,prefab:e.prefab,owner:e.owner,mine:e.mine,position:e.position});if(Number.isInteger(e.group))f.group=e.group;if(e.rotation?.length===4)f.rotation=[...e.rotation];}
 else if(e.type==='destroy'){Object.assign(f,{kind:e.kind,viewId:e.viewId,player:e.player,group:e.group});}
 // uLink ChangeGroup (a NetCull cell change): which view moved to which group.
 else if(e.type==='group-change'){Object.assign(f,{viewId:e.viewId,group:e.group});}
 else if(e.type==='ngc-create'){Object.assign(f,{carrier:e.carrier,innerID:e.innerID,prefab:e.prefab,position:e.position,euler:e.euler});}
 else if(e.type==='ngc-call'){Object.assign(f,{carrier:e.carrier,innerID:e.innerID,name:e.name});if(Array.isArray(e.args)&&e.args.every(x=>typeof x!=='object'||x===null))f.values=e.args;}
 else if(e.type==='ngc-destroy'){Object.assign(f,{carrier:e.carrier,innerID:e.innerID});}
 else if(e.type==='approved'){Object.assign(f,{playerId:e.playerId,world:e.world});}
 else if(e.type==='denied'||e.type==='kicked'||e.type==='disconnected'||e.type==='error'||e.type==='command-rejected'){Object.assign(f,{reason:e.reason??e.error??null});}
 else if(e.type==='move'){Object.assign(f,{origin:e.origin,stateFlags:e.stateFlags,angles:e.angles,at:e.at});}
 else if(e.type==='inventory'){Object.assign(f,{action:e.action,source:e.source});}
 else if(e.type==='item'||e.type==='context'){Object.assign(f,{viewId:e.viewId,action:e.action});if(e.data&&JSON.stringify(e.data).length<600)f.data=e.data;if(e.option!=null)f.option=e.option;}
 return f;
}
// One-shot frames rows look up from the join onward (the spawn's first inventory, own character, approval): kept past
// `keep`. Against the original server a headless world load took ~10 min while ~45 frames/s of world traffic
// (GetNetworkUpdate and the like) arrived, so a plain ring had dropped the spawn GNUP before join.inventory ran.
const PIN_RPCS=new Set(['GNUP','ReceiveBoundBPs']);
const pinned=f=>f.dir==='rx'&&(f.type==='approved'||f.type==='denied'||f.type==='kicked'||(f.type==='create'&&f.mine)||(f.type==='rpc'&&PIN_RPCS.has(f.name)));
const isCorrection=(f,characterView)=>f.dir==='rx'&&f.type==='rpc'&&((f.name==='ReadClientMove'&&f.viewId===characterView)||f.name==='UnstickMove');
// HumanController.GetClientMove answers ReadClientMove to the owner in two cases: TruthDetector put the player back
// (NoteMoved -> Moved: +100 violation; the float is the move's normal transit time) or NetCull.VerifyRPC dropped the
// move as late (RPCVerificationLateException: stamped more than allottedTransitTime, 0.8 s, before the server's lowest
// safe time; no violation at all). LATE_DROP_S tells them apart by that float, with some margin.
export const LATE_DROP_S=1;
export const lateDrop=f=>f.name==='ReadClientMove'&&Number.isFinite(f.values?.[3])&&f.values[3]>=LATE_DROP_S;
export class FrameLog{
 constructor({now=()=>Date.now(),keep=20000,redact=[]}={}){this.now=now;this.keep=keep;this.redact=redact;this.frames=[];this.pins=new WeakSet();this.pinnedCount=0;this.counts={rx:0,tx:0,rxBytes:0,txBytes:0};this.rpcCounts={};this.characterView=null;this.characters=[];this.sockets=[];this.correctionLog=[];this.lastMoves=[];this.moveLog=[];this.moveKeep=12000;this.correctionCount=0;this.truthCorrectionCount=0;}
 add(json,dir){
  const text=this.redact.length?redactText(json,this.redact):json,f=summariseFrame(text,dir);f.t=this.now();
  this.counts[dir]++;this.counts[dir+'Bytes']+=json.length;
  if(dir==='rx'&&f.type==='rpc'){const k=(f.cls?f.cls+'.':'')+f.name;this.rpcCounts[k]=(this.rpcCounts[k]??0)+1;}
  if(dir==='rx'&&f.type==='create'&&f.mine&&f.prefab===':player_soldier'){this.characterView=f.viewId;this.characters.push({viewId:f.viewId,position:f.position,t:f.t});}
  if(dir==='rx'&&f.type==='destroy'&&f.kind==='view'&&f.viewId===this.characterView)this.characterView=null;
  // Every correction as it arrives (corrections() only sees the current character, so a kicked session's were lost).
  if(isCorrection(f,this.characterView)){this.correctionCount++;if(f.name==='ReadClientMove'&&!lateDrop(f))this.truthCorrectionCount++;this.correctionLog.push({t:f.t,name:f.name,origin:f.values?.[0]??null,lateS:f.name==='ReadClientMove'&&Number.isFinite(f.values?.[3])?f.values[3]:null,sent:this.lastMoves.slice()});if(this.correctionLog.length>2000)this.correctionLog.shift();}
  if(dir==='tx'&&f.type==='move'&&f.origin){this.lastMoves.push(f.origin);if(this.lastMoves.length>3)this.lastMoves.shift();}
  // The move stream for an offline TruthDetector replay (tools/replay-truth-trace.mjs): every sent move, our spawns
  // (NoteTeleported), corrections and the disconnect, kept across a kick and the rejoin (same FrameLog).
  const m=dir==='tx'&&f.type==='move'&&f.origin?{t:f.t,...(f.at!=null?{at:f.at}:{}),origin:f.origin}
   :dir==='rx'&&f.type==='create'&&f.mine&&f.prefab===':player_soldier'?{t:f.t,spawn:true,origin:f.position??null,view:f.viewId}
   :isCorrection(f,this.characterView)?{t:f.t,correction:f.name,origin:f.values?.[0]??null,...(Number.isFinite(f.values?.[3])?{lateS:f.values[3]}:{})}
   :dir==='rx'&&(f.type==='kicked'||f.type==='disconnected')?{t:f.t,end:f.type,reason:f.reason??null}:null;
  if(m){this.moveLog.push(m);if(this.moveLog.length>this.moveKeep)this.moveLog.splice(0,this.moveLog.length-this.moveKeep);}
  if(pinned(f)){this.pins.add(f);this.pinnedCount++;}
  this.frames.push(f);
  // Over `keep` unpinned frames: drop the oldest unpinned ones (in batches of keep/10, so adds stay cheap).
  let drop=this.frames.length-this.pinnedCount-this.keep;
  if(drop>Math.max(1,this.keep/10|0)-1)this.frames=this.frames.filter(x=>this.pins.has(x)||drop--<=0);
  return f;
 }
 since(t,pred=()=>true){return this.frames.filter(f=>f.t>=t&&pred(f));}
 rx(t,pred=()=>true){return this.since(t,f=>f.dir==='rx'&&pred(f));}
 tx(t,pred=()=>true){return this.since(t,f=>f.dir==='tx'&&pred(f));}
 // TruthDetector / server authority over our position: ReadClientMove on our own character, or UnstickMove.
 corrections(t){return this.rx(t,f=>isCorrection(f,this.characterView));}
 rpcNames(t){return [...new Set(this.rx(t,f=>f.type==='rpc').map(f=>f.name))];}
 // Resolves with the first matching frame after t (also one already logged), or null after ms.
 async waitFor(t,pred,ms,{poll=50,sleep=d=>new Promise(r=>setTimeout(r,d))}={}){
  const end=this.now()+ms;for(;;){const hit=this.frames.find(f=>f.t>=t&&pred(f));if(hit)return hit;if(this.now()>=end)return null;await sleep(poll);}
 }
}
// Server console text (CL_ConsoleMessage) and broadcast commands (CL_ConsoleCommand) on ConsoleNetworker view 997.
export const consoleMessage=f=>f.dir==='rx'&&f.type==='rpc'&&f.name==='CL_ConsoleMessage'&&typeof f.values?.[0]==='string';
export const consoleCommand=f=>f.dir==='rx'&&f.type==='rpc'&&f.name==='CL_ConsoleCommand'&&typeof f.values?.[0]==='string';

// EnvironmentControlCenter.CL_UpdateSkyState(uLink.BitStream): 38 bytes, see browser/tod.mjs readSkyState.
export function decodeSkyState(value){
 const b64=typeof value==='string'?value:value?.base64;if(typeof b64!=='string')return null;
 const buf=Buffer.from(b64,'base64');if(buf.length!==38)return null;
 const f=o=>buf.readFloatLE(o);
 return {daylength:f(0),nightlength:f(4),moonPhase:f(8),year:buf.readInt32LE(28),month:buf[32],day:buf[33],hour:f(34)};
}
// Server clock progression from rpc frames carrying serverMs: slope of server time against local receive time.
export function clockDrift(frames){
 const s=frames.filter(f=>Number.isFinite(f.serverMs)&&Number.isFinite(f.t));
 if(s.length<2)return null;const a=s[0],b=s.at(-1),local=b.t-a.t,server=b.serverMs-a.serverMs;
 if(local<=0)return null;return {samples:s.length,localMs:local,serverMs:server,ratio:server/local};
}

// ---- small numeric helpers (soak stats) ----------------------------------------------------------------------------
export function percentile(values,p){const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return null;const i=Math.min(v.length-1,Math.max(0,Math.ceil(p/100*v.length)-1));return v[i];}
export function describe(values){const v=values.filter(Number.isFinite);if(!v.length)return {n:0};const sum=v.reduce((a,b)=>a+b,0);return {n:v.length,min:Math.min(...v),p50:percentile(v,50),p95:percentile(v,95),max:Math.max(...v),mean:sum/v.length};}
// Linear slope (units per second) of [t ms, value] samples; null for fewer than two points.
export function slopePerSecond(points){
 const p=points.filter(([t,v])=>Number.isFinite(t)&&Number.isFinite(v));if(p.length<2)return null;
 const n=p.length,mt=p.reduce((a,[t])=>a+t,0)/n,mv=p.reduce((a,[,v])=>a+v,0)/n;
 let num=0,den=0;for(const [t,v]of p){num+=(t-mt)*(v-mv);den+=(t-mt)**2;}return den?num/den*1000:null;
}
// Prometheus text exposition -> {name{labels}: value}; comments and malformed lines are ignored.
export function parsePrometheus(text){
 const out={};for(const line of String(text).split('\n')){const s=line.trim();if(!s||s.startsWith('#'))continue;const m=/^([a-zA-Z_:][\w:]*(?:\{[^}]*\})?)\s+(-?[\d.eE+-]+|NaN|\+Inf|-Inf)/.exec(s);if(m)out[m[1]]=Number(m[2]);}
 return out;
}
