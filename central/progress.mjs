// Roadmap progress bar: the overall and per-area percentages of the public GitHub journal's README
// (OWNER/rust-legacy-browser), fetched by the server (the page's CSP allows no other origin) and cached. When
// GitHub cannot be reached, or the README no longer has the figures, the committed site/content/progress.json is used
// (refresh it with node tools/sync-progress.mjs).
import {readFile} from 'node:fs/promises';

const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const pct=s=>{const n=Number(s);return Number.isInteger(n)&&n>=0&&n<=100?n:null;};

// {overall, date: 'YYYY-MM-DD'|null, areas:[{name,pct}]} or null when the README has no overall figure.
export function parseProgress(md){
 const line=/^Overall\b[^\n%]*?(\d{1,3})%/m.exec(md)??/PROGRESS-(\d{1,3})%25/.exec(md);
 const overall=line?pct(line[1]):null;if(overall==null)return null;
 const d=/^##\s*Progress\s*[—–-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/m.exec(md),m=d?MONTHS.indexOf(d[2].toLowerCase()):-1;
 const date=m<0?null:`${d[3]}-${String(m+1).padStart(2,'0')}-${d[1].padStart(2,'0')}`;
 const areas=[];for(const r of md.matchAll(/^\|\s*\*\*(.+?)\*\*\s*\|\s*`[^`]*`\s*(\d{1,3})%/gm)){const p=pct(r[2]);if(p!=null)areas.push({name:r[1].trim(),pct:p});}
 return {overall,date,areas};
}

export function createProgress({url=null,snapshot,fetch=globalThis.fetch,ttlMs=10*60e3,now=Date.now}){
 let live=null,checked=-Infinity,saved=null;
 async function refresh(){
  checked=now();
  try{
   const res=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!res.ok)return;
   const data=parseProgress(await res.text());if(data)live={...data,source:url};
  }catch{}
 }
 return {
  async get(){
   if(url&&now()-checked>=ttlMs)await refresh();
   if(live)return live;
   saved??={...JSON.parse(await readFile(snapshot,'utf8')),source:'snapshot'};return saved;
  },
 };
}
