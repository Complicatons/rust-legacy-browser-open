// One-shot setup for the Rust Legacy Browser Discord server. Reads tools/discord-layout.json (roles, categories,
// channels, forum tags, AutoMod, Onboarding, starter posts) and creates or updates everything by name through the
// Discord REST API, so running it again only changes what differs. Dry run unless --apply.
//   set DISCORD_BOT_TOKEN in your environment, then: node tools/discord-setup.mjs --guild <server id> [--apply]
//   node tools/discord-setup.mjs --access   prints who can see and post in every channel (no token needed)
// The bot needs Administrator while it runs; take it away afterwards. The layout's checklist (owner-only settings and
// other bots) is printed at the end. Channels and roles that are not in the layout are listed and left alone. A step
// Discord refuses (a built-in AutoMod rule, Onboarding) becomes a warning so the rest of the run still happens.
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const REASON='Rust Legacy Browser server setup script';
const API='https://discord.com/api/v10';

// Bit numbers from https://discord.com/developers/docs/topics/permissions
export const PERMISSIONS={CREATE_INSTANT_INVITE:0,KICK_MEMBERS:1,BAN_MEMBERS:2,ADMINISTRATOR:3,MANAGE_CHANNELS:4,MANAGE_GUILD:5,
 ADD_REACTIONS:6,VIEW_AUDIT_LOG:7,PRIORITY_SPEAKER:8,STREAM:9,VIEW_CHANNEL:10,SEND_MESSAGES:11,SEND_TTS_MESSAGES:12,
 MANAGE_MESSAGES:13,EMBED_LINKS:14,ATTACH_FILES:15,READ_MESSAGE_HISTORY:16,MENTION_EVERYONE:17,USE_EXTERNAL_EMOJIS:18,
 VIEW_GUILD_INSIGHTS:19,CONNECT:20,SPEAK:21,MUTE_MEMBERS:22,DEAFEN_MEMBERS:23,MOVE_MEMBERS:24,USE_VAD:25,CHANGE_NICKNAME:26,
 MANAGE_NICKNAMES:27,MANAGE_ROLES:28,MANAGE_WEBHOOKS:29,MANAGE_GUILD_EXPRESSIONS:30,USE_APPLICATION_COMMANDS:31,
 REQUEST_TO_SPEAK:32,MANAGE_EVENTS:33,MANAGE_THREADS:34,CREATE_PUBLIC_THREADS:35,CREATE_PRIVATE_THREADS:36,
 USE_EXTERNAL_STICKERS:37,SEND_MESSAGES_IN_THREADS:38,USE_EMBEDDED_ACTIVITIES:39,MODERATE_MEMBERS:40,
 VIEW_CREATOR_MONETIZATION_ANALYTICS:41,USE_SOUNDBOARD:42,CREATE_GUILD_EXPRESSIONS:43,CREATE_EVENTS:44,USE_EXTERNAL_SOUNDS:45,
 SEND_VOICE_MESSAGES:46,SEND_POLLS:49,USE_EXTERNAL_APPS:50};
export const CHANNEL_TYPES={text:0,voice:2,category:4,announcement:5,stage:13,forum:15};
const TEXT_LIKE=new Set([0,5,15]);
const COMMUNITY_ONLY=new Set(['announcement','forum']); // Discord refuses these until Community is on
const REQUIRE_TAG=1<<4;
const TRIGGERS={keyword:1,spam:3,keyword_preset:4,mention_spam:5};
const ONE_PER_SERVER=new Set([3,4,5]);
const PRESETS={PROFANITY:1,SEXUAL_CONTENT:2,SLURS:3};
const EPOCH=1420070400000n;
const norm=s=>String(s??'').toLowerCase();
const byId=(a,b)=>a.length-b.length||(a<b?-1:a>b?1:0);
let seq=0n;
export const snowflake=(now=Date.now())=>String(((BigInt(now)-EPOCH)<<22n)|(seq++&4095n));

export function permissionBits(names=[]){
 let bits=0n;
 for(const n of names){if(!(n in PERMISSIONS))throw new Error(`unknown permission ${n}`);bits|=1n<<BigInt(PERMISSIONS[n]);}
 return bits;
}

// Layout overwrites are [{role:'Name'|['A','B'],allow:[…],deny:[…]}]; later entries win per bit.
function layer(map,role,allow,deny){const cur=map.get(role)??{allow:0n,deny:0n};map.set(role,{allow:(cur.allow&~deny)|allow,deny:(cur.deny&~allow)|deny});}
export function expandOverwrites(list=[]){
 const out=new Map();
 for(const o of list)for(const role of [].concat(o.role))layer(out,role,permissionBits(o.allow),permissionBits(o.deny));
 return out;
}
// A channel starts from its category's overwrites and its own entries are layered on top.
export function mergeOverwrites(base,extra){const out=new Map(base);for(const [role,{allow,deny}] of extra)layer(out,role,allow,deny);return out;}
export function overwritesToApi(map,ids){
 const out=[];
 for(const [role,{allow,deny}] of map){const id=ids.get(role);if(id===undefined)throw new Error(`unknown role ${role}`);if(id===null)continue; // not created yet (Server Booster)
  if(allow||deny)out.push({id,type:0,allow:String(allow),deny:String(deny)});}
 return out.sort((a,b)=>byId(a.id,b.id));
}
const overwriteKey=list=>(list??[]).map(o=>`${o.id}:${o.type}:${o.allow}:${o.deny}`).sort().join('|');
const tagKey=list=>(list??[]).map(t=>`${t.name}:${!!t.moderated}:${t.emoji_name??''}`).join('|');

// True when every field in `want` matches `have` (extra fields in `have` are ignored; arrays of ids compare as sets).
export function subsetEqual(want,have){
 if(Array.isArray(want)){
  if(!Array.isArray(have)||have.length!==want.length)return false;
  if(want.every(v=>v===null||typeof v!=='object'))return [...want].map(String).sort().join('\0')===[...have].map(String).sort().join('\0');
  return want.every((v,i)=>subsetEqual(v,have[i]));
 }
 if(want&&typeof want==='object')return !!have&&typeof have==='object'&&Object.keys(want).every(k=>subsetEqual(want[k],have[k]));
 return String(want??'')===String(have??'');
}

// New roles land at the bottom; this moves the layout's roles (top-first) to just below the setup bot's highest role.
// Other bots' roles (managed) go above them so a verification bot (Captcha.bot, Wick) can still hand out Member; every
// other role goes below them in its current order. `under` maps a role id to the bot role it must sit directly under
// (Wick needs its Quarantine role right below its own). Returns null when the order is already right.
export function rolePositions(guildRoles,wantedIds,botTop,under=new Map()){
 const below=guildRoles.filter(r=>r.position>0&&r.position<botTop).sort((a,b)=>b.position-a.position||byId(a.id,b.id));
 const wanted=new Set(wantedIds);
 const order=[...below.filter(r=>r.managed&&!wanted.has(r.id)),...wantedIds.map(id=>below.find(r=>r.id===id)).filter(Boolean),...below.filter(r=>!r.managed&&!wanted.has(r.id))];
 for(const [id,botId] of under){
  const role=order.find(r=>r.id===id);if(!role||!order.some(r=>r.id===botId))continue;
  order.splice(order.indexOf(role),1);order.splice(order.findIndex(r=>r.id===botId)+1,0,role);
 }
 if(order.map(r=>r.id).join()===below.map(r=>r.id).join())return null;
 return order.map((r,i)=>({id:r.id,position:order.length-i}));
}

const channelsOf=layout=>layout.categories.flatMap(cat=>cat.channels.map(ch=>({cat,ch})));
const postsOf=ch=>[].concat(ch.messages??ch.message??[]);
// Discord's permission order for a member holding `roleNames`: base role permissions, then the @everyone overwrite,
// then all of the member's role overwrites together (an allow on any of their roles beats a deny on another).
export function can(layout,roleNames,channelName,perms){
 const found=channelsOf(layout).find(({ch})=>ch.name===channelName);if(!found)return false;
 const ow=mergeOverwrites(expandOverwrites(found.cat.overwrites),expandOverwrites(found.ch.overwrites));
 let eff=roleNames.reduce((b,n)=>b|permissionBits(layout.roles.find(r=>r.name===n)?.permissions),permissionBits(layout.everyone.permissions));
 const everyone=ow.get('@everyone')??{allow:0n,deny:0n};eff=(eff&~everyone.deny)|everyone.allow;
 let allow=0n,deny=0n;for(const n of roleNames){const o=ow.get(n);if(o){allow|=o.allow;deny|=o.deny;}}
 eff=(eff&~deny)|allow;
 const want=permissionBits(perms);return (eff&want)===want;
}
export const everyoneCan=(layout,channelName,perms)=>can(layout,[],channelName,perms);

// Who can see / post where, for the people described in layout.audiences ({name, roles}). Voice channels show join/talk.
export function accessTable(layout){
 const audiences=layout.audiences??[{name:'@everyone',roles:[]}];
 const rows=[];
 for(const cat of layout.categories){
  rows.push({category:cat.name});
  for(const ch of cat.channels){
   const voice=ch.type==='voice';
   rows.push({channel:voice?`🔊 ${ch.name}`:`#${ch.name}`,cells:audiences.map(a=>
    !can(layout,a.roles,ch.name,['VIEW_CHANNEL'])?'—':can(layout,a.roles,ch.name,voice?['CONNECT','SPEAK']:['SEND_MESSAGES'])?(voice?'talk':'post'):(voice?'see':'read'))});
  }
 }
 const width=Math.max(...rows.map(r=>(r.channel??'').length))+2,col=Math.max(5,...audiences.map(a=>a.name.length))+2;
 const lines=[' '.repeat(width)+audiences.map(a=>a.name.padEnd(col)).join('')];
 for(const r of rows)lines.push(r.category?`\n${r.category}`:r.channel.padEnd(width)+r.cells.map(c=>c.padEnd(col)).join(''));
 return lines.join('\n');
}

export function validateLayout(layout){
 const problems=[],roles=new Set(['@everyone',...layout.roles.map(r=>r.name)]),channels=new Set(),kinds=new Set();
 const bits=(names,where)=>{try{return permissionBits(names);}catch(e){problems.push(`${where}: ${e.message}`);return 0n;}};
 const role=(name,where)=>{if(!roles.has(name))problems.push(`${where}: unknown role ${name}`);};
 const external=new Set(layout.roles.filter(r=>r.external).map(r=>r.name));
 const overwrites=(list,where)=>{for(const o of list??[]){for(const r of [].concat(o.role)){role(r,where);if(external.has(r))problems.push(`${where}: ${r} belongs to another bot; leave its channel permissions to that bot`);}bits(o.allow,where);bits(o.deny,where);}};
 if(roles.size!==layout.roles.length+1)problems.push('duplicate role names');
 for(const r of layout.roles){
  if(bits(r.permissions,`role ${r.name}`)&permissionBits(['ADMINISTRATOR']))problems.push(`role ${r.name}: never give a role ADMINISTRATOR`);
  if(r.color&&!/^#[0-9a-f]{6}$/i.test(r.color))problems.push(`role ${r.name}: colour must look like #ce422b`);
 }
 const everyone=bits(layout.everyone.permissions,'@everyone');
 for(const p of ['ADMINISTRATOR','MANAGE_GUILD','MANAGE_ROLES','MANAGE_CHANNELS','KICK_MEMBERS','BAN_MEMBERS','MANAGE_MESSAGES','MENTION_EVERYONE','CREATE_INSTANT_INVITE','USE_EXTERNAL_APPS'])
  if(everyone&permissionBits([p]))problems.push(`@everyone must not have ${p}`);
 for(const cat of layout.categories){
  overwrites(cat.overwrites,`category ${cat.name}`);
  for(const ch of cat.channels){
   const type=CHANNEL_TYPES[ch.type],where=`channel ${ch.name}`;
   if(type===undefined||type===4)problems.push(`${where}: unknown type ${ch.type}`);
   const kind=`${TEXT_LIKE.has(type)?'text':type}:${norm(ch.name)}`;
   if(kinds.has(kind))problems.push(`${where}: duplicate name`);
   kinds.add(kind);
   if(TEXT_LIKE.has(type)&&!/^[a-z0-9_-]{1,100}$/.test(ch.name))problems.push(`${where}: text channel names are lowercase with dashes`);
   if(ch.tags&&type!==15)problems.push(`${where}: only forums have tags`);
   if((ch.tags?.length??0)>20||ch.tags?.some(t=>t.name.length>20))problems.push(`${where}: at most 20 tags of up to 20 characters`);
   if(postsOf(ch).length&&type!==0&&type!==5)problems.push(`${where}: starter messages go in text or announcement channels`);
   if(postsOf(ch).some(m=>m.length>1900))problems.push(`${where}: a starter message is too long for Discord`);
   overwrites(ch.overwrites,where);
   channels.add(ch.name);
  }
 }
 const channel=(name,where)=>{if(!channels.has(name))problems.push(`${where}: unknown channel ${name}`);};
 for(const {ch} of channelsOf(layout))for(const text of postsOf(ch))for(const [,name] of text.matchAll(/\{#([^}]+)\}/g))channel(name,`message in ${ch.name}`);
 for(const [k,name] of Object.entries(layout.channelSettings??{}))channel(name,`channelSettings.${k}`);
 const screen=layout.welcomeScreen;
 if(screen){
  if(screen.channels.length>5)problems.push('welcome screen: at most 5 channels');
  if((screen.description??'').length>140)problems.push('welcome screen: description over 140 characters');
  for(const c of screen.channels){channel(c.channel,'welcome screen');if(c.description.length>42)problems.push(`welcome screen: ${c.channel} description over 42 characters`);if(channels.has(c.channel)&&!everyoneCan(layout,c.channel,['VIEW_CHANNEL']))problems.push(`welcome screen: new people can't see #${c.channel}`);}
 }
 for(const r of layout.retiredRoles??[])if(roles.has(r))problems.push(`retiredRoles: ${r} is still in the layout`);
 if(layout.community){channel(layout.community.rulesChannel,'community');channel(layout.community.updatesChannel,'community');}
 for(const rule of layout.automod??[]){
  const where=`AutoMod rule ${rule.name}`;
  if(!(rule.trigger in TRIGGERS))problems.push(`${where}: unknown trigger ${rule.trigger}`);
  if(rule.alert)channel(rule.alert,where);
  for(const r of rule.exemptRoles??[])role(r,where);
  for(const p of rule.metadata?.presets??[])if(!(p in PRESETS))problems.push(`${where}: unknown preset ${p}`);
  if(rule.timeout&&!['keyword','mention_spam'].includes(rule.trigger))problems.push(`${where}: Discord only allows timeouts on keyword and mention rules`);
 }
 if(layout.checklist&&!(Array.isArray(layout.checklist)&&layout.checklist.every(x=>typeof x==='string')))problems.push('checklist must be a list of strings');
 for(const a of layout.audiences??[])for(const r of a.roles)role(r,`audience ${a.name}`);
 if(layout.botsRole)role(layout.botsRole,'botsRole');
 if((layout.automod??[]).filter(r=>r.trigger==='keyword').length>6)problems.push('AutoMod allows at most 6 keyword rules');
 if(layout.onboarding){
  const defaults=layout.onboarding.defaultChannels;
  for(const n of defaults)channel(n,'onboarding');
  if(defaults.length<7)problems.push('onboarding: Discord needs at least 7 default channels');
  if(defaults.filter(n=>everyoneCan(layout,n,['VIEW_CHANNEL','SEND_MESSAGES'])).length<5)problems.push('onboarding: at least 5 default channels must let @everyone post');
  for(const p of layout.onboarding.prompts)for(const o of p.options){for(const r of o.roles??[])role(r,`onboarding option ${o.title}`);for(const c of o.channels??[])channel(c,`onboarding option ${o.title}`);}
 }
 return problems;
}

const onboardingKey=x=>JSON.stringify({enabled:!!x.enabled,mode:x.mode??0,channels:[...x.default_channel_ids??[]].sort(),
 prompts:(x.prompts??[]).map(p=>({title:p.title,type:p.type,single:!!p.single_select,required:!!p.required,
  options:(p.options??[]).map(o=>({title:o.title,description:o.description??'',emoji:o.emoji?.name||o.emoji_name||null,roles:[...o.role_ids??[]].sort(),channels:[...o.channel_ids??[]].sort()}))}))});

export function discordClient(token,{fetchImpl=fetch}={}){
 return async function api(method,path,body,reason){
  for(let attempt=0;;attempt++){
   const headers={Authorization:`Bot ${token}`,'User-Agent':'DiscordBot (rust-legacy-browser-setup, 1.0)'};
   if(body!==undefined)headers['Content-Type']='application/json';
   if(reason)headers['X-Audit-Log-Reason']=encodeURIComponent(reason);
   const res=await fetchImpl(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
   if(res.status===429&&attempt<5){const wait=(await res.json().catch(()=>({}))).retry_after??1;await new Promise(r=>setTimeout(r,Math.ceil(wait*1000)+100));continue;}
   const text=res.status===204?'':await res.text();
   let data=null;try{data=text?JSON.parse(text):null;}catch{data={message:text};}
   if(!res.ok){const e=new Error(`${method} ${path.split('?')[0]} failed: ${res.status} ${data?.message??''}${data?.errors?' '+JSON.stringify(data.errors):''}`);e.status=res.status;throw e;}
   return data;
  }
 };
}

export async function run({api,guildId,layout,apply=false,log=console.log}){
 const problems=validateLayout(layout);
 if(problems.length)throw new Error('The layout has problems:\n  '+problems.join('\n  '));
 const changes=[],warnings=[];
 const act=async(what,fn)=>{changes.push(what);log(`${apply?'':'would '}${what}`);return apply?fn():null;};
 const warn=m=>{warnings.push(m);log(`warning: ${m}`);};
 const G=`/guilds/${guildId}`;
 const me=await api('GET','/users/@me');
 const guild=await api('GET',G);
 let roles=await api('GET',`${G}/roles`);
 const member=await api('GET',`${G}/members/${me.id}`);
 const topOf=list=>Math.max(0,...list.filter(r=>member.roles.includes(r.id)).map(r=>r.position));
 const botPerms=roles.filter(r=>r.id===guildId||member.roles.includes(r.id)).reduce((b,r)=>b|BigInt(r.permissions),0n);
 if(!(botPerms&permissionBits(['ADMINISTRATOR'])))throw new Error('The bot needs Administrator while the setup runs (Server Settings → Roles → the bot\'s role).');

 // Roles
 const ids=new Map([['@everyone',guildId]]);
 const everyonePerms=String(permissionBits(layout.everyone.permissions));
 if(roles.find(r=>r.id===guildId).permissions!==everyonePerms)await act('set @everyone permissions',()=>api('PATCH',`${G}/roles/${guildId}`,{permissions:everyonePerms},REASON));
 let botTop=topOf(roles);
 for(const r of layout.roles){
  // A role another bot creates and configures (Wick's Quarantine): only kept in place in the order, never edited.
  if(r.external){
   const have=roles.find(x=>!x.managed&&x.name===r.name);ids.set(r.name,have?.id??null);
   if(!have)warn(`no ${r.name} role yet: ${r.external} creates it during its setup; run this again after that to keep it under the bots`);
   continue;
  }
  const want={name:r.name,permissions:String(permissionBits(r.permissions)),color:r.color?parseInt(r.color.slice(1),16):0,hoist:!!r.hoist,mentionable:!!r.mentionable};
  // Discord makes the Server Booster role itself at the first boost; the layout only styles it.
  const have=r.booster?roles.find(x=>x.tags&&'premium_subscriber' in x.tags):roles.find(x=>!x.managed&&x.name===r.name);
  if(!have&&r.booster){ids.set(r.name,null);warn(`Discord creates the ${r.name} role at your first boost; run this again after that to colour it and open its channels`);continue;}
  if(!have){const made=await act(`create role ${r.name}`,()=>api('POST',`${G}/roles`,want,REASON));ids.set(r.name,made?.id??`new:${r.name}`);continue;}
  ids.set(r.name,have.id);
  const diff=Object.keys(want).filter(k=>String(have[k])!==String(want[k]));
  if(!diff.length)continue;
  if(have.position>=botTop){warn(`role ${r.name} is above the bot's role, so it can't be changed: drag the bot's role to the top and run again`);continue;}
  await act(`update role ${r.name} (${diff.join(', ')})`,()=>api('PATCH',`${G}/roles/${have.id}`,want,REASON));
 }
 // Roles the layout no longer wants (the old booster colour picker). Bot-managed roles are never touched.
 for(const name of layout.retiredRoles??[]){
  const old=roles.find(r=>!r.managed&&r.name===name);
  if(old&&old.position<botTop)await act(`delete role ${name}`,()=>api('DELETE',`${G}/roles/${old.id}`,undefined,REASON));
 }
 if(apply){roles=await api('GET',`${G}/roles`);botTop=topOf(roles);}
 const newRoles=[...ids.values()].some(id=>id?.startsWith('new:'));
 const under=new Map(layout.roles.filter(r=>r.external&&ids.get(r.name)).flatMap(r=>{const bot=roles.find(x=>x.managed&&x.name===r.external);return bot?[[ids.get(r.name),bot.id]]:[];}));
 const positions=rolePositions(roles,layout.roles.map(r=>ids.get(r.name)),botTop,under);
 if(positions||newRoles)await act('put roles in layout order',()=>positions&&api('PATCH',`${G}/roles`,positions,REASON));
 for(const r of layout.roles){const have=roles.find(x=>x.id===ids.get(r.name));if(have&&have.position>=botTop)warn(`role ${r.name} is above the bot's role and was not moved`);}

 // Other bots get the layout's bots role, or they can't see the members-only channels.
 if(layout.botsRole){
  const botsRoleId=ids.get(layout.botsRole);
  for(const r of roles.filter(r=>r.managed&&r.tags?.bot_id&&r.tags.bot_id!==me.id)){
   const bot=await api('GET',`${G}/members/${r.tags.bot_id}`).catch(()=>null);
   if(bot&&!bot.roles.includes(botsRoleId))await act(`give ${bot.user?.username??r.name} the ${layout.botsRole} role`,()=>api('PUT',`${G}/members/${r.tags.bot_id}/roles/${botsRoleId}`,undefined,REASON));
  }
 }

 // Server settings
 const settings={};
 // The server description only exists once Community is on, so a first run sets it after turning Community on.
 for(const [k,v] of Object.entries(layout.settings??{}))if(guild[k]!==v&&(k!=='description'||guild.features.includes('COMMUNITY')))settings[k]=v;
 if(Object.keys(settings).length)await act(`update server settings (${Object.keys(settings).join(', ')})`,()=>api('PATCH',G,settings,REASON));

 // Channels: categories first, then normal channels, then Community, then announcement and forum channels.
 let channels=await api('GET',`${G}/channels`);
 const ownRoleIds=new Set([guildId,...layout.roles.filter(r=>!r.external).map(r=>ids.get(r.name)).filter(Boolean)]);
 let community=guild.features.includes('COMMUNITY');
 const claimed=new Set(),catIds=new Map(),chanIds=new Map();
 const ensure=async(spec,parentId,over)=>{
  const type=COMMUNITY_ONLY.has(spec.type)&&!community?0:CHANNEL_TYPES[spec.type];
  const label=type===4?`category ${spec.name}`:type===2?`voice channel ${spec.name}`:`#${spec.name}`;
  // oldNames lets a rename in the layout rename the existing channel instead of creating a second one.
  const names=[spec.name,...(spec.oldNames??[])].map(norm);
  const fits=c=>!claimed.has(c.id)&&names.includes(norm(c.name))&&(c.type===type||(c.type!==15&&type!==15&&TEXT_LIKE.has(c.type)&&TEXT_LIKE.has(type)));
  // Prefer a match already in the right category; otherwise adopt one from elsewhere (Discord's default #general).
  let have=channels.filter(fits).sort((a,b)=>(b.parent_id===parentId)-(a.parent_id===parentId))[0];
  // Overwrites for roles the layout doesn't manage (Wick's Quarantine, a ticket bot's roles, single members) are kept.
  const foreign=(have?.permission_overwrites??[]).filter(o=>!(o.type===0&&ownRoleIds.has(o.id)));
  const body={name:spec.name,type,permission_overwrites:[...overwritesToApi(over,ids),...foreign]};
  if(type!==4)body.parent_id=parentId;
  if(TEXT_LIKE.has(type))body.topic=spec.topic??'';
  if(type===0||type===15)body.rate_limit_per_user=spec.slowmode??0;
  if(type===2)body.user_limit=spec.userLimit??0;
  if(type===15)body.available_tags=(spec.tags??[]).map(t=>{const old=have?.available_tags?.find(x=>x.name===t.name);return {...(old?{id:old.id}:{}),name:t.name,moderated:!!t.moderated,emoji_name:t.emoji??null};});
  if(!have){
   const made=await act(`create ${label}`,()=>api('POST',`${G}/channels`,body,REASON));
   if(!made)return `new:${spec.name}`;
   channels.push(made);have=made;
  }
  claimed.add(have.id);
  const diff=[];
  if(have.name!==spec.name)diff.push('name');
  if(have.type!==type)diff.push('type');
  if(type!==4&&(have.parent_id??null)!==parentId)diff.push('category');
  if(overwriteKey(have.permission_overwrites)!==overwriteKey(body.permission_overwrites))diff.push('permissions');
  if('topic' in body&&(have.topic??'')!==body.topic)diff.push('topic');
  if('rate_limit_per_user' in body&&(have.rate_limit_per_user??0)!==body.rate_limit_per_user)diff.push('slowmode');
  if('user_limit' in body&&(have.user_limit??0)!==body.user_limit)diff.push('user limit');
  if(body.available_tags&&tagKey(have.available_tags)!==tagKey(body.available_tags))diff.push('tags');
  if(type===15&&((have.flags??0)&REQUIRE_TAG)!==(spec.requireTag?REQUIRE_TAG:0)){diff.push('require tag');body.flags=((have.flags??0)&~REQUIRE_TAG)|(spec.requireTag?REQUIRE_TAG:0);}
  if(diff.length){
   if(have.type===type)delete body.type;
   const updated=await act(`update ${label} (${diff.join(', ')})`,()=>api('PATCH',`/channels/${have.id}`,body,REASON));
   if(updated)channels[channels.indexOf(have)]=updated;
  }
  return have.id;
 };
 const plan=layout.categories.map(cat=>({cat,over:expandOverwrites(cat.overwrites)}));
 for(const {cat,over} of plan)catIds.set(cat.name,await ensure({name:cat.name,type:'category'},null,over));
 const pass=async late=>{
  for(const {cat,over} of plan)for(const ch of cat.channels)if(COMMUNITY_ONLY.has(ch.type)===late)
   chanIds.set(ch.name,await ensure(ch,catIds.get(cat.name),mergeOverwrites(over,expandOverwrites(ch.overwrites))));
 };
 await pass(false);
 if(layout.community){
  const want={rules_channel_id:chanIds.get(layout.community.rulesChannel),public_updates_channel_id:chanIds.get(layout.community.updatesChannel)};
  if(!community){
   const body={...want,features:[...new Set([...guild.features,'COMMUNITY'])],verification_level:Math.max(1,layout.settings?.verification_level??1),explicit_content_filter:2};
   try{await act(`turn on Community (rules in #${layout.community.rulesChannel}, Discord notices in #${layout.community.updatesChannel})`,()=>api('PATCH',G,body,REASON));community=true;}
   catch(e){warn(`couldn't turn on Community (${e.message}). Announcement and forum channels were made as text channels; turn Community on in Server Settings, then run this again`);}
  }else if(!subsetEqual(want,guild))await act('point Community at the rules and notices channels',()=>api('PATCH',G,want,REASON));
 }
 await pass(true);

 // Guild settings that point at channels: join messages in #welcome, the AFK channel, Discord's safety alerts.
 const channelSettings={};
 for(const [k,name] of Object.entries(layout.channelSettings??{})){const id=chanIds.get(name);if(id&&guild[k]!==id&&(community||k!=='safety_alerts_channel_id'))channelSettings[k]=id;}
 if(community&&!guild.features.includes('COMMUNITY')&&layout.settings?.description!==undefined)channelSettings.description=layout.settings.description;
 if(Object.keys(channelSettings).length)await act(`point server settings at channels (${Object.keys(channelSettings).join(', ')})`,()=>api('PATCH',G,channelSettings,REASON));

 // Order: categories, then channels inside each category.
 if(apply)channels=await api('GET',`${G}/channels`);
 const present=new Map(channels.map(c=>[c.id,c]));
 const order=[];let reorder=false;
 for(const list of [plan.map(p=>catIds.get(p.cat.name)),...plan.map(p=>p.cat.channels.map(ch=>chanIds.get(ch.name)))]){
  const real=list.filter(id=>present.has(id));
  if(real.length!==list.length)reorder=true;
  const current=[...real].sort((a,b)=>present.get(a).position-present.get(b).position||byId(a,b));
  if(current.join()!==real.join())reorder=true;
  real.forEach((id,position)=>order.push({id,position}));
 }
 if(reorder)await act('put channels in layout order',()=>api('PATCH',`${G}/channels`,order,REASON));

 // Starter posts (rules, welcome, FAQ…), kept up to date by editing the bot's own messages, oldest first. after=0
 // reads from the start of the channel, so join messages piling up in #welcome don't hide them.
 const fill=text=>text.replace(/\{#([^}]+)\}/g,(_,n)=>`<#${chanIds.get(n)}>`);
 for(const {ch} of channelsOf(layout)){
  const posts=postsOf(ch);if(!posts.length)continue;
  const id=chanIds.get(ch.name),label=posts.length>1?'starter messages':'starter message';
  if(id.startsWith('new:')){await act(`post the ${label} in #${ch.name}`,()=>null);continue;}
  const mine=(await api('GET',`/channels/${id}/messages?after=0&limit=100`)).filter(m=>m.author?.id===me.id).sort((a,b)=>byId(a.id,b.id));
  for(const [i,text] of posts.entries()){
   const body={content:fill(text),allowed_mentions:{parse:[]}},n=posts.length>1?` ${i+1}/${posts.length}`:'';
   if(!mine[i])await act(`post the starter message${n} in #${ch.name}`,()=>api('POST',`/channels/${id}/messages`,body));
   else if(mine[i].content!==body.content)await act(`update the starter message${n} in #${ch.name}`,()=>api('PATCH',`/channels/${id}/messages/${mine[i].id}`,body));
  }
 }

 // Discord's welcome screen (shown to people who join a Community server without Onboarding).
 if(layout.welcomeScreen&&community){
  const screen=layout.welcomeScreen;
  const want={description:screen.description,welcome_channels:screen.channels.map(c=>({channel_id:chanIds.get(c.channel),description:c.description,emoji_id:null,emoji_name:c.emoji??null}))};
  const have=guild.features.includes('COMMUNITY')||apply?await api('GET',`${G}/welcome-screen`).catch(()=>null):null;
  if(!have||!subsetEqual(want,have)||!guild.features.includes('WELCOME_SCREEN_ENABLED')){
   try{await act('set up the welcome screen',()=>api('PATCH',`${G}/welcome-screen`,{enabled:true,...want},REASON));}
   catch(e){warn(`Discord refused the welcome screen (${e.message}); set it up in Server Settings → Onboarding`);}
  }
 }

 // AutoMod
 if(layout.automod?.length){
  const existing=await api('GET',`${G}/auto-moderation/rules`);
  for(const rule of layout.automod){
   const trigger_type=TRIGGERS[rule.trigger],metadata={...rule.metadata};
   if(metadata.presets)metadata.presets=metadata.presets.map(p=>PRESETS[p]);
   const actions=[];
   if(rule.block)actions.push({type:1,metadata:rule.blockMessage?{custom_message:rule.blockMessage}:{}});
   if(rule.alert)actions.push({type:2,metadata:{channel_id:chanIds.get(rule.alert)}});
   if(rule.timeout)actions.push({type:3,metadata:{duration_seconds:rule.timeout}});
   const body={name:rule.name,event_type:1,trigger_metadata:metadata,actions,enabled:true,exempt_roles:(rule.exemptRoles??[]).map(n=>ids.get(n)).filter(Boolean),exempt_channels:[]};
   // Spam, preset and mention rules are one per server, so an existing one is adopted even under another name.
   const have=existing.find(r=>r.name===rule.name)??(ONE_PER_SERVER.has(trigger_type)?existing.find(r=>r.trigger_type===trigger_type):undefined);
   // Discord's own built-in rules (its default spam filter) show up in the list but bots can't edit them (404).
   try{
    if(!have)await act(`create AutoMod rule "${rule.name}"`,()=>api('POST',`${G}/auto-moderation/rules`,{...body,trigger_type},REASON));
    else if(!subsetEqual(body,have))await act(`update AutoMod rule "${rule.name}"`,()=>api('PATCH',`${G}/auto-moderation/rules/${have.id}`,body,REASON));
   }catch(e){
    changes.pop();
    warn(have&&have.name!==rule.name?`kept Discord's built-in AutoMod rule "${have.name}" in place of "${rule.name}" (bots can't edit it); check it in Server Settings → AutoMod`:`AutoMod rule "${rule.name}" was refused (${e.message})`);
   }
  }
 }

 // Onboarding (needs Community)
 if(layout.onboarding){
  if(!community)warn('Onboarding needs Community, so it was skipped');
  else{
   const have=guild.features.includes('COMMUNITY')||apply?await api('GET',`${G}/onboarding`).catch(()=>null):null;
   const body={enabled:true,mode:0,default_channel_ids:layout.onboarding.defaultChannels.map(n=>chanIds.get(n)),
    prompts:layout.onboarding.prompts.map(p=>{
     const old=have?.prompts?.find(x=>x.title===p.title);
     return {id:old?.id??snowflake(),type:p.dropdown?1:0,title:p.title,single_select:!!p.single,required:!!p.required,in_onboarding:true,
      options:p.options.map(o=>{const oldOption=old?.options?.find(x=>x.title===o.title);
       return {id:oldOption?.id??snowflake(),title:o.title,description:o.description??'',emoji_id:null,emoji_name:o.emoji??null,emoji_animated:false,
        role_ids:(o.roles??[]).map(n=>ids.get(n)).filter(Boolean),channel_ids:(o.channels??[]).map(n=>chanIds.get(n))};})};
    })};
   if(!have||onboardingKey(have)!==onboardingKey(body)){
    try{await act('set up Onboarding questions and default channels',()=>api('PUT',`${G}/onboarding`,body,REASON));}
    catch(e){warn(`Discord refused the Onboarding setup (${e.message}); set it up by hand in Server Settings → Onboarding`);}
   }
  }
 }

 const managed=new Set([...catIds.values(),...chanIds.values()]);
 for(const name of layout.retiredCategories??[]){
  const old=channels.find(c=>c.type===4&&norm(c.name)===norm(name)&&!managed.has(c.id));if(!old)continue;
  if(channels.some(c=>c.parent_id===old.id)){warn(`category ${old.name} still has channels, so it was kept`);continue;}
  await act(`delete the empty category ${old.name}`,()=>api('DELETE',`/channels/${old.id}`,undefined,REASON));
  if(apply)channels=channels.filter(c=>c.id!==old.id);
 }
 const leftovers=channels.filter(c=>!managed.has(c.id)).map(c=>c.type===4?`category ${c.name}${channels.some(x=>x.parent_id===c.id)?'':' (empty)'}`:`${c.type===2?'voice ':'#'}${c.name}`);
 return {changes,warnings,leftovers};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {values}=parseArgs({options:{guild:{type:'string'},apply:{type:'boolean',default:false},access:{type:'boolean',default:false},layout:{type:'string',default:fileURLToPath(new URL('./discord-layout.json',import.meta.url))}}});
 if(values.access){console.log(accessTable(JSON.parse(readFileSync(values.layout,'utf8'))));process.exit(0);}
 const token=process.env.DISCORD_BOT_TOKEN,guildId=values.guild??process.env.DISCORD_GUILD_ID;
 if(!token||!guildId){console.error('Set DISCORD_BOT_TOKEN in your environment, then run: node tools/discord-setup.mjs --guild <server id> [--apply]\n(or run it with --access to print who can see which channel; no token needed)');process.exit(2);}
 try{
  const layout=JSON.parse(readFileSync(values.layout,'utf8'));
  const {changes,warnings,leftovers}=await run({api:discordClient(token),guildId,layout,apply:values.apply});
  console.log(`\n${changes.length} change${changes.length===1?'':'s'} ${values.apply?'made':'planned. Dry run: nothing was changed. Add --apply to make them'}.`);
  if(warnings.length)console.log(`${warnings.length} warning${warnings.length===1?'':'s'} (see above).`);
  if(leftovers.length)console.log(`\nNot in the layout, left alone:\n  ${leftovers.join('\n  ')}`);
  if(layout.checklist?.length)console.log(`\nDo these by hand (bots can't, or Discord only lets the owner):\n${layout.checklist.map((x,i)=>`  ${i+1}. ${x}`).join('\n')}`);
 }catch(e){console.error(e.message);process.exit(1);}
}
