const lib=()=>import('../lib.mjs?t='+Date.now());
// Stand ?d m from the workbench (same height) and report whether the port counts it as "at workbench".
export default async function({pages},q){const {dev,closeInventory}=await lib();
 const page=pages.get('p1');await closeInventory(page);const i=(await dev(page,'deployables')).findIndex(d=>d.kind==='workbench');const w=(await dev(page,'deployables'))[i];
 const p=w.position;const d=+(q.d??1.5);await dev(page,'teleport',[p[0]+d,p[1]+0.1,-p[2]]);await page.waitForTimeout(600);
 const feet=await page.evaluate(()=>window.explorerState.player.feet);
 const hud=await page.evaluate(()=>[...document.querySelectorAll('.hud-plaque')].filter(p=>!p.hidden).map(p=>p.dataset.plaque));
 return {pos:p,feet,dh:Math.hypot(feet[0]-p[0],feet[2]+p[2]).toFixed(2),dy:(feet[1]-p[1]).toFixed(2),hud};
}
