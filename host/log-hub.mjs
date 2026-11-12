// Host app log hub (HOST-APP-PLAN.md "Live logs"): one ring per source, one sequence number across sources,
// subscribers, daily log files, a line splitter for child pipes and a polling tail for Unity's output_log.txt.
import {openSync,readSync,closeSync,statSync,appendFileSync,readdirSync,unlinkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {StringDecoder} from 'node:string_decoder';

export const MAX_LINE=4000;
export const levelOf=text=>/\b(error|fatal|failed|crash(ed)?)\b|exception\b/i.test(text)?'error':/\b(warn(ing)?|refus(ed|ing)|timed? ?out)\b/i.test(text)?'warn':'info';

// dir: write <source>-<yyyy-mm-dd>.log files (kept keepDays). perSource: lines kept in memory per source.
export function createLogHub({perSource=5000,dir=null,keepDays=14,now=()=>Date.now()}={}){
 const rings=new Map(),subs=new Set();let seq=0;
 if(dir)mkdirSync(dir,{recursive:true});
 const file=line=>{
  if(!dir)return;
  const iso=new Date(line.at).toISOString();
  try{appendFileSync(join(dir,`${line.source}-${iso.slice(0,10)}.log`),`${iso} [${line.stream}] ${line.text}\n`);}catch{}
 };
 const hub={
  // level: info|warn|error; guessed from the text when not given (host notes give their own).
  push(source,stream,text,level){
   text=String(text).replace(/\r$/,'');if(text.length>MAX_LINE)text=text.slice(0,MAX_LINE)+'…';
   const line={seq:++seq,at:now(),source,stream,text,level:level??levelOf(text)};
   let ring=rings.get(source);if(!ring)rings.set(source,ring=[]);
   ring.push(line);if(ring.length>perSource+(perSource>>3))ring.splice(0,ring.length-perSource); // trims in batches
   file(line);
   for(const f of subs)try{f(line);}catch{}
   return line;
  },
  // Lines with seq > after, oldest first; with limit, only the newest `limit` of them.
  since(after=0,limit=Infinity){
   const out=[];
   for(const ring of rings.values()){
    let lo=0,hi=ring.length;while(lo<hi){const m=(lo+hi)>>1;if(ring[m].seq>after)hi=m;else lo=m+1;}
    const start=Math.max(lo,ring.length-perSource);for(let i=start;i<ring.length;i++)out.push(ring[i]);
   }
   out.sort((a,b)=>a.seq-b.seq);
   return out.length>limit?out.slice(out.length-limit):out;
  },
  lastAt(source){const r=rings.get(source);return r?.length?r[r.length-1].at:null;},
  sources:()=>[...rings.keys()],
  get seq(){return seq;},
  subscribe(f){subs.add(f);return ()=>subs.delete(f);},
  prune(){
   if(!dir)return 0;let n=0;const cutoff=new Date(now()-keepDays*864e5).toISOString().slice(0,10);
   for(const f of readdirSync(dir)){const m=/-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);if(m&&m[1]<cutoff){try{unlinkSync(join(dir,f));n++;}catch{}}}
   return n;
  },
 };
 return hub;
}

// Splits a byte stream into lines (\n or \r\n). Multi-byte characters split across chunks stay whole.
export function lineSplitter(onLine){
 const dec=new StringDecoder('utf8');let rest='';
 const feed=chunk=>{
  rest+=typeof chunk==='string'?chunk:dec.write(chunk);
  let i;while((i=rest.indexOf('\n'))>=0){onLine(rest.slice(0,i).replace(/\r$/,''));rest=rest.slice(i+1);}
  if(rest.length>MAX_LINE*4){onLine(rest);rest='';} // a runaway line without newlines
 };
 feed.flush=()=>{rest+=dec.end();if(rest){onLine(rest.replace(/\r$/,''));rest='';}};
 return feed;
}

// Polls a file that another process appends to (Unity keeps output_log.txt open, so fs.watch is unreliable on
// Windows). A missing file is waited for; a file that shrinks was rewritten (Unity starts a new log each run) and is
// read again from the start. fromStart:false skips what is already there.
export function tailFile(path,onLine,{intervalMs=500,fromStart=true,onReset=()=>{}}={}){
 let pos=null,split=lineSplitter(onLine),timer=null;
 const poll=()=>{
  let size;try{size=statSync(path).size;}catch{if(pos!==null&&pos>0){pos=0;split.flush();split=lineSplitter(onLine);}if(pos===null)pos=0;return;}
  if(pos===null)pos=fromStart?0:size;
  if(size<pos){split.flush();split=lineSplitter(onLine);pos=0;onReset();}
  if(size===pos)return;
  let fd;try{fd=openSync(path,'r');}catch{return;}
  try{
   const buf=Buffer.allocUnsafe(Math.min(size-pos,1<<20));
   while(pos<size){const n=readSync(fd,buf,0,Math.min(buf.length,size-pos),pos);if(n<=0)break;pos+=n;split(buf.subarray(0,n));}
  }finally{closeSync(fd);}
 };
 timer=setInterval(poll,intervalMs);timer.unref?.();
 return {poll,stop(){clearInterval(timer);poll();split.flush();},reset(){pos=0;split=lineSplitter(onLine);},get position(){return pos;}};
}
