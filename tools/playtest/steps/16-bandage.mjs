const lib=()=>import('../lib.mjs?t='+Date.now());
// Belt slot 2 (Bandage): hold the attack button to apply, as a player would.
export default async function({pages,shot}){const {vitals,lock,key,hold}=await lib();
 const page=pages.get('p1');await lock(page);const v0=await vitals(page);
 await key(page,'Digit2');await page.waitForTimeout(500);await shot(page,'16-bandage-held');
 await hold(page,4000);await page.waitForTimeout(500);const v1=await vitals(page);await shot(page,'16-bandaged');
 await page.waitForTimeout(8000);const v2=await vitals(page);
 const belt=await page.evaluate(()=>[...document.querySelectorAll('#belt [data-slot], .belt [data-slot]')].map(e=>e.textContent.trim()));
 return {before:[v0.health,v0.bleeding],after:[v1.health,v1.bleeding,v1.healOverTime],later:[v2.health,v2.bleeding,v2.healOverTime],belt,notices:v1.notices};
}
