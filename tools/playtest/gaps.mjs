// Longest stretches between two animate() runs in a .cpuprofile and what the samples in between were.
import {readFileSync} from 'node:fs';
const [file,min='60']=process.argv.slice(2);const p=JSON.parse(readFileSync(file));
const byId=new Map(p.nodes.map(n=>[n.id,n]));const parent=new Map();for(const n of p.nodes)for(const c of n.children??[])parent.set(c,n.id);
const name=id=>{const n=byId.get(id).callFrame;return `${n.functionName||'(anon)'} ${n.url.split('/').pop().split('?')[0]}:${n.lineNumber+1}`;};
const stack=id=>{const s=[];while(id!=null){s.push(name(id));id=parent.get(id);}return s;};
let t=0,lastAnimate=null,between=[];const out=[];let frameStart=null,maxFrame=[0,0];
for(let i=0;i<p.samples.length;i++){t+=p.timeDeltas[i];const s=stack(p.samples[i]);const inAnimate=s.some(f=>f.startsWith('animate main.mjs'));
 if(inAnimate){if(lastAnimate!=null&&t-lastAnimate>min*1000){const agg=new Map();for(const id of between){const k=stack(id).slice(0,4).join(' < ');agg.set(k,(agg.get(k)??0)+1);}out.push({at:lastAnimate/1000,gap:(t-lastAnimate)/1000,top:[...agg].sort((a,b)=>b[1]-a[1]).slice(0,6)});}
  lastAnimate=t;between=[];}else between.push(p.samples[i]);}
console.log(out.length,'gaps');for(const o of out.sort((a,b)=>b.gap-a.gap).slice(0,8)){console.log(`--- at ${o.at.toFixed(0)} gap ${o.gap.toFixed(0)}ms`);for(const [k,v] of o.top)console.log('   ',v,k);}
