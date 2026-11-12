const lib=()=>import('../lib.mjs?t='+Date.now());
// Rock held; move Wood to the belt and press its key: does the held rock go away?
export default async function({pages,shot}){const {dev,lock,key,closeInventory}=await lib();
 const page=pages.get('p1');await closeInventory(page);await lock(page);await key(page,'Digit1');await page.waitForTimeout(600);
 const before={vm:(await dev(page,'viewModel'))?.item??JSON.stringify(await dev(page,'viewModel')).slice(0,80),weapon:await dev(page,'weapon')};
 await dev(page,'giveItem','Wood',20);const slot=await dev(page,'hold','Wood');await key(page,'Digit1');await page.waitForTimeout(500); // hold() selects; reselect the rock first
 await key(page,'Digit'+(slot-29));await page.waitForTimeout(600);await shot(page,'23-belt-wood');
 const after={vm:JSON.stringify(await dev(page,'viewModel')).slice(0,120),weapon:await dev(page,'weapon'),selected:await page.evaluate(()=>[...document.querySelectorAll('#belt [data-slot]')].map(e=>e.className).join('|'))};
 return {slot,before,after};
}
