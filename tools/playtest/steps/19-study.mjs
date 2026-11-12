const lib=()=>import('../lib.mjs?t='+Date.now());
// A found blueprint: right-click -> Study; then the blueprint list should include it.
export default async function({pages,shot},q){const {inv,dev,slotOf}=await lib();
 const page=pages.get('p1');const name=q.name??'P250 Blueprint';await dev(page,'giveItem',name,1);
 if(!await page.evaluate(()=>document.querySelector('#inventory')?.open)){await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');}
 const s=slotOf(await inv(page),name);const b=await page.locator(`#inventory [data-slot="${s}"]`).boundingBox();
 await page.mouse.click(b.x+b.width/2,b.y+b.height/2,{button:'right'});await page.waitForTimeout(300);
 const menu=await page.evaluate(()=>[...document.querySelectorAll('#item-menu button')].map(b=>b.textContent));
 await page.locator('#item-menu button',{hasText:'Study'}).click();await page.waitForTimeout(500);await shot(page,'19-studied');
 const rows=await page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].map(b=>b.textContent.trim()));
 const again=await dev(page,'giveItem',name,1);const s2=slotOf(await inv(page),name);const b2=await page.locator(`#inventory [data-slot="${s2}"]`).boundingBox();
 await page.mouse.click(b2.x+b2.width/2,b2.y+b2.height/2,{button:'right'});await page.waitForTimeout(300);await page.locator('#item-menu button',{hasText:'Study'}).click();await page.waitForTimeout(500);
 return {menu,learned:rows.filter(r=>/P250|9mm Pistol/.test(r)),count:rows.length,still:slotOf(await inv(page),name),notices:await page.evaluate(()=>window.explorerState.resources.notices.slice(-3)),popups:await dev(page,'popupNotices')};
}
