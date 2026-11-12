const lib=()=>import('../lib.mjs?t='+Date.now());
// Bow: draw (hold) and release at a spawned stag; then a 9mm pistol at a wolf: clip, reload (R), hits.
export default async function({pages,shot},q){const {dev,lock,key,closeInventory}=await lib();const page=pages.get('p1');await closeInventory(page);await lock(page);
 const out={};await dev(page,'giveItem','Hunting Bow',1);await dev(page,'giveItem','Arrow',20);await dev(page,'teleport',[5700,316.5,5160]);await page.waitForTimeout(800);
 const s=await dev(page,'hold','Hunting Bow'); // selected by hold()
 await page.waitForTimeout(800);
 const a=await dev(page,'spawnAnimal',q.animal??'stag_prefab',12);await page.waitForTimeout(600);out.shots=[];
 for(let i=0;i<8;i++){const st=await dev(page,'animalAt',a);if(!st||st.dead)break;await dev(page,'approachAnimalForShot',a);await dev(page,'aimAtAnimal',a,true);
  await page.mouse.down();await page.waitForTimeout(2300);await dev(page,'aimAtAnimal',a,true);if(i===0)await shot(page,'28-bow-drawn');await page.mouse.up();await page.waitForTimeout(1500);
  const c=await dev(page,'combat');out.shots.push([Math.round((await dev(page,'animalAt',a))?.health??-1),c.arrows]);}
 out.animal=await dev(page,'animalAt',a);await shot(page,'28-bow-after');
 out.arrowsLeft=await page.evaluate(()=>[...document.querySelectorAll('#belt [data-slot],#inventory [data-slot]')].filter(e=>e.querySelector('img[alt="Arrow"]')).map(e=>e.textContent.trim()));
 return out;
}
