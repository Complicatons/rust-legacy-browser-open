// Roadmap index for /roadmap, built from site/content/roadmap/*.md on each request (a new entry is just a new file).
// Front matter: date (YYYY-MM-DD), optional end (last day of a range), title, summary,
//   stats: <value> | <label>; <value> | <label>
//   media: <file> | <caption>; <file> | <caption>    (files in site/generated/media/roadmap/, built by tools/build-roadmap-media.mjs)
// The file with `kind: coming` is the "What's coming" section and needs no date. Media that has not been built is left
// out of the index, so the page renders without it. A malformed file is skipped and reported in `errors`
// (tests/roadmap.test.mjs keeps the shipped content free of them).
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {parseFrontMatter} from '../site/js/markdown.mjs';

const DATE=/^\d{4}-\d{2}-\d{2}$/,FILE=/^[a-z0-9][a-z0-9-]*\.(jpg|mp4)$/;
export const MEDIA_URL='/site/generated/media/roadmap/';

// "a | b; c | d" -> [[a,b],[c,d]]
export const pairs=s=>String(s??'').split(';').map(p=>p.split('|').map(x=>x.trim())).filter(p=>p[0]);
const stats=s=>pairs(s).map(([value,label=''])=>({value,label}));

function entry(slug,meta,body,mediaDir){
 if(!DATE.test(meta.date??'')||!meta.title)throw Error('front matter needs date (YYYY-MM-DD) and title');
 if(meta.end&&(!DATE.test(meta.end)||meta.end<meta.date))throw Error('end must be a YYYY-MM-DD date on or after date');
 const media=pairs(meta.media).map(([file,caption=''])=>{
  if(!FILE.test(file))throw Error(`media file ${file} must be a lower-case .jpg or .mp4 name`);
  const video=file.endsWith('.mp4'),poster=video?file.replace(/\.mp4$/,'.poster.jpg'):null;
  return {file,type:video?'video':'image',src:MEDIA_URL+file,poster:poster&&existsSync(path.join(mediaDir,poster))?MEDIA_URL+poster:null,caption};
 });
 return {slug,date:meta.date,end:meta.end||null,title:meta.title,summary:meta.summary??'',stats:stats(meta.stats),
  media:media.filter(m=>existsSync(path.join(mediaDir,m.file))).map(({file,...m})=>m),files:media.map(m=>m.file),body};
}

export function readRoadmap(contentDir,mediaDir){
 const entries=[],errors=[];let coming=null,files=[];
 try{files=readdirSync(contentDir).filter(f=>/^[a-z0-9][a-z0-9-]*\.md$/.test(f)).sort();}catch{}
 for(const f of files){
  const {meta,body}=parseFrontMatter(readFileSync(path.join(contentDir,f),'utf8')),slug=f.slice(0,-3);
  if(meta.kind==='coming'){coming={slug,title:meta.title||"What's coming",summary:meta.summary??'',stats:stats(meta.stats),body};continue;}
  try{entries.push(entry(slug,meta,body,mediaDir));}catch(e){errors.push(`${f}: ${e.message}`);}
 }
 // numeric: a day's entries are numbered <date>-<n>-<slug>, and 10 comes after 9.
 entries.sort((a,b)=>a.date.localeCompare(b.date)||a.slug.localeCompare(b.slug,'en',{numeric:true}));
 return {entries,coming,errors};
}
