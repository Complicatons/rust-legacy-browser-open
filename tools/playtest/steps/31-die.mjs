const lib=()=>import('../lib.mjs?t='+Date.now());
// Die (a wolf bite stands in), look at the death screen, the loot bag at the body, then respawn at the camp (sleeping bag).
export default async function({pages,shot}){const {dev,lock,vitals,closeInventory}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 const out={};await dev(page,'hurtFrom',30,150,'Wolf');await page.waitForTimeout(2500);out.v=await vitals(page);await shot(page,'31-death-screen');
 out.screen=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&e.textContent.trim()&&e.checkVisibility()&&getComputedStyle(e).position!=='static'||e.closest?.('#death-screen')).map(e=>e.id+'|'+e.className+'|'+e.textContent.trim()).filter(t=>!/^\|/.test(t)||/death|respawn|killed/i.test(t)).slice(0,25));
 out.drops=await dev(page,'deathDrops');
 out.buttons=await page.evaluate(()=>[...document.querySelectorAll('button,[role=button],[data-df-name]')].filter(b=>b.checkVisibility()&&/respawn|camp|spawn|random/i.test(b.textContent+b.id+(b.dataset.dfName??''))).map(b=>(b.id||b.dataset.dfName)+':'+b.textContent.trim()));
 return out;
}
