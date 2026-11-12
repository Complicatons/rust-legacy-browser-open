// Builds the website's generated assets into site/generated/ (ignored by git: some are derived from recovered game data).
//   node tools/build-site.mjs              all steps
//   node tools/build-site.mjs fonts audio  only the named steps
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const OUT=path.join(root,'site/generated');
const nm=p=>path.join(root,'node_modules',p);

// Front matter of every <slug>.md in a folder: [{slug, ...meta}] (order becomes a number).
export async function indexMarkdown(dir,{required=[]}={}){
 const {readdir}=await import('node:fs/promises'),{parseFrontMatter}=await import('../site/js/markdown.mjs'),out=[];
 for(const f of (await readdir(dir)).filter(f=>/^[a-z0-9-]+\.md$/.test(f)).sort()){const {meta}=parseFrontMatter(await readFile(path.join(dir,f),'utf8'));
  for(const k of required)if(!meta[k])throw Error(`${f}: front matter needs ${k}`);
  if(meta.order!==undefined)meta.order=Number(meta.order);out.push({slug:f.slice(0,-3),...meta});}
 return out;
}

// One guides.json entry; `featured` ranks the guides shown first on /wiki and /wiki/guides.
export const guideEntry=g=>({slug:g.slug,title:g.title,summary:g.summary??'',group:g.group,order:g.order??99,featured:g.featured!=null?Number(g.featured):null,image:g.image??null,tags:g.tags??''});

const STEPS={
 async fonts(){
  const dir=path.join(OUT,'fonts');await mkdir(dir,{recursive:true});
  await copyFile(nm('@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2'),path.join(dir,'archivo-wdth.woff2'));
  for(const w of [500,700])await copyFile(nm(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`),path.join(dir,`jetbrains-mono-${w}.woff2`));
  return 'fonts: 3 files';
 },
 // Original MenuBackground audio (MusicPlayer track, wind and fire-barrel loops) with their original volumes.
 async audio(){
  const src=path.join(root,'browser/assets/recovered/audio'),dir=path.join(OUT,'audio');await mkdir(dir,{recursive:true});
  const menu=JSON.parse(await readFile(path.join(src,'manifest.json'),'utf8')).menu??{},music=menu.music?.[0],loops=(menu.loops??[]).filter(l=>l.active!==false&&l.enabled!==false&&l.clip);
  const files=[music?.tracks?.[0],...loops.map(l=>l.clip)].filter(Boolean);
  for(const f of files)await copyFile(path.join(src,f),path.join(dir,f));
  const manifest={music:music?.tracks?.[0]?{file:music.tracks[0],startDelay:music.startDelay??0,targetVolume:music.targetVolume??.2}:null,loops:loops.map(l=>({file:l.clip,volume:l.volume}))};
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,1));
  return `audio: ${files.length} clips`;
 },
 // Screenshots of our port (needs the GPU; tools/capture-site-images.mjs).
 async media(){const {captureSiteImages}=await import('./capture-site-images.mjs');await captureSiteImages();return 'media: captured';},
 // WebP copies (full and 960 px) of the page backgrounds the CSS offers first (tools/site-webp.mjs).
 async webp(){const {buildSiteWebp}=await import('./site-webp.mjs');const r=await buildSiteWebp();return `webp: ${r.written.join('; ')||'nothing'}${r.missing.length?` (no ${r.missing.join(', ')}.jpg)`:''}`;},
 // Link-preview cards (og:image) over the media step's title-screen shot (tools/share-cards.mjs).
 async share(){const {buildShareCards}=await import('./share-cards.mjs');const r=await buildShareCards();return `share: ${r.cards.map(n=>`share-${n}.jpg`).join(', ')}${r.hero?'':' (plain background: no hero-menu.jpg)'}`;},
 // The classic community map, once the owner adds it: site/content/classic-map.(jpg|png) plus classic-map.json
 // {points:[{image:[u,v], world:[x,z]}, … ≥3], credit} → site/generated/map/classic.json (tools/site-map.mjs).
 async classic(){
  const {existsSync}=await import('node:fs'),dir=path.join(root,'site/content');
  const image=['classic-map.jpg','classic-map.png'].map(f=>path.join(dir,f)).find(existsSync),pointsFile=path.join(dir,'classic-map.json');
  if(!image)return 'classic: no site/content/classic-map.jpg yet (layer shows its pending frame)';
  if(!existsSync(pointsFile))return 'classic: image found, waiting for site/content/classic-map.json control points';
  const {buildClassic}=await import('./site-map.mjs'),meta=JSON.parse(await readFile(pointsFile,'utf8'));
  const tmp=path.join(OUT,'classic-points.json');await mkdir(OUT,{recursive:true});await writeFile(tmp,JSON.stringify(meta.points));
  const o=await buildClassic({image,points:tmp,credit:meta.credit});return `classic: ${o.image}, affine from ${o.points} points`;
 },
 // Updates index from site/content/updates/*.md front matter (newest first); the pages fetch each .md themselves.
 async content(){
  const dir=path.join(OUT,'content');await mkdir(dir,{recursive:true});
  const updates=(await indexMarkdown(path.join(root,'site/content/updates'),{required:['date','title']})).map(u=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(u.date))throw Error(`${u.slug}.md: date must be YYYY-MM-DD`);return {slug:u.slug,date:u.date,title:u.title,summary:u.summary??'',image:u.image??null};})
   .sort((a,b)=>b.date.localeCompare(a.date)||b.slug.localeCompare(a.slug));
  await writeFile(path.join(dir,'updates.json'),JSON.stringify(updates,null,1));
  // Wiki guides: shown in /wiki/guides grouped by `group` and `order` (site/js/wiki-view.mjs).
  const guides=(await indexMarkdown(path.join(root,'site/content/guides'),{required:['title','group']})).map(guideEntry);
  await writeFile(path.join(dir,'guides.json'),JSON.stringify(guides,null,1));
  // Help for players, server owners, server teams and site staff (/docs, site/js/docs.mjs), grouped by `group` then `order`.
  const docs=(await indexMarkdown(path.join(root,'site/content/docs'),{required:['title','group']})).map(d=>({slug:d.slug,title:d.title,summary:d.summary??'',group:d.group,order:d.order??99}));
  await writeFile(path.join(dir,'docs.json'),JSON.stringify(docs,null,1));
  return `content: ${updates.length} updates, ${guides.length} guides, ${docs.length} docs`;
 },
 // Wiki sections, search index and item icons from the recovered game data (tools/build-wiki-data.mjs).
 async wiki(){const {buildWikiData}=await import('./build-wiki-data.mjs');const r=await buildWikiData();return `wiki: ${Object.entries(r.counts).map(([k,v])=>`${v} ${k}`).join(', ')}, ${r.icons} icons`;},
};

export async function buildSite({only=null}={}){
 const names=only?.length?only:Object.keys(STEPS),log=[];
 for(const name of names){if(!STEPS[name])throw Error('Unknown build step: '+name);log.push(await STEPS[name]());}
 return log;
}
export function addStep(name,fn){STEPS[name]=fn;}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 for(const line of await buildSite({only:process.argv.slice(2)}))console.log(line);
}
