import {inv,lock,hold,dev,hitches,count} from '../lib.mjs';
// Nearest stone, metal and sulfur nodes: approach each and swing the rock for 8 s.
export default async function({pages,shot}){
 const page=pages.get('p1');await lock(page);
 const nodes=await dev(page,'nodes'),me=(await page.evaluate(()=>window.explorerState.player.feet));
 const d=n=>Math.hypot(n.position[0]-me[0],n.position[2]-me[2]);
 const out={kinds:[...new Set(nodes.map(n=>n.name))]};
 for(const kind of out.kinds){
  const i=nodes.map((n,i)=>[n,i]).filter(([n])=>n.name===kind).sort((a,b)=>d(a[0])-d(b[0]))[0][1];
  const r=await dev(page,'approachNode',i);await page.waitForTimeout(300);
  const t0=await inv(page);await hold(page,8000);await page.waitForTimeout(400);
  await shot(page,'06-node-'+kind.replace(/\W/g,''));const t1=await inv(page);
  out[kind]={dist:d(nodes[i]),left:r?.left,gained:t1.map(x=>x.item+x.count).join(' '),swing:(await page.evaluate(()=>window.explorerState.resources.lastSwing))};
 }
 out.hitches=await hitches(page);
 return out;
}
