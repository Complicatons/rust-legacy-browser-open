// Posts a "ROADMAP" card to the Discord #updates channel for a new website roadmap entry. Entries are
// site/content/roadmap/<YYYY-MM-DD>-<n>-<slug>.md (front matter date, optional end, title, summary,
// `stats: <value> | <label>; …`, `media: <file> | <caption>; …`; see central/roadmap.mjs). The GitHub workflow posts each
// entry file a push adds; editing an entry later does not repost it. The "What's coming" file (kind: coming) is never
// posted on its own.
//   env DISCORD_UPDATES_WEBHOOK_URL=…   webhook in #updates (falls back to DISCORD_PATCH_NOTES_WEBHOOK_URL)
//   env DISCORD_UPDATES_ROLE_ID=…       optional role to ping (falls back to DISCORD_PATCH_NOTES_ROLE_ID)
//   env SITE_URL=https://example.com/   links the card to /roadmap#<slug> and shows the entry's first picture
//   node tools/discord-roadmap.mjs site/content/roadmap/<slug>.md [--dry-run]
// The webhook URL is a secret: never logged, scrubbed from errors.
import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {discordMessages,redact} from './discord-status.mjs';
import {parseFrontMatter} from '../site/js/markdown.mjs';
import {pairs,MEDIA_URL} from '../central/roadmap.mjs';

const BLUE=0x4493f8;
const MAX_STATS=6,DESCRIPTION_LIMIT=1000;

// One entry file -> {slug,date,end,title,summary,stats,image,coming}. image is the first picture, or a clip's poster.
export function parseRoadmapEntry(markdown,{slug}={}){
 const {meta}=parseFrontMatter(markdown);
 const media=pairs(meta.media).map(([file])=>file);
 const pic=media.find(f=>/\.jpg$/.test(f))??media.find(f=>/\.mp4$/.test(f))?.replace(/\.mp4$/,'.poster.jpg');
 return {slug,date:meta.date,end:meta.end||null,title:meta.title,summary:meta.summary??'',coming:meta.kind==='coming',
  stats:pairs(meta.stats).map(([value,label=''])=>({value,label})),image:pic?MEDIA_URL+pic:null};
}

export function roadmapPayload(entry,{roleId,siteUrl}={}){
 if(entry?.coming)throw new Error("the What's coming section is not posted on its own");
 if(!entry?.title||!entry.date)throw new Error('the roadmap entry needs a date and a title');
 if(roleId!=null&&roleId!==''&&!/^\d{15,25}$/.test(String(roleId)))throw new Error('the role id must be a Discord snowflake');
 const site=siteUrl?String(siteUrl).replace(/\/?$/,'/'):null;
 const url=site?new URL('roadmap'+(entry.slug?'#'+encodeURIComponent(entry.slug):''),site).href:undefined;
 const summary=String(entry.summary||'').slice(0,DESCRIPTION_LIMIT);
 const embed={author:{name:'🗺️ ROADMAP'},title:String(entry.title).slice(0,256),color:BLUE,footer:{text:'ROADMAP'},
  description:(summary+(url?`\n\n[Read the whole entry](${url})`:'')).trim()};
 if(!embed.description)delete embed.description;
 if(url)embed.url=url;
 // Stats as the website shows them: the number, then its short label.
 const fields=entry.stats.filter(s=>s.value).slice(0,MAX_STATS).map(s=>({name:String(s.value).slice(0,256),value:String(s.label||'​').slice(0,1024),inline:true}));
 if(fields.length)embed.fields=fields;
 const when=new Date(entry.date+'T00:00:00Z');if(!Number.isNaN(when.getTime()))embed.timestamp=when.toISOString();
 if(site&&entry.image){try{const img=new URL(entry.image.replace(/^\//,''),site);if(img.protocol==='https:')embed.image={url:img.href};}catch{}}
 const role=roleId?String(roleId):null;
 return {content:role?`<@&${role}>`:'',embeds:[embed],allowed_mentions:{parse:[],roles:role?[role]:[]}};
}

export async function postRoadmap(entry,{webhookUrl,roleId,siteUrl,fetchImpl=fetch,log=console.log}={}){
 const target=discordMessages({webhookUrl},{fetchImpl});
 try{const id=await target.create(roadmapPayload(entry,{roleId,siteUrl}));log(`roadmap: posted "${entry.title}"`);return id;}
 catch(e){throw new Error(redact(e?.message??e,target.secrets));}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{'dry-run':{type:'boolean'}}});
 const env=process.env,file=positionals[0];
 if(!file){console.error('Usage: node tools/discord-roadmap.mjs site/content/roadmap/<slug>.md [--dry-run]');process.exit(2);}
 const webhookUrl=env.DISCORD_UPDATES_WEBHOOK_URL||env.DISCORD_PATCH_NOTES_WEBHOOK_URL;
 const roleId=env.DISCORD_UPDATES_ROLE_ID||env.DISCORD_PATCH_NOTES_ROLE_ID;
 try{
  const entry=parseRoadmapEntry(readFileSync(file,'utf8'),{slug:basename(file).replace(/\.md$/i,'')});
  if(entry.coming){console.log("roadmap: the What's coming section is not posted on its own");process.exit(0);}
  const options={roleId,siteUrl:env.SITE_URL};
  if(values['dry-run'])console.log(JSON.stringify(roadmapPayload(entry,options),null,1));
  else{
   if(!webhookUrl){console.error('Set DISCORD_UPDATES_WEBHOOK_URL (the #updates channel webhook).');process.exit(2);}
   await postRoadmap(entry,{...options,webhookUrl});
  }
 }catch(e){console.error(redact(e.message,[webhookUrl]));process.exit(1);}
}
