const lib=()=>import('../lib.mjs?t='+Date.now());
// Research at the bench: drag the Research Kit onto ?item (default 9mm Pistol) with the inventory open.
export default async function({pages,shot},q){const {dev,inv,drag,slotOf}=await lib();const page=pages.get('p1');
 await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');await page.waitForTimeout(300);const target=q.item??'9mm Pistol',items=await inv(page);
 await drag(page,`#inventory [data-slot="${slotOf(items,'Research Kit 1')}"]`,`#inventory [data-slot="${slotOf(items,target)}"]`);await page.waitForTimeout(500);await shot(page,'21-research-done');
 const rows=await page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].map(b=>b.textContent.trim()));
 return {learned:rows.includes(target),kit:(await inv(page)).filter(x=>/Research|Pistol/.test(x.item)),popups:(await dev(page,'popupNotices')).slice(-2)};}
