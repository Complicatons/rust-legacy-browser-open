// Splits a .cpuprofile into contiguous runs of samples under one top-level function (e.g. animate) and prints the
// heaviest frames over ?min ms with their inclusive per-function time.
import {readFileSync} from 'node:fs';
const [file,min='60',root='animate']=process.argv.slice(2);const p=JSON.parse(readFileSync(file));
const byId=new Map(p.nodes.map(n=>[n.id,n]));const parent=new Map();for(const n of p.nodes)for(const c of n.children??[])parent.set(c,n.id);
const name=id=>{const n=byId.get(id).callFrame;return `${n.functionName||'(anon)'} ${n.url.split('/').pop().split('?')[0]}:${n.lineNumber+1}`;};
const stack=id=>{const s=[];while(id!=null){s.push(name(id));id=parent.get(id);}return s;};
const top=id=>{const s=stack(id);return s.length>=2?s[s.length-2]:s[0];};
let t=0,run=null;const runs=[];
for(let i=0;i<p.samples.length;i++){t+=p.timeDeltas[i];const k=top(p.samples[i]);
 if(run&&run.key===k){run.samples.push([p.samples[i],p.timeDeltas[i]]);run.end=t;continue;}
 if(run&&run.end-run.start>=min*1000)runs.push(run);run={key:k,start:t,end:t,samples:[[p.samples[i],p.timeDeltas[i]]]};}
console.log('frames over',min,'ms:',runs.length);
for(const r of runs.sort((a,b)=>(b.end-b.start)-(a.end-a.start)).slice(0,+(process.env.N??6))){const agg=new Map();for(const [id,dt] of r.samples){for(const f of new Set(stack(id)))agg.set(f,(agg.get(f)??0)+dt);}
 console.log(`--- ${r.key} at ${(r.start/1000).toFixed(0)}ms +${((r.end-r.start)/1000).toFixed(0)}ms`);
 console.log([...agg].sort((a,b)=>b[1]-a[1]).slice(0,+(process.env.TOP??20)).map(([k,v])=>`  ${(v/1000).toFixed(1)} ${k}`).join('\n'));}
