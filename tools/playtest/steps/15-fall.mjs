const lib=()=>import('../lib.mjs?t='+Date.now());
// Drop from ?h metres above the ground: fall damage, leg break, then walk (slowed) and check the HUD.
export default async function({pages,shot},q){const {vitals,closeInventory,lock,dev,key}=await lib();
 const page=pages.get('p1');await closeInventory(page);await lock(page);
 const v0=await vitals(page);const p=v0.pos;
 await dev(page,'teleport',[p[0]+3,p[1]+(+(q.h??12)),p[2]]);
 await page.waitForFunction(()=>window.explorerState.player.grounded,{},{timeout:10000});await page.waitForTimeout(800);
 const v1=await vitals(page);await shot(page,'15-after-fall');
 const p1=v1.pos;await page.keyboard.down('KeyW');await page.waitForTimeout(2000);await page.keyboard.up('KeyW');const v2=await vitals(page);
 const speed=Math.hypot(v2.pos[0]-p1[0],v2.pos[2]-p1[2])/2;
 const hud=await page.evaluate(()=>[...document.querySelectorAll('#hud *, .hud *')].filter(e=>e.children.length===0&&e.textContent.trim()).map(e=>e.textContent.trim()).slice(0,30));
 return {before:{health:v0.health},after:{health:v1.health,bleeding:v1.bleeding,leg:v1.legInjury},fall:await page.evaluate(()=>window.explorerState.player.lastFall),speed,hud};
}
