// Posts one UPDATES entry to the Discord #updates announcement channel through a channel webhook, pinging only the
// "Patch Notes" role. The entry is a website update file (spec §5.6: site/content/updates/<slug>.md with front matter
// date, title, summary, image) — the website does not produce these yet, so this is run by hand after publishing one.
//   env DISCORD_PATCH_NOTES_WEBHOOK_URL=…   webhook in #updates (Edit Channel → Integrations → Webhooks)
//   env DISCORD_PATCH_NOTES_ROLE_ID=…       the "Patch Notes" role id (right-click the role → Copy Role ID); optional
//   env SITE_URL=https://play.example/      links the post to /updates/<slug> and makes a relative image absolute
//   node tools/discord-patch-notes.mjs site/content/updates/<slug>.md [--dry-run]
// --dry-run prints the message instead of sending it. The webhook URL is a secret: never logged, scrubbed from errors.
// Webhook posts can't be published to following servers; press Publish on the message in Discord if you want that.
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {discordMessages,redact} from './discord-status.mjs';

const ORANGE=0xcd5a28; // site --or
const DESCRIPTION_LIMIT=4096;

// Front matter is simple `key: value` lines between --- fences (quotes around a value are dropped).
export function parseUpdate(markdown,{slug}={}){
 const m=/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(markdown));
 const meta={};
 for(const line of (m?m[1]:'').split(/\r?\n/)){const kv=/^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);if(kv)meta[kv[1]]=kv[2].trim().replace(/^(['"])(.*)\1$/,'$2');}
 return {slug,title:meta.title,date:meta.date,summary:meta.summary,image:meta.image,body:(m?m[2]:String(markdown)).trim()};
}

export function patchNotePayload(entry,{roleId,siteUrl}={}){
 if(!entry?.title)throw new Error('the update needs a title');
 if(roleId!=null&&roleId!==''&&!/^\d{15,25}$/.test(String(roleId)))throw new Error('the Patch Notes role id must be a Discord snowflake');
 const site=siteUrl?String(siteUrl).replace(/\/?$/,'/'):null;
 const url=site&&entry.slug?new URL(`updates/${encodeURIComponent(entry.slug)}`,site).href:undefined;
 let description=entry.body||entry.summary||'';
 if(description.length>DESCRIPTION_LIMIT){
  const more=url?`\n\n[Read the full update](${url})`:'\n\n…';
  description=description.slice(0,DESCRIPTION_LIMIT-more.length-1).replace(/\s+\S*$/,'')+'…'+more;
 }
 const embed={author:{name:'🛠️ PATCH NOTES'},title:String(entry.title).slice(0,256),color:ORANGE,footer:{text:'UPDATES'}};
 if(url)embed.url=url;
 if(description)embed.description=description;
 const when=entry.date?new Date(entry.date):null;
 if(when&&!Number.isNaN(when.getTime()))embed.timestamp=when.toISOString();
 if(entry.image){try{const img=new URL(entry.image,site??undefined);if(img.protocol==='https:')embed.image={url:img.href};}catch{}}
 const role=roleId?String(roleId):null;
 // Only the Patch Notes role may be pinged, whatever the text says (no @everyone, no users, no other roles).
 return {content:role?`<@&${role}>`:'',embeds:[embed],allowed_mentions:{parse:[],roles:role?[role]:[]}};
}

export async function postPatchNote(entry,{webhookUrl,roleId,siteUrl,fetchImpl=fetch,log=console.log}={}){
 const target=discordMessages({webhookUrl},{fetchImpl});
 try{const id=await target.create(patchNotePayload(entry,{roleId,siteUrl}));log(`patch notes: posted "${entry.title}"`);return id;}
 catch(e){throw new Error(redact(e?.message??e,target.secrets));}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{'dry-run':{type:'boolean'}}});
 const env=process.env,file=positionals[0];
 // The #updates channel variables are the shared names; the PATCH_NOTES ones still work.
 for(const [old,shared] of [['DISCORD_PATCH_NOTES_WEBHOOK_URL','DISCORD_UPDATES_WEBHOOK_URL'],['DISCORD_PATCH_NOTES_ROLE_ID','DISCORD_UPDATES_ROLE_ID']])if(!env[old]&&env[shared])env[old]=env[shared];
 if(!file){console.error('Usage: node tools/discord-patch-notes.mjs site/content/updates/<slug>.md [--dry-run]');process.exit(2);}
 const entry=parseUpdate(readFileSync(file,'utf8'),{slug:basename(file).replace(/\.md$/i,'')});
 const options={roleId:env.DISCORD_PATCH_NOTES_ROLE_ID,siteUrl:env.SITE_URL};
 try{
  if(values['dry-run'])console.log(JSON.stringify(patchNotePayload(entry,options),null,1));
  else{
   if(!env.DISCORD_PATCH_NOTES_WEBHOOK_URL){console.error('Set DISCORD_PATCH_NOTES_WEBHOOK_URL (and DISCORD_PATCH_NOTES_ROLE_ID to ping the Patch Notes role).');process.exit(2);}
   await postPatchNote(entry,{...options,webhookUrl:env.DISCORD_PATCH_NOTES_WEBHOOK_URL});
  }
 }catch(e){console.error(redact(e.message,[env.DISCORD_PATCH_NOTES_WEBHOOK_URL]));process.exit(1);}
}
