// Teleport ?h m straight up from where the player stands, sample the feet every frame until grounded: drop height,
// peak fall speed and the time taken, plus the port's own lastFall record.
export default async function({pages},q){const page=pages.get('p1');const h=+(q.h??12);
 return page.evaluate(async h=>{const d=window.explorerDev,S=()=>window.explorerState;const p=S().player.feet.slice();
  d.teleport([p[0],p[1]+h,p[2]]);const frames=[];const t0=performance.now();
  await new Promise(r=>{const f=()=>{const s=S();frames.push([performance.now()-t0,s.player.feet[1],s.player.grounded]);if(performance.now()-t0>200&&s.player.grounded||performance.now()-t0>8000)r();else requestAnimationFrame(f);};requestAnimationFrame(f);});
  let vmax=0;for(let i=1;i<frames.length;i++){const v=(frames[i-1][1]-frames[i][1])/((frames[i][0]-frames[i-1][0])/1000);if(v>vmax)vmax=v;}
  const top=Math.max(...frames.map(f=>f[1])),end=frames.at(-1)[1];
  return {start:p[1],top,end,drop:top-end,ms:Math.round(frames.at(-1)[0]),vmax,frames:frames.length,lastFall:S().player.lastFall,health:S().vitals.health};},h);}
