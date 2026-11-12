const lib=()=>import('../lib.mjs?t='+Date.now());
// Close the window, hold E on the fire for the context menu, screenshot, pick the light option; wait for cooking.
export default async function({pages,shot}){const {inv,lock,dev,closeInventory}=await lib();
 const page=pages.get('p1');await closeInventory(page);await lock(page);
 const fire=(await dev(page,'deployables')).findLastIndex(d=>d.kind==='campfire');await dev(page,'approachDeployable',fire);await page.waitForTimeout(300);
 await page.keyboard.down('KeyE');await page.waitForTimeout(700);
 const menu=await page.evaluate(()=>window.explorerDev.contextUI());await shot(page,'12-fire-menu');
 const options=await page.evaluate(()=>[...document.querySelectorAll('[class*=context] button, [class*=context] [data-option], #context-menu *')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,20));
 return {fire,menu,options};
}
