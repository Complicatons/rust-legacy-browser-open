const lib=()=>import('../lib.mjs?t='+Date.now());
// At the workbench: drag a Research Kit onto an unknown item (ResearchToolItem.TryCombine).
export default async function({pages,shot},q){const {inv,dev,drag,slotOf}=await lib();
 const page=pages.get('p1');const target=q.item??'9mm Pistol';await dev(page,'giveItem','Research Kit 1',1);await dev(page,'giveItem',target,1);
 const wb=(await dev(page,'deployables')).find(d=>d.item&&d.kind!=='campfire'&&/workbench/i.test(JSON.stringify(d)));
 if(!await page.evaluate(()=>document.querySelector('#inventory')?.open)){await page.keyboard.press('Tab');await page.waitForSelector('#inventory[open]');}
 const plaques=await page.evaluate(()=>[...document.querySelectorAll('[class*=plaque]:not([hidden])')].map(e=>e.textContent.trim()).filter(Boolean));
 const items=await inv(page);await drag(page,`#inventory [data-slot="${slotOf(items,'Research Kit 1')}"]`,`#inventory [data-slot="${slotOf(items,target)}"]`);await page.waitForTimeout(500);
 await shot(page,'21-research');
 const rows=await page.evaluate(()=>[...document.querySelectorAll('#blueprint-list [data-blueprint]')].map(b=>b.textContent.trim()));
 return {workbench:Boolean(wb),plaques,learned:rows.includes(target),kit:(await inv(page)).filter(x=>/Research|Pistol/.test(x.item)),popups:(await dev(page,'popupNotices')).slice(-2)};
}
