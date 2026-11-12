import {hitches} from '../lib.mjs';
import {writeFile} from 'node:fs/promises';
// CPU profile ?ms with the inventory ?open (1/0); reports self time per function inside frames longer than 90 ms.
export default async function({pages,out},q){
 const page=pages.get('p1');const ms=+(q.ms??15000);
 const isOpen=()=>page.evaluate(()=>Boolean(document.querySelector('#inventory')?.open));
 if((q.open==='1')!==await isOpen())await page.keyboard.press('Tab');await page.waitForTimeout(1000);await hitches(page);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');
 const t0=await page.evaluate(()=>performance.now());await page.waitForTimeout(ms);
 const {profile}=await cdp.send('Profiler.stop');const h=await hitches(page);await writeFile(out+'/profile-'+(q.open??'0')+'.cpuprofile',JSON.stringify(profile));
 // Map samples to time; profile times are in microseconds of the same monotonic clock as performance.now()+timeOrigin? use relative.
 const byId=new Map(profile.nodes.map(n=>[n.id,n]));let t=profile.startTime;const total=new Map(),inLong=new Map();
 const longs=h.map(([end,gap])=>[end-gap,end]);const startMs=t0; // approx: profile start == t0
 for(let i=0;i<profile.samples.length;i++){t+=profile.timeDeltas[i];const n=byId.get(profile.samples[i]),k=n.callFrame.functionName+' '+n.callFrame.url.split('/').pop()+':'+n.callFrame.lineNumber;
  total.set(k,(total.get(k)??0)+profile.timeDeltas[i]);const rel=startMs+(t-profile.startTime)/1000;if(longs.some(([a,b])=>rel>=a&&rel<=b))inLong.set(k,(inLong.get(k)??0)+profile.timeDeltas[i]);}
 const top=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>k+' '+(v/1000).toFixed(1)+'ms');
 return {hitches:h,top:top(total),inLong:top(inLong)};
}
