const lib=()=>import('../lib.mjs?t='+Date.now());
// Repair the damaged doorway: Wood on the belt, aim at the doorway, press its belt key (ResourceTypeItem.OnBeltUse).
export default async function({pages,shot}){const {dev,lock,key,closeInventory}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);const out={};
 const dw=(await dev(page,'structures')).find(c=>c.item==='WoodDoorFrame');await dev(page,'giveItem','Wood',10);
 const slot=await dev(page,'hold','Wood');await key(page,'Digit1');await page.waitForTimeout(400); // rock out; Wood stays on the belt
 await dev(page,'teleport',[dw.center[0],dw.position[1]+0.05,dw.center[2]+2.2]);await page.waitForTimeout(600);await dev(page,'aimPoint',[dw.center[0]+1.7,dw.center[1],dw.center[2]]);await page.waitForTimeout(200);out.aim=(await dev(page,'aim',4)).hit;
 const h=async()=>Math.round((await dev(page,'structures')).find(c=>c.item==='WoodDoorFrame').health);out.before=await h();
 for(let i=0;i<4;i++){await key(page,'Digit'+(slot-29));await page.waitForTimeout(700);out['press'+i]=[await h(),(await dev(page,'popupNotices')).at(-1)];}
 await page.waitForTimeout(1500);await key(page,'Digit'+(slot-29));await page.waitForTimeout(500);out.after2s=[await h(),(await dev(page,'popupNotices')).at(-1)];
 out.wood=await page.evaluate(s=>document.querySelector(`#belt [data-slot="${s}"]`)?.textContent,slot);out.vm=(await dev(page,'viewModel'))?.name;await shot(page,'44-repaired');
 return out;}
