import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {parseRoadmapEntry,roadmapPayload,postRoadmap} from '../tools/discord-roadmap.mjs';
import {patchNotePayload} from '../tools/discord-patch-notes.mjs';

const HOOK='https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789';
const ROLE='123456789012345678';
const ENTRY=`---
date: 2026-10-17
end: 2026-10-18
title: Playing online
summary: Join a server and the server runs everything.
stats: 23 | hit regions per player; 20 | armour models
media: multiplayer.mp4 | Two players; remote-armor.jpg | Armour
---

## What you see
Body text stays on the website.
`;
const entry=()=>parseRoadmapEntry(ENTRY,{slug:'2026-10-17-5-playing-online'});

test('parseRoadmapEntry: front matter, stats and the first picture', ()=>{
 const e=entry();
 assert.equal(e.title,'Playing online');assert.equal(e.date,'2026-10-17');assert.equal(e.end,'2026-10-18');
 assert.deepEqual(e.stats,[{value:'23',label:'hit regions per player'},{value:'20',label:'armour models'}]);
 assert.equal(e.image,'/site/generated/media/roadmap/remote-armor.jpg','a picture before a clip poster');
 assert.equal(parseRoadmapEntry('---\ndate: 2026-10-17\ntitle: T\nmedia: a.mp4 | clip\n---\n').image,'/site/generated/media/roadmap/a.poster.jpg');
 assert.equal(parseRoadmapEntry('---\nkind: coming\ntitle: Next\n---\n').coming,true);
});

test('roadmapPayload: blue card linking the entry, stats as fields, pinging only the chosen role', ()=>{
 const p=roadmapPayload(entry(),{roleId:ROLE,siteUrl:'https://play.example'});
 const e=p.embeds[0];
 assert.equal(e.author.name,'🗺️ ROADMAP');assert.equal(e.title,'Playing online');
 assert.equal(e.url,'https://play.example/roadmap#2026-10-17-5-playing-online');
 assert.match(e.description,/^Join a server and the server runs everything\.\n\n\[Read the whole entry\]\(https:\/\/play\.example\/roadmap#2026-10-17-5-playing-online\)$/);
 assert.deepEqual(e.fields,[{name:'23',value:'hit regions per player',inline:true},{name:'20',value:'armour models',inline:true}]);
 assert.equal(e.image.url,'https://play.example/site/generated/media/roadmap/remote-armor.jpg');
 assert.equal(e.timestamp,'2026-10-17T00:00:00.000Z');
 assert.equal(p.content,`<@&${ROLE}>`);assert.deepEqual(p.allowed_mentions,{parse:[],roles:[ROLE]});
 const bare=roadmapPayload(entry());
 assert.equal(bare.content,'');assert.equal(bare.embeds[0].url,undefined);assert.equal(bare.embeds[0].image,undefined,'no image without a site');
 assert.throws(()=>roadmapPayload({...entry(),title:''}),/date and a title/);
 assert.throws(()=>roadmapPayload({...entry(),coming:true}),/What's coming/);
 assert.throws(()=>roadmapPayload(entry(),{roleId:'@everyone'}),/snowflake/);
});

test('every shipped roadmap entry makes a valid card', ()=>{
 const dir=new URL('../site/content/roadmap/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.md'))){
  const e=parseRoadmapEntry(readFileSync(new URL(f,dir),'utf8'),{slug:f.slice(0,-3)});
  if(e.coming)continue;
  const card=roadmapPayload(e,{siteUrl:'https://play.example'}).embeds[0];
  assert.ok(card.title&&card.description&&card.description.length<=4096,f);
  assert.ok((card.fields??[]).length<=6,f);
 }
});

test('roadmap and patch-notes cards are told apart by their header and colour', ()=>{
 const roadmap=roadmapPayload(entry()).embeds[0];
 const notes=patchNotePayload({title:'Doors',summary:'S'}).embeds[0];
 assert.equal(notes.author.name,'🛠️ PATCH NOTES');
 assert.notEqual(roadmap.color,notes.color);
});

test('postRoadmap: posts through the webhook; errors never reveal the webhook URL', async()=>{
 const calls=[];
 const ok=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify({id:'999'}),{status:200});};
 assert.equal(await postRoadmap(entry(),{webhookUrl:HOOK,fetchImpl:ok,log:()=>{}}),'999');
 assert.equal(calls[0].url,'https://discord.com/api/v10/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789?wait=true');
 assert.equal(calls[0].body.embeds[0].title,'Playing online');
 const bad=async()=>new Response(JSON.stringify({message:'Unknown Webhook'}),{status:404});
 await assert.rejects(postRoadmap(entry(),{webhookUrl:HOOK,fetchImpl:bad,log:()=>{}}),
  e=>/Unknown Webhook/.test(e.message)&&!e.message.includes('abcdefghijklmnopqrstuvwxyz0123456789'));
});
