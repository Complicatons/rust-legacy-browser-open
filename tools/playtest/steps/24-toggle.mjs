const lib=()=>import('../lib.mjs?t='+Date.now());
// Press 1 (rock), then 1 again: the original puts the held item away (HeldItem.OnBeltUse -> DeactivateItem).
export default async function({pages,shot}){const {dev,lock,key}=await lib();const page=pages.get('p1');await lock(page);
 const vm=async()=>{const v=await dev(page,'viewModel');return v?(v.item??v.name??Object.keys(v).slice(0,3).join(',')):null;};
 const sel=()=>page.evaluate(()=>[...document.querySelectorAll('#belt [data-slot]')].findIndex(e=>e.classList.contains('active-item')));
 await key(page,'Digit1');await page.waitForTimeout(700);const a=[await vm(),await sel()];
 await key(page,'Digit1');await page.waitForTimeout(900);const b=[await vm(),await sel()];await shot(page,'24-toggle');
 return {first:a,second:b,crosshair:await dev(page,'crosshair')};
}
