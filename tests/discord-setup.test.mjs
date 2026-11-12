import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {run,validateLayout,permissionBits,expandOverwrites,mergeOverwrites,rolePositions,subsetEqual,can,accessTable,discordClient} from '../tools/discord-setup.mjs';

const layout=()=>JSON.parse(readFileSync('tools/discord-layout.json','utf8'));
const clone=x=>structuredClone(x);
const BUILTIN_SPAM='1030554520465440818';
const BOOSTER_WARNING=/Discord creates the Server Booster role at your first boost/;
const QUARANTINE_WARNING=/no Quarantine role yet: Wick creates it/;
const unexpected=warnings=>warnings.filter(w=>!BOOSTER_WARNING.test(w)&&!QUARANTINE_WARNING.test(w));

// In-memory Discord: a fresh server as Discord creates it (Text Channels/#general, Voice Channels/General) with the
// setup bot's managed Administrator role on top. Mirrors the API rules the script relies on: new roles land at the
// bottom, announcement and forum channels need Community, forum flags can't be set on create, and Discord's built-in
// AutoMod rules are listed but answer 404 to a PATCH (seen on the real server).
function fakeDiscord({booster=false,otherBot=false,builtinSpam=false,wick=false,colourRoles=false}={}){
 let next=1000;const id=()=>String(next++);
 const G='1',BOT='2',BOT_ROLE='3';
 const role=(id,name,extra)=>({id,name,permissions:'0',color:0,hoist:false,mentionable:false,managed:false,...extra});
 // Wick joins with its managed role at the bottom and w!setup puts Quarantine directly under it.
 const extra=[...(booster?[role('4','Server Booster',{managed:true,tags:{premium_subscriber:null}})]:[]),...(otherBot?[role('5','Double Counter',{managed:true,tags:{bot_id:'77'},permissions:'268435456'})]:[]),
  ...(wick?[role('7','Quarantine'),role('6','Wick',{managed:true,tags:{bot_id:'78'},permissions:'8'})]:[]),
  ...(colourRoles?[role('8','🎨 Purple',{color:0xb47cff}),role('9','🎨 Red',{color:0xff5c5c})]:[])];
 const s={guild:{id:G,owner_id:'9',features:[],verification_level:0,explicit_content_filter:0,default_message_notifications:0},
  roles:[role(G,'@everyone',{position:0,permissions:'1071698660929'}),...extra.map((r,i)=>({...r,position:i+1})),role(BOT_ROLE,'Setup Bot',{position:extra.length+1,permissions:'8',managed:true})],
  channels:[{id:'10',type:4,name:'Text Channels',position:0,permission_overwrites:[],flags:0},
   {id:'11',type:0,name:'general',parent_id:'10',position:0,permission_overwrites:[],topic:null,rate_limit_per_user:0,flags:0},
   {id:'12',type:4,name:'Voice Channels',position:1,permission_overwrites:[],flags:0},
   {id:'13',type:2,name:'General',parent_id:'12',position:0,permission_overwrites:[],user_limit:0,flags:0}],
  messages:new Map(),botRoles:{},welcomeScreen:{description:null,welcome_channels:[]},onboarding:{prompts:[],default_channel_ids:[],enabled:false,mode:0},calls:[],
  automod:builtinSpam?[{id:BUILTIN_SPAM,name:'Block Suspected Spam Content',trigger_type:3,event_type:1,trigger_metadata:{},actions:[{type:1,metadata:{}}],enabled:true,exempt_roles:[],exempt_channels:[]}]:[]};
 const tags=list=>(list??[]).map(t=>({...t,id:t.id??id()}));
 const api=async(method,path,body)=>{
  s.calls.push(`${method} ${path}`);
  const p=path.split('?')[0].replace(`/guilds/${G}`,'/G');let m;
  if(method==='GET'&&p==='/users/@me')return {id:BOT};
  if(method==='GET'&&p==='/G')return clone(s.guild);
  if(method==='PATCH'&&p==='/G'){
   if(body.features?.includes('COMMUNITY')&&!(body.rules_channel_id&&body.public_updates_channel_id&&body.explicit_content_filter===2))throw new Error('Community needs rules + updates channels');
   Object.assign(s.guild,body);return clone(s.guild);
  }
  if(method==='GET'&&(m=p.match(/^\/G\/members\/(\d+)$/))){
   if(m[1]===BOT)return {user:{id:BOT,username:'Setup Bot'},roles:[BOT_ROLE]};
   const own=s.roles.find(r=>r.tags?.bot_id===m[1]);if(!own)throw Object.assign(new Error('Unknown Member'),{status:404});
   s.botRoles[m[1]]??=[own.id];return {user:{id:m[1],username:own.name},roles:[...s.botRoles[m[1]]]};
  }
  if(method==='PUT'&&(m=p.match(/^\/G\/members\/(\d+)\/roles\/(\d+)$/))){s.botRoles[m[1]]??=[];s.botRoles[m[1]].push(m[2]);return null;}
  if(method==='GET'&&p==='/G/roles')return clone(s.roles);
  if(method==='POST'&&p==='/G/roles'){for(const r of s.roles)if(r.position>0)r.position++;const r={...body,id:id(),position:1,managed:false};s.roles.push(r);return clone(r);}
  if(method==='PATCH'&&p==='/G/roles'){for(const x of body)s.roles.find(r=>r.id===x.id).position=x.position;return clone(s.roles);}
  if(method==='DELETE'&&(m=p.match(/^\/G\/roles\/(\d+)$/))){s.roles=s.roles.filter(r=>r.id!==m[1]);return null;}
  if(method==='DELETE'&&(m=p.match(/^\/channels\/(\d+)$/))){s.channels=s.channels.filter(c=>c.id!==m[1]);return null;}
  if(method==='GET'&&p==='/G/welcome-screen')return clone(s.welcomeScreen);
  if(method==='PATCH'&&p==='/G/welcome-screen'){const {enabled,...screen}=body;s.welcomeScreen=screen;if(enabled&&!s.guild.features.includes('WELCOME_SCREEN_ENABLED'))s.guild.features.push('WELCOME_SCREEN_ENABLED');return clone(screen);}
  if(method==='PATCH'&&(m=p.match(/^\/G\/roles\/(\d+)$/))){const r=s.roles.find(r=>r.id===m[1]);Object.assign(r,body);return clone(r);}
  if(method==='GET'&&p==='/G/channels')return clone(s.channels);
  if(method==='POST'&&p==='/G/channels'){
   if([5,15].includes(body.type)&&!s.guild.features.includes('COMMUNITY'))throw new Error('needs Community');
   assert.equal(body.flags,undefined,'flags are not accepted on create');
   const c={topic:null,rate_limit_per_user:0,parent_id:null,...body,id:id(),position:s.channels.length,flags:0,available_tags:tags(body.available_tags)};
   s.channels.push(c);return clone(c);
  }
  if(method==='PATCH'&&p==='/G/channels'){for(const x of body)s.channels.find(c=>c.id===x.id).position=x.position;return null;}
  if(method==='PATCH'&&(m=p.match(/^\/channels\/(\d+)$/))){const c=s.channels.find(c=>c.id===m[1]);Object.assign(c,body);if(body.available_tags)c.available_tags=tags(body.available_tags);return clone(c);}
  if((m=p.match(/^\/channels\/(\d+)\/messages(?:\/(\d+))?$/))){
   const list=s.messages.get(m[1])??[];s.messages.set(m[1],list);
   if(method==='GET')return clone([...list].reverse()); // Discord lists newest first
   if(method==='POST'){const msg={id:id(),author:{id:BOT},content:body.content};list.push(msg);return clone(msg);}
   if(method==='PATCH'){const msg=list.find(x=>x.id===m[2]);msg.content=body.content;return clone(msg);}
  }
  if(method==='GET'&&p==='/G/auto-moderation/rules')return clone(s.automod);
  if(method==='POST'&&p==='/G/auto-moderation/rules'){
   if([3,4,5].includes(body.trigger_type)&&s.automod.some(r=>r.trigger_type===body.trigger_type))throw Object.assign(new Error('one per server'),{status:400});
   const r={...body,id:id()};s.automod.push(r);return clone(r);
  }
  if(method==='PATCH'&&(m=p.match(/^\/G\/auto-moderation\/rules\/(\d+)$/))){
   if(m[1]===BUILTIN_SPAM)throw Object.assign(new Error(`PATCH ${path} failed: 404 404: Not Found`),{status:404});
   const r=s.automod.find(r=>r.id===m[1]);Object.assign(r,body);return clone(r);
  }
  if(method==='GET'&&p==='/G/onboarding')return clone(s.onboarding);
  if(method==='PUT'&&p==='/G/onboarding'){s.onboarding=clone(body);return clone(body);}
  throw new Error(`fake Discord: unhandled ${method} ${path}`);
 };
 return {api,s,G};
}
const quiet={log:()=>{}};

test('the shipped layout is valid',()=>{
 assert.deepEqual(validateLayout(layout()),[]);
 const L=layout(),types=Object.fromEntries(L.categories.flatMap(c=>c.channels).map(c=>[c.name,c.type]));
 assert.equal(types.general,'text');
 for(const n of ['announcements','updates','wipe-schedule','owner-announcements'])assert.equal(types[n],'announcement');
});

test('who can see what: unverified, members, boosters and each staff level',()=>{
 const L=layout(),all=L.categories.flatMap(c=>c.channels).map(c=>c.name);
 const sees=(roles,ch)=>can(L,roles,ch,['VIEW_CHANNEL']),posts=(roles,ch)=>can(L,roles,ch,['VIEW_CHANNEL','SEND_MESSAGES']);
 const member=['Member'],mod=['Member','Moderator'],dev=['Member','Developer'],wiki=['Member','Wiki Editor'],admin=['Member','Admin'];
 // Before Double Counter gives them Member, people only see the start-here channels and can't post anywhere.
 assert.deepEqual(all.filter(ch=>sees([],ch)),['welcome','rules','verify','announcements','faq']);
 assert.deepEqual(all.filter(ch=>posts([],ch)),[]);
 assert.equal(can(L,[],'rules',['ADD_REACTIONS']),false);
 // Verified members: chat channels yes; every staff, owner, tester and booster channel hidden; #verify hidden once done.
 for(const ch of ['general','lfg','help','bug-reports','suggestions','off-topic','General'])assert.ok(sees(member,ch),ch);
 assert.ok(posts(member,'general'));
 for(const ch of ['staff-chat','mod-chat','admin-chat','mod-log','wiki-staff','dev-log','Staff','owners-chat','owner-announcements','test-builds','test-feedback','verify'])
  assert.equal(sees(member,ch),false,ch);
 for(const ch of ['welcome','rules','announcements','updates','wipe-schedule','server-status','level-ups','open-a-ticket'])
  assert.equal(posts(member,ch),false,`${ch} is read-only for members`);
 assert.equal(can(L,member,'general',['MENTION_EVERYONE']),false);
 assert.equal(can(L,member,'general',['CREATE_INSTANT_INVITE']),false);
 // Staff levels: admins see everything; mods don't see admin chat; developers and wiki editors don't see mod chat.
 assert.ok(posts(admin,'admin-chat'));
 assert.equal(sees(mod,'admin-chat'),false);assert.ok(posts(mod,'mod-chat'));assert.ok(posts(mod,'staff-chat'));
 assert.ok(sees(mod,'mod-log'));assert.equal(posts(mod,'mod-log'),false);
 for(const roles of [dev,wiki]){assert.ok(posts(roles,'staff-chat'));for(const ch of ['mod-chat','admin-chat','mod-log'])assert.equal(sees(roles,ch),false,ch);}
 assert.ok(posts(dev,'dev-log'));assert.ok(posts(dev,'updates'));assert.equal(sees(wiki,'dev-log'),false);
 assert.ok(posts(wiki,'wiki-staff'));assert.equal(sees(mod,'wiki-staff'),false);
 assert.ok(posts(['Member','Tester'],'test-feedback'));assert.equal(posts(['Member','Tester'],'test-builds'),false);
 assert.ok(posts(['Member','Server Owner'],'owners-chat'));assert.equal(sees(['Member','Server Owner'],'staff-chat'),false);
 // Bots (with the Bots role) can post logs and level-ups but stay out of staff chats.
 for(const ch of ['level-ups','mod-log','dev-log','get-roles','verify'])assert.ok(posts(['Bots'],ch),ch);
 for(const ch of ['staff-chat','mod-chat','admin-chat'])assert.equal(sees(['Bots'],ch),false,ch);
 assert.match(accessTable(L),/#admin-chat\s+—/);
});

test('name colours: staff over the booster pink over levels; no colour picker',()=>{
 const names=layout().roles.map(r=>r.name),at=n=>names.indexOf(n);
 assert.ok(at('Tester')<at('Server Booster'));
 assert.equal(names.some(n=>n.startsWith('🎨')),false);
 assert.equal(layout().categories.flatMap(c=>c.channels).some(c=>c.name==='booster-lounge'),false);
 assert.ok(at('Server Booster')<at('Legend (Lv 50)'));
 assert.ok(at('Survivor (Lv 5)')<at('Member'));
 assert.deepEqual(names.filter(n=>/\(Lv \d+\)/.test(n)),['Legend (Lv 50)','Veteran (Lv 35)','Raider (Lv 20)','Builder (Lv 10)','Survivor (Lv 5)']);
});

test('layout validation catches bad references and unsafe permissions',()=>{
 const L=layout();
 L.roles[1].permissions.push('ADMINISTRATOR');
 L.everyone.permissions.push('MENTION_EVERYONE');
 L.categories[0].overwrites.push({role:'Nobody',allow:['SEND_MESSAGES']});
 L.categories[0].channels.push({name:'Bad Name',type:'text'});
 L.automod[0].alert='missing-channel';
 const problems=validateLayout(L).join('\n');
 for(const bit of ['never give a role ADMINISTRATOR','@everyone must not have MENTION_EVERYONE','unknown role Nobody','lowercase with dashes','unknown channel missing-channel'])
  assert.match(problems,new RegExp(bit));
});

test('permission bits and overwrite layering',()=>{
 assert.equal(permissionBits(['ADMINISTRATOR']),8n);
 assert.equal(permissionBits(['VIEW_CHANNEL','SEND_MESSAGES']),3072n);
 assert.throws(()=>permissionBits(['FLY']),/unknown permission FLY/);
 const cat=expandOverwrites([{role:'@everyone',deny:['SEND_MESSAGES']},{role:['A','B'],allow:['SEND_MESSAGES']}]);
 assert.deepEqual(cat.get('B'),{allow:2048n,deny:0n});
 const ch=mergeOverwrites(cat,expandOverwrites([{role:'A',deny:['SEND_MESSAGES']}]));
 assert.deepEqual(ch.get('A'),{allow:0n,deny:2048n});
 assert.deepEqual(cat.get('A'),{allow:2048n,deny:0n},'category map is not changed');
});

test('role ordering: other bots on top, then layout roles, then everything else',()=>{
 const roles=[{id:'1',position:0},{id:'setup',position:5},{id:'x',position:4},{id:'r1',position:3},{id:'r2',position:2},{id:'dc',position:1,managed:true}];
 assert.deepEqual(rolePositions(roles,['r2','r1'],5),[{id:'dc',position:4},{id:'r2',position:3},{id:'r1',position:2},{id:'x',position:1}]);
 assert.equal(rolePositions([{id:'1',position:0},{id:'r1',position:2},{id:'r2',position:1}],['r1','r2'],3),null);
 assert.deepEqual(rolePositions(roles,['q','r2','r1'],5,new Map([['q','dc']])).map(r=>r.id),['dc','r2','r1','x'],'a role that does not exist yet is skipped');
 const withQ=[...roles,{id:'q',position:0.5}];
 assert.deepEqual(rolePositions(withQ,['q','r2','r1'],5,new Map([['q','dc']])).map(r=>r.id),['dc','q','r2','r1','x']);
});

test('subsetEqual ignores extra fields and id order',()=>{
 assert.equal(subsetEqual({a:1,list:['2','1'],o:[{t:1}]},{a:1,b:9,list:['1','2'],o:[{t:1,x:0}]}),true);
 assert.equal(subsetEqual({a:1},{a:2}),false);
 assert.equal(subsetEqual({list:['1']},{list:['1','2']}),false);
});

test('a dry run only reads',async()=>{
 const {api,s,G}=fakeDiscord();
 const {changes}=await run({api,guildId:G,layout:layout(),...quiet});
 assert.ok(changes.length>40);
 assert.deepEqual(s.calls.filter(c=>!c.startsWith('GET')),[]);
});

test('setup builds the whole layout on a fresh server, and a second run changes nothing',async()=>{
 const {api,s,G}=fakeDiscord(),L=layout();
 const first=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.deepEqual(unexpected(first.warnings),[]);assert.equal(first.warnings.length,2);
 assert.ok(s.guild.features.includes('COMMUNITY'));
 assert.equal(s.guild.verification_level,2);

 const role=n=>s.roles.find(r=>r.name===n);
 const ranked=s.roles.filter(r=>r.id!==G).sort((a,b)=>b.position-a.position).map(r=>r.name);
 assert.deepEqual(ranked,['Setup Bot',...L.roles.filter(r=>!r.booster&&!r.external).map(r=>r.name)]);
 assert.equal(BigInt(s.roles.find(r=>r.id===G).permissions),permissionBits(L.everyone.permissions));
 assert.equal(role('Patch Notes').mentionable,false);

 const chan=n=>s.channels.find(c=>c.name===n&&c.type!==4);
 const cat=n=>s.channels.find(c=>c.name===n&&c.type===4);
 assert.equal(chan('general').id,'11','Discord\'s default #general is reused');
 assert.equal(chan('general').parent_id,cat('💬 COMMUNITY').id);
 assert.equal(chan('general').rate_limit_per_user,2);
 assert.equal(chan('General').id,'13','default General voice channel is reused');
 for(const n of ['announcements','updates','wipe-schedule','owner-announcements'])assert.equal(chan(n).type,5,n);
 assert.equal(chan('bug-reports').type,15);
 assert.equal(chan('bug-reports').flags&16,16,'bug reports require a tag');
 assert.deepEqual(chan('bug-reports').available_tags.filter(t=>t.moderated).map(t=>t.name),['Confirmed','Fixed','Guide']);
 assert.equal(chan('Squad 1').user_limit,4);
 const overwrite=(ch,roleId)=>chan(ch).permission_overwrites.find(o=>o.id===roleId);
 const VIEW=permissionBits(['VIEW_CHANNEL']);
 assert.equal(BigInt(overwrite('general',G).deny)&VIEW,VIEW,'unverified can\'t see #general');
 assert.equal(BigInt(overwrite('general',role('Member').id).allow)&VIEW,VIEW);
 assert.equal(BigInt(overwrite('admin-chat',role('Moderator').id).deny)&VIEW,VIEW,'mods can\'t see #admin-chat');
 assert.equal(s.guild.rules_channel_id,chan('rules').id);
 assert.equal(s.guild.public_updates_channel_id,chan('admin-chat').id);

 const order=s.channels.filter(c=>c.parent_id===cat('📌 START HERE').id).sort((a,b)=>a.position-b.position).map(c=>c.name);
 assert.deepEqual(order,['welcome','rules','verify','announcements','get-roles','faq']);

 const welcome=s.messages.get(chan('welcome').id);
 assert.equal(welcome.length,1);
 assert.ok(welcome[0].content.includes(`<#${chan('verify').id}>`));
 assert.ok(!welcome[0].content.includes('{#'));

 assert.equal(s.automod.length,5);
 const mention=s.automod.find(r=>r.trigger_type===5);
 assert.deepEqual(mention.actions.map(a=>a.type),[1,2,3]);
 assert.equal(mention.actions[1].metadata.channel_id,chan('mod-log').id);
 assert.deepEqual(s.automod.find(r=>r.trigger_type===4).trigger_metadata.presets,[2,3]);
 assert.equal(s.calls.some(c=>c.includes('/onboarding')),false,'Onboarding is off in the gated layout');

 assert.equal(s.guild.system_channel_id,chan('welcome').id,'join messages go to #welcome, not #general');
 assert.equal(s.guild.system_channel_flags,60);
 assert.equal(s.guild.afk_channel_id,chan('AFK').id);assert.equal(s.guild.afk_timeout,900);
 assert.equal(s.guild.safety_alerts_channel_id,chan('mod-log').id);
 assert.match(s.guild.description,/rebuilt to run in your web browser/);
 assert.ok(s.guild.features.includes('WELCOME_SCREEN_ENABLED'));
 assert.deepEqual(s.welcomeScreen.welcome_channels.map(c=>c.channel_id),['rules','verify','faq','announcements'].map(n=>chan(n).id));
 const faq=s.messages.get(chan('faq').id);
 assert.equal(faq.length,2);assert.match(faq[0].content,/^\*\*FAQ\*\*/);assert.match(faq[1].content,/When do servers wipe/);
 assert.deepEqual(first.leftovers,[],'Discord\'s empty default categories are removed');
 assert.ok(!s.channels.some(c=>/^(Text|Voice) Channels$/.test(c.name)));

 const second=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.deepEqual(second.changes,[]);
 assert.equal(second.warnings.length,2);
});

test('Server Booster: styled once Discord has made it, and other bots stay above the roles they hand out',async()=>{
 const {api,s,G}=fakeDiscord({booster:true,otherBot:true,wick:true}),L=layout();
 const {warnings}=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.deepEqual(warnings,[]);
 const booster=s.roles.find(r=>r.id==='4');
 assert.equal(booster.color,0xf47fff);assert.equal(booster.hoist,true);
 const ranked=s.roles.filter(r=>r.id!==G).sort((a,b)=>b.position-a.position).map(r=>r.name);
 assert.deepEqual(ranked,['Setup Bot','Wick','Quarantine','Double Counter',...L.roles.filter(r=>!r.external).map(r=>r.name)],'Quarantine sits directly under Wick, as Wick needs');
 // Every other bot got the Bots role (the setup bot itself doesn't need it).
 const bots=s.roles.find(r=>r.name==='Bots').id;
 assert.deepEqual(Object.keys(s.botRoles).sort(),['77','78']);
 for(const id of ['77','78'])assert.ok(s.botRoles[id].includes(bots),id);
 assert.deepEqual((await run({api,guildId:G,layout:L,apply:true,...quiet})).changes,[]);
});

test('old colour roles are deleted; starter messages stay put when join messages pile up in #welcome',async()=>{
 const {api,s,G}=fakeDiscord({colourRoles:true}),L=layout();
 const {changes}=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.ok(changes.includes('delete role 🎨 Purple'));assert.ok(changes.includes('delete role 🎨 Red'));
 assert.ok(!s.roles.some(r=>r.name.startsWith('🎨')));
 // Discord's join messages (from other authors) arrive after the bot's own post.
 const welcome=s.channels.find(c=>c.name==='welcome').id,list=s.messages.get(welcome);
 for(let i=0;i<30;i++)list.push({id:String(90000+i),author:{id:'5000'},content:'joined'});
 L.categories[0].channels.find(c=>c.name==='welcome').message+=' Have fun.';
 const again=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.deepEqual(again.changes,['update the starter message in #welcome']);
 assert.match(list[0].content,/Have fun\.$/);assert.equal(list.filter(m=>m.author.id!=='5000').length,1);
});

test('a channel renamed in the layout is renamed in place, not duplicated',async()=>{
 const {api,s,G}=fakeDiscord(),L=layout();
 const ch=L.categories.flatMap(c=>c.channels).find(c=>c.name==='updates');
 const renamed={...ch,name:'patch-notes'};delete renamed.oldNames;
 const old=JSON.parse(JSON.stringify(L));old.categories.forEach(c=>c.channels=c.channels.map(x=>x.name==='updates'?renamed:x));
 old.categories.forEach(c=>c.channels.forEach(x=>{for(const k of ['message','messages'])if(x[k])x[k]=JSON.parse(JSON.stringify(x[k]).replaceAll('{#updates}','{#patch-notes}'));}));
 await run({api,guildId:G,layout:old,apply:true,...quiet});
 const id=s.channels.find(c=>c.name==='patch-notes').id;
 const {changes}=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.ok(changes.some(c=>/update #updates \(name/.test(c)),changes.join('\n'));
 assert.equal(s.channels.find(c=>c.name==='updates').id,id);
 assert.equal(s.channels.filter(c=>['patch-notes','updates'].includes(c.name)).length,1);
});

test('Wick: Quarantine is never edited, and channel permissions for roles the layout does not manage survive',async()=>{
 const {api,s,G}=fakeDiscord({wick:true}),L=layout();
 await run({api,guildId:G,layout:L,apply:true,...quiet});
 const quarantine=s.roles.find(r=>r.id==='7');
 assert.deepEqual([quarantine.name,quarantine.permissions,quarantine.color],['Quarantine','0',0]);
 // What w!setup does: hide every channel from Quarantine. A ticket bot may also add a single-member overwrite.
 const hide={id:'7',type:0,allow:'0',deny:String(permissionBits(['VIEW_CHANNEL']))},member={id:'555',type:1,allow:String(permissionBits(['VIEW_CHANNEL'])),deny:'0'};
 for(const c of s.channels)c.permission_overwrites.push(hide);
 s.channels.find(c=>c.name==='open-a-ticket').permission_overwrites.push(member);
 const again=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.deepEqual(again.changes,[]);
 for(const c of s.channels.filter(c=>c.parent_id||c.type===4))if(c.name!=='Text Channels'&&c.name!=='Voice Channels')assert.ok(c.permission_overwrites.some(o=>o.id==='7'),c.name);
 assert.ok(s.channels.find(c=>c.name==='open-a-ticket').permission_overwrites.some(o=>o.id==='555'));
 // Changing the layout still rewrites only the layout's own entries.
 L.categories.find(c=>c.name==='💬 COMMUNITY').channels.find(c=>c.name==='general').overwrites=[{role:'Moderator',allow:['MANAGE_MESSAGES']}];
 const edited=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.deepEqual(edited.changes,['update #general (permissions)']);
 const general=s.channels.find(c=>c.name==='general').permission_overwrites;
 assert.ok(general.some(o=>o.id==='7'));assert.ok(general.some(o=>o.id===s.roles.find(r=>r.name==='Moderator').id));
});

test('a layout may not set channel permissions for a role another bot owns',()=>{
 const L=layout();
 L.categories[1].overwrites.push({role:'Quarantine',deny:['VIEW_CHANNEL']});
 assert.match(validateLayout(L).join('\n'),/Quarantine belongs to another bot/);
});

test('a built-in AutoMod rule Discord won\'t let bots edit is kept with a warning, and the rest still runs',async()=>{
 const {api,s,G}=fakeDiscord({builtinSpam:true});
 const {warnings,changes}=await run({api,guildId:G,layout:layout(),apply:true,...quiet});
 assert.ok(warnings.some(w=>/kept Discord's built-in AutoMod rule "Block Suspected Spam Content"/.test(w)),warnings.join('\n'));
 assert.ok(!changes.includes('update AutoMod rule "Spam"'));
 assert.deepEqual(s.automod.map(r=>r.name).sort(),['Block Suspected Spam Content','Cheat selling (alert only)','Invite links','Mention spam','Slurs and sexual content']);
 assert.ok(s.messages.size>0,'steps after AutoMod still ran');
});

test('editing the layout changes only what differs',async()=>{
 const {api,s,G}=fakeDiscord(),L=layout();
 await run({api,guildId:G,layout:L,apply:true,...quiet});
 L.categories.find(c=>c.name==='💬 COMMUNITY').channels.find(c=>c.name==='general').slowmode=3;
 L.roles.find(r=>r.name==='Tester').color='#123456';
 const {changes}=await run({api,guildId:G,layout:L,apply:true,...quiet});
 assert.deepEqual(changes,['update role Tester (color)','update #general (slowmode)']);
 assert.equal(s.channels.find(c=>c.name==='general').rate_limit_per_user,3);
});

test('without Administrator the script stops before changing anything',async()=>{
 const {api,s,G}=fakeDiscord();
 s.roles.find(r=>r.name==='Setup Bot').permissions=String(permissionBits(['MANAGE_ROLES','MANAGE_CHANNELS']));
 await assert.rejects(run({api,guildId:G,layout:layout(),apply:true,...quiet}),/needs Administrator/);
 assert.deepEqual(s.calls.filter(c=>!c.startsWith('GET')),[]);
});

test('the REST client retries after a rate limit and reports Discord errors',async()=>{
 const sent=[];let n=0;
 const fetchImpl=async(url,init)=>{sent.push({url,init});n++;
  if(n===1)return new Response(JSON.stringify({retry_after:0.01}),{status:429});
  if(n===2)return new Response(JSON.stringify({id:'5'}),{status:200});
  return new Response(JSON.stringify({message:'Missing Permissions',code:50013}),{status:403});};
 const api=discordClient('TOKEN',{fetchImpl});
 assert.deepEqual(await api('POST','/guilds/1/roles',{name:'x'},'why'),{id:'5'});
 assert.equal(sent[0].url,'https://discord.com/api/v10/guilds/1/roles');
 assert.equal(sent[0].init.headers.Authorization,'Bot TOKEN');
 assert.equal(sent[0].init.headers['X-Audit-Log-Reason'],'why');
 await assert.rejects(api('GET','/guilds/1'),e=>e.status===403&&/Missing Permissions/.test(e.message)&&!/TOKEN/.test(e.message));
});
