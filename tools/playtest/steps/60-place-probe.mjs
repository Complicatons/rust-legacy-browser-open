const lib=()=>import('../lib.mjs?t='+Date.now());
// Hold ?name, look ?pitch down, report the placement preview, then press the mouse for ?ms and report what happened.
export default async function({pages,shot,logs},q){const {lock,dev,key,closeInventory}=await lib();
 const page=pages.get('p1');await closeInventory(page);await lock(page);
 const slot=await dev(page,'hold',q.name??'Camp Fire');await page.waitForTimeout(600);
 await page.evaluate(p=>window.explorerDev.face(window.explorerDev.controls().yaw??0,p),+(q.pitch??-0.5));
 await page.waitForTimeout(300);const prev=await dev(page,'placementPreview');
 const n0=(await dev(page,'deployables')).length;await shot(page,'60-probe');
 const fps=await page.evaluate(()=>new Promise(r=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<1000)requestAnimationFrame(f);else r(n);};requestAnimationFrame(f);}));
 await page.mouse.down();await page.waitForTimeout(+(q.ms??80));await page.mouse.up();await page.waitForTimeout(700);
 return {slot,fps,prev:JSON.stringify(prev).slice(0,200),n0,n1:(await dev(page,'deployables')).length,lock:await page.evaluate(()=>Boolean(document.pointerLockElement)),notices:(await page.evaluate(()=>window.explorerState.resources.notices)).slice(-2),log:logs.get('p1').slice(-4)};
}
