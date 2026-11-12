const lib=()=>import('../lib.mjs?t='+Date.now());
// Put the camp fire on the belt, look at the ground in front, click to place; E opens it; drag wood + meat in; light it.
export default async function({pages,shot,logs}){const {inv,lock,hold,dev,key,drag,slotOf,closeInventory,hitches,count}=await lib();
 const page=pages.get('p1');await closeInventory(page);await lock(page);
 const slot=await dev(page,'hold','Camp Fire'); // hold() selects it (a belt key now would put it away, HeldItem.OnBeltUse)
 await page.waitForTimeout(500);
 await page.evaluate(()=>window.explorerDev.face(window.explorerDev.controls().yaw??0,-0.5));
 const before=(await dev(page,'deployables')).length;await page.waitForTimeout(300);await shot(page,'11-fire-preview');
 await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();await page.waitForTimeout(600);
 const deps=await dev(page,'deployables');const fire=deps.length-1;
 const placed={before,after:deps.length,last:deps.at(-1)};
 await dev(page,'approachDeployable',fire);await page.waitForTimeout(400);
 const hint=await page.evaluate(()=>window.explorerState.useHint);
 await key(page,'KeyE');await page.waitForTimeout(700);
 const looting=await page.evaluate(()=>window.explorerState.loot.looting);await shot(page,'11-fire-open');
 const items=await inv(page);
 const labels=await page.evaluate(()=>[...document.querySelectorAll('#loot [data-loot]')].map(e=>e.dataset.loot));
 await drag(page,`#inventory [data-slot="${slotOf(items,'Wood')}"]`,'#loot [data-loot="6"]');
 await drag(page,`#inventory [data-slot="${slotOf(items,'Raw Chicken Breast')}"]`,'#loot [data-loot="3"]');
 await shot(page,'11-fire-filled');
 const slots=(await dev(page,'deployables'))[fire].slots;
 return {placed,hint,looting,labels,slots,log:logs.get('p1').slice(-4)};
}
