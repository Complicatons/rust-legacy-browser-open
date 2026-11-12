const lib=()=>import('../lib.mjs?t='+Date.now());
// HumanController.UpdateInput while crafting: start a long craft (Tab, pick ?name, Craft, Tab), then sprint forward
// on the flat field for 2 s: speed should be 2 m/s (no sprint, MovementScale 0.5), then cancel the craft.
export default async function({pages},q){const {lock,closeInventory,dev}=await lib();const page=pages.get('p1');const out={};
 await dev(page,'giveItem','Wood',200);await dev(page,'teleport',[5700,316.5,5175]);await page.waitForTimeout(900);
 const feet=()=>page.evaluate(()=>window.explorerState.player.feet.slice());
 const run=async()=>{await lock(page);await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(500);const a=await feet();await page.waitForTimeout(2000);const b=await feet();await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.waitForTimeout(400);return +(Math.hypot(b[0]-a[0],b[2]-a[2])/2).toFixed(2);};
 out.sprint=await run();
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await page.locator('#blueprint-list [data-blueprint]',{hasText:q.name??'Wood Planks'}).first().click();
 await page.locator('#craft-amount').fill('5');await page.locator('#craft-amount').press('Tab');await page.locator('#craft').click();await page.waitForTimeout(300);
 out.crafting=await page.evaluate(()=>document.querySelector('#craft').textContent);await closeInventory(page);
 out.sprintWhileCrafting=await run();
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');if(await page.evaluate(()=>document.querySelector('#craft').textContent==='Cancel'))await page.locator('#craft').click();await closeInventory(page);
 return out;}
