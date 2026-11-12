import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {discordMessages,formatStatus,createStatusUpdater,fetchServers,redact,readState,writeState} from '../tools/discord-status.mjs';
import {parseUpdate,patchNotePayload,postPatchNote} from '../tools/discord-patch-notes.mjs';

const HOOK_TOKEN='Xy9_secretWebhookToken-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
const HOOK=`https://discord.com/api/webhooks/1562059224350072999/${HOOK_TOKEN}`;
const BOT_TOKEN=['MTU2MjA1OTIyNDM1MDA3Mjk5OQ','GaBcDe','secretBotTokenPart-0123456789abcdef'].join('.'); // fake; split so secret scanners don't flag it
const CHANNEL='1562059224350073000';
const ROLE='1562059224350073111';
const leaks=text=>[HOOK,HOOK_TOKEN,BOT_TOKEN].some(s=>String(text).includes(s));

// Fake Discord: webhook and channel message create/edit, scripted failures, every request recorded.
function fakeDiscord({failures=[]}={}){
 const calls=[],messages=new Map();let next=900;
 const json=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body,text:async()=>body===undefined?'':JSON.stringify(body)});
 const fetchImpl=async(url,init)=>{
  calls.push({url,method:init.method,headers:init.headers,body:init.body?JSON.parse(init.body):undefined});
  const f=failures.shift();
  if(f==='throw')throw new Error(`connect ECONNREFUSED while fetching ${url}`);
  if(f)return json(f.status,f.body);
  const u=new URL(url),edit=/\/messages\/(\d+)$/.exec(u.pathname);
  if(init.method==='PATCH'){if(!messages.has(edit[1]))return json(404,{message:'Unknown Message',code:10008});messages.set(edit[1],JSON.parse(init.body));return json(200,{id:edit[1]});}
  const id=String(next++);messages.set(id,JSON.parse(init.body));return json(200,{id});
 };
 return {calls,messages,fetchImpl};
}

const SERVERS=[
 {id:'a',name:'Legacy EU',region:'eu',online:true,players:30,capacity:100,wipe:'12'},
 {id:'b',name:'Hapis NA',region:'na',online:true,players:11,capacity:50,wipe:'3'},
 {id:'c',name:'Old Test',region:'oce',online:false,players:null,capacity:40,wipe:null},
];

test('formatStatus: totals line plus one line per server, numbers and labels only', ()=>{
 assert.equal(formatStatus(SERVERS),[
  '**3 SERVERS · 2 ONLINE · 41 PLAYERS**',
  '🟢 Legacy EU · EU · 30/100 · WIPE 12',
  '🟢 Hapis NA · NA · 11/50 · WIPE 3',
  '⚫ Old Test · OCE · OFFLINE',
 ].join('\n'));
 assert.equal(formatStatus([]),'**0 SERVERS · 0 ONLINE · 0 PLAYERS**');
 assert.equal(formatStatus(null),'**DIRECTORY OFFLINE**');
 assert.equal(formatStatus([{name:'Solo',online:true,players:1,capacity:null}]),'**1 SERVER · 1 ONLINE · 1 PLAYER**\n🟢 Solo · 1');
});

test('formatStatus: owner-chosen names cannot format, mention or exceed the 2000-character limit', ()=>{
 const text=formatStatus([{name:'**@everyone** [x](http://e) <@1>\nline',region:'eu',online:true,players:1,capacity:2}]);
 assert.ok(!text.includes('**@everyone**')&&!text.includes('\n line'));
 assert.match(text,/\\\*\\\*\\@everyone/);
 const many=Array.from({length:200},(_,i)=>({name:`Server number ${i} with a long name`,region:'eu',online:true,players:i,capacity:200,wipe:'1'}));
 const big=formatStatus(many);
 assert.ok(big.length<=2000);
 assert.match(big,/^\*\*200 SERVERS · 200 ONLINE/);
 assert.match(big,/\n\+\d+ MORE$/);
});

test('status updater: posts once through the webhook, then edits that message; no edit when unchanged', async()=>{
 const d=fakeDiscord(),saved=[],logs=[];
 let list=SERVERS;
 const u=createStatusUpdater({target:discordMessages({webhookUrl:HOOK},{fetchImpl:d.fetchImpl}),loadServers:async()=>list,saveState:s=>saved.push({...s}),log:m=>logs.push(m)});
 assert.equal(await u.tick(),'posted');
 assert.equal(d.calls[0].method,'POST');
 assert.match(d.calls[0].url,/\/api\/v10\/webhooks\/1562059224350072999\/.+\?wait=true$/);
 assert.deepEqual(d.calls[0].body.allowed_mentions,{parse:[]});
 assert.equal(d.calls[0].headers.Authorization,undefined);
 const id=u.state.messageId;
 assert.equal(saved.at(-1).messageId,id);
 assert.equal(await u.tick(),'unchanged');
 assert.equal(await u.tick(),'unchanged');
 assert.equal(d.calls.length,1);
 list=[{...SERVERS[0],players:31},...SERVERS.slice(1)];
 assert.equal(await u.tick(),'edited');
 assert.equal(d.calls[1].method,'PATCH');
 assert.ok(d.calls[1].url.endsWith(`/messages/${id}`));
 assert.match(d.messages.get(id).content,/42 PLAYERS/);
 assert.equal(d.calls.length,2);
 assert.ok(!logs.some(leaks));
});

test('status updater: a bot token + channel id works the same way', async()=>{
 const d=fakeDiscord();
 const u=createStatusUpdater({target:discordMessages({token:BOT_TOKEN,channelId:CHANNEL},{fetchImpl:d.fetchImpl}),loadServers:async()=>SERVERS,log:()=>{}});
 await u.tick();
 assert.equal(d.calls[0].url,`https://discord.com/api/v10/channels/${CHANNEL}/messages`);
 assert.equal(d.calls[0].headers.Authorization,`Bot ${BOT_TOKEN}`);
 u.state.content='stale';
 assert.equal(await u.tick(),'edited');
 assert.equal(d.calls[1].url,`https://discord.com/api/v10/channels/${CHANNEL}/messages/${u.state.messageId}`);
});

test('status updater: a saved message id is edited after a restart, and a deleted message is posted again', async()=>{
 const d=fakeDiscord();
 d.messages.set('777',{content:'old'});
 const u=createStatusUpdater({target:discordMessages({webhookUrl:HOOK},{fetchImpl:d.fetchImpl}),loadServers:async()=>SERVERS,state:{messageId:'777',content:'old'},log:()=>{}});
 assert.equal(await u.tick(),'edited');
 assert.equal(d.calls.length,1);
 d.messages.delete('777');
 u.state.content='old';
 assert.equal(await u.tick(),'posted');
 assert.notEqual(u.state.messageId,'777');
 assert.deepEqual(d.calls.map(c=>c.method),['PATCH','PATCH','POST']);
});

test('status updater: directory down shows DIRECTORY OFFLINE only after 3 failures in a row, then recovers', async()=>{
 const d=fakeDiscord();let down=false;const logs=[];
 const u=createStatusUpdater({target:discordMessages({webhookUrl:HOOK},{fetchImpl:d.fetchImpl}),loadServers:async()=>{if(down)throw new Error('GET /servers answered 502');return SERVERS;},log:m=>logs.push(m)});
 await u.tick();
 down=true;
 assert.equal(await u.tick(),'waiting');
 assert.equal(await u.tick(),'waiting');
 assert.equal(await u.tick(),'edited');
 assert.equal(d.messages.get(u.state.messageId).content,'**DIRECTORY OFFLINE**');
 assert.equal(await u.tick(),'unchanged');
 down=false;
 assert.equal(await u.tick(),'edited');
 assert.match(d.messages.get(u.state.messageId).content,/^\*\*3 SERVERS/);
 assert.ok(logs.some(m=>/unreachable \(3\)/.test(m)));
});

test('status updater: Discord errors are logged without secrets and retried on the next tick', async()=>{
 const d=fakeDiscord({failures:['throw',{status:500,body:{message:`boom ${HOOK}`}},{status:401,body:{message:'401: Unauthorized'}}]});
 const logs=[];
 const u=createStatusUpdater({target:discordMessages({webhookUrl:HOOK},{fetchImpl:d.fetchImpl}),loadServers:async()=>SERVERS,log:m=>logs.push(m)});
 assert.equal(await u.tick(),'error');
 assert.equal(await u.tick(),'error');
 assert.equal(await u.tick(),'error');
 assert.equal(u.state.messageId,undefined);
 assert.equal(await u.tick(),'posted');
 assert.equal(logs.length,4);
 assert.ok(!logs.some(leaks),logs.join('\n'));
 assert.ok(logs.some(m=>/ECONNREFUSED/.test(m))&&logs.some(m=>/401/.test(m)));

 const b=fakeDiscord({failures:['throw',{status:403,body:{message:'Missing Access'}}]});const blogs=[];
 const bu=createStatusUpdater({target:discordMessages({token:BOT_TOKEN,channelId:CHANNEL},{fetchImpl:b.fetchImpl}),loadServers:async()=>SERVERS,log:m=>blogs.push(m)});
 await bu.tick();await bu.tick();
 assert.ok(!blogs.some(leaks),blogs.join('\n'));
});

test('discordMessages: waits out a 429 and refuses webhook URLs that are not Discord webhooks', async()=>{
 const d=fakeDiscord({failures:[{status:429,body:{retry_after:0.01}}]});const waits=[];
 const t=discordMessages({webhookUrl:HOOK},{fetchImpl:d.fetchImpl,wait:async ms=>waits.push(ms)});
 assert.ok(await t.create({content:'x'}));
 assert.equal(waits.length,1);
 for(const bad of ['https://evil.example/api/webhooks/1562059224350072999/'+HOOK_TOKEN,'http://discord.com/api/webhooks/1/x','nonsense'])
  assert.throws(()=>discordMessages({webhookUrl:bad}),e=>!leaks(e.message)&&!e.message.includes(bad));
 assert.throws(()=>discordMessages({}),/webhook URL, or a bot token/);
 assert.throws(()=>discordMessages({token:BOT_TOKEN,channelId:'#status'}),e=>!leaks(e.message));
});

test('redact: scrubs known secrets and anything shaped like a webhook or bot header', ()=>{
 const text=redact(`a ${HOOK} b /api/webhooks/1/${HOOK_TOKEN} c Bot ${BOT_TOKEN} d`,[]);
 assert.ok(!leaks(text),text);
 assert.equal(redact(`x ${BOT_TOKEN} y`,[BOT_TOKEN]),'x [redacted] y');
});

test('fetchServers: reads GET /servers as JSON from the central service', async()=>{
 const seen=[];
 const ok=await fetchServers('https://play.example',{fetchImpl:async(url,init)=>{seen.push([url,init.headers.Accept]);return {ok:true,status:200,json:async()=>({servers:SERVERS})};}});
 assert.deepEqual(seen,[['https://play.example/servers','application/json']]);
 assert.equal(ok.length,3);
 await assert.rejects(fetchServers('https://play.example/',{fetchImpl:async()=>({ok:false,status:502})}),/502/);
 await assert.rejects(fetchServers('https://play.example/',{fetchImpl:async()=>({ok:true,status:200,json:async()=>({})})}),/no server list/);
});

test('state file keeps only the message id and last text', ()=>{
 const dir=mkdtempSync(join(tmpdir(),'rlb-status-'));
 try{
  const file=join(dir,'s.json');
  assert.deepEqual(readState(file),{});
  writeState(file,{messageId:'5',content:'x',extra:HOOK});
  assert.deepEqual(readState(file),{messageId:'5',content:'x'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

const UPDATE=`---
title: "Doors, locks and the wiki"
date: 2026-10-20
summary: Code locks work online.
image: /site/generated/updates/doors.jpg
---
## Changes
- Code locks @everyone
`;

test('parseUpdate: front matter and body of a site/content/updates entry', ()=>{
 assert.deepEqual(parseUpdate(UPDATE,{slug:'doors'}),{slug:'doors',title:'Doors, locks and the wiki',date:'2026-10-20',summary:'Code locks work online.',image:'/site/generated/updates/doors.jpg',body:'## Changes\n- Code locks @everyone'});
});

test('patchNotePayload: embed linking to the update, mentions limited to the Patch Notes role', ()=>{
 const p=patchNotePayload(parseUpdate(UPDATE,{slug:'doors'}),{roleId:ROLE,siteUrl:'https://play.example'});
 assert.equal(p.content,`<@&${ROLE}>`);
 assert.deepEqual(p.allowed_mentions,{parse:[],roles:[ROLE]});
 assert.equal(p.embeds[0].title,'Doors, locks and the wiki');
 assert.equal(p.embeds[0].url,'https://play.example/updates/doors');
 assert.equal(p.embeds[0].image.url,'https://play.example/site/generated/updates/doors.jpg');
 assert.equal(p.embeds[0].timestamp,'2026-10-20T00:00:00.000Z');
 const none=patchNotePayload({title:'T',summary:'S'});
 assert.deepEqual(none.allowed_mentions,{parse:[],roles:[]});
 assert.equal(none.content,'');
 assert.equal(none.embeds[0].description,'S');
 assert.throws(()=>patchNotePayload({title:'T'},{roleId:'@everyone'}),/snowflake/);
 assert.throws(()=>patchNotePayload({}),/title/);
 const long=patchNotePayload({slug:'big',title:'Big',body:'word '.repeat(2000)},{siteUrl:'https://play.example/'});
 assert.ok(long.embeds[0].description.length<=4096);
 assert.ok(long.embeds[0].description.endsWith('(https://play.example/updates/big)'));
});

test('postPatchNote: posts through the webhook; failures never reveal the webhook URL', async()=>{
 const d=fakeDiscord();const logs=[];
 const id=await postPatchNote({title:'T',summary:'S'},{webhookUrl:HOOK,roleId:ROLE,fetchImpl:d.fetchImpl,log:m=>logs.push(m)});
 assert.ok(id);
 assert.equal(d.calls[0].method,'POST');
 assert.deepEqual(d.calls[0].body.allowed_mentions,{parse:[],roles:[ROLE]});
 for(const failure of ['throw',{status:404,body:{message:`Unknown Webhook ${HOOK}`}}]){
  const f=fakeDiscord({failures:[failure]});
  await assert.rejects(postPatchNote({title:'T'},{webhookUrl:HOOK,fetchImpl:f.fetchImpl,log:m=>logs.push(m)}),e=>!leaks(e.message)&&!leaks(e.stack));
 }
 assert.ok(!logs.some(leaks));
});
