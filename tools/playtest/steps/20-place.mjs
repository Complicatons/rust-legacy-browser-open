const lib=()=>import('../lib.mjs?t='+Date.now());
// Put ?name on the belt, look ?pitch down, ?turn yaw, click once to place; report what was placed.
export default async function({pages,shot},q){const {lock,dev,key,closeInventory}=await lib();
 const page=pages.get('p1');await closeInventory(page);await lock(page);
 const slot=await dev(page,'hold',q.name); // selected by hold()
 await page.waitForTimeout(500);
 if(q.yaw!=null)await dev(page,'face',+q.yaw,+(q.pitch??-0.4));
 const n0=(await dev(page,'deployables')).length+(await dev(page,'structures')).length;await page.waitForTimeout(300);
 const prev=await dev(page,'placementPreview').catch(()=>null);await shot(page,'20-preview-'+q.name.replace(/\W/g,''));
 await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();await page.waitForTimeout(600);
 const n1=(await dev(page,'deployables')).length+(await dev(page,'structures')).length;
 return {placed:n1>n0,preview:JSON.stringify(prev)?.slice(0,300),notices:(await page.evaluate(()=>window.explorerState.resources.notices)).slice(-2)};
}
